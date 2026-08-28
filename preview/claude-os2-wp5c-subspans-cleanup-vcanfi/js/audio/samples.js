// js/audio/samples.js — manifest-driven AudioBuffer loader.
//
// Verantwoordelijk voor:
//  - definieren welke audio-assets bij welke wereld/car-type/SFX-slot horen
//  - asynchroon fetchen + decoden van die assets in de gedeelde audioCtx
//  - cache zodat herhaalde races dezelfde buffers hergebruiken
//  - per-slot graceful fail: een ontbrekend mid.ogg blokkeert base.ogg niet
//
// De caller (api.js / music-stems.js / engine-samples.js) vraagt synchroon
// "heb je samples voor X?" via has*Samples(); als false → fallback naar
// de procedurele implementatie. Geen blokkerende race-start ooit.

// ── Manifests ──────────────────────────────────────────────────────────────
// Music: 6 slots per wereld (intro/base/mid/lead/finalLap/nitroFx).
// base is REQUIRED voor stem-routing — andere slots optioneel.
const MUSIC_MANIFEST = {
  // Werelden: lege slots = automatische fallback naar procedural.
  // Vul aan zodra Suno-tracks per wereld zijn opgeleverd.
  space: {
    base: 'assets/audio/music/space/base.mp3',
  },
  deepsea: {
    base: 'assets/audio/music/deepsea/base.mp3',
  },
  candy: {
    base: 'assets/audio/music/candy/base.mp3',
  },
  volcano: {
    base: 'assets/audio/music/volcano/base.mp3',
  },
  arctic: {
    base: 'assets/audio/music/arctic/base.mp3',
  },
  sandstorm: {
    base: 'assets/audio/music/sandstorm/base.mp3',
  },
  pier47: {
    base: 'assets/audio/music/pier47/base.mp3',
  },
  guangzhou: {
    base: 'assets/audio/music/guangzhou/base.mp3',
  },
};

// Engine: per car-type 5 RPM-banden. Crossfade tussen idle/low/mid/high/redline
// op basis van speed-ratio. Filename pattern: assets/audio/engine/<type>/<band>.ogg.
// Lege manifests = fallback naar 4-osc synth in engine.js.
const ENGINE_MANIFEST = {
  super:    {},
  f1:       {},
  muscle:   {},
  electric: {},
};

// SFX: globale one-shots. Geladen bij eerste race-start, daarna gecached.
// Lege string = sample niet aanwezig → fallback naar synth in sfx.js.
const SFX_MANIFEST = {
  brake:       '',  // Tier 1a parked — no CC0 brake-squeal source via reachable mirrors
  drift1:      '',  // Tier 1a parked — no CC0 tire-screech source via reachable mirrors
  drift2:      '',
  drift3:      '',
  suspension:  'assets/audio/sfx/suspension.ogg',
  windHigh:    'assets/audio/sfx/windHigh.ogg',  // looped, geactiveerd >65% topspeed in engine.js
  impactLight: '',
  impactHard:  'assets/audio/sfx/impactHard.ogg',
  glassScatter:'assets/audio/sfx/glassScatter.ogg',
  // Pickups & boosts — Tier 1a additions, wired into playCollectSound /
  // playBoostSound / playNitroActivate via _playSampleOneShot dispatch.
  coin:        'assets/audio/sfx/coin.ogg',
  boost:       'assets/audio/sfx/boost.ogg',
  nitro:       'assets/audio/sfx/nitro.ogg',
};

// Surface: tire-rolling loops per oppervlakte. Geactiveerd via per-wereld
// surface-mapping. Filename pattern: assets/audio/surface/<surface>.ogg.
const SURFACE_MANIFEST = {
  asphalt: '',
  sand:    '',
  ice:     '',
  water:   '',
  metal:   '',
  dirt:    '',
};

// Ambient: omgevingsgeluiden. Thunder krijgt 3 variaties voor random pick,
// crowd-cheer one-shot, crowd + wind als loops. Filename pattern:
// assets/audio/ambient/<slot>.ogg.
const AMBIENT_MANIFEST = {
  thunder1:   '',
  thunder2:   '',
  thunder3:   '',
  crowdCheer: '',
  crowdLoop:  '',  // looped achtergrond crowd-noise
  windLoop:   '',  // looped environmental wind (niet de car-wind)
};

