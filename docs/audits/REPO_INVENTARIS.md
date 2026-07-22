# Repo-inventaris — Fase A

> **Type:** audit / inventarisatie (twee-fasen-gate, Fase A).
> **Scope:** alleen lezen en rapporteren. Geen reorganisatie, geen rename, geen
> code-oordeel. Dit rapport is de basis voor het orden- en hernoemplan (Fase B).
> **Repo:** `properams/spencers-race-clubbing` · peildatum 2026-07-22.

---

## Belangrijkste bevinding (lees dit eerst)

Twee aannames uit de opdracht kloppen niet met wat er in de tree staat. Ze
sturen de rest van dit rapport, dus ze staan bovenaan:

1. **Er is geen Japanse-tuin-project in deze repo.** De root is volledig de
   race-game *"Spencer's Race Club"* (vanilla JS → GitHub Pages). De enige
   Three.js/Vercel-component is `atelier/`, een **standalone asset-showroom** op
   **three r160 ESM zonder build-stap** — dus *niet* r184 / WebGPU / TSL / Vite
   zoals de tuin wordt omschreven. De tuin-werkwijze waartegen wordt vergeleken,
   leeft in een **aparte originele repo** die hier niet aanwezig is.

2. **De hele werkwijze-laag ontbreekt in deze repo.** Geen `CLAUDE.md`, geen
   `.claude/`, geen `docs/`, geen `docs/handovers/` — nergens. `git log --all`
   bevestigt dat deze bestanden nooit in deze repo hebben bestaan. Dit is de
   directe oorzaak van de ontbrekende handover (sectie 3).

Een derde, niet-gevraagde maar zwaarwegende observatie: **`preview/` is
~4,2 GB — ~98% van het totale repo-gewicht (4,3 GB excl. `.git`)** en bestaat
uit 44 volledige kopieën van de game. Relevant voor elke ordenings- of
verplaatsingsvariant in Fase B.

---

## 1. Repo-topografie (mappenboom, 3 niveaus)

Uitgesloten: `node_modules/`, `dist/`-interne bundels, `.git/`, en de 44
`preview/`-snapshots (individueel niet uitgeklapt — het zijn kopieën van de
game-tree).

```
.
├── index.html                 · race   — game-shell (65 KB, inline HUD/screens)
├── sw.js                      · race   — service worker (root-absolute precache)
├── README.md                  · race   — "Spencer's Race Club"
├── js/                        · race   — game-code
│   ├── core/  cars/  gameplay/  worlds/  track/
│   ├── effects/  ui/  audio/  persistence/
│   ├── config.js  main.js
├── css/                       · race   — base hud worlds select settings screens notifications holo-components
├── data/                      · race   — cars.json prices.json tracks.json tracks.archive.json
├── assets/                    · race   — game-assets + pipeline-docs
│   ├── models/  hdri/  textures/  audio/  vendor/  _inbox/
│   ├── vendor/three-r160.min.js
│   ├── manifest.json  CREDITS.md  README.md  download_assets.sh
├── dist/                      · race   — gecommitte build-bundles (geen build-config in repo)
│   └── *.bundle.js (device breadcrumb perf three-compat quality-tier shared-materials debug)
├── atelier/                   · eigen  — asset-showroom → Vercel (NIET de tuin)
│   ├── index.html  atelier.js  manifest.json  MOBILE.md  README.md  .gitignore
│   ├── assets/{raw,clean}
│   ├── pipeline/  (optimize.mjs cleanup.py package.json package-lock.json)
│   └── vendor/  (three.module.min.js  addons/)
├── preview/                   · race — onduidelijk — 44 snapshots ≈ 4,2 GB (~98% v/d repo)
│   └── claude-*/  (elk: assets css data dist index.html js — volledige game-kopie)
└── .github/                   · gedeeld (infra) — feitelijk atelier-scoped
    └── workflows/atelier-optimize.yml
```

**Toewijzing per top-level map:**

