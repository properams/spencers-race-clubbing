// js/gameplay/spacefx.js — non-module script.

'use strict';

function spawnSpaceMeteor(){
  const m=_spaceMeteors.find(m=>!m.active);if(!m)return;
  // Random point on track
  const t=Math.random();
  const p=trackCurve.getPoint(t);
  const nr=trackCurve.getTangent(t).normalize();
  // Land within track width
  const offX=(Math.random()-.5)*TW*1.4,offZ=(Math.random()-.5)*TW*1.4;
  m.tx=p.x+offX;m.tz=p.z+offZ;
  m.mesh.position.set(m.tx,220+Math.random()*80,m.tz);
  m.mesh.visible=true;m.vy=-8;m.t=0;m.active=true;
  m.pl.intensity=3.0;m.pl.position.copy(m.mesh.position);
  // Warning popup
  floatText('☄ INCOMING!','#ff8800',innerWidth*.5,innerHeight*.35);
  if(audioCtx)beep(180,.5,.3,0,'sawtooth');
}


function triggerSpaceFall(car){
  if(car._fallingIntoSpace||recoverActive)return;
  car._fallingIntoSpace=true;
  car._fallTimer=0;
  car.inAir=true;
  // Give a small downward push
  if(car.vy>-2)car.vy=-2;
  if(_elWarn)_elWarn.style.display='none';
  if(_elWrongWay)_elWrongWay.style.display='none';
  _wrongWayTimer=0;
  showBanner('FALLING!','#ff3300',0); // 0 = keep until hidden
  playSpaceFallSound();
  floatText('⬇ FALLING!','#ff4400',innerWidth*.5,innerHeight*.4);
}


function triggerSpaceRecovery(car){
  car._fallingIntoSpace=false;
  car._fallTimer=0;
  recoverActive=true;recoverTimer=2.8;car.speed=0;car.vy=0;car.inAir=false;
  // Populate stuck-recovery trackers so the >5s hang-warn (tracklimits.js)
  // covers space-world recoveries too. typeof guards keep this resilient if
  // tracklimits.js is loaded out of order in a future refactor.
  if(typeof _tlRecoveryEntryT!=='undefined')_tlRecoveryEntryT=_nowSec;
  if(typeof _tlStuckRecoveryWarned!=='undefined')_tlStuckRecoveryWarned=false;
  hideBanner();
  // Tractor beam — position beam above recovery point
  const t=car.progress;
  const pt=trackCurve.getPoint(t);
  if(_spaceBeamMesh){
    _spaceBeamMesh.position.set(pt.x,pt.y+110,pt.z);
    _spaceBeamMesh.visible=true;
    _spaceBeamTimer=2.8;
  }
  // Teleport car back to track
  const tgR=trackCurve.getTangent(t).normalize();
  car.mesh.position.copy(pt);car.mesh.position.y=.35;
  car.mesh.rotation.set(0,Math.atan2(-tgR.x,-tgR.z),0);
  const off=new THREE.Vector3(0,5.8,13.5).applyQuaternion(car.mesh.quaternion);
  camPos.copy(car.mesh.position).add(off);
  camShake=0.8;
  showBanner('🛸 TRACTOR BEAM','#00ffcc',2600);
  playSpaceTractorSound();
  floatText('🛸 RETRIEVED','#00ffcc',innerWidth*.5,innerHeight*.45);
}


