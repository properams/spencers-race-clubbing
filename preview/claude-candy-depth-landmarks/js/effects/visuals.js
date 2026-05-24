// js/effects/visuals.js — non-module script.

'use strict';

// RPM-bar constants + state (uit main.js verhuisd) — gebruikt door updateRpmBar.
const _RPM_GRAD_REDLINE='linear-gradient(180deg,#ff0000,#ff4400)';
const _RPM_GRAD_NORMAL='linear-gradient(180deg,#00cc88,#00ff99)';
const _RPM_GEAR_RANGES=[0,.18,.36,.54,.72,.9];
let _lastRedline=null;

// Speed-lines canvas state (uit main.js verhuisd). Lazy-init in initSpeedLines,
// fade gemanaged in updateSpeedLines. Reset in race.js. _streakPool wordt lazy
// gevuld in _drawSpeedLines; _streakColorCache vermijdt hex→rgb conversie elke frame.
let _speedLinesCvs=null,_speedLinesCtx=null;
let _speedLinesFadeT=0;
let _streakPool=null;
let _streakColorCache={hex:-1,rgb:'255,170,68'};

// Rev-limiter audio-trigger throttle (gebruikt in updateRpmBar / playRevLimiter).
let _revLimiterTimer=0;

// Float-text stagger (uit main.js verhuisd). _floatSlot rolt 0..5 zodat
// 6 popups verticaal stacken; reset wanneer _floatSlotTimer naar 0 zakt.
// Decay-tick gebeurt in core/loop.js (per dt -1.6s per cyclus).
let _floatSlot=0,_floatSlotTimer=0;

// Cached speed-overlay element — getElementById was called every frame.
let _spdOvEl=null;
function updateSpeedOverlay(){
  const car=carObjs[playerIdx];
  if(!_spdOvEl)_spdOvEl=document.getElementById('speedOverlay');
  if(!_spdOvEl||!car)return;
  const spd=Math.abs(car.speed);
  const maxSpd=car.def.topSpd*(car.boostTimer>0?1.55:1)*(nitroActive?1.42:1);
  const t=Math.max(0,(spd/maxSpd-.5)/.5); // kicks in at 50% of top speed
  _spdOvEl.style.opacity=String(Math.min(1,t*.9));
}


function updateBoostArrows(){
  const t=_nowSec;
  // Doubly-nested forEach → for: each frame iterated boostPads × arrows
  // and allocated 2 closures per pad. Pure mechanical conversion.
  const _bpN=boostPads.length;
  for(let pi=0;pi<_bpN;pi++){
    const pad=boostPads[pi];
    if(pad.arrows){
      const _arN=pad.arrows.length;
      for(let ai=0;ai<_arN;ai++){
        const arr=pad.arrows[ai];
        // Each ring floats upward and fades — offset phase creates cascading effect
        const phase=((t*0.9+arr._phase))%1;
        const rise=phase*3.2; // ring floats up 3.2 units over its cycle
        arr.material.opacity=Math.sin(phase*Math.PI)*0.75;
        arr.position.y=arr._baseY+rise;
        // Subtle scale pulse (slightly bigger as they rise)
        const sc=0.85+phase*0.30;
        arr.scale.set(sc,1,sc);
      }
    }
    // Animate point light intensity
    if(pad.light){
      const pulse=0.5+0.5*Math.sin(t*3.2+pi*1.4);
      pad.light.intensity=1.4+pulse*1.4;
    }
  }
}


function updateSlipstreamVisuals(){
  // forEach → for: closure allocated per frame for an emit-test on each
  // AI car. Body unchanged.
  const _ssN=carObjs.length;
  for(let i=0;i<_ssN;i++){
    if(i===playerIdx)continue;
    const car=carObjs[i];
    if(!car.mesh||car.finished)continue;
    if(Math.abs(car.speed)>car.def.topSpd*.6&&Math.random()>.74){
      _aiFwdRV.set(0,0,1).applyQuaternion(car.mesh.quaternion); // backward = +Z
      // Pale blue exhaust shimmer — subtle, low emission rate
      sparkSystem.emit(
        car.mesh.position.x+_aiFwdRV.x*1.6,car.mesh.position.y+.18,car.mesh.position.z+_aiFwdRV.z*1.6,
        _aiFwdRV.x*.05+(Math.random()-.5)*.015,.006+Math.random()*.012,_aiFwdRV.z*.05+(Math.random()-.5)*.015,
        1,.14,.44,.88,.38);
    }
  }
}


function initSpeedLines(){
  _speedLinesCvs=document.getElementById('speedLines');
  if(!_speedLinesCvs)return;
  _speedLinesCvs.width=innerWidth;_speedLinesCvs.height=innerHeight;
  _speedLinesCtx=_speedLinesCvs.getContext('2d');
  // Canvas blijft leeg tot updateSpeedLines() begint te renderen — geen
  // initial draw nodig (oude radial-pattern werd elke 100ms ververst, nu
  // tekenen we per frame zodra nitro/high-speed actief is).
  window.addEventListener('resize',()=>{
    if(_speedLinesCvs){
      _speedLinesCvs.width=innerWidth;_speedLinesCvs.height=innerHeight;
      if(_speedLinesCtx)_speedLinesCtx.clearRect(0,0,_speedLinesCvs.width,_speedLinesCvs.height);
    }
  });
}

// Helper: hex int (0xRRGGBB) → "r,g,b" string voor gebruik in rgba(...) stops.
// _NITRO_FLAME_CFG levert hex ints; canvas gradient stops vragen strings.
function _hexToRgbStr(hex){
  return ((hex>>16)&255)+','+((hex>>8)&255)+','+(hex&255);
}
function _streakRgb(){
  const hex=(typeof _NITRO_FLAME_CFG!=='undefined'&&_NITRO_FLAME_CFG[activeWorld])||_NITRO_FLAME_DEFAULT||0xffaa44;
  if(hex!==_streakColorCache.hex){
    _streakColorCache.hex=hex;
    _streakColorCache.rgb=_hexToRgbStr(hex);
  }
  return _streakColorCache.rgb;
}
function _initStreakPool(){
  const count=window._isMobile?16:32;
  _streakPool=new Array(count);
  for(let i=0;i<count;i++){
    // life=-1 → eerste tick recycle't direct met staggered radius
    _streakPool[i]={a:Math.random()*Math.PI*2,r:0,vel:0,life:-1,maxLife:0.5,len:0,wid:0,seed:Math.random()};
  }
}
function _recycleStreak(s, R){
  // Lichte horizontale bias (70% rond links/rechts, 30% any) — mimics road
  // vanishing point waar de snelheid het sterkst aanvoelt op de zij-randen.
  const horizontal=Math.random()<0.7;
  s.a=horizontal
    ? (Math.random()<0.5?0:Math.PI)+(Math.random()-0.5)*0.7
    : Math.random()*Math.PI*2;
  s.r=(0.04+Math.random()*0.06)*R;          // start dicht bij center
  s.vel=(1.2+Math.random()*0.9)*R;          // R/sec → ~0.7s om scherm te kruisen
  s.maxLife=0.40+Math.random()*0.30;
  s.life=s.maxLife;
  s.len=(0.12+Math.random()*0.18)*R;        // streak-segment lengte
  s.wid=1.2+Math.random()*2.4;
}
// Pre-baked streak strip — één 64×8 offscreen canvas met de 3-stop
// horizontal gradient. Per streak doen we drawImage rotated ipv
// ctx.createLinearGradient (32 allocs × 60fps = ~1920 CanvasGradient-
// objecten/sec tijdens nitro). Strip regen alleen als de world-rgb wijzigt.
let _streakStripCvs=null, _streakStripCtx=null, _streakStripRgb='';
const _STREAK_STRIP_W=64, _STREAK_STRIP_H=8;
function _ensureStreakStrip(rgb){
  if(_streakStripCvs && _streakStripRgb===rgb) return _streakStripCvs;
  if(!_streakStripCvs){
    _streakStripCvs=document.createElement('canvas');
    _streakStripCvs.width=_STREAK_STRIP_W; _streakStripCvs.height=_STREAK_STRIP_H;
    _streakStripCtx=_streakStripCvs.getContext('2d');
  }
  const c=_streakStripCtx;
  c.clearRect(0,0,_STREAK_STRIP_W,_STREAK_STRIP_H);
  const g=c.createLinearGradient(0,0,_STREAK_STRIP_W,0);
  g.addColorStop(0,   'rgba('+rgb+',0)');
  g.addColorStop(0.65,'rgba('+rgb+',1)');
  g.addColorStop(1,   'rgba('+rgb+',0)');
  c.fillStyle=g; c.fillRect(0,0,_STREAK_STRIP_W,_STREAK_STRIP_H);
  _streakStripRgb=rgb;
  return _streakStripCvs;
}
function _drawSpeedLines(dt, rgb, intensity){
  if(!_speedLinesCtx)return;
  const ctx=_speedLinesCtx,w=_speedLinesCvs.width,h=_speedLinesCvs.height;
  const cx=w/2,cy=h/2,R=Math.max(w,h)*0.65;
  ctx.clearRect(0,0,w,h);
  if(!_streakPool)_initStreakPool();
  const strip=_ensureStreakStrip(rgb);
  const prevOp=ctx.globalCompositeOperation;
  const prevAlpha=ctx.globalAlpha;
  ctx.globalCompositeOperation='lighter'; // additive → past bij bloom-pipeline
  const N=_streakPool.length;
  for(let i=0;i<N;i++){
    const s=_streakPool[i];
    s.life-=dt;
    if(s.life<=0)_recycleStreak(s,R);
    s.r+=s.vel*dt;
    // Fade-in (80ms aan binnenkant) + fade-out (200ms aan einde life)
    const fadeIn=Math.min(1,(s.maxLife-s.life)/0.08);
    const fadeOut=Math.min(1,(s.life/s.maxLife)/0.20);
    const alpha=Math.min(fadeIn,fadeOut)*intensity;
    if(alpha<=0.01)continue;
    // drawImage rotated rond het midden van de streak. Midpoint =
    // (r-len/2) langs de straal. Geen createLinearGradient per streak.
    const mid=s.r-s.len*0.5;
    ctx.globalAlpha=alpha*0.85;
    ctx.save();
    ctx.translate(cx+Math.cos(s.a)*mid, cy+Math.sin(s.a)*mid);
    ctx.rotate(s.a);
    ctx.drawImage(strip, -s.len*0.5, -s.wid*0.5, s.len, s.wid);
    ctx.restore();
  }
  ctx.globalAlpha=prevAlpha;
  ctx.globalCompositeOperation=prevOp;
}

