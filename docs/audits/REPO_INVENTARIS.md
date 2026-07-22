# Repo-inventaris — Fase A

> **Type:** audit / inventarisatie (twee-fasen-gate, Fase A).
> **Scope:** alleen lezen en rapporteren. Geen reorganisatie, rename, verhuizing,
> refactor of code-oordeel. Dit rapport is de basis voor het orden-, hernoem- en
> documentatieplan (Fase B).
> **Repo:** `properams/spencers-race-clubbing` (public, default branch `master`,
> aangemaakt 2026-05-20, laatste push 2026-07-22) · peildatum **2026-07-22**.

---

## Belangrijkste bevinding (lees dit eerst)

Drie aannames uit de opdracht kloppen niet met wat er in de tree staat. Ze sturen
de rest van dit rapport, dus ze staan bovenaan.

1. **Er is geen Japanse-tuin-project in deze repo.** De root ís de race-game
   *"Spencer's Race Club"* — vanilla JS, three.js **r160 als classic global
   script** (`index.html:928`, geen ES-modules, geen build in de repo) → GitHub
   Pages. De enige three.js/Vercel-component is `atelier/`, een **standalone
   asset-showroom** op three r160 **ESM** (`atelier/atelier.js:3`) — dus *niet*
   r184 / WebGPU / TSL / Vite / TypeScript zoals de "tuin" wordt omschreven. Het
   tuin-project is in deze repo afwezig.

2. **De werkwijze-laag leeft in een aparte, bevroren repo — niet hier.** Geen
   `CLAUDE.md`, geen `.claude/`, geen `docs/`-hiërarchie (MASTERPLAN/DECISIONS/…),
   geen `docs/handovers/` in deze repo. De handover-discipline en het
   `SESSION_HANDOVER_TEMPLATE.md` blijken te leven in het **separate repo
   `srclub-workspace`**, dat volgens de open PR #5 "sinds gisteren bevroren [is]
   wegens de overstap naar game-engine". Dit is de directe oorzaak van de
   ontbrekende handover (sectie 3) — met bewijs uit de PR-body zelf.

3. **`preview/` domineert de tree in bestandsaantal, niet in kloon-gewicht.**
   `preview/` bevat **44 volledige snapshots** van de game en telt **17.374 van de
   17.798 git-getrackte bestanden = 97,6 %**. In de *werkboom* is dat **~4,2 GB**;
   *gepackt in git* is de hele repo echter maar **~82 MB** (GitHub `size`: 80.620
   KB) omdat de snapshots vrijwel identiek zijn en git ze content-adresseerbaar
   dedupliceert. De pijn zit dus in **checkout-omvang en bestandsaantal** (elke
   `git status`, diff, review en lokale checkout), niet in kloon-bandbreedte.
   Dit is een correctie op de eerdere audit, die 4,2 GB als "repo-gewicht" las.

---

## 1. Repo-topografie (mappenboom, 3 niveaus)

Uitgesloten: `node_modules/`, `.git/`, en de 44 `preview/`-snapshots (individueel
niet uitgeklapt — het zijn kopieën van de game-tree).

