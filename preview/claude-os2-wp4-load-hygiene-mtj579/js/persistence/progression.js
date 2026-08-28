// js/persistence/progression.js — coins, unlocks, stats, records
// ES module. State leeft in window.* (main.js declares de globals); deze
// module muteert window.xxx en zet zichzelf via window.{awardCoins, buyCar, ...}.

import {savePersistent,loadPersistent} from './save.js';

// Per-car unlock-regels. Elke regel returnt true als de speler de car net verdiend heeft.
// `state` is { finishPos, bestLapTime, overallFastestLap, raceCount, podiumCount, alreadyUnlocked(id) }.
// Aanpassen voor balancing: regel toevoegen/wijzigen — checkUnlocks() consumeert de tabel.
const CAR_UNLOCK_RULES = [
  { id: 4, label: 'Red Bull F1 — finish P1',
    test: s => s.finishPos === 1 },
  { id: 5, label: 'Mustang — overall fastest lap',
    test: s => s.overallFastestLap < Infinity && s.bestLapTime <= s.overallFastestLap + 0.01 },
  { id: 6, label: 'Tesla — complete 5 races',
    test: s => s.raceCount >= 5 },
  { id: 7, label: 'Audi — 3 podium finishes',
    test: s => s.podiumCount >= 3 },
];

function awardCoins(pos){
  const base=[200,140,100,70,50,35,20,10];
  let earned=base[pos-1]||10;
  const pCar=window.carObjs[window.playerIdx];
  if(pCar&&window.bestLapTime!==Infinity&&window.bestLapTime<=window._overallFastestLap+0.001)earned+=80;
  if(pCar&&pCar.hitCount===0)earned+=50;
  else if(pCar&&pCar.hitCount<=2)earned+=20;
  earned+=window.TOTAL_LAPS*15;
  const diffMult=window.difficulty===2?1.8:window.difficulty===0?0.8:1.0;
  earned=Math.round(earned*diffMult);
  if(typeof window._comboMult!=='undefined'&&window._comboMult>1)earned=Math.round(earned*window._comboMult);
  window._coins+=earned;window._totalCoinsEarned+=earned;
  window._lastRaceCoins=earned;
  return earned;
}

function buyCar(id){
  const p=(window.CAR_PRICES&&window.CAR_PRICES[id])||0;
  if(p<=0||window._unlockedCars.has(id)||window._coins<p)return false;
  window._coins-=p;window._unlockedCars.add(id);savePersistent();return true;
}

function buyWorld(w){
  const p=(window.WORLD_PRICES&&window.WORLD_PRICES[w])||0;
  if(window._worldsUnlocked.has(w))return false;
  if(p>0&&window._coins<p)return false;
  if(p>0)window._coins-=p;window._worldsUnlocked.add(w);savePersistent();return true;
}

function checkUnlocks(finishPos){
  const state={
    finishPos,
    bestLapTime: window.bestLapTime,
    overallFastestLap: window._overallFastestLap,
    raceCount: window._raceCount,
    podiumCount: window._podiumCount
  };
  const newOnes=[];
  for(const rule of CAR_UNLOCK_RULES){
    if(window._unlockedCars.has(rule.id))continue;
    if(rule.test(state)){window._unlockedCars.add(rule.id);newOnes.push(rule.id);}
  }
  return newOnes;
}

// showUnlockToast: thin wrapper rond Notify.unlock.
function showUnlockToast(carDef){
  if(!carDef) return;
  if(!window.Notify){
    if(window.dbg)window.dbg.warn('notify','Notify niet ready, drop unlock',carDef&&carDef.name);
    else console.warn('Notify not ready for showUnlockToast');
    return;
  }
  window.Notify.unlock(carDef);
}

function showUnlocks(ids,idx=0){
  if(idx>=ids.length)return;
  const def=window.CAR_DEFS[ids[idx]];
  if(def)showUnlockToast(def);
  setTimeout(()=>showUnlocks(ids,idx+1),3800);
}

