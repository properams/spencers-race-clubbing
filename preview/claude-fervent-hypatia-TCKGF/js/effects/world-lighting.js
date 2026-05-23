// js/effects/world-lighting.js — non-module script.
//
// Data-only tabel met per-wereld lighting-config voor day en night.
// Bron-van-waarheid voor wat het toggle-pad doet bij M-press:
//   - night (isDark=true)  : per-wereld blok in js/effects/night.js
//   - day   (isDark=false) : night.js's else-branch + per-wereld helper
//                            _apply<World>DayLighting() (zie comments
//                            per veld voor exacte regel-ref).
//
// Schema (alle velden optioneel — afwezig = toggle-pad raakt het niet aan):
//   sky?:        { top, bot }                        // alleen makeSkyTex-literal worlds (deepsea, space)
//   fog?:        { density?, color? }                // density skipt sandstorm (THREE.Fog linear)
//   sun?:        { intensity, color?, position? }
//   amb?:        { intensity, color? }
//   hemi?:       { intensity, color?, ground? }
//   trackLights?:{ mode:'set', value } | { mode:'multiply', factor, max }
//   headlights?: { front, tail }
//   aiHead?:     number
//
// Mobile-split: scalar voor flat-werelden; { desktop, mobile } shape op
// velden waar helpers window._isMobile-ternary doen (candy/sandstorm/
// pier47/guangzhou — alleen sun.intensity, plus sandstorm hemi.intensity).
//
// Buiten scope: build-time-pad in scene.js's buildScene()-cascade
// (regels 1178-1216) — dat is fase 3+. Pre-existing drift tussen
// build-time en toggle-naar-day blijft onaangetast. _fogColorDay/Night
// module-state in night.js valt onder fase-2 consumer-design.

'use strict';

// ── DATA-TABEL ──────────────────────────────────────────────────────
// Velden die in night.js voor een gegeven (wereld, modus) NIET gezet
// worden, zijn hier weggelaten (i.p.v. null). Dat dekt o.a.
// arctic.{day,night}.hemi, volcano.{day,night}.{sky,fog} en
// neoncity.day.trackLights netjes af.

