// js/cars/brands.js — brand-specific car body builders.
// Non-module script. Loaded AFTER car-parts.js, BEFORE build.js.
//
// Each builder takes a Group and adds body meshes (NOT wheels — wheels are
// added by build.js via buildAllWheels). The Group is empty when passed in.
// Builders use shared materials from getSharedCarMats() and per-instance
// paint via makePaintMats(def).
//
// Brands without an explicit builder fall back to the legacy makeCar()
// path in build.js (so adding builders incrementally is safe).

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// FERRARI SF90 — wedge silhouet, hoge zijspoiler, dubbele uitlaten,
// lage voorbumper met splitter, side-vents in de portieren. Default red.
// ─────────────────────────────────────────────────────────────────────────────
function buildFerrariSF90(g, def, mats, lod){
  const lo = lod === 'low';
  // Art-of-Rally restyle (Interpretatie A) — extruded super-archetype body
  // i.p.v. box-stack. Brand-specifieke details (engine slats, side intakes,
  // hoog-staande spoiler) blijven als overlays. Underglow en premium
  // headlights weggehaald (te modern voor AOR-aesthetic). Drilled discs +
  // accent calipers blijven (passen bij rally race-detail).
  const body = new THREE.Group();
  body.userData = body.userData || {};
  body.userData._isBody = true;
  g.add(body);
  const W = 1.92, L = 4.10, H = 1.05;
  if (lo){
    // Mobile box-stack fallback
    addPart(body, new THREE.BoxGeometry(W, .42, L), mats.paint, 0, .26, 0);
    addPart(body, new THREE.BoxGeometry(W*.85, .35, L*.32), mats.paint, 0, .68, -.05);
    addPart(body, new THREE.BoxGeometry(W*.92, .04, L*.30), mats.paint, 0, .89, -.10);
  } else {
    const bodyMesh = buildExtrudedBody(W, L, H, { mat: mats.paint, profile: 'super' });
    bodyMesh.position.y = 0.05;
    body.add(bodyMesh);
  }
  // Front splitter (matBlk lip)
  addPart(body, new THREE.BoxGeometry(W*0.92, .06, .26), mats.matBlk, 0, .10, -L*0.51);
  // Front grille / lower intake (signature dark inset)
  if (!lo) addPart(body, new THREE.BoxGeometry(.90, .14, .12), mats.grille, 0, H*0.20, -L*0.49);
  // Simple bumper-mounted headlights (rally style — niet meer premium LED)
  buildHeadlights(body, mats, {spread: W*0.40, y: H*0.42, z: -L*0.49, w: .28, h: .10, d: .08});
  // Cabin glass
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.78, 0.42, 0.08), mats.glass, 0, H*0.78, -L*0.06, -0.42);
    addPart(body, new THREE.BoxGeometry(W*0.74, 0.26, 0.08), mats.glassDark, 0, H*0.78, L*0.14, 0.40);
    [-W*0.42, +W*0.42].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(0.06, 0.30, L*0.27), mats.glass, s, H*0.78, L*0.04);
    });
  }
  // Engine cover slats (carbon-look strakes — Ferrari signature)
  if (!lo){
    [-.30, 0, .30].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(.12, .04, 1.00), mats.matBlk, s, H*0.78, L*0.22);
    });
  }
  // Side air intakes — SF90 signature
  if (!lo){
    [-W*0.50, +W*0.50].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(.05, .22, .85), mats.matBlk, s, H*0.55, L*0.08);
      addPart(body, new THREE.BoxGeometry(.04, .10, .70), mats.grille, s, H*0.55, L*0.08);
    });
  }
  // Wheel arches
  buildWheelArches(body, mats.paint, {positions:[
    [-W*0.50, .42, -L*0.34], [W*0.50, .42, -L*0.34], [-W*0.50, .42, L*0.34], [W*0.50, .42, L*0.34]
  ]});
  // Rear bumper / lower diffuser
  addPart(body, new THREE.BoxGeometry(W*0.96, .22, .30), mats.paint, 0, .32, L*0.48);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.86, .10, .28), mats.matBlk, 0, .14, L*0.49);
    [-.50, -.15, .15, .50].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(.04, .14, .26), mats.blk, s, .14, L*0.49);
    });
  }
  // Rear spoiler — high, on visible stands
  [-.65, .65].forEach(s=>{
    addPart(body, new THREE.BoxGeometry(.08, .26, .12), mats.matBlk, s, H*0.85, L*0.43);
  });
  addPart(body, new THREE.BoxGeometry(W*0.86, .06, .36), mats.paint, 0, H*1.00, L*0.43);
  // Tail lights
  buildTaillights(body, mats, {spread: W*0.36, y: H*0.55, z: L*0.49, w: .38, h: .08, d: .05});
  // Dual exhausts — high mounted center pair
  buildExhausts(body, mats, {spread:.32, y:.34, z: L*0.51, radius:.075, length:.30});
  // Twin Le Mans hood-stripes — flush op de hood, vóór de voorruit
  if (!lo){
    [-0.18, 0.18].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(0.08, 0.005, L*0.30), mats.accent, s, H*0.71, -L*0.22);
    });
  }
  buildSideSkirts(body, mats, {spread: W*0.50, y:.10, z:0, length: L*0.65});
  g.userData = g.userData || {};
  g.userData._wheelOpts = { brakeStyle: 'drilled', caliperMatKey: 'accent' };
  // Geen _signature.underglow — AOR-style heeft geen ground glow.
}

// ─────────────────────────────────────────────────────────────────────────────
// BUGATTI CHIRON — wider, rounded silhouet, signature C-shape side accent,
// centre exhaust, modest spoiler, low roofline. Default tweetonig blauw/goud.
// ─────────────────────────────────────────────────────────────────────────────
function buildBugattiChiron(g, def, mats, lod){
  const lo = lod === 'low';
  // Art-of-Rally restyle (Interpretatie A) — extruded super-archetype body.
  // Bugatti signatures (horseshoe grille, two-tone gold accent, C-shape side
  // accent, centre exhaust) blijven als overlays.
  const body = new THREE.Group();
  body.userData = body.userData || {};
  body.userData._isBody = true;
  g.add(body);
  const W = 2.05, L = 4.05, H = 1.10;
  if (lo){
    addPart(body, new THREE.BoxGeometry(W, .44, L), mats.paint, 0, .26, 0);
    addPart(body, new THREE.BoxGeometry(W*.81, .40, L*.37), mats.accent, 0, .76, .00);
    addPart(body, new THREE.BoxGeometry(W*.68, .04, L*.30), mats.accent, 0, .89, -.10);
  } else {
    const bodyMesh = buildExtrudedBody(W, L, H, { mat: mats.paint, profile: 'super' });
    bodyMesh.position.y = 0.05;
    body.add(bodyMesh);
  }
  // Front splitter
  addPart(body, new THREE.BoxGeometry(W*0.90, .06, .26), mats.matBlk, 0, .10, -L*0.51);
  // Horseshoe-style grille (signature Bugatti)
  addPart(body, new THREE.BoxGeometry(.55, .22, .12), mats.grille, 0, H*0.27, -L*0.49);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(.42, .14, .04), mats.accent, 0, H*0.27, -L*0.51); // gold horseshoe rim
  }
  // Simple bumper-mounted headlights
  buildHeadlights(body, mats, {spread: W*0.38, y: H*0.42, z: -L*0.475, w: .34, h: .10, d: .07});
  // Cabin glass
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.75, 0.48, 0.08), mats.glass, 0, H*0.75, -L*0.20, -0.35);
    [-W*0.40, +W*0.40].forEach(s=>addPart(body, new THREE.BoxGeometry(0.06, 0.30, L*0.32), mats.glass, s, H*0.75, 0));
    addPart(body, new THREE.BoxGeometry(W*0.71, 0.30, 0.08), mats.glassDark, 0, H*0.75, L*0.20, 0.38);
  }
  // C-shape side accent — Chiron signature
  if (!lo){
    [-W*0.49, +W*0.49].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(.04, .30, 1.10), mats.matBlk, s, H*0.45, -.05);
      addPart(body, new THREE.BoxGeometry(.05, .12, .12), mats.accent, s, H*0.59, -.55);
      addPart(body, new THREE.BoxGeometry(.05, .12, .12), mats.accent, s, H*0.32, -.55);
    });
  }
  buildWheelArches(body, mats.paint, {positions:[
    [-W*0.50, .42, -L*0.345], [W*0.50, .42, -L*0.345], [-W*0.50, .42, L*0.345], [W*0.50, .42, L*0.345]
  ]});
  // Rear bumper + diffuser
  addPart(body, new THREE.BoxGeometry(W*0.95, .22, .30), mats.paint, 0, .32, L*0.48);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.83, .10, .28), mats.matBlk, 0, .14, L*0.49);
  }
  // Modest fixed-position spoiler
  addPart(body, new THREE.BoxGeometry(W*0.78, .04, .26), mats.matBlk, 0, H*0.87, L*0.44);
  // Tail lights — Bugatti signature: full-width LED bar
  buildTaillights(body, mats, {spread: W*0.24, y: H*0.53, z: L*0.49, w: .46, h: .08, d: .05});
  // Centre single large exhaust (Chiron signature)
  const ex = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, .35, 10), mats.chrome);
  ex.rotation.x = Math.PI/2; ex.position.set(0, .30, L*0.51); body.add(ex);
  if (!lo){
    const exRing = new THREE.Mesh(new THREE.TorusGeometry(.15, .02, 5, 12), mats.chrome);
    exRing.rotation.y = Math.PI/2; exRing.position.set(0, .30, L*0.51); body.add(exRing);
  }
  // Beltline side-trim — versterkt de signature two-tone split
  if (!lo){
    [-W*0.52, W*0.52].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(0.02, 0.03, L*0.70), mats.accent, s, H*0.50, 0);
    });
  }
  buildSideSkirts(body, mats, {spread: W*0.50, y:.10, z:0, length: L*0.65});
  g.userData = g.userData || {};
  g.userData._wheelOpts = { brakeStyle: 'drilled', caliperMatKey: 'accent' };
  // Geen _signature.underglow — AOR-style heeft geen ground glow.
}

