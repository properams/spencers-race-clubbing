// js/ui/navigation.js — non-module script.

'use strict';

// Perf Phase A: heap-snapshot helper. Pusht event-naam + heap MB naar
// window.perfLog. No-op als performance.memory niet beschikbaar (Safari/FF).
//
// Sinds claude/perf-safe-wins ook een renderer.info snapshot (geometries +
// textures + program-count) zodat heap-trends los van JS-heap analyseerbaar
// zijn. Alle kosten zijn no-op als renderer/perf-memory niet bestaat.
function _perfHeap(eventName){
  if(!window.perfLog)return;
  if(performance.memory){
    const mb=+(performance.memory.usedJSHeapSize/1048576).toFixed(2);
    window.perfLog.push({name:'heap.'+eventName,ms:mb,t:performance.now()});
    if(window.dbg)dbg.log('perf','heap@'+eventName+': '+mb+'MB');
  }
  if(window.renderer&&window.renderer.info){
    const ri=window.renderer.info;
    window.perfLog.push({
      name:'rendererInfo.'+eventName,
      ms:0,
      t:performance.now(),
      geometries:ri.memory.geometries,
      textures:ri.memory.textures,
      programs:(ri.programs&&ri.programs.length)||0,
    });
  }
}

async function goToSelect(){
  if(gameState!=='TITLE')return;
  // Title-first boot: buildScene draait op de achtergrond. Als de user
  // sneller op ENTER LIGHT tikt dan de scene-build kan finishen, wachten
  // we hier met de world-loading overlay zichtbaar voor visuele feedback.
  // Promise is meestal al resolved tegen de tijd dat user klikt; in dat
  // geval is dit een microtask-cycle (~0ms).
  let _showedOverlay=false;
  if(window.__bootScenePromise){
    if(window.SrcLoader){window.SrcLoader.showWorldLoader();_showedOverlay=true;}
    try{ await window.__bootScenePromise; }catch(_){}
  }
  gameState='SELECT';initAudio();startMenuMusic();
  // Clear stale framebuffer: render-loop slaat SELECT over (loop.js
  // _idleSkip); zonder clear schemert het laatste TITLE fly-cam frame door
  // de overlay heen tot de volgende daadwerkelijke render.
  try{ if(typeof renderer!=='undefined'&&renderer&&renderer.clear){ const _pt=renderer.getRenderTarget?renderer.getRenderTarget():null; renderer.setRenderTarget(null); renderer.clear(true,true,true); if(_pt!==null) renderer.setRenderTarget(_pt); } }catch(_){}
  setTouchControlsVisible(false);
  document.getElementById('sTitle').classList.add('hidden');
  // Paint de overlay één frame vóór de synchrone bakeAllCarSnapshots zodat
  // de spinner zichtbaar is tijdens de ~200ms car-preview bake.
  if(_showedOverlay){
    await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
  }
  // Wacht ook op data-fetch — anders rendert carGrid leeg als de user op
  // ENTER LIGHT klikt terwijl data/cars.json nog onderweg is. Promise is
  // bijna altijd al resolved (data fetch start in <head> vóór scripts
  // parsen), maar bij slow network kan deze race anders een lege linker
  // kolom geven in het select scherm.
  if(window.__gameDataPromise){
    try{ await window.__gameDataPromise; }catch(_){}
  }
  buildCarSelectUI();
  // Default-highlight first unlocked car (top-left) on every entry, so the
  // rim is predictable instead of mirroring the saved selCarId. The card's
  // existing onclick syncs .sel + _selectPreviewCar in one step.
  const _firstCar=document.querySelector('#carGrid .carCard:not(.locked)');
  if(_firstCar)_firstCar.click();
  document.getElementById('sSelect').classList.remove('hidden');
  if(window.SrcLoader)window.SrcLoader.hideWorldLoader();
  _perfHeap('goToSelect');
  if(window.Breadcrumb)Breadcrumb.push('goToSelect');
}

// Een rAF-promise: yield één browser-frame zodat layout/paint kan flushen
// tussen de zware async-fases van goToRace. Gebruikt om de overlay-paint
// te garanderen vóór makeAllCars en om elke fase een breathing-frame te
// geven zodat de spinner-animatie vloeiend blijft tussen GPU-stalls.
const _nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

// ─── Race pre-warm helpers ──────────────────────────────────────────────
//
// De helpers hieronder zijn de "alles uit de kast"-eindfix voor de twee
// resterende freezes: ~5s na "GO!" en korte hangs bij hoge jumps. Beide
// freezes worden gedomineerd door GPU shader-link kosten op het 1e race-
// frame (chase-cam frustum) of het 1e airborne-frame (hoge view-pose).
// Door identieke render-passes uit te voeren vanuit alle relevante poses
// VÓÓR de countdown start, dwingen we de driver om alle shader-permu-
// taties tijdens de overlay-fase te linken (waar de overlay het maskeert).
//
// Hot-path side-allocaties (SampleEngine, audio chains, particle pools,
// HUD DOM writes, world ambient drones) worden via aparte helpers ook
// naar de overlay-fase verschoven.

// Helper: scratch-vectors voor pose-berekeningen (vermijdt per-call alloc).
const _wrV1 = (typeof THREE !== 'undefined') ? new THREE.Vector3() : null;
const _wrV2 = (typeof THREE !== 'undefined') ? new THREE.Vector3() : null;

// Helper: render één pose door de volledige (postFX of bare) render-pipeline.
// Forceert shader-link voor de objecten die in deze frustum zichtbaar zijn.
// pose = { posX,posY,posZ, lookX,lookY,lookZ, fov, rotYDelta? } in WORLD-coords.
// rotYDelta is alleen voor pose D (mirror) — we draaien de camera om i.p.v.
// lookAt om de exacte mirror-cam orientatie te mimicken.
function _warmRenderOnePose(player, pose){
  if(!camera || !renderer || !scene) return;
  camera.position.set(pose.posX, pose.posY, pose.posZ);
  if(pose.rotYDelta != null){
    // Mirror-mode: copy car rotation + flip 180°. Mimickt updateMirror() exact.
    camera.rotation.copy(player.mesh.rotation);
    camera.rotation.y += pose.rotYDelta;
  } else {
    _wrV1.set(pose.lookX, pose.lookY, pose.lookZ);
    camera.lookAt(_wrV1);
  }
  camera.fov = pose.fov;
  camera.updateProjectionMatrix();
  try {
    if(typeof renderWithPostFX === 'function') renderWithPostFX(scene, camera);
    else renderer.render(scene, camera);
  } catch(e){
    if(window.dbg) dbg.warn('perf','warm-pose render failed: ' + (e && e.message || e));
  }
}

