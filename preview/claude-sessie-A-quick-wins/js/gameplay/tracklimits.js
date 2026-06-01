// js/gameplay/tracklimits.js — non-module script.

'use strict';

// Wrong-way detector accumulator (uit main.js verhuisd). Builds up zolang
// speler tegenovergestelde richting rijdt; reset in gameplay/race.js +
// gameplay/spacefx.js + in deze module bij sector-cross. Cross-script reads
// in ui/hud.js voor _elWrongWay overlay-toggle.
let _wrongWayTimer=0;

// Module-level scratch Vector3 for the recovery cam-offset compute. Recovery
// is rare (off-track / void-fall), but this mirrors the hoist-pattern used
// in cars/physics.js + ai.js + effects/visuals.js. _tlRecOff is rewritten
// per call via .set() then .applyQuaternion(); never read between calls.
const _tlRecOff = (typeof THREE!=='undefined') ? new THREE.Vector3() : null;
// Per-frame tangent scratch for checkWrongWay — runs every frame on the
// player car. Without this hoist, trackCurve.getTangent(t) allocates a
// fresh Vector3 per frame. Same pattern used by cars/ai.js _aiTg/_aiCurA.
const _tlWwTg = (typeof THREE!=='undefined') ? new THREE.Vector3() : null;

// Throttle for dbg.log of the tracklimits state — once-per-second snapshot
// makes it cheap to leave on while still useful for diagnosing future
// regressions like the sandstorm-waypoint zigzag bug. Logs progress + the
// raw distance + active world via the 'tracklimits' channel (filterable
// via localStorage.src_debug_channels).
let _tlDbgLastT=0;
// Detect a stuck-recovery loop (recovery re-trigger within a frame of exit
// — the symptom of a malformed curve where trackDist keeps reporting > 30
// even on the correct asphalt position). Logged at warn level once per
// race so the dev console flags it without log spam.
let _tlStuckRecoveryWarned=false;
let _tlRecoveryEntryT=0;

function checkTrackLimits(dt){
  const car=carObjs[playerIdx];if(!car||car.finished)return;
  if(recoverActive){
    recoverTimer-=dt;
    // Warn once if recovery hangs > 5s (means triggerRecovery keeps re-firing
    // because the underlying trackDist is permanently > RECOVER_DIST — likely
    // a malformed curve / waypoint regression on this world).
    if(window.dbg&&!_tlStuckRecoveryWarned&&_tlRecoveryEntryT&&_nowSec-_tlRecoveryEntryT>5){
      _tlStuckRecoveryWarned=true;
      dbg.warn('tracklimits','recovery hung >5s on world='+activeWorld+
               ' progress='+car.progress.toFixed(3)+' — possible waypoint/curve regression');
    }
    if(recoverTimer<=0){recoverActive=false;hideBanner();_tlRecoveryEntryT=0;_tlStuckRecoveryWarned=false;}
    return;
  }
  if(car._fallingIntoSpace)return; // handled by updateSpaceWorld
  if(car.inAir)return;
  const d=trackDist(car.mesh.position,car.progress);
  if(window.dbg&&_nowSec-_tlDbgLastT>1.0){
    _tlDbgLastT=_nowSec;
    dbg.log('tracklimits','prog='+car.progress.toFixed(3)+
            ' dist='+d.toFixed(2)+' TW='+TW+' world='+activeWorld);
  }
  if(activeWorld==='space'){
    // In space: going off edge starts a fall rather than instant recovery
    if(d>RECOVER_DIST)triggerSpaceFall(car);
    else if(d>WARN_DIST){if(_elWarn)_elWarn.style.display='block';}
    else{if(_elWarn)_elWarn.style.display='none';}
  }else if(activeWorld==='deepsea'){
    if(d>RECOVER_DIST)triggerDeepSeaRecovery(car);
    else if(d>WARN_DIST){if(_elWarn)_elWarn.style.display='block';}
    else{if(_elWarn)_elWarn.style.display='none';}
  }else{
    if(d>RECOVER_DIST)triggerRecovery(car);
    else if(d>WARN_DIST){if(_elWarn)_elWarn.style.display='block';}
    else{if(_elWarn)_elWarn.style.display='none';}
  }
  // Phase 3 deferred — gravel/dust spray emitter wanneer car off-track maar
  // niet in recovery. d > WARN_DIST = "lichte off-track" / kerb-overschrijding.
  // d > RECOVER_DIST = "diep off-track" maar recovery start sowieso meteen.
  // Rate-limited 2 particles/frame zodat een lange off-track-rit niet de
  // hele wereld stoft. Skipt op space/deepsea (geen gravel daar).
  // Warm dust-tint per world: sandstorm/volcano = bruin-warm,
  // arctic/pier47/guangzhou = koel-grijs, default = bruin.
  if(d>WARN_DIST && d<RECOVER_DIST && Math.abs(car.speed)>0.5 &&
     activeWorld!=='space' && activeWorld!=='deepsea' &&
     typeof exhaustSystem!=='undefined' && exhaustSystem && exhaustSystem.emit){
    const _isWarm=(activeWorld==='sandstorm' ||
                   activeWorld==='volcano' || activeWorld==='candy');
    const r=_isWarm?0.82:0.62, g=_isWarm?0.66:0.62, b=_isWarm?0.45:0.62;
    // Emit twee dust-poofs from rear-corner positions
    for(let s=0;s<2;s++){
      const cy=Math.cos(car.mesh.rotation.y), sy=Math.sin(car.mesh.rotation.y);
      const sx=(s===0?-1:1)*0.9, sz=1.2;
      const wx=car.mesh.position.x+(sx*cy+sz*sy);
      const wz=car.mesh.position.z+(-sx*sy+sz*cy);
      exhaustSystem.emit(
        wx, car.mesh.position.y+0.14, wz,
        (Math.random()-0.5)*0.08, 0.04+Math.random()*0.04, (Math.random()-0.5)*0.08,
        2.0, r, g, b, 0.55
      );
    }
    // Phase 8.2 — off-track dirt builds 3× sneller.
    if(car.mesh && car.mesh.userData) car.mesh.userData._dirtRate = 3.0;
  } else if(car.mesh && car.mesh.userData){
    car.mesh.userData._dirtRate = 1.0;
  }
}

