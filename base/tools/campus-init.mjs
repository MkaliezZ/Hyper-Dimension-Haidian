import { spawn } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const args = process.argv.slice(2);
if (!args.includes('--runtime') || !args.includes('--namespace'))
  throw Error(
    'campus-init --runtime NEW_SERVICE_ROOT --namespace NEW_DATABASE_PREFIX [--fixtures]',
  );
const runtime = resolve(args[args.indexOf('--runtime') + 1]);
const configFile = join(runtime, 'private/config.json');
try {
  await access(configFile);
  throw Error(
    'Existing runtime config must be preserved; restore into a new namespace before upgrading',
  );
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const child = spawn(process.execPath, ['tools/m2-init.mjs', ...args], {
  stdio: 'inherit',
  env: process.env,
});
const code = await new Promise((done, reject) => {
  child.once('error', reject);
  child.once('exit', done);
});
if (code !== 0) process.exit(code || 1);
const config = JSON.parse(await readFile(configFile, 'utf8'));
config.campusEnabled = true;
config.partnersEnabled = true;
config.modules = { base1: true, base2: true, base3: true, base4: true };
await writeFile(configFile, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
console.log(
  'Campus modules enabled only in the new runtime. No external booking adapter, reward policy or production school data was configured.',
);
