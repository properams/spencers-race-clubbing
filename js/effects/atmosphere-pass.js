// js/effects/atmosphere-pass.js — godrays + horizon-haze post-processing.
// Non-module script, loaded between postfx.js and renderer.js (postfx.js's
// initPostFX is invoked from renderer.initRenderer, and atmosphere-pass.js
// extends the existing fsScene/quad/fsCam fullscreen pipeline so it must
// be visible at the same time as _postfx).
//
// Two effects, one module:
//
//   1. Godrays (radial blur from sun screen-position):
//      Reuses _postfx.rtBright as input (bright-pass extraction already
//      isolates emissive + sun pixels). Marches 24 samples toward sunUV,
//      accumulates with decay. Output → rtGodrays (half-res). Composite
//      adds it additively, gated by per-world strength.
//
//   2. Horizon-haze (folded into composite shader):
//      Cheap vertical gradient that mixes the scene with a horizon tint
//      around the horizon line. No depth-texture needed (saves the cost
//      of attaching one and matches mobile fallback behaviour). The
//      gradient peaks at vUv.y == horizonY and falls off vertically.
//      Three.js fog handles distance-fade; horizon-haze adds the warm/
//      cold colour band that completes the atmospheric perspective.
//
// The composite shader from postfx.js is REPLACED by an extended version
// here on init — we keep the same uniform names (strength/tint/grade/
// vignette) so existing tuning calls (setBloomDayNight, setWorldGrading)
// keep working, and add tGodrays/godrayStrength/hazeColor/hazeStrength/
// hazeY.
//
// Per-world tuning lives in _WORLD_ATMOSPHERE_TUNE. Mirrors the data shape
// of _BLOOM_WORLD_MUL in postfx.js so the dev panel can edit both with
// the same form.
//
// Auto-disabled on mobile, when low-quality kicks in, when fx is user-off,
// and when sun is behind the camera (godrays sample outside [0..1] would
// produce no useful contribution).
//
// Dependencies (script-globals): renderer, THREE, _postfx (from postfx.js),
// sunLight (from scene.js), camera (from scene.js), activeWorld, isDark.

'use strict';

var _atmo = {
  ready: false,
  rtGodrays: null,           // half-res, accumulates radial blur from sun
  matGodrays: null,          // ShaderMaterial — radial blur shader
  matCompositeExt: null,     // ShaderMaterial — extended composite (replaces _postfx.matComposite)
  matCompositeOrig: null,    // back-ref to the original composite so we can fall back if needed
  // Cached vectors — no per-frame allocation
  _sunWorld: null,
  _sunNDC: null,
  // Per-world tuning lookup
  _world: null
};

// Per-world atmosphere strength config. Mirror of postfx.js _BLOOM_WORLD_MUL.
// godrays:   0..1 (sandstorm/guangzhou max; space=0 since no atmosphere)
// hazeY:     vUv.y where the haze band peaks (≈ horizon line in default cam)
// hazeColor: vec3 tint (RGB 0..1) — usually matches the skybox foot-band
// hazeStr:   0..1 strength of the haze tint blend at the band peak
//
// Space is special: no atmosphere → godrays + haze both 0.
// Pastel/saturated worlds (candy) keep haze low so the cotton-candy palette
// doesn't get muddied.
// Per-world atmosphere strength config. Mirror of postfx.js _BLOOM_WORLD_MUL.
// Cinematic camera filters (Option D-C):
//   caStr   — chromatic-aberration: corner-fringing strength. Cinematic
//             worlds (pier47, guangzhou) get higher
//             values for analogue-camera feel; pastel worlds stay lower.
//   grainStr— film-grain noise amount. Universal across worlds — 0.022
//             gives a subtle filmic texture without reading as "broken TV".
// Per-world tune. `heatHazeStr` is Phase 3 deferred — only volcano +
// sandstorm get heat-haze refraction (hete grond,
// zon-mirage, lava-pools). Andere worlds laten op 0 zodat de UV-
// perturbatie no-op'd.
// ssrStr — Sessie 03 screen-space reflection blend strength. Only the
// three wet/cinematic night cities use it; dry worlds set 0 so the
// SSR shader early-exits before the raymarch.
const _WORLD_ATMOSPHERE_TUNE = {
  space:               { godrays: 0.00, hazeStr: 0.00, hazeY: 0.55, hazeColor: [0.06, 0.03, 0.20], caStr: 0.0040, grainStr: 0.014, heatHazeStr: 0.0, ssrStr: 0.0  },
  deepsea:             { godrays: 0.18, hazeStr: 0.22, hazeY: 0.62, hazeColor: [0.00, 0.20, 0.32], caStr: 0.0050, grainStr: 0.018, heatHazeStr: 0.0, ssrStr: 0.0  },
  candy:               { godrays: 0.28, hazeStr: 0.10, hazeY: 0.58, hazeColor: [1.00, 0.86, 0.92], caStr: 0.0020, grainStr: 0.012, heatHazeStr: 0.0, ssrStr: 0.25 },
  volcano:             { godrays: 0.60, hazeStr: 0.25, hazeY: 0.58, hazeColor: [0.42, 0.10, 0.04], caStr: 0.0045, grainStr: 0.022, heatHazeStr: 0.45, ssrStr: 0.0  },
  arctic:              { godrays: 0.30, hazeStr: 0.20, hazeY: 0.55, hazeColor: [0.62, 0.72, 0.88], caStr: 0.0030, grainStr: 0.014, heatHazeStr: 0.0, ssrStr: 0.0  },
  sandstorm:           { godrays: 0.80, hazeStr: 0.28, hazeY: 0.52, hazeColor: [0.91, 0.65, 0.40], caStr: 0.0040, grainStr: 0.026, heatHazeStr: 0.55, ssrStr: 0.0  },
  pier47:              { godrays: 0.65, hazeStr: 0.32, hazeY: 0.60, hazeColor: [0.16, 0.13, 0.20], caStr: 0.0070, grainStr: 0.028, heatHazeStr: 0.0, ssrStr: 0.55 },
  guangzhou:           { godrays: 0.85, hazeStr: 0.30, hazeY: 0.58, hazeColor: [0.06, 0.05, 0.10], caStr: 0.0075, grainStr: 0.028, heatHazeStr: 0.0, ssrStr: 0.70 }
};

