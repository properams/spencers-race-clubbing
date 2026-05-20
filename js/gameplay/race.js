// js/gameplay/race.js — race-lifecycle reset (oude main.js _resetRaceState).
// Non-module script, geladen vóór ui/navigation.js (de enige call-site).
//
// Schrijft naar talloze script-globals (per-race state) verspreid over
// main.js, world-modules en gameplay-modules. Letterlijk verhuisd —
// geen gedragswijziging.

'use strict';

// Lap timing (uit main.js verhuisd). Cross-script gemuteerd door
// ui/navigation.js (countdown→start zet lapStartTime), gameplay/tracklimits.js
// (S/F-line crossing herstart lapStartTime + zet lastLapTime).
let lapStartTime=0,lastLapTime=0;

// Per-race statistieken (uit main.js verhuisd).
//   _raceMaxSpeed     — top speed bereikt deze race (achievements.js)
//   _raceOvertakes    — aantal posities gewonnen (achievements.js + finish.js)
//   _lastPlayerPos    — positie vorige tick (overtake-detector)
//   _raceStartGrace   — grace-counter na go (cars/physics.js + ai.js)
//   _lapTimes         — array van per-lap tijden
//   _newUnlocks       — cars vrijgespeeld deze race (finish-screen toast)
//   _nitroUseCount    — nitro-activaties deze race (achievements NITRO_JUNKIE)
//   _airborneAccum    — luchttijd-accumulator (achievement FLYING)
//   _cleanLapFlag     — geen recovery in deze ronde (achievement CLEAN_LAP)
//
// Dead-code (nergens gelezen of geschreven, waarschijnlijk uit ouder
// design — zou later ge-her-introduceerd kunnen worden via achievements):
//   _newUnlocks, _totalNitroUses, _winStreak  → verwijderd.
let _raceMaxSpeed=0,_raceOvertakes=0,_lastPlayerPos=9,_raceStartGrace=0;
const _lapTimes=[];
let _nitroUseCount=0,_airborneAccum=0,_cleanLapFlag=true;
// _raceGoTime: _nowSec snapshot at countdown GO. Gebruikt door achievements.js
// voor een 15s grace-window waarin in-race achievements niet vuren. 0 betekent
// "race nog niet officieel gestart" — _raceSecondsSinceGo() geeft dan 0 terug.
let _raceGoTime=0;
let _speedDemonAccum=0;

