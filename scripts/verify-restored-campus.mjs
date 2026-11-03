import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {baseRoot} from '../src/base.mjs';
if(process.env.HD_M1_TEST_FIXTURE!=='1')throw Error('Isolated restored fixture required');
const {config,login,api}=await import(pathToFileURL(join(baseRoot,'tests/m1-helpers.mjs')));
if(!config.relocatedFrom||config.schools[0]?.spaceId!=='uw-seattle')throw Error('Restored UW clone required');
const before=JSON.parse(await readFile(process.env.UW_BEFORE_EVIDENCE,'utf8'));
const {default:pg}=await import(pathToFileURL(join(baseRoot,'node_modules/pg/lib/index.js')));
const pool=new pg.Pool({connectionString:config.databaseUrl}),checks=[];
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const a=await login('alice'),b=await login('bob'),owner=await login('moda');
try{
 const avatar=ok(await api(a,'/api/avatar'));assert.equal(avatar.profile.modelHash,before.avatarModelHash);assert.equal(avatar.identityMode,'member');checks.push('restored account identity and identical UW avatar');
 const inventory=ok(await api(a,'/m2/schools/uw/inventory'));assert(inventory.starterClaimed);assert.equal(inventory.equippedItem,'stamp-book');
 assert(ok(await api(a,'/m2/schools/uw/collections')).items.some(x=>x.kind==='stamp'&&x.payload.entityId==='red-square'));checks.push('inventory and landmark collection retained');
 const conversations=ok(await api(a,'/m1/schools/uw/chat')).conversations;assert(conversations.length);
 const messages=ok(await api(a,'/m1/schools/uw/chat/'+conversations[0].conversation_id+'/messages'));assert(messages.items.some(x=>x.text.includes('真实 Nakama UW 隔离通信')));checks.push('Nakama native message body retained');
 const history=ok(await api(a,'/history-index/schools/uw/search',{query:'紫杉迎新志愿地图',orgId:before.org,includeHistory:true}));assert(history.items.some(x=>x.sourceId===before.postId));checks.push('NodeBB reviewed body and vector history retained');
 const score=(await pool.query('SELECT coalesce(sum(delta),0)::int score,count(*)::int entries FROM hd_contributions WHERE school_id=$1 AND user_id=$2 AND scope_id=$3',['uw',a.userId,before.org])).rows[0];assert.deepEqual(score,{score:5,entries:1});checks.push('contribution ledger not duplicated');
 const sessions=ok(await api(a,'/api/sessions')).sessions;assert(sessions.some(x=>x.turnCount>0));const session=sessions.find(x=>x.turnCount>0);
 const exported=ok(await api(a,'/api/sessions/'+session.contextId+'/export'));assert(exported.turns.length);assert.equal((await api(b,'/api/sessions/'+session.contextId+'/export')).status,403);assert.equal((await api(owner,'/api/sessions/'+session.contextId+'/export')).status,404);checks.push('reception memory, foreign-school gate and other-member export rejection retained');
 const status=ok(await api(owner,'/knowledge-admin/schools/uw/status'));assert(status.publicVersion>=2);checks.push('knowledge withdrawal version retained');
 const health=await (await fetch(config.origin+'/health')).json();assert(health.nativeCampus&&health.generalConversation);assert.equal(health.provider,'hermes');checks.push('restored UW host and real Hermes configuration active');
 const result={at:new Date().toISOString(),status:'PASS',sourceOrigin:config.relocatedFrom.origin,restoredOrigin:config.origin,checks,databases:5,sourcePreserved:true,productionCutover:false};
 await writeFile(process.env.UW_RESTORE_EVIDENCE||'/runtime/evidence/uw-native-restore.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(result));
}finally{await pool.end();}