| Map / bestand | tuin / race / gedeeld / onduidelijk |
|---|---|
| `index.html`, `sw.js`, `README.md` | **race** |
| `js/`, `css/`, `data/`, `assets/`, `dist/` | **race** |
| `preview/` | **race — onduidelijk** (wegwerp-deploypreviews; ~98% v/d repo-omvang) |
| `atelier/` | **eigen** — Three.js/Vercel-showroom; niet tuin, niet game-core |
| `.github/` | **gedeeld (infra)** — enige workflow raakt alleen `atelier/**` |
| *tuin-project* | **afwezig** |
| *werkwijze-laag (CLAUDE.md/.claude/docs)* | **afwezig** (zou koepel/gedeeld zijn) |

---

## 2. Build- en toolketen

### `package.json`
Er is **geen root-`package.json`**. De enige `package.json` in de hele tree
(buiten `node_modules/`) is `atelier/pipeline/package.json`:

```json
{ "name": "atelier-pipeline", "private": true, "type": "module",
  "engines": { "node": ">=18" },
  "dependencies": { "@gltf-transform/core", "@gltf-transform/extensions",
                    "@gltf-transform/functions", "meshoptimizer" } }
```

- **Scripts:** geen — de pipeline draait via `node optimize.mjs …` direct.
- **Workspaces:** nee.
- **Deps horen bij één project:** alle vier (gltf-transform + meshoptimizer)
  horen bij de **atelier**-optimize-stap; de game heeft geen npm-deps.

### Build-commando's per project
| Project | Build | Werkt nu? |
|---|---|---|
| Race-game (root) | **Geen build-config/-script in de repo.** `dist/*.bundle.js` zijn gecommitte artefacten; het buildproces (waarschijnlijk esbuild, extern/handmatig) staat niet in de repo. | Draait als statische site; herbouwen van `dist/` is niet reproduceerbaar vanuit de repo |
| Atelier | `atelier/pipeline/optimize.mjs` (gltf-transform-keten, tris-doel leidend); `npm ci` in `atelier/pipeline`. | Ja — lokaal en in CI (`atelier-optimize.yml`) |

### Config-inventaris (gedeeld / per project / afwezig)
| Config | Aanwezig? |
|---|---|
| Vite | **Afwezig** (geen van beide projecten) |
| TypeScript / `tsconfig*.json` | **Afwezig** — de codebase is vanilla JS, geen TS |
| ESLint | **Afwezig** |
| Vitest | **Afwezig** |
| dependency-cruiser | **Afwezig** |
| `vercel.json` / `netlify.toml` / `CNAME` / `.nvmrc` | **Afwezig** — Vercel-config zit in het dashboard |

> **Waar het wringt:** de opdracht verwacht dubbele/conflicterende tooling (twee
> vite-, twee tsconfig-, eslint-varianten). Die *bestaat niet* — de tooling
> ontbreekt volledig. Er is geen `npm run verify`-poort omdat er geen
> root-`package.json` en geen testconfig is. Dit is zelf een kernbevinding: de
> game heeft geen enkele geautomatiseerde kwaliteitspoort in de repo.

### `.github/workflows`
Eén workflow: **`atelier-optimize.yml`**.
- **Trigger:** `push` op `master` met pad-filter `atelier/assets/raw/**`, plus
  `workflow_dispatch` (met `file`/`tris`-inputs).
- **Doet:** raw-GLB's optimaliseren via de pipeline, resultaat committen naar
  `atelier/assets/clean/` + `atelier/manifest.json`, terugpushen naar `master`
  (→ Vercel redeploy).
- **Raakt:** uitsluitend **atelier** (`atelier/**`). De race-game heeft **geen
  enkele** workflow (geen CI, geen Pages-deploy-workflow).

