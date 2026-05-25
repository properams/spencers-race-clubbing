// js/worlds/candy.js — candy world builders + update + collision checks
// Non-module script.

'use strict';

// Per-world state (uit main.js verhuisd) — gereset in core/scene.js buildScene().
let _sprinkleParticles=null,_sprinkleGeo=null;
let _candySprinkleFrame=0;  // Phase 10.10 — frame mod counter
let _candyFrameTick=0;      // generic per-frame tick voor mobile-stagger
const _CANDY_SPRINKLE_COLS=[
  [1.0,0.42,0.71],[0.4,0.85,1.0],[1.0,0.95,0.42],
  [0.65,0.4,1.0],[1.0,0.71,0.0]
];
// Floating candy-bits — atmospheric drift particles that complement the
// existing falling-sprinkles. Zweven slow on lateral wind + slight Y drift
// instead of falling; recycled in a sphere around the player. Reuses the
// Points + vertexColors + sizeAttenuation pattern of the sprinkles so no
// new shader path is introduced. See buildFloatingCandyBits + updateFloatingCandyBits.
let _candyFloatBits=null,_candyFloatBitsGeo=null,_candyFloatBitsVel=null;
const _gummyBears=[];
const _gumZones=[];
const _candyCannons=[];
let _chocoHighlight=null;
let _candyCaneList=[];
let _candyLollipops=[];
let _candyNightEmissives=[]; // meshes that glow at night
let _candyCandles=[];        // candle flame lights on cake

// ────────────────────────────────────────────────────────────────────────
// Sessie "depth/landmarks/horizon" — tunebare constants.
// Aanpassen hier wijzigt 1 plek; helper-bodies pakken deze waardes op.
// ────────────────────────────────────────────────────────────────────────

// Taak 1 — Large-scale candy landmarks (silhouet, candy-taal). Individuele
// meshes (geen instancing). Mix van baken langs trackCurve + verspreide
// veld-landmarks op grotere afstand. Donker, geen emissive — pure silhouet.
const CANDY_LANDMARK_COUNT_DESKTOP        = 8;
const CANDY_LANDMARK_COUNT_MOBILE         = 4;
// Spline-baken: dichterbij baan, gespreid op gelijke t-intervallen.
const CANDY_LANDMARK_SPLINE_OFFSET_MIN    = 80;
const CANDY_LANDMARK_SPLINE_OFFSET_MAX    = 180;
// Veld-landmarks: random t, grotere offset, voelen als "ver weg".
const CANDY_LANDMARK_FIELD_OFFSET_MIN     = 220;
const CANDY_LANDMARK_FIELD_OFFSET_MAX     = 380;
// Hoogte-range — mid-prop canes pieken op ~10u (scale 5.0 × yFn 2.0).
// 5–15× = 50–150u; we pakken 30–75u zodat ze niet boven skybox-horizon
// uitsteken en de silhouet binnen normaal cam-frustum blijft.
const CANDY_LANDMARK_HEIGHT_MIN           = 30;
const CANDY_LANDMARK_HEIGHT_MAX           = 75;
// Donker indigo palette — verder = donkerder voor diepte-illusie.
const CANDY_LANDMARK_COL_NEAR             = 0x1a0e28;
const CANDY_LANDMARK_COL_MID              = 0x140a22;
const CANDY_LANDMARK_COL_FAR              = 0x0c071c;
// Afstand-thresholds voor mat-keuze (offset op trackCurve).
const CANDY_LANDMARK_MAT_NEAR_BELOW       = 200;
const CANDY_LANDMARK_MAT_MID_BELOW        = 320;

// Taak 2 — Mid-scale gelaagdheid. Universele multipliers op scaleMin/Max
// van bestaande mid-prop helpers, zodat er natuurlijke tussenmaten
// ontstaan tussen kleine grond-props en grote landmarks. Effectief
// ratio max/min in elke helper wordt ~2× breder dan voorheen.
const CANDY_MID_SCALE_MIN_MUL             = 0.72;
const CANDY_MID_SCALE_MAX_MUL             = 1.45;

// Taak 3 — Horizon-band silhouetten. Grote vage candy-vormen op verste
// afstand. Donker zenith (#0e0820 uit V3 optie D) liet de bestaande
// specks wegvallen — bigs zijn fors hoger zodat ze gradient-tegen-
// gradient leesbaar zijn tegen die donkere lucht. Toegevoegd naast
// (niet i.p.v.) `_buildCandyHorizonSpecks`.
const CANDY_HORIZON_BIGS_COUNT_DESKTOP    = 8;
const CANDY_HORIZON_BIGS_COUNT_MOBILE     = 4;
const CANDY_HORIZON_BIGS_OFFSET_MIN       = 380;
const CANDY_HORIZON_BIGS_OFFSET_MAX       = 700;
const CANDY_HORIZON_BIGS_HEIGHT_MIN       = 35;
const CANDY_HORIZON_BIGS_HEIGHT_MAX       = 80;
// Iets lichter dan zenith (rgb 14,8,32) zodat silhouet leesbaar blijft
// als gradient-tegen-gradient; rgb 34,24,48 = +20 in elke channel.
const CANDY_HORIZON_BIGS_COL              = 0x221830;

// Push all emissive single-material meshes from a Group into the night-
// dimming list. night.js:188/203 assigns `m.material.emissiveIntensity = X`
// — array-materials would silently set a property on the array itself,
// not on its members, so we skip those. Used by every builder that
// replaces an old multi-mesh recipe with a SugarRushProps.* Group.
function _pushCandyEmissiveTree(root){
  if(!root || !root.traverse) return;
  root.traverse(child => {
    if(!child.material || Array.isArray(child.material)) return;
    if(child.material.emissive) _candyNightEmissives.push(child);
  });
}

// Single source of truth for candy day lighting. Called from
// buildCandyEnvironment at world-build; WORLD_LIGHTING.candy.day wordt
// door applyWorldLighting bij toggle gelezen. Beide moeten synchroon
// blijven.
//
// Goal palette ("verlaten pretpark om middernacht", V1 statisch):
//   sun #ffa070 (warm amber, dempt door mist) / 0.25 mobile, 0.35 desktop
//   sun position (60, 110, 80) — hoog/achter, gradient-bron ipv hoofdlicht
//   ambient #1a1428 (zeer donker aubergine) / 0.10
//   hemi sky #3a2a55 (donker paars) / ground #2a1820 (donker grond) / 0.18
//   fog #2a1838 (diep indigo-aubergine) / density 0.0085
//
// Lamp-poles + emissive snoep + bloom dragen de scene; sun is bewust
// laag om silhouet buiten de lamp-pools mogelijk te maken. Mobile sun
// cap 0.25 — zelfde reden als pier47 (shadows off, ground clipping
// vermijden).
function _applyCandyDayLighting(){
  if(!sunLight||!ambientLight||!hemiLight)return;
  sunLight.color.setHex(0x7a8aa8);
  sunLight.intensity = window._isMobile ? 0.25 : 0.35;
  sunLight.position.set(60, 110, 80);
  ambientLight.color.setHex(0x1a1428); ambientLight.intensity = 0.10;
  hemiLight.color.setHex(0x3a2a55);
  hemiLight.groundColor.setHex(0x2a1820);
  hemiLight.intensity = 0.18;
  // PBR-upgrade Brok 1b: per-wereld ambient/hemi-mul knop. Voor candy
  // 1.45/1.30 zodat niet-emissive snoep (Lambert/Standard props)
  // leesbaar blijft in de donkere scene — werkt vooral bij het
  // basisniveau, niet ter compensatie van de ambient-drop.
  const _v=(typeof window.getWorldVisuals==='function')?window.getWorldVisuals(activeWorld):null;
  if(_v){ ambientLight.intensity*=_v.ambientMul; hemiLight.intensity*=_v.hemiMul; }
}
if(typeof window!=='undefined')window._applyCandyDayLighting=_applyCandyDayLighting;

function buildCandyEnvironment(){
  // Weather reset — Sugar Rush is a fantasy candy world; water-rain would
  // visually clash (melting sugar). Clear leaked rain state from a previous
  // world or the title-screen rain toggle.
  if(typeof isRain!=='undefined'&&isRain){
    isRain=false;
    if(typeof _rainTarget!=='undefined')_rainTarget=0;
    if(typeof _rainIntensity!=='undefined')_rainIntensity=0;
    if(rainCanvas)rainCanvas.style.display='none';
  }
  _applyCandyDayLighting();
  buildCandyGround();
  buildCandySky();
  buildLollipopTrees();
  buildCandyCanes();
  buildChocolateRiver();
  buildGumDropMountains();
  buildCakeBuilding();
  buildCandyGate();
  _buildCandyCarnivalLights();    // Verlaten-pretpark V1 — cinematic lamp-poles + cones
  _buildCandyCarnivalMist();      // Verlaten-pretpark V1 — ground fog + blinking markers
  _buildCandyCarnivalLandmarks(); // V3 prop-herontwerp Laag 1 — silhouet-attracties (reuzenrad/tenten/boog)
  buildSprinkleParticles();
  buildFloatingCandyBits();
  buildCottonCandyClouds();
  buildRainbowTrackStripes();
  buildCandyBarriers();
  buildIceCreamCones();
  buildCookieSpectators();
  _buildCandyCloseBand();         // Phase 12A — foreground "whoosh" laag
  _buildCandyMidRing();           // Phase 11A — mid-ground prop ring
  _buildCandyMidVariety();        // Phase 12B — geometry variation in mid-band
  _buildCandyDonutHoops();        // Phase 12D — floating donut-hoops over track
  _buildCandyLollipopGroupLights(); // Phase 13B — practical cluster-lights
  _buildCandyStacks();            // Phase 15 Step 3 — merged-geo candy stacks
  _buildCandyWrappers();          // Phase 15 Step 4 — wrapped candies (4 IMs)
  _buildPeppermintScatter();      // Mockup pass — peppermint disks on grass
  _buildCandyHorizonSpecks();     // V3 prop-herontwerp Laag 3 — diepte-scatter richting horizon
  _buildCandyHorizonBigs();       // Taak 3 — grote horizon-silhouetten tegen donkere zenith
  // Chocolate-fountain bridge signature moment — drips lap 2, melts lap 3.
  if(typeof buildCandyChocoBridge==='function')buildCandyChocoBridge();
  // GLTF candy props — opt-in extra detail next to procedural ice-cream
  // cones / lollipops / gummy bears. No-op when cache is empty.
  if(window.spawnRoadsideProps){
    window.spawnRoadsideProps('candy',{
      propKeys:['candy_lollipop','candy_cane','gumdrop'],
      count:8, sizeHint:1.8, clusterSize:2,
    });
  }
}


// Phase 13B — Light-grouping pattern: 44-52 lollipops would blow het
// light-budget als ze elk een PointLight kregen. Group every 8 sequential
// lollipops naar 1 shared PointLight op cluster centroid. Result: 6
// desktop / 3 mobile cluster lights ipv 44+. Color = matching head emissive.
// Pattern reusable voor andere worlds met veel instanced emissive props.
function _buildCandyLollipopGroupLights(){
  if(!_candyLollipops.length)return;
  if(typeof trackLightList==='undefined')return;
  const headColors=[0xff2266,0xff8800,0x22ccff,0xaadd00,0xcc44ff,0xff44aa,0xffcc00,0x44ddbb];
  const groupSize = window._isLowDensity() ? 14 : 8;  // low-density coarser grouping
  for(let i=0;i<_candyLollipops.length;i+=groupSize){
    // Compute centroid of next groupSize lollipops
    let cx=0, cz=0, n=0;
    for(let j=i;j<Math.min(i+groupSize, _candyLollipops.length);j++){
      cx += _candyLollipops[j].position.x;
      cz += _candyLollipops[j].position.z;
      n++;
    }
    if(n===0)continue;
    cx /= n; cz /= n;
    const col = headColors[(i/groupSize)|0 % headColors.length];
    // V2 grim: cluster-lights stevig dimmen (was 0.7) — ze fungeerden als
    // egale ambient-vulling langs de hele baan, wat het "donkere dalen"
    // contrast saboteerde. Carnival lamp-poles dragen het werk nu.
    const pl = new THREE.PointLight(col, 0.25, 14, 2);
    pl.position.set(cx, 5, cz);
    pl.castShadow = false;
    scene.add(pl);
    trackLightList.push(pl);
  }
}

