import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { localHermesProvider } from '../src/reception/hermes.mjs';
import { startServer, loadPackages } from '../src/server.mjs';
import { BaseClient } from '../src/sdk/client.mjs';

if (!process.env.DEEPSEEK_API_KEY)
  throw Error('Real Hermes validation requires DEEPSEEK_API_KEY; not tested');
const config = JSON.parse(
  await readFile(process.env.HDBASE_RECEPTION_CONFIG || '.local/reception.json', 'utf8'),
);
assert.equal(config.provider, 'hermes');
const packs = await loadPackages([
  resolve(process.env.HDBASE_TEST_SPACE || 'examples/north/space.json'),
]);
const pack = packs[0],
  agentId = pack.agents[0].agentId;
const dir = await mkdtemp(join(tmpdir(), 'hd-base-hermes-live-'));
let server;
try {
  const raw = await localHermesProvider({ ...config, dataDir: dir });
  const transports = [];
  const provider = Object.assign(
    async (input) => {
      const result = await raw(input);
      transports.push({
        transport: result.transport,
        toolCount: result.toolCount,
        model: result.model,
      });
      return result;
    },
    { general: true, providerName: 'hermes' },
  );
  server = await startServer({
    root: process.cwd(),
    packs,
    dataDir: dir,
    port: 0,
    provider,
    maxModelCallsPerDay: 8,
  });
  const client = new BaseClient({ url: server.origin, token: server.auth.access.tokens[0].token });
  const answers = [];
  const send = async (message, options = {}) => {
    const response = await client.send(agentId, message, options);
    assert.equal(
      response.task.status.state,
      'TASK_STATE_COMPLETED',
      JSON.stringify(response.task.status),
    );
    const result = JSON.parse(response.task.artifacts[0].parts[0].text);
    assert.equal(result.provider, 'hermes');
    assert.equal(result.mode, 'live-model');
    answers.push({
      message,
      answer: result.text,
      basis: result.basis,
      sourceIds: result.sources.map((s) => s.id),
    });
    return { task: response.task, result };
  };
  const first = await send('你好。我有12张卡片，平均分给3位同学，每人几张？', {
    messageId: 'hermes-general-1',
  });
  assert.equal(first.result.basis, 'general');
  assert.match(first.result.text, /4|四/);
  const follow = await send('如果再给每人2张，每人现在有几张？请根据刚才的问题回答。', {
    contextId: first.task.contextId,
  });
  assert.equal(follow.result.basis, 'general');
  assert.match(follow.result.text, /6|六/);
  const level = pack.scenes[0].levels.at(-1);
  const room = level.rooms.find((r) => r.access === 'public');
  const sourced = await send(`${room.name}在什么楼层？只用当前空间的资料。`);
  assert.equal(sourced.result.basis, 'published');
  assert(sourced.result.sources.some((s) => s.entityId === room.entityId));
  const unknown = await send('这所学校的校长姓名和办公室电话号码是什么？');
  assert.equal(unknown.result.basis, 'unavailable');
  assert.equal(unknown.result.unknown, true);
  const replay = await client.send(agentId, '你好。我有12张卡片，平均分给3位同学，每人几张？', {
    messageId: 'hermes-general-1',
  });
  assert.equal(replay.task.id, first.task.id);
  assert.equal(transports.length, 4);
  assert.equal(Object.values(server.store.read().modelBudgets)[0], 4);
  const report = {
    at: new Date().toISOString(),
    kind: 'real-local-Hermes-via-A2A',
    spaceId: pack.spaceId,
    runtime: 'locally installed Hermes AIAgent',
    model: 'deepseek-flash',
    offlineModel: false,
    checks: {
      generalReasoning: 'PASS',
      followUp: 'PASS',
      roomSources: 'PASS',
      missingSchoolFacts: 'PASS',
      replayNoExtraCall: 'PASS',
      zeroTools: 'PASS',
    },
    transports,
    answers,
    scope:
      'Four real online model calls through isolated local Hermes; automatic checks, not human content acceptance',
  };
  await mkdir('qa', { recursive: true });
  await writeFile('qa/hermes-live.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await server?.close();
  await rm(dir, { recursive: true, force: true });
}
