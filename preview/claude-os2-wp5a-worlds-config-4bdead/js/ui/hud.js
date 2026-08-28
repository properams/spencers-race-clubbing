// js/ui/hud.js — non-module script.

'use strict';

// Position cache (uit main.js verhuisd) — leaderboard berekent posities
// niet elk frame; cache wordt elke ~10 ticks ververst in updateHUD.
let _posCache=[],_posTick=0;

// Leaderboard stability (uit main.js verhuisd). Posities flikkeren tijdens
// tie-races; we committen alleen na 0.4-0.5s stabiliteit.
//   _lastLeaderOrder  — laatst gecommitte volgorde-string
//   _leaderPendingKey — kandidaat-volgorde
//   _leaderStableT    — accumulator (commit bij >=0.5s)
//   _posStableValue / _posStableT — zelfde voor speler-positie (>=0.4s)
let _lastLeaderOrder='';
let _leaderPendingKey='',_leaderStableT=0;
let _posStableValue=0,_posStableT=0;
// _lastPPos: vorige speler-positie (voor overtake-detectie in updateHUD).
let _lastPPos=0;

// HUD-extra state (uit main.js verhuisd).
//   _currentGear  — display gear (audio/engine.js zet 'm in updateEngine).
//   _mmBounds     — cached minimap-bounds {mnX,mxX,mnZ,mxZ} per wereld.
//                   Geset in core/scene.js buildScene().
//   _mmFrameCtr   — minimap-redraw throttle (1 frame per 2 ticks).
let _currentGear=1;
let _mmBounds=null;
let _mmFrameCtr=0;

// Minimap scratch + cached lookups — hoisted out of drawMinimap() so the
// 30 fps redraw doesn't re-allocate them on every frame. _mmP0/_mmP1 are
// reused as targets for trackCurve.getPoint(t,target) which avoids a
// fresh Vector3 per segment (240 Vector3 per redraw × 30 fps was the
// largest per-frame allocation source in the HUD path).
const _mmP0=(typeof THREE!=='undefined')?new THREE.Vector3():null;
const _mmP1=(typeof THREE!=='undefined')?new THREE.Vector3():null;
const _MM_SECTOR_COLS=['rgba(255,90,90,.85)','rgba(80,220,90,.85)','rgba(90,140,255,.85)'];

// fmtTime: lap-time formatter, gebruikt door HUD + finish-screen + progression.
// const → script-scope binding; expliciet ook op window voor ES-module
// persistence/progression.js die window.fmtTime aanroept.
const fmtTime=s=>s<60?s.toFixed(2)+'s':Math.floor(s/60)+'m'+(s%60).toFixed(2)+'s';
window.fmtTime=fmtTime;

// HUD DOM-refs (uit main.js verhuisd) — gevuld door cacheHUDRefs() bij boot.
// Cross-script zichtbaar voor cars/physics.js, gameplay/race.js,
// gameplay/spacefx.js, gameplay/tracklimits.js, effects/visuals.js.
let _elSlip,_elWarn,_mapCvs,_mapCtx,_elGear,_elLeader;
let _elWrongWay=null;
// _elScore is opgegaan in finish-screen — geen race-HUD score meer.
let _elLapDelta=null;
// _elTire (oude separate tire-dot text) is opgegaan in _elTireT (4 csTire dots)
// die nu zowel temp als damage encoden. _elCarStatus is de panel-wrapper voor
// fade-in/out wanneer wear/temp uit het optimale venster komen.
let _elCarStatus=null;
// _elSector was dead code (nergens gevuld of gelezen) — verwijderd.
// Gap-display verwijderd in HUD-redesign: leaderboard toont al rij-1/rij+1
// rond de speler, dus een aparte gap-panel was dubbel-info.
let _elRpm=null;
let _elPos,_elPosOf,_elLap,_elSpd,_elNitro,_elNitroInd,_elNitroIndFill,_elLapTime,_elTireT,_elSecT,_elPitAvail,_elCloseBattle,_elFastestLapFlash;
let _elNemesis=null;
let _hudLastNemesisVisible=false;
// Verhuisd uit main.js — gevuld in cacheHUDRefs hieronder.
let _sectorPanelEl=null,_speedTrapEl=null;

