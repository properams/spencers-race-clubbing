# Spencer's Race Club — Visual Asset Pipeline

This folder holds **optional** upgrade assets. The game is fully playable
without any of them — every slot has a procedural fallback baked into the
code. Drop a file at the path listed in `manifest.json` and refresh the
page (Ctrl+Shift+R) to activate the upgrade.

The pipeline mirrors the audio overhaul:

1. `assets/manifest.json` lists every asset slot per world.
2. `js/assets/loader.js` (`window.Assets`) reads the manifest, lazy-loads
   `RGBELoader` / `GLTFLoader` from CDN only when needed, and caches results.
3. World code asks `Assets.getHDRI('neoncity')` etc. synchronously at
   build time. Cache miss → fallback to the procedural canvas / cone /
   `MeshLambertMaterial` path.

## Folder layout

```
assets/
├── audio/         (already in use — see audio/README.md)
├── hdri/          .hdr equirectangular files (Radiance HDR / RGBE)
├── textures/
│   └── neoncity/  ground_color.jpg, ground_normal.jpg, ground_rough.jpg,
│                  mountains_far.png, mountains_near.png
│                  (parallel folders for volcano / arctic / themepark / deepsea)
├── models/
│   ├── nature/    Quaternius Stylized Nature MegaKit — trees, plants,
│   │              rocks, mushrooms, flowers, grass. Shared bark / leaf
│   │              .png textures live next to the .gltf files so multiple
│   │              worlds can pull from the same folder.
│   ├── city/      Quaternius City Bits — buildings, dumpsters, traffic
│   │              lights, streetlights, fire hydrants, benches, water
│   │              tower. citybits_texture.png shared across all .gltf.
│   ├── space/     Kenney Space Kit — meteors, rocks, crystal formations,
│   │              craters, satellite dishes.
│   ├── arctic/    iceberg_small.glb (standalone CC0)
│   └── landmarks/ mountain_cabin.glb (held for a future track-side
│                  landmark slot)
└── CREDITS.md     (per-pack attribution + licence stamps)
```

## Bundled GLTF / GLB assets (already in repo)

The 3D model slots in `manifest.json` are **already populated** with
~120 CC0 GLTF/GLB files spread across Quaternius Nature, Quaternius
City Bits, and Kenney Space Kit. See `assets/CREDITS.md` for per-pack
attribution and the exact slot mapping.

### Multi-variant slots

Each prop slot in the manifest can be either a **single string** (one
asset) or **an array of strings** (multiple variants). When the slot is
an array, the loader fetches every variant in parallel during
`preloadWorld`, and `getGLTF` random-picks among the loaded ones at
each spawn. So a single `tree_pine` slot pointing at `[Pine_1.gltf,
Pine_2.gltf, …, Pine_5.gltf]` produces a forest where every tree is
randomly one of five variants — natural visual variety from a single
manifest entry.

HDRIs + ground PBR + skybox layer art are still optional drops via
`bash assets/download_assets.sh` or manual upload.

### Recommended sources (all permissive licences)

- **HDRI:** <https://polyhaven.com/hdris> — CC0. Pick a 2K outdoor variant.
- **PBR ground textures:** <https://polyhaven.com/textures>,
  <https://ambientcg.com> — CC0. Use the *_diff_2k.jpg + _nor_gl_2k.jpg +
  _rough_2k.jpg trio.
- **Vegetation / props GLTF:** <https://quaternius.com>,
  <https://kaylousberg.itch.io> — both CC0. Pick the lowest-poly variant
  (≤ 1500 tris per tree).

> **Licensing rule:** only CC0, CC-BY (with attribution in
> `assets/CREDITS.md`), or other permissive licences are allowed.
> Anything ambiguous → don't use.

## Quick start — automatic downloads

For HDRIs and PBR ground textures (everything except GLTF models), there's
a one-shot script that fetches all recommended Poly Haven CC0 assets into
the right paths:

```bash
bash assets/download_assets.sh           # everything (~120MB)
bash assets/download_assets.sh hdri      # only HDRIs (2K + 1K)
bash assets/download_assets.sh ground    # only PBR ground sets
bash assets/download_assets.sh neoncity  # one specific world
```

The script is idempotent: existing files are skipped, individual failures
don't abort the run. Re-run after a missing asset to retry.

GLTF models (trees, props) come from Quaternius / KayKit packs which ship
as zips. Manual extraction steps below.

## Activation

1. Run `bash assets/download_assets.sh` (recommended), or place files manually
   at the paths listed in `manifest.json`.
2. Hard refresh the browser (Ctrl+Shift+R / Cmd+Shift+R).
3. Open pause overlay during a race. The line below "FX ON" should read:
   `ASSETS [NEONCITY]   HDRI ✓   GROUND 3/3   PROPS 5/5   LAYERS 2/2`
