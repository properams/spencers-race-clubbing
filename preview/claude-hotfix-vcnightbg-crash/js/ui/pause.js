// js/ui/pause.js — non-module script.

'use strict';

// Inline SVG glyphs voor pause/play — vervangen de Unicode ⏸/▶ glyphs
// die afhankelijk waren van system-font rendering. Gestuurd via
// currentColor zodat de container's CSS color: cascadet. Stroke-width
// 3.5 + linecap:round matcht de visual weight van het 'GAS' label op
// #tcGas zodat pause/play hetzelfde gewicht uitstraalt als de
// counterpart-button rechts onderin.
const _PAUSE_SVG_GLYPH='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><line x1="9" y1="5" x2="9" y2="19" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><line x1="15" y1="5" x2="15" y2="19" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>';
const _PLAY_SVG_GLYPH='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5 L19 12 L8 19 Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

// Helper: zet pause-button glyph + aria-label op een gegeven state.
// Gebruikt door togglePause + race.js bij race-reset.
function _setPauseGlyph(paused){
  const btn=document.getElementById('hudPauseBtn');
  if(!btn)return;
  btn.innerHTML=paused?_PLAY_SVG_GLYPH:_PAUSE_SVG_GLYPH;
  btn.setAttribute('aria-label',paused?'Resume':'Pause');
}
if(typeof window!=='undefined')window._setPauseGlyph=_setPauseGlyph;

function togglePause(){
  if(gameState!=='RACE'){window.dbg&&dbg.log('pause','skip — gameState='+gameState);return;}
  gamePaused=!gamePaused;
  const ov=document.getElementById('pauseOverlay');
  if(!ov){window.dbg&&dbg.error('pause','pauseOverlay element niet gevonden');}
  else ov.style.display=gamePaused?'flex':'none';
  _setPauseGlyph(gamePaused);
  if(gamePaused){
    _logPauseAssetStatus();
    _refreshPauseCamHighlight();
    _refreshPauseFxState();
    _refreshPauseQualityState();
  }
  // Music-ducking via gain ramp in plaats van audioCtx.suspend — suspend breekt setTimeout scheduling.
  _musicMuted=gamePaused;_applyMusicGain(0.2);
  if(typeof setAmbientPaused==='function') setAmbientPaused(gamePaused);
  window.dbg&&dbg.log('pause',gamePaused?'paused':'resumed','overlay='+(ov?ov.style.display:'(missing)'));
}

// Log asset coverage to dbg-ringbuffer / console so testers can still inspect
// HDRI/ground/props loading state on demand. Removed from the visible pause
// overlay 2026-05-09 — the ASSETS [...] line read as production-leaked debug.
function _logPauseAssetStatus(){
  if(!window.Assets||!window.activeWorld)return;
  const s=Assets.status(activeWorld);
  const tick=v=>v?'✓':'✗';
  const pair=([n,t])=>t===0?'—':n+'/'+t;
  const line='ASSETS ['+activeWorld.toUpperCase()+']  HDRI '+tick(s.hdri)+
    '  GROUND '+pair(s.ground)+'  PROPS '+pair(s.props)+'  LAYERS '+pair(s.layers);
  if(window.dbg)dbg.log('pause',line); else console.log(line);
}

// Apply the active-class to the camera button matching the current _camView,
// so reopening the pause overlay reflects the live cam mode set via V-key.
function _refreshPauseCamHighlight(){
  if(typeof _camView!=='number')return;
  for(let i=0;i<4;i++){
    const b=document.getElementById('pcam'+i);
    if(b)b.classList.toggle('active',i===_camView);
  }
}

// Highlight the active quality-pin button. For 'auto' we highlight AUTO; for
// an explicit pin we highlight the effective tier (window._qTier), which can
// differ from localStorage on mobile (high/mid pins are capped to low). That
// keeps the UI honest about what's actually running.
function _refreshPauseQualityState(){
  let pin = 'auto';
  try { pin = localStorage.getItem('srcQualityPin') || 'auto'; } catch(_) {}
  if(pin !== 'auto' && pin !== 'high' && pin !== 'mid' && pin !== 'low') pin = 'auto';
  const activeKey = (pin === 'auto') ? 'auto' : (window._qTier || pin);
  const ids = { auto:'pqAuto', high:'pqHigh', mid:'pqMid', low:'pqLow' };
  for(const k in ids){
    const b = document.getElementById(ids[k]);
    if(b) b.classList.toggle('active', k === activeKey);
  }
  // Only the click-handler shows the AUTO-restart hint; here we just clear it.
  const hint = document.getElementById('pqHint');
  if(hint) hint.style.display = 'none';
}

