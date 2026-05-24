// js/effects/weather.js — non-module script.

'use strict';

// Weather state (uit main.js verhuisd).
//   _weatherMode             — 'clear' | 'rain' | 'storm' | 'snow'
//   _stormFlashTimer         — countdown tussen lightning flashes
//   _thunderTimer            — countdown voor thunder SFX
//   _rainIntensity, _rainTarget — smooth rain visual transition
//   _snowParticles, _snowGeo — Three.js Points + BufferGeometry voor snow
//   _weatherForecastTimer/Fired — mid-race forecast popup

// Hotspot #2 fix: scratch Color hoist — voorheen per-frame `new THREE.Color(base)`
// in updateWeather (60 alloc/sec onvoorwaardelijk bij elke RACE frame).
const _wxBaseColor = (typeof THREE !== 'undefined') ? new THREE.Color() : null;
let _lastWxApplied; // sentinel — laatste _rainIntensity waarop track color/emissive zijn ge-write
// Cross-script: ui/select.js leest _weatherMode pre-race; gameplay/race.js
// reset _weatherForecast*. setWeather() onder gebruikt + muteert ze allemaal.
let _weatherMode='clear';
let _stormFlashTimer=0;
let _thunderTimer=14+Math.random()*10;
let _rainIntensity=0,_rainTarget=0;
let _snowParticles=null,_snowGeo=null;
let _weatherForecastTimer=0,_weatherForecastFired=false;

function initRain(){
  rainCanvas=document.getElementById('rainCanvas');
  rainCtx=rainCanvas.getContext('2d');
  rainCanvas.width=innerWidth;rainCanvas.height=innerHeight;
  const _rainCount=_mobCount(220);
  for(let i=0;i<_rainCount;i++) rainDrops.push({x:Math.random()*innerWidth,y:Math.random()*innerHeight,spd:8+Math.random()*10,len:10+Math.random()*20,alpha:.3+Math.random()*.5});
  window.addEventListener('resize',()=>{if(rainCanvas){rainCanvas.width=innerWidth;rainCanvas.height=innerHeight;}});
}

function toggleRain(){
  isRain=!isRain;
  _rainTarget=isRain?1:0;
  // On non-race screens updateWeather isn't running — apply instantly
  if(gameState==='TITLE'||gameState==='SELECT'){
    _rainIntensity=_rainTarget;
    if(rainCanvas)rainCanvas.style.display=isRain?'block':'none';
    scene.fog.density=isDark?(isRain?.006:.0035):(isRain?.002:.0021);
    if(_trackMesh){
      const base=_trackMesh.material.userData.baseColor||0x262626;
      // Preserve world track color, only darken slightly when raining
      const bc=new THREE.Color(base);
      if(isRain)bc.multiplyScalar(0.55);
      _trackMesh.material.color.copy(bc);
      // setHex op de bestaande Color ipv een nieuwe alloceren — pure uniform
      // update, geen object-reassign. needsUpdate=true is hier ook overbodig
      // (alleen nodig voor define/map slot changes, niet voor color/emissive
      // uniforms — zie identieke rationale in updateWeather hieronder).
      _trackMesh.material.emissive.setHex(isRain?0x0a0d14:0x000000);
    }
  }
  if(_sunBillboard)_sunBillboard.visible=!isDark&&!isRain;
  const lbl=isRain?'☀ DRY':'🌧 RAIN';
  const _trb=document.getElementById('titleRainBtn');if(_trb)_trb.textContent=lbl;
  const _hrb=document.getElementById('hudRainBtn');if(_hrb)_hrb.textContent=lbl;
}

