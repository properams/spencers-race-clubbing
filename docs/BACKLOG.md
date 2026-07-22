# BACKLOG

Wat blijft liggen. (S) klein · (M) middel · (L) groot.

## Rename-afronding
- **(S)** Na de repo-rename naar `race-club`: `README.md` Pages-URL bijwerken.
- **(S)** Optioneel het Vercel-project hernoemen om `spencers` uit `*.vercel.app`
  te halen; daarna `atelier/MOBILE.md` bijwerken.

## Kwaliteit & build
- **(M)** Een echte kwaliteitspoort invoeren (`npm run verify`): vereist een
  root-`package.json` en een minimale testset. Nu ontbreekt elke geautomatiseerde
  poort voor de game.
- **(M)** De `dist/`-build reproduceerbaar maken vanuit de repo (buildconfig
  toevoegen), zodat de gecommitte bundels herbouwbaar zijn.

## Opruiming
- **(S)** Externe "preview:/publish:"-flow: bevestigen dat die niet langer in
  `preview/` hoeft te committen nu het untracked is.

## Later / apart traject
- **(L)** Game-rebrand: in-game *Spencer* → neutraal, inclusief migratie van de
  `spencerRC…`-localStorage-keys (risico: saveverlies). Bewust losgekoppeld van
  de repo-rename.
