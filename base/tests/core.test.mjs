import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exampleScene, packageFor } from '../tools/fixtures.mjs';
import { validatePackage, identifier, digest } from '../src/protocol/index.mjs';
import { createNavigation, positionAt, roomPoint } from '../src/spatial/building.mjs';
import { makeGlb } from '../src/spatial/model.mjs';
import { openStore } from '../src/core/store.mjs';
import { createReception } from '../src/reception/index.mjs';
const principal = { id: 'test', spaces: ['north'], scopes: ['public:read', 'a2a:call'] };
test('Versioned packages preserve stable identities and reject prototype names', () => {
  const p = packageFor(exampleScene(), 'north', '北岸');
  assert.equal(validatePackage(p).spaceId, 'north');
  for (const id of ['__proto__', 'constructor', 'prototype']) assert.throws(() => identifier(id));
  assert.throws(() => validatePackage({ ...p, baseVersion: '99' }));
  assert.throws(() => validatePackage({ ...p, agents: [...p.agents, ...p.agents] }));
});
test('One geometry produces repeatable GLB and routes around holes through stairs', () => {
  const s = exampleScene(),
    nav = createNavigation(s),
    a = { levelId: 'L1', point: [-3, 0, 10] },
    r = s.levels[1].rooms[0],
    p = roomPoint(r),
    b = { levelId: 'L2', point: [p[0], 3.6, p[1]] };
  const route = nav.route(a, b);
  assert(route.path.some((p) => p.connectorId));
  assert.equal(route.geometryHash, digest(s));
  assert(!nav.isWalkable({ levelId: 'L2', point: [10, 3.6, 11] }));
  assert.throws(() => nav.route(a, { levelId: 'L2', point: [10, 0, 11] }));
  const glb = makeGlb(s);
  assert.deepEqual(glb, makeGlb(s));
  assert.equal(glb.readUInt32LE(8), glb.length);
  assert.equal(
    JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12))).extras.geometryHash,
    route.geometryHash,
  );
  const m = { ...route, startedAt: 1000, speed: 4 };
  assert.equal(positionAt(m, 0).moving, true);
  assert.equal(positionAt(m, 100000).moving, false);
});
test('Durable receipts survive restart, conflicts do not repeat effects, single writer enforced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hd-base-core-'));
  let store;
  try {
    store = await openStore(dir);
    await assert.rejects(openStore(dir), /locked/);
    const once = () =>
      store.command(principal, 'north', 'request-a', { x: 1 }, (d) => {
        d.counter = (d.counter || 0) + 1;
        return { count: d.counter };
      });
    assert.equal((await once()).count, 1);
    assert.equal((await once()).replayed, true);
    await assert.rejects(
      store.command(principal, 'north', 'request-a', { x: 2 }, () => ({})),
      /cannot change/,
    );
    await store.close();
    store = await openStore(dir);
    assert.equal(store.read().counter, 1);
    assert.equal((await once()).count, 1);
  } finally {
    await store?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('Reception never sends unpublished records to an injected model; no fake live mode', async () => {
  const pack = packageFor(exampleScene(), 'north', '北岸');
  let calls = 0;
  const live = createReception({
    provider: async (input) => {
      calls++;
      assert(!JSON.stringify(input).includes('PRIVATE_FIXTURE'));
      return { answer: '项目展厅在一层北侧。', sourceIds: ['gallery'], model: 'test-double' };
    },
  });
  assert.equal(live.live, true);
  const result = await live.answer({ pack, principal, message: '项目展览在哪里' });
  assert.equal(result.sources[0].id, 'gallery');
  assert.equal(calls, 1);
  const rule = await createReception().answer({ pack, principal, message: '项目展览' });
  assert.equal(rule.mode, 'knowledge-only');
  const unknown = await live.answer({ pack, principal, message: 'xyzzyundefined' });
  assert.equal(unknown.unknown, true);
  assert.equal(calls, 1);
  await assert.rejects(
    createReception({
      provider: async () => ({ answer: '骗造答案', sourceIds: ['private-note'] }),
    }).answer({ pack, principal, message: '项目展览' }),
    /published-source/,
  );
});