function playSpaceFallSound(){
  if(!audioCtx)return;
  // Descending wail
  const o=audioCtx.createOscillator();const g=audioCtx.createGain();
  o.type='sawtooth';o.frequency.setValueAtTime(320,audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(60,audioCtx.currentTime+1.4);
  g.gain.setValueAtTime(.28,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+1.6);
  o.connect(g);g.connect(_dst());o.start();o.stop(audioCtx.currentTime+1.6);
}

function playSpaceTractorSound(){
  if(!audioCtx)return;
  // Rising hum beam
  const o=audioCtx.createOscillator();const g=audioCtx.createGain();
  o.type='sine';o.frequency.setValueAtTime(80,audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(440,audioCtx.currentTime+1.0);
  g.gain.setValueAtTime(.0001,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.35,audioCtx.currentTime+.3);
  g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+2.4);
  o.connect(g);g.connect(_dst());o.start();o.stop(audioCtx.currentTime+2.6);
  // Add a high shimmer
  const o2=audioCtx.createOscillator();const g2=audioCtx.createGain();
  o2.type='sine';o2.frequency.setValueAtTime(880,audioCtx.currentTime+.1);
  o2.frequency.linearRampToValueAtTime(1760,audioCtx.currentTime+1.8);
  g2.gain.setValueAtTime(.0001,audioCtx.currentTime+.1);g2.gain.linearRampToValueAtTime(.15,audioCtx.currentTime+.5);
  g2.gain.linearRampToValueAtTime(.001,audioCtx.currentTime+2.6);
  o2.connect(g2);g2.connect(_dst());o2.start(audioCtx.currentTime+.1);o2.stop(audioCtx.currentTime+2.8);
}

function playSpaceRailgunSound(){
  if(!audioCtx)return;
  beep(120,.06,.35,0,'sawtooth');beep(240,.08,.3,.04,'sawtooth');
}


function playWorldEvent(type){
  if(window._rpp)_rpp.mark('hazard:event',{type:type});
  if(!audioCtx)return;
  var t=audioCtx.currentTime;
  if(type==='geiser'){
    var o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type='sawtooth';o.frequency.setValueAtTime(55,t);o.frequency.exponentialRampToValueAtTime(180,t+0.4);
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.35,t+0.1);g.gain.exponentialRampToValueAtTime(0.01,t+1.2);
    o.connect(g);g.connect(_dst());o.start(t);o.stop(t+1.3);
  }
  if(type==='emp'){
    var o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type='square';o.frequency.setValueAtTime(80,t);o.frequency.setValueAtTime(160,t+0.1);o.frequency.setValueAtTime(40,t+0.2);
    g.gain.setValueAtTime(0.25,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.5);
    o.connect(g);g.connect(_dst());o.start(t);o.stop(t+0.5);
  }
  if(type==='ice'){
    var o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type='sine';o.frequency.setValueAtTime(800,t);o.frequency.linearRampToValueAtTime(400,t+0.3);
    g.gain.setValueAtTime(0.12,t);g.gain.exponentialRampToValueAtTime(0.01,t+0.4);
    o.connect(g);g.connect(_dst());o.start(t);o.stop(t+0.4);
  }
  if(type==='lava'){
    _noise(.3,180,1.5,.3);
  }
}

// Firework palette table — hoisted out of _tpSpawnFirework so the
// burst-color pick doesn't allocate a 7-row matrix per spawn (~1 spawn/3s
// per firework burst, and the pool re-fill path below also reads it).
const _TP_FIREWORK_PALETTES=[[1,.3,.5],[1,.8,.2],[.3,.8,1],[.7,.4,1],[1,.6,.2],[1,.2,.8],[1,1,1]];
// Neon-paars only — used by the finish-screen fireworks so the celebration
// stays inside the same purple/magenta palette as the rest of the UI
// (no gold/cyan/orange leaks). _tpSpawnFirework() accepts an explicit
// palette via its `paletteOverride` argument.
const _TP_FIREWORK_PALETTES_NEON=[[.80,.53,1.0],[.64,.36,1.0],[.80,.27,1.0],[1.0,.27,.87],[1.0,.13,.67],[1.0,1.0,1.0]];

