// Haidian adaptation of retained UW behavior tests; original receipts remain unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {baseRoot,projectRoot,protocol} from '../src/base.mjs';
import {createCampusWorld,UW_SCENE} from '../src/campus-world.mjs';
import {createCampusNavigation} from '../src/navigation.mjs';
const {publicPlaces,publicPlace,toolPlace}=await import(pathToFileURL(join(baseRoot,'src/platform/world-places.mjs')).href);
const {publicAnchor}=await import(pathToFileURL(join(baseRoot,'src/platform/community.mjs')).href);
test('outdoor published anchors preserve geometry and school boundaries without fabricated indoor rooms',async()=>{
  const campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8')),nav=createCampusNavigation(campus),pack={spaceId:campus.id,scenes:[]};
  const world=createCampusWorld(campus,nav,pack,null),places=publicPlaces(world,campus.id);
  assert.equal(places.length,33);assert.equal(new Set(places.map(p=>p.entityId)).size,33);
  for(const b of campus.buildings)assert(places.some(p=>p.entityId===(campus.landmarks.find(l=>l.buildingId===b.id)?.id||b.id)));assert.equal(pack.scenes.length,0);
  for(const p of places){assert.equal(p.kind,'outdoor-landmark');assert.equal(p.geometryHash,campus.geometryHash);assert.deepEqual(publicAnchor(world,{spaceId:campus.id},{sceneId:p.sceneId,entityId:p.entityId}),{sceneId:p.sceneId,entityId:p.entityId});}
  assert.throws(()=>publicAnchor(world,{spaceId:campus.id},{sceneId:UW_SCENE,entityId:'private-room'}),e=>e.status===403);
  assert.throws(()=>publicPlaces(world,'another-school'),e=>e.status===404);
  assert.throws(()=>publicAnchor(world,{spaceId:campus.id},{sceneId:UW_SCENE,entityId:'library',point:[0,0,0]}));
  const hub=nav.landmark('library'),arrival=nav.nodes[hub.arrivalNode],principal={id:'test-student'};
  const state={positions:{[protocol.digest([principal.id,campus.id])]:{path:[{point:arrival}],stopped:true,startedAt:Date.now(),previewSpeed:0}}};
  const pos=world.position(state,principal);
  assert.equal(toolPlace(world,pack,pos,UW_SCENE,'library','stamp').name,hub.name);
  assert.throws(()=>toolPlace(world,pack,{...pos,moving:true},UW_SCENE,'library','stamp'),e=>e.status===409);
  assert.throws(()=>toolPlace(world,pack,{...pos,point:[arrival[0]+4,arrival[1],arrival[2]]},UW_SCENE,'library','postcard'),e=>e.status===409);
  assert.throws(()=>toolPlace(world,pack,{...pos,point:[NaN,0,0]},UW_SCENE,'library','note'),e=>e.status===409);
  assert.throws(()=>toolPlace(world,pack,pos,'wrong-scene','library','stamp'),e=>e.status===403);
  assert.equal(toolPlace(world,pack,pos,UW_SCENE,'main-gate','bookmark').entityId,'main-gate');
});
test('indoor anchors and arrival checks keep their original geometry and private-room restrictions',()=>{
  const scene={sceneId:'hall',name:'Hall',levels:[{id:'l1',name:'Ground',rooms:[{entityId:'lobby',name:'Lobby',access:'public',rect:[0,0,3,4]},{entityId:'private',access:'private',rect:[4,0,3,4]}]}]};
  const pack={spaceId:'school',scenes:[scene]},world={packFor:id=>{assert.equal(id,'school');return pack;}},pos={sceneId:'hall',levelId:'l1',point:[1,0,2],moving:false};
  assert.equal(publicPlaces(world,'school').length,1);assert.equal(publicPlace(world,'school','hall','private'),null);
  assert.equal(toolPlace(world,pack,pos,'hall','lobby','stamp').geometryHash,protocol.digest(scene));
  assert.throws(()=>toolPlace(world,pack,{...pos,point:[4,0,2]},'hall','lobby','stamp'),e=>e.status===409);
  assert.throws(()=>toolPlace(world,pack,pos,'hall','private','stamp'),e=>e.status===403);
  assert.equal(toolPlace(world,pack,pos,'hall',null,'wave').entityId,null);
});
