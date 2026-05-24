// js/worlds/sandstorm.js — Sandstorm Canyon world builders + update.
// Non-module script. Cloned from worlds/volcano.js as the rebuild template
// (warm palette + lap-progressive horizon hazard + procedural props match
// sandstorm's intent better than any other world).
//
// Phase 3: full visuele upgrade per checklist — gestapelde strata cliffs,
// layered sphinx, sokkel'd obelisks, fan-leaved palms, per-instance jitter,
// background mesas with atmospheric fog-tint, weathered tempel ruins.
// Hazard is still a Phase-2 stub; lap-progressive storm wires in Phase 4.

'use strict';

// Track-section ranges as t-values along trackCurve.
const _SS_DUNES_T_RANGES = [[0.00,0.28],[0.88,1.00]];
const _SS_SLOT_T_RANGE   = [0.32,0.62];
const _SS_PLAZA_T_RANGE  = [0.70,0.86];

// ── Procedural canvas textures (sandstorm-local helpers) ──
//
// Phase-3A swap: cliffs + mesas migrated to ProcTextures.rockStrata
// (centralised in js/effects/proc-textures.js). The legacy _ssRockTex
// inline canvas + _ssDisplaceCliffGeometry helper were removed; their
// consumers now use ProcGeometry.strataStack which embeds displacement.
//
// Phase-3B swap: tempel ruins + obelisken migrated to
// ProcTextures.weatheredStone (with optional flutes flag) and
// ProcTextures.pseudoGlyphs (obelisk shafts). The legacy _ssSandstoneTex
// inline canvas was removed too; sphinx + pillaren + obelisken now share
// ProcTextures.weatheredStone with per-prop ageWear/baseColor opts.
//
// Phase-3C swap: palms migrated to ProcTextures.bark + ProcTextures.palmLeaf
// (returns {texture, alphaMap} pair for Lambert + alphaTest material per
// spec §2.2 mobile-PBR-alpha exception). Tents migrated to
// ProcTextures.stripedFabric. The legacy _ssPalmLeafTex + _ssTentStripeTex
// inline canvases are now removed.
//
// Phase-4 §4.2 swap: _ssBuildScarabSigns folded into _ssBuildRoadsideDetail
// as one of the 6 prop-types. The legacy _ssScarabSignTex inline canvas is
// removed; the new spawner uses ProcTextures.pseudoGlyphs as a stand-in
// scarab-silhouette source. Sandstorm's sole remaining inline canvas-tex
// (other than the shared _sandGroundTex from environment.js for ground
// surface) is now zero — the helper migration is complete.

// (Removed: _ssDisplaceCliffGeometry — per-PlaneGeometry vertex displacement
//  helper that went with the legacy 48-wall cliff implementation. The
//  Phase-3A strataStack-based cliffs embed displacement in ProcGeometry, so
//  this helper has no remaining callers.)

// ── Module-scope helpers (final cleanup pass) ────────────────────────
//
// _ssMakeStoneMat — single source of truth for the sandstorm sandstone
// PBR material contract. Used by sphinx, pilaren, obelisken, and roadside
// rocks/sunken-stones. Replaces 8 near-identical inline
// `new MeshStandardMaterial({map:..., roughness:0.9X, metalness:0})`
// constructions. Caller passes a pre-built canvas-tex (weatheredStone OR
// pseudoGlyphs — obelisk shaft uses the latter on desktop) + optional
// roughness override (default 0.92).
function _ssMakeStoneMat(map, roughness){
  // Mobile: Lambert (no PBR roughness term in shader, no per-permutation
  // GLSL compile during scene-load). Saves the GO-spike on slow-compiler
  // Android devices and ~3-8% fragment-shader cost during the race.
  if(window._isMobile){
    return new THREE.MeshLambertMaterial({ map: map });
  }
  return new THREE.MeshStandardMaterial({
    map: map,
    roughness: (roughness != null) ? roughness : 0.92,
    metalness: 0
  });
}

// ── Solid-volume PBR helper ──────────────────────────────────────────────
//
// Proef-conversie (Sandstorm-specifiek): solid-volume props krijgen op
// desktop een MeshStandardMaterial met envTag 'desert-matte' zodat ze
// IBL-reflectie pakken (ultra-diffuse zandwoestijn-look). Mobile blijft
// Lambert om PBR-shader-kosten te vermijden op LOW-tier waar de reflection
// probe toch uit staat. Glow-laag (obelisk gilded capstone 0.30 emissive)
// gaat hier NIET doorheen — die blijft Lambert.
//
// Usage:
//   const mat = _ssMat({color:0xc8a070}, {metalness:0.0, roughness:0.92}, 'desert-matte');
function _ssMat(lambertDef, stdExtras, tag){
  if(window._isMobile) return new THREE.MeshLambertMaterial(lambertDef);
  const mat = new THREE.MeshStandardMaterial(Object.assign({}, lambertDef, stdExtras));
  mat.userData = mat.userData || {};
  mat.userData.envTag = tag;
  return mat;
}

// _ssMergeProto — merges multi-shape prototype geometries into one
// BufferGeometry and disposes the input source geometries. Used by
// roadside marker/cactus/bones builders. Consolidates the
// merge → input.dispose() pattern at 3 sites and ensures the source
// geos can never leak if a future caller forgets to dispose.
function _ssMergeProto(geos){
  const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(geos);
  geos.forEach(g => { try { g.dispose(); } catch(_){} });
  return merged;
}

// _ssTrackSide — per-track-curve anchor builder. Replaces the repeated
// inline pattern (getPoint(t) + tangent + normal + cx/cz) that appeared
// at 12+ call sites across sandstorm builders. Returns p/tg/nr (always
// useful for orienting yaw / picking offsets) plus pre-computed cx/cz
// at `BARRIER_OFF +` style off (caller passes the full off including
// BARRIER_OFF). Pass side=0 if no side-flip is needed (cx=p.x,cz=p.z).
function _ssTrackSide(t, side, off){
  const p=trackCurve.getPoint(t);
  const tg=trackCurve.getTangent(t).normalize();
  const nr=new THREE.Vector3(-tg.z,0,tg.x);
  return {
    p, tg, nr,
    cx: p.x+nr.x*side*off,
    cz: p.z+nr.z*side*off
  };
}

// Per-world animated state — gereset bij world-switch via core/scene.js
// disposeScene() (geometry/material/textures cleared) + race.js
// _resetRaceState() (refs hier op null gezet door de world-switch flow).
let _sandstormSandSwept=null;    // sand-haze fill light
let _ssNextDevil=Infinity;       // Phase 10.12 — next dust-devil spawn time (Infinity = unset; buildSandstormEnvironment schedules the first one after race-start)
let _ssActiveDevil=null;         // Phase 10.12 — active devil {cx,cz,born,life}
let _ssTentFlaps=[];             // Phase 13C — flap-animation refs
let _ssTentBanners=[];           // Phase 13C — banner-flap refs
let _sandstormFlecksGeo=null;    // ambient wind-fleck particle BufferGeometry
let _sandstormFlecks=null;       // Points mesh
let _sandstormPalmLeaves=[];     // [{im, baseAng, amp}] for wind-sway animation

// Single source of truth for sandstorm warm-sunset day lighting. Called
// from buildSandstormEnvironment() at world-build, AND from night.js
// when toggling back from night to day so the two code paths can never
// drift (code-reuse review v4 found the constants duplicated).
//
// Goal palette (cinematic golden-hour):
//   sun #ff8c42 / 1.7 mobile, 2.8 desktop / position (80,35,-60)
//   ambient #5a2818 / 0.35
//   hemi sky #ffb87a / ground #8b3a1d / 0.7 mobile, 1.0 desktop
//
// Mobile sun caps at 1.7 (not 2.8) because shadows are off on mobile and
// the unshadowed Lambert sand-ground (0xd4a55a) would clip to white at
// full intensity. Sun position is low+angled for long cliff shadows;
// scene.js creates a fresh sunLight per world-build so this reposition
// is sandstorm-local — next buildScene gets default position back.
function _applySandstormDayLighting(){
  if(!sunLight||!ambientLight||!hemiLight)return;
  sunLight.color.setHex(0xff8c42);
  sunLight.intensity = window._isMobile ? 1.7 : 2.8;
  sunLight.position.set(80, 35, -60);
  ambientLight.color.setHex(0x5a2818); ambientLight.intensity = 0.35;
  hemiLight.color.setHex(0xffb87a);
  hemiLight.groundColor.setHex(0x8b3a1d);
  hemiLight.intensity = window._isMobile ? 0.7 : 1.0;
  // PBR-upgrade Brok 1b: per-wereld ambient/hemi-mul knop. Default 1.0.
  const _v=(typeof window.getWorldVisuals==='function')?window.getWorldVisuals(activeWorld):null;
  if(_v){ ambientLight.intensity*=_v.ambientMul; hemiLight.intensity*=_v.hemiMul; }
}
// Expose to non-module consumers — night.js reads from window.* scope.
if(typeof window!=='undefined')window._applySandstormDayLighting=_applySandstormDayLighting;

// ── Section builders ──────────────────────────────────────────────────────

// (Background mesas removed in post-review fix. core/scene.js calls the
// shared buildBackgroundLayers() helper for sandstorm, which already emits
// 2 cylinder horizon-layers via _SILHOUETTE_PALETTES.sandstorm in
// track/environment.js. Adding our own mesa-rings would have produced
// FOUR redundant cylinders around the horizon. The bespoke mesa-strata
// canvas-look is sacrificed to avoid the duplication; if needed, extend
// _SILHOUETTE_PALETTES with an optional customTex callback — that's a
// cross-world helper change and out-of-scope for this rebuild.)

