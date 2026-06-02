// js/effects/proc-geometry.js — procedural geometry-builder library.
// Non-module script. Loaded between renderer.js and any world-builder so
// world-builders can call window.ProcGeometry.* during buildScene().
//
// All builders:
//   - return a THREE.BufferGeometry with vertex normals computed
//   - mobile-aware via optional `lod` param (0=full, 1=mobile half-res)
//   - never share geometry across calls — caller decides reuse via
//     InstancedMesh patterns
//   - safe to use with MeshStandardMaterial (PBR-ready)
//
// Pilot consumer: js/worlds/sandstorm.js. Other worlds will adopt this in
// a future rollout phase.

'use strict';

(function(){
  const _MOBILE = () => !!window._isMobile;
  // Seeded PRNG — deterministic per-builder noise so a re-build with same
  // opts produces same shape (helpful for visual regression debugging).
  function _prng(seed){
    let s = seed | 0 || 1337;
    return ()=>{ s = (s*9301+49297) % 233280; return s / 233280; };
  }
  function _lerp(a,b,t){ return a + (b-a)*t; }

  // ── 1. organicCylinder ────────────────────────────────────────────────
  // Cylinder met radial vertex-displacement voor rough rock-wall feel.
  // Used by background mesa's, cliff foundations.
  function organicCylinder(opts){
    opts=opts||{};
    const lod=opts.lod!=null?opts.lod:(_MOBILE()?1:0);
    const sides=Math.max(4, (opts.sides||10) >> lod);
    const heightSeg=lod?2:4;
    const topR=opts.topRadius||4;
    const botR=opts.bottomRadius||5;
    const h=opts.height||10;
    const displaceAmount=opts.displaceAmount||0.3;
    const seed=opts.seed||7;
    const geo=new THREE.CylinderGeometry(topR, botR, h, sides, heightSeg, true);
    // Radially displace each non-cap vertex by seeded noise.
    const pos=geo.attributes.position;
    const rnd=_prng(seed);
    const v=new THREE.Vector3();
    for(let i=0;i<pos.count;i++){
      v.fromBufferAttribute(pos,i);
      // Skip vertices on cylinder caps (open-ended so caps don't exist,
      // but Y near edges = preserve seam continuity).
      const yNorm = (v.y + h*0.5) / h; // 0 bottom, 1 top
      // Displace less near the top + bottom seams to avoid pinching
      const seamFactor = Math.sin(yNorm*Math.PI); // 0 at edges, 1 mid
      const radialDir=Math.atan2(v.z, v.x);
      const noise=(rnd()-0.5)*2*displaceAmount*seamFactor;
      v.x += Math.cos(radialDir)*noise;
      v.z += Math.sin(radialDir)*noise;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate=true;
    geo.computeVertexNormals();
    return geo;
  }

  // ── 2. duneCap ────────────────────────────────────────────────────────
  // Sphere-cap met asymmetric scaling + top-vertex jitter — sand-dune.
  function duneCap(opts){
    opts=opts||{};
    const lod=opts.lod!=null?opts.lod:(_MOBILE()?1:0);
    const widthSeg=lod?8:14;
    const heightSeg=lod?5:8;
    const radius=opts.radius||5;
    const sx=opts.scaleX!=null?opts.scaleX:1.5;
    const sz=opts.scaleZ!=null?opts.scaleZ:1.0;
    const sy=opts.scaleY!=null?opts.scaleY:0.5;
    const topJitter=opts.topJitter||0.15;
    const seed=opts.seed||31;
    // Open hemisphere (top half only).
    const geo=new THREE.SphereGeometry(radius, widthSeg, heightSeg, 0, Math.PI*2, 0, Math.PI*0.5);
    geo.scale(sx, sy, sz);
    const pos=geo.attributes.position;
    const rnd=_prng(seed);
    const v=new THREE.Vector3();
    for(let i=0;i<pos.count;i++){
      v.fromBufferAttribute(pos,i);
      // Vertices near the top (highest y) get x/z jitter so the dune crest
      // isn't a perfect arc.
      const topness = Math.max(0, v.y / (radius*sy));
      if(topness>0.3){
        v.x += (rnd()-0.5) * topJitter * topness * radius;
        v.z += (rnd()-0.5) * topJitter * topness * radius;
        v.y += (rnd()-0.5) * topJitter * 0.3 * topness * radius;
      }
      pos.setXYZ(i,v.x,v.y,v.z);
    }
    pos.needsUpdate=true;
    geo.computeVertexNormals();
    return geo;
  }

  // ── 3. curvedTrunk ────────────────────────────────────────────────────
  // Tapered cylinder met S-curve langs Y voor palm/jungle-trunk.
  function curvedTrunk(opts){
    opts=opts||{};
    const lod=opts.lod!=null?opts.lod:(_MOBILE()?1:0);
    const seg=Math.max(2, (opts.segments||5) >> lod);
    const sides=Math.max(4, (opts.sides||8) >> lod);
    const baseR=opts.baseRadius||0.18;
    const topR=opts.topRadius||0.13;
    const h=opts.height||4.5;
    const curveAmount=opts.curveAmount||0.4;
    const geo=new THREE.CylinderGeometry(topR, baseR, h, sides, seg, false);
    // Per Y-band, shift X by sine to create curve. Curve is monotonic in
    // one direction (single bend) — looks more natural than S-curve for
    // young palms.
    const pos=geo.attributes.position;
    const v=new THREE.Vector3();
    for(let i=0;i<pos.count;i++){
      v.fromBufferAttribute(pos,i);
      const yNorm=(v.y + h*0.5) / h; // 0..1
      const bend=Math.sin(yNorm*Math.PI*0.5)*curveAmount;
      v.x += bend;
      pos.setXYZ(i,v.x,v.y,v.z);
    }
    pos.needsUpdate=true;
    geo.computeVertexNormals();
    return geo;
  }

  // ── 4. strataStack ────────────────────────────────────────────────────
  // Vertical stack of rock-strata as ONE BufferGeometry with per-vertex
  // COLOR attribute (Float32Array, r/g/b per vertex). Vertices on
  // stratum-grenzen krijgen een geblende color tussen aangrenzende strata
  // over een opts.blendRange (default 0.3) Y-range — verzacht de overgang.
  // Materials gebruikend deze geometry MOETEN `vertexColors: true` setten.
  // Cliffs gebruiken dit i.p.v. losse meshes per stratum-laag.
  function strataStack(opts){
    opts=opts||{};
    const lod=opts.lod!=null?opts.lod:(_MOBILE()?1:0);
    const strata=opts.strata||[
      { height:3, radius:8, color:'#7a3a1d', displaceAmount:0.3 },
      { height:6, radius:7, color:'#a8643a', displaceAmount:0.2 },
      { height:8, radius:6.5, color:'#8b4a25', displaceAmount:0.25 },
      { height:4, radius:6, color:'#b87850', displaceAmount:0.15 }
    ];
    const sides=Math.max(4, (opts.totalSides||10) >> lod);
    const blendRange=opts.blendRange!=null?opts.blendRange:0.3;
    const seed=opts.seed||1337;
    const rnd=_prng(seed);
    // Build a single open cylinder per stratum then merge by appending
    // positions/indices into one BufferGeometry. Simpler than CSG: each
    // stratum has its own y-range and radius; vertices at stratum-seams
    // share Y=top-of-prev = bottom-of-next so no visible gap.
    let yCursor=0;
    const positions=[]; // flat r,g,b per vertex appended
    const colors=[];
    const indices=[];
    let vertOffset=0;
    const cTmp=new THREE.Color();
    // Pre-parse strata colors to THREE.Color for blending.
    const sColors=strata.map(s=>new THREE.Color(s.color));
    for(let si=0;si<strata.length;si++){
      const s=strata[si];
      const yBot=yCursor;
      const yTop=yBot+s.height;
      // Heights/sides for this stratum: 3 height-segments per stratum so
      // the blend zone has interior vertices to receive blended colors.
      const hSeg=lod?2:3;
      // Build vertex ring at each Y level
      for(let yi=0;yi<=hSeg;yi++){
        const tY=yi/hSeg;
        const y=_lerp(yBot,yTop,tY);
        for(let i=0;i<sides;i++){
          const ang=(i/sides)*Math.PI*2;
          // Lerp radius across the stratum (smooth taper top to bottom)
          // Strata krijgen een "lip" waar ze samenkomen door minor radius
          // jitter aan top/bot — dat blokkeert het "gestapelde-blokken" gevoel.
          const rJit=(rnd()-0.5)*s.displaceAmount*0.4;
          const r = s.radius + rJit;
          let x=Math.cos(ang)*r;
          let z=Math.sin(ang)*r;
          // Radial displace per vertex (rough rock surface)
          const radialDisp=(rnd()-0.5)*2*s.displaceAmount;
          x += Math.cos(ang)*radialDisp;
          z += Math.sin(ang)*radialDisp;
          positions.push(x,y,z);
          // Vertex-color: by default = stratum color. If vertex is in the
          // bottom blendRange of stratum, blend with previous stratum's
          // color. If in top blendRange, blend with next.
          cTmp.copy(sColors[si]);
          if(si>0 && (y-yBot)<blendRange){
            const t=(y-yBot)/blendRange; // 0 at seam, 1 inside
            cTmp.lerpColors(sColors[si-1], sColors[si], t);
          } else if(si<strata.length-1 && (yTop-y)<blendRange){
            const t=(yTop-y)/blendRange; // 0 at seam, 1 inside
            cTmp.lerpColors(sColors[si+1], sColors[si], t);
          }
          colors.push(cTmp.r, cTmp.g, cTmp.b);
        }
      }
      // Build quad-faces between rings of this stratum
      for(let yi=0;yi<hSeg;yi++){
        for(let i=0;i<sides;i++){
          const a=vertOffset + yi*sides + i;
          const b=vertOffset + yi*sides + (i+1)%sides;
          const c=vertOffset + (yi+1)*sides + i;
          const d=vertOffset + (yi+1)*sides + (i+1)%sides;
          indices.push(a,c,b, b,c,d);
        }
      }
      vertOffset += (hSeg+1)*sides;
      yCursor=yTop;
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors,3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  // ── 5. beveledBox ─────────────────────────────────────────────────────
  // Box met beveled edges — sphinx-blokken die niet als rechthoek aanvoelen.
  // Eerste implementatie probeerde BoxGeometry-corners inward te trekken,
  // maar dat distorteerde de face-planes (puffy-pillow effect want corners
  // op een face delen niet via index). Nu via ExtrudeGeometry: een vierkant
  // Shape met bevelEnabled levert echte rounded corners in alle 12 edges.
  // Triangle-cost: ~280 per box op default (bevelSegments:2, curveSegments:4).
  // Mobile-LOD opts (bevelSegments:1, curveSegments:2) halveren dit tot
  // ~140 tris zonder visueel waarneembaar verschil bij race-snelheid op
  // small screens. Caller kan `bevel:0` zetten om gewoon een BoxGeometry
  // te krijgen (skip de extrude path).
  function beveledBox(opts){
    opts=opts||{};
    const w=opts.w||1, h=opts.h||1, d=opts.d||1;
    const bevel=opts.bevel!=null?opts.bevel:0.1;
    const bevelSegments=opts.bevelSegments!=null?opts.bevelSegments:2;
    const curveSegments=opts.curveSegments!=null?opts.curveSegments:4;
    // Bevel:0 → fast path, return plain BoxGeometry without segments.
    if(bevel<=0){
      return new THREE.BoxGeometry(w,h,d);
    }
    // Clamp bevel so it can't exceed half of the smallest in-plane dim.
    const cb=Math.min(bevel, w*0.4, d*0.4, h*0.45);
    // Build a square shape (top-down view of the box) inset by `cb` so
    // the extruded bevel lands at the original w×d outline.
    const hw=w*0.5 - cb, hd=d*0.5 - cb;
    const shape=new THREE.Shape();
    shape.moveTo(-hw, -hd);
    shape.lineTo( hw, -hd);
    shape.lineTo( hw,  hd);
    shape.lineTo(-hw,  hd);
    shape.lineTo(-hw, -hd);
    const geo=new THREE.ExtrudeGeometry(shape, {
      depth: h - cb*2,
      bevelEnabled: true,
      bevelSegments: bevelSegments,
      bevelSize: cb,
      bevelThickness: cb,
      steps: 1,
      curveSegments: curveSegments
    });
    // ExtrudeGeometry extrudes along +Z; rotate so box stands along Y.
    geo.rotateX(-Math.PI/2);
    // Re-center vertically. ExtrudeGeometry's exact bevel-vertex placement
    // depends on internals; just compute the actual bounding box and shift
    // so the geometry is symmetric around y=0 (matching what BoxGeometry
    // would have given).
    geo.computeBoundingBox();
    const _bb=geo.boundingBox;
    const _cy=(_bb.min.y + _bb.max.y) * 0.5;
    if(Math.abs(_cy) > 1e-4) geo.translate(0, -_cy, 0);
    geo.computeVertexNormals();
    return geo;
  }

  // ── 6. taperedPrism ───────────────────────────────────────────────────
  // 4-sided tapered prism — obelisk shaft. NOT a rotated cylinder.
  function taperedPrism(opts){
    opts=opts||{};
    const topW=opts.topW||0.4;
    const botW=opts.bottomW||0.7;
    const h=opts.height||12;
    // 8 vertices: 4 bottom corners + 4 top corners
    const positions=[
      // bottom
      -botW, 0,  -botW,
       botW, 0,  -botW,
       botW, 0,   botW,
      -botW, 0,   botW,
      // top
      -topW, h,  -topW,
       topW, h,  -topW,
       topW, h,   topW,
      -topW, h,   topW
    ];
    // Faces: 4 sides + bottom (top is closed by capstone separately)
    const indices=[
      // -Z side
      0,1,5, 0,5,4,
      // +X side
      1,2,6, 1,6,5,
      // +Z side
      2,3,7, 2,7,6,
      // -X side
      3,0,4, 3,4,7,
      // bottom (face down)
      0,3,2, 0,2,1
    ];
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  // ── 7. pyramidCap ─────────────────────────────────────────────────────
  // Pyramidal capstone — obelisk top. Ook 4-sided.
  function pyramidCap(opts){
    opts=opts||{};
    const baseW=opts.baseW||0.55;
    const h=opts.height||1.2;
    const positions=[
      // base
      -baseW, 0, -baseW,
       baseW, 0, -baseW,
       baseW, 0,  baseW,
      -baseW, 0,  baseW,
      // apex
       0, h, 0
    ];
    const indices=[
      // 4 sloped sides
      0,1,4,
      1,2,4,
      2,3,4,
      3,0,4,
      // base (faces down)
      0,3,2, 0,2,1
    ];
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  // ── 8. entasisShaft ───────────────────────────────────────────────────
  // Greek-style pillar shaft via LatheGeometry — base / mid-bulge / top.
  // Entasis = de subtiele zwelling in midden van klassieke pilaren.
  function entasisShaft(opts){
    opts=opts||{};
    const lod=opts.lod!=null?opts.lod:(_MOBILE()?1:0);
    const sides=Math.max(8, (opts.sides||24) >> lod);
    const baseR=opts.baseRadius||0.65;
    const midR=opts.midRadius||0.7;
    const topR=opts.topRadius||0.55;
    const h=opts.height||5;
    // 7 lathe-points: bottom-edge → base flare → entasis bulge mid → taper to top
    // Rotated around Y-axis to produce shaft.
    const pts=[
      new THREE.Vector2(0,0),
      new THREE.Vector2(baseR, 0),
      new THREE.Vector2(baseR*0.98, h*0.10),
      new THREE.Vector2(midR, h*0.45),
      new THREE.Vector2(midR*0.97, h*0.65),
      new THREE.Vector2(topR, h),
      new THREE.Vector2(0, h)
    ];
    return new THREE.LatheGeometry(pts, sides);
  }

  // ── 9. applyAtmosphericPerspective — material color → fog blend ──────
  // Variant A (default): one-time material modification at build time.
  // Mesh must have a unique (cloned) material — caller decides.
  // Lerps material.color toward fogColor by clamped distance ratio.
  // No per-frame cost.
  //
  // Hoisted scratch Color (`_fogScratch`) reused across calls so a typical
  // build (~26 atmospheric calls in sandstorm Phase 3A) doesn't allocate
  // 26 separate Color objects during world-build.
  const _fogScratch = new THREE.Color();
  function applyAtmosphericPerspective(mesh, opts){
    if(!mesh || !mesh.material){
      if(window.dbg) dbg.warn('proc-geom','applyAtmosphericPerspective: mesh missing material');
      return;
    }
    opts=opts||{};
    const fogColor=opts.fogColor||'#e8b878';
    const startDist=opts.startDistance!=null?opts.startDistance:150;
    const fullDist=opts.fullBlendDistance!=null?opts.fullBlendDistance:400;
    const anchor=opts.cameraAnchor||new THREE.Vector3(0,0,0);
    const maxBlend=opts.maxBlend!=null?opts.maxBlend:0.7;
    const dx=mesh.position.x - anchor.x;
    const dz=mesh.position.z - anchor.z;
    const dist=Math.hypot(dx, dz);
    const t=Math.max(0, Math.min(1, (dist-startDist) / Math.max(1, fullDist-startDist)));
    if(t<=0) return; // close enough — no blend
    _fogScratch.set(fogColor);
    const blend=t*maxBlend;
    const apply=(m)=>{
      if(!m || !m.color) return;
      m.color.lerp(_fogScratch, blend);
    };
    if(Array.isArray(mesh.material)) mesh.material.forEach(apply);
    else apply(mesh.material);
  }

  window.ProcGeometry = {
    organicCylinder, duneCap, curvedTrunk, strataStack,
    beveledBox, taperedPrism, pyramidCap, entasisShaft,
    applyAtmosphericPerspective
  };
})();
