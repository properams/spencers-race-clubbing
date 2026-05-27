// js/worlds/space.js — space world builders + update + collision checks
// Non-module script.

'use strict';

// Per-world state (uit main.js verhuisd) — gereset in core/scene.js buildScene().
let _spaceAsteroids=[];
let _spaceDebrisIM=null;   // InstancedMesh for void debris rocks (was 55 individual meshes pre-2026-05-14)
let _spaceDebrisData=[];   // per-instance {px,py,pz, rx,ry,rz, rsx,rsy,rsz, scale}
// Phase 10.4 — electric arcs between asteroids
let _spaceArcs=[];
let _spaceArcNext=0;
let _spaceArcMatProto=null;  // lazy-init shared LineBasicMaterial
let _spaceDustGeo=null,_spaceDustParticles=null;
let _spaceGravityWells=[];
let _spaceRailguns=[];
let _spaceUFOs=[];
let _spaceMeteors=[];
let _spaceMeteorTimer=18;
let _spaceBeamMesh=null,_spaceBeamTimer=0;
let _spaceUnderglow=[];
let _spaceFrame=0; // per-frame counter for mobile staggering
// var (niet const) — script-globaal voor cross-script reset in core/scene.js.
var _wpGravityZones=[],_wpOrbitAsteroids=[],_wpWarpTunnels=[];

// ── Solid-volume PBR helper ──────────────────────────────────────────────
//
// Proef-conversie (Space-specifiek): solid-volume props krijgen op
// desktop een MeshStandardMaterial met envTag 'cosmic-rock' of
// 'cosmic-metal' zodat ze IBL-reflectie pakken. Mobile blijft Lambert
// om PBR-shader-kosten te vermijden op LOW-tier waar de reflection probe
// toch uit staat. Glow-laag (warp tunnels, gravity wells, neon strips,
// gates, railguns, beams, orb, meteor, UFO dome+ring, anomaly halo) gaat
// hier NIET doorheen — die blijven Lambert.
//
// Usage:
//   const mat = _spMat({color:0x665544}, {metalness:0.0, roughness:0.88}, 'cosmic-rock');
function _spMat(lambertDef, stdExtras, tag){
  const _gocm = window._sharedMat && window._sharedMat.getOrCreate;
  if(_gocm){
    const key='space/'+(tag||'untagged')+'#'+(window._isMobile?'L':'S')+'#'+JSON.stringify(lambertDef||{})+'#'+JSON.stringify(stdExtras||{});
    return _gocm(key, function(){
      if(window._isMobile) return new THREE.MeshLambertMaterial(lambertDef);
      const mat = new THREE.MeshStandardMaterial(Object.assign({}, lambertDef, stdExtras));
      mat.userData = mat.userData || {};
      mat.userData.envTag = tag;
      return mat;
    });
  }
  if(window._isMobile) return new THREE.MeshLambertMaterial(lambertDef);
  const mat = new THREE.MeshStandardMaterial(Object.assign({}, lambertDef, stdExtras));
  mat.userData = mat.userData || {};
  mat.userData.envTag = tag;
  return mat;
}

function buildGravityZones(){
  const defs=[{t:.15},{t:.47},{t:.73}];
  const _gocm = window._sharedMat && window._sharedMat.getOrCreate;
  const padMat = _gocm
    ? _gocm('space/gravity/pad', ()=> new THREE.MeshLambertMaterial({color:0x8800ff,emissive:0x5500cc,emissiveIntensity:1.2,transparent:true,opacity:.7}))
    : null;
  const arrMat = _gocm
    ? _gocm('space/gravity/arr', ()=> new THREE.MeshLambertMaterial({color:0xff44ff,emissive:0xcc00cc,emissiveIntensity:1.5}))
    : null;
  defs.forEach(def=>{
    const p=trackCurve.getPoint(def.t).clone();
    // Glowing hexagonal pad on track
    const pad=new THREE.Mesh(new THREE.CylinderGeometry(6,6,.08,6),
      padMat || new THREE.MeshLambertMaterial({color:0x8800ff,emissive:0x5500cc,emissiveIntensity:1.2,transparent:true,opacity:.7}));
    pad.position.copy(p);pad.position.y=.025;scene.add(pad);
    // Arrow ring floating above
    const arr=new THREE.Mesh(new THREE.TorusGeometry(4,.15,6,24),
      arrMat || new THREE.MeshLambertMaterial({color:0xff44ff,emissive:0xcc00cc,emissiveIntensity:1.5}));
    arr.rotation.x=Math.PI/2;arr.position.copy(p);arr.position.y=1.8;scene.add(arr);
    // WARNING text sprite
    const cvs=document.createElement('canvas');cvs.width=256;cvs.height=40;
    const ctx=cvs.getContext('2d');ctx.fillStyle='#220044';ctx.fillRect(0,0,256,40);
    ctx.font='bold 18px Orbitron,Arial';ctx.fillStyle='#ff88ff';ctx.textAlign='center';
    ctx.fillText('GRAVITY ZONE',128,27);
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cvs),transparent:true}));
    sp.position.copy(p);sp.position.y=3.8;sp.scale.set(12,2,1);scene.add(sp);
    _wpGravityZones.push({pos:p.clone(),radius:6,pad,arr,inside:false});
  });
}

// Entry-edge trigger: a parked car inside the zone used to re-launch every
// cooldown cycle (~4s), causing landing camShake to tremble the screen at
// idle. Hysteresis (1.15× exit radius) avoids chattering on the boundary;
// speed gate mirrors checkWarpTunnels so a stopped car can never trip it.
function checkGravityZones(dt){
  const car=carObjs[playerIdx];
  _wpGravityZones.forEach(gz=>{
    const d=car.mesh.position.distanceTo(gz.pos);
    if(gz.inside){
      if(d>gz.radius*1.15)gz.inside=false;
    }else if(d<gz.radius&&!car.inAir&&Math.abs(car.speed)>0.1){
      car.vy=(car.vy||0)+6; // launch upward
      car.inAir=true;
      showPopup('🚀 ZERO-G ZONE!','#ff88ff',600);
      gz.inside=true;
    }
  });
}


function buildOrbitingAsteroids(){
  const defs=[{t:.23,r:9,speed:.4},{t:.55,r:11,speed:-.35},{t:.85,r:8,speed:.5}];
  const _gocm = window._sharedMat && window._sharedMat.getOrCreate;
  const dustMat = _gocm
    ? _gocm('space/asteroid/dust', ()=> new THREE.MeshBasicMaterial({color:0x443322,transparent:true,opacity:.25}))
    : null;
  defs.forEach(def=>{
    const centre=trackCurve.getPoint(def.t).clone();centre.y=1.0;
    // Rocky asteroid (irregular sphere)
    const geo=new THREE.DodecahedronGeometry(2.2,0);
    // Randomly jitter vertices for rockiness
    const posAttr=geo.attributes.position;
    for(let i=0;i<posAttr.count;i++){
      posAttr.setXYZ(i,posAttr.getX(i)*(0.75+Math.random()*.5),posAttr.getY(i)*(0.75+Math.random()*.5),posAttr.getZ(i)*(0.75+Math.random()*.5));
    }
    geo.computeVertexNormals();
    const rock=new THREE.Mesh(geo,_spMat({color:0x665544},{metalness:0.0,roughness:0.88},'cosmic-rock'));
    rock.position.copy(centre).addScaledVector(new THREE.Vector3(1,0,0),def.r);
    scene.add(rock);
    // Small dust halo (torus)
    const dust=new THREE.Mesh(new THREE.TorusGeometry(def.r,.25,4,32),
      dustMat || new THREE.MeshBasicMaterial({color:0x443322,transparent:true,opacity:.25}));
    dust.rotation.x=Math.PI/2;dust.position.copy(centre);scene.add(dust);
    _wpOrbitAsteroids.push({centre:centre.clone(),rock,orbitR:def.r,speed:def.speed,angle:Math.random()*Math.PI*2,radius:2.8,cooldown:0});
  });
}

function checkOrbitingAsteroids(dt){
  const car=carObjs[playerIdx];
  _wpOrbitAsteroids.forEach(ast=>{
    // Orbit update
    ast.angle+=ast.speed*dt;
    ast.rock.position.set(ast.centre.x+Math.cos(ast.angle)*ast.orbitR,ast.centre.y,ast.centre.z+Math.sin(ast.angle)*ast.orbitR);
    ast.rock.rotation.y+=dt*.4;ast.rock.rotation.x+=dt*.2;
    // Collision with player
    ast.cooldown=Math.max(0,ast.cooldown-dt);
    const d=car.mesh.position.distanceTo(ast.rock.position);
    if(d<ast.radius+1.5&&ast.cooldown<=0){
      car.speed*=.35;car.yawVel=(Math.random()-.5)*3.5;
      showPopup('☄️ ASTEROID HIT!','#ff8844',700);ast.cooldown=2;
    }
  });
}


