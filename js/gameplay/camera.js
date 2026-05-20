// js/gameplay/camera.js — non-module script.

'use strict';

// Pre-allocated scratch vectors (uit main.js verhuisd) — cross-script
// zichtbaar voor effects/night.js + visuals.js die _camV1/_camV2 lezen.
const _camV1=new THREE.Vector3(),_camV2=new THREE.Vector3();
// Yaw-only frame voor chase- en intro-cam: camera mag NOOIT de body-roll
// (rotation.z tot ±0.26 rad uit physics.js:187-193) of ramp-pitch
// (rotation.x=-0.22 uit ramps.js:278) van de auto erven — anders kantelt de
// wereld mee tijdens het sturen. YXZ-order zodat .y direct overgenomen wordt
// zonder gimbal-edge cases.
const _camYawQuat=new THREE.Quaternion();
const _camYawEuler=new THREE.Euler(0,0,0,'YXZ');
// Banking state — apply as quaternion-multiply, NOT as camera.rotation.z
// assignment. Writing to camera.rotation triggers Three.js to rebuild the
// quaternion from Euler(x,y,z) in XYZ-order; the post-lookAt quaternion has
// a non-canonical XYZ decomposition (z component can be ~-2.3 rad even when
// the camera is upright) and rebuilding with z=0 produces a DIFFERENT
// orientation (camera flips ~130° on the COUNTDOWN→RACE handoff).
let _camBankZ=0;
const _camBankQuat=new THREE.Quaternion();
const _camBankAxis=new THREE.Vector3(0,0,1);

// Mirror state (uit main.js verhuisd). mirrorCamera wordt gevuld in
// core/scene.js buildScene(); _mirrorEnabled toggleable via input.js (M-key).
// updateMirror() onder in dit bestand gebruikt beide.
let mirrorCamera=null;
let _mirrorEnabled=true;

// Camera animation/state (uit main.js verhuisd):
//   camShake        — collision shake amplitude (decays in updateCamera)
//   _camView        — 0=Chase 1=Helicopter 2=Hood 3=Bumper (input.js: V-key)
//   _camLateralT    — corner pan accumulator
//   _victoryOrbit   — cinematic orbit na finish (set in finish.js)
//   _titleCamT      — title-screen rotation phase
//   _introActive    — cinematic countdown-camera enabled (B1, set by
//                     navigation.js when entering COUNTDOWN, cleared on GO)
//   _introStartT    — _nowSec when intro began (for elapsed time calc)
//   _introDuration  — total cinematic-pan duration; matches countdown
//                     timing (~4.3s) so we end exactly at race-cam on GO
let camShake=0;
let _camView=0;
let _camLateralT=0;
let _victoryOrbit=false;
let _titleCamT=0;
let _introActive=false;
let _introStartT=0;
const _introDuration=4.3;

// updateIntroCamera — cinematic countdown camera (B1). Single-Bezier
// sweep van high overhead + behind grid → standard chase-cam position
// over _introDuration seconds. Smoothstep easing. Eindigt EXACT op
// chase-position op GO zodat de overgang naar updateCamera() geen
// jolt vertoont. Wereld-agnostisch — alle offsets car-relative.
//
// Aangeroepen vanuit core/loop.js wanneer gameState==='COUNTDOWN'.
// navigation.js initialiseert _introActive=true + _introStartT=_nowSec.
// On GO callback: _introActive=false zodat updateCamera() weer de
// chase-cam path neemt.
function updateIntroCamera(dt){
  if(!_introActive)return;
  const car=carObjs[playerIdx];if(!car)return;
  const elapsed=_nowSec-_introStartT;
  let t=Math.min(1,elapsed/_introDuration);
  // Smoothstep ease — 3t²-2t³ — slow at edges, fast in middle.
  const e=t*t*(3-2*t);

  // Start: high above + behind the grid (car-local offset (0, 35, 25)).
  // End: chase-cam offset (0, 5.8, 13.5). Both rotated by car quaternion.
  const startY=35, startZ=25;
  const endY=5.8, endZ=13.5;
  const oy=startY+(endY-startY)*e;
  const oz=startZ+(endZ-startZ)*e;
  // Yaw-only — zie scratch-comment bij _camYawQuat declaratie.
  _camYawEuler.set(0,car.mesh.rotation.y,0);
  _camYawQuat.setFromEuler(_camYawEuler);
  _camV1.set(0,oy,oz).applyQuaternion(_camYawQuat);
  _camV2.copy(car.mesh.position).add(_camV1);
  camera.position.copy(_camV2);
  // Persist into the global camPos so updateCamera's first frame after
  // GO sees a continuous starting state (no "where's the camera now?"
  // surprise that triggers a jolt-lerp).
  camPos.copy(_camV2);

  // LookAt: starts at "just ahead of car, slightly above hood" — gives
  // the dramatic "looking down at the grid" feel from the high start.
  // Ends at chase-cam target (just ahead, at chest height).
  const startTgtY=2, startTgtZ=-2;
  const endTgtY=0.8, endTgtZ=-7;
  const ty=startTgtY+(endTgtY-startTgtY)*e;
  const tz=startTgtZ+(endTgtZ-startTgtZ)*e;
  _camV1.set(0,ty,tz).applyQuaternion(_camYawQuat);
  _camV2.copy(car.mesh.position).add(_camV1);
  camera.lookAt(_camV2);
  camTgt.copy(_camV2);

  // FOV ramp: 80° (wide cinematic) → 62° (race default) over the sweep.
  const fov=80-(80-62)*e;
  camera.fov+=(fov-camera.fov)*Math.min(1,dt*3);
  camera.updateProjectionMatrix();
}

