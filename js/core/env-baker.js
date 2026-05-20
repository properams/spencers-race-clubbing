// js/core/env-baker.js — CubeCamera-based IBL bake.
// Non-module script, loaded between scene.js and loop.js so buildScene()
// can call into it after the world geometry is in place.
//
// Why this exists: scene.js's `_buildWorldEnvFromSky()` PMREMs the procedural
// sky canvas. That gives cars sun-spot reflections that match the world's
// atmosphere, but the actual 3D geometry (buildings, lava pools, neon walls,
// trees, lampposts) never appears in clearcoat reflections. CubeCamera fixes
// that — render the live scene from a representative position into 6 cube
// faces, PMREM-filter the result, hand it to scene.environment.
//
// Lifecycle:
//   - Called from buildScene() near the end, after the world is built and
//     toggleNight() applied (so emissives are at their final intensity).
//   - Skips on mobile (6× scene-render budget too tight on low-end devices).
//   - Replaces the sky-based env from `_buildWorldEnvFromSky`. On
//     toggleNight() the sky-based env returns (see night.js cache pattern),
//     so reflections gracefully fall back to sky-only on M-press.
//   - Re-runs on the next world load — env is per-world, not per-isDark.
//
// Dependencies (script-globals): THREE, renderer, scene, activeWorld, dbg.

'use strict';

// Shared cube render-target: 256×256 desktop (allocates ~1.5MB GPU as RGBA8).
// HalfFloatType could give us HDR-style highlights but pushes memory to 3MB
// and is overkill for procedural sky + Lambert/Standard scenes. The PMREM
// filter still picks up the LDR values correctly.
let _envCubeRT = null;
let _envCubeCam = null;
// Shared PMREMGenerator — previously allocated and disposed per bake. Each
// alloc/dispose forced a shader-link + GPU-sync (15-40ms hitch every 10s).
// Reused across re-bakes for the lifetime of the page. Reset to null on
// webglcontextlost so the next bake rebuilds against the new context.
let _sharedPMREM = null;
// Previous PMREM-output render target — _sharedPMREM.fromCubemap() returns
// a fresh WebGLRenderTarget each call. The .texture is assigned to
// scene.environment but the parent RT isn't tracked elsewhere. Without
// disposing the RT, each 30s re-bake leaks one ~6MB PMREM mip-pyramid.
// We hold the previous bake's RT here and dispose it when the new one
// replaces it.
let _prevPmremRT = null;
// Scratch Vector3 for the apply-bake position so we don't allocate per call.
const _envBakePos = new THREE.Vector3();

// Reset cached GPU resources when the WebGL context is lost so the next
// bake rebuilds against the new context.
if(typeof window !== 'undefined' && typeof window.addEventListener === 'function'){
  window.addEventListener('webglcontextlost', () => {
    _sharedPMREM = null;
    _envCubeRT = null;
    _envCubeCam = null;
    _prevPmremRT = null;
  }, { passive: true });
}

function _ensureCubeBaker(){
  if(_envCubeRT) return true;
  if(typeof THREE.WebGLCubeRenderTarget !== 'function' ||
     typeof THREE.CubeCamera !== 'function'){
    if(window.dbg) dbg.warn('env-baker', 'WebGLCubeRenderTarget / CubeCamera not available');
    return false;
  }
  // Cube-RT face size — tier-driven: high=256, mid=192, low/mobile=128.
  // The mobile path bakes once at world-build and never re-renders the cube;
  // the one-time hitch (~50ms cube + PMREM) is acceptable within the
  // existing world-switch budget. Per-frame cost is zero (env sampling is
  // just texture-fetch in the material shader).
  const size = (window._qFlags && window._qFlags.envCubeSize) || (window._isMobile ? 128 : 256);
  _envCubeRT = new THREE.WebGLCubeRenderTarget(size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter
  });
  // Near/far chosen so distant skybox + horizon silhouettes survive but
  // anything beyond the play area is clipped (matches main-camera far=900).
  _envCubeCam = new THREE.CubeCamera(0.5, 700, _envCubeRT);
  return true;
}

