// js/persistence/career.js — career progression: stars, XP, level, cups, Dev API.
// ES module. Mirrors the window.* attach pattern from progression.js (line 94-101).
// State lives in window._stars, _xp, _level, _cupsCompleted, _cupsMastered
// (declared in main.js). Load/save in save.js. Wiring in finish.js.

import {savePersistent} from './save.js';

// ── CUPS ────────────────────────────────────────────────────────────────────
// Order matters: each cup unlocks the next. Worlds outside any cup stay
// unlocked via WORLD_UNLOCK_THRESHOLDS (race/podium count). To rebalance:
// edit the members + reward fields here — no other file touches the table.
const CUPS = [
  { id:'rookie', name:'ROOKIE CUP', worlds:['space','deepsea','candy'],
    rewardCar:8, unlocksNext:'pro' },
  { id:'pro',    name:'PRO CUP',    worlds:['volcano','arctic'],
    rewardCar:9, unlocksNext:'master' },
  { id:'master', name:'MASTER CUP', worlds:['sandstorm','pier47'],
    rewardCar:10, unlocksNext:'legend' },
  { id:'legend', name:'LEGEND CUP', worlds:['guangzhou'],
    rewardCar:11, unlocksNext:null },
];
const CUP_BY_ID = Object.fromEntries(CUPS.map(c=>[c.id,c]));
const CUP_BY_WORLD = {};
for(const c of CUPS) for(const w of c.worlds) CUP_BY_WORLD[w] = c.id;

// Position 1→3★, 2→2★, 3→1★, else 0. Mirrors the bonuses[] table in finish.js
// but for stars rather than coin amounts.
const RACE_STARS_BY_POS = [3,2,1,0,0,0,0,0];

// XP per race = stars × 100 + position bonus + clean-race bonus.
// Level thresholds chosen so first few are quick (5 races → level 4-ish) but
// hitting double digits requires sustained play. Capped at index length-1.
const LEVEL_THRESHOLDS = [
  0, 100, 300, 600, 1000, 1500, 2200, 3000, 4000, 5200, 6600, 8200, 10000
];

function _starsKey(world, diff){ return world + '_' + (diff|0); }

// Record stars for (world, diff). Only improves — re-finishing P3 after
// a P1 doesn't downgrade. Returns true if a new best was recorded.
function recordStars(world, diff, stars){
  if(!world || stars<0 || stars>3) return false;
  if(!window._stars) window._stars = {};
  const k = _starsKey(world, diff);
  const prev = window._stars[k]|0;
  if(stars <= prev) return false;
  window._stars[k] = stars;
  try{ savePersistent(); }catch(e){ /* ignore */ }
  return true;
}

// Get best stars across all difficulties for a world. World-card pill shows
// this (★★☆ summary), per-diff detail lives in #careerPanel.
function getWorldStars(world){
  if(!world || !window._stars) return 0;
  let best = 0;
  for(let d=0; d<3; d++){
    const s = window._stars[_starsKey(world,d)]|0;
    if(s>best) best=s;
  }
  return best;
}

// Total stars earned vs total possible. UI uses for "12/99" style counter.
function getTotalStars(){
  let earned=0, max=0;
  for(const c of CUPS) for(const w of c.worlds){
    max += 9; // 3 stars × 3 difficulties
    for(let d=0; d<3; d++) earned += window._stars[_starsKey(w,d)]|0;
  }
  return { earned, max };
}

