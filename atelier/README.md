# atelier

Standalone asset-showroom: een snelle kwaliteitspoort om **zelf-gegenereerde
3D-assets** (image→3D-output) te beoordelen op vorm en kwaliteit vóór ze de
game-wereld in gaan. Staat volledig los van de game — eigen route, eigen
manifest, geen enkele import vanuit game-code.

- Route: `/atelier/` (statische map op repo-root; geen build-stap nodig)
- Manifest: `atelier/manifest.json` (los van `assets/manifest.json` van de game)
- `assets/raw/` — **uitsluitend** eigen image→3D-output (geen betaalde
  Fab-bronbestanden; die blijven in de private workspace)
- `assets/clean/` — genormaliseerde output van de optimize-pipeline
- `pipeline/` — optimize-scripts (Node / gltf-transform)
- `vendor/` — gevendorde three r160 (ESM) + addons; de viewer heeft geen CDN
  of game-bestanden nodig

## Viewer

Open `/atelier/` (op de deploy) of lokaal vanaf repo-root:

```bash
python3 -m http.server 8000
# → http://localhost:8000/atelier/
```

Grid met per asset: langzame turntable, pivot-ring (scheve pivot = direct
zichtbaar), label met id · categorie · rol · tris · status, en een
wireframe-toggle. HUD toont het lopende tris-totaal tegen het **ijkpunt van
1.500.000 tris** (`budget_tris_totaal` in het manifest). Neutrale
studio-belichting, geen game-haze — de vorm is wat je beoordeelt.
Sneltoetsen: `W` wireframe alles · `R` reset camera · klik = focus.

## De volle keten: concept → game

### 1. Concept-art (2D, vaste stijl)

Eén object per beeld, ¾-aanzicht, egale neutrale achtergrond, zacht
studiolicht, geen slagschaduw over de vloer. Zelfde stijlregels voor elke
prompt zodat de set consistent blijft.

### 2. Image→3D (extern)

**Gratis route — Hugging Face Space (browser):** upload het concept, genereer,
download de GLB.

- TRELLIS: https://huggingface.co/spaces/JeffreyXiang/TRELLIS
- Hunyuan3D: https://huggingface.co/spaces/tencent/Hunyuan3D-2

**API-route — fal.ai (betaald per run):**

```bash
curl -X POST "https://queue.fal.run/fal-ai/trellis" \
  -H "Authorization: Key $FAL_KEY" -H "Content-Type: application/json" \
  -d '{"image_url": "https://…/concept.png"}'
# poll de response-URL uit het antwoord; download daarna de model_mesh-GLB
```

Check het exacte model-slug + response-schema op https://fal.ai/models
(zoek "trellis" of "hunyuan3d") — die wijzigen weleens.

### 3. Download naar raw/

```bash
mv ~/Downloads/model.glb atelier/assets/raw/mijn_asset_raw.glb
```

### 4. Optimize (default-pad, geen Blender nodig)

Eenmalig: `cd atelier/pipeline && npm install` (Node ≥ 18). Daarna per asset:

```bash
node atelier/pipeline/optimize.mjs atelier/assets/raw/mijn_asset_raw.glb --tris 5000
```

Keten: weld → dedup → prune → simplify (tris-doel is leidend; fouttolerantie
groeit per pas) → pivot-to-foot (voet op y=0, gecentreerd op x/z) →
KTX2-textures → meshopt-compressie. Schrijft `assets/clean/<id>.glb` en doet
een idempotente upsert in `atelier/manifest.json`.

Opties: `--id` `--categorie` `--rol` `--licentie` `--credit` `--status`
`--error` `--no-ktx2` `--atelier <map>`.

- **KTX2** draait automatisch wanneer KTX-Software's `toktx` op PATH staat
  (https://github.com/KhronosGroup/KTX-Software/releases). Zonder toktx
  blijven textures PNG/JPEG — de viewer toont beide; geen blocker.
- **Draco-input** wordt niet ondersteund: exporteer raw ongecomprimeerd.
- **Probleem-assets** (gaten, non-manifold): optionele escape-hatch
  `pipeline/cleanup.py` via Blender headless (zie de kop van dat bestand),
  daarna gewoon weer door optimize.mjs. Blender is voor het default-pad
  níet nodig.

### 5. Beoordelen in de atelier

Open de viewer (stap hierboven). Kijk naar: silhouet op de turntable,
wireframe (topologie-rommel), tris in de chip, pivot t.o.v. de ring, en het
lopende totaal tegen het 1.5M-ijkpunt. Oordeel vastleggen:

```bash
node atelier/pipeline/optimize.mjs atelier/assets/raw/mijn_asset_raw.glb --status goedgekeurd
# of: status handmatig aanpassen in atelier/manifest.json (review/goedgekeurd/afgekeurd)
```

### 6. Goedgekeurd → in-world showroom

De atelier is de poort, niet de bestemming. Een goedgekeurde asset gaat
daarna door het **bestaande** intake-proces van de game (de atelier verandert
daar niets aan): GLB naar `assets/models/…`, slot wiren in
`assets/manifest.json`, credit in `assets/CREDITS.md` — zie `assets/README.md`.

## Licenties

Zelf-gegenereerde assets (eigen concept-art → image→3D) zijn **eigen werk**
en mogen als raw én clean in deze publieke repo:

- **TRELLIS** (Microsoft): MIT — output vrij te gebruiken.
- **Hunyuan3D** (Tencent): community-licentie; commercieel gebruik incl.
  verkoop toegestaan binnen de licentievoorwaarden (o.a. MAU-grens) — check
  de actuele licentie bij twijfel.

Dit staat los van **betaalde Fab-assets**: die bronbestanden blijven in de
private workspace en horen nooit in deze repo — `assets/raw/` is uitsluitend
voor eigen image→3D-output.

## Onderhoud

- **Hernoemen** ("atelier" → iets anders): één constante `ATELIER_NAAM` in
  `atelier.js` + de mapnaam zelf.
- **Stale viewer na deploy:** de game-service-worker cachet `.js`
  stale-while-revalidate; hard refresh (Cmd/Ctrl+Shift+R) of bump `?v=` in
  `index.html`.
- **IJkpunt aanpassen:** `budget_tris_totaal` in `atelier/manifest.json`.
