// js/core/scene.js — scene disposal + sky textures + hoofd buildScene().
// Non-module script, geladen vóór main.js.
//
// Afhankelijkheden (script-globals, grotendeels in main.js gedeclareerd):
//   renderer, scene, camera, camPos, mirrorCamera, clock
//   sunLight, ambientLight, hemiLight
//   activeWorld, _TRACKS, _DEFAULT_WP, TRACK_WP
//   trackLightList, trackPoles, _trackFlags, _aiHeadPool
//   jumpRamps, spinPads, boostPads, collectibles, skidMarks
//   stars, plHeadL, plHeadR, plTail, _boostLight, _trackMesh, _sunBillboard
//   _wp*
//   _space*, _kelp*, _jellyfish*, _dsa*, _sprinkle*, _gummy*, _gum*, _candy*,
//   _choco*, _neon*, _holo*, _volcano*, _arctic*, _tp*
//   _snowParticles, _snowGeo, _fogColorDay, _fogColorNight
//   _mmBounds, isDark
//
// Externe builders (non-module scripts): buildTrack, buildSpaceEnvironment,
// buildDeepSeaEnvironment, buildCandyEnvironment,
// buildVolcanoEnvironment, buildArcticEnvironment,
// buildGround, buildClouds, buildBarriers, buildGantry, buildMountains,
// buildLake, buildGravelTraps, buildNightObjects,
// buildSpectators, buildSunBillboard, buildAdvertisingBoards,
// buildCornerBoards, buildTrackFlags, buildJumpRamps,
// buildCenterlineArrows, buildSpinPads, buildBoostPads, buildCollectibles,
// buildWorldElements, buildParticles, buildGhostMesh, initSpeedLines,
// initRain, toggleNight.

'use strict';

// Asset-cached textures (HDRI envMap, PBR ground maps, GLTF instance maps)
// carry userData._sharedAsset=true; disposeScene must skip these or the
// next build pulls a disposed handle from window.Assets cache. Each layer
// — mesh, material, map — is checked independently because a private
// material can still wrap a shared texture (e.g. cloned headlight beam
// material wrapping the cached alpha-mask).
function _shared(x){ return !!(x && x.userData && x.userData._sharedAsset); }

// Freeze a mesh's matrix: compute once en zet matrixAutoUpdate=false zodat
// Three.js geen per-frame updateMatrix() doet. Alleen voor truly static
// props (buildings, decor, lamp masts) — NIET op meshes die animeren
// (positie/rotatie/scale per frame). Helper is exposed op window zodat
// per-world builders het kunnen aanroepen na hun scene.add().
function _freezeMatrix(o){
  if(!o || !o.isObject3D) return;
  o.updateMatrix();
  o.matrixAutoUpdate = false;
}
if(typeof window !== 'undefined') window._freezeMatrix = _freezeMatrix;

// World-classification helper. The "void worlds" — space and deepsea —
// share fall-into-void mechanics: off-track triggers a fall+rescue
// sequence instead of a recovery-circle, gravity is reduced, and the
// soft-wall track-edge collision is skipped (you're meant to be able to
// fly off into the void). The pair appears together in 3 places across
// the codebase (wall-collision.js, collectibles.js, night.js sun-billboard
// gate); centralising the check here means a future third void world
// only needs to be added in one place.
function _isVoidWorld(world){
  return world === 'space' || world === 'deepsea';
}

// Single source of truth for Grand Prix day lighting. Mirrors the cross-
// world helper pattern (sandstorm/candy/volcano/arctic) — the
// default-world buildScene block + night.js default GP-day branch share
// the same constants. GP has no dedicated world.js file so the helper
// lives here in scene.js alongside _isVoidWorld.
//
// Goal palette (clean blue-sky circuit):
//   sun #fff5e0 (warm white) / 1.65
//   ambient #88aacc (cool blue) / 0.50
//   hemi sky #9bbfdd / ground #4a7a3d (grass) / 0.36
// Values match the scene.js per-world cascade else-branch — this helper
// is the consistency refactor.
function _applyGrandPrixDayLighting(){
  if(typeof sunLight==='undefined' || !sunLight) return;
  if(typeof ambientLight==='undefined' || !ambientLight) return;
  if(typeof hemiLight==='undefined' || !hemiLight) return;
  sunLight.color.setHex(0xfff5e0); sunLight.intensity=1.65;
  ambientLight.color.setHex(0x88aacc); ambientLight.intensity=.50;
  hemiLight.color.setHex(0x9bbfdd);
  hemiLight.groundColor.setHex(0x4a7a3d);
  hemiLight.intensity=.36;
  // PBR-upgrade Brok 1b: per-wereld ambient/hemi-mul knop. Default 1.0 dus
  // geen visuele change in stable preset.
  const _v=(typeof window.getWorldVisuals==='function')?window.getWorldVisuals(activeWorld):null;
  if(_v){ ambientLight.intensity*=_v.ambientMul; hemiLight.intensity*=_v.hemiMul; }
}
if(typeof window!=='undefined')window._applyGrandPrixDayLighting=_applyGrandPrixDayLighting;
// Alle texture-slots die op een r134 MeshPhysicalMaterial kunnen voorkomen.
// _disposeMat itereert deze lijst zodat per-instance physical materials uit
// Phase 2/3 (transmission lenses, Tesla glass roof, Mustang stripe-canvas)
// niet hun texture-uploads lekken bij world-switch. Shared textures
// (userData._sharedAsset) worden overgeslagen — zo overleven de procedurele
// envMap, _carbonTex en _softHeadlightTex de rebuild.
const _MAT_TEX_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
  'emissiveMap', 'bumpMap', 'displacementMap', 'alphaMap', 'lightMap',
  'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
  'transmissionMap', 'thicknessMap', 'envMap'
];
function _disposeMat(m){
  if (!m) return;
  for (let i=0; i<_MAT_TEX_SLOTS.length; i++){
    const k = _MAT_TEX_SLOTS[i];
    const t = m[k];
    if (!t || _shared(t)) continue;
    if (typeof t.dispose !== 'function'){
      // Slot bevat geen Texture-object — kan ontstaan als toekomstige three-
      // upgrades een slot-naam hergebruiken voor een ander type (bv. r136+
      // sheenColor werd Color i.p.v. number). Defensieve skip i.p.v. crash.
      if (window.dbg) dbg.warn('cars','non-Texture in material slot: '+k);
      else if (typeof console !== 'undefined') console.warn('non-Texture in material slot:', k);
      continue;
    }
    t.dispose();
  }
  if (!_shared(m)) m.dispose();
}
function disposeScene(){
  if(!scene)return;
  scene.traverse(obj=>{
    if(obj.isMesh||obj.isPoints||obj.isLine||obj.isSprite){
      // For InstancedMesh, the per-instance buffers (instanceMatrix,
      // instanceColor) are unique to this mesh even if its geometry is
      // shared. Three r134 has no InstancedMesh.dispose(); freeing the
      // GPU buffers happens via geometry.dispose() — so we cannot share
      // InstancedMesh geometry. Safe-guard: trees/props clone geometry
      // per spawn. If a future caller forgets, we still dispose private
      // geometries; shared GLTF geometry stays alive in the asset cache.
      if(obj.geometry && !_shared(obj.geometry)) obj.geometry.dispose();
      if(obj.material){
        if(Array.isArray(obj.material)) obj.material.forEach(_disposeMat);
        else _disposeMat(obj.material);
      }
    }
  });
  while(scene.children.length>0)scene.remove(scene.children[0]);
  // Reset _crowdMaterials hier ook (defense-in-depth): buildTrack() doet
  // dit ook al, maar als buildSpectators voor de actieve wereld vroeg
  // returned (zoals nu voor GP) en buildTrack-volgorde ooit verandert,
  // blijven de materials in disposeScene gegarandeerd geleegd. Anders
  // zou updateCrowd() naar disposed CanvasTextures schrijven.
  if(typeof _crowdMaterials!=='undefined')_crowdMaterials.length=0;
  if(scene.background&&scene.background.isTexture && !_shared(scene.background)) scene.background.dispose();
  scene.background=null;
  if(scene.environment&&scene.environment.isTexture && !_shared(scene.environment)) scene.environment.dispose();
  scene.environment=null;
  if(renderer)renderer.renderLists.dispose();
  // ProcTextures helper-cache — flush on every world-switch so cached
  // canvas-textures (sphinx sandstone, cliff strata, palm-leaf alpha)
  // don't accumulate across rebuilds. The next buildScene that needs
  // them will re-render the canvas (~1ms per generator). Cheap insurance
  // against the LRU growing past its 60-entry-per-generator cap.
  if(window.ProcTextures&&typeof ProcTextures.disposeAll==='function')ProcTextures.disposeAll();
  // SEAM-DBG 2026-05-25 — reset jump-apex sampler flag op elke
  // world-switch/restart zodat de volgende candy-build opnieuw een
  // JUMP-APEX log emit. Diagnostic only. Volledig terugdraaibaar.
  window._seamSamplerDone=false;
}

// Module-scope cache voor skybox-textures, geïndexeerd op
// activeWorld+'_'+(isDark?'n':'d'). buildScene's sky-cascade gebruikt de
// cache via _getOrBuildSkyTex(); cache hit slaat een 1024×512 canvas-render
// + GPU re-upload over (15-50ms op zware werelden). Cached textures krijgen
// userData._sharedAsset=true zodat disposeScene + de inline-dispose paden
// (regel 267 _newSkyCanvas, regel 144 makeSkyTex) ze niet vrijgeven.
const _skyTexCache=Object.create(null);
function _skyCacheKey(){
  return (typeof activeWorld!=='undefined'?activeWorld:'?')+'_'+(isDark?'n':'d');
}
function _getOrBuildSkyTex(makeFn){
  const k=_skyCacheKey();
  const hit=_skyTexCache[k];
  if(hit&&hit.isTexture)return hit;
  const tex=makeFn();
  if(tex&&tex.isTexture){
    tex.userData=tex.userData||{};
    tex.userData._sharedAsset=true;
    _skyTexCache[k]=tex;
  }
  return tex;
}

// Dispose the previous scene.background texture to prevent GPU memory leaks on
// world/night/rain toggles — every call-site here assigns the result to scene.background.
function makeSkyTex(top,bot){
  if(scene&&scene.background&&scene.background.isTexture&&!_shared(scene.background))scene.background.dispose();
  const c=document.createElement('canvas');c.width=2;c.height=512;
  const g=c.getContext('2d'),gr=g.createLinearGradient(0,0,0,512);
  gr.addColorStop(0,top);gr.addColorStop(1,bot);g.fillStyle=gr;g.fillRect(0,0,2,512);
  const t=new THREE.CanvasTexture(c);t.needsUpdate=true;return t;
}

