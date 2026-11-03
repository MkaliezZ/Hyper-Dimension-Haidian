import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import pg from 'pg';
import { config } from './m1-helpers.mjs';
import { drainOutbox } from '../src/platform/ledger.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Isolated fixture only');
const schema = 'qa_outbox_' + randomUUID().replaceAll('-', ''),
  control = new pg.Pool({ connectionString: config.databaseUrl, max: 1 }),
  checks = [];
await control.query('CREATE SCHEMA ' + schema);
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 8,
  options: '-c search_path=' + schema,
});
try {
  await pool.query(
    'CREATE TABLE hd_outbox(id bigserial primary key,school_id text,user_id uuid,period text,score integer,version integer,delivered boolean default false,attempts integer default 0)',
  );
  const user = randomUUID();
  await pool.query(
    "INSERT INTO hd_outbox(school_id,user_id,period,score,version) VALUES('fictitious',$1,'fictitious',5,1),('fictitious',$1,'fictitious',7,2)",
    [user],
  );
  let active = 0,
    maxActive = 0;
  const calls = [];
  const project = async (row) => {
    active++;
    maxActive = Math.max(maxActive, active);
    calls.push(row.id);
    await new Promise((r) => setTimeout(r, 20));
    active--;
  };
  // A production fixture worker may briefly own this database-wide lock; wait for a completed pass.
  const started = Date.now();
  let delivered = 0;
  while (!delivered && Date.now() - started < 5000) {
    delivered = (
      await Promise.all(Array.from({ length: 8 }, () => drainOutbox({ pool }, project)))
    ).reduce((a, b) => a + b, 0);
    if (!delivered) await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(delivered, 2);
  assert.equal(maxActive, 1);
  assert.deepEqual(calls, ['1', '2']);
  assert.deepEqual(
    (await pool.query('SELECT attempts,delivered FROM hd_outbox ORDER BY id')).rows,
    [
      { attempts: 1, delivered: true },
      { attempts: 1, delivered: true },
    ],
  );
  checks.push({
    name: 'eight concurrent PostgreSQL workers have one owner; each queued version delivered once',
    status: 'PASS',
  });
  await pool.query(
    "INSERT INTO hd_outbox(school_id,user_id,period,score,version) VALUES('fictitious',$1,'fictitious',9,3)",
    [user],
  );
  let failed = false;
  const deadline = Date.now() + 5000;
  while (!failed && Date.now() < deadline) {
    try {
      await drainOutbox({ pool }, async () => {
        throw Error('fixture_delivery_failure');
      });
    } catch (e) {
      assert.equal(e.message, 'fixture_delivery_failure');
      failed = true;
    }
    if (!failed) await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(failed, true);
  assert.deepEqual(
    (await pool.query('SELECT delivered,attempts FROM hd_outbox WHERE id=3')).rows[0],
    { delivered: false, attempts: 1 },
  );
  let retried = 0;
  while (!retried && Date.now() < deadline) {
    retried = await drainOutbox({ pool }, async (row) => {
      assert.equal(row.version, 3);
      assert.equal(row.score, 9);
    });
    if (!retried) await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(retried, 1);
  assert.deepEqual(
    (await pool.query('SELECT delivered,attempts FROM hd_outbox WHERE id=3')).rows[0],
    { delivered: true, attempts: 2 },
  );
  checks.push({
    name: 'failed delivery remains pending; original score/version retries and lock is released',
    status: 'PASS',
  });
  await pool.query(
    'ALTER TABLE hd_outbox ADD COLUMN last_error_code text, ADD COLUMN last_attempt_at timestamptz',
  );
  const failedUsers = Array.from({ length: 101 }, () => randomUUID());
  for (const id of failedUsers)
    await pool.query(
      "INSERT INTO hd_outbox(school_id,user_id,period,score,version) VALUES('unavailable',$1,'term',1,1),('unavailable',$1,'term',2,2)",
      [id],
    );
  const healthyUser = randomUUID();
  await pool.query(
    "INSERT INTO hd_outbox(school_id,user_id,period,score,version) VALUES('healthy',$1,'term',3,1),('healthy',$1,'term',4,2)",
    [healthyUser],
  );
  const projected = [];
  let failureSummary;
  for (let pass = 0; pass < 2; pass++) {
    try {
      await drainOutbox({ pool, campusEnabled: true }, async (row) => {
        if (row.school_id === 'unavailable') {
          assert.equal(row.version, 1, 'a failed subject must retain version order');
          const error = Error('private upstream detail must not be saved');
          error.status = 403;
          throw error;
        }
        projected.push(row.version);
      });
      assert.fail('overall health must still fail');
    } catch (error) {
      failureSummary = error.outbox;
      assert.equal(failureSummary.failures.length, 101);
      assert.equal(failureSummary.delivered, pass === 0 ? 2 : 0);
    }
  }
  assert.deepEqual(projected, [1, 2], 'healthy subjects after multiple full pages progress once');
  const pending = (
    await pool.query(
      "SELECT version,delivered,attempts,last_error_code,last_attempt_at FROM hd_outbox WHERE school_id='unavailable' ORDER BY id",
    )
  ).rows;
  for (const row of pending) {
    assert.equal(row.delivered, false);
    assert.equal(row.attempts, row.version === 1 ? 2 : 0);
    assert.equal(row.last_error_code, row.version === 1 ? 'projection_identity_unavailable' : null);
    assert.equal(Boolean(row.last_attempt_at), row.version === 1);
  }
  assert.equal(await drainOutbox({ pool, campusEnabled: true }, async () => {}), 202);
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int n FROM hd_outbox WHERE NOT delivered OR last_error_code IS NOT NULL',
      )
    ).rows[0].n,
    0,
  );
  checks.push({
    name: '101 unavailable identities across three keyset pages retain order and diagnostics; later healthy school progresses once; original rows recover without permission changes',
    status: 'PASS',
  });
  await mkdir('qa/campus', { recursive: true });
  await writeFile(
    'qa/campus/campus-ledger-outbox.json',
    JSON.stringify(
      {
        scope:
          'real isolated PostgreSQL and synthetic delivery callback; live Nakama covered separately',
        checks,
      },
      null,
      2,
    ),
  );
  console.log('PASS ' + checks.length + ' real PostgreSQL outbox concurrency/failure checks');
} finally {
  await pool.end();
  await control.query('DROP SCHEMA ' + schema + ' CASCADE');
  await control.end();
}