// Per-wereld default tire-surface. Override via getCurrentSurface() als
// later per-zone surfaces gewenst zijn (bv. ice patch op arctic).
const WORLD_DEFAULT_SURFACE = {
  space:     'metal',
  deepsea:   'water',
  candy:     'asphalt',
  volcano:   'sand',
  arctic:    'ice',
  sandstorm: 'sand',
  pier47:    'asphalt',
  // Guangzhou Cinematic: wet asphalt boulevard — same tyre-sound surface
  // as pier47. No new audio assets needed (per V1 scope: no audio).
  guangzhou: 'asphalt',
};

// ── State ───────────────────────────────────────────────────────────────────
// Music heeft LRU per wereld; engine/SFX/surface zijn globaal en blijven hot.
const _musicCache = new Map();
const _musicReady = new Map();
const _musicLru = [];
const LRU_MAX = 2;

const _engineCache = new Map();   // carType → Promise
const _engineReady = new Map();   // carType → buffers

const _sfxCache = new Map();      // slot → Promise
const _sfxReady = new Map();      // slot → AudioBuffer

const _surfaceCache = new Map();  // surface → Promise
const _surfaceReady = new Map();  // surface → AudioBuffer

const _ambientCache = new Map();  // slot → Promise
const _ambientReady = new Map();  // slot → AudioBuffer

function _evictIfNeeded(currentWorld){
  while(_musicLru.length > LRU_MAX){
    const drop = _musicLru.shift();
    if(drop === currentWorld) continue;
    _musicReady.delete(drop);
    _musicCache.delete(drop);
  }
}

function _touch(worldId){
  const i = _musicLru.indexOf(worldId);
  if(i >= 0) _musicLru.splice(i, 1);
  _musicLru.push(worldId);
}

// ── Fetch + decode één slot, fail-soft ──────────────────────────────────────
async function _loadSlot(ctx, url){
  if(!url) return null;
  try{
    const resp = await fetch(url, { cache: 'force-cache' });
    if(!resp.ok) return null;
    const arr = await resp.arrayBuffer();
    // decodeAudioData heeft op Safari de oude callback-signature nodig
    return await new Promise((res, rej) => {
      try{
        const p = ctx.decodeAudioData(arr, res, rej);
        if(p && p.then) p.then(res, rej);
      }catch(e){ rej(e); }
    });
  }catch(_){
    return null;
  }
}

// Bundle-preload: één key (worldId / carType) heeft N slots die samen
// horen. Resolved buffers worden als één object onder die key opgeslagen.
function _preloadBundle(manifest, cacheMap, readyMap, key){
  if(!window.audioCtx) return Promise.resolve({});
  if(cacheMap.has(key)) return cacheMap.get(key);
  const ctx = window.audioCtx;
  const slots = Object.keys(manifest);
  const p = Promise.all(
    slots.map(slot => _loadSlot(ctx, manifest[slot]).then(buf => [slot, buf]))
  ).then(pairs => {
    const buffers = {};
    for(const [slot, buf] of pairs) if(buf) buffers[slot] = buf;
    readyMap.set(key, buffers);
    return buffers;
  }).catch(_ => ({}));
  cacheMap.set(key, p);
  return p;
}

// Flat-preload: elk slot is z'n eigen cache-entry. Voor globale categorieën
// (SFX, ambient) waar er geen 'bundle key' is.
function _preloadFlat(manifest, cacheMap, readyMap){
  if(!window.audioCtx) return Promise.resolve();
  const ctx = window.audioCtx;
  const promises = Object.keys(manifest).map(slot => {
    if(cacheMap.has(slot)) return cacheMap.get(slot);
    const p = _loadSlot(ctx, manifest[slot]).then(buf => {
      if(buf) readyMap.set(slot, buf);
      return buf;
    });
    cacheMap.set(slot, p);
    return p;
  });
  return Promise.all(promises);
}