// Canyon cliffs — gestapelde strata (3 layers), elk met eigen displacement
// + per-layer color shift. 8 segments × 2 sides on the slot-canyon t-range.
//
// Materials are hoisted ONCE per strata layer (3 mats total instead of 48
// unique mats — one per panel as the previous draft did). Geometry stays
// Canyon cliffs — Phase-3A rebuild via ProcGeometry.strataStack.
// Each cliff is now a single BufferGeometry with vertex-color blended
// strata seams (4 stratum layers per cliff). 6-10 free-standing buttes
// scattered along the slot-canyon t-range — each one a Monument-Valley
// style formation, not a tiled wall. This is the visual fix for the
// "stack of plates" feel: ONE mesh per cliff, smooth color transitions
// at strata boundaries via vertexColors.
//
// Material: MeshStandardMaterial + ProcTextures.rockStrata (PBR pipeline,
// vertexColors:true so the strata blend reads). Per-cliff cloned material
// so applyAtmosphericPerspective can lerp distant cliffs into fog
// (Variant A pattern from proc-geometry).
//
// Talud (rubble at base): 4-5 beveledBox rocks per cliff via single
// shared InstancedMesh. Skipped on mobile.
function _ssBuildCanyonCliffs(){
  const mob=window._isMobile;
  const COUNT=mob?6:10;
  const lod=mob?1:0;
  // One shared rock-strata texture across all cliffs (cached by ProcTextures
  // LRU). Per-cliff material clones swap colour for atmospheric blend, but
  // the map stays shared.
  const stoneTex=ProcTextures.rockStrata({
    bandCount:5,
    baseColor:'#a86839',
    stratColors:['#7a3a1d','#a8643a','#8b4a25','#b87850','#cf8e60'],
    ageWear:0.4,
    repeatX:1, repeatY:1
  });
  // map (rockStrata canvas) AND vertexColors (strata r/g/b) multiply in the
  // fragment shader. The strata vertex-colors lerp BETWEEN stratum tints
  // (~0.5..1.0 channel range), so the multiplied result is darker than the
  // plain-map output — intentional: deepens bottom-of-strata seams where
  // the canvas alone would look uniform. stratColors picked with this
  // multiplication factored in.
  // Mobile uses Lambert to skip the PBR shader-compile spike.
  const baseCliffMat=window._isMobile
    ? new THREE.MeshLambertMaterial({map:stoneTex, vertexColors:true, flatShading:false})
    : _ssMat({map:stoneTex, vertexColors:true, flatShading:false},{metalness:0.0,roughness:0.92},'desert-matte');
  // Talud: instanced beveled rocks at the base.
  const ROCKS_PER=mob?0:5;
  let taludIM=null;
  let taludIdx=0;
  const _dummy=new THREE.Object3D();
  if(ROCKS_PER>0){
    const rockGeo=ProcGeometry.beveledBox({w:1.5,h:0.8,d:1.5,bevel:0.15});
    const rockMat=window._isMobile
      ? new THREE.MeshLambertMaterial({color:0x7a3a1c})
      : _ssMat({color:0x7a3a1c},{metalness:0.0,roughness:0.92},'desert-matte');
    taludIM=new THREE.InstancedMesh(rockGeo, rockMat, COUNT*ROCKS_PER);
  }
  const [tStart,tEnd]=_SS_SLOT_T_RANGE;
  for(let i=0;i<COUNT;i++){
    const t=tStart+(i+0.5)*((tEnd-tStart)/COUNT);
    const side=(i%2===0)?1:-1;
    // Cliff base offset: was BARRIER_OFF+6..10 (=22..26), bumped to
    // BARRIER_OFF+10..14 (=26..30) so cliff-edge clears the asphalt by
    // ≥4u even at max baseR=9 (visual-fix-v3 issue 2: cliffs were
    // reaching track-edge in worst-case combinations).
    const off=BARRIER_OFF+10+Math.random()*4;
    const {cx,cz}=_ssTrackSide(t,side,off);
    // Per-cliff strata def — slight per-cliff variance so the canyon
    // doesn't read as a uniform array of identical formations.
    const baseR=7+Math.random()*2;
    const cliffGeo=ProcGeometry.strataStack({
      strata:[
        {height:3, radius:baseR+1.0, color:'#7a3a1d', displaceAmount:0.30},
        {height:6, radius:baseR,     color:'#a8643a', displaceAmount:0.20},
        {height:8, radius:baseR-0.5, color:'#8b4a25', displaceAmount:0.25},
        {height:4, radius:baseR-1.0, color:'#b87850', displaceAmount:0.15}
      ],
      totalSides: mob?7:10,
      blendRange:0.4,
      seed:1337+i*53,
      lod:lod
    });
    // Per-cliff material clone — required for atmospheric perspective
    // (Variant A: applyAtmosphericPerspective mutates material.color).
    // Note: baseCliffMat is freshly `new MeshStandardMaterial(...)` and
    // carries no userData._sharedAsset flag, so the clone is correctly
    // disposed by disposeScene's _disposeMat traversal on world-switch.
    const cliffMat=baseCliffMat.clone();
    const cliff=new THREE.Mesh(cliffGeo, cliffMat);
    cliff.position.set(cx, 0, cz);
    cliff.rotation.y=Math.random()*Math.PI*2;
    scene.add(cliff);
    if(window._freezeMatrix)window._freezeMatrix(cliff);
    // Atmospheric perspective for cliffs >150u from anchor (track centre).
    const distToCenter=Math.hypot(cx,cz);
    if(distToCenter>150){
      ProcGeometry.applyAtmosphericPerspective(cliff, {
        fogColor:'#e8b878',
        startDistance:150,
        fullBlendDistance:400,
        cameraAnchor:new THREE.Vector3(0,0,0),
        maxBlend:0.6
      });
    }
    // Talud rubble rocks at the foot of this cliff
    if(taludIM){
      for(let r=0;r<ROCKS_PER;r++){
        const ang=Math.random()*Math.PI*2;
        const rDist=baseR+1+Math.random()*2;
        _dummy.position.set(
          cx+Math.cos(ang)*rDist,
          0.4+Math.random()*0.3,
          cz+Math.sin(ang)*rDist
        );
        const sc=0.6+Math.random()*0.7;
        _dummy.scale.set(sc*1.3, sc, sc*1.1);
        _dummy.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI*2, Math.random()*Math.PI);
        _dummy.updateMatrix();
        taludIM.setMatrixAt(taludIdx++, _dummy.matrix);
      }
    }
  }
  if(taludIM){
    taludIM.count=taludIdx;
    taludIM.instanceMatrix.needsUpdate=true;
    scene.add(taludIM);
  }
}

// Background mesa's — Phase-3A 3-tier depth scaffold via organicCylinder
// + atmospheric perspective. Foreground/midground/background tiers placed
// on radial bands around the track-centre at distances 150/380/480 (mid
// + far bands bumped 2026-05-08; see tiers literal below for rationale).
// Each mesa has unique cloned material so its color can lerp toward fog.
// Pattern matches Monument Valley silhouette layering — 3 distinct depth
// reads even when foreground is occluded by cliffs.
function _ssBuildBackgroundMesas(){
  const mob=window._isMobile;
  const lod=mob?1:0;
  const stoneTex=ProcTextures.rockStrata({
    bandCount:4,
    baseColor:'#8b4a25',
    stratColors:['#6a3018','#8b4a25','#a8643a','#b87850'],
    ageWear:0.3
  });
  const baseMat=window._isMobile
    ? new THREE.MeshLambertMaterial({map:stoneTex, color:0xcc8d60, flatShading:false})
    : _ssMat({map:stoneTex, color:0xcc8d60, flatShading:false},{metalness:0.0,roughness:0.92},'desert-matte');
  // Mobile: skip the background tier (only 2 layers, halved counts) so the
  // far-distance fillrate stays manageable.
  //
  // Mid-tier distance bumped from 250 → 380 (2026-05-08): the sandstorm
  // track's L-shape passes through 130-300u of the world origin at
  // multiple angles, and the mid-tier ring at 250 had 3-4 of its 6
  // desktop mesas landing ON or INSIDE the racing line (clearances of
  // -22u to -12u with max mesa radius 22 + TW=13 threshold). Pushing the
  // ring out to 380 keeps min clearance at +13u even with worst-case
  // -20u jitter. See /tmp/c0-issue3-diag.md for the per-angle table.
  const tiers = mob
    ? [
        { distance:150, count:4, sides:8, displaceAmount:0.4, maxBlend:0.4 },
        { distance:380, count:3, sides:6, displaceAmount:0.3, maxBlend:0.65 }
      ]
    : [
        { distance:150, count:6, sides:8, displaceAmount:0.4, maxBlend:0.4 },
        { distance:380, count:6, sides:6, displaceAmount:0.3, maxBlend:0.65 },
        { distance:480, count:4, sides:5, displaceAmount:0.2, maxBlend:0.85 }
      ];
  tiers.forEach((tier,ti)=>{
    for(let i=0;i<tier.count;i++){
      // Spread evenly around the track-centre with per-tier angle phase.
      const ang=(i/tier.count)*Math.PI*2 + (ti*0.4);
      const dist=tier.distance + (Math.random()-0.5)*40;
      const cx=Math.cos(ang)*dist;
      const cz=Math.sin(ang)*dist;
      // Larger mesas at far distance so they read at scale
      const baseRadius=14+Math.random()*8 + (ti*4);
      const height=22+Math.random()*16 + (ti*6);
      const mesaGeo=ProcGeometry.organicCylinder({
        sides:tier.sides,
        topRadius:baseRadius*0.85,
        bottomRadius:baseRadius,
        height:height,
        displaceAmount:tier.displaceAmount,
        seed:31+i*17+ti*73,
        lod:lod
      });
      // Per-mesa unique material so atmospheric perspective lerp can
      // target each independently. Slight per-instance color jitter
      // breaks up the "stamped" look. baseMat is freshly `new` (no
      // userData._sharedAsset), so clones are disposable on world-switch.
      const mesaMat=baseMat.clone();
      mesaMat.color.multiplyScalar(0.92+Math.random()*0.16);
      const mesa=new THREE.Mesh(mesaGeo, mesaMat);
      mesa.rotation.y=Math.random()*Math.PI*2;
      // Squashed Y-scale + slight per-instance jitter
      const sc=0.85+Math.random()*0.40;
      const sy=0.7+Math.random()*0.3;
      mesa.scale.set(sc, sy, sc);
      // Y-position MUST account for the Y-scale: organicCylinder's
      // CylinderGeometry is centered (y∈[-h/2,h/2]), so after sy-scale
      // the bottom sits at -h*sy/2 in local space. Position the mesh so
      // the scaled bottom lands at y=-1 (just below ground). Earlier
      // formula (height*0.5-1) ignored sy and floated mesas 2-8u in
      // the air for sy<1.0 — visual-fix-v4 bug 1.
      mesa.position.set(cx, height*sy*0.5-1, cz);
      ProcGeometry.applyAtmosphericPerspective(mesa, {
        fogColor:'#e8b878',
        startDistance:tier.distance-50,
        fullBlendDistance:tier.distance+150,
        cameraAnchor:new THREE.Vector3(0,0,0),
        maxBlend:tier.maxBlend
      });
      scene.add(mesa);
      if(window._freezeMatrix)window._freezeMatrix(mesa);
    }
  });
}

// Sand dunes — Phase-3C rebuild per spec §3.9. duneCap (sphere-cap met
// asymmetric scale + top-vertex jitter) ipv flat PlaneGeometry — top is
// now organisch gerond, niet geometrisch hard. ProcTextures.sandSurface
// levert the windrichting-aligned ripple canvas (rotated rect-fill, vele
// goedkoper dan per-line trig).
//
// Per spec §3.9: NO emissive (zand glow-t niet in werkelijkheid). Warmth
// komt uit hemisphere + ACES tonemapping.
function _ssBuildSandDunes(){
  const mob=window._isMobile;
  const COUNT=mob?4:_mobCount(10);
  // Wind-direction angle for ripple-alignment. Spec mentions globalWindAngle;
  // we hard-code an east-bound wind (the storm's prevailing direction).
  const sandTex=ProcTextures.sandSurface({
    baseColor:'#c8a070',
    rippleCount:60,
    rippleAngle: Math.PI*0.05,    // slight east-bound tilt
    pebbleCount: mob?12:20,
    edgeWear:0,
    repeatX:2, repeatY:1
  });
  const duneMat=window._isMobile
    ? new THREE.MeshLambertMaterial({map:sandTex, color:0xd4a55a})
    : _ssMat({map:sandTex, color:0xd4a55a},{metalness:0.0,roughness:0.92},'desert-matte');
  for(let i=0;i<COUNT;i++){
    const range=_SS_DUNES_T_RANGES[i%_SS_DUNES_T_RANGES.length];
    const t=range[0]+Math.random()*(range[1]-range[0]);
    const side=i%2===0?1:-1;
    const off=BARRIER_OFF+18+Math.random()*45;
    const {cx:px,cz:pz}=_ssTrackSide(t,side,off);
    // 2 overlapping dune-silhouettes per spawn-point for layered depth.
    // Per spec §3.4 "overlapping silhouettes" — each layer slightly offset
    // so the dune cluster has natural depth, not a single mound.
    for(let layer=0;layer<2;layer++){
      const radius=8+Math.random()*5+layer*1.5;
      const dune=new THREE.Mesh(
        ProcGeometry.duneCap({
          radius:radius,
          scaleX: 1.6+Math.random()*0.8,
          scaleZ: 0.9+Math.random()*0.4,
          scaleY: 0.4+Math.random()*0.2,
          topJitter: 0.15+layer*0.05,
          seed: 31+i*7+layer*53,
          lod: mob?1:0
        }),
        duneMat
      );
      // Per-instance scale + position jitter (spec §3.4)
      const sc=0.85+Math.random()*0.30;
      dune.scale.set(sc, 1+layer*0.15, sc);
      // Random Y rotation breaks the "stamped" look
      dune.rotation.y=Math.random()*Math.PI*2;
      dune.position.set(
        px+(layer*3-1.5)*Math.cos(i),
        -0.05,
        pz+(layer*2-1)*Math.sin(i)
      );
      scene.add(dune);
    }
  }
}

