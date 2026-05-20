// js/worlds/pier47.js — Pier 47 (industrial harbour by night) world builders.
// Non-module script. Sessie history:
//   sessie 1 — bones + skybox + lighting + WORLDS registration
//   sessie 2 — props (lamp poles + containers + warehouse + cranes
//              + ophaalbrug) + wet-asphalt rendering
//   sessie 3 — atmosphere prep: motregen-default + drizzle particle pool
//   CINEMATIC FOUNDATION — Pier 47 upgraded to its cinematic visual
//              language. See docs/CINEMATIC_PATTERN.md and
//              js/effects/cinematic.js for the reusable helper layer.
// Optional wet-physics is sessie 4.
//
// ── Track-waypoints (data/tracks.json#pier47) ────────────────────────────
// 12 waypoints, counter-clockwise loop, bbox 440 × 405, perimeter 1311 units.
// Validation:
//   • closing gap   53.9 (< 80 required)
//   • min separation 53.9 (> 35 required)
//   • max segment   174.1 (< 200 required)
//   • no self-intersections
//
// Sector layout (driving direction = WP1 → WP2 → ... → WP12 → WP1):
//   Sector 1 — Container Run     [WP1 → WP4]   wide kade-strook + chicanes,
//                                              ends with 90° right
//   Sector 2 — The Yard          [WP4 → WP7]   open S-curve through container
//                                              yard
//   Sector 3 — The Warehouse     [WP7 → WP9]   straight stretch (~120 units)
//                                              ending in 90° right at loods
//   Sector 4 — The Bridge        [WP9 → WP11]  short bridge straight + soft
//                                              right curve at the far side
//   Sector 5 — Kade Sweep        [WP11 → WP1]  long sweeping right across
//                                              the kade back to finish line

'use strict';

// Per-world animated state — gereset bij world-switch via core/scene.js
// disposeScene(). Sessie-2 introduces the lamp-emissive list (sodium-orange
// flicker pulses subtly in updatePier47World) and the ophaalbrug ref so
// future polish can animate the bascule. Sessie-3 will park rain-puddle
// shimmer state here.
// (Removed: _p47LampEmissives — sessie-2 lamp flicker registry. Cinematic
//  lamps register themselves with _cinemaState.lightPoles in cinematic.js
//  instead; flicker is driven by updateCinematic().)
let _p47Bridge=null;         // ophaalbrug ref (sessie-2 static)
let _p47DrizzleGeo=null;     // BufferGeometry for motregen particle pool
let _p47Drizzle=null;        // THREE.Points mesh (the drizzle streaks)
let _p47FogPatches=[];       // Phase 10.8 — drifting fog sprite patches
// Phase 13C — bridge animation refs voor "alive" feel
let _p47BridgeCables=[];     // tension cables voor sway animation
let _p47BridgeWarnMat=null;  // shared warn-cube material voor blink pulse
let _p47BridgeWinMat=null;   // booth window emissive material voor warmth pulse
let _p47Crane2=null;         // 2e crane Group ref (Phase 12D) voor sway
let _p47Frame=0;             // per-frame counter for mobile drizzle/fog staggering
// Module-scope scratch for cable-sway update — previously allocated each
// frame inside updatePier47World, causing 8-12 Three.js allocs/frame and
// measurable GC pressure on long Pier47 races. Pattern matches the
// pre-allocated scratch vectors used by particles.js / camera.js / ai.js.
const _p47TiltQ = new THREE.Quaternion();
const _p47TiltAxis = new THREE.Vector3(0, 0, 1);

// Single source of truth for Pier 47 day lighting. Mirrors the sandstorm /
// candy / volcano helper pattern. buildPier47Environment + night.js's
// pier47-day branch share the same constants, so the build-time setup and
// the night→day toggle-restore can never drift.
//
// "Day" for Pier 47 is intentionally NOT a sunny morning — it's a bewolkte,
// dreigende nacht. Sessie 3 will introduce a separate "ochtend"-mode for
// the day-toggle.
//
// Goal palette (overcast night with subtle sodium-lamp warmth lifting the
// hemisphere ground colour — sessie-2 tweak):
//   sun     #d8d0c0 / 1.4 desktop / 0.9 mobile / position (60, 110, 80)
//   ambient #1a1a22 / 0.30
//   hemi sky #a0a8b0 / ground #4a3828 (warmer — sodium spillover) / 0.5
//
// Mobile sun caps at 0.9 (vs 1.4 desktop) because shadows are off on mobile;
// Lambert ground at full intensity would clip to white under no-shadow lighting.
function _applyPier47DayLighting(){
  if(!sunLight||!ambientLight||!hemiLight)return;
  // Cinematic foundation: ambient global lighting pulled WAY down so the
  // praktische lichtbronnen (sodium poles, koplampen, blinkende markers)
  // doen het narrative werk. "Pools of light, not floods." This is the
  // single biggest tonal shift between sessie-2 and the cinematic upgrade.
  sunLight.color.setHex(0x9aa6b8);                          // koel blauw-grijs ipv warm wit
  sunLight.intensity = window._isMobile ? 0.30 : 0.40;       // was 0.9 / 1.4
  sunLight.position.set(60, 110, 80);
  ambientLight.color.setHex(0x14141c); ambientLight.intensity = 0.15; // was 0.30
  hemiLight.color.setHex(0x6a7080);                          // was #a0a8b0
  hemiLight.groundColor.setHex(0x2a2028);                    // donkerder grond-bounce
  hemiLight.intensity = 0.20;                                // was 0.5
  // PBR-upgrade Brok 1b: per-wereld ambient/hemi-mul knop. Default 1.0.
  const _v=(typeof window.getWorldVisuals==='function')?window.getWorldVisuals(activeWorld):null;
  if(_v){ ambientLight.intensity*=_v.ambientMul; hemiLight.intensity*=_v.hemiMul; }
}
// Expose to non-module consumers — night.js reads from window.* scope.
if(typeof window!=='undefined')window._applyPier47DayLighting=_applyPier47DayLighting;

// ── Skybox builders (canvas-baked) ────────────────────────────────────────
//
// Pier 47 day skybox: deep aubergine zenith bleeding through warmer purples
// to a horizon city-glow band, with a subtle sodium-orange strip low on
// the horizon (suggesting distant industrial harbour-lights). No stars —
// the night-sky is veiled by city light pollution. A subtle dark-grey cloud
// band sits across the lower horizon to reinforce the bewolkte-nacht feel.
//
// Painted directly onto the shared 1024×512 canvas (via _newSkyCanvas).
// Mobile auto-halves to 512×256 in _newSkyCanvas.
function makePier47SkyTex(){
  // Two-stop linear bg = zenith aubergine → mid purple. We paint horizon
  // bands on top to get the 4-stop gradient + glow strip without altering
  // _newSkyCanvas. Pattern matches sandstorm.
  const {c,g}=_newSkyCanvas('#1a1228','#2a1a3a');
  // Horizon band — city-glow purple-grey (#3a2a40) sliding into the sodium
  // strip. Spans rows ~280-400.
  const horiz=g.createLinearGradient(0,280,0,400);
  horiz.addColorStop(0,'rgba(42,26,58,0)');
  horiz.addColorStop(.5,'rgba(58,42,64,0.65)');
  horiz.addColorStop(1,'rgba(74,40,32,0.85)');
  g.fillStyle=horiz;g.fillRect(0,280,1024,120);
  // Sodium-orange foot-band (subtle, low) — picks up the fog tone so the
  // seam between fogged distant geometry and skybox is invisible.
  const foot=g.createLinearGradient(0,400,0,512);
  foot.addColorStop(0,'rgba(74,40,32,0.85)');
  foot.addColorStop(1,'rgba(42,37,48,1)');
  g.fillStyle=foot;g.fillRect(0,400,1024,112);
  // Subtle dark-grey cloud band laag op de horizon (rows ~310-385).
  // Soft blob clusters via radial gradients with low alpha — reads as
  // "bewolkte nacht" without competing with foreground content.
  for(let i=0;i<14;i++){
    const x=Math.random()*1024,y=320+Math.random()*60;
    const r=70+Math.random()*110;
    const grd=g.createRadialGradient(x,y,0,x,y,r);
    grd.addColorStop(0,'rgba(28,24,38,0.45)');
    grd.addColorStop(.6,'rgba(28,24,38,0.18)');
    grd.addColorStop(1,'rgba(28,24,38,0)');
    g.fillStyle=grd;g.fillRect(x-r,y-r,r*2,r*2);
  }
  // Faint city-glow hotspot lower-right (suggests harbour skyline beyond the
  // horizon). Warm orange tint matches the foot-band sodium strip.
  const glow=g.createRadialGradient(720,420,0,720,420,260);
  glow.addColorStop(0,'rgba(110,60,40,0.45)');
  glow.addColorStop(.5,'rgba(70,40,30,0.20)');
  glow.addColorStop(1,'rgba(70,40,30,0)');
  g.fillStyle=glow;g.fillRect(460,200,520,312);
  return _skyTexFromCanvas(c);
}

// Pier 47 NIGHT skybox: even darker variant of the day skybox. Same overall
// composition (no stars, city-glow at horizon) but ambient deepens and the
// cloud cover thickens. Sessie 2 will introduce sodium-lamp light from
// foreground lamp-poles; sessie 3 will introduce particles + rain. For now
// the night toggle is a small visual delta.
function makePier47NightSkyTex(){
  const {c,g}=_newSkyCanvas('#100818','#1a1028');
  const horiz=g.createLinearGradient(0,280,0,400);
  horiz.addColorStop(0,'rgba(26,16,40,0)');
  horiz.addColorStop(.5,'rgba(36,22,48,0.7)');
  horiz.addColorStop(1,'rgba(58,30,24,0.9)');
  g.fillStyle=horiz;g.fillRect(0,280,1024,120);
  const foot=g.createLinearGradient(0,400,0,512);
  foot.addColorStop(0,'rgba(58,30,24,0.9)');
  foot.addColorStop(1,'rgba(28,24,32,1)');
  g.fillStyle=foot;g.fillRect(0,400,1024,112);
  // Thicker cloud cover for night
  for(let i=0;i<18;i++){
    const x=Math.random()*1024,y=300+Math.random()*80;
    const r=80+Math.random()*130;
    const grd=g.createRadialGradient(x,y,0,x,y,r);
    grd.addColorStop(0,'rgba(18,14,26,0.55)');
    grd.addColorStop(.6,'rgba(18,14,26,0.22)');
    grd.addColorStop(1,'rgba(18,14,26,0)');
    g.fillStyle=grd;g.fillRect(x-r,y-r,r*2,r*2);
  }
  // Slightly stronger city-glow hotspot at night (industrial lights cut through
  // the cloud cover more readily than ambient daylight).
  const glow=g.createRadialGradient(720,420,0,720,420,280);
  glow.addColorStop(0,'rgba(120,68,42,0.55)');
  glow.addColorStop(.5,'rgba(80,46,32,0.25)');
  glow.addColorStop(1,'rgba(80,46,32,0)');
  g.fillStyle=glow;g.fillRect(440,180,540,332);
  return _skyTexFromCanvas(c);
}

