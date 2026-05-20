// js/worlds/arctic-iceshelf.js — cracking ice shelf in arctic world.
// Non-module script. Loads BEFORE worlds/arctic.js so its build/update
// functions are visible when arctic.js calls them.
//
// Lifecycle:
//   buildArcticIceShelf()                — called from buildArcticEnvironment()
//   updateArcticIceShelf(dt, currentLap) — called from updateArcticWorld(dt)
//   disposeArcticIceShelf()              — called from _resetRaceState()
//
// Mirrors the volcano-bridge pivot architecture: each plate is a nested
// Group pair (outerGrp = yaw, innerGrp = tilt around local Z). Plate offset
// is -side*PANEL_W/2 on local X so the plate centers above the track when
// innerGrp has zero rotation. Tilting innerGrp swings the plate down from
// its outer edge.
//
// Lap-progressive states (driven from currentLap argument, not callbacks —
// idempotent so a mid-race pause/resume can't desync the visuals):
//   lap 1 → cool plates, gentle water-pool pulse beneath
//   lap 2 → bioluminescent fissures glow on plates, water-pool runs cooler
//   lap 3 → alternating plates dip ~22° downward (time-based ramp + ease-in-quad
//           over ~1.5s), water-pool peaks
//
// Track range: t in [_SHELF_T_START, _SHELF_T_END] — clear of black-ice
// patches at t=.15/.38/.62/.82 in arctic.js.

'use strict';

const _SHELF_T_START=0.42;
const _SHELF_T_END=0.54;
const _SHELF_SEGMENTS=8;
const _SHELF_PANEL_W=18;
const _SHELF_PANEL_L=6;
const _SHELF_PANEL_H=0.5;
const _SHELF_TILT_RAD=22*Math.PI/180;
const _SHELF_CRACK_DURATION=1.0; // seconds for crack-progress 0→1
const _SHELF_TILT_DURATION=1.5;  // seconds for tilt-progress 0→1
// Plate color lerp endpoints (cool ice → lighter cyan as fissures heat the surface).
const _SHELF_DECK_R0=0xdd/255, _SHELF_DECK_G0=0xee/255, _SHELF_DECK_B0=0xff/255;
const _SHELF_DECK_R1=0xee/255, _SHELF_DECK_G1=0xff/255, _SHELF_DECK_B1=0xff/255;

let _arcticShelfSegs=[];   // [{outer, inner, mesh, side, index}]
let _arcticShelfPool=null;
let _arcticShelfState=null;

function buildArcticIceShelf(){
  if(typeof scene==='undefined'||!scene||typeof trackCurve==='undefined'||!trackCurve)return;
  // Idempotency guard.
  disposeArcticIceShelf();
  // ── Water pool under the ice shelf ──
  {
    const tMid=(_SHELF_T_START+_SHELF_T_END)*.5;
    const pMid=trackCurve.getPoint(tMid);
    const tg=trackCurve.getTangent(tMid).normalize();
    const yawMid=Math.atan2(tg.x,tg.z);
    const pA=trackCurve.getPoint(_SHELF_T_START),pB=trackCurve.getPoint(_SHELF_T_END);
    const arc=Math.hypot(pB.x-pA.x,pB.z-pA.z)*1.2;
    // depthWrite:false so dipping plates can pass beneath without z-fighting.
    const poolMat=new THREE.MeshLambertMaterial({color:0x335577,emissive:0x1a3a5a,emissiveIntensity:.4,transparent:true,opacity:.85,depthWrite:false});
    const pool=new THREE.Mesh(new THREE.PlaneGeometry(arc+24,40),poolMat);
    pool.rotation.x=-Math.PI/2;
    pool.rotation.z=yawMid;
    pool.position.set(pMid.x,-0.6,pMid.z);
    scene.add(pool);
    _arcticShelfPool=pool;
  }
  // ── Ice shelf plate segments ──
  // Shared geometry (1 GPU buffer), per-segment cloned materials so the
  // bioluminescent fissures can pulse independently per plate on lap 2.
  const plateGeo=new THREE.BoxGeometry(_SHELF_PANEL_W,_SHELF_PANEL_H,_SHELF_PANEL_L);
  const plateMatProto=new THREE.MeshLambertMaterial({color:0xddeeff,emissive:0x224466,emissiveIntensity:.15,transparent:true,opacity:.95});
  for(let i=0;i<_SHELF_SEGMENTS;i++){
    const t=_SHELF_T_START+(i+.5)*((_SHELF_T_END-_SHELF_T_START)/_SHELF_SEGMENTS);
    const p=trackCurve.getPoint(t);
    const tg=trackCurve.getTangent(t).normalize();
    const yaw=Math.atan2(tg.x,tg.z);
    // Checkerboard side pattern: tilters [0,2,4,6] alternate [+1,-1,+1,-1].
    const side=(i%4<2)?1:-1;
    const lxX=Math.cos(yaw),lxZ=-Math.sin(yaw);
    const outer=new THREE.Group();
    outer.position.set(p.x+side*(_SHELF_PANEL_W*.5)*lxX, 0.05, p.z+side*(_SHELF_PANEL_W*.5)*lxZ);
    outer.rotation.y=yaw;
    const inner=new THREE.Group();
    outer.add(inner);
    const plateMat=plateMatProto.clone();
    const plate=new THREE.Mesh(plateGeo,plateMat);
    plate.position.x=-side*(_SHELF_PANEL_W*.5);
    plate.receiveShadow=true;
    inner.add(plate);
    scene.add(outer);
    _arcticShelfSegs.push({outer:outer,inner:inner,mesh:plate,side:side,index:i});
  }
  // The prototype was only used to seed clones; dispose to avoid a leaked material.
  plateMatProto.dispose();
  _arcticShelfState={crackStartT:-1,tiltStartT:-1};
}

