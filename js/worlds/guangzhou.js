// js/worlds/guangzhou.js — Guangzhou Cinematic (V1 of 4, foundation).
// Non-module script. Sessie history:
//   sessie 1 (this) — world registration + skybox + ground + lighting +
//                     Canton Tower silhouette + cinematic helpers wired.
//   sessie 2 (planned) — track props, drizzle particles, window emissives.
//   sessie 3 (planned) — lap-progressive lighting, Canton Tower emissive shifts.
//   sessie 4 (planned) — audio, weather, polish.
//   V3.5 visibility patch — fog:false confirmed on all V3 emissives (pre-existing),
//                           spires two-ring r=220+320, banners closer+bigger,
//                           Canton Tower z=-180 + 2x halo, street neon strips,
//                           fog density 0.010 → 0.0075.
//
// Visual direction: Guangzhou CBD at night — wet dark asphalt reflecting
// neon/magenta/cyan, Canton Tower as hero beacon, low ground mist over
// the Pearl River.
//
// ── Track-waypoints (data/tracks.json#guangzhou) ─────────────────────────
// V1 copies pier47 waypoints as starting basis (12 WPs, counter-clockwise
// loop, bbox ~440×405). V2 will hand-tune for Guangzhou's wider boulevard
// geometry. Documented autonomous decision per spec §Process rules.
//
// ── Cinematic API corrections (bug-verifier pre-audit, 2026-05-10) ─────────
// B5: buildCinematicGroundFog has no `topColor` opt — single flat color only.
// B6: buildCinematicLightPole uses `color` (NOT `headColor`), `working` NOT `broken`,
//     `tilt` is radians NOT boolean — no `coneIntensity`/`coneSpread`/`mastColor`.
// B7: enableCinematicCameraShake uses `intensityScale` NOT `intensity`, no `freq`.
// B8: buildCinematicGroundFog mobile clamps layerCount to 1.
// C14: _SILHOUETTE_PALETTES schema is flat arrays, no windowEmissive/windowDensity.
// D20: wNames does NOT exist — only wIcons + wNames2 updated in select.js.

'use strict';

// ── Per-world animated state ─────────────────────────────────────────────
// Drained on world-switch via core/scene.js disposeScene() traversal.
// V1: no active animations; V2 will add drizzle + window-flicker refs here.
let _gzDisposables = [];  // meshes / lights to explicit-dispose on world-switch
let _gzNextThunder = 0;   // Phase 10.3c — next thunder-flash trigger time
let _gzDrizzleGeo = null;   // BufferGeometry for drizzle particle pool
let _gzDrizzle    = null;   // THREE.Points mesh
let _gzGuardrailMesh = null;   // InstancedMesh for boulevard guardrails
let _gzBillboards = [];   // billboard mesh refs (for future animation hooks)
let _gzWindowGroups = [];  // [{mat: MeshBasicMaterial, phase: number, baseOpacity: number}]
let _gzHeroBillboardMats = [];  // V4 Phase C: animated billboard materials (UV-offset per frame)
let _gzHeroBillboards = [];     // Phase 10.7 — billboard mesh refs (positions) for spark showers
let _gzNextSpark = 0;           // Phase 10.7 — next neon-spark shower trigger time
let _gzFlyingCars = [];         // V4 Phase D: per-instance {x, yPos, zPos, speed, dir}
let _gzFlyingCarsBody = null;   // InstancedMesh of V4 flying-car bodies
let _gzFlyingCarsLights = null; // InstancedMesh of V4 rear-lights
let _gzOverheadFlock = [];      // V4.1: per-instance {x, yPos, zPos, speed, dir}
let _gzOverheadFlockBody = null;
let _gzOverheadFlockLights = null;
let _gzCrossFlock = [];         // V4.2: per-instance {x, yPos, zPos, speed, dir, anchorX, anchorZ, perpX, perpZ}
let _gzCrossFlockBody = null;
let _gzCrossFlockLights = null;
let _gzDroneFlock = [];         // V4.3: per-instance {anchorX, anchorZ, baseY, phase, speed, orbitR}
let _gzDroneFlockIM = null;     // InstancedMesh for drone glow planes
let _gzLightTex = null;         // shared white radial-gradient texture for all flying-car / drone lights
let _gzGroundTraffic = null;    // V4.4: InstancedMesh of civilian cars driving along trackCurve
let _gzGroundTrafficData = [];  // V4.4: per-instance {tBase, lateral, dir, speed} for traffic anim
let _gzHeadlampPool = null;     // V5.2: soft elliptical light pool that follows the player car
let _gzHighway = null;          // V5 Phase C: InstancedMesh of overhead highway car bodies
let _gzHighwayLights = null;    // V5 Phase C: InstancedMesh of overhead highway rear-lights
let _gzHighwayData = [];        // V5 Phase C: per-instance {tBase, lateral, dir, speed, yPos}

// Frame-tick voor per-frame throttling van zware update-paths. Increment in
// updateGuangzhouWorld(). Gedeeld door window-flicker round-robin, highway
// alternate-frame, jellyfish-tentakels half-rate en billboard color pulse.
let _gzFrameTick = 0;
let _gzWindowFlickerOffset = 0;

function _gzGetLightTex(){
  if(_gzLightTex) return _gzLightTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0,    'rgba(255,255,255,1.00)');
  gr.addColorStop(0.3,  'rgba(255,255,255,0.85)');
  gr.addColorStop(1,    'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  _gzLightTex = new THREE.CanvasTexture(c);
  _gzDisposables.push(_gzLightTex);
  return _gzLightTex;
}

// ── Palette pin ──────────────────────────────────────────────────────────
//
// Single-source hex constants. Over-saturated by design — .cinematicCard
// applies filter:saturate(.55) in the world-select card so these need to
// be vivid to survive the desaturation.
const _GZ_PALETTE = {
  asphalt:       0x0a0c12,   // near-black wet asphalt
  neonMagenta:   0xff2080,   // primary neon — kerb emissive, kerbA
  neonCyan:      0x00e0ff,   // secondary neon — kerbB emissive, gantry
  lampCyan:      0x40c8ff,   // lamp poles — cool cyan-white street light
  fogBase:       0x0e0c1a,   // ground fog & scene fog color
  fogHorizon:    0x1a1228,   // horizon skybox foot-band
  zenithDark:    0x040408,   // near-black zenith
  horizonGlow:   0x1a0a28,   // deep purple horizon
  cityGlowMag:   0x5a1040,   // city glow hotspot (magenta-purple)
  cityGlowCyan:  0x082840,   // secondary city glow (teal)
  skylineFar:    0x0a0814,   // far silhouette
  skylineNear:   0x0e0a18,   // near silhouette
};

// ── Day-lighting helper (P3) ──────────────────────────────────────────────
//
// "Day" for Guangzhou Cinematic is still night-like by design — wet-neon
// streets are never bright. The M-toggle will swap skybox; lighting delta
// is subtle (matching pier47's "both modes dark" pattern).
//
// Goal palette:
//   sun     cool blue-grey #5a6878 / 0.25 desktop / 0.18 mobile
//   ambient near-black with purple trace #0a0814 / 0.12
//   hemi    sky #4a4860 / ground #1a1428 / 0.16
//
// Mobile sun caps at 0.18 (vs 0.25 desktop) — no shadows on mobile means
// even dim directional light risks washing the dark scene.
function _applyGuangzhouDayLighting(){
  if(!sunLight||!ambientLight||!hemiLight)return;
  sunLight.color.setHex(0x5a6878);
  sunLight.intensity = window._isMobile ? 0.18 : 0.25;
  sunLight.position.set(50, 120, 70);
  ambientLight.color.setHex(0x0a0814); ambientLight.intensity = 0.12;
  hemiLight.color.setHex(0x4a4860);
  hemiLight.groundColor.setHex(0x1a1428);
  hemiLight.intensity = 0.16;
  // PBR-upgrade Brok 1b: per-wereld ambient/hemi-mul knop. Default 1.0.
  const _v=(typeof window.getWorldVisuals==='function')?window.getWorldVisuals(activeWorld):null;
  if(_v){ ambientLight.intensity*=_v.ambientMul; hemiLight.intensity*=_v.hemiMul; }
}
// Expose to non-module consumers — night.js reads from window.* scope.
if(typeof window!=='undefined') window._applyGuangzhouDayLighting = _applyGuangzhouDayLighting;

