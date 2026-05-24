// js/effects/night.js — non-module script.

'use strict';

// Day↔night smooth-transition state (uit main.js verhuisd).
//   _skyT       — current blend factor 0=day, 1=night (lerps richting _skyTarget)
//   _skyTarget  — gewenste eindwaarde, geset door toggleNight() hieronder
//   _fogColorDay / _fogColorNight — lerped via lerpColors() voor scene.fog.color.
// Per wereld worden deze fog-kleuren herset in core/scene.js buildScene().
// _skyT decay-stap zit in track/environment.js update().
let _skyT=0,_skyTarget=0;
const _fogColorDay=new THREE.Color(0x8ac0e0);
const _fogColorNight=new THREE.Color(0x030610);

// Sandstorm sky-cache. The sandstorm-branch of toggleNight swaps both
// scene.background and scene.environment between a day and a night
// version. Re-baking the night canvas + regenerating its PMREM env is
// ~5-15ms desktop / 30+ms mobile per M-press — noticeable hitch on
// rapid toggles. We cache both versions on first build, then just
// reference-swap on subsequent toggles. disposeSandstormStorm calls
// _disposeSandstormSkyCache() on world-switch / race-reset to release
// the GPU memory before the next buildScene allocates fresh textures.
let _sstNightBg=null, _sstNightEnv=null;
let _sstDayBg=null,   _sstDayEnv=null;
// Cross-world night-sky caches (mirror sandstorm pattern). Each world's
// dispose<World><Extras> function invokes its corresponding cleanup so
// the next buildScene starts with fresh textures.
let _vlcNightBg=null, _vlcNightEnv=null, _vlcDayBg=null, _vlcDayEnv=null;
let _arcNightBg=null, _arcNightEnv=null, _arcDayBg=null, _arcDayEnv=null;
let _cdyNightBg=null, _cdyNightEnv=null, _cdyDayBg=null, _cdyDayEnv=null;
let _gpNightBg=null,  _gpNightEnv=null,  _gpDayBg=null,  _gpDayEnv=null;
let _p47NightBg=null, _p47NightEnv=null, _p47DayBg=null, _p47DayEnv=null;
let _gzNightBg=null,  _gzNightEnv=null,  _gzDayBg=null,  _gzDayEnv=null;

// Generic night-env baker. Calls a per-world skybox builder, then runs
// the PMREM pipeline on the resulting canvas to derive a cubemap-style
// environment texture for car clearcoat reflections. Returns {bg, env}
// — bg always present, env may be null if PMREM failed (renderer
// missing, build error logged via dbg).
//
// Used by every world's night-toggle branch that wants moonlit reflections
// in car lacquer. Mirrors the sandstorm pattern that was the reference
// implementation. Caching is the caller's responsibility — this helper
// only does the bake.
function _bakeNightEnv(skyboxBuilder){
  if(typeof skyboxBuilder!=='function')return {bg:null, env:null};
  const bg=skyboxBuilder();
  const env=(typeof _buildWorldEnvFromSky==='function')
    ? _buildWorldEnvFromSky(bg)
    : null;
  return {bg, env};
}
// Per-world "no rain" fog density. updateWeather() reads this so its rain-blend
// adds rainAdd on top of the active world's base instead of clobbering all worlds
// to GP-hardcoded values every frame. Set at end of toggleNight() and on
// non-rain branches of setWeather().
let _fogBaseDensity=.0021;

// Phase 8.4 — auto-exposure smooth tween. toggleNight() zet _exposureTarget,
// updateExposure(dt) lerpt elke frame naar target. Geen instant pop meer
// op M-press. Initial value matched renderer.js init (1.1) zodat eerste
// frame na boot geen visible step heeft.
let _exposureTarget = 1.1;
let _exposureCur    = 1.1;
function updateExposure(dt){
  if(typeof renderer === 'undefined' || !renderer) return;
  // Rate 3/sec — ~0.5s settling time vanaf maximaal verschil 0.3
  _exposureCur += (_exposureTarget - _exposureCur) * Math.min(1, dt * 3);
  renderer.toneMappingExposure = _exposureCur;
}
if(typeof window !== 'undefined') window._updateExposure = updateExposure;

// Phase 10.2 — externe setter voor _exposureTarget. Sun-arc.js + andere
// systemen kunnen exposure-doel driven zonder M-toggle. updateExposure
// tweent natuurlijk naar nieuwe waarde via rate 3/sec.
function setExposureTarget(v){
  _exposureTarget = v;
}
if(typeof window !== 'undefined') window._setExposureTarget = setExposureTarget;

