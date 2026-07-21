// js/cars/car-parts.js — shared building blocks for brand-specific car builders.
// Non-module script. Loaded BEFORE js/cars/brands.js and js/cars/build.js.
//
// Goal: brand builders (e.g. buildFerrariSF90) produce a Group with a unique
// silhouette while sharing materials and wheel assembly. Reduces material churn
// (was 6 per car × 12 cars = 72 fresh; now ~6 shared + 1-2 per car).
//
// Shared materials live on _carShared. They are built lazily on first call to
// getSharedCarMats() and disposed via disposeSharedCarMats() (called from
// scene disposal — but they're light enough to outlive a session).

'use strict';

// PBR material helpers — Standard on desktop (so HDRI envMap reflections
// land on glass / chrome / paint), Lambert/Phong on mobile to keep
// fillrate budget. Both branches accept the same `color` argument plus
// optional `emissive` / `transparent` / `opacity`. Mobile path silently
// drops the PBR-only fields; the per-mesh appearance only differs in
// reflection sharpness and specular response.
function _carMat(opts){
  const o = opts || {};
  // _carPBR=true → carry-flag so asset-bridge can leave envMapIntensity
  // alone on car materials (their own setting takes precedence over the
  // 0.6 cap applied to other PBR meshes in the scene).
  if (window._isMobile){
    const lo = { color:o.color };
    if (o.transparent != null) lo.transparent = o.transparent;
    if (o.opacity != null)     lo.opacity = o.opacity;
    if (o.emissive != null)    lo.emissive = o.emissive;
    if (o.emissiveIntensity!=null) lo.emissiveIntensity = o.emissiveIntensity;
    if (o.map != null)         lo.map = o.map;
    return new THREE.MeshLambertMaterial(lo);
  }
  // Desktop: pak MeshPhysicalMaterial wanneer clearcoat/transmission of de
  // expliciete `physical: true` flag aanwezig zijn. Zonder die props valt
  // het terug op MeshStandardMaterial — identiek aan oud gedrag.
  const wantsPhysical = !!(o.physical || o.clearcoat != null || o.transmission != null);
  const params = {
    color: o.color,
    metalness: o.metalness != null ? o.metalness : 0.0,
    roughness: o.roughness != null ? o.roughness : 0.6,
    transparent: !!o.transparent,
    opacity: o.opacity != null ? o.opacity : 1.0,
    emissive: o.emissive != null ? o.emissive : 0x000000,
    emissiveIntensity: o.emissiveIntensity != null ? o.emissiveIntensity : 1.0,
    envMapIntensity: o.envMapIntensity != null ? o.envMapIntensity : 0.7,
  };
  if (o.map != null) params.map = o.map;
  if (wantsPhysical){
    if (o.clearcoat != null)          params.clearcoat = o.clearcoat;
    if (o.clearcoatRoughness != null) params.clearcoatRoughness = o.clearcoatRoughness;
    if (o.transmission != null)       params.transmission = o.transmission;
    if (o.thickness != null)          params.thickness = o.thickness;
    if (o.ior != null)                params.ior = o.ior;
  }
  const m = wantsPhysical
    ? new THREE.MeshPhysicalMaterial(params)
    : new THREE.MeshStandardMaterial(params);
  m.userData = m.userData || {};
  m.userData._carPBR = true;
  return m;
}

// Procedural carbon-weave diffuse texture. 256×256, herhalende 32-pixel
// cellen met diagonale gradient zodat het patroon "weven" leest. Eén keer
// gebouwd, daarna gedeeld door de carbon-material singleton in
// getSharedCarMats(). Flagged _sharedAsset zodat disposeScene 'm overslaat.
let _carbonTex = null;
function _makeCarbonWeaveTex(){
  if (_carbonTex) return _carbonTex;
  const W = 256, H = 256, CELL = 32;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1a1c'; g.fillRect(0, 0, W, H);
  // Twee alternerende cell-types met tegenovergestelde gradient-richting —
  // simuleert het over-en-onder weven van koolstofdraden.
  for (let y = 0; y < H; y += CELL){
    for (let x = 0; x < W; x += CELL){
      const isA = ((x/CELL + y/CELL) & 1) === 0;
      const grad = g.createLinearGradient(x, y, x + CELL, y + CELL);
      if (isA){
        grad.addColorStop(0,   '#2a2a2e');
        grad.addColorStop(0.5, '#1a1a1c');
        grad.addColorStop(1,   '#0e0e10');
      } else {
        grad.addColorStop(0,   '#0e0e10');
        grad.addColorStop(0.5, '#1a1a1c');
        grad.addColorStop(1,   '#2a2a2e');
      }
      g.fillStyle = grad;
      g.fillRect(x, y, CELL, CELL);
    }
  }
  _carbonTex = new THREE.CanvasTexture(c);
  _carbonTex.wrapS = THREE.RepeatWrapping;
  _carbonTex.wrapT = THREE.RepeatWrapping;
  _carbonTex.needsUpdate = true;
  _carbonTex.userData = { _sharedAsset: true };
  return _carbonTex;
}

