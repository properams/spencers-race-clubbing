// js/core/boot.js — app-bootstrap.
// Non-module script. boot() wordt aangeroepen aan het eind van main.js,
// zodat alle top-level globals (CAR_DEFS, activeWorld, scene/camera/renderer
// vars, etc.) door main.js zijn gedeclareerd voordat boot draait.
//
// Afhankelijkheden (allemaal globals via eerder geladen non-module scripts
// of ES modules die zichzelf op window.* zetten):
//   loadGameData (main.js), spawnFlames (effects/visuals.js),
//   initRenderer (core/renderer.js), buildScene (core/scene.js),
//   initAudio + _ensureAudio (audio/engine.js), startTitleMusic (audio/music.js),
//   initTouchControls (ui/touch.js), goToSelect + goToWorldSelect + goToRace
//   (ui/navigation.js), buildCarSelectUI + _updateSelectSummary (ui/select.js),
//   loadPersistent + updateTitleHighScore (persistence/* via window.*),
//   initDailyChallenge (gameplay/achievements.js),
//   setWeather (effects/weather.js), toggleNight (effects/night.js),
//   rebuildWorld (ui/navigation.js), loop (core/loop.js).

'use strict';

// ── Perf Phase A test-mode (URL ?perfauto=1) ─────────────────────────
// Activeert dbg-channels op localStorage (idempotent) en exposeert een
// kleine programmatic-API zodat tools/perf-run.mjs de game zonder canvas-
// klikken door het menu kan jagen. Geen game-logica wordt geraakt; dit is
// puur een entry-shim voor headless meting. Wordt uitgeschakeld als de
// flag niet gezet is.
(function(){
  try{
    const _qs = new URLSearchParams(location.search);
    if(_qs.has('perfauto')){
      try{
        if(localStorage.getItem('src_debug')!=='1') localStorage.setItem('src_debug','1');
        // Channels: 'perf' minimum, behoud bestaande filter als die er is.
        const _ch = localStorage.getItem('src_debug_channels');
        if(_ch && !_ch.split(',').map(s=>s.trim()).includes('perf')){
          localStorage.setItem('src_debug_channels', _ch + ',perf');
        }
      }catch(_){}
      window._perfAuto = true;
      window._bootDone = false;
    }
  }catch(_){}
})();

// ── Dev mode (URL ?dev=1) ────────────────────────────────────────────
// Toggles the #devPanel on the title screen. Per-page-load only — not
// persisted, so reloading without ?dev=1 hides the panel again. Dev
// actions themselves DO persist into the save (they call savePersistent()
// in career.js), but the entry point is always explicit.
(function(){
  try{
    const _qs = new URLSearchParams(location.search);
    if(_qs.get('dev')==='1' || _qs.has('dev')){
      window._devMode = true;
      // Unhide panel as soon as DOM is parsed (the script tag sits at the
      // bottom of body so the panel element already exists by now).
      const _panel = document.getElementById('devPanel');
      if(_panel) _panel.removeAttribute('hidden');
    }
  }catch(_){}
})();

// ── iOS long-press / context-menu / selection-popup blockers ─────────
// Killt de "Copy | Translate"-popup die anders mid-gameplay verschijnt
// bij het vasthouden van een knop.
function _installIOSGestureBlocks(){
  document.addEventListener('contextmenu',e=>e.preventDefault(),{capture:true});
  document.addEventListener('selectstart',e=>e.preventDefault(),{capture:true});
  document.addEventListener('touchstart',e=>{
    const t=e.target;
    if(t&&t.closest&&t.closest('canvas, .tcBtn, [id^="hud"], [id^="tc"], #glCanvas, #nitroBar')){
      // Inputs houden focus — preventDefault op canvas/divs only.
      // BUTTONs uitsluiten: preventDefault op touchstart killt de synthetische
      // click op iOS, waardoor onclick-handlers (#hudPauseBtn, #hudMuteBtn) niet vuren.
      if(t.tagName!=='INPUT'&&t.tagName!=='TEXTAREA'&&t.tagName!=='BUTTON')e.preventDefault();
    }
  },{passive:false,capture:true});
  // Block the gesture iOS uses to open system selection menus.
  document.addEventListener('gesturestart',e=>e.preventDefault(),{capture:true});
}

// ── Audio unlock op eerste user-interactie + retry op elke klik ──────
function _wireFirstGestureAudio(){
  const _startMusicOnce=()=>{
    initAudio(); startMenuMusic();
    // Pre-warm engine audio (4-osc graph + 88200-sample tire-noise buffer
    // fill) zodra audioCtx levend is. Voorheen draaide initEngine pas tijdens
    // countdown — de noise-buffer fill landde dan als 2-5ms blip net wanneer
    // de UI naar HUD flipt en de cars in scene komen. Door 'm hier op de
    // 1e gesture te firen, valt die kost binnen de "click→audio start"
    // verwachting die de user al heeft. engineGain start op 0 → blijft
    // stil tot updateEngine de gain ramped, dus geen audible side-effect.
    if(audioCtx&&typeof initEngine==='function'&&!engineOsc){
      try{
        if(window.dbg)dbg.measure('perf','initEngine.atFirstGesture',initEngine);
        else initEngine();
      }catch(e){
        if(window.dbg)dbg.warn('boot','initEngine at first-gesture failed: '+(e&&e.message||e));
      }
    }
  };
  const _firstGesture=()=>{
    _startMusicOnce();
    document.removeEventListener('click',_firstGesture,true);
    document.removeEventListener('pointerdown',_firstGesture,true);
    document.removeEventListener('touchstart',_firstGesture,true);
    document.removeEventListener('keydown',_firstGesture,true);
  };
  document.addEventListener('click',_firstGesture,true);
  document.addEventListener('pointerdown',_firstGesture,true);
  document.addEventListener('touchstart',_firstGesture,true);
  document.addEventListener('keydown',_firstGesture,true);
  // Retry op elke klik daarna — houdt audioCtx levend door suspends heen.
  document.addEventListener('click',()=>{if(audioCtx)_ensureAudio();},true);
}

