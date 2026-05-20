// js/worlds/arctic.js — arctic world builders + update + collision checks
// Non-module script.

'use strict';

// Per-world state (uit main.js verhuisd) — gereset in core/scene.js buildScene().
let _arcticIcePatches=[],_arcticAurora=[],_arcticBlizzardGeo=null;

// Sin LUT alias — gedeeld via js/core/math-luts.js. Fallback naar Math.sin.
const _arcSin = (typeof window !== 'undefined' && window._sharedSin) ? window._sharedSin : Math.sin;
let _arcticCrystalMatA=null, _arcticCrystalMatB=null;  // Phase 13C — crystal pulse refs

// Single source of truth for arctic day lighting. Mirrors the cross-world
// helper pattern (sandstorm/candy/volcano) — buildArcticEnvironment +
// night.js arctic-day branch share the same constants.
//
// Goal palette (cool clear-sky):
//   sun #aaccff (cool blue-white) / 0.8
//   ambient #445566 (cool slate) / 0.45
//   hemi sky #6688aa / ground #223344 / 0.30
function _applyArcticDayLighting(){
  if(!sunLight||!ambientLight||!hemiLight)return;
  sunLight.color.setHex(0xaaccff); sunLight.intensity=.8;
  ambientLight.color.setHex(0x445566); ambientLight.intensity=.45;
  hemiLight.color.setHex(0x6688aa);
  hemiLight.groundColor.setHex(0x223344);
  hemiLight.intensity=.30;
  // PBR-upgrade Brok 1b: per-wereld ambient/hemi-mul knop. Default 1.0.
  const _v=(typeof window.getWorldVisuals==='function')?window.getWorldVisuals(activeWorld):null;
  if(_v){ ambientLight.intensity*=_v.ambientMul; hemiLight.intensity*=_v.hemiMul; }
}
if(typeof window!=='undefined')window._applyArcticDayLighting=_applyArcticDayLighting;

