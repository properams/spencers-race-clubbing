// js/effects/horizon.js — non-module script.
//
// Per-wereld horizon-silhouette systeem (Sessie WORLD_AUDIT 2026-05-09).
// Voorheen kreeg elke wereld dezelfde jagged-mountain shape via
// js/track/environment.js _silhouetteTex(). Per-wereld variant alleen
// kleur + jaggedness — visueel verwarrend (deepsea horizon = bergen, etc.).
//
// Dit module exposeert:
//   _buildHorizonSilhouette(profile) — geeft een CanvasTexture terug
//     gegeven een profile met silhouetteType selector. Returnt null
//     als type niet bekend is — caller valt dan terug op legacy
//     _silhouetteTex / _SILHOUETTE_PALETTES.
//   WORLD_HORIZON_PROFILE — per-wereld lookup met silhouetteType +
//     visual params. Worlds zonder entry blijven het legacy
//     mountain-pad gebruiken (sandstorm, pier47, volcano, candy in
//     de eerste pass).
//
// Generators beschikbaar:
//   kelpForest    — vertical pillars die uitfanen aan top (deepsea)
//   iceShards     — scherpe driehoekige ice-peaks (arctic)
//   candyHills    — cake-layers + cream-bumps (candy upgrade)
//   volcanicPeaks — scherpere cone-profielen + lava-cracks (volcano upgrade)
//
// Canvas-output dimensions matchen js/track/environment.js _silhouetteTex
// (2048×384) zodat de CylinderGeometry-tiling identiek werkt.

'use strict';

const _HORIZON_W=2048;
const _HORIZON_H=384;

function _hzSeedRnd(seed){
  let s=seed||1;
  return ()=>{ s=(s*9301+49297)%233280; return s/233280; };
}

function _hzMakeCanvas(){
  const c=document.createElement('canvas');
  c.width=_HORIZON_W;
  c.height=_HORIZON_H;
  return {c, g:c.getContext('2d')};
}

function _hzGradFill(g, accent, base){
  const grad=g.createLinearGradient(0, _HORIZON_H*0.15, 0, _HORIZON_H);
  grad.addColorStop(0, accent);
  grad.addColorStop(1, base);
  return grad;
}

function _hzToTex(c){
  const t=new THREE.CanvasTexture(c);
  t.wrapS=THREE.RepeatWrapping;
  t.wrapT=THREE.ClampToEdgeWrapping;
  t.needsUpdate=true;
  if(window.ThreeCompat && ThreeCompat.applyTextureColorSpace) ThreeCompat.applyTextureColorSpace(t);
  return t;
}

// ── Generator: kelpForest ──────────────────────────────────────────────
// Vertical kelp-stalk pillars die curve-out aan top. Optioneel
// bioluminescent dots (profile.glowColor) verspreid in het canopy.
function _hzGenKelpForest(profile){
  const {c,g}=_hzMakeCanvas();
  const rnd=_hzSeedRnd(profile.seed);
  const baseY=_HORIZON_H*0.88;
  g.fillStyle=_hzGradFill(g, profile.accent, profile.color);
  // Sea-floor band onder de kelp
  g.fillRect(0, baseY, _HORIZON_W, _HORIZON_H-baseY);
  // 14 pillars met variërende hoogte, sommige overlappen
  const COUNT=14;
  for(let i=0;i<COUNT;i++){
    const x=(i+rnd()*0.8)*(_HORIZON_W/COUNT);
    const w=22+rnd()*38;
    const h=170+rnd()*150;
    const topY=baseY-h;
    g.beginPath();
    // Linker stalk-curve
    g.moveTo(x-w*0.45, baseY);
    g.bezierCurveTo(x-w*0.6, baseY-h*0.4, x-w*0.35, topY+30, x-w*0.55, topY);
    // Top-fan: 3 horizontal flares
    for(let k=0;k<3;k++){
      const fx=x+(k-1)*w*0.65;
      const fy=topY-25+rnd()*40;
      g.lineTo(fx, fy);
      g.lineTo(fx+w*0.32, fy+20);
    }
    // Rechter stalk-curve terug naar base
    g.bezierCurveTo(x+w*0.55, topY, x+w*0.85, baseY-h*0.35, x+w*0.45, baseY);
    g.closePath();
    g.fill();
  }
  // Bioluminescent dots — alleen als profile.glowColor gegeven
  if(profile.glowColor){
    g.fillStyle=profile.glowColor;
    for(let i=0;i<32;i++){
      const x=rnd()*_HORIZON_W;
      const y=baseY-rnd()*220;
      g.globalAlpha=0.45+rnd()*0.45;
      g.beginPath();
      g.arc(x, y, 2+rnd()*3, 0, Math.PI*2);
      g.fill();
    }
    g.globalAlpha=1;
  }
  return c;
}

