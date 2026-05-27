// js/core/world-loader.js — non-module script. Loads per-world script files
// on demand instead of statically <script>-tagging all 9 worlds in index.html.
//
// Why: each world script is 27-163 KB and attaches its build/update functions
// to window during parse. Loading all 9 upfront is ~680 KB synchronous parse
// work on boot — measurable freeze before TITLE shows. Most users only play
// 1-2 worlds per session.
//
// Strategy: at boot.js, await loadWorldScript(activeWorld) before the initial
// buildScene(). On world-switch in rebuildWorldAsync, also await it. After
// boot completes, prefetchAllWorlds() schedules the remaining 8 worlds via
// requestIdleCallback so subsequent picks are instant.
//
// Helpers (X-bridge.js / X-iceshelf.js / X-coaster.js etc) must load BEFORE
// the main world script — they're transparently sequenced here.

'use strict';
(function(){
  // Helpers per world. Value mag string zijn (single helper, default pad
  // js/worlds/X.js) of array (meerdere helpers, sequentieel geladen).
  // Helper-string die start met 'effects/' resolve naar js/effects/X.js —
  // dit laat candy een generieke prop-library laden (sugar-rush-props)
  // zonder die in de worlds-map te plaatsen.
  const HELPERS={
    volcano:'volcano-bridge',
    arctic:'arctic-iceshelf',
    space:'space-anomaly',
    deepsea:'deepsea-current',
    candy:['candy-chocobridge','effects/sugar-rush-props'],
    sandstorm:'sandstorm-storm',
    // pier47 / guangzhou: geen helper
  };
  function _resolveHelperSrc(h){
    return h.indexOf('effects/')===0
      ? 'js/effects/'+h.slice(8)+'.js'
      : 'js/worlds/'+h+'.js';
  }
  const ALL_WORLDS=['volcano','arctic','space','deepsea','candy','sandstorm','pier47','guangzhou'];
  const _loaded={};
  const _pending={};

  function _injectScript(src){
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src=src;
      s.async=false; // preserve execution order tussen helper en main
      s.onload=()=>resolve();
      s.onerror=()=>reject(new Error('worldLoader: failed to load '+src));
      document.head.appendChild(s);
    });
  }

  function loadWorldScript(name){
    if(!name)return Promise.resolve();
    if(_loaded[name])return Promise.resolve();
    if(_pending[name])return _pending[name];
    const helperEntry=HELPERS[name];
    const helpers=Array.isArray(helperEntry)
      ? helperEntry
      : (helperEntry ? [helperEntry] : []);
    const t0=performance.now();
    // Chain helpers sequentially (async=false binnen elke _injectScript
    // garandeert dat exec-volgorde blijft kloppen) en daarna de main world.
    const chain=helpers.reduce(
      (p,h)=>p.then(()=>_injectScript(_resolveHelperSrc(h))),
      Promise.resolve()
    ).then(()=>_injectScript('js/worlds/'+name+'.js'))
      .then(()=>{
        _loaded[name]=true;
        const ms=+(performance.now()-t0).toFixed(1);
        if(window.Breadcrumb)Breadcrumb.push('worldScript.load',{name,ms});
        if(window.perfLog)window.perfLog.push({name:'worldScript.load',ms,t:performance.now(),world:name});
        if(window.dbg)dbg.log('worldLoader','loaded '+name+' in '+ms+'ms');
      })
      .catch(err=>{
        _loaded[name]=false;
        delete _pending[name]; // allow retry
        if(window.dbg)dbg.error('worldLoader',err,'failed to load '+name);
        else console.error('worldLoader: failed to load '+name,err);
        throw err;
      });
    _pending[name]=chain;
    return chain;
  }

  // Idle-time prefetch alle resterende werelden, één voor één om jank te
  // voorkomen. Geen retries op failure; volgende switch probeert opnieuw via
  // loadWorldScript's normale pad.
  function prefetchAllWorlds(except){
    const queue=ALL_WORLDS.filter(w=>w!==except&&!_loaded[w]&&!_pending[w]);
    const _tPrefetchStart=performance.now();
    const _initialCount=queue.length;
    if(window.perfMark)perfMark('prefetch:start');
    const _finish=()=>{
      if(window.perfMark){perfMark('prefetch:end');perfMeasure('prefetch.allWorlds','prefetch:start','prefetch:end');}
      if(window.perfLog)window.perfLog.push({name:'prefetch.allWorlds',ms:performance.now()-_tPrefetchStart,t:performance.now(),worldsCount:_initialCount,except:except||null});
    };
    const next=()=>{
      if(!queue.length){_finish();return;}
      const w=queue.shift();
      loadWorldScript(w).catch(()=>{}).finally(()=>{
        if(window.requestIdleCallback){
          requestIdleCallback(next,{timeout:3000});
        }else{
          setTimeout(next,800);
        }
      });
    };
    if(window.requestIdleCallback){
      requestIdleCallback(next,{timeout:5000});
    }else{
      setTimeout(next,2500);
    }
  }

  window.loadWorldScript=loadWorldScript;
  window.prefetchAllWorlds=prefetchAllWorlds;
  window._worldScriptsLoaded=_loaded;
  window._worldScriptsAll=ALL_WORLDS;
})();
