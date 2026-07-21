// js/worlds/volcano-bridge.js — collapsing lava bridge in volcano world.
// Non-module script. Loads BEFORE worlds/volcano.js so its build/update
// functions are visible when volcano.js calls them.
//
// Lifecycle:
//   buildVolcanoBridge()                — called from buildVolcanoEnvironment()
//   updateVolcanoBridge(dt, currentLap) — called from updateVolcanoWorld(dt)
//   disposeVolcanoBridge()              — called from _resetRaceState()
//
// Pivot architecture: each segment is a nested Group pair.
//   outerGrp  — positioned at the pivot edge of the deck, rotation.y = track yaw
//   innerGrp  — child of outerGrp, holds the tilt around its local Z (= track
//               tangent direction, because outerGrp is already yaw-rotated).
// The deck mesh is offset inside innerGrp by -side*PANEL_W/2 along local X
// so the deck appears centered on the track when innerGrp has zero rotation.
// Tilting innerGrp around local Z swings the deck down from its outer edge.
//
// Lap-progressive states (driven from currentLap argument, not callbacks —
// idempotent so a mid-race pause/resume can't desync the visuals):
//   lap 1 → cool deck, gentle lava-pool pulse
//   lap 2 → cracks glow on the deck, lava-pool runs hotter
//   lap 3 → alternating segments tilt 35° away (time-based ramp + ease-in-quad
//           over ~1.5s), lava-pool peaks
//
// Track range: t ∈ [_BRIDGE_T_START, _BRIDGE_T_END]. Geysers sit at
// t = 0.22 / 0.52 / 0.78 in volcano.js, so the bridge sits between the
// 0.52 and 0.78 geysers to avoid spatial overlap.

'use strict';

const _BRIDGE_T_START=0.55;
const _BRIDGE_T_END=0.67;
const _BRIDGE_SEGMENTS=8;
const _BRIDGE_PANEL_W=18;
const _BRIDGE_PANEL_L=6;
const _BRIDGE_PANEL_H=0.5;
const _BRIDGE_TILT_RAD=35*Math.PI/180;
const _BRIDGE_CRACK_DURATION=1.0; // seconds for crack-progress 0→1
const _BRIDGE_TILT_DURATION=1.5;  // seconds for tilt-progress 0→1
// Camera-shake on lap-3 tilt: fired once per race when tilt crosses
// _BRIDGE_SHAKE_THRESHOLD AND the player is within _BRIDGE_SHAKE_RADIUS
// of the bridge center. Magnitude well below the geiser collision shake (1.2).
const _BRIDGE_SHAKE_THRESHOLD=0.3;
const _BRIDGE_SHAKE_RADIUS_SQ=60*60;
const _BRIDGE_SHAKE_AMOUNT=0.8;
// Asphalt color lerp endpoints (cool deck → smoldering red).
const _BRIDGE_DECK_R0=0x2a/255, _BRIDGE_DECK_G0=0x1a/255, _BRIDGE_DECK_B0=0x14/255;
const _BRIDGE_DECK_R1=0x5a/255, _BRIDGE_DECK_G1=0x28/255, _BRIDGE_DECK_B1=0x18/255;

let _volcanoBridgeSegs=[];   // [{outer, inner, mesh, side, index}]
let _volcanoBridgeLava=null;
let _volcanoBridgeState=null;

