// js/worlds/deepsea.js — deepsea world builders + update + collision checks
// Non-module script.

'use strict';

// Per-world state (uit main.js verhuisd) — gereset in core/scene.js buildScene().
let _kelpList=[];
let _jellyfishList=[];
let _dsaBubbleGeo=null,_dsaBubblePos=null;
let _dsaLightRays=[];
let _dsaBioEdges=[];
let _dsaCreatures={manta:null,whale:null,fishSchools:[]};
let _dsaTreasures=[];

// Sin LUT alias — gedeeld via js/core/math-luts.js (~270 trig calls/frame
// op fish schools weg). Fallback naar Math.sin als math-luts niet geladen.
const _dsaSin = (typeof window !== 'undefined' && window._sharedSin) ? window._sharedSin : Math.sin;
const _dsaCos = (typeof window !== 'undefined' && window._sharedCos) ? window._sharedCos : Math.cos;
// Hoisted scratch Object3D for fish-school instance updates — avoids a
// fresh Object3D + Matrix4 alloc per fish school per frame in updateDeepSeaWorld.
let _dsaFishDummy=null;
let _dsaCurrentDir=0; // flowing current angle for physics
let _dsaFrame=0; // per-frame counter for mobile staggering
// var (niet const) — script-globaal voor cross-script reset in core/scene.js.
var _wpCurrentStreams=[],_wpAbyssCracks=[],_wpTreasureTrail=[];

// ── Deep Sea atmosfeer- en bodem-knoppen (fase 1, live-tweakbaar) ────────
// Named constants voor de afgrond-sfeer. Tweaken zonder rebuild-ritueel:
// kleuren pakken bij volgende buildScene mee; density wordt op buildScene
// vastgezet via _isMobile-switch in core/scene.js.
const DS_FOG_COLOR_DAY        = 0x001828; // diep marineblauw, matcht skybox-foot (#001825)
const DS_FOG_COLOR_NIGHT      = 0x000812; // bijna-zwart voor nacht-mode
const DS_FOG_DENSITY_DESKTOP  = 0.0028;   // FogExp2 — ~99% opaak rond ~1070u (3/d)
const DS_FOG_DENSITY_MOBILE   = 0.0020;   // 30% dunner voor LOW-tier leesbaarheid
const DS_FLOOR_BASE_COLOR     = 0x1a2830; // match track asphalt (was 0x2a3540 — leesde grijs naast cyaan track)
const DS_FLOOR_RELIEF_AMP     = 3.5;      // max vertex-displacement (units)
const DS_TRACK_FLATTEN_RADIUS = 26;       // vlakgemaakt binnen X u van trackCurve (4u defense-in-depth buffer t.o.v. SAMPLES=200 max fout ~3.75u)
const DS_CAM_FAR              = 800;      // afgestemd op fog-cutoff (~2/d desktop)

// ── Solid-volume PBR helper ──────────────────────────────────────────────
//
// Proef-conversie (Deep Sea-specifiek): solid-volume props krijgen op
// desktop een MeshStandardMaterial met envTag 'aqua-wet' of 'aqua-metal'
// zodat ze IBL-reflectie pakken (onderwater glossy look).
// Mobile blijft Lambert om PBR-shader-kosten te vermijden op LOW-tier
// waar de reflection probe toch uit staat. Glow-laag (current arrow 0.9
// emissive, treasure chest+ring, coral fan 0.4 animated, scattered coins
// 0.5 emissive) gaat hier NIET doorheen — die blijven Lambert.
//
// Usage:
//   const mat = _dsMat({color:0x334455}, {metalness:0.30, roughness:0.55}, 'aqua-metal');
function _dsMat(lambertDef, stdExtras, tag){
  if(window._isMobile) return new THREE.MeshLambertMaterial(lambertDef);
  const mat = new THREE.MeshStandardMaterial(Object.assign({}, lambertDef, stdExtras));
  mat.userData = mat.userData || {};
  mat.userData.envTag = tag;
  return mat;
}

// ── Bodem-reliëf + procedurale silt-textuur ─────────────────────────────
// _displaceSeaFloorVertices: vervormt local-z (= world-y na rotation.x=-π/2)
// via gestapelde sinussen. Vertices binnen DS_TRACK_FLATTEN_RADIUS worden
// vlak gehouden zodat de baan zelf cosmetisch en functioneel ongemoeid blijft.
// Eenmalige build-time kosten: ~SEG² × 40 dist-checks (<120ms op LOW).
function _displaceSeaFloorVertices(geo, curve){
  if(!curve) return;
  const pos = geo.attributes.position;
  // 200 samples → ~7.5u spacing op ~1500u-track → max nearest-sample-fout
  // ~3.75u. Vertices binnen ware DS_TRACK_FLATTEN_RADIUS worden nu
  // betrouwbaar als flat geklassificeerd; voorkomt zwarte driehoeken die
  // door het wegdek prikten bij SAMPLES=40 (sample-spacing ~37u).
  const SAMPLES = 200;
  const trackPts = new Array(SAMPLES);
  for(let i=0; i<SAMPLES; i++) trackPts[i] = curve.getPoint(i/SAMPLES);
  for(let v=0; v<pos.count; v++){
    // Local x → world x. Local y → -world z (na rotation.x=-π/2).
    const x = pos.getX(v);
    const z = -pos.getY(v);
    let dMin = Infinity;
    for(let s=0; s<SAMPLES; s++){
      const dx = x - trackPts[s].x, dz = z - trackPts[s].z;
      const d2 = dx*dx + dz*dz;
      if(d2 < dMin) dMin = d2;
    }
    const dist = Math.sqrt(dMin);
    // 0..1 fade-out tussen flatten-radius en +28u; daarbinnen volledig vlak.
    const flatten = Math.max(0, Math.min(1, (dist - DS_TRACK_FLATTEN_RADIUS) / 28));
    // Gestapelde sinussen — drie freqs voor lange diepzee-richels + grovere hill-ruis.
    const ny =
        Math.sin(x*0.018) * Math.cos(z*0.022) * 0.6
      + Math.sin(x*0.05 + 1.7) * 0.25
      + Math.sin((x+z)*0.012) * 0.15;
    pos.setZ(v, ny * DS_FLOOR_RELIEF_AMP * flatten);
  }
  pos.needsUpdate = true;
}


