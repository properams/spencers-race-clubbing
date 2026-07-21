// js/effects/sugar-rush-props.js — Sugar Rush showcase props for the
// graphics-demo. Includes a candy castle with ice-cream-cone spires,
// crystal mountains, giant spiral lollipops, peppermint disks, wrapped-
// candy clusters, gumdrop piles and cotton-candy clouds.
//
// Adapted recipes from the production game (all re-implemented standalone
// to avoid game-globals):
//   - Cake building → candy.js:489
//   - Iceberg + shards → proc-decor.js:268
//   - Lollipop head/stick → proc-decor.js:444
//   - Gumdrop hemisphere → proc-decor.js:631
//   - Wrapped candies → candy.js:229
//   - Cotton candy cluster → candy.js:683
//
// Honors window._isMobile. Honors window.ProcTextures if available.
// Attaches API to window.SugarRushProps.

'use strict';

(function(){

  const _MOBILE = () => !!window._isMobile;
  const _dummy  = new THREE.Object3D();
  const _color  = new THREE.Color();

  function _canvas(w, h){
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // ── Spiral texture ─────────────────────────────────────────────────────
  // Paints a 2D spiral pattern by computing per-pixel polar angle plus a
  // radius-driven twist, then banding into alternating colors. Reads on a
  // 3D sphere as a swirled candy lollipop head.
  function makeSpiralTexture(palette, opts){
    opts = opts || {};
    const S = _MOBILE() ? 128 : 256;
    const twist = opts.twist != null ? opts.twist : 6.0;
    const bands = opts.bands != null ? opts.bands : 8;
    const c = _canvas(S, S);
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const d = img.data;
    const cx = S / 2, cy = S / 2;
    const cols = palette.map(hex => {
      const col = new THREE.Color(hex);
      return [Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255)];
    });
    for(let y = 0; y < S; y++){
      for(let x = 0; x < S; x++){
        const dx = x - cx, dy = y - cy;
        const r  = Math.sqrt(dx*dx + dy*dy) / (S * 0.5);
        const a  = Math.atan2(dy, dx);
        // Twisted angle: rotate further from centre, then band.
        const band = Math.floor(((a / Math.PI + 1.0) * bands * 0.5 + r * twist) % bands);
        const colIdx = ((band % cols.length) + cols.length) % cols.length;
        const col = cols[colIdx];
        const i = (y * S + x) * 4;
        d[i]   = col[0];
        d[i+1] = col[1];
        d[i+2] = col[2];
        d[i+3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  // ── Vertical stripe texture (for castle bodies / spire shafts) ────────
  function makeStripeTexture(colors, opts){
    opts = opts || {};
    const W = _MOBILE() ? 128 : 256;
    const H = _MOBILE() ? 32  : 64;
    const c = _canvas(W, H);
    const g = c.getContext('2d');
    const bands = colors.length * (opts.repeat || 6);
    const bw = W / bands;
    for(let i = 0; i < bands; i++){
      g.fillStyle = '#' + colors[i % colors.length].toString(16).padStart(6, '0');
      g.fillRect(i * bw, 0, bw + 1, H);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // ── Soft pink/cream fondant material ──────────────────────────────────
  function _makeFondantMaterial(baseHex, opts){
    opts = opts || {};
    let map = null;
    if(window.ProcTextures && ProcTextures.frostingGlaze){
      const hex = '#' + baseHex.toString(16).padStart(6, '0');
      map = ProcTextures.frostingGlaze({
        baseColor: hex, sprinkles: false, bumpAlpha: 0.45,
        repeatX: opts.repeatX || 4, repeatY: opts.repeatY || 2,
      });
    }
    return new THREE.MeshPhysicalMaterial({
      color: baseHex, map,
      roughness: opts.roughness != null ? opts.roughness : 0.55,
      metalness: 0.0,
      clearcoat: 0.35, clearcoatRoughness: 0.22,
      emissive: new THREE.Color(baseHex).multiplyScalar(0.10),
      emissiveIntensity: 0.10,
    });
  }

  // ── Candy castle — 3 ice-cream-cone spires + tiered body ──────────────
  // Mid-poly tower modelled after the Sugar Rush reference: wide pink
  // fondant base, narrowing tower, dome, then 3 spiral spires (centre +
  // two sides). Total ~24 meshes.
  function buildCandyCastle(opts){
    opts = opts || {};
    const mobile = _MOBILE();
    const spireSides = mobile ? 8 : 12;
    const group = new THREE.Group();

    // Body tiers (descending radii).
    const tiers = [
      { r: 3.5, h: 1.8, col: 0xff7eb5 },  // base pink
      { r: 2.6, h: 2.6, col: 0xff9ec6 },  // mid lavender-pink
      { r: 1.8, h: 1.2, col: 0xffc4e2 },  // upper roof base
    ];
    let y = 0;
    const tierTops = [];
    tiers.forEach((t, idx) => {
      const mat = _makeFondantMaterial(t.col, { repeatX: 4, repeatY: idx === 1 ? 1 : 2 });
      const tier = new THREE.Mesh(
        new THREE.CylinderGeometry(t.r * 0.95, t.r, t.h, mobile ? 14 : 20),
        mat
      );
      tier.position.y = y + t.h * 0.5;
      tier.castShadow = tier.receiveShadow = true;
      group.add(tier);

      // Drip rim — torus around the top of each tier
      const dripMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.18,
      });
      const drip = new THREE.Mesh(
        new THREE.TorusGeometry(t.r - 0.1, 0.22, 6, mobile ? 16 : 24),
        dripMat
      );
      drip.rotation.x = Math.PI / 2;
      drip.position.y = y + t.h - 0.05;
      drip.castShadow = true;
      group.add(drip);

      tierTops.push({ y: y + t.h, r: t.r });
      y += t.h;
    });

    // Central dome on top of last tier.
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, mobile ? 14 : 20, mobile ? 8 : 12, 0, Math.PI * 2, 0, Math.PI / 2),
      _makeFondantMaterial(0xffd1ea, { repeatX: 2, repeatY: 1 })
    );
    dome.position.y = y;
    dome.castShadow = dome.receiveShadow = true;
    group.add(dome);

    // 3 ice-cream-cone spires: centre (tall) + 2 side (shorter), each with
    // its own spiral palette so the towers visually differ.
    const spirePalettes = [
      [0xff3d8a, 0xffffff],            // centre — pink/white
      [0xff9ec6, 0xffffff, 0xff5c9c],  // left — pink trio
      [0x9c5cff, 0xffffff, 0xff9eff],  // right — purple/lilac
    ];
    const spireSpecs = [
      { x: 0,    z: 0,    h: 5.5, r: 0.55, y: y + 1.2 },  // centre, atop dome
      { x: -2.1, z: 0.4,  h: 4.0, r: 0.42, y: y - 1.0 },  // side, on top tier edge
      { x:  2.1, z: 0.4,  h: 4.0, r: 0.42, y: y - 1.0 },
    ];
    spireSpecs.forEach((s, i) => {
      const tex = makeSpiralTexture(spirePalettes[i], { twist: 9, bands: 10 });
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, 1);
      const mat = new THREE.MeshPhysicalMaterial({
        map: tex, roughness: 0.30, metalness: 0.0,
        clearcoat: 0.7, clearcoatRoughness: 0.12,
      });
      const spire = new THREE.Mesh(
        new THREE.ConeGeometry(s.r, s.h, spireSides, 1),
        mat
      );
      spire.position.set(s.x, s.y + s.h * 0.5, s.z);
      spire.castShadow = spire.receiveShadow = true;
      group.add(spire);

      // White tip ball on top of each spire
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(s.r * 0.55, mobile ? 8 : 12, mobile ? 6 : 8),
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.1,
        })
      );
      tip.position.set(s.x, s.y + s.h + s.r * 0.2, s.z);
      tip.castShadow = true;
      group.add(tip);
    });

    // Crowning gold ball + thin spire on the centre tower (decorative).
    const goldBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 14, 10),
      new THREE.MeshStandardMaterial({
        color: 0xffd76a, metalness: 0.95, roughness: 0.18,
        emissive: 0xffaa44, emissiveIntensity: 0.25,
      })
    );
    const centreSpire = spireSpecs[0];
    goldBall.position.set(centreSpire.x, centreSpire.y + centreSpire.h + 1.2, centreSpire.z);
    goldBall.castShadow = true;
    group.add(goldBall);
    const thinSpire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6),
      new THREE.MeshStandardMaterial({ color: 0xffd76a, metalness: 0.95, roughness: 0.18 })
    );
    thinSpire.position.set(centreSpire.x, centreSpire.y + centreSpire.h + 0.55, centreSpire.z);
    group.add(thinSpire);

    // Front entrance arch — dark plane embedded in the base tier.
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 1.6),
      new THREE.MeshBasicMaterial({ color: 0x3a1228, side: THREE.DoubleSide })
    );
    door.position.set(0, 0.8, tiers[0].r + 0.01);
    group.add(door);
    // Door frame — bright stripe ring
    const frame = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.08, 6, mobile ? 12 : 20, Math.PI),
      new THREE.MeshPhysicalMaterial({ color: 0xff3d8a, clearcoat: 0.5 })
    );
    frame.position.set(0, 1.55, tiers[0].r + 0.02);
    group.add(frame);

    return group;
  }

  // ── Crystal mountain — cyan crystalline cone + cap + shards ───────────
  function buildCrystalMountain(opts){
    opts = opts || {};
    const mobile = _MOBILE();
    const sides  = opts.sides   || (mobile ? 5 : 7);
    const height = opts.height  || 9;
    const radius = opts.radius  || 4;
    const includeShards = opts.shards !== false;
    const shardCount = mobile ? 1 : (opts.shardCount || 3);
    const group = new THREE.Group();

    // Body: cone with vertex-color crystalline facets.
    const bodyG = new THREE.ConeGeometry(radius, height, sides, 1);
    bodyG.computeVertexNormals();
    // Per-vertex color: alternate cyan/lighter-cyan/white per facet.
    const pos = bodyG.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const palette = [
      [0.45, 0.78, 0.92],
      [0.62, 0.88, 0.98],
      [0.82, 0.95, 1.0],
    ];
    // Cone has (sides * 2) tris + sides cap tris; vertices are arranged per
    // segment in the way ConeGeometry builds them. We approximate by hashing
    // vertex x+z position into a facet index.
    for(let i = 0; i < pos.count; i++){
      const x = pos.getX(i), z = pos.getZ(i);
      const phi = Math.atan2(z, x);
      const facet = Math.floor(((phi / Math.PI + 1) * 0.5) * sides) % sides;
      const c = palette[facet % palette.length];
      col[i*3]   = c[0];
      col[i*3+1] = c[1];
      col[i*3+2] = c[2];
    }
    bodyG.setAttribute('color', new THREE.BufferAttribute(col, 3));

    // Material with ice-surface map + subtle cyan emissive glow.
    let iceMap = null, iceNrm = null;
    if(window.ProcTextures && ProcTextures.iceSurface){
      iceMap = ProcTextures.iceSurface({
        baseColor: '#ccecf8', crackCount: 24, sparkle: 0.7,
        repeatX: 2, repeatY: 3,
      });
      if(ProcTextures.deriveNormalMap){
        iceNrm = ProcTextures.deriveNormalMap(iceMap, { strength: 1.0 });
        if(iceNrm) iceNrm.repeat.set(2, 3);
      }
    }
    const bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true, map: iceMap, normalMap: iceNrm,
      color: 0xffffff,
      roughness: 0.30, metalness: 0.15,
      emissive: 0x1a4a6a, emissiveIntensity: 0.20,
      flatShading: false,
    });
    const body = new THREE.Mesh(bodyG, bodyMat);
    body.castShadow = body.receiveShadow = true;
    group.add(body);

    // Snow cap on top — small wider cone.
    const capH = height * 0.22;
    const capR = radius * 0.55;
    const capG = new THREE.ConeGeometry(capR, capH, Math.max(5, sides - 1), 1);
    const capMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.7, metalness: 0.0,
      emissive: 0x223040, emissiveIntensity: 0.08,
    });
    const cap = new THREE.Mesh(capG, capMat);
    cap.position.y = height * 0.42;
    cap.castShadow = cap.receiveShadow = true;
    group.add(cap);

    // Shards at base.
    if(includeShards && shardCount > 0){
      const shardMat = new THREE.MeshStandardMaterial({
        color: 0xb6e3f4, transparent: true, opacity: 0.85,
        roughness: 0.18, metalness: 0.25,
        emissive: 0x1a4a6a, emissiveIntensity: 0.30,
      });
      for(let k = 0; k < shardCount; k++){
        const ang = (k / shardCount) * Math.PI * 2 + Math.random() * 0.3;
        const off = radius * (0.85 + Math.random() * 0.2);
        const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.6 + Math.random() * 0.4, 0), shardMat);
        s.position.set(Math.cos(ang) * off, (height * 0.05) + Math.random() * 0.3, Math.sin(ang) * off);
        s.scale.set(
          0.6 + Math.random() * 0.3,
          1.2 + Math.random() * 0.6,
          0.6 + Math.random() * 0.3
        );
        s.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.3);
        s.castShadow = true;
        group.add(s);
      }
    }

    return group;
  }

  // ── Giant spiral lollipop ─────────────────────────────────────────────
  // Stick + spiral-textured head. Caller picks palette so we can render
  // visually distinct lollipops side-by-side.
  function buildGiantLollipop(x, z, opts){
    opts = opts || {};
    const mobile  = _MOBILE();
    const palette = opts.palette || [0xff3d8a, 0xffffff];
    const height  = opts.height || 4.5;
    const headR   = opts.headRadius || 1.3;
    const rot     = opts.rot != null ? opts.rot : Math.random() * Math.PI;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rot;

    // Stick — slightly tapered, slightly cream-coloured.
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.18, height, mobile ? 7 : 10),
      new THREE.MeshStandardMaterial({ color: 0xf5e0c8, roughness: 0.65, metalness: 0.02 })
    );
    stick.position.y = height * 0.5;
    stick.castShadow = stick.receiveShadow = true;
    group.add(stick);

    // Spiral head — sphere with spiral texture.
    const headTex = makeSpiralTexture(palette, {
      twist: opts.twist != null ? opts.twist : 7,
      bands: opts.bands != null ? opts.bands : 12,
    });
    const headMat = new THREE.MeshPhysicalMaterial({
      map: headTex,
      roughness: 0.17, metalness: 0.0,
      clearcoat: 0.85, clearcoatRoughness: 0.06,
      emissive: 0x111111, emissiveIntensity: 0.10,
    });
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(headR, mobile ? 16 : 24, mobile ? 12 : 18),
      headMat
    );
    head.position.y = height + headR * 0.85;
    head.castShadow = head.receiveShadow = true;
    group.add(head);

    // Centre stripe ring under head — thin white torus where stick meets head.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(headR * 0.65, 0.06, 4, mobile ? 12 : 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = head.position.y - headR * 0.85;
    group.add(ring);

    return group;
  }

  // ── Peppermint disk — flat round candy with painted red swirl ─────────
  function makePeppermintTexture(){
    const S = _MOBILE() ? 128 : 256;
    const c = _canvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, S, S);
    // Red radial sectors (6 wedges)
    g.fillStyle = '#e2204b';
    const cx = S / 2, cy = S / 2, R = S / 2 - 4;
    for(let i = 0; i < 6; i++){
      const a0 = (i / 6) * Math.PI * 2;
      const a1 = a0 + Math.PI / 6;
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, R, a0, a1);
      g.closePath();
      g.fill();
    }
    // Centre disc
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(cx, cy, R * 0.25, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e2204b';
    g.beginPath(); g.arc(cx, cy, R * 0.15, 0, Math.PI * 2); g.fill();
    // Outer ring
    g.strokeStyle = '#e2204b';
    g.lineWidth = 4;
    g.beginPath(); g.arc(cx, cy, R - 2, 0, Math.PI * 2); g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  let _peppermintTexCache = null;
  function _getPeppermintTex(){
    if(!_peppermintTexCache) _peppermintTexCache = makePeppermintTexture();
    return _peppermintTexCache;
  }

  function buildPeppermintDisk(x, z, opts){
    opts = opts || {};
    const r = opts.radius || (0.4 + Math.random() * 0.25);
    const tex = _getPeppermintTex();
    const sideMat = new THREE.MeshPhysicalMaterial({
      color: 0xe2204b, roughness: 0.25, clearcoat: 0.6,
    });
    const faceMat = new THREE.MeshPhysicalMaterial({
      map: tex, roughness: 0.17, clearcoat: 0.85, clearcoatRoughness: 0.08,
    });
    // CylinderGeometry has 3 materials: side, top, bottom.
    const g = new THREE.CylinderGeometry(r, r, 0.12, 24);
    const mesh = new THREE.Mesh(g, [sideMat, faceMat, faceMat]);
    mesh.position.set(x, 0.06 + (opts.y || 0), z);
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.rotation.z = (Math.random() - 0.5) * 0.2;  // tipped slightly
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  // ── Wrapped-candy cluster — InstancedMesh ellipsoids + twist ends ─────
  function buildWrappedCandyCluster(positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return new THREE.Group();
    const mobile = _MOBILE();
    const group = new THREE.Group();

    const palette = opts.palette || [0xff5577, 0xffaa44, 0x44bbff, 0xaaee44, 0xcc66ff];

    // Body: elongated ellipsoid via scaled sphere.
    const bodyG = new THREE.SphereGeometry(0.35, mobile ? 10 : 14, mobile ? 8 : 10);
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.30, clearcoat: 0.7, clearcoatRoughness: 0.15,
    });
    const bodyIM = new THREE.InstancedMesh(bodyG, bodyMat, N);
    bodyIM.castShadow = bodyIM.receiveShadow = true;

    // Twist-end cones — two per candy.
    const twistG = new THREE.ConeGeometry(0.18, 0.36, mobile ? 6 : 8, 1);
    twistG.translate(0, 0.18, 0);
    const twistMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.45,
      transparent: true, opacity: 0.95,
    });
    const twistAIM = new THREE.InstancedMesh(twistG, twistMat, N);
    const twistBIM = new THREE.InstancedMesh(twistG, twistMat, N);
    twistAIM.castShadow = twistBIM.castShadow = true;

    const cBuf = new Float32Array(N * 3);
    for(let i = 0; i < N; i++){
      const p = positions[i];
      const rot = p.rot != null ? p.rot : Math.random() * Math.PI;
      // Body — scaled X for elongation
      _dummy.position.set(p.x, 0.30, p.z);
      _dummy.rotation.set(0, rot, 0);
      _dummy.scale.set(1.6, 1.0, 1.0);
      _dummy.updateMatrix();
      bodyIM.setMatrixAt(i, _dummy.matrix);

      // Twist A — pointing +X relative to candy
      _dummy.position.set(p.x + Math.cos(rot) * 0.50, 0.30, p.z + Math.sin(rot) * 0.50);
      _dummy.rotation.set(0, rot, Math.PI / 2);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      twistAIM.setMatrixAt(i, _dummy.matrix);

      // Twist B — pointing -X
      _dummy.position.set(p.x - Math.cos(rot) * 0.50, 0.30, p.z - Math.sin(rot) * 0.50);
      _dummy.rotation.set(0, rot, -Math.PI / 2);
      _dummy.updateMatrix();
      twistBIM.setMatrixAt(i, _dummy.matrix);

      // Color
      _color.setHex(palette[i % palette.length]);
      cBuf[i*3]   = _color.r;
      cBuf[i*3+1] = _color.g;
      cBuf[i*3+2] = _color.b;
    }
    bodyIM.instanceColor = new THREE.InstancedBufferAttribute(cBuf, 3);
    bodyIM.instanceColor.needsUpdate = true;
    bodyIM.instanceMatrix.needsUpdate = true;
    twistAIM.instanceMatrix.needsUpdate = true;
    twistBIM.instanceMatrix.needsUpdate = true;

    group.add(bodyIM); group.add(twistAIM); group.add(twistBIM);
    return group;
  }

  // ── Gumdrop pile — hemisphere body + flat cap + sparkle, InstancedMesh ─
  function buildGumdropPile(positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return new THREE.Group();
    const mobile = _MOBILE();
    const palette = opts.palette || [0xff4488, 0xffcc00, 0x44ddaa, 0x88aaff, 0xff6622, 0xcc44ff];
    const group = new THREE.Group();

    const bodyG = new THREE.SphereGeometry(1, mobile ? 10 : 14, mobile ? 6 : 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, transparent: true, opacity: 0.92,
      roughness: 0.25, clearcoat: 0.75, clearcoatRoughness: 0.10,
    });
    const capG = new THREE.CircleGeometry(1, mobile ? 10 : 14);
    capG.rotateX(-Math.PI / 2);
    const capMat = bodyMat;  // shared

    const sparkleG = new THREE.SphereGeometry(0.15, 5, 5);
    const sparkleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85,
    });

    const bodyIM    = new THREE.InstancedMesh(bodyG, bodyMat, N);
    const capIM     = new THREE.InstancedMesh(capG, capMat, N);
    const sparkleIM = new THREE.InstancedMesh(sparkleG, sparkleMat, N);
    bodyIM.castShadow = bodyIM.receiveShadow = true;

    const cBuf = new Float32Array(N * 3);
    for(let i = 0; i < N; i++){
      const p = positions[i];
      const r = p.radius || (1.2 + Math.random() * 0.8);
      const h = p.height || (1.6 + Math.random() * 0.8);
      _dummy.position.set(p.x, 0, p.z);
      _dummy.rotation.set(0, p.rot || Math.random() * Math.PI, 0);
      _dummy.scale.set(r, h, r);
      _dummy.updateMatrix();
      bodyIM.setMatrixAt(i, _dummy.matrix);
      _dummy.position.set(p.x, 0.02, p.z);
      _dummy.scale.set(r, 1, r);
      _dummy.updateMatrix();
      capIM.setMatrixAt(i, _dummy.matrix);
      _dummy.position.set(p.x, h + 0.2, p.z);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      sparkleIM.setMatrixAt(i, _dummy.matrix);

      _color.setHex(palette[i % palette.length]);
      cBuf[i*3] = _color.r; cBuf[i*3+1] = _color.g; cBuf[i*3+2] = _color.b;
    }
    const sharedColor = new THREE.InstancedBufferAttribute(cBuf, 3);
    sharedColor.needsUpdate = true;
    bodyIM.instanceColor = sharedColor;
    capIM.instanceColor  = sharedColor;
    [bodyIM, capIM, sparkleIM].forEach(m => {
      m.instanceMatrix.needsUpdate = true;
      group.add(m);
    });
    return group;
  }

  // Cotton candy cloud builder — removed in mobile-perf fase 2 (PR #300).
  // Single caller (candy.js:buildCottonCandyClouds) now builds 5 batched
  // InstancedMesh inline (één per palette-kleur) i.p.v. een Group van
  // 4-7 individuele transparent sphere Meshes per cluster.

  // ── Grass tufts — instanced flat green blobs scattered on grass ────────
  function buildGrassTufts(positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return new THREE.Group();
    const mobile = _MOBILE();
    const palette = opts.palette || [0x66cc77, 0x88dd88, 0x55bb66, 0x99e6a0];

    // Low-poly icosahedron with vertex-jitter for organic blob shape.
    const g = new THREE.IcosahedronGeometry(0.30, 0);
    const pos = g.attributes.position;
    for(let i = 0; i < pos.count; i++){
      pos.setX(i, pos.getX(i) + (Math.random()-0.5) * 0.08);
      pos.setY(i, pos.getY(i) + (Math.random()-0.5) * 0.03);
      pos.setZ(i, pos.getZ(i) + (Math.random()-0.5) * 0.08);
    }
    g.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff, flatShading: true,
    });
    const im = new THREE.InstancedMesh(g, mat, N);
    im.castShadow = false;
    im.receiveShadow = !mobile;

    const cBuf = new Float32Array(N * 3);
    for(let i = 0; i < N; i++){
      const p = positions[i];
      const sx = 1.0 + Math.random() * 0.8;
      const sz = 1.0 + Math.random() * 0.8;
      _dummy.position.set(p.x, 0.10, p.z);
      _dummy.rotation.set(0, p.rot != null ? p.rot : Math.random() * Math.PI, 0);
      _dummy.scale.set(sx * 1.4, 0.30, sz * 1.4);  // flatten Y, widen XZ
      _dummy.updateMatrix();
      im.setMatrixAt(i, _dummy.matrix);
      _color.setHex(palette[i % palette.length]);
      cBuf[i*3]   = _color.r;
      cBuf[i*3+1] = _color.g;
      cBuf[i*3+2] = _color.b;
    }
    im.instanceColor = new THREE.InstancedBufferAttribute(cBuf, 3);
    im.instanceColor.needsUpdate = true;
    im.instanceMatrix.needsUpdate = true;

    const grp = new THREE.Group();
    grp.add(im);
    return grp;
  }

  // ── Candy twilight sky — deep purple gradient + pink horizon glow ─────
  // Adapts the winter-foliage starry-night recipe to a Sugar Rush palette
  // (zenith deep purple, mid violet, horizon warm pink) so the candy world
  // gets a twilight feel that matches the in-game reference screenshot.
  function buildCandyTwilightSky(opts){
    opts = opts || {};
    const mobile = _MOBILE();
    const radius = opts.radius || 350;

    const skyGeo = new THREE.SphereGeometry(radius, mobile ? 24 : 32, mobile ? 12 : 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith:  { value: new THREE.Color(0x1a0d3a) },
        mid:     { value: new THREE.Color(0x3a2860) },
        horizon: { value: new THREE.Color(0xaa4488) },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main(){
          vWorld = (modelMatrix * vec4(position,1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }`,
      fragmentShader: `
        varying vec3 vWorld;
        uniform vec3 zenith, mid, horizon;
        void main(){
          float h = clamp(normalize(vWorld).y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col;
          if(h > 0.6){
            col = mix(mid, zenith, smoothstep(0.6, 1.0, h));
          } else {
            col = mix(horizon, mid, smoothstep(0.3, 0.6, h));
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1;

    // Rose-tinted stars on the upper hemisphere.
    const starCount = mobile ? 100 : 200;
    const sGeo = new THREE.BufferGeometry();
    const sPos = new Float32Array(starCount * 3);
    const sCol = new Float32Array(starCount * 3);
    for(let i = 0; i < starCount; i++){
      const theta = Math.random() * Math.PI * 2;
      const y     = Math.random() * 0.7 + 0.10;
      const r     = Math.sqrt(1 - y*y);
      const rr    = radius * 0.95;
      sPos[i*3]   = Math.cos(theta) * r * rr;
      sPos[i*3+1] = y * rr;
      sPos[i*3+2] = Math.sin(theta) * r * rr;
      const tint = 0.7 + Math.random() * 0.3;
      sCol[i*3]   = tint;                              // R
      sCol[i*3+1] = tint * (0.75 + Math.random()*0.2); // G (rose tint)
      sCol[i*3+2] = tint * (0.85 + Math.random()*0.15);// B
    }
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    sGeo.setAttribute('color',    new THREE.BufferAttribute(sCol, 3));
    let starMap = null;
    if(window.WinterFoliage && WinterFoliage.makeStarTexture){
      starMap = WinterFoliage.makeStarTexture();
    }
    const starMat = new THREE.PointsMaterial({
      size: 1.2, sizeAttenuation: true, transparent: true,
      depthWrite: false, vertexColors: true, map: starMap,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const stars = new THREE.Points(sGeo, starMat);

    return { sky, stars };
  }

  // ── Peppermint scatter — InstancedMesh single-material edition ─────────
  // Replaces calling buildPeppermintDisk N times (which would issue 3 draws
  // per disk via multi-material). Single MeshPhysicalMaterial — the swirl
  // texture wraps around the cylinder side too, reading as candy stripes.
  // ONE draw call for the whole scatter.
  function buildPeppermintScatter(positions, opts){
    opts = opts || {};
    const N = positions.length;
    if(N === 0) return new THREE.Group();
    const mobile = _MOBILE();

    const tex = _getPeppermintTex();
    const g = new THREE.CylinderGeometry(0.5, 0.5, 0.12, mobile ? 14 : 20);
    const mat = new THREE.MeshPhysicalMaterial({
      map: tex,
      roughness: 0.18, metalness: 0.0,
      clearcoat: 0.85, clearcoatRoughness: 0.08,
      emissive: 0x331122, emissiveIntensity: 0.06,
    });
    const im = new THREE.InstancedMesh(g, mat, N);
    im.castShadow = im.receiveShadow = true;

    for(let i = 0; i < N; i++){
      const p = positions[i];
      const s = p.scale != null ? p.scale : (0.7 + Math.random() * 0.6);
      _dummy.position.set(p.x, 0.07 + (p.y || 0), p.z);
      _dummy.rotation.set(
        (p.tiltX != null ? p.tiltX : (Math.random() - 0.5) * 0.25),
        p.rot != null ? p.rot : Math.random() * Math.PI,
        (p.tiltZ != null ? p.tiltZ : (Math.random() - 0.5) * 0.25)
      );
      _dummy.scale.set(s, 1, s);
      _dummy.updateMatrix();
      im.setMatrixAt(i, _dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;

    const grp = new THREE.Group();
    grp.add(im);
    return grp;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  window.SugarRushProps = {
    makeSpiralTexture,
    makeStripeTexture,
    makePeppermintTexture,
    buildCandyCastle,
    buildCrystalMountain,
    buildGiantLollipop,
    buildPeppermintDisk,
    buildPeppermintScatter,
    buildWrappedCandyCluster,
    buildGumdropPile,
    buildGrassTufts,
    buildCandyTwilightSky,
  };

})();