// ── Generator: iceShards ──────────────────────────────────────────────
// Scherpe ice-shards met glacier-wall achtergrondband. Smaller width +
// taller dan klassieke mountains zodat ze niet verward worden.
function _hzGenIceShards(profile){
  const {c,g}=_hzMakeCanvas();
  const rnd=_hzSeedRnd(profile.seed);
  const baseY=_HORIZON_H*0.85;
  g.fillStyle=_hzGradFill(g, profile.accent, profile.color);
  // Glacier wall — solid band onderin als basis
  g.fillRect(0, baseY+8, _HORIZON_W, _HORIZON_H-baseY-8);
  // 22 sharp shards bovenop
  const COUNT=22;
  for(let i=0;i<COUNT;i++){
    const x=(i+rnd()*0.5)*(_HORIZON_W/COUNT);
    const w=24+rnd()*48;
    const h=80+rnd()*230;
    const topY=baseY-h;
    g.beginPath();
    g.moveTo(x-w*0.5, baseY);
    g.lineTo(x+(rnd()-0.5)*w*0.4, topY);
    g.lineTo(x+w*0.5, baseY);
    g.closePath();
    g.fill();
  }
  return c;
}

// ── Helper: candy castle ──────────────────────────────────────────────
function _hzDrawCandyCastle(g, cx, baseY, scale, profile){
  const wall = profile.wallColor || '#C9A8C4';
  const roof = profile.roofColor || '#7DD8C8';
  const arch = profile.archColor || '#3A2840';
  const base = profile.baseColor || '#A8D898';
  const stripe = profile.baseStripeColor || '#88C088';
  const S = scale;
  g.fillStyle = base;
  g.fillRect(cx-90*S, baseY-12*S, 180*S, 12*S);
  g.fillStyle = stripe;
  for(let i=0;i<3;i++) g.fillRect(cx-90*S, baseY-10*S+i*4*S, 180*S, 1.5*S);
  g.fillStyle = wall;
  g.fillRect(cx-50*S, baseY-90*S, 100*S, 78*S);
  g.fillRect(cx-78*S, baseY-70*S, 28*S, 58*S);
  g.fillRect(cx+50*S, baseY-70*S, 28*S, 58*S);
  g.fillStyle = arch;
  g.beginPath();
  g.arc(cx, baseY-30*S, 14*S, Math.PI, 0);
  g.lineTo(cx+14*S, baseY-12*S);
  g.lineTo(cx-14*S, baseY-12*S);
  g.closePath();
  g.fill();
  g.fillStyle = roof;
  g.beginPath();
  g.arc(cx, baseY-90*S, 50*S, Math.PI, 0); g.fill();
  g.beginPath();
  g.arc(cx-64*S, baseY-70*S, 14*S, Math.PI, 0); g.fill();
  g.beginPath();
  g.arc(cx+64*S, baseY-70*S, 14*S, Math.PI, 0); g.fill();
  g.fillStyle = roof;
  g.beginPath();
  g.moveTo(cx, baseY-90*S-40*S);
  g.lineTo(cx-8*S, baseY-90*S);
  g.lineTo(cx+8*S, baseY-90*S);
  g.closePath();
  g.fill();
}

// ── Helper: candy balloons ────────────────────────────────────────────
function _hzDrawCandyBalloons(g, profile, rnd){
  const n = profile.balloons || 0;
  const palettes = [
    ['#ff99cc','#ffffff'],
    ['#7DD8C8','#ffffff'],
    ['#cc99ff','#ffffff'],
    ['#ffd9b8','#ee5588']
  ];
  for(let i=0;i<n;i++){
    const cx = (i+0.5)*(_HORIZON_W/n) + (rnd()-0.5)*120;
    const cy = 80 + rnd()*60;
    const r = 22 + rnd()*8;
    const pal = palettes[i % palettes.length];
    g.save();
    g.translate(cx, cy);
    g.scale(1, 1.25);
    g.fillStyle = pal[0];
    g.beginPath(); g.arc(0, 0, r, Math.PI*0.5, Math.PI*1.5); g.fill();
    g.fillStyle = pal[1];
    g.beginPath(); g.arc(0, 0, r, Math.PI*1.5, Math.PI*2.5); g.fill();
    g.restore();
    g.fillStyle = '#8b5a2b';
    g.fillRect(cx-5, cy+r*1.35, 10, 6);
    g.strokeStyle = '#444';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx-5, cy+r*1.35); g.lineTo(cx-r*0.7, cy+r*1.1);
    g.moveTo(cx+5, cy+r*1.35); g.lineTo(cx+r*0.7, cy+r*1.1);
    g.stroke();
  }
}

