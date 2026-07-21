// settings.js — full-screen Light Edition Settings panel.
//
// Wires up:
//   - goToSettings() / closeSettings() screen show/hide
//   - sidebar nav (5 sections: Audio / Graphics / Controls / Gameplay / Account)
//   - Audio: master / music / sfx sliders, mute-when-out-of-focus toggle
//   - Graphics: quality preset (auto/high/mid/low) + post-FX toggle
//   - Controls: keyboard reference + touch-UI mode + gamepad live status +
//               stick deadzone + trigger threshold
//   - Gameplay: difficulty + default lap count (shared with SELECT screen)
//   - persistence: localStorage key "src.settings.v2"
//
// Audio plumbing lives in js/audio/engine.js (_applyMasterGain / _applySfxGain).
// Quality plumbing lives in js/core/quality-tier.js + js/ui/pause.js.
// Gamepad tunables live in js/ui/gamepad.js (_gamepadSetDeadzone / _gamepadSetTrigThresh).

const STORAGE_KEY = 'src.settings.v2';
const DEFAULTS = {
  master: 78,
  music: 72,
  sfx: 78,
  muteOOF: true,
  touchUi: 'auto',
  gamepadDeadzone: 18,   // percent — converted to 0..1 before applying
  gamepadTrigThresh: 10, // percent — converted to 0..1 before applying
  section: 'audio'
};

let _settings = null;
let _previousScreen = null; // remember where we came from so closeSettings() returns there
let _gpRefreshTimer = null; // 1Hz controller-name refresh while panel is open

function _load(){
  if(_settings) return _settings;
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const d = JSON.parse(raw);
      _settings = Object.assign({}, DEFAULTS, d || {});
    } else {
      _settings = Object.assign({}, DEFAULTS);
    }
  } catch(e){
    _settings = Object.assign({}, DEFAULTS);
  }
  return _settings;
}

function _save(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(_settings)); }
  catch(e){ /* private mode etc — silent */ }
}

// Apply values to live audio graph. Soft-fails when audio is not yet
// initialised — values are reapplied automatically next time settings open.
function _applyAudio(){
  const s = _settings;
  // Music — write canonical _musicVolume + re-apply so duck/mute logic picks
  // up the new base value instead of clobbering it 200ms later.
  try{
    window._musicVolume = s.music / 100;
    if(typeof window._applyMusicGain === 'function') window._applyMusicGain(0.15);
  } catch(e){ /* music engine not ready */ }
  // Master — _muteGain composes user volume × OOF state × hard-mute. Set
  // _masterVolume and let _applyMasterGain recompute.
  try{
    window._masterVolume = s.master / 100;
    if(typeof window._applyMasterGain === 'function') window._applyMasterGain(0.1);
  } catch(e){ /* audio engine not ready */ }
  // SFX bus — separate GainNode covering engine, tires, beeps, crashes.
  try{
    window._sfxVolume = s.sfx / 100;
    if(typeof window._applySfxGain === 'function') window._applySfxGain(0.1);
  } catch(e){ /* audio engine not ready */ }
  // OOF flag — read by engine.js visibilitychange handler.
  window._settingsMuteOOF = !!s.muteOOF;
}

function _applyGamepad(){
  const s = _settings;
  try{
    if(typeof window._gamepadSetDeadzone === 'function')
      window._gamepadSetDeadzone(s.gamepadDeadzone / 100);
    if(typeof window._gamepadSetTrigThresh === 'function')
      window._gamepadSetTrigThresh(s.gamepadTrigThresh / 100);
  } catch(e){}
}

// Touch-UI override: 'auto' lets touch.js decide (default behaviour),
// 'on'/'off' forces the on-screen control overlay regardless of device.
function _applyTouchUi(){
  const mode = _settings.touchUi || 'auto';
  document.documentElement.classList.toggle('forceTouchUi', mode === 'on');
  document.documentElement.classList.toggle('hideTouchUi', mode === 'off');
  window._forceTouchUi = (mode === 'on');
  // Ensure listeners exist when forcing on a non-touch device.
  if(mode === 'on' && typeof window.initTouchControls === 'function'){
    try{ window.initTouchControls(); } catch(_){}
  }
}

function _setSection(name){
  _settings.section = name;
  _save();
  document.querySelectorAll('#setNav .setNavItem').forEach(btn => {
    btn.classList.toggle('setNavItemActive', btn.dataset.setSection === name);
  });
  document.querySelectorAll('#setPanel .setSection').forEach(sec => {
    sec.classList.toggle('setSectionActive', sec.dataset.setPane === name);
  });
  // Refresh dynamic UI on tab open
  if(name === 'graphics') _refreshGraphicsUI();
  if(name === 'controls') _refreshControlsUI();
  if(name === 'gameplay') _refreshGameplayUI();
  if(name === 'account'){
    if(typeof window.initProfile === 'function') window.initProfile();
    if(typeof window.renderProfile === 'function') window.renderProfile();
  }
}