// Procedural envMap fallback voor MeshPhysicalMaterial.clearcoat reflecties.
// HDRI-loader bestaat (assets/loader.js + effects/asset-bridge.js) maar er
// staan momenteel geen .hdr/.exr assets op disk; scene.environment blijft
// dus null tenzij we hier zelf een fallback bouwen. Eén PMREM-cubemap voor
// alle worlds — per-world skybox blijft scene.background; alleen het
// reflectie-env is gedeeld. Cached forever (één call gebruikt ~5 MB GPU).
let _proceduralEnv=null;
function _buildProceduralEnvMap(){
  if(_proceduralEnv) return _proceduralEnv;
  if(!renderer || typeof THREE.PMREMGenerator!=='function'){
    if(window.dbg) dbg.warn('scene','procedural envMap skipped — renderer or PMREMGenerator unavailable');
    return null;
  }
  // Phase 7 — tier-aware resolutie. High tier krijgt 1024×512 voor
  // scherpere clearcoat-spotjes; mobile/mid blijven 512×256 om GPU upload
  // budget niet te overschrijden. Per-pixel cost is canvas-time, niet
  // render-loop tijd, dus eenmalig OK.
  const _hi = !!(window._qFlags && window._qFlags.shadowType === 'PCFSoft') && !window._isMobile;
  const W = _hi ? 1024 : 512, H = _hi ? 512 : 256;
  const c=document.createElement('canvas');c.width=W;c.height=H;
  const g=c.getContext('2d');
  // Sky→horizon→ground gradient met warmere ground-bounce (de oude #3a3a3a
  // gaf cold neutral grijs op de bottom-half van clearcoat reflecties; op
  // bodem-vlakken van auto's leek dat onnatuurlijk koud). Nu warm-tinted
  // bottom zodat reflecties op de chassis-onderkant + side-skirts mee-warmen.
  const grad=g.createLinearGradient(0,0,0,H);
  grad.addColorStop(0.00,'#aac4dc'); // sky zenith
  grad.addColorStop(0.45,'#d4cdc2'); // upper horizon haze
  grad.addColorStop(0.50,'#bca896'); // horizon line — warm shift
  grad.addColorStop(0.55,'#7a6856'); // ground-near horizon
  grad.addColorStop(1.00,'#4a3a30'); // warm ground (vervangt cold #3a3a3a)
  g.fillStyle=grad;g.fillRect(0,0,W,H);
  // Sun hotspot — zonder een lokaal-fel-punt geeft de gradient alleen een
  // zachte ambient-reflectie en blijft clearcoat onmerkbaar op een chase-cam
  // achteraanzicht. Een radiale highlight in het bovenste derde van de
  // equirect map zorgt voor een scherp specular spotje dat met de car-
  // oriëntatie meebeweegt — het "wet paint" effect dat clearcoat hoort te
  // produceren. Twee kleinere secundaire hotspots zorgen dat de auto vanuit
  // élke hoek een hint van reflectie pakt (anders alleen wanneer de camera
  // toevallig de zon recht ziet).
  const sun=g.createRadialGradient(W*0.28,H*0.22,0,W*0.28,H*0.22,H*0.42);
  sun.addColorStop(0.0,'rgba(255,250,230,1.00)');
  sun.addColorStop(0.25,'rgba(255,240,200,0.55)');
  sun.addColorStop(1.0,'rgba(255,240,200,0.00)');
  g.fillStyle=sun;g.fillRect(0,0,W,H);
  const sun2=g.createRadialGradient(W*0.74,H*0.30,0,W*0.74,H*0.30,H*0.30);
  sun2.addColorStop(0.0,'rgba(240,235,255,0.40)');
  sun2.addColorStop(1.0,'rgba(240,235,255,0.00)');
  g.fillStyle=sun2;g.fillRect(0,0,W,H);
  // Phase 7 — fresnel-rim band rond de horizon. Een subtle warm highlight
  // op exact het horizon-niveau geeft clearcoat-paint een herkenbare "rim
  // light" wanneer de camera laag staat (bumper-cam, bij het uitstappen).
  // 2px-thick line op H*0.50 met soft fade.
  const rim=g.createLinearGradient(0,H*0.46,0,H*0.54);
  rim.addColorStop(0.0,'rgba(255,200,140,0)');
  rim.addColorStop(0.5,'rgba(255,210,160,0.35)');
  rim.addColorStop(1.0,'rgba(255,200,140,0)');
  g.fillStyle=rim;g.fillRect(0,H*0.46,W,H*0.08);
  const tex=new THREE.CanvasTexture(c);
  tex.mapping=THREE.EquirectangularReflectionMapping;
  tex.needsUpdate=true;
  let envMap=null;
  try{
    const pmrem=new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    envMap=pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
  }catch(e){
    if(window.dbg) dbg.error('scene',e,'procedural envMap build failed');
    else console.error('procedural envMap build failed',e);
  }
  tex.dispose();
  if(envMap){
    envMap.userData=envMap.userData||{};
    envMap.userData._sharedAsset=true;
    if(window.dbg) dbg.log('scene','procedural envMap built — '+W+'×'+H+' equirect → PMREM cube');
  }
  _proceduralEnv=envMap;
  return envMap;
}
// Geëxposeerd zodat ui/select.js (en eventuele toekomstige off-screen
// preview-scenes) dezelfde envMap kunnen gebruiken voor clearcoat-reflecties.
// De buildScene-aanroeppath werkt onafhankelijk van deze export.
window._buildProceduralEnvMap=_buildProceduralEnvMap;

// Per-world envMap — gebruikt het bestaande make<World>SkyTex() canvas als
// equirectangular bron en runt PMREM erover voor cubemap-reflecties.
// Skybox canvases zijn 1024×512 (of 512×256 op mobile) = 2:1 ratio = al
// equirect-compatible. Cars sampelen scene.environment en krijgen daardoor
// per-wereld thematische reflecties: sun-spot op GP, ember glow op Volcano,
// aurora op Arctic, etc. Veel rijker dan de
// generieke procedural gradient.
//
// PMREMGenerator + equirect-shader compile is ~50ms shader-link werk dat
// niet per world hoeft te gebeuren. Lifted naar module-scope: één compile
// over de hele page-lifetime, hergebruikt over elke world-switch. Mirror
// van de fix in env-baker.js (PMREM-share Phase-1-followup).
//
// .fromEquirectangular() returnt een fresh WebGLRenderTarget waarvan .texture
// aan scene.environment hangt. disposeScene disposed alleen die texture; de
// parent RT blijft staan en lekt ~6MB GPU per world-switch. We tracken de
// vorige RT en disposed die expliciet voor we de nieuwe alloceren.
let _sceneEqPmrem = null;
let _sceneEqPmremRT = null;
if(typeof window !== 'undefined' && typeof window.addEventListener === 'function'){
  window.addEventListener('webglcontextlost', () => {
    _sceneEqPmrem = null;
    _sceneEqPmremRT = null;
  }, { passive: true });
}
function _buildWorldEnvFromSky(skytex){
  if(!renderer || typeof THREE.PMREMGenerator!=='function' || !skytex || !skytex.image){
    return null;
  }
  // Wrap dezelfde canvas (skytex.image) als equirect-projectie texture.
  // Geen pixel-copy nodig — alleen een tweede THREE.CanvasTexture wrapper
  // met andere mapping. PMREM kopieert pixels naar GPU cubemap-faces.
  const equirect=new THREE.CanvasTexture(skytex.image);
  equirect.mapping=THREE.EquirectangularReflectionMapping;
  equirect.needsUpdate=true;
  let envMap=null;
  try{
    if(!_sceneEqPmrem){
      _sceneEqPmrem = new THREE.PMREMGenerator(renderer);
      _sceneEqPmrem.compileEquirectangularShader();
    }
    if(_sceneEqPmremRT){
      try { _sceneEqPmremRT.dispose(); } catch(_) {}
      _sceneEqPmremRT = null;
    }
    const rt = _sceneEqPmrem.fromEquirectangular(equirect);
    _sceneEqPmremRT = rt;
    envMap = rt.texture;
  }catch(e){
    if(window.dbg) dbg.error('scene',e,'world envMap build failed');
    else console.error('world envMap build failed',e);
  }
  equirect.dispose();
  if(envMap && window.dbg){
    dbg.log('scene','world envMap built — '+activeWorld+' skybox → PMREM cube');
  }
  return envMap;
}

// Helper: dispose previous background + return a sky canvas with vertical
// gradient as base. Per-world sky functions paint on top of this.
// Mobile gebruikt een halve fysieke resolutie (512×256) maar context.scale
// past het 1024×512 logische coordinatensysteem toe — alle per-world sky
// functies kunnen ongewijzigd in de oorspronkelijke ruimte blijven tekenen.
// Bespaart ~1.5MB GPU per skybox, materiële winst over 8 worlds.
// Phase 1 bevinding 1.1: sky textures waren overal 1024×512 zonder mobile cap.
function _newSkyCanvas(top,bot){
  if(scene&&scene.background&&scene.background.isTexture&&!_shared(scene.background))scene.background.dispose();
  // 2026-05-11 round-6: bumped mobile scale 0.5 → 0.75 so the horizon
  // city silhouette doesn't read as "Lego skyline" after Safari's
  // device-pixel upscaling. 2.25× pixel-count at zero runtime cost
  // (texture upload is one-time at world build).
  const _scale=window._isMobile?0.75:1;
  const c=document.createElement('canvas');
  c.width=Math.round(1024*_scale);c.height=Math.round(512*_scale);
  const g=c.getContext('2d');
  if(_scale!==1)g.scale(_scale,_scale);
  const gr=g.createLinearGradient(0,0,0,512);
  gr.addColorStop(0,top);gr.addColorStop(1,bot);g.fillStyle=gr;g.fillRect(0,0,1024,512);
  return {c,g};
}
function _skyTexFromCanvas(c){
  const t=new THREE.CanvasTexture(c);
  // RepeatWrapping on S so updateXxxWorld() can drift the sky horizontally via
  // texture.offset.x. T stays clamped (no vertical wrap of horizon).
  t.wrapS=THREE.RepeatWrapping;
  t.needsUpdate=true;return t;
}

// Space — starfield + soft nebula clouds + distant galaxy band
function makeSpaceSkyTex(){
  const {c,g}=_newSkyCanvas('#000005','#040022');
  // Two soft nebula blobs (blue + magenta)
  const neb1=g.createRadialGradient(280,160,0,280,160,260);
  neb1.addColorStop(0,'rgba(80,40,160,0.55)');neb1.addColorStop(1,'rgba(80,40,160,0)');
  g.fillStyle=neb1;g.fillRect(0,0,1024,512);
  const neb2=g.createRadialGradient(780,260,0,780,260,300);
  neb2.addColorStop(0,'rgba(200,60,140,0.45)');neb2.addColorStop(1,'rgba(200,60,140,0)');
  g.fillStyle=neb2;g.fillRect(0,0,1024,512);
  // Galaxy band (subtle horizontal smear)
  const band=g.createLinearGradient(0,180,0,260);
  band.addColorStop(0,'rgba(120,140,220,0)');
  band.addColorStop(.5,'rgba(180,200,255,0.18)');
  band.addColorStop(1,'rgba(120,140,220,0)');
  g.fillStyle=band;g.fillRect(0,180,1024,80);
  // Stars — 600 small, 40 bright
  for(let i=0;i<600;i++){
    const x=Math.random()*1024,y=Math.random()*420;
    const a=Math.random()*0.7+0.25;
    g.fillStyle=`rgba(255,255,255,${a.toFixed(2)})`;
    g.fillRect(x,y,2,2);
  }
  for(let i=0;i<40;i++){
    const x=Math.random()*1024,y=Math.random()*380;
    const r=Math.random()*1.3+0.8;
    const gr=g.createRadialGradient(x,y,0,x,y,r*4);
    gr.addColorStop(0,'rgba(255,255,255,1)');
    gr.addColorStop(.4,'rgba(200,220,255,0.6)');
    gr.addColorStop(1,'rgba(150,180,255,0)');
    g.fillStyle=gr;g.fillRect(x-r*4,y-r*4,r*8,r*8);
  }
  return _skyTexFromCanvas(c);
}

// Deep sea — light shafts from above + scattered particle dots + dark abyss below
function makeDeepSeaSkyTex(){
  const {c,g}=_newSkyCanvas('#001825','#000a14');
  // Light shafts from surface (top)
  for(let i=0;i<6;i++){
    const x=120+i*150+Math.random()*40;
    const w=80+Math.random()*60;
    const grad=g.createLinearGradient(x,0,x,360);
    grad.addColorStop(0,'rgba(120,200,230,0.32)');
    grad.addColorStop(.5,'rgba(80,160,200,0.12)');
    grad.addColorStop(1,'rgba(0,80,120,0)');
    g.fillStyle=grad;g.beginPath();
    g.moveTo(x-w*.2,0);g.lineTo(x+w*.2,0);g.lineTo(x+w,360);g.lineTo(x-w,360);g.closePath();g.fill();
  }
  // Suspended plankton (small dots)
  for(let i=0;i<300;i++){
    const x=Math.random()*1024,y=80+Math.random()*380;
    const a=Math.random()*0.35+0.1;
    g.fillStyle=`rgba(180,230,255,${a.toFixed(2)})`;
    g.fillRect(x,y,2,2);
  }
  return _skyTexFromCanvas(c);
}

// Candy — 4-stop pastel gradient (deep pink zenith → mint mid → cream
// horizon → soft lilac foot) with cotton-candy cloud puffs. Visual-polish
// pass mirrors sandstorm V2: rich layered gradient instead of single pink
// fade, soft clouds backed by horizon glow. The candy-bit sparkle field
// painted by the older version is dropped — the night skybox owns sparkles
// (see makeCandyNightSkyTex), the day skybox is intentionally smoother
// for a sun-drenched-pastel mood.
function makeCandySkyTex(){
  // Two-stop bg = zenith → mid. Lower bands painted on top for the 4-stop
  // gradient feel without altering _newSkyCanvas.
  const {c,g}=_newSkyCanvas('#ff5fb4','#7fffd4');
  // Mid-band mint → cream horizon transition.
  const midBand=g.createLinearGradient(0,260,0,420);
  midBand.addColorStop(0,'rgba(127,255,212,0)');
  midBand.addColorStop(.5,'rgba(255,220,200,0.55)');
  midBand.addColorStop(1,'rgba(255,240,214,0.85)');
  g.fillStyle=midBand;g.fillRect(0,260,1024,160);
  // Cream → soft lilac foot. Picks up the fog-color so the seam between
  // fogged distant geometry and skybox is invisible.
  const foot=g.createLinearGradient(0,410,0,512);
  foot.addColorStop(0,'rgba(255,240,214,0.85)');
  foot.addColorStop(1,'rgba(217,179,255,1)');
  g.fillStyle=foot;g.fillRect(0,410,1024,102);
  // Cotton-candy cloud puffs — white + pink at zenith, fewer toward
  // horizon so the cream glow stays clean. Soft radial gradients.
  for(let i=0;i<14;i++){
    const x=Math.random()*1024;
    const y=70+Math.random()*220;
    const r=50+Math.random()*70;
    const tone=Math.random()<0.5?'255,235,250':'255,255,255';
    const gr=g.createRadialGradient(x,y,0,x,y,r);
    gr.addColorStop(0,`rgba(${tone},0.78)`);
    gr.addColorStop(1,`rgba(${tone},0)`);
    g.fillStyle=gr;g.fillRect(x-r,y-r,r*2,r*2);
  }
  // Subtle horizon-line cream-pink glow strip, picks up sun warmth.
  const horizGlow=g.createLinearGradient(0,360,0,440);
  horizGlow.addColorStop(0,'rgba(255,200,220,0)');
  horizGlow.addColorStop(.5,'rgba(255,200,220,0.22)');
  horizGlow.addColorStop(1,'rgba(255,200,220,0)');
  g.fillStyle=horizGlow;g.fillRect(0,360,1024,80);
  return _skyTexFromCanvas(c);
}

