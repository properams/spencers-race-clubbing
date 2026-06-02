// js/effects/weather-lighting.js — non-module script.
//
// Fase 4a: WEATHER_MOD data-tabel + applyWeatherLighting consumer.
// Data-only release, geen call-site-wijziging. Fase 4b integreert setWeather.
//
// Multiplier-design: sun/amb/hemi worden MULTIPLICATIEF gemoduleerd t.o.v.
// de huidige tabel-base (gezet door applyWorldLighting). fog.density is
// ADDITIEF (skip op linear THREE.Fog). fog.color en sky-bg zijn ABSOLUTE
// OVERRIDES (weather wint). Sky-bg wordt OVERGESLAGEN op werelden met
// PMREM-baked sky-cache (volcano/candy/sandstorm/pier47/guangzhou) — anders
// breekt het cache + PMREM-env-werk van fase 3b/3c.
//
// Multipliers gederiveerd van grandprix.day-baseline in WORLD_LIGHTING
// (sun=1.65, amb=0.50, hemi=0.36, fog.density=0.0021). Voor GP-fallback
// reproduceert applyWorldLighting+applyWeatherLighting bit-identiek de
// huidige weather.js GP-absoluten (zie baseline-check onderaan).
// Voor sandstorm + pier47 (waar GP-absoluten op gedumpt werden) is dit
// een gewenste gedragschange: hun base-tabelwaarden komen door, ipv
// GP-fallback-overschrijvingen.

'use strict';

// ── DATA-TABEL ────────────────────────────────────────────────────────
// Per mode: optionele velden voor sun/amb/hemi (multiplier + optioneel
// color/position-override voor sunset) + fog (additieve density + color-
// override) + bg (sky top/bot strings voor makeSkyTex, alleen toegepast op
// non-PMREM werelden). Velden die ontbreken = geen aanraak (niet 1.0
// expliciet — applyWeatherLighting skipt afwezige velden).
//
// Fractie-vorm (0.30/1.65) bewust gekozen ipv afgeronde decimaal: behoudt
// exact de GP-absoluut bij reproductie, geen afrondingsdrift.
const WEATHER_MOD = {
  clear: {
    sun:  { mul: 1.0 },
    amb:  { mul: 1.0 },
    hemi: { mul: 1.0 },
    fog:  { addDensity: 0.0,                  color: 0x8ac0e0 },
    bg:   ['#1e5292','#b8d8ee'],
  },
  fog: {
    sun:  { mul: 0.30 / 1.65 },                 // 0.30/1.65 ≈ 0.1818
    amb:  { mul: 0.35 / 0.50 },                 // 0.70 exact
    hemi: { mul: 0.20 / 0.36 },                 // 0.20/0.36 ≈ 0.5556
    fog:  { addDensity: 0.012 - 0.0021,         color: 0x889988 },
    bg:   ['#778877','#99aa99'],
  },
  sunset: {
    sun:  { mul: 1.20 / 1.65, color: 0xff8840 }, // 1.20/1.65 ≈ 0.7273
    amb:  { mul: 1.0 },                          // weather.js zet amb niet in sunset → × 1.0
    hemi: { mul: 0.50 / 0.36, color: 0xff9944, ground: 0x664422 }, // 0.50/0.36 ≈ 1.389
    fog:  { addDensity: 0.0,                     color: 0xdd8855 },
    bg:   ['#ff4400','#ffaa44'],
  },
  storm: {
    sun:  { mul: 0.25 / 1.65 },                 // 0.25/1.65 ≈ 0.1515
    amb:  { mul: 0.18 / 0.50 },                 // 0.36 exact
    hemi: { mul: 0.12 / 0.36 },                 // 0.12/0.36 ≈ 0.3333
    fog:  { addDensity: 0.006 - 0.0021,          color: 0x223322 },
    bg:   ['#0a1205','#1a2a18'],
  },
  snow: {
    sun:  { mul: 0.60 / 1.65 },                 // 0.60/1.65 ≈ 0.3636
    amb:  { mul: 0.55 / 0.50 },                 // 1.10 exact
    hemi: { mul: 0.45 / 0.36 },                 // 1.25 exact
    fog:  { addDensity: 0.0045 - 0.0021,         color: 0xbbccdd },
    bg:   ['#8899aa','#ccddee'],
  },
};