let _carShared = null;
function getSharedCarMats(){
  if(_carShared) return _carShared;
  // Headlight registry rebuilds with the materials. Otherwise re-creating
  // _carShared would push a duplicate `head` reference each rebuild and
  // syncHeadlights would walk an ever-growing list.
  if(window._headlightMats) window._headlightMats.length = 0;
  _carShared = {
    // Glass: very low roughness so HDRI environment shows up as crisp
    // tinted reflection; transparent keeps interior visible.
    glass:    _carMat({color:0x0a1a2a, transparent:true, opacity:.72, metalness:0.0, roughness:0.05, envMapIntensity:0.85}),
    glassDark:_carMat({color:0x040810, transparent:true, opacity:.86, metalness:0.0, roughness:0.10, envMapIntensity:0.75}),
    // Chrome: full metallic, mirror-smooth → mirror reflection of envMap.
    // Clearcoat geeft de extra "vernis-laag" reflectie die echte chroom heeft.
    chrome:   _carMat({color:0xdddddd, metalness:1.0, roughness:0.10, clearcoat:0.5, clearcoatRoughness:0.05, envMapIntensity:1.0}),
    // Splitters / skirts / vents: matte black, dim reflections.
    blk:      _carMat({color:0x050505, metalness:0.0, roughness:0.75, envMapIntensity:0.30}),
    matBlk:   _carMat({color:0x101012, metalness:0.0, roughness:0.85, envMapIntensity:0.25}),
    // Honeycomb grille: slightly metallic mesh.
    grille:   _carMat({color:0x1a1a1c, metalness:0.4, roughness:0.55, envMapIntensity:0.40}),
    // Carbon-fiber trim: diffuse weave map + clearcoat lacquer. Per-instance
    // builders kunnen hiernaar verwijzen i.p.v. matBlk waar de "zwart"
    // bedoeld is als premium materiaal (Bugatti accents, McLaren slats,
    // Koenigsegg roof scoop). matBlk en blk blijven los staan voor échte
    // matte plastic onderdelen.
    carbon:   _carMat({color:0x141416, metalness:0.4, roughness:0.55, clearcoat:0.8, clearcoatRoughness:0.25, envMapIntensity:0.85, map:_makeCarbonWeaveTex(), physical:true}),
    // Tire: pure matte rubber, no reflection contribution.
    tire:     _carMat({color:0x080808, metalness:0.0, roughness:0.95, envMapIntensity:0.10}),
    // Rim: polished alloy, strong reflection.
    rim:      _carMat({color:0xc0c0c8, metalness:0.85, roughness:0.30, envMapIntensity:0.85}),
    // Brake caliper: matte red painted metal.
    brakeRed: _carMat({color:0xcc1010, metalness:0.0, roughness:0.85, envMapIntensity:0.30}),
    // Brake disc: brushed steel.
    brakeDisc:_carMat({color:0x282828, metalness:0.7, roughness:0.40, envMapIntensity:0.65}),
    // Emissive lights — keep their existing colors / intensities.
    head:     _carMat({color:0xfff8e8, emissive:0xffe8a8, emissiveIntensity:.6, metalness:0.1, roughness:0.30, envMapIntensity:0.40}),
    tail:     _carMat({color:0xff1010, emissive:0xcc0000, emissiveIntensity:.45, metalness:0.1, roughness:0.30, envMapIntensity:0.35}),
    indicator:_carMat({color:0xff7e10, emissive:0xff5500, emissiveIntensity:.35, metalness:0.1, roughness:0.30, envMapIntensity:0.35})
  };
  // PBR-upgrade Brok 1a: envTag per shared car material zodat de
  // applyWorldVisuals-traversal (js/core/world-visuals.js) envMapIntensity
  // per wereld kan moduleren. Materialen zonder envTag worden door de
  // helper overgeslagen, dus dit is veilig voor Brok 1a (cars getagd) →
  // Brok 1b (world-props worden later getagd).
  const _envTags = {
    glass:'glass', glassDark:'glass', chrome:'chrome',
    blk:'world-prop', matBlk:'world-prop', grille:'world-prop',
    carbon:'carbon', tire:'tire', rim:'rim',
    brakeRed:'world-prop', brakeDisc:'world-prop',
    head:'world-prop', tail:'world-prop', indicator:'world-prop'
  };
  // Flag every shared car material so disposeScene leaves the cache alive
  // across world rebuilds — otherwise getSharedCarMats() would return a
  // bag of disposed material handles after the first race ends, and on
  // desktop the next race would pay a Standard-shader recompile hitch.
  Object.entries(_carShared).forEach(([key, m])=>{
    m.userData = m.userData || {};
    m.userData._sharedAsset = true;
    if(_envTags[key]) m.userData.envTag = _envTags[key];
    // PBR-upgrade Brok 1a: pas world-visuals direct toe op shared car-mats.
    // Cars worden ná buildScene gespawned, dus scene.traverse() in
    // applyWorldVisuals mist ze; deze single-mat-apply houdt ze in sync.
    if(typeof window.applyVisualsToMaterial === 'function'
       && typeof activeWorld !== 'undefined'){
      window.applyVisualsToMaterial(m, activeWorld);
    }
  });
  // Track headlight material in a registry so night.js can sync emissive intensity
  // when toggling dark mode without touching every car mesh.
  if(!window._headlightMats) window._headlightMats = [];
  window._headlightMats.push(_carShared.head);
  return _carShared;
}

// PBR-fix: shared car-mats (_carShared) leven sessie-lang en worden NIET door
// scene.traverse bereikt wanneer buildScene draait vóór cars zijn ge-add.
// Bij wereld-switch keerden chrome/glass/tire/rim/etc. anders terug met de
// IBL-waarden van de eerste wereld die ooit geladen was. Deze helper haalt
// de complete shared-cache opnieuw door world-visuals' applyVisualsToMaterial.
function applyVisualsToSharedCarMats(world){
  if(!_carShared) return;
  if(typeof window.applyVisualsToMaterial !== 'function') return;
  const mats = Object.values(_carShared);
  for(let i=0;i<mats.length;i++){
    window.applyVisualsToMaterial(mats[i], world);
  }
}
window.applyVisualsToSharedCarMats = applyVisualsToSharedCarMats;

