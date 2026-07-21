// js/audio/engine.js — Fase 2.3/2.4 extraction. Non-module script.
//
// SURFACE-AWARE TIRE: tire-rolling noise loop wordt per oppervlakte
// gefilterd zodat asphalt/sand/ice/metal/water elk eigen karakter
// hebben. Surface komt uit window._getCurrentSurface() (samples.js,
// per-wereld default in WORLD_DEFAULT_SURFACE).
//
// SAMPLE ENGINE: als _hasEngineSamples(carType) true is en de A/B toggle
// niet gedwongen procedural staat, dispatcht updateEngine naar SampleEngine
// en wordt de procedurele 4-osc gain stilgezet. Als samples ontbreken
// blijft de bestaande procedural setup actief.
//
// CAR-WIND: aparte highpass-filtered noise loop, fade-in boven ~70%
// topspeed. Onafhankelijk van engine-pad — werkt altijd.

// Per-surface tire-rolling parameters: noise filter freq + Q + gain-mult.
// Gekozen op gehoor — sand = laag/breed (rommelig), ice = hoog/sparse,
// water = mid/laag-Q (vlot), metal = mid/hoog-Q (zingt mee), dirt =
// asphalt + lager center.
const SURFACE_PARAMS = {
  asphalt: { freqBase: 200, freqScale: 180, Q: 2.0, gain: 0.025 },
  sand:    { freqBase: 140, freqScale: 100, Q: 0.7, gain: 0.034 },
  ice:     { freqBase: 320, freqScale: 240, Q: 1.2, gain: 0.018 },
  water:   { freqBase: 180, freqScale: 140, Q: 0.9, gain: 0.038 },
  metal:   { freqBase: 240, freqScale: 220, Q: 4.5, gain: 0.022 },
  dirt:    { freqBase: 160, freqScale: 130, Q: 1.4, gain: 0.034 },
};

'use strict';

// Engine audio state (uit main.js verhuisd).
//   engineOsc / engineGain — multi-oscillator engine (initEngine() wijst toe).
//   _rollGain / _rollSrc / _rollFilt — rolling-noise layer (tire/road).
//   _carWindGain / _carWindSrc / _carWindFilt — highpass-filtered car-wind loop,
//     fade-in boven ~65% topspeed (Fase 2.3 audio upgrade).
//   _carWindSampleGain / _carWindSampleSrc — sample-pad fallback wanneer
//     windHigh-buffer geladen is (lazy-init bij eerste detectie).
//   _lastGear — vorige gear voor up/down-shift trigger in updateEngine.
// Cross-script: gameplay/finish.js fade engineGain naar 0; gameplay/race.js
// reset _lastGear=1.
let engineOsc=null,engineGain=null;
let _rollGain=null,_rollSrc=null,_rollFilt=null;
let _carWindGain=null,_carWindSrc=null,_carWindFilt=null;
let _carWindSampleGain=null,_carWindSampleSrc=null;
let _lastGear=1;

// Delta-gate cache for AudioParam.setTargetAtTime calls. updateEngine runs
// 60Hz and used to schedule 7-9 AudioParam events per frame regardless of
// whether the input changed. AudioParam events stack on the audio thread
// and the scheduler heap grows; over a 3-min race this is hundreds of
// thousands of wasted events. We snapshot the last-set value per param and
// skip the set when the new target is within 0.5% of the previous.
const _engLast={
  baseFreq:-1, o2Freq:-1, o3Freq:-1, o4Freq:-1, filtFreq:-1, mainGain:-1,
  rollGain:-1, rollFilt:-1, rollQ:-1,
  carWindGain:-1, carWindSampleGain:-1, carWindFilt:-1
};
// Returns true if |a-b| > eps*max(|a|,|b|,minAbs). minAbs prevents zero
// from blocking updates when ramping out of silence.
function _engChanged(a,b,eps,minAbs){
  const denom=Math.max(Math.abs(a),Math.abs(b),minAbs||1);
  return Math.abs(a-b)/denom > (eps||0.005);
}

