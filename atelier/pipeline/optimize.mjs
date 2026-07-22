#!/usr/bin/env node
// atelier optimize-pipeline — raw image→3D-GLB → genormaliseerde GLB in
// assets/clean/ + entry in atelier/manifest.json.
//
// Keten: weld → dedup → prune → simplify (tris-doel) → pivot-to-foot
//        → KTX2 (automatisch als `toktx` op PATH staat) → meshopt.
//
// gebruik:
//   node optimize.mjs <raw.glb> --tris 5000 [--id naam] [--categorie prop]
//        [--rol decor] [--licentie ...] [--credit ...] [--status review]
//        [--error 0.001] [--no-ktx2] [--atelier <map>]
import { NodeIO, getBounds, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { weld, dedup, prune, simplify, meshopt, listTextureSlots } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── argumenten ────────────────────────────────────────────────────────────
const ruwe = process.argv.slice(2);
const vlaggen = {};
const positioneel = [];
for (let i = 0; i < ruwe.length; i++) {
  const a = ruwe[i];
  if (a === '--no-ktx2') vlaggen.noKtx2 = true;
  else if (a.startsWith('--')) vlaggen[a.slice(2)] = ruwe[++i];
  else positioneel.push(a);
}
if (positioneel.length !== 1) {
  console.error('gebruik: node optimize.mjs <raw.glb> --tris 5000 [--id naam] [opties]');
  process.exit(1);
}

const invoerPad = path.resolve(positioneel[0]);
const atelierMap = vlaggen.atelier
  ? path.resolve(vlaggen.atelier)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doelTris = Math.max(1, Number(vlaggen.tris ?? 5000));
const simplifyFout = Number(vlaggen.error ?? 0.001);
const id = (vlaggen.id ?? path.basename(invoerPad).replace(/\.(glb|gltf)$/i, '').replace(/_raw$/i, ''))
  .replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
const uitPad = path.join(atelierMap, 'assets', 'clean', id + '.glb');
const manifestPad = path.join(atelierMap, 'manifest.json');

if (!fs.existsSync(invoerPad)) { console.error('invoer niet gevonden: ' + invoerPad); process.exit(1); }

// ── helpers ───────────────────────────────────────────────────────────────
function telTris(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      n += Math.round((idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3);
    }
  }
  return n;
}
function vindBinary(naam) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [naam], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n')[0] : null;
}
function fmt(n) { return n.toLocaleString('nl-NL'); }
function m(v) { return v.map((x) => x.toFixed(3)).join(', '); }

// ── pipeline ──────────────────────────────────────────────────────────────
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

console.log('atelier optimize — ' + path.basename(invoerPad) + ' → ' + path.relative(atelierMap, uitPad));

let doc;
try {
  doc = await io.read(invoerPad);
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
} catch (e) {
  console.error('kan invoer niet lezen: ' + e.message);
  if (/draco/i.test(String(e.message))) console.error('tip: draco-invoer wordt niet ondersteund — exporteer ongecomprimeerd.');
  process.exit(1);
}

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

const trisVoor = telTris(doc);

// 1) opschonen
await doc.transform(weld(), dedup(), prune());
const trisSchoon = telTris(doc);

// 2) simplify richting tris-doel — het doel is leidend: de fouttolerantie
//    groeit per pas mee tot het doel (±15%) gehaald is of de kwaliteitsgrens
//    (error 0.05) bereikt is.
let trisNa = trisSchoon;
if (trisSchoon > doelTris) {
  let fout = simplifyFout;
  for (let pas = 0; pas < 5 && trisNa > doelTris * 1.15 && fout <= 0.05; pas++) {
    await doc.transform(simplify({
      simplifier: MeshoptSimplifier, ratio: doelTris / trisNa, error: fout,
    }));
    trisNa = telTris(doc);
    fout *= pas === 0 ? 5 : 2.5;
  }
  if (trisNa > doelTris * 1.15) {
    console.log('  simplify: gestopt op kwaliteitsgrens — ' + fmt(trisNa) +
      ' tris (doel ' + fmt(doelTris) + '); overweeg pipeline/cleanup.py voor zware repair');
  }
} else {
  console.log('  simplify: overgeslagen (al ≤ doel van ' + fmt(doelTris) + ')');
}

// 3) pivot-to-foot: bbox-midden op x/z = 0, onderkant op y = 0
const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
let bboxNa = null;
if (scene) {
  const b = getBounds(scene);
  const dx = (b.min[0] + b.max[0]) / 2, dy = b.min[1], dz = (b.min[2] + b.max[2]) / 2;
  if ([dx, dy, dz].some((v) => Math.abs(v) > 1e-6)) {
    for (const kind of scene.listChildren()) {
      const t = kind.getTranslation();
      kind.setTranslation([t[0] - dx, t[1] - dy, t[2] - dz]);
    }
    console.log('  pivot-to-foot: verschoven met [' + m([-dx, -dy, -dz]) + ']');
  } else {
    console.log('  pivot-to-foot: stond al goed');
  }
  bboxNa = getBounds(scene);
}

