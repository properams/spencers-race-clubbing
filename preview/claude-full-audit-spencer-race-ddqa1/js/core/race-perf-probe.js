// js/core/race-perf-probe.js — instrumentation for the in-game stutter
// diagnose-sessie (Type C, 2026-05-08). Auto-enabled; does not require ?debug.
//
// Goal: collect a 2000-entry forensische log of frame-deltas, stutter-events,
// race-milestones, subsystem-timings, renderer.info snapshots, heap usage,
// and audio-source counts during a full-race run, so root-cause analysis
// can be done from data instead of guesswork.
//
// Independent of js/core/debug.js's 50-entry error ring. Both can coexist.
//
// API (window._rpp):
//   _rpp.enabled                       — true while probe is collecting
//   _rpp.frameEnd(deltaMs, sub)        — called at end of each loop() frame
//   _rpp.mark(name, extras)            — milestone marker (race-events)
//   _rpp.snapshot()                    — current ring buffer + summary
//   _rpp.show()                        — open the textarea overlay
//   _rpp.hide()                        — close the overlay
//   _rpp.clear()                       — flush ring buffer
//   _rpp.installAudioCounter(ctx)      — wrap createBufferSource/createOscillator
//
// Shortcut: Ctrl+Shift+R opens the overlay. (Browsers may intercept this for
// hard-reload; a console fallback `_rpp.show()` is always available.)
//
// Discipline notes:
//  - Probe must not allocate per-frame. Subsystem table is a single reused
//    scratch object filled by loop.js. Stutter / event / heap-snapshot
//    pushes only happen when conditions trigger (rare relative to every
//    frame), so push-allocation is bounded by event-count, not frame-count.
//  - All numbers are rounded to 2 decimals before storage to keep the
//    later JSON dump compact.

'use strict';

