// js/main.js — Spencer's Race Club main game
// Loaded als gewoon <script> (non-module) zodat top-level let/const/var globals
// blijven voor submodule-access via window.*. Submodules zijn wel ES modules
// (zie js/persistence/*, js/audio/*, js/ui/*).
'use strict';

// (Tuning constants → js/config.js;
//  iPad-detect + _redetectDevice() init → js/core/device.js;
//  optional debug overlay → js/core/debug.js;
//  disposeScene → js/core/scene.js.)

// ══ DATA — gevuld door loadGameData() (zie boot) ══════════════════════════
var CAR_DEFS=[];        // var: ES-modules lezen window.CAR_DEFS
let TRACK_WP=[];        // active world waypoints (muteerbaar in buildScene)
let _DEFAULT_WP=[];     // snapshot waypoints voor default world (space)
let _TRACKS={};         // alle werelden keyed by name
// CAR_PRICES + WORLD_PRICES komen verderop — na persistence helpers

async function loadGameData(){
  // De inline <script> in <head> kickt de 3 JSON-fetches al af vóór de
  // classic scripts parsen, zodat netwerk-tijd overlapt met script-parse.
  // Fallback: als de preload-promise ontbreekt (oude index.html, edge case),
  // doen we de fetches alsnog hier.
  const p = window.__gameDataPromise || Promise.all([
    fetch('data/cars.json').then(r=>r.json()),
    fetch('data/tracks.json').then(r=>r.json()),
    fetch('data/prices.json').then(r=>r.json())
  ]);
  const [cars,tracks,prices] = await p;
  CAR_DEFS=cars.map(c=>({...c,color:parseInt(c.color,16),accent:parseInt(c.accent,16)}));
  _TRACKS=tracks;
  window._TRACKS=_TRACKS; // ES-module select.js leest window._TRACKS voor minimaps
  _DEFAULT_WP=_TRACKS.space.map(wp=>[wp[0],wp[1]]);
  TRACK_WP.length=0;
  _TRACKS.space.forEach(wp=>TRACK_WP.push(wp));
  CAR_PRICES={};
  Object.keys(prices.cars).forEach(k=>{CAR_PRICES[Number(k)]=prices.cars[k];});
  WORLD_PRICES=prices.worlds;
}
// ── World state ───────────────────────────────
var activeWorld='space';  // var: ES-modules schrijven window.activeWorld
// Per-world arrays (_space*, _dsa*, _kelp*, _jellyfish*, _volcano*, _arctic*,
// _tp*, _sprinkle*, _gummy*, _candy*, _neon*, _holo*) verhuisd naar
// js/worlds/<world>.js — zie de "Per-world state" blokken bovenaan elk wereld-bestand.

// ══ GLOBALS ══════════════════════════════════
var renderer,scene,camera,clock; // var = attached to window so debug badge can read them
let _ctxLost=false,_ctxLostReloadTimer=null;
let trackCurve,curvePts;
var carObjs=[],playerIdx=0,selCarId=3,gameState='TITLE'; // var so window.carObjs/playerIdx visible to debug badge
let isDark=true,isRain=false;
const keys={};
const camPos=new THREE.Vector3(),camTgt=new THREE.Vector3();
// camShake → js/gameplay/camera.js
let sunLight,ambientLight,hemiLight;
let trackLightList=[],trackPoles=[],stars=null;
let plHeadL,plHeadR,plTail;
let recoverActive=false,recoverTimer=0;
let nitroLevel=100,nitroActive=false;
// driftScore / driftTimer → js/gameplay/combo.js
// lapStartTime / lastLapTime → js/gameplay/race.js
var bestLapTime=Infinity; // var: ES-modules lezen window.bestLapTime
const skidMarks=[];
var titleMusic=null,musicSched=null,selectMusic=null; // var: music ES-module schrijft window.*

// ── MUSIC SUBSYSTEM — verplaatst naar js/audio/music.js ──
// MusicLib, TitleMusic, SelectMusic, RaceMusic, startTitleMusic,
// startSelectMusic, _createRaceMusicForWorld, _playCountdownRoll,
// _fadeOutMusic, _applyMusicGain, _safeStartMusic, noteFreq/NF, _musicDebug
// zijn beschikbaar via window.xxx (module laadt deferred).

