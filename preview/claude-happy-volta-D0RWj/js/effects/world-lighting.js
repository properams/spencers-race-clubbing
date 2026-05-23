// js/effects/world-lighting.js — non-module script.
//
// Data-only tabel met per-wereld lighting-config voor day en night.
// Waardes 1-op-1 overgenomen uit js/effects/night.js (zie regel-refs
// per veld). Deze module wordt nog NIET gebruikt door de runtime —
// alleen geladen om de console-assert onderaan te triggeren die
// divergentie tussen tabel en huidige hardcoded waardes detecteert.
//
// Out of scope: applyLighting(), wereld-extras (jellyfish, candles,
// trackPoles, stars, dsaBioEdges, sunBillboard, candyNightEmissives),
// sun.color overrides (neoncity day: 0x441122, arctic day: 0xaaccff),
// hemi.intensity voor arctic (night.js raakt het niet aan),
// volcano sky/fog (worden in buildVolcanoEnvironment gezet).

'use strict';

// ── DATA-TABEL ──────────────────────────────────────────────────────
// Velden die in night.js voor een gegeven (wereld, modus) NIET gezet
// worden, zijn hier weggelaten (i.p.v. null). Dat dekt o.a.
// arctic.{day,night}.hemi, volcano.{day,night}.{sky,fog} en
// neoncity.day.trackLights netjes af.