function buildCurrentStreams(){
  const defs=[{t:.20,side:1},{t:.45,side:-1},{t:.70,side:1}];
  defs.forEach((def,di)=>{
    const p=trackCurve.getPoint(def.t),tg=trackCurve.getTangent(def.t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const pushDir=nr.clone().multiplyScalar(def.side);
    // Blue arrow strips showing current direction
    const arrowMat=new THREE.MeshLambertMaterial({color:0x00ccee,emissive:0x0077aa,emissiveIntensity:.9,transparent:true,opacity:.55});
    for(let i=-2;i<=2;i++){
      const ap=p.clone().addScaledVector(tg,i*3.5);
      const arr=new THREE.Mesh(new THREE.ConeGeometry(.8,2,4),arrowMat);
      arr.rotation.x=-Math.PI/2;arr.rotation.z=def.side>0?-Math.PI/2:Math.PI/2;
      arr.position.copy(ap);arr.position.y=.04;scene.add(arr);
    }
    // Glowing band on track
    const band=new THREE.Mesh(new THREE.PlaneGeometry(TW*1.8,18),
      _dsMat({color:0x0088bb,emissive:0x004466,transparent:true,opacity:.30},{metalness:0.0,roughness:0.75},'aqua-wet'));
    band.rotation.x=-Math.PI/2;band.position.copy(p);band.position.y=.016;scene.add(band);
    _wpCurrentStreams.push({pos:p.clone(),pushDir:pushDir.clone(),radius:TW,len:9,strength:2.8,cooldown:0});
  });
}

function checkCurrentStreams(dt){
  const car=carObjs[playerIdx];
  _wpCurrentStreams.forEach(cs=>{
    const d=car.mesh.position.distanceTo(cs.pos);
    if(d<cs.radius+6){
      // Lateral push proportional to proximity
      const push=cs.strength*(1-Math.max(0,d-cs.radius)/6)*dt;
      car.mesh.position.addScaledVector(cs.pushDir,push);
      if(d<cs.radius&&Math.random()<.04)showPopup('🌊 CURRENT!','#00ddee',400);
    }
  });
}


function buildAbyssCracks(){
  const defs=[{t:.33},{t:.60},{t:.88}];
  defs.forEach(def=>{
    const p=trackCurve.getPoint(def.t),tg=trackCurve.getTangent(def.t).normalize();
    const angle=Math.atan2(tg.x,tg.z);
    // Dark jagged crack geometry (two thin dark planes at angles)
    const crackMat=_dsMat({color:0x000508,emissive:0x000000,transparent:true,opacity:.75},{metalness:0.0,roughness:0.90},'aqua-wet');
    [-1,1].forEach(s=>{
      const crack=new THREE.Mesh(new THREE.PlaneGeometry(TW*.75,6),crackMat);
      crack.rotation.x=-Math.PI/2;crack.rotation.z=s*.15;
      crack.position.copy(p);crack.position.y=.03;crack.rotation.y=angle;
      crack.position.addScaledVector(new THREE.Vector3(-tg.z,0,tg.x),s*TW*.28);
      scene.add(crack);
    });
    // Dark bio-glow rim
    const rim=new THREE.Mesh(new THREE.PlaneGeometry(TW*1.4,6.5),
      _dsMat({color:0x001a22,emissive:0x00ffff,emissiveIntensity:.12,transparent:true,opacity:.2},{metalness:0.0,roughness:0.75},'aqua-wet'));
    rim.rotation.x=-Math.PI/2;rim.position.copy(p);rim.position.y=.025;scene.add(rim);
    _wpAbyssCracks.push({pos:p.clone(),radius:TW*.65,len:3,cooldown:0});
  });
}

function checkAbyssCracks(dt){
  const car=carObjs[playerIdx];
  _wpAbyssCracks.forEach(ac=>{
    ac.cooldown=Math.max(0,ac.cooldown-dt);
    const d=car.mesh.position.distanceTo(ac.pos);
    if(d<ac.radius+2&&ac.cooldown<=0&&Math.abs(car.speed)>.15){
      car.speed*=Math.pow(0.93,dt*60); // moderate drag
      if(d<ac.radius&&Math.random()<.05){showPopup('🕳 ABYSS CRACK!','#00ffff',500);ac.cooldown=2.5;}
    }
  });
}


function buildTreasureTrail(){
  const _M = !!window._isMobile;
  const trailCount = _M ? 6 : 12;
  for(let i=0;i<trailCount;i++){
    const t=(i/trailCount+.08)%1;
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    // Offset slightly outside track edge
    const offset=(Math.random()>.5?1:-1)*(TW+3+Math.random()*4);
    const pos=p.clone().addScaledVector(nr,offset);pos.y=2.0;
    const g=new THREE.Group();g.position.copy(pos);
    // Golden treasure chest shape (box + lid) — fase 1B: solid-volume naar
    // _dsMat met aqua-metal tag. Emissive capped op 0.4 per herontwerp-regel
    // (mits geen additive blending — geldt hier, deze meshes zijn opaque).
    const chestMat=_dsMat({color:0xddaa00,emissive:0x886600,emissiveIntensity:.4},{metalness:0.40,roughness:0.45},'aqua-metal');
    const box=new THREE.Mesh(new THREE.BoxGeometry(.9,.65,.65),chestMat);
    box.position.y=-.1;g.add(box);
    const lid=new THREE.Mesh(new THREE.BoxGeometry(.9,.3,.65),
      _dsMat({color:0xffcc00,emissive:0xaa8800,emissiveIntensity:.4},{metalness:0.40,roughness:0.45},'aqua-metal'));
    lid.position.y=.3;g.add(lid);
    // Glow ring
    const rng=new THREE.Mesh(new THREE.TorusGeometry(1,.1,6,20),
      new THREE.MeshLambertMaterial({color:0xffdd33,emissive:0xffaa00,emissiveIntensity:1.2,transparent:true,opacity:.7}));
    rng.rotation.x=Math.PI/2;g.add(rng);
    scene.add(g);
    // Light cap (2026-05-15): Deep Sea hit ~99 PointLights, forcing every Lambert
    // material into a 99-iteration light-loop per fragment → 5-sec freeze after
    // GO on mid-tier desktop GPUs. Treasure chests already have emissive
    // materials (chest + lid + ring) at intensity 0.7-1.2; bloom carries the
    // "glow" feel without the PointLight surcharge. Keep all 12 chests visible.
    _wpTreasureTrail.push({mesh:g,pos:pos.clone(),radius:2.5,collected:false,respawn:20,light:null,timer:0});
  }
}

function checkTreasureTrail(dt){
  const car=carObjs[playerIdx];if(!car)return;
  const now=_nowSec;
  _wpTreasureTrail.forEach(tr=>{
    if(tr.collected){
      if(now>tr.respawnAt){tr.collected=false;tr.mesh.visible=true;if(tr.light)tr.light.intensity=1.4;}
      return;
    }
    // Gentle float animation
    tr.mesh.rotation.y+=.03;tr.mesh.position.y=tr.pos.y+Math.sin(now*1.8+tr.pos.x)*.3;
    const d=car.mesh.position.distanceTo(tr.pos);
    if(d<tr.radius){
      tr.collected=true;tr.respawnAt=now+tr.respawn;
      tr.mesh.visible=false;if(tr.light)tr.light.intensity=0;
      totalScore+=150;
      sparkSystem.emit(tr.pos.x,tr.pos.y,tr.pos.z,0,.05,0,14,.9,.8,.1,.7);
      showPopup('💰 TREASURE! +150','#ffdd33',700);
    }
  });
}


async function buildDeepSeaEnvironment(){
  // Weather reset — rain is physically absurd underwater. Clear leaked state
  // from a previous world (or the title-screen rain toggle).
  if(typeof isRain!=='undefined'&&isRain){
    isRain=false;
    if(typeof _rainTarget!=='undefined')_rainTarget=0;
    if(typeof _rainIntensity!=='undefined')_rainIntensity=0;
    if(rainCanvas)rainCanvas.style.display='none';
  }
  // 2026-05-15 — chunk the 14 sub-builders with task-boundary yields between
  // batches. Previously this ran sync in one tick (~500-1500ms blocking on
  // mid-tier desktop) which combined with the post-countdown shader-compile
  // spike gave a "page unresponsive" feel. _yieldBuild is awaitable in any
  // scene.js context (scene.js:1377 already does `await buildDeepSeaEnvironment()`).
  const Y=(typeof _yieldBuild==='function')?_yieldBuild:()=>Promise.resolve();
  buildSeaFloor();
  buildCoralReefs();
  await Y();
  buildKelp();
  buildShipwreck();
  buildSubmarineStation();
  buildSeaGate();
  buildBioluminescentTrackEdges();
  await Y();
  buildJellyfish();
  buildSeaCreatures();
  await Y();
  buildDeepSeaBubbles();
  buildDeepSeaLightRays();
  buildDeepSeaNightObjects();
  await Y();
  // GLTF roadside props (coral chunks / wreck boxes). No-op if cache is
  // empty; deepsea's procedural kelp + jellyfish setup is unaffected.
  if(window.spawnRoadsideProps){
    window.spawnRoadsideProps('deepsea',{
      propKeys:['coral_small','coral_medium','wreck_box'],
      count:8, sizeHint:1.6, clusterSize:2,
    });
    // Closer coral-cluster band at 6-18u beyond barrier — fills the
    // immediate side-of-track zone the audit flagged as schraal. Smaller
    // sizeHint so the props read as anemone-ish reef detail rather than
    // mid-range coral pillars.
    window.spawnRoadsideProps('deepsea',{
      propKeys:['coral_small'],
      count:_mobCount(12), sizeHint:1.1, clusterSize:2,
      offsetMin: BARRIER_OFF + 6, offsetMax: BARRIER_OFF + 18,
    });
  }
  await Y();
  _buildDeepseaCloseBand();  // Phase 12A
  _buildDeepseaMidRing();    // Phase 11A
  _buildDeepseaMidVariety(); // Phase 12B
  _buildDeepseaFogFade();    // Phase 11C
  _buildDeepseaWhaleArch();  // Phase 12D
}

// Phase 12D — signature: whale-skeleton arch over track at t=0.45.
// 12 ribs hanging from a central spine, bone-cream color.
function _buildDeepseaWhaleArch(){
  if(typeof trackCurve==='undefined'||!trackCurve)return;
  const t = 0.45;
  const pt = trackCurve.getPoint(t);
  const tg = trackCurve.getTangent(t).normalize();
  const rotY = Math.atan2(tg.x, tg.z);
  const mat = _dsMat({color:0xeeddcc, emissive:0x554433, emissiveIntensity:0.18},{metalness:0.0,roughness:0.50},'aqua-wet');
  const group = new THREE.Group();
  group.position.set(pt.x, 0, pt.z);
  group.rotation.y = rotY;
  group.userData = {_noLodCull:true};
  // Central spine — horizontal cylinder along tangent
  const spineGeo = new THREE.CylinderGeometry(0.4, 0.4, 22, 8);
  const spine = new THREE.Mesh(spineGeo, mat);
  spine.position.set(0, 14, 0);
  spine.rotation.z = Math.PI/2;  // align horizontal
  group.add(spine);
  // 12 ribs — curved bone arcs hanging from spine
  const ribGeo = new THREE.TorusGeometry(7, 0.3, 6, 10, Math.PI);
  for(let i=0;i<12;i++){
    const offset = -10 + i * (20/11);  // distribute 12 ribs along spine length
    const rib = new THREE.Mesh(ribGeo, mat);
    rib.position.set(offset, 14, 0);
    rib.rotation.y = Math.PI/2;  // arc opening downward
    group.add(rib);
  }
  // Disable shadow on all kids
  group.traverse(o => { if(o.isMesh) o.castShadow = false; });
  scene.add(group);
}

// Phase 12B — mid-band variety: magenta coral-fans (PlaneGeometry pairs
// cross-plane voor 360° silhouet). Geeft kleur-contrast tegen de cyaan
// sea-spires van Phase 11A.
function _buildDeepseaMidVariety(){
  if(typeof _populateMidRing!=='function')return;
  const fanCount = (typeof _mobCount==='function')?_mobCount(35):35;
  const fanGeo = new THREE.PlaneGeometry(2, 3);
  // Fase 1B: solid-volume met alpha (geen additive) → _dsMat aqua-wet.
  // Emissive al op cap 0.4.
  const fanMat = _dsMat(
    {color:0xff66aa, emissive:0xff3388, emissiveIntensity:0.4,
     side:THREE.DoubleSide, transparent:true, opacity:0.85},
    {metalness:0.0, roughness:0.55},
    'aqua-wet'
  );
  // Cross-plane: 2 IM, 90° rotation offset
  const fan1 = new THREE.InstancedMesh(fanGeo, fanMat, fanCount*2);
  _populateMidRing(fan1, {
    perSide: fanCount, offsetMin:20, offsetMax:50,
    scaleMin:0.7, scaleMax:1.6, stagger:0.5,
    yFn: sc => 1.5 * sc
  });
  scene.add(fan1);
  // 2e IM op zelfde offset met andere random seed → effectief 2× density.
  // Per-instance random Y-rotation (default in _populateMidRing) zorgt
  // voor 360° silhouet over de hele groep.
  const fan2 = new THREE.InstancedMesh(fanGeo, fanMat, fanCount*2);
  _populateMidRing(fan2, {
    perSide: fanCount, offsetMin:20, offsetMax:50,
    scaleMin:0.7, scaleMax:1.6, stagger:0.85,
    yFn: sc => 1.5 * sc
  });
  scene.add(fan2);
}

// Phase 12A — close-band: rock-clusters + seashells.
function _buildDeepseaCloseBand(){
  if(typeof _populateMidRing!=='function')return;
  // Rock clusters — basaltic. Phase 14: capped CylinderGeometry met
  // per-vertex kleur-gradient (donker bodem → koeler grijsgroen top) +
  // lichte radial vertex-jitter op zijwand-vertices. Closed cylinder (NIET
  // organicCylinder die openEnded is — die toonde zwarte tops als de
  // camera schuin omlaag keek over de seabed).
  const rockCount = (typeof _mobCount==='function')?_mobCount(25):25;
  const _mobile_dr = !!window._isMobile;
  const rockGeo = new THREE.CylinderGeometry(0.3, 0.5, 1.5, _mobile_dr?5:8, 2);
  // Per-vertex kleur — depth → light. Cap-vertices krijgen de end-kleuren.
  const _pos = rockGeo.attributes.position;
  const _col = new Float32Array(_pos.count*3);
  const _cBot = new THREE.Color(0x102028);
  const _cTop = new THREE.Color(0x355055);
  const _ct   = new THREE.Color();
  let _yMin = Infinity, _yMax = -Infinity;
  for(let i=0;i<_pos.count;i++){ const y=_pos.getY(i); if(y<_yMin)_yMin=y; if(y>_yMax)_yMax=y; }
  const _yR = _yMax - _yMin || 1;
  for(let i=0;i<_pos.count;i++){
    const t = (_pos.getY(i) - _yMin) / _yR;
    _ct.copy(_cBot).lerp(_cTop, t);
    _col[i*3]=_ct.r; _col[i*3+1]=_ct.g; _col[i*3+2]=_ct.b;
  }
  rockGeo.setAttribute('color', new THREE.BufferAttribute(_col,3));
  // Lichte radial jitter op zijwand-vertices (Y binnen de cilinder, niet
  // cap-vertices die op Y=±0.75 zitten met radius 0). Skip center-cap
  // vertices (waar |x|+|z| ≈ 0).
  for(let i=0;i<_pos.count;i++){
    const x=_pos.getX(i), z=_pos.getZ(i);
    const r=Math.hypot(x,z);
    if(r<0.05) continue;            // cap center — niet verplaatsen
    const ang=Math.atan2(z,x);
    const jit=(Math.sin(i*7.31)+Math.cos(i*3.13))*0.04;
    _pos.setX(i, x+Math.cos(ang)*jit);
    _pos.setZ(i, z+Math.sin(ang)*jit);
  }
  _pos.needsUpdate=true;
  rockGeo.computeVertexNormals();
  const rockMat = _dsMat({
    vertexColors:true,
    emissive:0x002244, emissiveIntensity:0.2
  },{metalness:0.0,roughness:0.50},'aqua-wet');
  const rockIm = new THREE.InstancedMesh(rockGeo, rockMat, rockCount*2);
  _populateMidRing(rockIm, {
    perSide: rockCount, offsetMin:4, offsetMax:10,
    scaleMin:0.6, scaleMax:1.5, tiltAmt:0.3, stagger:0.4,
    yFn: sc => 0.6 * sc
  });
  scene.add(rockIm);
  // Seashells — small cream-colored spheres
  const shellCount = (typeof _mobCount==='function')?_mobCount(20):20;
  const shellGeo = new THREE.SphereGeometry(0.25, 6, 4);
  const shellMat = _dsMat({color:0xeeddbb, emissive:0x554422, emissiveIntensity:0.3},{metalness:0.0,roughness:0.50},'aqua-wet');
  const shellIm = new THREE.InstancedMesh(shellGeo, shellMat, shellCount*2);
  _populateMidRing(shellIm, {
    perSide: shellCount, offsetMin:4, offsetMax:10,
    scaleMin:0.7, scaleMax:1.4, stagger:0.7,
    yFn: () => 0.12
  });
  scene.add(shellIm);
}

// Phase 11C — seafloor fog-fade ring. Open-cylinder met conische taper
// (radius bottom > top) zodat de far-edge in de abyssal mist verdwijnt.
// BackSide + transparent zodat het van binnen-uit-gezien werkt.
function _buildDeepseaFogFade(){
  const geo = new THREE.CylinderGeometry(280, 350, 12, 32, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color:0x000a1a, transparent:true, opacity:0.55,
    side:THREE.BackSide, depthWrite:false
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.y = -3;
  ring.userData = {_noLodCull:true};
  scene.add(ring);
}

// Phase 11A — sea-spires (taps cylinders) met sparse bioluminescent lights.
function _buildDeepseaMidRing(){
  if(typeof _populateMidRing!=='function')return;
  const perSide = (typeof _mobCount==='function')?_mobCount(55):55;
  const geo = new THREE.CylinderGeometry(0.18, 0.75, 8, 5);
  const mat = _dsMat({color:0x003344, emissive:0x00ffcc, emissiveIntensity:0.15},{metalness:0.0,roughness:0.75},'aqua-wet');
  const im  = new THREE.InstancedMesh(geo, mat, perSide*2);
  _populateMidRing(im, {
    perSide: perSide, offsetMin:20, offsetMax:55,
    scaleMin:0.5, scaleMax:1.8, tiltAmt:0.1,
    yFn: sc => 3 * sc
  });
  scene.add(im);
  // Sparse bioluminescent point lights along the spire ring (every ~20th
  // position) — placed offline from the IM via getPoints sampling.
  if(typeof trackCurve==='undefined'||!trackCurve)return;
  if(typeof trackLightList==='undefined')return;
  // 2026-05-15 desktop ptsCount 10→4 as part of Deep Sea light-cap. Spires
  // themselves keep emissive intensity 0.15 so the cyan glow stays visible
  // without 10 PointLights illuminating empty water.
  const pts = trackCurve.getPoints(200);
  const ptsCount = (typeof _mobCount==='function')?_mobCount(4):4;
  const step = Math.max(1, Math.floor(pts.length/ptsCount));
  for(let i=0;i<pts.length;i+=step){
    const pt = pts[i];
    const tg = trackCurve.getTangentAt(i/pts.length).normalize();
    const right = new THREE.Vector3(-tg.z,0,tg.x);
    const side = (i%(step*2)===0) ? 1 : -1;
    const off = BARRIER_OFF + 26 + Math.random()*20;
    const pl = new THREE.PointLight(0x00ffcc, 0.4, 8);
    pl.position.set(pt.x+right.x*off*side, 3, pt.z+right.z*off*side);
    scene.add(pl);
    trackLightList.push(pl);
  }
}


function buildSeaFloor(){
  // Fase 1 — afgrond-bodem met subtiel reliëf. Floor gaat door _dsMat zodat
  // hij op desktop natte-sediment IBL-reflecties oppakt via aqua-wet tag;
  // mobile valt _dsMat automatisch terug op MeshLambertMaterial.
  // roughness 0.85 = zachte natte sediment-look, geen chrome-glare.
  const SEG = window._isMobile ? 48 : 80;
  const fGeo = new THREE.PlaneGeometry(2400, 2400, SEG, SEG);
  _displaceSeaFloorVertices(fGeo, trackCurve);
  fGeo.computeVertexNormals();
  // Seafloor hergebruikt de track's eigen _buildTrackSurfaceTex (gedeclareerd
  // in js/track/track.js, top-level non-module → globaal beschikbaar). Dezelfde
  // bright-neutral basis (#9a9a9a) × DS_FLOOR_BASE_COLOR (= track asphalt
  // 0x1a2830) levert identieke dim cyaan-blauw als de track zelf. Geen aparte
  // donkere _seaFloorTex meer, geen emissive lift; floor en track zijn nu
  // visueel hetzelfde surface-domein, met alleen displacement-reliëf en kerb/
  // lane-stripe-emissive als visuele asymmetrie. lanes:0/wetness:0 = deepsea-
  // palette default; repeat 60×60 schaalt de tile-density op het 2400u plane.
  const _floorTex = _buildTrackSurfaceTex({lanes:0, wetness:0});
  _floorTex.repeat.set(60, 60);
  _floorTex.needsUpdate = true;
  const floorMat = _dsMat(
    { color: DS_FLOOR_BASE_COLOR, map: _floorTex },
    { metalness: 0.0, roughness: 0.85 },
    'aqua-wet'
  );
  const floor = new THREE.Mesh(fGeo, floorMat);
  floor.rotation.x = -Math.PI/2;
  floor.position.y = -0.18;
  floor.receiveShadow = true;
  floor.userData._isProcGround = true;
  scene.add(floor);
  // Seafloor hills — iets lichter dan basis voor zachte hoogte-read.
  const hillMat=_dsMat({color:0x35404a},{metalness:0.0,roughness:0.80},'aqua-wet');
  const hillPositions=[[210,-180,8],[-220,130,10],[150,280,7],[-80,-310,9],[300,100,6],[-310,-50,8],[80,-360,7],[-180,280,6]];
  hillPositions.forEach(([hx,hz,hr])=>{
    const hgeo=new THREE.SphereGeometry(hr+Math.random()*4,8,5);hgeo.scale(1,.38+Math.random()*.18,1);
    const h=new THREE.Mesh(hgeo,hillMat);h.position.set(hx,0,hz);h.receiveShadow=true;scene.add(h);
  });
  // Sand ripple lines — cool donker, geen warme tan meer.
  const rippleMat=_dsMat({color:0x3a4550,transparent:true,opacity:.55},{metalness:0.0,roughness:0.75},'aqua-wet');
  for(let i=0;i<30;i++){
    const r=new THREE.Mesh(new THREE.BoxGeometry(60+Math.random()*120,.05,.6),rippleMat);
    r.position.set((Math.random()-.5)*600,-.12,(Math.random()-.5)*700);
    r.rotation.y=Math.random()*Math.PI;scene.add(r);
  }
}


function buildCoralReefs(){
  const _M = !!window._isMobile;
  const coralColors=[0xff5533,0xff8800,0xff4488,0x44ddaa,0xffcc00,0xff6622,0xcc44ff,0x22ddff];
  // Reef clusters scattered off-track — halved on mobile
  const CC = _M ? 18 : 35;
  for(let ci=0;ci<CC;ci++){
    const t=(ci/CC+Math.random()*.012)%1;
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const side=(ci%2===0?1:-1)*(BARRIER_OFF+18+Math.random()*24);
    const cx=p.x+nr.x*side+(Math.random()-.5)*8,cz=p.z+nr.z*side+(Math.random()-.5)*8;
    const col=coralColors[ci%coralColors.length];
    const branches=3+Math.floor(Math.random()*4);
    for(let b=0;b<branches;b++){
      // Coral type alternates
      const type=ci%4;
      if(type===0){
        // Branch coral — thin cylinders
        const h=1.8+Math.random()*2.4;
        const seg=new THREE.Mesh(new THREE.CylinderGeometry(.12,.22,h,5),
          _dsMat({color:col,emissive:col,emissiveIntensity:.12},{metalness:0.0,roughness:0.50},'aqua-wet'));
        seg.position.set(cx+(Math.random()-.5)*3,(h/2),cz+(Math.random()-.5)*3);
        seg.rotation.set((Math.random()-.5)*.4,Math.random()*Math.PI*2,(Math.random()-.5)*.4);
        scene.add(seg);
      }else if(type===1){
        // Fan coral — flat disc
        const r=1.2+Math.random()*1.8;
        const fan=new THREE.Mesh(new THREE.CircleGeometry(r,8),
          _dsMat({color:col,emissive:col,emissiveIntensity:.10,side:THREE.DoubleSide,transparent:true,opacity:.85},{metalness:0.0,roughness:0.50},'aqua-wet'));
        fan.position.set(cx+(Math.random()-.5)*2,r*.6+Math.random()*1.2,cz+(Math.random()-.5)*2);
        fan.rotation.set(Math.PI/2+( Math.random()-.5)*.6,Math.random()*Math.PI*2,0);
        scene.add(fan);
      }else if(type===2){
        // Brain/bulb coral
        const r=.7+Math.random()*1.1;
        const bulb=new THREE.Mesh(new THREE.SphereGeometry(r,7,5),
          _dsMat({color:col,emissive:col,emissiveIntensity:.08},{metalness:0.0,roughness:0.50},'aqua-wet'));
        bulb.scale.y=.55+Math.random()*.3;
        bulb.position.set(cx+(Math.random()-.5)*2.5,r*.5,cz+(Math.random()-.5)*2.5);
        scene.add(bulb);
      }else{
        // Tube coral — tall thin cylinder
        const h=2.2+Math.random()*3;
        const tube=new THREE.Mesh(new THREE.CylinderGeometry(.18,.24,h,6),
          _dsMat({color:col,emissive:col,emissiveIntensity:.15},{metalness:0.0,roughness:0.50},'aqua-wet'));
        tube.position.set(cx+(Math.random()-.5)*2.5,h/2,cz+(Math.random()-.5)*2.5);
        tube.rotation.set((Math.random()-.5)*.3,Math.random()*Math.PI*2,(Math.random()-.5)*.3);
        scene.add(tube);
      }
    }
    // Small glow light at big coral clusters — wider stride on mobile to drop PointLight count.
    // 2026-05-15 desktop stride 6→12 as part of Deep Sea light-cap (was ~6 lights here,
    // now ~3). Coral already has emissive material at intensity 0.10-0.15 plus bloom.
    if(ci%(_M?9:12)===0){
      const pl=new THREE.PointLight(col,.8,16);pl.position.set(cx,.8,cz);scene.add(pl);
    }
  }
}


function buildKelp(){
  const _M = !!window._isMobile;
  _kelpList.length=0;
  const kelpMat=_dsMat({color:0x228833,side:THREE.DoubleSide,transparent:true,opacity:.88},{metalness:0.0,roughness:0.75},'aqua-wet');
  const KN = _M ? 14 : 30;
  for(let ki=0;ki<KN;ki++){
    const t=(ki/KN+.015)%1;
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const side=(ki%2===0?1:-1)*(BARRIER_OFF+8+Math.random()*16);
    const kx=p.x+nr.x*side+(Math.random()-.5)*5,kz=p.z+nr.z*side+(Math.random()-.5)*5;
    const strands=2+Math.floor(Math.random()*3);
    const group=new THREE.Group();group.position.set(kx,0,kz);
    for(let s=0;s<strands;s++){
      const h=4+Math.random()*7;
      const kgeo=new THREE.PlaneGeometry(.5,.8*h,1,Math.floor(h));
      // Taper top vertices
      const pos=kgeo.attributes.position;
      for(let v=0;v<pos.count;v++){const y=pos.getY(v);const taper=1-Math.max(0,y/(.8*h))*.6;pos.setX(v,pos.getX(v)*taper);}
      pos.needsUpdate=true;
      const strand=new THREE.Mesh(kgeo,kelpMat.clone());
      strand.position.set((Math.random()-.5)*2,h/2,(Math.random()-.5)*2);
      strand.rotation.y=Math.random()*Math.PI*2;
      group.add(strand);
      // Phase 11C — cross-plane: clone strand 90° offset zodat kelp van
      // alle camera-hoeken een 3D-silhouet heeft ipv transparante 1-plane
      // pop bij zijaanzicht. Mobile: skip om draw-calls te besparen.
      if(!_M){
        const strand2=strand.clone();
        strand2.rotation.y += Math.PI/2;
        group.add(strand2);
      }
    }
    group._swayPhase=Math.random()*Math.PI*2;
    group._swaySpeed=.6+Math.random()*.5;
    scene.add(group);_kelpList.push(group);
  }
}


function buildShipwreck(){
  // Tilted old ship in infield
  const woodMat=_dsMat({color:0x4a3020},{metalness:0.0,roughness:0.65},'aqua-wet');
  const darkMat=_dsMat({color:0x2a1a10},{metalness:0.0,roughness:0.75},'aqua-wet');
  // metalMat was dead — never bound to a mesh
  const hull=new THREE.Mesh(new THREE.BoxGeometry(24,6,9),woodMat);
  hull.position.set(-55,-2,-30);hull.rotation.set(.18,-.62,.22);scene.add(hull);
  // Hull bottom
  const keel=new THREE.Mesh(new THREE.BoxGeometry(26,1.5,4),darkMat);
  keel.position.set(-55,-4.5,-30);keel.rotation.copy(hull.rotation);scene.add(keel);
  // Broken main mast
  const mast1=new THREE.Mesh(new THREE.CylinderGeometry(.28,.34,10,6),woodMat);
  mast1.position.set(-48,2.5,-29);mast1.rotation.set(.55,-.3,.15);scene.add(mast1);
  // Broken second mast (fallen, horizontal)
  const mast2=new THREE.Mesh(new THREE.CylinderGeometry(.22,.28,8,6),woodMat);
  mast2.position.set(-62,1.2,-31);mast2.rotation.set(1.3,-.5,.85);scene.add(mast2);
  // Torn sail fragments
  const sailMat=_dsMat({color:0x887766,side:THREE.DoubleSide,transparent:true,opacity:.65},{metalness:0.0,roughness:0.70},'aqua-wet');
  const sail=new THREE.Mesh(new THREE.PlaneGeometry(6,4),sailMat);
  sail.position.set(-47,5,-29);sail.rotation.set(.4,-.3,.5);scene.add(sail);
  // Treasure chest
  const chestMat=_dsMat({color:0x8b5c1a},{metalness:0.0,roughness:0.65},'aqua-wet');
  const chest=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.1,1.1),chestMat);
  chest.position.set(-58,-.2,-27);scene.add(chest);
  const lid=new THREE.Mesh(new THREE.BoxGeometry(1.6,.55,1.1),_dsMat({color:0x7a4e12},{metalness:0.0,roughness:0.65},'aqua-wet'));
  lid.position.set(-58,.55,-27);lid.rotation.x=-.65;scene.add(lid);
  // Gold glow inside chest
  const treasureGlow=new THREE.PointLight(0xffcc44,1.8,8);treasureGlow.position.set(-58,.6,-27);scene.add(treasureGlow);
  // Scattered gold coins — fase 1B: solid-volume naar _dsMat met aqua-metal,
  // emissive capped op 0.4 (geen additive blending op deze meshes).
  const coinMat=_dsMat({color:0xffd700,emissive:0x886600,emissiveIntensity:.4},{metalness:0.55,roughness:0.40},'aqua-metal');
  for(let c=0;c<8;c++){
    const coin=new THREE.Mesh(new THREE.CylinderGeometry(.25,.25,.08,8),coinMat);
    coin.position.set(-58+(Math.random()-.5)*4,-.14+(Math.random()*.3),-27+(Math.random()-.5)*3);
    coin.rotation.set(Math.random()*.5,Math.random()*Math.PI*2,Math.random()*.5);
    scene.add(coin);
  }
  // Rope/chain
  for(let r=0;r<5;r++){
    const rope=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,1.8,4),darkMat);
    rope.position.set(-55+(Math.random()-.5)*8,-.3+(r*.4),-28+(Math.random()-.5)*4);
    rope.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,Math.random()*Math.PI);
    scene.add(rope);
  }
}


