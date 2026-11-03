import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, call } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createIdentity } from '../src/platform/identity.mjs';
import { createPartners } from '../src/platform/partners.mjs';
import { authorizeOwnedBusinessNotification as allowed } from '../src/platform/business-notifications.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.partnersEnabled)
  throw Error('Isolated campus fixture required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  school = 'business-notices-' + randomUUID().slice(0, 8),
  checks = [],
  start = Date.now();
const [partner, owner, other] = await Promise.all(['alice', 'moda', 'shared'].map(login));
const identity = createIdentity(db, config),
  services = {
    school(id) {
      if (id !== school) throw Object.assign(Error('school_missing'), { status: 404 });
      return { schoolId: school, spaceId: 'space-' + school };
    },
  };
const module = createPartners(db, identity, services, {
  ...config,
  partnersAdapter: { type: 'unavailable' },
});
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};
const app = http.createServer(async (req, res) => {
  try {
    const body = async () => {
      let raw = '';
      for await (const x of req) raw += x;
      return JSON.parse(raw);
    };
    if (!(await module.handle(req, res, { url: new URL(req.url, 'http://local'), json, body })))
      json(res, 404, {});
  } catch (e) {
    json(res, e.status || 500, { error: e.code || e.message });
  }
});
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + app.address().port + '/m5/schools/' + school;
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const api = (u, path, input) => call(base + path, { token: u.token, body: input });
const post = (u, path, input) => api(u, path, { requestId: randomUUID(), ...input });
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const notifications = (u) =>
  db.pool
    .query('SELECT * FROM hd_notifications WHERE school_id=$1 AND user_id=$2 ORDER BY id', [
      school,
      u.userId,
    ])
    .then((r) => r.rows);
