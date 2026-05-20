// js/cars/physics.js — non-module script.

'use strict';

// Pre-allocated scratch vectors (uit main.js verhuisd) — cross-script
// zichtbaar voor effects/night.js + visuals.js die _plFwd/_plRt lezen.
const _plFwd=new THREE.Vector3(),_plBk=new THREE.Vector3(),_plRt=new THREE.Vector3();
const _slipFwd=new THREE.Vector3(),_slipDir=new THREE.Vector3();

// Brake-release detector — set elke frame in updatePlayer, gereset in race.js.
let _wasBraking=false;

// Cached DOM ref for the S/F-straight speed-trap badge. Was a per-frame
// getElementById on the hottest stretch of track (progress 0.005..0.025 =
// exactly the first seconds after GO). Caches lazily on first access; auto-
// nulls when not in the DOM (e.g. on TITLE screen replace).
let _speedTrapElCache=null;

// Off-track friction + popup label per surface. Keyed by the surface tag in
// audio/samples.js → WORLD_DEFAULT_SURFACE. Friction multipliers picked to
// preserve the legacy per-world values (.09 space, .13 deepsea, .18 default).
// Used by the off-track block in updatePlayer below.
const _OFFTRACK_PROFILES={
  metal:   {friction:0.09, label:'MOON DUST!', color:'#aaaadd', chance:0.03},
  water:   {friction:0.13, label:'SEABED!',    color:'#44ddbb', chance:0.04},
  sand:    {friction:0.18, label:'SAND!',      color:'#d4a55a', chance:0.04},
  ice:     {friction:0.18, label:'ICE!',       color:'#aaddff', chance:0.04},
  asphalt: {friction:0.18, label:'OFF TRACK!', color:'#88dd44', chance:0.04},
  dirt:    {friction:0.18, label:'GRAVEL!',    color:'#aa8855', chance:0.04},
};
// Per-world override row for stylistic copy that doesn't follow the surface
// (Candy's frosting was a hand-picked callout — keep the .22 sticky feel +
// custom emoji label).
const _OFFTRACK_WORLD_OVERRIDES={
  candy: {friction:0.22, label:'FROSTING! 🧁', color:'#ff66aa', chance:0.05},
  // Pier 47: industrial harbour, off-track means slipping into the kade-edge
  // gravel/spillage. Sodium-orange popup colour (#ff8830) matches the
  // WORLD_TRACK_PALETTE.pier47 kerbEmissive — same visual language as the
  // glowing kerbs the player just left. Friction stays at the asphalt
  // baseline (.18) since the surface is asphalt; only the copy + colour change.
  pier47: {friction:0.18, label:'OFF DOCK!', color:'#ff8830', chance:0.04},
  // Guangzhou Cinematic: off-track is wet urban kerb / pavement edge.
  // Neon-magenta popup (#ff2080) matches kerbEmissive. Surface stays asphalt
  // (urban boulevard — no gravel/grass margin). friction .18 (same as pier47).
  guangzhou: {friction:0.18, label:'OFF GRID!', color:'#ff2080', chance:0.04},
};

