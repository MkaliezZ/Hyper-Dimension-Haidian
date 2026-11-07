import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildArchitecturalMesh} from '../src/coherent-buildings.mjs';
import {createCampusWalking} from '../public/campus-walking.js';
import {decodePng} from '../scripts/png-codec.mjs';
const root=new URL('../',import.meta.url),load=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const campus=await load('data/campus.json'),source=await load('data/haidian-architecture.json'),walking=createCampusWalking(campus);

test('all buildings carry reviewed appearance evidence or explicit exterior uncertainty, with finite production meshes',()=>{
 assert.deepEqual(new Set(Object.keys(source.recipes)),new Set(campus.buildings.map(b=>b.id)));
 for(const b of campus.buildings){
  const r=source.recipes[b.id],mesh=buildArchitecturalMesh(b);assert.equal(b.architecture.kind,r.kind);
  assert.ok(mesh.faces.length>0);assert.ok(mesh.triangulationDeviation<1e-8);
  for(const face of mesh.faces)for(const p of face.points)assert.ok(p.every(Number.isFinite));
  if(r.confidence==='unverified-exterior'){assert.equal(r.review.length,0);assert.match(r.observed.join(' '),/尚无|暂无/);}
  if(r.confidence==='multi-view-exterior')assert.ok(new Set(r.review.map(s=>s.sceneId)).size>=2,b.id);
  for(const scene of r.review){
   assert.equal(scene.source,`https://720yun.com/t/b2vkue1es1q?scene_id=${scene.sceneId}`);
   for(const view of scene.views){assert.match(view.sha256,/^[a-f0-9]{64}$/);assert.match(view.original,/\/833jOgyaey0\/\d+\/imgs\/mobile_[frblu]\.jpg$/);}
  }
  assert.deepEqual(b.architecture.collisionParts,b.architecture.parts.filter(p=>p.solid).flatMap(p=>p.rings.map(r=>[r])));
 }
});

test('Chinese galleries are open red-post structures with swept roofs, accessible platforms and actual post collisions',()=>{
 const b=campus.buildings.find(b=>b.id==='chinese-pavilion'),parts=b.architecture.parts,mesh=buildArchitecturalMesh(b);
 assert.equal(parts.filter(p=>p.shape==='chinese-roof').length,3);
 assert.ok(parts.filter(p=>p.role==='column').length>=20);
 assert.equal(parts.filter(p=>p.solid&&p.role!=='column'&&p.role!=='rail').length,0,'No closed rectangular building hidden behind the pavilion artwork');
 const platform=parts.find(p=>p.role==='platform'),r=platform.rings[0],x=(r[0][0]+r[2][0])/2,z=r[0][1]+(r[2][1]-r[0][1])*.30;
 assert.ok(walking.allowed(x,z));assert.ok(Math.abs(walking.height(x,z)-.475)<1e-8);
 const column=parts.find(p=>p.role==='column'),c=column.rings[0].slice(0,-1).reduce((a,p)=>[a[0]+p[0]/8,a[1]+p[1]/8],[0,0]);assert.equal(walking.allowed(...c),false);
 assert.ok(mesh.faces.some(f=>f.material==='chinese-tile'));
 assert.ok(mesh.faces.some(f=>f.material==='painted-beam'));
 assert.ok(!mesh.faces.some(f=>f.material==='brick'),'No brick/window facades on the gallery');
});

test('rounded facades, curved roof slabs and inflated halls retain their source-distinct geometry',()=>{
 const get=id=>campus.buildings.find(b=>b.id===id);
 assert.ok(get('library').rings[0].length>16);
 for(const id of ['liberal-arts','middle-teaching','south-boys-dormitory']){
  const b=get(id);assert.ok(b.rings[0].length>16);assert.ok(b.architecture.parts.some(p=>p.role==='curved-glass-bay'));assert.ok(b.architecture.parts.some(p=>p.role==='overhanging-slab'));
 }
 for(const id of ['table-tennis-dome','fencing-center']){
  const b=get(id),mesh=buildArchitecturalMesh(b),shell=mesh.faces.filter(f=>f.material==='membrane');assert.ok(shell.length>500);
  assert.ok(Math.max(...shell.flatMap(f=>f.points.map(p=>p[1])))>9);
  assert.ok(shell.some(f=>Math.abs(f.normal[1])<.5));assert.ok(shell.some(f=>Math.abs(f.normal[1])>.95));
 }
});

test('swept routes cannot cut a short concave campus corner or a pavilion column between sample points',()=>{
 const a=[173.125,.055,21.416666666666668],b=[172.75,.055,20.5];assert.ok(walking.allowed(a[0],a[2]));assert.ok(walking.allowed(b[0],b[2]));assert.equal(walking.segmentClear(a,b),false);assert.equal(walking.segmentClear(b,a),false);
 const pavilion=campus.buildings.find(b=>b.id==='chinese-pavilion'),column=pavilion.architecture.parts.find(p=>p.role==='column'),r=column.rings[0].slice(0,-1),x=r.reduce((s,p)=>s+p[0]/r.length,0),z=r.reduce((s,p)=>s+p[1]/r.length,0);
 assert.equal(walking.segmentClear([x-1,.475,z],[x+1,.475,z]),false);
});

test('the data manifest and baked color/depth owners describe the same reviewed campus, with all 26 buildings visible',async()=>{
 const data=await load('DATA-MANIFEST.json'),scene=await load('public/assets/coherent/manifest.json');
 assert.equal(data.geometryHash,campus.geometryHash);assert.equal(scene.geometryHash,campus.geometryHash);
 for(const file of data.files){const bytes=await readFile(new URL(file.path,root));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
 const visible=new Set();
 for(const tile of scene.tiles){
  const depth=decodePng(await readFile(new URL('public/assets/coherent/'+tile.depth,root))),color=decodePng(await readFile(new URL('public/assets/coherent/'+tile.color,root)));
  for(let i=0;i<depth.data.length;i+=4)if(depth.data[i+3]){const owner=tile.owners[depth.data[i+2]];assert.ok(owner);assert.ok(color.data[i+3]);visible.add(owner);}
 }
 for(const b of scene.objects.filter(o=>o.kind==='building'))assert.ok(visible.has(b.owner),b.id+' must be present in the clickable depth scene');
 assert.equal(scene.objects.filter(o=>o.kind==='building').length,26);
});
