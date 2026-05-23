// js/track/environment.js — non-module script.

'use strict';

// Module-level scratch — used by updateSky() to pin _sunBillboard +
// stars to the camera position so their direction-from-camera stays
// constant frame-to-frame (the "infinitely far sky" illusion). Without
// this, the sun at world-distance 500 shows visible parallax across a
// 600u-wide track and the owner reads it as "moving with camera/turns".
// _sunDir is the unit vector from origin to the sun-anchor, captured
// at buildSunBillboard time so each world's preferred sun-direction
// survives. _sunRadius keeps the sprite sized as if at 500u from the
// camera (matches the original scale tuning).
const _sunDir=new THREE.Vector3(0,1,0);
let _sunRadius=500;
// Per-world moon direction + radius. Captured in buildWorldMoon() from
// the WORLD_MOON_PROFILE table. updateSky() pins _moonBillboard to
// camera.position + _moonDir * _moonRadius each frame, mirror van het
// sun-pin patroon. Worlds zonder profile zetten _moonBillboard=null +
// _moonDir blijft default (geen pin-werk).
const _moonDir=new THREE.Vector3(0,1,0);
let _moonRadius=2400;

// ── Ground texture generators ──────────────────────────────────────────────
// Tileable 256×256 grayscale canvases. Multiplicatief over material.color.
// Niet gecached: disposeScene() ruimt 'm op bij elke world-switch.
function _grassGroundTex(){
  const S=256,c=document.createElement('canvas');c.width=S;c.height=S;
  const g=c.getContext('2d');
  g.fillStyle='#9aaa9a';g.fillRect(0,0,S,S);
  // Pixel noise (yellow-green speckle)
  const id=g.getImageData(0,0,S,S),d=id.data;
  for(let i=0;i<d.length;i+=4){
    const n=120+(Math.random()*80)|0;
    d[i]=n+8;d[i+1]=n+15;d[i+2]=n;d[i+3]=255;
  }
  g.putImageData(id,0,0);
  // Darker patches (dirt/wear)
  for(let i=0;i<14;i++){
    const x=Math.random()*S,y=Math.random()*S,r=8+Math.random()*16;
    const grd=g.createRadialGradient(x,y,0,x,y,r);
    grd.addColorStop(0,'rgba(60,70,50,0.45)');grd.addColorStop(1,'rgba(60,70,50,0)');
    g.fillStyle=grd;g.fillRect(x-r,y-r,r*2,r*2);
  }
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(8,8);t.anisotropy=window._isMobile?2:4;t.needsUpdate=true;return t;
}
function _iceGroundTex(){
  const S=256,c=document.createElement('canvas');c.width=S;c.height=S;
  const g=c.getContext('2d');
  g.fillStyle='#ddeef5';g.fillRect(0,0,S,S);
  // Subtle blue-ish noise
  const id=g.getImageData(0,0,S,S),d=id.data;
  for(let i=0;i<d.length;i+=4){
    const n=200+(Math.random()*55)|0;
    d[i]=n-5;d[i+1]=n;d[i+2]=n+8;d[i+3]=255;
  }
  g.putImageData(id,0,0);
  // Crack lines (jagged white-blue)
  g.strokeStyle='rgba(180,210,230,0.55)';g.lineWidth=1;
  for(let i=0;i<10;i++){
    g.beginPath();
    let x=Math.random()*S,y=Math.random()*S;g.moveTo(x,y);
    for(let j=0;j<5;j++){
      x+=(Math.random()-.5)*40;y+=(Math.random()-.5)*40;g.lineTo(x,y);
    }
    g.stroke();
  }
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(6,6);t.anisotropy=window._isMobile?2:4;t.needsUpdate=true;return t;
}
function _rockGroundTex(){
  const S=256,c=document.createElement('canvas');c.width=S;c.height=S;
  const g=c.getContext('2d');
  g.fillStyle='#3a2a25';g.fillRect(0,0,S,S);
  const id=g.getImageData(0,0,S,S),d=id.data;
  for(let i=0;i<d.length;i+=4){
    const n=70+(Math.random()*70)|0;
    d[i]=n+10;d[i+1]=n;d[i+2]=n-8;d[i+3]=255;
  }
  g.putImageData(id,0,0);
  // Glowing lava fissures (orange specks scattered)
  for(let i=0;i<45;i++){
    const x=Math.random()*S,y=Math.random()*S,r=2+Math.random()*5;
    const grd=g.createRadialGradient(x,y,0,x,y,r);
    grd.addColorStop(0,'rgba(255,140,40,0.8)');grd.addColorStop(1,'rgba(255,80,20,0)');
    g.fillStyle=grd;g.fillRect(x-r,y-r,r*2,r*2);
  }
  // Crack lines (dark)
  g.strokeStyle='rgba(20,10,5,0.7)';g.lineWidth=2;
  for(let i=0;i<6;i++){
    g.beginPath();
    let x=Math.random()*S,y=Math.random()*S;g.moveTo(x,y);
    for(let j=0;j<6;j++){
      x+=(Math.random()-.5)*50;y+=(Math.random()-.5)*50;g.lineTo(x,y);
    }
    g.stroke();
  }
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(7,7);t.anisotropy=window._isMobile?2:4;t.needsUpdate=true;return t;
}
function _sandGroundTex(){
  const S=256,c=document.createElement('canvas');c.width=S;c.height=S;
  const g=c.getContext('2d');
  g.fillStyle='#c0b08a';g.fillRect(0,0,S,S);
  const id=g.getImageData(0,0,S,S),d=id.data;
  for(let i=0;i<d.length;i+=4){
    const n=170+(Math.random()*55)|0;
    d[i]=n+5;d[i+1]=n;d[i+2]=n-25;d[i+3]=255;
  }
  g.putImageData(id,0,0);
  // Horizontal sand ripples (sine bands)
  for(let y=0;y<S;y+=6){
    const wob=Math.sin(y*.15)*4;
    g.fillStyle='rgba(160,140,110,0.30)';
    g.fillRect(0,y+wob,S,2);
  }
  // Scattered shells/pebbles (small darker dots)
  for(let i=0;i<30;i++){
    g.fillStyle='rgba(80,60,40,0.45)';
    g.fillRect(Math.random()*S,Math.random()*S,2,2);
  }
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(6,6);t.anisotropy=window._isMobile?2:4;t.needsUpdate=true;return t;
}
function _pavementGroundTex(){
  const S=256,c=document.createElement('canvas');c.width=S;c.height=S;
  const g=c.getContext('2d');
  g.fillStyle='#888888';g.fillRect(0,0,S,S);
  const id=g.getImageData(0,0,S,S),d=id.data;
  for(let i=0;i<d.length;i+=4){
    const n=110+(Math.random()*80)|0;
    d[i]=d[i+1]=d[i+2]=n;d[i+3]=255;
  }
  g.putImageData(id,0,0);
  // Tile-grout cross pattern
  g.strokeStyle='rgba(40,40,40,0.45)';g.lineWidth=1;
  for(let x=0;x<S;x+=64){g.beginPath();g.moveTo(x,0);g.lineTo(x,S);g.stroke();}
  for(let y=0;y<S;y+=64){g.beginPath();g.moveTo(0,y);g.lineTo(S,y);g.stroke();}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(10,10);t.anisotropy=window._isMobile?2:4;t.needsUpdate=true;return t;
}