function updatePlayer(dt){
  if(recoverActive)return;
  const car=carObjs[playerIdx];if(!car||car.finished)return;
  // Pit stop active — car is fully stopped, no input
  if(_pitStopActive){car.speed=0;return;}

  const acc=keys['ArrowUp']||keys['KeyW'];
  const brk=keys['ArrowDown']||keys['KeyS'];
  const lft=keys['ArrowLeft']||keys['KeyA'];
  const rgt=keys['ArrowRight']||keys['KeyD'];
  const hbk=keys['Space'];
  const nit=keys['KeyN'];

  // Nitro — longer duration + stronger boost (user-tuned: lasts ~5s instead of ~2.9s)
  const _prevNitro=nitroActive;
  nitroActive=false;
  // Final lap: nitro recharges 40% faster (push to the end)
  const finalLapBonus=car.lap>=TOTAL_LAPS?1.4:1;
  if(nit&&nitroLevel>0){nitroActive=true;nitroLevel=Math.max(0,nitroLevel-20*dt);}
  else{nitroLevel=Math.min(100,nitroLevel+16*dt*finalLapBonus);}
  if(nitroActive&&!_prevNitro){Audio.playNitro();onNitroActivate();Audio.setNitro(true);}
  if(!nitroActive&&_prevNitro&&musicSched&&musicSched.setNitro)musicSched.setNitro(false);
  if(_elNitro)_elNitro.style.height=nitroLevel+'%';
  if(_elNitroIndFill)_elNitroIndFill.style.width=nitroLevel+'%';
  if(_elNitroInd){
    const ready=nitroLevel>=99.5;
    if(ready!==_elNitroInd._wasReady){
      _elNitroInd.classList.toggle('ready',ready);
      _elNitroInd._wasReady=ready;
    }
  }

  const _dmgMult=1-Math.min(0.18,((car.hitCount||0)/6)*.18); // up to 18% speed penalty at 6 hits
  // Tire temperature grip modifier
  const _avgTemp=(_tireTemp.fl+_tireTemp.fr+_tireTemp.rl+_tireTemp.rr)*.25;
  const _tempGrip=_avgTemp<0.25?0.78+_avgTemp*.88: // cold tires — up to 22% penalty
                  _avgTemp<0.72?1.0:                 // optimal range
                  1.0-(_avgTemp-0.72)*0.5;           // overheated — up to 14% penalty
  let MAX=car.def.topSpd*SPEED_TUNING.topSpdMult*_dmgMult*_tempGrip*(car.boostTimer>0?1.55:1)*(nitroActive?1.55:1);
  // Racing line grip bonus (main straight + key zones)
  let _gripZoneBonus=0;
  for(const [s,e,b] of GRIP_BONUS_ZONES){
    const inZ=s<e?(car.progress>=s&&car.progress<=e):(car.progress>=s||car.progress<=e);
    if(inZ){const offDist=trackDist(car.mesh.position,car.progress);if(offDist<TW*.55)_gripZoneBonus=b;}
  }
  MAX*=(1+_gripZoneBonus);
  // Rain reduces grip
  if(isRain)MAX*=.88;
  // SPEED_TUNING: ACC scaled by accelMult; brake derives from ACC*2.4
  // and is additionally scaled by brakeMult to give matching decel
  // for the new higher topspeed.
  const ACC=car.def.accel*SPEED_TUNING.accelMult,H=car.def.hdlg*(1-car.tireWear*.42)*(isRain?.72:1);

  if(acc)car.speed=Math.min(MAX,car.speed+ACC*dt*60);
  else if(brk)car.speed=Math.max(-MAX*.35,car.speed-ACC*2.4*SPEED_TUNING.brakeMult*dt*60);
  else car.speed*=Math.pow(.956,dt*60);
  if(hbk)car.speed*=Math.pow(.875,dt*60);
  if(Math.abs(car.speed)<.0008)car.speed=0;

  if(hbk&&Math.abs(car.speed)>.5){addSkidMark(car);if(Math.random()<.22)Audio.playScreech();}
  // Skid marks on hard braking
  if(brk&&Math.abs(car.speed)>.95&&Math.random()<.28){addSkidMark(car,0.55);}
  // Tire smoke on hard braking
  if(brk&&Math.abs(car.speed)>.8&&Math.random()<.18){
    exhaustSystem.emit(car.mesh.position.x,car.mesh.position.y+.15,car.mesh.position.z,(Math.random()-.5)*.04,.02,(Math.random()-.5)*.04,2,.9,.9,.9,.5);
  }
  // Water spray in rain
  if(isRain&&Math.abs(car.speed)>.5&&Math.random()<.22){
    exhaustSystem.emit(car.mesh.position.x,car.mesh.position.y+.1,car.mesh.position.z,(Math.random()-.5)*.08,.06+Math.random()*.04,(Math.random()-.5)*.08,3,.7,.8,1,.35);
  }
  // Suspension vertical bounce — Phase 9.5 hotfix: volledig uitgezet.
  // Eerdere fix probeerde ±6mm 2.5Hz bob te geven maar user reportte
  // alsnog "trillen enorm". Bounce was te subtiel voor "alive feel"
  // maar wel genoeg om jitter-perceptie te triggeren, plus botste met
  // car.vy landing-physics. Cars rijden nu vlak op asfalt — body-tilt
  // (rotation.x/z) + contact-shadow + speed-lines bieden voldoende
  // motion-feel.
  if(!car.inAir){
    car.mesh.position.y = 0.35;
  }

  // Drift detection + mini-turbo
  if(hbk&&Math.abs(car.speed)>.8){
    driftTimer+=dt;driftScore=Math.floor(driftTimer*120);
    if(driftTimer>.3)showPopup('DRIFT! +'+driftScore,'#ff8800');
    if(driftTimer>=1.5)_miniTurboReady=true;
  }else{
    if(driftTimer>1){
      showPopup('DRIFT! +'+driftScore+' pts','#ff8800',1200);
      floatText('DRIFT +'+driftScore,'#ff8800',innerWidth*.5,innerHeight*.6);
      totalScore+=driftScore;
    }
    if(_miniTurboReady&&!hbk&&driftTimer>0){
      // Mini-turbo burst on drift release
      car.boostTimer=Math.max(car.boostTimer,.6+driftTimer*.15);
      showPopup('MINI TURBO! 🔥','#ff4400',900);
      floatText('🔥 TURBO!','#ff4400',innerWidth*.5,innerHeight*.55);
      _miniTurboReady=false;
    }
    driftTimer=0;driftScore=0;
  }

  // Drift tire smoke — dark-gray puff from rear wheels while sliding.
  // Triggers on handbrake-slide above walking speed (existing case)
  // AND on hard sideways slip (driftTimer>0.4) so a power-oversteer
  // drift without handbrake also smokes. Uses the dedicated smokeSystem
  // (gray, expanding, gentle upward drift) instead of exhaustSystem
  // — that one is now reserved for warm dust kicks (see V4 water spray).
  // Player-only for now; AI silhouettes stay readable from chase cam.
  const _driftSmoke = (hbk && Math.abs(car.speed) > 0.8) ||
                      (driftTimer > 0.4 && Math.abs(car.speed) > 1.2);
  if(_driftSmoke && smokeSystem && smokeSystem.emit){
    const cy = Math.cos(car.mesh.rotation.y), sy = Math.sin(car.mesh.rotation.y);
    for(let s=0;s<3;s++){
      const sxL = (Math.random()-0.5)*0.4 + (s%2===0?-1.0:1.0);  // alternate L/R rear
      const szL = 1.0 + Math.random()*0.6;
      const wx = car.mesh.position.x + (sxL*cy + szL*sy);
      const wz = car.mesh.position.z + (-sxL*sy + szL*cy);
      smokeSystem.emit(
        wx, car.mesh.position.y + 0.18, wz,
        (Math.random()-0.5)*0.08, 0.04 + Math.random()*0.05, (Math.random()-0.5)*0.08,
        2.4, 0.46, 0.46, 0.48, 0.82
      );
    }
  }
  // Sessie 02 V4 — water spray on wet-world tracks at speed. dustSystem
  // with a cyan tint reads as splash mist. Throttled (1 puff/wheel/frame
  // when fast enough) and gated to pier47/guangzhou/deepsea so
  // the dry worlds aren't unexpectedly soggy.
  const _wetWorld = (activeWorld==='pier47' || activeWorld==='guangzhou' ||
                     activeWorld==='deepsea');
  if(_wetWorld && Math.abs(car.speed) > 1.4 && dustSystem && dustSystem.emit){
    const cyW = Math.cos(car.mesh.rotation.y), syW = Math.sin(car.mesh.rotation.y);
    // One spray puff per wheel-pair per frame is plenty; alternate sides
    // for that staggered spray look.
    const side = ((_aiFrameCounter|0) % 2 === 0) ? -1 : 1;
    const sxW = side*0.9, szW = 1.1+Math.random()*0.4;
    const wxW = car.mesh.position.x + (sxW*cyW + szW*syW);
    const wzW = car.mesh.position.z + (-sxW*syW + szW*cyW);
    dustSystem.emit(
      wxW, 0.06, wzW,
      (Math.random()-0.5)*0.10, 0.02+Math.random()*0.04, (Math.random()-0.5)*0.10,
      1, 0.55, 0.78, 0.95, 0.55
    );
  }

  // Spin pad effect
  if(car.spinTimer>0){
    car.mesh.rotation.y+=.12*(car.speed>0?1:-1);
    car.spinTimer-=dt;
  }else{
    const sf=H*Math.max(.42,1-Math.abs(car.speed)/car.def.topSpd*.32);
    if(lft)car.mesh.rotation.y+=sf*dt*60;
    if(rgt)car.mesh.rotation.y-=sf*dt*60;
  }

  // Car body tilt — lean into corners, pitch on braking/accel
  const _steerDir=(lft?1:rgt?-1:0);
  const _speedFactor=Math.min(1,Math.abs(car.speed)/car.def.topSpd);
  const _targetTiltZ=_steerDir*(0.10+_speedFactor*0.09)+(hbk?_steerDir*0.10:0)+(driftTimer>0.2?_steerDir*0.06:0);
  const _targetTiltX=acc?(-0.05-_speedFactor*0.025):brk?0.09:0;
  car.mesh.rotation.z+=(_targetTiltZ-car.mesh.rotation.z)*Math.min(1,dt*7);
  car.mesh.rotation.x+=(_targetTiltX-car.mesh.rotation.x)*Math.min(1,dt*6);

  // Jump / gravity
  if(car._fallingIntoSpace){
    // Falling into the void — skip normal floor check, updateSpaceWorld handles recovery
  }else if(car.inAir||car.vy!==0){
    const gravStrength=activeWorld==='space'?13:activeWorld==='deepsea'?13:22; // lower gravity in space/water
    car.vy-=gravStrength*dt;
    car.mesh.position.y+=car.vy*dt;
    if(car.mesh.position.y<=.35&&car.vy<0){
      const landSpeed=Math.abs(car.vy);
      car.mesh.position.y=.35;car.vy=0;car.inAir=false;
      camShake=0.18+landSpeed*.012;
      if(landSpeed>14)showPopup('💥 HARD LANDING!','#ffaa00',600);
      Audio.playLand();
      _plBk.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
      sparkSystem.emit(car.mesh.position.x,.5,car.mesh.position.z,-_plBk.x*.05,0,-_plBk.z*.05,10,.6,.5,.4,.8);
    }
  }
  // (Grounded state handled earlier — lines 6944-6948 already set Y from ramp/bounce)

  // Move — reuse pre-allocated _plFwd/_plBk to avoid GC
  _plFwd.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
  const fwd=_plFwd;
  car.mesh.position.addScaledVector(fwd,car.speed);

  // Sandstorm wind-pull: lateral drift toward right vector when the world's
  // hazard module sets _sandstormWindPull > 0. Scales with speed so a
  // stationary car isn't pushed off-line; dampens by 50% during active
  // steering input so corners stay drivable. Defense-in-depth: also gate
  // on activeWorld so a stale global from a prior session can never bleed
  // into a different world's physics.
  if(window._sandstormWindPull&&activeWorld==='sandstorm'){
    _plRt.set(1,0,0).applyQuaternion(car.mesh.quaternion);
    const _spdR=Math.min(1,Math.abs(car.speed)/Math.max(0.001,car.def.topSpd));
    const _corner=(lft||rgt)?0.5:1.0;
    car.mesh.position.addScaledVector(_plRt, window._sandstormWindPull*dt*_spdR*_corner);
  }

  // Exhaust particles
  if(Math.abs(car.speed)>.05&&Math.random()>.6){
    _plBk.copy(_plFwd).negate();
    const bk=_plBk;
    exhaustSystem.emit(
      car.mesh.position.x+bk.x*2,car.mesh.position.y+.3,car.mesh.position.z+bk.z*2,
      bk.x*.04+((Math.random()-.5)*.02),(.02+Math.random()*.04),bk.z*.04+((Math.random()-.5)*.02),
      2,.5,.4,.38,.8);
  }
  // Nitro flame trail — bright orange/blue flame cone
  if(nitroActive){
    _plBk.copy(_plFwd).negate();
    const bk=_plBk;
    if(Math.random()>.15){
      // Main flame — orange to white
      sparkSystem.emit(
        car.mesh.position.x+bk.x*2.0,car.mesh.position.y+.22,car.mesh.position.z+bk.z*2.0,
        bk.x*.18+(Math.random()-.5)*.06,.01+Math.random()*.06,bk.z*.18+(Math.random()-.5)*.06,
        5,1,.5+Math.random()*.4,0,.28);
    }
    if(Math.random()>.55){
      // Inner blue core
      sparkSystem.emit(
        car.mesh.position.x+bk.x*1.5,car.mesh.position.y+.2,car.mesh.position.z+bk.z*1.5,
        bk.x*.08+(Math.random()-.5)*.03,.005+Math.random()*.04,bk.z*.08+(Math.random()-.5)*.03,
        2,.3,.5,1,.22);
    }
  }

  // Boost timer
  if(car.boostTimer>0)car.boostTimer-=dt;

  // Slipstream: close behind another car. Boost ramps with proximity
  // (weak at 8m, strong at 2m), is dt-scaled (frame-rate independent),
  // and accumulates `slipTimer` so a sustained draft awards a one-shot
  // bonus. Previous implementation reset slipTimer every frame and used
  // a flat +0.004/frame boost — barely perceptible at 60fps.
  let slipping=false;
  let _slipProx=0; // 0..1 proximity (1 = on bumper)
  // Merged loop: slipstream + near-miss in één pass over carObjs. Voorheen
  // 2 aparte loops + altijd-sqrt voor near-miss; nu één dx/dz/d2 compute en
  // sqrt alleen binnen near-miss range (6.25..20.25 = 2.5²..4.5²).
  const _slN=carObjs.length;
  const _doNearMiss=_raceStartGrace<=0;
  for(let i=0;i<_slN;i++){
    if(i===playerIdx)continue;
    const other=carObjs[i];
    const dx=car.mesh.position.x-other.mesh.position.x,dz=car.mesh.position.z-other.mesh.position.z;
    const d2=dx*dx+dz*dz;
    // Slipstream — 8² range, _slipFwd quaternion apply alleen binnen range.
    if(d2<64){
      _slipFwd.set(0,0,-1).applyQuaternion(other.mesh.quaternion);
      _slipDir.set(-dx,0,-dz).normalize();
      if(_slipDir.dot(_slipFwd)>.7){
        slipping=true;
        const _px=1-Math.max(0,(d2-4)/60); // 1 at d²≤4 (2m), 0 at d²=64 (8m)
        if(_px>_slipProx)_slipProx=_px;
      }
    }
    // Near-miss — sqrt alleen in d²-range; cooldown decrement elke frame.
    if(_doNearMiss){
      if(d2>6.25&&d2<20.25){
        const relSpd=Math.abs(car.speed-other.speed);
        if(relSpd>.12&&(_nearMissCooldown[i]||0)<=0){
          _nearMissCooldown[i]=3; // 3s cooldown
          const bonus=Math.round(80+relSpd*300);
          totalScore+=bonus;
          floatText('⚡ NEAR MISS +'+bonus,'#ffdd00',innerWidth*.5,innerHeight*.4);
          triggerCombo('NEAR MISS');
          beep(880,.06,.18,0,'sine');beep(1320,.05,.12,.06,'sine');
          if(Math.random()<.4)Audio.playCrowdCheer();
        }
      }
      if((_nearMissCooldown[i]||0)>0)_nearMissCooldown[i]-=dt;
    }
  }
  if(slipping){
    slipTimer+=dt;
    // dt-scaled boost: 0.10·MAX/s at 8m, 0.55·MAX/s at 2m. Cap at MAX*1.15.
    const _slipBoost=(0.10+_slipProx*0.45)*dt;
    car.speed=Math.min(MAX*1.15, car.speed + _slipBoost);
    if(_elSlip){
      _elSlip.style.display='block';
      _elSlip.style.opacity=String(0.45+_slipProx*0.55);
    }
    // One-shot draft-bonus after 1.5s sustained slipstream.
    if(slipTimer>1.5 && !_slipBonusGiven){
      _slipBonusGiven=true;
      totalScore+=120;
      floatText('💨 DRAFT BONUS +120','#00eeff',innerWidth*.5,innerHeight*.45);
      if(typeof triggerCombo==='function')triggerCombo('SLIPSTREAM');
    }
  }else{
    slipTimer=Math.max(0,slipTimer-dt*1.5);
    if(slipTimer<=0)_slipBonusGiven=false;
    if(_elSlip){_elSlip.style.display='none';_elSlip.style.opacity='';}
  }

  // Off-track slowdown — friction + popup driven by the per-world surface
  // (window.WORLD_DEFAULT_SURFACE from audio/samples.js) so all 9 worlds
  // get a correctly-named popup. Friction multipliers preserve legacy
  // gameplay tuning: space (.09) and deepsea (.13) keep their lighter
  // values; candy keeps its .22 sticky-frosting feel via the world-
  // override row; everything else (volcano/arctic/grandprix/sandstorm)
  // keeps the legacy .18 default while the popup
  // label now matches the actual surface ("SAND!" / "ICE!" / etc.)
  // instead of the misleading "GRASS!".
  if(!car.inAir&&!recoverActive){
    const offDist=trackDist(car.mesh.position,car.progress);
    if(offDist>TW){
      const overRatio=Math.min(1,(offDist-TW)/8);
      const _profile=_OFFTRACK_WORLD_OVERRIDES[activeWorld]||
                     _OFFTRACK_PROFILES[(window.WORLD_DEFAULT_SURFACE&&window.WORLD_DEFAULT_SURFACE[activeWorld])||'asphalt']||
                     _OFFTRACK_PROFILES.asphalt;
      car.speed*=Math.pow(1-overRatio*_profile.friction,dt*60);
      // Popup threshold raised TW+4 → TW+6 (17u → 19u) so curbs (13..15u
      // outside curve) and quick wide-line corrections don't trigger the
      // off-track popup. Friction itself still kicks in at TW (line above).
      if(offDist>TW+6&&Math.random()<_profile.chance){
        showPopup(_profile.label,_profile.color,400);
      }
    }
  }

  // ── Tire wear ──────────────────────────────
  if(Math.abs(car.speed)>.15)car.tireWear=Math.min(1,car.tireWear+Math.abs(car.speed)*.000055*dt*60);
  // Pit lane recovery — zone along main straight near pit building (z 178-212)
  const _pz=car.mesh.position.z,_px=car.mesh.position.x;
  if(_pz>178&&_pz<212&&_px>-188&&_px<172&&car.tireWear>0.02){
    car.tireWear=Math.max(0,car.tireWear-.18*dt);
    if(car.tireWear<.04&&car.tireWear>0){car.tireWear=0;showPopup('🔧 FRESH TYRES!','#00ee88',1100);}
  }
  // Worn tire warning (once per threshold crossing, 2s cooldown)
  _tireWarnCooldown=Math.max(0,_tireWarnCooldown-dt);
  if(car.tireWear>.72&&_tireWarnCooldown<=0){showPopup('⚠ TYRES WORN','#ffbb00',900);_tireWarnCooldown=8;}

  // ── Tire temperature heating / cooling ─────
  const spd=Math.abs(car.speed);
  const heatRate=spd*.008*(isRain?.55:1)*(hbk?2.5:1)*(brk&&spd>.6?1.8:1);
  const coolRate=0.006+(_weatherMode==='snow'?.012:0);
  // Front tires heat from cornering + braking, rears from power/drift
  const steerHeat=(lft||rgt)?0.012:0;
  _tireTemp.fl=Math.max(0,Math.min(1,_tireTemp.fl+heatRate*dt+steerHeat*dt-coolRate*dt));
  _tireTemp.fr=Math.max(0,Math.min(1,_tireTemp.fr+heatRate*dt+steerHeat*dt-coolRate*dt));
  _tireTemp.rl=Math.max(0,Math.min(1,_tireTemp.rl+(acc?heatRate*.9:heatRate*.4)*dt+(hbk?.018:0)*dt-coolRate*dt));
  _tireTemp.rr=Math.max(0,Math.min(1,_tireTemp.rr+(acc?heatRate*.9:heatRate*.4)*dt+(hbk?.018:0)*dt-coolRate*dt));
  // Warn on extremely cold tires at race start
  if(car.lap===1&&_avgTemp<0.12&&spd>.3&&Math.random()<.004)showPopup('❄ COLD TYRES — WARM UP!','#88bbff',1200);

  // ── Brake heat visual (orange sparks at wheels on hard braking) ─
  // forEach over [-1,1] → manual unroll. The 2-element literal + closure
  // were allocated per qualifying frame (~13/s during heavy braking).
  if(brk&&spd>.8&&Math.random()<.22){
    _plBk.set(0,0,-1).applyQuaternion(car.mesh.quaternion).negate();
    _plRt.set(1,0,0).applyQuaternion(car.mesh.quaternion);
    const bk2=_plBk,rt2=_plRt;
    const _bky=car.mesh.position.y+.22;
    sparkSystem.emit(
      car.mesh.position.x-rt2.x*.95+bk2.x*1.4,_bky,
      car.mesh.position.z-rt2.z*.95+bk2.z*1.4,
      -rt2.x*.03+bk2.x*.04,.01+Math.random()*.04,-rt2.z*.03+bk2.z*.04,
      2,1,.35+Math.random()*.25,0,.28
    );
    sparkSystem.emit(
      car.mesh.position.x+rt2.x*.95+bk2.x*1.4,_bky,
      car.mesh.position.z+rt2.z*.95+bk2.z*1.4,
      rt2.x*.03+bk2.x*.04,.01+Math.random()*.04,rt2.z*.03+bk2.z*.04,
      2,1,.35+Math.random()*.25,0,.28
    );
  }

  // ── Speed trap (S/F straight, progress ~0.01) ──────────────────
  if(car.progress<0.025&&car.progress>0.005&&spd>.8){
    const kmh=Math.round(spd*60*38*(car.boostTimer>0?1.3:1)*(nitroActive?1.4:1));
    if(kmh>_speedTrapMax){
      _speedTrapMax=kmh;
      if(kmh>_speedTrapAllTime){_speedTrapAllTime=kmh;}
      // Cache the DOM ref — per-frame getElementById was the issue.
      if(!_speedTrapElCache)_speedTrapElCache=document.getElementById('speedTrapEl');
      const el=_speedTrapElCache;
      if(el&&!_speedTrapFired){
        _speedTrapFired=true;
        el.innerHTML='⚡ SPEED TRAP<br>'+kmh+' km/h'+(kmh===_speedTrapAllTime?'<br>🏆 SESSION BEST':'');
        el.style.display='block';
        setTimeout(()=>{el.style.display='none';_speedTrapFired=false;},2200);
      }
    }
  }else if(car.progress>0.04){_speedTrapFired=false;}

  // ── Turbo spool effect (lift then reapply at speed) ─────────────
  const nowBraking=brk&&spd>.5;
  // Brake squeal one-shot: trigger op brake-onset bij hoge snelheid.
  // Vermijdt spam tijdens sustained braking.
  if(nowBraking&&!_wasBraking&&spd>.7)Audio.playBrake();
  if(_wasBraking&&acc&&!brk&&spd>.5){
    // Transition: was braking, now accelerating
    if(audioCtx&&Math.random()>.5){
      const t2=audioCtx.currentTime;
      const o=audioCtx.createOscillator(),g2=audioCtx.createGain(),f2=audioCtx.createBiquadFilter();
      o.type='sawtooth';f2.type='bandpass';f2.frequency.value=900;f2.Q.value=2;
      o.frequency.setValueAtTime(280,t2);o.frequency.exponentialRampToValueAtTime(680,t2+.18);
      g2.gain.setValueAtTime(.045,t2);g2.gain.exponentialRampToValueAtTime(.001,t2+.22);
      o.connect(f2);f2.connect(g2);g2.connect(_dst());o.start(t2);o.stop(t2+.24);
    }
  }
  _wasBraking=nowBraking;

  updateEngine(car.speed);
  spinWheels(car);
  applyWheelBob(car, dt); // Fase 3: subtle per-wheel up/down, desktop-only
  tickProgress(car);
}