// Phase 6.6 — build dirty-lens overlay texture once. 256² canvas met
// 40 sparse soft-edged dots (radial gradient white→transparent). Sommige
// hebben een tweede offset-blob voor smudge-variety. _sharedAsset flag
// zodat disposeScene 'm niet wegslaat.
function _buildDirtyLensTex(){
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const N_DOTS = 40;
  for (let i = 0; i < N_DOTS; i++){
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 4 + Math.random() * 18;
    const peakAlpha = 0.15 + Math.random() * 0.22;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0.0, 'rgba(255,255,255,'+peakAlpha.toFixed(3)+')');
    grd.addColorStop(0.4, 'rgba(255,250,240,'+(peakAlpha*0.5).toFixed(3)+')');
    grd.addColorStop(1.0, 'rgba(255,250,240,0)');
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
    if (Math.random() < 0.30){
      const ox = x + (Math.random() - 0.5) * r * 2;
      const oy = y + (Math.random() - 0.5) * r * 2;
      const orR = r * 0.6;
      const og = g.createRadialGradient(ox, oy, 0, ox, oy, orR);
      og.addColorStop(0.0, 'rgba(255,255,255,'+(peakAlpha*0.6).toFixed(3)+')');
      og.addColorStop(1.0, 'rgba(255,250,240,0)');
      g.fillStyle = og; g.fillRect(ox - orR, oy - orR, orR * 2, orR * 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  tex.userData = { _sharedAsset: true };
  return tex;
}

function initAtmospherePass(){
  if(!window.renderer || !window._postfx) return;
  // Mobile + user-disabled paths defer to postfx state. We piggy-back on
  // _postfx.ready to ensure same lifecycle (mobile + src_fx='0' both skip).
  if(window._isMobile) { _atmo.ready = false; return; }
  if(!_postfx.ready) { _atmo.ready = false; return; }
  // Tier flag: godrays + atmosphere pass disabled on low tier (matches
  // mobile parity). On mid we still render but with halved sample count
  // — applied in the shader source via setAtmosphereWorld godray strength.
  if(window._qFlags && window._qFlags.godrays === false) { _atmo.ready = false; return; }

  const w = innerWidth, h = innerHeight;
  const _qfBloomScale = (window._qFlags && window._qFlags.bloomScale) || 0.5;
  const halfW = Math.max(2, Math.floor(w * _qfBloomScale));
  const halfH = Math.max(2, Math.floor(h * _qfBloomScale));

  // Godrays RT — half-res RGBA8, no depth, no stencil.
  _atmo.rtGodrays = new THREE.WebGLRenderTarget(halfW, halfH, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false
  });

  // Radial-blur shader: 24 samples from vUv toward sunUV with decay. Source
  // is _postfx.rtBright (luminance-thresholded scene). When the sun is off-
  // screen (sunUV.xy outside [0..1] or sunNDC.z > 1) we set sunUV ≈ vUv so
  // the loop fetches a single black sample, producing no godrays — this
  // avoids a branch in the shader on every fragment.
  _atmo.matGodrays = new THREE.ShaderMaterial({
    uniforms: {
      tBright: { value: null },
      sunUV:   { value: new THREE.Vector2(0.5, 0.5) },
      density: { value: 0.85 },
      weight:  { value: 0.42 },
      decay:   { value: 0.965 },
      exposure:{ value: 0.36 }
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){vUv=uv;gl_Position=vec4(position,1.0);}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tBright;',
      'uniform vec2 sunUV;',
      'uniform float density;',
      'uniform float weight;',
      'uniform float decay;',
      'uniform float exposure;',
      'varying vec2 vUv;',
      'const int N = 24;',
      'void main(){',
      '  vec2 texCoord = vUv;',
      '  vec2 delta = (vUv - sunUV) * (1.0/float(N)) * density;',
      '  float illumDecay = 1.0;',
      '  vec3 col = vec3(0.0);',
      '  for(int i=0;i<N;i++){',
      '    vec3 s = texture2D(tBright, texCoord).rgb;',
      '    s *= illumDecay * weight;',
      '    col += s;',
      '    texCoord -= delta;',
      '    illumDecay *= decay;',
      '  }',
      '  gl_FragColor = vec4(col * exposure, 1.0);',
      '}'
    ].join('\n'),
    depthWrite: false,
    depthTest: false
  });

  // Extended composite — same uniforms as original PLUS tGodrays + horizon
  // haze. We REPLACE _postfx.matComposite so render passes through the new
  // shader without changing the postfx render-path code in postfx.js.
  // Original tint/gradeAmount/vignette/strength uniforms keep their names
  // so setWorldGrading() and setBloomDayNight() continue to work.
  _atmo.matCompositeOrig = _postfx.matComposite;
  _atmo.matCompositeExt = new THREE.ShaderMaterial({
    uniforms: {
      tScene:        { value: null },
      tBloom:        { value: null },
      tGodrays:      { value: null },
      strength:      { value: _postfx.strength },
      godrayStrength:{ value: 0.55 },
      tint:          { value: new THREE.Vector3(1, 1, 1) },
      gradeAmount:   { value: 0.0 },
      vignette:      { value: 0.55 },
      // Phase 5 — lift + saturation + hueShift toegevoegd zodat de
      // extended composite alle grading-dimensies van de original composite
      // ondersteunt (bug: setWorldGrading schreef voorheen naar non-existent
      // uniforms na atmosphere-pass init). hueShift is nieuw — geeft per-
      // wereld kleur-rotatie zonder volledige LUT pass (cheap HSV swing).
      lift:          { value: new THREE.Vector3(0, 0, 0) },
      saturation:    { value: 1.0 },
      hueShift:      { value: 0.0 },
      hazeColor:     { value: new THREE.Vector3(0.5, 0.5, 0.6) },
      hazeStrength:  { value: 0.22 },
      hazeY:         { value: 0.58 },
      // Camera-grade cinematic uniforms (Option D-C):
      // caStrength — chromatic aberration: scene R/B channels sampled at
      //   small offsets from green, perpendicular to vUv-center. 0 disables.
      //   Scales with distance-from-center so corners get strongest fringing.
      // grainAmount — film-grain noise: time-driven hash noise added to
      //   final colour. Subtle filmic texture. 0 disables. Per-world tune
      //   stays in 0.010-0.030 range; higher reads as "broken TV".
      // time — seconds, written by renderAtmospherePass each frame.
      caStrength:    { value: 0.0032 },
      grainAmount:   { value: 0.022 },
      time:          { value: 0.0 },
      // Phase 6.6 — dirty-lens overlay. Multiplied into bloom in shader
      // so bloom highlights pick up sparse soft-dot artefacts (the
      // "lens dirt" cinematic effect). tDirtyLens is assigned after this
      // uniform block (one-time CanvasTexture from _buildDirtyLensTex()).
      tDirtyLens:        { value: null },
      dirtyLensStrength: { value: 0.45 },
      // Phase 3 deferred — heat-haze refraction. Per-world per-frame UV
      // perturbation gepegd aan time-driven sin-noise. Strength scaled
      // door hazeMask zodat alleen de onderste helft van het scherm
      // (waar de hete grond + lava zijn) wordt vervormd. Per-world
      // strength via _WORLD_ATMOSPHERE_TUNE.heatHazeStr (default 0).
      heatHazeStr:       { value: 0.0 },
      // Phase 9.2 — speed-based radial motion blur. updateMotionBlur(dt)
      // in visuals.js drives motionBlurStr op 0..1 op basis van player
      // speed-ratio. Composite sampelt scene-blur radially vanuit het
      // scherm-midden zodat snelheid voelt als velocity-tunnel.
      motionBlurStr:     { value: 0.0 },
      // Phase 9.1 — SSAO uniform. ssao-pass.js vult tAO met de half-res
      // occlusion texture. aoMix bepaalt hoe sterk AO scene-color dimt.
      // 0 = SSAO uit (default), 1 = max AO blend.
      tAO:               { value: null },
      aoMix:             { value: 0.0 },
      // Sessie 03 — SSR uniforms. tSSR is the half-res reflection RT
      // produced by ssr-pass.js; ssrStrength is the per-world blend
      // amount (table _WORLD_ATMOSPHERE_TUNE.ssrStr). 0 short-circuits.
      tSSR:              { value: null },
      ssrStrength:       { value: 0.0 }
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){vUv=uv;gl_Position=vec4(position,1.0);}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tScene;',
      'uniform sampler2D tBloom;',
      'uniform sampler2D tGodrays;',
      'uniform float strength;',
      'uniform float godrayStrength;',
      'uniform vec3 tint;',
      'uniform float gradeAmount;',
      'uniform float vignette;',
      'uniform vec3 lift;',
      'uniform float saturation;',
      'uniform float hueShift;',
      'uniform vec3 hazeColor;',
      'uniform float hazeStrength;',
      'uniform float hazeY;',
      'uniform float caStrength;',
      'uniform float grainAmount;',
      'uniform float time;',
      'uniform sampler2D tDirtyLens;',
      'uniform float dirtyLensStrength;',
      'uniform float heatHazeStr;',
      'uniform float motionBlurStr;',
      'uniform sampler2D tAO;',
      'uniform float aoMix;',
      'uniform sampler2D tSSR;',
      'uniform float ssrStrength;',
      'varying vec2 vUv;',
      'void main(){',
      // Heat-haze: UV perturbatie sterkst op bottom half (hete grond/lava).
      // Mask faded met smoothstep zodat hot zone niet abrupt eindigt.
      // sin-based 2D noise — cheap, geen extra texture sample nodig.
      '  float hazeMask = 1.0 - smoothstep(0.0, 0.55, vUv.y);',
      '  float hazeOff = (sin(vUv.x * 32.0 + time * 4.0) + sin(vUv.y * 28.0 + time * 3.7)) * 0.5;',
      '  vec2 hazedUv = vUv + vec2(hazeOff * heatHazeStr * hazeMask * 0.02, 0.0);',
      // Chromatic aberration — sample R and B at offsets from green. Offset
      // scales with distance-from-center (corner fringing, none at centre).
      '  vec2 dirC = hazedUv - 0.5;',
      '  float dC = length(dirC);',
      '  vec2 caOff = dirC * caStrength * dC * 2.0;',
      '  float r = texture2D(tScene, hazedUv + caOff).r;',
      '  float g = texture2D(tScene, hazedUv).g;',
      '  float b = texture2D(tScene, hazedUv - caOff).b;',
      '  vec3 sc = vec3(r, g, b);',
      // Phase 9.2 — radial motion blur. Sample 4 extra punten langs
      // de radial direction (uv → center) en blend met scene-color.
      // Strength schaalt met motionBlurStr (0..1). Cheap: 4 extra
      // texture samples bij motionBlurStr > 0.01. Skipped op stilstand.
      '  if(motionBlurStr > 0.01){',
      '    vec3 mb = sc;',
      '    vec2 mbDir = dirC * motionBlurStr * 0.015;',
      '    mb += texture2D(tScene, hazedUv - mbDir).rgb;',
      '    mb += texture2D(tScene, hazedUv - mbDir * 2.0).rgb;',
      '    mb += texture2D(tScene, hazedUv - mbDir * 3.0).rgb;',
      '    mb += texture2D(tScene, hazedUv - mbDir * 4.0).rgb;',
      '    sc = mix(sc, mb * 0.2, motionBlurStr * 0.6);',  // max 60% blend
      '  }',
      // Phase 9.1 — SSAO: multiply scene color by occlusion factor.
      // aoMix 0 = uit (sc * 1.0), aoMix 1 = volledige AO (sc * ao.r).
      '  if(aoMix > 0.01){',
      '    float ao = texture2D(tAO, vUv).r;',
      '    sc *= mix(1.0, ao, aoMix);',
      '  }',
      // Sessie 03 — SSR blend. tSSR.rgb is the reflection colour, tSSR.a is
      // confidence (edge + distance fade from the SSR pass). Additive blend
      // weighted by both confidence and per-world ssrStrength so droge
      // worlds (strength=0) krijgen geen contribution.
      '  if(ssrStrength > 0.01){',
      '    vec4 ssr = texture2D(tSSR, vUv);',
      '    sc += ssr.rgb * ssr.a * ssrStrength;',
      '  }',
      '  vec3 bl = texture2D(tBloom, vUv).rgb;',
      // Phase 6.6 — dirty-lens overlay: vermenigvuldig bloom met
      // (1.0 + dirt * strength) zodat bright bloom zones lens-dirt
      // artefacten oppikken. Sub-bloom regions blijven onaangetast.
      // Branch op strength>0 zodat de texture-sample wordt geskipt als
      // de overlay uit staat (default in 2026-05-15 fix). Dynamic branch
      // op uniform is GPU-vriendelijk; spaart 1 fullscreen texture-fetch.
      '  if(dirtyLensStrength > 0.001){',
      '    vec3 dirty = texture2D(tDirtyLens, vUv).rgb;',
      '    bl *= (1.0 + dirty * dirtyLensStrength);',
      '  }',
      '  vec3 gr = texture2D(tGodrays, vUv).rgb;',
      // Horizon haze: smooth band around hazeY, narrow above (sky), wider
      // below (ground). Strength peaks at hazeY itself and falls off so the
      // top of the screen (sky) and bottom (ground close to camera) stay
      // mostly clean. ~ Atmospheric perspective without depth sampling.
      '  float dy = vUv.y - hazeY;',
      '  float band = (dy < 0.0)',
      '    ? smoothstep(0.0, 0.22, dy + 0.22)',
      '    : 1.0 - smoothstep(0.0, 0.18, dy);',
      '  float hazeF = band * hazeStrength;',
      '  sc = mix(sc, hazeColor, clamp(hazeF, 0.0, 1.0));',
      // Bloom + godrays additive
      '  vec3 col = sc + bl * strength + gr * godrayStrength;',
      // Phase 5 — lift: koele/warme push in shadow-zones (zone waar 1-col groot is).
      '  col = col + lift * (1.0 - col);',
      // Phase 5 — saturation: luma-mix (Rec.601). 1.0=neutraal, <1 desat, >1 boost.
      '  float lumaS = dot(col, vec3(0.299, 0.587, 0.114));',
      '  col = mix(vec3(lumaS), col, saturation);',
      // Phase 5 — hueShift: cheap HSV-rotatie via 2D matrix in YIQ-achtig space.
      // Branch op |hueShift|>0.001 zodat default 0 een no-op is. Berekent
      // chroma-vector in (R-Y, B-Y) en roteert die om de luma-as. Niet zo
      // perfect kleurkundig als RGB→HSV→RGB maar visueel identiek voor de
      // kleine shifts (<±0.15 rad) die we per wereld gebruiken, en sneller.
      '  if (abs(hueShift) > 0.001) {',
      '    float ca = cos(hueShift); float sa = sin(hueShift);',
      '    float yh = dot(col, vec3(0.299, 0.587, 0.114));',
      '    vec2 chroma = vec2(col.r - yh, col.b - yh);',
      '    vec2 rotC = vec2(chroma.x * ca - chroma.y * sa, chroma.x * sa + chroma.y * ca);',
      '    col.r = yh + rotC.x;',
      '    col.b = yh + rotC.y;',
      '    col.g = (yh - 0.299 * col.r - 0.114 * col.b) / 0.587;',
      // Clamp negatieve channels — bij saturated highlights (lava emissive
      // post-bloom waar col.g >1 zit) kan reconstruction col.g <0 maken.
      // Dat geeft cyan/magenta fringes rond bright fires. max(0) ruimt op.
      '    col = max(col, vec3(0.0));',
      '  }',
      // Color grade (unchanged from postfx.js)
      '  vec3 graded = col * tint;',
      '  col = mix(col, graded, gradeAmount);',
      // Vignette (unchanged from postfx.js)
      '  vec2 d = vUv - 0.5;',
      '  float rr = dot(d, d);',
      '  float vig = 1.0 - vignette * smoothstep(0.18, 0.85, rr*4.0);',
      '  col *= vig;',
      // Film grain — time-driven hash noise added at the very end so it
      // sits on top of everything (bloom, godrays, grade, vignette). Hash
      // pattern from Inigo Quilez's classic 2D noise. Symmetric around 0
      // so neither lifts nor darkens average brightness.
      '  float grain = (fract(sin(dot(vUv*1024.0 + time, vec2(12.9898,78.233))) * 43758.5453) - 0.5) * grainAmount;',
      '  col += grain;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n'),
    depthWrite: false,
    depthTest: false
  });

  // Copy current state from the original composite into the extended one so
  // setBloomDayNight/setWorldGrading values applied BEFORE init are preserved.
  if(_atmo.matCompositeOrig && _atmo.matCompositeOrig.uniforms){
    const u0 = _atmo.matCompositeOrig.uniforms;
    const u1 = _atmo.matCompositeExt.uniforms;
    if(u0.strength)    u1.strength.value    = u0.strength.value;
    if(u0.tint)        u1.tint.value.copy(u0.tint.value);
    if(u0.gradeAmount) u1.gradeAmount.value = u0.gradeAmount.value;
    if(u0.vignette)    u1.vignette.value    = u0.vignette.value;
    // Phase 5 — carry over lift + saturation als die al gezet waren voor
    // atmosphere-pass init (originele postfx.js composite ondersteunt ze).
    if(u0.lift)        u1.lift.value.copy(u0.lift.value);
    if(u0.saturation)  u1.saturation.value  = u0.saturation.value;
  }

  // Swap the composite in postfx.js so its renderWithPostFX picks up the
  // extended shader on the next frame. We keep the old material around in
  // matCompositeOrig for fallback (e.g. if a future regression forces a
  // revert).
  _postfx.matComposite = _atmo.matCompositeExt;

  // Phase 6.6 — bouw dirty-lens texture eenmalig en assign aan de
  // matCompositeExt uniform. Cached forever via _sharedAsset flag.
  //
  // Belangrijk: respecteer de quality-tier flag dirtyLensOverlay. Voor 2026-05-15
  // werd deze flag wel gedefinieerd in quality-tier.js maar nooit gelezen, waardoor
  // de 40 statische screen-space dots altijd op 0.45 strength werden vermenigvuldigd
  // met bloom. Dat leverde een merkbaar "stilstaand beeld dat lichtjes doorschemert
  // in de bewegende track" effect op desktop — het cinematic doel (lensvuil) las als
  // rendering-bug. Default mid/low=false (overlay uit) en ook high=false; users die
  // het cinematic-effect terugwillen kunnen window._qFlags.dirtyLensOverlay=true
  // zetten en window._applyDirtyLensFromFlags() aanroepen (zonder reload).
  _atmo.dirtyLensTex = _buildDirtyLensTex();
  _atmo.matCompositeExt.uniforms.tDirtyLens.value = _atmo.dirtyLensTex;
  applyDirtyLensFromFlags();

  // Cached scratch vectors — reused in renderAtmospherePass to avoid
  // per-frame allocations (hot loop, 60 fps target).
  _atmo._sunWorld = new THREE.Vector3();
  _atmo._sunNDC   = new THREE.Vector3();

  _atmo.ready = true;
  // Apply current world config if available
  if(typeof activeWorld!=='undefined') setAtmosphereWorld(activeWorld);
}