// Candy DUSK — "verlaten pretpark om middernacht" (V1 statisch). Donker
// indigo zenith → donker paars-mid → enige warmte als verre carnaval-
// glow-strip aan de horizon (pretpark in de verte) → aubergine foot =
// fog.color voor seam-onzichtbaarheid. Geen wolken (kale lucht; verlaten).
// Live gebruikt door buildCandySky; oude makeCandySkyTex blijft staan
// voor mogelijke historische rollback.
function makeCandyDuskSkyTex(){
  // Optie D — bg-gradient bot kleur = foot-color (#2a1838 = fog.color)
  // zodat gradient zelf naar foot convergeert; geen lichter-paars
  // mid-segment dat als horizontale naad leest bij hoge-jump cam-rotation.
  // Zenith iets donkerder (#0e0820) zodat een subtiel verloop behouden
  // blijft (zenith donkerder dan foot, niet plat-eenvormig).
  const {c,g}=_newSkyCanvas('#0e0820','#2a1838');
  // Mid-band — donker paars zonder warmte, gradient naar fog-tint.
  const midBand=g.createLinearGradient(0,260,0,420);
  midBand.addColorStop(0,'rgba(58,34,69,0)');
  midBand.addColorStop(.5,'rgba(50,28,58,0.55)');
  midBand.addColorStop(1,'rgba(45,26,55,0.85)');
  g.fillStyle=midBand;g.fillRect(0,260,1024,160);
  // Foot fades into aubergine fog-color (#2a1838) for invisible seam.
  const foot=g.createLinearGradient(0,410,0,512);
  foot.addColorStop(0,'rgba(45,26,55,0.85)');
  foot.addColorStop(1,'rgba(42,24,56,1)');
  g.fillStyle=foot;g.fillRect(0,410,1024,102);
  // V2 grim: verre stadsglow-strip naar koud teal-blauw (was warm
  // amber). Voelt nu als verre stad / industriële mist ipv knus
  // carnaval; coherent met de koele maan-sun en koel-violet grading.
  // Alpha iets lager voor subtieler effect.
  const farGlow=g.createLinearGradient(0,430,0,510);
  farGlow.addColorStop(0,'rgba(60,90,120,0)');
  farGlow.addColorStop(.5,'rgba(60,90,120,0.18)');
  farGlow.addColorStop(1,'rgba(60,90,120,0.04)');
  g.fillStyle=farGlow;g.fillRect(0,430,1024,80);
  return _skyTexFromCanvas(c);
}

// Volcano — ember haze + smoke clouds + dim red glow on horizon
function makeVolcanoSkyTex(){
  const {c,g}=_newSkyCanvas('#1a0008','#2a0810');
  // Red horizon glow (bottom)
  const glow=g.createLinearGradient(0,300,0,512);
  glow.addColorStop(0,'rgba(255,80,20,0)');
  glow.addColorStop(.6,'rgba(220,60,10,0.35)');
  glow.addColorStop(1,'rgba(180,40,0,0.55)');
  g.fillStyle=glow;g.fillRect(0,300,1024,212);
  // Smoke clouds
  for(let i=0;i<10;i++){
    const x=Math.random()*1024,y=120+Math.random()*200;
    const r=80+Math.random()*100;
    const gr=g.createRadialGradient(x,y,0,x,y,r);
    gr.addColorStop(0,'rgba(40,20,15,0.6)');
    gr.addColorStop(1,'rgba(40,20,15,0)');
    g.fillStyle=gr;g.fillRect(x-r,y-r,r*2,r*2);
  }
  // Embers (orange specks)
  for(let i=0;i<120;i++){
    const x=Math.random()*1024,y=180+Math.random()*320;
    const a=Math.random()*0.7+0.3;
    g.fillStyle=`rgba(255,${(120+Math.random()*80)|0},${(20+Math.random()*40)|0},${a.toFixed(2)})`;
    g.fillRect(x,y,2,2);
  }
  return _skyTexFromCanvas(c);
}

// Grand Prix NIGHT — straightforward dark-blue track-night. Stars +
// modest moon. Per spec the most subdued of the cross-world night
// upgrades: GP is the "default" world, environment shouldn't compete
// with the on-track action.
function makeGrandPrixNightSkyTex(){
  const {c,g}=_newSkyCanvas('#0a1426','#162842');
  // Sparse zenith-weighted stars.
  const STAR_COUNT=window._isMobile?60:140;
  for(let i=0;i<STAR_COUNT;i++){
    const x=Math.random()*1024;
    const y=Math.pow(Math.random(),1.6)*300;
    const a=(0.45+Math.random()*0.5).toFixed(2);
    g.fillStyle=`rgba(220,228,250,${a})`;
    g.fillRect(x,y,1,1);
  }
  // Subtle horizon glow — distant city/track lights, very low contrast.
  const glow=g.createLinearGradient(0,400,0,512);
  glow.addColorStop(0,'rgba(80,110,170,0)');
  glow.addColorStop(1,'rgba(80,110,170,0.35)');
  g.fillStyle=glow;g.fillRect(0,400,1024,112);
  // Modest moon, upper-right, nothing flashy.
  const moonCx=730,moonCy=130,moonR=32;
  const halo=g.createRadialGradient(moonCx,moonCy,moonR*0.5,moonCx,moonCy,moonR*2.2);
  halo.addColorStop(0,'rgba(225,232,250,0.40)');
  halo.addColorStop(1,'rgba(225,232,250,0)');
  g.fillStyle=halo;g.fillRect(moonCx-moonR*2.2,moonCy-moonR*2.2,moonR*4.4,moonR*4.4);
  const disc=g.createRadialGradient(moonCx-moonR*0.25,moonCy-moonR*0.25,0, moonCx,moonCy,moonR);
  disc.addColorStop(0,'rgba(248,250,255,1)');
  disc.addColorStop(1,'rgba(210,218,235,0.92)');
  g.fillStyle=disc;g.beginPath();g.arc(moonCx,moonCy,moonR,0,Math.PI*2);g.fill();
  return _skyTexFromCanvas(c);
}

// Candy NIGHT — glow-in-the-dark wonderland. Deep-purple/magenta zenith
// with dense pastel sparkle-stars, soft moon, sugary horizon glow. PMREM
// env paints lacquer with playful pink/violet reflections.
function makeCandyNightSkyTex(){
  const {c,g}=_newSkyCanvas('#1a0a2e','#3a0e54');
  // Sugary horizon glow — pink/violet rising from bottom.
  const glow=g.createLinearGradient(0,300,0,512);
  glow.addColorStop(0,'rgba(255,100,200,0)');
  glow.addColorStop(.6,'rgba(255,120,200,0.30)');
  glow.addColorStop(1,'rgba(220,90,180,0.55)');
  g.fillStyle=glow;g.fillRect(0,300,1024,212);
  // Sparse magenta + cyan haze blobs (like cotton-candy clouds at night).
  for(let i=0;i<10;i++){
    const x=Math.random()*1024,y=140+Math.random()*200;
    const r=80+Math.random()*100;
    const tone=Math.random()<0.5?'255,140,220':'180,140,255';
    const gr=g.createRadialGradient(x,y,0,x,y,r);
    gr.addColorStop(0,`rgba(${tone},0.30)`);
    gr.addColorStop(1,`rgba(${tone},0)`);
    g.fillStyle=gr;g.fillRect(x-r,y-r,r*2,r*2);
  }
  // Sparkle-stars — pastel tones (white + pink + cyan), denser than other
  // worlds because candy = bling. Slightly larger size variation for
  // "sparkle" feel.
  const STAR_COUNT=window._isMobile?100:240;
  for(let i=0;i<STAR_COUNT;i++){
    const x=Math.random()*1024;
    const y=Math.pow(Math.random(),1.4)*340;
    const r=Math.random();
    const tone=r<0.6?'255,255,255': r<0.85?'255,200,235':'200,235,255';
    const a=(0.5+Math.random()*0.5).toFixed(2);
    const sz=r<0.85?1: r<0.97?1.5:2.5;
    g.fillStyle=`rgba(${tone},${a})`;
    g.fillRect(x,y,sz,sz);
  }
  // Soft pink moon, upper-left, with extra-wide halo (matches the world's
  // dreamy pastel feel).
  const moonCx=240,moonCy=120,moonR=38;
  const halo=g.createRadialGradient(moonCx,moonCy,moonR*0.5,moonCx,moonCy,moonR*3);
  halo.addColorStop(0,'rgba(255,220,240,0.50)');
  halo.addColorStop(.5,'rgba(255,180,220,0.18)');
  halo.addColorStop(1,'rgba(255,180,220,0)');
  g.fillStyle=halo;g.fillRect(moonCx-moonR*3,moonCy-moonR*3,moonR*6,moonR*6);
  const disc=g.createRadialGradient(moonCx-moonR*0.25,moonCy-moonR*0.25,0, moonCx,moonCy,moonR);
  disc.addColorStop(0,'rgba(255,250,250,1)');
  disc.addColorStop(1,'rgba(245,220,235,0.92)');
  g.fillStyle=disc;g.beginPath();g.arc(moonCx,moonCy,moonR,0,Math.PI*2);g.fill();
  return _skyTexFromCanvas(c);
}

// Volcano NIGHT — deep ember sky, intensified lava-glow horizon, dense
// smoke, sparse warm ember-stars, low cream moon dimmed by smoke. The
// PMREM-baked env paints car clearcoat with lava-glow rim-light.
function makeVolcanoNightSkyTex(){
  const {c,g}=_newSkyCanvas('#0a0408','#1a0608');
  // Intensified lava-glow at horizon (lower band, much brighter than day).
  const glow=g.createLinearGradient(0,280,0,512);
  glow.addColorStop(0,'rgba(255,80,20,0)');
  glow.addColorStop(.4,'rgba(255,90,30,0.45)');
  glow.addColorStop(.8,'rgba(220,55,10,0.75)');
  glow.addColorStop(1,'rgba(180,30,0,0.95)');
  g.fillStyle=glow;g.fillRect(0,280,1024,232);
  // Smoke clouds — denser + darker than day. Composited dark over the glow.
  for(let i=0;i<14;i++){
    const x=Math.random()*1024,y=110+Math.random()*220;
    const r=80+Math.random()*120;
    const gr=g.createRadialGradient(x,y,0,x,y,r);
    gr.addColorStop(0,'rgba(20,10,8,0.75)');
    gr.addColorStop(1,'rgba(20,10,8,0)');
    g.fillStyle=gr;g.fillRect(x-r,y-r,r*2,r*2);
  }
  // Warm ember-specks (fewer, brighter) — read as cinders in the smoke.
  for(let i=0;i<80;i++){
    const x=Math.random()*1024,y=150+Math.random()*300;
    const a=(Math.random()*0.55+0.45).toFixed(2);
    g.fillStyle=`rgba(255,${(140+Math.random()*70)|0},${(30+Math.random()*40)|0},${a})`;
    g.fillRect(x,y,2,2);
  }
  // Dim moon, upper-left, partially veiled by smoke. Intentionally low
  // contrast — volcano nights are smoky, not crisp.
  const moonCx=260,moonCy=120,moonR=32;
  const halo=g.createRadialGradient(moonCx,moonCy,moonR*0.5,moonCx,moonCy,moonR*2.4);
  halo.addColorStop(0,'rgba(240,205,150,0.30)');
  halo.addColorStop(1,'rgba(240,205,150,0)');
  g.fillStyle=halo;g.fillRect(moonCx-moonR*2.4,moonCy-moonR*2.4,moonR*4.8,moonR*4.8);
  const disc=g.createRadialGradient(moonCx-moonR*0.3,moonCy-moonR*0.3,0, moonCx,moonCy,moonR);
  disc.addColorStop(0,'rgba(245,220,180,0.85)');
  disc.addColorStop(1,'rgba(180,140,100,0.65)');
  g.fillStyle=disc;g.beginPath();g.arc(moonCx,moonCy,moonR,0,Math.PI*2);g.fill();
  return _skyTexFromCanvas(c);
}

// Arctic — aurora bands (green/violet) + ice fog + faint stars
function makeArcticSkyTex(){
  const {c,g}=_newSkyCanvas('#0a1830','#a8c8e0');
  // Aurora bands (green + violet, slightly curved via offset)
  for(let band=0;band<3;band++){
    const baseY=80+band*40+Math.random()*30;
    const color=band===0?'rgba(80,255,180,':band===1?'rgba(140,90,255,':'rgba(60,200,255,';
    g.save();
    for(let x=0;x<1024;x+=2){
      const wob=Math.sin(x*0.012+band*1.7)*30;
      const y=baseY+wob;
      const grad=g.createLinearGradient(x,y-50,x,y+50);
      grad.addColorStop(0,color+'0)');
      grad.addColorStop(.5,color+(0.35-band*0.07).toFixed(2)+')');
      grad.addColorStop(1,color+'0)');
      g.fillStyle=grad;g.fillRect(x,y-50,2,100);
    }
    g.restore();
  }
  // Stars (sparse, only top)
  for(let i=0;i<80;i++){
    const x=Math.random()*1024,y=Math.random()*100;
    g.fillStyle=`rgba(220,230,255,${(Math.random()*0.5+0.3).toFixed(2)})`;
    g.fillRect(x,y,2,2);
  }
  // Distant snow fog at horizon
  const fog=g.createLinearGradient(0,360,0,512);
  fog.addColorStop(0,'rgba(220,235,250,0)');
  fog.addColorStop(1,'rgba(220,235,250,0.45)');
  g.fillStyle=fog;g.fillRect(0,360,1024,152);
  return _skyTexFromCanvas(c);
}