function setWeather(mode){
  if(window._rpp&&mode!==_weatherMode)_rpp.mark('weather:change',{from:_weatherMode,to:mode});
  _weatherMode=mode;
  if(isRain&&mode!=='storm'&&mode!=='rain'){isRain=false;_rainTarget=0;}
  // Scene-not-built guard: setWeather mutates scene.fog/background and the
  // light intensities below. If called before buildScene() finishes (e.g.
  // saved-weather restore racing with async title-first boot), defer until
  // __bootScenePromise resolves rather than throwing on scene.fog access.
  if(typeof scene==='undefined'||!scene||!scene.fog){
    if(window.__bootScenePromise){
      window.__bootScenePromise.then(()=>setWeather(mode)).catch(()=>{});
    }
    return;
  }
  // ── Space weather ─────────────────────────────────────────────
  if(activeWorld==='space'){
    if(_snowParticles){scene.remove(_snowParticles);_snowParticles=null;}
    if(mode==='clear'){
      scene.fog.density=.0014;scene.fog.color.setHex(0x050015);
      ambientLight.intensity=isDark?.14:.28;
    } else if(mode==='fog'){
      // Nebula Cloud — dense purple mist
      scene.fog.density=.018;scene.fog.color.setHex(0x120028);
      ambientLight.intensity=.06;
    } else if(mode==='sunset'){
      // Solar Flare — warm orange glow from one side
      scene.fog.density=.001;scene.fog.color.setHex(0x441100);
      sunLight.color.setHex(0xff7722);sunLight.intensity=.3;
      ambientLight.intensity=.22;
    } else if(mode==='storm'){
      // Meteor Shower — use rain + heavier flash
      if(!isRain){isRain=true;_rainTarget=1;}
      scene.fog.density=.003;scene.fog.color.setHex(0x0a000a);
      _stormFlashTimer=6+Math.random()*5;ambientLight.intensity=.08;
    } else if(mode==='snow'){
      // Stardust surge — extra dust, slightly denser
      scene.fog.density=.001;scene.fog.color.setHex(0x080025);
      if(!_spaceDustParticles)buildSpaceDust();
      else{_spaceDustParticles.material.opacity=.75;_spaceDustParticles.material.size=.5;}
    }
    if(mode!=='storm')_fogBaseDensity=scene.fog.density;
    document.querySelectorAll('.wxCard').forEach(b=>b.classList.toggle('wxSel',b.dataset.w===mode));
    localStorage.setItem('src_weather',mode);
    return;
  }
  // ── No-rain worlds (no-op early-return) ───────────────────────
  // Worlds with their own weather identity where the default GP fallback would
  // clobber the world-specific skybox/lighting AND where rain is physically
  // or thematically wrong:
  //   - volcano / guangzhou: ember-haze / gothic-blood
  //     skyboxes set by core/scene.js + night.js. Rain on hot biomes is wrong.
  //   - deepsea: underwater, rain is absurd.
  //   - candy: fantasy sugar world, water-rain would melt the candy.
  //   - arctic: cold biome — snow belongs here, not rain. Arctic already runs
  //     its own blizzard particles (updateArcticWorld) as the visible snow.
  if(activeWorld==='volcano' || activeWorld==='guangzhou'
     || activeWorld==='deepsea' || activeWorld==='candy' || activeWorld==='arctic'){
    // Snow particles never make sense in volcanic / underwater / candy worlds —
    // clean up if a previous world's setWeather('snow') leaked the Points mesh.
    // Arctic keeps its own blizzard particles (built in buildArcticEnvironment).
    if(_snowParticles && activeWorld!=='arctic'){scene.remove(_snowParticles);_snowParticles=null;}
    // Rain stays off — these worlds don't precipitate.
    if(isRain){isRain=false;_rainTarget=0;}
    document.querySelectorAll('.wxCard').forEach(b=>b.classList.toggle('wxSel',b.dataset.w===mode));
    localStorage.setItem('src_weather',mode);
    return;
  }
  // ── Default weather (fallback voor worlds zonder eigen weather-set) ─
  if(mode==='clear'){
    scene.fog.density=.0021;scene.fog.color.setHex(0x8ac0e0);
    if(scene.background)scene.background=makeSkyTex('#1e5292','#b8d8ee');
    sunLight.color.setHex(0xfff8f0);sunLight.intensity=1.65;ambientLight.intensity=.50;hemiLight.intensity=.36;
    hemiLight.color.setHex(0x9bbfdd);hemiLight.groundColor.setHex(0x4a7a3d);
    if(_sunBillboard)_sunBillboard.visible=true;
    if(_snowParticles){scene.remove(_snowParticles);_snowParticles=null;}
  } else if(mode==='fog'){
    scene.fog.density=.012;scene.fog.color.setHex(0x889988);
    scene.background=makeSkyTex('#778877','#99aa99');
    sunLight.intensity=.3;ambientLight.intensity=.35;hemiLight.intensity=.2;
    if(_sunBillboard)_sunBillboard.visible=false;
    if(_snowParticles){scene.remove(_snowParticles);_snowParticles=null;}
  } else if(mode==='sunset'){
    scene.fog.density=.0021;scene.fog.color.setHex(0xdd8855);
    scene.background=makeSkyTex('#ff4400','#ffaa44');
    sunLight.color.setHex(0xff8840);sunLight.intensity=1.2;
    hemiLight.color.setHex(0xff9944);hemiLight.groundColor.setHex(0x664422);hemiLight.intensity=.5;
    if(_sunBillboard)_sunBillboard.visible=true;
    if(_snowParticles){scene.remove(_snowParticles);_snowParticles=null;}
  } else if(mode==='storm'){
    if(!isRain){isRain=true;_rainTarget=1;}
    scene.fog.density=.006;scene.fog.color.setHex(0x223322);
    scene.background=makeSkyTex('#0a1205','#1a2a18');
    sunLight.intensity=.25;ambientLight.intensity=.18;hemiLight.intensity=.12;
    if(_sunBillboard)_sunBillboard.visible=false;
    _stormFlashTimer=8+Math.random()*7;
    if(_snowParticles){scene.remove(_snowParticles);_snowParticles=null;}
  } else if(mode==='snow'){
    scene.fog.density=.0045;scene.fog.color.setHex(0xbbccdd);
    scene.background=makeSkyTex('#8899aa','#ccddee');
    sunLight.intensity=.6;ambientLight.intensity=.55;hemiLight.intensity=.45;
    if(_sunBillboard)_sunBillboard.visible=false;
    // Snow particles
    if(!_snowParticles){
      _snowGeo=new THREE.BufferGeometry();
      const cnt=_mobCount(600),pos=new Float32Array(cnt*3);
      for(let i=0;i<cnt;i++){pos[i*3]=((Math.random()-.5)*400);pos[i*3+1]=Math.random()*30;pos[i*3+2]=((Math.random()-.5)*400);}
      _snowGeo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
      _snowParticles=new THREE.Points(_snowGeo,new THREE.PointsMaterial({color:0xeeeeff,size:.35,transparent:true,opacity:.7}));
      scene.add(_snowParticles);
    }
  }
  // Cache "no rain" fog density (used by updateWeather as the base for rain blend).
  // Storm mode inherently includes rain, so its density already represents rain-on
  // — we still cache it as base so toggling rain off reverts to the storm density.
  if(mode!=='storm')_fogBaseDensity=scene.fog.density;
  // Highlight active weather card
  document.querySelectorAll('.wxCard').forEach(b=>b.classList.toggle('wxSel',b.dataset.w===mode));
  localStorage.setItem('src_weather',mode);
}

