// js/effects/sky-shader.js — Phase 6.8: shader-based sky dome voor Pier47.
//
// BackSide sphere met ShaderMaterial. Camera staat binnenin, kijkt naar
// buiten. Uniforms: sunDir (auto-update vanuit sunLight.position),
// sunColor, horizon/zenith gradient, time (subtle cloud-noise drift).
//
// Wordt gebouwd alleen voor activeWorld === 'pier47' — template voor
// toekomstige rollout naar Guangzhou + Volcano-Cinematic. Fallback:
// bestaande CanvasTexture-sky (scene.background) blijft staan; als de
// shader-compile faalt rendert de dome niet maar blijft de scene
// visueel intact.
//
// Mobile-skip: shader-sky kost ~0.5-1ms desktop. Op mobile is postfx al
// uit en zijn we conservatief — fallback naar de bestaande canvas-sky.
//
// Dependencies (script-globals): THREE, scene, sunLight (let-scoped in
// main.js, accessible via bare name from this classic script).

'use strict';

// Per-world shader-sky palette. Iedere entry mapped op de scene.fog +
// per-world atmosphere palette zodat de shader-dome ergens hetzelfde
// foot-band tint heeft als de bestaande CanvasTexture sky en de
// horizon-haze in atmosphere-pass composite. Eenvoudig uitbreidbaar
// naar nieuwe worlds door entry toe te voegen.
const _SKY_SHADER_WORLDS = {
  pier47: {
    horizon:   0x252030,   // matches scene.fog
    zenith:    0x0a0814,   // deep purple-black sky-top
    sun:       0xffaa55,   // sodium-amber (Pier47 lamp anchor)
    sunInt:    0.85,
    cloudAmp:  0.4         // cloud-noise drift strength on horizon band
  },
  guangzhou: {
    horizon:   0x0e0c1a,   // matches scene.fog
    zenith:    0x040208,   // near-black zenith for neon contrast
    sun:       0xff40a0,   // neon-magenta "sun" (artistic — wereld is altijd nacht)
    sunInt:    0.65,
    cloudAmp:  0.55        // sterker cloud drift = wet-rain atmosphere
  },
};

