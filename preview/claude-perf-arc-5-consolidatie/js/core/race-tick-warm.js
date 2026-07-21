// Ghost RACE-tick prewarm. Tijdens gameState==='COUNTDOWN' skipt loop.js het
// hele RACE/FINISH-blok (regel 179-286), dus op de eerste echte RACE-frame
// worden tientallen update-functies voor het eerst met dt>0 aangeroepen.
// Die cumulatieve first-call kosten (lazy buffers, lazy geometries, first
// reflection-probe bake, first per-world tick, achievement check, etc.) gaven
// op desktop een ~5s freeze direct na 'GO!'.
//
// Deze module roept een veilige whitelist van die functies één keer aan met
// dt=0.0001 tijdens Phase 4.5 prewarm, gemaskt door de loading-overlay, zodat
// hun eerste-call kosten al betaald zijn voor het countdown-GO moment.
//
// NIET in de whitelist: physics/AI (updatePlayer, updateAI), state-mutaties
// (checkJumps/Collisions/TrackLimits/WrongWay/Collectibles, world-checks),
// updateCamera (intro-cam owns 'm tijdens countdown), updateAchievements
// (kan early-game triggers vuren), updateWeatherForecast/QuickRestart
// (timers + UI states). Die functies hebben kleine first-call kosten of zijn
// niet idempotent — beter één lichte spike accepteren dan corrupte state.
//
// Mirror RT prewarm doet één render naar mirrorCamera om het render-target
// te alloceren + mirror-only shader-permutaties te linken (desktop-only;
// mobiel skipt mirror sowieso).

