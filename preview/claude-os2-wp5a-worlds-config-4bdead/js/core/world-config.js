// js/core/world-config.js — centrale WORLDS-registry (non-module script).
//
// Eén data-gedreven rij per wereld voor alle per-wereld-configuratie die
// voorheen als losse lookup-tabellen door de codebase verspreid lag
// (WP5a, 2026-08-28 — zie docs/plannen/os2-wp5a-worlds-config.md en D19).
// Nieuwe wereld toevoegen = één rij hier + registratie in data/tracks.json.
//
// Geladen direct ná js/config.js, vóór álle consumers (track, ramps,
// collectibles, physics, environment, postfx, scene). ES modules (audio/
// persistence) lezen uitsluitend lazy via window.WORLDS — nooit op
// module-evaluatietijd (modules evalueren vóór dit script).
//
// FORMATTERINGSCONTRACT — load-bearing voor
// docs/scripts/per-world-fallthrough-audit.sh (P16): een wereld-rij opent
// met `  <world>: {` op eigen regel (indent 2), sluit met `  },` op
// indent 2 (óók de laatste rij — trailing comma verplicht), en elk veld
// staat op eigen regel op indent 4 als `<veld>: …`. Geen formatter over
// dit bestand halen; wie de indeling wijzigt, wijzigt het audit-script mee.
//
// INVARIANT gp-rij: de gp-rij is de defensieve fallback voor onbekende
// wereld-keys (D5/P10-continuïteit; `activeWorld` is nooit 'gp') en bevat
// UITSLUITEND `track` + `trackMat` — de enige tabellen die historisch een
// gp-fallback-rij hadden. Nooit andere velden toevoegen: elk extra veld
// verandert stilletjes het onbekende-wereld-pad van de betreffende
// consumer (die vallen per veld terug op hun eigen bestaande vangnet).
//
// Herkomst-annotaties (// js/…:regel) wijzen naar de bron-locatie op het
// moment van migratie. Waarden zijn letterlijk gekopieerd — nul
// gedragswijziging.
//
// Veld-schema's:
//   track        — { asphalt, kerbA:[r,g,b], kerbB:[r,g,b], kerbEmissive,
//                    kerbEmissiveInt, gantryAccent, gantryEmissive,
//                    lanes?, laneColor?, wetness?, pbrTrack? } — de
//                    optionele velden bestaan alleen waar de bron ze had;
//                    afwezigheid ís het gedrag (default {lanes:0,wetness:0}).
//   trackMat     — { roughness, metalness, envMul, normalStr } (PBR asphalt)
//   gantryCol    — css-hex string, gantry-LED-tekstkleur
//   gantryName   — display-naam op het gantry-LED-board
//   spinPads     — { disc, emit, ring, cone, marker } (cone/marker
//                    momenteel ongelezen — bewust 1-op-1 meeverhuisd)
//   boostPads    — { pad, emit, chev, glow, light }
//   jumpRamp     — { pad, emit, stripe } — SPARSE: alleen werelden met
//                    eigen jump-ramp-kleuren; afwezig = consumer-default
//                    (oranje 0xff4400/0xff7722/0xffdd00 in ramps.js)
//   collectibles — { coin, emit, rim, halo, light }
//   surface      — tire-surface-tag string uit {metal, water, sand, ice,
//                    asphalt, dirt}; consumers vallen zonder rij-waarde
//                    terug op 'asphalt'
//   silhouette   — { far:[lowColor, highColor, jaggedness, opacity, height],
//                    near:[…zelfde 5…] } — afwezig voor space (void-wereld,
//                    geen horizon); zonder veld rendert de fallback-pad in
//                    environment.js alleen bij geladen mountains-textures
//   offtrackOverride — SPARSE (D13): alleen werelden met stilistische
//                    off-track-copy die afwijkt van het surface-profiel;
//                    { friction, label, color, chance }. Afwezigheid is het
//                    contract — physics valt terug op het per-surface-
//                    profiel. NIET aanvullen tot 8 rijen.
//   grading      — positionele array van 10 floats voor setWorldGrading:
//                    [tint_r, tint_g, tint_b, gradeAmount, vignette,
//                     liftR, liftG, liftB, saturation, hueShift]
//                    (hueShift in radianen, ~±0.15 max)

'use strict';