// ─────────────────────────────────────────────────────────────────────────────
// LAMBORGHINI HURACÁN — angular wedge, sharp edges, lower flat roof,
// hexagonal accents, big rear diffuser, aggressive intakes.
// ─────────────────────────────────────────────────────────────────────────────
function buildLamborghiniHuracan(g, def, mats, lod){
  const lo = lod === 'low';
  // Art-of-Rally restyle — extruded super-archetype + Lambo overlays.
  const body = new THREE.Group();
  body.userData = body.userData || {};
  body.userData._isBody = true;
  g.add(body);
  const W = 1.96, L = 4.10, H = 1.05;
  if (lo){
    addPart(body, new THREE.BoxGeometry(W, .38, L), mats.paint, 0, .24, 0);
    addPart(body, new THREE.BoxGeometry(W*.82, .34, L*.34), mats.paint, 0, .68, -.05);
  } else {
    const bodyMesh = buildExtrudedBody(W, L, H, { mat: mats.paint, profile: 'super' });
    bodyMesh.position.y = 0.05;
    body.add(bodyMesh);
  }
  // Triangular front splitter
  addPart(body, new THREE.BoxGeometry(W*0.89, .06, .30), mats.matBlk, 0, .08, -L*0.51);
  // Front lower intakes — hex
  if (!lo){
    [-.55, .55].forEach(s=>addPart(body, new THREE.BoxGeometry(.40, .10, .14), mats.grille, s, H*0.17, -L*0.49));
  }
  buildHeadlights(body, mats, {spread: W*0.37, y: H*0.38, z: -L*0.476, w: .28, h: .08, d: .06});
  // Cabin glass
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.76, 0.42, 0.07), mats.glass, 0, H*0.72, -L*0.20, -0.50);
    [-W*0.41, +W*0.41].forEach(s=>addPart(body, new THREE.BoxGeometry(.06, .26, L*0.29), mats.glass, s, H*0.72, -L*0.012));
    addPart(body, new THREE.BoxGeometry(W*0.72, 0.22, 0.07), mats.glassDark, 0, H*0.72, L*0.17, 0.48);
  }
  // Hexagonal engine bay vents (Lambo signature)
  if (!lo){
    [[-.42, L*0.20], [.42, L*0.20], [0, L*0.22]].forEach(p=>{
      addPart(body, new THREE.BoxGeometry(.18, .04, .35), mats.matBlk, p[0], H*0.71, p[1]);
    });
  }
  // Aggressive side intakes — Lambo angular vents
  if (!lo){
    [-W*0.51, +W*0.51].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(.05, .26, .80), mats.matBlk, s, H*0.46, L*0.06);
      addPart(body, new THREE.BoxGeometry(.04, .14, .65), mats.accent, s, H*0.46, L*0.06);
    });
  }
  buildWheelArches(body, mats.paint, {positions:[
    [-W*0.51, .40, -L*0.34], [W*0.51, .40, -L*0.34], [-W*0.51, .40, L*0.34], [W*0.51, .40, L*0.34]
  ]});
  // Rear bumper + AGGRESSIVE diffuser
  addPart(body, new THREE.BoxGeometry(W*0.97, .24, .30), mats.paint, 0, .32, L*0.475);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.89, .14, .32), mats.matBlk, 0, .12, L*0.49);
    [-.65, -.32, 0, .32, .65].forEach(s=>addPart(body, new THREE.BoxGeometry(.04, .18, .30), mats.blk, s, .12, L*0.49));
  }
  buildTaillights(body, mats, {spread: W*0.37, y: H*0.52, z: L*0.49, w: .30, h: .10, d: .05});
  // Quad exhausts (Lambo signature)
  if (!lo){
    [-.55, -.30, .30, .55].forEach(s=>{
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, .25, 8), mats.chrome);
      ex.rotation.x = Math.PI/2; ex.position.set(s, .26, L*0.50); body.add(ex);
    });
  } else {
    buildExhausts(body, mats, {spread:.40, y:.26, z: L*0.50, radius:.06, length:.25});
  }
  // Rear spoiler — sharp wedge
  [-.65, .65].forEach(s=>addPart(body, new THREE.BoxGeometry(.06, .20, .10), mats.matBlk, s, H*0.78, L*0.43));
  addPart(body, new THREE.BoxGeometry(W*0.83, .04, .28), mats.paint, 0, H*0.90, L*0.43);
  // Hexagonal hood-patch — geroteerde platte vorm in accent op de bonnet
  if (!lo){
    addPart(body, new THREE.BoxGeometry(0.35, 0.005, 0.35), mats.accent, 0, H*0.71, -L*0.25, 0, Math.PI/4, 0);
  }
  buildSideSkirts(body, mats, {spread: W*0.50, y:.10, z:0, length: L*0.65});
  g.userData = g.userData || {};
  g.userData._wheelOpts = { brakeStyle: 'drilled', caliperMatKey: 'accent' };
}

