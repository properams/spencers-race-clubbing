// js/audio/ambient.js — Fase 2.3/2.4 extraction. Non-module script.
//
// Dispatch-laag: thunder/crowd-cheer/crowd-loop/wind-loop checken eerst
// of een sample-buffer geladen is via window._hasAmbientSample (uit
// samples.js). Zo ja → sample. Zo nee → procedurele fallback.


// Ambient shorthand — gebruikt _playBufferOneShot uit sfx.js (zelfde script-scope).
function _playAmbientOneShot(slots, vol=0.6, delay=0){
  return _playBufferOneShot(window._hasAmbientSample,window._getAmbientBuffer,slots,vol,delay);
}

'use strict';

// Ambient audio refs (uit main.js verhuisd). Gevuld door initCrowdNoise()
// en startAmbientWind() hieronder; lazy-init op race-start, gestopt bij
// race-end in gameplay/finish.js. Cross-script: ui/hud.js + tracklimits.js
// + finish.js doen _crowdGain.gain.setTargetAtTime(...) bij overtake/finish.
// effects/night.js update _ambientWindGain volume per dag↔nacht-fase.
let _ambientWind=null,_ambientWindGain=null;
let _crowdSrc=null,_crowdGain=null;

function playThunder(){
  if(!audioCtx)return;
  // Sample-pad: random pick uit thunder1/2/3 met willekeurige delay zodat
  // de procedurele variatie behouden blijft.
  const delay=.4+Math.random()*1.8;
  if(_playAmbientOneShot(['thunder1','thunder2','thunder3'],0.38,delay))return;
  const t=audioCtx.currentTime+delay;
  const sz=Math.ceil(audioCtx.sampleRate*2.8);
  const buf=audioCtx.createBuffer(1,sz,audioCtx.sampleRate);
  const d=buf.getChannelData(0);for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
  const src=audioCtx.createBufferSource();src.buffer=buf;
  const f=audioCtx.createBiquadFilter();f.type='lowpass';f.frequency.value=110;f.Q.value=.4;
  const g=audioCtx.createGain();
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.30,t+.06);
  g.gain.setValueAtTime(.30,t+.32);g.gain.exponentialRampToValueAtTime(.001,t+2.6);
  src.connect(f);f.connect(g);g.connect(_dst());src.start(t);src.stop(t+2.8);
  beep(75,.08,.45,delay,'sawtooth');_noise(.1,240,2,.28,delay+.01);
}

function updateThunder(dt){
  if(!isRain||!audioCtx)return;
  _thunderTimer-=dt;
  if(_thunderTimer<=0){Audio.playThunder();_thunderTimer=9+Math.random()*20;}
}

// World-aware crowd-audio gate: returns true if the active world has any
// visible spectators (registered via _crowdMaterials in track/collectibles
// or in track/collectibles.js). Worlds without spectators (currently GP) get
// no ambient crowd-loop and no per-event cheers — silence matches the
// visual scene.
function _hasVisibleCrowd(){
  return typeof _crowdMaterials!=='undefined' && _crowdMaterials.length>0;
}

function initCrowdNoise(){
  if(!audioCtx||_crowdGain)return;
  if(!_hasVisibleCrowd())return; // skip: no spectators in this world
  // Sample-pad: gebruik crowdLoop buffer als geladen (en niet force-procedural).
  if(!window._forceProceduralAudio&&window._hasAmbientSample&&window._hasAmbientSample('crowdLoop')){
    const buf=window._getAmbientBuffer('crowdLoop');
    if(buf){
      const src=audioCtx.createBufferSource();src.buffer=buf;src.loop=true;
      _crowdGain=audioCtx.createGain();_crowdGain.gain.value=0;
      src.connect(_crowdGain);_crowdGain.connect(_dst());
      src.start();_crowdSrc=src;
      return;
    }
  }
  // Procedurele fallback: dual-bandpass noise loop.
  const sz=Math.ceil(audioCtx.sampleRate*3.2);
  const buf=audioCtx.createBuffer(1,sz,audioCtx.sampleRate);
  const d=buf.getChannelData(0);for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
  const src=audioCtx.createBufferSource();src.buffer=buf;src.loop=true;
  const f1=audioCtx.createBiquadFilter();f1.type='bandpass';f1.frequency.value=580;f1.Q.value=1.4;
  const f2=audioCtx.createBiquadFilter();f2.type='bandpass';f2.frequency.value=950;f2.Q.value=.9;
  _crowdGain=audioCtx.createGain();_crowdGain.gain.value=0;
  src.connect(f1);src.connect(f2);f1.connect(_crowdGain);f2.connect(_crowdGain);_crowdGain.connect(_dst());
  src.start();_crowdSrc=src;
}