// Arctic NIGHT — deep midnight-blue zenith, vivid aurora ribbons (green
// + violet + cyan) that arc across the upper sky, dense star field,
// crisp white moon. PMREM-baked env paints car lacquer with cool aurora
// rim-light at night.
function makeArcticNightSkyTex(){
  const {c,g}=_newSkyCanvas('#050a1c','#1a2848');
  // Dense star field (zenith-weighted), painted before auroras so aurora
  // partially veils some stars naturally.
  const STAR_COUNT=window._isMobile?60:160;
  for(let i=0;i<STAR_COUNT;i++){
    const x=Math.random()*1024;
    const y=Math.pow(Math.random(),1.5)*300;
    const a=(0.5+Math.random()*0.5).toFixed(2);
    const sz=Math.random()<0.9?1:1.6;
    g.fillStyle=`rgba(220,230,255,${a})`;
    g.fillRect(x,y,sz,sz);
  }
  // Aurora ribbons — 4 bands with stronger curve + higher saturation
  // than the day version. Painted with additive feel via 'lighter' comp.
  g.save();
  g.globalCompositeOperation='lighter';
  const auroraBands=[
    {y:90,  color:'rgba(80,255,180,', amp:38, freq:0.011},
    {y:140, color:'rgba(120,90,255,', amp:42, freq:0.009},
    {y:180, color:'rgba(60,220,255,', amp:32, freq:0.013},
    {y:240, color:'rgba(180,80,220,', amp:26, freq:0.015}
  ];
  auroraBands.forEach((band,bi)=>{
    for(let x=0;x<1024;x+=2){
      const wob=Math.sin(x*band.freq+bi*1.7)*band.amp;
      const y=band.y+wob;
      const peakA=0.32-bi*0.05;
      const grad=g.createLinearGradient(x,y-60,x,y+60);
      grad.addColorStop(0,band.color+'0)');
      grad.addColorStop(.5,band.color+peakA.toFixed(2)+')');
      grad.addColorStop(1,band.color+'0)');
      g.fillStyle=grad;g.fillRect(x,y-60,2,120);
    }
  });
  g.restore();
  // Hero moon, upper-right, crisp + bright (cold air = high contrast).
  const moonCx=760,moonCy=110,moonR=42;
  const halo=g.createRadialGradient(moonCx,moonCy,moonR*0.55,moonCx,moonCy,moonR*2.5);
  halo.addColorStop(0,'rgba(225,235,255,0.55)');
  halo.addColorStop(.5,'rgba(180,210,250,0.20)');
  halo.addColorStop(1,'rgba(180,210,250,0)');
  g.fillStyle=halo;g.fillRect(moonCx-moonR*2.5,moonCy-moonR*2.5,moonR*5,moonR*5);
  const disc=g.createRadialGradient(moonCx-moonR*0.25,moonCy-moonR*0.25,0, moonCx,moonCy,moonR);
  disc.addColorStop(0,'rgba(255,255,255,1)');
  disc.addColorStop(.7,'rgba(235,240,250,1)');
  disc.addColorStop(1,'rgba(190,200,220,0.9)');
  g.fillStyle=disc;g.beginPath();g.arc(moonCx,moonCy,moonR,0,Math.PI*2);g.fill();
  // Distant ice-fog at horizon — same band as day, slightly cooler tone.
  const fog=g.createLinearGradient(0,400,0,512);
  fog.addColorStop(0,'rgba(140,170,210,0)');
  fog.addColorStop(1,'rgba(140,170,210,0.55)');
  g.fillStyle=fog;g.fillRect(0,400,1024,112);
  return _skyTexFromCanvas(c);
}

// Sandstorm — warm-sunset gradient. Purple-warm zenith bleeds through a
// fiery orange-red mid-band into a peach horizon and warm-dust foot.
// Cinematic golden-hour feel + dramatic rim-light fodder for cliff side
// of canyon. Lap-progressive haze tint is layered on top via DOM-overlay
// in sandstorm-storm.js; this canvas is the lap-1 clear-sky baseline.
function makeSandstormSkyTex(){
  // Two-stop linear bg = zenith → mid-horizon. We paint the lower bands on
  // top to get a 4-stop sunset effect without altering _newSkyCanvas.
  const {c,g}=_newSkyCanvas('#5a3a55','#ff7842');
  // Mid-band warm orange-red → peach horizon (rows ~260-420).
  const midBand=g.createLinearGradient(0,260,0,420);
  midBand.addColorStop(0,'rgba(255,120,66,0)');
  midBand.addColorStop(.5,'rgba(255,160,100,0.55)');
  midBand.addColorStop(1,'rgba(255,184,122,0.85)');
  g.fillStyle=midBand;g.fillRect(0,260,1024,160);
  // Lower horizon → warm-dust foot. Picks up the fog-color so the seam
  // between fogged distant geometry and skybox is invisible.
  const foot=g.createLinearGradient(0,410,0,512);
  foot.addColorStop(0,'rgba(255,184,122,0.85)');
  foot.addColorStop(1,'rgba(168,104,57,1)');
  g.fillStyle=foot;g.fillRect(0,410,1024,102);
  // Sun hotspot — low and warm. Centered just above mid-band so the
  // sunset glow centers the composition. Color-matches the sun directional
  // light (#ff8c42) so sky and lit-sides of cliffs share a tone.
  const sun=g.createRadialGradient(680,300,0,680,300,280);
  sun.addColorStop(0,'rgba(255,210,140,1)');
  sun.addColorStop(.25,'rgba(255,160,90,0.65)');
  sun.addColorStop(.6,'rgba(255,120,60,0.30)');
  sun.addColorStop(1,'rgba(255,100,50,0)');
  g.fillStyle=sun;g.fillRect(360,40,640,520);
  // Sparse high-altitude wisps backlit by sunset — picks up sun-warm
  // tones rather than cloud-white. Adds atmospheric depth in the zenith.
  for(let i=0;i<8;i++){
    const y=70+Math.random()*150,w=140+Math.random()*180;
    const x=Math.random()*1024;
    const grd=g.createLinearGradient(x,y,x+w,y);
    grd.addColorStop(0,'rgba(255,200,150,0)');
    grd.addColorStop(.5,'rgba(255,200,150,0.22)');
    grd.addColorStop(1,'rgba(255,200,150,0)');
    g.fillStyle=grd;g.fillRect(x,y-2,w,4);
  }
  return _skyTexFromCanvas(c);
}

// Sandstorm NIGHT — deep-purple zenith with full-moon hero, dense star
// field weighted toward the zenith, and a diagonal Milky-Way band.
// Painted onto the same 1024×512 canvas the day-skybox uses so the
// PMREM-derived environment reflections automatically pick up the moon
// glow on car clearcoat.
//
// Night-toggle in effects/night.js swaps between makeSandstormSkyTex
// (day) and this builder when activeWorld==='sandstorm' and isDark
// flips. Stars are baked into the canvas (not as scene-level Points)
// so they pan with the skybox when camera turns — matches every other
// world's star approach.
function makeSandstormNightSkyTex(){
  const {c,g}=_newSkyCanvas('#0a0a1f','#2a2548');
  const W=1024, H=512;
  // Mid-band — soft purple haze blends zenith into horizon.
  const mid=g.createLinearGradient(0,160,0,360);
  mid.addColorStop(0,'rgba(26,21,53,0)');
  mid.addColorStop(.5,'rgba(26,21,53,0.55)');
  mid.addColorStop(1,'rgba(42,37,72,0)');
  g.fillStyle=mid; g.fillRect(0,160,W,200);
  // Lower horizon — slight indigo lift so the seam against fog disappears.
  const foot=g.createLinearGradient(0,420,0,512);
  foot.addColorStop(0,'rgba(42,37,72,0.4)');
  foot.addColorStop(1,'rgba(26,24,40,1)');
  g.fillStyle=foot; g.fillRect(0,420,W,92);
  // Milky Way band — diagonal cloudy strip from lower-left to upper-right
  // of the zenith half. Procedural blob-cluster fill via additive tint.
  // Saved + restored so we can rotate the canvas for the diagonal sweep
  // without affecting subsequent paints.
  g.save();
  g.translate(W*0.5, 220);
  g.rotate(-0.45);   // ~-26° tilt
  for(let i=0;i<70;i++){
    const x=(Math.random()-0.5)*W*1.4;
    const y=(Math.random()-0.5)*120;
    const r=18+Math.random()*36;
    const grd=g.createRadialGradient(x,y,0,x,y,r);
    grd.addColorStop(0,'rgba(180,170,210,0.18)');
    grd.addColorStop(1,'rgba(180,170,210,0)');
    g.fillStyle=grd; g.fillRect(x-r,y-r,r*2,r*2);
  }
  // Brighter clusters along the band's spine
  for(let i=0;i<30;i++){
    const x=(Math.random()-0.5)*W*1.2;
    const y=(Math.random()-0.5)*40;
    const r=8+Math.random()*16;
    const grd=g.createRadialGradient(x,y,0,x,y,r);
    grd.addColorStop(0,'rgba(220,210,250,0.32)');
    grd.addColorStop(1,'rgba(220,210,250,0)');
    g.fillStyle=grd; g.fillRect(x-r,y-r,r*2,r*2);
  }
  g.restore();
  // Star field — 200 desktop / 80 mobile, weighted toward zenith via
  // y=Math.pow(rand,1.6)*midY. 80% white, 15% blue-tinted, 5% warm-yellow.
  const STAR_COUNT=window._isMobile?80:200;
  for(let i=0;i<STAR_COUNT;i++){
    const x=Math.random()*W;
    // Zenith-weighted: rand^1.6 makes 80% of stars sit in the upper half.
    const y=Math.pow(Math.random(),1.6)*340;
    const r=Math.random();
    const size=r<0.85?1: r<0.97?1.5:2.2;
    const tone=r<0.80?'255,255,255': r<0.95?'216,224,255':'255,248,224';
    const alpha=(0.55+Math.random()*0.45).toFixed(2);
    g.fillStyle=`rgba(${tone},${alpha})`;
    g.fillRect(x, y, size, size);
  }
  // ── HERO: full moon, upper-right quadrant. Scaled to read at distance.
  const moonCx=720, moonCy=130, moonR=46;
  // Outer halo (additive feel via radial gradient white-blue → transparent).
  const halo=g.createRadialGradient(moonCx,moonCy,moonR*0.6, moonCx,moonCy,moonR*2.6);
  halo.addColorStop(0,'rgba(245,240,216,0.45)');
  halo.addColorStop(.4,'rgba(200,210,240,0.18)');
  halo.addColorStop(1,'rgba(200,210,240,0)');
  g.fillStyle=halo; g.fillRect(moonCx-moonR*2.6, moonCy-moonR*2.6, moonR*5.2, moonR*5.2);
  // Moon disc — cream-white with a faint terminator gradient.
  const disc=g.createRadialGradient(moonCx-moonR*0.25, moonCy-moonR*0.25, 0,
                                     moonCx, moonCy, moonR);
  disc.addColorStop(0,'rgba(255,250,232,1)');
  disc.addColorStop(.7,'rgba(245,240,216,1)');
  disc.addColorStop(1,'rgba(200,194,170,0.95)');
  g.fillStyle=disc; g.beginPath();
  g.arc(moonCx, moonCy, moonR, 0, Math.PI*2); g.fill();
  // Craters — 8 darker spots, sized + placed pseudo-randomly inside disc.
  const craters=[
    [-22,-12,7], [12,-18,5], [22,8,6], [-8,16,9],
    [-18,4,4], [4,-4,3], [16,-2,4], [-2,22,5]
  ];
  craters.forEach(([dx,dy,cr])=>{
    const cgrd=g.createRadialGradient(moonCx+dx,moonCy+dy,0, moonCx+dx,moonCy+dy,cr);
    cgrd.addColorStop(0,'rgba(170,165,148,0.55)');
    cgrd.addColorStop(1,'rgba(170,165,148,0)');
    g.fillStyle=cgrd; g.fillRect(moonCx+dx-cr, moonCy+dy-cr, cr*2, cr*2);
  });
  return _skyTexFromCanvas(c);
}

// Yield helper used between buildScene phases (and inside heavy per-world
// environment builders) so Chrome's "page unresponsive" detector — which
// resets between browser tasks — sees frequent task boundaries instead of
// one multi-second synchronous burst. Exposed on window so per-world
// scripts (e.g. js/worlds/guangzhou.js) can reuse the same primitive.
function _yieldBuild(){ return new Promise(r=>setTimeout(r,0)); }
if(typeof window!=='undefined') window._yieldBuild=_yieldBuild;

