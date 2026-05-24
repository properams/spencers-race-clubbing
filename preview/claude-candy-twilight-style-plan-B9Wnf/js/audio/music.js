// js/audio/music.js — muziek-subsysteem
// Verhuisd uit main.js tijdens Fase 2.2a. State leeft op window.*:
// audioCtx, _master (compressor), _muteGain, _musicMaster, _musicVolume,
// _musicMuted, _musicDuck — allemaal gedeclareerd in main.js.
//
// Deze module muteert die state via window.xxx en plaatst alle publieke
// entrypoints (startTitleMusic, startSelectMusic, TitleMusic class, etc.)
// op window zodat main.js ze kan aanroepen.

function noteFreq(note,octave){
  const n={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
  const midi=n[note]+(octave+1)*12;
  return 440*Math.pow(2,(midi-69)/12);
}
const NF=noteFreq; // shorthand — nodig voor alle NF('A',3) calls in de class bodies

function _ensureMusicMaster(){
  if(!window.audioCtx||window._musicMaster)return;
  window._musicMaster=window.audioCtx.createGain();
  window._musicMaster.gain.value=window._musicMuted?0:window._musicVolume*window._musicDuck;
  window._musicMaster.connect(window._master||window.audioCtx.destination);
}
function _applyMusicGain(rampSec=0.2){
  if(!window._musicMaster||!window.audioCtx)return;
  const target=window._musicMuted?0:window._musicVolume*window._musicDuck;
  const now=window.audioCtx.currentTime;
  try{
    window._musicMaster.gain.cancelScheduledValues(now);
    window._musicMaster.gain.setValueAtTime(window._musicMaster.gain.value,now);
    window._musicMaster.gain.linearRampToValueAtTime(target,now+rampSec);
  }catch(_){}
}
function _fadeOutMusic(scheduler,dur=0.8){
  if(!scheduler)return;
  if(!window.audioCtx||!scheduler._out){try{scheduler.stop();}catch(_){}return;}
  const now=window.audioCtx.currentTime;
  try{
    scheduler._out.gain.cancelScheduledValues(now);
    scheduler._out.gain.setValueAtTime(scheduler._out.gain.value,now);
    scheduler._out.gain.linearRampToValueAtTime(0,now+dur);
    setTimeout(()=>{try{scheduler.stop();}catch(_){}},dur*1000+100);
  }catch(_){try{scheduler.stop();}catch(_){}}
}
function _safeStartMusic(factoryFn){
  if(!window.audioCtx)return null;
  try{
    const m=factoryFn();
    if(m&&m.start)m.start();
    return m;
  }catch(e){
    if(window.dbg)dbg.warn('music','start failed: '+e.message);
    else console.warn('[music] start failed:',e.message);
    return null;
  }
}


// ══ MUSIC LIBRARY — gedeelde synth bouwstenen ══════════════════════════════
const MusicLib={
  _oscCount:0,
  lite:()=>(typeof window!=='undefined'&&window._isMobile===true),
  safeOsc(ctx){
    const max=MusicLib.lite()?80:200;
    if(MusicLib._oscCount>=max)return null;
    const o=ctx.createOscillator();
    MusicLib._oscCount++;
    o.addEventListener('ended',()=>{MusicLib._oscCount=Math.max(0,MusicLib._oscCount-1);});
    return o;
  },
  n(semiFromC4){return 261.63*Math.pow(2,semiFromC4/12);},
  chord(rootSemi,quality='major'){
    const iv=quality==='major'?[0,4,7]:quality==='minor'?[0,3,7]:[0,4,7,11];
    return iv.map(i=>MusicLib.n(rootSemi+i));
  },
  voicing(rootSemi,type='open'){
    const base=MusicLib.chord(rootSemi,type.includes('min')?'minor':'major');
    if(type==='open')return [base[0]*0.5,base[2],base[1]*2];
    if(type==='power')return [base[0],base[2]];
    if(type==='rich')return [base[0]*0.5,base[0],base[1],base[2],base[0]*2];
    return base;
  },
  kick(ctx,t,gain=0.6){
    const o=MusicLib.safeOsc(ctx);if(!o){const g=ctx.createGain();g.gain.value=0;return g;}
    const g=ctx.createGain();
    o.frequency.setValueAtTime(150,t);
    o.frequency.exponentialRampToValueAtTime(40,t+0.12);
    g.gain.setValueAtTime(gain,t);
    g.gain.exponentialRampToValueAtTime(0.001,t+0.18);
    o.connect(g);o.start(t);o.stop(t+0.2);
    return g;
  },
  snare(ctx,t,gain=0.3){
    const sz=Math.ceil(ctx.sampleRate*0.1);
    const buf=ctx.createBuffer(1,sz,ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<sz;i++)d[i]=(Math.random()*2-1)*(1-i/sz);
    const src=ctx.createBufferSource();src.buffer=buf;
    const g=ctx.createGain();
    const f=ctx.createBiquadFilter();f.type='bandpass';f.frequency.value=1800;
    g.gain.value=gain;
    src.connect(f);f.connect(g);src.start(t);
    return g;
  },
  hat(ctx,t,gain=0.15,open=false){
    const dur=open?0.15:0.04;
    const sz=Math.ceil(ctx.sampleRate*dur);
    const buf=ctx.createBuffer(1,sz,ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
    const src=ctx.createBufferSource();src.buffer=buf;
    const g=ctx.createGain();
    const f=ctx.createBiquadFilter();f.type='highpass';f.frequency.value=7000;
    g.gain.setValueAtTime(gain,t);
    g.gain.exponentialRampToValueAtTime(0.001,t+dur);
    src.connect(f);f.connect(g);src.start(t);
    return g;
  },
  pluck(ctx,t,freq,dur=0.2,gain=0.2){
    const o=MusicLib.safeOsc(ctx);if(!o){const g=ctx.createGain();g.gain.value=0;return g;}
    const g=ctx.createGain();
    const f=ctx.createBiquadFilter();f.type='lowpass';
    f.frequency.setValueAtTime(freq*6,t);
    f.frequency.exponentialRampToValueAtTime(freq*2,t+dur);
    o.type='sawtooth';o.frequency.value=freq;
    g.gain.setValueAtTime(gain,t);
    g.gain.exponentialRampToValueAtTime(0.001,t+dur);
    o.connect(f);f.connect(g);o.start(t);o.stop(t+dur+0.05);
    return g;
  },
  pad(ctx,t,freq,dur,gain=0.08){
    const g=ctx.createGain();
    const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=1200;f.Q.value=0.8;
    g.gain.setValueAtTime(0,t);
    g.gain.linearRampToValueAtTime(gain,t+0.3);
    g.gain.linearRampToValueAtTime(gain,t+dur-0.4);
    g.gain.linearRampToValueAtTime(0,t+dur);
    // Mobile lite: 1 osc i.p.v. 3 detuned (3x minder oscillators voor pads)
    const detunes=MusicLib.lite()?[1]:[1,1.005,0.995];
    detunes.forEach(det=>{
      const o=MusicLib.safeOsc(ctx);if(!o)return;
      o.type='sawtooth';o.frequency.value=freq*det;
      o.connect(f);o.start(t);o.stop(t+dur+0.1);
    });
    f.connect(g);
    return g;
  },
  bass(ctx,t,freq,dur=0.2,gain=0.4){
    const o=MusicLib.safeOsc(ctx);if(!o){const g=ctx.createGain();g.gain.value=0;return g;}
    const g=ctx.createGain();
    const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=freq*4;
    o.type='square';o.frequency.value=freq;
    g.gain.setValueAtTime(gain,t);
    g.gain.setValueAtTime(gain,t+dur*0.8);
    g.gain.exponentialRampToValueAtTime(0.001,t+dur);
    o.connect(f);f.connect(g);o.start(t);o.stop(t+dur+0.05);
    return g;
  },
  tom(ctx,t,freq=120,gain=0.5){
    const o=MusicLib.safeOsc(ctx);if(!o){const g=ctx.createGain();g.gain.value=0;return g;}
    const g=ctx.createGain();
    o.type='sine';
    o.frequency.setValueAtTime(freq,t);
    o.frequency.exponentialRampToValueAtTime(freq*0.4,t+0.24);
    g.gain.setValueAtTime(gain,t);
    g.gain.exponentialRampToValueAtTime(0.001,t+0.32);
    o.connect(g);o.start(t);o.stop(t+0.35);
    return g;
  }
};

class TitleMusic{
  constructor(ctx){
    this.ctx=ctx;this.running=false;this.beat=0;
    _ensureMusicMaster();
    this._out=ctx.createGain();
    this._out.gain.value=0.9;
    // Nitro filter always present (inactive = 20 Hz highpass = ~off).
    // Title scheduler never toggles nitro, maar keten moet consistent zijn.
    this._filt=ctx.createBiquadFilter();
    this._filt.type='highpass';this._filt.frequency.value=20;
    this._out.connect(this._filt);
    this._filt.connect(window._musicMaster||window._master||window.audioCtx.destination);
    this.bpm=116;this.bd=60/this.bpm;this.nextBeat=0;
    this.sectionLength=64;  // 32 bars bij 8th-note telling — A/B wissel
    // Am→F→C→G→Am→Em→F→G→Dm→Am→Bb→F→Am→G/B→C→E  (16 chords, 8 beats each)
    this.chords=[
      [NF('A',3),NF('C',4),NF('E',4)],         // Am
      [NF('F',3),NF('A',3),NF('C',4)],          // F
      [NF('C',3),NF('E',3),NF('G',3)],          // C
      [NF('G',3),NF('B',3),NF('D',4)],          // G
      [NF('A',3),NF('C',4),NF('E',4)],          // Am
      [NF('E',3),NF('G',3),NF('B',3)],          // Em
      [NF('F',3),NF('A',3),NF('C',4)],          // F
      [NF('G',3),NF('B',3),NF('D',4)],          // G
      [NF('D',3),NF('F',3),NF('A',3)],          // Dm
      [NF('A',3),NF('C',4),NF('E',4)],          // Am
      [NF('Bb',3),NF('D',4),NF('F',4)],         // Bb
      [NF('F',3),NF('A',3),NF('C',4)],          // F
      [NF('A',3),NF('C',4),NF('E',4)],          // Am
      [NF('B',2),NF('D',3),NF('G',3)],          // G/B
      [NF('C',3),NF('E',3),NF('G',3)],          // C
      [NF('E',3),NF('G#',3),NF('B',3)],         // E (dominant)
    ];
    // Bass: root of each chord in octave 2
    this.bass=[NF('A',2),NF('F',2),NF('C',2),NF('G',2),NF('A',2),NF('E',2),NF('F',2),NF('G',2),
               NF('D',2),NF('A',2),NF('Bb',2),NF('F',2),NF('A',2),NF('B',2),NF('C',3),NF('E',2)];
    // Pentatonic melody in Am — 16 half-note melody notes matching the 16 chords
    this.mel=[NF('A',4),NF('C',5),NF('E',5),NF('D',5),NF('C',5),NF('B',4),NF('A',4),NF('G',4),
              NF('F',4),NF('A',4),NF('G',4),NF('F',4),NF('E',4),NF('G',4),NF('A',4),NF('A',4)];
  }
  start(){this.running=true;this._gen=(this._gen||0)+1;this.nextBeat=this.ctx.currentTime+.06;this._s(this._gen);}
  stop(){this.running=false;}

  _kick(t,v=.52){
    const ctx=this.ctx;
    // Sub body: pitch sweep 165→32Hz
    const o=ctx.createOscillator(),g=ctx.createGain();
    o.type='sine';o.frequency.setValueAtTime(165,t);o.frequency.exponentialRampToValueAtTime(32,t+.13);
    g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+.22);
    o.connect(g);g.connect(this._out);o.start(t);o.stop(t+.24);
    // Punch transient: short bandpass noise burst
    const sz=Math.ceil(ctx.sampleRate*.007),buf=ctx.createBuffer(1,sz,ctx.sampleRate);
    const d=buf.getChannelData(0);for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
    const src=ctx.createBufferSource(),bp=ctx.createBiquadFilter(),ng=ctx.createGain();
    bp.type='bandpass';bp.frequency.value=4200;bp.Q.value=1.8;
    ng.gain.setValueAtTime(v*.35,t);ng.gain.exponentialRampToValueAtTime(.001,t+.009);
    src.buffer=buf;src.connect(bp);bp.connect(ng);ng.connect(this._out);src.start(t);src.stop(t+.012);
  }

  _snare(t,v=.22){
    const ctx=this.ctx;
    // Noise body — bandpass around 1700Hz, 0.13s tail
    const sz=Math.ceil(ctx.sampleRate*.13),buf=ctx.createBuffer(1,sz,ctx.sampleRate);
    const d=buf.getChannelData(0);for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
    const src=ctx.createBufferSource(),bf=ctx.createBiquadFilter(),g=ctx.createGain();
    bf.type='bandpass';bf.frequency.value=1700;bf.Q.value=.75;
    g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+.13);
    src.buffer=buf;src.connect(bf);bf.connect(g);g.connect(this._out);src.start(t);src.stop(t+.15);
    // Tonal body for presence
    const o=ctx.createOscillator(),og=ctx.createGain();
    o.type='triangle';o.frequency.setValueAtTime(210,t);o.frequency.exponentialRampToValueAtTime(130,t+.07);
    og.gain.setValueAtTime(v*.45,t);og.gain.exponentialRampToValueAtTime(.001,t+.10);
    o.connect(og);og.connect(this._out);o.start(t);o.stop(t+.12);
  }

  _hat(t,v=.018){
    const vel=v*(0.65+Math.random()*.7); // humanized
    const sz=Math.ceil(this.ctx.sampleRate*.042),buf=this.ctx.createBuffer(1,sz,this.ctx.sampleRate);
    const d=buf.getChannelData(0);for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
    const src=this.ctx.createBufferSource(),hf=this.ctx.createBiquadFilter(),g=this.ctx.createGain();
    hf.type='highpass';hf.frequency.value=7800;
    g.gain.setValueAtTime(vel,t);g.gain.exponentialRampToValueAtTime(.001,t+.04);
    src.buffer=buf;src.connect(hf);hf.connect(g);g.connect(this._out);src.start(t);src.stop(t+.05);
  }

  // Supersaw pad: 3 detuned sawtooths + lowpass for warmth
  _superSaw(t,freq,vol,dur,filterF=1400){
    const dets=MusicLib.lite()?[0]:[-8,0,8];
    dets.forEach(det=>{
      const o=this.ctx.createOscillator(),g=this.ctx.createGain(),f=this.ctx.createBiquadFilter();
      o.type='sawtooth';o.frequency.value=freq;o.detune.value=det;
      f.type='lowpass';f.frequency.value=filterF;f.Q.value=1.1;
      g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol/dets.length,t+.10);
      g.gain.setValueAtTime(vol/dets.length,t+dur*.72);g.gain.exponentialRampToValueAtTime(.001,t+dur);
      o.connect(f);f.connect(g);g.connect(this._out);o.start(t);o.stop(t+dur+.05);
    });
  }

  // Soft triangle pad for gentle chord swell
  _pad(t,freqs,dur,vol){
    freqs.forEach((freq,i)=>{
      const o=this.ctx.createOscillator(),g=this.ctx.createGain(),f=this.ctx.createBiquadFilter();
      o.type='triangle';o.frequency.value=freq;o.detune.value=(i%2===0?3:-3);
      f.type='lowpass';f.frequency.value=600+i*80;
      g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol/(freqs.length+1),t+dur*.22);
      g.gain.setValueAtTime(vol/(freqs.length+1),t+dur*.68);g.gain.linearRampToValueAtTime(0,t+dur);
      o.connect(f);f.connect(g);g.connect(this._out);o.start(t);o.stop(t+dur+.08);
    });
  }

  // Lead: filtered sawtooth with filter envelope (warmer than square)
  _lead(t,freq,dur,vol=.038){
    const dets=MusicLib.lite()?[0]:[-5,5];
    dets.forEach(det=>{
      const o=this.ctx.createOscillator(),g=this.ctx.createGain(),f=this.ctx.createBiquadFilter();
      o.type='sawtooth';o.frequency.value=freq;o.detune.value=det;
      f.type='lowpass';f.Q.value=2.2;
      f.frequency.setValueAtTime(750,t);f.frequency.linearRampToValueAtTime(2400,t+.022);
      f.frequency.exponentialRampToValueAtTime(580,t+dur);
      g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol/dets.length,t+.012);
      g.gain.setValueAtTime(vol/dets.length,t+dur*.78);g.gain.exponentialRampToValueAtTime(.001,t+dur);
      o.connect(f);f.connect(g);g.connect(this._out);o.start(t);o.stop(t+dur+.04);
    });
  }

  _s(gen){
    if(!this.running||gen!==this._gen)return;
    const ctx=this.ctx;
    while(this.nextBeat<ctx.currentTime+.28){
      const t=this.nextBeat,bd=this.bd,bi=this.beat%32;
      const chordIdx=Math.floor(this.beat/8)%16;
      const melIdx=Math.floor(this.beat/4)%16;
      // A/B section — every 64 8th-beats we toggle (B = answer phrase + denser hats)
      const section=Math.floor(this.beat/this.sectionLength)%2;
      const isB=section===1;

      // Drums — kick on 1&3, snare on 2&4
      if(bi===0||bi===16)this._kick(t,.54);
      if(bi===8||bi===24)this._kick(t,.30);
      if(bi===8||bi===24)this._snare(t,.22);
      this._hat(t,.018);
      if(bi%2===0)this._hat(t+bd*.5,.012);
      if(bi%4===2)this._hat(t+bd*.25,.007);
      // B-section: extra 16th hats for density
      if(isB&&bi%2===1)this._hat(t+bd*.5,.010);

      // Bass — filtered sawtooth, note matches chord root
      if(bi%4===0){
        const bassNote=this.bass[chordIdx];
        const o=ctx.createOscillator(),g=ctx.createGain(),f=ctx.createBiquadFilter();
        o.type='sawtooth';f.type='lowpass';f.Q.value=2.4;
        o.frequency.value=bassNote;
        f.frequency.setValueAtTime(170,t);f.frequency.exponentialRampToValueAtTime(560,t+bd*.32);
        f.frequency.exponentialRampToValueAtTime(170,t+bd*1.85);
        g.gain.setValueAtTime(.20,t);g.gain.exponentialRampToValueAtTime(.001,t+bd*3.9);
        o.connect(f);f.connect(g);g.connect(this._out);o.start(t);o.stop(t+bd*4.1);
      }

      // Supersaw chord pads (every 8 beats — one full bar per chord)
      if(bi%8===0){
        const chord=this.chords[chordIdx];
        chord.forEach((freq,i)=>{
          const delay=i*.060;
          this._superSaw(t+delay,freq,.036,bd*7.6,1200+i*150);
        });
        this._pad(t,chord,bd*7.8,.055);
      }

      // Lead melody every 4 beats. A/B variatie loopt via drums/hats, niet via
      // melodie-transpose: een vaste +3 transpose botst met de stilstaande
      // Am-progressie (Eb tegen E-natural in de chords).
      if(bi%4===0){
        const mf=this.mel[melIdx];
        this._lead(t,mf,bd*3.8,.036);
        this._lead(t+.200,mf,bd*3.4,.013);
      }

      this.nextBeat+=bd;this.beat++;
    }
    setTimeout(()=>this._s(gen),14);
  }
}