```
.
├── index.html                 · race   — game-shell (65 KB, inline HUD/screens; three via <script>)
├── sw.js                      · race   — service worker (root-absolute precache-paden)
├── README.md                  · race   — "Spencer's Race Club" (13 regels)
├── js/                        · race   — game-code (117 bestanden)
│   ├── core/ (21)  cars/ (6)  gameplay/ (16)  worlds/ (14)  track/ (4)
│   ├── effects/ (26)  ui/ (13)  audio/ (8)  persistence/ (6)
│   └── config.js  main.js  core/three-compat.js
├── css/                       · race   — base hud worlds select settings screens notifications holo
├── data/                      · race   — cars.json prices.json tracks.json tracks.archive.json
├── assets/                    · race   — game-assets + pipeline-docs (250 bestanden, ~93 MB)
│   ├── models/  hdri/  textures/  audio/  vendor/  _inbox/
│   ├── vendor/three-r160.min.js          (classic global build)
│   └── manifest.json  CREDITS.md  README.md  download_assets.sh
├── dist/                      · race   — gecommitte build-bundels (16), géén build-config in repo
│   └── *.bundle.js (device breadcrumb perf three-compat quality-tier shared-materials debug)
├── atelier/                   · eigen  — asset-showroom → Vercel (NIET de tuin, 24 bestanden)
│   ├── index.html  atelier.js  manifest.json  MOBILE.md  README.md  .gitignore
│   ├── assets/{raw,clean}     (met placeholder-READMEs)
│   ├── pipeline/              (optimize.mjs cleanup.py package.json package-lock.json)
│   └── vendor/                (three.module.min.js  addons/  → r160 ESM)
├── preview/                   · race — onduidelijk — 44 snapshots ≈ 4,2 GB werkboom / 97,6 % v/d bestanden
│   └── claude-*/  (elk: assets css data dist index.html js — volledige game-kopie)
├── docs/                      · gedeeld — bevat alleen dit audit-rapport
│   └── audits/REPO_INVENTARIS.md
└── .github/                   · gedeeld (infra) — feitelijk atelier-scoped
    └── workflows/atelier-optimize.yml
```

**Toewijzing per top-level map:**

| Map / bestand | tuin / race / gedeeld / onduidelijk |
|---|---|
| `index.html`, `sw.js`, `README.md` | **race** |
| `js/`, `css/`, `data/`, `assets/`, `dist/` | **race** |
| `preview/` | **race — onduidelijk** (wegwerp-deploypreviews; 97,6 % v/d bestanden) |
| `atelier/` | **eigen** — Three.js/Vercel-showroom; niet tuin, niet game-core |
| `docs/` | **gedeeld (koepel)** — bevat nu alleen dit rapport; geen docs-hiërarchie |
| `.github/` | **gedeeld (infra)** — enige workflow raakt alleen `atelier/**` |
| *tuin-project* | **afwezig** |
| *werkwijze-laag (CLAUDE.md/.claude/docs-hiërarchie)* | **afwezig** (leeft in `srclub-workspace`) |

---

## 2. Build- en toolketen

### `package.json`
Er is **geen root-`package.json`**. De enige `package.json` in de hele tree
(buiten `node_modules/` en `preview/`) is `atelier/pipeline/package.json`:

```json
{ "name": "atelier-pipeline", "private": true, "type": "module",
  "engines": { "node": ">=18" },
  "dependencies": { "@gltf-transform/core", "@gltf-transform/extensions",
                    "@gltf-transform/functions", "meshoptimizer" } }
```

- **`name`-veld:** `atelier-pipeline` (alleen deze; geen repo-brede naam).
- **Scripts:** geen — de pipeline draait via `node optimize.mjs …` direct.
- **Workspaces:** nee.
- **Deps die maar bij één project horen:** alle vier (gltf-transform + meshoptimizer)
  horen bij de **atelier**-optimize-stap; de race-game heeft **geen** npm-deps.

### Build- en dev-commando's per project — werken ze nu?
| Project | Build / dev | Werkt nu? |
|---|---|---|
| Race-game (root) | **Geen build-/dev-config of -script in de repo.** `dist/*.bundle.js` zijn gecommitte artefacten; het buildproces (vermoedelijk esbuild, extern/handmatig) staat niet in de repo. Dev = statische site openen. | Draait als statische site; **herbouw van `dist/` is niet reproduceerbaar** vanuit de repo |
| Atelier | `npm ci` in `atelier/pipeline/`, dan `node optimize.mjs …` (gltf-transform-keten, tris-doel leidend). | **Ja** — lokaal en in CI (`atelier-optimize.yml`) |

