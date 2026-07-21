// js/gameplay/achievements.js — non-module script.

'use strict';

// Runtime achievement-state (uit main.js verhuisd).
// _achieveUnlocked: ids die deze sessie zijn vrijgespeeld (Set, geen rebind).
const _achieveUnlocked=new Set();

// In-race achievement lookup table (uit main.js verhuisd).
// Gebruikt door unlockAchievement() hieronder. `icon` is een SVG-symbol id
// (zie inline sprite in index.html, prefix #ach-…). `tier` stuurt
// border-/label-kleur in notifications.css (bronze/silver/gold/platinum).
const _RACE_ACHIEVEMENTS={
  SPEED_DEMON: {label:'SPEED DEMON',desc:'Sustain 98% top speed',icon:'bolt',tier:'silver'},
  DRIFT_KING:  {label:'DRIFT KING', desc:'Drift 3+ seconds',icon:'drift',tier:'silver'},
  CLEAN_LAP:   {label:'CLEAN LAP',  desc:'Lap without recovery',icon:'sparkle',tier:'bronze'},
  OVERTAKER:   {label:'OVERTAKER',  desc:'Pass 8 cars in one race',icon:'overtake',tier:'gold'},
  NITRO_JUNKIE:{label:'NITRO JUNKIE',desc:'Use nitro 10x',icon:'nitro',tier:'bronze'},
  FLYING:      {label:'AIRBORNE',   desc:'Airborne 2+ seconds',icon:'wings',tier:'silver'},
  FIRST_BLOOD: {label:'FIRST BLOOD',desc:'Reach P1 after lap 1',icon:'flag',tier:'gold'},
  CHAMPION:    {label:'CHAMPION',   desc:'Finish in 1st place',icon:'trophy',tier:'gold'},
};

// Persistent achievement-definities + dagelijkse challenges (uit main.js verhuisd).
// `check` callbacks lezen runtime-state (_raceCount, _unlockedCars,
// _totalCoinsEarned, _podiumCount, _comboCount, isDark, difficulty)
// via cross-script scope — geëvalueerd ná de race door finish.js.
const ACHIEVEMENTS=[
  {id:'first_win',icon:'trophy',tier:'gold',title:'FIRST WIN',desc:'Win your first race',check:function(p){return p===1&&_raceCount<=1;}},
  {id:'clean',icon:'sparkle',tier:'silver',title:'CLEAN RACER',desc:'Zero damage finish',check:function(p,s){return s.hits===0;}},
  {id:'speed300',icon:'bolt',tier:'silver',title:'SPEED DEMON',desc:'Hit 300+ km/h',check:function(p,s){return s.maxSpd>=300;}},
  {id:'collector',icon:'garage',tier:'bronze',title:'COLLECTOR',desc:'Own 6+ cars',check:function(){return _unlockedCars.size>=6;}},
  {id:'rich',icon:'coin',tier:'gold',title:'COIN MASTER',desc:'Earn 1000+ total coins',check:function(){return _totalCoinsEarned>=1000;}},
  {id:'fl',icon:'lap',tier:'platinum',title:'PURPLE RIBBON',desc:'Set fastest lap',check:function(p,s){return s.fl;}},
  {id:'podium5',icon:'podium',tier:'gold',title:'VETERAN',desc:'5 podium finishes',check:function(){return _podiumCount>=5;}},
  {id:'combo4',icon:'drift',tier:'silver',title:'ON FIRE',desc:'4x combo in a race',check:function(){return _comboCount>=4;}},
  // Sandstorm Canyon — only triggerable on that world. _sandstormLap3CleanFlag
  // is set true when the player enters the FINAL lap in the sandstorm world
  // (final = TOTAL_LAPS, which is user-selectable 1/3/5) and cleared on any
  // recoverActive while still on the final lap (see updateAchievements).
  {id:'sandstorm_eye',icon:'sandstorm',tier:'platinum',title:'EYE OF THE STORM',desc:'Finish the final lap of Sandstorm without going off-track',
    check:function(){return activeWorld==='sandstorm'&&_sandstormLap3CleanFlag;}},
  {id:'sandstorm_mirage',icon:'mirage',tier:'platinum',title:'MIRAGE MASTER',desc:'Win Sandstorm Canyon on Normal+',
    check:function(p){return activeWorld==='sandstorm'&&p===1&&difficulty>=1;}},
];

// Sandstorm Eye-of-the-Storm tracker. Cross-script (race.js resets it on
// _resetRaceState), updateAchievements below reads/writes it. Defaults to
// true so that if the player does manage a clean lap-3, the flag is set
// at the moment the off-track-during-lap-3 condition is invalidated.
// Specifically: starts false, becomes true when reaching lap 3 in sandstorm,
// becomes false again on any recoverActive while still in lap 3.
var _sandstormLap3CleanFlag=false;
var _sandstormPrevLap=0;
var DAILY_CHALLENGES=[
  {id:'win',text:'Win een race',reward:150,check:function(p){return p===1;}},
  {id:'clean',text:'Finish zonder schade',reward:200,check:function(p,s){return s.hits===0;}},
  {id:'fl',text:'Zet de snelste ronde',reward:120,check:function(p,s){return s.fl;}},
  {id:'night',text:'Win een nachtrace',reward:160,check:function(p){return p===1&&isDark;}},
  {id:'hard',text:'Top 3 op Hard',reward:250,check:function(p){return p<=3&&difficulty===2;}},
  {id:'p3',text:'Podium finish',reward:100,check:function(p){return p<=3;}},
  {id:'combo3',text:'Haal een 3x combo',reward:180,check:function(){return _comboCount>=3;}},
];

