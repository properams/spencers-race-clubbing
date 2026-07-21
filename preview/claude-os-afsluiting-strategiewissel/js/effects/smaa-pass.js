// js/effects/smaa-pass.js — "lite" 2-pass SMAA-achtige anti-aliasing.
//
// Geen externe LUT-textures (single-file filosofie). Twee passes:
//   1. Edge-detect (luma): scene → rtSMAAEdge. 3 samples (centrum +
//      links + boven). Output = 2-channel edge-mask in R/G.
//   2. Neighborhood-blend: scene + rtSMAAEdge → canvas. Op detected
//      edge-pixels wordt een 5-tap cross-blur toegepast; elders blijft
//      het pixel onveranderd. Goedkoper dan papier-SMAA's weight-pass
//      maar compromis op pixel-perfecte hoeken.
//
// Tier-flag _qFlags.smaa: 'full' | 'half' | false. 'half' rendert
// rtFinal + SMAA-RTs op halve resolutie en upscalet bilinear naar canvas.
//
// Dependencies (script-globals): renderer, THREE, _postfx (voor fsScene,
// fsCam, quad).

'use strict';

var _smaa = {
  enabled: false,
  ready: false,
  mode: false,        // 'full' | 'half' | false
  rtFinal: null,      // composite-output (input voor SMAA)
  rtEdge: null,       // edge-mask
  matEdge: null,      // edge-detect ShaderMaterial
  matBlend: null,     // neighborhood-blend ShaderMaterial
  w: 0, h: 0          // cached dimensions
};

// PBR-fix: lees DYNAMISCH uit _qFlags.smaa zodat graceful-downgrade niveau-1
// (die _qFlags.smaa van 'full' naar 'half' flipped) ook daadwerkelijk de
// render-target-resolutie halveert. Voorheen leek _smaa.mode op de init-
// waarde gecached, waardoor de flag-flip een no-op was.
function _smaaResolutionMul(){
  const cur = (window._qFlags && window._qFlags.smaa) || _smaa.mode;
  return cur === 'half' ? 0.5 : 1.0;
}

function initSMAA(){
  if(typeof renderer === 'undefined' || !renderer) return;
  const mode = (window._qFlags && window._qFlags.smaa) || false;
  _smaa.mode = mode;
  if(!mode){ _smaa.enabled = false; _smaa.ready = false; return; }
  // Mobile-guard: postFX zelf staat al uit op LOW, dus _qFlags.smaa zou daar
  // sowieso false moeten zijn. Defensieve dubbel-check.
  if(window._qFlags && window._qFlags.postFX === false){
    _smaa.enabled = false; _smaa.ready = false; return;
  }
  const mul = _smaaResolutionMul();
  const w = Math.max(2, Math.floor(innerWidth * mul));
  const h = Math.max(2, Math.floor(innerHeight * mul));
  _smaa.w = w; _smaa.h = h;

  // PBR-fix: r160 verwijderde THREE.sRGBEncoding. encoding: undefined zou
  // three.js de default-LinearSRGB laten kiezen wat een latente
  // dubbel-gamma-correctie kan veroorzaken zodra ColorManagement aan gaat.
  // ThreeCompat zet de juiste colorSpace op de RT-texture.
  const rtParams = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false
  };
  _smaa.rtFinal = new THREE.WebGLRenderTarget(w, h, rtParams);
  _smaa.rtEdge  = new THREE.WebGLRenderTarget(w, h, rtParams);
  if(typeof ThreeCompat !== 'undefined' && ThreeCompat.applyTextureColorSpace){
    ThreeCompat.applyTextureColorSpace(_smaa.rtFinal.texture);
    ThreeCompat.applyTextureColorSpace(_smaa.rtEdge.texture);
  }

  // Pass 1: edge-detect (luma). 3 samples (centrum, links-buur, boven-buur).
  // Threshold 0.05 luma-delta = standard SMAA-lite; lager = meer edges.
  _smaa.matEdge = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      texelSize: { value: new THREE.Vector2(1/w, 1/h) }
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){vUv=uv;gl_Position=vec4(position,1.0);}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tDiffuse;',
      'uniform vec2 texelSize;',
      'varying vec2 vUv;',
      'void main(){',
      '  vec3 c = texture2D(tDiffuse, vUv).rgb;',
      '  vec3 l = texture2D(tDiffuse, vUv - vec2(texelSize.x, 0.0)).rgb;',
      '  vec3 t = texture2D(tDiffuse, vUv - vec2(0.0, texelSize.y)).rgb;',
      '  vec3 lw = vec3(0.299, 0.587, 0.114);',
      '  float lc = dot(c, lw);',
      '  float ll = dot(l, lw);',
      '  float lt = dot(t, lw);',
      '  float dl = abs(lc - ll);',
      '  float dt = abs(lc - lt);',
      '  float edgeL = step(0.05, dl);',
      '  float edgeT = step(0.05, dt);',
      '  gl_FragColor = vec4(edgeL, edgeT, 0.0, 1.0);',
      '}'
    ].join('\n'),
    depthWrite: false,
    depthTest: false
  });

  // Pass 2: neighborhood-blend. Op edge-pixels wordt een cross-tap-blur
  // (centrum + 4 buren) toegepast om de zaagrand te middelen; elders
  // unchanged. Output gaat naar canvas (renderer.setRenderTarget(null)).
  _smaa.matBlend = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tEdges:   { value: null },
      texelSize:{ value: new THREE.Vector2(1/w, 1/h) }
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){vUv=uv;gl_Position=vec4(position,1.0);}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tDiffuse;',
      'uniform sampler2D tEdges;',
      'uniform vec2 texelSize;',
      'varying vec2 vUv;',
      'void main(){',
      '  vec2 e = texture2D(tEdges, vUv).rg;',
      '  // Ook buur-edges meenemen zodat aliasing-randen van beide kanten',
      '  // worden gladgestreken (SMAA papier doet dit via search; wij',
      '  // benaderen het door 4 buur-edge-samples te OR-en).',
      '  float en = texture2D(tEdges, vUv + vec2(texelSize.x, 0.0)).r;',
      '  float es = texture2D(tEdges, vUv + vec2(0.0, texelSize.y)).g;',
      '  float edge = max(max(e.r, e.g), max(en, es));',
      '  vec3 c = texture2D(tDiffuse, vUv).rgb;',
      '  if(edge > 0.5){',
      '    vec3 l = texture2D(tDiffuse, vUv - vec2(texelSize.x, 0.0)).rgb;',
      '    vec3 r = texture2D(tDiffuse, vUv + vec2(texelSize.x, 0.0)).rgb;',
      '    vec3 t = texture2D(tDiffuse, vUv - vec2(0.0, texelSize.y)).rgb;',
      '    vec3 b = texture2D(tDiffuse, vUv + vec2(0.0, texelSize.y)).rgb;',
      '    c = (c + l + r + t + b) * 0.2;',
      '  }',
      '  gl_FragColor = vec4(c, 1.0);',
      '}'
    ].join('\n'),
    depthWrite: false,
    depthTest: false
  });

  _smaa.enabled = true;
  _smaa.ready  = true;
}
window._initSMAA = initSMAA;