function buildWarpTunnels(){
  const defs=[{t:.38},{t:.77}];
  const _gocm = window._sharedMat && window._sharedMat.getOrCreate;
  // Eén ring/strip/gnd-materiaal gedeeld over alle tunnels + ring-instances.
  // ringMat.clone() per ring was overerfd preventief; geen runtime mutation
  // op ring.material in checkWarpTunnels of elders → veilig om te delen.
  const ringMat = _gocm
    ? _gocm('space/warp/ring', ()=> new THREE.MeshLambertMaterial({color:0x4400aa,emissive:0x2200bb,emissiveIntensity:1.8}))
    : new THREE.MeshLambertMaterial({color:0x4400aa,emissive:0x2200bb,emissiveIntensity:1.8});
  const stripMat = _gocm
    ? _gocm('space/warp/strip', ()=> new THREE.MeshLambertMaterial({color:0x6622cc,emissive:0x4411aa,emissiveIntensity:1.2,transparent:true,opacity:.6}))
    : new THREE.MeshLambertMaterial({color:0x6622cc,emissive:0x4411aa,emissiveIntensity:1.2,transparent:true,opacity:.6});
  const gndMat = _gocm
    ? _gocm('space/warp/gnd', ()=> new THREE.MeshLambertMaterial({color:0x8833ff,emissive:0x5511dd,transparent:true,opacity:.4}))
    : new THREE.MeshLambertMaterial({color:0x8833ff,emissive:0x5511dd,transparent:true,opacity:.4});
  defs.forEach(def=>{
    const p=trackCurve.getPoint(def.t),tg=trackCurve.getTangent(def.t).normalize();
    const angle=Math.atan2(tg.x,tg.z);
    // Tunnel arch (two rings + connecting bars). Geen ringMat.clone() meer
    // — alle ringen delen één materiaal (geen per-ring mutation).
    [-5,5].forEach(oz=>{
      const ring=new THREE.Mesh(new THREE.TorusGeometry(TW+2,.55,8,24),ringMat);
      ring.position.copy(p).addScaledVector(tg,oz);ring.position.y=TW+1.8;
      ring.rotation.y=angle;ring.rotation.x=Math.PI/2;scene.add(ring);
    });
    // Connecting strips along the sides and top
    for(let i=0;i<6;i++){
      const ang=(i/6)*Math.PI; // top half arch
      const bar=new THREE.Mesh(new THREE.BoxGeometry(.25,10.5,.3),stripMat);
      bar.position.copy(p);
      bar.position.x+=Math.cos(ang+Math.PI/2)*(TW+1.8)*Math.cos(angle)-Math.sin(ang+Math.PI/2)*(TW+1.8)*Math.sin(angle);
      bar.position.z+=Math.cos(ang+Math.PI/2)*(TW+1.8)*Math.sin(angle)+Math.sin(ang+Math.PI/2)*(TW+1.8)*Math.cos(angle);
      bar.position.y=TW+1.8;bar.rotation.y=angle;
      scene.add(bar);
    }
    // Glowing ground panel
    const gnd=new THREE.Mesh(new THREE.PlaneGeometry(TW*1.8,10), gndMat);
    gnd.rotation.x=-Math.PI/2;gnd.position.copy(p);gnd.position.y=.02;gnd.rotation.y=angle;scene.add(gnd);
    _wpWarpTunnels.push({pos:p.clone(),tg:tg.clone(),radius:TW*.85,len:10,cooldown:0});
  });
}

function checkWarpTunnels(dt){
  const car=carObjs[playerIdx];
  _wpWarpTunnels.forEach(wt=>{
    wt.cooldown=Math.max(0,wt.cooldown-dt);
    const d=car.mesh.position.distanceTo(wt.pos);
    if(d<wt.radius+4&&wt.cooldown<=0&&car.speed>0.1){
      car.speed=Math.min(car.speed*1.12,car.def.topSpd*1.08); // significant boost cap
      showPopup('⚡ WARP SPEED!','#cc66ff',600);wt.cooldown=5;
    }
  });
}


function buildSpaceEnvironment(){
  // Weather reset — vacuum has no rain. Clear leaked rain state from a previous
  // world or the title-screen toggle. The 'meteor shower' weather mode reuses
  // the rain-canvas intentionally via setWeather('storm'); it re-enables rain
  // there when activated, so this build-time reset doesn't break it.
  if(typeof isRain!=='undefined'&&isRain){
    isRain=false;
    if(typeof _rainTarget!=='undefined')_rainTarget=0;
    if(typeof _rainIntensity!=='undefined')_rainIntensity=0;
    if(rainCanvas)rainCanvas.style.display='none';
  }
  // Cold-start instrumentatie: mark elke top-level build-helper. Naming
  // convention build:world:space:<helper>:start/end. Helper-namen identiek
  // aan functie-namen zodat een longtask near-mark direct naar de juiste
  // helper wijst. Allemaal geguard via window.perfMark (no-op zonder dbg).
  const _M = (label, fn) => {
    if (!window.perfMark) { fn(); return; }
    const s = 'build:world:space:'+label+':start';
    const e = 'build:world:space:'+label+':end';
    perfMark(s);
    try { fn(); }
    finally { perfMark(e); perfMeasure('build.world.space.'+label, s, e); }
  };
  _M('void', buildSpaceVoid);          // replaces ground — empty abyss
  _M('stars', buildSpaceStars);
  _M('planets', buildSpacePlanets);
  _M('nebula', buildNebula);           // Canvas 256×256
  _M('trackPlatform', buildSpaceTrackPlatform); // underkant + vertical rails + underglow
  _M('trackEdges', buildSpaceTrackEdges);
  _M('orbs', buildSpaceOrbs);
  _M('station', buildSpaceStation);    // Canvas 512×64
  _M('gate', buildSpaceGate);
  _M('barriers', buildSpaceBarriers);
  _M('dust', buildSpaceDust);
  _M('gravityWells', buildSpaceGravityWells);
  _M('railguns', buildSpaceRailguns);
  _M('ufos', buildSpaceUFOs);          // nested loops
  _M('meteorSystem', buildSpaceMeteorSystem);
  _M('tractorBeam', buildSpaceTractorBeam);
  // Car headlights (same hardware as GP)
  plHeadL=new THREE.SpotLight(0xffffff,0,50,Math.PI*.16,.5);
  plHeadR=new THREE.SpotLight(0xffffff,0,50,Math.PI*.16,.5);
  scene.add(plHeadL);scene.add(plHeadL.target);scene.add(plHeadR);scene.add(plHeadR.target);
  plTail=new THREE.PointLight(0xff2200,0,10);scene.add(plTail);
  // GLTF space props — three layers: floating asteroids, surface
  // craters, and dramatic satellite dishes high above the track.
  if(window.perfMark)perfMark('build:world:space:roadsideProps:start');
  if(window.spawnRoadsideProps){
    // Floating asteroids — varied y-heights so they don't glue to y=0.
    // Density bumped 2026-05-09 to fill the 8-25u side-of-track zone the
    // audit flagged as schraal alongside craters/satellites.
    window.spawnRoadsideProps('space',{
      propKeys:['asteroid_small','asteroid_large'],
      count:_mobCount(14), sizeHint:2.4, clusterSize:2,
      offsetMin: BARRIER_OFF + 6, offsetMax: BARRIER_OFF + 25,
      yOffsetMin: 1, yOffsetMax: 6,
    });
    // Tighter low-rock cluster at the immediate barrier-edge (5-14u out)
    // so the player sees rubble whoosh by during the curve, not just
    // distant asteroid silhouettes. Small props only — keeps fillrate
    // budget on mobile.
    window.spawnRoadsideProps('space',{
      propKeys:['asteroid_small'],
      count:_mobCount(10), sizeHint:1.2, clusterSize:2,
      offsetMin: BARRIER_OFF + 5, offsetMax: BARRIER_OFF + 14,
      yOffsetMin: 0, yOffsetMax: 2,
    });
    // Distant asteroid belt — bigger debris higher and farther away.
    // Replaces the legacy inline buildAsteroids() proc-mesh path so all
    // space rocks now flow through the asset-bridge GLTF pipeline.
    window.spawnRoadsideProps('space',{
      propKeys:['asteroid_small','asteroid_large'],
      count:_mobCount(25), sizeHint:5.0, clusterSize:1,
      offsetMin: BARRIER_OFF + 20, offsetMax: BARRIER_OFF + 60,
      yOffsetMin: 6, yOffsetMax: 28,
    });
    // Craters embedded near surface level — like the track is on a
    // pitted lunar/asteroid surface. Skip on mobile.
    if (!window._isMobile){
      window.spawnRoadsideProps('space',{
        propKeys:['crater'],
        count:6, sizeHint:5.0, clusterSize:1,
        offsetMin: BARRIER_OFF + 4, offsetMax: BARRIER_OFF + 18,
        yOffsetMin: -0.3, yOffsetMax: 0,
      });
      // Satellite dishes set further back, elevated like signal towers.
      window.spawnRoadsideProps('space',{
        propKeys:['satellite'],
        count:4, sizeHint:6.5, clusterSize:1,
        offsetMin: BARRIER_OFF + 18, offsetMax: BARRIER_OFF + 38,
        yOffsetMin: 4, yOffsetMax: 12,
      });
    }
  }
  if(window.perfMark){perfMark('build:world:space:roadsideProps:end');perfMeasure('build.world.space.roadsideProps','build:world:space:roadsideProps:start','build:world:space:roadsideProps:end');}
  if(window.perfMark)perfMark('build:world:space:phaseHelpers:start');
  _buildSpaceCloseBand();      // Phase 12A
  _buildSpaceMidRing();        // Phase 11A
  _buildSpaceFarSilhouette();  // Phase 12C
  _buildSpaceHexArchway();     // Phase 12D
  if(window.perfMark){perfMark('build:world:space:phaseHelpers:end');perfMeasure('build.world.space.phaseHelpers','build:world:space:phaseHelpers:start','build:world:space:phaseHelpers:end');}
}

