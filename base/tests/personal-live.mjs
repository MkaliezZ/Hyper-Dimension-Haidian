import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, api, call } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.m2Enabled)
  throw Error('Isolated fictitious M2 fixture required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  checks = [],
  started = Date.now(),
  run = randomUUID().slice(0, 8);
const [alice, bob, shared, owner] = await Promise.all(
  ['alice', 'bob', 'shared', 'moda'].map(login),
);
const root = '/personal/schools/north',
  target = root + '/profiles/' + alice.userId,
  orgId = 'profile-' + run;
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const req = () => randomUUID();
let work, badge;
try {
  await test('profile route requires current school account and never returns contact or identity secrets', async () => {
    assert.equal((await call(config.origin + root + '/me')).status, 401);
    assert.equal((await api(bob, target)).status, 403);
    assert.equal((await api(alice, '/personal/schools/south/me')).status, 403);
    assert.equal((await api(shared, root + '/badges/manage')).status, 403);
    const mine = ok(await api(alice, root + '/me'));
    assert.equal(mine.userId, alice.userId);
    assert.equal(mine.email, undefined);
    assert.equal(mine.subject, undefined);
    assert.equal(mine.profile.fields.phone, undefined);
  });
  await test('single existing profile authority with field privacy and server-derived organization roles', async () => {
    const mine = ok(await api(alice, root + '/me'));
    ok(
      await api(alice, '/m2/schools/north/profile', {
        requestId: req(),
        expectedVersion: mine.profile.version,
        fields: {
          bio: 'PRIVATE-BIO-' + run,
          department: '艺术与创作学院',
          year: '2026',
          interests: ['校园模型', '摄影'],
        },
        visibility: { bio: 'private', department: 'school', year: 'private', interests: 'school' },
      }),
    );
    const other = ok(await api(shared, target));
    assert.equal(other.profile.fields.bio, undefined);
    assert.equal(other.profile.fields.year, undefined);
    assert.equal(other.profile.fields.department, '艺术与创作学院');
    assert.equal(other.profile.visibility, undefined);
    assert.equal(
      (
        await db.pool.query('SELECT fields FROM hd_m2_profiles WHERE school_id=$1 AND user_id=$2', [
          'north',
          alice.userId,
        ])
      ).rows[0].fields.bio,
      'PRIVATE-BIO-' + run,
    );
    ok(
      await api(owner, '/m1/schools/north/organizations', {
        requestId: req(),
        orgId,
        name: '虚构校园创作组 ' + run,
        kind: 'student',
      }),
    );
    const invitation = ok(
      await api(owner, '/m1/schools/north/organizations/' + orgId + '/invitations', {
        requestId: req(),
        email: 'alice@m0.invalid',
        role: 'moderator',
      }),
    );
    ok(await api(alice, '/m1/invitations/accept', { token: invitation.token }));
    let own = ok(await api(alice, root + '/me'));
    assert.equal(own.organizations.find((o) => o.org_id === orgId).role, 'moderator');
    assert.equal(
      ok(await api(shared, target)).organizations.some((o) => o.org_id === orgId),
      false,
    );
    const b = {
      requestId: req(),
      expectedVersion: own.preferences.version,
      organizationVisibility: { [orgId]: 'school' },
    };
    const results = await Promise.all([
      api(alice, root + '/preferences', b),
      api(alice, root + '/preferences', b),
    ]);
    assert.deepEqual(ok(results[0]), ok(results[1]));
    assert.equal(
      ok(await api(shared, target)).organizations.find((o) => o.org_id === orgId).role,
      'moderator',
    );
    own = ok(await api(alice, root + '/me'));
    assert.equal(
      (
        await api(alice, root + '/preferences', {
          requestId: req(),
          expectedVersion: own.preferences.version,
          organizationVisibility: { 'made-up-org': 'school' },
        })
      ).status,
      403,
    );
  });
  await test('work lifecycle, exact retry, CAS races and owner-only mutation preserve history', async () => {
    const b = {
      requestId: req(),
      expectedVersion: 0,
      title: '校园创作 ' + run,
      description: '我的课程项目与建模记录',
      link: 'https://example.com/campus',
      status: 'draft',
      visibility: 'school',
    };
    const results = await Promise.all([
      api(alice, root + '/works', b),
      api(alice, root + '/works', b),
    ]);
    work = ok(results[0]);
    assert.deepEqual(work, ok(results[1]));
    assert.equal(
      ok(await api(shared, target)).works.some((w) => w.work_id === work.workId),
      false,
    );
    assert.equal((await api(alice, root + '/works', { ...b, title: 'changed' })).status, 409);
    assert.equal(
      (
        await api(shared, root + '/works', {
          ...b,
          requestId: req(),
          workId: work.workId,
          expectedVersion: work.version,
        })
      ).status,
      404,
    );
    const publish = {
      ...b,
      workId: work.workId,
      expectedVersion: work.version,
      status: 'published',
    };
    const race = await Promise.all([
      api(alice, root + '/works', { ...publish, requestId: req() }),
      api(alice, root + '/works', { ...publish, requestId: req(), title: '并发修订' }),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    work = ok(race.find((r) => r.status === 200));
    assert.equal(
      ok(await api(shared, target)).works.find((w) => w.work_id === work.workId).version,
      work.version,
    );
    const privacy = {
      ...publish,
      requestId: req(),
      title: work.title,
      expectedVersion: work.version,
      visibility: 'private',
    };
    work = ok(await api(alice, root + '/works', privacy));
    assert.equal(
      ok(await api(shared, target)).works.some((w) => w.work_id === work.workId),
      false,
    );
    work = ok(
      await api(alice, root + '/works', {
        ...privacy,
        requestId: req(),
        expectedVersion: work.version,
        status: 'withdrawn',
        visibility: 'school',
      }),
    );
    assert.equal(
      ok(await api(shared, target)).works.some((w) => w.work_id === work.workId),
      false,
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT count(*)::int n FROM hd_personal_work_history WHERE work_id=$1',
          [work.workId],
        )
      ).rows[0].n,
      work.version,
    );
    for (const link of [
      'javascript:alert(1)',
      'https://127.0.0.1/a',
      'https://example.com:443@127.0.0.1',
      'data:text/html,x',
    ])
      assert.equal(
        (await api(alice, root + '/works', { ...b, requestId: req(), link })).status,
        400,
      );
    assert.equal(
      (await api(alice, root + '/works', { ...b, requestId: req(), userId: shared.userId })).status,
      400,
    );
  });
  await test('community badge issuance is school-owner only, one effect per retry, recipient controls visibility, revocation persists', async () => {
    const b = {
      requestId: req(),
      userId: alice.userId,
      label: '校园共创者 ' + run,
      reason: '参与虚构校园建模验证',
    };
    assert.equal((await api(alice, root + '/badges/issue', b)).status, 403);
    assert.equal(
      (await api(owner, root + '/badges/issue', { ...b, requestId: req(), userId: bob.userId }))
        .status,
      403,
    );
    const results = await Promise.all([
      api(owner, root + '/badges/issue', b),
      api(owner, root + '/badges/issue', b),
    ]);
    badge = ok(results[0]);
    assert.deepEqual(badge, ok(results[1]));
    assert.equal(
      ok(await api(shared, target)).badges.some((v) => v.badge_id === badge.badgeId),
      false,
    );
    assert.equal(
      (
        await api(shared, root + '/badges/visibility', {
          requestId: req(),
          badgeId: badge.badgeId,
          expectedVersion: badge.version,
          visibility: 'school',
        })
      ).status,
      404,
    );
    badge = ok(
      await api(alice, root + '/badges/visibility', {
        requestId: req(),
        badgeId: badge.badgeId,
        expectedVersion: badge.version,
        visibility: 'school',
      }),
    );
    const shown = ok(await api(shared, target)).badges.find((v) => v.badge_id === badge.badgeId);
    assert.equal(shown.kind, 'community-recognition');
    assert.equal(shown.reason, undefined);
    assert.equal(shown.issuer_id, undefined);
    const revoke = {
      requestId: req(),
      badgeId: badge.badgeId,
      expectedVersion: badge.version,
      reason: '测试撤回与历史保留',
    };
    const revoked = await Promise.all([
      api(owner, root + '/badges/revoke', revoke),
      api(owner, root + '/badges/revoke', revoke),
    ]);
    assert.deepEqual(ok(revoked[0]), ok(revoked[1]));
    assert.equal(
      ok(await api(shared, target)).badges.some((v) => v.badge_id === badge.badgeId),
      false,
    );
    assert.equal(
      ok(await api(alice, root + '/me')).badges.find((v) => v.badge_id === badge.badgeId).status,
      'revoked',
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM hd_audit WHERE object_id=$1 AND action='personal.badge.issue'",
          [badge.badgeId],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM hd_audit WHERE object_id=$1 AND action='personal.badge.revoke'",
          [badge.badgeId],
        )
      ).rows[0].n,
      1,
    );
  });
  await test('organization removal immediately removes prior school-visible affiliation', async () => {
    const path = '/m1/schools/north/organizations/' + orgId + '/members';
    const m = ok(await api(owner, path)).members.find((m) => m.user_id === alice.userId);
    ok(
      await api(owner, path, {
        requestId: req(),
        userId: alice.userId,
        role: m.role,
        active: false,
        expectedRevision: m.revision,
      }),
    );
    assert.equal(
      ok(await api(shared, target)).organizations.some((o) => o.org_id === orgId),
      false,
    );
    assert.equal(
      ok(await api(alice, root + '/me')).organizations.some((o) => o.org_id === orgId),
      false,
    );
  });
  await test('private profile text is absent from school catalog and another member projection', async () => {
    assert.equal((await call(config.origin + '/api/catalog')).status, 401);
    const catalog = await api(shared, '/api/catalog');
    assert.equal(catalog.status, 200);
    assert.equal(JSON.stringify(catalog.data).includes('PRIVATE-BIO-' + run), false);
    const personal = ok(await api(shared, target));
    assert.equal(JSON.stringify(personal).includes('PRIVATE-BIO-' + run), false);
  });
  await mkdir('qa/personal', { recursive: true });
  await writeFile(
    'qa/personal/live.json',
    JSON.stringify(
      {
        status: 'PASS',
        checks,
        durationMs: Date.now() - started,
        school: 'north',
        workId: work.workId,
        badgeId: badge.badgeId,
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