function stopCrowdNoise(){
  if(_crowdGain){const t=audioCtx.currentTime;_crowdGain.gain.setTargetAtTime(0,t,.3);}
  const ref=_crowdSrc;setTimeout(()=>{try{ref&&ref.stop();}catch(e){}},800);
  _crowdSrc=null;_crowdGain=null;
  _lastCrowdTarget=-1; // reset so next race re-applies its first target
}

// Per-frame crowd gain setter — was calling setTargetAtTime on every
// frame regardless of whether the target had changed. Even though the
// gain reaches the same value, each call enqueues a fresh AudioParam
// automation event on the audio thread (small but cumulative). Delta-
// gate skips re-issue when pos band hasn't changed.
let _lastCrowdTarget=-1;
function updateCrowdNoise(pPos){
  if(!_crowdGain||!audioCtx)return;
  const target=pPos===1?.062:pPos<=3?.036:.016;
  if(target===_lastCrowdTarget)return;
  _lastCrowdTarget=target;
  _crowdGain.gain.setTargetAtTime(target,audioCtx.currentTime,.9);
}


function startAmbientWind(){
  if(!audioCtx||_ambientWind)return;
  // Sample-pad: gebruik windLoop buffer als geladen.
  if(!window._forceProceduralAudio&&window._hasAmbientSample&&window._hasAmbientSample('windLoop')){
    const buf=window._getAmbientBuffer('windLoop');
    if(buf){
      const src=audioCtx.createBufferSource();src.buffer=buf;src.loop=true;
      const g=audioCtx.createGain();g.gain.value=0;
      src.connect(g);g.connect(_dst());src.start();
      // 2026-05-02: initial gain blijft op 0 — updateAmbientWindSpeed
      // (effects/night.js) gate't gain op speed-ratio >= 65%. Voorheen:
      // ramp naar 0.038 die hoorbaar was tijdens countdown/stilstand.
      const t=audioCtx.currentTime;g.gain.setValueAtTime(0,t);
      _ambientWind=src;_ambientWindGain=g;
      return;
    }
  }
  // Procedurele fallback: bandpass + highpass filter chain
  const sz=audioCtx.sampleRate*2;
  const buf=audioCtx.createBuffer(1,sz,audioCtx.sampleRate);
  const d=buf.getChannelData(0);for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
  const src=audioCtx.createBufferSource();src.buffer=buf;src.loop=true;
  const f1=audioCtx.createBiquadFilter();f1.type='bandpass';f1.frequency.value=280;f1.Q.value=.25;
  const f2=audioCtx.createBiquadFilter();f2.type='highpass';f2.frequency.value=100;f2.Q.value=.1;
  const g=audioCtx.createGain();g.gain.value=0;
  src.connect(f1);f1.connect(f2);f2.connect(g);g.connect(_dst());
  src.start();
  // 2026-05-02: initial gain blijft op 0 — updateAmbientWindSpeed
  // (effects/night.js) gate't gain op speed-ratio >= 65%. Voorheen:
  // ramp naar 0.038 die hoorbaar was tijdens countdown/stilstand.
  const t=audioCtx.currentTime;g.gain.setValueAtTime(0,t);
  _ambientWind=src;_ambientWindGain=g;
}

function stopAmbientWind(){
  if(!_ambientWind)return;
  if(_ambientWindGain){
    const t=audioCtx.currentTime;
    _ambientWindGain.gain.setTargetAtTime(0,t,.4);
  }
  const ref=_ambientWind;
  setTimeout(()=>{try{ref.stop();}catch(e){}},1200);
  _ambientWind=null;_ambientWindGain=null;
}

// ── Sandstorm wind ambient ──────────────────────────────────────────────
// Two-band noise loop driven by the rolling sandstorm hazard:
//   • lowpass branch — deep wind rumble (the "weight" of the storm)
//   • bandpass branch — high sand-sizzle (sand grains hitting metal)
// Both feed a master gain modulated by `updateSandstormWind(intensity)`,
// where intensity is the lap-driven 0..1 blend from the hazard module.
//
// `_gen` counter follows the same race-condition pattern as RaceMusic:
// each (re)init increments _gen so a stale stop() callback can't tear
// down the freshly-built nodes after a quick stop→start cycle.
let _sandstormWind=null;     // {srcLow, srcBand, gainLow, gainBand, master, _gen}
let _sandstormWindGen=0;
const _SANDSTORM_WIND_RAMP=0.25;  // master-gain ramp in seconds