// Phase 12D — signature: floating hex-archway over track at t=0.5.
// TorusGeometry radialSegments=6 → hexagonal shape, slow rotation.
let _spaceHexArchway=null;
function _buildSpaceHexArchway(){
  if(typeof trackCurve==='undefined'||!trackCurve)return;
  const t = 0.5;
  const pt = trackCurve.getPoint(t);
  const tg = trackCurve.getTangent(t).normalize();
  const rotY = Math.atan2(tg.x, tg.z);
  const geo = new THREE.TorusGeometry(30, 1.4, 6, 6);  // 6 radial = hex
  const mat = new THREE.MeshLambertMaterial({color:0x4477ff, emissive:0x2244ff, emissiveIntensity:0.6, transparent:true, opacity:0.85});
  const arch = new THREE.Mesh(geo, mat);
  arch.position.set(pt.x, 18, pt.z);
  arch.rotation.y = rotY;
  arch.userData = {_noLodCull:true};
  arch.castShadow = false;
  scene.add(arch);
  _spaceHexArchway = arch;
}

// Phase 12C — far silhouet: nebula-buoys op ring r=280u, emissive
// markers. Scope-cue à la F-Zero/Wipeout ad-banners.
function _buildSpaceFarSilhouette(){
  const count = (typeof _mobCount==='function')?_mobCount(14):14;
  const geo = new THREE.SphereGeometry(1.6, 8, 6);
  const mat = new THREE.MeshLambertMaterial({color:0x6644ff, emissive:0x6644ff, emissiveIntensity:0.6});
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.userData = {_noLodCull:true};
  const m4 = new THREE.Matrix4();
  const v  = new THREE.Vector3();
  const q  = new THREE.Quaternion();
  const s  = new THREE.Vector3(1,1,1);
  for(let i=0;i<count;i++){
    const ang = (i/count) * Math.PI*2 + Math.random()*0.3;
    const r = 280 + (Math.random()-0.5)*30;
    v.set(Math.cos(ang)*r, 6 + Math.random()*30, Math.sin(ang)*r);
    m4.compose(v, q, s);
    im.setMatrixAt(i, m4);
  }
  im.instanceMatrix.needsUpdate = true;
  scene.add(im);
  // Halo plane per buoy
  const haloGeo = new THREE.PlaneGeometry(4, 4);
  const haloMat = new THREE.MeshBasicMaterial({
    color:0x6644ff, transparent:true, opacity:0.35,
    blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide
  });
  const haloIm = new THREE.InstancedMesh(haloGeo, haloMat, count);
  haloIm.userData = {_noLodCull:true};
  for(let i=0;i<count;i++){
    const ang = (i/count) * Math.PI*2 + Math.random()*0.3;
    const r = 280 + (Math.random()-0.5)*30;
    v.set(Math.cos(ang)*r, 6 + Math.random()*30, Math.sin(ang)*r);
    m4.compose(v, q, s);
    haloIm.setMatrixAt(i, m4);
  }
  haloIm.instanceMatrix.needsUpdate = true;
  scene.add(haloIm);
}

// Phase 12A — close-band: low-altitude debris fragments y=0-3.
function _buildSpaceCloseBand(){
  if(typeof _populateMidRing!=='function')return;
  const count = (typeof _mobCount==='function')?_mobCount(25):25;
  const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const mat = new THREE.MeshLambertMaterial({color:0x1a1a3a, emissive:0x000a22, emissiveIntensity:0.5});
  const im = new THREE.InstancedMesh(geo, mat, count*2);
  _populateMidRing(im, {
    perSide: count, offsetMin:4, offsetMax:14,
    scaleMin:0.6, scaleMax:1.6, tiltAmt:1.5, stagger:0.4,
    yFn: () => 0.4 + Math.random()*2.5
  });
  scene.add(im);
}

// Phase 11A — drijvende debris-blokken in 3 size-buckets.
function _buildSpaceMidRing(){
  if(typeof _populateMidRing!=='function')return;
  const total = (typeof _mobCount==='function')?_mobCount(35):35;
  const perBucket = Math.max(1, Math.floor(total/3));
  const buckets = [
    {sz:1.2, mat:_spMat({color:0x222244, emissive:0x000022, emissiveIntensity:0.4},{metalness:0.0,roughness:0.88},'cosmic-rock')},
    {sz:2.0, mat:_spMat({color:0x252253, emissive:0x110033, emissiveIntensity:0.35},{metalness:0.0,roughness:0.88},'cosmic-rock')},
    {sz:3.2, mat:_spMat({color:0x1b1b3a, emissive:0x000033, emissiveIntensity:0.30},{metalness:0.0,roughness:0.88},'cosmic-rock')}
  ];
  buckets.forEach((b, bi) => {
    const geo = new THREE.BoxGeometry(b.sz, b.sz, b.sz);
    const im  = new THREE.InstancedMesh(geo, b.mat, perBucket*2);
    _populateMidRing(im, {
      perSide: perBucket, offsetMin:22, offsetMax:55,
      scaleMin:0.7, scaleMax:1.8, tiltAmt:1.5,
      stagger: bi/3,
      yFn: () => 1 + Math.random()*14  // 1..15u zwevend
    });
    scene.add(im);
  });
}

function buildSpaceVoid(){
  // Deep abyss plane far below — creates infinite depth feeling
  const abyss=new THREE.Mesh(new THREE.PlaneGeometry(3000,3000,1,1),
    new THREE.MeshBasicMaterial({color:0x000008}));
  abyss.rotation.x=-Math.PI/2;abyss.position.y=-400;scene.add(abyss);
  // Mid-depth debris — small grey rocks drifting far below.
  // Single InstancedMesh; per-instance scale carries the silhouette
  // variation that previously came from per-mesh DodecahedronGeometry
  // size jitter. Mix-of-shapes (dodec vs icos) is collapsed to dodec —
  // at y=-40..-220u depth the silhouette difference is invisible.
  const COUNT=(typeof _mobCount==='function')?_mobCount(55):55;
  const debGeo=new THREE.DodecahedronGeometry(1,0);
  const debMat=_spMat({color:0x222233},{metalness:0.0,roughness:0.88},'cosmic-rock');
  const debIM =new THREE.InstancedMesh(debGeo,debMat,COUNT);
  const _d=new THREE.Object3D();
  _spaceDebrisData.length=0;
  for(let i=0;i<COUNT;i++){
    const scale=.5+Math.random()*2.5;
    const px=(Math.random()-.5)*1200;
    const py=-(40+Math.random()*180);
    const pz=(Math.random()-.5)*1200;
    const rx=Math.random()*Math.PI*2;
    const ry=Math.random()*Math.PI*2;
    const rsx=(Math.random()-.5)*.15;
    const rsy=(Math.random()-.5)*.05;
    const rsz=(Math.random()-.5)*.15;
    _spaceDebrisData.push({px,py,pz,rx,ry,rz:0,rsx,rsy,rsz,scale});
    _d.position.set(px,py,pz);
    _d.rotation.set(rx,ry,0);
    _d.scale.setScalar(scale);
    _d.updateMatrix();
    debIM.setMatrixAt(i,_d.matrix);
  }
  debIM.instanceMatrix.needsUpdate=true;
  scene.add(debIM);
  _spaceDebrisIM=debIM;
}

