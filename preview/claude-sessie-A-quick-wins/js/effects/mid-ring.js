// js/effects/mid-ring.js — Phase 11A: shared helper for per-world
// mid-ground prop rings placed at BARRIER_OFF + offsetMin..offsetMax along
// trackCurve. Each world builds its own InstancedMesh(es) and passes them
// to _populateMidRing() which fills the matrices for both sides of the track.
//
// Non-module script. Depends on: THREE, trackCurve, BARRIER_OFF (globals).

'use strict';

// Populate `im` with instances along the track. opts:
//   perSide        — number of instances per side (after _mobCount applied)
//   offsetMin/Max  — lateral offset from BARRIER_OFF
//   yFn(scale)     — returns vertical position; defaults to 0
//   scaleMin/Max   — uniform scale range; defaults to 1.0
//   rotY           — true to randomise Y rotation (default true)
//   tiltAmt        — small random X/Z tilt amplitude (default 0)
//   stagger        — sample-phase offset 0..1 to break alignment between IMs
//   clusterAnchors — optional array of t∈[0,1] anchor positions. When given,
//                    instances spawn within ±clusterRadius of a random anchor
//                    instead of uniform stratified spread. Used by candy to
//                    cluster emissive props around lamp-pole t-positions —
//                    light-eilanden with dark valleys between. Backward-compat:
//                    omit to keep uniform stratified behavior.
//   clusterRadius  — half-width of anchor spread in t-units (default 0.04 ≈ 4%).
function _populateMidRing(im, opts){
  if(!im || typeof trackCurve==='undefined' || !trackCurve)return 0;
  const perSide   = Math.max(1, opts.perSide|0);
  const offMin    = opts.offsetMin != null ? opts.offsetMin : 22;
  const offMax    = opts.offsetMax != null ? opts.offsetMax : 52;
  const yFn       = opts.yFn || (()=>0);
  const sMin      = opts.scaleMin != null ? opts.scaleMin : 1;
  const sMax      = opts.scaleMax != null ? opts.scaleMax : 1;
  const tilt      = opts.tiltAmt || 0;
  const rotY      = opts.rotY !== false;
  const stagger   = (opts.stagger || 0) % 1;
  const clusterAnchors = (opts.clusterAnchors && opts.clusterAnchors.length) ? opts.clusterAnchors : null;
  const clusterRadius  = opts.clusterRadius != null ? opts.clusterRadius : 0.04;
  const pts       = trackCurve.getPoints(200);
  const N         = pts.length;
  const m4        = new THREE.Matrix4();
  const q         = new THREE.Quaternion();
  const v         = new THREE.Vector3();
  const s         = new THREE.Vector3();
  const e         = new THREE.Euler();
  const right     = new THREE.Vector3();
  let idx = 0;
  const maxInst = im.count;

  // Inner: place 2 side-mirrored instances at a given track-index i.
  function placeAtIndex(i){
    const pt = pts[i];
    const tg = trackCurve.getTangentAt(i/N).normalize();
    right.set(-tg.z, 0, tg.x);
    for(let s2=0;s2<2&&idx<maxInst;s2++){
      const side = s2===0 ? +1 : -1;
      const off  = BARRIER_OFF + offMin + Math.random()*(offMax-offMin);
      const sc   = sMin + Math.random()*(sMax-sMin);
      v.set(pt.x + right.x*off*side, yFn(sc), pt.z + right.z*off*side);
      e.set(
        tilt ? (Math.random()-0.5)*tilt : 0,
        rotY ? Math.random()*Math.PI*2 : 0,
        tilt ? (Math.random()-0.5)*tilt : 0
      );
      q.setFromEuler(e);
      s.set(sc, sc, sc);
      m4.compose(v, q, s);
      im.setMatrixAt(idx++, m4);
    }
  }

  if(clusterAnchors){
    // Cluster mode — sample perSide times, each near a random anchor.
    for(let k=0;k<perSide&&idx<maxInst;k++){
      const anchor = clusterAnchors[Math.floor(Math.random()*clusterAnchors.length)];
      const tj = ((anchor + (Math.random()*2-1)*clusterRadius) % 1 + 1) % 1;
      const i = Math.min(N-1, Math.max(0, Math.floor(tj*N)));
      placeAtIndex(i);
    }
  } else {
    // Uniform stratified mode — original behavior (preserved for non-candy worlds).
    const step      = Math.max(1, Math.floor(N/perSide));
    const startIdx  = Math.floor(stagger * step);
    for(let i=startIdx;i<N&&idx<maxInst;i+=step){
      placeAtIndex(i);
    }
  }

  im.count = idx;
  im.instanceMatrix.needsUpdate = true;
  if(!im.userData)im.userData = {};
  im.userData._noLodCull = true;
  // Diagnostic only — registers this IM as a frustum-cull pop-in suspect.
  // No-op when ?popinDiag=1 is not set. The IM is NOT yet set to
  // frustumCulled=false; the diag will tell us how often it gets culled.
  if(typeof window._registerPopinSuspect==='function'){
    window._registerPopinSuspect(im, 'midRing/' + (opts._diagLabel || 'unknown'));
  }
  return idx;
}

if(typeof window!=='undefined') window._populateMidRing = _populateMidRing;
