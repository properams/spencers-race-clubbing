# Handover — 2026-07-22 — werkwijze-laag (Fase A audit + Fase B)

**As van de sessie:** de repo ordenen — audit uitvoeren en de ontbrekende
werkwijze-laag in-place toevoegen.

**Verify:** groen (`npm run verify` → 120 JS + 6 JSON schoon).

## Wat gedaan
- **Fase A — audit.** `docs/audits/REPO_INVENTARIS.md` opgeleverd: topografie,
  configs, "waarom geen handover", naam-afhankelijkheden, deploy-paden, drie
  ordeningsvarianten. (Read-only; PR #6 geopend als draft.)
- **Repo-topologie bevestigd (met toestemming van Jur).** Naburige repo's
  ingezien: `game-engine` = de tuin (r184/WebGPU/TSL/Vite), `srclub-workspace`
  = dev-source van de race-game die via `publish.yml` naar deze publieke mirror
  publiceert. Addendum aan de audit toegevoegd.
- **Fase B — werkwijze-laag toegevoegd (variant A).** `CLAUDE.md`, `.claude/`
  (settings + `/handover`-command), `docs/`-hiërarchie (MASTERPLAN, DECISIONS,
  LESSONS, CHANGELOG, BACKLOG, PATTERNS, RENAME_RUNBOOK), `docs/handovers/`
  (README + TEMPLATE + deze handover), `verify`-poort (`package.json` +
  `scripts/verify.mjs`), root `.gitignore`.
- De werkwijze-laag is gescoped op native werk (atelier + repo-onderhoud) en
  documenteert dat de game-bestanden gegenereerd zijn (niet hier bewerken).

## Gewijzigde bestanden
- `CLAUDE.md`, `.gitignore`, `package.json`, `scripts/verify.mjs` — nieuw.
- `.claude/settings.json`, `.claude/commands/handover.md` — nieuw.
- `docs/*.md` (7 stuks) + `docs/handovers/*` (3 stuks) — nieuw.
- `docs/audits/REPO_INVENTARIS.md` — addendum toegevoegd.

## Beslissingen / lessen
- Zie `docs/DECISIONS.md` (variant A; verify-scope; werktitel `race-club`;
  scoping op native werk) en `docs/LESSONS.md` (publish-mirror; handover-regel
  reist niet mee; drie repo's; root-absolute paden).

## Open punten / risico's
- **Rename niet uitgevoerd** — outward-facing + raakt publish-workflows in
  `srclub-workspace`. Runbook staat klaar; wacht op go + finale slug.
- **Vercel-check** — root `package.json` toegevoegd; bevestigen dat de
  atelier-deploy static blijft (backlog).
- **`preview/` (4,2 GB)** niet aangeraakt — bewust; opruimen via
  `cleanuppublicbranches.yml` in `srclub-workspace` (backlog).

## Volgende stap
Jur laten kiezen: de rename doorzetten (runbook volgen) of eerst de
Vercel-/preview-hygiëne-backlogitems oppakken.
