// js/core/math-luts.js — non-module script. Shared sin/cos lookup table
// used door cinematic + deepsea + arctic + volcano + sandstorm + pier47.
// Voorheen had elke caller een eigen 1024-slot Float32Array kopie (3 al
// in gebruik, 3 op komst). Reuse-reviewer flagde dat consolidatie nodig
// werd bij de 4e caller.
//
// 1024 slots × 2π → ~0.006 rad fout, prima voor decoratieve flicker /
// breathing / orbital motion. NIET gebruiken voor physics — daar Math.sin.
//
// Definieert window._sharedSin en window._sharedCos (cross-script
// globals zoals andere helpers in deze codebase).

'use strict';

(function(){
  const N = 1024;
  const LUT = new Float32Array(N);
  for(let i = 0; i < N; i++) LUT[i] = Math.sin(i / N * Math.PI * 2);
  const K = N / (Math.PI * 2);
  const MASK = N - 1;
  function _sharedSin(x){ const i = ((x * K) | 0) & MASK; return LUT[i]; }
  function _sharedCos(x){ return _sharedSin(x + Math.PI * 0.5); }
  if(typeof window !== 'undefined'){
    window._sharedSin = _sharedSin;
    window._sharedCos = _sharedCos;
  }
})();
