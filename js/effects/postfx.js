// js/effects/postfx.js — slim hand-rolled bloom post-processing.
// Non-module script, geladen tussen renderer.js en scene.js.
//
// Pipeline (4 passes per frame):
//   1. scene → rtScene  (regular render, tone-mapped + sRGB)
//   2. rtScene → rtBright  (luminance threshold extract, half-res)
//   3. rtBright → rtBlurH → rtBlurV  (separable 9-tap gaussian, half-res)
//   4. rtScene + rtBlurV → canvas  (additive composite)
//
// Auto-disabled on mobile and after _lowQuality kicks in. Mirror-pass and
// car-preview renders blijven directe renderer.render() calls (geen bloom).
//
// Dependencies (script-globals): renderer, THREE.

'use strict';

var _postfx = {
  enabled: false,
  ready: false,
  rtScene: null,
  rtBright: null,
  rtBlurH: null,
  rtBlurV: null,
  matExtract: null,
  matBlur: null,
  matComposite: null,
  quad: null,
  fsScene: null,
  fsCam: null,
  threshold: 0.72,
  strength: 0.78,
  // Cached size to detect resize without redundant setSize calls
  w: 0,
  h: 0
};

function initPostFX(){
  if(!renderer) return;
  // Skip on mobile — extra render passes hurt FPS too much.
  if(window._isMobile){_postfx.enabled=false;return;}
  // Tier flag also disables postFX on low tier (matches mobile fallback).
  if(window._qFlags && window._qFlags.postFX === false){
    _postfx.enabled = false;
    _postfx.ready = false;
    return;
  }
  // Skip ook als gebruiker postfx persistent heeft uitgeschakeld via pause-
  // overlay toggle (localStorage src_fx='0'). Voorheen werden 4 render-
  // targets + 3 ShaderMaterials alsnog opgebouwd om vervolgens nooit
  // gebruikt te worden — pure GPU- + heap-waste op desktop. _ready blijft
  // false dus toggleQuality() krijgt een N/A-pad bij eventuele user-toggle
  // tijdens deze sessie (vereist reload om alsnog op te bouwen).
  try {
    if (localStorage.getItem('src_fx') === '0') {
      _postfx.enabled = false;
      _postfx.ready = false;
      return;
    }
  } catch (_) { /* private mode — gewoon doorgaan */ }

  // Bloom RT scale from tier (high=0.5, mid=0.25 → quarter-res bright/blur RTs).
  // rtScene stays full-res because that's where the depth buffer lives and
  // where SSAO samples from. Only the bright/blur chain scales.
  const _qfBloomScale = (window._qFlags && window._qFlags.bloomScale) || 0.5;
  const w = innerWidth, h = innerHeight;
  const halfW = Math.max(2, Math.floor(w * _qfBloomScale));
  const halfH = Math.max(2, Math.floor(h * _qfBloomScale));

  // r134: encoding on RT controls how the renderer writes into it. We use
  // sRGBEncoding so the first pass output (after ACES tone mapping) lands in
  // the same color space the canvas would receive. Subsequent shaders sample
  // and write linearly — bloom is forgiving about this approximation.
  const rtParams = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    encoding: THREE.sRGBEncoding,
    depthBuffer: true,
    stencilBuffer: false
  };
  const rtParamsHalf = Object.assign({}, rtParams, {depthBuffer:false});

  _postfx.rtScene = new THREE.WebGLRenderTarget(w, h, rtParams);
  // Phase 9.1 — attach DepthTexture aan rtScene zodat ssao-pass.js
  // de scene-depth kan sampelen voor screen-space ambient occlusion.
  // Float depth biedt betere precision dan UnsignedShort op iOS Safari.
  // Only allocate when SSAO will actually run — _qFlags.ssao is false on
  // mid + low tiers + mobile (which all skip SSAO). Saves a full-res
  // DepthTexture allocation when nothing reads from it.
  // depthTexture is needed by SSAO (high tier only) AND SSR (Sessie 03,
  // high + mid). Allocate if either will run so SSR doesn't silently
  // skip on mid-tier hardware.
  const _ssaoWillRun = window._qFlags ? (window._qFlags.ssao !== false) : !window._isMobile;
  const _ssrWillRun  = window._qFlags ? (window._qFlags.ssr  !== false) : !window._isMobile;
  if(_ssaoWillRun || _ssrWillRun){
    try {
      _postfx.rtScene.depthTexture = new THREE.DepthTexture(w, h);
      _postfx.rtScene.depthTexture.format = THREE.DepthFormat;
      _postfx.rtScene.depthTexture.type = THREE.UnsignedShortType;
    } catch(e){
      if(window.dbg) dbg.warn('postfx','DepthTexture init failed — SSAO disabled: '+(e&&e.message||e));
    }
  }
  _postfx.rtBright = new THREE.WebGLRenderTarget(halfW, halfH, rtParamsHalf);
  _postfx.rtBlurH = new THREE.WebGLRenderTarget(halfW, halfH, rtParamsHalf);
  _postfx.rtBlurV = new THREE.WebGLRenderTarget(halfW, halfH, rtParamsHalf);

  // Bright-pass extraction: keep only pixels above luminance threshold
  _postfx.matExtract = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: {value: null},
      threshold: {value: _postfx.threshold}
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){vUv=uv;gl_Position=vec4(position,1.0);}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tDiffuse;',
      'uniform float threshold;',
      'varying vec2 vUv;',
      'void main(){',
      '  vec4 c=texture2D(tDiffuse,vUv);',
      '  float lum=dot(c.rgb,vec3(0.299,0.587,0.114));',
      '  float keep=smoothstep(threshold,threshold+0.18,lum);',
      '  gl_FragColor=vec4(c.rgb*keep,1.0);',
      '}'
    ].join('\n'),
    depthWrite: false,
    depthTest: false
  });

  // Separable 9-tap gaussian (direction: (1,0) horizontal, (0,1) vertical)
  _postfx.matBlur = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: {value: null},
      texelSize: {value: new THREE.Vector2(1/halfW, 1/halfH)},
      direction: {value: new THREE.Vector2(1, 0)}
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){vUv=uv;gl_Position=vec4(position,1.0);}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tDiffuse;',
      'uniform vec2 texelSize;',
      'uniform vec2 direction;',
      'varying vec2 vUv;',
      'void main(){',
      '  vec2 d=texelSize*direction;',
      '  vec3 col=vec3(0.0);',
      '  col+=texture2D(tDiffuse,vUv-d*4.0).rgb*0.0540;',
      '  col+=texture2D(tDiffuse,vUv-d*3.0).rgb*0.0966;',
      '  col+=texture2D(tDiffuse,vUv-d*2.0).rgb*0.1502;',
      '  col+=texture2D(tDiffuse,vUv-d*1.0).rgb*0.1966;',
      '  col+=texture2D(tDiffuse,vUv         ).rgb*0.2057;',
      '  col+=texture2D(tDiffuse,vUv+d*1.0).rgb*0.1966;',
      '  col+=texture2D(tDiffuse,vUv+d*2.0).rgb*0.1502;',
      '  col+=texture2D(tDiffuse,vUv+d*3.0).rgb*0.0966;',
      '  col+=texture2D(tDiffuse,vUv+d*4.0).rgb*0.0540;',
      '  gl_FragColor=vec4(col,1.0);',
      '}'
    ].join('\n'),
    depthWrite: false,
    depthTest: false
  });

  // Composite: scene + bloom * strength + per-world color grading + vignette.
  // Lift (3D black-level push) + saturation (luma-mix) toegevoegd voor
  // cinematic per-world tuning. Defaults (lift=0, saturation=1) zijn
  // neutraal — werelden zonder explicit override behouden identieke look.
  _postfx.matComposite = new THREE.ShaderMaterial({
    uniforms: {
      tScene: {value: null},
      tBloom: {value: null},
      strength: {value: _postfx.strength},
      tint: {value: new THREE.Vector3(1,1,1)},
      gradeAmount: {value: 0.0},
      vignette: {value: 0.55},
      lift: {value: new THREE.Vector3(0,0,0)},
      saturation: {value: 1.0}
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){vUv=uv;gl_Position=vec4(position,1.0);}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tScene;',
      'uniform sampler2D tBloom;',
      'uniform float strength;',
      'uniform vec3 tint;',
      'uniform float gradeAmount;',
      'uniform float vignette;',
      'uniform vec3 lift;',
      'uniform float saturation;',
      'varying vec2 vUv;',
      'void main(){',
      '  vec3 sc=texture2D(tScene,vUv).rgb;',
      '  vec3 bl=texture2D(tBloom,vUv).rgb;',
      '  vec3 col=sc+bl*strength;',
      '  // Lift: koele/warme push in de shadows (zone waar (1-col) groot is).',
      '  col=col+lift*(1.0-col);',
      '  // Saturation: luma-mix (Rec.601). 1.0=neutraal, <1 desat, >1 boost.',
      '  float luma=dot(col,vec3(0.299,0.587,0.114));',
      '  col=mix(vec3(luma),col,saturation);',
      '  // Color grade: subtle tint pull',
      '  vec3 graded=col*tint;',
      '  col=mix(col,graded,gradeAmount);',
      '  // Vignette: radial darkening',
      '  vec2 d=vUv-0.5;',
      '  float r=dot(d,d);', // squared radius (0..0.5)
      '  float vig=1.0-vignette*smoothstep(0.18,0.85,r*4.0);',
      '  col*=vig;',
      '  gl_FragColor=vec4(col,1.0);',
      '}'
    ].join('\n'),
    depthWrite: false,
    depthTest: false
  });

  // Fullscreen quad — clip-space triangles, no projection needed
  const geo = new THREE.PlaneGeometry(2, 2);
  _postfx.quad = new THREE.Mesh(geo, _postfx.matExtract);
  _postfx.fsScene = new THREE.Scene();
  _postfx.fsScene.add(_postfx.quad);
  _postfx.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  _postfx.w = w; _postfx.h = h;
  _postfx.enabled = true;
  _postfx.ready = true;
  _applyFxPreference();
}

