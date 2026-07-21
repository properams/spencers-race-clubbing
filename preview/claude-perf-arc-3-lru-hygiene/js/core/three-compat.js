// js/core/three-compat.js — Three.js cross-revision compat-laag.
// Non-module script. Geladen vóór alle andere subsystemen die THREE gebruiken
// (na core/debug.js, vóór core/renderer.js).
//
// PROBLEEMSTELLING (van fase 5 rollback in commit 2989b1f):
//   Upgrade r134 → r160 maakte de scene donker / camera uit-gezoomd / pause
//   overlay brak. Geen gestructureerde logging beschikbaar → root cause niet
//   te isoleren. Rollback was de enige optie.
//
// AANPAK:
//   Deze module bevat helpers die op zowel r134 als r150+ correct werken.
//   Op r134 is alle gedrag IDENTIEK (no-ops behalve outputEncoding-binding).
//   Op r150+ activeren de shims:
//     - outputColorSpace ipv deprecated/removed outputEncoding
//     - useLegacyLights=true (r155 maakte fysiek-correcte verlichting default
//       zonder unit-conversie → bestaande intensity-waarden zijn factor 4-10
//       te donker met physicallyCorrectLights)
//     - ColorManagement.enabled=false (r152 default true → texture-kleuren
//       schuiven; uit zetten geeft pixel-exact output zoals r134)
//
// USAGE:
//   In core/renderer.js, vervang:
//     renderer.outputEncoding=THREE.sRGBEncoding;
//   door:
//     ThreeCompat.applyRendererColorSpace(renderer);
//
// MIGRATION-CHECKLIST bij echte r160-upgrade (niet in deze commit):
//   1. Vervang inline three.js minified-blok in index.html (regels 325-…)
//      met r160-build. Update ook line range comment in deze file.
//   2. Test op http(s):// (niet file://) — sommige r150+ features eisen CORS.
//   3. Activeer dbg-harness (localStorage src_debug='1') vóór herlaad.
//   4. Verifieer in console: "[boot] start", "[renderer] init done — THREE 160".
//   5. Verifieer: "[scene] buildScene done — world=space objects=N".
//   6. Visueel: lighting-intensiteit identiek aan r134 baseline (vergelijk
//      screenshot van titel-scene). Als donkerder → useLegacyLights wordt
//      niet toegepast; check ThreeCompat.appliedFlags.
//   7. Test pause-overlay (Space/P/Esc tijdens race) — fase 5 brak hier.
//   8. Test camera-zoom op title screen — fase 5 brak hier.
//   9. InstancedMesh-paths in worlds/{arctic,volcano}.js gebruiken
//      .setMatrixAt() + instanceMatrix.needsUpdate — API ongewijzigd in r160.
//      InstancedMesh-conversie van environment trees (commit f77546c, ge-
//      reverted) kan apart heroverwogen worden zodra base-upgrade stabiel is.

'use strict';