// Verlaten-pretpark V1 — practische cinematic lamp-poles met candy-
// kleurige cones langs de baan. Het contrast tussen donker basisniveau
// en deze lokale licht-eilanden maakt de vibe; gumdrops/canes/cake
// pakken hun kleur op binnen de lamp-pool, daarbuiten silhouet.
// Hergebruikt cinematic.js buildCinematicLightPole (P8 config-driven).
// Stratified t-spawn (P2) langs trackCurve voor even verdeling.
function _buildCandyCarnivalLights(){
  if(typeof buildCinematicLightPole!=='function')return;
  if(typeof trackCurve==='undefined'||!trackCurve)return;
  // V2 grim: minder lampen (8/4 ipv 10/5) maar feller per stuk + compactere
  // pools — duidelijkere "lichte eilanden vs donkere dalen". +1 lamp t.o.v.
  // voorgestelde 7/4 als coverage-mitigatie zodat snoep niet té onleesbaar
  // wegvalt buiten de pools.
  const count = (typeof _mobCount==='function') ? _mobCount(8) : (window._isMobile?4:8);
  // Candy-palette cyclus — magenta, mint, amber, lilac, peach.
  const palette = [0xff66aa, 0x88ffcc, 0xffaa55, 0xcc88ff, 0xff8866];
  const tmpV = new THREE.Vector3();
  // V3 prop-herontwerp: anchors expose'n zodat mid-prop helpers
  // emissive props rond lamp-pool clusteren ("licht-eilanden vs donkere dalen").
  const anchors = [];
  for(let i=0;i<count;i++){
    // Skip-region rond start/finish: bias t∈[0.05, 0.95] zodat geen pole
    // op de startgrid landt. Stratified ((i+rand)/count)%1 liet i=0
    // (t∈[0, 0.125]) en i=count-1 (t∈[0.875, 1]) anders de start-area raken.
    const t = 0.05 + ((i + Math.random()) / count) * 0.90;
    anchors.push(t);
    const p = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    // Perpendicular naar tangent (XZ-vlak), alternerend links/rechts.
    const side = (i % 2 === 0) ? 1 : -1;
    const offset = 18 + Math.random()*4;  // 18-22u van baan-centrum
    tmpV.set(p.x - tg.z * offset * side, 0, p.z + tg.x * offset * side);
    buildCinematicLightPole(scene, tmpV, {
      color: palette[i % palette.length],
      intensity: 3.6,        // V2 grim: feller binnen pool (was 2.2)
      range: 22,             // V2 grim: compactere pool (was 28) — donkerdere dalen ertussen
      height: 8,
      poolRadius: 6,
      castVolumetricCone: true,
      castGroundPool: true,
      castHalo: true,
    });
  }
  window._candyLampAnchors = anchors;
}

// Verlaten-pretpark V1 — ground fog + blinking warning-markers.
// Ground fog geeft de pretpark-mist tussen attracties; markers
// (slow-pulse rood + solid amber) zijn de "deze attractie nog half
// in bedrijf"-signalen op verre punten. Mobile clampt fog-layers
// naar 1 (helper doet dit ook auto, expliciet voor budget-garantie).
function _buildCandyCarnivalMist(){
  if(typeof trackCurve==='undefined'||!trackCurve)return;
  if(typeof buildCinematicGroundFog==='function'){
    buildCinematicGroundFog(scene, {
      color: 0x2a1838,
      density: 0.45,
      height: 4.5,
      layerCount: window._isMobile ? 1 : 3,
      layerSpacing: 2.0,
      size: 900,
      scrollDir: [1, 0.3],
      scrollSpeed: 0.08,
      fadeWithDistance: true,
    });
  }
  if(typeof buildCinematicBlinkingMarker!=='function')return;
  const markerCount = (typeof _mobCount==='function') ? _mobCount(6) : (window._isMobile?3:6);
  const tmpV = new THREE.Vector3();
  for(let i=0;i<markerCount;i++){
    const t = ((i + 0.5) / markerCount) % 1;
    const p = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    // Markers verder van baan (60-80u offset) voor "achtergrond-warning"
    // feel; verticaal verspreid 12-22u voor variatie.
    const side = (i % 2 === 0) ? 1 : -1;
    const off = 60 + Math.random()*20;
    const yy = 12 + Math.random()*10;
    tmpV.set(p.x - tg.z * off * side, yy, p.z + tg.x * off * side);
    // Alterneer rood slow-pulse en amber solid.
    const isRed = (i % 2 === 0);
    buildCinematicBlinkingMarker(scene, tmpV, {
      color: isRed ? 0xff4455 : 0xffaa44,
      pattern: isRed ? 'slow-pulse' : 'solid',
      intensity: 1.5,
      range: 20,
      haloSize: 1.6,
      blinkInterval: 2.4,
    });
  }
}

// Taak 1 — Large-scale candy landmarks. Individuele meshes (geen
// instancing) in candy-taal: reuzen-lolly, zuurstok-pilaar, snoepbol,
// stack-toren, gumdrop. Silhouet, geen emissive — diepte/schaal-anker
// tegen de paarse lucht. Mix van baken langs spline + verspreid in veld.
// Constants in de constants-block bovenaan; finetune daar, niet hier.
function _buildCandyCarnivalLandmarks(){
  if(typeof trackCurve==='undefined'||!trackCurve) return;
  const isMobile = window._isMobile;
  const count = isMobile ? CANDY_LANDMARK_COUNT_MOBILE : CANDY_LANDMARK_COUNT_DESKTOP;
  const splineCount = Math.ceil(count / 2);
  const fieldCount  = count - splineCount;
  // Subtiele warm-paarse emissive zodat de silhouetten als volume lezen
  // i.p.v. als zwarte gaten in de midnight-sky. Gradient near→far: dichterbij
  // krijgt iets meer interne luminantie. Houdt het grimmig-donker karakter.
  const matNear = new THREE.MeshLambertMaterial({color: CANDY_LANDMARK_COL_NEAR, emissive: 0x3a2050, emissiveIntensity: 0.08});
  const matMid  = new THREE.MeshLambertMaterial({color: CANDY_LANDMARK_COL_MID,  emissive: 0x2a1840, emissiveIntensity: 0.06});
  const matFar  = new THREE.MeshLambertMaterial({color: CANDY_LANDMARK_COL_FAR,  emissive: 0x201230, emissiveIntensity: 0.04});

  function pickMat(offset){
    if(offset < CANDY_LANDMARK_MAT_NEAR_BELOW) return matNear;
    if(offset < CANDY_LANDMARK_MAT_MID_BELOW)  return matMid;
    return matFar;
  }

  // Project t + lateral offset (side ±1) → XZ.
  function curvePos(t, offset, side){
    const p  = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    return new THREE.Vector3(p.x + (-tg.z) * offset * side, 0, p.z + tg.x * offset * side);
  }

  // Factory — random shape uit candy-taal repertoire, minimaal detail
  // (silhouet is wat telt). Hoogte komt extern; alle ratios relatief.
  function makeLandmark(height, mat){
    const grp = new THREE.Group();
    const type = Math.floor(Math.random() * 5);
    if(type === 0){
      // Reuzen-lolly — dunne stok + flat disc op top.
      const stickH = height * 0.78;
      const stick  = new THREE.Mesh(
        new THREE.CylinderGeometry(height*0.035, height*0.04, stickH, 6), mat
      );
      stick.position.y = stickH / 2;
      grp.add(stick);
      const discR = height * 0.30;
      const disc  = new THREE.Mesh(
        new THREE.CylinderGeometry(discR, discR, height*0.06, 14), mat
      );
      disc.position.y = stickH;
      disc.rotation.x = Math.PI / 2;
      grp.add(disc);
    } else if(type === 1){
      // Zuurstok-pilaar — dikke cylinder + ronde dop.
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(height*0.10, height*0.12, height, 10), mat
      );
      pillar.position.y = height / 2;
      grp.add(pillar);
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(height*0.11, 10, 6, 0, Math.PI*2, 0, Math.PI/2), mat
      );
      cap.position.y = height;
      grp.add(cap);
    } else if(type === 2){
      // Reuzen-snoepbol (jawbreaker) — grote sphere op grond.
      const r = height * 0.45;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
      ball.position.y = r;
      grp.add(ball);
    } else if(type === 3){
      // Stack-toren — meerdere discs op centrale pole.
      const layers = 4 + Math.floor(Math.random() * 3);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(height*0.04, height*0.04, height, 6), mat
      );
      pole.position.y = height / 2;
      grp.add(pole);
      const layerH = height / layers * 0.55;
      for(let l = 0; l < layers; l++){
        const layerR = height * 0.22 * (1 - l * 0.08);
        const disc = new THREE.Mesh(
          new THREE.CylinderGeometry(layerR, layerR, layerH, 12), mat
        );
        disc.position.y = (l + 0.5) * height / layers;
        grp.add(disc);
      }
    } else {
      // Reuzen-gumdrop — half-sphere zittend op grond.
      const r = height * 0.90;
      const gum = new THREE.Mesh(
        new THREE.SphereGeometry(r, 14, 10, 0, Math.PI*2, 0, Math.PI/2), mat
      );
      gum.position.y = 0;
      grp.add(gum);
    }
    return grp;
  }

  function placeLandmark(t, offset, side){
    const height = CANDY_LANDMARK_HEIGHT_MIN
                 + Math.random() * (CANDY_LANDMARK_HEIGHT_MAX - CANDY_LANDMARK_HEIGHT_MIN);
    const mat    = pickMat(offset);
    const lm     = makeLandmark(height, mat);
    const pos    = curvePos(t, offset, side);
    lm.position.set(pos.x, 0, pos.z);
    lm.rotation.y = Math.random() * Math.PI * 2;
    lm.userData = {_noLodCull: true};
    scene.add(lm);
  }

  // Spline-baken — gespreid op gelijke t-intervallen (deterministisch
  // genoeg dat de gameplay-pacing herkenbare ankers heeft, met random
  // jitter binnen het interval om grid-look te breken).
  for(let i = 0; i < splineCount; i++){
    const slot   = (i + Math.random() * 0.6 + 0.2) / splineCount; // jitter
    const t      = slot % 1;
    const offset = CANDY_LANDMARK_SPLINE_OFFSET_MIN
                 + Math.random() * (CANDY_LANDMARK_SPLINE_OFFSET_MAX - CANDY_LANDMARK_SPLINE_OFFSET_MIN);
    const side   = (i % 2 === 0) ? 1 : -1; // alternerend zodat ze niet op één zij staan
    placeLandmark(t, offset, side);
  }
  // Veld-landmarks — random t + grotere offset, mogen klein-cluster
  // vormen. Alternerende side i.p.v. RNG: met fieldCount ≈ 4 desktop / 2
  // mobile gaf Math.random()<.5 makkelijk een 3:1 L/R bias, en gestapeld
  // op horizon-specks + horizon-bigs (zelfde RNG-side fout) leesbaar als
  // duidelijk te veel landmarks links.
  for(let i = 0; i < fieldCount; i++){
    const t      = Math.random();
    const offset = CANDY_LANDMARK_FIELD_OFFSET_MIN
                 + Math.random() * (CANDY_LANDMARK_FIELD_OFFSET_MAX - CANDY_LANDMARK_FIELD_OFFSET_MIN);
    const side   = (i % 2 === 0) ? 1 : -1;
    placeLandmark(t, offset, side);
  }
}

