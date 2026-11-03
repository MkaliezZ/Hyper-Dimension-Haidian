import {readFile,writeFile,rename} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {projectRoot,protocol} from '../src/base.mjs';

export async function bindCampusData(file){
  const config=JSON.parse(await readFile(file,'utf8'));
  if(config.schools.length!==1||config.schools[0].schoolId!=='uw'||config.schools[0].spaceId!=='uw-seattle')throw Error('Dedicated UW configuration required');
  const school=config.schools[0],bundle=school.package||join(projectRoot,'data/space.json');
  const manifest=JSON.parse(await readFile(bundle,'utf8'));
  if(manifest.schema!=='hyper-dimension.geo-campus/v1'||manifest.spaceId!==school.spaceId||manifest.geometry!=='campus.json'||manifest.reception!=='reception.json')throw Error('Explicit UW outdoor data bundle required');
  const {geometryHash,...data}=JSON.parse(await readFile(join(dirname(bundle),manifest.geometry),'utf8'));
  if(geometryHash!==manifest.geometryHash||geometryHash!==protocol.digest(data))throw Error('Outdoor bundle geometry mismatch');
  if(!school.package){
    school.package=bundle;
    config.uwOutdoorBinding={contract:manifest.schema,geometryHash,addedAt:new Date().toISOString()};
    const pending=file+'.uw-binding-new';
    await writeFile(pending,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
    await rename(pending,file);
  }
  return config;
}