function cacheHUDRefs(){
  // Reset textContent sentinels so a fresh race re-applies its first-frame
  // HUD text even if the previous race left them populated.
  _hudLastPosText='';_hudLastPosOfText='';_hudLastLapText='';
  _hudLastSecKey='';_hudLastGear=-1;_hudLastPosColor='';
  _hudLastPitDisplay='';_hudLastSpdCol='';
  // On mobile: hide performance-heavy HUD elements
  if(window._isMobile){
    // hudLeader stays a CSS-only hide so the L-hotkey can still un-hide it
    // via the .lShow override (handy on tablets with external keyboards).
    ['sectorPanel','hudCarStatus',
     'hudRainBtn','hudMuteBtn','ghostLabel',
     'closeBattleEl','speedTrapEl','mirrorFrame','mirrorLabel','speedLines'].forEach(id=>{
      const el=document.getElementById(id);if(el)el.style.display='none';
    });
    if(renderer)renderer.setPixelRatio(Math.min(devicePixelRatio,1));
  }
  _elPos=document.getElementById('hdPos');
  _elPosOf=document.getElementById('hdPosOf');
  _elLap=document.getElementById('hdLap');
  _elSpd=document.getElementById('hdSpd');
  _elNitro=document.getElementById('nitroFill');
  _elNitroInd=document.getElementById('tcNitro');
  _elNitroIndFill=document.getElementById('tcNitroFill');
  _elLapTime=document.getElementById('hdLapTime');
  _elSlip=document.getElementById('slipIndicator');
  _elWarn=document.getElementById('warnOverlay');
  _mapCvs=document.getElementById('mapCvs');
  _mapCtx=_mapCvs?_mapCvs.getContext('2d'):null;
  _elGear=document.getElementById('hdGear');
  _elLeader=document.getElementById('hudLeader');
  _elNemesis=document.getElementById('nemesisBadge');
  _elWrongWay=document.getElementById('wrongWayOverlay');
  _elLapDelta=document.getElementById('hdLapDelta');
  _elCarStatus=document.getElementById('hudCarStatus');
  _elRpm=document.getElementById('rpmFill');
  _sectorPanelEl=document.getElementById('sectorPanel');
  _speedTrapEl=document.getElementById('speedTrapEl');
  _elTireT={fl:document.getElementById('ttFL'),fr:document.getElementById('ttFR'),rl:document.getElementById('ttRL'),rr:document.getElementById('ttRR')};
  _elSecT=[document.getElementById('secT1'),document.getElementById('secT2'),document.getElementById('secT3')];
  _elPitAvail=document.getElementById('pitAvailable');
  _elCloseBattle=document.getElementById('closeBattleEl');
  _elFastestLapFlash=document.getElementById('fastestLapFlash');
}


// showPopup / showBanner / showBannerTop / hideBanner zijn nu thin wrappers
// rond window.Notify (zie js/ui/notifications.js + NOTIFICATIONS_PLAN.md).
// Externe call-sites (cars/physics.js, worlds/*, ui/input.js, gameplay/*)
// blijven werken zonder wijziging — ze raken automatisch de Notify-facade.

// _inferPopupPriority: classificeert een popup-string naar Notify-priority
// op basis van vaste tekst-patronen die throughout the codebase gebruikt
// worden. Hogere prioriteit overrulet lager (race-leader > overtake > hint).
function _inferPopupPriority(text){
  if(/RACE LEADER/i.test(text)) return 100;
  if(/FASTEST LAP/i.test(text)) return 90;
  if(/OVERTAKE/i.test(text))    return 60;
  if(/^▼\s*P\d/i.test(text))    return 50;
  if(/DRIFT|MINI TURBO|FRESH TYRES|TYRES WORN|NITRO/i.test(text)) return 50;
  if(/HARD LANDING|COLD TYRES/i.test(text)) return 40;
  if(/CAM|MIRROR|LEADERBOARD|PIT ENTRY/i.test(text)) return 30;
  return 40; // world hazards, generic
}

function showBannerTop(text,color,dur){
  if(!window.Notify){
    if(window.dbg)dbg.warn('notify','Notify niet ready, drop showBannerTop',text);
    return;
  }
  // tracklimits.js stuurt 'LAP n / N'; weather.js stuurt 'RAIN INCOMING' etc.
  // De eerste hoort in Zone B (subtiel, top-center), de tweede in Zone A.
  var m=/^LAP\s+(\d+)\s*\/\s*(\d+)/i.exec(text);
  if(m){ Notify.lap(+m[1],+m[2]); return; }
  Notify.status(text,{color:color,dur:dur||2000,priority:70});
}

function showPopup(text,color,dur=1000){
  if(!window.Notify){
    if(window.dbg)dbg.warn('notify','Notify niet ready, drop showPopup',text);
    return;
  }
  Notify.status(text,{color:color,dur:dur,priority:_inferPopupPriority(text)});
}

function showBanner(text,color,dur){
  if(!window.Notify){
    if(window.dbg)dbg.warn('notify','Notify niet ready, drop showBanner',text);
    return;
  }
  Notify.banner(text,color,dur);
}

// hideBanner: door tracklimits.js + spacefx.js gebruikt om een persistente
// banner (dur=0) expliciet te dismissen — vooral spacefx.js FALLING-banner
// die blijft staan tot triggerSpaceRecovery() 'm wegtrekt.
function hideBanner(){
  if(window.Notify && typeof Notify.hideBanner==='function') Notify.hideBanner();
}


function getPositions(){
  if(_posCache.length!==carObjs.length||(_posTick++%8===0)){
    _posCache.length=carObjs.length;
    for(let i=0;i<carObjs.length;i++)_posCache[i]=carObjs[i];
    _posCache.sort((a,b)=>{
      if(b.lap!==a.lap)return b.lap-a.lap;
      let ap=a.progress,bp=b.progress;
      if(Math.abs(bp-ap)>.5){if(ap<.5)ap+=1;else bp+=1;}
      return bp-ap;
    });
  }
  return _posCache;
}