class SelectMusic{
  constructor(ctx){
    this.ctx=ctx;this.running=false;this.beat=0;
    _ensureMusicMaster();
    this._out=ctx.createGain();
    this._out.gain.value=0.85;
    this._filt=ctx.createBiquadFilter();
    this._filt.type='highpass';this._filt.frequency.value=20;
    this._out.connect(this._filt);
    this._filt.connect(window._musicMaster||window._master||window.audioCtx.destination);
    this.bpm=105;this.bd=60/this.bpm;this.nextBeat=0;
    this.sectionLength=64;
    // Dm → F → Am → C  (minor-warm progression)
    this.progA=[
      MusicLib.chord(-10,'minor'),   // Dm
      MusicLib.chord(-7,'major'),    // F
      MusicLib.chord(-3,'minor'),    // Am
      MusicLib.chord(-12,'major')    // C
    ];
    this.progB=[
      MusicLib.chord(-10,'minor'),   // Dm
      MusicLib.chord(-5,'major'),    // G
      MusicLib.chord(-7,'major'),    // F
      MusicLib.chord(-12,'major')    // C
    ];
  }
  start(){this.running=true;this._gen=(this._gen||0)+1;this.nextBeat=this.ctx.currentTime+.08;this.beat=0;this._s(this._gen);}
  stop(){this.running=false;this._gen=(this._gen||0)+1;}
  _s(gen){
    if(!this.running||gen!==this._gen)return;
    while(this.nextBeat<this.ctx.currentTime+.3){
      this._beat(this.nextBeat,this.beat);
      this.nextBeat+=this.bd/2;
      this.beat++;
    }
    setTimeout(()=>this._s(gen),15);
  }
  _beat(t,n){
    const section=Math.floor(n/this.sectionLength)%2;
    const prog=section===0?this.progA:this.progB;
    const chord=prog[Math.floor(n/8)%prog.length];
    // Velocity variation: accent op 1, soft op off-beats
    const vel=n%4===0?1.0:0.82;

    // Hat op elke 8th, open hat op 4
    MusicLib.hat(this.ctx,t,0.08*vel,n%4===0).connect(this._out);
    // Kick op 1 en 3
    if(n%4===0)MusicLib.kick(this.ctx,t,0.22).connect(this._out);
    // Bass pulse op 1 en 2.5
    if(n%8===0||n%8===3){
      MusicLib.bass(this.ctx,t,chord[0]*0.5,this.bd*0.7,0.20).connect(this._out);
    }
    // Pad elke chord change (elke 8 8th-notes)
    if(n%8===0){
      chord.forEach(f=>MusicLib.pad(this.ctx,t,f,this.bd*4,0.035).connect(this._out));
    }
    // Anticipation pluck: subtiel elke 4 bars op octaaf-boven
    if(n%32===16){
      MusicLib.pluck(this.ctx,t,chord[2]*2,this.bd*1.3,0.09).connect(this._out);
    }
    // B-section: extra shaker feel op odd 8ths
    if(section===1&&n%2===1){
      MusicLib.hat(this.ctx,t+this.bd*0.25,0.04).connect(this._out);
    }
  }
}