// ── Procedural ground texture (subtle concrete grain) ────────────────────
//
// The harbour kade is dark concrete — uniform tone with subtle grain so
// the ground plane never reads as a flat-color quad. Mirrors the
// _sandGroundTex / _iceGroundTex pattern used by sandstorm/arctic.
function _pier47GroundTex(){
  const S=256,c=document.createElement('canvas');c.width=S;c.height=S;
  const g=c.getContext('2d');
  // Base dark-concrete grey
  g.fillStyle='#2a2a30';g.fillRect(0,0,S,S);
  // Per-pixel grain — ImageData range matches the surface tone (38..52)
  const id=g.getImageData(0,0,S,S),d=id.data;
  for(let i=0;i<d.length;i+=4){
    const n=38+(Math.random()*14)|0;
    d[i]=n;d[i+1]=n;d[i+2]=n+2;d[i+3]=255;
  }
  g.putImageData(id,0,0);
  // A few darker oil/wear blobs
  for(let i=0;i<14;i++){
    const x=Math.random()*S,y=Math.random()*S,r=5+Math.random()*11;
    const grd=g.createRadialGradient(x,y,0,x,y,r);
    grd.addColorStop(0,'rgba(15,15,18,0.55)');
    grd.addColorStop(1,'rgba(15,15,18,0)');
    g.fillStyle=grd;g.fillRect(x-r,y-r,r*2,r*2);
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(40,40);
  t.anisotropy=4;t.needsUpdate=true;
  return t;
}

// (Removed: _p47BuildLampPoles — sessie-2 minimal lamp pole implementation.
//  Replaced by _p47BuildCinematicLamps() which composes the shared
//  cinematic.js helpers. The previous InstancedMesh-based version was
//  removed wholesale; the cinematic version emits per-pole groups for
//  variation flexibility (broken/tilted/working) at the cost of slightly
//  higher draw-call count. Mobile-degradation lives inside the helper
//  rather than this caller.)

// ── Containers (Container Run sector 1 + Yard sector 2) ──────────────────
//
// ISO shipping containers stacked along the kade. The Container Run section
// (t in [0..0.25]) gets neat single-stack rows that bracket the track for
// the "smal tussen containers" feel; The Yard (t in [0.25..0.5]) gets
// mixed-orientation 1-3 high stacks for chaotic open-yard read.
//
// All containers share a single 12 × 2.6 × 2.4u BoxGeometry rendered via
// InstancedMesh. instanceColor (per-instance r/g/b) gives variety from a
// realistic palette (rust-orange, faded blue, weathered green, dark red,
// industrial grey) without 5 separate materials. One draw call total.
//
// Mobile halves the count and skips the yard's 3-high tier.
//
// Procedural texture on the container body adds vertical corrugation hint
// + faded paint streaks. Shared across all instances.
function _p47ContainerTex(){
  const W=128,H=128,c=document.createElement('canvas');
  c.width=W;c.height=H;
  const g=c.getContext('2d');
  // Base white (multiplied with instanceColor → keeps per-instance tint)
  g.fillStyle='#ffffff';g.fillRect(0,0,W,H);
  // Vertical corrugation lines (every 4px) — thin grey
  g.strokeStyle='rgba(40,40,40,0.35)';g.lineWidth=1;
  for(let x=0;x<W;x+=4){g.beginPath();g.moveTo(x,0);g.lineTo(x,H);g.stroke();}
  // Horizontal frame bands top + bottom
  g.fillStyle='rgba(30,30,30,0.55)';
  g.fillRect(0,0,W,5);g.fillRect(0,H-5,W,5);
  // A few rust streaks running vertically
  for(let i=0;i<6;i++){
    const x=Math.random()*W,h=20+Math.random()*60;
    const y=Math.random()*(H-h);
    const grd=g.createLinearGradient(x,y,x+3,y);
    grd.addColorStop(0,'rgba(70,30,15,0)');
    grd.addColorStop(.5,'rgba(70,30,15,0.55)');
    grd.addColorStop(1,'rgba(70,30,15,0)');
    g.fillStyle=grd;g.fillRect(x-1,y,3,h);
  }
  // Faded paint scuffs
  for(let i=0;i<8;i++){
    const x=Math.random()*W,y=Math.random()*H,r=4+Math.random()*8;
    const grd=g.createRadialGradient(x,y,0,x,y,r);
    grd.addColorStop(0,'rgba(255,255,255,0.18)');
    grd.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle=grd;g.fillRect(x-r,y-r,r*2,r*2);
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.anisotropy=4;t.needsUpdate=true;
  return t;
}

// Realistic shipping-container palette — 7 weathered tones picked to read
// against the dark-concrete + sodium-lamp scene.
const _P47_CONTAINER_COLORS=[
  [0.62,0.28,0.16],   // rust-orange
  [0.18,0.32,0.50],   // faded blue
  [0.22,0.42,0.30],   // weathered green
  [0.45,0.18,0.20],   // dark red
  [0.42,0.42,0.40],   // industrial grey
  [0.55,0.45,0.20],   // dirty mustard
  [0.30,0.30,0.36]    // dark slate
];

// ── Cinematic lamp-pole array along the kade ─────────────────────────────
//
// Replaces the sessie-2 _p47BuildLampPoles() with calls into the shared
// cinematic.js helpers (buildCinematicLightPole). Each pole gets a
// volumetric cone, ground pool, halo billboard, and per-mat flicker —
// the "praktische lichtbronnen zijn heroes" pillar.
//
// Variation rules:
//   • Total: 22 desktop / 14 mobile pole-pairs along the track curve
//   • ~12% of lamps are "uit" (working:false) — paal staat er, geen licht
//   • ~12% are subtly tilted (~3-5°) — leaning/oude palen
//   • Even-side lamps face inward toward the track (facingY = ang + π/2)
//   • Odd-side lamps face the opposite direction (facingY = ang - π/2)
//
// Pier 47 palette pin: amber (#ff8830) — same hex as the sodium-lamp
// emissive on containers/warehouse. Future cinematic worlds pass their
// own color via the buildCinematicLightPole opts.
function _p47BuildCinematicLamps(){
  if (typeof buildCinematicLightPole !== 'function') return;
  const mob = window._isMobile;
  // Verder verlaagd op mobile: 22 -> 14 was nog steeds 14×2 zijdes = 28 lampen
  // met volumetric cone + ground pool + halo per lamp. 10 lampen mobile is
  // genoeg om de sodium-pier sfeer te houden zonder de lamp-update budget op
  // te eten.
  const COUNT = mob ? 10 : 22;
  const TILT_FRAC = 0.12;     // ~12% of lamps subtly tilted
  const BROKEN_FRAC = 0.12;   // ~12% of lamps "uit"
  // Stable pseudo-random pattern for variety: deterministic by index so
  // the same lamps stay broken / tilted across builds (no surprise drift
  // when the user retoggles night).
  const rng = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < COUNT; i++){
    const t = i / COUNT;
    const p = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    const nr = new THREE.Vector3(-tg.z, 0, tg.x);
    const ang = Math.atan2(tg.x, tg.z);
    [-1, 1].forEach((side, sIdx) => {
      const seed = i * 2 + sIdx;
      const off = BARRIER_OFF + 2.4;
      const px = p.x + nr.x * side * off;
      const pz = p.z + nr.z * side * off;
      const isTilted = rng(seed) < TILT_FRAC;
      const isBroken = rng(seed + 0.5) < BROKEN_FRAC;
      // facingY: arm reaches inward toward the track. Side -1 vs +1
      // mirrors the arm direction. Pole-internal +X axis = arm direction.
      const facingY = (side === 1) ? ang + Math.PI / 2 : ang - Math.PI / 2;
      buildCinematicLightPole(scene, new THREE.Vector3(px, 0, pz), {
        color: 0xff8830,
        intensity: 1.5,
        range: 26,
        height: 8.2,
        armLength: 1.4,
        poolRadius: 11,
        working: !isBroken,
        tilt: isTilted ? ((rng(seed + 0.7) - 0.5) * 0.10) : 0,  // ±~3°
        facingY: facingY,
        castGroundPool: true,
        castVolumetricCone: true,
        castHalo: true
      });
    });
  }
}

// ── Distant cinematic markers (crane-tops + radio towers) ───────────────
//
// Tiny far-away warning lights that read as silhouettes-with-life on the
// horizon. Each is built via the shared cinematic.js helper and registers
// itself with _cinemaState.blinkingMarkers — patterns drive brightness
// modulation in updateCinematic() per frame.
//
// Pier 47 marker placement (positions deliberately FAR from track centre
// so they read as harbour-distance silhouettes, not foreground props):
//   • 3 red slow-pulse warning lights on tall structures
//   • 1 white fast-pulse on a lower structure (variation)
//   • 1 amber morse-style on the warehouse roof corner
//
// The PointLight on each marker is heavy at scale, so distant ones use
// includeLight:false (halo-only) — Three.js forward-renderer light budget
// stays clean.
function _p47BuildDistantMarkers(){
  if (typeof buildCinematicBlinkingMarker !== 'function') return;
  // Red slow-pulse aviation-style warning lights, far from track centre
  // at heights matching the world's silhouette-skyline cylinder layer.
  // Halo-only (includeLight:false) — these are 200u+ from player so
  // PointLight contribution is negligible anyway, but the halo billboard
  // reads beautifully through fog.
  const reds = [
    new THREE.Vector3( 280,  72,  220),
    new THREE.Vector3(-310,  84,  180),
    new THREE.Vector3( 220,  78, -260),
  ];
  reds.forEach((pos, i) => {
    buildCinematicBlinkingMarker(scene, pos, {
      color: 0xff3030,
      pattern: 'slow-pulse',
      blinkInterval: 2.0 + i * 0.3,    // slight de-sync
      intensity: 1.4,
      range: 60,
      haloSize: 4.2,
      includeLight: false
    });
  });
  // White fast-pulse on a lower structure — variation for visual rhythm
  buildCinematicBlinkingMarker(scene, new THREE.Vector3(-180, 42, -240), {
    color: 0xffffff,
    pattern: 'fast-pulse',
    blinkInterval: 0.5,
    intensity: 0.9,
    range: 50,
    haloSize: 2.6,
    includeLight: false
  });
  // Amber morse on the warehouse roof corner — close-ish so it gets a
  // PointLight too, but low intensity (the lamp poles are the heroes).
  // Position pulled from _p47BuildWarehouse anchor (WP9-area, t≈0.665).
  const wp = trackCurve.getPoint(0.665);
  const wpTg = trackCurve.getTangent(0.665).normalize();
  const wpNr = new THREE.Vector3(-wpTg.z, 0, wpTg.x);
  const warehouseTopX = wp.x + wpNr.x * (BARRIER_OFF + 18) + 14;
  const warehouseTopZ = wp.z + wpNr.z * (BARRIER_OFF + 18);
  buildCinematicBlinkingMarker(scene,
    new THREE.Vector3(warehouseTopX, 9.2, warehouseTopZ), {
      color: 0xffaa44,
      pattern: 'morse',
      blinkInterval: 4.5,
      intensity: 0.6,
      range: 24,
      haloSize: 1.6,
      includeLight: true
    });
}

// ── City-glow halo on the horizon ────────────────────────────────────────
//
// Een gerichte oranje-roze glow op één positie aan de horizon, suggereert
// dat dáár de stad ligt. Niet een hele horizon, één gerichte band van
// ~30-40° breed. Statisch, geen animatie. Implementatie: sprite met
// radial gradient texture, ver weg, hoog genoeg om door de fog te
// piercen.
function _p47BuildCityGlow(){
  // Procedural soft glow texture
  const S = 256, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  // Off-axis radial: glow center sits in lower 1/3 (horizon-level), tapers
  // upward to nothing
  const cx = S * 0.5, cy = S * 0.72, r = S * 0.55;
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  grd.addColorStop(0,    'rgba(255,150,90,0.85)');   // oranje-roze hot center
  grd.addColorStop(0.25, 'rgba(255,110,80,0.45)');
  grd.addColorStop(0.55, 'rgba(180,80,90,0.18)');
  grd.addColorStop(1.0,  'rgba(140,60,80,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  // Sprite — large, far away, slightly below horizon-line so the upper
  // half spills above the city silhouette. Position is chosen to sit
  // OUTSIDE the track loop on a specific bearing (the "stad daar verderop"
  // suggestion) — picked to be visible from the kade-sweep sector 5.
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false   // glow shouldn't fade — it's a horizon hint
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(420, 280, 1);   // wide, lower aspect — band-like
  sp.position.set(440, 70, 380);
  sp.renderOrder = -8;          // before transparent props
  scene.add(sp);
}

function _p47BuildContainers(){
  const mob=window._isMobile;
  // Container Run: tight single-stack rows along t in [0.0, 0.25]
  const RUN_COUNT=mob?14:24;
  // The Yard: scattered mixed-stack clusters along t in [0.25, 0.5].
  // Mobile further reduced (6 -> 4 clusters, 3 -> 2 per cluster) — InstancedMesh
  // helpt aan draw-call kant, maar vertex-load + per-stack collision-tests
  // schalen lineair met TOTAL.
  const YARD_CLUSTERS=mob?4:10;
  const YARD_PER_CLUSTER=mob?2:5;
  const TOTAL=RUN_COUNT+YARD_CLUSTERS*YARD_PER_CLUSTER*(mob?1:1.6)|0;
  // Shared geo + mat — one InstancedMesh for all containers.
  const tex=_p47ContainerTex();
  const cGeo=new THREE.BoxGeometry(12,2.6,2.4);
  const cMat=new THREE.MeshLambertMaterial({color:0xffffff,map:tex});
  const im=new THREE.InstancedMesh(cGeo,cMat,TOTAL);
  // Allocate per-instance colour buffer.
  im.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(TOTAL*3),3);
  const dummy=new THREE.Object3D();
  let idx=0;
  // ── Container Run rows (sector 1) ──────────────────────────────────────
  for(let i=0;i<RUN_COUNT;i++){
    const t=0.005+(i/RUN_COUNT)*0.235;  // span t [0.005..0.24]
    const p=trackCurve.getPoint(t);
    const tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const ang=Math.atan2(tg.x,tg.z);
    [-1,1].forEach(side=>{
      // Skip the inner side every other position so the run reads as
      // alternating gaps — gives a less-wall-like feel + lets headlights
      // sweep through.
      if(side<0 && i%2===0)return;
      if(idx>=TOTAL)return;
      const off=BARRIER_OFF+3.5+Math.random()*1.5;
      const cx=p.x+nr.x*side*off;
      const cz=p.z+nr.z*side*off;
      // Single layer in the run — neat row, no stacking
      dummy.position.set(cx,1.3,cz);
      dummy.rotation.set(0,ang,0);
      const sc=0.95+Math.random()*0.15;
      dummy.scale.set(sc,1,1);
      dummy.updateMatrix();
      im.setMatrixAt(idx,dummy.matrix);
      const col=_P47_CONTAINER_COLORS[(Math.random()*_P47_CONTAINER_COLORS.length)|0];
      im.instanceColor.setXYZ(idx,col[0],col[1],col[2]);
      idx++;
    });
  }
  // ── The Yard clusters (sector 2) — mixed orientation, 1-3 high ────────
  for(let cI=0;cI<YARD_CLUSTERS;cI++){
    const t=0.26+(cI/YARD_CLUSTERS)*0.24;  // span t [0.26..0.50]
    const p=trackCurve.getPoint(t);
    const tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const side=(cI%2===0)?1:-1;
    const clusterOff=BARRIER_OFF+8+Math.random()*5;
    const cBaseX=p.x+nr.x*side*clusterOff;
    const cBaseZ=p.z+nr.z*side*clusterOff;
    // Cluster orientation: 70% aligned-to-track, 30% rotated 90°
    const clusterAng=Math.random()<0.7?Math.atan2(tg.x,tg.z):Math.atan2(tg.x,tg.z)+Math.PI/2;
    for(let k=0;k<YARD_PER_CLUSTER;k++){
      if(idx>=TOTAL)return;
      // Stack height — 1, 2, or 3 high (mobile capped at 2)
      const stack=mob? (Math.random()<0.6?1:2) : (Math.random()<0.4?1:Math.random()<0.7?2:3);
      // Each cluster member is a small 2D-grid cell within ~6×6 around base
      const localX=(Math.random()-0.5)*6;
      const localZ=(Math.random()-0.5)*6;
      // Rotate offset by cluster angle
      const cosA=Math.cos(clusterAng),sinA=Math.sin(clusterAng);
      const cx=cBaseX+localX*cosA-localZ*sinA;
      const cz=cBaseZ+localX*sinA+localZ*cosA;
      for(let s=0;s<stack;s++){
        if(idx>=TOTAL)return;
        dummy.position.set(cx,1.3+s*2.65,cz);
        // Each member's own minor angle jitter
        dummy.rotation.set(0,clusterAng+(Math.random()-0.5)*0.15,0);
        dummy.scale.set(1,1,1);
        dummy.updateMatrix();
        im.setMatrixAt(idx,dummy.matrix);
        const col=_P47_CONTAINER_COLORS[(Math.random()*_P47_CONTAINER_COLORS.length)|0];
        im.instanceColor.setXYZ(idx,col[0],col[1],col[2]);
        idx++;
      }
    }
  }
  // Final count — pack the IM so disposeScene's traversal doesn't render
  // empty trailing instances. Three.js InstancedMesh.count caps the draw.
  im.count=idx;
  im.instanceMatrix.needsUpdate=true;
  if(im.instanceColor)im.instanceColor.needsUpdate=true;
  scene.add(im);
}

// ── Warehouse (loods) at WP9 90° right ───────────────────────────────────
//
// Large industrial warehouse silhouetted at the end of the warehouse
// straight (sector 3 → sector 4 transition). Single-mesh corrugated-metal
// box with a slight roof pitch. Positioned just outside the BARRIER_OFF
// at the inside of the 90° right turn so it dominates the player's
// approach view through sector 3.
//
// Geometry: simple BoxGeometry with the corrugation texture from
// _p47ContainerTex (re-used — same vertical-line corrugation works
// for warehouse cladding). Roof = thin Box on top with darker tint.
function _p47BuildWarehouse(){
  // Place at WP9 (t = 8/12 ≈ 0.667) — the 90° right corner. Anchor
  // the warehouse on the INSIDE of the corner (right side of travel
  // direction = nr * +1).
  const t=0.665;
  const p=trackCurve.getPoint(t);
  const tg=trackCurve.getTangent(t).normalize();
  const nr=new THREE.Vector3(-tg.z,0,tg.x);
  const side=1; // inside of the 90° right
  const off=BARRIER_OFF+18;
  const cx=p.x+nr.x*side*off;
  const cz=p.z+nr.z*side*off;
  const ang=Math.atan2(tg.x,tg.z);
  // Body — 30 × 8 × 18 (length × height × depth)
  const tex=_p47ContainerTex();
  const bodyMat=new THREE.MeshLambertMaterial({color:0x4a463e,map:tex});
  const body=new THREE.Mesh(new THREE.BoxGeometry(30,8,18),bodyMat);
  body.position.set(cx,4,cz);
  body.rotation.y=ang;
  scene.add(body);
  if(window._freezeMatrix)window._freezeMatrix(body);
  // Roof — slightly larger, darker, sits 8u above ground
  const roof=new THREE.Mesh(
    new THREE.BoxGeometry(31,0.6,19),
    new THREE.MeshLambertMaterial({color:0x2a2820})
  );
  roof.position.set(cx,8.3,cz);
  roof.rotation.y=ang;
  scene.add(roof);
  if(window._freezeMatrix)window._freezeMatrix(roof);
  // Loading dock — a smaller box jutting out toward the track at ground level
  const dockGeo=new THREE.BoxGeometry(10,1.4,2);
  const dockMat=new THREE.MeshLambertMaterial({color:0x3a3530});
  const dock=new THREE.Mesh(dockGeo,dockMat);
  dock.position.set(
    cx-nr.x*side*(18*0.5+1),
    0.7,
    cz-nr.z*side*(18*0.5+1)
  );
  dock.rotation.y=ang;
  scene.add(dock);
  if(window._freezeMatrix)window._freezeMatrix(dock);
  // Two warm-yellow window strips on the body (large industrial windows
  // glowing softly through the night — light shining from inside).
  // Emissive box overlays — placed on the side facing the track.
  const winMat=new THREE.MeshBasicMaterial({color:0xffcc77});
  for(const wx of [-9,9]){
    const win=new THREE.Mesh(new THREE.BoxGeometry(6,1.6,0.1),winMat);
    // Position on the long face nearest the track (perp to ang)
    win.position.set(
      cx-nr.x*side*(18*0.5+0.06)+Math.cos(ang)*wx,
      4.5,
      cz-nr.z*side*(18*0.5+0.06)+Math.sin(ang)*wx
    );
    win.rotation.y=ang;
    scene.add(win);
    if(window._freezeMatrix)window._freezeMatrix(win);
  }
}

// ── Cranes on the kade (gantry cranes) ───────────────────────────────────
//
// Tall industrial gantry cranes towering over the kade-strook (sector 5).
// 2 cranes desktop / 1 mobile. Each crane is a mini-rig of:
//   • 2 vertical legs (BoxGeometry posts) — splayed at base, narrow at top
//   • 1 horizontal beam connecting the tops
//   • 1 short cable + hook hanging from the beam centre
// Steel-grey weathered material; legs share BoxGeometry, beam its own.
//
// Positioned at fixed t-values along sector 5 ([0.85, 0.95]) on the OUTER
// side (kade edge, away from the track) so they read as silhouettes against
// the city-glow horizon when the player sweeps past.
function _p47BuildCranes(){
  const mob=window._isMobile;
  const cranes=mob?[0.91]:[0.86,0.94];
  const steelMat=new THREE.MeshLambertMaterial({color:0x4a4a52});
  const beamMat=new THREE.MeshLambertMaterial({color:0x3a3a42});
  const cableMat=new THREE.MeshLambertMaterial({color:0x1a1a1a});
  const hookMat=new THREE.MeshLambertMaterial({color:0x6a6a72});
  cranes.forEach(t=>{
    const p=trackCurve.getPoint(t);
    const tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const side=-1; // outer side of sector-5 right-sweep = kade edge
    const off=BARRIER_OFF+12;
    const cx=p.x+nr.x*side*off;
    const cz=p.z+nr.z*side*off;
    const ang=Math.atan2(tg.x,tg.z);
    // Crane geometry: legs 28u tall, 14u apart at base, 6u apart at top.
    // We approximate splay by translating two slightly-rotated post boxes.
    const legSpread=14;
    for(const lx of [-legSpread*0.5, legSpread*0.5]){
      const leg=new THREE.Mesh(new THREE.BoxGeometry(0.8,28,0.8),steelMat);
      // Position legs along the cross-track axis (perp to tg)
      leg.position.set(
        cx+nr.x*side*0+Math.cos(ang)*lx,
        14,
        cz+nr.z*side*0+Math.sin(ang)*lx
      );
      // Subtle splay — tilt outward at the base via rotation
      leg.rotation.y=ang;
      leg.rotation.z=lx>0?-0.04:0.04;
      scene.add(leg);
      if(window._freezeMatrix)window._freezeMatrix(leg);
    }
    // Top beam — 18u wide, sits above the legs
    const beam=new THREE.Mesh(new THREE.BoxGeometry(18,1.2,1.2),beamMat);
    beam.position.set(cx,28,cz);
    beam.rotation.y=ang;
    scene.add(beam);
    if(window._freezeMatrix)window._freezeMatrix(beam);
    // Cable from beam centre, ~12u long (hangs into kade space)
    const cable=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,12,4),cableMat);
    cable.position.set(cx,22,cz);
    scene.add(cable);
    if(window._freezeMatrix)window._freezeMatrix(cable);
    // Hook block at end of cable
    const hook=new THREE.Mesh(new THREE.BoxGeometry(1.4,1.0,1.4),hookMat);
    hook.position.set(cx,16,cz);
    scene.add(hook);
    if(window._freezeMatrix)window._freezeMatrix(hook);
    // Counterweight blob on top — reads as the trolley/winch housing
    const trolley=new THREE.Mesh(new THREE.BoxGeometry(2.4,1.2,2.0),beamMat);
    trolley.position.set(cx,29,cz);
    trolley.rotation.y=ang;
    scene.add(trolley);
    if(window._freezeMatrix)window._freezeMatrix(trolley);
    // Dim red obstruction-warning light on top — emissive small cube
    const warnMat=new THREE.MeshBasicMaterial({color:0xff2030});
    const warn=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.6,0.6),warnMat);
    warn.position.set(cx,29.9,cz);
    scene.add(warn);
    if(window._freezeMatrix)window._freezeMatrix(warn);
  });
}

