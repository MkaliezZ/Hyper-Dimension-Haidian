import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.mjs';
import { packageFor, exampleScene } from '../tools/fixtures.mjs';
import { BaseClient } from '../src/sdk/client.mjs';
if (!process.env.DEEPSEEK_API_KEY)
  throw Error('DEEPSEEK_API_KEY is not configured; live-model validation was NOT performed');
const dir = await mkdtemp(join(tmpdir(), 'hd-base-live-'));
let server;
try {
  server = await startServer({
    root: process.cwd(),
    packs: [packageFor(exampleScene(), 'north', '北岸虚拟示例')],
    dataDir: dir,
    port: 0,
    maxModelCallsPerDay: 2,
  });
  const client = new BaseClient({ url: server.origin, token: server.auth.access.tokens[0].token }),
    messageId = 'live-question-1',
    first = await client.send('north-reception', '项目展厅在哪里？那里展示什么？', { messageId }),
    result = JSON.parse(first.task.artifacts?.[0]?.parts?.[0]?.text || 'null');
  assert(result && result.mode === 'live-model', JSON.stringify(first.task.status));
  assert(result.sources.some((s) => s.id === 'gallery'));
  const replay = await client.send('north-reception', '项目展厅在哪里？那里展示什么？', {
    messageId,
  });
  assert.equal(replay.task.id, first.task.id);
  assert.equal(Object.values(server.store.read().modelBudgets)[0], 1);
  const report = {
    at: new Date().toISOString(),
    kind: 'real-model-API',
    model: result.model,
    mode: result.mode,
    answer: result.text,
    sourceIds: result.sources.map((s) => s.id),
    duplicateDidNotCallModelAgain: true,
    scope: 'One grounded API query on an original fictional space; not a human correctness review',
  };
  await mkdir('qa', { recursive: true });
  await writeFile('qa/live-reception.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await server?.close();
  await rm(dir, { recursive: true, force: true });
}
