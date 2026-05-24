// js/assets/loader.js — Asset facade (HDRI / textures / GLTF / OBJ / FBX)
// with manifest + graceful fallback. Non-module so the rest of the worlds
// (also non-module) can call window.Assets synchronously after preloadWorld().
//
// MENTAL MODEL (mirrors js/audio/samples.js):
//   1. Boot reads assets/manifest.json once into _manifest. Missing file or
//      parse error → empty manifest, every slot reports as null.
//   2. preloadWorld(worldId) fetches all slots for that world in parallel,
//      caches results. Faillig laden = slot blijft null. Nooit throwt.
//   3. Build code (worlds/*.js, track/environment.js) calls synchronous
//      get*() helpers; null = fallback naar procedural.
//
// MODEL FORMATS:
//   - .glb / .gltf  → THREE.GLTFLoader (preferred — single-file binary)
//   - .obj          → THREE.OBJLoader (+ optional sibling .mtl via MTLLoader)
//   - .fbx          → THREE.FBXLoader (+ fflate dep for zip-fbx)
//   Routing happens by extension in loadModel(); spawn helpers consume the
//   uniform { scene, animations } shape regardless of source format.
//
// External Three.js loaders come from CDN, lazy-loaded only when the first
// matching asset is requested. If CDN is down or offline → loaders blijven
// null, alle slots vallen terug op procedural. Game blijft speelbaar zonder
// enige network-asset.

'use strict';