var audioCtx=null; // var: music ES-module leest window.audioCtx
// Engine audio state (engineOsc, engineGain, _rollGain, _rollSrc, _rollFilt,
// _carWindGain/_carWindSrc/_carWindFilt, _carWindSampleGain/_carWindSampleSrc) → js/audio/engine.js

// Special track objects
const jumpRamps=[],spinPads=[],boostPads=[],collectibles=[];
// Per-world track elements (_wp*) verhuisd naar js/worlds/<world>.js.
// Per-car vertical velocity stored on car.vy
// (_nowSec → core/loop.js; _posCache + _posTick → ui/hud.js;
//  _ai* scratch vectors → cars/ai.js)

// Rain
let rainCanvas,rainCtx,rainDrops=[];

// Particles
let sparkSystem,exhaustSystem;
// Sessie 02 — extra particle pools with distinct textures. Built in
// track/environment.js buildParticles() so they share the same
// lifecycle as the originals. nullable until buildParticles runs.
let smokeSystem=null,sparkleSystem=null,dustSystem=null;
// Tire-smoke emission throttle (60ms tick per wheel). Stored on
// window so per-car emission state can survive across physics frames.
let _tireSmokeTickT=0;

// Slipstream
let slipTimer=0,_slipBonusGiven=false;
// Comeback tracking — grid-position per car at race-start, used by
// finish.js to compute startPos - finalPos. Reset in race.js _resetRaceState.
let _gridPos=[];
// Nemesis — highest-aggr AI car index selected at race-start. -1 = no
// rival picked (e.g. solo run or all AI cleared). Consumed by hud.js
// for the rival badge and by finish.js for the defeat toast.
let _nemesisIdx=-1;
// Hit-pause — slow-mo timer on heavy collisions (collisions.js sets,
// loop.js consumes as dt-multiplier). Frame-rate independent.
let _hitPauseTimer=0;
// Crash-induced music-duck — collisions.js sets target+timer; engine.js
// reads _musicDuck (already in main.js). These tween it.
let _musicDuckTimer=0,_musicDuckTarget=1.0;