function buildGround(){
  const isSpace=activeWorld==='space',isDS=activeWorld==='deepsea';
  const groundCol=isSpace?0x070710:isDS?0x081820:0x3c7040;
  const infieldCol=isSpace?0x0a0a18:isDS?0x0b2030:0x4a8848;
  // Outdoor worlds (everything except space/deepsea) get a tiled grass texture.
  // Space + deepsea overdraw with their own ground in their environment builders.
  const groundMat=new THREE.MeshLambertMaterial({color:groundCol});
  if(!_isVoidWorld(activeWorld))groundMat.map=_grassGroundTex();
  const g=new THREE.Mesh(new THREE.PlaneGeometry(2200,2200,1,1),groundMat);
  g.rotation.x=-Math.PI/2;g.position.y=-.12;g.receiveShadow=true;
  // Tag so asset-bridge can swap in PBR maps post-load (Fase E).
  g.userData._isProcGround=true;
  scene.add(g);
  if(!isDS){ // Deep sea has its own seafloor built by buildDeepSeaEnvironment
    const infMat=new THREE.MeshLambertMaterial({color:infieldCol});
    if(!isSpace)infMat.map=_grassGroundTex();
    const inf=new THREE.Mesh(new THREE.PlaneGeometry(440,350,1,1),infMat);
    inf.rotation.x=-Math.PI/2;inf.position.set(-10,-.11,-40);
    inf.userData._isProcGround=true;
    scene.add(inf);
  }
}

function buildClouds(){
  const m=new THREE.MeshBasicMaterial({color:0xf8fbff,transparent:true,opacity:.88});
  for(let i=0;i<12;i++){
    const geo=new THREE.SphereGeometry(18+Math.random()*22,7,5);
    geo.scale(1,.25+Math.random()*.14,.65+Math.random()*.35);
    const c=new THREE.Mesh(geo,m);
    c.position.set((Math.random()-.5)*900,85+Math.random()*55,(Math.random()-.5)*900+220);
    scene.add(c);
  }
}


// Procedural silhouette canvas: jagged mountain horizon with alpha=0 sky
// above the ridge. Used as the fallback for parallax background layers.
function _silhouetteTex(seed, baseColor, accent, jaggedness){
  const W=2048, H=384;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const g=c.getContext('2d');
  // Random walker generates a horizon line. PRNG seeded per-layer so a
  // far + near pair don't produce identical silhouettes.
  let s = seed||1;
  const rnd = () => { s = (s*9301+49297)%233280; return s/233280; };
  const ys=new Float32Array(W);
  const baseY = H*0.45;
  const amp = jaggedness * H * 0.35;
  // Sum of three octaves of band-limited noise → mountainous shape.
  for (let octave=0;octave<3;octave++){
    const wl = 60 / Math.pow(2, octave);
    const sub = amp / Math.pow(2, octave);
    let prev = (rnd()-.5)*sub;
    for (let x=0;x<W;x++){
      const phase = x / wl;
      const r = Math.sin(phase + rnd()*0.4) * sub * 0.5 + prev*0.92;
      prev = r;
      ys[x] += r;
    }
  }
  // Gradient fill (top: accent, bottom: deepens toward base color).
  const grad = g.createLinearGradient(0, baseY-amp, 0, H);
  grad.addColorStop(0, accent);
  grad.addColorStop(1, baseColor);
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, H);
  for (let x=0;x<W;x++) g.lineTo(x, baseY + ys[x]);
  g.lineTo(W, H);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  if (window.ThreeCompat && ThreeCompat.applyTextureColorSpace) ThreeCompat.applyTextureColorSpace(t);
  return t;
}

// Per-world procedural silhouette palettes. Tuned to sit *behind* the
// existing rich horizon content (volcano embers, neon skyscrapers, arctic
// auroras). Far layer = atmospheric haze ridge.
// Near layer = darker mid-distance silhouettes. Worlds without a palette
// entry render only when textured mountains_*.png are loaded.
//
// Each entry: { far:[lowColor, highColor, jaggedness, opacity, height],
//               near:[lowColor, highColor, jaggedness, opacity, height] }
const _SILHOUETTE_PALETTES = {
  // Volcano: deep rust silhouettes far behind the lava rivers — should
  // read like distant ridges almost lost in ember haze.
  volcano: {
    far:  ['#1a0608','#3a1010',0.65, 0.72, 100],
    near: ['#080202','#1a0408',0.95, 0.86,  78],
  },
  // Arctic: cold misty mountains. Both layers light to blend with snow.
  arctic: {
    far:  ['#7a8aa6','#b4c2d8',0.50, 0.85, 110],
    near: ['#3a4a64','#6678a0',0.75, 0.94,  82],
  },
  // DeepSea: Phase 11C — donkerder + verder weg silhouet (was '#001a2a').
  // Deepblauwer "abyssal" gevoel, lager opacity zodat fog-density alleen
  // de hint geeft dat er iets is in de afstand.
  deepsea: {
    far:  ['#001144','#002255',0.08, 0.70, 190],
    near: ['#00091a','#001133',0.12, 0.85, 120],
  },
  // Candy: Phase 11C — lichtere pastel-roze horizon (was '#ffb3d4').
  // Voelt nu meer "candy land sky" ipv mountains-in-mist.
  candy: {
    far:  ['#ffccee','#ff99dd',0.25, 0.50, 230],
    near: ['#ff88cc','#ff55bb',0.35, 0.72, 150],
  },
  // Sandstorm: deep rust/orange canyon ridges fading into warm haze.
  // Far layer is the highest tier of mesas dissolving into the
  // sand-haze fog (#e8b878), near layer is the closer canyon walls
  // that bracket the slot section. Jaggedness 0.85/1.05 for the
  // sharp mesa profile typical of southwest desert.
  sandstorm: {
    far:  ['#a86839','#d49060',0.85, 0.78, 110],
    near: ['#5a2818','#8b3a1d',1.05, 0.90,  82],
  },
  // Pier 47: industrial harbour skyline — distant container stacks,
  // warehouse rooftops, cranes silhouetted against the city-glow horizon.
  // Both layers are very dark (almost black) so they read as flat
  // silhouettes catching only the sodium-orange reflected light from the
  // skybox foot-band. Higher jaggedness (1.10/1.35) gives the rectangular
  // industrial-machinery profile typical of harbours.
  pier47: {
    far:  ['#0a0812','#1a1422',1.10, 0.85,  78],
    near: ['#040206','#0a0812',1.35, 0.95,  60],
  },
  // Guangzhou Cinematic: Guangzhou CBD high-rise silhouettes. Very dark
  // purple-black both layers — they read as flat skyscraper silhouettes
  // backlit by the neon city-glow. High jaggedness (0.85/1.10) gives the
  // vertical tower-block profile typical of Chinese CBD skylines.
  // Jaggedness tuned higher than pier47 (industrial boxes) for taller,
  // more varied tower heights. Opacity/height from verified schema.
  // NOTE: window emissives deferred to V2 — the helper doesn't support
  // windowEmissive/windowDensity; a local post-pass is a V2 addition.
  guangzhou: {
    far:  ['#0a0814','#1a1428', 0.85, 0.82, 130],
    near: ['#0e0a18','#14101e', 1.10, 0.92,  95],
  },
};

// Phase 8.10 — skyline parallax scroll. Per-frame texture.offset.x
// shift op de silhouet-cylinders, geregistreerd via window._silhouetteLayers
// tijdens buildBackgroundLayers. Subtiele drift geeft depth-illusie
// zonder extra geometry. Skip op space + arctic (no atmosphere).
function updateSkylineParallax(){
  if(!window._silhouetteLayers || !window._silhouetteLayers.length) return;
  if(typeof activeWorld !== 'undefined' &&
     (activeWorld === 'space' || activeWorld === 'arctic')) return;
  for(let i=0; i<window._silhouetteLayers.length; i++){
    const layer = window._silhouetteLayers[i];
    if(!layer.mesh || !layer.mesh.material || !layer.mesh.material.map) continue;
    layer.mesh.material.map.offset.x += layer.scrollRate;
    if(layer.mesh.material.map.offset.x > 1) layer.mesh.material.map.offset.x -= 1;
  }
}
if(typeof window !== 'undefined') window._updateSkylineParallax = updateSkylineParallax;

