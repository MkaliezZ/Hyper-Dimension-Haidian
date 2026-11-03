import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const args = process.argv.slice(2);
if (!args.includes('--runtime') || !args.includes('--namespace'))
  throw Error('m2-init --runtime NEW_ROOT --namespace NEW_DB_PREFIX [--fixtures]');
const p = spawn(process.execPath, ['tools/m1-init.mjs', ...args], {
  stdio: 'inherit',
  env: process.env,
});
if ((await new Promise((r) => p.once('exit', r))) !== 0) process.exit(1);
const root = resolve(args[args.indexOf('--runtime') + 1]),
  path = join(root, 'private/config.json'),
  c = JSON.parse(await readFile(path, 'utf8'));
c.m2Enabled = true;
await writeFile(path, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
console.log('M2 enabled only in the newly initialized runtime');
