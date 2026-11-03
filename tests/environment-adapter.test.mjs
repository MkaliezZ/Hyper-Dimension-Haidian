import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnvironment} from '../base/src/platform/environment.mjs';

test('outdoor feedback enumerates actual adapter places, filters anchors and keeps public views separate from owner permissions',async()=>{
  // Query boundary double; real PostgreSQL + Keycloak are checked by the native browser harness.
  const queries=[];let role='owner';
  const connection={async query(sql){queries.push(sql);return {rows:[],rowCount:0};}};
  const db={pool:connection,async tx(fn){return fn(connection);},async member(){if(role==='outsider')throw Object.assign(Error('school denied'),{status:403});return {role};}};
  const world={placeAdapter:{contract:'hyper-dimension.geo-campus/v1',supports:id=>id==='uw-seattle',publicPlaces:()=>[{sceneId:'uw-outdoors',entityId:'red-square',name:'Red Square'},{sceneId:'uw-outdoors',entityId:'hub',name:'HUB'}]}};
  const services={school(id){assert.equal(id,'uw');return {schoolId:'uw',spaceId:'uw-seattle'};}};
  const environment=createEnvironment(db,{async user(){return {user_id:'fictional-user'};}},services,{schools:[{schoolId:'uw',spaceId:'uw-seattle'}]},{getWorld:()=>world});
  async function get(path){let response;const handled=await environment.handle({method:'GET'},null,{url:new URL(path,'http://localhost'),json(_res,status,value){assert.equal(status,200);response=value;}});assert(handled);return response;}
  const owner=await get('/environment/schools/uw/places');assert.deepEqual(owner.places.map(x=>x.entityId),['red-square','hub']);assert(owner.places.every(p=>p.canAssign&&!p.canFeedback&&!p.canHandle));
  const publicView=await get('/environment/public/schools/uw/places?sceneId=uw-outdoors&entityId=hub');assert.equal(publicView.places.length,1);assert.equal(publicView.places[0].name,'HUB');assert(!Object.hasOwn(publicView.places[0],'canAssign'));
  role='student';const student=await get('/environment/schools/uw/places');assert(student.places.every(p=>!p.canAssign));
  role='outsider';await assert.rejects(()=>get('/environment/schools/uw/places'),{status:403});
  assert(queries.some(q=>q.includes('hd_environment_places')));
});