function buildBackgroundLayers(){
  // Phase 8.10 — reset parallax-layer registry bij elke world-build.
  // disposeScene removes meshes from scene maar de array houdt stale
  // refs; reset hier zodat alleen layers van de actieve wereld scrollen.
  window._silhouetteLayers = [];
  const farTex  = window.Assets ? Assets.getTexture(activeWorld,'skybox_layers.mountains_far')  : null;
  const nearTex = window.Assets ? Assets.getTexture(activeWorld,'skybox_layers.mountains_near') : null;
  // First check WORLD_HORIZON_PROFILE (audit 2026-05-09 system) — if the
  // active world has a typed silhouette profile we render that. Falls
  // through to legacy _SILHOUETTE_PALETTES + _silhouetteTex (mountains)
  // for worlds without an entry.
  const horizonProfile = (window.WORLD_HORIZON_PROFILE && window.WORLD_HORIZON_PROFILE[activeWorld]) || null;
  if (horizonProfile && typeof window._buildHorizonSilhouette==='function'){
    const farT  = farTex  || window._buildHorizonSilhouette(horizonProfile.far);
    const nearT = nearTex || window._buildHorizonSilhouette(horizonProfile.near);
    // yBase=-3 anchors silhouette base 3u BELOW ground (y=-0.15) — solid
    // gradient color portion of the canvas overlaps the ground plane
    // so there's no visible 'lichte horizon-strip' tussen ground en
    // silhouet-base. Height bumped +18u (far) / +10u (near) zodat
    // silhouet-tops op vergelijkbare hoogte blijven als pre-fix.
    const layers = [
      { tex: farT,  radius: 740, height: (horizonProfile.far.height  || 110) + 18, yBase: -3, opacity: farTex  ? 0.96 : (horizonProfile.far.opacity  || 0.85), repeat: 5 },
      { tex: nearT, radius: 540, height: (horizonProfile.near.height || 82)  + 10, yBase: -3, opacity: nearTex ? 1.00 : (horizonProfile.near.opacity || 0.92), repeat: 4 },
    ].filter(l => l.tex);
    layers.forEach((layer, idx)=>{
      layer.tex.wrapS = THREE.RepeatWrapping;
      layer.tex.repeat.set(layer.repeat, 1);
      const mat = new THREE.MeshBasicMaterial({
        map: layer.tex, color: 0xffffff, transparent: true, opacity: layer.opacity,
        side: THREE.DoubleSide, depthWrite: false, fog: true,
      });
      const geo = new THREE.CylinderGeometry(layer.radius, layer.radius, layer.height, 64, 1, true);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = layer.yBase + layer.height*0.5;
      mesh.renderOrder = -10;
      mesh.userData = mesh.userData || {};
      mesh.userData._noLodCull = true;  // Phase 8.7 — silhouettes never cull
      scene.add(mesh);
      // Phase 8.10 — skyline parallax: register layer voor per-frame
      // texture.offset.x scroll. Far layer scrollt langzamer dan near
      // (idx 0 = far, idx 1 = near).
      window._silhouetteLayers = window._silhouetteLayers || [];
      window._silhouetteLayers.push({
        mesh: mesh,
        scrollRate: idx === 0 ? 0.00006 : 0.00018  // near 3× faster dan far
      });
    });
    return;
  }
  const palette = _SILHOUETTE_PALETTES[activeWorld];
  if (!palette && !farTex && !nearTex) return;

  const farPal  = palette ? palette.far  : ['#3a4960','#6b7c98',0.55, 0.96, 110];
  const nearPal = palette ? palette.near : ['#222a3d','#404a64',0.85, 1.00,  78];
  const def = [
    { tex: farTex  || (palette ? _silhouetteTex(7,  farPal[0],  farPal[1],  farPal[2])  : null),
      radius: 740, height: farPal[4],  yBase: 12, color: 0xffffff,
      opacity: farTex  ? 0.96 : farPal[3],  repeat: 5 },
    { tex: nearTex || (palette ? _silhouetteTex(31, nearPal[0], nearPal[1], nearPal[2]) : null),
      radius: 540, height: nearPal[4], yBase: 5,  color: 0xffffff,
      opacity: nearTex ? 1.00 : nearPal[3], repeat: 4 },
  ].filter(d => d.tex);
  def.forEach(layer=>{
    layer.tex.wrapS = THREE.RepeatWrapping;
    layer.tex.repeat.set(layer.repeat, 1);
    // Issue 4 (V5.3): guangzhou skyline cylinders get anisotropic filtering so
    // glancing-angle views stay sharp instead of blurring into a haze.
    // Guard keeps this strictly guangzhou-specific — no cross-world change.
    if(activeWorld === 'guangzhou' && layer.tex){
      layer.tex.minFilter = THREE.LinearMipmapLinearFilter;
      layer.tex.magFilter = THREE.LinearFilter;
      layer.tex.generateMipmaps = true;
      layer.tex.anisotropy = window._isMobile ? 4 : Math.min(8, (typeof renderer !== 'undefined' && renderer.capabilities) ? renderer.capabilities.getMaxAnisotropy() : 8);
      layer.tex.needsUpdate = true;
    }
    const mat = new THREE.MeshBasicMaterial({
      map: layer.tex, color: layer.color, transparent:true, opacity: layer.opacity,
      side: THREE.DoubleSide, depthWrite:false, fog:true,
    });
    // CylinderGeometry openEnded with the texture wrapped horizontally.
    const geo = new THREE.CylinderGeometry(layer.radius, layer.radius, layer.height, 64, 1, true);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = layer.yBase + layer.height*0.5;
    mesh.renderOrder = -10;
    scene.add(mesh);
  });
}

function buildMountains(){
  const mNear=new THREE.MeshLambertMaterial({color:0x3d5878});
  const mFar=new THREE.MeshLambertMaterial({color:0x253850});
  const mSnow=new THREE.MeshLambertMaterial({color:0xddeeff});
  // [x, z, height, radius, hasSnow, sides]
  const peaks=[
    [-300,-520,185,85,true,6],[-80,-575,210,95,true,7],[140,-545,165,75,true,6],
    [340,-495,145,68,false,7],[520,-450,120,58,false,6],
    [570,-290,170,78,true,6],[605,-65,155,72,false,7],[575,165,135,64,false,6],
    [-560,-195,175,80,true,7],[-615,10,162,74,false,6],[-585,190,140,66,false,6],
    [-340,450,105,52,false,6],[-80,500,125,60,false,7],[170,490,110,55,false,6],
    [390,435,98,48,false,7],
  ];
  peaks.forEach(([x,z,h,r,snow,sides])=>{
    const base=new THREE.Mesh(new THREE.ConeGeometry(r*1.4,h*.4,sides),mFar);
    base.position.set(x,-8,z);scene.add(base);
    const peak=new THREE.Mesh(new THREE.ConeGeometry(r,h,sides),mNear);
    peak.position.set(x,0,z);scene.add(peak);
    if(snow){
      const cap=new THREE.Mesh(new THREE.ConeGeometry(r*.3,h*.25,sides),mSnow);
      cap.position.set(x,h*.4,z);scene.add(cap);
    }
  });
}


function buildLake(){
  // Shore bank
  const shore=new THREE.Mesh(new THREE.PlaneGeometry(168,115,1,1),
    new THREE.MeshLambertMaterial({color:0x5ea060}));
  shore.rotation.x=-Math.PI/2;shore.position.set(-10,-.1,-75);scene.add(shore);
  // Water body
  const water=new THREE.Mesh(new THREE.PlaneGeometry(148,98,1,1),
    new THREE.MeshLambertMaterial({color:0x1a6890,transparent:true,opacity:.88}));
  water.rotation.x=-Math.PI/2;water.position.set(-10,-.08,-75);scene.add(water);
  // Shimmer highlight
  const shim=new THREE.Mesh(new THREE.PlaneGeometry(130,82,1,1),
    new THREE.MeshLambertMaterial({color:0x2294b8,transparent:true,opacity:.55}));
  shim.rotation.x=-Math.PI/2;shim.position.set(-10,-.07,-75);scene.add(shim);
}


