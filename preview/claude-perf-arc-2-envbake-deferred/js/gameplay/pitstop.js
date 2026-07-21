// js/gameplay/pitstop.js — non-module script.

'use strict';

// Pit-stop state (uit main.js verhuisd). _pitStopUsed is per-race-eenmalig:
// na het rondsturen wordt 'm true en blijft tot resetRaceState in race.js.
// Cross-script gelezen door cars/physics.js (speed=0 tijdens stop),
// ui/input.js + ui/hud.js (knop alleen bij car.lap>1 en !active && !used),
// gameplay/finish.js (penalty-note bij _pitStopUsed).
let _pitStopActive=false,_pitStopTimer=0,_pitStopUsed=false;

function triggerPitStop(){
  if(_pitStopActive||_pitStopUsed)return;
  const car=carObjs[playerIdx];if(!car)return;
  _pitStopActive=true;_pitStopTimer=0;
  car.speed=0;
  const ov=document.getElementById('pitStopOverlay');
  if(ov)ov.style.display='flex';
  showBanner('🔧 PIT STOP!','#00ee66',500);
  beep(440,.12,.3,0,'square');beep(880,.1,.22,.1,'square');
  // Music ducking: race-muziek zakt naar 40% tijdens pit stop
  _musicDuck=0.4;_applyMusicGain(0.4);
}

// Cached pit-stop DOM refs + last-applied sub text. updatePitStop runs
// every frame during the 2.5s stop; cached refs avoid the getElementById
// triplet per frame and the textContent sentinel skips identical writes.
let _psFillEl=null,_psSubEl=null,_psOvEl=null,_psLastSub='';
function updatePitStop(dt){
  if(!_pitStopActive)return;
  const PIT_DUR=2.5;
  _pitStopTimer+=dt;
  if(!_psFillEl){
    _psFillEl=document.getElementById('pitCountFill');
    _psSubEl=document.getElementById('pitStopSub');
    _psOvEl=document.getElementById('pitStopOverlay');
  }
  if(_psFillEl)_psFillEl.style.width=(_pitStopTimer/PIT_DUR*100)+'%';
  const car=carObjs[playerIdx];
  if(car)car.speed=0;
  if(_pitStopTimer>=PIT_DUR){
    _pitStopActive=false;_pitStopUsed=true;
    if(_psOvEl)_psOvEl.style.display='none';
    // Music ducking off
    _musicDuck=1.0;_applyMusicGain(0.4);
    // Full service
    if(car){car.tireWear=0;car.hitCount=0;}
    nitroLevel=100;
    showBanner('✅ TYRES CHANGED! GO GO GO!','#00ee66',2500);
    floatText('🔧 FRESH TYRES!','#00ee66',innerWidth*.5,innerHeight*.45);
    beep(523,.1,.4,0,'sine');beep(659,.12,.35,.1,'sine');beep(784,.14,.3,.2,'sine');beep(1047,.16,.28,.32,'sine');
    if(_psSubEl){_psSubEl.textContent='SERVICING...';_psLastSub='SERVICING...';}
    if(_psFillEl)_psFillEl.style.width='0%';
  }else{
    let _want;
    if(_pitStopTimer<.6)_want='STOPPING...';
    else if(_pitStopTimer<PIT_DUR-.3)_want='SERVICING... '+Math.ceil(PIT_DUR-_pitStopTimer)+'s';
    else _want='GO GO GO!';
    if(_psSubEl&&_want!==_psLastSub){_psLastSub=_want;_psSubEl.textContent=_want;}
  }
}