// ─────────────────────────────────────────────────────────────────────────────
// MASERATI MC20 — slim, long, tapered fastback, elegant proportions,
// modest spoiler, smooth side surfaces (less aggressive than Lambo/Ferrari).
// ─────────────────────────────────────────────────────────────────────────────
function buildMaseratiMC20(g, def, mats, lod){
  const lo = lod === 'low';
  // Art-of-Rally restyle — extruded super-archetype + Maserati overlays.
  const body = new THREE.Group();
  body.userData = body.userData || {};
  body.userData._isBody = true;
  g.add(body);
  const W = 1.92, L = 4.25, H = 1.05;
  if (lo){
    addPart(body, new THREE.BoxGeometry(W, .40, L), mats.paint, 0, .25, 0);
    addPart(body, new THREE.BoxGeometry(W*.84, .42, L*.30), mats.paint, 0, .76, .25);
  } else {
    const bodyMesh = buildExtrudedBody(W, L, H, { mat: mats.paint, profile: 'super' });
    bodyMesh.position.y = 0.05;
    body.add(bodyMesh);
  }
  addPart(body, new THREE.BoxGeometry(W*0.83, .06, .26), mats.matBlk, 0, .12, -L*0.518);
  // Trident grille (3-slat)
  if (!lo){
    addPart(body, new THREE.BoxGeometry(.70, .14, .10), mats.grille, 0, H*0.25, -L*0.494);
    [-.18, 0, .18].forEach(s=>addPart(body, new THREE.BoxGeometry(.04, .10, .04), mats.accent, s, H*0.25, -L*0.508));
  }
  buildHeadlights(body, mats, {spread: W*0.39, y: H*0.40, z: -L*0.471, w: .28, h: .08, d: .06});
  // Cabin glass
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.77, 0.50, 0.08), mats.glass, 0, H*0.78, -L*0.12, -0.40);
    [-W*0.42, +W*0.42].forEach(s=>addPart(body, new THREE.BoxGeometry(.06, .30, L*0.25), mats.glass, s, H*0.78, L*0.06));
    addPart(body, new THREE.BoxGeometry(W*0.73, 0.42, 0.08), mats.glassDark, 0, H*0.76, L*0.25, 0.55);
  }
  // Door-line accent stripe (Maserati signature, single white)
  if (!lo){
    [-W*0.51, +W*0.51].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(.04, .04, L*0.55), mats.accent, s, H*0.40, 0);
    });
    // Subtle side intake
    [-W*0.50, +W*0.50].forEach(s=>addPart(body, new THREE.BoxGeometry(.05, .14, .60), mats.matBlk, s, H*0.52, L*0.13));
  }
  buildWheelArches(body, mats.paint, {positions:[
    [-W*0.50, .42, -L*0.34], [W*0.50, .42, -L*0.34], [-W*0.50, .42, L*0.34], [W*0.50, .42, L*0.34]
  ]});
  addPart(body, new THREE.BoxGeometry(W*0.96, .22, .28), mats.paint, 0, .32, L*0.482);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.81, .10, .26), mats.matBlk, 0, .14, L*0.494);
  }
  addPart(body, new THREE.BoxGeometry(W*0.78, .04, .22), mats.matBlk, 0, H*0.81, L*0.43);
  buildTaillights(body, mats, {spread: W*0.37, y: H*0.51, z: L*0.49, w: .28, h: .07, d: .05});
  buildExhausts(body, mats, {spread:.65, y:.24, z: L*0.51, radius:.065, length:.30});
  // Front-fender spear — accent-lijn van koplamp naar deur, vult trident-slats aan
  if (!lo){
    [-W*0.52, W*0.52].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(0.02, 0.04, L*0.20), mats.accent, s, H*0.55, -L*0.15);
    });
  }
  buildSideSkirts(body, mats, {spread: W*0.50, y:.10, z:0, length: L*0.65});
  g.userData = g.userData || {};
  g.userData._wheelOpts = { brakeStyle: 'drilled', caliperMatKey: 'accent' };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDI R8 — long wheelbase, understated, signature side-blade R8 inset.
// Default black with red accents.
// ─────────────────────────────────────────────────────────────────────────────
function buildAudiR8(g, def, mats, lod){
  const lo = lod === 'low';
  // Art-of-Rally restyle — extruded super-archetype + Audi side-blade signature.
  const body = new THREE.Group();
  body.userData = body.userData || {};
  body.userData._isBody = true;
  g.add(body);
  const W = 1.96, L = 4.30, H = 1.10;
  if (lo){
    addPart(body, new THREE.BoxGeometry(W, .42, L), mats.paint, 0, .25, 0);
    addPart(body, new THREE.BoxGeometry(W*.85, .42, L*.30), mats.paint, 0, .76, 0);
  } else {
    const bodyMesh = buildExtrudedBody(W, L, H, { mat: mats.paint, profile: 'super' });
    bodyMesh.position.y = 0.05;
    body.add(bodyMesh);
  }
  addPart(body, new THREE.BoxGeometry(W*0.91, .06, .26), mats.matBlk, 0, .10, -L*0.512);
  // Single-frame grille (Audi signature)
  if (!lo){
    addPart(body, new THREE.BoxGeometry(1.20, .20, .10), mats.grille, 0, H*0.24, -L*0.507);
    addPart(body, new THREE.BoxGeometry(1.16, .04, .04), mats.accent, 0, H*0.24, -L*0.521);
  }
  buildHeadlights(body, mats, {spread: W*0.40, y: H*0.38, z: -L*0.460, w: .36, h: .08, d: .06});
  // Cabin glass
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.78, 0.50, 0.08), mats.glass, 0, H*0.74, -L*0.18, -0.42);
    [-W*0.42, +W*0.42].forEach(s=>addPart(body, new THREE.BoxGeometry(.06, .30, L*0.26), mats.glass, s, H*0.74, 0));
    addPart(body, new THREE.BoxGeometry(W*0.72, 0.32, 0.08), mats.glassDark, 0, H*0.74, L*0.19, 0.40);
  }
  // Side blade (R8 SIGNATURE)
  if (!lo){
    [-W*0.51, +W*0.51].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(.04, .55, 1.10), mats.matBlk, s, H*0.50, L*0.04);
      addPart(body, new THREE.BoxGeometry(.05, .45, 1.00), mats.accent, s, H*0.50, L*0.04);
    });
  }
  buildWheelArches(body, mats.paint, {positions:[
    [-W*0.51, .44, -L*0.35], [W*0.51, .44, -L*0.35], [-W*0.51, .44, L*0.35], [W*0.51, .44, L*0.35]
  ]});
  addPart(body, new THREE.BoxGeometry(W*0.95, .24, .30), mats.paint, 0, .32, L*0.465);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.87, .10, .28), mats.matBlk, 0, .14, L*0.479);
  }
  addPart(body, new THREE.BoxGeometry(W*0.83, .04, .22), mats.matBlk, 0, H*0.75, L*0.43);
  buildTaillights(body, mats, {spread: W*0.38, y: H*0.50, z: L*0.474, w: .36, h: .08, d: .05});
  // Dual oval exhausts (Audi signature)
  if (!lo){
    [-.42, .42].forEach(s=>{
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(.075, .075, .30, 10), mats.chrome);
      ex.rotation.x = Math.PI/2; ex.scale.x = 1.4; ex.position.set(s, .26, L*0.484); body.add(ex);
    });
  } else {
    buildExhausts(body, mats, {spread:.42, y:.26, z: L*0.484, radius:.075, length:.28});
  }
  // Signature R8 side blade — accent-paneel achter de deur
  if (!lo){
    [-W*0.52, W*0.52].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(0.02, H*0.30, L*0.32), mats.accent, s, H*0.55, L*0.05);
    });
  }
  buildSideSkirts(body, mats, {spread: W*0.50, y:.10, z:0, length: L*0.65});
  g.userData = g.userData || {};
  g.userData._wheelOpts = { brakeStyle: 'drilled', caliperMatKey: 'accent' };
}

