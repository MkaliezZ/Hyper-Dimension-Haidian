import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, api, call, until } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.partnersEnabled)
  throw Error('Isolated campus partners fixture required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  run = randomUUID().slice(0, 8),
  checks = [],
  start = Date.now();
const [a, b, owner, shared] = await Promise.all(['alice', 'bob', 'moda', 'shared'].map(login)),
  base = '/m5/schools/north';
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const post = (u, path, input) => api(u, base + path, { requestId: randomUUID(), ...input });
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const expires = () => new Date(Date.now() + 86400000).toISOString();
async function partner(u, name) {
  let p = ok(
    await post(u, '/partners', {
      name: name + ' ' + run,
      category: '原创虚构校园合作',
      description: '仅用于自动化验收的虚构合作资料，不是真实商业服务。',
      validUntil: expires(),
    }),
  );
  return ok(
    await post(owner, `/partners/${p.partnerId}/review`, {
      expectedRevision: p.revision,
      decision: 'approve',
      reason: '核对虚构验收资料来源',
    }),
  );
}
async function service(p) {
  const s = ok(
    await post(a, '/services', {
      partnerId: p.partnerId,
      title: '测试预约 ' + run,
      description: '虚构预约和咨询业务的公开资料。',
      conditions: '在校成员自愿确认后可使用，未确认不转交。',
      hours: '周一至周五 09:00 至 17:00',
      officialUrl: 'https://example.org/campus',
      validUntil: expires(),
    }),
  );
  return ok(
    await post(owner, `/services/${s.serviceId}/review`, {
      expectedRevision: s.revision,
      decision: 'publish',
      reason: '核对公开资料与有效期',
    }),
  );
}
async function offer(p, extra = {}) {
  const o = ok(
    await post(a, '/offers', {
      partnerId: p.partnerId,
      title: '虚构权益 ' + run,
      terms: '仅用于本地核销测试，不含真实商品或金钱价值。',
      stock: 10,
      minContribution: 0,
      withdrawalPolicy: 'honor',
      validUntil: expires(),
      ...extra,
    }),
  );
  return ok(
    await post(owner, `/offers/${o.offerId}/review`, {
      expectedRevision: o.revision,
      decision: 'publish',
      reason: '已核对示例条款和库存',
    }),
  );
}
let p, p2, s, e, o, redeemInput, redeemResult, completedTask;
try {
  await test('current account/school boundaries and reviewed partner/service directory', async () => {
    assert.equal((await call(config.origin + base + '/directory')).status, 401);
    assert.equal((await api(b, base + '/directory')).status, 403);
    assert.equal((await api(a, '/m5/schools/south/directory')).status, 403);
    assert.equal((await api(a, base + '/directory?userId=' + b.userId)).status, 403);
    p = ok(
      await post(a, '/partners', {
        name: '虚构银行 ' + run,
        category: '校园服务',
        description: '虚构合作方，仅提供测试用公开服务资料。',
        validUntil: expires(),
      }),
    );
    assert.equal(
      (
        await post(a, `/partners/${p.partnerId}/review`, {
          expectedRevision: 1,
          decision: 'approve',
          reason: '申请人无权自审',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post(a, '/services', {
          partnerId: p.partnerId,
          title: '未审服务',
          description: '不应该公开的服务描述',
          conditions: '不可办理',
          hours: '尚未开放',
          validUntil: expires(),
        })
      ).status,
      403,
    );
    p = ok(
      await post(owner, `/partners/${p.partnerId}/review`, {
        expectedRevision: 1,
        decision: 'approve',
        reason: '验收虚构合作方资料',
      }),
    );
    p2 = await partner(shared, '第二虚构合作方');
    s = ok(
      await post(a, '/services', {
        partnerId: p.partnerId,
        title: '资料审核测试 ' + run,
        description: '只有审核发布后才可以进入目录与接待来源。',
        conditions: '自愿授权办理',
        hours: '09:00 至 17:00',
        validUntil: expires(),
      }),
    );
    assert.ok(
      !ok(await api(a, base + '/directory')).sources.some((x) => x.serviceId === s.serviceId),
    );
    assert.equal((await api(shared, base + '/services?partnerId=' + p.partnerId)).status, 403);
    s = ok(
      await post(owner, `/services/${s.serviceId}/review`, {
        expectedRevision: s.revision,
        decision: 'publish',
        reason: '允许公开虚构测试来源',
      }),
    );
    assert.ok(
      ok(await api(a, base + '/directory')).sources.some(
        (x) => x.serviceId === s.serviceId && x.revision === s.revision,
      ),
    );
  });
  await test('explicit task consent, private proposal, receipt-backed local fixture creation and cancellation', async () => {
    const request = {
      question: '请确认虚构服务可预约时间',
      requestedTime: new Date(Date.now() + 3600000).toISOString(),
      contactName: '虚构测试者',
      contactHandle: 'fixture-contact-only',
    };
    let t = ok(
      await post(shared, '/tasks', { serviceId: s.serviceId, kind: 'appointment', request }),
    );
    assert.equal(t.status, 'proposed');
    assert.equal((await api(a, base + '/tasks/' + t.taskId)).status, 403);
    assert.equal(
      (
        await post(shared, `/tasks/${t.taskId}/confirm`, {
          expectedRevision: 1,
          confirmed: false,
          consentFields: Object.keys(request),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(shared, `/tasks/${t.taskId}/confirm`, {
          expectedRevision: 1,
          confirmed: true,
          consentFields: ['question'],
        })
      ).status,
      400,
    );
    assert.equal(
      Number(
        (
          await db.pool.query('SELECT count(*) FROM hd_m5_fixture_bookings WHERE task_id=$1', [
            t.taskId,
          ])
        ).rows[0].count,
      ),
      0,
    );
    const input = {
      requestId: randomUUID(),
      expectedRevision: 1,
      confirmed: true,
      consentFields: Object.keys(request),
    };
    const confirmed = ok(await api(shared, base + `/tasks/${t.taskId}/confirm`, input));
    assert.equal(confirmed.status, 'queued');
    assert.deepEqual(ok(await api(shared, base + `/tasks/${t.taskId}/confirm`, input)), confirmed);
    assert.equal(
      (
        await api(shared, base + `/tasks/${t.taskId}/confirm`, {
          ...input,
          consentFields: ['question'],
        })
      ).status,
      409,
    );
    t = await until(async () => {
      await api(shared, base + `/tasks/${t.taskId}/reconcile`, {});
      const r = ok(await api(shared, base + '/tasks/' + t.taskId));
      return r.status === 'confirmed' ? r : false;
    });
    assert.equal(t.externalReceipt.provider, 'local-fixture');
    assert.ok(t.externalReceipt.receiptId);
    assert.equal(ok(await api(a, base + '/tasks/' + t.taskId)).consent.actorId, shared.userId);
    assert.equal(
      Number(
        (
          await db.pool.query('SELECT count(*) FROM hd_m5_fixture_bookings WHERE task_id=$1', [
            t.taskId,
          ])
        ).rows[0].count,
      ),
      1,
    );
    t = ok(
      await post(shared, `/tasks/${t.taskId}/cancel`, {
        expectedRevision: t.revision,
        reason: '虚构验收用户主动取消预约',
      }),
    );
    t = await until(async () => {
      await api(shared, base + `/tasks/${t.taskId}/reconcile`, {});
      const r = ok(await api(shared, base + '/tasks/' + t.taskId));
      return r.status === 'cancelled' ? r : false;
    });
    assert.equal(t.cancelReceipt.provider, 'local-fixture');
    assert.equal(
      (
        await db.pool.query('SELECT status FROM hd_m5_fixture_bookings WHERE task_id=$1', [
          t.taskId,
        ])
      ).rows[0].status,
      'cancelled',
    );
    completedTask = t;
  });
  await test('service change requires new reviewed consent; exposure de-duplicates and merchant metrics contain no private fields', async () => {
    let t = ok(
      await post(shared, '/tasks', {
        serviceId: s.serviceId,
        kind: 'consultation',
        request: { question: '正在查看旧版本办理条件' },
      }),
    );
    s = ok(
      await post(a, `/services/${s.serviceId}/edit`, {
        expectedRevision: s.revision,
        partnerId: p.partnerId,
        title: s.title,
        description: s.description,
        conditions: '更新后的办理条件须再次确认',
        hours: s.hours,
        validUntil: expires(),
      }),
    );
    assert.ok(
      !ok(await api(a, base + '/directory')).sources.some((x) => x.serviceId === s.serviceId),
    );
    s = ok(
      await post(owner, `/services/${s.serviceId}/review`, {
        expectedRevision: s.revision,
        decision: 'publish',
        reason: '核对新版本办理条件',
      }),
    );
    assert.equal(
      (
        await post(shared, `/tasks/${t.taskId}/confirm`, {
          expectedRevision: 1,
          confirmed: true,
          consentFields: ['question'],
        })
      ).status,
      409,
    );
    for (let i = 0; i < 3; i++) ok(await post(shared, `/services/${s.serviceId}/exposure`, {}));
    const m = ok(await api(a, base + `/partners/${p.partnerId}/metrics`));
    assert.equal(m.metrics.find((x) => x.kind === 'exposure').count, 1);
    assert.ok(!JSON.stringify(m).includes('fixture-contact-only'));
    assert.ok(!JSON.stringify(m).includes(shared.userId));
    assert.equal((await api(shared, base + `/partners/${p.partnerId}/metrics`)).status, 403);
  });
  await test('finite inventory, eligibility, terms, idempotent claims and contribution invariance', async () => {
    const score = () =>
        db.pool
          .query(
            'SELECT COALESCE(sum(delta),0)::int AS score FROM hd_contributions WHERE school_id=$1 AND user_id=$2',
            ['north', a.userId],
          )
          .then((r) => r.rows[0].score),
      before = await score();
    const denied = await offer(p, { minContribution: 1000000 });
    assert.equal(
      (
        await post(a, `/offers/${denied.offerId}/claim`, {
          expectedRevision: denied.revision,
          acceptedTerms: true,
        })
      ).status,
      403,
    );
    o = await offer(p, { stock: 1 });
    assert.equal(
      (
        await post(a, `/offers/${o.offerId}/claim`, {
          expectedRevision: o.revision,
          acceptedTerms: false,
        })
      ).status,
      400,
    );
    const claim = { requestId: randomUUID(), expectedRevision: o.revision, acceptedTerms: true };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => api(a, base + `/offers/${o.offerId}/claim`, claim)),
    );
    e = ok(results[0]);
    for (const r of results) assert.deepEqual(ok(r), e);
    assert.equal(
      (
        await post(shared, `/offers/${o.offerId}/claim`, {
          expectedRevision: o.revision,
          acceptedTerms: true,
        })
      ).status,
      409,
    );
    assert.equal(
      Number(
        (
          await db.pool.query('SELECT count(*) FROM hd_m5_entitlements WHERE offer_id=$1', [
            o.offerId,
          ])
        ).rows[0].count,
      ),
      1,
    );
    assert.equal(
      (await db.pool.query('SELECT issued FROM hd_m5_offers WHERE offer_id=$1', [o.offerId]))
        .rows[0].issued,
      1,
    );
    assert.equal(await score(), before);
    assert.equal(
      (await api(shared, base + '/entitlements')).data.entitlements.some(
        (x) => x.entitlementId === e.entitlementId,
      ),
      false,
    );
    assert.equal(
      (await api(a, base + `/offers/${o.offerId}/claim`, { ...claim, acceptedTerms: false }))
        .status,
      400,
    );
  });
  await test('ten concurrent redemption requests yield one side effect; cross partner, school and revoked staff fail', async () => {
    ok(
      await post(owner, `/partners/${p.partnerId}/staff`, {
        expectedRevision: 0,
        userId: shared.userId,
        role: 'redeemer',
        active: true,
        reason: '指定虚构核销员',
      }),
    );
    assert.equal(
      (
        await post(a, `/entitlements/${e.entitlementId}/redeem`, {
          expectedRevision: 1,
          partnerId: p.partnerId,
          token: e.token,
        })
      ).status,
      403,
    );
    ok(
      await post(owner, `/partners/${p2.partnerId}/staff`, {
        expectedRevision: 0,
        userId: owner.userId,
        role: 'redeemer',
        active: true,
        reason: '指定另一商户核销员',
      }),
    );
    assert.equal(
      (
        await post(owner, `/entitlements/${e.entitlementId}/redeem`, {
          expectedRevision: 1,
          partnerId: p2.partnerId,
          token: e.token,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await api(b, base + `/entitlements/${e.entitlementId}/redeem`, {
          requestId: randomUUID(),
          expectedRevision: 1,
          partnerId: p.partnerId,
          token: e.token,
        })
      ).status,
      403,
    );
    const inputs = Array.from({ length: 10 }, () => ({
      requestId: randomUUID(),
      expectedRevision: 1,
      partnerId: p.partnerId,
      token: e.token,
    }));
    const results = await Promise.all(
      inputs.map((i) => api(shared, base + `/entitlements/${e.entitlementId}/redeem`, i)),
    );
    assert.equal(results.filter((x) => x.status === 200).length, 1);
    assert.equal(results.filter((x) => x.status === 409).length, 9);
    const ix = results.findIndex((x) => x.status === 200);
    redeemInput = inputs[ix];
    redeemResult = results[ix].data;
    assert.deepEqual(
      ok(await api(shared, base + `/entitlements/${e.entitlementId}/redeem`, redeemInput)),
      redeemResult,
    );
    assert.equal(
      Number(
        (
          await db.pool.query(
            `SELECT count(*) FROM hd_m5_events WHERE object_id=$1 AND kind='entitlement_redeemed'`,
            [e.entitlementId],
          )
        ).rows[0].count,
      ),
      1,
    );
    ok(
      await post(owner, `/partners/${p.partnerId}/staff`, {
        expectedRevision: 1,
        userId: shared.userId,
        role: 'redeemer',
        active: false,
        reason: '核销员验收后撤权',
      }),
    );
    assert.equal(
      (await api(shared, base + `/entitlements/${e.entitlementId}/redeem`, redeemInput)).status,
      403,
    );
  });
  await test('expired source/voucher and partner exit honor or revoke issued snapshots with notifications', async () => {
    const expired = await offer(p),
      exp = ok(
        await post(a, `/offers/${expired.offerId}/claim`, {
          expectedRevision: expired.revision,
          acceptedTerms: true,
        }),
      );
    // Fictitious fault injection is limited to newly-created fixture rows, never real user data.
    await db.pool.query(
      `UPDATE hd_m5_entitlements SET valid_until=now()-interval '1 second' WHERE school_id='north' AND entitlement_id=$1`,
      [exp.entitlementId],
    );
    assert.equal(
      (
        await post(owner, `/entitlements/${exp.entitlementId}/redeem`, {
          expectedRevision: 1,
          partnerId: p.partnerId,
          token: exp.token,
        })
      ).status,
      409,
    );
    const revoke = await offer(p, { withdrawalPolicy: 'revoke' }),
      r = ok(
        await post(a, `/offers/${revoke.offerId}/claim`, {
          expectedRevision: revoke.revision,
          acceptedTerms: true,
        }),
      );
    const honor = await offer(p),
      h = ok(
        await post(a, `/offers/${honor.offerId}/claim`, {
          expectedRevision: honor.revision,
          acceptedTerms: true,
        }),
      );
    p = ok(
      await post(a, `/partners/${p.partnerId}/withdraw`, {
        expectedRevision: p.revision,
        reason: '虚构验收合作期结束退出',
      }),
    );
    assert.ok(
      !ok(await api(a, base + '/directory')).sources.some((x) => x.partnerId === p.partnerId),
    );
    assert.equal(
      (
        await post(shared, `/offers/${honor.offerId}/claim`, {
          expectedRevision: honor.revision,
          acceptedTerms: true,
        })
      ).status,
      409,
    );
    const own = ok(await api(a, base + '/entitlements')).entitlements;
    assert.equal(own.find((x) => x.entitlementId === r.entitlementId).status, 'revoked');
    assert.equal(own.find((x) => x.entitlementId === h.entitlementId).status, 'issued');
    assert.equal(
      ok(
        await post(owner, `/entitlements/${h.entitlementId}/redeem`, {
          expectedRevision: 1,
          partnerId: p.partnerId,
          token: h.token,
        }),
      ).status,
      'redeemed',
    );
    assert.ok(
      Number(
        (
          await db.pool.query(
            `SELECT count(*) FROM hd_notifications WHERE school_id='north' AND user_id=$1 AND payload->>'partnerId'=$2`,
            [a.userId, p.partnerId],
          )
        ).rows[0].count,
      ) > 0,
    );
    const m = ok(await api(a, base + `/partners/${p.partnerId}/metrics`));
    assert.equal(m.metrics.find((x) => x.kind === 'redemption').count, 2);
    assert.equal(m.entitlements.find((x) => x.status === 'expired').count, 1);
  });
  const report = {
    status: 'PASS',
    run,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    checks,
    fixtureOnly: true,
    scope:
      'Automated real PostgreSQL/Keycloak plus local fictitious booking adapter; not real merchant acceptance.',
    preserved: { legacyPackages: true, userData: true },
    objects: {
      partnerId: p.partnerId,
      otherPartnerId: p2.partnerId,
      serviceId: s.serviceId,
      completedTaskId: completedTask.taskId,
      entitlementId: e.entitlementId,
    },
  };
  await mkdir('qa/campus', { recursive: true });
  await writeFile('qa/campus/partners-live.json', JSON.stringify(report, null, 2));
} finally {
  await db.close();
}
