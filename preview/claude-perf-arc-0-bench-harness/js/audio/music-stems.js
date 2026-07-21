// js/audio/music-stems.js — sample-based race music met layered stems.
//
// Vervangt RaceMusic uit music.js voor werelden waar de assets via
// samples.js beschikbaar zijn. Contract is identiek aan RaceMusic:
//   start(), stop(), setNitro(b), setIntensity(0|1), setFinalLap()
//   ._out (GainNode, voor _fadeOutMusic), .running, .style
//
// Layer-model:
//   base loop  — drums + bass, altijd 100%
//   mid loop   — chord-pad + arp, intensity 0 = 80%, intensity 1 = 100%
//   lead loop  — melody + risers, intensity 0 = 30%, intensity 1 = 100%
//   intro      — eenmalig na countdown, voor de loops in beginnen
//   finalLap   — one-shot stinger op final-lap event
//   nitroFx    — one-shot bij nitro-activate (bovenop highpass filter)
//
// Alle 3 loops starten op exact dezelfde audioCtx-tijd zodat ze sample-
// accurate gesynchroniseerd blijven; mixing gebeurt via per-stem GainNodes.

class StemRaceMusic {
  constructor(ctx, worldId, buffers){
    this.ctx = ctx;
    this.style = worldId;
    this.buffers = buffers || {};
    this.running = false;
    this.finalLap = false;
    this.intensity = 0;
    this._gen = 0;
    this._sources = [];

    if(typeof window._ensureMusicMaster === 'function') window._ensureMusicMaster();

    // Output chain: stems → _out → _filt (highpass voor nitro) → musicMaster
    this._out = ctx.createGain();
    this._out.gain.value = 1.10;

    this._filt = ctx.createBiquadFilter();
    this._filt.type = 'highpass';
    this._filt.frequency.value = 20;

    this._out.connect(this._filt);
    const dest = window._musicMaster || window._master || ctx.destination;
    this._filt.connect(dest);

    // Per-stem gains. Lead start op 0.30 zodat baseline al "compleet" voelt
    // maar final-lap nog headroom heeft.
    this._gBase = ctx.createGain(); this._gBase.gain.value = 1.0;
    this._gMid  = ctx.createGain(); this._gMid.gain.value  = this.buffers.mid  ? 0.8 : 0;
    this._gLead = ctx.createGain(); this._gLead.gain.value = this.buffers.lead ? 0.3 : 0;
    this._gBase.connect(this._out);
    this._gMid.connect(this._out);
    this._gLead.connect(this._out);
  }

  start(){
    if(this.running) return;
    this.running = true;
    this._gen++;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.06;
    let loopStart = t0;

    // Intro (one-shot) — als aanwezig, schuift loop-start naar einde intro.
    if(this.buffers.intro){
      const src = ctx.createBufferSource();
      src.buffer = this.buffers.intro;
      const g = ctx.createGain(); g.gain.value = 1.0;
      src.connect(g); g.connect(this._out);
      src.start(t0);
      this._sources.push(src);
      loopStart = t0 + this.buffers.intro.duration;
    }

    // 3 stems, allen op zelfde loopStart → frame-accurate aligned.
    if(this.buffers.base) this._startLoop(this.buffers.base, this._gBase, loopStart);
    if(this.buffers.mid)  this._startLoop(this.buffers.mid,  this._gMid,  loopStart);
    if(this.buffers.lead) this._startLoop(this.buffers.lead, this._gLead, loopStart);
  }

  _startLoop(buffer, gainNode, t){
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(gainNode);
    src.start(t);
    this._sources.push(src);
  }

  stop(){
    if(!this.running) return;
    this.running = false;
    this._gen++;
    // Sources direct terminaten — _fadeOutMusic in music.js heeft de _out-gain
    // al uitgefade voor het ons aanroept, dus harde stop is hier veilig.
    for(const s of this._sources){
      try{ s.stop(); }catch(_){}
    }
    this._sources = [];
    // Disconnect chain zodat _gBase/_gMid/_gLead/_out/_filt loskomen van
    // _musicMaster — voorkomt accumulatie van dangling nodes bij snelle
    // Race→Quit→Race herhalingen.
    try{ if(this._gBase) this._gBase.disconnect(); }catch(_){}
    try{ if(this._gMid)  this._gMid.disconnect();  }catch(_){}
    try{ if(this._gLead) this._gLead.disconnect(); }catch(_){}
    try{ if(this._out)   this._out.disconnect();   }catch(_){}
    try{ if(this._filt)  this._filt.disconnect();  }catch(_){}
  }

  // Highpass-sweep voor nitro-feel + optionele FX-burst.
  setNitro(active){
    if(!this._filt) return;
    const target = active ? 350 : 20;
    const now = this.ctx.currentTime;
    try{
      this._filt.frequency.cancelScheduledValues(now);
      this._filt.frequency.setValueAtTime(this._filt.frequency.value, now);
      this._filt.frequency.linearRampToValueAtTime(target, now + 0.3);
    }catch(_){}
    if(active && this.buffers.nitroFx) this._oneShot(this.buffers.nitroFx, 0.6);
  }

  // Layering: continu 0..1. 0 = baseline mix (mid 60%, lead 20%),
  // 1 = full mix (alles 100%). Fractioneel zodat positie/combo/speed
  // hooks soepel kunnen schalen zonder discrete sprongen.
  setIntensity(level){
    this.intensity = Math.max(0, Math.min(1, +level || 0));
    const now = this.ctx.currentTime;
    const ramp = 0.4;
    const midTarget  = this.buffers.mid  ? (0.6 + this.intensity * 0.4) : 0;
    const leadTarget = this.buffers.lead ? (0.2 + this.intensity * 0.8) : 0;
    this._rampGain(this._gMid,  midTarget,  now, ramp);
    this._rampGain(this._gLead, leadTarget, now, ramp);
  }

  setFinalLap(){
    if(this.finalLap) return;
    this.finalLap = true;
    if(this.buffers.finalLap) this._oneShot(this.buffers.finalLap, 0.85);
    // Lead naar full mix voor laatste-ronde-energie.
    const now = this.ctx.currentTime;
    if(this.buffers.lead) this._rampGain(this._gLead, 1.0, now, 0.5);
    if(this.buffers.mid)  this._rampGain(this._gMid,  1.0, now, 0.5);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  _oneShot(buffer, vol){
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(g); g.connect(this._out);
    src.start(this.ctx.currentTime);
    // Niet in this._sources — we willen 'm bij stop() niet hard cutten,
    // hij sterft natuurlijk uit.
  }

  _rampGain(node, target, now, dur){
    if(!node) return;
    try{
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(target, now + dur);
    }catch(_){}
  }
}

// Factory: gebruikt door api.js' dispatcher om te beslissen tussen
// stems en procedural RaceMusic.
function createStemRaceMusicIfReady(){
  if(window._forceProceduralAudio) return null;
  const w = window.activeWorld;
  if(!window._hasMusicStems || !window._hasMusicStems(w)) return null;
  if(!window.audioCtx) return null;
  const buffers = window._getReadyBuffers(w);
  return new StemRaceMusic(window.audioCtx, w, buffers);
}

window.StemRaceMusic = StemRaceMusic;
window._createStemRaceMusicIfReady = createStemRaceMusicIfReady;

export { StemRaceMusic, createStemRaceMusicIfReady };