// ─────────────────────────────────────────────────────────────────────────────
// PORSCHE GT3 RS — rounded fastback silhouet, BIG rear wing on tall stands
// (GT3 RS signature), round-ish headlights, prominent splitter.
// Default white with red accents.
// ─────────────────────────────────────────────────────────────────────────────
function buildPorscheGT3RS(g, def, mats, lod){
  const lo = lod === 'low';
  // Art-of-Rally restyle — extruded super-archetype + Porsche signatures
  // (round headlights, BIG rear wing, side-blade).
  const body = new THREE.Group();
  body.userData = body.userData || {};
  body.userData._isBody = true;
  g.add(body);
  const W = 1.92, L = 4.10, H = 1.10;
  if (lo){
    addPart(body, new THREE.BoxGeometry(W, .44, L), mats.paint, 0, .26, 0);
    addPart(body, new THREE.BoxGeometry(W*.86, .40, L*.34), mats.paint, 0, .72, -.10);
  } else {
    const bodyMesh = buildExtrudedBody(W, L, H, { mat: mats.paint, profile: 'super' });
    bodyMesh.position.y = 0.05;
    body.add(bodyMesh);
  }
  // Aggressive front splitter (GT3 RS)
  addPart(body, new THREE.BoxGeometry(W*1.02, .06, .40), mats.matBlk, 0, .08, -L*0.512);
  if (!lo){
    [-.55, .55].forEach(s=>addPart(body, new THREE.BoxGeometry(.30, .14, .14), mats.grille, s, H*0.20, -L*0.507));
  }
  // Round headlights — Porsche signature (cylinder i.p.v. box)
  if (!lo){
    [-.74, .74].forEach(s=>{
      const hl = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .08, 12), mats.head);
      hl.rotation.x = Math.PI/2; hl.position.set(s, H*0.42, -L*0.468); body.add(hl);
    });
  } else {
    buildHeadlights(body, mats, {spread:.74, y: H*0.42, z: -L*0.468, w: .30, h: .16, d: .06});
  }
  // Cabin glass
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.79, 0.48, 0.08), mats.glass, 0, H*0.73, -L*0.19, -0.45);
    [-W*0.43, +W*0.43].forEach(s=>addPart(body, new THREE.BoxGeometry(.06, .30, L*0.29), mats.glass, s, H*0.73, -L*0.024));
    addPart(body, new THREE.BoxGeometry(W*0.76, 0.42, 0.08), mats.glassDark, 0, H*0.73, L*0.21, 0.58);
  }
  // Side blade (smaller than Audi)
  if (!lo){
    [-W*0.51, +W*0.51].forEach(s=>addPart(body, new THREE.BoxGeometry(.05, .14, .60), mats.accent, s, H*0.45, L*0.085));
  }
  buildWheelArches(body, mats.paint, {positions:[
    [-W*0.50, .44, -L*0.34], [W*0.50, .44, -L*0.34], [-W*0.50, .44, L*0.34], [W*0.50, .44, L*0.34]
  ]});
  addPart(body, new THREE.BoxGeometry(W*0.97, .22, .28), mats.paint, 0, .32, L*0.475);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.86, .10, .26), mats.matBlk, 0, .14, L*0.488);
  }
  // BIG REAR WING (GT3 RS signature) — tall stands + wide plate
  [-.70, .70].forEach(s=>addPart(body, new THREE.BoxGeometry(.06, .50, .12), mats.matBlk, s, H*0.95, L*0.40));
  addPart(body, new THREE.BoxGeometry(W*0.96, .06, .42), mats.paint, 0, H*1.20, L*0.40);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.96, .03, .12), mats.matBlk, 0, H*1.16, L*0.378);
    [-.92, .92].forEach(s=>addPart(body, new THREE.BoxGeometry(.04, .12, .42), mats.matBlk, s, H*1.145, L*0.40));
  }
  buildTaillights(body, mats, {spread: W*0.39, y: H*0.51, z: L*0.485, w: .34, h: .08, d: .05});
  buildExhausts(body, mats, {spread:.18, y:.24, z: L*0.495, radius:.075, length:.30});
  // Le Mans deur-roundel — klassieke racing-cirkel op de deur (chrome ring + accent vulling)
  if (!lo){
    [-W*0.52, W*0.52].forEach(s=>{
      addPart(body, new THREE.CylinderGeometry(0.17, 0.17, 0.008, 24), mats.chrome, s, H*0.55, -L*0.05, 0, 0, Math.PI/2);
      addPart(body, new THREE.CylinderGeometry(0.14, 0.14, 0.010, 24), mats.accent, s + Math.sign(s)*0.010, H*0.55, -L*0.05, 0, 0, Math.PI/2);
    });
  }
  buildSideSkirts(body, mats, {spread: W*0.50, y:.10, z:0, length: L*0.65});
  g.userData = g.userData || {};
  g.userData._wheelOpts = { brakeStyle: 'drilled', caliperMatKey: 'accent' };
}

// ─────────────────────────────────────────────────────────────────────────────
// McLAREN P1 — modern hypercar, high mounted active rear wing, aggressive
// front splitter with nose-cut, carbon-look matBlk accents prominent.
// Default orange.
// ─────────────────────────────────────────────────────────────────────────────
function buildMcLarenP1(g, def, mats, lod){
  const lo = lod === 'low';
  // Art-of-Rally restyle — extruded super-archetype + McLaren signatures
  // (nose-cut, hood vents, high side intakes, high rear wing).
  const body = new THREE.Group();
  body.userData = body.userData || {};
  body.userData._isBody = true;
  g.add(body);
  const W = 1.90, L = 4.10, H = 1.05;
  if (lo){
    addPart(body, new THREE.BoxGeometry(W, .40, L), mats.paint, 0, .25, 0);
    addPart(body, new THREE.BoxGeometry(W*.83, .40, L*.29), mats.paint, 0, .70, -.15);
  } else {
    const bodyMesh = buildExtrudedBody(W, L, H, { mat: mats.paint, profile: 'super' });
    bodyMesh.position.y = 0.05;
    body.add(bodyMesh);
  }
  // Nose-cut (P1 signature)
  if (!lo){
    addPart(body, new THREE.BoxGeometry(.40, .18, .30), mats.matBlk, 0, H*0.25, -L*0.498);
  }
  addPart(body, new THREE.BoxGeometry(W*0.97, .06, .35), mats.matBlk, 0, .08, -L*0.512);
  if (!lo){
    [-.50, .50].forEach(s=>addPart(body, new THREE.BoxGeometry(.36, .16, .12), mats.grille, s, H*0.19, -L*0.502));
  }
  buildHeadlights(body, mats, {spread: W*0.37, y: H*0.38, z: -L*0.476, w: .28, h: .10, d: .06});
  // Hood vents (P1 signature)
  if (!lo){
    [-.50, .50].forEach(s=>addPart(body, new THREE.BoxGeometry(.30, .04, .35), mats.matBlk, s, H*0.53, -L*0.22));
  }
  // Cabin glass
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.77, 0.50, 0.08), mats.glass, 0, H*0.76, -L*0.21, -0.45);
    [-W*0.42, +W*0.42].forEach(s=>addPart(body, new THREE.BoxGeometry(.06, .30, L*0.24), mats.glass, s, H*0.76, -L*0.037));
    addPart(body, new THREE.BoxGeometry(W*0.69, 0.35, 0.08), mats.glassDark, 0, H*0.76, L*0.13, 0.50);
  }
  // Engine cover slats (carbon-look — McLaren signature)
  if (!lo){
    [-.45, -.15, .15, .45].forEach(s=>addPart(body, new THREE.BoxGeometry(.08, .04, 1.10), mats.matBlk, s, H*0.69, L*0.23));
  }
  // High side intakes (McLaren signature)
  if (!lo){
    [-W*0.51, +W*0.51].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(.05, .18, .80), mats.matBlk, s, H*0.59, L*0.06);
      addPart(body, new THREE.BoxGeometry(.04, .10, .65), mats.accent, s, H*0.59, L*0.06);
    });
  }
  buildWheelArches(body, mats.paint, {positions:[
    [-W*0.51, .42, -L*0.34], [W*0.51, .42, -L*0.34], [-W*0.51, .42, L*0.34], [W*0.51, .42, L*0.34]
  ]});
  addPart(body, new THREE.BoxGeometry(W*0.97, .22, .30), mats.paint, 0, .32, L*0.475);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.87, .12, .32), mats.matBlk, 0, .12, L*0.488);
    [-.40, 0, .40].forEach(s=>addPart(body, new THREE.BoxGeometry(.04, .16, .28), mats.blk, s, .14, L*0.493));
  }
  // High mounted active rear wing (P1 signature) — taller stands
  [-.62, .62].forEach(s=>addPart(body, new THREE.BoxGeometry(.06, .42, .14), mats.matBlk, s, H*0.95, L*0.42));
  addPart(body, new THREE.BoxGeometry(W*0.94, .06, .38), mats.paint, 0, H*1.18, L*0.42);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.94, .03, .12), mats.matBlk, 0, H*1.14, L*0.395);
  }
  buildTaillights(body, mats, {spread: W*0.37, y: H*0.53, z: L*0.485, w: .32, h: .08, d: .05});
  buildExhausts(body, mats, {spread:.30, y:.30, z: L*0.498, radius:.07, length:.28});
  // Speedmark side-swoosh — diagonale rijzende lijn op de zijflank (signature McLaren)
  if (!lo){
    [-W*0.52, W*0.52].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(0.02, 0.05, L*0.40), mats.accent, s, H*0.55, L*0.05, 0.18, 0, 0);
    });
  }
  buildSideSkirts(body, mats, {spread: W*0.50, y:.10, z:0, length: L*0.65});
  g.userData = g.userData || {};
  g.userData._wheelOpts = { brakeStyle: 'drilled', caliperMatKey: 'accent' };
}