function _bindSlider(id, key, onChange){
  const input = document.getElementById(id);
  const valEl = document.getElementById(id + 'Val');
  if(!input) return;
  const v = _settings[key];
  input.value = v;
  input.style.setProperty('--p', v);
  if(valEl) valEl.textContent = v + '%';
  input.addEventListener('input', () => {
    const nv = parseInt(input.value, 10);
    _settings[key] = nv;
    input.style.setProperty('--p', nv);
    if(valEl) valEl.textContent = nv + '%';
    if(onChange) onChange();
    _save();
  });
}

function _bindToggle(id, key, onChange){
  const input = document.getElementById(id);
  if(!input) return;
  input.checked = !!_settings[key];
  input.addEventListener('change', () => {
    _settings[key] = !!input.checked;
    if(onChange) onChange();
    _save();
  });
}

function _bindSelect(id, key, onChange){
  const sel = document.getElementById(id);
  if(!sel) return;
  sel.value = _settings[key] || sel.value;
  sel.addEventListener('change', () => {
    _settings[key] = sel.value;
    if(onChange) onChange();
    _save();
  });
}

// ── Graphics ─────────────────────────────────────────────────────────────
function _refreshGraphicsUI(){
  let pin = 'auto';
  try{ pin = localStorage.getItem('srcQualityPin') || 'auto'; } catch(_){}
  if(['auto','high','mid','low'].indexOf(pin) === -1) pin = 'auto';
  const activeKey = (pin === 'auto') ? 'auto' : (window._qTier || pin);
  document.querySelectorAll('#setQualRow .setPill').forEach(p => {
    p.classList.toggle('setPillActive', p.dataset.setQual === activeKey);
  });
  const lbl = document.getElementById('setQualVal');
  if(lbl) lbl.textContent = (pin === 'auto' ? 'AUTO' : (activeKey || pin).toUpperCase());
  const hint = document.getElementById('setQualHint');
  if(hint) hint.style.display = (pin === 'auto') ? '' : 'none';
  // Post-FX toggle reflects current renderer state when available.
  const fx = document.getElementById('setFxToggle');
  if(fx){
    const enabled = !!(typeof _postfx !== 'undefined' && _postfx && _postfx.enabled);
    const ready   = !!(typeof _postfx !== 'undefined' && _postfx && _postfx.ready);
    fx.checked = enabled;
    fx.disabled = !ready;
  }
}

function _bindGraphics(){
  document.querySelectorAll('#setQualRow .setPill').forEach(p => {
    p.addEventListener('click', () => {
      if(typeof window.setQualityPin === 'function') window.setQualityPin(p.dataset.setQual);
      _refreshGraphicsUI();
    });
  });
  const fx = document.getElementById('setFxToggle');
  if(fx){
    fx.addEventListener('change', () => {
      if(typeof window.toggleQuality === 'function') window.toggleQuality();
      _refreshGraphicsUI();
    });
  }
}

// ── Controls ─────────────────────────────────────────────────────────────
function _refreshControlsUI(){
  const out = document.getElementById('setGpStatus');
  if(!out) return;
  let name = 'No controller detected';
  try{
    const pads = navigator.getGamepads && navigator.getGamepads();
    if(pads){
      for(let i = 0; i < pads.length; i++){
        if(pads[i] && pads[i].connected){ name = pads[i].id || 'Connected'; break; }
      }
    }
  } catch(_){}
  out.textContent = name;
}

function _bindControls(){
  _bindSelect('setTouchUi', 'touchUi', _applyTouchUi);
  _bindSlider('setGpDead', 'gamepadDeadzone', _applyGamepad);
  _bindSlider('setGpTrig', 'gamepadTrigThresh', _applyGamepad);
  window.addEventListener('gamepadconnected', _refreshControlsUI);
  window.addEventListener('gamepaddisconnected', _refreshControlsUI);
}