function buildArcticEnvironment(){
  // Weather reset — Arctic is a snow biome, rain would clash with the blizzard
  // identity. Clear leaked rain state from a previous world or title toggle.
  // Snow visuals come from the blizzard particles built below + updateArcticWorld.
  if(typeof isRain!=='undefined'&&isRain){
    isRain=false;
    if(typeof _rainTarget!=='undefined')_rainTarget=0;
    if(typeof _rainIntensity!=='undefined')_rainIntensity=0;
    if(rainCanvas)rainCanvas.style.display='none';
  }
  if(typeof _weatherMode!=='undefined')_weatherMode='snow';
  // Phase 4 graphics upgrade: ProcTextures.iceSurface() vervangt
  // _iceGroundTex — geeft sub-surface crackle + cyaan blue-shift dat
  // de flat 0xccddee plane miste. Tileable, mobile-halve via _sizeFor.
  var _iceGroundMap=(window.ProcTextures&&ProcTextures.iceSurface)
    ? ProcTextures.iceSurface({repeatX:12,repeatY:12,sparkle:0.5})
    : _iceGroundTex();
  var g=new THREE.Mesh(new THREE.PlaneGeometry(2400,2400),
    new THREE.MeshLambertMaterial({color:0xccddee,map:_iceGroundMap}));
  g.rotation.x=-Math.PI/2;g.position.y=-.15;g.receiveShadow=true;
  g.userData._isProcGround=true; // hookable by asset-bridge if PBR ice maps loaded
  scene.add(g);
  // Sky + fog set in core/scene.js so updateSky's lerp uses world-matched colors.
  _applyArcticDayLighting();
  // Ice barriers — Phase 14: 440 losse Meshes → 1 InstancedMesh.
  // Beveled silhouet via ProcGeometry.beveledBox (mobile bevSegs:1).
  var _barrN=_mobCount(220),_barrierPos=[];
  [-1,1].forEach(function(side){
    for(var i=0;i<_barrN;i++){
      var t=i/_barrN,p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
      var nr=new THREE.Vector3(-tg.z,0,tg.x);
      _barrierPos.push({
        x:p.x+nr.x*side*BARRIER_OFF,
        z:p.z+nr.z*side*BARRIER_OFF,
        rot:Math.atan2(tg.x,tg.z)
      });
    }
  });
  ProcDecor.buildIceBarrierBatch(scene,_barrierPos,{width:.9,height:1.2,depth:1.0});
  // Background ice mountains — Phase 14: 8 losse meshes → 2 IMs (body+cap).
  // Verzonken op y=-6 zodat enkel top deel zichtbaar is.
  ProcDecor.buildIcebergBatch(scene,
    [[280,-200,45,70],[-320,-150,52,80],[-200,230,38,62],[260,180,42,68]].map(function(d){
      return {x:d[0],y:-6,z:d[1],radius:d[2],height:d[3],rot:0};
    }),
    {texRepeat:3,texSparkle:0.30,texCracks:18,includeShards:false,sides:10}
  );
  // Aurora borealis — 5 desktop, 3 mobile (per aurora eigen canvas-texture)
  var auroraColors=[0x00ff88,0x0088ff,0xaa00ff,0x00ffcc,0xff00aa];
  var _M_aur = !!window._isMobile;
  var AC = _M_aur ? 3 : 5;
  for(var i=0;i<AC;i++){
    var cvs=document.createElement('canvas');cvs.width=256;cvs.height=128;
    var ctx=cvs.getContext('2d');ctx.clearRect(0,0,256,128);
    var hex='#'+auroraColors[i].toString(16).padStart(6,'0');
    var grd=ctx.createLinearGradient(0,0,256,0);
    grd.addColorStop(0,'rgba(0,0,0,0)');grd.addColorStop(.3,hex+'88');grd.addColorStop(.7,hex+'44');grd.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=grd;ctx.fillRect(0,0,256,128);
    var tex=new THREE.CanvasTexture(cvs);
    var aurora=new THREE.Mesh(new THREE.PlaneGeometry(400+Math.random()*200,80+Math.random()*40),
      new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:.5+Math.random()*.3,
        side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));
    aurora.position.set((Math.random()-.5)*300,80+Math.random()*40,(Math.random()-.5)*300);
    aurora.rotation.y=Math.random()*Math.PI*2;scene.add(aurora);
    _arcticAurora.push({mesh:aurora,phase:Math.random()*Math.PI*2,speed:.15+Math.random()*.1});
  }
  // Blizzard particles
  var BN=_mobCount(500),bgeo=new THREE.BufferGeometry();
  var bpos=new Float32Array(BN*3);
  for(var i=0;i<BN;i++){bpos[i*3]=(Math.random()-.5)*500;bpos[i*3+1]=Math.random()*30;bpos[i*3+2]=(Math.random()-.5)*500;}
  bgeo.setAttribute('position',new THREE.Float32BufferAttribute(bpos,3));
  scene.add(new THREE.Points(bgeo,new THREE.PointsMaterial({color:0xeeeeff,size:.28,transparent:true,opacity:.75,sizeAttenuation:true})));
  _arcticBlizzardGeo=bgeo;
  // Black ice patches
  [.15,.38,.62,.82].forEach(function(t){
    var p=trackCurve.getPoint(t);
    var patch=new THREE.Mesh(new THREE.PlaneGeometry(TW*1.6,8),
      new THREE.MeshLambertMaterial({color:0x99ccdd,transparent:true,opacity:.7}));
    patch.rotation.x=-Math.PI/2;patch.position.copy(p);patch.position.y=.02;
    patch.rotation.y=Math.atan2(trackCurve.getTangent(t).x,trackCurve.getTangent(t).z);scene.add(patch);
    if(window._freezeMatrix)window._freezeMatrix(patch);
    _arcticIcePatches.push({pos:p.clone(),radius:TW*.85,cooldown:0});
  });
  // Close-to-track iceberg clusters — Phase 14: 36+ losse meshes → 2-3 IMs.
  // Desktop krijgt sub-shard skirt voor extra silhouet-leesbaarheid.
  var _closeIcebergPos=[];
  for(var i=0;i<_mobCount(18);i++){
    var tt=(i/18+Math.random()*.015)%1;
    var p=trackCurve.getPoint(tt),tgv=trackCurve.getTangent(tt).normalize();
    var nr=new THREE.Vector3(-tgv.z,0,tgv.x);
    var side=(i%2===0?1:-1)*(BARRIER_OFF+14+Math.random()*22);
    var h=5+Math.random()*8;
    _closeIcebergPos.push({
      x:p.x+nr.x*side, y:-0.3, z:p.z+nr.z*side,
      height:h, radius:3+Math.random()*2.5,
      capHeight:h*0.40, capRadius:1.8,
      rot:Math.random()*Math.PI*2
    });
  }
  ProcDecor.buildIcebergBatch(scene,_closeIcebergPos,{
    texRepeat:2,texSparkle:0.55,texCracks:24,includeShards:true
  });
  // ── Crystal clusters alongside track (sparkly) ──
  // Phase 13C — 2 shared materials zodat helft van crystals desync pulst
  // (avoid harsh strobing). Cache aan _arcticCrystalMatA/B voor update.
  var crystalM=new THREE.MeshLambertMaterial({color:0xccefff,emissive:0x4499cc,emissiveIntensity:.4,transparent:true,opacity:.75});
  var crystalM2=new THREE.MeshLambertMaterial({color:0xccefff,emissive:0x4499cc,emissiveIntensity:.4,transparent:true,opacity:.75});
  _arcticCrystalMatA = crystalM;
  _arcticCrystalMatB = crystalM2;
  for(var i=0;i<_mobCount(14);i++){
    var tt=(i/14+.04+Math.random()*.02)%1;
    var p=trackCurve.getPoint(tt),tgv=trackCurve.getTangent(tt).normalize();
    var nr=new THREE.Vector3(-tgv.z,0,tgv.x);
    var side=(i%2===0?-1:1)*(BARRIER_OFF+4+Math.random()*6);
    var cx=p.x+nr.x*side,cz=p.z+nr.z*side;
    // 3-crystal cluster — alternate materials zodat helft pulst desync
    for(var k=0;k<3;k++){
      var crMat = ((i+k) % 2 === 0) ? crystalM : crystalM2;
      var cr=new THREE.Mesh(new THREE.OctahedronGeometry(.55+Math.random()*.4,0),crMat);
      cr.position.set(cx+(Math.random()-.5)*1.8,.6+Math.random()*.8,cz+(Math.random()-.5)*1.8);
      cr.rotation.set(Math.random(),Math.random(),Math.random());
      scene.add(cr);
    }
  }
  // Snowbank mounds — Phase 14: 20 losse Meshes → 1 IM met jittered duneCap.
  var _snowMoundPos=[];
  for(var i=0;i<_mobCount(20);i++){
    var tt=(i/20+Math.random()*.012)%1;
    var p=trackCurve.getPoint(tt),tgv=trackCurve.getTangent(tt).normalize();
    var nr=new THREE.Vector3(-tgv.z,0,tgv.x);
    var side=(i%2===0?1:-1)*(BARRIER_OFF+2+Math.random()*4);
    var sz=2.5+Math.random()*1.5;
    _snowMoundPos.push({
      x:p.x+nr.x*side, z:p.z+nr.z*side,
      scaleX:sz,
      scaleY:sz*(0.4+Math.random()*0.3),
      scaleZ:sz*(1.2+Math.random()*0.4),
      rot:Math.random()*Math.PI*2
    });
  }
  ProcDecor.buildSnowMoundBatch(scene,_snowMoundPos);
  // Procedural snow trees — Phase 14: desktop-only, vult de gap waar GLTF
  // tree_frosted soms niet laadt. Multi-cone conifer met bark trunk + snow cap.
  if(!window._isMobile){
    var _snowTreePos=[];
    for(var i=0;i<14;i++){
      var tt=(i/14+0.03+Math.random()*0.025)%1;
      var p=trackCurve.getPoint(tt),tgv=trackCurve.getTangent(tt).normalize();
      var nr=new THREE.Vector3(-tgv.z,0,tgv.x);
      var side=(i%2===0?1:-1)*(BARRIER_OFF+18+Math.random()*14);
      _snowTreePos.push({
        x:p.x+nr.x*side, z:p.z+nr.z*side,
        height:4.5+Math.random()*2.5,
        rot:Math.random()*Math.PI*2
      });
    }
    ProcDecor.buildSnowTreeBatch(scene,_snowTreePos);
  }
  buildStartLine();
  // Lights
  plHeadL=new THREE.SpotLight(0xffffff,0,50,Math.PI*.16,.5);plHeadR=new THREE.SpotLight(0xffffff,0,50,Math.PI*.16,.5);
  scene.add(plHeadL);scene.add(plHeadL.target);scene.add(plHeadR);scene.add(plHeadR.target);
  plTail=new THREE.PointLight(0xff2200,0,10);scene.add(plTail);
  // Stars — 200 desktop, 100 mobile
  var sg=new THREE.SphereGeometry(.22,4,4),ssm=new THREE.MeshBasicMaterial({color:0xaaddff,transparent:true,opacity:.9});
  var SC = window._isMobile ? 100 : 200;
  stars=new THREE.InstancedMesh(sg,ssm,SC);stars.visible=true;
  var dm=new THREE.Object3D();
  for(var i=0;i<SC;i++){
    var th=Math.random()*Math.PI*2,ph=Math.random()*Math.PI*.45,r=320+Math.random()*100;
    dm.position.set(r*Math.sin(ph)*Math.cos(th),r*Math.cos(ph)*.5+100,r*Math.sin(ph)*Math.sin(th));
    dm.scale.setScalar(.5+Math.random()*1.8);dm.updateMatrix();stars.setMatrixAt(i,dm.matrix);
  }
  stars.instanceMatrix.needsUpdate=true;scene.add(stars);
  // Ice shelf signature moment — cracks lap 2, plates dip on lap 3.
  if(typeof buildArcticIceShelf==='function')buildArcticIceShelf();
  // GLTF roadside props — icebergs + snow rocks + frosted dead trees.
  if(window.spawnRoadsideProps){
    // Icebergs + snow rocks track-side.
    window.spawnRoadsideProps('arctic',{
      propKeys:['iceberg_small','iceberg_medium','snow_rock'],
      count:10, sizeHint:2.0, clusterSize:2,
      offsetMin: BARRIER_OFF + 4, offsetMax: BARRIER_OFF + 18,
    });
    // Bare frozen trees scattered further out (desktop only).
    if (!window._isMobile){
      window.spawnRoadsideProps('arctic',{
        propKeys:['tree_frosted'],
        count:7, sizeHint:4.5, clusterSize:2,
        offsetMin: BARRIER_OFF + 14, offsetMax: BARRIER_OFF + 32,
      });
      // Mid-range iceberg field at 30-55u out — bigger silhouettes that
      // read as glacier blocks behind the close iceberg+tree layer.
      // Audit flagged the 30-100u zone as 🟡; this fills the gap without
      // crowding the immediate barrier-side.
      window.spawnRoadsideProps('arctic',{
        propKeys:['iceberg_small','snow_rock'],
        count:8, sizeHint:3.5, clusterSize:1,
        offsetMin: BARRIER_OFF + 30, offsetMax: BARRIER_OFF + 55,
      });
    }
  }
  _buildArcticCloseBand();    // Phase 12A
  _buildArcticMidRing();      // Phase 11A
  _buildArcticGlacierWall();    // Phase 11B
  _buildArcticIceArch();         // Phase 12D
  _buildArcticCinematicPoles();  // Phase 13B
}