function initAudio(){
  if(audioCtx)return;
  audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  // Dbg-only proxy: track live AudioBufferSourceNode + OscillatorNode counts
  // so the perf overlay can show real audio-source pressure (incl. sample-
  // based StemRaceMusic which doesn't register in MusicLib._oscCount).
  if(window.dbg&&window.dbg.enabled){
    const _audioSrc={live:0,startedTotal:0,endedTotal:0};
    const _wrap=(orig)=>function(){
      const node=orig.apply(this,arguments);
      if(!node)return node;
      const _origStart=node.start;
      node.start=function(){
        try{
          _audioSrc.live++;_audioSrc.startedTotal++;
          node.addEventListener('ended',()=>{_audioSrc.live=Math.max(0,_audioSrc.live-1);_audioSrc.endedTotal++;},{once:true});
        }catch(_){}
        return _origStart.apply(this,arguments);
      };
      return node;
    };
    audioCtx.createBufferSource=_wrap(audioCtx.createBufferSource.bind(audioCtx));
    audioCtx.createOscillator=_wrap(audioCtx.createOscillator.bind(audioCtx));
    window._dbgAudioSrc=_audioSrc;
    window.dbg.audioSources=()=>({...window._dbgAudioSrc});
  }
  _master=audioCtx.createDynamicsCompressor();
  _master.threshold.value=-16;_master.knee.value=10;
  _master.ratio.value=4;_master.attack.value=0.003;_master.release.value=0.12;
  _muteGain=audioCtx.createGain();
  _master.connect(_muteGain);_muteGain.connect(audioCtx.destination);
  // SFX/engine bus — everything routed via _dst() flows through here so the
  // SFX slider in Settings can attenuate it without touching music or master.
  // Music still connects directly to _master via _musicMaster (see audio/music.js).
  window._sfxBus=audioCtx.createGain();
  window._sfxBus.gain.value=(typeof window._sfxVolume==='number')?window._sfxVolume:1;
  window._sfxBus.connect(_master);
  // _muteGain now carries the user master volume AND mute/out-of-focus state.
  // Initial value computed from any settings already loaded by settings.js.
  if(typeof window._applyMasterGain==='function') window._applyMasterGain(0);
  else _muteGain.gain.value=1;
  // iOS audio unlock — play silent WebAudio buffer + kick HTMLAudio primer
  try{
    const buf=audioCtx.createBuffer(1,1,22050);
    const src=audioCtx.createBufferSource();
    src.buffer=buf;src.connect(audioCtx.destination);src.start(0);
  }catch(_){}
  // HTMLAudio primer forces Safari into playback audio session (beats silent switch)
  try{
    const prim=document.getElementById('iosAudioUnlock');
    if(prim){prim.muted=false;prim.volume=0.001;const p=prim.play();if(p&&p.catch)p.catch(()=>{});}
  }catch(_){}
  if(audioCtx.state==='suspended'){audioCtx.resume().catch(()=>{});}
  // Pre-warm the shared noise buffer (used by EMP blackout, screech, boost,
  // jump, land, spin, nitro). First touch happens here at audio init —
  // off the hot path — instead of inside the first in-race _noise() call.
  if(typeof _ensureNoiseBuf==='function'){try{_ensureNoiseBuf();}catch(_){}}
}

function _ensureAudio(){
  if(!audioCtx)return;
  if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
  const prim=document.getElementById('iosAudioUnlock');
  if(prim&&prim.paused){try{const p=prim.play();if(p&&p.catch)p.catch(()=>{});}catch(_){}}
}

function _dst(){return window._sfxBus||_master||audioCtx.destination;}

