// js/worlds/candy-chocobridge.js — melting chocolate-fountain bridge in candy world.
// Non-module script. Loads BEFORE worlds/candy.js so its build/update
// functions are visible when candy.js calls them.
//
// Lifecycle:
//   buildCandyChocoBridge()                — called from buildCandyEnvironment()
//   updateCandyChocoBridge(dt, currentLap) — called from updateCandyWorld(dt)
//   disposeCandyChocoBridge()              — called from _resetRaceState()
//
// Mirrors the volcano-bridge pivot architecture (outer=yaw, inner=tilt).
// Slabs sit over a chocolate-pool plane that runs hotter per lap.
//
// Lap-progressive states:
//   lap 1 → glossy solid slabs, gentle chocolate-pool pulse
//   lap 2 → drip emissive ramp, slabs sag subtle (-0.1 on y), pool warmer
//   lap 3 → alternating slabs sag/tilt 28° downward AND scale.y → 0.6
//           ("smelt" effect) over 1.5s ease-in-quad, pool peaks
//
// Track range: t in [_BRIDGE_T_START, _BRIDGE_T_END]. Chocolate-river in
// candy.js is in the infield (x ~ -100..80, z ~ -220..50) — not track-bound,
// so the bridge uses a self-contained chocolate-pool below the track instead.

'use strict';

const _CHOCO_T_START=0.50;
const _CHOCO_T_END=0.62;
const _CHOCO_SEGMENTS=8;
const _CHOCO_PANEL_W=18;
const _CHOCO_PANEL_L=6;
const _CHOCO_PANEL_H=0.6;
const _CHOCO_TILT_RAD=28*Math.PI/180;
const _CHOCO_DRIP_DURATION=1.0; // seconds for drip-progress 0→1
const _CHOCO_MELT_DURATION=1.5; // seconds for melt-progress 0→1
// Slab color lerp endpoints (cool chocolate → molten warm chocolate).
const _CHOCO_DECK_R0=0x4a/255, _CHOCO_DECK_G0=0x28/255, _CHOCO_DECK_B0=0x18/255;
const _CHOCO_DECK_R1=0x6a/255, _CHOCO_DECK_G1=0x28/255, _CHOCO_DECK_B1=0x10/255;

let _candyChocoSegs=[];
let _candyChocoPool=null;
let _candyChocoState=null;

function buildCandyChocoBridge(){
  if(typeof scene==='undefined'||!scene||typeof trackCurve==='undefined'||!trackCurve)return;
  // Idempotency guard.
  disposeCandyChocoBridge();
  // ── Chocolate pool under the bridge ──
  {
    const tMid=(_CHOCO_T_START+_CHOCO_T_END)*.5;
    const pMid=trackCurve.getPoint(tMid);
    const tg=trackCurve.getTangent(tMid).normalize();
    const yawMid=Math.atan2(tg.x,tg.z);
    const pA=trackCurve.getPoint(_CHOCO_T_START),pB=trackCurve.getPoint(_CHOCO_T_END);
    const arc=Math.hypot(pB.x-pA.x,pB.z-pA.z)*1.2;
    // depthWrite:false so dipping slabs can pass beneath without z-fighting.
    // Phase 13A — chocolate pool MeshStandard voor glossy reflectie
    const poolMat=new THREE.MeshStandardMaterial({
      color:0x6a3818, emissive:0x4a2010, emissiveIntensity:.5,
      roughness:0.20, metalness:0.40, envMapIntensity:1.3,
      transparent:true, opacity:.92, depthWrite:false
    });
    const pool=new THREE.Mesh(new THREE.PlaneGeometry(arc+24,40),poolMat);
    pool.rotation.x=-Math.PI/2;
    pool.rotation.z=yawMid;
    pool.position.set(pMid.x,-0.7,pMid.z);
    scene.add(pool);
    _candyChocoPool=pool;
  }
  // ── Bridge slab segments ──
  const slabGeo=new THREE.BoxGeometry(_CHOCO_PANEL_W,_CHOCO_PANEL_H,_CHOCO_PANEL_L);
  // Phase 13A — bridge slabs MeshStandard voor glossy chocolate finish
  const slabMatProto=new THREE.MeshStandardMaterial({
    color:0x4a2818, emissive:0x2a1408, emissiveIntensity:.2,
    roughness:0.22, metalness:0.40, envMapIntensity:1.2
  });
  for(let i=0;i<_CHOCO_SEGMENTS;i++){
    const t=_CHOCO_T_START+(i+.5)*((_CHOCO_T_END-_CHOCO_T_START)/_CHOCO_SEGMENTS);
    const p=trackCurve.getPoint(t);
    const tg=trackCurve.getTangent(t).normalize();
    const yaw=Math.atan2(tg.x,tg.z);
    // Checkerboard side pattern: tilters [0,2,4,6] alternate [+1,-1,+1,-1].
    const side=(i%4<2)?1:-1;
    const lxX=Math.cos(yaw),lxZ=-Math.sin(yaw);
    const outer=new THREE.Group();
    outer.position.set(p.x+side*(_CHOCO_PANEL_W*.5)*lxX, 0.05, p.z+side*(_CHOCO_PANEL_W*.5)*lxZ);
    outer.rotation.y=yaw;
    const inner=new THREE.Group();
    outer.add(inner);
    const slabMat=slabMatProto.clone();
    const slab=new THREE.Mesh(slabGeo,slabMat);
    slab.position.x=-side*(_CHOCO_PANEL_W*.5);
    slab.receiveShadow=true;
    inner.add(slab);
    scene.add(outer);
    _candyChocoSegs.push({outer:outer,inner:inner,mesh:slab,side:side,index:i});
  }
  slabMatProto.dispose();
  _candyChocoState={dripStartT:-1,meltStartT:-1};
}

