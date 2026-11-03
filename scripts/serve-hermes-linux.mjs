// Container entry: the key is a private mounted file, never a command argument or public config.
import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {startUw} from '../server.mjs';
if(process.platform!=='linux')throw Error('Use this entry in Ubuntu/Linux.');
if(!process.env.UW_HERMES_KEY_FILE||!process.env.UW_DATA_DIR)throw Error('Set UW_HERMES_KEY_FILE and a private UW_DATA_DIR.');
const key=(await readFile(process.env.UW_HERMES_KEY_FILE,'utf8')).trim();
if(!key||key.length>4096||/[\r\n]/.test(key))throw Error('Invalid private model key');
const data=resolve(process.env.UW_DATA_DIR),root=resolve(process.env.UW_HERMES_ROOT||'/opt/hermes');
await mkdir(data,{recursive:true,mode:0o700});await stat(join(root,'.venv/bin/python'));await stat(join(root,'run_agent.py'));
const expected={provider:'hermes',python:join(root,'.venv/bin/python'),hermesRoot:root,timeoutMs:60000},file=join(data,'reception.json');
try{const existing=JSON.parse(await readFile(file,'utf8'));if(JSON.stringify(existing)!==JSON.stringify(expected))throw Error('Existing Hermes configuration differs; preserved.');}
catch(e){if(e.code!=='ENOENT')throw e;await writeFile(file,JSON.stringify(expected)+'\n',{flag:'wx',mode:0o600});}
process.env.DEEPSEEK_API_KEY=key;process.env.UW_RECEPTION_MODE='hermes';
if(process.argv[2]==='verify')await import('./verify-hermes-live.mjs');
else{
  const app=await startUw();console.log('UW Hermes reception ready: '+app.origin);
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