function updateSnow(dt){
  if(!_snowParticles||!_snowGeo)return;
  const pos=_snowGeo.attributes.position.array;
  const car=carObjs[playerIdx];
  const cx=car?car.mesh.position.x:0,cz=car?car.mesh.position.z:0;
  for(let i=0;i<pos.length;i+=3){
    pos[i+1]-=dt*1.2;pos[i]+=Math.sin(_nowSec*.3+i)*.04;pos[i+2]+=Math.cos(_nowSec*.25+i)*.04;
    if(pos[i+1]<0){pos[i]=cx+((Math.random()-.5)*400);pos[i+1]=30;pos[i+2]=cz+((Math.random()-.5)*400);}
  }
  _snowGeo.attributes.position.needsUpdate=true;
}

function updateStormFlash(dt){
  if(_weatherMode!=='storm')return;
  _stormFlashTimer-=dt;
  if(_stormFlashTimer<=0){
    // Lightning flash
    ambientLight.intensity=1.8;
    setTimeout(()=>{ambientLight.intensity=.18;},80);
    setTimeout(()=>{ambientLight.intensity=1.4;},140);
    setTimeout(()=>{ambientLight.intensity=.18;},200);
    Audio.playThunder();
    _stormFlashTimer=8+Math.random()*7;
  }
}

// Per-frame scratch arrays for rain alpha-batching. Hoisted out of
// updateRain() so the [[],[]] literal isn't re-allocated every frame
// (rain frames are 60 fps; arrays were also re-allocated by forEach).
const _rainGrpHigh=[],_rainGrpLow=[];
function updateRain(){
  if(!isRain)return;
  const ctx=rainCtx,w=rainCanvas.width,h=rainCanvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='rgb(180,200,255)';ctx.lineWidth=1;
  // Batch rain into 2 alpha groups to minimize state changes
  _rainGrpHigh.length=0;_rainGrpLow.length=0;
  const _rdN=rainDrops.length;
  for(let i=0;i<_rdN;i++){
    const d=rainDrops[i];
    d.y+=d.spd;d.x+=1;
    if(d.y>h){d.y=0;d.x=Math.random()*w;}
    if(d.alpha>.55)_rainGrpHigh.push(d);else _rainGrpLow.push(d);
  }
  // High-alpha pass
  if(_rainGrpHigh.length){
    ctx.globalAlpha=.7;
    ctx.beginPath();
    for(let i=0;i<_rainGrpHigh.length;i++){const d=_rainGrpHigh[i];ctx.moveTo(d.x,d.y);ctx.lineTo(d.x+2,d.y+d.len);}
    ctx.stroke();
  }
  // Low-alpha pass
  if(_rainGrpLow.length){
    ctx.globalAlpha=.35;
    ctx.beginPath();
    for(let i=0;i<_rainGrpLow.length;i++){const d=_rainGrpLow[i];ctx.moveTo(d.x,d.y);ctx.lineTo(d.x+2,d.y+d.len);}
    ctx.stroke();
  }
  ctx.globalAlpha=1;
}


