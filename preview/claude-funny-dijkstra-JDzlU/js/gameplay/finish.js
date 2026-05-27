// js/gameplay/finish.js — non-module script.

'use strict';

// Tier label for the P-headline (P1 — Gold, P2 — Silver, P3 — Bronze,
// P4+ — Night). The finish screen design uses these as the subtitle of
// the big rank headline.
const _FIN_TIER_LABEL = ['Gold','Silver','Bronze'];
const _FIN_TIER_KEY   = ['gold','silver','bronze'];
function _finTierName(pos1Based){
  return _FIN_TIER_LABEL[pos1Based-1] || 'Night';
}
function _finTierKey(pos1Based){
  return _FIN_TIER_KEY[pos1Based-1] || 'other';
}

// Format a finish-time / lap-time as m:ss.SSS or — when only sub-minute,
// as 0:ss.SSS so the design stays consistent ("3:39.482" / "1:12.487").
// Exposed on window so progression.js can share the same formatter for the
// title-screen "LAST · {world} · {time}" tag without duplicating logic.
function _fmtFinTime(sec){
  if(!isFinite(sec)||sec<=0) return '—';
  const m = Math.floor(sec/60);
  const s = sec - m*60;
  return m + ':' + (s<10?'0':'') + s.toFixed(3);
}
window.fmtClockTime = _fmtFinTime;
// Format a gap as "+s.SSS"
function _fmtGap(sec){
  if(!isFinite(sec)) return '—';
  if(sec===0) return '+0.000';
  const sign = sec<0 ? '−' : '+';
  return sign + Math.abs(sec).toFixed(3);
}

