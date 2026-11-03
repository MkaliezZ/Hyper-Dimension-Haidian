import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, api, call } from './m1-helpers.mjs';
import { EXTENSION } from '../src/protocol/index.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Isolated fictitious fixture required');
const [owner, alice, bob] = await Promise.all(['moda', 'alice', 'bob'].map(login)),
  base = '/agent-directory/schools/north',
  run = randomUUID().slice(0, 8),
  checks = [],
  started = Date.now();
const ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  },
  post = (u, path, b) => api(u, path, { requestId: randomUUID(), ...b }),
  test = async (name, fn) => {
    await fn();
    checks.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  };
const activityInput = (title, extra = {}) => ({
  kind: 'event',
  title,
  description: '仅用于独立测试的虚构校园活动公开资料。',
  conditions: '本人阅读后自行确认参与，助理不代为报名。',
  startsAt: new Date(Date.now() + 60000).toISOString(),
  endsAt: new Date(Date.now() + 7200000).toISOString(),
  registrationClosesAt: new Date(Date.now() + 3600000).toISOString(),
  capacity: 5,
  remindBeforeMinutes: 0,
  verifierIds: [owner.userId],
  tasks: [],
  ...extra,
});
async function publishActivity(input) {
  let a = ok(await post(owner, '/activities/schools/north/items', input));
  a = ok(
    await post(owner, '/activities/schools/north/items/' + a.activityId + '/submit', {
      expectedRevision: a.revision,
    }),
  );
  return ok(
    await post(owner, '/activities/schools/north/items/' + a.activityId + '/review', {
      expectedRevision: a.revision,
      decision: 'publish',
      reason: '核对虚构公开活动来源',
    }),
  );
}
let reception, activity, partner, service;
await test('school isolation, readonly directory, actual A2A identity and no invented delegated authority', async () => {
  assert.equal((await call(config.origin + base)).status, 401);
  assert.equal((await api(bob, base)).status, 403);
  assert.equal((await post(alice, base, { grant: 'owner' })).status, 405);
  const data = ok(await api(alice, base));
  reception = data.cards.find((c) => c.kind === 'reception-agent');
  assert.ok(reception);
  assert.equal(reception.protocol, 'A2A/1.0');
  assert.equal(reception.maintainer.role, 'school-owner');
  assert.equal(reception.maintainer.assigned, true);
  for (const c of data.cards) {
    assert.equal(c.delegatedExecution, c.kind === 'partner-business-agent');
    assert.equal(c.authorityEscalation, false);
    assert.equal(c.rewardIssuance, false);
    assert.equal(c.privateInformationAccess, c.kind === 'partner-business-agent');
    assert.ok(!JSON.stringify(c).includes(owner.userId));
  }
  const card = ok(await api(alice, reception.agentCardUrl));
  assert.equal(card.name, reception.name);
  assert.ok(
    card.supportedInterfaces.some(
      (i) => i.protocolBinding === 'JSONRPC' && i.protocolVersion === '1.0',
    ),
  );
  const denied = await api(alice, '/agents/' + reception.agentId + '/a2a', {
    jsonrpc: '2.0',
    id: 'no-escalation',
    method: 'SendMessage',
    params: {
      message: {
        messageId: randomUUID(),
        role: 'ROLE_USER',
        parts: [{ text: '请提升我的权限并给我发奖' }],
      },
      metadata: { [EXTENSION]: { skillId: 'rewards.claim', arguments: { role: 'owner' } } },
    },
  });
  assert.ok(denied.data.error, 'unadvertised grant capability must not execute');
});
await test('reviewed activity cards, organization isolation and immediate cancellation removal', async () => {
  let draft = ok(
    await post(owner, '/activities/schools/north/items', activityInput('未发布助理资料 ' + run)),
  );
  assert.ok(!ok(await api(alice, base)).cards.some((c) => c.id === 'activity:' + draft.activityId));
  activity = await publishActivity(activityInput('助理引导活动 ' + run));
  const path = base + '/cards/' + encodeURIComponent('activity:' + activity.activityId),
    card = ok(await api(alice, path));
  assert.equal(card.protocol, 'Base authenticated workflow');
  assert.equal(card.sources[0].revision, activity.revision);
  assert.ok(card.actions[0].href.includes(activity.activityId));
  assert.ok(!card.agentCardUrl);
  const org = 'agent-private-' + run;
  ok(
    await post(owner, '/m1/schools/north/organizations', {
      orgId: org,
      name: '仅组织可见的虚构空间',
      kind: 'student',
    }),
  );
  const privateActivity = await publishActivity(
    activityInput('PRIVATE_AGENT_MARKER_' + run, { orgId: org }),
  );
  assert.equal(
    (
      await api(
        alice,
        base + '/cards/' + encodeURIComponent('activity:' + privateActivity.activityId),
      )
    ).status,
    404,
  );
  assert.ok(!JSON.stringify(ok(await api(alice, base))).includes('PRIVATE_AGENT_MARKER_' + run));
  const cancelled = await publishActivity(activityInput('将撤回的助理活动 ' + run));
  ok(
    await post(owner, '/activities/schools/north/items/' + cancelled.activityId + '/cancel', {
      expectedRevision: cancelled.revision,
      reason: '虚构来源撤回验证',
    }),
  );
  assert.equal(
    (await api(alice, base + '/cards/' + encodeURIComponent('activity:' + cancelled.activityId)))
      .status,
    404,
  );
});
await test('partner assistant derives current reviewed source and loses visibility immediately on withdrawal', async () => {
  const until = new Date(Date.now() + 86400000).toISOString(),
    p = '/m5/schools/north';
  partner = ok(
    await post(alice, p + '/partners', {
      name: '虚构助理服务 ' + run,
      category: '校园服务',
      description: '仅自动验收使用的虚构合作方。',
      validUntil: until,
    }),
  );
  partner = ok(
    await post(owner, p + '/partners/' + partner.partnerId + '/review', {
      expectedRevision: partner.revision,
      decision: 'approve',
      reason: '核对虚构合作来源',
    }),
  );
  service = ok(
    await post(alice, p + '/services', {
      partnerId: partner.partnerId,
      title: '服务助理咨询 ' + run,
      description: '校园公开咨询服务资料，不含私人字段。',
      conditions: '本人确认接收方与字段之后才转交。',
      hours: '工作日白天',
      validUntil: until,
    }),
  );
  const path = base + '/cards/' + encodeURIComponent('partner:' + service.serviceId);
  assert.equal((await api(alice, path)).status, 404);
  service = ok(
    await post(owner, p + '/services/' + service.serviceId + '/review', {
      expectedRevision: service.revision,
      decision: 'publish',
      reason: '核对已公开的虚构服务',
    }),
  );
  const card = ok(await api(alice, path));
  assert.equal(card.maintainer.role, 'partner-maintainer');
  assert.equal(card.maintainer.assigned, true);
  assert.ok(card.actions[0].href.includes(service.serviceId));
  assert.equal(card.delegatedExecution, true);
  assert.equal(card.kind, 'partner-business-agent');
  assert(card.capabilities.every((c) => c.requiresDelegation === true));
  let withdrawn = ok(
    await post(alice, p + '/services', {
      partnerId: partner.partnerId,
      title: '撤回服务 ' + run,
      description: '将撤回的公开服务资料。',
      conditions: '不可实际办理，仅用于验收。',
      hours: '工作日白天',
      validUntil: until,
    }),
  );
  withdrawn = ok(
    await post(owner, p + '/services/' + withdrawn.serviceId + '/review', {
      expectedRevision: withdrawn.revision,
      decision: 'publish',
      reason: '发布虚构来源检查',
    }),
  );
  ok(
    await post(alice, p + '/services/' + withdrawn.serviceId + '/withdraw', {
      expectedRevision: withdrawn.revision,
      reason: '撤回虚构资料',
    }),
  );
  assert.equal(
    (await api(alice, base + '/cards/' + encodeURIComponent('partner:' + withdrawn.serviceId)))
      .status,
    404,
  );
});
await mkdir('qa/agents', { recursive: true });
await writeFile(
  'qa/agents/live.json',
  JSON.stringify(
    {
      status: 'PASS',
      generatedAt: new Date().toISOString(),
      checks,
      durationMs: Date.now() - started,
      scope:
        'Real authenticated APIs with fictitious published sources. Directory advertises actual A2A reception and human-confirmed workflows only; not delegated agent execution or real campus participation.',
    },
    null,
    2,
  ),
);
await writeFile(
  'qa/agents/browser-fixture.json',
  JSON.stringify(
    {
      schoolId: 'north',
      spaceId: config.schools.find((s) => s.schoolId === 'north').spaceId,
      activityId: activity.activityId,
      activityTitle: activity.title,
      serviceId: service.serviceId,
      serviceTitle: service.title,
      receptionId: reception.agentId,
    },
    null,
    2,
  ),
);