function toggleNight(){
  isDark=!isDark;
  localStorage.setItem('src_night',isDark?'1':'0');
  _skyTarget=isDark?1:0;
  // Phase 6.2 + 8.4 — day/night tone-mapping exposure curve.
  // Zet TARGET — updateExposure(dt) lerpt per-frame naar het doel.
  // PBR-upgrade Brok 1a: per-wereld targets lezen uit world-visuals;
  // fallback naar de eerdere globale 0.95/1.25 voor onbekende werelden.
  {
    const _v = (typeof window.getWorldVisuals === 'function')
      ? window.getWorldVisuals(activeWorld) : null;
    _exposureTarget = _v
      ? (isDark ? _v.exposureNight : _v.exposureDay)
      : (isDark ? 0.95 : 1.25);
  }
  if(activeWorld==='deepsea'){
    // Underwater — toggle is shallow water (day) vs deep abyss (night).
    // Pilot voor de WORLD_LIGHTING-extractie: lighting-waarden komen
    // uit de tabel (sky/fog/sun/amb/hemi/trackLights/headlights/aiHead).
    // Deepsea-extras (trackPoles, stars, biolum-edges, jellyfish,
    // _sunBillboard) vallen niet onder het gestandaardiseerde schema
    // en blijven daarom inline.
    if(typeof window.applyWorldLighting === 'function'){
      window.applyWorldLighting('deepsea', isDark);
    }
    if(isDark){
      trackPoles.forEach(p=>p.visible=true);
      if(stars)stars.visible=true; // biolum particles
      _dsaBioEdges.forEach(e=>e.mat.opacity=.85);
      _jellyfishList.forEach(j=>{const pl=j.children.find(c=>c.isLight);if(pl)pl.intensity=1.4;});
    }else{
      trackPoles.forEach(p=>p.visible=false);
      if(stars)stars.visible=false;
      _dsaBioEdges.forEach(e=>e.mat.opacity=.45);
      _jellyfishList.forEach(j=>{const pl=j.children.find(c=>c.isLight);if(pl)pl.intensity=.6;});
    }
    if(_sunBillboard)_sunBillboard.visible=false;
  }else if(activeWorld==='arctic'){
    // Arctic night: aurora-ribbon skybox (green + violet + cyan) over
    // dense star field with crisp moon. PMREM env paints car lacquer
    // with cool aurora rim-light — the dramatic visual win for this world.
    // Fase 3a: lighting-waarden via WORLD_LIGHTING-tabel (consumer
    // applyWorldLighting). Arctic-extras (stars, _sunBillboard) blijven
    // inline omdat ze niet onder het lighting-schema vallen.
    if(isDark){
      if(!_arcDayBg)_arcDayBg=scene.background;
      if(!_arcDayEnv)_arcDayEnv=scene.environment;
      if(!_arcNightBg && typeof makeArcticNightSkyTex==='function'){
        const _baked=_bakeNightEnv(makeArcticNightSkyTex);
        _arcNightBg=_baked.bg; _arcNightEnv=_baked.env;
      }
      if(_arcNightBg) scene.background=_arcNightBg;
      if(_arcNightEnv) scene.environment=_arcNightEnv;
    }else{
      if(_arcDayBg) scene.background=_arcDayBg;
      if(_arcDayEnv) scene.environment=_arcDayEnv;
    }
    if(typeof window.applyWorldLighting === 'function'){
      window.applyWorldLighting('arctic', isDark);
    }
    if(stars)stars.visible=isDark;
    if(_sunBillboard)_sunBillboard.visible=!isDark;
  }else if(activeWorld==='volcano'){
    // Volcano night: dramatic dark-ember sky + intensified lava-glow
    // horizon + dim cream moon. The PMREM-baked env paints car lacquer
    // with warm lava rim-light at night (the visual-fix-v5 win).
    // Lighting-waarden (sun/amb/hemi/trackLights/headlights/aiHead) komen
    // uit WORLD_LIGHTING.volcano via applyWorldLighting; volcano-record
    // heeft geen sky/fog-velden, dus PMREM-skybox-swap + scene.fog blijven
    // onveranderd t.o.v. build-time.
    if(isDark){
      if(!_vlcDayBg)_vlcDayBg=scene.background;
      if(!_vlcDayEnv)_vlcDayEnv=scene.environment;
      if(!_vlcNightBg && typeof makeVolcanoNightSkyTex==='function'){
        const _baked=_bakeNightEnv(makeVolcanoNightSkyTex);
        _vlcNightBg=_baked.bg; _vlcNightEnv=_baked.env;
      }
      if(_vlcNightBg) scene.background=_vlcNightBg;
      if(_vlcNightEnv) scene.environment=_vlcNightEnv;
    }else{
      if(_vlcDayBg) scene.background=_vlcDayBg;
      if(_vlcDayEnv) scene.environment=_vlcDayEnv;
    }
    if(typeof window.applyWorldLighting === 'function'){
      window.applyWorldLighting('volcano', isDark);
    }
    if(stars)stars.visible=true;
    if(_sunBillboard)_sunBillboard.visible=false;
  }else if(activeWorld==='candy'){
    // Candy — Day=bright pastel paradise, Night=glow-in-the-dark wonderland.
    // PMREM env swap so car lacquer reflects the dreamy pink moon + sparkle
    // stars at night, and the bright pink paradise during day.
    // Lighting-waarden (fog/sun/amb/hemi/trackLights/headlights/aiHead) via
    // WORLD_LIGHTING.candy; PMREM-skybox swap + candy-specifieke props
    // (trackPoles, _candyNightEmissives, _candyCandles, _sunBillboard)
    // blijven inline.
    if(isDark){
      if(!_cdyDayBg)_cdyDayBg=scene.background;
      if(!_cdyDayEnv)_cdyDayEnv=scene.environment;
      if(!_cdyNightBg && typeof makeCandyNightSkyTex==='function'){
        const _baked=_bakeNightEnv(makeCandyNightSkyTex);
        _cdyNightBg=_baked.bg; _cdyNightEnv=_baked.env;
      }
      if(_cdyNightBg) scene.background=_cdyNightBg;
      if(_cdyNightEnv) scene.environment=_cdyNightEnv;
    }else{
      if(_cdyDayBg) scene.background=_cdyDayBg;
      if(_cdyDayEnv) scene.environment=_cdyDayEnv;
    }
    if(typeof window.applyWorldLighting === 'function'){
      window.applyWorldLighting('candy', isDark);
    }
    trackPoles.forEach(p=>p.visible=isDark);
    _candyNightEmissives.forEach(m=>{ if(m.material){m.material.emissiveIntensity=isDark?0.8:0.55;} });
    _candyCandles.forEach(l=>l.intensity=isDark?1.0:0.95);
    if(_sunBillboard)_sunBillboard.visible=!isDark;
  }else if(activeWorld==='sandstorm'){
    // Sandstorm full day↔night swap (visual-fix-v4 §4). Day = warm sunset
    // (matches buildSandstormEnvironment values exactly). Night = moon-lit
    // desert with deep purple sky baked into the skybox canvas.
    // Lighting-waarden (fog.color/sun/amb/hemi/trackLights/headlights/aiHead)
    // via WORLD_LIGHTING.sandstorm. Sandstorm gebruikt linear THREE.Fog —
    // consumer skipt fog.density (geen number op linear fog). Fog far blijft
    // door storm-hazard gedreven, NIET door night.js.
    if(isDark){
      // ── Capture day refs (one-shot) so we can restore them later without
      // re-baking. The current scene.background / scene.environment were set
      // by buildScene → makeSandstormSkyTex / _buildWorldEnvFromSky.
      if(!_sstDayBg)_sstDayBg=scene.background;
      if(!_sstDayEnv)_sstDayEnv=scene.environment;
      // ── Build night refs lazily, then cache. Subsequent toggles to dark
      // skip the bake + PMREM and just reference-swap.
      if(!_sstNightBg && typeof makeSandstormNightSkyTex==='function'){
        const _baked=_bakeNightEnv(makeSandstormNightSkyTex);
        _sstNightBg=_baked.bg;
        _sstNightEnv=_baked.env;
      }
      if(_sstNightBg) scene.background=_sstNightBg;
      if(_sstNightEnv) scene.environment=_sstNightEnv;
      _fogColorDay.setHex(0xe8a468); _fogColorNight.setHex(0x1a1535);
    }else{
      // ── Day: restore via cached refs if we ever toggled to night this
      // build. If _sstDayBg is null (M never pressed yet, scene already has
      // build-time day refs), we just leave scene.background/environment
      // alone — they're already correct.
      if(_sstDayBg) scene.background=_sstDayBg;
      if(_sstDayEnv) scene.environment=_sstDayEnv;
      _fogColorDay.setHex(0xe8a468); _fogColorNight.setHex(0x6a4830);
    }
    if(typeof window.applyWorldLighting === 'function'){
      window.applyWorldLighting('sandstorm', isDark);
    }
    // The 60-instance warm sand-tinted `stars` mesh (sandstorm.js:1525)
    // is a daytime atmospheric detail — at night the canvas-baked sky-stars
    // + Milky Way + moon take over and the warm InstancedMesh becomes
    // visually redundant (cool-night palette + warm-day stars clash).
    // Hide it at night, restore at day. Other worlds use `stars.visible=isDark`
    // because their stars ARE the night-sky; sandstorm is the only world
    // where stars are day-decoration, hence the inverted check.
    if(stars)stars.visible=!isDark;
    trackPoles.forEach(p=>p.visible=isDark);
    if(_sunBillboard)_sunBillboard.visible=!isDark;
  }else if(activeWorld==='pier47'){
    // Pier 47 cinematic night-toggle: PMREM-cached skybox swap + tighter
    // ambient values that align with the cinematic foundation's
    // "pools of light, not floods" pillar. Both day + night are dark by
    // design — toggle is a small visual delta on top of the bewolkte-
    // nacht baseline. Lighting-waarden (fog/sun/amb/hemi/headlights/aiHead)
    // via WORLD_LIGHTING.pier47 (incl. non-zero day-headlights 0.6/0.4/0.3
    // zodat de cinematic baseline overdag laag-belicht is en lamp-poles
    // + koplampen het narrative werk doen).
    if(isDark){
      if(!_p47DayBg)_p47DayBg=scene.background;
      if(!_p47DayEnv)_p47DayEnv=scene.environment;
      if(!_p47NightBg && typeof makePier47NightSkyTex==='function'){
        const _baked=_bakeNightEnv(makePier47NightSkyTex);
        _p47NightBg=_baked.bg; _p47NightEnv=_baked.env;
      }
      if(_p47NightBg) scene.background=_p47NightBg;
      if(_p47NightEnv) scene.environment=_p47NightEnv;
      _fogColorDay.setHex(0x252030); _fogColorNight.setHex(0x18141f);
    }else{
      if(_p47DayBg) scene.background=_p47DayBg;
      if(_p47DayEnv) scene.environment=_p47DayEnv;
      _fogColorDay.setHex(0x252030); _fogColorNight.setHex(0x18141f);
    }
    if(typeof window.applyWorldLighting === 'function'){
      window.applyWorldLighting('pier47', isDark);
    }
    // Stars stay hidden — Pier 47 has city light pollution + cloud cover.
    if(stars)stars.visible=false;
    if(_sunBillboard)_sunBillboard.visible=false;
  }else if(activeWorld==='guangzhou'){
    // Guangzhou Cinematic night-toggle: PMREM-cached skybox swap + ambient
    // deepens. Both day + night are city-neon-dark by design — the toggle
    // is a small visual delta. Mirrors Pier 47's pattern. Lighting-waarden
    // (fog/sun/amb/hemi/headlights/aiHead) via WORLD_LIGHTING.guangzhou
    // (incl. non-zero day-headlights 0.6/0.4/0.3 zoals pier47).
    if(isDark){
      if(!_gzDayBg)_gzDayBg=scene.background;
      if(!_gzDayEnv)_gzDayEnv=scene.environment;
      if(!_gzNightBg && typeof makeGuangzhouNightSkyTex==='function'){
        const _baked=_bakeNightEnv(makeGuangzhouNightSkyTex);
        _gzNightBg=_baked.bg; _gzNightEnv=_baked.env;
      }
      if(_gzNightBg) scene.background=_gzNightBg;
      if(_gzNightEnv) scene.environment=_gzNightEnv;
      _fogColorDay.setHex(0x0e0c1a); _fogColorNight.setHex(0x08060e);
    }else{
      if(_gzDayBg) scene.background=_gzDayBg;
      if(_gzDayEnv) scene.environment=_gzDayEnv;
      _fogColorDay.setHex(0x0e0c1a); _fogColorNight.setHex(0x08060e);
    }
    if(typeof window.applyWorldLighting === 'function'){
      window.applyWorldLighting('guangzhou', isDark);
    }
    // Stars stay hidden — Guangzhou has dense city light pollution + cloud cover.
    if(stars)stars.visible=false;
    if(_sunBillboard)_sunBillboard.visible=false;
  }else if(activeWorld==='space'){
    // Space is always dark — toggle only affects ambient brightness
    // ("solar flare day" vs "deep night"). Sky/fog/sun/amb/hemi/trackLights/
    // headlights/aiHead via WORLD_LIGHTING.space (day én night records
    // hebben identieke headlights/aiHead waardes zodat het always-on
    // gedrag van de oude tak bewaard blijft).
    if(typeof window.applyWorldLighting === 'function'){
      window.applyWorldLighting('space', isDark);
    }
    if(stars)stars.visible=true; // always on in space
    trackPoles.forEach(p=>p.visible=true);
  }else{
    // Grand Prix (default). Modest stars + moon + horizon glow at night,
    // standard daytime sky in day. PMREM env baked from each version so
    // car lacquer reflects whichever sky is active.
    if(isDark){
      if(!_gpDayBg)_gpDayBg=scene.background;
      if(!_gpDayEnv)_gpDayEnv=scene.environment;
      if(!_gpNightBg && typeof makeGrandPrixNightSkyTex==='function'){
        const _baked=_bakeNightEnv(makeGrandPrixNightSkyTex);
        _gpNightBg=_baked.bg; _gpNightEnv=_baked.env;
      }
      if(_gpNightBg) scene.background=_gpNightBg;
      if(_gpNightEnv) scene.environment=_gpNightEnv;
      scene.fog.density=.0022;
      sunLight.intensity=.22;ambientLight.intensity=.40;hemiLight.intensity=.28;
      trackLightList.forEach(l=>l.intensity=2.4);trackPoles.forEach(p=>p.visible=true);if(stars)stars.visible=true;
      if(plHeadL){plHeadL.intensity=1.8;plHeadR.intensity=1.8;}if(plTail)plTail.intensity=1.5;
      _aiHeadPool.forEach(l=>l.intensity=1.1);
    }else{
      if(_gpDayBg) scene.background=_gpDayBg;
      if(_gpDayEnv) scene.environment=_gpDayEnv;
      scene.fog.density=.0021;
      // Use Grand Prix shared day-lighting helper for the day-restore so
      // build-time + toggle-time setups can never drift.
      if(typeof _applyGrandPrixDayLighting==='function')_applyGrandPrixDayLighting();
      trackLightList.forEach(l=>l.intensity=0);trackPoles.forEach(p=>p.visible=false);if(stars)stars.visible=false;
      if(plHeadL){plHeadL.intensity=0;plHeadR.intensity=0;}if(plTail)plTail.intensity=0;
      _aiHeadPool.forEach(l=>l.intensity=0);
    }
  }
  // Snap fog color instantly on non-race screens; during race updateSky lerps it
  if(gameState!=='RACE'&&gameState!=='FINISH'){
    _skyT=_skyTarget;
    scene.fog.color.lerpColors(_fogColorDay,_fogColorNight,_skyT);
  }
  // Cache per-world "no rain" fog density so updateWeather can layer rain on top
  // without resetting to GP-hardcoded values every frame.
  // Linear THREE.Fog (sandstorm) has no .density — skip the cache write so
  // updateWeather's rainAdd doesn't produce NaN against an undefined base.
  if(scene&&scene.fog&&typeof scene.fog.density==='number')_fogBaseDensity=scene.fog.density;
  if(_sunBillboard)_sunBillboard.visible=!isDark&&!isRain&&!_isVoidWorld(activeWorld);
  // Moon mirror: visible at night, hidden during day. Per-world built
  // in env.js buildWorldMoon() (only for worlds with WORLD_MOON_PROFILE
  // entry — pier47 stays null).
  if(_moonBillboard)_moonBillboard.visible=isDark&&!isRain;
  // Bloom intensifies bij night (lower threshold, higher strength) — neon
  // emissives gloeien dan dramatischer. Day = subtieler.
  if(typeof setBloomDayNight==='function')setBloomDayNight(isDark);
  // Atmosphere day/night: godrays slightly stronger + haze slightly weaker
  // at night to keep neon/lava sources punchy without muddying the scene.
  if(typeof setAtmosphereDayNight==='function')setAtmosphereDayNight(isDark);
  // Rim-light boost at night — sun drops to 0.04-0.22 in most worlds,
  // making the rim relatively dominant if we don't dim. Push rim *0.65
  // at night so silhouettes still sculpt but key-light reads as bright
  // sun/moon, not as omnidirectional fill.
  if(window._rimLight){
    const baseInt = window._rimLight.userData._baseIntensity;
    if(typeof baseInt !== 'number'){
      // First call after build — remember the buildScene value as base.
      window._rimLight.userData._baseIntensity = window._rimLight.intensity;
    }
    const bi = window._rimLight.userData._baseIntensity || 0.16;
    window._rimLight.intensity = isDark ? bi * 0.65 : bi;
  }
  // Sync headlight emissive intensity across every brand-built car so the
  // shared head material brightens at night and dims by day. Brand cars
  // register their headlight material with the registry in car-parts.js.
  if(typeof syncHeadlights==='function')syncHeadlights(isDark?1.2:0.4);
  // Phase 13D — wet-asphalt envMapIntensity day/night modulation.
  // Pier47 + Guangzhou + DeepSea hebben MeshStandard track
  // (Phase 13A); 's nachts intensity 2.0 voor mirror-look, overdag 0.6
  // zodat de natte look alleen 's avonds leest. Guard met envMapIntensity
  // !=null zodat Lambert-fallback safe is.
  const _wetWorlds = {pier47:1, guangzhou:1, deepsea:1};
  if(_wetWorlds[activeWorld] && _trackMesh && _trackMesh.material &&
     _trackMesh.material.envMapIntensity != null){
    _trackMesh.material.envMapIntensity = isDark ? 2.0 : 0.6;
    _trackMesh.material.needsUpdate = true;
  }
  // HUD-knop: alleen icoon (geen tekst) zodat hij niet visueel met PAUSE
  // overlapt op kleine viewports. Icoon toont waar je naartoe gaat:
  // donker → tap voor zon, licht → tap voor maan.
  const iconOnly=isDark?'☀':'🌙';
  const titleLbl=isDark?'☀ DAY':'🌙 NIGHT';
  const _tnb=document.getElementById('titleNightBtn');if(_tnb)_tnb.textContent=titleLbl;
  const _hnb=document.getElementById('hudNightBtn');if(_hnb)_hnb.textContent=iconOnly;
  // PBR-upgrade Brok 1a: re-apply per-wereld visuals zodat emissive-mul en
  // exposure-target voor de nieuwe day/night-state kloppen. Vóór deze upgrade
  // schreef toggleNight zelf de exposure-target weg; nu komt die uit visuals.
  //
  // PBR-fix: lichtgewicht-variant — IBL hangt niet van dag/nacht af, dus
  // de volledige IBL-traverse bij elke M-toggle is verspilling. Alleen
  // emissive-mul + exposure worden bijgewerkt.
  if(typeof window.applyWorldVisualsNightToggle === 'function'){
    window.applyWorldVisualsNightToggle(activeWorld, scene, renderer);
  } else if(typeof window.applyWorldVisuals === 'function'){
    window.applyWorldVisuals(activeWorld, scene, renderer);
  }
}

