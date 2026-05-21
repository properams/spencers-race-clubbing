// js/core/loop.js — hoofdanimatieloop, FPS/quality tracking, mirror render pass.
// Non-module script, geladen na scene.js en vóór main.js.
//
// Afhankelijkheden (script-globals, merendeel in main.js):
//   clock, renderer, scene, camera
//   _ctxLost, gamePaused, gameState, _nowSec
//   trackCurve, _titleCamT
//   carObjs, playerIdx
//   activeWorld, _floatSlotTimer, _floatSlot
//   sparkSystem, exhaustSystem
//   _mirrorEnabled, _camView, _victoryOrbit
//
// Externe functies (track/cars/effects/gameplay/worlds/ui modules + Audio facade):
//   updatePlayer, updateAI, checkJumps, checkSpinPads, checkBoostPads,
//   checkCollectibles, checkCollisions, checkTrackLimits, checkWrongWay,
//   checkSpaceRailgun, checkGravityZones,
//   checkOrbitingAsteroids, checkWarpTunnels, checkCurrentStreams,
//   checkAbyssCracks, checkTreasureTrail,
//   updateBoostArrows, updateSlipstreamVisuals, updateSafetyCar,
//   updateCamera, updateCarLights, updateBoostGlow, updateFlags,
//   updateSkidMarks, updateWeather, updateSky, updateSnow, updateStormFlash,
//   updateSpaceWorld, updateDeepSeaWorld, updateCandyWorld,
//   updateVolcanoWorld, updateArcticWorld,
//   updateHUD, updateSpeedOverlay, getPositions,
//   updateAmbientWindSpeed, updateAchievements,
//   updateWeatherForecast, updateQuickRestart, updateDamageSmoke,
//   updateRpmBar, updateRevLimiter, updateDriftVisuals,
//   updateNitroVisual, updateBoostTrail, updateGhost, updateSpeedLines,
//   updatePitStop, updateFastestLapFlash, updateCloseBattle,
//   updateCollisionFlash, updateRain, updateMirror,
//   Audio.updateThunder, Audio.updateCrowd.

'use strict';

// Performance counter (uit main.js verhuisd) — geset elke frame in loop(),
// gelezen door alle modules die "huidige tijd in seconden" nodig hebben.
let _nowSec=0;

// Page-visibility pause: skip de hele loop body als de tab achtergrond is.
// Op iOS draait rAF op trage tabs door en blijft alle update/render werk
// kosten — dit drains battery en triggert iOS' "high-CPU when backgrounded"
// kill-policy. Met deze vlag pauzeert de loop volledig (geen update, geen
// render, geen audio-scheduling drain). De clock.getDelta() consume voorkomt
// een grote dt-spike op resume die physics + AI uit balans gooit.
// audioCtx + scheduler suspend wordt al gedaan in core/renderer.js:40.
let _pageHidden=(typeof document!=='undefined'&&document.hidden===true);
if(typeof document!=='undefined'){
  document.addEventListener('visibilitychange',()=>{
    _pageHidden=document.hidden;
    if(window.dbg)dbg.log('loop','visibility '+(document.hidden?'hidden':'visible'));
    // Reset clock at resume so the first dt isn't the elapsed background time.
    if(!_pageHidden&&typeof clock!=='undefined'&&clock&&clock.getDelta)clock.getDelta();
  });
}