// Sentinel for speed-lines opacity. Without this, the opacity string-write
// fires every frame (including a constant '0' write when not in RACE).
let _spdLinesLastOp='';
function _spdLinesSetOp(v){
  if(v!==_spdLinesLastOp){_spdLinesLastOp=v;_speedLinesCvs.style.opacity=v;}
}
function updateSpeedLines(){
  if(!_speedLinesCvs)return;
  const car=carObjs[playerIdx];
  if(!car||gameState!=='RACE'){_spdLinesSetOp('0');_speedLinesFadeT=0;return;}
  const dt2=1/60;
  // Activatie alleen tijdens nitro — de high-speed fallback werd als te veel
  // ervaren omdat de strepen ook zonder nitro verschenen.
  if(nitroActive){
    _speedLinesFadeT=0.3;
    _drawSpeedLines(dt2,_streakRgb(),1);
    _spdLinesSetOp('1');
  }else{
    _speedLinesFadeT=Math.max(0,_speedLinesFadeT-dt2);
    if(_speedLinesFadeT>0){
      _drawSpeedLines(dt2,_streakRgb(),(_speedLinesFadeT/0.3)*0.8);
      _spdLinesSetOp('1');
    }else{
      _spdLinesSetOp('0');
    }
  }
}


function initDriftVisuals(){
  _driftBarEl=document.getElementById('driftBar');
  _driftBarFill=document.getElementById('driftBarFill');
  _driftLabelEl=document.getElementById('driftLabel');
}

// Drift bar visibility sentinel — gate the per-frame style.display writes
// behind a single boolean transition (drift→none / none→drift). Without
// this, every drift frame wrote display='block' and every non-drift frame
// wrote display='none'.
let _driftShown=false;
function updateDriftVisuals(dt){
  const car=carObjs[playerIdx];if(!car)return;
  if(driftTimer>0.2){
    if(!_driftShown){
      _driftShown=true;
      if(_driftBarEl)_driftBarEl.style.display='block';
      if(_driftLabelEl)_driftLabelEl.style.display='block';
    }
    const fill=Math.min(1,driftTimer/4)*100;
    if(_driftBarFill)_driftBarFill.style.width=fill+'%';
    // Drift smoke from rear tires — manual unroll of [-0.82,0.82].forEach
    // to drop the array literal + closure on every qualifying frame.
    if(Math.abs(car.speed)>.6&&Math.random()<.55){
      const fwd=_camV1.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
      const rt=_camV2.set(1,0,0).applyQuaternion(car.mesh.quaternion);
      const _dty=car.mesh.position.y+.12;
      exhaustSystem.emit(
        car.mesh.position.x+fwd.x*.7-rt.x*0.82,_dty,car.mesh.position.z+fwd.z*.7-rt.z*0.82,
        (Math.random()-.5)*.025,.006+Math.random()*.014,(Math.random()-.5)*.025,
        1,.34,.34,.34,.8);
      exhaustSystem.emit(
        car.mesh.position.x+fwd.x*.7+rt.x*0.82,_dty,car.mesh.position.z+fwd.z*.7+rt.z*0.82,
        (Math.random()-.5)*.025,.006+Math.random()*.014,(Math.random()-.5)*.025,
        1,.34,.34,.34,.8);
    }
  }else if(_driftShown){
    _driftShown=false;
    if(_driftBarEl)_driftBarEl.style.display='none';
    if(_driftLabelEl)_driftLabelEl.style.display='none';
  }
}


function updateNitroVisual(){
  if(!nitroActive)return;
  const car=carObjs[playerIdx];if(!car)return;
  const rt=_camV1.set(1,0,0).applyQuaternion(car.mesh.quaternion);
  const fwd=_camV2.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
  // Manual unroll of [-1,1].forEach. Random-skip preserved per side.
  if(Math.random()<=.45){
    const sx=car.mesh.position.x-rt.x*1.15+fwd.x*.8;
    const sy=car.mesh.position.y+.35+Math.random()*.2;
    const sz=car.mesh.position.z-rt.z*1.15+fwd.z*.8;
    sparkSystem.emit(sx,sy,sz,-rt.x*.09+(Math.random()-.5)*.03,.018+Math.random()*.04,-rt.z*.09+(Math.random()-.5)*.03,
      1,.25,.55,1.0,.95);
  }
  if(Math.random()<=.45){
    const sx=car.mesh.position.x+rt.x*1.15+fwd.x*.8;
    const sy=car.mesh.position.y+.35+Math.random()*.2;
    const sz=car.mesh.position.z+rt.z*1.15+fwd.z*.8;
    sparkSystem.emit(sx,sy,sz,rt.x*.09+(Math.random()-.5)*.03,.018+Math.random()*.04,rt.z*.09+(Math.random()-.5)*.03,
      1,.25,.55,1.0,.95);
  }
  // Extra rear exhaust flare
  if(Math.random()>.7){
    sparkSystem.emit(
      car.mesh.position.x+fwd.x*1.6,car.mesh.position.y+.28,car.mesh.position.z+fwd.z*1.6,
      fwd.x*.06,.02,fwd.z*.06,2,.9,.5,.1,.8);
  }
}


