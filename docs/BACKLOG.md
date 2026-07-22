# BACKLOG

Openstaand werk. Geordend naar urgentie, niet gedateerd. Afgeronde items
verhuizen naar `docs/CHANGELOG.md`.

---

## Nu relevant (na Fase B)

- [ ] **Repo-rename uitvoeren.** Persoonsnaam uit publieke URL's. Raakt ook de
      publish-workflows in `srclub-workspace` (die hardcoden
      `properams/spencers-race-clubbing`). Runbook: `docs/RENAME_RUNBOOK.md`.
      Wacht op go + finale slug van Jur. Outward-facing: breekt de live
      Pages-URL én de publish-keten tot de refs zijn bijgewerkt.
- [ ] **`preview/` opruimen.** 44 snapshots, ~4,2 GB (~98% van het repo-gewicht).
      Het is een gegenereerd deploy-mechanisme (`publish-preview.yml`); opruimen
      hoort via `cleanuppublicbranches.yml` in `srclub-workspace` te lopen —
      controleren of dat draait en stale previews echt pruned.
- [ ] **Vercel-check na root-`package.json`.** Deze repo kreeg een root
      `package.json` (voor `npm run verify`). Bevestigen dat de atelier-Vercel-
      deploy ongewijzigd static blijft (Root Directory / geen ongewenste build).

## Werkwijze / kwaliteit

- [ ] **`verify` uitbreiden** (optioneel): lint/format, of een headless
      smoke-boot. Nooit verlagen onder de huidige syntax+JSON-poort. (De
      privé-repo's hebben al een zwaardere `verify`: typecheck+lint+depcruise+
      test+build — als referentie.)
- [ ] **Handover-gewoonte borgen** (optioneel): een Stop/SessionEnd-hook die
      herinnert aan `/handover` bij ongecommitte werkwijze-mutaties.

## Grotere ordening (open opties uit de audit — niet gekozen)

- [ ] **Variant B — monorepo** (koepel-laag boven game/atelier). Hoge kost:
      paden, `sw.js`, Pages-/Vercel-roots herbedraden.
- [ ] **Variant C — verder splitsen** (atelier naar een eigen repo + eigen
      Vercel-project, los van de publish-mirror). Middelkost.

## Te verifiëren (deels beantwoord door de repo-audit)

- [x] Pages via deploy-from-branch of aparte repo? → **Aparte publish-mirror**:
      `srclub-workspace` bouwt en pusht via `publish.yml` naar deze repo; Pages
      serveert deze repo.
- [ ] Serveert de game op een domein-root of op een `/<repo>/`-subpad? De
      root-absolute SW-paden suggereren root; `publish-preview.yml` bevestigt dat
      subpaden `sw.js` breken. Definitief bevestigen op de live-deploy.
- [ ] `Playground` (privé, HTML) — niet geïnspecteerd; lijkt scratch. Checken
      als het relevant blijkt.