function updateArcticIceShelf(dt,currentLap){
  if(!_arcticShelfState)return;
  const st=_arcticShelfState;
  const t=(typeof _nowSec==='number')?_nowSec:0;
  // Lap-edge detection with reset-on-rewind (race-restart safe).
  if(currentLap>=2&&st.crackStartT<0)st.crackStartT=t;
  else if(currentLap<2)st.crackStartT=-1;
  if(currentLap>=3&&st.tiltStartT<0)st.tiltStartT=t;
  else if(currentLap<3)st.tiltStartT=-1;
  // Time-based ramps (predictable: full at exactly _SHELF_*_DURATION seconds).
  const crackProgress=(st.crackStartT>=0)?Math.min(1,(t-st.crackStartT)/_SHELF_CRACK_DURATION):0;
  const tiltProgress=(st.tiltStartT>=0)?Math.min(1,(t-st.tiltStartT)/_SHELF_TILT_DURATION):0;
  const tiltEased=tiltProgress*tiltProgress; // ease-in-quad
  // Water-pool emissive ramps up per lap.
  if(_arcticShelfPool&&_arcticShelfPool.material){
    const lapBoost=(currentLap>=2?0.2:0)+(currentLap>=3?0.4:0);
    _arcticShelfPool.material.emissiveIntensity=0.3+Math.sin(t*1.2)*.15+lapBoost;
  }
  // Pre-compute per-frame color lerp (same for all plates).
  const colR=_SHELF_DECK_R0+(_SHELF_DECK_R1-_SHELF_DECK_R0)*crackProgress;
  const colG=_SHELF_DECK_G0+(_SHELF_DECK_G1-_SHELF_DECK_G0)*crackProgress;
  const colB=_SHELF_DECK_B0+(_SHELF_DECK_B1-_SHELF_DECK_B0)*crackProgress;
  for(let i=0;i<_arcticShelfSegs.length;i++){
    const seg=_arcticShelfSegs[i];
    if(seg.mesh&&seg.mesh.material){
      const m=seg.mesh.material;
      // Bioluminescent fissures: emissive boost (per-segment phase via i so the shelf breathes).
      m.emissiveIntensity=0.15+crackProgress*(0.5+0.2*Math.sin(t*3+i));
      m.color.setRGB(colR,colG,colB);
    }
    // Tilt: only even-indexed plates dip down. Sign matches Volcano's
    // pattern (-side) so plates fall outward from the track-center.
    if(seg.inner&&i%2===0){
      seg.inner.rotation.z=-seg.side*_SHELF_TILT_RAD*tiltEased;
    }
  }
}

function disposeArcticIceShelf(){
  // Scene-traversal in disposeScene() handles geometry/material cleanup.
  // We only clear our own references so the next race rebuilds cleanly.
  _arcticShelfSegs.length=0;
  _arcticShelfPool=null;
  _arcticShelfState=null;
  // Release the night.js sky-cache (day + night skybox + PMREM env).
  if(typeof _disposeArcticSkyCache==='function')_disposeArcticSkyCache();
}
