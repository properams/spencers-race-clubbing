// js/core/quality-tier.js — desktop tier auto-detect + feature flags.
//
// Before this module the codebase had a binary `_lowQuality` flag flipped on
// either at boot (window._isMobile=true) or runtime by the auto-quality
// detector in loop.js (frames slower than 32ms or a 100ms GO-spike). That
// gave mobile a single full fallback (postFX off, mirror off, dpr 1.0) and
// gave desktop the same fallback — no graceful middle ground.
//
// This module introduces three tiers and a flags-object every render path
// reads from:
//   window._qTier  = 'high' | 'mid' | 'low'
//   window._qFlags = { ...feature flags, ...numeric caps }
//
// Tier is chosen ONCE at boot via _initQualityTier(isMobile). All downstream
// modules (renderer.js, postfx.js, atmosphere-pass.js, ssao-pass.js,
// sky-shader.js, env-baker.js, loop.js, world setup files) read flags
// instead of branching on _isMobile + _lowQuality alone.
//
// Runtime downgrade flows through _downgradeQualityTier() (defined here,
// invoked by loop.js auto-quality detector). One-way only — a tier never
// upgrades within a session, so the user only ever sees frame-time improve.

'use strict';

// ── Tier flags per level ────────────────────────────────────────────────
// Centralised so every render path has one source of truth. Adding a new
// feature is a single-line edit; no other module needs to grow if/else.
const _Q_FLAGS_HIGH = {
  tier: 'high',
  dprCap: 1.5,
  antialias: true,
  shadows: true,
  shadowType: 'PCFSoft',         // PCFSoftShadowMap on desktop high
  shadowMapSize: 1024,
  postFX: true,
  bloomScale: 0.5,                // half-res bloom RTs (current desktop default)
  ssao: true,
  ssr: true,                       // Sessie 03 — screen-space reflections, high tier only by default
  godrays: true,
  godraySamples: 24,
  skyShaderDome: true,
  mirror: true,
  mirrorFrameSkip: 1,             // run mirror every 2nd frame → ~30fps mirror
  reflectionProbe: true,
  reflectionProbeInterval: 30,    // seconds; was 10 → caused periodic hitch
  envCubeSize: 256,               // PMREM cube-RT face size (env-baker.js)
  dtClampSec: 0.05,               // dt-clamp upper bound — tight on high tier for steady physics
  // dirtyLensOverlay default-off per 2026-05-15: de statische 40-dots overlay
  // (atmosphere-pass.js _buildDirtyLensTex) staat in screen-space en
  // vermenigvuldigt bloom op vaste UV-posities. Bij bewegende camera leest
  // dat als een doorschemerend stilstaand beeld in plaats van filmisch
  // lens-vuil. Wie het terug wil zet 'm aan via dev-panel.
  dirtyLensOverlay: false,
  // PBR-upgrade Brok 2: SMAA "lite" 2-pass anti-aliasing op rtFinal ná
  // composite. 'full'=full-res 2 passes; 'half'=half-res 2 passes + bilinear
  // upscale; false=skip (composite schrijft direct naar canvas zoals voorheen).
  smaa: 'full',
  // PBR-upgrade follow-up: per-wereld speed-blur via world-visuals.speedBlur
  // multiplier. true=ingeschakeld, false=composite zet motionBlurStr op 0.
  // HIGH+MID aan, LOW uit (fill-rate-budget op mobile).
  speedBlur: true,
  wheelDust: true,                // PBR-upgrade follow-up: dust-puff op skid (alle cars)
  aiStagger: false,               // every AI updates every frame
  lodCullDist: 800                // restored 2026-05-15: 360 culled Phase 11/12 far-band props
                                   // (CBD silhouet cilinders r=540/740, Canton Tower z=-180 h≈600m,
                                   // skyline windows r=528, city-glow haze r=545). 800 covers far cyl+marge.
};