// Render the Light Edition finish layout. Stateless — every call clears
// and rebuilds the three podium cards, the YOUR LIGHT strip and the
// formation list. Source data comes from the showFinish() scope (pos[],
// bestLapTime, _raceMaxSpeed, carObjs/playerIdx).
function _renderFinishLight(pos, playerP, earnedCoins){
  if(!pos||!pos.length) return;
  const leader = pos[0];
  const playerCar = carObjs[playerIdx];

  // Resolve race time + gap. Pre-PHASE 11 cars don't always populate
  // _finishTime (e.g. when player DNF), so we fall back to bestLap×laps
  // and finally to a dash.
  let raceTimeSec = null, gapSec = null;
  if(playerCar && typeof playerCar._finishTime === 'number') raceTimeSec = playerCar._finishTime;
  if(playerCar && leader && typeof playerCar._finishTime==='number' && typeof leader._finishTime==='number'){
    gapSec = playerCar._finishTime - leader._finishTime;
  }
  // Top speed in km/h — same conversion as the legacy stat tile (×165).
  const topSpeed = playerCar ? Math.min(380, Math.round(_raceMaxSpeed*165)) : 0;
  const bestLapSec = (bestLapTime<Infinity) ? bestLapTime : null;
  const isFastest  = bestLapSec!==null && bestLapSec <= _overallFastestLap+0.001;

  // ── Headline + subtitle ───────────────────────────────────────────
  const headEl = document.getElementById('finLHead');
  if(headEl){
    const tier = _finTierName(playerP);
    headEl.textContent = 'P' + playerP + ' — ' + tier;
    headEl.setAttribute('data-tier', _finTierKey(playerP));
  }
  const subEl = document.getElementById('finLSub');
  if(subEl){
    let parts = [];
    if(playerP > 1 && gapSec!==null && isFinite(gapSec)){
      const leaderName = (leader._personality&&leader._personality.name)||(leader.def&&leader.def.name)||'leader';
      parts.push('just ' + Math.abs(gapSec).toFixed(3) + ' seconds shy of ' + leaderName);
    } else if(playerP === 1){
      parts.push('you took the light');
    }
    if(isFastest) parts.push('personal best lap');
    subEl.textContent = parts.join(' · ');
  }

  // ── 3 podium cards ────────────────────────────────────────────────
  const podEl = document.getElementById('finLPodium');
  if(podEl){
    podEl.innerHTML = '';
    for(let i=0; i<3 && i<pos.length; i++){
      const car = pos[i];
      const tier = _finTierKey(i+1);
      const tierLbl = (_FIN_TIER_LABEL[i]||'').toUpperCase();
      const personality = car._personality||{};
      const driverName = (personality.name||(car.def&&car.def.name)||'driver').toUpperCase();
      const carDescr = car.def ? (car.def.brand+' '+car.def.name) : '';
      const finishT = (typeof car._finishTime==='number') ? _fmtFinTime(car._finishTime) : '—';
      const bestLap = car.bestLap ? _fmtFinTime(car.bestLap) : '—';
      const isMe = car.isPlayer;
      const card = document.createElement('div');
      card.className = 'finLPodCard' + (isMe?' finLPodMe':'');
      card.setAttribute('data-tier', tier);
      card.innerHTML =
        '<div class="finLPodEy">P'+(i+1)+' · '+tierLbl+'</div>'+
        '<div class="finLPodName">'+driverName+'</div>'+
        '<div class="finLPodCar">'+carDescr+'</div>'+
        '<div class="finLPodTime">'+finishT+'</div>'+
        '<div class="finLPodBest">best '+bestLap+'</div>';
      podEl.appendChild(card);
    }
  }

  // ── YOUR LIGHT strip ─────────────────────────────────────────────
  const set = (id, txt) => { const e = document.getElementById(id); if(e) e.textContent = txt; };
  set('finLRace', raceTimeSec!==null ? _fmtFinTime(raceTimeSec) : '—');
  const bestNode = document.getElementById('finLBest');
  if(bestNode){
    bestNode.textContent = bestLapSec!==null ? (_fmtFinTime(bestLapSec) + (isFastest?' ★':'')) : '—';
  }
  set('finLTop', topSpeed ? topSpeed.toString() : '—');
  set('finLGap', gapSec!==null ? _fmtGap(gapSec) : '—');

  // ── Formation list (all drivers) ─────────────────────────────────
  const formEl = document.getElementById('finLForm');
  if(formEl){
    formEl.innerHTML = '';
    pos.forEach((car, i) => {
      const li = document.createElement('li');
      const personality = car._personality||{};
      const driverName = (personality.name || (car.def&&car.def.name) || 'driver').toUpperCase();
      const time = (typeof car._finishTime==='number') ? _fmtFinTime(car._finishTime) : '—';
      if(car.isPlayer) li.className = 'finLFormMe';
      li.innerHTML =
        '<span class="finLFormPos">P'+(i+1)+'</span>'+
        '<span class="finLFormName">'+driverName+'</span>'+
        '<span class="finLFormTime">'+time+'</span>';
      formEl.appendChild(li);
    });
  }
}

// Schedule a callback that only fires while we are still on the FINISH
// screen. Replaces 8 cascaded `setTimeout(fn, ms)` callsites that each
// carried their own `if(gameState!=='FINISH')return;` guard so a delayed
// toast couldn't pop in during the next race's countdown.
function _afterFinish(ms, fn){
  setTimeout(function(){
    if(gameState!=='FINISH')return;
    fn();
  }, ms);
}

