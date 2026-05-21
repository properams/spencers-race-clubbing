// js/core/world-visuals.js — centrale per-wereld visuele configuratie.
//
// Non-module classic-script. Geladen vóór scene.js en postfx.js (zie
// index.html). Exposes window.WORLD_VISUALS + helpers zodat alle consumers
// (scene.js, postfx.js, night.js, car-parts.js, worlds/*.js) er bij kunnen
// zonder ES-module-bundle-rebuild.
//
// Dit is Brok 1a van de PBR Visual Upgrade. Brok 1b vult de world-relevante
// envTags op materialen in. Brok 2 leest bloomMul/threshold uit deze config.
// Brok 4 leest speedBlur/fovBoost.
//
// Per-veld documentatie en bereik staan bij de stable-presets hieronder.

'use strict';

// In-code wereld-id ↔ codenaam bridge. In-code IDs (space, deepsea, ...) blijven
// onaangetast in physics/AI/HUD/race-logic; deze tabel maakt het mogelijk om
// in world-visuals enkel met codenamen te werken.
const WORLD_ID_TO_CODENAME = {
  space:     'cosmic',
  deepsea:   'aqua',
  candy:     'candy',
  volcano:   'magma',
  arctic:    'tundra',
  sandstorm: 'desert',
  pier47:    'harbor',
  guangzhou: 'rain'
};

// Per-material-type IBL base-factoren. envMapIntensity = baseEnv[envTag] *
// visuals.ibl * (envTag==='paint' ? visuals.carPaintEnvMul : 1).
// 'wet-asphalt' is gereserveerd voor Guangzhou (rain) wet-streets in Brok 1b.
// 'wet-prop'   is Guangzhou-specifiek voor solid-volume props (guardrails,
// palen, kiosks, etc.) — bewust 0.55 i.p.v. de generieke 0.70 voor world-prop
// zodat ze natte sfeer pakken zonder chroom-effect. Andere werelden gebruiken
// 'world-prop' (0.70) en blijven ongewijzigd.
const BASE_ENV_BY_TAG = {
  paint:        0.85,
  chrome:       0.75,
  glass:        0.60,
  tire:         0.10,
  carbon:       0.40,
  rim:          0.85,
  'world-prop': 0.70,
  'wet-prop':   0.55,
  'wet-asphalt':0.70,
  'harbor-metal':0.65,
  'harbor-wet': 0.50,
  'aqua-wet':   0.55,
  'aqua-metal': 0.70,
  'lava-rock':  0.30
};

// Helper: vorm één preset uit een gedeelde basis. Houdt de tabel scanbaar.
function _preset(p){
  return {
    ibl:               p.ibl,
    exposureDay:       p.exposureDay,
    exposureNight:     p.exposureNight,
    ambientMul:        p.ambientMul        != null ? p.ambientMul        : 1.0,
    hemiMul:           p.hemiMul           != null ? p.hemiMul           : 1.0,
    fog:               p.fog,
    emissiveMul:       p.emissiveMul,
    carPaintEnvMul:    p.carPaintEnvMul,
    bloomMul:          p.bloomMul,
    bloomThresholdDay: p.bloomThresholdDay,
    bloomThresholdDark:p.bloomThresholdDark,
    speedBlur:         p.speedBlur,
    fovBoost:          p.fovBoost
  };
}