const WORLD_LIGHTING = {
  deepsea: {
    night: {
      sky:         { top: '#000810', bot: '#00101a' }, // night.js:12
      fog:         { density: 0.0022 },                // night.js:12
      sun:         { intensity: 0.05 },                // night.js:13
      amb:         { intensity: 0.12 },                // night.js:13
      hemi:        { intensity: 0.08 },                // night.js:13
      trackLights: { mode: 'set', value: 1.6 },        // night.js:14
      headlights:  { front: 2.2, tail: 1.6 },          // night.js:26-27
      aiHead:      1.4,                                // night.js:28
    },
    day: {
      sky:         { top: '#001825', bot: '#003355' }, // night.js:19
      fog:         { density: 0.0014 },                // night.js:19
      sun:         { intensity: 0.45 },                // night.js:20
      amb:         { intensity: 0.55 },                // night.js:20
      hemi:        { intensity: 0.30 },                // night.js:20
      trackLights: { mode: 'set', value: 0 },          // night.js:21
      headlights:  { front: 0, tail: 0 },              // night.js:26-27
      aiHead:      0,                                  // night.js:28
    },
  },

  neoncity: {
    night: {
      sky:         { top: '#000008', bot: '#030012' }, // night.js:33
      fog:         { density: 0.0018 },                // night.js:33
      sun:         { intensity: 0.02 },                // night.js:34
      amb:         { intensity: 0.15 },                // night.js:34
      hemi:        { intensity: 0.10 },                // night.js:34
      trackLights: { mode: 'multiply', factor: 1.3, max: 4.5 }, // night.js:35
      headlights:  { front: 2.8, tail: 2.0 },          // night.js:42-43 (buiten if/else)
      aiHead:      1.8,                                // night.js:44 (buiten if/else)
    },
    day: {
      sky:         { top: '#040015', bot: '#080025' }, // night.js:37
      fog:         { density: 0.0012 },                // night.js:37
      sun:         { intensity: 0.08 },                // night.js:38
      amb:         { intensity: 0.22 },                // night.js:39
      hemi:        { intensity: 0.18 },                // night.js:39
      // trackLights weggelaten — neoncity day-pad raakt trackLightList niet aan
      headlights:  { front: 2.8, tail: 2.0 },          // night.js:42-43 (buiten if/else)
      aiHead:      1.8,                                // night.js:44 (buiten if/else)
    },
  },

  arctic: {
    night: {
      sky:         { top: '#040c18', bot: '#0a1828' }, // night.js:47
      fog:         { density: 0.005 },                 // night.js:47
      sun:         { intensity: 0.04 },                // night.js:48
      amb:         { intensity: 0.12 },                // night.js:48
      // hemi weggelaten — arctic raakt hemiLight niet aan (blijft buildScene-default)
      trackLights: { mode: 'set', value: 1.4 },        // night.js:48
      headlights:  { front: 2.6, tail: 1.6 },          // night.js:53-54
      aiHead:      1.5,                                // night.js:55
    },
    day: {
      sky:         { top: '#0a1525', bot: '#1a3050' }, // night.js:49
      fog:         { density: 0.0035 },                // night.js:49
      sun:         { intensity: 0.8 },                 // night.js:50
      amb:         { intensity: 0.45 },                // night.js:50
      // hemi weggelaten
      trackLights: { mode: 'set', value: 0 },          // night.js:50
      headlights:  { front: 0, tail: 0 },              // night.js:53-54
      aiHead:      0,                                  // night.js:55
    },
  },

  volcano: {
    night: {
      // sky + fog weggelaten — volcano zet ze in buildVolcanoEnvironment
      sun:         { intensity: 0.04 },                // night.js:58
      amb:         { intensity: 0.12 },                // night.js:58
      hemi:        { intensity: 0.08 },                // night.js:58
      trackLights: { mode: 'set', value: 1.8 },        // night.js:60
      headlights:  { front: 2.8, tail: 2.0 },          // night.js:61-62
      aiHead:      1.8,                                // night.js:63
    },
    day: {
      // sky + fog weggelaten
      sun:         { intensity: 0.7 },                 // night.js:58
      amb:         { intensity: 0.35 },                // night.js:58
      hemi:        { intensity: 0.25 },                // night.js:58
      trackLights: { mode: 'set', value: 0 },          // night.js:60
      headlights:  { front: 0, tail: 0 },              // night.js:61-62
      aiHead:      0,                                  // night.js:63
    },
  },

  candy: {
    night: {
      sky:         { top: '#1a0028', bot: '#280038' }, // night.js:68
      fog:         { density: 0.0012 },                // night.js:68
      sun:         { intensity: 0.06 },                // night.js:69
      amb:         { intensity: 0.18 },                // night.js:69
      hemi:        { intensity: 0.12 },                // night.js:69
      trackLights: { mode: 'set', value: 2.2 },        // night.js:70
      headlights:  { front: 2.4, tail: 1.6 },          // night.js:73-74
      aiHead:      1.5,                                // night.js:75
    },
    day: {
      sky:         { top: '#2e1842', bot: '#6a3a5a' }, // night.js:77
      fog:         { density: 0.00105 },               // night.js:77
      sun:         { intensity: 0.55 },                // night.js:78
      amb:         { intensity: 0.40 },                // night.js:78
      hemi:        { intensity: 0.28 },                // night.js:78
      trackLights: { mode: 'set', value: 0 },          // night.js:79
      headlights:  { front: 0, tail: 0 },              // night.js:82-83
      aiHead:      0,                                  // night.js:84
    },
  },

  space: {
    night: {
      sky:         { top: '#000005', bot: '#010018' }, // night.js:90
      fog:         { density: 0.0008 },                // night.js:90
      sun:         { intensity: 0.04 },                // night.js:91
      amb:         { intensity: 0.14 },                // night.js:91
      hemi:        { intensity: 0.10 },                // night.js:91
      trackLights: { mode: 'set', value: 2.0 },        // night.js:97
      headlights:  { front: 2.6, tail: 1.8 },          // night.js:99-100 (buiten if/else)
      aiHead:      1.7,                                // night.js:101 (buiten if/else)
    },
    day: {
      sky:         { top: '#040025', bot: '#080045' }, // night.js:93
      fog:         { density: 0.0005 },                // night.js:93
      sun:         { intensity: 0.10 },                // night.js:94
      amb:         { intensity: 0.28 },                // night.js:94
      hemi:        { intensity: 0.18 },                // night.js:94
      trackLights: { mode: 'set', value: 1.4 },        // night.js:97
      headlights:  { front: 2.6, tail: 1.8 },          // night.js:99-100 (buiten if/else)
      aiHead:      1.7,                                // night.js:101 (buiten if/else)
    },
  },

  grandprix: {
    night: {
      sky:         { top: '#010408', bot: '#030d1e' }, // night.js:104
      fog:         { density: 0.0035 },                // night.js:104
      sun:         { intensity: 0.04 },                // night.js:105
      amb:         { intensity: 0.10 },                // night.js:105
      hemi:        { intensity: 0.07 },                // night.js:105
      trackLights: { mode: 'set', value: 2.8 },        // night.js:106
      headlights:  { front: 2.6, tail: 1.8 },          // night.js:107
      aiHead:      1.7,                                // night.js:108
    },
    day: {
      sky:         { top: '#1e5292', bot: '#b8d8ee' }, // night.js:110
      fog:         { density: 0.0011 },                // night.js:110
      sun:         { intensity: 1.65 },                // night.js:111
      amb:         { intensity: 0.50 },                // night.js:111
      hemi:        { intensity: 0.36 },                // night.js:111
      trackLights: { mode: 'set', value: 0 },          // night.js:112
      headlights:  { front: 0, tail: 0 },              // night.js:113
      aiHead:      0,                                  // night.js:114
    },
  },

  // default = grandprix (night.js valt voor onbekende werelden in dezelfde
  // else-tak, regels 102-115). Hier expliciet als aparte entry zodat
  // applyLighting() in fase 2 een eenvoudige lookup kan doen.
  default: {
    night: {
      sky:         { top: '#010408', bot: '#030d1e' },
      fog:         { density: 0.0035 },
      sun:         { intensity: 0.04 },
      amb:         { intensity: 0.10 },
      hemi:        { intensity: 0.07 },
      trackLights: { mode: 'set', value: 2.8 },
      headlights:  { front: 2.6, tail: 1.8 },
      aiHead:      1.7,
    },
    day: {
      sky:         { top: '#1e5292', bot: '#b8d8ee' },
      fog:         { density: 0.0011 },
      sun:         { intensity: 1.65 },
      amb:         { intensity: 0.50 },
      hemi:        { intensity: 0.36 },
      trackLights: { mode: 'set', value: 0 },
      headlights:  { front: 0, tail: 0 },
      aiHead:      0,
    },
  },
};