### Dubbele / conflicterende configs (tabel)
| Item | Aard | Oordeel |
|---|---|---|
| Vite / tsconfig / ESLint / Vitest / dep-cruiser | Verwacht "dubbel", maar **nergens aanwezig** | Geen conflict; ontbrekende tooling |
| `package.json` | **Eén** (`atelier/pipeline`), geen root | Geen `name`-veld / geen verify |
| Manifests | **Twee**, bewust gescheiden: `assets/manifest.json` (game) ↔ `atelier/manifest.json` (showroom) | Bedoeld, geen import over en weer |
| three.js vendoring | **Twee** kopieën: `assets/vendor/three-r160.min.js` (game) ↔ `atelier/vendor/three.module.min.js` (r160 ESM) | Twee module-formaten van dezelfde versie |
| `dist/` | Gecommitte bundels **zonder** in-repo build | Herbouw niet reproduceerbaar |
| `preview/` | **44× duplicatie** van de volledige game-tree (~4,2 GB) | Grootste bron van dubbeling/gewicht |

---

## 3. Werkwijze-laag — waarom er geen handover komt

**Inventarisatie:** `CLAUDE.md`, `.claude/` (agents/commands/hooks/settings) en
`docs/` (MASTERPLAN, DECISIONS, LESSONS, CHANGELOG, BACKLOG, PATTERNS,
handovers) zijn **in deze repo niet aanwezig** — niet op de root, niet onder
`atelier/`, niet in de `preview/`-snapshots, en volgens `git log --all` ook nooit
geweest. Er valt dus per bestand niets als "tuin-specifiek" of "generiek
herbruikbaar" te labelen: de laag ontbreekt in zijn geheel.

**Vastgestelde oorzaak.** Van de drie vermoedens in de opdracht — *tuin-specifiek
geformuleerd* / *op de verkeerde plek* / *ontbreekt op de plek waar de race-game
leeft* — is het antwoord eenduidig het derde, in sterke vorm: **de werkwijze-laag
ontbreekt volledig in deze repo.** Wanneer een sessie op de race-game opent,
vindt hij niets dat een handover, `npm run verify`, plan-mode-op-bouwwerk of de
docs-hiërarchie afdwingt — die instructies leven uitsluitend in de aparte
originele tuin-repo en zijn nooit mee overgekomen bij het samenbrengen van de
projecten. Aanvullend ontbreekt de technische poort zelf: geen
root-`package.json` betekent geen `verify`-script om als harde gate te draaien.

**Koepelbreed vs. per project.** Omdat de laag ontbreekt, is dit een *soll*-lijst
(wat zou moeten gelden), niet een *ist*-inventaris:

| Afspraak | Reikwijdte |
|---|---|
| Handover per sessie schrijven | **Koepelbreed** — geldt voor race én atelier |
| Eén-as-per-sessie, plan-mode op bouwwerk | **Koepelbreed** |
| Docs-hiërarchie (MASTERPLAN/DECISIONS/LESSONS/CHANGELOG/BACKLOG/PATTERNS) | **Koepelbreed** (met per-project subsecties) |
| `npm run verify` als harde poort | **Per project** — vereist per project een eigen `package.json`/testset (nu voor géén van beide aanwezig) |
| Asset-pipeline-regels (tris-budget, manifest-status, raw→clean) | **Per project** — alleen **atelier** |
| Race-specifieke regels (world-loader, SW-cache-bump, `dist`-bundels) | **Per project** — alleen **race** |

---

## 4. Naam-afhankelijkheden

Hardgecodeerde verwijzingen naar de **repo-slug** `spencers-race-clubbing`
(tree-breed gezocht, `preview/`-snapshots buiten beschouwing):

| Bestand | Regel | Verwijzing | Breekt bij rename? |
|---|---|---|---|
| `README.md` | 5 | `https://properams.github.io/spencers-race-clubbing/` (Pages-URL) | **Ja** — Pages-project-URL leidt af van de repo-naam; zowel de link als de live-URL wijzigen |
| `atelier/MOBILE.md` | 50 | `https://spencers-race-clubbing.vercel.app/atelier/` (Vercel-URL) | **Deels** — de Vercel-URL leidt af van de Vercel-*projectnaam* (aparte config), niet automatisch van de repo-naam; de doc-referentie veroudert alleen als het Vercel-project óók hernoemd wordt |
| *root `package.json`* | — | **geen `name`-veld aanwezig** | **n.v.t.** |

**Persoonsnaam vs. repo-naam (aparte kwestie).** De persoonsnaam "Spencer" zit
op twee heel verschillende plekken, met heel verschillende gevolgen:

- **In de repo-slug → publieke URL's** (`README.md:5`, `MOBILE.md:50`
  hierboven): dit is de reden voor de rename in de opdracht. Breekt/hernoemt.
- **Als game-branding en opslag-sleutels** (breed, o.a. `index.html` titel/logo/
  HUD, `css/base.css:140`, `js/track/environment.js`, `js/track/track.js`,
  `js/worlds/guangzhou.js`, `js/ui/profile.js` default-handle `Spencer`, en de
  localStorage-keys `spencerRC` / `spencerRC_identity` in
  `js/persistence/{save,snapshot,career,progression}.js`, plus save-bestandsnaam
  `spencer-race-save-…`): dit is **geen** repo-naam-afhankelijkheid en **breekt
  niet** bij een repo-rename. Aanpassen hiervan is een *game-rebrand* met eigen
  risico (localStorage-sleutelmigratie → verlies van saves) en valt buiten deze
  audit.

**Account-brede repo-enumeratie (opdracht-item 4).** `gh` CLI is in deze omgeving
niet beschikbaar, en account-brede repo-listing valt buiten de sessie-scope
(alleen `properams/spencers-race-clubbing` is in scope). Conform de "niet
forceren"-clausule: gemeld en overgeslagen.

**Telling:** **2** harde verwijzingen naar de repo-slug (1 breekt zeker, 1 deels).
De 44 `preview/`-snapshots bevatten elk kopieën van dezelfde `README`/URL-strings,
maar het zijn wegwerp-artefacten (zie sectie 5) en niet meegeteld.

---

## 5. Deploy-paden en wat een rename raakt

**Race-game → GitHub Pages.** `README.md` linkt naar
`properams.github.io/spencers-race-clubbing/`. Er is **geen Pages-workflow** in
de repo, dus Pages draait óf in "deploy from branch"-modus (master/root) óf via
een aparte publieke mirror-repo (zoals de opdracht suggereert). Dit is niet
volledig te bevestigen vanuit de tree alleen. Signaal om in Fase B te checken:
`sw.js` gebruikt **root-absolute paden** (`/`, `/index.html`, `/dist/…`,
`/assets/…`) die alléén op een domein-root kloppen — op een Pages-*project*-
subpad `/spencers-race-clubbing/` zouden die precache-URL's 404'en. Dat wijst
op serveren vanaf een root (custom domein, user/org-Pages, of Vercel-root)
in plaats van een project-subpad.

**Atelier → Vercel.** `MOBILE.md` noemt `spencers-race-clubbing.vercel.app/atelier/`.
Geen `vercel.json` → build/root-config in het Vercel-dashboard. De flow:
`atelier-optimize.yml` optimaliseert een raw-GLB en commit `clean/` + `manifest`
terug naar `master`; die push triggert Vercel om te herdeployen. Volledig
statisch (`/atelier/` is een map op de repo-root, geen build-stap).

**Wat een repo-rename raakt:**
- **Pages-URL** `…/spencers-race-clubbing/` verandert mee → oude link,
  bookmarks en eventuele QR/externe verwijzingen sterven; `README.md:5` moet bij.
- **Vercel:** de Git-koppeling volgt de rename doorgaans automatisch via de
  GitHub-app, maar het `*.vercel.app`-domein en de hardgecodeerde URL in
  `MOBILE.md:50` wijzigen alleen als het Vercel-*project* zelf hernoemd wordt.
- **Actions-workflow** blijft werken (relatieve refs), maar Pages/Vercel-hooks
  kunnen herbevestiging vragen.
- **localStorage / saves** (`spencerRC…`) blijven ongemoeid — geen
  repo-naam-afhankelijkheid.

---

## 6. Drie ordeningsvarianten

Ter voorbereiding op Fase B. **Geen aanbeveling** — de keuze is aan Jur.

