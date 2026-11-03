import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startUw} from '../server.mjs';
import {projectRoot} from '../src/base.mjs';
import {createCampusNavigation} from '../src/navigation.mjs';
import {createCampusWalking,WALK_SPEED,GUIDE_SPEED,WALK_RADIUS} from '../public/campus-walking.js';
import {FOUNTAIN} from '../public/campus-layout.js';
import {installVisitorWalking} from '../public/visitor-walk.js';
import {unobstructedVisitorCamera} from '../compat/3d-v052/public/visitor-camera.js';
import {baseRoot} from '../src/base.mjs';
import {pathToFileURL} from 'node:url';
const campus=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8'));

test('a wall behind the visitor selects a clear camera orbit instead of clipping into the head',async()=>{
  const T=await import(pathToFileURL(join(baseRoot,'node_modules/three/build/three.module.js')).href);
  const wall=new T.Mesh(new T.BoxGeometry(4,8,10),new T.MeshBasicMaterial());wall.position.set(3,4,0);wall.updateMatrixWorld(true);
  const target=new T.Vector3(0,1,0),position=new T.Vector3(8,4,0),resolved=unobstructedVisitorCamera(T,target,position,[wall]),delta=resolved.clone().sub(target);
  assert(delta.length()>5);assert.equal(new T.Raycaster(target,delta.clone().normalize(),.1,delta.length()).intersectObjects([wall]).length,0);
  wall.geometry.dispose();wall.material.dispose();
});

test('a short button tap still sends stop when the movement response arrives after the tap expired',async()=>{
  const previousWindow=globalThis.window,previousDocument=globalThis.document,button=new EventTarget();button.dataset={walkKey:'KeyW'};button.setPointerCapture=()=>{};button.hasPointerCapture=()=>false;
  globalThis.window=new EventTarget();globalThis.document=Object.assign(new EventTarget(),{querySelectorAll:()=>[button]});
  let revision=0,finalStatus='';const calls=[];
  try{
    const controller=installVisitorWalking({canvas:new EventTarget(),revision:()=>revision,direction:()=>[0,-1],enterView:()=>{},canInput:()=>true,onMove:m=>{revision=m.revision;},onSync:()=>assert.fail('unexpected resync'),status:s=>{finalStatus=s;},api:async(path)=>{calls.push(path);if(path==='/api/walk')await delay(240);return {revision:revision+1,stopped:path.endsWith('/stop')};}});
    const event=type=>Object.assign(new Event(type),{button:0,pointerId:1});button.dispatchEvent(event('pointerdown'));button.dispatchEvent(event('pointerup'));
    await delay(380);assert.deepEqual(calls,['/api/walk','/api/move/stop']);assert.match(finalStatus,/已停下/);await controller.pause();
  }finally{globalThis.window=previousWindow;globalThis.document=previousDocument;}
});

test('free walking sweeps the whole step, respects building/courtyard walls, water and terrain bounds',()=>{
  const fixture={terrain:{bounds:[-40,-40,40,40],width:2,height:2,heights:[0,0,0,0]},paths:[],buildings:[{rings:[[[-2,-2],[2,-2],[2,2],[-2,2]],[[.5,.5],[1.5,.5],[1.5,1.5],[.5,1.5]]]}]};
  const w=createCampusWalking(fixture);assert(!w.allowed(0,0));assert(w.allowed(1,1));assert(!w.segmentClear([-5,0,0],[5,0,0]));
  let point=[-8,0,0];for(let i=0;i<20;i++){const result=w.step(point,[1,0],500);for(const p of result.path)assert(w.allowed(p.point[0],p.point[2]));point=result.path.at(-1).point;}
  assert(point[0]<=-2-WALK_RADIUS&&point[0]>-2.7);assert(!w.allowed(40,0));
  const diagonal=w.step([-20,0,-20],[Math.SQRT1_2,Math.SQRT1_2],500);assert(Math.hypot(diagonal.path.at(-1).point[0]+20,diagonal.path.at(-1).point[2]+20)<=WALK_SPEED*.5+.00001);
  const real=createCampusWalking(campus);point=[FOUNTAIN.x+29,0,FOUNTAIN.z];for(let i=0;i<8;i++)point=real.step(point,[-1,0],500).path.at(-1).point;
  assert(Math.hypot(point[0]-FOUNTAIN.x,point[2]-FOUNTAIN.z)>=FOUNTAIN.rimRadius+WALK_RADIUS);
  assert.equal(point[1],real.height(point[0],point[2]));
});

