# CLAUDE.md — werkwijze voor deze repo

Instructies voor elke Claude-sessie die in deze repo werkt. Kort houden, hard
naleven. Deze laag ontbrak tot Fase B (juli 2026); zie
`docs/audits/REPO_INVENTARIS.md` voor de aanleiding en de volledige topografie.

---

## Wat deze repo is (en niet is)

Deze **publieke** repo is twee dingen tegelijk:

| In deze repo | Wat | Herkomst | Deploy |
|---|---|---|---|
| **Race-game** (`index.html`, `sw.js`, `assets/ css/ data/ dist/ js/`) | *Spencer's Race Club* — 3D arcade-racer, negen werelden | **Gegenereerd** — gepubliceerd vanuit de privé-repo `srclub-workspace` via GitHub Actions (`publish.yml`). **Niet hier ontwikkelen.** | GitHub Pages (`properams.github.io/spencers-race-clubbing/`) |
| **atelier/** | Standalone asset-showroom om zelf-gegenereerde 3D-assets te keuren | **Native** — hier ontwikkeld, three r160 ESM, geen build-stap | Vercel (`…/atelier/`) |
| **preview/** | 44 live branch-previews | **Gegenereerd** door `publish-preview.yml` (privé-repo). Niet met de hand beheren. | Pages-subpaden |

### ⚠️ De game-bestanden zijn gegenereerd — bewerk ze hier NIET
`publish.yml` doet `cp index.html sw.js` en `rsync -a --delete` op
`assets/ css/ data/ dist/ js/`. Elke handmatige wijziging daaraan in deze repo
wordt **overschreven** bij de volgende publish. De bron-van-waarheid van de
race-game is de privé-repo **`srclub-workspace`** (die heeft zijn eigen
`CLAUDE.md`, docs en handovers). Werk aan de game dáár, niet hier.

### De bredere context (drie repo's)
- **`game-engine`** (privé) — de "tuin": een garden-walk + racer op een
  herbruikbare engine (three r184, WebGPU/TSL, Vite). Eigen volledige
  werkwijze-laag. Staat volledig los van deze repo.
- **`srclub-workspace`** (privé) — dev-source van de race-game (esbuild). Bouwt
  en publiceert naar déze repo.
- **`spencers-race-clubbing`** (deze, publiek) — publish-mirror + native atelier.

Er is dus **geen** tuin-project in deze repo, en `atelier/` is niet die tuin.

## Waar je hier wél aan werkt

Native, dus governance geldt: **`atelier/**`** en het onderhoud van déze repo
zelf (deze werkwijze-laag, README, rename-voorbereiding, preview-hygiëne).

## De vaste regels (gelden voor al het native werk hier)

1. **Eén as per sessie.** Kies één spoor (bv. "atelier-viewer" of
   "rename-voorbereiding") en blijf daarbij. Geen brede refactors erbij.
2. **Plan-mode op bouwwerk.** Alles wat structuur/architectuur raakt eerst
   plannen en laten goedkeuren; kleine, geïsoleerde fixes mogen direct.
3. **`npm run verify` is de harde poort.** Draai vóór commit én aan het eind van
   de sessie. Rood = niet committen/deployen. (Poort = JS-syntax + JSON-
   geldigheid over de gepubliceerde game-artefacten én atelier; zie
   `scripts/verify.mjs`.)
4. **Altijd een handover aan het eind van de sessie.** Schrijf
   `docs/handovers/JJJJ-MM-DD-<as>.md` (sjabloon: `docs/handovers/TEMPLATE.md`,
   of draai `/handover`). Dit was dé ontbrekende gewoonte — sla het niet over.
5. **Docs-hiërarchie bijhouden.** Beslissing → `docs/DECISIONS.md`; les geleerd
   → `docs/LESSONS.md`; nieuw/afgerond werk → `docs/CHANGELOG.md` +
   `docs/BACKLOG.md`; herbruikbaar codepatroon → `docs/PATTERNS.md`; richting →
   `docs/MASTERPLAN.md`.

## Scope-specifiek

- **Atelier:** raakt uitsluitend `atelier/**`. Eigen `manifest.json` en eigen
  route; nooit game-code importeren. Asset-flow: `assets/raw/` → optimize →
  `assets/clean/` (draait ook in CI: `.github/workflows/atelier-optimize.yml`).
- **Gepubliceerde game (alleen-lezen hier):** wil je iets aan `sw.js`
  (SW_VERSION-bump), werelden (`js/worlds/`) of de bundels (`dist/`) wijzigen —
  doe dat in `srclub-workspace`; het verschijnt hier vanzelf via publish.

## Naam / rename

De repo-slug bevat een persoonsnaam en staat op de nominatie om hernoemd te
worden. Voer **geen** rename uit zonder expliciete go van Jur. Let op: de
publish-workflows in `srclub-workspace` (`publish.yml`, `publish-preview.yml`,
`cleanuppublicbranches.yml`) hardcoden `properams/spencers-race-clubbing` — een
rename breekt de publish-keten tot die zijn bijgewerkt. Status, impact en
runbook: `docs/RENAME_RUNBOOK.md`. De in-game merknaam "Spencer's Race Club"
staat los van de repo-slug en blijft ongemoeid.

## Niet doen zonder overleg

- Geen game-bestanden (`js/ css/ data/ dist/ assets/`, `index.html`, `sw.js`)
  hier met de hand bewerken — dat hoort in `srclub-workspace`.
- Geen monorepo-tooling introduceren (pnpm/turbo/nx).
- `preview/` niet zomaar verwijderen (44 snapshots, ~4,2 GB) — het is een
  gegenereerd deploy-mechanisme; opruimen loopt via `cleanuppublicbranches.yml`
  in `srclub-workspace`. Zie `docs/BACKLOG.md`.
- De repo niet hernoemen of Pages/Vercel-koppelingen wijzigen zonder go.