// Startwaarden per wereld. Zie het plan voor de tabel met bereiken
// (ibl 0.2–1.5, exposure 0.7–1.5, emissiveMul 0.8–3.0, carPaintEnvMul 0.3–1.0,
// speedBlur 0.0–0.5, fovBoost 0–8°). Bloom 1:1 uit de bestaande lookup-tables
// in postfx.js zodat de overgang in Brok 2 visueel neutraal start.
const _STABLE = {
  cosmic: _preset({
    ibl: 0.30, exposureDay: 1.10, exposureNight: 1.10,
    fog: {type:'exp2', color:0x010018, density:0.00140},
    emissiveMul: 1.8, carPaintEnvMul: 0.55,
    bloomMul: 1.00, bloomThresholdDay: 0.86, bloomThresholdDark: 0.82,
    speedBlur: 0.30, fovBoost: 5
  }),
  aqua: _preset({
    ibl: 0.62, exposureDay: 0.95, exposureNight: 0.95,
    fog: {type:'exp2', color:0x003355, density:0.00170},
    emissiveMul: 1.2, carPaintEnvMul: 0.55,
    bloomMul: 0.85, bloomThresholdDay: 0.86, bloomThresholdDark: 0.82,
    speedBlur: 0.15, fovBoost: 3
  }),
  candy: _preset({
    ibl: 1.15, exposureDay: 1.25, exposureNight: 1.00,
    fog: {type:'exp2', color:0xffe6f7, density:0.00130},
    emissiveMul: 1.0, carPaintEnvMul: 0.65,
    bloomMul: 0.45, bloomThresholdDay: 0.90, bloomThresholdDark: 0.82,
    speedBlur: 0.10, fovBoost: 3
  }),
  magma: _preset({
    ibl: 0.85, exposureDay: 1.15, exposureNight: 1.15,
    fog: {type:'exp2', color:0x6a1808, density:0.00220},
    emissiveMul: 2.2, carPaintEnvMul: 0.75,
    bloomMul: 1.00, bloomThresholdDay: 0.82, bloomThresholdDark: 0.78,
    speedBlur: 0.25, fovBoost: 4
  }),
  tundra: _preset({
    ibl: 1.05, exposureDay: 1.20, exposureNight: 0.95,
    fog: {type:'exp2', color:0x1a3050, density:0.00350},
    emissiveMul: 1.1, carPaintEnvMul: 0.80,
    bloomMul: 0.70, bloomThresholdDay: 0.86, bloomThresholdDark: 0.82,
    speedBlur: 0.15, fovBoost: 3
  }),
  desert: _preset({
    ibl: 0.95, exposureDay: 1.15, exposureNight: 1.00,
    fog: {type:'linear', color:0xe8a468, near:60, far:220},
    emissiveMul: 1.0, carPaintEnvMul: 0.70,
    bloomMul: 0.55, bloomThresholdDay: 0.86, bloomThresholdDark: 0.82,
    speedBlur: 0.20, fovBoost: 4
  }),
  harbor: _preset({
    ibl: 0.70, exposureDay: 1.12, exposureNight: 0.95,
    fog: {type:'exp2', color:0x252030, density:0.01200},
    emissiveMul: 2.0, carPaintEnvMul: 0.55,
    bloomMul: 1.05, bloomThresholdDay: 0.82, bloomThresholdDark: 0.78,
    speedBlur: 0.25, fovBoost: 4
  }),
  rain: _preset({
    ibl: 0.60, exposureDay: 1.08, exposureNight: 0.90,
    fog: {type:'exp2', color:0x0e0c1a, density:0.00750},
    emissiveMul: 2.4, carPaintEnvMul: 0.55,
    bloomMul: 1.10, bloomThresholdDay: 0.82, bloomThresholdDark: 0.78,
    speedBlur: 0.30, fovBoost: 5
  })
};

// Diep-kopie helper voor experiment-presets. Geen JSON-trick nodig: presets
// zijn platte objects met scalars en één geneste fog-object.
function _cloneStable(s){
  return {
    ibl: s.ibl, exposureDay: s.exposureDay, exposureNight: s.exposureNight,
    ambientMul: s.ambientMul, hemiMul: s.hemiMul,
    fog: Object.assign({}, s.fog),
    emissiveMul: s.emissiveMul, carPaintEnvMul: s.carPaintEnvMul,
    bloomMul: s.bloomMul,
    bloomThresholdDay: s.bloomThresholdDay,
    bloomThresholdDark: s.bloomThresholdDark,
    speedBlur: s.speedBlur, fovBoost: s.fovBoost
  };
}

const WORLD_VISUALS = {};
Object.keys(_STABLE).forEach(function(codename){
  WORLD_VISUALS[codename] = {
    active: 'stable',
    presets: {
      stable:     _STABLE[codename],
      experiment: _cloneStable(_STABLE[codename])
    }
  };
});

// Resolve een willekeurige world-key (codenaam óf in-code id) naar codenaam.
function _resolveCodename(world){
  if(!world) return null;
  if(WORLD_VISUALS[world]) return world;
  return WORLD_ID_TO_CODENAME[world] || null;
}