function _resetRaceState(){
  // Safety-net: als goToRace door een edge-case crashte tijdens de async
  // overlay-fase blijft _raceStartInProgress anders true en blokkeert de
  // volgende Race-knop. Reset hier zodat een quit-during-anything pad
  // altijd opnieuw racen toestaat.
  window._raceStartInProgress = false;
  if(musicSched){musicSched.stop();musicSched=null;}
  setTimeout(()=>{if(musicSched){musicSched.stop();musicSched=null;}},100);
  // Pre-built RaceMusic instance uit countdown opruimen als gebruiker quit
  // tijdens countdown (instance was geconstrueerd, .start() niet aangeroepen).
  if(window._pendingRaceMusic){
    try{window._pendingRaceMusic.stop&&window._pendingRaceMusic.stop();}catch(_){}
    window._pendingRaceMusic=null;
  }
  if(titleMusic){titleMusic.stop();titleMusic=null;}
  if(selectMusic){selectMusic.stop();selectMusic=null;}
  // Reset dynamic music state for clean slate. _musicMuted is dubbel-
  // geclaimed (pause-mute + M-key mute) en wordt nergens anders gereset —
  // zonder dit blijft een Quit-vanuit-pause _musicMaster permanent op
  // gain 0 voor de rest van de sessie. Resync naar de echte M-key state
  // zodat een legitieme mute blijft staan en pause-mute wordt opgeruimd.
  _musicDuck=1.0;_musicMuted=!!audioMuted;_applyMusicGain(0);
  Audio.stopWind();Audio.stopCrowd();Audio.stopSandstormWind();Audio.stopEngine();
  if(typeof stopWorldAmbient==='function')stopWorldAmbient();
  carObjs.forEach(c=>scene.remove(c.mesh));carObjs=[];
  // Skid-mark geometry is shared across all marks; only dispose materials per mark.
  skidMarks.forEach(s=>{const m=s.mesh||s;if(m.material)m.material.dispose();scene.remove(m);});
  skidMarks.length=0;
  nitroLevel=100;nitroActive=false;driftScore=0;driftTimer=0;
  lapStartTime=0;lastLapTime=0;bestLapTime=Infinity;
  recoverActive=false;recoverTimer=0;camShake=0;slipTimer=0;_slipBonusGiven=false;
  _hitPauseTimer=0;_musicDuckTimer=0;_musicDuckTarget=1.0;_gridPos.length=0;
  _nemesisIdx=-1;
  const _nemEl=document.getElementById('nemesisBadge');if(_nemEl)_nemEl.style.display='none';
  _wrongWayTimer=0;_miniTurboReady=false;_camLateralT=0;_tireWarnCooldown=0;
  _camView=0;_raceMaxSpeed=0;_raceOvertakes=0;_lastPlayerPos=9;_raceStartGrace=0;
  _raceGoTime=0;_speedDemonAccum=0;
  // Defensive: clear cinematic-intro state so a quit-mid-countdown
  // doesn't leave _introActive=true into the next race-init (B1 latch).
  if(typeof endIntroCamera==='function')endIntroCamera();
  _achieveUnlocked.clear();
  _nitroUseCount=0;_airborneAccum=0;_cleanLapFlag=true;_driftAccum=0;
  _sandstormLap3CleanFlag=false;_sandstormPrevLap=0;
  // Reset tracklimits stuck-recovery trackers so a stale entry-time from a
  // prior race can't fire a false "recovery hung >5s" warn on race-start.
  if(typeof _tlRecoveryEntryT!=='undefined')_tlRecoveryEntryT=0;
  if(typeof _tlStuckRecoveryWarned!=='undefined')_tlStuckRecoveryWarned=false;
  _bestS1=Infinity;_bestS2=Infinity;_bestS3=Infinity;_currentSector=0;_sectorStart=0;
  _comboCount=0;_comboMult=1.0;_comboTimer=0;_lastRaceCoins=0;
  // Hide the combo HUD element. _comboTimer decay used to clear opacity but
  // a mid-race quit→retry left "Nx COMBO" visible into the next countdown.
  if(typeof resetCombo==='function')resetCombo();
  _lapTimes.length=0;_weatherForecastTimer=0;_weatherForecastFired=false;
  _rstHold=0;_colFlashT=0;
  _ghostPos.length=0;_ghostBest=[];_ghostSampleT=0;_ghostPlayT=0;
  if(_ghostMesh)_ghostMesh.visible=false;
  const gl=document.getElementById('ghostLabel');if(gl)gl.style.display='none';
  if(_speedLinesCvs)_speedLinesCvs.style.opacity='0';
  _rainIntensity=_rainTarget; // snap to current rain state (no lingering transition)
  if(_elWrongWay)_elWrongWay.style.display='none';
  totalScore=0;
  if(_elLapDelta){_elLapDelta.textContent='';_elLapDelta.style.color='';}
  const _sf=document.getElementById('sFinish');if(_sf)_sf.classList.remove('finPulsing');
  const _sov=document.getElementById('speedOverlay');if(_sov)_sov.style.opacity='0';
  if(_boostLight)_boostLight.intensity=0;
  if(_safetyCar){scene.remove(_safetyCar.mesh);_safetyCar=null;}
  // Volcano/Arctic cleanup
  _volcanoLavaRivers.length=0;_volcanoGeisers.length=0;_volcanoEruption=null;_volcanoEruptionTimer=3;_volcanoEmbers=null;_volcanoEmberGeo=null;_volcanoGlowLight=null;
  // Sandstorm cleanup — mirror volcano's pattern. disposeScene() releases
  // the actual Three resources; here we drop our refs so the next build
  // doesn't accidentally read into freed memory.
  if(typeof _sandstormSandSwept!=='undefined')_sandstormSandSwept=null;
  if(typeof _sandstormFlecksGeo!=='undefined')_sandstormFlecksGeo=null;
  if(typeof _sandstormFlecks!=='undefined')_sandstormFlecks=null;
  if(typeof _sandstormPalmLeaves!=='undefined')_sandstormPalmLeaves.length=0;
  if(typeof disposeVolcanoBridge==='function')disposeVolcanoBridge();
  if(typeof disposeArcticIceShelf==='function')disposeArcticIceShelf();
  if(typeof disposeCandyChocoBridge==='function')disposeCandyChocoBridge();
  if(typeof disposeThemeparkCoaster==='function')disposeThemeparkCoaster();
  if(typeof disposeSandstormStorm==='function')disposeSandstormStorm();
  if(typeof disposeSpaceAnomaly==='function')disposeSpaceAnomaly();
  if(typeof disposeDeepSeaCurrent==='function')disposeDeepSeaCurrent();
  // Grand Prix has no per-world extras module, so its night-sky cache
  // cleanup hooks straight into _resetRaceState alongside the other
  // worlds' extras-disposes.
  if(typeof _disposeGrandPrixSkyCache==='function')_disposeGrandPrixSkyCache();
  // Phase 8.2 — reset dirt accumulation op alle cars bij race-restart.
  if(typeof window!=='undefined' && typeof window._resetDirt==='function')window._resetDirt();
  _arcticIcePatches.length=0;_arcticAurora.length=0;_arcticBlizzardGeo=null;
  _lastGear=1;_currentGear=1;_lastPPos=0;_lastLeaderOrder='';
  _leaderPendingKey='';_leaderStableT=0;_posStableValue=0;_posStableT=0;
  gamePaused=false;
  // Reset pause-button glyph if a previous race ended while paused.
  if(typeof _setPauseGlyph==='function')_setPauseGlyph(false);
  // Desktop-freeze fix: clear race-1-frame markers so the next race kan
  // opnieuw correct meten EN zodat de auto-quality-downgrade detector
  // (zie loop.js QUALITY_CHECK_FRAME_*) opnieuw zijn venster krijgt. Zonder
  // deze reset blijven _aiFrameCounter/_perfChecked/_perfBadFrames vastzitten
  // op race 1's eindwaarden — _perfChecked=true betekent dat de downgrade
  // NOOIT meer kan engagen, ook al heeft race 2 op een trage machine duidelijk
  // freezes. _waitingForFirstRaceFrame moet ook gereset om de eerste-frame
  // telemetrie betrouwbaar te houden bij quit-during-countdown → re-Race.
  if(typeof window._resetLoopPerfCounters==='function')window._resetLoopPerfCounters();
  window._waitingForFirstRaceFrame=false;
  Object.keys(keys).forEach(k=>delete keys[k]);
  document.getElementById('pauseOverlay').style.display='none';
  document.getElementById('sFinish').classList.add('hidden');
  document.body.classList.remove('state-finish');
  document.getElementById('hud').style.display='none';
  if(_elWarn)_elWarn.style.display='none';
  // Notify drains zelf via _clearAll op gameState-transitie naar COUNTDOWN.
  document.getElementById('controlHints').style.display='none';
  const tc=document.getElementById('touchControls');if(tc)tc.style.display='none';
  const mf=document.getElementById('mirrorFrame'),ml=document.getElementById('mirrorLabel');
  if(mf)mf.style.display='none';if(ml)ml.style.display='none';
  const rb=document.getElementById('rstBar'),rl=document.getElementById('rstLabel');
  if(rb)rb.style.display='none';if(rl)rl.style.display='none';
  const f1=document.getElementById('f1Lights');if(f1)f1.style.display='none';
  const cf=document.getElementById('colFlash');if(cf)cf.style.opacity='0';
  _revLimiterTimer=0;_titleCamT=0;
  const dbEl=document.getElementById('driftBar');if(dbEl)dbEl.style.display='none';
  const dlEl=document.getElementById('driftLabel');if(dlEl)dlEl.style.display='none';
  const gcEl=document.getElementById('goldCelebration');if(gcEl)gcEl.style.opacity='0';
  // Reset tire temps (cold start)
  _tireTemp={fl:.08,fr:.08,rl:.08,rr:.08};
  _wasBraking=false;_speedTrapMax=0;_speedTrapFired=false;
  ['FL','FR','RL','RR'].forEach(c=>{const el=document.getElementById('tt'+c);if(el)el.style.background='#4488ff';});
  [1,2,3].forEach(s=>{const el=document.getElementById('secT'+s);if(el){el.textContent='--.-';el.style.color='#666';}});
  // Reset new systems
  _pitStopActive=false;_pitStopTimer=0;_pitStopUsed=false;
  _fastestLapFlashT=0;_closeBattleTimer=0;
  const pitOv=document.getElementById('pitStopOverlay');if(pitOv)pitOv.style.display='none';
  const flEl=document.getElementById('fastestLapFlash');if(flEl)flEl.style.opacity='0';
  const cbEl=document.getElementById('closeBattleEl');if(cbEl)cbEl.style.display='none';
  for(let i=0;i<_nearMissCooldown.length;i++)_nearMissCooldown[i]=0;
}