// ── Ophaalbrug (drawbridge) at sector 4 ──────────────────────────────────
//
// Static drawbridge straddling a fictional canal between the warehouse
// half and the kade half of the harbour. Sessie 2 keeps it static — no
// bascule animation. Visual frame-style construction:
//   • Two tall towers flanking the track (4 corner posts each + lattice
//     crossbeams via single-mesh BoxGeometry simplified frames)
//   • Horizontal upper beam connecting the tower tops
//   • Two angled tension cables (tower-top to bridge-deck-edge) — these
//     are the visual signal of "drawbridge"
//   • A small control booth halfway up one tower
// Anchored at t≈0.74 (sector 4 mid). Track ribbon passes through; no
// separate deck mesh needed (the track is already there).
//
// Saved into _p47Bridge for future sessie-3 animation hooks. Sessie 1's
// state declaration block already has this slot; cleanup via scene.js
// per-world array reset.
function _p47BuildOphaalbrug(){
  const t=0.74;
  const p=trackCurve.getPoint(t);
  const tg=trackCurve.getTangent(t).normalize();
  const nr=new THREE.Vector3(-tg.z,0,tg.x);
  const ang=Math.atan2(tg.x,tg.z);
  // Tower spacing — left/right of track at +/-1 side
  const TOWER_HALF=BARRIER_OFF+3;   // from track centerline
  const TOWER_H=22;
  const TOWER_W=2.2;
  const TOWER_D=2.2;
  // Group the bridge so future sessie-3 animation can rotate the whole
  // assembly together. _p47Bridge stores the THREE.Group ref.
  const grp=new THREE.Group();
  const towerMat=new THREE.MeshLambertMaterial({color:0x3a3a40});
  const beamMat=new THREE.MeshLambertMaterial({color:0x2a2a30});
  const cableMat=new THREE.MeshLambertMaterial({color:0x1a1a1a});
  const boothMat=new THREE.MeshLambertMaterial({color:0x55452a});
  // Phase 13C — winMat met emissive zodat we "occupied building" warmth
  // kunnen pulsen in update (booth window).
  const winMat=new THREE.MeshLambertMaterial({
    color:0xffcc77, emissive:0xffcc77, emissiveIntensity:0.7
  });
  // Two towers — one each side of the track
  for(const side of [-1,1]){
    const tx=p.x+nr.x*side*TOWER_HALF;
    const tz=p.z+nr.z*side*TOWER_HALF;
    // Outer shell — single hollow-feeling tower box
    const tower=new THREE.Mesh(
      new THREE.BoxGeometry(TOWER_W,TOWER_H,TOWER_D),
      towerMat
    );
    tower.position.set(tx,TOWER_H*0.5,tz);
    tower.rotation.y=ang;
    grp.add(tower);
    // Lattice cross-bracing — two diagonal ribs on the visible face
    for(const yC of [TOWER_H*0.35, TOWER_H*0.7]){
      const brace=new THREE.Mesh(
        new THREE.BoxGeometry(0.3,3.5,0.3),
        beamMat
      );
      brace.position.set(tx,yC,tz);
      brace.rotation.set(0,ang,Math.PI*0.18);
      grp.add(brace);
    }
    // Cap on top — slightly wider, darker
    const cap=new THREE.Mesh(
      new THREE.BoxGeometry(TOWER_W*1.25,0.8,TOWER_D*1.25),
      beamMat
    );
    cap.position.set(tx,TOWER_H+0.4,tz);
    cap.rotation.y=ang;
    grp.add(cap);
  }
  // Horizontal upper beam connecting the two towers — sits just under
  // the tower caps. Length spans across the track.
  const beamLen=TOWER_HALF*2;
  const upperBeam=new THREE.Mesh(
    new THREE.BoxGeometry(0.9,1.3,beamLen),
    beamMat
  );
  // Position at track center, height = TOWER_H, oriented along nr (cross-track)
  upperBeam.position.set(p.x,TOWER_H,p.z);
  upperBeam.rotation.y=ang+Math.PI/2;  // box's z-axis aligns with nr
  grp.add(upperBeam);
  // Tension cables — 4 diagonal cables from tower tops to track-deck
  // edges. Each cable is a thin cylinder. Length picked to span from
  // tower top (TOWER_H, side*TOWER_HALF) down to track edge (~0u, side*TW).
  for(const side of [-1,1]){
    for(const along of [-1,1]){
      const topX=p.x+nr.x*side*TOWER_HALF;
      const topY=TOWER_H-0.5;
      const topZ=p.z+nr.z*side*TOWER_HALF;
      // Cable end at track edge along the t-axis (+/- 4u from anchor)
      const cosA=Math.cos(ang),sinA=Math.sin(ang);
      const endX=p.x+nr.x*side*(TW+1)+cosA*along*4;
      const endY=0.4;
      const endZ=p.z+nr.z*side*(TW+1)+sinA*along*4;
      // Build a cylinder oriented from top → end
      const dx=endX-topX, dy=endY-topY, dz=endZ-topZ;
      const len=Math.hypot(dx,dy,dz);
      const cable=new THREE.Mesh(
        new THREE.CylinderGeometry(0.06,0.06,len,4),
        cableMat
      );
      // Position at midpoint, orient via lookAt
      cable.position.set((topX+endX)*0.5,(topY+endY)*0.5,(topZ+endZ)*0.5);
      // CylinderGeometry's long axis is +Y by default; need to align with
      // (dx,dy,dz). Use quaternion from default Y to target dir.
      const dir=new THREE.Vector3(dx,dy,dz).normalize();
      const q=new THREE.Quaternion();
      q.setFromUnitVectors(new THREE.Vector3(0,1,0),dir);
      cable.quaternion.copy(q);
      cable.userData = {_baseQ: q.clone()};  // Phase 13C — cache base quat voor sway
      _p47BridgeCables.push(cable);
      grp.add(cable);
    }
  }
  // Control booth on the +1 side, mid-height. Tiny box with a glowing
  // amber window.
  const sideB=1;
  const boothX=p.x+nr.x*sideB*(TOWER_HALF+1.6);
  const boothY=11;
  const boothZ=p.z+nr.z*sideB*(TOWER_HALF+1.6);
  const booth=new THREE.Mesh(new THREE.BoxGeometry(2.8,2.2,2.0),boothMat);
  booth.position.set(boothX,boothY,boothZ);
  booth.rotation.y=ang;
  grp.add(booth);
  // Booth window — track-facing side, emissive amber
  const winOff=-nr.x*sideB*1.06;
  const winOffZ=-nr.z*sideB*1.06;
  const win=new THREE.Mesh(new THREE.BoxGeometry(1.8,1.0,0.06),winMat);
  win.position.set(boothX+winOff,boothY+0.3,boothZ+winOffZ);
  win.rotation.y=ang;
  grp.add(win);
  // Two red obstruction-warning lights on the upper beam ends — small
  // emissive cubes. Match the crane warning lights for visual consistency.
  // Phase 13C — transparent zodat we ~2Hz blink kunnen animeren in update.
  const warnMat=new THREE.MeshBasicMaterial({color:0xff2030, transparent:true, opacity:0.9});
  for(const side of [-1,1]){
    const wx=p.x+nr.x*side*(TOWER_HALF-0.8);
    const wz=p.z+nr.z*side*(TOWER_HALF-0.8);
    const warn=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.5,0.5),warnMat);
    warn.position.set(wx,TOWER_H+0.9,wz);
    grp.add(warn);
  }
  scene.add(grp);
  _p47Bridge=grp;
  // Phase 13C — cache material refs voor animation
  _p47BridgeWarnMat = warnMat;
  _p47BridgeWinMat = winMat;
}

