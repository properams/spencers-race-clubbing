// js/track/collectibles.js — non-module script.

'use strict';

// Throttle anchors voor pickup-burst: zonder deze stapelt elke coin in een
// chain 8 audio-nodes + 2 DOM-mutaties op. Zie checkCollectibles() voor
// gebruik.
let _lastCollectAudioT=0;
let _lastCoinPopupT=0;

function buildCollectibles(){
  // Per-world palette — coin, emissive, rim highlight, halo glow, light colour
  const PAL={
    space:    {coin:0x66ccff,emit:0x2288ff,rim:0xcce8ff,halo:0x66aaff,light:0x88bbff},
    deepsea:  {coin:0xffaa33,emit:0xcc7700,rim:0xffd999,halo:0xffaa00,light:0xffaa44},
    candy:    {coin:0xff77cc,emit:0xdd2288,rim:0xffddf0,halo:0xff55aa,light:0xff66cc},
    volcano:  {coin:0xff7722,emit:0xff2200,rim:0xffcc88,halo:0xff4411,light:0xff4422},
    arctic:   {coin:0xaadfff,emit:0x4488dd,rim:0xe8f5ff,halo:0x88bbee,light:0xaaddff},
    // Sandstorm — warm sand-orange coin matching the canyon palette
    // (sand: #ff8c42, halo: #ff9c52). Without this entry the lookup
    // falls back to PAL.space (#66ccff cyan) which clashes with the
    // warm desert tones.
    sandstorm:{coin:0xff8c42,emit:0xc97232,rim:0xffe4a8,halo:0xff9c52,light:0xffaa66},
    // Pier 47 — sodium-amber matching the lamp anchor (#ff8830) in
    // js/worlds/pier47.js. Avoids the PAL.space (#66ccff cyan) fallback
    // which clashes with the warm overcast harbour palette.
    pier47:   {coin:0xff8830,emit:0xa04020,rim:0xffcc88,halo:0xffaa44,light:0xff9933},
    // Guangzhou — neon-magenta coin matching the kerbEmissive (#ff2080) in
    // js/worlds/guangzhou.js. Avoids the PAL.space (#66ccff cyan) fallback
    // which reads as monotone against the already-cyan lamp poles.
    guangzhou:{coin:0xff2080,emit:0xaa1050,rim:0xff80c0,halo:0xff40a0,light:0xff2080},
  };
  const pal=PAL[activeWorld]||PAL.space;

  const positions=[.07,.18,.30,.42,.55,.67,.78,.90];
  positions.forEach(t=>{
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const offset=(Math.random()-.5)*7;
    const pos=p.clone().addScaledVector(nr,offset);pos.y=2.3;

    const g=new THREE.Group();g.position.copy(pos);

    // [0] Core — tiny bright white nucleus (visible through disc)
    const core=new THREE.Mesh(new THREE.SphereGeometry(.2,8,8),
      new THREE.MeshBasicMaterial({color:0xffffff}));
    g.add(core);

    // [1] Main coin disc — thin cylinder standing vertically (faces camera as group rotates)
    // Phase 7.1: intensity 1.2 → 1.8 so coins read as bright neon beacons
    // from longer distance + tie into the universally-bumped halo/light.
    const coinMat=new THREE.MeshLambertMaterial({color:pal.coin,emissive:pal.emit,emissiveIntensity:1.8});
    const coin=new THREE.Mesh(new THREE.CylinderGeometry(.92,.92,.16,28),coinMat);
    coin.rotation.x=Math.PI/2; // stand up like a coin
    g.add(coin);

    // [2] Rim halo — thicker torus at coin edge for neon glow
    // Phase 7.1: halo intensity 1.5 → 1.9 for punchy doughnut-glow ring.
    const halo=new THREE.Mesh(new THREE.TorusGeometry(1.02,.10,8,36),
      new THREE.MeshLambertMaterial({color:pal.halo,emissive:pal.halo,emissiveIntensity:1.9,transparent:true,opacity:.85}));
    halo.rotation.x=Math.PI/2;
    g.add(halo);

    // [3] Outer halo ring — concentric (was tilted Saturn-style; per
    // C2 owner feedback the tilted ring read as 'Saturn planet'). Now
    // sits in the coin plane at slightly larger radius + thicker tube
    // for a cohesive double-halo look. The per-frame Z-rotation in
    // updateCollectibles still targets children[3] — animation now
    // reads as a sparkle wobble around the coin instead of an orbit.
    const orbit=new THREE.Mesh(new THREE.TorusGeometry(1.55,.075,8,44),
      new THREE.MeshLambertMaterial({color:pal.rim,emissive:pal.rim,emissiveIntensity:1.0,transparent:true,opacity:.55}));
    orbit.rotation.x=Math.PI/2;
    g.add(orbit);

    // [4] Star face — glowing octahedron floating at front of coin
    const star=new THREE.Mesh(new THREE.OctahedronGeometry(.36,0),
      new THREE.MeshBasicMaterial({color:pal.rim,transparent:true,opacity:.95}));
    star.position.z=.13;
    g.add(star);

    // [5] Vertical soft beam — Phase 7.2: MeshBasic → MeshLambert emissive
    // zodat de beam in bloom oplicht. Eerder was de flat-color beam
    // onzichtbaar voor bloom en las als chiffon-overlay; emissive variant
    // punst een echte visible light shaft boven elke coin.
    const beam=new THREE.Mesh(new THREE.CylinderGeometry(.05,.42,14,8,1,true),
      new THREE.MeshLambertMaterial({color:pal.light,emissive:pal.light,emissiveIntensity:1.6,transparent:true,opacity:.18,side:THREE.DoubleSide,depthWrite:false}));
    beam.position.y=6;g.add(beam);

    // [6] Ground marker ring — anchors the token visually
    // polygonOffset pulls the ring toward camera so it wins depth-test against
    // asphalt on low-precision depth buffers (iPhone/iPad Safari). Fixes
    // "pink portal rings clipping into asphalt" — Issue 3 V5.3 fix pass.
    const groundRingMat=new THREE.MeshBasicMaterial({color:pal.halo,transparent:true,opacity:.35,side:THREE.DoubleSide,depthWrite:false});
    groundRingMat.polygonOffset=true;groundRingMat.polygonOffsetFactor=-3;groundRingMat.polygonOffsetUnits=-3;
    const groundRing=new THREE.Mesh(new THREE.RingGeometry(.55,1.25,28),groundRingMat);
    groundRing.rotation.x=-Math.PI/2;
    groundRing.position.y=-pos.y+.025;
    g.add(groundRing);

    scene.add(g);
    // Phase 7.1: PointLight intensity 2.2 → 2.8 — coins als bright beacons
    // op afstand + bloom catcht de light spill op surrounding props/track.
    const starLight=new THREE.PointLight(pal.light,2.8,18);
    starLight.position.copy(pos);starLight.userData._baseIntensity=2.8;scene.add(starLight);
    collectibles.push({mesh:g,pos:pos.clone(),collected:false,radius:2.4,respawn:0,type:'score',light:starLight});
  });

  // Repair kits — modern medical hex-token
  [.04,.45,.82].forEach(t=>{
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const pos=p.clone().addScaledVector(nr,5.5);pos.y=2.1;

    const g=new THREE.Group();g.position.copy(pos);

    // [0] Core
    const core=new THREE.Mesh(new THREE.SphereGeometry(.18,8,8),
      new THREE.MeshBasicMaterial({color:0xffffff}));
    g.add(core);

    // [1] Hex-token base (6-sided cylinder standing like coin)
    const hex=new THREE.Mesh(new THREE.CylinderGeometry(1.05,1.05,.18,6),
      new THREE.MeshLambertMaterial({color:0x00ee66,emissive:0x00aa33,emissiveIntensity:1.1}));
    hex.rotation.x=Math.PI/2;
    g.add(hex);

    // [2] Rim halo
    const halo=new THREE.Mesh(new THREE.TorusGeometry(1.1,.09,8,24),
      new THREE.MeshLambertMaterial({color:0x44ffaa,emissive:0x00ff77,emissiveIntensity:1.4,transparent:true,opacity:.85}));
    halo.rotation.x=Math.PI/2;
    g.add(halo);

    // [3] Plus sign — bright emissive, on face
    const plusMat=new THREE.MeshBasicMaterial({color:0xffffff});
    const plusH=new THREE.Mesh(new THREE.BoxGeometry(.95,.28,.08),plusMat);
    plusH.position.z=.12;g.add(plusH);
    const plusV=new THREE.Mesh(new THREE.BoxGeometry(.28,.95,.08),plusMat);
    plusV.position.z=.12;
    // Stash vertical on same child index so animation still targets .children[3] for orbit
    g.add(plusV);

    // [5] Light beam
    const bm=new THREE.Mesh(new THREE.CylinderGeometry(.05,.38,14,8,1,true),
      new THREE.MeshBasicMaterial({color:0x00ff66,transparent:true,opacity:.09,side:THREE.DoubleSide,depthWrite:false}));
    bm.position.y=6;g.add(bm);

    // [6] Ground ring — polygonOffset prevents z-fight against asphalt (Issue 3)
    const groundRingMatK=new THREE.MeshBasicMaterial({color:0x00ff66,transparent:true,opacity:.32,side:THREE.DoubleSide,depthWrite:false});
    groundRingMatK.polygonOffset=true;groundRingMatK.polygonOffsetFactor=-3;groundRingMatK.polygonOffsetUnits=-3;
    const groundRing=new THREE.Mesh(new THREE.RingGeometry(.6,1.4,24),groundRingMatK);
    groundRing.rotation.x=-Math.PI/2;
    groundRing.position.y=-pos.y+.025;
    g.add(groundRing);

    scene.add(g);
    const kitLight=new THREE.PointLight(0x00ff66,1.6,16);
    kitLight.position.copy(pos);kitLight.userData._baseIntensity=1.6;scene.add(kitLight);
    collectibles.push({mesh:g,pos:pos.clone(),collected:false,radius:2.6,respawn:15,type:'repair',light:kitLight});
  });
}