function buildVolcanoBridge(){
  if(typeof scene==='undefined'||!scene||typeof trackCurve==='undefined'||!trackCurve)return;
  // Idempotency guard: if buildScene is invoked without _resetRaceState
  // beforehand (a dev-path edge case), the prior race's segment refs would
  // still be in our arrays. Clear them first so we never push on top of stale.
  disposeVolcanoBridge();
  // ── Lava pool under the bridge ──
  {
    const tMid=(_BRIDGE_T_START+_BRIDGE_T_END)*.5;
    const pMid=trackCurve.getPoint(tMid);
    const tg=trackCurve.getTangent(tMid).normalize();
    const yawMid=Math.atan2(tg.x,tg.z);
    const pA=trackCurve.getPoint(_BRIDGE_T_START),pB=trackCurve.getPoint(_BRIDGE_T_END);
    const arc=Math.hypot(pB.x-pA.x,pB.z-pA.z)*1.2;
    // depthWrite:false matches the eruption particle pattern in volcano.js
    // and prevents the near-opaque pool from incorrectly occluding tilted
    // deck panels that will dip below it on lap 3.
    const lavaMat=new THREE.MeshLambertMaterial({color:0xff4400,emissive:0xff2200,emissiveIntensity:1.4,transparent:true,opacity:.95,depthWrite:false});
    const lava=new THREE.Mesh(new THREE.PlaneGeometry(arc+24,40),lavaMat);
    lava.rotation.x=-Math.PI/2;
    lava.rotation.z=yawMid;
    lava.position.set(pMid.x,-0.9,pMid.z);
    scene.add(lava);
    _volcanoBridgeLava=lava;
  }
  // ── Bridge deck segments ──
  // Shared geometry (1 GPU buffer), per-segment cloned materials so V2's
  // crack-glow can pulse independently per panel.
  const deckGeo=new THREE.BoxGeometry(_BRIDGE_PANEL_W,_BRIDGE_PANEL_H,_BRIDGE_PANEL_L);
  const deckMatProto=new THREE.MeshLambertMaterial({color:0x2a1a14,emissive:0x110800,emissiveIntensity:.15});
  for(let i=0;i<_BRIDGE_SEGMENTS;i++){
    const t=_BRIDGE_T_START+(i+.5)*((_BRIDGE_T_END-_BRIDGE_T_START)/_BRIDGE_SEGMENTS);
    const p=trackCurve.getPoint(t);
    const tg=trackCurve.getTangent(t).normalize();
    const yaw=Math.atan2(tg.x,tg.z);
    // side determines which edge is the pivot (and therefore which way the
    // panel falls). Tilt-eligible (even-indexed) segments alternate side every
    // two indices — pattern (i%4 < 2) gives sides [+1,+1,-1,-1,+1,+1,-1,-1],
    // so even-indexed tilters [0,2,4,6] alternate [+1,-1,+1,-1] → panels fall
    // checkerboard rather than all-same-direction.
    const side=(i%4<2)?1:-1;
    // outerGrp local +X (after rotation.y=yaw) in world = (cos(yaw), 0, -sin(yaw)).
    const lxX=Math.cos(yaw),lxZ=-Math.sin(yaw);
    const outer=new THREE.Group();
    outer.position.set(p.x+side*(_BRIDGE_PANEL_W*.5)*lxX, 0.05, p.z+side*(_BRIDGE_PANEL_W*.5)*lxZ);
    outer.rotation.y=yaw;
    const inner=new THREE.Group();
    outer.add(inner);
    const deckMat=deckMatProto.clone();
    const deck=new THREE.Mesh(deckGeo,deckMat);
    deck.position.x=-side*(_BRIDGE_PANEL_W*.5);
    deck.receiveShadow=true;
    inner.add(deck);
    scene.add(outer);
    _volcanoBridgeSegs.push({outer:outer,inner:inner,mesh:deck,side:side,index:i});
  }
  // The prototype was only used to seed clones; dispose to avoid a leaked material.
  deckMatProto.dispose();
  // Bridge center for distance-based effects (camera-shake trigger).
  const tMid=(_BRIDGE_T_START+_BRIDGE_T_END)*.5;
  const pMid=trackCurve.getPoint(tMid);
  _volcanoBridgeState={crackStartT:-1,tiltStartT:-1,tiltShakeFired:false,centerX:pMid.x,centerZ:pMid.z};
}