function _ssCreateNoiseSrc(durSec){
  const sz=Math.ceil(audioCtx.sampleRate*durSec);
  const buf=audioCtx.createBuffer(1,sz,audioCtx.sampleRate);
  const d=buf.getChannelData(0);
  for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
  const src=audioCtx.createBufferSource();
  src.buffer=buf;src.loop=true;
  return src;
}

function initSandstormWind(){
  if(!audioCtx)return;
  if(_sandstormWind)return; // idempotent — already running
  const gen=++_sandstormWindGen;
  // Lowpass rumble branch (deep wind)
  const srcLow=_ssCreateNoiseSrc(2.4);
  const lp=audioCtx.createBiquadFilter();
  lp.type='lowpass';lp.frequency.value=180;lp.Q.value=0.4;
  const gainLow=audioCtx.createGain();
  gainLow.gain.value=0.40;
  // Bandpass sand-sizzle branch (high frequencies)
  const srcBand=_ssCreateNoiseSrc(2.8);
  const bp=audioCtx.createBiquadFilter();
  bp.type='bandpass';bp.frequency.value=2400;bp.Q.value=1.2;
  const gainBand=audioCtx.createGain();
  gainBand.gain.value=0.25;
  // Master gain — modulated by updateSandstormWind() per-frame from hazard.
  const master=audioCtx.createGain();
  master.gain.value=0;
  srcLow.connect(lp);lp.connect(gainLow);gainLow.connect(master);
  srcBand.connect(bp);bp.connect(gainBand);gainBand.connect(master);
  master.connect(_dst());
  // Stagger source-starts by a few ms so the noise doesn't phase-align
  // (would produce a faint comb-filter coloration at higher gain).
  const t=audioCtx.currentTime;
  srcLow.start(t);
  srcBand.start(t+0.03);
  _sandstormWind={srcLow,srcBand,gainLow,gainBand,lp,bp,master,_gen:gen};
}

function updateSandstormWind(intensity){
  if(!audioCtx)return;
  if(!_sandstormWind)initSandstormWind();
  if(!_sandstormWind)return;
  const v=Math.max(0,Math.min(1,+intensity||0));
  const t=audioCtx.currentTime;
  // Master gain follows intensity smoothly. setTargetAtTime gives a clean
  // exponential approach without glitching when the value is re-issued.
  try{
    _sandstormWind.master.gain.setTargetAtTime(v*0.22,t,_SANDSTORM_WIND_RAMP);
    // Filter-cutoff sweep: quiet storm = duller (lower lowpass cutoff,
    // tighter bandpass), full storm = brighter (more sand sizzle).
    _sandstormWind.lp.frequency.setTargetAtTime(160+v*240,t,_SANDSTORM_WIND_RAMP);
    _sandstormWind.bp.frequency.setTargetAtTime(2200+v*900,t,_SANDSTORM_WIND_RAMP);
  }catch(_){}
}

function stopSandstormWind(){
  if(!_sandstormWind)return;
  const ref=_sandstormWind;
  // Increment gen first so any pending in-flight init/update can't read
  // a stale ref after the disconnect.
  _sandstormWindGen++;
  _sandstormWind=null;
  if(audioCtx){
    const t=audioCtx.currentTime;
    try{ref.master.gain.cancelScheduledValues(t);
        ref.master.gain.setTargetAtTime(0,t,0.30);}catch(_){}
  }
  // Hard-stop the buffer sources after the fade so the WebAudio graph
  // releases them. setTimeout is the standard pattern in this codebase
  // (see startAmbientWind / playThunder).
  setTimeout(()=>{
    try{ref.srcLow.stop();}catch(_){}
    try{ref.srcBand.stop();}catch(_){}
    try{ref.master.disconnect();}catch(_){}
    try{ref.gainLow.disconnect();}catch(_){}
    try{ref.gainBand.disconnect();}catch(_){}
    try{ref.lp.disconnect();}catch(_){}
    try{ref.bp.disconnect();}catch(_){}
  },800);
}

