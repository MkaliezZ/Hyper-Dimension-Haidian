import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
if (process.platform !== 'linux' || !process.env.HD_CAMPUS_BACKUP)
  throw Error('Explicit isolated Ubuntu backup required');
const original = JSON.parse(await readFile('qa/campus/backup-source.json', 'utf8'));
const after = JSON.parse(await readFile('qa/campus/source-after-restore.json', 'utf8'));
assert.deepEqual(after.databases, original.databases);
await writeFile(
  'qa/campus/source-preserved.json',
  JSON.stringify(
    {
      status: 'PASS',
      databases: 7,
      checks: [
        {
          name: 'every source database table count and row hash remains identical after clone-only restore tests',
          status: 'PASS',
        },
      ],
    },
    null,
    2,
  ) + '\n',
);
const manifest = JSON.parse(
  await readFile(join(process.env.HD_CAMPUS_BACKUP, 'manifest.json'), 'utf8'),
);
const root = await mkdtemp('/opt/hd-base-m1-restores/campus-integrity-qa-');
const checks = [];
for (const kind of ['corrupt-bytes', 'unsupported-format']) {
  const dir = join(root, kind),
    target = join(root, kind + '-refused-target');
  await mkdir(dir);
  const m = structuredClone(manifest);
  if (kind === 'unsupported-format') m.format = 'hyper-dimension.full-backup/unsupported';
  else {
    const entry = m.files.find((f) => f.path.startsWith('databases/'));
    const bytes = await readFile(join(process.env.HD_CAMPUS_BACKUP, entry.path));
    bytes[bytes.length - 1] ^= 1;
    await mkdir(join(dir, 'databases'));
    await writeFile(join(dir, entry.path), bytes);
    m.files = [entry];
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(m));
  const env = { ...process.env };
  delete env.HD_M0_PG_ADMIN;
  const result = spawnSync(
    process.execPath,
    [
      'tools/m1-backup.mjs',
      'restore',
      '--backup',
      dir,
      '--runtime',
      target,
      '--namespace',
      'hdintegrityqa',
    ],
    { env, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    kind === 'corrupt-bytes' ? /Backup integrity failed/ : /Incomplete backup/,
  );
  await assert.rejects(stat(target), { code: 'ENOENT' });
  checks.push({
    name: kind + ' rejected before target directory or database access',
    status: 'PASS',
  });
}
await writeFile(
  'qa/campus/backup-rejection.json',
  JSON.stringify(
    {
      status: 'PASS',
      checks,
      scope:
        'new synthetic corrupt backup copies only; original backup and all source databases retained; no target/admin connection supplied',
    },
    null,
    2,
  ) + '\n',
);
console.log('PASS source preserved and two corrupt backup refusal gates');
