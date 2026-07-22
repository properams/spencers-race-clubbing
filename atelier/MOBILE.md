# atelier — nieuwe assets maken vanaf je telefoon

Volledige asset-flow zonder laptop. De enige stap die geen telefoon aankan —
het optimaliseren (Node) — draait automatisch in GitHub Actions
(`.github/workflows/atelier-optimize.yml`). Deploy loopt via Vercel op
`master`.

> ⚠️ Doe dit in je **mobiele browser** op github.com, **niet** in de GitHub-app —
> de app kan geen bestanden uploaden.

## Per asset

1. **Concept-art (2D)** — genereer in je browser, bv. Bing Image Creator
   (bing.com/images/create), Leonardo.ai of Ideogram.ai. Bewaar de PNG in
   je Foto's/Files.

   **Recept voor een goed image→3D-resultaat** (bepaalt de kwaliteit!):
   - één object, gecentreerd, vult ~70-80% van het beeld
   - effen neutrale achtergrond (wit/lichtgrijs) — geen scène, geen
     grondschaduw, geen andere objecten erbij
   - ¾-aanzicht (niet zuiver front- of top-down — geeft meer diepte-info)
   - zachte, egale studio-belichting, geen harde slagschaduw
   - vermijd glas/spiegelend/transparant en dunne uitstekende delen
   - voorbeeldprompt: *"a single [object], ¾ view, plain white studio
     background, soft even lighting, no shadow on the ground, product
     photo style"*

2. **Image→3D** — open in je browser een gratis Space, upload de PNG, genereer,
   **download de GLB**:
   - TRELLIS — https://huggingface.co/spaces/JeffreyXiang/TRELLIS
   - Hunyuan3D — https://huggingface.co/spaces/tencent/Hunyuan3D-2
   - Trage gratis wachtrij? fal.ai/models/fal-ai/trellis heeft een
     **Playground**-tab (webformulier, geen curl/terminal nodig) — betaald
     per run, wel sneller/stabieler.

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
   `https://spencers-race-clubbing.vercel.app/atelier/`

   Bediening op mobiel (de `W`/`R`-sneltoetsen in de legenda zijn
   desktop-only en werken niet zonder toetsenbord):
   - **1 vinger slepen** = draaien, **pinch** = zoomen, **2 vingers
     slepen** = pannen (touch werkt gewoon)
   - **wireframe**: tik de **"wire"-knop op de chip** van dat ene asset
     (een tik-knop, geen sneltoets) — er is nog geen mobiele knop voor
     "alles wireframe" of "camera resetten"

   Kijk naar: silhouet op de turntable, wireframe (topologie-rommel),
   tris in de chip, pivot t.o.v. de ring, en het lopende totaal tegen het
   1.5M-ijkpunt.

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
