// js/worlds/deepsea-current.js — strengthening current stream signature in Deep Sea.
// Non-module script. Loads BEFORE worlds/deepsea.js so its build/update
// functions are available when the host wires them.
//
// Lifecycle:
//   buildDeepSeaCurrent()                — called from track/environment.js (deepsea branch of buildWorldElements)
//   updateDeepSeaCurrent(dt, currentLap) — called from worlds/deepsea.js updateDeepSeaWorld(dt)
//   disposeDeepSeaCurrent()              — called from _resetRaceState()
//
// Layers a lap-progressive intensification of the existing _wpCurrentStreams
// (built by buildCurrentStreams in worlds/deepsea.js). Module owns no
// geometry — modulates per-stream `strength` (consumed by checkCurrentStreams)
// and the global `_dsaCurrentDir` drift speed used by updateDeepSeaWorld.
//
// Lap-progressive states:
//   lap 1 → existing baseline (visible streams, strength 2.8, gentle drift)
//   lap 2 → strength ×1.6, ambient drift speed ×1.8 — player feels light pull
//   lap 3 → strength ×2.4, drift speed ×2.6 — must actively counter-steer,
//           bubbles drift faster (visual cue)
//
// On dispose, baseline strength + drift-speed multipliers are restored.

'use strict';

const _DSA_CURRENT_LAP2_SCALE=1.60;
const _DSA_CURRENT_LAP3_SCALE=2.40;
const _DSA_CURRENT_LAP2_DRIFT=1.80;
const _DSA_CURRENT_LAP3_DRIFT=2.60;
const _DSA_CURRENT_TRANSITION_DURATION=2.0; // seconds for lap-edge ramp

let _dsaCurrentSigState=null;

function buildDeepSeaCurrent(){
  if(typeof scene==='undefined'||!scene)return;
  // Idempotency guard.
  disposeDeepSeaCurrent();
  if(typeof _wpCurrentStreams==='undefined'||!Array.isArray(_wpCurrentStreams)||_wpCurrentStreams.length===0)return;
  // Snapshot baseline strength per stream so dispose can restore.
  const streamBase=[];
  for(let i=0;i<_wpCurrentStreams.length;i++){
    const cs=_wpCurrentStreams[i];
    if(!cs)continue;
    streamBase.push({stream:cs,strength:cs.strength});
  }
  _dsaCurrentSigState={
    lap2StartT:-1,lap3StartT:-1,
    streamBase:streamBase,
    // Drift-speed multiplier is exposed via a window global so deepsea.js
    // can pick it up without us having to monkey-patch its update fn.
    // updateDeepSeaWorld currently does `_dsaCurrentDir += dt*.04` — once
    // this module is wired, deepsea.js multiplies that step by this factor.
    driftMult:1,
  };
  window._dsaCurrentDriftMult=1;
}

function updateDeepSeaCurrent(dt,currentLap){
  if(!_dsaCurrentSigState)return;
  const st=_dsaCurrentSigState;
  const t=(typeof _nowSec==='number')?_nowSec:0;
  // Lap-edge detection with reset-on-rewind.
  if(currentLap>=2&&st.lap2StartT<0)st.lap2StartT=t;
  else if(currentLap<2)st.lap2StartT=-1;
  if(currentLap>=3&&st.lap3StartT<0)st.lap3StartT=t;
  else if(currentLap<3)st.lap3StartT=-1;
  const lap2Progress=(st.lap2StartT>=0)?Math.min(1,(t-st.lap2StartT)/_DSA_CURRENT_TRANSITION_DURATION):0;
  const lap3Progress=(st.lap3StartT>=0)?Math.min(1,(t-st.lap3StartT)/_DSA_CURRENT_TRANSITION_DURATION):0;
  // Per-stream strength ramp.
  const desiredScale=(lap3Progress>0)
    ?(_DSA_CURRENT_LAP2_SCALE+(_DSA_CURRENT_LAP3_SCALE-_DSA_CURRENT_LAP2_SCALE)*lap3Progress)
    :(1+(_DSA_CURRENT_LAP2_SCALE-1)*lap2Progress);
  for(let i=0;i<st.streamBase.length;i++){
    const sb=st.streamBase[i];
    if(!sb.stream)continue;
    sb.stream.strength=sb.strength*desiredScale;
  }
  // Ambient drift speed multiplier (read by updateDeepSeaWorld for _dsaCurrentDir).
  const desiredDrift=(lap3Progress>0)
    ?(_DSA_CURRENT_LAP2_DRIFT+(_DSA_CURRENT_LAP3_DRIFT-_DSA_CURRENT_LAP2_DRIFT)*lap3Progress)
    :(1+(_DSA_CURRENT_LAP2_DRIFT-1)*lap2Progress);
  st.driftMult=desiredDrift;
  window._dsaCurrentDriftMult=desiredDrift;
  // One-shot lap-edge SFX (low rumbling current swell).
  if(st.lap2StartT>=0&&!st._lap2Sfx){
    st._lap2Sfx=true;
    if(typeof _noise==='function')_noise(.7,260,.9,.16);
    if(window.dbg)dbg.log('env','deepsea-current lap2 enter');
  }else if(st.lap2StartT<0&&st._lap2Sfx){st._lap2Sfx=false;}
  if(st.lap3StartT>=0&&!st._lap3Sfx){
    st._lap3Sfx=true;
    if(typeof _noise==='function')_noise(1.0,180,.8,.24);
    if(typeof beep==='function')beep(70,.6,.18,0,'sine');
    if(window.dbg)dbg.log('env','deepsea-current lap3 enter');
  }else if(st.lap3StartT<0&&st._lap3Sfx){st._lap3Sfx=false;}
}

function disposeDeepSeaCurrent(){
  if(!_dsaCurrentSigState){
    if(typeof window!=='undefined')window._dsaCurrentDriftMult=1;
    return;
  }
  const st=_dsaCurrentSigState;
  // Restore baseline stream strengths.
  for(let i=0;i<st.streamBase.length;i++){
    const sb=st.streamBase[i];
    if(!sb.stream)continue;
    sb.stream.strength=sb.strength;
  }
  st.streamBase.length=0;
  if(typeof window!=='undefined')window._dsaCurrentDriftMult=1;
  _dsaCurrentSigState=null;
}
