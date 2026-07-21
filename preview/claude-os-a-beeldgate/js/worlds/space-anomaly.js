// js/worlds/space-anomaly.js — expanding gravity anomaly signature in Space.
// Non-module script. Loads BEFORE worlds/space.js so its build/update
// functions are available when the host wires them.
//
// Lifecycle:
//   buildSpaceAnomaly()                — called from track/environment.js (space branch of buildWorldElements)
//   updateSpaceAnomaly(dt, currentLap) — called from worlds/space.js updateSpaceWorld(dt)
//   disposeSpaceAnomaly()              — called from _resetRaceState()
//
// Layers a lap-progressive expansion of the existing _spaceGravityWells
// (built by buildSpaceGravityWells in worlds/space.js). Module owns one
// extra "warp halo" billboard per well — a translucent torus that scales
// up per lap to telegraph the anomaly's growing pull radius. Geometry
// cleanup via disposeScene() traversal; we only release refs.
//
// Lap-progressive states:
//   lap 1 → wells at baseline (radius 22, strength 0.007 — existing)
//   lap 2 → wells expand to ×1.50 radius/strength + warp halos appear
//   lap 3 → wells expand to ×2.10 radius/strength, halos large + faster spin
//
// On dispose, baseline radius/strength are restored on every well so a
// subsequent non-Space race doesn't inherit stretched zones.

'use strict';

const _SPACE_ANOM_LAP2_SCALE=1.50;
const _SPACE_ANOM_LAP3_SCALE=2.10;
const _SPACE_ANOM_TRANSITION_DURATION=2.0; // seconds for lap-edge ramp
const _SPACE_ANOM_HALO_BASE_R=8;           // halo torus base radius (units)

let _spaceAnomalyState=null;

function buildSpaceAnomaly(){
  if(typeof scene==='undefined'||!scene)return;
  // Idempotency guard.
  disposeSpaceAnomaly();
  if(typeof _spaceGravityWells==='undefined'||!Array.isArray(_spaceGravityWells)||_spaceGravityWells.length===0)return;
  // Snapshot baseline radius/strength per well so dispose can restore.
  const wellBase=[];
  for(let i=0;i<_spaceGravityWells.length;i++){
    const w=_spaceGravityWells[i];
    if(!w)continue;
    wellBase.push({well:w,radius:w.radius,strength:w.strength});
  }
  // One warp halo per well — torus scaled-down to invisible until lap 2.
  // Shared geometry, per-well cloned material so individual phases differ.
  // Skip on mobile: halos are pure visual telegraphing, the radius/strength
  // ramp still gives the lap-progressive gameplay feel without the alpha-blend
  // fillrate cost.
  const halos=[];
  const mobile=(typeof _isMobile!=='undefined'&&_isMobile);
  if(!mobile){
    const haloGeo=new THREE.TorusGeometry(_SPACE_ANOM_HALO_BASE_R,.18,8,40);
    const haloMatProto=new THREE.MeshLambertMaterial({
      color:0x6600ff,emissive:0xaa00ff,emissiveIntensity:1.6,
      transparent:true,opacity:0,depthWrite:false,
    });
    for(let i=0;i<wellBase.length;i++){
      const w=wellBase[i].well;
      const halo=new THREE.Mesh(haloGeo,haloMatProto.clone());
      halo.rotation.x=Math.PI/2;
      halo.position.copy(w.pos);halo.position.y=.04;
      halo.scale.setScalar(0.001); // start invisible (avoid initial pop)
      halo.visible=false;          // skip render submission until lap-edge
      scene.add(halo);
      halos.push(halo);
    }
    haloMatProto.dispose();
  }
  _spaceAnomalyState={
    lap2StartT:-1,lap3StartT:-1,
    wellBase:wellBase,
    halos:halos,
  };
}

