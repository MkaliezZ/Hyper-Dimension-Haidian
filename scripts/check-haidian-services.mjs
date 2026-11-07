// Real OIDC browser-session HTTP flow in the explicit fictional native instance.
// No credentials, cookies, private message bodies or task contents are exported.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
if(process.env.HD_M1_TEST_FIXTURE!=='1')throw Error('Explicit fictional fixture required');
const config=JSON.parse(await readFile(process.env.HD_M0_CONFIG,'utf8'));
assert.equal(config.schools[0].schoolId,'haidian');
const users=JSON.parse(await readFile(config.configRoot+'/test-users.json','utf8')),user=users.find(u=>u.username==='moda');
const cookies=new Map(),checks=[];
async function request(url,options={}){
 const r=await fetch(url,{...options,redirect:'manual',headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...options.headers}});
 for(const s of r.headers.getSetCookie()){const [kv]=s.split(';'),i=kv.indexOf('=');cookies.set(kv.slice(0,i),kv.slice(i+1));}return r;
}
async function follow(r){for(let i=0;i<12&&[301,302,303,307,308].includes(r.status);i++){const u=new URL(r.headers.get('location'),r.url);assert(['127.0.0.1','localhost'].includes(u.hostname));r=await request(u);}return r;}
let r=await follow(await request(config.origin+'/auth/login'));
assert.equal(r.status,200);const html=await r.text(),form=html.match(/<form[^>]+action="([^"]+)"/);
assert(form,'OIDC login form');
const loginUrl=form[1].replaceAll('&amp;','&');
r=await follow(await request(loginUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:user.username,password:user.credentials[0].value,credentialId:''})}));
assert.equal(r.status,200);assert(cookies.has('hd_m1'));checks.push('real OIDC authorization-code login and opaque browser cookie');
r=await request(config.origin+'/m0/me');assert.equal(r.status,200);const me=await r.json();assert(me.schools.some(s=>s.school_id==='haidian'&&s.space_id==='haidian-beijing'));checks.push('current owner identity bound to the independent school');
r=await request(config.origin+'/api/campus-services?place=library');assert.equal(r.status,200);const services=await r.json();assert.equal(services.state,'connected');assert.equal(services.schoolId,'haidian');assert.equal(services.modules.length,23);assert.equal(services.modules.filter(m=>m.enabled).length,23);
const opened=[];
for(const m of services.modules){
 const first=await request(config.origin+'/api/campus-services/open/'+m.id+'?place=library');assert.equal(first.status,303,m.id);
 const target=new URL(first.headers.get('location'),config.origin);assert.equal(target.origin,config.origin);assert(!target.href.includes('school=uw'));const page=await follow(await request(target));assert.equal(page.status,200,m.id);opened.push({module:m.id,status:page.status,path:target.pathname});
}
checks.push('all 23 owner-visible service links resolve through original access checks');
r=await request(config.origin+'/api/catalog');const catalog=await r.json();const space=catalog.spaces.find(s=>s.schoolId==='haidian');assert(space);assert.equal(space.scenes[0].sceneId,'haidian-outdoors');assert(space.agents.some(a=>a.agentId==='haidian-reception'));assert.equal(space.agents.filter(a=>a.agentId.startsWith('haidian-npc-')).length,6);checks.push('native catalog exposes Haidian reception, six NPCs and the outdoor scene');
r=await request(config.origin+'/agents/haidian-reception/a2a',{method:'POST',headers:{'Content-Type':'application/json','A2A-Version':'1.0',Origin:config.origin},body:JSON.stringify({jsonrpc:'2.0',id:'haidian-list',method:'ListTasks',params:{pageSize:20,historyLength:0,includeArtifacts:false}})});const tasks=await r.json();assert.equal(r.status,200);assert(!tasks.error,JSON.stringify(tasks.error));checks.push('original A2A ListTasks works under the actual browser identity');
const out={status:'PASS',at:new Date().toISOString(),fixtureOnly:true,checks,opened,school:'haidian',modules:opened.length,credentialsExported:false};
await mkdir('/runtime/evidence/haidian-v1',{recursive:true});await writeFile('/runtime/evidence/haidian-v1/services.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',checks:checks.length,modules:opened.length,credentialsExported:false}));
