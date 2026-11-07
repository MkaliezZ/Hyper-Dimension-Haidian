// Explicit paid-model acceptance against this school's local native instance.
// Uses only new guest sessions and synthetic prompts; never reads a credential.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {projectRoot} from '../src/base.mjs';

if(process.env.HD_HAIDIAN_LIVE_TEST!=='1')throw Error('Set HD_HAIDIAN_LIVE_TEST=1 to authorize the bounded live check.');
const origin=new URL(process.env.HAIDIAN_LIVE_ORIGIN||'http://127.0.0.1:6290');
assert(['127.0.0.1','localhost'].includes(origin.hostname)&&origin.protocol==='http:','Local Haidian instance required');
const clients=[],sessions=[],report={at:new Date().toISOString(),school:'haidian',syntheticPrompts:true,checks:{},modelCalls:0};
function client(){
  const c={cookie:'',async call(path,body){
    const r=await fetch(new URL(path,origin),{redirect:'error',signal:AbortSignal.timeout(75000),headers:{'Content-Type':'application/json',Cookie:this.cookie},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
    for(const s of r.headers.getSetCookie())if(s.startsWith('haidian_visitor='))this.cookie=s.split(';')[0];
    // The inherited cookie name may change with the isolated instance contract.
    if(!this.cookie&&r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
    return {status:r.status,body:await r.json()};
  }};clients.push(c);return c;
}
async function session(c,base='/api/sessions'){
  const r=await c.call(base,{requestId:randomUUID()});assert.equal(r.status,200,'Create owned QA session');assert(r.body.contextId);
  const s={client:c,base,contextId:r.body.contextId};sessions.push(s);return s;
}
async function ask(s,message,path='/api/reception'){
  const r=await s.client.call(path,{contextId:s.contextId,message,messageId:randomUUID()});
  assert.equal(r.status,200,'Model request HTTP status');assert(!r.body.error,'A2A request accepted');
  const task=r.body.result.task;assert.equal(task.status.state,'TASK_STATE_COMPLETED','Actual model task must complete');
  const answer=JSON.parse(task.artifacts[0].parts[0].text);assert(answer.text?.trim(),'Nonempty model reply');report.modelCalls++;return answer;
}
function hermes(a){assert.equal(a.mode,'live-model');assert.equal(a.provider,'hermes');assert.equal(a.model,'deepseek-flash');}
let failure;
try{
  const a=client(),b=client(),h=(await a.call('/health')).body;
  assert.equal(h.schoolId,'haidian');assert(h.nativeCampus);assert.equal(h.provider,'hermes');assert(h.generalConversation);
  assert.equal(h.receptionModel,'deepseek-flash');assert.equal(h.npcProvider,'deepseek');assert.equal(h.npcModel,'deepseek-flash');
  report.health={version:h.version,provider:h.provider,receptionModel:h.receptionModel,npcProvider:h.npcProvider,npcModel:h.npcModel,geometryHash:h.geometryHash};
  const sa=await session(a),sb=await session(b),token='Pine'+randomUUID().replaceAll('-','').slice(0,12);
  const first=await ask(sa,'请记住本次会话的测试暗号「'+token+'」。仅用一句话确认，不需要介绍校园。');hermes(first);assert(first.text.includes(token));
  report.checks.actualHermesGeneralConversation=true;console.log('PASS: actual Hermes / Flash general conversation');
  const separate=await ask(sb,'我在这次会话里曾经告诉过你测试暗号吗？如果没有，请直说没有，不要猜。');hermes(separate);assert(!separate.text.includes(token));
  assert.equal((await b.call('/api/sessions/'+sa.contextId+'/export')).status,404);
  report.checks.visitorIsolationAndForeignExportDenied=true;console.log('PASS: independent visitor context and denied foreign export');
  const recalled=await ask(sa,'刚才的测试暗号是什么？仅原样重复暗号。');hermes(recalled);assert(recalled.text.includes(token));
  report.checks.ownSessionRecall=true;console.log('PASS: owned session recall');
  const fact=await ask(sa,'北京海淀校区的地址是什么？请根据已发布资料回答。');hermes(fact);assert.equal(fact.basis,'published');assert(fact.text.includes('杏石口路20号'));assert(fact.sources.length>0);
  report.checks.publishedCampusCitation=true;report.sourceIds=fact.sources.map(s=>s.id);console.log('PASS: Haidian published campus address and source references');
  const state=(await a.call('/api/npcs')).body;assert.equal(state.model,'deepseek-flash');assert(state.chat.available);assert.equal(state.npcs.length,6);
  const npc=await session(a,'/api/npcs/leo/sessions');
  const reply=await ask(npc,'你好，请用一句话给我一个整理作业思路的小建议。','/api/npcs/leo/message');assert.equal(reply.mode,'npc-deepseek');assert.equal(reply.npcId,'leo');
  report.checks.actualNpcFlashConversation=true;report.checks.sixNpcSharedFlashAdapter=true;console.log('PASS: actual NPC Flash reply with the original shared adapter');
}catch(error){failure=error;report.passed=false;report.failure={name:error.name,code:error.code||null,message:error.message.slice(0,220)};}
finally{
  let deleted=0;
  for(const s of sessions){
    try{
      const path=s.base+'/'+s.contextId,exported=await s.client.call(path+'/export');assert.equal(exported.status,200);
      const removed=await s.client.call(path+'/delete',{requestId:randomUUID(),expectedRevision:exported.body.session.revision});assert.equal(removed.status,200);
      assert.equal((await s.client.call(path+'/export')).status,410);deleted++;
    }catch(error){failure??=error;}
  }
  report.checks.ownedQaSessionsDeleted=deleted===sessions.length;report.deletedQaSessions=deleted;report.passed=!failure;
  const dir=join(projectRoot,'evidence/haidian/hermes');await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'live-result.json'),JSON.stringify(report,null,2)+'\n');
}
if(failure)throw failure;
console.log(JSON.stringify(report));
