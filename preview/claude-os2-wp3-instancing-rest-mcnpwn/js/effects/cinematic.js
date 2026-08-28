// js/effects/cinematic.js — non-module script.
//
// Reusable visual helpers for the "Cinematic" worlds collection.
//
// The cinematic visual language is built around five pillars:
//   1. Dark global lighting (ambient is low — wereld leeft van gerichte
//      lichtbronnen: "pools of light, not floods")
//   2. Practical lights are heroes (natriumlamp, koplamp, knipperende
//      waarschuwingslichten, verlichte ramen)
//   3. Atmospheric depth (ground fog, light cones through mist, lens bloom)
//   4. Silhouette storytelling (verre objecten als zwarte silhouetten)
//   5. Cool palettes with warm accents (paars/blauw als basis,
//      oranje/amber als praktische lichtaccenten)
//
// First consumer: js/worlds/pier47.js. Future cinematic-suffixed worlds
// (volcano-cinematic, sandstorm-cinematic, arctic-cinematic, ...) will
// compose the same helpers with different palette/intensity options.
//
// All helpers are CONFIG-DRIVEN with sensible defaults — a future
// volcano-cinematic should be able to call buildCinematicLightPole({
// position, color: 0xff4422, intensity: 1.8 }) and get the same
// architectural pattern with red instead of amber.
//
// Public API (all functions exposed via window for non-module callers):
//   - buildCinematicGroundFog(scene, options)
//   - buildCinematicLightPole(scene, position, options)
//   - buildCinematicVolumetricLightCone(parentLight, options)
//   - buildCinematicBlinkingMarker(scene, position, options)
//   - buildCinematicHeadlampPool(car, options)            [stub — later commit]
//   - applyCinematicCameraShake(camera, speed, options)
//   - applyCinematicMotionBlur(postfx, intensity)
//
// Performance contract:
//   • Each helper has a `mobile` config-flag with sensible auto-degradation
//   • Default helpers should add ≤2 draw-calls per call on desktop
//   • No per-frame allocations in the update path (callers maintain refs)

'use strict';

// Sin LUT — gedeeld via window._sharedSin / window._sharedCos (zie
// js/core/math-luts.js). Lokale aliases voor compacte gebruikspaden in
// updateCinematic; fallback naar Math.sin als math-luts.js niet geladen is.
const _cinSin = (typeof window !== 'undefined' && window._sharedSin) ? window._sharedSin : Math.sin;
const _cinCos = (typeof window !== 'undefined' && window._sharedCos) ? window._sharedCos : Math.cos;

// ── Module-private state ──────────────────────────────────────────────────
//
// Active world's installed cinematic refs — populated by builders, drained
// by disposeScene() before the next world build via the per-world reset
// block in core/scene.js. Helpers attach themselves to these arrays so a
// single dispose call cleans the lot.
const _cinemaState = {
  groundFog: [],         // [{mesh, scrollDir:[x,z], scrollSpeed}]
  lightPoles: [],        // [{group, working, flickerPhase}]
  blinkingMarkers: [],   // [{light, halo, blinkInterval, t, pattern}]
  cameraShake: null      // {intensityScale, speedThreshold, maxOffset}
};
if (typeof window !== 'undefined') window._cinemaState = _cinemaState;

// Reset hook — called from scene.js per-world reset block on world-switch.
// Keeps the state lean across world transitions.
function resetCinematicState(){
  _cinemaState.groundFog.length = 0;
  _cinemaState.lightPoles.length = 0;
  _cinemaState.blinkingMarkers.length = 0;
  _cinemaState.cameraShake = null;
}

