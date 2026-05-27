// js/gameplay/speedtrap.js — speed-trap state (uit main.js verhuisd).
// Non-module script.
//
// Het S/F-rechte stuk meet je topsnelheid in km/h. _speedTrapMax wordt
// elk frame in cars/physics.js bijgewerkt zodra car.progress in de
// detectiezone valt. _speedTrapFired is een debounce-flag voor de UI-popup
// (2.2s zichtbaar). _speedTrapAllTime is cross-race en wordt door
// persistence/save.js + progression.js gepersisteerd via window.*.
// Reset per race in gameplay/race.js. DOM-ref _speedTrapEl in ui/hud.js.

'use strict';

// Per-race
let _speedTrapMax=0;
let _speedTrapFired=false;

// Cross-race (persisted) — var zodat persistence/save.js window._speedTrapAllTime ziet.
var _speedTrapAllTime=0;