function buildSubmarineStation(){
  // Near S/F line — futuristic underwater base replacing pit building
  const subMat=_dsMat({color:0x334455},{metalness:0.30,roughness:0.55},'aqua-metal');
  const glowMat=new THREE.MeshBasicMaterial({color:0x00ffcc,transparent:true,opacity:.8});
  // Main dome
  const dome=new THREE.Mesh(new THREE.SphereGeometry(8,14,10,0,Math.PI*2,0,Math.PI/2),
    _dsMat({color:0x223344,transparent:true,opacity:.9},{metalness:0.30,roughness:0.55},'aqua-metal'));
  dome.position.set(40,0,310);scene.add(dome);
  // Base cylinder
  const base=new THREE.Mesh(new THREE.CylinderGeometry(8,10,3,14),subMat);
  base.position.set(40,1.5,310);scene.add(base);
  // Docking tubes extending out
  [-1,1].forEach(side=>{
    const tube=new THREE.Mesh(new THREE.CylinderGeometry(2,2,18,10),subMat);
    tube.rotation.z=Math.PI/2;tube.position.set(40+side*17,2,310);scene.add(tube);
    const cap=new THREE.Mesh(new THREE.SphereGeometry(2,10,8),subMat);
    cap.position.set(40+side*26,2,310);scene.add(cap);
  });
  // Viewing port windows (glowing circles)
  for(let w=0;w<4;w++){
    const ang=w*Math.PI/2+Math.PI/4;
    const porthole=new THREE.Mesh(new THREE.CircleGeometry(.85,12),
      new THREE.MeshBasicMaterial({color:0x44eeff,transparent:true,opacity:.75}));
    porthole.position.set(40+Math.cos(ang)*7.5,4,310+Math.sin(ang)*7.5);
    porthole.rotation.y=-ang;scene.add(porthole);
    const pl=new THREE.PointLight(0x44ddff,.9,10);pl.position.copy(porthole.position);scene.add(pl);
    trackLightList.push(pl);
  }
  // Gantry label
  const ganLblCvs=document.createElement('canvas');ganLblCvs.width=512;ganLblCvs.height=80;
  const ganCtx=ganLblCvs.getContext('2d');
  ganCtx.fillStyle='rgba(0,0,0,0)';ganCtx.fillRect(0,0,512,80);
  ganCtx.font='bold 34px Orbitron,sans-serif';ganCtx.fillStyle='#00ffcc';ganCtx.textAlign='center';
  ganCtx.fillText('DEEP SEA CIRCUIT',256,52);
  const ganTex=new THREE.CanvasTexture(ganLblCvs);
  const ganLbl=new THREE.Sprite(new THREE.SpriteMaterial({map:ganTex,transparent:true}));
  ganLbl.position.set(40,14,310);ganLbl.scale.set(28,4.5,1);scene.add(ganLbl);
  // Anchor chain
  const chainMat=_dsMat({color:0x888888},{metalness:0.30,roughness:0.45},'aqua-metal');
  for(let l=0;l<6;l++){
    const link=new THREE.Mesh(new THREE.TorusGeometry(.4,.12,4,6),chainMat);
    link.position.set(40,l*.8,310);link.rotation.y=l*.5;scene.add(link);
  }
}