// Day/night bloom tuning — at night we use a slightly lower threshold so
// neon/emissive props bloom more dramatically; by day we keep bloom subtle
// so highlights don't blow out the sky. Per-world multipliers below let
// pastel/dense-emissive worlds (Candy, Themepark) get less bleed without
// dimming the intentional neon aesthetic.
//
// Game-breed tone-down: previously dark strength was 0.78 / day 0.66 with
// thresholds 0.74 / 0.80. That bloomed mid-tones across most worlds and,
// combined with additive speed-trail particles, drew car-shaped ghost
// echoes behind every car at speed. The new values keep emissive props
// bright but stop mid-tones (asphalt, sand, candy, snow) bleeding.
let _bloomWorldStrengthMul = 1.0;
const _BLOOM_WORLD_MUL = {
  candy:    0.45,   // 44 lollipops + 22 candles + 48 lampposts = bloom flood
  arctic:   0.70,   // bright snow ground reflects bloom
  volcano:  1.00,   // lava emissives are the show
  space:    1.00,   // deliberate cosmic bloom
  deepsea:  0.85,   // bioluminescence subtle
  sandstorm:0.55,   // bright sun + sand reflectie — temper bloom flood
  pier47:   1.05,   // CINEMATIC — bloom-burst on lamps/koplampen against dark scene
  guangzhou:           1.10   // CINEMATIC — neon magenta/cyan emissives at max pop against near-black wet asphalt
};
// Per-world threshold override: defaults are dark=0.82 / day=0.86. Bumping
// the threshold raises the brightness above which a pixel blooms, so most
// scene mid-tones stay sharp. Cinematic worlds keep a slightly lower
// threshold so their intended bright neon still pops.
const _BLOOM_WORLD_THRESHOLD_DARK = {
  volcano:  0.78,
  pier47:   0.78,
  guangzhou: 0.78
};
// Tracked alongside _bloomWorldStrengthMul: avoids a global `activeWorld`
// read inside setBloomDayNight() so a future caller can't desync the
// strength multiplier from the threshold lookup.
let _bloomWorldKey = '';
function setBloomDayNight(dark){
  if(!_postfx.ready) return;
  if(dark){
    _postfx.threshold = _BLOOM_WORLD_THRESHOLD_DARK[_bloomWorldKey] || 0.82;
    _postfx.strength = 0.62 * _bloomWorldStrengthMul;
  } else {
    _postfx.threshold = 0.86;
    _postfx.strength = 0.54 * _bloomWorldStrengthMul;
  }
  _postfx.matExtract.uniforms.threshold.value = _postfx.threshold;
  _postfx.matComposite.uniforms.strength.value = _postfx.strength;
}
function setBloomWorld(world){
  _bloomWorldKey = world || '';
  _bloomWorldStrengthMul = _BLOOM_WORLD_MUL[world] || 1.0;
  // Re-apply current day/night to pick up the new multiplier.
  if(_postfx.ready) setBloomDayNight(typeof isDark!=='undefined' && isDark);
}

