// js/track/track.js — non-module script.

'use strict';

// Material-share helper — delegate naar de globale getOrCreate-cache
// (gedefinieerd in dist/shared-materials.bundle.js). Fallback-guard zodat
// als de bundle ontbreekt de factory direct wordt uitgevoerd.
// Cache-keys MOETEN alle visueel-bepalende props bevatten — sessie 8.
function _shMat(k, f){ const g = window._sharedMat && window._sharedMat.getOrCreate; return g ? g(k, f) : f(); }

// Procedurele asfalt-noise texture — werkt multiplicatief over material.color
// zodat per-world tint (color) behouden blijft. Tileable 256×256 canvas met
// grain + lichte streep-wear in racing direction. Niet gecached: disposeScene()
// callt map.dispose() bij elke world-switch, dus we bouwen 'm telkens opnieuw
// (256² noise gen kost <1ms).
//
// Phase 2 graphics upgrade: accepteert opts om lane markings + wetness in te
// bakken zonder extra mesh of polygonOffset gevecht. Tile herhaalt N keer
// langs de track (zie .repeat instelling op de mesh-call-site); lanes worden
// als gestreepte witte centrum-lijn(en) op het canvas getekend zodat ze met
// de tile-repetitie meelopen. Default opts = zero-diff fallback.
//   opts.lanes:    0 = geen, 2 = enkele midden-stippellijn, 3 = midden + 2 binnen
//   opts.wetness:  0..1 — donker-blauwe specular streaks (alleen visueel via
//                  diffuse map; echte reflectie zit in MeshStandardMaterial)
function _buildTrackSurfaceTex(opts){
  const o=opts||{};
  const lanes=o.lanes|0;
  const wetness=Math.max(0,Math.min(1,o.wetness||0));
  const laneColor=o.laneColor||'#f0f0f0';
  const S=256,c=document.createElement('canvas');c.width=S;c.height=S;
  const g=c.getContext('2d');
  // Base mid-grey (multiplied with vertex/material color → keeps world tint)
  g.fillStyle='#9a9a9a';g.fillRect(0,0,S,S);
  // Per-pixel noise via ImageData — values 130..200 (subtle variance)
  const id=g.getImageData(0,0,S,S),d=id.data;
  for(let i=0;i<d.length;i+=4){
    const n=130+(Math.random()*70)|0;
    d[i]=n;d[i+1]=n;d[i+2]=n;d[i+3]=255;
  }
  g.putImageData(id,0,0);
  // Two faint vertical wear-streaks (driving lines) — slightly lighter
  g.globalAlpha=.18;
  for(const xc of [S*.30, S*.70]){
    const grd=g.createLinearGradient(xc-18,0,xc+18,0);
    grd.addColorStop(0,'rgba(255,255,255,0)');
    grd.addColorStop(.5,'rgba(255,255,255,1)');
    grd.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle=grd;g.fillRect(xc-18,0,36,S);
  }
  g.globalAlpha=1;
  // A few darker oil/wear blobs scattered
  for(let i=0;i<22;i++){
    const x=Math.random()*S,y=Math.random()*S,r=4+Math.random()*9;
    const grd=g.createRadialGradient(x,y,0,x,y,r);
    grd.addColorStop(0,'rgba(40,40,40,0.55)');
    grd.addColorStop(1,'rgba(40,40,40,0)');
    g.fillStyle=grd;g.fillRect(x-r,y-r,r*2,r*2);
  }
  // Wetness: koel-zwarte verticale highlight-streaks vóór de lane-markings
  // worden getekend, zodat regenstrepen niet over de lijnen heen komen.
  if(wetness>0){
    g.globalAlpha=0.18*wetness;
    g.fillStyle='#0a141e';
    for(let k=0;k<8;k++){
      const x=Math.random()*S, w=2+Math.random()*4;
      g.fillRect(x,0,w,S);
    }
    g.globalAlpha=1;
  }
  // Lane markings — gestippeld wit, 6 dashes per tile-herhaling, 0.85 alpha
  // zodat de noise er nog door slaat (geen sticker-feel). Tekenen ná de
  // wear/wet zodat strepen erbovenop liggen.
  if(lanes>0){
    g.globalAlpha=0.85;
    g.fillStyle=laneColor;
    const dashCount=6, dashH=S/(dashCount*2), dashW=4;
    const xs=(lanes===3)?[S*.32, S*.50, S*.68]:[S*.50];
    for(const cx of xs){
      for(let i=0;i<dashCount;i++){
        const y=i*dashH*2;
        g.fillRect(cx-dashW*.5,y,dashW,dashH);
      }
    }
    g.globalAlpha=1;
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.anisotropy=window._isMobile?2:4;t.needsUpdate=true;
  return t;
}

// Per-world track-surface palette. Single source of truth for all per-world
// color decisions in the track-build pipeline (asphalt base color, curb
// stripes, curb emissive accent, gantry accent strip). Previously these
// were spread across 4 separate inline ternary chains in buildTrack /
// buildCurbs / buildGantry — adding a 9th world meant patching 4 places.
//
// Schema per entry:
//   asphalt          — base track-mat color (number)
//   kerbA, kerbB     — alternating curb stripe colors as [r,g,b] floats
//   kerbEmissive     — curb material .emissive color (number)
//   kerbEmissiveInt  — curb material .emissiveIntensity (number 0..1)
//   gantryAccent     — gantry neon-strip base color (number)
//   gantryEmissive   — gantry neon-strip emissive color (number)
//
// Lookup pattern: `WORLD_TRACK_PALETTE[activeWorld] || WORLD_TRACK_PALETTE.gp`.
// Defensive fallback to GP keeps a future unknown world from crashing.
//
// All values copied EXACTLY from the inline ternaries this table replaces —
// zero visual change vs pre-refactor. Worlds that didn't have an explicit
// override in a given ternary inherit the GP default for that field.
const WORLD_TRACK_PALETTE = {
  gp:        { asphalt:0x262626, kerbA:[.82,.07,.03], kerbB:[1,1,1],     kerbEmissive:0x661111, kerbEmissiveInt:.30, gantryAccent:0x441166, gantryEmissive:0x6622cc },
  space:     { asphalt:0x141420, kerbA:[0,.9,.9],     kerbB:[.7,0,.9],   kerbEmissive:0x4422aa, kerbEmissiveInt:.70, gantryAccent:0x4422aa, gantryEmissive:0x3311cc },
  deepsea:   { asphalt:0x1a2830, kerbA:[0,.9,.7],     kerbB:[0,.5,1],    kerbEmissive:0x0a4a4a, kerbEmissiveInt:.85, gantryAccent:0x006688, gantryEmissive:0x00aacc },
  candy:     { asphalt:0x3a2a55, kerbA:[1,1,1],       kerbB:[.08,.06,.12], kerbEmissive:0x442266, kerbEmissiveInt:.35, gantryAccent:0x441166, gantryEmissive:0x6622cc, lanes:3, laneColor:'#ffffff' },
  // Volcano asphalt darkened from 0x2a0808 (RGB 42,8,8 — heavily red-tinted)
  // to 0x0c0908 (RGB 12,9,8 — near-black with a vestigial warm undertone) per
  // eigenaar feedback 2026-05-08: track was reading as scarlet, not as
  // volcanic rock. Lava warmth stays in props (lava rivers, kerb-emissive,
  // hero cone). Kerb-emissive intensity unchanged so curbs still glow lava.
  volcano:   { asphalt:0x0c0908, kerbA:[.82,.07,.03], kerbB:[1,1,1],     kerbEmissive:0xff3300, kerbEmissiveInt:.55, gantryAccent:0x441166, gantryEmissive:0x6622cc },
  arctic:    { asphalt:0x667788, kerbA:[.82,.07,.03], kerbB:[1,1,1],     kerbEmissive:0x4488dd, kerbEmissiveInt:.45, gantryAccent:0x441166, gantryEmissive:0x6622cc },
  sandstorm: { asphalt:0x6a4a2e, kerbA:[.79,.45,.20], kerbB:[.95,.85,.62],kerbEmissive:0xc97232, kerbEmissiveInt:.40, gantryAccent:0x441166, gantryEmissive:0x6622cc },
  // Pier 47 (industrial harbour by night). Asphalt is near-black (#1a1a1e)
  // for the future wet-look pass; kerbs are rust-orange (#a04020) and
  // faded warning-yellow (#aaa030); kerbEmissive picks up sodium-lamp tint
  // (#ff8830) so the kerbs glow under the planned street-pole lights in
  // sessie 2. Line color (#d0d0c8) is the broken-white edge marking.
  // pbrTrack + lanes 2 + wetness 0.6 (Phase 2 graphics upgrade): wet-asphalt
  // gebruikte al MeshStandardMaterial; flag maakt het generaliseerbaar voor
  // guangzhou. Centrale dashed line + cool-blue streaks
  // pakken sodium-lamp highlights extra hard.
  pier47:    { asphalt:0x1a1a1e, kerbA:[.627,.251,.125], kerbB:[.667,.627,.188], kerbEmissive:0xff8830, kerbEmissiveInt:.45, gantryAccent:0xa04020, gantryEmissive:0xff8830, pbrTrack:true, lanes:2, wetness:0.6 },
  // Guangzhou Cinematic — wet dark asphalt (#0a0c12). kerbA magenta
  // [1.0,0.13,0.50] + kerbB cyan [0.0,0.88,1.0] + kerbEmissive hot magenta
  // (#ff2080) at 0.85 intensity so kerbs glow against near-black asphalt.
  // gantryAccent + gantryEmissive push the neon-magenta/cyan dual-colour language.
  // pbrTrack + lanes 2 + wetness 0.7 (Phase 2): cyberpunk-rain look — neon
  // billboards smearen door reflective wet asphalt; gestreepte mid-lijn houdt
  // de track leesbaar in donkere scenes.
  guangzhou: { asphalt:0x0a0c12, kerbA:[1.0,0.13,0.50], kerbB:[0.0,0.88,1.0], kerbEmissive:0xff2080, kerbEmissiveInt:.85, gantryAccent:0xff2080, gantryEmissive:0x00e0ff, pbrTrack:true, lanes:2, wetness:0.7 }
};
if(typeof window!=='undefined')window.WORLD_TRACK_PALETTE=WORLD_TRACK_PALETTE;

// Phase 13A — per-world PBR profile voor track asphalt. Pier47 +
// Guangzhou waren al MeshStandard (Phase 4/6); deze tabel breidt naar
// alle 9 worlds met eigen surface-karakter. envMul = envMapIntensity.
const _WORLD_TRACK_MAT_PROFILE = {
  gp:                  { roughness: 0.55, metalness: 0.20, envMul: 0.80, normalStr: 0.30 },
  candy:               { roughness: 0.42, metalness: 0.15, envMul: 1.25, normalStr: 0.35 },
  arctic:              { roughness: 0.30, metalness: 0.30, envMul: 1.40, normalStr: 0.40 },
  volcano:             { roughness: 0.45, metalness: 0.20, envMul: 1.00, normalStr: 0.40 },
  space:               { roughness: 0.40, metalness: 0.50, envMul: 1.20, normalStr: 0.30 },
  deepsea:             { roughness: 0.35, metalness: 0.45, envMul: 1.50, normalStr: 0.40 },
  pier47:              { roughness: 0.24, metalness: 0.62, envMul: 2.00, normalStr: 0.55 },
  guangzhou:           { roughness: 0.22, metalness: 0.70, envMul: 2.20, normalStr: 0.50 },
  sandstorm:           { roughness: 0.70, metalness: 0.08, envMul: 0.60, normalStr: 0.50 }
};

function buildTrack(){
  // Reset per-frame visual state arrays — sommige builders worden niet voor
  // alle worlds aangeroepen, dus zonder deze reset houden de arrays stale
  // (disposed) material-refs vast bij world-switch. Updates op disposed
  // mats zijn no-op maar verspillen CPU per frame.
  _pulseBarriers.length=0;
  if(typeof _crowdMaterials!=='undefined')_crowdMaterials.length=0;
  const pts3=TRACK_WP.map(([x,z])=>new THREE.Vector3(x,0,z));
  trackCurve=new THREE.CatmullRomCurve3(pts3,true,'catmullrom',.5);
  curvePts=trackCurve.getPoints(600);
  const N=400;
  // Main track mat: polygonOffset pushes asphalt *away* from camera in depth so curbs,
  // edge lines and startline overlays win the depth test on low-precision depth buffers (iPad).
  const _trackPalette=WORLD_TRACK_PALETTE[activeWorld]||WORLD_TRACK_PALETTE.gp;
  const _baseTrackColor=_trackPalette.asphalt;
  // Phase 13A (master) — per-world PBR asphalt profile. All 11 worlds
  // krijgen MeshStandardMaterial met eigen roughness/metalness/envMul/
  // normalStr via _WORLD_TRACK_MAT_PROFILE. Phase 6.5: Sobel-derived
  // normalMap voor micro-variatie op natte asphalt reflecties.
  // Phase 2 (graphics-upgrade branch) — lane markings + wetness streaks
  // worden in de diffuse map gebakken via _buildTrackSurfaceTex(_laneOpts)
  // voor werelden die `lanes` of `wetness` in palette hebben (pier47,
  // guangzhou). Default {lanes:0, wetness:0} = byte-
  // identiek aan pre-Phase-2 voor andere worlds.
  const _laneOpts={
    lanes:_trackPalette.lanes|0,
    wetness:_trackPalette.wetness||0,
    laneColor:_trackPalette.laneColor
  };
  const _surfaceTex=_buildTrackSurfaceTex(_laneOpts);
  const _trackMat=(function(){
    const profile=_WORLD_TRACK_MAT_PROFILE[activeWorld]||_WORLD_TRACK_MAT_PROFILE.gp;
    // Deepsea-mobile override: op LOW-tier is er geen IBL/envMap, dus de
    // metalness-component (45% van material-response) draagt ZERO bij —
    // dat deel van de output is effectief zwart. Combinatie met donker
    // base-color (0x1a2830) + strenge fase-1 deepsea-lighting maakt de
    // asphalt pikzwart in alle gebieden waar geen headlight-cone schijnt.
    // Op mobile zetten we metalness naar 0 zodat de diffuse-respons de
    // volle bijdrage levert. Andere worlds blijven zoals ze waren (hun
    // asphalt is lichter of hun lighting voller).
    const _isDeepseaMobile = (activeWorld === 'deepsea') && window._isMobile;
    const m=new THREE.MeshStandardMaterial({
      color:_baseTrackColor,
      map:_surfaceTex,
      roughness:profile.roughness,
      metalness:_isDeepseaMobile ? 0 : profile.metalness,
      envMapIntensity:profile.envMul
    });
    if(window.ProcTextures && typeof ProcTextures.deriveNormalMap==='function' && !window._isMobile){
      const nm=ProcTextures.deriveNormalMap(_surfaceTex,
        {strength:profile.normalStr, repeatX:_surfaceTex.repeat.x, repeatY:_surfaceTex.repeat.y});
      if(nm){ m.normalMap=nm; m.normalScale=new THREE.Vector2(profile.normalStr, profile.normalStr); }
    }
    return m;
  })();
  // No polygonOffset on asphalt itself — it sits at y=0.005, well above the
  // ground plane at y=-0.12, so natural depth ordering keeps asphalt on top
  // of grass/sand. Pushing asphalt away (the previous +1 offset) caused
  // distant track sections to lose the depth test against the ground plane
  // at low z-precision → grass bled THROUGH the track. Curbs/edge-lines/
  // startline carry NEGATIVE offsets (pull-toward-camera) so they still
  // win against asphalt regardless.
  _trackMat.userData.baseColor=_baseTrackColor; // stashed for rain/day-night tinting
  const rm=ribbon(N,t=>{
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    return{L:p.clone().addScaledVector(nr,-TW).setY(.005),R:p.clone().addScaledVector(nr,TW).setY(.005)};
  },_trackMat);
  _trackMesh=rm;
  rm.receiveShadow=true;
  rm.userData = rm.userData || {};
  rm.userData._noLodCull = true;  // Phase 8.7 — track mesh never cull
  // Edge lane-lines + centre line uitgeschakeld: AI gleed permanent over de
  // witte stripe wat het 'spoor' gevoel versterkte. _CENTERLINE_WORLDS dict
  // + cline()/eline() functies blijven staan zodat een revert één regel is.
  // eline(N,-TW+.55,.008,.38);eline(N,TW-.55,.008,.38);
  // Per-world centre lane-line. Originally only on the realistic-asphalt
  // worlds (gp/sandstorm/pier47/guangzhou) so the white stripe
  // wouldn't clash with fantasy themes. Per user request the fantasy
  // worlds now get a THEMATIC centre line: bio-cyan for deepsea, candy-
  // pink for candy, lava-orange for volcano,
  // pale-blue for arctic, etc. Each colour matches the per-world kerb-
  // emissive palette so the line reads as part of the world identity
  // rather than as a foreign racing-marking. Space is the only world
  // without a centre line — its track is a void-ribbon between gravity
  // wells where a centred stripe would visually flatten the depth cues
  // already provided by the warp-tunnel rings.
  const _CENTERLINE_WORLDS = {
    gp:                  0xfafafa,  // racing white
    sandstorm:           0xf5deaa,  // bleached desert white
    pier47:              0xd0d0c8,  // faded concrete white
    guangzhou:           0xc0d0e8,  // cool blue-grey neon
    deepsea:             0x44ffcc,  // bioluminescent teal-cyan
    candy:               0xff66cc,  // bubblegum pink
    volcano:             0xff7733,  // molten lava orange
    arctic:              0xbbdcff,  // pale arctic blue
    // space: intentionally omitted — void-ribbon track between gravity
    // wells. Warp-tunnel rings + boost-pad arrows are the depth cues.
  };
  // if(_CENTERLINE_WORLDS[activeWorld]){
  //   cline(N, _CENTERLINE_WORLDS[activeWorld]);
  // }
  buildCurbs(N);buildStartLine();
}

// Centre lane-line — thin solid stripe at the middle of the track. Per-
// world colour passed in (white/sand/concrete/etc) so the line matches
// each track's surface tone rather than fighting it. Polygon-offset
// stronger than edge-lines so it never z-fights against the asphalt
// grain texture on low-precision depth buffers. Defined as a sibling of
// eline() for the same ribbon-based draw path.
function cline(N, color){
  const mat = new THREE.MeshBasicMaterial({ color: color });
  mat.polygonOffset=true; mat.polygonOffsetFactor=-3; mat.polygonOffsetUnits=-3;
  const hw = 0.08;
  ribbon(N, t => {
    const p = trackCurve.getPoint(t), tg = trackCurve.getTangent(t).normalize();
    const nr = new THREE.Vector3(-tg.z, 0, tg.x);
    return {
      L: p.clone().addScaledVector(nr, -hw).setY(.009),
      R: p.clone().addScaledVector(nr,  hw).setY(.009)
    };
  }, mat);
}

function eline(N,off,y,hw){
  const mat=new THREE.MeshBasicMaterial({color:0xffffff});
  // Stronger offset than curbs (-1) so edge lines never z-fight against curb stripes
  mat.polygonOffset=true;mat.polygonOffsetFactor=-2;mat.polygonOffsetUnits=-2;
  ribbon(N,t=>{
    const p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
    const nr=new THREE.Vector3(-tg.z,0,tg.x);
    return{L:p.clone().addScaledVector(nr,off-hw).setY(y),R:p.clone().addScaledVector(nr,off+hw).setY(y)};
  },mat);
}

function buildCurbs(N){
  const CW=2.1;
  // Stripe count: 36 (was 72). Bij oblique camera-angles op iOS Safari's
  // lage-precision depth-buffer geeft de oude 72-stripe alternatie ~5
  // segments per stripe — onder de Nyquist-grens van het device-pixel
  // grid → moiré shimmer / "regenboog" artefact langs de track-randen.
  // 36 stripes verdubbelt de stripe-lengte → robuuster tegen aliasing
  // zonder dat het visuele kerb-patroon verandert.
  const STRIPES=36;
  // Y omhoog van .045 → .065: physical separation van edge-line (y=.008)
  // is nu groot genoeg dat polygonOffset niet meer alle z-werk hoeft te
  // doen, ook niet op low-precision depth buffers.
  const CY=.065;
  // Palette lookup once per buildCurbs, used inside the side-loop body.
  // Defensive fallback to GP keeps unknown worlds from crashing.
  const _palette=WORLD_TRACK_PALETTE[activeWorld]||WORLD_TRACK_PALETTE.gp;
  [-1,1].forEach(side=>{
    const eo=side*(TW+CW*.5),pos=[],col=[],idx=[];
    for(let i=0;i<=N;i++){
      const t=i/N,p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
      const nr=new THREE.Vector3(-tg.z,0,tg.x);
      const L=p.clone().addScaledVector(nr,eo-CW*.5);L.y=CY;
      const R=p.clone().addScaledVector(nr,eo+CW*.5);R.y=CY;
      pos.push(L.x,L.y,L.z,R.x,R.y,R.z);
      const s=Math.floor(t*STRIPES)%2;
      const [r,g,b]=s===0?_palette.kerbA:_palette.kerbB;
      col.push(r,g,b,r,g,b);
      if(i<N){const a=i*2,b2=a+1,c=a+2,d=a+3;idx.push(a,b2,c,b2,d,c);}
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
    geo.setIndex(idx);
    const cMat=new THREE.MeshLambertMaterial({vertexColors:true});
    // polygonOffset matched to edge-lines (-2/-2). Eerder -1/-1 was zwakker
    // dan edge-lines (-2/-2) waardoor edge-line strepen DOOR de curb heen
    // konden zetten op grazing angles. Gelijke offset + grotere Y-separatie
    // (.065 vs edge-line .008) lost dit op.
    cMat.polygonOffset=true;cMat.polygonOffsetFactor=-2;cMat.polygonOffsetUnits=-2;
    // Per-world emissive accents — vertexColors zijn al gezet per world, maar
    // emissive geeft daarbovenop een gloed die door bloom oppikt wordt.
    cMat.emissive=new THREE.Color(_palette.kerbEmissive);
    cMat.emissiveIntensity=_palette.kerbEmissiveInt;
    const kerbMesh=new THREE.Mesh(geo,cMat);
    // Kerbs hebben absolute vertex-coords met mesh.position=(0,0,0) — opt-
    // out van LOD-cull anders verdwijnen ze als camera ver van origin staat.
    kerbMesh.userData={_noLodCull:true};
    scene.add(kerbMesh);
  });
}

// Procedural 8×2 checkerboard texture for the start/finish line. Single
// canvas avoids the per-tile z-fight that 16 separate Plane meshes had on
// low-precision depth buffers (iOS Safari) — neighbouring tiles share an
// edge at the same y/z and flickered when the camera angle hit the
// device-pixel grid the wrong way.
function _buildStartLineTex(){
  const W=512,H=128,c=document.createElement('canvas');c.width=W;c.height=H;
  const g=c.getContext('2d');
  const cw=W/8,ch=H/2;
  for(let i=0;i<8;i++)for(let j=0;j<2;j++){
    g.fillStyle=((i+j)%2===0)?'#ffffff':'#111111';
    g.fillRect(i*cw,j*ch,cw,ch);
  }
  const t=new THREE.CanvasTexture(c);
  t.magFilter=THREE.NearestFilter;t.minFilter=THREE.LinearFilter;
  t.anisotropy=window._isMobile?2:4;t.needsUpdate=true;
  return t;
}

// Phase 8.6 — racing-line wear streaks bij corners.
// LineSegments-mesh langs trackCurve waar segment-opacity stijgt met
// curvature. Donker rubber-stain pattern, subtiel maar voegt corner-
// readability + "lived-in" feel toe. Polygon-offset -3 (zelfde als
// curbs) tegen z-fight op iPad depth-buffer.
function buildRacingLineWear(){
  if(!trackCurve) return;
  const N = 200;
  const positions = [];
  const colors = [];
  const wearColor = new THREE.Color(0x2a2014);  // dark rubber stain
  const _t1 = new THREE.Vector3();
  const _t2 = new THREE.Vector3();
  for(let i=0; i<N; i++){
    const u = i / N;
    const u2 = (i+1) / N;
    const p = trackCurve.getPoint(u);
    const p2 = trackCurve.getPoint(u2);
    trackCurve.getTangent(u, _t1).normalize();
    trackCurve.getTangent(u2, _t2).normalize();
    // Curvature proxy: angle tussen opeenvolgende tangents.
    // Sterkere curvature = donkerdere stripe.
    const dot = Math.min(1, Math.max(-1, _t1.dot(_t2)));
    const angle = Math.acos(dot);
    const wearAmount = Math.min(1, Math.max(0, (angle - 0.005) * 35));
    if(wearAmount < 0.05) continue;  // skip straights
    positions.push(p.x, 0.010, p.z);
    positions.push(p2.x, 0.010, p2.z);
    const wr = wearColor.r * wearAmount;
    const wg = wearColor.g * wearAmount;
    const wb = wearColor.b * wearAmount;
    colors.push(wr, wg, wb, wr, wg, wb);
  }
  if(positions.length === 0) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = _shMat('track/racing-line-wear#vc=T#op=0.550#t=T#dw=D0#pf=-3/-3', function(){
    const m = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -3;
    m.polygonOffsetUnits = -3;
    return m;
  });
  const lines = new THREE.LineSegments(geo, mat);
  scene.add(lines);
}

function buildStartLine(){
  const p=trackCurve.getPoint(0),tg=trackCurve.getTangent(0).normalize();
  const nr=new THREE.Vector3(-tg.z,0,tg.x);
  const sqW=TW*2/8,sqD=1.2,W=sqW*8,D=sqD*2;
  // Single textured plane — was 16 separate tiles. Y lifted from .011 to
  // .025 (delta vs asphalt at .005 = 0.020, well within iOS depth precision).
  // polygonOffset -2/-2 matches the edge-line strength so the start-line
  // never z-fights against the asphalt regardless of view angle.
  // Cache-key bevat de texture-uuid om twee verschillende start-line
  // textures (per build via _buildStartLineTex) niet ten onrechte te
  // delen. Bij identieke uuid (zelfde texture-instance hergebruikt) →
  // cached mat. Bij nieuwe uuid → nieuwe mat in cache.
  const _slTex=_buildStartLineTex();
  const mat=_shMat('track/startline#col=0xffffff#map='+(_slTex&&_slTex.uuid?_slTex.uuid.slice(0,8):'none')+'#pf=-2/-2', function(){
    const m=new THREE.MeshLambertMaterial({color:0xffffff,map:_slTex});
    m.polygonOffset=true; m.polygonOffsetFactor=-2; m.polygonOffsetUnits=-2;
    return m;
  });
  const m=new THREE.Mesh(new THREE.PlaneGeometry(W,D),mat);
  m.rotation.x=-Math.PI/2;
  // After rotation.x=-PI/2 the plane's local +X stays world +X. Rotate
  // around world +Y (which is the local +Z after the X-flip, applied
  // intrinsically as rotation.z) so the plane's W edge aligns with
  // the track normal nr. Math: world +X after rot.z=θ becomes
  // (cos θ, 0, -sin θ); we need this == nr = (-tg.z, 0, tg.x), giving
  // θ = atan2(-tg.x, -tg.z).
  m.rotation.z=Math.atan2(-tg.x,-tg.z);
  m.position.copy(p);m.position.y=.025;
  scene.add(m);
}

function buildBarriers(){
  const isSpace=activeWorld==='space',isDS=activeWorld==='deepsea';
  _pulseBarriers.length=0; // reset bij wereld-switch — oude mats zijn al disposed
  [-1,1].forEach(side=>{
    const N=200,pos=[],nrm=[],idx=[];
    for(let i=0;i<=N;i++){
      const t=i/N,p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
      const nr=new THREE.Vector3(-tg.z,0,tg.x);
      const b=p.clone().addScaledVector(nr,side*BARRIER_OFF);
      // Deep sea: organic coral wall with irregular height
      const h=isDS?(0.9+Math.sin(i*.47+side*1.3)*0.45+Math.sin(i*.21)*0.22):1.05;
      pos.push(b.x,0,b.z,b.x,h,b.z);
      nrm.push(-side*nr.x,0,-side*nr.z,-side*nr.x,0,-side*nr.z);
      if(i<N){const a=i*2,b2=a+1,c=a+2,d=a+3;idx.push(a,b2,c,b2,d,c);}
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geo.setAttribute('normal',new THREE.Float32BufferAttribute(nrm,3));
    geo.setIndex(idx);
    let mat;
    if(isSpace){
      // Energy shield: translucent electric-blue glow
      mat=new THREE.MeshLambertMaterial({color:0x2255dd,emissive:0x0a1a88,emissiveIntensity:1.0,transparent:true,opacity:.38,side:THREE.DoubleSide});
      _pulseBarriers.push({mat,phase:side*1.7,kind:'shield',baseOp:.38,baseInt:1.0});
    } else if(isDS){
      // Coral wall: warm teal-green with soft bio-glow
      mat=new THREE.MeshLambertMaterial({color:0x1e7766,emissive:0x083322,emissiveIntensity:1.0,side:THREE.DoubleSide});
      _pulseBarriers.push({mat,phase:side*0.9,kind:'coral',baseOp:1,baseInt:1.0});
    } else {
      mat=_shMat('track/barrier-generic#col=0xbbbbbb#s=2',
        ()=> new THREE.MeshLambertMaterial({color:0xbbbbbb,side:THREE.DoubleSide}));
    }
    scene.add(new THREE.Mesh(geo,mat));
  });
  // Space: add a second inner strip of emissive "energy beams" at cap height
  if(isSpace){
    [-1,1].forEach(side=>{
      const N=200,pos=[],idx=[];
      for(let i=0;i<=N;i++){
        const t=i/N,p=trackCurve.getPoint(t),tg=trackCurve.getTangent(t).normalize();
        const nr=new THREE.Vector3(-tg.z,0,tg.x);
        const b=p.clone().addScaledVector(nr,side*BARRIER_OFF);
        pos.push(b.x,1.05,b.z,b.x,1.18,b.z);
        if(i<N){const a=i*2,b2=a+1,c=a+2,d=a+3;idx.push(a,b2,c,b2,d,c);}
      }
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
      geo.setIndex(idx);
      const beamMat=new THREE.MeshLambertMaterial({color:0x66aaff,emissive:0x4488ee,emissiveIntensity:1.4,side:THREE.DoubleSide});
      _pulseBarriers.push({mat:beamMat,phase:side*2.4,kind:'beam',baseOp:1,baseInt:1.4});
      scene.add(new THREE.Mesh(geo,beamMat));
    });
  }
}

// Per-frame barrier pulse — gevuld door buildBarriers, geleegd door
// disposeScene. updateBarrierPulse() wordt vanuit updateFlags aangeroepen.
let _pulseBarriers=[];
function updateBarrierPulse(){
  if(!_pulseBarriers.length)return;
  const t=_nowSec;
  for(let _bi=0;_bi<_pulseBarriers.length;_bi++){
    const b=_pulseBarriers[_bi];
    if(b.kind==='shield'){
      // Energy-shield: opacity flicker + emissive pulse
      const v=Math.sin(t*1.4+b.phase);
      b.mat.opacity=b.baseOp+v*0.08;
      b.mat.emissiveIntensity=b.baseInt+v*0.4;
    } else if(b.kind==='coral'){
      // Coral: subtle slow bio-glow breathing
      const v=Math.sin(t*0.55+b.phase);
      b.mat.emissiveIntensity=b.baseInt*0.7+v*0.5;
    } else if(b.kind==='beam'){
      // Energy-beam: faster pulse — "humming" power line
      const v=Math.sin(t*2.2+b.phase);
      b.mat.emissiveIntensity=b.baseInt*0.6+v*0.55;
    }
  }
}

let _gantryLabel=null;
// Built fresh inside buildGantry — the texture is owned by the drape's
// material map so disposeScene reclaims it on world-switch (no module-level
// caching, otherwise we'd hold a disposed texture across rebuilds).
function _buildChequerTex(){
  const c=document.createElement('canvas');c.width=256;c.height=64;
  const g=c.getContext('2d');
  const cols=16,rows=4,cw=c.width/cols,ch=c.height/rows;
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    g.fillStyle=((x+y)&1)?'#ffffff':'#0a0a10';
    g.fillRect(x*cw,y*ch,cw+1,ch+1);
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=THREE.RepeatWrapping;t.wrapT=THREE.ClampToEdgeWrapping;
  t.anisotropy=window._isMobile?2:4;t.needsUpdate=true;
  return t;
}
function buildGantry(){
  const p=trackCurve.getPoint(0),tg=trackCurve.getTangent(0).normalize();
  // Pillars sit at TW+5 so the supports stay outside the screen-centre
  // frame where the DOM countdown overlay (#f1Lights) lands.
  const nr=new THREE.Vector3(-tg.z,0,tg.x),hw=TW+5;
  const _gantryPal=WORLD_TRACK_PALETTE[activeWorld]||WORLD_TRACK_PALETTE.gp;
  const accentCol=_gantryPal.gantryAccent;
  const accentEmit=_gantryPal.gantryEmissive;
  const mob=!!window._isMobile;
  // Yaw so flat planes face along the track normal (same math as buildStartLine).
  const yaw=Math.atan2(-tg.x,-tg.z);

  // Materials shared across the gantry parts.
  const steelMat=_shMat('track/gantry-steel#col=0x1c1c28',
    ()=> new THREE.MeshLambertMaterial({color:0x1c1c28}));   // dark steel shaft
  const chromeMat=_shMat('track/gantry-chrome#col=0xd8dae0',
    ()=> new THREE.MeshLambertMaterial({color:0xd8dae0}));  // brushed chrome trim
  const stripeMat=new THREE.MeshLambertMaterial({color:accentCol,emissive:accentEmit,emissiveIntensity:1.9});
  const beaconMat=_shMat('track/gantry-beacon#col=0xffffff#em=0xffeecc#ei=2.3',
    ()=> new THREE.MeshLambertMaterial({color:0xffffff,emissive:0xffeecc,emissiveIntensity:2.3}));

  // ─── Pillars ──────────────────────────────────────────────────────────
  // Slim dark-steel shafts with chrome base flange + mid-ring + cap, an
  // emissive accent stripe running up the inside face, and a beacon on top.
  for(let _pi=0;_pi<2;_pi++){
    const s=_pi===0?-1:1;
    const pp=p.clone().addScaledVector(nr,s*hw);
    const post=new THREE.Mesh(new THREE.CylinderGeometry(.28,.38,10,mob?8:14),steelMat);
    post.position.copy(pp);post.position.y=5;scene.add(post);
    // Chrome flange at the foot — visually grounds the pillar.
    const base=new THREE.Mesh(new THREE.CylinderGeometry(.7,.85,.4,mob?10:16),chromeMat);
    base.position.copy(pp);base.position.y=.2;scene.add(base);
    // Decorative chrome mid-ring.
    const ring=new THREE.Mesh(new THREE.CylinderGeometry(.44,.44,.32,mob?10:14),chromeMat);
    ring.position.copy(pp);ring.position.y=3.4;scene.add(ring);
    // Chrome cap under the arch.
    const cap=new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,.45,mob?10:14),chromeMat);
    cap.position.copy(pp);cap.position.y=10.15;scene.add(cap);
    // Inside-face glow stripe — thin emissive bar running most of the shaft.
    const stripe=new THREE.Mesh(new THREE.BoxGeometry(.10,7.6,.20),stripeMat);
    stripe.position.copy(pp);
    stripe.position.addScaledVector(nr,-s*.42);  // inset toward track centre
    stripe.position.y=4.6;
    stripe.rotation.y=yaw;
    scene.add(stripe);
    // Beacon orb on top of the pillar cap.
    const beacon=new THREE.Mesh(new THREE.SphereGeometry(.34,mob?8:14,mob?6:10),beaconMat);
    beacon.position.copy(pp);beacon.position.y=10.7;scene.add(beacon);
  }

  // ─── Chequered finish drape ───────────────────────────────────────────
  // Thin canvas-textured strip hanging just below the arch peak — sells the
  // "finish line banner" identity at a glance. Double-sided so the drape
  // reads from both directions.
  const drapeMat=new THREE.MeshLambertMaterial({map:_buildChequerTex(),side:THREE.DoubleSide,transparent:false});
  // Two short drapes either side of the central billboard.
  const drapeW=hw-3.2,drapeH=1.1;
  for(const sx of [-1,1]){
    const dr=new THREE.Mesh(new THREE.PlaneGeometry(drapeW,drapeH),drapeMat);
    dr.position.copy(p);
    dr.position.addScaledVector(nr,sx*(drapeW*0.5+1.6));
    dr.position.y=10.55;
    dr.rotation.y=yaw;
    scene.add(dr);
  }

  // ─── Billboard backing the LED ticker ─────────────────────────────────
  // A dark inner panel framed by an emissive rim — gives the floating
  // sprite a proper sign-board context instead of empty air. Plane-based
  // so it costs ~6 verts; the rim is four thin emissive bars.
  const bbW=8.5,bbH=2.2,bbY=11.85;
  // Outer dark backing (slightly larger than the rim, sits furthest from cam).
  const bbBack=new THREE.Mesh(new THREE.PlaneGeometry(bbW+0.5,bbH+0.5),new THREE.MeshLambertMaterial({color:0x05050a,side:THREE.DoubleSide}));
  bbBack.position.copy(p);bbBack.position.y=bbY;bbBack.rotation.y=yaw;
  scene.add(bbBack);
  // Emissive accent rim around the panel — top/bottom + left/right strips.
  const rimMat=new THREE.MeshLambertMaterial({color:accentCol,emissive:accentEmit,emissiveIntensity:1.7,side:THREE.DoubleSide});
  const rimGeoH=new THREE.PlaneGeometry(bbW+0.5,.08);
  const rimGeoV=new THREE.PlaneGeometry(.08,bbH+0.5);
  for(const dy of [bbH/2+0.21,-bbH/2-0.21]){
    const r=new THREE.Mesh(rimGeoH,rimMat);
    r.position.copy(p);
    r.position.y=bbY+dy;
    r.rotation.y=yaw;
    r.position.addScaledVector(tg,-0.02);
    scene.add(r);
  }
  for(const dx of [bbW/2+0.21,-bbW/2-0.21]){
    const r=new THREE.Mesh(rimGeoV,rimMat);
    r.position.copy(p);
    r.position.addScaledVector(nr,dx);
    r.position.y=bbY;
    r.rotation.y=yaw;
    r.position.addScaledVector(tg,-0.02);
    scene.add(r);
  }

  // ─── LED ticker sprite ────────────────────────────────────────────────
  // Slightly taller canvas (96px) for a richer LED render; sprite scaled to
  // sit inside the billboard frame above.
  const glCvs=document.createElement('canvas');glCvs.width=512;glCvs.height=96;
  const glCtx=glCvs.getContext('2d');
  const glTex=new THREE.CanvasTexture(glCvs);
  const glLbl=new THREE.Sprite(new THREE.SpriteMaterial({map:glTex,transparent:true,opacity:.95}));
  glLbl.position.copy(p);glLbl.position.y=bbY;glLbl.scale.set(8.0,1.6,1);
  glLbl.position.addScaledVector(tg,-0.05);  // nudge sprite forward of the panel
  glLbl.name='f1-gantry-label-sprite';scene.add(glLbl);
  glLbl.userData.isGantryLabel=true;
  glLbl.userData.canvas=glCvs;
  glLbl.userData.ctx=glCtx;
  glLbl.userData.tex=glTex;
  glLbl.userData.frameIdx=0;
  glLbl.userData.nextSwitch=0;
  _gantryLabel=glLbl;
  _drawGantryFrame(0);
}

// Helper: render één tekst-frame in de gantry canvas. idx wijst frame-type aan.
function _drawGantryFrame(idx){
  if(!_gantryLabel)return;
  const ctx=_gantryLabel.userData.ctx;
  const cvs=_gantryLabel.userData.canvas;
  const W=cvs.width,H=cvs.height;
  ctx.clearRect(0,0,W,H);
  // LED-board look: deep purple-black base with subtle horizontal scanlines.
  ctx.fillStyle='#0a0010';ctx.fillRect(0,0,W,H);
  for(let y=0;y<H;y+=3){
    ctx.fillStyle='rgba(255,255,255,0.04)';ctx.fillRect(0,y,W,1);
  }
  const worldCol={
    space:'#8866ff',deepsea:'#00ddcc',candy:'#ff66cc',
    volcano:'#ff6622',arctic:'#88ccff',
    // Sandstorm — warm sand-orange matches the canyon palette; without
    // this entry the gantry text falls back to magenta '#cc66ff'.
    sandstorm:'#ffa040',
    // Pier 47 — sodium-amber matching the lamp anchor (#ff8830).
    pier47:'#ff8830',
    // Guangzhou Cinematic — neon-magenta matching kerbEmissive (#ff2080).
    guangzhou:'#ff2080'
  }[activeWorld]||'#cc66ff';
  ctx.font='bold 52px Orbitron,Arial';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle=worldCol;
  // Stronger glow on the bigger canvas so the LED sign reads from distance.
  ctx.shadowColor=worldCol;ctx.shadowBlur=14;
  ctx.fillText(_gantryFrameText(idx),W/2,H/2+2);
  ctx.shadowBlur=0;
  _gantryLabel.userData.tex.needsUpdate=true;
}
function _gantryFrameText(idx){
  const worldName={
    space:'COSMIC CIRCUIT',deepsea:'DEEP SEA CIRCUIT',candy:'CANDY KINGDOM',
    volcano:'VOLCANO RUSH',arctic:'ARCTIC PEAKS',
    sandstorm:'SANDSTORM CANYON',
    pier47:'PIER 47',
    guangzhou:'GUANGZHOU NIGHT GP'
  }[activeWorld]||"SPENCER'S RACE CLUB";
  const car=carObjs[playerIdx];
  const lap=car?Math.max(1,Math.min(3,car.lap+1)):1;
  // Find best lap of any car
  let fastest=Infinity;
  for(let i=0;i<carObjs.length;i++){
    const bl=carObjs[i].bestLap;
    if(bl&&bl<fastest)fastest=bl;
  }
  const fastestStr=isFinite(fastest)?(Math.floor(fastest/60)+':'+(fastest%60).toFixed(2).padStart(5,'0')):'--:--.--';
  switch(idx%5){
    case 0:return worldName;
    case 1:return gameState==='RACE'?`LAP ${lap}/3`:'GET READY';
    case 2:return gameState==='RACE'?`FASTEST ${fastestStr}`:'WELCOME';
    case 3:return ['DRIVE SAFE','GO GO GO','PURE SPEED','FULL THROTTLE'][Math.floor(_nowSec/4)%4];
    case 4:return worldName;
  }
  return worldName;
}
// Aanroepen vanuit updateFlags() — wisselt frame elke ~3s en herrendert.
function updateGantryTicker(){
  // parent==null betekent dat de gantry-sprite is gedispoosed door
  // disposeScene (world-switch zonder gantry, bv. candy).
  if(!_gantryLabel||!_gantryLabel.parent)return;
  if(_nowSec<_gantryLabel.userData.nextSwitch)return;
  _gantryLabel.userData.frameIdx=(_gantryLabel.userData.frameIdx+1)%5;
  _gantryLabel.userData.nextSwitch=_nowSec+2.8+Math.random()*0.8;
  _drawGantryFrame(_gantryLabel.userData.frameIdx);
}

function ribbon(N,segFn,mat){
  const pos=[],nrm=[],uv=[],idx=[];
  for(let i=0;i<=N;i++){
    const t=i/N,{L,R}=segFn(t);
    pos.push(L.x,L.y,L.z,R.x,R.y,R.z);nrm.push(0,1,0,0,1,0);uv.push(0,t*12,1,t*12);
    if(i<N){const a=i*2,b=a+1,c=a+2,d=a+3;idx.push(a,b,c,b,d,c);}
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(nrm,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geo.setIndex(idx);
  const m=new THREE.Mesh(geo,mat);
  // ribbon() bouwt altijd een track-lengte mesh (asphalt, kerbs, edge-
  // lines, platform-bottom, walls). Deze hebben absolute vertex-coords
  // met mesh.position=(0,0,0) — LOD-cull moet ze nooit verbergen, anders
  // verdwijnen track-randen wanneer camera ver van origin staat.
  m.userData = m.userData || {};
  m.userData._noLodCull = true;
  scene.add(m);return m;
}

