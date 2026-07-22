# Handovers

Het geheugen tussen sessies. Elke sessie eindigt met één handover — dit was de
ontbrekende gewoonte die de audit blootlegde, dus sla het niet over.

## Regels

- **Eén handover per sessie**, aan het eind, vóór je afsluit.
- Bestandsnaam: `JJJJ-MM-DD-<as>.md` (bv. `2026-07-22-werkwijze-laag.md`).
  De `<as>` is het ene spoor van de sessie.
- Gebruik `TEMPLATE.md` als structuur, of draai het `/handover`-command.
- Draai `npm run verify` vóór je de handover schrijft en noteer de uitkomst.

## Wat erin hoort

De as, wat je deed, verify-status, gewijzigde bestanden, open punten/risico's,
en — het belangrijkst — de logische volgende stap voor de volgende sessie.

Nieuwste handover onderaan de map (op datum gesorteerd).
