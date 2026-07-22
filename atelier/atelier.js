// atelier — standalone asset-showroom viewer. Volledig losstaand van de game:
// eigen three-vendor (r160 ESM via import map), eigen manifest, geen game-imports.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Naam is bewust één constante: hernoemen = deze string + de mapnaam.
export const ATELIER_NAAM = 'atelier';

const MANIFEST_PAD = './manifest.json';
const IJKPUNT_FALLBACK = 1_500_000; // tris-drempel; manifest.budget_tris_totaal overschrijft
const DRAAISNELHEID = 0.22;         // rad/s turntable
const NL = new Intl.NumberFormat('nl-NL');

const canvas = document.getElementById('stage');
const el = {
  titel: document.getElementById('hud-titel'),
  stats: document.getElementById('hud-stats'),
  fill: document.getElementById('budgetfill'),
  ijkpunt: document.getElementById('ijkpunt'),
  labels: document.getElementById('labels'),
  status: document.getElementById('status'),
  statusTekst: document.getElementById('status-tekst'),
};

document.title = ATELIER_NAAM;
el.titel.textContent = ATELIER_NAAM;

// ── renderer / scene / camera ─────────────────────────────────────────────
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  toonStatus('WebGL niet beschikbaar in deze browser.');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.useLegacyLights = false; // fysisch correcte intensiteiten — eerlijk PBR-oordeel

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0f11); // egaal donker — bewust géén fog/haze

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.55; // niet ver onder de vloer

// Neutrale studio-belichting: RoomEnvironment als IBL + één key-light voor slagschaduw.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const keyLicht = new THREE.DirectionalLight(0xffffff, 1.6);
keyLicht.castShadow = true;
keyLicht.shadow.mapSize.set(2048, 2048);
keyLicht.shadow.bias = -0.0004;
keyLicht.shadow.normalBias = 0.02;
scene.add(keyLicht, keyLicht.target);

// ── loaders ───────────────────────────────────────────────────────────────
const ktx2 = new KTX2Loader()
  .setTranscoderPath('./vendor/addons/libs/basis/')
  .detectSupport(renderer);
const gltfLoader = new GLTFLoader()
  .setKTX2Loader(ktx2)
  .setMeshoptDecoder(MeshoptDecoder);

// ── staat ─────────────────────────────────────────────────────────────────
const records = []; // { entry, groep, materialen, chip, chipKnop, topY, straal, tris, wire, fout }
let ijkpunt = IJKPUNT_FALLBACK;
let totaalTris = 0;
let camThuis = null; // { pos, doel }
const stilstand = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── opstart ───────────────────────────────────────────────────────────────
boot();

async function boot() {
  let manifest;
  try {
    const r = await fetch(MANIFEST_PAD, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    manifest = await r.json();
  } catch (e) {
    toonStatus('<b>manifest.json</b> niet leesbaar (' + afkorten(String(e.message)) + ')');
    richtCamera(3);
    start();
    return;
  }

  ijkpunt = Number(manifest.budget_tris_totaal) || IJKPUNT_FALLBACK;
  el.ijkpunt.textContent = 'ijkpunt ' + NL.format(ijkpunt);

  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  if (entries.length === 0) {
    toonStatus(
      'geen assets in <code>atelier/manifest.json</code><br>' +
      'run de pipeline: <code>node pipeline/optimize.mjs assets/raw/&lt;bestand&gt;.glb --tris 5000</code>'
    );
    bijwerkenHud();
    richtCamera(3);
    start();
    return;
  }

  await Promise.all(entries.map(laadAsset));
  plaatsGrid();
  bijwerkenHud();
  start();
}

async function laadAsset(entry) {
  const rec = {
    entry, groep: new THREE.Group(), materialen: new Set(),
    chip: null, chipKnop: null, topY: 1, straal: 0.6, tris: 0, wire: false, fout: null,
  };
  records.push(rec);
  scene.add(rec.groep);
  try {
    const gltf = await gltfLoader.loadAsync('./' + String(entry.file || '').replace(/^\.?\//, ''));
    const model = gltf.scene;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) rec.materialen.add(m);
      const geo = o.geometry;
      if (geo) {
        const n = geo.index ? geo.index.count / 3 : (geo.attributes.position ? geo.attributes.position.count / 3 : 0);
        rec.tris += Math.round(n * (o.isInstancedMesh ? o.count : 1));
      }
    });
    rec.groep.add(model);
    // Bbox t.o.v. de eigen pivot — bewust NIET hercentreren: een scheve
    // pivot-to-foot moet hier juist zichtbaar zijn.
    const doos = new THREE.Box3().setFromObject(model);
    if (!doos.isEmpty()) {
      rec.topY = Math.max(0.4, doos.max.y);
      rec.straal = Math.max(0.3,
        Math.abs(doos.min.x), Math.abs(doos.max.x),
        Math.abs(doos.min.z), Math.abs(doos.max.z));
    }
  } catch (e) {
    rec.fout = afkorten(String((e && e.message) || e));
  }
  maakChip(rec);
}