// Sphinx hero monument — Phase-3A rebuild per spec §3.5. 19 sub-meshes
// + decorative sand mound op desktop = 20 meshes; 15 op mobile (skips
// rear paws ×2, uraeus base + head, baard). Spec asked for 14+, so well
// covered. Volledig op `ProcGeometry.beveledBox` zodat geen scherpe doos-
// kanten ogen kartonachtig.
//
// Material zones (3 distinct):
//   • body         — warm sandstone via ProcTextures.weatheredStone(ageWear:0.7)
//   • sokkel       — koeler/donkerder accent — eigen weatheredStone variant
//   • nemes/uraeus/baard — distinctief donker (#9b6f3a) so headdress reads
//
// Helper builds a custom trapezoidal nemes-flap geometry inline (one of
// the few sub-shapes that doesn't fit any ProcGeometry recipe yet).
function _ssBuildSphinxMonument(){
  const mob=window._isMobile;
  // Mobile beveledBox LOD: halve bevelSegments + curveSegments to roughly
  // halve per-box tri-count (~140 tris/box vs ~280 desktop). 15 mobile
  // sub-meshes × ~140 = ~2100 tris vs the unoptimised ~4400. Visually
  // indistinguishable at race-camera distance.
  const bevSegs = mob ? 1 : 2;
  const curveSegs = mob ? 2 : 4;
  // Inline helper so we don't repeat bevelSegments/curveSegments at every
  // call-site. Used for sub-meshes that don't need post-creation vertex
  // tweaks; the upper-body taper + nemes-flap taper still call
  // ProcGeometry.beveledBox directly because they edit the resulting
  // BufferGeometry afterwards.
  const _bbox = (w, h, d, bevel) => ProcGeometry.beveledBox({
    w, h, d, bevel,
    bevelSegments: bevSegs,
    curveSegments: curveSegs
  });
  // 3 material zones (PBR baseline). Per-mesh color-tint kan via .color
  // set ALSO de same map laten zien, zodat caller-clones niet nodig zijn.
  const bodyTex=ProcTextures.weatheredStone({
    baseColor:'#c9a373', crackColor:'#3a2418', crackCount:10,
    ageWear:0.7, repeatX:1, repeatY:1
  });
  const sokkelTex=ProcTextures.weatheredStone({
    baseColor:'#b89370', crackColor:'#3a2418', crackCount:6,
    ageWear:0.5, repeatX:1, repeatY:1
  });
  const nemesTex=ProcTextures.weatheredStone({
    baseColor:'#9b6f3a', crackColor:'#2a1410', crackCount:8,
    ageWear:0.6, repeatX:1, repeatY:1
  });
  const bodyMat   =_ssMakeStoneMat(bodyTex,   0.92);
  const sokkelMat =_ssMakeStoneMat(sokkelTex, 0.94);
  const nemesMat  =_ssMakeStoneMat(nemesTex,  0.90);
  const sphinx=new THREE.Group();

  // ── SOKKEL — large stepped base (2 beveled blocks) — sub-meshes 1-2
  const sokkelLow=new THREE.Mesh(_bbox(20, 1.2, 28, 0.20), sokkelMat);
  sokkelLow.position.y=0.6; sphinx.add(sokkelLow);
  const sokkelHi=new THREE.Mesh(_bbox(17, 1.2, 25, 0.18), sokkelMat);
  sokkelHi.position.y=1.8; sphinx.add(sokkelHi);

  // ── BODY — lying lion-form (lower + tapered upper) — sub-meshes 3-4
  const bodyLower=new THREE.Mesh(_bbox(8, 3, 16, 0.20), bodyMat);
  bodyLower.position.y=3.9; sphinx.add(bodyLower);
  // Upper body — slightly tapered top via post-creation vertex inset.
  // Uses the full-opts call (not _bbox) because we mutate the geometry
  // after creation; the bevel-LOD applies via shared bevSegs/curveSegs.
  const upperGeo=ProcGeometry.beveledBox({
    w:7.4, h:2.8, d:14.5, bevel:0.20,
    bevelSegments: bevSegs, curveSegments: curveSegs
  });
  // Pull top vertices inward so the body silhouette tapers toward the spine
  {
    const pos=upperGeo.attributes.position;
    const v=new THREE.Vector3();
    for(let i=0;i<pos.count;i++){
      v.fromBufferAttribute(pos,i);
      // Top half (positive Y after centering): pull X inward by 8%
      if(v.y > 0.4) v.x *= 0.85;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate=true;
    upperGeo.computeVertexNormals();
  }
  const bodyUpper=new THREE.Mesh(upperGeo, bodyMat);
  bodyUpper.position.y=6.7; sphinx.add(bodyUpper);

  // ── CHEST RISE — voorste deel van de body, hoger dan abdomen — sub-mesh 5
  const chestRise=new THREE.Mesh(_bbox(4, 3, 3, 0.15), bodyMat);
  chestRise.position.set(0, 7.5, -6.0);
  sphinx.add(chestRise);

  // ── FRONT PAWS (2) — beveled blocks angled forward — sub-meshes 6-7
  [-1,1].forEach(s=>{
    const paw=new THREE.Mesh(_bbox(1, 3, 4, 0.10), bodyMat);
    paw.position.set(s*2.3, 3.9, -6.5);
    sphinx.add(paw);
  });

  // ── REAR PAWS (2) — desktop only — sub-meshes 8-9 (skip on mobile)
  if(!mob){
    [-1,1].forEach(s=>{
      const rearPaw=new THREE.Mesh(_bbox(0.8, 1.2, 2, 0.10), bodyMat);
      rearPaw.position.set(s*2.5, 3.0, 7.2);
      sphinx.add(rearPaw);
    });
  }

  // ── TAIL — small block curving along the body — sub-mesh 10
  const tail=new THREE.Mesh(_bbox(0.8, 1.2, 3, 0.10), bodyMat);
  tail.position.set(0, 4.5, 8.4);
  tail.rotation.x=0.3;
  sphinx.add(tail);

  // ── NECK + HEAD — sub-meshes 11-12
  const neck=new THREE.Mesh(_bbox(3, 1.5, 2, 0.12), bodyMat);
  neck.position.set(0, 8.5, -7.0);
  sphinx.add(neck);
  const head=new THREE.Mesh(_bbox(3, 3.5, 3, 0.20), bodyMat);
  head.position.set(0, 10.5, -7.5);
  sphinx.add(head);

  // ── NEMES HEADDRESS — 2 angled trapezium flaps + central block (3 sub-meshes)
  // Sub-mesh 13 = nemes center
  const nemesCenter=new THREE.Mesh(_bbox(4.4, 1.6, 4.4, 0.15), nemesMat);
  nemesCenter.position.set(0, 12.7, -7.5);
  sphinx.add(nemesCenter);
  // Sub-meshes 14-15 = side flaps (custom trapezium via post-create taper).
  // Uses the full-opts call (not _bbox) because we mutate the geometry
  // after creation; the bevel-LOD applies via shared bevSegs/curveSegs.
  [-1,1].forEach(s=>{
    const flapGeo=ProcGeometry.beveledBox({
      w:0.8, h:2.6, d:3.4, bevel:0.10,
      bevelSegments: bevSegs, curveSegments: curveSegs
    });
    // Taper bottom narrower so flap reads as Egyptian nemes side-cloth
    const pos=flapGeo.attributes.position;
    const v=new THREE.Vector3();
    for(let i=0;i<pos.count;i++){
      v.fromBufferAttribute(pos,i);
      if(v.y < -0.5) v.z *= 0.65;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate=true;
    flapGeo.computeVertexNormals();
    const flap=new THREE.Mesh(flapGeo, nemesMat);
    flap.position.set(s*2.4, 11.6, -7.3);
    flap.rotation.z=s*0.18;
    sphinx.add(flap);
  });

  // ── URAEUS (cobra-symbool op voorhoofd) — desktop only, 2 sub-meshes (16-17)
  if(!mob){
    const uraeusBase=new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.13, 0.5, 6),
      nemesMat
    );
    uraeusBase.position.set(0, 11.7, -8.85);
    uraeusBase.rotation.x=-0.3;
    sphinx.add(uraeusBase);
    const uraeusHead=new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 6, 4),
      nemesMat
    );
    uraeusHead.position.set(0, 12.0, -8.95);
    sphinx.add(uraeusHead);
  }

  // ── PHARAO BAARD — desktop only, sub-mesh 18 (false beard onder kin)
  if(!mob){
    const baard=new THREE.Mesh(_bbox(0.5, 1.4, 0.5, 0.06), nemesMat);
    baard.position.set(0, 9.4, -8.95);
    baard.rotation.x=0.10;
    sphinx.add(baard);
  }

  // ── CAPSTONE — small pyramid on top of nemes — sub-mesh 19
  // Use ProcGeometry.pyramidCap for crisp 4-sided pyramid (not cone hack).
  const cap=new THREE.Mesh(
    ProcGeometry.pyramidCap({baseW:1.3, height:1.5}),
    nemesMat
  );
  cap.position.set(0, 13.5, -7.5);
  cap.rotation.y=Math.PI/4;
  sphinx.add(cap);

  // ── HALF-BURIED SAND MOUND — Lambert OK (background reads), sub-mesh 20
  // The mound IS the integrated base. Lambert acceptable here — it's
  // semi-decorative ground around the prop, not a hero surface.
  const moundMat=_ssMat({color:0xc8a070},{metalness:0.0,roughness:0.92},'desert-matte');
  const mound=new THREE.Mesh(
    new THREE.SphereGeometry(16, 14, 9, 0, Math.PI*2, 0, Math.PI*0.5),
    moundMat
  );
  mound.scale.set(1.3, 0.3, 1.1);
  mound.position.y=-1.5;
  sphinx.add(mound);

  // ── PLACEMENT: hero-prop just past start-line, in the player's forward
  // view at race-spawn. Was t=0.96 (just BEFORE start-line) which put the
  // sphinx behind the spawning player — invisible from race-cam looking
  // along +tangent. t=0.04 places it ~4% along the lap, in the camera
  // frustum at spawn. Group Y-offset is 0; the mound at sphinx-local
  // y=-1.5 buries its bottom half below ground for the half-buried look.
  const t=0.04;
  const off=BARRIER_OFF+14;
  const {tg,cx,cz}=_ssTrackSide(t,1,off);
  sphinx.position.set(cx, 0, cz);
  sphinx.rotation.y=Math.atan2(tg.x,tg.z)+Math.PI*0.5;
  scene.add(sphinx);
  if(window.dbg)dbg.log('sandstorm','sphinx placed at t='+t+' world=('+sphinx.position.x.toFixed(1)+','+sphinx.position.y.toFixed(1)+','+sphinx.position.z.toFixed(1)+')');
}