const WORLD_LIGHTING = {
  // Deepsea — geen day-helper; alle waarden komen direct uit
  // night.js's deepsea-tak (regels 96-116). Sky is literal makeSkyTex
  // top/bot voor beide modes.
  deepsea: {
    night: {
      sky:         { top: '#021420', bot: '#03202e' }, // night.js:99
      fog:         { density: 0.0018 },                // night.js:99
      sun:         { intensity: 0.18 },                // night.js:100
      amb:         { intensity: 0.36 },                // night.js:100
      hemi:        { intensity: 0.24 },                // night.js:100
      trackLights: { mode: 'set', value: 1.6 },        // night.js:101
      headlights:  { front: 1.7, tail: 1.4 },          // night.js:113-114 (isDark-tak)
      aiHead:      1.0,                                // night.js:115 (isDark-tak)
    },
    day: {
      sky:         { top: '#001825', bot: '#003355' }, // night.js:106
      fog:         { density: 0.0019 },                // night.js:106
      sun:         { intensity: 0.45 },                // night.js:107
      amb:         { intensity: 0.55 },                // night.js:107
      hemi:        { intensity: 0.30 },                // night.js:107
      trackLights: { mode: 'set', value: 0 },          // night.js:108
      headlights:  { front: 0, tail: 0 },              // night.js:113-114 (else-tak)
      aiHead:      0,                                  // night.js:115 (else-tak)
    },
  },

  // Arctic — night-sky is procedureel (PMREM-bake via
  // makeArcticNightSkyTex), day-sky komt uit build-time procedureel
  // (makeArcticSkyTex). Geen sky-velden in beide modes.
  // Day-waarden via _applyArcticDayLighting() (arctic.js:21-31).
  arctic: {
    night: {
      fog:         { density: 0.0030 },                // night.js:130
      sun:         { intensity: 0.22 },                // night.js:131
      amb:         { intensity: 0.40 },                // night.js:131
      hemi:        { intensity: 0.32 },                // night.js:131
      trackLights: { mode: 'set', value: 1.4 },        // night.js:132
      headlights:  { front: 1.7, tail: 1.4 },          // night.js:145-146 (isDark-tak)
      aiHead:      1.0,                                // night.js:147 (isDark-tak)
    },
    day: {
      fog:         { density: 0.0035 },                // night.js:136
      sun:         { intensity: 0.8, color: 0xaaccff }, // arctic.js:23
      amb:         { intensity: 0.45, color: 0x445566 }, // arctic.js:24
      hemi:        { intensity: 0.30, color: 0x6688aa, ground: 0x223344 }, // arctic.js:25-27
      trackLights: { mode: 'set', value: 0 },          // night.js:142
      headlights:  { front: 0, tail: 0 },              // night.js:145-146 (else-tak)
      aiHead:      0,                                  // night.js:147 (else-tak)
    },
  },

  // Volcano — night-sky is procedureel (PMREM-bake via
  // makeVolcanoNightSkyTex), fog wordt in buildVolcanoEnvironment +
  // build-time-pad gezet. Night.js's volcano-tak raakt scene.fog niet
  // aan; geen sky/fog-velden hier in beide modes.
  // Day-waarden via _applyVolcanoDayLighting() (volcano.js:35-45).
  volcano: {
    night: {
      sun:         { intensity: 0.22 },                // night.js:172
      amb:         { intensity: 0.38 },                // night.js:172
      hemi:        { intensity: 0.26 },                // night.js:172
      trackLights: { mode: 'set', value: 1.8 },        // night.js:175 (isDark-tak)
      headlights:  { front: 1.9, tail: 1.6 },          // night.js:176-177 (isDark-tak)
      aiHead:      1.2,                                // night.js:178 (isDark-tak)
    },
    day: {
      sun:         { intensity: 0.7,  color: 0xff4422 },                   // volcano.js:37
      amb:         { intensity: 0.35, color: 0x441100 },                   // volcano.js:38
      hemi:        { intensity: 0.25, color: 0xff6600, ground: 0x220800 }, // volcano.js:39-41
      trackLights: { mode: 'set', value: 0 },          // night.js:175 (else-tak)
      headlights:  { front: 0, tail: 0 },              // night.js:176-177 (else-tak)
      aiHead:      0,                                  // night.js:178 (else-tak)
    },
  },

  // Candy — night-sky is procedureel (PMREM-bake via
  // makeCandyNightSkyTex), day-sky komt uit build-time
  // (makeCandySkyTex). Geen sky-velden.
  // Day-waarden via _applyCandyDayLighting() (candy.js:56-68) — heeft
  // mobile-split op sun.intensity (1.5 mobile, 2.4 desktop).
  candy: {
    night: {
      fog:         { density: 0.0010 },                // night.js:193
      sun:         { intensity: 0.22 },                // night.js:194
      amb:         { intensity: 0.44 },                // night.js:194
      hemi:        { intensity: 0.30 },                // night.js:194
      trackLights: { mode: 'set', value: 2.2 },        // night.js:195
      headlights:  { front: 1.6, tail: 1.4 },          // night.js:198-199 (isDark-tak)
      aiHead:      1.0,                                // night.js:200 (isDark-tak)
    },
    day: {
      fog:         { density: 0.0013 },                // night.js:204
      sun:         {
        intensity: { desktop: 2.4, mobile: 1.5 },      // candy.js:59
        color: 0xffb3e6,                               // candy.js:58
        position: [60, 80, -40],                       // candy.js:60
      },
      amb:         { intensity: 0.5, color: 0xf0d9ff },                    // candy.js:61
      hemi:        { intensity: 0.8, color: 0xffd9f0, ground: 0xb3e6ff },  // candy.js:62-64
      trackLights: { mode: 'set', value: 0 },          // night.js:210
      headlights:  { front: 0, tail: 0 },              // night.js:213-214 (else-tak)
      aiHead:      0,                                  // night.js:215 (else-tak)
    },
  },

  // Sandstorm — night-sky procedureel (PMREM-bake makeSandstormNightSkyTex),
  // day-sky procedureel build-time (makeSandstormSkyTex). Uniek:
  // sandstorm gebruikt THREE.Fog (linear) ipv FogExp2 — geen fog.density.
  // De storm-hazard mechaniek muteert scene.fog.far per lap, geen
  // toggle-pad-werk. fog.color verandert wél bij toggle.
  // Day-waarden via _applySandstormDayLighting() (sandstorm.js:146-158)
  // met mobile-split op sun.intensity en hemi.intensity.
  sandstorm: {
    night: {
      fog:         { color: 0x1a1535 },                // night.js:250
      sun:         {
        intensity: 0.6,                                // night.js:241
        color: 0xa8c0ff,                               // night.js:240
        position: [80, 120, -40],                      // night.js:242
      },
      amb:         { intensity: 0.25, color: 0x2a2540 },                   // night.js:243
      hemi:        { intensity: 0.4,  color: 0x3a3868, ground: 0x1a1828 }, // night.js:244-246
      trackLights: { mode: 'set', value: 1.4 },        // night.js:281 (isDark-tak)
      headlights:  { front: 1.7, tail: 1.4 },          // night.js:283-284 (isDark-tak)
      aiHead:      1.0,                                // night.js:285 (isDark-tak)
    },
    day: {
      fog:         { color: 0xe8a468 },                // night.js:267
      sun:         {
        intensity: { desktop: 2.8, mobile: 1.7 },      // sandstorm.js:149
        color: 0xff8c42,                               // sandstorm.js:148
        position: [80, 35, -60],                       // sandstorm.js:150
      },
      amb:         { intensity: 0.35, color: 0x5a2818 },                                          // sandstorm.js:151
      hemi:        {
        intensity: { desktop: 1.0, mobile: 0.7 },      // sandstorm.js:154
        color: 0xffb87a,                               // sandstorm.js:152
        ground: 0x8b3a1d,                              // sandstorm.js:153
      },
      trackLights: { mode: 'set', value: 0 },          // night.js:281 (else-tak)
      headlights:  { front: 0, tail: 0 },              // night.js:283-284 (else-tak)
      aiHead:      0,                                  // night.js:285 (else-tak)
    },
  },

  // Pier 47 — Cinematic harbour. Night-sky procedureel
  // (makePier47NightSkyTex), day-sky procedureel build-time
  // (makePier47SkyTex). Day-waarden via _applyPier47DayLighting()
  // (pier47.js:76-92) met mobile-split op sun.intensity.
  // Uniek: pier47 heeft non-zero day-headlights (0.6/0.4/0.3) —
  // cinematic-baseline blijft overdag laag-belicht, zodat lamp-poles
  // en koplampen visueel werk doen. Geen trackLights in toggle-pad
  // (build-time-default).
  pier47: {
    night: {
      fog:         { density: 0.014, color: 0x18141f },        // night.js:302, 310
      sun:         { intensity: 0.20, color: 0x9aa6b8 },       // night.js:305
      amb:         { intensity: 0.10, color: 0x0c0c14 },       // night.js:306
      hemi:        { intensity: 0.14, color: 0x40485a, ground: 0x18141a }, // night.js:307-309
      headlights:  { front: 1.7, tail: 1.4 },                  // night.js:325-326 (isDark-tak)
      aiHead:      1.0,                                        // night.js:327 (isDark-tak)
    },
    day: {
      fog:         { density: 0.012, color: 0x252030 },        // night.js:315, 320
      sun:         {
        intensity: { desktop: 0.40, mobile: 0.30 },            // pier47.js:83
        color: 0x9aa6b8,                                       // pier47.js:82
        position: [60, 110, 80],                               // pier47.js:84
      },
      amb:         { intensity: 0.15, color: 0x14141c },                   // pier47.js:85
      hemi:        { intensity: 0.20, color: 0x6a7080, ground: 0x2a2028 }, // pier47.js:86-88
      headlights:  { front: 0.6, tail: 0.4 },                  // night.js:325-326 (else-tak)
      aiHead:      0.3,                                        // night.js:327 (else-tak)
    },
  },

  // Guangzhou — Cinematic neon-stad. Night-sky procedureel
  // (makeGuangzhouNightSkyTex), day-sky procedureel build-time
  // (makeGuangzhouSkyTex). Day-waarden via _applyGuangzhouDayLighting()
  // (guangzhou.js:140-152) met mobile-split op sun.intensity.
  // Spiegelt pier47's pattern: non-zero day-headlights (0.6/0.4/0.3)
  // omdat de cinematic baseline ook overdag laag-belicht is. Geen
  // trackLights in toggle-pad (build-time-default).
  guangzhou: {
    night: {
      fog:         { density: 0.012,  color: 0x08060e },       // night.js:342, 350
      sun:         { intensity: 0.14, color: 0x3a4050 },       // night.js:345
      amb:         { intensity: 0.08, color: 0x060610 },       // night.js:346
      hemi:        { intensity: 0.12, color: 0x2a2840, ground: 0x0e0c18 }, // night.js:347-349
      headlights:  { front: 1.8, tail: 1.5 },                  // night.js:365-366 (isDark-tak)
      aiHead:      1.1,                                        // night.js:367 (isDark-tak)
    },
    day: {
      fog:         { density: 0.0075, color: 0x0e0c1a },       // night.js:355, 360
      sun:         {
        intensity: { desktop: 0.25, mobile: 0.18 },            // guangzhou.js:143
        color: 0x5a6878,                                       // guangzhou.js:142
        position: [50, 120, 70],                               // guangzhou.js:144
      },
      amb:         { intensity: 0.12, color: 0x0a0814 },                   // guangzhou.js:145
      hemi:        { intensity: 0.16, color: 0x4a4860, ground: 0x1a1428 }, // guangzhou.js:146-148
      headlights:  { front: 0.6, tail: 0.4 },                  // night.js:365-366 (else-tak)
      aiHead:      0.3,                                        // night.js:367 (else-tak)
    },
  },

  // Space — geen day-helper; alle waarden komen direct uit night.js's
  // space-tak (regels 369-383). Sky is literal makeSkyTex top/bot voor
  // beide modes. Uniek: headlights/aiHead worden onvoorwaardelijk (buiten
  // if/else) op dezelfde waarde gezet — day én night zijn identiek.
  space: {
    night: {
      sky:         { top: '#020216', bot: '#0a0a30' }, // night.js:372
      fog:         { density: 0.0006 },                // night.js:372
      sun:         { intensity: 0.16 },                // night.js:373
      amb:         { intensity: 0.34 },                // night.js:373
      hemi:        { intensity: 0.24 },                // night.js:373
      trackLights: { mode: 'set', value: 2.0 },        // night.js:379 (isDark-tak)
      headlights:  { front: 1.8, tail: 1.5 },          // night.js:381-382 (always-on)
      aiHead:      1.1,                                // night.js:383 (always-on)
    },
    day: {
      sky:         { top: '#06033a', bot: '#10085a' }, // night.js:375
      fog:         { density: 0.0014 },                // night.js:375
      sun:         { intensity: 0.18 },                // night.js:376
      amb:         { intensity: 0.40 },                // night.js:376
      hemi:        { intensity: 0.28 },                // night.js:376
      trackLights: { mode: 'set', value: 1.4 },        // night.js:379 (else-tak)
      headlights:  { front: 1.8, tail: 1.5 },          // night.js:381-382 (always-on)
      aiHead:      1.1,                                // night.js:383 (always-on)
    },
  },

  // Grand Prix — fallback voor onbekende activeWorld (de else-branch
  // in night.js:387-412). Night-sky procedureel via
  // makeGrandPrixNightSkyTex (PMREM-bake). Day-waarden via
  // _applyGrandPrixDayLighting() (scene.js:74-87).
  // Note: grandprix is geen live-selectable wereld (staat niet in
  // data/prices.json of data/tracks.json). Het is de baseline-palette
  // voor de else-branch. Zie sectie K in plan voor follow-up vraag
  // (rename naar _fallback of als live-wereld toevoegen).
  grandprix: {
    night: {
      fog:         { density: 0.0022 },                // night.js:397
      sun:         { intensity: 0.22 },                // night.js:398
      amb:         { intensity: 0.40 },                // night.js:398
      hemi:        { intensity: 0.28 },                // night.js:398
      trackLights: { mode: 'set', value: 2.4 },        // night.js:399
      headlights:  { front: 1.8, tail: 1.5 },          // night.js:400 (isDark-tak)
      aiHead:      1.1,                                // night.js:401 (isDark-tak)
    },
    day: {
      fog:         { density: 0.0021 },                // night.js:405
      sun:         { intensity: 1.65, color: 0xfff5e0 },                    // scene.js:78
      amb:         { intensity: 0.50, color: 0x88aacc },                    // scene.js:79
      hemi:        { intensity: 0.36, color: 0x9bbfdd, ground: 0x4a7a3d },  // scene.js:80-82
      trackLights: { mode: 'set', value: 0 },          // night.js:409
      headlights:  { front: 0, tail: 0 },              // night.js:410 (else-tak)
      aiHead:      0,                                  // night.js:411 (else-tak)
    },
  },

  // default = literale duplicaat van grandprix (mirrors night.js
  // else-branch voor onbekende activeWorld). Aparte entry zodat
  // fase 2's applyWorldLighting een eenvoudige lookup
  // WORLD_LIGHTING[world] kan doen zonder ?? fallback per call-site.
  // Drift-risico: minimaal (beide records worden in dezelfde commit
  // gewijzigd; het is altijd kopie van grandprix).
  default: {
    night: {
      fog:         { density: 0.0022 },
      sun:         { intensity: 0.22 },
      amb:         { intensity: 0.40 },
      hemi:        { intensity: 0.28 },
      trackLights: { mode: 'set', value: 2.4 },
      headlights:  { front: 1.8, tail: 1.5 },
      aiHead:      1.1,
    },
    day: {
      fog:         { density: 0.0021 },
      sun:         { intensity: 1.65, color: 0xfff5e0 },
      amb:         { intensity: 0.50, color: 0x88aacc },
      hemi:        { intensity: 0.36, color: 0x9bbfdd, ground: 0x4a7a3d },
      trackLights: { mode: 'set', value: 0 },
      headlights:  { front: 0, tail: 0 },
      aiHead:      0,
    },
  },
};

