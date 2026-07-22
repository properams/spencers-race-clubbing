# MASTERPLAN

Koepeloverzicht van deze repo. Voor de werkwijze: zie `../CLAUDE.md`.

## De twee projecten

1. **Race-game** (root, in-game: *Spencer's Race Club*) — 3D arcade-racer met
   negen themawerelden. Vanilla JS, three.js r160 (global script), geen build in
   de repo. Deploy: GitHub Pages + Vercel-root. Codekaart: `GAME_MAP.md`.
2. **Atelier** (`atelier/`) — standalone asset-showroom + asset-pipeline
   (concept → image→3D → optimize → showroom). three.js r160 ESM. Deploy: Vercel
   `/atelier/`. Instap: `../atelier/README.md`.

De projecten delen **geen** code (zie `audits/REPO_INVENTARIS.md`, §6). Ze worden
bewust naast elkaar in één repo gehouden, niet als monorepo met gedeelde packages.

## Richting

- **Grondvorm:** in-place — game op de root, atelier in `atelier/`. Geen
  `apps/`-herstructurering, geen `packages/engine`, geen monorepo-tooling
  (`DECISIONS.md`).
- **Rename:** repo → `race-club` (persoonsnaam uit publieke URL's).
- **Hygiëne:** `preview/` is uit git-tracking gehaald; een echte kwaliteitspoort
  (`npm run verify`) en een reproduceerbare `dist/`-build staan op de `BACKLOG.md`.

## Open richtingvraag

De atelier-pipeline is engine-agnostisch (GLB-output). Als de game ooit naar een
andere engine gaat, blijft atelier bruikbaar. Tot die tijd: geen koppeling forceren.
