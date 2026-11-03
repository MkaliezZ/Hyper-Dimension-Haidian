import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {baseRoot} from '../src/base.mjs';
if(process.env.HD_M1_TEST_FIXTURE!=='1')throw Error('Isolated fixture deployment required');
const {config,login,api,until}=await import(pathToFileURL(join(baseRoot,'tests/m1-helpers.mjs')));
assert.equal(config.schools.length,1);assert.equal(config.schools[0].schoolId,'uw');assert.equal(config.schools[0].spaceId,'uw-seattle');
const checks=[],run=randomUUID().slice(0,8),org='uw-qa-'+run;
const out=process.env.UW_NATIVE_EVIDENCE||'/runtime/evidence/uw-native-'+run;
await mkdir(out,{recursive:true});
const {default:pg}=await import(pathToFileURL(join(baseRoot,'node_modules/pg/lib/index.js')));
const pool=new pg.Pool({connectionString:config.databaseUrl});
const [owner,a,b,peer]=await Promise.all(['moda','alice','bob','shared'].map(login));
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const get=async(u,p)=>ok(await api(u,p));
const post=async(u,p,v)=>ok(await api(u,p,{requestId:randomUUID(),...v}));
const check=async(name,fn)=>{await fn();checks.push({name,status:'PASS'});console.log('PASS '+name);};
const school='/m1/schools/uw',organization=school+'/organizations/'+org;
let saved,inventory,publicVersion,postId,period;
try{
 await check('actual UW identity and outsider rejection; explicit invitation joins the school',async()=>{
  assert.equal((await api(b,'/network/schools/uw/bootstrap')).status,403);
  assert.equal((await api(b,'/api/avatar')).status,403);
  if(!a.schools.some(s=>s.school_id==='uw')){
    const invite=await post(owner,school+'/invitations',{email:'alice@m0.invalid',role:'student'});
    ok(await api(a,'/m1/invitations/accept',{token:invite.token}));
  }
  assert.equal((await api(a,'/m0/schools/north/avatar')).status,404);
  const me=await get(a,'/m0/me');assert.deepEqual(me.schools.map(s=>s.school_id),['uw']);
  assert(me.extensions.includes('community')&&me.extensions.includes('m2'));
 });
 await check('owner-only organizations, last-owner protection and nine real outdoor places',async()=>{
  assert.equal((await api(a,school+'/organizations',{requestId:randomUUID(),orgId:org,name:'Denied',kind:'student'})).status,403);
  await post(owner,school+'/organizations',{orgId:org,name:'虚构 UW 自动联调 '+run,kind:'student'});
  const invite=await post(owner,organization+'/invitations',{email:'alice@m0.invalid',role:'member'});
  ok(await api(a,'/m1/invitations/accept',{token:invite.token}));
  const peerInvite=await post(owner,organization+'/invitations',{email:'shared@m0.invalid',role:'member'});
  ok(await api(peer,'/m1/invitations/accept',{token:peerInvite.token}));
  const members=await get(owner,school+'/members'),m=members.members.find(x=>x.user_id===owner.userId);
  assert(m,'owner membership');
  assert.equal((await api(owner,school+'/members',{requestId:randomUUID(),userId:m.user_id,role:'student',active:true,expectedRevision:m.revision})).status,409);
  const network=await get(a,'/network/schools/uw/bootstrap');assert.equal(network.places.length,9);
  assert(network.places.every(p=>p.sceneId==='uw-outdoors'));assert(network.places.some(p=>p.entityId==='hub'));
 });
 await check('Nakama private messages require consent and reject non-participant owner access',async()=>{
  const croot='/contacts/schools/uw';
  const input={kind:'dm',orgId:org,peerId:peer.userId};
  assert.equal((await api(a,school+'/chat',{requestId:randomUUID(),...input})).status,403);
  const state=await get(a,croot+'/state?peerId='+peer.userId+'&org='+org);
  const request=await post(a,croot+'/requests',{expectedRevision:state.revision,peerId:peer.userId,orgId:org});
  assert.equal((await api(a,croot+'/requests/'+request.contactId+'/accept',{requestId:randomUUID(),expectedRevision:request.revision})).status,403);
  await post(peer,croot+'/requests/'+request.contactId+'/accept',{expectedRevision:request.revision});
  const conversation=await post(a,school+'/chat',input),path=school+'/chat/'+conversation.conversationId+'/messages';
  const body={requestId:randomUUID(),action:'send',text:'真实 Nakama UW 隔离通信 '+run};
  const message=ok(await api(a,path,body));assert.deepEqual(ok(await api(a,path,body)),message);
  assert((await get(peer,path)).items.some(m=>m.text===body.text));
  assert.equal((await api(owner,path)).status,403);assert.equal((await api(b,path)).status,403);
 });
 await check('UW avatar saves under authenticated identity; refresh/login restore and CAS',async()=>{
  const avatar=await get(a,'/api/avatar');
  saved=await post(a,'/api/avatar',{expectedRevision:avatar.profile?.revision||0,displayName:'UW隔离测试访客',recipe:avatar.catalog.presets[1].recipe});
  assert.equal((await get(await login('alice'),'/api/avatar')).profile.modelHash,saved.modelHash);
  assert.equal((await api(a,'/api/avatar',{requestId:randomUUID(),expectedRevision:avatar.profile?.revision||0,displayName:'冲突',recipe:avatar.catalog.defaultRecipe})).status,409);
  assert.equal((await get(owner,'/api/avatar')).profile,null);
 });
 await check('backpack and non-destructive stamp require actual outdoor arrival and preserve idempotency',async()=>{
  inventory=await get(a,'/m2/schools/uw/inventory');
  if(!inventory.starterClaimed)inventory=await post(a,'/m2/schools/uw/inventory/starter',{expectedRevision:inventory.revision});
  inventory=await post(a,'/m2/schools/uw/inventory/equip',{expectedRevision:inventory.revision,itemId:'stamp-book',equipped:true});
  const payload={requestId:randomUUID(),expectedRevision:inventory.revision,itemId:'stamp-book',action:'stamp',sceneId:'uw-outdoors',entityId:'hub'};
  const denied=await api(a,'/m2/schools/uw/inventory/use',payload);assert.equal(denied.status,409);assert.equal(denied.data.error.code,'tool_arrival_required');
  await post(a,'/api/move/stop',{});
  const move=await post(a,'/api/move',{toId:'red-square'});
  await until(async()=>{const state=await get(a,'/api/me');return Math.hypot(...state.position.map((v,i)=>v-move.path.at(-1).point[i]))<.01;},30000);
  payload.entityId='red-square';payload.requestId=randomUUID();
  const first=ok(await api(a,'/m2/schools/uw/inventory/use',payload));
  const replay=ok(await api(a,'/m2/schools/uw/inventory/use',payload));assert.deepEqual(replay,first);
 });
 await check('native forum moderation, reviewed history and private school visibility',async()=>{
  const {exampleRules}=await import(pathToFileURL(join(baseRoot,'src/platform/campus-ledger.mjs')));
  const rule=structuredClone(exampleRules);rule.version='uw-qa-'+run;rule.rules.forum_published={points:5,dayCap:10};
  const imported=await post(owner,'/ledger/schools/uw/rules',{document:rule});
  await post(owner,'/ledger/schools/uw/rules/'+rule.version+'/approve',{expectedRevision:imported.revision,reason:'虚构联调规则审核'});
  period=await post(owner,'/ledger/schools/uw/periods',{period:'uw-qa-'+run,orgId:org,semester:'qa-'+run,label:'虚构 UW 自动验收时期',ruleVersion:rule.version,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()});
  await post(owner,'/ledger/schools/uw/periods/'+period.period+'/activate',{expectedRevision:period.revision,reason:'隔离测试明确启用',acknowledgeExample:true});
  const readiness=await get(a,'/m0/schools/uw/forum/posting-state');
  if(readiness.retryAfterMs){assert(readiness.retryAfterMs<=30000);await new Promise(r=>setTimeout(r,readiness.retryAfterMs+50));}
  const forum=organization+'/forum';
  const draft=await post(a,forum,{action:'submit',title:'UW 历史索引验收 '+run,content:'紫杉迎新志愿地图：这是一条虚构的后端联调帖子，不是学校活动公告。'});
  postId=draft.id;
  assert.equal((await api(a,forum,{requestId:randomUUID(),action:'approve',id:postId})).status,403);
  const published=await post(owner,forum,{action:'approve',id:postId});
  await until(async()=>{const s=await get(owner,'/knowledge-admin/schools/uw/status');return s.sources.some(x=>x.kind==='forum-index'&&x.source_id===postId&&x.current&&x.indexed_revision===published.revision);},30000);
  const found=ok(await api(a,'/history-index/schools/uw/search',{query:'紫杉迎新志愿地图',orgId:org,includeHistory:true}));assert(found.items.some(x=>x.sourceId===postId));
  assert.equal((await api(b,'/history-index/schools/uw/search',{query:'紫杉迎新志愿地图',orgId:org,includeHistory:true})).status,403);
  const gate=await fetch(config.schools[0].forumUrl+'/api/categories');assert.equal(gate.status,401);
 });
 await check('reviewed native forum event reconciles to exactly one five-point contribution',async()=>{
  const score=async()=>(await pool.query('SELECT coalesce(sum(delta),0)::int score,count(*)::int entries FROM hd_contributions WHERE school_id=$1 AND user_id=$2 AND scope_id=$3 AND period=$4',['uw',a.userId,org,period.period])).rows[0];
  await until(async()=>{const s=await score();return s.score===5&&s.entries===1;},15000);
  await post(owner,school+'/reconcile',{});
  assert.deepEqual(await score(),{score:5,entries:1});
 });
 await check('reviewed public snapshot runs actual pg-boss and ONNX/pgvector indexing',async()=>{
  publicVersion=(await get(owner,'/knowledge-admin/schools/uw/status')).publicVersion;
  const documents=[{id:'uw-qa-public',revision:1,title:'青杉导览测试卡',body:'青杉导览测试卡的颜色是紫色。本条仅用于隔离验收，不代表真实学校政策。',published:true},{id:'uw-qa-private',title:'未发布原件',body:'PRIVATE_MARKER_'+run,published:false}];
  const v=await post(owner,'/knowledge-admin/schools/uw/documents',{expectedVersion:publicVersion,confirmed:true,documents});publicVersion=v.version;
  await until(async()=>{const s=await get(owner,'/knowledge-admin/schools/uw/status');return s.sources.some(x=>x.kind==='knowledge-index'&&x.current&&x.indexed_revision===publicVersion);},30000);
  const snap=(await pool.query('SELECT documents FROM hd_knowledge_snapshots WHERE school_id=$1 AND version=$2',['uw',publicVersion])).rows[0];
  assert.equal(snap.documents.length,1);assert(!JSON.stringify(snap).includes('PRIVATE_MARKER_'));
  const answer=ok(await api(a,'/api/reception',{message:'青杉导览测试卡是什么颜色？',messageId:randomUUID()}));
  assert(JSON.stringify(answer).includes('uw-qa-public'),'live reception must cite indexed document');
 });
 await check('withdrawal removes the published source from real reception',async()=>{
  const v=await post(owner,'/knowledge-admin/schools/uw/documents',{expectedVersion:publicVersion,confirmed:true,documents:[]});publicVersion=v.version;
  const answer=ok(await api(a,'/api/reception',{message:'青杉导览测试卡是什么颜色？',messageId:randomUUID()}));
  assert(!JSON.stringify(answer).includes('uw-qa-public'));
  await until(async()=>{const s=await get(owner,'/knowledge-admin/schools/uw/status');return s.sources.some(x=>x.kind==='knowledge-index'&&x.current&&x.indexed_revision===publicVersion);},30000);
 });
 const result={at:new Date().toISOString(),status:'PASS',environment:'local WSL Ubuntu native Docker services',school:'uw',space:'uw-seattle',fixtureOnly:true,checks,avatarModelHash:saved.modelHash,org,postId,boundaries:['Not official UW accounts or policy','No external merchant fulfillment or production SMTP/TLS acceptance','Existing packages and visitor data not migrated']};
 await writeFile(join(out,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:'PASS',checks:checks.length,evidence:out}));
}catch(error){await writeFile(join(out,'failure.json'),JSON.stringify({at:new Date().toISOString(),checks,error:error.message},null,2)+'\n',{flag:'wx'});throw error;}
finally{await pool.end();}