function buildSpaceTrackPlatform(){
  const N=300;
  // Track bottom face — dark metallic panel
  ribbon(N,t=>{
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    return{L:p.clone().addScaledVector(nr,-(TW+.5)).setY(-.55),R:p.clone().addScaledVector(nr,TW+.5).setY(-.55)};
  },_spMat({color:0x0e0e1e,side:THREE.BackSide},{metalness:0.40,roughness:0.45},'cosmic-metal'));
  // Left wall
  ribbon(N,t=>{
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const edge=p.clone().addScaledVector(nr,-TW);
    return{L:edge.clone().setY(-.55),R:edge.clone().setY(.35)};
  },new THREE.MeshLambertMaterial({color:0x00ffff,emissive:0x00aaff,emissiveIntensity:.9,transparent:true,opacity:.5,side:THREE.DoubleSide}));
  // Right wall
  ribbon(N,t=>{
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const edge=p.clone().addScaledVector(nr,TW);
    return{L:edge.clone().setY(-.55),R:edge.clone().setY(.35)};
  },new THREE.MeshLambertMaterial({color:0xff00ff,emissive:0xcc00cc,emissiveIntensity:.9,transparent:true,opacity:.5,side:THREE.DoubleSide}));
  // Underglow point lights — 8 widely-spaced lights (emissive walls already provide glow).
  // Mobile: halve to 4 — PointLights with distance:55 zijn duur en de emissive walls dragen.
  const _M_ug = !!window._isMobile;
  const UC = _M_ug ? 4 : 8;
  const glowCols=[0x00ffcc,0x8800ff,0x00aaff,0xff00aa];
  for(let i=0;i<UC;i++){
    const t=i/UC;const p=trackCurve.getPoint(t);
    const pl=new THREE.PointLight(glowCols[i%glowCols.length],2.2,55);
    pl.position.set(p.x,p.y-1.2,p.z);
    scene.add(pl);_spaceUnderglow.push(pl);
  }
}

