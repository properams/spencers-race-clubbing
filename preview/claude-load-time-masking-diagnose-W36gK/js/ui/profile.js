// js/ui/profile.js — Account tab "Your Light" profile view.
// Classic deferred script (matches the other js/ui/* files). Reads
// window.* progression globals + uses window.getSaveSnapshot etc. for
// export/import. Re-renders on tab open, snapshot import, and wipe.
//
// All DOM IDs match the markup in index.html `[data-set-pane="account"]`.
// Renderer is idempotent and soft-fails when persistence modules are still
// loading (loadPersistent runs in boot.js:550, profile usually renders later
// when the player opens Settings → Account, so order is fine).

(function(){
'use strict';

const DIFF_NAMES = ['Easy', 'Normal', 'Hard'];
const WORLD_NAMES = {
  space:'Cosmic Circuit', deepsea:'Deep Sea', candy:'Sugar Rush',
  volcano:'Volcano', arctic:'Arctic Circuit',
  sandstorm:'Sandstorm Canyon', pier47:'Pier 47',
  guangzhou:'Guangzhou'
};
const TOTAL_WORLDS = Object.keys(WORLD_NAMES).length;

function _fmtTime(sec){
  if(typeof window.fmtClockTime === 'function'){
    const out = window.fmtClockTime(sec);
    return out === '—' ? '—' : out;
  }
  if(!isFinite(sec) || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
}

function _fmtDate(ms){
  if(!ms || !isFinite(ms)) return '—';
  try{
    return new Date(ms).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
  } catch(_){ return '—'; }
}

function _escape(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Identity card ───────────────────────────────────────────────────────────
function _renderIdentity(){
  const handleInput = document.getElementById('profHandle');
  if(handleInput && document.activeElement !== handleInput){
    handleInput.value = window._playerHandle || 'Spencer';
  }
  const lvBadge = document.getElementById('profLevel');
  const xpFill  = document.getElementById('profXpFill');
  const xpText  = document.getElementById('profXpText');
  const coinsEl = document.getElementById('profCoins');

  const lp = (typeof window.getLevelProgress === 'function')
    ? window.getLevelProgress()
    : { level:1, intoLevel:0, span:1, frac:0, maxedOut:false };

  if(lvBadge) lvBadge.textContent = 'LV ' + lp.level;
  if(xpFill)  xpFill.style.width  = (lp.maxedOut ? 100 : Math.round(lp.frac * 100)) + '%';
  if(xpText)  xpText.textContent  = lp.maxedOut ? 'MAX LEVEL' : (lp.intoLevel + ' / ' + lp.span + ' XP');
  if(coinsEl) coinsEl.textContent = (window._coins | 0).toLocaleString();
}

// ── Career stats grid ───────────────────────────────────────────────────────
function _renderStats(){
  const grid = document.getElementById('profStats');
  if(!grid) return;
  const races   = window._raceCount   | 0;
  const podia   = window._podiumCount | 0;
  const totalEarned = window._totalCoinsEarned | 0;
  const trap    = window._speedTrapAllTime | 0;
  const bestLap = (typeof window._savedBL === 'number' && isFinite(window._savedBL)) ? window._savedBL : null;
  const podiumRate = races >= 5 ? Math.round((podia / races) * 100) + '%' : '—';
  const stars = (typeof window.getTotalStars === 'function') ? window.getTotalStars() : { earned:0, max:0 };
  const cupsDone = (window._cupsCompleted && window._cupsCompleted.size) | 0;
  const cupsMaster = (window._cupsMastered && window._cupsMastered.size) | 0;
  const totalCars = (window.CAR_DEFS && window.CAR_DEFS.length) || 13;
  const ownedCars = (window._unlockedCars && window._unlockedCars.size) || 0;
  const ownedWorlds = (window._worldsUnlocked && window._worldsUnlocked.size) || 0;
  const nemesis = (typeof window._getNemesisDefeatedTotal === 'function') ? window._getNemesisDefeatedTotal() : 0;

  const tiles = [
    ['Races',            races.toLocaleString()],
    ['Podiums',          podia + '  (' + podiumRate + ')'],
    ['Stars',            stars.earned + ' / ' + stars.max],
    ['Cups completed',   cupsDone + ' / ' + ((window.CUPS && window.CUPS.length) || 4)],
    ['Cups mastered',    cupsMaster + ' / ' + ((window.CUPS && window.CUPS.length) || 4)],
    ['Cars unlocked',    ownedCars + ' / ' + totalCars],
    ['Worlds unlocked',  ownedWorlds + ' / ' + TOTAL_WORLDS],
    ['Best lap (any)',   bestLap ? _fmtTime(bestLap) : '—'],
    ['Top speed trap',   trap ? trap + ' km/h' : '—'],
    ['Total coins earned', totalEarned.toLocaleString()],
    ['Nemeses defeated', nemesis.toLocaleString()]
  ];
  grid.innerHTML = tiles.map(([lbl,val]) =>
    '<div class="profStat"><div class="profStatLbl">' + _escape(lbl) +
    '</div><div class="profStatVal">' + _escape(val) + '</div></div>'
  ).join('');
}

// ── Cup badges row ──────────────────────────────────────────────────────────
function _renderCups(){
  const row = document.getElementById('profCups');
  if(!row) return;
  if(!window.CUPS){ row.innerHTML = '<p class="setEmpty">Loading cups…</p>'; return; }
  row.innerHTML = window.CUPS.map(cup => {
    const completed = window._cupsCompleted && window._cupsCompleted.has(cup.id);
    const mastered  = window._cupsMastered  && window._cupsMastered.has(cup.id);
    const max = cup.worlds.length * 9;
    let earned = 0;
    if(window._stars){
      for(const w of cup.worlds) for(let d = 0; d < 3; d++) earned += (window._stars[w + '_' + d] | 0);
    }
    const pct = max > 0 ? Math.round((earned / max) * 100) : 0;
    const prefix = mastered ? '⭐ ' : completed ? '✓ ' : '';
    const cls = 'profCup' + (completed ? ' profCupDone' : '') + (mastered ? ' profCupMaster' : '');
    return '<div class="' + cls + '">' +
      '<div class="profCupTop"><span class="profCupName">' + _escape(prefix + cup.name) + '</span>' +
      '<span class="profCupStars">' + earned + '/' + max + '★</span></div>' +
      '<div class="profCupBar"><div class="profCupBarFill" style="width:' + pct + '%"></div></div>' +
      '</div>';
  }).join('');
}

// ── Best laps table ─────────────────────────────────────────────────────────
function _renderLaps(){
  const wrap = document.getElementById('profLaps');
  if(!wrap) return;
  const lr = window._lapRecords || {};
  const keys = Object.keys(lr);
  if(keys.length === 0){
    wrap.innerHTML = '<p class="setEmpty">Geen lap records — race een wereld om hier verschijnen.</p>';
    return;
  }
  // Group by world, sort within group by difficulty ascending.
  const rows = keys.map(k => {
    const i = k.lastIndexOf('_');
    const world = i > 0 ? k.slice(0, i) : k;
    const diff  = i > 0 ? parseInt(k.slice(i + 1), 10) : 0;
    const r = lr[k] || {};
    return {
      world, diff,
      worldName: WORLD_NAMES[world] || world,
      time: r.time, brand: r.brand || '', name: r.name || '', dt: r.dt | 0
    };
  }).sort((a, b) => {
    if(a.worldName !== b.worldName) return a.worldName.localeCompare(b.worldName);
    return a.diff - b.diff;
  });
  const head = '<thead><tr>' +
    '<th>World</th><th>Difficulty</th><th>Best lap</th><th>Car</th><th>Date</th>' +
    '</tr></thead>';
  const body = '<tbody>' + rows.map(r =>
    '<tr><td>' + _escape(r.worldName) + '</td>' +
    '<td>' + _escape(DIFF_NAMES[r.diff] || '?') + '</td>' +
    '<td class="profLapTime">' + _escape(_fmtTime(r.time)) + '</td>' +
    '<td>' + _escape((r.brand + ' ' + r.name).trim() || '—') + '</td>' +
    '<td>' + _escape(_fmtDate(r.dt)) + '</td></tr>'
  ).join('') + '</tbody>';
  wrap.innerHTML = '<table class="profLapsTable">' + head + body + '</table>';
}

// ── Public renderer ─────────────────────────────────────────────────────────
function renderProfile(){
  _renderIdentity();
  _renderStats();
  _renderCups();
  _renderLaps();
  _updateExportedAt();
}

function _updateExportedAt(){
  const el = document.getElementById('profLastExport');
  if(!el) return;
  let ts = 0;
  try{ ts = parseInt(localStorage.getItem('spencerRC_lastExport') || '0', 10) | 0; }catch(_){}
  el.textContent = ts ? ('Laatste export: ' + _fmtDate(ts)) : '';
}

// ── Wiring ──────────────────────────────────────────────────────────────────
function _showToast(msg, isError){
  if(window.Notify && typeof window.Notify.toast === 'function'){
    try{ window.Notify.toast(msg, isError ? 'error' : 'info'); return; }catch(_){}
  }
  // Inline fallback inside the profile panel.
  const el = document.getElementById('profStatusMsg');
  if(el){
    el.textContent = msg;
    el.className = 'profStatusMsg' + (isError ? ' profStatusMsgErr' : ' profStatusMsgOk');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; el.className = 'profStatusMsg'; }, 4200);
  }
}

let _wired = false;
function initProfile(){
  if(_wired) return;
  _wired = true;

  // Handle input — commit on blur or Enter.
  const handleInput = document.getElementById('profHandle');
  if(handleInput){
    const commit = () => {
      if(typeof window.setPlayerHandle === 'function'){
        const next = window.setPlayerHandle(handleInput.value);
        handleInput.value = next; // reflect sanitization
        _renderIdentity();
      }
    };
    handleInput.addEventListener('blur', commit);
    handleInput.addEventListener('keydown', e => {
      if(e.key === 'Enter'){ e.preventDefault(); handleInput.blur(); }
    });
  }

  // Download
  const dlBtn = document.getElementById('profExportBtn');
  if(dlBtn) dlBtn.addEventListener('click', () => {
    try{
      window.downloadSnapshotFile();
      try{ localStorage.setItem('spencerRC_lastExport', String(Date.now())); }catch(_){}
      _updateExportedAt();
      _showToast('Save gedownload.', false);
    } catch(e){
      _showToast('Export mislukt: ' + e.message, true);
    }
  });

  // Import — hidden file input + visible button
  const importBtn  = document.getElementById('profImportBtn');
  const importFile = document.getElementById('profImportFile');
  if(importBtn && importFile){
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
      const f = importFile.files && importFile.files[0];
      importFile.value = ''; // allow re-selecting same file later
      if(!f) return;
      let snap;
      try{ snap = await window.parseSnapshotFile(f); }
      catch(e){ _showToast(e.message, true); return; }
      if(!window.confirm('Dit overschrijft je huidige voortgang. Doorgaan?')) return;
      try{
        window.applySaveSnapshot(snap);
        renderProfile();
        _showToast('Save geïmporteerd.', false);
      } catch(e){
        _showToast('Import mislukt: ' + e.message, true);
      }
    });
  }

  // Reset
  const resetBtn = document.getElementById('profResetBtn');
  if(resetBtn) resetBtn.addEventListener('click', () => {
    if(!window.confirm('Reset alle progressie — coins, level, unlocks, lap records. Audio/graphics-instellingen blijven. Zeker weten?')) return;
    try{
      window.wipeSave();
      renderProfile();
      _showToast('Save gewist.', false);
    } catch(e){
      _showToast('Reset mislukt: ' + e.message, true);
    }
  });

  // Cloud sign-in (placeholder, disabled)
  const cloudBtn = document.getElementById('profCloudBtn');
  if(cloudBtn){
    cloudBtn.disabled = true;
    cloudBtn.title = 'Coming soon — gebruik export/import om je save mee te nemen.';
  }

  // Auto-refresh after import / wipe events from snapshot.js.
  window.addEventListener('save:restored', renderProfile);
}

window.initProfile   = initProfile;
window.renderProfile = renderProfile;

})();
