import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {dirname} from 'node:path';
process.chdir('/app');
const mode=process.argv[2];
if(mode==='health'&&process.argv[3]==='base'){
  const {serviceRequest}=await import('../src/service-request.mjs');
  const c=JSON.parse(await readFile(process.env.HD_M0_CONFIG||'/runtime/services/private/config.json','utf8'));
  if(!Number.isSafeInteger(c.port)||c.port<1||c.port>65535)throw Error('Invalid configured health port');
  const response=await serviceRequest('http://127.0.0.1:'+c.port+'/health',{timeout:3000,maxBytes:8192});
  if(!response.ok)throw Error('Campus service is not healthy');
  const health=await response.json();
  if(!health.ok||!health.nativeCampus||health.schoolId!==c.schools[0].schoolId)throw Error('Unexpected campus health identity');
}else if(mode==='base'){
  const {receptionEnvironment}=await import('/app/deploy/reception-env.mjs');
  const cfg=dirname(process.env.HD_M0_CONFIG||'/runtime/services/private/config.json');
  Object.assign(process.env,JSON.parse(await readFile(cfg+'/runtime-env.json','utf8')));
  Object.assign(process.env,await receptionEnvironment({env:process.env,configRoot:cfg}));
  await import('/uw/scripts/serve-campus.mjs');
}else if(mode==='seed-uw-fixtures'){
  await import('/uw/scripts/seed-campus-fixtures.mjs');
}else if(mode==='verify-uw'){
  await import('/uw/scripts/verify-campus-live.mjs');
}else{
  await import(pathToFileURL('/app/deploy/entry.mjs'));
}