// ── Sessie 04 V2 — per-world procedural ambient drones ──────────────────
//
// Each world gets a thin signature drone that runs underneath the music.
// Space = deep void hum, Deepsea = underwater pressure + whale glide,
// Volcano = sub-bass rumble, Arctic = filtered wind howl. Others can be
// added later. Single _worldAmbient slot — switching worlds replaces it.
// Generation counter guards against init/stop races (mirrored from the
// sandstorm wind pattern).
let _worldAmbient=null,_worldAmbientGen=0;

function _waNoiseSrc(durSec){
  const sr=audioCtx.sampleRate;
  const sz=Math.ceil(sr*durSec);
  const buf=audioCtx.createBuffer(1,sz,sr);
  const d=buf.getChannelData(0);
  for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
  const src=audioCtx.createBufferSource();
  src.buffer=buf;src.loop=true;
  return src;
}

function _initSpaceVoidHum(){
  const gen=++_worldAmbientGen;
  // Two sub-bass sines (35Hz + slight detune 35.7Hz) for binaural-ish beat.
  const o1=audioCtx.createOscillator(),o2=audioCtx.createOscillator();
  o1.type='sine';o2.type='sine';
  o1.frequency.value=35;o2.frequency.value=35.7;
  // Slow LFO on a gain — the drone breathes over ~14s.
  const lfo=audioCtx.createOscillator(),lfoGain=audioCtx.createGain();
  lfo.type='sine';lfo.frequency.value=0.07;
  lfoGain.gain.value=0.05;
  const master=audioCtx.createGain();
  master.gain.value=0;
  o1.connect(master);o2.connect(master);
  lfo.connect(lfoGain);lfoGain.connect(master.gain);
  master.connect(_dst());
  const t=audioCtx.currentTime;
  o1.start(t);o2.start(t+0.02);lfo.start(t);
  master.gain.setTargetAtTime(0.18,t,1.2);
  return {nodes:[o1,o2,lfo,lfoGain,master], master, _gen:gen};
}

function _initDeepSeaAmbient(){
  const gen=++_worldAmbientGen;
  // Filtered noise = under-water pressure.
  const src=_waNoiseSrc(3.0);
  const lp=audioCtx.createBiquadFilter();
  lp.type='lowpass';lp.frequency.value=420;lp.Q.value=0.6;
  const noiseGain=audioCtx.createGain();noiseGain.gain.value=0.20;
  // Occasional whale-call: a slow sine glide every ~12-24s. Implemented as
  // a re-arming setTimeout chain that aborts when the gen changes.
  const master=audioCtx.createGain();
  master.gain.value=0;
  src.connect(lp);lp.connect(noiseGain);noiseGain.connect(master);
  master.connect(_dst());
  const t=audioCtx.currentTime;
  src.start(t);
  master.gain.setTargetAtTime(0.24,t,1.6);
  function _whale(){
    if(gen!==_worldAmbientGen||!_worldAmbient)return;
    const start=audioCtx.currentTime+0.05;
    const wo=audioCtx.createOscillator(),wg=audioCtx.createGain();
    wo.type='sine';
    wo.frequency.setValueAtTime(110+Math.random()*40,start);
    wo.frequency.exponentialRampToValueAtTime(40+Math.random()*30,start+2.4);
    wg.gain.setValueAtTime(0,start);
    wg.gain.linearRampToValueAtTime(0.10,start+0.5);
    wg.gain.linearRampToValueAtTime(0,start+2.6);
    wo.connect(wg);wg.connect(master);
    wo.start(start);wo.stop(start+2.8);
    setTimeout(_whale, 12000+Math.random()*12000);
  }
  setTimeout(_whale, 4000+Math.random()*4000);
  return {nodes:[src,lp,noiseGain,master], master, _gen:gen};
}

function _initVolcanoRumble(){
  const gen=++_worldAmbientGen;
  // Lowpass noise + irregular bass thumps.
  const src=_waNoiseSrc(2.6);
  const lp=audioCtx.createBiquadFilter();
  lp.type='lowpass';lp.frequency.value=90;lp.Q.value=0.5;
  const noiseGain=audioCtx.createGain();noiseGain.gain.value=0.55;
  const master=audioCtx.createGain();
  master.gain.value=0;
  src.connect(lp);lp.connect(noiseGain);noiseGain.connect(master);
  master.connect(_dst());
  const t=audioCtx.currentTime;
  src.start(t);
  master.gain.setTargetAtTime(0.22,t,1.4);
  // Irregular sub-bass thumps every 6-14s.
  function _thump(){
    if(gen!==_worldAmbientGen||!_worldAmbient)return;
    const start=audioCtx.currentTime+0.05;
    const bo=audioCtx.createOscillator(),bg=audioCtx.createGain();
    bo.type='sine';
    bo.frequency.setValueAtTime(60,start);
    bo.frequency.exponentialRampToValueAtTime(28,start+0.45);
    bg.gain.setValueAtTime(0.30,start);
    bg.gain.exponentialRampToValueAtTime(0.001,start+0.7);
    bo.connect(bg);bg.connect(master);
    bo.start(start);bo.stop(start+0.75);
    setTimeout(_thump, 6000+Math.random()*8000);
  }
  setTimeout(_thump, 3000+Math.random()*4000);
  return {nodes:[src,lp,noiseGain,master], master, _gen:gen};
}