function updateCandyChocoBridge(dt,currentLap){
  if(!_candyChocoState)return;
  const st=_candyChocoState;
  const t=(typeof _nowSec==='number')?_nowSec:0;
  // Lap-edge detection with reset-on-rewind.
  if(currentLap>=2&&st.dripStartT<0)st.dripStartT=t;
  else if(currentLap<2)st.dripStartT=-1;
  if(currentLap>=3&&st.meltStartT<0)st.meltStartT=t;
  else if(currentLap<3)st.meltStartT=-1;
  const dripProgress=(st.dripStartT>=0)?Math.min(1,(t-st.dripStartT)/_CHOCO_DRIP_DURATION):0;
  const meltProgress=(st.meltStartT>=0)?Math.min(1,(t-st.meltStartT)/_CHOCO_MELT_DURATION):0;
  const meltEased=meltProgress*meltProgress;
  // Chocolate-pool emissive ramps up per lap.
  if(_candyChocoPool&&_candyChocoPool.material){
    const lapBoost=(currentLap>=2?0.25:0)+(currentLap>=3?0.45:0);
    _candyChocoPool.material.emissiveIntensity=0.4+Math.sin(t*1.0)*.2+lapBoost;
  }
  // Pre-compute per-frame color lerp.
  const colR=_CHOCO_DECK_R0+(_CHOCO_DECK_R1-_CHOCO_DECK_R0)*dripProgress;
  const colG=_CHOCO_DECK_G0+(_CHOCO_DECK_G1-_CHOCO_DECK_G0)*dripProgress;
  const colB=_CHOCO_DECK_B0+(_CHOCO_DECK_B1-_CHOCO_DECK_B0)*dripProgress;
  // Subtle pre-melt sag on lap 2 (all slabs zakken iets), full melt on lap 3 (alternating tilt + flatten).
  const sagY=-0.1*dripProgress;
  for(let i=0;i<_candyChocoSegs.length;i++){
    const seg=_candyChocoSegs[i];
    if(seg.mesh&&seg.mesh.material){
      const m=seg.mesh.material;
      // Drip emissive boost (per-segment phase via i).
      m.emissiveIntensity=0.2+dripProgress*(0.4+0.18*Math.sin(t*2.4+i));
      m.color.setRGB(colR,colG,colB);
      // Melt: slab flattens (scale.y) — chocolade vloeit i.p.v. knapt.
      seg.mesh.scale.y=1-0.4*meltEased;
    }
    // Pre-melt sag applied to all slabs via outer-y; full tilt on even-indexed.
    seg.outer.position.y=0.05+sagY;
    if(seg.inner&&i%2===0){
      seg.inner.rotation.z=-seg.side*_CHOCO_TILT_RAD*meltEased;
    }
  }
}

function disposeCandyChocoBridge(){
  // Scene-traversal in disposeScene() handles geometry/material cleanup.
  _candyChocoSegs.length=0;
  _candyChocoPool=null;
  _candyChocoState=null;
  // Release the night.js sky-cache (day + night skybox + PMREM env).
  if(typeof _disposeCandySkyCache==='function')_disposeCandySkyCache();
}