function triggerRecovery(car){
  recoverActive=true;recoverTimer=2.2;car.speed=0;car.vy=0;car.inAir=false;
  _tlRecoveryEntryT=_nowSec;_tlStuckRecoveryWarned=false;
  if(_elWarn)_elWarn.style.display='none';
  if(_elWrongWay)_elWrongWay.style.display='none';
  _wrongWayTimer=0;
  // Use car.progress (tracks actual race direction) so the car always faces forward
  const t=car.progress;
  const pt=trackCurve.getPoint(t);
  const tgR=trackCurve.getTangent(t).normalize();
  car.mesh.position.copy(pt);car.mesh.position.y=.35;
  car.mesh.rotation.set(0,Math.atan2(-tgR.x,-tgR.z),0); // clean Euler — avoids gimbal-lock steering flip
  _tlRecOff.set(0,5.8,13.5).applyQuaternion(car.mesh.quaternion);
  camPos.copy(car.mesh.position).add(_tlRecOff);
  camShake=.5;Audio.playRecovery();showBanner('RECOVERED','#ff4400',2000);
  spawnSafetyCar((car.progress+.055)%1);
}

function triggerDeepSeaRecovery(car){
  recoverActive=true;recoverTimer=2.0;car.speed=0;car.vy=0;car.inAir=false;
  _tlRecoveryEntryT=_nowSec;_tlStuckRecoveryWarned=false;
  if(_elWarn)_elWarn.style.display='none';
  if(_elWrongWay)_elWrongWay.style.display='none';
  _wrongWayTimer=0;
  const t=car.progress;
  const pt=trackCurve.getPoint(t);
  const tgR=trackCurve.getTangent(t).normalize();
  car.mesh.position.copy(pt);car.mesh.position.y=.35;
  car.mesh.rotation.set(0,Math.atan2(-tgR.x,-tgR.z),0);
  _tlRecOff.set(0,5.8,13.5).applyQuaternion(car.mesh.quaternion);
  camPos.copy(car.mesh.position).add(_tlRecOff);
  camShake=.4;Audio.playRecovery();
  showBanner('🐠 RESCUED BY DOLPHINS','#00ddaa',2000);
  // Bubble burst at recovery point
  sparkSystem.emit(pt.x,.5,pt.z,0,.14,0,20,.2,.9,.9,1);
}

function checkWrongWay(dt){
  const car=carObjs[playerIdx];if(!car||car.finished||recoverActive)return;
  if(_raceStartGrace>0)return;
  // Compare car's forward direction with track tangent at current progress.
  // getTangent(t,target) uses _tlWwTg scratch; avoids fresh Vector3 per frame.
  const tg=trackCurve.getTangent(car.progress,_tlWwTg);
  const fwdX=Math.sin(-car.mesh.rotation.y),fwdZ=-Math.cos(car.mesh.rotation.y);
  const dot=fwdX*tg.x+fwdZ*tg.z;
  const spd=Math.abs(car.speed);
  if(dot<-0.45&&spd>.35){
    _wrongWayTimer+=dt;
    if(_wrongWayTimer>.6&&_elWrongWay)_elWrongWay.style.display='block';
  }else{
    _wrongWayTimer=0;
    if(_elWrongWay)_elWrongWay.style.display='none';
  }
}