let _aiFrameCounter=0,_fpsShow=false,_fpsFrames=0,_fpsLast=performance.now(),_fpsVal=60;
let _lastStatsLog=0;
let _perfBadFrames=0,_perfChecked=false,_lowQuality=!!window._isMobile;
// Idle-screen render gate (desktop freeze fix). #sSelect en #sWorld hebben
// opake radial-gradient achtergronden (css/select.css:51, css/worlds.css:2),
// dus het 3D-canvas eronder is onzichtbaar — toch werd de laatst-gebouwde
// wereld (mogelijk Guangzhou, 3849 LoC) plus 4-pass bloom+SSAO+atmosphere
// elke frame gerenderd. Op slow desktop = "page unresponsive" bij de wereld-
// kiezer. Track last state om één breadcrumb per transitie te emitten, en
// throttle TITLE-render naar 20fps (fly-cam blijft zichtbaar door .neon-bg
// semi-transparante overlay maar postFX hoeft er niet bij).
let _idleLastState=null;
let _idleNextRenderMs=0;
// Desktop-freeze fix: separate counters for the first-3-RACE-frames GO-spike
// detector. The main quality-check window starts at frame 30 (so the spike
// itself is invisible to it); this extra detector runs frame 0..2 of RACE
// and triggers an immediate downgrade when a sub-second hitch is detected.
let _raceFrameCount=0,_goSpikeChecked=false,_goSpikeHitchCount=0;
// Exposed reset hook so race.js _resetRaceState can clear all perf-counters
// without needing direct access to module-local lets. Also resets the
// runtime _lowQuality latch and triggers a tier re-evaluation so a one-shot
// downgrade on race N doesn't permanently stick on lighter races N+1, N+2.
window._resetLoopPerfCounters=function(){
  _aiFrameCounter=0;_perfBadFrames=0;_perfChecked=false;
  _raceFrameCount=0;_goSpikeChecked=false;_goSpikeHitchCount=0;
  _lowQuality = !!window._isMobile;  // mobile is always low; desktop releases the latch
  if(typeof window._reEvaluateTierForNewRace === 'function'){
    window._reEvaluateTierForNewRace();
  }
};
// race-perf probe scratch (reused every frame, no per-frame allocation).
// Filled inline via _rppT helpers, drained by _rpp.frameEnd at end of frame.
const _RPP_SUB={physics:0,ai:0,particles:0,audio:0,postfx:0,render:0,world:0,hud:0};
let _rppFrameStart=0;
// Reuse-targets voor TITLE-screen trackCurve.getPoint() — voorheen 2 Vector3
// allocs per frame (~120/sec) op TITLE. Met target arg vermijden we GC-druk.
const _titleP = new THREE.Vector3();
const _titleAh = new THREE.Vector3();
function _rppResetSub(){
  _RPP_SUB.physics=0;_RPP_SUB.ai=0;_RPP_SUB.particles=0;_RPP_SUB.audio=0;
  _RPP_SUB.postfx=0;_RPP_SUB.render=0;_RPP_SUB.world=0;_RPP_SUB.hud=0;
}
// First-frame-after-GO tracker — used to attribute the initial shader-compile
// /texture-upload spike to a measurable window. Reset by navigation.js when
// gameState transitions COUNTDOWN→RACE.
let _firstRaceFrameLogged=false;
window._resetFirstRaceFrameMarker=()=>{_firstRaceFrameLogged=false;};
// Auto-quality detection thresholds: during frames [START..END], count frames slower than BAD_MS.
// If the count exceeds BAD_THRESHOLD within that window, downgrade to low quality.
const QUALITY_CHECK_FRAME_START=30,QUALITY_CHECK_FRAME_END=180;
// 2026-05-17: relaxed van 0.032/60 → 0.040/90. De vorige drempel zakte het
// hele scherm permanent naar 'low' bij één bursty wereld (Guangzhou shader-
// compile, Candy emissive flood). Op desktop-low rendert content nog steeds
// op desktop-density (zie js/worlds/*) wat aliasing-chaos veroorzaakt. Een
// hogere drempel houdt desktop op mid/high tenzij echt nodig.
const QUALITY_BAD_FRAME_MS=0.040,QUALITY_BAD_FRAME_THRESHOLD=90;