function buildSkyShaderForWorld(world){
  // Tier flag — sky-shader dome (a 32×16 sphere with custom shader) is the
  // visual polish layer for Pier47/Guangzhou. Mid keeps
  // it for atmosphere; low (incl. mobile via the mobile→low mapping in
  // quality-tier.js) falls back to CanvasTexture sky (cheaper).
  if(window._qFlags && window._qFlags.skyShaderDome === false) return null;
  // Defensive fallback for boot ordering — if quality-tier hasn't init yet,
  // preserve the original mobile-skip behaviour.
  if(!window._qFlags && window._isMobile) return null;
  if(typeof THREE === 'undefined' || !THREE.SphereGeometry) return null;
  const cfg = _SKY_SHADER_WORLDS[world];
  if(!cfg) return null;  // unsupported world — fall back to CanvasTexture sky

  // Sphere radius < camera.far (900) zodat de dome altijd binnen frustum
  // valt. 800 = 89% van far, ruim genoeg voor de scene scale.
  const geo = new THREE.SphereGeometry(800, 32, 16);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunDir:       { value: new THREE.Vector3(180, 320, 80).normalize() },
      sunColor:     { value: new THREE.Color(cfg.sun) },
      horizonColor: { value: new THREE.Color(cfg.horizon) },
      zenithColor:  { value: new THREE.Color(cfg.zenith) },
      sunIntensity: { value: cfg.sunInt },
      cloudAmp:     { value: cfg.cloudAmp },
      time:         { value: 0.0 }
    },
    vertexShader: [
      'varying vec3 vWorldDir;',
      'void main(){',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  vWorldDir = normalize(wp.xyz);',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 sunDir;',
      'uniform vec3 sunColor;',
      'uniform vec3 horizonColor;',
      'uniform vec3 zenithColor;',
      'uniform float sunIntensity;',
      'uniform float cloudAmp;',
      'uniform float time;',
      'varying vec3 vWorldDir;',
      // Phase 10.1 — volumetric cloud fbm (value-noise, 3 octaves).
      'float skyHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      'float skyNoise(vec2 p){',
      '  vec2 i = floor(p), f = fract(p);',
      '  float a = skyHash(i);',
      '  float b = skyHash(i + vec2(1.0, 0.0));',
      '  float c = skyHash(i + vec2(0.0, 1.0));',
      '  float d = skyHash(i + vec2(1.0, 1.0));',
      '  vec2 u = f * f * (3.0 - 2.0 * f);',
      '  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;',
      '}',
      'float skyFbm(vec2 p){',
      '  float v = 0.0; float a = 0.5;',
      '  for(int i=0; i<3; i++){ v += a * skyNoise(p); p *= 2.0; a *= 0.5; }',
      '  return v;',
      '}',
      'void main(){',
      '  vec3 dir = normalize(vWorldDir);',
      '  float t = smoothstep(-0.1, 0.4, dir.y);',
      '  vec3 col = mix(horizonColor, zenithColor, t);',
      '  float sd = max(0.0, dot(dir, sunDir));',
      '  float sunDisc = pow(sd, 256.0);',
      '  float sunGlow = pow(sd, 8.0);',
      '  col += sunColor * (sunDisc * 2.5 + sunGlow * 0.45 * sunIntensity);',
      // Phase 10.1 — volumetric cloud bank op horizon band via fbm.
      // Wider mask (exp -8 ipv -12), 2-layer fbm voor variatie, animated
      // via time-uniform zodat clouds traag langs drijven. Colour mix
      // tussen horizonColor*1.4 (lit-bottom) en near-white top.
      '  float cloudY = abs(dir.y - 0.05);',
      '  float cloudMask = exp(-cloudY * 8.0);',
      '  vec2 cloudUv = vec2(dir.x, dir.z) * 2.5 + vec2(time * 0.015, 0.0);',
      '  float cloudDensity = skyFbm(cloudUv) * 0.9 + skyFbm(cloudUv * 2.3 + 5.0) * 0.4;',
      '  cloudDensity = smoothstep(0.5, 1.1, cloudDensity);',
      '  vec3 cloudCol = mix(horizonColor * 1.4, vec3(1.0, 0.95, 0.9), cloudDensity * 0.7);',
      '  col = mix(col, cloudCol, cloudMask * cloudDensity * cloudAmp * 1.3);',
      // Legacy lightweight scintillation — keep voor breeze-on-distant-sky
      '  float cloudN = fract(sin(dir.x*30.0 + dir.z*22.0 + time*0.05) * 43758.5);',
      '  col = mix(col, col * 1.18, cloudMask * cloudN * cloudAmp);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n'),
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false
  });

  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -1000;  // render eerst zodat alles erbovenop tekent
  dome.frustumCulled = false;
  dome.userData = dome.userData || {};
  dome.userData._shaderSky = true;
  dome.userData._sharedAsset = false;  // dispose normaal bij world-switch
  return dome;
}

// Per-frame update — call vanuit loop.js naast bestaande updateSky().
// Pin sun direction aan sunLight.position zodat weather/sun-arc updates
// in real-time op de shader-sky verschijnen. Time-uniform drives subtle
// cloud-noise drift (visible op horizon band).
let _skySunCachePos = null;
function updateSkyShader(){
  if(typeof scene === 'undefined' || !scene) return;
  let dome = null;
  for(let i=0; i<scene.children.length; i++){
    const c = scene.children[i];
    if(c.userData && c.userData._shaderSky){ dome = c; break; }
  }
  if(!dome) return;
  const m = dome.material;
  if(!m || !m.uniforms) return;
  const _sun = (typeof sunLight !== 'undefined') ? sunLight : null;
  if(_sun){
    // Cache sun-position: copy + normalize alleen als de zon merkbaar
    // bewogen is. Tijdens day/night staat de zon stil; tijdens sun-arc
    // beweegt hij elke frame een fractie maar de threshold 1e-6 op de
    // squared-distance laat sub-pixel beweging gewoon door.
    if(!_skySunCachePos) _skySunCachePos = new THREE.Vector3();
    if(_skySunCachePos.distanceToSquared(_sun.position) > 1e-6){
      m.uniforms.sunDir.value.copy(_sun.position).normalize();
      _skySunCachePos.copy(_sun.position);
    }
  }
  m.uniforms.time.value = (performance.now() * 0.001) % 1000;
}

if(typeof window !== 'undefined'){
  window._buildSkyShaderForWorld = buildSkyShaderForWorld;
  window._updateSkyShader = updateSkyShader;
}