// Display names for the 9 worlds — duplicated from select.js so this
// module stays standalone (no cross-module global lookup at title-load).
const _TITLE_WORLD_NAMES={
  space:'Cosmic Circuit',deepsea:'Deep Sea',candy:'Sugar Rush',
  volcano:'Volcano',arctic:'Arctic Circuit',
  sandstorm:'Sandstorm Canyon',pier47:'Pier 47',
  guangzhou:'Guangzhou'
};
function _fmtLapTime(sec){
  // Prefer the shared formatter from finish.js (window.fmtClockTime) when
  // available — same m:ss.SSS shape, only the empty fallback differs.
  if(typeof window!=='undefined' && typeof window.fmtClockTime==='function'){
    const out = window.fmtClockTime(sec);
    return out === '—' ? '—:—.—' : out;
  }
  if(!isFinite(sec)||sec<=0)return'—:—.—';
  const m=Math.floor(sec/60), s=sec-m*60;
  return m+':'+(s<10?'0':'')+s.toFixed(3);
}

function updateTitleHighScore(){
  loadPersistent();
  // Fill the 4 Light-Edition title-screen corner tags. Each block soft-fails
  // when its element isn't in the DOM (e.g. world-select reuses this fn
  // for the careerPanel only).
  const last=_findLastRecord();
  const lastEl=document.getElementById('titleHighScore');
  if(lastEl){
    if(last){
      const wname=_TITLE_WORLD_NAMES[last.world]||last.world.toUpperCase();
      lastEl.textContent='LAST · '+wname+' · '+_fmtLapTime(last.time);
    } else {
      lastEl.textContent='LAST · — · —:—.—';
    }
  }
  const footEl=document.getElementById('titleFootL');
  if(footEl){
    const lv=(typeof window.getLevelProgress==='function')?window.getLevelProgress().level:1;
    const totalCars=(window.CAR_DEFS&&window.CAR_DEFS.length)||13;
    const unlockedCars=(window._unlockedCars&&window._unlockedCars.size)||0;
    const totalCups=(window.CUPS&&window.CUPS.length)||0;
    const doneCups=(window._cupsCompleted&&window._cupsCompleted.size)||0;
    const handle=(window._playerHandle||'SPENCER').toUpperCase();
    footEl.innerHTML='<span class="holoDiamond holoDiamondSolid"></span> '+handle+' · LV '+lv+
      ' · '+unlockedCars+'/'+totalCars+' CARS · '+doneCups+'/'+totalCups+' CUPS';
  }
  // #titleVersionTag is now a static "Settings" button — don't overwrite its
  // label with version/light-index text.
  // Career panel — level bar, total stars, cars/worlds counters, cup badges.
  // Lives on World Select screen; render is idempotent + soft-fails when
  // #careerPanel isn't in the DOM yet.
  _renderCareerPanel();
}

// Pick the most recently raced lap record across all (world × difficulty)
// keys — sorted by stored `dt` (Date.now() snapshot in recordLapTime).
function _findLastRecord(){
  const lr=window._lapRecords;
  if(!lr)return null;
  let best=null;
  for(const key in lr){
    const r=lr[key];
    if(!r||!isFinite(r.time))continue;
    // Key format: "world_difficulty" — split once on last underscore.
    const i=key.lastIndexOf('_');
    const world=i>0?key.slice(0,i):key;
    if(!best||(r.dt|0)>(best.dt|0)){
      best={world:world,time:r.time,dt:r.dt|0};
    }
  }
  return best;
}

// Refresh the 4 difficulty-tier tab counters on the Worlds screen.
// Each tab shows {earned}/{max} stars for the cup that owns those worlds.
// Also (once) wires a click handler that highlights the active tier — pure
// visual indicator; full grid filtering by tier is a follow-up.
function _renderWorldTierTabs(){
  if(!window.CUPS||!window._stars)return;
  for(const cup of window.CUPS){
    const max = cup.worlds.length * 3 * 3; // diffs × stars
    let earned = 0;
    for(const w of cup.worlds){
      for(let d=0;d<3;d++) earned += (window._stars[w+'_'+d]|0);
    }
    const el = document.querySelector('[data-tier-count="'+cup.id+'"]');
    if(el) el.textContent = earned + '/' + max;
  }
  const tabs = document.querySelectorAll('#worldTierTabs .holoTab[data-tier]');
  if(tabs.length && !tabs[0]._tierWired){
    tabs.forEach(btn => {
      btn._tierWired = true;
      btn.addEventListener('click', () => {
        tabs.forEach(b => b.classList.toggle('holoTabActive', b === btn));
      });
    });
  }
}

