# atelier — nieuwe assets maken vanaf je telefoon

Volledige asset-flow zonder laptop. De enige stap die geen telefoon aankan —
het optimaliseren (Node) — draait automatisch in GitHub Actions
(`.github/workflows/atelier-optimize.yml`). Deploy loopt via Vercel op
`master`.

> ⚠️ Doe dit in je **mobiele browser** op github.com, **niet** in de GitHub-app —
> de app kan geen bestanden uploaden.

## Per asset

1. **Concept-art (2D)** — genereer of teken één object, ¾-hoek, egale neutrale
   achtergrond. Bewaar de PNG in je Foto's/Files.

2. **Image→3D** — open in je browser een gratis Space, upload de PNG, genereer,
   **download de GLB**:
   - TRELLIS — https://huggingface.co/spaces/JeffreyXiang/TRELLIS
   - Hunyuan3D — https://huggingface.co/spaces/tencent/Hunyuan3D-2

3. **Upload naar de repo** — github.com → repo → map `atelier/assets/raw/` →
   **Add file ▸ Upload files** → kies de GLB → hernoem naar `naam_raw.glb` →
   **Commit changes** (rechtstreeks naar `master`).

4. **Pipeline draait vanzelf** — de Action pikt de nieuwe raw op en draait
   weld → dedup → simplify → pivot-to-foot → meshopt, schrijft
   `atelier/assets/clean/naam.glb` en voegt de entry toe aan
   `atelier/manifest.json`. Volg 'm onder tab **Actions** (~1–2 min).
   - Ander tris-doel dan 5000? Tab **Actions → atelier-optimize → Run workflow**,
     vul `file` (bestandsnaam) en `tris` in.

5. **Vercel redeployt** automatisch op de master-push (~1 min).

6. **Beoordeel op je telefoon** — open in een **privétab**:
   `https://<jouw-vercel-project>.vercel.app/atelier/`
   Turntable draaien, silhouet checken, **wire**-toggle voor topologie, tris
   tegen het ijkpunt van 1.500.000.

7. **Oordeel vastleggen** — github.com → `atelier/manifest.json` → potlood ✏️ →
   zet `"status"` op `goedgekeurd` of `afgekeurd` → Commit.

8. **Goedgekeurd → game** — los traject via de bestaande intake: GLB naar
   `assets/models/…`, slot wiren in `assets/manifest.json`, credit in
   `assets/CREDITS.md`.

## Snelle variant zonder optimize

Alleen even de vórm checken, zonder de Action af te wachten: upload de GLB
direct in `atelier/assets/clean/` en plak met de ✏️-editor een entry in
`atelier/manifest.json`. Ongeoptimaliseerd en tris handmatig, maar genoeg om
het silhouet op de turntable te beoordelen. 100% telefoon, geen runner.

## Goed om te weten

- **KTX2-texturecompressie** draait in CI niet (de runner heeft `toktx` niet);
  texturen blijven PNG/JPEG. De viewer en de game tonen beide prima. Wil je
  KTX2 tóch in CI, laat het weten — dan installeer ik KTX-Software in de
  workflow.
- **Geen lus:** de Action triggert alleen op `atelier/assets/raw/**` en
  commit terug naar `clean/` + `manifest.json`, dus hij triggert zichzelf niet.
- **Draco-input** wordt niet ondersteund: exporteer je raw ongecomprimeerd.
- **Zwaar kapotte mesh** (gaten/non-manifold): repareer lokaal met
  `atelier/pipeline/cleanup.py` (Blender) en upload het resultaat opnieuw.