// Phase 13B — cinematic light poles langs de baan. Sodium-blauwe palette
// past bij arctic atmosphere (was eerder gepland maar nooit deployed).
function _buildArcticCinematicPoles(){
  if(typeof buildCinematicLightPole !== 'function')return;
  if(typeof trackCurve==='undefined'||!trackCurve)return;
  const ts = window._isMobile ? [0.20, 0.55, 0.85] : [0.10, 0.25, 0.40, 0.55, 0.70, 0.90];
  ts.forEach((t, i) => {
    const p = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    const ang = Math.atan2(tg.x, tg.z);
    const nr = new THREE.Vector3(-tg.z, 0, tg.x);
    const side = (i % 2 === 0) ? 1 : -1;
    const px = p.x + nr.x * (BARRIER_OFF + 2.5) * side;
    const pz = p.z + nr.z * (BARRIER_OFF + 2.5) * side;
    const facingY = (side === 1) ? ang + Math.PI / 2 : ang - Math.PI / 2;
    buildCinematicLightPole(scene, new THREE.Vector3(px, 0, pz), {
      color:     0x88aaff,
      intensity: 1.6,
      range:     18,
      height:    8,
      facingY:   facingY
    });
  });
}

// Phase 12D — signature: massive ice-arch over track at t=0.55.
// 2 pillars + halve Torus top, emissive blauw.
function _buildArcticIceArch(){
  if(typeof trackCurve==='undefined'||!trackCurve)return;
  const t = 0.55;
  const pt = trackCurve.getPoint(t);
  const tg = trackCurve.getTangent(t).normalize();
  const rotY = Math.atan2(tg.x, tg.z);
  const right = new THREE.Vector3(-tg.z, 0, tg.x);
  const mat = new THREE.MeshLambertMaterial({color:0xaaddff, emissive:0x4488cc, emissiveIntensity:0.4, transparent:true, opacity:0.9});
  // 2 pillars
  const pillarGeo = new THREE.CylinderGeometry(1.0, 1.3, 14, 8);
  [-12, 12].forEach(off => {
    const p = new THREE.Mesh(pillarGeo, mat);
    p.position.set(pt.x + right.x*off, 7, pt.z + right.z*off);
    p.userData = {_noLodCull:true};
    p.castShadow = false;
    scene.add(p);
  });
  // Halve Torus top — open onderkant zodat cars eronderdoor rijden
  const archGeo = new THREE.TorusGeometry(12, 1.5, 8, 16, Math.PI);
  const arch = new THREE.Mesh(archGeo, mat);
  arch.position.set(pt.x, 14, pt.z);
  arch.rotation.y = rotY + Math.PI/2;   // align torus plane perpendicular to tangent
  arch.userData = {_noLodCull:true};
  arch.castShadow = false;
  scene.add(arch);
}

