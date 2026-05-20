// js/effects/particles.js — Phase 8.3: sprite-based particles via
// InstancedMesh van PlaneGeometry met soft-cloud canvas texture.
// Non-module script. API behouden zodat alle call-sites onveranderd
// blijven: emit(x,y,z, vx,vy,vz, n, r,g,b, life).
//
// Eerdere implementatie: THREE.Points + per-particle size attribute.
// Visueel: harde dots, geen camera-bewegingrespons, looked retro.
// Nieuwe implementatie: InstancedMesh + radial-gradient cloud-tex +
// additive blending → soft puff-look met expansion-during-fade. API
// signature ongewijzigd — call-sites in tracklimits.js, physics.js,
// ramps.js, collectibles.js hoeven niet aangepast.
//
// Reuse: shared cloud texture via _sharedAsset flag (skipt disposeScene).

'use strict';

// Generic canvas-texture builder. paintFn(ctx, S) draws the texture
// into a transparent canvas. All textures share the _sharedAsset
// flag so disposeScene leaves them alone.
function _buildParticleTex(paintFn, S){
  S = S || 64;
  const c=document.createElement('canvas');
  c.width=S; c.height=S;
  const g=c.getContext('2d');
  paintFn(g, S);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  tex.userData = { _sharedAsset: true };
  return tex;
}

let _softCloudTex = null;
function _getSoftCloudTex(){
  if(_softCloudTex) return _softCloudTex;
  _softCloudTex = _buildParticleTex((g,S)=>{
    const grd=g.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2);
    grd.addColorStop(0.0,'rgba(255,255,255,1.0)');
    grd.addColorStop(0.4,'rgba(255,255,255,0.55)');
    grd.addColorStop(1.0,'rgba(255,255,255,0)');
    g.fillStyle=grd; g.fillRect(0,0,S,S);
  }, 64);
  return _softCloudTex;
}

// Tire-smoke / exhaust smoke — denser core, longer falloff than cloud.
let _smokeTex = null;
function _getSmokeTex(){
  if(_smokeTex) return _smokeTex;
  _smokeTex = _buildParticleTex((g,S)=>{
    const grd=g.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2);
    grd.addColorStop(0.0,'rgba(255,255,255,0.85)');
    grd.addColorStop(0.25,'rgba(255,255,255,0.55)');
    grd.addColorStop(0.6,'rgba(255,255,255,0.15)');
    grd.addColorStop(1.0,'rgba(255,255,255,0)');
    g.fillStyle=grd; g.fillRect(0,0,S,S);
    // Subtle noise overlay so the smoke doesn't look like a perfect disc.
    g.globalCompositeOperation='destination-in';
    for(let i=0;i<60;i++){
      const x=Math.random()*S, y=Math.random()*S, r=2+Math.random()*4;
      const lg=g.createRadialGradient(x,y,0,x,y,r);
      lg.addColorStop(0,'rgba(0,0,0,0)');
      lg.addColorStop(1,'rgba(0,0,0,0.04)');
      g.fillStyle=lg; g.fillRect(x-r,y-r,r*2,r*2);
    }
    g.globalCompositeOperation='source-over';
  }, 64);
  return _smokeTex;
}

// Sharp spark/flare — small white-hot core with quick fade.
let _sparkTex = null;
function _getSparkTex(){
  if(_sparkTex) return _sparkTex;
  _sparkTex = _buildParticleTex((g,S)=>{
    const grd=g.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2);
    grd.addColorStop(0.0,'rgba(255,255,255,1.0)');
    grd.addColorStop(0.15,'rgba(255,255,255,0.85)');
    grd.addColorStop(0.45,'rgba(255,255,255,0.25)');
    grd.addColorStop(1.0,'rgba(255,255,255,0)');
    g.fillStyle=grd; g.fillRect(0,0,S,S);
    // 4-spoke star streaks for that pop-and-flare feel.
    g.globalCompositeOperation='lighter';
    g.strokeStyle='rgba(255,255,255,0.35)';
    g.lineWidth=2;
    g.beginPath();
    g.moveTo(S/2,4);     g.lineTo(S/2,S-4);
    g.moveTo(4,S/2);     g.lineTo(S-4,S/2);
    g.stroke();
    g.globalCompositeOperation='source-over';
  }, 32);
  return _sparkTex;
}