// ── Hoofdmenu / world-select / difficulty knoppen ────────────────────
function _wireMenuButtons(){
  document.getElementById('btnStart').addEventListener('click',()=>{initAudio();startMenuMusic();goToWorldSelect();});
  document.getElementById('btnRace').addEventListener('click',function(){if(window.perfMark)perfMark('goToRace:click');if(window._perfAudit2026){try{window._heapAt&&_heapAt('goToRace.click');window._sceneStatsAt&&_sceneStatsAt('goToRace.click');window._swStateAt&&_swStateAt('goToRace.click');}catch(_){}}goToRace();});
  document.getElementById('btnBackTitle').addEventListener('click',()=>goToWorldSelect());
  _wireDevPanelButtons();
  _wireDevPanelSecretTap();
  // Wereld-cards: kies wereld, herbouw scene als 'm verandert, ga door naar car-select.
  // Re-entry guard: rebuildWorld is een 1-3s synchrone build. Een tweede card-tap
  // tijdens de eerste veroorzaakt een dubbele disposeScene+buildScene cyclus die op
  // iOS de WebGL context kan kapot drukken. Vroeger: 400ms wall-clock cooldown,
  // wat onvoldoende is als buildScene >400ms duurt (Guangzhou kan ~1-2s zijn op
  // mid-range mobile). Nu: boolean completion-flag, on rebuilds-in-progress
  // worden gewoon genegeerd tot de scene volledig binnen is.
  let _worldCardBusy=false;
  // One-click selection: clicking a card immediately starts the world
  // (or shows the lock hint for locked worlds). The visual selection +
  // Enter-CTA still update so the footer state stays consistent, but
  // the CTA is no longer required to commit.
  const _enterWorld=async (newWorld)=>{
    if(_worldCardBusy)return;
    const unlocked = !window._worldsUnlocked || window._worldsUnlocked.has(newWorld);
    if(!unlocked){
      const bought = (typeof buyWorld==='function') && buyWorld(newWorld);
      if(bought){
        if(typeof _initWorldSelectorTiles==='function')_initWorldSelectorTiles();
        if(typeof showPopup==='function')showPopup('🌍 WORLD UNLOCKED!','#00ee88',1800);
      } else {
        const hint = (typeof window.getWorldUnlockHint==='function')
          ? window.getWorldUnlockHint(newWorld) : 'Locked';
        if(typeof showPopup==='function')showPopup('🔒 '+hint,'#ff6644',1800);
        return;
      }
      return;
    }
    _worldCardBusy=true;
    // Title-first boot: wacht op de achtergrond-buildScene voordat we
    // beslissen of we moeten rebuilden. Anders kan een tweede buildScene
    // parallel starten met de eerste.
    if(window.__bootScenePromise){
      if(window.SrcLoader)window.SrcLoader.showWorldLoader();
      try{ await window.__bootScenePromise; }catch(_){}
      if(newWorld===activeWorld && window.SrcLoader)window.SrcLoader.hideWorldLoader();
    }
    const _afterBuild=()=>{
      setTimeout(()=>{
        document.getElementById('sWorld').classList.add('hidden');
        gameState='SELECT';
        buildCarSelectUI();
        document.getElementById('sSelect').classList.remove('hidden');
        _worldCardBusy=false;
      },220);
    };
    if(newWorld!==activeWorld&&typeof rebuildWorldAsync==='function'){
      rebuildWorldAsync(newWorld).then(_afterBuild,err=>{
        if(window.dbg)dbg.error('boot',err,'rebuildWorldAsync failed');
        else console.error('rebuildWorldAsync failed:',err);
        _afterBuild();
      });
    }else{
      Promise.resolve()
        .then(()=> (newWorld!==activeWorld) ? rebuildWorld(newWorld) : null)
        .catch(err=>{
          if(window.dbg)dbg.error('boot',err,'rebuildWorld fallback failed');
          else console.error('rebuildWorld fallback failed:',err);
        })
        .finally(_afterBuild);
    }
  };
  document.querySelectorAll('.worldBigCard').forEach(card=>{
    card.addEventListener('click',()=>{
      if(_worldCardBusy)return;
      const newWorld=card.dataset.world;
      document.querySelectorAll('.worldBigCard').forEach(c=>c.classList.remove('wBigSel'));
      card.classList.add('wBigSel');
      if(typeof window._updateWorldSelFooter==='function') window._updateWorldSelFooter();
      _enterWorld(newWorld);
    });
  });
  // Enter-CTA in the footer — starts the currently selected world.
  const enterBtn = document.getElementById('worldSelEnter');
  if(enterBtn){
    enterBtn.addEventListener('click',()=>{
      const sel = document.querySelector('#sWorld .worldBigCard.wBigSel[data-world]');
      if(sel) _enterWorld(sel.dataset.world);
    });
  }
  // Difficulty tab options 0=easy 1=normal 2=hard. Toggles both legacy
  // .diffSel and new .setOptSel klasse. Triggert rival-refresh aangezien
  // de rival hangt af van (world × difficulty).
  ['dEasy','dNorm','dHard'].forEach((id,i)=>{
    const el=document.getElementById(id);if(!el)return;
    el.addEventListener('click',()=>{
      difficulty=i;
      document.querySelectorAll('.diffBtn').forEach((b,j)=>{
        b.classList.toggle('diffSel',j===i);
        b.classList.toggle('setOptSel',j===i);
      });
      _updateSelectSummary();
      if(typeof _renderRival==='function')_renderRival();
    });
  });
  // Menu keyboard navigation (TITLE / WORLD_SELECT / SELECT). Re-uses the
  // gamepad cycling helpers exposed by ui/gamepad.js so keyboard + pad share
  // one implementation. Skipped during RACE/COUNTDOWN (arrows steer the car)
  // and while pause/help overlays are open (those have their own handlers).
  document.addEventListener('keydown',e=>{
    if(gameState==='RACE'||gameState==='COUNTDOWN')return;
    const pause=document.getElementById('pauseOverlay');
    if(pause&&getComputedStyle(pause).display!=='none')return;
    const help=document.getElementById('helpOverlay');
    if(help&&help.style.display==='flex')return;

    if(gameState==='TITLE'){
      if(e.code==='Enter'){e.preventDefault();goToSelect();}
      return;
    }
    if(gameState==='WORLD_SELECT'){
      if(e.code==='ArrowLeft'){e.preventDefault();window._menuCycleWorld&&window._menuCycleWorld(-1);}
      else if(e.code==='ArrowRight'){e.preventDefault();window._menuCycleWorld&&window._menuCycleWorld(+1);}
      else if(e.code==='ArrowUp'){e.preventDefault();window._menuCycleWorld&&window._menuCycleWorld('up');}
      else if(e.code==='ArrowDown'){e.preventDefault();window._menuCycleWorld&&window._menuCycleWorld('down');}
      else if(e.code==='Enter'){e.preventDefault();window._menuActivateWorld&&window._menuActivateWorld();}
      return;
    }
    if(gameState==='SELECT'){
      if(e.code==='ArrowLeft'){e.preventDefault();window._menuCycleCar&&window._menuCycleCar(-1);}
      else if(e.code==='ArrowRight'){e.preventDefault();window._menuCycleCar&&window._menuCycleCar(+1);}
      else if(e.code==='ArrowUp'){e.preventDefault();window._menuCycleCar&&window._menuCycleCar('up');}
      else if(e.code==='ArrowDown'){e.preventDefault();window._menuCycleCar&&window._menuCycleCar('down');}
      else if(e.code==='Enter'){e.preventDefault();window._menuConfirm&&window._menuConfirm();}
    }
  });
}

