// js/core/shared-materials.js — five duplicated MeshLambertMaterials lifted
// to module scope and reused across worlds. Non-module script, loaded after
// quality-tier.js and before the worlds/ directory.
//
// Audit context: the codebase had 12 instantiations of {color:0xffffff} pure
// white Lambert, 5 of cyan-emissive Lambert across space.js, 4 of light-blue
// translucent Lambert across arctic + deepsea, etc. Each instantiation was
// a separate GPU material handle. Caching the top 5 duplicates eliminates
// ~20 redundant Material objects and a similar number of shader program
// permutations (Three.js compiles a unique program per unique material
// signature, even when configs are byte-identical).
//
// These materials are marked `userData._sharedAsset=true` so disposeScene
// in js/core/scene.js will skip disposing them on world-switch. They live
// for the page lifetime.
//
// IMPORTANT: callers must NOT mutate these materials at runtime — any
// .emissiveIntensity / .opacity / .color tweak would propagate to every
// other consumer in every other world. If a use-case needs a slight
// variant, that callsite keeps its own per-mesh material.

'use strict';

(function(){
  if(typeof THREE === 'undefined' || !THREE.MeshLambertMaterial) return;
  if(window._sharedMat) return;  // idempotent — survives a hot-reload

  // Pure white — generic ambient prop. Candy frosting,
  // pier47 white-flag, guangzhou banner-back.
  const purewhite = new THREE.MeshLambertMaterial({color: 0xffffff});

  // Cyan emissive — space.js gravity-well glow, neon-warning beacons. The
  // 5 audit-flagged sites used emissiveIntensity in 1.5-3.5 range; we pick
  // 2.0 as the median so all sites visually land in the same band when
  // they switch to the shared material. Worlds that need a stronger pulse
  // (warp-tunnel core) keep their own per-mesh material.
  const cyanEmissive = new THREE.MeshLambertMaterial({
    color: 0x00ffff, emissive: 0x00aaff, emissiveIntensity: 2.0
  });

  // Light-blue translucent — arctic ice-shards, deepsea jellyfish bell.
  // opacity 0.85 sits between the audit-flagged 0.75-0.92 sites.
  const iceLightblue = new THREE.MeshLambertMaterial({
    color: 0xaaddff, transparent: true, opacity: 0.85
  });

  // Lava orange — volcano lava-rivers, space.js warp-asteroid heat, bridge
  // safety-rail. emissiveIntensity 1.5 = audit-flagged median.
  const lavaOrange = new THREE.MeshLambertMaterial({
    color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 1.5
  });

  // Fairylight amber — string-light, ferris-wheel
  // spoke accents. emissiveIntensity 0.35 = audit-flagged median (0.3-0.4).
  const fairylightAmber = new THREE.MeshLambertMaterial({
    color: 0xffcc22, emissive: 0xff8800, emissiveIntensity: 0.35
  });

  [purewhite, cyanEmissive, iceLightblue, lavaOrange, fairylightAmber].forEach(m => {
    m.userData = m.userData || {};
    m.userData._sharedAsset = true;
  });

  // Centrale on-demand cache voor shared materialen. Caller geeft een
  // stabiele key + factory; zelfde key → zelfde instance. Resultaten
  // krijgen userData._sharedAsset=true (disposeScene-veilig). MUST NOT
  // door callers gemuteerd worden — kleur/emissive/opacity zijn
  // read-only na creatie. Voor variërende waarden: differentieer de
  // key (bv. 'candy/rainbow#'+colorHex+'#'+opacity). Eén shared
  // emissive-mat blijft veilig onder night.js mutations omdat die
  // een idempotente absolute-waarde assign doet
  // (mat.emissiveIntensity = isDark ? 0.8 : 0.20), niet relatief.
  const _matCache = new Map();
  const _stats = { hits: 0, misses: 0 };
  function getOrCreateMat(key, factory){
    let m = _matCache.get(key);
    if(m){
      _stats.hits++;
      return m;
    }
    _stats.misses++;
    m = factory();
    if(m){
      m.userData = m.userData || {};
      m.userData._sharedAsset = true;
      _matCache.set(key, m);
    }
    return m;
  }

  // Observability voor de cache. dumpSharedMatCache() levert eigenaar
  // direct inzicht in (a) hoeveel unieke materials gecached zijn (size),
  // (b) welke wereld-prefixen actief zijn (keys), en (c) hits/misses
  // ratio. Zonder dit is "is sharing actief op cold-start" niet
  // observeerbaar van buiten — dat was sessie 7's diagnose-probleem.
  function dumpSharedMatCache(){
    return {
      size: _matCache.size,
      hits: _stats.hits,
      misses: _stats.misses,
      keys: Array.from(_matCache.keys())
    };
  }

  window._sharedMat = { purewhite, cyanEmissive, iceLightblue, lavaOrange, fairylightAmber, getOrCreate: getOrCreateMat, dump: dumpSharedMatCache };

  if(window.dbg) dbg.log('shared-materials', 'initialised 5 shared Lambert materials + getOrCreate cache + dump helper');
})();

// ES module marker.
export {};