function buildSeaGate(){
  // Coral arch over S/F line
  const archMat=_dsMat({color:0xff5533,emissive:0x441100,emissiveIntensity:.2},{metalness:0.30,roughness:0.50},'aqua-metal');
  const leftPillar=new THREE.Mesh(new THREE.CylinderGeometry(.8,1.2,12,8),archMat);
  leftPillar.position.set(-10,.5,230);scene.add(leftPillar);
  const rightPillar=new THREE.Mesh(new THREE.CylinderGeometry(.8,1.2,12,8),archMat);
  rightPillar.position.set(10,.5,230);scene.add(rightPillar);
  // Top arch (torus segment)
  const arch=new THREE.Mesh(new THREE.TorusGeometry(10,.9,8,12,Math.PI),
    _dsMat({color:0xff6644,emissive:0x221100,emissiveIntensity:.15},{metalness:0.30,roughness:0.50},'aqua-metal'));
  arch.position.set(0,12,230);arch.rotation.set(0,Math.PI/2,0);scene.add(arch);
  // Glow on arch pillars
  const gL=new THREE.PointLight(0xff8844,1.2,14);gL.position.set(-10,8,230);scene.add(gL);trackLightList.push(gL);
  const gR=new THREE.PointLight(0xff8844,1.2,14);gR.position.set(10,8,230);scene.add(gR);trackLightList.push(gR);
  // Hanging coral decorations
  for(let h=0;h<6;h++){
    const hangPos=new THREE.Vector3(-8+h*3.2,10.5,230);
    const hang=new THREE.Mesh(new THREE.CylinderGeometry(.08,.18,1.4+Math.random()*.8,5),
      _dsMat({color:[0xff4488,0xffcc00,0x44ffaa][h%3]},{metalness:0.0,roughness:0.50},'aqua-wet'));
    hang.position.copy(hangPos);scene.add(hang);
  }
  // S/F line canvas texture
  const sfCvs=document.createElement('canvas');sfCvs.width=256;sfCvs.height=32;
  const sfCtx=sfCvs.getContext('2d');
  sfCtx.fillStyle='rgba(0,255,200,0.4)';sfCtx.fillRect(0,0,256,32);
  for(let c=0;c<8;c++){sfCtx.fillStyle=c%2===0?'rgba(0,255,200,0.7)':'rgba(255,255,255,0.4)';sfCtx.fillRect(c*32,0,32,32);}
  const sfTex=new THREE.CanvasTexture(sfCvs);
  const sfLine=new THREE.Mesh(new THREE.PlaneGeometry(20,1.2),new THREE.MeshBasicMaterial({map:sfTex,transparent:true}));
  sfLine.rotation.x=-Math.PI/2;sfLine.position.set(0,-.1,230);scene.add(sfLine);
}