async function buildScene(){
  window.dbg&&dbg.log('scene','buildScene start — world='+activeWorld);
  if(window.Breadcrumb)Breadcrumb.push('buildScene',{world:activeWorld});
  // Perf Phase A: shader-program count voor en na buildScene.
  const _perfProgBefore=(renderer&&renderer.info&&renderer.info.programs&&renderer.info.programs.length)||0;
  if(window.perfMark)perfMark('build:total:start');
  if(window.perfMark)perfMark('build:disposeScene:start');
  disposeScene();
  if(window.perfMark){perfMark('build:disposeScene:end');perfMeasure('build.disposeScene','build:disposeScene:start','build:disposeScene:end');}
  // Asset-cache eviction (Phase 2 Fix B.3): scene is leeg na disposeScene,
  // dus geen actieve refs naar non-current world textures/models. Dispose
  // alles dat niet bij de actieve world hoort om cumulatieve VRAM-leak
  // over meerdere world-switches te voorkomen (Phase 1 bevinding 1.1).
  if(window.Assets&&window.Assets.evictAllExcept){
    try{ Assets.evictAllExcept(activeWorld); }
    catch(e){ if(window.dbg)dbg.warn('scene','evictAllExcept failed: '+(e&&e.message||e)); }
  }
  // ── Swap TRACK_WP data for active world ───────────────────────
  {const src=(_TRACKS&&_TRACKS[activeWorld])||_DEFAULT_WP;
   TRACK_WP.length=0;src.forEach(wp=>TRACK_WP.push(wp));}
  // ── Reset global arrays populated during scene build ──────────
  if(typeof window._clearPopinSuspects==='function') window._clearPopinSuspects();
  trackLightList.length=0;trackPoles.length=0;_trackFlags.length=0;_aiHeadPool.length=0;
  jumpRamps.length=0;spinPads.length=0;boostPads.length=0;collectibles.length=0;skidMarks.length=0;
  // Shared skid geometry was disposed by the traversal above — drop our reference so the next race builds a fresh one.
  if(typeof _skidGeo!=='undefined')_skidGeo=null;
  // World-specific arrays/refs live in lazy-loaded world scripts (js/worlds/*.js).
  // Guard every reset so a non-active world doesn't crash buildScene with
  // "Can't find variable" — matches the _vc*/_p47*/_gz* pattern below.
  if(typeof _wpGravityZones!=='undefined')_wpGravityZones.length=0;
  if(typeof _wpOrbitAsteroids!=='undefined')_wpOrbitAsteroids.length=0;
  if(typeof _wpWarpTunnels!=='undefined')_wpWarpTunnels.length=0;
  if(typeof _wpCurrentStreams!=='undefined')_wpCurrentStreams.length=0;
  if(typeof _wpAbyssCracks!=='undefined')_wpAbyssCracks.length=0;
  if(typeof _wpTreasureTrail!=='undefined')_wpTreasureTrail.length=0;
  stars=null;plHeadL=null;plHeadR=null;plTail=null;
  _boostLight=null;_trackMesh=null;_sunBillboard=null;_moonBillboard=null;
  if(typeof _spaceAsteroids!=='undefined')_spaceAsteroids.length=0;
  if(typeof _spaceDustParticles!=='undefined')_spaceDustParticles=null;
  if(typeof _spaceDustGeo!=='undefined')_spaceDustGeo=null;
  if(typeof _spaceDebrisIM!=='undefined')_spaceDebrisIM=null;
  if(typeof _spaceDebrisData!=='undefined')_spaceDebrisData.length=0;
  _snowParticles=null;_snowGeo=null;
  if(typeof _spaceGravityWells!=='undefined')_spaceGravityWells.length=0;
  if(typeof _spaceRailguns!=='undefined')_spaceRailguns.length=0;
  if(typeof _spaceUFOs!=='undefined')_spaceUFOs.length=0;
  if(typeof _spaceMeteors!=='undefined')_spaceMeteors.length=0;
  if(typeof _spaceMeteorTimer!=='undefined')_spaceMeteorTimer=18;
  if(typeof _spaceBeamMesh!=='undefined')_spaceBeamMesh=null;
  if(typeof _spaceBeamTimer!=='undefined')_spaceBeamTimer=0;
  if(typeof _spaceUnderglow!=='undefined')_spaceUnderglow.length=0;
  if(typeof _kelpList!=='undefined')_kelpList.length=0;
  if(typeof _jellyfishList!=='undefined')_jellyfishList.length=0;
  if(typeof _dsaLightRays!=='undefined')_dsaLightRays.length=0;
  if(typeof _dsaBioEdges!=='undefined')_dsaBioEdges.length=0;
  if(typeof _dsaBubbleGeo!=='undefined')_dsaBubbleGeo=null;
  if(typeof _dsaBubblePos!=='undefined')_dsaBubblePos=null;
  // Fase 2 plankton state — match het bestaande _dsa*-reset patroon zodat
  // disposed BufferGeometry + Float32Arrays niet als stale-refs blijven hangen
  // bij world-switch (~10 KB / wereld zonder deze reset).
  if(typeof _dsaPlanktonGeo!=='undefined')_dsaPlanktonGeo=null;
  if(typeof _dsaPlanktonPos!=='undefined')_dsaPlanktonPos=null;
  if(typeof _dsaPlanktonPhase!=='undefined')_dsaPlanktonPhase=null;
  if(typeof _dsaPlanktonCol!=='undefined')_dsaPlanktonCol=null;
  if(typeof _dsaPlanktonGlowing!=='undefined')_dsaPlanktonGlowing=false;
  if(typeof _dsaHGGeo!=='undefined')_dsaHGGeo=null;
  if(typeof _dsaHGPos!=='undefined')_dsaHGPos=null;
  if(typeof _dsaHGCol!=='undefined')_dsaHGCol=null;
  if(typeof _dsaHGN!=='undefined')_dsaHGN=0;
  if(typeof _dsaHGGlowing!=='undefined')_dsaHGGlowing=false;
  if(typeof _dsaTreasures!=='undefined')_dsaTreasures.length=0;
  if(typeof _dsaCreatures!=='undefined'){_dsaCreatures.manta=null;_dsaCreatures.whale=null;_dsaCreatures.fishSchools.length=0;}
  if(typeof _dsaCurrentDir!=='undefined')_dsaCurrentDir=0;
  if(typeof _sprinkleParticles!=='undefined')_sprinkleParticles=null;
  if(typeof _sprinkleGeo!=='undefined')_sprinkleGeo=null;
  if(typeof _candyFloatBits!=='undefined')_candyFloatBits=null;
  if(typeof _candyFloatBitsGeo!=='undefined')_candyFloatBitsGeo=null;
  if(typeof _candyFloatBitsVel!=='undefined')_candyFloatBitsVel=null;
  if(typeof _gummyBears!=='undefined')_gummyBears.length=0;
  if(typeof _gumZones!=='undefined')_gumZones.length=0;
  if(typeof _candyCannons!=='undefined')_candyCannons.length=0;
  if(typeof _chocoHighlight!=='undefined')_chocoHighlight=null;
  if(typeof _candyCaneList!=='undefined')_candyCaneList.length=0;
  if(typeof _candyLollipops!=='undefined')_candyLollipops.length=0;
  if(typeof _candyNightEmissives!=='undefined')_candyNightEmissives.length=0;
  if(typeof _candyCandles!=='undefined')_candyCandles.length=0;
  if(typeof _neonBuildings!=='undefined')_neonBuildings.length=0;
  if(typeof _neonEmissives!=='undefined')_neonEmissives.length=0;
  if(typeof _neonBuildingLights!=='undefined')_neonBuildingLights.length=0;
  if(typeof _holoBillboards!=='undefined')_holoBillboards.length=0;
  if(typeof _neonSteamVents!=='undefined')_neonSteamVents.length=0;
  if(typeof _neonSteamGeo!=='undefined')_neonSteamGeo=null;
  if(typeof _neonSteamPts!=='undefined')_neonSteamPts=null;
  if(typeof _neonSteamPos!=='undefined')_neonSteamPos=null;
  if(typeof _neonDustGeo!=='undefined')_neonDustGeo=null;
  if(typeof _neonDustPts!=='undefined')_neonDustPts=null;
  if(typeof _neonWater!=='undefined')_neonWater=null;
  if(typeof _neonEmpZones!=='undefined')_neonEmpZones.length=0;
  if(typeof _neonHoloWalls!=='undefined')_neonHoloWalls.length=0;
  if(typeof _volcanoLavaRivers!=='undefined')_volcanoLavaRivers.length=0;
  if(typeof _volcanoGeisers!=='undefined')_volcanoGeisers.length=0;
  if(typeof _volcanoEruption!=='undefined')_volcanoEruption=null;
  if(typeof _volcanoEruptionTimer!=='undefined')_volcanoEruptionTimer=3;
  if(typeof _volcanoEmberGeo!=='undefined')_volcanoEmberGeo=null;
  if(typeof _volcanoEmbers!=='undefined')_volcanoEmbers=null;
  if(typeof _volcanoGlowLight!=='undefined')_volcanoGlowLight=null;
  if(typeof _vcLavaPulseList!=='undefined')_vcLavaPulseList.length=0;
  if(typeof _vcGeisers!=='undefined')_vcGeisers.length=0;
  if(typeof _vcEmberGeo!=='undefined')_vcEmberGeo=null;
  if(typeof _vcEmbers!=='undefined')_vcEmbers=null;
  if(typeof _vcGlowLight!=='undefined')_vcGlowLight=null;
  if(typeof _vcEruption!=='undefined')_vcEruption=null;
  if(typeof _vcEruptionTimer!=='undefined')_vcEruptionTimer=4;
  if(typeof _arcticIcePatches!=='undefined')_arcticIcePatches.length=0;
  if(typeof _arcticAurora!=='undefined')_arcticAurora.length=0;
  if(typeof _arcticBlizzardGeo!=='undefined')_arcticBlizzardGeo=null;
  if(typeof _tpSwingRide!=='undefined')_tpSwingRide=null;
  if(typeof _tpCarousel!=='undefined')_tpCarousel=null;
  if(typeof _tpCarouselHorses!=='undefined')_tpCarouselHorses.length=0;
  if(typeof _tpCoasters!=='undefined')_tpCoasters.length=0;
  if(typeof _tpBalloons!=='undefined')_tpBalloons.length=0;
  if(typeof _tpFireworks!=='undefined')_tpFireworks.length=0;
  if(typeof _tpBunting!=='undefined')_tpBunting.length=0;
  if(typeof _tpParkLights!=='undefined')_tpParkLights.length=0;
  if(typeof _tpFireworkTimer!=='undefined')_tpFireworkTimer=2;
  if(typeof _p47Bridge!=='undefined')_p47Bridge=null;
  if(typeof _p47Drizzle!=='undefined')_p47Drizzle=null;
  if(typeof _p47DrizzleGeo!=='undefined')_p47DrizzleGeo=null;
  if(typeof _gzDrizzleGeo!=='undefined')_gzDrizzleGeo=null;
  if(typeof _gzDrizzle!=='undefined')_gzDrizzle=null;
  if(typeof _gzGuardrailMesh!=='undefined')_gzGuardrailMesh=null;
  if(typeof _gzBillboards!=='undefined')_gzBillboards.length=0;
  if(typeof _gzWindowGroups!=='undefined')_gzWindowGroups.length=0;
  if(typeof _gzHeroBillboardMats!=='undefined')_gzHeroBillboardMats.length=0;
  if(typeof _gzFlyingCars!=='undefined')_gzFlyingCars.length=0;
  if(typeof _gzFlyingCarsBody!=='undefined')_gzFlyingCarsBody=null;
  if(typeof _gzFlyingCarsLights!=='undefined')_gzFlyingCarsLights=null;
  if(typeof _gzOverheadFlock!=='undefined')_gzOverheadFlock.length=0;
  if(typeof _gzOverheadFlockBody!=='undefined')_gzOverheadFlockBody=null;
  if(typeof _gzOverheadFlockLights!=='undefined')_gzOverheadFlockLights=null;
  if(typeof _gzCrossFlock!=='undefined')_gzCrossFlock.length=0;
  if(typeof _gzCrossFlockBody!=='undefined')_gzCrossFlockBody=null;
  if(typeof _gzCrossFlockLights!=='undefined')_gzCrossFlockLights=null;
  if(typeof _gzDroneFlock!=='undefined')_gzDroneFlock.length=0;
  if(typeof _gzDroneFlockIM!=='undefined')_gzDroneFlockIM=null;
  if(typeof _gzLightTex!=='undefined')_gzLightTex=null;
  if(typeof _gzGroundTraffic!=='undefined')_gzGroundTraffic=null;
  if(typeof _gzGroundTrafficData!=='undefined')_gzGroundTrafficData.length=0;
  if(typeof _gzHeadlampPool!=='undefined')_gzHeadlampPool=null;
  if(typeof _gzHighway!=='undefined')_gzHighway=null;
  if(typeof _gzHighwayLights!=='undefined')_gzHighwayLights=null;
  if(typeof _gzHighwayData!=='undefined')_gzHighwayData.length=0;
  if(typeof _gzSkyLasers!=='undefined')_gzSkyLasers=null;
  if(typeof _gzJellyfishBell!=='undefined')_gzJellyfishBell=null;
  if(typeof _gzJellyfishTentacles!=='undefined')_gzJellyfishTentacles=null;
  if(typeof _gzJellyfishAnchor!=='undefined')_gzJellyfishAnchor=null;
  if(typeof _gzSearchlights!=='undefined')_gzSearchlights=null;
  if(typeof _gzSearchlightData!=='undefined')_gzSearchlightData.length=0;
  if(typeof _gzDisposables!=='undefined')_gzDisposables.length=0;
  // Cinematic helpers (js/effects/cinematic.js) — drain registered fog/
  // markers so the next world starts clean. The actual mesh + tex disposal
  // is handled by the generic scene.traverse path; we only zero the refs.
  if(typeof window!=='undefined'&&typeof window.resetCinematicState==='function'){
    window.resetCinematicState();
  }
  if(typeof window!=='undefined'&&typeof window.disposeCinematicCaches==='function'){
    window.disposeCinematicCaches();
  }

  await _yieldBuild();
  const isSpace=activeWorld==='space';
  const isDeepSea=activeWorld==='deepsea';
  const isCandy=activeWorld==='candy';
  const isVolcano=activeWorld==='volcano';
  const isArctic=activeWorld==='arctic';
  const isSandstorm=activeWorld==='sandstorm';
  const isPier47=activeWorld==='pier47';
  const isGuangzhou=activeWorld==='guangzhou';
  scene=new THREE.Scene();
  // scene.environment wordt per-world gezet ná het skybox-block hieronder
  // (zie _buildWorldEnvFromSky aanroep). Dit was eerder een generieke
  // procedural gradient direct na new Scene(), maar per-world PMREM-cubemap
  // van het bestaande skybox canvas geeft dramatisch betere reflecties op
  // car clearcoat (sun, neon, embers, aurora — wereld-specifiek).
  // Fog color is matched to the skybox horizon (sky-bottom gradient stop) per world,
  // so fogged distant geometry blends seamlessly into the sky instead of producing a
  // visible "kleurverschil" band where the fogged scene meets the skybox.
  // Day/Night fog colors mirror toggleNight()'s skybox swaps so updateSky's lerp
  // never drifts to a wrong-world fog color (e.g. light-blue fog in the volcano).
  if(isSpace){
    scene.background=_getOrBuildSkyTex(makeSpaceSkyTex);
    scene.fog=new THREE.FogExp2(0x010018,.0014);
    _fogColorDay.setHex(0x10085a);_fogColorNight.setHex(0x0a0a30);
  }else if(isDeepSea){
    // Fase 1 afgrond-tune: fog-kleur matcht skybox-foot (#001825) zodat horizon
    // naadloos overgaat in de skybox-gradiënt — geen aparte verticale dome-fog
    // nodig, donkere watermassa "in de hoogte" volgt uit de bestaande sky.
    // Tier-dependent density: mobile 30% dunner voor LOW-tier leesbaarheid
    // (hardgrens: baan + bocht moeten leesbaar blijven op iPhone 12).
    // Constanten gedefinieerd bovenin js/worlds/deepsea.js (live-tweakbaar).
    scene.background=_getOrBuildSkyTex(makeDeepSeaSkyTex);
    const _dsDensity = window._isMobile ? DS_FOG_DENSITY_MOBILE : DS_FOG_DENSITY_DESKTOP;
    scene.fog=new THREE.FogExp2(DS_FOG_COLOR_DAY,_dsDensity);
    _fogColorDay.setHex(DS_FOG_COLOR_DAY);_fogColorNight.setHex(DS_FOG_COLOR_NIGHT);
  }else if(isCandy){
    scene.background=_getOrBuildSkyTex(makeCandyDuskSkyTex);
    // "Verlaten pretpark om middernacht" V1: diep indigo-aubergine fog
    // matcht skybox-foot (#2a1838) zodat horizon-seam onzichtbaar blijft.
    // Density 0.0085 — flink dichter voor pretpark-mist-vibe, maar nog
    // onder pier47-day (.012). _fogColorNight ongewijzigd (nacht is
    // niet aangepast).
    scene.fog=new THREE.FogExp2(0x2a1838,.0085);
    _fogColorDay.setHex(0x2a1838);_fogColorNight.setHex(0x3e0c52);
  }else if(isVolcano){
    // Volcano keeps its procedural ember-haze sky in both modes — fog matches
    // the rusty horizon glow at the bottom of the canvas (~rgba(180,40,0)
    // composited over #2a0810) so distant lava-rock fades into the sky band.
    scene.background=_getOrBuildSkyTex(makeVolcanoSkyTex);
    scene.fog=new THREE.FogExp2(0x6a1808,.002);
    _fogColorDay.setHex(0x6a1808);_fogColorNight.setHex(0x6a1808);
  }else if(isArctic){
    scene.background=_getOrBuildSkyTex(makeArcticSkyTex);
    scene.fog=new THREE.FogExp2(0x1a3050,.0035);
    _fogColorDay.setHex(0x1a3050);_fogColorNight.setHex(0x162e48);
  }else if(isSandstorm){
    // Sandstorm uses linear THREE.Fog (not Exp2) so the rolling-storm hazard
    // can mutate scene.fog.far on a known scale. Lap-1 baseline: far=220
    // (clear desert visibility); hazard pulls it down to 55 on lap 3.
    // _fogBaseDensity stays at the linear 'far' for setWeather rain blend
    // (linear fog ignores density, so weather-rain-add becomes a no-op here
    // — acceptable since sandstorm has no rain mode).
    scene.background=_getOrBuildSkyTex(makeSandstormSkyTex);
    // Warm-sunset fog color matches the skybox foot-band so distance-faded
    // mesas tie into the sunset palette seamlessly. Distances (60..220)
    // are owned by sandstorm-storm.js's hazard mechanic (_SS_FOG_FAR_DEFAULT=220
    // + lap2 110 + lap3 55) — must stay aligned.
    scene.fog=new THREE.Fog(0xe8a468,60,220);
    _fogColorDay.setHex(0xe8a468);_fogColorNight.setHex(0x6a4830);
  }else if(isPier47){
    // Pier 47 — donker bewolkte nacht. Fog density 0.012 is denser than the
    // other Exp2-fog worlds (.0014..0035) to reinforce the closed-in
    // industrial-harbour vibe. Color is donkerpaars-grijs (#252030) which
    // matches the skybox foot-band so distance-faded geometry blends
    // seamlessly into the horizon. Day = the same overcast-night palette;
    // a brighter "ochtend"-mode for the toggle is reserved for sessie 3.
    scene.background=_getOrBuildSkyTex(makePier47SkyTex);
    scene.fog=new THREE.FogExp2(0x252030,.012);
    _fogColorDay.setHex(0x252030);_fogColorNight.setHex(0x18141f);
    // Phase 6.8 — try shader-sky dome (template wereld). Als de helper
    // bestaat en mobile-gate doorlaat, krijgt Pier47 een shader-based
    // sky met sun-tracking + cloud-noise drift. Bij compile-fail blijft
    // de CanvasTexture sky in scene.background staan = identieke fallback.
    if(typeof window._buildSkyShaderForWorld === 'function'){
      const dome=window._buildSkyShaderForWorld('pier47');
      if(dome) scene.add(dome);
    }
  }else if(isGuangzhou){
    // Guangzhou Cinematic — wet neon night. Fog is very dark purple-black
    // (#0e0c1a) matching the skybox foot-band so distance-faded asphalt
    // ties into the horizon seamlessly. Density 0.0075.
    scene.background=_getOrBuildSkyTex(makeGuangzhouSkyTex);
    scene.fog=new THREE.FogExp2(0x0e0c1a,.0075);
    _fogColorDay.setHex(0x0e0c1a);_fogColorNight.setHex(0x08060e);
    // Phase 6.8 rollout — Guangzhou shader-sky met neon-magenta palette.
    // Fallback naar CanvasTexture sky bij mobile/compile-fail.
    if(typeof window._buildSkyShaderForWorld === 'function'){
      const dome=window._buildSkyShaderForWorld('guangzhou');
      if(dome) scene.add(dome);
    }
  }else{
    // Onbekende world — val terug op space-sky zodat de scene niet crasht.
    if(window.dbg)dbg.warn('scene','unknown world '+activeWorld+' — falling back to space sky');
    scene.background=_getOrBuildSkyTex(makeSpaceSkyTex);
    scene.fog=new THREE.FogExp2(0x010018,.0014);
    _fogColorDay.setHex(0x10085a);_fogColorNight.setHex(0x0a0a30);
  }
  // World-themed envMap: PMREM het skybox canvas voor cubemap-reflecties op
  // car clearcoat. Vervangt de generic procedural gradient die in een eerder
  // commit als scene.environment werd gezet (vlak na new Scene()). Per-world
  // envs zijn dramatisch rijker: sun-spot reflectie op GP, ember glow op
  // Volcano. Procedural blijft fallback voor het
  // geval PMREM faalt.
  {
    const _worldEnv=_buildWorldEnvFromSky(scene.background);
    scene.environment=_worldEnv||_buildProceduralEnvMap();
  }
  // Per-world color grading + vignette in postfx composite.
  if(typeof setWorldGrading==='function')setWorldGrading(activeWorld);
  // Per-world bloom strength multiplier (Candy/Guangzhou have many emissives
  // packed close together — full strength bleeds across the narrow track).
  if(typeof setBloomWorld==='function')setBloomWorld(activeWorld);
  // Per-world atmosphere tuning (godrays strength + horizon-haze colour).
  // See js/effects/atmosphere-pass.js _WORLD_ATMOSPHERE_TUNE for values.
  // (Phase 1 graphics setWorldExposure dropped — overlapped met master's
  // sun-arc tijd-gebaseerde exposure target lerp.)
  if(typeof setAtmosphereWorld==='function')setAtmosphereWorld(activeWorld);
  // PBR-upgrade Brok 1a: per-wereld visuele config (IBL-multiplier,
  // exposure-target, emissive-multiplier voor neon-getagde materialen). Skipt
  // ongetagde materialen tot Brok 1b de wereld-modules aanvult.
  if(typeof window.applyWorldVisuals === 'function'){
    window.applyWorldVisuals(activeWorld, scene, renderer);
  }
  // PBR-upgrade Brok 3: contact-shadows InstancedMesh attachen aan de
  // nieuwe scene. Init bij eerste call; daarna alleen re-attach na
  // disposeScene op wereld-switch.
  if(typeof window._initContactShadows === 'function')window._initContactShadows();
  if(typeof window._reattachContactShadows === 'function')window._reattachContactShadows();
  // Per-world camera far-plane. Deep Sea krijgt 800u afgestemd op fog-cutoff
  // (~2/d met d=0.0028 desktop) — voorkomt onnodig tekenen achter de fog-muur
  // en blijft binnen sunLight.shadow.camera.far (700). Andere worlds blijven 900.
  const _camFar = isDeepSea ? DS_CAM_FAR : 900;
  camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.2,_camFar);
  camera.position.set(0,12,330);camera.lookAt(0,0,280);
  camPos.copy(camera.position);
  mirrorCamera=new THREE.PerspectiveCamera(68,204/80,.1,400);

  // Deep Sea fase 1: sun ietsje koeler + dimmer (0x4477aa @ 0.40) op desktop
  // voor afgrond-look. Op mobile geen IBL om de gaten op te vullen → daar
  // brightere waarden (0x44aacc @ 0.50) zodat asphalt niet pikzwart rendert.
  const _dsMobi = isDeepSea && window._isMobile;
  const _dirLightColor=isSpace?0xaaaaff:isDeepSea?(_dsMobi?0x44aacc:0x4477aa):isCandy?0xfff0e0:0xfff5e0;
  const _dirLightInt=isSpace?.06:isDeepSea?(_dsMobi?.50:.40):isCandy?1.5:1.65;
  sunLight=new THREE.DirectionalLight(_dirLightColor,_dirLightInt);
  sunLight.position.set(180,320,80);
  // Tier flag dictates whether the sun casts shadows (low tier = no shadows).
  const _qfShadowSize = (window._qFlags && window._qFlags.shadowMapSize) || 1024;
  sunLight.castShadow = !!(window._qFlags ? window._qFlags.shadows : !window._isMobile);
  sunLight.shadow.mapSize.set(_qfShadowSize, _qfShadowSize);
  // Shadow camera frustum: was 1000×1000×890 (default-style, oversized — see
  // history). Track waypoints reach ±390u on space/deepsea (per
  // data/tracks.json), so a lateral cover of ±420 keeps every car and
  // roadside prop inside the shadow frustum on all 11 worlds. Original
  // ±500 was generous; ±420 + tightened near/far gives a slightly sharper
  // shadow (1.22 t/u vs 1.02 t/u at 1024²) without clipping car shadows on
  // wide-track worlds. normalBias added to suppress the acne the oversized
  // original brushed past via raw scale.
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far  = 700;
  sunLight.shadow.camera.left = -420;
  sunLight.shadow.camera.right =  420;
  sunLight.shadow.camera.top   =  420;
  sunLight.shadow.camera.bottom = -420;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.02;
  sunLight.shadow.camera.updateProjectionMatrix();
  scene.add(sunLight);
  // Deep Sea fase 1: ambient drop 0.55→0.30 + kleur matcht fog op DESKTOP voor
  // afgrond-look (IBL vult de gaten op). Op mobile is er geen IBL → mijn
  // oorspronkelijke fase-1 cut maakte asphalt pikzwart in alle non-headlight-
  // gebieden. Mobile krijgt daarom brighter ambient (0x003355 @ 0.50) en hemi
  // (0x0055aa/0x001a22 @ 0.28) — meer richting pré-fase-1, niet volledig terug
  // maar genoeg om de baan los te trekken van puur zwart.
  const _ambColor=isSpace?0x334466:isDeepSea?(_dsMobi?0x003355:0x001828):isCandy?0xffccdd:0x88aacc;
  const _ambInt=isSpace?.18:isDeepSea?(_dsMobi?.50:.30):isCandy?.65:.50;
  ambientLight=new THREE.AmbientLight(_ambColor,_ambInt);scene.add(ambientLight);
  const _hemiSky=isSpace?0x334466:isDeepSea?(_dsMobi?0x0055aa:0x003560):isCandy?0xffd4e8:0x9bbfdd;
  const _hemiGnd=isSpace?0x110022:isDeepSea?(_dsMobi?0x001a22:0x000508):isCandy?0xffccaa:0x4a7a3d;
  const _hemiInt=isSpace?.14:isDeepSea?(_dsMobi?.28:.20):isCandy?.45:.36;
  hemiLight=new THREE.HemisphereLight(_hemiSky,_hemiGnd,_hemiInt);scene.add(hemiLight);

  // Per-world rim-light: 2nd DirectionalLight from the opposite side of the
  // sun, low intensity, complementary colour. Adds silhouette edge to cars
  // + props that the sun alone can't reach. No shadows (avoids 2nd 1024²
  // shadow-map pass). Color choices follow the world palette:
  //   warm sun ↔ cool rim (volcano, sandstorm — orange sun, blue rim)
  //   cool sun ↔ warm rim (arctic — cool sun, amber rim)
  //   neutral sun ↔ neutral subtle (others)
  // Intensity capped at 0.20 so the sun stays the dominant key light. Effect
  // is most visible on car clearcoat + side facets of props.
  const _RIM_LIGHT_CONFIG = {
    space:               { color: 0x6688aa, int: 0.10, pos: [-140, 220,-80] },
    deepsea:             { color: 0x88ccee, int: 0.10, pos: [-160, 180,-60] },
    candy:               { color: 0xff8ec0, int: 0.16, pos: [-180, 240,-60] },
    volcano:             { color: 0x4488cc, int: 0.16, pos: [-180, 240,-60] },
    arctic:              { color: 0xffb877, int: 0.14, pos: [-140, 220,-80] },
    sandstorm:           { color: 0x6688aa, int: 0.16, pos: [-180, 200,-60] },
    pier47:              { color: 0xff8830, int: 0.18, pos: [-180, 160,-80] },
    guangzhou:           { color: 0xff66cc, int: 0.20, pos: [-180, 220,-80] }
  };
  const _rimCfg = _RIM_LIGHT_CONFIG[activeWorld];
  if(_rimCfg){
    const rim = new THREE.DirectionalLight(_rimCfg.color, _rimCfg.int);
    rim.position.set(_rimCfg.pos[0], _rimCfg.pos[1], _rimCfg.pos[2]);
    rim.castShadow = false;
    rim.userData._rimLight = true;
    scene.add(rim);
    window._rimLight = rim;
  } else {
    window._rimLight = null;
  }

  await _yieldBuild();
  if(window.perfMark)perfMark('build:track:start');
  buildTrack();
  // Phase 8.6 — racing-line wear streaks bij corners. LineSegments-mesh
  // bovenop asphalt waar curvature een donker rubber-stain produceert.
  // Loopt na buildTrack zodat trackCurve gegarandeerd bestaat.
  if(typeof buildRacingLineWear === 'function') buildRacingLineWear();
  // Issue 12 (V5.3): buildGantry() was defined in track.js but never called.
  // Gantry has world-specific text + colour via WORLD_TRACK_PALETTE + _gantryFrameText.
  // Guangzhou entry exists: 'GUANGZHOU NIGHT GP' + accent #ff2080. Calling here,
  // after buildTrack() (needs trackCurve), before world environment builders.
  if(typeof buildGantry === 'function') buildGantry();
  if(window.perfMark){perfMark('build:track:end');perfMeasure('build.track','build:track:start','build:track:end');}
  await _yieldBuild();
  if(window.perfMark)perfMark('build:world:start');
  if(isSpace){
    await buildSpaceEnvironment();
  }else if(isDeepSea){
    await buildDeepSeaEnvironment();
    buildBackgroundLayers();
  }else if(isCandy){
    await buildCandyEnvironment();
    buildBackgroundLayers();
  }else if(activeWorld==='volcano'){
    await buildVolcanoEnvironment();
    buildBackgroundLayers();
  }else if(activeWorld==='arctic'){
    await buildArcticEnvironment();
    buildBackgroundLayers();
  }else if(isSandstorm){
    await buildSandstormEnvironment();
    buildBackgroundLayers();
  }else if(isPier47){
    await buildPier47Environment();
    // Sessie 2: distant industrial skyline silhouettes (containers /
    // warehouse roofs / crane booms catching sodium-orange backlight).
    // Palette lives in track/environment.js _SILHOUETTE_PALETTES.pier47.
    buildBackgroundLayers();
  }else if(isGuangzhou){
    await buildGuangzhouEnvironment();
    // _SILHOUETTE_PALETTES.guangzhou added in commit 3 — far CBD skyline
    // silhouettes behind the track. See track/environment.js.
    buildBackgroundLayers();
  }else{
    if(window.dbg)dbg.warn('scene','unknown world '+activeWorld+' — no environment builder, scene will be sparse');
  }
  // Per-world moon (no-op for worlds without WORLD_MOON_PROFILE entry —
  // pier47 skips cleanly). Sun-pin pattern;
  // visibility tied to isDark via toggleNight().
  if(typeof buildWorldMoon==='function')buildWorldMoon();
  // Sun-disc billboard for daylight worlds. Shared across all daylight worlds;
  // originally per-world only, now all worlds had no bright-source primitive in the sky, so
  // the godrays pass had nothing intense enough above the bloom
  // threshold to produce visible shafts. buildSunBillboard is idempotent
  // (returns early if a sprite already exists in scene), so per-world
  // builders that customise sun direction/radius can still call it.
  // visibility is gated by night.js toggleNight() per world (space +
  // deepsea hide the sun automatically).
  if(typeof buildSunBillboard==='function') buildSunBillboard();
  if(window.perfMark){perfMark('build:world:end');perfMeasure('build.world','build:world:start','build:world:end');}
  await _yieldBuild();
  if(window.perfMark)perfMark('build:gameplayObjects:start');
  buildJumpRamps();
  // buildCenterlineArrows() disabled — it produced 110 white X marks
  // (two bars rotated ±27° around the same point) every ~7m down the
  // centerline, which the user reported as "stray X decals on the
  // racing surface". Edge-lines + curbs are sufficient for navigation;
  // wrong-way detection is independent.
  buildSpinPads();
  buildBoostPads();
  buildCollectibles();
  buildWorldElements();
  buildParticles();
  // AI headlight pool — 4 point lights shared across AI cars
  for(let i=0;i<4;i++){const l=new THREE.PointLight(0xffffcc,0,22,2);scene.add(l);_aiHeadPool.push(l);}
  buildGhostMesh();
  initSpeedLines();
  initRain();
  if(window.perfMark){perfMark('build:gameplayObjects:end');perfMeasure('build.gameplayObjects','build:gameplayObjects:start','build:gameplayObjects:end');}
  await _yieldBuild();
  // Cache minimap bounds
  const _xs=TRACK_WP.map(p=>p[0]),_zs=TRACK_WP.map(p=>p[1]);
  _mmBounds={mnX:Math.min(..._xs),mxX:Math.max(..._xs),mnZ:Math.min(..._zs),mxZ:Math.max(..._zs)};
  // Day/night state honours the user's persistent preference. Default for
  // new players (absence of src_night key) is night; existing users with
  // '1' stay night, with '0' stay day across world-switches. Pre-flip to
  // !target so toggleNight() lands on the desired state and the per-world
  // P4 PMREM cache + emissive/light setup runs through the canonical path.
  if(window.perfMark)perfMark('build:night:start');
  const _wantDark=localStorage.getItem('src_night')!=='0';
  isDark=!_wantDark;toggleNight();
  if(window.perfMark){perfMark('build:night:end');perfMeasure('build.night','build:night:start','build:night:end');}
  // Apply any cached HDRI / PBR ground textures from window.Assets. No-op
  // if the manifest has no slots filled or preload hasn't completed yet —
  // boot.js + select.js re-call maybeUpgradeWorld when preload resolves.
  if(window.perfMark)perfMark('build:assetBridge:start');
  if(typeof maybeUpgradeWorld==='function')maybeUpgradeWorld(activeWorld);
  if(window.perfMark){perfMark('build:assetBridge:end');perfMeasure('build.assetBridge','build:assetBridge:start','build:assetBridge:end');}
  // CubeCamera scene-env bake: replaces the sky-based env with a real cube
  // rendering of the live 3D world (buildings, lava, neon, trees show in
  // car clearcoat reflections). Skips on mobile. Sky-based env stays the
  // fallback if PMREM/CubeCamera fails. Cost: ~5-15ms desktop, runs once
  // per world build. See js/core/env-baker.js.
  await _yieldBuild();
  if(window.perfMark)perfMark('build:envBake:start');
  if(typeof window._applySceneEnvBake==='function')window._applySceneEnvBake();
  if(window.perfMark){perfMark('build:envBake:end');perfMeasure('build.envBake','build:envBake:start','build:envBake:end');}
  await _yieldBuild();
  // Pre-compile materials voor de nieuwe wereld. _precompileScene roept
  // alleen renderer.compile() aan; de daadwerkelijke shader-link + GPU-
  // upload kost wordt opgevangen door de postfx warm-render hieronder
  // (PHASE-C fix), die langs het echte race-render-pad gaat zodat de
  // juiste shader-permutaties en postfx-pipeline gewarmd worden.
  if(window.perfMark)perfMark('build:precompile:start');
  _precompileScene();
  if(window.perfMark){perfMark('build:precompile:end');perfMeasure('build.precompile','build:precompile:start','build:precompile:end');}
  // Title warm-render: _precompileScene() roept alleen renderer.compile() aan,
  // wat shader-source uploadt + async compileert. Driver-link + texture-upload
  // + 1e shadow-pass gebeuren pas op het 1e echte renderer.render(). Op TITLE
  // is dat loop.js' bare render (geen postfx) → eerste zichtbare title-frame
  // pakt 50-200ms hitch. Door hier nu één bare warm-render te doen verstopt
  // die kost achter het loading-screen (loader hide pas na 2 rAFs in boot.js).
  // _warmTextures forceert CanvasTexture-upload zodat het render-call zelf
  // geen texture-upload-stall meer pakt. Geen postfx hier: TITLE state rendert
  // sowieso bare (zie loop.js _idleBare-pad), dus postfx-shaders horen niet
  // bij dit pad. Race-pad warmt postfx-pipeline in goToRace na makeAllCars.
  if(typeof _warmTextures==='function'){
    if(window.perfMark)perfMark('build:warmTex:start');
    try{_warmTextures();}catch(e){if(window.dbg)dbg.warn('scene','build warmTextures failed: '+(e&&e.message||e));}
    if(window.perfMark){perfMark('build:warmTex:end');perfMeasure('build.warmTextures','build:warmTex:start','build:warmTex:end');}
  }
  // Eager bounding-sphere compute zodat lod-cull.js geen periodieke
  // computeBoundingSphere() per mesh hoeft te draaien (10-100ms spikes op
  // prop-heavy worlds). Eén traverse hier kost <1ms; daarna heeft elke mesh
  // een geldige geometry.boundingSphere voor LOD-anchor berekening.
  try{
    scene.traverse(o=>{
      if(o.isMesh && o.geometry && !o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    });
  }catch(e){if(window.dbg)dbg.warn('scene','eager boundingSphere compute failed: '+(e&&e.message||e));}
  if(renderer&&scene&&camera){
    if(window.perfMark)perfMark('build:warmRender:start');
    try{renderer.render(scene,camera);}
    catch(e){if(window.dbg)dbg.warn('scene','build warm-render failed: '+(e&&e.message||e));}
    if(window.perfMark){perfMark('build:warmRender:end');perfMeasure('build.warmRender','build:warmRender:start','build:warmRender:end');}
  }
  // SEAM-DBG 2026-05-25 — forensische diagnose Candy "verlaten pretpark"
  // horizon-naad. Diagnostic only, no behavior change. Volledig
  // terugdraaibaar: grep "SEAM-DBG 2026-05-25" en verwijder gemarkeerde
  // blokken. Plan-ref: docs/plans/candy-sky-seam (zie PR-body).
  if(activeWorld==='candy' && typeof dbg!=='undefined'){
    try{
      const bg=scene.background, cvs=bg&&bg.image;
      const mapMap={300:'UVMapping',301:'CubeReflectionMapping',302:'CubeRefractionMapping',303:'EquirectangularReflectionMapping',304:'EquirectangularRefractionMapping',306:'CubeUVReflectionMapping',307:'CubeUVRefractionMapping'};
      const samples=[];
      if(cvs && typeof cvs.getContext==='function'){
        try{
          const g2=cvs.getContext('2d');
          const W=cvs.width, H=cvs.height, sy=H/512;
          [0,128,256,380,420,450,470,490,510,511].forEach(y=>{
            try{
              const d=g2.getImageData(Math.round(W/2),Math.min(H-1,Math.round(y*sy)),1,1).data;
              samples.push({y,r:d[0],g:d[1],b:d[2],a:d[3]});
            }catch(e){samples.push({y,err:String(e&&e.message||e)});}
          });
        }catch(e){samples.push({err:'ctx2d:'+(e&&e.message||e)});}
      }
      let groundCol=null, infCol=null;
      scene.traverse(o=>{
        if(!o.isMesh||!o.geometry||!o.geometry.parameters)return;
        if(o.geometry.type!=='PlaneGeometry')return;
        const p=o.geometry.parameters;
        if(Math.abs(p.width-2400)<1 && groundCol===null && o.material && o.material.color){
          groundCol={hex:o.material.color.getHexString(),y:o.position.y,hasMap:!!o.material.map};
        } else if(Math.abs(p.width-440)<1 && infCol===null && o.material && o.material.color){
          infCol={hex:o.material.color.getHexString(),y:o.position.y,hasMap:!!o.material.map};
        }
      });
      const payload={
        world:'candy',
        build:Date.now(),
        sky:{
          mapping:bg&&bg.mapping,
          mappingName:bg&&(mapMap[bg.mapping]||'unknown('+bg.mapping+')'),
          uuid:bg&&bg.uuid,
          shared:bg&&bg.userData&&!!bg.userData._sharedAsset,
          cvsW:cvs&&cvs.width, cvsH:cvs&&cvs.height,
          samples
        },
        fog:scene.fog?{
          hex:scene.fog.color&&scene.fog.color.getHexString(),
          density:scene.fog.density,
          isExp2:!!scene.fog.isFogExp2,
          near:scene.fog.near, far:scene.fog.far
        }:null,
        ground:groundCol,
        infield:infCol,
        camera:{fov:camera.fov,near:camera.near,far:camera.far,
                pos:[+camera.position.x.toFixed(2),+camera.position.y.toFixed(2),+camera.position.z.toFixed(2)],
                rotX:+camera.rotation.x.toFixed(3)},
        isMobile:!!window._isMobile
      };
      dbg.error('seam-dbg','BUILD candy — DIAGNOSTIC ONLY, no behavior change. '+JSON.stringify(payload));
      if(window.console&&console.log)console.log('[seam-dbg] BUILD candy payload',payload);
    }catch(e){if(window.dbg)dbg.error('seam-dbg','BUILD candy logging failed: '+(e&&e.stack||e));}
    window._seamSamplerDone=false;
  }
  if(window.perfMark){perfMark('build:total:end');perfMeasure('build.total','build:total:start','build:total:end');}
  // Cold-start diagnose: meet de tijd tussen buildScene-eind en de eerste
  // rAF-callback ná build. Deze gap isoleert kosten die NIET in de build
  // zelf zitten maar bij het eerste echte render-frame opduiken: shader-link
  // van net-gecompileerde programs, GPU-upload van pas-aangemaakte textures,
  // postfx-pipeline link. Verwante measure: build.warmRender (boven) dekt
  // de bare/postfx warmup binnen buildScene; deze meet wat erna nog komt.
  if(window.perfMark){
    perfMark('build:firstRenderAfterBuild:scheduled');
    const _worldAtBuild = activeWorld;
    requestAnimationFrame(()=>{ try{
      perfMark('build:firstRenderAfterBuild:done');
      perfMeasure('build.firstRenderAfterBuild','build:firstRenderAfterBuild:scheduled','build:firstRenderAfterBuild:done');
      if(window.perfLog){
        const _last = window.perfLog[window.perfLog.length-1];
        if(_last && _last.name==='build.firstRenderAfterBuild') _last.world = _worldAtBuild;
      }
    }catch(_){} });
  }
  // Shader-program count delta over the buildScene window.
  if(window.perfLog){
    const _perfProgAfter=(renderer&&renderer.info&&renderer.info.programs&&renderer.info.programs.length)||0;
    window.perfLog.push({name:'shaderPrograms.delta',ms:_perfProgAfter-_perfProgBefore,t:performance.now(),world:activeWorld});
    window.perfLog.push({name:'shaderPrograms.afterBuild',ms:_perfProgAfter,t:performance.now(),world:activeWorld});
    if(window.dbg)dbg.log('perf','shader programs '+_perfProgBefore+'→'+_perfProgAfter+' ('+activeWorld+')');
  }
  window.dbg&&dbg.snapshot('scene','buildScene done',{world:activeWorld,objects:scene.children.length,camPos:camera.position});
}

