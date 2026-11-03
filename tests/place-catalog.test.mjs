import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {campusPlaces} from '../public/campus-places.js';
import {createCampusNavigation} from '../src/navigation.mjs';
import {createCampusWorld,UW_SCENE} from '../src/campus-world.mjs';
const campus=JSON.parse(await readFile(new URL('../data/campus.json',import.meta.url),'utf8'));

test('every selectable building has one stable public anchor and retains all old landmark IDs',()=>{
  const before=JSON.stringify(campus),places=campusPlaces(campus),nav=createCampusNavigation(campus),world=createCampusWorld(campus,nav,{},null);
  assert.equal(places.length,77);assert.equal(new Set(places.map(p=>p.id)).size,77);
  for(const old of campus.landmarks){const derived=places.find(p=>p.id===old.id);assert.deepEqual({...derived,description:old.description},old);assert(!/本版|不代表|未核实/.test(derived.description));}
  for(const b of campus.buildings){
    const p=places.filter(p=>p.buildingId===b.id);assert.equal(p.length,1);
    const id=p[0].id,arrival=nav.nodes[nav.landmark(id).arrivalNode];assert(nav.walking.allowed(arrival[0],arrival[2]));
    assert(world.placeAdapter.publicPlaces(campus.id).some(a=>a.sceneId===UW_SCENE&&a.entityId===id));
    assert.equal(world.placeAdapter.toolPlace(campus.id,{sceneId:UW_SCENE,levelId:'outdoors',point:arrival,moving:false},UW_SCENE,id,'stamp').entityId,id);
    assert.throws(()=>world.placeAdapter.toolPlace(campus.id,{sceneId:UW_SCENE,levelId:'outdoors',point:arrival,moving:true},UW_SCENE,id,'stamp'),e=>e.status===409);
  }
  assert.equal(JSON.stringify(campus),before);assert.equal(nav.nodes.length,campus.graph.nodes.length+68);
});

test('real photographs are local, correctly keyed, attributed and byte-verified; unfilled places have no substitute',async()=>{
  const photos=JSON.parse(await readFile(new URL('../public/assets/place-photos/manifest.json',import.meta.url),'utf8'));
  const ids=new Set([...campusPlaces(campus).map(p=>p.id),'broken-obelisk','red-square-pylon-2']);
  assert(Object.keys(photos).length>=40);
  for(const [id,p]of Object.entries(photos)){
    assert(ids.has(id));assert(p.path.startsWith('/assets/place-photos/')&&p.path.endsWith('.jpg'));
    assert(p.author&&p.license&&p.subject);assert(p.source.startsWith('https://commons.wikimedia.org/wiki/File:'));
    assert(p.licenseUrl.startsWith('https://'));assert(p.width>=640&&p.height>=200);
    const bytes=await readFile(new URL('../public'+p.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),p.sha256);
    assert.equal(bytes[0],255);assert.equal(bytes[1],216);
  }
  const helper=await readFile(new URL('../public/place-photo.js',import.meta.url),'utf8');
  assert(helper.includes('if(!photo)return null'));assert(!helper.includes('照片待补充'));
  assert.notEqual(photos['red-square'].path,photos['broken-obelisk'].path);
});