// Master / SFX gain helpers — called by ui/settings.js whenever the user
// drags a slider, toggles mute, or the page visibility changes.
//
//   _masterVolume  : 0..1 user-set master attenuation (default 1)
//   _sfxVolume     : 0..1 user-set SFX bus attenuation (default 1)
//   _settingsMuteOOF + document.hidden : ducks _muteGain to 0 when window blurs
//   _audioMuted    : reserved for future hard-mute toggle (M key)
function _applyMasterGain(rampSec){
  // Bare `audioCtx` is a `var` declared in main.js; this helper can fire from
  // visibilitychange/blur/focus listeners wired at engine.js top-level — i.e.
  // before main.js executes — so go through window.* to avoid ReferenceError.
  const ctx=window.audioCtx;
  const mg=window._muteGain;
  if(!ctx||!mg)return;
  const vol=(typeof window._masterVolume==='number')?window._masterVolume:1;
  const oof=!!(window._settingsMuteOOF && (typeof document!=='undefined') && document.hidden);
  const hard=!!window._audioMuted;
  const target=(oof||hard)?0:vol;
  const ramp=(typeof rampSec==='number')?rampSec:0.08;
  const now=ctx.currentTime;
  const p=mg.gain;
  if(ramp<=0){p.cancelScheduledValues(now);p.setValueAtTime(target,now);return;}
  p.cancelScheduledValues(now);
  p.setValueAtTime(p.value,now);
  p.linearRampToValueAtTime(target,now+ramp);
}
function _applySfxGain(rampSec){
  const ctx=window.audioCtx;
  if(!ctx||!window._sfxBus)return;
  const vol=(typeof window._sfxVolume==='number')?window._sfxVolume:1;
  const ramp=(typeof rampSec==='number')?rampSec:0.08;
  const now=ctx.currentTime;
  const p=window._sfxBus.gain;
  p.cancelScheduledValues(now);
  p.setValueAtTime(p.value,now);
  p.linearRampToValueAtTime(vol,now+ramp);
}
window._applyMasterGain=_applyMasterGain;
window._applySfxGain=_applySfxGain;

// Mute-when-out-of-focus — wired once. Safe to install before audioCtx exists:
// the handler just no-ops until _muteGain is ready. visibilitychange fires
// on tab switch, minimise and (on most browsers) on window blur.
if(typeof document!=='undefined' && !window._oofMuteInstalled){
  window._oofMuteInstalled=true;
  document.addEventListener('visibilitychange',()=>_applyMasterGain(0.15));
  window.addEventListener('blur',()=>_applyMasterGain(0.15));
  window.addEventListener('focus',()=>_applyMasterGain(0.15));
}


function initEngine(){
  if(engineOsc)return;
  const ctx=audioCtx;
  const o1=ctx.createOscillator(),o2=ctx.createOscillator(),o3=ctx.createOscillator(),o4=ctx.createOscillator();
  o1.type='sawtooth';o2.type='square';o3.type='sine';o4.type='sine';
  o1.frequency.value=80;o2.frequency.value=160;o3.frequency.value=240;o4.frequency.value=40;
  const filt=ctx.createBiquadFilter();filt.type='lowpass';filt.frequency.value=600;filt.Q.value=3;
  const g1=ctx.createGain(),g2=ctx.createGain(),g3=ctx.createGain(),g4=ctx.createGain();
  g1.gain.value=.08;g2.gain.value=.035;g3.gain.value=.018;g4.gain.value=.015;
  const master=ctx.createGain();master.gain.value=0;
  o1.connect(g1);o2.connect(g2);o3.connect(g3);o4.connect(g4);
  g1.connect(filt);g2.connect(filt);g3.connect(filt);g4.connect(filt);
  filt.connect(master);master.connect(_dst());
  o1.start();o2.start();o3.start();o4.start();
  engineOsc=o1;engineOsc._o2=o2;engineOsc._o3=o3;engineOsc._o4=o4;engineOsc._filt=filt;
  engineGain=master;
  // Tire rolling — continuous filtered noise
  const rSz=ctx.sampleRate*2,rBuf=ctx.createBuffer(1,rSz,ctx.sampleRate);
  const rD=rBuf.getChannelData(0);for(let i=0;i<rSz;i++)rD[i]=Math.random()*2-1;
  const rSrc=ctx.createBufferSource();rSrc.buffer=rBuf;rSrc.loop=true;
  const rFilt=ctx.createBiquadFilter();rFilt.type='bandpass';rFilt.frequency.value=200;rFilt.Q.value=2;
  const rGain=ctx.createGain();rGain.gain.value=0;
  rSrc.connect(rFilt);rFilt.connect(rGain);rGain.connect(_dst());rSrc.start();
  _rollGain=rGain;_rollSrc=rSrc;_rollFilt=rFilt;
  // Sessie 04 V3 — car-wind re-enable. Gain cap is now 0.08 (was 0.18
  // which read as "sustained suis"). Threshold stays at 0.65 ratio so
  // wind only kicks in above ~65% of car topspeed. Update-block reads
  // the same _carWindGain ref so wiring it here is enough.
  const wsSrc = ctx.createBufferSource();
  const _wsBufSz = Math.ceil(ctx.sampleRate * 1.3);
  const _wsBuf = ctx.createBuffer(1, _wsBufSz, ctx.sampleRate);
  const _wsD = _wsBuf.getChannelData(0);
  for(let i=0;i<_wsBufSz;i++)_wsD[i]=Math.random()*2-1;
  wsSrc.buffer = _wsBuf; wsSrc.loop = true;
  const wsFilt = ctx.createBiquadFilter();
  wsFilt.type = 'highpass'; wsFilt.frequency.value = 800; wsFilt.Q.value = 0.4;
  const wsGain = ctx.createGain(); wsGain.gain.value = 0;
  wsSrc.connect(wsFilt); wsFilt.connect(wsGain); wsGain.connect(_dst());
  wsSrc.start();
  _carWindGain = wsGain; _carWindSrc = wsSrc; _carWindFilt = wsFilt;
}


