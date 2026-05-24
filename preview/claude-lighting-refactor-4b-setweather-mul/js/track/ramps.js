// js/track/ramps.js — non-module script.

'use strict';

// Pre-allocated scratch vector (uit main.js verhuisd).
const _jFwdV=new THREE.Vector3();

function buildJumpRamps(){
  const rampDefs=[
    {t:.12, h:2.8, label:'JUMP!'},
    {t:.35, h:3.2, label:'BIG AIR!'},
    {t:.75, h:2.4, label:'JUMP!'},
  ];
  rampDefs.forEach(def=>{
    const p=trackCurve.getPoint(def.t);
    const tg=trackCurve.getTangent(def.t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const angle=Math.atan2(tg.x,tg.z);
    const padLen=9,padW=TW*1.5;
    const h=def.h;

    // Per-world colours
    const isSpR=activeWorld==='space',isDsR=activeWorld==='deepsea',isSsR=activeWorld==='sandstorm';
    const padCol=isSpR?0x6600cc:isDsR?0x006644:isSsR?0xcc6622:0xff4400;
    const padEmit=isSpR?0x8833ff:isDsR?0x00aacc:isSsR?0xff8833:0xff7722;
    const stripeColR=isSpR?0x00ccff:isDsR?0x00ffaa:isSsR?0xffd870:0xffdd00;

    // Flat glowing launchpad on the track — no obstacle
    const padMat=new THREE.MeshLambertMaterial({color:padCol,emissive:padEmit,emissiveIntensity:1.2,transparent:true,opacity:.88});
    padMat.polygonOffset=true;padMat.polygonOffsetFactor=-3;padMat.polygonOffsetUnits=-3;
    const pad=new THREE.Mesh(new THREE.PlaneGeometry(padW,padLen),padMat);
    pad.rotation.x=-Math.PI/2;pad.rotation.z=angle;
    pad.position.copy(p);pad.position.y=.06;
    scene.add(pad);

    // Chevron arrows painted on pad pointing forward (3 bright chevrons)
    // Phase 7.5: MeshBasicMaterial → MeshLambertMaterial met emissive zodat
    // de chevrons in bloom mee gloeien (was flat color).
    const stripeMat=new THREE.MeshLambertMaterial({color:stripeColR,emissive:stripeColR,emissiveIntensity:1.2});
    [-1,0,1].forEach(i=>{
      const a1=new THREE.Mesh(new THREE.PlaneGeometry(padW*.7,.35),stripeMat);
      a1.rotation.x=-Math.PI/2;a1.rotation.z=angle;
      a1.position.copy(p);a1.position.y=.08;
      a1.position.addScaledVector(tg,i*padLen*.25);
      scene.add(a1);
    });

    // Floating JUMP! sign above pad
    const glowPole=new THREE.Mesh(new THREE.CylinderGeometry(.2,.25,h+3.5,6),
      new THREE.MeshLambertMaterial({color:padCol,emissive:padEmit,emissiveIntensity:.6}));
    glowPole.position.copy(p);glowPole.position.y=(h+3.5)*.5;
    glowPole.position.addScaledVector(nr,padW*.52);
    scene.add(glowPole);
    const sign=new THREE.Mesh(new THREE.BoxGeometry(padW*.6,1.2,.15),
      new THREE.MeshBasicMaterial({color:0xffffff}));
    sign.position.copy(p);sign.position.y=h+3.2;sign.rotation.y=angle;
    scene.add(sign);
    const signAccent=new THREE.Mesh(new THREE.BoxGeometry(padW*.6,.18,.16),
      new THREE.MeshBasicMaterial({color:padEmit}));
    signAccent.position.copy(p);signAccent.position.y=h+4;signAccent.rotation.y=angle;
    scene.add(signAccent);
    // Point light for dramatic glow
    // Phase 7.5b: PointLight intensity 1.5 → 2.0 — sterker beacon-effect
    // op het jump-pad sign, bloom catcht de extra spill.
    const pl=new THREE.PointLight(padEmit,2.0,28);
    pl.position.copy(p);pl.position.y=h+3.2;scene.add(pl);

    jumpRamps.push({
      pos:p.clone(),tg:tg.clone(),
      width:padW,len:padLen,h,
      launchV:h*.3,label:def.label,
    });
  });
}


function buildSpinPads(){
  const spinDefs=[{t:.18},{t:.50},{t:.84}];
  // Per-world palette — hazard theme
  const SP={
    space:    {disc:0x0033cc,emit:0x001188,ring:0x00aaff,cone:0x8866ff,marker:0x4422cc},
    deepsea:  {disc:0x005566,emit:0x003344,ring:0x00ddcc,cone:0x44ffcc,marker:0x00aa88},
    candy:    {disc:0xff3388,emit:0xcc0066,ring:0xff66bb,cone:0xffdd44,marker:0xffaa00},
    volcano:  {disc:0xaa3300,emit:0x661100,ring:0xff6622,cone:0xff9922,marker:0xcc2200},
    arctic:   {disc:0x336699,emit:0x113366,ring:0x66ccff,cone:0xbbeeff,marker:0x4488cc},
    sandstorm:{disc:0x8b4a25,emit:0x5a2818,ring:0xff8c42,cone:0xd4a55a,marker:0xc97232},
    // Pier 47 — sodium-amber matching the lamp anchor (#ff8830) in
    // js/worlds/pier47.js. Without this entry the lookup falls back to
    // SP.space (#0033cc) which reads as cold blue against the warm
    // overcast harbour palette.
    pier47:   {disc:0xa04020,emit:0x661511,ring:0xff8830,cone:0xffaa44,marker:0xa04020},
    // Guangzhou — neon-magenta disc matching kerbEmissive (#ff2080).
    // Without this entry the lookup falls back to SP.space (#0033cc dark blue)
    // which clashes with the magenta/cyan neon palette.
    guangzhou:{disc:0xaa1050,emit:0x660830,ring:0xff2080,cone:0x00e0ff,marker:0xff2080},
  };
  const pal=SP[activeWorld]||SP.space;

  spinDefs.forEach(def=>{
    const p=trackCurve.getPoint(def.t).clone();p.y=.015;

    // Flat hazard disc — clean circle
    // Phase 7.4: disc intensity 0.9 → 1.1 — central hazard-circle leest
    // nu als glowing ipv painted; tied into bumped outer-ring below.
    const discMat=new THREE.MeshLambertMaterial({color:pal.disc,emissive:pal.emit,emissiveIntensity:1.1,transparent:true,opacity:.9});
    discMat.polygonOffset=true;discMat.polygonOffsetFactor=-3;discMat.polygonOffsetUnits=-3;
    const disc=new THREE.Mesh(new THREE.CylinderGeometry(4.2,4.2,.1,40),discMat);
    disc.position.copy(p);disc.position.y=.05;
    scene.add(disc);

    // Bold hazard X-pattern in center (2 bars crossed)
    const xMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.85});
    [-1,1].forEach(s=>{
      const bar=new THREE.Mesh(new THREE.PlaneGeometry(5.2,.45),xMat);
      bar.rotation.x=-Math.PI/2;bar.rotation.z=s*Math.PI*.25;
      bar.position.copy(p);bar.position.y=.11;
      scene.add(bar);
    });

    // Inner ring pattern (smaller)
    // Phase 7.4: inner intensity 1.2 → 1.5
    const innerRing=new THREE.Mesh(new THREE.TorusGeometry(2.8,.08,6,36),
      new THREE.MeshLambertMaterial({color:pal.ring,emissive:pal.ring,emissiveIntensity:1.5,transparent:true,opacity:.7}));
    innerRing.rotation.x=Math.PI/2;innerRing.position.copy(p);innerRing.position.y=.12;
    scene.add(innerRing);

    // Pulsing outer ring — main hazard indicator
    // Phase 7.4: outer ring intensity 1.3 → 1.7 — sterke neon-pulse anchor.
    const ring=new THREE.Mesh(new THREE.TorusGeometry(4.6,.14,8,48),
      new THREE.MeshLambertMaterial({color:pal.ring,emissive:pal.ring,emissiveIntensity:1.7}));
    ring.rotation.x=Math.PI/2;ring.position.copy(p);ring.position.y=.12;
    scene.add(ring);

    // Spin-pad corner pillars verwijderd in alle werelden — stonden op
    // radius 5.6u (binnen track-half-width TW=13) en hadden geen collision,
    // waardoor speler er dwars doorheen reed. Pad-marker blijft leesbaar
    // via disc + pulserende ring + chevrons + point-light.

    // Point light for glow
    const pl=new THREE.PointLight(pal.ring,1.4,22);
    pl.position.copy(p);pl.position.y=1.2;scene.add(pl);

    spinPads.push({pos:p.clone(),disc,ring,radius:4.5});
  });
}