function buildGravelTraps(){
  const gMat=new THREE.MeshLambertMaterial({color:0xb8a878});
  [{t:.22,s:1,w:30,l:34},{t:.36,s:1,w:26,l:30},
   {t:.50,s:-1,w:28,l:32},{t:.56,s:-1,w:24,l:28},
   {t:.80,s:1,w:26,l:30}].forEach(({t,s,w,l})=>{
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const pos=p.clone().addScaledVector(nr,s*(TW+w*.5));
    const trap=new THREE.Mesh(new THREE.PlaneGeometry(l,w),gMat);
    trap.rotation.x=-Math.PI/2;trap.rotation.z=Math.atan2(tg.x,tg.z);
    trap.position.copy(pos);trap.position.y=-.05;scene.add(trap);
  });
}




function buildCenterlineArrows(){
  // Subtle chevrons (>>) along track centerline showing direction of travel
  const mat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.16});
  const N=55;
  for(let i=0;i<N;i++){
    const t=(i+.5)/N;
    const p=trackCurve.getPoint(t);
    const tg=trackCurve.getTangent(t).normalize();
    const angle=Math.atan2(tg.x,tg.z);
    [-1,1].forEach(s=>{
      const bar=new THREE.Mesh(new THREE.BoxGeometry(.15,.01,1.6),mat);
      bar.position.copy(p);bar.position.y=.022;
      bar.rotation.y=angle+s*.48;
      scene.add(bar);
    });
  }
}


function buildTrackFlags(){
  const flagT=[.02,.10,.19,.28,.37,.47,.56,.65,.74,.82,.90,.96];
  const flagColors=[0xff1111,0x0044ff,0xffee00,0xff7700,0x00cc44,0xffffff,
                    0xff0066,0x44ccff,0xff4400,0x00ffcc,0xff33aa,0xaaff00];
  const poleMat=new THREE.MeshLambertMaterial({color:0x888888});
  flagT.forEach((t,idx)=>{
    const p=trackCurve.getPoint(t);
    const tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const side=idx%2===0?1:-1;
    const base=p.clone().addScaledVector(nr,side*(BARRIER_OFF+4.5));
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.07,.1,5.5,6),poleMat);
    pole.position.copy(base);pole.position.y=2.75;scene.add(pole);
    const flagMat=new THREE.MeshBasicMaterial({color:flagColors[idx%flagColors.length],side:THREE.DoubleSide});
    const flag=new THREE.Mesh(new THREE.PlaneGeometry(1.9,1.0),flagMat);
    flag.position.copy(base);flag.position.y=5.2;
    // Orient flag perpendicular to pole, in track tangent direction
    flag.rotation.y=Math.atan2(tg.x,tg.z)+Math.PI*.5;
    scene.add(flag);
    _trackFlags.push({mesh:flag,base:base.clone(),side,idx});
  });
}

function updateFlags(){
  const t=_nowSec;
  // forEach → for: per-frame closure removal.
  for(let i=0;i<_trackFlags.length;i++){
    const f=_trackFlags[i];
    const wave=Math.sin(t*3.0+i*1.1)*.22;
    const wave2=Math.sin(t*4.8+i*0.7)*.08;
    f.mesh.rotation.x=wave;
    f.mesh.rotation.z=wave2;
  }
  // Crowd dual-frame animation hangs op dezelfde update-tick.
  if(typeof updateCrowd==='function')updateCrowd();
  if(typeof updateGantryTicker==='function')updateGantryTicker();
  if(typeof updateBarrierPulse==='function')updateBarrierPulse();
}


// ── Per-world moon profiles ─────────────────────────────────────────────
//
// Elke wereld krijgt een passende moon/light source per kickoff-spec
// (audit 2026-05-09). Profile-fields:
//   type:       'sphere' | 'planets' | 'none'
//   color:      hex base (Sphere body)
//   emissive:   hex emissive — aan voor zelfgloed in night-mode
//   radius:     sphere geo radius (60-150 typical)
//   dir:        [x,y,z] direction from camera-center; will be normalised.
//               Vectors zoals [-180, 290, 200] geven NW-boven plaatsing.
//   distance:   afstand van camera (matchet _sunRadius=500 default).
//   glowColor:  optionele halo-color
//   glowSize:   halo-radius (>radius)
//   ringColor:  alleen bij type='planets' — Saturn-ring color
//
// Worlds zonder profile (pier47) krijgen geen moon.
const WORLD_MOON_PROFILE={
  // Volcano: rode bloed-maan, emissief zodat hij door embers heen brandt.
  volcano:    { type:'sphere',  color:0xcc2818, emissive:0x661408, radius:55, dir:[160, 320, -180], distance:2400, glowColor:0xff5028, glowSize:88 },
  // Candy: roze/paarse maan met soft glow.
  candy:      { type:'sphere',  color:0xffaadd, emissive:0xcc6699, radius:60, dir:[-180, 290, 200], distance:2400, glowColor:0xff88dd, glowSize:96 },
  // Arctic: helder witte maan + grote halo. Aurora is een aparte horizon
  // band (commit 9).
  arctic:     { type:'sphere',  color:0xeef4ff, emissive:0x99bbcc, radius:68, dir:[140, 320, -160], distance:2400, glowColor:0xddeeff, glowSize:108 },
  // Cosmic: 'planets' — Saturn met ring + 1 secondary planet ipv enkele maan.
  space:      { type:'planets', color:0xddccaa, emissive:0x886633, radius:70, dir:[-200, 240, -260], distance:2600, ringColor:0xaa9966, secondaryColor:0x6688aa, secondaryEmissive:0x224466 },
  // Deepsea: dim moon high above (alsof gefilterd door wateroppervlak).
  // Kickoff genoemde god-rays bestaan al via _godRays (env.js); de moon
  // suggereert het surface-licht.
  deepsea:    { type:'sphere',  color:0xaaccdd, emissive:0x336688, radius:50, dir:[80, 360, 100],   distance:2200, glowColor:0x66aacc, glowSize:130 },
  // Sandstorm: koele full-moon boven duinen.
  sandstorm:  { type:'sphere',  color:0xffe4b5, emissive:0xb88a3a, radius:55, dir:[-180, 310, 100], distance:2400, glowColor:0xffc060, glowSize:88 },
  // pier47: NIET AANRAKEN per kickoff. Geen entry
  // → moon niet gebouwd voor deze wereld.
};

