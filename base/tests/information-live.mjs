import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, api } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { publishInformation } from '../src/platform/information.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Isolated campus fixture required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  root = '/information/schools/north',
  checks = [];
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const [a, b, owner, shared] = await Promise.all(['alice', 'bob', 'moda', 'shared'].map(login));
const run = randomUUID().slice(0, 8),
  org = 'news-' + run;
async function subscribe(user, scopeId, active) {
  const list = ok(await api(user, root + '/subscriptions')).items;
  const old = list.find((s) => s.scope_id === scopeId && s.topic === 'announcements');
  return ok(
    await api(user, root + '/subscriptions', {
      requestId: randomUUID(),
      expectedRevision: old?.revision || 0,
      scopeId,
      topic: 'announcements',
      active,
    }),
  );
}
async function announce(scopeId, title = '校园公告 ' + run, extra = {}) {
  const input = {
    requestId: randomUUID(),
    sourceId: randomUUID(),
    expectedRevision: 0,
    scopeId,
    title,
    status: 'published',
    ...extra,
  };
  return { input, result: ok(await api(owner, root + '/announcements', input)) };
}
const notifications = async (user, sourceId) => {
  let after = '0',
    list = [];
  for (let i = 0; i < 30; i++) {
    const d = ok(await api(user, root + '/inbox?after=' + after));
    list.push(...d.items);
    if (after === d.cursor) break;
    after = d.cursor;
  }
  return list.filter((x) => x.payload.sourceId === sourceId);
};
try {
  await test('subscription preferences, scoped role validation and exact request retries', async () => {
    assert.equal((await api(b, root + '/inbox')).status, 403);
    assert.equal((await api(a, root + '/inbox?userId=' + shared.userId)).status, 403);
    assert.equal(
      (
        await api(a, root + '/announcements', {
          requestId: randomUUID(),
          sourceId: 'fake',
          expectedRevision: 0,
          title: '伪造发布',
          status: 'published',
        })
      ).status,
      403,
    );
    const pref = ok(await api(a, root + '/preferences'));
    ok(
      await api(a, root + '/preferences', {
        requestId: randomUUID(),
        expectedRevision: pref.revision,
        enabled: true,
      }),
    );
    const saved = await subscribe(a, '', true);
    const input = {
      requestId: randomUUID(),
      expectedRevision: saved.revision,
      scopeId: '',
      topic: 'announcements',
      active: true,
    };
    const result = ok(await api(a, root + '/subscriptions', input));
    assert.deepEqual(ok(await api(a, root + '/subscriptions', input)), result);
    assert.equal((await api(a, root + '/subscriptions', { ...input, active: false })).status, 409);
  });
  await test('ten duplicate source events yield one inbox notification, altered same event conflicts', async () => {
    const e = {
      schoolId: 'north',
      eventId: randomUUID(),
      scopeId: '',
      topic: 'announcements',
      sourceId: randomUUID(),
      sourceRevision: 1,
      status: 'published',
      title: '一次投递 ' + run,
      expiresAt: null,
      actorId: owner.userId,
    };
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => db.tx((c) => publishInformation(c, e))),
    );
    assert.equal(responses.filter((r) => !r.duplicate).length, 1);
    assert.equal((await notifications(a, e.sourceId)).length, 1);
    await assert.rejects(
      db.tx((c) => publishInformation(c, { ...e, title: '篡改' })),
      { code: 'event_conflict' },
    );
  });
  await test('offline unread retrieval, read isolation, unsubscribe and opt-out stop new deliveries', async () => {
    const n = await announce('');
    const [item] = await notifications(a, n.input.sourceId);
    assert.ok(item);
    assert.equal(item.read_at, null);
    assert.equal((await api(shared, root + '/read', { id: item.id })).status, 404);
    ok(await api(a, root + '/read', { id: item.id }));
    assert.ok((await notifications(await login('alice'), n.input.sourceId))[0].read_at);
    await subscribe(a, '', false);
    const n2 = await announce('');
    assert.equal((await notifications(a, n2.input.sourceId)).length, 0);
    await subscribe(a, '', true);
    const pref = ok(await api(a, root + '/preferences'));
    ok(
      await api(a, root + '/preferences', {
        requestId: randomUUID(),
        expectedRevision: pref.revision,
        enabled: false,
      }),
    );
    const n3 = await announce('');
    assert.equal((await notifications(a, n3.input.sourceId)).length, 0);
    const off = ok(await api(a, root + '/preferences'));
    ok(
      await api(a, root + '/preferences', {
        requestId: randomUUID(),
        expectedRevision: off.revision,
        enabled: true,
      }),
    );
  });
  await test('withdrawal and expiry stop current and legacy inbox reads; expiry removes title, retains audit', async () => {
    const n = await announce('');
    assert.equal((await notifications(a, n.input.sourceId)).length, 1);
    ok(
      await api(owner, root + '/announcements', {
        ...n.input,
        requestId: randomUUID(),
        expectedRevision: 1,
        status: 'withdrawn',
        title: '',
      }),
    );
    assert.equal((await notifications(a, n.input.sourceId)).length, 0);
    const old = ok(await api(a, '/m1/schools/north/notifications'));
    assert.ok(!old.items.some((x) => x.payload.sourceId === n.input.sourceId));
    const exp = await announce('', '到期内容 ' + run, {
      expiresAt: new Date(Date.now() + 200).toISOString(),
    });
    await new Promise((r) => setTimeout(r, 250));
    assert.equal((await notifications(a, exp.input.sourceId)).length, 0);
    const r = ok(await api(owner, root + '/expire', { requestId: randomUUID() }));
    assert.ok(r.expired >= 1);
    const e = (
      await db.pool.query(
        'SELECT envelope FROM hd_information_events WHERE school_id=$1 AND event_id=$2',
        ['north', exp.result.eventId],
      )
    ).rows[0];
    assert.equal(e.envelope.title, undefined);
  });
  await test('organization scope, existing-session revocation and prior receipt reuse denied', async () => {
    ok(
      await api(owner, '/m1/schools/north/organizations', {
        requestId: randomUUID(),
        orgId: org,
        name: '通知验证组织',
        kind: 'student',
      }),
    );
    const path = '/m1/schools/north/organizations/' + org + '/members';
    const email = (await db.pool.query('SELECT email FROM hd_users WHERE user_id=$1', [a.userId]))
      .rows[0].email;
    const invite = ok(
      await api(owner, '/m1/schools/north/organizations/' + org + '/invitations', {
        requestId: randomUUID(),
        email,
        role: 'member',
      }),
    );
    ok(await api(a, '/m1/invitations/accept', { token: invite.token }));
    const input = {
      requestId: randomUUID(),
      expectedRevision: 0,
      scopeId: org,
      topic: 'announcements',
      active: true,
    };
    ok(await api(a, root + '/subscriptions', input));
    const n = await announce(org);
    assert.equal((await notifications(a, n.input.sourceId)).length, 1);
    assert.equal((await notifications(shared, n.input.sourceId)).length, 0);
    assert.equal((await api(shared, root + '/announcements?org=' + org)).status, 403);
    const members = ok(await api(owner, path)).members,
      member = members.find((x) => x.user_id === a.userId);
    ok(
      await api(owner, path, {
        requestId: randomUUID(),
        userId: a.userId,
        expectedRevision: member.revision,
        role: 'member',
        active: false,
      }),
    );
    assert.equal((await notifications(a, n.input.sourceId)).length, 0);
    assert.equal((await api(a, root + '/subscriptions', input)).status, 403);
  });
  await mkdir('qa/campus', { recursive: true });
  await writeFile(
    'qa/campus/information-live.json',
    JSON.stringify(
      { status: 'PASS', checks, scope: 'isolated Ubuntu service fixture; no actual school users' },
      null,
      2,
    ) + '\n',
  );
} finally {
  await db.close();
}
