// js/core/renderer.js — Three.js WebGL renderer setup + context-loss recovery.
// Non-module script (zoals de andere js/core modules). Wordt geladen vóór main.js.
//
// Deze functie verwacht dat `renderer`, `scene`, `camera`, `_ctxLost`,
// `_ctxLostReloadTimer`, `audioCtx`, `activeWorld` en `buildScene`
// beschikbaar zijn als script-globals vanuit main.js of eerder geladen scripts.

'use strict';

function initRenderer(){
  const _mob=('ontouchstart' in window||navigator.maxTouchPoints>0)&&window.innerWidth<768;
  window._isMobile=_mob;
  // Tier-based quality picks (dpr cap, antialias, shadow type/size, postFX,
  // mirror, reflection-probe interval, etc.). Must run BEFORE WebGLRenderer
  // is constructed because antialias is a one-shot context flag.
  if(typeof _initQualityTier==='function') _initQualityTier(_mob);
  const _qf = window._qFlags || {antialias:!_mob};
  const canvas=document.getElementById('glCanvas');
  let lastError;
  // preserveDrawingBuffer used to default ON for canvas.toDataURL() in
  // ui/pause.js. That cost ~15-25% GPU-time on desktop in every world
  // because drivers cannot use the fast swap-buffer path. takeScreenshot
  // now does a synchronous renderer.render() immediately before
  // toDataURL() in the same JS tick, which gives correct pixels on all
  // modern browsers without the always-on perf hit.
  // antialias hier ALTIJD aan: MSAA-x4 op WebGL-context kost <1ms op moderne
  // desktop-GPU's en is het grootste enkele middel tegen "pixelig/chaos" voor
  // low/mid tier op desktop. _qf.antialias drijft nog steeds FXAA-in-composite
  // voor extra polish op high. Mobile-pixelbudget wordt al beschermd door de
  // dpr=2 cap (regel ~88) — MSAA bovenop is daar effectief gratis.
  try{renderer=new THREE.WebGLRenderer({canvas,antialias:true});}
  catch(e){lastError=e;renderer=null;}
  if(!renderer)try{renderer=new THREE.WebGLRenderer({canvas,antialias:false});}
  catch(e){lastError=e;renderer=null;}
  if(!renderer)throw new Error('WebGL mislukt: '+lastError?.message);
  // WebGL context-loss recovery: pause render loop, show overlay with user-
  // tikbare reload-knop. Geen automatische location.reload meer — die was de
  // primaire silent-to-title vector op iOS (na 6s timeout zat de user
  // ineens op title zonder feedback). Phase 1 bevinding 1.2 / 1.3 pad B.
  // Na een grace-window verschijnt de reload-knop; daarvoor laten we de
  // restore-handler de scene proberen te rebuilden.
  const CTX_LOSS_OFFER_RELOAD_MS=6000;
  canvas.addEventListener('webglcontextlost',e=>{
    e.preventDefault();
    _ctxLost=true;
    if(window.Breadcrumb)Breadcrumb.push('webglcontextlost');
    window.dbg&&dbg.warn('renderer','webglcontextlost — pauzeren, reload-knop verschijnt na '+CTX_LOSS_OFFER_RELOAD_MS+'ms');
    const ov=document.getElementById('ctxLostOverlay');if(ov)ov.style.display='flex';
    if(audioCtx&&audioCtx.state==='running')audioCtx.suspend().catch(()=>{});
    // Show the manual reload button after a grace window so the user has an
    // explicit recovery action when the browser doesn't fire 'restored'.
    _ctxLostReloadTimer=setTimeout(()=>{
      if(!_ctxLost)return;
      const btn=document.getElementById('ctxLostReload');
      if(btn)btn.style.display='inline-block';
      const msg=document.getElementById('ctxLostMsg');
      if(msg)msg.textContent='Het herstel duurt langer dan verwacht. Tik op de knop om de pagina opnieuw te laden.';
    },CTX_LOSS_OFFER_RELOAD_MS);
  });
  canvas.addEventListener('webglcontextrestored',async()=>{
    window.dbg&&dbg.log('renderer','webglcontextrestored — scene rebuild');
    if(window.Breadcrumb)Breadcrumb.push('webglcontextrestored');
    if(_ctxLostReloadTimer){clearTimeout(_ctxLostReloadTimer);_ctxLostReloadTimer=null;}
    _ctxLost=false;
    const ov=document.getElementById('ctxLostOverlay');if(ov)ov.style.display='none';
    const btn=document.getElementById('ctxLostReload');if(btn)btn.style.display='none';
    if(audioCtx&&audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
    // Restore-rebuild kan zelf throwen (texture upload OOM op iOS). Toon dan
    // de overlay opnieuw mét reload-knop ipv silent location.reload.
    try{if(scene&&activeWorld)await buildScene();}
    catch(err){
      if(window.dbg)dbg.error('renderer',err,'ctx restore rebuild failed');
      else console.error('ctx restore rebuild failed:',err);
      if(ov)ov.style.display='flex';
      if(btn)btn.style.display='inline-block';
      const msg=document.getElementById('ctxLostMsg');
      if(msg)msg.textContent='Scene-rebuild faalde na context-herstel. Tik op herladen om opnieuw te starten.';
    }
  });
  window.addEventListener('beforeunload',()=>{try{renderer.dispose();renderer.forceContextLoss();}catch(e){}});
  document.addEventListener('visibilitychange',()=>{if(audioCtx)document.hidden?audioCtx.suspend():audioCtx.resume();});
  // Pixel-ratio caps:
  //   mobile: 2 — dpr-3 iPhones render at 67% device-pixels (round-6 fix).
  //   desktop: 1.5 — was identical to mobile (bug: ternary had same branches).
  //     On a Retina MacBook (dpr=2) a cap of 2 means we render the full scene
  //     × bloom (4 RT passes) × mirror at native 2× → ~4× the pixel-work of
  //     a non-Retina equivalent. Capping desktop at 1.5 keeps the image
  //     sharp on Retina while halving GPU load. Auto-quality detector
  //     (loop.js _engageLowQuality) further drops to 1.0 if freezes appear.
  // pixelRatio cap from tier (high=1.5, mid=1.25, low=1.0). Mobile keeps
  // its historical 2.0 cap (round-6 fix for dpr-3 iPhones) regardless of
  // tier because _isMobile is the dominant pixel-budget signal there.
  const _dprCap = _mob ? 2 : (_qf.dprCap || 1.5);
  renderer.setPixelRatio(Math.min(devicePixelRatio, _dprCap));
  renderer.setSize(innerWidth,innerHeight);
  // Shadow path: tier-flag drives both type and map-size. High tier on
  // desktop = PCFSoft 1024² (Phase 6.4 IBL cohesion). Mid = PCFSoft 512²
  // (half the bandwidth, perceptible only under very high-contrast scenes).
  // Low = no shadows (matches mobile parity).
  renderer.shadowMap.enabled = !!_qf.shadows;
  if(_qf.shadowType === 'PCFSoft') renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  else renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
  // Dithering breekt banding in de canvas-baked sky-gradients (zichtbaar op
  // Cosmic, Pier47, Guangzhou waar de zenith→horizon stap door dark-purple
  // mid-tones loopt en 8-bit kwantisatie ringen achterlaat). Dithering
  // strooit ~1/255 ruis door de output zodat banding visueel verdwijnt.
  // Effectief gratis (een paar GPU-cycles in de fragment-output stage).
  renderer.dithering = true;
  // outputEncoding (r134) / outputColorSpace (r150+) via compat-laag.
  ThreeCompat.applyRendererColorSpace(renderer);
  // Bloom post-processing — auto-disabled on mobile (see js/effects/postfx.js).
  if(typeof initPostFX==='function')initPostFX();
  // Atmosphere extension (godrays + horizon haze). Must run AFTER initPostFX
  // so the original matComposite exists to be swapped. Also mobile-skipped
  // internally; piggy-backs on _postfx.ready so the same toggles apply.
  if(typeof _initAtmospherePass==='function')_initAtmospherePass();
  // Phase 9.1 — SSAO init na atmosphere zodat composite shader uniforms
  // bestaan voor tAO wire-up. Skipt op mobile + low-q via interne guard.
  if(typeof _initSSAO==='function')_initSSAO();
  // Sessie 03 — SSR init after SSAO; wires tSSR uniform on the
  // composite shader. Skips on mobile/low via internal guard.
  if(typeof _initSSR==='function')_initSSR();
  // PBR-upgrade Brok 2 — SMAA "lite" 2-pass anti-aliasing op rtFinal ná
  // composite. Skipt op LOW via _qFlags.smaa===false. Postfx leest
  // _smaaCompositeTarget() en routeert composite-output daarnaartoe.
  if(typeof _initSMAA==='function')_initSMAA();
  window.dbg&&dbg.log('renderer','init done — '+innerWidth+'×'+innerHeight+' dpr '+renderer.getPixelRatio().toFixed(2)+' shadow='+renderer.shadowMap.enabled+' THREE '+(THREE.REVISION||'?'));
  // Single resize pipeline: one rAF-debounced handler bound to resize, orientationchange and
  // visualViewport.resize. Re-evaluates device flags so portrait↔landscape (and split-view)
  // switches the iPad cleanly between mobile/tablet branches without a page reload.
  let _resizePending=false;
  function _handleResize(){
    if(_resizePending)return;
    _resizePending=true;
    requestAnimationFrame(()=>{
      _resizePending=false;
      _redetectDevice();
      if(!renderer)return;
      renderer.setSize(innerWidth,innerHeight);
      // camera wordt pas in buildScene() aangemaakt; iOS firet
      // visualViewport/resize tussen initRenderer en de eerste buildScene
      // (address bar collapse, toolbar animatie). Guard voorkomt TypeError.
      if(camera){
        camera.aspect=innerWidth/innerHeight;
        camera.updateProjectionMatrix();
      }
      if(typeof resizePostFX==='function')resizePostFX();
    });
  }
  window.addEventListener('resize',_handleResize);
  // Safari iOS: orientationchange fires before innerWidth/Height update — give it a tick.
  window.addEventListener('orientationchange',()=>setTimeout(_handleResize,120));
  // Split-view, virtual keyboard and pinch-zoom all change visualViewport without firing resize.
  if(window.visualViewport)window.visualViewport.addEventListener('resize',_handleResize);
}