// ── buildWorldMoon ──────────────────────────────────────────────────────
//
// Bouwt de moon (of planets-group) voor de actieve wereld op basis van
// WORLD_MOON_PROFILE. Aangeroepen vanuit core/scene.js NA de world-builder
// + buildBackgroundLayers (zelfde plaats als de sun-billboard hook).
//
// Implementatie-eisen uit de kickoff:
// - GEEN parenting aan camera (scene.add, niet camera.add)
// - GEEN lookAt(camera) — Three.js Mesh houdt zijn world-rotation
// - Vaste world-direction; positie tracked camera.position elke frame in
//   updateSky() zodat de "infinitely far" illusie blijft (parallax-vrij)
// - fog:false op materials zodat night-fog de moon niet wegvreet op
//   afstand 2400u
//
// Visibility wordt gestuurd door toggleNight() — moon visible als isDark.
function buildWorldMoon(){
  const profile=WORLD_MOON_PROFILE[activeWorld];
  if(!profile||profile.type==='none')return;
  // Direction normalised + distance captured in module-locals zodat
  // updateSky() kan pinnen zonder per-frame allocatie.
  _moonDir.set(profile.dir[0],profile.dir[1],profile.dir[2]).normalize();
  _moonRadius=profile.distance||2400;
  if(profile.type==='sphere'){
    const seg=window._isMobile?16:20;
    const moonGeo=new THREE.SphereGeometry(profile.radius,seg,seg);
    const moonMat=new THREE.MeshBasicMaterial({
      color:profile.color,
      transparent:false,
      fog:false,
    });
    // Emissive via een tweede inner-sphere in additive blending zodat de
    // moon door bloom heen leest. MeshBasicMaterial heeft geen emissive,
    // dus we gebruiken color + glow-halo voor de zelfgloed-illusie.
    _moonBillboard=new THREE.Mesh(moonGeo,moonMat);
    _moonBillboard.position.copy(_moonDir).multiplyScalar(_moonRadius);
    _moonBillboard.renderOrder=-9; // achter foreground objects, voor skybox
    // frustumCulled=false zodat updateSky's per-frame position-pin nooit
    // wegvalt door bounding-sphere mismatch — de moon is altijd zichtbaar
    // wanneer toggleNight z'n .visible=true heeft gezet.
    _moonBillboard.frustumCulled=false;
    scene.add(_moonBillboard);
    // Glow halo — backside-Sphere, additive, fog:false. Geeft de "deze
    // maan straalt licht uit" feel zonder een echte PointLight.
    if(profile.glowColor && profile.glowSize){
      // Inner halo — backside Sphere additive, sits direct rond de moon
      // body. Opacity .32 zodat de moon afstaat tegen donkere skybox.
      const haloGeo=new THREE.SphereGeometry(profile.glowSize,seg,seg);
      const haloMat=new THREE.MeshBasicMaterial({
        color:profile.glowColor,
        transparent:true,
        opacity:0.32,
        side:THREE.BackSide,
        blending:THREE.AdditiveBlending,
        depthWrite:false,
        fog:false,
      });
      const halo=new THREE.Mesh(haloGeo,haloMat);
      _moonBillboard.add(halo);
      // Outer soft halo — 1.6× glowSize, lower opacity. Geeft de
      // 'lens-bloom' diffuse glow rond de moon, vooral zichtbaar voor
      // bright moons (arctic, candy) tegen de donkere night skybox.
      const outerGeo=new THREE.SphereGeometry(profile.glowSize*1.6,seg,seg);
      const outerMat=new THREE.MeshBasicMaterial({
        color:profile.glowColor,
        transparent:true,
        opacity:0.12,
        side:THREE.BackSide,
        blending:THREE.AdditiveBlending,
        depthWrite:false,
        fog:false,
      });
      const outer=new THREE.Mesh(outerGeo,outerMat);
      _moonBillboard.add(outer);
    }
  }else if(profile.type==='planets'){
    // Cosmic statement-piece: Saturn-met-ring + secondary planet.
    // Group zodat halo + ring met de body meebewegen onder de pin-loop.
    const seg=window._isMobile?16:24;
    const group=new THREE.Group();
    // Saturn body
    const bodyGeo=new THREE.SphereGeometry(profile.radius,seg,seg);
    const bodyMat=new THREE.MeshBasicMaterial({color:profile.color,fog:false});
    const body=new THREE.Mesh(bodyGeo,bodyMat);
    group.add(body);
    // Ring — Torus tilted 75°, dunner dan body
    if(profile.ringColor){
      const ringGeo=new THREE.TorusGeometry(profile.radius*1.7,profile.radius*0.08,8,seg);
      const ringMat=new THREE.MeshBasicMaterial({
        color:profile.ringColor,
        transparent:true,
        opacity:0.85,
        side:THREE.DoubleSide,
        fog:false,
      });
      const ring=new THREE.Mesh(ringGeo,ringMat);
      ring.rotation.x=Math.PI*0.42;
      ring.rotation.z=Math.PI*0.08;
      group.add(ring);
      // Tweede dunnere ring voor dichtheid
      const ring2Geo=new THREE.TorusGeometry(profile.radius*2.05,profile.radius*0.04,6,seg);
      const ring2Mat=new THREE.MeshBasicMaterial({
        color:profile.ringColor,
        transparent:true,
        opacity:0.55,
        side:THREE.DoubleSide,
        fog:false,
      });
      const ring2=new THREE.Mesh(ring2Geo,ring2Mat);
      ring2.rotation.x=Math.PI*0.42;
      ring2.rotation.z=Math.PI*0.08;
      group.add(ring2);
    }
    // Secondary planet — kleiner, off-center binnen de group
    if(profile.secondaryColor){
      const sGeo=new THREE.SphereGeometry(profile.radius*0.42,seg,seg);
      const sMat=new THREE.MeshBasicMaterial({color:profile.secondaryColor,fog:false});
      const s=new THREE.Mesh(sGeo,sMat);
      s.position.set(profile.radius*3.2,profile.radius*0.6,-profile.radius*0.4);
      group.add(s);
    }
    _moonBillboard=group;
    _moonBillboard.position.copy(_moonDir).multiplyScalar(_moonRadius);
    _moonBillboard.renderOrder=-9;
    _moonBillboard.frustumCulled=false;
    scene.add(_moonBillboard);
  }
  // Initial visibility — toggleNight() runs after this (in scene.js boot
  // sequence), maar als isDark al true is bij world-rebuild willen we
  // direct zichtbaar. Default false omdat toggleNight() pre-flipt naar
  // !target en de echte state via die call landt.
  if(_moonBillboard) _moonBillboard.visible=!!isDark;
}

function buildSunBillboard(){
  // Idempotent: scene.js now calls this for every world after buildWorldMoon,
  // so per-world builders that customise sun direction/radius can still
  // call buildSunBillboard themselves without producing
  // a second sprite. The post-build customisation in those worlds takes
  // effect because they mutate _sunDir / _sunRadius / sprite.position
  // AFTER the early-return.
  if(_sunBillboard && _sunBillboard.parent === scene) return;
  const c=document.createElement('canvas');c.width=128;c.height=128;
  const ctx=c.getContext('2d');
  const grd=ctx.createRadialGradient(64,64,0,64,64,64);
  // Brightness pushed +0.18 on the inner stops so godrays + bloom have
  // a strong enough source to march from. With the previous 0.82 outer
  // opacity the sun rarely cleared the bloom threshold (0.74) once it
  // was modestly off-screen — now the core is ~1.0 + additive blending
  // pushes far past threshold even with sky tint behind.
  grd.addColorStop(0.00, 'rgba(255,255,240,1.00)');
  grd.addColorStop(0.10, 'rgba(255,250,200,1.00)');
  grd.addColorStop(0.30, 'rgba(255,220,140,0.78)');
  grd.addColorStop(0.60, 'rgba(255,180,80,0.28)');
  grd.addColorStop(1.00, 'rgba(255,150,40,0.00)');
  ctx.fillStyle=grd;ctx.fillRect(0,0,128,128);
  const tex=new THREE.CanvasTexture(c);
  const mat=new THREE.SpriteMaterial({map:tex,blending:THREE.AdditiveBlending,transparent:true,opacity:1.0,depthWrite:false});
  _sunBillboard=new THREE.Sprite(mat);
  // Capture sun direction + radius at build-time so updateSky can pin
  // the sprite to camera.position + _sunDir * _sunRadius each frame
  // (kills parallax — sun stays at fixed world-direction from camera).
  _sunDir.set(180,320,80).normalize();
  _sunRadius=500;
  _sunBillboard.position.copy(_sunDir).multiplyScalar(_sunRadius);
  // Scale bumped 240→340 so the sun-disc is large enough to read as a
  // distinct bright source on a 1080p frame at any horizontal angle —
  // godrays-from-bright-source needs the source to cover several screen-
  // pixels, not a sub-pixel dot.
  _sunBillboard.scale.set(340,340,1);
  _sunBillboard.visible=!isDark&&!isRain;
  scene.add(_sunBillboard);
  // Layered sun glow for "lens flare" feel — extra additive sprites stacked
  // around the sun. With bloom on this gives a pleasing radial bloom plus a
  // visible cross-rays burst. Sprites are children so they share visibility.
  // Hot core: tiny intense white/yellow center
  const coreCv=document.createElement('canvas');coreCv.width=64;coreCv.height=64;
  const cCtx=coreCv.getContext('2d');
  const cGr=cCtx.createRadialGradient(32,32,0,32,32,32);
  cGr.addColorStop(0,'rgba(255,255,255,1)');
  cGr.addColorStop(.5,'rgba(255,250,200,0.7)');
  cGr.addColorStop(1,'rgba(255,240,180,0)');
  cCtx.fillStyle=cGr;cCtx.fillRect(0,0,64,64);
  const coreSprite=new THREE.Sprite(new THREE.SpriteMaterial({
    map:new THREE.CanvasTexture(coreCv),blending:THREE.AdditiveBlending,
    transparent:true,opacity:.65,depthWrite:false
  }));
  coreSprite.scale.set(80,80,1);
  _sunBillboard.add(coreSprite);
  // Cross rays: 4-point star burst (vertical + horizontal + diagonals)
  const raysCv=document.createElement('canvas');raysCv.width=256;raysCv.height=256;
  const rCtx=raysCv.getContext('2d');
  rCtx.fillStyle='rgba(0,0,0,0)';rCtx.fillRect(0,0,256,256);
  // Each ray: gradient line from center outward
  const drawRay=(angle,len,width,alpha)=>{
    rCtx.save();rCtx.translate(128,128);rCtx.rotate(angle);
    const g=rCtx.createLinearGradient(0,0,len,0);
    g.addColorStop(0,`rgba(255,240,200,${alpha})`);
    g.addColorStop(.5,`rgba(255,220,150,${alpha*.5})`);
    g.addColorStop(1,'rgba(255,200,120,0)');
    rCtx.fillStyle=g;rCtx.fillRect(0,-width/2,len,width);
    rCtx.fillRect(-len,-width/2,len,width);
    rCtx.restore();
  };
  drawRay(0,120,3,.85);              // horizontal
  drawRay(Math.PI/2,120,3,.85);      // vertical
  drawRay(Math.PI/4,90,2,.55);       // diagonal /
  drawRay(-Math.PI/4,90,2,.55);      // diagonal \
  const raysSprite=new THREE.Sprite(new THREE.SpriteMaterial({
    map:new THREE.CanvasTexture(raysCv),blending:THREE.AdditiveBlending,
    transparent:true,opacity:.42,depthWrite:false
  }));
  raysSprite.scale.set(280,280,1);
  _sunBillboard.add(raysSprite);
  // Outer halo: very soft wide glow (extends bloom further)
  const haloCv=document.createElement('canvas');haloCv.width=128;haloCv.height=128;
  const hCtx=haloCv.getContext('2d');
  const hGr=hCtx.createRadialGradient(64,64,16,64,64,64);
  hGr.addColorStop(0,'rgba(255,200,140,0.4)');
  hGr.addColorStop(.6,'rgba(255,180,100,0.12)');
  hGr.addColorStop(1,'rgba(255,160,80,0)');
  hCtx.fillStyle=hGr;hCtx.fillRect(0,0,128,128);
  const haloSprite=new THREE.Sprite(new THREE.SpriteMaterial({
    map:new THREE.CanvasTexture(haloCv),blending:THREE.AdditiveBlending,
    transparent:true,opacity:.6,depthWrite:false
  }));
  haloSprite.scale.set(520,520,1);
  _sunBillboard.add(haloSprite);
  buildLensFlareGhosts();
  buildGodRays();
}