// ── Hovercar geometry helper ─────────────────────────────────────────────
//
// Compound BufferGeometry used by all four flying-car builders (high-
// altitude / overhead-flock / cross-flock / overhead-highway). One
// merged geometry per call so InstancedMesh stays at 1 draw call.
//
// Parts (all wound CCW from outside so computeVertexNormals returns
// outward-facing normals — required by the Lambert-lit CrossFlock):
//   • Hull — tapered prism, 8 verts / 12 tris. Narrow nose, wider belly,
//     cabin top shrunk and shifted forward (sled-shape).
//   • Cockpit dome — 4-sided pyramid on top of the cabin, 5 verts /
//     4 tris. Peak above the cabin centre, slight forward lean.
//   • Twin thruster cones — short 4-sided cones poking out behind the
//     hull, 5 verts + 4 tris each (10 / 8 total). Reads as engine
//     nozzles from any side angle.
//
// Total per instance: 23 vertices / 24 triangles — roughly 2× a box
// geometrically, still cheap for InstancedMesh.
//
// Local axis convention:  +x = forward (nose)   +y = up   +z = right
function _gzMakeHovercarGeometry(L, H, W){
  const hL = L * 0.5;
  const hW = W * 0.5;
  // ── Hull (8 verts) ──
  const verts = [
    // 0-3: belly
     hL, 0,  hW * 0.8,   // 0  nose-right
     hL, 0, -hW * 0.8,   // 1  nose-left
    -hL, 0, -hW,         // 2  tail-left
    -hL, 0,  hW,         // 3  tail-right
    // 4-7: cabin top — narrower, shifted forward, lower at the back
     hL * 0.45,  H,         hW * 0.30,  // 4
     hL * 0.45,  H,        -hW * 0.30,  // 5
    -hL * 0.65,  H * 0.65, -hW * 0.55,  // 6
    -hL * 0.65,  H * 0.65,  hW * 0.55,  // 7
    // ── Cockpit dome (5 verts: 4 base + 1 peak) ──
    // Base sits inside the cabin top at H*0.95 (just above cabin roof);
    // peak at H*1.7, leaned slightly forward.
     hL * 0.30,  H * 0.95,  hW * 0.22,  // 8  base nose-right
     hL * 0.30,  H * 0.95, -hW * 0.22,  // 9  base nose-left
    -hL * 0.45,  H * 0.95, -hW * 0.40,  // 10 base tail-left
    -hL * 0.45,  H * 0.95,  hW * 0.40,  // 11 base tail-right
    -hL * 0.05,  H * 1.7,   0,          // 12 dome peak
    // ── Right thruster cone (5 verts) ──
    // Base in the tail-right quadrant, tip protruding backward (-x).
    -hL * 0.55,  H * 0.20,  hW * 0.55,  // 13 base front-top
    -hL * 0.55,  H * 0.20,  hW * 0.85,  // 14 base front-bot
    -hL * 0.85, -H * 0.10,  hW * 0.85,  // 15 base rear-bot
    -hL * 0.85, -H * 0.10,  hW * 0.55,  // 16 base rear-top
    -hL * 1.15,  H * 0.05,  hW * 0.70,  // 17 tip
    // ── Left thruster cone (5 verts) ── mirror of right
    -hL * 0.55,  H * 0.20, -hW * 0.55,  // 18
    -hL * 0.55,  H * 0.20, -hW * 0.85,  // 19
    -hL * 0.85, -H * 0.10, -hW * 0.85,  // 20
    -hL * 0.85, -H * 0.10, -hW * 0.55,  // 21
    -hL * 1.15,  H * 0.05, -hW * 0.70,  // 22
  ];
  const idx = [
    // ── Hull ──
    // belly (outward normal = -y)
    0, 2, 1,   0, 3, 2,
    // cabin roof (outward normal = +y)
    4, 6, 7,   4, 5, 6,
    // nose face (outward normal = +x)
    0, 5, 4,   0, 1, 5,
    // tail face (outward normal = -x)
    2, 7, 6,   2, 3, 7,
    // right flank (outward normal = +z)
    0, 7, 3,   0, 4, 7,
    // left flank (outward normal = -z)
    1, 6, 5,   1, 2, 6,
    // ── Cockpit dome (4 tris) ── peak outward
    8, 12, 9,
    9, 12, 10,
    10, 12, 11,
    11, 12, 8,
    // ── Right thruster (4 tris) ── all flanks point outward, tip is -x
    13, 17, 14,
    14, 17, 15,
    15, 17, 16,
    16, 17, 13,
    // ── Left thruster (4 tris) ── mirrored winding so normals stay outward
    18, 19, 22,
    19, 20, 22,
    20, 21, 22,
    21, 18, 22,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ── Ground car geometry helper ───────────────────────────────────────────
//
// Sedan-style silhouette for the civilian _gzBuildGroundTraffic flock.
// Owner feedback: the previous BoxGeometry made them read as "blokjes
// langs schuif bewegen" on the road. Two-tier shape (chassis + cabin
// pulled toward the rear) gives the silhouette a clear front / back.
//
// Single merged BufferGeometry: 16 vertices / 28 triangles. Used by
// InstancedMesh so per-car cost is still 1 DC total.
//
// Local axes match the previous BoxGeometry:
//   +x = forward (bonnet)   +y = up   +z = right
function _gzMakeGroundCarGeometry(L, H, W){
  const hL = L * 0.5;
  const hW = W * 0.5;
  // Chassis sits y=0..H*0.45 (lower half of car). Cabin sits
  // y=H*0.45..H, narrower and pulled toward the rear (suggests engine
  // bay at front, passenger cabin behind).
  const chL = hL;
  const cabF =  hL * 0.10;   // cabin front edge x
  const cabB = -hL * 0.85;   // cabin back edge x
  const cabW = hW * 0.65;
  const chH = H * 0.45;
  const verts = [
    // 0-3 chassis bottom (full footprint, slight nose taper)
     chL, 0,  hW * 0.85,  // 0
     chL, 0, -hW * 0.85,  // 1
    -chL, 0, -hW,         // 2
    -chL, 0,  hW,         // 3
    // 4-7 chassis top (matches bottom outline at chH)
     chL, chH,  hW * 0.85,  // 4
     chL, chH, -hW * 0.85,  // 5
    -chL, chH, -hW,         // 6
    -chL, chH,  hW,         // 7
    // 8-11 cabin bottom (sits on chassis top, narrower + shorter)
     cabF, chH,  cabW,   // 8
     cabF, chH, -cabW,   // 9
     cabB, chH, -cabW,   // 10
     cabB, chH,  cabW,   // 11
    // 12-15 cabin roof (slight inward taper for a windscreen rake)
     cabF * 0.9, H,  cabW * 0.85,  // 12
     cabF * 0.9, H, -cabW * 0.85,  // 13
     cabB * 0.95, H, -cabW * 0.85, // 14
     cabB * 0.95, H,  cabW * 0.85, // 15
  ];
  const idx = [
    // chassis belly (-y outward)
    0, 2, 1,   0, 3, 2,
    // chassis nose (+x)
    0, 5, 4,   0, 1, 5,
    // chassis tail (-x)
    2, 7, 6,   2, 3, 7,
    // chassis right flank (+z)
    0, 7, 3,   0, 4, 7,
    // chassis left flank (-z)
    1, 6, 5,   1, 2, 6,
    // bonnet / boot (top of chassis OUTSIDE the cabin footprint).
    // Split into ribbons in front of and behind the cabin so cabin
    // base fits inside. Front ribbon: between chassis-front edge 4-5
    // and cabin front edge 8-9.
    4, 9, 8,   4, 5, 9,
    // Rear ribbon: between cabin back edge 10-11 and chassis back 6-7.
    11, 10, 6,   11, 6, 7,
    // Cabin nose face (+x)
    8, 13, 12,  8, 9, 13,
    // Cabin tail face (-x)
    10, 15, 14, 10, 11, 15,
    // Cabin right flank (+z)
    8, 15, 11,  8, 12, 15,
    // Cabin left flank (-z)
    9, 14, 13,  9, 10, 14,
    // Cabin roof (+y)
    12, 14, 15, 12, 13, 14,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ── Skybox builders (canvas-baked) ────────────────────────────────────────
//
// Day skybox: Guangzhou overcast night — near-black zenith bleeding through
// deep purple to a neon-magenta/cyan city-glow horizon. No visible stars;
// light pollution masks them. Two hotspot glows (magenta left, cyan right)
// suggest distant Pearl River bridge illumination and the Canton Tower beacon.
//
// Painted onto shared 1024×512 canvas via _newSkyCanvas.
// Mobile auto-halves to 512×256 in _newSkyCanvas.
function makeGuangzhouSkyTex(){
  const {c,g} = _newSkyCanvas('#040408','#0e0a18');
  // Horizon city-glow band (~rows 280-400)
  const horiz = g.createLinearGradient(0, 280, 0, 400);
  horiz.addColorStop(0,   'rgba(26,18,40,0)');
  horiz.addColorStop(0.5, 'rgba(36,14,50,0.70)');
  horiz.addColorStop(1,   'rgba(30,12,44,0.90)');
  g.fillStyle = horiz; g.fillRect(0, 280, 1024, 120);
  // Foot-band — Issue 6: bottom color matches baseline fog setRGB(0.10,0.06,0.18)=#1a0f2d
  // so skybox horizon seam is invisible when fog is not flashing.
  const foot = g.createLinearGradient(0, 400, 0, 512);
  foot.addColorStop(0, 'rgba(30,12,44,0.90)');
  foot.addColorStop(1, 'rgba(26,15,45,1)');
  g.fillStyle = foot; g.fillRect(0, 400, 1024, 112);
  // Magenta city-glow hotspot left (Pearl River side)
  const glowMag = g.createRadialGradient(280, 430, 0, 280, 430, 260);
  glowMag.addColorStop(0,   'rgba(200,40,120,0.50)');
  glowMag.addColorStop(0.4, 'rgba(140,20,80,0.25)');
  glowMag.addColorStop(1,   'rgba(80,10,40,0)');
  g.fillStyle = glowMag; g.fillRect(20, 200, 520, 312);
  // Cyan city-glow hotspot right (Canton Tower direction)
  const glowCyn = g.createRadialGradient(740, 420, 0, 740, 420, 220);
  glowCyn.addColorStop(0,   'rgba(20,120,200,0.45)');
  glowCyn.addColorStop(0.4, 'rgba(10,80,140,0.22)');
  glowCyn.addColorStop(1,   'rgba(5,40,80,0)');
  g.fillStyle = glowCyn; g.fillRect(520, 200, 504, 312);
  // Cloud cover blobs (city light pollution hazes through them)
  for(let i = 0; i < 16; i++){
    const x = Math.random()*1024, y = 300 + Math.random()*70;
    const r = 80 + Math.random()*120;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0,   'rgba(22,16,36,0.48)');
    grd.addColorStop(0.6, 'rgba(18,12,28,0.20)');
    grd.addColorStop(1,   'rgba(18,12,28,0)');
    g.fillStyle = grd; g.fillRect(x-r, y-r, r*2, r*2);
  }
  // Issue 5: dither pass to break gradient banding. ±2 per-channel noise.
  { const w=c.width,h=c.height;
    const id=g.getImageData(0,0,w,h);
    for(let i=0;i<id.data.length;i+=4){
      const noise=(Math.random()-0.5)*4;
      id.data[i]  =Math.max(0,Math.min(255,id.data[i]  +noise));
      id.data[i+1]=Math.max(0,Math.min(255,id.data[i+1]+noise));
      id.data[i+2]=Math.max(0,Math.min(255,id.data[i+2]+noise));
    }
    g.putImageData(id,0,0);
  }
  return _skyTexFromCanvas(c);
}

// Night skybox: slightly darker, cloud cover thickens, city glow persists.
// Same overall composition — Guangzhou never truly goes dark.
function makeGuangzhouNightSkyTex(){
  const {c,g} = _newSkyCanvas('#020206','#08060e');
  const horiz = g.createLinearGradient(0, 280, 0, 400);
  horiz.addColorStop(0,   'rgba(18,10,30,0)');
  horiz.addColorStop(0.5, 'rgba(28,10,42,0.75)');
  horiz.addColorStop(1,   'rgba(24,8,36,0.92)');
  g.fillStyle = horiz; g.fillRect(0, 280, 1024, 120);
  // Issue 6: bottom color matches baseline fog #1a0f2d (night version slightly darker but same hue)
  const foot = g.createLinearGradient(0, 400, 0, 512);
  foot.addColorStop(0, 'rgba(24,8,36,0.92)');
  foot.addColorStop(1, 'rgba(26,15,45,1)');
  g.fillStyle = foot; g.fillRect(0, 400, 1024, 112);
  // Stronger glows at night — city lights cut through cloud more readily
  const glowMag = g.createRadialGradient(280, 430, 0, 280, 430, 280);
  glowMag.addColorStop(0,   'rgba(220,50,130,0.60)');
  glowMag.addColorStop(0.4, 'rgba(160,28,90,0.30)');
  glowMag.addColorStop(1,   'rgba(80,10,40,0)');
  g.fillStyle = glowMag; g.fillRect(0, 180, 560, 332);
  const glowCyn = g.createRadialGradient(740, 420, 0, 740, 420, 240);
  glowCyn.addColorStop(0,   'rgba(24,140,220,0.55)');
  glowCyn.addColorStop(0.4, 'rgba(14,90,160,0.28)');
  glowCyn.addColorStop(1,   'rgba(5,40,80,0)');
  g.fillStyle = glowCyn; g.fillRect(500, 180, 524, 332);
  // Thicker cloud cover for night
  for(let i = 0; i < 20; i++){
    const x = Math.random()*1024, y = 290 + Math.random()*90;
    const r = 90 + Math.random()*140;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0,   'rgba(16,10,24,0.58)');
    grd.addColorStop(0.6, 'rgba(12,8,18,0.24)');
    grd.addColorStop(1,   'rgba(12,8,18,0)');
    g.fillStyle = grd; g.fillRect(x-r, y-r, r*2, r*2);
  }
  // Issue 5: dither pass to break gradient banding. ±2 per-channel noise.
  { const w=c.width,h=c.height;
    const id=g.getImageData(0,0,w,h);
    for(let i=0;i<id.data.length;i+=4){
      const noise=(Math.random()-0.5)*4;
      id.data[i]  =Math.max(0,Math.min(255,id.data[i]  +noise));
      id.data[i+1]=Math.max(0,Math.min(255,id.data[i+1]+noise));
      id.data[i+2]=Math.max(0,Math.min(255,id.data[i+2]+noise));
    }
    g.putImageData(id,0,0);
  }
  return _skyTexFromCanvas(c);
}

// ── Procedural ground texture (wet dark asphalt) ──────────────────────────
//
// Wet asphalt #0a0c12 with subtle reflectance speckles — suggests puddles
// catching the neon overhead without a full PBR wet-surface pass.
function _gzGroundTex(){
  const S = 256, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  // Base wet-dark asphalt
  g.fillStyle = '#0a0c12'; g.fillRect(0, 0, S, S);
  // Per-pixel grain — very dark range (8..16) with blue-shift
  const id = g.getImageData(0, 0, S, S), d = id.data;
  for(let i = 0; i < d.length; i += 4){
    const n = (8 + (Math.random()*8)|0);
    d[i]   = n;        // R
    d[i+1] = n;        // G
    d[i+2] = n + 4;    // B — slight blue-shift for wet look
    d[i+3] = 255;
  }
  g.putImageData(id, 0, 0);
  // Reflectance speckles — small bright dots simulating neon-puddle glints.
  // Issue 10 (V5.3): added intermediate color-stop at 0.55 for softer falloff —
  // was a 2-stop hard mask that looked like stamped circles on the asphalt.
  // Magenta speckles
  for(let i = 0; i < 12; i++){
    const x = Math.random()*S, y = Math.random()*S, r = 2+Math.random()*5;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0,    'rgba(255,32,128,0.30)');
    grd.addColorStop(0.55, 'rgba(255,32,128,0.10)');
    grd.addColorStop(1,    'rgba(255,32,128,0)');
    g.fillStyle = grd; g.fillRect(x-r, y-r, r*2, r*2);
  }
  // Cyan speckles
  for(let i = 0; i < 10; i++){
    const x = Math.random()*S, y = Math.random()*S, r = 2+Math.random()*4;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0,    'rgba(0,220,255,0.25)');
    grd.addColorStop(0.55, 'rgba(0,220,255,0.08)');
    grd.addColorStop(1,    'rgba(0,220,255,0)');
    g.fillStyle = grd; g.fillRect(x-r, y-r, r*2, r*2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(40, 40);
  t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

// ── Canton Tower silhouette ───────────────────────────────────────────────
//
// Hyperboloid silhouette of the Guangzhou Canton Tower (~600m in reality —
// scaled to ~280u game-units). 24 vertical sinusoidal curves (12 mobile)
// forming the characteristic "waist" hourglass at ~60% height. Uses
// BufferGeometry LineSegments + LineBasicMaterial (silhouette grey, 0.35
// opacity) — simplest geometry that renders the distinctive outline.
//
// Geometry: each curve is approximated as SEGS=48 line segments along Y.
// X/Z of each point = R(y) * cos/sin(angle_i + twist(y)), where
//   R(y) = base_radius * (1 + waist_factor * sin(π * y/H))
//   twist(y) = twist_total * y/H
// This gives the hyperboloid's characteristic neck + counter-rotation.
//
// Top antenna stub: a thin 24u cylinder above the main body.
// Top light: red PointLight on desktop, sprite halo on mobile (budget).
//
// Positioned ~400u from grid in -Z direction (behind starting line, visible
// from all sectors of the track on the Guangzhou layout).
function _gzBuildCantonTower(scene){
  if(typeof THREE === 'undefined') return;
  // Sessie 06a — fresh build clears the lap-progressive material ref list.
  window._gzCantonMats = [];
  const mob = !!window._isMobile;
  const CURVES = mob ? 12 : 24;    // vertical sinusoidal curves
  const SEGS   = mob ? 28 : 48;    // segments per curve
  const H      = 280;              // tower height (game units)
  const BASE_R = 24;               // base/top radius
  const WAIST_R= 7.2;              // waist (neck) radius at 60% height
  // Hyperboloid shape: R(t) = waist + (BASE_R - waist) * sin(π * t) parabola
  // but skewed so minimum is at t=0.6 (60% up = 168u)
  const TWIST  = Math.PI * 0.55;   // total rotation from base to top (radians)
  // Position: V3.5 moved closer from z=-260 to z=-180 for larger screen-space presence
  const TOWER_X = 0;
  const TOWER_Z = -180;
  const TOWER_Y = 0;    // base at ground level

  // Build vertex array for all curves
  const totalVerts = CURVES * SEGS * 2;  // 2 verts per segment (LineSegments)
  const positions = new Float32Array(totalVerts * 3);
  let vi = 0;

  // Shape function: radius at normalized height t (0=base, 1=top)
  function R(t){
    // Skewed sin — minimum at t=0.6
    // Use a composite: linearly interpolate between base and waist going
    // down to t=0.6, then back up from waist to base at t=1.
    const waistT = 0.60;
    if(t <= waistT){
      const s = t / waistT; // 0..1 within the lower section
      // Smooth hermite blend
      return WAIST_R + (BASE_R - WAIST_R) * (1 - (3*s*s - 2*s*s*s));
    } else {
      const s = (t - waistT) / (1 - waistT);
      return WAIST_R + (BASE_R - WAIST_R) * (3*s*s - 2*s*s*s);
    }
  }

  for(let ci = 0; ci < CURVES; ci++){
    const baseAngle = (ci / CURVES) * Math.PI * 2;
    for(let si = 0; si < SEGS; si++){
      const t0 = si / SEGS;
      const t1 = (si + 1) / SEGS;
      const y0 = TOWER_Y + t0 * H;
      const y1 = TOWER_Y + t1 * H;
      const r0 = R(t0);
      const r1 = R(t1);
      const twist0 = baseAngle + TWIST * t0;
      const twist1 = baseAngle + TWIST * t1;
      // v0
      positions[vi++] = TOWER_X + r0 * Math.cos(twist0);
      positions[vi++] = y0;
      positions[vi++] = TOWER_Z + r0 * Math.sin(twist0);
      // v1
      positions[vi++] = TOWER_X + r1 * Math.cos(twist1);
      positions[vi++] = y1;
      positions[vi++] = TOWER_Z + r1 * Math.sin(twist1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xff2080,
    transparent: true,
    opacity: 0.55,  // V3.5: reduced from 0.70 — tower is now closer (z=-180) so it's larger in screen-space
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const tower = new THREE.LineSegments(geo, mat);
  scene.add(tower);
  if(window._freezeMatrix)window._freezeMatrix(tower);
  _gzDisposables.push(tower);
  // Sessie 06a V3 — track tower + antenna mats so update can ramp
  // emissive opacity per-lap. baseOpacity captured for restoration.
  if(!window._gzCantonMats) window._gzCantonMats = [];
  window._gzCantonMats.push({ mat, baseOpacity: mat.opacity });

  // Antenna stub on top — thin cylinder 24u tall
  const antennaGeo = new THREE.CylinderGeometry(0.5, 1.2, 24, mob?4:6);
  const antennaMat = new THREE.MeshBasicMaterial({ color: 0xff4090, transparent:true, opacity:0.75, blending: THREE.AdditiveBlending });
  const antenna = new THREE.Mesh(antennaGeo, antennaMat);
  antenna.position.set(TOWER_X, TOWER_Y + H + 12, TOWER_Z);
  scene.add(antenna);
  if(window._freezeMatrix)window._freezeMatrix(antenna);
  _gzDisposables.push(antenna);
  if(!window._gzCantonMats) window._gzCantonMats = [];
  window._gzCantonMats.push({ mat: antennaMat, baseOpacity: antennaMat.opacity });

  // Top light — desktop: red PointLight, mobile: sprite halo only
  if(!mob){
    const topLight = new THREE.PointLight(0xff2040, 0.8, 80);
    topLight.position.set(TOWER_X, TOWER_Y + H + 24, TOWER_Z);
    scene.add(topLight);
    _gzDisposables.push(topLight);
  } else {
    // Sprite halo — cheap on mobile
    const haloC = document.createElement('canvas'); haloC.width = 64; haloC.height = 64;
    const haloG = haloC.getContext('2d');
    const gr = haloG.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0,   'rgba(255,40,64,0.9)');
    gr.addColorStop(0.4, 'rgba(255,20,40,0.4)');
    gr.addColorStop(1,   'rgba(255,20,40,0)');
    haloG.fillStyle = gr; haloG.fillRect(0, 0, 64, 64);
    const haloTex = new THREE.CanvasTexture(haloC);
    const haloMat = new THREE.SpriteMaterial({
      map: haloTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false  // halo IS the mobile beacon — fog at z=-260 (density 0.010) would hide it (~0.1% visible)
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(8, 8, 1);
    halo.position.set(TOWER_X, TOWER_Y + H + 24, TOWER_Z);
    scene.add(halo);
    _gzDisposables.push(halo);
  }

  // Radial halo sprite — large magenta glow behind the tower.
  // PlaneGeometry would require facing logic; Sprite auto-faces camera.
  // V3.5: doubled from 90×120 → 180×240 (tower is now at z=-180, larger screen presence).
  const haloSize = mob ? 140 : 180;
  const hC = document.createElement('canvas'); hC.width = 128; hC.height = 160;
  const hG = hC.getContext('2d');
  const hGr = hG.createRadialGradient(64, 80, 0, 64, 80, 80);
  hGr.addColorStop(0,   'rgba(255,32,128,0.70)');
  hGr.addColorStop(0.35,'rgba(200,20,100,0.35)');
  hGr.addColorStop(0.70,'rgba(150,10,70,0.12)');
  hGr.addColorStop(1.0, 'rgba(100,0,50,0)');
  hG.fillStyle = hGr; hG.fillRect(0, 0, 128, 160);
  const haloTower = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(hC),
    color: 0xffffff,
    transparent: true,
    opacity: 0.80,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false
  }));
  haloTower.scale.set(haloSize, haloSize * 1.33, 1);
  haloTower.position.set(TOWER_X, TOWER_Y + H * 0.5, TOWER_Z + 2); // +2 so it's slightly in front of the lines
  haloTower.renderOrder = -7;
  scene.add(haloTower);
  if(window._freezeMatrix)window._freezeMatrix(haloTower);
  _gzDisposables.push(haloTower);
}

// ── Cinematic lamp poles along the boulevard ──────────────────────────────
//
// Cool cyan-white street lamps — contrast with the neon-magenta/cyan
// kerb palette. 18 desktop / 12 mobile pole-pairs along the track curve.
// ~10% broken, ~10% tilted. Pattern mirrors pier47's _p47BuildCinematicLamps.
function _gzBuildCinematicLamps(){
  if(typeof buildCinematicLightPole !== 'function') return;
  const mob = window._isMobile;
  const COUNT = mob ? 12 : 18;
  const TILT_FRAC   = 0.10;
  const BROKEN_FRAC = 0.10;
  const rng = (i) => { const x = Math.sin(i * 17.841 + 43.921) * 53211.7193; return x - Math.floor(x); };
  for(let i = 0; i < COUNT; i++){
    const t = i / COUNT;
    const p   = trackCurve.getPoint(t);
    const tg  = trackCurve.getTangent(t).normalize();
    const nr  = new THREE.Vector3(-tg.z, 0, tg.x);
    const ang = Math.atan2(tg.x, tg.z);
    [-1, 1].forEach((side, sIdx) => {
      const seed = i * 2 + sIdx;
      const off  = BARRIER_OFF + 2.4;
      const px   = p.x + nr.x * side * off;
      const pz   = p.z + nr.z * side * off;
      const isTilted  = rng(seed) < TILT_FRAC;
      const isBroken  = rng(seed + 0.5) < BROKEN_FRAC;
      const facingY   = (side === 1) ? ang + Math.PI / 2 : ang - Math.PI / 2;
      buildCinematicLightPole(scene, new THREE.Vector3(px, 0, pz), {
        color:              0x40c8ff,   // cool cyan-white
        intensity:          1.4,
        range:              26,
        height:             8.8,
        armLength:          1.4,
        poolRadius:         11,
        working:            !isBroken,
        tilt:               isTilted ? ((rng(seed + 0.7) - 0.5) * 0.08) : 0,
        facingY:            facingY,
        castGroundPool:     true,
        castVolumetricCone: true,
        castHalo:           true
      });
    });
  }
}

// ── Distant blink markers ─────────────────────────────────────────────────
//
// Aviation + building warning lights on the horizon. Suggest the dense
// CBD skyline behind the visible track section.
// Desktop: 8 markers, mobile: 4.
function _gzBuildDistantMarkers(){
  if(typeof buildCinematicBlinkingMarker !== 'function') return;
  const mob = window._isMobile;
  // Red slow-pulse aviation lights on distant towers
  const redPositions = [
    new THREE.Vector3( 300,  85,  240),
    new THREE.Vector3(-320,  96,  200),
    new THREE.Vector3( 240,  90, -280),
  ];
  const redUsed = mob ? 2 : 3;
  for(let i = 0; i < redUsed; i++){
    buildCinematicBlinkingMarker(scene, redPositions[i], {
      color:         0xff2040,
      pattern:       'slow-pulse',
      blinkInterval: 2.2 + i * 0.35,
      intensity:     1.3,
      range:         60,
      haloSize:      4.0,
      includeLight:  false
    });
  }
  if(!mob){
    // Cyan fast-pulse on a comm tower (variation)
    buildCinematicBlinkingMarker(scene, new THREE.Vector3(-200, 52, -260), {
      color:         0x00e8ff,
      pattern:       'fast-pulse',
      blinkInterval: 0.55,
      intensity:     0.8,
      range:         50,
      haloSize:      2.8,
      includeLight:  false
    });
    // Magenta morse on a rooftop antenna
    buildCinematicBlinkingMarker(scene, new THREE.Vector3( 180, 38, -210), {
      color:         0xff20a0,
      pattern:       'morse',
      blinkInterval: 5.0,
      intensity:     0.65,
      range:         30,
      haloSize:      1.8,
      includeLight:  true
    });
    // Two additional distant reds for desktop density
    buildCinematicBlinkingMarker(scene, new THREE.Vector3(-260, 110, -300), {
      color:         0xff2040,
      pattern:       'slow-pulse',
      blinkInterval: 1.8,
      intensity:     1.2,
      range:         60,
      haloSize:      3.6,
      includeLight:  false
    });
    buildCinematicBlinkingMarker(scene, new THREE.Vector3( 350, 75, -180), {
      color:         0xff2040,
      pattern:       'slow-pulse',
      blinkInterval: 2.9,
      intensity:     1.1,
      range:         60,
      haloSize:      3.4,
      includeLight:  false
    });
    // White strobe on the Canton Tower apex direction (complement to red)
    buildCinematicBlinkingMarker(scene, new THREE.Vector3(0, 310, -400), {
      color:         0xffffff,
      pattern:       'fast-pulse',
      blinkInterval: 0.3,
      intensity:     1.0,
      range:         80,
      haloSize:      3.0,
      includeLight:  false
    });
    // V4.3 — chaotic rooftop blinks across the city (desktop only).
    // Mix of fast/slow patterns + magenta/cyan/red colours for "ruk en chaotisch" feel.
    const chaosBlinks = [
      { pos: new THREE.Vector3(  90, 55,  280), color: 0xff20a0, pat: 'morse',      i: 1.4, int: 0.7, r: 35, h: 2.0 },
      { pos: new THREE.Vector3(-180, 68,  260), color: 0x00e8ff, pat: 'fast-pulse', i: 0.42,int: 0.8, r: 40, h: 2.4 },
      { pos: new THREE.Vector3( 220, 82,  120), color: 0xffd070, pat: 'slow-pulse', i: 3.1, int: 0.9, r: 42, h: 2.8 },
      { pos: new THREE.Vector3(-310, 64, -120), color: 0xff20a0, pat: 'fast-pulse', i: 0.65,int: 0.85,r: 42, h: 2.6 },
      { pos: new THREE.Vector3( 130, 48,  -50), color: 0xff2040, pat: 'fast-pulse', i: 0.85,int: 0.75,r: 38, h: 2.2 },
      { pos: new THREE.Vector3( -90, 92,   90), color: 0xffffff, pat: 'fast-pulse', i: 0.22,int: 0.95,r: 50, h: 2.4 },
    ];
    chaosBlinks.forEach(b => buildCinematicBlinkingMarker(scene, b.pos, {
      color:         b.color,
      pattern:       b.pat,
      blinkInterval: b.i,
      intensity:     b.int,
      range:         b.r,
      haloSize:      b.h,
      includeLight:  false
    }));
  } else {
    // Mobile: just one extra beyond the 2 reds
    buildCinematicBlinkingMarker(scene, new THREE.Vector3(0, 310, -400), {
      color:         0xffffff,
      pattern:       'fast-pulse',
      blinkInterval: 0.3,
      intensity:     0.9,
      range:         70,
      haloSize:      2.6,
      includeLight:  false
    });
  }
}

// ── City-glow halos on the horizon ────────────────────────────────────────
//
// Two directional glows: magenta (Pearl River district) + cyan (Canton
// Tower direction). Sprites, far away, sit at horizon level.
function _gzBuildCityGlow(){
  function makeGlowSprite(r, g, b, px, py, pz, scaleW, scaleH){
    const S = 256, c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    const cx = S*0.5, cy = S*0.68, gr = S*0.52;
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr);
    grd.addColorStop(0,    `rgba(${r},${g},${b},0.80)`);
    grd.addColorStop(0.28, `rgba(${r},${g},${b},0.40)`);
    grd.addColorStop(0.60, `rgba(${r},${g},${b},0.15)`);
    grd.addColorStop(1.0,  `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grd; ctx.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(c); tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: tex, color: 0xffffff, transparent: true,
      opacity: 0.80, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(scaleW, scaleH, 1);
    sp.position.set(px, py, pz);
    sp.renderOrder = -8;
    scene.add(sp);
    if(window._freezeMatrix)window._freezeMatrix(sp);
  }
  // Magenta glow — left/Pearl River side
  makeGlowSprite(255, 32, 128,  -360, 65, 320, 440, 300);
  // Cyan glow — right/Canton Tower direction
  makeGlowSprite(0,  200, 255,   380, 60, 280, 360, 260);
}

// ── Skyline rim lighting ──────────────────────────────────────────────────
//
// Thin emissive torus at the top edge of each silhouette cylinder. Makes
// the dark silhouette readable against the near-black night sky.
// Two meshes total — one per cylinder. Near rim hotter magenta, far cooler.
function _gzBuildSkylineRim(){
  // Near cylinder: radius 540, height 95, yBase 5 → top at y = 5 + 95 = 100
  // Far  cylinder: radius 740, height 130, yBase 12 → top at y = 12 + 130 = 142
  // Use TorusGeometry for the ring: (cylinderRadius, tubeRadius, radialSeg, tubeSeg)
  const rims = [
    { r: 540, yTop: 100, color: 0xff60a0, opacity: 0.88 },  // near — hot magenta
    { r: 740, yTop: 142, color: 0xa040a0, opacity: 0.70 },  // far  — cooler purple-magenta
  ];
  rims.forEach(spec => {
    const geo = new THREE.TorusGeometry(spec.r, 1.5, 6, 64);
    const mat = new THREE.MeshBasicMaterial({
      color:       spec.color,
      transparent: true,
      opacity:     spec.opacity,
      blending:    THREE.AdditiveBlending,
      side:        THREE.DoubleSide,
      depthWrite:  false,
      fog:         false
    });
    const rim = new THREE.Mesh(geo, mat);
    rim.position.y = spec.yTop;
    rim.rotation.x = Math.PI / 2;  // torus lies horizontal by default; rotate to be a ring in XZ
    rim.renderOrder = -9;
    scene.add(rim);
    if(window._freezeMatrix)window._freezeMatrix(rim);
    _gzDisposables.push(rim);
  });
}

// ── City glow haze planes ─────────────────────────────────────────────────
//
// Two large vertical planes just behind the near-silhouette cylinder.
// Vertical gradient: bright city-glow color at bottom → transparent at top.
// AdditiveBlending makes them add color to the dark silhouette base.
// Wires in the unused _GZ_PALETTE.cityGlowMag / cityGlowCyan keys.
function _gzBuildCityGlowHaze(){
  function makeHazePlane(hexColor, angleRad){
    const W = 180, HH = 80;
    const cvs = document.createElement('canvas');
    cvs.width = 256; cvs.height = 128;
    const ctx = cvs.getContext('2d');
    // Parse palette hex to rgb string
    const r = (hexColor >> 16) & 0xff;
    const g = (hexColor >> 8)  & 0xff;
    const b =  hexColor        & 0xff;
    const grad = ctx.createLinearGradient(0, 128, 0, 0);
    grad.addColorStop(0,    `rgba(${r},${g},${b},0.80)`);
    grad.addColorStop(0.45, `rgba(${r},${g},${b},0.35)`);
    grad.addColorStop(1.0,  `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(cvs);
    tex.needsUpdate = true;

    const geo = new THREE.PlaneGeometry(W, HH);
    const mat = new THREE.MeshBasicMaterial({
      map:         tex,
      transparent: true,
      opacity:     1.0,
      blending:    THREE.AdditiveBlending,
      side:        THREE.DoubleSide,
      depthWrite:  false,
      fog:         false
    });
    const plane = new THREE.Mesh(geo, mat);
    // Place on the inner surface of the near cylinder, vertical, facing inward.
    // Position: radius 545 from center, y centered at 40u (below mid of the silhouette)
    const px = Math.sin(angleRad) * 545;
    const pz = Math.cos(angleRad) * 545;
    plane.position.set(px, 40, pz);
    // Face toward scene center at same height
    plane.lookAt(new THREE.Vector3(0, 40, 0));
    plane.renderOrder = -9;
    scene.add(plane);
    if(window._freezeMatrix)window._freezeMatrix(plane);
    _gzDisposables.push(plane);
  }
  makeHazePlane(_GZ_PALETTE.cityGlowMag,  0);         // front (behind starting direction)
  makeHazePlane(_GZ_PALETTE.cityGlowCyan, Math.PI);   // back (opposite side)
}

// ── Vertical neon spires ──────────────────────────────────────────────────
//
// Tall thin CylinderGeometry columns. V3.5: two concentric rings at r=220
// (inner, just outside track) and r=320 (outer). Total 24 desktop / 14
// mobile instances split evenly between rings. Heights 8–30u random (closer
// rings read at this scale). One InstancedMesh each for shafts and tip glows.
//
// instanceColor alternates magenta / cyan per spire.
// Mobile: 14 spires, no tip glows. Desktop: 24 spires + 24 tip glows.
function _gzBuildVerticalSpires(){
  const mob    = !!window._isMobile;
  const COUNT  = mob ? 14 : 24;

  // Two-ring config — total must equal COUNT.
  // Split roughly evenly; inner ring gets the extra instance if odd.
  const INNER_R = 220;
  const OUTER_R = 320;
  const innerCount = Math.ceil(COUNT / 2);   // 12 desktop / 7 mobile
  const outerCount = COUNT - innerCount;     // 12 desktop / 7 mobile

  // Seeded RNG for deterministic placement
  const rng = (seed) => {
    const x = Math.sin(seed * 9.871 + 17.432) * 47831.5;
    return x - Math.floor(x);
  };

  // Shaft InstancedMesh — unit cylinder scaled per instance
  const shaftGeo = new THREE.CylinderGeometry(0.20, 0.20, 1, 6);
  const shaftMat = new THREE.MeshBasicMaterial({
    vertexColors: false,
    transparent:  true,
    opacity:      0.90,
    blending:     THREE.AdditiveBlending,
    depthWrite:   false,
    fog:          false
  });
  const shaftIM = new THREE.InstancedMesh(shaftGeo, shaftMat, COUNT);
  shaftIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
  shaftIM.renderOrder = -8;

  // Tip-glow InstancedMesh — small sphere at top of each spire (desktop only)
  let tipIM = null;
  if(!mob){
    const tipGeo = new THREE.SphereGeometry(0.60, 6, 4);
    const tipMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity:     0.95,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      fog:         false
    });
    tipIM = new THREE.InstancedMesh(tipGeo, tipMat, COUNT);
    tipIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
    tipIM.renderOrder = -8;
  }

  const dummy  = new THREE.Object3D();
  // V4.1 — 4-color rotation (was just mag/cyan = read as all-pink at distance).
  // Cyan-biased, with magenta + gold + green for variety.
  const colCya = new THREE.Color(0x20ffff);
  const colMag = new THREE.Color(0xff20ff);
  const colGold= new THREE.Color(0xffd040);
  const colGrn = new THREE.Color(0x60ff80);
  const SPIRE_COLORS = [colCya, colMag, colGold, colCya, colGrn, colCya, colMag];

  // Build ring instances — loop over both rings, writing into shaftIM slots
  let idx = 0;
  const rings = [
    { r: INNER_R, n: innerCount, seedOff: 0   },
    { r: OUTER_R, n: outerCount, seedOff: 200 },
  ];
  for(let ri = 0; ri < rings.length; ri++){
    const ring = rings[ri];
    for(let i = 0; i < ring.n; i++){
      const seed   = ring.seedOff + i;
      const angle  = rng(seed)       * Math.PI * 2;
      const height = 8 + rng(seed + 50) * 22;  // 8u to 30u tall (closer = smaller reads fine)
      const tipY   = 20 + height;              // spire base at y=20, tip at y=20+height

      const sx = Math.cos(angle) * ring.r;
      const sz = Math.sin(angle) * ring.r;

      // Shaft: positioned at center of shaft, scaled to height
      dummy.position.set(sx, 20 + height * 0.5, sz);
      dummy.scale.set(1, height, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      shaftIM.setMatrixAt(idx, dummy.matrix);
      const col = SPIRE_COLORS[idx % SPIRE_COLORS.length];
      shaftIM.setColorAt(idx, col);

      // Tip glow: at the top of the shaft
      if(tipIM){
        dummy.position.set(sx, tipY, sz);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        tipIM.setMatrixAt(idx, dummy.matrix);
        tipIM.setColorAt(idx, col);
      }
      idx++;
    }
  }

  shaftIM.instanceMatrix.needsUpdate = true;
  shaftIM.instanceColor.needsUpdate  = true;
  scene.add(shaftIM);
  _gzDisposables.push(shaftIM);

  if(tipIM){
    tipIM.instanceMatrix.needsUpdate = true;
    tipIM.instanceColor.needsUpdate  = true;
    scene.add(tipIM);
    _gzDisposables.push(tipIM);
  }
}

// ── Overhead string lights ────────────────────────────────────────────────
//
// Chains of small emissive spheres above the track. Each string is ONE
// InstancedMesh — one draw call per string. Instances arranged along a
// slight catenary arc perpendicular to the track tangent.
//
// Mobile: 3 strings. Desktop: 5 strings.
// Spheres per string: 14. Colors alternate magenta / cyan / warm-yellow.
// Height: 14u above ground, perpendicular span: 16u.
function _gzBuildOverheadStrings(){
  if(typeof trackCurve === 'undefined') return;
  const mob      = !!window._isMobile;
  const STRINGS  = mob ? 3 : 5;
  const PER_STR  = 14;   // instances per InstancedMesh
  const STR_SPAN = 16;   // total lateral width (u) of the string
  const BASE_Y   = 14;   // height above ground (u)
  const SAG      = 1.8;  // catenary sag depth at center (u)

  // Color per string — cycling
  const STRING_COLORS = [
    0xff40a0,  // magenta
    0x40e0ff,  // cyan
    0xffcc60,  // warm yellow
    0xff60c0,  // pink-magenta
    0x60ffdd,  // teal-cyan
  ];

  const sphereGeo = new THREE.SphereGeometry(0.15, 5, 3);
  const dummy     = new THREE.Object3D();

  for(let s = 0; s < STRINGS; s++){
    const t   = (s + 1) / (STRINGS + 1);  // avoid t=0 and t=1 (start/finish)
    const pt  = trackCurve.getPoint(t);
    const tg  = trackCurve.getTangent(t).normalize();
    // Normal (perpendicular, horizontal)
    const nr  = new THREE.Vector3(-tg.z, 0, tg.x).normalize();

    const mat = new THREE.MeshBasicMaterial({
      color:       STRING_COLORS[s % STRING_COLORS.length],
      transparent: true,
      opacity:     0.90,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      fog:         false
    });
    const iMesh = new THREE.InstancedMesh(sphereGeo, mat, PER_STR);
    iMesh.renderOrder = -7;

    for(let k = 0; k < PER_STR; k++){
      const u   = (k / (PER_STR - 1)) - 0.5;
      const lateralOff = u * STR_SPAN;
      const px = pt.x + nr.x * lateralOff;
      const pz = pt.z + nr.z * lateralOff;
      // Catenary sag: center (u=0) hangs SAG below the endpoints (u=±0.5).
      // Real overhead string lights dip downward in the middle.
      const py = BASE_Y - SAG * (1 - 4 * u * u);
      dummy.position.set(px, py, pz);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      iMesh.setMatrixAt(k, dummy.matrix);
    }
    iMesh.instanceMatrix.needsUpdate = true;
    scene.add(iMesh);
    _gzDisposables.push(iMesh);
  }
}

// ── Building facade banners ───────────────────────────────────────────────
//
// Vertical neon banners on the inner surface of the near-silhouette cylinder.
// Each banner: unique CanvasTexture with stacked CJK characters. Shared
// PlaneGeometry (one DC per banner — deliberate exception to InstancedMesh
// rule because each banner has a unique texture).
//
// Mobile: 6 banners. Desktop: 12. Canvas: 128×512 (portrait). Each banner
// 2u wide × 8u tall, placed at radius 532 (inside near cylinder r=540).
// Characters: 4–6 random CJK from U+4E00–U+9FFF range.
function _gzBuildFacadeBanners(){
  const mob    = !!window._isMobile;
  const COUNT  = mob ? 6 : 12;
  const RADIUS = 280;    // V3.5: moved from r=532 to r=280 — sits between track and silhouette
  const BW     = 3.5;    // V3.5: increased from 2.0 → 3.5u wide (40% bigger for readability)
  const BH     = 10.0;   // V3.5: increased from 8.0 → 10.0u tall (40% bigger for readability)

  // CJK character pool — a fixed set of visually interesting chars
  const CJK_POOL = [
    0x5E7F,0x5DDE,0x8D5B,0x8F66,0x4FC3,0x5939,0x5149,0x590F,0x591C,0x5929,
    0x9700,0x901F,0x5165,0x5C71,0x6CB3,0x5929,0x9F99,0x706B,0x98CE,0x5C0F,
    0x5927,0x5BA1,0x6307,0x56FD,0x9AD8,0x8FD0,0x6CB3,0x5E02,0x4EBA,0x9053,
  ];

  const seededRng = (seed) => {
    const x = Math.sin(seed * 13.461 + 29.124) * 61847.3;
    return x - Math.floor(x);
  };

  const BANNER_COLORS = [
    { hex: '#ff2080', glow: 'rgba(255,32,128,0.8)'  },  // magenta
    { hex: '#00e0ff', glow: 'rgba(0,224,255,0.8)'   },  // cyan
    { hex: '#ff60d0', glow: 'rgba(255,96,208,0.7)'  },  // pink
    { hex: '#20ffcc', glow: 'rgba(32,255,204,0.7)'  },  // teal
  ];

  const sharedGeo = new THREE.PlaneGeometry(BW, BH);

  for(let i = 0; i < COUNT; i++){
    const angle = (i / COUNT) * Math.PI * 2 + Math.PI * 0.1;  // slight offset from 0
    const yPos  = 12 + seededRng(i + 50) * 40;  // 12u to 52u height
    const cSpec = BANNER_COLORS[i % BANNER_COLORS.length];
    const nChars= 4 + Math.floor(seededRng(i + 200) * 3);  // 4–6 chars

    // Build CanvasTexture: 128×512 portrait, vertical stack of CJK chars
    const cvs = document.createElement('canvas');
    cvs.width  = 128;
    cvs.height = 512;
    const ctx  = cvs.getContext('2d');

    // Black background
    ctx.fillStyle = 'rgba(2,2,8,0.90)';
    ctx.fillRect(0, 0, 128, 512);

    // Neon border
    ctx.strokeStyle = cSpec.hex;
    ctx.lineWidth   = 4;
    ctx.globalAlpha = 0.50;
    ctx.strokeRect(6, 6, 116, 500);
    ctx.globalAlpha = 1.0;

    // Characters — stacked vertically
    ctx.font        = 'bold 72px "Arial Unicode MS", Arial, sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.shadowColor = cSpec.glow;
    ctx.shadowBlur  = 18;
    ctx.fillStyle   = cSpec.hex;
    const cellH = 512 / nChars;
    for(let c = 0; c < nChars; c++){
      const charIdx = Math.floor(seededRng(i * 100 + c) * CJK_POOL.length);
      const ch      = String.fromCharCode(CJK_POOL[charIdx]);
      ctx.fillText(ch, 64, (c + 0.5) * cellH);
    }

    const tex = new THREE.CanvasTexture(cvs);
    tex.needsUpdate = true;

    const mat = new THREE.MeshBasicMaterial({
      map:         tex,
      transparent: true,
      opacity:     0.95,
      blending:    THREE.AdditiveBlending,
      side:        THREE.DoubleSide,
      depthWrite:  false,
      fog:         false
    });

    const banner = new THREE.Mesh(sharedGeo, mat);
    const bx = Math.cos(angle) * RADIUS;
    const bz = Math.sin(angle) * RADIUS;
    banner.position.set(bx, yPos + BH * 0.5, bz);
    // Face inward (look at scene center at same height)
    banner.lookAt(new THREE.Vector3(0, yPos + BH * 0.5, 0));
    banner.renderOrder = -8;
    scene.add(banner);
    _gzDisposables.push(banner);
  }
}

// ── Phase D (V5) — 6 Hero animated billboards: bigger + more spread ───────
//
// V5 bump: 3d/2m → 6d/3m, plane 18×30 → 24×40, sideOffset 25-32u (closer).
// t-positions spread to 0.10/0.25/0.40/0.55/0.70/0.85 desktop, 0.25/0.55/0.85 mobile.
function _gzBuildHeroBillboards(scene){
  if(typeof trackCurve === 'undefined') return;
  const mob    = !!window._isMobile;
  const COUNT  = mob ? 3 : 6;
  // t-positions: desktop 6 evenly spread, mobile 3
  const tSamples   = mob ? [0.25, 0.55, 0.85] : [0.10, 0.25, 0.40, 0.55, 0.70, 0.85];
  // side offsets: alternating ±, 33-42u from track. 2026-05-11 bumped
  // from 25-32 → 33-42 because at the old distances the 24×40 plane
  // could appear to hover OVER the track at sharp curves (the
  // perpendicular sample at t didn't follow the curve outward fast
  // enough). New floor 33u keeps the billboard well off the racing
  // line at every curvature.
  const sideOffsets = mob ? [36, -33, 38] : [36, -34, 38, -33, 40, -35];
  // CJK char blocks — extended to 6 blocks for 6 unique billboards
  const cjkBlocks = [
    ['广','州','速','夜','赛'],
    ['珠','江','极','王','道'],
    ['南','沙','湾','城','光'],
    ['高','速','入','夜','行'],
    ['龙','城','霓','虹','火'],
    ['未','来','赛','车','场'],
  ];
  const bgGradients = [
    { top: '#020010', mid: '#5a0030', bot: '#020010' },
    { top: '#000a10', mid: '#003858', bot: '#000a10' },
    { top: '#080010', mid: '#3a0060', bot: '#080010' },
    { top: '#080000', mid: '#502800', bot: '#080000' },
    { top: '#001008', mid: '#004030', bot: '#001008' },
    { top: '#060004', mid: '#280050', bot: '#060004' },
  ];
  const neonBorderColors = ['#ff2080','#00e0ff','#ff60a0','#ffd070','#80ff40','#40c0ff'];

  _gzHeroBillboardMats.length = 0;
  _gzHeroBillboards.length = 0;

  for(let i = 0; i < COUNT; i++){
    const t  = tSamples[i];
    const pt = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    // Perpendicular outward (horizontal)
    const nrX = -tg.z;
    const nrZ =  tg.x;
    const sDist = sideOffsets[i];

    const px = pt.x + nrX * sDist;
    const pz = pt.z + nrZ * sDist;
    const py = 24;  // centered: billboard half-height = 20, base at 4u → center at 24

    // Build unique CanvasTexture 256×512
    const cvs = document.createElement('canvas');
    cvs.width = 256; cvs.height = 512;
    const gc = cvs.getContext('2d');
    const bd = bgGradients[i % bgGradients.length];
    // Background gradient
    const grad = gc.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, bd.top);
    grad.addColorStop(0.5, bd.mid);
    grad.addColorStop(1.0, bd.bot);
    gc.fillStyle = grad; gc.fillRect(0, 0, 256, 512);
    // Scanline overlay (thin horizontal bars)
    gc.globalAlpha = 0.08;
    for(let sl = 0; sl < 512; sl += 4){
      gc.fillStyle = '#000000';
      gc.fillRect(0, sl, 256, 1);
    }
    gc.globalAlpha = 1.0;
    // Neon border
    gc.strokeStyle = neonBorderColors[i % neonBorderColors.length];
    gc.lineWidth = 5;
    gc.strokeRect(4, 4, 248, 504);
    // Big vertical Chinese characters
    const chars = cjkBlocks[i % cjkBlocks.length];
    const nChars = 4;
    gc.fillStyle = neonBorderColors[i % neonBorderColors.length];
    gc.font = 'bold 88px sans-serif';
    gc.textAlign = 'center';
    gc.shadowColor = neonBorderColors[i % neonBorderColors.length];
    gc.shadowBlur = 18;
    for(let ch = 0; ch < nChars; ch++){
      gc.fillText(chars[ch % chars.length], 128, 80 + ch * 104);
    }
    gc.shadowBlur = 0;

    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;

    const mat = new THREE.MeshBasicMaterial({
      map:         tex,
      transparent: true,
      opacity:     0.95,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      fog:         false,
      side:        THREE.DoubleSide
    });
    mat._gzPhase = i * 1.1;  // staggered animation phase

    // V5: 24×40u (was 18×30u — 33% bigger)
    const billboard = new THREE.Mesh(new THREE.PlaneGeometry(24, 40), mat);
    billboard.position.set(px, py, pz);
    billboard.lookAt(new THREE.Vector3(0, py, 0));  // face track origin
    scene.add(billboard);

    _gzHeroBillboardMats.push(mat);
    _gzHeroBillboards.push(billboard);  // Phase 10.7 — track mesh refs for spark showers
    _gzDisposables.push(billboard);
    _gzDisposables.push(tex);
  }
}

// ── Street-level neon strips ──────────────────────────────────────────────
//
// ── Phase B — Close-range urban canyon ───────────────────────────────────
//
// ONE InstancedMesh of BoxGeometry(1,1,1) (unit cube, scaled per-instance).
// N=24 desktop / 14 mobile boxes placed at radius 110u (between track and the
// far silhouette cylinder at 540). Each box is randomly scaled tall and has a
// rich 512×512 window-grid CanvasTexture baked-in.
function _gzBuildUrbanCanyon(scene){
  const mob   = !!window._isMobile;
  const N     = mob ? 14 : 24;
  const R     = 110;

  // Build the window-grid CanvasTexture ONCE (shared across all instances).
  // Hi-DPI: 2× canvas painted in original 512-coord space via ctx.scale(2,2).
  const cvs = document.createElement('canvas');
  cvs.width = 1024; cvs.height = 1024;
  const g = cvs.getContext('2d');
  g.scale(2, 2);
  // Dark building base
  g.fillStyle = '#050308'; g.fillRect(0, 0, 512, 512);
  // Billboard stripes — 3-4 horizontal coloured bands
  const stripeColors = ['#5a0030','#003050','#602000','#1a0040'];
  const nStripes = 3 + Math.floor(Math.random() * 2);
  for(let s = 0; s < nStripes; s++){
    const sy = 40 + s * (512 / (nStripes + 1));
    g.fillStyle = stripeColors[s % stripeColors.length];
    g.fillRect(0, sy, 512, 30 + Math.random() * 20);
  }
  // Dense window grid: 10 columns × 18 rows of small bright pixels
  const COLS = 10; const ROWS = 18;
  const winW = Math.floor(512 / (COLS * 2));    // ~25px each with gap
  const winH = Math.floor(512 / (ROWS * 2));
  const emissiveColors = ['#ff2080','#00e0ff','#ffd070','#ff60a0'];
  const rngW = (seed) => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5; return x - Math.floor(x); };
  for(let row = 0; row < ROWS; row++){
    for(let col = 0; col < COLS; col++){
      const idx = row * COLS + col;
      // ~30% windows off
      if(rngW(idx) < 0.30) continue;
      const wx = 10 + col * (512 / COLS) + rngW(idx * 3.1) * 4;
      const wy = 10 + row * (512 / ROWS) + rngW(idx * 7.3) * 3;
      // 2026-05-11 rebalance: ~75% white windows, ~25% neon accent
      // (was 100% neon). Matches the trackside-building rebalance.
      const isAccent = rngW(idx * 11.3) < 0.25;
      const col2 = isAccent
        ? emissiveColors[Math.floor(rngW(idx * 2.7) * emissiveColors.length)]
        : (rngW(idx * 13.7) < 0.18 ? '#ffefcc' : '#ffffff');
      g.fillStyle = col2;
      g.globalAlpha = 0.6 + rngW(idx * 5.1) * 0.4;
      g.fillRect(wx, wy, winW, winH);
    }
  }
  g.globalAlpha = 1.0;
  // 2026-05-13 owner feedback round-7 "verre achtergrond pixelig" — earlier
  // round-6 hybrid (NearestFilter mag + LinearMipMapLinear min) still showed
  // chunky window blocks at mid-distance because at ~50-150u the sampling
  // regime falls into magnification, where NearestFilter dominates. Fix:
  // bumped canvas to 1024² (2× via ctx.scale) AND switched magFilter to
  // LinearFilter so windows interpolate smoothly. minFilter +
  // generateMipmaps + anisotropy 4 stay for oblique long-distance sampling.
  const winTex = new THREE.CanvasTexture(cvs);
  winTex.magFilter = THREE.LinearFilter;
  winTex.minFilter = THREE.LinearMipMapLinearFilter;
  winTex.generateMipmaps = true;
  winTex.anisotropy = 4;

  const geo = new THREE.BoxGeometry(1, 1, 1);
  // V4.3 — switched from MeshLambertMaterial to MeshBasicMaterial. Lambert
  // multiplies (color × map × lighting); with skyline-far ambient light low
  // and skylineNear color very dark, the bright window-grid texture got
  // multiplied to near-black. Basic skips lighting entirely so the baked
  // window emissives render at full saturation. Color 0xb0b0b8 = mid-grey
  // tints the dark base subtly without dimming the bright window pixels.
  const mat = new THREE.MeshBasicMaterial({
    color: 0xb0b0b8,
    map:   winTex
  });

  const iMesh = new THREE.InstancedMesh(geo, mat, N);
  iMesh._gzUrban = true;
  iMesh.renderOrder = -6;

  const dummy = new THREE.Object3D();
  const rng = (seed) => { const x = Math.sin(seed * 9.871 + 17.432) * 47831.5; return x - Math.floor(x); };

  for(let i = 0; i < N; i++){
    const angle  = (i / N) * Math.PI * 2 + rng(i * 3.1) * 0.4;
    const scaleX = 8  + rng(i * 1.3) * 14;   // 8-22u wide
    const scaleY = 25 + rng(i * 2.7) * 40;   // 25-65u tall
    const scaleZ = 8  + rng(i * 4.9) * 6;    // 8-14u deep

    const px = Math.cos(angle) * R;
    const pz = Math.sin(angle) * R;
    const py = scaleY * 0.5;  // base at ground level

    dummy.position.set(px, py, pz);
    // Rotate so the long side faces the track origin (atan2 gives Y-axis rotation)
    dummy.rotation.set(0, Math.atan2(px, pz) + Math.PI, 0);
    dummy.scale.set(scaleX, scaleY, scaleZ);
    dummy.updateMatrix();
    iMesh.setMatrixAt(i, dummy.matrix);
  }
  iMesh.instanceMatrix.needsUpdate = true;

  scene.add(iMesh);
  _gzDisposables.push(iMesh);
  _gzDisposables.push(winTex);
}

// ── V4.2 Trackside buildings — mid-rise wall along the racing line ─────────
//
// V4 urban canyon (radius 110, ring placement) puts buildings INSIDE the
// track loop — only visible when looking inward across corners. User
// feedback: "veel vaker grote gebouwen aan de track of dichtbij".
//
// This builder samples track-curve at evenly-spaced t values and places TWO
// mid-rise buildings (one each side) perpendicular to the tangent at each
// sample. Result: buildings appear EVERYWHERE along the lap, on both sides,
// 14-22u from the track edge — the "race through a city" effect.
//
// Density: 32 samples × 2 sides = 64 desktop / 12 × 2 = 24 mobile, all on
// ONE InstancedMesh = 1 DC. Shared CanvasTexture window grid (256×512,
// vertical orientation) baked once.
// ── V5 Phase A helper: build one of 4 distinct building CanvasTextures ───
function _gzMakeBuildingTex(variant){
  // variant 0 "cyan-tech"   : cyan-dominant, thin grid
  // variant 1 "magenta-glamour": magenta+pink, neon band stripes
  // variant 2 "warm-yellow" : gold+orange, classical office look
  // variant 3 "mixed-chaos" : all colors + green, busiest
  // Hi-DPI: 2× canvas painted in original 256×512-coord space via ctx.scale(2,2).
  const cvs = document.createElement('canvas');
  cvs.width = 512; cvs.height = 1024;
  const g = cvs.getContext('2d');
  g.scale(2, 2);
  const rngW = (seed) => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5; return x - Math.floor(x); };

  // Base dark background per variant
  const bgColors = ['#010a0c', '#080005', '#060400', '#020205'];
  g.fillStyle = bgColors[variant]; g.fillRect(0, 0, 256, 512);

  // Variant-specific band stripes
  if(variant === 0){
    // cyan-tech: thin tech-grid horizontal lines
    g.globalAlpha = 0.18;
    g.fillStyle = '#00e0ff';
    for(let y = 0; y < 512; y += 20){ g.fillRect(0, y, 256, 1); }
    for(let x = 0; x < 256; x += 20){ g.fillRect(x, 0, 1, 512); }
    g.globalAlpha = 1.0;
  } else if(variant === 1){
    // magenta-glamour: 3 thick neon bands
    const bandY = [60, 200, 360];
    const bandH = [28, 22, 32];
    const bandC = ['#ff2080','#ff60a0','#cc0060'];
    for(let b = 0; b < 3; b++){
      g.fillStyle = bandC[b]; g.globalAlpha = 0.70;
      g.fillRect(0, bandY[b], 256, bandH[b]);
    }
    g.globalAlpha = 1.0;
  } else if(variant === 2){
    // warm-yellow: 2 gold horizontal mid-building stripes
    g.fillStyle = '#ffd070'; g.globalAlpha = 0.50;
    g.fillRect(0, 130, 256, 18);
    g.fillRect(0, 320, 256, 14);
    g.globalAlpha = 1.0;
  } else {
    // mixed-chaos: coloured blocks scattered across face
    const blockColors = ['#ff2080','#00e0ff','#ffd070','#80ff40','#ff8030'];
    for(let b = 0; b < 8; b++){
      const bx = rngW(b * 3.1) * 200;
      const by = rngW(b * 5.7) * 460;
      const bw = 20 + rngW(b * 2.3) * 40;
      const bh = 8 + rngW(b * 4.1) * 18;
      g.fillStyle = blockColors[b % blockColors.length];
      g.globalAlpha = 0.45 + rngW(b * 1.9) * 0.30;
      g.fillRect(bx, by, bw, bh);
    }
    g.globalAlpha = 1.0;
  }

  // Window grid — color pool differs per variant.
  // 2026-05-11 rebalance per owner feedback "ik heb liever grotendeels
  // witte raampjes, niet alles, maar af en toe een paar random
  // lampjes en af en toe een gebouw met gekleurde lampen". Variants
  // 0, 2, 3 are now WHITE-DOMINANT (70-80% white) with sparse colour
  // accents. Variant 1 stays the "fully coloured" exception so ~25%
  // of buildings still read as neon billboards.
  const COLS = 6, ROWS = 24;
  const colorPools = [
    // variant 0 "cyan-accent office" — mostly white with cyan/cool accents
    ['#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#fff5e0','#dde6f0','#00e0ff','#40c0ff'],
    // variant 1 "magenta-glamour" — the colourful exception (mostly neon)
    ['#ff2080','#ff2080','#ff60a0','#ff60a0','#ffd070','#ffd070','#00e0ff','#ffffff'],
    // variant 2 "warm-yellow office" — mostly white with warm accents
    ['#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#ffefcc','#ffd070','#ff8030'],
    // variant 3 "mixed-chaos" — mostly white with rare colour pops
    ['#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#ff2080','#00e0ff','#ffd070','#80ff40']
  ];
  const pool = colorPools[variant];
  const skipThresh = (variant === 3) ? 0.25 : 0.32;  // mixed-chaos denser; others slightly fuller
  for(let row = 0; row < ROWS; row++){
    for(let col = 0; col < COLS; col++){
      const idx = row * COLS + col + variant * 1000;
      if(rngW(idx) < skipThresh) continue;
      const wx = 6 + col * (256 / COLS);
      const wy = 6 + row * (512 / ROWS);
      const winColor = pool[Math.floor(rngW(idx * 2.7) * pool.length)];
      g.fillStyle = winColor;
      g.globalAlpha = 0.55 + rngW(idx * 5.1) * 0.45;
      g.fillRect(wx, wy, 16, 9);
    }
  }
  g.globalAlpha = 1.0;
  // 2026-05-13 round-7 — same hi-DPI + LinearFilter treatment as
  // _gzBuildUrbanCanyon. 2× canvas + linear mag-filter removes the chunky
  // window-grid look at mid-distance; mipmaps + anisotropy keep distant
  // sampling sharp on the obliquely-viewed trackside towers.
  const tex = new THREE.CanvasTexture(cvs);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return tex;
}

