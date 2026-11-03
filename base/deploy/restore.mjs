import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2),
  value = (key) => args[args.indexOf(key) + 1];
if (!['--backup', '--target', '--namespace'].every((k) => args.includes(k)))
  throw Error(
    'restore.mjs --backup /backups/NAME --target /runtime/NEW_ROOT --namespace NEW_PREFIX [--base-port N --idp-port N --forum-port N --nakama-port N]',
  );
const target = resolve(value('--target')),
  source = process.env.HD_SERVICE_ROOT || '/runtime/services';
if (!target.startsWith('/runtime/') || target === source)
  throw Error('Only a new target inside the private runtime volume is accepted');
try {
  await lstat(target);
  throw Error('Restore target exists; preserved');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const password = (await readFile('/run/secrets/postgres_password', 'utf8')).trim();
const url = new URL('postgresql://127.0.0.1:' + (process.env.HD_PG_PORT || 55439) + '/postgres');
url.username = 'hd_bootstrap';
url.password = password;
const env = { ...process.env, HD_M0_PG_ADMIN: url.href };
async function run(argv) {
  const p = spawn(process.execPath, argv, { env, stdio: 'inherit' });
  const code = await new Promise((r, j) => {
    p.once('exit', r);
    p.once('error', j);
  });
  if (code !== 0) throw Error('Restore stopped; source and partial target retained for diagnosis');
}
await run([
  'tools/m1-backup.mjs',
  'restore',
  '--backup',
  value('--backup'),
  '--runtime',
  target,
  '--namespace',
  value('--namespace'),
  ...['--base-port', '--idp-port', '--forum-port', '--nakama-port'].flatMap((k) =>
    args.includes(k) ? [k, value(k)] : [],
  ),
]);
await run(['tools/m1-bind-restored-services.mjs', '--runtime', target, '--binaries', source]);
const ownership = spawn('chown', ['-R', '10001:10001', target], { stdio: 'inherit' });
if (
  (await new Promise((r, j) => {
    ownership.once('exit', r);
    ownership.once('error', j);
  })) !== 0
)
  throw Error('Restored ownership setup failed; source preserved and no writer started');
console.log(
  'Independent restored runtime prepared. Start it with its own HD_M0_CONFIG, relocate the OIDC client and run restored-data checks before any cutover. No original data or configuration was replaced.',
);