// ── Drizzle particle pool (motregen) ─────────────────────────────────────
//
// 3D depth-tested rain streaks orbiting the player. Combined with the
// shared canvas-rain overlay (already on at 0.6 intensity from buildPier47-
// Environment), the world reads as actual volumetric motregen instead of
// a flat-canvas-overlay-on-top-of-3D-scene.
//
// Particle pool is centred on the player; positions wrap in updatePier47-
// World as the camera moves so the rain follows. Each particle has a
// per-instance vertical velocity baked in via the position.y accumulation
// in the update loop.
//
// Material is a PointsMaterial with sizeAttenuation OFF so streaks look
// uniform at any distance (real rain doesn't become invisible far away —
// it becomes a haze, which the canvas overlay supplies). Color is a
// cool desaturated blue-grey (#9aa6b8) at low opacity (0.45) — visible
// against the dark sky but doesn't compete with the sodium lamps.
function _p47BuildDrizzle(){
  const N=window._isMobile?180:340;
  const geo=new THREE.BufferGeometry();
  const pos=new Float32Array(N*3);
  // Initial random positions inside a 220×30×220 volume around origin.
  // updatePier47World re-parents positions to follow the player.
  for(let i=0;i<N;i++){
    pos[i*3]  =(Math.random()-0.5)*220;
    pos[i*3+1]=Math.random()*30;
    pos[i*3+2]=(Math.random()-0.5)*220;
  }
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  const mat=new THREE.PointsMaterial({
    color:0x9aa6b8,
    size:0.95,
    transparent:true,
    opacity:0.45,
    sizeAttenuation:false,    // uniform streak size at all distances
    depthWrite:false           // don't occlude transparent fog/lights behind
  });
  _p47Drizzle=new THREE.Points(geo,mat);
  scene.add(_p47Drizzle);
  _p47DrizzleGeo=geo;
}

