import test from 'node:test';
import assert from 'node:assert/strict';
import { directoryDocument } from '../src/platform/network.mjs';
test('Discovery accepts only deliberate bounded public fields, rejects private-field copying and unknown identity labels', () => {
  const doc = {
    name: '测试校友',
    kind: 'alumni',
    bio: '本人自愿提供的校园支持介绍',
    tags: ['迎新', '迎新'],
    mentor: true,
  };
  assert.deepEqual(directoryDocument(doc).tags, ['迎新']);
  for (const change of [
    { email: 'private@example.com' },
    { phone: 'private' },
    { kind: 'verified-alumni' },
    { mentor: 'yes' },
    { tags: new Array(13).fill('tag') },
    { bio: 'x' },
    { name: 'x'.repeat(81) },
  ])
    assert.throws(() => directoryDocument({ ...doc, ...change }));
  assert.equal(doc.tags.length, 2, 'Validation must not mutate the caller object');
});