function buildSpaceStars(){
  const _M = !!window._isMobile;
  const cnt = _M ? 900 : 2200;
  const geo=new THREE.BufferGeometry();
  const pos=new Float32Array(cnt*3);
  const col=new Float32Array(cnt*3);
  const colSets=[[1,1,1],[.85,.9,1],[1,1,.88],[.88,.82,1],[.8,.96,1]];
  for(let i=0;i<cnt;i++){
    const th=Math.random()*Math.PI*2;
    const ph=Math.random()*Math.PI*.55;
    const r=580+Math.random()*180;
    pos[i*3]=r*Math.sin(ph)*Math.cos(th);
    pos[i*3+1]=r*Math.cos(ph)*.45+70;
    pos[i*3+2]=r*Math.sin(ph)*Math.sin(th);
    const c=colSets[Math.floor(Math.random()*colSets.length)];
    col[i*3]=c[0];col[i*3+1]=c[1];col[i*3+2]=c[2];
  }
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  stars=new THREE.Points(geo,new THREE.PointsMaterial({
    vertexColors:true,size:.65,sizeAttenuation:false,transparent:true,opacity:.95
  }));
  stars.visible=true;scene.add(stars);
  // Horizon star band — halved on mobile
  const hCnt = _M ? 180 : 400;
  const hGeo=new THREE.BufferGeometry();
  const hPos=new Float32Array(hCnt*3);
  for(let i=0;i<hCnt;i++){
    const th=Math.random()*Math.PI*2;const r=520+Math.random()*140;
    hPos[i*3]=r*Math.cos(th);hPos[i*3+1]=Math.random()*40+5;hPos[i*3+2]=r*Math.sin(th);
  }
  hGeo.setAttribute('position',new THREE.Float32BufferAttribute(hPos,3));
  scene.add(new THREE.Points(hGeo,new THREE.PointsMaterial({color:0x9988cc,size:.45,sizeAttenuation:false,transparent:true,opacity:.55})));

  // Sessie 06b — parallax starfield. Two extra Points layers that drift
  // at different angular speeds give a "moving through space" feel even
  // when the player is stationary. Cheap (1k extra Points total).
  const mob = !!window._isMobile;
  const farCnt = mob ? 400 : 700;
  const farGeo = new THREE.BufferGeometry();
  const farPos = new Float32Array(farCnt * 3);
  const farCol = new Float32Array(farCnt * 3);
  for(let i=0;i<farCnt;i++){
    const th = Math.random()*Math.PI*2;
    const ph = Math.random()*Math.PI*.55;
    const r  = 820 + Math.random()*120;
    farPos[i*3]   = r*Math.sin(ph)*Math.cos(th);
    farPos[i*3+1] = r*Math.cos(ph)*0.4 + 90;
    farPos[i*3+2] = r*Math.sin(ph)*Math.sin(th);
    const tint = Math.random();
    farCol[i*3]   = 0.5+tint*0.3;
    farCol[i*3+1] = 0.5+tint*0.35;
    farCol[i*3+2] = 0.7+tint*0.3;
  }
  farGeo.setAttribute('position',new THREE.Float32BufferAttribute(farPos,3));
  farGeo.setAttribute('color',new THREE.Float32BufferAttribute(farCol,3));
  const farStars = new THREE.Points(farGeo, new THREE.PointsMaterial({
    vertexColors:true, size:0.40, sizeAttenuation:false, transparent:true, opacity:0.55
  }));
  scene.add(farStars);

  const midCnt = mob ? 250 : 480;
  const midGeo = new THREE.BufferGeometry();
  const midPos = new Float32Array(midCnt * 3);
  for(let i=0;i<midCnt;i++){
    const th = Math.random()*Math.PI*2;
    const ph = Math.random()*Math.PI*.55;
    const r  = 700 + Math.random()*60;
    midPos[i*3]   = r*Math.sin(ph)*Math.cos(th);
    midPos[i*3+1] = r*Math.cos(ph)*0.45 + 80;
    midPos[i*3+2] = r*Math.sin(ph)*Math.sin(th);
  }
  midGeo.setAttribute('position',new THREE.Float32BufferAttribute(midPos,3));
  const midStars = new THREE.Points(midGeo, new THREE.PointsMaterial({
    color:0xddd6ff, size:0.55, sizeAttenuation:false, transparent:true, opacity:0.80
  }));
  scene.add(midStars);

  // Park refs so updateSpaceWorld can slow-rotate them.
  window._spaceFarStars = farStars;
  window._spaceMidStars = midStars;

  // Nebula volumetric clouds — 3 large additive billboards. Magenta /
  // cyan / teal tints reinforce the cyberpunk-space palette.
  const nebulaC = document.createElement('canvas');
  nebulaC.width = 256; nebulaC.height = 256;
  const ng = nebulaC.getContext('2d');
  const ngrd = ng.createRadialGradient(128,128,0,128,128,128);
  ngrd.addColorStop(0.0,'rgba(255,255,255,0.55)');
  ngrd.addColorStop(0.35,'rgba(255,255,255,0.20)');
  ngrd.addColorStop(1.0,'rgba(255,255,255,0)');
  ng.fillStyle = ngrd; ng.fillRect(0,0,256,256);
  // Sprinkle noise into the alpha for organic edges.
  for(let i=0;i<200;i++){
    const x = Math.random()*256, y = Math.random()*256, r = 4+Math.random()*16;
    const lg = ng.createRadialGradient(x,y,0,x,y,r);
    lg.addColorStop(0,'rgba(255,255,255,0.05)');
    lg.addColorStop(1,'rgba(255,255,255,0)');
    ng.fillStyle = lg; ng.fillRect(x-r,y-r,r*2,r*2);
  }
  const nebulaTex = new THREE.CanvasTexture(nebulaC);
  nebulaTex.userData = { _sharedAsset: true };
  const nebPlacements = [
    { x: -380, y: 130, z: -420, scale: 280, color: 0xff44dd },
    { x:  420, y: 100, z: -360, scale: 240, color: 0x44ddff },
    { x: -160, y:  90, z:  460, scale: 200, color: 0x88ffaa }
  ];
  nebPlacements.forEach(p => {
    const m = new THREE.SpriteMaterial({
      map: nebulaTex, color: p.color,
      transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const sp = new THREE.Sprite(m);
    sp.position.set(p.x, p.y, p.z);
    sp.scale.set(p.scale, p.scale, 1);
    scene.add(sp);
  });
}

function buildSpacePlanets(){
  // Large striped gas giant at horizon
  const pGeo=new THREE.SphereGeometry(95,32,24);
  const pColors=new Float32Array(pGeo.attributes.position.count*3);
  for(let i=0;i<pGeo.attributes.position.count;i++){
    const y=pGeo.attributes.position.getY(i);
    const t=(y+95)/190;const b=Math.floor(t*8)%2;
    if(b===0){pColors[i*3]=.78;pColors[i*3+1]=.44;pColors[i*3+2]=.14;}
    else{pColors[i*3]=.94;pColors[i*3+1]=.80;pColors[i*3+2]=.60;}
  }
  pGeo.setAttribute('color',new THREE.Float32BufferAttribute(pColors,3));
  const planet=new THREE.Mesh(pGeo,_spMat({vertexColors:true},{metalness:0.0,roughness:0.75},'cosmic-rock'));
  planet.position.set(-520,115,-520);planet.rotation.z=.18;scene.add(planet);
  // Ring
  const ring=new THREE.Mesh(new THREE.RingGeometry(125,178,64),
    new THREE.MeshBasicMaterial({color:0xc89050,transparent:true,opacity:.52,side:THREE.DoubleSide}));
  ring.position.copy(planet.position);ring.rotation.x=1.3;ring.rotation.z=.08;scene.add(ring);
  // Moon 1 — grey
  const m1=new THREE.Mesh(new THREE.SphereGeometry(17,12,12),_spMat({color:0xaaaabc},{metalness:0.0,roughness:0.85},'cosmic-rock'));
  m1.position.set(310,195,-460);scene.add(m1);
  // Moon 2 — reddish
  const m2=new THREE.Mesh(new THREE.SphereGeometry(11,12,12),_spMat({color:0x887060},{metalness:0.0,roughness:0.80},'cosmic-rock'));
  m2.position.set(-260,275,490);scene.add(m2);
}

function buildNebula(){
  // Phase 11B — elke nebula als 3-bol cluster ipv single sphere. Geeft
  // depth-volumetry zonder shader-tricks; main bol = volledige radius,
  // 2 satelliet-bollen op offsets binnen de main radius met kleinere
  // schaal + lager opacity zodat ze als wispy density-pockets lezen.
  // Mobile: skip satelliet-bollen (main bol only) en cluster-count 6 → 4.
  const _M = !!window._isMobile;
  const offsetsFull = [
    {dx:0, dy:0, dz:0, rs:1.0, oMul:1.0},
    {dx:0.6, dy:0.3, dz:0.2, rs:0.65, oMul:0.85},
    {dx:-0.4, dy:0.5, dz:-0.3, rs:0.55, oMul:0.75}
  ];
  const offsets = _M ? offsetsFull.slice(0,2) : offsetsFull;
  const placementsFull = [{p:[-700,100,-600],r:300,c:0x3300aa,o:.08},{p:[600,80,-650],r:250,c:0x880044,o:.09},
   {p:[-600,150,500],r:280,c:0x006688,o:.07},{p:[650,60,600],r:220,c:0x000088,o:.10},
   {p:[0,50,-750],r:350,c:0x220055,o:.06},{p:[700,120,0],r:260,c:0x440088,o:.08}];
  const placements = _M ? placementsFull.slice(0,4) : placementsFull;
  placements.forEach(n=>{
    const grp=new THREE.Group();
    grp.position.set(n.p[0],n.p[1],n.p[2]);
    grp.userData={_noLodCull:true};
    offsets.forEach(o=>{
      const mat=new THREE.MeshBasicMaterial({color:n.c,transparent:true,opacity:n.o*o.oMul,side:THREE.BackSide});
      const blob=new THREE.Mesh(new THREE.SphereGeometry(n.r*o.rs,10,8),mat);
      blob.position.set(n.r*o.dx, n.r*o.dy, n.r*o.dz);
      grp.add(blob);
    });
    scene.add(grp);
  });
}

function buildSpaceTrackEdges(){
  // N must match the main track ribbon (N=400) — otherwise the segment vertices don't line up
  // on tight corners and the edge ribbon visually splits off, looking like a "ghost fork".
  // PolygonOffset -3 is stronger than the curbs (-1) and elines (-2), so these neon edges always
  // win the depth test and never z-fight against the track.
  const N=400;
  const cyMat=new THREE.MeshLambertMaterial({color:0x00ffff,emissive:0x00ccff,emissiveIntensity:2.2,transparent:true,opacity:.92});
  cyMat.polygonOffset=true;cyMat.polygonOffsetFactor=-3;cyMat.polygonOffsetUnits=-3;
  const mgMat=new THREE.MeshLambertMaterial({color:0xff00ff,emissive:0xcc00cc,emissiveIntensity:2.2,transparent:true,opacity:.92});
  mgMat.polygonOffset=true;mgMat.polygonOffsetFactor=-3;mgMat.polygonOffsetUnits=-3;
  ribbon(N,t=>{
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    return{L:p.clone().addScaledVector(nr,-(TW-.5)).setY(.025),R:p.clone().addScaledVector(nr,-(TW-.5)+.55).setY(.025)};
  },cyMat);
  ribbon(N,t=>{
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    return{L:p.clone().addScaledVector(nr,TW-.55).setY(.025),R:p.clone().addScaledVector(nr,TW).setY(.025)};
  },mgMat);
}

function buildSpaceOrbs(){
  // Mobile: halve count — dubbele symmetrie via [-1,1].forEach maakt dat
  // 36 → 18 orbs ook 36 PointLights bespaart (grootste single win in space).
  const _M = !!window._isMobile;
  const OC = _M ? 18 : 36;
  const cols=[0x00ffff,0xff00ff,0x00ff88,0x8844ff];
  for(let i=0;i<OC;i++){
    const t=i/OC;
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    [-1,1].forEach((side,si)=>{
      const col=cols[(i*2+si)%cols.length];
      const pp=p.clone().addScaledVector(nr,side*(BARRIER_OFF+1.5));
      const orb=new THREE.Mesh(new THREE.SphereGeometry(.75,8,8),
        new THREE.MeshLambertMaterial({color:col,emissive:col,emissiveIntensity:2.8}));
      orb.position.copy(pp);orb.position.y=4.2;scene.add(orb);
      const pl=new THREE.PointLight(col,2.0,18);pl.position.copy(orb.position);scene.add(pl);
      trackLightList.push(pl);trackPoles.push(orb);
    });
  }
}

function buildSpaceStation(){
  const p=trackCurve.getPoint(0),tg=trackCurve.getTangent(0).normalize();
  const nr=new THREE.Vector3(-tg.z,0,tg.x);
  const base=p.clone().addScaledVector(nr,-(TW+13));
  const mM=_spMat({color:0x22223a},{metalness:0.40,roughness:0.45},'cosmic-metal');
  const gM=new THREE.MeshLambertMaterial({color:0x0044ff,emissive:0x0022aa,emissiveIntensity:1.6});
  const glM=new THREE.MeshLambertMaterial({color:0x88aaff,emissive:0x2244cc,emissiveIntensity:.9,transparent:true,opacity:.72});
  // Main block
  const bld=new THREE.Mesh(new THREE.BoxGeometry(22,8,13),mM);
  bld.position.copy(base);bld.position.y=4;bld.rotation.y=Math.atan2(tg.x,tg.z);scene.add(bld);
  // Control room glass box
  const ctrl=new THREE.Mesh(new THREE.BoxGeometry(10,4,8),glM);
  ctrl.position.copy(base);ctrl.position.y=10;ctrl.rotation.y=Math.atan2(tg.x,tg.z);scene.add(ctrl);
  // Comm tower
  const tower=new THREE.Mesh(new THREE.CylinderGeometry(.14,.24,14,6),mM);
  tower.position.copy(base);tower.position.y=15;scene.add(tower);
  // Glow base strips
  [-1,1].forEach(s=>{
    const strip=new THREE.Mesh(new THREE.BoxGeometry(22,.32,1.2),gM);
    strip.position.copy(base);strip.position.y=.2;
    strip.position.addScaledVector(nr,s*6.5);strip.rotation.y=Math.atan2(tg.x,tg.z);scene.add(strip);
  });
  // Docking arm
  const arm=new THREE.Mesh(new THREE.BoxGeometry(1.2,1,16),mM);
  arm.position.copy(base);arm.position.addScaledVector(tg,-11);arm.position.y=6;scene.add(arm);
}

function buildSpaceGate(){
  const p=trackCurve.getPoint(0),tg=trackCurve.getTangent(0).normalize();
  const nr=new THREE.Vector3(-tg.z,0,tg.x),hw=TW+4;
  const mM=_spMat({color:0x1a1a2e},{metalness:0.40,roughness:0.45},'cosmic-metal');
  const nC=new THREE.MeshLambertMaterial({color:0x00ffff,emissive:0x00aaff,emissiveIntensity:2.4});
  const nM=new THREE.MeshLambertMaterial({color:0xff00ff,emissive:0xcc00cc,emissiveIntensity:2.4});
  [-1,1].forEach((s,si)=>{
    const pp=p.clone().addScaledVector(nr,s*hw);
    const post=new THREE.Mesh(new THREE.BoxGeometry(1.1,14,.8),mM);
    post.position.copy(pp);post.position.y=7;scene.add(post);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.6,.18,8,24),si===0?nC:nM);
    ring.position.copy(pp);ring.position.y=12.5;ring.rotation.y=Math.atan2(tg.x,tg.z);scene.add(ring);
  });
  const bar=new THREE.Mesh(new THREE.BoxGeometry(hw*2,1.2,.8),mM);
  bar.position.copy(p);bar.position.y=14;scene.add(bar);
  const ledC=new THREE.Mesh(new THREE.BoxGeometry(hw*2-.6,.16,.35),nC);
  ledC.position.copy(p);ledC.position.y=13.4;scene.add(ledC);
  const ledM=new THREE.Mesh(new THREE.BoxGeometry(hw*2-.6,.16,.35),nM);
  ledM.position.copy(p);ledM.position.y=14.6;scene.add(ledM);
  // Sign
  const cvs=document.createElement('canvas');cvs.width=512;cvs.height=64;
  const sCtx=cvs.getContext('2d');
  sCtx.fillStyle='#04001a';sCtx.fillRect(0,0,512,64);
  sCtx.font='bold 36px monospace';sCtx.textAlign='center';sCtx.textBaseline='middle';
  const grd=sCtx.createLinearGradient(0,0,512,0);
  grd.addColorStop(0,'#00ffff');grd.addColorStop(.5,'#ffffff');grd.addColorStop(1,'#ff00ff');
  sCtx.fillStyle=grd;sCtx.fillText('COSMIC CIRCUIT',256,32);
  const tex=new THREE.CanvasTexture(cvs);
  const sign=new THREE.Mesh(new THREE.BoxGeometry(hw*2-1.5,2.4,.22),
    new THREE.MeshStandardMaterial({map:tex,emissiveMap:tex,emissive:new THREE.Color(1,1,1),emissiveIntensity:.85}));
  sign.position.copy(p);sign.position.y=16.4;scene.add(sign);
}

