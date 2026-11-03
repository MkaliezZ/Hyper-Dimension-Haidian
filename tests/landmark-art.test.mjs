import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {join} from 'node:path';
import {projectRoot} from '../src/base.mjs';import {drawRedSquareFeatures,createLandmarkMaterials,prepareFountainPlume} from '../src/landmark-art.mjs';import {createCampusWalking} from '../public/campus-walking.js';import {RED_OBELISK} from '../public/red-square-layout.js';import {decodePng} from '../scripts/png-codec.mjs';
const dir=join(projectRoot,'public/assets/coherent'),campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8'));
test('photo-informed plaza solids fit their shared collision envelopes and keep registered tower/sculpture coordinates',async()=>{
  const bytes=await readFile(join(dir,'landmark-materials-v2.png')),material=createLandmarkMaterials(decodePng(bytes)),objects=[],triangles=[],walking=createCampusWalking(campus);
  drawRedSquareFeatures({triangle(face,owner){triangles.push({face,owner});}},o=>{objects.push(o);return objects.length;},material);
  assert.equal(objects.filter(o=>o.id.startsWith('red-square-seating-')).length,4);assert.equal(objects.filter(o=>o.id.startsWith('red-square-pylon-')).length,3);
  assert.deepEqual(objects.find(o=>o.id==='broken-obelisk').point,[RED_OBELISK.x,RED_OBELISK.z]);
  for(const {face,owner} of triangles){const o=objects[owner-1];for(const [x,h,z]of face.points){assert(!walking.allowed(x,z),o.id+' art must remain inside an existing non-walkable footprint');assert(h>=0&&Number.isFinite(h));}}
  for(const o of objects.filter(o=>o.id.startsWith('red-square-seating-'))){const points=triangles.filter(t=>t.owner===objects.indexOf(o)+1).flatMap(t=>t.face.points);assert(Math.max(...points.map(p=>p[1]))<=.65);assert(points.every(p=>Math.hypot(p[0]-o.point[0],p[2]-o.point[1])<=o.collisionEnvelope));}
});
test('landmark material is declared and hashed, with current paired scene tiles and published paving owners',async()=>{
  const m=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')),material=await readFile(join(dir,m.landmarkArt.materialImage.path));
  assert.equal(createHash('sha256').update(material).digest('hex'),m.landmarkArt.materialImage.sha256);assert.equal(m.landmarkArt.version,'photo-landmarks-2');
  assert(m.objects.some(o=>o.id==='red-square-paving'&&o.placeId==='red-square'));assert(m.objects.some(o=>o.id==='fountain-promenade'&&o.placeId==='fountain'));
  assert(m.tiles.every(t=>t.color.endsWith('-v2.png')&&t.depth.endsWith('-v2.png')));assert.equal(m.geometryHash,campus.geometryHash);assert.equal(m.sourcePhotoBillboardsOnMap,0);
  assert.equal(m.portraits.find(p=>p.placeId==='fountain').path,'portrait-fountain-v2.png');
});
test('spray reduction preserves transparent gaps and premultiplied white edges without black fringes',async()=>{
  const fixture={width:2,height:2,data:Uint8ClampedArray.from([255,255,255,255,0,0,0,0,0,0,0,0,255,255,255,255])},pixel=prepareFountainPlume(fixture,1,1);
  assert.deepEqual([...pixel.data],[255,255,255,128]);
  const m=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')),bytes=await readFile(join(dir,m.landmarkArt.plumeImage.path)),image=decodePng(bytes),small=prepareFountainPlume(image);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),m.landmarkArt.plumeImage.sha256);assert.deepEqual([small.width,small.height],[32,100]);
  const alphas=small.data.filter((_,i)=>i%4===3);assert(alphas.some(a=>a===0));assert(alphas.some(a=>a>240));assert(alphas.some(a=>a>0&&a<128));
});
