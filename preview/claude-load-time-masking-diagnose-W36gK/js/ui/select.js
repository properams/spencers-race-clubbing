// js/ui/select.js — non-module script.

'use strict';

// Pre-baked snapshot architectuur (Route 1):
// In plaats van een TWEEDE WebGLRenderer voor een live 3D preview (wat op
// iOS Safari een hard context-budget probleem oplevert) renderen we elke
// auto één keer naar een snapshot canvas via de HOOFD-game renderer en een
// off-screen WebGLRenderTarget. Display in SELECT is dan een goedkope 2D
// drawImage operatie. Eén WebGL-context tijdens de hele app-lifecycle.
let _prevDefId=-1;
let _snapCache={};         // {carId: HTMLCanvasElement} 2D snapshot per auto
let _snapScene=null,_snapCam=null,_snapRT=null;
let _snapPodiumGridTex=null,_snapGlowTex=null;
// Module refs for per-car-accent tuning during bake (D2). Exposed so
// _bakeCarSnapshot can update color BEFORE rendering each car.
let _snapRingMat=null,_snapRimMat=null,_snapRimLight=null,_snapKeyLight=null;
const SNAP_W=640,SNAP_H=360;  // 16:9 snapshot resolutie (~3MB cache totaal)
const _unlockHints=[
  '','','','',
  '🏆 Finish P1',       // 4 Red Bull
  '💜 Fastest Lap',    // 5 Mustang
  '🔢 5 Races',        // 6 Tesla
  '🥉 3 Podiums',      // 7 Audi
  '💰 800 coins',    // 8
  '💰 1200 coins',   // 9
  '💰 1500 coins',   // 10
  '💰 2000 coins',   // 11
];

// Lazy setup van de offscreen bake-scene. Hergebruikt de hoofd-renderer
// (window.renderer) — geen tweede WebGL context. Aangemaakt bij eerste
// bake call, opgeruimd in disposeSnapshotBakery.
function _initSnapshotBakery(){
  if(_snapScene)return true;
  if(!window.renderer)return false;
  _snapScene=new THREE.Scene();
  // MeshPhysicalMaterial.clearcoat op de car-paint heeft een envMap nodig
  // om iets te reflecteren — anders rendert clearcoat als een vlakke laag
  // en zien previews er identiek uit aan de oude MeshStandardMaterial-versie.
  // Hergebruik de procedurele envMap die core/scene.js bouwt voor de race-
  // scene. _sharedAsset-flag zorgt dat disposeSnapshotBakery'm overslaat.
  if(typeof window._buildProceduralEnvMap==='function'){
    const env=window._buildProceduralEnvMap();
    if(env)_snapScene.environment=env;
  }
  _snapCam=new THREE.PerspectiveCamera(32,SNAP_W/SNAP_H,.1,100);
  _snapCam.position.set(4.2,1.55,5.8);_snapCam.lookAt(0,.42,0);
  // Cinematic 3-point lighting (D2 polish — softened to read as
  // 'premium showroom' rather than 'neon-arcade'). Rim-light's
  // colour is now mutated per-car-accent in _bakeCarSnapshot for
  // visual cohesion (red car → warm rim, blue car → cool rim, etc).
  // Key + fill stay neutral so car-paint colour reads accurately.
  _snapKeyLight=new THREE.DirectionalLight(0xfff4e6,2.4);
  _snapKeyLight.position.set(-3,5,5);_snapScene.add(_snapKeyLight);
  var fill=new THREE.DirectionalLight(0x9cb4ff,1.0);
  fill.position.set(4,2,3);_snapScene.add(fill);
  _snapRimLight=new THREE.DirectionalLight(0xffa060,1.8); // neutral-warm default
  _snapRimLight.position.set(0,3,-6);_snapScene.add(_snapRimLight);
  _snapScene.add(new THREE.AmbientLight(0x2a3040,.95));
  _snapScene.fog=new THREE.FogExp2(0x07060c,.055);
  // Showroom-floor: smooth 32-sided platform (was 6-sided hex —
  // reads as 'premium podium' instead of 'gaming hex'), neutral
  // dark-charcoal with subtle metalness for ground reflection.
  var podium=new THREE.Mesh(
    new THREE.CylinderGeometry(3.4,3.55,.16,32),
    new THREE.MeshStandardMaterial({color:0x141519,metalness:.42,roughness:.55,emissive:0x080810,emissiveIntensity:.18})
  );
  podium.position.y=-.08;_snapScene.add(podium);
  // Per-car accent ring — colour mutated in _bakeCarSnapshot to match
  // def.accent. Default neutral-warm so first-paint without a def
  // doesn't blast magenta.
  _snapRingMat=new THREE.MeshBasicMaterial({color:0xffa060,transparent:true,opacity:.85});
  var ring=new THREE.Mesh(new THREE.TorusGeometry(3.36,.022,10,80),_snapRingMat);
  ring.rotation.x=Math.PI/2;ring.position.y=.014;_snapScene.add(ring);
  // Soft circular gradient on the platform top — replaces the
  // grid-lines overlay (read as 'gaming circle') with a 'showroom
  // halo' that catches the rim-light without competing visually.
  _snapPodiumGridTex=_makePodiumGridTexture();
  var floor=new THREE.Mesh(
    new THREE.CircleGeometry(3.30,48),
    new THREE.MeshBasicMaterial({map:_snapPodiumGridTex,transparent:true,opacity:.42,depthWrite:false})
  );
  floor.rotation.x=-Math.PI/2;floor.position.y=.013;_snapScene.add(floor);
  // Soft shadow disc under the platform — grounds the car visually
  // (no more 'floating-on-magenta-additive' look). Per-car-accent
  // tinted in _bakeCarSnapshot for subtle harmony.
  _snapGlowTex=_makeRadialGlowTexture('#1a1822');
  _snapRimMat=new THREE.MeshBasicMaterial({map:_snapGlowTex,transparent:true,opacity:.78,depthWrite:false});
  var shadowDisc=new THREE.Mesh(new THREE.PlaneGeometry(13,13),_snapRimMat);
  shadowDisc.rotation.x=-Math.PI/2;shadowDisc.position.y=-.085;_snapScene.add(shadowDisc);
  _snapRT=new THREE.WebGLRenderTarget(SNAP_W,SNAP_H,{
    minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
    format:THREE.RGBAFormat,depthBuffer:true
  });
  return true;
}

function _makePodiumGridTexture(){
  // Showroom halo (D2 polish) — soft radial gradient replaces the
  // 8×8 grid-lines that read as 'gaming-arcade'. Light catches the
  // platform centre + rim-light from below; the halo gives the
  // floor a subtle glow without competing for visual weight with
  // the car-paint.
  const c=document.createElement('canvas');c.width=256;c.height=256;
  const g=c.getContext('2d');
  const grd=g.createRadialGradient(128,128,16,128,128,128);
  grd.addColorStop(0,'rgba(255,240,220,.55)');
  grd.addColorStop(.45,'rgba(255,200,160,.20)');
  grd.addColorStop(1,'rgba(40,32,48,0)');
  g.fillStyle=grd;g.fillRect(0,0,256,256);
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;
  return t;
}

function _makeRadialGlowTexture(hex){
  const c=document.createElement('canvas');c.width=256;c.height=256;
  const g=c.getContext('2d');
  const grd=g.createRadialGradient(128,128,8,128,128,128);
  grd.addColorStop(0,hex);grd.addColorStop(.35,'rgba(255,45,111,.45)');
  grd.addColorStop(1,'rgba(0,0,0,0)');
  g.fillStyle=grd;g.fillRect(0,0,256,256);
  return new THREE.CanvasTexture(c);
}

// Camera-richting van de bake-camera (genormaliseerd). Hergebruikt door
// _fitCameraToCar zodat alle auto's vanuit dezelfde 3/4-hoek worden
// gerenderd vanaf een vaste afstand — matched _fitCameraToCarLive.
const _CAM_DIR=new THREE.Vector3(4.2,1.75,5.8).normalize();

// Doel-lengte (wereld-units) voor preview-only car normalisatie. Mustang
// L=4.40 → scale 0.955, McLaren P1 L=4.10 → scale 1.024, F1 chassis is
// langer → scale <1. Alleen toegepast op preview-instances, nooit op
// gameplay-cars (die houden hun fysieke afmetingen).
const PREVIEW_TARGET_LEN=4.20;
// Padding rondom de auto in het frame — matched de oude per-car fit (1.90).
const PREVIEW_PADDING=1.90;
// Worst-case verticale halve hoogte na normalisatie (Mustang scaled
// height ≈ 1.24 → halfV 0.62, plus marge voor scaled Y). Conservatief
// gekozen zodat geen enkele auto verticaal uit het frame valt.
const PREVIEW_HALF_V=0.78;

// Schaal een preview-car uniform zodat zijn langste horizontale extent
// gelijk is aan PREVIEW_TARGET_LEN. Alleen aanroepen op preview-only
// instances (gameplay-cars mogen niet geschaald worden — collision
// geometry is in wereld-coördinaten).
function _normalizeCarScale(car){
  if(!car)return;
  car.updateMatrixWorld(true);
  const bbox=new THREE.Box3();let any=false;
  car.traverse(o=>{
    if(o.isMesh&&o.visible!==false&&o.geometry){
      const mb=new THREE.Box3().setFromObject(o);
      if(any)bbox.union(mb);else{bbox.copy(mb);any=true;}
    }
  });
  if(!any)return;
  const sz=bbox.getSize(new THREE.Vector3());
  const carLen=Math.max(sz.x,sz.z);
  if(!(carLen>0.01))return;
  const s=PREVIEW_TARGET_LEN/carLen;
  car.scale.setScalar(s);
  car.updateMatrixWorld(true);
}

// Bereken vaste camera-afstand zodat een genormaliseerde auto
// (PREVIEW_TARGET_LEN × PREVIEW_HALF_V*2 max) met PREVIEW_PADDING air
// rondom in het frame past. Niet auto-afhankelijk — alleen camera-fov
// en aspect. Floor op 7.5 matched legacy gedrag.
function _previewCamDistance(cam){
  const fovRad=(cam.fov||32)*Math.PI/180;
  const aspect=cam.aspect||(16/10);
  const halfH=PREVIEW_TARGET_LEN*0.5;
  const distV=(PREVIEW_HALF_V*PREVIEW_PADDING)/Math.tan(fovRad/2);
  const distH=(halfH*PREVIEW_PADDING)/Math.tan(Math.atan(Math.tan(fovRad/2)*aspect));
  return Math.max(distV,distH,7.5);
}

// Plaats _snapCam zo dat de auto netjes gecentreerd in het frame staat.
// Camera-afstand is een vaste constante (_previewCamDistance) zodat het
// podium voor elke auto op identieke schermgrootte gerenderd wordt — de
// auto zelf wordt eerst genormaliseerd via _normalizeCarScale. Bbox-
// center wordt nog wel uitgerekend zodat de camera de auto centreert,
// ook als zijn pivot niet op (0,0,0) ligt. Setminus visible Mesh nodes
// only — auto-meshes hebben anchor-points die Box3.setFromObject
// opblazen tot factor-2 te grote bbox.
function _fitCameraToCar(car){
  const bbox=new THREE.Box3();
  let any=false;
  car.traverse(o=>{
    if(o.isMesh&&o.visible!==false&&o.geometry){
      const mb=new THREE.Box3().setFromObject(o);
      if(any)bbox.union(mb);else{bbox.copy(mb);any=true;}
    }
  });
  if(!any){bbox.setFromObject(car);}
  const center=new THREE.Vector3();bbox.getCenter(center);
  const dist=_previewCamDistance(_snapCam);
  _snapCam.position.copy(center).addScaledVector(_CAM_DIR,dist);
  // Fixed look-at Y across all cars so the wheel-line sits at the exact
  // same vertical position in every snapshot. 0.55 = typical car mid-body.
  _snapCam.lookAt(center.x,0.55,center.z);
}