function buildSpaceBarriers(){
  const _M = !!window._isMobile;
  [-1,1].forEach(side=>{
    const N = _M ? 120 : 200;
    const pos=[],nrm=[],idx=[];
    for(let i=0;i<=N;i++){
      const t=i/N,p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
      const nr=new THREE.Vector3(-tg.z,0,tg.x);
      const b=p.clone().addScaledVector(nr,side*BARRIER_OFF);
      pos.push(b.x,0,b.z,b.x,1.2,b.z);
      nrm.push(-side*nr.x,0,-side*nr.z,-side*nr.x,0,-side*nr.z);
      if(i<N){const a=i*2,b2=a+1,c=a+2,d=a+3;idx.push(a,b2,c,b2,d,c);}
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geo.setAttribute('normal',new THREE.Float32BufferAttribute(nrm,3));
    geo.setIndex(idx);
    const col=side===-1?0x0088ff:0xff0088;
    scene.add(new THREE.Mesh(geo,new THREE.MeshLambertMaterial({
      color:col,emissive:col,emissiveIntensity:.9,transparent:true,opacity:.30,side:THREE.DoubleSide
})));
  });
}

function buildSpaceDust(){
  if(_spaceDustParticles)return;
  const _M = !!window._isMobile;
  const cnt = _M ? 180 : 350;
  _spaceDustGeo=new THREE.BufferGeometry();
  const pos=new Float32Array(cnt*3);const col=new Float32Array(cnt*3);
  for(let i=0;i<cnt;i++){
    pos[i*3]=(Math.random()-.5)*400;
    pos[i*3+1]=Math.random()*22+1;
    pos[i*3+2]=(Math.random()-.5)*400;
    const r=Math.random();
    if(r<.33){col[i*3]=.7;col[i*3+1]=1;col[i*3+2]=1;}
    else if(r<.66){col[i*3]=.9;col[i*3+1]=.8;col[i*3+2]=1;}
    else{col[i*3]=1;col[i*3+1]=1;col[i*3+2]=1;}
  }
  _spaceDustGeo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  _spaceDustGeo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  _spaceDustParticles=new THREE.Points(_spaceDustGeo,new THREE.PointsMaterial({
    vertexColors:true,size:.42,sizeAttenuation:false,transparent:true,opacity:.7,
    blending:THREE.AdditiveBlending,depthWrite:false
  }));
  scene.add(_spaceDustParticles);
}

function buildSpaceGravityWells(){
  _spaceGravityWells.length=0;
  // 3 gravity wells placed just outside the ideal racing line
  [{t:.18,side:1},{t:.50,side:-1},{t:.78,side:1}].forEach(def=>{
    const p=trackCurve.getPoint(def.t),tg=trackCurve.getTangent(def.t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const center=p.clone().addScaledVector(nr,def.side*7); // 7 units off centerline
    center.y=.02;
    // Outer ring
    const torusMat=new THREE.MeshLambertMaterial({color:0x110033,emissive:0x4400aa,emissiveIntensity:1.8});
    const ring1=new THREE.Mesh(new THREE.TorusGeometry(5.5,.22,8,40),torusMat);
    ring1.position.copy(center);ring1.rotation.x=Math.PI/2;scene.add(ring1);
    // Middle ring (spins opposite)
    const ring2=new THREE.Mesh(new THREE.TorusGeometry(3.5,.18,8,32),new THREE.MeshLambertMaterial({color:0x220066,emissive:0x6600cc,emissiveIntensity:2.2}));
    ring2.position.copy(center);ring2.rotation.x=Math.PI/2;ring2.rotation.z=.4;scene.add(ring2);
    // Inner disc
    const disc=new THREE.Mesh(new THREE.CircleGeometry(2.2,32),new THREE.MeshLambertMaterial({color:0x000000,emissive:0x3300aa,emissiveIntensity:1.4,transparent:true,opacity:.88}));
    disc.position.copy(center);disc.position.y=.03;disc.rotation.x=-Math.PI/2;scene.add(disc);
    // Glow point light
    const pl=new THREE.PointLight(0x6600ff,2.5,18);pl.position.copy(center);pl.position.y=1;scene.add(pl);
    _spaceGravityWells.push({pos:center.clone(),ring1,ring2,pl,side:def.side,strength:0.007,radius:22});
  });
}

function buildSpaceRailguns(){
  _spaceRailguns.length=0;
  // 2 railgun strips on long straights
  [{t:.03},{t:.58}].forEach(def=>{
    const p=trackCurve.getPoint(def.t),tg=trackCurve.getTangent(def.t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const ang=Math.atan2(tg.x,tg.z);
    // Rail strips (two parallel, center of track)
    const railMat=new THREE.MeshLambertMaterial({color:0x00ffff,emissive:0x00aaff,emissiveIntensity:2.5});
    [-1,1].forEach(s=>{
      const rail=new THREE.Mesh(new THREE.BoxGeometry(.22,.08,8),railMat);
      rail.position.copy(p);rail.position.y=.05;rail.rotation.y=ang;
      rail.position.addScaledVector(nr,s*2.5);scene.add(rail);
    });
    // Glowing pad between rails
    const pad=new THREE.Mesh(new THREE.BoxGeometry(5.5,.06,8),new THREE.MeshLambertMaterial({color:0x0044ff,emissive:0x0022ff,emissiveIntensity:1.2,transparent:true,opacity:.7}));
    pad.position.copy(p);pad.position.y=.03;pad.rotation.y=ang;scene.add(pad);
    // Arrow chevrons
    const arMat=new THREE.MeshBasicMaterial({color:0x88ffff,transparent:true,opacity:.8});
    [-2,0,2].forEach(oz=>{
      [-1,1].forEach(s=>{
        const bar=new THREE.Mesh(new THREE.BoxGeometry(.12,.07,1.6),arMat);
        bar.position.copy(p);bar.position.y=.06;bar.rotation.y=ang+s*.55;
        bar.position.addScaledVector(tg,oz);scene.add(bar);
      });
    });
    // Point light
    const pl=new THREE.PointLight(0x00ccff,3,16);pl.position.copy(p);pl.position.y=1;scene.add(pl);
    _spaceRailguns.push({pos:p.clone(),t:def.t,tg:tg.clone(),pl,halfLen:4});
  });
}

function buildSpaceUFOs(){
  _spaceUFOs.length=0;
  const _M = !!window._isMobile;
  const UC = _M ? 5 : 10;
  const ufoColors=[0x00ff88,0xaa00ff,0x00ccff,0xff4488,0xffaa00,0x44ffff,0xff2288,0x88ff00];
  for(let i=0;i<UC;i++){
    const t=i/UC;
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const col=ufoColors[i%ufoColors.length];
    const side=(i%2===0?1:-1);
    const spawnX=p.x+nr.x*side*(BARRIER_OFF+30+Math.random()*20);
    const spawnZ=p.z+nr.z*side*(BARRIER_OFF+30+Math.random()*20);
    const spawnY=22+Math.random()*18;
    // Body (flattened sphere)
    const bodyGeo=new THREE.SphereGeometry(2.2,16,10);
    bodyGeo.scale(1,.35,1);
    const body=new THREE.Mesh(bodyGeo,_spMat({color:0x222233},{metalness:0.40,roughness:0.45},'cosmic-metal'));
    body.position.set(spawnX,spawnY,spawnZ);scene.add(body);
    // Dome
    const dome=new THREE.Mesh(new THREE.SphereGeometry(1.1,12,8,0,Math.PI*2,0,Math.PI*.5),
      new THREE.MeshLambertMaterial({color:0x8899ff,emissive:0x4466cc,emissiveIntensity:.8,transparent:true,opacity:.75}));
    dome.position.copy(body.position);dome.position.y+=.4;scene.add(dome);
    // Glow ring
    const glowRing=new THREE.Mesh(new THREE.TorusGeometry(2.4,.12,6,28),
      new THREE.MeshLambertMaterial({color:col,emissive:col,emissiveIntensity:3.0}));
    glowRing.rotation.x=Math.PI/2;glowRing.position.copy(body.position);glowRing.position.y-=.15;scene.add(glowRing);
    // No per-UFO PointLight — emissive glow ring is enough at this distance
    _spaceUFOs.push({body,dome,glowRing,
      orbitRadius:BARRIER_OFF+32+Math.random()*18,
      orbitY:spawnY,orbitT:t+Math.random(),orbitSpd:.08+Math.random()*.06,
      beamTimer:Math.random()*6,col});
  }
}

function buildSpaceMeteorSystem(){
  _spaceMeteors.length=0;
  _spaceMeteorTimer=12+Math.random()*10;
  // Pool of 3 potential meteors (reused)
  const matOrange=new THREE.MeshLambertMaterial({color:0xff4400,emissive:0xff2200,emissiveIntensity:1.8});
  for(let i=0;i<3;i++){
    const g=new THREE.IcosahedronGeometry(1.4+Math.random()*.8,0);
    const pa=g.attributes.position.array;
    for(let j=0;j<pa.length;j++)pa[j]+=(Math.random()-.5)*.6;
    g.attributes.position.needsUpdate=true;g.computeVertexNormals();
    const m=new THREE.Mesh(g,matOrange.clone());
    m.visible=false;m.position.set(0,300,0);scene.add(m);
    const pl=new THREE.PointLight(0xff4400,0,20);pl.position.copy(m.position);scene.add(pl);
    _spaceMeteors.push({mesh:m,pl,active:false,vy:0,tx:0,tz:0,t:0});
  }
}

function buildSpaceTractorBeam(){
  // Vertical beam shown during recovery
  const geo=new THREE.CylinderGeometry(1.8,0.3,220,12,1);
  const mat=new THREE.MeshLambertMaterial({color:0x00ffff,emissive:0x00aaff,emissiveIntensity:3.5,transparent:true,opacity:.55});
  _spaceBeamMesh=new THREE.Mesh(geo,mat);
  _spaceBeamMesh.position.set(0,-100,0); // hidden below
  _spaceBeamMesh.visible=false;
  scene.add(_spaceBeamMesh);
}

function updateSpaceWorld(dt){
  const _M = !!window._isMobile;
  _spaceFrame++;
  // ── Slow starfield parallax — sky drifts horizontally, ~1 cycle / 20min ──
  if(scene&&scene.background&&scene.background.isTexture){
    scene.background.offset.x=(scene.background.offset.x+dt*.0008)%1;
  }
  // Sessie 06b — slow-rotate the extra parallax star layers around Y. Far
  // layer rotates slowest, mid layer ~1.6x faster. Gives a depth cue
  // without proper depth — they drift past each other as the world
  // background shifts.
  if(window._spaceFarStars) window._spaceFarStars.rotation.y += dt * 0.006;
  if(window._spaceMidStars) window._spaceMidStars.rotation.y -= dt * 0.010;
  // ── Rotate asteroids + void debris ──────────────────────────────
  // forEach → for: closure allocated per frame for every world tick.
  // Mobile: doubled dt + every-other-frame stagger halves per-frame matrix writes.
  const _rotSkip = _M && (_spaceFrame & 1);
  if(!_rotSkip){
    const _rotDt = _M ? dt*2 : dt;
    for(let _ai=0;_ai<_spaceAsteroids.length;_ai++){
      const a=_spaceAsteroids[_ai];
      if(!a._rspd)continue;
      a.rotation.x+=a._rspd.x*_rotDt;a.rotation.y+=a._rspd.y*_rotDt;a.rotation.z+=a._rspd.z*_rotDt;
    }
    // Void debris (InstancedMesh): advance per-instance rotation + write matrix.
    if(_spaceDebrisIM&&_spaceDebrisData.length){
      const _d=_spaceDebrisIM.userData._dummy||(_spaceDebrisIM.userData._dummy=new THREE.Object3D());
      for(let i=0;i<_spaceDebrisData.length;i++){
        const r=_spaceDebrisData[i];
        r.rx+=r.rsx*_rotDt;r.ry+=r.rsy*_rotDt;r.rz+=r.rsz*_rotDt;
        _d.position.set(r.px,r.py,r.pz);
        _d.rotation.set(r.rx,r.ry,r.rz);
        _d.scale.setScalar(r.scale);
        _d.updateMatrix();
        _spaceDebrisIM.setMatrixAt(i,_d.matrix);
      }
      _spaceDebrisIM.instanceMatrix.needsUpdate=true;
    }
  }
  // ── Phase 10.4 — electric arcs between asteroids ──────────────────
  _updateSpaceArcs(dt);
  // Phase 12D — hex-archway slow rotation around its own torus axis (local Z)
  if(_spaceHexArchway){
    _spaceHexArchway.rotateZ(dt * 0.15);
  }
  // ── Space dust drift — throttled to ~10fps to avoid per-frame GPU uploads ────
  if(_spaceDustParticles&&_spaceDustGeo){
    _spaceDustParticles._driftTimer=(_spaceDustParticles._driftTimer||0)-dt;
    if(_spaceDustParticles._driftTimer<=0){
      _spaceDustParticles._driftTimer=0.1; // 10fps
      const pa=_spaceDustGeo.attributes.position.array;
      const pcar=carObjs[playerIdx];
      const cx=pcar?pcar.mesh.position.x:0,cz=pcar?pcar.mesh.position.z:0;
      for(let i=0;i<pa.length;i+=3){
        pa[i]+=Math.sin(_nowSec*.18+i)*.2;pa[i+1]+=Math.sin(_nowSec*.28+i*1.7)*.1;pa[i+2]+=Math.cos(_nowSec*.22+i)*.2;
        if(pa[i+1]>24||pa[i+1]<.4||Math.abs(pa[i]-cx)>220||Math.abs(pa[i+2]-cz)>220){pa[i]=cx+(Math.random()-.5)*380;pa[i+1]=Math.random()*20+1;pa[i+2]=cz+(Math.random()-.5)*380;}
      }
      _spaceDustGeo.attributes.position.needsUpdate=true;
    }
  }
  // ── Gravity well spin ────────────────────────────────────────────
  for(let i=0;i<_spaceGravityWells.length;i++){
    const w=_spaceGravityWells[i];
    w.ring1.rotation.z+=dt*(.8+i*.2);
    w.ring2.rotation.z-=dt*1.2;
    // Pull player toward well if within radius. Squared-distance gate
    // skipt de sqrt voor de N-1 wells waar de player buiten valt (de
    // gangbare case).
    const car=carObjs[playerIdx];
    if(car&&!car._fallingIntoSpace&&!car.finished){
      const dx=car.mesh.position.x-w.pos.x,dz=car.mesh.position.z-w.pos.z;
      const _d2=dx*dx+dz*dz;
      const _r2=w.radius*w.radius;
      if(_d2<_r2 && _d2>0.25){
        const dist=Math.sqrt(_d2);
        const pull=w.strength*(1-(dist/w.radius));
        car.mesh.position.x-=dx/dist*pull*60*dt;
        car.mesh.position.z-=dz/dist*pull*60*dt;
        if(dist<8&&Math.random()<.015*dt*60)floatText('⚠ GRAVITY!','#aa00ff',innerWidth*.5,innerHeight*.55);
      }
    }
    // Pulse glow
    w.pl.intensity=2.0+Math.sin(_nowSec*3+i)*.8;
  }
  // Lap-progressive anomaly expansion runs AFTER the wells' baseline visuals
  // so it can override radius/strength for this frame's checkGravityZones.
  if(typeof updateSpaceAnomaly==='function'){
    const _pl=carObjs[playerIdx];
    updateSpaceAnomaly(dt, _pl?_pl.lap:1);
  }
  // ── Railgun effect (player physics applied in checkSpaceRailgun) ─
  for(let i=0;i<_spaceRailguns.length;i++){const r=_spaceRailguns[i];r.pl.intensity=2.5+Math.sin(_nowSec*8+i)*.8;}
  // ── UFO orbits + occasional beam ────────────────────────────────
  for(let _ui=0;_ui<_spaceUFOs.length;_ui++){
    const u=_spaceUFOs[_ui];
    u.orbitT+=dt*u.orbitSpd;
    const angle=u.orbitT*Math.PI*2;
    const cx=Math.cos(angle)*u.orbitRadius,cz=Math.sin(angle)*u.orbitRadius;
    u.body.position.set(cx,u.orbitY+Math.sin(u.orbitT*2.3)*.8,cz);
    u.dome.position.copy(u.body.position);u.dome.position.y+=.42;
    u.glowRing.position.copy(u.body.position);u.glowRing.position.y-=.14;
    u.glowRing.rotation.z+=dt*.9;
    // Occasional beam down to track
    u.beamTimer-=dt;
    if(u.beamTimer<=0){u.beamTimer=6+Math.random()*8;}
  }
  // ── Tractor beam fade ─────────────────────────────────────────────
  if(_spaceBeamTimer>0){
    _spaceBeamTimer-=dt;
    if(_spaceBeamMesh){
      _spaceBeamMesh.visible=true;
      _spaceBeamMesh.material.opacity=Math.min(.6,_spaceBeamTimer*.5);
      _spaceBeamMesh.rotation.y+=dt*2;
    }
    if(_spaceBeamTimer<=0&&_spaceBeamMesh)_spaceBeamMesh.visible=false;
  }
  // ── Meteor system ────────────────────────────────────────────────
  _spaceMeteorTimer-=dt;
  if(_spaceMeteorTimer<=0){
    _spaceMeteorTimer=14+Math.random()*12;
    spawnSpaceMeteor();
  }
  for(let _mi=0;_mi<_spaceMeteors.length;_mi++){
    const m=_spaceMeteors[_mi];
    if(!m.active)continue;
    m.mesh.position.y+=m.vy*dt;m.mesh.rotation.x+=1.2*dt;m.mesh.rotation.z+=.8*dt;
    m.pl.position.copy(m.mesh.position);
    m.vy-=32*dt; // fast fall
    // Trail: emit spark each frame
    if(Math.random()<.6)sparkSystem.emit(m.mesh.position.x,m.mesh.position.y,m.mesh.position.z,(Math.random()-.5)*.05,.06+Math.random()*.04,(Math.random()-.5)*.05,4,1,.55,.15,.9);
    if(m.mesh.position.y<=.5){
      // Impact
      sparkSystem.emit(m.mesh.position.x,.5,m.mesh.position.z,(Math.random()-.5)*.12,.14+Math.random()*.08,(Math.random()-.5)*.12,28,1,.6,.2,.9);
      camShake=.7;
      // Stay as obstacle for 8 seconds then deactivate
      m.mesh.position.y=.5;m.vy=0;m.t+=dt;
      m.pl.intensity=1.2+Math.sin(_nowSec*4)*.5;
      if(m.t>8){m.active=false;m.mesh.visible=false;m.pl.intensity=0;}
      // Check collision with player
      const car=carObjs[playerIdx];
      if(car){
        const dd=car.mesh.position.distanceTo(m.mesh.position);
        if(dd<3.5){
          car.speed*=.4;car.hitCount=(car.hitCount||0)+1;
          floatText('☄ METEOR HIT!','#ff4400',innerWidth*.5,innerHeight*.45);
          Audio.playCollision();m.active=false;m.mesh.visible=false;m.pl.intensity=0;
        }
      }
    }
  }
  // ── Player fall detection ─────────────────────────────────────────
  const car=carObjs[playerIdx];
  if(car&&car._fallingIntoSpace&&!recoverActive){
    car._fallTimer=(car._fallTimer||0)+dt;
    car.vy-=18*dt;
    car.mesh.position.y+=car.vy*dt;
    car.speed*=Math.pow(.85,dt*60);
    car.mesh.rotation.x+=.9*dt;car.mesh.rotation.z+=.6*dt;
    if(car.mesh.position.y<-18||car._fallTimer>3.5)triggerSpaceRecovery(car);
  }
}

function checkSpaceRailgun(){
  if(!_spaceRailguns.length||activeWorld!=='space')return;
  const car=carObjs[playerIdx];if(!car||recoverActive||car._fallingIntoSpace)return;
  _spaceRailguns.forEach(r=>{
    const dx=car.mesh.position.x-r.pos.x,dz=car.mesh.position.z-r.pos.z;
    const dist=Math.sqrt(dx*dx+dz*dz);
    if(dist<TW*.9&&(r._cooldown||0)<=0){
      // Boost along track direction
      const tg=trackCurve.getTangent(car.progress).normalize();
      car.mesh.rotation.y=Math.atan2(-tg.x,-tg.z);
      car.speed=Math.min(car.def.topSpd*1.55,car.speed+(car.def.topSpd*.45));
      car.boostTimer=1.2;
      r._cooldown=3.5;
      showPopup('⚡ RAILGUN BOOST!','#00aaff',900);
      floatText('⚡ +SPEED','#00aaff',innerWidth*.5,innerHeight*.5);
      playSpaceRailgunSound();
      camShake=0.25;
      sparkSystem.emit(car.mesh.position.x,car.mesh.position.y+.3,car.mesh.position.z,
        tg.x*.22,.04+Math.random()*.06,tg.z*.22,18,.3,.6,1,.4);
    }
    if((r._cooldown||0)>0)r._cooldown-=1/60;
  });
}

// ── Phase 10.4 — electric arcs between asteroids ────────────────────
// Korte cyaan zigzag-bolts spawnen tussen 2 willekeurige asteroid-
// posities. Life 0.15-0.3s, fade out. Cap op 6 actieve arcs voor
// budget; geometry/material per-arc disposed bij verlopen.
function _spawnSpaceArc(p1,p2){
  if(!_spaceArcMatProto){
    _spaceArcMatProto=new THREE.LineBasicMaterial({
      color:0x88ddff,transparent:true,opacity:.9,
      blending:THREE.AdditiveBlending,depthWrite:false
    });
  }
  const points=[];
  const steps=8;
  for(let i=0;i<=steps;i++){
    const t=i/steps;
    const p=new THREE.Vector3().lerpVectors(p1,p2,t);
    if(i>0&&i<steps){
      p.x+=(Math.random()-.5)*2;
      p.y+=(Math.random()-.5)*2;
      p.z+=(Math.random()-.5)*2;
    }
    points.push(p);
  }
  const geo=new THREE.BufferGeometry().setFromPoints(points);
  const mat=_spaceArcMatProto.clone();
  const line=new THREE.Line(geo,mat);
  scene.add(line);
  _spaceArcs.push({line:line,born:_nowSec,life:.15+Math.random()*.15});
}
function _updateSpaceArcs(dt){
  if(typeof _nowSec==='undefined')return;
  // Spawn nieuw arc
  if(_nowSec>_spaceArcNext&&_spaceAsteroids&&_spaceAsteroids.length>=2&&_spaceArcs.length<6){
    _spaceArcNext=_nowSec+.4+Math.random()*.8;
    const i1=Math.floor(Math.random()*_spaceAsteroids.length);
    let i2=Math.floor(Math.random()*_spaceAsteroids.length);
    if(i2===i1)i2=(i2+1)%_spaceAsteroids.length;
    const a1=_spaceAsteroids[i1],a2=_spaceAsteroids[i2];
    if(a1&&a2&&a1.position&&a2.position){
      const dx=a1.position.x-a2.position.x;
      const dy=a1.position.y-a2.position.y;
      const dz=a1.position.z-a2.position.z;
      // Only arc als distance < 60u zodat ze geen scherm-breed bolts worden
      if(dx*dx+dy*dy+dz*dz<3600){
        _spawnSpaceArc(a1.position,a2.position);
      }
    }
  }
  // Fade + cleanup
  for(let i=_spaceArcs.length-1;i>=0;i--){
    const arc=_spaceArcs[i];
    const age=_nowSec-arc.born;
    if(age>=arc.life){
      scene.remove(arc.line);
      if(arc.line.geometry)arc.line.geometry.dispose();
      if(arc.line.material)arc.line.material.dispose();
      _spaceArcs.splice(i,1);
    }else{
      arc.line.material.opacity=.9*(1-age/arc.life);
    }
  }
}