// ─────────────────────────────────────────────────────────────────────────────
// KOENIGSEGG JESKO — Swedish hypercar, very high rear wing, roof scoop,
// aggressive splitter, distinctive low fastback. Default white with blue.
// ─────────────────────────────────────────────────────────────────────────────
function buildKoenigseggJesko(g, def, mats, lod){
  const lo = lod === 'low';
  // Art-of-Rally restyle — extruded super-archetype + Koenigsegg signatures
  // (roof scoop, very high rear wing, quad exhausts).
  const body = new THREE.Group();
  body.userData = body.userData || {};
  body.userData._isBody = true;
  g.add(body);
  const W = 1.90, L = 4.20, H = 1.10;
  if (lo){
    addPart(body, new THREE.BoxGeometry(W, .40, L), mats.paint, 0, .25, 0);
    addPart(body, new THREE.BoxGeometry(W*.85, .42, L*.31), mats.paint, 0, .72, -.10);
  } else {
    const bodyMesh = buildExtrudedBody(W, L, H, { mat: mats.paint, profile: 'super' });
    bodyMesh.position.y = 0.05;
    body.add(bodyMesh);
  }
  addPart(body, new THREE.BoxGeometry(W*1.01, .08, .40), mats.matBlk, 0, .08, -L*0.512);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(.55, .14, .12), mats.grille, 0, H*0.20, -L*0.495);
    [-.30, -.10, .10, .30].forEach(s=>addPart(body, new THREE.BoxGeometry(.08, .06, .04), mats.accent, s, H*0.20, -L*0.510));
  }
  buildHeadlights(body, mats, {spread: W*0.38, y: H*0.38, z: -L*0.471, w: .30, h: .08, d: .06});
  // Cabin glass
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.79, 0.50, 0.08), mats.glass, 0, H*0.73, -L*0.20, -0.45);
    [-W*0.43, +W*0.43].forEach(s=>addPart(body, new THREE.BoxGeometry(.06, .32, L*0.26), mats.glass, s, H*0.73, -L*0.024));
    addPart(body, new THREE.BoxGeometry(W*0.75, 0.42, 0.08), mats.glassDark, 0, H*0.73, L*0.19, 0.55);
  }
  // ROOF SCOOP (Jesko signature)
  if (!lo){
    addPart(body, new THREE.BoxGeometry(.40, .18, .55), mats.matBlk, 0, H*0.96, -L*0.012);
    addPart(body, new THREE.BoxGeometry(.32, .12, .45), mats.accent, 0, H*0.96, -L*0.012);
  }
  // Side intakes
  if (!lo){
    [-W*0.51, +W*0.51].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(.05, .22, .70), mats.matBlk, s, H*0.50, L*0.07);
    });
  }
  buildWheelArches(body, mats.paint, {positions:[
    [-W*0.51, .42, -L*0.345], [W*0.51, .42, -L*0.345], [-W*0.51, .42, L*0.345], [W*0.51, .42, L*0.345]
  ]});
  addPart(body, new THREE.BoxGeometry(W*0.98, .22, .28), mats.paint, 0, .32, L*0.476);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.87, .14, .30), mats.matBlk, 0, .12, L*0.488);
    [-.50, -.20, .20, .50].forEach(s=>addPart(body, new THREE.BoxGeometry(.04, .18, .28), mats.blk, s, .12, L*0.488));
  }
  // VERY HIGH REAR WING (Jesko signature) — tallest stands
  [-.72, .72].forEach(s=>addPart(body, new THREE.BoxGeometry(.06, .60, .14), mats.matBlk, s, H*1.00, L*0.39));
  addPart(body, new THREE.BoxGeometry(W*1.01, .06, .42), mats.paint, 0, H*1.29, L*0.39);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*1.00, .03, .12), mats.matBlk, 0, H*1.25, L*0.369);
    [-.96, .96].forEach(s=>addPart(body, new THREE.BoxGeometry(.04, .14, .42), mats.matBlk, s, H*1.24, L*0.39));
  }
  buildTaillights(body, mats, {spread: W*0.39, y: H*0.50, z: L*0.486, w: .30, h: .08, d: .05});
  // Quad exhausts (Jesko signature)
  if (!lo){
    [-.45, -.18, .18, .45].forEach(s=>{
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(.058, .058, .26, 8), mats.chrome);
      ex.rotation.x = Math.PI/2; ex.position.set(s, .28, L*0.50); body.add(ex);
    });
  } else {
    buildExhausts(body, mats, {spread:.40, y:.28, z: L*0.50, radius:.06, length:.26});
  }
  // Carbon roof-spine + nose ghost-marker — Swedish minimalism
  if (!lo){
    addPart(body, new THREE.BoxGeometry(0.08, 0.006, L*0.35), mats.matBlk, 0, H*0.91, -L*0.05);
    addPart(body, new THREE.BoxGeometry(0.10, 0.008, 0.18), mats.accent, 0, H*0.74, -L*0.42);
  }
  buildSideSkirts(body, mats, {spread: W*0.50, y:.10, z:0, length: L*0.65});
  g.userData = g.userData || {};
  g.userData._wheelOpts = { brakeStyle: 'drilled', caliperMatKey: 'accent' };
}

// ─────────────────────────────────────────────────────────────────────────────
// F1 SHARED — builds the chassis tub, sidepods, halo, cockpit, airbox.
// Wing/nose details differ per team and are added by the brand-specific
// builders that call this helper.
//
// Phase 3 Tier F1 — bouwt nu intern een body-subgroup en retourneert die
// zodat team-builders hun nose + wing-additions ook in `body` kunnen hangen.
// `g` (top-level) houdt alleen wheels via buildAllWheels (zoals de andere
// tiers). F1 cars krijgen GEEN drilled discs of underglow — F1 is een
// aparte esthetiek (matte race car vs glossy road car) en die distinction
// blijft bewust.
// ─────────────────────────────────────────────────────────────────────────────
function _buildF1Common(g, def, mats, lod){
  const lo = lod === 'low';
  const body = new THREE.Group();
  body.userData = body.userData || {};
  body.userData._isBody = true;
  g.add(body);
  // Chassis tub — narrow, long
  addPart(body, new THREE.BoxGeometry(.78, .26, 4.40), mats.paint, 0, .15, 0);
  // Bargeboards / floor extensions
  if(!lo){
    addPart(body, new THREE.BoxGeometry(2.00, .04, 3.40), mats.matBlk, 0, .04, 0);
  }
  // Sidepods
  [-1, 1].forEach(s=>{
    addPart(body, new THREE.BoxGeometry(.50, .30, 1.95), mats.paint, s*.85, .18, .35);
    if(!lo){
      // Sidepod intakes (front)
      addPart(body, new THREE.BoxGeometry(.40, .20, .12), mats.grille, s*.92, .22, -.50);
    }
  });
  // Cockpit opening (raised collar)
  addPart(body, new THREE.BoxGeometry(.66, .26, .80), mats.matBlk, 0, .30, .05);
  // Halo bar — torus arc above cockpit
  if(!lo){
    const halo = new THREE.Mesh(new THREE.TorusGeometry(.30, .035, 6, 16), mats.chrome);
    halo.position.set(0, .58, .05); body.add(halo);
    // Halo front strut
    addPart(body, new THREE.BoxGeometry(.05, .25, .05), mats.chrome, 0, .42, -.18);
  }
  // Engine airbox (above driver, behind cockpit) + roll hoop
  addPart(body, new THREE.BoxGeometry(.45, .35, .50), mats.paint, 0, .50, .55);
  if(!lo){
    addPart(body, new THREE.BoxGeometry(.30, .20, .04), mats.matBlk, 0, .54, .30); // airbox intake mouth
  }
  // Engine cover — crowned slab voor subtiele aerodynamische welving
  addPart(body, _crownedSlabGeo(.50, .24, 1.10), mats.paint, 0, .42, 1.30);
  if(!lo){
    // Camera mount on top
    addPart(body, new THREE.BoxGeometry(.10, .06, .18), mats.matBlk, 0, .56, 1.00);
  }
  return body;
}

