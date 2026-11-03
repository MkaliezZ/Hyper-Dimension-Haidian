import {baseRoot} from '../src/base.mjs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const {BaseClient}=await import(pathToFileURL(join(baseRoot,'src/sdk/client.mjs')).href);
const token=process.env.UW_A2A_TOKEN;
if(!token)throw Error('Set a privately issued UW_A2A_TOKEN in the process environment; never paste it in public/chat.');
const client=new BaseClient({url:process.env.UW_URL||'http://127.0.0.1:4190',token});
console.log(JSON.stringify(await client.card('uw-reception'),null,2));
const result=await client.send('uw-reception','规划从Red Square到HUB的户外导览',{
  skillId:'uw.campus.route',args:{fromId:'red-square',toId:'hub'},
});
console.log(JSON.stringify(result,null,2));
