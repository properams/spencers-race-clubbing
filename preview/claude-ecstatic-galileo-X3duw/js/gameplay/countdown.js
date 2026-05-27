// js/gameplay/countdown.js — non-module script.

'use strict';

// Generation counter — invalideert pending setTimeout chains uit een
// vorige countdown als user quit + restart tijdens countdown. Zonder
// deze guard zouden twee parallelle lightOn-chains lopen, dubbele beeps
// + dubbele onGo() callbacks geven.
var _cdGen=0;

function runCountdown(onGo){
  try{
    if(window.dbg)dbg.markRaceEvent('CD-START');
    if(window._rpp)_rpp.mark('countdown:start');
    if(window.perfMark)perfMark('countdown:total:start');
    // Pre-warm bloom/post-FX shaders + RTs zodat shader-link en GPU
    // texture-upload tijdens countdown landen (gemaskeerd door countdown-
    // animatie) ipv op het eerste race-frame na GO (visible freeze).
    // No-op als postFX uit staat (mobile, low-tier, user-toggle).
    if(window._precompilePostFX){
      try{ window._precompilePostFX(scene, camera); }catch(_){}
    }
    var gen=++_cdGen;
    // Audio-unlock guard: op iOS kan AudioContext suspended raken na
    // backgrounding. Fire-and-forget resume — visuele tick gaat sowieso
    // door, audio mag stil blijven of inhalen.
    if(window.audioCtx&&(audioCtx.state==='suspended'||audioCtx.state==='interrupted')){
      if(window.dbg)dbg.warn('countdown','audioCtx '+audioCtx.state+' at start, attempting resume');
      try{audioCtx.resume().catch(function(e){
        if(window.dbg)dbg.warn('countdown','audioCtx resume failed: '+(e&&e.message||e));
      });}catch(_){}
    }
    const lights=['fl1','fl2','fl3','fl4','fl5'];
    const f1El=document.getElementById('f1Lights');
    const num=document.getElementById('cdNum');
    const cdOv=document.getElementById('cdOverlay');
    lights.forEach(function(id){var el=document.getElementById(id);if(el)el.classList.remove('on');});
    if(f1El)f1El.style.display='flex';
    if(cdOv)cdOv.style.display='none';
    try{_playCountdownRoll();}catch(_){}
    var i=0;
    // Player-car type for engine-rev cue. Resolved once per countdown so
    // a quit/restart still gets the right car.
    var _playerCarType=(typeof carObjs!=='undefined' && typeof playerIdx==='number'
      && carObjs[playerIdx] && carObjs[playerIdx].def) ? (carObjs[playerIdx].def.type||'super') : 'super';
    var lightOn=function(){
      if(gen!==_cdGen){if(window.dbg)dbg.log('countdown','stale tick dropped (gen '+gen+' vs '+_cdGen+')');return;}
      try{
        if(i<lights.length){
          var el=document.getElementById(lights[i]);if(el)el.classList.add('on');
          try{Audio.playCount(1);}catch(e){}
          // Sessie 04 V3 — per-world signature stinger op het derde licht.
          // Hergebruikt de bestaande lap-event-stingers (synthSweep,
          // rumble, echo, etc per world). Geeft elke wereld een teaser
          // beat vóór GO zonder nieuwe assets.
          if(i===2){
            try{if(Audio.playWorldLapEvent)Audio.playWorldLapEvent(activeWorld);}catch(e){}
          }
          // Engine-rev pulse on the LAST light (B3): "ready to launch"
          // beat, layered on the count-beep. Per-car-type tone (f1
          // high-sharp, muscle low-growl, etc).
          if(i===4){try{Audio.playEngineRev(_playerCarType);}catch(e){}}
          if(window.dbg)dbg.log('countdown','light '+(i+1)+'/5');
          i++;
          setTimeout(lightOn,700);
        }else{
          setTimeout(function(){
            if(gen!==_cdGen){if(window.dbg)dbg.log('countdown','stale GO dropped (gen '+gen+' vs '+_cdGen+')');return;}
            try{
              // Lights GO! sequence: brief green flash on every light
              // (B2 — feels like a 'lights green, GO' beat) then standard
              // staggered extinguish animation. Both classes coexist; the
              // flash CSS animation completes in ~0.42s so by the time
              // extinguish kicks in the flash has settled visually.
              lights.forEach(function(id,idx){
                var el=document.getElementById(id);
                if(!el)return;
                el.classList.remove('on');
                el.classList.add('flash');
                setTimeout(function(){
                  if(!el)return;
                  el.classList.remove('flash');
                  el.classList.add('extinguish');
                  setTimeout(function(){el.classList.remove('extinguish');},420);
                },idx*45+200);
              });
              try{Audio.playCount(0);}catch(e){}
              // Big engine roar on GO (B3) — layered op count-beep +
              // crowd-cheer + go-tone. Same playEngineRev as light-5 cue
              // but timed to coincide with GO so the player gets a
              // double-pulse "rev → blast off" beat.
              try{Audio.playEngineRev(_playerCarType);}catch(e){}
              try{Audio.playCrowdCheer();
                setTimeout(function(){if(gen!==_cdGen)return;try{playCrowdCheer();}catch(_){}},180);
                setTimeout(function(){if(gen!==_cdGen)return;try{playCrowdCheer();}catch(_){}},360);
              }catch(e){}
              // Inline GO-tone oscillator één tick (~16ms) na het GO-frame
              // schedulen. Bouwen van oscillator + filter + gain + connect
              // viel anders op hetzelfde frame als playEngineRev,
              // playCount(0), playCrowdCheer én onGo() state-flip — wat
              // een merkbare hitch gaf direct na 'GO!'. Voor de speler is
              // 16ms shift onhoorbaar (SFX-onset).
              setTimeout(function(){
                if(gen!==_cdGen)return;
                if(!audioCtx)return;
                try{
                  var t=audioCtx.currentTime;
                  var o=audioCtx.createOscillator(),g=audioCtx.createGain(),f=audioCtx.createBiquadFilter();
                  o.type='sawtooth';f.type='lowpass';f.frequency.value=2200;
                  o.frequency.setValueAtTime(80,t);o.frequency.exponentialRampToValueAtTime(520,t+.6);
                  g.gain.setValueAtTime(.28,t);g.gain.exponentialRampToValueAtTime(.001,t+.75);
                  o.connect(f);f.connect(g);g.connect(_dst());o.start(t);o.stop(t+.8);
                }catch(e){}
              },16);
              if(cdOv)cdOv.style.display='flex';
              if(num){
                num.textContent='GO!';
                num.style.color='#00ff66';
                num.style.textShadow='0 0 90px #00ff88,0 0 180px #00ee55,0 0 280px #00bb44aa';
                num.style.transform='';
                num.style.opacity='';
                // goFlashScale (.css) handles the dramatic pop AND the
                // fade-out in one animation (700ms). Replaces the
                // earlier flow of static-scale + JS-driven fadePop
                // (which conflicted with the running animation). 'both'
                // fill keeps the final keyframe (opacity 0, scale 1.4)
                // pinned so we don't get a flicker if the cdOv display
                // toggle lags by a frame.
                num.style.animation='goFlashScale .7s cubic-bezier(.34,1.6,.64,1) both';
              }
              if(f1El)f1El.style.display='none';
            }catch(e){window.dbg?dbg.error('countdown',e,'GO error'):console.error('Countdown GO error:',e);}
            // ALWAYS fire onGo — even if visuals fail
            if(window.dbg)dbg.markRaceEvent('GO');
            if(window._rpp)_rpp.mark('countdown:GO');
            if(window.perfMark){perfMark('go:fired');perfMeasure('countdown.total','countdown:total:start','go:fired');window._waitingForFirstRaceFrame=true;}
            // Cold-start diagnose: emit drie wallclock-totals vanaf
            // navigationStart tot drie aparte mijlpalen. Helpt de tijdsbalans
            // tussen boot-werk, menu-wait en countdown uitsplitsen in de
            // dump. Eindpunt urlToRaceable = nu = moment dat speler echt
            // gaspedaal kan indrukken. urlToFirstFrame is een eigen pad in
            // loop.js (gemeten op eerste race-render einde). Alles gated
            // op perfLog zodat productie 0 overhead heeft.
            if(window.perfLog){
              const _emit=(name,endLabel)=>{
                try{
                  performance.measure(name,{start:0,end:endLabel});
                  const _m=performance.getEntriesByName(name,'measure');
                  const _last=_m[_m.length-1];
                  if(_last)window.perfLog.push({name,ms:_last.duration,t:performance.now()});
                }catch(_){
                  // Fallback voor browsers zonder options-object measure-form:
                  // boot:start als start. Pre-boot blijft afleidbaar via
                  // performance.getEntriesByName('boot:start')[0].startTime.
                  if(window.perfMeasure)window.perfMeasure(name,'boot:start',endLabel);
                }
              };
              _emit('wallclock.urlToBootDone','boot:initialBuild:end');
              _emit('wallclock.urlToMenuInteractive','menu:interactive');
              _emit('wallclock.urlToRaceable','go:fired');
            }
            // End cinematic intro (B1) on GO — updateCamera() takes over.
            if(typeof endIntroCamera==='function')endIntroCamera();
            onGo();
            if(window._rpp){
              setTimeout(()=>{if(gen!==_cdGen)return;try{_rpp.mark('GO+1s');}catch(_){}},1000);
              setTimeout(()=>{if(gen!==_cdGen)return;try{_rpp.mark('GO+3s');}catch(_){}},3000);
              setTimeout(()=>{if(gen!==_cdGen)return;try{_rpp.mark('GO+5s');}catch(_){}},5000);
            }
            if(window.dbg){
              setTimeout(()=>{if(gen!==_cdGen)return;try{dbg.markRaceEvent('GO+1s');}catch(_){}},1000);
              setTimeout(()=>{if(gen!==_cdGen)return;try{dbg.markRaceEvent('GO+3s');}catch(_){}},3000);
            }
            // Hide overlay + clear inline animation after goFlashScale
            // ends (~700ms). Replaces the prior fadePop call which
            // conflicted with the CSS animation's transform/opacity.
            setTimeout(function(){
              if(gen!==_cdGen)return;
              if(cdOv)cdOv.style.display='none';
              if(num){num.style.animation='';num.style.opacity='';num.style.transform='';}
            },720);
          },150+Math.random()*130);
        }
      }catch(e){window.dbg?dbg.error('countdown',e,'lightOn error'):console.error('Countdown lightOn error:',e);onGo();}
    };
    setTimeout(lightOn,600);
  }catch(e){
    if(window.dbg)dbg.error('countdown',e,'runCountdown crashed');
    else console.error('Countdown crashed:',e);
    onGo();
  }
}

// playGridRevving was dead — pre-race grid-revving SFX, nooit ge-wired
// in runCountdown (alleen Audio.playCount + Audio.playCrowdCheer worden
// op grid afgespeeld). Verwijderd in dead-code cleanup.