(function(){
  // ── Versie-detectie ──────────────────────────────────────────────────
  // Drie pittfalls afgedekt:
  //   - REVISION ontbreekt (zou nooit moeten, maar we crashen niet).
  //   - REVISION als string ('134', '160').
  //   - REVISION met suffix ('159dev').
  let revNum = 0;
  try {
    const r = (typeof THREE !== 'undefined') ? THREE.REVISION : null;
    revNum = parseInt(String(r||'').match(/\d+/)?.[0] || '0', 10);
  } catch (_) { /* noop */ }

  const isR150Plus = revNum >= 150;  // outputColorSpace / ColorManagement default-on
  const isR155Plus = revNum >= 155;  // useLegacyLights default flip

  const appliedFlags = {
    revision: revNum || '(unknown)',
    colorSpaceApi: isR150Plus ? 'outputColorSpace' : 'outputEncoding',
    colorManagementForced: false,
    legacyLightsForced: false,
  };

  // ── Globale color-management shim ────────────────────────────────────
  // r152+ zet THREE.ColorManagement.enabled=true als default. Dat verandert
  // hoe textures gesampled worden en hoe materials kleuren mengen. Voor
  // pixel-exacte output zoals r134 zetten we 'm uit. Bij echte
  // visuele asset-redesign (en bewuste keuze voor color-managed pipeline)
  // kun je deze regel weghalen.
  if (isR150Plus && typeof THREE !== 'undefined' && THREE.ColorManagement) {
    try {
      THREE.ColorManagement.enabled = false;
      appliedFlags.colorManagementForced = true;
    } catch (_) { /* noop */ }
  }

  // ── Renderer color-space helper (vervangt outputEncoding in 3 sites) ─
  // Op r134:    renderer.outputEncoding = sRGBEncoding (oud gedrag).
  // Op r150+:   renderer.outputColorSpace = SRGBColorSpace.
  function applyRendererColorSpace(renderer) {
    if (!renderer || typeof THREE === 'undefined') return;
    if (isR150Plus && THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if (THREE.sRGBEncoding !== undefined) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
    // useLegacyLights: r155+ default-flip. Lighting in deze codebase is
    // afgesteld op pre-r155 unit-loze formules. Forceren naar legacy zodat
    // sunLight.intensity=1.65 etc. dezelfde helderheid blijft geven.
    if (isR155Plus && 'useLegacyLights' in renderer) {
      try {
        renderer.useLegacyLights = true;
        appliedFlags.legacyLightsForced = true;
      } catch (_) { /* property kan in r158+ removed zijn */ }
    }
  }

  // ── Texture color-space helper (voor toekomstig texture-loading) ─────
  // Op r134:  texture.encoding = sRGBEncoding.
  // Op r150+: texture.colorSpace = SRGBColorSpace.
  // Niet (nog) gebruikt — geen texture.encoding calls in huidige code —
  // maar staat klaar voor wanneer assets met diffuse-maps worden ingeladen.
  function applyTextureColorSpace(texture) {
    if (!texture || typeof THREE === 'undefined') return;
    if (isR150Plus && THREE.SRGBColorSpace) {
      texture.colorSpace = THREE.SRGBColorSpace;
    } else if (THREE.sRGBEncoding !== undefined) {
      texture.encoding = THREE.sRGBEncoding;
    }
  }

  // ── BufferGeometryUtils.mergeBufferGeometries polyfill ──────────────
  // r160's official BufferGeometryUtils lives in three/addons (not in the
  // bundled core blob this codebase uses). Sandstorm's procedural prop
  // builders need mergeBufferGeometries to flatten multi-shape camel /
  // marker / cactus / bones prototypes into single InstancedMesh-friendly
  // BufferGeometries. This shim implements the subset of behaviour those
  // call sites rely on:
  //   - position / normal / uv / color attributes (Float32Array)
  //   - indexed and non-indexed inputs (consistent across input list)
  //   - returns null with dbg.warn on attribute-mismatch instead of
  //     throwing — preserves the spec'd "fail soft" contract callers
  //     already coded against
  // Skips: useGroups support, morphTargets, BufferGeometry instances with
  // exotic typed arrays (Uint8 color, etc). Logs a dbg.warn if encountered.
  if (typeof THREE !== 'undefined') {
    THREE.BufferGeometryUtils = THREE.BufferGeometryUtils || {};
    if (typeof THREE.BufferGeometryUtils.mergeBufferGeometries !== 'function') {
      THREE.BufferGeometryUtils.mergeBufferGeometries = function(geos) {
        if (!Array.isArray(geos) || geos.length === 0) return null;
        const ref = geos[0];
        if (!ref || !ref.attributes) {
          if (window.dbg) dbg.warn('three-compat', 'mergeBufferGeometries: input[0] is not a BufferGeometry');
          return null;
        }
        // Index-mode normalisation. If any input is non-indexed (eg.
        // ExtrudeGeometry, which is non-indexed in r160) and others are
        // indexed (Sphere/Cylinder/Box), output must be non-indexed.
        // Promote indexed inputs to non-indexed via .toNonIndexed() so the
        // merge succeeds — the official addon does the same. We track the
        // promoted clones in `tempGeos` so we can dispose them at the end.
        let allIndexed = true, anyIndexed = false;
        for (let i = 0; i < geos.length; i++) {
          const g = geos[i];
          if (!g || !g.attributes) {
            if (window.dbg) dbg.warn('three-compat', 'mergeBufferGeometries: input['+i+'] missing .attributes');
            return null;
          }
          const gIndexed = g.index !== null && g.index !== undefined;
          if (gIndexed) anyIndexed = true; else allIndexed = false;
        }
        const isIndexed = allIndexed;
        const tempGeos = [];
        const work = new Array(geos.length);
        for (let i = 0; i < geos.length; i++) {
          const g = geos[i];
          const gIndexed = g.index !== null && g.index !== undefined;
          if (!isIndexed && gIndexed) {
            const ni = g.toNonIndexed();
            tempGeos.push(ni);
            work[i] = ni;
          } else {
            work[i] = g;
          }
        }
        const refW = work[0];
        const attrNames = Object.keys(refW.attributes);
        // Validate attribute consistency across all (post-promotion) inputs.
        for (let i = 1; i < work.length; i++) {
          const g = work[i];
          const gKeys = Object.keys(g.attributes);
          if (gKeys.length !== attrNames.length) {
            if (window.dbg) dbg.warn('three-compat', 'mergeBufferGeometries: attribute-count mismatch at input['+i+'] ('+gKeys.length+' vs '+attrNames.length+')');
            for (let t = 0; t < tempGeos.length; t++) tempGeos[t].dispose();
            return null;
          }
          for (let n = 0; n < attrNames.length; n++) {
            const name = attrNames[n];
            if (!g.attributes[name]) {
              if (window.dbg) dbg.warn('three-compat', 'mergeBufferGeometries: attribute "'+name+'" missing at input['+i+']');
              for (let t = 0; t < tempGeos.length; t++) tempGeos[t].dispose();
              return null;
            }
            if (g.attributes[name].itemSize !== refW.attributes[name].itemSize) {
              if (window.dbg) dbg.warn('three-compat', 'mergeBufferGeometries: itemSize mismatch on "'+name+'" at input['+i+']');
              for (let t = 0; t < tempGeos.length; t++) tempGeos[t].dispose();
              return null;
            }
          }
        }
        // Sum vertex + index counts.
        let totalVerts = 0, totalIndices = 0;
        for (let i = 0; i < work.length; i++) {
          totalVerts += work[i].attributes.position.count;
          if (isIndexed) totalIndices += work[i].index.count;
        }
        // Concatenate per-attribute. All sandstorm inputs use Float32Array;
        // log + bail on anything else rather than silently truncating.
        const merged = new THREE.BufferGeometry();
        for (let n = 0; n < attrNames.length; n++) {
          const name = attrNames[n];
          const itemSize = refW.attributes[name].itemSize;
          if (!(refW.attributes[name].array instanceof Float32Array)) {
            if (window.dbg) dbg.warn('three-compat', 'mergeBufferGeometries: non-Float32Array attribute "'+name+'" not supported by polyfill');
            for (let t = 0; t < tempGeos.length; t++) tempGeos[t].dispose();
            return null;
          }
          const out = new Float32Array(totalVerts * itemSize);
          let off = 0;
          for (let i = 0; i < work.length; i++) {
            const src = work[i].attributes[name].array;
            out.set(src, off);
            off += src.length;
          }
          merged.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
        }
        if (isIndexed) {
          // Use Uint32Array to be safe for >65k vertices; r160 BufferGeometry
          // accepts it without further configuration.
          const idx = new Uint32Array(totalIndices);
          let idxOff = 0, vertOff = 0;
          for (let i = 0; i < work.length; i++) {
            const src = work[i].index.array;
            for (let k = 0; k < src.length; k++) idx[idxOff + k] = src[k] + vertOff;
            idxOff += src.length;
            vertOff += work[i].attributes.position.count;
          }
          merged.setIndex(new THREE.BufferAttribute(idx, 1));
        }
        // Dispose temporary toNonIndexed clones — caller still owns the
        // original inputs.
        for (let t = 0; t < tempGeos.length; t++) tempGeos[t].dispose();
        return merged;
      };
      appliedFlags.bufferGeomUtilsPolyfilled = true;
    }
  }

  window.ThreeCompat = {
    revision: revNum,
    isR150Plus,
    isR155Plus,
    appliedFlags,
    applyRendererColorSpace,
    applyTextureColorSpace,
  };

  if (window.dbg && dbg.enabled) {
    dbg.snapshot('three-compat', 'init', appliedFlags);
  }
})();

// ES module marker.
export {};