// ── Procedural fog-wisp texture ──────────────────────────────────────────
//
// Soft horizontal wisps for the ground-fog layer. Cached per-color so
// repeated builds (e.g. multiple worlds with the same fog tint) don't
// re-allocate canvases.
const _fogTexCache = new Map();
function _cinematicFogWispTex(hexColor){
  const key = String(hexColor);
  if (_fogTexCache.has(key)) return _fogTexCache.get(key);
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // Transparent base — fog is additive over scene, no opaque pixels
  g.clearRect(0, 0, W, H);
  // Parse hex color to rgb for inline rgba()
  const col = new THREE.Color(hexColor);
  const r = Math.round(col.r * 255), gC = Math.round(col.g * 255), b = Math.round(col.b * 255);
  // Soft horizontal wisp blobs — low alpha, large radii, tileable on X
  for (let i = 0; i < 22; i++){
    const x = Math.random() * W;
    const y = H * 0.2 + Math.random() * H * 0.6;
    const rad = 25 + Math.random() * 60;
    const alpha = 0.18 + Math.random() * 0.18;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(${r},${gC},${b},${alpha.toFixed(2)})`);
    grd.addColorStop(1, `rgba(${r},${gC},${b},0)`);
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    // Wrap blobs on X edge so the texture tiles seamlessly when scrolled
    if (x < rad){
      g.fillStyle = grd;
      g.fillRect(x + W - rad, y - rad, rad * 2, rad * 2);
    } else if (x > W - rad){
      g.fillStyle = grd;
      g.fillRect(x - W - rad, y - rad, rad * 2, rad * 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  _fogTexCache.set(key, tex);
  return tex;
}

// Dispose the fog-tex cache — wired from scene.js disposal so a clean
// world-switch frees the GPU memory before the next buildScene allocates
// fresh textures.
function disposeCinematicCaches(){
  _fogTexCache.forEach(t => { try { t.dispose(); } catch(_){} });
  _fogTexCache.clear();
  if (typeof _poolTexCache !== 'undefined'){
    _poolTexCache.forEach(t => { try { t.dispose(); } catch(_){} });
    _poolTexCache.clear();
  }
  if (typeof _haloTexCache !== 'undefined'){
    _haloTexCache.forEach(t => { try { t.dispose(); } catch(_){} });
    _haloTexCache.clear();
  }
  if (typeof _coneTexCache !== 'undefined'){
    _coneTexCache.forEach(t => { try { t.dispose(); } catch(_){} });
    _coneTexCache.clear();
  }
}
if (typeof window !== 'undefined') window.disposeCinematicCaches = disposeCinematicCaches;

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  buildCinematicGroundFog                                                 ║
// ╚═════════════════════════════════════════════════════════════════════════╝
//
// Low-altitude fog layer that gives the world its volumetric depth — head-
// lights and lamp cones cut through it, distant geometry fades. Implemented
// as one or more wide horizontal planes with a fog-wisp canvas texture, so
// the cost is essentially "additional alpha-blended geometry" — cheap on
// desktop, mobile-degradable to a single plane.
//
// The fog scrolls slowly via texture.offset to suggest light wind without
// any particle simulation.
//
// @param {THREE.Scene} scene  Active scene
// @param {Object}      [opts]
// @param {number} [opts.color=0x2a1a30]      Tint (hex). Default donkerpaars
//                                            warm-accented for cinematic
// @param {number} [opts.density=0.55]        Material opacity 0..1
// @param {number} [opts.height=5]            Y-position of single layer (or
//                                            base of stacked layers)
// @param {number} [opts.layerCount=3]        Number of stacked layers (auto-
//                                            clamped to 1 on mobile)
// @param {number} [opts.layerSpacing=2.2]    Vertical spacing between layers
// @param {number} [opts.size=900]            Plane width × depth (square)
// @param {Array}  [opts.scrollDir=[1,0.3]]   Scroll vector (x, z) per layer
// @param {number} [opts.scrollSpeed=0.012]   Texture units per second
// @param {boolean}[opts.fadeWithDistance=true] When true, material picks up
//                                            scene.fog so distant fog fades
// @returns {Array<THREE.Mesh>}  Layer meshes (callers can override later)
function buildCinematicGroundFog(scene, opts){
  const o = opts || {};
  const color = (o.color != null) ? o.color : 0x2a1a30;
  const density = (o.density != null) ? o.density : 0.55;
  const baseY = (o.height != null) ? o.height : 5;
  const requested = (o.layerCount != null) ? o.layerCount : 3;
  const layers = window._isMobile ? 1 : Math.max(1, requested|0);
  const spacing = (o.layerSpacing != null) ? o.layerSpacing : 2.2;
  const size = (o.size != null) ? o.size : 900;
  const scrollDir = o.scrollDir || [1, 0.3];
  const scrollSpeed = (o.scrollSpeed != null) ? o.scrollSpeed : 0.012;
  const fadeWithDistance = (o.fadeWithDistance !== false);
  const meshes = [];
  // Single plane geometry shared across all layers — cloned material per
  // layer so opacity / texture offset can vary per slice.
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  for (let i = 0; i < layers; i++){
    const tex = _cinematicFogWispTex(color);
    // Per-layer texture clone via CanvasTexture share — actual GPU upload
    // is shared (same image source), only the .repeat/.offset diverge.
    const lTex = tex.clone();
    lTex.wrapS = THREE.RepeatWrapping;
    lTex.wrapT = THREE.RepeatWrapping;
    lTex.needsUpdate = true;
    // Larger repeat for the higher layers so distant wisps look smaller
    const repScale = 4 + i * 1.5;
    lTex.repeat.set(repScale, repScale * 0.5);
    const mat = new THREE.MeshBasicMaterial({
      map: lTex,
      color: 0xffffff,
      transparent: true,
      opacity: density * (1 - i * 0.18),  // upper layers fade
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: fadeWithDistance
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = baseY + i * spacing;
    m.renderOrder = -5;  // render before transparent props
    scene.add(m);
    meshes.push(m);
    // Per-layer scroll vector — alternate sign on z-component for cross-flow
    const dx = scrollDir[0] * (i % 2 === 0 ? 1 : -0.6);
    const dz = scrollDir[1] * (i % 2 === 0 ? 1 : 0.7);
    _cinemaState.groundFog.push({
      mesh: m,
      tex: lTex,
      scrollDir: [dx, dz],
      scrollSpeed: scrollSpeed * (1 + i * 0.4)
    });
  }
  return meshes;
}

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  buildCinematicLightPole                                                 ║
// ╚═════════════════════════════════════════════════════════════════════════╝
//
// Sodium-style street-lamp pole composed of: mast + lamp armature + point
// light + volumetric cone + ground pool + halo billboard. Fully config-
// driven so future cinematic worlds can reuse the same architecture with
// red (volcano), aqua (deepsea), or violet (neon) palettes.
//
// Set `working: false` to build a "broken/off" lamp — the pole stays as a
// silhouette but no light is emitted (good for character / variety).
//
// @param {THREE.Scene}   scene
// @param {THREE.Vector3} position   Base position (mast base sits here)
// @param {Object}        [opts]
// @param {number}  [opts.color=0xff8830]    Lamp color (hex)
// @param {number}  [opts.intensity=1.5]     PointLight intensity
// @param {number}  [opts.range=24]          PointLight distance
// @param {number}  [opts.height=8]          Mast height
// @param {number}  [opts.armLength=1.4]     Horizontal arm reach
// @param {number}  [opts.poolRadius=12]     Ground-pool radius
// @param {boolean} [opts.working=true]      false = broken lamp
// @param {number}  [opts.tilt=0]            Pole tilt (radians, for old/leaning)
// @param {number}  [opts.facingY=0]         Y-rotation of arm/lamp
// @param {boolean} [opts.castGroundPool=true] Add fade decal under lamp
// @param {boolean} [opts.castVolumetricCone=true] Add cone-mesh under lamp
// @param {boolean} [opts.castHalo=true]     Add halo billboard around lamp
// @returns {THREE.Group}  Group containing all pole sub-meshes
//
function buildCinematicLightPole(scene, position, opts){
  const o = opts || {};
  const color    = (o.color != null) ? o.color : 0xff8830;
  const intensity= (o.intensity != null) ? o.intensity : 1.5;
  const range    = (o.range != null) ? o.range : 24;
  const height   = (o.height != null) ? o.height : 8;
  const armLen   = (o.armLength != null) ? o.armLength : 1.4;
  const poolR    = (o.poolRadius != null) ? o.poolRadius : 12;
  const working  = (o.working !== false);
  const tilt     = (o.tilt || 0);
  const facingY  = (o.facingY || 0);
  const wantPool = (o.castGroundPool !== false);
  const wantCone = (o.castVolumetricCone !== false);
  const wantHalo = (o.castHalo !== false);
  // Group anchors at the mast base — caller positioned `position` is base
  const grp = new THREE.Group();
  grp.position.copy(position);
  // Tilt — rotate the entire group around X (or Z) for a leaning-pole feel
  if (tilt !== 0) grp.rotation.z = tilt;
  if (facingY !== 0) grp.rotation.y = facingY;
  // Mast — cylinder, slim, dark steel
  const mastMat = new THREE.MeshLambertMaterial({ color: 0x222018 });
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.10, 0.16, height, 6),
    mastMat
  );
  mast.position.y = height * 0.5;
  grp.add(mast);
  // Arm reaching toward the track (along local +X by convention; caller
  // can pre-rotate the position via facingY)
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(armLen, 0.10, 0.10),
    mastMat
  );
  arm.position.set(armLen * 0.5, height - 0.1, 0);
  grp.add(arm);
  // Lamp armature — small box at the end of the arm, slight downward tilt
  const lampHeadMat = new THREE.MeshLambertMaterial({
    color: working ? color : 0x1a1816,
    emissive: working ? color : 0x000000,
    emissiveIntensity: working ? 1.4 : 0.0
  });
  const lampHead = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.32, 0.95),
    lampHeadMat
  );
  lampHead.position.set(armLen, height - 0.3, 0);
  grp.add(lampHead);
  // Track-pole metadata for flicker animation in updateCinematic. The
  // shared mat ref is what drives flicker; we register one entry per lamp
  // but with a shared phase based on grp uuid for variety.
  const flickerPhase = Math.random() * Math.PI * 2;
  if (working){
    // PointLight — modest range, color-matched
    const pl = new THREE.PointLight(color, intensity, range, 2);
    pl.position.copy(lampHead.position);
    grp.add(pl);
    // Volumetric cone (commit 2 helper)
    if (wantCone){
      buildCinematicVolumetricLightCone(grp, {
        color: color,
        coneRadius: poolR * 0.35,
        coneHeight: height,
        opacity: 0.18,
        anchorX: armLen,
        anchorY: height - 0.3
      });
    }
    // Ground pool — radial-fade disc directly under the lamp
    if (wantPool){
      const poolTex = _cinematicGroundPoolTex(color);
      const poolMat = new THREE.MeshBasicMaterial({
        map: poolTex,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: true
      });
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(poolR, 24),
        poolMat
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(armLen, -position.y + 0.02, 0);  // sit on ground (y=0 world)
      pool.renderOrder = -3;
      grp.add(pool);
    }
    // Halo billboard — sprite at the lamp head
    if (wantHalo){
      const haloTex = _cinematicHaloTex(color);
      const haloMat = new THREE.SpriteMaterial({
        map: haloTex,
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: true
      });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(2.4, 2.4, 1);
      halo.position.copy(lampHead.position);
      grp.add(halo);
    }
  }
  scene.add(grp);
  // Freeze de lamp-pole transform-chain — niets in deze hierarchie beweegt
  // na build. Flicker zit op headMat.emissiveIntensity (material-property,
  // geen transform). Per-pole: grp + mast + arm + lampHead + optional
  // pool/cone/halo (3-7 meshes). Op Pier47 night ~50 poles = ~150-350
  // updateMatrix() calls per frame uitgespaard.
  if(window._freezeMatrix){
    window._freezeMatrix(grp);
    for(let _ci=0; _ci<grp.children.length; _ci++) window._freezeMatrix(grp.children[_ci]);
  }
  // Register so updateCinematic can drive subtle flicker on working lamps
  _cinemaState.lightPoles.push({
    group: grp,
    headMat: lampHeadMat,
    working: working,
    flickerPhase: flickerPhase,
    baseEmissive: working ? 1.4 : 0.0,
    _lastEm: -1   // sentinel voor epsilon-gated emissiveIntensity writes
  });
  return grp;
}

// ── Procedural ground-pool radial-fade texture ───────────────────────────
const _poolTexCache = new Map();
function _cinematicGroundPoolTex(hexColor){
  const key = String(hexColor);
  if (_poolTexCache.has(key)) return _poolTexCache.get(key);
  const S = 128, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const col = new THREE.Color(hexColor);
  const r = Math.round(col.r * 255), gC = Math.round(col.g * 255), b = Math.round(col.b * 255);
  // Soft radial gradient — peak ~0.5 alpha at center, transparent at edge
  const grd = g.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  grd.addColorStop(0,    `rgba(${r},${gC},${b},0.85)`);
  grd.addColorStop(0.35, `rgba(${r},${gC},${b},0.45)`);
  grd.addColorStop(0.7,  `rgba(${r},${gC},${b},0.12)`);
  grd.addColorStop(1.0,  `rgba(${r},${gC},${b},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  _poolTexCache.set(key, tex);
  return tex;
}

// Halo billboard tex — radial gradient with a hot center
const _haloTexCache = new Map();
function _cinematicHaloTex(hexColor){
  const key = String(hexColor);
  if (_haloTexCache.has(key)) return _haloTexCache.get(key);
  const S = 128, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const col = new THREE.Color(hexColor);
  const r = Math.round(col.r * 255), gC = Math.round(col.g * 255), b = Math.round(col.b * 255);
  const grd = g.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  grd.addColorStop(0,    `rgba(${Math.min(255,r+40)},${Math.min(255,gC+30)},${Math.min(255,b+20)},1.0)`);
  grd.addColorStop(0.18, `rgba(${r},${gC},${b},0.82)`);
  grd.addColorStop(0.55, `rgba(${r},${gC},${b},0.30)`);
  grd.addColorStop(1.0,  `rgba(${r},${gC},${b},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  _haloTexCache.set(key, tex);
  return tex;
}

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  buildCinematicVolumetricLightCone                                       ║
// ╚═════════════════════════════════════════════════════════════════════════╝
//
// Volumetric cone visible BELOW a point/spot light when ground-fog is
// present. Implemented as a downward-pointing cone-mesh with an additive
// gradient material — at any camera angle the cone reads as light cutting
// through mist. Cheap (one mesh, one mat) — desktop and mobile both run it.
//
// @param {THREE.Object3D} parent     Anchor (typically a group containing the lamp)
// @param {Object}         [opts]
// @param {number}  [opts.color=0xff8830]   Cone tint
// @param {number}  [opts.coneRadius=4]     Bottom radius (where the cone
//                                          meets the ground)
// @param {number}  [opts.coneHeight=8]     Height of cone (lamp-to-floor)
// @param {number}  [opts.opacity=0.22]     Material opacity at full strength
// @param {boolean} [opts.additive=true]    Use AdditiveBlending (cinematic)
// @returns {THREE.Mesh}  The cone mesh (caller can position-tweak)
//
function buildCinematicVolumetricLightCone(parent, opts){
  const o = opts || {};
  const color    = (o.color != null) ? o.color : 0xff8830;
  const coneR    = (o.coneRadius != null) ? o.coneRadius : 4;
  const coneH    = (o.coneHeight != null) ? o.coneHeight : 8;
  const opacity  = (o.opacity != null) ? o.opacity : 0.22;
  const additive = (o.additive !== false);
  const anchorX  = o.anchorX || 0;
  const anchorY  = o.anchorY || 0;
  // Tapered cylinder — narrow at top (lamp), wide at bottom (ground).
  // Open-ended so we don't render a closing disc; UV mapping wraps around.
  const geo = new THREE.CylinderGeometry(0.4, coneR, coneH, 12, 1, true);
  // Vertical gradient texture: hot at top, transparent at bottom. UVs of
  // CylinderGeometry default to v=0 at bottom, v=1 at top — so paint
  // accordingly.
  const tex = _cinematicConeGradientTex(color);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: 0xffffff,
    transparent: true,
    opacity: opacity,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    fog: true
  });
  const cone = new THREE.Mesh(geo, mat);
  cone.position.set(anchorX, anchorY - coneH * 0.5, 0);
  cone.renderOrder = -2;
  parent.add(cone);
  return cone;
}

// Cone gradient — vertical fade from hot (lamp end) to clear (ground end).
const _coneTexCache = new Map();
function _cinematicConeGradientTex(hexColor){
  const key = String(hexColor);
  if (_coneTexCache.has(key)) return _coneTexCache.get(key);
  const W = 8, H = 64, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const col = new THREE.Color(hexColor);
  const r = Math.round(col.r * 255), gC = Math.round(col.g * 255), b = Math.round(col.b * 255);
  // v=0 (canvas y=H, bottom of cone, ground end) → transparent
  // v=1 (canvas y=0, top of cone, lamp end)      → hot
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0,    `rgba(${r},${gC},${b},1.0)`);
  grd.addColorStop(0.35, `rgba(${r},${gC},${b},0.55)`);
  grd.addColorStop(0.75, `rgba(${r},${gC},${b},0.18)`);
  grd.addColorStop(1.0,  `rgba(${r},${gC},${b},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  _coneTexCache.set(key, tex);
  return tex;
}

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  buildCinematicBlinkingMarker                                            ║
// ╚═════════════════════════════════════════════════════════════════════════╝
//
// Tiny distant warning-light: PointLight + halo billboard + blink logic.
// Used for crane-tops, antenna-warning, distant aircraft. Registers itself
// with _cinemaState.blinkingMarkers so updateCinematic() can drive the
// blink without per-marker callbacks.
//
// @param {THREE.Scene}   scene
// @param {THREE.Vector3} position
// @param {Object}        [opts]
// @param {number}   [opts.color=0xff3030]    Hex color
// @param {string}   [opts.pattern='slow-pulse']  'solid' | 'slow-pulse'
//                                              | 'fast-pulse' | 'morse'
// @param {number}   [opts.blinkInterval=2.0] Cycle length seconds
// @param {number}   [opts.intensity=2.0]     PointLight intensity (peak)
// @param {number}   [opts.range=80]          PointLight range
// @param {number}   [opts.haloSize=2.4]      Billboard scale
// @param {boolean}  [opts.includeLight=true] false = halo-only marker
//                                            (keeps shader light count down)
// @returns {Object}  { light, halo } refs (caller may dispose)
//
function buildCinematicBlinkingMarker(scene, position, opts){
  const o = opts || {};
  const color    = (o.color != null) ? o.color : 0xff3030;
  const pattern  = o.pattern || 'slow-pulse';
  const interval = (o.blinkInterval != null) ? o.blinkInterval : 2.0;
  const peakI    = (o.intensity != null) ? o.intensity : 2.0;
  const range    = (o.range != null) ? o.range : 80;
  const haloSize = (o.haloSize != null) ? o.haloSize : 2.4;
  const wantLight= (o.includeLight !== false);
  // Halo billboard — visible from any angle, additive blending
  const haloTex = _cinematicHaloTex(color);
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex,
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(haloSize, haloSize, 1);
  halo.position.copy(position);
  scene.add(halo);
  // Optional PointLight — many distant markers should NOT each carry a
  // PointLight (Three.js forward-renderer light budget). Default opt-in
  // for foreground markers, opt-out for distant background markers.
  let light = null;
  if (wantLight){
    light = new THREE.PointLight(color, peakI, range, 2);
    light.position.copy(position);
    scene.add(light);
  }
  // Pattern → numeric id (0=solid,1=fast-pulse,2=morse,3=slow-pulse) zodat
  // updateCinematic() switch op _patternId kan ipv string-compare per frame.
  const _pid = (pattern==='solid')?0:(pattern==='fast-pulse')?1:(pattern==='morse')?2:3;
  const ref = {
    halo: halo,
    haloMat: haloMat,
    light: light,
    pattern: pattern,
    _patternId: _pid,
    interval: interval,
    peakI: peakI,
    baseHaloOpacity: 0.95,
    _lastMul: -1,
    t: Math.random() * interval   // randomise so multiple markers don't sync
  };
  _cinemaState.blinkingMarkers.push(ref);
  return ref;
}

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  buildCinematicHeadlampPool                                              ║
// ╚═════════════════════════════════════════════════════════════════════════╝
//
// Versterkt-koplamp-blob op nat asfalt: een subtle gradient sprite/disc
// die de standaard car spotlight aanvult voor een meer cinematic
// ground-pool look op cinematic werelden. Per-car aangeroepen bij build.
//
// @param {THREE.Object3D} car
// @param {Object} [opts]
// @param {number} [opts.color=0xfff0d0]   Pool tint
// @param {number} [opts.size=8]           Pool diameter at full visibility
// @param {number} [opts.opacity=0.45]
// @param {number} [opts.forwardOffset=4]  Distance ahead of car
// @returns {THREE.Mesh}
//
// SKIPPED IN THIS SESSIE — out of scope (cars/build.js is owned by car
// pipeline, not the cinematic foundation). Documented here so a future
// sessie can pick it up. The decision is reversible.
function buildCinematicHeadlampPool(car, opts){
  return null;  // skipped — see comment above
}

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  applyCinematicCameraShake                                               ║
// ╚═════════════════════════════════════════════════════════════════════════╝
//
// Subtle speed-scaled random offset applied AFTER the existing collision-
// shake (camShake global). Activated by registering a config object via
// `enableCinematicCameraShake({...})` at world build, then driven by the
// camera-update via the global `applyCinematicCameraShake()` call.
//
// Speed-scaled: idle = no shake, cruising = barely-there, top speed =
// max ~0.05 units offset. Tunable per world.
//
// @param {THREE.Camera} camera
// @param {number}       speed01     Normalised speed (0..1)
// @param {Object}       [config]    cinemaState.cameraShake config
// @returns {void}                   Mutates camera.position in place
//
function applyCinematicCameraShake(camera, speed01, config){
  if (!camera) return;
  const cfg = config || _cinemaState.cameraShake;
  if (!cfg) return;
  // Hotfix Phase 9.5 — user feedback "cars trillen enorm" / "camera
  // kantelt". Cinematic shake was speed-threshold 60%, maxOffset 0.05
  // = visible per-frame jitter op cinematic worlds. Nu: forced
  // threshold ≥0.9 (alleen top-speed), amp halved, 60% frame-skip
  // zodat jitter-frequency niet als vibration voelt.
  const threshold = Math.max(0.9, cfg.speedThreshold);
  if (speed01 <= threshold) return;
  // Skip 60% van frames → shake is occasional ipv per-frame buzz
  if (Math.random() < 0.6) return;
  const maxOffset = cfg.maxOffset;
  const scale = (cfg.intensityScale || 1) * 0.5;  // halved
  const t01 = Math.min(1, (speed01 - threshold) / (1 - threshold));
  const amp = maxOffset * scale * t01;
  camera.position.x += (Math.random() - 0.5) * amp * 2;
  camera.position.y += (Math.random() - 0.5) * amp * 0.6;
  camera.position.z += (Math.random() - 0.5) * amp * 2;
}

// Activates camera shake for the active world. Cleared on world-switch
// via resetCinematicState(). Pier 47 calls this from its environment
// builder; future cinematic worlds will do the same with their own values.
function enableCinematicCameraShake(opts){
  const o = opts || {};
  _cinemaState.cameraShake = {
    intensityScale: (o.intensityScale != null) ? o.intensityScale : 1.0,
    speedThreshold: (o.speedThreshold != null) ? o.speedThreshold : 0.20,
    maxOffset:      (o.maxOffset      != null) ? o.maxOffset      : 0.05
  };
}
if (typeof window !== 'undefined') window.enableCinematicCameraShake = enableCinematicCameraShake;

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  applyCinematicMotionBlur                                                ║
// ╚═════════════════════════════════════════════════════════════════════════╝
//
// Boost the existing postfx bloom radial-component for cinematic worlds —
// or, if the postfx pipeline gets a real radial-blur pass added later,
// route that activation through this helper.
//
// For sessie-1 of the cinematic foundation, this hooks the bloom-strength
// multiplier so that lamp + headlight emissives pop more dramatically
// against the dark scene without restructuring the postfx pipeline.
//
// @param {Object} postfx  The _postfx state object (from postfx.js)
// @param {number} intensity  0..1 — 0 disables, 1 = full cinematic boost
//
// Sessie 03 — radial motion blur is now a real pass on the composite
// shader (atmosphere-pass.js motionBlurStr uniform, driven by player
// speed-ratio via _setMotionBlurFromSpeed). This helper is kept as a
// thin redirect so existing callers keep working but it no longer
// muddies its docs about being a stub.
function applyCinematicMotionBlur(postfx, intensity){
  if (!postfx || !postfx.ready) return;
  if (typeof window !== 'undefined' && typeof window._setMotionBlurFromSpeed === 'function'){
    // intensity 0..1 → maps onto a synthetic speed-ratio target.
    // 0 = baseline (no blur), 1 = full radial blur (matches 100% top speed).
    window._setMotionBlurFromSpeed(0.65 + Math.max(0, Math.min(1, intensity)) * 0.35);
  }
}

// ── Per-frame update — drives the registered cinematic effects ───────────
//
// Called from core/loop.js per frame (cheap unless arrays are populated).
// Worlds that don't use cinematic helpers see early-out instantly.
function updateCinematic(dt){
  if (typeof scene === 'undefined' || !scene) return;
  // Ground-fog scroll
  if (_cinemaState.groundFog.length){
    for (let i = 0; i < _cinemaState.groundFog.length; i++){
      const f = _cinemaState.groundFog[i];
      if (!f || !f.tex) continue;
      f.tex.offset.x += f.scrollDir[0] * f.scrollSpeed * dt;
      f.tex.offset.y += f.scrollDir[1] * f.scrollSpeed * dt;
    }
  }
  // Lamp pole emissive flicker — subtle ±0.18 sine around baseEmissive,
  // per-pole phase for asynchronous breathing across the lamp array.
  // LUT-sin + epsilon-gated emissiveIntensity write (skip wegens identieke
  // waarde i9-times per frame op het zelfde sinusoide-plateau).
  if (_cinemaState.lightPoles.length){
    const t = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now() * 0.001);
    const _tArg = t * 1.7;
    for (let i = 0; i < _cinemaState.lightPoles.length; i++){
      const p = _cinemaState.lightPoles[i];
      if (!p || !p.working || !p.headMat) continue;
      const em = p.baseEmissive + _cinSin(_tArg + p.flickerPhase) * 0.18;
      if (Math.abs(em - p._lastEm) > 0.005){
        p._lastEm = em;
        p.headMat.emissiveIntensity = em;
      }
    }
  }
  // Blinking markers — pattern-driven brightness modulation. Numeric
  // _patternId switch (0=solid,1=fast-pulse,2=morse,3=slow-pulse) ipv
  // string-compare; _cinCos via shared LUT; epsilon-gated halo + light
  // intensity writes.
  if (_cinemaState.blinkingMarkers.length){
    for (let i = 0; i < _cinemaState.blinkingMarkers.length; i++){
      const m = _cinemaState.blinkingMarkers[i];
      if (!m) continue;
      m.t += dt;
      let mul = 1.0;
      switch(m._patternId){
        case 0: mul = 1.0; break;
        case 1: mul = 0.40 + 0.60 * (0.5 + 0.5 * _cinCos(m.t * Math.PI * 4)); break;
        case 2: {
          const phase = (m.t % m.interval) / m.interval;
          if      (phase < 0.30) mul = 1.0;
          else if (phase < 0.45) mul = 0.05;
          else if (phase < 0.55) mul = 1.0;
          else if (phase < 0.70) mul = 0.05;
          else                   mul = 1.0;
          break;
        }
        default: mul = 0.30 + 0.70 * (0.5 + 0.5 * _cinCos(m.t * Math.PI * 2 / m.interval));
      }
      if (Math.abs(mul - m._lastMul) > 0.005){
        m._lastMul = mul;
        if (m.haloMat) m.haloMat.opacity = m.baseHaloOpacity * mul;
        if (m.light)   m.light.intensity = m.peakI * mul;
      }
    }
  }
  // Camera shake — applied from gameplay/camera.js via the public helper
  // (we don't mutate camera here; camera.js calls applyCinematicCameraShake
  // explicitly inside updateCamera so the shake stacks with collision-shake).
}

// ── Public exports ────────────────────────────────────────────────────────
if (typeof window !== 'undefined'){
  window.buildCinematicGroundFog          = buildCinematicGroundFog;
  window.buildCinematicLightPole          = buildCinematicLightPole;
  window.buildCinematicVolumetricLightCone= buildCinematicVolumetricLightCone;
  window.buildCinematicBlinkingMarker     = buildCinematicBlinkingMarker;
  window.buildCinematicHeadlampPool       = buildCinematicHeadlampPool;
  window.applyCinematicCameraShake        = applyCinematicCameraShake;
  window.applyCinematicMotionBlur         = applyCinematicMotionBlur;
  window.updateCinematic                  = updateCinematic;
  window.resetCinematicState              = resetCinematicState;
}
