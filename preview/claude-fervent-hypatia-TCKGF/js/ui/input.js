// js/ui/input.js — keyboard event handlers (game-state hotkeys + HW-keyboard detection).
// Non-module script, geladen vóór main.js.
//
// Afhankelijkheden (script-globals):
//   keys, gameState, _camView, _mirrorEnabled
//   carObjs, playerIdx, _pitStopActive, _pitStopUsed
//   _hwKeyboardDetected, _touchControlsReady (in main.js gedeclareerd)
//   _fpsShow (in core/loop.js gedeclareerd)
//   togglePause, toggleMute (ui/pause.js)
//   showPopup (ui/hud.js)
//   setCamView (gameplay/camera.js)
//   triggerPitStop (gameplay/pitstop.js)

'use strict';

window.addEventListener('keydown',e=>{
  keys[e.code]=true;
  if(e.code==='Space'){e.preventDefault();if(gameState==='RACE')togglePause();}
  if(e.code==='KeyP'&&gameState==='RACE')togglePause();
  if(e.code==='Escape'&&gameState==='RACE'){e.preventDefault();togglePause();}
  if(gameState==='FINISH'){
    if(e.code==='Escape'){e.preventDefault();if(typeof goToTitle==='function')goToTitle();return;}
    if(e.code==='Enter'){e.preventDefault();if(typeof goToSelectAgain==='function')goToSelectAgain();return;}
  }
  if(e.code==='KeyM')toggleMute();
  if(e.code==='F3'){e.preventDefault();_fpsShow=!_fpsShow;const fo=document.getElementById('fpsOverlay');if(fo)fo.style.display=_fpsShow?'block':'none';}
  if(e.code==='KeyC'&&(gameState==='RACE'||gameState==='FINISH')){
    _camView=(_camView+1)%4;
    const names=['CHASE CAM','HELI CAM','HOOD CAM','BUMPER CAM'];
    showPopup(names[_camView],'#88ddff',900);
    setCamView(_camView);
    // Hide mirror for non-chase views
    const mf=document.getElementById('mirrorFrame'),ml=document.getElementById('mirrorLabel');
    if(mf)mf.style.display=_camView===0?'block':'none';
    if(ml)ml.style.display=_camView===0?'block':'none';
  }
  if(e.code==='KeyV'&&(gameState==='RACE')){
    _mirrorEnabled=!_mirrorEnabled;
    const mf=document.getElementById('mirrorFrame'),ml=document.getElementById('mirrorLabel');
    if(mf)mf.style.display=_mirrorEnabled&&_camView===0?'block':'none';
    if(ml)ml.style.display=_mirrorEnabled&&_camView===0?'block':'none';
    showPopup(_mirrorEnabled?'MIRROR ON':'MIRROR OFF','#88ddff',700);
  }
  if(e.code==='KeyL'&&gameState==='RACE'){
    window._leaderExpanded=!window._leaderExpanded;
    showPopup(window._leaderExpanded?'LEADERBOARD: FULL':'LEADERBOARD: COMPACT','#88ddff',900);
  }
  if(e.code==='KeyJ'&&gameState==='RACE'){
    // Day/night toggle — niet KeyN want die triggert nitro (cars/physics.js).
    // toggleNight() doet zelf de smooth fog-blend + headlight-sync + bloom-
    // tweak, dus geen extra werk hier.
    if(typeof toggleNight==='function')toggleNight();
  }
  if(e.code==='KeyH'&&gameState==='RACE'){
    const car=carObjs[playerIdx];
    if(car&&!_pitStopActive&&!_pitStopUsed){
      const pz=car.mesh.position.z,px=car.mesh.position.x;
      if(pz>168&&pz<215&&px>-200&&px<215){
        triggerPitStop();
      }else{
        showPopup('PIT ENTRY ON MAIN STRAIGHT','#ff9900',1200);
      }
    }
  }
});
window.addEventListener('keyup',e=>{keys[e.code]=false;});

// iPad with an external keyboard still flags as touch device. Watch for actual game-relevant
// key presses and hide the on-screen controls once real keyboard input is seen.
const _HW_KB_KEYS=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space',
  'KeyW','KeyA','KeyS','KeyD','KeyN','KeyH','KeyR','KeyP','KeyC','KeyV','KeyM','KeyI','KeyJ','KeyK','KeyL']);
window.addEventListener('keydown',e=>{
  if(_hwKeyboardDetected||!_HW_KB_KEYS.has(e.code))return;
  _hwKeyboardDetected=true;
  _touchControlsReady=false;
  const tc=document.getElementById('touchControls');if(tc)tc.style.display='none';
});

// A/B audio-debug toggle: Shift+P forceert procedurele path, ook als
// samples geladen zijn. Handig voor side-by-side vergelijken bij tuning.
// State wordt door samples.js / engine.js / sfx.js gerespecteerd. Tijdens
// een actieve race wordt de muziek ook direct vervangen (fade + restart
// via dispatcher) zodat je het verschil onmiddellijk hoort.
window.addEventListener('keydown',e=>{
  if(e.code!=='KeyP'||!e.shiftKey)return;
  window._forceProceduralAudio=!window._forceProceduralAudio;
  const msg=window._forceProceduralAudio?'🎛 PROCEDURAL FORCED':'🎛 SAMPLES ENABLED';
  if(typeof showPopup==='function')showPopup(msg,'#ffaa44',1400);
  console.log('[audio]',msg);
  // Mid-race music switch: fade huidige scheduler en start nieuwe via
  // dispatcher. Dispatcher (createStemRaceMusicIfReady) respecteert de
  // toggle, dus de juiste pad wordt automatisch gekozen.
  if(typeof gameState!=='undefined'&&gameState==='RACE'&&window.musicSched&&window.audioCtx){
    if(window._fadeOutMusic)window._fadeOutMusic(window.musicSched,0.35);
    window.musicSched=null;
    setTimeout(()=>{
      if(gameState==='RACE'&&!window.musicSched&&window.audioCtx&&window._safeStartMusic){
        window.musicSched=window._safeStartMusic(()=>window._createRaceMusicForWorld());
      }
    },420);
  }
});