class RaceMusic{
  constructor(ctx){
    this.ctx=ctx;this.running=false;this.beat=0;this.bar=0;
    this.style=window.activeWorld||'space';
    const BPM={space:132,deepsea:118,candy:140,volcano:165,arctic:105,sandstorm:128};
    this.bpm=BPM[this.style]||132;
    this.bd=60/this.bpm;this.nextBeat=0;
    this.finalLap=false;
    this.intensity=0;  // 0 normaal, 1 = final-lap urgency
    // Per-world _out.gain calibratie — gelijke perceived loudness tussen werelden
    const VOL={space:0.9,deepsea:1.0,candy:0.65,volcano:0.75,arctic:0.85,sandstorm:0.85};
    _ensureMusicMaster();
    this._out=ctx.createGain();
    this._out.gain.value=VOL[this.style]||0.8;
    // DeepSea krijgt lowpass in de keten vóór de nitro-highpass (onder water gevoel)
    const destTail=window._musicMaster||window._master||window.audioCtx.destination;
    if(this.style==='deepsea'){
      this._filtLow=ctx.createBiquadFilter();
      this._filtLow.type='lowpass';
      this._filtLow.frequency.value=2500;
      this._filt=ctx.createBiquadFilter();
      this._filt.type='highpass';this._filt.frequency.value=20;
      this._out.connect(this._filtLow);
      this._filtLow.connect(this._filt);
      this._filt.connect(destTail);
    }else{
      this._filt=ctx.createBiquadFilter();
      this._filt.type='highpass';this._filt.frequency.value=20;
      this._out.connect(this._filt);
      this._filt.connect(destTail);
    }

    // === SPACE: synthwave — E minor ===
    if(this.style==='space'){
      this.bass=[NF('E',2),NF('E',2),NF('B',1),NF('B',1),NF('C',2),NF('C',2),NF('A',1),NF('A',1),
                 NF('G',1),NF('G',1),NF('A',1),NF('B',1),NF('C',2),NF('D',2),NF('E',2),NF('E',2)];
      this.lead=[NF('E',5),NF('B',5),NF('A',5),NF('G',5),NF('F#',5),NF('E',5),NF('D',5),NF('B',4),
                 NF('C',5),NF('E',5),NF('G',5),NF('A',5),NF('B',5),NF('A',5),NF('G',5),NF('E',5)];
    // === CANDY (Sugar Rush): bouncy chiptune happy C major ===
    }else if(this.style==='candy'){
      this.bass=[NF('C',2),NF('C',3),NF('G',2),NF('G',2),NF('A',2),NF('A',2),NF('F',2),NF('F',2),
                 NF('C',2),NF('C',3),NF('G',2),NF('E',3),NF('F',2),NF('A',2),NF('G',2),NF('C',3)];
      this.lead=[NF('C',5),NF('E',5),NF('G',5),NF('E',5),NF('A',5),NF('G',5),NF('E',5),NF('C',5),
                 NF('D',5),NF('F',5),NF('A',5),NF('F',5),NF('G',5),NF('E',5),NF('D',5),NF('C',5)];
    // === VOLCANO: aggressive phrygian E ===
    }else if(this.style==='volcano'){
      this.bass=[NF('E',2),NF('E',2),NF('E',2),NF('E',2),NF('F',2),NF('F',2),NF('G',2),NF('F',2),
                 NF('E',2),NF('E',2),NF('A',2),NF('G',2),NF('F',2),NF('E',2),NF('D',2),NF('E',2)];
      this.lead=[NF('E',5),NF('G',5),NF('A',5),NF('G',5),NF('F',5),NF('E',5),NF('D',5),NF('E',5),
                 NF('B',5),NF('A',5),NF('G',5),NF('F',5),NF('E',5),NF('F',5),NF('G',5),NF('E',5)];
    // === ARCTIC: ethereal slow F# minor ===
    }else if(this.style==='arctic'){
      this.bass=[NF('F#',1),NF('F#',1),NF('F#',1),NF('F#',1),NF('D',2),NF('D',2),NF('D',2),NF('D',2),
                 NF('A',1),NF('A',1),NF('A',1),NF('A',1),NF('E',2),NF('E',2),NF('E',2),NF('C#',2)];
      this.lead=[NF('F#',4),NF('A',4),NF('C#',5),NF('E',5),NF('D',5),NF('C#',5),NF('A',4),NF('F#',4),
                 NF('A',4),NF('C#',5),NF('D',5),NF('E',5),NF('C#',5),NF('A',4),NF('F#',4),NF('E',4)];
    // === SANDSTORM: D phrygian dominant — Middle-Eastern desert ===
    // Phrygian dominant scale on D: D Eb F# G A Bb C — flat 2 + maj 3
    // gives the "desert" sound used in the Suno prompts. Bass walks
    // around D/F/A/Bb pivots; lead winds through the scale's signature
    // augmented 2nd interval (Eb→F#) for that hypnotic oud feel.
    }else if(this.style==='sandstorm'){
      this.bass=[NF('D',2),NF('D',2),NF('D',2),NF('A',1),NF('Bb',1),NF('Bb',1),NF('F',2),NF('F',2),
                 NF('D',2),NF('D',2),NF('Eb',2),NF('F#',2),NF('A',2),NF('G',2),NF('F',2),NF('D',2)];
      this.lead=[NF('D',5),NF('Eb',5),NF('F#',5),NF('A',5),NF('Bb',5),NF('A',5),NF('F#',5),NF('Eb',5),
                 NF('D',5),NF('F#',5),NF('A',5),NF('C',6),NF('Bb',5),NF('A',5),NF('F#',5),NF('D',5)];
    // === DEEP SEA: downtempo dub A minor ===
    }else{
      this.bass=[NF('A',1),NF('A',1),NF('A',1),NF('G',1),NF('F',1),NF('F',1),NF('G',1),NF('G',1),
                 NF('A',1),NF('A',1),NF('E',1),NF('E',1),NF('D',2),NF('D',2),NF('E',1),NF('A',1)];
      this.lead=[NF('A',3),NF('C',4),NF('E',4),NF('D',4),NF('C',4),NF('A',3),NF('G',3),NF('E',3),
                 NF('F',3),NF('A',3),NF('G',3),NF('E',3),NF('D',3),NF('E',3),NF('A',3),NF('C',4)];
    }
    // Chord stabs — per-world palette
    const STABS={
      space:[[NF('A',2),NF('E',3),NF('A',3)],[NF('F',2),NF('C',3),NF('F',3)],[NF('C',3),NF('G',3),NF('C',4)],[NF('G',2),NF('D',3),NF('G',3)]],
      candy:[[NF('C',3),NF('E',3),NF('G',3)],[NF('G',2),NF('B',2),NF('D',3)],[NF('A',2),NF('C',3),NF('E',3)],[NF('F',2),NF('A',2),NF('C',3)]],
      volcano:[[NF('E',3),NF('G',3),NF('B',3)],[NF('F',3),NF('A',3),NF('C',4)],[NF('G',3),NF('B',3),NF('D',4)],[NF('E',3),NF('G',3),NF('B',3)]],
      arctic:[[NF('F#',3),NF('A',3),NF('C#',4)],[NF('D',3),NF('F#',3),NF('A',3)],[NF('A',2),NF('C#',3),NF('E',3)],[NF('E',3),NF('G#',3),NF('B',3)]],
      sandstorm:[[NF('D',3),NF('F#',3),NF('A',3)],[NF('Bb',2),NF('D',3),NF('F#',3)],[NF('Eb',3),NF('G',3),NF('Bb',3)],[NF('A',2),NF('C',3),NF('F#',3)]],
    };
    this.stabs=STABS[this.style]||STABS.space;
  }

