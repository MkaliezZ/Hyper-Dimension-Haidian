import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { packComplete } from './pack.mjs';
const out = process.argv[2];
if (!out) throw Error('Pass a new M0 output ZIP path; existing archives are never replaced.');
try {
  await access(out);
  throw Error('Archive already exists; choose a new M0 version');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
await access('M0-START.md');
console.log(JSON.stringify(await packComplete(process.cwd(), resolve(out)), null, 2));