// Warm-brown grainy dust — for sandstorm devils, exhaust dust, road grit.
let _dustTex = null;
function _getDustTex(){
  if(_dustTex) return _dustTex;
  _dustTex = _buildParticleTex((g,S)=>{
    const grd=g.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2);
    grd.addColorStop(0.0,'rgba(255,255,255,0.75)');
    grd.addColorStop(0.5,'rgba(255,255,255,0.25)');
    grd.addColorStop(1.0,'rgba(255,255,255,0)');
    g.fillStyle=grd; g.fillRect(0,0,S,S);
    // Grain — 80 little pinpricks for texture
    for(let i=0;i<80;i++){
      const x=Math.random()*S, y=Math.random()*S;
      const a=Math.random()*0.18;
      g.fillStyle='rgba(255,255,255,'+a+')';
      g.fillRect(x,y,1,1);
    }
  }, 64);
  return _dustTex;
}

// Public registry — exposed so call-sites can pick a texture-kind
// when constructing a SimpleParticles instance.
const PARTICLE_TEX = {
  cloud: _getSoftCloudTex,
  smoke: _getSmokeTex,
  spark: _getSparkTex,
  dust:  _getDustTex
};
if(typeof window!=='undefined')window.PARTICLE_TEX = PARTICLE_TEX;