function showFinish(){
  if(typeof _perfHeap==='function')_perfHeap('raceFinish');
  if(window._rpp)_rpp.mark('race:finish',{bestLapMs:bestLapTime!==Infinity?Math.round(bestLapTime*1000):0});
  gameState='FINISH';document.body.classList.add('state-finish');document.getElementById('hud').style.display='none';setTouchControlsVisible(false);
  // Phase 10.2 — stop sun-arc op finish-line zodat exposure niet
  // doorrijdt op podium / leaderboard scene.
  if(typeof window._stopSunArc === 'function') window._stopSunArc();
  const sov=document.getElementById('speedOverlay');if(sov)sov.style.opacity='0';
  if(musicSched){musicSched.stop();musicSched=null;}
  // Menu-mp3 kickoff is deferred to after `p` is known (below) so the
  // victory fanfare on P1 isn't overlapped. The procedural TitleMusic
  // fallback that used to fire here was removed — startMenuMusic() owns
  // menu audio on the finish screen.
  // Stop all ambient audio — prevents harsh noise on finish screen
  Audio.stopWind();
  Audio.stopSandstormWind();
  if(_crowdGain&&audioCtx)_crowdGain.gain.setTargetAtTime(0.0,audioCtx.currentTime,.8);
  // Stop engine + tyre-rolling + car-wind. Een losse engineGain fade dekte
  // alleen de motor; _rollGain en _carWindSampleGain bleven op hun laatste
  // race-waarde hangen omdat updateEngine niet meer draait in FINISH state.
  Audio.stopEngine();
  if(typeof stopWorldAmbient==='function')stopWorldAmbient();
  const pos=getPositions(),p=pos.findIndex(c=>c.isPlayer)+1;
  const ords=['1st 🏆','2nd 🥈','3rd 🥉','4th','5th','6th','7th','8th'];
  const bonuses=[1000,700,500,300,200,100,50,0];
  const msgs=['🏆 CHAMPION!','🥈 EXCELLENT DRIVE!','🥉 PODIUM FINISH!',
              'GREAT EFFORT!','SOLID RACE!','KEEP PRACTICING!','ALMOST THERE!','NEVER GIVE UP!'];
  const titles=['VICTORY','RUNNER UP','PODIUM','GREAT RACE','SOLID FINISH','KEEP GOING','ALMOST THERE','NEVER GIVE UP'];
  const suffixes=['ST PLACE','ND PLACE','RD PLACE','TH PLACE','TH PLACE','TH PLACE','TH PLACE','TH PLACE'];
  totalScore+=bonuses[p-1]||0;
  // Position badge (replaces .finPos / flag-emoji title)
  const badge=document.getElementById('finPositionBadge');
  const posNumEl=document.getElementById('finPosNum');
  const posSuffixEl=document.getElementById('finPosSuffix');
  if(badge)badge.setAttribute('data-pos',p<=3?String(p):(p<=8?'other':'dnf'));
  if(posNumEl)posNumEl.textContent=p;
  if(posSuffixEl)posSuffixEl.textContent=suffixes[p-1]||'TH PLACE';
  // Comeback bonus — reward overtaking from the back of the grid. The
  // player's start position was stored on car._gridPos at spawn time
  // (cars/build.js). Banner + score for ≥4 places gained, gentler ack
  // for any positive overtake. _comebackPlaces is exposed on window so
  // career.js can grant a matching XP boost in awardXP().
  let _comeback=0;
  try{
    const _pCar=carObjs[playerIdx];
    if(_pCar && _pCar._gridPos){
      _comeback=Math.max(0,_pCar._gridPos - p);
    }
  }catch(_){}
  window._comebackPlaces=_comeback;
  if(_comeback>=4){
    const _cbCoins=Math.min(500,_comeback*60);
    totalScore+=_cbCoins;
    _afterFinish(1100, function(){
      if(typeof showBanner==='function')showBanner('🚀 EPIC COMEBACK!','#ff44dd',3000);
      if(typeof floatText==='function')floatText('+'+_cbCoins+' COMEBACK BONUS','#ff44dd',innerWidth*.5,innerHeight*.5);
    });
  }else if(_comeback>=1){
    const _cbCoins=_comeback*40;
    totalScore+=_cbCoins;
    _afterFinish(1100, function(){
      if(typeof showBanner==='function')showBanner('NICE PASS! +'+_cbCoins,'#ffcc00',2000);
    });
  }
  // Sessie 05 — nemesis result. Defeated → bonus + banner; lost →
  // respect ack. Tracks defeated count in localStorage via career.js.
  try{
    if(typeof _nemesisIdx!=='undefined' && _nemesisIdx>=0 && carObjs[_nemesisIdx]){
      const nemCar = carObjs[_nemesisIdx];
      const nemRank = pos.findIndex(c => c === nemCar) + 1;
      const nemP = nemCar._personality || {};
      const tag = (nemP.emoji||'')+' '+(nemP.name||'RIVAL').toUpperCase();
      if(nemRank > 0 && p < nemRank){
        // Defeated
        totalScore += 150;
        if(typeof window._recordNemesisDefeat==='function')
          window._recordNemesisDefeat(nemP.name||'rival');
        _afterFinish(2400, function(){
          if(typeof showBanner==='function')showBanner('🏆 DEFEATED '+tag,'#ffd700',3200);
        });
      } else if(nemRank > 0 && p > nemRank){
        // Lost to nemesis — small respect line
        _afterFinish(2400, function(){
          if(typeof showBanner==='function')showBanner('⚠ '+tag+' WINS AGAIN','#ff2200',2400);
        });
      }
    }
  }catch(_){}
  const finTitle=document.getElementById('finTitle');
  if(finTitle)finTitle.textContent=titles[p-1]||'RACE COMPLETE';
  const _msgEl=document.getElementById('finMsg');
  _msgEl.textContent=msgs[p-1]||msgs[7];
  const _msgCol=p===1?'#ff44dd':p===2?'#cc88ff':p===3?'#a45bff':'#886699';
  _msgEl.style.color=_msgCol;
  _msgEl.style.textShadow='0 0 18px '+_msgCol+'aa, 0 0 36px '+_msgCol+'55';
  // Stat tiles
  const tileBest=document.getElementById('finStatBest');
  const tileBestSub=document.getElementById('finStatBestSub');
  if(tileBest){
    tileBest.textContent=bestLapTime<Infinity?fmtTime(bestLapTime):'—';
    const isFL=bestLapTime<Infinity&&bestLapTime<=_overallFastestLap+0.001;
    if(tileBestSub)tileBestSub.textContent=isFL?'FASTEST LAP':'best lap';
    const tile=document.getElementById('finTileBest');
    if(tile)tile.classList.toggle('tileHighlight',isFL);
  }
  const tileSpeed=document.getElementById('finStatSpeed');
  if(tileSpeed){
    const pCarS=carObjs[playerIdx];
    const spd=pCarS?Math.min(380,Math.round(_raceMaxSpeed*165)):0;
    tileSpeed.textContent=spd;
  }
  const tileScore=document.getElementById('finStatScore');
  if(tileScore)tileScore.textContent=(Number.isFinite(totalScore)?totalScore:0).toLocaleString('en');
  // Post-race stat line (extra info beneath the leaderboard)
  const statEl=document.getElementById('finStats');
  if(statEl){
    statEl.textContent='Overtakes: '+_raceOvertakes+(_achieveUnlocked.size>0?' · '+_achieveUnlocked.size+' achievements':'');
  }
  // Career stats + unlocks
  _raceCount++;
  if(p<=3)_podiumCount++;
  const _earnedCoins=awardCoins(p);
  _lastRaceCoins=_earnedCoins||0;
  const tileCoins=document.getElementById('finStatCoins');
  const tileCoinsSub=document.getElementById('finStatCoinsSub');
  const _coinTotal=Number.isFinite(_coins)?_coins:0;
  if(tileCoins){
    if(_lastRaceCoins>0){
      let counted=0;const target=_lastRaceCoins;const step=Math.max(1,Math.round(target/40));
      tileCoins.textContent='+0';
      const iv=setInterval(()=>{
        counted=Math.min(target,counted+step);
        tileCoins.textContent='+'+counted;
        if(counted>=target){clearInterval(iv);}
      },30);
      const tcTile=document.getElementById('finTileCoins');
      if(tcTile)tcTile.classList.add('tileHighlight');
    }else{
      tileCoins.textContent='+0';
    }
  }
  if(tileCoinsSub)tileCoinsSub.textContent='total '+_coinTotal.toLocaleString('en');
  // Achievement check — lifetime guard via _unlockedAchievements (save.js),
  // niet de session-Set: voorkomt dat dezelfde achievement bij elke race
  // opnieuw als toast verschijnt. Eerste-keer-ever krijgt de toast én
  // wordt in persistent storage opgeslagen.
  var _achStats={hits:carObjs[playerIdx]?carObjs[playerIdx].hitCount:0,maxSpd:Math.round(_raceMaxSpeed*165),fl:bestLapTime!==Infinity&&bestLapTime<=_overallFastestLap+0.001};
  var _firedAch=false;
  ACHIEVEMENTS.forEach(function(ach,ai){
    if(window._unlockedAchievements&&window._unlockedAchievements.has(ach.id))return;
    if(_achieveUnlocked.has(ach.id))return;
    if(ach.check(p,_achStats)){
      _achieveUnlocked.add(ach.id);
      if(window._unlockedAchievements)window._unlockedAchievements.add(ach.id);
      _firedAch=true;
      _afterFinish(2500+ai*2200,function(){showAchievementToast(ach);});
    }
  });
  if(_firedAch&&typeof savePersistent==='function')savePersistent();
  // Daily challenge
  _todayRaces++;
  if(_todayChallenge&&!_challengeCompleted){
    var _dcStats={hits:carObjs[playerIdx]?carObjs[playerIdx].hitCount:0,fl:bestLapTime!==Infinity&&bestLapTime<=_overallFastestLap+0.001};
    if(_todayChallenge.check(p,_dcStats)){
      _challengeCompleted=true;_coins+=_todayChallenge.reward;_totalCoinsEarned+=_todayChallenge.reward;
      _afterFinish(4500,function(){showAchievementToast({icon:'challenge',tier:'gold',title:'UITDAGING VOLTOOID!',desc:_todayChallenge.text+' \u00b7 +'+_todayChallenge.reward+' coins'});});
    }
  }
  const newUnlocks=checkUnlocks(p);
  // ── Career progression — stars + XP + cup-check ──
  // Order: stars first (so cup-progress reads fresh value), then XP (may
  // grant level-up coin bonus), then applyCupUnlocks() (cup completion may
  // unlock reward cars; merge those into newUnlocks for the toast cascade).
  const _starsEarned=(window.RACE_STARS_BY_POS&&window.RACE_STARS_BY_POS[p-1])|0;
  if(typeof window.recordStars==='function')
    window.recordStars(activeWorld,difficulty,_starsEarned);
  // Light up the finish-screen star pips. Pre-existing stars (best from
  // previous runs) glow dim; freshly-earned ones use the bright animation.
  const _starRow=document.getElementById('finStarsRow');
  if(_starRow){
    const pips=_starRow.querySelectorAll('.starPip');
    pips.forEach((pip,idx)=>{
      pip.classList.remove('earned','fresh','dim');
      if(idx < _starsEarned){
        pip.classList.add('earned','fresh');
        // Staggered pop — slot into the same reveal window as other reveals.
        pip.style.animationDelay = (0.7 + idx*0.18) + 's';
      } else {
        pip.classList.add('dim');
      }
    });
  }
  const _pCarStars=carObjs[playerIdx];
  const _clean=_pCarStars?_pCarStars.hitCount===0:false;
  const _xpInfo=(typeof window.awardXP==='function')
    ?window.awardXP(_starsEarned,p,_clean):null;
  const _newCups=(typeof window.applyCupUnlocks==='function')
    ?window.applyCupUnlocks():[];
  // Cup-rewards: completed cups may have just added a reward-car to
  // _unlockedCars. Surface those via the existing showUnlocks cascade so
  // the player sees the unlock toast.
  if(_newCups.length>0 && window.CUPS){
    const cupCarIds=_newCups.map(id=>{
      const c=window.CUPS.find(x=>x.id===id);return c?c.rewardCar:null;
    }).filter(x=>typeof x==='number' && window._unlockedCars && window._unlockedCars.has(x));
    for(const id of cupCarIds) if(!newUnlocks.includes(id)) newUnlocks.push(id);
  }
  // Per-(world × difficulty) lap record — used by selection-screen rival display.
  if(typeof recordLapTime==='function'&&bestLapTime<Infinity){
    const playerCar=carObjs[playerIdx];
    if(playerCar&&playerCar.def)recordLapTime(activeWorld,difficulty,bestLapTime,playerCar.def);
  }
  savePersistent();
  if(newUnlocks.length>0)_afterFinish(2500,()=>showUnlocks(newUnlocks));
  // Level-up toast — fires in the same channel as achievement/daily-challenge
  // toasts (line 69 + 77 timing slots). Skip if no level change.
  if(_xpInfo && _xpInfo.leveledUp){
    _afterFinish(3200,function(){
      showAchievementToast({
        icon:'star',
        tier:'platinum',
        title:'LEVEL '+_xpInfo.newLevel+'!',
        desc:'+'+_xpInfo.coinBonus+' coins  ·  '+_xpInfo.earned+' XP this race'
      });
    });
  }
  // Cup-complete banner — bigger, separate moment from level-up. Slight
  // delay so the showUnlocks cascade and level-up toast don't all stack.
  if(_newCups.length>0 && typeof showBanner==='function'){
    _newCups.forEach((cupId,ci)=>{
      const cup=window.CUPS&&window.CUPS.find(x=>x.id===cupId);
      const label=cup?cup.name+' COMPLETE!':'CUP COMPLETE!';
      _afterFinish(1400 + ci*1800, function(){
        showBanner('🏆 '+label,'#ff44dd',3600);
        if(typeof Audio!=='undefined'&&Audio.playCrowdCheer)Audio.playCrowdCheer();
      });
    });
  }
  // Detect personal record BEFORE savePersistent updates the cached values
  const _preHS=_savedHS,_preBL=_savedBL;
  savePersistent();
  const _newHS=_savedHS>_preHS,_newBL=_savedBL<_preBL;
  if(_newHS||_newBL){
    const rtxt=_newHS&&_newBL?'🏆 NEW RECORDS! SCORE + LAP':_newHS?'🏆 NEW HIGH SCORE!':'⏱ NEW BEST LAP!';
    _afterFinish(900,()=>{showBanner(rtxt,'#ff44dd',3200);Audio.playCrowdCheer();});
    const fhs=document.getElementById('finHighScore');
    if(fhs){fhs.textContent=_newHS?'HIGH SCORE: '+(Number.isFinite(_savedHS)?_savedHS:0).toLocaleString('en'):'';fhs.style.color='#cc88ff';fhs.style.textShadow='0 0 14px #a45bff';}
    if(_newHS){
      const tileScoreHL=document.getElementById('finTileScore');
      if(tileScoreHL)tileScoreHL.classList.add('tileHighlight');
      const scoreSub=document.getElementById('finStatScoreSub');
      if(scoreSub)scoreSub.textContent='NEW BEST';
    }
  }
  // Stats footer — overtakes + pit + achievement count
  const flEl2=document.getElementById('finStats');
  if(flEl2){
    const pitNote=_pitStopUsed?' · Pit stop used':'';
    const achNote=_achieveUnlocked.size>0?' · '+_achieveUnlocked.size+' achievements':'';
    flEl2.textContent='Overtakes: '+_raceOvertakes+pitNote+achNote;
  }
  const tbody=document.getElementById('leaderBody');tbody.innerHTML='';
  pos.forEach((car,i)=>{
    const tr=document.createElement('tr');if(car.isPlayer)tr.className='pRow';
    const bestT=car.bestLap?fmtTime(car.bestLap):'-';
    const flMark=car.isPlayer&&bestLapTime<=_overallFastestLap+0.001?'<span style="color:var(--violet)"> 💜</span>':'';
    tr.innerHTML=`<td>${ords[i]||i+1+'th'}</td><td>${car.def.brand} ${car.def.name}</td><td style="color:var(--text-dim)">${bestT}${flMark}</td>`;
    // Per-row stagger so the leaderboard appears as a smooth top-down
    // cascade right after .finScore reveals (~0.55s) instead of waiting
    // for the parent tbody's late stagger slot (which made the list
    // look "leeg" for ~890ms).
    tr.classList.add('finReveal');
    tr.style.animationDelay=(0.55+i*0.06)+'s';
    tbody.appendChild(tr);
  });
  // 3D Podium
  const podium=document.getElementById('finPodium');
  if(podium&&pos.length>=3){
    // Monochrome neon-paars: licht→donker lavender voor de metal-tinten,
    // pink→diep paars voor de glow zodat de podium-hiërarchie nog leesbaar
    // is zonder de scherm-wide goud/cyan/oranje accenten te herintroduceren.
    const metals=['#cc88ff','#a45bff','#7a55b8'];
    const metalGlow=['#ff44dd','#cc44ff','#8833cc'];
    const podH=[110,82,60]; // heights: 1st tallest
    // Display order left→right: 2nd, 1st, 3rd
    const dispOrder=[1,0,2];
    podium.innerHTML='';
    dispOrder.forEach(rank=>{
      const car=pos[rank];if(!car)return;
      const col='#'+car.def.color.toString(16).padStart(6,'0');
      const medal=metals[rank],glow=metalGlow[rank],h=podH[rank];
      const box=document.createElement('div');box.className='podBox';
      box.innerHTML=
        `<div class="podCarBlock" style="background:linear-gradient(135deg,${col},${col}88);border:2px solid ${col};box-shadow:0 0 14px ${col}66"></div>`+
        `<div class="podLabel" style="color:${medal};text-shadow:0 0 10px ${medal}">${['🏆 1ST','🥈 2ND','🥉 3RD'][rank]}</div>`+
        `<div class="podCarName">${car.def.name}</div>`+
        `<div class="podPlatform" style="height:${h}px;background:linear-gradient(180deg,${medal}44,${medal}11);border:2px solid ${medal};border-bottom:none;box-shadow:0 0 18px ${glow},inset 0 1px 0 ${medal}88">${rank===0?'★':''}</div>`;
      podium.appendChild(box);
    });
  }
  // Show per-lap times below leaderboard
  const lapTimesEl=document.getElementById('finLapTimes');
  if(lapTimesEl&&_lapTimes.length>0){
    lapTimesEl.innerHTML=_lapTimes.map((t,i)=>{
      const isBest=t===bestLapTime;
      return `<span class="lapPill${isBest?' lapPillBest':''}">LAP ${i+1}: ${fmtTime(t)}${isBest?' ★':''}</span>`;
    }).join('');
  }
  // Show damage status
  const pCar2=carObjs[playerIdx];
  if(pCar2&&pCar2.hitCount>=3){
    const dmgEl=document.getElementById('finStats');
    if(dmgEl){const d=pCar2.hitCount>=6?'🔥 HEAVY':'⚠ LIGHT';dmgEl.textContent+=' · '+d+' DAMAGE';}
  }
  var _wfBg={space:'radial-gradient(ellipse at 50% 40%,#000818,#00041a,#000005)',deepsea:'radial-gradient(ellipse at 50% 40%,#001828,#00081a,#000005)',candy:'radial-gradient(ellipse at 50% 40%,#280018,#14000c,#050002)',volcano:'radial-gradient(ellipse at 50% 40%,#1a0800,#0a0400,#000000)',arctic:'radial-gradient(ellipse at 50% 40%,#061428,#020a18,#000005)'};
  var _sfEl=document.getElementById('sFinish');if(_sfEl)_sfEl.style.background=_wfBg[activeWorld]||_wfBg.space;
  // Fill the new Light Edition layout. Reads from pos[], p, bestLapTime,
  // _raceMaxSpeed, carObjs/playerIdx — same source data as the legacy fills
  // above so the two views stay in sync.
  _renderFinishLight(pos, p, _earnedCoins);
  document.getElementById('sFinish').classList.remove('hidden');
  // Staggered reveal — shorter than the old 0.95s ramp so buttons feel
  // actionable from the moment the screen opens. leaderBody rows stagger
  // themselves above (tbody.appendChild path).
  ['finPositionBadge','finTitle','finMsg','finStarsRow','finStatsGrid','finBody','finLapTimes','finExtraStats'].forEach((id,i)=>{
    const el=document.getElementById(id);
    if(el){el.classList.add('finReveal');el.style.animationDelay=(i*.07+.04)+'s';}
  });
  // Hide mirror on finish
  const mf=document.getElementById('mirrorFrame'),ml=document.getElementById('mirrorLabel');
  if(mf)mf.style.display='none';if(ml)ml.style.display='none';
  launchFinishAmbient();
  if(p<=3)launchFinishFireworks();
  if(p===1){
    Audio.playVictory();
    const gc=document.getElementById('goldCelebration');
    if(gc){gc.style.opacity='1';setTimeout(()=>{gc.style.opacity='0';},3500);}
    // Personal CHAMPION banner removed — duplicated finMsg + podium label.
  }
  // Start menu music (MP3) on finish screen after a short delay so the
  // victory fanfare (P1) or race-end beat (others) can settle first.
  setTimeout(()=>{
    if(gameState==='FINISH')startMenuMusic();
  }, p===1?2800:900);
}