// Render één auto naar het snapshot-canvas. Hergebruikt bake-scene via
// add → render → remove + dispose. Schrijft naar _snapCache[def.id].
function _bakeCarSnapshot(def){
  if(!_initSnapshotBakery())return;
  // Hide the live preview car while we render a snapshot — both render
  // paths share _snapScene, and we don't want the live car bleeding
  // into baked garage tiles.
  const liveWasVisible=(_previewCar&&_previewCar.visible);
  if(liveWasVisible)_previewCar.visible=false;
  const car=makeCar(def);
  // Normaliseer visueel formaat: schaal preview-instance zodat de
  // langste horizontale extent gelijk is voor alle auto's (Mustang,
  // F1, supercar zien er ongeveer even groot uit op het podium).
  _normalizeCarScale(car);
  _snapScene.add(car);
  // Per-car-accent tuning (D2 polish) — bias the rim-ring + rim-light
  // + shadow-disc tint to match this car's accent (or body color if no
  // explicit accent), so the showroom feels custom-staged for each
  // vehicle. Falls back to neutral-warm when accent is absent.
  const accent=(typeof def.accent==='number'&&def.accent>0)?def.accent
              :(typeof def.color==='number'&&def.color>0)?def.color
              :0xffa060;
  if(_snapRingMat)_snapRingMat.color.setHex(accent);
  if(_snapRimLight){
    _snapRimLight.color.setHex(accent);
    // Dim the rim slightly when accent is very dark/black (e.g.
    // car id 8 #111111) so we still get a back-light.
    const luma=(((accent>>16)&255)*0.299+((accent>>8)&255)*0.587+(accent&255)*0.114)/255;
    _snapRimLight.intensity=luma<.18?2.4:1.8;
  }
  if(_snapRimMat){
    // Shadow-disc tint: subtle accent-warmed grounding (not full
    // accent — too saturated under the car). Keeps neutral grey
    // base + small hint of car colour.
    _snapRimMat.color.setRGB(
      0.10+((accent>>16)&255)/255*0.18,
      0.09+((accent>>8)&255)/255*0.18,
      0.13+(accent&255)/255*0.18
    );
  }
  // Fit camera op deze specifieke auto (bounding-box-aware framing).
  _fitCameraToCar(car);
  // Render naar off-screen target zodat de hoofdcanvas niet wordt verstoord.
  const prevTarget=window.renderer.getRenderTarget();
  window.renderer.setRenderTarget(_snapRT);
  window.renderer.render(_snapScene,_snapCam);
  window.renderer.setRenderTarget(prevTarget);
  // Read pixels back en zet op een 2D snapshot canvas. WebGL is bottom-up,
  // dus tijdens copy doen we een rij-flip op de Y-as.
  const pixels=new Uint8Array(SNAP_W*SNAP_H*4);
  window.renderer.readRenderTargetPixels(_snapRT,0,0,SNAP_W,SNAP_H,pixels);
  let snap=_snapCache[def.id];
  if(!snap){
    snap=document.createElement('canvas');
    snap.width=SNAP_W;snap.height=SNAP_H;
    _snapCache[def.id]=snap;
  }
  const ctx=snap.getContext('2d');
  const imgData=ctx.createImageData(SNAP_W,SNAP_H);
  // Y-flip: rij i van pixels (vanaf onderkant) → rij (H-1-i) van imgData.
  for(let y=0;y<SNAP_H;y++){
    const srcStart=(SNAP_H-1-y)*SNAP_W*4;
    imgData.data.set(pixels.subarray(srcStart,srcStart+SNAP_W*4),y*SNAP_W*4);
  }
  ctx.putImageData(imgData,0,0);
  // Cleanup: car uit scene + dispose geometries/materials.
  _snapScene.remove(car);
  car.traverse(o=>{
    if(o.geometry)o.geometry.dispose();
    if(o.material){
      if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());
      else o.material.dispose();
    }
  });
  // Restore live car visibility — the bake camera/light tweaks we did
  // above (rim, accent ring) stay applied which is fine: they match
  // the just-baked car which IS the currently-selected live preview
  // in most cases.
  if(liveWasVisible)_previewCar.visible=true;
}

// Bake alle auto's vooraf zodat selecteren instant is. Aangeroepen vanuit
// buildCarSelectUI. Voorheen synchronous loop (~200ms voor 12 auto's op
// slow desktop) — main thread block tijdens screen-transitie. Nu progressief:
// eerste 3 cars sync (zodat de garage-lijst direct iets toont), de rest in
// chunks van max 8ms per frame via rAF. Idempotent dankzij _snapCache[id].
let _bakeProgressiveActive=false;
function bakeAllCarSnapshots(){
  if(!window.renderer||!window.CAR_DEFS)return;
  if(!_initSnapshotBakery())return;
  // Sync seed: bake de eerste 3 niet-gecachte auto's direct zodat de
  // garage-lijst en de eerste preview meteen iets te tonen hebben.
  let seedCount=0;
  let i=0;
  while(i<CAR_DEFS.length&&seedCount<3){
    const def=CAR_DEFS[i++];
    if(_snapCache[def.id])continue;
    _bakeCarSnapshot(def);
    seedCount++;
  }
  if(i>=CAR_DEFS.length)return; // alles al gebakken/gecached
  if(_bakeProgressiveActive)return;
  _bakeProgressiveActive=true;
  const tick=()=>{
    // Bail-out: user navigated away (TITLE/COUNTDOWN/RACE). De disposal
    // van de bake-scene gebeurt in navigation.js; re-entry op SELECT zal
    // alsnog opnieuw bouwen via _initSnapshotBakery.
    if(typeof gameState!=='undefined'&&gameState!=='SELECT'){
      _bakeProgressiveActive=false;
      return;
    }
    const t0=performance.now();
    while(i<CAR_DEFS.length){
      const def=CAR_DEFS[i++];
      if(_snapCache[def.id])continue;
      _bakeCarSnapshot(def);
      if(performance.now()-t0>=8)break; // 8ms frame budget
    }
    if(i<CAR_DEFS.length){
      requestAnimationFrame(tick);
    }else{
      _bakeProgressiveActive=false;
      if(window.Breadcrumb)Breadcrumb.push('bakeAllCarSnapshots.done',{n:CAR_DEFS.length});
    }
  };
  requestAnimationFrame(tick);
}

// Display de cached snapshot van defId op de visible preview canvas via
// 2D drawImage. Behoudt aspect ratio met letterbox-fit.
function _displayCarSnapshot(defId){
  const cvs=document.getElementById('carPreviewCvs');
  if(!cvs)return;
  const snap=_snapCache[defId];
  // Zorg dat canvas backing-store de visible size matched (DPR-aware).
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const cw=Math.max(2,(cvs.clientWidth||SNAP_W)*dpr|0);
  const ch=Math.max(2,(cvs.clientHeight||SNAP_H)*dpr|0);
  if(cvs.width!==cw||cvs.height!==ch){cvs.width=cw;cvs.height=ch;}
  const ctx=cvs.getContext('2d');
  ctx.clearRect(0,0,cw,ch);
  if(!snap){
    // Fallback als bake nog niet gedaan is — laat de canvas zien als
    // dark gradient zodat het niet zwart-leeg is.
    return;
  }
  // Contain-fit: hele snapshot zichtbaar binnen preview-canvas met
  // letterbox-padding. Cover-fit veroorzaakte verticale zoom-crop in
  // portrait phone (canvas-aspect ~2.1:1 vs snapshot 16:9 = 1.78:1) —
  // zichtbaar als "alleen rood vlak en hoekje van de auto".
  const sa=SNAP_W/SNAP_H,da=cw/ch;
  let dx=0,dy=0,dw=cw,dh=ch;
  if(da>sa){dw=ch*sa;dx=(cw-dw)/2;}else{dh=cw/sa;dy=(ch-dh)/2;}
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(snap,dx,dy,dw,dh);
}

// Resize observer — herteken de snapshot wanneer de preview-canvas van
// grootte verandert (orientation flip, window resize).
function _initSnapshotResize(){
  const cvs=document.getElementById('carPreviewCvs');
  if(!cvs||cvs.dataset.snapResizeWired==='1')return;
  cvs.dataset.snapResizeWired='1';
  if(typeof ResizeObserver!=='undefined'){
    new ResizeObserver(()=>{if(_prevDefId>=0)_displayCarSnapshot(_prevDefId);}).observe(cvs);
  }else{
    window.addEventListener('resize',()=>{if(_prevDefId>=0)_displayCarSnapshot(_prevDefId);});
  }
}

// Cleanup bij screen-transitie naar TITLE/RACE. Disposed render target +
// scene-resources zodat ze niet idle GPU-memory innemen. Cache blijft
// staan voor snel terugkeren naar SELECT.
function disposeSnapshotBakery(){
  if(_snapScene){
    _snapScene.traverse(o=>{
      if(o.geometry)o.geometry.dispose();
      if(o.material){
        if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());
        else o.material.dispose();
      }
    });
    _snapScene=null;
  }
  if(_snapPodiumGridTex){_snapPodiumGridTex.dispose();_snapPodiumGridTex=null;}
  if(_snapGlowTex){_snapGlowTex.dispose();_snapGlowTex=null;}
  if(_snapRT){_snapRT.dispose();_snapRT=null;}
  _snapCam=null;
  // D2 module-level material refs — null along with scene so a stale
  // re-entrant _bakeCarSnapshot can't mutate .color on disposed mats.
  _snapRingMat=null;_snapRimMat=null;
  _snapRimLight=null;_snapKeyLight=null;
  // _snapCache blijft — 2D canvases nemen alleen JS heap memory in, geen
  // GPU memory. Snel weergave bij volgende SELECT-bezoek zonder re-bake.
}
window.disposeSnapshotBakery=disposeSnapshotBakery;

// ──────────────────────────────────────────────────────────────────────
// LIVE 3D PREVIEW (≥900px viewport — tablet landscape + desktop).
//
// Reuses the persistent _snapScene (podium/lights/floor) and adds a
// long-lived _previewCar mesh that auto-rotates and responds to drag.
// Renders via a DEDICATED lightweight THREE.WebGLRenderer attached to
// #carPreviewLiveCvs so the main game renderer's canvas stays untouched.
// Mobile portrait (<900px) keeps using baked snapshots via _displayCarSnapshot
// to respect iOS WebGL context limits — only ONE extra context max.
// ──────────────────────────────────────────────────────────────────────
const LIVE_PREVIEW_MIN_W=900;
let _liveRenderer=null,_liveCam=null,_liveCanvas=null;
let _previewCar=null,_previewCarDef=null;
let _previewYaw=0,_previewYawTarget=0;
let _previewLastT=0,_previewIdleSince=0,_previewActive=false;
let _previewRAF=0;
let _liveDragWired=false;
let _liveResizeWired=false;
let _userHasRotated=false; // hides DRAG TO ROTATE hint after first drag
// Sticky-fail flag: a TypeError 'precision' from a refused second WebGL
// context flooded the console because resize callbacks kept re-trying. Once
// the browser has refused a second context we stop attempting for the rest
// of this session and fall back to baked snapshots. buildCarSelectUI()
// resets this flag on screen-entry so a transient failure on one visit
// doesn't permanently lock the user into snapshot-mode — capped by
// _liveRendererFailCount so a truly constrained device doesn't spam the
// error overlay every visit.
let _liveRendererFailed=false;
let _liveRendererFailCount=0;
const LIVE_RENDERER_MAX_FAILS=2;

function _isLivePreviewSupported(){
  // Skip on portrait phones: the carousel handles that path, and they
  // already render via _displayCarSnapshot (legacy).
  if(typeof window==='undefined')return false;
  // Need WebGL + a place to mount it.
  if(!window.THREE)return false;
  // Browser refused a second WebGL context earlier this session — don't
  // keep retrying, the error spammed the in-game error overlay.
  if(_liveRendererFailed)return false;
  const cvs=document.getElementById('carPreviewLiveCvs');
  if(!cvs)return false;
  // SELECT screen must be visible — otherwise resize listeners would
  // happily re-create a WebGL context after teardown during the race.
  // Belt-and-braces: also gate on gameState. There is a brief window in
  // goToRace() between disposeLivePreview() and sSelect.classList.add
  // ('hidden') where a fired resize-event could re-init the renderer
  // milliseconds before the race starts (which then refuses the second
  // context once the main race renderer ramps up).
  if(window.gameState && window.gameState!=='SELECT')return false;
  const sel=document.getElementById('sSelect');
  if(!sel||sel.classList.contains('hidden'))return false;
  return (window.innerWidth||0)>=LIVE_PREVIEW_MIN_W;
}

function _initLivePreview(){
  if(_liveRenderer)return true;
  if(_liveRendererFailed)return false;
  if(!_isLivePreviewSupported())return false;
  if(!_initSnapshotBakery())return false; // scene/lights/podium reused
  _liveCanvas=document.getElementById('carPreviewLiveCvs');
  if(!_liveCanvas)return false;
  try{
    _liveRenderer=new THREE.WebGLRenderer({
      canvas:_liveCanvas,
      antialias:true,
      alpha:true,
      powerPreference:'high-performance'
    });
  }catch(e){
    // First-and-only log of this failure per attempt: buildCarSelectUI()
    // may reset _liveRendererFailed on a fresh visit, but after
    // LIVE_RENDERER_MAX_FAILS attempts in one session we stop retrying
    // entirely so a constrained device never spams the error overlay.
    _liveRendererFailCount++;
    if(window.dbg)dbg.error('select',e,'live preview renderer create failed — falling back to baked snapshots ('+_liveRendererFailCount+'/'+LIVE_RENDERER_MAX_FAILS+')');
    _liveRenderer=null;
    _liveRendererFailed=true;
    return false;
  }
  // Match the renderer pipeline to the main game renderer for visual
  // consistency (clearcoat car paint reads the same on both).
  if(window.renderer){
    try{
      if('outputColorSpace' in window.renderer)
        _liveRenderer.outputColorSpace=window.renderer.outputColorSpace;
      if('toneMapping' in window.renderer)
        _liveRenderer.toneMapping=window.renderer.toneMapping;
      if('toneMappingExposure' in window.renderer)
        _liveRenderer.toneMappingExposure=window.renderer.toneMappingExposure;
    }catch(_){}
  }
  _liveRenderer.setClearColor(0x000000,0);
  const dpr=Math.min(window.devicePixelRatio||1,1.75);
  _liveRenderer.setPixelRatio(dpr);
  // Separate camera so the bake camera (_snapCam) can still be re-fitted
  // per bake call without disturbing the live framing.
  _liveCam=new THREE.PerspectiveCamera(32,16/10,0.1,100);
  _liveCam.position.set(4.2,1.55,5.8);
  _liveCam.lookAt(0,0.42,0);
  _resizeLiveRenderer();
  _initLiveResize();
  _initLiveDrag();
  return true;
}