// Phase 12D — signature: floating donut-hoops over track. 5 desktop /
// 3 mobile, perpendicular naar tangent, gekleurde pink/yellow/sprinkle.
// Cars rijden eronderdoor (lowest y=14, hoops zijn ringen).
// Phase 15 — converted to InstancedMesh (-1 draw call, +1 hoop desktop).
let _candyDonutHoops=[];
let _hoopBobDummy=null;
function _buildCandyDonutHoops(){
  if(typeof trackCurve==='undefined'||!trackCurve)return;
  _candyDonutHoops.length = 0;
  const ts = window._isLowDensity() ? [0.20, 0.55, 0.85] : [0.12, 0.27, 0.45, 0.63, 0.80, 0.92];
  const geo = new THREE.TorusGeometry(8.05, 1.6, 6, 16);
  const hoopMat = new THREE.MeshLambertMaterial({color:0xff77bb, emissive:0xff77bb, emissiveIntensity:0.55});
  const hoopIM = new THREE.InstancedMesh(geo, hoopMat, ts.length);
  const _dummy = new THREE.Object3D();
  ts.forEach((t, i) => {
    const pt = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    const baseY = 14 + Math.random()*4;
    _dummy.position.set(pt.x, baseY, pt.z);
    _dummy.rotation.y = Math.atan2(tg.x, tg.z);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    hoopIM.setMatrixAt(i, _dummy.matrix);
    _candyDonutHoops.push({userData:{_noLodCull:true, _baseY:baseY, _phase:i*1.3}, _imIdx:i, _im:hoopIM});
  });
  hoopIM.instanceMatrix.needsUpdate = true;
  hoopIM.userData = {_noLodCull:true};
  hoopIM.castShadow = false;
  if(typeof window._registerPopinSuspect==='function') window._registerPopinSuspect(hoopIM, 'candy/donut-hoops');
  scene.add(hoopIM);
  _candyNightEmissives.push({material: hoopMat});
}

// ── Solid-volume PBR helper ──────────────────────────────────────────────
//
// Proef-conversie (Candy-specifiek): solid-volume props krijgen op desktop
// een MeshStandardMaterial met envTag 'candy-glaze' zodat ze IBL-reflectie
// pakken (pastel-glaze sugar-look). Mobile blijft Lambert om PBR-shader-
// kosten te vermijden op LOW-tier waar de reflection probe toch uit staat.
// Glow-laag (donut hoops 0.55, mini gumdrops 0.22, gumdrop ring 0.18,
// candy gate red 0.3, track light heads 0.30) gaat hier NIET doorheen —
// die blijven Lambert zodat decoratieve glow behouden blijft.
//
// Usage:
//   const mat = _cMat({color:0xffffff}, {metalness:0.0, roughness:0.35}, 'candy-glaze');
function _cMat(lambertDef, stdExtras, tag){
  if(window._isMobile) return new THREE.MeshLambertMaterial(lambertDef);
  const mat = new THREE.MeshStandardMaterial(Object.assign({}, lambertDef, stdExtras));
  mat.userData = mat.userData || {};
  mat.userData.envTag = tag;
  return mat;
}

// Phase 12B — mid-band variety: tall candy-cane sticks (no head) op
// 22-52u zodat de 4-color gumdrop ring niet als enige geometry leest.
function _buildCandyMidVariety(){
  if(typeof _populateMidRing!=='function')return;
  // V3 prop-herontwerp: count 40→12 desktop, scaleMax 3.5→5.0 (echte schaal-
  // variatie), cluster rond lamp-pole anchors zodat emissive canes
  // pakken op het licht en niets opzichtigs in donkere dalen.
  const caneCount = (typeof _mobCount==='function')?_mobCount(12):12;
  const caneGeo = new THREE.CylinderGeometry(0.18, 0.22, 2, 6);
  const caneMat = _cMat({color:0xfff5f5, emissive:0xff88aa, emissiveIntensity:0.15},{metalness:0.0,roughness:0.35},'candy-glaze');
  const caneIm = new THREE.InstancedMesh(caneGeo, caneMat, caneCount*2);
  _populateMidRing(caneIm, {
    perSide: caneCount, offsetMin:22, offsetMax:52,
    // Taak 2 — scale-ranges via constants verbreed voor natuurlijke groottehiërarchie.
    scaleMin: 2.0 * CANDY_MID_SCALE_MIN_MUL,
    scaleMax: 5.0 * CANDY_MID_SCALE_MAX_MUL,
    tiltAmt:0.15, stagger:0.6,
    yFn: sc => 1.0 * sc,
    clusterAnchors: window._candyLampAnchors,
    clusterRadius: 0.05,
    _diagLabel: 'candy/mid-variety-canes',
  });
  scene.add(caneIm);
}

// Phase 15 Step 3 — candy stacks: pole + 4 discs merged into 1 IM (+1 draw call).
// Vertex-colors per sub-geometry so the single Lambert mat shows multi-color.
function _buildCandyStacks(){
  if(typeof _populateMidRing!=='function')return;
  if(typeof THREE.BufferGeometryUtils==='undefined')return;
  const poleGeo = new THREE.CylinderGeometry(0.18, 0.18, 3.2, window._isMobile?4:6);
  poleGeo.translate(0, 1.6, 0);
  const discYs = [0.6, 1.0, 1.4, 1.8];
  const discCols = [
    new THREE.Color(0xA684C8),
    new THREE.Color(0xE5A2C8),
    new THREE.Color(0x9ED8A8),
    new THREE.Color(0xE5A2C8)
  ];
  const poleColor = new THREE.Color(0xffffff);
  // Assign vertex colors to pole geometry
  const polePosCount = poleGeo.attributes.position.count;
  const poleColArr = new Float32Array(polePosCount * 3);
  for(let i=0;i<polePosCount;i++){
    poleColArr[i*3]=poleColor.r; poleColArr[i*3+1]=poleColor.g; poleColArr[i*3+2]=poleColor.b;
  }
  poleGeo.setAttribute('color', new THREE.Float32BufferAttribute(poleColArr, 3));
  const parts = [poleGeo];
  for(let d=0;d<4;d++){
    const dGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.35, window._isMobile?8:12);
    dGeo.translate(0, discYs[d], 0);
    const dPosCount = dGeo.attributes.position.count;
    const dColArr = new Float32Array(dPosCount * 3);
    const dc = discCols[d];
    for(let i=0;i<dPosCount;i++){
      dColArr[i*3]=dc.r; dColArr[i*3+1]=dc.g; dColArr[i*3+2]=dc.b;
    }
    dGeo.setAttribute('color', new THREE.Float32BufferAttribute(dColArr, 3));
    parts.push(dGeo);
  }
  const stackGeo = THREE.BufferGeometryUtils.mergeBufferGeometries(parts);
  if(!stackGeo) return;
  const mat = _cMat({vertexColors:true, emissive:new THREE.Color(0xff66aa), emissiveIntensity:0.15},{metalness:0.0,roughness:0.30},'candy-glaze');
  // V3 prop-herontwerp: count 24→8, scaleMax 1.4→2.0, cluster rond anchors.
  const count = (typeof _mobCount==='function') ? _mobCount(8) : 8;
  const stackIm = new THREE.InstancedMesh(stackGeo, mat, count*2);
  _populateMidRing(stackIm, {
    perSide: count, offsetMin:20, offsetMax:50,
    // Taak 2 — verbrede scale-band via multipliers.
    scaleMin: 1.0 * CANDY_MID_SCALE_MIN_MUL,
    scaleMax: 2.0 * CANDY_MID_SCALE_MAX_MUL,
    stagger:0.3,
    yFn: () => 0,
    clusterAnchors: window._candyLampAnchors,
    clusterRadius: 0.05,
    _diagLabel: 'candy/stacks',
  });
  scene.add(stackIm);
  _candyNightEmissives.push({material: mat});
}

// Phase 15 Step 4 — wrapped candies: 4 IMs (1 per color) for color variety (+4 draw calls).
// Lambert does not support instanceColor, so pattern mirrors gumdrop ring (4 IMs).
function _buildCandyWrappers(){
  // Mockup pass: use buildWrappedCandyCluster (ellipsoid body + 2 twist-
  // end cones per candy) i.p.v. de huidige kale ellipsoid-only versie.
  // Track-aware positie-generatie vervangt _populateMidRing.
  if(window.SugarRushProps && SugarRushProps.buildWrappedCandyCluster && typeof trackCurve!=='undefined'){
    // V3 prop-herontwerp: count 10→4 per side. Anchor-clustering — wrappers
    // clusteren rond lamp-pole t-posities ipv stratified spread, zodat
    // emissive candy-kleuren onder de pools "knallen" en de dalen leeg blijven.
    const count = (typeof _mobCount==='function') ? _mobCount(4) : 4;
    const anchors = window._candyLampAnchors && window._candyLampAnchors.length ? window._candyLampAnchors : null;
    const positions = [];
    const offMin = 14, offMax = 42;
    const clusterR = 0.05;
    for(let i = 0; i < count * 2; i++){
      let t;
      if(anchors){
        const a = anchors[Math.floor(Math.random()*anchors.length)];
        t = ((a + (Math.random()*2-1)*clusterR) % 1 + 1) % 1;
      } else {
        t = ((i / (count * 2)) + Math.random() * 0.04) % 1;
      }
      const p = trackCurve.getPoint(t);
      const tg = trackCurve.getTangent(t).normalize();
      const nr = new THREE.Vector3(-tg.z, 0, tg.x);
      const side = (i % 2 === 0) ? 1 : -1;
      const offset = (BARRIER_OFF || 14) + offMin + Math.random() * (offMax - offMin);
      positions.push({
        x: p.x + nr.x * side * offset,
        z: p.z + nr.z * side * offset,
        rot: Math.random() * Math.PI,
      });
    }
    const cluster = SugarRushProps.buildWrappedCandyCluster(positions);
    if(typeof window._registerPopinSuspect==='function'){
      cluster.children.forEach((im,i) => window._registerPopinSuspect(im, 'candy/wrappers-cluster['+i+']'));
    }
    scene.add(cluster);
    _pushCandyEmissiveTree(cluster);
    return;
  }
  // Fallback: pre-mockup pad (ellipsoid spheres only, geen twist-ends).
  if(typeof _populateMidRing!=='function')return;
  const geo = new THREE.SphereGeometry(0.35, window._isMobile?6:10, window._isMobile?4:6);
  geo.scale(1.6, 1, 1);
  const wrapColors = [0xee4466, 0xffd040, 0xff88cc, 0xaa66dd];
  // V3 fallback: count 10→4, scaleMax 1.5→2.2, cluster.
  const count = (typeof _mobCount==='function') ? _mobCount(4) : 4;
  for(let ci=0;ci<wrapColors.length;ci++){
    const col = wrapColors[ci];
    const mat = _cMat({color:col, emissive:new THREE.Color(col), emissiveIntensity:0.15},{metalness:0.0,roughness:0.35},'candy-glaze');
    const im = new THREE.InstancedMesh(geo, mat, count*2);
    _populateMidRing(im, {
      perSide: count, offsetMin:14, offsetMax:42,
      // Taak 2 — verbrede scale-band via multipliers.
      scaleMin: 1.0 * CANDY_MID_SCALE_MIN_MUL,
      scaleMax: 2.2 * CANDY_MID_SCALE_MAX_MUL,
      stagger:ci*0.25,
      yFn: () => 0.4,
      clusterAnchors: window._candyLampAnchors,
      clusterRadius: 0.05,
      _diagLabel: 'candy/wrappers-fallback['+ci+']',
    });
    scene.add(im);
    _candyNightEmissives.push({material: mat});
  }
}

