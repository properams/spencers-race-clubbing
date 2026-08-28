// js/gameplay/combo.js — non-module script.

'use strict';

// Combo state (uit main.js verhuisd). _comboMult blijft in main.js als var,
// want persistence/progression.js leest het via window._comboMult.
let _comboTimer=0,_comboCount=0;

// Drift state (uit main.js verhuisd) — drift triggert combo, dus zelfde home.
//   driftScore / driftTimer  — geupdatet in cars/physics.js, gereset per race
//   _miniTurboReady          — drift→boost release flag
//   _driftAccum              — accumulator voor DRIFT_KING achievement (3.0s)
//   _driftBarFill / _driftBarEl / _driftLabelEl — DOM-refs gevuld door
//                              effects/visuals.js initSpeedLines()
let driftScore=0,driftTimer=0;
let _miniTurboReady=false;
let _driftAccum=0;
let _driftBarFill=null,_driftBarEl=null,_driftLabelEl=null;

// getSector(progress) was dead — vervangen door inline ternary in
// gameplay/tracklimits.js (regel 121).

function triggerCombo(reason){
  _comboCount++;_comboTimer=8.0;
  if(_comboCount>=6)_comboMult=2.5;
  else if(_comboCount>=4)_comboMult=2.0;
  else if(_comboCount>=2)_comboMult=1.5;
  else _comboMult=1.2;
  showPopup('🔥 '+reason+' · '+_comboMult.toFixed(1)+'x','#ff8800',900);
  const ce=document.getElementById('comboEl');
  if(ce){ce.textContent=_comboCount+'x COMBO';ce.style.opacity='1';}
}

function resetCombo(){
  _comboCount=0;_comboMult=1.0;
  const ce=document.getElementById('comboEl');if(ce)ce.style.opacity='0';
}