// ─────────────────────────────────────────────────────────────────────────────
// RED BULL RB F1 — pointed nose, twin-pillar rear wing, bull motif suggested
// by red accent stripes. Default dark blue with red accents.
// ─────────────────────────────────────────────────────────────────────────────
function buildRedBullRBF1(g, def, mats, lod){
  const lo = lod === 'low';
  const body = _buildF1Common(g, def, mats, lod);
  // Pointed nose — long tapered cone (tip near front wing)
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(.05, .35, 1.80, 10), mats.paint);
  nose.rotation.z = Math.PI/2; nose.rotation.y = Math.PI/2; // align long axis with Z (forward)
  nose.position.set(0, .22, -2.10); body.add(nose);
  // Front wing — wide low plate
  addPart(body, new THREE.BoxGeometry(2.20, .04, .60), mats.paint, 0, .08, -2.55);
  if(!lo){
    addPart(body, new THREE.BoxGeometry(2.20, .02, .12), mats.accent, 0, .12, -2.40); // upper element
    // Endplates
    [-1.10, 1.10].forEach(s=>addPart(body, new THREE.BoxGeometry(.05, .20, .55), mats.matBlk, s, .14, -2.55));
    // Front-wing element strakes
    [-.50, 0, .50].forEach(s=>addPart(body, new THREE.BoxGeometry(.04, .06, .50), mats.matBlk, s, .10, -2.55));
  }
  // Rear wing — twin-pillar, big plate
  [-.20, .20].forEach(s=>addPart(body, new THREE.BoxGeometry(.08, .42, .12), mats.matBlk, s, .56, 2.10));
  addPart(body, new THREE.BoxGeometry(2.10, .04, .42), mats.paint, 0, .80, 2.10);
  if(!lo){
    addPart(body, new THREE.BoxGeometry(2.10, .02, .14), mats.accent, 0, .84, 2.16); // upper flap
    [-1.04, 1.04].forEach(s=>addPart(body, new THREE.BoxGeometry(.04, .26, .45), mats.matBlk, s, .76, 2.10));
  }
  // DRS pod / rain light at rear
  if(!lo){
    addPart(body, new THREE.BoxGeometry(.08, .08, .04), mats.tail, 0, .60, 2.22);
  }
  // Red accent stripe along sidepods (Red Bull livery)
  if(!lo){
    [-1.05, 1.05].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(.04, .06, 1.80), mats.accent, s, .26, .35);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MERCEDES W14 F1 — longer nose, sleeker airbox, Mercedes star suggestion
// via chrome accents. Default teal with chrome accents.
// ─────────────────────────────────────────────────────────────────────────────
function buildMercedesW14F1(g, def, mats, lod){
  const lo = lod === 'low';
  const body = _buildF1Common(g, def, mats, lod);
  // Slimmer, longer nose (Mercedes W14 styling)
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(.06, .30, 2.00, 10), mats.paint);
  nose.rotation.z = Math.PI/2; nose.rotation.y = Math.PI/2;
  nose.position.set(0, .22, -2.20); body.add(nose);
  // Front wing — flatter, more elements
  addPart(body, new THREE.BoxGeometry(2.20, .04, .60), mats.paint, 0, .08, -2.65);
  if(!lo){
    addPart(body, new THREE.BoxGeometry(2.18, .02, .14), mats.chrome, 0, .12, -2.50);
    addPart(body, new THREE.BoxGeometry(2.16, .02, .10), mats.chrome, 0, .16, -2.42);
    [-1.10, 1.10].forEach(s=>addPart(body, new THREE.BoxGeometry(.05, .22, .55), mats.matBlk, s, .15, -2.65));
    [-.45, 0, .45].forEach(s=>addPart(body, new THREE.BoxGeometry(.04, .06, .50), mats.matBlk, s, .10, -2.65));
  }
  // Slimmer rear wing — single tall pillar each side
  [-.16, .16].forEach(s=>addPart(body, new THREE.BoxGeometry(.06, .50, .12), mats.matBlk, s, .60, 2.10));
  addPart(body, new THREE.BoxGeometry(2.00, .04, .38), mats.paint, 0, .88, 2.10);
  if(!lo){
    addPart(body, new THREE.BoxGeometry(2.00, .02, .12), mats.chrome, 0, .92, 2.14);
    [-.99, .99].forEach(s=>addPart(body, new THREE.BoxGeometry(.04, .30, .42), mats.matBlk, s, .82, 2.10));
  }
  // DRS pod
  if(!lo){
    addPart(body, new THREE.BoxGeometry(.08, .08, .04), mats.tail, 0, .68, 2.22);
  }
  // Chrome accent stripe along sidepods (Mercedes silver arrow)
  if(!lo){
    [-1.05, 1.05].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(.04, .04, 1.80), mats.chrome, s, .30, .35);
    });
    // Three-pointed star suggestion on nose (small chrome cross)
    addPart(body, new THREE.BoxGeometry(.16, .04, .04), mats.chrome, 0, .28, -1.55);
    addPart(body, new THREE.BoxGeometry(.04, .04, .16), mats.chrome, 0, .28, -1.55);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORD MUSTANG — American muscle: rectangular front, long hood, short rear,
