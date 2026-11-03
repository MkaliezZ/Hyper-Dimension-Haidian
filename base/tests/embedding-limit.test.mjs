import test from 'node:test';
import assert from 'node:assert/strict';
import { limitEmbedding } from '../src/knowledge/limit.mjs';
test('Embedding bursts stay bounded; canceled waiting work does not spawn or leak a slot', async () => {
  let active = 0,
    peak = 0;
  const executed = [],
    releases = [];
  const embed = limitEmbedding(
    async (value) => {
      active++;
      peak = Math.max(peak, active);
      executed.push(value);
      await new Promise((r) => releases.push(r));
      active--;
      return value;
    },
    { concurrency: 2, maxQueued: 2 },
  );
  const a = embed('a'),
    b = embed('b'),
    controller = new AbortController(),
    c = embed('c', { signal: controller.signal }),
    d = embed('d');
  await assert.rejects(embed('over-capacity'), { code: 'embedding_busy' });
  controller.abort(Error('cancel queued'));
  await assert.rejects(c, /cancel queued/);
  releases.shift()();
  await a;
  await new Promise((r) => setImmediate(r));
  releases.shift()();
  await b;
  releases.shift()();
  await d;
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.deepEqual(executed, ['a', 'b', 'd']);
  const e = embed('after');
  releases.shift()();
  assert.equal(await e, 'after');
});
