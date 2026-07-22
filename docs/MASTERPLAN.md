# MASTERPLAN

De richting op hoofdlijnen. Details staan in de andere docs; dit bestand
antwoordt op "waar gaat dit heen en hoe hangt het samen".

## De drie repo's (bevestigd in de audit)

Deze publieke repo staat niet op zichzelf. Het geheel bestaat uit drie repo's:

- **`game-engine`** (privé) — de "tuin": een garden-walk + een aparte racer op
  een herbruikbare engine (three r184, WebGPU/TSL, Vite, TypeScript strict).
  Eigen volledige werkwijze-laag. Losstaand van deze repo.
- **`srclub-workspace`** (privé) — de dev-source van de race-game *Spencer's
  Race Club* (vanilla JS, esbuild). Bouwt en **publiceert** naar deze repo via
  GitHub Actions (`publish.yml` / `publish-preview.yml`).
- **`spencers-race-clubbing`** (deze, publiek) — de **publish-mirror** van de
  race-game (Pages) plus de **native** asset-showroom `atelier/` (Vercel).

## Wat hier hoort en wat niet

- **Native hier:** `atelier/**` en het onderhoud van deze repo (werkwijze-laag,
  README, rename-voorbereiding, preview-hygiëne).
- **Gegenereerd (niet hier bewerken):** de game-bestanden (`index.html`,
  `sw.js`, `assets/ css/ data/ dist/ js/`) en `preview/`. Bron = `srclub-workspace`.

## Waar het heen gaat (open richtingen)

1. **Werkwijze-laag verankeren** *(Fase B, nu)* — CLAUDE.md + docs + handovers +
   `verify`-poort in déze repo, zodat elke sessie op de public repo (met name
   atelier-werk) dezelfde discipline volgt als de privé-repo's.
2. **Rename** — de repo-slug bevat een persoonsnaam en moet uit publieke URL's.
   Raakt ook de publish-workflows in `srclub-workspace`. Zie
   `docs/RENAME_RUNBOOK.md`. Nog niet uitgevoerd.
3. **Ordening op termijn** — de audit schetste drie varianten. Variant A
   (in-place werkwijze-laag) is nu gekozen; B (monorepo) en C (verder splitsen)
   blijven open in `docs/BACKLOG.md`.
4. **Repo-hygiëne** — `preview/` (44 snapshots, ~4,2 GB) opruimen via het
   bestaande `cleanuppublicbranches.yml`-mechanisme in `srclub-workspace`.

## Vaste kaders

- Eén as per sessie; plan-mode op bouwwerk; `npm run verify` als harde poort;
  handover aan het eind. Zie `CLAUDE.md`.
- Geen monorepo-tooling zonder expliciet besluit. Game-bestanden niet hier
  bewerken (ze zijn gegenereerd).