// Multi-pose warm-render: rendert 4 poses (intro, chase, lucht, mirror) zodat
// elke verwachte view-frustum tijdens de race vooraf gewarmd is. Camera-state
// na afloop: laatste pose. Caller (goToRace) zet 'm daarna terug naar intro.
function _warmRenderMultiPose(player){
  if(!camera || !renderer || !scene || !player || !player.mesh) return;
  const px = player.mesh.position.x;
  const py = player.mesh.position.y;
  const pz = player.mesh.position.z;
  // Offset-vectors via car-quaternion zodat de pose mee-roteert met grid-
  // oriëntatie. Forward = -Z in car-local space.
  const q = player.mesh.quaternion;

  // Pose A — intro/overhead (al gerenderd vóór deze call, maar voor de
  // zekerheid herhalen we 'm zodat de eerste warmrender met de juiste
  // depth/color targets ge-init is).
  _wrV1.set(0,35,25).applyQuaternion(q);
  _wrV2.set(0,2,-2).applyQuaternion(q);
  _warmRenderOnePose(player, {
    posX: px+_wrV1.x, posY: py+_wrV1.y, posZ: pz+_wrV1.z,
    lookX: px+_wrV2.x, lookY: py+_wrV2.y, lookZ: pz+_wrV2.z,
    fov: 80
  });

  // Pose B — chase-cam vanaf grid (mimickt eerste race-frame). Offsets en
  // baseFov gespiegeld uit camera.js:181-238 zodat het frustum exact
  // matcht; een mismatch hier laat shader-permutaties alsnog compileren in
  // het 1e RACE-frame na "GO!".
  const _wrAsp = camera.aspect || (innerWidth/innerHeight);
  const _wrPortrait = _wrAsp < 1;
  if(_wrPortrait) _wrV1.set(0,4.6,10.5);
  else            _wrV1.set(0,5.8,13.5);
  _wrV1.applyQuaternion(q);
  _wrV2.set(0,0.8,-7).applyQuaternion(q);
  let _wrBaseFov;
  if(_wrPortrait){
    _wrBaseFov = window._isMobile?72:68;
  }else{
    const _wrHFOV = window._isMobile?96:92;
    _wrBaseFov = 2*Math.atan(Math.tan(_wrHFOV*Math.PI/360)/_wrAsp)*180/Math.PI;
  }
  _warmRenderOnePose(player, {
    posX: px+_wrV1.x, posY: py+_wrV1.y, posZ: pz+_wrV1.z,
    lookX: px+_wrV2.x, lookY: py+_wrV2.y, lookZ: pz+_wrV2.z,
    fov: _wrBaseFov
  });

  // Pose C — high-altitude airborne (mimick peak jump arc). Camera op ~9
  // units hoogte achter de auto, lookAt forward & lager. Triggert shader-
  // link voor sky-dome / far-LOD / roof-tops die normaal frustum-culled
  // zijn op chase-cam hoogte.
  _wrV1.set(0,9,5).applyQuaternion(q);
  _wrV2.set(0,0,-8).applyQuaternion(q);
  _warmRenderOnePose(player, {
    posX: px+_wrV1.x, posY: py+_wrV1.y, posZ: pz+_wrV1.z,
    lookX: px+_wrV2.x, lookY: py+_wrV2.y, lookZ: pz+_wrV2.z,
    fov: 65
  });

  // Pose D — mirror-backward view. Mimickt updateMirror() camera-pose
  // (camera.js:337-344): position binnen cabin, rotation = car rotation + π
  // (kijken achterwaarts). FOV 75 (mirrorCamera in scene.js:1289 is 68
  // maar geometrie-frustum is qua draw-calls relevant, niet exacte FOV).
  _wrV1.set(0,0,-0.5).applyQuaternion(q);
  _warmRenderOnePose(player, {
    posX: px+_wrV1.x, posY: py+0.75, posZ: pz+_wrV1.z,
    rotYDelta: Math.PI,
    fov: 75
  });

  // Bonus pose D2 — render door de echte mirrorCamera + mirrorRT pad als die
  // beschikbaar is. Dit warmt het readPixels-pad + mirrorCamera shader-
  // permutatie. updateMirror() init lazily via _initMirrorRT() bij de 1e
  // call (camera.js:346); door 'm hier sync aan te roepen verschuiven we
  // die init naar prewarm-fase. updateMirror() heeft eigen guards
  // (gameState, _mirrorEnabled, _camView) — die kunnen tijdens prewarm
  // verkeerd staan. Daarom direct via de exposed mirrorCamera renderen.
  // Mobile skip — mirror is meestal uitgeschakeld op mobile, en het
  // extra readPixels-pad kost 30-80ms tijdens countdown overlay zonder
  // dat het ergens voor gebruikt wordt.
  if(!window._isMobile && typeof mirrorCamera !== 'undefined' && mirrorCamera && renderer){
    try {
      // Positioneer mirrorCamera als updateMirror dat zou doen
      _wrV1.set(0,0,-1).applyQuaternion(q);
      mirrorCamera.position.copy(player.mesh.position).addScaledVector(_wrV1,-0.5);
      mirrorCamera.position.y += 0.75;
      mirrorCamera.rotation.copy(player.mesh.rotation);
      mirrorCamera.rotation.y += Math.PI;
      mirrorCamera.updateMatrixWorld();
      // Render naar default target (canvas, maar overlay maskeert visueel).
      // We hoeven niet naar _mirrorRT te schrijven — een render door
      // mirrorCamera tegen scene is genoeg om Three.js shader-permutaties
      // voor deze camera te linken. updateMirror() doet later wel het
      // RT-pad maar dat is een goedkope readback op gewarmde shaders.
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(null);
      renderer.render(scene, mirrorCamera);
      renderer.setRenderTarget(prevTarget);
    } catch(e){
      if(window.dbg) dbg.warn('perf','warm mirror render failed: ' + (e && e.message || e));
    }
  }
}