// ── Music API ───────────────────────────────────────────────────────────────
// Music draait op _preloadBundle + LRU-tracking + 'kind' classificatie zodat
// callers kunnen zien of stem-routing of procedural fallback wordt gekozen.

function preloadWorld(worldId){
  if(!window.audioCtx) return Promise.resolve({ kind:'procedural', buffers:{} });
  // Perf Phase A: timing voor audio music-stems load. Eindigt op resolve
  // van Promise.all binnen _preloadBundle; bij lege manifests is dit ~0ms.
  const _t0 = performance.now();
  return _preloadBundle(MUSIC_MANIFEST[worldId] || {}, _musicCache, _musicReady, worldId)
    .then(buffers => {
      _touch(worldId);
      _evictIfNeeded(worldId);
      if(window.perfLog){
        window.perfLog.push({ name:'audio.musicStems', ms: performance.now()-_t0, t: performance.now(), world: worldId, kind: buffers.base ? 'samples' : 'procedural' });
      }
      return { kind: buffers.base ? 'samples' : 'procedural', buffers };
    });
}

function hasMusicStems(worldId){
  const r = _musicReady.get(worldId);
  return !!(r && r.base);
}
function getReadyBuffers(worldId){ return _musicReady.get(worldId) || {}; }

// ── Engine API ──────────────────────────────────────────────────────────────

function preloadEngine(carType){
  return _preloadBundle(ENGINE_MANIFEST[carType] || {}, _engineCache, _engineReady, carType);
}

function hasEngineSamples(carType){
  const r = _engineReady.get(carType);
  return !!(r && Object.keys(r).length >= 2);
}
function getEngineBuffers(carType){ return _engineReady.get(carType) || {}; }

// ── SFX API ─────────────────────────────────────────────────────────────────

function preloadSFX(){
  return _preloadFlat(SFX_MANIFEST, _sfxCache, _sfxReady);
}

function hasSFXSample(slot){ return _sfxReady.has(slot); }
function getSFXBuffer(slot){ return _sfxReady.get(slot) || null; }

// ── Surface API ─────────────────────────────────────────────────────────────

function preloadSurface(surface){
  if(!window.audioCtx || !surface) return Promise.resolve(null);
  if(_surfaceCache.has(surface)) return _surfaceCache.get(surface);

  const url = SURFACE_MANIFEST[surface];
  const p = _loadSlot(window.audioCtx, url).then(buf => {
    if(buf) _surfaceReady.set(surface, buf);
    return buf;
  });
  _surfaceCache.set(surface, p);
  return p;
}

function preloadSurfacesForWorld(worldId){
  const surface = WORLD_DEFAULT_SURFACE[worldId] || 'asphalt';
  return preloadSurface(surface);
}

function getCurrentSurface(){
  return WORLD_DEFAULT_SURFACE[window.activeWorld] || 'asphalt';
}
function hasSurfaceSample(surface){ return _surfaceReady.has(surface); }
function getSurfaceBuffer(surface){ return _surfaceReady.get(surface) || null; }

// ── Ambient API ─────────────────────────────────────────────────────────────

function preloadAmbient(){
  return _preloadFlat(AMBIENT_MANIFEST, _ambientCache, _ambientReady);
}

function hasAmbientSample(slot){ return _ambientReady.has(slot); }
function getAmbientBuffer(slot){ return _ambientReady.get(slot) || null; }

// ── Debug ──────────────────────────────────────────────────────────────────

function _samplesDebug(){
  const info = {
    music_cached: [..._musicCache.keys()],
    music_ready: [..._musicReady.keys()],
    music_lru: [..._musicLru],
    engine_ready: [..._engineReady.keys()].map(t => `${t}:${Object.keys(_engineReady.get(t)).length}`),
    sfx_ready: [..._sfxReady.keys()],
    surface_ready: [..._surfaceReady.keys()],
    ambient_ready: [..._ambientReady.keys()],
    force_procedural: !!window._forceProceduralAudio,
  };
  console.table(info);
  return info;
}