// Per-world tire-dust palette — leeg. Continuous per-frame puffs achter
// beide achterwielen vegen onder additive blend + bloom uit tot een witte
// streep die de nitro-vonkjes overstemt (zie Arctic screenshots). Pier 47
// heeft nooit een entry gehad en oogt schoon, dus alle werelden volgen die
// baseline. Drift-splash (_TIRE_SPLASH_CFG) blijft staan want die triggert
// alleen bij driftTimer>0.5 en geeft karakter zonder te smearen.
const _TIRE_DUST_CFG={};
// Phase 3c — splash variant: extra burst tijdens deep drift (driftTimer>0.5)
// of harde brake-decel. Lichter (hoger vy), korter (snel fade), brighter
// kleur dan dust. Worlds zonder splash-entry skippen het effect.
const _TIRE_SPLASH_CFG={
  arctic:   {r:1.00,g:1.00,b:1.00,life:0.45,vyBoost:0.06}, // sneeuw-fluffs
  deepsea:  {r:0.70,g:0.95,b:1.00,life:0.30,vyBoost:0.05}, // bioluminescent water
  pier47:   {r:0.80,g:0.85,b:0.95,life:0.35,vyBoost:0.05}, // harbor water spray
  guangzhou:{r:0.90,g:0.85,b:1.00,life:0.32,vyBoost:0.05}, // rain-neon spray
  sandstorm:{r:1.00,g:0.85,b:0.55,life:0.50,vyBoost:0.04}, // gouden zand
  candy:    {r:1.00,g:0.85,b:0.95,life:0.40,vyBoost:0.05}, // sugar shimmer
  volcano:  {r:1.00,g:0.75,b:0.30,life:0.35,vyBoost:0.06}, // hete vonk-puffs
};
// Per-world boost-trail tint — hoisted (same reason as above).
// Phase 8c — toegevoegd: pier47 (sodium-amber), sandstorm (gouden zand),
// guangzhou (cyber-magenta), zodat alle
// 9 worlds een unieke speed-trail krijgen i.p.v. fallback warm-oranje.
const _BOOST_TRAIL_TINT={
  space:[.5,.7,1.0],deepsea:[.3,1.0,.85],candy:[1.0,.45,.85],
  volcano:[1.0,.45,.15],arctic:[.65,.85,1.0],
  pier47:[1.0,.75,.40],sandstorm:[1.0,.80,.45],
  guangzhou:[1.0,.30,.85]
};
const _BOOST_TRAIL_TINT_DEFAULT=[1.0,.65,.30];
// Per-world cap on the speed-trail emission probability per frame. Without
// a cap, ratio²×0.55 plus nitro plus boost plus two side-streamers per
// emit drew a near-solid car-silhouette in additive particles every frame,
// which combined with bloom looked like ghost echoes behind every car.
// Default 0.30 in normal worlds, 0.20 in worlds where the particles are
// hardest to read against the ground (pink/sand/pastel grounds).
const _TRAIL_RATE_MAX = {
  candy:     0.20,
  sandstorm: 0.20,
  arctic:    0.25
};
const _TRAIL_RATE_MAX_DEFAULT = 0.30;
// Per-world nitro flame core color. Flames blenden additief dus de tint stuurt
// vooral de outer glow-rand; de hot core trekt altijd naar wit door alpha-overlap.
const _NITRO_FLAME_CFG={
  space:0x44aaff, candy:0xff66cc, volcano:0xff5522, deepsea:0x44ddcc,
  arctic:0xaaeeff, sandstorm:0xffaa44,
  pier47:0xffaa44, guangzhou:0xff44aa
};
const _NITRO_FLAME_DEFAULT=0xffaa44;
function updateBoostTrail(){
  // Continuous speed-trail achter de player op hoge snelheid + extra
  // dramatische streamers tijdens nitro/boost. Met bloom geven de hot
  // colors flink wat glow.
  const car=carObjs[playerIdx];if(!car)return;
  const top=Math.max(.01,car.def.topSpd);
  const ratio=Math.abs(car.speed)/top;
  // Per-world tire dust trail — kleine puffs bij de achterwielen, kleur en
  // emit-rate afhankelijk van ground-type. Actief bij ratio>0.30 zodat het
  // voelbaar is zodra je beweegt, en harder bij snelheid + drift.
  if(ratio>0.30){
    const tireCfg=_TIRE_DUST_CFG[activeWorld];
    if(tireCfg){
      const emitRate=tireCfg.rate*(0.4+ratio*0.7)*(driftTimer>0.2?1.6:1.0);
      if(Math.random()<emitRate){
        _plFwd.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
        _plRt.set(1,0,0).applyQuaternion(car.mesh.quaternion);
        // Manual unroll of [-0.78,0.78].forEach
        for(let _ti=0;_ti<2;_ti++){
          const s=_ti===0?-0.78:0.78;
          const tx=car.mesh.position.x+_plFwd.x*0.9+_plRt.x*s;
          const ty=car.mesh.position.y+0.10+Math.random()*0.08;
          const tz=car.mesh.position.z+_plFwd.z*0.9+_plRt.z*s;
          const vx=_plRt.x*s*0.04+(Math.random()-.5)*0.03;
          const vy=0.018+Math.random()*0.022;
          const vz=_plRt.z*s*0.04+(Math.random()-.5)*0.03;
          exhaustSystem.emit(tx,ty,tz,vx,vy,vz,1,tireCfg.r,tireCfg.g,tireCfg.b,tireCfg.life);
        }
      }
      // Phase 3c — splash burst tijdens echte hard drift / lock-up
      // (driftTimer>0.5). Brighter kleur, hoger vy, korter life. Skipt
      // werelden waar splash niet logisch is (space).
      const splashCfg=_TIRE_SPLASH_CFG[activeWorld];
      if(splashCfg && driftTimer>0.5 && Math.random()<0.65){
        for(let _si=0;_si<2;_si++){
          const s=_si===0?-0.78:0.78;
          const sx=car.mesh.position.x+_plFwd.x*0.7+_plRt.x*s;
          const sy=car.mesh.position.y+0.14;
          const sz=car.mesh.position.z+_plFwd.z*0.7+_plRt.z*s;
          const vx=_plRt.x*s*0.07+(Math.random()-.5)*0.05;
          const vy=splashCfg.vyBoost+Math.random()*0.04;
          const vz=_plRt.z*s*0.07+(Math.random()-.5)*0.05;
          sparkSystem.emit(sx,sy,sz,vx,vy,vz,1,splashCfg.r,splashCfg.g,splashCfg.b,splashCfg.life);
        }
      }
    }
  }
  if(ratio<0.55&&!nitroActive&&!car.boostTimer)return;
  const tint=_BOOST_TRAIL_TINT[activeWorld]||_BOOST_TRAIL_TINT_DEFAULT;
  const fwd=_camV1.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
  const rt=_camV2.set(1,0,0).applyQuaternion(car.mesh.quaternion);
  // Base trail rate scales met ratio². Globale coefficient van 0.55 → 0.35
  // omdat bovenop een per-world cap (_TRAIL_RATE_MAX) tegen het ghost-
  // silhouet-effect: zonder cap tekende ratio²×0.55 + nitro 0.45 + boost
  // 0.6 (totaal 1.6) een vrijwel onafgebroken auto-shape per frame.
  const _rateCap=_TRAIL_RATE_MAX[activeWorld]||_TRAIL_RATE_MAX_DEFAULT;
  const hot=nitroActive||car.boostTimer;
  let baseRate=ratio*ratio*0.35+(nitroActive?.30:0)+(car.boostTimer?.40:0);
  if(baseRate>_rateCap)baseRate=_rateCap;
  if(Math.random()<baseRate){
    // Manual unroll of [-0.55,0.55].forEach
    const rH=hot?Math.min(1,tint[0]+0.25):tint[0]*0.85;
    const gH=hot?Math.min(1,tint[1]+0.10):tint[1]*0.85;
    const bH=hot?Math.min(1,tint[2]+0.05):tint[2]*0.85;
    for(let _bi=0;_bi<2;_bi++){
      const s=_bi===0?-0.55:0.55;
      const tx=car.mesh.position.x+fwd.x*1.7+rt.x*s;
      const ty=car.mesh.position.y+0.18+Math.random()*0.15;
      const tz=car.mesh.position.z+fwd.z*1.7+rt.z*s;
      const vx=fwd.x*0.06+(Math.random()-.5)*0.04;
      const vy=0.012+Math.random()*0.018;
      const vz=fwd.z*0.06+(Math.random()-.5)*0.04;
      // Nitro/boost trails keep their longer life so they still feel
      // dramatic; cold speed-trails shortened (0.55-0.90 → 0.30-0.55) so
      // they don't overlap into a smear at top speed.
      const life=hot?(0.55+Math.random()*0.35):(0.30+Math.random()*0.25);
      sparkSystem.emit(tx,ty,tz,vx,vy,vz,1,rH,gH,bH,life);
    }
  }
  // Center streamer alleen tijdens echte boost (nitro / boost-pad) én bij
  // ratio>0.4: voorkomt dat een nitro-burst bij standstill een grote witte
  // vlek voor de bumper tekent (zichtbaar op de pre-Phase 2 screenshots).
  if((nitroActive||car.boostTimer)&&ratio>0.4&&Math.random()<0.65){
    sparkSystem.emit(
      car.mesh.position.x+fwd.x*1.95,
      car.mesh.position.y+0.32,
      car.mesh.position.z+fwd.z*1.95,
      fwd.x*0.10+(Math.random()-.5)*0.02,0.025+Math.random()*0.020,fwd.z*0.10+(Math.random()-.5)*0.02,
      1,1.0,0.88,0.45,0.65
    );
  }
}


