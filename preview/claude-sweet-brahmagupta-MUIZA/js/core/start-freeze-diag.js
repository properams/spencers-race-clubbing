// Diag-instrumentatie voor de desktop start-freeze.
//
// Default: NO-OP. Activeren met ?diag=1 of localStorage.SRC_DIAG='1'.
//
// Werking:
//  - Definieert window._diagWrap. Default pass-through (geen overhead).
//  - Bij diag-on wikkelt _diagWrap elke call met performance.now() en houdt
//    per name bij: firstCallMs, cumMs, maxFrameMs, calls.
//  - Markeert GO via een MutationObserver op window._waitingForFirstRaceFrame
//    (al gezet door countdown.js bij 'GO!').
//  - Verzamelt 5 seconden frame-timings + snapshots (shader programs,
//    textures, geometries, heap, audio state) op GO en GO+5s.
//  - Logt na 5s twee console.tables: one per firstCallMs DESC, one per
//    maxFrameMs DESC, plus de snapshot-deltas en frame-spikes >16ms.
//
// Gebruik:
//   1. Open index.html?diag=1
//   2. Start een race in elke wereld
//   3. Wacht 5s na GO
//   4. Plak console.table output terug — top-3 boosdoeners zichtbaar

(function(){
  const _ENABLED = (function(){
    try{
      const qs = new URLSearchParams(window.location.search);
      if(qs.get('diag') === '1') return true;
      if(window.localStorage && localStorage.SRC_DIAG === '1') return true;
    }catch(_){}
    return false;
  })();

  // Default no-op wrapper. Even when diag is off, hot-path callers can use
  // window._diagWrap('name', ()=>fn()) without any cost.
  if(!_ENABLED){
    window._diagWrap = function(name, fn){ return fn(); };
    return;
  }

  // ── Diag ON ─────────────────────────────────────────────────────────────
  console.log('[diag] start-freeze instrumentation ACTIVE — run race-start, wait 5s, check console.table');

  const _stats = new Map(); // name -> {firstCallMs, cumMs, maxFrameMs, calls}
  let _goAt = 0;
  let _windowEndAt = 0;
  let _active = false;
  let _frameStartMs = 0;
  let _curFrameMaxName = '';
  let _curFrameMaxMs = 0;
  const _frameTimes = []; // {idx, deltaMs, dominant, dominantMs}
  let _frameIdx = 0;
  let _lastRafMs = 0;
  let _snapAtGo = null;

  function _snapshot(){
    const r = (typeof renderer !== 'undefined') ? renderer : null;
    const snap = {
      t: performance.now(),
      programs: r && r.info && r.info.programs ? r.info.programs.length : 0,
      textures: r && r.info && r.info.memory ? r.info.memory.textures : 0,
      geometries: r && r.info && r.info.memory ? r.info.memory.geometries : 0,
      drawCalls: r && r.info && r.info.render ? r.info.render.calls : 0,
      heapMB: (performance.memory) ? (performance.memory.usedJSHeapSize/1048576).toFixed(1) : 'n/a',
      audioState: (window.audioCtx) ? audioCtx.state : 'no-ctx',
      pendingRaceMusic: !!window._pendingRaceMusic,
      gameState: (typeof gameState !== 'undefined') ? gameState : '?',
      activeWorld: window.activeWorld || '?'
    };
    return snap;
  }

  function _diff(a, b){
    return {
      dProgs: b.programs - a.programs,
      dTex: b.textures - a.textures,
      dGeo: b.geometries - a.geometries,
      dDraw: b.drawCalls - a.drawCalls,
      heapStartMB: a.heapMB,
      heapEndMB: b.heapMB,
      audioStart: a.audioState,
      audioEnd: b.audioState,
      pendingMusicStart: a.pendingRaceMusic,
      pendingMusicEnd: b.pendingRaceMusic
    };
  }

  function _dump(){
    if(!_active) return;
    _active = false;
    const snapEnd = _snapshot();
    const rows1 = [];
    for(const [name, s] of _stats){
      rows1.push({
        name,
        firstCallMs: +s.firstCallMs.toFixed(2),
        maxFrameMs: +s.maxFrameMs.toFixed(2),
        cumMs: +s.cumMs.toFixed(2),
        calls: s.calls
      });
    }
    rows1.sort((a,b)=>b.firstCallMs - a.firstCallMs);
    console.group('[diag] start-freeze report — GO → GO+5s');
    console.log('Snapshot delta:', _diff(_snapAtGo, snapEnd));
    console.log('Top wrapped functions (sorted by firstCallMs):');
    console.table(rows1.slice(0, 25));
    const rows2 = rows1.slice().sort((a,b)=>b.maxFrameMs - a.maxFrameMs);
    console.log('Top wrapped functions (sorted by maxFrameMs):');
    console.table(rows2.slice(0, 25));
    const spikes = _frameTimes.filter(f=>f.deltaMs > 16);
    if(spikes.length){
      console.log('Frame spikes >16ms ('+spikes.length+' frames):');
      console.table(spikes.slice(0, 30));
    } else {
      console.log('No frame >16ms in window — freeze did NOT reproduce.');
    }
    console.groupEnd();
  }

  // Per-frame timing collector. We tick op rAF; binnen elke frame zien we
  // welke wrapped functie de langste call had.
  function _rafTick(t){
    if(!_active) return;
    if(_lastRafMs > 0){
      const delta = t - _lastRafMs;
      _frameTimes.push({
        idx: _frameIdx++,
        deltaMs: +delta.toFixed(2),
        dominant: _curFrameMaxName,
        dominantMs: +_curFrameMaxMs.toFixed(2)
      });
    }
    _lastRafMs = t;
    _curFrameMaxName = '';
    _curFrameMaxMs = 0;
    if(performance.now() >= _windowEndAt){
      _dump();
      return;
    }
    requestAnimationFrame(_rafTick);
  }

  function _startWindow(){
    if(_active) return;
    _active = true;
    _goAt = performance.now();
    _windowEndAt = _goAt + 5000;
    _snapAtGo = _snapshot();
    _stats.clear();
    _frameTimes.length = 0;
    _frameIdx = 0;
    _lastRafMs = 0;
    _curFrameMaxName = '';
    _curFrameMaxMs = 0;
    console.log('[diag] GO detected at', _goAt.toFixed(1), 'ms — collecting 5s window');
    requestAnimationFrame(_rafTick);
  }

  // GO detection: countdown.js sets window._waitingForFirstRaceFrame=true at
  // GO. We polyfill a setter trap on it so we activate the moment that flips.
  let _waitingFlag = window._waitingForFirstRaceFrame || false;
  Object.defineProperty(window, '_waitingForFirstRaceFrame', {
    configurable: true,
    enumerable: true,
    get(){ return _waitingFlag; },
    set(v){
      _waitingFlag = v;
      if(v === true && !_active) _startWindow();
    }
  });

  // Diag wrapper.
  window._diagWrap = function(name, fn){
    if(!_active) return fn();
    const t0 = performance.now();
    let r;
    try{ r = fn(); }
    finally{
      const dur = performance.now() - t0;
      let s = _stats.get(name);
      if(!s){
        s = { firstCallMs: dur, cumMs: 0, maxFrameMs: 0, calls: 0 };
        _stats.set(name, s);
      }
      s.cumMs += dur;
      s.calls++;
      if(dur > s.maxFrameMs) s.maxFrameMs = dur;
      if(dur > _curFrameMaxMs){
        _curFrameMaxMs = dur;
        _curFrameMaxName = name;
      }
    }
    return r;
  };
})();
