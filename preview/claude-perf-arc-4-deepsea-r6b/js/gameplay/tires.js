// js/gameplay/tires.js — tire temperature + wear-warning state.
// Non-module script. Verhuisd uit main.js.
//
// _tireTemp — per-corner heat (0=cold, 0.5=optimal, 1=overheated). Ge-update
//   elke frame in cars/physics.js, gereset per race in gameplay/race.js,
//   gevisualiseerd in ui/hud.js (_elTireT cells krijgen heat-color).
// _tireWarnCooldown — debounce voor "TYRES WORN" popup (8s na trigger).
// _lastTireKey — cache-key voor wear-icon update zodat HUD niet elk frame redraw.
// Geen logica hier; cross-script consumers blijven bestaan.

'use strict';

let _tireTemp={fl:.15,fr:.15,rl:.15,rr:.15};
let _tireWarnCooldown=0;
// String-key sinds de car-status panel zowel temp als damage encodeert.
let _lastTireKey='';
