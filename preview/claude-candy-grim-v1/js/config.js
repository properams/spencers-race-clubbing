// js/config.js — gameplay-tuning constanten gedeeld door alle modules.
// Non-module script, geladen vóór alle andere subsystemen.
//
// Cross-script let/const bindings: zichtbaar voor elk later-geladen
// non-module script via global script scope.

'use strict';

// Race
// `var` so window.TOTAL_LAPS is available to ES modules (e.g. progression.js).
// `let` at script-top would not create a property on globalThis, leaving the
// module-side multiplier as undefined → NaN propagates into coin totals.
var TOTAL_LAPS=3; // muteerbaar via lap-count selectie

// Track geometry. TW = half-track-width used by track.js to build the asphalt
// ribbon and by tracklimits.js to detect off-track. Single global across all
// worlds — sandstorm's "slot canyon" is visual-only (cliff walls placed via
// _ssBuildCanyonCliffs at BARRIER_OFF + 6 outside the standard width); the
// detection band stays uniform so ai.js / tracklimits behave identically
// across the 9 worlds and the AI's per-track racing-line offsets continue
// to use a stable reference width.
const TW=13, BARRIER_OFF=16, RECOVER_DIST=30, WARN_DIST=22;

// Difficulty multiplier (0=easy 1=normal 2=hard)
// Owner feedback: 'AI veel te langzaam, win altijd' — eerdere bump naar 1.34
// op Hard was niet genoeg omdat de rubberband-cap en lead-slowdown het effect
// wegknepen. Per-difficulty steady-state factor t.o.v. per-car topSpd (geen
// rubberband, geen boost, average corner caution over een lap):
//   Easy:   topSpd × 0.72 × 1.28 × 0.95 ≈ 0.88×  (player ≈ 1.32×)  → speler wint ruim
//   Normal: topSpd × 1.18 × 1.28 × 0.90 ≈ 1.36×  (player ≈ 1.32×)  → 50/50 race
//   Hard:   topSpd × 1.40 × 1.28 × 0.84 ≈ 1.51×  (player ≈ 1.32×)  → AI in voordeel
// 2026-05 — owner: 'AI nog steeds te langzaam, racing-line + sterker pakket'.
// Easy 0.72→0.78 (player wint nog, voelt minder traag), Normal 1.18→1.26
// (echt 50/50), Hard 1.40→1.52 (vereist nitromanagement).
const DIFF_MULT=[0.78,1.26,1.52];

// ── SPEED_TUNING (Sessie C — C0, 2026-05-08) ──────────────────────────
// Single source of truth for player-physics tuning multipliers. Each
// constant scales an existing per-car value from cars.json so the
// per-car relative ranking stays intact while the absolute feel of
// 'driving without nitro' becomes more responsive.
//
// Conservative first pass per kickoff: bump base feel without
// reshaping the nitro gap. Eigenaar can revert this single block to
// {1, 1, 1, 1.55} for status-quo.
const SPEED_TUNING={
  // +32% base topspeed — owner: 'zonder nitro echt te langzaam'.
  // Bumped 1.18 → 1.32 so cruising feels racey; nitro-gap narrows
  // (1.32×1.55=2.05 vs old 1.83) but absolute nitro speed climbs.
  topSpdMult: 1.32,
  // +22% acceleration — snappier launch out of corners + off-grid.
  // Bumped 1.12 → 1.22 to match the higher topspeed (cars used to
  // crawl up to the new ceiling).
  accelMult: 1.22,
  // +14% brake to match higher topspeed and accel (brake derives
  // from accel*2.4; this scales the multiplier so stopping distance
  // stays drivable at the new pace).
  brakeMult: 1.14,
  // Nitro multiplier — DOCUMENTATION-ONLY here; the hard-coded 1.55 in
  // physics.js stays unchanged so the boost-gap stays proportional.
  nitroMultUnchanged: 1.55,
};

// ── AI_TUNING (Sessie C — C0, 2026-05-08) ─────────────────────────────
// Tunables for AI competitiveness. Owner: 'competitie erg langzaam,
// mag uitdagender'. Conservative first pass: nudge AI base speed up
// + reduce corner-caution floor so they hold pace through bochten.
const AI_TUNING={
  // Global AI base speed multiplier (multiplies on top of DIFF_MULT).
  // Bumped 1.22 → 1.28 zodat Normal AI gemiddelde speler matcht in plaats
  // van permanent 17% achter te lopen.
  baseSpeedMult: 1.34,
  // Corner caution floor — hogere waarde = AI remt minder in bochten.
  // Scalar blijft als fallback; per-difficulty array is autoritatief in
  // ai.js (_cornerFloorFor). Hard floor 0.86 → AI verliest max ~14% pace
  // in scherpe bochten. Owner-pass 2026-05: bumped van [0.50,0.62,0.78].
  cornerCautionFloor: 0.52,
  cornerCautionFloorByDiff: [0.56, 0.70, 0.86],
  // Rubberband-when-ahead easing (0 = AI rijdt vol door als hij voorop ligt,
  // 1 = legacy MK-style throttle-back). Scalar blijft als fallback;
  // per-difficulty array is autoritatief. Hard = 0 → eenmaal voorop blijft de
  // AI duwen. Easy = 0.55 → speler kan terugkomen na een fout.
  leadBandEase: 0.2,
  leadBandEaseByDiff: [0.55, 0.25, 0.0],
};

// ── HUD feature flags (Sessie C — C6, 2026-05-08) ────────────────────
// Owner mandate: 'buttons om te kiezen overal weg' — verstop de DOM
// day/night toggle. J-hotkey via input.js blijft live zodat power-users
// nog kunnen schakelen. Flip naar true om de knop terug te brengen.
const SHOW_DAYNIGHT_TOGGLE=false;

// Racing line grip bonus zones (progress ranges) — [start, end, bonus]
const GRIP_BONUS_ZONES=[[0.93,0.09,.04],[0.30,.42,.03],[0.63,.75,.03]];