function buildBioluminescentTrackEdges(){
  _dsaBioEdges.length=0;
  const N=180;
  [1,-1].forEach(side=>{
    const geo=new THREE.BufferGeometry();
    const pos=new Float32Array(N*3);
    for(let i=0;i<N;i++){
      const t=i/(N-1);
      const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
      const nr=new THREE.Vector3(-tg.z,0,tg.x);
      pos[i*3]=p.x+nr.x*side*(TW*.5+.8);
      pos[i*3+1]=.08;
      pos[i*3+2]=p.z+nr.z*side*(TW*.5+.8);
    }
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
    const mat=new THREE.LineBasicMaterial({color:0x00ffcc,transparent:true,opacity:.95,linewidth:2,blending:THREE.AdditiveBlending,depthWrite:false});
    const line=new THREE.Line(geo,mat);
    scene.add(line);
    _dsaBioEdges.push({line,mat,phase:side>0?0:Math.PI});
  });
}


function buildJellyfish(){
  _jellyfishList.length=0;
  const N=15;
  for(let ji=0;ji<N;ji++){
    const t=(ji/N+.03)%1;
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const side=(ji%2===0?1:-1)*(BARRIER_OFF+15+Math.random()*28);
    const jx=p.x+nr.x*side+(Math.random()-.5)*12;
    const jz=p.z+nr.z*side+(Math.random()-.5)*12;
    const jy=3+Math.random()*8;
    const col=ji%3===0?0xff44cc:ji%3===1?0x44ccff:0x88ff88;
    // Bell (dome)
    const bell=new THREE.Mesh(new THREE.SphereGeometry(1.1+Math.random()*.5,8,6,0,Math.PI*2,0,Math.PI/2),
      new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.45+Math.random()*.2}));
    bell.position.set(jx,jy,jz);
    // Tentacles
    const group=new THREE.Group();group.add(bell);
    const tentMat=new THREE.LineBasicMaterial({color:col,transparent:true,opacity:.35+Math.random()*.2});
    const tentCount=6+Math.floor(Math.random()*5);
    for(let tc=0;tc<tentCount;tc++){
      const ang=tc/tentCount*Math.PI*2;
      const tentGeo=new THREE.BufferGeometry();
      const tPoints=[];const tentLen=2+Math.random()*4;
      for(let ts=0;ts<=8;ts++){
        const ty=-ts*(tentLen/8);const wave=Math.sin(ts*.8)*(.3+Math.random()*.2);
        tPoints.push(Math.cos(ang)*.6+Math.cos(ang)*wave,ty,Math.sin(ang)*.6+Math.sin(ang)*wave);
      }
      tentGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(tPoints),3));
      group.add(new THREE.Line(tentGeo,tentMat));
    }
    group.position.set(jx,jy,jz);bell.position.set(0,0,0);
    // 2026-05-15: removed per-jellyfish PointLight (-15 lights from the ~99-light
    // Deep Sea total). Bell uses MeshBasicMaterial which doesn't sample lights
    // anyway; the PL only added barely-visible ambient glow to nearby coral
    // 15+ units away. Bloom on the bell+tentacle colours carries the "glow".
    group._bobPhase=Math.random()*Math.PI*2;
    group._bobSpeed=.4+Math.random()*.35;
    group._bobAmp=.5+Math.random()*.4;
    group._driftX=(Math.random()-.5)*.008;
    group._driftZ=(Math.random()-.5)*.008;
    group._baseY=jy;
    scene.add(group);_jellyfishList.push(group);
  }
}