// Mockup pass — peppermint disks scattered on the grass alongside the
// track. SugarRushProps.buildPeppermintScatter is one InstancedMesh, so
// the whole scatter is one draw call. Positions are sampled along the
// track curve with a wide lateral offset so they sit clearly off-road.
function _buildPeppermintScatter(){
  if(!(window.SugarRushProps && SugarRushProps.buildPeppermintScatter)) return;
  if(typeof trackCurve==='undefined') return;
  // V3 prop-herontwerp: 18→8 desktop, scale 0.7-1.4 → 0.9-1.8 (echte
  // schaalvariatie). Peppermint is matter (geen emissive) → BLIJFT
  // uniform-stratified, vult de "donkere dalen" met silhouet-detail
  // ipv overal te clusteren rond licht.
  const N = window._isLowDensity() ? 4 : 8;
  const positions = [];
  for(let i = 0; i < N; i++){
    const t = ((i / N) + Math.random() * 0.05) % 1;
    const p = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    const nr = new THREE.Vector3(-tg.z, 0, tg.x);
    const side = (i % 2 === 0) ? 1 : -1;
    const offset = (BARRIER_OFF || 14) + 8 + Math.random() * 32;
    positions.push({
      x: p.x + nr.x * side * offset,
      z: p.z + nr.z * side * offset,
      scale: 0.9 + Math.random() * 0.9,
    });
  }
  const peppermintGroup = SugarRushProps.buildPeppermintScatter(positions);
  if(typeof window._registerPopinSuspect==='function'){
    peppermintGroup.children.forEach((im,i) => window._registerPopinSuspect(im, 'candy/peppermint-scatter['+i+']'));
  }
  scene.add(peppermintGroup);
}

// V3 prop-herontwerp Laag 3 — Diepte-scatter. Donker-paarse silhouet-
// blokken ver van de baan (offset 200-380u) zodat de wereld niet abrupt
// ophoudt bij de baanrand. Géén emissive, géén detail — puur "specks"
// richting horizon voor diepte-illusie. Single InstancedMesh → 1 draw call.
function _buildCandyHorizonSpecks(){
  if(typeof trackCurve==='undefined'||!trackCurve) return;
  const count = (typeof _mobCount==='function') ? _mobCount(12) : 12;
  const geo = new THREE.BoxGeometry(4, 6, 4);
  const mat = new THREE.MeshLambertMaterial({color: 0x120818});
  const im = new THREE.InstancedMesh(geo, mat, count);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const e = new THREE.Euler();
  const nr = new THREE.Vector3();
  for(let i=0; i<count; i++){
    const t = Math.random();
    const p = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    nr.set(-tg.z, 0, tg.x);
    // Alternerende side i.p.v. RNG (zie carnival-landmarks veld-portie).
    const side = (i % 2 === 0) ? 1 : -1;
    const offset = 200 + Math.random() * 180;  // 200-380u from track
    const sc = 1.0 + Math.random() * 1.6;
    v.set(p.x + nr.x * offset * side, 0, p.z + nr.z * offset * side);
    e.set(0, Math.random() * Math.PI * 2, 0);
    q.setFromEuler(e);
    s.set(sc * 0.8, sc * (1 + Math.random()*1.2), sc * 0.8);
    m4.compose(v, q, s);
    im.setMatrixAt(i, m4);
  }
  im.instanceMatrix.needsUpdate = true;
  im.userData = {_noLodCull: true};
  if(typeof window._registerPopinSuspect==='function') window._registerPopinSuspect(im, 'candy/horizon-specks');
  scene.add(im);
}

// Taak 3 — Horizon-band silhouetten ("bigs"). Grote vage candy-vormen
// op de verste afstand zodat tegen de donkere zenith (#0e0820 uit V3
// optie D) wél een leesbare silhouet-laag staat — gradient-tegen-
// gradient. Compensatie voor de horizon-specks die daar te dun
// tegen wegvielen. Maskeert tegelijk de sky-naad-overgang. Individuele
// meshes (geen instancing): met 4-8 stuks is silhouet-variatie per shape
// meer waard dan instancing-winst.
function _buildCandyHorizonBigs(){
  if(typeof trackCurve==='undefined'||!trackCurve) return;
  const isMobile = window._isMobile;
  const count = isMobile ? CANDY_HORIZON_BIGS_COUNT_MOBILE : CANDY_HORIZON_BIGS_COUNT_DESKTOP;
  // Zelfde emissive-aanpak als landmarks: leesbaar als silhouet i.p.v. gat,
  // intensiteit het laagst omdat horizon-bigs het verst staan.
  const mat = new THREE.MeshLambertMaterial({color: CANDY_HORIZON_BIGS_COL, emissive: 0x32204a, emissiveIntensity: 0.05});
  const group = new THREE.Group();
  group.userData = {_noLodCull: true};
  const nr = new THREE.Vector3();
  for(let i = 0; i < count; i++){
    const t      = Math.random();
    const p      = trackCurve.getPoint(t);
    const tg     = trackCurve.getTangent(t).normalize();
    nr.set(-tg.z, 0, tg.x);
    // Alternerende side i.p.v. RNG (zie carnival-landmarks veld-portie).
    const side   = (i % 2 === 0) ? 1 : -1;
    const offset = CANDY_HORIZON_BIGS_OFFSET_MIN
                 + Math.random() * (CANDY_HORIZON_BIGS_OFFSET_MAX - CANDY_HORIZON_BIGS_OFFSET_MIN);
    const height = CANDY_HORIZON_BIGS_HEIGHT_MIN
                 + Math.random() * (CANDY_HORIZON_BIGS_HEIGHT_MAX - CANDY_HORIZON_BIGS_HEIGHT_MIN);
    const x = p.x + nr.x * offset * side;
    const z = p.z + nr.z * offset * side;
    // Drie candy-vormen — random keuze per big. Allemaal minimaal detail
    // omdat ze op ~400-700u afstand staan en alleen silhouet-bijdrage leveren.
    const shape = Math.floor(Math.random() * 3);
    let mesh;
    if(shape === 0){
      // Grote snoepbol — sphere op grond.
      const r = height * 0.50;
      mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat);
      mesh.position.set(x, r, z);
    } else if(shape === 1){
      // Zuurstok-pilaar — dikke cylinder met ronde dop.
      const pillar = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(height*0.13, height*0.16, height, 10), mat
      );
      body.position.y = height / 2;
      pillar.add(body);
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(height*0.14, 10, 6, 0, Math.PI*2, 0, Math.PI/2), mat
      );
      cap.position.y = height;
      pillar.add(cap);
      pillar.position.set(x, 0, z);
      mesh = pillar;
    } else {
      // Reuzen-gumdrop — half-sphere op grond, breed.
      const r = height * 0.85;
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(r, 12, 8, 0, Math.PI*2, 0, Math.PI/2), mat
      );
      mesh.position.set(x, 0, z);
    }
    mesh.rotation.y = Math.random() * Math.PI * 2;
    group.add(mesh);
  }
  scene.add(group);
}

// Phase 12A — close-band foreground. Mini gumdrops (4 kleuren) op 6-13u
// plus witte candy-cane sticks op 8-14u. Geeft "whoosh"-detail elke meter.
function _buildCandyCloseBand(){
  if(typeof _populateMidRing!=='function')return;
  // V3 prop-herontwerp: mini-gumdrops perColor 12→3 (96→24 totaal),
  // caneCount 30→8. Beiden emissive → cluster rond lamp-pole anchors.
  // scaleMax bumpen voor variatie zodat de overlevenden zichtbaar zijn.
  const COLS=[0xff6699,0xffeb66,0xa3e056,0xc77dff];
  const perColor = (typeof _mobCount==='function')?_mobCount(3):3;
  const miniGeo = new THREE.SphereGeometry(0.6, 6, 4, 0, Math.PI*2, 0, Math.PI/2);
  COLS.forEach((col, ci) => {
    const mat = new THREE.MeshLambertMaterial({color:col, emissive:col, emissiveIntensity:0.22});
    const im = new THREE.InstancedMesh(miniGeo, mat, perColor*2);
    _populateMidRing(im, {
      perSide: perColor, offsetMin:6, offsetMax:13,
      // Taak 2 — verbrede scale-band via multipliers.
      scaleMin: 0.9 * CANDY_MID_SCALE_MIN_MUL,
      scaleMax: 2.0 * CANDY_MID_SCALE_MAX_MUL,
      stagger:0.1+ci*0.2,
      yFn: () => 0.4,
      clusterAnchors: window._candyLampAnchors,
      clusterRadius: 0.05,
      _diagLabel: 'candy/close-band-mini['+ci+']',
    });
    scene.add(im);
  });
  // Candy-cane sticks — thin white cylinders, slight random tilt
  const caneCount = (typeof _mobCount==='function')?_mobCount(8):8;
  const caneGeo = new THREE.CylinderGeometry(0.18, 0.22, 2, 6);
  const caneMat = _cMat({color:0xfff5f5, emissive:0xff88aa, emissiveIntensity:0.1},{metalness:0.0,roughness:0.35},'candy-glaze');
  const caneIm = new THREE.InstancedMesh(caneGeo, caneMat, caneCount*2);
  _populateMidRing(caneIm, {
    perSide: caneCount, offsetMin:8, offsetMax:14,
    // Taak 2 — verbrede scale-band via multipliers.
    scaleMin: 1.0 * CANDY_MID_SCALE_MIN_MUL,
    scaleMax: 2.2 * CANDY_MID_SCALE_MAX_MUL,
    tiltAmt:0.18, stagger:0.25,
    yFn: () => 1.0,
    clusterAnchors: window._candyLampAnchors,
    clusterRadius: 0.05,
    _diagLabel: 'candy/close-band-canes',
  });
  scene.add(caneIm);
}

// Phase 11A — gumdrop mid-ground prop ring. 4 colors as separate IM (one
// per color, both sides combined). Staggered placement per color so the
// rings interleave instead of overlap.
function _buildCandyMidRing(){
  if(typeof _populateMidRing!=='function')return;
  // V3 prop-herontwerp: perSide 60→15 (240→60 totaal over 4 kleuren),
  // scaleMax 1.4→2.4, cluster rond lamp-pole anchors.
  const COLS=[0xff6699,0xffeb66,0xa3e056,0xc77dff];  // pink/yellow/green/purple
  const perSide = (typeof _mobCount==='function')?_mobCount(15):15;
  const geo = new THREE.SphereGeometry(1.8, 8, 6, 0, Math.PI*2, 0, Math.PI/2);
  COLS.forEach((col, ci) => {
    const mat = new THREE.MeshLambertMaterial({color:col, emissive:col, emissiveIntensity:0.18});
    const im  = new THREE.InstancedMesh(geo, mat, perSide*2);
    _populateMidRing(im, {
      perSide: perSide, offsetMin:22, offsetMax:52,
      // Taak 2 — verbrede scale-band via multipliers.
      scaleMin: 0.9 * CANDY_MID_SCALE_MIN_MUL,
      scaleMax: 2.4 * CANDY_MID_SCALE_MAX_MUL,
      stagger: ci/4,
      clusterAnchors: window._candyLampAnchors,
      clusterRadius: 0.05,
      _diagLabel: 'candy/mid-ring-gumdrops['+ci+']',
    });
    scene.add(im);
  });
}