// ── V5 Phase A+B: 4-variant textured buildings, non-uniform density ───────
//
// Phase A: 4 separate InstancedMesh (one per texture variant), each using
//          a distinct CanvasTexture so adjacent buildings look different.
// Phase B: 6 zones with varying sample density along the track t-range so
//          placement is irregular (dense / sparse alternating).
function _gzBuildTracksideBuildings(scene){
  if(typeof trackCurve === 'undefined') return;
  const mob       = !!window._isMobile;
  const SAMPLES   = mob ? 12 : 32;  // total target samples (Phase B redistributes these)

  // ── Phase A: Build 4 variant textures ────────────────────────────────────
  const varTex  = [0,1,2,3].map(v => _gzMakeBuildingTex(v));
  const geo     = new THREE.BoxGeometry(1, 1, 1);
  // 4 InstancedMesh — one per variant. Each gets up to SAMPLES*2/2 = SAMPLES instances
  // (worst case all go to one variant). Allocate SAMPLES per variant (safe ceiling).
  const varMats  = varTex.map(t => new THREE.MeshBasicMaterial({ color: 0xb0b0b8, map: t }));
  const varMesh  = varMats.map(m => {
    const im = new THREE.InstancedMesh(geo, m, SAMPLES * 2);
    im.renderOrder = -6;
    im.count = 0;  // will be set after population
    return im;
  });
  const varIdx   = [0, 0, 0, 0];  // running index per variant IM

  const dummy = new THREE.Object3D();
  const rng = (seed) => { const x = Math.sin(seed * 9.871 + 17.432) * 47831.5; return x - Math.floor(x); };

  // ── Phase B: Non-uniform t-values across 6 density zones ─────────────────
  // Zones: [tStart, tEnd, densityMul]
  const ZONES = [
    [0.00, 0.15, 1.5],   // zone 0 DENSE
    [0.15, 0.25, 0.4],   // zone 1 SPARSE
    [0.25, 0.45, 1.3],   // zone 2 DENSE
    [0.45, 0.55, 0.5],   // zone 3 SPARSE
    [0.55, 0.85, 1.4],   // zone 4 DENSE
    [0.85, 1.00, 0.4],   // zone 5 SPARSE
  ];
  // Compute how many samples fall in each zone proportional to (span × density)
  const totalWeight = ZONES.reduce((acc, z) => acc + (z[1] - z[0]) * z[2], 0);
  const tSamples = [];
  for(let zi = 0; zi < ZONES.length; zi++){
    const [zStart, zEnd, zDens] = ZONES[zi];
    const span    = zEnd - zStart;
    const nZone   = Math.max(1, Math.round((span * zDens / totalWeight) * SAMPLES));
    for(let si = 0; si < nZone; si++){
      tSamples.push(zStart + (si / nZone) * span);
    }
  }

  let globalIdx = 0;
  for(let si = 0; si < tSamples.length; si++){
    const t  = tSamples[si];
    const pt = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    const nrX = -tg.z;
    const nrZ =  tg.x;

    for(let side = 0; side < 2; side++){
      const variantIdx = globalIdx % 4;          // cycle variants so adjacent differ
      const sideFlip   = (side === 0) ? 1 : -1;
      // 2026-05-11: bumped from 14-22 → 22-32. At sideOff 14 with
      // building depth up to 10u, the inner edge sat 9u from track
      // centerline — close to the racing line, and on tight curves
      // the perpendicular sample could project the box onto / through
      // the track surface. New floor 22u keeps the inner edge ≥17u
      // out regardless of curve curvature.
      const sideOff    = 22 + rng(si * 7.1 + side * 3) * 10;
      const w          = 5  + rng(si * 2.3 + side * 11) * 7;
      const d          = 5  + rng(si * 4.7 + side * 13) * 5;
      const h          = 25 + rng(si * 3.1 + side * 17) * 55;

      const px = pt.x + nrX * sideOff * sideFlip;
      const pz = pt.z + nrZ * sideOff * sideFlip;
      const py = h * 0.5;

      dummy.position.set(px, py, pz);
      const faceAngle = Math.atan2(-nrX * sideFlip, -nrZ * sideFlip);
      dummy.rotation.set(0, faceAngle, 0);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();

      const vi = varIdx[variantIdx];
      if(vi < SAMPLES * 2){
        varMesh[variantIdx].setMatrixAt(vi, dummy.matrix);
        varIdx[variantIdx]++;
      }
      globalIdx++;
    }
  }

  for(let v = 0; v < 4; v++){
    varMesh[v].count = varIdx[v];
    varMesh[v].instanceMatrix.needsUpdate = true;
    scene.add(varMesh[v]);
    _gzDisposables.push(varMesh[v]);
    _gzDisposables.push(varTex[v]);
  }
}

