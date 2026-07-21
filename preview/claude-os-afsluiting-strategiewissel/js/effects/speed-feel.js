// js/effects/speed-feel.js — wereldbrede snelheidssensatie.
// Non-module script. Geladen vóór camera.js + visuals.js zodat die
// bestanden de constants kunnen lezen (typeof-guard fallback aanwezig
// in elke consumer voor robuustheid).
//
// Vier afzonderlijk doseerbare effecten — finetune één getal per
// effect-blok hieronder. Werkt automatisch in alle worlds omdat het
// op de gedeelde camera/render-loop hangt, niet per-world.

'use strict';

// ────────────────────────────────────────────────────────────────────────
// Effect 1 — Snelheidsafhankelijke motion-blur.
// Bouwt voort op de bestaande atmosphere-pass radial-blur uniform
// (setMotionBlurFromSpeed in js/effects/atmosphere-pass.js). Threshold
// is de speedRatio waaronder géén blur; GAIN_MUL is een globale
// vermenigvuldiger bovenop de per-wereld speedBlur preset; NITRO_BONUS
// is extra blur die alleen tijdens nitro wordt opgeteld.
// Per-wereld blur-multiplier blijft staan in world-visuals.js
// (volcano 0.30, candy 0.15, space 0.10 — donker reageert sterker).
// ────────────────────────────────────────────────────────────────────────
const SPEED_FEEL_BLUR_THRESHOLD     = 0.55; // speedRatio drempel (was 0.65 hardcoded)
const SPEED_FEEL_BLUR_GAIN_MUL      = 1.6;  // globale gain bovenop per-wereld preset
const SPEED_FEEL_BLUR_NITRO_BONUS   = 0.40; // extra blur (×worldMul) tijdens nitro

// ────────────────────────────────────────────────────────────────────────
// Effect 2 — FOV-punch (basis + nitro + boost). updateCamera() in
// gameplay/camera.js leest deze waardes — bij ontbreken vallen ze
// terug op hardcoded defaults via typeof-guard.
// Base-FOV blijft per-cam-view bepaald in camera.js (niet hier — anders
// vlieg je elke cam-view-switch in de war).
// ────────────────────────────────────────────────────────────────────────
const SPEED_FEEL_FOV_SPEED_GAIN     = 26;   // ° / speedRatio (was 22)
const SPEED_FEEL_FOV_NITRO_GAIN     = 24;   // ° extra tijdens nitro (was 20)
const SPEED_FEEL_FOV_BOOST_GAIN     = 12;   // ° extra tijdens boost-pad (was 10)

// ────────────────────────────────────────────────────────────────────────
// Effect 3 — Speed-shake. Subtiele adrenaline-jitter, geen
// misselijkmakende wiebel. Schaalt lineair vanaf THRESHOLD; nitro
// vermenigvuldigt amplitude. Frequency in Hz bepaalt de wave-rate van
// de sin-modulatie (random-component is per-frame onbeïnvloed).
// Aangeroepen in updateCamera() vlak NA lookAt zodat shake niet
// gecompenseerd wordt door de camera-tracking.
// ────────────────────────────────────────────────────────────────────────
const SPEED_FEEL_SHAKE_THRESHOLD    = 0.50; // speedRatio drempel
const SPEED_FEEL_SHAKE_MAX_AMP      = 0.05; // world-units max camera offset
const SPEED_FEEL_SHAKE_NITRO_MUL    = 2.0;  // amplitude × deze factor tijdens nitro
const SPEED_FEEL_SHAKE_FREQ_HZ      = 22;   // sin-wave frequency Hz

// ────────────────────────────────────────────────────────────────────────
// Effect 4 — Speed-lines bij hoog tempo (high-speed fallback bovenop
// bestaande nitro-trigger). updateSpeedLines() in effects/visuals.js
// leest deze waardes — bij ontbreken vallen ze terug op nitro-only
// gedrag via typeof-guard.
// ────────────────────────────────────────────────────────────────────────
const SPEED_FEEL_LINES_THRESHOLD    = 0.78; // visible boven 78% top-speed
const SPEED_FEEL_LINES_MAX_ALPHA    = 0.65; // alpha op 100% top-speed (no nitro)
const SPEED_FEEL_LINES_NITRO_ALPHA  = 1.0;  // alpha tijdens nitro (was hardcoded 1)

// ────────────────────────────────────────────────────────────────────────
// State + consumers
// ────────────────────────────────────────────────────────────────────────

// Motion-blur consumer leeft in atmosphere-pass.js — die leest de
// constants hierboven direct (typeof-guard). Geen eigen tick nodig.

// Speed-shake — sub-frame frequency via sin op _nowSec + per-frame random
// component voor natural jitter. Aangeroepen door camera.js (chase-cam
// block) NA camera.lookAt. Mutates camera.position direct.
function applySpeedFeelShake(camera, car){
  if(!camera || !car || !car.def) return;
  const gs = (typeof gameState !== 'undefined') ? gameState : '';
  if(gs !== 'RACE') return;
  const speedR = Math.abs(car.speed) / (car.def.topSpd || 1.8);
  if(speedR <= SPEED_FEEL_SHAKE_THRESHOLD) return;
  const i = (speedR - SPEED_FEEL_SHAKE_THRESHOLD) / Math.max(0.001, 1 - SPEED_FEEL_SHAKE_THRESHOLD);
  const nitroOn = (typeof nitroActive !== 'undefined' && nitroActive);
  const amp = SPEED_FEEL_SHAKE_MAX_AMP * Math.min(1, i) * (nitroOn ? SPEED_FEEL_SHAKE_NITRO_MUL : 1);
  const tNow = (typeof _nowSec !== 'undefined') ? _nowSec : (performance.now() / 1000);
  const w = tNow * SPEED_FEEL_SHAKE_FREQ_HZ * Math.PI * 2;
  // Drie orthogonale sin-waves op iets verschoven freq voor non-grid feel +
  // kleine random voor natural texture. Y-as 0.5× zodat verticale wiebel
  // niet misselijk wordt.
  camera.position.x += (Math.sin(w)             + (Math.random() - 0.5) * 0.5) * amp;
  camera.position.y += (Math.sin(w * 1.31 + 1.5)+ (Math.random() - 0.5) * 0.3) * amp * 0.5;
  camera.position.z += (Math.sin(w * 1.73 + 3.1)+ (Math.random() - 0.5) * 0.5) * amp;
}

if(typeof window !== 'undefined'){
  window.applySpeedFeelShake = applySpeedFeelShake;
}