// ── grid-opstelling + vloer ───────────────────────────────────────────────
function plaatsGrid() {
  const n = records.length;
  const kolommen = Math.ceil(Math.sqrt(n));
  const rijen = Math.ceil(n / kolommen);
  const cel = Math.max(1.6, 2.7 * Math.max(...records.map((r) => r.straal)));

  records.forEach((rec, i) => {
    const k = i % kolommen, r = Math.floor(i / kolommen);
    rec.groep.position.set(
      (k - (kolommen - 1) / 2) * cel, 0,
      (r - (rijen - 1) / 2) * cel);
    rec.groep.rotation.y = i * 2.399; // gulden hoek — niet synchroon draaien
    scene.add(maakCirkel(cel * 0.30, rec.groep.position)); // pivot-markering
  });

  const omvang = cel * Math.max(kolommen, rijen) + cel * 1.5;
  const grid = new THREE.GridHelper(omvang, Math.max(4, Math.round(omvang / (cel / 2))), 0x24272b, 0x17191c);
  grid.position.y = 0.001;
  scene.add(grid);

  const vloer = new THREE.Mesh(
    new THREE.PlaneGeometry(omvang * 2, omvang * 2),
    new THREE.ShadowMaterial({ opacity: 0.38 }));
  vloer.rotation.x = -Math.PI / 2;
  vloer.receiveShadow = true;
  scene.add(vloer);

  const d = omvang * 0.7 + 4;
  keyLicht.position.set(d * 0.55, d, d * 0.4);
  const s = omvang * 0.75 + 2;
  Object.assign(keyLicht.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.5, far: d * 3 });

  richtCamera(omvang * 0.5 + Math.max(...records.map((r) => r.topY)));
}

function maakCirkel(straal, positie) {
  const punten = new THREE.EllipseCurve(0, 0, straal, straal).getPoints(48)
    .map((p) => new THREE.Vector3(p.x, 0.002, p.y));
  const lijn = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(punten),
    new THREE.LineBasicMaterial({ color: 0x3a3f45, transparent: true, opacity: 0.7 }));
  lijn.position.set(positie.x, 0, positie.z);
  return lijn;
}

function richtCamera(straal) {
  const doel = new THREE.Vector3(0, Math.min(0.9, straal * 0.18), 0);
  const pos = new THREE.Vector3().setFromSphericalCoords(
    Math.max(3, straal * 1.55), Math.PI * 0.37, -Math.PI * 0.17).add(doel);
  camera.position.copy(pos);
  controls.target.copy(doel);
  controls.update();
  camThuis = { pos: pos.clone(), doel: doel.clone() };
}

// ── labels ────────────────────────────────────────────────────────────────
function maakChip(rec) {
  const e = rec.entry;
  const chip = document.createElement('div');
  chip.className = 'chip' + (rec.fout ? ' fout' : '');
  const status = String(e.status || 'review');
  const kop = `<div><span class="dot st-${cssVeilig(status)}" title="status: ${escapeHtml(status)}"></span><b>${escapeHtml(e.id || '?')}</b></div>` +
    `<div class="meta">${escapeHtml([e.categorie, e.rol].filter(Boolean).join(' · ') || '—')}</div>`;
  chip.innerHTML = rec.fout
    ? kop + `<div class="rij"><span class="foutmelding">load-fout: ${escapeHtml(rec.fout)}</span></div>`
    : kop + `<div class="rij"><span>${NL.format(rec.tris)} tris</span><button class="wf">wire</button></div>`;
  chip.title = ['licentie: ' + (e.licentie || '—'), 'credit: ' + (e.credit || '—'),
    'source: ' + (e.source || '—'), 'status: ' + status].join('\n');
  chip.addEventListener('click', () => focusOp(rec));
  const knop = chip.querySelector('button.wf');
  if (knop) knop.addEventListener('click', (ev) => { ev.stopPropagation(); zetWire(rec, !rec.wire); });
  rec.chip = chip;
  rec.chipKnop = knop;
  el.labels.appendChild(chip);
}