// Tempel ruins — Phase-3B rebuild per spec §3.6.
//
// Each standing pillar = 5 sub-meshes (base + entasis-shaft + capital echinus
// + abacus + decoratie-ring). 24 sides on shaft (12 mobile) for a properly
// round read from any camera angle. Entasis = the subtle mid-shaft bulge of
// classical pilaren — `ProcGeometry.entasisShaft` bakes the lathe-curve.
//
// Shared materials per surface-zone (shaft / accent / dark) so a 5-pillar
// scene yields 5 InstancedMesh-style draw calls (not 25 individual). The
// `decoratie-ring` is a TorusGeometry shared across pillars — also instanced.
// Mobile drops the decoratie-ring entirely (per spec).
//
// Fallen pillars: 3 stuks elk samengesteld uit 3 gebroken-stuk-cilinders
// rotated to lie on the ground (suggests "in 3 stukken gevallen") in
// position-clusters per pillar.
//
// Architrave: 1 main beam + 2 relief blocks via beveledBox (Phase-2 helper).
function _ssBuildTempleRuins(){
  const mob=window._isMobile;
  const COUNT_STANDING=_mobCount(5);
  const COUNT_FALLEN=_mobCount(3);
  // PBR materials with weatheredStone canvas. ageWear:0.6 puts visible AO
  // blobs + crack lines on each part. flutes:true on shaft adds the
  // vertical grooves typical of greek-style pilaren (mobile skips flutes
  // by passing flutes:false).
  const shaftTex=ProcTextures.weatheredStone({
    baseColor:'#b89370', crackColor:'#3a2418', crackCount:6,
    ageWear:0.6, flutes: !mob, repeatX:1, repeatY:1
  });
  const accentTex=ProcTextures.weatheredStone({
    baseColor:'#8c6f50', crackColor:'#2a1810', crackCount:5,
    ageWear:0.55, repeatX:1, repeatY:1
  });
  const shaftMat =_ssMakeStoneMat(shaftTex,  0.92);
  const accentMat=_ssMakeStoneMat(accentTex, 0.94);

  // Standing pillar parts — built once, reused via InstancedMesh per part.
  // entasisShaft baked at desktop sides:24 / mobile sides:12 per spec.
  const baseGeo=ProcGeometry.organicCylinder({
    topRadius:0.7, bottomRadius:0.85, height:0.5,
    sides: mob?12:16, displaceAmount:0.02, seed:101
  });
  const shaftGeo=ProcGeometry.entasisShaft({
    baseRadius:0.65, midRadius:0.7, topRadius:0.55,
    height:5, sides: mob?12:24
  });
  const echinusGeo=ProcGeometry.organicCylinder({
    topRadius:0.65, bottomRadius:0.55, height:0.3,
    sides: mob?12:16, displaceAmount:0.02, seed:131
  });
  const abacusGeo=ProcGeometry.beveledBox({
    w:1.5, h:0.3, d:1.5, bevel:0.05,
    bevelSegments: mob?1:2, curveSegments: mob?2:4
  });

  const baseIM   =new THREE.InstancedMesh(baseGeo,    accentMat, COUNT_STANDING);
  const shaftIM  =new THREE.InstancedMesh(shaftGeo,   shaftMat,  COUNT_STANDING);
  const echinusIM=new THREE.InstancedMesh(echinusGeo, accentMat, COUNT_STANDING);
  const abacusIM =new THREE.InstancedMesh(abacusGeo,  accentMat, COUNT_STANDING);

  // Decoratie-ring — kleine TorusGeometry tussen echinus en abacus.
  // Mobile skips this part entirely per spec §3.6.
  let ringIM=null;
  if(!mob){
    const ringGeo=new THREE.TorusGeometry(0.55, 0.06, 8, 16);
    ringIM=new THREE.InstancedMesh(ringGeo, accentMat, COUNT_STANDING);
  }

  const _dummy=new THREE.Object3D();
  for(let i=0;i<COUNT_STANDING;i++){
    const t=_SS_PLAZA_T_RANGE[0]+(i+0.5)/COUNT_STANDING*(_SS_PLAZA_T_RANGE[1]-_SS_PLAZA_T_RANGE[0]);
    const side=i%2===0?1:-1;
    const off=BARRIER_OFF+9+Math.random()*8;
    const {cx,cz}=_ssTrackSide(t,side,off);
    const yawJ=Math.random()*Math.PI*2;
    // Stack: base (y=0..0.5) → shaft (0.5..5.5) → echinus (5.5..5.8) → ring (~5.85) → abacus (5.95..6.25)
    _dummy.rotation.set(0,yawJ,0);
    _dummy.position.set(cx, 0.25, cz); _dummy.updateMatrix(); baseIM.setMatrixAt(i,_dummy.matrix);
    // entasisShaft has its bottom at y=0 (lathe), so position at y=0.5+(5/2)
    // would put the shaft midpoint at 3.0; lathe-result has y∈[0,5] so we
    // place at y=0.5 (so shaft.bottom=0.5 lands on top of base which ends
    // at y=0.5).
    _dummy.position.set(cx, 0.5, cz); _dummy.updateMatrix(); shaftIM.setMatrixAt(i,_dummy.matrix);
    _dummy.position.set(cx, 5.65, cz); _dummy.updateMatrix(); echinusIM.setMatrixAt(i,_dummy.matrix);
    _dummy.position.set(cx, 6.05, cz); _dummy.updateMatrix(); abacusIM.setMatrixAt(i,_dummy.matrix);
    if(ringIM){
      // Torus oriented horizontal (rotated around X)
      _dummy.rotation.set(Math.PI/2, yawJ, 0);
      _dummy.position.set(cx, 5.85, cz); _dummy.updateMatrix();
      ringIM.setMatrixAt(i,_dummy.matrix);
    }
  }
  baseIM.instanceMatrix.needsUpdate=true;     scene.add(baseIM);
  shaftIM.instanceMatrix.needsUpdate=true;    scene.add(shaftIM);
  echinusIM.instanceMatrix.needsUpdate=true;  scene.add(echinusIM);
  abacusIM.instanceMatrix.needsUpdate=true;   scene.add(abacusIM);
  if(ringIM){ ringIM.instanceMatrix.needsUpdate=true; scene.add(ringIM); }

  // ── Fallen pillars — 3 broken stukken per fallen, cilinder-shapes
  // rotated horizontal. Geeft een "in 3 stukken gevallen" lezing.
  // Reuse organicCylinder for variety in chunk-shapes.
  const chunkGeoA=ProcGeometry.organicCylinder({
    topRadius:0.65, bottomRadius:0.70, height:2.4,
    sides: mob?8:14, displaceAmount:0.04, seed:201
  });
  const chunkGeoB=ProcGeometry.organicCylinder({
    topRadius:0.62, bottomRadius:0.68, height:1.8,
    sides: mob?8:14, displaceAmount:0.05, seed:233
  });
  const chunkGeoC=ProcGeometry.organicCylinder({
    topRadius:0.60, bottomRadius:0.66, height:1.5,
    sides: mob?8:14, displaceAmount:0.06, seed:271
  });
  const fallenA=new THREE.InstancedMesh(chunkGeoA, shaftMat, COUNT_FALLEN);
  const fallenB=new THREE.InstancedMesh(chunkGeoB, shaftMat, COUNT_FALLEN);
  const fallenC=new THREE.InstancedMesh(chunkGeoC, shaftMat, COUNT_FALLEN);
  for(let i=0;i<COUNT_FALLEN;i++){
    const t=_SS_PLAZA_T_RANGE[0]+0.05+Math.random()*(_SS_PLAZA_T_RANGE[1]-_SS_PLAZA_T_RANGE[0]-0.10);
    const side=(i+1)%2===0?1:-1;
    const off=BARRIER_OFF+12+Math.random()*10;
    const {cx,cz}=_ssTrackSide(t,side,off);
    // Common ground-orientation: cilinders lying along an axis defined by yaw.
    const yaw=Math.random()*Math.PI*2;
    const ax=Math.cos(yaw), az=Math.sin(yaw);
    // 3 chunks placed end-to-end along the yaw-axis with slight angular drift
    _dummy.position.set(cx, 0.7, cz);
    _dummy.rotation.set(0, yaw,         Math.PI/2);
    _dummy.updateMatrix(); fallenA.setMatrixAt(i,_dummy.matrix);
    _dummy.position.set(cx + ax*2.1, 0.65, cz + az*2.1);
    _dummy.rotation.set(0, yaw + 0.25,  Math.PI/2);
    _dummy.updateMatrix(); fallenB.setMatrixAt(i,_dummy.matrix);
    _dummy.position.set(cx + ax*3.7, 0.62, cz + az*3.7);
    _dummy.rotation.set(0.10, yaw + 0.55, Math.PI/2);
    _dummy.updateMatrix(); fallenC.setMatrixAt(i,_dummy.matrix);
  }
  fallenA.instanceMatrix.needsUpdate=true; scene.add(fallenA);
  fallenB.instanceMatrix.needsUpdate=true; scene.add(fallenB);
  fallenC.instanceMatrix.needsUpdate=true; scene.add(fallenC);

  // ── Architrave fragment — main beam (beveledBox) + 2 relief blocks beneath.
  const tMid=(_SS_PLAZA_T_RANGE[0]+_SS_PLAZA_T_RANGE[1])*0.5;
  const off=BARRIER_OFF+18;
  const {tg,cx,cz}=_ssTrackSide(tMid,1,off);
  const yaw=Math.atan2(tg.x,tg.z);
  const beam=new THREE.Mesh(
    ProcGeometry.beveledBox({w:6, h:1.2, d:1.4, bevel:0.10,
      bevelSegments: mob?1:2, curveSegments: mob?2:4}),
    shaftMat
  );
  beam.position.set(cx,1.0,cz);
  beam.rotation.y=yaw; beam.rotation.z=0.18;
  scene.add(beam);
  const relief1=new THREE.Mesh(
    ProcGeometry.beveledBox({w:2.4, h:0.5, d:1.0, bevel:0.06,
      bevelSegments: mob?1:2, curveSegments: mob?2:3}),
    accentMat
  );
  relief1.position.set(cx-0.6,0.4,cz); relief1.rotation.y=yaw; scene.add(relief1);
  const relief2=new THREE.Mesh(
    ProcGeometry.beveledBox({w:2.0, h:0.5, d:1.0, bevel:0.06,
      bevelSegments: mob?1:2, curveSegments: mob?2:3}),
    accentMat
  );
  relief2.position.set(cx+1.2,0.35,cz); relief2.rotation.y=yaw+0.05; scene.add(relief2);
}

// Obelisken — Phase-3B rebuild per spec §3.7. 2 obelisken bij plaza.
//
// Sub-meshes per obelisk (desktop): sokkel + 2 plinten + tapered prism shaft
// (NOT a 4-side cylinder hack — uses ProcGeometry.taperedPrism for crisp
// 4-sided silhouette) + pyramidCap. Hieroglyph-suggestion via
// ProcTextures.pseudoGlyphs as a second material on the shaft (overlaid by
// using the same canvas-tex with composited glyphs).
//
// Mobile: skip plinten + skip hiërogliefen, use simple weatheredStone.
function _ssBuildObelisks(){
  const mob=window._isMobile;
  // Shaft: mobile uses plain weatheredStone; desktop uses pseudoGlyphs which
  // composites glyph-marks on top of a sandstone base. ProcTextures handles
  // both via cache so the call is cheap (LRU hit on rebuild).
  const shaftTex = mob
    ? ProcTextures.weatheredStone({
        baseColor:'#b89370', crackColor:'#3a2418', crackCount:8,
        ageWear:0.7, repeatX:1, repeatY:1
      })
    : ProcTextures.pseudoGlyphs({
        rowCount:5, glyphsPerRow:4,
        baseColor:'#b89370', glyphColor:'#3a2418',
        repeatX:1, repeatY:1
      });
  const accentTex=ProcTextures.weatheredStone({
    baseColor:'#9a7048', crackColor:'#2a1810', crackCount:5,
    ageWear:0.5, repeatX:1, repeatY:1
  });
  const shaftMat =_ssMakeStoneMat(shaftTex,  0.92);
  const accentMat=_ssMakeStoneMat(accentTex, 0.94);
  // Capstone — lightly emissive gold-tinted "gilded tip" (#d0a070 per spec).
  // Lambert supports emissive — slight metalness:0.18 specular highlight
  // is dropped on mobile (not visible at race speed past the obelisk caps).
  const capMat=window._isMobile
    ? new THREE.MeshLambertMaterial({color:0xd0a070, emissive:0x4a2810, emissiveIntensity:0.30})
    : new THREE.MeshStandardMaterial({color:0xd0a070, roughness:0.55, metalness:0.18, emissive:0x4a2810, emissiveIntensity:0.30});

  [_SS_PLAZA_T_RANGE[0],_SS_PLAZA_T_RANGE[1]].forEach((t,idx)=>{
    const side=idx===0?-1:1;
    const off=BARRIER_OFF+5;
    const {cx,cz}=_ssTrackSide(t,side,off);

    // SOKKEL — main base block (always present)
    const sokkel=new THREE.Mesh(
      ProcGeometry.beveledBox({w:2.5, h:1.0, d:2.5, bevel:0.08,
        bevelSegments: mob?1:2, curveSegments: mob?2:4}),
      accentMat
    );
    sokkel.position.set(cx, 0.5, cz);
    scene.add(sokkel);

    // PLINTEN — 2 stepped blocks above sokkel — desktop only per spec
    let topOfPlinten = 1.0; // y at which the shaft begins (default = top of sokkel)
    if(!mob){
      const plinth1=new THREE.Mesh(
        ProcGeometry.beveledBox({w:2.2, h:0.4, d:2.2, bevel:0.06,
          bevelSegments:2, curveSegments:3}),
        accentMat
      );
      plinth1.position.set(cx, 1.2, cz); scene.add(plinth1);
      const plinth2=new THREE.Mesh(
        ProcGeometry.beveledBox({w:1.9, h:0.4, d:1.9, bevel:0.05,
          bevelSegments:2, curveSegments:3}),
        accentMat
      );
      plinth2.position.set(cx, 1.6, cz); scene.add(plinth2);
      topOfPlinten = 1.8;
    }

    // SHAFT — taperedPrism (4-sided, NOT cylinder hack). Spec §3.7.
    // taperedPrism's local Y range is [0, height], so we position the
    // mesh at topOfPlinten so the shaft-bottom rests on the plinten.
    const shaft=new THREE.Mesh(
      ProcGeometry.taperedPrism({topW:0.4, bottomW:0.7, height:12}),
      shaftMat
    );
    shaft.position.set(cx, topOfPlinten, cz);
    scene.add(shaft);

    // CAPSTONE — pyramidCap on top of shaft
    const cap=new THREE.Mesh(
      ProcGeometry.pyramidCap({baseW:0.55, height:1.2}),
      capMat
    );
    cap.position.set(cx, topOfPlinten + 12, cz);
    scene.add(cap);
  });
}