// Pause-overlay handler — sets the pin via the quality-tier module, then
// refreshes button highlight + FX-button label (FX state can flip because
// pin→low sets window._lowQuality which renderWithPostFX short-circuits on).
function setQualityPin(value){
  if(typeof window._setQualityPin !== 'function') return;
  const res = window._setQualityPin(value);
  _refreshPauseQualityState();
  _refreshPauseFxState();
  // Hint visible only after a fresh click on AUTO — hardware re-detection
  // runs at boot, so AUTO mid-session is a "next race" affair.
  const hint = document.getElementById('pqHint');
  if(hint) hint.style.display = (res && res.requiresRestart) ? '' : 'none';
}
if(typeof window!=='undefined') window.setQualityPin = setQualityPin;

// Sync the FX toggle's label + active-class to the live postfx state.
function _refreshPauseFxState(){
  const b=document.getElementById('btnFxToggle');
  if(!b)return;
  if(typeof _postfx==='undefined'||!_postfx.ready){
    b.textContent='✨ FX N/A';
    b.classList.remove('active');
    return;
  }
  const on=!!_postfx.enabled;
  b.textContent=on?'✨ FX ON':'✨ FX OFF';
  b.classList.toggle('active',on);
}

// Sessie 08 — Photo mode (screenshot). Hides HUD overlay, captures the
// next composited frame from the WebGL canvas, downloads as PNG. The
// render loop is paused (we're in the pause overlay) so we need to
// force one fresh render with HUD hidden before reading the canvas.
function takeScreenshot(){
  const hud = document.getElementById('hud');
  const overlay = document.getElementById('pauseOverlay');
  const cvs = document.getElementById('glCanvas');
  const mirror = document.getElementById('mirrorFrame');
  if(!cvs) return;
  const prevHud = hud ? hud.style.display : '';
  const prevOv  = overlay ? overlay.style.display : '';
  const prevMir = mirror ? mirror.style.display : '';
  if(hud)     hud.style.display = 'none';
  if(overlay) overlay.style.display = 'none';
  if(mirror)  mirror.style.display = 'none';
  // Force one render so the captured frame doesn't show stale buffer.
  try{
    if(typeof renderWithPostFX === 'function' && typeof scene !== 'undefined' && typeof camera !== 'undefined'){
      renderWithPostFX(scene, camera);
    } else if(typeof renderer !== 'undefined' && typeof scene !== 'undefined' && typeof camera !== 'undefined'){
      renderer.render(scene, camera);
    }
  }catch(e){
    if(window.dbg) dbg.warn('photo','force-render failed: '+(e&&e.message||e));
  }
  // Read pixels into a data URL. The renderer no longer carries
  // preserveDrawingBuffer:true (~20% perf saving game-wide). toDataURL
  // works because we just rendered synchronously above and have not yet
  // yielded back to the browser compositor, so the draw buffer is intact.
  try{
    const url = cvs.toDataURL('image/png');
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    a.href = url;
    a.download = 'src-' + (typeof activeWorld!=='undefined'?activeWorld:'race') + '-' + ts + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if(typeof showPopup==='function')showPopup('📷 SCREENSHOT SAVED','#00eeff',1400);
  }catch(e){
    if(typeof showPopup==='function')showPopup('Screenshot failed — browser refused canvas read','#ff4444',2000);
    if(window.dbg) dbg.warn('photo','toDataURL failed: '+(e&&e.message||e));
  }
  if(hud)     hud.style.display = prevHud;
  if(overlay) overlay.style.display = prevOv;
  if(mirror)  mirror.style.display = prevMir;
}
if(typeof window!=='undefined') window.takeScreenshot = takeScreenshot;

function toggleMute(){
  audioMuted=!audioMuted;
  // Hard-mute now routes through _applyMasterGain so it composes with the
  // Settings master-volume slider and out-of-focus mute instead of fighting them.
  window._audioMuted=audioMuted;
  if(typeof window._applyMasterGain==='function') window._applyMasterGain(0.1);
  else if(_muteGain) _muteGain.gain.value=audioMuted?0:1;
  // Ook muziek-master volgt — zo pikt ook de music-master up als iemand _muteGain bypass gebruikt
  _musicMuted=audioMuted;_applyMusicGain(0.1);
  const b=document.getElementById('hudMuteBtn');
  if(b)b.textContent=audioMuted?'🔇':'🔊';
}

