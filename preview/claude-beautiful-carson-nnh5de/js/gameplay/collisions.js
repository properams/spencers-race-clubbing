// js/gameplay/collisions.js — non-module script.

'use strict';

function checkCollisions(dt){
  const player=carObjs[playerIdx];if(!player)return;
  if(_raceStartGrace>0){_raceStartGrace-=dt;return;} // Grace period at race start
  // Plain for-loop over carObjs — was Array.prototype.forEach with a closure
  // allocated per call (~60 closures/sec). Body unchanged.
  const _ccN=carObjs.length;
  for(let i=0;i<_ccN;i++){
    if(i===playerIdx)continue;
    const other=carObjs[i];
    const dx=player.mesh.position.x-other.mesh.position.x,dz=player.mesh.position.z-other.mesh.position.z;
    // Squared-distance gate: skip de sqrt voor de 7 van 8 paren die elke
    // frame ver uit elkaar staan. 2.4² = 5.76, 0.01² = 1e-4.
    const _d2=dx*dx+dz*dz;
    if(_d2<5.76&&_d2>1e-4){
      const dist=Math.sqrt(_d2);
      const nx=dx/dist,nz=dz/dist;
      const relSpd=Math.abs(player.speed-other.speed);
      player.mesh.position.x+=nx*.6;player.mesh.position.z+=nz*.6;
      other.mesh.position.x-=nx*.6;other.mesh.position.z-=nz*.6;
      player.speed*=.70;other.speed*=.70;
      const heavy=relSpd>.18;
      camShake=heavy?.88:.42;
      Audio.playCollision();
      const eX=player.mesh.position.x,eZ=player.mesh.position.z;
      sparkSystem.emit(eX,.5,eZ,nx*.05,.06,nz*.05,heavy?36:16,1,.65,.1,.45);
      // Sessie 02 V4 — sharp white-hot sparkles on top of the cloud burst
      // (sparkleSystem uses the spark texture with 4-spoke streaks for a
      // proper crash-pop). Twice as many on a heavy hit.
      if(sparkleSystem && sparkleSystem.emit){
        const _n = heavy ? 14 : 6;
        for(let _s=0;_s<_n;_s++){
          const _ang = Math.random()*Math.PI*2;
          const _sp  = 0.18 + Math.random()*0.22;
          sparkleSystem.emit(
            eX, 0.55+Math.random()*0.4, eZ,
            Math.cos(_ang)*_sp, 0.10+Math.random()*0.10, Math.sin(_ang)*_sp,
            1, 1.0, 0.85+Math.random()*0.15, 0.42+Math.random()*0.35, 0.42
          );
        }
      }
      // Float-text + popup are de-bounced via the global _contactPopupCD —
      // previously the heavy-contact branch fired floatText('💥 CONTACT!')
      // unconditionally every frame. Cars in close formation could bounce
      // 8-10 times during a single overtake → flickering popup spam (v3
      // issue 9). All visible feedback now shares the same cooldown gate.
      if(heavy){
        _colFlashT=0.42;
        // Phase 6 — CA spike op heavy hit. updateCaSpikeDecay in visuals.js
        // leest _caSpike, decayt exponentieel en multiplyt de atmosphere
        // caStrength uniform. Geeft korte chromatic-aberration burst die
        // visueel registreert "the world just got hit".
        window._caSpike = 1.0;
        // Hit-pause: 80ms slow-mo punch consumed by core/loop.js dt-scale.
        if(typeof _hitPauseTimer!=='undefined' && _hitPauseTimer<0.08)_hitPauseTimer=0.08;
        // Music-duck: dip to 40% over 500ms (audio/engine.js tweens).
        if(typeof _musicDuckTimer!=='undefined'){_musicDuckTarget=0.4;_musicDuckTimer=0.5;}
        if(_contactPopupCD<=0){
          // hitCount increment is gated by the cooldown so each burst of
          // contact-frames (cars locked side-by-side at >0.18 relSpd can
          // overlap 60×/s) registers as ONE hit. Without this gate the
          // ===3 / ===6 thresholds got jumped over silently AND _dmgMult
          // saturated within the first second of contact (physics.js:64).
          player.hitCount=(player.hitCount||0)+1;
          // Additional white impact sparks + float text on first heavy
          // contact within the cooldown window only.
          sparkSystem.emit(eX,.6,eZ,(Math.random()-.5)*.1,.1+Math.random()*.06,(Math.random()-.5)*.1,18,1,1,1,.7);
          floatText('💥 CONTACT!','#ff4400',innerWidth*.5,innerHeight*.45);
          if(player.hitCount===3)showPopup('⚠ DAMAGE!','#ff4400',1000);
          else if(player.hitCount===6)showPopup('🔥 CRITICAL DAMAGE!','#ff2200',1200);
          else showPopup('CONTACT! 💥','#ff4400',500);
          _contactPopupCD=3;
        }
      }else{
        if(_contactPopupCD<=0){showPopup('CONTACT! 💥','#ffcc00',400);_contactPopupCD=3;}
      }
    }
  }
}
