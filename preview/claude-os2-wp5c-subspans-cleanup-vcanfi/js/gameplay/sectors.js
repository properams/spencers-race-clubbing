// js/gameplay/sectors.js — sector timing state (uit main.js verhuisd).
// Non-module script.
//
// Track is opgedeeld in 3 sectoren (S1/S2/S3) op basis van car.progress.
// Sector-detection en split-tijd-logica zit in gameplay/tracklimits.js.
// Reset per race in gameplay/race.js. Sector-popup-toast via
// effects/visuals.js (showSectorSplit gebruikt _secPopTimer).
// HUD-elementen secT1/2/3 staan in ui/hud.js _elSecT cache.

'use strict';

// Per-race besten per sector
const _sectorBests=[Infinity,Infinity,Infinity];
let _sectorStart=0;
let _currentSector=0;

// Toast debounce timer (clearTimeout op nieuwe split)
let _secPopTimer=null;

// All-time besten per sector — apart van _sectorBests omdat die per race reset.
// Niet in localStorage maar wel cross-race binnen dezelfde sessie.
let _bestS1=Infinity,_bestS2=Infinity,_bestS3=Infinity;
