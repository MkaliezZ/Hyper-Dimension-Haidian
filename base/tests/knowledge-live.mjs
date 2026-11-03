import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openKnowledge } from '../src/knowledge/index.mjs';
import { localHermesProvider } from '../src/reception/hermes.mjs';
import { loadPackages, startServer } from '../src/server.mjs';
import { BaseClient } from '../src/sdk/client.mjs';
const python = process.env.HDBASE_EMBED_PYTHON;
if (!python) throw Error('Set HDBASE_EMBED_PYTHON; real embedding not tested');
const root = resolve(process.env.BASE_ROOT || '.'),
  dir = await mkdtemp(join(tmpdir(), 'hd-rag-live-'));
const config = {
  database: { provider: process.env.HDBASE_KNOWLEDGE_TEST_PROVIDER || 'pglite' },
  embedding: { provider: 'onnx', python, modelDir: 'models/bge-small-zh-v1.5' },
  minScore: 0.45,
  topK: 3,
};
const documents = JSON.parse(
  await readFile(join(root, 'examples/knowledge/campus-documents.json'), 'utf8'),
);
let kb, server;
try {
  kb = await openKnowledge({ dataDir: dir, root, config, migrate: true });
  const imported = await kb.import('north', documents);
  assert.equal(imported.excluded, 1);
  const packs = await loadPackages([join(root, 'examples/north/space.json')]);
  const principal = { id: 'test', spaces: ['north'], scopes: ['public:read', 'a2a:call'] };
  const hits = await kb.retrieve(packs[0], principal, '想借书应该拿什么证件？');
  assert.equal(hits[0].documentId, 'library');
  await kb.close();
  kb = null;
  await writeFile(join(dir, 'knowledge.json'), JSON.stringify(config));
  const hermesConfig = JSON.parse(
    await readFile(process.env.HDBASE_RECEPTION_CONFIG || '.local/reception.json', 'utf8'),
  );
  const raw = await localHermesProvider({ ...hermesConfig, dataDir: dir });
  let calls = 0;
  const provider = Object.assign(
    async (input) => {
      calls++;
      assert(!JSON.stringify(input).includes('PRIVATE_KB_FIXTURE'));
      return raw(input);
    },
    { general: true, providerName: 'hermes' },
  );
  server = await startServer({ root, packs, dataDir: dir, port: 0, provider });
  const client = new BaseClient({ url: server.origin, token: server.auth.access.tokens[0].token });
  const question = '想借书应该拿什么证件？请只根据提供的虚拟学校资料回答。';
  const first = await client.send('north-reception', question, { messageId: 'rag-live-1' });
  assert.equal(first.task.status.state, 'TASK_STATE_COMPLETED', JSON.stringify(first.task.status));
  const answer = JSON.parse(first.task.artifacts[0].parts[0].text);
  assert(answer.sources.some((s) => s.documentId === 'library'));
  assert.match(answer.text, /校园卡/);
  assert.equal(
    (await client.send('north-reception', question, { messageId: 'rag-live-1' })).task.id,
    first.task.id,
  );
  assert.equal(calls, 1);
  const health = await fetch(server.origin + '/health').then((r) => r.json());
  assert.equal(health.knowledge, config.database.provider + '-pgvector');
  const general = await client.send(
    'north-reception',
    '请用一句话解释什么是开源软件。这是通用知识问题。',
    { messageId: 'rag-general-1' },
  );
  assert.equal(general.task.status.state, 'TASK_STATE_COMPLETED');
  const generalAnswer = JSON.parse(general.task.artifacts[0].parts[0].text);
  assert.equal(generalAnswer.basis, 'general');
  assert.match(generalAnswer.text, /源|代码/);
  const report = {
    at: new Date().toISOString(),
    kind: 'real-ONNX-PostgreSQL-pgvector-Hermes-A2A',
    database:
      config.database.provider === 'postgres'
        ? 'Native PostgreSQL TCP + pgvector'
        : 'PGlite embedded PostgreSQL + pgvector',
    embedding: 'BAAI/bge-small-zh-v1.5 ONNX CPU 512D',
    model: 'DeepSeek Flash via local Hermes',
    imported,
    topHit: { documentId: hits[0].documentId, score: hits[0].score },
    answer: answer.text,
    generalAnswer: generalAnswer.text,
    sources: answer.sources,
    checks: {
      realEmbeddings: true,
      realSQLVectorQuery: true,
      persistentDatabase: true,
      unpublishedExcluded: true,
      citedOwnImportedDocument: true,
      duplicateNoSecondModelCall: true,
    },
    limits: [
      'Original fictional corpus; not real school verification',
      ...(config.database.provider === 'postgres'
        ? ['Dedicated test database; target production server not tested']
        : ['External PostgreSQL TCP server not tested by this script']),
    ],
  };
  await mkdir('qa', { recursive: true });
  await writeFile(
    config.database.provider === 'postgres'
      ? 'qa/knowledge-native-model-live.json'
      : 'qa/knowledge-live.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await server?.close();
  await kb?.close();
  await rm(dir, { recursive: true, force: true });
}
