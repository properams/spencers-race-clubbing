// js/core/popin-diag.js — instrumented per-frame check of "track-spanning"
// InstancedMeshes that are suspected to pop in/out due to Three.js' built-in
// per-mesh frustum culling. NOT a fix — only a diagnostic.
//
// Activation: append `?popinDiag=1` to the URL. The flag survives reloads
// via localStorage (`popinDiag` key, value '1'). Press Shift+Y to toggle.
//
// What it does, every frame while gameState==='RACE':
//   1. Snapshots the camera frustum (same math Three uses internally).
//   2. For every InstancedMesh that called window._registerPopinSuspect(im, label),
//      computes frustum.intersectsObject(im) AND distance from camera to the
//      transformed boundingSphere center.
//   3. Logs transitions: when an IM goes from "outside frustum" → "inside
//      frustum" (= a frustum-cull pop-in), or vice versa. Also logs the IM's
//      `.visible` field — if that toggles independently it indicates a
//      LOD-cull pop.
//
// Output goes to console.log with a [popin] prefix so it can be filtered.
// First 200 events are kept in window._popinLog for inspection.
//
// Dependencies: THREE, scene, camera, gameState (script globals).

'use strict';

(function(){
  // ── Activation gate ────────────────────────────────────────────────────
  let _enabled = false;
  try{
    const qs = new URLSearchParams(location.search);
    if(qs.has('popinDiag')){
      _enabled = qs.get('popinDiag') !== '0';
      try{ localStorage.setItem('popinDiag', _enabled ? '1' : '0'); }catch(_){}
    } else {
      try{ _enabled = localStorage.getItem('popinDiag') === '1'; }catch(_){}
    }
  }catch(_){}

  // Suspect registry: [{ im, label, lastInFrustum, lastVisible }]
  const _suspects = [];
  window._popinSuspects = _suspects;
  window._popinLog = [];

  // ── Public registration API ────────────────────────────────────────────
  // Worlds tag their track-spanning IMs at construction. The diag only
  // tracks IMs that registered — keeps the per-frame cost bounded.
  function registerSuspect(im, label){
    if(!_enabled) return;
    if(!im || typeof im !== 'object') return;
    _suspects.push({ im, label: String(label || 'unknown'), lastInFrustum: null, lastVisible: null });
  }
  window._registerPopinSuspect = registerSuspect;

  // Cleanup hook for world-switch — called from buildScene.
  function clear(){
    _suspects.length = 0;
  }
  window._clearPopinSuspects = clear;

  if(!_enabled){
    // Stub the per-frame fn so loop.js can call it cheaply.
    window._updatePopinDiag = function(){};
    return;
  }

  // ── Shift+Y toggle ─────────────────────────────────────────────────────
  window.addEventListener('keydown', e => {
    if(e.shiftKey && (e.key === 'Y' || e.key === 'y')){
      const next = localStorage.getItem('popinDiag') === '1' ? '0' : '1';
      try{ localStorage.setItem('popinDiag', next); }catch(_){}
      console.log('[popin] toggled to', next, '— reload to take effect.');
    }
  });

  // ── Per-frame check ────────────────────────────────────────────────────
  // Three's WebGLRenderer uses Frustum + Matrix4.multiplyMatrices(proj, view)
  // then frustum.setFromProjectionMatrix(viewProj). intersectsObject(o)
  // reads o.geometry.boundingSphere transformed by o.matrixWorld — exactly
  // the same check the renderer performs when o.frustumCulled !== false.
  const _projScreenMatrix = new THREE.Matrix4();
  const _frustum = new THREE.Frustum();
  const _scratchV = new THREE.Vector3();

  function logEvent(ev){
    console.log('[popin]', ev.t.toFixed(2) + 's', ev.label,
                'frustum:', ev.inFrustum ? 'IN' : 'OUT',
                'visible:', ev.visible,
                'distFromCam:', ev.dist.toFixed(0) + 'u',
                ev.note || '');
    if(window._popinLog.length < 200) window._popinLog.push(ev);
  }

  function update(){
    if(typeof gameState !== 'undefined' && gameState !== 'RACE' && gameState !== 'FINISH') return;
    if(typeof camera === 'undefined' || !camera) return;
    if(!_suspects.length) return;

    // Build the frustum from the current camera state.
    camera.updateMatrixWorld();
    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);

    const t = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;

    for(let i = 0; i < _suspects.length; i++){
      const s = _suspects[i];
      const im = s.im;
      if(!im || !im.geometry) continue;
      if(!im.geometry.boundingSphere) im.geometry.computeBoundingSphere();
      im.updateMatrixWorld();

      // intersectsObject uses geometry.boundingSphere center transformed by
      // matrixWorld + the boundingSphere radius. This is the exact same
      // check WebGLRenderer.projectObject does (when frustumCulled !== false).
      const inFrustum = _frustum.intersectsObject(im);
      const visible   = im.visible !== false;

      _scratchV.copy(im.geometry.boundingSphere.center);
      _scratchV.applyMatrix4(im.matrixWorld);
      const dx = _scratchV.x - camera.position.x;
      const dz = _scratchV.z - camera.position.z;
      const dist = Math.hypot(dx, dz);

      // Transition from OUT → IN frustum = a frustum-cull pop-in (visible
      // to the user as "object materialised out of nothing").
      if(s.lastInFrustum === false && inFrustum === true){
        logEvent({
          t, label: s.label, inFrustum, visible, dist,
          note: '<- FRUSTUM POP-IN (was culled, now in view)',
        });
      } else if(s.lastInFrustum === true && inFrustum === false){
        logEvent({
          t, label: s.label, inFrustum, visible, dist,
          note: '   frustum-cull out',
        });
      }

      // Transition on .visible — that's the lod-cull.js side toggling.
      if(s.lastVisible === false && visible === true){
        logEvent({
          t, label: s.label, inFrustum, visible, dist,
          note: '<- LOD POP-IN (.visible toggled true)',
        });
      } else if(s.lastVisible === true && visible === false){
        logEvent({
          t, label: s.label, inFrustum, visible, dist,
          note: '   lod-cull out',
        });
      }

      s.lastInFrustum = inFrustum;
      s.lastVisible   = visible;
    }
  }

  window._updatePopinDiag = update;

  // Banner so it's obvious the diag is on.
  console.log('%c[popin] diagnostic ACTIVE — Shift+Y toggles, reload to apply', 'color:#ff7;background:#222;padding:2px 6px;');
})();