// Per-world ACES exposure tuning. Globale 1.1 was te conservatief —
// arctic (sneeuw-blowout) wil iets lager, volcano (cinematic glow) wil
// hoger. Werkt direct op renderer.toneMappingExposure dus ook actief
// wanneer postfx uit staat (mobile, user-toggle). Default 1.1 voor onbekende
// world keys behoudt vorig globaal gedrag.
const _WORLD_EXPOSURE = {
  space:     1.10,
  deepsea:   0.95,
  candy:     1.00,
  volcano:   1.15,
  arctic:    0.95,
  sandstorm: 1.10,
  pier47:    1.12,
  guangzhou: 1.08,
  gp:        1.10
};
function setWorldExposure(world){
  if(typeof renderer==='undefined' || !renderer) return;
  renderer.toneMappingExposure = _WORLD_EXPOSURE[world] || 1.10;
}

// User-toggleable quality: when localStorage('src_fx')==='0', skip alle
// postfx passes en val terug op directe renderer.render(). Persistent
// over reloads. Aangeroepen vanuit pauseOverlay button.
function toggleQuality(){
  if(!_postfx.ready){
    // Mobile heeft postfx nooit ge-init — toggle is dan no-op maar update label
    const b=document.getElementById('btnFxToggle');
    if(b){b.textContent='✨ FX N/A';b.classList.remove('active');}
    return;
  }
  _postfx.enabled = !_postfx.enabled;
  try{localStorage.setItem('src_fx', _postfx.enabled?'1':'0');}catch(e){}
  const b=document.getElementById('btnFxToggle');
  if(b){
    b.textContent=_postfx.enabled?'✨ FX ON':'✨ FX OFF';
    b.classList.toggle('active',_postfx.enabled);
  }
}
// Apply persisted preference at startup. Called vanuit initPostFX zodra
// _postfx.ready is.
function _applyFxPreference(){
  try{
    const v=localStorage.getItem('src_fx');
    if(v==='0')_postfx.enabled=false;
  }catch(e){}
  const b=document.getElementById('btnFxToggle');
  if(b){
    b.textContent=_postfx.enabled?'✨ FX ON':'✨ FX OFF';
    b.classList.toggle('active',_postfx.enabled);
  }
}

