// js/effects/proc-decor.js — procedural decoration batch-builder library.
// Non-module script. Loaded between proc-geometry.js en world-loader.js zodat
// world-builders ProcDecor.* tijdens buildScene() kunnen aanroepen.
//
// Doel: vervang per-prop THREE.Mesh constructies (220 ice barriers = 220 draw
// calls) door per-template-onderdeel InstancedMesh batches (220 barriers = 1
// draw call). Template-BufferGeometries + materials worden module-scope
// gecached met userData._sharedAsset=true zodat disposeScene + lod-cull ze
// over world-switches heen behouden.
//
// Conventies:
//   - Iedere factory: buildXxxBatch(scene, positions, opts) -> handle
//     positions = [{ x, z, y?, rot?, scaleX?, scaleY?, scaleZ?, color? }, ...]
//     De caller (wereld-module) doet trackCurve-math + randomness; proc-decor
//     blijft pure renderer-laag, ongekoppeld aan track API.
//   - Mobile-gates via window._isMobile binnen elke factory (zie plan-tabel).
//   - Materials in _matCache, geos in _geomCache. Nooit muteren (cross-world
//     leak). Pulse/sway-animaties moeten material zelf clonen.
//   - Iedere IM krijgt castShadow=false en userData._sharedAsset=false op de
//     IM zelf (IM is wereld-instance), maar geo+mat userData._sharedAsset=true.
//   - Track-volgende batches (barriers, snowtrees-along-track) zetten
//     userData._noLodCull=true op de IM zodat hun grote bounding-sphere niet
//     onbedoeld weggeculld wordt.

'use strict';

