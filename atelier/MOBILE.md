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

2. **Upload naar `atelier/concepts/`** — github.com → repo → map
   `atelier/concepts/` → **Add file ▸ Upload files** → kies de PNG → hernoem
   zo nodig naar de naamconventie (kleine letters, cijfers, underscores, bv.
   `rc_kart_v1.png` — zie [`concepts/README.md`](concepts/README.md)) →
   **Commit changes** (rechtstreeks naar `master`). Klaar — geen Space meer
   nodig, geen GLB downloaden, geen hernoemen naar `_raw.glb`.

3. **Pipeline draait vanzelf** — de Action pikt de nieuwe concept-afbeelding
   op, stuurt 'm naar fal.ai TRELLIS (~$0,02/run; model-id staat bovenaan de
   workflow), en draait daarna weld → dedup → simplify → pivot-to-foot →
   meshopt. Schrijft `atelier/assets/raw/naam_raw.glb` (cache),
   `atelier/assets/clean/naam.glb`, en voegt de entry toe aan
   `atelier/manifest.json` met status `review`. Volg 'm onder tab
   **Actions** (~5–10 min — vooral de fal-generatie kost tijd).
   - Mislukt de fal-call (geen saldo, ontbrekende `FAL_KEY`, time-out)? De
     job faalt zichtbaar met een leesbare melding in de log — er wordt niets
     half weggeschreven. Een volgende poging (opnieuw uploaden, of
     **Re-run failed jobs**) kost geen dubbele fal-call zodra de raw-GLB al
     gecachet is.
   - Ander tris-doel dan 5000? Dat werkt alleen voor de handmatige
     `assets/raw/`-route hieronder (tab **Actions → atelier-optimize →
     Run workflow**) — niet voor concept-uploads.

4. **Vercel redeployt** automatisch op de master-push (~1 min).

5. **Beoordeel op je telefoon** — open in een **privétab**:
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

6. **Oordeel vastleggen** — github.com → `atelier/manifest.json` → potlood ✏️ →
   zet `"status"` op `goedgekeurd` of `afgekeurd` → Commit.

7. **Goedgekeurd → game** — los traject via de bestaande intake: GLB naar
   `assets/models/…`, slot wiren in `assets/manifest.json`, credit in
   `assets/CREDITS.md`.

## Alternatief: gratis, zonder betaalde fal-call

Liever niet betalen per asset? Gebruik route B uit `atelier/README.md`: open
een gratis Hugging Face Space (TRELLIS of Hunyuan3D) in je mobiele browser,
genereer en download de GLB daar zelf, en upload die rechtstreeks naar
`atelier/assets/raw/` (hernoemd naar `naam_raw.glb`) in plaats van naar
`concepts/`. Stap 3 t/m 7 hierboven blijven hetzelfde — de Action herkent een
handmatig geüploade raw-GLB net zo goed.

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
- **Geen lus:** de Action triggert op `atelier/assets/raw/**` én
  `atelier/concepts/**`, en elke auto-commit (ook de raw-GLB die de
  concepts-route zelf naar `assets/raw/` wegschrijft) draagt `[skip ci]`, dus
  hij triggert zichzelf niet.
- **`FAL_KEY`-secret:** de concepts/-route vereist dat de repository-secret
  `FAL_KEY` is ingesteld (Settings ▸ Secrets and variables ▸ Actions). Zonder
  geldige key of bij onvoldoende saldo faalt de job met een duidelijke
  melding in de Actions-log — de handmatige raw/-route (hierboven,
  "Alternatief") heeft deze secret niet nodig.
- **Draco-input** wordt niet ondersteund: exporteer je raw ongecomprimeerd.
- **Zwaar kapotte mesh** (gaten/non-manifold): repareer lokaal met
  `atelier/pipeline/cleanup.py` (Blender) en upload het resultaat opnieuw.
