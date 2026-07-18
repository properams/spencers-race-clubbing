// js/core/perf-audit-2026.js — perf-audit-2026 instrumentation module.
// Diagnose-only. Doet niets in productie-pad (gated achter ?audit=1 URL
// flag, localStorage.src_audit='1', of window._perfAudit2026=true).
//
// Vult de gaten die debug.bundle.js + race-perf-probe.bundle.js +
// perf.bundle.js niet dekken:
//
//   - Per-milestone heap snapshots (Chrome only)        → _heapTimeline
//   - Per-milestone renderer.info snapshots             → _sceneStatsTimeline
//   - Per-milestone service-worker state                → _swTimeline
//   - Resource-load timeline (HDRI 200/404, transfer)   → _resourceTimeline
//   - Eén dump-functie die alles aggregeert             → _dumpPerfAudit2026()
//
// Reuse-discipline (P16): geen dubbele longtask observer, dat doet
// debug.js al; geen fetch-wrap (te invasief, mist img/audio); we leunen
// op bestaande perfMark/perfLog/dbg.events/_rpp.snapshot. Auditing
// activeert ook src_debug=1 zodat de bestaande observer + race-perf-probe
// hun ringbuffers vullen.

'use strict';

(function(){
  // ── Activation gate ────────────────────────────────────────────────────
  let _active = false;
  try{
    const _qs = new URLSearchParams(location.search);
    if(_qs.has('audit') || _qs.get('audit')==='1') _active = true;
    if(!_active && localStorage.getItem('src_audit')==='1') _active = true;
    if(!_active && window._perfAudit2026 === true) _active = true;
  }catch(_){}
  if(!_active) return; // silent no-op in productie

  window._perfAudit2026 = true;

  // Activeer src_debug zodat debug.js's longtask-observer + race-perf-probe
  // hun ringbuffers vullen tijdens de audit-runs. Volgt het ?perfauto=1
  // patroon uit boot.js. Idempotent.
  try{
    if(localStorage.getItem('src_debug')!=='1') localStorage.setItem('src_debug','1');
    const _ch = localStorage.getItem('src_debug_channels');
    if(_ch && !_ch.split(',').map(s=>s.trim()).includes('perf')){
      localStorage.setItem('src_debug_channels', _ch + ',perf');
    }
  }catch(_){}

  // ── Timelines ──────────────────────────────────────────────────────────
  window._heapTimeline      = [];
  window._sceneStatsTimeline = [];
  window._swTimeline         = [];
  window._resourceTimeline   = [];

  // ── Resource observer (HDRI/audio/model fetches met status + size) ────
  // buffered:true om ook resources van vóór observer-init te capturen
  // (vendor scripts, manifest.json). Geen fetch-wrap nodig: deze observer
  // dekt ook <img>/<audio>/<script>/XHR uniform.
  try{
    if(typeof PerformanceObserver !== 'undefined'){
      const _types = PerformanceObserver.supportedEntryTypes || [];
      if(_types.indexOf('resource') >= 0){
        const _obs = new PerformanceObserver((list)=>{
          for(const e of list.getEntries()){
            window._resourceTimeline.push({
              name: e.name,
              initiatorType: e.initiatorType,
              startTime: +e.startTime.toFixed(1),
              duration: +e.duration.toFixed(1),
              transferSize: e.transferSize || 0,
              encodedBodySize: e.encodedBodySize || 0,
              decodedBodySize: e.decodedBodySize || 0,
              // responseStatus is Chrome 113+; oudere browsers/Safari → 0
              responseStatus: e.responseStatus || 0,
              // Cache-hit heuristiek: transferSize===0 met decodedBodySize>0
              // duidt op disk- of memory-cache; nuttig voor cold-vs-warm
              // vergelijking zonder DevTools.
              fromCache: (e.transferSize === 0) && (e.decodedBodySize > 0),
            });
            // Cap op 500 entries om geheugen-druk te beperken bij lange sessies.
            if(window._resourceTimeline.length > 500) window._resourceTimeline.shift();
          }
        });
        _obs.observe({ type: 'resource', buffered: true });
      }
    }
  }catch(_){}

  // ── Heap snapshot ──────────────────────────────────────────────────────
  // Chrome-only via performance.memory. Caveat: MB-granular, restricted in
  // cross-origin isolated contexts. Delta's tussen labels zijn bruikbaarder
  // dan absolute waarden.
  window._heapAt = function _heapAt(label){
    let used = null, total = null, limit = null;
    try{
      if(performance && performance.memory){
        used  = +(performance.memory.usedJSHeapSize / 1048576).toFixed(2);
        total = +(performance.memory.totalJSHeapSize / 1048576).toFixed(2);
        limit = +(performance.memory.jsHeapSizeLimit / 1048576).toFixed(2);
      }
    }catch(_){}
    window._heapTimeline.push({
      label: label,
      t: +performance.now().toFixed(1),
      usedMB: used,
      totalMB: total,
      limitMB: limit,
    });
  };

  // ── Scene-stats snapshot (renderer.info) ───────────────────────────────
  // Null-guard: vóór initRenderer is window.renderer undefined.
  window._sceneStatsAt = function _sceneStatsAt(label){
    let calls = null, tris = null, progs = null, geos = null, texs = null;
    try{
      const r = window.renderer;
      if(r && r.info){
        calls = r.info.render && r.info.render.calls;
        tris  = r.info.render && r.info.render.triangles;
        progs = (r.info.programs && r.info.programs.length) || 0;
        geos  = r.info.memory  && r.info.memory.geometries;
        texs  = r.info.memory  && r.info.memory.textures;
      }
    }catch(_){}
    window._sceneStatsTimeline.push({
      label: label,
      t: +performance.now().toFixed(1),
      drawCalls: calls,
      triangles: tris,
      programs: progs,
      geometries: geos,
      textures: texs,
      world: window.activeWorld || null,
    });
  };

  // ── Service-worker state snapshot ──────────────────────────────────────
  // Async ophalen via getRegistration; pusht naar timeline zodra resolved.
  // Label markeert het milestone-tijdstip; de t-veld de daadwerkelijke
  // resolve-tijd (kan ~1 frame later zijn dan label-moment).
  window._swStateAt = function _swStateAt(label){
    const tLabel = +performance.now().toFixed(1);
    const entry = {
      label: label,
      tLabel: tLabel,
      t: tLabel,
      controllerState: null,
      installing: null,
      waiting: null,
      active: null,
      scope: null,
      supported: ('serviceWorker' in navigator),
    };
    try{
      if('serviceWorker' in navigator){
        entry.controllerState = (navigator.serviceWorker.controller &&
                                 navigator.serviceWorker.controller.state) || null;
        navigator.serviceWorker.getRegistration().then(reg=>{
          if(reg){
            entry.installing = reg.installing ? reg.installing.state : null;
            entry.waiting    = reg.waiting    ? reg.waiting.state    : null;
            entry.active     = reg.active     ? reg.active.state     : null;
            entry.scope      = reg.scope || null;
          }
          entry.t = +performance.now().toFixed(1);
          window._swTimeline.push(entry);
        }).catch(()=>{
          entry.t = +performance.now().toFixed(1);
          window._swTimeline.push(entry);
        });
        return;
      }
    }catch(_){}
    window._swTimeline.push(entry);
  };

  // ── Aggregator: één dump-functie voor de eigenaar ──────────────────────
  // copy(JSON.stringify(_dumpPerfAudit2026())) in console; plak in run-N.json.
  window._dumpPerfAudit2026 = function _dumpPerfAudit2026(){
    let rpp = null;
    try{ if(window._rpp && typeof window._rpp.snapshot === 'function') rpp = window._rpp.snapshot(); }catch(_){}
    let dbgEvents = null;
    try{ if(window.dbg && typeof window.dbg.events === 'function') dbgEvents = window.dbg.events(); }catch(_){}
    let longTasks = null;
    try{ if(window.dbg && typeof window.dbg.longTasks === 'function') longTasks = window.dbg.longTasks(); }catch(_){}
    return {
      meta: {
        url: location.href,
        t: +performance.now().toFixed(1),
        navStart: performance.timing ? performance.timing.navigationStart : null,
        ua: navigator.userAgent,
        activeWorld: window.activeWorld || null,
        gameState: window.gameState || null,
      },
      perfLog: (window.perfLog || []).slice(),
      heapTimeline: window._heapTimeline.slice(),
      sceneStatsTimeline: window._sceneStatsTimeline.slice(),
      swTimeline: window._swTimeline.slice(),
      resourceTimeline: window._resourceTimeline.slice(),
      // Hergebruik bestaande observer-data; geen duplicatie.
      longTasks: longTasks,
      dbgEvents: dbgEvents,
      rppSnapshot: rpp,
    };
  };

  // ── boot.start snapshot (vroeg in lifecycle) ───────────────────────────
  // Heap+SW state vlak na module-init. Renderer bestaat hier nog niet;
  // sceneStats wordt later op menu:interactive opgepakt.
  try{
    window._heapAt('audit.init');
    window._swStateAt('audit.init');
  }catch(_){}

  if(window.dbg && typeof window.dbg.log === 'function'){
    try{ window.dbg.log('perf', 'perf-audit-2026 active'); }catch(_){}
  } else {
    // Console-marker zodat eigenaar in DevTools ziet dat audit-mode aan staat.
    try{ console.log('[perf-audit-2026] active — call _dumpPerfAudit2026() to extract'); }catch(_){}
  }
})();
