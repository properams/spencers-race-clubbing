// js/effects/contact-shadows.js — goedkope onder-de-auto contact shadows.
//
// PBR-upgrade Brok 3: één InstancedMesh van PlaneGeometry-quads met een
// shared canvas-radial-gradient texture. Per frame leest het de
// posities uit window.carObjs en zet de matrices van de instances
// daarmee. Eén extra draw call ongeacht het aantal cars; geen
// per-mesh-traversal of update-budget.
//
// Geen SSAO / ground-truth raycast: shadow ligt op een vaste offset onder
// car.mesh.position.y. Compromis voor 99% van het flat-track gameplay;
// kan bij steile bruggen of hellingen onder het asfalt zakken.
//
// Dependencies (script-globals): renderer, THREE, scene, carObjs.

'use strict';

// PBR-upgrade follow-up: expose voor graceful-downgrade-niveau-2 zodat het
// auto-quality-pad de InstancedMesh-visibility kan flippen zonder via een
// API te hoeven gaan.
var _contactShadows = {
  ready: false,
  mesh: null,                  // InstancedMesh
  capacity: 12,                // ruim genoeg voor 8 cars + marge
  texture: null,
  _tmpMatrix: null,
  _tmpPos: null
};

// Shared radial-gradient canvas-texture. Premultiplied alpha zodat het
// blendt zonder rand-artifacts. 256² is genoeg voor een soft puddle.
function _makeContactShadowTex(){
  const S = 256, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const cx = S * 0.5, cy = S * 0.5;
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, cx);
  grd.addColorStop(0.00, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.30)');
  grd.addColorStop(0.80, 'rgba(0,0,0,0.08)');
  grd.addColorStop(1.00, 'rgba(0,0,0,0.00)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  if(typeof ThreeCompat !== 'undefined' && ThreeCompat.applyTextureColorSpace){
    ThreeCompat.applyTextureColorSpace(tex);
  }
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function initContactShadows(){
  if(_contactShadows.ready) return;
  if(typeof scene === 'undefined' || !scene) return;
  if(typeof THREE === 'undefined') return;

  _contactShadows.texture = _makeContactShadowTex();
  const geo = new THREE.PlaneGeometry(1, 1);
  // Roteren in geometry zodat het quad XZ-vlak ligt (default Plane is XY).
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map:           _contactShadows.texture,
    transparent:   true,
    depthWrite:    false,
    side:          THREE.DoubleSide,
    color:         0xffffff
  });
  const inst = new THREE.InstancedMesh(geo, mat, _contactShadows.capacity);
  inst.frustumCulled = false;
  // Start met count=0 zodat tot updateContactShadows() geen lege quads
  // op de origin worden getekend (anders levert dat een grote zwarte
  // vlek op (0,0,0) totdat de eerste update binnen is).
  inst.count = 0;
  inst.userData._isContactShadows = true;
  // Aware of sharedAsset zodat disposeScene de mesh niet weghaalt op
  // wereld-rebuild (we kunnen 'm hergebruiken).
  mat.userData = mat.userData || {};
  mat.userData._sharedAsset = true;
  geo.userData = geo.userData || {};
  geo.userData._sharedAsset = true;

  scene.add(inst);
  _contactShadows.mesh = inst;
  _contactShadows._tmpMatrix = new THREE.Matrix4();
  _contactShadows._tmpPos    = new THREE.Vector3();
  _contactShadows.ready = true;
  // Expose state-handle voor graceful-downgrade-niveau-2 in loop.js.
  if(typeof window !== 'undefined') window._contactShadows = _contactShadows;
}
window._initContactShadows = initContactShadows;

// Per-frame matrix-update. Roep vanuit de render-loop nadat car-posities
// zijn bijgewerkt (post-physics, pre-render).
function updateContactShadows(){
  if(!_contactShadows.ready) return;
  if(typeof carObjs === 'undefined' || !carObjs || !carObjs.length){
    _contactShadows.mesh.count = 0;
    return;
  }
  const inst = _contactShadows.mesh;
  const m = _contactShadows._tmpMatrix;
  const p = _contactShadows._tmpPos;
  const cap = _contactShadows.capacity;
  let n = 0;
  // Shadow-quad afmeting (car footprint). Cars zijn ~2.5 lang × 1.6 breed;
  // gebruik 3.0 × 1.8 voor een zachte halo eromheen.
  const SX = 3.0, SZ = 1.8;
  for(let i = 0; i < carObjs.length && n < cap; i++){
    const car = carObjs[i];
    const meshRef = car && car.mesh;
    if(!meshRef) continue;
    // Shadow op vast offset onder car-chassis. Y-offset 0.35 is empirisch
    // (car-chassis hangt ~0.5 boven ground; net erboven ondertussen).
    p.set(meshRef.position.x, meshRef.position.y - 0.35, meshRef.position.z);
    m.makeScale(SX, 1, SZ);
    m.setPosition(p);
    inst.setMatrixAt(n, m);
    n++;
  }
  inst.count = n;
  inst.instanceMatrix.needsUpdate = true;
}
window._updateContactShadows = updateContactShadows;

// Cleanup voor wereld-switch. InstancedMesh + materiaal + texture worden
// hergebruikt over rebuilds; alleen het scene.parent moet opnieuw worden
// geattached na de scene-reset in disposeScene.
function reattachContactShadows(){
  if(!_contactShadows.ready) return;
  if(typeof scene === 'undefined' || !scene) return;
  if(_contactShadows.mesh.parent !== scene){
    scene.add(_contactShadows.mesh);
  }
  _contactShadows.mesh.count = 0;
}
window._reattachContactShadows = reattachContactShadows;
