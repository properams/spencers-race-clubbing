# docs/atelier — asset-showroom (projectspecifiek)

Projectspecifieke documentatie-ingang voor **atelier**. De volledige, actuele
uitleg staat in de projectmap zelf:

- **`../../atelier/README.md`** — de keten concept → image→3D → optimize → showroom.
- **`../../atelier/MOBILE.md`** — bediening/beoordeling op mobiel + Vercel-URL.

## Kern om te weten
- **Engine-agnostisch en los van game-code** (three.js r160 **ESM**; eigen
  vendor + eigen `manifest.json`). Geen imports uit `js/`.
- **Pipeline:** `../../atelier/pipeline/` (`optimize.mjs`, gltf-transform +
  meshoptimizer, Node ≥ 18).
- **CI:** `.github/workflows/atelier-optimize.yml` (raw → clean → manifest →
  Vercel-redeploy).
- **Deploy:** Vercel, submap `/atelier/`.

Leg atelier-besluiten vast in `../DECISIONS.md`, patronen in `../PATTERNS.md`.