// ── Tire compression in corners (Phase R2.3) ───────────────────────────────
// Wheels op de inner side van een corner zakken licht in (suspension comprimeert),
// outer wheels gaan licht omhoog (extends). We lezen car.mesh.rotation.z (body
// lean uit physics.js) en bewegen wheelFL/RL/FR/RR position.y ±2cm. Subtiel
// maar voegt veel professionalisme toe. Player only — AI compressie is verspild
// in render-budget en zelden in beeld.
function updateTireCompression(){
  const car = carObjs[playerIdx]; if(!car || !car.mesh) return;
  const ud = car.mesh.userData;
  const wheels = ud && ud.wheels; if(!wheels || wheels.length < 4) return;
  if(!ud._wheelBaseY){
    ud._wheelBaseY = wheels.map(w => w.position.y);
  }
  const lean = car.mesh.rotation.z; // positief = left turn → linker wheels comprimeren
  const C = 0.022; // max ±2.2cm compressie
  // wheels[0]=FL, [1]=FR, [2]=RL, [3]=RR
  // Left wheels (FL, RL): comprimeren bij lean>0
  // Right wheels (FR, RR): comprimeren bij lean<0
  const compL = -Math.max(0, lean) * C / 0.15;   // 0.15 rad = max body lean uit physics
  const extL  =  Math.max(0,-lean) * C / 0.15;
  const compR = -Math.max(0,-lean) * C / 0.15;
  const extR  =  Math.max(0, lean) * C / 0.15;
  wheels[0].position.y = ud._wheelBaseY[0] + compL + extL;
  wheels[1].position.y = ud._wheelBaseY[1] + compR + extR;
  wheels[2].position.y = ud._wheelBaseY[2] + compL + extL;
  wheels[3].position.y = ud._wheelBaseY[3] + compR + extR;
}

// ── Underglow pulse (Phase R2.2) ───────────────────────────────────────────
// Tijdens nitro of deep drift pulseert de player underglow disc 3 Hz tussen
// baseline en 1.8× baseline. Subtiel maar leesbaar — versterkt het "this is
// going fast" gevoel. Statisch buiten nitro/drift (geen change vs voor).
function updateUnderglowPulse(){
  const car = carObjs[playerIdx]; if(!car || !car.mesh) return;
  const ud = car.mesh.userData;
  const mat = ud && ud._underglowMat; if(!mat) return;
  const base = ud._underglowBase || 0.35;
  const aggressive = (typeof nitroActive!=='undefined' && nitroActive) || (typeof driftTimer!=='undefined' && driftTimer > 0.5);
  if(aggressive){
    const s = Math.sin(_nowSec * 18.85); // ~3 Hz
    const pulse = 0.5 + 0.5 * s * s;     // 0..1 lobed
    mat.opacity = base * (1 + pulse * 0.8);
  } else if(Math.abs(mat.opacity - base) > 0.005){
    // Snel terug naar baseline zodra het stopt
    mat.opacity += (base - mat.opacity) * 0.18;
  }
}

// ── Hazard indicator pulse (Phase R2.1) ────────────────────────────────────
// Bij critical damage (hitCount>=6) pulseren de 4 hoek-indicator lampen
// 2.5 Hz oranje. Auto-uit zodra hitCount<6 weer (post-pit-stop reset).
// Cheap: één emissiveIntensity write per car per frame, alleen actief boven
// threshold. Werkt op alle cars (player + AI tonen samen hazard signal als
// ze critical damage hebben — visuele cue dat field klem zit).
function updateHazardLights(){
  if(typeof carObjs==='undefined' || !carObjs.length) return;
  const t = _nowSec;
  // Blink-curve: 0..1 sin² geeft strakke aan/uit-pulse, niet wave-zacht
  const s = Math.sin(t * 7.85);
  const pulse = s > 0 ? s * s : 0; // half-cycle on, half off
  for(let i=0;i<carObjs.length;i++){
    const car = carObjs[i];
    const mat = car.mesh && car.mesh.userData && car.mesh.userData._hazardMat;
    if(!mat) continue;
    const critical = (car.hitCount || 0) >= 6;
    const target = critical ? pulse * 2.2 : 0;
    // Snel hot, sneller cold zodat blink crisp aanvoelt
    const rate = target > mat.emissiveIntensity ? 18 : 8;
    mat.emissiveIntensity += (target - mat.emissiveIntensity) * Math.min(1, 0.016 * rate);
  }
}

// ── CA spike decay (Phase 6) ───────────────────────────────────────────────
// Heavy collisions in collisions.js zetten window._caSpike=1.0. We decayen
// hier per-frame en schalen de atmosphere-pass caStrength uniform op zodat
// de chromatic-aberration kortstondig piekt. Bij rust → uniform terug naar
// per-world baseline (_atmo._world.caStr). Skipt als atmosphere-pass uit is.
function updateCaSpikeDecay(dt){
  const spike = window._caSpike || 0;
  if(spike < 0.01 && (window._caSpikePrev || 0) < 0.01) return; // idle skip
  // Exponentiële decay over ~350ms (e^(-dt*6) = ~0.013 na 0.7s, ~0.165 na 0.3s)
  const newSpike = spike * Math.exp(-dt * 6);
  window._caSpike = newSpike < 0.005 ? 0 : newSpike;
  window._caSpikePrev = newSpike;
  if(typeof _atmo === 'undefined' || !_atmo || !_atmo.ready) return;
  const u = _atmo.matCompositeExt && _atmo.matCompositeExt.uniforms;
  if(!u || !u.caStrength) return;
  const baseCa = (_atmo._world && typeof _atmo._world.caStr === 'number') ? _atmo._world.caStr : 0.004;
  u.caStrength.value = baseCa * (1 + newSpike * 1.5);
}

// ── Driver sway (Phase 4) ──────────────────────────────────────────────────
// Player driver-silhouette compenseert de body-tilt: car leunt naar binnen
// in een corner, schouders + hoofd kantelen tegen de tilt in zodat de driver
// "rechtop" blijft. Plus een micro-bob via sin zodat hij ook recht-uit
// rijdt levend voelt. Mobile skipt (silhouette wordt daar niet gebouwd).
function updateDriverSway(dt){
  if(window._isMobile)return;
  const car=carObjs[playerIdx];if(!car||!car.mesh)return;
  const parts=car.mesh.userData && car.mesh.userData._driverParts;
  if(!parts)return;
  // car.mesh.rotation.z is de body-lean (positief = links sturen). Driver
  // compenseert ~55% zodat hij nog meeleunt maar minder dan de car.
  const bodyLean=car.mesh.rotation.z;
  const targetZ=-bodyLean*0.55;
  const t=_nowSec*2.8;
  const bob=Math.sin(t)*0.012+Math.sin(t*1.7)*0.006;
  const headBobY=Math.sin(t*0.9)*0.008;
  // Smooth lerp zodat bij snelle steer-flips de driver niet schokt
  const lerpRate=Math.min(1,dt*9);
  parts.shoulders.rotation.z+=(targetZ+bob-parts.shoulders.rotation.z)*lerpRate;
  parts.head.rotation.z+=(targetZ*1.15+bob*0.7-parts.head.rotation.z)*lerpRate;
  // Subtle head bob op Y zodat hij niet als plank-stijf voelt
  parts.head.position.y=parts.anchorY+0.18+headBobY;
}

function updateCollisionFlash(dt){
  if(_contactPopupCD>0)_contactPopupCD-=dt;
  if(_colFlashT<=0)return;
  _colFlashT=Math.max(0,_colFlashT-dt);
  if(!_colFlashEl)_colFlashEl=document.getElementById('colFlash');
  if(_colFlashEl)_colFlashEl.style.opacity=String(Math.min(1,_colFlashT/.22));
}
let _colFlashEl=null;