// Firework spawn re-uses an idle pool slot when one exists. _tpFireworks is
// appended-only across a race — finished bursts are flagged inactive
// (mesh.visible=false) instead of disposed, so the next spawn refills the
// existing geometry/material/PointLight in-place. Net per-spawn cost on a
// warmed pool: zero GPU buffer alloc, zero shader compile, zero scene.add.
//
// Pool memory drops back when world-switch fires _tpFireworks.length=0 in
// scene.js; disposeScene's traversal disposes the still-attached meshes.
function _tpSpawnFirework(paletteOverride){
  const PN=_mobCount(80);
  const cx=(Math.random()-.5)*520,cy=48+Math.random()*28,cz=(Math.random()-.5)*520;
  const _pal=paletteOverride||_TP_FIREWORK_PALETTES;
  const bc=_pal[Math.floor(Math.random()*_pal.length)];

  // Try to recycle an idle slot first (matches PN — geometry size is fixed
  // per device tier so recycle is always safe within a race).
  let slot=null;
  for(let i=0;i<_tpFireworks.length;i++){
    const fw=_tpFireworks[i];
    if(fw&&!fw.active&&fw.particleCount===PN){slot=fw;break;}
  }

  if(slot){
    // Re-fill in place. No new geo/mat/mesh/light — just refresh GPU buffers
    // and toggle visibility. Two-tone burst preserved: 70% main, 30% white.
    const pos=slot.geo.attributes.position.array;
    const col=slot.geo.attributes.color.array;
    const vel=slot.vel;
    for(let i=0;i<PN;i++){
      pos[i*3]=cx;pos[i*3+1]=cy;pos[i*3+2]=cz;
      const th=Math.random()*Math.PI*2,ph=Math.acos(2*Math.random()-1),s=7+Math.random()*6;
      vel[i*3]=Math.sin(ph)*Math.cos(th)*s;
      vel[i*3+1]=Math.cos(ph)*s;
      vel[i*3+2]=Math.sin(ph)*Math.sin(th)*s;
      if(Math.random()<.30){col[i*3]=1;col[i*3+1]=1;col[i*3+2]=1;}
      else{col[i*3]=bc[0];col[i*3+1]=bc[1];col[i*3+2]=bc[2];}
    }
    slot.geo.attributes.position.needsUpdate=true;
    slot.geo.attributes.color.needsUpdate=true;
    slot.mesh.material.opacity=1.0;
    slot.mesh.visible=true;
    if(slot.light){
      slot.light.color.setRGB(bc[0],bc[1],bc[2]);
      slot.light.position.set(cx,cy,cz);
      slot.light.intensity=3.5;
      slot.light.visible=true;
    }
    slot.age=0;slot.active=true;
    return;
  }

  // No reusable slot — allocate a fresh one and append to the pool.
  const geo=new THREE.BufferGeometry();
  const pos=new Float32Array(PN*3),vel=new Float32Array(PN*3),col=new Float32Array(PN*3);
  // Two-tone burst: 70% main color, 30% white sparks for hot center
  for(let i=0;i<PN;i++){
    pos[i*3]=cx;pos[i*3+1]=cy;pos[i*3+2]=cz;
    const th=Math.random()*Math.PI*2,ph=Math.acos(2*Math.random()-1),s=7+Math.random()*6;
    vel[i*3]=Math.sin(ph)*Math.cos(th)*s;
    vel[i*3+1]=Math.cos(ph)*s;
    vel[i*3+2]=Math.sin(ph)*Math.sin(th)*s;
    if(Math.random()<.30){col[i*3]=1;col[i*3+1]=1;col[i*3+2]=1;}
    else{col[i*3]=bc[0];col[i*3+1]=bc[1];col[i*3+2]=bc[2];}
  }
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  // AdditiveBlending + bloom = dramatic burst. Size up van 1.1 → 1.7.
  const mat=new THREE.PointsMaterial({vertexColors:true,size:1.7,transparent:true,opacity:1.0,sizeAttenuation:true,blending:THREE.AdditiveBlending,depthWrite:false});
  const mesh=new THREE.Points(geo,mat);scene.add(mesh);
  const pl=new THREE.PointLight(new THREE.Color(bc[0],bc[1],bc[2]),3.5,140);
  pl.position.set(cx,cy,cz);scene.add(pl);
  _tpFireworks.push({mesh:mesh,geo:geo,vel:vel,age:0,maxAge:1.9,light:pl,particleCount:PN,active:true});
}