const _Q_FLAGS_MID = {
  tier: 'mid',
  dprCap: 1.25,
  antialias: true,
  shadows: true,
  shadowType: 'PCFSoft',
  shadowMapSize: 512,
  postFX: true,
  bloomScale: 0.25,               // quarter-res bloom — less fragment work
  ssao: false,                    // big shader cost, dropped on mid
  ssr: true,                       // SSR stays on at mid via quarter-res path (ssr-pass.js detects _qFlags.ssao=false)
  godrays: true,
  godraySamples: 12,              // halve sample count, halve cost
  skyShaderDome: true,
  mirror: true,
  mirrorFrameSkip: 2,             // every 3rd frame → ~20fps
  reflectionProbe: true,
  reflectionProbeInterval: 60,
  envCubeSize: 192,
  dtClampSec: 0.065,
  dirtyLensOverlay: false,
  smaa: false,                    // SMAA uit op mid: half-res + bilinear upscale gaf zichtbare waas + rand-fringes; vol-res zonder AA verkozen boven blur (jaggies < waas)
  speedBlur: true,                // PBR-upgrade follow-up: speed-blur via visuals
  wheelDust: true,                // PBR-upgrade follow-up: dust-puff op skid
  aiStagger: true,                // every 2nd frame per AI car
  lodCullDist: 500                // restored 2026-05-15: 220 culled skyline windows / near-silhouet / city-glow
};

const _Q_FLAGS_LOW = {
  tier: 'low',
  dprCap: 1.0,
  antialias: false,
  shadows: false,                 // mobile parity — no shadows at all
  shadowType: 'PCF',
  shadowMapSize: 512,
  postFX: false,
  bloomScale: 0.25,
  ssao: false,
  ssr: false,                      // SSR off on low tier
  godrays: false,
  godraySamples: 0,
  skyShaderDome: false,
  mirror: false,
  mirrorFrameSkip: 99,
  reflectionProbe: false,
  reflectionProbeInterval: 0,
  envCubeSize: 128,
  dtClampSec: 0.085,
  dirtyLensOverlay: false,
  smaa: false,                    // SMAA uit op LOW; composite schrijft direct naar canvas
  speedBlur: false,               // PBR-upgrade follow-up: speed-blur uit op LOW (fill-rate)
  wheelDust: false,               // PBR-upgrade follow-up: wheel-dust uit op LOW (particle-budget)
  aiStagger: true,
  lodCullDist: 280                // restored 2026-05-15: 150 was hiding mid-band props on mobile/low
};

const _Q_TIERS_ORDERED = ['high', 'mid', 'low'];

// ── GPU classification (renderer string heuristic) ──────────────────────
// gl.getParameter(WEBGL_debug_renderer_info) gives us the unmasked renderer
// string on most browsers (Firefox masks it). We pattern-match on known
// low-end and high-end GPUs. Unknown → high (default) but we rely on the
// runtime auto-quality detector to escalate down if frame-time is bad.
const _GPU_LOW_PATTERNS = [
  /intel.*\b(hd|uhd)\b.*\b(2|3|4|5|520|530|620|630|6000)\b/i,
  /intel.*\biris\b.*\b(540|550)\b/i,
  /amd.*\b(vega [3-8])\b/i,
  /radeon.*\br[5-7]\b/i,
  /\bmali\b/i,
  /\badreno\b/i,
  /\bpowervr\b/i,
  /swiftshader/i,
  /llvmpipe/i,
  /software/i
];
const _GPU_HIGH_PATTERNS = [
  /\brtx\b/i,
  /\bgtx ?(1[6-9]|2[0-9]|3[0-9]|4[0-9])\d{2}\b/i,
  /\brx ?[67]\d{3}\b/i,
  /\bm[123] (pro|max|ultra)\b/i,
  /\bm[234]\b/i,
  /apple.*\bm\d+\b/i,
  /\bradeon pro\b/i
];

function _classifyGPU(){
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if(!gl) return 'unknown';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    if(!rendererStr) return 'unknown';
    if(window.dbg) dbg.log('quality-tier', 'GPU = ' + rendererStr);
    if(_GPU_LOW_PATTERNS.some(rx => rx.test(rendererStr))) return 'low';
    if(_GPU_HIGH_PATTERNS.some(rx => rx.test(rendererStr))) return 'high';
    return 'unknown';
  } catch(e) {
    return 'unknown';
  }
}

