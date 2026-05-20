// js/cars/livery.js — Phase 8.1: procedural per-brand livery decals.
// Non-module script, loaded after car-parts.js / brands.js, vóór build.js
// zodat makeCar() de buildLivery() helper kan callen.
//
// Approach: NIET de car body material texturen (vereist UV-rewrite op
// alle 13 brand builders). In plaats daarvan een platte decal-mesh
// (PlaneGeometry 1.8×1.0) bovenop het dak van elke car. Material is
// MeshLambertMaterial met canvas-map + alphaTest 0.5 zodat de decal-rand
// crisp blijft. Per-brand canvas pattern via dispatch table.
//
// Geen vendor logos (copyright) — abstract stripes/checkers/numbers per
// brand identity. Canvas is shared cross-cars met zelfde brand+accent
// via _liveryTexCache.

'use strict';

const _liveryTexCache = {};

function _buildLiveryCanvas(brandKey, accentColor){
  const W=512, H=256;
  const c=document.createElement('canvas');
  c.width=W; c.height=H;
  const g=c.getContext('2d');
  // Transparent base — alphaTest cuts away anything below 0.5
  g.clearRect(0,0,W,H);
  const hexAccent='#'+accentColor.toString(16).padStart(6,'0');

  switch(brandKey){
    case 'FERRARI': {
      // Twin stripes lengthwise — racing red
      g.fillStyle=hexAccent;
      g.fillRect(0,H*0.30,W,18);
      g.fillRect(0,H*0.62,W,18);
      g.fillStyle='#fff';
      g.font='bold 110px Arial'; g.textAlign='center';
      g.fillText('SF',W*0.5,H*0.65);
      break;
    }
    case 'BUGATTI': {
      // Horseshoe-style accent + center number
      g.strokeStyle=hexAccent; g.lineWidth=14;
      g.beginPath();
      g.moveTo(W*0.15, H*0.15);
      g.lineTo(W*0.15, H*0.85);
      g.lineTo(W*0.85, H*0.85);
      g.lineTo(W*0.85, H*0.15);
      g.stroke();
      g.fillStyle='#fff';
      g.font='bold 130px Arial'; g.textAlign='center';
      g.fillText('CH',W*0.5,H*0.65);
      break;
    }
    case 'LAMBORGHINI': {
      // Diagonal hash stripes — angular Italian
      g.strokeStyle=hexAccent; g.lineWidth=12;
      for(let i=-8;i<8;i++){
        g.beginPath();
        g.moveTo(W*0.1+i*40, 0); g.lineTo(W*0.1+i*40+H, H);
        g.stroke();
      }
      break;
    }
    case 'MCLAREN': {
      // Speed-streak swoosh
      g.fillStyle=hexAccent;
      g.beginPath();
      g.moveTo(0, H*0.45); g.lineTo(W, H*0.30);
      g.lineTo(W, H*0.55); g.lineTo(0, H*0.70);
      g.closePath(); g.fill();
      break;
    }
    case 'PORSCHE': {
      // Centered crest-like badge area
      g.fillStyle=hexAccent;
      g.fillRect(W*0.35, H*0.25, W*0.30, H*0.50);
      g.fillStyle='#fff';
      g.fillRect(W*0.42, H*0.32, W*0.16, H*0.36);
      g.fillStyle=hexAccent;
      g.font='bold 80px Arial'; g.textAlign='center';
      g.fillText('911',W*0.5,H*0.62);
      break;
    }
    case 'AUDI': {
      // Four overlapping circles (abstracted Audi rings)
      g.strokeStyle=hexAccent; g.lineWidth=10;
      for(let i=0;i<4;i++){
        g.beginPath();
        g.arc(W*0.25+i*W*0.18, H*0.5, 35, 0, Math.PI*2);
        g.stroke();
      }
      break;
    }
    case 'MASERATI': {
      // Trident-suggested triple-stripe vertical
      g.fillStyle=hexAccent;
      g.fillRect(W*0.30, H*0.15, 14, H*0.70);
      g.fillRect(W*0.49, H*0.10, 14, H*0.80);
      g.fillRect(W*0.68, H*0.15, 14, H*0.70);
      break;
    }
    case 'KOENIGSEGG': {
      // Checker pattern top-left
      g.fillStyle=hexAccent;
      for(let y=0;y<2;y++)for(let x=0;x<6;x++){
        if((x+y)%2===0) g.fillRect(x*60, y*60, 60, 60);
      }
      g.fillStyle='#fff';
      g.font='bold 100px Arial'; g.textAlign='center';
      g.fillText('K1',W*0.65,H*0.65);
      break;
    }
    case 'RED BULL': {
      // Twin charging stripes + #1
      g.fillStyle=hexAccent;
      g.fillRect(W*0.05, H*0.20, W*0.90, 30);
      g.fillRect(W*0.05, H*0.62, W*0.90, 30);
      g.fillStyle='#ffff00'; // signature yellow
      g.font='bold 140px Arial'; g.textAlign='center';
      g.fillText('1',W*0.5,H*0.55);
      break;
    }
    case 'MERCEDES': {
      // Triple-pointed star outlined (geometric, not the logo)
      g.strokeStyle=hexAccent; g.lineWidth=14;
      const cx=W*0.5, cy=H*0.5, r=70;
      for(let i=0;i<3;i++){
        const a=Math.PI*1.5 + i*(Math.PI*2/3);
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx+Math.cos(a)*r, cy+Math.sin(a)*r);
        g.stroke();
      }
      break;
    }
    case 'FORD': {
      // American oval shape outline
      g.strokeStyle=hexAccent; g.lineWidth=18;
      g.beginPath();
      g.ellipse(W*0.5, H*0.5, W*0.30, H*0.30, 0, 0, Math.PI*2);
      g.stroke();
      g.fillStyle=hexAccent;
      g.font='bold italic 70px Arial'; g.textAlign='center';
      g.fillText('GT',W*0.5,H*0.6);
      break;
    }
    case 'TESLA': {
      // Minimalist "T" angular logo (abstract)
      g.fillStyle=hexAccent;
      g.fillRect(W*0.20, H*0.30, W*0.60, 28);
      g.fillRect(W*0.46, H*0.30, 28, H*0.55);
      break;
    }
    case 'GROUPB': {
      // Rally-stage hash marks — bold diagonal stripe pair
      g.fillStyle=hexAccent;
      g.save();
      g.translate(W*0.5, H*0.5);
      g.rotate(-0.35);
      g.fillRect(-W*0.6, -45, W*1.2, 28);
      g.fillRect(-W*0.6, +25, W*1.2, 28);
      g.restore();
      g.fillStyle='#fff';
      g.font='bold 110px Arial'; g.textAlign='center';
      g.fillText('B',W*0.5,H*0.62);
      break;
    }
    default: {
      // Fallback — solid color band
      g.fillStyle=hexAccent;
      g.fillRect(0, H*0.40, W, H*0.20);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  tex.userData = { _sharedAsset: true };
  return tex;
}

function _getLiveryTex(brandKey, accentColor, carNumber){
  // Phase 9.4 — cache-key includes carNumber zodat elke car een eigen
  // unique decal-tex krijgt (1-12). 13 brands × 12 cars max = 156 entries
  // max bij volledige variation; in praktijk veel minder (max 10 cars per
  // race × 1 brand per car = 10 entries actueel in gebruik).
  const cacheKey = brandKey + '_' + accentColor.toString(16) + '_' + (carNumber || 0);
  if(_liveryTexCache[cacheKey]) return _liveryTexCache[cacheKey];
  const tex = _buildLiveryCanvas(brandKey, accentColor);
  // Phase 9.4 — paint carNumber bottom-right corner van canvas.
  // Wordt vóór CanvasTexture maken gedaan — door _buildLiveryCanvas
  // direct te modden. Simpler: post-process de canvas.
  if(carNumber && carNumber > 0){
    const c = tex.image;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.font = 'bold 56px Arial'; g.textAlign = 'right';
    g.fillText(String(carNumber), c.width - 12, c.height - 14);
    tex.needsUpdate = true;
  }
  _liveryTexCache[cacheKey] = tex;
  return tex;
}

// Build livery decal voor een car-group. Plakt 1 platte decal-plane
// bovenop het dak (zichtbaar van chase-cam). F1 cars hebben geen dak —
// skip decal voor die op nose mount placement risk; in plaats daarvan
// een kleinere decal op de nose-cone (z<0, y wat lager).
function buildLivery(carGroup, def, accentColor, carNumber){
  if(!def.brand) return;
  const tex = _getLiveryTex(def.brand, accentColor || 0xffffff, carNumber || 0);
  const mat = new THREE.MeshLambertMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });

  const isF1 = def.type === 'f1';
  const isMuscle = def.type === 'muscle';
  const isRally = def.type === 'rally';

  if(isF1){
    // F1 has no roof — mount kleinere decal op de nose-cone instead.
    // Hotfix Phase 9.5: y +0.02 om z-fight met body in steep angles
    // te vermijden (was 0.55, nu 0.57).
    const noseGeo = new THREE.PlaneGeometry(0.8, 0.5);
    const nose = new THREE.Mesh(noseGeo, mat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 0.57, -1.6);
    nose.userData._isLivery = true;
    carGroup.add(nose);
  } else {
    // Standard roof decal
    // Hotfix Phase 9.5: y +0.02 op alle car-types tegen z-fight flicker.
    const roofY = isMuscle ? 0.97 : isRally ? 1.07 : 0.94;
    const roofGeo = new THREE.PlaneGeometry(1.8, 1.0);
    const roof = new THREE.Mesh(roofGeo, mat);
    roof.rotation.x = -Math.PI / 2;
    roof.position.set(0, roofY, 0);
    roof.userData._isLivery = true;
    carGroup.add(roof);
  }
}

if(typeof window !== 'undefined'){
  window.buildLivery = buildLivery;
}
