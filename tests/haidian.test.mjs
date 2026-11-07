import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {projectRoot,protocol} from '../src/base.mjs';
import {createCampusNavigation} from '../src/navigation.mjs';
import {createCampusWalking,ringContains,WALK_SPEED,GUIDE_SPEED} from '../public/campus-walking.js';
import {createPixelCampusArt} from '../public/pixel-campus-art.js';
import {campusPlaces} from '../public/campus-places.js';
import {NPC_CAST} from '../src/npc-cast.mjs';
import {startUw} from '../server.mjs';
const c=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8'));
test('Haidian layout is separate, every building is selectable, and school art shares the geometry hash',()=>{
 const {geometryHash,...body}=c;assert.equal(protocol.digest(body),geometryHash);assert.equal(c.id,'haidian-beijing');
 const ids=new Set(campusPlaces(c).map(p=>p.id));for(const b of c.buildings)assert(ids.has(b.id));
 const art=createPixelCampusArt(c,{pixelsPerMetre:.5});assert.equal(art.metrics.sourceGeometryHash,geometryHash);assert.equal(art.metrics.buildings,c.buildings.length);assert.equal(art.metrics.cherryTrees,0);
 assert.equal(WALK_SPEED,7.8);assert.equal(GUIDE_SPEED,23.4);
});
test('river blocks walking except at the same rendered bridge, and cross-bank navigation remains swept-safe',()=>{
 const w=createCampusWalking(c),nav=createCampusNavigation(c);let blocked=0,bridge=0;
 for(let x=-20;x<240;x+=2)for(let z=50;z<270;z+=2){if(!c.waterAreas.some(r=>ringContains(x,z,r)))continue;if(c.bridges.some(r=>ringContains(x,z,r))&&w.allowed(x,z))bridge++;else{assert(!w.allowed(x,z));blocked++;}}
 assert(blocked>100);assert(bridge>10);
 const a=nav.landmark('main-gate'),b=nav.landmark('international-teaching'),route=nav.route(a.arrivalNode,b.id);
 assert(route.distance>100);assert(route.path.some(p=>c.bridges.some(r=>ringContains(p.point[0],p.point[2],r))));for(let i=1;i<route.path.length;i++)assert(w.segmentClear(route.path[i-1].point,route.path[i].point));
});
test('six fixed NPCs refer only to Haidian places and keep the inherited service features',()=>{
 const places=new Set(campusPlaces(c).map(p=>p.id));assert.equal(NPC_CAST.length,6);
 for(const n of NPC_CAST){assert(places.has(n.home));assert(n.agentId.startsWith('haidian-npc-'));assert(n.feature);for(const row of n.schedule)assert.equal(row[3],n.home);assert(!/American|quarter-system|美国大学|Maya|Leo|Jordan|Sam/.test(n.name+' '+n.role+' '+n.personality));}
});
test('independent Haidian HTTP instance reuses guest isolation, source reception, A2A and task receipts',async t=>{
 await mkdir(join(projectRoot,'.local'),{recursive:true});const dir=await mkdtemp(join(projectRoot,'.local/qa-haidian-')),app=await startUw({port:0,dataDir:dir,provider:null});t.after(()=>app.close());
 const req=async(path,options={})=>{const r=await fetch(app.origin+path,options);return {r,value:await r.json()};};
 const health=await req('/health');assert.equal(health.value.project,'hyper-dimension-haidian');assert.equal(health.value.npcCount,6);
 const photos=await req('/assets/place-photos/manifest.json'),photo=photos.value['swimming-hall'];const image=await fetch(app.origin+photo.path);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.equal(Buffer.from(await image.arrayBuffer()).readUInt16BE(0),0xffd8);
 const a=await req('/api/me'),b=await req('/api/me');const cookie=a.r.headers.get('set-cookie').split(';')[0],other=b.r.headers.get('set-cookie').split(';')[0];assert.notEqual(cookie,other);
 const catalog=await req('/api/catalog',{headers:{Cookie:cookie}});assert.equal(catalog.value.spaces[0].spaceId,'haidian-beijing');assert(catalog.value.spaces[0].agents.some(a=>a.agentId==='haidian-reception'));
 const card=await req('/agents/haidian-reception/.well-known/agent-card.json');assert.equal(card.r.status,200);assert(card.value.skills.some(s=>s.id==='haidian.campus.route'));
 const n=await req('/api/npcs',{headers:{Cookie:cookie}});for(const p of n.value.npcs){assert.equal(p.move,null);assert(p.agentId.startsWith('haidian-npc-'));}
 const forbidden=await req('/api/move',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',Origin:'https://other.invalid'},body:JSON.stringify({toId:'library',requestId:crypto.randomUUID()})});assert.equal(forbidden.r.status,403);
 const sources=await req('/api/sources');assert(sources.value.sources.some(s=>s.url==='https://www.bjfles.com/environment/'));
});
