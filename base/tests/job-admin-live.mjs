import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, api, until } from './m1-helpers.mjs';
import { contactAccount } from './contacts-fixtures.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createJobs, queueNames } from '../src/platform/jobs.mjs';
import { createJobAdmin } from '../src/platform/job-admin.mjs';
import { createIdentity } from '../src/platform/identity.mjs';
import { createServices } from '../src/platform/services.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Isolated fixture only');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  q = await createJobs(config, { workers: false }),
  checks = [],
  run = randomUUID().slice(0, 8),
  root = '/jobs/schools/north/items',
  queue = queueNames['activity-reminder'];
const owner = await contactAccount(db, 'job-owner'),
  visitor = await contactAccount(db, 'job-visitor'),
  moderator = await contactAccount(db, 'job-moderator'),
  admin = await login('moda');
await db.pool.query(
  "UPDATE hd_memberships SET role='owner' WHERE school_id='north' AND user_id=$1",
  [owner.userId],
);
await db.pool.query(
  "UPDATE hd_memberships SET role='moderator' WHERE school_id='north' AND user_id=$1",
  [moderator.userId],
);
const ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  },
  get = (u, p) => api(u, p).then(ok),
  post = (u, p, b) => api(u, p, { requestId: randomUUID(), ...b }).then(ok);