function buildBoostPads(){
  // Per-world palette
  const BP={
    space:    {pad:0xcc00ff,emit:0x8800cc,chev:0xffccff,glow:0xff88ff,light:0xff44ff},
    deepsea:  {pad:0x00cc88,emit:0x007744,chev:0xaaffdd,glow:0x00ffaa,light:0x00ffaa},
    candy:    {pad:0xff55aa,emit:0xcc2277,chev:0xffddee,glow:0xff88cc,light:0xff66bb},
    volcano:  {pad:0xff5522,emit:0xdd2200,chev:0xffdd99,glow:0xff8844,light:0xff4422},
    arctic:   {pad:0x66ddff,emit:0x2288cc,chev:0xe8f5ff,glow:0x99ddff,light:0x88ccff},
    sandstorm:{pad:0xff8c42,emit:0xcc4a18,chev:0xffe4a8,glow:0xff9c52,light:0xff8c42},
    // Pier 47 — sodium-amber matching the lamp anchor (#ff8830) in
    // js/worlds/pier47.js. Avoids the BP.space (#cc00ff magenta)
    // fallback which would clash with the warm overcast harbour palette.
    pier47:   {pad:0xff8830,emit:0xa04020,chev:0xffcc88,glow:0xffaa44,light:0xff8830},
    // Guangzhou — neon-magenta boost pad matching lamp pole cyan + kerbEmissive.
    // Avoids the BP.space (#cc00ff magenta) fallback which would clash with the
    // dual magenta/cyan neon palette by being indistinguishable.
    guangzhou:{pad:0xff2080,emit:0xaa1050,chev:0x00e0ff,glow:0xff60a0,light:0xff2080},
  };
  const pal=BP[activeWorld]||BP.space;

  const boostDefs=[
    {t:.04},{t:.22},{t:.43},{t:.48},{t:.53},{t:.71},{t:.80},{t:.93},
  ];
  boostDefs.forEach(def=>{
    const p=trackCurve.getPoint(def.t);
    const tg=trackCurve.getTangent(def.t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const angle=Math.atan2(tg.x,tg.z);

    // Single clean flat pad — Phase 7.3: strip intensity 1.4 → 1.7 voor
    // sterkere bloom-pickup, leest als bright neon strip op afstand.
    const boostStripMat=new THREE.MeshLambertMaterial({color:pal.pad,emissive:pal.emit,emissiveIntensity:1.7,transparent:true,opacity:.92});
    boostStripMat.polygonOffset=true;boostStripMat.polygonOffsetFactor=-3;boostStripMat.polygonOffsetUnits=-3;
    const strip=new THREE.Mesh(new THREE.PlaneGeometry(TW*1.5,4.6),boostStripMat);
    strip.rotation.x=-Math.PI/2;strip.rotation.z=angle;
    strip.position.copy(p);strip.position.y=.04;
    scene.add(strip);

    // Subtle bright center line
    const centre=new THREE.Mesh(new THREE.PlaneGeometry(TW*.25,4.8),
      new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.55}));
    centre.rotation.x=-Math.PI/2;centre.rotation.z=angle;
    centre.position.copy(p);centre.position.y=.06;
    scene.add(centre);

    // 3 bright forward chevrons (V-shape from 2 rotated bars each)
    // Phase 7.3: MeshBasicMaterial → MeshLambertMaterial met emissive
    // zodat de 48 chevrons (3 × 2 bars × 8 pads) bloom pickup'en en
    // gloeien als neon-arrows ipv flat painted markings.
    const chevMat=new THREE.MeshLambertMaterial({color:pal.chev,emissive:pal.chev,emissiveIntensity:1.2,transparent:true,opacity:.95});
    for(let i=0;i<3;i++){
      [-1,1].forEach(s=>{
        const bar=new THREE.Mesh(new THREE.PlaneGeometry(1.55,.22),chevMat);
        bar.rotation.x=-Math.PI/2;bar.rotation.z=angle+s*.52;
        bar.position.copy(p);bar.position.y=.065;
        bar.position.addScaledVector(tg,-1.5+i*1.3);
        scene.add(bar);
      });
    }

    // Side neon light strips (very thin, running along pad)
    const stripMat=new THREE.MeshBasicMaterial({color:pal.glow,transparent:true,opacity:.9});
    [-1,1].forEach(s=>{
      const sl=new THREE.Mesh(new THREE.PlaneGeometry(.18,4.6),stripMat);
      sl.rotation.x=-Math.PI/2;sl.rotation.z=angle;
      sl.position.copy(p);sl.position.y=.07;
      sl.position.addScaledVector(nr,s*TW*.78);
      scene.add(sl);
    });

    // ONE rising energy ring (cleaner than 3) — floats up + fades in a loop
    // Phase 7.3: ring intensity 1.5 → 1.9 — dominant bloom-source boven
    // elke boost-pad.
    const ring=new THREE.Mesh(new THREE.TorusGeometry(TW*.45,.10,6,24),
      new THREE.MeshLambertMaterial({color:pal.glow,emissive:pal.glow,emissiveIntensity:1.9,transparent:true,opacity:.8}));
    ring.position.copy(p);ring.position.y=.6;
    ring.rotation.x=Math.PI/2;ring.rotation.y=angle;
    scene.add(ring);ring._baseY=.6;ring._phase=Math.random();
    const padArrows=[ring];

    // Point light
    const pl=new THREE.PointLight(pal.light,2.0,26);
    pl.position.copy(p);pl.position.y=2.2;scene.add(pl);

    boostPads.push({pos:p.clone(),tg:tg.clone(),strip,arrows:padArrows,radius:TW,len:4.6,active:true,light:pl});
  });
}


