// js/effects/finish-celebration.js — Phase 13D: per-world finish-line
// celebration FX. Triggered when race ends. Pure procedural — geen new
// assets. Non-module script.
//
// API:
//   playFinishCelebration(worldId, position) — spawn burst at position
//
// Pattern: shared per-color InstancedMesh confetti pool, lifetimer-based.
// Pool max 60 desktop / 30 mobile particles in flight tegelijk.
// renderOrder=10 zodat ze BOVEN bloom-layer renderen (vermijd
// transparency-sort issue met bestaande bloom particles).

'use strict';

const _CONFETTI_MAX = (typeof window !== 'undefined' && window._isMobile) ? 30 : 60;
// Module-scope scratch matrices for updateFinishCelebration — previously
// allocated each frame inside the function (5 Three.js objects per frame
// while a finish burst is alive). Lifted to scope per the particles.js
// pattern (js/effects/particles.js:60-64).
const _fcScratchM4 = new THREE.Matrix4();
const _fcScratchV  = new THREE.Vector3();
const _fcScratchQ  = new THREE.Quaternion();
const _fcScratchE  = new THREE.Euler();
const _fcScratchSV = new THREE.Vector3();
let _confettiSystem = null;       // {ims: [], data: [...], pool: free indices}
let _confettiInitialised = false;

// Per-world palette (6 colors per world)
const _PALETTES = {
  candy:     [0xff44aa, 0xffee44, 0x22ccff, 0xc77dff, 0xff8844, 0xa3e056],
  gp:        [0xffffff, 0x222222, 0xffffff, 0x222222, 0xffcc00, 0xcc2200],
  volcano:   [0xff5500, 0xff2200, 0xff8800, 0xffcc00, 0xffdd44, 0xff6622],
  pier47:    [0xffcc77, 0xffaa44, 0xff8833, 0xffd088, 0xff6622, 0xffbb55],
  arctic:    [0xaaddff, 0xffffff, 0xccddff, 0xbbeeff, 0xccffff, 0xddffff],
  deepsea:   [0x00ffcc, 0x44ddff, 0xaaeeff, 0x88ffdd, 0x00ddaa, 0x44eebb],
  space:     [0xaaaaff, 0xff66ff, 0x66ffff, 0xffaaff, 0xaaffff, 0xccaaff],
  sandstorm: [0xddb97a, 0xffcc88, 0xc49066, 0xffd4a0, 0xee9966, 0xff8844],
  guangzhou: [0xff00aa, 0x00ffee, 0xffff00, 0xff6600, 0x44aaff, 0xff44aa]
};

function _initConfettiSystem(){
  if(_confettiInitialised) return;
  if(typeof scene === 'undefined' || !scene) return;
  _confettiInitialised = true;
  // Build 6 IM (one per palette color slot). Each holds up to _CONFETTI_MAX/6 instances
  const perSlot = Math.ceil(_CONFETTI_MAX/6);
  const geo = new THREE.PlaneGeometry(0.3, 0.3);
  _confettiSystem = { ims: [], data: [], freeIdx: [] };
  for(let s=0;s<6;s++){
    const mat = new THREE.MeshBasicMaterial({
      color:0xffffff, side:THREE.DoubleSide,
      transparent:true, opacity:0,  // start invisible
      depthWrite:false
    });
    const im = new THREE.InstancedMesh(geo, mat, perSlot);
    im.userData = {_noLodCull:true};
    im.renderOrder = 10;
    im.frustumCulled = false;
    // Initialise all instances offscreen (scale=0)
    const m4 = new THREE.Matrix4();
    const z = new THREE.Vector3(0,0,0);
    const q = new THREE.Quaternion();
    const s0 = new THREE.Vector3(0,0,0);
    for(let i=0;i<perSlot;i++){
      m4.compose(z, q, s0);
      im.setMatrixAt(i, m4);
      _confettiSystem.data.push({active:false, slot:s, idx:i, x:0, y:0, z:0, vx:0, vy:0, vz:0, spin:0, ang:0, life:0, maxLife:1});
      _confettiSystem.freeIdx.push(s*perSlot + i);
    }
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    _confettiSystem.ims.push(im);
  }
}