function unlockAchievement(id){
  if(_achieveUnlocked.has(id))return;
  _achieveUnlocked.add(id);
  var a=_RACE_ACHIEVEMENTS[id];
  if(!a)return;
  // Lifetime guard — herhaal-toasts onderdrukken zodra de speler een
  // achievement ooit heeft verdiend (persistent set uit save.js).
  if(window._unlockedAchievements&&window._unlockedAchievements.has(id))return;
  if(window._unlockedAchievements)window._unlockedAchievements.add(id);
  showAchievementToast({icon:a.icon||'trophy',tier:a.tier||'bronze',title:a.label,desc:a.desc||''});
  if(typeof playCrowdCheer==='function')Audio.playCrowdCheer();
  if(typeof savePersistent==='function')savePersistent();
}

// Seconden sinds countdown-GO; 0 zolang de race nog niet officieel
// gestart is. _raceGoTime wordt gezet in ui/navigation.js bij GO.
function _raceSecondsSinceGo(){
  return (typeof _raceGoTime!=='undefined' && _raceGoTime>0) ? (_nowSec-_raceGoTime) : 0;
}


function updateAchievements(dt){
  const car=carObjs[playerIdx];if(!car)return;
  // Track max speed (altijd registreren — gebruikt door finish.js SPEED-300 check)
  if(car.speed>_raceMaxSpeed)_raceMaxSpeed=car.speed;
  // Sandstorm Eye-of-the-Storm lap-tracker draait ALTIJD (anders mist 'm de
  // lap-edge bij grace-skip). Zelfde voor _cleanLapFlag reset.
  if(recoverActive)_cleanLapFlag=false;
  if(activeWorld==='sandstorm'){
    const _final=TOTAL_LAPS;
    if(car.lap===_final&&_sandstormPrevLap!==_final){
      _sandstormLap3CleanFlag=true;
    }
    if(recoverActive&&car.lap===_final)_sandstormLap3CleanFlag=false;
    _sandstormPrevLap=car.lap;
  }
  // Overtakes-teller blijft buiten de grace zodat _raceOvertakes / FIRST_BLOOD
  // de juiste start-positie als referentie houden — maar de daadwerkelijke
  // OVERTAKER / FIRST_BLOOD unlocks zitten ACHTER de grace.
  const curPos=_playerRank();
  if(curPos<_lastPlayerPos){
    _raceOvertakes+=(_lastPlayerPos-curPos);
  }
  _lastPlayerPos=curPos;
  // Grace-window — eerste 15s na GO geen in-race achievements. Voorkomt dat
  // de speler binnen seconden na de start "prijzen" stapelt door slipstream-
  // boost (SPEED_DEMON), grid-sort (OVERTAKER/FIRST_BLOOD) etc.
  if(_raceSecondsSinceGo()<15)return;
  // Speed demon — 98% topSpd én 1.5s sustained. Korte slipstream-pieken
  // tellen niet meer.
  if(car.speed>=car.def.topSpd*.98)_speedDemonAccum+=dt;else _speedDemonAccum=0;
  if(_speedDemonAccum>=1.5)unlockAchievement('SPEED_DEMON');
  // Drift king
  if(driftTimer>0)_driftAccum+=dt;else _driftAccum=0;
  if(_driftAccum>=3.0)unlockAchievement('DRIFT_KING');
  // Airborne
  if(car.inAir)_airborneAccum+=dt;else _airborneAccum=0;
  if(_airborneAccum>=2.0)unlockAchievement('FLYING');
  // First blood — alleen na lap 1, zodat een P1-start of P1-bij-eerste-curve
  // niet als verdienste telt.
  if(curPos===1&&car.lap>=2)unlockAchievement('FIRST_BLOOD');
  if(_raceOvertakes>=8)unlockAchievement('OVERTAKER');
  // Nitro junkie tracked via activations in updatePlayer
}


function onNitroActivate(){
  _nitroUseCount++;
  if(_nitroUseCount>=10)unlockAchievement('NITRO_JUNKIE');
}

function onLapComplete(){
  if(_cleanLapFlag)unlockAchievement('CLEAN_LAP');
  _cleanLapFlag=true; // reset for next lap
}


// showAchievementToast: thin wrapper rond Notify.achievement.
// Externe call-sites (finish.js voor post-race achievements + daily-challenge)
// blijven werken zonder wijziging.
function showAchievementToast(ach){
  if(!ach) return;
  if(!window.Notify){
    if(window.dbg)dbg.warn('notify','Notify niet ready, drop achievement',ach.title||ach.label);
    return;
  }
  Notify.achievement({
    title: ach.title||ach.label||'',
    desc:  ach.desc||'',
    icon:  ach.icon||'trophy',
    tier:  ach.tier||'gold',
  });
}

function initDailyChallenge(){
  var di=new Date().getDate()%DAILY_CHALLENGES.length;
  _todayChallenge=DAILY_CHALLENGES[di];
  var ce=document.getElementById('dailyChallengeEl');
  if(ce&&_todayChallenge){
    ce.innerHTML='<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase">DAGELIJKSE UITDAGING</div><div style="font-family:var(--font-body);font-size:11px;color:var(--text);margin-top:3px">'+_todayChallenge.text+'</div><div style="font-family:var(--font-mono);font-size:10px;color:var(--gold);margin-top:2px">+'+_todayChallenge.reward+' \u{1F4B0}</div>';
  }
}