// Palm trees — Phase-3C rebuild per spec §3.8. Trunk via
// ProcGeometry.curvedTrunk (single tapered cyl with monotonic Y-bend
// — was 2 stacked Cylinders in the old build). Trunk-tex via
// ProcTextures.bark (horizontal rings + grain). Leaves via
// ProcTextures.palmLeaf which returns a {texture, alphaMap} pair —
// lets us use Lambert + alphaTest + transparent:false (per spec §2.2
// material-exception list, avoids mobile PBR alpha-sortering issues).
//
// Spec §3.8: 10 leaves desktop / 6 mobile (was 8 in earlier draft).
// Each leaf is a custom BufferGeometry with 12 segments along length
// for natural per-segment droop curve — currently approximated via a
// PlaneGeometry rotated/positioned with a single droop angle. Acceptable
// trade for cache-friendly InstancedMesh draw-call (1 IM for all leaves).
function _ssBuildPalmTrees(){
  const mob=window._isMobile;
  const COUNT=_mobCount(12);
  const FRONDS_PER_PALM = mob?6:10;
  const barkTex=ProcTextures.bark({
    baseColor:'#6e4520', ringColor:'#8b5a2b', ringCount:14
  });
  const trunkMat=window._isMobile
    ? new THREE.MeshLambertMaterial({map:barkTex, color:0x8b6532})
    : _ssMat({map:barkTex, color:0x8b6532},{metalness:0.0,roughness:0.92},'desert-matte');
  // palmLeaf returns { texture, alphaMap }. Lambert + alphaTest +
  // transparent:false avoids mobile-PBR alpha-sortering Z-fighting (spec
  // material-exception §2.2).
  const leafPair=ProcTextures.palmLeaf({
    darkColor:'#2c4818', lightColor:'#86b540', midribColor:'#5a8a28'
  });
  const leafMat=_ssMat({
    map:leafPair.texture, alphaMap:leafPair.alphaMap,
    alphaTest:0.5, transparent:false,
    side:THREE.DoubleSide
  },{metalness:0.0,roughness:0.80},'desert-matte');
  // Frond geometry — multi-segment plane with a baked quadratic droop
  // curve along its length. Visual-fix-v2 issue 6: the previous single-
  // quad PlaneGeometry rendered as 2D no matter the per-frond rotation.
  // Now: 12 segments desktop / 6 mobile, anchored at the BASE (local x=0)
  // instead of center so the leaf attaches to the crown rim and the tip
  // hangs out radially. Per-vertex Y droop is t² where t = x/length, so
  // the base stays flat and the tip falls ~0.5u — combines naturally
  // with the per-frond rigid tilt below for realistic variation.
  const FROND_W=3.4, FROND_H=1.2;
  const FROND_SEGS = mob ? 6 : 12;
  const frondGeo=new THREE.PlaneGeometry(FROND_W, FROND_H, FROND_SEGS, 1);
  frondGeo.translate(FROND_W*0.5, 0, 0);
  {
    const pos=frondGeo.attributes.position;
    const DROOP_MAX=0.5;
    for(let i=0;i<pos.count;i++){
      const x=pos.getX(i);
      const t=x/FROND_W;
      pos.setY(i, pos.getY(i) - DROOP_MAX*t*t);
    }
    pos.needsUpdate=true;
    frondGeo.computeVertexNormals();
  }
  // Trunk built once with curvedTrunk; per-tree scale.y handles height
  // variance so geometry stays shared.
  const trunkGeo=ProcGeometry.curvedTrunk({
    segments: mob?4:5,
    baseRadius:0.20, topRadius:0.14,
    height: 1,                 // unit height — scale.y per-tree
    curveAmount:0.4,
    sides: mob?6:8
  });
  // All fronds across all palms in ONE InstancedMesh — biggest perf win.
  // 12 palms × 10 fronds = 120 draws compressed into 1.
  const frondIM=new THREE.InstancedMesh(frondGeo, leafMat, COUNT*FRONDS_PER_PALM);
  // Trunks across all palms in ONE InstancedMesh — was 12 separate Mesh
  // objects (12 draw calls) since each had identical geometry + material
  // and only position/rotation/scale differed. Single IM = 1 draw call.
  const trunkIM=new THREE.InstancedMesh(trunkGeo, trunkMat, COUNT);
  const _dummy=new THREE.Object3D();
  let frondIdx=0;
  for(let i=0;i<COUNT;i++){
    const t=_SS_PLAZA_T_RANGE[0]+(i/COUNT)*(_SS_PLAZA_T_RANGE[1]-_SS_PLAZA_T_RANGE[0]);
    const side=i%2===0?1:-1;
    const off=BARRIER_OFF+3+Math.random()*7;
    const {cx,cz}=_ssTrackSide(t,side,off);
    const h=4.5+Math.random()*1.5;
    const sc=0.85+Math.random()*0.30;
    const yawJ=Math.random()*Math.PI*2;
    // Trunk — write transform into trunkIM via the shared _dummy. Same
    // (position, scale, rotation) values the per-trunk Mesh used; the IM
    // composes a per-instance matrix from these.
    _dummy.position.set(cx, h*0.5, cz);
    _dummy.scale.set(sc, h, sc);
    _dummy.rotation.set(0, yawJ, 0);
    _dummy.updateMatrix();
    trunkIM.setMatrixAt(i, _dummy.matrix);
    // Crown position — palm-tops sit at trunk.scale.y. The curvedTrunk
    // bend produces a slight X offset at the top; approximate via the
    // bake-curve constant 0.4 × top-Y-fraction. Good enough for crown
    // placement (player rarely studies trunk-curve continuity).
    const topX=cx + Math.sin(yawJ) * 0.4 * h * 0.5;
    const topY=h + 0.3;
    const topZ=cz + Math.cos(yawJ) * 0.4 * h * 0.5;
    for(let l=0;l<FRONDS_PER_PALM;l++){
      const ang=(l/FRONDS_PER_PALM)*Math.PI*2;
      // Rigid tilt softened from -0.32..-0.44 to -0.10..-0.20: the baked
      // droop curve in frondGeo now provides the bulk of the bend, so the
      // per-frond X-rotation only needs to angle the whole leaf slightly
      // down (otherwise the curve + tilt overshoot and tips poke ground).
      const droop=-0.10-Math.random()*0.10;
      _dummy.position.set(
        topX+Math.cos(ang+yawJ)*1.1,
        topY,
        topZ+Math.sin(ang+yawJ)*1.1
      );
      _dummy.rotation.set(droop, ang+yawJ, (Math.random()-0.5)*0.2, 'YXZ');
      _dummy.scale.set(sc, sc, sc);
      _dummy.updateMatrix();
      frondIM.setMatrixAt(frondIdx++, _dummy.matrix);
    }
  }
  frondIM.count=frondIdx;
  frondIM.instanceMatrix.needsUpdate=true;
  scene.add(frondIM);
  trunkIM.instanceMatrix.needsUpdate=true;
  scene.add(trunkIM);
}

// Camel silhouettes — Phase-3C rebuild per spec §3.11. Background scale-
// cue placed >200u from the track centre. Per spec §2.2 material-exception
// list: distant background → MeshLambertMaterial is acceptable (PBR is
// wasted on props that vanish into fog).
//
// Mobile per spec §3.11 builds camels minus the legs (lichaam + humps +
// hals + hoofd zwevend in haze — geen probleem). Was: mobile skipped
// camels entirely. Now: mobile keeps the silhouette read.
//
// Body parts use ProcGeometry.beveledBox with mobile-LOD opts (bevSegs:1,
// curveSegs:2) so the merged geo isn't bloated. All parts merged into ONE
// BufferGeometry → InstancedMesh × N positions → 1 draw call total.
function _ssBuildCamels(){
  const mob=window._isMobile;
  // Spec §3.11 color: warme bruin-grijs #8b6f4d.
  const camelMat=_ssMat({color:0x8b6f4d},{metalness:0.0,roughness:0.92},'desert-matte');
  const parts=[];
  // Helper: take a prebuilt geometry, translate + optionally rotate, push.
  const _push=(g, x, y, z, rx, ry, rz)=>{
    if(rx||ry||rz){
      const e=new THREE.Euler(rx||0,ry||0,rz||0,'XYZ');
      const q=new THREE.Quaternion().setFromEuler(e);
      const m=new THREE.Matrix4().makeRotationFromQuaternion(q);
      g.applyMatrix4(m);
    }
    g.translate(x,y,z);
    parts.push(g);
  };
  const _bev=(w,h,d,bevel)=>ProcGeometry.beveledBox({
    w, h, d, bevel,
    bevelSegments: mob?1:2,
    curveSegments: mob?2:3
  });
  const _sph=(r,sy)=>{
    const g=new THREE.SphereGeometry(r, mob?5:6, mob?3:4);
    g.scale(1, sy||1, 1);
    return g;
  };
  const _cyl=(rTop, rBot, h, sides)=>new THREE.CylinderGeometry(rTop, rBot, h, sides);

  // Body + humps + neck + head — always present (mobile + desktop)
  _push(_bev(3.5, 1.4, 1.0, 0.10), 0, 1.6, 0);
  _push(_sph(0.7, 1.2),            -0.6, 2.6, 0);
  _push(_sph(0.7, 1.2),             0.7, 2.6, 0);
  _push(_cyl(0.20, 0.30, 1.8, mob?5:6), 1.7, 2.4, 0, 0, 0, -0.6);
  _push(_bev(0.8, 0.5, 0.6, 0.05),  2.5, 3.1, 0);
  // Legs — desktop only per spec §3.11
  if(!mob){
    _push(_cyl(0.12, 0.18, 1.6, 6), -1, 0.8, -0.3);
    _push(_cyl(0.12, 0.18, 1.6, 6),  1, 0.8, -0.3);
    _push(_cyl(0.12, 0.18, 1.6, 6), -1, 0.8,  0.3);
    _push(_cyl(0.12, 0.18, 1.6, 6),  1, 0.8,  0.3);
  }
  // Merge via the three-r160 utility. Parts mix BoxGeometry (which has
  // UVs) with CylinderGeometry/SphereGeometry (also UVs) so attribute-set
  // is uniform; mergeBufferGeometries handles cleanly.
  const merged=THREE.BufferGeometryUtils.mergeBufferGeometries(parts);
  parts.forEach(g=>g.dispose());
  // Place 4 instances on far dunes (>200u from track centre per spec).
  // 8 camel positions desktop, doubled from the original 4 for the v4
  // density rebuild. Spread across all 4 quadrants on far dunes (>200u
  // from track centre per spec §3.11).
  const positions=mob
    ? [[210,-280],[-180,-310],[-260,80],[280,180]]
    : [[210,-280],[-180,-310],[-260,80],[280,180],
       [330,-90],[-300,-180],[-100,330],[150,300]];
  const im=new THREE.InstancedMesh(merged, camelMat, positions.length);
  const _dummy=new THREE.Object3D();
  positions.forEach(([px,pz],i)=>{
    _dummy.position.set(px, 0, pz);
    _dummy.rotation.set(0, Math.random()*Math.PI*2, 0);
    const sc=0.85+Math.random()*0.30;
    _dummy.scale.set(sc, sc, sc);
    _dummy.updateMatrix();
    im.setMatrixAt(i, _dummy.matrix);
  });
  im.instanceMatrix.needsUpdate=true;
  scene.add(im);
}

// Pyramids — visual-fix-v4 §3 Giza-cluster.
// Three Egyptian pyramids near the start/finish straight, visible to the
// player at race-spawn. ProcGeometry.pyramidCap (already used for obelisk
// capstones) gives a clean 4-triangle pyramid with the apex at +Y and a
// square base at Y=0 — perfect when scaled up.
//
// Hero pyramid (Cheops-style): baseW=22, h=30, ~120u from start.
// Companion 1 (Khafre):        baseW=18, h=22, ~170u.
// Companion 2 (Menkaure):      baseW=12, h=14, ~240u.
//
// Companions get atmospheric-perspective material color blended toward
// the day-fog tint (matches the existing mesa-tier pattern). Hero stays
// crisp — it's the closest hero-prop and shouldn't fade.
//
// Placement: along the +nr-side of the start-straight (same side as the
// sphinx), with along-tangent offsets so the trio is not collinear (= a
// natural Giza panorama instead of a row of stamps). Pyramids stand on
// the ground (geometry base at Y=0, position Y=0).
//
// Performance: 1 mesh per pyramid (3 total) sharing one MeshStandardMaterial
// instance via clone-with-color-shift. Hero casts shadow on desktop, the
// rest don't (companions are far enough that shadow detail is wasted).
function _ssBuildPyramids(){
  const mob=window._isMobile;
  // Stepped-look sandstone texture. crackCount + repeatY get most of the
  // way toward the visible block-course banding the spec asked for, without
  // needing a bespoke canvas painter. The MeshStandardMaterial sun-shading
  // and ACES tone-mapping handles the highlight/shadow per face.
  const pyrTex=ProcTextures.weatheredStone({
    baseColor:'#c9a473', crackColor:'#5a3a1d',
    crackCount:14, ageWear:0.55,
    repeatX:1, repeatY:2
  });
  const baseMat=window._isMobile
    ? new THREE.MeshLambertMaterial({map:pyrTex, color:0xc9a473})
    : _ssMat({map:pyrTex, color:0xc9a473},{metalness:0.0,roughness:0.92},'desert-matte');
  const {p:startP,tg:startTg,nr:startNr}=_ssTrackSide(0.0,1,0);
  // [baseW, height, distOff, alongMul, blendToFog]
  const trio=[
    [22, 30, 120,  0.20, 0.00],   // Cheops hero
    [18, 22, 170, -0.40, 0.30],   // Khafre — set further back along tangent
    [12, 14, 240,  0.30, 0.55]    // Menkaure — furthest, biggest fog blend
  ];
  const fogCol=new THREE.Color('#e8a468');
  trio.forEach(([baseW,h,distOff,alongMul,blend], idx)=>{
    const cx = startP.x + startNr.x*distOff + startTg.x*alongMul*distOff;
    const cz = startP.z + startNr.z*distOff + startTg.z*alongMul*distOff;
    const geo = ProcGeometry.pyramidCap({ baseW: baseW, height: h });
    const mat = baseMat.clone();
    if(blend>0) mat.color.lerp(fogCol, blend);
    const mesh=new THREE.Mesh(geo, mat);
    mesh.position.set(cx, 0, cz);
    // 45° rotation so 4 sloped sides face the cardinal directions instead
    // of corner-on. Slight per-pyramid yaw jitter so they're not exactly
    // aligned (would read as obviously procedural).
    mesh.rotation.y = Math.PI*0.25 + (idx-1)*0.18;
    if(!mob && idx===0) mesh.castShadow=true;
    mesh.receiveShadow=!mob;
    scene.add(mesh);
  });
}