function updateSpaceAnomaly(dt,currentLap){
  if(!_spaceAnomalyState)return;
  const st=_spaceAnomalyState;
  const t=(typeof _nowSec==='number')?_nowSec:0;
  // Lap-edge detection with reset-on-rewind.
  if(currentLap>=2&&st.lap2StartT<0)st.lap2StartT=t;
  else if(currentLap<2)st.lap2StartT=-1;
  if(currentLap>=3&&st.lap3StartT<0)st.lap3StartT=t;
  else if(currentLap<3)st.lap3StartT=-1;
  const lap2Progress=(st.lap2StartT>=0)?Math.min(1,(t-st.lap2StartT)/_SPACE_ANOM_TRANSITION_DURATION):0;
  const lap3Progress=(st.lap3StartT>=0)?Math.min(1,(t-st.lap3StartT)/_SPACE_ANOM_TRANSITION_DURATION):0;
  // Multiplier ramp: 1 → LAP2_SCALE on lap 2, → LAP3_SCALE on lap 3.
  const desiredScale=(lap3Progress>0)
    ?(_SPACE_ANOM_LAP2_SCALE+(_SPACE_ANOM_LAP3_SCALE-_SPACE_ANOM_LAP2_SCALE)*lap3Progress)
    :(1+(_SPACE_ANOM_LAP2_SCALE-1)*lap2Progress);
  // Apply to underlying wells (consumed by checkGravityZones in space.js).
  for(let i=0;i<st.wellBase.length;i++){
    const wb=st.wellBase[i];
    if(!wb.well)continue;
    wb.well.radius=wb.radius*desiredScale;
    wb.well.strength=wb.strength*desiredScale;
  }
  // Halo visuals: opacity + scale ramp + slow spin. Skip if no halos
  // (mobile-fallback: builder didn't spawn them — covered by the loop range).
  // Halo radius matches the well's expanded pull radius proportionally.
  const haloVisible=(lap2Progress>0||lap3Progress>0);
  for(let i=0;i<st.halos.length;i++){
    const halo=st.halos[i];
    if(!halo)continue;
    if(!haloVisible){
      if(halo.visible)halo.visible=false;
      continue;
    }
    if(!halo.visible)halo.visible=true;
    // Scale the torus to roughly match the well's growing radius (~22→46).
    const wellRadius=st.wellBase[i].radius*desiredScale;
    const haloScale=wellRadius/_SPACE_ANOM_HALO_BASE_R;
    halo.scale.set(haloScale,haloScale,1);
    if(halo.material){
      const baseOp=(lap3Progress>0)?(0.35+0.20*lap3Progress):0.18*lap2Progress;
      halo.material.opacity=baseOp+0.08*Math.sin(t*2+i*1.7);
      halo.material.emissiveIntensity=1.4+0.6*Math.sin(t*3+i);
    }
    // Counter-rotate vs underlying well rings for a subtle warp feel.
    halo.rotation.z+=dt*(0.4+0.4*lap3Progress);
  }
  // One-shot lap-edge SFX.
  if(st.lap2StartT>=0&&!st._lap2Sfx){
    st._lap2Sfx=true;
    if(typeof beep==='function'){beep(140,.3,.18,0,'sine');beep(220,.4,.12,.08,'sine');}
    if(window.dbg)dbg.log('env','space-anomaly lap2 enter');
  }else if(st.lap2StartT<0&&st._lap2Sfx){st._lap2Sfx=false;}
  if(st.lap3StartT>=0&&!st._lap3Sfx){
    st._lap3Sfx=true;
    if(typeof beep==='function'){beep(80,.6,.28,0,'sine');beep(110,.5,.18,.1,'sine');}
    if(typeof _noise==='function')_noise(.5,300,.8,.12);
    if(window.dbg)dbg.log('env','space-anomaly lap3 enter');
  }else if(st.lap3StartT<0&&st._lap3Sfx){st._lap3Sfx=false;}
}

function disposeSpaceAnomaly(){
  if(!_spaceAnomalyState){return;}
  const st=_spaceAnomalyState;
  // Restore baseline radius/strength on every well.
  for(let i=0;i<st.wellBase.length;i++){
    const wb=st.wellBase[i];
    if(!wb.well)continue;
    wb.well.radius=wb.radius;
    wb.well.strength=wb.strength;
  }
  // Halo geometry/material cleanup handled by disposeScene() traversal.
  st.halos.length=0;
  st.wellBase.length=0;
  _spaceAnomalyState=null;
}
