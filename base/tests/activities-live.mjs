import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, api, call } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createActivities } from '../src/platform/activities.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Dedicated fictitious fixture required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  run = randomUUID().slice(0, 8),
  checks = [],
  started = Date.now();
const [alice, bob, owner, shared] = await Promise.all(
  ['alice', 'bob', 'moda', 'shared'].map(login),
);
const base = '/activities/schools/north',
  ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
const post = (u, path, b) => api(u, base + path, { requestId: randomUUID(), ...b });
const get = (u, path) => api(u, base + path);
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
function input(kind = 'event', capacity = 1) {
  return {
    kind,
    title: '校园活动自动验证 ' + run + ' ' + kind,
    description: '只使用隔离的虚构活动及参与记录，不表示真实志愿服务或校园验收。',
    conditions: '自愿参加，由指定核验者检查证据后确认。',
    tasks:
      kind === 'volunteer'
        ? [
            {
              id: 'welcome',
              title: '迎新引导',
              description: '帮助新生了解校园设施，提交经过核对的服务说明。',
            },
          ]
        : [],
    startsAt: new Date(Date.now() - 120000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    registrationClosesAt: new Date(Date.now() + 1800000).toISOString(),
    capacity,
    remindBeforeMinutes: 0,
    verifierIds: [owner.userId, shared.userId],
  };
}
async function publish(a) {
  a = ok(await post(owner, `/items/${a.activityId}/submit`, { expectedRevision: a.revision }));
  return ok(
    await post(owner, `/items/${a.activityId}/review`, {
      expectedRevision: a.revision,
      decision: 'publish',
      reason: '检查虚构活动条件与指定核验者',
    }),
  );
}
async function own(u, id) {
  return ok(await get(u, `/items/${id}`)).registration;
}
let activity, registrations, participant, waiting, volunteer, volunteerRecord;
try {
  await test('school/account scope, managed draft-review-publication and unknown fields', async () => {
    assert.equal((await call(config.origin + base + '/items')).status, 401);
    assert.equal((await get(bob, '/items')).status, 403);
    assert.equal((await post(alice, '/items', input())).status, 403);
    assert.equal((await post(owner, '/items', { ...input(), contribution: 9999 })).status, 400);
    activity = ok(await post(owner, '/items', input()));
    assert.equal((await get(alice, `/items/${activity.activityId}`)).status, 403);
    activity = await publish(activity);
    assert.ok(
      ok(await get(alice, '/items')).items.some((a) => a.activityId === activity.activityId),
    );
  });
  await test('concurrent capacity and FIFO promotion, stable request replay, no double seating', async () => {
    const joinA = { requestId: randomUUID() },
      joinS = { requestId: randomUUID() };
    const results = await Promise.all([
      api(alice, base + `/items/${activity.activityId}/join`, joinA),
      api(shared, base + `/items/${activity.activityId}/join`, joinS),
    ]);
    registrations = results.map(ok);
    assert.equal(registrations.filter((r) => r.status === 'registered').length, 1);
    assert.equal(registrations.filter((r) => r.status === 'waitlisted').length, 1);
    participant = registrations[0].status === 'registered' ? alice : shared;
    waiting = participant === alice ? shared : alice;
    assert.deepEqual(
      ok(await api(alice, base + `/items/${activity.activityId}/join`, joinA)),
      registrations[0],
    );
    assert.equal(
      (
        await api(alice, base + `/items/${activity.activityId}/join`, {
          ...joinA,
          taskId: 'changed',
        })
      ).status,
      409,
    );
    const r = await own(participant, activity.activityId);
    ok(
      await post(participant, `/registrations/${r.registrationId}/withdraw`, {
        expectedRevision: r.revision,
        reason: '虚构排期冲突，退出并让出名额',
      }),
    );
    const next = await own(waiting, activity.activityId);
    assert.equal(next.status, 'registered');
    const sql = await db.pool.query(
      "SELECT count(*)::int n FROM hd_activity_registrations WHERE school_id='north' AND activity_id=$1 AND status IN ('registered','verified')",
      [activity.activityId],
    );
    assert.equal(sql.rows[0].n, 1);
  });
  await test('durable due reminder, deduplicated inbox and cancelled former seat reminder', async () => {
    ok(await api(owner, base + '/reconcile', {}));
    ok(await api(owner, base + '/reconcile', {}));
    const result = await db.pool.query(
      "SELECT r.status,r.user_id,r.event_id,n.id FROM hd_activity_reminders r LEFT JOIN hd_notifications n ON n.school_id=r.school_id AND n.event_id=r.event_id AND n.user_id=r.user_id WHERE r.school_id='north' AND r.activity_id=$1",
      [activity.activityId],
    );
    assert.equal(
      result.rows.filter((r) => r.user_id === waiting.userId && r.status === 'delivered' && r.id)
        .length,
      1,
    );
    assert.equal(new Set(result.rows.map((r) => r.event_id)).size, result.rows.length);
    // A due reminder may already be sent by the active queue before withdrawal.
    // Test cancellation of an explicitly future reminder separately.
    const future = await publish(
      ok(
        await post(owner, '/items', {
          ...input(),
          title: '待发送提醒取消 ' + run,
          startsAt: new Date(Date.now() + 3600000).toISOString(),
          endsAt: new Date(Date.now() + 7200000).toISOString(),
        }),
      ),
    );
    const joined = ok(await post(alice, `/items/${future.activityId}/join`, {}));
    ok(
      await post(alice, `/registrations/${joined.registrationId}/withdraw`, {
        expectedRevision: joined.revision,
        reason: '开始之前退出，取消未发送提醒',
      }),
    );
    const cancelled = (
      await db.pool.query(
        "SELECT r.status,n.id FROM hd_activity_reminders r LEFT JOIN hd_notifications n ON n.school_id=r.school_id AND n.event_id=r.event_id WHERE r.school_id='north' AND r.activity_id=$1",
        [future.activityId],
      )
    ).rows;
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].status, 'cancelled');
    assert.equal(cancelled[0].id, null);
  });
  await test('evidence needs designated non-self verifier and one acceptance event, revocation retains source', async () => {
    let r = await own(waiting, activity.activityId);
    assert.equal(
      (
        await post(owner, `/registrations/${r.registrationId}/verify`, {
          expectedRevision: r.revision,
          decision: 'approve',
          reason: '尚无证明不得通过',
          minutes: 0,
        })
      ).status,
      409,
    );
    r = ok(
      await post(waiting, `/registrations/${r.registrationId}/evidence`, {
        expectedRevision: r.revision,
        note: '虚构活动参与情况说明，等待负责人对照原始记录人工核验。',
        attachmentIds: [],
      }),
    );
    assert.equal(r.status, 'registered');
    assert.equal(
      (
        await post(waiting, `/registrations/${r.registrationId}/verify`, {
          expectedRevision: r.revision,
          decision: 'approve',
          reason: '本人不能核验自己',
          minutes: 0,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post(bob, `/registrations/${r.registrationId}/verify`, {
          expectedRevision: r.revision,
          decision: 'approve',
          reason: '他校不得核验',
          minutes: 0,
        })
      ).status,
      403,
    );
    const b = {
      requestId: randomUUID(),
      expectedRevision: r.revision,
      decision: 'approve',
      reason: '核对虚构签到与参与证明通过',
      minutes: 0,
    };
    const accepted = ok(await api(owner, base + `/registrations/${r.registrationId}/verify`, b));
    assert.equal(accepted.status, 'verified');
    assert.deepEqual(
      ok(await api(owner, base + `/registrations/${r.registrationId}/verify`, b)),
      accepted,
    );
    assert.equal(
      (
        await post(owner, `/registrations/${r.registrationId}/verify`, {
          ...b,
          requestId: randomUUID(),
          expectedRevision: accepted.revision,
        })
      ).status,
      409,
    );
    const revoked = ok(
      await post(owner, `/registrations/${r.registrationId}/revoke`, {
        expectedRevision: accepted.revision,
        reason: '发现核验依据有误，保留原记录并冲正',
      }),
    );
    assert.equal(revoked.status, 'revoked');
    assert.equal(revoked.verificationEventId, accepted.verificationEventId);
    const es = (
      await db.pool.query(
        "SELECT kind,envelope FROM hd_activity_events WHERE school_id='north' AND registration_id=$1 AND kind IN ('activity_verified','participation_revoked') ORDER BY source_revision",
        [r.registrationId],
      )
    ).rows;
    assert.equal(es.length, 2);
    assert.equal(es[1].envelope.reversesEventId, es[0].envelope.eventId);
    assert.equal(es[0].envelope.actorId, owner.userId);
  });
  await test('volunteer task choice, rejected evidence resubmission, immutable trace and cancellation reversal', async () => {
    assert.equal((await post(owner, '/items', { ...input('volunteer'), tasks: [] })).status, 400);
    volunteer = await publish(ok(await post(owner, '/items', input('volunteer', 3))));
    assert.equal((await post(alice, `/items/${volunteer.activityId}/join`, {})).status, 400);
    volunteerRecord = ok(
      await post(alice, `/items/${volunteer.activityId}/join`, { taskId: 'welcome' }),
    );
    volunteerRecord = ok(
      await post(alice, `/registrations/${volunteerRecord.registrationId}/evidence`, {
        expectedRevision: volunteerRecord.revision,
        note: '先提交待核对的虚构志愿服务说明',
        attachmentIds: [],
      }),
    );
    const before = (
      await db.pool.query(
        "SELECT count(*)::int n FROM hd_activity_events WHERE school_id='north' AND registration_id=$1 AND kind='volunteer_verified'",
        [volunteerRecord.registrationId],
      )
    ).rows[0].n;
    assert.equal(before, 0);
    volunteerRecord = ok(
      await post(owner, `/registrations/${volunteerRecord.registrationId}/verify`, {
        expectedRevision: volunteerRecord.revision,
        decision: 'reject',
        reason: '缺少可核验时间，请补充原始情况',
      }),
    );
    assert.equal(volunteerRecord.status, 'registered');
    volunteerRecord = ok(
      await post(alice, `/registrations/${volunteerRecord.registrationId}/evidence`, {
        expectedRevision: volunteerRecord.revision,
        note: '补充虚构分工与服务记录，核验人应与实际签到资料对照。',
        attachmentIds: [],
      }),
    );
    volunteerRecord = ok(
      await post(owner, `/registrations/${volunteerRecord.registrationId}/verify`, {
        expectedRevision: volunteerRecord.revision,
        decision: 'approve',
        reason: '已对照本次虚构服务凭据，确认记录',
        minutes: 1,
      }),
    );
    assert.equal(volunteerRecord.verifiedMinutes, 1);
    assert.equal(volunteerRecord.submissions.length, 2);
    volunteer = ok(
      await post(owner, `/items/${volunteer.activityId}/recap`, {
        expectedRevision: volunteer.revision,
        recap: '本次虚构活动用于检查通用流程；不代表真实学校服务小时或官方学分。',
      }),
    );
    volunteer = ok(
      await post(owner, `/items/${volunteer.activityId}/cancel`, {
        expectedRevision: volunteer.revision,
        reason: '虚构测试取消活动，同时撤销已核验记录',
      }),
    );
    assert.equal(volunteer.status, 'cancelled');
    assert.equal((await own(alice, volunteer.activityId)).status, 'revoked');
    assert.equal(
      (await post(alice, `/items/${volunteer.activityId}/join`, { taskId: 'welcome' })).status,
      409,
    );
  });
  await test('configured contribution failure rolls back verification, source event and receipt together', async () => {
    const a = await publish(ok(await post(owner, '/items', input())));
    let r = ok(await post(alice, `/items/${a.activityId}/join`, {}));
    r = ok(
      await post(alice, `/registrations/${r.registrationId}/evidence`, {
        expectedRevision: r.revision,
        note: '仅用于验证账本故障时事务回滚的虚构参与证明。',
        attachmentIds: [],
      }),
    );
    const request = {
      requestId: randomUUID(),
      expectedRevision: r.revision,
      decision: 'approve',
      reason: '虚构事务回滚验收',
      minutes: 0,
    };
    // Inject only the downstream failure; real PostgreSQL transaction, ACL,
    // source event, evidence and receipt code remain in use.
    const injectedFailure = new Error('fixture_contribution_failure');
    let attempted = 0;
    const isolated = createActivities(
      db,
      { user: async () => ({ user_id: owner.userId }) },
      {
        school: (schoolId) => {
          assert.equal(schoolId, 'north');
          return { schoolId };
        },
      },
      config,
      {
        recordContribution: async (_c, envelope) => {
          assert.equal(envelope.source.kind, 'base-activities');
          assert.equal(envelope.userId, alice.userId);
          attempted++;
          throw injectedFailure;
        },
      },
    );
    await assert.rejects(
      isolated.handle(
        { method: 'POST' },
        {},
        {
          url: new URL(base + `/registrations/${r.registrationId}/verify`, config.origin),
          body: async () => request,
          json: () => assert.fail('Failed transaction cannot return a success response'),
        },
      ),
      (e) => e === injectedFailure,
    );
    assert.equal(attempted, 1);
    const after = await own(alice, a.activityId);
    assert.equal(after.status, 'registered');
    assert.equal(after.revision, r.revision);
    assert.equal(after.submissions.at(-1).status, 'pending');
    const persisted = (
      await db.pool.query(
        "SELECT (SELECT count(*)::int FROM hd_activity_events WHERE school_id='north' AND registration_id=$1 AND kind='activity_verified') AS events,(SELECT count(*)::int FROM hd_receipts WHERE school_id='north' AND user_id=$2 AND request_id=$3) AS receipts",
        [r.registrationId, owner.userId, request.requestId],
      )
    ).rows[0];
    assert.deepEqual(persisted, { events: 0, receipts: 0 });
    const accepted = ok(
      await api(owner, base + `/registrations/${r.registrationId}/verify`, request),
    );
    assert.equal(accepted.status, 'verified');
  });
  await mkdir('qa/activities', { recursive: true });
  await writeFile(
    'qa/activities/live.json',
    JSON.stringify(
      {
        status: 'PASS',
        checks,
        durationMs: Date.now() - started,
        scope:
          'Isolated fictitious accounts/activities. Automated database and HTTP checks, not actual attendance, volunteer service, official credits or a target-server acceptance.',
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