// ── Initial tier pick ───────────────────────────────────────────────────
// Mobile always → 'low' (preserves existing mobile fallback exactly).
// Desktop:
//   - GPU pattern match overrides everything when confident.
//   - hardwareConcurrency < 4 → drop one tier (weak CPU usually pairs with
//     weak iGPU, prevents desktop with 2-core Atom from running high).
//   - deviceMemory < 4 (Chrome only) → drop one tier.
//   - Default: 'high' with eager runtime downgrade if the auto-quality
//     detector spots bad frames.
function _pickInitialTier(isMobile){
  if(isMobile) return 'low';
  const gpu = _classifyGPU();
  let tier;
  if(gpu === 'low') tier = 'mid';            // never start desktop on low automatically
  else if(gpu === 'high') tier = 'high';
  else tier = 'high';                         // unknown → optimistic, runtime catches
  // CPU + memory hints can tip an unknown-GPU machine down one rung.
  if(gpu === 'unknown'){
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    if(cores < 4 || mem < 4) tier = _tierDown(tier);
  }
  return tier;
}

function _tierDown(t){
  const i = _Q_TIERS_ORDERED.indexOf(t);
  if(i < 0 || i === _Q_TIERS_ORDERED.length - 1) return t;
  return _Q_TIERS_ORDERED[i + 1];
}

function _flagsForTier(t){
  if(t === 'mid') return _Q_FLAGS_MID;
  if(t === 'low') return _Q_FLAGS_LOW;
  return _Q_FLAGS_HIGH;
}

// ── Public init — called from renderer.js immediately after _isMobile is set
export function _initQualityTier(isMobile){
  let t = _pickInitialTier(!!isMobile);
  // Manual quality-pin via localStorage overrides hardware detection at boot.
  // Set/cleared from the pause-overlay quality buttons; persists across
  // sessions so a user with a slow laptop can lock to Low once and forget it.
  let pinned = null;
  try { pinned = localStorage.getItem('srcQualityPin'); } catch(_) {}
  if(pinned === 'high' || pinned === 'mid' || pinned === 'low'){
    // Mobile cannot run high/mid: postFX init explicitly disables RT
    // allocations when _isMobile is true. Cap the pin at low on mobile so
    // we never end up advertising a tier the renderer can't honour.
    t = (isMobile && pinned !== 'low') ? 'low' : pinned;
    window._qManualDowngrade = true;
    if(window.dbg) dbg.log('quality-tier', 'pinned via localStorage = ' + pinned + ' → resolved ' + t);
  } else {
    window._qManualDowngrade = false;
  }
  window._qTier = t;
  window._qFlags = Object.assign({}, _flagsForTier(t));
  if(window.dbg) dbg.log('quality-tier', 'initial tier = ' + t + ' (mobile=' + !!isMobile + ', cores=' + (navigator.hardwareConcurrency||'?') + ', mem=' + (navigator.deviceMemory||'?') + ', pin=' + (pinned || 'auto') + ')');
}

// ── Manual pin — set/cleared by pause-overlay quality buttons.
// value: 'auto' | 'high' | 'mid' | 'low'.
// Returns { changed, requiresRestart }. `requiresRestart` is true when the
// user picks 'auto' mid-session: we don't run hardware re-detection inside
// an active session because some per-world build-time gates (skyShaderDome)
// were committed at the last buildScene
// and can't be retrofitted without a world-rebuild.
export function _setQualityPin(value){
  const v = (value === 'auto' || value === 'high' || value === 'mid' || value === 'low') ? value : 'auto';
  try { localStorage.setItem('srcQualityPin', v); } catch(_) {}
  window._qManualDowngrade = (v !== 'auto');
  if(v === 'auto'){
    return { changed: false, requiresRestart: true };
  }
  // Mobile cap — same rationale as in _initQualityTier above.
  const target = (window._isMobile && v !== 'low') ? 'low' : v;
  const from = window._qTier;
  if(target === from) return { changed: false, requiresRestart: false };
  window._qTier = target;
  const next = _flagsForTier(target);
  for(const k in next) window._qFlags[k] = next[k];
  // Apply both cheap + expensive synchronously — the player just clicked a
  // button in a paused menu, so the resize cost is absorbed by the existing
  // unpause delay rather than added to a live frame.
  _setMirrorDomVisible(!!window._qFlags.mirror);
  _applyTierToRenderer();
  // Sync the legacy _lowQuality flag + speedLines DOM so renderWithPostFX
  // and HUD effects pick up the pin (renderWithPostFX still short-circuits
  // on window._lowQuality regardless of _qFlags.postFX).
  const atLow = (target === 'low');
  window._lowQuality = atLow;
  const sl = (typeof document !== 'undefined') ? document.getElementById('speedLines') : null;
  if(sl) sl.style.display = atLow ? 'none' : '';
  if(window.dbg) dbg.log('quality-tier', 'manual pin ' + from + ' → ' + target);
  return { changed: true, requiresRestart: false };
}