// Fake volumetric god-rays — additive vertikale "beam" sprites geplaatst
// rond de zon. Ze suggereren stof in de lucht waar zonlicht doorheen valt.
// Sprites blijven auto-billboard (altijd gericht naar camera) → in elke
// camerahoek levendig effect zonder shader-werk.
let _godRays=[];
function _godRayTex(){
  const W=64,H=512,c=document.createElement('canvas');c.width=W;c.height=H;
  const g=c.getContext('2d');
  g.clearRect(0,0,W,H);
  // Vertikale gradient: bright top, fade naar transparent onder
  const grd=g.createLinearGradient(0,0,0,H);
  grd.addColorStop(0,'rgba(255,240,180,0.85)');
  grd.addColorStop(.25,'rgba(255,220,140,0.35)');
  grd.addColorStop(.7,'rgba(255,200,120,0.10)');
  grd.addColorStop(1,'rgba(255,180,90,0)');
  g.fillStyle=grd;g.fillRect(0,0,W,H);
  // Soft edges horizontaal (vignette → beam-shape)
  for(let x=0;x<W;x++){
    const fade=Math.sin(x/(W-1)*Math.PI); // 0..1..0
    g.globalCompositeOperation='destination-in';
    g.fillStyle=`rgba(255,255,255,${fade.toFixed(3)})`;
    g.fillRect(x,0,1,H);
  }
  g.globalCompositeOperation='source-over';
  const t=new THREE.CanvasTexture(c);t.needsUpdate=true;return t;
}
function buildGodRays(){
  // Cleanup oude rays (sprite materials niet door disposeScene opgeruimd)
  _godRays.forEach(r=>{
    if(r.material){if(r.material.map)r.material.map.dispose();r.material.dispose();}
  });
  _godRays.length=0;
  if(!_sunBillboard)return;
  const tex=_godRayTex();
  // 4 beams op licht verschillende offsets rond de zon-positie
  const offsets=[[0,0],[40,12],[-30,-8],[10,-22]];
  offsets.forEach(([dx,dz])=>{
    const mat=new THREE.SpriteMaterial({
      map:tex.clone(),blending:THREE.AdditiveBlending,
      transparent:true,opacity:.18,depthWrite:false
    });
    mat.map.needsUpdate=true;
    const beam=new THREE.Sprite(mat);
    beam.position.copy(_sunBillboard.position);
    beam.position.x+=dx;beam.position.z+=dz;
    beam.position.y-=120; // beam center hangt onder zon → lijkt naar beneden te schijnen
    beam.scale.set(60,220,1);
    // baseOpacity stash voor updateLensFlare in-frame fade
    beam.userData.baseOpacity=.18;
    beam.renderOrder=998; // vóór ghosts (999) maar na rest
    scene.add(beam);
    _godRays.push(beam);
  });
}