// Per-world tuning — analogous to setBloomWorld / setWorldGrading. Called
// from buildScene() after activeWorld is set. Adjusts godray strength + the
// horizon-haze band colour/strength.
function setAtmosphereWorld(world){
  if(!_atmo.ready) return;
  const cfg = _WORLD_ATMOSPHERE_TUNE[world] || _WORLD_ATMOSPHERE_TUNE.deepsea;
  _atmo._world = cfg;
  const u = _atmo.matCompositeExt.uniforms;
  // Tier-aware godray strength: mid tier halves contribution; godray pass
  // itself still runs (composite shader reads from rtGodrays) but the
  // visible bloom-additive contribution is scaled down so the perceived
  // cost matches. Low tier has _atmo.ready=false so we never reach here.
  const _qfGS = (window._qFlags && window._qFlags.godraySamples) || 24;
  const _godrayScale = _qfGS >= 24 ? 1.0 : (_qfGS / 24);
  u.godrayStrength.value = cfg.godrays * _godrayScale;
  u.hazeStrength.value   = cfg.hazeStr;
  u.hazeY.value          = cfg.hazeY;
  u.hazeColor.value.set(cfg.hazeColor[0], cfg.hazeColor[1], cfg.hazeColor[2]);
  // Camera-grade cinematic uniforms — fall back to mid values if a future
  // world adds a tune entry without these fields.
  u.caStrength.value     = (cfg.caStr != null)    ? cfg.caStr    : 0.0032;
  u.grainAmount.value    = (cfg.grainStr != null) ? cfg.grainStr : 0.022;
  // Phase 3 deferred — heat-haze (0 op de meeste worlds).
  u.heatHazeStr.value    = (cfg.heatHazeStr != null) ? cfg.heatHazeStr : 0.0;
  // Phase 9.1 — SSAO mix per world. Default 0.5 op desktop (waar SSAO
  // actief is); cinematic worlds krijgen iets hoger voor extra grounding.
  // Pastel (candy) zwakker zodat shadows niet teveel het lichte palet
  // verzwaren. Mobile heeft geen tAO uniform zinvol — SSAO is uit.
  const _aoDefaults = {
    candy: 0.30, space: 0.20,
    pier47: 0.65, guangzhou: 0.60,
    volcano: 0.50, deepsea: 0.40, arctic: 0.45,
    sandstorm: 0.45
  };
  // aoMix only contributes when SSAO is actually running (writes to rtAO).
  // Mid + low tiers skip SSAO via _qFlags.ssao=false; aoMix=0 there avoids
  // sampling a stale/blank tAO that would darken the scene.
  const _aoActive = window._qFlags ? (window._qFlags.ssao !== false) : !window._isMobile;
  u.aoMix.value = _aoActive ? (_aoDefaults[world] != null ? _aoDefaults[world] : 0.5) : 0;
  // Sessie 03 — SSR per-world strength. window._setSSRStrength syncs
  // both the SSR shader (early-exit guard) and the composite uniform.
  // Gated to high+mid via the _qFlags.ssr table entry.
  const _ssrActive = window._qFlags ? (window._qFlags.ssr !== false) : !window._isMobile;
  const _ssrTarget = _ssrActive ? (cfg.ssrStr != null ? cfg.ssrStr : 0.0) : 0.0;
  if(typeof window._setSSRStrength === 'function'){
    window._setSSRStrength(_ssrTarget);
  } else {
    u.ssrStrength.value = _ssrTarget;
  }
}