  start(){
    this.running=true;this._gen=(this._gen||0)+1;
    // Defer eerste beat-schedule één event-loop tick zodat de 5-7 beats
    // van bass/kick/snare/hat/lead/supersaw node-allocaties NIET op
    // hetzelfde frame landen als de GO-render. nextBeat +.12s geeft de
    // setTimeout(0) ruim tijd voor de eerste tick.
    this.nextBeat=this.ctx.currentTime+.12;
    if(window._rpp)_rpp.mark('music:start',{style:this.style,bd:+this.bd.toFixed(3)});
    const gen=this._gen;
    setTimeout(()=>{ if(this._gen===gen && this.running) this._s(gen); },0);
  }
  stop(){
    this.running=false;this._gen=(this._gen||0)+1;
    if(window._rpp)_rpp.mark('music:stop',{style:this.style});
    // Disconnect output chain zodat de Gain/Filter nodes loskomen van
    // _musicMaster — voorkomt dangling nodes in de WebAudio graph bij
    // snelle Race→Quit→Race herhalingen (anders accumuleren ze tot GC).
    try{if(this._out)this._out.disconnect();}catch(_){}
    try{if(this._filt)this._filt.disconnect();}catch(_){}
    try{if(this._filtLow)this._filtLow.disconnect();}catch(_){}
  }