// Player-rank helper — replaces getPositions().findIndex(c=>c.isPlayer)+1
// pattern at multiple call sites (achievements, loop, tracklimits, hud).
// findIndex with arrow callback allocates a closure per call; this helper
// uses a plain for-loop. Returns 1-indexed rank, or 0 if not found.
function _playerRank(){
  const pos=getPositions();
  for(let i=0;i<pos.length;i++)if(pos[i].isPlayer)return i+1;
  return 0;
}

// Per-frame HUD textContent sentinels — string concat for textContent runs
// on every frame in updateHUD. Skip the assign + the string alloc when the
// composed text is unchanged. Browsers don't always short-circuit a same-
// string textContent set (depends on engine), but skipping the concat is
// always a win.
let _hudLastPosText='',_hudLastPosOfText='',_hudLastLapText='';
let _hudLastSecKey='',_hudLastGear=-1,_hudLastPosColor='';
let _hudLastPitDisplay='',_hudLastSpdCol='';
// Speed + lap-time sentinels: voorheen writen we elke frame textContent op
// _elSpd (60Hz) en _elLapTime (composite string-alloc); sentinels droppen
// dat naar ~5Hz writes en elimineren de per-frame string-concat.
let _hudLastSpdVal=-1, _hudLastLtKey='';
// Per-tire sentinels — tire-temp dots used to share a single composite-key
// cache, which rewrote all 4 tires' background AND boxShadow whenever any
// one tire's quantized temp changed (~32 DOM writes/sec at racing speed).
// Splitting per-tire + a separate ringCol cache reduces this to 0-2 writes
// per frame in the common case (one tire moving, ring colour stable).
let _hudLastTireT_fl=NaN, _hudLastTireT_fr=NaN, _hudLastTireT_rl=NaN, _hudLastTireT_rr=NaN;
let _hudLastTireRingCol='';


