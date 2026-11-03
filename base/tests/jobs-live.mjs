import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { openPlatform } from '../src/platform/db.mjs';
import { createJobs, queueNames } from '../src/platform/jobs.mjs';
import { config, until } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Isolated campus fixture required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  schema = 'qa_jobs_' + randomUUID().replaceAll('-', ''),
  checks = [];
let q, q2;
const dueAt = new Date(Date.now() - 1000).toISOString();
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
try {
  q = await createJobs(config, { schema, workers: false });
  await test('business rollback also rolls back actual pg-boss enqueue', async () => {
    let id;
    await assert.rejects(
      db.tx(async (c) => {
        id = (await q.scheduleReminder(c, { schoolId: 'north', reminderId: randomUUID(), dueAt }))
          .jobId;
        throw Error('rollback');
      }),
      /rollback/,
    );
    assert.equal(await q.boss.getJobById(queueNames['activity-reminder'], id), null);
  });
  let saved,
    reminderId = randomUUID();
  await test('ten exact transaction enqueues retain one stable job', async () => {
    const r = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.tx((c) => q.scheduleReminder(c, { schoolId: 'north', reminderId, dueAt })),
      ),
    );
    assert.equal(new Set(r.map((x) => x.jobId)).size, 1);
    saved = r[0].jobId;
    await assert.rejects(
      db.tx((c) =>
        q.scheduleReminder(c, {
          schoolId: 'north',
          reminderId,
          dueAt: new Date(Date.parse(dueAt) + 1000).toISOString(),
        }),
      ),
      { code: 'scheduled_job_conflict' },
    );
    const jobs = await q.boss.fetch(queueNames['activity-reminder'], { batchSize: 100 });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, saved);
    await q.boss.fail(queueNames['activity-reminder'], saved, { reason: 'simulated_lost_ack' });
  });
  await test('new queue instance recovers retry without duplicate effect', async () => {
    await q.close();
    q = null;
    let calls = 0;
    q2 = await createJobs(config, {
      schema,
      handlers: {
        'activity-reminder': async (d) => {
          calls++;
          await db.pool.query(
            `INSERT INTO hd_notifications(school_id,user_id,event_id,payload)
      SELECT $1,user_id,$2,$3 FROM hd_memberships WHERE school_id=$1 AND active LIMIT 1 ON CONFLICT DO NOTHING`,
            [d.schoolId, 'job-proof:' + d.reminderId, { kind: 'queue-test' }],
          );
          if (calls === 1) throw Error('effect committed but response lost');
        },
      },
    });
    await until(
      async () =>
        (await q2.boss.getJobById(queueNames['activity-reminder'], saved))?.state === 'completed',
    );
    assert.equal(calls, 2);
    assert.equal(
      (
        await db.pool.query('SELECT count(*)::int AS n FROM hd_notifications WHERE event_id=$1', [
          'job-proof:' + reminderId,
        ])
      ).rows[0].n,
      1,
    );
  });
  await test('future job remains scheduled and payload is minimal', async () => {
    const id = (
      await db.tx((c) =>
        q2.scheduleReminder(c, {
          schoolId: 'south',
          reminderId: randomUUID(),
          dueAt: new Date(Date.now() + 3600000).toISOString(),
        }),
      )
    ).jobId;
    const j = await q2.boss.getJobById(queueNames['activity-reminder'], id);
    assert.equal(j.state, 'created');
    assert.deepEqual(Object.keys(j.data).sort(), ['kind', 'reminderId', 'schoolId']);
    await assert.rejects(
      db.tx((c) => q2.scheduleReminder(c, { schoolId: 'unknown', reminderId: 'x', dueAt })),
      { code: 'reminder_invalid' },
    );
  });
  await mkdir('qa/campus', { recursive: true });
  await writeFile(
    'qa/campus/jobs-live.json',
    JSON.stringify(
      {
        status: 'PASS',
        engine: 'pg-boss 12.38.0',
        schema,
        checks,
        scope: 'actual PostgreSQL isolated fixture; no real reminders sent',
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await q?.close();
  await q2?.close();
  await db.close();
}
