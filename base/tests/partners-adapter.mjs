import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, call, until } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createIdentity } from '../src/platform/identity.mjs';
import { createPartners } from '../src/platform/partners.mjs';
import { createInformation } from '../src/platform/information.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.partnersEnabled)
  throw Error('Isolated campus fixture required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  school = 'adapter-' + randomUUID().slice(0, 8),
  checks = [],
  run = randomUUID(),
  start = Date.now();
const [a, owner, other] = await Promise.all(['alice', 'moda', 'shared'].map(login));
const operations = new Map(),
  createCounts = new Map(),
  cancelCounts = new Map(),
  received = [],
  secret = randomBytes(24).toString('hex');
let poolStarted, poolRelease;
const read = async (req) => {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 65536) throw Error('body_limit');
  }
  return raw ? JSON.parse(raw) : {};
};
const respond = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const fixture = http.createServer(async (req, res) => {
  if (req.headers.authorization !== 'Bearer ' + secret) return respond(res, 401, { error: 'auth' });
  const url = new URL(req.url, 'http://fixture');
  if (req.method === 'GET') {
    const id = decodeURIComponent(url.pathname.split('/').pop()),
      op = operations.get(id);
    if (url.searchParams.get('schoolId') !== school) return respond(res, 403, { error: 'scope' });
    return respond(res, op ? 200 : 404, op || { status: 'unknown' });
  }
  try {
    const input = await read(req);
    received.push(input);
    assert.equal(input.schoolId, school);
    assert.equal(req.headers['idempotency-key'], input.operationId);
    const counter = input.action === 'create' ? createCounts : cancelCounts;
    counter.set(input.taskId, (counter.get(input.taskId) || 0) + 1);
    if (input.request.question === 'unknown-before-commit') {
      res.destroy();
      return;
    }
    const old = operations.get(input.operationId);
    if (old) return respond(res, 200, old);
    const receipt = {
      operationId: input.operationId,
      status: input.action === 'create' ? 'confirmed' : 'cancelled',
      receiptId: 'fixture-http-' + randomUUID(),
    };
    operations.set(input.operationId, receipt);
    if (input.request.question === 'pool-pressure') {
      poolStarted();
      await new Promise((resolve) => {
        poolRelease = resolve;
      });
      return respond(res, 200, receipt);
    }
    // Actual remote commit precedes transport failure. Never retry with a new operation identity.
    res.destroy();
  } catch {
    respond(res, 500, { error: 'fixture_assertion' });
  }
});
await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
const adapterUrl = 'http://127.0.0.1:' + fixture.address().port;
const services = {
  school(id) {
    if (id !== school) throw Object.assign(Error('school_missing'), { status: 404 });
    return { schoolId: school, spaceId: 'adapter-space-' + school };
  },
};
const runtimeConfig = {
  ...config,
  partnersAdapter: { type: 'http', url: adapterUrl, token: secret },
};
const identity = createIdentity(db, runtimeConfig),
  module = createPartners(db, identity, services, runtimeConfig);
const information = createInformation(db, identity, services);
let active = module;
const app = http.createServer(async (req, res) => {
  try {
    const handled = await active.handle(req, res, {
      url: new URL(req.url, 'http://base'),
      json: respond,
      body: read,
    });
    if (
      !handled &&
      !(await information(req, res, {
        url: new URL(req.url, 'http://base'),
        json: respond,
        body: read,
      }))
    )
      respond(res, 404, { error: 'missing' });
  } catch (e) {
    respond(res, e.status || 500, { error: e.code || e.message });
  }
});
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + app.address().port,
  base = '/m5/schools/' + school;
