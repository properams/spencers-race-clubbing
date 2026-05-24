// js/persistence/save.js — localStorage save/load
// ES module. State leeft in window.* (main.js declares de let _coins etc.);
// deze module muteert window.xxx. Exporteert via window.{loadPersistent,savePersistent}.

// Progressive world-unlock thresholds.
// Vier werelden ontgrendelen op race-count, twee op podium-count.
// Aanpassen voor balancing: gewoon de getallen wijzigen — geen andere code raakt eraan.
// (Car-unlocks staan in progression.js → CAR_UNLOCK_RULES.)
const WORLD_UNLOCK_THRESHOLDS = {
  byRaces:   { space: 2, deepsea: 4, candy: 7 },
  byPodiums: { volcano: 3, arctic: 6, sandstorm: 3 }
};

const STORAGE_KEY = 'spencerRC';

// Defaults zetten bij parse-failure of bij eerste run — alle fields, asymmetrie weg.
function _resetToDefaults(){
  window._savedHS=0;window._savedBL=Infinity;
  window._raceCount=0;window._podiumCount=0;window._speedTrapAllTime=0;
  window._coins=0;window._totalCoinsEarned=0;
  // _unlockedCars + _worldsUnlocked Sets bestaan al in main.js (var defaults).
  // _trackRecords blijft als is in main.js.
  if(!window._lapRecords)window._lapRecords={};
  // Career progression — stars per (world × diff), XP, level, cup-state.
  window._stars={};
  window._xp=0;window._level=1;
  if(!window._cupsCompleted)window._cupsCompleted=new Set();else window._cupsCompleted.clear();
  if(!window._cupsMastered)window._cupsMastered=new Set();else window._cupsMastered.clear();
  // Lifetime achievement-ids — schemaVer 3+. Niet wissen bij race-reset
  // (alleen _achieveUnlocked in race.js doet dat). Voorkomt herhaal-toasts
  // over sessies heen.
  if(!window._unlockedAchievements)window._unlockedAchievements=new Set();else window._unlockedAchievements.clear();
}

// Record a lap time as the per-(world × difficulty) best, if it beats the
// existing record. Called from finish.js when a race ends and from
// tracklimits.js when a lap is completed. Returns true if it beats the
// existing record.
function recordLapTime(world, difficulty, time, carDef){
  if(!window._lapRecords) window._lapRecords = {};
  if(!world || !carDef || !isFinite(time)) return false;
  const key = world + '_' + (difficulty|0);
  const cur = window._lapRecords[key];
  if(cur && cur.time <= time) return false;
  window._lapRecords[key] = {
    time: time,
    carId: carDef.id,
    brand: carDef.brand,
    name: carDef.name,
    dt: Date.now()
  };
  // Defer the localStorage flush off the hot path — recordLapTime is called
  // on lap-cross which already triggers sector-flash + audio cues.
  // JSON.stringify + setItem on the full save blob can cost 5–40 ms on
  // slower devices; pushing it to idle / next tick avoids a perceptible
  // freeze right at the start/finish line. The in-memory record above is
  // already authoritative for the rest of the race.
  const _flush = ()=>{ try{ savePersistent(); }catch(e){ /* ignore */ } };
  if(typeof requestIdleCallback==='function') requestIdleCallback(_flush,{timeout:2000});
  else setTimeout(_flush, 0);
  return true;
}
window.recordLapTime = recordLapTime;

// Type-guard helpers voor schema-validatie van localStorage-payload.
const _num = (v, dflt) => typeof v==='number' && isFinite(v) ? v : dflt;
const _arr = v => Array.isArray(v) ? v : [];
const _obj = v => (v && typeof v==='object' && !Array.isArray(v)) ? v : {};