function getWorldVisuals(world){
  const cn = _resolveCodename(world);
  if(!cn) return null;
  const entry = WORLD_VISUALS[cn];
  return entry.presets[entry.active] || entry.presets.stable;
}

function setActivePreset(world, name){
  const cn = _resolveCodename(world);
  if(!cn) return;
  const entry = WORLD_VISUALS[cn];
  if(entry.presets[name]) entry.active = name;
}

function resetExperiment(world){
  const cn = _resolveCodename(world);
  if(!cn) return;
  const entry = WORLD_VISUALS[cn];
  entry.presets.experiment = _cloneStable(entry.presets.stable);
}

// Apply IBL + emissive-mul aan één materiaal. Geëxtraheerd zodat de
// traverse-loop en de single-material-helper (applyVisualsToMaterial,
// applyVisualsToSharedCarMats) één bron-of-truth delen.
function _applyVisualsToMatInline(m, ibl, carPaintMul, emissiveMul){
  if(!m || !m.userData) return;
  if(m.userData.envTag){
    const base = BASE_ENV_BY_TAG[m.userData.envTag];
    if(base != null){
      const paintFactor = (m.userData.envTag === 'paint') ? carPaintMul : 1.0;
      m.envMapIntensity = base * ibl * paintFactor;
    }
  }
  if(m.userData.isNeon){
    if(m.userData._neonBaseIntensity == null){
      m.userData._neonBaseIntensity = m.emissiveIntensity || 1.0;
    }
    m.emissiveIntensity = m.userData._neonBaseIntensity * emissiveMul;
  }
}

// PBR-fix: drie scene.traverses geconsolideerd in één. Wereld-switch en
// night-toggle doen nu één scene-walk i.p.v. drie. Per-iteratie checken
// we eerst of het materiaal getagd is (skip Lambert/Phong en niet-
// auto-tagbare materialen); zo niet en de mat is een PBR-type, dan
// inline auto-tag + apply. Bij applyOnlyEmissive=true (night-toggle pad)
// slaan we de IBL-pass over omdat IBL niet van dag/nacht afhangt.
function _walkSceneVisuals(scene, visuals, applyOnlyEmissive){
  if(!scene) return;
  const ibl = visuals.ibl;
  const carPaintMul = visuals.carPaintEnvMul;
  const emissiveMul = visuals.emissiveMul;
  scene.traverse(function(obj){
    if(!obj || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for(let i=0;i<mats.length;i++){
      const m = mats[i];
      if(!m) continue;
      m.userData = m.userData || {};
      // Auto-tag op het moment van de eerste apply. Skipt car-mats
      // (_carPBR/_sharedAsset zijn al door car-parts.js getagd) en
      // niet-PBR materialen (envMapIntensity is daar no-op).
      if(!m.userData.envTag && !m.userData.isNeon
         && !m.userData._carPBR && !m.userData._sharedAsset
         && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)){
        const e = m.emissive;
        const hasEmissive = e && (e.r > 0.001 || e.g > 0.001 || e.b > 0.001)
                            && (m.emissiveIntensity || 0) > 0.001;
        if(hasEmissive) m.userData.isNeon = true;
        else            m.userData.envTag = 'world-prop';
        m.userData._autoTagged = true;
      }
      if(applyOnlyEmissive){
        if(m.userData.isNeon){
          if(m.userData._neonBaseIntensity == null){
            m.userData._neonBaseIntensity = m.emissiveIntensity || 1.0;
          }
          m.emissiveIntensity = m.userData._neonBaseIntensity * emissiveMul;
        }
      } else {
        _applyVisualsToMatInline(m, ibl, carPaintMul, emissiveMul);
      }
    }
  });
}

// Wereld-isDark detectie. night.js exposes `isDark` als global; viel terug
// op localStorage als die nog niet is geïnitialiseerd.
function _isWorldDark(){
  if(typeof isDark !== 'undefined') return !!isDark;
  try { return localStorage.getItem('src_night') === '1'; } catch(_) { return false; }
}