// XP table. xpInfo: { earned, total, level, leveledUp, newLevel }.
function awardXP(stars, pos, cleanRace){
  const base = (stars|0) * 100;
  const posBonus = [80, 50, 30, 20, 10, 5, 0, 0][(pos|0)-1] || 0;
  const cleanBonus = cleanRace ? 40 : 0;
  // Comeback XP: 15 XP per grid-place gained. finish.js stashes the
  // delta on window._comebackPlaces just before this call.
  const comebackBonus = Math.max(0, (window._comebackPlaces|0)) * 15;
  const earned = base + posBonus + cleanBonus + comebackBonus;
  const prevLevel = window._level|0;
  window._xp = (window._xp|0) + earned;
  const newLevel = computeLevel(window._xp);
  const leveledUp = newLevel > prevLevel;
  window._level = newLevel;
  // Level-up bonus: 200 coins per new level (handled inline so finish.js
  // doesn't need to know about coin grants on level-up).
  if(leveledUp){
    const gained = newLevel - prevLevel;
    window._coins = (window._coins|0) + (200 * gained);
    window._totalCoinsEarned = (window._totalCoinsEarned|0) + (200 * gained);
  }
  return { earned, total:window._xp, level:newLevel, leveledUp, newLevel,
           prevLevel, coinBonus: leveledUp ? 200*(newLevel-prevLevel) : 0 };
}

function computeLevel(xp){
  for(let i=LEVEL_THRESHOLDS.length-1; i>=0; i--){
    if(xp >= LEVEL_THRESHOLDS[i]) return i+1;
  }
  return 1;
}

function getLevelProgress(){
  const lv = window._level|0;
  const xp = window._xp|0;
  const cur = LEVEL_THRESHOLDS[lv-1] || 0;
  const next = LEVEL_THRESHOLDS[lv] != null ? LEVEL_THRESHOLDS[lv] : cur;
  const span = Math.max(1, next - cur);
  const into = Math.max(0, xp - cur);
  return { level:lv, xp, intoLevel:into, span, frac: Math.min(1, into/span),
           maxedOut: lv >= LEVEL_THRESHOLDS.length };
}

// Cup completion: every member-world has >=1★ on Normal (diff 1) OR Hard (diff 2).
// Mastery: every member-world has 3★ on Hard (diff 2). Easy never counts for
// either — skill gate prevents trivial cup-clear by easy-mode farming.
function getCupProgress(cupId){
  const cup = CUP_BY_ID[cupId];
  if(!cup) return null;
  const stars = window._stars || {};
  let memberCompleted = 0, memberMastered = 0, starsEarned = 0;
  for(const w of cup.worlds){
    const sNorm = stars[_starsKey(w,1)]|0;
    const sHard = stars[_starsKey(w,2)]|0;
    const sEasy = stars[_starsKey(w,0)]|0;
    starsEarned += sNorm + sHard + sEasy;
    if(sNorm >= 1 || sHard >= 1) memberCompleted++;
    if(sHard >= 3) memberMastered++;
  }
  return {
    cupId, name:cup.name,
    completed: memberCompleted === cup.worlds.length,
    mastered:  memberMastered  === cup.worlds.length,
    memberCompleted, memberMastered,
    memberCount: cup.worlds.length,
    starsEarned, starsMax: cup.worlds.length * 9,
    rewardCar: cup.rewardCar, unlocksNext: cup.unlocksNext
  };
}

function getCupForWorld(world){ return CUP_BY_WORLD[world] || null; }

// Promote cups → set membership, unlock reward cars, unlock next-cup worlds.
// Idempotent: re-running on every load + every finish is safe.
// Returns array of cup-ids that became newly completed this pass
// (so finish.js can fire celebratory toasts).
function applyCupUnlocks(){
  if(!window._cupsCompleted) window._cupsCompleted = new Set();
  if(!window._cupsMastered)  window._cupsMastered  = new Set();
  if(!window._unlockedCars)  window._unlockedCars  = new Set();
  if(!window._worldsUnlocked)window._worldsUnlocked= new Set();
  const newlyCompleted = [];
  for(const cup of CUPS){
    const p = getCupProgress(cup.id);
    if(!p) continue;
    if(p.completed && !window._cupsCompleted.has(cup.id)){
      window._cupsCompleted.add(cup.id);
      newlyCompleted.push(cup.id);
    }
    if(p.mastered && !window._cupsMastered.has(cup.id)){
      window._cupsMastered.add(cup.id);
    }
    // Reward-car: unlock once cup completed.
    if(window._cupsCompleted.has(cup.id) && cup.rewardCar != null){
      window._unlockedCars.add(cup.rewardCar);
    }
    // Cup-gated world unlock: completing a cup opens every world of the
    // NEXT cup, regardless of price/threshold. Other unlock paths still
    // work in parallel (race-count + podium-count + buyWorld).
    if(window._cupsCompleted.has(cup.id) && cup.unlocksNext){
      const next = CUP_BY_ID[cup.unlocksNext];
      if(next) for(const w of next.worlds) window._worldsUnlocked.add(w);
    }
  }
  return newlyCompleted;
}