// Per-world color grading + vignette. Tints zijn subtle (gradeAmount 0.10-
// 0.18) zodat de wereldkleuren blijven "kloppen" maar er een herkenbare
// cinematic-feel ontstaat. Vignette uniform tussen 0.45-0.65 per wereld.
function setWorldGrading(world){
  if(!_postfx.ready) return;
  // [tint_r, tint_g, tint_b, gradeAmount, vignette, liftR, liftG, liftB, saturation, hueShift]
  // hueShift in radianen (~±0.15 max om kleuren niet te verschuiven naar
  // foute herkenningsbereik). Indexen 5-9. Werelden zonder expliciete
  // waarden krijgen lift=0, saturation=1, hueShift=0 — backward compatible.
  // Phase 5 — per-wereld grading dramatischer maken: meer lift in shadow-
  // zones, sterkere saturation push, subtle hueShift voor unieke mood.
  const cfg = {
    // Cool deep-space lift met cyan hue-pull, mild saturation boost
    space:     [0.85, 0.92, 1.18, 0.18, 0.55,  0.00, 0.02, 0.06, 1.12, -0.04],
    // Cyaan lift, boosted saturation + lichte cyan rotatie voor bioluminescent pop
    deepsea:   [0.78, 1.05, 1.12, 0.20, 0.65,  0.00, 0.03, 0.07, 1.18, -0.06],
    // Warme glaze, extra saturation voor candy-shine, lichte magenta drift
    candy:     [1.18, 0.95, 1.06, 0.12, 0.45,  0.04, 0.02, 0.00, 1.20,  0.03],
    // Warm ember-lift, strong saturation voor lava glow, hue naar oranje
    volcano:   [1.22, 0.90, 0.75, 0.18, 0.55,  0.05, 0.01, 0.00, 1.25,  0.04],
    // Cool blue lift voor arctic, lichte saturation; hue iets cooler
    arctic:    [0.90, 1.00, 1.20, 0.16, 0.50,  0.00, 0.02, 0.05, 1.10, -0.03],
    // Sahara warmth, natuurlijke zand-kleur behouden met subtle oranje hue
    sandstorm: [1.12, 1.00, 0.88, 0.12, 0.45,  0.03, 0.01, 0.00, 1.08,  0.03],
    // Pier 47: cool desaturated film-look, koele blauwgrijze shadow-push,
    // hue naar teal voor industriële night-mood.
    pier47:    [0.98, 0.92, 0.98, 0.18, 0.65,  0.00, 0.02, 0.04, 0.92, -0.05],
    // Guangzhou Cinematic: cool blue-purple urban neon, donkerpaars shadows,
    // hue naar cyan-teal voor cold cyberpunk
    guangzhou: [0.88, 0.86, 1.18, 0.20, 0.68,  0.02, 0.00, 0.05, 1.18, -0.06]
  }[world] || [1,1,1, 0.0, 0.45,  0,0,0, 1.0, 0.0];
  const u = _postfx.matComposite.uniforms;
  u.tint.value.set(cfg[0], cfg[1], cfg[2]);
  u.gradeAmount.value = cfg[3];
  u.vignette.value = cfg[4];
  if(u.lift)        u.lift.value.set(cfg[5], cfg[6], cfg[7]);
  if(u.saturation)  u.saturation.value = cfg[8];
  if(u.hueShift)    u.hueShift.value = cfg[9];
}

