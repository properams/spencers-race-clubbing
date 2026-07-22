# GAME_MAP — kaart van de race-game-code

Startkaart op mapniveau (afgeleid van de mapstructuur). Verdiep per cluster
wanneer je erin werkt; houd deze kaart bij als de indeling verandert.

## Instap
- `index.html` — game-shell (~65 KB): inline HUD/screens, laadt three.js als
  global `<script>` (`assets/vendor/three-r160.min.js`) + de `dist/`-bundels.
- `js/main.js` — entrypoint. `js/config.js` — configuratie.
- `sw.js` — service worker (root-absolute precache).

## `js/`-clusters
| Map | Bestanden | Rol (globaal) |
|---|---:|---|
| `core/` | 21 | kern: scene, render-lus, three-compat, basisinfra |
| `cars/` | 6 | auto's: parts, selectie, gedrag |
| `gameplay/` | 16 | spelregels, race-logica, progressie-hooks |
| `worlds/` | 14 | de negen themawerelden + wereld-varianten |
| `track/` | 4 | baan/omgeving-opbouw |
| `effects/` | 26 | visuele effecten (grootste cluster) |
| `ui/` | 13 | schermen, HUD, profiel |
| `audio/` | 8 | geluid & muziek |
| `persistence/` | 6 | save/snapshot/career/progression (localStorage `spencerRC…`) |

## `css/` (8)
`base` · `hud` · `screens` · `select` · `settings` · `worlds` · `notifications` ·
`holo-components`.

## `data/`
`cars.json` · `prices.json` · `tracks.json` · `tracks.archive.json`.

## `dist/` (gecommitte bundels, geen in-repo build)
`device` · `breadcrumb` · `perf` · `three-compat` · `quality-tier` ·
`shared-materials` · `debug`.

> Deze kaart is bewust op cluster-niveau. Vul functie-/bestand-details aan naarmate
> je een cluster echt aanraakt — niet vooraf speculeren.
