// js/effects/ssao-pass.js — Phase 9.1: screen-space ambient occlusion.
// Non-module script, geladen tussen atmosphere-pass.js en renderer.js.
//
// Depth-only SSAO: 8 samples in ring-pattern rond elke pixel, compare
// linear-depth. Voor elke sample dieper-dan-center: tel als occlusion.
// Output half-res naar rtAO, daarna gemixed in composite via tAO uniform.
//
// Mobile: skip volledig (cube-render is al duur op iOS, plus rtScene
// heeft daar geen depthTexture).
// Low-quality: skip via window._lowQuality flag.
//
// Dependencies (script-globals): THREE, renderer, _postfx.

'use strict';

var _ssao = {
  ready: false,
  rtAO: null,
  matAO: null,
  // Cached cam.near/far — read once at init, refreshed on resize.
  _near: 0.2,
  _far: 900
};

function initSSAO(){
  if(window._isMobile) return;
  // SSAO is the heaviest postFX pass — skip on mid + low tiers.
  if(window._qFlags && window._qFlags.ssao === false) return;
  if(!window.renderer || !window._postfx || !_postfx.ready) return;
  if(!_postfx.rtScene || !_postfx.rtScene.depthTexture){
    if(window.dbg) dbg.warn('ssao','rtScene heeft geen depthTexture — skip');
    return;
  }
  const halfW = Math.max(2, Math.floor(innerWidth/2));
  const halfH = Math.max(2, Math.floor(innerHeight/2));

  _ssao.rtAO = new THREE.WebGLRenderTarget(halfW, halfH, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false
  });

  _ssao.matAO = new THREE.ShaderMaterial({
    uniforms: {
      tDepth:     { value: _postfx.rtScene.depthTexture },
      cameraNear: { value: _ssao._near },
      cameraFar:  { value: _ssao._far },
      aoRadius:   { value: 6.0 },
      aoStrength: { value: 0.85 }
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){vUv=uv;gl_Position=vec4(position,1.0);}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tDepth;',
      'uniform float cameraNear;',
      'uniform float cameraFar;',
      'uniform float aoRadius;',
      'uniform float aoStrength;',
      'varying vec2 vUv;',
      // Linearize depth from [0,1] NDC to [near, far] eye-space.
      'float linearDepth(float z){',
      '  float zn = z * 2.0 - 1.0;',
      '  return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - zn * (cameraFar - cameraNear));',
      '}',
      'const int N = 8;',
      'void main(){',
      '  float dCenter = linearDepth(texture2D(tDepth, vUv).r);',
      // Sky / far clip: no AO (white = 1.0).
      '  if(dCenter > cameraFar * 0.95){ gl_FragColor = vec4(1.0); return; }',
      '  float ao = 0.0;',
      '  for(int i=0; i<N; i++){',
      '    float ang = float(i) * 0.78539816;',  // π/4 = 8 directions
      '    vec2 off = vec2(cos(ang), sin(ang)) * (aoRadius / 1000.0);',
      '    float dS = linearDepth(texture2D(tDepth, vUv + off).r);',
      '    float diff = max(0.0, dCenter - dS);',
      '    ao += smoothstep(0.0, 2.0, diff);',
      '  }',
      '  float occlusion = 1.0 - clamp(ao / float(N) * aoStrength, 0.0, 1.0);',
      '  gl_FragColor = vec4(occlusion, occlusion, occlusion, 1.0);',
      '}'
    ].join('\n'),
    depthWrite: false,
    depthTest: false
  });

  _ssao.ready = true;

  // Wire tAO uniform op atmosphere composite zodra die ready is.
  // Composite shader (atmosphere-pass.js) heeft een tAO+aoStrength
  // uniform die nu wordt aangevuld met onze rtAO texture.
  if(window._atmo && _atmo.matCompositeExt && _atmo.matCompositeExt.uniforms.tAO){
    _atmo.matCompositeExt.uniforms.tAO.value = _ssao.rtAO.texture;
  }
}

// Refresh cameraNear/Far on resize / camera change. Called once per
// frame from renderSSAO — cheap (1 if-check + 2 assignments).
function _syncCamera(){
  if(typeof camera === 'undefined' || !camera) return;
  if(_ssao.matAO){
    _ssao.matAO.uniforms.cameraNear.value = camera.near;
    _ssao.matAO.uniforms.cameraFar.value  = camera.far;
  }
}

function renderSSAO(){
  if(!_ssao.ready) return false;
  if(window._lowQuality) return false;
  // Runtime tier downgrade flips _qFlags.ssao=false without re-initing the
  // pass. Honour the flag at render time so high→mid downgrades stop SSAO
  // rendering immediately (was the heaviest single postFX pass).
  if(window._qFlags && window._qFlags.ssao === false) return false;
  _syncCamera();
  _postfx.quad.material = _ssao.matAO;
  window.renderer.setRenderTarget(_ssao.rtAO);
  window.renderer.render(_postfx.fsScene, _postfx.fsCam);
  return true;
}

function resizeSSAO(){
  if(!_ssao.ready) return;
  const halfW = Math.max(2, Math.floor(innerWidth/2));
  const halfH = Math.max(2, Math.floor(innerHeight/2));
  if(_ssao.rtAO.width !== halfW || _ssao.rtAO.height !== halfH){
    _ssao.rtAO.setSize(halfW, halfH);
    // depthTexture op rtScene wordt door postfx.resizePostFX bij elke
    // resize automatisch reset; we hoeven onze uniform-reference niet
    // bij te werken want het is dezelfde object-ref.
  }
}

if(typeof window !== 'undefined'){
  window._initSSAO = initSSAO;
  window._renderSSAO = renderSSAO;
  window._resizeSSAO = resizeSSAO;
  window._ssao = _ssao;
}