function updateHUD(dt){
  const car=carObjs[playerIdx];if(!car)return;
  const pos=getPositions(),pPos=_playerRank();
  // textContent + style.color: only write when the displayed value actually
  // changes. pPos / carObjs.length / car.lap all change rarely vs 60 fps.
  const _posText='P'+pPos;
  if(_posText!==_hudLastPosText){_hudLastPosText=_posText;_elPos.textContent=_posText;}
  const _posColor = pPos===1 ? 'var(--hud-success)'
                  : pPos<=3 ? 'var(--hud-accent)'
                  : pPos>=6 ? 'var(--hud-warning)'
                  : 'var(--hud-text)';
  if(_posColor!==_hudLastPosColor){_hudLastPosColor=_posColor;_elPos.style.color=_posColor;}
  const _posOfText='/'+carObjs.length;
  if(_posOfText!==_hudLastPosOfText){_hudLastPosOfText=_posOfText;_elPosOf.textContent=_posOfText;}
  const _lapText=Math.max(1,Math.min(car.lap,TOTAL_LAPS))+' / '+TOTAL_LAPS;
  if(_lapText!==_hudLastLapText){_hudLastLapText=_lapText;_elLap.textContent=_lapText;}
  // 165 → Ferrari≈196 km/h, F1≈223 km/h, max boost cap 380
  const _spdVal=Math.min(380,Math.round(Math.abs(car.speed)*165));
  if(_spdVal!==_hudLastSpdVal){_hudLastSpdVal=_spdVal;_elSpd.textContent=_spdVal;}
  if(_elLapTime){
    const elapsed=_nowSec-lapStartTime;
    // Composite-key sentinel: pas wegschrijven als óf elapsed óf best-lap
    // op .toFixed(2)-niveau wijzigt. Skipt ~95% van frames de fmtTime +
    // string-concat (' · ' allocatie) tijdens nitro/long-laps.
    const _ltKey=elapsed.toFixed(2)+'|'+(bestLapTime<Infinity?bestLapTime.toFixed(2):'-');
    if(_ltKey!==_hudLastLtKey){
      _hudLastLtKey=_ltKey;
      _elLapTime.textContent=fmtTime(elapsed)+(bestLapTime<Infinity?' · '+fmtTime(bestLapTime):'');
    }
  }
  // Lap delta vs personal best
  if(_elLapDelta&&car._lapStart&&bestLapTime<Infinity){
    const elapsed2=_nowSec-car._lapStart;
    const delta=elapsed2-bestLapTime;
    const sign=delta>=0?'+':'';
    _elLapDelta.textContent=sign+delta.toFixed(2);
    _elLapDelta.style.color=delta<0?'var(--hud-success)':'var(--hud-warning)';
  }
  // Sessie 05 — nemesis badge: rendered when the nemesis is within
  // ~30m of the player OR sits in the top 3 finishing positions.
  // Only writes DOM when visibility transitions to avoid layout work.
  if(_elNemesis && typeof _nemesisIdx!=='undefined' && _nemesisIdx>=0){
    const nem = carObjs[_nemesisIdx];
    let show = false, label = '';
    if(nem && !nem.finished){
      const dx = car.mesh.position.x - nem.mesh.position.x;
      const dz = car.mesh.position.z - nem.mesh.position.z;
      const dist2 = dx*dx + dz*dz;
      const nemRank = pos.findIndex(c => c === nem) + 1;
      if(dist2 < 900 || nemRank <= 3){
        show = true;
        const p = nem._personality || {};
        label = (p.emoji || '⚠') + ' ' + (p.name || 'RIVAL').toUpperCase();
      }
    }
    if(show !== _hudLastNemesisVisible){
      _hudLastNemesisVisible = show;
      _elNemesis.style.display = show ? 'block' : 'none';
    }
    if(show) _elNemesis.textContent = label;
  }
  // Car status: 4 tyre dots, dual-encoded (inner=temp, ring=damage).
  // Panel auto-fades in when wear>=30% or any tyre is outside the optimal
  // window. Stays hidden during a clean drive so it doesn't add visual noise.
  if(_elCarStatus&&_elTireT){
    const w=car.tireWear||0;
    const hits=car.hitCount||0;
    const dmg=Math.max(w,Math.min(1,hits/9));
    // Damage ring: green (clean) → amber (worn) → red (critical)
    const ringCol = dmg<.35 ? 'var(--hud-success)'
                  : dmg<.7  ? 'var(--hud-accent)'
                              : 'var(--hud-warning)';
    // Cold/optimal/hot fill per wheel
    const tireFill=t=>{
      if(t<0.28)return'var(--hud-primary)';   // cold
      if(t<0.65)return'var(--hud-success)';   // optimal
      if(t<0.85)return'var(--hud-accent)';    // hot
      return'var(--hud-warning)';              // overheated
    };
    const tempBad = _tireTemp.fl<0.28||_tireTemp.fr<0.28||_tireTemp.rl<0.28||_tireTemp.rr<0.28
                  ||_tireTemp.fl>0.65||_tireTemp.fr>0.65||_tireTemp.rl>0.65||_tireTemp.rr>0.65;
    const showStatus = dmg>=0.30 || tempBad;
    _elCarStatus.classList.toggle('csOn',showStatus);
    // Per-tire sentinels (quantized to step 0.125 via Math.round*8) — each
    // tire's background only gets rewritten when its OWN quantized temp
    // changes. ringCol (shared across all 4) is tracked separately so a
    // colour change updates 4 boxShadows in one frame, then stays cached.
    // Replaces the previous composite-key approach that thrashed all 4
    // tires whenever any one moved (~32 DOM writes/sec → typically 0-2).
    const qFl = Math.round(_tireTemp.fl*8);
    const qFr = Math.round(_tireTemp.fr*8);
    const qRl = Math.round(_tireTemp.rl*8);
    const qRr = Math.round(_tireTemp.rr*8);
    if(_elTireT.fl && qFl !== _hudLastTireT_fl){ _hudLastTireT_fl = qFl; _elTireT.fl.style.background = tireFill(_tireTemp.fl); }
    if(_elTireT.fr && qFr !== _hudLastTireT_fr){ _hudLastTireT_fr = qFr; _elTireT.fr.style.background = tireFill(_tireTemp.fr); }
    if(_elTireT.rl && qRl !== _hudLastTireT_rl){ _hudLastTireT_rl = qRl; _elTireT.rl.style.background = tireFill(_tireTemp.rl); }
    if(_elTireT.rr && qRr !== _hudLastTireT_rr){ _hudLastTireT_rr = qRr; _elTireT.rr.style.background = tireFill(_tireTemp.rr); }
    if(ringCol !== _hudLastTireRingCol){
      _hudLastTireRingCol = ringCol;
      const shadow = '0 0 0 2px ' + ringCol;
      if(_elTireT.fl) _elTireT.fl.style.boxShadow = shadow;
      if(_elTireT.fr) _elTireT.fr.style.boxShadow = shadow;
      if(_elTireT.rl) _elTireT.rl.style.boxShadow = shadow;
      if(_elTireT.rr) _elTireT.rr.style.boxShadow = shadow;
    }
  }
  // Sector panel update — delta-gated. Sector bests change a handful of
  // times per race; rewriting textContent every frame was pure waste.
  if(_elSecT){
    const _b0=_sectorBests[0],_b1=_sectorBests[1],_b2=_sectorBests[2];
    const _secKey=(_b0<Infinity?_b0.toFixed(2):'-')+'|'+(_b1<Infinity?_b1.toFixed(2):'-')+'|'+(_b2<Infinity?_b2.toFixed(2):'-');
    if(_secKey!==_hudLastSecKey){
      _hudLastSecKey=_secKey;
      const _bs=[_b0,_b1,_b2];
      for(let s=0;s<3;s++){
        const el=_elSecT[s];if(!el)continue;
        const best=_bs[s];
        if(best<Infinity){el.textContent=best.toFixed(2)+'s';el.style.color='var(--gold)';}
        else{el.textContent='--.-';el.style.color='var(--text-dim)';}
      }
    }
  }
  // Pit available indicator (only show once, when car is near pit zone and hasn't pitted yet).
  // Display sentinel collapses the per-frame style.display write to once-per-state-transition.
  if(_elPitAvail){
    let _pitWant='none';
    if(car&&!_pitStopUsed&&!_pitStopActive&&car.lap>1){
      const pz=car.mesh.position.z,px=car.mesh.position.x;
      _pitWant=(pz>160&&pz<220&&px>-200&&px<190)?'block':'none';
    }
    if(_pitWant!==_hudLastPitDisplay){_hudLastPitDisplay=_pitWant;_elPitAvail.style.display=_pitWant;}
  }
  // Speed color on speedometer — discrete 4-band; sentinel skips repeats.
  if(_elSpd){
    const speedRatio=Math.abs(car.speed)/(car.def.topSpd*1.55);
    const _spdCol=speedRatio>.85?'var(--hud-warning)':speedRatio>.6?'var(--peach)':speedRatio>.35?'var(--gold)':'var(--hud-accent)';
    if(_spdCol!==_hudLastSpdCol){_hudLastSpdCol=_spdCol;_elSpd.style.color=_spdCol;}
  }
  // Position change notification — only fire after position is stable for 0.4s
  // This prevents spam when cars jostle each other closely
  if(pPos!==_posStableValue){
    _posStableValue=pPos;_posStableT=0; // new candidate position, start timer
  }else if(_lastPPos&&pPos!==_lastPPos&&dt){
    _posStableT+=dt;
    if(_posStableT>=0.4){
      // Position has been stable for 0.4s — commit it
      if(pPos<_lastPPos){
        if(pPos===1){
          // Vóór Notify-refactor schreef showPopup naar #popupMsg en showBanner
          // naar #bannerOverlay (twee verschillende DOM-zones, beide zichtbaar).
          // Notify is single-slot per zone; één enkele LEADER-status volstaat.
          showPopup('🏆 P1 — RACE LEADER!','#ffd000',2400);
          totalScore+=150;
          beep(880,.1,.42,0,'square');beep(1320,.08,.38,.1,'square');beep(1760,.12,.32,.2,'square');
          Audio.playCrowdCheer();setTimeout(()=>Audio.playCrowdCheer(),200);setTimeout(()=>Audio.playCrowdCheer(),400);
          if(_crowdGain&&audioCtx){_crowdGain.gain.setTargetAtTime(0.09,audioCtx.currentTime,.1);setTimeout(()=>{if(_crowdGain&&audioCtx)_crowdGain.gain.setTargetAtTime(0.062,audioCtx.currentTime,1.2);},1500);}
        }else{
          showPopup('▲ P'+pPos+' OVERTAKE!','#3affd0',1400);
          triggerCombo('OVERTAKE');
          totalScore+=50;
          Audio.playCrowdCheer();
        }
        // Floating "▲ P"/"▼ P" label removed — position is permanently shown
        // in the race-info panel and posPulse already animates the change.
      }else{
        showPopup('▼ P'+pPos,'#ff3a8a',1200);
      }
      if(_elPos){_elPos.classList.remove('posPulse');void _elPos.offsetWidth;_elPos.classList.add('posPulse');}
      _lastPPos=pPos;
    }
  }else{
    _posStableT=0; // position matches _lastPPos — reset candidate timer
  }
  if(!_lastPPos)_lastPPos=pPos; // init on first frame
  // Gear indicator — delta-gated; gear flips once per ~2-5 km/h band.
  if(_elGear&&_currentGear!==_hudLastGear){_hudLastGear=_currentGear;_elGear.textContent=_currentGear;}
  // Live leaderboard — only rebuild HTML when order is stable for 0.5s
  // Prevents P1/P2/P3 rows from constantly jumping when cars jostle.
  // Default state is "collapsed": top-3 + driver above/below player + player.
  // Hotkey L (handled in ui/input.js) flips window._leaderExpanded to show all.
  if(_elLeader&&dt){
    const expanded=!!window._leaderExpanded;
    // On mobile, .lShow overrides the CSS display:none so the L-hotkey
    // still works for users with an external keyboard.
    _elLeader.classList.toggle('lShow',expanded);
    // Include the expanded flag in the cache-key so a toggle forces a rebuild.
    const key=pos.map(c=>c.def.id).join(',')+(expanded?':E':':C');
    if(key!==_leaderPendingKey){
      _leaderPendingKey=key;_leaderStableT=0;
    }else if(key!==_lastLeaderOrder){
      // Manual toggle should feel instant — no 0.5s wait when only the flag flipped.
      const orderChanged=key.replace(/:[EC]$/,'')!==_lastLeaderOrder.replace(/:[EC]$/,'');
      _leaderStableT = orderChanged ? _leaderStableT+dt : 0.5;
      if(_leaderStableT>=0.5){
        _lastLeaderOrder=key;_leaderStableT=0;
        const refTime=bestLapTime<Infinity?bestLapTime:55;
        const leader=pos[0];
        const pIdx=pos.findIndex(c=>c.isPlayer);
        // Decide which row indices to render.
        let rowIdx;
        if(expanded||pos.length<=5){
          rowIdx=pos.map((_,i)=>i);
        }else{
          // Always include podium + player + the cars directly ahead/behind player.
          const set=new Set([0,1,2]);
          if(pIdx>=0){set.add(pIdx);if(pIdx>0)set.add(pIdx-1);if(pIdx<pos.length-1)set.add(pIdx+1);}
          rowIdx=[...set].sort((a,b)=>a-b);
        }
        const rowFor=i=>{
          const c=pos[i];
          let gapStr;
          if(i===0){gapStr='<span class="lGap">LEAD</span>';}
          else{
            const lapDiff=leader.lap-c.lap;
            const progGap=leader.progress-c.progress;
            if(lapDiff>=1){
              gapStr=`<span class="lGap">+${lapDiff}LAP</span>`;
            }else{
              const secGap=Math.max(0,(lapDiff+progGap)*refTime);
              gapStr=secGap<0.5?'<span class="lGap" style="color:var(--hud-warning)">BATTLE</span>':`<span class="lGap">+${secGap.toFixed(1)}s</span>`;
            }
          }
          return `<div class="lRow${c.isPlayer?' lMe':''}"><span class="lPos">P${i+1}</span><span class="lName">${c.def.name}</span>${gapStr}</div>`;
        };
        const parts=[];
        for(let k=0;k<rowIdx.length;k++){
          if(k>0&&rowIdx[k]-rowIdx[k-1]>1)parts.push('<div class="lSep">···</div>');
          parts.push(rowFor(rowIdx[k]));
        }
        _elLeader.innerHTML=parts.join('');
      }
    }
  }
  _mmFrameCtr=(_mmFrameCtr||0)+1;if(_mmFrameCtr%2===0)drawMinimap(pos);
}


