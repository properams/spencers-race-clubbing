// js/core/debug.js — debug-harness + opt-in visual badge.
// Non-module script. Geladen vóór alle subsystemen behalve config/device.
//
// Drie laagjes:
//   1. window.dbg — gestructureerde logger + error-ringbuffer (altijd beschikbaar).
//      Logger is no-op tenzij dbg.enabled (URL ?debug of localStorage src_debug=1).
//      Errors worden ALTIJD gecaptured (ook in productie) zodat je later
//      via dbg.errors() de laatste 50 fouten kunt ophalen.
//   2. ?debug-only badge — bestaande floating overlay met camera/renderer state.
//   3. Error-viewer overlay — Ctrl+Shift+E (of dbg.showErrors() in console)
//      toont alle errors uit de ringbuffer in een full-screen panel met
//      Copy/Clear knoppen. Werkt ook zonder dbg-enabled — handig voor
//      productie-incident-rapportage.
//
// Activeren in productie zonder URL-wijziging:
//   localStorage.setItem('src_debug','1'); location.reload();
// Of channels filteren:
//   localStorage.setItem('src_debug_channels','pause,camera,renderer');
// Errors bekijken:
//   Ctrl+Shift+E      (overal in de game)
//   dbg.showErrors()  (vanuit devtools-console)

'use strict';