function trackDist(pos,progressHint){
  // Windowed search using car's known progress as hint — much faster than full scan
  const L=curvePts.length,win=Math.floor(L*.1);
  const start=Math.round((progressHint||0)*(L-1));
  let best=Infinity;
  for(let d=-win;d<=win;d++){
    const i=((start+d)%L+L)%L;
    const dx=pos.x-curvePts[i].x,dz=pos.z-curvePts[i].z;
    const dist=dx*dx+dz*dz;if(dist<best)best=dist;
  }
  return Math.sqrt(best);
}

function nearestT(pos,hint=null){
  const L=curvePts.length;
  if(hint!==null){
    // Fast windowed search: only check ±7% around last known position
    const win=Math.floor(L*.08),start=Math.round(hint*(L-1));
    let best=hint,bestD=Infinity;
    for(let d=-win;d<=win;d++){
      const i=((start+d)%L+L)%L;
      const dist=pos.distanceToSquared(curvePts[i]);
      if(dist<bestD){bestD=dist;best=i/(L-1);}
    }
    return best;
  }
  // Full search (first call only)
  let best=0,bestD=Infinity;
  for(let i=0;i<L;i++){const d=pos.distanceToSquared(curvePts[i]);if(d<bestD){bestD=d;best=i/(L-1);}}
  return best;
}