  // Nitro: highpass filter opent → lichter, meer "opwinding"
  setNitro(active){
    if(!this._filt||!this.ctx)return;
    const target=active?350:20;
    const now=this.ctx.currentTime;
    try{
      this._filt.frequency.cancelScheduledValues(now);
      this._filt.frequency.setValueAtTime(this._filt.frequency.value,now);
      this._filt.frequency.linearRampToValueAtTime(target,now+0.3);
    }catch(_){}
  }

  // Intensity 0..1 (continu): hat-velocity scaled, urgent-pattern boven 0.5,
  // PLUS overall mix-loudness +0..25% via _out.gain ramp. Final-lap forceert
  // effectief 1 via finalLap-flag. Sessie 04 V1 — was previously stored-only,
  // hat-velocity coupling was too subtle to read in the mix.
  setIntensity(level){
    this.intensity=Math.max(0,Math.min(1,+level||0));
    if(!this._out||!this.ctx)return;
    // Baseline per-world output is set in constructor; intensity scales 1.0
    // → 1.25 so a final-lap chase audibly leans on the mix without
    // distorting (master gain still bounded by _musicMaster).
    if(this._baseGain==null) this._baseGain = this._out.gain.value;
    const target = this._baseGain * (1.0 + this.intensity*0.25);
    try{
      const now=this.ctx.currentTime;
      this._out.gain.cancelScheduledValues(now);
      this._out.gain.setValueAtTime(this._out.gain.value, now);
      this._out.gain.linearRampToValueAtTime(target, now+0.4);
    }catch(_){}
  }

  setFinalLap(){
    if(this.finalLap)return;this.finalLap=true;if(!window.audioCtx)return;
    const t=window.audioCtx.currentTime+.05;
    this._crash(t);
    // Rising chord fanfare using exact notes
    [[NF('A',3),NF('C',4),NF('E',4)],[NF('E',4),NF('G',4),NF('B',4)]].forEach((chord,ci)=>{
      chord.forEach(fr=>{
        const o=window.audioCtx.createOscillator(),g=window.audioCtx.createGain();
        o.type='sawtooth';o.frequency.value=fr;
        g.gain.setValueAtTime(.042,t+ci*.22);g.gain.exponentialRampToValueAtTime(.001,t+ci*.22+.40);
        o.connect(g);g.connect(this._out);o.start(t+ci*.22);o.stop(t+ci*.22+.44);
      });
    });
  }

