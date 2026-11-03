import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { config, login, api, call } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Isolated restored fixture required');
const [owner, alice, bob] = await Promise.all(['moda', 'alice', 'bob'].map(login)),
  base = '/annual/schools/north',
  run = randomUUID().slice(0, 8),
  checks = [];
const db = new pg.Pool({ connectionString: config.databaseUrl });
const ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  },
  post = async (u, p, b) => ok(await api(u, p, { requestId: randomUUID(), ...b }));
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const output = process.env.HD_ANNUAL_EVIDENCE || '/runtime/evidence/annual';
let doc, head, taskRows, activityId, personal;
const count = async (table) =>
  Number((await db.query('SELECT count(*) AS n FROM ' + table)).rows[0].n);
const importAt = async (path, d) => {
  const p = ok(await api(owner, path + '/preview', { document: d }));
  return post(owner, path + '/import', {
    document: d,
    previewHash: p.documentHash,
    expectedLatestVersion: p.previousVersion,
    confirmed: true,
    reason: '隔离验证资料结构与版本，不是本校正式运营批准',
  });
};
try {
  await test('school authority, versioned review/import/activation and unchanged original source', async () => {
    assert.equal((await call(config.origin + base + '/packages')).status, 401);
    assert.equal((await api(bob, base + '/packages')).status, 403);
    doc = ok(await api(owner, base + '/example'));
    doc.packageId = 'annual-' + run;
    assert.equal((await api(alice, base + '/preview', { document: doc })).status, 403);
    const p = ok(await api(owner, base + '/preview', { document: doc }));
    assert.equal(p.effects.publishesContent, 0);
    assert.equal(p.effects.contactsFamilies, 0);
    const b = {
      requestId: randomUUID(),
      document: doc,
      previewHash: p.documentHash,
      expectedLatestVersion: 0,
      confirmed: true,
      reason: '隔离资料审核测试',
    };
    const [first, replay] = await Promise.all([
      api(owner, base + '/import', b),
      api(owner, base + '/import', b),
    ]);
    assert.deepEqual(ok(first), ok(replay));
    assert.equal((await api(owner, base + '/import', { ...b, reason: 'changed' })).status, 409);
    assert.equal((await api(alice, base + '/catalog?packageId=' + doc.packageId)).status, 409);
    head = await post(owner, base + '/activate', {
      packageId: doc.packageId,
      version: 1,
      expectedRevision: 0,
      confirmed: true,
      reason: '启用虚构测试版本',
    });
    const catalog = ok(
      await api(
        alice,
        base + '/catalog?packageId=' + doc.packageId + '&cohort=new-student&month=8',
      ),
    );
    assert(catalog.entries.every((e) => e.month === 8 && e.cohortIds.includes('new-student')));
    assert.equal(
      (await api(alice, base + '/versions/' + doc.packageId + '?version=1')).status,
      403,
    );
  });
  await test('annual plan creates only assigned work, not activities, publication or score', async () => {
    const before = {
      activities: await count('hd_activities'),
      scores: await count('hd_contributions'),
    };
    const plan = {
      packageId: doc.packageId,
      academicYear: 2026,
      entryIds: ['welcome-tour', 'study-august', 'guide-review'],
      ownerId: owner.userId,
    };
    const p = ok(await api(owner, base + '/tasks/preview', plan));
    assert.equal(p.effects.createsActivities, 0);
    const input = { requestId: randomUUID(), plan, previewHash: p.previewHash, confirmed: true };
    const result = ok(await api(owner, base + '/tasks', input));
    assert.deepEqual(result, ok(await api(owner, base + '/tasks', input)));
    assert.equal(result.tasks.length, 3);
    assert(result.tasks.every((t) => t.status === 'planned'));
    assert.equal(await count('hd_activities'), before.activities);
    assert.equal(await count('hd_contributions'), before.scores);
    assert.equal((await api(alice, base + '/tasks')).status, 403);
    assert.equal(
      (await api(owner, base + '/tasks', { ...input, requestId: randomUUID() })).status,
      409,
    );
    taskRows = ok(await api(owner, base + '/tasks')).tasks.filter(
      (t) => t.package_id === doc.packageId,
    );
    assert(taskRows.every((t) => t.date_verified === false && t.due_at === null));
  });
  await test('verified actual date and explicit confirmation create one native activity draft', async () => {
    const t = taskRows.find((t) => t.entry_id === 'welcome-tour'),
      startsAt = new Date(Date.now() + 8 * 86400000).toISOString();
    const input = {
      kind: 'event',
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
      registrationClosesAt: startsAt,
      capacity: 20,
      remindBeforeMinutes: 60,
      verifierIds: [owner.userId],
      sceneId: null,
      entityId: null,
      tasks: [],
    };
    assert.equal(
      (
        await api(owner, base + '/tasks/' + t.task_id + '/activity', {
          requestId: randomUUID(),
          expectedRevision: t.revision,
          confirmed: true,
          input,
        })
      ).status,
      409,
    );
    const saved = await post(owner, base + '/tasks/' + t.task_id, {
      expectedRevision: t.revision,
      ownerId: owner.userId,
      status: 'planned',
      dueAt: startsAt,
      dateVerified: true,
      officialUrl: null,
      reason: '核对虚构日期，不是实际学校日历',
    });
    const request = {
      requestId: randomUUID(),
      expectedRevision: saved.revision,
      confirmed: true,
      input,
    };
    const a = ok(await api(owner, base + '/tasks/' + t.task_id + '/activity', request));
    activityId = a.activityId;
    assert.equal(a.status, 'draft');
    assert.deepEqual(ok(await api(owner, base + '/tasks/' + t.task_id + '/activity', request)), a);
    assert.equal(
      (
        await api(owner, base + '/tasks/' + t.task_id + '/activity', {
          ...request,
          input: { ...input, capacity: 21 },
        })
      ).status,
      409,
    );
    const row = (
      await db.query('SELECT status FROM hd_activities WHERE school_id=$1 AND activity_id=$2', [
        'north',
        activityId,
      ])
    ).rows[0];
    assert.equal(row.status, 'draft');
  });
  await test('personal opt-in is private, chain-deduplicated, persistent and independent from ranking', async () => {
    const before = await count('hd_contributions');
    personal = await post(alice, base + '/mine', {
      packageId: doc.packageId,
      academicYear: 2026,
      entryId: 'study-august',
      expectedRevision: 0,
      confirmed: true,
      status: 'active',
      priority: 'B',
      dueAt: null,
    });
    personal = await post(alice, base + '/mine', {
      packageId: doc.packageId,
      academicYear: 2026,
      entryId: 'study-september',
      expectedRevision: personal.revision,
      confirmed: true,
      status: 'done',
      priority: 'A',
      dueAt: null,
    });
    await post(alice, base + '/mine', {
      packageId: doc.packageId,
      academicYear: 2026,
      entryId: 'calendar-review',
      expectedRevision: 0,
      confirmed: true,
      status: 'active',
      priority: 'A',
      dueAt: null,
    });
    const items = ok(await api(alice, base + '/mine')).items.filter(
      (x) => x.package_id === doc.packageId,
    );
    assert.equal(items.length, 2);
    assert(items.every((x) => x.priority === null));
    assert.equal(
      ok(await api(owner, base + '/mine')).items.filter((x) => x.package_id === doc.packageId)
        .length,
      0,
    );
    assert.equal((await api(owner, base + '/mine?userId=' + alice.userId)).status, 403);
    assert.equal(await count('hd_contributions'), before);
    const removed = items.find((x) => x.entry_id === 'calendar-review');
    await post(alice, base + '/mine/remove', {
      packageId: doc.packageId,
      academicYear: 2026,
      chainId: removed.chain_id,
      expectedRevision: removed.revision,
      confirmed: true,
    });
  });
  await test('new versions preserve original tasks and require explicit source review before new activity', async () => {
    const next = structuredClone(doc);
    next.version = 2;
    next.entries.find((x) => x.entryId === 'study-august').title = '修订后的学习支持安排';
    await importAt(base, next);
    assert.equal(ok(await api(alice, base + '/catalog?packageId=' + doc.packageId)).version, 1);
    head = await post(owner, base + '/activate', {
      packageId: doc.packageId,
      version: 2,
      expectedRevision: head.revision,
      confirmed: true,
      reason: '启用修订后示例版本',
    });
    const t = ok(await api(owner, base + '/tasks')).tasks.find(
      (t) => t.package_id === doc.packageId && t.entry_id === 'study-august',
    );
    assert.equal(t.package_version, 1);
    assert.notEqual(t.snapshot.title, next.entries.find((x) => x.entryId === t.entry_id).title);
    const refresh = await post(owner, base + '/tasks/' + t.task_id, {
      expectedRevision: t.revision,
      ownerId: owner.userId,
      status: 'planned',
      dueAt: null,
      dateVerified: false,
      officialUrl: null,
      refreshSource: true,
      reason: '明确采用新版本，保留原资料与分工记录',
    });
    const changed = ok(await api(owner, base + '/tasks')).tasks.find(
      (x) => x.task_id === t.task_id,
    );
    assert.equal(changed.package_version, 2);
    assert.equal(changed.history[0].packageVersion, 1);
    assert.equal(changed.revision, refresh.revision);
    assert.equal(
      ok(await api(owner, base + '/versions/' + doc.packageId + '?version=1')).document.version,
      1,
    );
  });
  await test('removed reference entries can be completed privately without reactivating obsolete advice', async () => {
    const next = ok(await api(owner, base + '/versions/' + doc.packageId + '?version=2')).document;
    next.version = 3;
    next.entries = next.entries.filter((e) => e.entryId !== 'study-september');
    await importAt(base, next);
    head = await post(owner, base + '/activate', {
      packageId: doc.packageId,
      version: 3,
      expectedRevision: head.revision,
      confirmed: true,
      reason: '撤下过时参考，保留本人行动处理权',
    });
    const b = {
      requestId: randomUUID(),
      packageId: doc.packageId,
      academicYear: 2026,
      entryId: 'study-september',
      expectedRevision: personal.revision,
      confirmed: true,
      status: 'not-applicable',
      priority: 'C',
      dueAt: null,
    };
    const saved = ok(await api(alice, base + '/mine', b));
    assert.equal(
      (
        await api(alice, base + '/mine', {
          ...b,
          requestId: randomUUID(),
          expectedRevision: saved.revision,
          status: 'active',
        })
      ).status,
      400,
    );
    const row = ok(await api(alice, base + '/mine')).items.find(
      (x) => x.package_id === doc.packageId && x.chain_id === personal.chainId,
    );
    assert.equal(row.status, 'not-applicable');
    assert.equal(row.priority, null);
  });
  await test('organization revocation blocks current reads and cached personal writes', async () => {
    const org = 'annual-' + run,
      orgroot = '/m1/schools/north/organizations/' + org,
      path = base + '/organizations/' + org;
    await post(owner, '/m1/schools/north/organizations', {
      orgId: org,
      name: '隔离年度组织 ' + run,
      kind: 'student',
    });
    const invite = await post(owner, orgroot + '/invitations', {
      email: 'alice@m0.invalid',
      role: 'member',
    });
    ok(await api(alice, '/m1/invitations/accept', { token: invite.token }));
    await importAt(path, doc);
    await post(owner, path + '/activate', {
      packageId: doc.packageId,
      version: 1,
      expectedRevision: 0,
      confirmed: true,
      reason: '组织隔离示例启用',
    });
    const input = {
      requestId: randomUUID(),
      packageId: doc.packageId,
      academicYear: 2026,
      entryId: 'study-august',
      expectedRevision: 0,
      confirmed: true,
      status: 'active',
      priority: 'B',
      dueAt: null,
    };
    ok(await api(alice, path + '/mine', input));
    const member = ok(await api(owner, orgroot + '/members')).members.find(
      (x) => x.user_id === alice.userId,
    );
    await post(owner, orgroot + '/members', {
      userId: alice.userId,
      role: member.role,
      active: false,
      expectedRevision: member.revision,
    });
    assert.equal((await api(alice, path + '/mine')).status, 403);
    assert.equal((await api(alice, path + '/mine', input)).status, 403);
  });
  await mkdir(output, { recursive: true });
  await writeFile(
    output + '/live.json',
    JSON.stringify(
      {
        status: 'PASS',
        fixtureOnly: true,
        checks,
        scope:
          'Real isolated PostgreSQL, OIDC, native activity authority. No school approval, family contact, financial transaction or actual-user acceptance.',
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    output + '/browser-fixture.json',
    JSON.stringify(
      { fixtureOnly: true, packageId: doc.packageId, activityId, personalChain: personal.chainId },
      null,
      2,
    ) + '\n',
  );
} finally {
  await db.end();
}