// Maak globally beschikbaar voor latere modules (fase 2: applyLighting).
if (typeof window !== 'undefined') window.WORLD_LIGHTING = WORLD_LIGHTING;

// ── CONSOLE-ASSERT ──────────────────────────────────────────────────
// Tweede bron-van-waarheid met dezelfde waardes, runtime vergeleken.
// Doel: drift tussen tabel en night.js detecteren voordat fase 2
// hem aansluit. Zodra applyLighting() de tabel echt gebruikt
// (fase 2), kan EXPECTED + verifyWorldLightingTable() weg.

const _WORLD_LIGHTING_EXPECTED = {
  deepsea: {
    night: { sky:{top:'#000810',bot:'#00101a'}, fog:{density:0.0022}, sun:{intensity:0.05}, amb:{intensity:0.12}, hemi:{intensity:0.08}, trackLights:{mode:'set',value:1.6},      headlights:{front:2.2,tail:1.6}, aiHead:1.4 },
    day:   { sky:{top:'#001825',bot:'#003355'}, fog:{density:0.0014}, sun:{intensity:0.45}, amb:{intensity:0.55}, hemi:{intensity:0.30}, trackLights:{mode:'set',value:0},        headlights:{front:0,  tail:0},   aiHead:0   },
  },
  neoncity: {
    night: { sky:{top:'#000008',bot:'#030012'}, fog:{density:0.0018}, sun:{intensity:0.02}, amb:{intensity:0.15}, hemi:{intensity:0.10}, trackLights:{mode:'multiply',factor:1.3,max:4.5}, headlights:{front:2.8,tail:2.0}, aiHead:1.8 },
    day:   { sky:{top:'#040015',bot:'#080025'}, fog:{density:0.0012}, sun:{intensity:0.08}, amb:{intensity:0.22}, hemi:{intensity:0.18},                                                   headlights:{front:2.8,tail:2.0}, aiHead:1.8 },
  },
  arctic: {
    night: { sky:{top:'#040c18',bot:'#0a1828'}, fog:{density:0.005},  sun:{intensity:0.04}, amb:{intensity:0.12},                       trackLights:{mode:'set',value:1.4},      headlights:{front:2.6,tail:1.6}, aiHead:1.5 },
    day:   { sky:{top:'#0a1525',bot:'#1a3050'}, fog:{density:0.0035}, sun:{intensity:0.8},  amb:{intensity:0.45},                       trackLights:{mode:'set',value:0},        headlights:{front:0,  tail:0},   aiHead:0   },
  },
  volcano: {
    night: {                                                          sun:{intensity:0.04}, amb:{intensity:0.12}, hemi:{intensity:0.08}, trackLights:{mode:'set',value:1.8},      headlights:{front:2.8,tail:2.0}, aiHead:1.8 },
    day:   {                                                          sun:{intensity:0.7},  amb:{intensity:0.35}, hemi:{intensity:0.25}, trackLights:{mode:'set',value:0},        headlights:{front:0,  tail:0},   aiHead:0   },
  },
  candy: {
    night: { sky:{top:'#1a0028',bot:'#280038'}, fog:{density:0.0012}, sun:{intensity:0.06}, amb:{intensity:0.18}, hemi:{intensity:0.12}, trackLights:{mode:'set',value:2.2},      headlights:{front:2.4,tail:1.6}, aiHead:1.5 },
    day:   { sky:{top:'#2e1842',bot:'#6a3a5a'}, fog:{density:0.00105},sun:{intensity:0.55}, amb:{intensity:0.40}, hemi:{intensity:0.28}, trackLights:{mode:'set',value:0},        headlights:{front:0,  tail:0},   aiHead:0   },
  },
  space: {
    night: { sky:{top:'#000005',bot:'#010018'}, fog:{density:0.0008}, sun:{intensity:0.04}, amb:{intensity:0.14}, hemi:{intensity:0.10}, trackLights:{mode:'set',value:2.0},      headlights:{front:2.6,tail:1.8}, aiHead:1.7 },
    day:   { sky:{top:'#040025',bot:'#080045'}, fog:{density:0.0005}, sun:{intensity:0.10}, amb:{intensity:0.28}, hemi:{intensity:0.18}, trackLights:{mode:'set',value:1.4},      headlights:{front:2.6,tail:1.8}, aiHead:1.7 },
  },
  grandprix: {
    night: { sky:{top:'#010408',bot:'#030d1e'}, fog:{density:0.0035}, sun:{intensity:0.04}, amb:{intensity:0.10}, hemi:{intensity:0.07}, trackLights:{mode:'set',value:2.8},      headlights:{front:2.6,tail:1.8}, aiHead:1.7 },
    day:   { sky:{top:'#1e5292',bot:'#b8d8ee'}, fog:{density:0.0011}, sun:{intensity:1.65}, amb:{intensity:0.50}, hemi:{intensity:0.36}, trackLights:{mode:'set',value:0},        headlights:{front:0,  tail:0},   aiHead:0   },
  },
  default: {
    night: { sky:{top:'#010408',bot:'#030d1e'}, fog:{density:0.0035}, sun:{intensity:0.04}, amb:{intensity:0.10}, hemi:{intensity:0.07}, trackLights:{mode:'set',value:2.8},      headlights:{front:2.6,tail:1.8}, aiHead:1.7 },
    day:   { sky:{top:'#1e5292',bot:'#b8d8ee'}, fog:{density:0.0011}, sun:{intensity:1.65}, amb:{intensity:0.50}, hemi:{intensity:0.36}, trackLights:{mode:'set',value:0},        headlights:{front:0,  tail:0},   aiHead:0   },
  },
};

