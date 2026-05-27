// js/gameplay/ghost.js — ghost car: state + mesh + record/replay.
// Non-module script.
//
// Tijdens een ronde wordt elke 0.1s de player-positie geappend in _ghostPos.
// Bij een nieuwe PB-ronde wordt _ghostBest vervangen door een kopie en speelt
// de transparante ghost-mesh loopend mee in de volgende ronde.
//
// Cross-script callers:
//   core/scene.js   buildGhostMesh()  bij elke world-rebuild
//   core/loop.js    updateGhost(dt)   per frame tijdens RACE
//   tracklimits.js  saveGhostIfPB()   bij S/F-line crossing op PB-lap
//   gameplay/race.js + ui/navigation.js — reset _ghostPos/_ghostBest etc.

'use strict';

// Feature flag — false verbergt de PB-ghost volledig (mesh wordt niet
// gebouwd, replay branch wordt overgeslagen). Opname blijft draaien zodat
// `_GHOST_ENABLED=true; buildGhostMesh()` in devtools de feature direct
// herstelt. User feedback: ghost werd aangezien voor een vreemd grijs
// blokje voor de speler uit.
const _GHOST_ENABLED=false;

// State (cross-script let/const-bindings).
const _ghostPos=[];     // huidige ronde — geappend elke 0.1s
let _ghostBest=[];      // beste ronde — replayed loopend
let _ghostMesh=null;    // THREE.Group toegewezen door buildGhostMesh()
let _ghostSampleT=0;    // sample timer (push elke .1s)
let _ghostPlayT=0;      // playback head voor _ghostBest replay

function buildGhostMesh(){
  if(_ghostMesh){scene.remove(_ghostMesh);_ghostMesh=null;}
  if(!_GHOST_ENABLED)return;
  const g=new THREE.Group();
  const mat=new THREE.MeshLambertMaterial({color:0xaabbff,transparent:true,opacity:.32,depthWrite:false,emissive:0x2233aa,emissiveIntensity:.6});
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.55,.44,3.8),mat);body.position.y=.34;g.add(body);
  const cab=new THREE.Mesh(new THREE.BoxGeometry(1.35,.38,1.55),mat);cab.position.set(0,.77,.1);g.add(cab);
  // Outer glow shell (slightly larger, backside only)
  const glowMat=new THREE.MeshBasicMaterial({color:0x6688ff,transparent:true,opacity:.10,side:THREE.BackSide,depthWrite:false});
  const glow=new THREE.Mesh(new THREE.BoxGeometry(1.75,.60,4.1),glowMat);glow.position.y=.34;g.add(glow);
  g.visible=false;
  scene.add(g);_ghostMesh=g;
}

// Cached ghost label DOM ref + blink state. updateGhost ran getElementById
// every frame while a ghost was replaying; the blink also wrote
// style.display every frame even though it only flips at 10 fps.
let _ghostLabelEl=null,_ghostLabelOn=null;
function updateGhost(dt){
  const car=carObjs[playerIdx];if(!car||gameState!=='RACE')return;
  _ghostSampleT+=dt;
  if(_ghostSampleT>=.1){
    _ghostSampleT=0;
    _ghostPos.push({x:car.mesh.position.x,y:car.mesh.position.y,z:car.mesh.position.z,ry:car.mesh.rotation.y});
    if(_ghostPos.length>1200)_ghostPos.shift(); // cap 2-min buffer
  }
  if(_GHOST_ENABLED&&_ghostMesh&&_ghostBest.length>0){
    _ghostPlayT+=dt;
    const fi=Math.min(Math.floor(_ghostPlayT*10),_ghostBest.length-1);
    const gp=_ghostBest[fi];
    _ghostMesh.position.set(gp.x,gp.y+.04,gp.z);
    _ghostMesh.rotation.y=gp.ry;
    _ghostMesh.visible=true;
    if(fi>=_ghostBest.length-1)_ghostPlayT=0; // loop ghost
    if(!_ghostLabelEl)_ghostLabelEl=document.getElementById('ghostLabel');
    const want=fi%20<10;
    if(_ghostLabelEl&&want!==_ghostLabelOn){
      _ghostLabelOn=want;
      _ghostLabelEl.style.display=want?'block':'none';
    }
  }else if(_ghostMesh){_ghostMesh.visible=false;}
}

function saveGhostIfPB(){
  // Save ghost on first lap (bestLapTime still Infinity) or if it's a new PB
  if(_ghostPos.length>0&&lastLapTime>0&&(bestLapTime===Infinity||lastLapTime<=bestLapTime)){
    _ghostBest=[..._ghostPos];_ghostPlayT=0;
    const gl=document.getElementById('ghostLabel');
    if(gl){gl.textContent='👻 PB GHOST';gl.style.display='block';setTimeout(()=>{if(gl)gl.style.display='none';},2500);}
  }
  _ghostPos.length=0; // reset for next lap recording
}