// Drop the shared car material cache. Call on full session reset (not on
// per-race world rebuild — the materials are flagged _sharedAsset so they
// survive disposeScene). Currently no caller; documented for completeness.
function disposeSharedCarMats(){
  if(!_carShared) return;
  Object.values(_carShared).forEach(m=>{ try{ m.dispose(); } catch(_){} });
  // Carbon-weave diffuse map is een gedeelde CanvasTexture, geen materiaal —
  // dispose 'm los van de materiaal-loop hierboven.
  if(_carbonTex){ try{ _carbonTex.dispose(); } catch(_){} _carbonTex = null; }
  // Phase 6: silhouette material + decal roundel cache opruimen.
  if(_driverSilhouetteMat){ try{ _driverSilhouetteMat.dispose(); } catch(_){} _driverSilhouetteMat = null; }
  _decalCache.forEach(tex=>{ try{ tex.dispose(); } catch(_){} });
  _decalCache.clear();
  _carShared = null;
  if(window._headlightMats) window._headlightMats.length = 0;
}
window.disposeSharedCarMats = disposeSharedCarMats;

// Update headlight emissive intensity globally — called from night.js when isDark flips.
function syncHeadlights(intensity){
  if(!window._headlightMats) return;
  window._headlightMats.forEach(m=>{ if(m && m.emissive) m.emissiveIntensity = intensity; });
}
window.syncHeadlights = syncHeadlights;

// Per-car paint + accent materials. One pair per CAR INSTANCE (so multiple
// instances of the same def each get fresh paint — needed because color
// overrides apply per-mesh and we don't want to retint the def-default for
// other instances).
//
// `opts.flake` is gereserveerd voor MeshPhysicalMaterial.iridescence (r135+).
// Op de huidige r134-bouw is iridescence niet beschikbaar; opts.flake is
// daarom een no-op tot de three-compat upgrade. Roep-sites mogen 'm wel
// opgeven zodat ze klaar zijn voor r135.
function makePaintMats(def, opts){
  opts = opts || {};
  const color = (typeof def.color === 'string') ? parseInt(def.color,16) : def.color;
  const accent = (typeof def.accent === 'string') ? parseInt(def.accent,16) : def.accent;
  let paint, accentMat;
  if (window._isMobile){
    // Mobile blijft op Phong/Lambert om PBR-shader-cost te vermijden over
    // 30+ paint-meshes per auto bij vol grid.
    paint = new THREE.MeshPhongMaterial({color:color, shininess:120, specular:0x666666});
    accentMat = new THREE.MeshLambertMaterial({color:accent});
  } else {
    // Desktop: MeshPhysicalMaterial met clearcoat-laag = nat-look automotive
    // lacquer. Hogere metalness + clearcoat samen geven het "diepe gloss"
    // effect dat MeshStandardMaterial alleen niet kan reproduceren. Vereist
    // een scene.environment envMap — fallback procedural envMap zit in
    // core/scene.js (_buildProceduralEnvMap) zodat dit ook werkt zonder HDRI.
    //
    // Per-def overrides voor matte rally / studio finishes: als def-velden
    // paintClearcoat / paintRoughness / paintMetalness gezet zijn, gebruiken
    // we die i.p.v. de gloss-defaults. Bestaande 12 cars hebben deze velden
    // niet → fallback naar de showroom-supercar tuning, gedrag ongewijzigd.
    // PBR-upgrade Brok 1a: clearcoat-formule herijkt. Onder de nieuwe IBL
    // (per-wereld envMapIntensity-multiplier in world-visuals.js) gaf de
    // oude `cc = 1.0` + lage clearcoatRoughness te veel chroom-look op
    // helder belichte werelden. De per-def overrides paintClearcoat /
    // paintRoughness blijven werken — alleen de default-formule schuift.
    const rg = (typeof def.paintRoughness  === 'number') ? def.paintRoughness  : 0.30;
    const mt = (typeof def.paintMetalness  === 'number') ? def.paintMetalness  : 0.85;
    // Nieuwe default-formule: cc = 0.35 + 0.55 * rg. Bij rg=0.30 levert dit
    // cc≈0.515 (was 1.0); rally finishes (hogere rg) krijgen iets meer
    // clearcoat-volume, F1-gloss (lagere rg) iets minder.
    const cc = (typeof def.paintClearcoat === 'number')
      ? def.paintClearcoat
      : (0.35 + 0.55 * rg);
    // clearcoatRoughness schaalt mee met paint roughness; floor 0.06 (was 0.05)
    // zodat zelfs F1-gloss een fractie minder mirror-finish krijgt.
    const ccRg = Math.max(0.06, rg * 0.45);
    paint = new THREE.MeshPhysicalMaterial({
      color: color,
      metalness: mt, roughness: rg,
      clearcoat: cc, clearcoatRoughness: ccRg,
      envMapIntensity: 1.0,
    });
    accentMat = new THREE.MeshPhysicalMaterial({
      color: accent,
      metalness: 0.50, roughness: 0.35,
      clearcoat: 0.6, clearcoatRoughness: 0.10,
      envMapIntensity: 0.65,
    });
    paint.userData = paint.userData || {};
    paint.userData._carPBR = true;
    paint.userData.envTag = 'paint';
    paint.userData.isCarPaint = true;
    accentMat.userData = accentMat.userData || {};
    accentMat.userData._carPBR = true;
    accentMat.userData.envTag = 'paint';
    // PBR-upgrade Brok 1a: world-visuals direct toepassen op fresh paint/accent
    // zodat envMapIntensity klopt zonder af te hangen van scene.traverse.
    if(typeof window.applyVisualsToMaterial === 'function'
       && typeof activeWorld !== 'undefined'){
      window.applyVisualsToMaterial(paint, activeWorld);
      window.applyVisualsToMaterial(accentMat, activeWorld);
    }
  }
  return {paint, accent: accentMat};
}

