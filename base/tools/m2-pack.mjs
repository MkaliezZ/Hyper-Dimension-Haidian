import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { packComplete } from './pack.mjs';
const out = process.argv[2];
if (!out) throw Error('m2-pack NEW_ZIP_PATH; sealed packages must not be overwritten');
await access('M2-START.md');
await access('assets/avatars/catalog.json');
await access('evidence/m2/ACCEPTANCE.md');
console.log(JSON.stringify(await packComplete(process.cwd(), resolve(out)), null, 2));