// Bedouin tents — Phase-3C rebuild per spec §3.10. PBR baseline,
// ProcTextures.stripedFabric for the canvas. Per spec adds: open ingang
// (wedge weglaten via thetaLength), tent-flap als losse PlaneGeometry,
// 4 touwen van rand naar ground-spike. Mobile keeps tent + pole only
// (skip ropes + flap to save 5 calls per tent × 3 tents = 15 calls).
function _ssBuildBedouinTents(){
  const mob=window._isMobile;
  const COUNT=_mobCount(3);
  const stripeTex=ProcTextures.stripedFabric({
    stripeCount:8,
    colors:['#a83a25','#d4b890','#7a4a25'],
    repeatX:1, repeatY:1
  });
  const tentMat=window._isMobile
    ? new THREE.MeshLambertMaterial({map:stripeTex, side:THREE.DoubleSide})
    : _ssMat({map:stripeTex, side:THREE.DoubleSide},{metalness:0.0,roughness:0.80},'desert-matte');
  const poleMat=_ssMat({color:0x4a3018},{metalness:0.0,roughness:0.85},'desert-matte');
  const ropeMat=_ssMat({color:0xb89370},{metalness:0.0,roughness:0.92},'desert-matte');
  // Cone with thetaLength=2π - π/3 leaves a ~60° wedge open as the
  // entrance. theta starts at -π/6 so the open arc straddles the +Z axis
  // (front of the tent after rotation.y).
  const tentGeo=new THREE.ConeGeometry(2.4, 3.2, 6, 1, false, -Math.PI/6, Math.PI*2 - Math.PI/3);
  const poleGeo=new THREE.CylinderGeometry(0.08, 0.08, 3.8, 5);
  const ropeGeo=new THREE.CylinderGeometry(0.025, 0.025, 1.0, 4); // unit-length, scale per rope
  const flapGeo=new THREE.PlaneGeometry(1.6, 2.0);
  for(let i=0;i<COUNT;i++){
    const t=_SS_PLAZA_T_RANGE[0]+0.04+i*((_SS_PLAZA_T_RANGE[1]-_SS_PLAZA_T_RANGE[0]-0.08)/Math.max(1,COUNT-1));
    const side=i%2===0?-1:1;
    const off=BARRIER_OFF+15+Math.random()*4;
    const {cx,cz}=_ssTrackSide(t,side,off);
    const yaw=Math.random()*Math.PI*2;
    // Cone tent — slight scheve hoek per spec §3.10
    const tent=new THREE.Mesh(tentGeo, tentMat);
    tent.position.set(cx, 1.4, cz);
    tent.rotation.set(
      (Math.random()-0.5)*0.10,
      yaw,
      (Math.random()-0.5)*0.06
    );
    scene.add(tent);
    // Center pole peeking up through the top
    const pole=new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(cx, 1.7, cz);
    scene.add(pole);
    // Mobile stops here. Desktop adds 4 ropes + 1 flap (decorative detail).
    if(mob)continue;
    // 4 ropes from tent-edge (~y=2.0 at cone-rim) down to ground-spikes.
    // Skip the rope nearest the open ingang so the entrance reads.
    for(let r=0;r<4;r++){
      const ang=(r/4)*Math.PI*2 + yaw + Math.PI*0.25;
      // Skip the rope whose angle aligns with the open wedge (front)
      if(Math.abs(ang - yaw - Math.PI*0.5) < 0.5)continue;
      const ex=cx + Math.cos(ang)*2.4;
      const ez=cz + Math.sin(ang)*2.4;
      // Rope mid-point + length: from edge (y=2.0) down to spike (y=0)
      const mx=(cx + ex)*0.5;
      const mz=(cz + ez)*0.5;
      const my=1.0;
      const ropeLen=Math.hypot(ex-cx, 2.0, ez-cz);
      const rope=new THREE.Mesh(ropeGeo, ropeMat);
      rope.position.set(mx, my, mz);
      // Rotate rope to align from tent-edge to ground-spike. Compute the
      // vector and use lookAt-trick: scale-Y to length, then rotate so Y
      // axis points along the rope vector.
      rope.scale.y=ropeLen;
      const dx=ex-cx, dy=-2.0, dz=ez-cz;
      // Rotate Y-axis to point toward (dx,dy,dz). Use lookAt with up=X.
      const tmpUp=new THREE.Vector3(0,1,0);
      const dir=new THREE.Vector3(dx,dy,dz).normalize();
      const axis=new THREE.Vector3().crossVectors(tmpUp, dir).normalize();
      const angle=Math.acos(Math.max(-1, Math.min(1, tmpUp.dot(dir))));
      rope.quaternion.setFromAxisAngle(axis, angle);
      scene.add(rope);
    }
    // Tent-flap — open door to one side of the entrance wedge.
    const flap=new THREE.Mesh(flapGeo, tentMat);
    const flapAng=yaw + Math.PI*0.5; // front of tent
    flap.position.set(
      cx + Math.cos(flapAng)*2.0,
      1.0,
      cz + Math.sin(flapAng)*2.0
    );
    flap.rotation.y=flapAng - 0.6; // hinged open ~35°
    // Phase 13C — cache base rotation.y voor flapping animation
    flap.userData = {_baseRotY: flap.rotation.y, _phase: i*1.7};
    _ssTentFlaps.push(flap);
    scene.add(flap);
    // Phase 13C — banner op pole-top: kleine vlag die wappert
    const bannerGeo = new THREE.PlaneGeometry(1.2, 0.6);
    const bannerMat = _ssMat({
      color:0xc44a25, emissive:0x331008, emissiveIntensity:0.2,
      side:THREE.DoubleSide
    },{metalness:0.0,roughness:0.65},'desert-matte');
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(cx + 0.6, 3.6, cz);
    banner.userData = {_baseX: cx + 0.6, _baseZ: cz, _phase: i*0.9};
    _ssTentBanners.push(banner);
    scene.add(banner);
  }
}