function loadPersistent(){
  let raw;
  try{ raw = localStorage.getItem(STORAGE_KEY); }
  catch(e){
    if(window.dbg)dbg.warn('persist','localStorage.getItem failed (private mode?): '+e.message);
    _resetToDefaults();
    return;
  }
  if(!raw){ _resetToDefaults(); return; }
  let d;
  try{ d = JSON.parse(raw); }
  catch(e){
    if(window.dbg)dbg.error('persist',e,'JSON.parse failed — resetting to defaults');
    _resetToDefaults();
    return;
  }
  if(!d || typeof d!=='object'){ _resetToDefaults(); return; }

  // Velden met type-guard — corrupte data resulteert nooit in TypeError.
  window._savedHS           = _num(d.hs, 0);
  window._savedBL           = _num(d.bl, Infinity);
  window._raceCount         = _num(d.rc, 0);
  window._podiumCount       = _num(d.pc, 0);
  window._speedTrapAllTime  = _num(d.st, 0);
  window._coins             = _num(d.coins, 0);
  window._totalCoinsEarned  = _num(d.totalCoins, 0);

  _arr(d.unlocked).forEach(id => { if(typeof id==='number') window._unlockedCars.add(id); });
  // Default-unlocks (Bugatti/Lambo/Maserati/Ferrari) altijd toevoegen.
  [0,1,2,3].forEach(id => window._unlockedCars.add(id));

  _arr(d.worlds).forEach(w => { if(typeof w==='string') window._worldsUnlocked.add(w); });
  window._trackRecords = _obj(d.records);
  // Per-(world × difficulty) lap records. Each entry:
  //   { time:Number, carId:Number, brand:String, name:String, dt:Number }
  // Used by the selection screen rival-display. Old saves without this field
  // start with an empty object — no migration needed since the legacy
  // schema never wrote per-track times.
  window._lapRecords = _obj(d.lapRecords);

  // Career progression — backward compatible. Missing fields → defaults.
  window._stars = _obj(d.stars);
  window._xp    = _num(d.xp, 0);
  window._level = _num(d.level, 1);
  if(!window._cupsCompleted)window._cupsCompleted=new Set();else window._cupsCompleted.clear();
  _arr(d.cupsCompleted).forEach(c => { if(typeof c==='string') window._cupsCompleted.add(c); });
  if(!window._cupsMastered)window._cupsMastered=new Set();else window._cupsMastered.clear();
  _arr(d.cupsMastered).forEach(c => { if(typeof c==='string') window._cupsMastered.add(c); });

  // Lifetime achievements. Pre-schema-3 saves missen dit veld → lege Set
  // (geen migration nodig; oude saves verdienen achievements opnieuw, eenmaal).
  if(!window._unlockedAchievements)window._unlockedAchievements=new Set();else window._unlockedAchievements.clear();
  _arr(d.achievements).forEach(id => { if(typeof id==='string') window._unlockedAchievements.add(id); });

  // Progressive unlock — drempels in WORLD_UNLOCK_THRESHOLDS bovenaan.
  for(const [w,n] of Object.entries(WORLD_UNLOCK_THRESHOLDS.byRaces)){
    if(window._raceCount>=n)window._worldsUnlocked.add(w);
  }
  for(const [w,n] of Object.entries(WORLD_UNLOCK_THRESHOLDS.byPodiums)){
    if(window._podiumCount>=n)window._worldsUnlocked.add(w);
  }

  // Cup-unlock pass — run last so cup-rewards (worlds + cars) settle after
  // race/podium-threshold pass. career.js owns the cup table; gate the call
  // so first-load (career.js not yet attached) still completes cleanly.
  if(typeof window.applyCupUnlocks==='function')window.applyCupUnlocks();
}

function savePersistent(){
  const d={};
  // High-score: alleen ophogen, nooit verlagen.
  if(window.totalScore>(window._savedHS||0)){d.hs=window.totalScore;window._savedHS=window.totalScore;}
  else if(window._savedHS) d.hs=window._savedHS;
  // Best-lap: alleen verbeteren. Infinity wordt undefined (JSON.stringify dropt 't).
  if(window.bestLapTime<(window._savedBL||Infinity)&&window.bestLapTime!==Infinity){
    d.bl=window.bestLapTime;window._savedBL=window.bestLapTime;
  } else if(window._savedBL!==Infinity) d.bl=window._savedBL;
  d.rc=window._raceCount;d.pc=window._podiumCount;d.st=window._speedTrapAllTime;
  d.unlocked=[...window._unlockedCars];
  d.coins=window._coins;d.totalCoins=window._totalCoinsEarned;
  d.worlds=[...window._worldsUnlocked];d.records=window._trackRecords;
  if(window._lapRecords) d.lapRecords=window._lapRecords;
  // Career fields. Stars/cups always written even when empty so a wiped save
  // round-trips cleanly. schemaVer marks payload as post-career-system.
  d.stars=window._stars||{};
  d.xp=window._xp|0;d.level=window._level|0;
  d.cupsCompleted=window._cupsCompleted?[...window._cupsCompleted]:[];
  d.cupsMastered=window._cupsMastered?[...window._cupsMastered]:[];
  d.achievements=window._unlockedAchievements?[...window._unlockedAchievements]:[];
  d.schemaVer=3;
  let json;
  try{ json=JSON.stringify(d); }
  catch(e){
    if(window.dbg)dbg.error('persist',e,'JSON.stringify failed (circular?)');
    return;
  }
  try{ localStorage.setItem(STORAGE_KEY,json); }
  catch(e){
    // QuotaExceededError, SecurityError (private mode), etc.
    if(window.dbg)dbg.warn('persist','localStorage.setItem failed: '+e.name+' — '+e.message);
  }
}

window.loadPersistent=loadPersistent;
window.savePersistent=savePersistent;
window.WORLD_UNLOCK_THRESHOLDS=WORLD_UNLOCK_THRESHOLDS;

export {loadPersistent,savePersistent,recordLapTime,WORLD_UNLOCK_THRESHOLDS};