// Mesh helper — adds a child to a group with position + rotation + shadow flag.
function addPart(group, geo, mat, x, y, z, rx, ry, rz){
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x||0, y||0, z||0);
  if(rx||ry||rz) m.rotation.set(rx||0, ry||0, rz||0);
  m.castShadow = true;
  group.add(m);
  return m;
}

// "Crowned slab" — a low-poly extruded panel met een lichte dome op de
// bovenkant. Visueel leest het als een hood/roof met aerodynamische welving
// in plaats van een vlakke box. Cross-section ligt in X-Y, lengte loopt
// langs Z (zelfde as-conventie als de BoxGeometry's die het vervangt zodat
// position en rotation in builders ongewijzigd blijven).
//
// Triangle-budget: ~36 tris per slab (vs 12 voor BoxGeometry). Drie slabs
// per Bugatti = +72 tris t.o.v. baseline. Onder de Phase 2 limiet van 200.
function _crownedSlabGeo(width, height, depth){
  const halfW = width * 0.5;
  const baseY = -height * 0.5;
  const peakY =  height * 0.5;
  const crownY = peakY + height * 0.4; // 40% extra dome op het midden
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, baseY);
  shape.lineTo( halfW, baseY);
  shape.lineTo( halfW, peakY);
  // Dome via quadratic curve — control point boven het midden, eindpunt
  // weer op peakY links. Geeft een vloeiende boog over de top.
  shape.quadraticCurveTo(0, crownY, -halfW, peakY);
  shape.lineTo(-halfW, baseY);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: depth,
    bevelEnabled: false,
    curveSegments: 6,
    steps: 1
  });
  // ExtrudeGeometry extrudet vanaf z=0 naar +depth — center op Z zodat de
  // builder-position het midden van de slab aanstuurt (zelfde semantiek als
  // BoxGeometry).
  geo.translate(0, 0, -depth * 0.5);
  return geo;
}

// ── Phase 6 graphics upgrade — driver silhouette + nummer-decal ─────────
//
// Auto's voelden eerder leeg aan: glass-cabin (opacity 0.86) keek door naar
// niets. buildDriverSilhouette plaatst een eenvoudige bust (head-sphere +
// shoulders-box) achter het glas zodat de auto "iemand erin" leest.
// _makeNumberRoundelTex levert een gecached 128² roundel-canvas (cirkel +
// nummer + border) dat als decal-plane op de bonnet wordt gezet.
//
// Mobile-strategie:
//   silhouette  — desktop only (extra mesh per car × 8-9 cars; mobile-budget)
//   decal-plane — beide (1 extra plane per car, ~40 verts totaal in scene)
//
// Disposal: silhouette krijgt geen _sharedAsset zodat disposeScene 'm
// opruimt op world-switch. _decalCache holds CanvasTextures shared across
// cars met hetzelfde nummer-color paar; disposeSharedCarMats clears them.

let _driverSilhouetteMat = null;
function _getSilhouetteMat(){
  if (_driverSilhouetteMat) return _driverSilhouetteMat;
  // Donker grafiet — leest als anonieme race driver. Lambert ipv PBR
  // omdat interieur half-belicht is en clearcoat geen meerwaarde heeft.
  _driverSilhouetteMat = new THREE.MeshLambertMaterial({color:0x1a1a22});
  _driverSilhouetteMat.userData = { _sharedAsset:true };
  return _driverSilhouetteMat;
}

const _DRIVER_COCKPIT = {
  // type → {y, z} cockpit-anchor (body-local). Z=0 is car-center, +Z is rear,
  // -Z is forward. Driver zit voor het midden, hoofd ter hoogte van 0.55-0.70.
  super:  { y:0.62, z:-0.05 },
  rally:  { y:0.78, z:-0.15 }, // hatchback hoger dan super
  sedan:  { y:0.78, z:-0.30 }, // sedan driver verder voor
  muscle: { y:0.80, z:-0.20 },
  f1:     { y:0.55, z: 0.00 }, // open cockpit, lager + center
};

function buildDriverSilhouette(group, def){
  if (window._isMobile) return;            // mobile-budget — skip silhouette
  if (!group || !def) return;
  const anchor = _DRIVER_COCKPIT[def.type] || _DRIVER_COCKPIT.super;
  const mat = _getSilhouetteMat();
  // Head — kleine sphere, low-poly (8×6 segments)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mat);
  head.position.set(0, anchor.y + 0.18, anchor.z);
  group.add(head);
  // Shoulders — afgeronde box (geometry geschaald)
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.30), mat);
  shoulders.position.set(0, anchor.y - 0.05, anchor.z + 0.05);
  group.add(shoulders);
  // Helmet visor accent — fascin schermpje voor het hoofd, donkerder
  // zodat het oog van de kijker een "helm-detail" oppakt zonder echte
  // helm-geometry. Skipt voor f1 (open visor zit op het hoofd zelf).
  if (def.type !== 'f1'){
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.04), mat);
    visor.position.set(0, anchor.y + 0.20, anchor.z - 0.16);
    group.add(visor);
  }
  // Phase 4 — expose head + shoulders zodat updateDriverSway in visuals.js
  // ze tegen de body-tilt in kan kantelen (driver compensates the lean).
  // Geeft duidelijk levende body language tijdens cornering.
  group.userData._driverParts = { head, shoulders, anchorY: anchor.y };
}

// _makeNumberRoundelTex — 128² canvas met colored circle + number + border.
// Per (num, color) gecached zodat 8 cars met verschillende nummers samen
// max 8 textures alloceren ipv 8 redundant. Disposed in disposeSharedCarMats.
const _decalCache = new Map();
// padStart(6) zodat 0x0000ff en 0xff niet dezelfde key krijgen — toekomstige
// 16-bit accents zouden anders silently colliden met een 24-bit accent.
function _decalCacheKey(num, color){ return num + '|' + (color>>>0).toString(16).padStart(6,'0'); }