function checkCollectibles(){
  const car=carObjs[playerIdx];if(!car)return;
  const now=_nowSec;
  // forEach → for: ran every frame in RACE.
  for(let _ci=0;_ci<collectibles.length;_ci++){
    const c=collectibles[_ci];
    if(c.collected){
      // Respawn — restore mesh + light. Intensity-toggle (geen visible-flip)
      // voorkomt shader-recompile van alle MeshLambertMaterials in de scene
      // wanneer de PointLight-count zou veranderen (zie pickup-zijde).
      if(now>c.respawn){c.collected=false;c.mesh.visible=true;if(c.light)c.light.intensity=c.light.userData._baseIntensity||1.0;}
      continue;
    }
    c.mesh.rotation.y+=.045;c.mesh.position.y=c.pos.y+Math.sin(now*2+c.pos.x)*.32;
    // New structure: [0]core [1]coin [2]halo [3]orbit [4]star/plus [5]beam [6]groundRing
    const ch=c.mesh.children;
    if(ch){
      if(ch[2])ch[2].rotation.z+=.024;            // halo tilts
      if(ch[3])ch[3].rotation.z+=.036;            // orbit ring spins
      if(ch[4])ch[4].rotation.y-=.06;             // star counter-spin
    }
    if(c.type==='score'){
      const pulse=Math.sin(now*3.2+c.pos.x*.5);
      c.mesh.scale.setScalar(1+pulse*.10);
      if(c.light)c.light.intensity=1.8+pulse*0.8;
    }else{
      // Repair kit: slower pulse, green flicker
      const pulse=Math.sin(now*2.4+c.pos.z*.4);
      if(c.light)c.light.intensity=1.2+pulse*0.6;
    }
    const dx=car.mesh.position.x-c.pos.x,dz=car.mesh.position.z-c.pos.z;
    if(dx*dx+dz*dz<c.radius*c.radius){
      // Pickup — hide mesh, zero out light intensity (NIET light.visible).
      // light.visible=false zou de actieve PointLight-count verlagen en
      // Three.js dwingen alle MeshLambertMaterials te recompilen → 50-150ms
      // hitch op tracks met veel lit materials (Pier 47 in het bijzonder).
      c.collected=true;c.mesh.visible=false;if(c.light)c.light.intensity=0;c.respawn=now+(c.type==='repair'?15:10);
      // Audio rate-limit: rapid coin-chains (>12Hz) stapelen anders 4
      // oscillators × hit op de SFX-bus en geven hoorbare smear + GC-spike.
      // 80ms ondergrens zit onder de menselijke perceptie van losse hits.
      if(now-_lastCollectAudioT>0.08){ Audio.playCollect(); _lastCollectAudioT=now; }
      // Pickup-spark: lichter dan voorheen (16/10+6 → 12/8+5) om GC-druk
      // bij snel achter elkaar oppakken te dempen. Visueel verwaarloosbaar.
      if(c.type==='repair'){
        sparkSystem.emit(c.pos.x,c.pos.y,c.pos.z,0,.06,0,12, .1, .9, .2, .8);
      } else {
        sparkSystem.emit(c.pos.x,c.pos.y,c.pos.z,0,.06,0, 8, .65, .20, 1.0, .85);
        sparkSystem.emit(c.pos.x,c.pos.y,c.pos.z,0,.06,0, 5, 1.0, .85, .30, .80);
      }
      if(c.type==='repair'){
        car.hitCount=Math.max(0,(car.hitCount||0)-2);
        car.tireWear=Math.max(0,(car.tireWear||0)-.35);
        // showPopup throttle (1s): rapid pickups doen anders elke 80ms een
        // DOM-mutatie via Notify.status; floatText3D blijft per pickup voor
        // positional feedback (pool-gebaseerd, goedkoop).
        if(now-_lastCoinPopupT>1.0){ showPopup('🔧 REPAIRS +50','#00ff88',1100); _lastCoinPopupT=now; }
        floatText3D('🔧 REPAIRS!','#00ff88',c.pos);
        totalScore+=50;
      }else{
        totalScore+=100;
        if(now-_lastCoinPopupT>1.0){ showPopup('⭐ +100 PTS!','#ffdd00',900); _lastCoinPopupT=now; }
        floatText3D('+100 ⭐','#ffdd00',c.pos);
      }
    }
  }
}