  _crash(t){
    const dur=1.7,sz=Math.ceil(this.ctx.sampleRate*dur),buf=this.ctx.createBuffer(1,sz,this.ctx.sampleRate);
    const d=buf.getChannelData(0);for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
    const src=this.ctx.createBufferSource(),hf=this.ctx.createBiquadFilter(),g=this.ctx.createGain();
    hf.type='highpass';hf.frequency.value=3800;
    g.gain.setValueAtTime(.14,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
    src.buffer=buf;src.connect(hf);hf.connect(g);g.connect(this._out);src.start(t);src.stop(t+dur+.1);
  }

  _kick(t,vol){
    const ctx=this.ctx;
    const F0={space:185,deepsea:155,candy:195,volcano:235,arctic:140,sandstorm:215};
    const F1={space:35,deepsea:25,candy:50,volcano:48,arctic:30,sandstorm:40};
    const V ={space:.58,deepsea:.82,candy:.60,volcano:.85,arctic:.45,sandstorm:.78};
    const f0=F0[this.style]||210,f1=F1[this.style]||42;
    const v=vol||V[this.style]||.72;
    const o=ctx.createOscillator(),g=ctx.createGain();
    o.type='sine';o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+.11);
    g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+.19);
    o.connect(g);g.connect(this._out);o.start(t);o.stop(t+.21);
    // Punch transient
    const sz=Math.ceil(ctx.sampleRate*.007),buf=ctx.createBuffer(1,sz,ctx.sampleRate);
    const d=buf.getChannelData(0);for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
    const src=ctx.createBufferSource(),bp=ctx.createBiquadFilter(),ng=ctx.createGain();
    bp.type='bandpass';bp.frequency.value=4500;bp.Q.value=2;
    ng.gain.setValueAtTime(v*.32,t);ng.gain.exponentialRampToValueAtTime(.001,t+.009);
    src.buffer=buf;src.connect(bp);bp.connect(ng);ng.connect(this._out);src.start(t);src.stop(t+.012);
  }

  _snare(t,v=.24){
    const ctx=this.ctx;
    // Noise body
    const NL={space:.17,deepsea:.08,candy:.10,volcano:.09,arctic:.22,sandstorm:.12};
    const BF={space:1200,deepsea:800,candy:1900,volcano:1750,arctic:1100,sandstorm:1300};
    const noiseLen=NL[this.style]||.12,bpFreq=BF[this.style]||1600;
    const sz=Math.ceil(ctx.sampleRate*noiseLen),buf=ctx.createBuffer(1,sz,ctx.sampleRate);
    const d=buf.getChannelData(0);for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
    const src=ctx.createBufferSource(),bf=ctx.createBiquadFilter(),g=ctx.createGain();
    bf.type='bandpass';bf.frequency.value=bpFreq;bf.Q.value=.8;
    g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+noiseLen);
    src.buffer=buf;src.connect(bf);bf.connect(g);g.connect(this._out);src.start(t);src.stop(t+noiseLen+.02);
    // Tonal body (skip for deepsea rimshot)
    if(this.style!=='deepsea'){
      const o=ctx.createOscillator(),og=ctx.createGain();
      o.type='triangle';o.frequency.setValueAtTime(220,t);o.frequency.exponentialRampToValueAtTime(155,t+.07);
      og.gain.setValueAtTime(v*.45,t);og.gain.exponentialRampToValueAtTime(.001,t+.10);
      o.connect(og);og.connect(this._out);o.start(t);o.stop(t+.12);
    }
  }

  _hat(t,v=.022,open=false){
    const vel=v*(0.62+Math.random()*.76);
    const dur=open?(this.style==='space'||this.style==='arctic'?.32:.20):.038;
    const sz=Math.ceil(this.ctx.sampleRate*dur),buf=this.ctx.createBuffer(1,sz,this.ctx.sampleRate);
    const d=buf.getChannelData(0);for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
    const src=this.ctx.createBufferSource(),hf=this.ctx.createBiquadFilter(),g=this.ctx.createGain();
    const HF={space:7000,deepsea:5500,candy:9500,volcano:9200,arctic:6500,sandstorm:8800};
    hf.type='highpass';hf.frequency.value=HF[this.style]||9000;
    g.gain.setValueAtTime(vel,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
    src.buffer=buf;src.connect(hf);hf.connect(g);g.connect(this._out);src.start(t);src.stop(t+dur+.01);
  }

  _s(gen){
    if(!this.running||gen!==this._gen)return;
    const ctx=this.ctx;
    while(this.nextBeat<ctx.currentTime+.28){
      const t=this.nextBeat,bd=this.bd,bi=this.beat%16;
      // A/B section — elke 8 bars wisselen we voor subtiele hat-variatie
      const section=Math.floor(this.bar/8)%2;
      const isB=section===1;
      // Continu intensity-driven hat-velocity. Urgent-pattern (16ths op
      // bar 2/4) boven 0.5 of op final-lap.
      const intLevel=this.finalLap?1:this.intensity;
      const urgent=this.finalLap||this.intensity>0.5;
      const hv=.022+intLevel*.014;

      // ── SPACE: synthwave — kick on 1&3 ──
      if(this.style==='space'){
        if(bi===0||bi===8)this._kick(t);
        if(bi===4||bi===12)this._snare(t,.20);
        this._hat(t,hv*.85,bi===2||bi===6||bi===10||bi===14);
        this._hat(t+bd*.5,hv*.5);
        this._hat(t+bd*.25,hv*.38);this._hat(t+bd*.75,hv*.38);
        // Sessie 04 V1 — urgent fill: 16th-note hat triplets on bar 7&15
        if(urgent && (bi===7||bi===15)){
          this._hat(t+bd*.33,hv*.6); this._hat(t+bd*.66,hv*.6);
        }
      }
      // ── CANDY: bouncy 16ths, kick 1&3, claps 2&4 ──
      else if(this.style==='candy'){
        if(bi===0||bi===8)this._kick(t,.68);
        if(bi===4||bi===12)this._snare(t,.22);
        this._hat(t,hv*.75);this._hat(t+bd*.5,hv*.62);
        this._hat(t+bd*.25,hv*.48);this._hat(t+bd*.75,hv*.48);
      }
      // ── VOLCANO: aggressive tribal double-kick ──
      else if(this.style==='volcano'){
        this._kick(t,.8);
        if(bi%2===1)this._kick(t,.42); // off-beat ghost
        if(bi===4||bi===12)this._snare(t,.28);
        if(bi===8)this._snare(t,.20);
        this._hat(t,hv*.9);this._hat(t+bd*.5,hv*.7);
        this._hat(t+bd*.25,hv*.55);this._hat(t+bd*.75,hv*.55);
      }
      // ── ARCTIC: sparse, airy, long reverberant snares ──
      else if(this.style==='arctic'){
        if(bi===0)this._kick(t,.48);
        if(bi===8)this._kick(t,.3);
        if(bi===4||bi===12)this._snare(t,.16);
        this._hat(t,hv*.5,bi%4===2);
        if(bi%4===0)this._hat(t+bd*.5,hv*.35);
      }
      // ── SANDSTORM: Middle-Eastern darbuka — rolling 16ths, accented 1/3 ──
      else if(this.style==='sandstorm'){
        // Heavy doum (kick) on 1 and 3, ghost dums on 2&4 for the
        // Maqsoum darbuka pattern feel.
        if(bi===0||bi===8)this._kick(t,.78);
        if(bi===4||bi===12)this._kick(t,.42); // ghost
        // Snare = tek (high finger-snap on 5, 13)
        if(bi===5||bi===13)this._snare(t,.20);
        // Continuous 16th-note hat shimmer with accent on the 8th
        this._hat(t,hv*.9,bi%4===0);
        this._hat(t+bd*.5,hv*.7);
        this._hat(t+bd*.25,hv*.55);
        this._hat(t+bd*.75,hv*.55);
      }
      // ── DEEP SEA: halftime dub ──
      else{
        if(bi===0)this._kick(t,.82);
        if(bi===8)this._kick(t,.40);
        if(bi===4||bi===12)this._snare(t,.18);
        this._hat(t,hv*.7);this._hat(t+bd*.5,hv*.44);
        // Urgent: ghost kicks on 6&14 to push the chase feel
        if(urgent && (bi===6||bi===14))this._kick(t,.35);
      }

      // ── BASS: rolling filtered sawtooth, note from pattern ──
      {
        const bassNote=this.bass[bi];
        const fBase=this.style==='deepsea'?100:this.style==='space'?165:180;
        const fPeak=this.style==='deepsea'?380:this.style==='space'?700:900;
        const bassVol=this.style==='deepsea'?.36:this.style==='space'?.22:.25;
        const bf=ctx.createOscillator(),bg=ctx.createGain(),bfilt=ctx.createBiquadFilter();
        bf.type='sawtooth';bfilt.type='lowpass';bfilt.Q.value=this.style==='deepsea'?6:4;
        bf.frequency.value=bassNote;
        bfilt.frequency.setValueAtTime(fBase,t);
        bfilt.frequency.exponentialRampToValueAtTime(fPeak,t+bd*.26);
        bfilt.frequency.exponentialRampToValueAtTime(fBase,t+bd*.72);
        bg.gain.setValueAtTime(bassVol,t+.003);bg.gain.exponentialRampToValueAtTime(.001,t+bd*.9);
        bf.connect(bfilt);bfilt.connect(bg);bg.connect(this._out);bf.start(t+.002);bf.stop(t+bd+.01);
      }

      // ── LEAD SYNTH (every 2 beats) ──
      if(bi%2===0){
        const lfreq=this.lead[bi/2];
        if(this.style==='space'){
          const o=ctx.createOscillator(),g=ctx.createGain(),f=ctx.createBiquadFilter();
          o.type='triangle';o.frequency.value=lfreq;f.type='lowpass';f.frequency.value=2600;
          g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.052,t+.02);
          g.gain.setValueAtTime(.052,t+bd*1.8);g.gain.exponentialRampToValueAtTime(.001,t+bd*2.2);
          o.connect(f);f.connect(g);g.connect(this._out);o.start(t);o.stop(t+bd*2.3);
          const oe=ctx.createOscillator(),ge=ctx.createGain();
          oe.type='triangle';oe.frequency.value=lfreq;
          ge.gain.setValueAtTime(0,t+.20);ge.gain.linearRampToValueAtTime(.020,t+.24);
          ge.gain.exponentialRampToValueAtTime(.001,t+bd*2);
          oe.connect(ge);ge.connect(this._out);oe.start(t+.20);oe.stop(t+bd*2.3);
        }else if(this.style==='candy'){
          // CANDY: bright square waves (NES feel) + bell harmonic
          const o=ctx.createOscillator(),g=ctx.createGain();
          o.type='square';o.frequency.value=lfreq;
          g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.030,t+.008);
          g.gain.setValueAtTime(.030,t+bd*1.4);g.gain.exponentialRampToValueAtTime(.001,t+bd*1.8);
          o.connect(g);g.connect(this._out);o.start(t);o.stop(t+bd*1.9);
          // Bell shimmer an octave up
          const ob=ctx.createOscillator(),gb=ctx.createGain();
          ob.type='sine';ob.frequency.value=lfreq*2;
          gb.gain.setValueAtTime(.024,t);gb.gain.exponentialRampToValueAtTime(.001,t+bd*.8);
          ob.connect(gb);gb.connect(this._out);ob.start(t);ob.stop(t+bd*.9);
        }else if(this.style==='volcano'){
          // VOLCANO: sharp distorted saw + octave sub
          [-8,8].forEach(det=>{
            const o=ctx.createOscillator(),g=ctx.createGain(),f=ctx.createBiquadFilter();
            o.type='sawtooth';o.frequency.value=lfreq;o.detune.value=det;
            f.type='highpass';f.frequency.value=350;f.Q.value=1.4;
            g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.036,t+.006);
            g.gain.setValueAtTime(.036,t+bd*1.6);g.gain.exponentialRampToValueAtTime(.001,t+bd*1.9);
            o.connect(f);f.connect(g);g.connect(this._out);o.start(t);o.stop(t+bd*2);
          });
        }else if(this.style==='arctic'){
          // ARCTIC: pure sine with long tail + soft pad
          const o=ctx.createOscillator(),g=ctx.createGain();
          o.type='sine';o.frequency.value=lfreq;
          g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.058,t+.06);
          g.gain.setValueAtTime(.058,t+bd*2.2);g.gain.exponentialRampToValueAtTime(.001,t+bd*3.2);
          o.connect(g);g.connect(this._out);o.start(t);o.stop(t+bd*3.3);
          // Fifth above, quieter
          const of=ctx.createOscillator(),gf=ctx.createGain();
          of.type='sine';of.frequency.value=lfreq*1.5;
          gf.gain.setValueAtTime(0,t);gf.gain.linearRampToValueAtTime(.022,t+.08);
          gf.gain.exponentialRampToValueAtTime(.001,t+bd*3);
          of.connect(gf);gf.connect(this._out);of.start(t);of.stop(t+bd*3.1);
        }else{
          // Deep Sea: soft triangle with delay echo
          const o=ctx.createOscillator(),g=ctx.createGain(),f=ctx.createBiquadFilter();
          o.type='triangle';o.frequency.value=lfreq;f.type='lowpass';f.frequency.value=900;f.Q.value=1.5;
          g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.042,t+.03);
          g.gain.setValueAtTime(.042,t+bd*1.9);g.gain.exponentialRampToValueAtTime(.001,t+bd*2.4);
          o.connect(f);f.connect(g);g.connect(this._out);o.start(t);o.stop(t+bd*2.5);
          const oe=ctx.createOscillator(),ge=ctx.createGain(),fe=ctx.createBiquadFilter();
          oe.type='sine';oe.frequency.value=lfreq;fe.type='lowpass';fe.frequency.value=600;
          ge.gain.setValueAtTime(0,t+.30);ge.gain.linearRampToValueAtTime(.016,t+.34);
          ge.gain.exponentialRampToValueAtTime(.001,t+bd*2.2);
          oe.connect(fe);fe.connect(ge);ge.connect(this._out);oe.start(t+.30);oe.stop(t+bd*2.5);
        }
      }

      // ── CHORD STABS (every 4 beats, skip deepsea/arctic for sparser feel) ──
      if(bi%4===0&&this.style!=='deepsea'&&this.style!=='arctic'){
        const stabChord=this.stabs[bi/4];
        stabChord.forEach(fr=>{
          const o=ctx.createOscillator(),g=ctx.createGain(),f=ctx.createBiquadFilter();
          o.type='sawtooth';f.type='lowpass';
          f.frequency.value=this.style==='space'?1300:1050;f.Q.value=1.2;
          o.frequency.value=fr*2; // one octave up
          g.gain.setValueAtTime(.038,t+.002);g.gain.exponentialRampToValueAtTime(.001,t+bd*.40);
          o.connect(f);f.connect(g);g.connect(this._out);o.start(t+.001);o.stop(t+bd*.44);
        });
        // Space: arpeggio on top of stab
        if(this.style==='space'){
          stabChord.forEach((fr,i)=>{
            const o=ctx.createOscillator(),g=ctx.createGain();
            o.type='triangle';o.frequency.value=fr*4;
            g.gain.setValueAtTime(.018,t+i*.055);g.gain.exponentialRampToValueAtTime(.001,t+i*.055+bd*.38);
            o.connect(g);g.connect(this._out);o.start(t+i*.055);o.stop(t+i*.055+bd*.42);
          });
        }
      }

      // ── DEEP SEA: bubble blip ──
      if(this.style==='deepsea'&&Math.random()<.045){
        const bfreq=700+Math.random()*1400;
        const ob=ctx.createOscillator(),gb=ctx.createGain();
        ob.type='sine';ob.frequency.setValueAtTime(bfreq,t);ob.frequency.exponentialRampToValueAtTime(bfreq*1.5,t+.055);
        gb.gain.setValueAtTime(.013,t);gb.gain.exponentialRampToValueAtTime(.001,t+.065);
        ob.connect(gb);gb.connect(this._out);ob.start(t);ob.stop(t+.075);
      }

      // ── FINAL LAP / INTENSITY: extra hats ──
      if(urgent&&bi%4===2){this._hat(t+bd*.25,hv*.6);this._hat(t+bd*.75,hv*.6);}
      // B-section: subtiele extra 16th-hat op odd beats (nooit op deepsea/arctic — te ijl)
      if(isB&&this.style!=='deepsea'&&this.style!=='arctic'&&bi%2===1){
        this._hat(t+bd*.5,hv*.35);
      }

      this.nextBeat+=bd;this.beat++;
      if(bi===15){this.bar++;if(window._rpp)_rpp.mark('music:bar',{bar:this.bar,style:this.style,intensity:+this.intensity.toFixed(2),finalLap:!!this.finalLap});}
    }
    setTimeout(()=>this._s(gen),14);
  }
}