// Release the sandstorm sky-cache (day + night skybox + PMREM env). Called
// from disposeSandstormStorm in worlds/sandstorm-storm.js when the user
// leaves sandstorm or restarts the race — releases GPU memory before the
// next buildScene allocates fresh textures. THREE dispose() is idempotent,
// so a defensive try/catch is sufficient if the texture has already been
// released by a different code path.
function _disposeSandstormSkyCache(){
  if(_sstNightBg){try{_sstNightBg.dispose();}catch(_){} _sstNightBg=null;}
  if(_sstNightEnv){try{_sstNightEnv.dispose();}catch(_){} _sstNightEnv=null;}
  if(_sstDayBg){try{_sstDayBg.dispose();}catch(_){} _sstDayBg=null;}
  if(_sstDayEnv){try{_sstDayEnv.dispose();}catch(_){} _sstDayEnv=null;}
}

// Release the Pier 47 sky-cache (day + night skybox + PMREM env). Mirrors
// the sandstorm pattern. Wired from disposeScene's per-world cleanup path
// once sessie-2 lands a disposePier47Extras helper; for sessie 1 the cache
// is small (one skybox + env per toggle direction) so a leak across one
// world-switch is negligible. Function defined here so future wiring is a
// one-line call.
function _disposePier47SkyCache(){
  if(_p47NightBg){try{_p47NightBg.dispose();}catch(_){} _p47NightBg=null;}
  if(_p47NightEnv){try{_p47NightEnv.dispose();}catch(_){} _p47NightEnv=null;}
  if(_p47DayBg){try{_p47DayBg.dispose();}catch(_){} _p47DayBg=null;}
  if(_p47DayEnv){try{_p47DayEnv.dispose();}catch(_){} _p47DayEnv=null;}
}
if(typeof window!=='undefined')window._disposePier47SkyCache=_disposePier47SkyCache;

