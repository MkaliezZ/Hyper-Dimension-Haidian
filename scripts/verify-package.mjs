import {readFile,realpath} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(resolve(root,'PACKAGE-MANIFEST.json'),'utf8'));
if(manifest.format!=='hyper-dimension.school-delivery/v1')throw Error('Unknown UW package manifest');
const names=new Set();
for(const item of manifest.files){
  if(names.has(item.path)||item.path.split('/').includes('..')||item.path.includes('\\'))throw Error('Invalid/duplicate manifest path');
  names.add(item.path);const file=await realpath(resolve(root,item.path));
  if(!file.startsWith(root+sep))throw Error('Package path escaped root');
  const data=await readFile(file);if(data.length!==item.bytes||createHash('sha256').update(data).digest('hex')!==item.sha256)throw Error('Missing/changed file: '+item.path);
}
console.log(`PASS: ${manifest.files.length} UW and embedded Base files matched SHA-256. Private runtime data is outside this snapshot.`);