function _initArcticHowl(){
  const gen=++_worldAmbientGen;
  // Bandpass wind with slow vibrato on frequency.
  const src=_waNoiseSrc(2.6);
  const bp=audioCtx.createBiquadFilter();
  bp.type='bandpass';bp.frequency.value=1400;bp.Q.value=1.6;
  const vibrato=audioCtx.createOscillator(),vibGain=audioCtx.createGain();
  vibrato.type='sine';vibrato.frequency.value=0.18;
  vibGain.gain.value=300;
  vibrato.connect(vibGain);vibGain.connect(bp.frequency);
  const noiseGain=audioCtx.createGain();noiseGain.gain.value=0.45;
  const master=audioCtx.createGain();
  master.gain.value=0;
  src.connect(bp);bp.connect(noiseGain);noiseGain.connect(master);
  master.connect(_dst());
  const t=audioCtx.currentTime;
  src.start(t);vibrato.start(t);
  master.gain.setTargetAtTime(0.20,t,1.6);
  // Occasional ice-creak: a short filtered noise burst with rising pitch.
  function _creak(){
    if(gen!==_worldAmbientGen||!_worldAmbient)return;
    const start=audioCtx.currentTime+0.05;
    const csrc=_waNoiseSrc(0.45);
    const cbf=audioCtx.createBiquadFilter();
    cbf.type='bandpass';
    cbf.frequency.setValueAtTime(400,start);
    cbf.frequency.exponentialRampToValueAtTime(2200,start+0.40);
    cbf.Q.value=4;
    const cg=audioCtx.createGain();
    cg.gain.setValueAtTime(0,start);
    cg.gain.linearRampToValueAtTime(0.18,start+0.06);
    cg.gain.linearRampToValueAtTime(0,start+0.42);
    csrc.connect(cbf);cbf.connect(cg);cg.connect(master);
    csrc.start(start);csrc.stop(start+0.48);
    setTimeout(_creak, 14000+Math.random()*16000);
  }
  setTimeout(_creak, 7000+Math.random()*8000);
  return {nodes:[src,bp,vibrato,vibGain,noiseGain,master], master, _gen:gen};
}

function stopWorldAmbient(){
  if(!_worldAmbient)return;
  const ref=_worldAmbient;
  _worldAmbientGen++;
  _worldAmbient=null;
  if(!audioCtx)return;
  const t=audioCtx.currentTime;
  try{
    ref.master.gain.cancelScheduledValues(t);
    ref.master.gain.setTargetAtTime(0,t,0.5);
  }catch(_){}
  setTimeout(()=>{
    for(let i=0;i<ref.nodes.length;i++){
      const n=ref.nodes[i];
      try{if(n.stop)n.stop();}catch(_){}
      try{n.disconnect();}catch(_){}
    }
  },1100);
}

function setWorldAmbient(worldId){
  if(!audioCtx)return;
  // Always tear down the old one first to keep memory bounded.
  if(_worldAmbient){
    stopWorldAmbient();
  }
  // Dispatch on world. Worlds without an entry simply get silence in this
  // channel (other ambient sources — crowd, wind, sandstorm — are
  // independent).
  switch(worldId){
    case 'space':                _worldAmbient=_initSpaceVoidHum(); break;
    case 'deepsea':              _worldAmbient=_initDeepSeaAmbient(); break;
    case 'volcano':              _worldAmbient=_initVolcanoRumble(); break;
    case 'arctic':               _worldAmbient=_initArcticHowl(); break;
    // candy, sandstorm, pier47, guangzhou — covered by
    // existing ambient layers (crowd, sandstorm wind, music).
    default: break;
  }
}