// Release the Volcano Cinematic sky-cache. Mirrors the Pier 47 pattern.
// Defined for completeness; not yet wired into a dispose hook (sessie 1
// world has no disposeVolcanoCinematicExtras path). Cache is small —
// leak across one world-switch is negligible.
function _disposeVolcanoCinematicSkyCache(){
  if(_vcNightBg){try{_vcNightBg.dispose();}catch(_){} _vcNightBg=null;}
  if(_vcNightEnv){try{_vcNightEnv.dispose();}catch(_){} _vcNightEnv=null;}
  if(_vcDayBg){try{_vcDayBg.dispose();}catch(_){} _vcDayBg=null;}
  if(_vcDayEnv){try{_vcDayEnv.dispose();}catch(_){} _vcDayEnv=null;}
}
if(typeof window!=='undefined')window._disposeVolcanoCinematicSkyCache=_disposeVolcanoCinematicSkyCache;

// Release the Guangzhou sky-cache (day + night skybox + PMREM env). Mirrors
// the Pier 47 / Volcano Cinematic pattern. Defined here so future wiring to
// a disposeGuangzhouExtras() helper is a one-line call.
function _disposeGuangzhouSkyCache(){
  if(_gzNightBg){try{_gzNightBg.dispose();}catch(_){} _gzNightBg=null;}
  if(_gzNightEnv){try{_gzNightEnv.dispose();}catch(_){} _gzNightEnv=null;}
  if(_gzDayBg){try{_gzDayBg.dispose();}catch(_){} _gzDayBg=null;}
  if(_gzDayEnv){try{_gzDayEnv.dispose();}catch(_){} _gzDayEnv=null;}
}
if(typeof window!=='undefined')window._disposeGuangzhouSkyCache=_disposeGuangzhouSkyCache;

