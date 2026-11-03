import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SendMessageRequest, ListTasksRequest, TaskState } from '@a2a-js/sdk';
import { ClientFactory, ClientFactoryOptions, JsonRpcTransportFactory } from '@a2a-js/sdk/client';
import { exampleScene, packageFor } from '../tools/fixtures.mjs';
import { startServer } from '../src/server.mjs';
import { BaseClient } from '../src/sdk/client.mjs';
import { EXTENSION } from '../src/protocol/index.mjs';
const root = process.cwd(),
  principal = { id: 'external-agent', spaces: ['north'], scopes: ['public:read', 'a2a:call'] };
test('Official A2A 1.0 SDK discovery/send/get/list, duplicate and restart, cross-space isolation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hd-base-a2a-'));
  const packs = [
    packageFor(exampleScene(), 'north', '北岸'),
    packageFor(exampleScene('south-hall', 1), 'south', '南岸'),
  ];
  let server;
  try {
    server = await startServer({ root, packs, dataDir: dir, port: 0, provider: null });
    const token = server.auth.access.tokens[0].token;
    server.auth.access.tokens.push({ token: 'scoped-test-token', principal });
    const scoped = new BaseClient({ url: server.origin, token: 'scoped-test-token' });
    const fetchAuth = (input, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', 'Bearer ' + token);
      return fetch(input, { ...init, headers });
    };
    const factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        transports: [new JsonRpcTransportFactory({ fetchImpl: fetchAuth })],
      }),
    );
    const official = await factory.createFromUrl(
      server.origin,
      '/agents/north-reception/.well-known/agent-card.json',
    );
    const messageId = randomUUID(),
      params = { message: { messageId, role: 'ROLE_USER', parts: [{ text: '项目展览在哪里' }] } };
    const response = await official.sendMessage(SendMessageRequest.fromJSON(params));
    assert.equal(response.status.state, TaskState.TASK_STATE_COMPLETED);
    assert.equal((await official.getTask({ id: response.id })).id, response.id);
    assert(
      (await official.listTasks(ListTasksRequest.fromJSON({ pageSize: 1, historyLength: 0 }))).tasks
        .length === 1,
    );
    const duplicate = await official.sendMessage(SendMessageRequest.fromJSON(params));
    assert.equal(duplicate.id, response.id);
    await assert.rejects(
      official.sendMessage(
        SendMessageRequest.fromJSON({
          ...params,
          message: { ...params.message, parts: [{ text: 'changed' }] },
        }),
      ),
    );
    await assert.rejects(scoped.send('south-reception', '项目展览'), /permission/);
    await assert.rejects(scoped.task('north-reception', response.id), /not found/);
    const client = new BaseClient({ url: server.origin, token });
    const mid = randomUUID(),
      leave = await client.send('north-reception', 'A2A 持久留言', {
        messageId: mid,
        skillId: 'message.leave',
      });
    await client.send('north-reception', 'A2A 持久留言', {
      messageId: mid,
      skillId: 'message.leave',
    });
    assert.equal(server.store.read().messages.length, 1);
    const nav = await client.send('north-reception', '前往工作室', {
      skillId: 'navigation.route',
      args: {
        from: { sceneId: 'north-hall', levelId: 'L1', point: [-3, 0, 10] },
        to: { sceneId: 'north-hall', levelId: 'L2', point: [10, 3.6, 3] },
      },
    });
    assert.equal(nav.task.status.state, 'TASK_STATE_COMPLETED');
    assert(JSON.parse(nav.task.artifacts[0].parts[0].text).path.some((p) => p.connectorId));
    await server.close();
    server = await startServer({ root, packs, dataDir: dir, port: 0, provider: null });
    const restored = new BaseClient({ url: server.origin, token });
    assert.equal(
      (
        await restored.send('north-reception', 'A2A 持久留言', {
          messageId: mid,
          skillId: 'message.leave',
        })
      ).task.id,
      leave.task.id,
    );
    assert.equal(server.store.read().messages.length, 1);
    const raw = await fetch(server.origin + '/agents/north-reception/a2a', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'A2A-Version': '0.3',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'GetTask',
        params: { id: response.id },
      }),
    });
    assert.equal((await raw.json()).error.code, -32009);
    const privateResponse = await fetch(server.origin + '/.local/access.json');
    assert.equal(privateResponse.status, 403);
    const scene = await fetch(server.origin + '/api/spaces/north/scene').then((r) => r.text());
    assert(!scene.includes('PRIVATE_FIXTURE'));
    assert(!scene.includes(token));
  } finally {
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('Cancel and interrupted-task explicit resume; custom trusted capability checks its scope', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hd-base-task-'));
  let release, server;
  const provider = () => new Promise((resolve) => (release = resolve)),
    pack = packageFor(exampleScene(), 'north', '北岸');
  try {
    server = await startServer({ root, packs: [pack], dataDir: dir, port: 0, provider });
    const token = server.auth.access.tokens[0].token,
      client = new BaseClient({ url: server.origin, token });
    const first = await client.send('north-reception', '项目展览', { returnImmediately: true });
    assert.equal(first.task.status.state, 'TASK_STATE_WORKING');
    await client.rpc('north-reception', 'CancelTask', { id: first.task.id });
    release({ answer: '已取消的答案不得覆盖任务', sourceIds: ['gallery'] });
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(
      (await client.task('north-reception', first.task.id)).status.state,
      'TASK_STATE_CANCELED',
    );
    // Persist a working record as an interrupted service would; recovery must not replay it.
    const pendingId = randomUUID();
    await server.store.transact((d) => {
      d.tasks[pendingId] = {
        id: pendingId,
        contextId: 'resume-context',
        spaceId: 'north',
        agentId: 'north-reception',
        owner: 'maintainer',
        skillId: 'message.leave',
        input: '不可自动重复',
        arguments: {},
        history: [],
        createdAt: Date.now(),
        status: { state: 'TASK_STATE_WORKING' },
      };
      return true;
    });
    await server.close();
    server = await startServer({ root, packs: [pack], dataDir: dir, port: 0, provider: null });
    const after = new BaseClient({ url: server.origin, token });
    assert.equal(
      (await after.task('north-reception', pendingId)).status.state,
      'TASK_STATE_INPUT_REQUIRED',
    );
    assert.equal(server.store.read().messages.length, 0);
    await after.send('north-reception', '明确续做留言', {
      taskId: pendingId,
      contextId: 'resume-context',
      skillId: 'message.leave',
    });
    assert.equal(server.store.read().messages.length, 1);
  } finally {
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