// HUD DOM-refs → js/ui/hud.js (top of file)
// _mmBounds / _mmFrameCtr / _currentGear → js/ui/hud.js
// Leaderboard stability + position-notification timers → js/ui/hud.js
// Pause / mute state
let gamePaused=false,audioMuted=false;
var _muteGain=null; // var: music ES-module leest window._muteGain
// Music subsysteem state (was per ongeluk weggevallen bij fase 2.2a extraction;
// music.js's header noemt ze "gedeclareerd in main.js" maar dat klopte niet).
// _musicVolume default uit git history (was let _musicVolume=0.5).
var _musicVolume=0.5;       // user-instelbaar (0..1)
var _musicMuted=false;      // toggle via M-keybind / pause
var _musicDuck=1.0;         // pit-stop ducking factor (1.0 = no duck)
// Pre-allocated camera vectors (avoid per-frame heap allocations)
// _camV1/_camV2 → gameplay/camera.js, _jFwdV → track/ramps.js, _aiFwdRV → cars/ai.js
// Pre-allocated player/car vectors — reused every frame to avoid GC pressure
// _pl* + _slip* scratch vectors → cars/physics.js
// _wrongWayTimer → gameplay/tracklimits.js, _elWrongWay → ui/hud.js
// _miniTurboReady → js/gameplay/combo.js
// Score system — _elLapDelta → ui/hud.js (geen aparte score-element in race-HUD meer; score wordt alleen op finish-scherm getoond)
var totalScore=0; // var: ES-modules schrijven window.totalScore
// Difficulty (0=easy 1=normal 2=hard) — DIFF_MULT in js/config.js
var difficulty=1; // var: ES-modules lezen window.difficulty
// Boost glow light
let _boostLight=null;
// Ambient wind/crowd refs → js/audio/ambient.js
// Track flags for wave animation
const _trackFlags=[];
// Track mesh ref (rain shimmer)
let _trackMesh=null;
// Sun lens flare sprite
let _sunBillboard=null;
// Per-world moon (Sphere mesh or Group). Built by buildWorldMoon() in
// js/track/environment.js when the active world's profile defines one.
// Pinned to camera.position via updateSky() so direction-from-camera stays
// constant (parallax-free, matches sun-pin pattern). Visible toggles with
// isDark in toggleNight(). Worlds without a profile (pier47)
// leave _moonBillboard=null.
let _moonBillboard=null;
// _camLateralT → js/gameplay/camera.js
// _rainIntensity / _rainTarget → js/effects/weather.js
// Safety car (spawns during recovery)
let _safetyCar=null;
// Tire state (_tireTemp, _tireWarnCooldown, _lastTireKey) → js/gameplay/tires.js
// _elCarStatus / _elTireT → ui/hud.js (oude _elTire is opgegaan in dual-encoded csTire dots)
// Day↔night smooth-transition state (_skyT, _skyTarget, _fogColorDay, _fogColorNight) → js/effects/night.js
// _thunderTimer / _weatherMode / _stormFlashTimer / _snowParticles / _snowGeo → js/effects/weather.js
// _crowdSrc / _crowdGain → js/audio/ambient.js
// Sector timing state → js/gameplay/sectors.js
// LocalStorage persistence cache
var _savedHS=0,_savedBL=Infinity; // var: ES-module persistence schrijft window._*
// _victoryOrbit / _camView → js/gameplay/camera.js
// Race-stats (_raceMaxSpeed, _raceOvertakes, _lastPlayerPos, _raceStartGrace) → js/gameplay/race.js
// Achievement state → js/gameplay/achievements.js
// Rear view mirror state → js/gameplay/camera.js
// _titleCamT → js/gameplay/camera.js
// _aiHeadPool → js/cars/ai.js
// _revLimiterTimer → js/effects/visuals.js
// Gap display HUD refs → ui/hud.js
// Quick restart hold timer
let _rstHold=0;
// _lapTimes → js/gameplay/race.js
// _weatherForecastTimer / _weatherForecastFired → js/effects/weather.js
// Collision flash
let _colFlashT=0;
let _contactPopupCD=0; // collision popup cooldown — max once per 3s
// _elRpm → ui/hud.js
// Speed-lines canvas state → js/effects/visuals.js
// Ghost car state → js/gameplay/ghost.js
// _driftBarFill / _driftBarEl / _driftLabelEl → js/gameplay/combo.js
// _floatPool was dead code (nergens gelezen) — verwijderd.
// Overall fastest lap (all-time, cross-race)
var _overallFastestLap=Infinity; // var: persistence cross-script
// _nearMissCooldown → js/cars/ai.js
// Pit-stop state → js/gameplay/pitstop.js
// _aiPersonality / _reverseLights → js/cars/ai.js
// Close battle indicator
let _closeBattleTimer=0;
// Fastest lap flash timer
let _fastestLapFlashT=0;
// _gapsToLeader was dead code (nergens gelezen) — verwijderd.
// _tireTemp → js/gameplay/tires.js
// Speed trap state → js/gameplay/speedtrap.js
// Car unlock system
var _unlockedCars=new Set([0,1,2,3,4,5,6,7,12]); // var: persistence cross-script (default unlocks). Group B (id=12) pilot — default-unlocked tijdens pilot-fase; production-versie kan via price-entry in prices.json gekocht worden.
var _raceCount=0,_podiumCount=0; // var: persistence cross-script (career stats)
// _newUnlocks was dead code — verwijderd in race.js extractie.
// AI overtaking behavior (per car): tries to go around player
// _aiPassSide: -1=left, 1=right, 0=none
// _wasBraking → js/cars/physics.js
// _spoolTimer was dead code (nergens gelezen) — verwijderd.
// Sector timing panel + Speed trap DOM-refs verhuisd naar js/ui/hud.js.
// _brakeHeatTimer was dead code (nergens gelezen) — verwijderd.
// GRIP_BONUS_ZONES → js/config.js
// Lap count selection
let _selectedLaps=3;

// keydown/keyup handlers → js/ui/input.js