function _renderCareerPanel(){
  _renderWorldTierTabs();
  // World overview footer (SPECTRUM LV X ◆ <coins> + Enter CTA) lives
  // outside #careerPanel; sync it whenever we refresh career state.
  if(typeof window._updateWorldSelFooter==='function'){
    try{ window._updateWorldSelFooter(); }catch(_){}
  }
  const panel=document.getElementById('careerPanel');
  if(!panel) return;
  // Hide panel if there's no career system loaded yet (career.js late-attach).
  if(typeof window.getLevelProgress!=='function'){panel.style.display='none';return;}
  panel.style.display='';
  const lp=window.getLevelProgress();
  const ts=(typeof window.getTotalStars==='function')?window.getTotalStars():{earned:0,max:0};
  const totalCars=(window.CAR_DEFS&&window.CAR_DEFS.length)||13;
  const unlockedCars=(window._unlockedCars&&window._unlockedCars.size)||0;
  const totalWorlds=9;
  const unlockedWorlds=(window._worldsUnlocked&&window._worldsUnlocked.size)||0;
  const set=(id,txt)=>{const e=document.getElementById(id);if(e)e.textContent=txt;};
  set('cpLevelBadge','LV '+lp.level);
  set('cpXpText', lp.maxedOut ? 'MAX LEVEL' : (lp.intoLevel+' / '+lp.span+' XP'));
  const fill=document.getElementById('cpXpFill');
  if(fill) fill.style.width = (lp.maxedOut?100:Math.round(lp.frac*100))+'%';
  set('cpStarsText', ts.earned+' / '+ts.max);
  set('cpCarsText', unlockedCars+' / '+totalCars+' CARS');
  set('cpWorldsText', unlockedWorlds+' / '+totalWorlds+' WORLDS');
  // Cup bracket — one chip per cup with a stars-earned/needed mini-bar.
  // Sessie 07: was a flat label; now shows progress within each cup so the
  // player can see "Master Cup 6/27 ★" without opening a separate screen.
  const cupsRow=document.getElementById('cpCupsRow');
  if(cupsRow && window.CUPS){
    cupsRow.innerHTML='';
    for(const cup of window.CUPS){
      const completed=window._cupsCompleted&&window._cupsCompleted.has(cup.id);
      const mastered =window._cupsMastered &&window._cupsMastered.has(cup.id);
      // Tally stars in this cup. Each world = 3 diffs × 3 stars = 9 max.
      const cupMax = cup.worlds.length * 9;
      let cupEarned = 0;
      if(window._stars){
        for(const w of cup.worlds){
          for(let d=0; d<3; d++){
            cupEarned += (window._stars[w+'_'+d]|0);
          }
        }
      }
      const pct = cupMax > 0 ? Math.round((cupEarned/cupMax)*100) : 0;
      const chip=document.createElement('span');
      chip.className='cupBadge'+(completed?' cbDone':'')+(mastered?' cbMaster':'');
      // Inline mini-bracket: label + stars + progress fill
      chip.innerHTML =
        '<span class="cupBadgeLabel">'+(mastered?'⭐ ':completed?'✓ ':'')+cup.name+'</span>'+
        '<span class="cupBadgeStars" style="margin-left:6px;font-size:9px;opacity:.85">'+cupEarned+'/'+cupMax+'★</span>'+
        '<div class="cupBadgeProg" style="position:absolute;left:0;bottom:0;height:2px;width:'+pct+'%;background:var(--iridescent);border-radius:0 0 6px 6px;transition:width .4s ease-out;pointer-events:none"></div>';
      // Make sure the progress bar can position absolutely.
      chip.style.position='relative';
      chip.style.paddingBottom='6px';
      cupsRow.appendChild(chip);
    }
  }
}

window.awardCoins=awardCoins;
window.buyCar=buyCar;
window.buyWorld=buyWorld;
window.checkUnlocks=checkUnlocks;
window.showUnlockToast=showUnlockToast;
window.showUnlocks=showUnlocks;
window.updateTitleHighScore=updateTitleHighScore;
window.CAR_UNLOCK_RULES=CAR_UNLOCK_RULES;

export {awardCoins,buyCar,buyWorld,checkUnlocks,showUnlockToast,showUnlocks,updateTitleHighScore,CAR_UNLOCK_RULES};
