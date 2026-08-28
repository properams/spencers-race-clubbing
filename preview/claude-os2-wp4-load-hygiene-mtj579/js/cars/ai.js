// js/cars/ai.js — non-module script.

'use strict';

// Pre-allocated scratch vectors (uit main.js verhuisd) — vermijden GC-druk
// in de hot loop. Cross-script zichtbaar voor effects/night.js + visuals.js.
const _aiFwd=new THREE.Vector3(),_aiToT=new THREE.Vector3(),_aiCross=new THREE.Vector3();
const _aiTg=new THREE.Vector3(),_aiNr=new THREE.Vector3();
const _aiCurA=new THREE.Vector3(),_aiCurB=new THREE.Vector3();
const _aiBase=new THREE.Vector3();
const _aiFwdRV=new THREE.Vector3();

// AI runtime data (uit main.js verhuisd).
//   _aiPersonality    — per car-id: aggr (0..1), consist (0..1), name.
//                       Gebruikt in cars/build.js makeAllCars().
//   _aiHeadPool       — pool van 4 PointLights gedeeld door AI cars
//                       (effects/night.js update). Gevuld in core/scene.js.
//   _reverseLights    — per car-index reverse-light mesh refs (visibility
//                       in effects/night.js bij brake). Gevuld in cars/build.js.
//   _nearMissCooldown — 3s-cooldown counter voor NEAR MISS bonus per car-index
//                       (cars/physics.js triggert bij dist 2.5..4.5m).
// Personality slots get a callsign + emoji for HUD/select-screen
// rival display (consumed in session 05). aggr/consist drive race
// AI; name + emoji are display-only.
const _aiPersonality=[
  {aggr:0.6,consist:0.8,name:'Spike',   emoji:'⚡'}, // Bugatti
  {aggr:0.9,consist:0.6,name:'Luna',    emoji:'🌙'}, // Lamborghini
  {aggr:0.4,consist:0.9,name:'Ace',     emoji:'🎯'}, // Maserati
  {aggr:0.7,consist:0.7,name:'Max',     emoji:'🔥'}, // Ferrari
  {aggr:1.0,consist:0.5,name:'Titan',   emoji:'👑'}, // RB F1
  {aggr:0.8,consist:0.5,name:'Blaze',   emoji:'🚀'}, // Mustang
  {aggr:0.3,consist:0.95,name:'Ray',    emoji:'💡'}, // Tesla
  {aggr:0.5,consist:0.85,name:'Echo',   emoji:'🌀'}, // Audi
  {aggr:0.7,consist:0.85,name:'Nexus',  emoji:'💫'}, // 8 Porsche
  {aggr:0.85,consist:0.7,name:'Inferno',emoji:'🔥'}, // 9 McLaren
  {aggr:0.95,consist:0.6,name:'Vortex', emoji:'⚫'}, // 10 Mercedes F1
  {aggr:0.8,consist:0.75,name:'Apex',   emoji:'⭐'}, // 11 Koenigsegg
];
const _aiHeadPool=[];
const _reverseLights=[];
const _nearMissCooldown=[];

// Difficulty rubber-band cap — hoisted out of updateAI() so the 3-row
// literal isn't allocated per AI car per frame. Plafond moet hoog genoeg
// zijn om de versterkte catch-up niet weg te kappen (max-aggr nemesis op
// Hard pakt 1.02 + 0.32 × 1.55 = 1.52 in de catch-up branch).
const _AI_DIFF_RB_CAP=[0.96,1.22,1.62];

// Per-difficulty catch-up magnitude — multipliceert op personality.aggr zodat
// agressieve AI's relatief harder achterhalen, maar de absolute magnitude
// zelf ook met difficulty schaalt. Easy=zwakke achtervolging, Hard=relentless.
const _AI_CATCHUP_SCALE=[0.65, 1.15, 1.75];

// Safe lookups voor de per-difficulty arrays in AI_TUNING; vallen terug op
// de scalar als config.js nog niet de array-vorm heeft. Houdt hot-reload
// tijdens tuning werkbaar zonder runtime errors.
const _leadEaseFor    = i => AI_TUNING.leadBandEaseByDiff?.[i]
                          ?? AI_TUNING.leadBandEase ?? 0.2;