function _resizeLiveRenderer(){
  if(!_liveRenderer||!_liveCanvas)return;
  const w=Math.max(2,(_liveCanvas.clientWidth|0));
  const h=Math.max(2,(_liveCanvas.clientHeight|0));
  _liveRenderer.setSize(w,h,false);
  if(_liveCam){
    _liveCam.aspect=w/h;
    _liveCam.updateProjectionMatrix();
  }
}
function _initLiveResize(){
  if(_liveResizeWired)return;_liveResizeWired=true;
  if(typeof ResizeObserver!=='undefined'&&_liveCanvas){
    // Re-fit camera na resize: aspect-ratio verandering beïnvloedt
    // _previewCamDistance, en bij de allereerste render kan de canvas
    // nog niet z'n definitieve afmeting hebben (CSS layout). Re-fitten
    // garandeert dat de auto correct geframed staat zodra het canvas
    // z'n echte dimensies heeft.
    new ResizeObserver(()=>{
      _resizeLiveRenderer();
      if(_previewCar)_fitCameraToCarLive(_previewCar);
    }).observe(_liveCanvas);
  }
  window.addEventListener('resize',()=>{
    // Cross-breakpoint flip: if we drop below 900px hide the live canvas
    // and fall back to baked snapshots; if we cross up, init + start.
    _syncLiveModeWithViewport();
    _resizeLiveRenderer();
    if(_previewCar)_fitCameraToCarLive(_previewCar);
  });
}

// Add/remove .liveMode on .prevCanvasWrap based on viewport. Start or
// stop the RAF loop accordingly. Called from buildCarSelectUI and on
// window resize.
function _syncLiveModeWithViewport(){
  const wrap=document.querySelector('#sSelect .prevCanvasWrap');
  if(!wrap)return;
  const wantLive=_isLivePreviewSupported();
  if(wantLive){
    // .liveMode moet AAN staan voor _initLivePreview() z'n eerste
    // _resizeLiveRenderer() doet — anders is clientWidth/Height 0
    // (canvas was display:none of niet-gestyleerd), wordt de renderer
    // 2×2 gesized, aspect=1, en framet _fitCameraToCarLive de eerste
    // auto te klein. Track of we 'm zelf hebben toegevoegd zodat we
    // 'm kunnen rollbacken bij init-failure.
    const liveModeAdded=!wrap.classList.contains('liveMode');
    if(liveModeAdded)wrap.classList.add('liveMode');
    if(!_liveRenderer&&!_initLivePreview()){
      if(liveModeAdded)wrap.classList.remove('liveMode');
      return;
    }
    // Defensief: forceer een resize-check ná het toevoegen van .liveMode
    // voor het geval _initLivePreview hierboven was overgeslagen (al
    // geïnitialiseerd) — dan heeft _resizeLiveRenderer nog niet gedraaid
    // sinds de class-toevoeging.
    _resizeLiveRenderer();
    if(_previewCarDef){
      // Re-attach the car if it was disposed by a previous teardown.
      if(!_previewCar)_setPreviewCar(_previewCarDef);
      else _fitCameraToCarLive(_previewCar);
    }else if(typeof selCarId==='number'){
      const def=CAR_DEFS&&CAR_DEFS.find(d=>d.id===selCarId);
      if(def)_setPreviewCar(def);
    }
    _startPreviewLoop();
  }else{
    wrap.classList.remove('liveMode');
    _stopPreviewLoop();
    // Make sure the snapshot canvas reflects current selection so the
    // user sees something the moment we shrink below the breakpoint.
    if(_prevDefId>=0)_displayCarSnapshot(_prevDefId);
  }
}

// Build a fresh _previewCar and attach to _snapScene. Disposes the
// previous one. Mutates the rim-light / accent-ring colour to match
// the def (same recipe as _bakeCarSnapshot so live and snapshots look
// staged identically).
function _setPreviewCar(def){
  if(!_snapScene||!def)return;
  if(_previewCar){
    _snapScene.remove(_previewCar);
    _previewCar.traverse(o=>{
      if(o.geometry)o.geometry.dispose();
      if(o.material){
        if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());
        else o.material.dispose();
      }
    });
    _previewCar=null;
  }
  const car=makeCar(def);
  // Normaliseer visueel formaat — dezelfde recipe als _bakeCarSnapshot
  // zodat live en baked previews 1:1 matchen.
  _normalizeCarScale(car);
  _snapScene.add(car);
  _previewCar=car;
  _previewCarDef=def;
  // Per-car accent tuning — same recipe as bake.
  const accent=(typeof def.accent==='number'&&def.accent>0)?def.accent
              :(typeof def.color==='number'&&def.color>0)?def.color
              :0xffa060;
  if(_snapRingMat)_snapRingMat.color.setHex(accent);
  if(_snapRimLight){
    _snapRimLight.color.setHex(accent);
    const luma=(((accent>>16)&255)*0.299+((accent>>8)&255)*0.587+(accent&255)*0.114)/255;
    _snapRimLight.intensity=luma<.18?2.4:1.8;
  }
  if(_snapRimMat){
    _snapRimMat.color.setRGB(
      0.10+((accent>>16)&255)/255*0.18,
      0.09+((accent>>8)&255)/255*0.18,
      0.13+(accent&255)/255*0.18
    );
  }
  // Fit the live camera to this car (uses the bounding-box-aware fit
  // helper but writes to _liveCam instead of _snapCam).
  _fitCameraToCarLive(car);
  // Reset rotation state so a fresh car starts at canonical 3/4 view.
  // Pre-arm the idle timer 600ms in the past so auto-rotate kicks in
  // shortly after the car loads instead of after the full grace window.
  _previewYaw=0;_previewYawTarget=0;
  _previewIdleSince=performance.now()-600;
}

// _fitCameraToCar mirror that writes to _liveCam.
function _fitCameraToCarLive(car){
  if(!_liveCam||!car)return;
  car.updateMatrixWorld(true);
  // Visible-mesh-only bbox: anchor/pivot Object3Ds (boost mounts, exhaust
  // pivots) inflate setFromObject by ~2x. We hebben de bbox-center nog
  // nodig om de auto te centreren ondanks pivot-offset, maar de afstand
  // is een vaste constante (zie _previewCamDistance) zodat het podium
  // visueel even groot blijft voor elke auto.
  const box=new THREE.Box3();let any=false;
  car.traverse(o=>{
    if(o.isMesh&&o.visible!==false&&o.geometry){
      const mb=new THREE.Box3().setFromObject(o);
      if(any)box.union(mb);else{box.copy(mb);any=true;}
    }
  });
  if(!any)box.setFromObject(car);
  const center=box.getCenter(new THREE.Vector3());
  const dist=_previewCamDistance(_liveCam);
  _liveCam.position.copy(center).addScaledVector(_CAM_DIR,dist);
  _liveCam.lookAt(center.x,0.55,center.z);
}

function _startPreviewLoop(){
  if(_previewActive)return;
  if(!_liveRenderer&&!_initLivePreview())return;
  _previewActive=true;
  _previewLastT=performance.now();
  const loop=(t)=>{
    if(!_previewActive){_previewRAF=0;return;}
    _previewRAF=requestAnimationFrame(loop);
    const dt=Math.min(64,t-_previewLastT)/1000;
    _previewLastT=t;
    if(_previewCar){
      // Auto-rotate after 1.2s of user-idle. ~14s per full revolution —
      // a relaxed showroom turntable; previous 7s felt rushed.
      const idleSec=(t-_previewIdleSince)/1000;
      if(idleSec>1.2&&!_userHasRotated_isDragging()){
        _previewYawTarget+=dt*(Math.PI*2/14);
      }
      // Critically-damped easing toward target — feels weighted.
      _previewYaw+=(_previewYawTarget-_previewYaw)*Math.min(1,dt*8);
      _previewCar.rotation.y=_previewYaw;
    }
    if(_liveRenderer&&_liveCam&&_snapScene){
      _liveRenderer.render(_snapScene,_liveCam);
    }
  };
  _previewRAF=requestAnimationFrame(loop);
}

function _stopPreviewLoop(){
  _previewActive=false;
  if(_previewRAF){cancelAnimationFrame(_previewRAF);_previewRAF=0;}
}

let _liveDragState={active:false,id:-1,lastX:0,lastY:0,vel:0};
function _userHasRotated_isDragging(){return _liveDragState.active;}

function _initLiveDrag(){
  if(_liveDragWired)return;
  const wrap=document.querySelector('#sSelect .prevCanvasWrap');
  if(!wrap)return;
  _liveDragWired=true;
  const PX_PER_RAD=180; // ~180px drag = π radians (half revolution)
  function down(e){
    if(!wrap.classList.contains('liveMode'))return;
    if(!e.isPrimary)return;
    _liveDragState.active=true;
    _liveDragState.id=e.pointerId;
    _liveDragState.lastX=e.clientX;
    _liveDragState.lastY=e.clientY;
    wrap.classList.add('dragging');
    try{wrap.setPointerCapture(e.pointerId);}catch(_){}
  }
  function move(e){
    if(!_liveDragState.active||e.pointerId!==_liveDragState.id)return;
    const dx=e.clientX-_liveDragState.lastX;
    _liveDragState.lastX=e.clientX;
    _liveDragState.lastY=e.clientY;
    _previewYawTarget+=dx/PX_PER_RAD;
    _previewIdleSince=performance.now();
    if(!_userHasRotated){
      _userHasRotated=true;
      wrap.classList.add('userRotated');
    }
  }
  function up(e){
    if(!_liveDragState.active||e.pointerId!==_liveDragState.id)return;
    _liveDragState.active=false;_liveDragState.id=-1;
    wrap.classList.remove('dragging');
    _previewIdleSince=performance.now(); // re-arm idle timer
  }
  wrap.addEventListener('pointerdown',down);
  wrap.addEventListener('pointermove',move);
  wrap.addEventListener('pointerup',up);
  wrap.addEventListener('pointercancel',up);
  wrap.addEventListener('lostpointercapture',()=>{
    _liveDragState.active=false;_liveDragState.id=-1;
    wrap.classList.remove('dragging');
  });
}

function disposeLivePreview(){
  _stopPreviewLoop();
  if(_previewCar){
    if(_snapScene)_snapScene.remove(_previewCar);
    _previewCar.traverse(o=>{
      if(o.geometry)o.geometry.dispose();
      if(o.material){
        if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());
        else o.material.dispose();
      }
    });
    _previewCar=null;_previewCarDef=null;
  }
  if(_liveRenderer){
    try{_liveRenderer.dispose();}catch(_){}
    // Note: forceContextLoss helps free the GL context on iOS.
    try{
      const ext=_liveRenderer.getContext().getExtension('WEBGL_lose_context');
      if(ext)ext.loseContext();
    }catch(_){}
    _liveRenderer=null;
  }
  _liveCam=null;
  const wrap=document.querySelector('#sSelect .prevCanvasWrap');
  if(wrap)wrap.classList.remove('liveMode','dragging','userRotated');
  _userHasRotated=false;
}
window.disposeLivePreview=disposeLivePreview;

// Format a lap time as M:SS.t (e.g. 1:39.8).
function _fmtLapTime(t){
  if(!isFinite(t)||t<=0)return '—';
  const m=Math.floor(t/60),s=t-m*60;
  return m+':'+(s<10?'0':'')+s.toFixed(1);
}

// ── World-selector card decorations ────────────────────────────────────
// Adds a best-lap pill ("★ 1:23.4" / "NEW") and a ▶ go-pill to each
// .worldBigCard. Runs idempotently on every selector show so a
// previously-NEW tile updates after the player races it.
let _worldTilesWired = false;
// Light Edition code-names — short uppercase tag used in the top-left
// eyebrow on each card ("◇ 01 · COSMIC").
const _WORLD_CODE_NAMES = {
  space:'COSMIC',deepsea:'AQUA',candy:'CANDY',
  volcano:'MAGMA',arctic:'TUNDRA',
  sandstorm:'DESERT',pier47:'HARBOR',
  guangzhou:'RAIN'
};
function _initWorldSelectorTiles(){
  if(typeof window === 'undefined') return;
  const cards = document.querySelectorAll('.worldBigCard[data-world]');
  if(!cards.length) return;
  const recs = window._lapRecords || {};
  const diff = (typeof difficulty !== 'undefined' ? difficulty : 0) | 0;
  cards.forEach((card, idx) => {
    const world = card.dataset.world;
    if(!world) return;
    const info = card.querySelector('.worldCardInfo');
    if(!info) return;
    // Eyebrow: ◇ 01 · COSMIC — top-left of card. Sits over the swatch.
    let numEl = card.querySelector('.worldCardNum');
    if(!numEl){
      numEl = document.createElement('div');
      numEl.className = 'worldCardNum';
      card.appendChild(numEl);
    }
    const code = _WORLD_CODE_NAMES[world] || world.toUpperCase();
    const numStr = (idx+1).toString().padStart(2,'0');
    numEl.textContent = '◇ ' + numStr + ' · ' + code;
    // Best-lap time below the world name, in accent color. Goes into the
    // info bar so it flows after .worldCardName. Idempotent.
    let timeEl = info.querySelector('.worldCardTime');
    if(!timeEl){
      timeEl = document.createElement('div');
      timeEl.className = 'worldCardTime';
      info.appendChild(timeEl);
    }
    // Dots = ◆◆◆ / ◆◆◇ / ◆◇◇ / ◇◇◇ — best-of-three difficulties.
    let dots = card.querySelector('.worldCardDots');
    if(!dots){
      dots = document.createElement('div');
      dots.className = 'worldCardDots';
      card.appendChild(dots);
    }
    // Lock overlay (kept; toggled per-show).
    let lockOv = card.querySelector('.worldCardLocked');
    if(!lockOv){
      lockOv = document.createElement('div');
      lockOv.className = 'worldCardLocked';
      lockOv.innerHTML = '<span class="wclIcon">🔒</span><span class="wclHint"></span>';
      card.appendChild(lockOv);
    }
    const rec = recs[world + '_' + diff];
    if(rec && rec.time){
      timeEl.textContent = _fmtLapTime(rec.time);
      timeEl.classList.remove('isNew');
    } else {
      timeEl.textContent = 'NEW';
      timeEl.classList.add('isNew');
    }
    const unlocked = !window._worldsUnlocked || window._worldsUnlocked.has(world);
    if(unlocked){
      card.classList.remove('isLocked');
      lockOv.style.display = 'none';
      const sBest = (typeof window.getWorldStars==='function') ? window.getWorldStars(world) : 0;
      dots.textContent = '◆'.repeat(sBest) + '◇'.repeat(3 - sBest);
      dots.style.display = '';
    } else {
      card.classList.add('isLocked');
      lockOv.style.display = '';
      const hint = (typeof window.getWorldUnlockHint==='function')
        ? window.getWorldUnlockHint(world) : 'Locked';
      const hintEl = lockOv.querySelector('.wclHint');
      if(hintEl) hintEl.textContent = hint;
      dots.style.display = 'none';
    }
  });
  _worldTilesWired = true;
  _updateWorldSelFooter();
}