function _stableStringify(obj) {
  // Recursief sorteer object-keys, zodat JSON.stringify-vergelijking
  // niet afhangt van insertion-order. Number-keys + arrays blijven hun
  // index-volgorde behouden.
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(_stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify(obj[k])).join(',') + '}';
}

function _verifyWorldLightingTable() {
  const errors = [];
  const tableKeys = Object.keys(WORLD_LIGHTING).sort();
  const expectedKeys = Object.keys(_WORLD_LIGHTING_EXPECTED).sort();
  if (tableKeys.join(',') !== expectedKeys.join(',')) {
    errors.push('world-set mismatch: table=[' + tableKeys.join(',') + '] expected=[' + expectedKeys.join(',') + ']');
  }
  for (const world of expectedKeys) {
    for (const mode of ['day', 'night']) {
      const got = WORLD_LIGHTING[world] && WORLD_LIGHTING[world][mode];
      const exp = _WORLD_LIGHTING_EXPECTED[world] && _WORLD_LIGHTING_EXPECTED[world][mode];
      if (!got) { errors.push(world + '.' + mode + ': missing in table'); continue; }
      if (!exp) { errors.push(world + '.' + mode + ': missing in expected'); continue; }
      const gotS = _stableStringify(got);
      const expS = _stableStringify(exp);
      if (gotS !== expS) {
        errors.push(world + '.' + mode + ': mismatch\n    table   : ' + gotS + '\n    expected: ' + expS);
      }
    }
  }
  const worldCount = expectedKeys.length;
  if (errors.length) {
    console.error('[WORLD_LIGHTING] table verification FAILED (' + errors.length + ' issues):\n  ' + errors.join('\n  '));
  } else {
    console.log('[WORLD_LIGHTING] table OK: ' + worldCount + ' worlds × 2 modes verified');
  }
}

_verifyWorldLightingTable();
