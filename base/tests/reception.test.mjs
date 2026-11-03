import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReception, publishedKnowledge } from '../src/reception/index.mjs';
import { exampleScene, packageFor } from '../tools/fixtures.mjs';
import { startServer } from '../src/server.mjs';
import { BaseClient } from '../src/sdk/client.mjs';

const principal = { id: 'test', spaces: ['north'], scopes: ['public:read', 'a2a:call'] };
const pack = () => packageFor(exampleScene(), 'north', '北岸');
test('General reception calls a model without retrieval hits; source authority remains explicit', async () => {
  let calls = 0;
  const provider = Object.assign(
    async ({ message, facts }) => {
      calls++;
      assert(!JSON.stringify(facts).includes('PRIVATE_FIXTURE'));
      return message === 'xyzzyhello'
        ? { answer: '你好，可以聊学习和创意。', kind: 'general', sourceIds: [] }
        : { answer: '这所学校的电话尚未提供。', kind: 'unknown', sourceIds: [] };
    },
    { general: true, providerName: 'test-double' },
  );
  const reception = createReception({ provider });
  const general = await reception.answer({ pack: pack(), principal, message: 'xyzzyhello' });
  assert.equal(general.basis, 'general');
  assert.equal(general.mode, 'live-model');
  assert.deepEqual(general.sources, []);
  assert.equal(general.unknown, false);
  const unknown = await reception.answer({ pack: pack(), principal, message: '学校电话' });
  assert.equal(unknown.unknown, true);
  assert.equal(unknown.basis, 'unavailable');
  assert.equal(calls, 2);
  for (const result of [
    { answer: '虚构引用', kind: 'space', sourceIds: ['private-note'] },
    { answer: '无引用冒充空间事实', kind: 'space', sourceIds: [] },
    { answer: '通用内容冒充资料', kind: 'general', sourceIds: ['gallery'] },
  ]) {
    const invalid = Object.assign(async () => result, { general: true });
    await assert.rejects(
      createReception({ provider: invalid }).answer({
        pack: pack(),
        principal,
        message: '项目展览',
      }),
      /published-source/,
    );
  }
  const p = pack();
  p.scenes[0].levels[0].rooms.push({
    entityId: 'secret-room',
    name: 'DO_NOT_EXPOSE_ROOM',
    access: 'restricted',
  });
  const facts = publishedKnowledge(p, principal);
  assert(facts.some((f) => f.id.startsWith('room:') && f.entityId));
  assert(!JSON.stringify(facts).includes('DO_NOT_EXPOSE_ROOM'));
});

test('A2A history is bounded and isolated by owner, Agent, space and context; replay is not another call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hd-base-history-'));
  let server;
  const inputs = [];
  const provider = Object.assign(
    async (input) => {
      inputs.push(structuredClone({ message: input.message, history: input.history }));
      return { answer: '通用回复 ' + input.message, kind: 'general', sourceIds: [] };
    },
    { general: true },
  );
  const north = pack();
  north.agents.push({ ...north.agents[0], agentId: 'north-second' });
  const packs = [north, packageFor(exampleScene('south-hall'), 'south', '南岸')];
  try {
    server = await startServer({ root: process.cwd(), packs, dataDir: dir, port: 0, provider });
    const token = server.auth.access.tokens[0].token;
    const client = new BaseClient({ url: server.origin, token });
    const first = await client.send('north-reception', '记住我的目标是校园迎新', {
      messageId: 'first-turn',
    });
    const contextId = first.task.contextId;
    await client.send('north-reception', '独立会话不应出现在追问里');
    await assert.rejects(
      client.send('north-second', '另一个 Agent 不可复用会话', { contextId }),
      /another identity|another.*Agent/,
    );
    await client.send('north-second', '另一个 Agent 的独立会话');
    await client.send('south-reception', '另一个空间的会话');
    const second = await client.send('north-reception', '根据刚才的目标列出第一步', {
      contextId,
      messageId: 'follow-up',
    });
    assert.equal(second.task.status.state, 'TASK_STATE_COMPLETED');
    assert.deepEqual(inputs.at(-1).history, [
      { role: 'user', text: '记住我的目标是校园迎新' },
      { role: 'assistant', text: '通用回复 记住我的目标是校园迎新' },
    ]);
    const count = inputs.length;
    assert.equal(
      (
        await client.send('north-reception', '根据刚才的目标列出第一步', {
          contextId,
          messageId: 'follow-up',
        })
      ).task.id,
      second.task.id,
    );
    assert.equal(inputs.length, count);
    server.auth.access.tokens.push({
      token: 'other-owner-token',
      principal: { id: 'other-owner', spaces: ['north'], scopes: ['public:read', 'a2a:call'] },
    });
    const other = new BaseClient({ url: server.origin, token: 'other-owner-token' });
    await assert.rejects(
      other.send('north-reception', '偷用上下文', { contextId }),
      /another identity/,
    );
    await assert.rejects(
      client.send('south-reception', '跨空间上下文', { contextId }),
      /another identity/,
    );
    await server.close();
    server = await startServer({ root: process.cwd(), packs, dataDir: dir, port: 0, provider });
    const restored = new BaseClient({ url: server.origin, token });
    for (let i = 0; i < 5; i++)
      await restored.send('north-reception', '后续话题' + i, { contextId });
    const history = inputs.at(-1).history;
    assert.equal(history.length, 8);
    assert(!JSON.stringify(history).includes('独立会话'));
    assert.equal(history.at(-2).text, '后续话题3');
  } finally {
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
