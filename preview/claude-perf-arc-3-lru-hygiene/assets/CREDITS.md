# Asset credits

All bundled visual assets are CC0 (public domain) — no attribution
required, but we credit the creators here as a courtesy.

## 3D models

### `assets/models/nature/` — Quaternius "Stylized Nature MegaKit"

Trees, plants, rocks, mushrooms, flowers, grass.

- **Author:** [@Quaternius](https://quaternius.com) — [Patreon](https://www.patreon.com/quaternius)
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
- **Used by manifest slots:** volcano (rocks + lava chunk substitute), arctic (snow rock substitute), deepsea (coral substitute via Plant variants).

### `assets/models/city/` — Quaternius "City Bits"

Buildings, street furniture (dumpsters, trash cans, traffic lights,
streetlights, fire hydrants, benches, water tower).

- **Author:** [@Quaternius](https://quaternius.com)
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
- **Used by manifest slots:** neoncity (trashbin via dumpster, bollard_neon via firehydrant, roadblock via box_A), themepark (bollard via firehydrant, barrel via trash_A), deepsea (wreck_box via box_B).

### `assets/models/space/` — Kenney "Space Kit"

Meteors, rocks, crystal formations, craters, satellite dishes.

- **Author:** [Kenney](https://kenney.nl/assets/space-kit) — [@KenneyNL](https://twitter.com/KenneyNL)
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
- **Used by manifest slots:** space (asteroid_small via meteor, asteroid_large via meteor_detailed), volcano (lava_chunk via rock_crystalsLargeA).

### `assets/models/arctic/iceberg_small.glb`

Standalone iceberg model (origin uncertain — pack credits CC0).

- **License assumed:** CC0 (per pack license stamp).
- **Used by manifest slots:** arctic (iceberg_small).

### `assets/models/landmarks/mountain_cabin.glb`

Standalone cabin model. No active manifest slot — held for a future
"track-side landmark" feature.

- **License assumed:** CC0 (per pack license stamp).

## Audio (SFX)

Tier 1a SFX one-shots — see `docs/DECISIONS.md` D16. All sourced from
[`MissLav/CC0-Public-Domain-Sounds`](https://github.com/MissLav/CC0-Public-Domain-Sounds)
which mirrors the official Kenney CC0 audio packs plus several
community CC0 collections. The repo is licensed [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
as a whole; individual sub-packs retain their original Kenney CC0
license stamps.

### `assets/audio/sfx/coin.ogg` — 50-CC0-retro-synth-SFX

Classic retro coin pickup chime.

- **Source pack:** 50-CC0-retro-synth-SFX (`retro_coin_01.ogg`).
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- **Used by manifest slot:** `coin` (in `SFX_MANIFEST`).

### `assets/audio/sfx/boost.ogg` — Kenney "Digital Audio"

Ascending phaser zap for boost-pad activation.

- **Author:** [Kenney](https://kenney.nl/assets/digital-audio) — [@KenneyNL](https://twitter.com/KenneyNL).
- **Source file:** `kenney_digitalaudio/Audio/phaserUp2.ogg`.
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- **Used by manifest slot:** `boost` (in `SFX_MANIFEST`).

### `assets/audio/sfx/nitro.ogg` — Kenney "Digital Audio"

Phase-jump whoosh for nitro-bottle pickup.

- **Author:** [Kenney](https://kenney.nl/assets/digital-audio).
- **Source file:** `kenney_digitalaudio/Audio/phaseJump3.ogg`.
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- **Used by manifest slot:** `nitro` (in `SFX_MANIFEST`).

### `assets/audio/sfx/suspension.ogg` — Kenney "Impact Sounds"

Soft heavy landing thud for jump-recovery (`playLandSound`).

- **Author:** [Kenney](https://kenney.nl/assets/impact-sounds).
- **Source file:** `kenney_impactsounds/Audio/impactSoft_heavy_002.ogg`.
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- **Used by manifest slot:** `suspension` (in `SFX_MANIFEST`).

### `assets/audio/sfx/impactHard.ogg` — Kenney "Sci-Fi Sounds"

Metal crunch for hard collision (`playCollisionSound`).

- **Author:** [Kenney](https://kenney.nl/assets/sci-fi-sounds).
- **Source file:** `sci-fi-sounds/Audio/impactMetal_001.ogg`.
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- **Used by manifest slot:** `impactHard` (in `SFX_MANIFEST`).

### `assets/audio/sfx/glassScatter.ogg` — Kenney "Impact Sounds"

Glass shatter overlay played alongside `impactHard` on hard collisions.

- **Author:** [Kenney](https://kenney.nl/assets/impact-sounds).
- **Source file:** `kenney_impactsounds/Audio/impactGlass_heavy_001.ogg`.
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- **Used by manifest slot:** `glassScatter` (in `SFX_MANIFEST`).

### `assets/audio/sfx/windHigh.ogg` — 100-cc0-sfx-2

Loopable highway-cabin air for the car-wind layer above 0.65 speed-ratio.
Trimmed to 14s, 50ms in/out fades for clean loop boundary, mono 22050Hz
to keep mobile-decode under one frame.

- **Source pack:** 100-cc0-sfx-2 (`sfx100v2_loop_highway.ogg`).
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- **Used by manifest slot:** `windHigh` (in `SFX_MANIFEST`), looped via
  `engine.js` car-wind dispatch.

### Parked slots (no CC0 source via reachable mirrors)

- `brake` — high-Q brake squeal. Procedural fallback active.
- `drift1` / `drift2` / `drift3` — tire screech variants. Procedural fallback active.

The Claude Code execution environment cannot reach kenney.nl /
freesound.org / opengameart.org. To fill these slots, source CC0
audio manually and drop into `assets/audio/sfx/<slot>.ogg` — the
manifest paths in `js/audio/samples.js` are already wired.

## Future asset additions

Whenever you drop a new model / texture / HDRI in this folder, please
either:

- Confirm it is CC0 and add a section here, or
- Move it to a `assets/models/cc-by/` subfolder + add the attribution
  notice the licensor requires.

Anything ambiguous → don't ship it.