function buildSeaCreatures(){
  // Manta ray — gliding silhouette circling the infield
  const mantaMat=_dsMat({color:0x223344,side:THREE.DoubleSide},{metalness:0.0,roughness:0.60},'aqua-wet');
  const mantaGroup=new THREE.Group();
  // Wing shape using triangles
  const wingGeo=new THREE.BufferGeometry();
  const wv=new Float32Array([0,0,0, -7,.5,-2, -5,0,3, 7,.5,-2, 5,0,3, 0,.6,4]);
  const wi=new Uint16Array([0,1,2, 0,3,4, 0,2,5, 0,5,4]);
  wingGeo.setAttribute('position',new THREE.BufferAttribute(wv,3));
  wingGeo.setIndex(new THREE.BufferAttribute(wi,1));wingGeo.computeVertexNormals();
  const wing=new THREE.Mesh(wingGeo,mantaMat);mantaGroup.add(wing);
  const tail=new THREE.Mesh(new THREE.CylinderGeometry(.08,.02,3,4),mantaMat);
  tail.rotation.z=Math.PI/2;tail.position.set(0,.2,-2.5);mantaGroup.add(tail);
  mantaGroup.position.set(0,8,0);
  scene.add(mantaGroup);
  _dsaCreatures.manta={group:mantaGroup,t:0,speed:.018,radius:140,angle:0,wavePhase:0};

  // Distant whale — slow, high above
  const whaleMat=_dsMat({color:0x2a3a4a},{metalness:0.0,roughness:0.60},'aqua-wet');
  const whaleGroup=new THREE.Group();
  const wBody=new THREE.Mesh(new THREE.SphereGeometry(5.5,10,7),whaleMat);wBody.scale.set(1,.55,2.8);
  const wHead=new THREE.Mesh(new THREE.SphereGeometry(4,8,6),whaleMat);wHead.scale.set(.9,.5,1.2);wHead.position.set(0,0,-10);
  const wTail=new THREE.Mesh(new THREE.CylinderGeometry(1.2,.4,6,6),whaleMat);wTail.position.set(0,0,14);wTail.rotation.z=Math.PI/2;
  const wFin=new THREE.Mesh(new THREE.BoxGeometry(1.5,4,2.5),whaleMat);wFin.position.set(0,3.5,0);
  whaleGroup.add(wBody,wHead,wTail,wFin);whaleGroup.position.set(-220,38,-280);
  scene.add(whaleGroup);
  _dsaCreatures.whale={group:whaleGroup,angle:0,speed:.004,radius:85,cx:-220,cz:-280};

  // Fish schools — 3 small groups of instanced fish; per-school count reduced on mobile
  const _M_fs = !!window._isMobile;
  const fishMat=_dsMat({color:0xffaa44},{metalness:0.0,roughness:0.65},'aqua-wet');
  const fishGeo=new THREE.ConeGeometry(.4,.8,4);fishGeo.rotateX(Math.PI/2);
  for(let fs=0;fs<3;fs++){
    const count = _M_fs ? 10 : 18;
    const instMesh=new THREE.InstancedMesh(fishGeo,fishMat,count);
    const t=(fs/3+.15)%1;const p=trackCurve.getPoint(t);
    const tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const side=(fs%2===0?1:-1)*(BARRIER_OFF+20+Math.random()*25);
    const cx=p.x+nr.x*side,cz=p.z+nr.z*side,cy=4+Math.random()*5;
    const dm2=new THREE.Object3D();
    for(let fi=0;fi<count;fi++){
      dm2.position.set(cx+(Math.random()-.5)*12,cy+(Math.random()-.5)*4,cz+(Math.random()-.5)*12);
      dm2.rotation.y=Math.random()*Math.PI*2;dm2.updateMatrix();instMesh.setMatrixAt(fi,dm2.matrix);
    }
    instMesh.instanceMatrix.needsUpdate=true;scene.add(instMesh);
    _dsaCreatures.fishSchools.push({mesh:instMesh,count,cx,cy,cz,phase:Math.random()*Math.PI*2,speed:.022+Math.random()*.015,radius:18+Math.random()*10});
  }
}