// Pre-compile materials. renderer.compile() laat de driver shader-source
// uploaden + async compileren — de werkelijke link gebeurt pas op de eerste
// echte render-call. Geen render hier: de phase-A meting liet zien dat een
// off-screen 16×16 render (eerder hier aanwezig) niet alleen de link forceert
// maar ook de sunLight shadow-pass (1024×1024) en alle texture/geometry
// uploads sync uitvoert; cost was 1.0–25.2 sec per build vs <1 sec voor
// compile zelf (zie PERF_PHASE_B_PLAN.md). De link/upload cost wordt nu
// opgevangen door de postfx warm-render in buildScene direct hierna, die
// langs het echte race-render-pad gaat zodat de juiste shader-permutaties
// gewarmd worden.
function _precompileScene(){
  if(!renderer||!scene||!camera)return;
  const _t0=performance.now();
  const _progBefore=(renderer.info.programs&&renderer.info.programs.length)||0;
  const _texBefore=renderer.info.memory.textures;
  if(window.perfMark)perfMark('precompile:compile:start');
  try{
    if(typeof renderer.compile==='function')renderer.compile(scene,camera);
  }catch(e){
    if(window.dbg)dbg.error('scene',e,'precompile failed');
  }
  if(window.perfMark){perfMark('precompile:compile:end');perfMeasure('build.precompile.compile','precompile:compile:start','precompile:compile:end');}
  if(window.dbg){
    const _dur=performance.now()-_t0;
    const _progAfter=(renderer.info.programs&&renderer.info.programs.length)||0;
    const _texAfter=renderer.info.memory.textures;
    dbg.markRaceEvent('PRECOMPILE-DONE',{
      durMs:+_dur.toFixed(2),
      progDelta:_progAfter-_progBefore,
      texDelta:_texAfter-_texBefore,
      world:activeWorld
    });
  }
}
// Exposed zodat asset-bridge.js (HDRI/PBR async upgrade) opnieuw kan
// pre-compilen nadat maybeUpgradeWorld materialen vervangt of envMap
// toevoegt. Zonder deze re-precompile zou Phase 3.1.a geen effect hebben
// op werelden waar PBR ground/HDRI later async resolveert.
window._precompileScene=_precompileScene;