var WORLDS = {
  // gp — defensieve fallback-rij (zie INVARIANT hierboven).
  gp: {
    track: { asphalt:0x262626, kerbA:[.82,.07,.03], kerbB:[1,1,1], kerbEmissive:0x661111, kerbEmissiveInt:.30, gantryAccent:0x441166, gantryEmissive:0x6622cc },  // js/track/track.js:113
    trackMat: { roughness: 0.55, metalness: 0.20, envMul: 0.80, normalStr: 0.30 },  // js/track/track.js:150
  },
  space: {
    track: { asphalt:0x141420, kerbA:[0,.9,.9], kerbB:[.7,0,.9], kerbEmissive:0x4422aa, kerbEmissiveInt:.70, gantryAccent:0x4422aa, gantryEmissive:0x3311cc },  // js/track/track.js:114
    trackMat: { roughness: 0.40, metalness: 0.50, envMul: 1.20, normalStr: 0.30 },  // js/track/track.js:154
    gantryCol: '#8866ff',  // js/track/track.js:678
    gantryName: 'COSMIC CIRCUIT',  // js/track/track.js:698
    spinPads: { disc:0x0033cc, emit:0x001188, ring:0x00aaff, cone:0x8866ff, marker:0x4422cc },  // js/track/ramps.js:101
    boostPads: { pad:0xcc00ff, emit:0x8800cc, chev:0xffccff, glow:0xff88ff, light:0xff44ff },  // js/track/ramps.js:181
    jumpRamp: { pad:0x6600cc, emit:0x8833ff, stripe:0x00ccff },  // js/track/ramps.js:32-34
    collectibles: { coin:0x66ccff, emit:0x2288ff, rim:0xcce8ff, halo:0x66aaff, light:0x88bbff },  // js/track/collectibles.js:22
    surface: 'metal',  // js/audio/samples.js:100
    // Geen silhouette-veld: void-wereld zonder horizon.
    // Cool deep-space lift met cyan hue-pull, mild saturation boost.
    grading: [0.85, 0.92, 1.18, 0.18, 0.55,  0.00, 0.02, 0.06, 1.12, -0.04],  // js/effects/postfx.js:328
  },
  deepsea: {
    track: { asphalt:0x1a2830, kerbA:[0,.9,.7], kerbB:[0,.5,1], kerbEmissive:0x0a4a4a, kerbEmissiveInt:.85, gantryAccent:0x006688, gantryEmissive:0x00aacc },  // js/track/track.js:115
    trackMat: { roughness: 0.35, metalness: 0.45, envMul: 1.50, normalStr: 0.40 },  // js/track/track.js:155
    gantryCol: '#00ddcc',  // js/track/track.js:678
    gantryName: 'DEEP SEA CIRCUIT',  // js/track/track.js:698
    spinPads: { disc:0x005566, emit:0x003344, ring:0x00ddcc, cone:0x44ffcc, marker:0x00aa88 },  // js/track/ramps.js:102
    boostPads: { pad:0x00cc88, emit:0x007744, chev:0xaaffdd, glow:0x00ffaa, light:0x00ffaa },  // js/track/ramps.js:182
    jumpRamp: { pad:0x006644, emit:0x00aacc, stripe:0x00ffaa },  // js/track/ramps.js:32-34
    collectibles: { coin:0xffaa33, emit:0xcc7700, rim:0xffd999, halo:0xffaa00, light:0xffaa44 },  // js/track/collectibles.js:23
    surface: 'water',  // js/audio/samples.js:101
    // Donker "abyssal" silhouet, ver weg en laag opacity — de fog-density
    // geeft alleen de hint dat er iets in de verte is (Phase 11C).
    silhouette: { far:['#001144','#002255',0.08, 0.70, 190], near:['#00091a','#001133',0.12, 0.85, 120] },  // js/track/environment.js:245
    // Cyaan lift, boosted saturation + lichte cyan rotatie voor bioluminescent pop.
    grading: [0.78, 1.05, 1.12, 0.20, 0.65,  0.00, 0.03, 0.07, 1.18, -0.06],  // js/effects/postfx.js:330
  },
  candy: {
    track: { asphalt:0x3a2a55, kerbA:[1,1,1], kerbB:[.08,.06,.12], kerbEmissive:0x442266, kerbEmissiveInt:.35, gantryAccent:0x441166, gantryEmissive:0x6622cc, lanes:3, laneColor:'#ffffff' },  // js/track/track.js:116
    trackMat: { roughness: 0.42, metalness: 0.15, envMul: 1.25, normalStr: 0.35 },  // js/track/track.js:151
    gantryCol: '#ff66cc',  // js/track/track.js:678
    gantryName: 'CANDY KINGDOM',  // js/track/track.js:698
    spinPads: { disc:0xff3388, emit:0xcc0066, ring:0xff66bb, cone:0xffdd44, marker:0xffaa00 },  // js/track/ramps.js:103
    boostPads: { pad:0xff55aa, emit:0xcc2277, chev:0xffddee, glow:0xff88cc, light:0xff66bb },  // js/track/ramps.js:183
    collectibles: { coin:0xff77cc, emit:0xdd2288, rim:0xffddf0, halo:0xff55aa, light:0xff66cc },  // js/track/collectibles.js:24
    surface: 'asphalt',  // js/audio/samples.js:102
    // Lichte pastel-roze horizon — "candy land sky" i.p.v. mountains-in-mist
    // (Phase 11C).
    silhouette: { far:['#ffccee','#ff99dd',0.25, 0.50, 230], near:['#ff88cc','#ff55bb',0.35, 0.72, 150] },  // js/track/environment.js:251
    // Handgekozen sticky-frosting callout: .22 frictie + eigen emoji-label.
    offtrackOverride: { friction:0.22, label:'FROSTING! 🧁', color:'#ff66aa', chance:0.05 },  // js/cars/physics.js:35
    // Verlaten pretpark V2 (grim contrast): koel teal-blauw tint, stevige
    // vignette voor tunnel-feel, saturation hard omlaag (omgeving
    // desaturated; bloomed bronnen behouden kleur via bloom-additive),
    // lift negatief (zwart-niveau omlaag), hueShift naar cyan.
    grading: [0.85, 0.92, 1.08, 0.24, 0.82, -0.04,-0.04,-0.04, 0.55, -0.05],  // js/effects/postfx.js:338
  },
  volcano: {
    // Asphalt bewust near-black (0x0c0908, was 0x2a0808) — eigenaar-feedback
    // 2026-05-08: baan las als scharlaken i.p.v. vulkanisch gesteente. De
    // lava-warmte zit in props (lava-rivers, kerb-emissive, hero-kegel).
    track: { asphalt:0x0c0908, kerbA:[.82,.07,.03], kerbB:[1,1,1], kerbEmissive:0xff3300, kerbEmissiveInt:.55, gantryAccent:0x441166, gantryEmissive:0x6622cc },  // js/track/track.js:122
    trackMat: { roughness: 0.45, metalness: 0.20, envMul: 1.00, normalStr: 0.40 },  // js/track/track.js:153
    gantryCol: '#ff6622',  // js/track/track.js:679
    gantryName: 'VOLCANO RUSH',  // js/track/track.js:699
    spinPads: { disc:0xaa3300, emit:0x661100, ring:0xff6622, cone:0xff9922, marker:0xcc2200 },  // js/track/ramps.js:104
    boostPads: { pad:0xff5522, emit:0xdd2200, chev:0xffdd99, glow:0xff8844, light:0xff4422 },  // js/track/ramps.js:184
    collectibles: { coin:0xff7722, emit:0xff2200, rim:0xffcc88, halo:0xff4411, light:0xff4422 },  // js/track/collectibles.js:25
    surface: 'sand',  // js/audio/samples.js:103
    // Diepe roest-silhouetten ver achter de lava-rivers — verre ruggen
    // bijna verloren in ember-haze.
    silhouette: { far:['#1a0608','#3a1010',0.65, 0.72, 100], near:['#080202','#1a0408',0.95, 0.86,  78] },  // js/track/environment.js:233
    // Warm ember-lift, strong saturation voor lava glow, hue naar oranje.
    grading: [1.22, 0.90, 0.75, 0.18, 0.55,  0.05, 0.01, 0.00, 1.25,  0.04],  // js/effects/postfx.js:340
  },
  arctic: {
    track: { asphalt:0x667788, kerbA:[.82,.07,.03], kerbB:[1,1,1], kerbEmissive:0x4488dd, kerbEmissiveInt:.45, gantryAccent:0x441166, gantryEmissive:0x6622cc },  // js/track/track.js:123
    trackMat: { roughness: 0.30, metalness: 0.30, envMul: 1.40, normalStr: 0.40 },  // js/track/track.js:152
    gantryCol: '#88ccff',  // js/track/track.js:680
    gantryName: 'ARCTIC PEAKS',  // js/track/track.js:699
    spinPads: { disc:0x336699, emit:0x113366, ring:0x66ccff, cone:0xbbeeff, marker:0x4488cc },  // js/track/ramps.js:105
    boostPads: { pad:0x66ddff, emit:0x2288cc, chev:0xe8f5ff, glow:0x99ddff, light:0x88ccff },  // js/track/ramps.js:185
    collectibles: { coin:0xaadfff, emit:0x4488dd, rim:0xe8f5ff, halo:0x88bbee, light:0xaaddff },  // js/track/collectibles.js:26
    surface: 'ice',  // js/audio/samples.js:104
    // Koude mistige bergen; beide lagen licht zodat ze met de sneeuw blenden.
    silhouette: { far:['#7a8aa6','#b4c2d8',0.50, 0.85, 110], near:['#3a4a64','#6678a0',0.75, 0.94,  82] },  // js/track/environment.js:238
    // Cool blue lift voor arctic, lichte saturation; hue iets cooler.
    grading: [0.90, 1.00, 1.20, 0.16, 0.50,  0.00, 0.02, 0.05, 1.10, -0.03],  // js/effects/postfx.js:342
  },
  sandstorm: {
    track: { asphalt:0x6a4a2e, kerbA:[.79,.45,.20], kerbB:[.95,.85,.62], kerbEmissive:0xc97232, kerbEmissiveInt:.40, gantryAccent:0x441166, gantryEmissive:0x6622cc },  // js/track/track.js:124
    trackMat: { roughness: 0.70, metalness: 0.08, envMul: 0.60, normalStr: 0.50 },  // js/track/track.js:158
    // Warm zand-oranje — zonder deze waarde valt de gantry-tekst terug op
    // magenta '#cc66ff'.
    gantryCol: '#ffa040',  // js/track/track.js:682
    gantryName: 'SANDSTORM CANYON',  // js/track/track.js:700
    spinPads: { disc:0x8b4a25, emit:0x5a2818, ring:0xff8c42, cone:0xd4a55a, marker:0xc97232 },  // js/track/ramps.js:106
    boostPads: { pad:0xff8c42, emit:0xcc4a18, chev:0xffe4a8, glow:0xff9c52, light:0xff8c42 },  // js/track/ramps.js:186
    jumpRamp: { pad:0xcc6622, emit:0xff8833, stripe:0xffd870 },  // js/track/ramps.js:32-34
    collectibles: { coin:0xff8c42, emit:0xc97232, rim:0xffe4a8, halo:0xff9c52, light:0xffaa66 },  // js/track/collectibles.js:31
    surface: 'sand',  // js/audio/samples.js:105
    // Roest/oranje canyon-ruggen die in warme haze (#e8b878) oplossen; hoge
    // jaggedness voor het scherpe mesa-profiel van zuidwest-woestijn.
    silhouette: { far:['#a86839','#d49060',0.85, 0.78, 110], near:['#5a2818','#8b3a1d',1.05, 0.90,  82] },  // js/track/environment.js:260
    // Sahara warmth, natuurlijke zand-kleur behouden met subtle oranje hue.
    grading: [1.12, 1.00, 0.88, 0.12, 0.45,  0.03, 0.01, 0.00, 1.08,  0.03],  // js/effects/postfx.js:344
  },
  pier47: {
    // Industriële havennacht: near-black asfalt voor de wet-look, roest-
    // oranje + vervaagd waarschuwingsgeel op de kerbs, sodium-lamp-tint
    // (#ff8830) als emissive. pbrTrack + lanes 2 + wetness 0.6 (Phase 2
    // graphics-upgrade): gebakken lane-markings + wetness-streaks.
    track: { asphalt:0x1a1a1e, kerbA:[.627,.251,.125], kerbB:[.667,.627,.188], kerbEmissive:0xff8830, kerbEmissiveInt:.45, gantryAccent:0xa04020, gantryEmissive:0xff8830, pbrTrack:true, lanes:2, wetness:0.6 },  // js/track/track.js:134
    trackMat: { roughness: 0.24, metalness: 0.62, envMul: 2.00, normalStr: 0.55 },  // js/track/track.js:156
    // Sodium-amber, matcht het lamp-anker (#ff8830) in js/worlds/pier47.js.
    gantryCol: '#ff8830',  // js/track/track.js:684
    gantryName: 'PIER 47',  // js/track/track.js:701
    // Zonder deze rij valt de lookup terug op de space-rij (#0033cc koud
    // blauw) — vloekt met het warme overcast-havenpalet.
    spinPads: { disc:0xa04020, emit:0x661511, ring:0xff8830, cone:0xffaa44, marker:0xa04020 },  // js/track/ramps.js:111
    boostPads: { pad:0xff8830, emit:0xa04020, chev:0xffcc88, glow:0xffaa44, light:0xff8830 },  // js/track/ramps.js:190
    collectibles: { coin:0xff8830, emit:0xa04020, rim:0xffcc88, halo:0xffaa44, light:0xff9933 },  // js/track/collectibles.js:35
    surface: 'asphalt',  // js/audio/samples.js:106
    // Industriële haven-skyline: container-stapels, loodsen en kranen als
    // vrijwel zwarte silhouetten tegen de city-glow; hoge jaggedness voor
    // het rechthoekige machinerie-profiel.
    silhouette: { far:['#0a0812','#1a1422',1.10, 0.85,  78], near:['#040206','#0a0812',1.35, 0.95,  60] },  // js/track/environment.js:270
    // Off-track = kade-rand gravel/spillage. Sodium-oranje popup (#ff8830)
    // matcht de gloeiende kerbs; frictie blijft op de asphalt-baseline .18 —
    // alleen copy + kleur wijken af.
    offtrackOverride: { friction:0.18, label:'OFF DOCK!', color:'#ff8830', chance:0.04 },  // js/cars/physics.js:41
    // Cool desaturated film-look, koele blauwgrijze shadow-push, hue naar
    // teal voor industriële night-mood.
    grading: [0.98, 0.92, 0.98, 0.18, 0.65,  0.00, 0.02, 0.04, 0.92, -0.05],  // js/effects/postfx.js:347
  },
  guangzhou: {
    // Cyberpunk-regen: nat donker asfalt (#0a0c12), kerbA magenta + kerbB
    // cyaan + hot-magenta emissive (#ff2080) op .85 zodat kerbs gloeien
    // tegen near-black. pbrTrack + lanes 2 + wetness 0.7 (Phase 2).
    track: { asphalt:0x0a0c12, kerbA:[1.0,0.13,0.50], kerbB:[0.0,0.88,1.0], kerbEmissive:0xff2080, kerbEmissiveInt:.85, gantryAccent:0xff2080, gantryEmissive:0x00e0ff, pbrTrack:true, lanes:2, wetness:0.7 },  // js/track/track.js:142
    trackMat: { roughness: 0.22, metalness: 0.70, envMul: 2.20, normalStr: 0.50 },  // js/track/track.js:157
    // Neon-magenta, matcht kerbEmissive (#ff2080).
    gantryCol: '#ff2080',  // js/track/track.js:686
    gantryName: 'GUANGZHOU NIGHT GP',  // js/track/track.js:702
    spinPads: { disc:0xaa1050, emit:0x660830, ring:0xff2080, cone:0x00e0ff, marker:0xff2080 },  // js/track/ramps.js:115
    boostPads: { pad:0xff2080, emit:0xaa1050, chev:0x00e0ff, glow:0xff60a0, light:0xff2080 },  // js/track/ramps.js:194
    collectibles: { coin:0xff2080, emit:0xaa1050, rim:0xff80c0, halo:0xff40a0, light:0xff2080 },  // js/track/collectibles.js:39
    surface: 'asphalt',  // js/audio/samples.js:109 — wet asphalt boulevard, zelfde tyre-sound als pier47
    // CBD-hoogbouw als donkere paars-zwarte silhouetten, backlit door de
    // neon city-glow; jaggedness hoger dan pier47 voor gevarieerde
    // torenhoogtes. Window-emissives bewust uitgesteld (V2).
    silhouette: { far:['#0a0814','#1a1428', 0.85, 0.82, 130], near:['#0e0a18','#14101e', 1.10, 0.92,  95] },  // js/track/environment.js:282
    // Off-track = natte urban kerb/stoeprand; neon-magenta popup (#ff2080)
    // matcht kerbEmissive; frictie .18, surface blijft asphalt.
    offtrackOverride: { friction:0.18, label:'OFF GRID!', color:'#ff2080', chance:0.04 },  // js/cars/physics.js:45
    // Cool blue-purple urban neon, donkerpaars shadows, hue naar cyan-teal
    // voor cold cyberpunk.
    grading: [0.88, 0.86, 1.18, 0.20, 0.68,  0.02, 0.00, 0.05, 1.18, -0.06],  // js/effects/postfx.js:350
  },
};

// Rij-lookup met defensieve fallback naar de gp-rij (D5/P10-patroon).
// Consumers houden daarbovenop hun eigen per-veld-vangnet, zodat het
// gedrag voor onbekende wereld-keys bit-identiek is aan de oude
// per-tabel-fallbacks.
function getWorldConfig(w){ return WORLDS[w] || WORLDS.gp; }

if (typeof window !== 'undefined'){
  window.WORLDS = WORLDS;
  window.getWorldConfig = getWorldConfig;
}