// Called from navigation.js at COUNTDOWN entry to start the intro.
function startIntroCamera(){
  _introActive=true;
  _introStartT=(typeof _nowSec!=='undefined')?_nowSec:performance.now()/1000;
}
// Called from countdown.js onGo callback. updateCamera() takes over.
function endIntroCamera(){
  _introActive=false;
}
if(typeof window!=='undefined'){
  window.startIntroCamera=startIntroCamera;
  window.endIntroCamera=endIntroCamera;
  window.updateIntroCamera=updateIntroCamera;
}

function updateCamera(dt){
  const car=carObjs[playerIdx];if(!car)return;
  // Victory orbit: cinematic rotation around player car after finishing
  if(_victoryOrbit){
    const angle=_nowSec*.38,r=17,h=8;
    camera.position.set(
      car.mesh.position.x+Math.cos(angle)*r,
      car.mesh.position.y+h,
      car.mesh.position.z+Math.sin(angle)*r);
    camera.lookAt(car.mesh.position.x,car.mesh.position.y+.8,car.mesh.position.z);
    camera.fov+=(62-camera.fov)*Math.min(1,dt*2);camera.updateProjectionMatrix();
    return;
  }
  // (Pre-B1 there was an _introPanTimer block here that handled a 3s
  // post-GO blend from the wonky front-of-car countdown framing to
  // chase-cam. B1 replaced that entire flow with a dedicated
  // updateIntroCamera() running during gameState==='COUNTDOWN', which
  // lands EXACTLY on chase-cam at GO so no post-GO blend is needed.
  // The block + _introPanTimer state are removed here as dead code.)

  if(_camView===1){
    // ── Helicopter / TV cam — high wide shot following car
    const angle=_nowSec*.08;
    const r=44,h=32;
    const tx=car.mesh.position.x,tz=car.mesh.position.z;
    camera.position.set(tx+Math.cos(angle)*r,car.mesh.position.y+h,tz+Math.sin(angle)*r);
    camera.lookAt(tx,car.mesh.position.y+.5,tz);
    camera.fov+=(72-camera.fov)*Math.min(1,dt*2);camera.updateProjectionMatrix();
    return;
  }
  if(_camView===2){
    // ── Hood cam — low, just above windscreen
    _camV1.set(0,.92,-0.4).applyQuaternion(car.mesh.quaternion);
    camera.position.copy(car.mesh.position).add(_camV1);
    _camV2.set(0,.88,-8).applyQuaternion(car.mesh.quaternion);
    _camV2.add(car.mesh.position);
    camera.lookAt(_camV2);
    camera.fov+=(70-camera.fov)*Math.min(1,dt*4);camera.updateProjectionMatrix();
    return;
  }
  if(_camView===3){
    // ── Bumper cam — very low, front nose
    _camV1.set(0,.26,-1.45).applyQuaternion(car.mesh.quaternion);
    camera.position.copy(car.mesh.position).add(_camV1);
    _camV2.set(0,.24,-12).applyQuaternion(car.mesh.quaternion);
    _camV2.add(car.mesh.position);
    camera.lookAt(_camV2);
    camera.fov+=(82-camera.fov)*Math.min(1,dt*4);camera.updateProjectionMatrix();
    return;
  }

  // ── Chase cam (default, _camView===0) ──────────────────
  // Mobile uses the SAME camera offset as desktop so the car has the same size/position on screen.
  // Screen-size adaptation happens via HFOV/VFOV only (zie baseFov hieronder).
  // In portrait wordt de offset iets dichterbij gezet zodat de auto niet verloren raakt
  // in een verticale frame met smal blikveld.
  const _portrait=(camera.aspect||(innerWidth/innerHeight))<1;
  // Yaw-only quaternion — chase-cam mag de carrosserie-roll en ramp-pitch
  // van de auto niet erven (zie comment bij _camYawQuat declaratie). De
  // bestaande ±0.7° cinematic camera-bank verderop (regel ~187) blijft.
  _camYawEuler.set(0,car.mesh.rotation.y,0);
  _camYawQuat.setFromEuler(_camYawEuler);
  if(_portrait)_camV1.set(0,4.6,10.5);
  else _camV1.set(0,5.8,13.5);
  _camV1.applyQuaternion(_camYawQuat);
  _camV2.copy(car.mesh.position).add(_camV1);
  camPos.lerp(_camV2,Math.min(1,dt*7));
  // Corner look-ahead: shift look TARGET subtly toward turn direction — no body sway
  const _steerInp=(keys['ArrowRight']||keys['KeyD'])?1:(keys['ArrowLeft']||keys['KeyA'])?-1:0;
  _camLateralT+=(_steerInp*1.4-_camLateralT)*Math.min(1,dt*1.6);
  _camV1.set(0,.8,-7).applyQuaternion(_camYawQuat);
  _camV2.copy(car.mesh.position).add(_camV1);
  camTgt.lerp(_camV2,Math.min(1,dt*9));
  // Shift only the look target (camera stays put) — subtle corner peek, not disorienting
  _camV1.set(1,0,0).applyQuaternion(_camYawQuat);
  camTgt.addScaledVector(_camV1,_camLateralT);
  let px=camPos.x,py=camPos.y,pz=camPos.z;
  if(camShake>0){const s=camShake*.5;px+=(Math.random()-.5)*s;py+=(Math.random()-.5)*s*.4;pz+=(Math.random()-.5)*s;camShake=Math.max(0,camShake-dt*2.5);}
    if(_comboTimer>0){_comboTimer-=dt;if(_comboTimer<=0)resetCombo();}
  camera.position.set(px,Math.max(.5,py),pz);camera.lookAt(camTgt);
  // Phase 6.3 — subtle z-axis banking on high-speed turns. APPLIED VIA
  // QUATERNION-MULTIPLY, not via camera.rotation.z assignment: see the
  // comment at the _camBankZ declaration for the gimbal-lock-decomposition
  // trap that caused the world to flip ~130° on the COUNTDOWN→RACE handoff.
  const _bankSpd=Math.min(1,Math.abs(car.speed)/(car.def.topSpd||1.8));
  // Hotfix Phase 9.5 — magnitude 0.012 (±0.7°), gate vanaf 88% top-speed,
  // snel decay (rate 12) bij idle steer, hard clamp tegen dt-spike.
  const _bankGate = Math.max(0, (_bankSpd - 0.88) / 0.12);
  const _bankTarget = _steerInp * _bankGate * 0.012;
  const _bankRate = Math.abs(_steerInp) < 0.1 ? 12 : 6;
  _camBankZ += (_bankTarget - _camBankZ) * Math.min(1, dt * _bankRate);
  if(!isFinite(_camBankZ) || Math.abs(_camBankZ) > 0.5) _camBankZ = 0;
  if(_camBankZ > 0.02) _camBankZ = 0.02;
  else if(_camBankZ < -0.02) _camBankZ = -0.02;
  if(_camBankZ !== 0){
    _camBankQuat.setFromAxisAngle(_camBankAxis, _camBankZ);
    camera.quaternion.multiply(_camBankQuat);
  }
  // Cinematic speed-shake — applied AFTER position+lookAt so the shake
  // is a final cinematic micro-jitter on top of the smoothed framing.
  // Activated per-world via enableCinematicCameraShake() in the world
  // builder (no-op if no world has registered shake config).
  if(typeof applyCinematicCameraShake==='function'
     && window._cinemaState && window._cinemaState.cameraShake){
    const _spdR=Math.min(1,Math.abs(car.speed)/(car.def.topSpd||1.8));
    applyCinematicCameraShake(camera, _spdR, window._cinemaState.cameraShake);
  }
  // Dynamic FOV — wider at high speed for sense of velocity, more extreme on nitro.
  // Landscape: derive vertical FOV from a constant horizontal FOV zodat de framing
  // hetzelfde voelt op desktop 16:9, phone 19:9, iPad 1.71 en iPad 4:3.
  // Portrait (aspect<1): die HFOV-formule blaast VFOV op tot 130°+ waardoor alles weg-zoomt.
  // Daarom in portrait een vaste verticale FOV gebruiken — phones iets ruimer dan tablets.
  const _asp=camera.aspect||(innerWidth/innerHeight);
  let baseFov;
  if(_asp<1){
    baseFov=window._isMobile?72:68;
  }else{
    const TARGET_HFOV_DEG=window._isMobile?96:92;
    baseFov=2*Math.atan(Math.tan(TARGET_HFOV_DEG*Math.PI/360)/_asp)*180/Math.PI;
  }
  // Sterker FOV-kick bij boost/nitro voor "speed punch" gevoel — bloom maakt
  // emissive props feller, dus de wider-FOV-pulse landt visueel zichtbaarder.
  // In portrait worden de kickers gehalveerd zodat de totaal-FOV niet alsnog boven ~95° komt
  // en het beeld z'n cinematic framing behoudt.
  const _kickScale=_portrait?0.5:1;
  // Phase R2.5 — boost-pad punch: extra FOV-kick die exponentieel decayt
  // over 400ms zodat de pickup-moment cinematisch leesbaar is.
  let _punchKick = 0;
  if(window._boostPunchTimer > 0){
    window._boostPunchTimer = Math.max(0, window._boostPunchTimer - dt);
    _punchKick = (window._boostPunchTimer / 0.40) * 8 * _kickScale; // max +8°
  }
  // Phase R2.7 — finish-line FOV punch: extra +6° die over 700ms decayt.
  // Stapelt bovenop boost-pad punch, blijft cinematisch leesbaar.
  if(window._finishFovKick > 0){
    _punchKick += window._finishFovKick * 6 * _kickScale;
    window._finishFovKick = Math.max(0, window._finishFovKick - dt / 0.70);
  }
  const tFov=baseFov+(Math.abs(car.speed)/car.def.topSpd*22+(nitroActive?20:0)+(car.boostTimer>0?10:0))*_kickScale+_punchKick;
  // FOV reageert sneller wanneer boost net start (high-pass via dt*5 ipv 3.5)
  const fovRate=(nitroActive||car.boostTimer>0||_punchKick>0.5)?5.0:3.0;
  camera.fov+=(tFov-camera.fov)*Math.min(1,dt*fovRate);
  camera.updateProjectionMatrix();
}


