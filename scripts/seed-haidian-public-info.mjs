// Publish the reviewed public source pack through the existing owner API.
// Only the fresh fictional preview/acceptance instance is supported by this helper.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {baseRoot,projectRoot} from '../src/base.mjs';
if(process.env.HD_M1_TEST_FIXTURE!=='1')throw Error('Explicit isolated fixture required');
const {config,login,api,until}=await import(pathToFileURL(join(baseRoot,'tests/m1-helpers.mjs')));
assert.equal(config.schools[0].schoolId,'haidian');
const owner=await login('moda'),root='/knowledge-admin/schools/haidian';
const current=await api(owner,root+'/status');assert.equal(current.status,200);
const {knowledge}=JSON.parse(await readFile(join(projectRoot,'data/reception.json'),'utf8'));
const documents=knowledge.map(({keywords,...row})=>({...row,...(row.entityId?{sceneId:'haidian-outdoors'}:{})}));
const published=await api(owner,root+'/documents',{requestId:crypto.randomUUID(),expectedVersion:current.data.publicVersion,confirmed:true,documents});assert.equal(published.status,200,JSON.stringify(published.data));
await until(async()=>{const s=await api(owner,root+'/status');return s.data.sources.some(x=>x.kind==='knowledge-index'&&x.current&&x.indexed_revision===published.data.version);},30000);
const answer=await api(owner,'/api/reception',{message:'海淀校区的学校地址在哪里？',messageId:crypto.randomUUID()});assert.equal(answer.status,200);assert(JSON.stringify(answer.data).includes('杏石口路20号'));
console.log(JSON.stringify({status:'PASS',school:'haidian',publishedDocuments:knowledge.length,provider:'knowledge',source:'public Haidian pack',modelCalls:0}));
