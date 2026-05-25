// js/worlds/volcano.js — volcano world builders + update + collision checks
// Non-module script.

'use strict';

// Per-world state (uit main.js verhuisd) — gereset in core/scene.js buildScene().
let _volcanoLavaRivers=[],_volcanoGeisers=[],_volcanoEmberGeo=null;
let _volcanoBubbleFrame=0;  // Phase 10.6 — frame mod for lava bubble particles
let _volcanoEruption=null,_volcanoEruptionTimer=3;
let _volcanoEmbers=null,_volcanoGlowLight=null;
// Track Identity Pass (2026-05-08): lap-derived intensity scalar driving
// eruption frequency, ember density, hero glow pulse, camera-shake
// amplitude. Lap 1 = baseline (1.0), lap 2 = tremor (1.3 desktop / 1.15
// mobile), lap 3 = full caldera (1.6 desktop / 1.3 mobile). _volcanoLap
// is the last-seen player lap; intensity is recomputed on lap-flip and
// the lap-3 big-eruption beat fires once via _volcanoBigEruptionFired.
let _volcanoIntensity=1.0,_volcanoLap=1,_volcanoBigEruptionFired=false;
function _volcanoIntensityForLap(lap){
  const mob=!!window._isMobile;
  if(lap>=3) return mob?1.30:1.60;
  if(lap>=2) return mob?1.15:1.30;
  return 1.0;
}

// Single source of truth for volcano day lighting. Mirrors the sandstorm
// + candy helper pattern — buildVolcanoEnvironment calls this at world-
// build, and night.js can call it from the volcano-day branch (currently
// inline because volcano had no day/night skybox swap before V5; see
// _applyCandyDayLighting / _applySandstormDayLighting for the precedent).
//
// Goal palette (warm magma-light):
//   sun #ff4422 (red-orange) / 0.7 — low intensity, the world is dim by design
//   ambient #441100 (deep rust) / 0.35
//   hemi sky #ff6600 (intense orange) / ground #220800 (dark rust) / 0.25
function _applyVolcanoDayLighting(){
  if(!sunLight||!ambientLight||!hemiLight)return;
  sunLight.color.setHex(0xff4422); sunLight.intensity=.7;
  ambientLight.color.setHex(0x441100); ambientLight.intensity=.35;
  hemiLight.color.setHex(0xff6600);
  hemiLight.groundColor.setHex(0x220800);
  hemiLight.intensity=.25;
  // PBR-upgrade Brok 1b: per-wereld ambient/hemi-mul knop. Default 1.0.
  const _v=(typeof window.getWorldVisuals==='function')?window.getWorldVisuals(activeWorld):null;
  if(_v){ ambientLight.intensity*=_v.ambientMul; hemiLight.intensity*=_v.hemiMul; }
}
if(typeof window!=='undefined')window._applyVolcanoDayLighting=_applyVolcanoDayLighting;

// ── Solid-volume PBR helper ──────────────────────────────────────────────
//
// Proef-conversie (Volcano-specifiek): solid-volume props met emissive < 0.3
// krijgen op desktop een MeshStandardMaterial met envTag 'lava-rock' zodat
// ze IBL-reflectie pakken (matte volcanic rock look). Mobile blijft Lambert
// om PBR-shader-kosten te vermijden op LOW-tier. Glow-laag (geyser shaft 1.5,
// hanging vines 0.5, basalt chunks 0.6/0.7, scoria 0.4, lava pool 1.4,
// bridge deck) gaat hier NIET doorheen — die blijven Lambert.
//
// Usage:
//   const mat = _vMat({color:0x1a0800}, {metalness:0.0, roughness:0.85}, 'lava-rock');
function _vMat(lambertDef, stdExtras, tag){
  if(window._isMobile) return new THREE.MeshLambertMaterial(lambertDef);
  const mat = new THREE.MeshStandardMaterial(Object.assign({}, lambertDef, stdExtras));
  mat.userData = mat.userData || {};
  mat.userData.envTag = tag;
  return mat;
}