// ── Phase-4 §4.2: roadside detail spawner ───────────────────────────────
//
// 6 prop-types distributed along the track in 6 InstancedMeshes (4 op
// mobile — cactus + bones skipped per spec). Target totals: 100 desktop /
// 50 mobile, allocated 30/25/15/12/10/8 % per type per spec §4.2.
//
// Each prop-type has ONE prototype geometry (merged where multi-shape).
// Per-instance jitter via Object3D matrix (rotation + scale + position).
// Materials are shared across all instances of a type.
//
// Replaces the standalone _ssBuildScarabSigns + the now-deleted
// _ssScarabSignTex inline canvas. Scarab signs live as one of the 6
// prop-types here.
function _ssBuildRoadsideDetail(){
  const mob=window._isMobile;
  // Per-type instance counts. Mobile drops cactus + bones per spec §4.2.
  // Bumped vs Phase-4 originals to fix the "wereld voelt te leeg" report
  // (visual-fix-v4 bug 2): rock 30→40, marker 15→25 for stronger track-edge
  // density, cactus 12→15, others trimmed slightly so total stays in budget.
  const COUNTS = mob
    ? {rock:18, sunken:13, marker:12, cactus:0, bones:0, scarab:3}
    : {rock:40, sunken:25, marker:25, cactus:15, bones:8, scarab:6};

  // ── Materials (all shared, no clones) ─────────────────────────────────
  const stoneTex=ProcTextures.weatheredStone({
    baseColor:'#a8643a', crackColor:'#3a2418', crackCount:5, ageWear:0.5
  });
  const stoneMat=_ssMakeStoneMat(stoneTex, 0.95);
  const woodMat=_ssMat({color:0x6e4520},{metalness:0.0,roughness:0.80},'desert-matte');
  const cactusMat=window._isMobile?new THREE.MeshLambertMaterial({color:0x4a6b32}):_ssMat({color:0x4a6b32},{metalness:0.0,roughness:0.85},'desert-matte');
  const boneMat=_ssMat({color:0xe8d8b0},{metalness:0.0,roughness:0.85},'desert-matte');
  // Scarab sign uses pseudoGlyphs as a bug-silhouette stand-in via opts —
  // ProcTextures.pseudoGlyphs has the visual primitives we need.
  const signTex=ProcTextures.pseudoGlyphs({
    rowCount:1, glyphsPerRow:1,
    baseColor:'#7a4818', glyphColor:'#1a0e04'
  });
  const signMat=_ssMat({map:signTex,side:THREE.DoubleSide},{metalness:0.0,roughness:0.85},'desert-matte');

  // ── Prototype geometries ─────────────────────────────────────────────
  // Rock: simple beveledBox. Per-instance scale jitter creates "cluster" feel
  // when multiple instances overlap.
  const rockGeo=ProcGeometry.beveledBox({
    w:1.2, h:0.8, d:1.4, bevel:0.12,
    bevelSegments: mob?1:2, curveSegments: mob?2:3
  });
  // Sunken stone: low + wider beveledBox (will be Y-rotated random)
  const sunkenGeo=ProcGeometry.beveledBox({
    w:1.6, h:0.4, d:1.0, bevel:0.10,
    bevelSegments: mob?1:2, curveSegments: mob?2:3
  });
  // Marker: pole + flag merged (1 IM × N instances, pole always upright)
  const markerGeo=(()=>{
    const pole=new THREE.CylinderGeometry(0.06, 0.08, 2.2, 5);
    pole.translate(0, 1.1, 0);
    const flag=new THREE.PlaneGeometry(0.6, 0.4);
    flag.translate(0.35, 1.85, 0);
    return _ssMergeProto([pole, flag]);
  })();
  // Cactus: 3-cylinder Saguaro shape (main + 2 arms) merged
  const cactusGeo=(()=>{
    const trunk=new THREE.CylinderGeometry(0.28, 0.32, 2.4, 7);
    trunk.translate(0, 1.2, 0);
    const armL=new THREE.CylinderGeometry(0.18, 0.20, 1.0, 6);
    armL.translate(-0.45, 1.4, 0);
    armL.rotateZ(0.5);
    const armLUp=new THREE.CylinderGeometry(0.16, 0.18, 0.8, 6);
    armLUp.translate(-0.65, 2.0, 0);
    const armR=new THREE.CylinderGeometry(0.18, 0.20, 0.8, 6);
    armR.translate(0.40, 1.6, 0);
    armR.rotateZ(-0.5);
    return _ssMergeProto([trunk, armL, armLUp, armR]);
  })();
  // Bones: skull-like sphere + 2 boxes (tanden) merged
  const bonesGeo=(()=>{
    const skull=new THREE.SphereGeometry(0.35, 7, 5);
    skull.translate(0, 0.4, 0);
    const tooth1=new THREE.BoxGeometry(0.08, 0.15, 0.08);
    tooth1.translate(-0.10, 0.20, 0.30);
    const tooth2=new THREE.BoxGeometry(0.08, 0.15, 0.08);
    tooth2.translate( 0.10, 0.20, 0.30);
    const horn1=new THREE.CylinderGeometry(0.05, 0.08, 0.4, 5);
    horn1.translate(-0.20, 0.65, 0);
    horn1.rotateZ(0.6);
    const horn2=new THREE.CylinderGeometry(0.05, 0.08, 0.4, 5);
    horn2.translate( 0.20, 0.65, 0);
    horn2.rotateZ(-0.6);
    return _ssMergeProto([skull, tooth1, tooth2, horn1, horn2]);
  })();
  // Scarab sign: pole + sign-plate as TWO separate prototype geometries
  // (NOT merged). Reason: signMat carries the pseudoGlyphs map, and on a
  // merged pole+sign mesh the pole's tight cylinder UVs would wrap the
  // glyph pattern in awkward stripes around the post. Splitting lets the
  // pole use plain woodMat and only the sign-plate samples signMat.
  // Trade-off: 2 IMs per scarab type instead of 1 (8 → 16 instances split
  // across 2 IMs = +1 draw call per type, still well under budget).
  const scarabPoleGeo=new THREE.CylinderGeometry(0.08, 0.08, 2.4, 5);
  scarabPoleGeo.translate(0, 1.2, 0);
  const scarabSignGeo=new THREE.PlaneGeometry(1.6, 1.2);
  scarabSignGeo.translate(0, 2.1, 0);

  // ── Spawn helper: walks waypoints, places instances within 3-8u of edge.
  // Stratified t-sampling (i/count + jitter) replaces pure Math.random()
  // so each prop occupies its own track-fraction. Pure random was causing
  // long visually-empty stretches (visual-fix-v4 bug 2: "lange rechte met
  // enkel één tent in de verte"). Each prop now has its own t-bucket.
  const _dummy=new THREE.Object3D();
  // Reject candidates closer than (TW + _SS_PROP_TRACK_MARGIN) to the racing
  // line. TW=13 is the track half-width, +5u marge ⇒ rocks stay clearly off
  // the asphalt even where stratified t-sampling lands them on the inside of
  // a tight bend. trackDist() is a global from gameplay/tracklimits.js;
  // guarded with typeof in case the script order ever changes.
  const _SS_PROP_TRACK_MARGIN=5;
  const _spawn=(im, count, mat, scaleRange, offRange, yOff)=>{
    if(!count) return;
    let placed=0;
    for(let i=0;i<count;i++){
      let cx=0, cz=0, valid=false;
      for(let attempt=0;attempt<8;attempt++){
        const t=((i+Math.random())/count)%1;
        const side=Math.random()<0.5?-1:1;
        const off=BARRIER_OFF + offRange[0] + Math.random()*(offRange[1]-offRange[0]);
        const a=_ssTrackSide(t,side,off);
        cx=a.cx + (Math.random()-0.5)*1.5;
        cz=a.cz + (Math.random()-0.5)*1.5;
        if(typeof trackDist!=='function' || trackDist({x:cx,z:cz}, t) >= TW+_SS_PROP_TRACK_MARGIN){ valid=true; break; }
      }
      if(!valid) continue;
      _dummy.position.set(cx, yOff||0, cz);
      _dummy.rotation.set(0, Math.random()*Math.PI*2, 0);
      const sc=scaleRange[0] + Math.random()*(scaleRange[1]-scaleRange[0]);
      _dummy.scale.set(sc, sc, sc);
      _dummy.updateMatrix();
      im.setMatrixAt(placed++, _dummy.matrix);
    }
    im.count=placed;
    im.instanceMatrix.needsUpdate=true;
    scene.add(im);
  };

  // ── Build the 6 InstancedMeshes ──────────────────────────────────────
  // Offset-ranges below are EXTRA distance beyond BARRIER_OFF (=16). Earlier
  // values [3..8] put rocks at 19-24u from the centerline — within or right
  // on the racing line at TW=13 + jitter on tight bends. Bumped so the
  // minimum is BARRIER_OFF + 7 = 23u (= TW + 10u), with the trackDist()
  // guard above as belt-and-braces for bend insides.
  if(COUNTS.rock){
    const rockIM=new THREE.InstancedMesh(rockGeo, stoneMat, COUNTS.rock);
    _spawn(rockIM, COUNTS.rock, stoneMat, [0.7, 1.4], [8, 16], 0.25);
  }
  if(COUNTS.sunken){
    const sunkenIM=new THREE.InstancedMesh(sunkenGeo, stoneMat, COUNTS.sunken);
    _spawn(sunkenIM, COUNTS.sunken, stoneMat, [0.8, 1.3], [8, 14], 0.0);
  }
  if(COUNTS.marker){
    const markerIM=new THREE.InstancedMesh(markerGeo, woodMat, COUNTS.marker);
    _spawn(markerIM, COUNTS.marker, woodMat, [0.9, 1.1], [6, 12], 0);
  }
  if(COUNTS.cactus){
    const cactusIM=new THREE.InstancedMesh(cactusGeo, cactusMat, COUNTS.cactus);
    _spawn(cactusIM, COUNTS.cactus, cactusMat, [0.85, 1.25], [8, 14], 0);
  }
  if(COUNTS.bones){
    const bonesIM=new THREE.InstancedMesh(bonesGeo, boneMat, COUNTS.bones);
    _spawn(bonesIM, COUNTS.bones, boneMat, [0.9, 1.3], [7, 13], 0);
  }
  if(COUNTS.scarab){
    // Two IMs per scarab type — pole uses woodMat (avoids glyph-tex
    // wrapping the pole), sign uses signMat. The two IMs MUST share the
    // same per-instance transform so the sign-plate sits on top of the
    // pole. Earlier draft used two separate _spawn calls which produced
    // 8 disjoint random pole-positions and 8 disjoint random sign-
    // positions — pole and sign were never paired. Code-quality review
    // flagged this. Fix: compute the matrices ONCE in a paired loop and
    // write the same Matrix4 into both IMs.
    const scarabPoleIM=new THREE.InstancedMesh(scarabPoleGeo, woodMat, COUNTS.scarab);
    const scarabSignIM=new THREE.InstancedMesh(scarabSignGeo, signMat, COUNTS.scarab);
    const _pairDummy=new THREE.Object3D();
    let placed=0;
    for(let i=0;i<COUNTS.scarab;i++){
      let cx=0, cz=0, t=0, valid=false;
      for(let attempt=0;attempt<8;attempt++){
        t=Math.random();
        const side=Math.random()<0.5?-1:1;
        const off=BARRIER_OFF + 7 + Math.random()*3;
        const a=_ssTrackSide(t,side,off);
        cx=a.cx + (Math.random()-0.5)*1.5;
        cz=a.cz + (Math.random()-0.5)*1.5;
        if(typeof trackDist!=='function' || trackDist({x:cx,z:cz}, t) >= TW+_SS_PROP_TRACK_MARGIN){ valid=true; break; }
      }
      if(!valid) continue;
      const sc=0.9+Math.random()*0.2;
      _pairDummy.position.set(cx, 0, cz);
      _pairDummy.rotation.set(0, Math.random()*Math.PI*2, 0);
      _pairDummy.scale.set(sc, sc, sc);
      _pairDummy.updateMatrix();
      scarabPoleIM.setMatrixAt(placed, _pairDummy.matrix);
      scarabSignIM.setMatrixAt(placed, _pairDummy.matrix);
      placed++;
    }
    scarabPoleIM.count=placed;
    scarabSignIM.count=placed;
    scarabPoleIM.instanceMatrix.needsUpdate=true;
    scarabSignIM.instanceMatrix.needsUpdate=true;
    scene.add(scarabPoleIM);
    scene.add(scarabSignIM);
  }
}

// ── Main builders ───────────────────────────────────────────────────────

function buildSandstormEnvironment(){
  // Weather reset — sandstorm has its own dust-storm hazard mechanic and is
  // fundamentally incompatible with weather-rain. The isRain / _rainTarget /
  // _rainIntensity globals persist across world-switches; without an explicit
  // clear here, a previous world's rain leaks into the desert (Bug 4).
  if(typeof isRain!=='undefined'&&isRain){
    isRain=false;
    if(typeof _rainTarget!=='undefined')_rainTarget=0;
    if(typeof _rainIntensity!=='undefined')_rainIntensity=0;
    if(rainCanvas)rainCanvas.style.display='none';
  }
  // ── Ground (sand canvas, anisotropy/repeat matches default-world style)
  const g=new THREE.Mesh(new THREE.PlaneGeometry(2400,2400),
    _ssMat({color:0xd4a55a,map:_sandGroundTex()},{metalness:0.0,roughness:0.92},'desert-matte'));
  g.rotation.x=-Math.PI/2;g.position.y=-.15;g.receiveShadow=true;
  g.userData._isProcGround=true;
  scene.add(g);
  // ── Lighting (warm sunset — v2 retune per visual-fix-v2 pilot)
  // Goal: cinematic golden-hour. Low-angle warm sun for long shadows on
  // cliffs + dramatic rim-light, peach hemisphere for warm shadow-side
  // bounce, deep rust ambient for the unlit sand crevices. Skybox + fog
  // (set in core/scene.js) match this palette so sky/ground/fog seam is
  // invisible. Scene.js creates a fresh sunLight at (180,320,80) per
  // world-build, so our low-angle reposition is sandstorm-local and
  // doesn't leak — next buildScene gets default position back.
  // Apply via the shared helper so night.js's day-restore can call the
  // exact same code path — single source of truth for sandstorm day
  // lighting (was duplicated, code-reuse review v4 dedup).
  _applySandstormDayLighting();
  // Sand-haze fill light (warm, modest range — pulses subtly in update)
  _sandstormSandSwept=new THREE.PointLight(0xffe4a8,1.4,500);
  _sandstormSandSwept.position.set(0,8,0);scene.add(_sandstormSandSwept);
  // ── Wind-blown ambient sand-fleck pool (always-on, lap-1+).
  // The lap-progressive STORM particles live in sandstorm-storm.js (Phase 4).
  {
    const FN=_mobCount(180);
    const geo=new THREE.BufferGeometry();
    const pos=new Float32Array(FN*3),col=new Float32Array(FN*3);
    for(let i=0;i<FN;i++){
      pos[i*3]=(Math.random()-.5)*600;
      pos[i*3+1]=Math.random()*22+1;
      pos[i*3+2]=(Math.random()-.5)*600;
      col[i*3]=.95-Math.random()*.15;
      col[i*3+1]=.78-Math.random()*.20;
      col[i*3+2]=.58-Math.random()*.18;
    }
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
    _sandstormFlecks=new THREE.Points(geo,new THREE.PointsMaterial({
      vertexColors:true,size:.32,transparent:true,opacity:.65,
      sizeAttenuation:true,blending:THREE.AdditiveBlending,depthWrite:false
    }));
    scene.add(_sandstormFlecks);_sandstormFlecksGeo=geo;
  }
  // ── World props (Phase 3 visual upgrade) ────────────────
  // Two depth-tiered horizon layers:
  //   1. Shared silhouette layers from track/environment.js (cylinder rings
  //      via _SILHOUETTE_PALETTES.sandstorm, called by core/scene.js).
  //   2. _ssBuildBackgroundMesas (Phase-3A): discrete organic-cylinder
  //      mesa props at 150/250/400u bands with atmospheric perspective.
  // The two are NOT duplicates — silhouette is wrap-around horizon haze,
  // mesas are individual scatter-props that read as Monument-Valley buttes.
  _ssBuildBackgroundMesas();
  _ssBuildCanyonCliffs();
  _ssBuildSandDunes();
  _ssBuildSphinxMonument();
  _ssBuildTempleRuins();
  _ssBuildObelisks();
  _ssBuildPalmTrees();
  _ssBuildCamels();
  _ssBuildPyramids();
  _ssBuildBedouinTents();
  // Phase-4 §4.2: 6 prop-type roadside detail spawner. Replaces the
  // standalone _ssBuildScarabSigns (folded in as one of the 6 types).
  _ssBuildRoadsideDetail();
  // ── Hazard hook (Phase 4 supplies the implementation)
  if(typeof buildSandstormStorm==='function')buildSandstormStorm();
  // ── Barriers + start line (shared environment helpers).
  buildBarriers();buildStartLine();
  // ── Player + AI headlight refs
  plHeadL=new THREE.SpotLight(0xffffff,0,50,Math.PI*.16,.5);
  plHeadR=new THREE.SpotLight(0xffffff,0,50,Math.PI*.16,.5);
  scene.add(plHeadL);scene.add(plHeadL.target);scene.add(plHeadR);scene.add(plHeadR.target);
  plTail=new THREE.PointLight(0xff2200,0,10);scene.add(plTail);
  // ── Stars (warm sand-tinted) — same instanced pattern as volcano
  {
    const sg=new THREE.SphereGeometry(.18,4,4);
    const ssm=new THREE.MeshBasicMaterial({color:0xffd6a0,transparent:true,opacity:.7});
    const _ssSC = window._isMobile ? 36 : 60;
    stars=new THREE.InstancedMesh(sg,ssm,_ssSC);stars.visible=true;
    const dm=new THREE.Object3D();
    for(let i=0;i<_ssSC;i++){
      const th=Math.random()*Math.PI*2,ph=Math.random()*Math.PI*.3,r=300+Math.random()*80;
      dm.position.set(r*Math.sin(ph)*Math.cos(th),r*Math.cos(ph)*.35+60,r*Math.sin(ph)*Math.sin(th));
      dm.scale.setScalar(.6+Math.random()*1.2);dm.updateMatrix();
      stars.setMatrixAt(i,dm.matrix);
    }
    stars.instanceMatrix.needsUpdate=true;scene.add(stars);
  }
  // GLTF roadside props skipped — sandstorm has no GLTF manifest.
  _ssBuildCloseBand();      // Phase 12A
  _ssBuildBuriedObjects();  // Phase 11D
  _ssBuildSandDrifts();     // Phase 11D
  // Schedule the first dust-devil to a wall-clock time well after race-start
  // so it can't fire on the first race frame. The module-init value of 8 was
  // already in the past at world-build, which made `t>=_ssNextDevil` true on
  // frame 1 → immediate spawn → 4 exhaustSystem.emit() calls/frame for 3-5s,
  // overlapping the GO-spike with the first dust-devil burst.
  _ssNextDevil = ((typeof _nowSec==='number') ? _nowSec : performance.now()*0.001) + 8 + Math.random()*7;
}

