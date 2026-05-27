// js/effects/ssr-pass.js — Sessie 03: screen-space reflections.
// Non-module script, geladen tussen ssao-pass.js en renderer.js.
//
// Cheap SSR: 8-step view-space raymarch using the depthTexture op
// rtScene. Normals worden afgeleid van depth-gradients (Sobel) zodat
// we geen G-buffer hoeven aan te schrijven. Output: half-res RGBA met
// reflection color + confidence in .a. Composite shader leest dit
// via tSSR + ssrStrength uniforms (atmosphere-pass.js).
//
// Per-world strength via _WORLD_ATMOSPHERE_TUNE.ssrStr. Default 0.0
// (uit) op alle worlds behalve guangzhou/pier47 — droge
// werelden krijgen geen ssr-pass overhead (early-exit op strength=0).
//
// Quality tier:
//   high   — full pass, 8 raymarch steps
//   mid    — 4 raymarch steps + quarter-res (~30% cost)
//   low    — skip
//   mobile — skip
//
// Dependencies (script-globals): THREE, renderer, camera, _postfx.

'use strict';

var _ssr = {
  ready: false,
  rtSSR: null,
  matSSR: null,
  enabled: false,             // per-world toggle, gated on strength>0
  steps: 8                    // tier-driven (high=8, mid=4)
};

function initSSR(){
  if(window._isMobile) return;
  if(window._qFlags && window._qFlags.ssr === false) return;
  if(!window.renderer || !window._postfx || !_postfx.ready) return;
  if(!_postfx.rtScene || !_postfx.rtScene.depthTexture){
    if(window.dbg) dbg.warn('ssr','rtScene heeft geen depthTexture — skip');
    return;
  }
  // Tier-driven downscale. mid tier renders quarter-res (1/4 of
  // screen) with half the raymarch budget.
  const _qfMid = window._qFlags && window._qFlags.ssao === false;
  const downscale = _qfMid ? 4 : 2;
  _ssr.steps = _qfMid ? 4 : 8;
  const rw = Math.max(2, Math.floor(innerWidth  / downscale));
  const rh = Math.max(2, Math.floor(innerHeight / downscale));

  _ssr.rtSSR = new THREE.WebGLRenderTarget(rw, rh, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false
  });

  _ssr.matSSR = new THREE.ShaderMaterial({
    defines: { STEPS: _ssr.steps },
    uniforms: {
      tDepth:           { value: _postfx.rtScene.depthTexture },
      tScene:           { value: null }, // wired in renderSSR each frame
      cameraNear:       { value: 0.2 },
      cameraFar:        { value: 900.0 },
      projectionMatrix: { value: new THREE.Matrix4() },
      invProjMatrix:    { value: new THREE.Matrix4() },
      resolution:       { value: new THREE.Vector2(rw, rh) },
      maxDistance:      { value: 50.0 },
      // Temporal jitter — frame-counter parity feeds a 1-pixel offset
      // so each consecutive frame shifts the march start point. The
      // upstream linear-filtered SSR RT then auto-averages successive
      // samples giving a cheap anti-alias without TAA history.
      jitter:           { value: 0.0 },
      // Strength feeds the composite blend, not the raymarch itself.
      // Zero short-circuits the shader so dry worlds pay near-nothing.
      strength:         { value: 0.0 }
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){vUv=uv;gl_Position=vec4(position,1.0);}'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'uniform sampler2D tDepth;',
      'uniform sampler2D tScene;',
      'uniform float cameraNear;',
      'uniform float cameraFar;',
      'uniform mat4 projectionMatrix;',
      'uniform mat4 invProjMatrix;',
      'uniform vec2 resolution;',
      'uniform float maxDistance;',
      'uniform float strength;',
      'uniform float jitter;',
      'varying vec2 vUv;',
      // Convert non-linear z-buffer depth to view-space eye-z.
      'float linearizeEye(float zNdc){',
      '  float zn = zNdc * 2.0 - 1.0;',
      '  return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - zn * (cameraFar - cameraNear));',
      '}',
      // Reconstruct view-space position from depth + uv.
      'vec3 viewPos(vec2 uv){',
      '  float z = texture2D(tDepth, uv).r;',
      '  vec4 ndc = vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);',
      '  vec4 vp = invProjMatrix * ndc;',
      '  return vp.xyz / vp.w;',
      '}',
      'void main(){',
      // Early-exit: per-world strength=0 means dry world. Output
      // (0,0,0,0) so the composite adds nothing.
      '  if(strength <= 0.001){ gl_FragColor = vec4(0.0); return; }',
      '  float zCenter = texture2D(tDepth, vUv).r;',
      // Sky / far-clip: no reflection.
      '  if(zCenter > 0.999){ gl_FragColor = vec4(0.0); return; }',
      '  vec3 pCenter = viewPos(vUv);',
      // Reconstruct view-space normal via depth-derivative cross product.
      // Cheap, works well for flat-ish surfaces (asphalt, water).
      '  vec3 dx = dFdx(pCenter);',
      '  vec3 dy = dFdy(pCenter);',
      '  vec3 N = normalize(cross(dx, dy));',
      // SSR is meaningful for surfaces whose normal points up
      // (positive Y in view-space, since camera looks down -Z and
      // ground is below). Reject vertical surfaces.
      '  if(N.y < 0.35){ gl_FragColor = vec4(0.0); return; }',
      '  vec3 V = normalize(pCenter);',
      '  vec3 R = reflect(V, N);',
      // March in view-space.
      '  float stepLen = maxDistance / float(STEPS);',
      // Temporal jitter shifts the start by a fraction of stepLen so
      // successive frames hit slightly different geometry depths.
      '  vec3 marchPos = pCenter + R * stepLen * jitter * 0.5;',
      '  vec4 hit = vec4(0.0);',
      '  for(int i=0; i<STEPS; i++){',
      '    marchPos += R * stepLen;',
      // Project back to screen space.
      '    vec4 cs = projectionMatrix * vec4(marchPos, 1.0);',
      '    if(cs.w < 0.0) break;',
      '    vec2 sampleUv = (cs.xy / cs.w) * 0.5 + 0.5;',
      '    if(sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) break;',
      // Depth at sampled pixel.
      '    float zHit = texture2D(tDepth, sampleUv).r;',
      '    vec3 pHit = viewPos(sampleUv);',
      // Did the ray pass behind geometry?
      '    float depthDiff = marchPos.z - pHit.z;',
      // Negative depthDiff means marchPos is in front of geometry.
      // Hit when small positive crossing.
      '    if(depthDiff > 0.0 && depthDiff < stepLen * 1.5){',
      // Edge attenuation — fade near screen borders.
      '      vec2 eg = abs(sampleUv - 0.5) * 2.0;',
      '      float edge = 1.0 - smoothstep(0.7, 1.0, max(eg.x, eg.y));',
      // Distance attenuation — fade with march distance.
      '      float distFade = 1.0 - float(i)/float(STEPS);',
      '      vec3 col = texture2D(tScene, sampleUv).rgb;',
      '      hit = vec4(col, edge * distFade);',
      '      break;',
      '    }',
      '  }',
      '  gl_FragColor = hit;',
      '}'
    ].join('\n'),
    depthWrite: false,
    depthTest: false,
    extensions: { derivatives: true }
  });

  _ssr.ready = true;

  // Wire tSSR uniform op atmosphere composite shader (added in the
  // V2 atmosphere-pass.js edit).
  if(window._atmo && _atmo.matCompositeExt && _atmo.matCompositeExt.uniforms.tSSR){
    _atmo.matCompositeExt.uniforms.tSSR.value = _ssr.rtSSR.texture;
  }
  if(window.dbg) dbg.log('ssr','init OK steps='+_ssr.steps+' rt='+_ssr.rtSSR.width+'×'+_ssr.rtSSR.height);
}

