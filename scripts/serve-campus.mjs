// School-native host. Configuration is private, credentials remain in Keycloak.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {baseRoot} from '../src/base.mjs';
import {startUw} from '../server.mjs';
import {bindCampusData} from './bind-campus-data.mjs';
if(!process.env.HD_M0_CONFIG)throw Error('Set HD_M0_CONFIG to the private 海淀外国语 native services configuration.');
const config=await bindCampusData(process.env.HD_M0_CONFIG);
if(config.schools.length!==1||config.schools[0].spaceId!=='haidian-beijing'||config.milestone!=='M1'||!config.campusEnabled||!config.m2Enabled)
  throw Error('Use a dedicated 海淀外国语 M1 campus deployment; existing multi-school fixtures are not renamed.');
if(config.schools[0].schoolId==='north'||config.schools[0].schoolId==='south')throw Error('Choose a new explicit 海淀外国语 school ID.');
const {createPlatform}=await import(pathToFileURL(join(baseRoot,'src/platform/index.mjs')).href);
const platform=await createPlatform(config);
let app;
try{app=await startUw({platform,schoolId:config.schools[0].schoolId,port:config.port,dataDir:config.dataDir,publicOrigin:config.origin});}
catch(error){await platform.close();throw error;}
console.log(JSON.stringify({origin:app.origin,school:config.schools[0].schoolId,mode:'海淀外国语 native campus',placeContract:'hyper-dimension.geo-campus/v1'}));
let stopping=false;
const close=async()=>{if(stopping)return;stopping=true;await app.close();await platform.close();process.exit(0);};
process.on('SIGINT',close);process.on('SIGTERM',close);