function _makeNumberRoundelTex(num, color){
  const key = _decalCacheKey(num, color);
  const cached = _decalCache.get(key);
  if (cached) return cached;
  const S = 128;
  const c = document.createElement('canvas'); c.width=S; c.height=S;
  const g = c.getContext('2d');
  g.clearRect(0,0,S,S);
  // Outer border ring (white) — 4px voor crispness
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(S*0.5, S*0.5, S*0.46, 0, Math.PI*2); g.fill();
  // Inner gevulde cirkel met accent-color
  g.fillStyle = '#'+ (color>>>0).toString(16).padStart(6,'0');
  g.beginPath(); g.arc(S*0.5, S*0.5, S*0.42, 0, Math.PI*2); g.fill();
  // Nummer — luminance check: donkere accent → wit nummer; lichte → zwart.
  const r = (color>>16)&0xff, gC = (color>>8)&0xff, b = color&0xff;
  const lum = (r*0.299 + gC*0.587 + b*0.114)/255;
  g.fillStyle = lum < 0.55 ? '#ffffff' : '#101010';
  g.font = 'bold ' + (S*0.55|0) + 'px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(num), S*0.5, S*0.55);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData = { _sharedAsset:true };
  _decalCache.set(key, tex);
  return tex;
}

function buildCarDecal(group, def){
  if (!group || !def) return;
  // Nummer = def.id+1 (race-startnummer 1..N). Color = accent — heldere
  // zichtbare ring tegen de paint-color van de body. Fallback is rood
  // (0xee2233) ipv wit zodat een car zonder accent niet onzichtbaar wit-
  // op-wit krijgt; preview/selection-screen krijgt zo nog leesbare decals.
  const num = (def.id|0) + 1;
  const col = (def.accent != null) ? def.accent : 0xee2233;
  const tex = _makeNumberRoundelTex(num, col);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false
  });
  // Type-specifieke bonnet-positie. Hood is upper-front body surface.
  // Per body-type net iets anders zodat decal goed leesbaar is bij
  // standaard chase-camera. Y net boven body-top (0.95-1.10), Z forward
  // (-0.6 tot -1.2). Plane horizontal (-X-Z plane), facing up.
  const z = (def.type === 'f1') ? -0.5 : (def.type === 'muscle' ? -0.9 : -0.7);
  const y = (def.type === 'f1') ? 0.45 : (def.type === 'muscle' ? 1.05 : 0.95);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), mat);
  decal.rotation.x = -Math.PI/2;
  decal.position.set(0, y, z);
  group.add(decal);
}

// One wheel assembly: a sub-group at (x,y,z) containing tire + rim + spokes
// + caliper + brake disc. The sub-group spins as one unit (physics.spinWheels
// rotates everything in userData.wheels[]). Caliper is added as a sibling so
// it stays static while the wheel spins.
// Returns the spinning sub-group.
//
// opts (optional, default {}):
//   brakeStyle: 'standard' | 'drilled' — drilled adds 8 dark holes op de
//                                        disc-face voor premium tier cars.
//   caliperMatKey: string — naam van een mat in `mats` om i.p.v. brakeRed
//                           te gebruiken (bv. 'accent' voor branded calipers).
function buildWheel(group, x, y, z, radius, width, mats, lod, opts){
  opts = opts || {};
  const tireSegs = lod==='low' ? 8 : 16;
  const wheelGroup = new THREE.Group();
  wheelGroup.position.set(x, y, z);
  // Orient the wheel so its rotation axis is along world X (left-right).
  // Spinning forward = rotation around world X = rotation.x on this group.
  wheelGroup.rotation.z = Math.PI/2;
  // Snapshot rest-Y voor Fase 3 graphics upgrade (wheel-bob). applyWheelBob
  // verschuift positie.y rond restY in een sinusgolf per wiel gemoduleerd
  // door snelheid. Desktop-only.
  wheelGroup.userData.restY = y;
  group.add(wheelGroup);
  // Tire
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, tireSegs),
    mats.tire
  );
  tire.castShadow = true;
  wheelGroup.add(tire);
  if(lod !== 'low'){
    // Rim (slightly outside the tire for visibility)
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(radius*.62, radius*.62, width+.012, 12),
      mats.rim
    );
    wheelGroup.add(rim);
    // 5 spokes — laid flat across the rim face
    const spokeGeo = new THREE.BoxGeometry(.04, .025, radius*1.05);
    for(let s=0; s<5; s++){
      const sp = new THREE.Mesh(spokeGeo, mats.rim);
      sp.rotation.y = (s/5)*Math.PI*2;
      wheelGroup.add(sp);
    }
    // Brake disc — same axis as wheel. Drilled style krijgt extra segmenten
    // op de cylinder + 8 zwarte "gaten" op de disc-face. Mobile valt terug
    // op standard voor consistentie met de premium-headlights LOD-filosofie
    // (extra-detail features alleen op desktop).
    const drilled = opts.brakeStyle === 'drilled' && !window._isMobile;
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(radius*.55, radius*.55, .03, drilled ? 16 : 12),
      mats.brakeDisc
    );
    wheelGroup.add(disc);
    if (drilled){
      // Disc face ligt in wheelGroup's lokale XZ-vlak (Y is de spin-as).
      // 8 holes verdeeld langs een cirkel met radius 40% van wheel-radius.
      const holeGeo = new THREE.BoxGeometry(.025, .035, .025);
      const holeMat = mats.matBlk;
      const holeR = radius * 0.40;
      for (let i=0; i<8; i++){
        const a = (i/8) * Math.PI * 2;
        const hole = new THREE.Mesh(holeGeo, holeMat);
        hole.position.set(Math.cos(a)*holeR, 0, Math.sin(a)*holeR);
        wheelGroup.add(hole);
      }
    }
    // Caliper as sibling (stays static while wheel spins). caliperMatKey
    // override staat brand-builders toe een gebrande caliper-kleur te
    // forceren (bv. Bugatti accent gold).
    const calMat = (opts.caliperMatKey && mats[opts.caliperMatKey]) || mats.brakeRed;
    const cal = new THREE.Mesh(new THREE.BoxGeometry(.08, .18, .22), calMat);
    cal.position.set(x, y-.08, z);
    group.add(cal);
  }
  return wheelGroup;
}