// ── Generator: candyHills ─────────────────────────────────────────────
// Cake-layer slabs onderaan + cream-bump ronde toppen. Geeft een
// "patisserie horizon" feel — geen mountain-shape meer.
function _hzGenCandyHills(profile){
  const {c,g}=_hzMakeCanvas();
  const rnd=_hzSeedRnd(profile.seed);
  const baseY=_HORIZON_H*0.88;
  g.fillStyle=_hzGradFill(g, profile.accent, profile.color);
  // 6 banded layer-cake slabs
  const bandColors = profile.bandColors || null;
  for(let i=0;i<6;i++){
    const cx=(i+rnd())*(_HORIZON_W/6);
    const w=180+rnd()*120;
    const h=90+rnd()*80;
    if(bandColors){
      const bandH = h / bandColors.length;
      for(let b=0;b<bandColors.length;b++){
        g.fillStyle = bandColors[b];
        g.fillRect(cx-w/2, baseY-h+(b*bandH), w, bandH);
      }
    }else{
      g.fillRect(cx-w/2, baseY-h, w, h);
    }
  }
  // Castle (Option A: scale=0.6, 5× tile repeat → 5 castles)
  if(profile.castle){
    _hzDrawCandyCastle(g, _HORIZON_W*0.35, baseY, 0.6, profile);
  }
  // 10 cream-bumps (half-circles + verticaal terug naar baseline)
  for(let i=0;i<10;i++){
    const cx=rnd()*_HORIZON_W;
    const r=48+rnd()*48;
    const cy=baseY-90-rnd()*70;
    g.beginPath();
    g.arc(cx, cy, r, Math.PI, 0); // top half-circle
    g.lineTo(cx+r, baseY);
    g.lineTo(cx-r, baseY);
    g.closePath();
    g.fill();
  }
  if(profile.balloons) _hzDrawCandyBalloons(g, profile, rnd);
  return c;
}

// ── Generator: volcanicPeaks ──────────────────────────────────────────
// Scherpere cone-profielen dan klassieke mountains, met optionele
// lava-glow streaks (profile.glowColor) over de slope.
function _hzGenVolcanicPeaks(profile){
  const {c,g}=_hzMakeCanvas();
  const rnd=_hzSeedRnd(profile.seed);
  const baseY=_HORIZON_H*0.85;
  g.fillStyle=_hzGradFill(g, profile.accent, profile.color);
  // 8 cones — taller, narrower, jagged ridge
  const COUNT=8;
  for(let i=0;i<COUNT;i++){
    const cx=(i+rnd()*0.7)*(_HORIZON_W/COUNT);
    const baseW=110+rnd()*70;
    const h=200+rnd()*100;
    g.beginPath();
    g.moveTo(cx-baseW/2, baseY);
    // Jagged left slope
    for(let k=0;k<4;k++){
      const t=(k+1)/4;
      const lx=cx-(baseW/2)*(1-t)+(rnd()-0.5)*15;
      const ly=baseY-h*t;
      g.lineTo(lx, ly);
    }
    g.lineTo(cx, baseY-h);
    // Jagged right slope
    for(let k=0;k<4;k++){
      const t=1-(k+1)/4;
      const rx=cx+(baseW/2)*(1-t)+(rnd()-0.5)*15;
      const ry=baseY-h*t;
      g.lineTo(rx, ry);
    }
    g.lineTo(cx+baseW/2, baseY);
    g.closePath();
    g.fill();
  }
  // Lava-glow cracks
  if(profile.glowColor){
    g.strokeStyle=profile.glowColor;
    g.lineWidth=2;
    for(let i=0;i<24;i++){
      const x0=rnd()*_HORIZON_W;
      const y0=baseY-30-rnd()*180;
      g.globalAlpha=0.4+rnd()*0.4;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0+(rnd()-0.5)*40, y0+30+rnd()*60);
      g.stroke();
    }
    g.globalAlpha=1;
  }
  return c;
}