const _v = new THREE.Vector3();
const _kijk = new THREE.Vector3();
function positioneerChips() {
  camera.getWorldDirection(_kijk);
  for (const rec of records) {
    _v.set(rec.groep.position.x, rec.topY + 0.12, rec.groep.position.z);
    const naarAsset = _v.clone().sub(camera.position);
    if (naarAsset.dot(_kijk) <= 0) { rec.chip.style.display = 'none'; continue; }
    _v.project(camera);
    rec.chip.style.display = '';
    rec.chip.style.left = ((_v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    rec.chip.style.top = ((-_v.y * 0.5 + 0.5) * window.innerHeight - 8) + 'px';
  }
}

// ── interactie ────────────────────────────────────────────────────────────
function zetWire(rec, aan) {
  rec.wire = aan;
  for (const m of rec.materialen) m.wireframe = aan;
  if (rec.chipKnop) rec.chipKnop.classList.toggle('aan', aan);
}

function focusOp(rec) {
  controls.target.set(rec.groep.position.x, rec.topY * 0.45, rec.groep.position.z);
}

const raycaster = new THREE.Raycaster();
let neer = null;
canvas.addEventListener('pointerdown', (ev) => { neer = { x: ev.clientX, y: ev.clientY }; });
canvas.addEventListener('pointerup', (ev) => {
  if (!neer || Math.hypot(ev.clientX - neer.x, ev.clientY - neer.y) > 5) { neer = null; return; }
  neer = null;
  raycaster.setFromCamera(new THREE.Vector2(
    (ev.clientX / window.innerWidth) * 2 - 1,
    -(ev.clientY / window.innerHeight) * 2 + 1), camera);
  const hits = raycaster.intersectObjects(records.map((r) => r.groep), true);
  if (!hits.length) return;
  let o = hits[0].object;
  while (o) {
    const rec = records.find((r) => r.groep === o);
    if (rec) { focusOp(rec); return; }
    o = o.parent;
  }
});

window.addEventListener('keydown', (ev) => {
  if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
  const t = ev.key.toLowerCase();
  if (t === 'w') {
    const aan = !records.every((r) => r.wire || r.fout);
    for (const rec of records) if (!rec.fout) zetWire(rec, aan);
  } else if (t === 'r' && camThuis) {
    camera.position.copy(camThuis.pos);
    controls.target.copy(camThuis.doel);
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── hud ───────────────────────────────────────────────────────────────────
function bijwerkenHud() {
  totaalTris = records.reduce((som, r) => som + r.tris, 0);
  const fouten = records.filter((r) => r.fout).length;
  const over = totaalTris > ijkpunt;
  el.stats.innerHTML =
    `${records.length} asset${records.length === 1 ? '' : 's'}` +
    (fouten ? ` <span class="over">(${fouten} fout)</span>` : '') +
    ` <span class="dim">·</span> totaal ` +
    `<span class="${over ? 'over' : ''}">${NL.format(totaalTris)}</span> <span class="dim">tris</span>`;
  el.fill.style.width = Math.min(100, (totaalTris / ijkpunt) * 100) + '%';
  el.fill.classList.toggle('over', over);
  el.ijkpunt.textContent = 'ijkpunt ' + NL.format(ijkpunt);
}

function toonStatus(html) {
  el.statusTekst.innerHTML = html;
  el.status.classList.add('zichtbaar');
}

// ── lus ───────────────────────────────────────────────────────────────────
const klok = new THREE.Clock();
function start() {
  renderer.setAnimationLoop(() => {
    const dt = Math.min(klok.getDelta(), 0.1);
    if (!stilstand) for (const rec of records) rec.groep.rotation.y += DRAAISNELHEID * dt;
    controls.update();
    positioneerChips();
    renderer.render(scene, camera);
  });
}

// ── klein spul ────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function cssVeilig(s) { return String(s).replace(/[^a-z0-9_-]/gi, ''); }
function afkorten(s) { return s.length > 90 ? s.slice(0, 87) + '…' : s; }
