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

De volledige keten (concept-art → image→3D → optimize → beoordelen →
in-world showroom) wordt in dit bestand gedocumenteerd zodra de pipeline er is.