function spinWheels(car){
  if(!car.mesh.userData.wheels)return;
  // forEach → for: ran ~60×8 cars/sec = 480 closures/sec.
  const ws=car.mesh.userData.wheels;
  const inc=car.speed*.55;
  for(let i=0;i<ws.length;i++)ws[i].rotation.x+=inc;
}

// Fase 3 graphics upgrade — geeft auto's "leven":
//
// applyAIBodyDynamics: AI-cars hadden geen body-tilt/pitch (alleen de player
// kreeg die in updatePlayer). Resultaat: AI was statisch in het peloton.
// Hier derivieren we throttle/brake uit dSpeed (verandering in snelheid) en
// applyen subtle pitch (rotation.x) + sideways lean (rotation.z) gebaseerd
// op de richting-verandering. Lichte versie van de player-logica — geen
// drifting/spinning state, geen drift-input.
//
// applyWheelBob: per wheel een sinusgolf rond restY, gemoduleerd door speed.
// Desktop-only (mobile blijft op static wheels — scheelt 4×N cars sin-calls).
// Werkt voor zowel player als AI; restY werd in car-parts.js geseed.
//
// Beide functies allocation-free — alle math op stack, geen Vector3-news.

function applyAIBodyDynamics(car, dt){
  if(!car || !car.mesh) return;
  // Track prev-speed in car state om dSpeed te kunnen meten zonder global.
  const prev = car._prevSpeed != null ? car._prevSpeed : car.speed;
  const dSpeed = car.speed - prev;
  car._prevSpeed = car.speed;
  // Pitch target: positieve dSpeed (accelereren) → tilt back; negatieve
  // (afremmen of rollen) → tilt forward. Amplitude licht (max 0.06 rad ≈ 3.4°)
  // zodat AI niet doorslaat. dSpeed wordt geschaald met dt om frame-onafhankelijk
  // te zijn — typische dSpeed/dt is 0..3 onder normale acceleratie.
  const accelSignal = Math.max(-1, Math.min(1, dSpeed / Math.max(0.0001, dt) / 3));
  const targetPitch = -accelSignal * 0.055;
  // Zijwaartse helling: afgeleid van rotation.y delta. We hebben geen prev-rotY
  // direct, dus gebruiken we car.speed × cornering-mate. Eenvoudige proxy:
  // current speed × torsion uit pad geeft een dy/dt schatting; bij gebrek aan
  // dat doen we 0 — pitch alone is genoeg voor de "alive" lift.
  const targetRoll = 0;
  // Lerp dt-onafhankelijk (factor 6 = ~100ms time constant bij 60fps)
  const k = Math.min(1, dt * 6);
  car.mesh.rotation.x += (targetPitch - car.mesh.rotation.x) * k;
  car.mesh.rotation.z += (targetRoll  - car.mesh.rotation.z) * k;
}

function applyWheelBob(car, dt){
  if(window._isMobile) return; // gated voor mobile-budget
  if(!car || !car.mesh || !car.mesh.userData.wheels) return;
  const ws = car.mesh.userData.wheels;
  const t = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now()*0.001);
  // Speed-normalized amplitude: stilstand = geen bob, topSpd = 1
  const topSpd = (car.def && car.def.topSpd) || 1.6;
  const speedNorm = Math.min(1, Math.abs(car.speed) / topSpd);
  if(speedNorm < 0.02){
    // Bij stilstand: laat wielen op restY zodat lijken niet "drijven".
    for(let i=0;i<ws.length;i++){
      const w = ws[i];
      if(w.userData.restY != null) w.position.y = w.userData.restY;
    }
    return;
  }
  // Subtle ±12mm bob bij topspeed, 4-wheel phase-offset zodat het hele blok
  // niet synchroon klopt (geeft "rough road" sensatie).
  const amp = 0.012 * speedNorm;
  const omega = t * 14;
  for(let i=0;i<ws.length;i++){
    const w = ws[i];
    if(w.userData.restY == null) continue;
    w.position.y = w.userData.restY + Math.sin(omega + i*1.7) * amp;
  }
}

