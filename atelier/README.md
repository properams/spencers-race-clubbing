# atelier

Standalone asset-showroom: een snelle kwaliteitspoort om **zelf-gegenereerde
3D-assets** (image→3D-output) te beoordelen op vorm en kwaliteit vóór ze de
game-wereld in gaan. Staat volledig los van de game — eigen route, eigen
manifest, geen enkele import vanuit game-code.

- Route: `/atelier/` (statische map op repo-root; geen build-stap nodig)
- Manifest: `atelier/manifest.json` (los van `assets/manifest.json` van de game)
- `assets/raw/` — **uitsluitend** eigen image→3D-output (geen betaalde
  Fab-bronbestanden; die blijven in de private workspace)
- `assets/clean/` — genormaliseerde output van de optimize-pipeline
- `pipeline/` — optimize-scripts (Node / gltf-transform)

## Pipeline — snelstart

Eenmalig (Node ≥ 18):

```bash
cd atelier/pipeline && npm install
```

Daarna per asset één commando (raw GLB → genormaliseerde GLB in
`assets/clean/` + entry in `atelier/manifest.json`):

```bash
node atelier/pipeline/optimize.mjs atelier/assets/raw/mijn_asset_raw.glb --tris 5000
```

Keten: weld → dedup → prune → simplify (tris-doel is leidend) →
pivot-to-foot → KTX2-textures → meshopt-compressie. Opties:
`--id`, `--categorie`, `--rol`, `--licentie`, `--credit`, `--status`,
`--error` (start-fouttolerantie), `--no-ktx2`.

- **KTX2** draait automatisch wanneer KTX-Software's `toktx` op PATH staat
  (https://github.com/KhronosGroup/KTX-Software/releases). Zonder toktx
  blijven textures PNG/JPEG — de viewer toont beide; geen blocker.
- **Draco-input** wordt niet ondersteund: exporteer raw assets ongecomprimeerd.
- **Probleem-assets** (gaten, non-manifold): optionele escape-hatch
  `pipeline/cleanup.py` via Blender headless — zie de kop van dat bestand.
  Blender is voor het default-pad níet nodig.

De volledige keten (concept-art → image→3D → optimize → beoordelen →
in-world showroom) wordt in dit bestand gedocumenteerd zodra de pipeline er is.