(function(){
  // ── Configuration ─────────────────────────────────────────────────────────
  const RING_MAX        = 2000;     // entries — large enough for a 3-lap race
  const STUTTER_MS      = 50;       // frame-delta threshold for "stutter"
  const HEAP_SAMPLE_FR  = 60;       // every N frames, push a heap/draw snapshot
  const GC_CLUSTER_MS   = 30;       // cluster-frame threshold
  const GC_CLUSTER_N    = 3;        // cluster needs >= N frames in 1s
  const GC_CLUSTER_WIN  = 1000;     // window in ms

  // ── Ring buffer ───────────────────────────────────────────────────────────
  // entries shape: { t, kind, ...payload }
  //   kind === 'stutter'  → frame-delta event
  //   kind === 'event'    → race-milestone (named)
  //   kind === 'snapshot' → periodic heap/draw snapshot
  //   kind === 'gc'       → spike-cluster suspected GC window
  //   kind === 'meta'     → session metadata
  const _ring = [];

  // ── Cluster tracking (rolling window of recent stutter timestamps) ───────
  const _clusterTimes = []; // performance.now() of each cluster-grade frame
  let _gcFiredAt = 0;       // last GC-suspect log time (debounce)

  // ── Frame counters ────────────────────────────────────────────────────────
  let _frameSeq = 0;
  let _raceStartT = 0;

  // ── Race-relative time ────────────────────────────────────────────────────
  function _rt(){
    if (_raceStartT === 0) return -1;
    return +((performance.now() - _raceStartT) / 1000).toFixed(3);
  }

  function _push(entry){
    _ring.push(entry);
    if (_ring.length > RING_MAX) _ring.shift();
  }

  // ── Compact integer accessors (avoid optional-chain allocations) ─────────
  function _rendererCalls(){
    const r = window.renderer;
    return (r && r.info) ? r.info.render.calls : 0;
  }
  function _rendererTris(){
    const r = window.renderer;
    return (r && r.info) ? r.info.render.triangles : 0;
  }
  function _rendererPrograms(){
    const r = window.renderer;
    return (r && r.info && r.info.programs) ? r.info.programs.length : 0;
  }
  function _rendererTextures(){
    const r = window.renderer;
    return (r && r.info) ? r.info.memory.textures : 0;
  }
  function _heapMB(){
    const m = performance.memory;
    return m ? +(m.usedJSHeapSize / 1048576).toFixed(2) : 0;
  }
  function _liveAudioSrc(){
    return window._dbgAudioSrc ? window._dbgAudioSrc.live : 0;
  }
  function _startedAudioSrc(){
    return window._dbgAudioSrc ? window._dbgAudioSrc.startedTotal : 0;
  }
  function _playerXZ(){
    const cars = window.carObjs;
    const idx = window.playerIdx;
    if (cars && idx != null && cars[idx] && cars[idx].mesh){
      const p = cars[idx].mesh.position;
      return [+p.x.toFixed(1), +p.z.toFixed(1)];
    }
    return [0, 0];
  }
  function _playerLap(){
    const cars = window.carObjs;
    const idx = window.playerIdx;
    return (cars && idx != null && cars[idx]) ? (cars[idx].lap | 0) : 0;
  }
  function _currentSector(){
    return (typeof window._currentSector === 'number') ? window._currentSector : 0;
  }

  // ── Subsystem-attribution helper ──────────────────────────────────────────
  // Given the per-frame subsystem times object, return the name of the
  // dominant subsystem and its ms.
  function _topSub(sub){
    if (!sub) return null;
    let best = '', max = 0;
    if (sub.physics  > max) { max = sub.physics;  best = 'physics';  }
    if (sub.ai       > max) { max = sub.ai;       best = 'ai';       }
    if (sub.particles> max) { max = sub.particles;best = 'particles';}
    if (sub.audio    > max) { max = sub.audio;    best = 'audio';    }
    if (sub.postfx   > max) { max = sub.postfx;   best = 'postfx';   }
    if (sub.render   > max) { max = sub.render;   best = 'render';   }
    if (sub.world    > max) { max = sub.world;    best = 'world';    }
    if (sub.hud      > max) { max = sub.hud;      best = 'hud';      }
    return best ? { name: best, ms: +max.toFixed(2) } : null;
  }

  // ── Stutter / cluster bookkeeping ─────────────────────────────────────────
  function _trackCluster(now){
    _clusterTimes.push(now);
    while (_clusterTimes.length && now - _clusterTimes[0] > GC_CLUSTER_WIN){
      _clusterTimes.shift();
    }
    if (_clusterTimes.length >= GC_CLUSTER_N && now - _gcFiredAt > GC_CLUSTER_WIN){
      _gcFiredAt = now;
      _push({
        t: _rt(),
        kind: 'gc',
        countInWindow: _clusterTimes.length,
        windowMs: GC_CLUSTER_WIN,
        thresholdMs: GC_CLUSTER_MS,
        heapMB: _heapMB(),
        gameState: window.gameState || '',
        world: window.activeWorld || ''
      });
    }
  }

  // ── frameEnd: called from loop.js at the end of each frame body ──────────
  function frameEnd(deltaMs, sub){
    if (!_rpp.enabled) return;
    _frameSeq++;
    const now = performance.now();
    const dt  = +deltaMs.toFixed(2);

    // Stutter event
    if (deltaMs > STUTTER_MS){
      const top = _topSub(sub);
      const xz  = _playerXZ();
      _push({
        t: _rt(),
        kind: 'stutter',
        deltaMs: dt,
        seq: _frameSeq,
        gameState: window.gameState || '',
        world: window.activeWorld || '',
        lap: _playerLap(),
        sector: _currentSector(),
        x: xz[0],
        z: xz[1],
        topSub: top ? top.name : '',
        topMs:  top ? top.ms : 0,
        sub: sub ? {
          physics:   +sub.physics.toFixed(2),
          ai:        +sub.ai.toFixed(2),
          particles: +sub.particles.toFixed(2),
          audio:     +sub.audio.toFixed(2),
          postfx:    +sub.postfx.toFixed(2),
          render:    +sub.render.toFixed(2),
          world:     +sub.world.toFixed(2),
          hud:       +sub.hud.toFixed(2)
        } : null,
        heapMB: _heapMB(),
        drawCalls: _rendererCalls(),
        programs: _rendererPrograms(),
        textures: _rendererTextures(),
        audioLive: _liveAudioSrc(),
        audioStartedTotal: _startedAudioSrc()
      });
    }

    // Cluster detection (separate threshold; smaller but recurring)
    if (deltaMs > GC_CLUSTER_MS) _trackCluster(now);

    // Periodic snapshot (every HEAP_SAMPLE_FR frames during RACE)
    if (window.gameState === 'RACE' && (_frameSeq % HEAP_SAMPLE_FR) === 0){
      _push({
        t: _rt(),
        kind: 'snapshot',
        seq: _frameSeq,
        world: window.activeWorld || '',
        lap: _playerLap(),
        heapMB: _heapMB(),
        drawCalls: _rendererCalls(),
        triangles: _rendererTris(),
        programs: _rendererPrograms(),
        textures: _rendererTextures(),
        audioLive: _liveAudioSrc(),
        audioStartedTotal: _startedAudioSrc()
      });
    }
  }

  // ── mark: race milestone marker (called from countdown/lap/hazard/etc) ───
  function mark(name, extras){
    if (!_rpp.enabled) return;
    if (name === 'race:init')   _raceStartT = performance.now();
    if (name === 'countdown:GO' && _raceStartT === 0) _raceStartT = performance.now();
    const e = {
      t: _rt(),
      kind: 'event',
      name: String(name || ''),
      gameState: window.gameState || '',
      world: window.activeWorld || '',
      lap: _playerLap(),
      sector: _currentSector(),
      heapMB: _heapMB(),
      drawCalls: _rendererCalls(),
      programs: _rendererPrograms(),
      textures: _rendererTextures(),
      audioLive: _liveAudioSrc(),
      audioStartedTotal: _startedAudioSrc()
    };
    if (extras && typeof extras === 'object'){
      // Flatten one level of extras into the event entry.
      for (const k in extras){
        if (Object.prototype.hasOwnProperty.call(extras, k)) e[k] = extras[k];
      }
    }
    _push(e);
  }

  // ── Audio source counter — install if dbg path didn't already ────────────
  // engine.js installs the wrapper only when dbg.enabled; the probe needs
  // it always-on. Idempotent: if window._dbgAudioSrc already exists, skip.
  function installAudioCounter(ctx){
    if (!ctx) return;
    if (window._dbgAudioSrc) return;
    const _audioSrc = { live: 0, startedTotal: 0, endedTotal: 0 };
    const _wrap = (orig) => function(){
      const node = orig.apply(this, arguments);
      if (!node) return node;
      const _origStart = node.start;
      node.start = function(){
        try {
          _audioSrc.live++; _audioSrc.startedTotal++;
          node.addEventListener('ended', () => {
            _audioSrc.live = Math.max(0, _audioSrc.live - 1);
            _audioSrc.endedTotal++;
          }, { once: true });
        } catch(_){}
        return _origStart.apply(this, arguments);
      };
      return node;
    };
    try {
      ctx.createBufferSource = _wrap(ctx.createBufferSource.bind(ctx));
      ctx.createOscillator   = _wrap(ctx.createOscillator.bind(ctx));
      window._dbgAudioSrc = _audioSrc;
    } catch(_){
      // Already wrapped or context locked — silently ignore.
    }
  }

  // Poll audioCtx briefly after boot — initAudio() runs on first user gesture.
  // The probe waits until audioCtx is available, then installs the counter
  // if dbg has not already done it.
  let _audioPollTries = 0;
  const _audioPoll = () => {
    if (window._dbgAudioSrc) return;
    if (window.audioCtx){ installAudioCounter(window.audioCtx); return; }
    if (++_audioPollTries < 240) setTimeout(_audioPoll, 500); // 2 minutes max
  };
  setTimeout(_audioPoll, 500);

  // ── Public API object ─────────────────────────────────────────────────────
  const _rpp = {
    enabled: true,
    frameEnd: frameEnd,
    mark: mark,
    installAudioCounter: installAudioCounter,
    clear(){ _ring.length = 0; _clusterTimes.length = 0; },
    snapshot(){
      return {
        meta: {
          captured:    new Date().toISOString(),
          raceStartT:  _raceStartT,
          raceRel:     _rt(),
          frameSeq:    _frameSeq,
          ringMax:     RING_MAX,
          ringSize:    _ring.length,
          stutterMs:   STUTTER_MS,
          ua:          navigator.userAgent || '',
          isMobile:    !!window._isMobile,
          isTablet:    !!window._isTablet,
          dpr:         window.devicePixelRatio || 1,
          world:       window.activeWorld || '',
          gameState:   window.gameState || '',
          heapLimitMB: performance.memory ? +(performance.memory.jsHeapSizeLimit / 1048576).toFixed(0) : 0
        },
        entries: _ring.slice()
      };
    },
    show(){ _ensureViewer(); _viewerEl.style.display = 'flex'; _refresh(); },
    hide(){ if (_viewerEl) _viewerEl.style.display = 'none'; }
  };

  // ── Viewer overlay (lazy-built) ──────────────────────────────────────────
  let _viewerEl = null, _viewerTa = null;
  function _ensureViewer(){
    if (_viewerEl) return;
    _viewerEl = document.createElement('div');
    _viewerEl.id = 'racePerfViewer';
    _viewerEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.94);z-index:99999;display:none;flex-direction:column;font-family:monospace;font-size:11px;color:#cdf;padding:14px;overflow:hidden';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #235';
    const title = document.createElement('div');
    title.style.cssText = 'flex:1;font-weight:bold;color:#7df;letter-spacing:2px';
    title.textContent = 'RACE-PERF PROBE';
    const sumEl = document.createElement('div');
    sumEl.id = 'rppSummary';
    sumEl.style.cssText = 'color:#9bd;font-size:10px;margin-right:10px';

    const btnCopy  = _mkBtn('COPY',  () => _copy());
    const btnClear = _mkBtn('CLEAR', () => { _rpp.clear(); _refresh(); });
    const btnClose = _mkBtn('CLOSE', () => { _viewerEl.style.display = 'none'; });

    head.appendChild(title); head.appendChild(sumEl);
    head.appendChild(btnCopy); head.appendChild(btnClear); head.appendChild(btnClose);

    _viewerTa = document.createElement('textarea');
    _viewerTa.readOnly = true;
    _viewerTa.style.cssText = 'flex:1;background:#06080c;color:#cdf;border:1px solid #234;border-radius:4px;padding:10px;font-family:monospace;font-size:10px;line-height:1.45;resize:none;white-space:pre;outline:none';

    _viewerEl.appendChild(head); _viewerEl.appendChild(_viewerTa);
    document.body.appendChild(_viewerEl);

    _viewerEl._sumEl = sumEl;
  }
  function _mkBtn(label, onClick){
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#123;border:1px solid #245;color:#9cf;padding:6px 12px;border-radius:4px;cursor:pointer;font-family:monospace;font-size:11px;letter-spacing:1px';
    b.addEventListener('click', onClick);
    b.addEventListener('mouseenter', () => b.style.background = '#234');
    b.addEventListener('mouseleave', () => b.style.background = '#123');
    return b;
  }
  function _refresh(){
    if (!_viewerTa) return;
    const snap = _rpp.snapshot();
    const meta = snap.meta;

    // Summarise stutters: count, max delta, p50/p95/p99, top-5 worst.
    let stutterN = 0, evN = 0, snapN = 0, gcN = 0;
    let maxDt = 0;
    const dts = [];
    for (const e of snap.entries){
      if (e.kind === 'stutter'){ stutterN++; dts.push(e.deltaMs); if (e.deltaMs > maxDt) maxDt = e.deltaMs; }
      else if (e.kind === 'event')    evN++;
      else if (e.kind === 'snapshot') snapN++;
      else if (e.kind === 'gc')       gcN++;
    }
    dts.sort((a,b) => a-b);
    const pct = p => dts.length ? +dts[Math.min(dts.length-1, Math.floor(dts.length*p))].toFixed(1) : 0;
    const sumLine =
      `world=${meta.world} state=${meta.gameState} race=${meta.raceRel}s · ` +
      `entries=${meta.ringSize}/${meta.ringMax} · ` +
      `stutters=${stutterN} (max ${maxDt.toFixed(1)}ms p95 ${pct(0.95)} p99 ${pct(0.99)}) · ` +
      `events=${evN} snap=${snapN} gc=${gcN}`;

    _viewerEl._sumEl.textContent = sumLine;

    // Body: JSON-Lines for easy paste-into-text-channel
    const lines = [
      '# RACE-PERF PROBE — paste this into chat',
      '# meta: ' + JSON.stringify(meta),
      ''
    ];
    for (const e of snap.entries) lines.push(JSON.stringify(e));
    _viewerTa.value = lines.join('\n');
  }
  function _copy(){
    if (!_viewerTa) return;
    const txt = _viewerTa.value;
    const fail = () => alert('Copy failed — select-all in the textarea + Ctrl+C/⌘+C');
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(
        () => { /* noop */ },
        fail
      );
    } else {
      try {
        _viewerTa.select();
        const ok = document.execCommand && document.execCommand('copy');
        if (!ok) fail();
      } catch(_){ fail(); }
    }
  }

  // ── Keyboard shortcut: Ctrl+Shift+R ──────────────────────────────────────
  // NOTE: Ctrl+Shift+R is hard-reload in many browsers and may not be
  // preventable by JS. The console fallback `_rpp.show()` is always
  // available. Document this in the diagnostic markdown.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.code === 'KeyR' || e.key === 'R' || e.key === 'r')){
      e.preventDefault();
      e.stopPropagation();
      if (_viewerEl && _viewerEl.style.display !== 'none') _rpp.hide();
      else _rpp.show();
    }
  }, true); // capture-phase to beat browser default where possible

  // ── Expose ────────────────────────────────────────────────────────────────
  window._rpp = _rpp;
  window._racePerfBuffer = _ring; // raw access per the prompt's spec

  // Boot meta entry
  _push({
    t: 0,
    kind: 'meta',
    msg: 'race-perf probe boot',
    ua: navigator.userAgent || '',
    isMobile: !!window._isMobile,
    isTablet: !!window._isTablet,
    dpr: window.devicePixelRatio || 1
  });
})();

// ES module marker.
export {};
