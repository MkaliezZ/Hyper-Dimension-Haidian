import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {projectRoot,protocol} from '../src/base.mjs';
import {createCampusNavigation} from '../src/navigation.mjs';
import {campusPlaces} from '../public/campus-places.js';
import {NPC_CAST} from '../src/npc-cast.mjs';
const json=async f=>JSON.parse(await readFile(join(projectRoot,f),'utf8'));
const c=await json('data/campus.json'),{geometryHash,...body}=c;
assert.equal(c.id,'haidian-beijing');assert.equal(protocol.digest(body),geometryHash);
const space=await json('data/space.json'),scene=await json('public/assets/coherent/manifest.json'),r=await json('data/reception.json');
assert.equal(space.geometryHash,geometryHash);assert.equal(scene.geometryHash,geometryHash);assert.equal(scene.buildingCount,c.buildings.length);
assert.equal(c.terrain.status,'flat-artistic; no measured Beijing DEM');
assert(!JSON.stringify([c,r]).match(/washington\.edu|uw-seattle|Suzzallo|Drumheller|Denny Hall|USGS/));
const nav=createCampusNavigation(c),gate=nav.landmark('main-gate'),routes=[];
for(const p of nav.places){for(const [from,to]of [[gate.arrivalNode,p.id],[p.arrivalNode,gate.id]]){const route=nav.route(from,to);assert(route.path.length);assert.equal(route.geometryHash,geometryHash);for(let i=1;i<route.path.length;i++)assert(nav.walking.segmentClear(route.path[i-1].point,route.path[i].point),p.id);routes.push({from,to,metres:route.distance});}}
for(const p of NPC_CAST){assert(p.agentId.startsWith('haidian-npc-'));assert(nav.landmark(p.home));}
const assetFiles=[];
for(const row of scene.tiles){for(const [key,hash]of [['color','colorSha256'],['depth','depthSha256']]){const b=await readFile(join(projectRoot,'public/assets/coherent',row[key]));assert.equal(createHash('sha256').update(b).digest('hex'),row[hash]);assetFiles.push(row[key]);}}
for(const p of c.landmarks){const portrait=scene.portraits.find(a=>a.placeId===p.id);assert(portrait,p.id+' portrait');const b=await readFile(join(projectRoot,'public/assets/coherent',portrait.path));assert.equal(createHash('sha256').update(b).digest('hex'),portrait.sha256);}
assert.equal(campusPlaces(c).length,c.buildings.length+c.landmarks.filter(p=>!p.buildingId).length);
const result={status:'PASS',date:new Date().toISOString(),school:c.id,buildings:c.buildings.length,places:nav.places.length,landmarks:c.landmarks.length,npcs:NPC_CAST.length,verifiedRoutes:routes.length,verifiedColorDepthFiles:assetFiles.length,geometryHash,sourceAccuracy:'historical schematic; current physical campus NOT_VERIFIED',routes};
const previous=await json('evidence/haidian/spatial.json').catch(()=>null);
if(previous?.geometryHash===geometryHash&&previous.status==='PASS')result.date=previous.date;
await mkdir(join(projectRoot,'evidence/haidian'),{recursive:true});await writeFile(join(projectRoot,'evidence/haidian/spatial.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,routes:undefined}));