// ── Dev panel — wire the 6 action buttons to window.Dev.* ─────────────
// Guarded by _devButtonsWired so a second call doesn't double-attach
// listeners. Panel is hidden by default; the IIFE near the top of
// boot.js unhides it when ?dev=1. Button handlers refresh the
// title-screen career panel and world tiles after each action so visual
// state stays in sync without a reload.
let _devButtonsWired = false;
function _wireDevPanelButtons(){
  if(_devButtonsWired) return;
  const panel = document.getElementById('devPanel');
  if(!panel) return;
  _devButtonsWired = true;
  const refresh = ()=>{
    if(typeof updateTitleHighScore==='function')updateTitleHighScore();
    if(typeof _initWorldSelectorTiles==='function')_initWorldSelectorTiles();
    if(typeof buildCarSelectUI==='function' && gameState==='SELECT')buildCarSelectUI();
  };
  const closeBtn = panel.querySelector('.devPanelClose');
  if(closeBtn) closeBtn.addEventListener('click',()=>panel.setAttribute('hidden',''));
  panel.querySelectorAll('.devBtn').forEach(btn=>{
    btn.addEventListener('click',(e)=>{
      e.preventDefault();
      const action = btn.dataset.dev;
      if(!action) return;
      if(!window.Dev || typeof window.Dev[action] !== 'function'){
        if(window.dbg)dbg.warn('dev','action not ready: '+action);
        else console.warn('Dev action not ready:', action);
        return;
      }
      if(action === 'resetProgress'){
        if(!confirm('Reset all progress? This wipes the save and reloads.')) return;
      }
      try{
        window.Dev[action]();
        // Brief visual confirmation — flash button + popup if available.
        btn.style.transition='background .15s';
        const orig = btn.style.background;
        btn.style.background='rgba(120,255,180,.45)';
        setTimeout(()=>{btn.style.background=orig;}, 220);
        if(typeof showPopup==='function' && action!=='resetProgress' && action!=='dumpState'){
          showPopup('✅ '+action,'#00ee88',1200);
        }
        if(action !== 'resetProgress') refresh();
        // Auto-close on mobile after a successful action so the panel
        // doesn't sit on top of game UI. Skip dumpState (need console
        // open anyway) and resetProgress (page reloads).
        if(action !== 'resetProgress' && action !== 'dumpState'
           && window.matchMedia && window.matchMedia('(max-width:600px)').matches){
          setTimeout(()=>panel.setAttribute('hidden',''), 260);
        }
      }catch(err){
        if(window.dbg)dbg.error('dev',err,'action failed: '+action);
        else console.error('Dev action failed:', action, err);
        if(typeof showPopup==='function')showPopup('❌ '+action+' failed','#ff4444',1800);
      }
    });
  });
}

