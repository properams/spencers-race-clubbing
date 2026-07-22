# Spencer's Race Club

A browser-based 3D arcade racing game with nine themed worlds.

[**▶ Play in your browser**](https://properams.github.io/spencers-race-clubbing/)

The game runs entirely in the browser. Mobile support via touch controls;
effects auto-degrade on lower-end devices.

## This repository contains two independent projects

They share a repo, not code. See [`CLAUDE.md`](CLAUDE.md) for the working rules
and [`docs/MASTERPLAN.md`](docs/MASTERPLAN.md) for the overview.

| Project | Location | What | Deploy |
|---|---|---|---|
| **Race game** (this) | repo root (`index.html`, `js/`, `css/`, `assets/`, `dist/`, `sw.js`) | the racing game above | GitHub Pages + Vercel |
| **Atelier** | [`atelier/`](atelier/README.md) | standalone 3D-asset showroom + pipeline | Vercel (`/atelier/`) |

- **Run the game:** it is a static site — open `index.html` (or the hosted link
  above). No build step; `dist/*.bundle.js` are committed artifacts.
- **Run the atelier:** see [`atelier/README.md`](atelier/README.md).

For contributors and Claude sessions: start at [`CLAUDE.md`](CLAUDE.md);
project docs live in [`docs/`](docs/).

## Asset attribution

3D models are CC0 from Quaternius / Kenney / KayKit packs. Full
attribution and licence stamps in [`assets/CREDITS.md`](assets/CREDITS.md).