function buildCandyGround(){
  // V2 grim: ground + infield naar donkere asfalt-tinten ipv pastel mint/
  // roze. Hoofdoorzaak "egale verlichting" V1 was de mint/roze grond die
  // overal z'n pastel-DNA bleef tonen ondanks lage ambient. frostingGlaze
  // texture-map blijft als bump-detail; alleen baseColor + material color
  // verschuiven naar donker indigo. Spot circles en castle/cake area-zones
  // blijven kleurig (lokale snoep-detailing).
  const _candyGroundMap=(window.ProcTextures&&ProcTextures.frostingGlaze)
    ? ProcTextures.frostingGlaze({repeatX:12,repeatY:12,baseColor:'#2a2335',bumpAlpha:0.30,sprinkles:false})
    : null;
  const gMat=_cMat({color:0x2a2335,map:_candyGroundMap},{metalness:0.0,roughness:0.92},'candy-glaze');
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(2400,2400),gMat);
  ground.rotation.x=-Math.PI/2;ground.position.y=-.12;ground.receiveShadow=true;
  ground.userData._isProcGround=true; // Phase 5 hookable
  scene.add(ground);
  // Infield: zwart-aubergine, geen pastel-roze meer.
  const _infMap=(window.ProcTextures&&ProcTextures.frostingGlaze)
    ? ProcTextures.frostingGlaze({repeatX:6,repeatY:6,baseColor:'#1a1428',bumpAlpha:0.30,sprinkles:false})
    : null;
  const infMat=_cMat({color:0x1a1428,map:_infMap},{metalness:0.0,roughness:0.92},'candy-glaze');
  const inf=new THREE.Mesh(new THREE.PlaneGeometry(440,580),infMat);
  inf.rotation.x=-Math.PI/2;inf.position.set(-40,-.11,-60);scene.add(inf);
  // Coloured candy spot circles on the ground (keep — small visual texture).
  const spotColors=[0xff6688,0xffcc44,0x88eebb,0x88aaff,0xff99cc,0xffee88];
  for(let i=0;i<28;i++){
    const col=spotColors[i%spotColors.length];
    const r=6+Math.random()*10;
    const sm=_cMat({color:col,transparent:true,opacity:.55},{metalness:0.0,roughness:0.92},'candy-glaze');
    const sp=new THREE.Mesh(new THREE.CircleGeometry(r,12),sm);
    sp.rotation.x=-Math.PI/2;
    sp.position.set((Math.random()-.5)*700,.01,(Math.random()-.5)*700);
    scene.add(sp);
  }
  // Mockup pass: green grass tufts scatter across the grasvlakte. Single
  // InstancedMesh — no draw-call hit. Positions are random but biased
  // away from the track curve so they don't poke through the road.
  if(window.SugarRushProps && SugarRushProps.buildGrassTufts){
    const TUFT_N = window._isLowDensity() ? 25 : 50;
    const tufts = [];
    for(let i=0;i<TUFT_N;i++){
      // Random ring 60..220 from origin; minimum 12u beyond barrier offset.
      const r = 60 + Math.random()*160;
      const a = Math.random()*Math.PI*2;
      tufts.push({ x: Math.cos(a)*r, z: Math.sin(a)*r });
    }
    scene.add(SugarRushProps.buildGrassTufts(tufts));
  }
}


function buildCandySky(){
  // Mockup pass: replace the rainbow-arc torus rings with a twilight-purple
  // sky-dome + rose-tinted stars. The mockup screenshot shows a deep purple
  // gradient sky with sparse stars — rainbow arc would tonally clash and
  // isn't visible in the reference.
  if(window.SugarRushProps && SugarRushProps.buildCandyTwilightSky){
    const sky = SugarRushProps.buildCandyTwilightSky({radius: 350});
    if(sky.sky)   scene.add(sky.sky);
    if(sky.stars) scene.add(sky.stars);
    return;
  }
  // Fallback to original rainbow arc if helper missing (build never breaks).
  const rainbowColors=[0xff2200,0xff8800,0xffee00,0x44dd44,0x2299ff,0x5544ff,0xcc44ff];
  rainbowColors.forEach((col,i)=>{
    const r=260-i*14,tube=7-i*.5;
    const geo=new THREE.TorusGeometry(r,tube,6,48,Math.PI);
    const mat=new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.55-i*.02,side:THREE.DoubleSide});
    const m=new THREE.Mesh(geo,mat);
    m.rotation.x=Math.PI/2;m.position.set(-20,60+i*.4,-20);
    scene.add(m);
  });
}


function buildLollipopTrees(){
  // Phase 14: ~156 losse meshes → 3 IMs via ProcDecor.buildCandyTreeBatch.
  // Per-instance kleur uit palette ipv 52 unique materials.
  const count=window._isLowDensity()?44:52;
  const _lollipopPos=[];
  for(let i=0;i<count;i++){
    const t=(i/count+Math.random()*.008)%1;
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const side=(i%2===0?1:-1)*(BARRIER_OFF+22+Math.random()*22);
    const cx=p.x+nr.x*side+(Math.random()-.5)*5,cz=p.z+nr.z*side+(Math.random()-.5)*5;
    _lollipopPos.push({
      x:cx, z:cz,
      height:5+Math.random()*5,
      headRadius:1.8+Math.random()*.9,
      colorIdx:i%8
    });
  }
  const handle=ProcDecor.buildCandyTreeBatch(scene,_lollipopPos);
  // Night-mode emissive boost — push head IM (shared material). Lollipop-
  // cluster lights leest .position uit elke entry; ProcDecor returneert
  // lookup-objecten met {position:Vector3} dat compatibel is.
  if(handle.headIM){
    _candyNightEmissives.push(handle.headIM);
    handle.lollipopPositions.forEach(lp => _candyLollipops.push(lp));
  }
  // Mockup pass: ADD 6 (3 mobile) giant landmark lollipops via
  // SugarRushProps.buildGiantLollipop along the track at strategic t-values
  // with wider lateral offset so they read as background landmarks rather
  // than roadside decoration.
  if(window.SugarRushProps && SugarRushProps.buildGiantLollipop){
    const mobile=window._isLowDensity();
    const giantSpecs=[
      {t:0.15, side: 1, palette:[0xff3d8a,0xffffff],          h:5.5, r:1.55, twist:9,  bands:12},
      {t:0.35, side:-1, palette:[0xff9ec6,0xffffff,0xff5c9c], h:6.0, r:1.70, twist:11, bands:14},
      {t:0.55, side: 1, palette:[0x9c5cff,0xffd1ea,0xffffff], h:5.0, r:1.45, twist:7,  bands:10},
      {t:0.75, side:-1, palette:[0x44ccff,0xffffff,0xff8aff], h:5.8, r:1.60, twist:10, bands:12},
      {t:0.45, side: 1, palette:[0xffcc44,0xff3d8a],          h:4.8, r:1.40, twist:8,  bands:11},
      {t:0.85, side:-1, palette:[0x88ee99,0xffffff,0xff9ec6], h:5.2, r:1.50, twist:9,  bands:13},
    ];
    const SPECS=mobile?giantSpecs.slice(0,3):giantSpecs;
    SPECS.forEach(s=>{
      const p=trackCurve.getPoint(s.t),tg=trackCurve.getTangent(s.t).normalize();
      const nr=new THREE.Vector3(-tg.z,0,tg.x);
      const offset=BARRIER_OFF+40+Math.random()*8;
      const gx=p.x+nr.x*s.side*offset, gz=p.z+nr.z*s.side*offset;
      const lolli=SugarRushProps.buildGiantLollipop(gx, gz, {
        palette:s.palette, height:s.h, headRadius:s.r, twist:s.twist, bands:s.bands,
      });
      scene.add(lolli);
      _pushCandyEmissiveTree(lolli);
    });
  }
}


function buildCandyCanes(){
  // Phase 14: 6 cyl + torus per cane (~210 meshes) → 2 IMs via
  // ProcDecor.buildCandyCaneBatch. Vertex-color stripes ipv 6 sub-meshes.
  const count=window._isLowDensity()?22:29;
  const _canePos=[];
  for(let i=0;i<count;i++){
    const t=((i+0.5+(Math.random()-0.5)*0.4)/count)%1;
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const side=(i%2===0?1:-1)*(BARRIER_OFF+22);
    _canePos.push({
      x:p.x+nr.x*side, z:p.z+nr.z*side,
      rot:Math.atan2(tg.x,tg.z)
    });
  }
  const handle=ProcDecor.buildCandyCaneBatch(scene,_canePos,{
    lightStride:window._isLowDensity()?3:1, lightColor:0xff6688
  });
  // Night-mode boost — shaft + crook materials in emissive-list.
  if(handle.materialRefs){
    _candyNightEmissives.push({material:handle.materialRefs.shaft});
    _candyNightEmissives.push({material:handle.materialRefs.crook});
  }
  handle.pointLights.forEach(pl => _candyCandles.push(pl));
}