// Per-world dispose helpers for the cross-world night-sky caches. Each is
// called from the corresponding world-extras dispose function (e.g.
// disposeVolcanoBridge) on race-reset / world-switch so the next
// buildScene starts fresh. THREE dispose() is idempotent; the try/catch
// covers the rare case of a texture released by a different code path.
function _disposeVolcanoSkyCache(){
  if(_vlcNightBg){try{_vlcNightBg.dispose();}catch(_){} _vlcNightBg=null;}
  if(_vlcNightEnv){try{_vlcNightEnv.dispose();}catch(_){} _vlcNightEnv=null;}
  if(_vlcDayBg){try{_vlcDayBg.dispose();}catch(_){} _vlcDayBg=null;}
  if(_vlcDayEnv){try{_vlcDayEnv.dispose();}catch(_){} _vlcDayEnv=null;}
}
function _disposeArcticSkyCache(){
  if(_arcNightBg){try{_arcNightBg.dispose();}catch(_){} _arcNightBg=null;}
  if(_arcNightEnv){try{_arcNightEnv.dispose();}catch(_){} _arcNightEnv=null;}
  if(_arcDayBg){try{_arcDayBg.dispose();}catch(_){} _arcDayBg=null;}
  if(_arcDayEnv){try{_arcDayEnv.dispose();}catch(_){} _arcDayEnv=null;}
}
function _disposeCandySkyCache(){
  if(_cdyNightBg){try{_cdyNightBg.dispose();}catch(_){} _cdyNightBg=null;}
  if(_cdyNightEnv){try{_cdyNightEnv.dispose();}catch(_){} _cdyNightEnv=null;}
  if(_cdyDayBg){try{_cdyDayBg.dispose();}catch(_){} _cdyDayBg=null;}
  if(_cdyDayEnv){try{_cdyDayEnv.dispose();}catch(_){} _cdyDayEnv=null;}
}
function _disposeGrandPrixSkyCache(){
  if(_gpNightBg){try{_gpNightBg.dispose();}catch(_){} _gpNightBg=null;}
  if(_gpNightEnv){try{_gpNightEnv.dispose();}catch(_){} _gpNightEnv=null;}
  if(_gpDayBg){try{_gpDayBg.dispose();}catch(_){} _gpDayBg=null;}
  if(_gpDayEnv){try{_gpDayEnv.dispose();}catch(_){} _gpDayEnv=null;}
}