4. If a slot stays `✗`, open the error viewer (Ctrl+Shift+E) — the asset
   loader logs the failed path under channel `assets`.

## All-worlds rollout (sessie 5)

The pipeline is now active on every world that benefits from realism
upgrades. Drop matching files in the paths listed in `manifest.json`:

| World      | HDRI | Ground PBR | Procedural silhouettes | Textured silhouettes | GLTF props |
|------------|:---:|:---:|:---:|:---:|---|
| neoncity   | ✓ | ✓ (wet asphalt) | ✓ (deep blue-purple) | ✓ (skyline) | trash bin / bollard / roadblock |
| volcano    | ✓ | ✓ (lava rock) | ✓ (rust-red) | ✓ | basalt rocks / lava chunk |
| arctic     | ✓ | ✓ (snow/ice) | ✓ (cold blue) | ✓ (ice peaks) | iceberg s/m / snow rock |
| themepark  | ✓ | ✓ (pavement) | ✓ (dusk purple) | ✓ | traffic cone / bollard / barrel |
| deepsea    | — (underwater) | ✓ (sand floor) | ✓ (dark teal rockwalls) | ✓ | coral s/m / wreck box |
| space      | — (cosmic) | — | — | — | asteroid s/l |
| candy      | — (thematic) | — | ✓ (pastel sweet hills) | ✓ | lollipop / candy cane / gumdrop |

### Recommended HDRI variants per world

- **neoncity**: Poly Haven `urban_alley_01` 2K (night-tinted), or `dikhololo_night`
- **volcano**: Poly Haven `lonely_road_afternoon_puresky` (warm), or any dusk HDRI
- **arctic**: Poly Haven `snowy_park_01` 2K
- **themepark**: Poly Haven `evening_road_01_puresky` 2K

### 3D models — supported formats

The asset loader auto-detects the file extension and routes to the right
Three.js loader:

| Extension | Loader | Notes |
|---|---|---|
| `.glb` / `.gltf` | GLTFLoader | Preferred — single-file binary, smallest payload |
| `.obj` (+ optional `.mtl`) | OBJLoader (+ MTLLoader) | Static geometry only; sibling `.mtl` auto-detected |
| `.fbx` | FBXLoader | Static + skinned geometry; pulls in fflate dependency |

Just put any of these in the manifest path. The dispatcher in
`spawn*Props` doesn't care which format the file is — it consumes the
uniform `{ scene, animations }` shape that the loader returns.

> **Tip for OBJ:** if the file references `.png` / `.jpg` textures via
> `.mtl`, the loader resolves them relative to the `.obj`'s folder. So
> drop `model.obj` + `model.mtl` + any `.png` textures into the same
> folder under `assets/models/<world>/`.

> **Tip for FBX:** zip-FBX is supported via fflate (auto-loaded). Most
> KayKit / Quaternius FBX exports are uncompressed and load fine.

### Where to get models

