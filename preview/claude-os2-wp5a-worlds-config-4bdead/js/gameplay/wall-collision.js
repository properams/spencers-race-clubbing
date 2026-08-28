// js/gameplay/wall-collision.js — non-module script.
//
// Track-edge soft-wall collision. Player and AI cars driving past the
// asphalt + curb get pushed back toward the track-curve with a velocity
// penalty. No hard stop — feels like firm resistance, not a brick wall.
//
// Wall edge = TW + 4 (= 17u from curve):
//   - TW=13       asphalt edge
//   - 16.15u      curb outer edge (TW + curbWidth*1.5)
//   - 17u         soft-wall (1u past curb so racing-line use of curbs is fine)
//   - 19u         "SAND!" popup threshold (raised from 17u in v3)
//   - 22u         WARN_DIST  (track-limits warning)
//   - 30u         RECOVER_DIST (forced recovery)
//
// Cars are physically blocked at the wall before they ever reach the
// warning/recovery zones — recovery-circle is reserved for actual edge
// cases (jumps, glitches) instead of normal off-track wandering.
//
// Skipped on space/deepsea: those have intentional fall-into-void
// mechanics that own the off-track behavior.
//
// Skipped during recovery and during race-start grace.
//
// Called from core/loop.js once per frame, between checkCollisions and
// checkTrackLimits, so the wall pushes the car BEFORE the limits-checker
// inspects offDist (preventing recovery triggers on what the wall has
// already handled).

'use strict';

// Per-car contact cooldown for FX (sparks + cam-shake). Shared array indexed
// by car index — cars don't move slots between frames so a plain array beats
// a WeakMap allocation per build.
const _wcContactCD = [];
// Scratch Vector3 for trackCurve.getPoint. Catmull-Rom getPoint(t, target)
// writes into the target instead of allocating a fresh Vector3 per call.
// Without this, 8 cars × 60fps = 480 Vector3 allocs/sec.
const _wcCp = new THREE.Vector3();

function checkWallCollisions(dt){
  if(typeof carObjs==='undefined' || !carObjs.length) return;
  if(typeof trackCurve==='undefined' || !trackCurve) return;
  if(typeof TW==='undefined') return;

  const skipTrackWall = _isVoidWorld(activeWorld);
  if(skipTrackWall) return;

  const wallEdge = TW + 4;       // 17u from curve
  const wallEdge2 = wallEdge * wallEdge;
  // Match the AI movement-stagger pattern from loop.js so push-cadence
  // tracks movement-cadence on mobile (otherwise pushing AI at 60Hz while
  // they only move at 30Hz can cause sticky/oscillating contact feel).
  const isMob = !!window._isMobile;

  for(let ci=0; ci<carObjs.length; ci++){
    const car = carObjs[ci];
    if(!car || !car.mesh) continue;
    if(car.finished || car.inAir) continue;
    if(car._fallingIntoSpace) continue;
    // Skip player during active recovery (tracklimits.js owns the position
    // teleport in that case). AI doesn't have recoverActive so the global
    // check correctly only gates the player.
    if(ci===playerIdx && typeof recoverActive!=='undefined' && recoverActive) continue;
    if(typeof _raceStartGrace!=='undefined' && _raceStartGrace>0) continue;
    // Mobile AI stagger: AI cars are updated every other frame on mobile
    // (loop.js:93). Skip wall-collision on the off-frames so the push doesn't
    // race ahead of the integrator and oscillate.
    if(isMob && ci!==playerIdx && typeof _aiFrameCounter!=='undefined'
        && (_aiFrameCounter+ci)%2!==0) continue;

    const pos = car.mesh.position;
    const t = nearestT(pos, car.progress);
    trackCurve.getPoint(t, _wcCp);
    const dx = pos.x - _wcCp.x, dz = pos.z - _wcCp.z;
    const offDist2 = dx*dx + dz*dz;
    if(offDist2 <= wallEdge2) continue;

    const offDist = Math.sqrt(offDist2);
    // Cap overshoot at 5u/frame so a glitch-teleport doesn't snap the car
    // visibly across the screen in a single frame. Above 5u the wall keeps
    // pushing on subsequent frames until back inside.
    const overshoot = Math.min(offDist - wallEdge, 5);
    // Push direction = -normalised offset (toward curve).
    const nx = -dx / offDist, nz = -dz / offDist;
    // Position push: 0.4 of the overshoot per frame. Cumulative across
    // frames so a car holding "off-track" input is firmly held back.
    pos.x += nx * overshoot * 0.4;
    pos.z += nz * overshoot * 0.4;
    // Velocity penalty: scales with overshoot so light grazes barely slow
    // you, but driving full-tilt into the wall halves your speed quickly.
    // Floor at 0.55 so the car never fully stops from a single frame.
    const brake = Math.max(0.55, 1.0 - overshoot * 0.06);
    car.speed *= brake;

    // FX (player only): cooldown-gated impact burst + continuous scrape stream.
    if(ci===playerIdx){
      const cd = _wcContactCD[ci] || 0;
      if(cd <= 0 && overshoot > 0.15){
        // Initial impact: bigger burst + cam-shake. 12 particles geeft een
        // overtuigender "schil-tegen-wall" pop dan de eerdere 6.
        _wcContactCD[ci] = 0.35;
        if(typeof sparkSystem!=='undefined' && sparkSystem.emit){
          sparkSystem.emit(pos.x, 0.4, pos.z,
            nx*0.06, 0.04+Math.random()*0.04, nz*0.06,
            12, 1, 0.7, 0.35, 0.45);
        }
        if(typeof camShake!=='undefined' && camShake < 0.16) camShake = 0.16;
      }
      // Phase R2.6 — continue scrape: zolang de auto in contact blijft met
      // de wall (overshoot>0.05) en speed>0.35 emit 1 particle per ~85%
      // van de frames. Dragging spark-trail levert het "schuren" gevoel
      // dat de eerdere 1-shot burst miste. Parkeren tegen wall (speed<0.35)
      // geeft geen sparks.
      if(overshoot > 0.05 && Math.abs(car.speed) > 0.35 && Math.random() < 0.85){
        if(typeof sparkSystem!=='undefined' && sparkSystem.emit){
          const sx = (Math.random()-.5)*0.06 + nx*0.02;
          const sz = (Math.random()-.5)*0.06 + nz*0.02;
          sparkSystem.emit(pos.x, 0.35+Math.random()*0.18, pos.z,
            sx, 0.025+Math.random()*0.03, sz,
            1, 1.0, 0.65+Math.random()*0.25, 0.20+Math.random()*0.20, 0.32);
        }
      }
    }
  }
  // Decay all cooldowns
  for(let i=0; i<_wcContactCD.length; i++){
    if(_wcContactCD[i]) _wcContactCD[i] = Math.max(0, _wcContactCD[i] - dt);
  }
}