// Crowd-materials registry — gevuld in buildSpectators.
// updateCrowd() toggled offset.y tussen frame-0 en frame-1 zodat arms wuiven.
// Elke buildScene roept buildSpectators opnieuw aan, dus we resetten daar.
let _crowdMaterials=[];

// Procedurele crowd-silhouet textuur. 512×192 canvas met TWEE frames stacked:
// frame 0 (top, y=0..96)  = alle figuren met arms-down (rust)
// frame 1 (bot, y=96..192) = ~40% van de figuren met arms-up (waving)
// Material gebruikt repeat.y=0.5 + offset.y die updateCrowd toggled tussen 0
// en 0.5 elke ~400ms ⇒ stadion-effect zonder per-frame canvas-redraw.
function _buildCrowdTex(){
  const W=512,FH=96,H=FH*2,c=document.createElement('canvas');c.width=W;c.height=H;
  const g=c.getContext('2d');
  g.clearRect(0,0,W,H);
  // Pre-generate seed list zodat beide frames identieke figuren krijgen
  // (alleen de armen verschillen). Dat voorkomt visuele "swap" van mensen.
  const figures=[];
  const drawRow=(rowY,scale,alpha)=>{
    const figW=10*scale,gap=4*scale;
    for(let x=2;x<W;x+=figW+gap+(Math.random()*4-2)){
      figures.push({
        x,rowY,scale,alpha,
        bodyHue:Math.floor(Math.random()*360),
        bodySat:65,bodyLum:30+Math.random()*25,
        headHue:20+Math.random()*15,
        headSat:45,headLum:55+Math.random()*15,
        wave:Math.random()<.40, // 40% van de figuren hebben "wave-mode"
        figW
      });
    }
  };
  drawRow(FH-2,.95,.85);
  drawRow(FH-22,.85,.7);
  drawRow(FH-42,.75,.55);
  // Frame painter — yOffset 0 = frame-0 (arms down), FH = frame-1 (arms up for wave-mode figures)
  const paintFrame=(yOffset,armUp)=>{
    figures.forEach(f=>{
      g.fillStyle=`hsla(${f.bodyHue},${f.bodySat}%,${f.bodyLum}%,${f.alpha})`;
      const bw=f.figW*.85,bh=18*f.scale,by=f.rowY-bh+yOffset;
      g.fillRect(f.x,by,bw,bh);
      g.fillStyle=`hsla(${f.headHue},${f.headSat}%,${f.headLum}%,${f.alpha})`;
      const hr=4*f.scale;
      g.beginPath();g.arc(f.x+bw/2,by-hr*.6,hr,0,Math.PI*2);g.fill();
      if(f.wave){
        // Beide armen, links en rechts
        const armW=2,armH=bh*.5*(armUp?-1:.5); // up = negative y growth
        g.fillRect(f.x-1,by+(armUp?0:bh*.2),armW,armH);
        g.fillRect(f.x+bw-1,by+(armUp?0:bh*.2),armW,armH);
      }
    });
  };
  paintFrame(0,false);  // frame 0
  paintFrame(FH,true);  // frame 1
  const t=new THREE.CanvasTexture(c);
  t.wrapS=THREE.RepeatWrapping;t.wrapT=THREE.ClampToEdgeWrapping;
  t.repeat.y=0.5;t.offset.y=0;
  t.needsUpdate=true;return t;
}