// Chunked variant van _precompileScene voor cold-start fix-sessie. Doel:
// de 38s race-start shader-compile breken in batches met rAF-yields, zodat
// Chrome's "Page Unresponsive"-heuristic niet triggert. Spinner is al
// zichtbaar via navigation.js' raceStartOverlay / boot.js' loadingScreen;
// deze fix levert main-thread vrij periodiek aan event loop.
//
// Feature-detect compileAsync (r152+) — als ooit beschikbaar in de vendor-
// build (huidige assets/vendor/three-r160.min.js heeft 'm niet), gebruik
// die native async-route. Fallback: per-mesh compile via scene.traverse,
// yield elke BATCH_SIZE_DEFAULT meshes.
//
// labelFn(i, N) wordt per voltooide batch aangeroepen voor UI-feedback
// (setStatus in goToRace, SrcLoader.setLabel in buildScene-pad). Optional.
const BATCH_SIZE_DEFAULT = 8;
async function _precompileSceneChunked(opts){
  opts = opts || {};
  const batchSize = (opts.batchSize|0) || BATCH_SIZE_DEFAULT;
  const labelFn = opts.labelFn;
  if(!renderer||!scene||!camera)return;

  // Native fast-path. compileAsync sinds r152, niet in deze vendor build —
  // maar feature-detect houdt het pad open voor toekomstige upgrade.
  if(typeof renderer.compileAsync==='function'){
    if(window.perfMark)perfMark('precompile:compileAsync:start');
    try{ await renderer.compileAsync(scene,camera); }
    catch(e){ if(window.dbg)dbg.error('scene',e,'compileAsync failed'); }
    if(window.perfMark){perfMark('precompile:compileAsync:end');perfMeasure('build.precompile.compileAsync','precompile:compileAsync:start','precompile:compileAsync:end');}
    return;
  }

  // Chunked synchroon. Verzamel alle meshes via traverse, compileer per
  // batch, yield via rAF tussen batches. Three.js' shader-program cache
  // zorgt dat herhaalde compile-calls op al-gelinkte materials no-op zijn,
  // dus chunking herhaalt geen werk.
  const meshes = [];
  scene.traverse(o => { if(o && o.isMesh) meshes.push(o); });
  const N = Math.max(1, Math.ceil(meshes.length/batchSize));
  if(window.perfMark)perfMark('precompile:chunked:start');
  const _t0 = performance.now();
  const _progBefore=(renderer.info.programs&&renderer.info.programs.length)||0;
  for(let i=0;i<meshes.length;i++){
    try{ renderer.compile(meshes[i],camera); }
    catch(e){ if(window.dbg)dbg.warn('scene','chunked compile mesh failed: '+(e&&e.message||e)); }
    if((i+1)%batchSize===0 || i===meshes.length-1){
      const batchIdx = Math.floor(i/batchSize)+1;
      if(labelFn){ try{ labelFn(batchIdx, N); }catch(_){} }
      // rAF-yield: geeft Chrome de gelegenheid input-events af te handelen
      // en compositor-frame te paint'en (spinner blijft zichtbaar lopen).
      if(typeof requestAnimationFrame==='function'){
        await new Promise(r => requestAnimationFrame(()=>r()));
      }
    }
  }
  if(window.perfMark){perfMark('precompile:chunked:end');perfMeasure('build.precompile.chunked','precompile:chunked:start','precompile:chunked:end');}
  if(window.dbg){
    const _dur=performance.now()-_t0;
    const _progAfter=(renderer.info.programs&&renderer.info.programs.length)||0;
    dbg.markRaceEvent('PRECOMPILE-CHUNKED-DONE',{
      durMs:+_dur.toFixed(2),
      meshes:meshes.length,
      batches:N,
      batchSize,
      progDelta:_progAfter-_progBefore,
      world:activeWorld
    });
  }
}
window._precompileSceneChunked=_precompileSceneChunked;

