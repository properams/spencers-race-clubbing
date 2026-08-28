// js/effects/winter-foliage.js — three Christmas-tree variants + a refined
// candy cane + PMREM env-map + starry night, all standalone. Used by
// demo-graphics.html and reusable for a future winter-themed world.
//
// Adapted recipes:
//   - PMREM env: js/core/scene.js:193 _buildProceduralEnvMap
//   - Candy cane: js/effects/proc-decor.js:540 buildCandyCaneBatch
//   - Snow tree: js/effects/proc-decor.js:351 buildSnowTreeBatch
//   - Soft particle sprite: js/effects/particles.js PARTICLE_TEX.cloud
//
// No game globals required. Honors window._isMobile if set, otherwise
// detects on UA. Attaches API to window.WinterFoliage.

'use strict';

(function(){

  // ── Helpers ────────────────────────────────────────────────────────────
  const _MOBILE = () => !!window._isMobile;
  const _dummy  = new THREE.Object3D();
  const _color  = new THREE.Color();
  const _upY    = new THREE.Vector3(0, 1, 0);
  const _outDir = new THREE.Vector3();
  const _qrot   = new THREE.Quaternion();

  function _canvas(w, h){
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // ── PMREM environment map ──────────────────────────────────────────────
  // Vertical gradient sky (deep night → horizon → ground tint) with a soft
  // warm moon hotspot. Output is a PMREM-processed cubemap that drives
  // clearcoat highlights on the baubles + candy canes.
  function buildProceduralEnvMap(renderer){
    const mobile = _MOBILE();
    const W = mobile ? 512 : 1024;
    const H = mobile ? 256 : 512;
    const c = _canvas(W, H);
    const g = c.getContext('2d');

    // Vertical gradient — zenith → horizon → just-below-horizon ground tint.
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0.00, '#050714'); // zenith near-black
    grd.addColorStop(0.40, '#0d1a36'); // upper sky
    grd.addColorStop(0.55, '#1a3060'); // mid sky
    grd.addColorStop(0.62, '#3a4878'); // horizon haze
    grd.addColorStop(0.70, '#2a2a3a'); // just below horizon
    grd.addColorStop(1.00, '#0a0a14'); // ground reflectance
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);

    // Warm moon hotspot — soft radial highlight, drives the bauble glints.
    const mx = W * 0.62, my = H * 0.32, mr = H * 0.30;
    const mg = g.createRadialGradient(mx, my, 0, mx, my, mr);
    mg.addColorStop(0.0,  'rgba(255,235,200,0.9)');
    mg.addColorStop(0.25, 'rgba(255,210,160,0.45)');
    mg.addColorStop(1.0,  'rgba(255,210,160,0)');
    g.fillStyle = mg;
    g.fillRect(0, 0, W, H);

    // Far-side cool fill — colder light on the opposing hemisphere.
    const ox = W * 0.12, oy = H * 0.42, or = H * 0.45;
    const og = g.createRadialGradient(ox, oy, 0, ox, oy, or);
    og.addColorStop(0.0, 'rgba(140,180,255,0.18)');
    og.addColorStop(1.0, 'rgba(140,180,255,0)');
    g.fillStyle = og;
    g.fillRect(0, 0, W, H);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping     = THREE.EquirectangularReflectionMapping;
    tex.colorSpace  = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromEquirectangular(tex);
    pmrem.dispose();
    tex.dispose();
    return envRT.texture;
  }

  // ── Soft circular snowflake sprite ────────────────────────────────────
  function makeSoftSnowflakeTexture(){
    const S = 64;
    const c = _canvas(S, S);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
    grd.addColorStop(0.0, 'rgba(255,255,255,1.0)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.85)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    grd.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Tiny round star sprite — used for the distant twinkles.
  function makeStarTexture(){
    const S = 32;
    const c = _canvas(S, S);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
    grd.addColorStop(0.0, 'rgba(255,255,255,1.0)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    grd.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ── Starry night — sky-dome + stars + moon ────────────────────────────
  function buildStarryNight(opts){
    opts = opts || {};
    const radius = opts.radius || 80;

    // Sky dome: shader-material with vertical gradient and a subtle
    // fbm-noise twinkle band near the zenith.
    const skyGeo = new THREE.SphereGeometry(radius, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        zenith: { value: new THREE.Color(0x050714) },
        mid:    { value: new THREE.Color(0x0d1d3a) },
        horizon:{ value: new THREE.Color(0x1a2848) },
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

    // Stars — static Points cloud at far range.
    const starCount = _MOBILE() ? 300 : 600;
    const sGeo = new THREE.BufferGeometry();
    const sPos = new Float32Array(starCount * 3);
    const sCol = new Float32Array(starCount * 3);
    for(let i = 0; i < starCount; i++){
      // Upper hemisphere only.
      const theta = Math.random() * Math.PI * 2;
      const y     = Math.random() * 0.7 + 0.05;     // 0.05..0.75
      const r     = Math.sqrt(1 - y*y);
      const rr    = radius * 0.95;
      sPos[i*3]   = Math.cos(theta) * r * rr;
      sPos[i*3+1] = y * rr;
      sPos[i*3+2] = Math.sin(theta) * r * rr;
      const tint = 0.6 + Math.random() * 0.4;
      const blue = 0.95 + Math.random() * 0.05;
      sCol[i*3]   = tint;
      sCol[i*3+1] = tint;
      sCol[i*3+2] = Math.min(1.0, tint * blue);
    }
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    sGeo.setAttribute('color',    new THREE.BufferAttribute(sCol, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.45, sizeAttenuation: true, transparent: true,
      depthWrite: false, vertexColors: true, map: makeStarTexture(),
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(sGeo, starMat);

    // Moon — emissive disc with soft halo plane behind it.
    const moonGrp = new THREE.Group();
    const moonGeo = new THREE.CircleGeometry(2.2, 32);
    const moonMat = new THREE.MeshBasicMaterial({
      color: 0xfff0c8, transparent: true, opacity: 0.95,
    });
    const moonDisc = new THREE.Mesh(moonGeo, moonMat);
    moonGrp.add(moonDisc);

    // Halo
    const haloS = 256;
    const hC = _canvas(haloS, haloS);
    const hG = hC.getContext('2d');
    const hg = hG.createRadialGradient(haloS/2, haloS/2, 0, haloS/2, haloS/2, haloS/2);
    hg.addColorStop(0.0,  'rgba(255,240,210,0.85)');
    hg.addColorStop(0.18, 'rgba(255,230,190,0.4)');
    hg.addColorStop(0.5,  'rgba(255,220,180,0.1)');
    hg.addColorStop(1.0,  'rgba(255,220,180,0)');
    hG.fillStyle = hg;
    hG.fillRect(0, 0, haloS, haloS);
    const haloTex = new THREE.CanvasTexture(hC);
    haloTex.colorSpace = THREE.SRGBColorSpace;
    const haloMat = new THREE.MeshBasicMaterial({
      map: haloTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), haloMat);
    halo.position.z = -0.05;
    moonGrp.add(halo);

    // Position moon in sky (matches the warm hotspot in the env map ≈ 62°/32°).
    const mTheta = Math.PI * 0.38;
    const mPhi   = Math.PI * 0.30;
    const mr     = radius * 0.85;
    moonGrp.position.set(
      Math.cos(mTheta) * Math.sin(mPhi) * mr,
      Math.cos(mPhi) * mr,
      Math.sin(mTheta) * Math.sin(mPhi) * mr
    );
    moonGrp.lookAt(0, moonGrp.position.y * 0.5, 0);

    return { sky, stars, moon: moonGrp };
  }

  // ── Bark + bark-normal trunk material (shared across all trees) ───────
  let _trunkMatCache = null;
  function _getTrunkMaterial(){
    if(_trunkMatCache) return _trunkMatCache;
    let map = null, normalMap = null;
    if(window.ProcTextures && ProcTextures.bark){
      map = ProcTextures.bark({ size: _MOBILE() ? 64 : 128, repeatX: 1, repeatY: 2 });
      if(ProcTextures.deriveNormalMap){
        normalMap = ProcTextures.deriveNormalMap(map, { strength: 1.4 });
        if(normalMap){ normalMap.repeat.set(1, 2); }
      }
    }
    _trunkMatCache = new THREE.MeshStandardMaterial({
      color: 0x6b4528, map, normalMap,
      roughness: 0.88, metalness: 0.02,
    });
    return _trunkMatCache;
  }

  // ── Tree #1: stylized stacked cones (refined) ─────────────────────────
  function buildStylizedTree(opts){
    opts = opts || {};
    const mobile = _MOBILE();
    const segs   = mobile ? 22 : 28;
    const group  = new THREE.Group();

    // Trunk
    const trunkH = 1.2;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.42, trunkH, 12),
      _getTrunkMaterial()
    );
    trunk.position.y = trunkH * 0.5;
    trunk.castShadow = trunk.receiveShadow = true;
    group.add(trunk);

    const foliageMat = new THREE.MeshPhysicalMaterial({
      color: 0x1f5a32, roughness: 0.78, metalness: 0.0,
      sheen: 1.0, sheenColor: new THREE.Color(0x2b8845), sheenRoughness: 0.42,
      emissive: 0x0a2010, emissiveIntensity: 0.15,
      flatShading: false,
    });
    const snowCapMat = new THREE.MeshStandardMaterial({
      color: 0xf6faff, roughness: 0.65, metalness: 0.0,
      emissive: 0x16203a, emissiveIntensity: 0.06,
      transparent: true, opacity: 0.92,
    });

    const layers = [
      {y: 1.20, r: 2.30, h: 1.4},
      {y: 2.05, r: 1.95, h: 1.3},
      {y: 2.85, r: 1.55, h: 1.2},
      {y: 3.55, r: 1.15, h: 1.0},
      {y: 4.20, r: 0.70, h: 0.9},
    ];
    const bounds = [];
    layers.forEach(L => {
      const g = new THREE.ConeGeometry(L.r, L.h, segs, 1);
      const pos = g.attributes.position;
      for(let i = 0; i < pos.count; i++){
        const y = pos.getY(i);
        if(y > L.h * 0.42) continue;
        pos.setX(i, pos.getX(i) + (Math.random()-0.5)*0.20);
        pos.setZ(i, pos.getZ(i) + (Math.random()-0.5)*0.20);
        pos.setY(i, y + (Math.random()-0.5)*0.07);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, foliageMat);
      m.position.y = L.y;
      m.castShadow = m.receiveShadow = true;
      group.add(m);

      // Snow cap — slightly wider thin cone, only the bottom rim visible.
      const capG = new THREE.ConeGeometry(L.r * 1.04, L.h * 0.25, segs, 1);
      capG.translate(0, L.h * 0.38, 0);
      const cap = new THREE.Mesh(capG, snowCapMat);
      cap.position.y = L.y;
      cap.castShadow = false;
      cap.receiveShadow = true;
      group.add(cap);

      bounds.push({ y: L.y - L.h * 0.28, r: L.r * 0.86 });
    });

    return { group, bounds, topY: 4.95, style: 'stylized' };
  }

  // ── Tree #2: realistic spruce — bark trunk + instanced needle clusters ─
  function buildSpruceTree(opts){
    opts = opts || {};
    const mobile = _MOBILE();
    const N = opts.needleCount != null ? opts.needleCount : (mobile ? 450 : 900);
    const group = new THREE.Group();

    // Tall taper trunk.
    const trunkH = 5.5;
    const trunkG = new THREE.CylinderGeometry(0.16, 0.36, trunkH, 12, 4);
    const trunk  = new THREE.Mesh(trunkG, _getTrunkMaterial());
    trunk.position.y = trunkH * 0.5;
    trunk.castShadow = trunk.receiveShadow = true;
    group.add(trunk);

    // Needle-cluster geometry: thin 6-sided cone pointing +Y. We rotate the
    // instances to point outward + slightly upward.
    const needleG = new THREE.ConeGeometry(0.18, 0.55, 6, 1);
    needleG.translate(0, 0.275, 0);  // base at origin so instances pivot at root
    const needleMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.78, metalness: 0.0,
      flatShading: true, vertexColors: false,
    });
    const im = new THREE.InstancedMesh(needleG, needleMat, N);
    im.castShadow = !mobile;       // skip needle-shadows on mobile for fillrate
    im.receiveShadow = false;
    const cBuf = new Float32Array(N * 3);

    const greens = [
      [0.10, 0.34, 0.18],  // deep
      [0.14, 0.42, 0.22],  // mid
      [0.18, 0.50, 0.26],  // light
      [0.22, 0.56, 0.30],  // brightest
    ];
    const snowTip = [0.88, 0.92, 0.96];

    for(let i = 0; i < N; i++){
      // Distribute along trunk height with a spruce silhouette envelope:
      // wider near base, very narrow near top.
      const t = Math.pow(Math.random(), 0.65);   // bias toward base
      const y = 0.7 + t * (trunkH - 0.9);
      const envelope = 2.1 * Math.pow(1.0 - (y - 0.7) / (trunkH - 0.9), 0.7);
      const minR = envelope * 0.55;
      const maxR = envelope;
      const r = minR + Math.random() * (maxR - minR);
      const phi = Math.random() * Math.PI * 2;

      const x = Math.cos(phi) * r;
      const z = Math.sin(phi) * r;

      // Orientation: cone's +Y points outward + slightly downward (drooping
      // spruce branches). Use setFromUnitVectors to rotate (0,1,0) onto our
      // outward-pointing target direction.
      const droopY = -0.35 - Math.random() * 0.25;  // -1..0 = horizontal..down
      _outDir.set(Math.cos(phi), droopY, Math.sin(phi)).normalize();
      _qrot.setFromUnitVectors(_upY, _outDir);
      _dummy.position.set(x, y, z);
      _dummy.quaternion.copy(_qrot);
      const s = 0.7 + Math.random() * 0.6;
      _dummy.scale.set(s, s * (0.8 + Math.random() * 0.6), s);
      _dummy.updateMatrix();
      im.setMatrixAt(i, _dummy.matrix);

      // Color: 85% greens, 15% snow-tipped
      const col = Math.random() < 0.15
        ? snowTip
        : greens[Math.floor(Math.random() * greens.length)];
      cBuf[i*3]   = col[0];
      cBuf[i*3+1] = col[1];
      cBuf[i*3+2] = col[2];
    }
    im.instanceColor = new THREE.InstancedBufferAttribute(cBuf, 3);
    im.instanceColor.needsUpdate = true;
    im.instanceMatrix.needsUpdate = true;
    group.add(im);

    // Ornament bounds — sampled along the spruce silhouette.
    const bounds = [
      { y: 1.4, r: 1.9 },
      { y: 2.4, r: 1.55 },
      { y: 3.3, r: 1.25 },
      { y: 4.2, r: 0.85 },
    ];

    return { group, bounds, topY: trunkH + 0.05, style: 'spruce' };
  }

  // ── Tree #3: hybrid — cone stack with edge needle clusters ────────────
  function buildHybridTree(opts){
    opts = opts || {};
    const mobile = _MOBILE();
    const segs   = mobile ? 18 : 24;
    const NN     = mobile ? 180 : 350;
    const group  = new THREE.Group();

    // Trunk
    const trunkH = 1.0;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.30, 0.40, trunkH, 12),
      _getTrunkMaterial()
    );
    trunk.position.y = trunkH * 0.5;
    trunk.castShadow = trunk.receiveShadow = true;
    group.add(trunk);

    const foliageMat = new THREE.MeshPhysicalMaterial({
      color: 0x1d4f2e, roughness: 0.80, metalness: 0.0,
      sheen: 0.7, sheenColor: new THREE.Color(0x2a7a40), sheenRoughness: 0.5,
      emissive: 0x0a2010, emissiveIntensity: 0.10,
    });
    const snowRimMat = new THREE.MeshStandardMaterial({
      color: 0xeef4ff, roughness: 0.7, metalness: 0.0,
      emissive: 0x16203a, emissiveIntensity: 0.05,
    });

    const layers = [
      {y: 1.00, r: 2.20, h: 1.4},
      {y: 1.95, r: 1.80, h: 1.3},
      {y: 2.80, r: 1.35, h: 1.1},
      {y: 3.55, r: 0.85, h: 0.95},
    ];
    const bounds = [];
    const rimCenters = [];

    layers.forEach(L => {
      // Base cone
      const g = new THREE.ConeGeometry(L.r, L.h, segs, 1);
      const pos = g.attributes.position;
      for(let i = 0; i < pos.count; i++){
        const y = pos.getY(i);
        if(y > L.h * 0.42) continue;
        pos.setX(i, pos.getX(i) + (Math.random()-0.5)*0.14);
        pos.setZ(i, pos.getZ(i) + (Math.random()-0.5)*0.14);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, foliageMat);
      m.position.y = L.y;
      m.castShadow = m.receiveShadow = true;
      group.add(m);

      // Snow rim — short ring along the cone base, alpha not needed; an
      // emissive-tinted band that reads as accumulated snow.
      const rimG = new THREE.TorusGeometry(L.r * 0.96, 0.06, 6, segs);
      const rim  = new THREE.Mesh(rimG, snowRimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = L.y - L.h * 0.42;
      rim.castShadow = false;
      rim.receiveShadow = true;
      group.add(rim);

      bounds.push({ y: L.y - L.h * 0.28, r: L.r * 0.84 });
      rimCenters.push({ y: L.y - L.h * 0.42, r: L.r * 0.96 });
    });

    // Edge needle clusters — concentrate where the cones meet (on the
    // perimeter of each layer's base) to visually break the flat edges.
    const needleG = new THREE.ConeGeometry(0.16, 0.42, 6, 1);
    needleG.translate(0, 0.21, 0);
    const needleMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.78, metalness: 0.0,
      flatShading: true,
    });
    const im = new THREE.InstancedMesh(needleG, needleMat, NN);
    im.castShadow = false;
    const cBuf = new Float32Array(NN * 3);
    const greens = [
      [0.11, 0.32, 0.18],
      [0.15, 0.42, 0.22],
      [0.20, 0.50, 0.27],
    ];
    const snowTip = [0.92, 0.95, 0.98];

    for(let i = 0; i < NN; i++){
      // Pick a random rim
      const ring = rimCenters[Math.floor(Math.random() * rimCenters.length)];
      const phi  = Math.random() * Math.PI * 2;
      const rJit = ring.r * (0.94 + Math.random() * 0.10);
      const yJit = ring.y + (Math.random() - 0.3) * 0.30;
      const x = Math.cos(phi) * rJit;
      const z = Math.sin(phi) * rJit;
      const droopY = -0.45 - Math.random() * 0.25;
      _outDir.set(Math.cos(phi), droopY, Math.sin(phi)).normalize();
      _qrot.setFromUnitVectors(_upY, _outDir);
      _dummy.position.set(x, yJit, z);
      _dummy.quaternion.copy(_qrot);
      const s = 0.7 + Math.random() * 0.5;
      _dummy.scale.set(s, s * (0.8 + Math.random() * 0.5), s);
      _dummy.updateMatrix();
      im.setMatrixAt(i, _dummy.matrix);

      const col = Math.random() < 0.18
        ? snowTip
        : greens[Math.floor(Math.random() * greens.length)];
      cBuf[i*3] = col[0]; cBuf[i*3+1] = col[1]; cBuf[i*3+2] = col[2];
    }
    im.instanceColor = new THREE.InstancedBufferAttribute(cBuf, 3);
    im.instanceColor.needsUpdate = true;
    im.instanceMatrix.needsUpdate = true;
    group.add(im);

    return { group, bounds, topY: 4.20, style: 'hybrid' };
  }

  // ── Candy cane — single high-quality instance, clearcoat physical mat ──
  // Adapted from proc-decor.js:buildCandyCaneBatch. Shaft uses vertex-baked
  // red/white stripes (8 bands); crook is a single half-torus with stripes
  // baked per tubular-segment ring. clearcoat 0.95 reads as a candy glaze.
  // Geometry + material are cached across calls — the demo builds 6 canes
  // so caching saves 10 shader compiles + 10 GPU-buffer uploads.
  let _caneCache = null;
  function _getCaneAssets(){
    if(_caneCache) return _caneCache;
    const mobile = _MOBILE();
    const sides  = mobile ? 9 : 14;
    const hSegs  = mobile ? 10 : 18;
    const shaftH = 2.6;
    const radius = 0.16;
    const stripeBands = 8;
    const stripeRed   = new THREE.Color(0xee1122);
    const stripeWhite = new THREE.Color(0xffffff);

    // Shaft geometry with vertex-color stripes.
    const shaftG = new THREE.CylinderGeometry(radius, radius, shaftH, sides, hSegs);
    shaftG.translate(0, shaftH * 0.5, 0);
    const pos = shaftG.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const tc  = new THREE.Color();
    for(let i = 0; i < pos.count; i++){
      const y = pos.getY(i);
      const band = Math.floor((y / shaftH) * stripeBands);
      tc.copy(band % 2 === 0 ? stripeRed : stripeWhite);
      col[i*3]   = tc.r;
      col[i*3+1] = tc.g;
      col[i*3+2] = tc.b;
    }
    shaftG.setAttribute('color', new THREE.BufferAttribute(col, 3));

    // Crook geometry — single half-torus, vertex-color stripes per tubular
    // ring. Default TorusGeometry lies in xy-plane with the arc going from
    // +x (angle 0) counter-clockwise. Placing the centre at (crookR, shaftH)
    // lands the angle-π end at the shaft top (0, shaftH, 0) — the joint.
    const crookR    = 0.30;
    const tubeSegs  = mobile ? 14 : 22;
    const radialSegs= mobile ? 6  : 8;
    const stripeArc = 6;
    const crookG = new THREE.TorusGeometry(crookR, radius, radialSegs, tubeSegs, Math.PI);
    const cpos = crookG.attributes.position;
    const ccol = new Float32Array(cpos.count * 3);
    const cc   = new THREE.Color();
    for(let j = 0; j <= tubeSegs; j++){
      const band = Math.floor((j / tubeSegs) * stripeArc);
      cc.copy(band % 2 === 0 ? stripeRed : stripeWhite);
      for(let i = 0; i <= radialSegs; i++){
        const idx = j * (radialSegs + 1) + i;
        ccol[idx*3]   = cc.r;
        ccol[idx*3+1] = cc.g;
        ccol[idx*3+2] = cc.b;
      }
    }
    crookG.setAttribute('color', new THREE.BufferAttribute(ccol, 3));

    // One physical material shared between shaft and crook — both read
    // their stripes from vertex colors, so a single compile suffices.
    const caneMat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.18, metalness: 0.0,
      clearcoat: 0.95, clearcoatRoughness: 0.08,
      emissive: 0x221107, emissiveIntensity: 0.10,
    });

    _caneCache = { shaftG, crookG, caneMat, shaftH, crookR };
    return _caneCache;
  }

  function buildCandyCane(x, z, rot, opts){
    const a = _getCaneAssets();
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rot || 0;
    const shaft = new THREE.Mesh(a.shaftG, a.caneMat);
    shaft.castShadow = shaft.receiveShadow = true;
    group.add(shaft);
    const crook = new THREE.Mesh(a.crookG, a.caneMat);
    crook.position.set(a.crookR, a.shaftH, 0);
    crook.castShadow = crook.receiveShadow = true;
    group.add(crook);
    return group;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  window.WinterFoliage = {
    buildProceduralEnvMap,
    makeSoftSnowflakeTexture,
    makeStarTexture,
    buildStarryNight,
    buildStylizedTree,
    buildSpruceTree,
    buildHybridTree,
    buildCandyCane,
  };

})();
