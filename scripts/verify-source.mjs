import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(resolve(root,'SOURCE-MANIFEST.json'),'utf8'));
if(manifest.format!=='hyper-dimension.git-source/v1')throw Error('Unknown source manifest');
const seen=new Set();
for(const item of manifest.files){
  if(seen.has(item.path)||item.path.includes('\\')||item.path.split('/').includes('..'))throw Error('Unsafe/duplicate source path');
  seen.add(item.path);const file=await realpath(resolve(root,item.path));
  if(!file.startsWith(root+sep))throw Error('Source path escaped checkout');
  const bytes=await readFile(file);
  if(bytes.length!==item.bytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Changed/missing source: '+item.path);
}
console.log(`PASS: ${manifest.files.length} sanitized source files matched SHA-256 (application ${manifest.applicationVersion}).`);