// Build a static offscreen canvas with everything the minimap renders that
// does not change during a race: asphalt road-ribbon, sector tint, racing-
// line outline, start + pit markers, jump/boost/spin dots, FINISH compass.
// Blitted with one drawImage per frame; only player + AI dots + active-
// sector glow are drawn dynamically on top.
//
// Cache invalidation: keyed on (W, H, trackCurve identity). buildScene()
// builds a fresh CatmullRomCurve3 per world-switch, so the trackCurve
// identity check rebuilds the layer when a new world loads. drawMinimap
// also resizes cvs.width/height to match clientWidth × dpr; that resize
// changes W/H and triggers a rebuild for mobile vs desktop.
function _buildMinimapStaticLayer(W,H,isCompact,isWide){
  const cache=drawMinimap._staticCvs;
  if(cache&&cache.width===W&&cache.height===H&&cache._trackRef===trackCurve&&cache._compactFlag===isCompact)return cache;
  const off=document.createElement('canvas');
  off.width=W;off.height=H;
  off._trackRef=trackCurve;
  off._compactFlag=isCompact;
  const ctx=off.getContext('2d');
  const {mnX,mxX,mnZ,mxZ}=_mmBounds||{mnX:-400,mxX:400,mnZ:-275,mxZ:275};
  const pad=isCompact?10:16,topPad=isWide?22:pad;
  const sc=Math.min((W-pad*2)/(mxX-mnX),(H-topPad-pad)/(mxZ-mnZ));
  const ox=pad+(W-pad*2-(mxX-mnX)*sc)*.5-mnX*sc,oz=topPad+(H-topPad-pad-(mxZ-mnZ)*sc)*.5-mnZ*sc;
  const mx=x=>ox+x*sc,mz=z=>oz+z*sc;
  // Stash transform in the cache so drawMinimap can reuse it for cars +
  // glow without recomputing.
  off._tx={ox,oz,sc,pad,topPad,mnX,mxX,mnZ,mxZ};
  // 1. Asphalt base ribbon (single closed path — cheaper than per-segment).
  const N=220;
  const baseW=isCompact?5.5:8.5;
  ctx.beginPath();ctx.strokeStyle='rgba(38,40,52,.95)';ctx.lineWidth=baseW;ctx.lineCap='round';ctx.lineJoin='round';
  for(let si=0;si<=N;si++){
    trackCurve.getPoint(si/N,_mmP0);
    if(si===0)ctx.moveTo(mx(_mmP0.x),mz(_mmP0.z));else ctx.lineTo(mx(_mmP0.x),mz(_mmP0.z));
  }
  ctx.stroke();
  // 2. Sector tint stripes (thin, on top of asphalt). Active-sector glow is
  //    drawn per-frame in drawMinimap so it can follow the player.
  const tintW=isCompact?2.2:3.2;
  for(let si=0;si<N;si++){
    const t0=si/N,t1=(si+1)/N;
    trackCurve.getPoint(t0,_mmP0);trackCurve.getPoint(t1,_mmP1);
    const sec=t0<.333?0:t0<.667?1:2;
    ctx.beginPath();ctx.strokeStyle=_MM_SECTOR_COLS[sec];ctx.lineWidth=tintW;ctx.lineCap='round';
    ctx.moveTo(mx(_mmP0.x),mz(_mmP0.z));ctx.lineTo(mx(_mmP1.x),mz(_mmP1.z));ctx.stroke();
  }
  // 3. Thin white outline on top — the racing-line.
  ctx.beginPath();ctx.strokeStyle='rgba(240,240,250,.5)';ctx.lineWidth=1;ctx.lineCap='round';ctx.lineJoin='round';
  for(let si=0;si<=N;si++){
    trackCurve.getPoint(si/N,_mmP0);
    if(si===0)ctx.moveTo(mx(_mmP0.x),mz(_mmP0.z));else ctx.lineTo(mx(_mmP0.x),mz(_mmP0.z));
  }
  ctx.stroke();
  // 4. Start/finish line + "S" label.
  const stX=mx(TRACK_WP[0][0]),stZ=mz(TRACK_WP[0][1]);
  ctx.fillStyle='#fff';ctx.fillRect(stX-(isCompact?4:6),stZ-(isCompact?1.5:2),isCompact?8:12,isCompact?3:4);
  if(isWide){ctx.font='bold 8px Orbitron,Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='rgba(255,255,255,.85)';ctx.fillText('S',stX,stZ-9);}
  // 5. Pit zone marker.
  const piX=mx(-60),piZ=mz(190);
  ctx.fillStyle='rgba(0,255,100,.6)';ctx.fillRect(piX-4,piZ-2,8,4);
  if(isWide){ctx.font='bold 7px Orbitron,Arial';ctx.fillStyle='rgba(120,255,160,.85)';ctx.fillText('PIT',piX,piZ+9);}
  // 6. Special objects (jumps / boosts / spin pads).
  const dotR=isCompact?1.8:2.6;
  ctx.fillStyle='#ffd4a8';
  for(let i=0;i<jumpRamps.length;i++){const r=jumpRamps[i];ctx.beginPath();ctx.arc(mx(r.pos.x),mz(r.pos.z),dotR,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle='#a8d4ff';
  for(let i=0;i<boostPads.length;i++){const p=boostPads[i];ctx.beginPath();ctx.arc(mx(p.pos.x),mz(p.pos.z),dotR-.4,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle='#d4a8ff';
  for(let i=0;i<spinPads.length;i++){const p=spinPads[i];ctx.beginPath();ctx.arc(mx(p.pos.x),mz(p.pos.z),dotR-.4,0,Math.PI*2);ctx.fill();}
  // 7. Compass tick at the top of the map (wide-only).
  if(isWide){
    ctx.font='bold 8px Orbitron,Arial';ctx.textAlign='center';ctx.textBaseline='top';
    ctx.fillStyle='rgba(255,180,80,.85)';
    ctx.fillText('▲ FINISH',W*.5,4);
  }
  drawMinimap._staticCvs=off;
  return off;
}

function drawMinimap(pos){
  const cvs=_mapCvs||document.getElementById('mapCvs'),ctx=_mapCtx||(cvs&&cvs.getContext('2d'));
  if(!cvs||!ctx)return;
  // Match canvas-pixel buffer to displayed CSS size × dpr so mobile maps
  // aren't a stretched copy of the 260×200 desktop bitmap. Resize is a
  // no-op when dimensions match. dpr capped at 2 to keep cost bounded.
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const cssW=cvs.clientWidth||cvs.width,cssH=cvs.clientHeight||cvs.height;
  const wantW=Math.round(cssW*dpr),wantH=Math.round(cssH*dpr);
  if(wantW>0&&wantH>0&&(cvs.width!==wantW||cvs.height!==wantH)){cvs.width=wantW;cvs.height=wantH;}
  const W=cvs.width,H=cvs.height;ctx.clearRect(0,0,W,H);
  // Compact rules driven by CSS pixels so dpr doesn't fool the layout check.
  const isCompact=cssW<150||cssH<110;
  const isWide=cssW>=180;
  // Static-layer blit covers track + markers + compass + special dots.
  const _layer=_buildMinimapStaticLayer(W,H,isCompact,isWide);
  if(_layer)ctx.drawImage(_layer,0,0);
  // Reuse the transform stashed on the cached layer instead of recomputing.
  const _tx=_layer&&_layer._tx;
  if(!_tx)return;
  const sc=_tx.sc,oxT=_tx.ox,ozT=_tx.oz;
  const mx=x=>oxT+x*sc,mz=z=>ozT+z*sc;
  // Active-sector glow (player-dependent, can't live in the static cache).
  let playerCar=null;
  for(let i=0;i<pos.length;i++)if(pos[i].isPlayer){playerCar=pos[i];break;}
  if(playerCar){
    const playerSec=playerCar.progress<.333?0:playerCar.progress<.667?1:2;
    const tStart=playerSec*.333,tEnd=playerSec===2?1:(playerSec+1)*.333;
    const glowW=isCompact?2.8:4;
    ctx.shadowColor=_MM_SECTOR_COLS[playerSec];ctx.shadowBlur=isCompact?4:7;
    ctx.strokeStyle=_MM_SECTOR_COLS[playerSec];ctx.lineWidth=glowW;ctx.lineCap='round';
    ctx.beginPath();
    // Sample only this sector's slice of the curve (~73 segments for the
    // wider sector); keeps the per-frame cost bounded.
    const SN=isCompact?40:74;
    for(let i=0;i<=SN;i++){
      const t=tStart+(tEnd-tStart)*(i/SN);
      trackCurve.getPoint(t,_mmP0);
      if(i===0)ctx.moveTo(mx(_mmP0.x),mz(_mmP0.z));else ctx.lineTo(mx(_mmP0.x),mz(_mmP0.z));
    }
    ctx.stroke();
    ctx.shadowBlur=0;
  }
  if(!drawMinimap._pts)drawMinimap._pts=new Array(16);
  const mmPts=drawMinimap._pts;
  for(let i=0;i<pos.length;i++){
    if(!mmPts[i])mmPts[i]={car:null,px:0,pz:0,rank:i+1};
    mmPts[i].car=pos[i];mmPts[i].px=mx(pos[i].mesh.position.x);mmPts[i].pz=mz(pos[i].mesh.position.z);mmPts[i].rank=i+1;
  }
  const mmLen=pos.length;
  // Car-dot radii scale with canvas size.
  const aiR=isCompact?2.6:4,plR=isCompact?5:7;
  // Render dots back-to-front so P1 is on top of P13.
  for(let ri=mmLen-1;ri>=0;ri--){const{car,px,pz}=mmPts[ri];
    // Cache hex-color string op car.def — voorheen elke draw-call per car
    // toString(16) + padStart, ~16 string allocs per minimap-frame.
    const col=car.def._cachedHexColor||(car.def._cachedHexColor='#'+car.def.color.toString(16).padStart(6,'0'));
    if(car.isPlayer){
      ctx.shadowColor='#ff3a8a';ctx.shadowBlur=isCompact?6:10;
      ctx.beginPath();ctx.arc(px,pz,plR,0,Math.PI*2);ctx.fillStyle='#ff3a8a';ctx.fill();
      ctx.strokeStyle='#fff';ctx.lineWidth=isCompact?1.3:1.8;ctx.stroke();
      ctx.shadowBlur=0;
      // Heading arrow — bigger on wide maps.
      const ry=car.mesh.rotation.y;
      const fx=-Math.sin(ry),fy=-Math.cos(ry);
      const rx=-fy,rz=fx;
      const L=isCompact?8:14,ws=isCompact?3.5:6.2;
      ctx.beginPath();
      ctx.moveTo(px+fx*L,pz+fy*L);
      ctx.lineTo(px-fx*3+rx*ws,pz-fy*3+rz*ws);
      ctx.lineTo(px-fx*3-rx*ws,pz-fy*3-rz*ws);
      ctx.closePath();
      ctx.fillStyle='#ffe0a8';ctx.fill();
      ctx.strokeStyle='#7a3a00';ctx.lineWidth=isCompact?1:1.4;ctx.stroke();
    }else{
      ctx.beginPath();ctx.arc(px,pz,aiR,0,Math.PI*2);ctx.fillStyle=col;ctx.fill();
      ctx.strokeStyle='rgba(0,0,0,.6)';ctx.lineWidth=1;ctx.stroke();
    }
  }
  // Position labels — show all on wide map, top-3 + player on compact.
  ctx.font=isCompact?'bold 7px Arial':'bold 9px Orbitron,Arial';
  ctx.textAlign='center';ctx.textBaseline='middle';
  const labelRadius=isCompact?9:13;
  for(let i=0;i<mmLen;i++){const{car,px,pz,rank}=mmPts[i];
    // Cull on compact maps: only player + top 3.
    if(isCompact && !car.isPlayer && rank>3) continue;
    const label='P'+rank;
    let lox=0,loy=isCompact?-9:-13;
    // Spread labels outward when crowded.
    let crowded=false;
    for(let j=0;j<mmLen;j++){if(j!==i){const dpx=px-mmPts[j].px,dpz=pz-mmPts[j].pz;if(dpx*dpx+dpz*dpz<(isCompact?100:225))crowded=true;}}
    if(crowded){
      const ang=Math.atan2(pz-H*.5,px-W*.5);
      lox=Math.cos(ang)*labelRadius;loy=Math.sin(ang)*labelRadius;
    }
    const lx=px+lox,ly=pz+loy;
    ctx.fillStyle='rgba(0,0,0,.78)';ctx.fillText(label,lx+1,ly+1);
    ctx.fillStyle=car.isPlayer?'#ffd4a8':'rgba(245,245,250,.92)';
    ctx.fillText(label,lx,ly);
  }
}

