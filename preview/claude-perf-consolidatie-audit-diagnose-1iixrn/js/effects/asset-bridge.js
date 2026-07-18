// js/effects/asset-bridge.js — Bridges window.Assets into the active scene.
//
// Non-module. Called from:
//   - core/boot.js   after Assets.preloadWorld(activeWorld) resolves
//   - ui/select.js   after the user selects a world (preload kicks in)
//   - core/scene.js  at the end of buildScene() so the first frame after a
//                    rebuild already has whatever assets were cached.
//
// Idempotent: each apply checks scene.userData flags and bails if already
// done. Disposing the scene clears userData → next buildScene re-applies.

'use strict';

(function(){
  // Keep environment maps applied via this bridge so disposeScene knows not
  // to dispose them when world is rebuilt (HDRI is shared between worlds).
  let _appliedHDRIPath = null;

  // Apply HDRI sky + environment for the current world, if available.
  function applyHDRI(worldId){
    if (!window.scene || !window.Assets) return false;
    if (window.activeWorld !== worldId) return false;
    const env = Assets.getHDRI(worldId);
    if (!env) return false;
    if (scene.userData._hdriApplied === env) return false;
    env.userData = env.userData || {};
    env.userData._sharedAsset = true;
    scene.background  = env;
    scene.environment = env;
    scene.userData._hdriApplied = env;
    _appliedHDRIPath = env.userData && env.userData.sourcePath;

    // Match fog color to HDRI horizon so distant geometry blends into the sky
    // band instead of producing a visible "kleurverschil" rim. Falls back to
    // existing fog color if sample failed.
    const hex = env.userData && env.userData.horizonColor;
    if (hex != null && scene.fog && scene.fog.color){
      try { scene.fog.color.setHex(hex); }
      catch (e) { /* noop */ }
      // Also refresh the day/night fog targets so updateSky's lerp doesn't
      // drift back to the procedural color.
      if (window._fogColorDay)   _fogColorDay.setHex(hex);
      if (window._fogColorNight) _fogColorNight.setHex(_darkenHex(hex, 0.55));
    }

    // Boost reflectivity so PBR materials (if any) actually sample the env.
    // Lambert materials ignore envMap entirely — no harm done. Materials
    // that have already been tuned per-component (cars, ground PBR) carry
    // userData._carPBR / _sharedAsset so we don't clobber their balance.
    scene.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const m = obj.material;
      if (!('envMapIntensity' in m)) return;
      if (m.userData && (m.userData._carPBR || m.userData._sharedAsset)) return;
      m.envMapIntensity = 0.6;
    });
    if (window.dbg) dbg.log('asset-bridge', 'HDRI applied', { world: worldId });
    return true;
  }

  function _darkenHex(hex, f){
    const r = ((hex>>16)&0xff)*f|0, g = ((hex>>8)&0xff)*f|0, b = (hex&0xff)*f|0;
    return (r<<16)|(g<<8)|b;
  }

  // Apply PBR ground textures to the largest plane that already has a
  // procedural grass canvas map (the buildGround() result). Fase E.
  function applyGround(worldId){
    if (!window.scene || !window.Assets) return false;
    if (window.activeWorld !== worldId) return false;
    const set = Assets.getGroundSet(worldId);
    if (!set || !set.color) return false;
    if (scene.userData._groundApplied) return false;
    let touched = 0;
    [set.color, set.normal, set.roughness].forEach(t => {
      if (t){
        t.userData = t.userData || {};
        t.userData._sharedAsset = true;
        // Tile generously across the 2200×2200 ground plane.
        t.repeat.set(40, 40);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.needsUpdate = true;
      }
    });
    scene.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      if (!obj.userData || !obj.userData._isProcGround) return;
      // Replace Lambert with Standard so normalMap/roughnessMap actually
      // contribute. Keep the existing color so dim baseline stays similar
      // when only the color slot is provided.
      const oldCol = (obj.material.color && obj.material.color.getHex) ? obj.material.color.getHex() : 0xffffff;
      const oldMap = obj.material.map;
      const stdMat = new THREE.MeshStandardMaterial({
        color: oldCol,
        map: set.color,
        normalMap: set.normal || null,
        roughnessMap: set.roughness || null,
        roughness: set.roughness ? 1.0 : 0.85,
        metalness: 0.0,
      });
      stdMat.userData = { _sharedAsset: true };
      // Drop the procedural canvas map only if it isn't a shared asset itself.
      if (oldMap && !(oldMap.userData && oldMap.userData._sharedAsset)) oldMap.dispose();
      try { obj.material.dispose(); } catch (_) {}
      obj.material = stdMat;
      touched++;
    });
    if (touched){
      scene.userData._groundApplied = true;
      if (window.dbg) dbg.log('asset-bridge', 'PBR ground applied', { world: worldId, meshes: touched });
    }
    return touched > 0;
  }

  // Phase 5 graphics upgrade — procedural-only ground env binding.
  //
  // applyGround vereist een HDRI ground-set (Assets.getGroundSet); zonder
  // HDRI bleef de Lambert-ground onreflectief. Deze fallback upgrade'd
  // Lambert-grounds met _isProcGround flag naar Standard zodat de
  // procedural PMREM (scene.js _buildProceduralEnvMap) wel zichtbare
  // reflectie geeft. Behoudt color/map/emissive zodat night-toggles en
  // proceduraal-canvas grounds intact blijven.
  //
  // Per-world envMapIntensity geeft de "spiegel-sterkte" — ijs reflecteert
  // sky veel (0.35), candy pastel niet (0.10). Zonder waarde voor een
  // wereld doet de helper niets (no-op, geen plot-twist).
  //
  // Mobile hard-gated — Lambert-grounds blijven daar onaangetast (geen
  // PBR shader-permutatie cost).
  const _PROC_GROUND_ENV_INT = {
    arctic:    0.35,  // ijs reflecteert sky-cyan
    candy:     0.10,  // pastel — geen overdaad
    volcano:   0.20,  // mat rock met subtle warm bounce
    sandstorm: 0.15,  // mat zand
    deepsea:   0.20,  // donker bioluminescent
    pier47:    0.50,  // kade reflecteert sodium-lamp glow
    guangzhou: 0.45,
  };

  function applyProceduralGroundEnv(worldId){
    if(window.perfMark)perfMark('assetBridge:procGround:start');
    if (!window.scene){ if(window.perfMark){perfMark('assetBridge:procGround:end');perfMeasure('assetBridge.procGround','assetBridge:procGround:start','assetBridge:procGround:end');} return false; }
    if (window.activeWorld !== worldId){ if(window.perfMark){perfMark('assetBridge:procGround:end');perfMeasure('assetBridge.procGround','assetBridge:procGround:start','assetBridge:procGround:end');} return false; }
    if (window._isMobile){ if(window.perfMark){perfMark('assetBridge:procGround:end');perfMeasure('assetBridge.procGround','assetBridge:procGround:start','assetBridge:procGround:end');} return false; }
    // Idempotent: HDRI-pad heeft al gedraaid OF wij hebben al gedraaid.
    if (scene.userData._groundApplied) return false;
    if (scene.userData._procGroundEnvApplied) return false;
    const intensity = _PROC_GROUND_ENV_INT[worldId];
    if (intensity == null) return false;
    let touched = 0;
    scene.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      if (!obj.userData || !obj.userData._isProcGround) return;
      const oldMat = obj.material;
      // Already Standard/Physical (e.g. pier47 wet-asphalt track) — alleen
      // envMapIntensity bumpen. Carrosserie-PBR materials krijgen geen
      // _isProcGround flag dus die blijven onaangeroerd.
      if (oldMat.isMeshStandardMaterial){
        oldMat.envMapIntensity = intensity;
        touched++;
        return;
      }
      if (!oldMat.isMeshLambertMaterial) return;
      // Lambert → Standard. Color, map, emissive, transparency overnemen
      // zodat de wereld er identiek uitziet maar nu env-reflectie krijgt.
      const oldCol = (oldMat.color && oldMat.color.getHex) ? oldMat.color.getHex() : 0xffffff;
      const oldEmissive = (oldMat.emissive && oldMat.emissive.getHex) ? oldMat.emissive.getHex() : 0x000000;
      const stdMat = new THREE.MeshStandardMaterial({
        color: oldCol,
        map: oldMat.map || null,
        emissive: oldEmissive,
        emissiveIntensity: oldMat.emissiveIntensity != null ? oldMat.emissiveIntensity : 1.0,
        transparent: !!oldMat.transparent,
        opacity: oldMat.opacity != null ? oldMat.opacity : 1.0,
        roughness: 0.85,
        metalness: 0.0,
        envMapIntensity: intensity,
      });
      // Map ownership wordt overgenomen door stdMat; oldMat.dispose() laat
      // de map intact. disposeScene rooit de map normaal via _disposeMat
      // op stdMat (geen _sharedAsset flag op stdMat).
      try { oldMat.dispose(); } catch (_) {}
      obj.material = stdMat;
      touched++;
    });
    if (touched > 0){
      scene.userData._procGroundEnvApplied = true;
      if (window.dbg) dbg.log('asset-bridge', 'procedural ground env applied', { world: worldId, meshes: touched, intensity });
    }
    if(window.perfMark){perfMark('assetBridge:procGround:end');perfMeasure('assetBridge.procGround','assetBridge:procGround:start','assetBridge:procGround:end');}
    return touched > 0;
  }

  // Public: re-apply everything available for the given world. Cheap if
  // already applied (idempotent).
  function maybeUpgradeWorld(worldId){
    if(window.perfMark)perfMark('assetBridge:maybeUpgrade:start');
    maybeUpgradeWorld._calls = (maybeUpgradeWorld._calls||0)+1;
    let any = false;
    if (applyHDRI(worldId))   any = true;
    if (applyGround(worldId)) any = true;
    // Phase 5 graphics upgrade: bij geen HDRI ground-set valt de procedural
    // env-only path in — Lambert ground → Standard met envMapIntensity uit
    // tabel. Mobile hard-gated. Idempotent met _procGroundEnvApplied flag.
    if (applyProceduralGroundEnv(worldId)) any = true;
    // Trees + props: handled inside the world builder (sync getters at
    // build time). Only HDRI/ground need post-hoc patching because they
    // attach to objects already created.
    // Re-precompile als er materialen zijn vervangen of envMap is
    // toegewezen — anders krijgt de eerste race-frame alsnog een shader-
    // compile spike (PBR ground = Standard ipv Lambert; HDRI envMap voegt
    // USE_ENVMAP define toe → fresh shader-permutatie). _precompileScene
    // is geëxposed door scene.js.
    if (any && typeof window._precompileScene === 'function'){
      window._precompileScene();
      // Na re-precompile ook re-warm: HDRI envMaps en PBR ground textures
      // zijn pas nu in de material-slots. Zonder warm landt de upload-spike
      // alsnog op het 1e frame waar deze materialen zichtbaar worden.
      if (typeof window._warmTextures === 'function'){
        try{ window._warmTextures(); }
        catch(_){/* same defensive try/catch als andere warm-paths */}
      }
    }
    if(window.perfMark){perfMark('assetBridge:maybeUpgrade:end');perfMeasure('assetBridge.maybeUpgrade','assetBridge:maybeUpgrade:start','assetBridge:maybeUpgrade:end');}
    return any;
  }

  // ── Shared GLTF spawn helper ────────────────────────────────────────
  // Drop one GLTF prop into the active scene at a world-space position.
  // Each call clones the prototype scene because every spawn needs its
  // own transform; the underlying geometry/material stay shared via the
  // _sharedAsset flag so disposeScene preserves the cache.
  function spawnGLTFProp(proto, worldX, worldZ, opts){
    if (!proto || !proto.scene || !window.scene) return null;
    opts = opts || {};
    const root = proto.scene.clone(true);
    // Normalize: many CC0 props ship 0.5–4× desired size. Sample bounding
    // box and scale longest horizontal extent to opts.sizeHint (meters).
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3(); box.getSize(size);
    const longest = Math.max(size.x, size.z, 0.01);
    const sFit = (opts.sizeHint || 1.6) / longest;
    const sJit = opts.scaleJitter !== false
      ? (0.85 + Math.random()*0.30) : 1;
    const s = sFit * sJit;
    root.scale.setScalar(s);
    root.position.set(worldX, opts.yOffset || 0, worldZ);
    root.rotation.y = (opts.rotation != null) ? opts.rotation : Math.random()*Math.PI*2;
    root.traverse(o=>{
      if (!o.isMesh) return;
      if (o.geometry){ o.geometry.userData = o.geometry.userData||{}; o.geometry.userData._sharedAsset=true; }
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      mats.forEach(m=>{
        m.userData = m.userData||{}; m.userData._sharedAsset=true;
        // Also flag every map slot so disposeScene's per-layer texture
        // check leaves the cached GLTF maps alive across world rebuilds.
        ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap','bumpMap'].forEach(slot=>{
          const t = m[slot];
          if (t){ t.userData = t.userData||{}; t.userData._sharedAsset=true; }
        });
      });
    });
    scene.add(root);
    return root;
  }

  // Spawn N prop clusters at the trackside. Reads available prop GLTFs
  // from window.Assets cache for the active world. Returns count of
  // clusters actually placed (0 if no GLTFs cached → caller's procedural
  // fallback should handle it).
  //
  // Phase-4 §4.1 guard: refuse to spawn if the requested worldId doesn't
  // match the currently-active world. This is the safety net that
  // catches the "hooi-baal in sandstorm" / "vliegende rocks in arctic"
  // class of bug, where a cached GLTF prototype from world A would be
  // re-spawned in world B because a stale call referenced the wrong tag.
  //
  // Cinematic-collection alias map: parallel '<world>-cinematic' worlds
  // intentionally reuse the original world's GLTF manifest entries (no
  // dedicated cinematic prop set yet). This map declares the explicit
  // exceptions to the strict equality guard. ANY new alias requires a
  // conscious entry here — the guard otherwise stays strict.
  const _PROP_WORLD_ALIASES = {
    // Future: 'arctic-cinematic': 'arctic', etc.
  };
  function spawnRoadsideProps(worldId, opts){
    // ── DIAGNOSE INSTRUMENTATION (Type C sessie 2026-05-07) ────────────────
    // Logs alias-resolution, cache-hits, and final placed-count under the
    // 'asset-bridge' channel. Activate via localStorage.src_debug_channels.
    // No-op when window.dbg is absent.
    const _diagPropKeys = (opts && opts.propKeys) || [];
    if (!window.scene || !window.Assets || !window.trackCurve){
      if (window.dbg) dbg.log('asset-bridge',
        'spawnRoadsideProps('+worldId+') early-bail — scene='+(!!window.scene)+
        ' Assets='+(!!window.Assets)+' trackCurve='+(!!window.trackCurve));
      return 0;
    }
    const aliased = _PROP_WORLD_ALIASES[window.activeWorld];
    if (window.activeWorld !== worldId && aliased !== worldId){
      if (window.dbg) dbg.warn('asset-bridge',
        'spawnRoadsideProps refused — world="'+worldId+'" but activeWorld="'+window.activeWorld+'"');
      return 0;
    }
    if (window.dbg) dbg.log('asset-bridge',
      'spawnRoadsideProps('+worldId+') guard PASSED — activeWorld='+window.activeWorld+
      (aliased ? ' aliased='+aliased : ''));
    // BARRIER_OFF must come from config.js — bail if script-load order is
    // ever broken so we can't accidentally spawn props on top of the wall.
    if (typeof BARRIER_OFF === 'undefined'){
      if (window.dbg) dbg.warn('asset-bridge',
        'spawnRoadsideProps('+worldId+') BARRIER_OFF undefined — script-load order broken');
      return 0;
    }
    opts = opts || {};
    // Per-key cache-hit log so a missing manifest entry vs a missing cached
    // model (preload skipped) can be told apart in diagnose output.
    if (window.dbg){
      _diagPropKeys.forEach(k => {
        const proto = Assets.getGLTF(worldId, k);
        dbg.log('asset-bridge',
          '  getGLTF("'+worldId+'","'+k+'") → '+(proto ? 'HIT (cached)' : 'MISS (null)'));
      });
    }
    const propKeys = (opts.propKeys || []).filter(k => !!Assets.getGLTF(worldId, k));
    if (!propKeys.length){
      if (window.dbg) dbg.warn('asset-bridge',
        'spawnRoadsideProps('+worldId+') NO USABLE KEYS — requested='+
        JSON.stringify(_diagPropKeys)+' all returned null. Check manifest.json '+
        'has worlds.'+worldId+'.props entries AND Assets.preloadWorld('+worldId+
        ') was called (or activeWorld preload covers them via _PROP_WORLD_ALIASES).');
      return 0;
    }
    const count = opts.count || 8;
    // != null so an explicit 0 from a caller is honoured (|| would coerce
    // 0 to the default and silently wrong-place props at the barrier).
    const minOff = (opts.offsetMin != null) ? opts.offsetMin : (BARRIER_OFF + 3);
    const maxOff = (opts.offsetMax != null) ? opts.offsetMax : (BARRIER_OFF + 12);
    const offRange = Math.max(2, maxOff - minOff);
    const sizeHint = opts.sizeHint || 1.8;
    const cluster = opts.clusterSize || 2;
    // Optional per-spawn vertical jitter — used by space (asteroids should
    // float at varied heights y=1..6) so GLTF props don't all stick to the
    // y=0 track surface.
    const yMin = opts.yOffsetMin != null ? opts.yOffsetMin : 0;
    const yRange = Math.max(0, (opts.yOffsetMax != null ? opts.yOffsetMax : yMin) - yMin);
    let placed = 0;
    for (let i=0;i<count;i++){
      const t = (i + 0.5)/count;
      const p = trackCurve.getPoint(t);
      const tg = trackCurve.getTangent(t).normalize();
      const nr = new THREE.Vector3(-tg.z,0,tg.x);
      const side = (i % 2 === 0 ? 1 : -1);
      const off = minOff + Math.random()*offRange;
      const cx = p.x + nr.x*side*off;
      const cz = p.z + nr.z*side*off;
      const k = 1 + (Math.random()*cluster|0);
      for (let j=0;j<k;j++){
        const propKey = propKeys[(Math.random()*propKeys.length)|0];
        const proto = Assets.getGLTF(worldId, propKey);
        const dx = (Math.random()-.5)*2.6;
        const dz = (Math.random()-.5)*2.6;
        const yOff = yMin + Math.random()*yRange;
        spawnGLTFProp(proto, cx+dx, cz+dz, { sizeHint, yOffset: yOff });
        placed++;
      }
    }
    if (window.dbg) dbg.log('asset-bridge',
      'spawnRoadsideProps('+worldId+') placed='+placed+' (usableKeys='+propKeys.length+
      '/'+_diagPropKeys.length+', count='+count+', cluster='+cluster+')');
    return placed;
  }

  // Spawn small ground-clutter props (mushrooms / flowers / ferns / grass)
  // densely in the infield/outfield, NOT track-aligned. Different from
  // spawnRoadsideProps which walks the track curve. Picks random angles
  // around two annular bands away from the racing line.
  function spawnGroundClutter(worldId, opts){
    // ── DIAGNOSE INSTRUMENTATION (Type C sessie 2026-05-07) ────────────────
    const _diagPropKeysGc = (opts && opts.propKeys) || [];
    if (!window.scene || !window.Assets || !window.trackCurve){
      if (window.dbg) dbg.log('asset-bridge',
        'spawnGroundClutter('+worldId+') early-bail — scene='+(!!window.scene)+
        ' Assets='+(!!window.Assets)+' trackCurve='+(!!window.trackCurve));
      return 0;
    }
    const aliased = _PROP_WORLD_ALIASES[window.activeWorld];
    if (window.activeWorld !== worldId && aliased !== worldId){
      if (window.dbg) dbg.warn('asset-bridge',
        'spawnGroundClutter refused — world="'+worldId+'" but activeWorld="'+window.activeWorld+'"');
      return 0;
    }
    if (typeof BARRIER_OFF === 'undefined'){
      if (window.dbg) dbg.warn('asset-bridge',
        'spawnGroundClutter('+worldId+') BARRIER_OFF undefined');
      return 0;
    }
    opts = opts || {};
    if (window.dbg){
      _diagPropKeysGc.forEach(k => {
        const proto = Assets.getGLTF(worldId, k);
        dbg.log('asset-bridge',
          '  getGLTF("'+worldId+'","'+k+'") → '+(proto ? 'HIT (cached)' : 'MISS (null)'));
      });
    }
    const propKeys = (opts.propKeys || []).filter(k => !!Assets.getGLTF(worldId, k));
    if (!propKeys.length){
      if (window.dbg) dbg.warn('asset-bridge',
        'spawnGroundClutter('+worldId+') NO USABLE KEYS — requested='+
        JSON.stringify(_diagPropKeysGc)+' all returned null.');
      return 0;
    }
    const count = opts.count || 30;
    const sizeHint = opts.sizeHint || 0.8;
    // Sample random points along the track curve, then offset perpendicular
    // by a randomized distance — same shape as roadside but with much
    // bigger lateral range and no clustering.
    // Same != null pattern as spawnRoadsideProps so explicit 0 is honoured.
    const minOff = (opts.offsetMin != null) ? opts.offsetMin : (BARRIER_OFF + 6);
    const maxOff = (opts.offsetMax != null) ? opts.offsetMax : (BARRIER_OFF + 35);
    const offRange = Math.max(2, maxOff - minOff);
    let placed = 0;
    for (let i=0;i<count;i++){
      const t = Math.random();
      const p = trackCurve.getPoint(t);
      const tg = trackCurve.getTangent(t).normalize();
      const nr = new THREE.Vector3(-tg.z,0,tg.x);
      const side = (Math.random() < 0.5 ? -1 : 1);
      const off = minOff + Math.random()*offRange;
      const cx = p.x + nr.x*side*off + (Math.random()-.5)*4;
      const cz = p.z + nr.z*side*off + (Math.random()-.5)*4;
      const propKey = propKeys[(Math.random()*propKeys.length)|0];
      const proto = Assets.getGLTF(worldId, propKey);
      spawnGLTFProp(proto, cx, cz, { sizeHint, yOffset: 0 });
      placed++;
    }
    if (window.dbg) dbg.log('asset-bridge',
      'spawnGroundClutter('+worldId+') placed='+placed+' (usableKeys='+propKeys.length+
      '/'+_diagPropKeysGc.length+', count='+count+')');
    return placed;
  }

  window.maybeUpgradeWorld = maybeUpgradeWorld;
  window.spawnGroundClutter = spawnGroundClutter;
  window.spawnGLTFProp = spawnGLTFProp;
  window.spawnRoadsideProps = spawnRoadsideProps;
  window._assetBridge = { applyHDRI, applyGround, applyProceduralGroundEnv, maybeUpgradeWorld, spawnGLTFProp, spawnRoadsideProps };
})();
