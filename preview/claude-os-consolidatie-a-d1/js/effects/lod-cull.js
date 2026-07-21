// js/effects/lod-cull.js — Phase 8.7: distance-based mesh culling.
// Non-module script. Sweep elke LOD_INTERVAL frames over scene.traverse
// om meshes verder dan LOD_FAR units van de camera te verbergen via
// .visible=false. Cars, track, en world-identity props krijgen
// userData._noLodCull = true / _isCar = true voor opt-out.
//
// Dependencies (script-globals): THREE, scene, camera.

'use strict';

// LOD_FAR bumped 280→600. Old 280 caused track-related meshes built with
// ribbon() (kerbs, edge lines, space platform/walls) to be culled wrongly:
// those have mesh.position=(0,0,0) but vertex data spanning to ±380u
// (track-waypoint extent). For absolute-positioned meshes the bounding-
// sphere center in world space is the correct cull anchor; for parented
// props we still fall back to mesh.position (which IS the prop's location).
// Tier override: window._qFlags.lodCullDist (high=800, mid=500, low=280) lets
// weaker GPUs cull more aggressively at the cost of pop-in on near props.
// 2026-05-15 restored from 360/220/150 → Phase 11/12 far-band props (CBD
// silhouet cilinders r=540/740, skyline windows r=528, Canton Tower at
// z=-180 with h≈600m) were being culled wrongly with the tighter values.
// Falls back to 600 (legacy generous cull) if no tier flag is set. Note
// that per-mesh bounding-sphere radius is added to the threshold so ribbon
// track-strips with center=(0,0,0) and r≈380 still render correctly when
// the camera is within (lodCullDist + r) units of the origin.
const LOD_FAR_DEFAULT = 600;
function _currentLodFar(){
  if(window._qFlags && typeof window._qFlags.lodCullDist === 'number'){
    return window._qFlags.lodCullDist;
  }
  return LOD_FAR_DEFAULT;
}
const LOD_INTERVAL = 12;      // frames between sweeps (~5Hz)
let _lodFrameCount = 0;
let _lodScratchV = null;

function updateLodCull(){
  _lodFrameCount++;
  if(_lodFrameCount % LOD_INTERVAL !== 0) return;
  if(typeof scene === 'undefined' || !scene) return;
  if(typeof camera === 'undefined' || !camera) return;
  // Sessie 09 V1 — skip on non-race states. Title cam orbits at a fixed
  // radius so prop visibility doesn't change frame-to-frame. Countdown
  // cam runs the intro sweep but the player is stationary; we can let
  // the previous sweep's visibility persist. Saves a full scene.traverse
  // every 12 frames on the title screen.
  if(typeof gameState !== 'undefined' && gameState !== 'RACE' && gameState !== 'FINISH'){
    return;
  }
  if(!_lodScratchV) _lodScratchV = new THREE.Vector3();
  const cam = camera.position;
  const LOD_FAR = _currentLodFar();
  const far2 = LOD_FAR * LOD_FAR;
  scene.traverse(o => {
    // Skip non-meshes (lights, sprites, groups, etc.)
    if(!o.isMesh && !o.isInstancedMesh) return;
    // Opt-out flags
    if(o.userData){
      if(o.userData._noLodCull) return;
      if(o.userData._isCar) return;
      if(o.userData._isLivery) return;
      if(o.userData._cubeBaked) return;
      if(o.userData._shaderSky) return;
      if(o.userData._sharedAsset) return;  // shared scene-bg / env / etc
    }
    // Parent-check: cars zijn THREE.Group met _isCar; mesh-kinderen daarvan
    // moeten ook geskipt worden.
    if(o.parent && o.parent.userData && o.parent.userData._isCar) return;
    // Distance test — use geometry.boundingSphere.center transformed by
    // matrixWorld when available (correct anchor for ribbon-style meshes
    // with absolute vertex coords). Fallback: mesh.position via
    // getWorldPosition (correct for parented props placed via .position).
    let anchorX, anchorZ;
    if(o.geometry && o.geometry.boundingSphere){
      _lodScratchV.copy(o.geometry.boundingSphere.center);
      o.updateMatrixWorld();
      _lodScratchV.applyMatrix4(o.matrixWorld);
      anchorX = _lodScratchV.x;
      anchorZ = _lodScratchV.z;
    } else if(o.geometry){
      // Geen bounding-sphere → gebruik mesh world-position als fallback.
      // De eager-compute in scene.js:buildScene zet boundingSphere op alle
      // meshes; deze tak vangt alleen het zeldzame geval op waar een mesh
      // ná buildScene wordt toegevoegd (e.g. runtime particle systems).
      // Voorheen deed deze tak `computeBoundingSphere()` lazy in de 12-frame
      // sweep wat 10-100ms spikes gaf op prop-heavy worlds.
      o.getWorldPosition(_lodScratchV);
      anchorX = _lodScratchV.x;
      anchorZ = _lodScratchV.z;
    } else {
      o.getWorldPosition(_lodScratchV);
      anchorX = _lodScratchV.x;
      anchorZ = _lodScratchV.z;
    }
    // Extra safety: pad the threshold by the mesh's bounding-sphere radius
    // so a mesh that EXTENDS past LOD_FAR still renders if any part is
    // within range. Cheap (1 add per mesh) and ensures track-length meshes
    // with center on one end stay visible.
    const dx = anchorX - cam.x;
    const dz = anchorZ - cam.z;
    const d2 = dx*dx + dz*dz;
    const r  = (o.geometry && o.geometry.boundingSphere) ? o.geometry.boundingSphere.radius : 0;
    const threshold = LOD_FAR + r;
    o.visible = (d2 < threshold * threshold);
  });
}

// Re-compute LOD_FAR threshold immediately — useful after a runtime tier
// downgrade so the next visible-sweep uses the tighter cull distance.
// Internal sweep counter is left alone (still runs at LOD_INTERVAL Hz).

if(typeof window !== 'undefined') window._updateLodCull = updateLodCull;
