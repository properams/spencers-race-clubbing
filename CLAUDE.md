# CLAUDE.md — werkwijze voor spencers-race-clubbing

## Handover-conventie (triple-delivery, P7)

Aan het eind van elke sessie die met een commit of PR eindigt — ongeacht
omvang — een A-L handover-blok leveren op drie plekken:

1. **Chat** — het volledige A-L blok als één markdown-codefence (mobile
   select-all-vriendelijk), header `===== SESSION HANDOVER — KOPIEER DIT
   NAAR CLAUDE CHAT =====`, footer `===== EINDE HANDOVER =====`.
2. **PR-body** — onder een `## Handover (A-L)`-sectie, ná de gebruikelijke
   samenvatting/verificatie-secties.
3. **Persisteren als bestand** in de private companion-repo
   `properams/srclub-workspace` (voeg toe via `add_repo` als die nog niet in
   de sessie zit): `docs/handovers/YYYY-MM-DD_pr<N>_<slug>.md` + een rij in
   `docs/handovers/README.md`. Reden voor de private repo: deze repo is
   publiek, srclub-workspace niet — interne sessie-notities horen daar, net
   als de bestaande scheiding voor betaalde Fab-bronbestanden (zie
   `atelier/README.md`).

Volledige sectiedefinities (0/EFFORT + A-L), format-regels en voorbeeld:
`properams/srclub-workspace` → `docs/SESSION_HANDOVER_TEMPLATE.md`. Als die
repo niet beschikbaar is in de sessie, in elk geval sectie 0 (EFFORT-regel:
`wallclock | commits | diff-regels | user-roundtrips`) en sectie L (open
vragen, max 3) nooit weglaten.

> **Let op:** `srclub-workspace` is sinds 2026-07-21 bevroren als
> referentiemateriaal (strategiewissel naar een nieuwe game op
> `properams/game-engine`) — nieuwe handover-bestanden toevoegen daar is
> nog steeds de bedoeling (dat is precies "referentiemateriaal"), maar
> raak verder niets in dat repo aan zonder het expliciet te vragen.

## Overig

Zie `README.md` voor projectcontext en `atelier/README.md` voor de
asset-pipeline (los van de game, eigen manifest).
