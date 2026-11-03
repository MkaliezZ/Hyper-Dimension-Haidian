import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { packComplete } from './pack.mjs';
const out = process.argv[2];
if (!out) throw Error('m1-pack NEW_ZIP_PATH; sealed deliveries are never overwritten');
try {
  await access(out);
  throw Error('Archive already exists; use a new delivery version');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
await access('M1-START.md');
await access('evidence/m1/ACCEPTANCE.md');
console.log(JSON.stringify(await packComplete(process.cwd(), resolve(out)), null, 2));