// Lens flare ghosts — kleinere additive sprites op de lijn zon→scherm-center.
// Worden geplaatst in scene.world-space en elke frame ge-update via
// updateLensFlare(). Visibility hangt af of de zon zichtbaar is in NDC.
let _lensGhosts=[];
function _ghostTex(rgb){
  const c=document.createElement('canvas');c.width=64;c.height=64;
  const g=c.getContext('2d');
  const grd=g.createRadialGradient(32,32,0,32,32,32);
  grd.addColorStop(0,`rgba(${rgb},1)`);
  grd.addColorStop(.4,`rgba(${rgb},0.45)`);
  grd.addColorStop(1,`rgba(${rgb},0)`);
  g.fillStyle=grd;g.fillRect(0,0,64,64);
  const t=new THREE.CanvasTexture(c);t.needsUpdate=true;return t;
}
function buildLensFlareGhosts(){
  // Dispose stale ghost materials/textures from a previous world build —
  // disposeScene() skips Sprites so we manually clean up.
  _lensGhosts.forEach(g=>{
    if(g.material){
      if(g.material.map)g.material.map.dispose();
      g.material.dispose();
    }
  });
  _lensGhosts.length=0;
  // [factor, rgb, scale, baseOpacity]
  // factor: 0=at sun, 1=at center, 2=opposite of sun
  const defs=[
    [0.30,'255,210,150',  6,0.55],
    [0.55,'180,220,255',  4,0.50],
    [0.85,'255,180,200',  3,0.45],
    [1.15,'200,180,255',  5,0.55],
    [1.45,'255,240,180',  3,0.40],
    [1.85,'255,200,160',  7,0.50]
  ];
  defs.forEach(d=>{
    const [factor,rgb,scale,baseOp]=d;
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({
      map:_ghostTex(rgb),
      blending:THREE.AdditiveBlending,
      transparent:true,
      depthWrite:false,
      depthTest:false,
      opacity:0
    }));
    sp.scale.set(scale,scale,1);
    sp.visible=false;
    sp.userData.factor=factor;
    sp.userData.baseOpacity=baseOp;
    sp.renderOrder=999; // draw last
    scene.add(sp);
    _lensGhosts.push(sp);
  });
}
const _lfNDC=new THREE.Vector3();
const _lfFwd=new THREE.Vector3(),_lfUp=new THREE.Vector3(),_lfRight=new THREE.Vector3();
function updateLensFlare(){
  if(!_sunBillboard||!camera)return;
  // Vroeger gebruikte deze functie 7 forEach calls per frame (= 7 closure-
  // allocaties × 60fps = 420/sec). Indexed for-loops scheelt de allocaties.
  const _gN=_godRays.length;
  const _lN=_lensGhosts.length;
  if(!_sunBillboard.visible){
    for(let i=0;i<_lN;i++) _lensGhosts[i].visible=false;
    for(let i=0;i<_gN;i++) _godRays[i].visible=false;
    return;
  }
  _lfNDC.copy(_sunBillboard.position).project(camera);
  // Achter camera or far off-screen → hide
  const offscreen=(_lfNDC.z>1||Math.abs(_lfNDC.x)>1.4||Math.abs(_lfNDC.y)>1.4);
  if(offscreen){
    for(let i=0;i<_lN;i++) _lensGhosts[i].visible=false;
    // God-rays blijven zichtbaar offscreen — daar zijn ze juist subtiel
    // background-detail dat geen gameplay-blocker is. Reset naar baseOp.
    for(let i=0;i<_gN;i++){
      const b=_godRays[i];
      b.visible=true;
      b.material.opacity=b.userData.baseOpacity||.18;
    }
    return;
  }
  // ── In-frame whiteout suppressie ────────────────────────────────────
  // Wanneer de zon binnen ~50% van het scherm-centrum zit (frontal in
  // beeld), verlaag god-ray opacity drastisch. Dit voorkomt dat de
  // verticale beams als witte/gele balken uit de grond schijnen op het
  // rechte stuk waar de speler de track moet zien. Bij sun-aan-de-rand
  // (offscreen-naderend) lossen ze geleidelijk weer op.
  const sunCenterDist=Math.max(Math.abs(_lfNDC.x),Math.abs(_lfNDC.y));
  // 0..0.5 NDC = volledige whiteout-zone; 0.5..1.0 = lerp terug naar normaal
  const grayFade=sunCenterDist<0.5?0.20:Math.min(1,(sunCenterDist-0.5)/0.5);
  for(let i=0;i<_gN;i++){
    const b=_godRays[i];
    b.visible=true;
    b.material.opacity=(b.userData.baseOpacity||.18)*grayFade;
  }
  if(!_lN)return;
  camera.getWorldDirection(_lfFwd);
  _lfRight.set(1,0,0).applyQuaternion(camera.quaternion);
  _lfUp.set(0,1,0).applyQuaternion(camera.quaternion);
  const dist=80;
  const fH=2*dist*Math.tan(camera.fov*Math.PI/360);
  const fW=fH*camera.aspect;
  const dEdge=Math.max(Math.abs(_lfNDC.x),Math.abs(_lfNDC.y));
  const fadeBase=Math.max(0,1-dEdge*0.65);
  // Lens ghost opacity wordt ook in-frame iets gedempt — niet zo hard als
  // godrays want ghosts zijn visueel pleasing en niet blokkerend.
  const ghostInFrameMul=sunCenterDist<0.5?0.55:1.0;
  for(let i=0;i<_lN;i++){
    const g=_lensGhosts[i];
    const f=g.userData.factor;
    const px=_lfNDC.x*(1-f), py=_lfNDC.y*(1-f);
    g.position.copy(camera.position)
      .addScaledVector(_lfFwd,dist)
      .addScaledVector(_lfRight,px*fW*0.5)
      .addScaledVector(_lfUp,py*fH*0.5);
    g.visible=true;
    g.material.opacity=fadeBase*g.userData.baseOpacity*_sunBillboard.material.opacity*ghostInFrameMul;
  }
}


// Shared mip-filter setup voor canvas-board-textures langs de track-rand.
// Texture moet PoT zijn (WebGL1 op iOS Safari rejecteert mip-generatie op
// NPOT met silent black-texture fallback). Anisotropy gecapt door renderer.
function _applyBoardTexFiltering(tex){
  tex.minFilter=THREE.LinearMipmapLinearFilter;
  tex.magFilter=THREE.LinearFilter;
  tex.generateMipmaps=true;
  if(window.renderer&&window.renderer.capabilities)
    tex.anisotropy=Math.min(8,window.renderer.capabilities.getMaxAnisotropy()||1);
  tex.needsUpdate=true;
}

function buildCornerBoards(){
  // Numbered boards T1-T8 at each major corner entry, outside of track
  const corners=[
    {t:.165,name:'T1',col:0xff3300},
    {t:.215,name:'T2',col:0xff6600},
    {t:.385,name:'T3',col:0xffcc00},
    {t:.465,name:'T4',col:0x88ee00},
    {t:.535,name:'T5',col:0x00bb44},
    {t:.685,name:'T6',col:0x0088ff},
    {t:.745,name:'T7',col:0x3300ee},
    {t:.795,name:'T8',col:0xbb00ee},
  ];
  corners.forEach(({t,name,col})=>{
    const p=trackCurve.getPoint(t);
    const tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    // Place board on the outside edge of the track
    const bPos=p.clone().addScaledVector(nr,TW+4.2);
    bPos.y=0;
    // Post
    const post=new THREE.Mesh(new THREE.BoxGeometry(.28,3.2,.28),
      new THREE.MeshLambertMaterial({color:0xffffff}));
    post.position.set(bPos.x,1.6,bPos.z);scene.add(post);
    // Colored board with canvas texture number. PoT (64×64): nodig
    // omdat iOS Safari WebGL1 mip-generatie op NPOT silent failt → black
    // texture. We voegen 6px verticale padding toe boven het 64×52
    // tekst-blok zodat de letter centered blijft.
    const cvs=document.createElement('canvas');cvs.width=64;cvs.height=64;
    const cx=cvs.getContext('2d');
    cx.fillStyle='#'+col.toString(16).padStart(6,'0');cx.fillRect(0,0,64,64);
    cx.strokeStyle='rgba(255,255,255,0.6)';cx.lineWidth=3;cx.strokeRect(2,2,60,60);
    cx.fillStyle='#ffffff';cx.font='bold 26px Arial';cx.textAlign='center';cx.textBaseline='middle';
    cx.fillText(name,32,32);
    const tex=new THREE.CanvasTexture(cvs);
    // Mip-mapping + anisotropy: zonder dit aliasen de 8 bonte corner-
    // boards (regenboog rood→paars rond de track) op middenafstand op
    // iOS Safari → "regenboog-shimmer langs de track-randen".
    _applyBoardTexFiltering(tex);
    const board=new THREE.Mesh(new THREE.BoxGeometry(3.2,2.0,.14),
      new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));
    board.position.set(bPos.x,3.4,bPos.z);
    board.rotation.y=Math.atan2(-tg.x,-tg.z);
    scene.add(board);
  });
}


function buildAdvertisingBoards(){
  const defs=[
    {t:.03,s:1,  text:["SPENCER'S","RACE CLUB"], bg:'#1a0030',fg:'#cc66ff'},
    {t:.32,s:-1, text:["DRIFT KING"],            bg:'#001a44',fg:'#00ccff'},
    {t:.62,s:1,  text:["SPEED ZONE"],            bg:'#001a00',fg:'#44ff88'},
    {t:.88,s:-1, text:["CHEQUERED","FLAG"],      bg:'#111111',fg:'#ffffff'},
  ];
  const poleMat=new THREE.MeshLambertMaterial({color:0x999999});
  defs.forEach(({t,s,text,bg,fg})=>{
    const p=trackCurve.getPoint(t);
    const tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    const pos=p.clone().addScaledVector(nr,s*(BARRIER_OFF+7.5));
    // Canvas texture with bold text
    const cv=document.createElement('canvas');cv.width=256;cv.height=128;
    const cx=cv.getContext('2d');
    cx.fillStyle=bg;cx.fillRect(0,0,256,128);
    cx.fillStyle=fg;cx.font='bold 32px Arial';cx.textAlign='center';cx.textBaseline='middle';
    const lineH=text.length>1?40:0;
    const startY=64-(text.length-1)*lineH*.5;
    text.forEach((line,i)=>cx.fillText(line,128,startY+i*lineH));
    cx.strokeStyle=fg;cx.lineWidth=5;cx.strokeRect(4,4,248,120);
    const tex=new THREE.CanvasTexture(cv);
    // 256×128 is PoT; mip-filtering veilig. Helper voorkomt duplicatie.
    _applyBoardTexFiltering(tex);
    const board=new THREE.Mesh(new THREE.PlaneGeometry(10,5),
      new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));
    board.position.copy(pos);board.position.y=4.0;
    board.rotation.y=Math.atan2(nr.x*s,nr.z*s);
    scene.add(board);
    // Two support poles
    const fwd=new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),board.rotation.y);
    [-4,4].forEach(ox=>{
      const pole=new THREE.Mesh(new THREE.CylinderGeometry(.1,.13,8,6),poleMat);
      pole.position.copy(pos).addScaledVector(fwd,ox);pole.position.y=4;
      scene.add(pole);
    });
  });
}