test('manual positions join a clear public path without snapping back, and unsafe direct connectors are rejected',()=>{
  const nav=createCampusNavigation(campus);let point=[...nav.nodes[nav.landmark('red-square').arrivalNode]];
  point=nav.walking.step(point,[1,0],500).path.at(-1).point;
  const route=nav.route(point,'hub');assert.deepEqual(route.path[0].point,point);assert.equal(route.geometryHash,campus.geometryHash);
  assert(route.freeWalkConnector);assert(nav.walking.segmentClear(route.path[0].point,route.path[1].point));
  assert.throws(()=>nav.route([FOUNTAIN.x,0,FOUNTAIN.z],'hub'),/漫游/);
});

test('HTTP manual movement is server-owned, speed-bounded, isolated, CAS/idempotent and restored after restart',async()=>{
  const dir=await mkdtemp(join(projectRoot,'.local/qa-walking-'));let app=await startUw({port:0,dataDir:dir,provider:null});
  const client=()=>({cookie:'',async call(path,body,headers={}){const response=await fetch(app.origin+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json',Cookie:this.cookie,...headers}});if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,value:await response.json()};}});
  try{
    const alice=client(),bob=client(),before=(await alice.call('/api/me')).value,other=(await bob.call('/api/me')).value;
    assert.notEqual(before.visitorId,other.visitorId);assert.equal(before.walking.speed,WALK_SPEED);
    let revision=before.move?.revision||0;
    for(const extra of [{durationMs:10000},{direction:[100,0]},{position:[0,0,0]},{principalId:other.visitorId}])assert.equal((await alice.call('/api/walk',{direction:[1,0],durationMs:450,expectedRevision:revision,requestId:randomUUID(),...extra})).status,400);
    assert.equal((await alice.call('/api/walk',{direction:[1,0],durationMs:450,expectedRevision:revision,requestId:randomUUID()},{Origin:'https://untrusted.example'})).status,403);
    const started=Date.now(),body={direction:[1,0],durationMs:450,expectedRevision:revision,requestId:randomUUID()},first=(await alice.call('/api/walk',body)).value;
    revision=first.revision;assert.equal(first.mode,'free');assert.equal((await alice.call('/api/walk',body)).value.replayed,true);
    assert.equal((await alice.call('/api/walk',{...body,requestId:randomUUID()})).status,409);
    await delay(160);
    for(let i=0;i<8;i++){const move=await alice.call('/api/walk',{direction:[1,0],durationMs:450,expectedRevision:revision,requestId:randomUUID()});assert.equal(move.status,200);revision=move.value.revision;}
    const stop=(await alice.call('/api/move/stop',{requestId:randomUUID(),expectedRevision:revision})).value,point=stop.path[0].point;
    const distance=Math.hypot(point[0]-before.position[0],point[2]-before.position[2]);assert(distance>.2);assert(distance<=WALK_SPEED*(Date.now()-started)/1000+.04,'rapid requests cannot multiply walking speed');
    assert.deepEqual((await bob.call('/api/me')).value.position,other.position);
    const guided=await alice.call('/api/move',{requestId:randomUUID(),toId:'hub'});assert.equal(guided.status,200);assert.equal(guided.value.previewSpeed,GUIDE_SPEED);assert.deepEqual(guided.value.path[0].point,point);
    const final=(await alice.call('/api/move/stop',{requestId:randomUUID(),expectedRevision:guided.value.revision})).value.path[0].point;
    await app.close();app=await startUw({port:0,dataDir:dir,provider:null});assert.deepEqual((await alice.call('/api/me')).value.position,final);
    console.log('QA walking fixture: '+dir);
  }finally{await app.close();}
});