### Config-inventaris (gedeeld / per project / afwezig)
| Config | Aanwezig? |
|---|---|
| Vite | **Afwezig** (beide projecten) |
| TypeScript / `tsconfig*.json` / `*.d.ts` | **Afwezig** — de codebase is vanilla JS, geen TS |
| ESLint | **Afwezig** |
| Vitest (of enige testrunner) | **Afwezig** |
| dependency-cruiser | **Afwezig** |
| `vercel.json` / `netlify.toml` / `CNAME` / `.nvmrc` | **Afwezig** — Vercel-config staat in het dashboard |

> **Waar het wringt:** de opdracht verwacht dubbele/conflicterende tooling (twee
> vite-, twee tsconfig-, eslint-varianten). Die *bestaat niet* — de tooling
> ontbreekt volledig. Er is **geen `npm run verify`-poort**, want er is geen
> root-`package.json` en geen testconfig. Dit is zelf een kernbevinding: de game
> heeft **geen enkele geautomatiseerde kwaliteitspoort** in de repo.

### `.github/workflows`
Eén workflow: **`atelier-optimize.yml`**.
- **Trigger:** `push` op `master` met pad-filter `atelier/assets/raw/**`, plus
  `workflow_dispatch` (met `file`/`tris`-inputs).
- **Doet:** raw-GLB's optimaliseren, resultaat committen naar
  `atelier/assets/clean/` + `atelier/manifest.json`, terugpushen naar `master`
  (→ Vercel redeploy).
- **Raakt:** uitsluitend **atelier** (`atelier/**`). De race-game heeft **geen
  enkele** workflow — geen CI, geen lint/test, geen Pages-deploy-workflow.

### Dubbele / conflicterende configs (tabel — DoD §2)
| Item | Aard | Oordeel |
|---|---|---|
| Vite / tsconfig / ESLint / Vitest / dep-cruiser | Verwacht "dubbel", maar **nergens aanwezig** | Geen conflict; ontbrekende tooling |
| `package.json` | **Eén** (`atelier/pipeline`), geen root | Geen repo-`name`, geen `verify` |
| Manifests | **Twee**, bewust gescheiden: `assets/manifest.json` (game) ↔ `atelier/manifest.json` (showroom) | Bedoeld, geen import over en weer |
| three.js-vendoring | **Twee** kopieën, twee module-formaten: `assets/vendor/three-r160.min.js` (classic global) ↔ `atelier/vendor/three.module.min.js` (r160 ESM) | Zelfde versie, twee laadmodellen — niet uitwisselbaar |
| `dist/` | Gecommitte bundels **zonder** in-repo build | Herbouw niet reproduceerbaar |
| `preview/` | **44× snapshot** van de volledige game-tree (17.374 bestanden) | Grootste bron van bestand-dubbeling (zie §9) |

---

## 3. Werkwijze-laag — waarom er geen handover komt

**Inventarisatie.** `CLAUDE.md`, `.claude/` (agents/commands/hooks/settings) en de
`docs/`-hiërarchie (MASTERPLAN, DECISIONS, LESSONS, CHANGELOG, BACKLOG, PATTERNS,
GAME_MAP, `handovers/`) zijn **in deze repo niet aanwezig** — niet op de root, niet
onder `atelier/`, niet in de `preview/`-snapshots. Er valt dus per bestand niets
als "tuin-specifiek" of "generiek herbruikbaar" te labelen: de laag ontbreekt hier
in zijn geheel. `docs/` bevat op peildatum enkel dít audit-rapport.

**Vastgestelde oorzaak — met bewijs.** Van de drie vermoedens in de opdracht
(*tuin-specifiek geformuleerd* / *op de verkeerde plek* / *ontbreekt op de plek
waar de race-game leeft*) is het antwoord het **derde, in sterke vorm**: de
werkwijze-laag ontbreekt in deze repo omdat hij in een **apart repo leeft**. Het
bewijs staat in de open PR #5 van déze repo:

- De handover-tekst van PR #5 vermeldt: *"Gepersisteerde kopie: `srclub-workspace`
  PR #102 (`docs/handovers/2026-07-22_pr5_atelier-fal-image-to-3d.md`)"* — de
  handover-map en -historie leven dus in `srclub-workspace`, niet hier.
- Open vraag #2 in diezelfde PR: *"Moet voortaan élke sessie in
  spencers-race-clubbing (niet alleen grote features) een handover krijgen, zoals
  het 'ongeacht omvang'-principe in `SESSION_HANDOVER_TEMPLATE.md` voorschrijft?"*
  — het template en het principe wonen in `srclub-workspace`.
- PR #5 meldt bovendien dat `srclub-workspace` *"sinds gisteren bevroren [is]
  wegens de overstap naar game-engine"*.

> *(Bevestiging blijft binnen deze sessie-scope: `srclub-workspace` is niet in
> scope en is niet geopend; bovenstaande citaten komen uit de PR-body in déze
> repo.)*

Wanneer een sessie op de race-game opent, vindt hij dus **niets** in de repo dat
een handover, `npm run verify`, plan-mode-op-bouwwerk of de docs-hiërarchie
afdwingt — die instructies leven uitsluitend in het (nu bevroren) `srclub-workspace`
en zijn nooit mee overgekomen bij het samenbrengen van de projecten. Aanvullend
ontbreekt de technische poort zelf: geen root-`package.json` ⇒ geen `verify`-script
om als harde gate te draaien.

**Koepelbreed vs. per project.** Omdat de laag hier ontbreekt, is dit een
*soll*-lijst (wat zou moeten gelden), niet een *ist*-inventaris:

| Afspraak | Reikwijdte |
|---|---|
| Handover per sessie schrijven (ongeacht omvang) | **Koepelbreed** — geldt voor race én atelier |
| Eén-as-per-sessie, plan-mode op bouwwerk | **Koepelbreed** |
| Docs-hiërarchie (MASTERPLAN/DECISIONS/LESSONS/CHANGELOG/BACKLOG/PATTERNS/GAME_MAP) | **Koepelbreed** (met per-project subsecties) |
| `npm run verify` als harde poort | **Per project** — vereist per project een eigen `package.json`/testset (nu voor géén van beide aanwezig) |
| Asset-pipeline-regels (tris-budget, manifest-status, raw→clean) | **Per project** — alleen **atelier** |
| Race-specifieke regels (world-loader, SW-cache-bump, `dist`-bundels) | **Per project** — alleen **race** |

---

## 4. Naam-afhankelijkheden

Hardgecodeerde verwijzingen naar de **repo-slug** `spencers-race-clubbing`
(tree-breed gezocht; `preview/`-snapshots en dit rapport zelf niet meegeteld):

| Bestand | Regel | Verwijzing | Breekt bij rename? |
|---|---|---|---|
| `README.md` | 5 | `https://properams.github.io/spencers-race-clubbing/` (Pages-URL) | **Ja** — de Pages-*project*-URL leidt af van de repo-naam; zowel de link als de live-URL wijzigen mee |
| `atelier/MOBILE.md` | 50 | `https://spencers-race-clubbing.vercel.app/atelier/` (Vercel-URL) | **Deels** — de Vercel-URL leidt af van de Vercel-*projectnaam* (aparte config, toevallig gelijk aan de slug); de doc-referentie veroudert alleen als het Vercel-project óók hernoemd wordt |
| *root `package.json`* | — | **geen `name`-veld / geen root-manifest** | **n.v.t.** |

**Persoonsnaam vs. repo-naam (aparte kwestie).** De persoonsnaam "Spencer" zit op
twee heel verschillende plekken, met heel verschillende gevolgen:

- **In de repo-slug → publieke URL's** (`README.md:5`, `MOBILE.md:50` hierboven):
  dít is de reden voor de rename in de opdracht. Breekt/hernoemt.