function checkJumps(){
  const car=carObjs[playerIdx];if(!car||recoverActive||car.inAir)return;
  const _jFwd=_jFwdV.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
  const motionSign=car.speed>=0?1:-1;
  // forEach → for: ran every frame in RACE.
  for(let _ji=0;_ji<jumpRamps.length;_ji++){
    if(car._rampCooldown>0)break;
    const ramp=jumpRamps[_ji];
    const dx=car.mesh.position.x-ramp.pos.x,dz=car.mesh.position.z-ramp.pos.z;
    const along=dx*ramp.tg.x+dz*ramp.tg.z;
    const perp=Math.abs(-dx*ramp.tg.z+dz*ramp.tg.x);
    const halfLen=ramp.len*.5;
    // Simple trigger zone — no surface-following, no physical ramp to drive up
    if(perp<ramp.width*.5&&along>-halfLen&&along<halfLen){
      const motionDot=(_jFwd.x*ramp.tg.x+_jFwd.z*ramp.tg.z)*motionSign;
      if(motionDot>.1&&Math.abs(car.speed)>.25){
        // LAUNCH: strong vy + slight forward boost + nose tilt up
        car.vy=Math.abs(car.speed)*11+ramp.launchV*1.3+6;
        car.mesh.rotation.x=-0.22;
        car.inAir=true;
        car._rampCooldown=1.2;
        Audio.playJump();
        // Spark-count 28 → 14: halve de per-burst InstancedMesh upload op
        // elke jump cycle (sandstorm GO/jump-freeze fix in #236, hier ook
        // toegepast voor algemene Pier 47 jump-hitch).
        sparkSystem.emit(car.mesh.position.x,car.mesh.position.y+.2,car.mesh.position.z,0,.3,0,14,.9,.6,1,.8);
        // showPopup → next-task (setTimeout 0) zodat DOM-mutatie + CSS-animatie
        // niet op hetzelfde JS-frame als de physics-launch + spark-emit valt.
        // queueMicrotask zou nog in dezelfde task blijven en niets verschuiven.
        const _rampLabel=ramp.label;
        setTimeout(function(){showPopup(_rampLabel,'#00ccff',1000);},0);
      }
    }
  }
  if(car._rampCooldown>0)car._rampCooldown-=1/60; // rough frame decrement
}