function buildChocolateRiver(){
  // A winding chocolate-brown strip through the infield
  const pts=[
    new THREE.Vector3(-60,.03,-220),new THREE.Vector3(-100,.03,-140),
    new THREE.Vector3(-80,.03,-60),new THREE.Vector3(-30,.03,10),
    new THREE.Vector3(40,.03,50),new THREE.Vector3(80,.03,-10),
    new THREE.Vector3(60,.03,-80),new THREE.Vector3(10,.03,-160),
  ];
  const curve=new THREE.CatmullRomCurve3(pts,false,'catmullrom',.5);
  const N=80;
  // Phase 13A — chocolate river MeshStandard glossy clearcoat-feel
  const chocoMat=new THREE.MeshStandardMaterial({
    color:0x4a2200, emissive:0x180800, emissiveIntensity:0.10,
    roughness:0.18, metalness:0.45, envMapIntensity:1.4,
    side:THREE.DoubleSide
  });
  const pos=[],idx=[];
  for(let i=0;i<=N;i++){
    const t2=i/N,pt=curve.getPoint(t2),tg2=curve.getTangent(t2).normalize();
    const nr2=new THREE.Vector3(-tg2.z,0,tg2.x);
    const w=3.5+Math.sin(i*.4)*1.0;
    const L=pt.clone().addScaledVector(nr2,-w);
    const R=pt.clone().addScaledVector(nr2,w);
    pos.push(L.x,L.y,L.z,R.x,R.y,R.z);
    if(i<N){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setIndex(idx);geo.computeVertexNormals();
  const river=new THREE.Mesh(geo,chocoMat);scene.add(river);
  _chocoHighlight=river;
  // Foam edges — thin white ribbon
  const foamMat=_cMat({color:0xffe4cc,transparent:true,opacity:.7,side:THREE.DoubleSide},{metalness:0.0,roughness:0.80},'candy-glaze');
  [-1,1].forEach(side=>{
    const fpos=[];const fidx=[];
    for(let i=0;i<=N;i++){
      const t2=i/N,pt=curve.getPoint(t2),tg2=curve.getTangent(t2).normalize();
      const nr2=new THREE.Vector3(-tg2.z,0,tg2.x);
      const w=3.5+Math.sin(i*.4)*1.0;
      const e=pt.clone().addScaledVector(nr2,side*(w+.4));
      const e2=pt.clone().addScaledVector(nr2,side*(w+1.2));
      fpos.push(e.x,.04,e.z,e2.x,.04,e2.z);
      if(i<N){const a=i*2;fidx.push(a,a+1,a+2,a+1,a+3,a+2);}
    }
    const fg=new THREE.BufferGeometry();
    fg.setAttribute('position',new THREE.Float32BufferAttribute(fpos,3));
    fg.setIndex(fidx);fg.computeVertexNormals();
    scene.add(new THREE.Mesh(fg,foamMat));
  });
}


function buildGumDropMountains(){
  // Phase 14: hemisphere+cap+sparkle per gumdrop (~42 meshes) → 3 IMs.
  const positionsFull=[
    [220,-180],[- 260,150],[190,280],[-90,-340],[310,80],[-340,-60],
    [80,-390],[-200,300],[260,-280],[-160,-220],[340,200],[-310,100],
    [110,360],[-230,-120]
  ];
  const positions = window._isLowDensity() ? positionsFull.slice(0,8) : positionsFull;
  const MIN_TRACK_DIST=42;
  function _distToTrack(px,pz){
    let m=Infinity;
    for(let t=0;t<1;t+=.02){
      const tp=trackCurve.getPoint(t);
      const d=Math.hypot(px-tp.x,pz-tp.z);
      if(d<m)m=d;
    }
    return m;
  }
  const _gumdropPos=[];
  positions.forEach(([px,pz],i)=>{
    if(_distToTrack(px,pz)<MIN_TRACK_DIST)return;
    _gumdropPos.push({
      x:px, z:pz,
      radius:14+Math.random()*12,
      height:20+Math.random()*25,
      colorIdx:i%8
    });
  });
  // Mockup pass: split positions — first 4-5 become tall cyan crystal
  // mountains (matches the in-game reference), the rest stay as gumdrops
  // for variety. Mobile gates: 2 mountains + 4 gumdrops i.p.v. 5 + 8.
  if(window.SugarRushProps && SugarRushProps.buildCrystalMountain){
    const mobile=window._isLowDensity();
    const MOUNT_N = mobile ? 2 : Math.min(5, _gumdropPos.length);
    for(let i=0;i<MOUNT_N;i++){
      const m=_gumdropPos[i];
      const mountain=SugarRushProps.buildCrystalMountain({
        height: m.height * 1.35,             // taller than the gumdrop equivalent
        radius: m.radius * 1.05,
        sides: mobile ? 5 : (i % 2 === 0 ? 6 : 7),
        shardCount: mobile ? 1 : (2 + (i % 2)),
      });
      mountain.position.set(m.x, 0, m.z);
      mountain.rotation.y = Math.random() * Math.PI;
      scene.add(mountain);
      _pushCandyEmissiveTree(mountain);
    }
    // Rest blijft gumdrops via bestaande batch
    const restGumdrops = _gumdropPos.slice(MOUNT_N);
    if(restGumdrops.length){
      ProcDecor.buildGumdropBatch(scene, restGumdrops);
    }
  } else {
    // Fallback: oude pure-gumdrop pad
    ProcDecor.buildGumdropBatch(scene,_gumdropPos);
  }
}


function buildCakeBuilding(){
  // Mockup pass: replace the 3-layer cake with a proper candy castle
  // (pink/lavender fondant body + 3 ice-cream-cone spires + dome) that
  // matches the in-game Sugar Rush reference screenshot. Candles + flames
  // + PointLights blijven bovenop — die staan in _candyCandles voor
  // night-mode toggle.
  const cx=-50,cz=-140;
  const castleScale=1.6;
  // Castle base is roughly tier-1 r=3.5 + tier-2 h=1.8+2.6+1.2 → total
  // height ~5.6 in local space → ~9u na scale 1.6. Centre spire reikt
  // tot ~12u boven base.
  if(window.SugarRushProps && SugarRushProps.buildCandyCastle){
    const castle=SugarRushProps.buildCandyCastle();
    castle.position.set(cx,0,cz);
    castle.scale.setScalar(castleScale);
    castle.rotation.y=Math.PI*0.85; // face toward track
    scene.add(castle);
    _pushCandyEmissiveTree(castle);
  } else {
    // Fallback to original cake recipe if helper missing.
    const layers=[
      {r:16,h:8,col:0xffaabb},{r:12,h:7,col:0xffccdd},{r:8,h:6,col:0xffe4ee}
    ];
    let y=0;
    layers.forEach(layer=>{
      const _layerMap=(window.ProcTextures&&ProcTextures.frostingGlaze)
        ? ProcTextures.frostingGlaze({repeatX:4,repeatY:2,baseColor:'#'+layer.col.toString(16).padStart(6,'0'),bumpAlpha:0.40,sprinkles:false})
        : null;
      const mat=_cMat({color:layer.col,map:_layerMap,emissive:new THREE.Color(layer.col),emissiveIntensity:.15},{metalness:0.0,roughness:0.30},'candy-glaze');
      const cake=new THREE.Mesh(new THREE.CylinderGeometry(layer.r-.5,layer.r,layer.h,16),mat);
      cake.position.set(cx,y+layer.h*.5,cz);scene.add(cake);
      _candyNightEmissives.push(cake);
      y+=layer.h;
    });
  }
  // Candles on top — match the castle's centre spire top (y ≈ 12 * scale)
  // i.p.v. het oude cake-top niveau. 5 desktop, 3 mobile (PointLights duur).
  const candleColors=[0xff4488,0xffcc00,0x44ccff,0xaadd00,0xff8844];
  const CCN = window._isLowDensity() ? 3 : 5;
  const candleY = 12 * castleScale;  // top of central spire area
  const candleR = 2.5 * castleScale;  // ring around centre spire
  for(let c=0;c<CCN;c++){
    const ang=c*(Math.PI*2/CCN);
    const candleMat=_cMat({color:candleColors[c]},{metalness:0.0,roughness:0.85},'candy-glaze');
    const candle=new THREE.Mesh(new THREE.CylinderGeometry(.25,.25,1.5,6),candleMat);
    candle.position.set(cx+Math.cos(ang)*candleR,candleY+.75,cz+Math.sin(ang)*candleR);scene.add(candle);
    // Flame
    const flame=new THREE.Mesh(new THREE.SphereGeometry(.28,5,4),
      new THREE.MeshBasicMaterial({color:0xffaa00}));
    flame.scale.y=1.6;flame.position.set(cx+Math.cos(ang)*candleR,candleY+1.7,cz+Math.sin(ang)*candleR);
    scene.add(flame);
    const pl=new THREE.PointLight(0xffaa44,1.2,10);
    pl.position.set(cx+Math.cos(ang)*candleR,candleY+1.8,cz+Math.sin(ang)*candleR);
    scene.add(pl);_candyCandles.push(pl);
  }
}


function buildCandyGate(){
  // Large candy cane arch over the start/finish line
  const p=trackCurve.getPoint(0),tg=trackCurve.getTangent(0).normalize();
  const nr=new THREE.Vector3(-tg.z,0,tg.x);
  const hw=TW+5;
  const redMat=new THREE.MeshLambertMaterial({color:0xee1122,emissive:0x550000,emissiveIntensity:.3});
  const whiteMat=_cMat({color:0xffffff},{metalness:0.0,roughness:0.35},'candy-glaze');
  // Two vertical columns (alternating segments)
  [-1,1].forEach(side=>{
    const base=p.clone().addScaledVector(nr,side*hw);
    for(let s=0;s<8;s++){
      const mat=s%2===0?redMat:whiteMat;
      const seg=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.9,8),mat);
      seg.position.copy(base);seg.position.y=s*.9+.45;scene.add(seg);
    }
    _candyNightEmissives.push({material:redMat});
  });
  // Arch — torus half-ring connecting the tops. The torus default axis is +Z, so rotate around Y
  // so the axis aligns with the track tangent — that puts the half-ring vertical, opening upward,
  // perpendicular to the track direction. The previous code (rotation.x=-PI/2) flattened it.
  const archMat=new THREE.MeshLambertMaterial({color:0xee1122,emissive:0x550000,emissiveIntensity:.3});
  const arch=new THREE.Mesh(new THREE.TorusGeometry(hw,.55,8,24,Math.PI),archMat);
  arch.position.copy(p);arch.position.y=8*0.9;
  arch.rotation.y=Math.atan2(tg.x,tg.z);
  scene.add(arch);
  _candyNightEmissives.push(arch);
  // Neon sign: "SUGAR RUSH" as glowing box
  const signMat=new THREE.MeshBasicMaterial({color:0xff44cc});
  const sign=new THREE.Mesh(new THREE.BoxGeometry(hw*1.5,.8,.12),signMat);
  sign.position.copy(p);sign.position.y=8*.9+1.8;
  sign.rotation.y=Math.atan2(nr.x,nr.z)+Math.PI/2;
  scene.add(sign);
  const pl=new THREE.PointLight(0xff44cc,2.5,22);pl.position.copy(p);pl.position.y=8*.9+2;
  scene.add(pl);_candyCandles.push(pl);
}


// Atmospheric floating candy-bits — slow-drifting points that hover at
// player altitude rather than falling like the sprinkle rain. 4-color
// pastel palette (pink + yellow + turquoise + purple). Recycled in a
// sphere around the player so they're always visible without infinite
// world-coverage. Visual-polish v2 §3 — gives candy a continuous gentle
// motion signature on top of the existing falling-sprinkles.
//
// Budget: 40 desktop / 18 mobile, single Points draw (same shader path
// as the sprinkles), no new materials, no per-particle meshes.
function buildFloatingCandyBits(){
  const count=window._isLowDensity()?18:40;
  const geo=new THREE.BufferGeometry();
  const pos=new Float32Array(count*3);
  const col=new Float32Array(count*3);
  const vel=new Float32Array(count*3);
  // 4-color pastel palette: pink, yellow, turquoise, purple. Each particle
  // gets one color from the cycle so the field reads as varied pastel.
  const palette=[[1.0,0.55,0.80],[1.0,0.92,0.55],[0.55,1.0,0.85],[0.80,0.65,1.0]];
  const car=carObjs[playerIdx];
  const cx=car?car.mesh.position.x:0,cz=car?car.mesh.position.z:0;
  for(let i=0;i<count;i++){
    pos[i*3]=cx+(Math.random()-.5)*120;
    pos[i*3+1]=2+Math.random()*16;        // hover altitude 2-18u
    pos[i*3+2]=cz+(Math.random()-.5)*120;
    const c=palette[i%palette.length];
    col[i*3]=c[0];col[i*3+1]=c[1];col[i*3+2]=c[2];
    // Slow lateral drift + tiny Y wobble. Speeds in units/sec.
    vel[i*3]=(Math.random()-.5)*0.6;
    vel[i*3+1]=(Math.random()-.5)*0.15;   // intentionally near-zero so they hover
    vel[i*3+2]=(Math.random()-.5)*0.6;
  }
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  const mat=new THREE.PointsMaterial({
    size:.42, vertexColors:true, transparent:true, opacity:.7,
    sizeAttenuation:true, depthWrite:false
  });
  _candyFloatBits=new THREE.Points(geo,mat);
  _candyFloatBitsGeo=geo;
  _candyFloatBitsVel=vel;
  scene.add(_candyFloatBits);
}

// Drift floating candy-bits and recycle particles that wander outside
// the 90u sphere around the player. Called from updateCandyWorld each
// frame. Updates a slice per call (rolling buffer) to keep the worst-
// case cost bounded — at 40 particles desktop / 18 mobile this is
// already negligible but the slice-pattern matches the sandstorm-storm
// particle update for consistency.
function updateFloatingCandyBits(dt){
  if(!_candyFloatBitsGeo||!_candyFloatBitsVel)return;
  const pos=_candyFloatBitsGeo.attributes.position.array;
  const vel=_candyFloatBitsVel;
  const car=carObjs[playerIdx];
  const cx=car?car.mesh.position.x:0,cz=car?car.mesh.position.z:0;
  const count=pos.length/3;
  for(let i=0;i<count;i++){
    pos[i*3]   += vel[i*3]   * dt;
    pos[i*3+1] += vel[i*3+1] * dt;
    pos[i*3+2] += vel[i*3+2] * dt;
    // Recycle if out of view-radius or below ground / above ceiling.
    const dx=pos[i*3]-cx,dz=pos[i*3+2]-cz;
    if(dx*dx+dz*dz>8100 || pos[i*3+1]<1 || pos[i*3+1]>22){
      pos[i*3]=cx+(Math.random()-.5)*120;
      pos[i*3+1]=2+Math.random()*16;
      pos[i*3+2]=cz+(Math.random()-.5)*120;
      vel[i*3]=(Math.random()-.5)*0.6;
      vel[i*3+1]=(Math.random()-.5)*0.15;
      vel[i*3+2]=(Math.random()-.5)*0.6;
    }
  }
  _candyFloatBitsGeo.attributes.position.needsUpdate=true;
}

