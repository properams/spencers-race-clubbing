# CLAUDE.md — werkwijze & koepelregels

Dit bestand is de instap voor elke Claude-sessie in deze repo. Lees het eerst.

## Wat is deze repo?

**Eén repo, twee onafhankelijke projecten.** Ze delen alleen een map — geen code,
geen build, geen dependencies over en weer (bevestigd in `docs/audits/REPO_INVENTARIS.md`).

| Project | Waar | Wat | Deploy |
|---|---|---|---|
| **Race-game** (in-game: *Spencer's Race Club*) | de repo-**root** (`index.html`, `js/`, `css/`, `data/`, `assets/`, `dist/`, `sw.js`) | 3D arcade-racer, negen werelden, vanilla JS, three.js r160 als **classic global `<script>`** | GitHub Pages + Vercel-root |
| **Atelier** | `atelier/` | standalone asset-showroom (concept → image→3D → optimize → showroom), three.js r160 **ESM** | Vercel (`/atelier/`) |

> De repo wordt hernoemd naar **`race-club`** (persoonsnaam uit de publieke
> URL's — zie `docs/DECISIONS.md`). Het in-game merk blijft *Spencer's Race Club*.

Er is **geen tuin-project** en **geen gedeelde `packages/engine`** in deze repo,
ondanks eerdere aannames. Zie de audit voor het bewijs.

## Vaste werkwijze (koepelbreed — geldt voor beide projecten)

1. **Schrijf een handover per sessie — ongeacht omvang.** Gebruik
   `docs/handovers/SESSION_HANDOVER_TEMPLATE.md`; leg het resultaat neer in
   `docs/handovers/JJJJ-MM-DD_korte-titel.md`. Dit is de #1-regel; zonder handover
   is een sessie niet af.
2. **Eén as per sessie.** Werk aan één samenhangende verandering, niet meerdere
   losse sporen tegelijk.
3. **Plan-mode op bouwwerk.** Bij niet-triviale wijzigingen eerst een plan
   voorleggen, dan pas uitvoeren.
4. **Werk de docs bij** die je verandering raakt: `DECISIONS` (waarom),
   `CHANGELOG` (wat), `PATTERNS`/`LESSONS` (herbruikbaar inzicht), `BACKLOG`
   (wat blijft liggen).
5. **Kwaliteitspoort waar aanwezig.** Er is (nog) geen `npm run verify` — er is
   geen root-`package.json` en geen testset. Zolang die er niet is, is de poort
   handmatig: laat de gewijzigde game/atelier lokaal draaien en controleer de
   console. Een echte verify-poort staat op de `BACKLOG`.

## Per project

### Race-game (root)
- **Geen build in de repo.** `dist/*.bundle.js` zijn **gecommitte artefacten**;
  het buildproces staat niet in de repo, dus `dist/` is **niet reproduceerbaar**
  vanaf hier. Bewerk `dist/` niet met de hand zonder dat vast te leggen.
- **Service worker.** `sw.js` precachet met **root-absolute paden** (`/`,
  `/index.html`, `/assets/…`, `/dist/…`). Werkt op een domein-**root**; bump de
  cache-versie in `sw.js` als je gecachete assets wijzigt, anders zien spelers de
  oude versie.
- **Assets.** Game-assets + attributie in `assets/` (`assets/CREDITS.md`,
  `assets/manifest.json`). Dit staat los van de atelier-pipeline.

### Atelier (`atelier/`)
- **Engine-agnostisch, los van game-code** (`atelier/atelier.js` importeert niets
  uit `js/`).
- **Asset-pipeline:** `atelier/pipeline/` (`optimize.mjs`, gltf-transform +
  meshoptimizer). Node ≥ 18. Flow: raw GLB in `atelier/assets/raw/` → CI
  (`.github/workflows/atelier-optimize.yml`) → `clean/` + `atelier/manifest.json`
  → Vercel-redeploy. Details in `atelier/README.md` en `atelier/MOBILE.md`.

## Naam- & URL-afhankelijkheden (belangrijk bij rename)

De publieke URL's hangen aan de repo-/projectnaam. Bij een rename bijwerken:
- `README.md` — de Pages-speel-URL.
- `atelier/MOBILE.md` — de Vercel-URL (alleen als óók het Vercel-project hernoemd is).

Houd nieuwe hardgecodeerde URL's tot een minimum; centraliseer ze in `README.md`.

## Docs-hiërarchie

`docs/MASTERPLAN.md` (overzicht) · `docs/DECISIONS.md` (waarom-besluiten) ·
`docs/PATTERNS.md` · `docs/LESSONS.md` · `docs/BACKLOG.md` · `docs/CHANGELOG.md` ·
`docs/GAME_MAP.md` (kaart van de game-code) · `docs/handovers/` (per-sessie) ·
`docs/racer/` + `docs/atelier/` (projectspecifiek) · `docs/audits/` (audits).

## Wat je uit de code kunt aflezen (staat hier bewust niet)

Om dit bestand kort te houden: de three.js-versie staat in de vendor-bestandsnamen,
de atelier-dependencies in `atelier/pipeline/package.json`, en de mappenindeling in
`docs/GAME_MAP.md`. Herhaal die feiten hier niet — verwijs ernaar.