// ── Dock-clutter industrial props ─────────────────────────────────────────
//
// Vult de tussenstukken tussen containers, warehouse, cranes en bridge met
// industrial dock-detail: vaten, pallet-stapels, kabelhaspels, bollards en
// een paar overhead pipe-runs. Alles via InstancedMesh per prop-type — één
// draw-call per type. Geen extra lights (zou de A1-fix tegenwerken: meer
// PointLights = grotere kans op shader-recompile bij visibility-toggle).
//
// Posities: seeded deterministisch via een mini-RNG zodat herhaalde
// world-builds dezelfde layout opleveren. Side-offsets minimaal
// BARRIER_OFF + 4u zodat niets in de race-zone staat.

// Shared procedural weathered-metal texture — gebruikt door barrels,
// spools en bollards. Eén grijze base met horizontale rib + rust streaks.
let _p47MetalTexCache=null;
function _p47MetalTex(){
  if(_p47MetalTexCache)return _p47MetalTexCache;
  const W=64,H=64,c=document.createElement('canvas');
  c.width=W;c.height=H;
  const g=c.getContext('2d');
  g.fillStyle='#ffffff';g.fillRect(0,0,W,H);
  // Horizontale ribbing — geeft cilinder-volume suggestion
  g.strokeStyle='rgba(30,30,30,0.40)';g.lineWidth=1;
  for(let y=0;y<H;y+=6){g.beginPath();g.moveTo(0,y);g.lineTo(W,y);g.stroke();}
  // Rust patches
  for(let i=0;i<5;i++){
    const x=Math.random()*W,y=Math.random()*H,r=3+Math.random()*7;
    const grd=g.createRadialGradient(x,y,0,x,y,r);
    grd.addColorStop(0,'rgba(80,35,20,0.55)');
    grd.addColorStop(1,'rgba(80,35,20,0)');
    g.fillStyle=grd;g.fillRect(x-r,y-r,r*2,r*2);
  }
  // Vertical wear streaks
  for(let i=0;i<3;i++){
    const x=Math.random()*W;
    g.fillStyle='rgba(20,15,10,0.20)';
    g.fillRect(x,0,1,H);
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.anisotropy=2;t.needsUpdate=true;
  // _sharedAsset flag: disposeScene() respecteert deze marker en disposed
  // de texture NIET op world-switch. Anders zou de tweede Pier 47-visit een
  // disposed GPU-resource via _p47MetalTexCache hergebruiken → black map.
  // Patroon hergebruikt van js/effects/particles.js:30 / visuals.js:605.
  t.userData={_sharedAsset:true};
  _p47MetalTexCache=t;
  return t;
}

// Mini-LCG voor deterministische placement. Reset per build-call zodat
// elke world-load identieke layout produceert.
function _p47MakeRng(seed){
  let s=seed>>>0;
  return function(){
    s=(s*1664525+1013904223)>>>0;
    return s/0x100000000;
  };
}

function _p47BuildDockClutter(){
  const mob=window._isMobile;
  const rng=_p47MakeRng(0x70477a1);
  const tex=_p47MetalTex();

  // Industrial palette — hergebruikt container-palette tonen.
  const PAL=[
    [0.62,0.28,0.16],   // rust-orange
    [0.55,0.45,0.20],   // dirty mustard
    [0.42,0.42,0.40],   // industrial grey
    [0.30,0.30,0.36],   // dark slate
    [0.22,0.42,0.30],   // weathered green
    [0.45,0.18,0.20]    // dark red
  ];

  // ── Helper: build an InstancedMesh and add to scene ───────────────────
  // frustumCulled:false — instance-posities lopen langs de hele track-curve
  // maar mesh.matrixWorld blijft identity, dus de bounding-sphere rond
  // origin zou de hele IM verkeerd wegcullen zodra de camera niet richting
  // origin kijkt. Zelfde reden als proc-decor.js _makeIM (regel 206-214).
  const dummy=new THREE.Object3D();
  function buildIM(geo, mat, count){
    const im=new THREE.InstancedMesh(geo,mat,count);
    im.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(count*3),3);
    im.frustumCulled=false;
    im.castShadow=false;
    return im;
  }
  function finalizeIM(im, idx){
    im.count=idx;
    im.instanceMatrix.needsUpdate=true;
    if(im.instanceColor)im.instanceColor.needsUpdate=true;
    scene.add(im);
  }

  // ── 1. Olie/chem-vaten (barrels) ──────────────────────────────────────
  // Verspreid langs yard-randen en warehouse-aanloop. Staan rechtop, soms
  // 2 op elkaar voor variatie.
  {
    const N=mob?18:36;
    const geo=new THREE.CylinderGeometry(0.55,0.6,1.4,10);
    const mat=new THREE.MeshLambertMaterial({color:0xffffff,map:tex});
    const im=buildIM(geo,mat,N);
    let idx=0;
    // Verspreid over t = [0.10, 0.65] — yard t/m warehouse-aanloop
    const tBase=[0.10,0.16,0.22,0.28,0.34,0.40,0.46,0.52,0.58,0.62];
    for(let bi=0;bi<N;bi++){
      const t=tBase[bi%tBase.length]+(rng()-0.5)*0.02;
      const p=trackCurve.getPoint(t);
      const tg=trackCurve.getTangent(t).normalize();
      const nr=new THREE.Vector3(-tg.z,0,tg.x);
      const side=(rng()<0.5)?-1:1;
      const off=BARRIER_OFF+5+rng()*9;
      // Cluster: groepjes van 1-3 bij elkaar
      const cluster=1+((rng()*3)|0);
      for(let cj=0;cj<cluster && idx<N;cj++){
        const lx=(rng()-0.5)*1.6;
        const lz=(rng()-0.5)*1.6;
        const x=p.x+nr.x*side*off+lx;
        const z=p.z+nr.z*side*off+lz;
        // ~15% kans op gestapeld vat (op .7+1.4*0.5 = 1.4 hoogte)
        const stacked=rng()<0.15;
        dummy.position.set(x,0.7+(stacked?1.4:0),z);
        dummy.rotation.set(0,rng()*Math.PI*2,0);
        dummy.scale.set(1,1,1);
        dummy.updateMatrix();
        im.setMatrixAt(idx,dummy.matrix);
        const col=PAL[(rng()*PAL.length)|0];
        im.instanceColor.setXYZ(idx,col[0],col[1],col[2]);
        idx++;
      }
    }
    finalizeIM(im,idx);
  }

  // ── 2. Pallet-stapels ──────────────────────────────────────────────────
  // Houtige bruine kratten, in stapels van 1-3 hoog. Eigen materiaal
  // (geen tex) — flat color is goed genoeg voor de afstand.
  {
    const N=mob?12:24;
    const geo=new THREE.BoxGeometry(1.2,0.7,1.2);
    const mat=new THREE.MeshLambertMaterial({color:0xffffff});
    const im=buildIM(geo,mat,N);
    let idx=0;
    const woodPal=[
      [0.45,0.30,0.18],
      [0.38,0.24,0.14],
      [0.52,0.36,0.22],
      [0.30,0.20,0.12]
    ];
    // Pallet-stapels concentreren bij yard (t 0.30-0.50) en bij dock (t 0.62)
    const stackPoints=[
      0.28,0.32,0.36,0.40,0.44,0.48,0.62,0.66
    ];
    for(let pi=0;pi<stackPoints.length && idx<N;pi++){
      const t=stackPoints[pi];
      const p=trackCurve.getPoint(t);
      const tg=trackCurve.getTangent(t).normalize();
      const nr=new THREE.Vector3(-tg.z,0,tg.x);
      const side=(pi%2===0)?1:-1;
      const off=BARRIER_OFF+6+rng()*4;
      const baseX=p.x+nr.x*side*off;
      const baseZ=p.z+nr.z*side*off;
      const ang=Math.atan2(tg.x,tg.z)+(rng()-0.5)*0.4;
      const high=1+((rng()*3)|0);  // 1-3 hoog
      for(let sk=0;sk<high && idx<N;sk++){
        dummy.position.set(baseX,0.35+sk*0.72,baseZ);
        dummy.rotation.set(0,ang,0);
        dummy.scale.set(1,1,1);
        dummy.updateMatrix();
        im.setMatrixAt(idx,dummy.matrix);
        const col=woodPal[(rng()*woodPal.length)|0];
        im.instanceColor.setXYZ(idx,col[0],col[1],col[2]);
        idx++;
      }
    }
    finalizeIM(im,idx);
  }

  // ── 3. Kabelhaspels (cable spools) ─────────────────────────────────────
  // Grote houten/metalen spools, liggend (as horizontaal). 14 desktop / 8 mobile.
  {
    const N=mob?8:14;
    // Cylinder ligt op zijn kant — roteer ±90° rond Z bij placement
    const geo=new THREE.CylinderGeometry(0.95,0.95,1.0,12);
    const mat=new THREE.MeshLambertMaterial({color:0xffffff,map:tex});
    const im=buildIM(geo,mat,N);
    let idx=0;
    const spoolPoints=[
      0.20,0.34,0.42,0.50,0.58,0.74,0.86,0.92,
      0.24,0.30,0.46,0.54,0.68,0.82
    ];
    for(let si=0;si<N && si<spoolPoints.length;si++){
      const t=spoolPoints[si];
      const p=trackCurve.getPoint(t);
      const tg=trackCurve.getTangent(t).normalize();
      const nr=new THREE.Vector3(-tg.z,0,tg.x);
      const side=(rng()<0.5)?-1:1;
      const off=BARRIER_OFF+7+rng()*8;
      dummy.position.set(
        p.x+nr.x*side*off,
        0.95,
        p.z+nr.z*side*off
      );
      // Liggend: rotate -π/2 around Z, dan random Y-spin
      dummy.rotation.set(0,rng()*Math.PI*2,Math.PI/2);
      dummy.scale.set(1,1,1);
      dummy.updateMatrix();
      im.setMatrixAt(idx,dummy.matrix);
      // Spools: bruin/grijs paletje
      const col=PAL[2+((rng()*4)|0)%4];
      im.instanceColor.setXYZ(idx,col[0],col[1],col[2]);
      idx++;
    }
    finalizeIM(im,idx);
  }

  // ── 4. Bollards (meerpalen) langs kade-rand sector 5 ───────────────────
  // Korte zware staal-cilinders waar schepen aan vastliggen.
  // Verspreid langs t = [0.84, 0.98] outer side (= -1).
  {
    const N=mob?14:28;
    const geo=new THREE.CylinderGeometry(0.32,0.40,1.1,8);
    const mat=new THREE.MeshLambertMaterial({color:0xffffff,map:tex});
    const im=buildIM(geo,mat,N);
    let idx=0;
    for(let bi=0;bi<N;bi++){
      const t=0.84+(bi/N)*0.14;
      const p=trackCurve.getPoint(t);
      const tg=trackCurve.getTangent(t).normalize();
      const nr=new THREE.Vector3(-tg.z,0,tg.x);
      const side=-1;  // outer side = kade-rand
      const off=BARRIER_OFF+4.5+(bi%3)*0.4;
      dummy.position.set(
        p.x+nr.x*side*off,
        0.55,
        p.z+nr.z*side*off
      );
      dummy.rotation.set(0,0,0);
      dummy.scale.set(1,1,1);
      dummy.updateMatrix();
      im.setMatrixAt(idx,dummy.matrix);
      // Donker staal-grijs voor alle bollards
      im.instanceColor.setXYZ(idx,0.32,0.32,0.34);
      idx++;
    }
    finalizeIM(im,idx);
  }

  // ── 5. Overhead pipe-runs ──────────────────────────────────────────────
  // Lange horizontale buizen op ~4-5u hoog, langs warehouse + dock-randen.
  // Geen InstancedMesh nodig — slechts 2-3 stuks, elk een statische
  // Cylinder. Eén shared material.
  {
    const N=mob?2:3;
    const pipeMat=new THREE.MeshLambertMaterial({color:0x5a5048,map:tex});
    // 3 pipe-segments langs verschillende sectie-randen.
    const pipeDefs=[
      {t0:0.55,t1:0.72,side: 1,y:5.2},  // langs warehouse approach (sector 3-4)
      {t0:0.35,t1:0.50,side: 1,y:4.6},  // langs yard inner edge (sector 2)
      {t0:0.10,t1:0.22,side:-1,y:4.8},  // langs container-run outer (sector 1)
    ];
    for(let pi=0;pi<N;pi++){
      const d=pipeDefs[pi];
      const p0=trackCurve.getPoint(d.t0);
      const p1=trackCurve.getPoint(d.t1);
      const tg=trackCurve.getTangent((d.t0+d.t1)*0.5).normalize();
      const nr=new THREE.Vector3(-tg.z,0,tg.x);
      const off=BARRIER_OFF+6;
      const x0=p0.x+nr.x*d.side*off;
      const z0=p0.z+nr.z*d.side*off;
      const x1=p1.x+nr.x*d.side*off;
      const z1=p1.z+nr.z*d.side*off;
      const dx=x1-x0, dz=z1-z0;
      const len=Math.sqrt(dx*dx+dz*dz);
      const ang=Math.atan2(dx,dz);
      const pipe=new THREE.Mesh(
        new THREE.CylinderGeometry(0.22,0.22,len,6,1,true),
        pipeMat
      );
      pipe.position.set((x0+x1)*0.5,d.y,(z0+z1)*0.5);
      // Cylinder default-as is Y; rotate to lie along (dx,dz)
      pipe.rotation.set(0,ang,Math.PI/2);
      scene.add(pipe);
      // Eenvoudige steunen — 2 kleine vertical posts op ~25%/75% van pipe
      for(const f of [0.25,0.75]){
        const sx=x0+dx*f, sz=z0+dz*f;
        const post=new THREE.Mesh(
          new THREE.CylinderGeometry(0.12,0.12,d.y,5),
          pipeMat
        );
        post.position.set(sx,d.y*0.5,sz);
        scene.add(post);
      }
    }
  }

  // ── 6. Stack-light beacons ─────────────────────────────────────────────
  // Een paar gele knipperende beacons bovenop random barrel-stacks +
  // crane-base, halo-only (geen PointLight) zodat we de A1-light-budget
  // niet aantasten.
  if(typeof buildCinematicBlinkingMarker==='function'){
    const N=mob?2:4;
    const beaconPoints=[
      {t:0.30, side: 1, h:3.2},
      {t:0.48, side:-1, h:3.5},
      {t:0.70, side: 1, h:3.4},
      {t:0.90, side:-1, h:3.0}
    ];
    for(let bi=0;bi<N;bi++){
      const d=beaconPoints[bi];
      const p=trackCurve.getPoint(d.t);
      const tg=trackCurve.getTangent(d.t).normalize();
      const nr=new THREE.Vector3(-tg.z,0,tg.x);
      const off=BARRIER_OFF+7;
      buildCinematicBlinkingMarker(scene,
        new THREE.Vector3(p.x+nr.x*d.side*off, d.h, p.z+nr.z*d.side*off),
        {
          color:0xffcc44,
          pattern:'slow-pulse',
          blinkInterval:1.6+bi*0.25,
          intensity:0.7,
          range:14,
          haloSize:1.1,
          includeLight:false
        }
      );
    }
  }
}

