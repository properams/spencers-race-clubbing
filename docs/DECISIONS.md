# DECISIONS

Beslissingenlogboek (nieuwste bovenaan). Eén entry per genomen keuze: context,
besluit, gevolg. Geen open vragen — die horen in `docs/BACKLOG.md`.

---

## 2026-07-22 · Werkwijze-laag scoperen op native werk (na topologie-bewijs)

**Context.** Toegang tot de overige account-repo's (met toestemming) bevestigde
de topologie: de race-game wordt ontwikkeld in de privé-repo `srclub-workspace`
en via Actions naar déze publieke repo gepubliceerd; `game-engine` (privé) is de
"tuin". De game-bestanden hier zijn dus gegenereerd (`publish.yml` overschrijft
ze), en alleen `atelier/` + repo-onderhoud zijn native.

**Besluit.** De werkwijze-laag in deze repo expliciet scopen op het native werk
(atelier + onderhoud) en helder documenteren dat de game-bestanden gegenereerd
zijn en **niet hier** bewerkt worden. Governance voor de game zelf blijft in
`srclub-workspace`.

**Gevolg.** `CLAUDE.md`, `MASTERPLAN.md` en `PATTERNS.md` benoemen de
publish-mirror-topologie; de audit kreeg een addendum met het bewijs.

## 2026-07-22 · Werkwijze-laag in-place toevoegen (audit-variant A)

**Context.** De audit (`docs/audits/REPO_INVENTARIS.md`) stelde vast dat de hele
werkwijze-laag in deze publieke repo ontbrak — de oorzaak dat werk hier (met
name atelier) nooit een handover of vaste regels opleverde.

**Besluit.** Variant **A**: de werkwijze-laag *in-place* op de repo-root
toevoegen, zonder game of atelier te verplaatsen. Volledig additief, omkeerbaar,
en (bevestigd) buiten het `publish.yml`-syncpad dus niet-overschreven.

**Gevolg.** Toegevoegd: `CLAUDE.md`, `.claude/` (settings + `/handover`),
`docs/`-hiërarchie + handovers, en een `verify`-poort. Varianten B (monorepo) en
C (verder splitsen) blijven open op de backlog.

## 2026-07-22 · `verify` = syntax + JSON-smoke, niet meer

**Context.** Deze repo had geen enkele geautomatiseerde poort en geen test-setup.

**Besluit.** `npm run verify` doet bewust alleen `node --check` op alle
game-/atelier-JS plus JSON-geldigheid van de data/manifest-bestanden. Nul deps,
nul build-stap.

**Gevolg.** Een echte, groene poort die deploybreuk door syntax-/JSON-fouten
tegenhoudt. Uitbreiden met lint/tests mag (backlog); verlagen niet.

## 2026-07-22 · Werktitel-slug `race-club`, rename nog niet uitgevoerd

**Context.** De repo-slug `spencers-race-clubbing` bevat een persoonsnaam in
publieke URL's (Pages + Vercel), én wordt hardgecodeerd in de publish-workflows
van `srclub-workspace`.

**Besluit.** Intern (o.a. `package.json` `name`) de neutrale werktitel
`race-club` gebruiken. De echte GitHub-rename is outward-facing en admin-werk en
raakt de publish-keten in `srclub-workspace`; die wacht op expliciete go van Jur.
Runbook: `docs/RENAME_RUNBOOK.md`. De in-game merknaam blijft.

**Gevolg.** Repo is rename-ready; finale slug en timing zijn Jurs keuze.