// Phase 12A — close-band: cactus + tumbleweeds + half-buried bricks 4-12u.
function _ssBuildCloseBand(){
  if(typeof _populateMidRing!=='function')return;
  // Cactus — thin tall cylinders
  const cactusCount = (typeof _mobCount==='function')?_mobCount(15):15;
  const cactusGeo = new THREE.CylinderGeometry(0.3, 0.3, 3, 6);
  const cactusMat = _ssMat({color:0x3a5a2a, emissive:0x0a1a05, emissiveIntensity:0.2},{metalness:0.0,roughness:0.85},'desert-matte');
  const cactusIm = new THREE.InstancedMesh(cactusGeo, cactusMat, cactusCount*2);
  _populateMidRing(cactusIm, {
    perSide: cactusCount, offsetMin:5, offsetMax:12,
    scaleMin:0.7, scaleMax:1.4, stagger:0.3,
    yFn: sc => 1.5 * sc
  });
  scene.add(cactusIm);
  // Tumbleweeds — round low brown spheres (static, no animation)
  const weedCount = (typeof _mobCount==='function')?_mobCount(25):25;
  const weedGeo = new THREE.SphereGeometry(0.5, 6, 4);
  const weedMat = _ssMat({color:0x886633, emissive:0x331100, emissiveIntensity:0.15},{metalness:0.0,roughness:0.92},'desert-matte');
  const weedIm = new THREE.InstancedMesh(weedGeo, weedMat, weedCount*2);
  _populateMidRing(weedIm, {
    perSide: weedCount, offsetMin:4, offsetMax:11,
    scaleMin:0.7, scaleMax:1.5, tiltAmt:0.3, stagger:0.6,
    yFn: () => 0.45
  });
  scene.add(weedIm);
  // Half-buried bricks — small dark boxes
  const brickCount = (typeof _mobCount==='function')?_mobCount(20):20;
  const brickGeo = new THREE.BoxGeometry(0.6, 0.3, 0.4);
  const brickMat = _ssMat({color:0x887766},{metalness:0.0,roughness:0.92},'desert-matte');
  const brickIm = new THREE.InstancedMesh(brickGeo, brickMat, brickCount*2);
  _populateMidRing(brickIm, {
    perSide: brickCount, offsetMin:4, offsetMax:12,
    scaleMin:0.8, scaleMax:1.4, tiltAmt:0.5, stagger:0.85,
    yFn: () => 0.1
  });
  scene.add(brickIm);
}

// Phase 11D — half-begraven beton/muur fragmenten langs de baan. Reuse
// _ssMakeStoneMat zodat textures stylistisch passen bij de bestaande
// canyon-rotsen. Tilted + below-ground voor "buried ruin"-feel.
function _ssBuildBuriedObjects(){
  if(typeof trackCurve==='undefined'||!trackCurve)return;
  const COUNT = (typeof _mobCount==='function')?_mobCount(30):30;
  const beamGeo = new THREE.BoxGeometry(0.8, 1.4, 5.5);
  const beamMat = _ssMakeStoneMat(null, 0.9);
  beamMat.color.setHex(0x887766);
  const beamIM = new THREE.InstancedMesh(beamGeo, beamMat, COUNT);
  beamIM.userData = {_noLodCull:true};
  const wallGeo = new THREE.BoxGeometry(2.5, 2.0, 0.5);
  const wallMat = _ssMakeStoneMat(null, 0.95);
  wallMat.color.setHex(0x998877);
  const wallIM = new THREE.InstancedMesh(wallGeo, wallMat, COUNT);
  wallIM.userData = {_noLodCull:true};
  const m4 = new THREE.Matrix4();
  const pts = trackCurve.getPoints(COUNT*3);
  const step = Math.floor(pts.length / COUNT);
  for(let i=0;i<COUNT;i++){
    const ii = (i*step) % pts.length;
    const pt = pts[ii];
    const tg = trackCurve.getTangentAt(ii/pts.length).normalize();
    const right = new THREE.Vector3(-tg.z,0,tg.x);
    const side = i%2===0 ? 1 : -1;
    const dist = BARRIER_OFF + 14 + Math.random()*22;
    const px = pt.x + right.x*dist*side + (Math.random()-0.5)*3;
    const pz = pt.z + right.z*dist*side + (Math.random()-0.5)*3;
    const tiltX = (Math.random()-0.5)*0.35;
    const rotY  = Math.random() * Math.PI*2;
    m4.compose(
      new THREE.Vector3(px, -0.3, pz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, rotY, (Math.random()-0.5)*0.2)),
      new THREE.Vector3(1,1,1)
    );
    beamIM.setMatrixAt(i, m4);
    m4.compose(
      new THREE.Vector3(px + (Math.random()-0.5)*4, -0.4, pz + (Math.random()-0.5)*4),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, rotY+0.5, 0)),
      new THREE.Vector3(1,1,1)
    );
    wallIM.setMatrixAt(i, m4);
  }
  beamIM.instanceMatrix.needsUpdate = true;
  wallIM.instanceMatrix.needsUpdate = true;
  scene.add(beamIM);
  scene.add(wallIM);
}

// Phase 11D — blown-sand drift strips. PlaneGeometry flat on ground,
// uitgelijnd langs lokale wind-direction (tangent). Sandkleur met
// transparency zodat ze als geblazen lagen op het zand lezen.
function _ssBuildSandDrifts(){
  if(typeof trackCurve==='undefined'||!trackCurve)return;
  const COUNT = (typeof _mobCount==='function')?_mobCount(55):55;
  const geo = new THREE.PlaneGeometry(1.2, 4.5);
  const mat = _ssMat({
    color:0xddb97a, transparent:true, opacity:0.65,
    depthWrite:false, side:THREE.DoubleSide
  },{metalness:0.0,roughness:0.92},'desert-matte');
  const im = new THREE.InstancedMesh(geo, mat, COUNT);
  im.userData = {_noLodCull:true};
  const m4 = new THREE.Matrix4();
  const pts = trackCurve.getPoints(COUNT*2);
  const step = Math.floor(pts.length / COUNT);
  for(let i=0;i<COUNT;i++){
    const ii = (i*step) % pts.length;
    const pt = pts[ii];
    const tg = trackCurve.getTangentAt(ii/pts.length).normalize();
    const right = new THREE.Vector3(-tg.z,0,tg.x);
    const side = i%2===0 ? 1 : -1;
    const dist = BARRIER_OFF + 5 + Math.random()*28;
    const px = pt.x + right.x*dist*side;
    const pz = pt.z + right.z*dist*side;
    const windAlign = Math.atan2(tg.x, tg.z) + (Math.random()-0.5)*0.6;
    m4.compose(
      new THREE.Vector3(px, 0.02, pz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2, 0, windAlign)),
      new THREE.Vector3(1+Math.random()*0.8, 1+Math.random()*1.2, 1)
    );
    im.setMatrixAt(i, m4);
  }
  im.instanceMatrix.needsUpdate = true;
  scene.add(im);
}

function updateSandstormWorld(dt){
  const t=_nowSec;
  // Phase 13C — flapping tent banners + tent-flaps voor wind-feel.
  // LUT-sin + epsilon-gated rotation writes. 9 writes/frame zonder sentinel
  // vorderen op trage sinussen — ~half landt buiten 0.003 rad threshold.
  const _ssSin = window._sharedSin || Math.sin;
  if(_ssTentFlaps.length){
    for(let i=0;i<_ssTentFlaps.length;i++){
      const f = _ssTentFlaps[i];
      if(!f.userData)continue;
      const wave = _ssSin(t*1.8 + f.userData._phase)*0.18;
      const _ry = f.userData._baseRotY + wave;
      if(f.userData._lastRy===undefined||Math.abs(_ry-f.userData._lastRy)>0.003){
        f.userData._lastRy=_ry; f.rotation.y=_ry;
      }
    }
  }
  if(_ssTentBanners.length){
    for(let i=0;i<_ssTentBanners.length;i++){
      const b = _ssTentBanners[i];
      if(!b.userData)continue;
      const _by = _ssSin(t*2.5 + b.userData._phase)*0.6;
      const _bz = _ssSin(t*3.2 + b.userData._phase*1.3)*0.18;
      if(b.userData._lastBy===undefined||Math.abs(_by-b.userData._lastBy)>0.003){
        b.userData._lastBy=_by; b.rotation.y=_by;
      }
      if(b.userData._lastBz===undefined||Math.abs(_bz-b.userData._lastBz)>0.003){
        b.userData._lastBz=_bz; b.rotation.z=_bz;
      }
    }
  }
  // Subtle skybox drift — sandstorm wind. Pattern matches volcano/arctic.
  if(scene&&scene.background&&scene.background.isTexture){
    scene.background.offset.x=(scene.background.offset.x+dt*.004)%1;
  }
  // Hazard update (typeof guard — Phase 2 stub or Phase 4 real impl)
  if(typeof updateSandstormStorm==='function'){
    const pl=carObjs[playerIdx];
    updateSandstormStorm(dt,pl?pl.lap:1);
  }
  // Wind-drift the ambient flecks — rolling buffer (25/frame, was 50). 180-
  // particle pool refreshes every ~0.12s at 60fps which is visually identical
  // to the prior 50/frame but halves the per-frame loop + GPU upload cost.
  if(_sandstormFlecksGeo){
    const pos=_sandstormFlecksGeo.attributes.position.array;
    const step=Math.floor(t*40)%25||1;
    for(let i=step;i<Math.min(step+25,pos.length/3);i++){
      pos[i*3]+=dt*1.6;
      pos[i*3+1]+=dt*(.4+Math.random()*.4);
      if(pos[i*3]>320||pos[i*3+1]>26){
        pos[i*3]=-300+Math.random()*40;
        pos[i*3+1]=Math.random()*4;
        pos[i*3+2]=(Math.random()-.5)*600;
      }
    }
    _sandstormFlecksGeo.attributes.position.needsUpdate=true;
  }
  // Pulse the sand-haze fill light gently
  if(_sandstormSandSwept)_sandstormSandSwept.intensity=1.2+Math.sin(t*.45)*.30;
  // ── Phase 10.12 — dust devils (tornado-style) ───────────────────────
  // Random elke 8-15s spawnt een devil op een willekeurige plek. Tijdens
  // life (3-5s) draait een ring van 4 dust-particles rond een center,
  // gestapeld over de hoogte. Visueel een wervelende kolom van zandzwiep.
  if(typeof exhaustSystem!=='undefined'&&exhaustSystem&&exhaustSystem.emit){
    if(_ssActiveDevil){
      const age=t-_ssActiveDevil.born;
      if(age>=_ssActiveDevil.life){
        _ssActiveDevil=null;
      } else {
        const cx=_ssActiveDevil.cx,cz=_ssActiveDevil.cz;
        // Mobile: 2 particles per ring ipv 4 (halveert exhaust-emit per frame).
        const _devilR = window._isMobile ? 2 : 4;
        for(let r=0;r<_devilR;r++){
          const ang=(t*4+r*Math.PI*(_devilR===2?1.0:0.5))%(Math.PI*2);
          const radius=1.5+Math.random()*0.5;
          exhaustSystem.emit(
            cx+Math.cos(ang)*radius,
            0.5+Math.random()*6,
            cz+Math.sin(ang)*radius,
            Math.cos(ang+1)*0.04,0.02,Math.sin(ang+1)*0.04,
            2.2,.91,.65,.40,.50
          );
        }
      }
    } else if(t>=_ssNextDevil){
      _ssNextDevil=t+8+Math.random()*7;
      const car=carObjs[playerIdx];
      const cx=(car?car.mesh.position.x:0)+(Math.random()-0.5)*120;
      const cz=(car?car.mesh.position.z:0)+(Math.random()-0.5)*120;
      _ssActiveDevil={cx:cx,cz:cz,born:t,life:3+Math.random()*2};
    }
  }
}