function loop(){
  requestAnimationFrame(loop);
  if(_ctxLost){clock.getDelta();return;} // context lost — skip frame, consume delta
  if(_pageHidden){clock.getDelta();return;} // tab in background — full skip, iOS battery + tab-kill protection
  if(gamePaused){clock.getDelta();return;} // consume delta so time doesn't jump on resume
  // Eén performance.now() per frame, hergebruikt voor _nowSec, het
  // race-perf probe frame-start, en de GO-spike detector. Voorheen 3
  // losse calls per frame; klein maar gratis te verwijderen.
  const _frameStartMs=performance.now();
  if(window._rpp&&_rpp.enabled){_rppResetSub();_rppFrameStart=_frameStartMs;}
  _nowSec=_frameStartMs/1000;
  // dt scaling: tablets get a 0.93× world-time multiplier so the race feels slightly calmer on iPad
  // without changing physics balance (player + AI + decor all slow down together).
  // dt-clamp upper bound is tier-driven (high=0.05, mid=0.065, low/mobile=0.085) so mid-tier
  // desktops with occasional 60ms hitches don't catapult physics state into a 3-frame jump.
  const _qfDtClamp = window._qFlags ? window._qFlags.dtClampSec : (window._isMobile ? 0.085 : 0.05);
  let dt = Math.min(clock.getDelta(), _qfDtClamp) * (window._isTablet ? 0.93 : 1);
  // Hit-pause slow-mo. collisions.js sets _hitPauseTimer on a heavy
  // impact; here we tick it down on real-time dt and scale the
  // simulation dt to 20% so the next ~80ms reads as a slow-mo punch.
  // Only affects RACE — title/countdown cam consume the real dt above
  // this point (line 113, 124) and never call this branch.
  if(_hitPauseTimer>0 && gameState==='RACE'){
    _hitPauseTimer=Math.max(0,_hitPauseTimer-dt);
    dt*=0.2;
  }
  // Phase R2.7 — finish-line slow-mo. Werkt in RACE+FINISH state (victory
  // orbit camera krijgt nog ~700ms gestrekte tijd voor cinematische punch).
  // dt*=0.30 ipv 0.20 want we willen het wel zien bewegen, niet bevriezen.
  if(window._finishSlowMoTimer > 0){
    window._finishSlowMoTimer = Math.max(0, window._finishSlowMoTimer - dt);
    dt *= 0.30;
  }
  // Music-duck tween. collisions.js sets _musicDuckTarget (0.4) +
  // _musicDuckTimer (0.5s) on a heavy hit. While the timer runs the
  // master duck ramps toward target; once it expires the value
  // recovers toward 1.0. Only re-applies the gain when the value
  // actually changed by ≥0.005 so AudioParam scheduling stays cheap.
  if(typeof _musicDuckTimer!=='undefined' && typeof _musicDuck!=='undefined'){
    const _mdPrev=_musicDuck;
    if(_musicDuckTimer>0){
      _musicDuckTimer=Math.max(0,_musicDuckTimer-dt);
      _musicDuck=Math.max(_musicDuckTarget, _musicDuck - (1.0-_musicDuckTarget)*dt*3);
    }else if(_musicDuck<1.0){
      _musicDuck=Math.min(1.0, _musicDuck + dt*1.8);
    }
    if(Math.abs(_musicDuck-_mdPrev)>=0.005 && typeof _applyMusicGain==='function'){
      _applyMusicGain(0.06);
    }
  }
  _aiFrameCounter++;
  // Animated title camera — fly along track
  if(gameState==='TITLE'&&trackCurve){
    _titleCamT+=dt*.016;
    const t=_titleCamT%1,t2=(_titleCamT+.055)%1;
    trackCurve.getPoint(t, _titleP);
    trackCurve.getPoint(t2, _titleAh);
    camera.position.set(_titleP.x,_titleP.y+7.5,_titleP.z);
    camera.lookAt(_titleAh.x,_titleAh.y+1.8,_titleAh.z);
    camera.fov+=(64-camera.fov)*Math.min(1,dt*1.5);camera.updateProjectionMatrix();
  }
  // Cinematic countdown camera (B1) — runs while gameState==='COUNTDOWN'.
  // Single-Bezier sweep from high-overhead-behind-grid to chase-cam
  // position, ending exactly on chase-cam at GO.
  if(gameState==='COUNTDOWN'&&typeof updateIntroCamera==='function'){
    updateIntroCamera(dt);
  }
  if(gameState==='RACE'||gameState==='FINISH'){
    // physics + AI (player + AI cars). AI stagger evaluated once per frame
    // (was recomputed per AI car previously). High-tier desktop runs all AI
    // every frame; mid/low/mobile run each AI every 2nd frame, halving cost.
    const _qfStagger = window._qFlags ? !!window._qFlags.aiStagger : !!window._isMobile;
    let _rppT0=window._rpp?performance.now():0;
    for(let i=0;i<carObjs.length;i++){
      const car=carObjs[i];
      if(i===playerIdx){if(gameState==='RACE')updatePlayer(dt);else if(gameState==='FINISH'&&Math.abs(car.speed)>.01)car.speed*=Math.pow(0.97,dt*60);}
      else{
        if(!_qfStagger || (_aiFrameCounter+i)%2===0) updateAI(car, dt*(_qfStagger?2:1));
      }
    }
    if(window._rpp){_RPP_SUB.physics+=performance.now()-_rppT0;_rppT0=performance.now();}
    if(gameState==='RACE'){
      checkJumps();checkSpinPads(dt);checkBoostPads();checkCollectibles();checkCollisions(dt);
      // Soft-wall must run BEFORE checkTrackLimits so any wall-induced push
      // gets baked into the position before tracklimits inspects offDist
      // (otherwise a recovery-circle could trigger on a position the wall
      // would have corrected this same frame).
      if(typeof checkWallCollisions==='function')checkWallCollisions(dt);
      checkTrackLimits(dt);checkWrongWay(dt);
      if(activeWorld==='space'){checkSpaceRailgun();checkGravityZones(dt);checkOrbitingAsteroids(dt);checkWarpTunnels(dt);}
      else if(activeWorld==='deepsea'){checkCurrentStreams(dt);checkAbyssCracks(dt);checkTreasureTrail(dt);}
      updateBoostArrows();updateSlipstreamVisuals();updateSafetyCar(dt);
    }
    if(window._rpp){_RPP_SUB.physics+=performance.now()-_rppT0;_rppT0=performance.now();}
    // _diagWrap is a no-op pass-through unless ?diag=1 is set. The wrapper
    // measures first-call cost, cumulative cost and max-frame cost per name
    // for the first 5s after GO so we can pin-point what causes the freeze.
    const _dw = window._diagWrap || ((n,f)=>f());
    _dw('sparkSystem', ()=>sparkSystem.update(dt));
    _dw('exhaustSystem', ()=>exhaustSystem.update(dt));
    if(smokeSystem)   _dw('smokeSystem', ()=>smokeSystem.update(dt));
    if(sparkleSystem) _dw('sparkleSystem', ()=>sparkleSystem.update(dt));
    if(dustSystem)    _dw('dustSystem', ()=>dustSystem.update(dt));
    // Sessie 02 V3 — ambient world particle emission near the player
    // (sandstorm dust, arctic snow, volcano embers, candy wisps, etc.).
    // Throttled to 12Hz internally; skipped on FINISH.
    if(gameState==='RACE' && typeof emitAmbientWorldFX==='function')
      _dw('emitAmbientWorldFX', ()=>emitAmbientWorldFX(dt));
    if(window._rpp){_RPP_SUB.particles+=performance.now()-_rppT0;_rppT0=performance.now();}
    _dw('updateCamera', ()=>updateCamera(dt));
    _dw('updateCarLights', ()=>updateCarLights());
    _dw('updateBoostGlow', ()=>updateBoostGlow());
    _dw('updateBrakeHeat', ()=>updateBrakeHeat(dt));
    _dw('updateDirt', ()=>updateDirt(dt));
    _dw('updateFlags', ()=>updateFlags());
    if(typeof _updateExposure==='function')      _dw('_updateExposure', ()=>_updateExposure(dt));
    // PBR-upgrade Brok 3 — contact-shadow matrix-update per frame.
    if(typeof _updateContactShadows==='function') _dw('_updateContactShadows', ()=>_updateContactShadows());
    // Phase 8.7 + 8.8 + 8.10 — distance-cull LOD, reflectie probe re-bake,
    // skyline parallax scroll. Alle cost-vrij of mobile-safe (probe skip).
    if(typeof _updateLodCull==='function')        _dw('_updateLodCull', ()=>_updateLodCull());
    if(typeof _updateReflectionProbe==='function')_dw('_updateReflectionProbe', ()=>_updateReflectionProbe(dt));
    if(typeof _updateSkylineParallax==='function')_dw('_updateSkylineParallax', ()=>_updateSkylineParallax());
    // Phase 9.2 — motion blur driven by player speed-ratio.
    if(typeof _setMotionBlurFromSpeed==='function' && carObjs && carObjs[playerIdx]){
      const _pc = carObjs[playerIdx];
      const _sr = Math.abs(_pc.speed) / Math.max(0.01, _pc.def.topSpd || 2);
      _dw('_setMotionBlurFromSpeed', ()=>_setMotionBlurFromSpeed(Math.min(1, _sr)));
    }
    // Phase 10.2 — sun-arc day-night cycle update tijdens RACE.
    if(typeof _updateSunArc==='function')_dw('_updateSunArc', ()=>_updateSunArc(dt));
    // Phase 13D — finish-line confetti per-frame update (no-op als geen burst actief)
    if(typeof updateFinishCelebration==='function')_dw('updateFinishCelebration', ()=>updateFinishCelebration(dt));
    _dw('updateSkidMarks', ()=>updateSkidMarks());
    _dw('updateWeather', ()=>updateWeather(dt));
    _dw('updateSky', ()=>updateSky(dt));
    _dw('Audio.updateThunder', ()=>Audio.updateThunder(dt));
    _dw('updateSnow', ()=>updateSnow(dt));
    _dw('updateStormFlash', ()=>updateStormFlash(dt));
    // Phase 6.8 — shader-sky dome update (Pier47 only). No-op als de
    // dome niet bestaat (andere werelden) of de helper niet geladen is.
    if(typeof _updateSkyShader==='function')_dw('_updateSkyShader', ()=>_updateSkyShader());
    if(window._rpp){_RPP_SUB.world+=performance.now()-_rppT0;_rppT0=performance.now();}
    if(activeWorld==='space')   _dw('updateSpaceWorld', ()=>updateSpaceWorld(dt));
    if(activeWorld==='deepsea') _dw('updateDeepSeaWorld', ()=>updateDeepSeaWorld(dt));
    if(activeWorld==='candy')   _dw('updateCandyWorld', ()=>updateCandyWorld(dt));
    if(activeWorld==='volcano') _dw('updateVolcanoWorld', ()=>updateVolcanoWorld(dt));
    if(activeWorld==='arctic')  _dw('updateArcticWorld', ()=>updateArcticWorld(dt));
    if(activeWorld==='sandstorm'&&typeof updateSandstormWorld==='function')_dw('updateSandstormWorld', ()=>updateSandstormWorld(dt));
    if(activeWorld==='pier47'&&typeof updatePier47World==='function')      _dw('updatePier47World', ()=>updatePier47World(dt));
    if(activeWorld==='guangzhou'&&typeof updateGuangzhouWorld==='function')_dw('updateGuangzhouWorld', ()=>updateGuangzhouWorld(dt));
    // Cinematic helpers — only does work if a builder pushed something into
    // _cinemaState. Cheap early-out for non-cinematic worlds.
    if(typeof updateCinematic==='function')_dw('updateCinematic', ()=>updateCinematic(dt));
    if(window._rpp){_RPP_SUB.world+=performance.now()-_rppT0;_rppT0=performance.now();}
    if(gameState==='RACE'){
      _dw('updateHUD', ()=>updateHUD(dt));
      _dw('updateSpeedOverlay', ()=>updateSpeedOverlay());
      const _pp=_playerRank();
      _dw('Audio.updateCrowd', ()=>Audio.updateCrowd(_pp));
      // Dynamische muziek-intensity: positie + speed + combo bepalen
      // continu de mid/lead-balans op de actieve scheduler.
      const _pcar=carObjs[playerIdx];
      const _spdR=_pcar?Math.min(1,Math.abs(_pcar.speed)/(_pcar.def.topSpd||1.8)):0;
      _dw('Audio.updateMusicIntensity', ()=>Audio.updateMusicIntensity(_pp,_spdR,(typeof _comboTimer!=='undefined'&&_comboTimer>0)));
      _dw('updateAmbientWindSpeed', ()=>updateAmbientWindSpeed(dt));
      if(window._rpp){_RPP_SUB.audio+=performance.now()-_rppT0;_rppT0=performance.now();}
      _dw('updateAchievements', ()=>updateAchievements(dt));
      if(_floatSlotTimer>0){_floatSlotTimer-=dt;if(_floatSlotTimer<=0)_floatSlot=0;}
      _dw('updateWeatherForecast', ()=>updateWeatherForecast(dt));
      _dw('updateQuickRestart', ()=>updateQuickRestart(dt));
      _dw('updateDamageSmoke', ()=>updateDamageSmoke());
      _dw('updateRpmBar', ()=>updateRpmBar(dt));
      _dw('updateRevLimiter', ()=>updateRevLimiter(dt));
      _dw('updateDriftVisuals', ()=>updateDriftVisuals(dt));
      _dw('updateNitroVisual', ()=>updateNitroVisual());
      _dw('updateNitroFlame', ()=>updateNitroFlame(dt));
      _dw('updateDriverSway', ()=>updateDriverSway(dt));
      _dw('updateHazardLights', ()=>updateHazardLights());
      _dw('updateUnderglowPulse', ()=>updateUnderglowPulse());
      _dw('updateTireCompression', ()=>updateTireCompression());
      _dw('updateBoostTrail', ()=>updateBoostTrail());
      _dw('updateGhost', ()=>updateGhost(dt));
      _dw('updateSpeedLines', ()=>updateSpeedLines());
      _dw('updatePitStop', ()=>updatePitStop(dt));
      _dw('updateFastestLapFlash', ()=>updateFastestLapFlash(dt));
      _dw('updateCloseBattle', ()=>updateCloseBattle(dt));
    }
    _dw('updateCollisionFlash', ()=>updateCollisionFlash(dt));
    _dw('updateCaSpikeDecay', ()=>updateCaSpikeDecay(dt));
    _dw('updateRain', ()=>updateRain());
    if(window._rpp){_RPP_SUB.hud+=performance.now()-_rppT0;}
  }
  let _rppRT0=window._rpp?performance.now():0;
  if(renderer&&scene&&camera){
    // Idle-screen gate: SELECT/WORLD_SELECT volledig skippen (opaque overlay
    // dekt canvas), TITLE bare-render @ 20fps (fly-cam zichtbaar door semi-
    // transparante .neon-bg, maar postFX 4-pass uit). RACE/COUNTDOWN/FINISH
    // gaan onveranderd door het volledige meet+postFX pad hieronder.
    const _gs=gameState;
    const _idleSkip=(_gs==='SELECT'||_gs==='WORLD_SELECT');
    const _idleBare=(_gs==='TITLE');
    if(_idleLastState!==_gs){
      if(window.Breadcrumb&&(_idleSkip||_idleBare)){
        Breadcrumb.push('idle-render-mode',{state:_gs,mode:_idleSkip?'skip':'bare'});
      }
      _idleLastState=_gs;
      _idleNextRenderMs=0;
    }
    if(_idleSkip){
      // no render — canvas onzichtbaar onder opaque overlay
    }else if(_idleBare){
      const _nowMs=performance.now();
      if(_nowMs>=_idleNextRenderMs){
        _idleNextRenderMs=_nowMs+50; // 20fps cap voor title fly-cam
        renderer.render(scene,camera); // bare — geen bloom/SSAO/atmosphere
      }
    }else{
    // Perf Phase A: meet GO→eerste race-frame los van dbg (zodat headless
    // run het ook zonder ?debug ziet). Ook shader-count snapshot @ first frame.
    const _isFirstRaceFrame = (window._waitingForFirstRaceFrame&&gameState==='RACE');
    if(_isFirstRaceFrame){
      if(window.perfMark){perfMark('go:firstFrame');perfMeasure('go.toFirstFrame','go:fired','go:firstFrame');}
      window._waitingForFirstRaceFrame=false;
      if(window.perfLog){
        const _pa=(renderer.info.programs&&renderer.info.programs.length)||0;
        window.perfLog.push({name:'shaderPrograms.atFirstFrame',ms:_pa,t:performance.now(),world:window.activeWorld});
      }
    }
    // First-frame-after-GO measure: catches shader compile / texture upload
    // spike on the first race render with this world's full material set.
    if(window.dbg&&!_firstRaceFrameLogged&&gameState==='RACE'){
      _firstRaceFrameLogged=true;
      const _progBefore=(renderer.info.programs&&renderer.info.programs.length)||0;
      const _texBefore=renderer.info.memory.textures;
      if(window.perfMark)perfMark('firstRaceFrame:render:start');
      dbg.measure('perf','firstRaceFrame.render',()=>{
        if(typeof renderWithPostFX==='function')renderWithPostFX(scene,camera);
        else renderer.render(scene,camera);
      });
      if(window.perfMark){perfMark('firstRaceFrame:render:end');perfMeasure('firstRaceFrame.render','firstRaceFrame:render:start','firstRaceFrame:render:end');}
      const _progAfter=(renderer.info.programs&&renderer.info.programs.length)||0;
      const _texAfter=renderer.info.memory.textures;
      dbg.markRaceEvent('FIRST-RACE-FRAME',{
        progDelta:_progAfter-_progBefore,
        texDelta:_texAfter-_texBefore,
        progAfter:_progAfter,
        texAfter:_texAfter
      });
    }else if(_isFirstRaceFrame){
      // Same measurement, dbg-disabled pad: blijft handig voor de runner.
      if(window.perfMark)perfMark('firstRaceFrame:render:start');
      if(typeof renderWithPostFX==='function')renderWithPostFX(scene,camera);
      else renderer.render(scene,camera);
      if(window.perfMark){perfMark('firstRaceFrame:render:end');perfMeasure('firstRaceFrame.render','firstRaceFrame:render:start','firstRaceFrame:render:end');}
    }else{
      if(typeof renderWithPostFX==='function')renderWithPostFX(scene,camera);
      else renderer.render(scene,camera);
    }
    if(window._showStats && performance.now()-_lastStatsLog>1000){
      console.log('[stats]', renderer.info.render.calls, 'calls,',
        renderer.info.render.triangles, 'tris');
      _lastStatsLog = performance.now();
    }
    } // end idle-render gate
  }
  // Mirror pass — second render with backward-facing camera (chase cam + race only, not during victory orbit or intro)
  if(gameState==='RACE'&&_mirrorEnabled&&_camView===0&&!_victoryOrbit){
    // Skip mirror on low quality / low tier to save a full render pass.
    // Ook skip de eerste paar race-frames: shader-link + texture-upload-
    // residue van warm-textures kunnen op het 1e/2e frame nog landen; een
    // tweede volledige scene-render erbovenop compound't dat naar een
    // visible freeze. Mirror is sowieso onzichtbaar tijdens countdown
    // (updateMirror hide't 'm zelf) — vanaf frame 6 (~100ms na GO) verschijnt
    // hij dan zonder zichtbare vertraging voor de user.
    //
    // Tier flag introduces frame-skip: high=every 2nd frame (30fps mirror),
    // mid=every 3rd frame (~20fps), low=off. Players don't perceive 60fps
    // in a small rear-view, so halving the mirror render is invisible to
    // gameplay but saves 2-4ms per frame on desktop.
    const _qf = window._qFlags;
    const _mirrorOn = _qf ? !!_qf.mirror : !_lowQuality;
    // mirrorFrameSkip defaults to 0 (every frame) when _qFlags is missing —
    // preserves pre-PR behaviour for fallback paths. With _qFlags present,
    // high=1 (every 2nd), mid=2 (every 3rd), low=mirror off entirely.
    const _mirrorSkipRaw = (_qf && typeof _qf.mirrorFrameSkip === 'number') ? _qf.mirrorFrameSkip : 0;
    if(_mirrorOn && _aiFrameCounter > 5 && (_aiFrameCounter % (_mirrorSkipRaw + 1)) === 0){
      updateMirror();
    }
  }
  if(window._rpp&&_rpp.enabled){
    _RPP_SUB.render+=performance.now()-_rppRT0;
    // Frame-delta = wall-clock since loop body started; postfx is folded into render
    // (render block above includes renderWithPostFX). Drain to probe.
    _rpp.frameEnd(performance.now()-_rppFrameStart,_RPP_SUB);
  }
  // Auto quality detection — see QUALITY_* constants above for thresholds.
  // Bad-frame window has two bands now: > THRESHOLD frames slow → drop one
  // tier; > 2× THRESHOLD → drop two tiers (skip the middle, go straight low).
  // PBR-upgrade follow-up: extra graceful-band toegevoegd boven THRESHOLD*0.7
  // die alleen speed-blur uitschakelt + SMAA full→half — voordat de
  // binaire tier-step _engageLowQuality wordt aangeroepen.
  if(!_perfChecked&&gameState==='RACE'&&_aiFrameCounter>QUALITY_CHECK_FRAME_START&&_aiFrameCounter<QUALITY_CHECK_FRAME_END){
    if(dt>QUALITY_BAD_FRAME_MS)_perfBadFrames++;
    if(_aiFrameCounter===QUALITY_CHECK_FRAME_END-1){
      _perfChecked=true;
      if(_perfBadFrames > QUALITY_BAD_FRAME_THRESHOLD*1.4){
        _engageLowQuality(2);
      } else if(_perfBadFrames > QUALITY_BAD_FRAME_THRESHOLD){
        _engageLowQuality(1);
      } else if(_perfBadFrames > QUALITY_BAD_FRAME_THRESHOLD*0.7){
        _applyGracefulDowngrade();
      }
    }
  }
  // GO-spike detector: the regular auto-quality window (frame 30..180) misses
  // the freeze that occurs on the very first race-frames (shader-link spike).
  // We sample the wall-clock dt of the first 3 RACE-frames separately —
  // if any of them is >100ms (3+ dropped frames), engage low-quality
  // immediately so the rest of the race runs smoother on this hardware.
  // dt is already clamped to 0.05/0.085, so we measure with performance.now()
  // delta against the frame-start instead.
  if(!_goSpikeChecked&&gameState==='RACE'){
    _raceFrameCount++;
    // Bevroeg drempel van 3 naar 4 frames sample-window, en vereis 2
    // opeenvolgende hitches (>100ms) voor een downgrade. Eén shader-compile
    // burst alleen mag de speler niet permanent op low pinnen.
    if(_raceFrameCount>=4)_goSpikeChecked=true;
    const wallDt=performance.now()-_frameStartMs;
    if(wallDt>100){
      _goSpikeHitchCount++;
      if(_goSpikeHitchCount>=2&&!_lowQuality){
        _engageLowQuality(1);
        if(window.dbg)dbg.markRaceEvent('GO-SPIKE-DOWNGRADE',{frame:_raceFrameCount,wallMs:+wallDt.toFixed(1),consecutive:_goSpikeHitchCount});
      } else if(_goSpikeHitchCount===1){
        // PBR-upgrade follow-up: graceful-downgrade op de eerste hitch zodat
        // speed-blur + SMAA-full-pass al uit zijn vóór een eventuele
        // tweede hitch _engageLowQuality afdwingt. Vermindert kans dat een
        // shader-compile burst tot een volledige tier-step leidt.
        _applyGracefulDowngrade();
      }
    } else {
      _goSpikeHitchCount=0;
    }
  }
}

