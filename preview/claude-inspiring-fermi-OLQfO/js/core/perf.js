// js/core/perf.js — performance-overlay (Ctrl+Shift+P).
// Non-module script. Geladen na debug.js zodat dbg-keyboard handlers eerst draaien.
//
// Toont een floating panel met:
//   - FPS (1-second moving average) + frame-time spread
//   - JS heap (alleen Chrome — performance.memory niet std)
//   - Renderer info (draw calls, triangles, geometries, textures)
//   - Scene-stats (objects, lights, materials)
//   - Timestamp + sessie-uptime
//
// Toggle: Ctrl+Shift+P. Refresh elke 500ms wanneer open.
// Werkt onafhankelijk van dbg.enabled (productie-debug-tool).

'use strict';

(function(){
  let _perfEl = null, _perfTimer = null;
  const _frameTimes = []; // ringbuffer laatste 60 frames
  let _lastFrame = 0;
  let _rafId = null;
  let _lastHeapMB = 0;       // voor heap-delta indicator
  // Buckets voor frame-time histogram (8 bins): <17, 17-25, 25-33, 33-50, 50-83, 83-150, 150-300, 300+ ms
  const _HIST_EDGES = [17, 25, 33, 50, 83, 150, 300];

  // Frame-time tracking draait ALLEEN wanneer de overlay zichtbaar is —
  // anders zou perf.js zelf 60× per seconde wakker zijn voor niets.
  function _trackFrame(){
    const now = performance.now();
    if (_lastFrame > 0) {
      const dt = now - _lastFrame;
      _frameTimes.push(dt);
      if (_frameTimes.length > 60) _frameTimes.shift();
    }
    _lastFrame = now;
    _rafId = requestAnimationFrame(_trackFrame);
  }
  function _startTracking(){
    if (_rafId !== null) return;
    _frameTimes.length = 0; _lastFrame = 0;
    _rafId = requestAnimationFrame(_trackFrame);
  }
  function _stopTracking(){
    if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
  }

  function _avgFps(){
    if (!_frameTimes.length) return 0;
    const avg = _frameTimes.reduce((a,b)=>a+b,0) / _frameTimes.length;
    return avg > 0 ? 1000 / avg : 0;
  }
  function _frameSpread(){
    if (_frameTimes.length < 2) return 0;
    const sorted = [..._frameTimes].sort((a,b)=>a-b);
    return sorted[sorted.length-1] - sorted[0]; // jitter ms
  }
  function _frameHistogram(){
    const bins = new Array(_HIST_EDGES.length + 1).fill(0);
    for (const dt of _frameTimes) {
      let placed = false;
      for (let i = 0; i < _HIST_EDGES.length; i++) {
        if (dt < _HIST_EDGES[i]) { bins[i]++; placed = true; break; }
      }
      if (!placed) bins[bins.length-1]++;
    }
    return bins;
  }
  function _renderHist(bins){
    // Compact ascii bar: ▁▂▃▄▅▆▇█ scaled to max bucket
    const max = Math.max(1, ...bins);
    const blocks = ['▁','▂','▃','▄','▅','▆','▇','█'];
    return bins.map(n => n === 0 ? '·' : blocks[Math.min(7, Math.floor(n/max*7))]).join('');
  }
  function _spikeCount(thresholdMs){
    let n = 0;
    for (const dt of _frameTimes) if (dt > thresholdMs) n++;
    return n;
  }

  function _build(){
    const el = document.createElement('div');
    el.id = 'perfOverlay';
    el.style.cssText = 'position:fixed;top:8px;left:8px;background:rgba(0,0,0,.85);color:#9ff;font-family:monospace;font-size:11px;padding:10px 14px;border-radius:6px;z-index:99996;pointer-events:none;line-height:1.55;letter-spacing:.5px;border:1px solid rgba(0,200,255,.3);box-shadow:0 4px 16px rgba(0,200,255,.15);min-width:240px;display:none';
    document.body.appendChild(el);
    _perfEl = el;
    return el;
  }

  function _refresh(){
    if (!_perfEl) return;
    const lines = [];
    const fps = _avgFps();
    const spread = _frameSpread();
    const fpsCol = fps >= 55 ? '#0f0' : fps >= 30 ? '#fc0' : '#f64';
    lines.push(`<span style="color:#888">FPS</span>  <span style="color:${fpsCol};font-weight:bold">${fps.toFixed(1)}</span>  <span style="color:#666">(jitter ${spread.toFixed(1)}ms)</span>`);

    // Frame-time histogram + spike counts
    const bins = _frameHistogram();
    const sp33 = _spikeCount(33);
    const sp50 = _spikeCount(50);
    const sp33col = sp33 === 0 ? '#0f0' : sp33 < 3 ? '#fc0' : '#f64';
    const sp50col = sp50 === 0 ? '#0f0' : '#f64';
    lines.push(`<span style="color:#888">HIST</span> <span style="font-family:monospace;color:#9cf">${_renderHist(bins)}</span> <span style="color:#666">[<17,25,33,50,83,150,300,+]</span>`);
    lines.push(`<span style="color:#888">>33ms</span> <span style="color:${sp33col}">${sp33}</span>  <span style="color:#888">>50ms</span> <span style="color:${sp50col}">${sp50}</span>`);

    // Heap (Chrome-only) + delta vs vorige refresh
    if (performance.memory) {
      const m = performance.memory;
      const used = m.usedJSHeapSize/1048576;
      const lim = (m.jsHeapSizeLimit/1048576).toFixed(0);
      const delta = used - _lastHeapMB;
      _lastHeapMB = used;
      const dCol = delta > 1 ? '#f64' : delta > 0.2 ? '#fc0' : '#888';
      const dStr = delta >= 0 ? '+' + delta.toFixed(2) : delta.toFixed(2);
      lines.push(`<span style="color:#888">HEAP</span> ${used.toFixed(1)}M / ${lim}M  <span style="color:${dCol}">Δ${dStr}M/0.5s</span>`);
    }

    // Renderer info
    if (window.renderer && window.renderer.info) {
      const r = window.renderer.info;
      const rd = r.render, mem = r.memory;
      const programs = (r.programs && r.programs.length) || 0;
      lines.push(`<span style="color:#888">DRAW</span> ${rd.calls} calls · ${rd.triangles.toLocaleString()} tris`);
      lines.push(`<span style="color:#888">GEOM</span> ${mem.geometries} · <span style="color:#888">TEX</span> ${mem.textures} · <span style="color:#888">PROG</span> ${programs}`);
    } else {
      lines.push('<span style="color:#666">renderer not ready</span>');
    }

    // Audio state — voor freeze-attribution rond GO
    if (window.audioCtx) {
      const aState = window.audioCtx.state;
      const oscC = window.MusicLib ? window.MusicLib._oscCount : '?';
      const liveSrc = window._dbgAudioSrc ? window._dbgAudioSrc.live : null;
      const totalStarted = window._dbgAudioSrc ? window._dbgAudioSrc.startedTotal : null;
      const sched = window.musicSched
        ? (window.musicSched.constructor.name + (window.musicSched.style ? ':' + window.musicSched.style : ''))
        : '—';
      const aCol = aState === 'running' ? '#0f0' : '#fc0';
      let audioLine = `<span style="color:#888">AUDIO</span> <span style="color:${aCol}">${aState}</span> · osc ${oscC}`;
      if (liveSrc !== null) audioLine += ` · live ${liveSrc} · total ${totalStarted}`;
      audioLine += ` · <span style="color:#888">SCHED</span> ${sched}`;
      lines.push(audioLine);
    }

    // Scene-stats
    if (window.scene) {
      let nMesh=0, nLight=0, nGroup=0;
      window.scene.traverse(o => {
        if (o.isMesh || o.isPoints || o.isLine) nMesh++;
        else if (o.isLight) nLight++;
        else if (o.isGroup) nGroup++;
      });
      lines.push(`<span style="color:#888">SCENE</span> ${nMesh} meshes · ${nLight} lights · ${nGroup} groups`);
    }

    // World + game state
    lines.push(`<span style="color:#888">WORLD</span> ${window.activeWorld||'?'} · <span style="color:#888">STATE</span> ${window.gameState||'?'}`);

    // Cars
    if (window.carObjs) {
      lines.push(`<span style="color:#888">CARS</span> ${window.carObjs.length} (player idx ${window.playerIdx})`);
    }

    // Recent race events + spikes (laatste 3 + count) — alleen wanneer dbg.enabled
    if (window.dbg && window.dbg.enabled) {
      const ev = window.dbg.raceEvents();
      const sp = window.dbg.spikes();
      if (ev.length) {
        const last3 = ev.slice(-3).map(e =>
          `${e.t}s ${e.name}${e.heapMB?(' '+e.heapMB+'M'):''}${e.programs!==undefined?(' p'+e.programs):''}`
        ).join('<br>');
        lines.push(`<span style="color:#888">EVENTS</span><br><span style="color:#9cf;font-size:10px">${last3}</span>`);
      }
      if (sp.length) {
        const top3 = sp.slice().sort((a,b)=>b.dt-a.dt).slice(0,3).map(s =>
          `${s.t}s ${s.dt}ms ${s.gameState||'?'} ${s.activeWorld||'?'}`
        ).join('<br>');
        lines.push(`<span style="color:#888">SPIKES (${sp.length})</span><br><span style="color:#fc6;font-size:10px">${top3}</span>`);
      }
    }

    _perfEl.innerHTML = lines.join('<br>');
  }

  function showPerf(){
    if (!_perfEl) _build();
    _perfEl.style.display = 'block';
    _startTracking();
    _refresh();
    if (_perfTimer) clearInterval(_perfTimer);
    _perfTimer = setInterval(_refresh, 500);
  }
  function hidePerf(){
    if (_perfEl) _perfEl.style.display = 'none';
    if (_perfTimer) { clearInterval(_perfTimer); _perfTimer = null; }
    _stopTracking();
  }
  function togglePerf(){
    if (_perfEl && _perfEl.style.display === 'block') hidePerf();
    else showPerf();
  }

  // Ctrl+Shift+P — toggle
  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && (e.code === 'KeyP' || e.key === 'P' || e.key === 'p')) {
      e.preventDefault();
      togglePerf();
    }
  });

  window.showPerf = showPerf;
  window.hidePerf = hidePerf;
  window.togglePerf = togglePerf;

  // ?fps URL-param — auto-toggle HUD bij page-load. Werkt op mobile waar
  // F3/Ctrl+Shift+P niet bereikbaar zijn. showPerf() bouwt _perfEl pas op
  // document.body, dus wacht op DOMContentLoaded als die nog niet klaar is.
  if (new URLSearchParams(location.search).has('fps')) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showPerf, { once: true });
    } else {
      showPerf();
    }
  }
})();

// ES module marker — laat esbuild dit bestand als module bundelen. De IIFE
// hierboven blijft het echte werk doen; window.X assigns zijn de public
// surface. Toekomstige migratie kan de IIFE uitkleden en functies expliciet
// exporteren wanneer alle consumers via import gaan.
export {};