// Footer + Enter-CTA renderer. Reads window._level / _coins (already
// populated by save.js + career.js) and the currently-selected card to
// build "SPECTRUM LV X ◆ <coins>" + "◇ Enter <Worldname>".
const _WORLD_DISPLAY_NAMES = {
  space:'Cosmic',deepsea:'Deep Sea',candy:'Sugar Rush',
  volcano:'Volcano',arctic:'Arctic',
  sandstorm:'Sandstorm',pier47:'Pier 47',
  guangzhou:'Guangzhou'
};
function _updateWorldSelFooter(){
  if(typeof document === 'undefined') return;
  const lvEl = document.getElementById('wsfLevel');
  const coinsEl = document.getElementById('wsfCoins');
  if(lvEl) lvEl.textContent = (window._level|0) || 1;
  if(coinsEl) coinsEl.textContent = ((window._coins|0)|0).toLocaleString('en-US');
  // Selected world drives the Enter-CTA label + accent colour. The CTA
  // inherits --world-accent from the selected card via JS (the CTA isn't
  // a descendant of the card, so the inherit chain needs help).
  const cta = document.getElementById('worldSelEnter');
  if(!cta) return;
  const sel = document.querySelector('#sWorld .worldBigCard.wBigSel[data-world]');
  const world = sel ? sel.dataset.world : null;
  const nameEl = document.getElementById('wseWorldName');
  if(world){
    if(nameEl) nameEl.textContent = _WORLD_DISPLAY_NAMES[world] || world;
    const cs = getComputedStyle(sel);
    const acc = cs.getPropertyValue('--world-accent').trim();
    const glow = cs.getPropertyValue('--world-glow').trim();
    if(acc) cta.style.setProperty('--world-accent', acc);
    if(glow) cta.style.setProperty('--world-glow', glow);
    cta.disabled = false;
  } else {
    if(nameEl) nameEl.textContent = 'World';
    cta.style.removeProperty('--world-accent');
    cta.style.removeProperty('--world-glow');
    cta.disabled = true;
  }
}
if(typeof window !== 'undefined') window._updateWorldSelFooter = _updateWorldSelFooter;
if(typeof window !== 'undefined') window._initWorldSelectorTiles = _initWorldSelectorTiles;

// Render the RIVAL segment based on _lapRecords[world_difficulty].
// Compares to the player's bestLapTime if any. Falls back to "set the
// first record" prompt when no recorded time exists.
function _renderRival(){
  const carEl=document.getElementById('rivalCar');
  const timeEl=document.getElementById('rivalTime');
  if(!carEl||!timeEl)return;
  const recs=window._lapRecords||{};
  const key=activeWorld+'_'+(difficulty|0);
  const r=recs[key];
  if(!r||!isFinite(r.time)){
    carEl.textContent='— set the first record —';
    carEl.style.color='#6e5a9a';
    timeEl.textContent='';
  }else{
    carEl.textContent=r.brand+' '+r.name;
    carEl.style.color='#c9b9ff';
    const pb=window._savedBL;
    if(isFinite(pb)&&pb>0){
      const dt=pb-r.time;
      if(dt>0)timeEl.textContent=_fmtLapTime(r.time)+' — beat by '+dt.toFixed(1)+'s';
      else if(dt<0)timeEl.textContent=_fmtLapTime(r.time)+' — you lead by '+(-dt).toFixed(1)+'s';
      else timeEl.textContent=_fmtLapTime(r.time);
    }else{
      timeEl.textContent=_fmtLapTime(r.time);
    }
  }
  // Nemesis preview — highest-aggr AI personality among the field.
  // DOM structure lives in index.html (.rivalNemesis inside .rivalSeg);
  // styling lives in css/select.css. Here we just fill text + toggle.
  const nemEl = document.getElementById('rivalNemesis');
  if(nemEl && typeof _aiPersonality !== 'undefined'){
    let bestIdx = -1, bestAggr = -1;
    for(let i=0;i<_aiPersonality.length;i++){
      if(i===selCarId)continue;
      const p = _aiPersonality[i];
      if(p && p.aggr > bestAggr){ bestAggr = p.aggr; bestIdx = i; }
    }
    const p = bestIdx>=0 ? _aiPersonality[bestIdx] : null;
    if(p){
      const nameEl = document.getElementById('rivalNemesisName');
      const aggrEl = document.getElementById('rivalNemesisAggr');
      if(nameEl) nameEl.textContent = (p.emoji||'')+' '+(p.name||'').toUpperCase();
      if(aggrEl) aggrEl.textContent = 'AGGR '+(p.aggr*100|0)+'%';
      nemEl.hidden = false;
    }else{
      nemEl.hidden = true;
    }
  }
}

function _updateSelectSummary(){
  const dNames=['easy','normal','hard'];
  const el=document.getElementById('lapSummary');
  if(el)el.textContent=_selectedLaps+' lap'+(+_selectedLaps>1?'s':'')+' · '+dNames[difficulty];
}

function _selectPreviewCar(defId){
  const switching=(defId!==_prevDefId);
  selCarId=defId;_prevDefId=defId;
  const def=CAR_DEFS.find(d=>d.id===defId);if(!def)return;
  if(window.Audio&&window.Audio.preloadAll)window.Audio.preloadAll(def.type);
  // Short rev burst per car-type when actually switching (skip on initial
  // entry where _prevDefId starts at -1 → first match still counts as a
  // switch, but at that point audioCtx may not exist yet so the rev is a
  // silent no-op anyway).
  if(switching&&window.Audio&&window.Audio.playEngineRev){
    window.Audio.playEngineRev(def.type);
  }
  // Brand line + model + specs
  const b=document.getElementById('prevBrand');if(b)b.textContent=def.brand;
  const n=document.getElementById('prevName');if(n)n.textContent=def.name;
  const sp=document.getElementById('prevSpecs');
  const tlabel=def.type==='f1'?'F1':def.type==='muscle'?'CLASSIC':def.type==='electric'?'ELECTRIC':def.type==='rally'?'RALLY':'SUPER';
  const hp=Math.round(def.topSpd*820);
  const tk=Math.round(def.topSpd*255);
  if(sp) sp.textContent=tlabel+' · '+hp+' hp · '+tk+' km/h';
  // Light Edition SPECTRUM panel (right column): big HP + KM/H pair.
  // Soft-fail when the panel is absent (mobile layout has no #specHpVal).
  const hpEl=document.getElementById('specHpVal');if(hpEl) hpEl.textContent=hp;
  const kmhEl=document.getElementById('specKmhVal');if(kmhEl) kmhEl.textContent=tk;
  // Snapshot display — als de bake nog niet is gedaan, bake nu just-in-time.
  if(!_snapCache[defId]){
    _bakeCarSnapshot(def);
  }
  _displayCarSnapshot(defId);
  // Live preview (≥900px): swap the persistent 3D car so the dragable
  // model matches the new selection. Skip entirely if init failed —
  // we don't want to mount a car nobody renders.
  if(_isLivePreviewSupported()){
    if(!_liveRenderer)_initLivePreview();
    if(_liveRenderer)_setPreviewCar(def);
  }
  // 4-stat card stack: SPEED / ACCEL / HANDLING / NITRO with a ghost
  // bar at the catalog max behind the current car's bar, and a rank-
  // coloured numeric. Animated via CSS transition on .statCardFill.
  _renderStatCards(def);
  _renderAttributesPanel(def);
  _renderRival();
  // D4 wiring — toggle the disabled-state CSS hooks on the desktop +
  // mobile START RACE buttons based on the current selection's
  // unlock + affordable state. Locked-and-not-affordable cars
  // can't be raced so the CTA visually communicates that.
  const state=getCarSelectionState(def);
  const canRace=state.unlocked||(state.affordable&&state.price>0);
  const btnDesk=document.getElementById('btnRace');
  const btnMob=document.getElementById('selMRace');
  [btnDesk,btnMob].forEach(b=>{
    if(!b)return;
    if(canRace){b.removeAttribute('aria-disabled');b.classList.remove('disabled');}
    else{b.setAttribute('aria-disabled','true');b.classList.add('disabled');}
  });
}

async function rebuildWorld(newWorld){
  if(newWorld===activeWorld)return;
  if(window.perfMark)perfMark('transition:start');
  if(window.Breadcrumb)Breadcrumb.push('rebuildWorld',{from:activeWorld,to:newWorld});
  // Fase 2D: tier re-evaluatie op wereld-switch. Een eerdere race op een
  // zware wereld (Guangzhou) kan de tier hebben verlaagd; bij overstappen
  // naar een lichte wereld (Candy/Arctic) is dat onnodig restrictief. De
  // helper re-runt _pickInitialTier op basis van hardware-detectie. Doe dit
  // VÓÓR buildScene zodat per-world build-time gates (skyShaderDome)
  // de verse flags zien.
  if(typeof window._reEvaluateTierForNewRace==='function'){
    window._reEvaluateTierForNewRace();
  }
  activeWorld=newWorld;
  localStorage.setItem('src_world',newWorld);
  // Preload muziek-stems + surface voor deze wereld (fire-and-forget). Als
  // de assets er zijn en op tijd klaar voor race-start gebruikt music.js
  // de stems en engine.js de surface-loop; anders fallback naar procedural.
  if(window.Audio&&window.Audio.preloadWorld)window.Audio.preloadWorld(newWorld);
  if(window._preloadSurfacesForWorld)window._preloadSurfacesForWorld(newWorld);
  // Visual assets (HDRI / ground / GLTF props) — fire-and-forget. World build
  // is synchronous and falls back to procedural if cache is empty at race-start.
  if(window.Assets&&window.Assets.preloadWorld){
    window.Assets.preloadWorld(newWorld).then(()=>{
      try{ if(typeof maybeUpgradeWorld==='function'){maybeUpgradeWorld._lastCalledFrom='selectPreloadResolve';maybeUpgradeWorld(newWorld);} }
      catch(e){ if(window.dbg)dbg.error('select',e,'maybeUpgradeWorld failed (rebuild)'); else console.error('maybeUpgradeWorld failed:',e); }
    }).catch(e=>{
      if(window.dbg)dbg.error('select',e,'Assets.preloadWorld rejected (rebuild)');
      else console.error('Assets.preloadWorld rejected:',e);
    });
  }
  const _wasDark=isDark;
  // buildScene() can throw on iOS under memory pressure (texture upload,
  // shader compile). Surface the error visibly instead of leaving the user
  // on a half-built scene with no feedback.
  try{ await buildScene(); }
  catch(e){
    if(window.dbg) dbg.error('select', e, 'rebuildWorld buildScene crashed');
    else console.error('rebuildWorld buildScene crashed:', e);
    if(window.Notify) Notify.banner('⚠ Wereld kon niet laden — probeer opnieuw','#ff6644',3500);
    return;
  }
  if(!_wasDark)toggleNight(); // if was day, flip back to day
  if(_weatherMode!=='clear')setWeather(_weatherMode);
  // Snap fog color immediately
  _skyT=_skyTarget;
  if(scene.fog)scene.fog.color.lerpColors(_fogColorDay,_fogColorNight,_skyT);
  // Gantry label is now a 3D sprite rebuilt with buildGantry() inside buildScene() — no DOM update needed
  // HUD tint: cyan for space, orange for GP
  applyWorldHUDTint(newWorld);
  // Refresh car preview (force re-render)
  _prevDefId=-1;_selectPreviewCar(selCarId);
  // (Pre-compile + GPU upload prime gebeurt nu standaard aan het eind van
  // buildScene() via _precompileScene — zie js/core/scene.js.)
  if(window.perfMark){perfMark('transition:end');perfMeasure('transition.total','transition:start','transition:end');}
}

