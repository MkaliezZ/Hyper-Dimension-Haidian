import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openPlatform, hash } from '../src/platform/db.mjs';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2),
  opt = (k) => args[args.indexOf(k) + 1];
if (!['--input', '--backup'].every((x) => args.includes(x)))
  throw Error('m1-import-json --input STOPPED_COPY/state.json --backup NEW_BACKUP_DIR');
const config = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8')),
  input = resolve(opt('--input')),
  backup = resolve(opt('--backup'));
const bytes = await readFile(input),
  state = JSON.parse(bytes);
if (
  state.schema !== 1 ||
  !state.tasks ||
  !state.positions ||
  !state.receipts ||
  !Array.isArray(state.messages)
)
  throw Error('Invalid legacy state; source unchanged');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  c = await db.pool.connect();
try {
  await c.query('BEGIN');
  if (
    !(
      await c.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended('hd-runtime-owner',0)) AS ok",
      )
    ).rows[0].ok
  )
    throw Error('Runtime active; stop before migration');
  if ((await c.query('SELECT 1 FROM hd_runtime_state')).rowCount)
    throw Error('Target already has runtime state; never overwrite');
  await mkdir(backup, { recursive: false, mode: 0o700 });
  await writeFile(join(backup, 'state.json'), bytes, { flag: 'wx', mode: 0o600 });
  if (hash(await readFile(join(backup, 'state.json'))) !== hash(bytes))
    throw Error('Backup verification failed');
  await c.query('INSERT INTO hd_runtime_state VALUES(true,$1)', [state]);
  const check = (await c.query('SELECT state FROM hd_runtime_state')).rows[0].state;
  if (
    JSON.stringify(Object.keys(check.tasks).sort()) !==
    JSON.stringify(Object.keys(state.tasks).sort())
  )
    throw Error('Migration reconciliation failed');
  await writeFile(
    join(backup, 'migration.json'),
    JSON.stringify({
      input,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      tasks: Object.keys(state.tasks).length,
      receipts: Object.keys(state.receipts).length,
      sourcePreserved: true,
    }) + '\n',
    { mode: 0o600 },
  );
  await c.query('COMMIT');
  console.log('Legacy state copied and reconciled; original not changed');
} catch (e) {
  await c.query('ROLLBACK');
  throw e;
} finally {
  c.release();
  await db.close();
}
