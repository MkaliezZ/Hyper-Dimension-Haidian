import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openKnowledge, prepareDocuments } from '../src/knowledge/index.mjs';
import { createReception } from '../src/reception/index.mjs';
import { exampleScene, packageFor } from '../tools/fixtures.mjs';
const principal = { id: 'test', spaces: ['north'], scopes: ['a2a:call', 'public:read'] };
test('PGlite/pgvector storage persists, scopes schools, replaces atomically and excludes unpublished input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hd-kb-'));
  let kb,
    broken = false;
  const seen = [];
  const embedding = {
    identity: 'fixture-embedding-v1',
    model: 'explicit-test-double',
    dimensions: 3,
    async embed(texts) {
      seen.push(...texts);
      if (broken) return texts.map(() => [1, 0]);
      return texts.map((t) => (t.includes('借') || t.includes('证件') ? [1, 0, 0] : [0, 1, 0]));
    },
  };
  const config = { database: { provider: 'pglite' }, embedding: {}, minScore: 0.5 };
  const input = [
    { id: 'borrow', title: '图书借阅', body: '借书须出示校园卡。', published: true, revision: 1 },
    { id: 'secret', published: false, body: 'PRIVATE_KB_DO_NOT_EMBED' },
  ];
  try {
    kb = await openKnowledge({ dataDir: dir, config, embedding, migrate: true });
    assert.equal((await kb.import('north', input)).excluded, 1);
    assert(!seen.join('').includes('PRIVATE_KB'));
    const calls = seen.length;
    assert.equal((await kb.import('north', input)).reused, true);
    assert.equal(seen.length, calls);
    await kb.import('south', [
      { id: 'borrow', title: '南校借阅', body: '借阅用南校内部凭据。', published: true },
    ]);
    const pack = packageFor(exampleScene(), 'north', '北岸');
    const rows = await kb.retrieve(pack, principal, '借书证件');
    assert.equal(rows[0].body, '借书须出示校园卡。');
    assert(!JSON.stringify(rows).includes('南校'));
    await assert.rejects(kb.retrieve({ spaceId: 'south' }, principal, '借阅'), /permission/);
    const source = rows[0].id;
    await assert.rejects(
      kb.import('north', [{ id: 'new', title: '新的', body: '新内容', published: true }]),
      /Different index/,
    );
    assert.equal((await kb.status('north')).chunks, 1);
    broken = true;
    await assert.rejects(
      kb.import('north', [{ ...input[0], body: '借书须使用新卡。' }], { replace: true }),
      /dimensions mismatch/,
    );
    broken = false;
    assert.equal((await kb.retrieve(pack, principal, '借书'))[0].body, '借书须出示校园卡。');
    await kb.close();
    kb = await openKnowledge({ dataDir: dir, config, embedding });
    assert.equal((await kb.retrieve(pack, principal, '借书'))[0].id, source);
    await kb.import('north', [{ id: 'borrow', published: false }], { replace: true });
    assert.equal((await kb.status('north')).chunks, 0);
    assert.equal(await kb.hasSources('north', [source]), false);
    assert.equal((await kb.status('south')).chunks, 1);
    await assert.rejects(openKnowledge({ dataDir: dir, config, embedding }), /database is open/);
  } finally {
    await kb?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('Chunk metadata and source gates preserve published-only authority, including withdrawn history', async () => {
  const prepared = prepareDocuments([
    { id: 'manual', title: '手册', body: '甲'.repeat(800), published: true, revision: 2 },
  ]);
  assert(prepared.chunks.length > 1);
  assert(prepared.chunks.every((c) => c.body.length <= 350 && c.id.length <= 128));
  const pack = packageFor(exampleScene(), 'north', '北岸');
  let prompt;
  const knowledge = {
    async hasSources(spaceId, ids) {
      return ids.every((id) => id === 'kb:manual:0');
    },
    async retrieve() {
      return [
        {
          id: 'kb:manual:0',
          title: '借阅规则',
          body: '借书须出示校园卡',
          revision: 2,
          documentId: 'manual',
          sourceLabel: '学生手册',
        },
      ];
    },
  };
  const provider = Object.assign(
    async (input) => {
      prompt = input;
      return { answer: '借书请带校园卡。', kind: 'space', sourceIds: ['kb:manual:0'] };
    },
    { general: true },
  );
  const result = await createReception({ provider, knowledge }).answer({
    pack,
    principal,
    message: '需要什么证件？',
    history: [{ role: 'assistant', text: '撤回资料中的旧内容', sourceIds: ['kb:withdrawn:0'] }],
  });
  assert.equal(result.sources[0].documentId, 'manual');
  assert(!JSON.stringify(prompt).includes('撤回资料'));
});
