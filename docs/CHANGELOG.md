# CHANGELOG

Afgerond werk, nieuwste bovenaan. Één regel per betekenisvolle wijziging.
Losstaand van de game-versie / SW_VERSION.

---

## 2026-07-22

- **Repo-topologie bevestigd (met toestemming).** Naburige repo's ingezien:
  `game-engine` = de tuin (r184/WebGPU/TSL/Vite), `srclub-workspace` = dev-source
  van de race-game die via `publish.yml` naar deze publieke mirror publiceert.
  Addendum toegevoegd aan `docs/audits/REPO_INVENTARIS.md`; werkwijze-laag
  hierop gescoped.
- **Fase B — werkwijze-laag toegevoegd (variant A).** `CLAUDE.md`, `.claude/`
  (settings + `/handover`-command), `docs/`-hiërarchie (MASTERPLAN, DECISIONS,
  LESSONS, CHANGELOG, BACKLOG, PATTERNS), `docs/handovers/` (README + sjabloon
  + eerste handover), en `docs/RENAME_RUNBOOK.md`.
- **`verify`-poort ingesteld.** Root `package.json` + `scripts/verify.mjs`:
  `node --check` op alle game-/atelier-JS + JSON-geldigheid. `npm run verify`
  draait groen (120 JS + 6 JSON).
- **Root `.gitignore`** toegevoegd (node_modules, OS-cruft).
- **Fase A — audit** opgeleverd: `docs/audits/REPO_INVENTARIS.md`.