// ── V4.4 Heroic mega-towers — iconic skyscrapers at curve apexes ─────────
//
// Trackside buildings are uniform 25-80u — visually decent backdrop but no
// "iconic megacity" anchor. Real Guangzhou has 100+ story towers that
// dominate the skyline. This builder places 4 desktop / 2 mobile MASSIVE
// towers (140-200u tall) at strategic curve-apex points, on the OUTSIDE
// of corners so they dominate framing during cornering.
//
// Each tower: 1 InstancedMesh shared across all hero towers (1 DC).
// Shared CanvasTexture is similar to trackside but TALLER aspect (256×1024)
// for skyscraper look, with bigger window pixels and a "hero stripe" of
// ultra-bright billboard band 1/3 from top.
function _gzBuildHeroTowers(scene){
  if(typeof trackCurve === 'undefined') return;
  const mob   = !!window._isMobile;
  const COUNT = mob ? 2 : 4;

  // Build hero-tower texture (256×1024 vertical, very tall aspect)
  const cvs = document.createElement('canvas');
  cvs.width = 256; cvs.height = 1024;
  const g = cvs.getContext('2d');
  g.fillStyle = '#02010a'; g.fillRect(0, 0, 256, 1024);
  // Hero billboard band — 80px tall ultra-bright magenta/cyan strip 1/3 from top
  const heroY = 280;
  g.fillStyle = '#ff2080';
  g.fillRect(0, heroY,      256, 80);
  g.fillStyle = 'rgba(0,224,255,0.5)';
  g.fillRect(0, heroY + 30, 256, 22);
  // Dense window grid — 8 cols × 48 rows of medium-bright pixels
  const COLS = 8, ROWS = 48;
  const emissiveColors = ['#ff2080','#00e0ff','#ffd070','#ff60a0','#80ff40','#ff8030'];
  const rngW = (seed) => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5; return x - Math.floor(x); };
  for(let row = 0; row < ROWS; row++){
    // Skip the hero-band rows (~14-19)
    const yPx = 8 + row * (1024 / ROWS);
    if(yPx >= heroY - 4 && yPx <= heroY + 84) continue;
    for(let col = 0; col < COLS; col++){
      const idx = row * COLS + col;
      if(rngW(idx) < 0.30) continue;
      const wx = 6 + col * (256 / COLS);
      const col2 = emissiveColors[Math.floor(rngW(idx * 2.7) * emissiveColors.length)];
      g.fillStyle = col2;
      g.globalAlpha = 0.55 + rngW(idx * 5.1) * 0.45;
      g.fillRect(wx, yPx, 18, 8);
    }
  }
  g.globalAlpha = 1.0;
  const winTex = new THREE.CanvasTexture(cvs);

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xc0c0c8,    // brighter than trackside so heroes stand out
    map:   winTex
  });

  const iMesh = new THREE.InstancedMesh(geo, mat, COUNT);
  iMesh.renderOrder = -6;

  // Hero apex positions: 4 evenly-distributed curve points (with slight
  // offset so they don't overlap with hero billboards at t=0.15/0.5/0.85).
  const heroT = mob ? [0.30, 0.70] : [0.07, 0.30, 0.55, 0.78];
  const dummy = new THREE.Object3D();
  const rng = (seed) => { const x = Math.sin(seed * 9.871 + 17.432) * 47831.5; return x - Math.floor(x); };

  for(let i = 0; i < COUNT; i++){
    const t  = heroT[i];
    const pt = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    const nrX = -tg.z;
    const nrZ =  tg.x;

    const sideFlip = (i % 2 === 0) ? 1 : -1;
    const sideOff  = 28 + rng(i * 7.1) * 12;        // 28-40u — outer ring vs trackside (14-22u)
    const w        = 16 + rng(i * 1.3) * 8;         // 16-24u wide
    const d        = 16 + rng(i * 4.9) * 8;         // 16-24u deep
    const h        = 140 + rng(i * 2.7) * 60;       // 140-200u tall — towering

    const px = pt.x + nrX * sideOff * sideFlip;
    const pz = pt.z + nrZ * sideOff * sideFlip;
    const py = h * 0.5;

    dummy.position.set(px, py, pz);
    const faceAngle = Math.atan2(-nrX * sideFlip, -nrZ * sideFlip);
    dummy.rotation.set(0, faceAngle, 0);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    iMesh.setMatrixAt(i, dummy.matrix);
  }
  iMesh.instanceMatrix.needsUpdate = true;

  scene.add(iMesh);
  _gzDisposables.push(iMesh);
  _gzDisposables.push(winTex);
}

//
// Refactored from V3.5 individual Meshes (24d/14m = 24d/14m DC) to ONE
// InstancedMesh with per-instance color via setColorAt.
//
// NOW: 48 desktop / 24 mobile strips on 1 DC — net saving of 23d/13m DC
// while DOUBLING visible count. Each strip: PlaneGeometry(2.0, 1.5), facing
// the track centerline, alternating sides, y=3-7u storefront height.
function _gzBuildStreetNeon(scene){
  if(typeof trackCurve === 'undefined') return;
  const mob         = !!window._isMobile;
  const COUNT       = mob ? 24 : 48;
  // V4.1 — cyan-led palette (was magenta-heavy, user feedback "alleen roze").
  // 7 entries with cyan repeated for ~33% bias, magenta family at 17%, plus
  // gold + green + orange accents for variety.
  const NEON_COLORS = [0x00e0ff, 0xff2080, 0xffd070, 0x80ff40, 0x00e0ff, 0xff8030, 0x40c0ff];

  const geo = new THREE.PlaneGeometry(2.0, 1.5);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity:     0.95,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    fog:         false,
    side:        THREE.DoubleSide
  });

  const iMesh = new THREE.InstancedMesh(geo, mat, COUNT);
  iMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
  iMesh.renderOrder = -5;

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  for(let i = 0; i < COUNT; i++){
    const t   = i / COUNT;
    const pt  = trackCurve.getPoint(t);
    const tg  = trackCurve.getTangent(t).normalize();
    // Perpendicular (horizontal normal)
    const nrX = -tg.z;
    const nrZ =  tg.x;
    // Random-ish side offset: 7-9u, alternating sides
    const SIDE_OFF  = 7 + (Math.sin(i * 3.17 + 0.5) * 0.5 + 0.5) * 2;
    const sideFlip  = (i % 2 === 0) ? 1 : -1;
    const px = pt.x + nrX * SIDE_OFF * sideFlip;
    const pz = pt.z + nrZ * SIDE_OFF * sideFlip;
    const py = 3 + Math.random() * 4;

    dummy.position.set(px, py, pz);
    // Face toward track centerline
    dummy.lookAt(new THREE.Vector3(pt.x, py, pt.z));
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    iMesh.setMatrixAt(i, dummy.matrix);

    tmpColor.setHex(NEON_COLORS[i % NEON_COLORS.length]);
    iMesh.setColorAt(i, tmpColor);
  }

  iMesh.instanceMatrix.needsUpdate = true;
  iMesh.instanceColor.needsUpdate  = true;

  scene.add(iMesh);
  _gzDisposables.push(iMesh);
}