// Phase 12A — close-band foreground: snow mounds + ice shards in 5-12u.
function _buildArcticCloseBand(){
  if(typeof _populateMidRing!=='function')return;
  // Snow mounds — low hemispherical bumps
  const moundCount = (typeof _mobCount==='function')?_mobCount(35):35;
  const moundGeo = new THREE.SphereGeometry(0.8, 6, 4, 0, Math.PI*2, 0, Math.PI/2);
  const moundMat = new THREE.MeshLambertMaterial({color:0xeeffff, emissive:0x223355, emissiveIntensity:0.2});
  const moundIm = new THREE.InstancedMesh(moundGeo, moundMat, moundCount*2);
  _populateMidRing(moundIm, {
    perSide: moundCount, offsetMin:5, offsetMax:10,
    scaleMin:0.7, scaleMax:1.8, stagger:0.2,
    yFn: () => 0
  });
  scene.add(moundIm);
  // Ice shards — small jagged icosahedrons
  const shardCount = (typeof _mobCount==='function')?_mobCount(20):20;
  const shardGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const shardMat = new THREE.MeshLambertMaterial({color:0xaaddff, emissive:0x334488, emissiveIntensity:0.4});
  const shardIm = new THREE.InstancedMesh(shardGeo, shardMat, shardCount*2);
  _populateMidRing(shardIm, {
    perSide: shardCount, offsetMin:6, offsetMax:12,
    scaleMin:0.8, scaleMax:1.6, tiltAmt:0.5, stagger:0.6,
    yFn: sc => 0.3 * sc
  });
  scene.add(shardIm);
}