// Builds 4 wheels at the standard sedan/super positions and registers them
// on group.userData.wheels for spin animation.
// posOverride lets F1 / specific shapes pass their own [[x,y,z],...] array.
// wheelOpts wordt doorgegeven aan buildWheel — zie buildWheel voor opties.
function buildAllWheels(group, def, mats, lod, posOverride, wheelOpts){
  const isF1 = def.type === 'f1';
  const isMuscle = def.type === 'muscle';
  // Group B Rally pilot — oversized wheels (.42 radius vs .33 default) +
  // bredere stance. Bestaande non-rally types blijven ongewijzigd.
  const isRally = def.type === 'rally';
  const positions = posOverride || (isF1
    ? [[-1.06,.30,-1.80],[1.06,.30,-1.80],[-1.06,.30,1.62],[1.06,.30,1.62]]
    : isMuscle
      ? [[-0.99,.33,-1.50],[0.99,.33,-1.50],[-0.99,.33,1.50],[0.99,.33,1.50]]
      : isRally
        ? [[-1.00,.36,-1.50],[1.00,.36,-1.50],[-1.00,.36,1.50],[1.00,.36,1.50]]
        : [[-0.98,.33,-1.40],[0.98,.33,-1.40],[-0.98,.33,1.40],[0.98,.33,1.40]]);
  const radius = isF1 ? .36 : isRally ? .42 : .33;
  const width  = isF1 ? .42 : isRally ? .30 : .26;
  group.userData.wheels = [];
  positions.forEach(([wx,wy,wz])=>{
    const wheelGrp = buildWheel(group, wx, wy, wz, radius, width, mats, lod, wheelOpts);
    group.userData.wheels.push(wheelGrp);
  });
  // Map to FL/FR/RL/RR for engine.js / physics.js consumers.
  const w = group.userData.wheels;
  if(w.length >= 4){
    group.userData.wheelFL = w[0];
    group.userData.wheelFR = w[1];
    group.userData.wheelRL = w[2];
    group.userData.wheelRR = w[3];
  }
}

// Headlights: two small emissive blocks at the front. Call this from each
// non-F1 brand builder after the body is built.
function buildHeadlights(group, mats, opts){
  opts = opts || {};
  const sx = opts.spread || 0.80;
  const y = opts.y || .42;
  const z = opts.z || -1.95;
  const w = opts.w || .26;
  const h = opts.h || .12;
  const d = opts.d || .08;
  const geo = new THREE.BoxGeometry(w, h, d);
  [-sx, sx].forEach(s=>{
    const hl = new THREE.Mesh(geo, mats.head);
    hl.position.set(s, y, z);
    group.add(hl);
  });
}

// Premium headlights — emissive inner unit + transmissive lens cover + 4-element
// LED accent strip. Gebruikt door tier-S/A builders die meer detail in het
// front nodig hebben. Op mobile is de transmission lens een no-op (PBR-only)
// en valt het terug op buildHeadlights-stijl emissive-only.
//
// Per-call mat-allocatie: één MeshPhysicalMaterial (lens) per call — kost
// minimal want premium-cars zijn opt-in en komen 1× per race voor.
function buildPremiumHeadlights(group, mats, opts){
  opts = opts || {};
  const sx = opts.spread || 0.78;
  const y  = opts.y      || .42;
  const z  = opts.z      || -1.95;
  const w  = opts.w      || .26;
  const h  = opts.h      || .12;
  const d  = opts.d      || .08;
  // Inner emissive box — kern van de koplamp, zelfde mats.head als regular.
  const innerGeo = new THREE.BoxGeometry(w*0.85, h*0.85, d*0.85);
  // 4-segment LED strip onder de hoofdlamp (DRL accent).
  const ledGeo = new THREE.BoxGeometry(w*0.18, h*0.20, d*0.40);
  // Outer lens — alleen op desktop met MeshPhysicalMaterial.transmission.
  const useLens = !window._isMobile;
  let lensGeo = null, lensMat = null;
  if (useLens){
    lensGeo = new THREE.BoxGeometry(w, h, d);
    lensMat = new THREE.MeshPhysicalMaterial({
      color: 0xeef0ff,
      metalness: 0.0, roughness: 0.05,
      transmission: 0.9, ior: 1.4, thickness: 0.05,
      transparent: true, opacity: 0.4,
      envMapIntensity: 1.0,
    });
    lensMat.userData = lensMat.userData || {};
    lensMat.userData._carPBR = true;
  }
  [-sx, sx].forEach(s=>{
    const inner = new THREE.Mesh(innerGeo, mats.head);
    inner.position.set(s, y, z);
    inner.castShadow = true;
    group.add(inner);
    if (useLens){
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.position.set(s, y, z);
      group.add(lens);
    }
    // 4 LED-segmenten horizontaal verdeeld onder de koplamp.
    for (let i=0; i<4; i++){
      const led = new THREE.Mesh(ledGeo, mats.head);
      led.position.set(s + (i - 1.5) * w * 0.20, y - h * 0.55, z + d * 0.05);
      group.add(led);
    }
  });
}