// ── Secret tap-combo: 5 taps on .tLogo within 3s reveals dev panel ────
// Discoverability fallback for when ?dev=1 is forgotten. Per-page-load
// only (no localStorage persistence) so a regular player who taps the
// logo idly doesn't see dev tools on their next session. Console.info
// breadcrumb on boot makes the combo discoverable in DevTools too.
let _devTapsWired = false;
function _wireDevPanelSecretTap(){
  if(_devTapsWired) return;
  const logo = document.querySelector('.tLogo');
  if(!logo) return;
  _devTapsWired = true;
  let count = 0;
  let lastTap = 0;
  const WINDOW_MS = 3000;
  const REQUIRED = 5;
  const reveal = ()=>{
    const panel = document.getElementById('devPanel');
    if(panel) panel.removeAttribute('hidden');
    window._devMode = true;
    if(typeof showPopup==='function')
      showPopup('🛠 DEV MODE UNLOCKED','#ff44dd',2200);
  };
  const handler = ()=>{
    const now = performance.now();
    if(now - lastTap > WINDOW_MS) count = 0;
    lastTap = now;
    count++;
    if(count >= REQUIRED){
      count = 0;
      reveal();
    }
  };
  logo.addEventListener('pointerdown', handler);
  // Make the combo discoverable in DevTools for first-time devs.
  if(window.dbg) dbg.log('dev','dev mode: tap logo 5x within 3s or use ?dev=1');
  else console.info('%c🛠 Dev mode','color:#ff44dd;font-weight:bold','tap logo 5x within 3s or open with ?dev=1');
}

// ── User preferences uit localStorage terugzetten ────────────────────
// World-restore is verhuisd naar _restoreSavedWorld() die VÓÓR de eerste
// buildScene draait — anders bouwen we de scene 2x op boot wanneer de
// saved world afwijkt van default. Phase 1 bevinding 1.4: 2x synchrone
// buildScene op boot is een serieuze CPU-piek op trage iPhones.
function _restoreUserPrefs(){
  // Hard-lock night-mode wanneer SHOW_DAYNIGHT_TOGGLE=false. Vóór de
  // localStorage-restore zodat geen oude 'src_night=0' het nog tijdelijk
  // op day kan zetten. localStorage wordt overschreven naar '1' zodat
  // future sessions ook night-locked zijn. UI-toggles zijn fully removed
  // uit de DOM; toggleNight() blijft beschikbaar voor developer KeyJ.
  if(typeof SHOW_DAYNIGHT_TOGGLE!=='undefined'&&!SHOW_DAYNIGHT_TOGGLE){
    localStorage.setItem('src_night','1');
    if(!isDark)toggleNight();
  } else {
    // Original behaviour: restore day/night state from localStorage.
    const _savedNight=localStorage.getItem('src_night');
    if(_savedNight==='0'){if(isDark)toggleNight();}else{if(!isDark)toggleNight();}
  }
  const _savedW=localStorage.getItem('src_weather');
  if(_savedW&&_savedW!=='clear'){
    // Title-first boot: scene is built async via __bootScenePromise, so
    // setWeather() (which reads scene.fog) must wait until the build is
    // done. The fixed 100ms setTimeout that used to live here would fire
    // before buildScene finished on cold loads, throwing
    // "Cannot read properties of undefined (reading 'fog')".
    const _applySavedWeather=()=>{
      if(typeof scene==='undefined'||!scene||!scene.fog) return;
      // Fase 4b: setWeather is zelf-sufficient — past intern eerst
      // applyWorldLighting (wereld-base) en dan applyWeatherLighting
      // (multiplier-mod) toe. De oude `if(isDark){sun=.04, amb=.10,
      // hemi=.07, trackLights=2.8}` reapply hier was een workaround voor
      // de pre-fase-4 GP-clobber bug — die waardes waren bovendien
      // hardcoded GP-night-baseline en fout voor sandstorm/pier47/space.
      setWeather(_savedW);
    };
    if(window.__bootScenePromise){
      window.__bootScenePromise.then(_applySavedWeather).catch(()=>{});
    } else {
      // __bootScenePromise is assigned right after _restoreUserPrefs() in
      // the boot sequence — defer one microtask so we can pick it up.
      Promise.resolve().then(()=>{
        if(window.__bootScenePromise) window.__bootScenePromise.then(_applySavedWeather).catch(()=>{});
        else setTimeout(_applySavedWeather,100);
      });
    }
  }
}

