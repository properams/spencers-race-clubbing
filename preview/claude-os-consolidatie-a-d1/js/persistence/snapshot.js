// js/persistence/snapshot.js — versioned save snapshot (export / import / wipe).
// ES module. Wraps save.js + identity.js + settings.js localStorage keys into
// one portable JSON blob so the player can download/restore progress.
//
// Future cloud sync will reuse the same getSaveSnapshot / applySaveSnapshot
// seam; only the transport changes. cloudSync.js documents the placeholder.

import { savePersistent, loadPersistent } from './save.js';
import { applyIdentityFromSnapshot, loadIdentity } from './identity.js';

const SNAPSHOT_V        = 1;
const APP_MARKER        = 'spencerRC';
const SAVE_KEY          = 'spencerRC';            // mirror save.js STORAGE_KEY
const SETTINGS_KEY      = 'src.settings.v2';      // mirror settings.js STORAGE_KEY
const NEMESIS_KEY       = 'src.nemesis.defeated.v1';
const IDENTITY_KEY      = 'spencerRC_identity';

// ── Build a snapshot from current state ─────────────────────────────────────
// Flush in-memory career/progression to localStorage first, then read the
// canonical JSON back so the snapshot reflects the exact serialised shape.
function getSaveSnapshot(){
  try{ savePersistent(); }catch(_){}
  const readJSON = (k) => {
    try{
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : null;
    } catch(_){ return null; }
  };
  return {
    v: SNAPSHOT_V,
    app: APP_MARKER,
    exportedAt: Date.now(),
    identity: { handle: window._playerHandle || 'Spencer' },
    save:     readJSON(SAVE_KEY)     || {},
    settings: readJSON(SETTINGS_KEY) || {},
    nemesis:  readJSON(NEMESIS_KEY)  || {}
  };
}

// ── Validation ──────────────────────────────────────────────────────────────
// Returns {ok:true} or {ok:false, error:string}. Cheap shape check — does
// NOT verify field contents; loadPersistent's type-guards handle malformed
// values gracefully after apply.
function validateSnapshot(snap){
  if(!snap || typeof snap !== 'object') return { ok:false, error:'Save bestand is leeg of geen JSON-object.' };
  if(snap.app !== APP_MARKER)           return { ok:false, error:'Dit is geen Spencer’s Race Club save.' };
  if(typeof snap.v !== 'number')        return { ok:false, error:'Save mist een versie-veld.' };
  if(snap.v > SNAPSHOT_V)               return { ok:false, error:'Save is gemaakt door een nieuwere game-versie. Update de game eerst.' };
  if(snap.v < 1)                        return { ok:false, error:'Save versie wordt niet meer ondersteund.' };
  return { ok:true };
}

// ── Apply a snapshot — overwrites current state ─────────────────────────────
// Writes each sub-blob to its dedicated localStorage key, then re-runs the
// per-module load functions so window.* globals refresh in place (no reload).
function applySaveSnapshot(snap){
  const check = validateSnapshot(snap);
  if(!check.ok) throw new Error(check.error);

  const writeJSON = (k, v) => {
    try{ localStorage.setItem(k, JSON.stringify(v || {})); }
    catch(e){ if(window.dbg)dbg.warn('snapshot','setItem failed for '+k+': '+e.message); }
  };

  // Settings + nemesis written verbatim; settings.js + career.js read them
  // on next access (settings.js caches in _settings, so we also reload below).
  writeJSON(SAVE_KEY,     snap.save);
  writeJSON(SETTINGS_KEY, snap.settings);
  writeJSON(NEMESIS_KEY,  snap.nemesis);

  applyIdentityFromSnapshot(snap.identity);

  // Wipe in-memory Sets first — loadPersistent() does additive `.add()` calls,
  // so without this an import would UNION rather than REPLACE the unlocks.
  if(window._unlockedCars   instanceof Set) window._unlockedCars.clear();
  if(window._worldsUnlocked instanceof Set) window._worldsUnlocked.clear();
  // Re-seed default unlocks; save.js add()'s on top.
  [0,1,2,3].forEach(id => window._unlockedCars && window._unlockedCars.add(id));
  if(window._worldsUnlocked) window._worldsUnlocked.add('space');

  loadPersistent();

  // Settings cache reset — force settings.js to re-read on next open. Since
  // settings.js owns its private _settings closure, we can't poke it; reload
  // the page after settings-import would be cleanest, but the audio levels
  // re-apply on next slider-open. Acceptable for now.

  // Refresh title-screen footer + career panel.
  if(typeof window.updateTitleHighScore === 'function'){
    try{ window.updateTitleHighScore(); }catch(_){}
  }

  // Broadcast for UI listeners (profile.js refreshes its cards on this).
  try{
    window.dispatchEvent(new CustomEvent('save:restored', { detail:{ snapshot:snap } }));
  }catch(_){}
}