function updateCarLights(){
  // Reverse lights — always update regardless of night mode.
  // forEach → for: ran 8 times per frame for the closure cost.
  const _brkActive=(typeof keys!=='undefined' && (keys['ArrowDown']||keys['KeyS']));
  for(let i=0;i<carObjs.length;i++){
    const rl=_reverseLights[i];if(!rl)continue;
    const car=carObjs[i];
    const mat=rl.material;
    if(car.speed<-0.05){mat.emissiveIntensity=2.5;mat.opacity=1;}
    else{mat.emissiveIntensity=0;}
    // Brake-light bloom sprites: opacity ramps with brake-intent for
    // the player, with rapid-deceleration for AI (we can't read AI
    // input — we infer via speed change). Cheap delta-lerp, capped at
    // 0.85 so bloom stays under threshold pop.
    const bb=car.mesh && car.mesh.userData && car.mesh.userData._brakeBloom;
    if(bb && bb.length){
      let target=0;
      if(car.isPlayer){
        if(_brkActive && Math.abs(car.speed)>0.5) target=0.85;
        else if(car.boostTimer>0 || (typeof nitroActive!=='undefined' && nitroActive && car.isPlayer)) target=0.0;
      }else{
        // AI: brake-bloom on hard slowdown (speed drop).
        const prev=car._prevSpdForBrake||0;
        if(prev - car.speed > 0.04) target=0.7;
        car._prevSpdForBrake=car.speed;
      }
      for(let bi=0;bi<bb.length;bi++){
        const m=bb[bi].material;
        m.opacity += (target - m.opacity) * 0.18;
      }
    }
    // Headlight bloom sprites: scale + opacity ramps with speed +
    // night-state. Visible during day on dark tracks (Pier47/Guangzhou
    // tunnels) via the same isDark flag.
    const hb=car.mesh && car.mesh.userData && car.mesh.userData._headBloom;
    if(hb && hb.length){
      const ratio=Math.abs(car.speed)/Math.max(.01,car.def.topSpd);
      // Always-on baseline so bumper-cam catches a glow on day races too.
      let target=isDark ? (0.50 + ratio*0.35) : (0.10 + ratio*0.15);
      for(let hi=0;hi<hb.length;hi++){
        const m=hb[hi].material;
        m.opacity += (target - m.opacity) * 0.12;
      }
    }
  }
  // Visible headlight beam-cones op player car (alleen bij night, alleen
  // chase-cam want in hood/bumper-cam zit de camera binnen de cone-tip
  // en zou de binnenkant een onaangename screen-wash geven). Gated on
  // isDark&&chaseCam: in day mode the beam-cone opacity is already 0 and
  // the child-loop just rewrites zeros — pure waste on every world's
  // day-mode race. Pre-PR-fix loop ran unconditionally.
  const pCar=carObjs[playerIdx];
  const chaseCam=(typeof _camView==='undefined'||_camView===0);
  if(pCar&&pCar.mesh&&isDark&&chaseCam){
    const ratio=Math.abs(pCar.speed)/Math.max(.01,pCar.def.topSpd);
    const tNow=(typeof _nowSec!=='undefined')?_nowSec:performance.now()*0.001;
    // Subtle: 0.16-0.23 ipv 0.30-0.40.
    const baseOp=0.16+ratio*0.07;
    const ch=pCar.mesh.children;
    for(let _ci=0;_ci<ch.length;_ci++){
      const c=ch[_ci];
      if(c.userData&&c.userData.isHeadBeam&&c.material){
        const phase=c.userData.flickerPhase||0;
        const flick=1 + Math.sin(tNow*7.85 + phase)*0.05;
        const target=baseOp*flick;
        c.material.opacity+=(target-c.material.opacity)*0.15;
      }
      // Phase 8b — ground glow heeft hogere baseline (×1.6) want het ligt
      // plat op de grond en moet als "verlichte plek" overkomen, niet als
      // diffuse haze zoals de cone. Zelfde flicker-phase voor coherentie.
      else if(c.userData&&c.userData.isHeadGroundGlow&&c.material){
        const phase=c.userData.flickerPhase||0;
        const flick=1 + Math.sin(tNow*7.85 + phase)*0.05;
        const target=baseOp*1.6*flick;
        c.material.opacity+=(target-c.material.opacity)*0.15;
      }
    }
  }
  if(!isDark||!plHeadL)return;
  const car=carObjs[playerIdx];if(!car)return;
  _plFwd.set(0,0,-1).applyQuaternion(car.mesh.quaternion);
  _plRt.set(1,0,0).applyQuaternion(car.mesh.quaternion);
  _camV1.copy(car.mesh.position);_camV1.y+=.45; // reuse _camV1 as bH
  plHeadL.position.copy(_camV1).addScaledVector(_plRt,-.62).addScaledVector(_plFwd,1.9);
  plHeadL.target.position.copy(plHeadL.position).addScaledVector(_plFwd,12);
  plHeadR.position.copy(_camV1).addScaledVector(_plRt,.62).addScaledVector(_plFwd,1.9);
  plHeadR.target.position.copy(plHeadR.position).addScaledVector(_plFwd,12);
  // Removed explicit plHeadL.target.updateMatrixWorld() / plHeadR.target.updateMatrixWorld()
  // calls — renderer.render() traverses + updates dirty matrices automatically
  // on the SpotLight's render-list pass. Two redundant matrix cascades per
  // frame saved during night mode.
  plTail.position.copy(car.mesh.position).addScaledVector(_plFwd,-1.9);plTail.position.y+=.42;
  // AI headlights: assign pool lights to nearest AI cars (no allocation)
  if(_aiHeadPool.length>0){
    let aiCount=0;
    for(let i=0;i<carObjs.length&&aiCount<_aiHeadPool.length;i++){
      if(i===playerIdx||carObjs[i].finished)continue;
      const ai=carObjs[i];
      _aiFwdRV.set(0,0,-1).applyQuaternion(ai.mesh.quaternion);
      _aiHeadPool[aiCount].position.copy(ai.mesh.position).addScaledVector(_aiFwdRV,1.6);
      _aiHeadPool[aiCount].position.y+=.45;
      _aiHeadPool[aiCount].intensity=1.4;
      aiCount++;
    }
    for(let i=aiCount;i<_aiHeadPool.length;i++)_aiHeadPool[i].intensity=0;
  }
}