function updateEngine(spd){
  if(!audioCtx)return;
  if(!engineOsc){
    if(window.dbg)dbg.measure('perf','initEngine',initEngine);else initEngine();
  }
  const abs=Math.abs(spd);
  const car=carObjs[playerIdx];
  const max=car?car.def.topSpd:1.8;
  const carType=car?car.def.type:'super';
  const ratio=Math.min(1,abs/max);
  const gear=Math.min(5,Math.floor(ratio*5)+1);
  _currentGear=gear;
  const t=audioCtx.currentTime;
  const isBoost=nitroActive||(car&&car.boostTimer>0);

  // ── SAMPLE ENGINE DISPATCH ─────────────────────────────────────────────
  // Als RPM-samples voor dit car-type geladen zijn én A/B toggle niet op
  // forced procedural staat, route naar SampleEngine. Procedurele osc
  // blijft draaien maar gain wordt naar 0 geramped (geen dubbele bron).
  const useSamples=!window._forceProceduralAudio
    && window._hasEngineSamples
    && window._hasEngineSamples(carType);
  if(useSamples){
    if(!window._sampleEngine||window._sampleEngine.carType!==carType){
      if(window._sampleEngine){try{window._sampleEngine.stop();}catch(_){}}
      window._sampleEngine=window._createSampleEngineForCarType(carType);
      if(window._sampleEngine&&window._sampleEngine.start)window._sampleEngine.start();
    }
    if(window._sampleEngine&&window._sampleEngine.update){
      window._sampleEngine.update(ratio,isBoost,gear);
      if(_engLast.mainGain!==0){engineGain.gain.setTargetAtTime(0,t,.1);_engLast.mainGain=0;}
    }
  }else{
    if(window._sampleEngine){try{window._sampleEngine.stop();}catch(_){}window._sampleEngine=null;}
    // Procedurele 4-osc pad
    const typeFreqM=carType==='f1'?1.55:carType==='muscle'?0.72:carType==='electric'?0.3:1.0;
    const typeGainM=carType==='electric'?0.10:carType==='muscle'?0.85:carType==='f1'?0.80:0.70;
    const inGear=ratio*5-(gear-1);
    const rpm=700+inGear*4200;
    const base=(rpm/60*1.2)*typeFreqM;
    // Delta-gated AudioParam scheduling — only set when the target moved
    // measurably since last frame. setTargetAtTime is a time-constant
    // exponential approach, so re-scheduling with the same target every
    // frame just refills the audio-thread event queue.
    const _bf=base*(isBoost?1.06:1);
    if(_engChanged(_bf,_engLast.baseFreq,0.005,1)){engineOsc.frequency.setTargetAtTime(_bf,t,.035);_engLast.baseFreq=_bf;}
    const _o2f=base*2*(isBoost?1.04:1);
    if(_engChanged(_o2f,_engLast.o2Freq,0.005,1)){engineOsc._o2.frequency.setTargetAtTime(_o2f,t,.035);_engLast.o2Freq=_o2f;}
    const _o3f=base*3;
    if(_engChanged(_o3f,_engLast.o3Freq,0.005,1)){engineOsc._o3.frequency.setTargetAtTime(_o3f,t,.035);_engLast.o3Freq=_o3f;}
    if(engineOsc._o4){
      const _o4f=35+ratio*45;
      if(_engChanged(_o4f,_engLast.o4Freq,0.005,1)){engineOsc._o4.frequency.setTargetAtTime(_o4f,t,.06);_engLast.o4Freq=_o4f;}
    }
    const filtFreq=carType==='f1'?(600+inGear*4500):carType==='muscle'?(180+inGear*1400):(isBoost?(500+inGear*3200):(280+inGear*2400));
    if(_engChanged(filtFreq,_engLast.filtFreq,0.01,1)){engineOsc._filt.frequency.setTargetAtTime(filtFreq,t,.05);_engLast.filtFreq=filtFreq;}
    const _mg=abs>.01?(isBoost?(.08+ratio*.05)*typeGainM:(.06+ratio*.035)*typeGainM):.016*typeGainM;
    if(_engChanged(_mg,_engLast.mainGain,0.01,0.005)){engineGain.gain.setTargetAtTime(_mg,t,.08);_engLast.mainGain=_mg;}
    if(carType==='electric'&&engineOsc._o3){
      const _ef=800+ratio*3200;
      if(_engChanged(_ef,_engLast.o3Freq,0.005,1)){engineOsc._o3.frequency.setTargetAtTime(_ef,t,.05);_engLast.o3Freq=_ef;}
    }
  }

  // ── TIRE ROLLING (surface-aware) — beide engine-paden ──────────────────
  if(_rollGain){
    // SAMPLES DISPATCH POINT: surface-sample buffer kan _rollGain vervangen
    // door een looping AudioBufferSourceNode op assets/audio/surface/<x>.ogg.
    // Clamp via ratio (0..1) — anders blaast nitro+boost de gain en filter
    // frequentie op (3x topSpd → tonale "suis" rond 900Hz op metal Q=4.5).
    const surface=(window._getCurrentSurface?window._getCurrentSurface():'asphalt');
    const sp=SURFACE_PARAMS[surface]||SURFACE_PARAMS.asphalt;
    const _rg=ratio*sp.gain;
    if(_engChanged(_rg,_engLast.rollGain,0.01,0.005)){_rollGain.gain.setTargetAtTime(_rg,t,.1);_engLast.rollGain=_rg;}
    if(_rollFilt){
      const _rf=sp.freqBase+ratio*sp.freqScale;
      if(_engChanged(_rf,_engLast.rollFilt,0.01,1)){_rollFilt.frequency.setTargetAtTime(_rf,t,.1);_engLast.rollFilt=_rf;}
      // Q only changes when surface changes (sp is a constant object per
      // surface) — gate hard so we only schedule on actual surface flips.
      if(sp.Q!==_engLast.rollQ){_rollFilt.Q.setTargetAtTime(sp.Q,t,.15);_engLast.rollQ=sp.Q;}
    }
  }

  // ── CAR-WIND (boven ~65% topspeed) — beide engine-paden ────────────────
  // Ratio-gain: 0 onder 0.65, lineair naar 0.18 op ratio 1.0. Sample-pad
  // (windHigh in SFX_MANIFEST) krijgt voorrang als beschikbaar; anders
  // fallback naar de procedurele highpass-noise loop uit initEngine.
  if(_carWindGain){
    // Sessie 04 V3 — peak cap reduced 0.18 → 0.08 so the procedural
    // highpass-noise reads as wind, not sustained suis.
    const windGain=ratio<0.65?0:(ratio-0.65)*(0.08/0.35);
    const useWindSample=!window._forceProceduralAudio
      && window._hasSFXSample
      && window._hasSFXSample('windHigh');
    if(useWindSample){
      // Lazy init sample-loop bij eerste keer dat sample beschikbaar is.
      if(!_carWindSampleGain){
        const buf=window._getSFXBuffer('windHigh');
        if(buf){
          const src=audioCtx.createBufferSource();
          src.buffer=buf;src.loop=true;
          const g=audioCtx.createGain();g.gain.value=0;
          src.connect(g);g.connect(_dst());
          src.start(audioCtx.currentTime);
          _carWindSampleGain=g;_carWindSampleSrc=src;
        }
      }
      // Mute procedural, ramp sample
      if(_engLast.carWindGain!==0){_carWindGain.gain.setTargetAtTime(0,t,.25);_engLast.carWindGain=0;}
      if(_carWindSampleGain && _engChanged(windGain,_engLast.carWindSampleGain,0.02,0.005)){
        _carWindSampleGain.gain.setTargetAtTime(windGain,t,.25);_engLast.carWindSampleGain=windGain;
      }
    }else{
      // Mute sample (indien actief), ramp procedural
      if(_carWindSampleGain && _engLast.carWindSampleGain!==0){_carWindSampleGain.gain.setTargetAtTime(0,t,.25);_engLast.carWindSampleGain=0;}
      if(_engChanged(windGain,_engLast.carWindGain,0.02,0.005)){_carWindGain.gain.setTargetAtTime(windGain,t,.25);_engLast.carWindGain=windGain;}
      if(_carWindFilt){
        const _wf=600+ratio*1800;
        if(_engChanged(_wf,_engLast.carWindFilt,0.01,1)){_carWindFilt.frequency.setTargetAtTime(_wf,t,.25);_engLast.carWindFilt=_wf;}
      }
    }
  }

  // ── GEAR SHIFT CHIRP (alleen procedural pad) ───────────────────────────
  if(!useSamples&&gear!==_lastGear&&abs>.3){
    const up=gear>_lastGear,o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type=carType==='muscle'?'sawtooth':'sawtooth';
    const chirpF=carType==='f1'?480:carType==='muscle'?120:290;
    o.frequency.setValueAtTime(up?chirpF:chirpF*.7,t);
    o.frequency.exponentialRampToValueAtTime(up?chirpF*.65:chirpF*.95,t+(carType==='f1'?.05:.09));
    const chirpV=carType==='muscle'?.11:carType==='f1'?.055:.065;
    g.gain.setValueAtTime(chirpV,t);g.gain.exponentialRampToValueAtTime(.001,t+(carType==='f1'?.07:.13));
    o.connect(g);g.connect(_dst());o.start(t);o.stop(t+(carType==='f1'?.08:.15));
  }
  if(gear!==_lastGear)_lastGear=gear;
}