// Async wrapper around rebuildWorld: paint loading-overlay first, yield to
// the browser, then run the synchronous buildScene (1-2s on Guangzhou). This
// is the difference between Chrome showing "page unresponsive" and Chrome
// showing a spinner — same total CPU time, but the user gets feedback.
//
// Re-entry: _worldRebuildInFlight blocks parallel calls (double-tap on tile).
// The 220ms tail in boot.js' card handler runs after this resolves.
let _worldRebuildInFlight=false;
function _showWorldLoadingOverlay(){
  if(window.SrcLoader){window.SrcLoader.showWorldLoader();return;}
  const el=document.getElementById('worldLoadingOverlay');
  if(el)el.classList.remove('wloHidden');
}
function _hideWorldLoadingOverlay(){
  if(window.SrcLoader){window.SrcLoader.hideWorldLoader();return;}
  const el=document.getElementById('worldLoadingOverlay');
  if(el)el.classList.add('wloHidden');
}
async function rebuildWorldAsync(newWorld){
  if(newWorld===activeWorld)return;
  if(_worldRebuildInFlight)return;
  _worldRebuildInFlight=true;
  if(window.perfMark)perfMark('rebuildWorldAsync:start');
  _showWorldLoadingOverlay();
  // Double-yield: rAF gives the browser a paint frame to render the overlay,
  // setTimeout(0) breaks the current task so buildScene runs on a fresh task
  // (Chrome's "page unresponsive" detector resets between tasks).
  await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
  if(window.perfMark)perfMark('rebuildWorldAsync:overlay-shown');
  // Fase 1C: laad het wereld-script lazy. Was statisch in index.html; nu via
  // window.loadWorldScript (zie js/core/world-loader.js). Door dit voor het
  // synchrone buildScene-blok te doen voorkomen we een ReferenceError op
  // buildXEnvironment(). Overlay blijft staan tijdens de fetch.
  if(typeof window.loadWorldScript==='function'){
    try{ await window.loadWorldScript(newWorld); }
    catch(e){
      if(window.dbg)dbg.error('select',e,'loadWorldScript failed for '+newWorld);
      else console.error('loadWorldScript failed for '+newWorld+':',e);
      if(window.Notify)Notify.banner('⚠ Wereld kon niet laden — probeer opnieuw','#ff6644',3500);
      _hideWorldLoadingOverlay();
      _worldRebuildInFlight=false;
      return;
    }
  }
  try{
    await rebuildWorld(newWorld);
  }finally{
    _hideWorldLoadingOverlay();
    _worldRebuildInFlight=false;
    if(window.perfMark){perfMark('rebuildWorldAsync:end');perfMeasure('rebuildWorldAsync.total','rebuildWorldAsync:start','rebuildWorldAsync:end');}
  }
}
if(typeof window!=='undefined')window.rebuildWorldAsync=rebuildWorldAsync;

function applyWorldHUDTint(world){
  const isSpace=world==='space';
  const isDeepSea=world==='deepsea';
  const isP47=world==='pier47';
  const nitroFill=document.getElementById('nitroFill');
  if(nitroFill)nitroFill.style.background=isSpace?'linear-gradient(180deg,#00ffee,#0088ff)':isDeepSea?'linear-gradient(180deg,#00ffcc,#0088aa)':isP47?'linear-gradient(180deg,#ffaa44,#a04020)':'linear-gradient(180deg,#ffee00,#ff7700)';
  const nitroLbl=document.getElementById('nitroLbl');
  if(nitroLbl)nitroLbl.style.color=isSpace?'#00ccff':isDeepSea?'#00ddaa':isP47?'#ff8830':'#ff7700';
  const hdGear=document.getElementById('hdGear');
  if(hdGear)hdGear.style.color=isSpace?'#00eeff':isDeepSea?'#00ffcc':isP47?'#ffb070':'#fff';
  const hdSpd=document.getElementById('hdSpd');
  if(hdSpd)hdSpd.style.color=isSpace?'#00eeff':isDeepSea?'#00ffcc':isP47?'#ffb070':'#fff';
  // HUD accent tint per world (applied to race-info panel border).
  // Pier 47 sodium-orange.
  const hudInfo=document.getElementById('hudRaceInfo');
  if(hudInfo)hudInfo.style.borderColor=isDeepSea?'rgba(0,221,170,.45)':isSpace?'rgba(0,204,255,.45)':isP47?'rgba(255,136,48,.30)':'rgba(255,255,255,.10)';
}

// Stat ranking across the catalog — computed lazily once. Used to show
// a ghost (max-in-catalog) bar behind the current car's stat bar, and
// to colour the numeric value by rank (top-3 = green, top half = amber).
let _statRanks=null;
const _STAT_DEFS=[
  {key:'topSpd',lbl:'SPEED',   div:1.38,col:'#ff7700'},
  {key:'accel', lbl:'ACCEL',   div:.026,col:'#00aaff'},
  {key:'hdlg',  lbl:'HANDLING',div:.060,col:'#00ff88'},
  {key:'nitro', lbl:'NITRO',   div:10,  col:'#ff3a8c'}
];
function _computeStatRanks(){
  if(_statRanks)return _statRanks;
  _statRanks={};
  _STAT_DEFS.forEach(s=>{
    const arr=CAR_DEFS.map(c=>({id:c.id,v:Math.round(((c[s.key]||0)/s.div)*100)}));
    arr.sort((a,b)=>b.v-a.v);
    const byId={};arr.forEach((x,i)=>{byId[x.id]=i;});
    _statRanks[s.key]={byId:byId,max:arr.length?arr[0].v:100};
  });
  return _statRanks;
}

function _renderStatCards(def){
  const statsEl=document.getElementById('prevStats');
  if(!statsEl)return;
  const ranks=_computeStatRanks();
  if(statsEl.dataset.built!=='1'){
    statsEl.dataset.built='1';
    statsEl.innerHTML=_STAT_DEFS.map(s=>(
      '<div class="statCard" data-stat="'+s.key+'">'+
        '<div class="statCardHead">'+
          '<div class="statCardLbl">'+s.lbl+'</div>'+
          '<div class="statCardVal"><span class="statCardValNum">0</span><span class="statCardValMax"> / 100</span></div>'+
        '</div>'+
        '<div class="statCardBar">'+
          '<div class="statCardGhost"></div>'+
          '<div class="statCardFill" style="background:'+s.col+';box-shadow:0 0 6px '+s.col+'99"></div>'+
        '</div>'+
      '</div>'
    )).join('');
  }
  const total=CAR_DEFS.length;
  _STAT_DEFS.forEach(s=>{
    const v=Math.round(((def[s.key]||0)/s.div)*100);
    const card=statsEl.querySelector('.statCard[data-stat="'+s.key+'"]');
    if(!card)return;
    const ghost=card.querySelector('.statCardGhost');
    const fill=card.querySelector('.statCardFill');
    const num=card.querySelector('.statCardValNum');
    if(ghost)ghost.style.width=Math.min(100,Math.max(0,ranks[s.key].max))+'%';
    if(fill)fill.style.width=Math.min(100,Math.max(0,v))+'%';
    if(num){
      num.textContent=v;
      const rank=ranks[s.key].byId[def.id]||0;
      num.style.color = rank<3 ? '#7dffb0' : rank<total/2 ? '#ffcc44' : '#c9b9ff';
    }
  });
}

// Active tier filter for the garage list. 'all' shows everything; otherwise
// only def.type === tier is rendered.
let _activeTier='all';

// ──────────────────────────────────────────────────────────────────────
// CAR ATTRIBUTES — small icon-pills below the SPECTRUM stats showing the
// car's drivetrain (AWD/RWD/FWD) and engine layout (Front/Mid/Rear/Dual-
// Motor). Reads def.drivetrain + def.engine from data/cars.json. Falls
// back to em-dash if missing so missing data is visible but harmless.
// ──────────────────────────────────────────────────────────────────────
function _renderAttributesPanel(def){
  const dt=document.getElementById('attrDrivetrain');
  const en=document.getElementById('attrEngine');
  if(dt) dt.textContent=(def&&def.drivetrain)||'—';
  if(en) en.textContent=(def&&def.engine)||'—';
}

// Centralized lap-selection setter — used by inline pills, carousel
// chevrons, AND the modal so they all stay in sync. Persists to
// localStorage and refreshes the start-button summary.
function _setSelectedLaps(n){
  if(_LAP_OPTS.indexOf(n)<0)return;
  _selectedLaps=n;TOTAL_LAPS=n;
  try{localStorage.setItem('src_lap',n);}catch(e){}
  _LAP_OPTS.forEach(m=>{
    const b=document.getElementById('lap'+m);
    if(b)b.classList.toggle('setOptSel',m===n);
  });
  // Scroll selected pill into view in the carousel (small lap counts
  // are at the left, 25 is at the right — auto-center the chosen one).
  const sel=document.getElementById('lap'+n);
  const wrap=sel&&sel.parentNode;
  if(sel&&wrap&&typeof sel.scrollIntoView==='function'){
    try{sel.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});}catch(_){}
  }
  _updateSelectSummary();
  // Refresh modal selected-state if it happens to be open.
  document.querySelectorAll('#rmLapOpts .raceModalOpt').forEach(b=>{
    b.classList.toggle('rmSel',Number(b.dataset.lap)===n);
  });
}

// Wire ◀/▶ chevrons that flank the lap pills. Cycles through _LAP_OPTS.
function _wireLapCarousel(){
  const prev=document.getElementById('lapNavPrev');
  const next=document.getElementById('lapNavNext');
  if(!prev||!next)return;
  prev.onclick=()=>{
    const i=_LAP_OPTS.indexOf(_selectedLaps);
    const j=(i<=0?_LAP_OPTS.length-1:i-1);
    _setSelectedLaps(_LAP_OPTS[j]);
  };
  next.onclick=()=>{
    const i=_LAP_OPTS.indexOf(_selectedLaps);
    const j=(i<0||i>=_LAP_OPTS.length-1?0:i+1);
    _setSelectedLaps(_LAP_OPTS[j]);
  };
}

// Race Settings modal — opens via the gear button, contains the same
// lap + difficulty options but with descriptive sub-labels. State is
// shared with the inline pickers via _setSelectedLaps + the existing
// difficulty handlers, so no separate "Apply" commit is needed (the
// Apply & Close button is purely a UX affordance).
let _raceModalWired=false;
function _wireRaceSettingsModal(){
  const openBtn=document.getElementById('btnRaceSettings');
  const modal=document.getElementById('raceSettingsModal');
  if(!modal)return;
  // Sync modal option selected-state with current values whenever opened.
  function syncModal(){
    document.querySelectorAll('#rmLapOpts .raceModalOpt').forEach(b=>{
      b.classList.toggle('rmSel',Number(b.dataset.lap)===_selectedLaps);
    });
    document.querySelectorAll('#rmDiffOpts .raceModalOpt').forEach(b=>{
      b.classList.toggle('rmSel',Number(b.dataset.diff)===difficulty);
    });
  }
  function open(){
    syncModal();
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden','false');
  }
  function close(){
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden','true');
  }
  if(openBtn) openBtn.onclick=open;
  if(_raceModalWired){ syncModal(); return; }
  _raceModalWired=true;
  const closeBtn=document.getElementById('raceModalClose');
  const backdrop=document.getElementById('raceModalBackdrop');
  const doneBtn=document.getElementById('raceModalDone');
  if(closeBtn) closeBtn.onclick=close;
  if(backdrop) backdrop.onclick=close;
  if(doneBtn) doneBtn.onclick=close;
  // ESC closes
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!modal.classList.contains('hidden')) close();
  });
  // Lap options in modal
  document.querySelectorAll('#rmLapOpts .raceModalOpt').forEach(b=>{
    b.onclick=()=>{ _setSelectedLaps(Number(b.dataset.lap)); syncModal(); };
  });
  // Difficulty options in modal — mirror the inline diffBtn behavior.
  document.querySelectorAll('#rmDiffOpts .raceModalOpt').forEach(b=>{
    b.onclick=()=>{
      const i=Number(b.dataset.diff);
      difficulty=i;
      try{localStorage.setItem('src_difficulty',i);}catch(e){}
      ['dEasy','dNorm','dHard'].forEach((id,j)=>{
        const e2=document.getElementById(id);if(!e2)return;
        e2.classList.toggle('setOptSel',j===i);
        e2.classList.toggle('diffSel',j===i);
      });
      if(typeof _renderRival==='function') _renderRival();
      _updateSelectSummary();
      syncModal();
    };
  });
}

// ── getCarSelectionState — single source of truth for per-car UI state.
// All render-sites (garage list, mobile carousel card, lock-overlay,
// CTA enable/disable) call this rather than re-implementing the
// _unlockedCars + CAR_PRICES + selCarId checks inline. Defensive
// defaults make missing data non-crashing.
//
// Returns:
//   {unlocked, equipped, price, affordable, owned, stats, def}
//
// 'owned' === 'unlocked' here — the codebase treats them as one
// concept (you OWN unlocked cars, you don't own locked ones).
// Kept as an alias because the kickoff brief asked for both.
//
// Was previously fragmented across:
//   - select.js _carPrices (hardcoded duplicate of data/prices.json,
//     stale: cars 4-7 listed as 0 instead of 400/300/500/600 + missing
//     id 12)
//   - inline _unlockedCars.has(id) at multiple call sites
//   - prices.json loaded at boot into window.CAR_PRICES (canonical)
//
// CAR_PRICES is the authoritative source (loaded from prices.json by
// main.js loadGameData). Falls back to 0 for unknown ids so a future
// new car-id without a price entry defaults to free, not crash.
function getCarSelectionState(carIdOrDef){
  let def=null;
  if(typeof carIdOrDef==='object'&&carIdOrDef){def=carIdOrDef;}
  else if(carIdOrDef!=null&&window.CAR_DEFS){
    // Coerce string ids (eg from dataset.carId) to number — CAR_DEFS
    // is array-indexed, CAR_PRICES is keyed by Number(k) per main.js:31.
    const idNum=(typeof carIdOrDef==='number')?carIdOrDef:Number(carIdOrDef);
    def=Number.isFinite(idNum)?(window.CAR_DEFS[idNum]||null):null;
  }
  const id=def?def.id:(typeof carIdOrDef==='number'?carIdOrDef:Number(carIdOrDef));
  const prices=window.CAR_PRICES||{};
  const unlockedSet=window._unlockedCars||new Set();
  const coins=window._coins||0;
  // Distinguish 'no entry' from 'free' (P3 reviewer fix #3): if the id
  // has NO entry in CAR_PRICES, this is likely an early-boot state
  // where loadGameData hasn't run; mark price as Infinity so callers
  // don't accidentally treat unknown cars as free + affordable.
  const hasPrice=Object.prototype.hasOwnProperty.call(prices,id);
  const price=hasPrice?prices[id]:Infinity;
  const unlocked=unlockedSet.has(id);
  const equipped=(window.selCarId===id);
  const affordable=(coins>=price);
  // 'available' = data is loaded for this car-id. Callers can branch
  // on this to show a loading-skeleton instead of stale defaults.
  const available=!!def&&hasPrice;
  return {
    def:def,
    available:available,
    unlocked:unlocked,
    owned:unlocked,            // alias — same meaning in this codebase
    equipped:equipped,
    price:price,
    affordable:affordable,
    stats:def?{
      topSpd:def.topSpd||0,
      accel:def.accel||0,
      hdlg:def.hdlg||0,
      nitro:def.nitro||0,
      type:def.type||'super'
    }:null
  };
}
if(typeof window!=='undefined')window.getCarSelectionState=getCarSelectionState;

