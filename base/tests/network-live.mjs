import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { config, login, api } from './m1-helpers.mjs';
if (
  process.env.HD_M1_TEST_FIXTURE !== '1' ||
  !new URL(config.databaseUrl).pathname.includes('hdnetwork')
)
  throw Error('Dedicated fictitious network namespace required');
const [owner, alice, shared, bob] = await Promise.all(
  ['moda', 'alice', 'shared', 'bob'].map(login),
);
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const post = async (u, path, b) => ok(await api(u, path, { requestId: randomUUID(), ...b }));
const root = '/network/schools/north',
  records = [],
  run = randomUUID().slice(0, 8);
const resume = process.argv.includes('--from-opportunities');
let failed;
async function check(name, fn) {
  if (resume && !/Native NodeBB|Reception sessions/.test(name)) return;
  await fn();
  records.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
}
const doc = (name, mentor = false) => ({
  name,
  department: '测试学院',
  year: '2026',
  kind: 'alumni',
  bio: '这是明确自愿提供的测试名片和帮助说明，不是学校核验身份。',
  city: '测试城市',
  tags: ['迎新', '职业'],
  mentor,
});
let p, slot, booking, source, op, anchor;
if (resume) {
  const boot = ok(await api(alice, root + '/bootstrap'));
  const place = boot.places[0];
  anchor = { sceneId: place.sceneId, entityId: place.entityId };
}
try {
  await check(
    'Real Keycloak roles and school isolation; directory is opt-in and cannot be read cross-school',
    async () => {
      assert.equal(owner.schools.find((s) => s.school_id === 'north').role, 'owner');
      assert.equal((await api(bob, root + '/directory')).status, 403);
      const boot = ok(await api(alice, root + '/bootstrap'));
      anchor = boot.places[0];
      anchor = { sceneId: anchor.sceneId, entityId: anchor.entityId };
      assert.equal(ok(await api(alice, root + '/directory')).items.length, 0);
      assert.equal(
        (
          await api(alice, root + '/profile', {
            requestId: randomUUID(),
            expectedRevision: 0,
            consent: false,
            document: doc('不允许自动加入'),
          })
        ).status,
        400,
      );
      p = await post(alice, root + '/profile', {
        expectedRevision: 0,
        consent: true,
        document: doc('学长 ' + run, true),
        anchor,
      });
      assert.equal(p.status, 'pending');
      assert.equal(ok(await api(shared, root + '/directory')).items.length, 0);
      assert.equal(
        (
          await api(alice, root + '/profile-action', {
            requestId: randomUUID(),
            userId: alice.userId,
            expectedRevision: p.revision,
            action: 'approve',
            reason: '不能自己越权审核',
          })
        ).status,
        403,
      );
      p = await post(owner, root + '/profile-action', {
        userId: alice.userId,
        expectedRevision: p.revision,
        action: 'approve',
        reason: '核对名片同意及公开字段',
      });
      assert.equal(
        ok(
          await api(
            shared,
            root +
              '/directory?department=' +
              encodeURIComponent('测试学院') +
              '&tag=' +
              encodeURIComponent('迎新'),
          ),
        ).items[0].userId,
        alice.userId,
      );
      assert.equal(
        ok(await api(shared, root + '/directory?' + new URLSearchParams(anchor))).items.length,
        1,
      );
      assert.equal(
        (
          await api(alice, root + '/profile', {
            requestId: randomUUID(),
            expectedRevision: p.revision,
            consent: true,
            document: doc('非法地点'),
            anchor: { sceneId: 'foreign', entityId: 'foreign' },
          })
        ).status,
        403,
      );
    },
  );
  await check(
    'Mentor opt-in, scheduling overlap, self-booking, idempotency and concurrent capacity hold in PostgreSQL',
    async () => {
      const startsAt = new Date(Date.now() + 3600000).toISOString(),
        endsAt = new Date(Date.now() + 7200000).toISOString();
      slot = await post(alice, root + '/slot', {
        startsAt,
        endsAt,
        capacity: 1,
        topic: '迎新职业咨询 ' + run,
        anchor,
      });
      assert.equal(
        (
          await api(alice, root + '/slot', {
            requestId: randomUUID(),
            startsAt,
            endsAt,
            capacity: 2,
            topic: '重叠的场次',
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await api(alice, root + '/book', {
            requestId: randomUUID(),
            slotId: slot.slot_id,
            question: '这是自己的时段不允许自约',
          })
        ).status,
        409,
      );
      const attempts = [owner, shared].map((u) => ({
        u,
        b: {
          requestId: randomUUID(),
          slotId: slot.slot_id,
          question: 'PRIVATE_BOOKING_' + run + '，咨询开学与实习准备',
        },
      }));
      const outcomes = await Promise.all(attempts.map((a) => api(a.u, root + '/book', a.b)));
      assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
      const winner = outcomes.findIndex((r) => r.status === 200);
      booking = { ...ok(outcomes[winner]), actor: attempts[winner].u };
      assert.deepEqual(
        ok(await api(booking.actor, root + '/book', attempts[winner].b)),
        ok(outcomes[winner]),
      );
      assert.equal(
        ok(await api(alice, root + '/slots')).items.find((r) => r.slot_id === slot.slot_id)
          .reserved,
        1,
      );
      assert.equal(
        (
          await api(booking.actor, root + '/booking-action', {
            requestId: randomUUID(),
            bookingId: booking.bookingId,
            expectedRevision: booking.revision,
            action: 'confirm',
            reason: '只有支持人可以确认',
          })
        ).status,
        403,
      );
      booking = {
        ...(await post(alice, root + '/booking-action', {
          bookingId: booking.bookingId,
          expectedRevision: booking.revision,
          action: 'confirm',
          reason: '支持人确认场次',
        })),
        actor: booking.actor,
      };
      assert.equal(booking.status, 'confirmed');
      const outsider = booking.actor.userId === shared.userId ? owner : shared;
      assert(
        !JSON.stringify(ok(await api(outsider, root + '/bookings'))).includes('PRIVATE_BOOKING_'),
      );
      assert(
        !JSON.stringify(ok(await api(owner, root + '/booking-admin'))).includes(
          booking.actor.userId === owner.userId ? '__never__' : 'PRIVATE_BOOKING_',
        ),
      );
    },
  );
  await check(
    'Profile edit immediately withdraws discovery and cancels support, with private participant notifications',
    async () => {
      p = await post(alice, root + '/profile', {
        expectedRevision: p.revision,
        consent: true,
        document: doc('更新后的学长 ' + run, true),
        anchor,
      });
      assert.equal(ok(await api(shared, root + '/directory')).items.length, 0);
      assert(!ok(await api(shared, root + '/slots')).items.some((r) => r.slot_id === slot.slot_id));
      const b = ok(await api(booking.actor, root + '/bookings')).items.find(
        (r) => r.booking_id === booking.bookingId,
      );
      assert.equal(b.status, 'canceled');
      assert.equal(
        (
          await api(alice, root + '/booking-action', {
            requestId: randomUUID(),
            bookingId: booking.bookingId,
            expectedRevision: b.revision,
            action: 'confirm',
            reason: '关闭的场次不能恢复',
          })
        ).status,
        409,
      );
      p = await post(owner, root + '/profile-action', {
        userId: alice.userId,
        expectedRevision: p.revision,
        action: 'approve',
        reason: '重新核对更新名片',
      });
    },
  );
  await check(
    'Native NodeBB review plus metadata review gate the career board; edits, source withdrawal and links stay authoritative',
    async () => {
      const community = '/community/schools/north';
      const d = await post(alice, community + '/drafts', {
        expectedVersion: 0,
        title: '测试项目机会 ' + run,
        content: '这是隔离测试的原生论坛正文，面向测试学院的学生，不是真实招聘。',
        anchor,
      });
      const posting = ok(await api(alice, '/m0/schools/north/forum/posting-state'));
      if (posting.retryAfterMs) {
        assert(
          posting.retryAfterMs <= 60000,
          'Unexpected native cooldown; preserve fixture and inspect',
        );
        await new Promise((r) => setTimeout(r, posting.retryAfterMs + 25));
      }
      source = await post(alice, community + '/submit', {
        draftId: d.draftId,
        expectedVersion: d.version,
      });
      const metadata = {
        sourceId: source.id,
        expectedRevision: 0,
        kind: 'project',
        organization: '测试项目组',
        audience: '本校学生',
        deadline: new Date(Date.now() + 86400000).toISOString(),
        applicationUrl: 'https://example.com/apply',
        anchor,
      };
      op = await post(alice, root + '/opportunity', metadata);
      assert.equal(ok(await api(shared, root + '/opportunities')).items.length, 0);
      assert.equal(
        (
          await api(owner, root + '/opportunity-approve', {
            requestId: randomUUID(),
            opportunityId: op.opportunity_id,
            expectedRevision: op.revision,
            reason: '正文还没通过审核',
          })
        ).status,
        404,
      );
      source = await post(owner, community + '/action', {
        id: source.id,
        action: 'approve',
        expectedRevision: source.revision,
        expectedWorkflowVersion: source.workflowVersion,
        reason: '测试原生正文审核',
      });
      assert.equal(ok(await api(shared, root + '/opportunities')).items.length, 0);
      op = await post(owner, root + '/opportunity-approve', {
        opportunityId: op.opportunity_id,
        expectedRevision: op.revision,
        reason: '核对来源、截止日期和官方链接',
      });
      const visible = ok(await api(shared, root + '/opportunities')).items.find(
        (r) => r.opportunity_id === op.opportunity_id,
      );
      assert.equal(visible.source, 'nodebb');
      assert.equal(visible.approved_source_revision, source.revision);
      await post(shared, root + '/bookmark', { opportunityId: op.opportunity_id, active: true });
      op = await post(alice, root + '/opportunity', {
        ...metadata,
        expectedRevision: op.revision,
        applicationUrl: 'https://example.com/changed',
      });
      assert.equal(ok(await api(shared, root + '/opportunities')).items.length, 0);
      assert.equal(
        (
          await api(alice, root + '/opportunity', {
            requestId: randomUUID(),
            ...metadata,
            expectedRevision: op.revision,
            applicationUrl: 'http://127.0.0.1/private',
          })
        ).status,
        400,
      );
      op = await post(owner, root + '/opportunity-approve', {
        opportunityId: op.opportunity_id,
        expectedRevision: op.revision,
        reason: '重新核对更改的申请入口',
      });
      const detail = ok(await api(owner, community + '/post/' + source.id));
      await post(owner, community + '/action', {
        id: source.id,
        action: 'hide',
        expectedRevision: detail.revision,
        expectedWorkflowVersion: detail.workflowVersion,
        reason: '测试撤回使旧入口失效',
      });
      assert.equal(ok(await api(shared, root + '/opportunities')).items.length, 0);
      assert.equal(
        (
          await api(shared, root + '/bookmark', {
            requestId: randomUUID(),
            opportunityId: op.opportunity_id,
            active: true,
          })
        ).status,
        403,
      );
      await post(shared, root + '/bookmark', { opportunityId: op.opportunity_id, active: false });
    },
  );
  await check(
    'Reception sessions persist in the campus store, are exportable, owner bound and configurable by school owner only',
    async () => {
      const r = '/api/spaces/north/reception-sessions',
        s = await post(alice, r, {}),
        status = ok(await api(owner, '/reception-admin/schools/north/status'));
      assert.equal(s.retentionDays, 30);
      assert.equal(status.containsConversationBodies, false);
      assert.equal(
        (await api(shared, r + '/' + encodeURIComponent(s.contextId) + '/export')).status,
        404,
      );
      assert.equal(
        ok(await api(alice, r + '/' + encodeURIComponent(s.contextId) + '/export')).schema,
        'hyper-dimension.reception-export/v1',
      );
      assert.equal((await api(alice, '/reception-admin/schools/north/status')).status, 403);
      await post(owner, '/reception-admin/schools/north/policy', {
        expectedRevision: status.policy.revision,
        policy: { retentionDays: 7, maxSessions: 30, maxTurns: 200, contextTurns: 4 },
        reason: '隔离测试学校期限配置',
      });
      const next = await post(alice, r, {});
      assert.equal(next.retentionDays, 7);
      assert.equal(
        ok(await api(alice, r)).sessions.find((x) => x.contextId === s.contextId).retentionDays,
        30,
      );
      await post(alice, r + '/' + encodeURIComponent(s.contextId) + '/delete', {
        expectedRevision: s.revision,
      });
      assert.equal(
        (await api(alice, r + '/' + encodeURIComponent(s.contextId) + '/export')).status,
        410,
      );
      const current = ok(await api(owner, '/reception-admin/schools/north/status'));
      await post(owner, '/reception-admin/schools/north/policy', {
        expectedRevision: current.policy.revision,
        policy: { retentionDays: 30, maxSessions: 30, maxTurns: 200, contextTurns: 4 },
        reason: '恢复示例默认30天',
      });
    },
  );
} catch (e) {
  failed = { code: e.code || 'assertion_failed', message: e.message };
  throw e;
} finally {
  const dir = process.env.HD_NETWORK_EVIDENCE || '.local/network-check-20261024';
  await mkdir(dir, { recursive: true });
  const old = await readFile(dir + '/network-live.json', 'utf8')
    .then(JSON.parse)
    .catch(() => ({}));
  const checks = [
    ...new Map([...(resume ? old.checks || [] : []), ...records].map((r) => [r.name, r])).values(),
  ];
  const attempts = [
    ...(old.attempts || []),
    { at: new Date().toISOString(), resume, checks: records.map((r) => r.name), failed },
  ];
  await writeFile(
    dir + '/network-live.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope:
          'One-host Ubuntu Docker, real Keycloak/PostgreSQL/NodeBB; fictitious school data. Not actual school acceptance.',
        checks,
        attempts,
        complete: !failed && checks.length === 5,
        database: new URL(config.databaseUrl).pathname.slice(1),
        fixture: {
          profileUserId: alice.userId,
          sourceId: source?.id,
          opportunityId: op?.opportunity_id,
          anchor,
        },
      },
      null,
      2,
    ) + '\n',
  );
}