function playFinishCelebration(worldId, position){
  _initConfettiSystem();
  if(!_confettiSystem) return;
  const pal = _PALETTES[worldId] || _PALETTES.candy;
  // Update each IM's color to its palette slot
  for(let s=0;s<6;s++){
    if(_confettiSystem.ims[s] && _confettiSystem.ims[s].material){
      _confettiSystem.ims[s].material.color.setHex(pal[s]);
      _confettiSystem.ims[s].material.opacity = 1.0;
    }
  }
  // Burst N particles in a sphere around position
  const burst = _CONFETTI_MAX;
  const px = position ? position.x : 0;
  const py = position ? position.y : 0;
  const pz = position ? position.z : 0;
  for(let i=0;i<burst && _confettiSystem.freeIdx.length;i++){
    const flatIdx = _confettiSystem.freeIdx.pop();
    const d = _confettiSystem.data[flatIdx];
    if(!d) continue;
    d.active = true;
    d.x = px + (Math.random()-0.5)*1.5;
    d.y = py + 1.5 + Math.random()*1.5;
    d.z = pz + (Math.random()-0.5)*1.5;
    // Outward velocity
    const ang = Math.random()*Math.PI*2;
    const spd = 4 + Math.random()*6;
    d.vx = Math.cos(ang) * spd;
    d.vy = 5 + Math.random()*6;
    d.vz = Math.sin(ang) * spd;
    d.spin = (Math.random()-0.5)*8;
    d.ang = Math.random()*Math.PI*2;
    d.life = 2.0;
    d.maxLife = 2.0;
  }
}

function updateFinishCelebration(dt){
  if(!_confettiSystem || !_confettiInitialised) return;
  const m4 = _fcScratchM4;
  const v  = _fcScratchV;
  const q  = _fcScratchQ;
  const e  = _fcScratchE;
  const sv = _fcScratchSV;
  const dirty = [false,false,false,false,false,false];
  for(let k=0;k<_confettiSystem.data.length;k++){
    const d = _confettiSystem.data[k];
    if(!d.active) continue;
    d.life -= dt;
    if(d.life <= 0){
      d.active = false;
      sv.set(0,0,0);
      v.set(0,-100,0);
      e.set(0,0,0);
      q.setFromEuler(e);
      m4.compose(v, q, sv);
      _confettiSystem.ims[d.slot].setMatrixAt(d.idx, m4);
      _confettiSystem.freeIdx.push(d.slot * Math.ceil(_CONFETTI_MAX/6) + d.idx);
      dirty[d.slot] = true;
      continue;
    }
    // Physics: gravity + damping
    d.vy -= 9.8 * dt;
    d.vx *= 0.94;
    d.vz *= 0.94;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.z += d.vz * dt;
    d.ang += d.spin * dt;
    // Compose matrix
    const fade = d.life / d.maxLife;
    sv.set(0.3*fade + 0.7, 0.3*fade + 0.7, 1);
    v.set(d.x, d.y, d.z);
    e.set(d.ang*0.7, d.ang, 0);
    q.setFromEuler(e);
    m4.compose(v, q, sv);
    _confettiSystem.ims[d.slot].setMatrixAt(d.idx, m4);
    dirty[d.slot] = true;
  }
  for(let s=0;s<6;s++){
    if(dirty[s] && _confettiSystem.ims[s]){
      _confettiSystem.ims[s].instanceMatrix.needsUpdate = true;
    }
  }
}

// Expose globally for finish-line + loop integration
if(typeof window !== 'undefined'){
  window.playFinishCelebration = playFinishCelebration;
  window.updateFinishCelebration = updateFinishCelebration;
}