function resizeSMAA(){
  if(!_smaa.ready) return;
  const mul = _smaaResolutionMul();
  const w = Math.max(2, Math.floor(innerWidth * mul));
  const h = Math.max(2, Math.floor(innerHeight * mul));
  if(w === _smaa.w && h === _smaa.h) return;
  _smaa.w = w; _smaa.h = h;
  _smaa.rtFinal.setSize(w, h);
  _smaa.rtEdge.setSize(w, h);
  _smaa.matEdge.uniforms.texelSize.value.set(1/w, 1/h);
  _smaa.matBlend.uniforms.texelSize.value.set(1/w, 1/h);
}
window._resizeSMAA = resizeSMAA;

// Runtime-active check: respecteert tier-downgrades die _qFlags.smaa op
// false zetten ná init (loop.js auto-quality-detector).
function _smaaActive(){
  if(!_smaa.enabled || !_smaa.ready) return false;
  if(window._qFlags && window._qFlags.smaa === false) return false;
  return true;
}

// Roept aan vanuit renderWithPostFX in postfx.js. `rtFinalSource` is de
// composite-output (postfx schrijft daar naartoe wanneer _smaa.enabled).
// Edge-detect → neighborhood-blend → canvas.
function renderSMAAPass(){
  if(!_smaaActive()) return;
  resizeSMAA();

  // Edge-detect: rtFinal → rtEdge
  _postfx.quad.material = _smaa.matEdge;
  _smaa.matEdge.uniforms.tDiffuse.value = _smaa.rtFinal.texture;
  renderer.setRenderTarget(_smaa.rtEdge);
  renderer.render(_postfx.fsScene, _postfx.fsCam);

  // Neighborhood-blend: rtFinal + rtEdge → canvas
  _postfx.quad.material = _smaa.matBlend;
  _smaa.matBlend.uniforms.tDiffuse.value = _smaa.rtFinal.texture;
  _smaa.matBlend.uniforms.tEdges.value   = _smaa.rtEdge.texture;
  renderer.setRenderTarget(null);
  renderer.render(_postfx.fsScene, _postfx.fsCam);
}
window._renderSMAAPass = renderSMAAPass;

// Expose target voor postfx om naartoe te schrijven (in plaats van canvas).
window._smaaCompositeTarget = function(){
  return _smaaActive() ? _smaa.rtFinal : null;
};