**Variant A — Werkwijze-laag in-place toevoegen.**
Voeg `CLAUDE.md` + `.claude/` + `docs/` toe op de repo-root; hernoem de repo
naar een neutrale naam; game blijft op root, atelier waar het staat.
*Kost:* laag — geen code-verplaatsing, alleen toevoegen + rename.
*Lost op:* ontbrekende handover/regels én persoonsnaam-in-URL.
*Blijft staan:* race en atelier vermengd in één boom; `preview/`-bloat (4,2 GB).

**Variant B — Monorepo met mappen per project.**
`apps/game/`, `apps/atelier/`, gedeelde werkwijze-laag op koepelniveau (zonder
pnpm/turbo/nx — alleen mapstructuur).
*Kost:* hoog — alle paden, `sw.js`, Pages-root en Vercel-root opnieuw bedraden.
*Lost op:* heldere scheiding, koepelbrede regels, deploy per app.
*Risico:* SW root-absolute paden en de Pages-subpad-kwestie breken; veel migratiewerk.

**Variant C — Splitsen in twee repo's.**
Deze repo wordt puur de (hernoemde) race-game met eigen `CLAUDE.md`; atelier
verhuist naar een eigen repo + eigen Vercel-project.
*Kost:* middel — repo-splitsing, history-keuze, Vercel herkoppelen.
*Lost op:* geen vermenging meer; elke repo eigen deploy én eigen regels.
*Blijft staan:* twee repo's onderhouden; `preview/`-bloat apart opruimen.

---

## Addendum (2026-07-22) — repo-topologie bevestigd

Na Fase A gaf Jur toestemming om de overige account-repo's in te zien. Dat
beantwoordt de open vragen uit dit rapport en corrigeert de uitgangs-aanname.

**De account-repo's** (via `list_repos`):

| Repo | Zichtbaarheid | Laatste push | Rol |
|---|---|---|---|
| `spencers-race-clubbing` | public | 2026-07-22 | **publish-mirror** race-game + native `atelier/` |
| `srclub-workspace` | private | 2026-07-22 | **dev-source** race-game (pkg `spencers-race-club`, esbuild) |
| `game-engine` | private | 2026-07-22 | **de "tuin"** — garden-walk + racer (three r184, WebGPU/TSL, Vite, TS) |
| `Playground` | private | 2026-07-21 | niet geïnspecteerd (lijkt scratch) |

**Bevestigde bevindingen die dit rapport bijstelt:**

1. **Geen "merge" — het zijn drie repo's.** De tuin (`game-engine`) en de
   race-game-dev (`srclub-workspace`) zijn aparte privé-repo's, elk met een
   volledige werkwijze-laag. Deze publieke repo is de publish-mirror waar later
   `atelier/` native aan toegevoegd is.
2. **De game-bestanden hier zijn gegenereerd.** `srclub-workspace/.github/
   workflows/publish.yml` bouwt (esbuild) en doet `cp index.html sw.js` +
   `rsync -a --delete` op `assets/ css/ data/ dist/ js/` naar deze repo. Dit
   verklaart de gecommitte `dist/`-bundels zonder in-repo build (sectie 2).
3. **`preview/` is een deploy-mechanisme, geen toevallige bloat.**
   `publish-preview.yml` deployt elke `claude/**`-branch naar
   `…/spencers-race-clubbing/preview/<safe-branch>/`. Vandaar de 44 snapshots.
4. **Waarom hier geen handover (sectie 3), nu scherper:** de werkwijze-laag
   leeft in de privé-bronrepo's; sessies die op déze publieke mirror openen
   (voor atelier of om de gepubliceerde game te bekijken) erven niets.
5. **Extra rename-afhankelijkheid buiten deze repo:** `publish.yml`,
   `publish-preview.yml` en `cleanuppublicbranches.yml` in `srclub-workspace`
   hardcoden `properams/spencers-race-clubbing`. Een rename breekt de
   publish-keten tot die refs zijn bijgewerkt (zie `docs/RENAME_RUNBOOK.md`).

**Gevolg voor Fase B:** de werkwijze-laag in deze repo is gescoped op het native
werk (atelier + repo-onderhoud) en documenteert expliciet dat de game-bestanden
gegenereerd zijn. Governance voor de game/tuin zelf blijft in de privé-repo's.

---

*Einde Fase A + addendum.*