// ── Runtime downgrade — invoked by loop.js auto-quality detector.
// Returns true if the tier actually changed. Loop.js can use the return to
// re-apply per-pass settings (pixel ratio, mirror visibility, etc.).
export function _downgradeQualityTier(steps){
  // Manual pin wins over auto-downgrade — the player has explicitly picked a
  // tier and we don't second-guess them. Returns false so callers can detect
  // the no-op and skip their own side-effects (renderer.setPixelRatio etc.).
  if(window._qManualDowngrade) return false;
  const from = window._qTier || 'high';
  let to = from;
  const n = Math.max(1, steps|0);
  for(let i=0;i<n;i++) to = _tierDown(to);
  if(to === from) return false;
  window._qTier = to;
  // Mutate the live flags object in-place so callers that captured a
  // reference (e.g. shader uniforms holding a numeric) see the new values
  // next frame. Object.assign preserves the same identity.
  const next = _flagsForTier(to);
  for(const k in next) window._qFlags[k] = next[k];
  if(window.dbg) dbg.log('quality-tier', 'downgrade ' + from + ' → ' + to);
  // Cheap work (dpr + shadowMap.enabled + mirror DOM) runs synchronously
  // so the next frame's render uses the new flags. The expensive resize
  // work (RT reallocation + shadow-map dispose) is deferred — the
  // auto-downgrade trigger means the current frame is already late, so
  // adding a 5-15ms RT-resize on top would make a stutter into a freeze.
  _applyTierCheapSync();
  if(typeof setTimeout === 'function') setTimeout(_applyTierExpensive, 0);
  else _applyTierExpensive();
  return true;
}

// Cheap path — runs synchronously on tier change. dpr + shadow-toggle +
// mirror DOM. These are uniform/state changes that take µs not ms.
function _setMirrorDomVisible(visible){
  const mf = document.getElementById('mirrorFrame');
  const ml = document.getElementById('mirrorLabel');
  if(mf) mf.style.display = visible ? '' : 'none';
  if(ml) ml.style.display = visible ? '' : 'none';
}
function _applyTierCheapSync(){
  if(!window._qFlags) return;
  const qf = window._qFlags;
  if(window.renderer){
    try { window.renderer.setPixelRatio(Math.min(devicePixelRatio, qf.dprCap)); } catch(_) {}
    try { window.renderer.shadowMap.enabled = !!qf.shadows; } catch(_) {}
  }
  if(!qf.mirror) _setMirrorDomVisible(false);
}

// Expensive path — RT reallocation, shadow-map dispose, atmosphere/SSAO
// resize. Costs 5-15ms total. Run async (setTimeout 0) for the auto-
// downgrade path so the stutter-frame already in flight finishes first.
// Run sync for the between-race re-detect (already in a teardown window).
function _applyTierExpensive(){
  if(!window._qFlags) return;
  const qf = window._qFlags;
  // PostFX bloom RTs follow _qFlags.bloomScale. Force-reset the cached
  // dimension guards so resizePostFX actually recomputes (it skips when
  // w===_postfx.w && h===_postfx.h).
  if(window._postfx && window._postfx.ready && typeof window.resizePostFX === 'function'){
    window._postfx.w = 0; window._postfx.h = 0;
    try { window.resizePostFX(); } catch(_) {}
  }
  // Atmosphere godrays RT inherits the same bloom-scale via its own resize.
  if(typeof window._resizeAtmospherePass === 'function'){
    try { window._resizeAtmospherePass(); } catch(_) {}
  }
  // SSAO RT — stays half-res (not bloomScale-driven), but reset on tier
  // change for symmetry. The runtime gate in renderSSAO short-circuits
  // before the render path so an unused RT here is harmless.
  if(typeof window._resizeSSAO === 'function'){
    try { window._resizeSSAO(); } catch(_) {}
  }
  // Shadow-map size — three.js reallocates the shadow.map on the next
  // shadow-pass when shadow.map is null. Calling .dispose() + setting
  // .map=null is the documented way to force a resize.
  if(typeof sunLight !== 'undefined' && sunLight && qf.shadowMapSize){
    const sz = qf.shadowMapSize;
    if(sunLight.shadow && sunLight.shadow.mapSize.x !== sz){
      if(sunLight.shadow.map){ try { sunLight.shadow.map.dispose(); } catch(_) {} }
      sunLight.shadow.map = null;
      sunLight.shadow.mapSize.set(sz, sz);
    }
  }
}

