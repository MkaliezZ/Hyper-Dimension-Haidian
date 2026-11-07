// Haidian adaptation of retained UW behavior tests; original receipts remain unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {campusCatalog} from '../src/campus-catalog.mjs';

test('campus discovery retains the Base contract, outdoor scene and current membership/delegation scope without private payloads',()=>{
  const input={principal:{spaces:['haidian-beijing']},pack:{spaceId:'haidian-beijing',name:'UW',description:'Published campus',agents:[{agentId:'haidian-reception'},{agentId:'haidian-beijing-partner-services'}],knowledge:[{body:'PRIVATE_KNOWLEDGE'}],profiles:[{bio:'PRIVATE_BIO'}]},platform:{extensions:['m1','agents']},reception:{live:true,provider:'hermes',general:true},knowledge:{mode:'postgres'},geometryHash:'geometry-fixture'};
  const value=campusCatalog(input);assert.equal(value.version,'0.2.1');assert.equal(value.platform,'m0');assert.equal(value.receptionProvider,'hermes');
  assert.equal(value.spaces.length,1);assert.equal(value.spaces[0].sceneContract,'hyper-dimension.geo-campus/v1');assert.equal(value.spaces[0].scenes[0].sceneId,'haidian-outdoors');
  assert(!JSON.stringify(value).includes('PRIVATE_'));
  assert.equal(campusCatalog({...input,principal:{spaces:[]}}).spaces.length,0);
  assert.equal(campusCatalog({...input,principal:{spaces:['foreign']}}).spaces.length,0);
  const limited=campusCatalog({...input,principal:{spaces:['haidian-beijing'],allowedAgents:['haidian-beijing-partner-services']}});
  assert.deepEqual(limited.spaces[0].agents,[{agentId:'haidian-beijing-partner-services'}]);
  limited.spaces[0].agents[0].agentId='changed';assert.equal(input.pack.agents[1].agentId,'haidian-beijing-partner-services');
});