// Pre-upload alle CanvasTextures + andere niet-shared texture maps naar GPU
// vóór de eerste echte race-frame render. renderer.compile() linkt shaders
// maar laat texture-upload over aan het lazy WebGL-pad: het eerste
// renderer.render() na buildScene stalt dan terwijl alle CanvasTextures één
// voor één naar de GPU geüpload worden. Op zware werelden (Guangzhou: 70+
// CanvasTextures) is dat een 30-100ms hitch op het 1e race-frame.
// _warmTextures itereert alle Materials in de scene, gaat langs _MAT_TEX_SLOTS,
// en roept renderer.initTexture(tex) aan voor elke nog-niet-geuploade
// non-shared texture. _shared() skipt HDRI/PBR-cache textures zodat we
// niet onnodig re-uploaden. Try/catch per texture: initTexture kan throwen
// op een disposed handle of een onbekend texture-type op oudere three-builds.
function _warmTextures(){
  if(!renderer||!scene)return;
  if(typeof renderer.initTexture!=='function')return; // three<r131 (defensief)
  const _t0=performance.now();
  let _count=0;
  // Track al-gewarmde textures via WeakSet — voorkomt dubbele initTexture
  // calls als dezelfde texture in meerdere material-slots gedeeld wordt
  // (bv. _carbonTex, procedural envMap).
  const _seen=new WeakSet();
  scene.traverse(obj=>{
    if(!obj.material)return;
    const mats=Array.isArray(obj.material)?obj.material:[obj.material];
    for(let mi=0;mi<mats.length;mi++){
      const m=mats[mi];if(!m)continue;
      for(let si=0;si<_MAT_TEX_SLOTS.length;si++){
        const t=m[_MAT_TEX_SLOTS[si]];
        if(!t||!t.isTexture||_seen.has(t))continue;
        _seen.add(t);
        try{renderer.initTexture(t);_count++;}
        catch(_){/* disposed/unsupported — skip */}
      }
    }
  });
  // Background + environment textures zijn ook lazily geüpload bij eerste
  // render — pak ze hier mee zodat de skybox ook in het warm-pad zit.
  if(scene.background&&scene.background.isTexture&&!_seen.has(scene.background)){
    try{renderer.initTexture(scene.background);_count++;_seen.add(scene.background);}catch(_){}
  }
  if(scene.environment&&scene.environment.isTexture&&!_seen.has(scene.environment)){
    try{renderer.initTexture(scene.environment);_count++;_seen.add(scene.environment);}catch(_){}
  }
  if(window.dbg){
    dbg.markRaceEvent('WARM-TEXTURES-DONE',{
      durMs:+(performance.now()-_t0).toFixed(2),
      uploaded:_count,
      world:activeWorld
    });
  }
}
window._warmTextures=_warmTextures;