function setCamView(n){
  _camView=n;
  const names=['CHASE CAM','HELI CAM','HOOD CAM','BUMPER CAM'];
  showPopup(names[n],'#88ddff',900);
  // Highlight active button via .active class — styling lives in screens.css
  // alongside the rest of the pause-overlay CSS so the gradient/glow stays
  // consistent with the redesigned pause palette.
  for(let i=0;i<4;i++){
    const b=document.getElementById('pcam'+i);
    if(b)b.classList.toggle('active',i===n);
  }
}


// Mirror state: cached DOM refs + projection-matrix sentinel so updateMirror
// (every-frame chase-cam pass) doesn't getElementById twice nor recompute
// the same projection matrix per frame.
//
// Mirror is rendered into _mirrorRT (offscreen) and blitted to the small
// <canvas id="mirrorCanvas"> via readRenderTargetPixels + putImageData.
// Previously updateMirror used setScissor + render directly on the main
// glCanvas, which on frame-skipped frames (window._qFlags.mirrorFrameSkip>0)
// left the canvas-strip showing forward-cam content — read as flicker.
// With its own RT + 2D canvas, skipped frames simply keep the previous
// putImageData on the canvas — no flicker.
let _mfEl=null,_mlEl=null,_mfDisplay='',_mlDisplay='';
// Track the mirrorCamera reference rather than a boolean — scene.js
// re-creates mirrorCamera on every buildScene() so a sticky boolean would
// skip updateProjectionMatrix on the new camera and leave it with whatever
// aspect THREE.PerspectiveCamera's constructor put there.
let _mirrorAspectInitFor=null;
// Two views on one ArrayBuffer: _mirrorPixelBuf (Uint8Array) is the readPixels
// target — gl.readPixels with UNSIGNED_BYTE strictly requires Uint8Array on
// some drivers. _mirrorImageData wraps a Uint8ClampedArray view of the same
// memory so putImageData sees the just-written pixels with zero copy.
let _mirrorRT=null,_mirrorPixelBuf=null,_mirrorImageData=null,_mirrorCtx2D=null;
const _MIRROR_W=204,_MIRROR_H=82;

