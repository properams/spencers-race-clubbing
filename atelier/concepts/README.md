# concepts/

Drop-map voor eigen concept-art (2D). Elke nieuwe of hernoemde afbeelding
hier triggert automatisch de image→3D-stap (fal.ai TRELLIS) gevolgd door de
bestaande optimize-pipeline — zie `atelier/README.md` (§2, route A) voor de
volle uitleg.

## Naamconventie

- alleen kleine letters, cijfers en underscores
- extensie `.png` of `.jpg`
- regex: `^[a-z0-9][a-z0-9_]*\.(png|jpg)$`

De bestandsnaam zonder extensie wordt de **asset-id** — dezelfde id die
verderop in `assets/raw/`, `assets/clean/` en `atelier/manifest.json`
gebruikt wordt. Bestanden die niet aan de conventie voldoen, worden door de
Action overgeslagen (met een waarschuwing in de Actions-log), niet verwerkt.

## Kosten en idempotentie

Elke nieuwe afbeelding kost één betaalde fal.ai-run (~$0,02). Een bestand
waarvan de id al een clean-GLB én een manifest-entry heeft, wordt
overgeslagen — heruploaden met dezelfde naam (ook met andere inhoud)
triggert dus géén nieuwe generatie. Wil je een asset opnieuw genereren:
verwijder eerst de bijbehorende `assets/clean/<id>.glb` en de entry in
`atelier/manifest.json`, of gebruik een nieuwe bestandsnaam.