// Pre-instantieer SampleEngine voor de gekozen car-type als engine-samples
// beschikbaar zijn. Start op gain=0; SampleEngine.start() ramped master gain
// naar 0.9 over 0.15s, maar de per-band gains blijven 0 tot updateEngine ze
// opent — dus geen hoorbare engine tot de race draait.
//
// Als er al een _sampleEngine bestaat voor een ANDER car-type (bv. user
// kiest tussen races een andere auto), gooien we 'm weg en bouwen we
// opnieuw. Mirror van de stop+recreate logica in engine.js:244-247 zodat
// de eerste updateEngine-call na GO de spike niet alsnog veroorzaakt.
function _warmSampleEngine(carType){
  if(!audioCtx) return;
  if(!carType) return;
  if(typeof window._createSampleEngineForCarType !== 'function') return;
  if(!window._hasEngineSamples || !window._hasEngineSamples(carType)) return;
  if(window._sampleEngine && window._sampleEngine.carType === carType) return;
  if(window._sampleEngine){
    try{ window._sampleEngine.stop(); }catch(_){}
    window._sampleEngine = null;
  }
  try {
    window._sampleEngine = window._createSampleEngineForCarType(carType);
    if(window._sampleEngine && window._sampleEngine.start) window._sampleEngine.start();
    if(window._sampleEngine) window._sampleEngine.carType = carType;
  } catch(e){
    if(window.dbg) dbg.warn('perf','sample engine prewarm failed: ' + (e && e.message || e));
    window._sampleEngine = null;
  }
}

// Pre-warm de audio-graph van playJumpSound + playLandSound + playCollectSound.
// Alle drie alloceren oscillator + biquad + noise-source nodes en de noise
// buffer. Eerste call kan een hick veroorzaken bij eerste jump/coin/landing.
// We muten de SFX-bus tijdelijk om geen hoorbare beep tijdens prewarm te
// krijgen. Restore-timer dekt de langste sample (collect chime ~470ms).
function _warmJumpLandAudio(){
  if(!audioCtx || !window._sfxBus) return;
  // Force the shared noise buffer fill now (10–20ms main-thread work that
  // would otherwise land on the first _noise() call at race time).
  if(typeof _ensureNoiseBuf === 'function'){
    try { _ensureNoiseBuf(); }
    catch(e){ if(window.dbg) dbg.warn('perf','noise buffer prewarm failed: ' + (e && e.message || e)); }
  }
  const _origGain = window._sfxBus.gain.value;
  try {
    window._sfxBus.gain.value = 0;
    if(typeof playJumpSound === 'function') playJumpSound();
    if(typeof playLandSound === 'function') playLandSound();
    if(typeof playCollectSound === 'function') playCollectSound();
  } catch(e){
    if(window.dbg) dbg.warn('perf','SFX audio prewarm failed: ' + (e && e.message || e));
  }
  // Restore na ~900ms — playCollectSound has 4 beeps staggered by 70ms +
  // each .22s tail = ~490ms. 900ms is comfortable margin.
  setTimeout(() => {
    if(window._sfxBus) window._sfxBus.gain.value = _origGain;
  }, 900);
}

// Pre-warm particle pools: emit een paar onzichtbare particles ver onder
// de scene + één update zodat InstancedMesh.instanceMatrix + instanceColor
// hun eerste GPU-upload doen.
//
// Belangrijk: SimpleParticles.update returnt early bij alive.length===0
// VÓÓR needsUpdate gezet wordt (particles.js:196-197). Een prewarm met
// dt >= life zou alle particles in dezelfde tick laten sterven en de
// upload nooit triggeren. Daarom: life=1.0 + eerste update dt=0.001
// (life zakt naar 0.999, blijft alive → upload fires); tweede update
// dt=2.0 doodt ze (life -= 2.0/1.0 = 2.0 < 0).
function _warmParticlePools(){
  const pools = [
    (typeof sparkSystem    !== 'undefined') ? sparkSystem    : null,
    (typeof exhaustSystem  !== 'undefined') ? exhaustSystem  : null,
    (typeof smokeSystem    !== 'undefined') ? smokeSystem    : null,
    (typeof sparkleSystem  !== 'undefined') ? sparkleSystem  : null,
    (typeof dustSystem     !== 'undefined') ? dustSystem     : null,
  ];
  for(let i = 0; i < pools.length; i++){
    const sys = pools[i];
    if(!sys || typeof sys.emit !== 'function' || typeof sys.update !== 'function') continue;
    try {
      // 2 particles op y=-1000 (ver onder elke wereld), life=1.0s.
      sys.emit(0, -1000, 0, 0, 0, 0, 2, 0, 0, 0, 1.0);
      sys.update(0.001); // particles blijven alive → needsUpdate fires → GPU upload
      sys.update(2.0);   // doodt particles (life=1.0, -= 2.0/1.0 = 2.0 → <0)
    } catch(e){
      if(window.dbg) dbg.warn('perf','particle prewarm failed for pool '+i+': '+(e && e.message || e));
    }
  }
}

