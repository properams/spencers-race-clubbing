// js/gameplay/safetycar.js — non-module script.

'use strict';

// Per-frame scratch for updateSafetyCar — getPoint(t,target) + getTangent(t,target)
// avoid fresh Vector3 alloc per frame while the safety car is visiting.
const _scPt = (typeof THREE!=='undefined') ? new THREE.Vector3() : null;
const _scTg = (typeof THREE!=='undefined') ? new THREE.Vector3() : null;

function spawnSafetyCar(progress){
  if(_safetyCar){scene.remove(_safetyCar.mesh);_safetyCar=null;}
  const g=new THREE.Group();
  const yMat=new THREE.MeshLambertMaterial({color:0xffcc00});
  const wMat=new THREE.MeshLambertMaterial({color:0x111111});
  const bMat=new THREE.MeshBasicMaterial({color:0xff2200});
  // Body
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.6,.44,3.4),yMat);body.position.y=.34;g.add(body);
  const cab=new THREE.Mesh(new THREE.BoxGeometry(1.4,.38,1.55),yMat);cab.position.set(0,.77,.1);g.add(cab);
  // Light bar
  const lbar=new THREE.Mesh(new THREE.BoxGeometry(1.35,.14,.22),bMat);lbar.position.set(0,1.08,.1);g.add(lbar);
  // Wheels (4 simple cylinders)
  [[-0.88,.28,-1.2],[0.88,.28,-1.2],[-0.88,.28,1.2],[0.88,.28,1.2]].forEach(([x,y,z])=>{
    const w=new THREE.Mesh(new THREE.CylinderGeometry(.28,.28,.2,10),wMat);
    w.rotation.z=Math.PI/2;w.position.set(x,y,z);g.add(w);
  });
  const pt=trackCurve.getPoint(progress);
  const tg=trackCurve.getTangent(progress).normalize();
  g.position.copy(pt);g.position.y=.35;
  g.rotation.set(0,Math.atan2(-tg.x,-tg.z),0);
  scene.add(g);
  _safetyCar={mesh:g,lbar,progress,timer:6.5};
  showBanner('🚗 SAFETY CAR','#ffcc00',1800);
}

function updateSafetyCar(dt){
  if(!_safetyCar)return;
  _safetyCar.timer-=dt;
  if(_safetyCar.timer<=0){scene.remove(_safetyCar.mesh);_safetyCar=null;return;}
  // Drive slowly along track (about 30% of normal speed). getPoint/getTangent
  // with target arg avoids per-frame Vector3 alloc.
  _safetyCar.progress=(_safetyCar.progress+0.22*.012*dt)%1;
  trackCurve.getPoint(_safetyCar.progress,_scPt);
  trackCurve.getTangent(_safetyCar.progress,_scTg).normalize();
  _safetyCar.mesh.position.copy(_scPt);_safetyCar.mesh.position.y=.35;
  _safetyCar.mesh.rotation.y=Math.atan2(-_scTg.x,-_scTg.z);
  // Flash light bar red↔blue
  _safetyCar.lbar.material.color.setHex(Math.sin(_nowSec*12)>0?0xff2200:0x0033ff);
}