function updateVolcanoBridge(dt,currentLap){
  if(!_volcanoBridgeState)return;
  const st=_volcanoBridgeState;
  const t=(typeof _nowSec==='number')?_nowSec:0;
  // Lap-edge detection: latch a start-time the first frame the lap-threshold
  // is crossed, clear it if the lap drops back (race-restart edge case).
  if(currentLap>=2&&st.crackStartT<0)st.crackStartT=t;
  else if(currentLap<2)st.crackStartT=-1;
  if(currentLap>=3&&st.tiltStartT<0)st.tiltStartT=t;
  else if(currentLap<3){st.tiltStartT=-1;st.tiltShakeFired=false;}
  // Time-based ramp (predictable: full at exactly _BRIDGE_*_DURATION seconds).
  const crackProgress=(st.crackStartT>=0)?Math.min(1,(t-st.crackStartT)/_BRIDGE_CRACK_DURATION):0;
  const tiltProgress=(st.tiltStartT>=0)?Math.min(1,(t-st.tiltStartT)/_BRIDGE_TILT_DURATION):0;
  const tiltEased=tiltProgress*tiltProgress; // ease-in-quad, "structural fail" feel
  // One-shot camera-shake at tilt-start when the player is on/near the bridge.
  // Reads camShake (declared in js/gameplay/camera.js) and sets it without
  // overriding a stronger active shake (e.g. from a fresh geiser hit).
  if(st.tiltStartT>=0&&!st.tiltShakeFired&&tiltProgress>_BRIDGE_SHAKE_THRESHOLD){
    if(typeof carObjs!=='undefined'&&typeof playerIdx!=='undefined'){
      const pl=carObjs[playerIdx];
      if(pl&&pl.mesh){
        const dx=pl.mesh.position.x-st.centerX,dz=pl.mesh.position.z-st.centerZ;
        if(dx*dx+dz*dz<_BRIDGE_SHAKE_RADIUS_SQ&&typeof camShake!=='undefined'){
          if(camShake<_BRIDGE_SHAKE_AMOUNT)camShake=_BRIDGE_SHAKE_AMOUNT;
        }
      }
    }
    st.tiltShakeFired=true;
  }
  // Lava-pool emissive ramps up per lap, plus a brief flash during the
  // first second of tilt (peak at tilt-start, decays linearly).
  if(_volcanoBridgeLava&&_volcanoBridgeLava.material){
    const lapBoost=(currentLap>=2?0.3:0)+(currentLap>=3?0.5:0);
    const tiltFlash=(st.tiltStartT>=0&&tiltProgress<0.5)?(1-tiltProgress*2)*1.2:0;
    _volcanoBridgeLava.material.emissiveIntensity=1.1+Math.sin(t*1.6)*.35+lapBoost+tiltFlash;
  }
  // Pre-compute per-frame color lerp constants (same for all segments).
  const colR=_BRIDGE_DECK_R0+(_BRIDGE_DECK_R1-_BRIDGE_DECK_R0)*crackProgress;
  const colG=_BRIDGE_DECK_G0+(_BRIDGE_DECK_G1-_BRIDGE_DECK_G0)*crackProgress;
  const colB=_BRIDGE_DECK_B0+(_BRIDGE_DECK_B1-_BRIDGE_DECK_B0)*crackProgress;
  // Per-segment apply.
  for(let i=0;i<_volcanoBridgeSegs.length;i++){
    const seg=_volcanoBridgeSegs[i];
    if(seg.mesh&&seg.mesh.material){
      const m=seg.mesh.material;
      // Cracks: emissive boost (per-segment phase via i so the bridge breathes).
      m.emissiveIntensity=0.15+crackProgress*(0.55+0.2*Math.sin(t*3+i));
      m.color.setRGB(colR,colG,colB);
    }
    // Tilt: only even-indexed segments swing away. The remaining 4 panels
    // form a discontinuous path the player must thread through on lap 3.
    if(seg.inner&&i%2===0){
      seg.inner.rotation.z=-seg.side*_BRIDGE_TILT_RAD*tiltEased;
    }
  }
}

function disposeVolcanoBridge(){
  // Scene-traversal in disposeScene() handles geometry/material cleanup
  // generically (isMesh + dispose). We only clear our own references so
  // the next race rebuilds cleanly without stale closures.
  _volcanoBridgeSegs.length=0;
  _volcanoBridgeLava=null;
  _volcanoBridgeState=null;
  // Release the night.js sky-cache (day + night skybox + PMREM env). These
  // outlive a single race because they're cached for instant M-toggle, so
  // they need explicit cleanup before the next buildScene allocates fresh
  // day textures (otherwise the old day-cache holds a stale reference).
  if(typeof _disposeVolcanoSkyCache==='function')_disposeVolcanoSkyCache();
}