function _playCountdownRoll(){
  if(!window.audioCtx)return;
  const t0=window.audioCtx.currentTime;
  const g=window._musicMaster||window._master||window.audioCtx.destination;
  // 16 tom hits over ~2.8s, exponentieel versnellend
  for(let i=0;i<16;i++){
    const frac=i/15;
    const t=t0+2.9*(1-Math.pow(1-frac,2.2));
    const freq=90+i*6;
    const vol=0.25+frac*0.35;
    MusicLib.tom(window.audioCtx,t,freq,vol).connect(g);
  }
  // Final boom op GO-moment
  setTimeout(()=>{
    if(!window.audioCtx)return;
    const t=window.audioCtx.currentTime;
    MusicLib.kick(window.audioCtx,t,0.9).connect(g);
    MusicLib.snare(window.audioCtx,t,0.5).connect(g);
  },3000);
}

function startTitleMusic(){
  if(!window.audioCtx)return;
  window._ensureAudio();
  // Crossfade: stop select- of race-muziek die nog draait
  if(window.selectMusic){_fadeOutMusic(window.selectMusic,0.6);window.selectMusic=null;}
  if(window.musicSched){_fadeOutMusic(window.musicSched,0.6);window.musicSched=null;}
  if(window.titleMusic&&window.titleMusic.running)return;
  if(window.titleMusic){try{window.titleMusic.stop();}catch(_){}window.titleMusic=null;}
  window.titleMusic=_safeStartMusic(()=>new TitleMusic(window.audioCtx));
}
function startSelectMusic(){
  if(!window.audioCtx)return;
  window._ensureAudio();
  if(window.titleMusic){_fadeOutMusic(window.titleMusic,0.6);window.titleMusic=null;}
  if(window.musicSched){_fadeOutMusic(window.musicSched,0.6);window.musicSched=null;}
  if(window.selectMusic&&window.selectMusic.running)return;
  if(window.selectMusic){try{window.selectMusic.stop();}catch(_){}window.selectMusic=null;}
  window.selectMusic=_safeStartMusic(()=>new SelectMusic(window.audioCtx));
  // Preload muziek-stems + globale SFX + surface voor de huidige wereld
  // (idempotent). Als user een andere wereld kiest triggert select.js
  // rebuildWorld een nieuwe preload-cyclus.
  if(window.activeWorld&&typeof window._preloadWorldAudio==='function'){
    window._preloadWorldAudio(window.activeWorld);
  }
  if(typeof window._preloadSFX==='function')window._preloadSFX();
  if(typeof window._preloadAmbient==='function')window._preloadAmbient();
  if(typeof window._preloadSurfacesForWorld==='function'&&window.activeWorld){
    window._preloadSurfacesForWorld(window.activeWorld);
  }
}