// Tail lights — small emissive red blocks at rear.
function buildTaillights(group, mats, opts){
  opts = opts || {};
  const sx = opts.spread || 0.78;
  const y = opts.y || .55;
  const z = opts.z || 1.95;
  const w = opts.w || .26;
  const h = opts.h || .10;
  const d = opts.d || .06;
  const geo = new THREE.BoxGeometry(w, h, d);
  [-sx, sx].forEach(s=>{
    const tl = new THREE.Mesh(geo, mats.tail);
    tl.position.set(s, y, z);
    group.add(tl);
  });
}

// Dual chrome exhaust pipes at the rear.
function buildExhausts(group, mats, opts){
  opts = opts || {};
  const sx = opts.spread || 0.40;
  const y = opts.y || .22;
  const z = opts.z || 2.05;
  const r = opts.radius || .065;
  const len = opts.length || .35;
  const geo = new THREE.CylinderGeometry(r, r, len, 8);
  [-sx, sx].forEach(s=>{
    const ex = new THREE.Mesh(geo, mats.chrome);
    ex.rotation.x = Math.PI/2;
    ex.position.set(s, y, z);
    group.add(ex);
  });
}

// Side air vents — two small dark slits behind the front wheels (super silhouettes).
function buildSideVents(group, mats, opts){
  opts = opts || {};
  const sx = opts.spread || 0.96;
  const y = opts.y || .50;
  const z = opts.z || -.40;
  const w = opts.w || .04;
  const h = opts.h || .14;
  const d = opts.d || .55;
  const geo = new THREE.BoxGeometry(w, h, d);
  [-sx, sx].forEach(s=>{
    const v = new THREE.Mesh(geo, mats.blk);
    v.position.set(s, y, z);
    group.add(v);
  });
}

// Wheel arches — flattened hemispheres above each wheel.
function buildWheelArches(group, paintMat, opts){
  opts = opts || {};
  const positions = opts.positions || [[-.98,.36,-1.40],[.98,.36,-1.40],[-.98,.36,1.40],[.98,.36,1.40]];
  const geo = new THREE.SphereGeometry(.54, 10, 6, 0, Math.PI*2, 0, Math.PI*.5);
  positions.forEach(([wx,wy,wz])=>{
    const arch = new THREE.Mesh(geo, paintMat);
    arch.scale.set(1.08, .45, 1.55);
    arch.position.set(wx, wy, wz);
    group.add(arch);
  });
}

// Side skirts — matte black sliver under the body, between front and rear wheels.
function buildSideSkirts(group, mats, opts){
  opts = opts || {};
  const sx = opts.spread || 0.97;
  const y = opts.y || .12;
  const z = opts.z || 0;
  const len = opts.length || 2.6;
  const geo = new THREE.BoxGeometry(.06, .08, len);
  [-sx, sx].forEach(s=>{
    const sk = new THREE.Mesh(geo, mats.matBlk);
    sk.position.set(s, y, z);
    group.add(sk);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Group B Rally pilot helpers (Stap 2a/2b/2c uit PILOT_GROUPB prompt)
// ─────────────────────────────────────────────────────────────────────────────

// Side-profile shape registry voor buildExtrudedBody. Elk profile is een
// array van [normX, normY] punten waar normX∈[0,1] = front→back en
// normY∈[0,1] = bottom→top. Builder vermenigvuldigt met L en H. Alle
// profielen sluiten zichzelf langs de bodem.
//
// Voeg een profile toe wanneer je een nieuw archetype-silhouet nodig hebt.
// Bestaande car-builders verwijzen via opts.profile naar de key hieronder.
const _BODY_PROFILES = {
  // Group B / Lancia Delta — long flat hood, korte greenhouse, hatchback rear.
  rally: [
    [0.00, 0.15], [0.00, 0.35], [0.05, 0.45], [0.30, 0.48],
    [0.40, 0.85], [0.55, 0.95], [0.65, 0.95], [0.80, 0.55],
    [1.00, 0.45], [1.00, 0.15]
  ],
  // Mid-engine super (Ferrari/Lambo/McLaren) — laag wedgy front, korte cabin,
  // gedaalde engine cover, abrupte rear bumper. Lager + meer swept dan rally.
  super: [
    [0.00, 0.18], [0.00, 0.30], [0.05, 0.36], [0.20, 0.42],
    [0.30, 0.78], [0.45, 0.92], [0.55, 0.92], [0.70, 0.55],
    [0.85, 0.45], [1.00, 0.40], [1.00, 0.18]
  ],
  // Sedan / Tesla Model S — long hood, ruime greenhouse, fastback rear,
  // korte trunk. Hoogste dak van alle profielen.
  sedan: [
    [0.00, 0.20], [0.00, 0.40], [0.05, 0.48], [0.25, 0.52],
    [0.32, 0.92], [0.45, 1.00], [0.65, 1.00], [0.85, 0.55],
    [1.00, 0.50], [1.00, 0.20]
  ],
  // Muscle / Mustang — long flat hood, vertical windshield, lange flat roof,
  // matig sloped fastback, lange trunk. Beefy stance.
  muscle: [
    [0.00, 0.20], [0.00, 0.45], [0.05, 0.55], [0.32, 0.58],
    [0.36, 0.95], [0.42, 0.98], [0.65, 0.98], [0.78, 0.78],
    [0.92, 0.50], [1.00, 0.45], [1.00, 0.20]
  ]
};

// Build een gewelfde body-shell via een 2D side-profile shape die over de
// breedte wordt geëxtrudeerd. Caller positioneert de mesh in z'n eigen
// coördinatenruimte.
//
// As-conventie: shape in X-Y waar X=length (front=0, back=L), Y=height
// (bottom=0, top=H). Extrude langs +Z over `width`. Na centreren + rotateY
// komt de length op de Z-as (codebase-conventie front=-Z) en width op X.
//
// opts.profile: 'rally' | 'super' | 'sedan' | 'muscle' (default 'rally').
//
// Caller verantwoordelijk voor LOD-check; deze helper neemt geen LOD-fallback.
// Zie buildGroupBRally voor de high/low pad-keuze.
function buildExtrudedBody(width, length, height, opts){
  opts = opts || {};
  const mat = opts.mat;
  const profileKey = opts.profile || 'rally';
  const profile = _BODY_PROFILES[profileKey] || _BODY_PROFILES.rally;
  const bevelSize    = (opts.bevelSize    != null) ? opts.bevelSize    : 0.04;
  const bevelSegs    = (opts.bevelSegments!= null) ? opts.bevelSegments: 2;
  const bevelThick   = (opts.bevelThickness!=null) ? opts.bevelThickness: 0.04;
  const W = width, L = length, H = height;
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0] * L, profile[0][1] * H);
  for (let i = 1; i < profile.length; i++){
    shape.lineTo(profile[i][0] * L, profile[i][1] * H);
  }
  // Sluit shape langs de bodem terug naar het start-punt
  shape.lineTo(profile[0][0] * L, profile[0][1] * H);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: W,
    bevelEnabled: true,
    bevelSize: bevelSize,
    bevelThickness: bevelThick,
    bevelSegments: bevelSegs,
    bevelOffset: 0,
    curveSegments: 4,
    steps: 1
  });
  // Center op X (length) en Z (width). Y blijft op 0..H zodat caller met
  // mesh.position.y de body kan optillen tot wheel-axle-niveau.
  geo.translate(-L * 0.5, 0, -W * 0.5);
  // Roteer zodat length op Z komt (codebase-conventie). rotateY(-π/2) maps
  // X→-Z, dus shape-front (X=-L/2 na translate) eindigt op Z=-L/2 = codebase-front.
  geo.rotateY(-Math.PI / 2);
  return new THREE.Mesh(geo, mat);
}