(function(){
  if(typeof THREE === 'undefined') return;

  // ── Module-scope caches ────────────────────────────────────────────────
  const _geomCache = Object.create(null);
  const _matCache  = Object.create(null);
  // 2026-05-17: gebruikt _isLowDensity zodat desktop-low óók de gereduceerde
  // prop-counts krijgt (zie quality-tier.js). _isMobile alleen liet desktop-
  // low met full prop-density renderen op dpr 1.0 → aliasing-chaos.
  const _MOBILE = () => (typeof window._isLowDensity === 'function')
    ? !!window._isLowDensity()
    : !!window._isMobile;
  const _dummy  = new THREE.Object3D();

  function _tagShared(obj){
    if(!obj) return obj;
    obj.userData = obj.userData || {};
    obj.userData._sharedAsset = true;
    return obj;
  }

  function _cacheGeo(key, factory){
    if(_geomCache[key]) return _geomCache[key];
    const g = factory();
    _tagShared(g);
    _geomCache[key] = g;
    return g;
  }
  function _cacheMat(key, factory){
    if(_matCache[key]) return _matCache[key];
    const m = factory();
    _tagShared(m);
    _matCache[key] = m;
    return m;
  }

  // ── Cached shared materials specific to proc-decor ────────────────────
  // Snow / sneeuwcap met subtiele blauwe emissive rim-trick — zorgt voor
  // koel diffuse rebound zonder echte rim-light. Hergebruikt door snowtree,
  // iceberg cap, snowmound.
  function _matSnowCap(){
    return _cacheMat('snowcap', () => new THREE.MeshLambertMaterial({
      color: 0xeeffff, emissive: 0x223355, emissiveIntensity: 0.08
    }));
  }
  // Donkere winter-conifer foliage. Per-vertex color attribute zorgt voor
  // subtiele variatie tussen takken zonder extra materials.
  function _matWinterFoliage(){
    return _cacheMat('winter-foliage', () => new THREE.MeshLambertMaterial({
      color: 0x2a4a32, vertexColors: true
    }));
  }
  // Bark — donker, ruig. Gebruikt ProcTextures.bark als beschikbaar.
  function _matBark(opts){
    const key = 'bark-' + (opts && opts.tint || 'cold');
    return _cacheMat(key, () => {
      let map = null;
      if(window.ProcTextures && ProcTextures.bark){
        map = ProcTextures.bark({
          baseColor:  '#3a2a1c',
          ringColor:  '#5a3a25',
          ringCount:  10,
          repeatX: 1, repeatY: 1
        });
      }
      return new THREE.MeshLambertMaterial({ color: 0xffffff, map: map });
    });
  }
  // Ice barrier — translucent koel cyaan, identiek aan oude inline material
  // maar nu shared.
  function _matIceBarrier(){
    return _cacheMat('icebarrier', () => new THREE.MeshLambertMaterial({
      color: 0x88bbcc, transparent: true, opacity: 0.85
    }));
  }
  // Iceberg body — cyaan met iceSurface texture. Repeat-niveau wisselt per
  // call (background vs close) dus map is een argument; we cachen twee
  // material-varianten.
  function _matIcebergBody(repeat, sparkle, cracks){
    const key = 'iceberg-' + repeat + '-' + sparkle + '-' + cracks;
    return _cacheMat(key, () => {
      let map = null;
      if(window.ProcTextures && ProcTextures.iceSurface){
        map = ProcTextures.iceSurface({
          repeatX: repeat, repeatY: repeat,
          crackCount: cracks, sparkle: sparkle
        });
      }
      return new THREE.MeshLambertMaterial({
        color: 0xaaddee, map: map, transparent: true, opacity: 0.92
      });
    });
  }

  // ── Template geometries ────────────────────────────────────────────────
  // Unit cone met base op y=0, apex op y=1. Scale-Y = height, Scale-XZ =
  // radius. Vereenvoudigt per-instance matrix-stamping enorm.
  function _unitCone(sides){
    return _cacheGeo('unitcone-'+sides, () => {
      const g = new THREE.ConeGeometry(1, 1, sides);
      g.translate(0, 0.5, 0);          // base op y=0
      g.computeBoundingSphere();
      return g;
    });
  }
  // Unit cylinder met base op y=0, apex op y=1.
  function _unitCylinder(sides){
    return _cacheGeo('unitcyl-'+sides, () => {
      const g = new THREE.CylinderGeometry(1, 1, 1, sides);
      g.translate(0, 0.5, 0);
      g.computeBoundingSphere();
      return g;
    });
  }
  // Unit tapered cylinder (trunk): top kleiner dan onder.
  function _unitTaperedTrunk(sides){
    return _cacheGeo('unittrunk-'+sides, () => {
      const g = new THREE.CylinderGeometry(0.55, 1, 1, sides, 2);
      g.translate(0, 0.5, 0);
      g.computeBoundingSphere();
      return g;
    });
  }
  // Beveled ice barrier — unit (1×1×1), per-instance scale doet de rest.
  // bevelSegments:1 + curveSegments:2 ook desktop: 440× × bezuiniging is
  // ~44k tris en visueel onmerkbaar op barrière-grootte met race-snelheid.
  function _iceBarrierGeo(){
    const mobile = _MOBILE();
    const key = 'icebarrier-' + (mobile ? 'm' : 'd');
    return _cacheGeo(key, () => {
      if(window.ProcGeometry && ProcGeometry.beveledBox){
        const g = ProcGeometry.beveledBox({
          w: 1, h: 1, d: 1,
          bevel: 0.12,
          bevelSegments: 1,
          curveSegments: mobile ? 2 : 2
        });
        g.computeBoundingSphere();
        return g;
      }
      const g = new THREE.BoxGeometry(1, 1, 1);
      g.computeBoundingSphere();
      return g;
    });
  }
  // Snow mound — jittered duneCap met unit-omvang.
  function _snowMoundGeo(seed){
    const mobile = _MOBILE();
    const key = 'snowmound-' + (mobile ? 'm' : 'd') + '-' + seed;
    return _cacheGeo(key, () => {
      if(window.ProcGeometry && ProcGeometry.duneCap){
        const g = ProcGeometry.duneCap({
          radius: 1, scaleX: 1, scaleY: 1, scaleZ: 1,
          topJitter: 0.20, seed: seed
        });
        g.computeBoundingSphere();
        return g;
      }
      // Fallback — half-sphere (open hemisphere).
      const g = new THREE.SphereGeometry(1, mobile ? 6 : 8, mobile ? 4 : 6, 0, Math.PI*2, 0, Math.PI*0.5);
      g.computeBoundingSphere();
      return g;
    });
  }

  // ── Helpers — populate matrix attribute van een InstancedMesh ─────────
  function _stamp(im, i, pos, sx, sy, sz, ry){
    _dummy.position.set(pos.x, pos.y || 0, pos.z);
    _dummy.rotation.set(0, ry || 0, 0);
    _dummy.scale.set(sx, sy, sz);
    _dummy.updateMatrix();
    im.setMatrixAt(i, _dummy.matrix);
  }
  function _makeIM(geo, mat, count, opts){
    const im = new THREE.InstancedMesh(geo, mat, count);
    im.castShadow = false;
    im.receiveShadow = !!(opts && opts.receiveShadow);
    im.userData = im.userData || {};
    if(opts && opts.noLodCull) im.userData._noLodCull = true;
    // Three's ingebouwde frustum culling test geometry.boundingSphere
    // getransformeerd door mesh.matrixWorld. Onze IMs hebben matrixWorld=
    // identity terwijl per-instance posities langs de track staan; de
    // template-sphere rond origin culled dus de hele IM weg zodra de camera
    // niet richting origin kijkt. Track-volgende batches: cull uit. Voor
    // geclusterde batches zou een handmatige bounding-sphere ook werken,
    // maar `frustumCulled=false` is goedkoper (1 draw-call submit per IM)
    // en eenvoudiger dan elke caller een centroid laten berekenen.
    im.frustumCulled = false;
    return im;
  }

  // ── Factory: ice barriers ──────────────────────────────────────────────
  // Vervangt arctic.js:60-62. 220 box-meshes → 1 IM. Caller geeft per
  // positie {x,z,rot}; height/width/depth uniform.
  function buildIceBarrierBatch(scene, positions, opts){
    opts = opts || {};
    const w = opts.width  != null ? opts.width  : 0.9;
    const h = opts.height != null ? opts.height : 1.2;
    const d = opts.depth  != null ? opts.depth  : 1.0;
    const N = positions.length;
    if(N === 0) return { ims: [], pointLights: [], dispose: ()=>{} };

    const geo = _iceBarrierGeo();
    const mat = _matIceBarrier();
    const im  = _makeIM(geo, mat, N, { noLodCull: true });
    for(let i = 0; i < N; i++){
      const p = positions[i];
      _stamp(im, i, { x: p.x, y: (p.y != null ? p.y : h * 0.5), z: p.z }, w, h, d, p.rot || 0);
    }
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    return { ims: [im], pointLights: [], dispose(){ scene.remove(im); } };
  }

  // ── Factory: snow mounds ───────────────────────────────────────────────
  // Vervangt arctic.js:159-168. 20 hemispheres → 1 IM met per-instance
  // schaal-variatie (caller geeft scaleX/Y/Z mee).
  function buildSnowMoundBatch(scene, positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return { ims: [], pointLights: [], dispose: ()=>{} };

    const geo = _snowMoundGeo(opts.seed || 47);
    const mat = _matSnowCap();
    const im  = _makeIM(geo, mat, N, { noLodCull: false, receiveShadow: false });
    for(let i = 0; i < N; i++){
      const p = positions[i];
      const sx = p.scaleX != null ? p.scaleX : (p.size || 2.5);
      const sy = p.scaleY != null ? p.scaleY : (p.size || 2.5) * 0.45;
      const sz = p.scaleZ != null ? p.scaleZ : (p.size || 2.5) * 1.2;
      _stamp(im, i, { x: p.x, y: p.y || 0, z: p.z }, sx, sy, sz, p.rot || 0);
    }
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    return { ims: [im], pointLights: [], dispose(){ scene.remove(im); } };
  }

  // ── Factory: icebergs ──────────────────────────────────────────────────
  // Vervangt arctic.js:73-76 (background) en arctic.js:120-134 (close).
  // Template parts: body cone + snow cap cone, optioneel sub-shard.
  // Caller geeft {x, z, rot, height, radius, capHeight?, capRadius?, y?}.
  function buildIcebergBatch(scene, positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return { ims: [], pointLights: [], dispose: ()=>{} };

    const mobile = _MOBILE();
    const sides = opts.sides != null ? opts.sides : (mobile ? 5 : 7);
    const includeShards = !!opts.includeShards && !mobile;

    const bodyGeo = _unitCone(sides);
    const capGeo  = _unitCone(Math.max(5, sides - 1));
    const bodyMat = _matIcebergBody(
      opts.texRepeat   != null ? opts.texRepeat   : 2,
      opts.texSparkle  != null ? opts.texSparkle  : 0.55,
      opts.texCracks   != null ? opts.texCracks   : 24
    );
    const capMat = _matSnowCap();

    const ims = [];
    const bodyIM = _makeIM(bodyGeo, bodyMat, N, { noLodCull: false });
    const capIM  = _makeIM(capGeo,  capMat,  N, { noLodCull: false });
    ims.push(bodyIM, capIM);

    for(let i = 0; i < N; i++){
      const p   = positions[i];
      const h   = p.height || 8;
      const r   = p.radius || 3;
      const ch  = p.capHeight != null ? p.capHeight : h * 0.32;
      const cr  = p.capRadius != null ? p.capRadius : r * 0.55;
      const baseY = p.y != null ? p.y : 0;
      _stamp(bodyIM, i, { x: p.x, y: baseY, z: p.z }, r, h, r, p.rot || 0);
      // Cap zit op de bovenste fractie van de body — kleine overlap om gap
      // te voorkomen bij vertex-jitter / round-up.
      _stamp(capIM,  i, { x: p.x, y: baseY + h - ch * 0.4, z: p.z }, cr, ch, cr, p.rot || 0);
    }
    bodyIM.instanceMatrix.needsUpdate = true;
    capIM.instanceMatrix.needsUpdate  = true;
    scene.add(bodyIM); scene.add(capIM);

    // Optionele sub-shard skirt — kleine octahedron-clusters aan de voet.
    // 2 shards per iceberg op desktop, off op mobile.
    if(includeShards){
      const shardGeo = _cacheGeo('iceberg-shard', () => {
        const g = new THREE.OctahedronGeometry(1, 0);
        g.computeBoundingSphere();
        return g;
      });
      const shardMat = (window._sharedMat && window._sharedMat.iceLightblue)
        ? window._sharedMat.iceLightblue
        : _cacheMat('shard-fallback', () => new THREE.MeshLambertMaterial({
            color: 0xaaddff, transparent: true, opacity: 0.85
          }));
      const shardCount = N * 2;
      const shardIM = _makeIM(shardGeo, shardMat, shardCount, { noLodCull: false });
      for(let i = 0; i < N; i++){
        const p = positions[i];
        const r = p.radius || 3;
        const baseY = p.y != null ? p.y : 0;
        for(let k = 0; k < 2; k++){
          const ang = (i * 7 + k) * 1.913;        // deterministic pseudo-random
          const off = r * (0.6 + ((i+k) % 3) * 0.18);
          _stamp(shardIM, i*2 + k, {
            x: p.x + Math.cos(ang) * off,
            y: baseY + 0.15,
            z: p.z + Math.sin(ang) * off
          }, r * 0.30, r * 0.45, r * 0.30, ang);
        }
      }
      shardIM.instanceMatrix.needsUpdate = true;
      scene.add(shardIM);
      ims.push(shardIM);
    }

    return {
      ims, pointLights: [],
      dispose(){ ims.forEach(m => scene.remove(m)); }
    };
  }

  // ── Factory: snow trees ────────────────────────────────────────────────
  // Multi-mesh conifer: trunk (bark) + 3 foliage cones (winter green) + snow
  // cap. Caller geeft {x, z, rot, height, trunkRadius?, foliageRadius?}.
  // Desktop: 5 IMs (trunk + 3 cones + cap). Mobile: 4 IMs (skip top cone).
  function buildSnowTreeBatch(scene, positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return { ims: [], pointLights: [], dispose: ()=>{} };

    const mobile  = _MOBILE();
    const cnSides = mobile ? 6 : 7;
    const trSides = mobile ? 5 : 6;

    const trunkGeo  = _unitTaperedTrunk(trSides);
    const coneGeo   = _unitCone(cnSides);
    const capGeo    = _unitCone(Math.max(5, cnSides - 1));

    const trunkMat  = _matBark();
    const foliageMat= _matWinterFoliage();
    const capMat    = _matSnowCap();

    // Per-instance kleur op foliage IMs zorgt voor minimale tonale variatie
    // tussen bomen zonder extra materials (lichte tint shift per boom).
    const tierCount = mobile ? 2 : 3;
    const ims = [];
    const trunkIM = _makeIM(trunkGeo, trunkMat, N, { noLodCull: false });
    ims.push(trunkIM);
    const tierIMs = [];
    for(let t = 0; t < tierCount; t++){
      const im = _makeIM(coneGeo, foliageMat, N, { noLodCull: false });
      ims.push(im);
      tierIMs.push(im);
    }
    const capIM = _makeIM(capGeo, capMat, N, { noLodCull: false });
    ims.push(capIM);

    // Foliage per-instance color buffer — zachte tint per boom (geen
    // ostentatieve variatie, gewoon -+8% groen). vertexColors=true op
    // material; instanceColor wordt door three over vertex-color heen
    // gemultipliceerd zodat de subtiele per-vertex spread blijft werken.
    // Eén InstancedBufferAttribute gedeeld over alle tier-IMs: zelfde
    // buffer-identiteit → één GPU-upload i.p.v. tierCount uploads.
    const cBuf = new Float32Array(N * 3);
    for(let i = 0; i < N; i++){
      const v = 0.85 + ((i * 13.37) % 1) * 0.25;
      cBuf[i*3]   = v * 0.9;
      cBuf[i*3+1] = v;
      cBuf[i*3+2] = v * 0.85;
    }
    const sharedColorAttr = new THREE.InstancedBufferAttribute(cBuf, 3);
    sharedColorAttr.needsUpdate = true;
    tierIMs.forEach(im => { im.instanceColor = sharedColorAttr; });

    for(let i = 0; i < N; i++){
      const p = positions[i];
      const h = p.height || 6;
      const tr = p.trunkRadius   != null ? p.trunkRadius   : h * 0.045;
      const fr = p.foliageRadius != null ? p.foliageRadius : h * 0.32;
      const trunkH   = h * 0.22;
      const rot = p.rot || 0;
      const baseY = p.y != null ? p.y : 0;
      // Trunk
      _stamp(trunkIM, i, { x: p.x, y: baseY, z: p.z }, tr, trunkH, tr, rot);
      // Foliage tiers stacked above trunk. Bottom = biggest, top = smallest.
      // Mobile path heeft 2 tiers (bottom + mid), desktop 3 (+ top).
      const tierBaseY = baseY + trunkH * 0.85;
      const tierH = (h - trunkH * 0.85);
      const tierCounts = tierCount;
      for(let t = 0; t < tierCounts; t++){
        const tierY = tierBaseY + tierH * (t / tierCounts) * 0.95;
        const shrink = 1 - t * 0.27;                  // 1.0, 0.73, 0.46
        const tierConeH = tierH * (0.52 - t * 0.05);   // top cones are shorter
        _stamp(tierIMs[t], i,
          { x: p.x, y: tierY, z: p.z },
          fr * shrink, tierConeH, fr * shrink, rot
        );
      }
      // Snow cap — wit puntje dat duidelijk uitsteekt bóven de bovenste
      // foliage-tier (anders verdwijnt het in het groen). Cap base zit op
      // tier-apex, apex op tier-apex + capH.
      const capH = h * 0.12;
      const capR = fr * 0.22;
      _stamp(capIM, i, { x: p.x, y: baseY + h - capH * 0.1, z: p.z }, capR, capH, capR, rot);
    }
    ims.forEach(im => { im.instanceMatrix.needsUpdate = true; scene.add(im); });
    return {
      ims, pointLights: [],
      dispose(){ ims.forEach(m => scene.remove(m)); }
    };
  }

  // ── Factory: candy trees (lollipops) ──────────────────────────────────
  // Vervangt candy.js:270-317. Stick (taper cylinder) + head (sphere) +
  // stripe (torus). Head krijgt per-instance kleur via setColorAt uit het
  // palette — vervangt 52 unique head-materials door 1 shared material.
  // Returnt headIM en posities zodat night-mode emissive en lollipop-
  // cluster lights nog steeds werken in candy.js.
  function buildCandyTreeBatch(scene, positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return { ims: [], pointLights: [], lollipopPositions: [], headIM: null, dispose: ()=>{} };

    const mobile = _MOBILE();
    const palette = opts.palette || [0xff2266,0xff8800,0x22ccff,0xaadd00,0xcc44ff,0xff44aa,0xffcc00,0x44ddbb];

    // Stick — unit-height tapered cylinder (top=0.18, bottom=0.22).
    const stickGeo = _cacheGeo('candystick-'+(mobile?'m':'d'), () => {
      const g = new THREE.CylinderGeometry(0.18, 0.22, 1, 6);
      g.translate(0, 0.5, 0);
      g.computeBoundingSphere();
      return g;
    });
    const stickMat = _cacheMat('candystick', () => new THREE.MeshLambertMaterial({color:0xf5e0c8}));

    // Head — unit sphere flattened y=0.72. Material is white Lambert with
    // emissive=white at low intensity; instanceColor multiplies into both
    // color en emissive zodat per-head bloom-kleur klopt.
    const headGeo = _cacheGeo('candyhead-'+(mobile?'m':'d'), () => {
      const g = new THREE.SphereGeometry(1, mobile?8:10, mobile?6:8);
      g.scale(1, 0.72, 1);
      g.computeBoundingSphere();
      return g;
    });
    // Phase 16 C1 — desktop krijgt clearcoat sheen voor de "glossy candy"
    // look uit de mockup. Mobile blijft Lambert (clearcoat shader is ~2×
    // duurder per pixel — IM-batch zelf is nog steeds 1 draw call, dus de
    // kost is alleen fill-rate). Materials zijn per-tier gecached zodat
    // beide paden veilig naast elkaar bestaan over wereld-switches.
    const headMat = _cacheMat('candyhead-'+(mobile?'m':'d'), () => mobile
      ? new THREE.MeshLambertMaterial({
          color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.22
        })
      : new THREE.MeshPhysicalMaterial({
          color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.18,
          roughness: 0.35, metalness: 0.0,
          clearcoat: 0.6, clearcoatRoughness: 0.22
        }));

    // Stripe ring — torus, white translucent.
    const stripeGeo = _cacheGeo('candystripe-'+(mobile?'m':'d'), () => {
      const g = new THREE.TorusGeometry(1, 0.07, 4, mobile?12:16);
      g.computeBoundingSphere();
      return g;
    });
    const stripeMat = _cacheMat('candystripe', () => new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.7
    }));

    const stickIM  = _makeIM(stickGeo,  stickMat,  N);
    const headIM   = _makeIM(headGeo,   headMat,   N);
    const stripeIM = _makeIM(stripeGeo, stripeMat, N);

    const cBuf = new Float32Array(N * 3);
    const c = new THREE.Color();
    const lollipopPositions = [];
    for(let i = 0; i < N; i++){
      const p = positions[i];
      const h  = p.height || 7;
      const hr = p.headRadius || (1.8 + (((i*0.617)%1) * 0.9));
      const rot = p.rot || 0;
      // Stick
      _stamp(stickIM, i, { x: p.x, y: 0, z: p.z }, 1, h, 1, rot);
      // Head — radius hr, position above stick.
      _stamp(headIM, i, { x: p.x, y: h + hr*0.72, z: p.z }, hr, hr, hr, rot);
      // Stripe — radius 0.6*hr, thickness 0.07. Stripe is a flat torus we
      // willen op zijn kant (rotation.x=PI/2). Per-instance rotation alleen
      // op Y; X-rotatie bakken we in de geometry via een initial rotateX.
      _stamp(stripeIM, i, { x: p.x, y: h + hr*0.72, z: p.z }, hr*0.6, hr*0.6, hr*0.6, rot);

      const col = palette[p.colorIdx != null ? p.colorIdx : (i % palette.length)];
      c.setHex(col);
      cBuf[i*3]   = c.r;
      cBuf[i*3+1] = c.g;
      cBuf[i*3+2] = c.b;
      lollipopPositions.push({ position: new THREE.Vector3(p.x, h + hr*0.72, p.z) });
    }
    headIM.instanceColor = new THREE.InstancedBufferAttribute(cBuf, 3);
    headIM.instanceColor.needsUpdate = true;

    // Stripe geometry is built X-Y plane (a Three.js TorusGeometry standard).
    // Rotate the IM via its matrix so the torus lays horizontally.
    stripeIM.rotation.x = Math.PI / 2;
    stripeIM.updateMatrix();

    [stickIM, headIM, stripeIM].forEach(im => {
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
    });

    return {
      ims: [stickIM, headIM, stripeIM],
      headIM,
      lollipopPositions,
      materialRefs: { stick: stickMat, head: headMat, stripe: stripeMat },
      pointLights: [],
      dispose(){ [stickIM, headIM, stripeIM].forEach(m => scene.remove(m)); }
    };
  }

  // ── Factory: candy canes ──────────────────────────────────────────────
  // Vervangt candy.js:320-354. 6 stacked cylinders per cane → 1 shaft IM
  // met vertex-color stripes. Crook = 1 torus IM. Optional PointLight per
  // cane (caller controleert via opts.lightStride om mobile-budget te
  // respecteren).
  function buildCandyCaneBatch(scene, positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return { ims: [], pointLights: [], dispose: ()=>{} };

    const mobile = _MOBILE();
    const shaftSides = mobile ? 6 : 7;
    const shaftHeightSegs = mobile ? 6 : 12;
    const shaftH = 3.3;
    const stripeRed = new THREE.Color(0xee1122);
    const stripeWhite = new THREE.Color(0xffffff);
    const stripeCount = 6;

    const shaftGeo = _cacheGeo('cane-shaft-'+(mobile?'m':'d'), () => {
      const g = new THREE.CylinderGeometry(0.28, 0.28, shaftH, shaftSides, shaftHeightSegs);
      g.translate(0, shaftH * 0.5, 0);
      // Per-vertex color: bake stripe pattern op basis van Y. Vertices
      // delen kleur in stripeCount banden — rood/wit alternating.
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 3);
      const c   = new THREE.Color();
      for(let i = 0; i < pos.count; i++){
        const y = pos.getY(i);
        const band = Math.floor((y / shaftH) * stripeCount);
        c.copy(band % 2 === 0 ? stripeRed : stripeWhite);
        col[i*3]   = c.r;
        col[i*3+1] = c.g;
        col[i*3+2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeBoundingSphere();
      return g;
    });
    const shaftMat = _cacheMat('cane-shaft', () => new THREE.MeshLambertMaterial({
      vertexColors: true, emissive: 0x331100, emissiveIntensity: 0.18
    }));

    const crookGeo = _cacheGeo('cane-crook-'+(mobile?'m':'d'), () => {
      const g = new THREE.TorusGeometry(0.5, 0.28, mobile?5:7, mobile?10:12, Math.PI/1.8);
      g.computeBoundingSphere();
      return g;
    });
    const crookMat = _cacheMat('cane-crook', () => new THREE.MeshLambertMaterial({
      color: 0xee1122, emissive: 0x550000, emissiveIntensity: 0.2
    }));

    const shaftIM = _makeIM(shaftGeo, shaftMat, N);
    const crookIM = _makeIM(crookGeo, crookMat, N);

    const _crookDummy = new THREE.Object3D();
    for(let i = 0; i < N; i++){
      const p = positions[i];
      _stamp(shaftIM, i, { x: p.x, y: 0, z: p.z }, 1, 1, 1, p.rot || 0);
      // Crook moet op shaftH zitten, geroteerd voor "candy cane hook".
      // We componeren matrix met Z-rotatie en Y-rotatie samen.
      _crookDummy.position.set(p.x, shaftH + 0.5, p.z);
      _crookDummy.rotation.set(0, p.rot || 0, Math.PI);
      _crookDummy.scale.set(1, 1, 1);
      _crookDummy.updateMatrix();
      crookIM.setMatrixAt(i, _crookDummy.matrix);
    }
    shaftIM.instanceMatrix.needsUpdate = true;
    crookIM.instanceMatrix.needsUpdate = true;
    scene.add(shaftIM); scene.add(crookIM);

    // Optional point lights — caller geeft opts.lightStride (bv. 1 desktop,
    // 3 mobile). Wij maken hier alleen de lights aan en returnen ze.
    const pointLights = [];
    const stride = opts.lightStride || (mobile ? 3 : 1);
    if(opts.withLights !== false){
      const lightColor = opts.lightColor || 0xff6688;
      for(let i = 0; i < N; i += stride){
        const p = positions[i];
        const pl = new THREE.PointLight(lightColor, 1.0, 14);
        pl.position.set(p.x, 0.5, p.z);
        scene.add(pl);
        pointLights.push(pl);
      }
    }

    return {
      ims: [shaftIM, crookIM],
      pointLights,
      materialRefs: { shaft: shaftMat, crook: crookMat },
      dispose(){ scene.remove(shaftIM); scene.remove(crookIM); pointLights.forEach(l => scene.remove(l)); }
    };
  }

  // ── Factory: gumdrops ─────────────────────────────────────────────────
  // Vervangt candy.js:409-449. Hemisphere body + flat cap + sparkle. Per-
  // instance kleur via setColorAt op body en cap.
  function buildGumdropBatch(scene, positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return { ims: [], pointLights: [], dispose: ()=>{} };

    const mobile = _MOBILE();
    const palette = opts.palette || [0xff4488,0xffcc00,0x44ddaa,0x88aaff,0xff6622,0xcc44ff,0x44ee66,0xff8844];

    const bodyGeo = _cacheGeo('gumdrop-body-'+(mobile?'m':'d'), () => {
      const g = new THREE.SphereGeometry(1, mobile?8:10, mobile?6:8, 0, Math.PI*2, 0, Math.PI/2);
      g.computeBoundingSphere();
      return g;
    });
    const bodyMat = _cacheMat('gumdrop-body', () => new THREE.MeshLambertMaterial({
      color: 0xffffff, transparent: true, opacity: 0.88
    }));

    const capGeo = _cacheGeo('gumdrop-cap-'+(mobile?'m':'d'), () => {
      const g = new THREE.CircleGeometry(1, mobile?8:10);
      g.rotateX(-Math.PI/2);
      g.computeBoundingSphere();
      return g;
    });
    const capMat = bodyMat; // delen — zelfde tint geldt

    const sparkleGeo = _cacheGeo('gumdrop-sparkle', () => {
      const g = new THREE.SphereGeometry(0.9, 5, 5);
      g.computeBoundingSphere();
      return g;
    });
    const sparkleMat = _cacheMat('gumdrop-sparkle', () => new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.8
    }));

    const bodyIM    = _makeIM(bodyGeo,    bodyMat,    N);
    const capIM     = _makeIM(capGeo,     capMat,     N);
    const sparkleIM = _makeIM(sparkleGeo, sparkleMat, N);

    const cBuf = new Float32Array(N * 3);
    const c = new THREE.Color();
    for(let i = 0; i < N; i++){
      const p = positions[i];
      const r = p.radius || 18;
      const h = p.height || 35;
      // Body: unit hemisphere, scale x=r, y=h, z=r.
      _stamp(bodyIM, i, { x: p.x, y: 0, z: p.z }, r, h, r, p.rot || 0);
      // Cap: flat circle just above ground.
      _stamp(capIM,  i, { x: p.x, y: 0.02, z: p.z }, r, 1, r, p.rot || 0);
      // Sparkle on top.
      _stamp(sparkleIM, i, { x: p.x, y: h + 0.5, z: p.z }, 1, 1, 1, 0);

      const col = palette[p.colorIdx != null ? p.colorIdx : (i % palette.length)];
      c.setHex(col);
      cBuf[i*3] = c.r; cBuf[i*3+1] = c.g; cBuf[i*3+2] = c.b;
    }
    // Shared color attr tussen body + cap zodat ze dezelfde tint krijgen.
    const sharedColor = new THREE.InstancedBufferAttribute(cBuf, 3);
    sharedColor.needsUpdate = true;
    bodyIM.instanceColor = sharedColor;
    capIM.instanceColor  = sharedColor;

    [bodyIM, capIM, sparkleIM].forEach(im => {
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
    });
    return {
      ims: [bodyIM, capIM, sparkleIM],
      pointLights: [],
      dispose(){ [bodyIM, capIM, sparkleIM].forEach(m => scene.remove(m)); }
    };
  }

  // ── Factory: ice cream cones ──────────────────────────────────────────
  // Vervangt candy.js:745-769. Cone + 1-3 scoop-tiers. Op desktop max 3
  // scoops, mobile max 2. Per-instance kleur per scoop-tier via setColorAt.
  // Positions: [{x, z, rot?, scoopCount: 1-3, colorOffset?}].
  function buildIceCreamConeBatch(scene, positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return { ims: [], pointLights: [], dispose: ()=>{} };

    const mobile = _MOBILE();
    const maxScoops = mobile ? 2 : 3;
    // Verlaten-pretpark palette: pastel-tinten (lichtblauw 0xaaddff +
    // wit-roze 0xffcccc) lazen als kerstboom-decoratie tegen de donkere
    // midnight-sky. Vervangen door warm-paars / aubergine / oud-roze —
    // ijscoboldjes blijven leesbaar, geen festive glow.
    const palette = opts.palette || [0x6b3a52,0x4a2a4a,0x7a4866,0x5a3a5e,0x8a5a6e,0x4e2a40];

    const coneGeo = _cacheGeo('icecream-cone-'+(mobile?'m':'d'), () => {
      const g = new THREE.ConeGeometry(1.4, 3.5, 8);
      g.rotateX(Math.PI); // point down
      g.translate(0, 3.5 * 0.5, 0);
      g.computeBoundingSphere();
      return g;
    });
    const coneMat = _cacheMat('icecream-cone', () => new THREE.MeshLambertMaterial({color:0xdd9944}));

    const scoopGeo = _cacheGeo('icecream-scoop-'+(mobile?'m':'d'), () => {
      const g = new THREE.SphereGeometry(1, mobile?6:8, mobile?5:7);
      g.computeBoundingSphere();
      return g;
    });
    // Geen emissive: de stacked witte glow was de andere helft van de
    // kerstboom-lezing. Lambert zonder emissive laat instanceColor zonder
    // bloom op de scoops landen.
    const scoopMat = _cacheMat('icecream-scoop', () => new THREE.MeshLambertMaterial({
      color: 0xffffff
    }));

    const coneIM = _makeIM(coneGeo, coneMat, N);
    for(let i = 0; i < N; i++){
      const p = positions[i];
      _stamp(coneIM, i, { x: p.x, y: 0, z: p.z }, 1, 1, 1, p.rot || 0);
    }
    coneIM.instanceMatrix.needsUpdate = true;
    scene.add(coneIM);

    const ims = [coneIM];
    const c = new THREE.Color();
    // Maak per scoop-tier een aparte IM met variabele count: alleen
    // positions die >= dat tier-level scoops vragen krijgen instances.
    // Voor mobile beperkt door maxScoops.
    for(let tier = 0; tier < maxScoops; tier++){
      const tierPositions = positions.filter(p => (p.scoopCount || 1) > tier);
      if(tierPositions.length === 0) continue;
      const im = _makeIM(scoopGeo, scoopMat, tierPositions.length);
      const cBuf = new Float32Array(tierPositions.length * 3);
      let idx = 0;
      for(const p of tierPositions){
        const r = 1.3 - tier * 0.1;
        _stamp(im, idx, { x: p.x, y: 3.5 + tier * 1.5, z: p.z }, r, r, r, 0);
        const colIdx = ((p.colorOffset || 0) + tier) % palette.length;
        c.setHex(palette[colIdx]);
        cBuf[idx*3] = c.r; cBuf[idx*3+1] = c.g; cBuf[idx*3+2] = c.b;
        idx++;
      }
      im.instanceColor = new THREE.InstancedBufferAttribute(cBuf, 3);
      im.instanceColor.needsUpdate = true;
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
      ims.push(im);
    }
    return {
      ims, pointLights: [],
      materialRefs: { cone: coneMat, scoop: scoopMat },
      dispose(){ ims.forEach(m => scene.remove(m)); }
    };
  }

  // ── Factory: secondary volcanoes ──────────────────────────────────────
  // Vervangt volcano.js:166-189. Cone body + lava-rim cylinder. Op desktop
  // krijgen we ook een recessed crater (klein cylinder, hot emissive) voor
  // diepte-leesbaarheid. Returnt materialRefs zodat caller smoke-emission
  // positions per cone kan registreren.
  function buildSecondaryVolcanoBatch(scene, positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return { ims: [], pointLights: [], dispose: ()=>{} };

    const mobile = _MOBILE();
    // Bump mobile sides 8 → 10 zodat de silhouet van de top niet als
    // octagonaal blok leest. +24 tris totaal over 4 cones = verwaarloosbaar.
    const sides = mobile ? 10 : 10;

    // Cone body — frustum (top-radius 20% van basis) i.p.v. spitse cone,
    // matcht de hero-vulkaan en geeft een platte caldera-top zodat de
    // lava-rim erbinnen kan nestelen i.p.v. als rechthoekig blok op een
    // 0-radius punt te zitten. Cache-key bumped om stale ConeGeometry te
    // vermijden bij hot-reload of world-swap.
    const coneGeo = _cacheGeo('volc-frustum-'+(mobile?'m':'d'), () => {
      const g = new THREE.CylinderGeometry(0.20, 1, 1, sides);
      g.translate(0, 0.5, 0);
      g.computeBoundingSphere();
      return g;
    });
    // Caller mag eigen vm meegeven (volcano-rock material van wereld);
    // anders fallback naar gedeelde dark-basalt.
    const coneMat = opts.bodyMaterial || _cacheMat('volc-cone', () => new THREE.MeshLambertMaterial({color:0x1a0800}));

    // Lava rim — kleine cylinder bij de top, glowing.
    const rimGeo = _cacheGeo('volc-rim-'+(mobile?'m':'d'), () => {
      const g = new THREE.CylinderGeometry(1, 1, 1, sides);
      g.translate(0, 0.5, 0);
      g.computeBoundingSphere();
      return g;
    });
    const rimMat = opts.lavaMaterial
      || (window._sharedMat && window._sharedMat.lavaOrange)
      || _cacheMat('volc-rim', () => new THREE.MeshLambertMaterial({color:0xff4400, emissive:0xff2200, emissiveIntensity:1.5}));

    const coneIM = _makeIM(coneGeo, coneMat, N);
    const rimIM  = _makeIM(rimGeo,  rimMat,  N);

    for(let i = 0; i < N; i++){
      const p = positions[i];
      const r = p.radius || 50;
      const h = p.height || 70;
      const baseY = p.y != null ? p.y : -8;
      _stamp(coneIM, i, { x: p.x, y: baseY, z: p.z }, r, h, r, p.rot || 0);
      // Rim nestelt in de frustum-top (0.20r): geschaald naar 0.16r breed,
      // 3u hoog (was 6), gepositioneerd zodat z'n top vrijwel gelijk ligt
      // met de cone-top — gloeiende lava-plas i.p.v. uitsteeksel.
      _stamp(rimIM,  i, { x: p.x, y: baseY + h - 2, z: p.z }, r*0.16, 3, r*0.16, p.rot || 0);
    }
    coneIM.instanceMatrix.needsUpdate = true;
    rimIM.instanceMatrix.needsUpdate  = true;
    scene.add(coneIM); scene.add(rimIM);

    // Desktop-only: kleine recessed crater (gloeiend rood) bij de mond.
    const ims = [coneIM, rimIM];
    if(!mobile){
      const craterGeo = _cacheGeo('volc-crater', () => {
        const g = new THREE.CylinderGeometry(0.85, 1, 0.6, sides);
        g.translate(0, 0.3, 0);
        g.computeBoundingSphere();
        return g;
      });
      const craterMat = _cacheMat('volc-crater', () => new THREE.MeshBasicMaterial({color:0xff5511}));
      const craterIM = _makeIM(craterGeo, craterMat, N);
      for(let i = 0; i < N; i++){
        const p = positions[i];
        const r = p.radius || 50;
        const h = p.height || 70;
        const baseY = p.y != null ? p.y : -8;
        _stamp(craterIM, i, { x: p.x, y: baseY + h - 0.3, z: p.z }, r*0.14, 0.6, r*0.14, p.rot || 0);
      }
      craterIM.instanceMatrix.needsUpdate = true;
      scene.add(craterIM);
      ims.push(craterIM);
    }

    return {
      ims, pointLights: [],
      materialRefs: { cone: coneMat, rim: rimMat },
      dispose(){ ims.forEach(m => scene.remove(m)); }
    };
  }

  // ── Factory: lava rivers ──────────────────────────────────────────────
  // Vervangt volcano.js:197-206. Flat lava plane per river → 1 IM.
  // Pulse is single shared material (sync ipv desync) — caceller pusht
  // handle.materialRef naar _volcanoLavaRivers met 1 entry; alle 12 rivers
  // pulsen samen. Voor achtergrond scenery aanvaardbaar.
  function buildLavaRiverBatch(scene, positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return { ims: [], pointLights: [], dispose: ()=>{}, materialRef: null };

    const mobile = _MOBILE();
    // Unit plane, normaal omhoog (rotateX -PI/2 in geometry zodat
    // per-instance scale.x = width en scale.z = length).
    const planeGeo = _cacheGeo('lava-river', () => {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI/2);
      g.computeBoundingSphere();
      return g;
    });
    const mat = _cacheMat('lava-river', () => new THREE.MeshLambertMaterial({
      color: 0xff5500, emissive: 0xff2200, emissiveIntensity: 0.45,
      transparent: true, opacity: 0.78
    }));

    const im = _makeIM(planeGeo, mat, N);
    for(let i = 0; i < N; i++){
      const p = positions[i];
      _stamp(im, i,
        { x: p.x, y: p.y != null ? p.y : -0.08, z: p.z },
        p.width || 6, 1, p.length || 22, p.rot || 0
      );
    }
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    return {
      ims: [im],
      pointLights: [],
      materialRef: mat,
      dispose(){ scene.remove(im); }
    };
  }

  // ── Factory: grass patches ────────────────────────────────────────────
  // Flat circles → 1 disc IM (mobile), of
  // disc IM + crossed-quad blades met palmLeaf alphaMap (desktop).
  function buildGrassPatchBatch(scene, positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return { ims: [], pointLights: [], dispose: ()=>{} };

    const mobile = _MOBILE();
    const discGeo = _cacheGeo('grass-disc-'+(mobile?'m':'d'), () => {
      const g = new THREE.CircleGeometry(1, mobile ? 8 : 10);
      g.rotateX(-Math.PI/2);
      g.computeBoundingSphere();
      return g;
    });
    const discMat = _cacheMat('grass-disc', () => new THREE.MeshLambertMaterial({color:0x2a5a2a}));

    const discIM = _makeIM(discGeo, discMat, N);
    for(let i = 0; i < N; i++){
      const p = positions[i];
      const r = p.radius || 25;
      _stamp(discIM, i, { x: p.x, y: p.y != null ? p.y : -0.12, z: p.z }, r, 1, r, p.rot || 0);
    }
    discIM.instanceMatrix.needsUpdate = true;
    scene.add(discIM);
    const ims = [discIM];

    // Desktop: 2 perpendicular blade-quads per patch met palmLeaf alpha-mask
    // gekleurd als gras. Mobile slaat dit over (silhouette-only).
    if(!mobile && opts.withBlades !== false){
      let leafMap = null, alphaMap = null;
      if(window.ProcTextures && ProcTextures.palmLeaf){
        const pair = ProcTextures.palmLeaf({
          darkColor:'#1a3a18', lightColor:'#5a8a28', midribColor:'#2a4a18',
          repeatX:1, repeatY:1
        });
        if(pair){
          leafMap  = pair.texture || pair.map || pair;
          alphaMap = pair.alphaMap || null;
        }
      }
      const bladeGeo = _cacheGeo('grass-blade', () => {
        const g = new THREE.PlaneGeometry(1, 1);
        g.translate(0, 0.5, 0);
        g.computeBoundingSphere();
        return g;
      });
      const bladeMat = _cacheMat('grass-blade', () => new THREE.MeshLambertMaterial({
        color: 0xffffff, map: leafMap, alphaMap: alphaMap,
        transparent: true, alphaTest: 0.4, side: THREE.DoubleSide
      }));
      const blade1IM = _makeIM(bladeGeo, bladeMat, N);
      const blade2IM = _makeIM(bladeGeo, bladeMat, N);
      for(let i = 0; i < N; i++){
        const p = positions[i];
        const r = p.radius || 25;
        const bh = r * 0.18;  // blade height = ~18% of patch radius
        _stamp(blade1IM, i, { x: p.x, y: p.y != null ? p.y : -0.12, z: p.z }, r*1.2, bh, 1, p.rot || 0);
        _stamp(blade2IM, i, { x: p.x, y: p.y != null ? p.y : -0.12, z: p.z }, r*1.2, bh, 1, (p.rot || 0) + Math.PI/2);
      }
      blade1IM.instanceMatrix.needsUpdate = true;
      blade2IM.instanceMatrix.needsUpdate = true;
      scene.add(blade1IM); scene.add(blade2IM);
      ims.push(blade1IM, blade2IM);
    }
    return {
      ims, pointLights: [],
      dispose(){ ims.forEach(m => scene.remove(m)); }
    };
  }

  // ── Factory: sea rocks (deepsea) ───────────────────────────────────────
  // Vervangt deepsea.js rock-IM. Organic cylinder met radial vertex jitter
  // + per-vertex kleur-gradient (donker mossy bodem → koeler grijs top).
  function buildSeaRockBatch(scene, positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return { ims: [], pointLights: [], dispose: ()=>{} };

    const mobile = _MOBILE();
    const geo = _cacheGeo('searock-'+(mobile?'m':'d'), () => {
      let g;
      if(window.ProcGeometry && ProcGeometry.organicCylinder){
        g = ProcGeometry.organicCylinder({
          topRadius: 0.3, bottomRadius: 0.5,
          height: 1.5, sides: mobile ? 5 : 10,
          displaceAmount: 0.12, seed: 89
        });
      } else {
        g = new THREE.CylinderGeometry(0.3, 0.5, 1.5, 5);
      }
      // Per-vertex kleur — donker brown-green bodem, koeler grijs top.
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 3);
      const cDeep = new THREE.Color(0x2a3a30);   // donker, mossy
      const cTop  = new THREE.Color(0x4a5a55);   // koeler grijsgroen
      const cTmp  = new THREE.Color();
      let yMin = Infinity, yMax = -Infinity;
      for(let i = 0; i < pos.count; i++){
        const y = pos.getY(i);
        if(y < yMin) yMin = y;
        if(y > yMax) yMax = y;
      }
      const yRange = yMax - yMin || 1;
      for(let i = 0; i < pos.count; i++){
        const t = (pos.getY(i) - yMin) / yRange;
        cTmp.copy(cDeep).lerp(cTop, t);
        col[i*3] = cTmp.r; col[i*3+1] = cTmp.g; col[i*3+2] = cTmp.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeBoundingSphere();
      return g;
    });
    const mat = _cacheMat('searock', () => new THREE.MeshLambertMaterial({vertexColors:true}));

    const im = _makeIM(geo, mat, N);
    for(let i = 0; i < N; i++){
      const p = positions[i];
      const s = p.scale || 1;
      _stamp(im, i, { x: p.x, y: p.y || 0, z: p.z }, s, s, s, p.rot || 0);
    }
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    return {
      ims: [im], pointLights: [],
      dispose(){ scene.remove(im); }
    };
  }

  // ── Factory: shells (deepsea) ──────────────────────────────────────────
  // Vervangt deepsea.js shell-IM. Sphere body + optionele spiral-ridge
  // (desktop only) via een tiny torus aan de top.
  function buildShellBatch(scene, positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return { ims: [], pointLights: [], dispose: ()=>{} };

    const mobile = _MOBILE();
    const bodyGeo = _cacheGeo('shell-body-'+(mobile?'m':'d'), () => {
      const g = new THREE.SphereGeometry(1, mobile ? 5 : 7, mobile ? 4 : 6);
      g.computeBoundingSphere();
      return g;
    });
    const bodyMat = _cacheMat('shell-body', () => new THREE.MeshLambertMaterial({
      color: 0xffe0c0, emissive: 0x331a08, emissiveIntensity: 0.18
    }));

    const bodyIM = _makeIM(bodyGeo, bodyMat, N);
    for(let i = 0; i < N; i++){
      const p = positions[i];
      const s = p.scale || 1;
      _stamp(bodyIM, i, { x: p.x, y: p.y || 0, z: p.z }, s, s * 0.8, s, p.rot || 0);
    }
    bodyIM.instanceMatrix.needsUpdate = true;
    scene.add(bodyIM);
    const ims = [bodyIM];

    if(!mobile){
      const ridgeGeo = _cacheGeo('shell-ridge', () => {
        const g = new THREE.TorusGeometry(0.6, 0.06, 4, 10);
        g.rotateX(Math.PI/2);
        g.computeBoundingSphere();
        return g;
      });
      const ridgeMat = _cacheMat('shell-ridge', () => new THREE.MeshLambertMaterial({color:0xd0a070}));
      const ridgeIM = _makeIM(ridgeGeo, ridgeMat, N);
      for(let i = 0; i < N; i++){
        const p = positions[i];
        const s = p.scale || 1;
        _stamp(ridgeIM, i, { x: p.x, y: (p.y || 0) + s * 0.35, z: p.z }, s, s, s, p.rot || 0);
      }
      ridgeIM.instanceMatrix.needsUpdate = true;
      scene.add(ridgeIM);
      ims.push(ridgeIM);
    }
    return {
      ims, pointLights: [],
      dispose(){ ims.forEach(m => scene.remove(m)); }
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────
  window.ProcDecor = {
    buildIceBarrierBatch,
    buildSnowMoundBatch,
    buildIcebergBatch,
    buildSnowTreeBatch,
    buildCandyTreeBatch,
    buildCandyCaneBatch,
    buildGumdropBatch,
    buildIceCreamConeBatch,
    buildSecondaryVolcanoBatch,
    buildLavaRiverBatch,
    buildGrassPatchBatch,
    buildSeaRockBatch,
    buildShellBatch,
    // Debug / introspectie helpers
    _stats(){
      return {
        geomCacheSize: Object.keys(_geomCache).length,
        matCacheSize:  Object.keys(_matCache).length,
        geomKeys: Object.keys(_geomCache),
        matKeys:  Object.keys(_matCache)
      };
    }
  };

  if(window.dbg) dbg.log('proc-decor', 'initialised, 4 factories available');
})();
