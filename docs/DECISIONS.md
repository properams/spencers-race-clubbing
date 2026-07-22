# DECISIONS

Waarom-besluiten, nieuwste bovenaan. Kort: context → besluit → gevolg.

## 2026-07-22 · Grondvorm = in-place, géén monorepo/`packages/engine`
**Context:** de audit (`audits/REPO_INVENTARIS.md`) toonde aan dat er geen
tuin-project en geen gedeelde code is; race (global-script three) en atelier (ESM
three) zijn twee losse bomen met nul cross-imports.
**Besluit:** de projecten blijven in-place (game op root, atelier in `atelier/`).
Geen `apps/`-verhuizing, geen `packages/engine`, geen npm-workspaces/turbo/nx.
**Gevolg:** geen risicovolle herbedrading van SW-/Pages-/Vercel-paden; de
werkwijze-laag en documentatie worden toegevoegd zónder code te verplaatsen.

## 2026-07-22 · Werkwijze-laag vers in deze repo geschreven
**Context:** `CLAUDE.md`, docs-hiërarchie en handover-template leefden in het
aparte, nu bevroren repo `srclub-workspace` — daarom kreeg een race-sessie hier
geen handover en golden de vaste regels niet.
**Besluit:** de werkwijze-laag vers hier opbouwen, gedistilleerd uit de audit en
uit het handover-blok dat in PR #5 zichtbaar was; `srclub-workspace` blijft buiten
scope.
**Gevolg:** elke sessie in deze repo heeft nu een instap (`CLAUDE.md`) en een
handover-verplichting.

## 2026-07-22 · `preview/` uit git-tracking
**Context:** 44 deploy-preview-snapshots = 97,6% van de getrackte bestanden
(~4,2 GB werkboom); niets in code/config leest eruit.
**Besluit:** `git rm -r --cached preview/` + `.gitignore` (niet-destructief;
history blijft). Geen history-rewrite (zou alle SHA's herschrijven en open PR's
breken).
**Gevolg:** lichtere checkout en minder review-ruis; snapshots blijven lokaal op
schijf staan maar worden niet meer getrackt.

## 2026-07-22 · Rename repo → `race-club`
**Context:** de repo-slug bevat een persoonsnaam die in publieke Pages-/Vercel-
URL's terechtkomt.
**Besluit:** hernoemen naar `race-club`. Het in-game merk *Spencer's Race Club*
en de `spencerRC…`-localStorage-keys blijven ongemoeid (game-rebrand = apart
traject met save-migratierisico).
**Gevolg:** na de rename (GitHub Settings) worden `README.md` (Pages-URL) en
zo nodig `atelier/MOBILE.md` (Vercel-URL) bijgewerkt.