// hood scoop, square headlights, dual exhausts, beefy stance.
// Default white with blue accent.
// ─────────────────────────────────────────────────────────────────────────────
function buildFordMustang(g, def, mats, lod){
  const lo = lod === 'low';
  // Art-of-Rally restyle — extruded muscle-archetype + Mustang signatures
  // (big rectangular grille, hood scoop, three-bar tail lights, dual stripes).
  const body = new THREE.Group();
  body.userData = body.userData || {};
  body.userData._isBody = true;
  g.add(body);
  const W = 2.06, L = 4.40, H = 1.30;
  if (lo){
    addPart(body, new THREE.BoxGeometry(W, .56, L), mats.paint, 0, .32, 0);
    addPart(body, new THREE.BoxGeometry(W*.90, .50, L*.39), mats.paint, 0, .85, .25);
  } else {
    const bodyMesh = buildExtrudedBody(W, L, H, { mat: mats.paint, profile: 'muscle' });
    bodyMesh.position.y = 0.05;
    body.add(bodyMesh);
  }
  addPart(body, new THREE.BoxGeometry(W*0.97, .08, .26), mats.matBlk, 0, .12, -L*0.523);
  // Big rectangular grille (Mustang signature)
  addPart(body, new THREE.BoxGeometry(1.40, .26, .12), mats.grille, 0, H*0.32, -L*0.500);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(.20, .14, .04), mats.accent, 0, H*0.32, -L*0.514);
    [-.40, 0, .40].forEach(s=>addPart(body, new THREE.BoxGeometry(.36, .03, .04), mats.matBlk, s, H*0.32, -L*0.514));
  }
  // Square headlights (rally-style — keep Mustang's chunky look)
  buildHeadlights(body, mats, {spread: W*0.38, y: H*0.38, z: -L*0.495, w: .32, h: .16, d: .08});
  if (!lo){
    [-.78, .78].forEach(s=>{
      [.40, .50, .60].forEach(y=>addPart(body, new THREE.BoxGeometry(.30, .02, .04), mats.head, s, y, -L*0.504));
    });
    // Hood scoop (centre raised bump — Mustang signature)
    addPart(body, new THREE.BoxGeometry(.55, .14, .80), mats.paint, 0, H*0.62, -L*0.25);
    addPart(body, new THREE.BoxGeometry(.50, .04, .12), mats.matBlk, 0, H*0.66, -L*0.32);
  }
  // Cabin glass
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.83, 0.56, 0.08), mats.glass, 0, H*0.71, -L*0.14, -0.36);
    [-W*0.45, +W*0.45].forEach(s=>addPart(body, new THREE.BoxGeometry(.06, .40, L*0.34), mats.glass, s, H*0.71, L*0.057));
    addPart(body, new THREE.BoxGeometry(W*0.79, 0.50, 0.08), mats.glass, 0, H*0.71, L*0.24, 0.30);
  }
  // Wheel arches (muscle: bigger flares)
  buildWheelArches(body, mats.paint, {positions:[
    [-W*0.51, .50, -L*0.34], [W*0.51, .50, -L*0.34], [-W*0.51, .50, L*0.34], [W*0.51, .50, L*0.34]
  ]});
  addPart(body, new THREE.BoxGeometry(W*0.97, .30, .30), mats.paint, 0, .38, L*0.477);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.90, .10, .28), mats.matBlk, 0, .14, L*0.491);
  }
  // Three-bar tail lights (Mustang signature)
  if (!lo){
    [-.78, .78].forEach(s=>{
      [-.18, 0, .18].forEach(zo=>addPart(body, new THREE.BoxGeometry(.22, .14, .05), mats.tail, s + zo*.0, H*0.38, L*0.491));
    });
  } else {
    buildTaillights(body, mats, {spread:.80, y: H*0.38, z: L*0.491, w: .36, h: .14, d: .05});
  }
  // Wide-stance dual exhausts (muscle signature)
  buildExhausts(body, mats, {spread:.78, y:.22, z: L*0.50, radius:.085, length:.34});
  // ICONIC dual centre racing stripes (Mustang heritage)
  if (!lo){
    [-.20, .20].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(.22, .04, L*0.85), mats.accent, s, H*0.78, 0);
    });
  }
  buildSideSkirts(body, mats, {spread: W*0.51, y:.16, z:0, length: L*0.65});
  g.userData = g.userData || {};
  g.userData._wheelOpts = { brakeStyle: 'drilled', caliperMatKey: 'accent' };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESLA MODEL S — smooth fastback sedan, NO grille (solid front plate),