(function(){
  const URL_FLAG = new URLSearchParams(location.search).has('debug');
  let LS_FLAG = false, CHANNEL_FILTER = null;
  try {
    LS_FLAG = localStorage.getItem('src_debug') === '1';
    const ch = localStorage.getItem('src_debug_channels');
    if (ch) CHANNEL_FILTER = new Set(ch.split(',').map(s => s.trim()).filter(Boolean));
  } catch (_) { /* localStorage kan blocked zijn */ }
  const ENABLED = URL_FLAG || LS_FLAG;

  const T0 = performance.now();
  const ts = () => ((performance.now() - T0) / 1000).toFixed(3);

  const ERR_RING_MAX = 50;
  const errRing = [];

  // ── Persistent error capture (cross-session) ─────────────────────────
  // Errors die de tab-crash overleven: gemirrored naar localStorage.
  // Bedoeld voor mobile waar ringbuffer + console-log verloren gaan bij
  // een browser-tab kill (iOS Chrome doet dat agressief bij OOM/JS-error).
  // Cap is 30 entries, oudste eerst. 7-day TTL — stale entries worden
  // bij volgende boot weggegooid.
  const PERSIST_KEY = 'src_persisted_errors';
  const PERSIST_MAX = 30;
  const PERSIST_TTL_MS = 7 * 24 * 3600 * 1000;
  // Korte session-id zodat we kunnen zien welke errors van welke run zijn.
  const SESSION_ID = (Math.random().toString(36).slice(2, 8) + '-' +
                      Date.now().toString(36).slice(-4));
  let _persistedSeen = []; // entries from previous sessions, lazy-loaded
  function _persistError(entry) {
    try {
      let cur = [];
      const raw = localStorage.getItem(PERSIST_KEY);
      if (raw) { try { cur = JSON.parse(raw) || []; } catch (_) { cur = []; } }
      cur.push({
        t: entry.t,
        kind: entry.kind,
        msg: entry.msg,
        extra: entry.extra || null,
        sid: SESSION_ID,
        wt: Date.now()
      });
      if (cur.length > PERSIST_MAX) cur = cur.slice(-PERSIST_MAX);
      localStorage.setItem(PERSIST_KEY, JSON.stringify(cur));
    } catch (_) { /* private-mode / quota — silently drop persistence */ }
  }
  function _loadPersistedErrors() {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      const now = Date.now();
      const fresh = arr.filter(e => e && typeof e === 'object'
                                 && (now - (e.wt || 0)) < PERSIST_TTL_MS
                                 && e.sid !== SESSION_ID);  // skip current-session
      // Prune stale entries back to storage if we filtered any out.
      if (fresh.length !== arr.length) {
        try { localStorage.setItem(PERSIST_KEY, JSON.stringify(fresh)); } catch (_) {}
      }
      return fresh;
    } catch (_) { return []; }
  }
  function _clearPersistedErrors() {
    try { localStorage.removeItem(PERSIST_KEY); } catch (_) {}
    _persistedSeen.length = 0;
  }

  function pushErr(kind, msg, extra) {
    const entry = { t: ts(), kind, msg: String(msg || ''), extra: extra || null };
    errRing.push(entry);
    if (errRing.length > ERR_RING_MAX) errRing.shift();
    _persistError(entry);
    return entry;
  }

  function shouldLog(channel) {
    if (!ENABLED) return false;
    if (!CHANNEL_FILTER) return true;
    return CHANNEL_FILTER.has(channel);
  }

  const dbg = {
    enabled: ENABLED,
    urlFlag: URL_FLAG,
    lsFlag: LS_FLAG,
    channelFilter: CHANNEL_FILTER ? [...CHANNEL_FILTER] : null,

    log(channel, ...args) {
      if (!shouldLog(channel)) return;
      console.log('[' + ts() + '][' + channel + ']', ...args);
    },

    warn(channel, ...args) {
      if (!shouldLog(channel)) return;
      console.warn('[' + ts() + '][' + channel + ']', ...args);
    },

    error(channel, err, extra) {
      const entry = pushErr(channel, err && err.message ? err.message : err, extra);
      console.error('[' + ts() + '][' + channel + ']', err, extra || '');
      return entry;
    },

    snapshot(channel, label, obj) {
      if (!shouldLog(channel)) return;
      try {
        const flat = {};
        for (const k of Object.keys(obj || {})) {
          const v = obj[k];
          flat[k] = (v && typeof v === 'object' && 'x' in v && 'y' in v && 'z' in v)
            ? '(' + v.x.toFixed(2) + ',' + v.y.toFixed(2) + ',' + v.z.toFixed(2) + ')'
            : v;
        }
        console.log('[' + ts() + '][' + channel + ']', label, flat);
      } catch (e) {
        console.log('[' + ts() + '][' + channel + ']', label, '(snapshot failed)', e);
      }
    },

    group(channel, label, fn) {
      if (!shouldLog(channel)) { try { fn(); } catch (e) { dbg.error(channel, e); } return; }
      console.group('[' + ts() + '][' + channel + '] ' + label);
      try { fn(); } catch (e) { dbg.error(channel, e); } finally { console.groupEnd(); }
    },

    errors() { return errRing.slice(); },
    clearErrors() {
      errRing.length = 0;
      _clearPersistedErrors();
      if (window._dbgViewer) window._dbgViewer.refresh();
    },
    persistedErrors() { return _persistedSeen.slice(); },

    showErrors() { _ensureViewer(); _viewerEl.style.display = 'flex'; _viewerRefresh(); },
    hideErrors() { if (_viewerEl) _viewerEl.style.display = 'none'; },

    // ── Performance audit primitives (alleen actief als dbg.enabled) ─────
    // measure(channel,label,fn): roept fn aan, meet wallclock-tijd, push naar
    // measureRing. measureAsync idem voor async functies. Geen overhead als
    // dbg.enabled false is — dan gewoon fn() pass-through.
    measure(channel, label, fn) {
      if (!ENABLED) return fn();
      const t0 = performance.now();
      try { return fn(); }
      finally {
        const dur = performance.now() - t0;
        _measureRing.push({ t: ts(), ch: channel, label, dur });
        if (_measureRing.length > MEASURE_RING_MAX) _measureRing.shift();
        if (dur > 16) console.log('[' + ts() + '][' + channel + '] ' + label + ' = ' + dur.toFixed(2) + 'ms');
      }
    },
    measureAsync(channel, label, fn) {
      if (!ENABLED) return fn();
      const t0 = performance.now();
      return Promise.resolve().then(fn).finally(() => {
        const dur = performance.now() - t0;
        _measureRing.push({ t: ts(), ch: channel, label, dur });
        if (_measureRing.length > MEASURE_RING_MAX) _measureRing.shift();
        if (dur > 16) console.log('[' + ts() + '][' + channel + '] ' + label + ' = ' + dur.toFixed(2) + 'ms');
      });
    },
    measures() { return _measureRing.slice(); },
    clearMeasures() { _measureRing.length = 0; },

    // markRaceEvent(name): snapshot van heap, renderer.info, audio-state op
    // exact dit moment. Bedoeld voor de 4 race-start punten (CD-START, GO,
    // GO+1s, GO+3s). Pusht naar _raceEventRing (max 32). Console-log altijd
    // als dbg.enabled.
    markRaceEvent(name, extras) {
      if (!ENABLED) return null;
      const e = _captureRaceEventSnapshot(name, extras || {});
      _raceEventRing.push(e);
      if (_raceEventRing.length > RACE_EVENT_RING_MAX) _raceEventRing.shift();
      console.log('[' + ts() + '][raceEvent] ' + name, e);
      return e;
    },
    raceEvents() { return _raceEventRing.slice(); },
    clearRaceEvents() { _raceEventRing.length = 0; },

    // spikes(): returns the last 20 frame-time spikes >50ms with context.
    // Spike detector wordt automatisch gestart in production-loop wanneer
    // dbg.enabled true is (zie _startSpikeDetector hieronder).
    spikes() { return _spikeRing.slice(); },
    clearSpikes() { _spikeRing.length = 0; },

    // longTasks(): main-thread blocks >50ms tijdens boot/menu/build/post-boot
    // gevangen via PerformanceObserver('longtask'). Vult de blinde vlek die
    // de spike-detector heeft (die start pas zinvol in raceloop rAF).
    // Observer draait alleen onder dbg.enabled — productie-overhead = 0.
    // Blijft doorlopen ná menu:interactive om post-boot nasleep te vangen.
    longTasks() { return _longTaskRing.slice(); },
    clearLongTasks() { _longTaskRing.length = 0; },

    // ── loadperf: lifecycle-laadtimeline ────────────────────────────────
    // Bouwt één geordende timeline uit window.perfLog (measures, heap-,
    // programs- en loadperf.*-entries) + de fase-boundary performance.marks
    // die géén perfLog-entry produceren (bare perfMark). Sorteert op tijd,
    // berekent delta t.o.v. vorige rij. Werkt ook zonder dbg.enabled — de
    // data wordt altijd verzameld (perfMark/perfLog zijn always-on). Bedoeld
    // voor eigenaar-meting op echte hardware: enable dbg, doorloop de flow,
    // Ctrl+Shift+E → LOAD TIMELINE → screenshot. Returnt de rij-array.
    loadReport() { return _buildLoadTimeline(); },
  };

  // ── Performance audit ringbuffers + snapshot helper ──────────────────
  const MEASURE_RING_MAX = 100;
  const RACE_EVENT_RING_MAX = 32;
  const SPIKE_RING_MAX = 20;
  const LONGTASK_RING_MAX = 50;
  const _measureRing = [];
  const _raceEventRing = [];
  const _spikeRing = [];
  const _longTaskRing = [];

  function _captureRaceEventSnapshot(name, extras) {
    const snap = {
      t: ts(),
      name: name,
      now: performance.now(),
      gameState: window.gameState,
      activeWorld: window.activeWorld,
    };
    if (performance.memory) {
      snap.heapMB = +(performance.memory.usedJSHeapSize / 1048576).toFixed(2);
      snap.heapLimitMB = +(performance.memory.jsHeapSizeLimit / 1048576).toFixed(0);
    }
    if (window.renderer && window.renderer.info) {
      const r = window.renderer.info;
      snap.drawCalls = r.render.calls;
      snap.triangles = r.render.triangles;
      snap.programs = (r.programs && r.programs.length) || 0;
      snap.geometries = r.memory.geometries;
      snap.textures = r.memory.textures;
    }
    if (window.audioCtx) {
      snap.audioState = window.audioCtx.state;
      snap.audioTime = +window.audioCtx.currentTime.toFixed(3);
    }
    if (window.MusicLib) snap.oscCount = window.MusicLib._oscCount;
    if (window._dbgAudioSrc) {
      snap.liveAudioSrc = window._dbgAudioSrc.live;
      snap.startedTotal = window._dbgAudioSrc.startedTotal;
    }
    snap.engineInit = !!window.engineGain;
    snap.musicSchedKind = window.musicSched
      ? (window.musicSched.constructor.name + '(' + (window.musicSched.style || '') + ')')
      : 'none';
    snap.weatherMode = window._weatherMode;
    snap.fxEnabled = !!(window._postfx && window._postfx.enabled);
    Object.assign(snap, extras);
    return snap;
  }

  // ── Spike detector: permanent rAF chain wanneer dbg.enabled ──────────
  // Detecteert frame-times >50ms en logt met context (gameState, world,
  // music-sched class, weather mode, recent SFX). Onafhankelijk van de
  // perf.js overlay zodat-ie altijd meet zolang dbg aanstaat.
  let _spikeLast = 0, _spikeRafId = null;
  function _spikeTick(now) {
    if (_spikeLast > 0) {
      const dt = now - _spikeLast;
      if (dt > 50) {
        const ctx = {
          t: ts(),
          dt: +dt.toFixed(2),
          gameState: window.gameState,
          activeWorld: window.activeWorld,
          finalLap: !!(window.musicSched && window.musicSched.finalLap),
          weatherMode: window._weatherMode,
        };
        if (window.renderer && window.renderer.info) {
          ctx.drawCalls = window.renderer.info.render.calls;
          ctx.programs = (window.renderer.info.programs && window.renderer.info.programs.length) || 0;
          ctx.textures = window.renderer.info.memory.textures;
        }
        if (window.MusicLib) ctx.oscCount = window.MusicLib._oscCount;
        if (window._dbgAudioSrc) ctx.liveAudioSrc = window._dbgAudioSrc.live;
        _spikeRing.push(ctx);
        if (_spikeRing.length > SPIKE_RING_MAX) _spikeRing.shift();
        console.warn('[' + ts() + '][spike] ' + dt.toFixed(1) + 'ms', ctx);
      }
    }
    _spikeLast = now;
    _spikeRafId = requestAnimationFrame(_spikeTick);
  }
  function _startSpikeDetector() {
    if (_spikeRafId !== null) return;
    _spikeLast = 0;
    _spikeRafId = requestAnimationFrame(_spikeTick);
  }
  if (ENABLED) _startSpikeDetector();

  // ── Cold-start longtask observer (channel: coldstart) ────────────────
  // Vangt elke main-thread blocking >50ms via PerformanceObserver('longtask').
  // Werkt op Chromium-based browsers; Firefox/Safari ondersteunen 'longtask'
  // niet — daar wordt silent ge-no-op (feature-detect via supportedEntryTypes).
  // Observer wordt NIET disconnect na menu:interactive: de eerste 10-15s ná
  // boot bevat vaak nasleep (lazy preload, shader-warmup, GC) die we óók
  // willen zien. Ringbuffer-cap (50) bounded vanzelf bij lange sessies.
  function _findRecentMark(t) {
    try {
      const log = window.perfLog;
      if (!log || !log.length) return null;
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].t <= t) return log[i].name;
      }
      return null;
    } catch (_) { return null; }
  }
  let _longTaskObserver = null;
  function _startLongTaskObserver() {
    if (_longTaskObserver) return;
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const types = PerformanceObserver.supportedEntryTypes;
      if (!types || types.indexOf('longtask') < 0) return;
    } catch (_) { return; }
    try {
      _longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const att = (entry.attribution && entry.attribution[0]) || null;
          const rec = {
            t: ts(),
            startTime: +entry.startTime.toFixed(1),
            dur: +entry.duration.toFixed(1),
            name: entry.name || 'self',
            attribution: att ? (att.name || att.containerType || 'unknown') : null,
            nearestMark: _findRecentMark(entry.startTime),
            gameState: window.gameState,
            activeWorld: window.activeWorld,
          };
          _longTaskRing.push(rec);
          if (_longTaskRing.length > LONGTASK_RING_MAX) _longTaskRing.shift();
          if (shouldLog('coldstart')) {
            console.warn('[' + ts() + '][coldstart][longtask] ' + rec.dur +
              'ms near ' + (rec.nearestMark || '(no mark)'), rec);
          }
        }
      });
      // buffered:true geeft entries van vóór observer-init terug (Chrome).
      _longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch (e) {
      _longTaskObserver = null;
      // silent: geen toast voor instrumentatie-failures
    }
  }
  if (ENABLED) _startLongTaskObserver();

  // ── Error-viewer overlay (lazy-built op eerste open) ─────────────────
  let _viewerEl = null, _viewerList = null, _viewerToast = null;
  function _ensureViewer() {
    if (_viewerEl) return;
    _viewerEl = document.createElement('div');
    _viewerEl.id = 'dbgErrorViewer';
    _viewerEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:99999;display:none;flex-direction:column;font-family:monospace;font-size:12px;color:#eee;padding:20px;overflow:hidden';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:12px;border-bottom:1px solid #333;padding-bottom:10px';
    const title = document.createElement('div');
    title.style.cssText = 'flex:1;font-weight:bold;color:#ff6644;letter-spacing:2px';
    title.textContent = '⚠ DEBUG ERRORS';
    const btnCopy = _mkBtn('📋 COPY', () => {
      const txt = errRing.map(e => `[${e.t}s][${e.kind}] ${e.msg}` +
        (e.extra ? ' ' + JSON.stringify(e.extra) : '')).join('\n');
      // navigator.clipboard.writeText is async; sync try/catch vangt geen Promise-rejection.
      // Daarnaast: niet beschikbaar op insecure contexts of in oudere browsers.
      const fail = () => { btnCopy.textContent = '⚠ FAILED'; setTimeout(()=>btnCopy.textContent='📋 COPY',1500); };
      const ok = () => { btnCopy.textContent = '✓ COPIED'; setTimeout(()=>btnCopy.textContent='📋 COPY',1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(ok, fail);
      } else {
        // Fallback: textarea + execCommand (deprecated maar werkt op insecure contexts)
        try {
          const ta = document.createElement('textarea');
          ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          const success = document.execCommand && document.execCommand('copy');
          ta.remove();
          success ? ok() : fail();
        } catch (_) { fail(); }
      }
    });
    const btnClear = _mkBtn('🗑 CLEAR', () => { dbg.clearErrors(); _viewerRefresh(); });
    const btnLoad = _mkBtn('📊 LOAD TIMELINE', () => {
      title.textContent = '📊 LOAD TIMELINE';
      if (_viewerList) _viewerList.innerHTML = _renderLoadTimelineHTML();
    });
    const btnErrors = _mkBtn('⚠ ERRORS', () => {
      title.textContent = '⚠ DEBUG ERRORS';
      _viewerRefresh();
    });
    const btnClose = _mkBtn('✕ CLOSE', () => { _viewerEl.style.display = 'none'; });
    head.appendChild(title); head.appendChild(btnLoad); head.appendChild(btnErrors); head.appendChild(btnCopy); head.appendChild(btnClear); head.appendChild(btnClose);
    _viewerList = document.createElement('div');
    _viewerList.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a0a;padding:12px;border-radius:4px;line-height:1.6';
    _viewerEl.appendChild(head); _viewerEl.appendChild(_viewerList);
    document.body.appendChild(_viewerEl);
  }
  function _mkBtn(label, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#222;border:1px solid #444;color:#ccc;padding:6px 12px;border-radius:4px;cursor:pointer;font-family:monospace;font-size:11px;letter-spacing:1px';
    b.addEventListener('click', onClick);
    b.addEventListener('mouseenter', () => b.style.background = '#333');
    b.addEventListener('mouseleave', () => b.style.background = '#222');
    return b;
  }
  function _viewerRefresh() {
    if (!_viewerList) return;
    if (errRing.length === 0) {
      _viewerList.innerHTML = '<div style="color:#666;font-style:italic;padding:20px;text-align:center">Geen errors gecaptured deze sessie. ✓</div>';
      return;
    }
    _viewerList.innerHTML = errRing.slice().reverse().map(e => {
      const extra = e.extra ? '<div style="color:#888;margin-left:20px;margin-top:2px;font-size:11px">' + _esc(JSON.stringify(e.extra)) + '</div>' : '';
      return '<div style="border-left:3px solid #ff6644;padding:6px 10px;margin-bottom:6px;background:rgba(255,80,40,.06)">' +
             '<div style="color:#ff9966">[' + e.t + 's] [' + _esc(e.kind) + ']</div>' +
             '<div style="color:#fff;margin-top:2px">' + _esc(e.msg) + '</div>' +
             extra + '</div>';
    }).join('');
  }
  function _esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  // Maakt refresh extern aanroepbaar zodat clearErrors() de viewer kan vernieuwen.
  window._dbgViewer = { refresh: _viewerRefresh };

  // ── Auto-toast bij nieuwe error (alleen als dbg enabled) ─────────────
  function _showToast(entry) {
    if (!ENABLED) return; // productie: silent in ringbuffer
    if (!_viewerToast) {
      _viewerToast = document.createElement('div');
      _viewerToast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:rgba(180,40,20,.92);color:#fff;font-family:monospace;font-size:11px;padding:10px 14px;border-radius:6px;z-index:99998;max-width:340px;box-shadow:0 4px 16px rgba(0,0,0,.5);cursor:pointer;line-height:1.4;border-left:3px solid #ff8866';
      _viewerToast.title = 'Klik voor details (Ctrl+Shift+E)';
      _viewerToast.addEventListener('click', () => dbg.showErrors());
      document.body.appendChild(_viewerToast);
    }
    _viewerToast.innerHTML = '⚠ <b>[' + _esc(entry.kind) + ']</b><br>' + _esc(entry.msg.slice(0, 140));
    _viewerToast.style.display = 'block';
    _viewerToast.style.opacity = '1';
    clearTimeout(_viewerToast._t);
    _viewerToast._t = setTimeout(() => {
      _viewerToast.style.transition = 'opacity .4s';
      _viewerToast.style.opacity = '0';
      setTimeout(() => { _viewerToast.style.display = 'none'; _viewerToast.style.transition = ''; }, 400);
    }, 4500);
  }

  // Wrap pushErr om toast te triggeren
  const _origPushErr = pushErr;
  pushErr = function(kind, msg, extra) {
    const entry = _origPushErr(kind, msg, extra);
    if (_viewerEl && _viewerEl.style.display !== 'none') _viewerRefresh();
    _showToast(entry);
    return entry;
  };

  // Globale fout-handlers — vangen scripts die anders stilletjes falen.
  window.addEventListener('error', (e) => {
    pushErr('window.error', e.message, { src: e.filename, line: e.lineno, col: e.colno });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    pushErr('unhandledrejection', r && r.message ? r.message : String(r), null);
  });

  // ── Keyboard shortcut: Ctrl+Shift+E toggle ───────────────────────────
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.code === 'KeyE' || e.key === 'E' || e.key === 'e')) {
      e.preventDefault();
      if (_viewerEl && _viewerEl.style.display !== 'none') dbg.hideErrors();
      else dbg.showErrors();
    }
  });

  window.dbg = dbg;
  // Pick up scene.js' compile-breakdown helper als die er al is. Scene.js
  // attacht 'm tijdens script-init wanneer window.dbg nog niet bestaat
  // (dbg laadt lazy onder ?dev=1), dus de alias-set in scene.js mist
  // — debug.js handelt het hier op.
  if (typeof window._dumpCompileBreakdown === 'function') dbg.dumpCompileBreakdown = window._dumpCompileBreakdown;
  if (typeof window._dumpMaterialDups === 'function') dbg.dumpMaterialDups = window._dumpMaterialDups;
  if (typeof window._matTraceStatus === 'function') dbg.matTraceStatus = window._matTraceStatus;
  if (window._sharedMat && typeof window._sharedMat.dump === 'function') dbg.dumpSharedMatCache = window._sharedMat.dump;
  if (ENABLED) {
    console.log('[dbg] enabled (url=' + URL_FLAG + ' ls=' + LS_FLAG + ')' +
      (CHANNEL_FILTER ? ' channels=[' + [...CHANNEL_FILTER].join(',') + ']' : ' all channels') +
      ' — Ctrl+Shift+E voor error-viewer');
  }

  // ── Load previous-session persisted errors (always — also without dbg
  // enabled — zodat een tab-crash de volgende session zichtbaar wordt).
  // Toont een kleine tap-vriendelijke badge in de URL ?showcrash=1, OF
  // wanneer ?debug actief is, OF wanneer src_show_crash localStorage flag
  // is gezet. Op mobile is Ctrl+Shift+E er niet — de badge is de toegang.
  _persistedSeen = _loadPersistedErrors();
  if (_persistedSeen.length > 0) {
    // Voeg ze toe aan de in-memory ring zodat de viewer ze toont.
    for (const e of _persistedSeen) {
      errRing.push({
        t: '(prev) ' + e.t,
        kind: '[' + (e.sid || '?') + '] ' + e.kind,
        msg: e.msg,
        extra: e.extra
      });
    }
    if (errRing.length > ERR_RING_MAX) errRing.splice(0, errRing.length - ERR_RING_MAX);

    // Voorwaarden voor automatische zichtbaarheid:
    //  - ?showcrash=1 in URL: altijd tonen
    //  - ?debug in URL of src_debug=1 in localStorage: tonen
    //  - localStorage src_show_crash=1: tonen
    let showBadge = false;
    try {
      if (new URLSearchParams(location.search).has('showcrash')) showBadge = true;
      if (URL_FLAG || LS_FLAG) showBadge = true;
      if (localStorage.getItem('src_show_crash') === '1') showBadge = true;
    } catch (_) {}

    if (showBadge) {
      // Lazy-build kleine badge die rechtsboven verschijnt en op tap de
      // viewer opent. Geen styling-conflict met game-HUD: position fixed +
      // z-index hoger dan de meeste game-overlays.
      const _showCrashBadge = () => {
        if (document.getElementById('dbgCrashBadge')) return;
        const b = document.createElement('div');
        b.id = 'dbgCrashBadge';
        b.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(180,40,20,.95);color:#fff;font-family:monospace;font-size:11px;padding:8px 12px;border-radius:8px;z-index:99997;cursor:pointer;letter-spacing:1px;box-shadow:0 4px 12px rgba(0,0,0,.5);border-left:3px solid #ff8866;max-width:240px;line-height:1.3';
        b.innerHTML = '⚠ ' + _persistedSeen.length + ' errors from prev session<br><span style="font-size:9px;opacity:.7">tap voor details</span>';
        b.addEventListener('click', () => { dbg.showErrors(); });
        document.body.appendChild(b);
      };
      if (document.body) _showCrashBadge();
      else document.addEventListener('DOMContentLoaded', _showCrashBadge);
    }

    // Console-log in alle gevallen zodat remote-inspect ze ook ziet.
    console.warn('[dbg] ' + _persistedSeen.length + ' persisted errors from previous session(s) — dbg.persistedErrors() of dbg.showErrors()');
  }

  // ── Perf Phase A: lichtgewicht performance.mark/measure helpers ──────
  // Altijd actief (ook zonder dbg.enabled) zodat tools/perf-run.mjs
  // window.perfLog kan uitlezen na een headless run. Push-cap op 500.
  window.perfLog = window.perfLog || [];
  window.perfMark = (label) => { try { performance.mark(label); } catch (e) {} };
  // loadperf: push een named meting (ms + optionele extra-velden) naar
  // perfLog. Near-zero kost, always-on (rijdt mee op de bestaande perfLog-
  // ring). Gebruikt door env-baker/scene/navigation voor PMREM-duur en
  // programs-count rond de twee precompile-grenzen. Console-echo alleen
  // onder dbg-channel 'loadperf'.
  window._loadPerf = (name, ms, extra) => {
    try {
      if (!window.perfLog) return;
      const e = { name: 'loadperf.' + name, ms: (typeof ms === 'number' ? ms : 0), t: performance.now() };
      if (extra) Object.assign(e, extra);
      window.perfLog.push(e);
      if (window.perfLog.length > 500) window.perfLog.shift();
      if (window.dbg) dbg.log('loadperf', name + (typeof ms === 'number' ? ' = ' + ms.toFixed(1) + 'ms' : ''), extra || '');
    } catch (_) {}
  };

  // Fase-boundary marks die géén perfLog-entry produceren (bare perfMark):
  // alleen deze worden naast de perfLog-entries in de timeline opgenomen,
  // zodat build:*/goToRace:* (die al als measure in perfLog staan) niet
  // dubbel verschijnen.
  const _PHASE_MARK_RE = /^(boot:start|menu:interactive|go:fired|go:firstFrame|loadperf:)/;
  function _buildLoadTimeline() {
    const rows = [];
    try {
      const marks = performance.getEntriesByType ? performance.getEntriesByType('mark') : [];
      for (const m of marks) {
        if (_PHASE_MARK_RE.test(m.name)) rows.push({ t: m.startTime, name: m.name, ms: null });
      }
    } catch (_) {}
    const pl = window.perfLog || [];
    for (const e of pl) {
      const r = { t: e.t, name: e.name, ms: (typeof e.ms === 'number' ? e.ms : null) };
      // extra-velden (res/path/programs/world/geometries/textures) meedragen.
      for (const k of Object.keys(e)) { if (k !== 't' && k !== 'name' && k !== 'ms') r[k] = e[k]; }
      rows.push(r);
    }
    rows.sort((a, b) => a.t - b.t);
    let prev = null;
    const out = rows.map(r => {
      const delta = prev != null ? (r.t - prev) : 0;
      prev = r.t;
      const o = { t: +r.t.toFixed(1), dMs: +delta.toFixed(1), name: r.name, dur: (r.ms != null ? +r.ms.toFixed(1) : '') };
      for (const k of Object.keys(r)) { if (k !== 't' && k !== 'name' && k !== 'ms') o[k] = r[k]; }
      return o;
    });
    try { console.table(out); } catch (_) { console.log(out); }
    return out;
  }
  function _renderLoadTimelineHTML() {
    const out = _buildLoadTimeline();
    if (!out.length) {
      return '<div style="color:#666;font-style:italic;padding:20px;text-align:center">Geen loadperf-data. Doorloop boot → car-select → race en open opnieuw.</div>';
    }
    const head = '<div style="display:flex;gap:8px;color:#66ccff;border-bottom:1px solid #234;padding:4px 0;font-weight:bold">' +
      '<span style="width:64px">t (ms)</span><span style="width:64px">+Δms</span><span style="flex:1">phase / event</span><span style="width:80px">dur ms</span><span style="flex:1">extra</span></div>';
    const body = out.map(r => {
      const extra = Object.keys(r).filter(k => k !== 't' && k !== 'dMs' && k !== 'name' && k !== 'dur')
        .map(k => k + ':' + r[k]).join('  ');
      const hot = (typeof r.dur === 'number' && r.dur > 16) ? 'color:#ffaa66' : 'color:#cfe';
      return '<div style="display:flex;gap:8px;padding:2px 0;border-bottom:1px solid #1a1a1a">' +
        '<span style="width:64px;color:#888">' + r.t + '</span>' +
        '<span style="width:64px;color:#7a9">' + r.dMs + '</span>' +
        '<span style="flex:1;' + hot + '">' + _esc(r.name) + '</span>' +
        '<span style="width:80px;color:#ffaa66">' + (r.dur === '' ? '' : r.dur) + '</span>' +
        '<span style="flex:1;color:#889">' + _esc(extra) + '</span></div>';
    }).join('');
    return '<div style="font-size:11px">' + head + body + '</div>';
  }
  window.perfMeasure = (name, startLabel, endLabel) => {
    try {
      performance.measure(name, startLabel, endLabel);
      const entries = performance.getEntriesByName(name, 'measure');
      const last = entries[entries.length - 1];
      if (last) {
        window.perfLog.push({ name, ms: last.duration, t: performance.now() });
        if (window.perfLog.length > 500) window.perfLog.shift();
        if (window.dbg) dbg.log('perf', `${name}: ${last.duration.toFixed(1)}ms`);
      }
      return last ? last.duration : null;
    } catch (e) { return null; }
  };
})();

