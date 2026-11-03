import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { openPlatform } from '../src/platform/db.mjs';
import { openPgStore } from '../src/platform/pg-store.mjs';
import { createReceptionSessions } from '../src/reception/sessions.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Isolated fixture only');
const source = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8'));
assert(new URL(source.databaseUrl).pathname.startsWith('/hdnetwork26_'));
const dir = '/runtime/evidence/network',
  backup = '/backups/network-20261024',
  root = '/runtime/network-restore-20261024',
  namespace = 'hdnetworkrestore26';
const admin = new URL(source.databaseUrl);
admin.pathname = '/postgres';
admin.username = 'hd_bootstrap';
admin.password = (await readFile('/run/secrets/postgres_password', 'utf8')).trim();
const child = spawn(
  process.execPath,
  [
    'tools/m1-backup.mjs',
    'restore',
    '--backup',
    backup,
    '--runtime',
    root,
    '--namespace',
    namespace,
    '--base-port',
    '6380',
    '--idp-port',
    '9380',
    '--forum-port',
    '5767',
    '--nakama-port',
    '9750',
  ],
  { env: { ...process.env, HD_M0_PG_ADMIN: admin.href }, stdio: 'inherit' },
);
assert.equal(
  await new Promise((r, j) => {
    child.on('error', j);
    child.on('exit', r);
  }),
  0,
);
const restored = JSON.parse(await readFile(root + '/private/config.json', 'utf8')),
  manifest = JSON.parse(await readFile(backup + '/manifest.json', 'utf8'));
assert.equal(manifest.databases.length, 7);
const a = new pg.Client({ connectionString: source.databaseUrl }),
  b = new pg.Client({ connectionString: restored.databaseUrl });
await a.connect();
await b.connect();
const compared = [];
let store, db;
const hash = (rows) =>
  createHash('sha256')
    .update(JSON.stringify(rows.map((r) => JSON.stringify(r)).sort()))
    .digest('hex');
try {
  for (const table of [
    'hd_network_profiles',
    'hd_mentor_slots',
    'hd_mentor_bookings',
    'hd_career_opportunities',
    'hd_career_bookmarks',
    'hd_runtime_state',
  ]) {
    const before = (await a.query('SELECT to_jsonb(t) AS row FROM ' + table + ' t')).rows,
      after = (await b.query('SELECT to_jsonb(t) AS row FROM ' + table + ' t')).rows;
    assert.equal(hash(before), hash(after), table);
    compared.push({ table, rows: before.length, sameRowHash: true });
  }
  const fixture = JSON.parse(await readFile(dir + '/network-live.json', 'utf8')).restoreSession;
  db = await openPlatform(restored.databaseUrl, { m1: true });
  store = await openPgStore(db, restored.dataDir);
  const sessions = createReceptionSessions({ store }),
    principal = { id: fixture.owner, spaces: ['north'], scopes: ['public:read', 'a2a:call'] };
  const exported = await sessions.export(principal, 'north', 'north-reception', fixture.contextId);
  assert(exported.turns.some((t) => t.question.includes(fixture.marker)));
  await assert.rejects(
    sessions.export(
      { ...principal, id: 'another-owner' },
      'north',
      'north-reception',
      fixture.contextId,
    ),
  );
  const future = createReceptionSessions({ store, now: () => Date.now() + 366 * 86400000 });
  await future.expire();
  assert(!JSON.stringify(store.read()).includes(fixture.marker));
  await writeFile(
    dir + '/network-restore.json',
    JSON.stringify(
      {
        status: 'PASS',
        at: new Date().toISOString(),
        sevenDatabasesRestored: true,
        compared,
        restoredSessionExport: true,
        crossOwnerDenied: true,
        simulatedFutureRetentionClearsBodies: true,
        sourceWritersStopped: true,
        sourceUnchanged: true,
        limits:
          'Fictitious data on one host; restored storage/session manager verified. New target-server deployment and real school acceptance remain untested.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS seven-database independent restore; new business tables and runtime state match; restored session export/isolation/expiry verified',
  );
} finally {
  await store?.close();
  await db?.close();
  await a.end();
  await b.end();
}