function buildSprinkleParticles(){
  const count = window._isLowDensity() ? 280 : 600;
  const geo=new THREE.BufferGeometry();
  const pos=new Float32Array(count*3);
  const col=new Float32Array(count*3);
  const colors=[[1,.2,.4],[1,.8,.1],[.5,.9,.2],[.2,.7,1],[.8,.3,1],[1,.5,.1]];
  const car=carObjs[playerIdx];
  const cx=car?car.mesh.position.x:0,cz=car?car.mesh.position.z:0;
  for(let i=0;i<count;i++){
    pos[i*3]=(Math.random()-.5)*600+cx;
    pos[i*3+1]=Math.random()*22;
    pos[i*3+2]=(Math.random()-.5)*600+cz;
    const c=colors[i%colors.length];
    col[i*3]=c[0];col[i*3+1]=c[1];col[i*3+2]=c[2];
  }
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  const mat=new THREE.PointsMaterial({size:.55,vertexColors:true,transparent:true,opacity:.85,sizeAttenuation:true});
  _sprinkleParticles=new THREE.Points(geo,mat);
  _sprinkleGeo=geo;
  scene.add(_sprinkleParticles);
}


function buildCottonCandyClouds(){
  // Was: 18/10 clusters × 4-7 transparante spheres = 40-126 individuele
  // meshes + materialen verspreid over een 700×700 gebied — fase 2 van de
  // mobile-perf fix. Refactor groepeert alle blobs op palette-kleur en
  // gebruikt 5 InstancedMesh (1 per kleur) met gedeelde unit SphereGeometry +
  // gedeeld transparent MeshLambertMaterial. Per-instance scale draagt
  // de radius-variatie.
  const lowDensity = !!(window._isLowDensity && window._isLowDensity());
  const CC = lowDensity ? 10 : 18;
  const palette = [0xffaadd, 0xffbbee, 0xffd4f0, 0xeeccff, 0xffccaa];
  // Eerste pass: alle blob-posities + scales per kleurbucket verzamelen.
  const buckets = palette.map(() => []);
  for(let i = 0; i < CC; i++){
    const cx = (Math.random() - 0.5) * 700;
    const cz = (Math.random() - 0.5) * 700;
    const cy = 28 + Math.random() * 18;
    const bMax = lowDensity ? 4 : 7;
    const bN = bMax + Math.floor(Math.random() * (lowDensity ? 2 : 3));
    for(let b = 0; b < bN; b++){
      const colIdx = b % palette.length;
      const r = 1.8 + Math.random() * 2.5;
      buckets[colIdx].push({
        x: cx + (Math.random() - 0.5) * 5.5,
        y: cy + (Math.random() - 0.5) * 1.4,
        z: cz + (Math.random() - 0.5) * 4.5,
        r
      });
    }
  }
  // Tweede pass: per kleur 1 InstancedMesh. Unit sphere, scale = r.
  const sphereGeo = new THREE.SphereGeometry(1, lowDensity ? 8 : 12, lowDensity ? 6 : 8);
  const _dummy = new THREE.Object3D();
  for(let ci = 0; ci < palette.length; ci++){
    const blobs = buckets[ci];
    if(!blobs.length) continue;
    const mat = _cMat({
      color: palette[ci], transparent: true, opacity: 0.72
    },{metalness:0.0,roughness:0.92},'candy-glaze');
    const im = new THREE.InstancedMesh(sphereGeo, mat, blobs.length);
    for(let bi = 0; bi < blobs.length; bi++){
      const b = blobs[bi];
      _dummy.position.set(b.x, b.y, b.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(b.r);
      _dummy.updateMatrix();
      im.setMatrixAt(bi, _dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    // Source SphereGeometry zit rond origin; instances spannen 700×700.
    // Zonder dit zou de hele IM weggeculld worden zodra de camera niet
    // richting origin kijkt — zelfde issue als de candy-barriers IMs.
    im.frustumCulled = false;
    scene.add(im);
  }
}


function buildRainbowTrackStripes(){
  // Thin painted stripes across the track surface — 30 coloured chevrons.
  // Was 30 individual meshes (30 materials, 30 geometries) → 1 InstancedMesh
  // with per-instance color (6-colour cycle). Pattern from guangzhou.js
  // overhead-highway (js/worlds/guangzhou.js:2692-2749 + instanceColor).
  const stripeColors=[0xff4488,0xff8800,0xffee00,0x44dd66,0x2299ff,0xcc44ff];
  const N = 30;
  const sW=TW*.9, sD=.8;
  const stripeGeo = new THREE.PlaneGeometry(sW*2, sD);
  const stripeMat = new THREE.MeshBasicMaterial({
    color:0xffffff, transparent:true, opacity:.45, side:THREE.DoubleSide
  });
  // Same z-fight protection as the per-mesh version — applied once on the
  // shared material so every instance inherits.
  stripeMat.polygonOffset=true; stripeMat.polygonOffsetFactor=-2; stripeMat.polygonOffsetUnits=-2;
  const stripeIM = new THREE.InstancedMesh(stripeGeo, stripeMat, N);
  const _sDummy = new THREE.Object3D();
  const _sColor = new THREE.Color();
  for(let ci=0; ci<N; ci++){
    const t = (ci/N + 0.003) % 1;
    const p = trackCurve.getPoint(t), tg = trackCurve.getTangent(t).normalize();
    _sDummy.position.set(p.x, 0.013, p.z);
    // Same rotation composition as the per-mesh version: lay flat (X=-π/2)
    // then yaw with the tangent. Default Euler order XYZ matches the
    // step-by-step assignment in the original code.
    _sDummy.rotation.set(-Math.PI/2, Math.atan2(tg.x, tg.z) + Math.PI/2, 0);
    _sDummy.scale.set(1, 1, 1);
    _sDummy.updateMatrix();
    stripeIM.setMatrixAt(ci, _sDummy.matrix);
    _sColor.setHex(stripeColors[ci % stripeColors.length]);
    stripeIM.setColorAt(ci, _sColor);
  }
  stripeIM.instanceMatrix.needsUpdate = true;
  if(stripeIM.instanceColor) stripeIM.instanceColor.needsUpdate = true;
  if(typeof window._registerPopinSuspect==='function') window._registerPopinSuspect(stripeIM, 'candy/rainbow-stripes');
  scene.add(stripeIM);
}


function buildCandyBarriers(){
  // Candy cane striped walls — InstancedMesh refactor (was 400 individual
  // Mesh objects met 400 unieke materialen, geen mobile-gate). Volgt het
  // patroon van buildRainbowTrackStripes (regel 853-888): 1 gedeelde
  // BoxGeometry + 2 gedeelde MeshLambertMaterials (rood + wit), 2
  // InstancedMesh draw calls totaal i.p.v. 400. Mobile reduceert N via
  // _isLowDensity() — de BoxGeometry-diepte schaalt automatisch zodat de
  // streep-illusie sluitend blijft.
  const lowDensity = !!(window._isLowDensity && window._isLowDensity());
  const N = lowDensity ? 120 : 200;
  const segGeo = new THREE.BoxGeometry(.55, 1.1, 1.05 / (N / 200));
  const redMat = _cMat({
    color: 0xee1122, emissive: new THREE.Color(0x440000), emissiveIntensity: .2
  },{metalness:0.0,roughness:0.35},'candy-glaze');
  const whiteMat = _cMat({
    color: 0xffffff, emissive: new THREE.Color(0x111111), emissiveIntensity: .2
  },{metalness:0.0,roughness:0.92},'candy-glaze');
  // Elke side krijgt N segmenten; rood/wit alterneren per index. Totaal
  // per kleur = N (helft van 2*N). InstancedMesh capaciteit dus = N.
  const redIM = new THREE.InstancedMesh(segGeo, redMat, N);
  const whiteIM = new THREE.InstancedMesh(segGeo, whiteMat, N);
  const _dummy = new THREE.Object3D();
  let redIdx = 0, whiteIdx = 0;
  [-1, 1].forEach(side => {
    for(let si = 0; si < N; si++){
      const t = si / N;
      const p = trackCurve.getPoint(t), tg = trackCurve.getTangent(t).normalize();
      const nr = new THREE.Vector3(-tg.z, 0, tg.x);
      const pos = p.clone().addScaledVector(nr, side * BARRIER_OFF);
      _dummy.position.set(pos.x, .55, pos.z);
      _dummy.rotation.set(0, Math.atan2(tg.x, tg.z), 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      if(si % 2 === 0){
        redIM.setMatrixAt(redIdx++, _dummy.matrix);
      } else {
        whiteIM.setMatrixAt(whiteIdx++, _dummy.matrix);
      }
    }
  });
  // Unused tail-instances bestaan niet: si%2 verdeelt 2*N gelijkmatig
  // over twee N-buckets (N is altijd even — 120 of 200).
  redIM.instanceMatrix.needsUpdate = true;
  whiteIM.instanceMatrix.needsUpdate = true;
  // De source BoxGeometry zit op origin, dus Three's auto bounding-sphere
  // omsluit alleen origin — niet de per-instance posities die om de hele
  // track liggen. Zonder dit zou de hele IM weggeculld worden zodra de
  // camera niet richting origin kijkt (zelfde guard die proc-decor.js
  // toepast op _iceBarrier-batches).
  redIM.frustumCulled = false;
  whiteIM.frustumCulled = false;
  scene.add(redIM);
  scene.add(whiteIM);
  // Night-dimming: één push voor de gedeelde rood-material is voldoende —
  // night.js (regel 188, 203) zet material.emissiveIntensity, alle
  // instances volgen automatisch via shared material. Wit blijft buiten
  // de array (zoals voorheen — alleen rood gloeit 's nachts).
  _candyNightEmissives.push({material: redMat});
  // Track lights — lollipop poles. Fase 2 mobile-perf: was 96 individuele
  // meshes (48 poles + 48 heads) + 48 PointLights, geen gates. Refactor:
  // - 1 pole IM + 1 head IM (gedeelde geo's en materialen). Heads krijgen
  //   per-instance kleur via instanceColor; emissive is gedeeld (wit, lage
  //   intensiteit). Visueel: 's nachts gloeien alle heads neutraal-wit i.p.v.
  //   per-kleur — kleurnuance gaat verloren maar de PointLights blijven
  //   wel gekleurd op desktop, en de barriers/lollipops dragen de
  //   per-kleur night-glow.
  // - Mobile: skip de 48 PointLights (volcano.js:317 precedent — "Mobile
  //   skip — light count budget"). Lights aan intensity=0 zijn nog steeds
  //   in de per-material lighting-loop.
  const headColors = [0xff2266, 0xff8800, 0x22ccff, 0xaadd00, 0xcc44ff, 0xff44aa, 0xffcc00];
  const LN = 48; // 24 langs de baan × 2 zijden
  const poleGeo = new THREE.CylinderGeometry(.1, .12, 3, 5);
  const poleMat = _cMat({color: 0xffffff},{metalness:0.0,roughness:0.85},'candy-glaze');
  const headGeo = new THREE.SphereGeometry(.5, 8, 6);
  const headMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: .30
  });
  const poleIM = new THREE.InstancedMesh(poleGeo, poleMat, LN);
  const headIM = new THREE.InstancedMesh(headGeo, headMat, LN);
  poleIM.visible = false;
  headIM.visible = false;
  poleIM.frustumCulled = false;
  headIM.frustumCulled = false;
  const _dummyL = new THREE.Object3D();
  const _colL = new THREE.Color();
  const skipPointLights = !!window._isMobile;
  let idx = 0;
  for(let li = 0; li < 24; li++){
    const t = li / 24;
    const p = trackCurve.getPoint(t), tg = trackCurve.getTangent(t).normalize();
    const nr = new THREE.Vector3(-tg.z, 0, tg.x);
    for(let si = 0; si < 2; si++){
      const s = si === 0 ? -1 : 1;
      const pp = p.clone().addScaledVector(nr, s * (BARRIER_OFF + 1.5));
      const col = headColors[(li * 2 + si) % headColors.length];
      // Pole: positie op y=1.5, scale 1.
      _dummyL.position.set(pp.x, 1.5, pp.z);
      _dummyL.rotation.set(0, 0, 0);
      _dummyL.scale.set(1, 1, 1);
      _dummyL.updateMatrix();
      poleIM.setMatrixAt(idx, _dummyL.matrix);
      // Head: positie op y=3.2, scale.y=.7 voor afgeplatte bol.
      _dummyL.position.set(pp.x, 3.2, pp.z);
      _dummyL.scale.set(1, .7, 1);
      _dummyL.updateMatrix();
      headIM.setMatrixAt(idx, _dummyL.matrix);
      _colL.setHex(col);
      headIM.setColorAt(idx, _colL);
      // Per-pole PointLight alleen op desktop.
      if(!skipPointLights){
        const pl = new THREE.PointLight(col, 0, 18);
        pl.position.set(pp.x, 3.2, pp.z);
        pl.castShadow = false;
        scene.add(pl);
        trackLightList.push(pl);
      }
      idx++;
    }
  }
  poleIM.instanceMatrix.needsUpdate = true;
  headIM.instanceMatrix.needsUpdate = true;
  if(headIM.instanceColor) headIM.instanceColor.needsUpdate = true;
  scene.add(poleIM);
  scene.add(headIM);
  // night.js (regels 93, 100, 187, 202, 274, 372, 391, 401) doet
  // trackPoles.forEach(p => p.visible = X). Met IMs hoeven we maar 2
  // entries pushen i.p.v. 96 — InstancedMesh erft .visible van Object3D.
  trackPoles.push(poleIM);
  trackPoles.push(headIM);
  // Night-emissive: 1 push voor de gedeelde headMat is voldoende
  // (zelfde patroon als de candy-barriers in deze file).
  _candyNightEmissives.push({material: headMat});
}


function buildIceCreamCones(){
  // Phase 14: cone + 1-3 scoops per ice cream → 1 cone IM + 1-3 scoop IMs.
  const coneCount = window._isLowDensity() ? 9 : 16;
  const _iceCreamPos=[];
  for(let i=0;i<coneCount;i++){
    const t=(i/coneCount+.04)%1;
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const side=(i%2===0?1:-1)*(BARRIER_OFF+30+Math.random()*20);
    _iceCreamPos.push({
      x:p.x+nr.x*side+(Math.random()-.5)*6,
      z:p.z+nr.z*side+(Math.random()-.5)*6,
      scoopCount:1+Math.floor(Math.random()*3),
      colorOffset:i
    });
  }
  const handle=ProcDecor.buildIceCreamConeBatch(scene,_iceCreamPos);
  // Scoops hebben geen emissive meer (verlaten-pretpark fix tegen
  // kerstboom-glow), dus _candyNightEmissives-push voor scoops verwijderd —
  // night-dispatcher zou alleen 0.8 op een zwarte emissive zetten = no-op.
}


function buildCookieSpectators(){
  // Phase 6.1 — InstancedMesh refactor. 32 cookies + 96 chips waren
  // voorheen 128 individuele Mesh objects (128 draw calls). Nu 2
  // InstancedMesh draw calls totaal. Volgt sandstorm.js patroon:
  // shared geometry + material, per-instance matrix via setMatrixAt.
  // Identical material per type — geen setColorAt nodig.
  const positions=[];
  const SPN = window._isLowDensity() ? 18 : 32;
  for(let i=0;i<SPN;i++){
    const t=i/SPN;
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const side=(i%2===0?1:-1)*(BARRIER_OFF+8+Math.random()*4);
    positions.push({x:p.x+nr.x*side,z:p.z+nr.z*side,tg});
  }

  // Cookie bodies — 1 InstancedMesh, 32 instances, shared cylinder
  const cookieGeo=new THREE.CylinderGeometry(1.2,1.2,.22,12);
  const cookieMat=_cMat({color:0xcc8844},{metalness:0.0,roughness:0.65},'candy-glaze');
  const cookies=new THREE.InstancedMesh(cookieGeo, cookieMat, positions.length);
  const _m=new THREE.Matrix4();
  const _q=new THREE.Quaternion();
  const _eul=new THREE.Euler();
  const _v=new THREE.Vector3();
  const _s=new THREE.Vector3(1,1,1);
  positions.forEach(({x,z,tg}, idx)=>{
    const fwdY=Math.atan2(tg.x,tg.z);
    // Equivalent to: rotation.x = Math.PI/2-.15, rotation.z = fwdY
    // Apply in same order Three.js applies Euler XYZ default.
    _eul.set(Math.PI/2-.15, 0, fwdY, 'XYZ');
    _q.setFromEuler(_eul);
    _v.set(x, 1.5, z);
    _m.compose(_v, _q, _s);
    cookies.setMatrixAt(idx, _m);
  });
  cookies.instanceMatrix.needsUpdate=true;
  scene.add(cookies);

  // Chocolate chips — 1 InstancedMesh, 96 instances (3 chips per cookie)
  const chipGeo=new THREE.SphereGeometry(.14,4,4);
  const chipMat=_cMat({color:0x331100},{metalness:0.0,roughness:0.85},'candy-glaze');
  const chips=new THREE.InstancedMesh(chipGeo, chipMat, positions.length * 3);
  const _qChip=new THREE.Quaternion();  // identity quaternion
  let chipIdx=0;
  positions.forEach(({x,z})=>{
    for(let c=0;c<3;c++){
      const ang=Math.random()*Math.PI*2, dist=Math.random()*.7;
      _v.set(x + Math.cos(ang)*dist*.8, 1.6, z + Math.sin(ang)*dist*.8);
      _m.compose(_v, _qChip, _s);
      chips.setMatrixAt(chipIdx++, _m);
    }
  });
  chips.instanceMatrix.needsUpdate=true;
  scene.add(chips);
  // Phase 8.5 — store cookie data voor per-frame bob animation.
  // updateCandyWorld() leest deze elke frame en update setMatrixAt
  // met sin-driven y-oscillation. Reset bij disposeScene via
  // worlds-extras cleanup (cookie mesh wordt sowieso vrijgegeven).
  window._candySpectators = {
    mesh: cookies,
    positions: positions.slice(),
    baseY: 1.5,
    _m: new THREE.Matrix4(),
    _v: new THREE.Vector3(),
    _q: new THREE.Quaternion(),
    _eul: new THREE.Euler(),
    _s: new THREE.Vector3(1,1,1)
  };
}


function updateCandyWorld(dt){
  _candyFrameTick = (_candyFrameTick + 1) | 0;
  // Phase 12D — donut hoops slow bob. IM-based (Phase 15): read _imIdx + _im,
  // use setMatrixAt to update Y per instance. Epsilon-gated to skip no-op frames.
  if(_candyDonutHoops.length){
    const tNow = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now()*0.001);
    if(!_hoopBobDummy) _hoopBobDummy = new THREE.Object3D();
    let _hoopDirty = false;
    for(let i=0;i<_candyDonutHoops.length;i++){
      const h = _candyDonutHoops[i];
      const y = h.userData._baseY + Math.sin(tNow*0.8 + h.userData._phase) * 0.8;
      if(h.userData._lastY === undefined || Math.abs(y - h.userData._lastY) > 0.02){
        h.userData._lastY = y;
        if(h._im && h._imIdx !== undefined){
          h._im.getMatrixAt(h._imIdx, _hoopBobDummy.matrix);
          _hoopBobDummy.matrix.decompose(_hoopBobDummy.position, _hoopBobDummy.quaternion, _hoopBobDummy.scale);
          _hoopBobDummy.position.y = y;
          _hoopBobDummy.updateMatrix();
          h._im.setMatrixAt(h._imIdx, _hoopBobDummy.matrix);
          _hoopDirty = true;
        }
      }
    }
    if(_hoopDirty && _candyDonutHoops[0] && _candyDonutHoops[0]._im){
      _candyDonutHoops[0]._im.instanceMatrix.needsUpdate = true;
    }
  }
  // Phase 8.5 — cookie spectator idle bob. p.q (quaternion) en p._pOff
  // worden lazy gecached: p.tg is build-time constant, dus de Euler→Quat
  // conversie hoeft maar 1× per cookie ipv elke frame. Op mobile staggeren
  // we naar elke 2e frame zodat de 32× setMatrixAt + GPU upload halveert.
  if(window._candySpectators && window._candySpectators.mesh){
    const sp = window._candySpectators;
    const _candyStaggerSkip = !!(_candyFrameTick & 1);
    if(!_candyStaggerSkip){
      const t = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now()*0.001);
      for(let i=0; i<sp.positions.length; i++){
        const p = sp.positions[i];
        if(!p.q){
          p._pOff = i * 0.43;
          const _fwdY = Math.atan2(p.tg.x, p.tg.z);
          sp._eul.set(Math.PI/2-.15, 0, _fwdY, 'XYZ');
          p.q = new THREE.Quaternion().setFromEuler(sp._eul);
        }
        const bob = Math.sin(t * 1.4 + p._pOff) * 0.08;
        sp._v.set(p.x, sp.baseY + bob, p.z);
        sp._m.compose(sp._v, p.q, sp._s);
        sp.mesh.setMatrixAt(i, sp._m);
      }
      sp.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  if(typeof updateCandyChocoBridge==='function'){
    const pl=carObjs[playerIdx];
    updateCandyChocoBridge(dt, pl?pl.lap:1);
  }
  updateSprinkles(dt);
  updateFloatingCandyBits(dt);
  // Phase 14: lollipop Y-bob verwijderd — instances zitten nu in InstancedMesh
  // en per-frame instanceMatrix updaten kost meer dan de subtiele wobble waard
  // is. Cluster-light groepering (_buildCandyLollipopGroupLights) gebruikt de
  // statische lookup-positions die ProcDecor.buildCandyTreeBatch returnt.
  // Chocolate river shimmer: slight y oscillation
  if(_chocoHighlight&&_chocoHighlight.material){
    _chocoHighlight.material.color.setHex(
      0x4a2200+(Math.floor(Math.sin(_nowSec*.5)*.15*255)&0xff)*0x010000
    );
  }
  // ── Phase 10.10 — extra grote sprite-sprinkles vallen uit de hemel ────
  // Bovenop het bestaande PointsMaterial-sprinkles systeem voegen we
  // 2 grotere sprite-particles per 5 frames toe via de gedeelde exhaust
  // pool. Hierdoor krijgen we duidelijke pastel-vlokken die ook in chase-
  // cam zichtbaar zijn (PointsMaterial-particles zijn klein op afstand).
  _candySprinkleFrame=(_candySprinkleFrame||0)+1;
  if(_candySprinkleFrame%5===0&&typeof exhaustSystem!=='undefined'&&exhaustSystem&&exhaustSystem.emit){
    const car=carObjs[playerIdx];
    const cx=car?car.mesh.position.x:0,cz=car?car.mesh.position.z:0;
    for(let _ss=0;_ss<2;_ss++){
      const col=_CANDY_SPRINKLE_COLS[Math.floor(Math.random()*_CANDY_SPRINKLE_COLS.length)];
      const px=cx+(Math.random()-0.5)*200;
      const pz=cz+(Math.random()-0.5)*200;
      exhaustSystem.emit(
        px,35+Math.random()*10,pz,
        0,-0.18,0,
        3.5,col[0],col[1],col[2],.80
      );
    }
  }
}