// Maak globally beschikbaar voor latere modules (fase 2: applyLighting).
if (typeof window !== 'undefined') window.WORLD_LIGHTING = WORLD_LIGHTING;

// ── _resolveMobile ──────────────────────────────────────────────────
// Normalizer voor mobile-split lighting-velden. Een waarde met de
// shape {desktop, mobile} wordt resolved via window._isMobile; pure
// scalars (en objecten zonder die shape) vallen ongewijzigd door.
// Gebruikt door applyWorldLighting voor sun.intensity (candy, sandstorm,
// pier47, guangzhou) en hemi.intensity (sandstorm).
function _resolveMobile(v){
  if(v && typeof v === 'object' && 'desktop' in v && 'mobile' in v){
    return window._isMobile ? v.mobile : v.desktop;
  }
  return v;
}

// ── applyWorldLighting ──────────────────────────────────────────────
// Consumer voor de WORLD_LIGHTING tabel. Leest het (world, isDark)-
// record en past elk aanwezig veld toe op de runtime-lights. Ontbrekend
// veld = niets doen (geen reset naar default) — dat is het contract uit
// fase 1.5 zodat het toggle-pad bit-identiek gereproduceerd kan worden.
//
// Niet binnen scope: per-wereld extras (trackPoles, stars, _dsaBioEdges,
// _jellyfishList, _sunBillboard, PMREM-baked scene.background, etc.).
// Die blijven inline in toggleNight() omdat ze niet onder het
// gestandaardiseerde lighting-schema vallen.
function applyWorldLighting(world, isDark){
  const rec = WORLD_LIGHTING[world] || WORLD_LIGHTING.default;
  if(!rec) return;
  const mode = isDark ? rec.night : rec.day;
  if(!mode) return;

  // Sky — alleen literal-makeSkyTex worlds (deepsea, space).
  if(mode.sky && typeof makeSkyTex === 'function' && typeof scene !== 'undefined'){
    scene.background = makeSkyTex(mode.sky.top, mode.sky.bot);
  }

  // Fog — density skipt linear THREE.Fog (sandstorm), color schrijft
  // altijd als scene.fog.color bestaat.
  if(mode.fog && typeof scene !== 'undefined' && scene.fog){
    if(mode.fog.density !== undefined && typeof scene.fog.density === 'number'){
      scene.fog.density = mode.fog.density;
    }
    if(mode.fog.color !== undefined && scene.fog.color){
      scene.fog.color.setHex(mode.fog.color);
    }
  }

  // Directional sun.
  if(mode.sun && typeof sunLight !== 'undefined' && sunLight){
    if(mode.sun.intensity !== undefined) sunLight.intensity = _resolveMobile(mode.sun.intensity);
    if(mode.sun.color !== undefined) sunLight.color.setHex(mode.sun.color);
    if(mode.sun.position) sunLight.position.set(mode.sun.position[0], mode.sun.position[1], mode.sun.position[2]);
  }

  // Ambient fill.
  if(mode.amb && typeof ambientLight !== 'undefined' && ambientLight){
    if(mode.amb.intensity !== undefined) ambientLight.intensity = _resolveMobile(mode.amb.intensity);
    if(mode.amb.color !== undefined) ambientLight.color.setHex(mode.amb.color);
  }

  // Hemisphere.
  if(mode.hemi && typeof hemiLight !== 'undefined' && hemiLight){
    if(mode.hemi.intensity !== undefined) hemiLight.intensity = _resolveMobile(mode.hemi.intensity);
    if(mode.hemi.color !== undefined) hemiLight.color.setHex(mode.hemi.color);
    if(mode.hemi.ground !== undefined) hemiLight.groundColor.setHex(mode.hemi.ground);
  }

  // Track-lights set-mode (alle huidige werelden gebruiken 'set';
  // 'multiply'-tak komt pas als een wereld die nodig heeft).
  if(mode.trackLights && mode.trackLights.mode === 'set' &&
     typeof trackLightList !== 'undefined' && trackLightList){
    const v = mode.trackLights.value;
    for(let i=0;i<trackLightList.length;i++) trackLightList[i].intensity = v;
  }

  // Player headlights + tail.
  if(mode.headlights){
    if(typeof plHeadL !== 'undefined' && plHeadL){
      plHeadL.intensity = mode.headlights.front;
      if(typeof plHeadR !== 'undefined' && plHeadR) plHeadR.intensity = mode.headlights.front;
    }
    if(typeof plTail !== 'undefined' && plTail) plTail.intensity = mode.headlights.tail;
  }

  // AI headlight-pool baseline.
  if(mode.aiHead !== undefined && typeof _aiHeadPool !== 'undefined' && _aiHeadPool){
    for(let i=0;i<_aiHeadPool.length;i++) _aiHeadPool[i].intensity = mode.aiHead;
  }
}

if(typeof window !== 'undefined'){
  window._resolveMobile     = _resolveMobile;
  window.applyWorldLighting = applyWorldLighting;
}
