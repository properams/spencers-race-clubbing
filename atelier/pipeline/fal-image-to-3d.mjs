#!/usr/bin/env node
// fal.ai queue-client voor de concepts/-route: concept-PNG/JPG → ruwe GLB.
// Model-agnostisch — welk fal-model gebruikt wordt, bepaalt de aanroeper via
// FAL_MODEL_ID (zie .github/workflows/atelier-optimize.yml). Deze module weet
// niets van "trellis" specifiek, alleen van de generieke fal-queue-flow.
//
// gebruik:
//   FAL_KEY=... FAL_MODEL_ID=fal-ai/trellis \
//     node fal-image-to-3d.mjs <concept.png> --id mijn_asset --out atelier/assets/raw/mijn_asset_raw.glb
//
// Schrijft pas naar --out ná een volledig geslaagde download (via een .tmp-
// bestand + atomische rename), zodat een afgebroken run nooit een halve
// cache-GLB achterlaat die de idempotentie-check in de workflow zou misleiden.
import fs from 'node:fs';
import path from 'node:path';

const POLL_INTERVAL_MS = 5_000;
const MAX_WACHTTIJD_MS = 6 * 60 * 1000; // 6 minuten — ruim binnen het ~10-min DoD-venster

// ── argumenten ────────────────────────────────────────────────────────────
const ruwe = process.argv.slice(2);
const vlaggen = {};
const positioneel = [];
for (let i = 0; i < ruwe.length; i++) {
  const a = ruwe[i];
  if (a.startsWith('--')) vlaggen[a.slice(2)] = ruwe[++i];
  else positioneel.push(a);
}
if (positioneel.length !== 1 || !vlaggen.id || !vlaggen.out) {
  console.error('gebruik: node fal-image-to-3d.mjs <concept.png> --id <asset-id> --out <raw.glb-pad>');
  process.exit(1);
}

const id = vlaggen.id;
const invoerPad = path.resolve(positioneel[0]);
const uitPad = path.resolve(vlaggen.out);

async function main() {
  if (!fs.existsSync(invoerPad)) {
    throw new Fout(`concept-afbeelding niet gevonden: ${invoerPad}`);
  }

  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    throw new Fout(
      `FAL_KEY ontbreekt of is leeg voor asset "${id}" — stel de repository-secret ` +
      'FAL_KEY in (Settings ▸ Secrets and variables ▸ Actions) en draai de workflow opnieuw.'
    );
  }
  const modelId = process.env.FAL_MODEL_ID;
  if (!modelId) {
    throw new Fout('FAL_MODEL_ID ontbreekt — moet gezet zijn in het workflow-brede env-blok.');
  }

  const dataUri = naarDataUri(invoerPad);

  console.log(`fal.ai (${modelId}) — asset "${id}": indienen…`);
  const ingediend = await falPost(`https://queue.fal.run/${modelId}`, falKey, { image_url: dataUri });
  if (!ingediend.status_url || !ingediend.response_url) {
    throw new Fout(
      `onverwacht fal-antwoord bij indienen voor "${id}" — geen status_url/response_url in de respons. ` +
      `Controleer https://fal.ai/models/${modelId}/api op schema-wijzigingen.`
    );
  }

  const resultaat = await wachtOpVoltooiing(ingediend, falKey, id);

  const glbUrl = resultaat?.model_mesh?.url;
  if (typeof glbUrl !== 'string' || !glbUrl) {
    throw new Fout(
      `onverwacht fal-antwoord voor "${id}" — geen model_mesh.url gevonden in het resultaat. ` +
      `Controleer https://fal.ai/models/${modelId}/api op schema-wijzigingen.`
    );
  }

  console.log(`fal.ai — asset "${id}": GLB gereed, downloaden…`);
  await downloadNaarBestand(glbUrl, uitPad, id);

  const grootte = fs.statSync(uitPad).size;
  console.log(`fal.ai — asset "${id}": geschreven naar ${uitPad} (${Math.round(grootte / 1024)} kB)`);
}

// ── fal-queue-flow ───────────────────────────────────────────────────────
async function wachtOpVoltooiing(ingediend, falKey, id) {
  const begin = Date.now();
  let laatsteStatus = ingediend.status ?? 'IN_QUEUE';
  while (true) {
    if (Date.now() - begin > MAX_WACHTTIJD_MS) {
      throw new Fout(
        `fal-call time-out voor "${id}" na ${Math.round(MAX_WACHTTIJD_MS / 1000)}s ` +
        `(laatste status: "${laatsteStatus}") — probeer het later opnieuw.`
      );
    }
    const status = await falGet(ingediend.status_url, falKey);
    laatsteStatus = status.status ?? '?';
    if (laatsteStatus === 'COMPLETED') break;
    if (laatsteStatus !== 'IN_QUEUE' && laatsteStatus !== 'IN_PROGRESS') {
      throw new Fout(
        `fal-call voor "${id}" eindigde in onverwachte status "${laatsteStatus}": ` +
        afkorten(JSON.stringify(status))
      );
    }
    const positie = status.queue_position != null ? ` (wachtrijpositie ${status.queue_position})` : '';
    console.log(`fal.ai — asset "${id}": ${laatsteStatus}${positie}…`);
    await slaap(POLL_INTERVAL_MS);
  }
  return falGet(ingediend.response_url, falKey);
}

async function falPost(url, falKey, body) {
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Fout(`kan fal.ai niet bereiken (${url}): ${e.message}`);
  }
  return afhandelenAntwoord(r, url);
}

async function falGet(url, falKey) {
  let r;
  try {
    r = await fetch(url, { headers: { Authorization: `Key ${falKey}` } });
  } catch (e) {
    throw new Fout(`kan fal.ai niet bereiken (${url}): ${e.message}`);
  }
  return afhandelenAntwoord(r, url);
}

async function afhandelenAntwoord(r, url) {
  const tekst = await r.text();
  if (!r.ok) {
    throw new Fout(`fal-call mislukt — HTTP ${r.status} op ${url}: ${afkorten(tekst)}`);
  }
  try {
    return JSON.parse(tekst);
  } catch {
    throw new Fout(`fal.ai gaf geen geldige JSON terug van ${url}: ${afkorten(tekst)}`);
  }
}

// ── downloaden ───────────────────────────────────────────────────────────
async function downloadNaarBestand(url, uitPad, id) {
  let r;
  try {
    r = await fetch(url);
  } catch (e) {
    throw new Fout(`kan gegenereerde GLB niet downloaden voor "${id}": ${e.message}`);
  }
  if (!r.ok) {
    throw new Fout(`download van gegenereerde GLB mislukt voor "${id}" — HTTP ${r.status} op ${url}`);
  }
  const buffer = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(uitPad), { recursive: true });
  const tmpPad = uitPad + '.tmp';
  fs.writeFileSync(tmpPad, buffer);
  fs.renameSync(tmpPad, uitPad);
}

// ── klein spul ────────────────────────────────────────────────────────────
class Fout extends Error {}

function naarDataUri(bestandsPad) {
  const ext = path.extname(bestandsPad).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  const b64 = fs.readFileSync(bestandsPad).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function slaap(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function afkorten(s) {
  return s.length > 500 ? s.slice(0, 497) + '…' : s;
}

main().catch((e) => {
  console.error(e instanceof Fout ? e.message : `onverwachte fout: ${e.stack || e.message}`);
  process.exit(1);
});