function buildDeepSeaBubbles(){
  const _M = !!window._isMobile;
  const N = _M ? 180 : 400;
  const geo=new THREE.BufferGeometry();
  const pos=new Float32Array(N*3);
  const car0=carObjs[playerIdx];
  const cx=car0?car0.mesh.position.x:0,cz=car0?car0.mesh.position.z:0;
  for(let i=0;i<N;i++){
    pos[i*3]=cx+(Math.random()-.5)*500;
    pos[i*3+1]=Math.random()*25;
    pos[i*3+2]=cz+(Math.random()-.5)*500;
  }
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  const mat=new THREE.PointsMaterial({color:0xaaddff,size:.4,transparent:true,opacity:.7,sizeAttenuation:true,blending:THREE.AdditiveBlending,depthWrite:false});
  const pts=new THREE.Points(geo,mat);scene.add(pts);
  _dsaBubbleGeo=geo;_dsaBubblePos=pos;
}


function buildDeepSeaLightRays(){
  const _M = !!window._isMobile;
  _dsaLightRays.length=0;
  const rayMat=new THREE.MeshBasicMaterial({color:0x44aaff,transparent:true,opacity:.04,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false});
  const N = _M ? 4 : 8;
  for(let ri=0;ri<N;ri++){
    const t=(ri/N+.04)%1;
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const side=(ri%2===0?1:-1)*(Math.random()*50+5);
    const rx=p.x+nr.x*side+(Math.random()-.5)*40,rz=p.z+nr.z*side+(Math.random()-.5)*40;
    const h=28+Math.random()*18;
    const geo=new THREE.PlaneGeometry(3+Math.random()*3,h);
    const ray=new THREE.Mesh(geo,rayMat.clone());
    ray.position.set(rx,h/2,rz);
    ray.rotation.y=Math.random()*Math.PI*2;
    scene.add(ray);
    _dsaLightRays.push({mesh:ray,phase:Math.random()*Math.PI*2,speed:.6+Math.random()*.4,baseOp:.03+Math.random()*.05});
  }
}