// ══ AUDIO ════════════════════════════════════
var _master=null; // var: music ES-module leest window._master
// _lastGear → js/audio/engine.js
// ══ PERSISTENCE ══════════════════════════════
var _coins=0,_totalCoinsEarned=0; // var: persistence cross-script
var _lastRaceCoins=0,_comboMult=1.0; // var: ES-modules schrijven beide
// _comboTimer / _comboCount → js/gameplay/combo.js (_comboMult blijft hier als var)
// _bestS1/_bestS2/_bestS3 → js/gameplay/sectors.js
// ACHIEVEMENTS + DAILY_CHALLENGES → js/gameplay/achievements.js (top of file).
// _totalNitroUses / _winStreak waren dead code — verwijderd in race.js extractie.
var _todayChallenge=null,_challengeCompleted=false,_todayRaces=0;
var _worldsUnlocked=new Set(['space']); // var: persistence cross-script
var _trackRecords={}; // var: persistence cross-script
// Career progression (stars per (world × difficulty), XP, level, cups)
var _stars={};                         // { "<world>_<diff>": 0..3 }
var _xp=0,_level=1;                    // XP + derived level (recomputed on load)
var _cupsCompleted=new Set();          // Set<cupId> — finished (>=1★ Normal+ on every member)
var _cupsMastered=new Set();           // Set<cupId> — 3★ Hard on every member
var _devMode=false;                    // ?dev=1 — per-page-load, never persisted

// ── PERSISTENCE FUNCTIONS — verplaatst naar js/persistence/save.js + progression.js ──
// loadPersistent, savePersistent, awardCoins, buyCar, buyWorld,
// checkUnlocks, showUnlockToast, showUnlocks, updateTitleHighScore
// zijn beschikbaar via window.xxx (module laadt deze op DOMContentLoaded).

var CAR_PRICES={};      // var: ES-module persistence/progression leest window.CAR_PRICES
var WORLD_PRICES={};    // var: idem
// (Music subsysteem → js/audio/music.js;
//  initRenderer → js/core/renderer.js;
//  disposeScene/makeSkyTex/buildScene → js/core/scene.js.)

// (SimpleParticles class → js/effects/particles.js)
// (Environment, world builders en gameplay-checks zijn verhuisd naar
//  js/track/environment.js, js/worlds/*, js/effects/*, js/gameplay/*.)
// (Night/rain/cars/physics/AI/special-checks/track-limits/camera/HUD-refs
//  → respective js/* modules.)
// fmtTime / _lastPPos → js/ui/hud.js
// (fmtTime krijgt daar window.fmtTime alias zodat ES-module progression
// de eerder latent-broken window.fmtTime call kan resolven.)
// (popupTimeouts / bannerTimer waren state voor #popupMsg / #bannerOverlay —
//  beide DOM + state weg sinds Notify-facade. Zie js/ui/notifications.js.)
// (Countdown, finish, title, select → gameplay/* en ui/*.)
// Car preview state + _unlockHints → js/ui/select.js
// (Speed overlay, confetti, boost ring, slipstream, weather-transition,
//  safety car → js/effects/* en js/gameplay/safetycar.js.)
// _RACE_ACHIEVEMENTS → js/gameplay/achievements.js
// _nitroUseCount / _airborneAccum / _cleanLapFlag → js/gameplay/race.js (_driftAccum → combo.js)

// (_achieveToastEl / _achieveQueue / _achieveTimer waren dode state — verwijderd
//  na Notify-refactor. Zie js/gameplay/achievements.js.)
// _floatSlot / _floatSlotTimer → js/effects/visuals.js
// _speedLinesFadeT / _streakPool / _streakColorCache → js/effects/visuals.js
// (Drift/nitro/boost-trail/ghost/pitstop/AI-mistakes/rev-limiter/gap/
//  collision-flash/quick-restart/weather-forecast/rear-mirror visuals
//  → js/effects/visuals.js, gameplay/*, ui/hud.js.)
// _RPM_* + _lastRedline → js/effects/visuals.js
// ══ MAIN LOOP ════════════════════════════════
clock=new THREE.Clock();
// loop() + FPS/quality state → js/core/loop.js

// ══ TOUCH CONTROLS ══════════════════════════
// _touchControlsReady, _wakeLock, _hwKeyboardDetected,
// _acquireWakeLock + visibilitychange-listener,
// _HAPTIC_MS + _ALSO_GAS → js/ui/touch.js
// HW-keyboard detection listener → js/ui/input.js
// (_resetRaceState → js/gameplay/race.js)
// ══ BOOT ════════════════════════════════════
// boot() + helpers → js/core/boot.js. Aanroep blijft hier zodat alle
// top-level globals in dit bestand eerst geinitialiseerd zijn.
if(window.perfMark)perfMark('boot:start');
boot();