- **Als game-branding en opslag-sleutels** (breed, o.a. `index.html`-titel/logo/HUD,
  `css/base.css`, `js/track/*`, `js/worlds/*`, `js/ui/profile.js` default-handle
  `Spencer`, en de localStorage-keys `spencerRC` / `spencerRC_identity` in
  `js/persistence/{save,snapshot,career,progression}.js`, plus save-bestandsnamen
  `spencer-race-save-…`): dit is **geen** repo-naam-afhankelijkheid en **breekt niet**
  bij een repo-rename. Aanpassen hiervan is een *game-rebrand* met eigen risico
  (localStorage-sleutelmigratie → verlies van saves) en valt buiten deze audit.

**Account-brede repo-enumeratie (opdracht-item 4).** `gh` CLI is niet beschikbaar;
account-brede listing valt buiten de sessie-scope (alleen
`properams/spencers-race-clubbing` is in scope). Wat wél read-only op te halen was
via de GitHub-API voor de **in-scope** repo:

| Kenmerk | Waarde |
|---|---|
| Zichtbaarheid | **public** |
| Default branch | `master` |
| Laatste push | 2026-07-22 |
| GitHub Pages actief | **Ja** (`has_pages: true`) |
| Homepage (Vercel) | `https://spencers-race-clubbing.vercel.app` |
| Tags / releases | **0 / 0** |
| Open issues / open PR's | 1 issue · PR #5 (draft, atelier) |

**Telling:** **2** harde verwijzingen naar de repo-slug (1 breekt zeker, 1 deels).
De 44 `preview/`-snapshots bevatten elk kopieën van dezelfde `README`/URL-strings,
maar het zijn wegwerp-artefacten (§5) en niet meegeteld.

---

## 5. Deploy-paden en wat een rename raakt

**Race-game → GitHub Pages (+ Vercel-root).** `README.md:5` linkt naar
`properams.github.io/spencers-race-clubbing/` en `has_pages: true` bevestigt dat
Pages aan staat. Tegelijk staat de repo-homepage op `spencers-race-clubbing.vercel.app`
(Vercel serveert dezelfde tree op de root, met `/atelier/` als submap). Er is
**geen Pages-deploy-workflow** in de repo, dus Pages draait in "deploy from
branch"-modus of via een externe mirror.

> **Signaal voor Fase B:** `sw.js` gebruikt **root-absolute paden** (`/`,
> `/index.html`, `/dist/…`, `/assets/…`). Die kloppen op een **domein-root**
> (Vercel-root of user/org-Pages of custom domein), maar zouden op een Pages-
> *project*-subpad `/spencers-race-clubbing/` **404'en** bij precache. Dat wijst
> erop dat de werkende speel-URL de **Vercel-root** is; de Pages-project-URL is óf
> secundair óf gevoelig voor precies dit subpad-probleem. Verifiëren in Fase B.

**Atelier → Vercel.** `MOBILE.md:50` noemt `spencers-race-clubbing.vercel.app/atelier/`.
Geen `vercel.json` → build/root-config in het Vercel-dashboard. Flow:
`atelier-optimize.yml` optimaliseert een raw-GLB en commit `clean/` + `manifest`
terug naar `master`; die push triggert Vercel om te herdeployen. Volledig statisch
(`/atelier/` is een map op de repo-root, geen build-stap).

**Wat een repo-rename raakt:**
- **Pages-URL** `…/spencers-race-clubbing/` verandert mee → oude link, bookmarks en
  externe verwijzingen sterven; `README.md:5` moet bij.
- **Vercel:** de Git-koppeling volgt de rename doorgaans automatisch via de
  GitHub-app, maar het `*.vercel.app`-domein en de hardgecodeerde URL in
  `MOBILE.md:50` wijzigen alleen als het Vercel-*project* zelf hernoemd wordt.