// ── Nitro flame mesh (Phase 3a) ───────────────────────────────────────────
// Twee additive cone-meshes vlak achter de exhaust-pipes die alleen oplichten
// tijdens nitro of boost-pad. Per-world tint via _NITRO_FLAME_CFG. Mobile
// skipt deze pass volledig (extra draw call + transparante geometry duurder
// dan de bestaande spark-particles die al hetzelfde idee dragen).
let _nitroFlameL=null,_nitroFlameR=null,_nitroFlameMatL=null,_nitroFlameMatR=null;
let _nitroFlameOpacity=0;
let _nitroFlameTex=null;
let _nitroFlameLastHex=-1;
// Eigen canvas-builder ipv _buildParticleTex omdat we een 64×128 portret-
// aspect nodig hebben (ipv square). _sharedAsset:true flag zodat
// disposeScene de texture overslaat bij world-switch.
function _makeNitroFlameTex(){
  const c=document.createElement('canvas');c.width=64;c.height=128;
  const ctx=c.getContext('2d');
  const g=ctx.createLinearGradient(0,128,0,0);
  g.addColorStop(0.00,'rgba(255,255,255,0)');
  g.addColorStop(0.10,'rgba(255,250,230,1)');
  g.addColorStop(0.35,'rgba(255,180,90,0.85)');
  g.addColorStop(0.70,'rgba(255,90,30,0.45)');
  g.addColorStop(1.00,'rgba(255,40,10,0)');
  ctx.fillStyle=g;ctx.fillRect(0,0,64,128);
  // Horizontale alpha-falloff zodat zijkanten zacht zijn
  const h=ctx.getImageData(0,0,64,128);
  for(let y=0;y<128;y++){
    for(let x=0;x<64;x++){
      const dx=(x-32)/32;
      const fall=Math.max(0,1-dx*dx);
      const i=(y*64+x)*4+3;
      h.data[i]=h.data[i]*fall;
    }
  }
  ctx.putImageData(h,0,0);
  const t=new THREE.CanvasTexture(c);t.needsUpdate=true;
  t.userData={_sharedAsset:true};
  return t;
}
function _ensureNitroFlame(){
  // Stale-after-disposeScene check: na world-switch verwijdert disposeScene
  // de meshes uit scene.children. Onze module-cache wijst dan naar mesh
  // zonder parent → rebuild ipv early-return op stale ref.
  if(_nitroFlameL && _nitroFlameL.parent !== scene){
    _nitroFlameL=_nitroFlameR=_nitroFlameMatL=_nitroFlameMatR=null;
    _nitroFlameLastHex=-1;
  }
  if(_nitroFlameL)return;
  if(!_nitroFlameTex)_nitroFlameTex=_makeNitroFlameTex();
  // PlaneGeometry stand-up, base op y=0 zodat positionering eenvoudig is
  const geo=new THREE.PlaneGeometry(0.34,1.05);
  geo.translate(0,0.525,0);
  const mkMat=()=>new THREE.MeshBasicMaterial({
    map:_nitroFlameTex,transparent:true,opacity:0,
    blending:THREE.AdditiveBlending,depthWrite:false,
    side:THREE.DoubleSide,color:_NITRO_FLAME_DEFAULT
  });
  _nitroFlameMatL=mkMat();
  _nitroFlameL=new THREE.Mesh(geo,_nitroFlameMatL);
  _nitroFlameL.visible=false;_nitroFlameL.renderOrder=20;
  scene.add(_nitroFlameL);
  // Mobile downgrade: skip de rechter billboard. Eén centered flame ipv
  // twee asymmetrische ('66-7d8e3'-regressie verhelpt de mobile cost zonder
  // de visual helemaal weg te halen).
  if(window._isMobile)return;
  _nitroFlameMatR=mkMat();
  _nitroFlameR=new THREE.Mesh(geo.clone(),_nitroFlameMatR);
  _nitroFlameR.visible=false;_nitroFlameR.renderOrder=20;
  scene.add(_nitroFlameR);
}
const _nfFwd=new THREE.Vector3(),_nfRt=new THREE.Vector3(),_nfUp=new THREE.Vector3(0,1,0);
const _nfTmpQ=new THREE.Quaternion();
function updateNitroFlame(dt){
  const car=carObjs[playerIdx];
  if(!car||!car.mesh){
    if(_nitroFlameL)_nitroFlameL.visible=false;
    if(_nitroFlameR)_nitroFlameR.visible=false;
    return;
  }
  const active=nitroActive||car.boostTimer;
  // Smooth opacity fade in/out (90ms ramp)
  const target=active?1:0;
  _nitroFlameOpacity+=(target-_nitroFlameOpacity)*Math.min(1,dt*12);
  if(_nitroFlameOpacity<0.02&&!active){
    if(_nitroFlameL)_nitroFlameL.visible=false;
    if(_nitroFlameR)_nitroFlameR.visible=false;
    return;
  }
  _ensureNitroFlame();if(!_nitroFlameL)return;
  // Per-world color refresh — alleen setHex op world-switch ipv elke frame
  const hex=_NITRO_FLAME_CFG[activeWorld]||_NITRO_FLAME_DEFAULT;
  if(hex!==_nitroFlameLastHex){
    _nitroFlameMatL.color.setHex(hex);
    if(_nitroFlameMatR)_nitroFlameMatR.color.setHex(hex);
    _nitroFlameLastHex=hex;
  }
  const op=_nitroFlameOpacity*0.95;
  _nitroFlameMatL.opacity=op;
  if(_nitroFlameMatR)_nitroFlameMatR.opacity=op;
  // Position: 1.6u achter chassis center, 0.32u boven ground, ±0.55u zijwaarts
  _nfFwd.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
  _nfRt.set(1,0,0).applyQuaternion(car.mesh.quaternion);
  const cp=car.mesh.position;
  // Flicker scale via gecached _nowSec ipv extra performance.now() syscall
  const t=_nowSec*18;
  const flickL=0.85+0.18*Math.sin(t)+0.08*Math.sin(t*2.7);
  const stretch=nitroActive?1.35:(car.boostTimer?1.15:1.0);
  // Mobile single-flame: side=0 (centered). Desktop: dual flame (-1, +1).
  if(_nitroFlameR){
    const flickR=0.85+0.18*Math.sin(t+1.7)+0.08*Math.sin(t*2.4+0.9);
    for(let side=-1;side<=1;side+=2){
      const m=side<0?_nitroFlameL:_nitroFlameR;
      const flick=side<0?flickL:flickR;
      m.visible=true;
      m.position.set(
        cp.x+_nfFwd.x*1.55+_nfRt.x*0.55*side,
        cp.y+0.32,
        cp.z+_nfFwd.z*1.55+_nfRt.z*0.55*side
      );
      if(camera) m.lookAt(camera.position.x,m.position.y,camera.position.z);
      m.scale.set(flick,flick*stretch,1);
    }
  }else{
    _nitroFlameL.visible=true;
    _nitroFlameL.position.set(cp.x+_nfFwd.x*1.55, cp.y+0.32, cp.z+_nfFwd.z*1.55);
    if(camera) _nitroFlameL.lookAt(camera.position.x,_nitroFlameL.position.y,camera.position.z);
    _nitroFlameL.scale.set(flickL,flickL*stretch,1);
  }
}


// Hotspot #1 fix: scratch Vector3 hoist — voorheen per-emit allocation
// in updateDamageSmoke (~22 alloc/sec bij ≥6 hits, rest van de race).
const _dmgFwd = new THREE.Vector3();
function updateDamageSmoke(){
  const car=carObjs[playerIdx];if(!car||!car.hitCount)return;
  const hits=car.hitCount;
  if(hits<3)return;
  const rate=hits>=6?0.38:0.18; // heavier smoke at more damage
  if(Math.random()<rate){
    _dmgFwd.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
    exhaustSystem.emit(
      car.mesh.position.x-_dmgFwd.x*1.2,
      car.mesh.position.y+0.9,
      car.mesh.position.z-_dmgFwd.z*1.2,
      (Math.random()-.5)*.02,0.025+Math.random()*.02,(Math.random()-.5)*.02,
      1,0.28,0.28,0.28,0.5
    );
  }
}


function updateFastestLapFlash(dt){
  if(_fastestLapFlashT<=0)return;
  _fastestLapFlashT=Math.max(0,_fastestLapFlashT-dt);
  const el=_elFastestLapFlash;if(!el)return;
  // Pulsing purple flash that fades over 2.2s
  const base=_fastestLapFlashT/2.2;
  el.style.opacity=base*.7*(0.5+0.5*Math.sin(_nowSec*8));
}