// Half-torus arch die over een wiel "drapeert" als fender flare. Wheel-axis
// is X (zie buildWheel: wheelGroup.rotation.z=π/2 orienteert tire-cylinder
// zodat as=X), dus we roteren de torus zodat z'n centrale as ook=X komt.
// Default TorusGeometry heeft as=Z, arc in X-Y vlak; rotateY(π/2) zwaait
// Z→X waardoor de half-arc verticaal in Y-Z vlak komt te staan.
function buildLatheFenderArch(radius, width, opts){
  opts = opts || {};
  const tubeR = width * 0.15;
  const geo = new THREE.TorusGeometry(radius, tubeR, 6, 12, Math.PI);
  geo.rotateY(Math.PI / 2);
  return new THREE.Mesh(geo, opts.mat);
}

// Group B rally light pod — mounting bar + 4 ronde lampen naast elkaar.
// Lens-mat is per-instance (caller maakt aan en geeft door) — geen registratie
// in window._headlightMats[] zodat de yellow rally lights niet meebumpen met
// night-mode (rally lights staan altijd aan, day en night).
//
// LOD-fallback inline: 'low' gebruikt boxen voor housing+lens i.p.v. cylinders.
function buildRallyLightPod(opts){
  opts = opts || {};
  const W = (opts.width  != null) ? opts.width  : 0.9;
  const lightR = (opts.lightR != null) ? opts.lightR : 0.10;
  const mat    = opts.mat;
  const lensMat= opts.lensMat;
  const isLow  = !!window._isMobile;
  const pod = new THREE.Group();
  // Mounting bar across the front
  const bar = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, 0.04), mat);
  pod.add(bar);
  // 4 lampen, evenly spaced
  for (let i = 0; i < 4; i++){
    const x = -W * 0.5 + (i + 0.5) * (W / 4);
    if (isLow){
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(lightR * 1.6, lightR * 1.6, 0.06), mat
      );
      housing.position.set(x, 0, 0.02);
      pod.add(housing);
      const lens = new THREE.Mesh(
        new THREE.BoxGeometry(lightR * 1.4, lightR * 1.4, 0.02), lensMat
      );
      lens.position.set(x, 0, 0.05);
      pod.add(lens);
    } else {
      const housing = new THREE.Mesh(
        new THREE.CylinderGeometry(lightR, lightR, 0.05, 16), mat
      );
      housing.rotation.x = Math.PI / 2;
      housing.position.set(x, 0, 0.02);
      pod.add(housing);
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(lightR * 0.95, lightR * 0.95, 0.02, 16), lensMat
      );
      lens.rotation.x = Math.PI / 2;
      lens.position.set(x, 0, 0.06);
      pod.add(lens);
    }
  }
  return pod;
}

// Detect mobile / low-quality LOD — used by build.js to skip details.
function carLOD(){
  return (window._isMobile || window._lowQuality) ? 'low' : 'high';
}

// Expose globals for non-module scripts.
window.getSharedCarMats = getSharedCarMats;
window.makePaintMats = makePaintMats;
window.addPart = addPart;
window.buildWheel = buildWheel;
window.buildAllWheels = buildAllWheels;
window.buildHeadlights = buildHeadlights;
window.buildPremiumHeadlights = buildPremiumHeadlights;
window.buildTaillights = buildTaillights;
window._crownedSlabGeo = _crownedSlabGeo;
window.buildExhausts = buildExhausts;
window.buildSideVents = buildSideVents;
window.buildWheelArches = buildWheelArches;
window.buildSideSkirts = buildSideSkirts;
window.buildExtrudedBody = buildExtrudedBody;
window.buildLatheFenderArch = buildLatheFenderArch;
window.buildRallyLightPod = buildRallyLightPod;
window.carLOD = carLOD;