// glass roof suggestion, flush wheel arches, minimal taillights.
// Default silver.
// ─────────────────────────────────────────────────────────────────────────────
function buildTeslaModelS(g, def, mats, lod){
  const lo = lod === 'low';
  // Art-of-Rally restyle (Interpretatie A) — extruded sedan-archetype body.
  // Tesla-signatures (smooth front zonder grille, panoramic glass roof,
  // flush chrome door-handles, light bar) blijven als overlays. Lichte
  // matte finish via def.paintClearcoat=0.30.
  const body = new THREE.Group();
  body.userData = body.userData || {};
  body.userData._isBody = true;
  g.add(body);
  const W = 2.00, L = 4.40, H = 1.20;
  if (lo){
    // Mobile box-stack fallback
    addPart(body, new THREE.BoxGeometry(W, .46, L), mats.paint, 0, .28, 0);
    addPart(body, new THREE.BoxGeometry(W*.89, .44, L*.41), mats.paint, 0, .76, .15);
    addPart(body, new THREE.BoxGeometry(W*.83, .04, L*.32), mats.glassDark, 0, 1.00, .15);
  } else {
    const bodyMesh = buildExtrudedBody(W, L, H, { mat: mats.paint, profile: 'sedan' });
    bodyMesh.position.y = 0.05;
    body.add(bodyMesh);
  }
  // Smooth front splitter
  addPart(body, new THREE.BoxGeometry(W*0.97, .04, .20), mats.matBlk, 0, .08, -L*0.505);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(1.20, .08, .14), mats.matBlk, 0, H*0.15, -L*0.50);
  }
  // Slim LED-bar headlights (Tesla signature)
  buildHeadlights(body, mats, {spread: W*0.39, y: H*0.37, z: -L*0.477, w: .36, h: .06, d: .06});
  if (!lo){
    [-.78, .78].forEach(s=>addPart(body, new THREE.BoxGeometry(.36, .02, .04), mats.head, s, H*0.42, -L*0.491));
  }
  // Cabin glass — front + side + rear
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.83, 0.50, 0.08), mats.glass, 0, H*0.68, -L*0.18, -0.40);
    [-W*0.45, +W*0.45].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(0.06, 0.36, L*0.36), mats.glass, s, H*0.70, L*0.04);
    });
    // Sloping fastback rear glass
    addPart(body, new THREE.BoxGeometry(W*0.80, 0.42, 0.08), mats.glassDark, 0, H*0.67, L*0.24, 0.50);
    // Glass roof (panoramic)
    addPart(body, new THREE.BoxGeometry(W*0.75, 0.04, L*0.32), mats.glassDark, 0, H*0.835, L*0.04);
  }
  // Wheel arches
  buildWheelArches(body, mats.paint, {positions:[
    [-W*0.51, .42, -L*0.34], [W*0.51, .42, -L*0.34], [-W*0.51, .42, L*0.34], [W*0.51, .42, L*0.34]
  ]});
  // Flush chrome door handles (Tesla signature)
  if (!lo){
    [-W*0.505, +W*0.505].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(.04, .04, .25), mats.chrome, s, H*0.47, -L*0.07);
      addPart(body, new THREE.BoxGeometry(.04, .04, .25), mats.chrome, s, H*0.47,  L*0.11);
    });
  }
  // Smooth rear bumper
  addPart(body, new THREE.BoxGeometry(W*0.97, .22, .28), mats.paint, 0, .34, L*0.477);
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.87, .08, .26), mats.matBlk, 0, .16, L*0.49);
  }
  // Subtle slim tail lights + connecting light bar (modern Tesla signature)
  buildTaillights(body, mats, {spread: W*0.33, y: H*0.43, z: L*0.486, w: .34, h: .06, d: .04});
  if (!lo){
    addPart(body, new THREE.BoxGeometry(1.30, .04, .04), mats.tail, 0, H*0.43, L*0.491);
  }
  // Geen body-stripe — Tesla-stijl is bewust minimalistisch (accent zit op calipers / tail bar).
  // NO exhaust (electric vehicle)
  buildSideSkirts(body, mats, {spread: W*0.50, y:.12, z:0, length: L*0.64});
  // Drilled discs + accent calipers — Tesla EV-rally aesthetic, geen underglow.
  g.userData = g.userData || {};
  g.userData._wheelOpts = { brakeStyle: 'drilled', caliperMatKey: 'accent' };
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP B RALLY — pilot voor procedural-geometry pipeline (Art of Rally stijl).
// Long flat hood, korte greenhouse, hatchback achterkant. Matte finish via
// def.paintClearcoat=0.30. Oversized wheels via def.type='rally' recognitie
// in buildAllWheels. Two-tone livery via def.color2. Yellow rally light pod
// op de voorbumper. Geen player underglow — rally cars zijn modder, niet bling.
// ─────────────────────────────────────────────────────────────────────────────
function buildGroupBRally(g, def, mats, lod){
  const lo = lod === 'low';
  const body = new THREE.Group();
  body.userData = body.userData || {};
  body.userData._isBody = true;
  g.add(body);
  // Body-shell dimensies — iets korter en hoger dan een super (rally stance:
  // gehurkt maar met verhoogde ride-height voor wheel-arch ruimte).
  const W = 1.92, L = 4.10, H = 1.10;
  // ── Body shell ──────────────────────────────────────────────────────
  if (lo){
    // Mobile fallback: box-stack pattern, lijkt op Mustang/Tesla approach.
    addPart(body, new THREE.BoxGeometry(W, .42, L), mats.paint, 0, .26, 0);
    addPart(body, new THREE.BoxGeometry(W*.85, .35, L*.42), mats.paint, 0, .68, .15);
    addPart(body, new THREE.BoxGeometry(W*.92, .04, L*.40), mats.paint, 0, .89, .12);
  } else {
    // Desktop: extruded side-profile body. position.y=.05 zet de body iets
    // boven ground zodat wheels onder de body uitsteken (rally stance).
    const bodyMesh = buildExtrudedBody(W, L, H, { mat: mats.paint });
    bodyMesh.position.y = 0.05;
    body.add(bodyMesh);
  }
  // ── Two-tone center stripe (def.color2) ─────────────────────────────
  if (!lo && def.color2 != null){
    const c2 = (typeof def.color2 === 'string') ? parseInt(def.color2, 16) : def.color2;
    // Lambert (geen PBR) houdt de stripe matte i.p.v. mee te glimmen met
    // clearcoat. Past bij rally-livery die sticker-achtig leest, niet glas.
    const stripeMat = new THREE.MeshLambertMaterial({color: c2});
    // Single brede center stripe over hood + dak + hatchback
    addPart(body, new THREE.BoxGeometry(0.34, 0.025, L * 0.85), stripeMat, 0, H * 0.97, 0);
  }
  // ── Cabin glass (high LOD only) ─────────────────────────────────────
  if (!lo){
    // Windshield — raked back
    addPart(body, new THREE.BoxGeometry(W*0.78, 0.42, 0.08), mats.glass, 0, H*0.78, -L*0.06, -0.45);
    // Rear hatchback glass — steile slope
    addPart(body, new THREE.BoxGeometry(W*0.74, 0.32, 0.08), mats.glassDark, 0, H*0.72, L*0.18, 0.55);
    // Side windows
    [-W*0.42, +W*0.42].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(0.06, 0.30, L*0.28), mats.glass, s, H*0.78, L*0.04);
    });
  }
  // ── Front grille ────────────────────────────────────────────────────
  if (!lo){
    addPart(body, new THREE.BoxGeometry(W*0.55, 0.18, 0.08), mats.grille, 0, H*0.30, -L*0.49);
  }
  // ── Bumper-mounted headlights (klein paar) ──────────────────────────
  buildHeadlights(body, mats, {spread: W*0.40, y: H*0.42, z: -L*0.49, w: .22, h: .08, d: .06});
  // ── Yellow rally light pod (boven bumper) ───────────────────────────
  // Per-instance lens-mat met emissive geel. Niet in _headlightMats[]
  // geregistreerd — rally lights staan altijd aan, geen night-bump nodig.
  const podLensMat = lo
    ? new THREE.MeshLambertMaterial({color:0xffec8a, emissive:0xffd84d, emissiveIntensity:0.4})
    : new THREE.MeshPhysicalMaterial({
        color:0xffec8a, emissive:0xffd84d, emissiveIntensity:0.5,
        metalness:0.1, roughness:0.2,
        clearcoat:0.5, clearcoatRoughness:0.1,
        envMapIntensity:0.3
      });
  if (!lo){
    podLensMat.userData = podLensMat.userData || {};
    podLensMat.userData._carPBR = true;
  }
  const pod = buildRallyLightPod({
    width: W*0.50, lightR: 0.09,
    mat: mats.matBlk, lensMat: podLensMat
  });
  pod.position.set(0, H*0.62, -L*0.50);
  body.add(pod);
  // ── Fender flares (high LOD only) ───────────────────────────────────
  if (!lo){
    const fenderR = 0.50, fenderW = 0.40;
    [[-W*0.50, 0.40, -L*0.36], [+W*0.50, 0.40, -L*0.36],
     [-W*0.50, 0.40, +L*0.36], [+W*0.50, 0.40, +L*0.36]].forEach(([x,y,z])=>{
      const flare = buildLatheFenderArch(fenderR, fenderW, { mat: mats.paint });
      flare.position.set(x, y, z);
      body.add(flare);
    });
  }
  // ── Tail lights ─────────────────────────────────────────────────────
  buildTaillights(body, mats, {spread: W*0.40, y: H*0.50, z: L*0.49, w: .24, h: .06, d: .04});
  // ── Low-profile rear spoiler (rally style, niet aggressief supercar wing) ──
  if (!lo){
    [-0.30, 0.30].forEach(s=>{
      addPart(body, new THREE.BoxGeometry(0.04, 0.12, 0.10), mats.matBlk, s, H*0.85, L*0.46);
    });
    addPart(body, new THREE.BoxGeometry(W*0.55, 0.04, 0.20), mats.matBlk, 0, H*0.95, L*0.46);
  }
  // ── Side exhaust (rally signature: side-exit i.p.v. rear) ───────────
  if (!lo){
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 8), mats.chrome);
    ex.rotation.z = Math.PI/2;
    ex.position.set(W*0.46, 0.18, L*0.42);
    body.add(ex);
  }
  // ── Side skirts ─────────────────────────────────────────────────────
  buildSideSkirts(body, mats, {spread: W*0.50, y: 0.15, z: 0, length: L*0.55});
  // ── Wheel-style: drilled discs + accent (yellow) calipers via _wheelOpts ──
  // build.js → buildAllWheels leest g.userData._wheelOpts. def.type='rally'
  // triggert oversized wheel-stance in buildAllWheels (radius .42, width .30).
  // Géén _signature.underglow — rally cars hebben geen ground glow.
  g.userData = g.userData || {};
  g.userData._wheelOpts = { brakeStyle: 'drilled', caliperMatKey: 'accent' };
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY — maps def.brand to its builder. All 12 brands now have explicit
// builders; the legacy parametric fallback in build.js is dead code and
// removed in this PR.
// ─────────────────────────────────────────────────────────────────────────────
const BRAND_BUILDERS = {
  'FERRARI':     buildFerrariSF90,
  'BUGATTI':     buildBugattiChiron,
  'LAMBORGHINI': buildLamborghiniHuracan,
  'MASERATI':    buildMaseratiMC20,
  'AUDI':        buildAudiR8,
  'PORSCHE':     buildPorscheGT3RS,
  'MCLAREN':     buildMcLarenP1,
  'KOENIGSEGG':  buildKoenigseggJesko,
  'RED BULL':    buildRedBullRBF1,
  'MERCEDES':    buildMercedesW14F1,
  'FORD':        buildFordMustang,
  'TESLA':       buildTeslaModelS,
  'GROUPB':      buildGroupBRally
};

window.BRAND_BUILDERS = BRAND_BUILDERS;
window.buildFerrariSF90 = buildFerrariSF90;
window.buildBugattiChiron = buildBugattiChiron;
window.buildLamborghiniHuracan = buildLamborghiniHuracan;
window.buildMaseratiMC20 = buildMaseratiMC20;
window.buildAudiR8 = buildAudiR8;
window.buildPorscheGT3RS = buildPorscheGT3RS;
window.buildMcLarenP1 = buildMcLarenP1;
window.buildKoenigseggJesko = buildKoenigseggJesko;
window.buildRedBullRBF1 = buildRedBullRBF1;
window.buildMercedesW14F1 = buildMercedesW14F1;
window.buildFordMustang = buildFordMustang;
window.buildTeslaModelS = buildTeslaModelS;
window.buildGroupBRally = buildGroupBRally;
