// js/cars/build.js — entry point for car building.
// Non-module script. Loaded AFTER car-parts.js + brands.js.
//
// makeCar(def): looks up the brand-specific builder in BRAND_BUILDERS by
// def.brand, runs it to construct the body, then attaches wheels via the
// shared buildAllWheels helper. All 12 brands ship with explicit builders;
// any unknown brand throws so missing entries surface immediately.
//
// makeAllCars() — places all 9 race entrants on the grid (unchanged from
// the legacy implementation).

'use strict';

// Cached soft contact-shadow mask + shared geometry/material so every car
// (10 max) projects a small dark blob onto the ground without each one
// allocating its own texture. Radial-falloff alpha — bright in centre,
// transparent at edges so the silhouette sits cleanly on any surface.
// Used for cars (multiplier on top of the additive livery underglow).
let _contactShadowTex = null;
let _contactShadowGeo = null;
let _contactShadowMat = null;
function _contactShadowMaskTex(){
  if(_contactShadowTex) return _contactShadowTex;
  const S=64;
  const c=document.createElement('canvas'); c.width=S; c.height=S;
  const g=c.getContext('2d');
  // Slightly elongated alpha-blob (vehicles are longer than wide). Use
  // a single radial gradient on a square canvas — the geometry will
  // be a CircleGeometry but we sample with a slightly elliptical scale
  // by relying on a soft alpha falloff that hides the circular edge.
  const grd = g.createRadialGradient(S*0.5, S*0.5, 0, S*0.5, S*0.5, S*0.50);
  grd.addColorStop(0.00, 'rgba(0,0,0,0.78)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  grd.addColorStop(0.92, 'rgba(0,0,0,0.06)');
  grd.addColorStop(1.00, 'rgba(0,0,0,0.00)');
  g.fillStyle = grd; g.fillRect(0,0,S,S);
  _contactShadowTex = new THREE.CanvasTexture(c);
  _contactShadowTex.needsUpdate = true;
  _contactShadowTex.userData = { _sharedAsset: true };
  return _contactShadowTex;
}
// Cached sandstorm-variant shadow material — warm-tinted so the blob
// reads as "sun-cast shadow on sand" instead of "oil stain on light
// ground". Other worlds share _contactShadowMat (dark-warm grey).
let _contactShadowMatSandstorm = null;
function _attachContactShadow(carMesh){
  if(!_contactShadowGeo){
    _contactShadowGeo = new THREE.CircleGeometry(2.35, 20);
    _contactShadowGeo.userData = { _sharedAsset: true };
  }
  // Sandstorm gets a warm-tinted shadow (sand-shaded brown) so the
  // contact-shadow blob doesn't read as an oil-stain on the bright
  // warm sand. Other worlds share the default dark-warm grey.
  const isSand = (activeWorld === 'sandstorm');
  if(isSand && !_contactShadowMatSandstorm){
    _contactShadowMatSandstorm = new THREE.MeshBasicMaterial({
      map: _contactShadowMaskTex(),
      transparent: true,
      depthWrite: false,
      // Warm sand-brown tint — reads as a real sun-cast shadow on dunes
      // rather than a black blob. Opacity stays modest so the underlying
      // sand colour bleeds through.
      color: 0x4a3520,
      opacity: 0.78,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    _contactShadowMatSandstorm.userData = { _sharedAsset: true };
  }
  if(!isSand && !_contactShadowMat){
    _contactShadowMat = new THREE.MeshBasicMaterial({
      map: _contactShadowMaskTex(),
      transparent: true,
      // Normal alpha blend (NOT additive — this is meant to darken the
      // ground under the car, opposite of the additive livery disc).
      depthWrite: false,
      // Slight color bias toward warm so on cool worlds (arctic, neon)
      // the shadow doesn't read as harsh blue-black.
      color: 0x2a2624,
      // Parity met sandstorm-variant — zonder expliciete opacity defaultt
      // three.js naar 1.0 wat in combinatie met polygonOffset op LOW-tier
      // iPhone 12 WebGL de 20-segment CircleGeometry als polygonale dark
      // patch laat lezen i.p.v. soft radial-shadow (zichtbaar op deepsea).
      opacity: 0.78,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    _contactShadowMat.userData = { _sharedAsset: true };
  }
  const sh = new THREE.Mesh(_contactShadowGeo,
    isSand ? _contactShadowMatSandstorm : _contactShadowMat);
  sh.rotation.x = -Math.PI/2;
  // Position: just below the existing underglow disc (-0.32) so the
  // additive glow visually sits on top of the dark contact shadow. The
  // polygonOffset on the material keeps the disc above the asphalt.
  sh.position.y = -0.33;
  carMesh.add(sh);
}

// Cached alpha-mask for soft headlight cones. Painted once, reused across
// all car beam meshes. Radial gradient: bright on cone-axis (UV center
// horizontally), fading to zero at radial edges. Vertical (along beam
// axis) is brightest at the tip and falls off toward the base so a tight
// throw blends into ambient.
let _softHeadlightTex = null;
function _softHeadlightMaskTex(){
  if (_softHeadlightTex) return _softHeadlightTex;
  const W=128, H=128;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const g=c.getContext('2d');
  // U wraps around the cone (no azimuthal masking — the geometry itself
  // defines beam shape). V runs along the cone axis: brightest at the tip,
  // fades to ~15% at the base so a tight throw blends into ambient.
  const img = g.createImageData(W,H);
  const d = img.data;
  for (let y=0;y<H;y++){
    const v = y/(H-1);
    const vF = Math.pow(1-v, 1.4) * 0.85 + 0.15;
    const alpha = Math.round(vF * 255);
    for (let x=0;x<W;x++){
      const i = (y*W+x)*4;
      d[i]=255; d[i+1]=247; d[i+2]=210; d[i+3]=alpha;
    }
  }
  g.putImageData(img,0,0);
  _softHeadlightTex = new THREE.CanvasTexture(c);
  _softHeadlightTex.needsUpdate = true;
  // Texture is procedurally generated once and held forever — flag shared
  // so disposeScene won't kill it when the next race rebuilds cars.
  _softHeadlightTex.userData = { _sharedAsset:true };
  return _softHeadlightTex;
}

function makeCar(def, carNumber){
  const lod = (typeof carLOD === 'function') ? carLOD() : 'high';
  const brandBuilder = window.BRAND_BUILDERS && window.BRAND_BUILDERS[def.brand];
  if(!brandBuilder){
    if(window.dbg) dbg.error('cars', new Error('No builder'), 'No BRAND_BUILDERS entry for: '+def.brand);
    throw new Error('No car builder registered for brand: '+def.brand);
  }
  const g = new THREE.Group();
  const shared = getSharedCarMats();
  const paintMats = makePaintMats(def);
  const mats = Object.assign({}, shared, paintMats);
  // Per-car caliper material clone: brake-heat emissive (updateBrakeHeat
  // in visuals.js drives this per-frame based on speed-derivative). Each
  // car needs its own material because the player + AI brake at different
  // times. Cost: ~10 extra MeshStandardMaterials, no extra texture upload
  // since brakeRed has no texture maps.
  mats.brakeRed = mats.brakeRed.clone();
  mats.brakeRed.emissive = new THREE.Color(0x000000);
  mats.brakeRed.emissiveIntensity = 0;
  mats.brakeRed.userData = mats.brakeRed.userData || {};
  delete mats.brakeRed.userData._sharedAsset;
  g.userData._calMatHot = mats.brakeRed;
  // Phase 3b — brake disc krijgt ook per-car emissive zodat updateBrakeHeat
  // de schijf laat gloeien naast de caliper. Disc emissie blijft subtieler
  // (~0.4× caliper-piek) want de schijf zelf is groter en zou anders
  // visueel domineren.
  mats.brakeDisc = mats.brakeDisc.clone();
  mats.brakeDisc.emissive = new THREE.Color(0x000000);
  mats.brakeDisc.emissiveIntensity = 0;
  mats.brakeDisc.userData = mats.brakeDisc.userData || {};
  delete mats.brakeDisc.userData._sharedAsset;
  g.userData._discMatHot = mats.brakeDisc;
  brandBuilder(g, def, mats, lod);
  // Brand-builders kunnen wheel-style opts (drilled disc, branded caliper)
  // op g.userData._wheelOpts zetten — buildAllWheels leest die door. Pilot
  // gebruikt dit voor Bugatti; Phase 3 rolt het uit naar Tier S/A.
  buildAllWheels(g, def, mats, lod, undefined, g.userData && g.userData._wheelOpts);
  // Phase 6 graphics upgrade — per-car interior driver silhouette achter
  // glass (desktop only). Decal-roundel is gemerged door Phase 8.1/9.4
  // buildLivery hieronder, dus buildCarDecal is niet meer nodig.
  if (typeof buildDriverSilhouette === 'function') buildDriverSilhouette(g, def);
  // Phase R2.1 — hazard indicator lampjes op alle 4 hoeken. Per-car
  // cloned indicator material (start emissiveIntensity=0). updateHazard
  // in visuals.js pulseert dit wanneer player.hitCount>=6. Niet zichtbaar
  // tot het echt nodig is.
  {
    const indMat = mats.indicator.clone();
    indMat.emissive = new THREE.Color(0xff5500);
    indMat.emissiveIntensity = 0;
    indMat.userData = indMat.userData || {};
    delete indMat.userData._sharedAsset;
    g.userData._hazardMat = indMat;
    const indGeo = new THREE.BoxGeometry(0.10, 0.10, 0.08);
    const positions = [
      [-0.85, 0.55, -2.05], [0.85, 0.55, -2.05], // front L/R
      [-0.85, 0.62,  2.10], [0.85, 0.62,  2.10]  // rear L/R
    ];
    const hzList = [];
    for(let p=0;p<positions.length;p++){
      const m = new THREE.Mesh(indGeo, indMat);
      m.position.set(positions[p][0], positions[p][1], positions[p][2]);
      g.add(m);
      hzList.push(m);
    }
    g.userData._hazardLights = hzList;
  }
  // Phase 8.1 + 9.4 — per-brand procedural livery decal met racing-number.
  if(typeof buildLivery === 'function'){
    const accent = (mats.accent && mats.accent.color) ? mats.accent.color.getHex() : 0xffffff;
    buildLivery(g, def, accent, carNumber);
  }
  // Phase 8.2 — dirt accumulation state. updateDirt(dt) in visuals.js
  // leest g.userData._dirt en multipliciatief dimt de paint kleur.
  g.userData._dirt = 0;
  // Phase 8.7 — LOD-cull opt-out flag. Cars mogen nooit verbergen door
  // distance-cull, ook al zijn ze meer dan 250 units van camera (kan
  // gebeuren in cinematic mirror / overhead cam).
  g.userData._isCar = true;
  return g;
}


function makeAllCars(){
  carObjs.forEach(c=>scene.remove(c.mesh));carObjs=[];
  _reverseLights.length=0;
  // Build ordered def list — player goes to pole, AI fill the rest
  const playerDef=CAR_DEFS.find(d=>d.id===selCarId)||CAR_DEFS[0];
  const orderedDefs=[playerDef,...CAR_DEFS.filter(d=>d.id!==selCarId)];

  // ── Per-world start T: always on the main straight approaching S/F ──────
  // Each world's straight is different — use t≈0.94 range so the grid sits
  // on the final straight before t=0.
  const _worldGridT={
    space:0.940,      // Space: last WP at ~0.94, straight into t=0
    deepsea:0.940,    // DeepSea: last WP at ~0.94, straight into t=0
    candy:0.940,      // Candy: last WP at ~0.96, straight into t=0
    volcano:0.940,
    arctic:0.940,
    sandstorm:0.940,  // Sandstorm: last WP at -90,268, straight into t=0=0,270
  };
  // How many track units between each grid row
  const _rowGap=0.014; // slightly wider gap for cleaner grid separation

  orderedDefs.forEach((def,i)=>{
    // Phase 9.4 — pass carNumber (1..N) zodat livery.js elke car een
    // uniek racing-number badge geeft. Player = 1, AI in grid-volgorde.
    const mesh=makeCar(def, i + 1);
    const row=Math.floor(i/2),col=i%2;
    // t decreases as we go further behind the S/F line
    const baseT=_worldGridT[activeWorld]||0.940;
    const t0=((baseT - row*_rowGap)+1)%1;
    const pt=trackCurve.getPoint(t0);
    const tg=trackCurve.getTangent(t0).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    // Clean F1-style 2-wide grid: left col slightly ahead (stagger)
    const colSign=col===0?-1:1;
    const lateralOffset=colSign*4.5;
    const fwdStagger=col===0?0.8:0; // left column (pole side) slightly ahead
    mesh.position.copy(pt)
      .addScaledVector(nr,lateralOffset)
      .addScaledVector(tg,fwdStagger);
    mesh.position.y=0.35;
    // Face exactly the track direction at this point
    mesh.rotation.set(0,Math.atan2(-tg.x,-tg.z),0);
    scene.add(mesh);
    const isPlayer=def.id===selCarId;if(isPlayer)playerIdx=carObjs.length;
    // Reverse light (red box at rear)
    const rlGeo=new THREE.BoxGeometry(.34,.1,.04);
    const rlMat=new THREE.MeshLambertMaterial({color:0xff2200,emissive:0xff2200,emissiveIntensity:0});
    const rl=new THREE.Mesh(rlGeo,rlMat);
    const bL=def.type==='muscle'?4.35:def.type==='f1'?4.5:4.05;
    rl.position.set(0,.28,bL*.5+.02);
    mesh.add(rl);
    _reverseLights.push(rl);
    // Sessie 02 — brake-light + headlight bloom sprites on every car.
    // Sprite material auto-faces camera; additive blending feeds the
    // bloom pass for that "ooh, lights" night look. Refs kept on
    // mesh.userData so night.js can scale them per-frame.
    const _brakeSpriteTex = (window.PARTICLE_TEX && window.PARTICLE_TEX.cloud)
      ? window.PARTICLE_TEX.cloud() : null;
    const _headSpriteTex  = (window.PARTICLE_TEX && window.PARTICLE_TEX.spark)
      ? window.PARTICLE_TEX.spark() : null;
    if(_brakeSpriteTex){
      const brakeSprites=[];
      [-0.42, 0.42].forEach(s=>{
        const m=new THREE.SpriteMaterial({
          map:_brakeSpriteTex, color:0xff2200,
          transparent:true, depthWrite:false,
          blending:THREE.AdditiveBlending, opacity:0
        });
        const sp=new THREE.Sprite(m);
        sp.position.set(s, 0.42, bL*.5+0.10);
        sp.scale.set(0.85, 0.85, 1);
        mesh.add(sp);
        brakeSprites.push(sp);
      });
      mesh.userData._brakeBloom = brakeSprites;
    }
    if(_headSpriteTex){
      const headSprites=[];
      [-0.55, 0.55].forEach(s=>{
        const m=new THREE.SpriteMaterial({
          map:_headSpriteTex, color:0xfff5d0,
          transparent:true, depthWrite:false,
          blending:THREE.AdditiveBlending, opacity:0
        });
        const sp=new THREE.Sprite(m);
        sp.position.set(s, 0.50, -bL*.5-0.08);
        sp.scale.set(1.05, 1.05, 1);
        mesh.add(sp);
        headSprites.push(sp);
      });
      mesh.userData._headBloom = headSprites;
    }
    // Per-world livery underglow — additive disc plane onder elke auto met
    // een wereld-thematische kleur. Geeft een herkenbare per-circuit feel
    // zonder de individuele car-colors te overschrijven. Met bloom = subtle
    // pulse-glow rondom alle racers.
    // Sandstorm is uitgesloten: bright daylight desert + additive disc
    // tegen warm zandgrond rendert als uitgewassen wit-grijze "blokjes"
    // onder de auto's — fixt visual issue 7+8 in de v2-bugfix.
    if(!isPlayer && activeWorld!=='sandstorm'){
      const livery={
        space:0x4488ff,deepsea:0x00ffaa,candy:0xff66cc,
        volcano:0xff5500,arctic:0x88ccff
      }[activeWorld]||0xffaa44;
      const ugMat=new THREE.MeshBasicMaterial({
        color:livery,transparent:true,opacity:.42,
        blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide
      });
      const ug=new THREE.Mesh(new THREE.CircleGeometry(2.0,16),ugMat);
      ug.rotation.x=-Math.PI/2;ug.position.y=-.32;
      mesh.add(ug);
    }
    // Contact-shadow blob — small dark disc under every car, regardless
    // of player/AI status. Grounds the car visually on any surface (sun
    // shadow doesn't hit underbody, hemiLight fills below — without this
    // the car looks like it's floating on bright worlds). Skipped on
    // sandstorm internally (bright sand + black blob = oil stain).
    _attachContactShadow(mesh);
    // Player premium-tier underglow — accent-colored additive disc onder
    // de player car, op alle worlds. Brand-builders (Tier S/A) zetten hun
    // eigen signature via g.userData._signature.underglow op de top-level
    // group; non-premium tiers laten dat veld leeg en krijgen geen glow.
    // Phase 3 patroon — vervangt de Bugatti-only hardcode uit Phase 2.
    const sig=mesh.userData&&mesh.userData._signature;
    if(isPlayer && sig && sig.underglow!=null && activeWorld!=='sandstorm'){
      const ugMat=new THREE.MeshBasicMaterial({
        color:sig.underglow,transparent:true,opacity:.35,
        blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide
      });
      const ug=new THREE.Mesh(new THREE.CircleGeometry(2.2,16),ugMat);
      ug.rotation.x=-Math.PI/2;ug.position.y=-.32;
      mesh.add(ug);
      // Phase R2.2 — onthoud materiaal + baseline opacity zodat
      // updateUnderglowPulse in visuals.js het kan ademen tijdens
      // nitro/drift voor een aggressive-driving signal.
      mesh.userData._underglowMat = ugMat;
      mesh.userData._underglowBase = 0.35;
    }
    // Player headlight beam-cones (alleen zichtbaar bij night) — ConeGeometry
    // met radial alpha-mask zodat de buitenrand zacht uitfade't (geen polygon-
    // edges meer zichtbaar). Additive blend, depth-write off. Animated opacity
    // in updateCarLights() voegt subtiele flicker toe.
    if(isPlayer){
      const beamMat=new THREE.MeshBasicMaterial({
        color:0xfff5d0,
        map:_softHeadlightMaskTex(),
        transparent:true,opacity:0,
        blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide
      });
      // 32 radial segments + 8 height segments zodat de UV-gradient soepel
      // resampelt — geen visible faceting meer onder additive. Op mobile
      // halveren we beide assen — additive transparent op een 32×8 cone is
      // fillrate-zwaar; 16×4 is visueel nauwelijks anders bij race-snelheid.
      const segR = window._isMobile ? 16 : 32;
      const segH = window._isMobile ? 4  : 8;
      const coneGeo=new THREE.ConeGeometry(2.6,12,segR,segH,true);
      [-0.62,0.62].forEach(s=>{
        const beam=new THREE.Mesh(coneGeo,beamMat.clone());
        // Cone default points up (+Y) → roteer 90° rond X zodat top naar achter
        // wijst en base naar voren (in car-local -Z = forward)
        beam.rotation.x=-Math.PI/2;
        // Position: tip (top) bij headlight, base 12 units voor de auto
        beam.position.set(s,0.45,-7.9);
        beam.userData.isHeadBeam=true;
        beam.userData.flickerPhase=Math.random()*Math.PI*2;
        mesh.add(beam);
      });
      // Phase 8b — headlight ground illumination. Twee additieve discs
      // ELIPS-verlopend van fel-bij-bumper tot fade-in-de-verte, vlak boven
      // de grond zodat ze als verlichte plek op het asfalt lezen wanneer
      // koplampen aan staan. Tier-gate: alleen high-tier (shadows enabled,
      // niet-mobile) — extra fillrate maar voegt veel diepte toe in night-
      // mode op Pier47/Guangzhou.
      const _hi = !!(window._qFlags && window._qFlags.shadows) && !window._isMobile;
      if(_hi){
        const glowMat=new THREE.MeshBasicMaterial({
          color:0xfff5d0,
          map:_softHeadlightMaskTex(),
          transparent:true,opacity:0,
          blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide
        });
        // Plane (4×9) liggend op de grond, voor de auto. Map alpha-falloff
        // van het bestaande softHeadlightMask geeft natuurlijke fade.
        const glowGeo=new THREE.PlaneGeometry(4.0,9.0);
        [-0.62,0.62].forEach(s=>{
          const glow=new THREE.Mesh(glowGeo,glowMat.clone());
          glow.rotation.x=-Math.PI/2;             // liggend op grond
          glow.rotation.z=Math.PI;                 // alpha-grad start dichtbij
          glow.position.set(s,-0.32,-5.5);         // 5.5u voor de auto
          glow.userData.isHeadGroundGlow=true;
          glow.userData.flickerPhase=Math.random()*Math.PI*2;
          mesh.add(glow);
        });
      }
    }
    // Small initial lateral offset so AI don't all drive on the exact center line
    // (kept near zero at start to prevent collision; grows naturally during race)
    const latOff=isPlayer?0:(col===0?-1.2:1.2)+(Math.random()-.5)*.8;
    const personality=_aiPersonality[def.id]||{aggr:.6,consist:.7};
    // Per-car preferred lane-bias gebruikt door ai.js racing-line block.
    // Agressieve auto's krijgen sterkere bias (hugger), consistente auto's
    // blijven dichter bij de baseline. Sign per grid-column zodat het
    // peloton niet allemaal dezelfde kant op duwt.
    const _lineBias=isPlayer?0:((col===0?-1:1)*(0.6+personality.aggr*0.9)+(Math.random()-.5)*0.5);
    carObjs.push({mesh,speed:0,vy:0,progress:t0,prevProg:t0,lap:0,isPlayer,def,finished:false,
      boostTimer:0,spinTimer:0,inAir:false,lateralOff:latOff,_lineBias:_lineBias,bestLap:null,_lapStart:null,_finishTime:null,
      tireWear:0,hitCount:0,smokeSrc:null,_personality:personality,_gridPos:i+1});
    // Mirror grid-position into the global _gridPos array so finish.js
    // can compute startPos - finalPos for the comeback bonus.
    if(typeof _gridPos!=='undefined')_gridPos[carObjs.length-1]=i+1;
  });
  // Reset nearest-miss cooldowns
  for(let i=0;i<carObjs.length;i++)_nearMissCooldown[i]=0;
  // Reset pit stop
  _pitStopActive=false;_pitStopTimer=0;_pitStopUsed=false;
  _overallFastestLap=Infinity;
  // Init near-miss cooldowns for all cars
  for(let i=0;i<CAR_DEFS.length;i++)_nearMissCooldown[i]=0;
  // Sessie 05 — pick a nemesis among the AI field. Highest aggr value
  // wins; ties broken by first-spawned. Skipped on solo runs (no AI).
  _nemesisIdx = -1;
  let _nemAggr = -1;
  for(let i=0;i<carObjs.length;i++){
    if(i===playerIdx)continue;
    const p = carObjs[i]._personality;
    if(p && p.aggr > _nemAggr){
      _nemAggr = p.aggr;
      _nemesisIdx = i;
    }
  }
}