// ── Memory-budget warning bij boot ───────────────────────────────────
// Probeert te detecteren of het device kandidaat is voor crashes onder
// memory-druk. Triggert alleen op mobiel + lage device-memory; logt
// altijd via dbg zodat het in Ctrl+Shift+E ringbuffer zichtbaar is.
function _checkMemoryBudget(){
  let _msg=null;
  try{
    const _dm=navigator.deviceMemory; // Chrome — typically 0.25, 0.5, 1, 2, 4, 8
    if(window._isMobile && typeof _dm==='number' && _dm>0 && _dm<2){
      _msg='Low device memory ('+_dm+'GB) — verminder achtergrond-apps voor stabiele performance.';
    }
    if(performance.memory){ // Chrome only
      const _lim=performance.memory.jsHeapSizeLimit/1048576;
      if(_lim<800){
        _msg=(_msg?_msg+' ':'')+'JS heap limit '+_lim.toFixed(0)+'MB — krap voor deze game.';
      }
    }
  }catch(_){}
  if(_msg){
    if(window.dbg)dbg.warn('boot','memory budget '+_msg);
    if(window.Breadcrumb)Breadcrumb.push('memBudgetWarn',{msg:_msg.slice(0,80)});
    // Subtiele non-blocking warning via bestaande Notify-facade. dur=4500 zodat
    // de melding lang genoeg leesbaar is om gezien te worden zonder de title
    // permanent te bedekken. Notify.banner valt op TITLE-state in OOB-slot.
    if(window.Notify)Notify.banner('⚠ '+_msg,'#ffaa55',4500);
  }
}

// Schema-validator for waypoint loops in data/tracks.json. Runs once at
// boot, after loadGameData() populates _TRACKS. Catches:
//   • segment lengths outside [10, 200] units (sparse or duplicate WPs)
//   • opeenvolgende waypoints binnen 5 units (effectively duplicate)
//   • non-adjacent segment-segment intersections (figure-8 / zelfsnijdende loop)
// Channel: 'track-validate'. Logs warnings only — never crashes — so a flagged
// world stays playable while the warning surfaces in dbg's ringbuffer.
function _validateTrackSchema(){
  if(typeof _TRACKS!=='object'||!_TRACKS)return;
  const warn=(w,msg)=>{
    if(window.dbg)dbg.warn('track-validate','['+w+'] '+msg);
    // No console fallback — this is purely diagnostic; absence of dbg means
    // a non-debug session and we don't want to spam the production console.
  };
  // 2D segment-segment intersection test (returns true if AB and CD cross).
  // Uses oriented-area / sign comparison; not a precise intersection but
  // sufficient for "do these segments cross visibly".
  const _sgn=v=>v>0?1:v<0?-1:0;
  const _segCross=(ax,az,bx,bz,cx,cz,dx,dz)=>{
    const d1=(dx-cx)*(az-cz)-(dz-cz)*(ax-cx);
    const d2=(dx-cx)*(bz-cz)-(dz-cz)*(bx-cx);
    const d3=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);
    const d4=(bx-ax)*(dz-az)-(bz-az)*(dx-ax);
    return _sgn(d1)!==_sgn(d2)&&_sgn(d3)!==_sgn(d4);
  };
  const worlds=Object.keys(_TRACKS);
  for(let wi=0;wi<worlds.length;wi++){
    const w=worlds[wi],pts=_TRACKS[w];
    if(!Array.isArray(pts)||pts.length<3){
      warn(w,'expected array of >=3 waypoints, got '+(pts&&pts.length));
      continue;
    }
    const N=pts.length;
    // Segment-length + duplicate checks
    for(let i=0;i<N;i++){
      const a=pts[i],b=pts[(i+1)%N];
      const dx=b[0]-a[0],dz=b[1]-a[1];
      const dist=Math.hypot(dx,dz);
      if(dist<5){
        warn(w,'wp'+(i+1)+'->wp'+(((i+1)%N)+1)+' near-duplicate (dist='+dist.toFixed(2)+')');
      }else if(dist<10||dist>200){
        warn(w,'wp'+(i+1)+'->wp'+(((i+1)%N)+1)+' segment-length '+dist.toFixed(1)+' outside [10..200]');
      }
    }
    // Non-adjacent segment intersection check — quadratic in N, but N<=18
    // so 18² = 324 comparisons per world, ~2.6k total. One-shot at boot.
    for(let i=0;i<N;i++){
      const a=pts[i],b=pts[(i+1)%N];
      // Skip the segment itself + its two neighbours (those touch by design).
      for(let j=i+2;j<N;j++){
        if(j===N-1&&i===0)continue; // closing seg shares wp with first
        const c=pts[j],d=pts[(j+1)%N];
        if(_segCross(a[0],a[1],b[0],b[1],c[0],c[1],d[0],d[1])){
          warn(w,'segment wp'+(i+1)+'->wp'+(((i+1)%N)+1)+
                 ' crosses wp'+(j+1)+'->wp'+(((j+1)%N)+1)+' — self-intersecting loop');
        }
      }
    }
  }
}

// Lazy-load een script via DOM-injectie. Resolved op load én op error (we
// willen niet dat een ontbrekend dev-bundle de boot blokkeert).
function _loadScriptLazy(src){
  return new Promise(resolve=>{
    const s=document.createElement('script');
    s.src=src;s.async=false;
    s.onload=()=>resolve(true);
    s.onerror=()=>resolve(false);
    document.head.appendChild(s);
  });
}

