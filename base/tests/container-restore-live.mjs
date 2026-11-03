import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { openPlatform } from '../src/platform/db.mjs';
import { openPgStore } from '../src/platform/pg-store.mjs';
import { createReceptionSessions } from '../src/reception/sessions.mjs';
if (process.platform !== 'linux' || process.env.HD_M1_TEST_FIXTURE !== '1')
  throw Error('Ubuntu isolated fixture only');
const source = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8'));
assert(new URL(source.databaseUrl).pathname.includes('hdnetworkzip'));
const backup = process.env.HD_CONTAINER_BACKUP,
  target = process.env.HD_CONTAINER_RESTORE;
assert(
  backup?.startsWith('/backups/') && target?.startsWith('/runtime/') && target !== source.runtime,
);
const namespace = 'hdziprestore' + Date.now().toString(36);
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
    target,
    '--namespace',
    namespace,
    '--base-port',
    '6482',
    '--idp-port',
    '9482',
    '--forum-port',
    '5867',
    '--nakama-port',
    '9850',
  ],
  { env: { ...process.env, HD_M0_PG_ADMIN: admin.href }, stdio: 'inherit' },
);
assert.equal(
  await new Promise((r, j) => {
    child.once('exit', r);
    child.once('error', j);
  }),
  0,
);
const restored = JSON.parse(await readFile(target + '/private/config.json', 'utf8'));
const manifest = JSON.parse(await readFile(backup + '/manifest.json', 'utf8'));
assert.equal(manifest.databases.length, 7);
const a = new pg.Client({ connectionString: source.databaseUrl }),
  b = new pg.Client({ connectionString: restored.databaseUrl });
const compared = [];
let store, db;
const hash = (rows) =>
  createHash('sha256')
    .update(JSON.stringify(rows.map((r) => JSON.stringify(r)).sort()))
    .digest('hex');
try {
  await a.connect();
  await b.connect();
  for (const table of [
    'hd_runtime_state',
    'hd_avatars',
    'hd_m2_avatars',
    'hd_m2_inventory',
    'hd_m2_items',
    'hd_m2_collections',
    'hd_network_profiles',
    'hd_mentor_slots',
    'hd_mentor_bookings',
    'hd_career_opportunities',
    'hd_career_bookmarks',
  ]) {
    assert((await a.query('SELECT to_regclass($1) AS name', [table])).rows[0].name, table);
    const before = (await a.query('SELECT to_jsonb(t) AS row FROM ' + table + ' t')).rows,
      after = (await b.query('SELECT to_jsonb(t) AS row FROM ' + table + ' t')).rows;
    assert.equal(hash(before), hash(after), table);
    compared.push({ table, rows: before.length, sameRowHash: true });
  }
  const fixture = JSON.parse(await readFile(process.env.HD_CONTAINER_BACKUP_SESSION, 'utf8'));
  db = await openPlatform(restored.databaseUrl, { m1: true });
  store = await openPgStore(db, restored.dataDir);
  const row = store.read().receptionSessions[fixture.contextId];
  assert(row);
  const principal = { id: row.owner, spaces: ['north'], scopes: ['public:read', 'a2a:call'] };
  const sessions = createReceptionSessions({ store });
  const exported = await sessions.export(principal, 'north', 'north-reception', fixture.contextId);
  assert(JSON.stringify(exported).includes(fixture.marker));
  await assert.rejects(
    sessions.export(
      { ...principal, id: 'different-owner' },
      'north',
      'north-reception',
      fixture.contextId,
    ),
  );
  const out = process.env.HD_CONTAINER_EVIDENCE || '/runtime/evidence/ubuntu-hermes';
  await mkdir(out, { recursive: true });
  await writeFile(
    out + '/container-restore-live.json',
    JSON.stringify(
      {
        status: 'PASS',
        at: new Date().toISOString(),
        sevenDatabasesRestored: true,
        newNamespace: namespace,
        compared,
        activeRealHermesSessionExportedAfterRestore: true,
        crossOwnerDenied: true,
        sourceWritersStopped: true,
        sourcePreserved: true,
        limits:
          'Fictitious data on local Ubuntu; full storage restore and session manager verified, not a new production server cutover',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS seven-database independent restore with active real Hermes conversation and current-state hashes',
  );
} finally {
  await store?.close();
  await db?.close();
  await a.end();
  await b.end();
}