(function(){
  function _safe(name, fn){
    try{ fn(); }
    catch(e){
      if(window.dbg) dbg.warn('warmRaceTick', name+': '+(e&&e.message||e));
    }
  }

  window._warmRaceTick = function _warmRaceTick(){
    if(typeof renderer==='undefined' || !renderer) return;
    const dt = 0.0001;
    const _savedState = (typeof gameState!=='undefined') ? gameState : null;
    const _savedPaused = (typeof gamePaused!=='undefined') ? gamePaused : false;

    // Gate updates that branch on RACE; gamePaused prevents accidental
    // physics ticks elsewhere if any helper observed it.
    try{ if(_savedState!==null) gameState='RACE'; }catch(_){}
    try{ gamePaused=true; }catch(_){}

    // ── Particles ─────────────────────────────────────────────────────────
    if(typeof sparkSystem!=='undefined' && sparkSystem && sparkSystem.update)
      _safe('sparkSystem', ()=>sparkSystem.update(dt));
    if(typeof exhaustSystem!=='undefined' && exhaustSystem && exhaustSystem.update)
      _safe('exhaustSystem', ()=>exhaustSystem.update(dt));
    if(typeof smokeSystem!=='undefined' && smokeSystem && smokeSystem.update)
      _safe('smokeSystem', ()=>smokeSystem.update(dt));
    if(typeof sparkleSystem!=='undefined' && sparkleSystem && sparkleSystem.update)
      _safe('sparkleSystem', ()=>sparkleSystem.update(dt));
    if(typeof dustSystem!=='undefined' && dustSystem && dustSystem.update)
      _safe('dustSystem', ()=>dustSystem.update(dt));
    if(typeof emitAmbientWorldFX==='function')
      _safe('emitAmbientWorldFX', ()=>emitAmbientWorldFX(dt));

    // ── Visual helpers (per-frame) ────────────────────────────────────────
    if(typeof updateCarLights==='function')      _safe('updateCarLights', updateCarLights);
    if(typeof updateBoostGlow==='function')      _safe('updateBoostGlow', updateBoostGlow);
    if(typeof updateBrakeHeat==='function')      _safe('updateBrakeHeat', ()=>updateBrakeHeat(dt));
    if(typeof updateDirt==='function')           _safe('updateDirt', ()=>updateDirt(dt));
    if(typeof updateFlags==='function')          _safe('updateFlags', updateFlags);
    if(typeof _updateExposure==='function')      _safe('_updateExposure', ()=>_updateExposure(dt));
    if(typeof _updateLodCull==='function')       _safe('_updateLodCull', _updateLodCull);
    if(typeof _updateReflectionProbe==='function')_safe('_updateReflectionProbe', ()=>_updateReflectionProbe(dt));
    if(typeof _updateSkylineParallax==='function')_safe('_updateSkylineParallax', _updateSkylineParallax);
    if(typeof _setMotionBlurFromSpeed==='function')_safe('_setMotionBlurFromSpeed', ()=>_setMotionBlurFromSpeed(0));
    // _updateSunArc already prewarmed elders in Phase 4 — skipping here to
    // avoid double-mutating sun position.
    if(typeof updateSkidMarks==='function')      _safe('updateSkidMarks', updateSkidMarks);
    if(typeof updateWeather==='function')        _safe('updateWeather', ()=>updateWeather(dt));
    if(typeof updateSky==='function')            _safe('updateSky', ()=>updateSky(dt));
    if(typeof updateSnow==='function')           _safe('updateSnow', ()=>updateSnow(dt));
    if(typeof updateStormFlash==='function')     _safe('updateStormFlash', ()=>updateStormFlash(dt));
    if(typeof _updateSkyShader==='function')     _safe('_updateSkyShader', _updateSkyShader);
    if(typeof updateRain==='function')           _safe('updateRain', updateRain);
    if(typeof updateCollisionFlash==='function') _safe('updateCollisionFlash', ()=>updateCollisionFlash(dt));
    if(typeof updateCaSpikeDecay==='function')   _safe('updateCaSpikeDecay', ()=>updateCaSpikeDecay(dt));

    // ── HUD helpers (only those NOT in the bestaande updateHUD prewarm) ───
    if(typeof updateSpeedOverlay==='function')   _safe('updateSpeedOverlay', updateSpeedOverlay);
    if(typeof updateDamageSmoke==='function')    _safe('updateDamageSmoke', updateDamageSmoke);
    if(typeof updateRpmBar==='function')         _safe('updateRpmBar', ()=>updateRpmBar(dt));
    if(typeof updateRevLimiter==='function')     _safe('updateRevLimiter', ()=>updateRevLimiter(dt));
    if(typeof updateDriftVisuals==='function')   _safe('updateDriftVisuals', ()=>updateDriftVisuals(dt));
    if(typeof updateNitroVisual==='function')    _safe('updateNitroVisual', updateNitroVisual);
    if(typeof updateNitroFlame==='function')     _safe('updateNitroFlame', ()=>updateNitroFlame(dt));
    if(typeof updateDriverSway==='function')     _safe('updateDriverSway', ()=>updateDriverSway(dt));
    if(typeof updateHazardLights==='function')   _safe('updateHazardLights', updateHazardLights);
    if(typeof updateUnderglowPulse==='function') _safe('updateUnderglowPulse', updateUnderglowPulse);
    if(typeof updateTireCompression==='function')_safe('updateTireCompression', updateTireCompression);
    if(typeof updateBoostTrail==='function')     _safe('updateBoostTrail', updateBoostTrail);
    if(typeof updateGhost==='function')          _safe('updateGhost', ()=>updateGhost(dt));
    if(typeof updateSpeedLines==='function')     _safe('updateSpeedLines', updateSpeedLines);
    if(typeof updatePitStop==='function')        _safe('updatePitStop', ()=>updatePitStop(dt));
    if(typeof updateFastestLapFlash==='function')_safe('updateFastestLapFlash', ()=>updateFastestLapFlash(dt));
    if(typeof updateCloseBattle==='function')    _safe('updateCloseBattle', ()=>updateCloseBattle(dt));

    // ── Audio per-frame helpers ───────────────────────────────────────────
    if(typeof Audio!=='undefined' && Audio){
      if(typeof Audio.updateCrowd==='function')          _safe('Audio.updateCrowd', ()=>Audio.updateCrowd(1));
      if(typeof Audio.updateMusicIntensity==='function') _safe('Audio.updateMusicIntensity', ()=>Audio.updateMusicIntensity(1, 0, false));
      if(typeof Audio.updateThunder==='function')        _safe('Audio.updateThunder', ()=>Audio.updateThunder(dt));
    }
    if(typeof updateAmbientWindSpeed==='function')
      _safe('updateAmbientWindSpeed', ()=>updateAmbientWindSpeed(dt));

    // ── Gameplay checks (safe whitelist) ──────────────────────────────────
    // Deze check* functies + updateAI zijn veilig met dt=0.0001 omdat ze
    // ofwel geen state muteren als de auto stilstaat (alle pickup/jump/
    // collision-pad detecties triggeren op dist<radius, en met player op
    // grid-positie zit niets binnen radius), ofwel alleen lokale per-car
    // state minimaal aanpassen (updateAI: car.lateralOff, car._mActive —
    // geen global race-state). Bewust UITGESLOTEN: updatePlayer
    // (driftTimer/tireWear/totalScore mutaties), checkCollisions (duwt
    // auto's apart ongeacht dt), checkWallCollisions (pusht position+speed),
    // checkCurrentStreams (oceaan-push), checkOrbitingAsteroids
    // (orbit-state mutatie). Hun first-call cost accepteren we.
    if(typeof checkJumps==='function')        _safe('checkJumps', checkJumps);
    if(typeof checkSpinPads==='function')     _safe('checkSpinPads', ()=>checkSpinPads(dt));
    if(typeof checkBoostPads==='function')    _safe('checkBoostPads', checkBoostPads);
    if(typeof checkCollectibles==='function') _safe('checkCollectibles', checkCollectibles);
    if(typeof checkTrackLimits==='function')  _safe('checkTrackLimits', ()=>checkTrackLimits(dt));
    if(typeof checkWrongWay==='function')     _safe('checkWrongWay', ()=>checkWrongWay(dt));

    // Wereld-specifieke checks (alleen de actieve wereld, en alleen die
    // zonder positie-push). checkOrbitingAsteroids/checkSpaceRailgun/
    // checkCurrentStreams blijven uit deze prewarm.
    const _aw = (typeof activeWorld!=='undefined') ? activeWorld : null;
    if(_aw==='space'){
      if(typeof checkGravityZones==='function') _safe('checkGravityZones', ()=>checkGravityZones(dt));
      if(typeof checkWarpTunnels==='function')  _safe('checkWarpTunnels', ()=>checkWarpTunnels(dt));
    } else if(_aw==='deepsea'){
      if(typeof checkAbyssCracks==='function')  _safe('checkAbyssCracks', ()=>checkAbyssCracks(dt));
      if(typeof checkTreasureTrail==='function')_safe('checkTreasureTrail', ()=>checkTreasureTrail(dt));
    }

    // Visual/AI helpers die op gameState==='RACE' draaien (niet in updateHUD).
    if(typeof updateBoostArrows==='function')       _safe('updateBoostArrows', updateBoostArrows);
    if(typeof updateSlipstreamVisuals==='function') _safe('updateSlipstreamVisuals', updateSlipstreamVisuals);
    if(typeof updateSafetyCar==='function')         _safe('updateSafetyCar', ()=>updateSafetyCar(dt));

    // updateAI per AI car. Eerste call kan 1-3ms zijn (track-curve lookahead
    // + personality init + steering compute). Met N AI cars is dat
    // cumulatief de grootste niet-eerder-gewarmde post.
    if(typeof updateAI==='function' && typeof carObjs!=='undefined' && carObjs){
      const _pIdx = (typeof playerIdx!=='undefined') ? playerIdx : 0;
      for(let i=0; i<carObjs.length; i++){
        if(i === _pIdx) continue;
        const _car = carObjs[i];
        if(!_car) continue;
        _safe('updateAI['+i+']', ()=>updateAI(_car, dt));
      }
    }

    // ── Mirror RT + first render (desktop only — mobile skipt mirror) ─────
    if(typeof window._isMobile === 'undefined' || !window._isMobile){
      if(typeof mirrorCamera!=='undefined' && mirrorCamera && typeof scene!=='undefined' && scene){
        _safe('mirror.prewarmRender', ()=>{
          // Mirror render target wordt door updateMirror lazy gealloceerd
          // op _aiFrameCounter>5; door hier één keer expliciet te renderen
          // forceer je de RT-allocatie + mirror-only shader permutaties.
          renderer.render(scene, mirrorCamera);
        });
      }
    }

    // ── Final renderWithPostFX op de echte chase-cam pose ─────────────────
    // Phase 4 zette camera op de intro start-pose (FOV 80, offset (0,35,25)
    // — zie navigation.js Phase 4). Onze update-calls hierboven mutateren
    // scene-state. Een render met die intro-pose mist potentiële shader-
    // permutaties die de echte race-frame chase-cam frustum aanspreekt.
    // Tijdelijk camera op chase-cam end-pose zetten, één renderWithPostFX,
    // dan exacte camera-state herstellen zodat updateIntroCamera/updateCamera
    // niet jolt-lerpen op de eerste echte race-frame.
    if(typeof camera!=='undefined' && camera && typeof scene!=='undefined' && scene){
      const _player = (typeof carObjs!=='undefined' && typeof playerIdx!=='undefined') ? carObjs[playerIdx] : null;
      const _camPosVar = (typeof camPos!=='undefined') ? camPos : null;
      const _camTgtVar = (typeof camTgt!=='undefined') ? camTgt : null;

      if(_player && _player.mesh){
        // Snapshot.
        const _saveCamPosX = camera.position.x, _saveCamPosY = camera.position.y, _saveCamPosZ = camera.position.z;
        const _saveCamQuatX = camera.quaternion.x, _saveCamQuatY = camera.quaternion.y, _saveCamQuatZ = camera.quaternion.z, _saveCamQuatW = camera.quaternion.w;
        const _saveCamFov = camera.fov;
        const _saveCamPosCustomX = _camPosVar ? _camPosVar.x : 0, _saveCamPosCustomY = _camPosVar ? _camPosVar.y : 0, _saveCamPosCustomZ = _camPosVar ? _camPosVar.z : 0;
        const _saveCamTgtCustomX = _camTgtVar ? _camTgtVar.x : 0, _saveCamTgtCustomY = _camTgtVar ? _camTgtVar.y : 0, _saveCamTgtCustomZ = _camTgtVar ? _camTgtVar.z : 0;

        _safe('renderWithPostFX.chaseCam', ()=>{
          const _aspect = camera.aspect || (innerWidth/innerHeight);
          const _portrait = _aspect < 1;
          // Chase-cam end-pose (exact dezelfde als updateIntroCamera op t=1
          // en _warmRenderMultiPose Pose B).
          const _offY = _portrait ? 4.6 : 5.8;
          const _offZ = _portrait ? 10.5 : 13.5;
          // Yaw-only quaternion: rotate (0, offY, offZ) door car yaw.
          const _yawY = _player.mesh.rotation.y;
          const _sy = Math.sin(_yawY), _cy = Math.cos(_yawY);
          const _px = _player.mesh.position.x + (_sy * _offZ);
          const _py = _player.mesh.position.y + _offY;
          const _pz = _player.mesh.position.z + (_cy * _offZ);
          camera.position.set(_px, _py, _pz);
          // LookAt offset (0, 0.8, -7) rotated door yaw.
          const _lx = _player.mesh.position.x + (_sy * -7);
          const _ly = _player.mesh.position.y + 0.8;
          const _lz = _player.mesh.position.z + (_cy * -7);
          camera.lookAt(_lx, _ly, _lz);
          // FOV: zelfde formule als _warmRenderMultiPose regel 152-159.
          if(_portrait){
            camera.fov = window._isMobile ? 72 : 68;
          } else {
            const _hfov = window._isMobile ? 96 : 92;
            camera.fov = 2 * Math.atan(Math.tan(_hfov * Math.PI / 360) / _aspect) * 180 / Math.PI;
          }
          camera.updateProjectionMatrix();
          if(typeof renderWithPostFX==='function') renderWithPostFX(scene, camera);
          else renderer.render(scene, camera);
        });

        // Restore exact pre-warm state. camPos/camTgt waren door
        // _warmRenderMultiPose en Phase 4 setup ingesteld; updateIntroCamera
        // tijdens countdown leest die niet (gebruikt eigen scratch en zet
        // camPos/camTgt per frame). Maar voor de zekerheid restoren we ze
        // exact zoals ze waren.
        camera.position.set(_saveCamPosX, _saveCamPosY, _saveCamPosZ);
        camera.quaternion.set(_saveCamQuatX, _saveCamQuatY, _saveCamQuatZ, _saveCamQuatW);
        camera.fov = _saveCamFov;
        camera.updateProjectionMatrix();
        if(_camPosVar) _camPosVar.set(_saveCamPosCustomX, _saveCamPosCustomY, _saveCamPosCustomZ);
        if(_camTgtVar) _camTgtVar.set(_saveCamTgtCustomX, _saveCamTgtCustomY, _saveCamTgtCustomZ);
      } else {
        // Fallback: geen player car beschikbaar — render gewoon op huidige pose.
        _safe('renderWithPostFX.fallback', ()=>{
          if(typeof renderWithPostFX==='function') renderWithPostFX(scene, camera);
          else renderer.render(scene, camera);
        });
      }
    }

    // Restore.
    try{ if(_savedState!==null) gameState=_savedState; }catch(_){}
    try{ gamePaused=_savedPaused; }catch(_){}
  };
})();
