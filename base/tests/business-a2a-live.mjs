import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
  DefaultAgentCardResolver,
} from '@a2a-js/sdk/client';
import { SendMessageRequest, TaskState } from '@a2a-js/sdk';
import { EXTENSION } from '../src/protocol/index.mjs';
import { config, login, api, call, until } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { businessSkills, businessAgentId } from '../src/platform/business-a2a.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Isolated test namespace required');
const [alice, owner, bob] = await Promise.all(['alice', 'moda', 'bob'].map(login));
const db = await openPlatform(config.databaseUrl, { m1: true }),
  checks = [],
  run = randomUUID(),
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
const expiresAt = new Date(Date.now() + 3600000).toISOString();
const grantPath = '/agent-business/schools/north/delegations';
let service, grant, client, task, proposal, request, directoryTask;
const agentId = businessAgentId(config.schools.find((s) => s.schoolId === 'north').spaceId);
const send = (skillId, args, messageId = randomUUID()) =>
  SendMessageRequest.fromJSON({
    message: { messageId, role: 'ROLE_USER', parts: [{ text: '受授权的合作服务办理' }] },
    metadata: { [EXTENSION]: { skillId, arguments: args } },
  });
async function sdk(token, agent = agentId) {
  const f = (url, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', 'Bearer ' + token);
    return fetch(url, { ...init, headers });
  };
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      cardResolver: new DefaultAgentCardResolver({ fetchImpl: f }),
      transports: [new JsonRpcTransportFactory({ fetchImpl: f })],
    }),
  );
  return factory.createFromUrl(config.origin, '/agents/' + agent + '/.well-known/agent-card.json');
}
try {
  await test('reviewed business service and explicit one-time scoped delegation', async () => {
    let p = ok(
      await post(alice, '/partners', {
        name: 'A2A 虚构合作方 ' + run,
        category: '验收虚构服务',
        description: '专用于隔离自动化验收，不是真实校园商户。',
        validUntil: expiresAt,
      }),
    );
    p = ok(
      await post(owner, '/partners/' + p.partnerId + '/review', {
        expectedRevision: p.revision,
        decision: 'approve',
        reason: '核对隔离测试资料',
      }),
    );
    let s = ok(
      await post(alice, '/services', {
        partnerId: p.partnerId,
        title: 'Agent 验收服务',
        description: '审核过的合作方业务咨询资料。',
        conditions: '用户自愿授权后办理',
        hours: '09:00–17:00',
        validUntil: expiresAt,
      }),
    );
    service = ok(
      await post(owner, '/services/' + s.serviceId + '/review', {
        expectedRevision: s.revision,
        decision: 'publish',
        reason: '审核虚构服务',
      }),
    );
    const input = {
      requestId: randomUUID(),
      label: '隔离验收 Agent',
      serviceIds: [service.serviceId],
      skills: businessSkills,
      expiresAt,
      confirmed: true,
    };
    assert.equal((await api(bob, grantPath, input)).status, 403);
    assert.equal((await api(alice, grantPath, { ...input, confirmed: false })).status, 400);
    grant = ok(await api(alice, grantPath, input));
    assert(grant.token);
    const replay = ok(await api(alice, grantPath, input));
    assert.equal(replay.delegationId, grant.delegationId);
    assert(!replay.token);
    assert.equal(
      (await db.pool.query('SELECT result FROM hd_receipts WHERE request_id=$1', [input.requestId]))
        .rows[0].result.token,
      undefined,
    );
    client = await sdk(grant.token);
  });
  await test('official A2A SDK directory and proposal-to-human-confirmation', async () => {
    const result = await client.sendMessage(send('partner.services.list', {}));
    directoryTask = result;
    assert.equal(result.status.state, TaskState.TASK_STATE_COMPLETED);
    const data = JSON.parse(result.artifacts[0].parts[0].content.value).data;
    assert.equal(data.services.length, 1);
    assert.equal(data.services[0].serviceId, service.serviceId);
    request = send('partner.task.propose', {
      requestId: randomUUID(),
      serviceId: service.serviceId,
      kind: 'consultation',
      request: { question: '请介绍服务办理所需材料。' },
    });
    task = await client.sendMessage(request);
    assert.equal(task.status.state, TaskState.TASK_STATE_COMPLETED);
    proposal = JSON.parse(task.artifacts[0].parts[0].content.value).data;
    assert.equal(proposal.status, 'proposed');
    assert(proposal.confirmationRequired);
    assert.equal(
      (
        await db.pool.query(
          'SELECT count(*)::int AS n FROM hd_m5_adapter_operations WHERE task_id=$1',
          [proposal.taskId],
        )
      ).rows[0].n,
      0,
    );
    const envelope = (
      await db.pool.query('SELECT envelope FROM hd_m5_events WHERE object_id=$1', [proposal.taskId])
    ).rows[0].envelope;
    assert.equal(envelope.actor.kind, 'agent');
    assert.equal(envelope.onBehalfOf.userId, alice.userId);
  });
  await test('duplicate A2A and business receipts across SDK clients; changed payload denied', async () => {
    const second = await sdk(grant.token);
    assert.equal((await second.sendMessage(request)).id, task.id);
    const changed = structuredClone(request);
    changed.message.parts[0].content.value = '修改原消息';
    await assert.rejects(second.sendMessage(changed));
    const businessRetry = send('partner.task.propose', request.metadata[EXTENSION].arguments);
    const duplicate = await second.sendMessage(businessRetry);
    assert.equal(
      JSON.parse(duplicate.artifacts[0].parts[0].content.value).data.taskId,
      proposal.taskId,
    );
    assert.equal(
      (
        await db.pool.query('SELECT count(*)::int AS n FROM hd_m5_tasks WHERE task_id=$1', [
          proposal.taskId,
        ])
      ).rows[0].n,
      1,
    );
  });
  await test('a separate Agent OS process uses the official client without sharing application memory', async () => {
    const child = spawn(
      process.execPath,
      ['tools/partner-agent-client.mjs', 'partner.services.list'],
      {
        env: {
          ...process.env,
          HD_AGENT_TOKEN: grant.token,
          HD_AGENT_ORIGIN: config.origin,
          HD_AGENT_ID: agentId,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    child.stdout.on('data', (b) => (out += b));
    child.stderr.resume();
    const code = await new Promise((r, j) => {
      child.once('error', j);
      child.once('exit', r);
    });
    assert.equal(code, 0);
    assert.notEqual(child.pid, process.pid);
    assert.equal(JSON.parse(out).results[0].data.services[0].serviceId, service.serviceId);
  });
  await test('delegation cannot confirm disclosure, select another school/service or call human REST', async () => {
    assert.equal(
      (
        await call(config.origin + base + '/tasks/' + proposal.taskId + '/confirm', {
          token: grant.token,
          body: {
            requestId: randomUUID(),
            expectedRevision: proposal.revision,
            confirmed: true,
            consentFields: ['question'],
          },
        })
      ).status,
      401,
    );
    assert.equal(
      (await call(config.origin + '/api/spaces/north/state', { token: grant.token })).status,
      403,
    );
    await assert.rejects(
      client.sendMessage(send('partner.task.confirm', { taskId: proposal.taskId })),
    );
    await assert.rejects(
      client.sendMessage(send('partner.service.get', { serviceId: randomUUID() })),
    );
    await assert.rejects(async () => {
      const other = await sdk(
        grant.token,
        businessAgentId(config.schools.find((s) => s.schoolId === 'south').spaceId),
      );
      await other.sendMessage(send('partner.services.list', {}));
    });
    const human = await sdk(alice.token);
    await assert.rejects(human.sendMessage(send('partner.services.list', {})));
  });
  await test('human consent then original operation receipt and delegated cancellation', async () => {
    const confirmed = ok(
      await post(alice, '/tasks/' + proposal.taskId + '/confirm', {
        expectedRevision: proposal.revision,
        confirmed: true,
        consentFields: ['question'],
      }),
    );
    assert(['queued', 'adapter_unavailable'].includes(confirmed.status));
    const current = await until(async () => {
      const t = ok(await api(alice, base + '/tasks/' + proposal.taskId));
      return ['confirmed', 'adapter_unavailable'].includes(t.status) ? t : null;
    });
    const cancelled = await client.sendMessage(
      send('partner.task.cancel', {
        taskId: proposal.taskId,
        requestId: randomUUID(),
        expectedRevision: current.revision,
        reason: '本人委托取消隔离验收申请',
      }),
    );
    assert.equal(cancelled.status.state, TaskState.TASK_STATE_COMPLETED);
    const done = await until(async () => {
      const t = ok(await api(alice, base + '/tasks/' + proposal.taskId));
      return t.status === 'cancelled' ? t : null;
    });
    assert(done.cancelReceipt);
  });
  await test('expiry, narrow skills and source withdrawal gate new calls and cached published facts', async () => {
    const read = ok(
      await api(alice, grantPath, {
        requestId: randomUUID(),
        label: '只读范围测试',
        serviceIds: [service.serviceId],
        skills: ['partner.service.get'],
        expiresAt,
        confirmed: true,
      }),
    );
    const readonly = await sdk(read.token);
    await assert.rejects(readonly.sendMessage(request));
    const exp = new Date(Date.now() + 1500).toISOString();
    const short = ok(
      await api(alice, grantPath, {
        requestId: randomUUID(),
        label: '短期授权测试',
        serviceIds: [service.serviceId],
        skills: ['partner.service.get'],
        expiresAt: exp,
        confirmed: true,
      }),
    );
    await new Promise((r) => setTimeout(r, Math.max(0, Date.parse(exp) - Date.now() + 20)));
    assert.equal(
      (
        await call(config.origin + '/agents/' + agentId + '/.well-known/agent-card.json', {
          token: short.token,
        })
      ).status,
      403,
    );
    const restart = ok(
      await api(alice, grantPath, {
        requestId: randomUUID(),
        label: '重启验证授权',
        serviceIds: [service.serviceId],
        skills: ['partner.task.get'],
        expiresAt,
        confirmed: true,
      }),
    );
    const restartClient = await sdk(restart.token),
      saved = await restartClient.sendMessage(
        send('partner.task.get', { taskId: proposal.taskId }),
      );
    const privateRoot = process.env.HD_INTEGRATION_PRIVATE || '.local';
    await mkdir(privateRoot, { recursive: true, mode: 0o700 });
    await writeFile(
      privateRoot + '/business-restart.json',
      JSON.stringify({
        fixtureOnly: true,
        origin: config.origin,
        token: restart.token,
        delegationId: restart.delegationId,
        agentId,
        a2aTaskId: saved.id,
        businessTaskId: proposal.taskId,
      }),
      { mode: 0o600 },
    );
    ok(
      await post(alice, '/services/' + service.serviceId + '/withdraw', {
        expectedRevision: service.revision,
        reason: '隔离测试核对已发布事实下架后失效',
      }),
    );
    await assert.rejects(client.getTask({ id: directoryTask.id }));
    await assert.rejects(client.sendMessage(request));
    assert.equal(
      JSON.parse(
        (await client.sendMessage(send('partner.services.list', {}))).artifacts[0].parts[0].content
          .value,
      ).data.services.length,
      0,
    );
    ok(
      await api(alice, grantPath + '/' + read.delegationId + '/revoke', {
        requestId: randomUUID(),
      }),
    );
  });
  await test('revocation blocks cached GetTask, replay, list and new execution', async () => {
    ok(
      await api(alice, grantPath + '/' + grant.delegationId + '/revoke', {
        requestId: randomUUID(),
      }),
    );
    await assert.rejects(client.getTask({ id: task.id }));
    await assert.rejects(client.sendMessage(request));
    await assert.rejects(client.listTasks({}));
    assert.equal(
      (
        await db.pool.query('SELECT token_hash FROM hd_agent_delegations WHERE delegation_id=$1', [
          grant.delegationId,
        ])
      ).rows[0].token_hash.length,
      64,
    );
  });
  const output = process.env.HD_INTEGRATION_EVIDENCE || 'evidence/integrations';
  await mkdir(output, { recursive: true });
  await writeFile(
    output + '/business-a2a-live.json',
    JSON.stringify(
      {
        status: 'PASS',
        fixtureOnly: true,
        checks,
        limits: ['Same host isolated processes; not actual merchant or school acceptance.'],
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await db.close();
}