const _cornerFloorFor = i => AI_TUNING.cornerCautionFloorByDiff?.[i]
                          ?? AI_TUNING.cornerCautionFloor ?? 0.52;

function updateAI(car,dt){
  if(car.finished)return;
  const player=carObjs[playerIdx];
  const pers=car._personality||{aggr:.6,consist:.7};
  // Hoist per-difficulty lookups: één keer per frame i.p.v. meerdere keren
  // in de rubberband branches (deze functie draait per AI per frame).
  const _lbe=_leadEaseFor(difficulty);
  const _ccf=_cornerFloorFor(difficulty);
  const _cs=_AI_CATCHUP_SCALE[difficulty] ?? 1.00;
  let spdMult=1;
  if(player){
    // gap = how far ahead player is (positive = player ahead)
    let _pProg=player.progress,_aiProg=car.progress;
    if(_aiProg>.85&&_pProg<.15)_pProg+=1.0;
    if(_pProg>.85&&_aiProg<.15)_aiProg+=1.0;
    const gap=(player.lap-car.lap)+(_pProg-_aiProg);
    // Catch-up branches (gap>0): magnitude schaalt met _cs zodat Hard echt
    // achterhaalt en Easy nauwelijks. Personality.aggr blijft multiplicatief
    // zodat agressieve AI's altijd relatief harder pushen.
    const rbStr =1.02+pers.aggr*.32*_cs;
    const rbNear=1.02+pers.aggr*.14*_cs;
    if(gap>1.5)spdMult=rbStr;
    else if(gap>.5)spdMult=rbNear;
    // AI ahead branches: legacy MK-style anti-frustration throttle-back.
    // _lbe schaalt hoeveel van die slowdown overblijft per difficulty:
    // Easy=0.55 (speler kan terugkomen), Hard=0 (AI pusht vol door).
    else if(gap<-1.5){
      const _legacy=.84+(1-pers.aggr)*.08;
      spdMult=1-(1-_legacy)*_lbe;
    } else if(gap<-.5){
      const _legacy=.93+(1-pers.aggr)*.06;
      spdMult=1-(1-_legacy)*_lbe;
    }
    // Consistent drivers don't fall as far behind
    if(gap<0)spdMult=Math.max(spdMult,1-(.04*(1-pers.consist)));
    const diffRbCap=_AI_DIFF_RB_CAP[difficulty]||1.05;
    spdMult=Math.min(spdMult,diffRbCap);
  }
  const la=.018,tProg=(car.progress+la)%1;
  // Use pre-allocated vectors — zero heap allocs per AI car per frame
  trackCurve.getPoint(tProg,_aiBase);
  // Tangent + normal voor stuurpunt-offset en racing-line. Wordt onvoor-
  // waardelijk gezet omdat elke AI nu een niet-nul lateralOff hanteert via
  // de racing-line update hieronder.
  trackCurve.getTangent(tProg,_aiTg);_aiTg.normalize();
  _aiNr.set(-_aiTg.z,0,_aiTg.x);
  // Curvature look-ahead (vroeg gehoist: nodig voor racing-line target voor
  // we _aiBase verschuiven). Dezelfde getTangent-calls als voorheen — geen
  // extra werk per frame.
  trackCurve.getTangent(car.progress,_aiCurA);
  trackCurve.getTangent((car.progress+.04)%1,_aiCurB);
  const curv=Math.max(0,1-_aiCurA.dot(_aiCurB));
  // Racing-line: outside-inside-outside via cross-y van twee tangenten.
  // _turnSign = +1 voor één draairichting, -1 voor de andere. Apex pull
  // schaalt met curv; per-car _lineBias geeft karakter; _breath is een
  // langzame sin (verschillende fase per car-id) zodat het peloton niet
  // op exact dezelfde lijn blijft hangen. Skip de update tijdens een
  // active overtake — die branch beheert lateralOff zelf.
  const _crossY=_aiCurA.x*_aiCurB.z-_aiCurA.z*_aiCurB.x;
  const _turnSign=_crossY>0?1:(_crossY<0?-1:0);
  const _apex=Math.min(1,curv*6.0)*4.5*-_turnSign;
  const _breath=Math.sin(Date.now()*.00041+car.def.id*1.7)*0.6;
  const _bias=(car._lineBias||0)*(0.5+pers.aggr*0.5);
  const _rlTarget=_apex+_bias+_breath;
  if(!(car._passAttemptTimer>0)){
    car.lateralOff+=(_rlTarget-car.lateralOff)*Math.min(1,dt*2.4);
  }
  // Apply lateralOff to steering target (vroeger op regel 106).
  if(car.lateralOff)_aiBase.addScaledVector(_aiNr,car.lateralOff);
  _aiFwd.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
  _aiToT.set(_aiBase.x-car.mesh.position.x,0,_aiBase.z-car.mesh.position.z).normalize();
  _aiCross.copy(_aiFwd).cross(_aiToT);
  car.mesh.rotation.y+=_aiCross.y*car.def.hdlg*1.78*dt*60;
  // AI car body tilt — lean into corners based on yaw rate
  car._prevRotY??=car.mesh.rotation.y;
  const _aiYawD=car.mesh.rotation.y-car._prevRotY;
  car._prevRotY=car.mesh.rotation.y;
  const _aiSpeedF=Math.min(1,car.speed/(car.def.topSpd*.8));
  const _aiTgtZ=Math.max(-.16,Math.min(.16,-_aiYawD/Math.max(dt,.008)*(.32+_aiSpeedF*.14)));
  car.mesh.rotation.z+=(_aiTgtZ-car.mesh.rotation.z)*Math.min(1,dt*6);
  // AI_TUNING: baseSpeedMult bumpt AI competitiveness; _ccf (cornerCautionFloor
  // per difficulty) bepaalt hoeveel pace AI mag houden in bochten — op Hard
  // bijna geen straf, op Easy de oude voorzichtige floor.
  const tspd=car.def.topSpd*spdMult*DIFF_MULT[difficulty]*AI_TUNING.baseSpeedMult*Math.max(_ccf,1-curv*8.5)*(car.boostTimer>0?1.4:1);
  // AI accel scaled by SPEED_TUNING.accelMult so AI doesn't lag
  // behind player's bumped acceleration on straights.
  const _aiAcc=car.def.accel*SPEED_TUNING.accelMult;
  if(car.speed<tspd)car.speed=Math.min(tspd,car.speed+_aiAcc*dt*60);
  else car.speed=Math.max(tspd,car.speed-_aiAcc*2*dt*60);
  // Mild random speed variation per car for natural feel
  car.speed*=1+Math.sin(Date.now()*.0009+car.def.id*2.3)*.018;
  // Occasional mistake — frequency inversely proportional to consistency
  car._mtimer=(car._mtimer||0)-dt;
  // Hard halveert mistake-kans (~0.45×), Normal demt naar 0.75×, Easy ongewijzigd.
  const mistakeChance=(0.08+(1-pers.consist)*.3)*(difficulty===2?0.45:difficulty===0?1.0:0.75);
  if(car._mtimer<=0){car._mtimer=6+pers.consist*12+Math.random()*10;car._mActive=curv>.012&&Math.random()<mistakeChance?(.25+Math.random()*.5):0;}
  if((car._mActive||0)>0){car._mActive-=dt;car.mesh.rotation.y+=(Math.random()-.5)*.04*(1+pers.aggr*.5);car.speed*=.991;}
  // AI jump handling (proper per-car physics)
  if(car.inAir){
    car.vy-=22*dt;
    car.mesh.position.y+=car.vy*dt;
    if(car.mesh.position.y<=.35&&car.vy<0){
      car.mesh.position.y=.35;car.vy=0;car.inAir=false;
    }
  }else{
    car.mesh.position.y=.35;
    if(car._rampCooldown>0)car._rampCooldown-=dt;
    // AI launchpad trigger — same flat-pad logic as player.
    // forEach → for: ran every frame for every grounded AI car (7) ×
    // jumpRamps.length. Closure was the dominant allocation in this branch.
    else {
      const _aiFwdR=_aiFwdRV.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
      const _jrN=jumpRamps.length;
      for(let _ri=0;_ri<_jrN;_ri++){
        if(car._rampCooldown>0)break;
        const ramp=jumpRamps[_ri];
        const dx=car.mesh.position.x-ramp.pos.x,dz=car.mesh.position.z-ramp.pos.z;
        const along=dx*ramp.tg.x+dz*ramp.tg.z;
        const perp=Math.abs(-dx*ramp.tg.z+dz*ramp.tg.x);
        const halfLen=ramp.len*.5;
        if(perp<ramp.width*.5&&along>-halfLen&&along<halfLen){
          const mDot=(_aiFwdR.x*ramp.tg.x+_aiFwdR.z*ramp.tg.z)*(car.speed>=0?1:-1);
          if(mDot>.1&&Math.abs(car.speed)>.25){
            car.vy=Math.abs(car.speed)*10+ramp.launchV*1.2+5;
            car.inAir=true;car._rampCooldown=1.2;
          }
        }
      }
    }
  }
  // AI overtaking: if player is just ahead on track, try to go around
  const player2=carObjs[playerIdx];
  if(player2&&!car.finished&&pers.aggr>.5){
    const pdx=car.mesh.position.x-player2.mesh.position.x,pdz=car.mesh.position.z-player2.mesh.position.z;
    // No lateral maneuvers during race start grace — cars drive straight ahead
    if(_raceStartGrace<=0){
      // Squared-distance: 7² = 49 (pass-attempt range), 12² = 144 (reset
      // range). Skip de sqrt — geen single-precision sqrt per AI per frame.
      const pD2=pdx*pdx+pdz*pdz;
      const sameLap=Math.abs(car.lap-player2.lap)<1;
      if(pD2<49&&sameLap&&car.speed>player2.speed*.98){
        // Decide which side to pass on (perpendicular to own forward)
        if(!car._passAttemptTimer||car._passAttemptTimer<=0){
          const crossVal=_aiFwd.x*pdz-_aiFwd.z*pdx;
          car._passSide=(crossVal>0?1:-1)*(pers.aggr>.8?1.6:1.0);
          car._passAttemptTimer=3.5+Math.random()*2;
        }
      }
      if((car._passAttemptTimer||0)>0){
        car._passAttemptTimer-=dt;
        const targetOff=car.lateralOff+(car._passSide||0)*5.5;
        car.lateralOff+=(targetOff-car.lateralOff)*Math.min(1,dt*1.2);
      }
      // Geen `else if(pD2>144) lateralOff *= .88^60dt` meer — de
      // racing-line update bovenin de functie trekt lateralOff al naar
      // het juiste apex/bias target. De oude decay convergeerde naar 0
      // (middenlijn) en zou de racing-line voor agressieve AI's ver van
      // de speler steeds resetten.
    } else {
      // During start grace: reset any pending pass attempts
      car._passAttemptTimer=0;
    }
  }
  _aiFwd.set(0,0,-1).applyQuaternion(car.mesh.quaternion); // recompute after rotation
  car.mesh.position.addScaledVector(_aiFwd,car.speed);
  // Sandstorm wind-pull: AI cars get 70% of the player's lateral drift so
  // they stay competitive without all flying off-track on lap 3. Scales
  // with speed; gated by activeWorld for defense-in-depth (matches
  // physics.js). Reuses _aiFwdRV scratch as the right-vector to avoid
  // per-frame Vector3 allocs.
  if(window._sandstormWindPull&&activeWorld==='sandstorm'){
    const _aiRt=_aiFwdRV.set(1,0,0).applyQuaternion(car.mesh.quaternion);
    const _spdR=Math.min(1,Math.abs(car.speed)/Math.max(0.001,car.def.topSpd));
    car.mesh.position.addScaledVector(_aiRt, window._sandstormWindPull*0.7*dt*_spdR);
  }
  if(car.boostTimer>0)car.boostTimer-=dt;
  spinWheels(car);
  // Fase 3: AI cars krijgen body-pitch op acceleratie/remmen + (desktop)
  // wheel-bob. Voor de upgrade was AI volledig statisch in tilt-ruimte —
  // peloton voelde dood. applyAIBodyDynamics is allocation-free.
  applyAIBodyDynamics(car, dt);
  applyWheelBob(car, dt);
  tickProgress(car);
}