// ── Phase E — Overhead neon arches ───────────────────────────────────────
//
// 4 desktop / 2 mobile neon arches crossing above the track, built as
// series of 12 small box instances forming a half-circle. One InstancedMesh
// per arch. Alternate magenta / cyan colors. Arch radius 11u, center y=13u.
// Each arch spans perpendicular to the track tangent at its sample point.
function _gzBuildOverheadArches(scene){
  if(typeof trackCurve === 'undefined') return;
  const mob      = !!window._isMobile;
  const tSamples = mob ? [0.25, 0.75] : [0.10, 0.35, 0.65, 0.90];
  const SEGS     = 12;        // boxes per arch (half-circle)
  const ARCH_R   = 11;        // arch radius (u) — spans across the road
  const ARCH_CY  = 13;        // arch center height (u)
  const archColors = [_GZ_PALETTE.neonMagenta, _GZ_PALETTE.neonCyan];

  const boxGeo = new THREE.BoxGeometry(0.4, 0.4, 0.6);
  const dummy  = new THREE.Object3D();

  // 2026-05-11 owner feedback "spandoeken hangen boven baan zonder
  // vast te zitten aan iets". Adds two ground-anchored support
  // pillars per arch — dark grey BoxGeometry from y=0 up to the arch
  // base at y=ARCH_CY. One InstancedMesh shared across all arches
  // (2 pillars × N arches = 4 / 8 instances).
  const pillarGeo = new THREE.BoxGeometry(0.7, 1, 0.7);
  const pillarMat = new THREE.MeshBasicMaterial({ color: 0x1a1620, fog: false });
  const pillarIM  = new THREE.InstancedMesh(pillarGeo, pillarMat, tSamples.length * 2);
  pillarIM.renderOrder = -5;
  const pillarDummy = new THREE.Object3D();
  let pillarIdx = 0;

  for(let ai = 0; ai < tSamples.length; ai++){
    const t  = tSamples[ai];
    const pt = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    // Normal perpendicular to tangent (horizontal)
    const nrX = -tg.z;
    const nrZ =  tg.x;

    const color = archColors[ai % archColors.length];
    const mat = new THREE.MeshBasicMaterial({
      color:       color,
      transparent: true,
      opacity:     0.92,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      fog:         false
    });
    const iMesh = new THREE.InstancedMesh(boxGeo, mat, SEGS);
    iMesh.renderOrder = -5;

    for(let si = 0; si < SEGS; si++){
      // Half-circle: angle goes from 0 (right) to PI (left) above road
      const ang = (si / (SEGS - 1)) * Math.PI;
      // Position along the perpendicular axis and up
      const lateralOff = Math.cos(ang) * ARCH_R;  // side offset
      const vertOff    = Math.sin(ang) * ARCH_R;  // up offset

      dummy.position.set(
        pt.x + nrX * lateralOff,
        ARCH_CY + vertOff,
        pt.z + nrZ * lateralOff
      );
      // Align box along the arch tangent direction (rotate around track tangent axis)
      dummy.rotation.set(0, Math.atan2(tg.x, tg.z), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      iMesh.setMatrixAt(si, dummy.matrix);
    }
    iMesh.instanceMatrix.needsUpdate = true;
    scene.add(iMesh);
    _gzDisposables.push(iMesh);

    // Two pillars at lateral = ±ARCH_R, from ground to arch base
    for(let side = -1; side <= 1; side += 2){
      const lx = pt.x + nrX * (ARCH_R * side);
      const lz = pt.z + nrZ * (ARCH_R * side);
      pillarDummy.position.set(lx, ARCH_CY * 0.5, lz);
      pillarDummy.rotation.set(0, Math.atan2(tg.x, tg.z), 0);
      pillarDummy.scale.set(1, ARCH_CY, 1);
      pillarDummy.updateMatrix();
      pillarIM.setMatrixAt(pillarIdx, pillarDummy.matrix);
      pillarIdx++;
    }
  }
  pillarIM.instanceMatrix.needsUpdate = true;
  scene.add(pillarIM);
  _gzDisposables.push(pillarIM);
}

// ── Phase D — Flying cars ─────────────────────────────────────────────────
//
// 6 desktop / 3 mobile flying vehicles on horizontal flight paths above track.
// Each: a BoxGeometry body + Sprite rear-light (neon magenta or cyan).
// Flight paths: 3 height bands y=18/28/38. Per-frame update via _gzFlyingCars[].
function _gzBuildFlyingCars(scene){
  const mob     = !!window._isMobile;
  // V4.2: bumped from 3/6 → 4/10 for more high-altitude background presence
  const COUNT   = mob ? 4 : 10;
  // Height bands (mobile uses only 2)
  const yBands  = mob ? [22, 32] : [18, 28, 38];
  const rng = (seed) => { const x = Math.sin(seed * 9.871 + 17.432) * 47831.5; return x - Math.floor(x); };

  const bodyGeo  = _gzMakeHovercarGeometry(2.4, 0.5, 1.0);
  const bodyMat  = new THREE.MeshBasicMaterial({ color: 0x303040, fog: false });
  const lightGeo = new THREE.PlaneGeometry(0.8, 0.8);
  const lightMat = new THREE.MeshBasicMaterial({
    map:         _gzGetLightTex(),
    transparent: true,
    opacity:     0.95,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    fog:         false,
    side:        THREE.DoubleSide
  });

  const bodyIM  = new THREE.InstancedMesh(bodyGeo, bodyMat, COUNT);
  const lightIM = new THREE.InstancedMesh(lightGeo, lightMat, COUNT);
  lightIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
  bodyIM.renderOrder  = -3;
  lightIM.renderOrder = -3;

  _gzFlyingCars.length = 0;
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  for(let i = 0; i < COUNT; i++){
    const bandIdx = i % yBands.length;
    const yPos    = yBands[bandIdx];
    const dir     = (i % 2 === 0) ? 1 : -1;
    const speed   = 8 + rng(i * 3.7) * 6;
    const startX  = (rng(i * 2.1) - 0.5) * 360;
    const zPos    = -20 + rng(i * 5.3) * 80;
    const lightColor = (i % 2 === 0) ? 0xff2080 : 0x00e0ff;

    _gzFlyingCars.push({ x: startX, yPos, zPos, speed, dir });

    dummy.position.set(startX, yPos, zPos);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bodyIM.setMatrixAt(i, dummy.matrix);

    dummy.position.set(startX - dir * 1.6, yPos, zPos);
    dummy.updateMatrix();
    lightIM.setMatrixAt(i, dummy.matrix);

    tmpColor.setHex(lightColor);
    lightIM.setColorAt(i, tmpColor);
  }

  bodyIM.instanceMatrix.needsUpdate  = true;
  lightIM.instanceMatrix.needsUpdate = true;
  lightIM.instanceColor.needsUpdate  = true;

  _gzFlyingCarsBody   = bodyIM;
  _gzFlyingCarsLights = lightIM;

  scene.add(bodyIM);
  scene.add(lightIM);
  _gzDisposables.push(bodyIM);
  _gzDisposables.push(lightIM);
}

// ── V4.1 Overhead flock — flying cars DIRECTLY above the track ───────────
//
// V4's _gzBuildFlyingCars seeds 6/3 cars at y=18-38u with random z scatter,
// so most fly through irrelevant parts of the scene. User feedback after V4:
// "vliegende auto's boven ons" — they want the flock visible RIGHT ABOVE the
// car as it races. This builder seeds 12d/6m cars at LOW altitude (y=10-16u)
// using trackCurve sample positions as initial spawn — so the flock starts
// clustered around the racing line, not random scene-wide.
//
// Per-frame x-axis movement with wraparound at ±200u. Larger body + sprite
// vs V4 cars (3.0×0.6×1.4 body, 1.2 sprite) so they read clearly from
// cockpit at low altitude.
function _gzBuildOverheadFlock(scene){
  if(typeof trackCurve === 'undefined') return;
  const mob   = !!window._isMobile;
  // V4.2: bumped from 6/12 → 8/24 for visibly denser flock above the track
  const COUNT = mob ? 8 : 24;

  // V4.1 — diversified palette: cyan-led, with magenta + gold + green accents
  const FLOCK_COLORS = [0x00e0ff, 0xff2080, 0xffd070, 0x80ff40, 0x00e0ff, 0xff60a0];

  const bodyGeo  = _gzMakeHovercarGeometry(3.0, 0.6, 1.4);
  const bodyMat  = new THREE.MeshBasicMaterial({ color: 0x1a1a24, fog: false });
  const lightGeo = new THREE.PlaneGeometry(1.2, 1.2);
  const lightMat = new THREE.MeshBasicMaterial({
    map:         _gzGetLightTex(),
    transparent: true,
    opacity:     0.95,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    fog:         false,
    side:        THREE.DoubleSide
  });

  const bodyIM  = new THREE.InstancedMesh(bodyGeo, bodyMat, COUNT);
  const lightIM = new THREE.InstancedMesh(lightGeo, lightMat, COUNT);
  lightIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
  bodyIM.renderOrder  = -3;
  lightIM.renderOrder = -3;

  _gzOverheadFlock.length = 0;
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  for(let i = 0; i < COUNT; i++){
    const t       = i / COUNT;
    const pt      = trackCurve.getPoint(t);
    const yPos    = Math.max(10, 12 + (Math.sin(i * 1.7 + 0.5) * 0.5 + 0.5) * 6);
    const dir     = (i % 2 === 0) ? 1 : -1;
    const speed   = 14 + (Math.sin(i * 2.1) * 0.5 + 0.5) * 8;
    const startX  = pt.x + (Math.sin(i * 4.3) * 0.5 + 0.5) * 30 - 15;
    const zPos    = pt.z;
    const baseColor = FLOCK_COLORS[i % FLOCK_COLORS.length];

    _gzOverheadFlock.push({ x: startX, yPos, zPos, speed, dir });

    dummy.position.set(startX, yPos, zPos);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bodyIM.setMatrixAt(i, dummy.matrix);

    dummy.position.set(startX - dir * 2.0, yPos, zPos);
    dummy.updateMatrix();
    lightIM.setMatrixAt(i, dummy.matrix);

    tmpColor.setHex(baseColor);
    lightIM.setColorAt(i, tmpColor);
  }

  bodyIM.instanceMatrix.needsUpdate  = true;
  lightIM.instanceMatrix.needsUpdate = true;
  lightIM.instanceColor.needsUpdate  = true;

  _gzOverheadFlockBody   = bodyIM;
  _gzOverheadFlockLights = lightIM;

  scene.add(bodyIM);
  scene.add(lightIM);
  _gzDisposables.push(bodyIM);
  _gzDisposables.push(lightIM);
}

// ── V4.2 Cross-track flock — cars flying PERPENDICULAR to the track ──────
//
// Overhead flock flies parallel to track (along x-axis). Cross-flock flies
// PERPENDICULAR to the track tangent at each spawn point — so the cars
// genuinely fly OVER the player from one side to the other. y=14-19u.
// V5 Phase F: bumped 8d→16d (mobile kept at 4 to protect FPS).
function _gzBuildCrossFlock(scene){
  if(typeof trackCurve === 'undefined') return;
  const mob   = !!window._isMobile;
  const COUNT = mob ? 4 : 16;

  const COLORS  = [0x00e0ff, 0xff2080, 0xffd070, 0x80ff40];

  const bodyGeo  = _gzMakeHovercarGeometry(2.6, 0.5, 1.2);
  const bodyMat  = new THREE.MeshBasicMaterial({ color: 0x1a1a24, fog: false });
  const lightGeo = new THREE.PlaneGeometry(1.0, 1.0);
  const lightMat = new THREE.MeshBasicMaterial({
    map:         _gzGetLightTex(),
    transparent: true,
    opacity:     0.95,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    fog:         false,
    side:        THREE.DoubleSide
  });

  const bodyIM  = new THREE.InstancedMesh(bodyGeo, bodyMat, COUNT);
  const lightIM = new THREE.InstancedMesh(lightGeo, lightMat, COUNT);
  lightIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
  bodyIM.renderOrder  = -3;
  lightIM.renderOrder = -3;

  _gzCrossFlock.length = 0;
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  for(let i = 0; i < COUNT; i++){
    const t   = ((i + 0.3) / COUNT) % 1;
    const pt  = trackCurve.getPoint(t);
    const tg  = trackCurve.getTangent(t).normalize();
    const perpX = -tg.z;
    const perpZ =  tg.x;
    const dir   = (i % 2 === 0) ? 1 : -1;
    const yPos  = 14 + (Math.sin(i * 1.7) * 0.5 + 0.5) * 5;
    const speed = 14 + (Math.sin(i * 2.3) * 0.5 + 0.5) * 6;
    const startOff = (Math.sin(i * 4.1) * 50);
    const startX = pt.x + perpX * startOff;
    const startZ = pt.z + perpZ * startOff;
    const baseColor = COLORS[i % COLORS.length];

    _gzCrossFlock.push({
      x: startX, yPos, z: startZ, speed, dir,
      anchorX: pt.x, anchorZ: pt.z,
      perpX, perpZ
    });

    dummy.position.set(startX, yPos, startZ);
    dummy.rotation.set(0, Math.atan2(perpX * dir, perpZ * dir), 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bodyIM.setMatrixAt(i, dummy.matrix);

    dummy.position.set(startX - perpX * dir * 1.8, yPos, startZ - perpZ * dir * 1.8);
    dummy.updateMatrix();
    lightIM.setMatrixAt(i, dummy.matrix);

    tmpColor.setHex(baseColor);
    lightIM.setColorAt(i, tmpColor);
  }

  bodyIM.instanceMatrix.needsUpdate  = true;
  lightIM.instanceMatrix.needsUpdate = true;
  lightIM.instanceColor.needsUpdate  = true;

  _gzCrossFlockBody   = bodyIM;
  _gzCrossFlockLights = lightIM;

  scene.add(bodyIM);
  scene.add(lightIM);
  _gzDisposables.push(bodyIM);
  _gzDisposables.push(lightIM);
}

// ── V4.3 Drone flock — small chaotic sprite drones around the track ──────
//
// Different silhouette from the box-shaped flying cars: tiny glowing dots
// that buzz around the track in chaotic figure-8 paths. Sprite-based
// (auto-faces camera, 1 DC per drone). Multiple altitude bands (8-22u),
// faster than cars (18-26 u/s), with sinusoidal y-bob for visual chaos.
//
// V5 Phase F: bumped 12d→24d (mobile kept at 6 to protect FPS). Total: 24d/6m draw calls.
function _gzBuildDroneFlock(scene){
  if(typeof trackCurve === 'undefined') return;
  const mob   = !!window._isMobile;
  const COUNT = mob ? 6 : 24;

  const COLORS = [0x00e0ff, 0xff2080, 0xffd070, 0x80ff40, 0xff8030, 0xff60a0];

  const glowGeo = new THREE.PlaneGeometry(1.4, 1.4);
  const glowMat = new THREE.MeshBasicMaterial({
    map:         _gzGetLightTex(),
    transparent: true,
    opacity:     0.95,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    fog:         false,
    side:        THREE.DoubleSide
  });

  const glowIM = new THREE.InstancedMesh(glowGeo, glowMat, COUNT);
  glowIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
  glowIM.renderOrder = -3;

  _gzDroneFlock.length = 0;
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  for(let i = 0; i < COUNT; i++){
    const t   = ((i + 0.13) / COUNT) % 1;
    const pt  = trackCurve.getPoint(t);
    const baseColor = COLORS[i % COLORS.length];

    const baseY  = Math.max(10, 12 + (i * 1.6) % 12);
    const phase  = i * 1.41;
    const speed  = 18 + (Math.sin(i * 2.7) * 0.5 + 0.5) * 8;
    const orbitR = 25 + (Math.sin(i * 3.3) * 0.5 + 0.5) * 30;

    _gzDroneFlock.push({
      anchorX: pt.x,
      anchorZ: pt.z,
      baseY,
      phase,
      speed,
      orbitR
    });

    dummy.position.set(pt.x, baseY, pt.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    glowIM.setMatrixAt(i, dummy.matrix);

    tmpColor.setHex(baseColor);
    glowIM.setColorAt(i, tmpColor);
  }

  glowIM.instanceMatrix.needsUpdate = true;
  glowIM.instanceColor.needsUpdate  = true;

  _gzDroneFlockIM = glowIM;

  scene.add(glowIM);
  _gzDisposables.push(glowIM);
}

// ── V5 Phase E — Sky Lasers: vertical multi-color beams ──────────────────
//
// 8 desktop / 4 mobile vertical light beams shooting from rooftop positions
// upward. ONE InstancedMesh of CylinderGeometry (unit-height, scaled per-
// instance). Colors: magenta/cyan/blue/green/gold — explicitly multi-color
// per user request (not just pink).
// Per-frame: subtle opacity pulse via sine modulation on material opacity.
let _gzSkyLasers = null;  // InstancedMesh ref for per-frame pulse

// ── V5.1 Phase A — Jellyfish hologram state ─────────────────────────────────
let _gzJellyfishBell = null;       // bell Mesh ref for per-frame Y rotation
let _gzJellyfishTentacles = null;  // tentacle InstancedMesh for per-frame wave
let _gzJellyfishAnchor = null;     // {x, z, baseY} for animation reference

// ── V5.1 Phase B — Searchlight beam state ────────────────────────────────────
let _gzSearchlights = null;        // InstancedMesh of searchlight cones
let _gzSearchlightData = [];       // per-instance {x, y, z, baseAngle, tilt, color}

// ── V5.3 Variant towers — silhouette variety pass ─────────────────────────
//
// _gzBuildTracksideBuildings and _gzBuildHeroTowers both render plain
// boxes scaled to varying sizes — owner feedback was that the skyline
// reads as a uniform block of identical shapes.
//
// This builder adds 14 desktop / 7 mobile EXTRA towers placed between
// the boxy trackside set, each picking a non-box silhouette: thin
// cylindrical needle, stepped pyramid (ziggurat), or box-with-spire.
// Three InstancedMesh groups (one per shape family) = 3 DC desktop,
// 3 DC mobile. Geometry sources kept low-poly (cyl segs 8, ziggurat
// 3 stacked boxes, spire = box + cone) to protect mobile triangle
// budget.
function _gzBuildVariantTowers(scene){
  if(typeof trackCurve === 'undefined') return;
  const mob   = !!window._isMobile;
  const COUNT = mob ? 7 : 14;

  // Three subgroups: needle (cyl), ziggurat (3-stack box), spire (box+cone)
  const NEEDLE_GEO   = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const ZIGGURAT_GEO = new THREE.BoxGeometry(1, 1, 1);
  const SPIRE_BOX    = new THREE.BoxGeometry(1, 1, 1);
  const SPIRE_CAP    = new THREE.ConeGeometry(0.5, 1, 6);

  // Shared dark base material (no map — silhouettes only). Slight
  // emissive blue/purple so they don't crush to pure black at distance.
  const baseMat = new THREE.MeshBasicMaterial({ color: 0x161422, fog: true });
  const capMat  = new THREE.MeshBasicMaterial({ color: 0x261d36, fog: true });

  // Per-group capacity guesses; over-allocate to leave InstancedMesh
  // count headroom (we set .count to the real fill afterwards).
  const needleIM   = new THREE.InstancedMesh(NEEDLE_GEO,   baseMat, COUNT);
  const ziggBaseIM = new THREE.InstancedMesh(ZIGGURAT_GEO, baseMat, COUNT * 3);
  const spireBoxIM = new THREE.InstancedMesh(SPIRE_BOX,    baseMat, COUNT);
  const spireCapIM = new THREE.InstancedMesh(SPIRE_CAP,    capMat,  COUNT);
  needleIM.renderOrder   = -6;
  ziggBaseIM.renderOrder = -6;
  spireBoxIM.renderOrder = -6;
  spireCapIM.renderOrder = -6;
  needleIM.count   = 0;
  ziggBaseIM.count = 0;
  spireBoxIM.count = 0;
  spireCapIM.count = 0;

  const dummy = new THREE.Object3D();
  const rng = (seed) => { const x = Math.sin(seed * 9.871 + 17.432) * 47831.5; return x - Math.floor(x); };

  // Place along trackCurve at irregular t-values; offset SIDE-OFF so
  // they sit beyond the boxy buildings (which use sideOff 14-22u).
  for(let i = 0; i < COUNT; i++){
    const t   = (i + 0.5) / COUNT;
    const pt  = trackCurve.getPoint(t);
    const tg  = trackCurve.getTangent(t).normalize();
    const nrX = -tg.z;
    const nrZ =  tg.x;
    const side    = (rng(i * 5.1) > 0.5) ? 1 : -1;
    const sideOff = 28 + rng(i * 2.3) * 22;   // 28-50u — outside box-buildings
    const px = pt.x + nrX * sideOff * side;
    const pz = pt.z + nrZ * sideOff * side;

    const shapeRoll = rng(i * 3.7);
    if(shapeRoll < 0.40){
      // ── Needle (thin cylinder) ──
      const r = 1.2 + rng(i * 7.1) * 1.6;     // radius 1.2-2.8u
      const h = 60  + rng(i * 8.3) * 90;      // 60-150u tall
      dummy.position.set(px, h * 0.5, pz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(r, h, r);
      dummy.updateMatrix();
      needleIM.setMatrixAt(needleIM.count, dummy.matrix);
      needleIM.count++;
    } else if(shapeRoll < 0.70){
      // ── Ziggurat (3 stacked boxes, each smaller than the one below) ──
      // Vertical stack along y, each segment 0.7× the footprint of below.
      const baseW = 8 + rng(i * 9.1) * 6;     // 8-14u
      const baseD = 6 + rng(i * 4.3) * 5;     // 6-11u
      const segH  = 18 + rng(i * 6.7) * 10;   // 18-28u per segment
      let curY = 0;
      for(let s = 0; s < 3; s++){
        const scaleF = Math.pow(0.72, s);
        const w = baseW * scaleF;
        const d = baseD * scaleF;
        const h = segH;
        dummy.position.set(px, curY + h * 0.5, pz);
        dummy.rotation.set(0, Math.atan2(-nrX * side, -nrZ * side), 0);
        dummy.scale.set(w, h, d);
        dummy.updateMatrix();
        if(ziggBaseIM.count < ziggBaseIM.instanceMatrix.count){
          ziggBaseIM.setMatrixAt(ziggBaseIM.count, dummy.matrix);
          ziggBaseIM.count++;
        }
        curY += h;
      }
    } else {
      // ── Spire (box body + cone cap) ──
      const w = 4 + rng(i * 11.3) * 5;        // 4-9u
      const d = w * (0.7 + rng(i * 13.1) * 0.5);
      const bodyH = 70 + rng(i * 14.7) * 70;   // 70-140u body
      const capH  = 18 + rng(i * 15.9) * 14;   // 18-32u cap
      dummy.position.set(px, bodyH * 0.5, pz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(w, bodyH, d);
      dummy.updateMatrix();
      spireBoxIM.setMatrixAt(spireBoxIM.count, dummy.matrix);
      spireBoxIM.count++;
      // Cap sits ON the body
      dummy.position.set(px, bodyH + capH * 0.5, pz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(w * 0.9, capH, d * 0.9);
      dummy.updateMatrix();
      spireCapIM.setMatrixAt(spireCapIM.count, dummy.matrix);
      spireCapIM.count++;
    }
  }

  needleIM.instanceMatrix.needsUpdate   = true;
  ziggBaseIM.instanceMatrix.needsUpdate = true;
  spireBoxIM.instanceMatrix.needsUpdate = true;
  spireCapIM.instanceMatrix.needsUpdate = true;

  if(needleIM.count   > 0){ scene.add(needleIM);   _gzDisposables.push(needleIM);   }
  if(ziggBaseIM.count > 0){ scene.add(ziggBaseIM); _gzDisposables.push(ziggBaseIM); }
  if(spireBoxIM.count > 0){ scene.add(spireBoxIM); _gzDisposables.push(spireBoxIM); }
  if(spireCapIM.count > 0){ scene.add(spireCapIM); _gzDisposables.push(spireCapIM); }
}

function _gzBuildSkyLasers(scene){
  const mob   = !!window._isMobile;
  // 2026-05-11 bump per owner feedback "die blauwe lichtkolom ziet er
  // supercool uit, mag vaker voorkomen in andere kleuren": 8→18 desktop,
  // 4→10 mobile. Cylinder is a 6-sided low-poly tube on InstancedMesh
  // so the extra instances cost ~nothing.
  const COUNT = mob ? 10 : 18;

  // Two pools: a "hero" pool of strong cyan/teal accents (the colour
  // the owner specifically called out as supercool) and a "neon" pool
  // with magenta, pink, green, gold for variety. Hero takes ~40% of
  // instances so cyan reads as the dominant accent across the skyline.
  const HERO_POOL = [0x00e0ff, 0x40d0ff, 0x60ffff, 0x20a0ff];
  const NEON_POOL = [0xff20a0, 0xff60a0, 0x80ff40, 0xffd070, 0xa080ff, 0xff8030];

  const geo = new THREE.CylinderGeometry(0.4, 0.4, 1, 6);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity:     0.70,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    fog:         false
  });

  const iMesh = new THREE.InstancedMesh(geo, mat, COUNT);
  iMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
  iMesh.renderOrder = -7;

  const rng = (seed) => { const x = Math.sin(seed * 9.871 + 17.432) * 47831.5; return x - Math.floor(x); };
  const dummy   = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  for(let i = 0; i < COUNT; i++){
    const angle  = rng(i * 3.7) * Math.PI * 2;
    // Widened radius band so some lasers sit close-ish (visible from
    // cockpit during cornering) and others stay on the distant horizon.
    const radius = 70 + rng(i * 2.1) * 200;    // 70-270u from origin
    // Wider height range — a mix of tall "search-beams reaching the
    // overcast" and shorter "stacked rooftop lasers" for visual rhythm.
    const height = 60 + rng(i * 4.3) * 200;    // 60-260u tall
    const baseY  = 14 + rng(i * 1.9) * 90;     // base at 14-104u
    // Per-instance slight thickness variation so they don't read as a
    // perfect tube row. Scale x/z together so cylinder stays circular.
    const thick  = 0.7 + rng(i * 5.1) * 0.8;   // 0.7-1.5×

    const lx = Math.cos(angle) * radius;
    const lz = Math.sin(angle) * radius;
    dummy.position.set(lx, baseY + height * 0.5, lz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(thick, height, thick);
    dummy.updateMatrix();
    iMesh.setMatrixAt(i, dummy.matrix);

    // ~40% hero cyan pool, ~60% neon pool — biases the skyline cyan
    // (the colour explicitly called out) without making everything blue.
    const isHero = rng(i * 6.7) < 0.40;
    const pool   = isHero ? HERO_POOL : NEON_POOL;
    tmpColor.setHex(pool[i % pool.length]);
    iMesh.setColorAt(i, tmpColor);
  }

  iMesh.instanceMatrix.needsUpdate = true;
  iMesh.instanceColor.needsUpdate  = true;

  _gzSkyLasers = iMesh;
  scene.add(iMesh);
  _gzDisposables.push(iMesh);
}

// ── V5.1 Phase A — Jellyfish hologram landmark ───────────────────────────────
//
// Magenta bell + cyan tentacles at track curve apex t=0.5, sideOffset 14u,
// y=18u. Gently rotates and bobs per-frame via _gzJellyfishBell refs.
// DC: +2 (bell Mesh + tentacle InstancedMesh).
function _gzBuildJellyfish(scene){
  if(typeof trackCurve === 'undefined') return;

  const pt  = trackCurve.getPoint(0.5);
  const tg  = trackCurve.getTangent(0.5).normalize();
  // Normal vector (perpendicular to tangent, in XZ plane)
  const nrX = -tg.z;
  const nrZ =  tg.x;
  const SIDE_OFFSET = 14;
  const baseY = 18;
  const jx = pt.x + nrX * SIDE_OFFSET;
  const jz = pt.z + nrZ * SIDE_OFFSET;

  // Bell: flattened sphere (0.9, 0.55, 0.9 scale for dome shape)
  const bellGeo = new THREE.SphereGeometry(4, 16, 12);
  const bellMat = new THREE.MeshBasicMaterial({
    color:       0xff20a0,
    transparent: true,
    opacity:     0.55,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    fog:         false,
    side:        THREE.DoubleSide
  });
  const bell = new THREE.Mesh(bellGeo, bellMat);
  bell.scale.set(0.9, 0.55, 0.9);
  bell.position.set(jx, baseY, jz);
  scene.add(bell);
  _gzJellyfishBell = bell;
  _gzDisposables.push(bell);

  // Tentacles: 8 thin cylinders in InstancedMesh, distributed around bell base
  const TENTACLE_COUNT = 8;
  const tentGeo = new THREE.CylinderGeometry(0.08, 0.04, 6, 4);
  const tentMat = new THREE.MeshBasicMaterial({
    color:       0x00e0ff,
    transparent: true,
    opacity:     0.45,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    fog:         false
  });
  const tentIM = new THREE.InstancedMesh(tentGeo, tentMat, TENTACLE_COUNT);
  const tentDummy = new THREE.Object3D();
  const CIRCLE_R = 2.5;
  const tentY = baseY - 3;  // hang below bell
  for(let i = 0; i < TENTACLE_COUNT; i++){
    const angle = (i / TENTACLE_COUNT) * Math.PI * 2;
    const tx = jx + Math.cos(angle) * CIRCLE_R;
    const tz = jz + Math.sin(angle) * CIRCLE_R;
    tentDummy.position.set(tx, tentY, tz);
    // Slight outward tilt
    tentDummy.rotation.set(Math.cos(angle) * 0.18, 0, Math.sin(angle) * 0.18);
    tentDummy.updateMatrix();
    tentIM.setMatrixAt(i, tentDummy.matrix);
  }
  tentIM.instanceMatrix.needsUpdate = true;
  scene.add(tentIM);
  _gzJellyfishTentacles = tentIM;
  _gzJellyfishAnchor = { x: jx, z: jz, baseY };
  _gzDisposables.push(tentIM);
}

// ── V5.1 Phase B — Searchlight beams sweeping the sky ────────────────────────
//
// 4 desktop / 2 mobile rotating cone beams from rooftop positions.
// ONE InstancedMesh of CylinderGeometry(2.0, 8.0, 80) — wider at top (sky),
// narrower at base (rooftop). Per-frame: each instance rotates around Y-axis.
// DC: +1.
function _gzBuildSearchlights(scene){
  const mob   = !!window._isMobile;
  const POSITIONS_DESKTOP = [
    [180, 80, 200],
    [-200, 75, 180],
    [240, 85, -160],
    [-180, 70, -200]
  ];
  const POSITIONS_MOBILE = [
    [180, 80, 200],
    [-200, 75, 180]
  ];
  const positions = mob ? POSITIONS_MOBILE : POSITIONS_DESKTOP;
  const COUNT = positions.length;

  const COLOR_POOL = [0xffffff, 0xff20a0, 0x00e0ff, 0xffd070, 0x80ff40, 0xff60a0];

  // Wider at top (sky end), narrower at base (rooftop). Open cylinder (no caps).
  const geo = new THREE.CylinderGeometry(2.0, 8.0, 80, 8, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color:       0xffffff,
    transparent: true,
    opacity:     0.32,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    fog:         false,
    side:        THREE.DoubleSide
  });

  const iMesh = new THREE.InstancedMesh(geo, mat, COUNT);
  iMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
  const dummy   = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  // Tilts array — slight outward lean so beam sweeps an angle
  const baseTilts = [-0.22, -0.28, -0.34, -0.20];

  for(let i = 0; i < COUNT; i++){
    const [px, py, pz] = positions[i];
    const tilt = baseTilts[i % baseTilts.length];
    const baseAngle = (i / COUNT) * Math.PI * 2;

    // Position cylinder: center is at rooftop + half cylinder height above
    dummy.position.set(px, py + 40, pz);
    dummy.rotation.set(tilt, baseAngle, 0);
    dummy.updateMatrix();
    iMesh.setMatrixAt(i, dummy.matrix);

    tmpColor.setHex(COLOR_POOL[i % COLOR_POOL.length]);
    iMesh.setColorAt(i, tmpColor);

    _gzSearchlightData.push({ x: px, y: py + 40, z: pz, baseAngle, tilt });
  }

  iMesh.instanceMatrix.needsUpdate = true;
  iMesh.instanceColor.needsUpdate  = true;

  _gzSearchlights = iMesh;
  scene.add(iMesh);
  _gzDisposables.push(iMesh);
}

// ── V5.1 Phase C — Street-level props: vending machines ──────────────────────
//
// Vending machines: 16d/4m InstancedMesh (BoxGeometry), CanvasTexture showing
// glowing screen panels. Distributed along track curve at sidewalk edge.
// DC: +1 (vending IM).
function _gzBuildStreetProps(scene){
  if(typeof trackCurve === 'undefined') return;
  const mob = !!window._isMobile;

  // ── Vending machine canvas texture ──
  const CV_W = 256, CV_H = 512;
  const cv = document.createElement('canvas');
  cv.width = CV_W; cv.height = CV_H;
  const cg = cv.getContext('2d');
  // Dark base
  cg.fillStyle = '#0a0612';
  cg.fillRect(0, 0, CV_W, CV_H);
  // Bright stripe panels
  const STRIPE_COLORS = ['#00e0ff', '#ff2080', '#ffd070', '#ff4040'];
  const stripeYs = [40, 140, 260, 380];
  for(let s = 0; s < 4; s++){
    const sy = stripeYs[s];
    cg.shadowBlur = 18;
    cg.shadowColor = STRIPE_COLORS[s];
    cg.fillStyle = STRIPE_COLORS[s];
    cg.globalAlpha = 0.9;
    cg.fillRect(20, sy, CV_W - 40, 60);
    cg.globalAlpha = 1;
    cg.shadowBlur = 0;
  }
  // Thin separator lines
  cg.strokeStyle = '#ffffff';
  cg.globalAlpha = 0.12;
  for(let y = 0; y < CV_H; y += 64){
    cg.beginPath(); cg.moveTo(0, y); cg.lineTo(CV_W, y); cg.stroke();
  }
  cg.globalAlpha = 1;
  const vendTex = new THREE.CanvasTexture(cv);

  // ── Vending machines ──
  const VEND_COUNT = mob ? 4 : 16;
  const vendGeo = new THREE.BoxGeometry(1.4, 2.0, 0.8);
  const vendMat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: vendTex, fog: false });
  const vendIM  = new THREE.InstancedMesh(vendGeo, vendMat, VEND_COUNT);
  vendIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(VEND_COUNT * 3), 3);
  const VEND_COLORS = [0xffffff, 0xeeeefb, 0xfff0d0];
  const vendDummy = new THREE.Object3D();
  const tmpColor  = new THREE.Color();

  for(let i = 0; i < VEND_COUNT; i++){
    const t  = i / VEND_COUNT;
    const pt = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    const nrX = -tg.z;
    const nrZ =  tg.x;
    // Alternate sides, distance 14-16u from center (TW=13, need ≥14 to clear track edge).
    // V5.3 Issue 2: was 4.5-6u — ON the track. Pushed to 14-16u (sidewalk outside kerb).
    const side   = (i % 2 === 0) ? 1 : -1;
    const offset = 14.5 + (i % 3) * 0.5;
    vendDummy.position.set(
      pt.x + nrX * offset * side,
      1.0,
      pt.z + nrZ * offset * side
    );
    // Face track center: rotate toward track tangent
    vendDummy.rotation.set(0, Math.atan2(nrX * side, nrZ * side), 0);
    vendDummy.updateMatrix();
    vendIM.setMatrixAt(i, vendDummy.matrix);
    tmpColor.setHex(VEND_COLORS[i % VEND_COLORS.length]);
    vendIM.setColorAt(i, tmpColor);
  }
  vendIM.instanceMatrix.needsUpdate = true;
  vendIM.instanceColor.needsUpdate  = true;
  scene.add(vendIM);
  _gzDisposables.push(vendIM);
}

// ── V5 Phase C — Overhead Highway: 60 flying cars on 2 InstancedMesh ────
//
// 60 desktop / 30 mobile cars OVER the track at y=8-16u. Two InstancedMesh:
// bodies (dark BoxGeometry) and rear-lights (PlaneGeometry with per-instance
// color). Cars advance along trackCurve each frame at 0.018-0.028 t/s,
// 50/50 split with-track vs against-track, scattered 5-12u laterally.
function _gzBuildOverheadHighway(scene){
  if(typeof trackCurve === 'undefined') return;
  const mob   = !!window._isMobile;
  const COUNT = mob ? 30 : 60;

  const bodyGeo  = _gzMakeHovercarGeometry(2.4, 0.5, 1.0);
  const bodyMat  = new THREE.MeshBasicMaterial({ color: 0x202028, fog: false });
  const lightGeo = new THREE.PlaneGeometry(0.6, 0.6);
  const lightMat = new THREE.MeshBasicMaterial({
    color:       0xff60a0,
    transparent: true,
    opacity:     0.95,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    fog:         false,
    side:        THREE.DoubleSide
  });

  const bodyIM  = new THREE.InstancedMesh(bodyGeo, bodyMat, COUNT);
  const lightIM = new THREE.InstancedMesh(lightGeo, lightMat, COUNT);
  lightIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
  bodyIM.renderOrder  = -4;
  lightIM.renderOrder = -4;

  const rng = (seed) => { const x = Math.sin(seed * 9.871 + 17.432) * 47831.5; return x - Math.floor(x); };
  const LIGHT_COLORS = [0xff60a0, 0x00e0ff, 0xffd070, 0x80ff40, 0xff2080, 0x40c0ff];
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  _gzHighwayData.length = 0;

  for(let i = 0; i < COUNT; i++){
    const tBase   = i / COUNT;
    const dir     = (i % 2 === 0) ? 1 : -1;
    const lateral = (5 + rng(i * 3.7) * 7) * (rng(i * 5.1) > 0.5 ? 1 : -1);
    const yPos    = Math.max(10, 10 + rng(i * 2.3) * 6);   // 10-16u above ground, hard minimum 10u (Issue 7/8 Y-clamp)
    const speed   = 0.018 + rng(i * 4.1) * 0.010;  // 0.018-0.028 t/s

    _gzHighwayData.push({ tBase, lateral, dir, speed, yPos });

    // Initial matrix placement
    const pt = trackCurve.getPoint(tBase);
    const tg = trackCurve.getTangent(tBase).normalize();
    const nrX = -tg.z;
    const nrZ =  tg.x;
    dummy.position.set(pt.x + nrX * lateral, yPos, pt.z + nrZ * lateral);
    dummy.rotation.set(0, Math.atan2(tg.x * dir, tg.z * dir), 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bodyIM.setMatrixAt(i, dummy.matrix);

    // Rear-light: offset behind body along tangent
    const rearX = pt.x + nrX * lateral - tg.x * dir * 1.6;
    const rearZ = pt.z + nrZ * lateral - tg.z * dir * 1.6;
    dummy.position.set(rearX, yPos, rearZ);
    dummy.rotation.set(0, Math.atan2(tg.x * dir, tg.z * dir), 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    lightIM.setMatrixAt(i, dummy.matrix);

    tmpColor.setHex(LIGHT_COLORS[i % LIGHT_COLORS.length]);
    lightIM.setColorAt(i, tmpColor);
  }

  bodyIM.instanceMatrix.needsUpdate  = true;
  lightIM.instanceMatrix.needsUpdate = true;
  lightIM.instanceColor.needsUpdate  = true;

  _gzHighway       = bodyIM;
  _gzHighwayLights = lightIM;

  scene.add(bodyIM);
  scene.add(lightIM);
  _gzDisposables.push(bodyIM);
  _gzDisposables.push(lightIM);
}

// ── V4.4 Ground traffic — civilian cars driving along the track ──────────
//
// Race track currently has only AI rivals + parked cars never shipped.
// User feedback / virtual-gamer observation: feels like a test track in a
// dead city, not a megacity at rush hour. This builder spawns civilian
// cars that follow trackCurve at constant speed, looping the lap forever.
//
// 24 desktop / 12 mobile cars on ONE InstancedMesh = 1 DC. Each car has
// its own tBase, lateral offset, direction (alternating: with-traffic /
// oncoming), and speed. Per-frame: tBase advances, position is sampled
// from trackCurve at that t plus lateral perpendicular offset.
//
// y is fixed at 0.4u (slightly above track surface). Cars are dark with
// faint emissive tint — they should READ as silhouettes with rear-lights
// rather than dominating the scene.
function _gzBuildGroundTraffic(scene){
  if(typeof trackCurve === 'undefined') return;
  const mob   = !!window._isMobile;
  const COUNT = mob ? 12 : 24;

  // Sedan-style silhouette (was BoxGeometry pre-2026-05-11). Same
  // overall bounding-box, dual-tier shape with cabin pulled toward the
  // rear so the cars stop reading as "blokjes glijden over de baan".
  const bodyGeo = _gzMakeGroundCarGeometry(2.4, 0.6, 1.1);
  const bodyMat = new THREE.MeshBasicMaterial({
    color: 0x1c1c24,
    fog:   false
  });

  const iMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, COUNT);
  iMesh.renderOrder = -3;

  _gzGroundTrafficData.length = 0;
  const dummy = new THREE.Object3D();
  const rng = (seed) => { const x = Math.sin(seed * 9.871 + 17.432) * 47831.5; return x - Math.floor(x); };

  for(let i = 0; i < COUNT; i++){
    // Spread initial t evenly. Half travel forward (dir=1), half oncoming (dir=-1)
    const tBase   = i / COUNT;
    const dir     = (i % 2 === 0) ? 1 : -1;
    // 2026-05-11: bumped lateral from ±3.5-5 → ±9-13 per owner
    // feedback "gekke autootjes op de baan". At the old offsets the
    // civilian cars sat ON the racing line (track half-width ~3.5u)
    // and read as game bugs. New range puts them on a parallel
    // service road well clear of the racing surface.
    const lateral = (i % 2 === 0) ? -9 - rng(i * 1.7) * 4 : 9 + rng(i * 2.3) * 4;
    const speed   = 0.012 + rng(i * 3.1) * 0.006;  // t-units per second (~one full lap in 80-110s)

    _gzGroundTrafficData.push({ tBase, lateral, dir, speed });

    // Initial matrix — will be re-computed every frame, this is just spawn
    const pt = trackCurve.getPoint(tBase);
    const tg = trackCurve.getTangent(tBase).normalize();
    const nrX = -tg.z;
    const nrZ =  tg.x;
    dummy.position.set(pt.x + nrX * lateral, 0.4, pt.z + nrZ * lateral);
    dummy.rotation.set(0, Math.atan2(tg.x * dir, tg.z * dir), 0);
    dummy.updateMatrix();
    iMesh.setMatrixAt(i, dummy.matrix);
  }
  iMesh.instanceMatrix.needsUpdate = true;

  _gzGroundTraffic = iMesh;
  scene.add(iMesh);
  _gzDisposables.push(iMesh);
}

// ── V5.2 Headlamp pool — soft elliptical light pool following player car ──
//
// Replaces the hard halo that some camera angles show under the player. Soft
// radial-gradient ellipse (7×4u, wider front-to-back than side-to-side) on
// AdditiveBlending PlaneGeometry. Sits flat on the ground (y=0.05u) and
// re-positions per-frame to the player car. Pure cosmetic, +1 DC.
function _gzBuildHeadlampPool(scene){
  if(_gzHeadlampPool) return;  // _gen guard

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0,   'rgba(255, 240, 200, 0.55)');
  grad.addColorStop(0.4, 'rgba(255, 220, 180, 0.30)');
  grad.addColorStop(0.7, 'rgba(255, 200, 160, 0.10)');
  grad.addColorStop(1,   'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);

  const mat = new THREE.MeshBasicMaterial({
    map:         tex,
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
    fog:         false
  });
  // Ellipse via PlaneGeometry 7×4 — long front-to-back, narrow side-to-side
  const geo  = new THREE.PlaneGeometry(7, 4);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;   // lie flat on the ground
  mesh.position.y = 0.05;            // hair above ground to avoid z-fight
  mesh.renderOrder = -2;
  scene.add(mesh);
  _gzHeadlampPool = mesh;
  _gzDisposables.push(mesh);
  _gzDisposables.push(tex);
}

// ── Guangzhou drizzle particle pool ──────────────────────────────────────
//
// Light urban mist / fine rain — lighter than pier47's harbour drizzle.
// THREE.Points (1 draw call) tracks the player. Positions wrap per frame
// in updateGuangzhouWorld. Rolling-buffer update mirrors pier47 / volcano-
// ember pattern: process ~50 particles per frame so the full pool cycles
// every ~6 frames at 60fps.
//
// Color: cool grey #8a96a8 (more blue than pier47's #9aa6b8 — neon-tinged
// urban mist). Opacity 0.35 (vs pier47's 0.45 — finer drizzle).
// sizeAttenuation: false so streaks stay uniform-sized at all distances.
function _gzBuildDrizzle(){
  if(_gzDrizzleGeo) return;   // _gen guard
  const mob = !!window._isMobile;
  const N   = mob ? 180 : 300;
  _gzDrizzleGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  for(let i = 0; i < N; i++){
    pos[i*3]   = (Math.random() - 0.5) * 200;
    pos[i*3+1] = Math.random() * 28;
    pos[i*3+2] = (Math.random() - 0.5) * 200;
  }
  _gzDrizzleGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color:           0x8a96a8,   // cool blue-grey urban mist
    size:            0.85,
    transparent:     true,
    opacity:         0.35,
    sizeAttenuation: false,      // uniform streak size at all distances
    depthWrite:      false       // don't occlude fog/lights
  });
  _gzDrizzle = new THREE.Points(_gzDrizzleGeo, mat);
  scene.add(_gzDrizzle);
  // _gzDisposables not used here — scene traversal handles Points disposal.
  // _gzDrizzleGeo / _gzDrizzle nulled via activeWorld guard in updateGuangzhouWorld
  // when world switches (the Points stays in scene graph until disposeScene).
}