async function goToRace(){
  // Re-entry guard: blokkeert dubbele invocations (rapid double-click of
  // touch-stutter op de Race-knop). Zonder deze guard start een tweede
  // runCountdown parallel, krijg je twee onGo callbacks en eindigen we
  // met twee parallel music-schedulers (eerste consumeert pendingRaceMusic,
  // tweede valt door naar de fallback factory).
  //
  // Met de async refactor blijft gameState='SELECT' tot de allerlaatste
  // regel — de losse _raceStartInProgress flag dekt de tussentijdse async
  // ramen waar alleen de gameState-check zou doorlaten.
  if(gameState!=='SELECT')return;
  if(window._raceStartInProgress)return;
  window._raceStartInProgress = true;
  try{
    if(window._rpp)_rpp.mark('race:init',{world:activeWorld,laps:_selectedLaps,difficulty:difficulty});
    if(window.perfMark)perfMark('goToRace:start');
    _perfHeap('goToRace');
    if(window.Breadcrumb)Breadcrumb.push('goToRace',{world:activeWorld,car:typeof selCarId!=='undefined'?selCarId:null});
    if(titleMusic){titleMusic.stop();titleMusic=null;}
    if(window.menuMusic){window.menuMusic.stop();window.menuMusic=null;}
    // Tear down de bake-scene + render target. De cache (2D canvases per
    // auto) blijft staan voor snel terugkeren naar SELECT zonder re-bake.
    if(typeof window.disposeLivePreview==='function')window.disposeLivePreview();
    if(typeof disposeSnapshotBakery==='function')disposeSnapshotBakery();

    // Toon overlay vóór de zware sync-work zodat de gebruiker niet naar een
    // bevroren scherm staart. Status-tekst wordt per fase ge-update; CSS
    // animatie loopt op compositor-thread dus blijft draaien tijdens GPU-
    // stalls (shader-link, texture-upload).
    const overlay = document.getElementById('raceStartOverlay');
    const statusEl = overlay && overlay.querySelector('.rsoStatus');
    const setStatus = (txt) => {
      if(statusEl) statusEl.innerHTML = txt + '<span class="loadDots">...</span>';
    };
    document.getElementById('sSelect').classList.add('hidden');
    if(overlay) overlay.classList.remove('hidden');
    await _nextFrame(); // laat overlay één frame paint vóór heavy work

    // ── Phase 1: makeAllCars (zwaarste single chunk, 100-250ms) ───────────
    setStatus('PREPPING CARS');
    if(window.perfMark)perfMark('goToRace:makeAllCars:start');
    // makeAllCars() can throw on car-builder OOM (iOS Safari memory pressure).
    // Without this guard, gameState stays at 'SELECT' (the transition to
    // 'COUNTDOWN' below is skipped) and the re-entry guard at the top of
    // goToRace turns every following tap into a silent no-op.
    try{ makeAllCars(); }
    catch(e){
      if(window.dbg) dbg.error('navigation', e, 'makeAllCars failed');
      else console.error('makeAllCars failed:', e);
      // Restore the SELECT screen so the user has a way back instead of an
      // empty HUD over the (now disposed) world.
      if(overlay) overlay.classList.add('hidden');
      document.getElementById('hud').style.display='none';
      document.getElementById('sSelect').classList.remove('hidden');
      if(window.Notify) Notify.banner('⚠ Race kon niet starten — probeer opnieuw','#ff6644',3500);
      return;
    }
    if(window.perfMark){perfMark('goToRace:makeAllCars:end');perfMeasure('goToRace.makeAllCars','goToRace:makeAllCars:start','goToRace:makeAllCars:end');}
    cacheHUDRefs();applyWorldHUDTint(activeWorld);
    // Cinematic countdown camera (B1): place camera at the high-overhead
    // start of the intro sweep. Camera positie moet vóór warm-render staan
    // zodat de eerste compile/render-pass tegen de juiste view-matrix
    // werkt — anders worden door de frustum-cull verkeerde shader-permu-
    // taties gewarmd.
    const p=carObjs[playerIdx];
    if(p){
      // Herbruik _wrV1/_wrV2 scratch pool i.p.v. per-race-start nieuwe Vector3's.
      _wrV1.set(0,35,25).applyQuaternion(p.mesh.quaternion);
      camPos.copy(p.mesh.position).add(_wrV1);
      _wrV2.set(0,2,-2).applyQuaternion(p.mesh.quaternion);
      camTgt.copy(p.mesh.position).add(_wrV2);
      camera.position.copy(camPos);camera.lookAt(camTgt);
      camera.fov=80;camera.updateProjectionMatrix();
    }
    if(typeof startIntroCamera==='function')startIntroCamera();
    await _nextFrame();

    // ── Phase 2: shader compile ──────────────────────────────────────────
    setStatus('COMPILING SHADERS');
    // Pre-compile car shaders NU dat alle 9 cars in scene staan.
    // _precompileScene aan einde van buildScene draaide voordat makeAllCars
    // cars toevoegde — desktop GPU-driver shader-link kan 50-500ms zijn
    // (hybride GPUs zelfs >1s). Door het hier te doen + overlay ervoor
    // ziet de gebruiker geen single-frame freeze.
    // Cold-start fix: chunked compile met rAF-yields tussen batches om de
    // 38s Page Unresponsive te voorkomen. Helper is async; goToRace is al
    // async. Fallback naar sync _precompileScene als helper niet beschikbaar
    // (oudere builds). Per-batch setStatus voor zichtbaar progress.
    if(window.perfMark)perfMark('goToRace:precompileChunked:start');
    if(typeof window._precompileSceneChunked==='function'){
      const _lbl=(i,N)=>setStatus('COMPILING SHADERS '+i+'/'+N);
      if(window.dbg) await dbg.measureAsync('perf','precompile.afterCars',
        () => window._precompileSceneChunked({batchSize:8,labelFn:_lbl}));
      else await window._precompileSceneChunked({batchSize:8,labelFn:_lbl});
    } else if(typeof window._precompileScene==='function'){
      if(window.dbg)dbg.measure('perf','precompile.afterCars',window._precompileScene);
      else window._precompileScene();
    }
    if(window.perfMark){perfMark('goToRace:precompileChunked:end');perfMeasure('goToRace.precompileChunked','goToRace:precompileChunked:start','goToRace:precompileChunked:end');}
    await _nextFrame();

    // ── Phase 3: texture upload + postFX multi-pose warm-render ──────────
    setStatus('UPLOADING TEXTURES');
    // Pre-upload alle CanvasTextures naar GPU. renderer.compile() linkt
    // shaders maar upload textures lazy bij de eerste render(). Pakken we
    // hier weg van het 1e race-frame (30-100ms spike op Guangzhou).
    if(window.perfMark)perfMark('goToRace:warmTextures:start');
    if(typeof window._warmTextures==='function'){
      if(window.dbg)dbg.measure('perf','warmTextures.afterCars',window._warmTextures);
      else window._warmTextures();
    }
    if(window.perfMark){perfMark('goToRace:warmTextures:end');perfMeasure('goToRace.warmTextures','goToRace:warmTextures:start','goToRace:warmTextures:end');}
    // Multi-pose warm-render — rendert 4 view-poses (intro, chase, lucht,
    // mirror) door de complete postFX pipeline. Dit dwingt GPU driver om
    // shader-permutaties voor alle race-relevante frusta te linken tijdens
    // de overlay-fase. Vervangt de prior single-pose warm-render. Eindfix
    // voor de ~5s freeze na "GO!" (chase-cam permutaties) en de korte hang
    // bij hoge jumps (sky/far-LOD permutaties).
    if(window.perfMark)perfMark('goToRace:warmRender:start');
    try{
      if(p && typeof _warmRenderMultiPose === 'function'){
        if(window.dbg) dbg.measure('perf','warmRender.multiPose',()=>_warmRenderMultiPose(p));
        else _warmRenderMultiPose(p);
      } else if(typeof renderWithPostFX==='function'){
        renderWithPostFX(scene,camera);
      } else if(renderer&&scene&&camera){
        renderer.render(scene,camera);
      }
    }catch(e){
      if(window.dbg)dbg.warn('perf','warm-render failed: '+(e&&e.message||e));
    }
    if(window.perfMark){perfMark('goToRace:warmRender:end');perfMeasure('goToRace.warmRender','goToRace:warmRender:start','goToRace:warmRender:end');}
    // Restore camera naar intro-pose zodat het 1e COUNTDOWN-frame van een
    // correcte start-state vertrekt (updateIntroCamera lerpt sowieso, maar
    // een mismatch tussen camPos/camTgt en de echte camera-state kan een
    // jolt-lerp triggeren op tickt 0).
    if(p){
      // Herbruik _wrV1/_wrV2 scratch pool i.p.v. per-race-start nieuwe Vector3's.
      _wrV1.set(0,35,25).applyQuaternion(p.mesh.quaternion);
      camPos.copy(p.mesh.position).add(_wrV1);
      _wrV2.set(0,2,-2).applyQuaternion(p.mesh.quaternion);
      camTgt.copy(p.mesh.position).add(_wrV2);
      camera.position.copy(camPos);camera.lookAt(camTgt);
      camera.fov=80;camera.updateProjectionMatrix();
    }
    await _nextFrame();

    // ── Phase 4: audio init + race music pre-construct ───────────────────
    setStatus('TUNING ENGINE');
    // Pre-warm ambient audio so the WebAudio node graph is already alive
    // by GO. Both functions are idempotent and ramp gain from 0, so calling
    // them early is silent until the race actually starts. Engine audio
    // (4-osc + tire-noise loop) wordt ook hier ge-init zodat de 88200-
    // sample noise-buffer fill + filter chain niet op het 1e race-frame
    // landt. engineGain start op 0 → stilte tot updateEngine de gain ramped.
    if(audioCtx){
      Audio.startWind();
      Audio.initCrowd();
      if(typeof initEngine==='function'&&!engineGain){
        if(window.dbg)dbg.measure('perf','initEngine.preWarm',initEngine);
        else initEngine();
      }
      // SampleEngine pre-instantiation. Eerste call in updateEngine alloceert
      // anders 5 BufferSourceNodes + master GainNode op het 1e race-frame.
      // Hier verschoven naar overlay-fase. SampleEngine start zelf op gain=0
      // met 0.15s ramp; updateEngine overschrijft gain elke frame dus stilte
      // tot de race draait. Idempotent — eerste race per type bouwt de engine
      // op, daaropvolgende races hergebruiken 'm.
      const _playerCarType = (p && p.def) ? p.def.type : null;
      if(typeof _warmSampleEngine === 'function'){
        if(window.dbg) dbg.measure('perf','sampleEngine.preWarm',()=>_warmSampleEngine(_playerCarType));
        else _warmSampleEngine(_playerCarType);
      }
      // Jump/Land audio chain prewarm. Eerste call van playJumpSound +
      // playLandSound alloceert oscillator/biquad/noise-source nodes.
      // Tijdens prewarm muten we de SFX bus zodat de pre-warm beep onhoorbaar
      // is; restored na 600ms.
      if(typeof _warmJumpLandAudio === 'function'){
        if(window.dbg) dbg.measure('perf','jumpLandAudio.preWarm',_warmJumpLandAudio);
        else _warmJumpLandAudio();
      }
      // World ambient drone pre-warm. Verplaatst uit de runCountdown-onGo-
      // callback (waar het direct na GO een audio-graph-alloc-spike gaf op
      // space/deepsea/volcano/arctic). Drones ramp gain van 0 — stilte tot
      // race echt draait. Idempotent via stopWorldAmbient() in setWorldAmbient.
      if(typeof setWorldAmbient === 'function'){
        if(window.dbg) dbg.measure('perf','worldAmbient.preWarm',()=>setWorldAmbient(activeWorld));
        else setWorldAmbient(activeWorld);
      }
      // Pre-construct race music scheduler. Constructor doet _ensureMusicMaster
      // (eerste keer ~kostbaar GainNode setup), filter chain, bass/lead/stab
      // arrays. Door dit naar countdown te verschuiven blijft er op T+380ms
      // enkel een goedkope .start() over.
      if(!window._pendingRaceMusic&&typeof _createRaceMusicForWorld==='function'){
        const _ctor=()=>{try{window._pendingRaceMusic=_createRaceMusicForWorld();}
          catch(e){if(window.dbg)dbg.error('perf',e,'pre-construct race music');}};
        if(window.dbg)dbg.measure('perf','raceMusic.preConstruct',_ctor);else _ctor();
      }
    }

    // Sun-arc pre-warm + persistent activation: vroeger deden we
    // start→update→render(shadow)→stop, gevolgd door een tweede _startSunArc()
    // in de onGo callback. Maar stopSunArc() restored sunLight.position naar
    // de basis, dus de tweede start (en de eerste _updateSunArc() in het
    // RACE-frame) muteerde de positie opnieuw — andere shadow-camera frustum
    // dan de prewarm-render, en dus depth-pass shader-relink op het 1e
    // RACE-frame ("GO!"-freeze).
    //
    // Fix: laat de arc draaien vanaf prewarm. We doen één
    // start→update→render(shadow) en STOPPEN NIET. De arc loopt door tot in
    // de race (3-4s extra is 2% van de 180s cycle, onmerkbaar). De redundante
    // _startSunArc() in onGo is verwijderd.
    if(typeof window._startSunArc === 'function'
       && typeof window._updateSunArc === 'function'){
      try{
        window._startSunArc();
        window._updateSunArc(0.001);
        if(renderer && typeof renderer.compile === 'function'){
          renderer.compile(scene, camera);
          // renderer.compile() links surface shaders but NOT shadow-pass
          // shader permutations — those only link the first time the depth
          // pass actually renders the casters. Force one real render with
          // shadows enabled so de depth shaders tijdens de overlay-fase
          // compileren ipv op het 1e RACE-frame.
          if(renderer.shadowMap){
            const _wasShadowEnabled = renderer.shadowMap.enabled;
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.needsUpdate = true;
            try { renderer.render(scene, camera); }
            catch(e){ if(window.dbg) dbg.warn('perf','shadow prewarm render failed: '+(e&&e.message||e)); }
            renderer.shadowMap.enabled = _wasShadowEnabled;
          }
        }
      }catch(e){
        if(window.dbg) dbg.warn('perf','sunArc preWarm failed: '+(e&&e.message||e));
      }
    }

    // ── Phase 4.5: particle pools + HUD + world update prewarm ───────────
    // Particles: emit/update onzichtbaar zodat InstancedMesh GPU-upload op
    // de overlay-fase landt i.p.v. het 1e race-frame.
    if(typeof _warmParticlePools === 'function'){
      if(window.dbg) dbg.measure('perf','particles.preWarm',_warmParticlePools);
      else _warmParticlePools();
    }
    // HUD: één pass om alle textContent/style writes te doen vóór het 1e
    // race-frame. Sentinels in hud.js gaten daarna goedkoop verder.
    // BELANGRIJK: updateHUD leest lapStartTime + c._lapStart om de huidige
    // laptime te formatteren. Zonder reset zou hij stale waarden van een
    // vorige race (of 0 op de eerste race) tonen — een onzinnige laptime
    // zou tijdens countdown ~3-4s zichtbaar zijn want updateHUD wordt
    // alleen opnieuw aangeroepen zodra gameState='RACE'. We zetten daarom
    // de lap-anchors hier alvast op _nowSec; de onGo-callback overschrijft
    // ze sowieso met dezelfde waarde voor de echte race-start.
    const _nowS = (typeof _nowSec==='number' && _nowSec>0) ? _nowSec : performance.now()/1000;
    lapStartTime = _nowS;
    if(typeof carObjs!=='undefined' && carObjs){
      for(let _ci=0; _ci<carObjs.length; _ci++) carObjs[_ci]._lapStart = _nowS;
    }
    if(typeof updateHUD === 'function'){
      try{
        if(window.dbg) dbg.measure('perf','hud.preWarm',()=>updateHUD(0.001));
        else updateHUD(0.001);
      }catch(e){
        if(window.dbg) dbg.warn('perf','HUD prewarm failed: '+(e && e.message || e));
      }
    }
    // Per-track update prewarm: dispatcht naar de actieve wereld's
    // update*World(dt). Zorgt dat lap-progressive state + per-frame
    // animatie-init één keer doorlopen wordt vóór GO.
    try{
      if(activeWorld==='space' && typeof updateSpaceWorld==='function') updateSpaceWorld(0.001);
      else if(activeWorld==='deepsea' && typeof updateDeepSeaWorld==='function') updateDeepSeaWorld(0.001);
      else if(activeWorld==='candy' && typeof updateCandyWorld==='function') updateCandyWorld(0.001);
      else if(activeWorld==='volcano' && typeof updateVolcanoWorld==='function') updateVolcanoWorld(0.001);
      else if(activeWorld==='arctic' && typeof updateArcticWorld==='function') updateArcticWorld(0.001);
      else if(activeWorld==='sandstorm' && typeof updateSandstormWorld==='function') updateSandstormWorld(0.001);
      else if(activeWorld==='pier47' && typeof updatePier47World==='function') updatePier47World(0.001);
      else if(activeWorld==='guangzhou' && typeof updateGuangzhouWorld==='function') updateGuangzhouWorld(0.001);
    }catch(e){
      if(window.dbg) dbg.warn('perf','world prewarm failed: '+(e && e.message || e));
    }
    // Ghost RACE-tick: alle update-functies die in loop.js binnen het
    // gameState==='RACE' blok zitten worden tijdens COUNTDOWN geskipt. Op
    // de eerste echte race-frame zou hun cumulatieve first-call cost
    // (lazy buffers, lazy probes, mirror RT, first per-helper allocs) een
    // ~5s freeze geven op desktop. Hier draaien we ze één keer met dt~0
    // gemaskt door de overlay zodat die kosten al betaald zijn voor 'GO!'.
    if(window.perfMark)perfMark('goToRace:warmRaceTick:start');
    if(typeof window._warmRaceTick === 'function'){
      try{
        if(window.dbg) dbg.measure('perf','warmRaceTick', window._warmRaceTick);
        else window._warmRaceTick();
      }catch(e){
        if(window.dbg) dbg.warn('perf','warmRaceTick failed: '+(e && e.message || e));
      }
    }
    if(window.perfMark){perfMark('goToRace:warmRaceTick:end');perfMeasure('goToRace.warmRaceTick','goToRace:warmRaceTick:start','goToRace:warmRaceTick:end');}
    await _nextFrame();

    // ── Phase 5: race-state reset + HUD show + countdown ─────────────────
    _raceMaxSpeed=0;_raceOvertakes=0;_lastPlayerPos=9;
    _camView=0;_achieveUnlocked.clear();
    // Mid-race weather event: schedule randomly between 45-90 seconds into the race
    _weatherForecastTimer=45+Math.random()*45;_weatherForecastFired=false;
    // Reset ghost for new race but keep best lap ghost
    _ghostPos.length=0;_ghostSampleT=0;_ghostPlayT=0;
    initDriftVisuals();
    if(overlay) overlay.classList.add('hidden');
    document.getElementById('hud').style.display='block';
    gameState='COUNTDOWN';_raceStartGrace=99;
    // Pre-schedule de title/select/menu music fade-outs aan het begin van
    // countdown i.p.v. synchroon op GO. Op GO landden anders 4×3=12
    // AudioParam events in één frame; 9 daarvan verschuiven we nu naar
    // countdown-start, alleen de musicSched-fade en _applyMusicGain blijven
    // op GO (musicSched bestaat dan pas, applyMusicGain is anchored op
    // race-tijd). 0.8s fade is lang genoeg dat hij ongeveer op GO uitgefaded
    // is (countdown duurt ~3.5s, dus ruim binnen).
    if(titleMusic && !titleMusic._fadeStarted){
      titleMusic._fadeStarted=true;
      try{ _fadeOutMusic(titleMusic, 0.8); }catch(_){}
    }
    if(selectMusic && !selectMusic._fadeStarted){
      selectMusic._fadeStarted=true;
      try{ _fadeOutMusic(selectMusic, 0.8); }catch(_){}
    }
    if(window.menuMusic && !window.menuMusic._fadeStarted){
      window.menuMusic._fadeStarted=true;
      try{ _fadeOutMusic(window.menuMusic, 0.8); }catch(_){}
    }
    if(window.perfMark){perfMark('goToRace:end');perfMeasure('goToRace.total','goToRace:start','goToRace:end');try{perfMeasure('goToRace.fromClick','goToRace:click','goToRace:end');}catch(_){/* goToRace:click ontbreekt bij dev-hook startRace — geen probleem */}}
    setTouchControlsVisible(true);
    runCountdown(()=>{
    gameState='RACE';
    // AudioContext-resume guarantee: als de context tussen Phase 4 en GO
    // weer suspended raakte (iframe blur, iOS backgrounding), dan zouden
    // de audio-allocs op de eerste race-frame falen. Defensief resume hier.
    if(audioCtx && audioCtx.state === 'suspended'){
      try{ audioCtx.resume().catch(()=>{}); }catch(_){}
    }
    // Phase 10.2 — sun-arc draait al sinds prewarm (zie comment in Phase 4
    // boven). Geen tweede _startSunArc() hier; die zou alleen _sunArcStartT
    // resetten en je verliest de prewarm-positie tov de eerste race-frame.
    if(window._rpp)_rpp.mark('race:start',{world:activeWorld});
    if(typeof window._resetFirstRaceFrameMarker==='function')window._resetFirstRaceFrameMarker();
    _raceStartGrace=0; // GO means GO — no delay
    _raceGoTime=_nowSec; // achievements.js: 15s grace-window voor in-race triggers
    // Reset lap + sector timers to NOW so first lap/sector duration is correct
    lapStartTime=_nowSec;
    // Per-car lap-start anchor: without this AI cars only start measuring on
    // their second crossing, which left their bestLap holding a partial
    // race-time when the player finished first.
    if(carObjs)carObjs.forEach(c=>{c._lapStart=_nowSec;});
    _sectorStart=_nowSec;_currentSector=0;
    _sectorBests[0]=_sectorBests[1]=_sectorBests[2]=Infinity;
    // Crossfade naar race-muziek: fades voor title/select/menu zijn al
    // gestart aan het begin van countdown (zie pre-schedule hierboven).
    // Hier alleen nog de refs nulen + musicSched-fade (musicSched bestaat
    // pas vanaf nu).
    if(titleMusic){
      if(!titleMusic._fadeStarted){ try{ _fadeOutMusic(titleMusic,0.4); }catch(_){} }
      titleMusic=null;
    }
    if(selectMusic){
      if(!selectMusic._fadeStarted){ try{ _fadeOutMusic(selectMusic,0.4); }catch(_){} }
      selectMusic=null;
    }
    if(window.menuMusic){
      if(!window.menuMusic._fadeStarted){ try{ _fadeOutMusic(window.menuMusic,0.4); }catch(_){} }
      window.menuMusic=null;
    }
    if(musicSched){_fadeOutMusic(musicSched,0.3);musicSched=null;}
    // Reset dynamic state: nieuwe race = geen nitro/intensity-residu, geen duck
    _musicDuck=1.0;_applyMusicGain(0.1);
    if(audioCtx){
      // 50ms i.p.v. 380ms: pre-construct is in Phase 4 al gedaan, dus de
      // happy path is alleen .start() (~20μs voor RaceMusic, ~100μs voor
      // StemRaceMusic). 380ms wachten = ~23 frames stilte na GO. 50ms geeft
      // 1 frame ruimte voor camera/physics-overgang en voelt direct.
      setTimeout(()=>{
        if(gameState==='RACE'&&!musicSched){
          if(window.dbg)dbg.markRaceEvent('MUSIC-DISPATCH-START');
          const _doStart=()=>{
            let inst=window._pendingRaceMusic;window._pendingRaceMusic=null;
            if(inst){
              // Pre-built tijdens countdown — alleen .start() hier.
              try{if(inst.start)inst.start();}
              catch(e){if(window.dbg)dbg.warn('music','pre-built start failed: '+e.message);inst=null;}
            }
            if(!inst){
              // Fallback: pre-construct path overgeslagen of gefaald.
              // _createRaceMusicForWorld doet GainNodes + BiquadFilters +
              // (voor StemRaceMusic) AudioBufferSourceNode-array setup;
              // synchroon kan dat hier een 2e blocking spike geven na GO.
              inst=_safeStartMusic(()=>_createRaceMusicForWorld());
            }
            musicSched=inst;
            if(musicSched){
              if(musicSched.setNitro)musicSched.setNitro(false);
              if(musicSched.setIntensity)musicSched.setIntensity(0);
            }
          };
          // Happy path: pre-construct gelukt → synchroon (alleen .start()).
          // Fallback path: zet construction in requestIdleCallback zodat de
          // synchrone music-instantiation niet in een blocking frame landt.
          const _hasPending = !!window._pendingRaceMusic;
          const _runWrapped = ()=> {
            if(window.dbg) dbg.measure('perf','raceMusic.start',_doStart);
            else _doStart();
          };
          if(_hasPending){
            _runWrapped();
          } else if(typeof window.requestIdleCallback === 'function'){
            window.requestIdleCallback(_runWrapped, { timeout: 200 });
          } else {
            setTimeout(_runWrapped, 0);
          }
          if(window.dbg)dbg.markRaceEvent('MUSIC-DISPATCH-DONE');
        }
      },50);
      // Wind/crowd were pre-warmed at countdown start; calls below are idempotent no-ops.
      Audio.startWind();Audio.initCrowd();
      // Sessie 04 V2 — per-world procedural ambient drone. Idempotent;
      // setWorldAmbient tears down any prior one first.
      // Safety-net: setWorldAmbient is normaal al gewarmd in Phase 4 prewarm.
      // Hier alleen aanroepen als prewarm faalde (geen _worldAmbient bestaat).
      if(typeof setWorldAmbient==='function' && !window._worldAmbient){
        setWorldAmbient(activeWorld);
      }
    }
    // Show touch controls during race if on a touch device — but not if a hardware keyboard was detected
    const tc=document.getElementById('touchControls');
    if(tc&&('ontouchstart' in window||navigator.maxTouchPoints>0)&&!_hwKeyboardDetected)tc.style.display='block';
    // Control hints: show for 6s then fade out
    const ch=document.getElementById('controlHints');
    if(ch){ch.style.display='block';ch.style.opacity='1';setTimeout(()=>{ch.style.opacity='0';setTimeout(()=>{ch.style.display='none';},700);},6000);}
    // Add cam hint
    const camHint=document.getElementById('camViewHint');
    if(camHint){camHint.style.display='block';setTimeout(()=>camHint.style.display='none',5000);}
  });
  }finally{
    // _raceStartInProgress wordt gereset zodra de synchrone goToRace-flow
    // klaar is. runCountdown loopt fire-and-forget door — een throw in de
    // onGo-callback komt hier NIET binnen. Bij de happy-path is gameState
    // op dit punt al 'COUNTDOWN' wat de outer re-entry guard al dekt.
    // _resetRaceState (race.js) is de safety-net voor een crash mid-flow.
    window._raceStartInProgress = false;
  }
}


