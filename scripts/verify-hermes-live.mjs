// Explicit live-model check. Only run with isolated QA data and an authorized configured key.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {startUw} from '../server.mjs';
const data=process.env.HAIDIAN_DATA_DIR;
if(!data||!data.includes('uw-goal-qa')||process.env.HAIDIAN_RECEPTION_MODE!=='hermes')throw Error('Live test requires an isolated uw-goal-qa data directory and explicit Hermes mode.');
let app=await startUw({port:0,dataDir:data}),calls=0;
const make=()=>({cookie:'',async call(path,body){const r=await fetch(app.origin+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json',Cookie:this.cookie}});if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:await r.json()};}});
const ask=async(client,contextId,message)=>{const result=(await client.call('/api/reception',{contextId,message,messageId:randomUUID()})).body;assert(!result.error,JSON.stringify(result));const t=result.result.task;assert.equal(t.status.state,'TASK_STATE_COMPLETED',JSON.stringify(t.status));const answer=JSON.parse(t.artifacts[0].parts[0].text);assert.equal(answer.mode,'live-model');assert.equal(answer.provider,'hermes');calls++;return answer;};
const report={at:new Date().toISOString(),runtime:'Ubuntu Docker / actual pinned Hermes / online DeepSeek',checks:{}};
try{
  const a=make(),b=make(),health=(await a.call('/health')).body;assert.equal(health.provider,'hermes');assert(health.generalConversation);
  const sa=(await a.call('/api/sessions',{requestId:randomUUID()})).body.contextId,sb=(await b.call('/api/sessions',{requestId:randomUUID()})).body.contextId;
  const token='松果'+randomUUID().slice(0,8);
  const general=await ask(a,sa,'请记住本次会话的测试暗号「'+token+'」。用一句话确认。');assert(general.text.includes(token));report.checks.generalConversation=true;
  const isolated=await ask(b,sb,'我刚才给你的测试暗号是什么？如果我没说过请直接说明。');assert(!isolated.text.includes(token));report.checks.conversationIsolation=true;
  assert.equal((await b.call('/api/sessions/'+sa+'/export')).status,404);report.checks.foreignExportDenied=true;
  await app.close();app=await startUw({port:0,dataDir:data});
  const recalled=await ask(a,sa,'刚才的测试暗号是什么？请准确重复。');assert(recalled.text.includes(token));report.checks.memoryAfterServerRestart=true;
  const facts=await ask(a,sa,'Denny Hall建于哪一年？请依据发布资料回答。');assert.equal(facts.basis,'published');assert(facts.sources.some(x=>x.id==='uw-denny'));assert(facts.text.includes('1895'));report.checks.publishedCampusCitation=true;
  const snapshot=(await a.call('/api/sessions/'+sa+'/export')).body;assert.equal(snapshot.turns.length,3);assert(JSON.stringify(snapshot).includes(token));report.checks.ownExport=true;
  assert.equal((await a.call('/api/sessions/'+sa+'/delete',{requestId:randomUUID(),expectedRevision:snapshot.session.revision})).status,200);
  assert.equal((await a.call('/api/sessions/'+sa+'/export')).status,410);report.checks.deleteAndTombstone=true;
  assert(!(await readFile(join(data,'state.json'),'utf8')).includes(token));report.checks.activeStoragePurged=true;
  const other=(await b.call('/api/sessions/'+sb+'/export')).body;assert.equal(other.turns.length,1);report.checks.otherVisitorRetained=true;
  const unknown=(await a.call('/api/reception',{message:'Denny Hall今天几点开放？',messageId:randomUUID()})).body;assert.match(JSON.parse(unknown.result.task.artifacts[0].parts[0].text).text,/未核实/);report.checks.unknownHoursNotInvented=true;
  report.modelCalls=calls;report.passed=true;
  await writeFile(join(data,'live-result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(report));
}finally{await app.close();}