// ── Pearl River boulevard guardrails ─────────────────────────────────────
//
// Low concrete guardrail run along one side of the track (river side).
// Each segment: a thin horizontal box 4u wide × 0.35u tall × 0.18u deep.
// Mounted on short posts (separate InstancedMesh to keep draw-calls minimal
// — post mesh is simple, one instance per segment is fine).
//
// Placement: left side of track (side = -1 in track-normal convention),
// spaced every ~3u of track arc-length, from t=0.05 to t=0.90 to leave
// room around the start/finish gantry.
//
// Mobile budget: 60 instances desktop / 30 mobile.
// Both rail-top and post share MeshLambertMaterial — no emissive.
function _gzBuildGuardrails(){
  if(_gzGuardrailMesh) return;   // _gen guard
  if(typeof trackCurve === 'undefined') return;
  const mob  = !!window._isMobile;
  const N    = mob ? 30 : 60;
  // Guardrail segment geometry — thin horizontal slab
  const railGeo = new THREE.BoxGeometry(4.0, 0.35, 0.18);
  const railMat = new THREE.MeshLambertMaterial({ color: 0x1a1c24 });
  _gzGuardrailMesh = new THREE.InstancedMesh(railGeo, railMat, N);
  _gzGuardrailMesh.receiveShadow = false;
  _gzGuardrailMesh.castShadow    = false;
  // Post geometry — thin cylinder under each rail segment
  const postGeo  = new THREE.BoxGeometry(0.12, 0.8, 0.12);
  const postMat  = new THREE.MeshLambertMaterial({ color: 0x141618 });
  const postMesh = new THREE.InstancedMesh(postGeo, postMat, N);
  const dummy = new THREE.Object3D();
  const SIDE_OFF = BARRIER_OFF + 4.5;  // river side: further out than lamp poles
  const T_START  = 0.05;
  const T_END    = 0.90;
  for(let i = 0; i < N; i++){
    const t  = T_START + (i / N) * (T_END - T_START);
    const p  = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    const nr = new THREE.Vector3(-tg.z, 0, tg.x);  // left normal
    const ang = Math.atan2(tg.x, tg.z);
    const rx = p.x - nr.x * SIDE_OFF;
    const rz = p.z - nr.z * SIDE_OFF;
    // Rail segment
    dummy.position.set(rx, 0.6, rz);
    dummy.rotation.set(0, ang, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    _gzGuardrailMesh.setMatrixAt(i, dummy.matrix);
    // Post
    dummy.position.set(rx, 0.2, rz);
    dummy.rotation.set(0, ang, 0);
    dummy.updateMatrix();
    postMesh.setMatrixAt(i, dummy.matrix);
  }
  _gzGuardrailMesh.instanceMatrix.needsUpdate = true;
  postMesh.instanceMatrix.needsUpdate = true;
  scene.add(_gzGuardrailMesh);
  scene.add(postMesh);
}

// ── Neon billboard frames ─────────────────────────────────────────────────
//
// Canvas-painted neon billboards — Chinese CBD advertising. Six desktop /
// three mobile. Each is a PlaneGeometry with a CanvasTexture, MeshBasicMaterial
// with AdditiveBlending (so the glow blooms through the dark scene), and
// a PointLight behind it for local scene illumination.
//
// Text content: mix of Chinese characters (广州, 珠江, 广州赛车俱乐部) and
// transliterated racing phrases. Colors: alternating neonMagenta / neonCyan
// from _GZ_PALETTE.
//
// Placement: alternating sides, t-offsets spaced evenly from 0.12 to 0.88,
// at BARRIER_OFF + 18..28u lateral offset (further than lamp poles at +2.4u).
// Height: 9..14u (center of billboard face), scale 16×4u.
//
// Billboard PointLights: intensity 1.0, range 16, color-matched to board.
// Each pushed to trackLightList so scene.js cleanup handles them automatically.
function _gzBuildBillboards(){
  if(_gzBillboards.length) return;   // _gen guard
  if(typeof trackCurve === 'undefined') return;
  const mob = !!window._isMobile;
  const COUNT = mob ? 3 : 6;

  // Content and colors — alternating magenta/cyan
  const boards = [
    { text: '广州赛车俱乐部', sub: 'GUANGZHOU RACE CLUB', color: _GZ_PALETTE.neonMagenta },
    { text: '珠江夜速',       sub: 'PEARL RIVER NIGHT RUN', color: _GZ_PALETTE.neonCyan  },
    { text: '广州 · GP',     sub: 'SPENCER\'S RACE CLUB',  color: _GZ_PALETTE.neonMagenta },
    { text: '极速广州',       sub: 'MAXIMUM VELOCITY',      color: _GZ_PALETTE.neonCyan  },
    { text: '赛道之王',       sub: 'KING OF THE CIRCUIT',   color: _GZ_PALETTE.neonMagenta },
    { text: '南沙湾夜赛',    sub: 'NANSHA BAY NIGHT RACE', color: _GZ_PALETTE.neonCyan  },
  ];

  const dummy = new THREE.Object3D();

  // Hoisted pole material + geometry — shared across all billboard poles.
  // poleMat: single MeshLambertMaterial compile instead of COUNT separate ones.
  // poleGeo: CylinderGeometry at median pole height (11.5u); pole position.y
  //   still derived from per-billboard bh so visual fit is close across all poles.
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x141820 });
  const poleGeo = new THREE.CylinderGeometry(0.10, 0.14, 11.5, 6);

  for(let i = 0; i < COUNT; i++){
    const board  = boards[i % boards.length];
    const t      = 0.12 + (i / COUNT) * 0.76;
    const p      = trackCurve.getPoint(t);
    const tg     = trackCurve.getTangent(t).normalize();
    const nr     = new THREE.Vector3(-tg.z, 0, tg.x);
    const side   = (i % 2 === 0) ? 1 : -1;
    const latOff = BARRIER_OFF + 18 + (i % 3) * 3.5;   // 18..24u from barrier
    const bx     = p.x + nr.x * side * latOff;
    const bz     = p.z + nr.z * side * latOff;
    const bh     = 10 + (i % 3) * 1.5;   // 10..13u center height

    // Canvas texture — 512×128 for crisp text on desktop
    const cvs = document.createElement('canvas');
    cvs.width  = 512;
    cvs.height = 128;
    const ctx  = cvs.getContext('2d');
    const hex  = '#' + board.color.toString(16).padStart(6, '0');

    // Dark panel background
    ctx.fillStyle = 'rgba(4,4,12,0.85)';
    ctx.fillRect(0, 0, 512, 128);

    // Neon border
    ctx.strokeStyle = hex;
    ctx.lineWidth   = 3;
    ctx.globalAlpha = 0.6;
    ctx.strokeRect(4, 4, 504, 120);
    ctx.globalAlpha = 1.0;

    // Primary Chinese text
    ctx.font        = 'bold 44px "Arial Unicode MS", Arial, sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.shadowColor = hex;
    ctx.shadowBlur  = 24;
    ctx.fillStyle   = hex;
    ctx.fillText(board.text, 256, 52);

    // Secondary Latin text
    ctx.font        = 'bold 18px "Courier New", monospace';
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = hex;
    ctx.globalAlpha = 0.80;
    ctx.fillText(board.sub, 256, 96);
    ctx.globalAlpha = 1.0;

    const tex = new THREE.CanvasTexture(cvs);
    tex.needsUpdate = true;

    // MeshBasicMaterial — AdditiveBlending so the glow blooms against dark sky
    const mat = new THREE.MeshBasicMaterial({
      map:        tex,
      transparent:true,
      opacity:    0.92,
      blending:   THREE.AdditiveBlending,
      depthWrite: false,
      side:       THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), mat);
    mesh.position.set(bx, bh, bz);
    mesh.lookAt(new THREE.Vector3(p.x, bh, p.z));  // face the track center
    scene.add(mesh);
    _gzBillboards.push(mesh);

    // Support pole — reuses hoisted poleMat + poleGeo (shared across all poles)
    const pole    = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(bx, bh * 0.5, bz);
    scene.add(pole);

    // PointLight behind the billboard for local glow — desktop only (mobile budget)
    if(!mob){
      const bl = new THREE.PointLight(board.color, 1.0, 16);
      bl.position.set(bx, bh, bz);
      scene.add(bl);
      if(typeof trackLightList !== 'undefined') trackLightList.push(bl);
    }
  }
}