// ── Bestaande visual badge (alleen ?debug in URL) ────────────────────────
if(new URLSearchParams(location.search).has('debug')){
  const dbgEl=document.createElement('div');
  dbgEl.id='debugBadge';
  dbgEl.style.cssText='position:fixed;top:8px;right:8px;font-family:monospace;font-size:11px;color:#fff;background:rgba(0,0,0,.78);padding:6px 10px;border-radius:6px;z-index:var(--z-critical);pointer-events:none;max-width:260px;line-height:1.4;white-space:pre';
  document.body.appendChild(dbgEl);
  window._updateDebugBadge=function(){
    try{
      const vv=window.visualViewport,cam=window.camera,rnd=window.renderer,cars=window.carObjs,pIdx=window.playerIdx;
      let camLine='cam: not ready',rendLine='renderer: not ready';
      if(cam){
        const cp=cam.position;
        camLine='cam fov '+(cam.fov||0).toFixed(1)+' asp '+(cam.aspect||0).toFixed(3)+
          '\ncam pos '+cp.x.toFixed(1)+','+cp.y.toFixed(1)+','+cp.z.toFixed(1);
        if(cars&&typeof pIdx==='number'&&cars[pIdx]&&cars[pIdx].mesh){
          const pp=cars[pIdx].mesh.position,dist=cp.distanceTo(pp);
          camLine+='\nplayer '+pp.x.toFixed(1)+','+pp.y.toFixed(1)+','+pp.z.toFixed(1)+' d '+dist.toFixed(1);
        }
      }
      if(rnd&&typeof THREE!=='undefined'){
        const sz=new THREE.Vector2();rnd.getSize(sz);
        rendLine='rend '+sz.x+'×'+sz.y+' pr '+rnd.getPixelRatio().toFixed(2);
      }
      dbgEl.textContent='win '+innerWidth+'×'+innerHeight+
        (vv?' vv '+Math.round(vv.width)+'×'+Math.round(vv.height):'')+
        ' dpr '+(devicePixelRatio||1).toFixed(2)+' asp '+(innerWidth/innerHeight).toFixed(2)+
        '\nmob '+(!!window._isMobile)+' tab '+(!!window._isTablet)+' iPad '+(!!window._isIPadLike)+
        '\n'+rendLine+'\n'+camLine;
    }catch(_){/* never block init */}
  };
  window._updateDebugBadge();
  setInterval(window._updateDebugBadge,330);
  window.addEventListener('resize',window._updateDebugBadge);
}

// ES module marker.
export {};