function updateSky(dt){
  _skyT+=(_skyTarget-_skyT)*Math.min(1,dt*0.55);
  scene.fog.color.lerpColors(_fogColorDay,_fogColorNight,_skyT);
  // Pin sun + stars to the camera position so direction-from-camera
  // stays constant. _sunBillboard at world-distance 500 used to show
  // visible parallax across a 600u-wide track (sun appeared to drift
  // left/right with track-bochten). Setting world-position to camera-
  // position + _sunDir * _sunRadius each frame gives the
  // "infinitely far" illusion at zero shader/perf cost.
  if(camera){
    if(_sunBillboard){
      _sunBillboard.position.copy(_sunDir).multiplyScalar(_sunRadius).add(camera.position);
    }
    // Moon shares the sun-pin pattern: world-direction × distance offset
    // from camera.position, so direction-from-camera stays constant frame
    // to frame. 360° camera yaw = moon disappears achter je. NIET
    // camera-parented; pure positional pin.
    if(_moonBillboard){
      _moonBillboard.position.copy(_moonDir).multiplyScalar(_moonRadius).add(camera.position);
    }
    // Stars: same pin, but the entire InstancedMesh is shifted as a
    // group (origin tracks camera). Per-instance world positions are
    // baked into the instance matrices, so shifting the parent
    // origin is equivalent to placing the star-cloud around the
    // camera's current position — no instance-matrix rewrite needed.
    if(stars)stars.position.copy(camera.position);
  }
  // Subtle sun brightness modulation
  if(_sunBillboard&&_sunBillboard.material){
    const tgt=_skyT<0.5?0.82*(1-_skyT*2)*(isRain?0.3:1):0;
    _sunBillboard.material.opacity+=(tgt-_sunBillboard.material.opacity)*Math.min(1,dt*1.2);
  }
  // Stars twinkle — slowly modulate star material opacity
  if(stars&&stars.visible&&stars.material){
    const twinkle=0.82+Math.sin(_nowSec*1.7)*0.10+Math.sin(_nowSec*3.1)*0.05;
    stars.material.opacity=twinkle;
  }
  updateLensFlare();
  // God-rays volgen sun visibility + opacity
  if(_godRays.length&&_sunBillboard){
    const sunOp=_sunBillboard.visible?_sunBillboard.material.opacity:0;
    _godRays.forEach((r,i)=>{
      r.visible=_sunBillboard.visible&&sunOp>.05;
      const pulse=.45+Math.sin(_nowSec*.4+i*.7)*.15;
      r.material.opacity=sunOp*pulse;
    });
  }
}


function buildNightObjects(){
  for(let i=0;i<30;i++){
    const t=i/30,p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    [-1,1].forEach(side=>{
      const pp=p.clone().addScaledVector(nr,side*(BARRIER_OFF+2));
      const pole=new THREE.Mesh(new THREE.CylinderGeometry(.08,.1,9,6),
        new THREE.MeshLambertMaterial({color:0x888888}));
      pole.position.copy(pp);pole.position.y=4.5;pole.visible=false;
      scene.add(pole);trackPoles.push(pole);
      const lamp=new THREE.Mesh(new THREE.BoxGeometry(.6,.22,1.2),
        new THREE.MeshLambertMaterial({color:0xffffcc,emissive:0x888844}));
      lamp.position.copy(pp);lamp.position.y=9.2;lamp.visible=false;
      scene.add(lamp);trackPoles.push(lamp);
      const pl=new THREE.PointLight(0xffdd88,0,38);
      pl.position.copy(pp);pl.position.y=9;scene.add(pl);trackLightList.push(pl);
    });
  }
  const sg=new THREE.SphereGeometry(.28,4,4),sm=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1});
  stars=new THREE.InstancedMesh(sg,sm,380);stars.visible=false;
  const dm=new THREE.Object3D();
  for(let i=0;i<380;i++){
    const th=Math.random()*Math.PI*2,ph=Math.random()*Math.PI*.48,r=350+Math.random()*100;
    dm.position.set(r*Math.sin(ph)*Math.cos(th),r*Math.cos(ph)*.5+160,r*Math.sin(ph)*Math.sin(th)+220);
    const starSize=i<60?2.2+Math.random()*1.2:.6+Math.random()*1.6;// brighter foreground stars
    dm.scale.setScalar(starSize);dm.updateMatrix();stars.setMatrixAt(i,dm.matrix);
  }
  stars.instanceMatrix.needsUpdate=true;scene.add(stars);
  // Moon — large glowing sphere high in the sky
  const moonGeo=new THREE.SphereGeometry(12,16,16);
  const moonMat=new THREE.MeshBasicMaterial({color:0xe8eef8});
  const moon=new THREE.Mesh(moonGeo,moonMat);
  moon.position.set(-180,280,-120);moon.visible=false;
  scene.add(moon);trackPoles.push(moon);
  // Moon glow halo
  const haloGeo=new THREE.SphereGeometry(18,16,16);
  const haloMat=new THREE.MeshBasicMaterial({color:0x8899cc,transparent:true,opacity:.14,side:THREE.BackSide});
  const halo=new THREE.Mesh(haloGeo,haloMat);
  halo.position.copy(moon.position);halo.visible=false;
  scene.add(halo);trackPoles.push(halo);
  plHeadL=new THREE.SpotLight(0xffffff,0,50,Math.PI*.16,.5);
  plHeadR=new THREE.SpotLight(0xffffff,0,50,Math.PI*.16,.5);
  scene.add(plHeadL);scene.add(plHeadL.target);scene.add(plHeadR);scene.add(plHeadR.target);
  plTail=new THREE.PointLight(0xff2200,0,10);scene.add(plTail);
}


function buildParticles(){
  sparkSystem=new SimpleParticles(_mobCount(300),scene);
  exhaustSystem=new SimpleParticles(_mobCount(200),scene);
  // Session 02 — texture variants for tire smoke, ambient dust, sharp sparks.
  // smokeSystem: drift smoke, exhaust plume — gentle upward drift, expands.
  // sparkleSystem: collision sparks, brake flares — fast, shrinks, falls hard.
  // dustSystem: per-world ambient swirls, water spray, road grit.
  smokeSystem=new SimpleParticles(_mobCount(180),scene,{
    kind:'smoke',size:0.7,gravity:-0.002,growthBase:0.5,growthRate:1.6
  });
  sparkleSystem=new SimpleParticles(_mobCount(120),scene,{
    kind:'spark',size:0.45,gravity:0.022,growthBase:1.1,growthRate:-0.7
  });
  dustSystem=new SimpleParticles(_mobCount(220),scene,{
    kind:'dust',size:0.85,gravity:0.0,growthBase:0.7,growthRate:0.9
  });
}


function buildWorldElements(){
  if(activeWorld==='space'){
    buildGravityZones(); buildOrbitingAsteroids(); buildWarpTunnels();
    if(typeof buildSpaceAnomaly==='function')buildSpaceAnomaly();
  }
  else if(activeWorld==='deepsea'){
    buildCurrentStreams(); buildAbyssCracks(); buildTreasureTrail();
    if(typeof buildDeepSeaCurrent==='function')buildDeepSeaCurrent();
  }
}

