import {baseRoot} from '../src/base.mjs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const {BaseClient}=await import(pathToFileURL(join(baseRoot,'src/sdk/client.mjs')).href);
const token=process.env.HAIDIAN_A2A_TOKEN;
if(!token)throw Error('Set a privately issued HAIDIAN_A2A_TOKEN in the process environment; never paste it in public/chat.');
const client=new BaseClient({url:process.env.HAIDIAN_URL||'http://127.0.0.1:4290',token});
console.log(JSON.stringify(await client.card('haidian-reception'),null,2));
const result=await client.send('haidian-reception','规划从校园东门到国际教学楼的户外导览',{
  skillId:'haidian.campus.route',args:{fromId:'main-gate',toId:'international-teaching'},
});
console.log(JSON.stringify(result,null,2));
