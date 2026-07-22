# docs/racer — race-game (projectspecifiek)

Projectspecifieke documentatie voor de race-game (root, in-game: *Spencer's Race
Club*). Koepelregels staan in `../../CLAUDE.md`; de codekaart in `../GAME_MAP.md`.

## Kern om te weten
- **Vanilla JS**, three.js r160 als **global `<script>`** (geen ESM, geen build
  in de repo). `dist/*.bundle.js` zijn gecommitte artefacten.
- **Service worker** (`../../sw.js`) precachet **root-absoluut** → bump de
  cache-versie bij asset-wijzigingen.
- **Persistence** via localStorage-keys `spencerRC…` (`../../js/persistence/`).
- **Deploy:** GitHub Pages + Vercel-root. Speel-URL staat in de root-`README.md`.

Leg race-specifieke besluiten vast in `../DECISIONS.md` en patronen in
`../PATTERNS.md` (niet dupliceren hier).