function updateCloseBattle(dt){
  const car=carObjs[playerIdx];if(!car||!carObjs.length)return;
  const el=_elCloseBattle;if(!el)return;
  const px=car.mesh.position.x,pz=car.mesh.position.z;
  let close=false;
  for(let i=0;i<carObjs.length;i++){
    if(i===playerIdx)continue;
    const other=carObjs[i];if(other.finished)continue;
    const dx=px-other.mesh.position.x,dz=pz-other.mesh.position.z;
    if(dx*dx+dz*dz<64){close=true;break;}
  }
  if(close){
    _closeBattleTimer=Math.min(2,_closeBattleTimer+dt);
    if(_closeBattleTimer>.3&&el.style.display!=='block')el.style.display='block';
  }else{
    _closeBattleTimer=Math.max(0,_closeBattleTimer-dt*.5);
    if(_closeBattleTimer<=0&&el.style.display!=='none')el.style.display='none';
  }
}


// _lastRpmPct caches the last integer height-% applied to _elRpm. Rounding
// to int + gating skips the style.height string-write when the displayed
// value would be identical (visual difference between 87.4% and 87.6% is
// nil, but the string concat fires every frame otherwise).
let _lastRpmPct=-1;
function updateRpmBar(dt){
  if(!_elRpm)return;
  const car=carObjs[playerIdx];if(!car)return;
  const gear=_currentGear||1;
  const lo=_RPM_GEAR_RANGES[Math.max(0,gear-1)];
  const hi=_RPM_GEAR_RANGES[Math.min(4,gear)];
  const spd=Math.abs(car.speed);
  const top=car.def.topSpd;
  const ratio=hi>lo?Math.max(0,Math.min(1,(spd/top-lo)/(hi-lo))):spd/top;
  const isRedline=ratio>.88;
  const _pct=Math.round(ratio*100);
  if(_pct!==_lastRpmPct){_lastRpmPct=_pct;_elRpm.style.height=_pct+'%';}
  if(isRedline!==_lastRedline){
    _lastRedline=isRedline;
    _elRpm.style.background=isRedline?_RPM_GRAD_REDLINE:_RPM_GRAD_NORMAL;
  }
}


function updateRevLimiter(dt){
  if(!audioCtx)return;
  const car=carObjs[playerIdx];if(!car)return;
  const ratio=car.speed/Math.max(car.def.topSpd*.01,car.def.topSpd);
  if(ratio>.966&&!nitroActive&&!car.boostTimer){
    _revLimiterTimer+=dt;
    if(_revLimiterTimer>.42){playRevLimiter();_revLimiterTimer=0;}
  }else{_revLimiterTimer=Math.max(0,_revLimiterTimer-dt*3);}
}


function playRevLimiter(){
  if(!audioCtx)return;
  const sz=Math.ceil(audioCtx.sampleRate*.038);
  const buf=audioCtx.createBuffer(1,sz,audioCtx.sampleRate);
  const d=buf.getChannelData(0);for(let i=0;i<sz;i++)d[i]=(Math.random()*2-1)*(1-i/sz);
  const src=audioCtx.createBufferSource();src.buffer=buf;
  const f=audioCtx.createBiquadFilter();f.type='bandpass';f.frequency.value=2400;f.Q.value=1.2;
  const g=audioCtx.createGain();
  const t=audioCtx.currentTime;
  g.gain.setValueAtTime(.07,t);g.gain.exponentialRampToValueAtTime(.001,t+.04);
  src.connect(f);f.connect(g);g.connect(_dst());src.start(t);src.stop(t+.045);
}

// Cached DOM refs for the quick-restart bar (3 getElementById per frame
// otherwise). Display sentinels collapse the per-frame style.display
// writes to once-per-state-transition.
let _rstBarEl=null,_rstFillEl=null,_rstLblEl=null,_rstShown=false;
function updateQuickRestart(dt){
  const holding=keys['KeyR']&&gameState==='RACE';
  if(!_rstBarEl){
    _rstBarEl=document.getElementById('rstBar');
    _rstFillEl=document.getElementById('rstFill');
    _rstLblEl=document.getElementById('rstLabel');
  }
  if(holding){
    _rstHold=Math.min(1.5,_rstHold+dt);
    if(!_rstShown){
      _rstShown=true;
      if(_rstBarEl)_rstBarEl.style.display='block';
      if(_rstLblEl)_rstLblEl.style.display='block';
    }
    if(_rstFillEl)_rstFillEl.style.width=(_rstHold/1.5*100)+'%';
    if(_rstHold>=1.5){
      _rstHold=0;_rstShown=false;
      if(_rstBarEl)_rstBarEl.style.display='none';
      if(_rstLblEl)_rstLblEl.style.display='none';
      goToSelectAgain();
    }
  }else{
    if(_rstHold>0){_rstHold=Math.max(0,_rstHold-dt*3);}
    if(_rstHold<=0){
      if(_rstShown){
        _rstShown=false;
        if(_rstBarEl)_rstBarEl.style.display='none';
        if(_rstLblEl)_rstLblEl.style.display='none';
      }
    }else if(_rstFillEl)_rstFillEl.style.width=(_rstHold/1.5*100)+'%';
  }
}


function showSectorFlash(label,time,delta,color){
  var el=document.getElementById('sectorPanel');if(!el)return;
  // Build the 3 spans once and cache them on the element. Subsequent
  // sector crosses just write textContent + style.color — no innerHTML
  // parse, no full subtree rebuild, no style recalc storm. Big win when
  // this fires in the same frame as a lap-end save or EMP audio burst.
  var spans=el._flashSpans;
  if(!spans){
    el.textContent='';
    var a=document.createElement('span');a.style.color='#aaa';
    var b=document.createElement('span');b.style.fontSize='16px';b.style.margin='0 6px';
    var c=document.createElement('span');c.style.fontSize='11px';
    el.appendChild(a);el.appendChild(b);el.appendChild(c);
    spans=el._flashSpans=[a,b,c];
  }
  spans[0].textContent=label;
  spans[1].textContent=fmtTime(time);spans[1].style.color=color;
  spans[2].textContent=delta;spans[2].style.color=color;
  el.style.opacity='1';
  clearTimeout(el._ht);
  el._ht=setTimeout(function(){el.style.opacity='0';},2800);
}

function showSectorSplit(text,color){
  const el=document.getElementById('sectorInfo');if(!el)return;
  el.textContent=text;el.style.color=color;el.style.opacity='1';
  if(_secPopTimer)clearTimeout(_secPopTimer);
  _secPopTimer=setTimeout(()=>{el.style.opacity='0';},1100);
}

// floatText pool — pre-create N divs en hergebruik ze ipv elke pickup
// een nieuwe div te createElement+appendChild+remove. Per coin/jump scheelt
// dat 2 DOM-mutaties (layout-thrash) + een setTimeout-closure.
// Pool van 8 dekt de bestaande 6-simultaan budget met marge.
const _FT_POOL_SIZE=8;
const _ftPool=[];
let _ftPoolIdx=0;
function _ensureFloatTextPool(){
  if(_ftPool.length)return;
  for(let i=0;i<_FT_POOL_SIZE;i++){
    const el=document.createElement('div');
    el.className='floatText';
    el.style.display='none';
    document.body.appendChild(el);
    _ftPool.push(el);
  }
}
function floatText(text,color,screenX,screenY){
  _ensureFloatTextPool();
  if(_floatSlotTimer<=0)_floatSlot=0;
  _floatSlotTimer=1.6;
  const offsetY=_floatSlot*38;
  _floatSlot=(_floatSlot+1)%6; // up to 6 simultaneous, then wrap
  const el=_ftPool[_ftPoolIdx];
  _ftPoolIdx=(_ftPoolIdx+1)%_FT_POOL_SIZE;
  el.textContent=text;
  el.style.color=color;
  el.style.textShadow='0 1px 4px rgba(0,0,0,.8)';
  el.style.boxShadow='0 0 18px '+color+'66, 0 6px 18px rgba(0,0,0,.45)';
  el.style.left=Math.round(screenX)+'px';
  const maxTop=window._useTouchControls?innerHeight*.55:innerHeight-80;
  el.style.top=Math.round(Math.min(maxTop,Math.max(60,screenY-30-offsetY)))+'px';
  // Restart de floatUp keyframe-animatie: class strippen, forced reflow,
  // class terug. Anders pakt het pooled element de animatie niet opnieuw op.
  el.style.display='block';
  el.classList.remove('floatText');
  void el.offsetWidth; // reflow trigger
  el.classList.add('floatText');
}