// World-unlock hint string for locked cards. Reads thresholds + cup
// membership and produces a one-liner. select.js calls this from
// _initWorldSelectorTiles().
function getWorldUnlockHint(world){
  const cupId = CUP_BY_WORLD[world];
  if(cupId){
    const cup = CUP_BY_ID[cupId];
    // Locked worlds belong to a cup-gated tier — show predecessor.
    const idx = CUPS.findIndex(c=>c.id===cupId);
    if(idx > 0){
      const prev = CUPS[idx-1];
      return 'Win ' + prev.name + ' to unlock';
    }
    return 'Race more to unlock';
  }
  // Fallback to threshold-based hint.
  const th = window.WORLD_UNLOCK_THRESHOLDS;
  if(th){
    if(th.byRaces && th.byRaces[world])
      return 'Race ' + th.byRaces[world] + 'x to unlock';
    if(th.byPodiums && th.byPodiums[world])
      return th.byPodiums[world] + ' podium finishes';
  }
  const price = (window.WORLD_PRICES||{})[world];
  if(price > 0) return price + ' 🪙 to buy';
  return 'Locked';
}

// ── DEV API ─────────────────────────────────────────────────────────────────
// Only wired into window.Dev when ?dev=1 (boot.js gates exposure). All
// operations persist immediately so a reload preserves the state.
const Dev = {
  unlockEverything(){
    if(!window.CAR_DEFS || !window._TRACKS){
      if(window.dbg)dbg.warn('dev','data not yet loaded — try again in a moment');
      else console.warn('Dev: data not yet loaded — try again in a moment');
      return false;
    }
    // All cars
    for(const def of window.CAR_DEFS) window._unlockedCars.add(def.id);
    // All worlds (any world referenced in CUPS + tracks data)
    for(const c of CUPS) for(const w of c.worlds) window._worldsUnlocked.add(w);
    for(const w of Object.keys(window._TRACKS||{})) window._worldsUnlocked.add(w);
    // All stars × all difficulties
    for(const c of CUPS) for(const w of c.worlds) for(let d=0; d<3; d++){
      window._stars[_starsKey(w,d)] = 3;
    }
    // Coins + max XP + cups completed AND mastered
    window._coins = 999999;
    window._totalCoinsEarned = Math.max(window._totalCoinsEarned||0, 999999);
    window._xp = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length-1];
    window._level = LEVEL_THRESHOLDS.length;
    for(const c of CUPS){
      window._cupsCompleted.add(c.id);
      window._cupsMastered.add(c.id);
    }
    // Race/podium counters so threshold-based unlocks also trip.
    window._raceCount  = Math.max(window._raceCount||0, 99);
    window._podiumCount= Math.max(window._podiumCount||0, 99);
    savePersistent();
    return true;
  },
  unlockAllCars(){
    if(!window.CAR_DEFS) return false;
    for(const def of window.CAR_DEFS) window._unlockedCars.add(def.id);
    savePersistent(); return true;
  },
  unlockAllWorlds(){
    for(const c of CUPS) for(const w of c.worlds) window._worldsUnlocked.add(w);
    if(window._TRACKS) for(const w of Object.keys(window._TRACKS)) window._worldsUnlocked.add(w);
    savePersistent(); return true;
  },
  give3Stars(){
    for(const c of CUPS) for(const w of c.worlds) for(let d=0; d<3; d++){
      window._stars[_starsKey(w,d)] = 3;
    }
    applyCupUnlocks();
    savePersistent(); return true;
  },
  addCoins(amount){
    const n = (amount|0) || 10000;
    window._coins = (window._coins|0) + n;
    window._totalCoinsEarned = (window._totalCoinsEarned|0) + n;
    savePersistent(); return true;
  },
  resetProgress(){
    try{ localStorage.removeItem('spencerRC'); }catch(e){}
    // Reload so all in-memory state resets cleanly.
    location.reload();
  },
  dumpState(){
    const dump = {
      coins: window._coins, totalCoins: window._totalCoinsEarned,
      xp: window._xp, level: window._level,
      stars: window._stars,
      cupsCompleted: [...(window._cupsCompleted||[])],
      cupsMastered:  [...(window._cupsMastered ||[])],
      unlockedCars:  [...(window._unlockedCars ||[])],
      worldsUnlocked:[...(window._worldsUnlocked||[])],
      raceCount: window._raceCount, podiumCount: window._podiumCount,
      lapRecords: window._lapRecords
    };
    if(window.dbg)dbg.log('dev','state dump',dump);
    else console.log('[Dev] State dump:', dump);
    return dump;
  }
};

