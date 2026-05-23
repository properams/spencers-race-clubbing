// js/audio/sfx.js — Fase 2.3/2.4 extraction. Non-module script.
//
// Dispatch-laag: elke functie checkt eerst of er een sample voor dit
// effect geladen is (via window._hasSFXSample uit samples.js). Zo ja →
// sample. Zo nee → procedurele synth-fallback. Geen gameplay-koppeling
// die breekt als samples ontbreken.


// Generic one-shot sample player. hasFn/getFn parametriseren de categorie
// (SFX, Ambient, ...) zodat dezelfde implementatie hergebruikt wordt.
// slots = string of array; bij array random pick (variatie voor drift etc).
function _playBufferOneShot(hasFn, getFn, slots, vol=0.6, delay=0){
  if(!audioCtx||!hasFn||!getFn)return false;
  if(window._forceProceduralAudio)return false;
  const list=Array.isArray(slots)?slots:[slots];
  const available=list.filter(s=>hasFn(s));
  if(!available.length)return false;
  const slot=available[Math.floor(Math.random()*available.length)];
  const buf=getFn(slot);
  if(!buf)return false;
  const t=audioCtx.currentTime+delay;
  const src=audioCtx.createBufferSource();
  src.buffer=buf;
  const g=audioCtx.createGain();
  g.gain.value=vol;
  src.connect(g);g.connect(_dst());
  src.start(t);
  return true;
}

// SFX shorthand — gebruikt door playTireScreech / playLandSound / etc.
function _playSampleOneShot(slots, vol=0.6, delay=0){
  return _playBufferOneShot(window._hasSFXSample,window._getSFXBuffer,slots,vol,delay);
}

'use strict';

function beep(f,d,v=.25,delay=0,type='sine'){
  if(!audioCtx)return;
  const o=audioCtx.createOscillator(),g=audioCtx.createGain(),t=audioCtx.currentTime+delay;
  o.type=type;o.frequency.value=f;
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+.01);
  g.gain.exponentialRampToValueAtTime(.001,t+d);
  o.connect(g);g.connect(_dst());o.start(t);o.stop(t+d+.01);
  // Disconnect on ended zodat o + g refs direct loskomen van _sfxBus en
  // de GC ze meteen kan opruimen. Zonder dit bouwen burst-pickups (rapide
  // coins/jumps) audio-node refs op tot een GC-sweep het scherm freezt.
  o.onended=()=>{ try{o.disconnect();g.disconnect();}catch(_){} };
}

// Shared pre-filled white-noise buffer — sized to the longest dur any
// caller uses (.8s cap matches the old per-call Math.min). Reused by
// every _noise() invocation so we skip a per-call createBuffer + fill
// loop (8k–35k samples) that can hitch the main thread when multiple
// SFX fire in the same frame (lap-end, EMP blackout, etc).
let _noiseBuf=null;
function _ensureNoiseBuf(){
  if(!audioCtx)return null;
  if(_noiseBuf && _noiseBuf.sampleRate===audioCtx.sampleRate) return _noiseBuf;
  const sz=Math.ceil(audioCtx.sampleRate*.8);
  _noiseBuf=audioCtx.createBuffer(1,sz,audioCtx.sampleRate);
  const d=_noiseBuf.getChannelData(0);
  for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
  return _noiseBuf;
}

function _noise(dur,fq,Q,vol,delay=0){
  if(!audioCtx)return;
  const buf=_ensureNoiseBuf();if(!buf)return;
  const t=audioCtx.currentTime+delay;
  const playDur=Math.min(dur,.8);
  const src=audioCtx.createBufferSource(),f=audioCtx.createBiquadFilter(),g=audioCtx.createGain();
  f.type='bandpass';f.frequency.value=fq;f.Q.value=Q;
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
  src.buffer=buf;src.connect(f);f.connect(g);g.connect(_dst());src.start(t);src.stop(t+playDur+.01);
  // Disconnect on ended — zelfde reden als beep(): jump/brake/recovery
  // stapelen anders unbounded BufferSource + BiquadFilter + Gain refs.
  src.onended=()=>{ try{src.disconnect();f.disconnect();g.disconnect();}catch(_){} };
}


function playBoostSound(){
  if(_playSampleOneShot('boost', 0.38))return;
  // Ascending zap
  beep(220,.08,.20,0,'sawtooth');beep(440,.06,.15,.04,'sawtooth');beep(880,.04,.10,.08,'sawtooth');
  _noise(.2,2200,1.5,.04);
}