// Duck/restore alle ambient-loops op pauze. Music-ducking gebeurt al via
// _musicMuted+_applyMusicGain in ui/pause.js; deze helper dekt de andere
// loops (wind, crowd, sandstorm, world-drones) zodat het pauze-overlay
// volledig stil is. De game-loop returnt early op gamePaused (core/loop.js)
// dus zonder dit blijven de gain-nodes op hun laatste waarde doorspelen.
function setAmbientPaused(paused){
  if(!audioCtx) return;
  const t = audioCtx.currentTime;
  const ramp = 0.15;
  // Wind — alleen op pause naar 0. Op resume herzet updateAmbientWindSpeed
  // (effects/night.js) de gain per-frame zodra de loop weer draait.
  if(_ambientWindGain && paused){
    try{
      _ambientWindGain.gain.cancelScheduledValues(t);
      _ambientWindGain.gain.setTargetAtTime(0, t, ramp);
    }catch(_){}
  }
  // Crowd — alleen op pause naar 0. Op resume reset _lastCrowdTarget zodat
  // updateCrowdNoise() z'n delta-gate doorbreekt en de gain herstelt.
  if(_crowdGain){
    if(paused){
      try{
        _crowdGain.gain.cancelScheduledValues(t);
        _crowdGain.gain.setTargetAtTime(0, t, ramp);
      }catch(_){}
    } else {
      _lastCrowdTarget = -1;
    }
  }
  // Sandstorm — master gain wordt per-frame door updateSandstormWind()
  // herzet, dus alleen op pause naar 0 trekken.
  if(_sandstormWind && _sandstormWind.master && paused){
    try{
      _sandstormWind.master.gain.cancelScheduledValues(t);
      _sandstormWind.master.gain.setTargetAtTime(0, t, ramp);
    }catch(_){}
  }
  // World-ambient drone (Space/Deepsea/Volcano/Arctic) — heeft geen
  // per-frame updater, dus target onthouden om bij resume terug te ramp'en.
  if(_worldAmbient && _worldAmbient.master){
    const m = _worldAmbient.master;
    try{
      if(paused){
        if(typeof m._pauseTarget !== 'number') m._pauseTarget = m.gain.value;
        m.gain.cancelScheduledValues(t);
        m.gain.setTargetAtTime(0, t, ramp);
      } else {
        const tgt = (typeof m._pauseTarget === 'number') ? m._pauseTarget : m.gain.value;
        m.gain.cancelScheduledValues(t);
        m.gain.setTargetAtTime(tgt, t, ramp);
      }
    }catch(_){}
  }
}

if(typeof window!=='undefined'){
  window.setWorldAmbient = setWorldAmbient;
  window.stopWorldAmbient = stopWorldAmbient;
  window.setAmbientPaused = setAmbientPaused;
  // Expose _worldAmbient via a getter so consumers can check whether the
  // drone is already running without needing to import the module-local
  // binding. Used by navigation.js prewarm guard.
  Object.defineProperty(window, '_worldAmbient', {
    get(){ return _worldAmbient; },
    configurable: true
  });
}

function playCrowdCheer(){
  if(!audioCtx)return;
  if(!_hasVisibleCrowd())return; // skip: no spectators in this world
  if(_playAmbientOneShot('crowdCheer',0.42))return;
  const sz=Math.ceil(audioCtx.sampleRate*.55);
  const buf=audioCtx.createBuffer(1,sz,audioCtx.sampleRate);
  const d=buf.getChannelData(0);for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
  const src=audioCtx.createBufferSource();src.buffer=buf;
  const f=audioCtx.createBiquadFilter();f.type='bandpass';f.frequency.value=750;f.Q.value=1.8;
  const g=audioCtx.createGain();
  const t=audioCtx.currentTime;
  g.gain.setValueAtTime(.0,t);g.gain.linearRampToValueAtTime(.10,t+.08);
  g.gain.setValueAtTime(.10,t+.22);g.gain.exponentialRampToValueAtTime(.001,t+.58);
  src.connect(f);f.connect(g);g.connect(_dst());src.start(t);src.stop(t+.62);
  [550,850,1300,1800].forEach((freq,i)=>{
    const o=audioCtx.createOscillator(),og=audioCtx.createGain();
    o.type='sine';
    o.frequency.setValueAtTime(freq*.75,t+i*.045);
    o.frequency.exponentialRampToValueAtTime(freq*1.35,t+i*.045+.22);
    og.gain.setValueAtTime(.025,t+i*.045);og.gain.exponentialRampToValueAtTime(.001,t+i*.045+.28);
    o.connect(og);og.connect(_dst());o.start(t+i*.045);o.stop(t+i*.045+.32);
  });
}

