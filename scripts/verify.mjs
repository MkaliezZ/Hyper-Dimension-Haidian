import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {projectRoot,protocol} from '../src/base.mjs';
import {createCampusNavigation} from '../src/navigation.mjs';
const manifest=JSON.parse(await readFile(join(projectRoot,'DATA-MANIFEST.json'),'utf8'));
for(const file of manifest.files){const b=await readFile(join(projectRoot,file.path));if(b.length!==file.bytes||createHash('sha256').update(b).digest('hex')!==file.sha256)throw Error('Changed derived data: '+file.path);}
const {geometryHash,...campus}=JSON.parse(await readFile(join(projectRoot,'data/campus.json'),'utf8'));
if(protocol.digest(campus)!==geometryHash)throw Error('Geometry fingerprint mismatch');
const nav=createCampusNavigation({...campus,geometryHash});
for(const from of campus.landmarks)for(const to of campus.landmarks){const route=nav.route(from.arrivalNode,to.id);if(route.geometryHash!==geometryHash||!route.path.length)throw Error('Disconnected public landmark');}
for(const p of campus.landmarks)if(!campus.graph.nodes[p.arrivalNode])throw Error('Missing arrival node');
for(const b of campus.buildings)if(b.heightStatus!=='inferred')throw Error('Missing inferred-height label');
if(campus.terrain.verticalExaggeration!==1)throw Error('Unreported terrain exaggeration');
console.log(JSON.stringify({status:'PASS',dataFiles:manifest.files.length,geometryHash,routePairs:campus.landmarks.length**2,baseVersion:protocol.BASE_VERSION,mode:'UW school outdoor adapter; Base core unchanged'},null,2));