// Day/night atmosphere tweak: at night, godrays push slightly stronger
// (because night scenes have sparser bright sources → the rays should
// punch more), and haze pulls darker. Mirrors setBloomDayNight pattern.
// Phase 9.2 — drive motionBlurStr uniform vanuit per-frame player speed.
// Aangeroepen door loop.js update-block. Threshold: alleen >65% top-speed
// produceert blur (high-speed cue, niet altijd zichtbaar).
//
// PBR-upgrade follow-up: per-wereld speedBlur-multiplier uit world-visuals
// (stable-presets 0.10-0.30 per wereld), plus tier-flag _qFlags.speedBlur
// die de blur op LOW volledig uitschakelt.
function setMotionBlurFromSpeed(speedRatio){
  if(!_atmo.ready) return;
  if(window._qFlags && window._qFlags.speedBlur === false){
    _atmo.matCompositeExt.uniforms.motionBlurStr.value = 0;
    return;
  }
  const _v = (typeof window.getWorldVisuals === 'function' && typeof activeWorld !== 'undefined')
    ? window.getWorldVisuals(activeWorld) : null;
  const worldMul = (_v && typeof _v.speedBlur === 'number') ? _v.speedBlur : 1.0;
  const t = Math.max(0, (speedRatio - 0.65) / 0.35);  // 0..1 vanaf 65%
  const target = t * t * worldMul;                      // ease-in × per-wereld scale
  const u = _atmo.matCompositeExt.uniforms;
  // Smooth via simple lerp toward target — voorkomt snelle flicker bij
  // boost-bursts en handbrake-decel.
  const cur = u.motionBlurStr.value;
  u.motionBlurStr.value = cur + (target - cur) * 0.15;
}
if(typeof window !== 'undefined') window._setMotionBlurFromSpeed = setMotionBlurFromSpeed;