// 4) KTX2-textures (automatisch wanneer KTX-Software's toktx aanwezig is)
const texturen = doc.getRoot().listTextures();
if (vlaggen.noKtx2) {
  console.log('  ktx2: overgeslagen (--no-ktx2)');
} else if (texturen.length === 0) {
  console.log('  ktx2: geen texturen aanwezig');
} else {
  const toktx = vindBinary('toktx');
  if (!toktx) {
    console.log('  ktx2: overgeslagen — `toktx` niet gevonden op PATH (installeer KTX-Software;');
    console.log('        texturen blijven als PNG/JPEG, de viewer toont beide)');
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-ktx-'));
    let gelukt = 0;
    for (const tex of texturen) {
      const mime = tex.getMimeType();
      if (mime !== 'image/png' && mime !== 'image/jpeg') { console.log('  ktx2: sla over (' + mime + ')'); continue; }
      const slots = listTextureSlots.length === 1 ? listTextureSlots(tex) : listTextureSlots(doc, tex);
      const srgb = slots.some((s) => /baseColor|emissive|diffuse|sheen|specular/i.test(s));
      const inTmp = path.join(tmp, 'in' + (mime === 'image/jpeg' ? '.jpg' : '.png'));
      const uitTmp = path.join(tmp, 'uit.ktx2');
      fs.writeFileSync(inTmp, tex.getImage());
      const r = spawnSync(toktx, [
        '--t2', '--genmipmap', '--encode', 'uastc', '--uastc_quality', '2',
        '--zcmp', '18', '--assign_oetf', srgb ? 'srgb' : 'linear', uitTmp, inTmp,
      ], { encoding: 'utf8' });
      if (r.status === 0 && fs.existsSync(uitTmp)) {
        tex.setImage(fs.readFileSync(uitTmp)).setMimeType('image/ktx2');
        fs.rmSync(uitTmp);
        gelukt++;
      } else {
        console.log('  ktx2: mislukt voor "' + (tex.getName() || slots.join('/')) + '" — origineel behouden');
        if (r.stderr) console.log('        ' + r.stderr.trim().split('\n').pop());
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    if (gelukt > 0) {
      doc.createExtension(KHRTextureBasisu).setRequired(true);
      console.log('  ktx2: ' + gelukt + '/' + texturen.length + ' texturen → UASTC + zstd');
    }
  }
}

// 5) meshopt-compressie
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

// 6) wegschrijven
fs.mkdirSync(path.dirname(uitPad), { recursive: true });
await io.write(uitPad, doc);
const grootte = fs.statSync(uitPad).size;

// 7) manifest bijwerken (upsert op id)
let manifest = { _format: 'atelier-manifest v1', budget_tris_totaal: 1500000, entries: [] };
if (fs.existsSync(manifestPad)) {
  try { manifest = JSON.parse(fs.readFileSync(manifestPad, 'utf8')); }
  catch { console.error('waarschuwing: manifest onleesbaar, begin opnieuw'); }
}
if (!Array.isArray(manifest.entries)) manifest.entries = [];
const bestaand = manifest.entries.find((e) => e.id === id);
const entry = {
  id,
  categorie: vlaggen.categorie ?? bestaand?.categorie ?? 'prop',
  rol: vlaggen.rol ?? bestaand?.rol ?? 'decor',
  licentie: vlaggen.licentie ?? bestaand?.licentie ?? 'eigen werk — image→3D (zie atelier/README.md)',
  credit: vlaggen.credit ?? bestaand?.credit ?? 'eigen concept-art → image→3D',
  tris: trisNa,
  status: vlaggen.status ?? bestaand?.status ?? 'review',
  file: 'assets/clean/' + id + '.glb',
  source: path.relative(atelierMap, invoerPad).startsWith('..')
    ? path.basename(invoerPad)
    : path.relative(atelierMap, invoerPad).replace(/\\/g, '/'),
  added: bestaand?.added ?? new Date().toISOString().slice(0, 10),
};
if (bestaand) Object.assign(bestaand, entry);
else manifest.entries.push(entry);
fs.writeFileSync(manifestPad, JSON.stringify(manifest, null, 2) + '\n');

// ── rapport ───────────────────────────────────────────────────────────────
console.log('  tris: ' + fmt(trisVoor) + ' → ' + fmt(trisNa) +
  ' (doel ' + fmt(doelTris) + ', ' + Math.round((trisNa / Math.max(1, trisVoor)) * 100) + '% van origineel)');
if (bboxNa) console.log('  bbox na pivot: min [' + m(bboxNa.min) + '] · max [' + m(bboxNa.max) + ']');
console.log('  bestand: ' + path.join(path.basename(atelierMap), 'assets', 'clean', id + '.glb') +
  ' (' + fmt(Math.round(grootte / 1024)) + ' kB)');
console.log('  manifest: entry "' + id + '" ' + (bestaand ? 'bijgewerkt' : 'toegevoegd') +
  ' (status: ' + entry.status + ')');
console.log('klaar — bekijk in de atelier-viewer.');