// Stop alle race-only audio-gains die updateEngine elke frame bijhoudt.
// Roep aan bij FINISH en bij race-reset: na FINISH wordt updateEngine niet
// meer aangeroepen, dus _rollGain en _carWindSampleGain blijven anders op
// hun laatste race-waarde hangen terwijl _rollSrc / _carWindSampleSrc als
// loop=true buffer-sources doordraaien → lingering noise op finish-screen.
// engineGain wordt hier ook geramped zodat finish.js dit niet apart hoeft.
// Géén .stop() op de bronnen — initEngine() heeft een single-init guard.
function stopEngineAudio(){
  if(!audioCtx)return;
  const t=audioCtx.currentTime;
  const ramp=0.4;
  const _fade=(node)=>{
    if(!node)return;
    try{node.gain.cancelScheduledValues(t);
        node.gain.setTargetAtTime(0,t,ramp);}catch(_){}
  };
  _fade(engineGain);
  _fade(_rollGain);
  _fade(_carWindGain);
  _fade(_carWindSampleGain);
  // Reset delta-gate cache zodat de eerste updateEngine van de volgende
  // race opnieuw door _engChanged() komt en de gains netjes opbouwt.
  _engLast.mainGain=-1;
  _engLast.rollGain=-1;
  _engLast.carWindGain=-1;
  _engLast.carWindSampleGain=-1;
}