// ── Gameplay ─────────────────────────────────────────────────────────────
const DIFF_NAMES = ['Easy', 'Normal', 'Hard'];
function _readDifficulty(){
  // Source of truth lives on the SELECT screen (window.difficulty / src_difficulty).
  let d = (typeof window.difficulty === 'number') ? window.difficulty : null;
  if(d === null){
    try{ d = parseInt(localStorage.getItem('src_difficulty'), 10); } catch(_){}
  }
  if(!(d === 0 || d === 1 || d === 2)) d = 1;
  return d;
}
function _readLaps(){
  let l = (typeof window._selectedLaps === 'number') ? window._selectedLaps : null;
  if(l === null){
    try{ l = parseInt(localStorage.getItem('src_selectedLaps'), 10); } catch(_){}
  }
  if(!(l === 1 || l === 3 || l === 5)) l = 3;
  return l;
}
function _refreshGameplayUI(){
  const d = _readDifficulty(), l = _readLaps();
  document.querySelectorAll('#setDiffRow .setPill').forEach(p => {
    p.classList.toggle('setPillActive', +p.dataset.setDiff === d);
  });
  document.querySelectorAll('#setLapsRow .setPill').forEach(p => {
    p.classList.toggle('setPillActive', +p.dataset.setLaps === l);
  });
  const dv = document.getElementById('setDiffVal');
  if(dv) dv.textContent = DIFF_NAMES[d];
  const lv = document.getElementById('setLapsVal');
  if(lv) lv.textContent = l + ' lap' + (l > 1 ? 's' : '');
}
function _bindGameplay(){
  document.querySelectorAll('#setDiffRow .setPill').forEach(p => {
    p.addEventListener('click', () => {
      const d = parseInt(p.dataset.setDiff, 10);
      window.difficulty = d;
      try{ localStorage.setItem('src_difficulty', d); } catch(_){}
      _refreshGameplayUI();
    });
  });
  document.querySelectorAll('#setLapsRow .setPill').forEach(p => {
    p.addEventListener('click', () => {
      const l = parseInt(p.dataset.setLaps, 10);
      window._selectedLaps = l;
      if(typeof window.TOTAL_LAPS !== 'undefined') window.TOTAL_LAPS = l;
      try{ localStorage.setItem('src_selectedLaps', l); } catch(_){}
      _refreshGameplayUI();
    });
  });
}

let _initialised = false;
function _initOnce(){
  if(_initialised) return;
  _initialised = true;
  _load();

  // Sidebar nav
  document.querySelectorAll('#setNav .setNavItem').forEach(btn => {
    btn.addEventListener('click', () => _setSection(btn.dataset.setSection));
  });

  // Audio
  _bindSlider('setMaster', 'master', _applyAudio);
  _bindSlider('setMusic', 'music', _applyAudio);
  _bindSlider('setSfx', 'sfx', _applyAudio);
  _bindToggle('setMuteOOF', 'muteOOF', _applyAudio);

  // Graphics / Controls / Gameplay panels
  _bindGraphics();
  _bindControls();
  _bindGameplay();

  // Close button
  const closeBtn = document.getElementById('setCloseBtn');
  if(closeBtn) closeBtn.addEventListener('click', closeSettings);

  // Esc key while settings is open
  document.addEventListener('keydown', (e) => {
    const open = document.getElementById('sSettings');
    if(!open || open.classList.contains('hidden')) return;
    if(e.key === 'Escape'){ e.preventDefault(); closeSettings(); }
  });

  // Restore last-active section
  _setSection(_settings.section || 'audio');
  // Apply current audio + gamepad + touch values once
  _applyAudio();
  _applyGamepad();
  _applyTouchUi();
}

function goToSettings(){
  _initOnce();
  // Remember which screen was visible so we can return.
  const screens = ['sTitle','sWorld','sSelect','sFinish'];
  _previousScreen = null;
  for(const id of screens){
    const el = document.getElementById(id);
    if(el && !el.classList.contains('hidden')){
      _previousScreen = id;
      el.classList.add('hidden');
      break;
    }
  }
  const set = document.getElementById('sSettings');
  if(set) set.classList.remove('hidden');
  // Re-apply audio in case context was suspended at init time.
  _applyAudio();
  // Refresh dynamic UI for currently-visible section.
  _refreshGraphicsUI();
  _refreshControlsUI();
  _refreshGameplayUI();
  // Poll controller name once per second while panel is open — covers
  // controllers that don't fire gamepadconnected (some Bluetooth pads).
  if(_gpRefreshTimer) clearInterval(_gpRefreshTimer);
  _gpRefreshTimer = setInterval(_refreshControlsUI, 1000);
}

function closeSettings(){
  const set = document.getElementById('sSettings');
  if(set) set.classList.add('hidden');
  const back = _previousScreen ? document.getElementById(_previousScreen) : null;
  if(back){
    back.classList.remove('hidden');
  } else if(typeof window.goToTitle === 'function'){
    window.goToTitle();
  }
  _previousScreen = null;
  if(_gpRefreshTimer){ clearInterval(_gpRefreshTimer); _gpRefreshTimer = null; }
}

function getSettings(){ return _load(); }

window.goToSettings = goToSettings;
window.closeSettings = closeSettings;
window.getSettings = getSettings;

// Auto-init values on script load so audio gain, gamepad tunables and the
// OOF flag reflect user prefs even before the user opens Settings.
try{
  _load();
  window._settingsMuteOOF = _settings.muteOOF;
  window._masterVolume = _settings.master / 100;
  window._musicVolume = _settings.music / 100;
  window._sfxVolume = _settings.sfx / 100;
  // Gamepad applies on next gamepad.js poll once script is loaded.
  setTimeout(() => { _applyGamepad(); _applyTouchUi(); }, 0);
} catch(e){}