// Phase 11B — verre glaciermuur als open cylinder op radius ~180u.
function _buildArcticGlacierWall(){
  const _gwSegs = window._isMobile ? 32 : 48;
  const geo = new THREE.CylinderGeometry(180, 180, 35, _gwSegs, 1, true);
  const mat = new THREE.MeshLambertMaterial({
    color: 0xaaddff, emissive: 0x223355, emissiveIntensity: 0.3,
    side: THREE.BackSide, transparent: true, opacity: 0.75
  });
  const wall = new THREE.Mesh(geo, mat);
  wall.position.y = 10;
  wall.userData = {_noLodCull:true};
  scene.add(wall);
}

// Phase 11A — ijsberg-puntjes prop ring. Single IM, hemi-buried cones.
function _buildArcticMidRing(){
  if(typeof _populateMidRing!=='function')return;
  const perSide = (typeof _mobCount==='function')?_mobCount(40):40;
  const geo = new THREE.ConeGeometry(2.5, 8, 6);
  const mat = new THREE.MeshLambertMaterial({color:0xcceeff, emissive:0x112233, emissiveIntensity:0.6});
  const im  = new THREE.InstancedMesh(geo, mat, perSide*2);
  _populateMidRing(im, {
    perSide: perSide, offsetMin:20, offsetMax:50,
    scaleMin:0.6, scaleMax:1.9, tiltAmt:0.2,
    yFn: sc => -2 * sc   // half-buried (h=8, y=-h*0.25*sc)
  });
  scene.add(im);
}


