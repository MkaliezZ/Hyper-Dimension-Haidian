import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { config, login, api, call } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createServices } from '../src/platform/services.mjs';
import { createActivities } from '../src/platform/activities.mjs';
import { createOperations } from '../src/platform/operations.mjs';
import { exampleRules } from '../src/platform/campus-ledger.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Isolated fictitious campus fixture required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  services = createServices(db, config),
  run = randomUUID().slice(0, 8),
  org = 'ops-' + run,
  checks = [],
  rid = () => randomUUID();
db.campusEnabled = true;
const [owner, alice, bob] = await Promise.all(['moda', 'alice', 'bob'].map(login));
const base = '/operations/schools/north/organizations/' + org,
  school = '/operations/schools/north';
const ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  },
  get = (u, path) => api(u, path).then(ok),
  post = (u, path, b) => api(u, path, { requestId: rid(), ...b }).then(ok);
const check = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
let document, imported, activated, rule, reward, plan, preview, result;
async function importVersion(d) {
  const p = ok(await api(owner, base + '/preview', { document: d }));
  return post(owner, base + '/import', {
    document: d,
    previewHash: p.documentHash,
    expectedLatestVersion: p.previousVersion,
    confirmed: true,
    reason: '负责人核对虚构材料及本次变化',
  });
}
try {
  await post(owner, '/m1/schools/north/organizations', {
    orgId: org,
    name: '虚构运营组织 ' + run,
    kind: 'student',
  });
  await check(
    'current scope owners only, strict package preview, immutable import and version diff',
    async () => {
      assert.equal((await call(config.origin + base + '/packages')).status, 401);
      assert.equal((await api(alice, base + '/packages')).status, 403);
      assert.equal((await api(bob, base + '/packages')).status, 403);
      document = structuredClone(await get(owner, base + '/example'));
      document.packageId = 'operations-' + run;
      assert.equal(
        (await api(owner, base + '/preview', { document: { ...document, execute: 'anything' } }))
          .status,
        400,
      );
      const p = ok(await api(owner, base + '/preview', { document }));
      assert.deepEqual(p.effects, {
        createsActivities: 0,
        activatesRules: 0,
        issuesRewards: 0,
        changesHistory: false,
      });
      assert.equal(
        (
          await api(owner, base + '/import', {
            requestId: rid(),
            document,
            previewHash: p.documentHash,
            expectedLatestVersion: 0,
            confirmed: false,
            reason: '未确认材料',
          })
        ).status,
        409,
      );
      const body = {
        requestId: rid(),
        document,
        previewHash: p.documentHash,
        expectedLatestVersion: 0,
        confirmed: true,
        reason: '批准虚构模板版本作为测试',
      };
      const replies = await Promise.all([
        api(owner, base + '/import', body),
        api(owner, base + '/import', body),
      ]);
      assert.deepEqual(ok(replies[0]), ok(replies[1]));
      imported = ok(replies[0]);
      assert.equal(imported.active, false);
      assert.equal((await get(owner, base + '/packages')).heads.length, 0);
      assert.equal(
        (await api(owner, base + '/import', { ...body, reason: '改变同一请求内容' })).status,
        409,
      );
      const next = structuredClone(document);
      next.version = 2;
      next.templates[0].capacity = 7;
      const diff = ok(await api(owner, base + '/preview', { document: next }));
      assert.deepEqual(diff.diff.changed, [{ templateId: 'welcome', fields: ['capacity'] }]);
      await importVersion(next);
      assert.deepEqual(
        (await get(owner, base + '/packages/' + document.packageId + '?version=1')).document,
        document,
      );
    },
  );
  await check(
    'explicit activation CAS, real approved rule and published reward scope bindings',
    async () => {
      const body = {
        requestId: rid(),
        packageId: document.packageId,
        version: 2,
        expectedRevision: 0,
        confirmed: true,
        reason: '只为新排期启用第二版',
      };
      const race = await Promise.all([
        api(owner, base + '/activate', body),
        api(owner, base + '/activate', { ...body, requestId: rid() }),
      ]);
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
      activated = ok(race.find((r) => r.status === 200));
      rule = structuredClone(exampleRules);
      rule.version = 'ops-rules-' + run;
      let r = await post(owner, '/ledger/schools/north/rules', { document: rule });
      await post(owner, '/ledger/schools/north/rules/' + rule.version + '/approve', {
        expectedRevision: r.revision,
        reason: '虚构运营规则确认',
      });
      reward = await post(owner, '/rewards/schools/north/items', {
        orgId: org,
        kind: 'badge',
        title: '虚构运营示例纪念徽章',
        description: '仅用于隔离测试，不是真实学校身份认证。',
        target: { label: '参与示例' },
        minimumContribution: 0,
        contributionPeriod: null,
        stock: 10,
        startsAt: new Date(Date.now() - 60000).toISOString(),
        expiresAt: new Date(Date.now() + 366 * 86400000).toISOString(),
        demonstration: true,
      });
      const home = await get(owner, '/community/schools/north/organizations/' + org + '/home'),
        place = home.places[0];
      plan = {
        packageId: document.packageId,
        packageVersion: 2,
        expectedHeadRevision: activated.revision,
        title: '虚构新学期安排 ' + run,
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        responsibleId: owner.userId,
        verifierIds: [owner.userId],
        sceneId: place.sceneId,
        entityId: place.entityId,
        ruleVersion: rule.version,
        rewardId: reward.rewardId,
        templateIds: ['welcome', 'reading', 'volunteer', 'graduation'],
      };
      assert.equal((await api(owner, base + '/runs/preview', plan)).status, 409);
      reward = await post(owner, '/rewards/schools/north/items/' + reward.rewardId + '/submit', {
        expectedRevision: reward.revision,
      });
      reward = await post(owner, '/rewards/schools/north/items/' + reward.rewardId + '/review', {
        expectedRevision: reward.revision,
        decision: 'publish',
        reason: '明确虚构示例奖励及库存',
        confirmation: 'publish-demonstration',
      });
      preview = ok(await api(owner, base + '/runs/preview', plan));
      assert.equal(preview.reward.rewardId, reward.rewardId);
      assert.equal(preview.rule.ruleVersion, rule.version);
      assert.equal(preview.slots.length, 4);
      assert.ok(preview.warnings.some((w) => w.includes('尚无激活')));
      assert.equal((await api(owner, school + '/runs/preview', plan)).status, 404);
      assert.equal(
        (await api(owner, base + '/runs/preview', { ...plan, responsibleId: alice.userId })).status,
        403,
      );
    },
  );
  await check(
    'real draft creation is atomic, request replay cannot duplicate activities and no implicit publication or awards',
    async () => {
      const active = createActivities(db, null, services, config),
        before = (
          await db.pool.query(
            'SELECT count(*)::int n FROM hd_activities WHERE school_id=$1 AND org_id=$2',
            ['north', org],
          )
        ).rows[0].n;
      const fault = createOperations(
        db,
        { user: async () => ({ user_id: owner.userId }) },
        services,
        config,
        {
          createActivityDraft: async (c, arg) => {
            if (arg.input.kind === 'volunteer') throw Error('isolated_mid_schedule_fault');
            return active.createDraft(c, {
              ...arg,
              input: { ...arg.input, sceneId: null, entityId: null },
            });
          },
          validateReward: async () => preview.reward,
        },
      );
      await assert.rejects(
        () =>
          fault.handle({ method: 'POST' }, null, {
            url: new URL(config.origin + base + '/runs'),
            json: () => {},
            body: async () => ({
              ...plan,
              requestId: rid(),
              previewHash: preview.previewHash,
              confirmed: true,
            }),
          }),
        /isolated_mid_schedule_fault/,
      );
      assert.equal(
        (
          await db.pool.query(
            'SELECT count(*)::int n FROM hd_activities WHERE school_id=$1 AND org_id=$2',
            ['north', org],
          )
        ).rows[0].n,
        before,
      );
      const body = { ...plan, requestId: rid(), previewHash: preview.previewHash, confirmed: true };
      const replies = await Promise.all([
        api(owner, base + '/runs', body),
        api(owner, base + '/runs', body),
      ]);
      result = ok(replies[0]);
      assert.deepEqual(ok(replies[1]), result);
      assert.equal(result.activities.length, 4);
      assert.equal(
        (
          await db.pool.query(
            'SELECT count(*)::int n FROM hd_activities WHERE school_id=$1 AND org_id=$2',
            ['north', org],
          )
        ).rows[0].n,
        before + 4,
      );
      const report = await get(owner, base + '/runs/' + result.runId);
      assert.ok(report.timeline.every((t) => t.activity.status === 'draft'));
      assert.equal(report.timeline[0].activity.capacity, 7);
      assert.equal(report.plan.reward.rewardId, reward.rewardId);
      assert.equal(
        (
          await db.pool.query(
            'SELECT count(*)::int n FROM hd_reward_claims WHERE school_id=$1 AND reward_id=$2',
            ['north', reward.rewardId],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await check(
    'existing activity approval and participation feed factual review, version updates leave created activities intact',
    async () => {
      let a = ok(
        await api(owner, '/activities/schools/north/items/' + result.activities[0].activityId),
      ).activity;
      if (!a) a = (await get(owner, base + '/runs/' + result.runId)).timeline[0].activity;
      const id = result.activities[0].activityId;
      a = await post(owner, '/activities/schools/north/items/' + id + '/submit', {
        expectedRevision: 1,
      });
      a = await post(owner, '/activities/schools/north/items/' + id + '/review', {
        expectedRevision: a.revision,
        decision: 'publish',
        reason: '负责人核对本次虚构活动草稿',
      });
      await post(owner, '/activities/schools/north/items/' + id + '/join', {});
      const report = await get(owner, base + '/runs/' + result.runId);
      assert.equal(report.timeline[0].activity.status, 'published');
      assert.equal(report.timeline[0].participants.find((p) => p.status === 'registered').count, 1);
      assert.equal(report.timeline[0].contributions.delta, 0);
      assert.equal(report.timeline[0].activity.activity_id, id);
      const next = structuredClone(document);
      next.version = 3;
      next.templates[0].capacity = 2;
      await importVersion(next);
      await post(owner, base + '/activate', {
        packageId: document.packageId,
        version: 3,
        expectedRevision: activated.revision,
        confirmed: true,
        reason: '仅对后续排期采用第三版',
      });
      const unchanged = await get(owner, base + '/runs/' + result.runId);
      assert.equal(unchanged.package.version, 2);
      assert.equal(unchanged.timeline[0].activity.capacity, 7);
      assert.equal(unchanged.timeline[0].activity.revision, a.revision);
      assert.equal(
        (
          await api(owner, base + '/runs', {
            ...plan,
            requestId: rid(),
            previewHash: preview.previewHash,
            confirmed: true,
          })
        ).status,
        409,
      );
    },
  );
  await check(
    'handoff requires a real current owner, CAS and audit preserve source scope without granting permissions',
    async () => {
      assert.equal(
        (
          await api(owner, base + '/runs/' + result.runId + '/handoff', {
            requestId: rid(),
            expectedRevision: 1,
            responsibleId: alice.userId,
            reason: '未授权人员不能接手',
          })
        ).status,
        403,
      );
      const inv = await post(owner, '/m1/schools/north/organizations/' + org + '/invitations', {
        email: 'alice@m0.invalid',
        role: 'member',
      });
      ok(await api(alice, '/m1/invitations/accept', { token: inv.token }));
      const membership = (
        await get(owner, '/m1/schools/north/organizations/' + org + '/members')
      ).members.find((m) => m.user_id === alice.userId);
      await post(owner, '/m1/schools/north/organizations/' + org + '/members', {
        userId: alice.userId,
        role: 'owner',
        active: true,
        expectedRevision: membership.revision,
      });
      const body = {
        requestId: rid(),
        expectedRevision: 1,
        responsibleId: alice.userId,
        reason: '学校负责人已先授予组织负责人权限',
      };
      const race = await Promise.all([
        api(owner, base + '/runs/' + result.runId + '/handoff', body),
        api(owner, base + '/runs/' + result.runId + '/handoff', { ...body, requestId: rid() }),
      ]);
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
      const report = await get(alice, base + '/runs/' + result.runId + '/export');
      assert.equal(report.responsible.user_id, alice.userId);
      assert.equal(report.handoffs.length, 1);
      assert.equal(report.timeline.length, 4);
      assert.ok(!JSON.stringify(report).includes('email'));
      assert.equal((await api(bob, base + '/runs/' + result.runId + '/export')).status, 403);
      assert.equal((await api(owner, school + '/runs/' + result.runId)).status, 404);
    },
  );
} finally {
  await db.close();
  await mkdir('qa/operations', { recursive: true });
  await writeFile(
    'qa/operations/live.json',
    JSON.stringify(
      {
        status: checks.length === 5 ? 'PASS' : 'INCOMPLETE',
        checks,
        run,
        orgId: org,
        runId: result?.runId,
        activityIds: result?.activities.map((x) => x.activityId),
        ruleVersion: rule?.version,
        rewardId: reward?.rewardId,
        environment: 'isolated Ubuntu services; fictitious users and examples',
      },
      null,
      2,
    ),
  );
}