// Werelden met PMREM-baked sky-cache (zie fase 3b/3c night.js). setWeather
// mag hun scene.background niet overschrijven — sky-cache + PMREM-env
// blijven dan onbruikbaar tot volgende M-toggle.
const WORLD_PMREM_BG = {
  volcano:   1,
  candy:     1,
  sandstorm: 1,
  pier47:    1,
  guangzhou: 1,
};

// ── applyWeatherLighting ─────────────────────────────────────────────
// Past WEATHER_MOD[mode] toe op de huidige lights. Bedoeld om aangeroepen
// te worden DIRECT NA applyWorldLighting(world, isDark) — die zet de base,
// deze functie multiplext + overschrijft de weather-specifieke deltas.
//
// Niet binnen scope: snow-particles, rain-canvas, storm-flash-timer —
// die blijven inline in setWeather()'s mode-specifieke extras (fase 4b).
function applyWeatherLighting(mode){
  const mod = WEATHER_MOD[mode];
  if(!mod) return;

  // Sun — multiplier × base, plus optionele color/position-override.
  if(mod.sun && typeof sunLight !== 'undefined' && sunLight){
    if(mod.sun.mul !== undefined) sunLight.intensity *= mod.sun.mul;
    if(mod.sun.color !== undefined) sunLight.color.setHex(mod.sun.color);
    if(mod.sun.position) sunLight.position.set(mod.sun.position[0], mod.sun.position[1], mod.sun.position[2]);
  }

  // Ambient.
  if(mod.amb && typeof ambientLight !== 'undefined' && ambientLight){
    if(mod.amb.mul !== undefined) ambientLight.intensity *= mod.amb.mul;
    if(mod.amb.color !== undefined) ambientLight.color.setHex(mod.amb.color);
  }

  // Hemisphere — multiplier + optionele color/ground-override.
  if(mod.hemi && typeof hemiLight !== 'undefined' && hemiLight){
    if(mod.hemi.mul !== undefined) hemiLight.intensity *= mod.hemi.mul;
    if(mod.hemi.color !== undefined) hemiLight.color.setHex(mod.hemi.color);
    if(mod.hemi.ground !== undefined) hemiLight.groundColor.setHex(mod.hemi.ground);
  }

  // Fog — density ADDITIEF (skip linear-fog), color OVERRIDE (weather wint).
  if(mod.fog && typeof scene !== 'undefined' && scene && scene.fog){
    if(mod.fog.addDensity !== undefined && typeof scene.fog.density === 'number'){
      scene.fog.density += mod.fog.addDensity;
    }
    if(mod.fog.color !== undefined && scene.fog.color){
      scene.fog.color.setHex(mod.fog.color);
    }
  }

  // Sky bg — alleen op niet-PMREM werelden. Beschermt de PMREM-cache van
  // volcano/candy/sandstorm/pier47/guangzhou (fase 3b/3c).
  if(mod.bg && typeof activeWorld !== 'undefined' && !WORLD_PMREM_BG[activeWorld]
     && typeof makeSkyTex === 'function' && typeof scene !== 'undefined' && scene){
    scene.background = makeSkyTex(mod.bg[0], mod.bg[1]);
  }
}

if(typeof window !== 'undefined'){
  window.WEATHER_MOD            = WEATHER_MOD;
  window.WORLD_PMREM_BG         = WORLD_PMREM_BG;
  window.applyWeatherLighting   = applyWeatherLighting;
}