// 3D fireworks bij podium-finish — staggered spawn van bestaande
// _tpSpawnFirework (additive Points + light, wereld-onafhankelijk).
// Eigen rAF-loop voor de particle-update (spacefx update is ingebakken
// in de loop en is hier niet beschikbaar). Self-cleanup na fade.
function launchFinishFireworks(){
  if(typeof _tpSpawnFirework!=='function')return;
  const finishMark=performance.now();
  // Force the neon-paars palette so the finish-screen fireworks stay
  // inside the same purple/magenta spectrum as the rest of the UI
  // (the default warm palette would inject gold/cyan/orange).
  const pal=typeof _TP_FIREWORK_PALETTES_NEON!=='undefined'?_TP_FIREWORK_PALETTES_NEON:null;
  // Stagger 5-7 spawns over 4 seconden
  const spawns=[0,400,750,1100,1500,2100,2800];
  spawns.forEach(delay=>{
    setTimeout(()=>{
      if(gameState!=='FINISH')return;
      try{_tpSpawnFirework(pal);}catch(e){}
    },delay);
  });
  // Update-loop — duurt zolang er fireworks "alive" zijn (max ~5s)
  function tick(now){
    if(typeof _tpFireworks==='undefined'||!_tpFireworks.length){
      if(now-finishMark>5000)return; // helemaal klaar
      requestAnimationFrame(tick);return;
    }
    const dt=1/60;
    for(let i=_tpFireworks.length-1;i>=0;i--){
      const fw=_tpFireworks[i];
      fw.age+=dt;
      const life=fw.age/fw.maxAge;
      if(life>=1){
        if(scene){scene.remove(fw.mesh);if(fw.light)scene.remove(fw.light);}
        fw.mesh.geometry.dispose();fw.mesh.material.dispose();
        _tpFireworks.splice(i,1);continue;
      }
      const pos=fw.geo.attributes.position.array;
      for(let j=0;j<pos.length;j+=3){
        pos[j]+=fw.vel[j]*dt;
        pos[j+1]+=fw.vel[j+1]*dt-dt*dt*7;
        pos[j+2]+=fw.vel[j+2]*dt;
        fw.vel[j+1]-=dt*6;
      }
      fw.geo.attributes.position.needsUpdate=true;
      fw.mesh.material.opacity=(1-life)*.9;
      if(fw.light)fw.light.intensity=(1-life)*2.6;
    }
    if(gameState==='FINISH'||_tpFireworks.length>0){
      requestAnimationFrame(tick);
    }
  }
  requestAnimationFrame(tick);
}

