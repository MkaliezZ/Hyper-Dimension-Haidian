import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,unlink,access} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {startUw} from '../server.mjs';
import {baseRoot,projectRoot} from '../src/base.mjs';
import {visitorCatalog,validateVisitorRecipe} from '../src/visitor-avatar.mjs';
import {buildVisitorModel} from '../compat/3d-v052/public/visitor-model.js';
import {createCampusNavigation,positionAlong} from '../src/navigation.mjs';

test('failed knowledge initialization releases the visitor store so a corrected configuration can start',async()=>{
  const dir=await mkdtemp(join(projectRoot,'.local/qa-visitor-'));
  await writeFile(join(dir,'knowledge.json'),'invalid JSON');
  await assert.rejects(startUw({port:0,dataDir:dir,provider:null}),SyntaxError);
  await assert.rejects(access(join(dir,'base.lock')),{code:'ENOENT'});
  await unlink(join(dir,'knowledge.json'));
  const app=await startUw({port:0,dataDir:dir,provider:null});
  try{assert.equal((await fetch(app.origin+'/health')).status,200);}finally{await app.close();}
  console.log('QA startup state (fictitious): '+dir);
});

test('archived v3 renderer retains 38 distinct meshes and articulated actions for old receipts',async()=>{
  const T=await import(pathToFileURL(join(baseRoot,'node_modules/three/build/three.module.js')).href);
  assert.equal(visitorCatalog.parts.length,38);
  const signature=model=>{let triangles=0;const shape=[model.scale.toArray()];model.updateMatrixWorld(true);model.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;const hash=createHash('sha256');for(const a of [o.geometry.attributes.position.array,o.geometry.index?.array])if(a)hash.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));shape.push([hash.digest('hex'),o.matrixWorld.toArray(),o.material.color?.getHex()]);}});return {triangles,shape:JSON.stringify(shape)};};
  const signatures=new Set();let max=0;
  for(const part of visitorCatalog.parts){
    const recipe={...structuredClone(visitorCatalog.defaultRecipe),catalogVersion:visitorCatalog.rounded.version,generatorVersion:visitorCatalog.rounded.generator};recipe.parts[part.slot]=part.id;
    // Remove optional accessories only in this single-part fixture, not in saved user recipes.
    if(part.slot!=='accessory')recipe.parts.accessory='accessory-none';
    if(part.id==='accessory-backpack')recipe.parts.top='top-tee';
    validateVisitorRecipe(recipe);const model=buildVisitorModel(T,recipe,visitorCatalog.skins),s=signature(model);max=Math.max(max,s.triangles);
    assert(s.triangles<30000,part.id+' rounded character triangle budget');
    model.traverse(o=>{if(o.isMesh){assert.equal(o.material.flatShading,false);assert(o.material.roughness>=.8);assert.equal(o.material.metalness,0);}});
    const box=new T.Box3().setFromObject(model);assert(box.min.y>-.13&&box.max.y<2.25,part.id+' physical scale');
    assert(!signatures.has(part.slot+':'+s.shape),'part geometry is distinct: '+part.id);signatures.add(part.slot+':'+s.shape);
    model.userData.animate(1,'walk');assert.notEqual(model.getObjectByName('leftLeg').rotation.x,0);
    model.userData.animate(1,'idle');model.updateMatrixWorld(true);const restingHand=model.getObjectByName('mitten-right').getWorldPosition(new T.Vector3());
    model.userData.animate(1,'wave');model.updateMatrixWorld(true);const wavingHand=model.getObjectByName('mitten-right').getWorldPosition(new T.Vector3());assert(wavingHand.y>restingHand.y+.3);assert(wavingHand.x>.36,'waving hand crosses inside the face');model.userData.dispose();
  }
  const invalid=structuredClone(visitorCatalog.defaultRecipe);invalid.parts.hair='hair-bun';invalid.parts.accessory='accessory-cap';assert.throws(()=>validateVisitorRecipe(invalid),/穿插/);
  console.log(JSON.stringify({choices:38,maxTriangles:max,rendererHash:visitorCatalog.rendererHash}));
});