function _initMirrorRT(){
  if(_mirrorRT)return;
  _mirrorRT=new THREE.WebGLRenderTarget(_MIRROR_W,_MIRROR_H,{
    minFilter:THREE.LinearFilter,
    magFilter:THREE.LinearFilter,
    format:THREE.RGBAFormat,
    type:THREE.UnsignedByteType,
    depthBuffer:true,
    stencilBuffer:false
  });
  const _ab=new ArrayBuffer(_MIRROR_W*_MIRROR_H*4);
  _mirrorPixelBuf=new Uint8Array(_ab);
  _mirrorImageData=new ImageData(new Uint8ClampedArray(_ab),_MIRROR_W,_MIRROR_H);
  const cvs=document.getElementById('mirrorCanvas');
  if(cvs){
    cvs.width=_MIRROR_W;cvs.height=_MIRROR_H;
    _mirrorCtx2D=cvs.getContext('2d');
  }
}

function updateMirror(){
  const car=carObjs[playerIdx];
  if(!car||!mirrorCamera||!_mirrorEnabled||_camView!==0)return;
  if(!_mfEl)_mfEl=document.getElementById('mirrorFrame');
  if(!_mlEl)_mlEl=document.getElementById('mirrorLabel');
  // Hide mirror during the countdown so it doesn't clash with the start lights overlay
  if(gameState==='COUNTDOWN'){
    if(_mfEl&&_mfDisplay!=='none'){_mfDisplay='none';_mfEl.style.display='none';}
    if(_mlEl&&_mlDisplay!=='none'){_mlDisplay='none';_mlEl.style.display='none';}
    return;
  }
  if(_mfEl&&_mfDisplay!=='block'){_mfDisplay='block';_mfEl.style.display='block';}
  if(_mlEl&&_mlDisplay!=='block'){_mlDisplay='block';_mlEl.style.display='block';}

  // Position mirror camera inside car cabin looking backward
  const fwd=_camV1.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
  mirrorCamera.position.copy(car.mesh.position)
    .addScaledVector(fwd,-0.5);
  mirrorCamera.position.y+=0.75;
  // Look in the forward direction (mirror = see what's behind you)
  mirrorCamera.rotation.copy(car.mesh.rotation);
  mirrorCamera.rotation.y+=Math.PI; // face backward

  _initMirrorRT();
  if(!_mirrorRT||!_mirrorCtx2D)return;

  // Aspect is constant (204/82). Compute once per mirrorCamera instance.
  if(_mirrorAspectInitFor!==mirrorCamera){
    mirrorCamera.aspect=_MIRROR_W/_MIRROR_H;mirrorCamera.updateProjectionMatrix();
    _mirrorAspectInitFor=mirrorCamera;
  }

  // Render scene into _mirrorRT — completely isolated from main canvas.
  const prevTarget=renderer.getRenderTarget();
  const prevScissorTest=renderer.getScissorTest();
  renderer.setRenderTarget(_mirrorRT);
  renderer.setScissorTest(false);
  renderer.clear(true,true,false);
  renderer.render(scene,mirrorCamera);
  // Read back the rendered pixels. Bottom-up rows; CSS scaleY(-1) on
  // #mirrorCanvas does the flip at display-time so no JS row-copy needed.
  // 204×82×4 = 66KB — single readPixels call, ~0.2-0.8ms on desktop.
  renderer.readRenderTargetPixels(_mirrorRT,0,0,_MIRROR_W,_MIRROR_H,_mirrorPixelBuf);
  renderer.setRenderTarget(prevTarget);
  renderer.setScissorTest(prevScissorTest);

  // Blit to the visible 2D canvas. Skipped frames (frame-skip cadence in
  // loop.js) simply leave this canvas untouched — image stays valid until
  // the next render, no forward-cam bleed-through.
  _mirrorCtx2D.putImageData(_mirrorImageData,0,0);
}

// Expose disposer for _resetRaceState — RTs survive world rebuilds otherwise
// (the renderer holds them until GPU context loss). One RT × ~66KB is cheap
// but disposing on title-screen keeps memory profile clean.
function _disposeMirrorRT(){
  if(_mirrorRT){_mirrorRT.dispose();_mirrorRT=null;}
  _mirrorPixelBuf=null;_mirrorImageData=null;_mirrorCtx2D=null;
  _mirrorAspectInitFor=null;
}
if(typeof window!=='undefined')window._disposeMirrorRT=_disposeMirrorRT;