function buildVolcanoEnvironment(){
  // Reset Track Identity Pass state on each rebuild so a quit→restart
  // doesn't carry the previous race's lap-3 intensity into lap 1.
  _volcanoIntensity=1.0;_volcanoLap=1;_volcanoBigEruptionFired=false;
  // Ground
  const g=new THREE.Mesh(new THREE.PlaneGeometry(2400,2400),
    _vMat({color:0x4a2515,map:_rockGroundTex()},{metalness:0.0,roughness:0.85},'lava-rock'));
  g.rotation.x=-Math.PI/2;g.position.y=-.15;g.receiveShadow=true;
  g.userData._isProcGround=true;
  scene.add(g);
  // Sky + fog set in core/scene.js so updateSky's lerp uses world-matched colors.
  _applyVolcanoDayLighting();
  _volcanoGlowLight=new THREE.PointLight(0xff4400,3.0,600);
  _volcanoGlowLight.position.set(0,5,0);scene.add(_volcanoGlowLight);
  // Eruption particle system — lava blobs shooting out of main crater
  {
    const PN=_mobCount(120);
    const geo=new THREE.BufferGeometry();
    const pos=new Float32Array(PN*3),vel=new Float32Array(PN*3),col=new Float32Array(PN*3),life=new Float32Array(PN);
    for(let i=0;i<PN;i++){
      pos[i*3]=0;pos[i*3+1]=-200;pos[i*3+2]=-350; // hidden below until spawned
      life[i]=0;
      col[i*3]=1;col[i*3+1]=.25+Math.random()*.35;col[i*3+2]=0;
    }
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
    const mat=new THREE.PointsMaterial({vertexColors:true,size:2.4,transparent:true,opacity:.95,sizeAttenuation:true,blending:THREE.AdditiveBlending,depthWrite:false});
    const pts=new THREE.Points(geo,mat);scene.add(pts);
    // Crater glow light that pulses during eruption
    const eruptLight=new THREE.PointLight(0xff5500,2.5,380);
    eruptLight.position.set(0,70,-350);scene.add(eruptLight);
    _volcanoEruption={geo:geo,pts:pts,vel:vel,life:life,N:PN,craterPos:new THREE.Vector3(0,70,-350),light:eruptLight,phase:'idle',phaseTimer:0};
  }
  // ── Main volcano hero (Track Identity Pass redesign 2026-05-08) ──
  // Coherent silhouet via:
  //   1. Body: CylinderGeometry(15, 120, 150, 16) — open caldera mouth
  //      (top radius 15, was ConeGeometry top radius 0). 16 segments
  //      ipv 8 voor een rondere cone-read op race-distance.
  //   2. Caldera lip: dunne cylinder ring rond de mond, sits AT cone-
  //      apex y=65 — geen "drijvende paddenstoel" meer.
  //   3. Recessed crater: cylinder die INSIDE de cone steekt; bottom op
  //      y=53, top sluit aan op de lip op y=65.
  //   4. 3 cone-conformant lava channels die langs de cone-slope lopen
  //      van caldera-lip naar cone-base via per-channel Y-rotated Group
  //      met rotation.z = atan(105/150) en position.x = 67.5
  //      (slope-midpoint).
  const vm=_vMat({color:0x1a0800},{metalness:0.0,roughness:0.85},'lava-rock');
  // Phase 13A — lava materials MeshStandard voor speculaire highlights
  // op molten rims. Lava is "wet" molten rock dus lage roughness.
  const lm=new THREE.MeshStandardMaterial({
    color:0xff4400, emissive:0xff2200, emissiveIntensity:1.2,
    roughness:0.18, metalness:0.30, envMapIntensity:1.4
  });
  const lipMat=new THREE.MeshStandardMaterial({
    color:0x2a0e02, emissive:0x661500, emissiveIntensity:.55,
    roughness:0.35, metalness:0.20, envMapIntensity:1.1
  });
  const channelMat=new THREE.MeshStandardMaterial({
    color:0xff6600, emissive:0xff3300, emissiveIntensity:1.0,
    roughness:0.22, metalness:0.28, envMapIntensity:1.3
  });
  // Volcano hero parent group — alle hero-meshes leven onder deze group
  // op world (0, -10, -350). Local frame: y=0 is cone-center, y=+75 cone
  // apex, y=-75 cone base. Maakt redesign + lap-progressive glow paths
  // makkelijker (per-element walk via group.children).
  const heroGroup=new THREE.Group();
  heroGroup.position.set(0,-10,-350);
  scene.add(heroGroup);
  // Hero volcano group beweegt nooit na build; matrixAutoUpdate uit.
  // Children (body/calderaLip/crater/channels) krijgen alleen material-
  // updates (emissive flicker), geen transform — daarom hieronder ook
  // gefreezed na de heroGroup.add(...) calls.
  if(window._freezeMatrix)window._freezeMatrix(heroGroup);
  // Mobile uses 12 segments per spec, desktop 16 — saves ~16 tris on
  // body + 12 on lip + 12 on crater. Negligible per-frame impact but
  // honours the kickoff-prompt spec number.
  const _coneSeg=window._isMobile?12:16;
  const bodyGeo=new THREE.CylinderGeometry(15,120,150,_coneSeg);
  const body=new THREE.Mesh(bodyGeo,vm);
  body.position.set(0,0,0);heroGroup.add(body);
  if(window._freezeMatrix)window._freezeMatrix(body);
  // Caldera lip — thin ring just buiten de cone-mouth, slightly emissive
  // zodat hij oplicht onder bloom (lava-warmte zonder opvallend "bord").
  const calderaLip=new THREE.Mesh(new THREE.CylinderGeometry(20,18,4,_coneSeg),lipMat);
  calderaLip.position.set(0,73,0);heroGroup.add(calderaLip);
  if(window._freezeMatrix)window._freezeMatrix(calderaLip);
  _volcanoLavaRivers.push({mesh:calderaLip,baseInt:.55});
  // Recessed crater — INSIDE the cone, top at lip-level, bottom 12u below
  // (sinks into the cone). Glowing emissive — this is the lava pool die
  // de speler ziet als ze van bovenaf naar de berg kijken.
  const crater=new THREE.Mesh(new THREE.CylinderGeometry(14,16,12,_coneSeg),lm);
  crater.position.set(0,69,0);heroGroup.add(crater);
  if(window._freezeMatrix)window._freezeMatrix(crater);
  _volcanoLavaRivers.push({mesh:crater,baseInt:1.2});
  // 3 cone-conformant lava channels. BoxGeometry(W=4, H=channelLen,
  // D=0.6) waar:
  //   channelLen = sqrt((120-15)² + 150²) ≈ 183
  //   slope-mid radius = (15+120)/2 = 67.5
  //   slope tilt = atan((120-15)/150) ≈ 0.611 rad (35°)
  // Per channel: outer Group rotates around Y by theta; inner mesh
  // translates to (67.5, 0, 0) and rotates rotation.z = slope-tilt. Net
  // effect is dat box-top eindigt op (15, 75, 0) (caldera-lip) en
  // box-bottom op (120, -75, 0) (cone-base) in heroGroup-local frame —
  // de centerline van de box volgt exact de cone-surface; W=4 betekent
  // ±2u radial perpendicular to slope (interior 2u verborgen in cone,
  // exterior 2u zit als raised molten vein vóór het cone-oppervlak).
  const channelLen=Math.sqrt(105*105+150*150);
  const channelTilt=Math.atan(105/150);
  for(let i=0;i<3;i++){
    const theta=(i/3)*Math.PI*2+0.5;
    const channelGroup=new THREE.Group();
    channelGroup.rotation.y=theta;
    const channel=new THREE.Mesh(new THREE.BoxGeometry(4,channelLen,0.6),channelMat.clone());
    channel.position.set(67.5,0,0);
    channel.rotation.z=channelTilt;
    channelGroup.add(channel);
    heroGroup.add(channelGroup);
    _volcanoLavaRivers.push({mesh:channel,baseInt:1.0});
  }
  // Secondary volcanoes — reject placements that overlap track. Threshold = trackHalfWidth + cone radius + safety margin.
  // Dense 200-sample scan (was 50): catches the true min-distance instead of an
  // optimistic over-estimate that let cones overlap the road when the spline
  // dipped between samples.
  function _nearestOnTrack(px,pz){
    var bestD=Infinity,bestP=null,bestT=0;
    for(var ti=0;ti<1;ti+=.005){
      var tp=trackCurve.getPoint(ti);
      var dd=Math.hypot(px-tp.x,pz-tp.z);
      if(dd<bestD){bestD=dd;bestP=tp;bestT=ti;}
    }
    return {d:bestD, p:bestP, t:bestT};
  }
  function _distToTrack(px,pz){ return _nearestOnTrack(px,pz).d; }
  // Phase 14: secondary volcanoes via ProcDecor — 8 losse meshes → 2-3 IMs.
  // Track-overlap rejection + smoke-emission registratie blijft hier; alleen
  // de mesh-bouw verschuift naar de factory.
  // Fallback t-values voor curve-anchored placement als de iteratieve push
  // niet binnen 4 stappen onder safe-distance komt (zeldzaam — alleen bij
  // tracks die strak op zichzelf terugbuigen rond de hardcoded positie).
  var _fallbackT=[0.20, 0.45, 0.68, 0.90];
  var _secVolcPos=[];
  [[220,-200,60,80],[-280,-180,55,70],[-180,200,45,60],[250,150,40,55]].forEach(function(d,idx){
    var safe=TW+d[2]+18;
    var px=d[0],pz=d[1];
    // Iteratieve push: bij elke stap opnieuw het dichtstbijzijnde spline-
    // punt zoeken zodat we niet langs een tweede track-segment blijven
    // hangen. Marge +8 (was +4) zodat we niet exact op de drempel landen.
    for(var iter=0;iter<4;iter++){
      var near=_nearestOnTrack(px,pz);
      if(near.d>=safe)break;
      var dx=px-near.p.x,dz=pz-near.p.z,len=Math.hypot(dx,dz);
      if(len<0.01){
        // Cone-center valt vrijwel samen met spline-punt — push langs de
        // track-normal bij de werkelijke t van het nearest-point i.p.v.
        // een willekeurige t aan de start van de spline.
        var tgN=trackCurve.getTangent(near.t).clone().normalize();
        dx=-tgN.z;dz=tgN.x;len=1;
      }
      var push=(safe-near.d)+8;
      px=near.p.x+(dx/len)*(near.d+push);
      pz=near.p.z+(dz/len)*(near.d+push);
    }
    // Fallback: nog steeds te dichtbij? Plaats op een vaste t langs de
    // track met een gegarandeerd-veilige laterale offset.
    if(_distToTrack(px,pz)<safe){
      var tF=_fallbackT[idx%_fallbackT.length];
      var pF=trackCurve.getPoint(tF);
      var tgF=trackCurve.getTangent(tF).clone().normalize();
      var nx=-tgF.z, nz=tgF.x;
      // Kies de zijde die het verst van het oorspronkelijke punt ligt zodat
      // de visuele compositie zo dicht mogelijk bij het origineel blijft.
      var sidePos={x:pF.x+nx*(safe+12), z:pF.z+nz*(safe+12)};
      var sideNeg={x:pF.x-nx*(safe+12), z:pF.z-nz*(safe+12)};
      var distPos=Math.hypot(sidePos.x-d[0], sidePos.z-d[1]);
      var distNeg=Math.hypot(sideNeg.x-d[0], sideNeg.z-d[1]);
      var pick=(distPos<distNeg)?sidePos:sideNeg;
      px=pick.x;pz=pick.z;
    }
    _secVolcPos.push({x:px, y:-8, z:pz, radius:d[2], height:d[3]});
    if(!window._isMobile){
      if(!window._volcanoSmokePos)window._volcanoSmokePos=[];
      window._volcanoSmokePos.push({x:px, y:d[3]*0.5-2, z:pz});
    }
  });
  ProcDecor.buildSecondaryVolcanoBatch(scene,_secVolcPos,{bodyMaterial:vm,lavaMaterial:lm});

  // Phase 14: lava rivers — 12 cloned-material planes → 1 IM. Single shared
  // material pulst sync (alle 12 samen); voor achtergrond aanvaardbaar.
  // Spawn-posities apart bewaard voor bubble-particles + lava-glow lights
  // die per-river position-sampling doen (zie updateVolcanoWorld bubbles +
  // _buildVolcanoLavaGlowLights).
  var _lavaPos=[];
  for(var i=0;i<_mobCount(12);i++){
    var t=i/12,p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    var nr=new THREE.Vector3(-tg.z,0,tg.x);
    var side=(i%2===0?1:-1)*(BARRIER_OFF+22+Math.random()*10);
    _lavaPos.push({
      x:p.x+nr.x*side, z:p.z+nr.z*side,
      width:5+Math.random()*4, length:18+Math.random()*12,
      rot:Math.atan2(tg.x,tg.z)
    });
  }
  var _lavaHandle=ProcDecor.buildLavaRiverBatch(scene,_lavaPos);
  // Pulse-list krijgt 1 entry voor alle 12 rivers; update-loop in
  // updateVolcanoWorld() mutateert emissiveIntensity op de shared material.
  // bubble-spawn + glow-light samplers gebruiken per-river fake mesh-objects
  // met enkel .position zodat de bestaande filters (y<1, position.x/z lookup)
  // blijven werken zonder de pulse-iteration te beïnvloeden.
  if(_lavaHandle.materialRef){
    _volcanoLavaRivers.push({mesh:{material:_lavaHandle.materialRef},baseInt:.45});
    for(var _lpi=0;_lpi<_lavaPos.length;_lpi++){
      var _lp=_lavaPos[_lpi];
      _volcanoLavaRivers.push({
        mesh:{position:new THREE.Vector3(_lp.x,-0.08,_lp.z)},
        baseInt:0  // no pulse — _spawnOnly marker via baseInt=0
      });
    }
  }
  // Ember particles
  var EN=_mobCount(400),egeo=new THREE.BufferGeometry();
  var epos=new Float32Array(EN*3),ecol=new Float32Array(EN*3);
  for(var i=0;i<EN;i++){
    epos[i*3]=(Math.random()-.5)*600;epos[i*3+1]=Math.random()*40+1;epos[i*3+2]=(Math.random()-.5)*600;
    ecol[i*3]=1.0;ecol[i*3+1]=Math.random()*.4;ecol[i*3+2]=0;
  }
  egeo.setAttribute('position',new THREE.Float32BufferAttribute(epos,3));
  egeo.setAttribute('color',new THREE.Float32BufferAttribute(ecol,3));
  // AdditiveBlending lets embers stack into hot-spots and pushes them well
  // above bloom threshold — much more dramatic glow now that postfx is on.
  _volcanoEmbers=new THREE.Points(egeo,new THREE.PointsMaterial({vertexColors:true,size:.42,transparent:true,opacity:1.0,sizeAttenuation:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  scene.add(_volcanoEmbers);_volcanoEmberGeo=egeo;
  // Points-mesh staat statisch; alleen de geometry.attributes worden per
  // frame ge-update. matrixAutoUpdate=false bespaart de updateMatrix call.
  if(window._freezeMatrix)window._freezeMatrix(_volcanoEmbers);
  // Geysers
  [.22,.52,.78].forEach(function(t,gi){
    var p=trackCurve.getPoint(t).clone();
    var plat=new THREE.Mesh(new THREE.CylinderGeometry(3,3.5,.5,8),_vMat({color:0x1a0800},{metalness:0.0,roughness:0.85},'lava-rock'));
    plat.position.copy(p);plat.position.y=.25;scene.add(plat);
    if(window._freezeMatrix)window._freezeMatrix(plat);
    var gey=new THREE.Mesh(new THREE.CylinderGeometry(.8,1.2,2,8),
      new THREE.MeshLambertMaterial({color:0xff4400,emissive:0xff2200,emissiveIntensity:1.5}));
    gey.position.copy(p);gey.position.y=1.2;scene.add(gey);
    var pl=new THREE.PointLight(0xff4400,2.0,22);pl.position.copy(p);pl.position.y=2;scene.add(pl);
    _volcanoGeisers.push({pos:p.clone(),geyser:gey,light:pl,active:false,timer:5+gi*3,activeDur:2.5});
  });
  // Bridge over lava (signature moment — collapsing in lap 3).
  if(typeof buildVolcanoBridge==='function')buildVolcanoBridge();
  // Barriers
  buildBarriers();buildStartLine();
  // Lights setup (headlights/taillights)
  plHeadL=new THREE.SpotLight(0xffffff,0,50,Math.PI*.16,.5);plHeadR=new THREE.SpotLight(0xffffff,0,50,Math.PI*.16,.5);
  scene.add(plHeadL);scene.add(plHeadL.target);scene.add(plHeadR);scene.add(plHeadR.target);
  plTail=new THREE.PointLight(0xff2200,0,10);scene.add(plTail);
  // Stars (ember-colored)
  var sg=new THREE.SphereGeometry(.18,4,4),ssm=new THREE.MeshBasicMaterial({color:0xff4400,transparent:true,opacity:.8});
  stars=new THREE.InstancedMesh(sg,ssm,60);stars.visible=true;
  var dm=new THREE.Object3D();
  for(var i=0;i<60;i++){
    var th=Math.random()*Math.PI*2,ph=Math.random()*Math.PI*.3,r=300+Math.random()*80;
    dm.position.set(r*Math.sin(ph)*Math.cos(th),r*Math.cos(ph)*.35+60,r*Math.sin(ph)*Math.sin(th));
    dm.scale.setScalar(.6+Math.random()*1.2);dm.updateMatrix();stars.setMatrixAt(i,dm.matrix);
  }
  stars.instanceMatrix.needsUpdate=true;scene.add(stars);
  // GLTF roadside props — rocks + burnt trees in the volcanic landscape.
  if(window.spawnRoadsideProps){
    // Rocks + lava-crystal chunks track-side.
    window.spawnRoadsideProps('volcano',{
      propKeys:['rock_basalt_small','rock_basalt_medium','lava_chunk'],
      count:11, sizeHint:1.7, clusterSize:3,
      offsetMin: BARRIER_OFF + 3, offsetMax: BARRIER_OFF + 14,
    });
    // Burnt + twisted trees scattered further out (desktop only — they
    // double the per-side mesh count which mobile can't afford).
    if (!window._isMobile){
      window.spawnRoadsideProps('volcano',{
        propKeys:['tree_burnt'],
        count:9, sizeHint:5.0, clusterSize:2,
        offsetMin: BARRIER_OFF + 12, offsetMax: BARRIER_OFF + 30,
      });
      // Mid-range debris band — bigger lava chunks + medium basalt
      // clusters at 30-55u out. Fills the depth-zone audit marked 🟡
      // and reads as cooled lava-flow scree behind the dead trees.
      window.spawnRoadsideProps('volcano',{
        propKeys:['rock_basalt_medium','lava_chunk'],
        count:8, sizeHint:3.0, clusterSize:2,
        offsetMin: BARRIER_OFF + 30, offsetMax: BARRIER_OFF + 55,
      });
    }
  }
  _buildVolcanoCloseBand();      // Phase 12A
  _buildVolcanoMidRing();        // Phase 11A
  _buildVolcanoFarSilhouette();  // Phase 12C
  _buildVolcanoHangingVines();   // Phase 12D
  _buildVolcanoLavaGlowLights(); // Phase 13B
}

// Phase 13B — practical PointLights vanaf lava-rivers zodat nabije
// basalt-kolommen + props oranje gloeien (geen pure emissive look).
// Mobile skip — light count budget. Lights registered in trackLightList
// voor night.js dimming.
function _buildVolcanoLavaGlowLights(){
  if(window._isMobile)return;
  if(typeof trackLightList==='undefined')return;
  // Sample 6 ground-level lava rivers (y<1 filter), evenly verspreid
  const groundLava = _volcanoLavaRivers.filter(r => r.mesh && r.mesh.position && r.mesh.position.y < 1);
  const sampleCount = Math.min(6, groundLava.length);
  const step = Math.max(1, Math.floor(groundLava.length / sampleCount));
  for(let i=0;i<groundLava.length && i<sampleCount*step;i+=step){
    const r = groundLava[i];
    const pl = new THREE.PointLight(0xff5500, 1.8, 35, 1.6);
    pl.position.set(r.mesh.position.x, 2.5, r.mesh.position.z);
    pl.castShadow = false;
    scene.add(pl);
    trackLightList.push(pl);
  }
}

// Phase 12D — signature: hanging lava-vines van secondary cone-tips.
// 8 desktop / 4 mobile, emissive oranje, "cooled-but-glowing lava drip".
function _buildVolcanoHangingVines(){
  const count = window._isMobile ? 4 : 8;
  const geo = new THREE.CylinderGeometry(0.08, 0.04, 18, 4);
  const mat = new THREE.MeshLambertMaterial({color:0x331100, emissive:0xff4400, emissiveIntensity:0.5});
  // Spawn at 4 secondary cone-positions (from the 4-position array in build)
  const cone_positions = [[220,-200],[-280,-180],[-180,200],[250,150]];
  for(let i=0;i<count;i++){
    const cp = cone_positions[i % cone_positions.length];
    const off_x = (Math.random()-0.5) * 30;
    const off_z = (Math.random()-0.5) * 30;
    const vine = new THREE.Mesh(geo, mat);
    vine.position.set(cp[0] + off_x, 12, cp[1] + off_z);
    vine.userData = {_noLodCull:true};
    vine.castShadow = false;
    scene.add(vine);
    if(window._freezeMatrix)window._freezeMatrix(vine);
  }
}

// Phase 12C — distant volcanic ridge op r=200u. Lange platte BoxGeo
// scale(250×30×4) als donker rust silhouet voor depth.
function _buildVolcanoFarSilhouette(){
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({color:0x1a0608, emissive:0x331010, emissiveIntensity:0.3});
  // 4 ridge-segmenten rondom de track
  for(let i=0;i<4;i++){
    const ang = (i/4) * Math.PI*2 + Math.PI/8;
    const ridge = new THREE.Mesh(geo, mat);
    ridge.position.set(Math.cos(ang)*200, 15, Math.sin(ang)*200);
    ridge.scale.set(70, 30 + Math.random()*15, 4);
    ridge.rotation.y = ang + Math.PI/2;
    ridge.userData = {_noLodCull:true};
    scene.add(ridge);
    if(window._freezeMatrix)window._freezeMatrix(ridge);
  }
}

// Phase 12A — close-band: small basalt chunks + scoria-rocks 4-12u.
function _buildVolcanoCloseBand(){
  if(typeof _populateMidRing!=='function')return;
  // Small basalt chunks — reuse warm-emissive palette (lava-glow rim).
  const basaltCount = (typeof _mobCount==='function')?_mobCount(45):45;
  const basaltGeo = new THREE.CylinderGeometry(0.35, 0.6, 1.6, 5);
  const basaltMat = new THREE.MeshLambertMaterial({color:0x1a0a00, emissive:0x331000, emissiveIntensity:0.6});
  const basaltIm = new THREE.InstancedMesh(basaltGeo, basaltMat, basaltCount*2);
  _populateMidRing(basaltIm, {
    perSide: basaltCount, offsetMin:4, offsetMax:12,
    scaleMin:0.6, scaleMax:1.5, tiltAmt:0.25, stagger:0.4,
    yFn: sc => 0.6 * sc
  });
  scene.add(basaltIm);
  if(window._freezeMatrix)window._freezeMatrix(basaltIm);
  // Scoria-rocks — small dark box-fragments
  const scoriaCount = (typeof _mobCount==='function')?_mobCount(25):25;
  const scoriaGeo = new THREE.BoxGeometry(0.5, 0.5, 0.7);
  const scoriaMat = new THREE.MeshLambertMaterial({color:0x221008, emissive:0x441500, emissiveIntensity:0.4});
  const scoriaIm = new THREE.InstancedMesh(scoriaGeo, scoriaMat, scoriaCount*2);
  _populateMidRing(scoriaIm, {
    perSide: scoriaCount, offsetMin:4, offsetMax:12,
    scaleMin:0.7, scaleMax:1.5, tiltAmt:0.6, stagger:0.7,
    yFn: () => 0.3
  });
  scene.add(scoriaIm);
  if(window._freezeMatrix)window._freezeMatrix(scoriaIm);
}

// Phase 11A — basalt-kolommen mid-ground ring. Single IM.
function _buildVolcanoMidRing(){
  if(typeof _populateMidRing!=='function')return;
  const perSide = (typeof _mobCount==='function')?_mobCount(50):50;
  const geo = new THREE.CylinderGeometry(0.6, 0.9, 4.5, 6);
  const mat = new THREE.MeshLambertMaterial({color:0x1a0a00, emissive:0x330800, emissiveIntensity:0.7});
  const im  = new THREE.InstancedMesh(geo, mat, perSide*2);
  _populateMidRing(im, {
    perSide: perSide, offsetMin:22, offsetMax:50,
    scaleMin:0.55, scaleMax:1.7, tiltAmt:0.08,
    yFn: sc => 1.8 * sc   // half height for half-embedded look
  });
  scene.add(im);
  if(window._freezeMatrix)window._freezeMatrix(im);
}


function updateVolcanoWorld(dt){
  var t=_nowSec;
  // Track Identity Pass: recompute lap-derived intensity on lap-flip.
  // Cheap (1 read + 1 compare per frame); only does the lookup + assign
  // when the player crossed a lap boundary. Lap-3 entry also fires the
  // once-per-race big-eruption beat (force eruption immediately, large
  // ember burst, sustained light flash, audio rumble + extra cam-shake).
  var _pl=carObjs[playerIdx];
  if(_pl&&_pl.lap!==_volcanoLap){
    _volcanoLap=_pl.lap;
    _volcanoIntensity=_volcanoIntensityForLap(_volcanoLap);
    if(_volcanoLap>=3&&!_volcanoBigEruptionFired&&_volcanoEruption){
      _volcanoBigEruptionFired=true;
      // Force the eruption-trigger path: zero the timer so the next
      // updateVolcanoWorld(dt) tick takes the timer<=0 branch and spawns
      // a burst with the lap-3 ember-count multiplier (already wired).
      _volcanoEruptionTimer=0;
      // Extra audio cue layered on top of the per-lap event so the lap-3
      // beat reads as different from lap 1/2. WORLD_LAP_EVENT_MAP volcano
      // is 'rumble' — calling it here adds a reinforced rumble at lap-3
      // entry. setFinalLap is also already triggered by tracklimits
      // separately, so this is purely additive.
      if(typeof Audio!=='undefined'&&Audio.playWorldLapEvent)Audio.playWorldLapEvent('volcano');
      // Bigger initial cam-shake: 0.32 desktop / 0.16 mobile. Decays via
      // the existing camera.js dt*2.5 path over ~0.13s.
      const mob=!!window._isMobile;
      camShake=Math.max(camShake,mob?0.16:0.32);
      if(_volcanoGlowLight)_volcanoGlowLight.intensity=8; // bigger flash than normal-burst
    }
  }
  if(typeof updateVolcanoBridge==='function'){
    updateVolcanoBridge(dt, _pl?_pl.lap:1);
  }
  // Smoke clouds drift slowly across the volcanic sky
  if(scene&&scene.background&&scene.background.isTexture){
    scene.background.offset.x=(scene.background.offset.x+dt*.005)%1;
  }
  // Lava-river emissive — LUT-sin + epsilon-gated material write.
  // 13 materials × Math.sin per frame zonder sentinel is een trage sinus
  // dus ~75% van frames zit op een plateau waar de delta onder de
  // threshold valt (geen uniform-write nodig).
  const _volSin = window._sharedSin || Math.sin;
  for(var _li=0;_li<_volcanoLavaRivers.length;_li++){
    var r=_volcanoLavaRivers[_li];
    if(!r.mesh||!r.mesh.material)continue;
    var _em=r.baseInt*.7+r.baseInt*.5*_volSin(t*1.4+_li*.9);
    if(r._lastEm===undefined||Math.abs(_em-r._lastEm)>0.003){
      r._lastEm=_em;
      r.mesh.material.emissiveIntensity=_em;
    }
  }
  if(_volcanoEmberGeo){
    var pos=_volcanoEmberGeo.attributes.position.array;
    // Track Identity Pass: ember update batch-size scales with intensity
    // so lap 2 covers ~30% more particles per frame, lap 3 ~60% more.
    // Wider batch = more ember motion visible per frame = denser feel.
    // Mobile: halveer base batch (25 ipv 50) zodat _volcanoIntensity * 25
    // = 25/32/40 ipv 50/65/80 per frame. Visuele dichtheid hangt vooral
    // van ember-count (al via _mobCount op build) — batch is hoe snel ze
    // recyclen, niet hoeveel zichtbaar zijn.
    var _baseBatch = window._isMobile ? 25 : 50;
    var batch=Math.floor(_baseBatch*_volcanoIntensity);
    var step=Math.floor(t*40)%50||1;
    for(var i=step;i<Math.min(step+batch,pos.length/3);i++){
      pos[i*3+1]+=dt*(.8+Math.random()*.6);
      if(pos[i*3+1]>35){pos[i*3]=(Math.random()-.5)*500;pos[i*3+1]=Math.random()*2;pos[i*3+2]=(Math.random()-.5)*500;}
    }
    _volcanoEmberGeo.attributes.position.needsUpdate=true;
  }
  for(var gi=0;gi<_volcanoGeisers.length;gi++){
    var g=_volcanoGeisers[gi];
    g.timer-=dt;
    if(!g.active&&g.timer<=0){g.active=true;g.timer=g.activeDur;g.light.intensity=4.0;}
    if(g.active){
      // Hergebruik dezelfde t*8 sine voor scale.y en position.y; was 2× Math.sin.
      var _t8=_volSin(t*8);
      g.geyser.scale.y=1+_t8*.3;g.geyser.position.y=1.2+_t8*.5;
      var _gli=3.5+_volSin(t*6);
      if(g._lastLi===undefined||Math.abs(_gli-g._lastLi)>0.01){g._lastLi=_gli;g.light.intensity=_gli;}
      var car=carObjs[playerIdx];
      if(car){var dx=car.mesh.position.x-g.pos.x,dz=car.mesh.position.z-g.pos.z;
        if(dx*dx+dz*dz<25){car.speed*=.55;camShake=1.2;playWorldEvent('geiser');}}
      if(g.timer<=0){g.active=false;g.timer=8+gi*4+Math.random()*6;g.geyser.scale.y=1;g.light.intensity=2.0;g._lastLi=2.0;}
    }else{
      var _gliIdle=1.8+_volSin(t*2+gi*1.5)*.4;
      if(g._lastLi===undefined||Math.abs(_gliIdle-g._lastLi)>0.01){g._lastLi=_gliIdle;g.light.intensity=_gliIdle;}
    }
  }
  if(Math.random()<dt*0.03)playWorldEvent('lava');
  // ── Phase 10.6 — lava bubble particles vanuit side-track lava-rivers ──
  // 1 bubble per 4 frames vanuit een random ground-level lava-river plane
  // (filter op mesh.position.y < 1 zodat we niet uit caldera/channels
  // spawnen). Bubbles rijzen langzaam + popen door particle-system life-
  // expiry. Warm orange-red tint, sprite-shaped via shared exhaust pool.
  _volcanoBubbleFrame=(_volcanoBubbleFrame||0)+1;
  // Mobile: bubble-spawn elke 8 frames ipv 4 (halveert exhaust-system load).
  if(_volcanoBubbleFrame%(window._isMobile?8:4)===0&&typeof exhaustSystem!=='undefined'&&exhaustSystem&&exhaustSystem.emit&&_volcanoLavaRivers.length){
    for(var _bi=0;_bi<3;_bi++){
      var _lr=_volcanoLavaRivers[Math.floor(Math.random()*_volcanoLavaRivers.length)];
      if(!_lr||!_lr.mesh||!_lr.mesh.position||_lr.mesh.position.y>1)continue;
      var _bx=_lr.mesh.position.x+(Math.random()-.5)*4;
      var _bz=_lr.mesh.position.z+(Math.random()-.5)*4;
      exhaustSystem.emit(
        _bx,_lr.mesh.position.y+.2,_bz,
        0,.06+Math.random()*.04,0,
        1.4,1.0,.55,.15,.85
      );
    }
  }
  // Phase 11B — rookkolommen boven secondary cones (desktop only).
  if(window._volcanoSmokePos && !window._isMobile && typeof exhaustSystem!=='undefined' && exhaustSystem.emit){
    for(var _sci=0;_sci<window._volcanoSmokePos.length;_sci++){
      if(Math.random()<0.4){
        var _sp=window._volcanoSmokePos[_sci];
        exhaustSystem.emit(
          _sp.x+(Math.random()-0.5)*3, _sp.y, _sp.z+(Math.random()-0.5)*3,
          (Math.random()-0.5)*0.5, 1.2+Math.random()*0.8, (Math.random()-0.5)*0.5,
          3.5, 0.25, 0.22, 0.20, 0.55
        );
      }
    }
  }
  // Hero glow pulse — scales with intensity so lap 2/3 reads as warmer
  // ambient. Base 2.5, sin-amp .8 — lap 1 unchanged, lap 2 ~3.25/1.04,
  // lap 3 ~4.0/1.28.
  if(_volcanoGlowLight)_volcanoGlowLight.intensity=(2.5+Math.sin(t*.6)*.8)*_volcanoIntensity;
  // ── VOLCANO ERUPTION ──
  if(_volcanoEruption){
    const er=_volcanoEruption;
    er.phaseTimer-=dt;
    if(er.phase==='idle'){
      _volcanoEruptionTimer-=dt;
      er.light.intensity=2+Math.sin(t*.7)*.6;
      if(_volcanoEruptionTimer<=0){
        // Start eruption: spawn burst of lava. Interval scales inversely
        // with intensity — lap 1 = 9-17s, lap 2 = 7-13s, lap 3 = 5.6-10.6s.
        er.phase='burst';er.phaseTimer=3.8;
        _volcanoEruptionTimer=(9+Math.random()*8)/_volcanoIntensity;
        const pos=er.geo.attributes.position.array;
        // Track Identity Pass: ember count per burst scales with intensity
        // so lap 2 = ~30% more lava on screen per burst, lap 3 = ~60%.
        const activeCount=Math.min(er.N,Math.floor((80+Math.random()*40)*_volcanoIntensity));
        for(let i=0;i<activeCount;i++){
          pos[i*3]=er.craterPos.x+(Math.random()-.5)*12;
          pos[i*3+1]=er.craterPos.y+Math.random()*3;
          pos[i*3+2]=er.craterPos.z+(Math.random()-.5)*12;
          // Upward + outward velocity cone
          const th=Math.random()*Math.PI*2,lift=32+Math.random()*22,out=6+Math.random()*14;
          er.vel[i*3]=Math.cos(th)*out;
          er.vel[i*3+1]=lift;
          er.vel[i*3+2]=Math.sin(th)*out;
          er.life[i]=3.2+Math.random()*1.2;
        }
        er.geo.attributes.position.needsUpdate=true;
        playWorldEvent('lava');
        if(_volcanoGlowLight)_volcanoGlowLight.intensity=6; // flash
        // Camera-shake on eruption — only fires from lap 2 onward.
        // Mobile gets half-amplitude per D3 budget. Math.max keeps a
        // bigger pre-existing shake (e.g. just landed from a ramp).
        if(_volcanoLap>=2){
          const mob=!!window._isMobile;
          const baseShake=_volcanoLap>=3?0.20:0.10;
          camShake=Math.max(camShake,mob?baseShake*0.5:baseShake);
        }
      }
    }
    if(er.phase==='burst'){
      const pos=er.geo.attributes.position.array;
      for(let i=0;i<er.N;i++){
        if(er.life[i]<=0)continue;
        er.life[i]-=dt;
        pos[i*3]+=er.vel[i*3]*dt;
        pos[i*3+1]+=er.vel[i*3+1]*dt;
        pos[i*3+2]+=er.vel[i*3+2]*dt;
        er.vel[i*3+1]-=28*dt; // gravity
        // Ground collision near volcano
        if(pos[i*3+1]<-1){
          er.life[i]=0;
          pos[i*3+1]=-200; // hide
        }
      }
      er.geo.attributes.position.needsUpdate=true;
      // Fade the peak flash
      er.light.intensity=Math.max(2,er.light.intensity-dt*1.5);
      if(er.phaseTimer<=0){er.phase='idle';}
    }
  }
}