// Toggle crowd frame every ~400ms. Aangeroepen vanuit updateFlags()
// (gegarandeerd elke frame tijdens RACE/FINISH).
let _crowdFrame=0,_crowdFrameNext=0;
function updateCrowd(){
  if(!_crowdMaterials.length)return;
  if(_nowSec<_crowdFrameNext)return;
  _crowdFrame=1-_crowdFrame;
  _crowdFrameNext=_nowSec+0.35+Math.random()*0.25;
  const off=_crowdFrame*0.5;
  // forEach → for: ~3 fps trigger but the closure was still allocated
  // per call. Crowd materials list grows with spectators (potentially
  // dozens per world).
  for(let i=0;i<_crowdMaterials.length;i++){
    const m=_crowdMaterials[i];
    if(m&&m.map)m.map.offset.y=off;
  }
}

function buildSpectators(){
  // Skip on space/deepsea — niet thematisch passend.
  if(_isVoidWorld(activeWorld))return;
  _crowdMaterials.length=0;
  const crowdTex=_buildCrowdTex();
  // Two grandstand sections aan weerszijden van het start/finish-stuk.
  // Plane van 80×4 m, met UV-repeat zodat de crowd herhaalt.
  const t0=0;
  const p=trackCurve.getPoint(t0),tg=trackCurve.getTangent(t0).normalize();
  const nr=new THREE.Vector3(-tg.z,0,tg.x);
  const offset=BARRIER_OFF+5;
  [-1,1].forEach(side=>{
    const tex=crowdTex.clone();tex.needsUpdate=true;
    tex.repeat.set(8,0.5);tex.offset.y=0;
    const mat=new THREE.MeshBasicMaterial({map:tex,transparent:true,alphaTest:.05,side:THREE.DoubleSide});
    _crowdMaterials.push(mat);
    const stand=new THREE.Mesh(new THREE.PlaneGeometry(80,4),mat);
    // Position parallel to track direction at start/finish
    stand.position.copy(p).addScaledVector(nr,side*offset);
    stand.position.y=2;
    // Plane normal moet naar binnen wijzen (perpendiculair op tangent) zodat
    // de tribune láángs de track loopt ipv erover heen. side<0 → normal = +nr,
    // side>0 → normal = -nr (180° flip om naar de track te kijken).
    stand.rotation.y=Math.atan2(nr.x,nr.z);
    if(side<0)stand.rotation.y+=Math.PI;
    scene.add(stand);
    // Flag banners along the grandstand top — 16 stuks, kleurrijk team-style.
    // Pushed in _trackFlags array zodat updateFlags() ze automatisch animeert.
    const bannerCols=[0xff2233,0xffcc11,0x2266ff,0x22cc55,0xff66aa,0xff8822,0xaa44ff,0x44ddcc];
    const along=tg.clone();
    for(let bi=0;bi<16;bi++){
      const dx=(bi-7.5)*5;
      // Pole
      const pole=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,1.6,4),
        new THREE.MeshLambertMaterial({color:0x444444}));
      pole.position.copy(stand.position);
      pole.position.y=4.6;
      pole.position.addScaledVector(along,dx);
      pole.position.addScaledVector(nr,side*0.2);
      scene.add(pole);
      // Flag (small plane that pivots on pole)
      const fCol=bannerCols[bi%bannerCols.length];
      const fMat=new THREE.MeshBasicMaterial({color:fCol,side:THREE.DoubleSide,transparent:true,opacity:.95});
      const flag=new THREE.Mesh(new THREE.PlaneGeometry(1.2,.7),fMat);
      flag.position.copy(pole.position);
      flag.position.y=5.1;
      flag.position.addScaledVector(along,.7);
      flag.rotation.y=Math.atan2(nr.x,nr.z)+(side<0?Math.PI:0);
      scene.add(flag);
      _trackFlags.push({mesh:flag,base:flag.position.clone(),side,idx:bi});
    }
  });
}