(function(){
  // ── Constants ────────────────────────────────────────────────────────
  const MANIFEST_PATH = 'assets/manifest.json';
  const CDN_BASE = 'https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js';
  const LOADER_URLS = {
    rgbe:    CDN_BASE + '/loaders/RGBELoader.js',
    gltf:    CDN_BASE + '/loaders/GLTFLoader.js',
    obj:     CDN_BASE + '/loaders/OBJLoader.js',
    mtl:     CDN_BASE + '/loaders/MTLLoader.js',
    // FBXLoader requires fflate (for zip-fbx) and the NURBS curve helpers.
    // We load fflate first; NURBSCurve is only needed for spline geometry
    // which low-poly props don't use, so we skip it to keep payload small.
    fflate:  CDN_BASE + '/libs/fflate.min.js',
    fbx:     CDN_BASE + '/loaders/FBXLoader.js',
  };
  // Loader load-order dependencies (key → array of prerequisite keys).
  const LOADER_DEPS = {
    fbx: ['fflate'],
  };

  // ── State ────────────────────────────────────────────────────────────
  let _manifest = { worlds: {} };
  let _manifestLoaded = false;
  const _loaderPromises = {}; // cdn-script per type (lazy)
  const _hdriCache = new Map();      // path → THREE.Texture (PMREM-processed) | null
  const _textureCache = new Map();   // path → THREE.Texture | null
  const _modelCache = new Map();     // path → { scene, animations } | null  (any format)
  const _worldPreloaded = new Set();
  let _pmremGen = null;

  function _log(msg, data){ if (window.dbg) dbg.log('assets', msg, data); }
  function _warn(msg, data){ if (window.dbg) dbg.warn('assets', msg, data); else console.warn('[assets]', msg, data); }

  // ── Manifest ─────────────────────────────────────────────────────────
  async function _loadManifest(){
    if (_manifestLoaded) return _manifest;
    try {
      const r = await fetch(MANIFEST_PATH);
      if (!r.ok) throw new Error('HTTP '+r.status);
      _manifest = await r.json();
      _log('manifest loaded', { worlds: Object.keys(_manifest.worlds||{}) });
    } catch (e) {
      _log('manifest absent — all slots will be null', String(e&&e.message||e));
      _manifest = { worlds: {} };
    }
    _manifestLoaded = true;
    return _manifest;
  }

  function _slot(worldId, dotPath){
    const w = _manifest.worlds && _manifest.worlds[worldId];
    if (!w) return null;
    // HDRI has an optional mobile 1K variant. On mobile, prefer
    // hdri_mobile if present. Falls through to the desktop hdri slot
    // if mobile variant is missing or empty — so the desktop path still
    // works on mobile, just with a heavier HDRI.
    if (dotPath === 'hdri' && window._isMobile){
      if (typeof w.hdri_mobile === 'string' && w.hdri_mobile.length) return w.hdri_mobile;
    }
    const parts = dotPath.split('.');
    let cur = w;
    for (const p of parts){ if (!cur || typeof cur !== 'object') return null; cur = cur[p]; }
    return (typeof cur === 'string' && cur.length) ? cur : null;
  }

  // ── CDN loader bootstrap ─────────────────────────────────────────────
  function _ensureLoader(type){
    if (_loaderPromises[type]) return _loaderPromises[type];
    const url = LOADER_URLS[type];
    if (!url) return Promise.resolve(false);
    // Resolve any prerequisite scripts first (e.g. fbx depends on fflate).
    const deps = LOADER_DEPS[type] || [];
    const prereq = deps.length
      ? Promise.all(deps.map(d => _ensureLoader(d))).then(results => results.every(Boolean))
      : Promise.resolve(true);
    _loaderPromises[type] = prereq.then(prereqOk => {
      if (!prereqOk){ _warn('cdn loader prereq failed', type); return false; }
      return new Promise(resolve => {
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload  = () => { _log('cdn loader ready', type); resolve(true); };
        s.onerror = () => { _warn('cdn loader failed', type+' '+url); resolve(false); };
        document.head.appendChild(s);
      });
    });
    return _loaderPromises[type];
  }

  // ── HDRI ────────────────────────────────────────────────────────────
  async function loadHDRI(path){
    if (!path) return null;
    if (_hdriCache.has(path)) return _hdriCache.get(path);
    const ok = await _ensureLoader('rgbe');
    if (!ok || typeof THREE === 'undefined' || !THREE.RGBELoader){
      _hdriCache.set(path, null);
      return null;
    }
    if (!window.renderer){ _warn('hdri no renderer', path); _hdriCache.set(path, null); return null; }
    if (!_pmremGen){
      try { _pmremGen = new THREE.PMREMGenerator(window.renderer); _pmremGen.compileEquirectangularShader(); }
      catch (e) { _warn('pmrem init failed', String(e)); _hdriCache.set(path, null); return null; }
    }
    const tex = await new Promise(resolve => {
      try {
        const ldr = new THREE.RGBELoader();
        // Force Float32 so _sampleHorizon can read a plain Float32Array. The
        // default HalfFloatType produces a Uint16Array of half-floats which
        // would need DataUtils.fromHalfFloat per pixel.
        if (typeof ldr.setDataType === 'function') ldr.setDataType(THREE.FloatType);
        ldr.load(path,
          t => resolve(t),
          undefined,
          err => { _warn('rgbe load failed', path+' '+(err&&err.message||err)); resolve(null); });
      } catch (e) { _warn('rgbe throw', String(e)); resolve(null); }
    });
    if (!tex){ _hdriCache.set(path, null); return null; }
    let envMap = null;
    try {
      envMap = _pmremGen.fromEquirectangular(tex).texture;
      // Sample horizon row (mid-Y) center pixel for fog matching. RGBELoader
      // returns DataTexture (HalfFloat or Float). Read pixel via readRenderTargetPixels
      // is overkill — we approximate by sampling a few pixels from the image data.
      envMap.userData = envMap.userData || {};
      envMap.userData.horizonColor = _sampleHorizon(tex);
      envMap.userData.sourcePath = path;
    } catch (e) { _warn('pmrem fromEquirect failed', String(e)); }
    finally { try{ tex.dispose(); }catch(_){} }
    _hdriCache.set(path, envMap);
    _log('hdri ready', { path, horizonColor: envMap && envMap.userData.horizonColor });
    return envMap;
  }

  // Approximate horizon color from the equirectangular HDRI by averaging
  // a thin horizontal band at v=0.55 (just below center, where horizon
  // typically lies in outdoor HDRIs). Returns a hex int or null.
  function _sampleHorizon(tex){
    try {
      const img = tex.image;
      if (!img || !img.data) return null;
      const w = img.width, h = img.height;
      if (!w || !h) return null;
      const yRow = Math.floor(h*0.55);
      const data = img.data;
      // RGBELoader DataTexture: 4 floats per pixel (RGBA, half-float upgraded)
      const stride = 4;
      const samples = 12;
      let r=0,g=0,b=0;
      for (let i=0;i<samples;i++){
        const x = Math.floor((i/samples)*w);
        const idx = (yRow*w + x)*stride;
        r += +data[idx]   || 0;
        g += +data[idx+1] || 0;
        b += +data[idx+2] || 0;
      }
      r/=samples; g/=samples; b/=samples;
      // Tone-map exposure-style: x/(x+1) keeps it in 0..1 even for HDR>1.
      const tm = v => Math.max(0, Math.min(1, v/(v+1)));
      const R = Math.round(tm(r)*255), G = Math.round(tm(g)*255), B = Math.round(tm(b)*255);
      return (R<<16)|(G<<8)|B;
    } catch (e) { return null; }
  }

  // ── Textures ────────────────────────────────────────────────────────
  function loadTexture(path, opts){
    if (!path) return Promise.resolve(null);
    if (_textureCache.has(path)) return Promise.resolve(_textureCache.get(path));
    const o = opts || {};
    return new Promise(resolve => {
      try {
        new THREE.TextureLoader().load(path, t => {
          if (o.colorSpace === 'srgb' && window.ThreeCompat && ThreeCompat.applyTextureColorSpace){
            ThreeCompat.applyTextureColorSpace(t);
          }
          // Linear maps (normal/roughness/metalness) keep default no-color-space.
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
          const maxAniso = (window.renderer && window.renderer.capabilities)
            ? Math.min(8, window.renderer.capabilities.getMaxAnisotropy()||1) : 4;
          t.anisotropy = window._isMobile ? Math.min(4, maxAniso) : maxAniso;
          _textureCache.set(path, t);
          resolve(t);
        }, undefined, err => {
          _warn('texture load failed', path+' '+(err&&err.message||err));
          _textureCache.set(path, null);
          resolve(null);
        });
      } catch (e) { _warn('texture throw', String(e)); _textureCache.set(path, null); resolve(null); }
    });
  }

  // Convenience: load a {color,normal,roughness} set in parallel.
  async function loadGroundSet(worldId){
    const colorPath = _slot(worldId, 'ground.color');
    const normalPath = _slot(worldId, 'ground.normal');
    const roughPath = _slot(worldId, 'ground.roughness');
    if (!colorPath && !normalPath && !roughPath) return null;
    const [color, normal, roughness] = await Promise.all([
      loadTexture(colorPath,  { colorSpace: 'srgb' }),
      loadTexture(normalPath, {}),
      loadTexture(roughPath,  {}),
    ]);
    return { color, normal, roughness };
  }

  // ── Models (GLTF / OBJ / FBX) ───────────────────────────────────────
  // All three formats normalise to the same shape: { scene, animations }.
  // Caller code (spawn helpers, prop dispatch) treats them uniformly.
  function _ext(path){ return (String(path).split('.').pop()||'').toLowerCase(); }

  function _postProcessModelScene(scene){
    if (!scene) return;
    scene.traverse(obj => {
      if (obj.isMesh){
        obj.castShadow = false;
        obj.receiveShadow = false;
        const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
        mats.forEach(m=>{
          ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap','bumpMap'].forEach(slot=>{
            const t = m[slot];
            if (t && window.ThreeCompat && ThreeCompat.applyTextureColorSpace){
              // Only the diffuse-style maps need sRGB; normal/rough/metal/AO/bump
              // are linear and three.js defaults already match. The shim is a
              // no-op when the texture is already correct.
              if (slot === 'map' || slot === 'emissiveMap'){
                ThreeCompat.applyTextureColorSpace(t);
              }
            }
          });
        });
      }
    });
  }

  async function _loadGLTFInternal(path){
    const ok = await _ensureLoader('gltf');
    if (!ok || !THREE.GLTFLoader) return null;
    return await new Promise(resolve => {
      try {
        new THREE.GLTFLoader().load(path,
          gltf => resolve({ scene: gltf.scene, animations: gltf.animations||[] }),
          undefined,
          err => { _warn('gltf load failed', path+' '+(err&&err.message||err)); resolve(null); });
      } catch (e) { _warn('gltf throw', String(e)); resolve(null); }
    });
  }

  // OBJ: optionally load sibling .mtl first so OBJLoader picks up materials.
  // Manifest path 'foo.obj' → try 'foo.mtl' (same dirname, swapped ext). If
  // MTL is absent / fails, OBJLoader still parses geometry with default mat.
  async function _loadOBJInternal(path){
    const okObj = await _ensureLoader('obj');
    if (!okObj || !THREE.OBJLoader) return null;
    const mtlPath = path.replace(/\.obj$/i, '.mtl');
    let materials = null;
    if (mtlPath !== path){
      const okMtl = await _ensureLoader('mtl');
      if (okMtl && THREE.MTLLoader){
        materials = await new Promise(resolve => {
          try {
            const mtlLoader = new THREE.MTLLoader();
            // Set resourcePath so referenced textures resolve relative to
            // the .mtl's folder, not the document root.
            const dir = path.substring(0, path.lastIndexOf('/')+1);
            mtlLoader.setResourcePath(dir);
            mtlLoader.load(mtlPath,
              m => { try { m.preload(); } catch(_){} resolve(m); },
              undefined,
              () => resolve(null));   // 404 on .mtl is fine — proceed without
          } catch (e) { resolve(null); }
        });
      }
    }
    return await new Promise(resolve => {
      try {
        const loader = new THREE.OBJLoader();
        if (materials && loader.setMaterials) loader.setMaterials(materials);
        loader.load(path,
          obj => resolve({ scene: obj, animations: [] }),
          undefined,
          err => { _warn('obj load failed', path+' '+(err&&err.message||err)); resolve(null); });
      } catch (e) { _warn('obj throw', String(e)); resolve(null); }
    });
  }

  async function _loadFBXInternal(path){
    const ok = await _ensureLoader('fbx');
    if (!ok || !THREE.FBXLoader) return null;
    return await new Promise(resolve => {
      try {
        new THREE.FBXLoader().load(path,
          obj => resolve({ scene: obj, animations: obj.animations || [] }),
          undefined,
          err => { _warn('fbx load failed', path+' '+(err&&err.message||err)); resolve(null); });
      } catch (e) { _warn('fbx throw', String(e)); resolve(null); }
    });
  }

  async function loadModel(path){
    if (!path) return null;
    if (_modelCache.has(path)) return _modelCache.get(path);
    const ext = _ext(path);
    let result = null;
    if (ext === 'glb' || ext === 'gltf')      result = await _loadGLTFInternal(path);
    else if (ext === 'obj')                    result = await _loadOBJInternal(path);
    else if (ext === 'fbx')                    result = await _loadFBXInternal(path);
    else { _warn('unsupported model ext', ext+' '+path); }
    if (result && result.scene) _postProcessModelScene(result.scene);
    _modelCache.set(path, result);
    return result;
  }

  // Backwards-compat alias — older calls expected loadGLTF/getGLTF naming
  // but the underlying implementation routes any extension. Keep as alias.
  const loadGLTF = loadModel;

  // ── Per-world preload ───────────────────────────────────────────────
  async function preloadWorld(worldId){
    if (!worldId) return { kind:'none' };
    if (_worldPreloaded.has(worldId)) return { kind:'cached' };
    // Perf Phase A: split timings per asset-class. Logged in window.perfLog
    // tagged with world-id so the runner can attribute load cost per world.
    const _t0 = performance.now();
    await _loadManifest();
    const w = _manifest.worlds && _manifest.worlds[worldId];
    if (!w){ _worldPreloaded.add(worldId); return { kind:'no-manifest' }; }

    // Models = HDRI + GLTF/OBJ/FBX props. Textures = ground-set + skybox
    // layers. Audio is a separate preloadWorldAudio path (samples.js).
    const _modelTasks = [];
    const _textureTasks = [];
    if (w.hdri) _modelTasks.push(loadHDRI(w.hdri));
    if (w.ground) _textureTasks.push(loadGroundSet(worldId));
    if (w.props){
      // Each prop slot may be a string (single variant) or an array
      // (multiple variants for natural per-cluster variety).
      for (const k in w.props){
        const v = w.props[k];
        if (Array.isArray(v)) v.forEach(p => { if (p) _modelTasks.push(loadGLTF(p)); });
        else if (v) _modelTasks.push(loadGLTF(v));
      }
    }
    if (w.skybox_layers){
      for (const k in w.skybox_layers) _textureTasks.push(loadTexture(w.skybox_layers[k], { colorSpace:'srgb' }));
    }

    const _tModelStart = performance.now();
    const _modelP = Promise.all(_modelTasks).then(()=>{
      if (window.perfLog) window.perfLog.push({ name:'assets.models', ms: performance.now()-_tModelStart, t: performance.now(), world: worldId, count: _modelTasks.length });
    });
    const _tTexStart = performance.now();
    const _texP = Promise.all(_textureTasks).then(()=>{
      if (window.perfLog) window.perfLog.push({ name:'assets.textures', ms: performance.now()-_tTexStart, t: performance.now(), world: worldId, count: _textureTasks.length });
    });
    await Promise.all([_modelP, _texP]);
    if (window.perfLog) window.perfLog.push({ name:'assets.preloadWorld.total', ms: performance.now()-_t0, t: performance.now(), world: worldId });
    _worldPreloaded.add(worldId);
    return { kind:'loaded' };
  }

  // ── Synchronous getters (read cache after preload) ──────────────────
  function getHDRI(worldId){
    const path = _slot(worldId, 'hdri');
    if (!path) return null;
    return _hdriCache.has(path) ? _hdriCache.get(path) : null;
  }
  function getTexture(worldId, dotPath){
    const path = _slot(worldId, dotPath);
    if (!path) return null;
    return _textureCache.has(path) ? _textureCache.get(path) : null;
  }
  function getGroundSet(worldId){
    const c = getTexture(worldId, 'ground.color');
    const n = getTexture(worldId, 'ground.normal');
    const r = getTexture(worldId, 'ground.roughness');
    if (!c && !n && !r) return null;
    return { color:c, normal:n, roughness:r };
  }
  // getGLTF returns ONE prototype per call. If the manifest slot is an
  // array of variants, a fresh random pick is returned each time so the
  // dispatcher's per-spawn variety happens transparently.
  function getGLTF(worldId, propKey){
    const w = _manifest.worlds && _manifest.worlds[worldId];
    if (!w || !w.props) return null;
    const slot = w.props[propKey];
    if (!slot) return null;
    if (Array.isArray(slot)){
      const loaded = slot
        .map(p => (p && _modelCache.has(p)) ? _modelCache.get(p) : null)
        .filter(Boolean);
      if (!loaded.length) return null;
      return loaded[(Math.random()*loaded.length)|0];
    }
    return _modelCache.has(slot) ? _modelCache.get(slot) : null;
  }
  // Returns ALL loaded variants for a slot — used by callers (e.g. the
  // GP instanced-tree spawner) that want to balance across variants
  // instead of relying on per-call randomness.
  function getGLTFVariants(worldId, propKey){
    const w = _manifest.worlds && _manifest.worlds[worldId];
    if (!w || !w.props) return [];
    const slot = w.props[propKey];
    if (!slot) return [];
    const arr = Array.isArray(slot) ? slot : [slot];
    return arr
      .map(p => (p && _modelCache.has(p)) ? _modelCache.get(p) : null)
      .filter(Boolean);
  }
  function listProps(worldId){
    const w = _manifest.worlds && _manifest.worlds[worldId];
    return (w && w.props) ? Object.keys(w.props) : [];
  }

  // ── Status (for pause overlay UI) ───────────────────────────────────
  function status(worldId){
    const out = { hdri:false, ground:[0,0], props:[0,0], layers:[0,0] };
    const w = (_manifest.worlds||{})[worldId];
    if (!w) return out;
    if (w.hdri) out.hdri = !!_hdriCache.get(w.hdri);
    if (w.ground){
      const ks = ['color','normal','roughness'].filter(k=>!!w.ground[k]);
      out.ground = [ ks.filter(k=>!!_textureCache.get(w.ground[k])).length, ks.length ];
    }
    if (w.props){
      const ks = Object.keys(w.props);
      // A slot is "loaded" if at least one of its variants resolved.
      out.props = [
        ks.filter(k => {
          const v = w.props[k];
          if (!v) return false;
          if (Array.isArray(v)) return v.some(p => p && _modelCache.get(p));
          return !!_modelCache.get(v);
        }).length,
        ks.length,
      ];
    }
    if (w.skybox_layers){
      const ks = Object.keys(w.skybox_layers);
      out.layers = [ ks.filter(k=>!!_textureCache.get(w.skybox_layers[k])).length, ks.length ];
    }
    return out;
  }

  // ── Eviction (Phase 2 Fix B.3) ──────────────────────────────────────
  // De caches groeiden voorheen monotoon — elke world-switch voegde toe maar
  // niets werd verwijderd. Op iOS na 5-8 world-switches kruipt de totaal-VRAM
  // over de tab-kill threshold. Eviction policy: alleen het ACTIEVE world's
  // assets behouden, alle andere disposen. De disposal moet pas gebeuren
  // NADAT disposeScene de oude scene heeft leeggemaakt (anders disposen we
  // nog actief gerefereerde textures). buildScene roept evictAllExcept ná
  // disposeScene aan.
  function _disposeCachedTexture(t){ if (t && t.dispose) try{ t.dispose(); }catch(_){} }
  function _disposeCachedModel(gltf){
    if (!gltf || !gltf.scene) return;
    try{
      gltf.scene.traverse(o=>{
        if (o.geometry) try{ o.geometry.dispose(); }catch(_){}
        if (o.material){
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats){
            if (!m) continue;
            if (m.map) try{ m.map.dispose(); }catch(_){}
            if (m.normalMap) try{ m.normalMap.dispose(); }catch(_){}
            if (m.roughnessMap) try{ m.roughnessMap.dispose(); }catch(_){}
            if (m.dispose) try{ m.dispose(); }catch(_){}
          }
        }
      });
    }catch(_){}
  }
  function _collectKeepPaths(worldId){
    const out = new Set();
    const w = _manifest.worlds && _manifest.worlds[worldId];
    if (!w) return out;
    if (w.hdri) out.add(w.hdri);
    if (w.hdri_mobile) out.add(w.hdri_mobile);
    if (w.ground) for (const k in w.ground) if (w.ground[k]) out.add(w.ground[k]);
    if (w.props) for (const k in w.props){
      const v = w.props[k];
      if (Array.isArray(v)) v.forEach(p=>{ if (p) out.add(p); });
      else if (v) out.add(v);
    }
    if (w.skybox_layers) for (const k in w.skybox_layers) if (w.skybox_layers[k]) out.add(w.skybox_layers[k]);
    return out;
  }
  function evictAllExcept(worldId){
    if (!_manifestLoaded || !_manifest || !_manifest.worlds) return { evicted: 0 };
    const keep = _collectKeepPaths(worldId);
    let evicted = 0;
    for (const [path, t] of _textureCache){
      if (!keep.has(path)){ _disposeCachedTexture(t); _textureCache.delete(path); evicted++; }
    }
    for (const [path, env] of _hdriCache){
      if (!keep.has(path)){ _disposeCachedTexture(env); _hdriCache.delete(path); evicted++; }
    }
    for (const [path, gltf] of _modelCache){
      if (!keep.has(path)){ _disposeCachedModel(gltf); _modelCache.delete(path); evicted++; }
    }
    // Andere worlds zijn niet meer geprealoaded — bij volgende switch terug-laden.
    for (const wId of Array.from(_worldPreloaded)){
      if (wId !== worldId) _worldPreloaded.delete(wId);
    }
    if (evicted && window.dbg) dbg.log('assets','evictAllExcept('+worldId+') — '+evicted+' assets disposed');
    return { evicted };
  }

  // ── Init: load manifest eager so listProps works pre-preload ────────
  function init(){ return _loadManifest(); }

  window.Assets = {
    init,
    preloadWorld,
    loadHDRI, loadTexture, loadGroundSet,
    // Models (route by extension). loadGLTF kept as alias so existing
    // callers don't break; loadModel is the new canonical name.
    loadModel, loadGLTF,
    getHDRI, getTexture, getGroundSet, getGLTF, getGLTFVariants, listProps,
    status, evictAllExcept,
  };

  // Boot manifest fetch (non-blocking).
  init();
})();
