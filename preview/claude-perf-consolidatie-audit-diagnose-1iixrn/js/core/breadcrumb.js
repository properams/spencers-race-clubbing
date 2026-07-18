// js/core/breadcrumb.js — laatste 10 user-acties + build events in localStorage.
// Non-module script. Geladen na debug.js (gebruikt window.dbg als beschikbaar)
// maar werkt zonder.
//
// Doel: na een iOS tab-kill (waarbij de page silent reload doet zonder
// console-output of error-overlay) is er na de reload géén forensische
// info over wat de user net deed. Deze module schrijft een ringbuffer
// van max 10 events naar localStorage.src_breadcrumb, zodat de tester
// na een crash kan zien:
//   "user was bezig met navigatie X → world Y → race start, toen ging
//    de page weg".
//
// Public API:
//   Breadcrumb.push(name [, extra])  — voeg event toe
//   Breadcrumb.list()                — array met alle entries
//   Breadcrumb.clear()               — leeg ringbuffer
//
// Auto: bij load wordt de vorige sessie's breadcrumb naar dbg.warn gepusht
// (channel 'breadcrumb') zodat het in Ctrl+Shift+E viewer zichtbaar is.

'use strict';

(function(){
  const KEY='src_breadcrumb';
  const MAX=10;

  function _read(){
    try{
      const raw=localStorage.getItem(KEY);
      if(!raw)return [];
      const arr=JSON.parse(raw);
      return Array.isArray(arr)?arr:[];
    }catch(_){ return []; }
  }
  function _write(arr){
    try{ localStorage.setItem(KEY,JSON.stringify(arr.slice(-MAX))); }catch(_){}
  }

  function push(name,extra){
    if(!name)return;
    const arr=_read();
    const ent={t:Date.now(),n:String(name)};
    if(extra!==undefined){
      // Houd extra klein — geen DOM nodes, geen circular refs.
      try{
        if(typeof extra==='string'||typeof extra==='number'||typeof extra==='boolean'){
          ent.x=extra;
        }else{
          // Strip naar primitives + 1 niveau diep
          const flat={};
          for(const k of Object.keys(extra||{})){
            const v=extra[k];
            if(v===null||['string','number','boolean'].includes(typeof v))flat[k]=v;
          }
          ent.x=flat;
        }
      }catch(_){}
    }
    arr.push(ent);
    _write(arr);
  }

  function list(){ return _read(); }
  function clear(){ try{ localStorage.removeItem(KEY); }catch(_){} }

  window.Breadcrumb = { push, list, clear };

  // On boot: read previous session's trail and surface to dbg if there
  // were errors persisted. Don't wipe — the next push() naturally evicts.
  // Script-load order in index.html (debug.js vóór breadcrumb.js, beide
  // synchrone classic scripts) garandeert dat window.dbg al bestaat.
  try{
    const prev=_read();
    if(prev.length){
      const last=prev[prev.length-1];
      const seconds=Math.round((Date.now()-last.t)/1000);
      const trail=prev.map(e=>e.n+(e.x?(' '+JSON.stringify(e.x)):'' )).join(' → ');
      if(window.dbg)window.dbg.log('breadcrumb','prev session ('+seconds+'s ago, '+prev.length+' steps): '+trail);
    }
  }catch(_){}

  // Mark the new session's start so the trail makes sense across reloads.
  push('boot');
})();

// ES module marker — laat esbuild dit bestand als module bundelen.
export {};