// Sessie 04 V4 — concise "what's missing" report for asset-fill work.
// Walks every manifest and groups slots into loaded / missing / not-yet-
// preloaded. Output is intentionally compact so a quick eyeball can
// answer "where do I drop a file next?".
function _samplesAuditMissing(){
  const audit = {
    engine: {},
    sfx: { missing: [], loaded: [] },
    surface: { missing: [], loaded: [] },
    ambient: { missing: [], loaded: [] },
    music: {}
  };
  Object.keys(ENGINE_MANIFEST).forEach(carType => {
    const slots = ENGINE_MANIFEST[carType];
    const loaded = _engineReady.has(carType) ? Object.keys(_engineReady.get(carType)) : [];
    const allSlots = Object.keys(slots);
    audit.engine[carType] = {
      missing: allSlots.filter(s => !loaded.includes(s)),
      loaded
    };
  });
  Object.keys(SFX_MANIFEST).forEach(slot => {
    (_sfxReady.has(slot) ? audit.sfx.loaded : audit.sfx.missing).push(slot);
  });
  Object.keys(SURFACE_MANIFEST).forEach(slot => {
    (_surfaceReady.has(slot) ? audit.surface.loaded : audit.surface.missing).push(slot);
  });
  Object.keys(AMBIENT_MANIFEST).forEach(slot => {
    (_ambientReady.has(slot) ? audit.ambient.loaded : audit.ambient.missing).push(slot);
  });
  Object.keys(MUSIC_MANIFEST).forEach(worldId => {
    const slots = MUSIC_MANIFEST[worldId];
    const loaded = _musicReady.has(worldId) ? Object.keys(_musicReady.get(worldId)||{}) : [];
    audit.music[worldId] = {
      missing: Object.keys(slots).filter(s => !loaded.includes(s)),
      loaded
    };
  });
  console.log('[audio audit] drop files in the matching subdir to activate sample path:', audit);
  return audit;
}
if(typeof window!=='undefined')window._samplesAuditMissing = _samplesAuditMissing;

// ── Expose ──────────────────────────────────────────────────────────────────
window.MUSIC_MANIFEST = MUSIC_MANIFEST;
window.ENGINE_MANIFEST = ENGINE_MANIFEST;
window.SFX_MANIFEST = SFX_MANIFEST;
window.SURFACE_MANIFEST = SURFACE_MANIFEST;
window.AMBIENT_MANIFEST = AMBIENT_MANIFEST;
window.WORLD_DEFAULT_SURFACE = WORLD_DEFAULT_SURFACE;

window._preloadWorldAudio = preloadWorld;
window._hasMusicStems = hasMusicStems;
window._getReadyBuffers = getReadyBuffers;

window._preloadEngine = preloadEngine;
window._hasEngineSamples = hasEngineSamples;
window._getEngineBuffers = getEngineBuffers;

window._preloadSFX = preloadSFX;
window._hasSFXSample = hasSFXSample;
window._getSFXBuffer = getSFXBuffer;

window._preloadSurface = preloadSurface;
window._preloadSurfacesForWorld = preloadSurfacesForWorld;
window._getCurrentSurface = getCurrentSurface;
window._hasSurfaceSample = hasSurfaceSample;
window._getSurfaceBuffer = getSurfaceBuffer;

window._preloadAmbient = preloadAmbient;
window._hasAmbientSample = hasAmbientSample;
window._getAmbientBuffer = getAmbientBuffer;

window._samplesDebug = _samplesDebug;

export {
  preloadWorld, hasMusicStems, getReadyBuffers, MUSIC_MANIFEST,
  preloadEngine, hasEngineSamples, getEngineBuffers, ENGINE_MANIFEST,
  preloadSFX, hasSFXSample, getSFXBuffer, SFX_MANIFEST,
  preloadSurface, preloadSurfacesForWorld, getCurrentSurface,
  hasSurfaceSample, getSurfaceBuffer, SURFACE_MANIFEST,
  preloadAmbient, hasAmbientSample, getAmbientBuffer, AMBIENT_MANIFEST,
};
