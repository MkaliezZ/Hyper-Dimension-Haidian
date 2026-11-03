import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {baseRoot,projectRoot} from '../src/base.mjs';
import {terrainHeight,terrainEdgeSamples,terrainPatchGeometry,buildingGrounding} from '../public/terrain-surface.js';
import {buildGroundedBuilding,paperCrownGeometry} from '../compat/3d-v052/public/paper-surfaces.js';
import {pointInBuilding} from '../compat/3d-v052/public/building-roofs.js';
const T=await import(pathToFileURL(join(baseRoot,'node_modules/three/build/three.module.js')).href);
const campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8'));

test('terrain sampling and paving match the rendered triangles, including the cell diagonal',()=>{
  const t={bounds:[0,0,1,1],width:2,height:2,heights:[0,0,0,10]};
  assert.equal(terrainHeight(t,.25,.25),0);assert.equal(terrainHeight(t,.75,.75),5);
  assert.equal(terrainHeight(t,.5,.5),0);assert.equal(terrainHeight(t,2,2),10);
  const g=terrainPatchGeometry(T,t,[[0,0],[1,0],[1,1],[0,1]],.2),p=g.attributes.position;
  let area=0;
  for(let i=0;i<p.count;i+=3){
    const v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,i+k));
    area+=Math.abs((v[1].x-v[0].x)*(v[2].z-v[0].z)-(v[1].z-v[0].z)*(v[2].x-v[0].x))/2;
    for(const weights of [[1/3,1/3,1/3],[.1,.2,.7]]){
      const q=v.reduce((a,b,k)=>a.addScaledVector(b,weights[k]),new T.Vector3());
      assert(Math.abs(q.y-terrainHeight(t,q.x,q.z)-.2)<1e-5,'paving bridges DEM triangles');
    }
    assert(g.attributes.normal.getY(i)>0);
  }
  assert(Math.abs(area-1)<1e-7,'paving must neither duplicate nor omit the clipped area');g.dispose();
});

test('all 74 building shells reach below every perimeter grade while keeping roofs, footprints and courtyard holes',()=>{
  let maximumOldGap=0,sampleCount=0;
  for(const b of campus.buildings){
    const original=JSON.stringify(b),{geometry,grounding}=buildGroundedBuilding(T,b,campus.terrain),p=geometry.attributes.position;
    maximumOldGap=Math.max(maximumOldGap,grounding.previousMaximumGap);sampleCount+=grounding.sampleCount;
    for(const ring of b.rings)for(let i=1;i<ring.length;i++)for(const q of terrainEdgeSamples(campus.terrain,ring[i-1],ring[i]))assert(q[1]-grounding.bottom>=.31999);
    const roof=geometry.groups.filter(g=>g.materialIndex===0);
    assert(roof.length>0);for(const group of roof)for(let i=group.start;i<group.start+group.count;i+=3){
      assert(Math.abs(p.getY(i)-b.baseY-b.height)<1e-4);
      const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
      assert(pointInBuilding(x,z,b.rings),'roof accidentally seals courtyard');
    }
    assert.equal(JSON.stringify(b),original,'source footprint or elevation was mutated');geometry.dispose();
  }
  assert.equal(campus.buildings.length,74);assert(maximumOldGap>12);
  // A valley half way along a long wall cannot be found by checking its two corners.
  const t={bounds:[0,0,2,2],width:3,height:3,heights:[10,10,10,10,0,10,10,10,10]};
  const b={baseY:10,height:8,rings:[[[0,1],[2,1],[2,2],[0,2],[0,1]]]};
  assert.equal(buildingGrounding(b,t).minimum,0);assert.equal(buildingGrounding(b,t).bottom,-.32);
  console.log(JSON.stringify({buildings:74,perimeterSamples:sampleCount,previousMaximumGap:maximumOldGap,burialMetres:.32,unsupported:0}));
});

test('landscape assets use folded-paper geometry and matte materials; pool rim is grounded and spray is bounded',async()=>{
  // Resolve browser import-map specifiers to the same sealed Three.js dependency for Node.
  const source=await readFile(join(projectRoot,'compat/3d-v052/public/art-scene.js'),'utf8');
  const rewritten=source.replace(/from '([^']+)'/g,(_,id)=>{
    const path=id==='three'?join(baseRoot,'node_modules/three/build/three.module.js'):id.startsWith('three/addons/')?join(baseRoot,'node_modules/three/examples/jsm',id.slice('three/addons/'.length)):join(projectRoot,'compat/3d-v052/public',id);
    return `from '${pathToFileURL(path).href}'`;
  });
  const {installCampusArt}=await import('data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64'));
  const scene=new T.Scene(),heightAt=(x,z)=>terrainHeight(campus.terrain,x,z);
  const art=installCampusArt({scene,campus,heightAt,inside:pointInBuilding,buildingMeshes:new Map()});
  assert.equal(art.stats.version,'0.4.0');assert.equal(art.stats.fountain.groundedRim,true);
  assert.equal(art.stats.fountain.droplets,64);assert.equal(art.stats.fountain.ringJets,28);
  assert.equal(art.stats.paperAssetFamilies.length,11);
  let triangles=0;
  art.root.traverse(o=>{assert(!o.isPoints,'photoreal spray points remain');if(o.isMesh){triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);for(const m of [].concat(o.material)){assert.equal(m.roughness,1);assert.equal(m.metalness,0);assert.equal(m.flatShading,true);if(o.isInstancedMesh&&m.vertexColors){assert(o.geometry.attributes.color,'instanced paper artwork needs a base color attribute');assert(o.geometry.attributes.color.array.some(c=>c>.1),'instanced artwork rendered black');}}}});
  assert(triangles<220000,'paper landscape geometry budget');art.update(1);art.update(2);
  const crown=paperCrownGeometry(T),n=crown.attributes.normal,p=crown.attributes.position;
  for(let i=0;i<p.count;i+=3){const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;assert(n.getX(i)*x+n.getZ(i)*z>0,'inverted paper foliage');}
  crown.dispose();const materials=new Set();scene.traverse(o=>{o.geometry?.dispose();for(const m of [].concat(o.material||[]))materials.add(m);});materials.forEach(m=>m.dispose());
  console.log(JSON.stringify({paperLandscapeTriangles:triangles,trees:art.stats.trees,drawGroups:art.stats.drawGroups,water:art.stats.fountain}));
});