- **Actions-workflow** blijft werken (relatieve refs), maar Pages/Vercel-hooks
  kunnen herbevestiging vragen.
- **localStorage / saves** (`spencerRC…`) blijven ongemoeid — geen
  repo-naam-afhankelijkheid.

---

## 6. Gedeelde code (scharniervraag voor Fase B)

**Toets: gebruiken race-code en atelier-code dezelfde modules?** Nee.

| Bewijs | Bevinding |
|---|---|
| `atelier/atelier.js:2` | expliciete comment: *"eigen three-vendor (r160 ESM via import map), eigen manifest, **geen game-imports**"* |
| `atelier/atelier.js:3-8` | atelier importeert `three` + addons als **ES-modules** via eigen import-map (`atelier/vendor/`) |
| `index.html:928` | game laadt three.js als **classic global `<script>`** (`assets/vendor/three-r160.min.js`) — geen ES-modules |
| `grep atelier js/` | de game-code refereert **nergens** aan `atelier/` |
| `grep import atelier/*.js` op game-paden | atelier importeert **nergens** uit `js/`, `dist/` of `assets/` (buiten eigen `clean/`) |

Het zijn **twee losse bomen die alleen een repo-map delen**, met elk hun eigen
three.js-vendoring in een **onverenigbaar module-formaat** (global build ↔ ESM).

**Lijst van concreet gedeelde modules (Three.js-wrappers, TSL-materialen, loop,
input, diagnostics):** **geen.** Aantal importeurs per project: 0 ↔ 0.

**Oordeel — tweede bewezen gebruiker voor een `packages/engine`-extractie:**
> **NEE.** Er is in deze repo geen enkele module die door beide projecten wordt
> gebruikt. Een gedeelde `packages/engine` heeft **geen bewezen tweede afnemer**;
> extractie zou een consument-van-één zijn. (De "tuin" die de veronderstelde
> tweede afnemer zou zijn, is hier niet aanwezig — §Belangrijkste bevinding.)

**dep-cruiser-regels bij een `apps/ + packages/`-indeling:** er zíjn **geen**
bestaande dependency-cruiser-regels (§2). Er is dus niets dat "blijft werken" of
"herschreven moet worden"; als dep-cruiser in Fase B wordt ingevoerd, worden de
regels **vers geschreven** voor de dan gekozen `apps/`-indeling.

---

## 7. Documentatie-stand

**Alle markdown-docs** (excl. `preview/`; laatste-wijziging via `git log`):

| Pad | Regels | Laatste wijziging | Scope | Status |
|---|---:|---|---|---|
| `README.md` | 13 | 2026-05-31 | race (instap) | actueel, maar minimaal |
| `assets/CREDITS.md` | 139 | 2026-05-31 | race (assets) | actueel |
| `assets/README.md` | 264 | 2026-05-31 | race (asset-pipeline) | actueel; deels overlap met `atelier/README.md` |
| `assets/_inbox/README.md` | 15 | 2026-05-31 | race (assets) | placeholder |
| `assets/audio/README.md` | 190 | 2026-05-31 | race (audio) | actueel |
| `assets/audio/music/README.md` | 166 | 2026-05-31 | race (audio) | actueel |
| `atelier/README.md` | 134 | 2026-07-22 | atelier (instap) | actueel |
| `atelier/MOBILE.md` | 88 | 2026-07-22 | atelier | actueel |
| `atelier/assets/clean/README.md` | 5 | 2026-07-21 | atelier | placeholder |
| `atelier/assets/raw/README.md` | 5 | 2026-07-21 | atelier | placeholder |
| `docs/audits/REPO_INVENTARIS.md` | *(dit)* | 2026-07-22 | koepel (audit) | actueel |

**Actueel / verouderd / dubbel:** geen doc is aantoonbaar verouderd. Enige
gedeeltelijke **overlap**: `assets/README.md` (game-asset-pipeline) en
`atelier/README.md` (atelier-asset-pipeline) beschrijven allebei een
optimize-/manifest-keten — verwante maar bewust gescheiden trajecten, geen echte
duplicatie.