The download script does NOT fetch GLTF models because most pack
distributors ship them as zips. **Easiest source for individual GLBs:**
[poly.pizza](https://poly.pizza) — free CC0 / CC-BY model browser
where every model has a one-click GLB download (no zip extraction).

#### Per-world recommendations (verified URLs)

**Volcano** — [Quaternius "Stylized Nature MegaKit"](https://quaternius.itch.io/stylized-nature-megakit)
(same pack, different rocks); or
[poly.pizza search "rock"](https://poly.pizza/search/rock) for darker
basalt-looking variants:
- Small jagged rock   → `assets/models/volcano/rock_basalt_small.glb`
- Medium dark rock    → `assets/models/volcano/rock_basalt_medium.glb`
- Any glowing/red chunk → `assets/models/volcano/lava_chunk.glb`

**Arctic** — Quaternius doesn't ship a dedicated snow pack;
[poly.pizza search "iceberg"](https://poly.pizza/search/iceberg) and
[poly.pizza search "snow"](https://poly.pizza/search/snow) have several
CC0 options including Kenney variants:
- Iceberg small / large → `assets/models/arctic/iceberg_small.glb` / `iceberg_medium.glb`
- Snow rock             → `assets/models/arctic/snow_rock.glb`

**Themepark** — [KayKit "City Builder Bits"](https://kaylousberg.itch.io/city-builder-bits)
(32+ city props, CC0, free). Pack contains traffic cones, barrels, and
bollards in `.glb` format alongside `.fbx` / `.obj`:
- TrafficCone.glb → `assets/models/themepark/traffic_cone.glb`
- Bollard.glb     → `assets/models/themepark/bollard.glb`
- Barrel.glb      → `assets/models/themepark/barrel.glb`

**Neon City** — [KayKit "City Builder Bits"](https://kaylousberg.itch.io/city-builder-bits)
again (same pack as themepark — re-extract under different filenames):
- TrashBin.glb / Dumpster.glb → `assets/models/neoncity/trashbin.glb`
- Bollard.glb (or Pylon)      → `assets/models/neoncity/bollard_neon.glb`
- Roadblock.glb / Barrier.glb → `assets/models/neoncity/roadblock.glb`

**Space** — [Kenney "Space Kit"](https://kenney.nl/assets/space-kit)
(150+ assets, CC0, free). Direct GLB downloads on Kenney's site or
[poly.pizza/u/Kenney](https://poly.pizza/u/Kenney):
- Asteroid (small variant) → `assets/models/space/asteroid_small.glb`
- Asteroid (large variant) → `assets/models/space/asteroid_large.glb`

**Candy** — no dedicated CC0 candy pack exists; use
[poly.pizza search "lollipop"](https://poly.pizza/search/lollipop) and
similar for one-off candy GLBs:
- Lollipop  → `assets/models/candy/candy_lollipop.glb`
- Candy cane → `assets/models/candy/candy_cane.glb`
- Gumdrop / gummy → `assets/models/candy/gumdrop.glb`

**DeepSea** —
[poly.pizza search "coral"](https://poly.pizza/search/coral) and
[poly.pizza search "wreck"](https://poly.pizza/search/wreck) /
[poly.pizza search "treasure chest"](https://poly.pizza/search/treasure):
- Coral chunks    → `assets/models/deepsea/coral_small.glb` / `coral_medium.glb`
- Treasure chest / sunken crate → `assets/models/deepsea/wreck_box.glb`

> Skip any prop you don't have — every slot is independent. The
> dispatcher uses whatever subset of GLTFs is actually in the cache.

### Skybox layer art

`mountains_far.png` / `mountains_near.png` are typically AI-generated
silhouettes (Skybox AI, Stable Diffusion with `silhouette mountain
horizon transparent png` prompts) or hand-painted PNGs with alpha. The
pipeline auto-falls-back to procedural canvas silhouettes (palette
tuned per world) so this slot is fully optional — only drop in if you
want a specific landscape.

### Still missing (what to hunt for next)

Slots that are intentionally empty because no fitting CC0 model came in
the current packs. Drop a fitting GLB at the path below or update the
manifest if you find a better source:

| Slot | What we want | Suggested search |
|---|---|---|
| `arctic.iceberg_medium` | Larger iceberg variant — current has only one size | [poly.pizza/search/iceberg](https://poly.pizza/search/iceberg) |
| `themepark.traffic_cone` | Orange traffic cone | [poly.pizza/search/traffic+cone](https://poly.pizza/search/traffic+cone) |
| `volcano.real_lava_chunk` | Glowing lava rock (current uses crystal substitute) | Stylized fire/lava packs on itch.io |
| `deepsea.real_coral_*` | Branching coral (current uses Plant_* substitute) | poly.pizza CC0 underwater pack |
| `deepsea.fish` / `deepsea.shipwreck` | Underwater life + dramatic background | [Kenney Pirate Pack](https://kenney.nl) |
| `candy.*` (3 slots) | Lollipop / candy cane / gumdrop | poly.pizza search per item, none fitting in current packs |
| `space.alien_signal_buoy` etc. | More space variety | Kenney Space Kit has more we skipped |

Also still missing across all worlds:
- **HDRI sky environments** — run `bash assets/download_assets.sh hdri`
- **PBR ground textures** — run `bash assets/download_assets.sh ground`
- **Skybox layer art** (`mountains_far.png`, `mountains_near.png`) — AI-generated silhouettes per world

### Mobile HDRI variants (optional but recommended)

The manifest has an `hdri_mobile` slot per world. Drop a 1K-resolution
HDRI alongside the 2K version — name it `*_1k.hdr` instead of `*_2k.hdr`
in the `assets/hdri/` folder. On mobile devices the loader automatically
prefers the 1K variant; if absent it falls back to the 2K file. 2K is
~6MB on disk; 1K is ~1.5MB — significantly faster download + decode on
slower mobile networks. Final envMap output is identical after PMREM
prefiltering, so visual quality on mobile is barely affected.

### Notes on world-specific behaviour

- HDRI fog-color sampling overrides the world's procedural fog tint. For
  thematic worlds (volcano red, neon purple) this is the user's opt-in
  trade — drop a matching HDRI or stick to procedural.
- Procedural background silhouettes are tuned per world to sit *behind*
  the existing rich horizons (volcano embers, neon skyscrapers, arctic
  auroras, themepark fireworks). They render automatically on
  neoncity / volcano / arctic / themepark; deepsea / space / candy stay
  pure procedural.
- GLTF roadside prop dispatchers run on all worlds with prop slots.
  Without files dropped in, every spawn loop is a no-op — the existing
  procedural environment is unchanged.