async function boot(){
  window.dbg&&dbg.log('boot','start');
  // Cold-start instrumentatie: first-paint = eerste rAF na boot-start.
  // Isoleert "code begint te draaien" vs "browser heeft iets op het scherm
  // gezet" — verschil onthult main-thread blocking tussen boot()-call en
  // first paint.
  if(window.perfMark){
    requestAnimationFrame(()=>{ try{ perfMark('first-paint'); perfMeasure('boot.toFirstPaint','boot:start','first-paint'); }catch(_){} });
  }
  const _loadEl=document.getElementById('loadingScreen');
  // Hook the smooth-loader engine to the circular SVG inside #loadingScreen.
  // setTarget is monotonic and decoupled from the actual loading work — the
  // synthetic trickle keeps the arc moving even between progress events, and
  // CSS rotation runs on the compositor thread so it survives main-thread blocks.
  if(_loadEl && window.SrcLoader){
    const _inner=_loadEl.querySelector('.srcLoader');
    if(_inner)window.SrcLoader.attach(_inner);
  }
  const _setProgress=(pct,label)=>{
    if(window.SrcLoader){
      if(pct!=null)window.SrcLoader.setTarget(pct);
      if(label)window.SrcLoader.setLabel(label);
    }
  };
  window._loadProgress=_setProgress;
  _setProgress(15,'INITIALIZING');
  // Dev/perf bundles zijn uit de boot-chain om 111 KB JS-parse te besparen
  // voor normale gebruikers. Lazy-load alleen onder ?dev=1 of opgeslagen flag.
  let _isDev=false;
  try{_isDev=/[?&]dev=1\b/.test(location.search)||localStorage.getItem('src_dev')==='1';}
  catch(_){_isDev=false;}
  if(_isDev){
    await _loadScriptLazy('dist/debug.bundle.js');
    await _loadScriptLazy('dist/race-perf-probe.bundle.js');
  }
  // SW disabled for file:// compat.
  // Load game data (cars/tracks/prices) before scene init.
  if(window.perfMark)perfMark('boot:gameData:start');
  try{await loadGameData();}
  catch(e){
    // dbg.error logt al naar console én pusht naar de errors-ringbuffer.
    if(window.dbg)dbg.error('boot',e,'loadGameData failed');
    else console.error('loadGameData failed:',e);
    if(_loadEl){_loadEl.innerHTML='<div style="padding:40px;color:var(--peach);font-family:var(--font-display);letter-spacing:3px;text-shadow:-1px 0 rgba(255,58,138,.5),1px 0 rgba(0,224,255,.5)">⚠ DATA LOAD FAILED<br><span style="font-family:var(--font-mono);font-size:12px;color:var(--text-dim);letter-spacing:0;text-shadow:none">'+e.message+'</span></div>';}
    return;
  }
  if(window.perfMark){perfMark('boot:gameData:end');perfMeasure('boot.gameData','boot:gameData:start','boot:gameData:end');}
  // Validate waypoint loops once the data is loaded. Pure diagnostic — any
  // flagged world stays playable but the warning helps spot regressions early.
  try{_validateTrackSchema();}
  catch(e){if(window.dbg)dbg.warn('track-validate','validator threw: '+(e&&e.message||e));}
  _setProgress(40,'INITIALIZING');
  _installIOSGestureBlocks();
  spawnFlames();
  // Defer heavy init zodat de browser eerst de loading-screen kan painten.
  setTimeout(async ()=>{
    if(window.perfMark)perfMark('boot:initRenderer:start');
    try{initRenderer();}
    catch(e){
      if(window.dbg)dbg.error('boot',e,'initRenderer failed');
      else console.error('initRenderer failed:',e);
      if(_loadEl){
        _loadEl.style.display='flex';
        _loadEl.innerHTML='<div style="text-align:center;padding:40px;font-family:var(--font-body)"><div style="font-size:24px;margin-bottom:12px;color:var(--peach)">⚠</div><div style="font-family:var(--font-display);font-size:16px;color:var(--text);margin-bottom:10px;letter-spacing:3px;text-shadow:-1px 0 rgba(255,58,138,.5),1px 0 rgba(0,224,255,.5)">WebGL niet beschikbaar</div><div style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);line-height:1.9;max-width:380px">Probeer:<br>1. Sluit andere browser tabs<br>2. Herlaad (F5)<br>3. Chrome → Instellingen → Systeem → Hardware acceleratie AAN</div><button onclick="location.reload()" style="margin-top:16px;background:var(--surface);color:var(--text);border:1px solid var(--line-strong);padding:10px 24px;border-radius:8px;cursor:pointer;font-family:var(--font-mono);font-size:11px;letter-spacing:2px;text-transform:uppercase">🔄 OPNIEUW</button></div>';
      }
      return;
    }
    if(window.perfMark){perfMark('boot:initRenderer:end');perfMeasure('boot.initRenderer','boot:initRenderer:start','boot:initRenderer:end');}
    _setProgress(70,'WAKING UP CIRCUITS');
    // Restore saved world VÓÓR de eerste buildScene zodat we niet 2x bouwen.
    // Vroeger: _restoreUserPrefs deed activeWorld='space' + buildScene() ná
    // de initial buildScene op default world. Nu: één enkele build met de
    // juiste wereld. Alleen werelden die _wireMenuButtons als data-world
    // values bevat zijn valid; onbekende waarden vallen terug op default.
    try{
      const _savedWorld=localStorage.getItem('src_world');
      if(_savedWorld){
        // CSS.escape voorkomt selector-syntax breken op gemanipuleerde
        // localStorage-waarden met aanhalingstekens of brackets.
        const _esc=(window.CSS&&CSS.escape)?CSS.escape(_savedWorld):_savedWorld.replace(/[^\w-]/g,'');
        if(document.querySelector('.worldBigCard[data-world="'+_esc+'"]')){
          activeWorld=_savedWorld;
        }
      }
    }catch(_){}
    // === Title-first boot ===========================================
    // Verberg de loading-screen NU en toon TITLE direct. buildScene draait
    // op de achtergrond. loop() rendert pas zodra scene+camera bestaan
    // (gate in core/loop.js). Tot die tijd dekt #sTitle's .neon-bg het
    // canvas-gebied af, dus de gebruiker ziet geen lege zwart canvas.
    // goToSelect (ui/navigation.js) await't __bootScenePromise zodat een
    // user die meteen "ENTER LIGHT" tikt netjes wacht op de scene-build.
    _setProgress(100,'READY');
    if(window.SrcLoader){
      window.SrcLoader.finish();
    } else if(_loadEl){
      requestAnimationFrame(()=>{requestAnimationFrame(()=>{
        if(_loadEl)_loadEl.style.display='none';
      });});
    }
    // Wire UI + start loop direct zodat TITLE interactief is.
    _wireFirstGestureAudio();
    _wireMenuButtons();
    initTouchControls();
    // Pre-fetch menu-music MP3 als ArrayBuffer — geen audioCtx nodig voor
    // fetch+arrayBuffer, die volgt later op de 1e user-gesture. Resultaat:
    // op ENTER LIGHT-tap is alleen nog een decodeAudioData nodig (~100-200ms
    // op iOS Safari) i.p.v. de hele fetch+decode-keten van >1s, dus de
    // muziek begint hoorbaar vóór het world-picker scherm in beeld is.
    if(!window._menuMusicArrayBuffer && !window._menuMusicArrayBufferLoading){
      window._menuMusicArrayBufferLoading = fetch('assets/audio/music/menu/grid-run.mp3', { cache:'force-cache' })
        .then(r => r.arrayBuffer())
        .then(buf => { window._menuMusicArrayBuffer = buf; return buf; })
        .catch(e => { if(window.dbg) dbg.warn('music','menu mp3 prefetch failed: '+(e&&e.message||e)); return null; });
    }
    // Warm de browser/SW cache voor de race-muziek van de actieve wereld
    // (cosmic = space) zodat samples.js' _loadSlot bij de 1e gesture niet
    // tegen een koude netwerk-fetch aan loopt. We slaan de ArrayBuffer niet
    // op — alleen de fetch zelf is genoeg om Cache-API/HTTP-cache te vullen.
    // Pas wanneer audioCtx live is doet samples.js de echte fetch+decode,
    // en die hit dan de warme cache. Lijst is in-sync gehouden met
    // MUSIC_MANIFEST in js/audio/samples.js — als daar een wereld bij komt,
    // hier ook.
    try{
      const _raceMp3 = { space:'assets/audio/music/space/base.mp3',
                        pier47:'assets/audio/music/pier47/base.mp3',
                        deepsea:'assets/audio/music/deepsea/base.mp3',
                        candy:'assets/audio/music/candy/base.mp3',
                        volcano:'assets/audio/music/volcano/base.mp3',
                        arctic:'assets/audio/music/arctic/base.mp3' };
      const _url = _raceMp3[window.activeWorld];
      if(_url) fetch(_url, { cache:'force-cache' }).catch(()=>{});
    }catch(_){}
    if(window.perfMark)perfMark('boot:loadPersistent:start');
    loadPersistent();
    if(typeof window.loadIdentity==='function') loadIdentity();
    updateTitleHighScore();
    initDailyChallenge();
    _restoreUserPrefs();
    _checkMemoryBudget();
    if(window.perfMark){perfMark('boot:loadPersistent:end');perfMeasure('boot.loadPersistent','boot:loadPersistent:start','boot:loadPersistent:end');}
    loop();
    // Menu is nu interactief: rAF loop draait, knoppen zijn gewired, audio
    // wacht op eerste gesture. Achtergrond-buildScene draait verder onder
    // __bootScenePromise. menu:interactive markeert hier.
    if(window.perfMark){perfMark('menu:interactive');perfMeasure('boot.total','boot:start','menu:interactive');}
    if(window._perfAudit2026){try{window._heapAt&&_heapAt('menu.interactive');window._sceneStatsAt&&_sceneStatsAt('menu.interactive');window._swStateAt&&_swStateAt('menu.interactive');}catch(_){}}
    // Background: world-script + buildScene. Errors surface in dbg + worden
    // door goToSelect/_wireMenuButtons opgevangen via de promise.
    if(window.perfMark)perfMark('boot:initialBuild:start');
    window.__bootScenePromise=(async()=>{
      // Visual asset preload (fire-and-forget; buildScene gebruikt
      // procedural fallback als de cache niet op tijd klaar is).
      if(window.Assets&&window.Assets.preloadWorld&&window.activeWorld){
        window.Assets.preloadWorld(window.activeWorld).then(()=>{
          try{ if(typeof maybeUpgradeWorld==='function'){maybeUpgradeWorld._lastCalledFrom='bootPreloadResolve';maybeUpgradeWorld(window.activeWorld);} }
          catch(e){ if(window.dbg)dbg.error('boot',e,'maybeUpgradeWorld failed (initial)'); else console.error('maybeUpgradeWorld failed:',e); }
        }).catch(e=>{
          if(window.dbg)dbg.error('boot',e,'Assets.preloadWorld rejected (initial)');
          else console.error('Assets.preloadWorld rejected:',e);
        });
      }
      if(typeof window.loadWorldScript==='function'){
        try{ await window.loadWorldScript(window.activeWorld); }
        catch(e){
          if(window.dbg)dbg.error('boot',e,'loadWorldScript failed for initial world');
          else console.error('loadWorldScript failed for initial world:',e);
        }
      }
      // deferPrecompile: sla de ~6-11s shader-precompile over op het boot-pad.
      // De speler heeft deze wereld nog niet bevestigd (carousel komt later);
      // kiest hij een andere, dan was die precompile verspild. De compile
      // landt warm in goToRace (achter LIGHTS OUT) of in rebuildWorld.
      try{ await buildScene({deferPrecompile:true}); }
      catch(e){
        if(window.dbg)dbg.error('boot',e,'buildScene crashed');
        else console.error('buildScene crashed:',e);
      }
      // Prefetch eerder gestart (QW2 S-variant 2026-05-28): start na
      // buildScene maar binnen achtergrond-IIFE, ~200-500ms eerder dan
      // post-menu:interactive. Effectieve user-facing winst alleen
      // wanneer user binnen ~1s op race klikt (rest hangt al op
      // buildScene/precompile zelf). [LIVE confirmatie via FASE 1 9-run
      // protocol — claim 500-2000ms in quickwin-plan blijft het
      // verwachte boven-grens-effect over alle cache-states samen]
      if(typeof window.prefetchAllWorlds==='function'){
        window.prefetchAllWorlds(window.activeWorld);
      }
      if(window.perfMark){perfMark('boot:initialBuild:end');perfMeasure('boot.initialBuild','boot:initialBuild:start','boot:initialBuild:end');}
    })();
    window.dbg&&dbg.log('boot','done');
    // Perf Phase A: signaalvlag voor headless test-runner. Pas zetten na
    // loop() zodat de runner zeker weet dat rAF al draait.
    window._bootDone = true;
    // Service worker — cached zware vendor + wereld + asset bestanden zodat
    // het tweede bezoek vrijwel-instant boott. Registreren ná loop() zodat
    // de eerste-bezoek boot niet vertraagd wordt door SW install.
    if('serviceWorker' in navigator&&location.protocol!=='file:'){
      const _swRegister=()=>{
        const _tSw=performance.now();
        if(window.perfMark)perfMark('sw:register:start');
        navigator.serviceWorker.register('/sw.js').then(reg=>{
          if(window.perfMark){perfMark('sw:register:end');perfMeasure('sw.register','sw:register:start','sw:register:end');}
          if(window.perfLog)window.perfLog.push({name:'sw.register',ms:performance.now()-_tSw,t:performance.now(),success:true,scope:reg.scope});
          if(window.dbg)dbg.log('boot','service-worker registered ('+reg.scope+')');
        }).catch(err=>{
          if(window.perfMark){perfMark('sw:register:end');perfMeasure('sw.register','sw:register:start','sw:register:end');}
          if(window.perfLog)window.perfLog.push({name:'sw.register',ms:performance.now()-_tSw,t:performance.now(),success:false,error:String(err&&err.message||err)});
          if(window.dbg)dbg.warn('boot','service-worker register failed: '+err.message);
        });
      };
      if(window.requestIdleCallback){
        requestIdleCallback(_swRegister,{timeout:8000});
      }else{
        setTimeout(_swRegister,3000);
      }
    }
    if(window._perfAuto){
      // Programmatic test-API. Gebruikt dezelfde paden als de UI buttons,
      // maar zonder DOM-clicks (canvas + WebGL HUD overlays zijn lastig
      // klikbaar vanuit Playwright). Geen game-logica, alleen routing.
      window._perfHooks = {
        goToWorldSelect: ()=>{ try{ initAudio(); }catch(_){} goToWorldSelect(); },
        pickWorld: async (name)=>{
          // Mirrors _wireMenuButtons: rebuildWorld als de wereld verandert,
          // toon dan car-select scherm. Async sinds Fase 1C — moet wachten
          // op het wereld-script vóór rebuildWorld kan draaien.
          if(name && name!==window.activeWorld){
            if(typeof window.rebuildWorldAsync==='function'){
              await window.rebuildWorldAsync(name);
            }else{
              if(typeof window.loadWorldScript==='function'){
                try{ await window.loadWorldScript(name); }catch(_){}
              }
              await rebuildWorld(name);
            }
          }
          document.getElementById('sWorld').classList.add('hidden');
          window.gameState='SELECT';
          buildCarSelectUI();
          document.getElementById('sSelect').classList.remove('hidden');
        },
        startRace: ()=>{ goToRace(); },
        goToTitle: ()=>{ goToTitle(); },
        // Force GO direct als debugging-handvat (slaat 5×700ms staggered
        // light-sequence over). Niet standaard gebruikt door de runner —
        // we wachten liever op de echte countdown via 'go.toFirstFrame'.
        forceGo: ()=>{ /* placeholder, niet gebruikt */ },
      };
    }
  },50);
}