function tickProgress(car){
  car.prevProg=car.progress;
  car.progress=nearestT(car.mesh.position,car.progress);

  // ── Sector timing (player only) ─────────────
  if(car.isPlayer){
    const sec=car.progress<.333?0:car.progress<.667?1:2;
    if(sec!==_currentSector){
      const st=_nowSec-_sectorStart;
      const prev=_sectorBests[_currentSector];
      if(st<_sectorBests[_currentSector])_sectorBests[_currentSector]=st;
      if(_currentSector===0&&st<_bestS1)_bestS1=st;
      if(_currentSector===1&&st<_bestS2)_bestS2=st;
      if(_currentSector===2&&st<_bestS3)_bestS3=st;
      const _sb=[_bestS1,_bestS2,_bestS3][_currentSector];
      if(st<=_sb+0.001&&car.lap>=1)triggerCombo('SECTOR BEST');
      if(prev<Infinity){
        const d=st-prev,sign=d>=0?'+':'';
        const col=d<0?'#00ff88':'#ff5544';
        showSectorSplit(`S${_currentSector+1}  ${sign}${d.toFixed(2)}s`,col);
        const _sc2=st<_sb?'#00ff88':st<_sb*1.03?'#ffff00':'#ff4444';
        const _sl2=['S1','S2','S3'][_currentSector];
        const _sd2=_sb===Infinity?'':((st-_sb)>0?'+':'')+(st-_sb).toFixed(3);
        showSectorFlash(_sl2,st,_sd2,_sc2);
        // Color the sector panel cell
        const sEl=document.getElementById('secT'+(_currentSector+1));
        if(sEl){sEl.textContent=st.toFixed(2)+'s';sEl.style.color=d<-.05?'#cc44ff':d<0?'#00ee66':'#ff5544';}
      } else {
        // First lap — just record it in the panel
        const sEl=document.getElementById('secT'+(_currentSector+1));
        if(sEl){sEl.textContent=st.toFixed(2)+'s';sEl.style.color='#ffbb00';}
      }
      if(car.isPlayer&&window._rpp)_rpp.mark('sector:cross',{from:_currentSector,to:sec});
      _sectorStart=_nowSec;_currentSector=sec;
    }
  }

  if(car.prevProg>.86&&car.progress<.12){
    const now=_nowSec;
    if(car.isPlayer&&car.lap>=1){
      lastLapTime=now-lapStartTime;lapStartTime=now;
      const isPB=lastLapTime<bestLapTime&&bestLapTime!==Infinity;
      if(lastLapTime<bestLapTime)bestLapTime=lastLapTime;
      _lapTimes.push(lastLapTime); // store for finish screen
      saveGhostIfPB(); // record ghost positions if this was a PB
      // Check overall fastest lap (purple flash) — only after at least one recorded lap
      const isOverallFastest=lastLapTime<_overallFastestLap&&_overallFastestLap!==Infinity;
      if(isOverallFastest){
        _overallFastestLap=lastLapTime;
        _fastestLapFlashT=2.2;
        setTimeout(()=>showBanner('💜 FASTEST LAP! '+fmtTime(lastLapTime),'#cc44ff',2800),200);
        beep(1760,.12,.35,0,'sine');beep(2093,.14,.28,.1,'sine');beep(2637,.18,.22,.2,'triangle');beep(3136,.14,.16,.32,'sine');
        floatText('💜 FASTEST LAP!','#cc44ff',innerWidth*.5,innerHeight*.38);
      }else if(isPB){
        setTimeout(()=>showBanner('⏱ NEW BEST: '+fmtTime(bestLapTime),'#00ff88',2200),1500);
        beep(1760,.1,.28,0,'sine');beep(2093,.15,.22,.09,'sine');beep(2637,.18,.18,.18,'triangle');
      }
      onLapComplete();
    }
    // Record best lap only on cross 2+ (car.lap is still pre-increment here),
    // so the spurious "rolled past S/F line from grid" first cross doesn't
    // register as a 1–3s bestLap. Mirrors how the player's lapStartTime is
    // anchored at GO and only consumed once car.lap>=1.
    if(car.lap>=1){
      if(car._lapStart){
        const lt=now-car._lapStart;
        if(!car.bestLap||lt<car.bestLap)car.bestLap=lt;
      }
      car._lapStart=now;
    }
    car.lap++;
    if(car.isPlayer&&window._rpp)_rpp.mark('lap:cross',{lap:car.lap,lastLapMs:Math.round((lastLapTime||0)*1000)});
    if(car.isPlayer&&car.lap>1&&car.lap<=TOTAL_LAPS)showBannerTop('LAP '+car.lap+' / '+TOTAL_LAPS,'#00eeff',2000);
    if(car.isPlayer&&car.lap===TOTAL_LAPS)showBannerTop('\u{1F3C1} FINAL LAP!','#ffd700',3000);
    if(car.isPlayer&&car.lap<=TOTAL_LAPS){
      if(car.lap===TOTAL_LAPS){
        showBanner('🏁 FINAL LAP!','#ffee00',2800);
        beep(880,.14,.42,0,'square');beep(1320,.1,.32,.12,'square');beep(1760,.08,.22,.22,'square');
        Audio.setFinalLap();
        // Big crowd reaction for final lap
        Audio.playCrowdCheer();setTimeout(()=>Audio.playCrowdCheer(),250);setTimeout(()=>Audio.playCrowdCheer(),500);
        if(_crowdGain&&audioCtx){_crowdGain.gain.setTargetAtTime(0.085,audioCtx.currentTime,.15);setTimeout(()=>{if(_crowdGain&&audioCtx)_crowdGain.gain.setTargetAtTime(0.062,audioCtx.currentTime,2.0);},2000);}
      }else{
        showBanner('LAP '+car.lap+' / '+TOTAL_LAPS,'#00ccff',1600);
        Audio.playWorldLapEvent();
      }
    }
    // Finish: set FINISH state immediately for victory orbit, show overlay after 5.5s
    if(car.lap>TOTAL_LAPS&&!car.finished){
      car.finished=true;car._finishTime=now;
      if(car.isPlayer){
        Audio.playFanfare();
        // Check for champion achievement — only if player truly finished 1st
        const _finPos=getPositions().findIndex(c=>c.isPlayer)+1;
        if(_finPos===1)unlockAchievement('CHAMPION');
        // Phase 13D — per-world finish-line celebration burst
        if(typeof playFinishCelebration === 'function'){
          playFinishCelebration(activeWorld, car.mesh.position);
        }
        // Phase R2.7 — cinematic finish slow-mo: 700ms timer dat loop.js
        // dt-scale neemt naar 0.30 voor dramatische line-crossing punch.
        // FOV punch (extra +6° decayend over 700ms) via camera.js read.
        window._finishSlowMoTimer = 0.70;
        window._finishFovKick = 1.0;
        gameState='FINISH';_victoryOrbit=true;
        const hud=document.getElementById('hud');if(hud)hud.style.display='none';
        const vh=document.getElementById('victoryHint');if(vh)vh.style.display='block';
        setTimeout(()=>{
          _victoryOrbit=false;
          const vh2=document.getElementById('victoryHint');if(vh2)vh2.style.display='none';
          showFinish();
        },5500);
      }
    }
  }
}

