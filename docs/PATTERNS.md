# PATTERNS

Herbruikbare patronen en harde feiten over deze codebase.

## Race-game
- **Twee three.js-vendorings, niet uitwisselbaar.** Game =
  `assets/vendor/three-r160.min.js` (classic global `THREE`); atelier =
  `atelier/vendor/three.module.min.js` (ESM). Zelfde versie, ander laadmodel —
  meng ze niet.
- **Service worker precachet root-absoluut.** `sw.js` gebruikt `/…`-paden; die
  kloppen alleen op een domein-root. Bump de SW-cacheversie bij elke
  asset-wijziging, anders serveert de SW de oude bundel.
- **`dist/` is gecommit, niet gebouwd.** De bundels zijn artefacten zonder
  in-repo build. Behandel ze als output, niet als bron.

## Atelier
- **Manifest-status raw → clean.** Een asset doorloopt `raw/` → optimize → `clean/`
  met een status-entry in `atelier/manifest.json` (bv. `review`). Het bestaan van
  de raw-GLB + manifest-entry is tevens de idempotentie-vlag.
- **Per-item commit bij betaalde externe calls.** In de CI wordt per verwerkt item
  apart gecommit + gepusht (niet één verzamel-commit), zodat een latere mislukking
  een eerder geslaagde (betaalde) call niet ongedaan maakt. (Herkomst: PR #5.)

## Werkwijze
- **Naam-afhankelijkheden centraliseren.** Hardgecodeerde publieke URL's horen
  in `README.md` (en `atelier/MOBILE.md`), niet verspreid door de code — dat houdt
  een rename klein.
