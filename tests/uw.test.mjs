import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startUw} from '../server.mjs';
import {projectRoot,baseRoot,protocol} from '../src/base.mjs';
import {createCampusNavigation} from '../src/navigation.mjs';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8'));
test('UW published landmarks share one real-coordinate geometry and a connected exterior route network',()=>{
  const {geometryHash,...geometry}=campus;assert.equal(protocol.digest(geometry),geometryHash);
  assert.equal(campus.crs,'EPSG:26910');assert.equal(campus.terrain.sourceResolutionMetres,1);assert.equal(campus.terrain.verticalExaggeration,1);
  assert.equal(campus.landmarks.length,9);assert(campus.buildings.length>=60);
  const nav=createCampusNavigation(campus);
  for(const a of campus.landmarks)for(const b of campus.landmarks){const route=nav.route(a.arrivalNode,b.id);assert.equal(route.geometryHash,geometryHash);assert(route.path.length);for(const step of route.path)assert(step.point.every(Number.isFinite));}
  assert.throws(()=>nav.route([999999,0,999999],'denny'));
  assert.throws(()=>nav.route(0,'unknown-private-building'));
});

test('Base A2A, real HTTP reception, owner isolation, replay, restart, export/delete and unsafe-route denial',async()=>{
  // Retained QA fixture is recorded for precise resource cleanup; never touch user runtime.
  const directory=await mkdtemp(join(projectRoot,'.local/qa-uw-'));
  let app=await startUw({port:0,dataDir:directory,provider:null});
  const client=(cookie='')=>({cookie,async call(path,body,headers={}){
    const response=await fetch(app.origin+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json',...(this.cookie?{Cookie:this.cookie}:{}),...headers}});
    const set=response.headers.get('set-cookie');if(set)this.cookie=set.split(';')[0];
    return {status:response.status,body:await response.json()};
  }});
  try{
    const alice=client(),bob=client();
    const me=(await alice.call('/api/me')).body;const other=(await bob.call('/api/me')).body;assert.notEqual(me.visitorId,other.visitorId);
    const session=(await alice.call('/api/sessions',{requestId:randomUUID()})).body;
    const question={message:'Denny Hall 丹尼楼有什么历史？',messageId:randomUUID(),contextId:session.contextId};
    const answer=(await alice.call('/api/reception',question)).body;assert(!answer.error,JSON.stringify(answer));
    const task=answer.result.task;assert.equal(task.status.state,'TASK_STATE_COMPLETED');
    const artifact=JSON.parse(task.artifacts[0].parts[0].text);assert.match(artifact.text,/1895/);assert.equal(artifact.sources.length,1);
    const duplicate=(await alice.call('/api/reception',question)).body;assert.equal(duplicate.result.task.id,task.id);
    const conflict=(await alice.call('/api/reception',{...question,message:'changed'})).body;assert(conflict.error);
    assert.equal((await bob.call('/api/sessions/'+session.contextId+'/export')).status,404);
    const exported=(await alice.call('/api/sessions/'+session.contextId+'/export')).body;assert.equal(exported.turns.length,1);
    const route=(await alice.call('/api/route',{toId:'hub'})).body;assert(route.distance>20);assert.equal(route.geometryHash,campus.geometryHash);
    const cross=await alice.call('/api/move',{toId:'hub',requestId:randomUUID()},{Origin:'https://untrusted.example'});assert.equal(cross.status,403);
    for(const path of ['/.local/access.json','/sources/campus-map-2025.pdf','/../AGENTS.md']){const response=await fetch(app.origin+path);assert([403,404].includes(response.status));}
    const requestId=randomUUID();const move=(await alice.call('/api/move',{toId:'denny',requestId})).body;const replay=(await alice.call('/api/move',{toId:'denny',requestId})).body;assert.equal(move.startedAt,replay.startedAt);assert.equal(replay.replayed,true);
    const token=app.auth.access.tokens[0].token;
    const require=createRequire(join(baseRoot,'package.json'));
    const {ClientFactory,ClientFactoryOptions,JsonRpcTransportFactory}=await import(pathToFileURL(require.resolve('@a2a-js/sdk/client')).href);
    const {SendMessageRequest,TaskState}=await import(pathToFileURL(require.resolve('@a2a-js/sdk')).href);
    const fetchAuth=(input,init={})=>{const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+token);return fetch(input,{...init,headers});};
    const factory=new ClientFactory(ClientFactoryOptions.createFrom(ClientFactoryOptions.default,{transports:[new JsonRpcTransportFactory({fetchImpl:fetchAuth})]}));
    const official=await factory.createFromUrl(app.origin,'/agents/uw-reception/.well-known/agent-card.json');
    const a2a=await official.sendMessage(SendMessageRequest.fromJSON({message:{messageId:randomUUID(),role:'ROLE_USER',parts:[{text:'介绍Savery Hall'}]}}));assert.equal(a2a.status.state,TaskState.TASK_STATE_COMPLETED);
    const {BaseClient}=await import(pathToFileURL(join(baseRoot,'src/sdk/client.mjs')).href);
    const agentClient=new BaseClient({url:app.origin,token});
    const routeTask=await agentClient.send('uw-reception','Red Square到HUB',{skillId:'uw.campus.route',args:{fromId:'red-square',toId:'hub'}});
    assert.equal(routeTask.task.status.state,'TASK_STATE_COMPLETED');
    const routeArtifact=JSON.parse(routeTask.task.artifacts[0].parts[0].text);
    assert.equal(routeArtifact.geometryHash,campus.geometryHash);assert(routeArtifact.distance>50);
    await app.close();app=await startUw({port:0,dataDir:directory,provider:null});
    assert.equal((await alice.call('/api/me')).body.visitorId,me.visitorId);
    const restored=(await alice.call('/api/sessions/'+session.contextId+'/export')).body;assert.equal(restored.turns[0].question,question.message);
    assert.equal((await alice.call('/api/sessions/'+session.contextId+'/delete',{requestId:randomUUID(),expectedRevision:restored.session.revision})).status,200);
    assert.equal((await alice.call('/api/sessions/'+session.contextId+'/export')).status,410);
    const deleted=(await alice.call('/api/reception',question)).body;assert(deleted.error);
    const unknown=(await alice.call('/api/reception',{message:'Denny Hall今天开放时间？',messageId:randomUUID()})).body;
    assert.match(JSON.parse(unknown.result.task.artifacts[0].parts[0].text).text,/未核实/);
    console.log('QA fixture retained at '+directory+'; all owned test servers are closed.');
  }finally{await app.close();}
});