// Legacy export — `_carPrices` was a HARDCODED OBJECT duplicating
// data/prices.json with stale values (cars 4-7 = 0 here, but 400/
// 300/500/600 in prices.json; id 12 missing). Now a Proxy-style
// getter onto the canonical CAR_PRICES so any remaining inline
// reader gets fresh values without touching call-sites.
const _carPrices=new Proxy({},{
  get(_,k){
    const id=Number(k);
    if(Number.isNaN(id))return undefined;
    return (window.CAR_PRICES&&typeof window.CAR_PRICES[id]==='number')?window.CAR_PRICES[id]:0;
  }
});

function _renderGarageList(){
  const grid=document.getElementById('carGrid');if(!grid)return;
  // Diagnostiek voor de incidentele "linker kolom is leeg" bug op het
  // select-scherm. Als CAR_DEFS nog niet geladen is (data fetch race),
  // logt deze breadcrumb dat we het lege pad raken zodat we de volgende
  // optreden direct kunnen wijzen op de data-promise.
  if(!window.CAR_DEFS||CAR_DEFS.length===0){
    if(window.Breadcrumb)Breadcrumb.push('_renderGarageList.empty',{state:(typeof gameState!=='undefined'?gameState:'?')});
    if(window.dbg)dbg.warn('select','CAR_DEFS leeg bij _renderGarageList — race tussen data-fetch en screen-build');
  }
  grid.innerHTML='';
  const coins=window._coins|0;
  const canvasesToBake=[];
  CAR_DEFS.forEach(def=>{
    if(_activeTier!=='all'&&def.type!==_activeTier)return;
    const unlocked=_unlockedCars.has(def.id);
    const card=document.createElement('div');
    card.className='carCard'+(def.id===selCarId&&unlocked?' sel':'')+(unlocked?'':' locked');
    const carCol=def.color;
    const teamCol=(def.accent!=null?def.accent:def.color);
    const carHex='#'+carCol.toString(16).padStart(6,'0');
    const teamHex='#'+teamCol.toString(16).padStart(6,'0');
    card.style.setProperty('--team',teamHex);
    // Round-8: tile-grid carCard. Mirrors the mobile .selM-card recipe:
    // baked Three.js snapshot centre, tier badge top-left, lock pip
    // top-right, brand+model strip bottom. Uses --car-accent / --car-glow
    // CSS variables so each tile glows in its identity colour.
    card.style.setProperty('--car-accent',(typeof _selMAccentHex==='function')?_selMAccentHex(def):teamHex);
    card.style.setProperty('--car-glow',(typeof _selMHexToRgba==='function')?_selMHexToRgba(def,.45):'rgba(204,68,255,.4)');
    const tierLbl=(_SELM_TIER_LABEL&&_SELM_TIER_LABEL[def.type])||((def.type||'').toUpperCase());
    let lockHtml='';
    if(!unlocked){
      const price=_carPrices[def.id];
      const hint=_unlockHints[def.id]||'';
      if(price){
        const afford=coins>=price?' afford':'';
        lockHtml='<div class="carCardLock">'+
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'+
        '</div>'+
        '<div class="carCardPrice'+afford+'">'+price+'c</div>';
        card.title=(afford?'Unlock for ':'Need ')+price+' coins'+(hint?' · '+hint:'');
      }else{
        lockHtml='<div class="carCardLock"><span class="carLockIcon">🔒</span></div>';
        card.title='Locked'+(hint?' — '+hint:'');
      }
    }
    card.innerHTML=
      '<div class="carCardBg"></div>'+
      '<div class="carCardBadge">'+tierLbl+'</div>'+
      lockHtml+
      '<canvas class="carCardCanvas'+(unlocked?'':' carCardCanvasLocked')+'"></canvas>'+
      '<div class="carCardLabel">'+
        '<div class="carBrand">'+def.brand+'</div>'+
        '<div class="carName">'+def.name+'</div>'+
      '</div>';
    if(!unlocked){
      card.onclick=()=>showPopup('🔒 LOCKED — '+(_unlockHints[def.id]||'complete challenges'),'#ff6644',1800);
    }else{
      card.onclick=()=>{
        document.querySelectorAll('.carCard').forEach(el=>el.classList.remove('sel'));
        card.classList.add('sel');_selectPreviewCar(def.id);
      };
    }
    grid.appendChild(card);
    canvasesToBake.push({cvs:card.querySelector('.carCardCanvas'),id:def.id,def:def});
  });
  // Draw baked snapshots on the next frame (after layout) so client
  // dimensions are real. Reuses the mobile snapshot bakery via
  // _selMDrawCardCanvas — same _snapCache, no double-bake cost.
  requestAnimationFrame(()=>{
    canvasesToBake.forEach(({cvs,id,def})=>{
      if(!_snapCache[id]){
        // Lazy-bake on first visit. The mobile flow also lazy-bakes
        // via _bakeAllSnapshots; calling _bakeCarSnapshot is safe and
        // idempotent because of the _snapCache guard inside.
        _bakeCarSnapshot(def);
      }
      if(typeof _selMDrawCardCanvas==='function')_selMDrawCardCanvas(cvs,id);
    });
  });
}

function _renderHeaderSubtitle(){
  const el=document.getElementById('selSubtitle');
  const u=_unlockedCars.size,t=CAR_DEFS.length;
  const c=window._coins|0;
  if(el)el.textContent=u+' of '+t+' unlocked · '+c.toLocaleString('en')+' coins';
  // Light Edition: eyebrow above the GARAGE title also reflects live count.
  // .holoEyebrow renders the ◇ glyph via ::before so textContent is safe
  // to overwrite without losing the diamond.
  const ey=document.getElementById('selEyebrow');
  if(ey) ey.textContent='COLLECTION · '+t+' VEHICLES';
  const bar=document.getElementById('garageProgFill');
  if(bar)bar.style.width=(t>0?(u/t)*100:0)+'%';
}

// Horizontal-swipe car cycling on the legacy preview area. Op mobile
// portrait toont een aparte selM-carousel met native scroll-snap (al
// swipebaar via CSS); deze handler dekt iPhone landscape, iPad en alle
// touch-devices die de legacy `.prevCanvasWrap` zien. Cycle gaat alleen
// door **unlocked** cars zodat een swipe altijd een nuttige preview
// oplevert. Hergebruikt _selectPreviewCar voor state-mutatie + sync
// met carCard `.sel` markup. Idempotent (guard tegen dubbele wires
// bij goToWorldSelect → terug naar select).
let _swipeWired=false;
function _initCarPreviewSwipe(){
  if(_swipeWired)return;
  // Alleen op touch-capable devices; muis-drag op desktop zou anders
  // onbedoeld cars wisselen.
  if(!window._isTouch&&!window._isMobile&&!window._isTablet)return;
  // ≥900px viewport: live 3D preview is active and the same surface is
  // used for drag-to-rotate — swipe-cycle would conflict. Skip wiring;
  // the user picks cars via garage tiles or the new arrow buttons.
  if((window.innerWidth||0)>=LIVE_PREVIEW_MIN_W)return;
  const wrap=document.getElementById('carPreviewCvs');
  if(!wrap||!wrap.parentNode)return;
  const target=wrap.parentNode; // .prevCanvasWrap
  _swipeWired=true;
  const TH_X=45, MAX_Y=25;
  let startX=0,startY=0,active=false,pointerId=-1;
  function unlockedList(){
    return (window.CAR_DEFS||[]).filter(d=>_unlockedCars.has(d.id));
  }
  function step(dir){
    const list=unlockedList();
    if(list.length<2)return;
    let idx=list.findIndex(d=>d.id===selCarId);
    if(idx<0)idx=0;
    idx=(idx+dir+list.length)%list.length;
    const def=list[idx];
    if(!def)return;
    _selectPreviewCar(def.id);
    // Mirror selection in carCard list (.sel marker) for visual sync.
    document.querySelectorAll('.carCard').forEach(el=>{
      el.classList.toggle('sel',el.dataset.defId===String(def.id));
    });
    // Haptic tick op succesful swipe — hergebruik _selMVibrate (zelfde
    // try/catch wrapper, gedefinieerd verderop in deze file).
    _selMVibrate(10);
  }
  function down(e){
    if(!e.isPrimary)return;
    active=true;pointerId=e.pointerId;
    startX=e.clientX;startY=e.clientY;
    try{target.setPointerCapture(e.pointerId);}catch(_){ }
  }
  function up(e){
    if(!active||e.pointerId!==pointerId)return;
    active=false;
    const dx=e.clientX-startX,dy=e.clientY-startY;
    if(Math.abs(dx)>=TH_X&&Math.abs(dy)<=MAX_Y){
      // Swipe-left → next car (iOS-conventie); swipe-right → previous.
      step(dx<0?+1:-1);
    }
  }
  function cancel(){active=false;}
  // passive:true op down/move zodat verticaal page-scrollen niet wordt
  // geblokkeerd. preventDefault is niet nodig — we tappen niet op een
  // scroll-element. lostpointercapture vuurt altijd als capture eindigt
  // (incl. iOS Safari scroll-gesture-steal en tab-blur), dus het is de
  // betrouwbare reset terwijl pointerleave onderdrukt blijft door capture.
  target.addEventListener('pointerdown',down,{passive:true});
  target.addEventListener('pointerup',up,{passive:true});
  target.addEventListener('pointercancel',cancel,{passive:true});
  target.addEventListener('pointerleave',cancel,{passive:true});
  target.addEventListener('lostpointercapture',cancel,{passive:true});
}