test('mid-edge replanning has no node teleport, stopping and resuming retain the same route position',async()=>{
  const campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8')),nav=createCampusNavigation(campus);
  let validStarts=0,rejectedUnsafeStarts=0;
  for(const [a,b] of campus.graph.edges){
    const point=nav.nodes[a].map((v,i)=>v+(nav.nodes[b][i]-v)*.43);
    // Raw GIS edges include points inside current obstacles. Those must be rejected,
    // rather than manufacturing a route through a building to satisfy an old fixture.
    if(!nav.walking.allowed(point[0],point[2])){assert.throws(()=>nav.route(point,'hub'),error=>error.code==='off_path');rejectedUnsafeStarts++;continue;}
    validStarts++;
    for(const to of ['red-square','hub','fountain']){
      const route=nav.route(point,to);assert(Math.hypot(...point.map((v,i)=>v-route.path[0].point[i]))<.01);
      assert.equal(route.geometryHash,campus.geometryHash);
      assert.deepEqual(positionAlong({...route,startedAt:1000,previewSpeed:18},1000),route.path[0].point);
    }
  }
  assert(validStarts>300);assert(rejectedUnsafeStarts>0);
  assert.throws(()=>nav.route([NaN,0,0],'hub'));
});

test('legacy avatars render unchanged and upgrades preserve an isolated, restorable history',async()=>{
  const T=await import(pathToFileURL(join(baseRoot,'node_modules/three/build/three.module.js')).href);
  const dir=await mkdtemp(join(projectRoot,'.local/qa-paper-visitor-'));const app=await startUw({port:0,dataDir:dir,provider:null});
  const client=()=>({cookie:'',async call(path,body){const response=await fetch(app.origin+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json',Cookie:this.cookie}});if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,value:await response.json()};}});
  try{
    const a=client(),b=client(),legacyRecipe={...structuredClone(visitorCatalog.defaultRecipe),catalogVersion:visitorCatalog.legacy.version,generatorVersion:visitorCatalog.legacy.generator};
    const original=(await a.call('/api/avatar',{requestId:randomUUID(),expectedRevision:0,displayName:'Legacy fixture',recipe:legacyRecipe})).value;
    const old=buildVisitorModel(T,legacyRecipe,visitorCatalog.skins);assert.equal(old.name,'UWVisitor');old.userData.dispose();
    const upgraded=(await a.call('/api/avatar',{requestId:randomUUID(),expectedRevision:1,displayName:'Paper fixture',recipe:visitorCatalog.defaultRecipe})).value;
    assert.equal(upgraded.revision,2);assert.notEqual(upgraded.modelHash,original.modelHash);
    assert.deepEqual((await a.call('/api/avatar/history')).value.profiles,[original]);
    assert.deepEqual((await b.call('/api/avatar/history')).value.profiles,[]);
    const restored=(await a.call('/api/avatar',{requestId:randomUUID(),expectedRevision:2,displayName:original.displayName,recipe:original.recipe})).value;
    assert.equal(restored.modelHash,original.modelHash);assert.equal(restored.revision,3);
    assert.equal((await a.call('/api/avatar/history')).value.profiles.length,2);
  }finally{await app.close();}
  console.log('QA paper avatar fixture: '+dir);
});

test('visitor saves are server-owned, isolated, versioned, idempotent and survive restart; invalid identities and versions cannot overwrite',async()=>{
  const dir=await mkdtemp(join(projectRoot,'.local/qa-visitor-'));let app=await startUw({port:0,dataDir:dir,provider:null});
  const client=()=>({cookie:'',async call(path,body,extra={}){const r=await fetch(app.origin+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json',Cookie:this.cookie,...extra}});if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,value:await r.json()};}});
  try{
    const a=client(),b=client();assert.equal((await a.call('/api/avatar')).value.profile,null);
    const input={requestId:randomUUID(),expectedRevision:0,displayName:'Test Visitor',recipe:visitorCatalog.defaultRecipe};
    const saved=await a.call('/api/avatar',input);assert.equal(saved.status,200);assert.equal(saved.value.revision,1);
    assert.equal((await a.call('/api/avatar',input)).value.modelHash,saved.value.modelHash);
    assert.equal((await b.call('/api/avatar')).value.profile,null);
    assert.equal((await a.call('/api/avatar',{...input,displayName:'changed'})).status,409);
    assert.equal((await a.call('/api/avatar',{...input,requestId:randomUUID()})).status,409);
    assert.equal((await a.call('/api/avatar',{...input,requestId:randomUUID(),expectedRevision:1,recipe:{...input.recipe,evil:true}})).status,400);
    assert.equal((await a.call('/api/avatar',{...input,requestId:randomUUID(),expectedRevision:1},{Origin:'https://elsewhere.invalid'})).status,403);
    const move=(await a.call('/api/move',{requestId:randomUUID(),toId:'hub'})).value;
    const stopped=(await a.call('/api/move/stop',{requestId:randomUUID()})).value;assert(stopped.stopped);
    const resumed=(await a.call('/api/move',{requestId:randomUUID(),toId:'denny'})).value;
    assert(Math.hypot(...resumed.path[0].point.map((v,i)=>v-stopped.path[0].point[i]))<.01);
    await app.close();app=await startUw({port:0,dataDir:dir,provider:null});
    assert.deepEqual((await a.call('/api/avatar')).value.profile,saved.value);
    assert.equal((await a.call('/api/me')).value.move.startedAt,resumed.startedAt);
    assert.equal((await b.call('/api/avatar')).value.profile,null);
    console.log('QA visitor state (fictitious): '+dir);
  }finally{await app.close();}
});

test('rounded faces have a readable chibi proportion; all paper recipes keep their original renderer and budget',async()=>{
  const T=await import(pathToFileURL(join(baseRoot,'node_modules/three/build/three.module.js')).href);
  const current=buildVisitorModel(T,{...structuredClone(visitorCatalog.defaultRecipe),catalogVersion:visitorCatalog.rounded.version,generatorVersion:visitorCatalog.rounded.generator},visitorCatalog.skins),body=new T.Box3().setFromObject(current),face=new T.Box3().setFromObject(current.getObjectByName('face'));
  assert(face.getSize(new T.Vector3()).y/body.getSize(new T.Vector3()).y>.34);
  assert(face.getSize(new T.Vector3()).y/body.getSize(new T.Vector3()).y<.45);
  assert(current.getObjectByName('eye-white-1'));assert(current.getObjectByName('eye-white--1'));
  current.userData.dispose();
  for(const part of visitorCatalog.parts){
    const recipe={...structuredClone(visitorCatalog.defaultRecipe),catalogVersion:visitorCatalog.previous.version,generatorVersion:visitorCatalog.previous.generator};recipe.parts[part.slot]=part.id;
    const old=buildVisitorModel(T,recipe,visitorCatalog.skins);assert.equal(old.name,'UWPaperVisitor');let triangles=0;old.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});assert(triangles<6500);old.userData.dispose();
  }
});

test('latest appearance is a read-only projection and does not silently migrate stored avatars',async()=>{
  const dir=await mkdtemp(join(projectRoot,'.local/qa-ui-visitor-'));const app=await startUw({port:0,dataDir:dir,provider:null});let cookie='';
  const call=async(path,body)=>{const response=await fetch(app.origin+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json',Cookie:cookie}});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];assert.equal(response.status,200);return response.json();};
  try{
    const recipe={...structuredClone(visitorCatalog.defaultRecipe),catalogVersion:visitorCatalog.previous.version,generatorVersion:visitorCatalog.previous.generator};
    const saved=await call('/api/avatar',{requestId:randomUUID(),expectedRevision:0,displayName:'Paper profile fixture',recipe});
    const bytesBefore=await readFile(join(dir,'state.json'),'utf8'),data=await call('/api/avatar');
    assert.deepEqual(data.profile,saved);assert.equal(data.presentation.previewOnly,true);assert.equal(data.presentation.savedModelHash,saved.modelHash);assert.equal(data.presentation.recipe.generatorVersion,visitorCatalog.generator);assert.deepEqual(data.presentation.recipe.parts,recipe.parts);assert.notEqual(data.presentation.modelHash,saved.modelHash);
    assert.equal(await readFile(join(dir,'state.json'),'utf8'),bytesBefore,'appearance read changed user storage');
    assert.deepEqual((await call('/api/avatar/history')).profiles,[]);
  }finally{await app.close();}
  console.log('QA appearance fixture: '+dir);
});