function setAtmosphereDayNight(dark){
  if(!_atmo.ready || !_atmo._world) return;
  const u = _atmo.matCompositeExt.uniforms;
  const base = _atmo._world;
  if(dark){
    u.godrayStrength.value = base.godrays * 1.15;
    u.hazeStrength.value   = base.hazeStr * 0.85;
  } else {
    u.godrayStrength.value = base.godrays;
    u.hazeStrength.value   = base.hazeStr;
  }
}

// Called from renderWithPostFX (postfx.js) between bright-extract and
// composite. Computes sun screen-position and runs the radial-blur pass
// into _atmo.rtGodrays. Result is consumed by the composite via the
// tGodrays uniform set below.
function renderAtmospherePass(){
  if(!_atmo.ready) return false;
  // Runtime tier downgrade flips _qFlags.godrays=false without re-initing
  // the pass. Honour at render time so high→low downgrades stop the radial
  // blur immediately.
  if(window._qFlags && window._qFlags.godrays === false) return false;
  // Skip the radial-blur entirely when the composite would multiply by ≈0.
  // The space world is configured with godrays:0.00 in _WORLD_ATMOSPHERE_TUNE;
  // pre-fix the 24-sample (or 12-sample) radial blur still ran every frame
  // before being scaled away. ~0.4-1.2ms saved per frame on space.
  const _gs = _atmo.matCompositeExt.uniforms.godrayStrength.value;
  if(_gs <= 0.001){
    _atmo.matCompositeExt.uniforms.tGodrays.value = null;
    return false;
  }
  // sunLight + camera + scene live in the classic-script scope as `let`
  // (main.js:42, 50) — they're NOT on `window`. Bare-name lookup resolves
  // via the shared script-scope (one above window). Previously this used
  // `window.sunLight` which was always undefined → godrays never ran,
  // even though _atmo.ready was true.
  const _sun = (typeof sunLight !== 'undefined') ? sunLight : null;
  const _cam = (typeof camera   !== 'undefined') ? camera   : null;
  if(!_sun || !_cam) return false;

  // Per-frame time uniform for film-grain (drives the hash-noise pattern
  // so each frame's grain pattern differs — static grain reads as fixed
  // noise pattern not "movie film"). performance.now() in seconds, modulo
  // a large number so the float stays precise.
  const _tSec = (performance.now() * 0.001) % 1000.0;
  _atmo.matCompositeExt.uniforms.time.value = _tSec;

  // Project sunLight world-position to NDC. Outside [-1..1] xy means sun is
  // off-screen; sunNDC.z >= 1 means it's behind the camera. In either case
  // we collapse the godray source to vUv so the loop produces near-black.
  _atmo._sunWorld.copy(_sun.position);
  _atmo._sunNDC.copy(_atmo._sunWorld).project(_cam);

  const u = _atmo.matGodrays.uniforms;
  if(_atmo._sunNDC.z < 1.0){
    u.sunUV.value.set(
      _atmo._sunNDC.x * 0.5 + 0.5,
      _atmo._sunNDC.y * 0.5 + 0.5
    );
  } else {
    // Sun behind camera — drive sunUV outside [0..1] so all delta-samples
    // walk off-texture (returns 0 with ClampToEdge). Cheap "disabled" path
    // without a uniform-controlled branch.
    u.sunUV.value.set(-2.0, -2.0);
  }

  // Resize to track current window — postfx.resizePostFX runs first and
  // may have resized rtBright; we must match its half-res dims so the
  // shared fullscreen quad samples 1:1.
  resizeAtmospherePass();
  // Source: postfx's rtBright (already luminance-thresholded). Output:
  // _atmo.rtGodrays. Done with the shared fsScene/fsCam/quad from postfx.
  u.tBright.value = _postfx.rtBright.texture;
  _postfx.quad.material = _atmo.matGodrays;
  window.renderer.setRenderTarget(_atmo.rtGodrays);
  window.renderer.render(_postfx.fsScene, _postfx.fsCam);

  // Tell the extended composite where to find godrays this frame.
  _atmo.matCompositeExt.uniforms.tGodrays.value = _atmo.rtGodrays.texture;
  return true;
}