function buildCarSelectUI(){
  // Fresh attempt at the live 3D preview each time the select screen
  // opens — unless we've already hit the per-session retry cap, in
  // which case we stay on baked snapshots to avoid log spam.
  if(_liveRendererFailCount<LIVE_RENDERER_MAX_FAILS)_liveRendererFailed=false;
  loadPersistent();
  // Restore race-config voorkeuren uit localStorage. loadPersistent zelf
  // restoreert alleen unlocks/coins/records — laps en difficulty werden
  // bij elke reload terug op hardcoded defaults gezet (3, normal),
  // waardoor de start-button summary niet matched met wat gebruiker
  // eerder gekozen had.
  try{
    const sl=parseInt(localStorage.getItem('src_lap'),10);
    if(_LAP_OPTS.indexOf(sl)>=0){_selectedLaps=sl;TOTAL_LAPS=sl;}
    const sd=parseInt(localStorage.getItem('src_difficulty'),10);
    if(sd===0||sd===1||sd===2)difficulty=sd;
  }catch(e){}
  _prevDefId=-1;
  // Pre-bake snapshots voor alle 12 auto's via de hoofd-renderer.
  // Synchronous (~200ms) — gebeurt tijdens screen-transitie naar SELECT
  // dus de gebruiker ziet geen visuele hapering.
  bakeAllCarSnapshots();
  _initSnapshotResize();
  _selectPreviewCar(selCarId);
  _renderHeaderSubtitle();
  _renderGarageList();
  _renderRival();
  // Tier tabs — filter the garage list by car type.
  document.querySelectorAll('.tierTab').forEach(tab=>{
    tab.classList.toggle('tierTabSel',tab.dataset.tier===_activeTier);
    tab.onclick=()=>{
      _activeTier=tab.dataset.tier;
      document.querySelectorAll('.tierTab').forEach(t=>t.classList.toggle('tierTabSel',t.dataset.tier===_activeTier));
      _renderGarageList();
    };
  });
  // World indicator badge
  const wInd=document.getElementById('worldIndicator');
  if(wInd){
    const wNames2={space:'COSMIC',deepsea:'DEEP SEA',candy:'CANDY',volcano:'VOLCANO',arctic:'ARCTIC',sandstorm:'SANDSTORM',pier47:'PIER 47',guangzhou:'GUANGZHOU'};
    const nameEl=document.getElementById('worldIndicatorName');
    const nameTxt=wNames2[activeWorld]||activeWorld.toUpperCase();
    if(nameEl){
      // New Light Edition markup: ◆ prefix is static in HTML, only the
      // text node is updated so .holoPill chrome (border, padding) survives.
      nameEl.textContent=nameTxt;
    } else {
      wInd.textContent='◆ '+nameTxt;
    }
  }
  _weatherMode='clear';
  // Sync difficulty tab visual state + wire onclick. Voorheen alleen
  // visual sync, geen handler — segmented control was non-functional,
  // wat de "LAPS=1 maar START RACE zegt 'normal'" desync verklaart.
  ['dEasy','dNorm','dHard'].forEach((id,i)=>{
    const el=document.getElementById(id);if(!el)return;
    el.classList.toggle('setOptSel',i===difficulty);
    el.classList.toggle('diffSel',i===difficulty);
    el.onclick=()=>{
      difficulty=i;
      try{localStorage.setItem('src_difficulty',i);}catch(e){}
      ['dEasy','dNorm','dHard'].forEach((id2,j)=>{
        const e2=document.getElementById(id2);if(!e2)return;
        e2.classList.toggle('setOptSel',j===i);
        e2.classList.toggle('diffSel',j===i);
      });
      _renderRival(); // rival lap-record key bevat difficulty
      _updateSelectSummary();
    };
  });
  // Wire LAPS tab options (1/3/5/10/25 — 2026-05 redesign expanded the range).
  _LAP_OPTS.forEach(n=>{
    const btn=document.getElementById('lap'+n);if(!btn)return;
    btn.classList.toggle('setOptSel',n===_selectedLaps);
    btn.onclick=()=>_setSelectedLaps(n);
  });
  _wireLapCarousel();
  _updateSelectSummary();
  // Race Settings modal — opens a fuller-size lap + difficulty picker
  // with descriptive copy per option. Wired here so it picks up any
  // re-renders from rebuildWorld.
  _wireRaceSettingsModal();
  // Touch-swipe op de legacy preview canvas — dekt iPhone landscape,
  // iPad en andere touch-devices waar de mobile-portrait carousel niet
  // gerenderd wordt.
  _initCarPreviewSwipe();
  // Build the parallel mobile-portrait UI. CSS keeps it hidden on
  // desktop/landscape; on portrait phones it replaces the legacy layout.
  _buildMobileSelect();
  // Wire ◀/▶ navigation buttons on the live preview wrap — replaces
  // swipe-cycle on tablet/desktop, walks unlocked cars only.
  _wirePrevNavButtons();
  // Spin up the live 3D preview if the viewport supports it. Idempotent;
  // also re-runs on resize via _syncLiveModeWithViewport.
  // Defer one frame: navigation.js calls buildCarSelectUI() while #sSelect
  // still has .hidden — _isLivePreviewSupported gates on that class, so an
  // immediate call would early-out and the live 3D preview would never
  // start. By the next rAF the screen has been un-hidden and init succeeds.
  if(typeof requestAnimationFrame==='function'){
    requestAnimationFrame(()=>_syncLiveModeWithViewport());
  }else{
    _syncLiveModeWithViewport();
  }
}

function _wirePrevNavButtons(){
  const prev=document.getElementById('prevNavPrev');
  const next=document.getElementById('prevNavNext');
  if(!prev||!next)return;
  function unlockedList(){
    return (window.CAR_DEFS||[]).filter(d=>_unlockedCars.has(d.id));
  }
  function step(dir){
    const list=unlockedList();
    if(list.length<2)return;
    let idx=list.findIndex(d=>d.id===selCarId);
    if(idx<0)idx=0;
    idx=(idx+dir+list.length)%list.length;
    const def=list[idx];
    if(!def)return;
    _selectPreviewCar(def.id);
    document.querySelectorAll('.carCard').forEach(el=>{
      el.classList.toggle('sel',el.dataset.defId===String(def.id));
    });
    _selMVibrate(8);
  }
  prev.onclick=()=>step(-1);
  next.onclick=()=>step(+1);
}

// ──────────────────────────────────────────────────────────────────────
// MOBILE PORTRAIT REDESIGN — parallel renderer.
// State is shared with the desktop UI via window.* globals (selCarId,
// _selectedLaps, difficulty, isDark, _activeTier, _coins, _unlockedCars,
// activeWorld). Both renderers update the same state setters so switching
// orientation mid-screen stays consistent.
// ──────────────────────────────────────────────────────────────────────

let _selMScrollTimer=null;
let _selMScrollWired=false;

const _SELM_WORLD_ICONS={
  space:'🚀',deepsea:'🌊',candy:'🍬',
  volcano:'🌋',arctic:'🧊',
  sandstorm:'🏜',pier47:'🚢',guangzhou:'🌃'
};
const _SELM_WORLD_NAMES={
  space:'COSMIC',deepsea:'DEEP SEA',candy:'SUGAR RUSH',
  volcano:'VOLCANO',arctic:'ARCTIC',
  sandstorm:'SANDSTORM',pier47:'PIER 47',guangzhou:'GUANGZHOU'
};
const _SELM_TIER_LABEL={super:'SUPER',f1:'F1',muscle:'CLASSIC',electric:'ELECTRIC',rally:'RALLY'};
const _LAP_OPTS=[1,3,5,10,25];

function _selMVibrate(ms){
  try{if(navigator.vibrate)navigator.vibrate(ms);}catch(e){}
}

// Filtered list of car defs based on _activeTier. Locked cars stay in
// the list (visible with padlock badge) but are not selectable.
function _selMFilteredCars(){
  if(!window.CAR_DEFS)return [];
  if(_activeTier==='all')return CAR_DEFS.slice();
  return CAR_DEFS.filter(d=>d.type===_activeTier);
}

// Draw the pre-baked snapshot into a card's <canvas>. Center-square
// crop of the 16:9 snapshot, then scale to fit the (typically square)
// tile. The car is always horizontally centred in the snapshot, so
// taking the middle SNAP_H × SNAP_H slice gives every tile the same
// source region — cars sit identically across the grid and the
// horizontal lighting-glow edges are dropped. Tile contain-fit on top
// keeps non-square tiles letterboxed instead of stretching the car.
function _selMDrawCardCanvas(canvas,defId){
  if(!canvas)return;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const cw=Math.max(2,(canvas.clientWidth||260)*dpr|0);
  const ch=Math.max(2,(canvas.clientHeight||260)*dpr|0);
  if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,cw,ch);
  const snap=_snapCache[defId];
  if(!snap)return;
  // Source: center square crop of the 16:9 bake. SNAP_H is the limiting
  // axis so the square is (SNAP_H × SNAP_H), centred on the snapshot's
  // horizontal midline where every car is composed.
  const srcSize=SNAP_H;
  const srcX=(SNAP_W-srcSize)/2;
  const srcY=0;
  // Destination: contain-fit the square crop into the tile. For square
  // tiles (the common case) this fills exactly; for non-square tiles
  // it letterboxes so the car never gets stretched.
  let dw=cw,dh=ch,dx=0,dy=0;
  if(cw>ch){dw=ch;dx=(cw-ch)/2;}
  else if(ch>cw){dh=cw;dy=(ch-cw)/2;}
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(snap,srcX,srcY,srcSize,srcSize,dx,dy,dw,dh);
}

// Pick a usable accent colour for the carousel card. Prefers def.color
// (the brand colour spencer's-race-club uses on the body) but bumps it
// when too dark (Red Bull dark navy → unusable as glow) and falls back
// to def.accent when too light (Mustang white, Tesla silver). Returns
// the picked colour as a numeric RGB int.
function _selMPickAccent(def){
  const c=(def.color|0),a=(def.accent|0);
  const lum=v=>{const r=(v>>16)&0xff,g=(v>>8)&0xff,b=v&0xff;return r*.299+g*.587+b*.114;};
  const cl=lum(c);
  if(cl>215){
    // Too light → use accent if it's not also extreme.
    const al=lum(a);
    if(al>=30&&al<=215)return a;
    // Both extreme — lift body colour towards a saturated mid-tone.
    return 0xff3a8c;
  }
  if(cl<40){
    // Too dark — brighten while preserving hue. Pump weak channels.
    let r=(c>>16)&0xff,g=(c>>8)&0xff,b=c&0xff;
    const f=Math.max(2,90/Math.max(cl,4));
    r=Math.min(255,Math.round(r*f+50));
    g=Math.min(255,Math.round(g*f+50));
    b=Math.min(255,Math.round(b*f+50));
    return (r<<16)|(g<<8)|b;
  }
  return c;
}
function _selMAccentHex(def){
  const v=_selMPickAccent(def);
  return '#'+v.toString(16).padStart(6,'0');
}
function _selMHexToRgba(def,alpha){
  const v=_selMPickAccent(def);
  const r=(v>>16)&0xff,g=(v>>8)&0xff,b=v&0xff;
  return 'rgba('+r+','+g+','+b+','+alpha+')';
}

// Build/rebuild the carousel cards based on the active tier filter.
// Each card has its own <canvas> drawn from the pre-baked snapshot.
function _selMRenderCarousel(){
  const carousel=document.getElementById('selMCarousel');
  const dotsEl=document.getElementById('selMDots');
  if(!carousel||!dotsEl)return;
  const list=_selMFilteredCars();
  carousel.innerHTML='';dotsEl.innerHTML='';
  if(!list.length)return;
  // If selCarId is filtered out, fall back to first in list.
  let activeIdx=list.findIndex(d=>d.id===selCarId);
  if(activeIdx<0){activeIdx=0;selCarId=list[0].id;}
  list.forEach((def,i)=>{
    const unlocked=_unlockedCars.has(def.id);
    const card=document.createElement('div');
    card.className='selM-card'+(i===activeIdx?' selM-cardActive':'')+(unlocked?'':' selM-cardLocked');
    card.dataset.defId=def.id;
    card.style.setProperty('--car-accent',_selMAccentHex(def));
    card.style.setProperty('--car-glow',_selMHexToRgba(def,.45));
    const tierLbl=_SELM_TIER_LABEL[def.type]||(def.type||'').toUpperCase();
    let lockHtml='';
    if(!unlocked){
      const price=_carPrices[def.id];
      const coins=window._coins|0;
      const afford=price&&coins>=price;
      lockHtml=
        '<div class="selM-cardLock">'+
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'+
            '<rect x="3" y="11" width="18" height="11" rx="2"/>'+
            '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>'+
          '</svg>'+
        '</div>';
      var priceHtml=price?'<div class="selM-cardPrice'+(afford?' afford':'')+'">'+price+' COINS</div>':'';
    }
    card.innerHTML=
      '<div class="selM-cardBg"></div>'+
      '<div class="selM-cardCorners"></div>'+
      '<canvas class="selM-cardCanvas'+(unlocked?'':' selM-cardCanvasLocked')+'"></canvas>'+
      '<div class="selM-cardBadge">'+tierLbl+'</div>'+
      lockHtml+
      '<div class="selM-cardName">'+
        '<div class="selM-cardBrand">'+def.brand+'</div>'+
        '<div class="selM-cardModel">'+def.name.toUpperCase()+'</div>'+
        (priceHtml||'')+
      '</div>';
    // Tile-grid mode (2026-05-11): tap selects the car directly. Locked
    // cars show preview info but don't commit selCarId. Active-class
    // gets re-applied immediately for snappy feedback.
    card.addEventListener('click',()=>{
      if(card.classList.contains('selM-cardActive'))return;
      const tappedId=def.id;
      const isUnlocked=_unlockedCars.has(tappedId);
      // Update active visual on all tiles
      carousel.querySelectorAll('.selM-card').forEach(el=>{
        el.classList.toggle('selM-cardActive',el===card);
      });
      if(isUnlocked){
        _selectPreviewCar(tappedId);
        // Mirror to legacy garage list
        document.querySelectorAll('.carCard').forEach(el=>{
          el.classList.toggle('sel',el.dataset.defId==String(tappedId));
        });
      }
      _selMRenderInfo(def);
      _selMUpdateActiveName(def);
      _selMVibrate(8);
    });
    carousel.appendChild(card);
    const dot=document.createElement('div');
    dot.className='selM-dot'+(i===activeIdx?' selM-dotActive':'');
    dotsEl.appendChild(dot);
  });
  // Draw all canvases on next frame (after layout so clientWidth is real).
  requestAnimationFrame(()=>{
    carousel.querySelectorAll('.selM-cardCanvas').forEach((cvs,i)=>{
      _selMDrawCardCanvas(cvs,list[i].id);
    });
    // Scroll the active tile into view inside the grid (vertical scroll
    // now, not horizontal). scrollIntoView handles both layout modes.
    const cards=carousel.querySelectorAll('.selM-card');
    if(cards[activeIdx]){
      cards[activeIdx].scrollIntoView({behavior:'auto',block:'nearest',inline:'nearest'});
    }
  });
  // Active-name banner reflects the selected car
  _selMUpdateActiveName(list[activeIdx]);
}

// Tile-grid mode helper — pushes brand + model into the banner above
// the grid. Idempotent / null-safe so callers don't need to guard.
function _selMUpdateActiveName(def){
  const brandEl=document.getElementById('selMActiveBrand');
  const modelEl=document.getElementById('selMActiveModel');
  if(!brandEl||!modelEl||!def)return;
  brandEl.textContent=def.brand||'';
  modelEl.textContent=(def.name||'').toUpperCase();
}