const future = new Date(Date.now() + 86400000).toISOString();
let p, s, t, e;
try {
  await db.pool.query('INSERT INTO hd_schools VALUES($1,$2)', [school, 'space-' + school]);
  for (const [u, role] of [
    [partner, 'partner'],
    [owner, 'owner'],
    [other, 'affiliate'],
  ])
    await db.pool.query('INSERT INTO hd_memberships(school_id,user_id,role) VALUES($1,$2,$3)', [
      school,
      u.userId,
      role,
    ]);
  await test('restricted partner sees only its own actual application receipt', async () => {
    p = ok(
      await post(partner, '/partners', {
        name: '业务通知虚构合作方',
        category: '虚构测试',
        description: '验证校外人员仅能看自己的业务回执。',
        validUntil: future,
      }),
    );
    let n = (await notifications(partner))[0];
    assert.equal(await allowed(db, school, partner.userId, n), true);
    assert.equal(await allowed(db, school, other.userId, { ...n, user_id: other.userId }), false);
    assert.equal(await allowed(db, 'north', partner.userId, { ...n, school_id: 'north' }), false);
    assert.equal(
      await allowed(db, school, partner.userId, {
        ...n,
        payload: { ...n.payload, contactHandle: 'forged' },
      }),
      false,
    );
    assert.equal(
      await allowed(db, school, partner.userId, { ...n, information_event: 'forged-public-feed' }),
      false,
    );
    p = ok(
      await post(owner, `/partners/${p.partnerId}/review`, {
        expectedRevision: 1,
        decision: 'approve',
        reason: '核实业务通知测试权限',
      }),
    );
    for (const row of await notifications(partner))
      assert.equal(await allowed(db, school, partner.userId, row), true);
    ok(
      await post(owner, `/partners/${p.partnerId}/staff`, {
        expectedRevision: 0,
        userId: other.userId,
        role: 'maintainer',
        active: true,
        reason: '其他维护者不拥有申请人的私人通知',
      }),
    );
    const real = (await notifications(partner)).at(-1);
    const forged = (
      await db.pool.query(
        'INSERT INTO hd_notifications(school_id,user_id,event_id,payload) VALUES($1,$2,$3,$4) RETURNING *',
        [school, other.userId, real.event_id, real.payload],
      )
    ).rows[0];
    assert.equal(await allowed(db, school, other.userId, forged), false);
  });
  await test('task ownership and current membership gate the exception without disclosing contact fields', async () => {
    s = ok(
      await post(partner, '/services', {
        partnerId: p.partnerId,
        title: '私密业务通知测试',
        description: '展示公开资料，私人联系方式只进入获准工单。',
        conditions: '显式同意',
        hours: '虚构时段',
        validUntil: future,
      }),
    );
    s = ok(
      await post(owner, `/services/${s.serviceId}/review`, {
        expectedRevision: 1,
        decision: 'publish',
        reason: '公开服务审核',
      }),
    );
    t = ok(
      await post(owner, '/tasks', {
        serviceId: s.serviceId,
        kind: 'consultation',
        request: { question: '仅本人收到工单回执', contactHandle: 'do-not-leak-contact' },
      }),
    );
    let n = (await notifications(owner)).find((n) => n.payload.objectId === t.taskId);
    assert.equal(await allowed(db, school, owner.userId, n), true);
    assert.ok(!JSON.stringify(n.payload).includes('do-not-leak-contact'));
    const forged = (
      await db.pool.query(
        'INSERT INTO hd_notifications(school_id,user_id,event_id,payload) VALUES($1,$2,$3,$4) RETURNING *',
        [school, partner.userId, n.event_id, n.payload],
      )
    ).rows[0];
    assert.equal(await allowed(db, school, partner.userId, forged), false);
    await db.pool.query(
      'UPDATE hd_memberships SET active=false WHERE school_id=$1 AND user_id=$2',
      [school, owner.userId],
    );
    await assert.rejects(
      () => allowed(db, school, owner.userId, n),
      (e) => e.status === 403,
    );
    await db.pool.query('UPDATE hd_memberships SET active=true WHERE school_id=$1 AND user_id=$2', [
      school,
      owner.userId,
    ]);
  });
  await test('honored withdrawal binds recipient, immutable voucher terms and the actual partner exit event', async () => {
    let offer = ok(
      await post(partner, '/offers', {
        partnerId: p.partnerId,
        title: '履约通知虚构权益',
        terms: '合作退出后继续履约至到期，仅用于自动化验收。',
        stock: 2,
        minContribution: 0,
        withdrawalPolicy: 'honor',
        validUntil: future,
      }),
    );
    offer = ok(
      await post(owner, `/offers/${offer.offerId}/review`, {
        expectedRevision: 1,
        decision: 'publish',
        reason: '核对退出处理条款',
      }),
    );
    e = ok(
      await post(owner, `/offers/${offer.offerId}/claim`, {
        expectedRevision: offer.revision,
        acceptedTerms: true,
      }),
    );
    p = ok(
      await post(partner, `/partners/${p.partnerId}/withdraw`, {
        expectedRevision: p.revision,
        reason: '合作退出后仍承诺既有权益',
      }),
    );
    const notices = await notifications(owner),
      withdrawal = notices.find((n) => n.payload.type === 'partner-withdrawal');
    assert.ok(withdrawal);
    await db.pool.query(
      `UPDATE hd_memberships SET role='partner' WHERE school_id=$1 AND user_id=$2`,
      [school, owner.userId],
    );
    for (const n of notices) assert.equal(await allowed(db, school, owner.userId, n), true);
    assert.equal(
      await allowed(db, school, owner.userId, {
        ...withdrawal,
        payload: { ...withdrawal.payload, policy: 'revoke' },
      }),
      false,
    );
    const forged = (
      await db.pool.query(
        'INSERT INTO hd_notifications(school_id,user_id,event_id,payload) VALUES($1,$2,$3,$4) RETURNING *',
        [school, other.userId, withdrawal.event_id, withdrawal.payload],
      )
    ).rows[0];
    assert.equal(await allowed(db, school, other.userId, forged), false);
    await db.pool.query(
      `UPDATE hd_memberships SET role='owner' WHERE school_id=$1 AND user_id=$2`,
      [school, owner.userId],
    );
    assert.equal(
      await allowed(db, school, partner.userId, {
        id: '1',
        school_id: school,
        user_id: partner.userId,
        event_id: 'fake',
        payload: {
          type: 'partner-business',
          objectId: p.partnerId,
          partnerId: p.partnerId,
          kind: 'partner_reviewed',
          status: 'approved',
        },
      }),
      false,
    );
  });
  await mkdir('qa/campus', { recursive: true });
  await writeFile(
    'qa/campus/business-notifications.json',
    JSON.stringify(
      {
        status: 'PASS',
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
        testSchool: school,
        checks,
        scope:
          'Real Keycloak, PostgreSQL, authenticated business operations and narrow notification authorization helper. No real user data; forged fixture rows only for negative checks.',
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise((r) => app.close(r));
  await db.close();
}
