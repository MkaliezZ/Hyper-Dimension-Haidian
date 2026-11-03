// Optional developer preview with a private local control channel; no public shutdown HTTP API.
import net from 'node:net';
import {readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {projectRoot} from '../src/base.mjs';
import {startUw} from '../server.mjs';
const local=resolve(projectRoot,'.local'),record=resolve(local,'preview-control.json');
if(process.argv[2]==='stop'){
  const control=JSON.parse(await readFile(record,'utf8'));
  if(control.root!==projectRoot)throw Error('Foreign preview record preserved');
  await new Promise((ok,bad)=>{const socket=net.connect(control.pipe,()=>socket.end(control.token+'\n'));socket.setTimeout(5000,()=>socket.destroy(Error('Preview stop timeout')));socket.on('data',data=>{if(data.toString().trim()==='stopped')ok();});socket.on('error',bad);});
  console.log('Task-owned UW preview stopped; persistent state preserved.');
}else{
  const app=await startUw();await mkdir(local,{recursive:true});
  const id=createHash('sha256').update(projectRoot+process.pid).digest('hex').slice(0,18),token=randomUUID();
  const pipe=process.platform==='win32'?'\\\\.\\pipe\\uw-preview-'+id:resolve(local,'preview-'+id+'.sock');
  let closing=false;
  const shutdown=async(socket)=>{if(closing)return;closing=true;await app.close();control.close();await unlink(record);if(process.platform!=='win32')await unlink(pipe).catch(()=>{});socket?.end('stopped\n');setTimeout(()=>process.exit(0),100).unref();};
  const control=net.createServer(socket=>{let text='';socket.on('data',chunk=>{text+=chunk;if(text.length>200)return socket.destroy();if(text.includes('\n')){if(text.trim()!==token)return socket.destroy();void shutdown(socket);}});});
  await new Promise((ok,bad)=>{control.once('error',bad);control.listen(pipe,ok);});
  await writeFile(record,JSON.stringify({pid:process.pid,root:projectRoot,pipe,token,origin:app.origin})+'\n',{mode:0o600});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void shutdown());
  console.log('UW preview ready: '+app.origin+'; stop: node scripts/local-preview.mjs stop');
}
