// Smooth loader engine. Drives a circular SVG arc whose visible progress
// is decoupled from the actual loading work, so the indicator never stutters
// or jumps even when the main thread is blocked by heavy boot/build work.
//
// Public API (window.SrcLoader):
//   attach(el)        bind to a .srcLoader element, start engine
//   setTarget(pct)    0..100 — external progress hint, monotonic (max only)
//   setLabel(text)    label below the SVG (queries .srcLoaderLabel inside or sibling)
//   finish(opts?)     snap to 100%, fade-out, then opts.onDone(); default hides container
//   detach(el)        stop engine, remove from active set
//
// Engine: rAF loop with a synthetic asymptotic trickle toward 90% so the bar
// always moves even without progress events. External setTarget bumps target
// upward only. Displayed lerps toward target frame-rate-independently.
(function(){
  const _R=26;
  const _CIRC=2*Math.PI*_R; // 163.362...
  const _active=new Map(); // el -> state

  const _now=()=> (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
  const _reducedMotion=()=>{
    try{ return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch(_){ return false; }
  };

  function _findArc(el){
    return el && el.querySelector ? el.querySelector('.srcLoaderArc') : null;
  }
  function _findLabel(el){
    if(!el||!el.querySelector)return null;
    // Label sits in the container (loadingScreen / worldLoadingOverlay), not inside .srcLoader
    return el.querySelector('.srcLoaderLabelText') || null;
  }
  function _findContainer(el){
    // .srcLoader lives inside #loadingScreen or #worldLoadingOverlay; we hide that.
    let n=el;
    while(n && n.parentElement){
      if(n.id==='loadingScreen'||n.id==='worldLoadingOverlay')return n;
      n=n.parentElement;
    }
    return el;
  }

  let _rafId=0;
  let _lastT=0;

  function _tick(t){
    _rafId=0;
    if(!_active.size)return;
    if(document.hidden){
      _lastT=0;
      _rafId=requestAnimationFrame(_tick);
      return;
    }
    if(!_lastT)_lastT=t;
    const dt=Math.min(0.1,(t-_lastT)/1000); // clamp to 100ms to survive tab-throttling spikes
    _lastT=t;

    for(const [el,s] of _active){
      // Synthetic trickle: asymptotic toward 90 with rate ~1.2/s.
      // Bumps target whenever it lags behind the trickle, so external setTarget
      // hints can only push it further, never pull it back.
      const cap=s.finishing?100:90;
      const trickle=s.target + (cap - s.target)*(1 - Math.exp(-dt*s.trickleRate));
      if(trickle>s.target)s.target=trickle;

      // Displayed lerp — exponential easing, frame-rate independent.
      const k=Math.min(1, dt*s.lerpRate);
      s.displayed += (s.target - s.displayed)*k;
      if(s.target>=99.95 && s.displayed>99.5)s.displayed=100;

      // Arc visual is driven by a CSS keyframe sweep (compositor) so it keeps
      // moving even when main thread blocks. The displayed/target state is
      // still tracked here for the finish-snap timing below and for any
      // text label that wants to read it.

      // Finish transition: when we've snapped to ~100, start fade-out timer.
      if(s.finishing && !s.fadeStartedAt && s.displayed>=99.5){
        s.fadeStartedAt=t;
        const cont=s.container;
        if(cont)cont.classList.add('srcLoaderDone');
      }
      if(s.fadeStartedAt && (t-s.fadeStartedAt)>=220){
        // detach + invoke onDone
        const onDone=s.onDone;
        const cont=s.container;
        _active.delete(el);
        if(cont){
          // Default behavior: hide via display:none (loading screen) or wloHidden class (world overlay)
          if(cont.id==='worldLoadingOverlay'){
            cont.classList.add('wloHidden');
            cont.classList.remove('srcLoaderDone');
          } else {
            cont.style.display='none';
          }
        }
        if(typeof onDone==='function'){
          try{ onDone(); }catch(_){}
        }
      }
    }

    if(_active.size){
      _rafId=requestAnimationFrame(_tick);
    } else {
      _lastT=0;
    }
  }

  function _kickLoop(){
    if(_rafId)return;
    _lastT=0;
    _rafId=requestAnimationFrame(_tick);
  }

  function attach(el){
    if(!el || _active.has(el))return;
    const arc=_findArc(el);
    // Arc dasharray/dashoffset is owned by CSS keyframes (srcLoaderArcSweep)
    // so we don't seed inline styles here — any inline value would override
    // the animation and lock the arc to a fixed length.
    const container=_findContainer(el);
    if(container){
      container.classList.remove('srcLoaderDone');
      if(container.style.display==='none')container.style.display='';
    }
    const reduced=_reducedMotion();
    _active.set(el,{
      el, arc, container,
      target:0,
      displayed:0,
      trickleRate:1.2,
      lerpRate:reduced?60:7, // reduced motion: snap fast, no visible easing
      finishing:false,
      fadeStartedAt:0,
      onDone:null
    });
    _kickLoop();
  }

  function detach(el){
    _active.delete(el);
  }

  function setTarget(pct){
    if(!_active.size)return;
    const v=Math.max(0,Math.min(100,Number(pct)||0));
    // Apply to all attached (in practice only one is attached at a time).
    for(const s of _active.values()){
      if(v>s.target && !s.finishing)s.target=v;
    }
  }

  function setLabel(text){
    if(!_active.size||text==null)return;
    for(const s of _active.values()){
      const lbl=_findLabel(s.container||s.el);
      if(lbl)lbl.textContent=String(text);
    }
  }

  function finish(opts){
    if(!_active.size)return;
    for(const s of _active.values()){
      if(s.finishing)continue;
      s.finishing=true;
      s.target=100;
      s.lerpRate=Math.max(s.lerpRate,22); // fast snap
      s.onDone=(opts&&typeof opts.onDone==='function')?opts.onDone:null;
    }
    _kickLoop();
  }

  // Convenience helpers for the world overlay (replaces classList.add/remove dance).
  function showWorldLoader(){
    const ov=document.getElementById('worldLoadingOverlay');
    if(!ov)return;
    ov.classList.remove('wloHidden');
    ov.classList.remove('srcLoaderDone');
    const inner=ov.querySelector('.srcLoader');
    if(inner)attach(inner);
  }
  function hideWorldLoader(){
    const ov=document.getElementById('worldLoadingOverlay');
    if(!ov)return;
    const inner=ov.querySelector('.srcLoader');
    if(inner && _active.has(inner)){
      finish();
    } else {
      ov.classList.add('wloHidden');
    }
  }

  window.SrcLoader={
    attach, detach, setTarget, setLabel, finish,
    showWorldLoader, hideWorldLoader,
    _CIRC
  };
})();