// Apply both cheap + expensive sync. Used by between-race re-detect where
// we're already in a multi-hundred-ms world-switch teardown — the resize
// cost is absorbed by that existing budget rather than added to a frame.
function _applyTierToRenderer(){
  _applyTierCheapSync();
  _applyTierExpensive();
}

// Called by loop.js _resetLoopPerfCounters at every new race-start. Re-runs
// the initial-tier hardware detection so a one-shot downgrade on a heavy
// world (Guangzhou) doesn't permanently stick the user on low-tier across
// every subsequent race on light worlds (Candy / Arctic).
//
// Not adaptive on prior-race performance: we don't try "previous race was
// good, optimistically upgrade." That would need a heuristic + risk window
// and is out of scope. We just reset to the hardware-suggested tier; if
// the new race is still bad, the runtime auto-detector will downgrade again.
//
// LIMITATION: an upgrade path (low → mid → high) only re-applies _render_
// settings (dpr, shadows, mirror, postFX RTs). Per-world build-time gates
// — skyShaderDome — were committed at
// the previous buildScene and are NOT rebuilt here. The next world-switch
// honours the new tier; same-world re-detect keeps the prior gates' state.
// This is acceptable because re-detect only runs at race-start (after a
// world-switch via goToTitle / goToSelectAgain in navigation.js).
export function _reEvaluateTierForNewRace(){
  if(!window._qFlags) return;
  // Skip if the player manually pinned a tier (future feature — currently
  // there's no UI, but the hook is here so adding one doesn't undo work).
  if(window._qManualDowngrade) return;
  const fresh = _pickInitialTier(!!window._isMobile);
  if(fresh === window._qTier) return;
  if(window.dbg) dbg.log('quality-tier', 'race-start re-evaluate ' + window._qTier + ' → ' + fresh);
  window._qTier = fresh;
  const next = _flagsForTier(fresh);
  for(const k in next) window._qFlags[k] = next[k];
  // If we just bumped tier UP (e.g. low→mid), mirror DOM was hidden by a
  // prior downgrade — show it again now that the new tier wants it.
  if(window._qFlags.mirror) _setMirrorDomVisible(true);
  _applyTierToRenderer();
}

// Expose globals (non-module pattern matches the rest of js/core/).
window._initQualityTier = _initQualityTier;
window._downgradeQualityTier = _downgradeQualityTier;
window._reEvaluateTierForNewRace = _reEvaluateTierForNewRace;
window._setQualityPin = _setQualityPin;
// Convenience predicate — many call-sites just want "is this not low?".
window._qIs = function(t){ return window._qTier === t; };
window._qAtLeast = function(t){
  const cur = _Q_TIERS_ORDERED.indexOf(window._qTier || 'high');
  const min = _Q_TIERS_ORDERED.indexOf(t);
  return cur >= 0 && min >= 0 && cur <= min;   // 'high' is index 0, lower is worse
};
// Density gate — call sites die voorheen op `_isMobile` checkten om
// prop-counts te halveren moeten dit nu gebruiken. Geeft true bij mobile
// OF wanneer de desktop-user op tier 'low' staat (pixel-budget mobile,
// dus content-budget ook mobile — anders aliassen kleine props chaotisch).
window._isLowDensity = function(){
  return !!window._isMobile || window._qTier === 'low';
};
// Shared mirror-DOM helper — used by both tier downgrades/upgrades and
// loop.js _engageLowQuality legacy fallback. Avoids the 3-place duplicate
// of `getElementById('mirrorFrame').style.display = ...`.
window._setMirrorDomVisible = _setMirrorDomVisible;