function floatText3D(text,color,worldPos){
  if(!camera)return;
  const v=worldPos.clone().project(camera);
  const x=(v.x*.5+.5)*innerWidth,y=(1-(v.y*.5+.5))*innerHeight;
  if(x>0&&x<innerWidth&&y>0&&y<innerHeight)floatText(text,color,x,y);
}


// Shared skid-mark geometry — every mark uses the same .38×1.7 plane so we
// only allocate one BufferGeometry per session instead of one per skid event.
// Material is still per-mark (opacity fades independently per mark).
let _skidGeo=null;
function _getSkidGeo(){
  if(!_skidGeo)_skidGeo=new THREE.PlaneGeometry(.38,1.7);
  return _skidGeo;
}
// Per-world skid-mark colour table. Hoisted to module scope so addSkidMark
// doesn't allocate a fresh object literal + branch chain on every drift
// frame. Past bij ground-type: sneeuw/zand → donker-bruin-grijze sporen,
// lava-grond → hete oranje-rode (additive emissive), wet asphalt → zwart.
const _SKID_CFG_MAP={
  arctic:   {color:0x33424f,blend:false},   // donker grijs op sneeuw
  deepsea:  {color:0x4a3a20,blend:false},   // donker zand
  volcano:  {color:0xff4400,blend:true},    // hete sporen op lava-rock
  candy:    {color:0x4a1a30,blend:false},   // donker roze op fondant
  space:    {color:0x2244aa,blend:true},    // ion-trail blauw (additive)
};
const _SKID_CFG_DEFAULT={color:0x0a0a0a,blend:false};
// Skid-mark material freelist — split per blending mode because Three's
// material.blending change does NOT free-mutate at runtime (it forces a
// shader recompile). Color + opacity DO free-mutate. Evicted marks push
// their material onto the right pool; addSkidMark() pops first and
// rewrites color + opacity, otherwise allocates a fresh MeshBasicMaterial.
// Cap-mirroring skidMarks's 80 limit keeps total allocation bounded.
const _SKID_MAT_POOL_PLAIN=[];
const _SKID_MAT_POOL_BLEND=[];
function _acquireSkidMat(skidCfg, baseOp){
  const pool = skidCfg.blend ? _SKID_MAT_POOL_BLEND : _SKID_MAT_POOL_PLAIN;
  let mat = pool.pop();
  if(mat){
    mat.color.setHex(skidCfg.color);
    mat.opacity = baseOp;
  } else {
    const opts={color:skidCfg.color,transparent:true,opacity:baseOp,depthWrite:false};
    if(skidCfg.blend) opts.blending=THREE.AdditiveBlending;
    mat = new THREE.MeshBasicMaterial(opts);
  }
  return mat;
}
function _releaseSkidMat(mat){
  if(!mat) return;
  // Inspect the material's blend setting to route back into the right pool.
  const pool = (mat.blending===THREE.AdditiveBlending) ? _SKID_MAT_POOL_BLEND : _SKID_MAT_POOL_PLAIN;
  if(pool.length < 90) pool.push(mat);
  else mat.dispose();  // hard-cap so a runaway race doesn't leak materials
}

// Phase 6.7 — skid-mark cap. Mobile blijft op 80 (lower-end devices),
// desktop krijgt 200 zodat marks accumuleren over een 3-lap race.
// Fade duration verdubbelt (12s → 24s desktop, 12s blijft mobile).
const _SKID_CAP = (typeof window!=='undefined' && window._isMobile) ? 80 : 200;
const _SKID_FADE_SEC = (typeof window!=='undefined' && window._isMobile) ? 12 : 24;
// Dedicated Group container for skidmarks — scene.remove(mesh) on the root
// scene does a linear scan through scene.children (thousands of objects on
// busy worlds), costing ~1-3ms per expired mark. A small Group with at most
// _SKID_CAP=200 children narrows the remove cost to its own child-array.
// Re-acquired per world-switch since disposeScene removes the prior group.
//
// Mesh pool: pre-alloceer alle _SKID_CAP*2 (links+rechts) THREE.Mesh objecten
// één keer en recycle ze via .visible toggle. Dit voorkomt de per-landing
// `new THREE.Mesh()` + `group.remove()` GC-druk die op harde landingen merk-
// baar hangt op slow hardware. Materials blijven uit de bestaande pool komen
// (zie _acquireSkidMat); alleen de mesh-container wordt gerecycled.
let _skidGroup = null;
let _skidMeshPool = null; // Array<THREE.Mesh> — alle _SKID_CAP*2 vooraf gemaakt
function _getSkidGroup(){
  if(!_skidGroup || _skidGroup.parent !== scene){
    _skidGroup = new THREE.Group();
    _skidGroup.name = 'skidMarks';
    // Mark so disposeScene+lod-cull treat the group as a passive container
    // (skidmarks themselves still get culled individually if very far).
    _skidGroup.userData = { _noLodCull: true };
    scene.add(_skidGroup);
    // Bouw mesh-pool één keer per scene/group. Geometry is shared; material
    // is een null-placeholder die addSkidMark per gebruik vervangt door een
    // mat uit _acquireSkidMat. .visible=false zodat ze niet draw-en tot
    // gebruik. _SKID_CAP*2 want addSkidMark spawnt links+rechts paar.
    _skidMeshPool = new Array(_SKID_CAP * 2);
    const sharedGeo = _getSkidGeo();
    for(let i = 0; i < _skidMeshPool.length; i++){
      const m = new THREE.Mesh(sharedGeo, null);
      m.visible = false;
      m.rotation.x = -Math.PI/2;
      _skidGroup.add(m);
      _skidMeshPool[i] = m;
    }
  }
  return _skidGroup;
}

// Pop een vrije mesh uit de pool. Een vrije mesh heeft .visible===false en
// material===null. O(N) lineaire scan, maar N≤400 en addSkidMark wordt
// maximaal ~30Hz aangeroepen tijdens drift, dus pragmatisch goedkoop.
// Als de pool vol is (alle meshes in gebruik) return null — caller doet dan
// fallback eviction.
function _acquireSkidMesh(){
  if(!_skidMeshPool) return null;
  for(let i = 0; i < _skidMeshPool.length; i++){
    const m = _skidMeshPool[i];
    if(!m.visible && !m.material) return m;
  }
  return null;
}

function addSkidMark(car,opacityOverride){
  _plFwd.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
  _plRt.set(1,0,0).applyQuaternion(car.mesh.quaternion);
  const fwd=_plFwd,rt=_plRt;
  const baseOp=opacityOverride||0.72;
  const skidCfg=_SKID_CFG_MAP[activeWorld]||_SKID_CFG_DEFAULT;
  _getSkidGroup(); // ensures pool exists
  for(let i=0;i<2;i++){
    const s=i===0?-0.65:0.65;
    // Cap-enforce: behoud het originele gedrag van max _SKID_CAP actieve
    // marks. Pool kan _SKID_CAP*2 meshes vasthouden voor burst-headroom,
    // maar visuele consistentie eist dat we niet 2× zoveel marks blijven
    // tonen vergeleken met pre-pool gedrag. Bij overschrijding evict de
    // oudste actieve mark (FIFO via shift).
    if(skidMarks.length >= _SKID_CAP){
      const old = skidMarks.shift();
      _releaseSkidMat(old.mesh.material);
      old.mesh.material = null;
      old.mesh.visible = false;
    }
    // Try pool first; if full (n.b. only mogelijk als de cap-enforce hier-
    // boven niet voldoende vrijmaakte, bv. de eerste paar skid-events na
    // een wereld-switch waar de pool net herbouwd is), evict oudste.
    let sm = _acquireSkidMesh();
    if(!sm && skidMarks.length){
      const old = skidMarks.shift();
      _releaseSkidMat(old.mesh.material);
      old.mesh.material = null;
      old.mesh.visible = false;
      sm = old.mesh;
    }
    if(!sm) continue; // pool destroyed mid-flight
    sm.material = _acquireSkidMat(skidCfg, baseOp);
    sm.position.copy(car.mesh.position).addScaledVector(rt,s).addScaledVector(fwd,1.5);
    sm.position.y = .013;
    sm.visible = true;
    skidMarks.push({mesh:sm,born:_nowSec,maxOp:baseOp});
  }
}