function playNitroActivate(){
  if(!audioCtx)return;
  if(_playSampleOneShot('nitro', 0.40))return;
  const t=audioCtx.currentTime;
  // Ascending filtered whoosh
  const o=audioCtx.createOscillator(),g=audioCtx.createGain(),f=audioCtx.createBiquadFilter();
  o.type='sawtooth';f.type='highpass';f.frequency.value=200;
  o.frequency.setValueAtTime(80,t);o.frequency.exponentialRampToValueAtTime(800,t+.35);
  g.gain.setValueAtTime(.20,t);g.gain.exponentialRampToValueAtTime(.001,t+.4);
  o.connect(f);f.connect(g);g.connect(_dst());o.start(t);o.stop(t+.44);
  // Sub bass drop
  beep(38,.4,.32,.05,'sine');
  _noise(.32,2400,1.5,.10);
}

function playTireScreech(){
  if(_playSampleOneShot(['drift1','drift2','drift3'], 0.40))return;
  _noise(.22,680,4.5,.14);_noise(.2,1500,2,.06);
}

function playJumpSound(){
  beep(210,.05,.2,0,'sine');beep(360,.07,.15,.04,'sine');_noise(.1,580,4,.08);
}

function playLandSound(){
  if(_playSampleOneShot('suspension', 0.50))return;
  beep(60,.28,.30,0,'sawtooth');_noise(.2,210,1.5,.22);
}

function playSpinSound(){_noise(.7,540,3.5,.2);beep(255,.5,.07,0,'sine');}

function playCollisionSound(){
  // Sample-pad: hard impact + glass scatter overlay als beide aanwezig.
  if(_playSampleOneShot('impactHard', 0.55)){
    _playSampleOneShot('glassScatter', 0.32, 0.05);
    return;
  }
  beep(58,.18,.42,0,'sine');           // low thud
  _noise(.32,1300,1.1,.18,.01);        // metal crunch
  _noise(.18,4200,3.5,.22,.06);        // glass scatter
}

// Brake squeal — sample-prefer met procedurele fallback. Triggert vanuit
// gameplay (physics.js) wanneer er hard wordt geremd op snelheid.
function playBrakeSound(){
  if(_playSampleOneShot('brake', 0.32))return;
  // Korte gefilterde noise-burst — high-Q bandpass = squeal-feel.
  _noise(.18, 2200, 6, .08);
  _noise(.12, 3400, 4, .05, .04);
}

function playVictoryFanfare(){
  if(!audioCtx)return;
  // 5-note ascending fanfare — triumphant major
  [[523,.55,.28],[659,.55,.26],[784,.55,.24],[1047,.7,.22],[1319,.9,.20]].forEach(([f,d,v],i)=>{
    setTimeout(()=>{beep(f,d,v,0,'sine');beep(f*2,d*.6,v*.35,0,'sine');},i*155);
  });
  // Final chord stab — clean sine waves only
  setTimeout(()=>{[523,659,784,1047].forEach(f=>beep(f,1.4,.13,0,'sine'));},860);
  // Warm pad: sine oscillators (replaces harsh sawtooth)
  if(audioCtx){
    const t=audioCtx.currentTime+.90;
    [261,329,392,523].forEach(f=>{
      const o=audioCtx.createOscillator(),g=audioCtx.createGain();
      o.type='sine';o.frequency.value=f;
      g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.08,t+.22);
      g.gain.exponentialRampToValueAtTime(.001,t+2.4);
      o.connect(g);g.connect(_dst());o.start(t);o.stop(t+2.5);
    });
  }
}

function playCountBeep(n){
  if(n>0){
    // Single clean tone per light — no delayed second hit
    beep(490,.20,.50,0,'sine');
    beep(980,.08,.15,0,'sine'); // same timing, softer harmonic (sine not square)
  }else{
    [523.3,659.3,784.0].forEach((f,i)=>beep(f,.48,.42,i*.055,'square'));
    [523.3,659.3,784.0].forEach((f,i)=>beep(f*2,.24,.18,.3+i*.055,'sine'));
  }
}

function playFanfare(){
  const n=[523.3,659.3,784.0,1046.5];
  n.forEach((f,i)=>{beep(f,.4,.44,i*.22,'square');beep(f,.32,.2,i*.22+.16,'sine');});
  n.forEach(f=>beep(f,.75,.32,.96,'triangle'));
}

function playRecoverySound(){
  [195,160,128].forEach((f,i)=>beep(f,.24,.24,i*.11,'sine'));_noise(.3,275,2,.18);
}