function updateArcticWorld(dt){
  var t=_nowSec;
  // Phase 13C — crystal emissive pulse, 2 desync rhythms
  if(_arcticCrystalMatA){
    _arcticCrystalMatA.emissiveIntensity = 0.30 + Math.sin(t*1.2)*0.20;
  }
  if(_arcticCrystalMatB){
    _arcticCrystalMatB.emissiveIntensity = 0.30 + Math.sin(t*1.2 + 1.7)*0.20;
  }
  if(typeof updateArcticIceShelf==='function'){
    var pl=carObjs[playerIdx];
    updateArcticIceShelf(dt, pl?pl.lap:1);
  }
  // Subtle aurora-band drift in sky background
  if(scene&&scene.background&&scene.background.isTexture){
    scene.background.offset.x=(scene.background.offset.x+dt*.003)%1;
  }
  for(var _aui=0;_aui<_arcticAurora.length;_aui++){
    var a=_arcticAurora[_aui];
    a.phase+=dt*a.speed;
    // LUT-versie + epsilon-gated opacity/scale writes. Position-x is een
    // incrementele drift (delta-write) dus die blijft elke frame, net als
    // de continue rotation.y.
    const _op=.35+_arcSin(a.phase)*.25;
    if(a._lastOp===undefined || Math.abs(_op-a._lastOp)>0.003){
      a._lastOp=_op;
      a.mesh.material.opacity=_op;
    }
    a.mesh.position.x+=_arcSin(a.phase*.3+_aui)*dt*.8;
    // Sessie 06c — slow shimmer rotation around Y so the aurora bands
    // appear to undulate, plus a tiny scale-pulse so the colour-strands
    // feel like they're breathing.
    a.mesh.rotation.y += dt * 0.03 * (a.speed>0.2?1:-1);
    var _arS = 1.0 + _arcSin(a.phase*1.6)*0.05;
    if(a._lastS===undefined || Math.abs(_arS-a._lastS)>0.003){
      a._lastS=_arS;
      a.mesh.scale.set(_arS, 1.0, 1.0);
    }
  }
  if(_arcticBlizzardGeo){
    var pos=_arcticBlizzardGeo.attributes.position.array;
    var car=carObjs[playerIdx],cx=car?car.mesh.position.x:0,cz=car?car.mesh.position.z:0;
    var step=Math.floor(t*40)%60||1;
    for(var i=step;i<Math.min(step+60,pos.length/3);i++){
      pos[i*3]+=dt*(2.5+Math.sin(t*.3+i)*1.2);pos[i*3+1]-=dt*(1+Math.random()*.5);
      if(pos[i*3+1]<-.5||Math.abs(pos[i*3]-cx)>260){
        pos[i*3]=cx+(Math.random()-.5)*480;pos[i*3+1]=25+Math.random()*8;pos[i*3+2]=cz+(Math.random()-.5)*480;
      }
    }
    _arcticBlizzardGeo.attributes.position.needsUpdate=true;
  }
  for(var _ipi=0;_ipi<_arcticIcePatches.length;_ipi++){
    var ip=_arcticIcePatches[_ipi];
    ip.cooldown=Math.max(0,ip.cooldown-dt);
    var car2=carObjs[playerIdx];if(!car2||ip.cooldown>0)continue;
    var dx2=car2.mesh.position.x-ip.pos.x,dz2=car2.mesh.position.z-ip.pos.z;
    if(dx2*dx2+dz2*dz2<ip.radius*ip.radius){
      car2.speed*=.92;camShake=Math.max(camShake,.25);
      playWorldEvent('ice');
      if(Math.random()<.03)showPopup('🧊 BLACK ICE!','#aaddff',800);
      ip.cooldown=1;
    }
  }
  // Snow-drift per-car emitter verwijderd: spawnde elke 2 frames een witte
  // puff achter alle 13 auto's en was de zwaarste smear-bron op Arctic.
  // Speed-trail vonkjes (visuals.js:updateBoostTrail met _BOOST_TRAIL_TINT.arctic)
  // + drift-splash (visuals.js:_TIRE_SPLASH_CFG.arctic) blijven het sneeuw-
  // gevoel dragen zonder de auto-silhouet te overstemmen.
}