**README's die bestaan:** root `README.md` (race-instap: één alinea + speel-link
+ asset-attributie), `atelier/README.md` (atelier-instap: volledige
concept→3D→optimize→showroom-keten), plus asset-sub-READMEs. **Instap-gaten:**

- **Geen koepel-README** die uitlegt dat deze repo *twee losse projecten* bevat
  (race + atelier), waar wat staat, en hoe je elk draait. Dit is de directe
  oorzaak van "veel tijd kwijt aan uitzoeken wat waar staat".
- **Geen `CLAUDE.md`** (zie §8) — een agent krijgt geen instap/werkwijze.
- De root-`README.md` is game-gericht en noemt `atelier/` niet; een nieuwkomer
  ziet de tweede-project-structuur nergens.

**Voorstel README's (pad + één zin doel per stuk) — alleen benoemd, niet geschreven:**

| Pad | Doel (één zin) |
|---|---|
| `README.md` (koepel, herzien) | Legt uit dat de repo twee losse projecten bevat (race-game op root → Pages/Vercel; `atelier/` → Vercel), met per project een "hoe draai ik dit"-verwijzing. |
| `atelier/README.md` (bestaat) | Blijft de atelier-instap; koppelen vanuit de koepel-README. |
| *(evt.)* `docs/README.md` | Wijst de weg in de docs-/audit-hiërarchie zodra die in Fase B ontstaat. |

**`.github/`-inventaris:** **geen** PR-template (`pull_request_template.md`),
**geen** issue-templates (`ISSUE_TEMPLATE/`). Enkel `workflows/atelier-optimize.yml`.
Beide templates ontbreken en zijn kandidaat voor Fase B.

**Tags / releases:** **0 tags, 0 releases** (lokaal én via GitHub-API bevestigd).
Er is dus geen versietagging die de milestones volgt; milestones leven impliciet in
de commit-/PR-historie (bv. "publish:"/"preview:"-commits).

---

## 8. Snoeilijst CLAUDE.md

**Er is geen `CLAUDE.md` in deze repo (0 regels).** Er valt dus niets te snoeien;
de "snoeilijst" kan pas een echte lijst worden zodra de werkwijze-laag uit
`srclub-workspace` hierheen wordt gebracht of hier vers wordt geschreven (Fase B).

Wat deze audit wél kan leveren, is de **omgekeerde richtlijn voor Fase B**: welke
regels een agent sowieso uit de code/manifests kan afleiden en dus **niet** in een
toekomstige (per-project) `CLAUDE.md` hoeven — de snoeikandidaten vooraf:

| Kandidaat-regel | Waarom overbodig (afleidbaar uit…) |
|---|---|
| "Gebruik three.js r160" | `assets/vendor/three-r160.min.js` / `atelier/vendor/three.module.min.js` — de versie staat in de bestandsnaam en vendor-map |
| "De game heeft geen build-stap / bewerk `dist/` niet met de hand" | zichtbaar aan gecommitte `dist/*.bundle.js` zónder build-config; wél als *waarschuwing* nuttig, niet als uitleg |
| "Atelier-pipeline gebruikt gltf-transform + meshoptimizer" | `atelier/pipeline/package.json` dependencies |
| "Atelier is engine-agnostisch, los van game-code" | `atelier/atelier.js:2` comment + het ontbreken van cross-imports (§6) |
| "Node ≥ 18 voor de pipeline" | `atelier/pipeline/package.json` `engines` |

Regels die een agent **niet** kan afleiden en dus wél in `CLAUDE.md` thuishoren
(ter contrast, geen snoei): handover-verplichting per sessie, één-as-per-sessie,
plan-mode-op-bouwwerk, SW-cache-bump-discipline, en welke publieke URL's aan de
repo-naam hangen.

---