// Expliciete pointer-event swipe handler op de mobile carousel-wrap.
// Reden: native CSS scroll-snap werkt niet altijd betrouwbaar op iOS
// Safari (vooral als de outer page scrollable is, dan claimt iOS de
// pointer voor page-scroll i.p.v. de carousel). Door zelf de scroll te
// drijven via `scrollBy()` op horizontale swipe-detectie omzeilen we
// dat gevecht. Native scroll blijft als fallback werken (we gebruiken
// `scrollBy`, niet `preventDefault`, dus de gebruiker kan ook nog op
// de manier van eerder swipen). Idempotent via _selMSwipeWired.
let _selMSwipeWired=false;
function _initMobileCarouselSwipe(){
  if(_selMSwipeWired)return;
  if(!window._isTouch&&!window._isMobile)return; // iPhone-only situatie
  const wrap=document.querySelector('.selM-carouselWrap');
  const carousel=document.getElementById('selMCarousel');
  if(!wrap||!carousel)return;
  // Tile-grid mode (2026-05-11): no horizontal carousel — swipe-to-snap
  // is meaningless and would fire vibration on idle swipes. Skip
  // wiring entirely. Detected via the active-name banner that only
  // exists in grid markup.
  if(document.getElementById('selMActiveBrand'))return;
  _selMSwipeWired=true;
  const TH_X=35, MAX_Y=30; // iets lager dan legacy threshold (45) want
                            // de carousel-cards zijn smaller dan de
                            // legacy preview, korte swipes voelen
                            // natuurlijker.
  let startX=0,startY=0,active=false,pointerId=-1;
  function down(e){
    if(!e.isPrimary)return;
    active=true;pointerId=e.pointerId;
    startX=e.clientX;startY=e.clientY;
  }
  function up(e){
    if(!active||e.pointerId!==pointerId)return;
    active=false;
    const dx=e.clientX-startX,dy=e.clientY-startY;
    if(Math.abs(dx)<TH_X||Math.abs(dy)>MAX_Y)return;
    // Bepaal cardWidth + gap dynamisch (260+14 default, maar respecteer
    // computed style voor robuustheid bij CSS-aanpassing).
    const card=carousel.querySelector('.selM-card');
    if(!card)return;
    const step=card.clientWidth+12; // gap is 12px in CSS
    const dir=dx<0?+1:-1; // swipe-left → next card (iOS-conventie)
    carousel.scrollBy({left:dir*step,behavior:'smooth'});
    _selMVibrate(8);
  }
  function cancel(){active=false;}
  // passive:true zodat verticale page-scroll niet wordt geblokkeerd.
  wrap.addEventListener('pointerdown',down,{passive:true});
  wrap.addEventListener('pointerup',up,{passive:true});
  wrap.addEventListener('pointercancel',cancel,{passive:true});
  wrap.addEventListener('pointerleave',cancel,{passive:true});
}

// One-time scroll listener — debounced, finds the centered card and
// updates state via _selMSetActiveDef. We re-bind as needed because
// _selMRenderCarousel rebuilds carousel children on tier change but
// the carousel container itself is stable.
function _selMWireScroll(){
  if(_selMScrollWired)return;
  const carousel=document.getElementById('selMCarousel');
  if(!carousel)return;
  _selMScrollWired=true;
  carousel.addEventListener('scroll',()=>{
    if(_selMScrollTimer)clearTimeout(_selMScrollTimer);
    _selMScrollTimer=setTimeout(()=>{
      const cards=carousel.querySelectorAll('.selM-card');
      if(!cards.length)return;
      const center=carousel.scrollLeft+carousel.clientWidth/2;
      let closest=0,closestDist=Infinity;
      cards.forEach((c,i)=>{
        const cc=c.offsetLeft+c.clientWidth/2;
        const dist=Math.abs(cc-center);
        if(dist<closestDist){closestDist=dist;closest=i;}
      });
      const list=_selMFilteredCars();
      const def=list[closest];if(!def)return;
      const prevId=selCarId;
      // Update visual classes immediately for snappy feedback.
      cards.forEach((c,i)=>c.classList.toggle('selM-cardActive',i===closest));
      document.querySelectorAll('.selM-dot').forEach((d,i)=>d.classList.toggle('selM-dotActive',i===closest));
      // Locked cars are visible but stay non-selectable — preview
      // updates anyway so users see what they're working towards.
      if(def.id!==prevId){
        if(_unlockedCars.has(def.id)){
          // Sync with desktop selection logic: drives stats, snapshot, etc.
          _selectPreviewCar(def.id);
          // Mirror selection to legacy garage list visual state.
          document.querySelectorAll('.carCard').forEach(el=>{
            el.classList.toggle('sel',el.dataset.defId==String(def.id));
          });
        }else{
          // Locked — show preview info but don't commit selection.
          _selMRenderInfo(def);
        }
        _selMRenderInfo(def);
        _selMVibrate(8);
      }
    },70);
  });
}

// Render stats strip (POWER / TOP SPEED / 0-100) and bottom summary.
// Stats are derived from the same fields as the desktop prevSpecs line:
// hp = topSpd * 820, topKmh = topSpd * 255, accel = 1/accel rough seconds.
function _selMRenderInfo(def){
  if(!def)return;
  const hp=Math.round(def.topSpd*820);
  const topKmh=Math.round(def.topSpd*255);
  // 0-100 seconds — accel field is a per-frame increment (~.017–.026).
  // Map to a feel-correct seconds value: slower-accel cars get ~3.5s,
  // faster ones ~1.8s. Linear scale based on observed range.
  const sec=Math.max(1.6,Math.min(4.5,5.5 - def.accel*150));
  const stats=document.getElementById('selMStats');
  if(stats){
    stats.innerHTML=
      '<div class="selM-stat">'+
        '<div class="selM-statLbl">POWER</div>'+
        '<div class="selM-statVal">'+hp+'<span class="selM-statUnit">HP</span></div>'+
        '<div class="selM-statBar"><div class="selM-statBarFill" style="width:'+Math.min(100,hp/11)+'%"></div></div>'+
      '</div>'+
      '<div class="selM-stat">'+
        '<div class="selM-statLbl">TOP SPEED</div>'+
        '<div class="selM-statVal">'+topKmh+'<span class="selM-statUnit">KM/H</span></div>'+
        '<div class="selM-statBar"><div class="selM-statBarFill" style="width:'+Math.min(100,topKmh/3.8)+'%"></div></div>'+
      '</div>'+
      '<div class="selM-stat">'+
        '<div class="selM-statLbl">0—100</div>'+
        '<div class="selM-statVal">'+sec.toFixed(1)+'<span class="selM-statUnit">S</span></div>'+
        '<div class="selM-statBar"><div class="selM-statBarFill" style="width:'+Math.max(20,100-sec*22)+'%"></div></div>'+
      '</div>';
  }
  _selMRenderSummary(def);
}

function _selMRenderSummary(def){
  const el=document.getElementById('selMSummary');
  if(!el)return;
  if(!def)def=CAR_DEFS.find(d=>d.id===selCarId)||CAR_DEFS[0];
  const dNames=['EASY','NORMAL','HARD'];
  el.innerHTML=
    '<span>'+def.brand+' '+def.name.toUpperCase()+'</span>'+
    '<span class="selM-sep">·</span>'+
    '<span>'+_selectedLaps+' LAPS</span>'+
    '<span class="selM-sep">·</span>'+
    '<span>'+dNames[difficulty]+'</span>';
}

function _selMRenderHeader(){
  const u=_unlockedCars.size,t=(window.CAR_DEFS||[]).length;
  const coinsEl=document.getElementById('selMCoins');
  if(coinsEl)coinsEl.textContent=((window._coins|0)).toLocaleString('en');
  const unEl=document.getElementById('selMUnlocked');
  if(unEl)unEl.textContent=u+' / '+t;
  const fill=document.getElementById('selMProgFill');
  if(fill)fill.style.width=(t>0?(u/t)*100:0)+'%';
  const tNameEl=document.getElementById('selMTrackName');
  const tEmojiEl=document.getElementById('selMTrackEmoji');
  if(tNameEl)tNameEl.textContent=_SELM_WORLD_NAMES[activeWorld]||activeWorld.toUpperCase();
  if(tEmojiEl)tEmojiEl.textContent=_SELM_WORLD_ICONS[activeWorld]||'⬢';
}

function _selMSyncTabs(){
  document.querySelectorAll('#selMTabs .selM-tab').forEach(t=>{
    t.classList.toggle('selM-tabActive',t.dataset.tier===_activeTier);
  });
}
function _selMSyncChips(){
  document.querySelectorAll('#selMLaps .selM-chip').forEach(c=>{
    c.classList.toggle('selM-chipActive',+c.dataset.val===+_selectedLaps);
  });
  document.querySelectorAll('#selMDiff .selM-chip').forEach(c=>{
    c.classList.toggle('selM-chipActive',+c.dataset.val===+difficulty);
  });
}

let _selMWired=false;
function _selMWireOnce(){
  if(_selMWired)return;
  _selMWired=true;
  const back=document.getElementById('selMBack');
  if(back)back.addEventListener('click',()=>{
    _selMVibrate(8);
    if(typeof goToWorldSelect==='function')goToWorldSelect();
  });
  const track=document.getElementById('selMTrack');
  if(track)track.addEventListener('click',()=>{
    _selMVibrate(8);
    if(typeof goToWorldSelect==='function')goToWorldSelect();
  });
  const race=document.getElementById('selMRace');
  if(race)race.addEventListener('click',()=>{
    // Block race start when the visually-active card is a locked car.
    // Keeps the summary/preview consistent with the carousel center
    // without committing selCarId to a locked def.
    const activeCard=document.querySelector('.selM-card.selM-cardActive');
    if(activeCard&&activeCard.classList.contains('selM-cardLocked')){
      _selMVibrate(20);
      const id=+activeCard.dataset.defId;
      const hint=(typeof _unlockHints!=='undefined'&&_unlockHints[id])||'complete challenges';
      if(typeof showPopup==='function')showPopup('🔒 LOCKED — '+hint,'#ff6644',1800);
      return;
    }
    _selMVibrate(15);
    if(window.perfMark)perfMark('goToRace:click');
    if(typeof goToRace==='function')goToRace();
  });
  // Tier tabs — share _activeTier with desktop garage list.
  document.querySelectorAll('#selMTabs .selM-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      _activeTier=tab.dataset.tier;
      _selMSyncTabs();
      // Keep desktop tabs visually in sync too in case user rotates.
      document.querySelectorAll('.tierTab').forEach(t=>t.classList.toggle('tierTabSel',t.dataset.tier===_activeTier));
      _renderGarageList();
      _selMRenderCarousel();
      const def=CAR_DEFS.find(d=>d.id===selCarId);
      if(def)_selMRenderInfo(def);
      _selMVibrate(8);
    });
  });
  // LAPS chips
  document.querySelectorAll('#selMLaps .selM-chip').forEach(chip=>{
    chip.addEventListener('click',()=>{
      const n=+chip.dataset.val;
      _selectedLaps=n;TOTAL_LAPS=n;
      try{localStorage.setItem('src_lap',n);}catch(e){}
      // Mirror to desktop segmented control.
      [1,3,5].forEach(m=>{const b=document.getElementById('lap'+m);if(b)b.classList.toggle('setOptSel',m===n);});
      _selMSyncChips();
      _selMRenderSummary();
      _updateSelectSummary();
      _selMVibrate(8);
    });
  });
  // DIFF chips
  document.querySelectorAll('#selMDiff .selM-chip').forEach(chip=>{
    chip.addEventListener('click',()=>{
      const i=+chip.dataset.val;
      difficulty=i;
      try{localStorage.setItem('src_difficulty',i);}catch(e){}
      // Mirror to desktop segmented control.
      ['dEasy','dNorm','dHard'].forEach((id,j)=>{
        const e=document.getElementById(id);if(!e)return;
        e.classList.toggle('setOptSel',j===i);
        e.classList.toggle('diffSel',j===i);
      });
      _selMSyncChips();
      if(typeof _renderRival==='function')_renderRival();
      _selMRenderSummary();
      _updateSelectSummary();
      _selMVibrate(8);
    });
  });
}

function _buildMobileSelect(){
  if(!document.querySelector('.selMobile'))return;
  _selMWireOnce();
  _selMRenderHeader();
  _selMSyncTabs();
  _selMSyncChips();
  _selMRenderCarousel();
  // Expliciete swipe-handler bovenop de native scroll-snap; nodig op
  // iOS Safari waar page-vertical-scroll soms de carousel-horizontal
  // pointer-events steelt.
  _initMobileCarouselSwipe();
  const def=CAR_DEFS.find(d=>d.id===selCarId)||CAR_DEFS[0];
  if(def)_selMRenderInfo(def);
}
window._buildMobileSelect=_buildMobileSelect;

// Redraw card canvases + recenter the active card on viewport changes.
// Necessary because clientWidth changes between portrait/landscape and
// canvas backing-store needs re-DPR'ing.
let _selMResizeRaf=0;
function _selMHandleResize(){
  if(_selMResizeRaf)return;
  _selMResizeRaf=requestAnimationFrame(()=>{
    _selMResizeRaf=0;
    const carousel=document.getElementById('selMCarousel');
    if(!carousel||!carousel.clientWidth)return;
    const list=_selMFilteredCars();
    const cards=carousel.querySelectorAll('.selM-card');
    cards.forEach((c,i)=>{
      const cvs=c.querySelector('.selM-cardCanvas');
      if(cvs&&list[i])_selMDrawCardCanvas(cvs,list[i].id);
    });
    const idx=list.findIndex(d=>d.id===selCarId);
    if(idx>=0&&cards[idx]){
      const c=cards[idx];
      const target=c.offsetLeft+c.clientWidth/2-carousel.clientWidth/2;
      carousel.scrollTo({left:target,behavior:'auto'});
    }
  });
}
window.addEventListener('resize',_selMHandleResize);
window.addEventListener('orientationchange',()=>{
  setTimeout(_selMHandleResize,250);
});