function updateWeather(dt){
  _rainIntensity+=(_rainTarget-_rainIntensity)*Math.min(1,dt*1.0);
  if(Math.abs(_rainIntensity-_rainTarget)<0.006)_rainIntensity=_rainTarget;
  // Rain canvas — smooth opacity fade
  if(rainCanvas){
    const show=_rainIntensity>0.03;
    if(show){rainCanvas.style.display='block';rainCanvas.style.opacity=String(_rainIntensity);}
    else{rainCanvas.style.display='none';}
  }
  // Track surface shimmer — gradual wet→dry darkening, preserves world color.
  // Epsilon-gate op _rainIntensity: zodra rain-target geclamped is (lijn 242
  // bovenaan) is _rainIntensity stabiel en hoeven de color+emissive writes
  // niet meer per frame. Voor weather-transitions blijven we volgen.
  if(_trackMesh){
    const w=_rainIntensity;
    if(_lastWxApplied===undefined||Math.abs(w-_lastWxApplied)>0.002){
      _lastWxApplied=w;
      const base=_trackMesh.material.userData.baseColor;
      if(base!==undefined){
        // Reuse module-scratch Color (Hotspot #2 fix).
        _wxBaseColor.set(base).multiplyScalar(1.0-w*0.45);
        _trackMesh.material.color.copy(_wxBaseColor);
      }else{
        // Fallback for tracks without baseColor stashed
        const dryL=0x26/255,wetL=0x18/255;
        const lv=dryL+(wetL-dryL)*w;
        _trackMesh.material.color.setRGB(lv,lv,lv);
      }
      _trackMesh.material.emissive.setRGB(w*.04,w*.05,w*.09);
    }
  }
  // Fog — blend per-world day/night base (cached by toggleNight/setWeather) with
  // rain density bump. Previously hardcoded values clobbered every world's
  // density every frame, which left other worlds (and the raised day densities)
  // with too little fog at camera.far=900 → visible prop pop-in while driving.
  const baseFog=_fogBaseDensity;
  const rainAdd=isDark?.0025:.0009;
  scene.fog.density=baseFog+_rainIntensity*rainAdd;
}


function updateWeatherForecast(dt){
  if(_weatherForecastFired||gameState!=='RACE')return;
  // Worlds where the mid-race rain forecast must never fire:
  //   - sandstorm: dust-storm hazard owns the weather slot; toggleRain()
  //     would re-inject rain after buildSandstormEnvironment cleared it.
  //   - pier47: permanently-rainy by design (motregen); toggling off would
  //     break the bewolkte-nacht atmosphere.
  //   - volcano: hot biomes don't precipitate; the
  //     forecast would put regen-streaks on volcanic asphalt.
  //   - deepsea: underwater, rain is absurd.
  //   - space: vacuum, no atmosphere. Meteor shower mode reuses rain-canvas
  //     intentionally via setWeather('storm'), but the forecast must not flip
  //     plain rain on/off independently.
  //   - arctic: should be snow, not rain. Arctic has its own blizzard.
  //   - candy: fantasy world, water-rain would melt the sugar.
  if(activeWorld==='sandstorm'||activeWorld==='pier47'
     ||activeWorld==='volcano'
     ||activeWorld==='deepsea'||activeWorld==='space'
     ||activeWorld==='arctic'||activeWorld==='candy'){_weatherForecastFired=true;return;}
  _weatherForecastTimer-=dt;
  if(_weatherForecastTimer<=8&&_weatherForecastTimer>7.9){
    // 8s warning before change. Use the lightweight top-banner (one-line,
    // no heavy border/background) — the heavy showBanner is reserved for
    // big celebrations like "RACE LEADER!".
    const incoming=isRain?'☀ CLEARING UP':'🌧 RAIN INCOMING';
    const dur=window._isMobile?3000:4000;
    showBannerTop(incoming,'#88ccff',dur);
  }
  if(_weatherForecastTimer<=0){
    _weatherForecastFired=true;
    toggleRain();
  }
}

