# PATTERNS

Herbruikbare codepatronen en conventies in deze repo. Raadpleeg vóór je iets
opnieuw uitvindt; vul aan als je een patroon vastlegt.

---

## Race-game (gegenereerd — bewerk in `srclub-workspace`, niet hier)

> De game-bestanden in deze repo zijn gepubliceerde output. De patronen
> hieronder beschrijven hoe de game werkt; wijzig ze in de bron-repo
> `srclub-workspace`, waar ze via `publish.yml` naar hier komen.

- **Service-worker-caching (`sw.js`).** Drie strategieën: cache-first voor
  onveranderlijke assets (`/assets/vendor|hdri|textures|models|audio/`,
  `/js/worlds/`), network-first voor de shell (HTML/CSS), stale-while-revalidate
  voor overige JS. **Bump `SW_VERSION`** wanneer de caching-logica zelf wijzigt
  (niet voor elke content-update). Query-string-versies (`?v=…`) moeten exact
  gelijk zijn aan die in `index.html`, anders blijft de oude cache hangen.
- **Root-absolute assetpaden.** `sw.js` gebruikt `/dist/…`, `/assets/…`. Dit
  bindt aan een domein-root, niet aan de repo-naam. Verhuis je naar een
  Pages-subpad, dan breekt dit — zie `docs/LESSONS.md`.
- **Werelden.** Eén bestand per wereld onder `js/worlds/`, dynamisch geladen via
  de world-loader. `space` = default, `guangzhou` = zwaarste. Effecten
  degraderen via de quality-tier/perf-laag in `js/core/`.
- **Persistence.** localStorage-sleutels met prefix `spencerRC` (o.a.
  `spencerRC`, `spencerRC_identity`) in `js/persistence/`. Save-export als
  `spencer-race-save-<handle>-<datum>.json`. Wijzig deze sleutels niet zonder
  migratiepad — dat wist bestaande saves.

## Atelier

- **Volledig geïsoleerd.** `atelier/**` importeert nooit game-code. Eigen
  `manifest.json` (los van `assets/manifest.json`), eigen route `/atelier/`,
  eigen gevendorde three (`atelier/vendor/three.module.min.js`, r160 ESM).
- **Asset-flow.** `assets/raw/` (eigen image→3D-output) → `pipeline/optimize.mjs`
  (gltf-transform, tris-doel leidend) → `assets/clean/` + entry in `manifest.json`
  met status `review|goedgekeurd|afgekeurd`. Draait ook in CI
  (`.github/workflows/atelier-optimize.yml`) zodat het vanaf een telefoon kan.
- **Tris-budget.** De showroom toetst het lopende tris-totaal tegen
  `budget_tris_totaal` (1.500.000) in het manifest.

## Repo-breed

- **`npm run verify` vóór commit/deploy.** Zie `scripts/verify.mjs`.
- **Handover aan het eind van elke sessie.** Zie `docs/handovers/`.
