import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { openPlatform } from '../src/platform/db.mjs';
import { migrateM1 } from '../src/platform/migrate.mjs';
import { openPgStore } from '../src/platform/pg-store.mjs';
const ns = 'hdm1_migration_' + Date.now(),
  root = '/var/lib/postgresql/' + ns,
  password = randomBytes(24).toString('base64url');
await mkdir(root, { mode: 0o700 });
const admin = new pg.Client({ connectionString: process.env.HD_M0_PG_ADMIN });
await admin.connect();
await admin.query(`CREATE ROLE "${ns}" LOGIN PASSWORD '${password}'`);
await admin.query(`CREATE DATABASE "${ns}" OWNER "${ns}"`);
await admin.end();
const url = `postgresql://${ns}:${password}@127.0.0.1:5432/${ns}`,
  db = await openPlatform(url),
  results = [];
const sha = (b) => createHash('sha256').update(b).digest('hex');
try {
  await db.pool.query('CREATE TABLE hd_organizations (existing_user_data text)');
  await db.pool.query("INSERT INTO hd_organizations VALUES('preserve-existing')");
  await assert.rejects(migrateM1(db.pool));
  assert.equal(
    (
      await db.pool.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name='hd_users' AND column_name='enabled'",
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (await db.pool.query('SELECT existing_user_data FROM hd_organizations')).rows[0]
      .existing_user_data,
    'preserve-existing',
  );
  results.push({
    name: 'failed additive migration rolls back all schema changes and preserves original table rows',
    status: 'PASS',
  });
  // This is this test's deliberately incompatible blocker table, never a user's database.
  await db.pool.query('DROP TABLE hd_organizations');
  await migrateM1(db.pool);
  await migrateM1(db.pool);
  const state = {
    schema: 1,
    revision: 8,
    tasks: {
      'legacy-task': {
        id: 'legacy-task',
        owner: 'visitor-11111111111111111111111111111111',
        agentId: 'north-reception',
        spaceId: 'north',
        status: { state: 'TASK_STATE_COMPLETED' },
        history: [],
      },
    },
    receipts: { 'old-receipt': { hash: 'fixture', result: { id: 'unchanged' } } },
    positions: { fixture: { levelId: 'ground', point: [1, 0, 2] } },
    messages: [
      {
        id: 'old-message',
        spaceId: 'north',
        author: 'visitor-11111111111111111111111111111111',
        text: 'Fictional migration evidence',
      },
    ],
  };
  const input = root + '/state.json',
    config = root + '/config.json';
  await writeFile(input, JSON.stringify(state) + '\n', { mode: 0o600 });
  const original = await readFile(input);
  await writeFile(config, JSON.stringify({ databaseUrl: url }) + '\n', { mode: 0o600 });
  const child = spawn(
    process.execPath,
    ['tools/m1-import-json.mjs', '--input', input, '--backup', root + '/backup'],
    { env: { ...process.env, HD_M0_CONFIG: config }, stdio: 'inherit' },
  );
  assert.equal(await new Promise((r) => child.on('exit', r)), 0);
  assert.equal(sha(await readFile(input)), sha(original));
  assert.equal(sha(await readFile(root + '/backup/state.json')), sha(original));
  const store = await openPgStore(db, root);
  assert.deepEqual(store.read(), state);
  await assert.rejects(openPgStore(db, root), /already owned/);
  await store.transact((d) => {
    d.messages.push({ id: 'new-message' });
    return { stored: true };
  });
  await store.close();
  const reopened = await openPgStore(db, root);
  assert.equal(reopened.read().messages.length, 2);
  assert.deepEqual(reopened.read().receipts, state.receipts);
  await reopened.close();
  results.push({
    name: 'explicit backed-up JSON to PG import preserves IDs, receipts and source SHA; PG survives reopen and rejects a second writer',
    status: 'PASS',
  });
  await mkdir('qa/m1', { recursive: true });
  await writeFile(
    'qa/m1/migration.json',
    JSON.stringify(
      { kind: 'isolated real PostgreSQL migration and original JSON preservation', results },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS M1 migration and persistence');
} finally {
  await db.close();
}
