import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { config, fixtures, login, api, call, admin } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createRewards } from '../src/platform/rewards.mjs';
import { catalogM2 as v1 } from '../src/avatar/model-m2.mjs';
import { catalogM2 as v2 } from '../src/avatar/model-m2-v2.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Isolated fictitious fixture required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  run = randomUUID().slice(0, 8),
  base = '/rewards/schools/north',
  checks = [],
  started = Date.now();
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const post = (u, path, b) => api(u, base + path, { requestId: randomUUID(), ...b });
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const [owner, bob] = await Promise.all(['moda', 'bob'].map(login));
async function account(suffix) {
  const username = 'reward-' + run + '-' + suffix,
    email = username + '@m1.invalid',
    password = 'Reward-fixture-' + randomUUID();
  await admin('users', 'POST', {
    username,
    email,
    emailVerified: true,
    enabled: true,
    firstName: 'Reward',
    lastName: 'Fixture',
    credentials: [{ type: 'password', value: password, temporary: false }],
  });
  const fixture = { username, credentials: [{ value: password }] };
  fixtures.push(fixture);
  const user = await login(username);
  const i = ok(
    await api(owner, '/m1/schools/north/invitations', {
      requestId: randomUUID(),
      email,
      role: 'student',
    }),
  );
  ok(await api(user, '/m1/invitations/accept', { token: i.token }));
  return { user, fixture };
}
const a = (await account('live')).user,
  b = (await account('competitor')).user,
  browserAccount = await account('browser');
await mkdir('.local', { recursive: true });
await writeFile('.local/rewards-browser-fixture.json', JSON.stringify(browserAccount.fixture));
const input = (kind = 'badge', extra = {}) => ({
  kind,
  title: '虚构奖励 ' + run + ' ' + kind,
  description: '隔离的虚构自动验收奖励，不代表真实商户或学校承诺。',
  target:
    kind === 'badge'
      ? { label: '虚构校园建设认可' }
      : kind === 'appearance'
        ? { itemId: 'appearance:community-ribbon' }
        : {},
  minimumContribution: 0,
  stock: 10,
  startsAt: new Date(Date.now() - 60000).toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  demonstration: true,
  ...extra,
});
async function publish(r) {
  r = ok(await post(owner, '/items/' + r.rewardId + '/submit', { expectedRevision: r.revision }));
  return ok(
    await post(owner, '/items/' + r.rewardId + '/review', {
      expectedRevision: r.revision,
      decision: 'publish',
      reason: '已核对虚构奖励、资格和预算',
      confirmation: 'publish-demonstration',
    }),
  );
}
const reward = async (kind, extra) => publish(ok(await post(owner, '/items', input(kind, extra))));
const claim = (u, r) =>
  post(u, '/items/' + r.rewardId + '/claim', {
    expectedRevision: r.revision,
    acceptedTerms: true,
    acknowledgeDemonstration: true,
  });
const contribution = async (user) =>
  Number(
    (
      await db.pool.query(
        "SELECT COALESCE(sum(delta),0) score FROM hd_contributions WHERE school_id='north' AND user_id=$1",
        [user.userId],
      )
    ).rows[0].score,
  );