function resizePostFX(){
  if(!_postfx.ready) return;
  const w = innerWidth, h = innerHeight;
  if(w === _postfx.w && h === _postfx.h) return;
  const _qfBloomScale = (window._qFlags && window._qFlags.bloomScale) || 0.5;
  const halfW = Math.max(2, Math.floor(w * _qfBloomScale));
  const halfH = Math.max(2, Math.floor(h * _qfBloomScale));
  _postfx.rtScene.setSize(w, h);
  _postfx.rtBright.setSize(halfW, halfH);
  _postfx.rtBlurH.setSize(halfW, halfH);
  _postfx.rtBlurV.setSize(halfW, halfH);
  _postfx.matBlur.uniforms.texelSize.value.set(1/halfW, 1/halfH);
  // SSAO + SSR render-targets share lifecycle with postfx — resize
  // them in the same hook so window-size changes don't strand stale
  // dims after the first frame.
  if(typeof _resizeSSAO==='function') _resizeSSAO();
  if(typeof _resizeSSR ==='function') _resizeSSR();
  _postfx.w = w; _postfx.h = h;
}

// Pre-warm the postFX pipeline so the first race-frame doesn't pay shader-
// link + RT-upload tax. _precompileScene() in scene.js compiles main-scene
// materials via renderer.compile(scene,camera), but the three fullscreen
// ShaderMaterials (matExtract / matBlur / matComposite) live on _postfx.quad
// in a separate scene and stay uncompiled until first use. Same for the four
// render-targets, which only get GPU memory on first write. We force both
// here by running one off-screen pass through each material into rtBlurH (a
// cheap half-res sink — nothing is shown on canvas). Called from countdown
// start (countdown.js) so the spike lands during the countdown animation,
// not on the first frame after "GO!".
function _precompilePostFX(scn, cam){
  if(!_postfx.ready || !renderer) return;
  if(!_postfx.enabled) return; // user-toggle or low-tier disabled — no warming needed
  // Ensure RT sizes match current viewport (allocates GPU memory on first use)
  resizePostFX();
  try {
    // Pass 1: real scene → rtScene. Mirrors renderWithPostFX Pass 1 so
    // scene-material programs get linked against this RT's sRGB encoding +
    // populates rtScene.texture so the extract-pass below has a real input.
    if (scn && cam) {
      renderer.setRenderTarget(_postfx.rtScene);
      renderer.render(scn, cam);
    }
    // Pass 2: extract — first link of matExtract program
    _postfx.matExtract.uniforms.tDiffuse.value = _postfx.rtScene.texture;
    _postfx.quad.material = _postfx.matExtract;
    renderer.setRenderTarget(_postfx.rtBright);
    renderer.render(_postfx.fsScene, _postfx.fsCam);
    // Pass 3a: blur horizontal — first link of matBlur program
    _postfx.matBlur.uniforms.tDiffuse.value = _postfx.rtBright.texture;
    _postfx.matBlur.uniforms.direction.value.set(1, 0);
    _postfx.quad.material = _postfx.matBlur;
    renderer.setRenderTarget(_postfx.rtBlurH);
    renderer.render(_postfx.fsScene, _postfx.fsCam);
    // Pass 3b: blur vertical — same program, different uniforms
    _postfx.matBlur.uniforms.tDiffuse.value = _postfx.rtBlurH.texture;
    _postfx.matBlur.uniforms.direction.value.set(0, 1);
    renderer.setRenderTarget(_postfx.rtBlurV);
    renderer.render(_postfx.fsScene, _postfx.fsCam);
    // Pass 4: composite — first link of matComposite program. Sink into
    // rtBlurH instead of the canvas so the user doesn't see a black flash.
    _postfx.matComposite.uniforms.tScene.value = _postfx.rtScene.texture;
    _postfx.matComposite.uniforms.tBloom.value = _postfx.rtBlurV.texture;
    _postfx.quad.material = _postfx.matComposite;
    renderer.setRenderTarget(_postfx.rtBlurH);
    renderer.render(_postfx.fsScene, _postfx.fsCam);
  } catch (e) {
    if (window.dbg) dbg.warn('postfx', 'precompile failed: ' + (e && e.message || e));
  } finally {
    renderer.setRenderTarget(null);
  }
}
window._precompilePostFX = _precompilePostFX;