const check = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
let activity, main, uiJob, retryInput;
async function makeFailed(u) {
  const reg = await post(u, '/activities/schools/north/items/' + activity.activityId + '/join', {});
  const reminder = (
    await db.pool.query(
      'SELECT * FROM hd_activity_reminders WHERE school_id=$1 AND registration_id=$2',
      ['north', reg.registrationId],
    )
  ).rows[0];
  const scheduled = (
    await db.pool.query('SELECT * FROM hd_scheduled_jobs WHERE school_id=$1 AND source_id=$2', [
      'north',
      reminder.reminder_id,
    ])
  ).rows[0];
  const original = await q.boss.getJobById(queue, scheduled.job_id);
  assert.equal(original.state, 'created');
  // Isolate failure injection to this newly-created future fixture job, using pg-boss APIs only.
  await q.boss.deleteJob(queue, scheduled.job_id);
  await q.boss.send(queue, original.data, {
    id: scheduled.job_id,
    startAfter: original.startAfter,
    retryLimit: 0,
    deleteAfterSeconds: 604800,
  });
  await q.boss.fail(queue, scheduled.job_id, {
    message: 'fixture-upstream-error-CONFIDENTIAL-' + run,
  });
  assert.equal((await q.boss.getJobById(queue, scheduled.job_id)).state, 'failed');
  return {
    jobId: scheduled.job_id,
    reminderId: reminder.reminder_id,
    eventId: reminder.event_id,
    userId: u.userId,
  };
}
try {
  activity = await post(owner, '/activities/schools/north/items', {
    orgId: null,
    kind: 'event',
    title: '虚构队列维护 ' + run,
    description: '本活动用于隔离队列故障恢复验收。',
    conditions: '仅虚构自动账号。',
    tasks: [],
    startsAt: new Date(Date.now() + 3600000).toISOString(),
    endsAt: new Date(Date.now() + 7200000).toISOString(),
    registrationClosesAt: new Date(Date.now() + 1800000).toISOString(),
    capacity: 5,
    remindBeforeMinutes: 0,
    verifierIds: [owner.userId],
  });
  activity = await post(
    owner,
    '/activities/schools/north/items/' + activity.activityId + '/submit',
    { expectedRevision: activity.revision },
  );
  activity = await post(
    owner,
    '/activities/schools/north/items/' + activity.activityId + '/review',
    { expectedRevision: activity.revision, decision: 'publish', reason: '允许隔离虚构队列验收' },
  );
  main = await makeFailed(visitor);
  uiJob = await makeFailed(moderator);
  await check('school-owner-only safe status list and school-bound identifiers', async () => {
    const r = await get(owner, root),
      item = r.items.find((x) => x.jobId === main.jobId);
    assert.ok(item);
    assert.equal(item.state, 'failed');
    assert.equal(item.canRetry, true);
    const safe = JSON.stringify(r);
    for (const secret of ['CONFIDENTIAL-' + run, main.userId, '"data":', '"output":', '"token":'])
      assert.equal(safe.includes(secret), false);
    assert.equal((await api(visitor, root)).status, 403);
    assert.equal((await api(moderator, root)).status, 403);
    assert.equal((await api(owner, '/jobs/schools/south/items')).status, 403);
    assert.equal(
      (
        await api(owner, root + '/' + randomUUID() + '/retry', {
          requestId: randomUUID(),
          expectedRetryCount: 0,
          reason: '不存在的作业不可重试',
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await api(owner, root + '/' + main.jobId + '/retry', {
          requestId: randomUUID(),
          expectedRetryCount: 0,
          reason: '不能替换原作业',
          payload: { kind: 'arbitrary' },
        })
      ).status,
      400,
    );
  });
  await check(
    'ten retries share one atomic receipt and one native retry transition, immutable inputs and current ACL',
    async () => {
      retryInput = {
        requestId: randomUUID(),
        expectedRetryCount: 0,
        reason: '虚构上游故障已修复，恢复原任务',
      };
      const r = await Promise.all(
        Array.from({ length: 10 }, () =>
          api(owner, root + '/' + main.jobId + '/retry', retryInput),
        ),
      );
      r.forEach((x) => assert.deepEqual(ok(x), ok(r[0])));
      const native = await q.boss.getJobById(queue, main.jobId);
      assert.equal(native.state, 'retry');
      assert.equal(native.retryLimit, 1);
      assert.equal(
        (
          await api(owner, root + '/' + main.jobId + '/retry', {
            ...retryInput,
            reason: '变更理由不得使用同一个回执',
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await api(owner, root + '/' + main.jobId + '/retry', {
            ...retryInput,
            requestId: randomUUID(),
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*)::int n FROM hd_audit WHERE school_id='north' AND object_id=$1 AND action='jobs.retry'",
            [main.jobId],
          )
        ).rows[0].n,
        1,
      );
      const m = (await get(admin, '/m1/schools/north/members')).members.find(
        (x) => x.user_id === owner.userId,
      );
      const changed = await post(admin, '/m1/schools/north/members', {
        userId: owner.userId,
        role: 'student',
        active: true,
        expectedRevision: m.revision,
      });
      assert.equal((await api(owner, root + '/' + main.jobId + '/retry', retryInput)).status, 403);
      await post(admin, '/m1/schools/north/members', {
        userId: owner.userId,
        role: 'owner',
        active: true,
        expectedRevision: changed.revision,
      });
    },
  );
  await check(
    'real reminder handler converges once and completed jobs cannot be manually replayed',
    async () => {
      await db.pool.query(
        "UPDATE hd_activity_reminders SET due_at=now()-interval '1 second' WHERE school_id=$1 AND reminder_id=$2",
        ['north', main.reminderId],
      );
      await q.boss.update(queue, undefined, {
        id: main.jobId,
        startAfter: new Date(Date.now() - 1000),
      });
      await until(async () => (await q.boss.getJobById(queue, main.jobId))?.state === 'completed');
      assert.equal(
        (
          await db.pool.query('SELECT count(*)::int n FROM hd_notifications WHERE event_id=$1', [
            main.eventId,
          ])
        ).rows[0].n,
        1,
      );
      for (let i = 0; i < 3; i++) ok(await api(owner, '/activities/schools/north/reconcile', {}));
      assert.equal(
        (
          await db.pool.query('SELECT count(*)::int n FROM hd_notifications WHERE event_id=$1', [
            main.eventId,
          ])
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await api(owner, root + '/' + main.jobId + '/retry', {
            requestId: randomUUID(),
            expectedRetryCount: 1,
            reason: '已成功任务不允许重放',
          })
        ).status,
        409,
      );
    },
  );
  await check(
    'Base-3 disabled rejects new manual retries and exact old receipts before touching native jobs',
    async () => {
      const disabled = {
        ...config,
        modules: { ...config.modules, base3: false },
        schools: config.schools.map((s) => ({ ...s, modules: { ...s.modules, base3: false } })),
      };
      const router = createJobAdmin(
        db,
        createIdentity(db, config),
        createServices(db, config),
        q,
        disabled,
      );
      for (const [id, b] of [
        [main.jobId, retryInput],
        [
          uiJob.jobId,
          { requestId: randomUUID(), expectedRetryCount: 0, reason: '关闭模块不能启动重试' },
        ],
      ])
        await assert.rejects(
          () =>
            router.handle(
              { method: 'POST', headers: { authorization: 'Bearer ' + owner.token } },
              null,
              {
                url: new URL(config.origin + root + '/' + id + '/retry'),
                body: async () => b,
                json: () => {
                  throw Error('Must reject');
                },
              },
            ),
          { code: 'module_disabled' },
        );
      assert.equal((await q.boss.getJobById(queue, uiJob.jobId)).state, 'failed');
    },
  );
  await mkdir('qa/campus', { recursive: true });
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/job-admin-browser-fixture.json',
    JSON.stringify({ run, owner, visitor, moderator, uiJob }),
    { mode: 0o600 },
  );
  await writeFile(
    '.local/job-admin-browser-config.json',
    JSON.stringify({ origin: config.origin }),
  );
  await writeFile('.local/job-admin-browser-users.json', '[]');
  await writeFile(
    'qa/campus/job-admin-live.json',
    JSON.stringify(
      {
        scope:
          'Actual isolated PostgreSQL/pg-boss/Keycloak and production HTTP; failure injected only via native API into newly-owned future fixture jobs; not real school delivery',
        run,
        checks,
      },
      null,
      2,
    ),
  );
} finally {
  await q.close();
  await db.close();
}