## 9. Ordeningsadvies

De in de opdracht voorgestelde eindvorm getoetst tegen de bevindingen. **Geen
uitvoering, geen definitieve naamkeuze — dat beslist Jur.**

| Voorgesteld onderdeel | Oordeel | Toelichting |
|---|---|---|
| `apps/garden` (tuin → Vercel) | **Past niet** | Er is geen tuin in deze repo (§Belangrijkste bevinding). Deze map heeft hier geen inhoud. |
| `apps/racer` (race-game → Pages-mirror) | **Past met aanpassing X** | De game ís nu de hele root. Verhuizen naar `apps/racer/` breekt: `sw.js` root-absolute paden, de Pages-/Vercel-root, en alle relatieve asset-paden in `index.html`/`css`/`js`. Aanpassing: base-pad en SW-scope herbedraden vóór of tijdens de verhuizing. |
| `packages/engine` (gedeelde WebGPU/TSL-laag) | **Past niet** | Geen gedeelde code, geen tweede bewezen gebruiker (§6). Zonder tuin en zonder cross-imports is er niets te extraheren. |
| `docs/` koepelregels | **Past** | `docs/` bestaat al (nu enkel de audit); de koepel-hiërarchie kan hier landen. |
| `docs/garden/` | **Past niet** | Geen tuin. Het feitelijke tweede project is **atelier**, dus lees dit als **`docs/atelier/`**. |
| `docs/racer/` | **Past** | Projectspecifieke race-docs; nu nog niet-bestaand. |
| npm workspaces (geen turbo/nx/pnpm) | **Past met aanpassing X** | Er is geen root-`package.json` en de game heeft geen npm-build; workspaces zouden vers ingevoerd worden. Zonder een gedeeld `packages/`-doel (§6) is de meerwaarde nu beperkt tot het atelier-pipeline-pakket. Aanpassing: begin met een minimale root-`package.json` die alleen `atelier/pipeline` als workspace kent, óf stel workspaces uit tot er echt gedeelde code is. |

**Wat er stukgaat bij de verhuizing (samengevat):**
1. `sw.js` root-absolute precache-paden en SW-scope (breken bij elk niet-root-pad).
2. De GitHub-Pages-root/subpad-aanname en de `README.md:5`-link.
3. De Vercel-root-koppeling (`/` en `/atelier/`) — herbedraden of Vercel-root herzetten.
4. Relatieve asset-/`dist/`-verwijzingen in `index.html`, `css/`, `js/`.
5. `preview/` (44 snapshots, 97,6 % v/d bestanden) — meeverhuizen is zinloos; dit is
   het moment om het uit tracking te halen (`git rm` + gitignore, of history-schoning).

**Aanbevolen stapvolgorde voor Fase B (niet uitgevoerd):**
1. **Beslis eerst de grondvorm** (monorepo-mappen vs. splitsen in twee repo's) —
   de scharniervraag §6 zegt: *geen* `packages/engine` nodig, dus een lichte
   mappen-splitsing volstaat; monorepo-tooling blijft bewust uit.
2. **Ruim `preview/` op** vóór elke verhuizing (grootste bron van ruis/gewicht).
3. **Breng de werkwijze-laag** (`CLAUDE.md` + `docs/`-hiërarchie, koepel + per
   project) hierheen — dit lost de ontbrekende-handover-oorzaak op (§3).
4. **Verhuis de game** naar zijn map en herbedraad SW/base-pad/Pages/Vercel-root
   in één samenhangende stap; test de precache-paden.
5. **Hernoem** de repo pas als de interne paden staan; werk daarna `README.md:5`
   (+ evt. Vercel-projectnaam en `MOBILE.md:50`) bij.
6. **Schrijf de koepel-README** en de ontbrekende `.github/`-templates.

---

*Einde Fase A. Harde stop: geen reorganisatie, rename of verdere wijzigingen tot er
een verdict is voor Fase B.*
