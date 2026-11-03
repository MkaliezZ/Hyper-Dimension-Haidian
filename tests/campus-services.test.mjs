import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {projectRoot} from '../src/base.mjs';
import {loadCampusServices} from '../src/campus-services.mjs';
import {startUw} from '../server.mjs';
await mkdir(join(projectRoot,'.local'),{recursive:true});

test('campus service configuration rejects foreign spaces, unsafe origins and invented map places',async()=>{
  const dir=await mkdtemp(join(projectRoot,'.local/qa-services-config-'));
  try{
    const file=join(dir,'private.json'),campus={id:'uw-seattle',landmarks:[{id:'hub'}]};
    const valid={origin:'http://127.0.0.1:6180',schoolId:'uw-school',spaceId:'uw-seattle'};
    for(const change of [{origin:'http://external.example'},{origin:'https://a.example/path'},{origin:'https://user:secret@a.example'},{spaceId:'north'},{anchors:{invented:{sceneId:'main',entityId:'hall'}}},{anchors:{hub:{sceneId:'main',entityId:'hall',school:'foreign'}}}]){
      await writeFile(file,JSON.stringify({...valid,...change}));await assert.rejects(()=>loadCampusServices(file,campus));
    }
    await writeFile(file,JSON.stringify(valid));assert.equal((await loadCampusServices(file,campus)).spaceId,'uw-seattle');
  }finally{await rm(dir,{recursive:true});}
});

test('UW campus service HTTP bridge fails closed on school mismatch, revoked sessions and disabled modules',async()=>{
  // Explicit contract double for native /m0/me and network bootstrap. This does
  // not claim that PostgreSQL, Keycloak, NodeBB or Nakama ran in this test.
  let mode='ready';const forwarded=[];
  const backend=http.createServer((req,res)=>{
    forwarded.push({path:req.url,cookie:req.headers.cookie,authorization:req.headers.authorization});
    res.setHeader('Content-Type','application/json');
    if(mode==='redirect'){res.writeHead(302,{Location:'https://untrusted.example'});return res.end();}
    if(mode==='revoked'){res.writeHead(401);return res.end('{}');}
    const school={school_id:'uw-school',space_id:'uw-seattle',role:['owner','moderator'].includes(mode)?mode:'student',modules:{base2:true,base3:true,base4:false}};
    if(mode==='foreign')school.space_id='north';
    if(req.url==='/m0/me')return res.end(JSON.stringify({name:'QA',schools:[school],extensions:['m1','m2','community','network','activities','partners','environment','campus','reception-sessions','agents','rewards','annual','jobs','ledger','operations','contacts']}));
    if(req.url==='/network/schools/uw-school/bootstrap')return res.end(JSON.stringify({schoolId:'uw-school',places:mode==='missing-anchor'?[]:[{sceneId:'student-centre',entityId:'hub-lobby'}]}));
    res.writeHead(404);res.end('{}');
  });
  await new Promise(ok=>backend.listen(0,'127.0.0.1',ok));
  const dir=await mkdtemp(join(projectRoot,'.local/qa-services-http-'));let app;
  try{
    const file=join(dir,'connection.json');
    await writeFile(file,JSON.stringify({origin:`http://127.0.0.1:${backend.address().port}`,schoolId:'uw-school',spaceId:'uw-seattle',anchors:{hub:{sceneId:'student-centre',entityId:'hub-lobby'}}}));
    app=await startUw({port:0,dataDir:join(dir,'runtime'),campusServicesFile:file,provider:null});
    const cookie='hd_m1='+('x'.repeat(32))+'; hd_base=private-uw-visitor; unrelated=private';
    const get=(path,headers={Cookie:cookie})=>fetch(app.origin+path,{headers,redirect:'manual'});
    let response=await get('/api/campus-services',{}),value=await response.json();assert.equal(value.state,'login-required');assert.equal(forwarded.length,0);
    response=await get('/api/campus-services?place=hub');value=await response.json();assert.equal(value.state,'connected');assert.equal(value.placeLinked,true);
    assert.equal(value.modules.find(x=>x.id==='avatar').enabled,true);assert.equal(value.modules.find(x=>x.id==='partners').enabled,false);
    assert(forwarded.every(r=>r.cookie==='hd_m1='+('x'.repeat(32))&&!r.authorization));
    response=await get('/api/campus-services/open/community?place=hub');assert.equal(response.status,303);
    const link=new URL(response.headers.get('location'));assert.equal(link.pathname,'/community.html');assert.equal(link.searchParams.get('school'),'uw-school');assert.equal(link.searchParams.get('entityId'),'hub-lobby');
    response=await get('/api/campus-services/open/environment?place=hub');assert.equal(response.status,303);
    const feedback=new URL(response.headers.get('location'));assert.equal(feedback.pathname,'/environment.html');assert.equal(feedback.searchParams.get('sceneId'),'student-centre');assert.equal(feedback.searchParams.get('entityId'),'hub-lobby');
    response=await get('/api/campus-services/open/environment');const wholeSchool=new URL(response.headers.get('location'));assert.equal(wholeSchool.searchParams.has('entityId'),false);assert.equal(wholeSchool.searchParams.get('school'),'uw-school');
    assert.equal((await get('/api/campus-services/open/partners')).status,403);
    value=await(await get('/api/campus-services')).json();assert.equal(value.modules.length,23);assert(value.modules.find(m=>m.id==='agent-tasks').enabled);const taskEntry=await get('/api/campus-services/open/agent-tasks');assert.equal(taskEntry.status,303);assert.equal(new URL(taskEntry.headers.get('location')).pathname,'/agent-tasks.html');assert.equal(value.modules.find(m=>m.id==='knowledge').disabledReason,'需要学校负责人权限');assert.equal((await get('/api/campus-services/open/knowledge')).status,403);
    mode='owner';value=await(await get('/api/campus-services')).json();assert(value.modules.find(m=>m.id==='knowledge').enabled);assert(value.modules.find(m=>m.id==='jobs').enabled);
    const managed=await get('/api/campus-services/open/knowledge');assert.equal(managed.status,303);assert.equal(new URL(managed.headers.get('location')).pathname,'/knowledge.html');
    mode='moderator';value=await(await get('/api/campus-services')).json();assert(value.modules.find(m=>m.id==='session-policy').enabled);assert(!value.modules.find(m=>m.id==='knowledge').enabled);assert(!value.modules.find(m=>m.id==='jobs').enabled);
    mode='ready';
    assert.equal((await get('/api/campus-services/open/https://untrusted.example')).status,403);
    assert((await get('/api/campus-services?place=invented')).status>=400);
    mode='foreign';value=await (await get('/api/campus-services')).json();assert.equal(value.state,'school-denied');assert(value.modules.every(x=>!x.enabled));
    assert.equal((await get('/api/campus-services/open/avatar')).status,403);
    mode='revoked';assert.equal((await (await get('/api/campus-services')).json()).state,'login-required');
    mode='missing-anchor';assert.equal((await (await get('/api/campus-services?place=hub')).json()).state,'unavailable');
    mode='redirect';assert.equal((await (await get('/api/campus-services')).json()).state,'unavailable');
    await app.close();app=null;
    await mkdir(join(dir,'unconfigured'));
    app=await startUw({port:0,dataDir:join(dir,'unconfigured'),provider:null,campusServicesFile:null});
    assert.equal((await (await get('/api/campus-services')).json()).state,'not-configured');
  }finally{await app?.close();await new Promise(ok=>backend.close(ok));await rm(dir,{recursive:true});}
});