// Single-material variant: pas IBL/emissive-mul toe op één materiaal,
// gebruikt door car-parts.js bij creation (cars worden ná buildScene
// gespawned, dus scene.traverse mist ze bij de buildScene-call).
function applyVisualsToMaterial(mat, world){
  if(!mat || !mat.userData) return;
  const v = getWorldVisuals(world);
  if(!v) return;
  _applyVisualsToMatInline(mat, v.ibl, v.carPaintEnvMul, v.emissiveMul);
}

// Fog-overschrijving per wereld. scene.fog wordt nog in scene.js opgezet
// (verweven met skybox-creation en day/night fog-colors); deze helper zet
// alleen color + density (exp2) of color + near/far (linear) erbovenop,
// zodat de centrale config de eindwaarden bepaalt zonder de skybox-logic
// te raken. Type-mismatch wordt overgeslagen om de sandstorm fog-mutatie-
// mechanic (lap-gestuurd via Fog.far) niet stuk te maken.
function _applyFog(scene, fogConfig){
  if(!scene || !scene.fog || !fogConfig) return;
  if(fogConfig.type === 'exp2'){
    if(scene.fog.isFogExp2){
      if(fogConfig.color != null) scene.fog.color.setHex(fogConfig.color);
      if(fogConfig.density != null) scene.fog.density = fogConfig.density;
    }
  } else if(fogConfig.type === 'linear'){
    if(scene.fog.isFog){
      // Linear fog: alleen color overschrijven. near/far blijven onder beheer
      // van per-wereld systemen (sandstorm-storm.js muteert fog.far per lap
      // als hazard-mechanic; mid-race night-toggle zou anders die mutatie
      // terugzetten).
      if(fogConfig.color != null) scene.fog.color.setHex(fogConfig.color);
    }
  }
}

// Idempotente per-wereld apply. Wordt aangeroepen vanuit scene.js (na PMREM-
// bake + setBloomWorld). Voor preset-wisseling via console: schedule via
// requestAnimationFrame om mid-frame traversal te voorkomen.
function applyWorldVisuals(world, scene, renderer){
  const v = getWorldVisuals(world);
  if(!v) return;
  if(scene){
    // Eén traverse die auto-taggt + IBL/emissive-mul toepast.
    _walkSceneVisuals(scene, v, false);
    _applyFog(scene, v.fog);
  }
  // Shared car-mats (_carShared in car-parts.js) leven sessie-lang en zijn
  // niet via scene.traverse bereikbaar wanneer cars nog niet ge-add zijn.
  // PBR-fix: expliciete re-apply zodat chrome/glass/tire/rim/etc. ook na
  // wereld-switch de juiste IBL-multiplier krijgen.
  if(typeof window.applyVisualsToSharedCarMats === 'function'){
    window.applyVisualsToSharedCarMats(world);
  }
  if(renderer && typeof window._setExposureTarget === 'function'){
    const target = _isWorldDark() ? v.exposureNight : v.exposureDay;
    window._setExposureTarget(target);
  }
}

// PBR-fix: night-toggle pad. IBL hangt niet van dag/nacht af, dus de
// volledige IBL-traverse bij elke M-toggle is verspilling. Deze variant
// raakt alleen emissive-mul (neon-materialen flickeren met day/night) en
// de exposure-target. Bespaart 0.5-2 ms per night-toggle op grote werelden.
function applyWorldVisualsNightToggle(world, scene, renderer){
  const v = getWorldVisuals(world);
  if(!v) return;
  if(scene) _walkSceneVisuals(scene, v, true);
  if(renderer && typeof window._setExposureTarget === 'function'){
    const target = _isWorldDark() ? v.exposureNight : v.exposureDay;
    window._setExposureTarget(target);
  }
}

if(typeof window !== 'undefined'){
  window.WORLD_VISUALS             = WORLD_VISUALS;
  window.WORLD_ID_TO_CODENAME      = WORLD_ID_TO_CODENAME;
  window.BASE_ENV_BY_TAG           = BASE_ENV_BY_TAG;
  window.getWorldVisuals           = getWorldVisuals;
  window.setActivePreset           = setActivePreset;
  window.resetExperiment           = resetExperiment;
  window.applyWorldVisuals             = applyWorldVisuals;
  window.applyWorldVisualsNightToggle  = applyWorldVisualsNightToggle;
  window.applyVisualsToMaterial        = applyVisualsToMaterial;
}