// Bake an envMap from the live scene at `position`. Returns a PMREM-filtered
// Texture suitable for scene.environment, or null on failure (caller keeps
// the existing sky-based env in that case).
//
// The cube-render is one-shot (no per-frame update), so dynamic objects
// (cars, particles) are NOT in the reflection — by design, since the call
// happens during buildScene() before cars exist.
function bakeSceneEnv(scn, position){
  if(!window.renderer || typeof THREE.PMREMGenerator !== 'function'){
    return null;
  }
  // Mobile path uses 128² cube faces — one-time bake at world-build, no
  // per-frame cost. The sky-based env from _buildWorldEnvFromSky stays
  // as the fallback if PMREM/CubeCamera fails. Earlier this returned
  // null on mobile to protect the world-switch hitch budget; rolled
  // back per user feedback (mobile users couldn't see Phase 1's main
  // visual win, scene-geometry reflections on car clearcoat).
  if(!_ensureCubeBaker()) return null;

  // Position the cube camera at the supplied world point (default: small
  // offset above the track origin so the floor isn't right at the cube's
  // bottom face).
  if(position){
    _envCubeCam.position.copy(position);
  } else {
    _envCubeCam.position.set(0, 18, 280);
  }

  // Disable shadow rendering for the 6-face cube render — sunLight.castShadow
  // would otherwise trigger 6× 1024×1024 shadow-map passes for tiny 256× cube
  // faces (8-30ms wasted). The PMREM env captures direct + sky lighting; the
  // missing self-shadows in the reflection are imperceptible.
  const r = window.renderer;
  const prevShadowsEnabled = r.shadowMap.enabled;
  r.shadowMap.enabled = false;
  try {
    _envCubeCam.update(r, scn);
  } catch (e) {
    if(window.dbg) dbg.error('env-baker', e, 'cube render failed');
    r.shadowMap.enabled = prevShadowsEnabled;
    return null;
  }
  r.shadowMap.enabled = prevShadowsEnabled;

  let envMap = null;
  try {
    if(!_sharedPMREM){
      _sharedPMREM = new THREE.PMREMGenerator(window.renderer);
      _sharedPMREM.compileCubemapShader();
    }
    // Dispose the prior PMREM render target before allocating a new one.
    // .texture from the previous call is still held by scene.environment
    // until applySceneEnvBake reassigns; we only release the RT here, not
    // the texture, so dispose order is RT.dispose() THEN scene.environment
    // reassign (handled by applySceneEnvBake).
    if(_prevPmremRT){
      try { _prevPmremRT.dispose(); } catch(_) {}
      _prevPmremRT = null;
    }
    const pmremRT = _sharedPMREM.fromCubemap(_envCubeRT.texture);
    _prevPmremRT = pmremRT;
    envMap = pmremRT.texture;
  } catch (e) {
    if(window.dbg) dbg.error('env-baker', e, 'PMREM fromCubemap failed');
    return null;
  }
  if(envMap && window.dbg){
    const w = (typeof activeWorld!=='undefined') ? activeWorld : '?';
    dbg.log('env-baker', 'scene env baked — '+w+' (CubeCamera@'+_envCubeCam.position.x.toFixed(0)+','+_envCubeCam.position.y.toFixed(0)+','+_envCubeCam.position.z.toFixed(0)+')');
  }
  return envMap;
}

// Public entry: bake-and-apply. Called from buildScene() after the world is
// fully built + toggleNight() has settled emissives. Replaces scene.environment
// only on success; failures (mobile, missing renderer, PMREM error) leave the
// sky-based env in place untouched.
//
// Cleanup: scene.environment is disposed by disposeScene() (core/scene.js)
// on the standard non-_shared-asset path. If applySceneEnvBake is called
// again on the same world (e.g. dev-panel manual rebake), we dispose the
// previous bake here — tagged via userData._cubeBaked so we never
// accidentally dispose a sky-based env still held by night.js's cache.
function applySceneEnvBake(){
  if(typeof scene === 'undefined' || !scene) return;
  if(typeof camera === 'undefined' || !camera) return;
  // Position cube camera at the race-start camera location so the bake
  // matches what the player sees on the grid. y bumped to 14 so the floor
  // doesn't dominate the bottom cube-face. Reused module-scratch — no per-bake alloc.
  _envBakePos.set(
    camera.position.x,
    Math.max(camera.position.y, 14),
    camera.position.z
  );
  const env = bakeSceneEnv(scene, _envBakePos);
  if(env){
    env.userData = env.userData || {};
    env.userData._cubeBaked = true;
    // Dispose the previous cube-baked env if there was one (manual rebake).
    // The sky-based env that was here at first run is still cached by
    // night.js (_<world>DayEnv / _<world>NightEnv), so we don't touch it.
    const prev = scene.environment;
    if(prev && prev.isTexture && prev.userData && prev.userData._cubeBaked){
      try { prev.dispose(); } catch(_) {}
    }
    scene.environment = env;
  }
}

// Expose for buildScene + manual dev-panel rebake.
window._applySceneEnvBake = applySceneEnvBake;
window._rebakeSceneEnv = applySceneEnvBake;

// Phase 8.8 — interval re-bake voor real-time reflectie probe.
// Triggert elke N seconden een nieuwe applySceneEnvBake tijdens RACE state
// om storm-flash, neon billboard pulse, etc. in car reflecties te vangen.
// Interval is tier-driven: high=30s, mid=60s, low=disabled. Was 10s — caused
// a periodic 15-40ms freeze every 10s on desktop because each bake renders
// the scene 6× (cube faces) + a now-cached PMREM filter pass.
let _rebakeTimer = 0;
function updateReflectionProbe(dt){
  // Always honour the legacy mobile guard for safety, even if tier-flag
  // module is missing for some reason.
  if(window._isMobile) return;
  const _qf = window._qFlags;
  if(_qf && _qf.reflectionProbe === false) return;
  const interval = (_qf && _qf.reflectionProbeInterval) || 30;
  if(typeof scene === 'undefined' || !scene) return;
  if(typeof gameState === 'undefined' || gameState !== 'RACE') return;
  _rebakeTimer += dt;
  if(_rebakeTimer >= interval){
    _rebakeTimer = 0;
    applySceneEnvBake();
  }
}
function resetReflectionProbeTimer(){
  _rebakeTimer = 0;
}
window._updateReflectionProbe = updateReflectionProbe;
window._resetReflectionProbeTimer = resetReflectionProbeTimer;