// ── Skyline window emissives ──────────────────────────────────────────────
//
// Small emissive quads on the near-silhouette cylinder give the "city is
// alive" feel — lit office windows in the CBD towers. Three desktop groups /
// one mobile group, each with a shared MeshBasicMaterial animated in
// updateGuangzhouWorld via opacity.
//
// Placement: quads at radius 528, scattered in angular bands corresponding
// to where tower clusters appear on the silhouette. y-range: 8u to 85u
// (below ground-level and above tower-top are excluded). Angular range:
// full 2π (quads distributed around the full cylinder).
//
// Each group: desktop 20 quads / mobile 8 quads. Three groups = 60 desktop / 8 mobile.
// One shared MeshBasicMaterial per group — cheap.
//
// Flicker: group.phase + elapsed time drives a slow sine (period ~4..7s) on
// material opacity. Range: baseOpacity * 0.6 .. baseOpacity * 1.0.
// This suggests office lights cycling, not random per-pixel noise.
function _gzBuildSkylineWindows(){
  if(_gzWindowGroups.length) return;  // _gen guard
  const mob     = !!window._isMobile;
  const GROUPS  = mob ? 2 : 3;
  const PER_GRP = mob ? 18 : 30;
  const RADIUS  = 528;   // slightly inside near-silhouette cylinder (r=540)
  const WW      = 2.4;   // quad width (V3: +40%)
  const WH      = 1.6;   // quad height (V3: +40%)

  // Warm yellow-white window color — contrasts with the cool neon/purple scene
  const WIN_COLOR = 0xffe8b0;

  const geo = new THREE.PlaneGeometry(WW, WH);

  // Group parameters: baseOpacity, phase offset (seconds), color tint variant
  const groupDefs = [
    { baseOpacity: 0.80, phase: 0.0,  color: WIN_COLOR },   // mid-distance towers (V3 bump)
    { baseOpacity: 0.65, phase: 2.1,  color: 0xffd080  },   // far towers (V3 bump)
    { baseOpacity: 0.90, phase: 4.4,  color: 0xfff0c0  },   // near towers (V3 bump)
  ];

  const rng = (seed) => {
    const x = Math.sin(seed * 12.987 + 43.721) * 53211.7;
    return x - Math.floor(x);
  };

  for(let g = 0; g < GROUPS; g++){
    const def = groupDefs[g];
    const mat = new THREE.MeshBasicMaterial({
      color:       def.color,
      transparent: true,
      opacity:     def.baseOpacity,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
      side:        THREE.FrontSide,
      fog:         true
    });
    // Sessie 06a — per-window phase offsets stored on the group. Used
    // by _gzUpdateWindowFlicker to compute a unique brightness per
    // window via instanceColor, breaking the prior "all in sync" feel.
    // vertexColors flag on the mat lets instanceColor modulate output.
    mat.vertexColors = true;
    const iMesh = new THREE.InstancedMesh(geo, mat, PER_GRP);
    iMesh.renderOrder = -9;  // behind props, in front of silhouette cylinder (-10)
    iMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(PER_GRP * 3), 3
    );
    const _dummy = new THREE.Object3D();
    const phasesPerWin = new Float32Array(PER_GRP);
    const freqsPerWin  = new Float32Array(PER_GRP);
    for(let i = 0; i < PER_GRP; i++){
      const seed  = g * 100 + i;
      const angle = rng(seed)       * Math.PI * 2;
      const yPos  = 8 + rng(seed+1) * 77;   // 8u to 85u height
      // Position on inner surface of near-silhouette cylinder
      const qx = Math.cos(angle) * RADIUS;
      const qz = Math.sin(angle) * RADIUS;
      _dummy.position.set(qx, yPos, qz);
      // Face inward — lookAt the scene center at this height
      _dummy.lookAt(new THREE.Vector3(0, yPos, 0));
      _dummy.updateMatrix();
      iMesh.setMatrixAt(i, _dummy.matrix);
      // Per-window phase + freq: phase 0..2π, freq 0.45..1.25 rad/s.
      phasesPerWin[i] = rng(seed+2) * Math.PI * 2;
      freqsPerWin[i]  = 0.45 + rng(seed+3) * 0.80;
      // Initial color = full (1,1,1) so the first frame matches baseOpacity.
      iMesh.instanceColor.array[i*3]   = 1;
      iMesh.instanceColor.array[i*3+1] = 1;
      iMesh.instanceColor.array[i*3+2] = 1;
    }
    iMesh.instanceMatrix.needsUpdate = true;
    iMesh.instanceColor.needsUpdate = true;
    scene.add(iMesh);
    const groupRef = {
      mesh: iMesh, mat: mat, phase: def.phase, baseOpacity: def.baseOpacity,
      phases: phasesPerWin, freqs: freqsPerWin, count: PER_GRP
    };
    _gzWindowGroups.push(groupRef);
  }
}

// ── Per-frame window flicker ──────────────────────────────────────────────
//
// Slow sine per group — one opacity write per group per frame (not per-quad).
// Period: 4s (group 0) / 5.5s (group 1) / 6.8s (group 2).
function _gzUpdateWindowFlicker(dt){
  if(!_gzWindowGroups.length) return;
  const t = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now() * 0.001);
  // Round-robin stride: update count/stride vensters per frame zodat de
  // totale animatie-rate per venster 60/stride Hz blijft. 15-20Hz is ruim
  // genoeg voor 0.5-2Hz brightness-pulse (zicht-onmerkbaar) en halveert/
  // kwartiert de inner-loop cost. Voorheen werden alle 500+ vensters elke
  // frame doorlopen = 2-5ms hitch op desktop.
  const stride = window._isMobile ? 6 : 4;
  _gzWindowFlickerOffset = (_gzWindowFlickerOffset + 1) % stride;
  const off = _gzWindowFlickerOffset;
  for(let g = 0; g < _gzWindowGroups.length; g++){
    const grp = _gzWindowGroups[g];
    // Mat opacity stays at baseOpacity — per-window brightness lives in
    // instanceColor now so each window pulses with its own phase + freq.
    grp.mat.opacity = grp.baseOpacity;
    if(!grp.phases || !grp.mesh.instanceColor) continue;
    const arr = grp.mesh.instanceColor.array;
    const count = grp.count|0;
    for(let i = off; i < count; i += stride){
      const s = 0.5 + 0.5 * Math.sin(t * grp.freqs[i] + grp.phases[i]);
      // 0.45 → 1.05 per-window brightness multiplier. Tiny chance any
      // single frame produces a "lights out" 0.0 window for a snap of
      // urban realism (every ~25s per window on average).
      const v = (Math.random() < 0.00012) ? 0.0 : (0.45 + 0.60 * s);
      arr[i*3]   = v;
      arr[i*3+1] = v;
      arr[i*3+2] = v;
    }
    grp.mesh.instanceColor.needsUpdate = true;
  }
}

// ── Main environment builder ──────────────────────────────────────────────
//
// V1 ships: ground + lighting + barriers + lamp poles + markers +
//            city glow + ground fog + Canton Tower + camera shake.
// V2 will add: drizzle, track props, window emissives.
async function buildGuangzhouEnvironment(){
  // Async + interleaved with window._yieldBuild() because Guangzhou owns 28+
  // sub-builders (sky-flocks, trackside buildings, hero towers, neon, drizzle).
  // Yielding between batches splits the work over multiple browser tasks so
  // Chrome's "page unresponsive" detector resets and the spinner keeps painting.
  // Reset throttle-state op een schone start: voorkomt dat een nieuwe race
  // toevallig op een odd-tick start waardoor de eerste frame een half-rate
  // pad over slaat (cosmetisch maar consistent).
  _gzFrameTick = 0;
  _gzWindowFlickerOffset = 0;
  const _y = () => (typeof window!=='undefined' && window._yieldBuild) ? window._yieldBuild() : Promise.resolve();
  // Ground — wet dark asphalt. 2400² to fill the world.
  // PBR-upgrade Brok 1b: desktop krijgt MeshStandardMaterial met
  // envMapIntensity zodat de IBL-reflectie de wet-look daadwerkelijk
  // doet (Guangzhou is de regenwereld — dit is het rendement van IBL).
  // Mobile blijft Lambert om de Standard-shader op een 2400² plane te
  // vermijden.
  let _gzGroundMat;
  const _gzGroundDef = {
    color:             _GZ_PALETTE.asphalt,
    map:               _gzGroundTex(),
    emissive:          new THREE.Color(0x100820),
    emissiveIntensity: 0.18
  };
  if(window._isMobile){
    _gzGroundMat = new THREE.MeshLambertMaterial(_gzGroundDef);
  } else {
    _gzGroundMat = new THREE.MeshStandardMaterial(Object.assign({
      metalness:       0.0,
      roughness:       0.30,
      envMapIntensity: 0.70
    }, _gzGroundDef));
    _gzGroundMat.userData = _gzGroundMat.userData || {};
    _gzGroundMat.userData.envTag = 'wet-asphalt';
  }
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), _gzGroundMat);
  gnd.rotation.x = -Math.PI / 2;
  gnd.position.y = -0.15;
  gnd.receiveShadow = true;
  gnd.userData._isProcGround = true;
  scene.add(gnd);

  // Day lighting — single source of truth via helper.
  _applyGuangzhouDayLighting();

  // Barriers + start line (shared environment helpers).
  buildBarriers(); buildStartLine();

  // Cinematic lamp poles along the boulevard.
  _gzBuildCinematicLamps();

  // Boulevard guardrails — Pearl River side.
  _gzBuildGuardrails();

  // Neon billboard frames along the boulevard.
  _gzBuildBillboards();

  await _y();

  // V4 Phase C: 3 hero animated billboards at curve apexes.
  _gzBuildHeroBillboards(scene);

  // V4 Phase E: overhead neon arches crossing the track (4d/2m).
  _gzBuildOverheadArches(scene);

  await _y();

  // V4 Phase D: flying cars above the track (6d/3m, high-altitude background).
  _gzBuildFlyingCars(scene);

  // V4.1: low-altitude flock DIRECTLY above the track (12d/6m, y=10-16u).
  _gzBuildOverheadFlock(scene);

  // V4.2: cross-track flock — cars flying PERPENDICULAR over the track (8d/4m, y=14-19u).
  _gzBuildCrossFlock(scene);

  // V4.3: chaotic sprite drone flock — different silhouette from cars,
  // figure-8 orbits at multiple altitudes (12d/6m).
  _gzBuildDroneFlock(scene);

  await _y();

  // V4 Phase B: close-range urban canyon at r=110 (wall of city feel).
  _gzBuildUrbanCanyon(scene);

  // V4.2: trackside buildings sampled along trackCurve (32 samples × 2 sides
  // desktop = 64 buildings on 1 InstancedMesh; mobile 12×2 = 24).
  _gzBuildTracksideBuildings(scene);

  // V4.4: heroic mega-towers at curve apexes (4d/2m, 140-200u tall).
  _gzBuildHeroTowers(scene);

  // V5.3 (2026-05-11): silhouette-variety pass — cylindrical + spire
  // + stepped towers scattered between the boxy trackside / hero
  // buildings. Owner feedback "ze zien er allemaal hetzelfde uit" —
  // shape variation breaks the uniform-box skyline.
  _gzBuildVariantTowers(scene);

  await _y();

  // V5.1 Phase A: magenta jellyfish hologram at track apex t=0.5, y=18u.
  _gzBuildJellyfish(scene);

  // V4.4 — civilian ground traffic disabled 2026-05-11 round-4.
  // Owner feedback "grijze blokjes met tegemoet komen ernaast, die
  // mogen weg". After the lateral bump to ±9-13u they no longer sat
  // on the racing line, but the sedan silhouette at distance + dark
  // colour still read as floating grey blocks alongside the track.
  // Cleaner to just remove the flock; the racing AI rivals + flying
  // hovercars already give the city plenty of motion.
  // Per-frame update at the bottom of updateGuangzhouWorld is a
  // no-op when _gzGroundTraffic stays null (guard already there).
  // _gzBuildGroundTraffic(scene);

  // V5 Phase C: 60d/30m flying cars prominently over the track on 2 InstancedMesh.
  _gzBuildOverheadHighway(scene);

  // V5 Phase E: 8d/4m vertical sky lasers — multi-color beams shooting upward.
  _gzBuildSkyLasers(scene);

  // V5.1 Phase B: 4d/2m searchlight cones sweeping the sky from rooftops.
  _gzBuildSearchlights(scene);

  // Street-level neon strips — V3.5: dense neon at storefront / head height.
  _gzBuildStreetNeon(scene);

  // V5.1 Phase C: vending machines + signage poles + signs along track sidewalk.
  _gzBuildStreetProps(scene);

  await _y();

  // Skyline window emissives — lit office windows in CBD silhouette.
  _gzBuildSkylineWindows();

  // Distant blink markers (aviation lights on CBD skyline).
  _gzBuildDistantMarkers();

  // City-glow horizon halos.
  _gzBuildCityGlow();
  // _gzBuildSkylineRim() — removed in V4.1: the TorusGeometry at y=100/142
  // read as a sharp white horizontal line across the screen (AdditiveBlending
  // saturating against the dark sky). Urban canyon + spires + city glow now
  // provide the silhouette-edge contrast without needing a hard rim.
  _gzBuildCityGlowHaze();
  _gzBuildVerticalSpires();
  _gzBuildOverheadStrings();
  _gzBuildFacadeBanners();

  await _y();

  // Ground fog — removed 2026-05-11 per owner feedback "ik wil gewoon
  // een mooie donkere track zien dus die mist mag weg". The previous
  // dimmed-down 1-layer version still showed faint purple smears against
  // the wet-asphalt + bloom 1.35× multiplier. Wet-road sheen alone now
  // provides the depth cue. Cinematic horizon glow + drizzle remain.

  // Drizzle particle pool — light urban mist. Also enable canvas-rain overlay
  // at 0.45 intensity (pier47 pattern, lighter for fine drizzle).
  _gzBuildDrizzle();

  // V5.2: soft headlamp pool follows player car (replaces hard halo).
  _gzBuildHeadlampPool(scene);

  await _y();

  if(typeof isRain !== 'undefined'){
    isRain = true;
    if(typeof _rainTarget !== 'undefined')    _rainTarget    = 0.45;
    if(typeof _rainIntensity !== 'undefined') _rainIntensity = 0.45;
    if(rainCanvas){ rainCanvas.style.display = 'block'; rainCanvas.style.opacity = '0.45'; }
  }

  // Canton Tower silhouette.
  _gzBuildCantonTower(scene);

  // Headlights (Guangzhou is night by design).
  plHeadL = new THREE.SpotLight(0xffffff, 0, 50, Math.PI*.16, .5);
  plHeadR = new THREE.SpotLight(0xffffff, 0, 50, Math.PI*.16, .5);
  scene.add(plHeadL); scene.add(plHeadL.target);
  scene.add(plHeadR); scene.add(plHeadR.target);
  plTail = new THREE.PointLight(0xff2200, 0, 10); scene.add(plTail);

  // Stars — always-off (city light pollution + cloud cover).
  {
    const sg = new THREE.SphereGeometry(.12, 4, 4);
    const sm = new THREE.MeshBasicMaterial({ color: 0x888080, transparent:true, opacity:.4 });
    stars = new THREE.InstancedMesh(sg, sm, 30); stars.visible = false;
    const dm = new THREE.Object3D();
    for(let i = 0; i < 30; i++){
      const th = Math.random()*Math.PI*2, ph = Math.random()*Math.PI*.3, r = 320 + Math.random()*60;
      dm.position.set(r*Math.sin(ph)*Math.cos(th), r*Math.cos(ph)*.4+50, r*Math.sin(ph)*Math.sin(th));
      dm.scale.setScalar(.5); dm.updateMatrix(); stars.setMatrixAt(i, dm.matrix);
    }
    stars.instanceMatrix.needsUpdate = true; scene.add(stars);
  }

  // Camera shake — subtle speed-scaled.
  if(typeof enableCinematicCameraShake === 'function'){
    enableCinematicCameraShake({
      intensityScale: 0.9,
      speedThreshold: 0.22,
      maxOffset:      0.04
    });
  }
  _buildGuangzhouCloseBand();   // Phase 12A
  _buildGuangzhouMidRing();     // Phase 11A
  _buildGuangzhouMidVariety();  // Phase 12B
  _buildGuangzhouSmogLayer();   // Phase 11C
  _buildGuangzhouSkywalks();    // Phase 12D
  // Phase 13B — cinematic ground-fog (was missing — Pier47 +
  // volcano-cinematic hebben het wel). Donker paars match neon palette.
  if(typeof buildCinematicGroundFog==='function'){
    buildCinematicGroundFog(scene, {
      color: 0x0f0510, density: 0.4,
      height: 3, layerCount: 2,
      scrollDir: [0.7, -0.4], scrollSpeed: 0.014,
      size: 600
    });
  }
}

// Phase 12D — signature: covered skywalks over track at t=0.3 + 0.7
// (1 op mobile). BoxGeo deck + emissive window-strips IM.
function _buildGuangzhouSkywalks(){
  if(typeof trackCurve==='undefined'||!trackCurve)return;
  const ts = window._isMobile ? [0.40] : [0.30, 0.70];
  ts.forEach(t => {
    const pt = trackCurve.getPoint(t);
    const tg = trackCurve.getTangent(t).normalize();
    const rotY = Math.atan2(tg.x, tg.z);
    const group = new THREE.Group();
    group.position.set(pt.x, 0, pt.z);
    group.rotation.y = rotY;
    group.userData = {_noLodCull:true};
    // Skywalk deck (perpendicular to track tangent so it spans across)
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(38, 3, 5),
      new THREE.MeshLambertMaterial({color:0x223344, emissive:0x101820, emissiveIntensity:0.2})
    );
    deck.position.set(0, 11, 0);
    deck.rotation.y = Math.PI/2;  // span across track perpendicular
    group.add(deck);
    // Emissive window-strips IM (8 small boxes) along length
    const winCount = 8;
    const winGeo = new THREE.BoxGeometry(0.4, 0.4, 4);
    const winMat = new THREE.MeshLambertMaterial({color:0xffaa22, emissive:0xffaa22, emissiveIntensity:1.2});
    const winIm = new THREE.InstancedMesh(winGeo, winMat, winCount);
    const m4 = new THREE.Matrix4();
    const q  = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI/2, 0));
    const s  = new THREE.Vector3(1,1,1);
    const v  = new THREE.Vector3();
    for(let i=0;i<winCount;i++){
      const offset = -16 + i * (32/(winCount-1));
      v.set(0, 11, offset);  // along the deck's perpendicular axis
      m4.compose(v, q, s);
      winIm.setMatrixAt(i, m4);
    }
    winIm.instanceMatrix.needsUpdate = true;
    group.add(winIm);
    // 4 support pillars
    const pGeo = new THREE.CylinderGeometry(0.4, 0.5, 10, 5);
    const pMat = new THREE.MeshLambertMaterial({color:0x202830});
    [[-19, 0, -2.5], [19, 0, -2.5], [-19, 0, 2.5], [19, 0, 2.5]].forEach(p => {
      const pillar = new THREE.Mesh(pGeo, pMat);
      pillar.position.set(p[0], 5, p[2]);
      // rotate pillar position by perpendicular: pillar x→y of group
      pillar.position.x = 0;
      pillar.position.z = p[0]*0.85;  // place along skywalk span
      pillar.position.y = 5;
      group.add(pillar);
    });
    group.traverse(o => { if(o.isMesh || o.isInstancedMesh) o.castShadow = false; });
    scene.add(group);
  });
}

// Phase 12B — mid-band variety: planter-boxes + kiosks zodat de neon-
// sign ring niet meer als enige geometry-type in de mid-band leest.
function _buildGuangzhouMidVariety(){
  if(typeof _populateMidRing!=='function')return;
  // Planter boxes
  const planterCount = (typeof _mobCount==='function')?_mobCount(18):18;
  const planterGeo = new THREE.BoxGeometry(1.6, 0.8, 1.6);
  const planterMat = new THREE.MeshLambertMaterial({color:0x556644, emissive:0x223322, emissiveIntensity:0.2});
  const planterIm = new THREE.InstancedMesh(planterGeo, planterMat, planterCount*2);
  _populateMidRing(planterIm, {
    perSide: planterCount, offsetMin:12, offsetMax:22,
    scaleMin:0.85, scaleMax:1.2, stagger:0.2,
    yFn: () => 0.4
  });
  scene.add(planterIm);
  // Kiosks — taller stalls
  const kioskCount = (typeof _mobCount==='function')?_mobCount(10):10;
  const kioskGeo = new THREE.BoxGeometry(2.4, 3.0, 2.0);
  const kioskMat = new THREE.MeshLambertMaterial({color:0x8a4030, emissive:0x331100, emissiveIntensity:0.3});
  const kioskIm = new THREE.InstancedMesh(kioskGeo, kioskMat, kioskCount*2);
  _populateMidRing(kioskIm, {
    perSide: kioskCount, offsetMin:14, offsetMax:24,
    scaleMin:0.9, scaleMax:1.15, stagger:0.55,
    yFn: () => 1.5
  });
  scene.add(kioskIm);
}

// Phase 12A — close-band: vending stalls + trashbag piles (3 colors)
// on 4-9u. Vult het gat tussen barriers en mid-band neon-signs (8-18u).
function _buildGuangzhouCloseBand(){
  if(typeof _populateMidRing!=='function')return;
  // Vending stalls — box body with cone roof
  const stallCount = (typeof _mobCount==='function')?_mobCount(20):20;
  const stallGeo = new THREE.BoxGeometry(1.8, 1.4, 1.2);
  const stallMat = new THREE.MeshLambertMaterial({color:0x553322, emissive:0xff5500, emissiveIntensity:0.25});
  const stallIm = new THREE.InstancedMesh(stallGeo, stallMat, stallCount*2);
  _populateMidRing(stallIm, {
    perSide: stallCount, offsetMin:5, offsetMax:9,
    scaleMin:0.85, scaleMax:1.15, stagger:0.15,
    yFn: () => 0.7
  });
  scene.add(stallIm);
  // Trashbags — 3 colors as separate IMs (small SphereGeo, scaled)
  const BAG_COLS = [0x222222, 0x223355, 0x224422];  // black, blue, green
  const bagPerColor = (typeof _mobCount==='function')?_mobCount(12):12;
  const bagGeo = new THREE.SphereGeometry(0.4, 6, 4);
  BAG_COLS.forEach((col, ci) => {
    const mat = new THREE.MeshLambertMaterial({color:col});
    const im = new THREE.InstancedMesh(bagGeo, mat, bagPerColor*2);
    _populateMidRing(im, {
      perSide: bagPerColor, offsetMin:4, offsetMax:7,
      scaleMin:0.8, scaleMax:1.6, tiltAmt:0.4, stagger:0.33+ci*0.2,
      yFn: () => 0.35
    });
    scene.add(im);
  });
}