function goToTitle(){
  _resetRaceState();
  _perfHeap('goToTitle');
  if(window.Breadcrumb)Breadcrumb.push('goToTitle');
  gameState='TITLE';
  setTouchControlsVisible(false);
  // Title heeft geen car-preview nodig — bake-scene + render target weg.
  if(typeof window.disposeLivePreview==='function')window.disposeLivePreview();
  if(typeof disposeSnapshotBakery==='function')disposeSnapshotBakery();
  document.getElementById('sSelect').classList.add('hidden');
  document.getElementById('sWorld').classList.add('hidden');
  document.getElementById('sTitle').classList.remove('hidden');
  camera.position.set(0,12,330);camera.lookAt(0,0,280);
  initAudio();startMenuMusic();
  updateTitleHighScore();
}

function goToWorldSelect(){
  _perfHeap('goToWorldSelect');
  if(window.Breadcrumb)Breadcrumb.push('goToWorldSelect');
  // Finish-screen → Next Round flow: came from FINISH so reset race state
  // before switching screens. Without this _resetRaceState() the previous
  // race's HUD/cars stay live and the world-select transition glitches.
  if(gameState==='FINISH'&&typeof _resetRaceState==='function')_resetRaceState();
  gameState='WORLD_SELECT';
  // Clear stale framebuffer: render-loop slaat WORLD_SELECT/SELECT over
  // (loop.js _idleSkip), dus zonder deze clear blijft het laatste TITLE/RACE
  // frame zichtbaar door de overlay heen tot de volgende daadwerkelijke render.
  try{ if(typeof renderer!=='undefined'&&renderer&&renderer.clear){ const _pt=renderer.getRenderTarget?renderer.getRenderTarget():null; renderer.setRenderTarget(null); renderer.clear(true,true,true); if(_pt!==null) renderer.setRenderTarget(_pt); } }catch(_){}
  setTouchControlsVisible(false);
  initAudio();startMenuMusic();
  document.getElementById('sTitle').classList.add('hidden');
  document.getElementById('sSelect').classList.add('hidden');
  const finScr=document.getElementById('sFinish');if(finScr)finScr.classList.add('hidden');
  document.getElementById('sWorld').classList.remove('hidden');
  // Default-highlight the first card (top-left) on every entry, so the
  // selection rim is predictable instead of mirroring the saved activeWorld.
  // Keyboard/gamepad nav shifts the rim from here; Enter/click consumes it.
  const _wCards=document.querySelectorAll('.worldBigCard');
  _wCards.forEach(c=>c.classList.remove('wBigSel'));
  if(_wCards[0])_wCards[0].classList.add('wBigSel');
  if(typeof window._updateWorldSelFooter==='function') window._updateWorldSelFooter();
  // Career panel lives here now — refresh level/XP/stars/cups every show.
  if(typeof updateTitleHighScore==='function')updateTitleHighScore();
  // Track-card chrome: minimap + best-lap pill per tile. Idempotent on
  // re-show so the previously-NEW pill flips to a lap time after a race.
  if(typeof _initWorldSelectorTiles==='function')_initWorldSelectorTiles();
}

function goToSelectAgain(){
  _resetRaceState();
  gameState='SELECT';
  // Clear stale framebuffer: render-loop slaat SELECT over (loop.js
  // _idleSkip); zonder clear blijft het laatste RACE-frame zichtbaar door
  // de overlay heen tot de volgende daadwerkelijke render.
  try{ if(typeof renderer!=='undefined'&&renderer&&renderer.clear){ const _pt=renderer.getRenderTarget?renderer.getRenderTarget():null; renderer.setRenderTarget(null); renderer.clear(true,true,true); if(_pt!==null) renderer.setRenderTarget(_pt); } }catch(_){}
  setTouchControlsVisible(false);
  initAudio();startMenuMusic();
  buildCarSelectUI();
  // Match goToSelect(): default-highlight first unlocked car on re-entry.
  const _firstCar=document.querySelector('#carGrid .carCard:not(.locked)');
  if(_firstCar)_firstCar.click();
  document.getElementById('sSelect').classList.remove('hidden');
}
