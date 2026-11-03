import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createGateway,openStore,protocol,projectRoot} from '../src/base.mjs';
import {createTaskClient,canCancel,taskResult} from '../public/a2a-task-client.js';

test('task workbench reads existing gateway receipts, isolates owners/agents and cancels real in-flight work',async()=>{
  await mkdir(join(projectRoot,'.local'),{recursive:true});const dir=await mkdtemp(join(projectRoot,'.local/qa-task-workbench-')),store=await openStore(dir);
  const pack={spaceId:'school-a',name:'Fixture school',agents:[{agentId:'helper-a',skills:['fixture.wait']},{agentId:'helper-b',skills:['fixture.wait']}]};
  const principal={id:'alice',spaces:['school-a'],scopes:['a2a:call']};let started=0,aborted=0;
  const gateway=createGateway({store,packs:[pack],reception:{live:false},navigate(){throw Error('Unused');},capabilities:{'fixture.wait':{scope:'a2a:call',async execute({signal}){started++;await new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>{aborted++;reject(Error('canceled'));},{once:true});});}}}});
  const adapter=(who,agent)=>async(_url,options)=>{
    const request=JSON.parse(options.body);if(request.method==='ListTasks'){assert.equal(request.params.historyLength,0);assert.equal(request.params.includeArtifacts,false);}
    return new Response(JSON.stringify(await gateway.handle({agentId:agent,principal:who,request,version:'1.0',origin:'http://127.0.0.1:9999'})));
  };
  const client=createTaskClient('helper-a',{fetchImpl:adapter(principal,'helper-a')});
  try{
    const response=await gateway.handle({agentId:'helper-a',principal,version:'1.0',origin:'http://127.0.0.1:9999',request:{jsonrpc:'2.0',id:randomUUID(),method:'SendMessage',params:{message:{messageId:randomUUID(),role:'ROLE_USER',parts:[{text:'private fixture input'}]},configuration:{returnImmediately:true},metadata:{[protocol.EXTENSION]:{skillId:'fixture.wait',arguments:{}}}}}});
    assert(!response.error,JSON.stringify(response.error));const task=response.result.task;assert(canCancel(task));
    const rows=await client.list();assert.equal(rows.tasks.length,1);assert(!JSON.stringify(rows).includes('private fixture input'));assert(!rows.tasks[0].history);assert(!rows.tasks[0].artifacts);
    assert.equal((await client.get(task.id)).id,task.id);
    const other=createTaskClient('helper-a',{fetchImpl:adapter({...principal,id:'bob'},'helper-a')});assert.equal((await other.list()).tasks.length,0);await assert.rejects(()=>other.get(task.id));await assert.rejects(()=>other.cancel(task.id));
    const wrongAgent=createTaskClient('helper-b',{fetchImpl:adapter(principal,'helper-b')});await assert.rejects(()=>wrongAgent.get(task.id));
    const removed=createTaskClient('helper-a',{fetchImpl:adapter({...principal,spaces:[]},'helper-a')});await assert.rejects(()=>removed.list());
    const canceled=await client.cancel(task.id);assert.equal(canceled.status.state,'TASK_STATE_CANCELED');assert(!canCancel(canceled));assert.equal((await client.cancel(task.id)).status.state,'TASK_STATE_CANCELED');
    await new Promise(r=>setImmediate(r));assert.equal(started,1);assert.equal(aborted,1);assert.equal((await client.get(task.id)).status.state,'TASK_STATE_CANCELED');
  }finally{await gateway.close();await store.close();}
});

test('receipt reader leaves HTML as text and rejects wrong JSON-RPC correlations or authorization failures',async()=>{
  const malicious='<img src=x onerror=alert(1)>';
  assert.equal(taskResult({artifacts:[{parts:[{text:JSON.stringify({text:malicious})}]}]}),malicious);
  assert(!canCancel({id:'x',status:{state:'TASK_STATE_COMPLETED'}}));assert(!canCancel({id:'x',status:{state:'UNKNOWN'}}));
  const wrong=createTaskClient('helper-a',{fetchImpl:async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:'unrelated',result:{}}))});await assert.rejects(()=>wrong.list(),/不一致/);
  const denied=createTaskClient('helper-a',{fetchImpl:async()=>new Response(JSON.stringify({error:{message:'login required'}}),{status:401})});await assert.rejects(()=>denied.list(),e=>e.status===401);
  assert.throws(()=>createTaskClient('../../private'));
});
