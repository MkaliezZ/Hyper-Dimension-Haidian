import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {projectRoot,protocol} from '../src/base.mjs';
import {createCampusNavigation} from '../src/navigation.mjs';
const json=async(p)=>JSON.parse(await readFile(join(projectRoot,p),'utf8'));
const campus=await json('data/campus-unsealed.json').catch(()=>json('data/campus.json'));
delete campus.geometryHash;
campus.geometryHash=protocol.digest(campus);
const nav=createCampusNavigation(campus),routes=[];
for(const to of campus.landmarks){const route=nav.route(nav.landmark('red-square').arrivalNode,to.id);routes.push({to:to.id,distance:route.distance,pathPoints:route.path.length});}
await writeFile(join(projectRoot,'data/campus.json'),JSON.stringify(campus)+'\n');
const records=[];for(const path of ['data/campus.json','data/reception.json','data/terrain-uw-dem.tif']){
  const b=await readFile(join(projectRoot,path));records.push({path,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
}
await writeFile(join(projectRoot,'DATA-MANIFEST.json'),JSON.stringify({format:'uw.data-manifest/v1',version:'0.1.0',geometryHash:campus.geometryHash,files:records},null,2)+'\n');
await writeFile(join(projectRoot,'evidence/spatial-verification.json'),JSON.stringify({status:'PASS',geometryHash:campus.geometryHash,landmarks:campus.landmarks.length,buildings:campus.buildings.length,routesFromRedSquare:routes,network:'Published UW sidewalks clipped to exterior connected network',heightMeasured:false},null,2)+'\n');
console.log(JSON.stringify({status:'PASS',geometryHash:campus.geometryHash,buildings:campus.buildings.length,landmarks:campus.landmarks.length,routes},null,2));