// ── Main environment builder ──────────────────────────────────────────────
//
// Sessie 3 expansion (cumulative):
//   1. Concrete kade ground (sessie-1)
//   2. Day-lighting (sessie-1)
//   3. Barriers + start line (sessie-1)
//   4. Sodium lamp poles along the kade (sessie-2 commit 1)
//   5. Containers in Container Run + The Yard (sessie-2 commit 2)
//   6. Warehouse at sector 3 → 4 corner (sessie-2 commit 2)
//   7. Cranes on the kade (sessie-2 commit 2)
//   8. Ophaalbrug at sector 4 (sessie-2 commit 3)
//   9. Wet-asphalt material swap in track.js (sessie-2 commit 3)
//  10. Headlights + sparse always-off stars (sessie-1)
//  11. Motregen default + drizzle particle pool (sessie-3 commit 1 — NEW)
function buildPier47Environment(){
  // Pier 47 default weather = motregen (sessie 3). Unlike sandstorm which
  // clears any inherited rain, pier47 LEANS INTO it: rain on, intensity
  // capped at 0.6 (drizzle, not pouring). The shared updateWeather() lerp
  // smoothly settles _rainIntensity toward _rainTarget — we set both to
  // 0.6 here so the canvas-rain visual is at motregen level immediately,
  // not a 1-second fade-up. _p47BuildDrizzle() spawns the additional
  // depth-tested 3D drizzle streaks (more atmospheric than canvas alone).
  if(typeof isRain!=='undefined'){
    isRain=true;
    if(typeof _rainTarget!=='undefined')_rainTarget=0.6;
    if(typeof _rainIntensity!=='undefined')_rainIntensity=0.6;
    if(rainCanvas){rainCanvas.style.display='block';rainCanvas.style.opacity='0.6';}
  }
  // Ground — flat dark-concrete kade. 2400² to fill the world; matches the
  // sandstorm/arctic pattern. y=-0.15 sits below the y=0.005 track ribbon.
  const g=new THREE.Mesh(
    new THREE.PlaneGeometry(2400,2400),
    new THREE.MeshLambertMaterial({color:0x2a2a30,map:_pier47GroundTex()})
  );
  g.rotation.x=-Math.PI/2;g.position.y=-.15;g.receiveShadow=true;
  g.userData._isProcGround=true; // hookable by asset-bridge if PBR concrete loaded later
  scene.add(g);
  // Day lighting — single source of truth via the helper.
  _applyPier47DayLighting();
  // Barriers + start line (shared environment helpers).
  buildBarriers();buildStartLine();
  // Sodium-lamp poles along the kade — cinematic upgrade. Each pole now
  // has a volumetric light cone, ground pool, and halo billboard via the
  // shared cinematic.js helpers, replacing the sessie-2 minimal version.
  // Variation: 2-3 lamps "broken" (no light), 2-3 subtly tilted ("oude").
  _p47BuildCinematicLamps();
  // Industrial props (sessie 2 commit 2):
  //   • Containers — sectors 1 + 2 (Container Run + The Yard)
  //   • Warehouse — sector 3 / 4 corner (loods at WP9 90° right)
  //   • Cranes — sector 5 (kade edge, outer side)
  _p47BuildContainers();
  _p47BuildWarehouse();
  _p47BuildCranes();
  _p47BuildOphaalbrug();
  // Dock-clutter: vaten, pallets, kabelhaspels, bollards, pipes + 4 beacons.
  // Alles InstancedMesh per type → 5 nieuwe draw-calls totaal (+ pipes als
  // shared-material statics). Geen nieuwe PointLights — beacons zijn
  // halo-only zodat de coin/repair intensity-toggle-fix niet wordt onderuit
  // gehaald door extra dynamic-light-count.
  _p47BuildDockClutter();
  // Cinematic distant accents — far horizon markers + city-glow hint.
  // Both via shared cinematic.js helpers; pulses driven by updateCinematic.
  _p47BuildDistantMarkers();
  _p47BuildCityGlow();
  // Cinematic motion: register subtle speed-scaled camera shake. Cleared
  // automatically on world-switch via resetCinematicState().
  if (typeof enableCinematicCameraShake === 'function'){
    enableCinematicCameraShake({
      intensityScale: 1.0,
      speedThreshold: 0.20,   // no shake idle
      maxOffset:      0.045   // ~0.05u offset at top speed — voelbaar niet storend
    });
  }
  // Bloom boost is wired in postfx.js _BLOOM_WORLD_MUL.pier47 — see commit
  // 4 of the cinematic foundation. The applyCinematicMotionBlur helper
  // documents the limitation: real radial blur needs a postfx pipeline
  // restructure that's out of scope.
  // Sessie 3 atmosphere: drizzle-particle pool gives depth-tested rain
  // streaks in 3D (the canvas rain is a flat overlay; combining both
  // reads as actual volumetric motregen).
  _p47BuildDrizzle();
  // Cinematic foundation: low ground fog (js/effects/cinematic.js).
  // Donkerpaars met subtiele warme tint die de amber lamp-pools
  // straks complementeert. Slow scroll suggereert lichte harbour-wind.
  // Mobile auto-clamps to 1 layer (vs 3 desktop) for budget.
  if (typeof buildCinematicGroundFog === 'function'){
    // Force 1-layer mobile (vs 3) — helper may or may not auto-clamp;
    // expliciet hier zodat budget gegarandeerd is.
    buildCinematicGroundFog(scene, {
      color: 0x2a1a30,
      density: 0.55,
      height: 4.5,
      layerCount: window._isMobile ? 1 : 3,
      layerSpacing: 2.0,
      size: 900,
      scrollDir: [1, 0.3],
      scrollSpeed: 0.012,
      fadeWithDistance: true
    });
  }
  // Player + AI headlight refs — Pier 47 is dark, headlights matter even
  // before sessie-2 sodium lamps land.
  plHeadL=new THREE.SpotLight(0xffffff,0,50,Math.PI*.16,.5);
  plHeadR=new THREE.SpotLight(0xffffff,0,50,Math.PI*.16,.5);
  scene.add(plHeadL);scene.add(plHeadL.target);scene.add(plHeadR);scene.add(plHeadR.target);
  plTail=new THREE.PointLight(0xff2200,0,10);scene.add(plTail);
  // Stars — always-off for Pier 47 (city light pollution + cloud cover).
  // Built and added so other systems (toggleNight) that read window.stars
  // never crash on null. The instanced mesh visibility stays false.
  {
    const sg=new THREE.SphereGeometry(.12,4,4);
    const sm=new THREE.MeshBasicMaterial({color:0x888080,transparent:true,opacity:.4});
    stars=new THREE.InstancedMesh(sg,sm,30);stars.visible=false;
    const dm=new THREE.Object3D();
    for(let i=0;i<30;i++){
      const th=Math.random()*Math.PI*2,ph=Math.random()*Math.PI*.3,r=320+Math.random()*60;
      dm.position.set(r*Math.sin(ph)*Math.cos(th),r*Math.cos(ph)*.4+50,r*Math.sin(ph)*Math.sin(th));
      dm.scale.setScalar(.5);dm.updateMatrix();stars.setMatrixAt(i,dm.matrix);
    }
    stars.instanceMatrix.needsUpdate=true;scene.add(stars);
  }
  // ── Phase 10.8 — drifting fog patches over kade ──────────────────────
  // 3 shared sprite-instances die langzaam langs random paden glijden
  // boven de haven. Wrap rond camera als ze te ver weg drijven. Slate-
  // gray tint past bij de noir-vibe.
  _p47FogPatches.length = 0;
  if(typeof _getSoftCloudTex === 'function'){
    const tex = _getSoftCloudTex();
    for(let _fp=0; _fp<3; _fp++){
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.35,
        depthWrite: false, blending: THREE.NormalBlending,
        color: 0x252030
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(45, 18, 1);
      sprite.position.set(
        (Math.random()-0.5) * 250,
        6 + Math.random() * 4,
        (Math.random()-0.5) * 250
      );
      sprite.userData = {
        vx: (Math.random()-0.5) * 0.15,
        vz: (Math.random()-0.5) * 0.15
      };
      scene.add(sprite);
      _p47FogPatches.push(sprite);
    }
  }
  _buildPier47CloseBand();        // Phase 12A
  _buildPier47MidRing();          // Phase 11A
  _buildPier47MidVariety();       // Phase 12B
  _buildPier47AtmosphereLayer();  // Phase 11C
  _buildPier47FarSilhouette();    // Phase 12C
  _buildPier47Crane2();           // Phase 12D
}