// Phase 11C — dunne smoglaag op mid-hoogte. Geeft sfeerdiepte tussen
// straatlevel en hero-billboards, voelt als typisch Aziatische megacity-
// smog die zonsondergang-licht verstrooit.
function _buildGuangzhouSmogLayer(){
  const geo = new THREE.CylinderGeometry(320, 320, 20, 32, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color:0x887766, transparent:true, opacity:0.08,
    side:THREE.BackSide, depthWrite:false
  });
  const haze = new THREE.Mesh(geo, mat);
  haze.position.y = 35;
  haze.userData={_noLodCull:true};
  scene.add(haze);
}

// Phase 11A — eye-height neon-signs in 8-18u zone. 5 emissive kleuren als
// aparte IM op verschillende stagger-phases. Elke sign is een paneel +
// dunne sokkel als losse IM op zelfde stagger.
function _buildGuangzhouMidRing(){
  if(typeof _populateMidRing!=='function')return;
  const COLS = [0xff0055, 0x00ffaa, 0xff8800, 0x0088ff, 0xffff00];
  const perColor = (typeof _mobCount==='function')?_mobCount(30):30;
  const pGeo = new THREE.BoxGeometry(2.5, 1.2, 0.15);
  const sGeo = new THREE.BoxGeometry(0.3, 4.0, 0.3);
  const sMat = new THREE.MeshLambertMaterial({color:0x111111});
  // One pole IM total (color-agnostic), reused across sign-positions
  const poleIm = new THREE.InstancedMesh(sGeo, sMat, perColor*COLS.length*2);
  _populateMidRing(poleIm, {
    perSide: perColor*COLS.length, offsetMin:8, offsetMax:18,
    scaleMin:0.85, scaleMax:1.1,
    yFn: () => 2.0
  });
  scene.add(poleIm);
  COLS.forEach((col, ci) => {
    const mat = new THREE.MeshLambertMaterial({color:0xffffff, emissive:col, emissiveIntensity:1.4});
    const im  = new THREE.InstancedMesh(pGeo, mat, perColor*2);
    _populateMidRing(im, {
      perSide: perColor, offsetMin:8, offsetMax:18,
      scaleMin:0.9, scaleMax:1.4, stagger: ci/COLS.length,
      yFn: () => 3.5 + Math.random()*2.5  // y=3-6
    });
    scene.add(im);
  });
}

// ── Per-frame world update ────────────────────────────────────────────────
//
// V2: drizzle particle pool update + window emissive flicker.
function updateGuangzhouWorld(dt){
  // activeWorld guard — this function fires on every world (loop.js line 143
  // has no guard). Early-out is cheap and prevents V2 code from running in
  // other worlds where _gzDrizzleGeo / _gzWindowQuads would be stale.
  if(typeof activeWorld !== 'undefined' && activeWorld !== 'guangzhou') return;
  _gzFrameTick = (_gzFrameTick + 1) | 0;

  // Sessie 06a V3 — Canton Tower lap-progressive emissive ramp. baseOpacity
  // is the V1 build value; on the final lap we push it up by ~50% so the
  // tower becomes visibly brighter — reads as the city "watching" the
  // climactic lap.
  if(window._gzCantonMats && window._gzCantonMats.length && typeof carObjs !== 'undefined'){
    const pCar = carObjs[playerIdx];
    if(pCar){
      const lapsTotal = (typeof TOTAL_LAPS !== 'undefined') ? TOTAL_LAPS : 3;
      // 0 on lap 1, 1.0 on the final lap. Smooth ramp via linear interp.
      const lapProg = Math.min(1, Math.max(0, ((pCar.lap||1) - 1) / Math.max(1, lapsTotal - 1)));
      const boost = 1.0 + lapProg * 0.50;
      // Pulse on top — slow 0.07Hz so the tower breathes.
      const t = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now() * 0.001);
      const pulse = 1.0 + 0.06 * Math.sin(t * 0.45);
      for(let i = 0; i < window._gzCantonMats.length; i++){
        const ref = window._gzCantonMats[i];
        ref.mat.opacity = Math.min(1.0, ref.baseOpacity * boost * pulse);
      }
    }
  }

  // ── Phase D: Flying car per-frame movement (V4 high-altitude + V4.1 flock) ──
  const _gzCarDt = Math.min(dt || 0.016, 0.05);
  // Mobile-stagger: 3 flock-blokken (flying cars, overhead flock, cross flock)
  // schrijven samen ~60 setMatrixAt + 6 instanceMatrix uploads per frame.
  // Op mobile elke 2e frame skippen halveert die cost zonder zichtbaar
  // verschil voor verre lucht-traffic. Highway-flock heeft al een eigen
  // parity-stagger op _gzFrameTick, niet dubbel-staggeren.
  const _gzFlockSkip = !!(window._isMobile && (_gzFrameTick & 1));
  if(!_gzFlockSkip && _gzFlyingCarsBody && _gzFlyingCars.length){
    const d = _gzFlyingCarsBody.userData._dummy || (_gzFlyingCarsBody.userData._dummy = new THREE.Object3D());
    for(let i = 0; i < _gzFlyingCars.length; i++){
      const fc = _gzFlyingCars[i];
      fc.x += fc.speed * _gzCarDt * fc.dir;
      if(fc.x > 200) fc.x = -200;
      else if(fc.x < -200) fc.x = 200;
      d.position.set(fc.x, fc.yPos, fc.zPos);
      d.updateMatrix();
      _gzFlyingCarsBody.setMatrixAt(i, d.matrix);
      d.position.set(fc.x - fc.dir * 1.6, fc.yPos, fc.zPos);
      d.updateMatrix();
      _gzFlyingCarsLights.setMatrixAt(i, d.matrix);
    }
    _gzFlyingCarsBody.instanceMatrix.needsUpdate   = true;
    _gzFlyingCarsLights.instanceMatrix.needsUpdate = true;
  }
  if(!_gzFlockSkip && _gzOverheadFlockBody && _gzOverheadFlock.length){
    const d = _gzOverheadFlockBody.userData._dummy || (_gzOverheadFlockBody.userData._dummy = new THREE.Object3D());
    for(let i = 0; i < _gzOverheadFlock.length; i++){
      const fc = _gzOverheadFlock[i];
      fc.x += fc.speed * _gzCarDt * fc.dir;
      if(fc.x > 220) fc.x = -220;
      else if(fc.x < -220) fc.x = 220;
      d.position.set(fc.x, fc.yPos, fc.zPos);
      d.updateMatrix();
      _gzOverheadFlockBody.setMatrixAt(i, d.matrix);
      d.position.set(fc.x - fc.dir * 2.0, fc.yPos, fc.zPos);
      d.updateMatrix();
      _gzOverheadFlockLights.setMatrixAt(i, d.matrix);
    }
    _gzOverheadFlockBody.instanceMatrix.needsUpdate   = true;
    _gzOverheadFlockLights.instanceMatrix.needsUpdate = true;
  }
  // V4.2 cross-track flock: cars flying PERPENDICULAR to tangent over the track
  if(!_gzFlockSkip && _gzCrossFlockBody && _gzCrossFlock.length){
    const d = _gzCrossFlockBody.userData._dummy || (_gzCrossFlockBody.userData._dummy = new THREE.Object3D());
    for(let i = 0; i < _gzCrossFlock.length; i++){
      const cf = _gzCrossFlock[i];
      cf.x += cf.perpX * cf.dir * cf.speed * _gzCarDt;
      cf.z += cf.perpZ * cf.dir * cf.speed * _gzCarDt;
      const dx = cf.x - cf.anchorX;
      const dz = cf.z - cf.anchorZ;
      const proj = (dx * cf.perpX + dz * cf.perpZ) * cf.dir;
      if(proj > 80){
        cf.x = cf.anchorX - cf.perpX * cf.dir * 80;
        cf.z = cf.anchorZ - cf.perpZ * cf.dir * 80;
      }
      d.position.set(cf.x, cf.yPos, cf.z);
      d.rotation.set(0, Math.atan2(cf.perpX * cf.dir, cf.perpZ * cf.dir), 0);
      d.updateMatrix();
      _gzCrossFlockBody.setMatrixAt(i, d.matrix);
      d.position.set(cf.x - cf.perpX * cf.dir * 1.8, cf.yPos, cf.z - cf.perpZ * cf.dir * 1.8);
      d.updateMatrix();
      _gzCrossFlockLights.setMatrixAt(i, d.matrix);
    }
    _gzCrossFlockBody.instanceMatrix.needsUpdate   = true;
    _gzCrossFlockLights.instanceMatrix.needsUpdate = true;
  }
  // V4.3 drone flock: chaotic figure-8 orbits via lissajous (sin*orbit / cos*0.6*orbit)
  if(_gzDroneFlockIM && _gzDroneFlock.length){
    const tNow = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now() * 0.001);
    const d = _gzDroneFlockIM.userData._dummy || (_gzDroneFlockIM.userData._dummy = new THREE.Object3D());
    for(let i = 0; i < _gzDroneFlock.length; i++){
      const dr = _gzDroneFlock[i];
      const k = tNow * dr.speed * 0.05 + dr.phase;
      const x = dr.anchorX + Math.sin(k)       * dr.orbitR;
      const z = dr.anchorZ + Math.cos(k * 1.7) * dr.orbitR * 0.6;
      const y = Math.max(10, dr.baseY + Math.sin(k * 2.3) * 2.2);
      d.position.set(x, y, z);
      d.updateMatrix();
      _gzDroneFlockIM.setMatrixAt(i, d.matrix);
    }
    _gzDroneFlockIM.instanceMatrix.needsUpdate = true;
  }
  // V4.4 ground traffic: civilian cars looping the trackCurve at constant speed
  if(_gzGroundTraffic && _gzGroundTrafficData.length){
    const tNow = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now() * 0.001);
    const dummy = _gzGroundTraffic.userData._dummy || (_gzGroundTraffic.userData._dummy = new THREE.Object3D());
    for(let i = 0; i < _gzGroundTrafficData.length; i++){
      const td = _gzGroundTrafficData[i];
      // Advance t along the curve based on direction. Wrap into [0,1].
      let t = (td.tBase + tNow * td.speed * td.dir) % 1;
      if(t < 0) t += 1;
      const pt = trackCurve.getPoint(t);
      const tg = trackCurve.getTangent(t).normalize();
      const nrX = -tg.z;
      const nrZ =  tg.x;
      dummy.position.set(pt.x + nrX * td.lateral, 0.4, pt.z + nrZ * td.lateral);
      dummy.rotation.set(0, Math.atan2(tg.x * td.dir, tg.z * td.dir), 0);
      dummy.updateMatrix();
      _gzGroundTraffic.setMatrixAt(i, dummy.matrix);
    }
    _gzGroundTraffic.instanceMatrix.needsUpdate = true;
  }
  // V5 Phase C: overhead highway cars advancing along trackCurve.
  // Alternate-frame update: even-indexed cars op even frames, odd op odd.
  // Effectieve update-rate per car = 30Hz. Highway is verre traffic — speler
  // ziet halveer-rate niet maar het halveert wel 60-120 trackCurve.getPoint+
  // getTangent calls/frame.
  if(_gzHighway && _gzHighwayData.length){
    const tNow2 = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now() * 0.001);
    const hwDummy = _gzHighway.userData._dummy || (_gzHighway.userData._dummy = new THREE.Object3D());
    const parity = _gzFrameTick & 1;
    for(let i = parity; i < _gzHighwayData.length; i += 2){
      const hd = _gzHighwayData[i];
      let t = (hd.tBase + tNow2 * hd.speed * hd.dir) % 1;
      if(t < 0) t += 1;
      const pt = trackCurve.getPoint(t);
      const tg = trackCurve.getTangent(t).normalize();
      const nrX = -tg.z;
      const nrZ =  tg.x;
      const bx = pt.x + nrX * hd.lateral;
      const bz = pt.z + nrZ * hd.lateral;
      hwDummy.position.set(bx, hd.yPos, bz);
      hwDummy.rotation.set(0, Math.atan2(tg.x * hd.dir, tg.z * hd.dir), 0);
      hwDummy.scale.set(1, 1, 1);
      hwDummy.updateMatrix();
      _gzHighway.setMatrixAt(i, hwDummy.matrix);
      // Rear-light behind body
      const rx = bx - tg.x * hd.dir * 1.6;
      const rz = bz - tg.z * hd.dir * 1.6;
      hwDummy.position.set(rx, hd.yPos, rz);
      hwDummy.updateMatrix();
      _gzHighwayLights.setMatrixAt(i, hwDummy.matrix);
    }
    _gzHighway.instanceMatrix.needsUpdate       = true;
    _gzHighwayLights.instanceMatrix.needsUpdate = true;
  }

  // V4.4 sky lightning: brief background flash every 8-15s for chaotic ambience.
  // Scene.fog and scene.background remain unchanged otherwise (set in buildScene).
  if(typeof scene !== 'undefined' && scene && scene.fog){
    const tNow = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now() * 0.001);
    const cycle = 11.0;       // average cycle length (s)
    const flashAt = (tNow % cycle);
    if(flashAt < 0.18){
      // Sharp magenta flash, peak at 0.05s, decays over 0.18s
      const k = Math.max(0, 1 - flashAt / 0.18);
      const flashMul = k * k * 1.4;  // 0.0..1.4 ease-out
      if(scene.fog.color){
        // Brief tint on fog (renderer applies fog colour to all fog-affected meshes)
        scene.fog.color.setRGB(
          0.10 + 0.18 * flashMul,
          0.06 + 0.04 * flashMul,
          0.18 + 0.22 * flashMul
        );
      }
    } else if(flashAt < 0.36 && flashAt > 0.18){
      // Restore baseline fog colour
      if(scene.fog.color){
        scene.fog.color.setRGB(0.10, 0.06, 0.18);
      }
    }
  }

  // V5 Phase E: sky laser pulse (opacity sine modulation)
  if(_gzSkyLasers && _gzSkyLasers.material){
    const tLaser = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now() * 0.001);
    _gzSkyLasers.material.opacity = 0.45 + 0.25 * Math.sin(tLaser * 1.8);
  }

  // V5.1 Phase B: searchlight Y-axis sweep per-frame
  if(_gzSearchlights && _gzSearchlightData.length){
    const _slt = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now() * 0.001);
    const _slDummy = _gzSearchlights.userData._dummy
      || (_gzSearchlights.userData._dummy = new THREE.Object3D());
    for(let i = 0; i < _gzSearchlightData.length; i++){
      const sd = _gzSearchlightData[i];
      _slDummy.position.set(sd.x, sd.y, sd.z);
      _slDummy.rotation.set(sd.tilt, sd.baseAngle + _slt * 0.5, 0);
      _slDummy.updateMatrix();
      _gzSearchlights.setMatrixAt(i, _slDummy.matrix);
    }
    _gzSearchlights.instanceMatrix.needsUpdate = true;
  }

  // V5.1 Phase A: jellyfish bell rotation + y-bob + tentacle wave
  if(_gzJellyfishBell && _gzJellyfishAnchor){
    const _jt = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now() * 0.001);
    _gzJellyfishBell.rotation.y += dt * 0.4;
    _gzJellyfishBell.position.y = _gzJellyfishAnchor.baseY + Math.sin(_jt * 0.7) * 0.5;
  }
  // Tentacle wave op half-rate (30Hz). Bell-rotation hierboven blijft op
  // full-rate — die is groot en zichtbaar. Tentakels staan strak rond de
  // bel en hun beweging is subtiel genoeg dat 30Hz visueel niet uit elkaar
  // valt; halveert ~16 sin/cos-calls per frame.
  if(_gzJellyfishTentacles && _gzJellyfishAnchor && (_gzFrameTick & 1) === 0){
    const _jt2 = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now() * 0.001);
    const _tentDummy = _gzJellyfishTentacles.userData._dummy
      || (_gzJellyfishTentacles.userData._dummy = new THREE.Object3D());
    const TENTACLE_COUNT = _gzJellyfishTentacles.count;
    const CIRCLE_R = 2.5;
    const tentY = _gzJellyfishAnchor.baseY - 3;
    for(let i = 0; i < TENTACLE_COUNT; i++){
      const angle = (i / TENTACLE_COUNT) * Math.PI * 2;
      const tx = _gzJellyfishAnchor.x + Math.cos(angle) * CIRCLE_R;
      const tz = _gzJellyfishAnchor.z + Math.sin(angle) * CIRCLE_R;
      _tentDummy.position.set(tx, tentY, tz);
      _tentDummy.rotation.set(
        Math.cos(angle) * 0.18 + Math.sin(_jt2 * 1.3 + i * 0.6) * 0.15,
        0,
        Math.sin(angle) * 0.18
      );
      _tentDummy.updateMatrix();
      _gzJellyfishTentacles.setMatrixAt(i, _tentDummy.matrix);
    }
    _gzJellyfishTentacles.instanceMatrix.needsUpdate = true;
  }

  // ── Drizzle particle pool update ─────────────────────────────────────────
  if(_gzDrizzleGeo){
    const car = carObjs && carObjs[playerIdx];
    const cx  = car ? car.mesh.position.x : 0;
    const cz  = car ? car.mesh.position.z : 0;
    const arr = _gzDrizzleGeo.attributes.position.array;
    const n   = (arr.length / 3) | 0;
    // Rolling-buffer: process ~50 particles per frame. Full pool cycles
    // every ~6 frames at 60fps. Mirrors pier47 / volcano-ember pattern.
    const step = (Math.floor(_nowSec * 40) * 50) % n;
    const end  = Math.min(step + 50, n);
    for(let i = step; i < end; i++){
      // Urban drizzle: ~10u/s downward, ~1u/s horizontal (slight city wind)
      arr[i*3]   += dt * 1.0;
      arr[i*3+1] -= dt * 10.0;
      // Respawn: hit ground OR drifted outside follow-volume (120u radius)
      if(arr[i*3+1] < -0.5
         || arr[i*3]   > cx + 120 || arr[i*3]   < cx - 120
         || arr[i*3+2] > cz + 120 || arr[i*3+2] < cz - 120){
        arr[i*3]   = cx + (Math.random() - 0.5) * 200;
        arr[i*3+1] = 24 + Math.random() * 8;
        arr[i*3+2] = cz + (Math.random() - 0.5) * 200;
      }
    }
    _gzDrizzleGeo.attributes.position.needsUpdate = true;
  }

  // ── V5.2 Headlamp pool follows player car ───────────────────────────────
  if(_gzHeadlampPool){
    const car = carObjs && carObjs[playerIdx];
    if(car && car.mesh){
      _gzHeadlampPool.position.x = car.mesh.position.x;
      _gzHeadlampPool.position.z = car.mesh.position.z;
      // y stays at 0.05u (set at build time) — ground level, no z-fight
      // Optional: rotate pool to face car heading
      if(typeof car.mesh.rotation !== 'undefined'){
        _gzHeadlampPool.rotation.z = -car.mesh.rotation.y;  // counter-rotate; x-rot already locked at -PI/2
      }
    }
  }

  // ── Window emissive flicker ──────────────────────────────────────────────
  _gzUpdateWindowFlicker(dt);

  // ── Phase C: Hero billboard UV pulse-shift ────────────────────────────────
  // V4.4 — pulse rate 0.3→1.2 Hz (4× faster) for cyberpunk chaos vibe.
  // Amplitude bumped 0.04→0.08 for more visible content shifting.
  //
  // Phase-5 showcase: pulse the billboard tint between magenta and cyan
  // at ~0.7 Hz on the same phase clock so the holographic look reads
  // even on billboards where the underlying texture is monochrome. Each
  // billboard has its own phase offset (_gzPhase, set in build) so the
  // pulses cascade across the cityscape rather than blinking in unison.
  // Uses material.color, which combines multiplicatively with map — a
  // 0.85 dip on magenta side never undersaturates the source art.
  // Billboard pulse op half-rate (30Hz). UV-offset @ 1.2Hz en color-crossfade
  // @ 0.7Hz zijn ruim laag genoeg dat 30Hz sampling onmerkbaar is. Halveert
  // material-state-changes voor 6 billboards per frame.
  if(_gzHeroBillboardMats && _gzHeroBillboardMats.length && (_gzFrameTick & 1) === 0){
    const t = _nowSec || (performance.now()*0.001);
    for(const m of _gzHeroBillboardMats){
      if(m.map){ m.map.offset.y = (Math.sin(t * 1.2 + m._gzPhase) * 0.08); }
      if(m.color){
        const pulse = Math.sin(t * 0.7 + (m._gzPhase || 0)) * 0.5 + 0.5; // 0..1
        // Magenta (1.0, 0.45, 0.95) ↔ Cyan (0.35, 0.95, 1.0) crossfade
        m.color.setRGB(
          0.35 + (1.0 - 0.35) * pulse,
          0.95 + (0.45 - 0.95) * pulse,
          1.0  + (0.95 - 1.0)  * pulse
        );
      }
    }
  }

  // ── Phase 10.7 — neon-spark showers vanaf hero billboards ─────────────
  // Elke 4-8s een random billboard spuwt 20 sparks omlaag. Alternate
  // magenta/cyan per spawn. Shared exhaust particle pool, korte life-
  // expiry voor "shower"-feel.
  if(_gzHeroBillboards && _gzHeroBillboards.length
     && typeof exhaustSystem !== 'undefined' && exhaustSystem && exhaustSystem.emit){
    const _tSp = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now()*0.001);
    if(_tSp >= _gzNextSpark){
      _gzNextSpark = _tSp + 4 + Math.random() * 4;
      const bb = _gzHeroBillboards[Math.floor(Math.random() * _gzHeroBillboards.length)];
      if(bb && bb.position){
        const isMagenta = Math.random() < 0.5;
        const r = isMagenta ? 1.0 : 0.0;
        const g = isMagenta ? 0.13 : 0.88;
        const b = isMagenta ? 0.50 : 1.0;
        for(let _si=0; _si<20; _si++){
          exhaustSystem.emit(
            bb.position.x + (Math.random()-0.5) * 8,
            bb.position.y - 2,
            bb.position.z + (Math.random()-0.5) * 8,
            (Math.random()-0.5) * 0.1,
            -0.05 - Math.random() * 0.1,
            (Math.random()-0.5) * 0.1,
            1.4, r, g, b, .70
          );
        }
      }
    }
  }

  // ── Phase 10.3c — thunder flash ─────────────────────────────────────────
  // Random elke 12-25s: kort exposure-pulse naar 1.6 + lichte camShake bump.
  // Voelt als verre bliksem boven de neon-skyline. Skip pre-race / finish.
  if(typeof gameState !== 'undefined' && gameState === 'RACE'){
    const tN = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now()*0.001);
    if(tN > _gzNextThunder){
      _gzNextThunder = tN + 12 + Math.random() * 13;
      if(typeof window !== 'undefined' && typeof window._setExposureTarget === 'function'){
        const prev = (typeof _exposureTarget !== 'undefined') ? _exposureTarget : 1.1;
        window._setExposureTarget(1.6);
        setTimeout(()=>{ if(typeof window._setExposureTarget==='function') window._setExposureTarget(prev); }, 150);
      }
      if(typeof camShake !== 'undefined') camShake = Math.max(camShake, 0.35);
    }
  }
}