const api = (u, path, input) => call(origin + base + path, { token: u.token, body: input });
const post = (u, path, input) => api(u, path, { requestId: randomUUID(), ...input });
const expiry = new Date(Date.now() + 86400000).toISOString();
let p, s, task, unknown;
try {
  await db.pool.query('INSERT INTO hd_schools(school_id,space_id) VALUES($1,$2)', [
    school,
    'adapter-space-' + school,
  ]);
  for (const [u, role] of [
    [a, 'student'],
    [owner, 'owner'],
    [other, 'student'],
  ])
    await db.pool.query('INSERT INTO hd_memberships(school_id,user_id,role) VALUES($1,$2,$3)', [
      school,
      u.userId,
      role,
    ]);
  p = ok(
    await post(a, '/partners', {
      name: '隔离HTTP回执合作方',
      category: '虚构验收',
      description: '真实本机HTTP通信加人工故障注入，非真实商户。',
      validUntil: expiry,
    }),
  );
  p = ok(
    await post(owner, `/partners/${p.partnerId}/review`, {
      expectedRevision: 1,
      decision: 'approve',
      reason: '批准虚构隔离HTTP测试',
    }),
  );
  s = ok(
    await post(a, '/services', {
      partnerId: p.partnerId,
      title: 'HTTP故障预约',
      description: '合作方模拟提交成功后丢失网络应答。',
      conditions: '用户同意后仅转交明确字段',
      hours: '虚构测试窗口',
      validUntil: expiry,
    }),
  );
  s = ok(
    await post(owner, `/services/${s.serviceId}/review`, {
      expectedRevision: 1,
      decision: 'publish',
      reason: '发布HTTP测试用有效资料',
    }),
  );
  await test('lost create acknowledgement stays uncertain; lookup recovers one actual external booking', async () => {
    const request = { question: 'ack-lost-after-commit', contactHandle: 'fixture-private-contact' };
    task = ok(
      await post(other, '/tasks', { serviceId: s.serviceId, kind: 'consultation', request }),
    );
    assert.equal((await api(a, '/tasks/' + task.taskId)).status, 403);
    task = ok(
      await post(other, `/tasks/${task.taskId}/confirm`, {
        expectedRevision: 1,
        confirmed: true,
        consentFields: Object.keys(request),
      }),
    );
    await module.reconcile(school);
    task = ok(await api(other, '/tasks/' + task.taskId));
    assert.equal(task.status, 'pending_confirmation');
    assert.equal(task.externalReceipt, null);
    assert.equal(createCounts.get(task.taskId), 1);
    assert.equal(
      (
        await db.pool.query(
          'SELECT state FROM hd_m5_adapter_operations WHERE school_id=$1 AND task_id=$2',
          [school, task.taskId],
        )
      ).rows[0].state,
      'uncertain',
    );
    // Fresh module instance models application reload: authority is in PG, never its process memory.
    active = createPartners(db, identity, services, runtimeConfig);
    await active.reconcile(school);
    task = ok(await api(other, '/tasks/' + task.taskId));
    assert.equal(task.status, 'confirmed');
    assert.equal(task.externalReceipt.provider, 'configured-http');
    assert.equal(
      task.externalReceipt.receiptId,
      operations.get(`${school}:${task.taskId}:create`).receiptId,
    );
    for (let i = 0; i < 3; i++) await active.reconcile(school);
    assert.equal(createCounts.get(task.taskId), 1);
    assert.deepEqual(
      Object.keys(received.find((x) => x.taskId === task.taskId).request).sort(),
      Object.keys(request).sort(),
    );
    assert.ok(!JSON.stringify(received).includes('clientSecret'));
    assert.ok(!JSON.stringify(received).includes('access_token'));
  });
  await test('external cancellation lost acknowledgement is reconciled to its real cancel receipt exactly once', async () => {
    task = ok(
      await post(other, `/tasks/${task.taskId}/cancel`, {
        expectedRevision: task.revision,
        reason: '用户撤销已创建的测试预约',
      }),
    );
    assert.equal(task.status, 'cancel_requested');
    await active.reconcile(school);
    task = ok(await api(other, '/tasks/' + task.taskId));
    assert.equal(task.status, 'cancel_pending');
    assert.equal(task.cancelReceipt, null);
    assert.equal(cancelCounts.get(task.taskId), 1);
    await active.reconcile(school);
    task = ok(await api(other, '/tasks/' + task.taskId));
    assert.equal(task.status, 'cancelled');
    assert.equal(task.cancelReceipt.provider, 'configured-http');
    assert.equal(
      task.cancelReceipt.receiptId,
      operations.get(`${school}:${task.taskId}:cancel`).receiptId,
    );
    assert.equal(cancelCounts.get(task.taskId), 1);
  });
  await test('unknown remote outcome remains pending and never blindly resubmits or claims completion', async () => {
    unknown = ok(
      await post(other, '/tasks', {
        serviceId: s.serviceId,
        kind: 'consultation',
        request: { question: 'unknown-before-commit' },
      }),
    );
    unknown = ok(
      await post(other, `/tasks/${unknown.taskId}/confirm`, {
        expectedRevision: 1,
        confirmed: true,
        consentFields: ['question'],
      }),
    );
    for (let i = 0; i < 3; i++) await active.reconcile(school);
    unknown = ok(await api(other, '/tasks/' + unknown.taskId));
    assert.equal(unknown.status, 'pending_confirmation');
    assert.equal(unknown.externalReceipt, null);
    assert.equal(createCounts.get(unknown.taskId), 1);
    assert.ok(!operations.has(`${school}:${unknown.taskId}:create`));
  });
  await test('busy mutation pool cannot deadlock the adapter worker committing its receipt', async () => {
    const started = new Promise((resolve) => {
      poolStarted = resolve;
    });
    let t = ok(
      await post(other, '/tasks', {
        serviceId: s.serviceId,
        kind: 'consultation',
        request: { question: 'pool-pressure' },
      }),
    );
    t = ok(
      await post(other, `/tasks/${t.taskId}/confirm`, {
        expectedRevision: 1,
        confirmed: true,
        consentFields: ['question'],
      }),
    );
    const work = active.reconcile(school);
    await started;
    const blocked = Array.from({ length: 7 }, () =>
      db.tx((c) =>
        c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [school + ':permissions']),
      ),
    );
    await until(() => db.pool.totalCount === 8 && db.pool.idleCount === 0, 2000);
    poolRelease();
    await Promise.all([work, ...blocked]);
    t = ok(await api(other, '/tasks/' + t.taskId));
    assert.equal(t.status, 'confirmed');
    assert.equal(createCounts.get(t.taskId), 1);
  });
  await test('unconfigured adapter reports unavailable; local cancel has explicit before-dispatch receipt', async () => {
    active = createPartners(db, identity, services, {
      ...runtimeConfig,
      partnersAdapter: { type: 'unavailable' },
    });
    let t = ok(
      await post(other, '/tasks', {
        serviceId: s.serviceId,
        kind: 'consultation',
        request: { question: '未配置适配器时不能声称完成' },
      }),
    );
    t = ok(
      await post(other, `/tasks/${t.taskId}/confirm`, {
        expectedRevision: 1,
        confirmed: true,
        consentFields: ['question'],
      }),
    );
    assert.equal(t.status, 'adapter_unavailable');
    assert.equal(t.externalReceipt, null);
    assert.equal(createCounts.get(t.taskId), undefined);
    t = ok(
      await post(other, `/tasks/${t.taskId}/cancel`, {
        expectedRevision: t.revision,
        reason: '取消尚未提交的工单',
      }),
    );
    assert.equal(t.status, 'cancelled');
    assert.equal(t.cancelReceipt.status, 'cancelled_before_dispatch');
  });
  await test('published partner topic deduplicates, hides edited/withdrawn sources and respects unsubscribe', async () => {
    const info = (path, input) =>
      call(origin + '/information/schools/' + school + path, { token: other.token, body: input });
    ok(
      await info('/subscriptions', {
        requestId: randomUUID(),
        expectedRevision: 0,
        topic: 'partners',
        active: true,
      }),
    );
    let news = ok(
      await post(a, '/services', {
        partnerId: p.partnerId,
        title: '订阅合作服务',
        description: '只有审核来源可以触发订阅通知。',
        conditions: '公开资料条件',
        hours: '公开服务时间',
        validUntil: expiry,
      }),
    );
    const publish = {
      requestId: randomUUID(),
      expectedRevision: 1,
      decision: 'publish',
      reason: '审核来源用于订阅验收',
    };
    news = ok(await api(owner, `/services/${news.serviceId}/review`, publish));
    assert.deepEqual(ok(await api(owner, `/services/${news.serviceId}/review`, publish)), news);
    let inbox = ok(await info('/inbox')).items.filter(
      (n) => n.payload.sourceId === 'service:' + news.serviceId,
    );
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].payload.title, '订阅合作服务');
    assert.ok(!JSON.stringify(inbox).includes('fixture-private-contact'));
    news = ok(
      await post(a, `/services/${news.serviceId}/edit`, {
        expectedRevision: news.revision,
        partnerId: p.partnerId,
        title: '订阅合作服务修订',
        description: news.description,
        conditions: news.conditions,
        hours: news.hours,
        validUntil: expiry,
      }),
    );
    assert.equal(
      ok(await info('/inbox')).items.filter(
        (n) => n.payload.sourceId === 'service:' + news.serviceId,
      ).length,
      0,
    );
    news = ok(
      await post(owner, `/services/${news.serviceId}/review`, {
        expectedRevision: news.revision,
        decision: 'publish',
        reason: '审核新版订阅服务',
      }),
    );
    assert.ok(
      ok(await info('/inbox')).items.some(
        (n) =>
          n.payload.sourceId === 'service:' + news.serviceId &&
          n.payload.title === '订阅合作服务修订',
      ),
    );
    ok(
      await post(a, `/services/${news.serviceId}/withdraw`, {
        expectedRevision: news.revision,
        reason: '公开服务主动撤回验收',
      }),
    );
    assert.equal(
      ok(await info('/inbox')).items.filter(
        (n) => n.payload.sourceId === 'service:' + news.serviceId,
      ).length,
      0,
    );
    ok(
      await info('/subscriptions', {
        requestId: randomUUID(),
        expectedRevision: 1,
        topic: 'partners',
        active: false,
      }),
    );
    let after = ok(
      await post(a, '/services', {
        partnerId: p.partnerId,
        title: '退订后服务',
        description: '退订后应不再发送通知。',
        conditions: '公开资料条件',
        hours: '公开服务时间',
        validUntil: expiry,
      }),
    );
    after = ok(
      await post(owner, `/services/${after.serviceId}/review`, {
        expectedRevision: 1,
        decision: 'publish',
        reason: '验证退订后不发送',
      }),
    );
    assert.equal(
      ok(await info('/inbox')).items.filter(
        (n) => n.payload.sourceId === 'service:' + after.serviceId,
      ).length,
      0,
    );
    p = ok(
      await post(a, `/partners/${p.partnerId}/edit`, {
        expectedRevision: p.revision,
        name: p.name,
        category: p.category,
        description: '更新合作申请资料后重新审核发布。',
        validUntil: expiry,
      }),
    );
    assert.equal(ok(await api(other, '/directory')).sources.length, 0);
    p = ok(
      await post(owner, `/partners/${p.partnerId}/review`, {
        expectedRevision: p.revision,
        decision: 'approve',
        reason: '重新审核合作方公开范围',
      }),
    );
    assert.ok(ok(await api(other, '/directory')).sources.length > 0);
  });
  await test('changed reviewed source after consent blocks first adapter disclosure', async () => {
    active = createPartners(db, identity, services, runtimeConfig);
    let t = ok(
      await post(other, '/tasks', {
        serviceId: s.serviceId,
        kind: 'consultation',
        request: { question: 'old consent terms' },
      }),
    );
    t = ok(
      await post(other, `/tasks/${t.taskId}/confirm`, {
        expectedRevision: t.revision,
        confirmed: true,
        consentFields: ['question'],
      }),
    );
    s = ok(
      await post(a, `/services/${s.serviceId}/edit`, {
        expectedRevision: s.revision,
        partnerId: p.partnerId,
        title: s.title,
        description: '已确认后改变服务条款，需要重新发起确认。',
        conditions: '新的条件',
        hours: s.hours,
        validUntil: expiry,
      }),
    );
    s = ok(
      await post(owner, `/services/${s.serviceId}/review`, {
        expectedRevision: s.revision,
        decision: 'publish',
        reason: '审核新版本条件',
      }),
    );
    await active.reconcile(school);
    assert.equal(ok(await api(other, `/tasks/${t.taskId}`)).status, 'failed');
    assert.equal(createCounts.get(t.taskId), undefined);
    assert.equal(
      (
        await db.pool.query(
          'SELECT 1 FROM hd_m5_adapter_operations WHERE school_id=$1 AND task_id=$2',
          [school, t.taskId],
        )
      ).rowCount,
      0,
    );
  });
  await test('expired exact create/edit receipts replay after current ACL; new expired operations refuse', async () => {
    const soon = new Date(Date.now() + 2500).toISOString(),
      cases = [];
    const partnerInput = {
      requestId: randomUUID(),
      name: '短期申请测试',
      category: '虚构验收',
      description: '短期申请重放测试，原有过期回执保持可读。',
      validUntil: soon,
    };
    const pp = ok(await api(a, '/partners', partnerInput));
    cases.push(['/partners', partnerInput, pp]);
    const editPartner = { ...partnerInput, requestId: randomUUID(), expectedRevision: pp.revision };
    cases.push([
      `/partners/${pp.partnerId}/edit`,
      editPartner,
      ok(await api(a, `/partners/${pp.partnerId}/edit`, editPartner)),
    ]);
    const serviceInput = {
      requestId: randomUUID(),
      partnerId: p.partnerId,
      title: '短期服务测试',
      description: '短期服务重放测试，原有过期回执保持可读。',
      conditions: '公开条件',
      hours: '服务时间',
      validUntil: soon,
    };
    const ss = ok(await api(a, '/services', serviceInput));
    cases.push(['/services', serviceInput, ss]);
    const editService = { ...serviceInput, requestId: randomUUID(), expectedRevision: ss.revision };
    cases.push([
      `/services/${ss.serviceId}/edit`,
      editService,
      ok(await api(a, `/services/${ss.serviceId}/edit`, editService)),
    ]);
    const offerInput = {
      requestId: randomUUID(),
      partnerId: p.partnerId,
      title: '短期权益测试',
      terms: '仅用于过期回执测试，无真实金钱价值。',
      stock: 1,
      minContribution: 0,
      withdrawalPolicy: 'honor',
      validUntil: soon,
    };
    const oo = ok(await api(a, '/offers', offerInput));
    cases.push(['/offers', offerInput, oo]);
    const editOffer = { ...offerInput, requestId: randomUUID(), expectedRevision: oo.revision };
    cases.push([
      `/offers/${oo.offerId}/edit`,
      editOffer,
      ok(await api(a, `/offers/${oo.offerId}/edit`, editOffer)),
    ]);
    await new Promise((r) => setTimeout(r, Math.max(0, Date.parse(soon) - Date.now() + 20)));
    for (const [path, input, result] of cases) {
      assert.deepEqual(ok(await api(a, path, input)), result);
      assert.equal((await api(a, path, { ...input, requestId: randomUUID() })).status, 400);
    }
  });
  await test('organization revocation denies old receipt replay; revoked owner task never dispatches private fields', async () => {
    const org = 'partner-scope-' + randomUUID().slice(0, 8);
    await db.pool.query(
      `INSERT INTO hd_organizations(school_id,org_id,name,kind) VALUES($1,$2,'虚构合作组织','partner')`,
      [school, org],
    );
    for (const u of [owner, a])
      await db.pool.query(
        `INSERT INTO hd_org_members(school_id,org_id,user_id,role) VALUES($1,$2,$3,'member')`,
        [school, org, u.userId],
      );
    let scoped = ok(
      await post(owner, '/partners', {
        name: '组织限定合作方',
        category: '虚构验收',
        description: '仅组织成员维护自己的资料。',
        validUntil: expiry,
        orgId: org,
      }),
    );
    scoped = ok(
      await post(owner, `/partners/${scoped.partnerId}/review`, {
        expectedRevision: 1,
        decision: 'approve',
        reason: '审核组织限定合作方',
      }),
    );
    ok(
      await post(owner, `/partners/${scoped.partnerId}/staff`, {
        expectedRevision: 0,
        userId: a.userId,
        role: 'maintainer',
        active: true,
        reason: '授予本组织资料维护资格',
      }),
    );
    const input = {
      requestId: randomUUID(),
      partnerId: scoped.partnerId,
      title: '组织范围服务',
      description: '组织成员撤权后不得重放原回执。',
      conditions: '公开条件',
      hours: '服务时间',
      validUntil: expiry,
    };
    ok(await api(a, '/services', input));
    await db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        school + ':permissions',
      ]);
      await c.query(
        'UPDATE hd_org_members SET active=false,revision=revision+1 WHERE school_id=$1 AND org_id=$2 AND user_id=$3',
        [school, org, a.userId],
      );
    });
    assert.equal((await api(a, '/services', input)).status, 403);
    assert.equal((await api(a, '/services?partnerId=' + scoped.partnerId)).status, 403);
    active = createPartners(db, identity, services, runtimeConfig);
    let blocked = ok(
      await post(other, '/tasks', {
        serviceId: s.serviceId,
        kind: 'consultation',
        request: { question: '权限撤销后禁止首次转交' },
      }),
    );
    blocked = ok(
      await post(other, `/tasks/${blocked.taskId}/confirm`, {
        expectedRevision: 1,
        confirmed: true,
        consentFields: ['question'],
      }),
    );
    await db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        school + ':permissions',
      ]);
      await c.query(
        'UPDATE hd_memberships SET active=false,revision=revision+1 WHERE school_id=$1 AND user_id=$2',
        [school, other.userId],
      );
    });
    await active.reconcile(school);
    assert.equal(
      (
        await db.pool.query('SELECT status FROM hd_m5_tasks WHERE school_id=$1 AND task_id=$2', [
          school,
          blocked.taskId,
        ])
      ).rows[0].status,
      'failed',
    );
    assert.equal(createCounts.get(blocked.taskId), undefined);
    await db.pool.query(
      'UPDATE hd_memberships SET active=true,revision=revision+1 WHERE school_id=$1 AND user_id=$2',
      [school, other.userId],
    );
  });
  await mkdir('qa/campus', { recursive: true });
  await writeFile(
    'qa/campus/partners-adapter.json',
    JSON.stringify(
      {
        status: 'PASS',
        run,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
        checks,
        scope:
          'Real authenticated Base module + PostgreSQL + loopback HTTP adapter with deliberately lost acknowledgements. Adapter is fictitious, not a real merchant.',
        testSchool: school,
        counts: {
          createCalls: [...createCounts.values()].reduce((a, b) => a + b, 0),
          cancelCalls: [...cancelCounts.values()].reduce((a, b) => a + b, 0),
        },
        objects: { completedTask: task.taskId, pendingUnknownTask: unknown.taskId },
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise((r) => app.close(r));
  await new Promise((r) => fixture.close(r));
  await db.close();
}