function checkSpinPads(dt){
  const car=carObjs[playerIdx];if(!car||recoverActive)return;
  // Visual update onafhankelijk van trigger-state — pulse blijft draaien
  // ook als de speler in de lucht is. Trigger-check is daaronder.
  for(let _si=0;_si<spinPads.length;_si++){
    const pad=spinPads[_si];
    pad.disc.rotation.y+=2.5*dt;
    const _rs=1+.08*Math.sin(_nowSec*3+pad.pos.x*.1);
    pad.ring.scale.setScalar(_rs);
    pad.ring.material.emissiveIntensity=.5+.5*Math.sin(_nowSec*2.5+pad.pos.z*.1);
  }
  // Airborne suppression: spin-pads zijn een grond-hazard. Een auto die
  // er overheen vliegt na een ramp moet niet plotseling rondtollen in de
  // lucht. car.inAir wordt gezet door buildJumpRamps + het space/deepsea
  // fall-pad en gereset bij landing in cars/physics.js.
  if(car.inAir)return;
  for(let _si=0;_si<spinPads.length;_si++){
    const pad=spinPads[_si];
    const dx=car.mesh.position.x-pad.pos.x,dz=car.mesh.position.z-pad.pos.z;
    if(dx*dx+dz*dz<pad.radius*pad.radius&&car.spinTimer<=0){
      car.spinTimer=1.0;
      Audio.playSpin();showPopup('SPINNING! 🌀','#aa44ff',1200);
      sparkSystem.emit(pad.pos.x,.5,pad.pos.z,0,.05,0,20,.6,.2,1,.6);
    }
  }
}