function updateSkidMarks(){
  if(!skidMarks.length) return;
  for(let i=skidMarks.length-1;i>=0;i--){
    const s=skidMarks[i];
    const op=Math.max(0,(s.maxOp||.72)*(1-(_nowSec-s.born)/_SKID_FADE_SEC));
    if(op<=0){
      _releaseSkidMat(s.mesh.material);
      s.mesh.material = null;
      s.mesh.visible = false;
      skidMarks.splice(i,1);
    } else {
      s.mesh.material.opacity=op;
    }
  }
}


function updateSprinkles(dt){
  if(!_sprinkleGeo)return;
  const pos=_sprinkleGeo.attributes.position.array;
  const car=carObjs[playerIdx];
  const cx=car?car.mesh.position.x:0,cz=car?car.mesh.position.z:0;
  const count=pos.length/3;
  const step=Math.floor(_nowSec*600)%6;
  for(let i=step;i<count;i+=6){
    pos[i*3+1]-=dt*1.5+Math.random()*.01;
    if(pos[i*3+1]<-.5){
      pos[i*3]=(Math.random()-.5)*600+cx;
      pos[i*3+1]=20+Math.random()*4;
      pos[i*3+2]=(Math.random()-.5)*600+cz;
    }
  }
  _sprinkleGeo.attributes.position.needsUpdate=true;
}


// Per-car brake-heat: lerp caliper emissive based on speed-derivative.
// Brake hard → orange glow rises fast; release → cools quickly. Both
// player + AI participate. Skipped entirely on mobile to keep update cost
// minimal (10 cars × material write per frame is small but adds up with
// other per-frame iterations).
let _BRAKEHEAT_HOT_COLOR = null;
let _BRAKEHEAT_DISC_COLOR = null;
function updateBrakeHeat(dt){
  if(typeof carObjs==='undefined' || !carObjs.length) return;
  if(!_BRAKEHEAT_HOT_COLOR) _BRAKEHEAT_HOT_COLOR = new THREE.Color(0xff5520);
  if(!_BRAKEHEAT_DISC_COLOR) _BRAKEHEAT_DISC_COLOR = new THREE.Color(0xff3a08);
  for(let i=0;i<carObjs.length;i++){
    const car = carObjs[i];
    const ud = car.mesh && car.mesh.userData;
    const m = ud && ud._calMatHot;
    if(!m) continue;
    // Decel detection — positive when speed dropping. Multiply by 24 so
    // a 0.04 dt-speed drop maps to ~1.0 intensity (matches strong braking
    // at the higher topSpdMult values).
    const decel = (car._prevSpeed || car.speed) - car.speed;
    const target = Math.max(0, Math.min(0.95, decel * 24));
    // Faster attack on heat-up, slower release (resembles thermal mass)
    const rate = (target > m.emissiveIntensity ? 9 : 2.2);
    m.emissiveIntensity += (target - m.emissiveIntensity) * Math.min(1, dt*rate);
    if(m.emissiveIntensity > 0.02){
      m.emissive.copy(_BRAKEHEAT_HOT_COLOR);
    } else if(m.emissive.r > 0.01){
      m.emissive.setHex(0x000000);
    }
    // Phase 3b — disc heat mirror (subtieler, ~40% van caliper-intensiteit
    // en iets roder zodat schijf+caliper samen lezen als gradient van rood
    // door oranje. Discs hebben tragere release-rate (1.6) want grotere
    // thermische massa dan caliper.
    const dm = ud._discMatHot;
    if(dm){
      const dTarget = target * 0.40;
      const dRate = (dTarget > dm.emissiveIntensity ? 7 : 1.6);
      dm.emissiveIntensity += (dTarget - dm.emissiveIntensity) * Math.min(1, dt*dRate);
      if(dm.emissiveIntensity > 0.02){
        dm.emissive.copy(_BRAKEHEAT_DISC_COLOR);
      } else if(dm.emissive.r > 0.01){
        dm.emissive.setHex(0x000000);
      }
    }
    car._prevSpeed = car.speed;
  }
}

// Phase 8.2 — dirt accumulation per car.
// Linear lerp van 0→1 over ~90s race. Multipliciatief op _carPBR
// materials (paint/accent/lens) zodat cars geleidelijk dimmer worden.
// 3× sneller off-track via tracklimits.js setting _dirtRate. Reset bij
// race-restart via window._resetDirt() in race.js.
const _DIRT_BUILD_RATE = 1.0 / 90.0;
const _DIRT_DARKEN_MAX = 0.25;
function updateDirt(dt){
  if(typeof carObjs === 'undefined' || !carObjs.length) return;
  for(let i=0; i<carObjs.length; i++){
    const car = carObjs[i];
    if(!car.mesh || !car.mesh.userData) continue;
    const ud = car.mesh.userData;
    if(typeof ud._dirt !== 'number') ud._dirt = 0;
    const rate = _DIRT_BUILD_RATE * (ud._dirtRate || 1);
    ud._dirt = Math.min(1, ud._dirt + dt * rate);
    // Lazy-cache material refs op eerste call. Bij world-switch worden
    // car.mesh objects vervangen + userData reset — _dirtMats wordt
    // dan opnieuw opgebouwd.
    if(!ud._dirtMats){
      ud._dirtMats = [];
      car.mesh.traverse(o => {
        if(o.material && o.material.userData && o.material.userData._carPBR){
          if(!o.material.userData._origColor){
            o.material.userData._origColor = o.material.color.clone();
          }
          ud._dirtMats.push(o.material);
        }
      });
    }
    const f = ud._dirt;
    if(f > 0.001){
      const dim = 1 - _DIRT_DARKEN_MAX * f;
      for(let j=0; j<ud._dirtMats.length; j++){
        const m = ud._dirtMats[j];
        if(m.userData._origColor){
          m.color.copy(m.userData._origColor);
          m.color.multiplyScalar(dim);
        }
      }
    }
  }
}

// Race-restart reset hook — called from race.js _resetRaceState.
function resetDirt(){
  if(typeof carObjs === 'undefined') return;
  for(let i=0; i<carObjs.length; i++){
    const car = carObjs[i];
    if(car.mesh && car.mesh.userData){
      car.mesh.userData._dirt = 0;
      const mats = car.mesh.userData._dirtMats;
      if(mats){
        for(let j=0; j<mats.length; j++){
          const m = mats[j];
          if(m.userData && m.userData._origColor){
            m.color.copy(m.userData._origColor);
          }
        }
      }
    }
  }
}
if(typeof window !== 'undefined') window._resetDirt = resetDirt;

// Gate the colour + distance writes — they only flip with nitroActive but
// were re-set every frame.
let _bgLastNitro=null;
function updateBoostGlow(){
  if(!_boostLight){_boostLight=new THREE.PointLight(0x00ccff,0,28);scene.add(_boostLight);}
  const car=carObjs[playerIdx];
  if(!car){_boostLight.intensity=0;return;}
  _boostLight.position.copy(car.mesh.position);_boostLight.position.y+=1.2;
  const tgt=nitroActive?3.8:(car.boostTimer>0?2.4:0);
  _boostLight.intensity+=((tgt-_boostLight.intensity))*.18;
  if(nitroActive!==_bgLastNitro){
    _bgLastNitro=nitroActive;
    _boostLight.color.setHex(nitroActive?0xff8800:0x00ccff);
    _boostLight.distance=nitroActive?32:22;
  }
}

function spawnFlames(){
  const c=document.getElementById('titleFlames');
  const pal=['#ff6600','#ff3300','#ffaa00','#ff1100','#ffcc00','#ff4400'];
  for(let i=0;i<48;i++){const f=document.createElement('div');f.className='flame';const h=28+Math.random()*110,w=3+Math.random()*6;f.style.cssText=`left:${Math.random()*100}%;height:${h}px;width:${w}px;background:${pal[i%pal.length]};animation-duration:${.75+Math.random()*2.3}s;animation-delay:${-Math.random()*2.5}s`;c.appendChild(f);}
}

// Ghost-replay (buildGhostMesh / updateGhost / saveGhostIfPB) → js/gameplay/ghost.js