// ── Wipe — back to defaults ────────────────────────────────────────────────
// Removes save + identity localStorage keys (NOT settings — wiping audio
// levels by accident is hostile). Re-runs loaders to reset window.* state.
function wipeSave(){
  try{ localStorage.removeItem(SAVE_KEY); }catch(_){}
  try{ localStorage.removeItem(IDENTITY_KEY); }catch(_){}
  try{ localStorage.removeItem(NEMESIS_KEY); }catch(_){}
  // Reset in-memory Sets so loadPersistent re-seeds cleanly.
  if(window._unlockedCars   instanceof Set) window._unlockedCars.clear();
  if(window._worldsUnlocked instanceof Set) window._worldsUnlocked.clear();
  [0,1,2,3].forEach(id => window._unlockedCars && window._unlockedCars.add(id));
  if(window._worldsUnlocked) window._worldsUnlocked.add('space');

  loadPersistent();
  loadIdentity();

  if(typeof window.updateTitleHighScore === 'function'){
    try{ window.updateTitleHighScore(); }catch(_){}
  }
  try{
    window.dispatchEvent(new CustomEvent('save:restored', { detail:{ wiped:true } }));
  }catch(_){}
}

// ── Download helpers ────────────────────────────────────────────────────────
function _dateStamp(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}${m}${day}`;
}
function _safeName(handle){
  return String(handle||'spencer').replace(/[^a-z0-9_-]/gi,'_').slice(0,20) || 'spencer';
}
function downloadSnapshotFile(){
  const snap = getSaveSnapshot();
  const json = JSON.stringify(snap, null, 2);
  const blob = new Blob([json], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `spencer-race-save-${_safeName(snap.identity.handle)}-${_dateStamp()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the blob after the click has been processed.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Read a File (from <input type=file>) into a parsed snapshot. Resolves with
// the parsed object or rejects with a user-facing error message.
function parseSnapshotFile(file){
  return new Promise((resolve, reject) => {
    if(!file) return reject(new Error('Geen bestand geselecteerd.'));
    if(file.size > 2 * 1024 * 1024) return reject(new Error('Bestand groter dan 2 MB — geen geldige save.'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Kon het bestand niet lezen.'));
    fr.onload  = () => {
      let parsed;
      try{ parsed = JSON.parse(fr.result); }
      catch(_){ return reject(new Error('Bestand is geen geldige JSON.')); }
      const check = validateSnapshot(parsed);
      if(!check.ok) return reject(new Error(check.error));
      resolve(parsed);
    };
    fr.readAsText(file);
  });
}

window.getSaveSnapshot     = getSaveSnapshot;
window.applySaveSnapshot   = applySaveSnapshot;
window.wipeSave            = wipeSave;
window.downloadSnapshotFile= downloadSnapshotFile;
window.parseSnapshotFile   = parseSnapshotFile;
window.validateSnapshot    = validateSnapshot;
window.SNAPSHOT_V          = SNAPSHOT_V;

export { getSaveSnapshot, applySaveSnapshot, wipeSave,
         downloadSnapshotFile, parseSnapshotFile, validateSnapshot,
         SNAPSHOT_V, APP_MARKER };