function checkBoostPads(){
  // Pulsing glow on all boost pads
  const pulse=.5+.5*Math.sin(_nowSec*4);
  for(let _bi=0;_bi<boostPads.length;_bi++){
    const pad=boostPads[_bi];
    pad.strip.material.emissiveIntensity=.4+.9*pulse;pad.strip.material.opacity=.58+.24*pulse;
  }
  const car=carObjs[playerIdx];if(!car||recoverActive)return;
  // Airborne suppression — boost-pads zijn ground-hazards (zelfde reden
  // als spin-pads). Auto's die over een pad heen springen na een jump-ramp
  // moeten geen onverwachte boost krijgen.
  if(car.inAir)return;
  for(let _bi=0;_bi<boostPads.length;_bi++){
    const pad=boostPads[_bi];
    const dx=car.mesh.position.x-pad.pos.x,dz=car.mesh.position.z-pad.pos.z;
    const bR=pad.radius*.8,bR2=bR*bR;
    if(dx*dx+dz*dz<bR2&&car.boostTimer<=0){
      car.boostTimer=2.0;car.speed=Math.min(car.def.topSpd*1.55,car.speed+.4);
      totalScore+=10;
      // Phase R2.5 — boost-pad camera punch: brief shake + FOV-kick decay
      // bovenop bestaande boostTimer FOV-boost. _boostPunchTimer wordt
      // in camera.js per-frame gedecayed en add extra FOV.
      if(typeof camShake!=='undefined' && camShake < 0.22) camShake = 0.22;
      window._boostPunchTimer = 0.40;
      Audio.playBoost();showPopup('BOOST! ⚡','#00ffff',800);
      // Phase 7.6 — boost pickup spark: 11 purple + 7 cyan split (was 18
      // cyan). Purple-cyan combo geeft neon-signature ipv pure cyan.
      sparkSystem.emit(car.mesh.position.x,.4,car.mesh.position.z,0,.06,0,11,.7,.25,1,.55);
      sparkSystem.emit(car.mesh.position.x,.4,car.mesh.position.z,0,.06,0, 7,.3,.9,1,.5);
      // Punchy camera shake op activation — 0.35 voor "kick" gevoel zonder
      // disorienterend te zijn (decay rate in updateCamera maakt het kort).
      camShake=Math.max(camShake,0.35);
      if(Math.random()<.55)Audio.playCrowdCheer();
    }
    // Boost AI cars too. Early-continue op al-geboost'e AI scheelt de
    // dx²+dz² compute voor het meest gangbare geval (AI heeft net een pad
    // gepakt op een vorige pad-iteratie).
    for(let i=0;i<carObjs.length;i++){
      if(i===playerIdx)continue;
      if(carObjs[i].boostTimer>0)continue;
      const dx2=carObjs[i].mesh.position.x-pad.pos.x,dz2=carObjs[i].mesh.position.z-pad.pos.z;
      if(dx2*dx2+dz2*dz2<bR2) carObjs[i].boostTimer=2;
    }
  }
}