// MenuMusic — single MP3 buffer dat over title/world/car select door blijft
// lopen. Bewust geen oscillator-baseline: één BufferSource met loop=true,
// fade-in via _out gain. Stop teardown disconnect het hele subgraph zodat
// _musicDuck-ramping op _musicMaster meeluistert via voice-gain pipeline.
class MenuMusic {
  constructor(ctx, buffer){
    this.ctx = ctx;
    this.buffer = buffer;
    this.running = false;
    this._out = ctx.createGain();
    this._out.gain.value = 0.0;
    _ensureMusicMaster();
    const dest = window._musicMaster || window._master || ctx.destination;
    this._out.connect(dest);
    this._src = null;
  }
  start(){
    if(this.running || !this.buffer) return;
    this.running = true;
    const t = this.ctx.currentTime + 0.05;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.connect(this._out);
    src.start(t);
    this._src = src;
    try {
      this._out.gain.cancelScheduledValues(t);
      this._out.gain.setValueAtTime(0, t);
      this._out.gain.linearRampToValueAtTime(0.85, t + 0.6);
    } catch(_){}
  }
  stop(){
    if(!this.running) return;
    this.running = false;
    try { if(this._src) this._src.stop(); } catch(_){}
    this._src = null;
    try { this._out.disconnect(); } catch(_){}
  }
}
window.MenuMusic = MenuMusic;

window._menuMusicBuffer = null;
window._menuMusicLoading = null;
function _loadMenuMusic(){
  if(!window.audioCtx) return null;
  if(window._menuMusicBuffer) return Promise.resolve(window._menuMusicBuffer);
  if(window._menuMusicLoading) return window._menuMusicLoading;
  const ctx = window.audioCtx;
  // boot.js pre-fetcht de MP3 al als ArrayBuffer vóór de 1e gesture, dus
  // hier hoeven we meestal alleen nog te decoderen (~100-200ms op iOS).
  // Fallback: als pre-fetch nog niet klaar is, fetch + decode in één keten.
  const arr = window._menuMusicArrayBuffer;
  const arrPromise = arr
    ? Promise.resolve(arr)
    : (window._menuMusicArrayBufferLoading
        || fetch('assets/audio/music/menu/grid-run.mp3', { cache:'force-cache' }).then(r => r.arrayBuffer()));
  window._menuMusicLoading = Promise.resolve(arrPromise)
    .then(buf => {
      if(!buf) throw new Error('arraybuffer unavailable');
      // decodeAudioData detacht de input — slice() voorkomt re-use issues
      // mocht een andere loader dezelfde buffer pakken.
      return ctx.decodeAudioData(buf.slice(0));
    })
    .then(audio => {
      window._menuMusicBuffer = audio;
      window._menuMusicArrayBuffer = null;
      return audio;
    })
    .catch(e => { if(window.dbg) dbg.warn('music','menu mp3 load failed: '+(e&&e.message||e)); return null; });
  return window._menuMusicLoading;
}
window._loadMenuMusic = _loadMenuMusic;

function startMenuMusic(){
  if(!window.audioCtx) return;
  window._ensureAudio();
  // Preload race-asset bundle voor de huidige wereld zodra audioCtx leeft.
  // Zonder deze trigger blijft de default-wereld (cosmic) op procedural omdat
  // rebuildWorld alleen vuurt bij een wissel naar een andere card, en
  // startSelectMusic (waar deze block ooit in stond) wordt nergens meer
  // aangeroepen. Idempotent — _preloadBundle / _preloadFlat dedupliceren.
  if(window.activeWorld && typeof window._preloadWorldAudio === 'function'){
    window._preloadWorldAudio(window.activeWorld);
  }
  if(typeof window._preloadSFX === 'function') window._preloadSFX();
  if(typeof window._preloadAmbient === 'function') window._preloadAmbient();
  if(typeof window._preloadSurfacesForWorld === 'function' && window.activeWorld){
    window._preloadSurfacesForWorld(window.activeWorld);
  }
  // Continuïteits-guard: menu-muziek moet over title → world → car
  // select door blijven lopen zonder herstart. Als de scheduler al draait,
  // niets doen.
  if(window.menuMusic && window.menuMusic.running) return;
  if(window.selectMusic){_fadeOutMusic(window.selectMusic,0.6);window.selectMusic=null;}
  if(window.musicSched){_fadeOutMusic(window.musicSched,0.6);window.musicSched=null;}
  // Geen procedurele bridge meer — die was hoorbaar als "oude muziek" vóór
  // de MP3 binnen was. Als er nog een TitleMusic ronddraait uit een oude
  // flow (bv. finish.js fallback), fade die hier weg.
  if(window.titleMusic){_fadeOutMusic(window.titleMusic,0.4);window.titleMusic=null;}
  if(window._menuMusicBuffer){
    window.menuMusic = _safeStartMusic(()=>new MenuMusic(window.audioCtx, window._menuMusicBuffer));
    return;
  }
  // Buffer nog niet gedecodeerd — kick decode af en start zodra klaar.
  // Stilte tot dat moment is bewust: dankzij boot.js' pre-fetch is dit
  // alleen nog een ~100-200ms decode op iOS Safari.
  _loadMenuMusic().then(buf => {
    if(!buf) return;
    const gs = window.gameState;
    if(gs!=='TITLE' && gs!=='WORLD_SELECT' && gs!=='SELECT') return;
    if(window.menuMusic && window.menuMusic.running) return;
    window.menuMusic = _safeStartMusic(()=>new MenuMusic(window.audioCtx, buf));
  });
}
window.startMenuMusic = startMenuMusic;

function _createRaceMusicForWorld(){
  // Dispatcher: als samples.js stems heeft geladen voor de actieve wereld,
  // gebruik StemRaceMusic; anders fallback naar procedurele RaceMusic.
  if(typeof window._createStemRaceMusicIfReady === 'function'){
    const stem = window._createStemRaceMusicIfReady();
    if(stem) return stem;
  }
  return new RaceMusic(window.audioCtx);
}


// Expose to window for main.js (non-module) use
window.noteFreq=noteFreq; window.NF=NF;
window.MusicLib=MusicLib;
window._ensureMusicMaster=_ensureMusicMaster;
window._applyMusicGain=_applyMusicGain;
window._fadeOutMusic=_fadeOutMusic;
window._safeStartMusic=_safeStartMusic;
window._playCountdownRoll=_playCountdownRoll;
window.startTitleMusic=startTitleMusic;
window.startSelectMusic=startSelectMusic;
window._createRaceMusicForWorld=_createRaceMusicForWorld;
window.TitleMusic=TitleMusic;
window.SelectMusic=SelectMusic;
window.RaceMusic=RaceMusic;

// _musicDebug — console helper
window._musicDebug=function(){
  const info={
    musicMaster_gain: window._musicMaster?window._musicMaster.gain.value:null,
    _musicVolume: window._musicVolume,
    _musicMuted: window._musicMuted,
    _musicDuck: window._musicDuck,
    active_scheduler: (typeof window.musicSched!=='undefined'&&window.musicSched)?(window.musicSched.constructor.name+'('+(window.musicSched.style||'')+')'):'none',
    title_scheduler: (typeof window.titleMusic!=='undefined'&&window.titleMusic)?window.titleMusic.constructor.name:'none',
    select_scheduler: (typeof window.selectMusic!=='undefined'&&window.selectMusic)?window.selectMusic.constructor.name:'none',
    osc_count: MusicLib._oscCount,
    ctx_state: window.audioCtx?window.audioCtx.state:'none',
    ctx_time: window.audioCtx?window.audioCtx.currentTime.toFixed(2):null,
    lite_mode: MusicLib.lite(),
    filt_freq: (typeof window.musicSched!=='undefined'&&window.musicSched&&window.musicSched._filt)?window.musicSched._filt.frequency.value:null,
    intensity: (typeof window.musicSched!=='undefined'&&window.musicSched)?window.musicSched.intensity:null,
    final_lap: (typeof window.musicSched!=='undefined'&&window.musicSched)?window.musicSched.finalLap:null
  };
  console.table(info);
  return info;
};