// Phase 12D — signature: 2e harbor crane gantry sweeping over track
// at t=0.4. Tower + horizontal boom + hanging hook.
function _buildPier47Crane2(){
  if(typeof trackCurve==='undefined'||!trackCurve)return;
  const t = 0.4;
  const pt = trackCurve.getPoint(t);
  const tg = trackCurve.getTangent(t).normalize();
  const rotY = Math.atan2(tg.x, tg.z);
  const right = new THREE.Vector3(-tg.z, 0, tg.x);
  const mat = new THREE.MeshLambertMaterial({color:0x886611, emissive:0x221100, emissiveIntensity:0.18});
  const group = new THREE.Group();
  group.position.set(pt.x + right.x*25, 0, pt.z + right.z*25);  // tower off to one side
  group.rotation.y = rotY;
  group.userData = {_noLodCull:true};
  // Tower
  const towerGeo = new THREE.CylinderGeometry(0.8, 1.1, 22, 6);
  const tower = new THREE.Mesh(towerGeo, mat);
  tower.position.set(0, 11, 0);
  group.add(tower);
  // Horizontal boom sweeping across track (toward -right direction)
  const boomGeo = new THREE.BoxGeometry(50, 0.7, 1.0);
  const boom = new THREE.Mesh(boomGeo, mat);
  boom.position.set(-15, 22, 0);  // boom extends from tower across track
  group.add(boom);
  // Hanging hook cable + hook
  const cableGeo = new THREE.CylinderGeometry(0.06, 0.06, 12, 4);
  const cable = new THREE.Mesh(cableGeo, mat);
  cable.position.set(-30, 16, 0);
  group.add(cable);
  const hookGeo = new THREE.BoxGeometry(1.2, 1.0, 1.2);
  const hook = new THREE.Mesh(hookGeo, mat);
  hook.position.set(-30, 9, 0);
  group.add(hook);
  group.traverse(o => { if(o.isMesh) o.castShadow = false; });
  scene.add(group);
  _p47Crane2 = group;  // Phase 13C — register voor sway-animation
}

// Phase 12C — 5 distant ship-silhouettes op r=220u (+z hemisphere = water).
// Hull + 2 masts + nav-LED rood/groen voor backlit-vibe.
function _buildPier47FarSilhouette(){
  const hullGeo = new THREE.BoxGeometry(8, 1.4, 2.4);
  const mastGeo = new THREE.CylinderGeometry(0.1, 0.1, 5, 5);
  const hullMat = new THREE.MeshLambertMaterial({color:0x202830, emissive:0x4488aa, emissiveIntensity:0.1});
  const mastMat = new THREE.MeshLambertMaterial({color:0x101820});
  for(let i=0;i<5;i++){
    const ang = -Math.PI/2 + (i/4 - 0.5) * Math.PI * 0.9;  // spread across +z hemisphere
    const r = 200 + Math.random()*60;
    const x = Math.cos(ang)*r;
    const z = Math.abs(Math.sin(ang))*r;  // force +z
    const group = new THREE.Group();
    group.position.set(x, 0.7, z);
    group.rotation.y = Math.atan2(-x, -z) + (Math.random()-0.5)*0.5;
    group.userData = {_noLodCull:true};
    const hull = new THREE.Mesh(hullGeo, hullMat);
    group.add(hull);
    const m1 = new THREE.Mesh(mastGeo, mastMat);
    m1.position.set(-1.5, 2.5, 0);
    group.add(m1);
    const m2 = new THREE.Mesh(mastGeo, mastMat);
    m2.position.set(1.5, 2.5, 0);
    group.add(m2);
    scene.add(group);
  }
}

// Phase 12B — mid-band variety: cargo-pallets + dark rope-bollards
// zodat de 7-color container ring niet enige geometry leest.
function _buildPier47MidVariety(){
  if(typeof _populateMidRing!=='function')return;
  // Flat cargo pallets — wide low boxes
  const palletCount = (typeof _mobCount==='function')?_mobCount(20):20;
  const palletGeo = new THREE.BoxGeometry(1.5, 0.2, 1.5);
  const palletMat = new THREE.MeshLambertMaterial({color:0x5a4020, emissive:0x110800, emissiveIntensity:0.1});
  const palletIm = new THREE.InstancedMesh(palletGeo, palletMat, palletCount*2);
  _populateMidRing(palletIm, {
    perSide: palletCount, offsetMin:20, offsetMax:42,
    scaleMin:0.9, scaleMax:1.3, stagger:0.5,
    yFn: () => 0.1
  });
  scene.add(palletIm);
  // Rope bollards — dark CylinderGeo, taller dan yellow bollards
  const rbCount = (typeof _mobCount==='function')?_mobCount(15):15;
  const rbGeo = new THREE.CylinderGeometry(0.4, 0.5, 1.6, 8);
  const rbMat = new THREE.MeshLambertMaterial({color:0x222230, emissive:0x000011, emissiveIntensity:0.15});
  const rbIm = new THREE.InstancedMesh(rbGeo, rbMat, rbCount*2);
  _populateMidRing(rbIm, {
    perSide: rbCount, offsetMin:20, offsetMax:42,
    scaleMin:0.9, scaleMax:1.1, stagger:0.85,
    yFn: () => 0.8
  });
  scene.add(rbIm);
}

