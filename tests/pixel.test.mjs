import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {projectRoot} from '../src/base.mjs';
import {startUw} from '../server.mjs';
import {visitorCatalog,validateVisitorRecipe} from '../src/visitor-avatar.mjs';
import {PixelRaster,rgba} from '../public/pixel-raster.js';
import {pixelAvatar,PIXEL_FRAME} from '../public/pixel-avatar.js';
import {createPixelCampusArt,inFootprint} from '../public/pixel-campus-art.js';
import {pixelItem} from '../public/pixel-items.js';
const hash=data=>createHash('sha256').update(data).digest('hex');
const campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8'));

test('production map and wardrobe depend only on Canvas 2D; legacy 3D code is an offline compatibility archive',async()=>{
  const seen=new Set();async function visit(file){if(seen.has(file))return;seen.add(file);const code=await readFile(file,'utf8');assert(!/WebGLRenderer|OrbitControls|PerspectiveCamera|from ['"]three|\.glb\b/.test(code),file);for(const match of code.matchAll(/(?:import[^;]*?from\s*|import\s*)['"]([^'"]+)['"]/g)){assert(match[1].startsWith('.'),'unreviewed renderer dependency '+match[1]);await visit(resolve(dirname(file),match[1]));}}
  await visit(join(projectRoot,'public/app.js'));await visit(join(projectRoot,'public/inventory.js'));
  const html=await readFile(join(projectRoot,'public/index.html'),'utf8');assert(!/importmap|three|三维/.test(html));assert(html.includes('/pixel-ui.css'));assert(seen.has(join(projectRoot,'public/pixel-avatar-v3.js')));assert(seen.has(join(projectRoot,'public/pixel-campus-art.js')));assert(seen.has(join(projectRoot,'public/campus-walking.js')));
  assert.equal(visitorCatalog.generator,'uw-pixel-3.0.0');assert.equal(visitorCatalog.versions.length,6);
});

test('pixel drawing clips out-of-range rectangles and preserves transparent courtyard holes without row corruption',()=>{
  const p=new PixelRaster(20,20);p.fill('#123456');const before=hash(p.data);p.rect(-40,0,10,2,'#ffffff');p.rect(30,10,2,2,'#ffffff');p.rect(0,-40,10,10,'#ffffff');assert.equal(hash(p.data),before);
  p.polygon([[[2,2],[18,2],[18,18],[2,18]],[[7,7],[13,7],[13,13],[7,13]]],'#abcdef');assert.equal(p.pixels[4*20+4],rgba('#abcdef'));assert.equal(p.pixels[10*20+10],rgba('#123456'));assert.equal(p.pixels[0],rgba('#123456'));
});

test('all 74 real UW footprint rings, five courtyard holes and nine landmarks survive in a deterministic flat pixel tilemap',()=>{
  const before=hash(JSON.stringify(campus)),a=createPixelCampusArt(campus),b=createPixelCampusArt(campus);assert.equal(hash(a.raster.data),hash(b.raster.data));assert.equal(hash(JSON.stringify(campus)),before);assert.equal(a.metrics.buildings,74);assert.equal(a.metrics.courtyards,5);assert.equal(a.metrics.landmarks,9);assert.equal(a.metrics.threeDimensionalProjection,false);assert.equal(a.metrics.sourceGeometryHash,campus.geometryHash);assert.deepEqual([a.width,a.height],[1336,1568]);assert(a.metrics.cherryTrees>=10);
  for(const row of campus.buildings){const roof=a.roofs.get(row.id);assert.deepEqual(roof.rings,row.rings.map(r=>r.map(p=>a.toPixel(...p))));for(const hole of row.rings.slice(1)){const average=hole.reduce((p,n)=>[p[0]+n[0]/hole.length,p[1]+n[1]/hole.length],[0,0]);if(inFootprint(...average,[hole]))assert(!inFootprint(...average,row.rings));}}
  const pond=a.toPixel(9.89,266.67);assert.equal(a.raster.pixels[pond[1]*a.width+pond[0]],rgba('#4c7b87'));const plaza=a.toPixel(-120,20);assert.notEqual(a.raster.pixels[plaza[1]*a.width+plaza[0]],a.raster.pixels[0]);
});

test('38 composable pixel parts are distinct, with four directions, actions, height, skin and colors; incompatibilities remain enforced',()=>{
  const seen=new Set();for(const p of visitorCatalog.parts){const recipe=structuredClone(visitorCatalog.defaultRecipe);recipe.parts[p.slot]=p.id;if(p.slot!=='accessory')recipe.parts.accessory='accessory-none';if(p.id==='accessory-backpack')recipe.parts.top='top-tee';validateVisitorRecipe(recipe);const image=pixelAvatar(recipe,visitorCatalog.skins),id=p.slot+hash(image.data);assert(!seen.has(id),p.id+' duplicates another part');seen.add(id);assert.deepEqual([image.width,image.height],[24,32]);for(let i=3;i<image.data.length;i+=4)assert([0,255].includes(image.data[i]));}
  assert.equal(seen.size,38);const recipe=visitorCatalog.defaultRecipe;assert.equal(new Set(PIXEL_FRAME.directions.map(direction=>hash(pixelAvatar(recipe,visitorCatalog.skins,{direction}).data))).size,4);
  assert(new Set([0,1,2,3].map(frame=>hash(pixelAvatar(recipe,visitorCatalog.skins,{action:'walk',frame}).data))).size>=3);assert.notEqual(hash(pixelAvatar(recipe,visitorCatalog.skins).data),hash(pixelAvatar(recipe,visitorCatalog.skins,{action:'wave'}).data));
  for(const change of [{height:'short'},{height:'tall'},{skin:'ebony'},{colors:{...recipe.colors,top:'#d47764'}}])assert.notEqual(hash(pixelAvatar(recipe,visitorCatalog.skins).data),hash(pixelAvatar({...recipe,...change},visitorCatalog.skins).data));
  assert.throws(()=>validateVisitorRecipe({...structuredClone(recipe),parts:{...recipe.parts,hair:'hair-bun',accessory:'accessory-cap'}}),/穿插/);
  assert.equal(new Set(['bookmark','postcard','stamp','wave','note'].map(k=>hash(pixelItem(k).data))).size,5);
});

test('all delivered pixel art has hashes and provenance, with 48 frames per preset and an unchanged transparent generated atlas',async()=>{
  const dir=join(projectRoot,'public/assets/pixel'),m=JSON.parse(await readFile(join(dir,'asset-manifest.json'),'utf8'));assert.equal(m.files.length,8);assert.equal(m.style,'true-2d-top-down-pixel');for(const item of m.files){const data=await readFile(join(dir,item.path));assert.equal(data.length,item.bytes);assert.equal(hash(data),item.sha256,item.path);assert.equal(data.readUInt32BE(16),item.width);assert.equal(data.readUInt32BE(20),item.height);assert.equal(data[25],6,'RGBA alpha preserved');}
  const layout=JSON.parse(await readFile(join(dir,'sprite-layout.json'),'utf8'));assert.equal(layout.frames.length,48);assert.equal(layout.directions.length,4);assert.equal(layout.actions.length,3);const atlas=m.files.find(f=>f.tool);assert.deepEqual(atlas.cell,[418,418]);assert.equal(atlas.order.length,9);assert.equal(hash(await readFile(join(dir,atlas.path))),'22edbb374452cac654005cfffa0ba17583f5aa2c21176465556f969d457eda0e');
});

test('pixel delivery keeps v1-v5 avatar receipts readable and isolated; explicit pixel save preserves history and survives restart',async()=>{
  const dir=await mkdtemp(join(projectRoot,'.local/qa-pixel-data-'));let app=await startUw({port:0,dataDir:dir,provider:null});
  const client=()=>({cookie:'',async call(path,body){const r=await fetch(app.origin+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json',Cookie:this.cookie}});if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,value:await r.json()};}});
  try{const a=client(),b=client();for(const version of [visitorCatalog.legacy,visitorCatalog.previous,visitorCatalog.rounded,visitorCatalog.pixel,visitorCatalog.detailed]){const revision=(await a.call('/api/avatar')).value.profile?.revision||0,recipe={...structuredClone(visitorCatalog.defaultRecipe),catalogVersion:version.version,generatorVersion:version.generator},saved=(await a.call('/api/avatar',{requestId:randomUUID(),expectedRevision:revision,displayName:'Fictitious compatibility visitor',recipe})).value;assert.equal(saved.rendererHash,version.rendererHash);const before=await readFile(join(dir,'state.json'),'utf8'),read=(await a.call('/api/avatar')).value;assert.deepEqual(read.profile,saved);assert.equal(read.presentation.recipe.generatorVersion,'uw-pixel-3.0.0');assert.equal(await readFile(join(dir,'state.json'),'utf8'),before);}
    const saved=(await a.call('/api/avatar',{requestId:randomUUID(),expectedRevision:5,displayName:'Fictitious pixel visitor',recipe:visitorCatalog.defaultRecipe})).value;assert.equal(saved.revision,6);assert.equal((await a.call('/api/avatar/history')).value.profiles.length,5);assert.equal((await b.call('/api/avatar')).value.profile,null);await app.close();app=await startUw({port:0,dataDir:dir,provider:null});assert.deepEqual((await a.call('/api/avatar')).value.profile,saved);
    for(const path of ['/','/app.js','/pixel-scene.js','/pixel-avatar.js','/pixel-editor.js','/pixel-items.js','/pixel-ui.css','/assets/pixel/asset-manifest.json','/inventory.html'])assert.equal((await fetch(app.origin+path)).status,200,path);for(const path of ['/art-scene.js','/visitor-chibi-model.js','/visitor-editor.js','/vendor/three/three.module.js','/compat/3d-v052/public/app.js'])assert.equal((await fetch(app.origin+path)).status,404,path);
    const services=(await a.call('/api/campus-services?place=red-square')).value;assert.equal(services.modules.length,23);assert(services.modules.some(m=>m.id==='agent-tasks'&&!m.enabled&&!m.url));assert.equal(services.state,'not-configured');assert(services.modules.some(m=>m.id==='avatar'&&!m.enabled&&!m.url));assert(services.modules.some(m=>m.id==='community'));assert(services.modules.some(m=>m.id==='partners'));assert(services.modules.some(m=>m.id==='knowledge'));assert(services.modules.some(m=>m.id==='history'));assert(services.modules.some(m=>m.id==='jobs'));
    console.log('QA pixel data: '+dir);
  }finally{await app.close();}
});