// PBR-upgrade follow-up: gradiele downgrade die VÓÓR _engageLowQuality wordt
// toegepast. Twee niveaus:
//   Niveau 1 (eerste hitch / boven 70% bad-frame-drempel):
//     - speed-blur uit
//     - wheel-dust uit
//     - SMAA full → half
//   Niveau 2 (tweede hitch / boven 100% drempel maar niet getrigged tot
//   binaire tier-step omdat downgrade-pad anderszins gevolgd wordt):
//     - SMAA half → uit
//     - contact-shadows uit
// Idempotent per niveau. Manual-pin respecteert.
let _gracefulDowngradeLevel = 0;
function _applyGracefulDowngrade(){
  if(window._qManualDowngrade) return;
  if(_gracefulDowngradeLevel >= 1) return;
  _gracefulDowngradeLevel = 1;
  if(window._qFlags){
    window._qFlags.speedBlur = false;
    window._qFlags.wheelDust = false;
    if(window._qFlags.smaa === 'full') window._qFlags.smaa = false;
  }
  if(window.dbg) dbg.markRaceEvent('GRACEFUL-DOWNGRADE', {
    level: 1,
    smaa: (window._qFlags && window._qFlags.smaa) || null,
    speedBlur: false,
    wheelDust: false
  });
}

