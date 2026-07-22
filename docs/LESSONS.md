# LESSONS

Geleerde lessen — dingen die we niet opnieuw willen ontdekken. Kort en concreet.

---

## 2026-07-22 · Deze publieke repo is een publish-mirror, geen dev-repo

De race-game-bestanden hier (`js/ css/ data/ dist/ assets/`, `index.html`,
`sw.js`) worden **gegenereerd** door `publish.yml` vanuit de privé-repo
`srclub-workspace` (`rsync -a --delete`). Ze hier met de hand bewerken is
zinloos — de volgende publish overschrijft het. Alleen `atelier/` en het
repo-onderhoud zijn native. Weet dus vóór je iets aanraakt of het gegenereerd of
native is.

## 2026-07-22 · Een handover komt alleen als de instructie in de repo staat

Werk op déze repo leverde nooit een handover op omdat de hele werkwijze-laag
(CLAUDE.md/.claude/docs) hier simpelweg ontbrak — hij leeft in de privé-bronrepo's
(`srclub-workspace`, `game-engine`). Regels die in een andere repo staan, reizen
niet mee. Elke repo waar je discipline verwacht, heeft zijn eigen `CLAUDE.md` +
docs nodig.

## 2026-07-22 · "Samengevoegd" was eigenlijk drie repo's

De aanname was: tuin + race-game samengevoegd in één repo. In werkelijkheid zijn
het drie repo's — `game-engine` (tuin, r184/WebGPU/TSL), `srclub-workspace`
(race-dev) en deze publieke mirror waar later `atelier/` native aan is
toegevoegd. Les: verifieer de topografie (en, met toestemming, de naburige
repo's) vóór je op een aanname bouwt.

## 2026-07-22 · Root-absolute paden binden aan een domein-root, niet aan de repo-naam

`sw.js` pre-cachet `/index.html`, `/dist/…` — werkt op een domein-root maar
404't op een Pages *project-subpad*. Daarom slaat `publish-preview.yml` `sw.js`
bewust over in preview-deploys. Handig bij rename/deploy: de asset-paden breken
niet door een repo-rename, maar wél door een verschuiving root ↔ subpad.