const _SILHOUETTE_GENERATORS={
  kelpForest:    _hzGenKelpForest,
  iceShards:     _hzGenIceShards,
  candyHills:    _hzGenCandyHills,
  volcanicPeaks: _hzGenVolcanicPeaks,
};

// _buildHorizonSilhouette — orchestrator. Reads profile.type, dispatches
// to de juiste generator. Returnt CanvasTexture klaar voor tiling op een
// CylinderGeometry. Returnt null als type onbekend — caller valt terug
// op legacy _silhouetteTex.
function _buildHorizonSilhouette(profile){
  if(!profile||!profile.type)return null;
  const gen=_SILHOUETTE_GENERATORS[profile.type];
  if(!gen)return null;
  const c=gen(profile);
  return _hzToTex(c);
}

// Per-wereld horizon-profiles. Wordt door buildBackgroundLayers()
// (env.js) gechecked vóór de legacy _SILHOUETTE_PALETTES route. Worlds
// zonder entry blijven het legacy mountain-pad gebruiken.
//
// Profile-fields:
//   far:  { type, seed, color, accent, opacity, height, glowColor? }
//   near: idem
// type → silhouetteType keuze. seed → PRNG seed. color/accent →
// gradient stops (deep base → light top). opacity → CylinderGeometry
// material.opacity. height → cilinder height. glowColor → optionele
// accent-tint per generator.
const WORLD_HORIZON_PROFILE={
  // Deep Sea — kelp forest pillars met bioluminescent dots. Far + near
  // lagen tonen verschillende seeds zodat het silhouet niet repeteert.
  // Dark teal palette matcht de huidige _SILHOUETTE_PALETTES.deepsea
  // tonen maar nu als kelp-shape ipv mountain-shape. Glow color cyan
  // voor de typische deep-sea bioluminescentie.
  deepsea: {
    far:  { type:'kelpForest', seed:11, color:'#001a2a', accent:'#003a55', opacity:0.55, height:90,  glowColor:'#00ddcc' },
    near: { type:'kelpForest', seed:37, color:'#000812', accent:'#001a2a', opacity:0.72, height:78,  glowColor:'#22ffaa' },
  },
  // Arctic — verticale ice-shards + glacier wall. Smaller / sharper
  // dan klassieke mountains. Geen glow — ijs-koel ipv bioluminescent.
  // Light cool palette zodat shards opgaan in de aurora skybox.
  arctic: {
    far:  { type:'iceShards', seed:17, color:'#5a6a86',  accent:'#94a4ba', opacity:0.85, height:110 },
    near: { type:'iceShards', seed:43, color:'#2a3a54',  accent:'#56688a', opacity:0.94, height:84  },
  },
  // Candy — cake-layer + cream-bump silhouet ipv pastel mountains.
  // Pastel pink palette matcht de huidige _SILHOUETTE_PALETTES.candy
  // tones zodat de wereld-mood identiek leest, alleen de SHAPE is nu
  // patisserie-thematisch.
  candy: {
    far:  { type:'candyHills', seed:23, color:'#3a2a55', accent:'#5a3a78', opacity:0.40, height:100 },
    near: { type:'candyHills', seed:53, color:'#2a1f44', accent:'#4a3268', opacity:0.50, height:78 },
  },
  // Volcano — scherpere cone-profielen met lava-glow cracks ipv generic
  // jagged mountains. Deep rust palette matcht _SILHOUETTE_PALETTES.volcano
  // tones; lava streaks via emberDeep glow color.
  volcano: {
    far:  { type:'volcanicPeaks', seed:29, color:'#1a0608', accent:'#3a1010', opacity:0.72, height:108, glowColor:'#ff5028' },
    near: { type:'volcanicPeaks', seed:59, color:'#080202', accent:'#1a0408', opacity:0.86, height:80,  glowColor:'#ff3010' },
  },
};

if(typeof window!=='undefined'){
  window._buildHorizonSilhouette=_buildHorizonSilhouette;
  window.WORLD_HORIZON_PROFILE=WORLD_HORIZON_PROFILE;
}