function resizeAtmospherePass(){
  if(!_atmo.ready) return;
  const w = innerWidth, h = innerHeight;
  // Match postFX bloom scale so the godrays RT inherits the same per-tier
  // downscale (mid = quarter-res, high = half-res). Sampling the radial-
  // blur at quarter-res cuts the shader cost ~4× on mid-tier without a
  // visible quality loss (24-sample blur is already very soft).
  const _qfBloomScale = (window._qFlags && window._qFlags.bloomScale) || 0.5;
  const halfW = Math.max(2, Math.floor(w * _qfBloomScale));
  const halfH = Math.max(2, Math.floor(h * _qfBloomScale));
  // Compare against postfx half-res (same source). If postfx already
  // resized, our RT needs the same dims.
  if(_atmo.rtGodrays.width !== halfW || _atmo.rtGodrays.height !== halfH){
    _atmo.rtGodrays.setSize(halfW, halfH);
  }
}

// Reflect current _qFlags.dirtyLensOverlay into the composite-shader uniform.
// Called from initAtmospherePass and from dev-panel when the user toggles the
// overlay at runtime (without this hook the toggle would silently no-op until
// next page reload). Safe pre-init: returns silently if matCompositeExt isn't
// built yet, so the dev-panel can fire-and-forget.
function applyDirtyLensFromFlags(){
  if(!_atmo.matCompositeExt) return;
  const on = !!(window._qFlags && window._qFlags.dirtyLensOverlay);
  _atmo.matCompositeExt.uniforms.dirtyLensStrength.value = on ? 0.22 : 0.0;
}

// Expose for postfx.js to call inside renderWithPostFX, and for dev panel.
window._renderAtmospherePass = renderAtmospherePass;
window._resizeAtmospherePass = resizeAtmospherePass;
window._initAtmospherePass   = initAtmospherePass;
window.setAtmosphereWorld    = setAtmosphereWorld;
window.setAtmosphereDayNight = setAtmosphereDayNight;
window._applyDirtyLensFromFlags = applyDirtyLensFromFlags;
// Read-only handle to per-world tune table for the dev panel.
window._ATMO_TUNE            = _WORLD_ATMOSPHERE_TUNE;
window._atmo                 = _atmo;