let badge, badgeClaim;
try {
  await test('current school and organizer scope, explicit demo approval and contribution eligibility', async () => {
    assert.equal((await call(config.origin + base + '/items')).status, 401);
    assert.equal((await api(bob, base + '/items')).status, 403);
    assert.equal(ok(await api(a, base + '/status')).defaultAwardsEnabled, false);
    assert.equal((await post(a, '/items', input())).status, 403);
    let r = ok(await post(owner, '/items', input()));
    assert.ok(!ok(await api(a, base + '/items')).items.some((x) => x.rewardId === r.rewardId));
    r = ok(await post(owner, '/items/' + r.rewardId + '/submit', { expectedRevision: r.revision }));
    assert.equal(
      (
        await post(owner, '/items/' + r.rewardId + '/review', {
          expectedRevision: r.revision,
          decision: 'publish',
          reason: '未明确确认演示',
        })
      ).status,
      400,
    );
    const gated = await reward('badge', { minimumContribution: 99999999 });
    assert.equal((await claim(a, gated)).status, 403);
    const org = 'reward-org-' + run;
    ok(
      await api(owner, '/m1/schools/north/organizations', {
        requestId: randomUUID(),
        orgId: org,
        name: '虚构奖励组织',
        kind: 'student',
      }),
    );
    const privateReward = await reward('badge', { orgId: org });
    assert.equal((await claim(a, privateReward)).status, 403);
    const participationReward = await reward('appearance', { orgId: org });
    assert.equal(
      (await claim(owner, participationReward)).status,
      403,
      'school management alone must not reserve unusable organization participation rights',
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT allocated FROM hd_rewards WHERE school_id=$1 AND reward_id=$2',
          ['north', participationReward.rewardId],
        )
      ).rows[0].allocated,
      0,
    );
    const capabilities = ok(await api(owner, base + '/status'));
    assert.ok(!capabilities.participationOrgIds.includes(org));
    const invite = ok(
      await api(owner, '/m1/schools/north/organizations/' + org + '/invitations', {
        requestId: randomUUID(),
        email: browserAccount.fixture.username + '@m1.invalid',
        role: 'member',
      }),
    );
    ok(await api(browserAccount.user, '/m1/invitations/accept', { token: invite.token }));
    const member = ok(
      await api(owner, '/m1/schools/north/organizations/' + org + '/members'),
    ).members.find((m) => m.user_id === browserAccount.user.userId);
    ok(
      await api(owner, '/m1/schools/north/organizations/' + org + '/members', {
        requestId: randomUUID(),
        userId: member.user_id,
        role: 'owner',
        active: true,
        expectedRevision: member.revision,
      }),
    );
    assert.ok(ok(await api(browserAccount.user, base + '/status')).managedOrgIds.includes(org));
    browserAccount.fixture.rewardOrgId = org;
    await writeFile('.local/rewards-browser-fixture.json', JSON.stringify(browserAccount.fixture));
  });
  await test('ten parallel claims allocate once, one actual badge, CAS receipts and historical score unchanged', async () => {
    badge = await reward('badge', { stock: 1 });
    const before = await contribution(a);
    const requests = Array.from({ length: 10 }, () => ({
      requestId: randomUUID(),
      expectedRevision: badge.revision,
      acceptedTerms: true,
      acknowledgeDemonstration: true,
    }));
    const results = await Promise.all(
      requests.map((x) => api(a, base + '/items/' + badge.rewardId + '/claim', x)),
    );
    assert.equal(results.filter((x) => x.status === 200).length, 1);
    assert.equal(results.filter((x) => x.status === 409).length, 9);
    const index = results.findIndex((x) => x.status === 200);
    badgeClaim = ok(results[index]);
    assert.equal(badgeClaim.status, 'fulfilled');
    assert.deepEqual(
      ok(await api(a, base + '/items/' + badge.rewardId + '/claim', requests[index])),
      badgeClaim,
    );
    assert.equal(
      (
        await api(a, base + '/items/' + badge.rewardId + '/claim', {
          ...requests[index],
          acceptedTerms: false,
        })
      ).status,
      409,
    );
    assert.equal((await claim(b, badge)).status, 409);
    assert.equal(await contribution(a), before);
    const actual = (
      await db.pool.query(
        'SELECT * FROM hd_personal_badges WHERE school_id=$1 AND reward_claim_id=$2',
        ['north', badgeClaim.claimId],
      )
    ).rows;
    assert.equal(actual.length, 1);
    assert.equal(actual[0].status, 'active');
    assert.equal(actual[0].visibility, 'private');
    assert.ok(
      ok(await api(a, '/personal/schools/north/me')).badges.some(
        (x) => x.badge_id === actual[0].badge_id,
      ),
    );
    assert.equal((await api(b, base + '/claims/' + badgeClaim.claimId + '/history')).status, 403);
    const x = ok(
      await post(owner, '/claims/' + badgeClaim.claimId + '/revoke', {
        expectedRevision: badgeClaim.revision,
        reason: '虚构核验修正，精确撤销本次奖励',
      }),
    );
    assert.equal(x.status, 'revoked');
    assert.equal(
      (
        await db.pool.query('SELECT status FROM hd_personal_badges WHERE badge_id=$1', [
          actual[0].badge_id,
        ])
      ).rows[0].status,
      'revoked',
    );
    assert.equal(await contribution(a), before);
  });
  await test('additive v3 appearance, authoritative inventory gate, model restoration and precise revocation', async () => {
    for (const catalog of [v1(), v2()])
      for (const part of catalog.parts) {
        const bytes = await readFile(
          'assets/avatars/' + part.asset.replace('/avatar-library/', ''),
        );
        assert.equal(createHash('sha256').update(bytes).digest('hex'), part.sha256);
      }
    const avatar = '/m2/schools/north/avatar';
    let saved = ok(await api(a, avatar));
    const v2catalog = ok(await api(a, avatar + '/catalog?version=campus-original-2'));
    saved = ok(
      await api(a, avatar, {
        requestId: randomUUID(),
        expectedVersion: saved.version,
        recipe: v2catalog.defaultRecipe,
        catalogHash: v2catalog.catalogHash,
        upgradeFrom: {
          catalogVersion: saved.recipe.catalogVersion,
          catalogHash: saved.catalogHash,
          modelHash: saved.modelHash,
        },
      }),
    );
    const c = ok(await api(a, avatar + '/catalog?version=campus-rewards-3')),
      recipe = structuredClone(c.defaultRecipe);
    recipe.parts.accessory = 'accessory-community-ribbon';
    const upgrade = {
      catalogVersion: saved.recipe.catalogVersion,
      catalogHash: saved.catalogHash,
      modelHash: saved.modelHash,
    };
    const saving = {
      expectedVersion: saved.version,
      recipe,
      catalogHash: c.catalogHash,
      upgradeFrom: upgrade,
    };
    assert.equal((await api(a, avatar, { requestId: randomUUID(), ...saving })).status, 403);
    const r = await reward('appearance'),
      issued = ok(await claim(a, r));
    assert.equal(issued.status, 'fulfilled');
    const part = c.parts.find((p) => p.id === 'accessory-community-ribbon');
    const asset = await fetch(config.origin + part.asset);
    assert.equal(asset.status, 200);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await asset.arrayBuffer()))
        .digest('hex'),
      part.sha256,
    );
    saved = ok(await api(a, avatar, { requestId: randomUUID(), ...saving }));
    assert.equal(saved.recipe.catalogVersion, 'campus-rewards-3');
    const model = await fetch(config.origin + avatar + '/model.glb', {
      headers: { Authorization: 'Bearer ' + a.token },
    });
    assert.equal(model.status, 200);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await model.arrayBuffer()))
        .digest('hex'),
      saved.modelHash,
    );
    const again = await login(
      fixtures.find((x) => x.username.endsWith('-live') && x.username.startsWith('reward-' + run))
        .username,
    );
    assert.equal(ok(await api(again, avatar)).modelHash, saved.modelHash);
    ok(
      await post(owner, '/claims/' + issued.claimId + '/revoke', {
        expectedRevision: issued.revision,
        reason: '虚构外观奖励撤销，保留原始配方',
      }),
    );
    assert.equal(
      (
        await fetch(config.origin + avatar + '/model.glb', {
          headers: { Authorization: 'Bearer ' + a.token },
        })
      ).status,
      403,
    );
    assert.equal(ok(await api(a, avatar)).modelHash, saved.modelHash);
    const free = structuredClone(saved.recipe);
    free.parts.accessory = 'accessory-none';
    ok(
      await api(a, avatar, {
        requestId: randomUUID(),
        expectedVersion: saved.version,
        recipe: free,
        catalogHash: saved.catalogHash,
      }),
    );
    const ledger = (
      await db.pool.query(
        "SELECT delta FROM hd_m2_inventory_events WHERE school_id='north' AND detail->>'rewardClaimId'=$1 ORDER BY created_at",
        [issued.claimId],
      )
    ).rows;
    assert.deepEqual(
      ledger.map((x) => x.delta),
      [1, -1],
    );
  });
  await test('only explicitly bound new activity requires actual active inventory qualification', async () => {
    const p = '/activities/schools/north/items';
    let activity = ok(
      await api(owner, p, {
        requestId: randomUUID(),
        kind: 'event',
        title: '虚构资格活动 ' + run,
        description: '只用于奖励活动准入验证，不是实际活动。',
        conditions: '需领取指定资格',
        tasks: [],
        capacity: 5,
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        endsAt: new Date(Date.now() + 7200000).toISOString(),
        registrationClosesAt: new Date(Date.now() + 1800000).toISOString(),
        remindBeforeMinutes: 5,
        verifierIds: [owner.userId],
      }),
    );
    const r = await reward('activity', { target: { activityId: activity.activityId } });
    activity = ok(
      await api(owner, p + '/' + activity.activityId + '/submit', {
        requestId: randomUUID(),
        expectedRevision: activity.revision,
      }),
    );
    activity = ok(
      await api(owner, p + '/' + activity.activityId + '/review', {
        requestId: randomUUID(),
        expectedRevision: activity.revision,
        decision: 'publish',
        reason: '核对准入条件后发布',
      }),
    );
    assert.equal(
      (await api(a, p + '/' + activity.activityId + '/join', { requestId: randomUUID() })).status,
      403,
    );
    const issued = ok(await claim(a, r));
    assert.equal(issued.status, 'fulfilled');
    assert.equal(
      ok(await api(a, p + '/' + activity.activityId + '/join', { requestId: randomUUID() })).status,
      'registered',
    );
    const other = ok(await claim(b, r));
    ok(
      await post(owner, '/claims/' + other.claimId + '/revoke', {
        expectedRevision: other.revision,
        reason: '撤销尚未报名的虚构资格',
      }),
    );
    assert.equal(
      (await api(b, p + '/' + activity.activityId + '/join', { requestId: randomUUID() })).status,
      403,
    );
  });
  await test('expiry hides badge immediately and durable reconciliation reverses exact authority', async () => {
    const r = await reward('badge', { expiresAt: new Date(Date.now() + 3000).toISOString() }),
      x = ok(await claim(a, r));
    assert.equal(x.status, 'fulfilled');
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, Date.parse(r.expiresAt) - Date.now() + 40)),
    );
    assert.equal((await claim(b, r)).status, 409);
    assert.equal(
      ok(await api(a, '/personal/schools/north/me')).badges.find(
        (b) => b.badge_id === x.authorityReceipt.badgeId,
      ).status,
      'expired',
    );
    ok(await api(owner, base + '/reconcile', {}));
    assert.equal(
      (
        await db.pool.query(
          'SELECT status FROM hd_reward_claims WHERE school_id=$1 AND claim_id=$2',
          ['north', x.claimId],
        )
      ).rows[0].status,
      'expired',
    );
  });
  await test('partner reward uses original stock/voucher, failure retains allocation and retry completes same claim', async () => {
    const p = '/m5/schools/north';
    let partner = ok(
      await api(owner, p + '/partners', {
        requestId: randomUUID(),
        name: '奖励验收虚构合作 ' + run,
        category: '虚构校园服务',
        description: '仅用于自动验收，没有真实商品或金钱价值。',
        validUntil: new Date(Date.now() + 86400000).toISOString(),
      }),
    );
    partner = ok(
      await api(owner, p + '/partners/' + partner.partnerId + '/review', {
        requestId: randomUUID(),
        expectedRevision: partner.revision,
        decision: 'approve',
        reason: '确认虚构素材',
      }),
    );
    let offer = ok(
      await api(owner, p + '/offers', {
        requestId: randomUUID(),
        partnerId: partner.partnerId,
        title: '虚构合作权益 ' + run,
        terms: '只验证真实权威数据链，不承诺真实商户履约。',
        stock: 2,
        minContribution: 0,
        withdrawalPolicy: 'honor',
        validUntil: new Date(Date.now() + 7200000).toISOString(),
      }),
    );
    offer = ok(
      await api(owner, p + '/offers/' + offer.offerId + '/review', {
        requestId: randomUUID(),
        expectedRevision: offer.revision,
        decision: 'publish',
        reason: '核对虚构条款及份数',
      }),
    );
    const r = await reward('partner', {
      target: { offerId: offer.offerId, offerRevision: offer.revision },
      stock: 2,
    });
    const isolated = createRewards(
      db,
      { user: async () => ({ user_id: a.userId }) },
      { school: (schoolId) => ({ schoolId }) },
      config,
    );
    let failed;
    await isolated.handle(
      { method: 'POST' },
      {},
      {
        url: new URL(base + '/items/' + r.rewardId + '/claim', config.origin),
        body: async () => ({
          requestId: randomUUID(),
          expectedRevision: r.revision,
          acceptedTerms: true,
          acknowledgeDemonstration: true,
        }),
        json: (_res, status, data) => {
          assert.equal(status, 200);
          failed = data;
        },
      },
    );
    assert.equal(failed.status, 'failed');
    assert.equal(failed.lastError, 'partner_rewards_not_connected');
    assert.equal(
      (
        await db.pool.query('SELECT issued FROM hd_m5_offers WHERE school_id=$1 AND offer_id=$2', [
          'north',
          offer.offerId,
        ])
      ).rows[0].issued,
      0,
    );
    const retried = ok(
      await post(a, '/claims/' + failed.claimId + '/retry', { expectedRevision: failed.revision }),
    );
    assert.equal(retried.status, 'fulfilled');
    assert.equal(retried.claimId, failed.claimId);
    assert.equal(retried.attempts, 2);
    const entitlement = (
      await db.pool.query(
        'SELECT * FROM hd_m5_entitlements WHERE school_id=$1 AND entitlement_id=$2',
        ['north', retried.authorityReceipt.entitlementId],
      )
    ).rows[0];
    assert.equal(entitlement.terms.rewardClaimId, failed.claimId);
    assert.equal(entitlement.status, 'issued');
    assert.equal(
      entitlement.valid_until.toISOString(),
      new Date(retried.expiresAt).toISOString(),
      'reward voucher must expire with its claim without waiting for reconciliation',
    );
    const redeemed = ok(
      await api(owner, p + '/entitlements/' + entitlement.entitlement_id + '/redeem', {
        requestId: randomUUID(),
        expectedRevision: entitlement.revision,
        partnerId: partner.partnerId,
        token: entitlement.token,
      }),
    );
    assert.equal(redeemed.status, 'redeemed');
    assert.equal(
      (
        await post(owner, '/claims/' + retried.claimId + '/revoke', {
          expectedRevision: retried.revision,
          reason: '已核销不能伪造撤销',
        })
      ).status,
      409,
    );
    const second = ok(await claim(b, r));
    ok(
      await post(owner, '/claims/' + second.claimId + '/revoke', {
        expectedRevision: second.revision,
        reason: '撤销尚未使用的本次虚构权益',
      }),
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT status FROM hd_m5_entitlements WHERE school_id=$1 AND entitlement_id=$2',
          ['north', second.authorityReceipt.entitlementId],
        )
      ).rows[0].status,
      'revoked',
    );
  });
  await mkdir('qa/rewards', { recursive: true });
  await writeFile(
    'qa/rewards/live.json',
    JSON.stringify(
      {
        status: 'PASS',
        generatedAt: new Date().toISOString(),
        checks,
        durationMs: Date.now() - started,
        scope:
          'Isolated fictitious accounts and real authoritative PostgreSQL records. Automated checks; no actual school awards, external merchant fulfilment or physical multi-device acceptance.',
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