// ── Window exports (mirror progression.js attach pattern) ───────────────────
window.CUPS = CUPS;
window.RACE_STARS_BY_POS = RACE_STARS_BY_POS;
window.LEVEL_THRESHOLDS = LEVEL_THRESHOLDS;
window.recordStars = recordStars;
window.getWorldStars = getWorldStars;
window.getTotalStars = getTotalStars;
window.awardXP = awardXP;
window.computeLevel = computeLevel;
window.getLevelProgress = getLevelProgress;
window.getCupProgress = getCupProgress;
window.getCupForWorld = getCupForWorld;
window.applyCupUnlocks = applyCupUnlocks;
window.getWorldUnlockHint = getWorldUnlockHint;
window.Dev = Dev;

// ── Sessie 05 — nemesis defeat tracking ────────────────────────────────────
// Lightweight localStorage counter, no schema migration needed. defeated[name]
// counts wins over that personality. Total is computed on demand.
const _NEM_KEY = 'src.nemesis.defeated.v1';
function _loadNemesisDefeated(){
  try{
    const raw = localStorage.getItem(_NEM_KEY);
    return raw ? JSON.parse(raw) : {};
  }catch(_){ return {}; }
}
function _saveNemesisDefeated(map){
  try{ localStorage.setItem(_NEM_KEY, JSON.stringify(map)); }catch(_){}
}
function recordNemesisDefeat(name){
  if(!name)return 0;
  const m = _loadNemesisDefeated();
  m[name] = (m[name]|0) + 1;
  _saveNemesisDefeated(m);
  let tot = 0; for(const k in m) tot += (m[k]|0);
  return tot;
}
function getNemesisDefeatedTotal(){
  const m = _loadNemesisDefeated();
  let t = 0; for(const k in m) t += (m[k]|0);
  return t;
}
window._recordNemesisDefeat = recordNemesisDefeat;
window._getNemesisDefeatedTotal = getNemesisDefeatedTotal;

// loadPersistent in save.js already calls applyCupUnlocks() through the
// `typeof ... === 'function'` guard. boot() invokes loadPersistent() after
// all ES modules have parsed (loadPersistent runs at boot.js:407, well
// after this file's top-level code completes), so the gate succeeds and
// cup-unlocks land naturally — no extra call needed here.

export {
  CUPS, RACE_STARS_BY_POS, LEVEL_THRESHOLDS,
  recordStars, getWorldStars, getTotalStars,
  awardXP, computeLevel, getLevelProgress,
  getCupProgress, getCupForWorld, applyCupUnlocks,
  getWorldUnlockHint, Dev
};