// Render scene with bloom. Falls back to direct render when disabled,
// when low-quality auto-detect kicked in, or when post-fx isn't ready yet.
function renderWithPostFX(scn, cam){
  if(!_postfx.enabled || !_postfx.ready || window._lowQuality){
    renderer.render(scn, cam);
    return;
  }
  resizePostFX();

  // Pass 1: scene → rtScene
  renderer.setRenderTarget(_postfx.rtScene);
  renderer.render(scn, cam);

  // Pass 2: bright extract → rtBright
  _postfx.quad.material = _postfx.matExtract;
  _postfx.matExtract.uniforms.tDiffuse.value = _postfx.rtScene.texture;
  renderer.setRenderTarget(_postfx.rtBright);
  renderer.render(_postfx.fsScene, _postfx.fsCam);

  // Pass 3a: blur horizontal → rtBlurH
  _postfx.quad.material = _postfx.matBlur;
  _postfx.matBlur.uniforms.tDiffuse.value = _postfx.rtBright.texture;
  _postfx.matBlur.uniforms.direction.value.set(1, 0);
  renderer.setRenderTarget(_postfx.rtBlurH);
  renderer.render(_postfx.fsScene, _postfx.fsCam);

  // Pass 3b: blur vertical → rtBlurV
  _postfx.matBlur.uniforms.tDiffuse.value = _postfx.rtBlurH.texture;
  _postfx.matBlur.uniforms.direction.value.set(0, 1);
  renderer.setRenderTarget(_postfx.rtBlurV);
  renderer.render(_postfx.fsScene, _postfx.fsCam);

  // Pass 3c (optional): atmosphere — radial godrays from sun. Reuses
  // rtBright as bright-pass source (no extra extraction needed) and writes
  // into _atmo.rtGodrays. When atmosphere-pass.js isn't loaded or is
  // disabled (mobile, low-q), this is a no-op and the composite shader
  // below is the original (non-godrays) one from initPostFX.
  if(typeof _renderAtmospherePass==='function') _renderAtmospherePass();
  // Pass 3d (optional): SSAO half-res depth-based occlusion. Skip mobile
  // + low-q via interne guard. Composite picks up via tAO uniform.
  if(typeof _renderSSAO==='function') _renderSSAO();
  // Pass 3e (optional): SSR screen-space reflections. Internal guards
  // skip when _ssr.enabled is false (per-world strength=0). Composite
  // picks up via tSSR + ssrStrength uniforms.
  if(typeof _renderSSR==='function') _renderSSR();

  // Pass 4: composite to canvas
  _postfx.quad.material = _postfx.matComposite;
  _postfx.matComposite.uniforms.tScene.value = _postfx.rtScene.texture;
  _postfx.matComposite.uniforms.tBloom.value = _postfx.rtBlurV.texture;
  renderer.setRenderTarget(null);
  renderer.render(_postfx.fsScene, _postfx.fsCam);
}