// ── Baseline check (fase 4a self-validation) ─────────────────────────
// Bevestigt dat WEATHER_MOD × WORLD_LIGHTING.grandprix.day-base de oude
// weather.js GP-fallback-absoluten reproduceert. Doel: garanderen dat de
// GP-fallback bit-identiek blijft na fase 4b's setWeather-refactor. Drift
// op sandstorm/pier47 is gewenst (fix van GP-clobber-bug) — die wordt
// in fase 4b expliciet gerapporteerd, niet hier.
//
// Verwachte output (browser-console na boot):
//   WEATHER_MOD baseline check: 25/25 velden match
//
// 5 modes × 5 velden = 25:
//   sun.intensity (base × mul)
//   amb.intensity (base × mul)
//   hemi.intensity (base × mul)
//   fog.density   (base + addDensity)
//   fog.color     (override)
//
// IIFE — geen externe surface, alleen console-log/warn. Defer naar
// __bootScenePromise zodat WORLD_LIGHTING gegarandeerd geladen is (die
// staat in dezelfde script-batch maar load-order is veilig zo).
(function _weatherModBaselineCheck(){
  if(typeof window === 'undefined') return;
  function run(){
    if(!window.WORLD_LIGHTING) {
      console.warn('WEATHER_MOD baseline check: WORLD_LIGHTING niet geladen, skip');
      return;
    }
    const gp = window.WORLD_LIGHTING.grandprix && window.WORLD_LIGHTING.grandprix.day;
    if(!gp || !gp.sun || !gp.amb || !gp.hemi || !gp.fog){
      console.warn('WEATHER_MOD baseline check: grandprix.day base incomplete, skip');
      return;
    }
    // Expected = huidige weather.js GP-fallback-absoluten (regels 130-172).
    // Sunset zet amb niet → expected = clear-baseline = 0.50.
    const EXP = {
      clear:  { sun: 1.65, amb: 0.50, hemi: 0.36, fogDensity: 0.0021, fogColor: 0x8ac0e0 },
      fog:    { sun: 0.30, amb: 0.35, hemi: 0.20, fogDensity: 0.012,  fogColor: 0x889988 },
      sunset: { sun: 1.20, amb: 0.50, hemi: 0.50, fogDensity: 0.0021, fogColor: 0xdd8855 },
      storm:  { sun: 0.25, amb: 0.18, hemi: 0.12, fogDensity: 0.006,  fogColor: 0x223322 },
      snow:   { sun: 0.60, amb: 0.55, hemi: 0.45, fogDensity: 0.0045, fogColor: 0xbbccdd },
    };
    const EPS = 1e-9;
    let match = 0, fail = 0;
    Object.keys(EXP).forEach(function(mode){
      const e = EXP[mode], m = WEATHER_MOD[mode];
      if(!m){ console.warn('WEATHER_MOD baseline: missing mode '+mode); fail += 5; return; }
      const calc = {
        sun:        gp.sun.intensity  * (m.sun  && m.sun.mul  !== undefined ? m.sun.mul  : 1),
        amb:        gp.amb.intensity  * (m.amb  && m.amb.mul  !== undefined ? m.amb.mul  : 1),
        hemi:       gp.hemi.intensity * (m.hemi && m.hemi.mul !== undefined ? m.hemi.mul : 1),
        fogDensity: gp.fog.density    + (m.fog  && m.fog.addDensity         !== undefined ? m.fog.addDensity : 0),
        fogColor:   (m.fog && m.fog.color !== undefined) ? m.fog.color : null,
      };
      ['sun','amb','hemi','fogDensity'].forEach(function(k){
        if(Math.abs(calc[k] - e[k]) < EPS) match++;
        else {
          fail++;
          console.warn('WEATHER_MOD['+mode+'].'+k+' drift: calc='+calc[k].toFixed(6)+' expected='+e[k].toFixed(6));
        }
      });
      if(calc.fogColor === e.fogColor) match++;
      else {
        fail++;
        const _h = function(n){ return n == null ? 'null' : ('0x'+n.toString(16).padStart(6,'0')); };
        console.warn('WEATHER_MOD['+mode+'].fogColor drift: calc='+_h(calc.fogColor)+' expected='+_h(e.fogColor));
      }
    });
    const _tag = fail === 0 ? 'OK' : 'FAIL';
    console.log('[' + _tag + '] WEATHER_MOD baseline check: '+match+'/'+(match+fail)+' velden match (5 modes × 5 velden)');
  }
  // Defer tot scene built (zodat WORLD_LIGHTING + grandprix-base zeker
  // geladen zijn). Bij ontbreken __bootScenePromise: fallback op
  // DOMContentLoaded + microtask.
  if(window.__bootScenePromise && typeof window.__bootScenePromise.then === 'function'){
    window.__bootScenePromise.then(run).catch(function(){ /* skip on error */ });
  } else if(document.readyState === 'complete' || document.readyState === 'interactive'){
    Promise.resolve().then(run);
  } else {
    window.addEventListener('DOMContentLoaded', function(){ Promise.resolve().then(run); }, { once: true });
  }
})();