function playCollectSound(){
  if(_playSampleOneShot('coin', 0.34))return;
  // Pentatonic chime
  [523,659,784,1047].forEach((f,i)=>beep(f,.22,.24,i*.07,'sine'));
}

// Short engine rev burst — used in the selection screen when the player
// switches cars + on countdown beats (B3, light-5 + GO) for a per-car-
// type 'ready to launch' rev. Per-type tone: F1 high & sharp, super
// medium-high, muscle low growl, electric soft whoosh. ~0.5s total.
function playEngineRev(carType){
  if(!audioCtx)return;
  const t = audioCtx.currentTime;
  const cfg = {
    f1:       {fStart:120, fPeak:520, cutoff:1800, gain:.20, len:.42, wave:'sawtooth', noiseQ:2.5, noiseG:.06},
    super:    {fStart:90,  fPeak:380, cutoff:1300, gain:.22, len:.50, wave:'sawtooth', noiseQ:2.0, noiseG:.05},
    muscle:   {fStart:55,  fPeak:200, cutoff:700,  gain:.28, len:.62, wave:'sawtooth', noiseQ:1.6, noiseG:.07},
    electric: {fStart:300, fPeak:1100,cutoff:2400, gain:.14, len:.40, wave:'sine',     noiseQ:0.8, noiseG:.02}
  }[carType] || {fStart:90, fPeak:380, cutoff:1300, gain:.22, len:.50, wave:'sawtooth', noiseQ:2.0, noiseG:.05};
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  const lp = audioCtx.createBiquadFilter();
  o.type = cfg.wave;
  lp.type = 'lowpass';
  lp.frequency.value = cfg.cutoff;
  // Throttle blip: rapid rise to peak, then slow decel back near idle.
  o.frequency.setValueAtTime(cfg.fStart, t);
  o.frequency.exponentialRampToValueAtTime(cfg.fPeak, t + cfg.len * 0.30);
  o.frequency.exponentialRampToValueAtTime(cfg.fStart * 1.25, t + cfg.len);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(cfg.gain, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.001, t + cfg.len);
  o.connect(lp); lp.connect(g); g.connect(_dst());
  o.start(t); o.stop(t + cfg.len + 0.05);
  // Combustion grit noise layer (skipped for electric).
  if(carType !== 'electric'){
    _noise(cfg.len * 0.7, cfg.fPeak * 1.6, cfg.noiseQ, cfg.noiseG);
  }
}

// ── Per-world lap-event procedural one-shots ────────────────────────────────
// One signature stinger per wereld, dispatched via Audio.playWorldLapEvent()
// once per lap-cross in tracklimits.js. Volume budget: peaks rond 0.18-0.26
// zodat de stinger onder engine + crowd zit, niet er op. Sample-pad: elke
// stinger checkt eerst _playSampleOneShot() zodat een toekomstige sample-
// asset (slot lap<Event>) automatisch voorgaat — zelfde cascade als
// playTireScreech / playCollisionSound.

function playLapEventRumble(){
  if(!audioCtx)return;
  if(_playSampleOneShot('lapRumble', 0.40))return;
  const t=audioCtx.currentTime;
  const o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.type='sine';o.frequency.setValueAtTime(48,t);
  o.frequency.exponentialRampToValueAtTime(28,t+.6);
  g.gain.setValueAtTime(.32,t);g.gain.exponentialRampToValueAtTime(.001,t+.7);
  o.connect(g);g.connect(_dst());o.start(t);o.stop(t+.72);
  _noise(.55,140,1.2,.18);
}

function playLapEventEcho(){
  if(!audioCtx)return;
  if(_playSampleOneShot('lapEcho', 0.40))return;
  // Underwater bell — drie sine-pulsen, opnieuw afnemend, lowpass-gefilterd.
  const t=audioCtx.currentTime;
  [0,.18,.42].forEach((dly,i)=>{
    const o=audioCtx.createOscillator(),g=audioCtx.createGain(),f=audioCtx.createBiquadFilter();
    f.type='lowpass';f.frequency.value=900-i*180;
    o.type='sine';o.frequency.setValueAtTime(440-i*40,t+dly);
    o.frequency.exponentialRampToValueAtTime(220-i*30,t+dly+.4);
    g.gain.setValueAtTime(0,t+dly);
    g.gain.linearRampToValueAtTime(.18-i*.05,t+dly+.04);
    g.gain.exponentialRampToValueAtTime(.001,t+dly+.6);
    o.connect(f);f.connect(g);g.connect(_dst());o.start(t+dly);o.stop(t+dly+.65);
  });
}