// Per-world strength setter. Called from atmosphere-pass.js
// setAtmosphereWorld() after applying _WORLD_ATMOSPHERE_TUNE.
function setSSRStrength(s){
  if(!_ssr.ready) return;
  _ssr.matSSR.uniforms.strength.value = s;
  _ssr.enabled = (s > 0.001);
  if(window._atmo && _atmo.matCompositeExt && _atmo.matCompositeExt.uniforms.ssrStrength){
    _atmo.matCompositeExt.uniforms.ssrStrength.value = s;
  }
}

function _syncSSRMatrices(){
  if(typeof camera === 'undefined' || !camera) return;
  _ssr.matSSR.uniforms.cameraNear.value = camera.near;
  _ssr.matSSR.uniforms.cameraFar.value  = camera.far;
  _ssr.matSSR.uniforms.projectionMatrix.value.copy(camera.projectionMatrix);
  _ssr.matSSR.uniforms.invProjMatrix.value.copy(camera.projectionMatrixInverse);
  // Temporal jitter — alternate per-frame so linear-filter averaging in
  // the next composite pass effectively halves spatial noise.
  const _fc = (typeof _aiFrameCounter !== 'undefined') ? _aiFrameCounter : 0;
  _ssr.matSSR.uniforms.jitter.value = (_fc & 1) ? 1.0 : -1.0;
}

function renderSSR(){
  if(!_ssr.ready) return false;
  if(!_ssr.enabled) return false;
  if(window._lowQuality) return false;
  if(window._qFlags && window._qFlags.ssr === false) return false;
  _syncSSRMatrices();
  // Feed the scene render-target as the color source for sampled hits.
  _ssr.matSSR.uniforms.tScene.value = _postfx.rtScene.texture;
  _postfx.quad.material = _ssr.matSSR;
  window.renderer.setRenderTarget(_ssr.rtSSR);
  window.renderer.render(_postfx.fsScene, _postfx.fsCam);
  return true;
}

function resizeSSR(){
  if(!_ssr.ready) return;
  const _qfMid = window._qFlags && window._qFlags.ssao === false;
  const downscale = _qfMid ? 4 : 2;
  const rw = Math.max(2, Math.floor(innerWidth  / downscale));
  const rh = Math.max(2, Math.floor(innerHeight / downscale));
  if(_ssr.rtSSR.width !== rw || _ssr.rtSSR.height !== rh){
    _ssr.rtSSR.setSize(rw, rh);
    _ssr.matSSR.uniforms.resolution.value.set(rw, rh);
  }
}

if(typeof window !== 'undefined'){
  window._initSSR = initSSR;
  window._renderSSR = renderSSR;
  window._resizeSSR = resizeSSR;
  window._setSSRStrength = setSSRStrength;
  window._ssr = _ssr;
}