function updateAmbientWindSpeed(dt){
  if(!_ambientWindGain||!audioCtx)return;
  const car=carObjs[playerIdx];if(!car)return;
  const ratio=Math.abs(car.speed)/Math.max(car.def.topSpd,.01);
  // 2026-05-02: 65%-threshold hersteld zodat stilstaande auto geen
  // continue suis produceert. Voorheen: 0.005 base-gain die ook bij
  // ratio=0 audible was. Threshold zat oorspronkelijk in engine.js
  // _carWindGain (sinds disabled) en is hier verloren gegaan.
  // Boven 65% topspeed: lineair naar 0.065 max op ratio=1.0.
  // Rain-bonus (0.018) wordt óók speed-gated zodat regen-races op de
  // grid ook stil zijn — rain heeft eigen audio (thunder + rain particles
  // visueel) die niet afhankelijk is van wind-loop voor immersion.
  const speedWind=ratio<0.65?0:(ratio-0.65)*(0.065/0.35);
  const rainBoost=isRain?ratio*0.018:0;
  const target=speedWind+rainBoost;
  const cur=_ambientWindGain.gain.value;
  // Smooth ramp — fast attack, slow release
  const rate=target>cur?8:2;
  _ambientWindGain.gain.value=cur+(target-cur)*Math.min(1,dt*rate);
}