class SimpleParticles{
  constructor(maxP, scene, opts){
    opts = opts || {};
    this.max = maxP;
    this.alive = [];
    const kind = opts.kind || 'cloud';
    const texFn = (PARTICLE_TEX && PARTICLE_TEX[kind]) || _getSoftCloudTex;
    const planeSize = opts.size || 0.6;
    // gravity: per-frame vy decay (was hard-coded 0.008). Smoke wants
    // a gentle upward drift; sparks fall faster than cloud.
    this.gravity = (opts.gravity != null) ? opts.gravity : 0.008;
    // growthRate: scale grows from `growthBase` to `growthBase+growthRate`
    // as the particle lives out. Smoke expands, sparks shrink.
    this.growthBase = (opts.growthBase != null) ? opts.growthBase : 0.6;
    this.growthRate = (opts.growthRate != null) ? opts.growthRate : 1.2;
    const geo = new THREE.PlaneGeometry(planeSize, planeSize);
    const mat = new THREE.MeshBasicMaterial({
      map: texFn(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, maxP);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    // Per-instance color via instanceColor BufferAttribute. Three.js
    // r134 ondersteunt InstancedMesh.setColorAt → instanceColor.
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(maxP * 3), 3
    );
    scene.add(this.mesh);
    // Scratch — voorkomt per-frame allocation
    this._m = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }
  emit(x,y,z,vx,vy,vz,n,r,g,b,life){
    if(life == null) life = 0.6;
    for(let i=0; i<n && this.alive.length<this.max; i++){
      this.alive.push({
        x, y, z,
        vx: vx + (Math.random()-0.5)*0.15,
        vy: vy + Math.random()*0.1,
        vz: vz + (Math.random()-0.5)*0.15,
        r, g, b,
        life, maxL: life
      });
    }
  }
  update(dt){
    // In-place removal: swap dead particles to end.
    let n = this.alive.length;
    for(let i = n - 1; i >= 0; i--){
      const p = this.alive[i];
      p.life -= dt / p.maxL;
      if(p.life <= 0){
        const swapIdx = --n;
        this.alive[i] = this.alive[swapIdx];
        this.alive.length = n;
      } else {
        // Physics step
        p.x += p.vx; p.y += p.vy; p.z += p.vz;
        p.vy -= this.gravity;
      }
    }
    // Update InstancedMesh — single .count flip + per-instance matrix/color
    this.mesh.count = this.alive.length;
    if(this.alive.length === 0) return;
    for(let i = 0; i < this.alive.length; i++){
      const p = this.alive[i];
      // life: 1.0 (just emitted) → 0.0 (about to die)
      // Particles scale linearly between growthBase and growthBase+growthRate.
      // Default (cloud): 0.6 → 1.8 (expand). Sparks set growthRate<0 (shrink).
      const scale = this.growthBase + (1.0 - p.life) * this.growthRate;
      this._v.set(p.x, p.y, p.z);
      this._q.set(0, 0, 0, 1);
      this._s.set(scale, scale, scale);
      this._m.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      // Modulate color by life so alpha fades along with size growth.
      // Additive blending → multiplying RGB by lifeFrac creates fade-out.
      this._c.setRGB(p.r * p.life, p.g * p.life, p.b * p.life);
      this.mesh.setColorAt(i, this._c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if(this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// Sessie 02 V3 — ambient world FX emitter. Spawns a few particles per
// frame near the player camera using the right pool + tint for the
// current world. Throttled to keep each pool well under its `alive`
// cap. Called from core/loop.js once per RACE frame.
let _ambientFxAccum = 0;
function emitAmbientWorldFX(dt){
  if(typeof carObjs==='undefined' || !carObjs.length) return;
  if(typeof playerIdx==='undefined') return;
  const pCar = carObjs[playerIdx]; if(!pCar||!pCar.mesh) return;
  _ambientFxAccum += dt;
  // 12Hz tick — enough motion to feel alive, low GC churn.
  if(_ambientFxAccum < 0.083) return;
  _ambientFxAccum = 0;
  const px = pCar.mesh.position.x, pz = pCar.mesh.position.z;
  const world = (typeof activeWorld!=='undefined') ? activeWorld : '';
  const _r = () => (Math.random()-0.5);
  switch(world){
    case 'sandstorm': {
      // Warm dust drift sideways across the player — picks up wind.
      if(!dustSystem||!dustSystem.emit) return;
      const ox = px + _r()*60 - 12, oz = pz + _r()*60 - 12;
      dustSystem.emit(
        ox, 0.6+Math.random()*2.4, oz,
        0.18+Math.random()*0.12, 0.005+Math.random()*0.01, _r()*0.05,
        2, 0.78, 0.62, 0.42, 1.6
      );
      break;
    }
    case 'arctic': {
      // Cold blue snow gust — short-lived, low gravity.
      if(!dustSystem||!dustSystem.emit) return;
      const ox = px + _r()*55, oz = pz + _r()*55;
      dustSystem.emit(
        ox, 1.0+Math.random()*3.2, oz,
        _r()*0.06, 0.005+Math.random()*0.012, _r()*0.06,
        2, 0.78, 0.86, 1.0, 1.0
      );
      break;
    }
    case 'volcano': {
      // Orange embers rising — sparkleSystem (sharp), warm tint.
      if(!sparkleSystem||!sparkleSystem.emit) return;
      const ox = px + _r()*70, oz = pz + _r()*70;
      sparkleSystem.emit(
        ox, 0.3+Math.random()*0.8, oz,
        _r()*0.04, 0.06+Math.random()*0.05, _r()*0.04,
        2, 1.0, 0.42, 0.10, 1.2
      );
      break;
    }
    case 'candy': {
      // Cotton-wisp puffs — soft cloud, pastel pink.
      if(!smokeSystem||!smokeSystem.emit) return;
      const ox = px + _r()*65, oz = pz + _r()*65;
      smokeSystem.emit(
        ox, 1.8+Math.random()*2.4, oz,
        _r()*0.03, 0.004+Math.random()*0.008, _r()*0.03,
        1, 1.0, 0.78, 0.92, 2.0
      );
      break;
    }
    case 'space': {
      // Cold blue dust motes — slow drift, neutral gravity.
      if(!dustSystem||!dustSystem.emit) return;
      const ox = px + _r()*80, oz = pz + _r()*80;
      dustSystem.emit(
        ox, 2.0+Math.random()*4.0, oz,
        _r()*0.04, _r()*0.03, _r()*0.04,
        1, 0.65, 0.78, 1.0, 1.8
      );
      break;
    }
    case 'deepsea': {
      // Bubble streams — soft cloud, cyan tint, rises.
      if(!smokeSystem||!smokeSystem.emit) return;
      const ox = px + _r()*55, oz = pz + _r()*55;
      smokeSystem.emit(
        ox, 0.3+Math.random()*1.0, oz,
        _r()*0.02, 0.05+Math.random()*0.04, _r()*0.02,
        1, 0.55, 0.92, 1.0, 1.4
      );
      break;
    }
    case 'pier47':
    case 'guangzhou': {
      // Light atmospheric steam/fog wisps — only every ~3rd tick to keep
      // the night-world frame cost low (these already do bloom-heavy work).
      if(Math.random()>0.4) return;
      if(!smokeSystem||!smokeSystem.emit) return;
      const ox = px + _r()*45, oz = pz + _r()*45;
      smokeSystem.emit(
        ox, 0.4+Math.random()*1.4, oz,
        _r()*0.04, 0.02+Math.random()*0.03, _r()*0.04,
        1, 0.55, 0.55, 0.65, 1.6
      );
      break;
    }
  }
}
if(typeof window!=='undefined')window.emitAmbientWorldFX = emitAmbientWorldFX;