// Tweede graceful-niveau — voor consumers die nu nog niet aangeroepen worden,
// maar staan klaar voor wanneer we hier een trigger voor toevoegen. Exposed
// als window-global zodat een eventuele toekomstige trigger niet eerst een
// loop.js-wijziging nodig heeft.
function _applyGracefulDowngradeLevel2(){
  if(window._qManualDowngrade) return;
  if(_gracefulDowngradeLevel >= 2) return;
  if(_gracefulDowngradeLevel < 1) _applyGracefulDowngrade();
  _gracefulDowngradeLevel = 2;
  if(window._qFlags){
    if(window._qFlags.smaa !== false) window._qFlags.smaa = false;
  }
  // Contact-shadows mesh uit via _sharedAsset-handle. Behoudt geometrie/
  // material in cache zodat re-attach na een wereld-rebuild niet faalt.
  if(window._contactShadows && window._contactShadows.mesh){
    window._contactShadows.mesh.visible = false;
  }
  if(window.dbg) dbg.markRaceEvent('GRACEFUL-DOWNGRADE', {
    level: 2,
    smaa: false,
    contactShadows: false
  });
}
window._applyGracefulDowngradeLevel2 = _applyGracefulDowngradeLevel2;

// Apply quality downgrade: drop one or two tiers via the shared tier system
// (window._qFlags + window._downgradeQualityTier). Falls back to the original
// binary behaviour (dpr→1, mirror off) if the tier module isn't loaded.
// Extracted so both the main quality-check (frame 30..180 window) and the
// GO-spike detector (frame 0..2) can engage the same downgrade path.
//
// Note: _lowQuality only flips true when we've reached the LOW tier, so the
// mid tier still gets postFX (at quarter-res) and a slower mirror. Modules
// that hard-skipped on `window._lowQuality` (postfx render path, ssao) will
// continue to render on mid; their tier flags decide their own scaling.
function _engageLowQuality(steps){
  // Honour the manual quality-pin set via the pause-overlay buttons.
  // _downgradeQualityTier already returns false on a pin so the tier itself
  // never moves; without this guard the legacy fallback below would still
  // force dpr=1 on a pinned-High session after one bad-frame window.
  if(window._qManualDowngrade) return;
  let tierDowngraded = false;
  if(typeof window._downgradeQualityTier === 'function'){
    tierDowngraded = window._downgradeQualityTier(steps || 1);
  }
  // Only mark _lowQuality (and hide speed-lines / mirror DOM) when we've
  // actually landed on the LOW tier OR when the tier module is missing
  // (legacy fallback path matches pre-PR binary behaviour). Downgrades
  // that stop at MID leave _lowQuality false so postFX + half-speed
  // mirror keep running.
  const atLow = (window._qTier === 'low') || !tierDowngraded;
  if(atLow){
    _lowQuality = true;
    // Mirror DOM is centrally hidden via quality-tier helper (deduped) —
    // fallback inline hide kept for the no-tier-module legacy path.
    if(typeof window._setMirrorDomVisible === 'function'){
      window._setMirrorDomVisible(false);
    } else {
      const mf = document.getElementById('mirrorFrame'); if(mf) mf.style.display = 'none';
      const ml = document.getElementById('mirrorLabel'); if(ml) ml.style.display = 'none';
    }
    const sl = document.getElementById('speedLines'); if(sl) sl.style.display = 'none';
  }
  if(!tierDowngraded && renderer){
    // Legacy path — no tier module. Match the old binary behaviour.
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
  }
}
