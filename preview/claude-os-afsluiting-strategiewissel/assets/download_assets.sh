#!/usr/bin/env bash
# assets/download_assets.sh — Fetch HDRIs + ground PBR textures from Poly Haven (CC0)
# into the manifest paths used by Spencer's Race Club.
#
# Usage:
#   bash assets/download_assets.sh                # fetch everything
#   bash assets/download_assets.sh neoncity       # only one world
#   bash assets/download_assets.sh hdri           # only HDRIs (2K + 1K) for all worlds
#   bash assets/download_assets.sh ground         # only ground PBR sets
#
# What it downloads (~120MB total):
#  - 2K + 1K HDRI for neoncity / volcano / arctic
#  - PBR ground set (color + normal + roughness, 2K) for the 4 worlds with ground slots
#
# What it does NOT download:
#  - GLTF models (Quaternius / KayKit packs are zipped — see assets/README.md
#    for manual extraction steps)
#  - Skybox layer art (mountains_far/_near.png — typically AI-generated or
#    hand-painted; pipeline auto-falls-back to procedural silhouettes)
#
# Prerequisites: curl. Re-runs are idempotent — existing files are skipped.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HDRI_DIR="$ROOT/assets/hdri"
TEX_DIR="$ROOT/assets/textures"

mkdir -p "$HDRI_DIR" "$TEX_DIR"

# ── Helpers ──────────────────────────────────────────────────────────────────
fetch() {
  local url="$1" out="$2"
  if [[ -f "$out" ]]; then
    echo "  ✓ skip (exists): ${out#$ROOT/}"
    return 0
  fi
  mkdir -p "$(dirname "$out")"
  echo "  ↓ ${out#$ROOT/}"
  if ! curl -fsSL --retry 2 -o "$out" "$url"; then
    echo "  ✗ failed: $url" >&2
    rm -f "$out"
    return 1
  fi
}

ph_hdri() {
  # ph_hdri <slug> <res> <out>
  local slug="$1" res="$2" out="$3"
  fetch "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/${res}/${slug}_${res}.hdr" "$out"
}

ph_tex() {
  # ph_tex <slug> <map> <out>
  # map names per Poly Haven convention: diff, nor_gl, rough, ao, disp, ...
  local slug="$1" map="$2" out="$3"
  fetch "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/${slug}/${slug}_${map}_2k.jpg" "$out"
}

# ── World-by-world recipes ───────────────────────────────────────────────────
fetch_neoncity_hdri() {
  echo "Neon City / HDRI — dikhololo_night"
  ph_hdri dikhololo_night 2k "$HDRI_DIR/neoncity_night_2k.hdr" || true
  ph_hdri dikhololo_night 1k "$HDRI_DIR/neoncity_night_1k.hdr" || true
}
fetch_neoncity_ground() {
  echo "Neon City / ground — aerial_asphalt_01"
  local d="$TEX_DIR/neoncity"
  ph_tex aerial_asphalt_01 diff   "$d/asphalt_wet_color.jpg"  || true
  ph_tex aerial_asphalt_01 nor_gl "$d/asphalt_wet_normal.jpg" || true
  ph_tex aerial_asphalt_01 rough  "$d/asphalt_wet_rough.jpg"  || true
}

fetch_volcano_hdri() {
  echo "Volcano / HDRI — lonely_road_afternoon_puresky"
  ph_hdri lonely_road_afternoon_puresky 2k "$HDRI_DIR/volcano_dusk_2k.hdr" || true
  ph_hdri lonely_road_afternoon_puresky 1k "$HDRI_DIR/volcano_dusk_1k.hdr" || true
}
fetch_volcano_ground() {
  echo "Volcano / ground — rocky_terrain_02"
  local d="$TEX_DIR/volcano"
  ph_tex rocky_terrain_02 diff   "$d/lavarock_color.jpg"  || true
  ph_tex rocky_terrain_02 nor_gl "$d/lavarock_normal.jpg" || true
  ph_tex rocky_terrain_02 rough  "$d/lavarock_rough.jpg"  || true
}

fetch_arctic_hdri() {
  echo "Arctic / HDRI — snowy_field_01_puresky"
  ph_hdri snowy_field_01_puresky 2k "$HDRI_DIR/arctic_overcast_2k.hdr" || true
  ph_hdri snowy_field_01_puresky 1k "$HDRI_DIR/arctic_overcast_1k.hdr" || true
}
fetch_arctic_ground() {
  echo "Arctic / ground — snow_field_aerial"
  local d="$TEX_DIR/arctic"
  ph_tex snow_field_aerial diff   "$d/snowice_color.jpg"  || true
  ph_tex snow_field_aerial nor_gl "$d/snowice_normal.jpg" || true
  ph_tex snow_field_aerial rough  "$d/snowice_rough.jpg"  || true
}

fetch_deepsea_ground() {
  echo "DeepSea / ground — aerial_beach_03 (sand)"
  local d="$TEX_DIR/deepsea"
  ph_tex aerial_beach_03 diff   "$d/sand_color.jpg"  || true
  ph_tex aerial_beach_03 nor_gl "$d/sand_normal.jpg" || true
  ph_tex aerial_beach_03 rough  "$d/sand_rough.jpg"  || true
}

# ── Driver ───────────────────────────────────────────────────────────────────
case "${1:-all}" in
  hdri)
    fetch_neoncity_hdri
    fetch_volcano_hdri
    fetch_arctic_hdri
    ;;
  ground)
    fetch_neoncity_ground
    fetch_volcano_ground
    fetch_arctic_ground
    fetch_deepsea_ground
    ;;
  neoncity)  fetch_neoncity_hdri;  fetch_neoncity_ground ;;
  volcano)   fetch_volcano_hdri;   fetch_volcano_ground ;;
  arctic)    fetch_arctic_hdri;    fetch_arctic_ground ;;
  deepsea)   fetch_deepsea_ground ;;
  all)
    fetch_neoncity_hdri;  fetch_neoncity_ground
    fetch_volcano_hdri;   fetch_volcano_ground
    fetch_arctic_hdri;    fetch_arctic_ground
    fetch_deepsea_ground
    ;;
  *)
    echo "usage: $0 [all|hdri|ground|neoncity|volcano|arctic|deepsea]" >&2
    exit 1
    ;;
esac

echo
echo "Done. Hard-refresh the browser (Ctrl+Shift+R) and pause during a race —"
echo "the 'ASSETS [WORLD]' line should show HDRI ✓ and GROUND 3/3."