function playLapEventWhoosh(){
  if(!audioCtx)return;
  if(_playSampleOneShot('lapWhoosh', 0.40))return;
  // Bandpass-noise-sweep van laag naar hoog — ruimte-zucht.
  const t=audioCtx.currentTime;
  const sz=Math.ceil(audioCtx.sampleRate*.7);
  const buf=audioCtx.createBuffer(1,sz,audioCtx.sampleRate);
  const d=buf.getChannelData(0);for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
  const src=audioCtx.createBufferSource();src.buffer=buf;
  const f=audioCtx.createBiquadFilter();f.type='bandpass';f.Q.value=.8;
  f.frequency.setValueAtTime(220,t);f.frequency.exponentialRampToValueAtTime(1800,t+.6);
  const g=audioCtx.createGain();
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.22,t+.12);
  g.gain.exponentialRampToValueAtTime(.001,t+.7);
  src.connect(f);f.connect(g);g.connect(_dst());src.start(t);src.stop(t+.72);
}

function playLapEventCreak(){
  if(!audioCtx)return;
  if(_playSampleOneShot('lapCreak', 0.40))return;
  // Twee licht-detune'd hoge triangles + korte noise-tik — ijs-kraak.
  const t=audioCtx.currentTime;
  [{f:1100,d:0},{f:1180,d:.02}].forEach(p=>{
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type='triangle';o.frequency.setValueAtTime(p.f,t+p.d);
    o.frequency.linearRampToValueAtTime(p.f*.6,t+p.d+.45);
    g.gain.setValueAtTime(0,t+p.d);g.gain.linearRampToValueAtTime(.14,t+p.d+.06);
    g.gain.exponentialRampToValueAtTime(.001,t+p.d+.55);
    o.connect(g);g.connect(_dst());o.start(t+p.d);o.stop(t+p.d+.6);
  });
  _noise(.18,3200,3,.06,.05);
}

function playLapEventPop(){
  if(!audioCtx)return;
  if(_playSampleOneShot('lapPop', 0.40))return;
  // Korte transient + helderbel — suiker-knal.
  beep(880,.05,.3,0,'square');
  beep(1760,.18,.22,.04,'sine');
  beep(2640,.22,.16,.08,'sine');
  _noise(.06,5500,3,.08);
}

function playLapEventGust(){
  if(!audioCtx)return;
  if(_playSampleOneShot('lapGust', 0.40))return;
  // Pinkish-noise envelope met stijgende bandpass — wind-vlaag.
  const t=audioCtx.currentTime;
  const sz=Math.ceil(audioCtx.sampleRate*.85);
  const buf=audioCtx.createBuffer(1,sz,audioCtx.sampleRate);
  const d=buf.getChannelData(0);
  // Crude pinking: laagdoorlaat-IIR over witte ruis (low-pass smoothing).
  let last=0;for(let i=0;i<sz;i++){last=last*.7+(Math.random()*2-1)*.3;d[i]=last;}
  const src=audioCtx.createBufferSource();src.buffer=buf;
  const f=audioCtx.createBiquadFilter();f.type='bandpass';f.Q.value=.7;
  f.frequency.setValueAtTime(380,t);f.frequency.linearRampToValueAtTime(1100,t+.55);
  const g=audioCtx.createGain();
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.26,t+.18);
  g.gain.linearRampToValueAtTime(.18,t+.45);
  g.gain.exponentialRampToValueAtTime(.001,t+.85);
  src.connect(f);f.connect(g);g.connect(_dst());src.start(t);src.stop(t+.88);
}

function playLapEventSynthSweep(){
  if(!audioCtx)return;
  if(_playSampleOneShot('lapSynthSweep', 0.40))return;
  // Detuned saw met dalende lowpass-sweep — cyberpunk zoom.
  const t=audioCtx.currentTime;
  [0,.008].forEach(det=>{
    const o=audioCtx.createOscillator(),g=audioCtx.createGain(),f=audioCtx.createBiquadFilter();
    o.type='sawtooth';
    o.frequency.setValueAtTime(220*(1+det),t);
    o.frequency.exponentialRampToValueAtTime(660*(1+det),t+.35);
    f.type='lowpass';
    f.frequency.setValueAtTime(2200,t);f.frequency.exponentialRampToValueAtTime(420,t+.55);
    f.Q.value=4;
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.16,t+.04);
    g.gain.exponentialRampToValueAtTime(.001,t+.6);
    o.connect(f);f.connect(g);g.connect(_dst());o.start(t);o.stop(t+.62);
  });
}