// Ambient finish-screen effect — replaces the old canvas confetti.
// Triggers the pure-CSS double radial pulse defined in css/screens.css
// (#finPulseLayer) via a transient class toggle. Auto-clears after the
// animation finishes so a fresh race re-arms the burst cleanly.
function launchFinishAmbient(){
  const sf=document.getElementById('sFinish');
  if(!sf)return;
  sf.classList.remove('finPulsing');
  // Force a reflow so re-adding the class restarts the keyframe animation
  // even if the previous run already finished but the class lingered.
  void sf.offsetWidth;
  sf.classList.add('finPulsing');
  // Keyframes run ~2.65s end-to-end (.55s stagger + 2.1s burst).
  // Drop the class once they finish so the next finish-screen visit
  // can re-trigger from scratch.
  setTimeout(()=>{
    if(sf.classList.contains('finPulsing'))sf.classList.remove('finPulsing');
  },2800);
}


function fadePop(el,dur,cb){
  el.style.transform='scale(1.3)';el.style.opacity='1';
  const s=performance.now();const step=now=>{const p=(now-s)/dur;el.style.opacity=Math.max(0,1-p);el.style.transform=`scale(${1.3-p*.5})`;p<1?requestAnimationFrame(step):cb();};requestAnimationFrame(step);
}
