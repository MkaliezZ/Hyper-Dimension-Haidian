import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {projectRoot} from '../src/base.mjs';import {SurfaceRaster} from '../src/surface-raster.mjs';import {buildArchitecturalMesh,footprintArea} from '../src/coherent-buildings.mjs';import {decodePng,encodePng} from '../scripts/png-codec.mjs';
import {HEIGHT_SCALE,DEPTH_GROUND,surfaceProject,encodeSurfaceDepth,decodeSurfaceDepth,actorFragmentDepth,maskActor} from '../public/surface-depth.js';
import {project,unproject} from '../public/oblique-layout.js';import {createCampusWalking} from '../public/campus-walking.js';import {createSafePathfinder} from '../src/safe-pathfinding.mjs';import {createCampusNavigation} from '../src/navigation.mjs';
import {LANDSCAPE_SOURCE} from '../public/campus-landscape-data.js';import {campusLandscape,FOUNTAIN_GARDEN} from '../public/campus-landscape.js';import {inFootprint} from '../public/pixel-campus-art.js';import {FOUNTAIN} from '../public/campus-layout.js';
const campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8')),dir=join(projectRoot,'public/assets/coherent'),m=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
test('landscape retains official tree coordinates exactly and accounts for every rejected snapshot conflict',()=>{
  const L=campusLandscape(campus),source=new Map(LANDSCAPE_SOURCE.trees.map(t=>[t.id,t])),rejected=new Set(L.rejected.map(r=>r.id));
  assert.equal(L.metrics.randomlyPlacedTrees,0);assert(L.trees.length>2000);assert.equal(L.metrics.sourceTrees,L.trees.length+LANDSCAPE_SOURCE.trees.filter(t=>rejected.has(t.id)).length);
  for(const t of L.trees){assert.deepEqual([t.x,t.z],source.get(t.id).point);assert(!campus.buildings.some(b=>inFootprint(t.x,t.z,b.rings)));assert(Math.hypot(t.x-FOUNTAIN.x,t.z-FOUNTAIN.z)>FOUNTAIN.rimRadius+.5);assert(!rejected.has(t.id));}
  assert.throws(()=>campusLandscape({...campus,geometryHash:'wrong-campus'}),/different campus/);
  const publicText=JSON.stringify(LANDSCAPE_SOURCE);for(const field of ['MemorialDonor','MemorialDedication','last_edited_user','created_user','Notes'])assert(!publicText.includes('"'+field+'"'));
});
test('active official benches are rendered as visible depth surfaces, and fountain retains registered centre and open garden gates',async()=>{
  const L=campusLandscape(campus),rows=m.objects.filter(o=>o.kind==='bench'),source=new Map(LANDSCAPE_SOURCE.benches.map(b=>[b.id,b])),visible=new Set();
  assert(L.benches.length>400);assert.equal(rows.length,L.benches.length);for(const b of rows){assert.deepEqual(b.point,source.get(b.id).point);assert.equal(b.status,'Active');assert(Number.isFinite(b.angle));assert.equal(b.positionStatus,'official-public-GIS');}
  const benchIds=new Set(rows.map(o=>o.owner));for(const tile of m.tiles){const d=decodePng(await readFile(join(dir,tile.depth)));for(let i=0;i<d.data.length;i+=4)if(d.data[i+3]&&benchIds.has(tile.owners[d.data[i+2]]))visible.add(tile.owners[d.data[i+2]]);}
  assert(visible.size>250,'chairs must occupy actual visible pixels, not just manifest entries');
  const f=m.objects.find(o=>o.id==='fountain');assert.deepEqual(f.point,[FOUNTAIN.x,FOUNTAIN.z]);assert(FOUNTAIN_GARDEN.walkOuterRadius<FOUNTAIN_GARDEN.bedInnerRadius);assert(FOUNTAIN_GARDEN.gateHalfAngle>.1);assert.equal(m.objects.filter(o=>o.kind==='garden').length,4);
  assert(L.benches.filter(b=>Math.hypot(b.point[0]-FOUNTAIN.x,b.point[1]-FOUNTAIN.z)<50).length>=8);
});
test('all 74 buildings share one material/projection and match original ground rings and metric scale',()=>{
  assert.equal(m.buildingCount,74);assert.equal(m.sourcePhotoBillboardsOnMap,0);assert(m.allBuildingsUseSameRenderer);assert.equal(m.geometryHash,campus.geometryHash);assert.equal(m.projection.groundMapScale,1);assert.equal(m.projection.sourceScale,1);
  const rows=m.objects.filter(o=>o.kind==='building');assert.equal(rows.length,74);assert.equal(new Set(rows.map(o=>o.owner)).size,74);
  for(const b of campus.buildings){const o=rows.find(o=>o.id===b.id);assert(o);assert.equal(o.sourceScale,1);assert.equal(o.sourceHeight,b.height);assert.equal(o.materialLanguage,m.materialLanguage);assert(o.triangulationDeviation<1e-8);assert(Math.abs(o.footprintArea-footprintArea(b.rings))<1e-7);
    const normalized=b.rings.map(r=>r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1]?r.slice(0,-1):r);assert.deepEqual(o.groundRings,normalized);
    for(const ring of o.groundRings)for(const [x,z]of ring){const [u,v]=surfaceProject([x,0,z]),back=unproject(u,v);assert(Math.hypot(back[0]-x,back[1]-z)<1e-10);}
  }assert(Math.abs(HEIGHT_SCALE-.78*Math.sqrt(1.5))<1e-12);
});
test('depth codec, transparent samples and pixel coordinates preserve front/back values',()=>{
  for(const d of [-511,-135.22,0,47.314,511])for(const owner of [1,74,226]){const v=encodeSurfaceDepth(d,owner),decoded=decodeSurfaceDepth(v&255,v>>>8&255,v>>>16&255,v>>>24);assert(Math.abs(decoded.depth-d)<=1/128+1e-10);assert.equal(decoded.owner,owner);}
  assert.equal(decodeSurfaceDepth(255,255,255,0),null);assert.throws(()=>encodeSurfaceDepth(600,1));assert.throws(()=>encodeSurfaceDepth(0,256));
});
test('crossing surfaces use per-pixel depth and render identically in either object order',()=>{
  const inverse=([u,v,d])=>{const q=(d+.5*v/HEIGHT_SCALE)/(DEPTH_GROUND+.5*.39/HEIGHT_SCALE),h=(.39*q-v)/HEIGHT_SCALE;return [(u/.78-q)/2,h,(u/.78+q)/2];};
  const make=depths=>({points:[[0,0,depths[0]],[8,0,depths[1]],[0,8,depths[2]]].map(inverse),uv:[[0,0],[8,0],[0,8]]}),a=make([0,8,0]),b=make([4,4,4]);
  const render=reverse=>{const r=new SurfaceRaster(32,32);for(const [f,id,c]of reverse?[[b,2,0xffff0000],[a,1,0xff0000ff]]:[[a,1,0xff0000ff],[b,2,0xffff0000]])r.triangle(f,id,()=>c);return r;};
  const ab=render(false),ba=render(true);assert.deepEqual(ab.color.pixels,ba.color.pixels);assert.deepEqual(ab.owners,ba.owners);assert.equal(ab.owners[2*32+2],2);assert.equal(ab.owners[2*32+24],1);
});
test('actor mask uses each visible surface fragment and only outlines truly hidden pixels',()=>{
  const data=new Uint8ClampedArray(4*4*4).fill(255),position=[0,0,0],base={data,width:4,height:4,u0:-1,v0:-1,pixelsPerUnit:2,position};
  const sample=(u,v)=>({owner:u<0?1:2,depth:actorFragmentDepth(position,v)+(u<0?1:-1)}),mask=maskActor({...base,sample,silhouette:false});
  assert.equal(mask.hiddenPixels,8);assert.equal(mask.opaquePixels,16);assert.equal(mask.hiddenRatio,.5);assert.deepEqual(mask.owners,[1]);for(let y=0;y<4;y++)for(let x=0;x<4;x++)assert.equal(mask.data[(y*4+x)*4+3],x<2?0:255);
  const outline=maskActor({...base,sample,silhouette:true});assert.equal(outline.data[3],190);assert.equal(maskActor({...base,sample:()=>null}).hiddenPixels,0);
});
test('courtyard holes survive triangulation and all architectural points stay within inferred height budgets',()=>{
  const ring=[[-10,-10],[10,-10],[10,10],[-10,10]],hole=[[-3,-3],[-3,3],[3,3],[3,-3]],b={id:'fixture',code:'X',centroid:[0,0],rings:[ring,hole],height:14,heightStatus:'inferred'},mesh=buildArchitecturalMesh(b);assert.equal(mesh.area,364);assert(mesh.triangulationDeviation<1e-10);
  for(const face of mesh.faces)for(const p of face.points){assert(p[1]>=0&&p[1]<=14.0001);}
  for(const code of ['DEN','SUZ','RAI','SAV','HUB','KNE']){const b=campus.buildings.find(b=>b.code===code),model=buildArchitecturalMesh(b);assert(model.faces.length>10);for(const f of model.faces)for(const p of f.points)assert(p[1]>=-.00001&&p[1]<=b.height+.0001,code+' artistic height budget');}
});
test('tiled color/depth and same-renderer portraits have valid hashes, PNG dimensions and stable owner codes',async()=>{
  const owners=new Set(m.objects.map(o=>o.owner));assert.equal(m.portraits.length,7);assert(m.tiles.length>10);let surfaces=0;
  for(const tile of m.tiles){const cb=await readFile(join(dir,tile.color)),db=await readFile(join(dir,tile.depth));assert.equal(sha(cb),tile.colorSha256);assert.equal(sha(db),tile.depthSha256);const c=decodePng(cb),d=decodePng(db);assert.deepEqual([c.width,c.height,d.width,d.height],[tile.width,tile.height,tile.width,tile.height]);for(let i=0;i<d.data.length;i+=4)if(d.data[i+3]){assert(owners.has(tile.owners[d.data[i+2]]));assert(c.data[i+3]);surfaces++;}}
  assert(surfaces>500000);for(const p of m.portraits){const b=await readFile(join(dir,p.path));assert.equal(sha(b),p.sha256);const image=decodePng(b);assert.equal(image.width,p.width);assert.equal(image.height,p.height);}
  const vendor=JSON.parse(await readFile(join(projectRoot,'src/vendor/javascript-astar/SOURCE.json'),'utf8'));assert.equal(sha(await readFile(join(projectRoot,'src/vendor/javascript-astar/astar.cjs'))),vendor.sha256);assert.equal(vendor.license,'MIT');const material=await readFile(join(dir,m.materialImage.path));assert.equal(sha(material),m.materialImage.sha256);assert.equal(sha(await readFile(join(dir,m.facadeImage.path))),m.facadeImage.sha256);
  const fixture={width:2,height:2,data:Uint8ClampedArray.from([255,0,0,255,0,255,0,0,0,0,255,255,0,0,0,0])};assert.deepEqual(decodePng(encodePng(fixture)).data,fixture.data);
});
test('MIT A* connector sweeps walls and corners, and rejects a sealed courtyard without teleporting',()=>{
  const ground={bounds:[-30,-30,30,30],width:2,height:2,heights:[0,0,0,0]},wall=[[-3,-10],[3,-10],[3,10],[-3,10]],w=createCampusWalking({bounds:ground.bounds,terrain:ground,paths:[],buildings:[{rings:[wall]}]}),from=[-12,0,0],to=[12,0,0],path=createSafePathfinder(w).find(from,to);assert(path&&path.length>2);assert.deepEqual(path[0],from);assert.deepEqual(path.at(-1),to);assert(path.some(p=>Math.abs(p[2])>10.38));for(let i=1;i<path.length;i++)assert(w.segmentClear(path[i-1],path[i]));
  const sealed=createCampusWalking({bounds:ground.bounds,terrain:ground,paths:[],buildings:[{rings:[[[-10,-10],[10,-10],[10,10],[-10,10]],[[-3,-3],[-3,3],[3,3],[3,-3]]]}]});assert(sealed.allowed(0,0));assert.equal(createSafePathfinder(sealed).find([0,0,0],[20,0,20]),null);
});
test('all 81 landmark routes validate every swept leg, detouring unsafe raw GIS edges',()=>{
  // The four plaza seats now use their photo-calibrated central cluster. The
  // original GIS graph is unchanged; 31 raw legs intersect the current solids.
  const nav=createCampusNavigation(campus),unsafe=campus.graph.edges.filter(([a,b])=>!nav.walking.segmentClear(nav.nodes[a],nav.nodes[b]));assert.equal(unsafe.length,31);let detours=0,legs=0;
  for(const a of campus.landmarks)for(const b of campus.landmarks){const r=nav.route(a.arrivalNode,b.id);assert.equal(r.geometryHash,campus.geometryHash);assert.deepEqual(r.path[0].point,nav.nodes[a.arrivalNode]);detours+=r.obstacleDetours;for(let i=1;i<r.path.length;i++){assert(nav.walking.segmentClear(r.path[i-1].point,r.path[i].point));legs++;}}
  assert(detours>0);assert(legs>10000);
});