// Phase 11C — subtiele oranje sodium-glow grondstrook rondom de scene.
// Open-cylinder met BackSide + lage opacity zodat het als atmosfeer
// leest, niet als een muur.
function _buildPier47AtmosphereLayer(){
  const geo = new THREE.CylinderGeometry(280, 280, 4, 32, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color:0xff8833, transparent:true, opacity:0.06,
    side:THREE.BackSide, depthWrite:false
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.y = 2;
  ring.userData={_noLodCull:true};
  scene.add(ring);
}

// Phase 11A — tweede container-rij + bollards op far-side van baan.
// 7 kleuren container palette (zelfde als bestaande containers), plus
// gele bollards op grond.
function _buildPier47MidRing(){
  if(typeof _populateMidRing!=='function')return;
  const CONT_COLS = [0xc44747, 0x4778c4, 0x4caa4c, 0xc4a647, 0x47b8c4, 0xa84cc4, 0x808080];
  const perColor = (typeof _mobCount==='function')?_mobCount(12):12;
  const cGeo = new THREE.BoxGeometry(6, 2.4, 2.4);
  CONT_COLS.forEach((col, ci) => {
    const mat = new THREE.MeshLambertMaterial({color:col, emissive:col, emissiveIntensity:0.04});
    const im  = new THREE.InstancedMesh(cGeo, mat, perColor*2);
    _populateMidRing(im, {
      perSide: perColor, offsetMin:28, offsetMax:50,
      scaleMin:0.95, scaleMax:1.1, stagger: ci/CONT_COLS.length,
      yFn: () => 1.2
    });
    scene.add(im);
  });
  // Yellow bollards close to track (foreground detail).
  // Phase 12A: bumped 40→60 + spread offset 3-5→5-8 (was wall-effect).
  const bPerSide = (typeof _mobCount==='function')?_mobCount(60):60;
  const bGeo = new THREE.CylinderGeometry(0.2, 0.25, 1.1, 8);
  const bMat = new THREE.MeshLambertMaterial({color:0xffcc00, emissive:0x553300, emissiveIntensity:0.5});
  const bIm  = new THREE.InstancedMesh(bGeo, bMat, bPerSide*2);
  _populateMidRing(bIm, {
    perSide: bPerSide, offsetMin:5, offsetMax:8,
    scaleMin:0.9, scaleMax:1.1,
    yFn: () => 0.55
  });
  scene.add(bIm);
}

// Phase 12A — close-band addendum: fire-hydrants + stacked crates voor
// dense foreground detail naast de uitgespreide bollards.
function _buildPier47CloseBand(){
  if(typeof _populateMidRing!=='function')return;
  // Fire hydrants — red CylinderGeo with chunky proportions
  const hCount = (typeof _mobCount==='function')?_mobCount(18):18;
  const hGeo = new THREE.CylinderGeometry(0.3, 0.35, 1.0, 6);
  const hMat = new THREE.MeshLambertMaterial({color:0xcc2222, emissive:0x441111, emissiveIntensity:0.3});
  const hIm = new THREE.InstancedMesh(hGeo, hMat, hCount*2);
  _populateMidRing(hIm, {
    perSide: hCount, offsetMin:4, offsetMax:7,
    scaleMin:0.85, scaleMax:1.1, stagger:0.5,
    yFn: () => 0.5
  });
  scene.add(hIm);
  // Stacked crates — wooden boxes
  const cCount = (typeof _mobCount==='function')?_mobCount(22):22;
  const cGeo = new THREE.BoxGeometry(1.2, 0.9, 1.2);
  const cMat = new THREE.MeshLambertMaterial({color:0x6a4a2a, emissive:0x110800, emissiveIntensity:0.15});
  const cIm = new THREE.InstancedMesh(cGeo, cMat, cCount*2);
  _populateMidRing(cIm, {
    perSide: cCount, offsetMin:6, offsetMax:12,
    scaleMin:0.8, scaleMax:1.5, stagger:0.25,
    yFn: () => 0.45
  });
  scene.add(cIm);
}

// ── Per-frame world update ────────────────────────────────────────────────
//
// Sessie 2 introduces the first per-frame work for Pier 47: subtle
// sodium-lamp flicker on the lamp-head shared emissive material. The
// flicker is a single sine modulation around the baseline emissiveIntensity
// so all lamps pulse in unison — cheap (one mat mutation per frame) and
// reads as the harmonic flicker of a row of high-pressure sodium lamps
// settling into their warm-up cycle.
//
// Sessie 3 will extend this with rain-puddle shimmer, drifting fog, and
// optional ophaalbrug bascule animation. For now: just lamp flicker.
function updatePier47World(dt){
  const t=_nowSec;
  const _M = !!window._isMobile;
  _p47Frame++;
  // Phase 13C — bridge "alive" atmosphere (geen volledige rotation:
  // race-physics risk). Subtiele signals op bestaande static refs.
  // Epsilon-gated material writes via LUT-sin.
  const _p47Sin = window._sharedSin || Math.sin;
  if(_p47BridgeWarnMat){
    // ~2Hz red blink pulse
    const _op = 0.6 + _p47Sin(t*2.5)*0.4;
    if(_p47BridgeWarnMat._lastOp===undefined||Math.abs(_op-_p47BridgeWarnMat._lastOp)>0.005){
      _p47BridgeWarnMat._lastOp=_op; _p47BridgeWarnMat.opacity=_op;
    }
  }
  if(_p47BridgeWinMat){
    // Slow "occupied building" warmth pulse op booth window
    const _ei = 0.7 + _p47Sin(t*0.6)*0.3;
    if(_p47BridgeWinMat._lastEi===undefined||Math.abs(_ei-_p47BridgeWinMat._lastEi)>0.003){
      _p47BridgeWinMat._lastEi=_ei; _p47BridgeWinMat.emissiveIntensity=_ei;
    }
  }
  // Cable sway — subtle wind suggestion (tiny per-frame quaternion mul)
  if(_p47BridgeCables.length){
    for(let i=0;i<_p47BridgeCables.length;i++){
      const c = _p47BridgeCables[i];
      const baseQ = c.userData && c.userData._baseQ;
      if(!baseQ)continue;
      // Apply small z-tilt around base orientation. quaternion-rotate small angle
      // using module-scope scratch (no per-frame alloc).
      const ang = Math.sin(t*0.7 + i*0.9)*0.008;
      _p47TiltQ.setFromAxisAngle(_p47TiltAxis, ang);
      c.quaternion.copy(baseQ).multiply(_p47TiltQ);
    }
  }
  // Crane2 boom-arm subtle horizontal sway. Was `+=` op Math.sin wat
  // een random-walk drift gaf ipv een echte sway rond de base-rotatie;
  // we cachen nu de base-rotation en schrijven absoluut.
  if(_p47Crane2){
    if(_p47Crane2.userData._baseRotY===undefined) _p47Crane2.userData._baseRotY = _p47Crane2.rotation.y;
    _p47Crane2.rotation.y = _p47Crane2.userData._baseRotY + _p47Sin(t*0.3)*0.018;
  }
  // Sodium-lamp emissive flicker is now driven by updateCinematic()
  // via _cinemaState.lightPoles — see js/effects/cinematic.js. The legacy
  // _p47LampEmissives loop has been removed (cinematic lamps do not
  // populate this array). The reset in scene.js is harmless (drains an
  // empty array on world-switch).
  // Drizzle particle pool — 3D depth-tested rain streaks. Particles fall
  // straight down at ~12u/s with a slight wind-drift on X (motregen often
  // has a horizontal component from harbour wind). When a particle drops
  // below ground OR drifts > 130u from the player it respawns above the
  // player at random X/Z within the active volume — the pool effectively
  // tracks the player without per-frame allocations.
  // Drizzle + fog patches: stagger om-de-andere-frame op mobile met dt*2
  // compensatie — rain-fall snelheid blijft visueel identiek, halveert load.
  if(!(_M && (_p47Frame & 1))){
    const _dDt = _M ? dt*2 : dt;
    if(_p47DrizzleGeo){
      const car=carObjs&&carObjs[playerIdx];
      const cx=car?car.mesh.position.x:0;
      const cz=car?car.mesh.position.z:0;
      const arr=_p47DrizzleGeo.attributes.position.array;
      const n=arr.length/3|0;
      // Rolling-buffer update — process ~60/frame so a 340-particle pool
      // recycles fully every ~6 frames at 60fps. Mirrors the volcano-ember
      // / sandstorm-fleck pattern.
      const step=(Math.floor(t*40)*60)%n;
      const end=Math.min(step+60,n);
      for(let i=step;i<end;i++){
        // Rain velocity — ~12u/s downward + ~2u/s horizontal drift
        arr[i*3]   += _dDt*2.0;
        arr[i*3+1] -= _dDt*12.0;
        // Respawn condition: hit ground OR drifted outside follow-volume
        if(arr[i*3+1]<-0.5
           || arr[i*3]   > cx+130 || arr[i*3]   < cx-130
           || arr[i*3+2] > cz+130 || arr[i*3+2] < cz-130){
          arr[i*3]   = cx + (Math.random()-0.5)*220;
          arr[i*3+1] = 22 + Math.random()*10;
          arr[i*3+2] = cz + (Math.random()-0.5)*220;
        }
      }
      _p47DrizzleGeo.attributes.position.needsUpdate=true;
    }
    // ── Phase 10.8 — fog-patch drift + wrap-around camera ───────────────
    if(_p47FogPatches.length && typeof camera !== 'undefined' && camera){
      const _vMul = _M ? 2 : 1;
      for(let _fi=0; _fi<_p47FogPatches.length; _fi++){
        const f = _p47FogPatches[_fi];
        f.position.x += f.userData.vx * _vMul;
        f.position.z += f.userData.vz * _vMul;
        const dx = f.position.x - camera.position.x;
        const dz = f.position.z - camera.position.z;
        if(dx*dx + dz*dz > 200*200){
          const ang = Math.random() * Math.PI * 2;
          f.position.x = camera.position.x + Math.cos(ang) * 120;
          f.position.z = camera.position.z + Math.sin(ang) * 120;
        }
      }
    }
  }
}
