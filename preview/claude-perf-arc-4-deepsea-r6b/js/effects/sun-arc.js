// js/effects/sun-arc.js — Phase 10.2: procedurele day-night cycle.
// Tijdens RACE state lerpt sunLight.position langs een boog (rise →
// noon → set). Volledige cyclus duurt _SUN_ARC_DURATION_SEC; mid-race
// = noon. Exposure target lerpt mee via window._setExposureTarget.
//
// Non-module script. Geladen in index.html tussen lod-cull.js en
// ssao-pass.js.
//
// Skip op space + deepsea (geen atmosfeer). Skip op mobile is niet
// nodig — cost is 1 vector-set per frame + 1 exposure-write.
//
// Dependencies (script-globals): sunLight, _nowSec, activeWorld.

'use strict';

const _SUN_ARC_DURATION_SEC = 180;
let _sunArcEnabled = false;
let _sunArcStartT = 0;
let _sunBasePos = null;

function startSunArc(){
  if(typeof sunLight === 'undefined' || !sunLight) return;
  // No atmosphere — skip
  if(typeof activeWorld !== 'undefined' &&
     (activeWorld === 'space' || activeWorld === 'deepsea')) return;
  if(!_sunBasePos) _sunBasePos = sunLight.position.clone();
  _sunArcEnabled = true;
  _sunArcStartT = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now()*0.001);
}

function stopSunArc(){
  _sunArcEnabled = false;
  // Restore origineel positie zodat M-toggle weer correct werkt.
  if(_sunBasePos && typeof sunLight !== 'undefined' && sunLight){
    sunLight.position.copy(_sunBasePos);
  }
}

function updateSunArc(dt){
  if(!_sunArcEnabled) return;
  if(typeof sunLight === 'undefined' || !sunLight) return;
  const tNow = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now()*0.001);
  const elapsed = tNow - _sunArcStartT;
  const t = (elapsed % _SUN_ARC_DURATION_SEC) / _SUN_ARC_DURATION_SEC;
  // Half-arc 0..π — sun rijst in east, top in zenith, valt in west.
  const angle = t * Math.PI;
  const radius = 280;
  const px = Math.cos(angle) * radius;
  const py = Math.sin(angle) * 280 + 40;
  const pz = 80;
  sunLight.position.set(px, py, pz);
  // Day-fade: exposure 0.85 dawn → 1.30 noon → 0.85 dusk
  const noonness = Math.sin(angle);
  if(typeof window._setExposureTarget === 'function'){
    window._setExposureTarget(0.85 + noonness * 0.45);
  }
}

if(typeof window !== 'undefined'){
  window._startSunArc = startSunArc;
  window._stopSunArc = stopSunArc;
  window._updateSunArc = updateSunArc;
}