function buildDeepSeaNightObjects(){
  // Stars not visible underwater, use subtle bio particles instead
  // Reuse trackLightList for coral glow poles
  const sg=new THREE.SphereGeometry(.18,4,4),sm=new THREE.MeshBasicMaterial({color:0x00ffcc,transparent:true,opacity:.8});
  stars=new THREE.InstancedMesh(sg,sm,80);stars.visible=false;
  const dm=new THREE.Object3D();
  for(let i=0;i<80;i++){
    const t=i/80;const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    dm.position.set(p.x+nr.x*(BARRIER_OFF+4),2.5,p.z+nr.z*(BARRIER_OFF+4));
    dm.scale.setScalar(.8+Math.random()*.5);dm.updateMatrix();stars.setMatrixAt(i,dm.matrix);
  }
  stars.instanceMatrix.needsUpdate=true;scene.add(stars);
  // Track lights as bioluminescent pods.
  // 2026-05-15 desktop cap 24→6 (-36 lights × 2 sides = -36 PLs; biggest single
  // contributor to the 99-light Deep Sea pile). Pod meshes use MeshBasicMaterial
  // so they self-glow without needing a PL; the PL was only there to feed bloom
  // on adjacent coral when night-mode toggles intensity. With 6×2=12 pods spaced
  // along the track the bioluminescent ring still reads.
  const _M_pods = !!window._isMobile;
  const PC = _M_pods ? 12 : 6;
  for(let li=0;li<PC;li++){
    const t=li/PC;const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    [-1,1].forEach(side=>{
      const pp=p.clone().addScaledVector(nr,side*(BARRIER_OFF+1.5));
      const pod=new THREE.Mesh(new THREE.SphereGeometry(.3,6,5),
        new THREE.MeshBasicMaterial({color:0x00ffcc,transparent:true,opacity:.9}));
      pod.position.copy(pp);pod.position.y=.3;pod.visible=false;scene.add(pod);trackPoles.push(pod);
      const pl=new THREE.PointLight(0x00ffaa,0,12);pl.position.copy(pp);pl.position.y=.3;
      scene.add(pl);trackLightList.push(pl);
    });
  }
}


function updateDeepSeaWorld(dt){
  if(!scene)return;
  const t=_nowSec;
  const _M = !!window._isMobile;
  _dsaFrame++;
  // Kelp sway — for-loop to drop per-frame closure.
  for(let _ki=0;_ki<_kelpList.length;_ki++){
    const k=_kelpList[_ki];
    k._swayPhase+=dt*k._swaySpeed;
    k.rotation.z=Math.sin(k._swayPhase)*.12;
    k.rotation.x=Math.cos(k._swayPhase*.7)*.07;
  }
  // Jellyfish bob
  for(let _ji=0;_ji<_jellyfishList.length;_ji++){
    const j=_jellyfishList[_ji];
    j._bobPhase+=dt*j._bobSpeed;
    j.position.y=j._baseY+Math.sin(j._bobPhase)*j._bobAmp;
    j.rotation.y+=dt*.15;
    // Tentacle writhe: scale bell slightly
    j.children[0].scale.y=.9+Math.sin(j._bobPhase*2.2)*.15;
  }
  // Bioluminescent edges pulse — wider amplitude, drives bloom on bright peaks
  for(let _ei=0;_ei<_dsaBioEdges.length;_ei++){
    const e=_dsaBioEdges[_ei];
    e.phase+=dt*.9;
    e.mat.opacity=.65+Math.sin(e.phase)*.35;
  }
  // Light rays pulsing
  for(let _ri=0;_ri<_dsaLightRays.length;_ri++){
    const r=_dsaLightRays[_ri];
    r.phase+=dt*r.speed;
    r.mesh.material.opacity=r.baseOp*(1+Math.sin(r.phase)*.8);
    r.mesh.rotation.y+=dt*.04;
  }
  // Bubbles rising
  if(_dsaBubbleGeo&&_dsaBubblePos){
    const pos=_dsaBubblePos;
    const car=carObjs[playerIdx];
    const cx=car?car.mesh.position.x:0,cz=car?car.mesh.position.z:0;
    let anyChange=false;
    // Update subset each frame (~40 bubbles = 10% per frame)
    const step=Math.floor(_nowSec*400)%10;
    for(let i=step;i<pos.length/3;i+=10){
      pos[i*3+1]+=.04+Math.sin(t*.5+i)*.01;
      if(pos[i*3+1]>28){
        pos[i*3]=cx+(Math.random()-.5)*480;
        pos[i*3+1]=Math.random()*2;
        pos[i*3+2]=cz+(Math.random()-.5)*480;
      }
      anyChange=true;
    }
    if(anyChange)_dsaBubbleGeo.attributes.position.needsUpdate=true;
  }
  // Manta ray orbit
  if(_dsaCreatures.manta){
    const m=_dsaCreatures.manta;
    m.angle+=dt*m.speed;
    m.wavePhase+=dt*1.2;
    const mx=Math.cos(m.angle)*m.radius,mz=Math.sin(m.angle)*m.radius;
    m.group.position.set(mx,7+Math.sin(m.wavePhase)*.9,mz);
    m.group.rotation.y=m.angle+Math.PI/2;
    m.group.rotation.z=Math.sin(m.wavePhase)*.18;
  }
  // Whale slow orbit
  if(_dsaCreatures.whale){
    const w=_dsaCreatures.whale;
    w.angle+=dt*w.speed;
    w.group.position.x=w.cx+Math.cos(w.angle)*w.radius;
    w.group.position.z=w.cz+Math.sin(w.angle)*w.radius;
    w.group.position.y=36+Math.sin(w.angle*2.3)*4;
    w.group.rotation.y=w.angle+Math.PI/2;
  }
  // Fish schools orbit — for-loop drops the forEach closure, AND the
  // dm3 Object3D is hoisted above the inner loop so it isn't allocated
  // once per fish-school per frame (one school = one Object3D + Matrix4
  // worth of GC garbage every tick).
  // On mobile, stagger fish-schools every other frame to halve per-frame matrix writes.
  if(!(_M && (_dsaFrame & 1))){
    if(_dsaFishDummy===null)_dsaFishDummy=new THREE.Object3D();
    const _dm3=_dsaFishDummy;
    const _fsList=_dsaCreatures.fishSchools;
    for(let _fsi=0;_fsi<_fsList.length;_fsi++){
      const fs=_fsList[_fsi];
      fs.phase+=dt*fs.speed;
      const fc = fs.count || 18;
      for(let fi=0;fi<fc;fi++){
        const ang=fs.phase+fi*(Math.PI*2/fc);
        // LUT-versie: 5 Math.sin/cos calls → 5 array lookups.
        _dm3.position.set(
          fs.cx+_dsaCos(ang)*fs.radius+(_dsaSin(fi*1.3+t*.5)*3),
          fs.cy+_dsaSin(fi*.8+t*.4)*2,
          fs.cz+_dsaSin(ang)*fs.radius+(_dsaCos(fi*1.1+t*.4)*3)
        );
        _dm3.rotation.y=ang+Math.PI/2;_dm3.updateMatrix();
        fs.mesh.setMatrixAt(fi,_dm3.matrix);
      }
      fs.mesh.instanceMatrix.needsUpdate=true;
    }
  }
  // Underwater current effect on player car — gentle drift, scaled by the
  // lap-progressive current signature (window._dsaCurrentDriftMult, default 1).
  if(activeWorld==='deepsea'){
    const car=carObjs[playerIdx];
    if(car&&!recoverActive){
      const driftMult=(typeof window._dsaCurrentDriftMult==='number')?window._dsaCurrentDriftMult:1;
      _dsaCurrentDir+=dt*.04*driftMult;
      const drift=.0008*driftMult;
      car.mesh.position.x+=Math.cos(_dsaCurrentDir)*drift*car.speed*60*dt;
      car.mesh.position.z+=Math.sin(_dsaCurrentDir)*drift*car.speed*60*dt;
    }
  }
  // Lap-progressive current intensification — runs LAST so it overrides
  // _wpCurrentStreams strength for the next checkCurrentStreams call.
  if(typeof updateDeepSeaCurrent==='function'){
    const _pl=carObjs[playerIdx];
    updateDeepSeaCurrent(dt, _pl?_pl.lap:1);
  }
  // Plankton-trail per-car emitter verwijderd: spawnde tot 60% kans per car
  // per frame een cyaan plankton-puff achter alle 13 auto's, wat samen met
  // bloom een continue glow-streep achter de auto's tekende. Speed-trail
  // (visuals.js:updateBoostTrail) draagt nu het deepsea-gevoel via
  // _BOOST_TRAIL_TINT.deepsea + _TIRE_SPLASH_CFG.deepsea tijdens drift.
}

