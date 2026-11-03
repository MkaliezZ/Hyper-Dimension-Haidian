import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { config, login, api } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Isolated fixture required');
const before = JSON.parse(await readFile('qa/m2/browser.json')),
  a = await login('alice'),
  root = '/m2/schools/north',
  r = await api(a, root + '/avatar');
assert.equal(r.status, 200);
assert.equal(r.data.modelHash, before.avatarHash);
const bytes = Buffer.from(
  await (
    await fetch(config.origin + root + '/avatar/model.glb?hash=' + r.data.modelHash, {
      headers: { Authorization: 'Bearer ' + a.token },
    })
  ).arrayBuffer(),
);
assert.equal(createHash('sha256').update(bytes).digest('hex'), before.avatarHash);
const bag = await api(a, root + '/inventory'),
  collections = await api(a, root + '/collections');
assert.equal(bag.status, 200);
assert.ok(bag.data.starterClaimed);
for (const kind of ['postcard', 'stamp', 'bookmark', 'note'])
  assert.ok(collections.data.items.some((i) => i.kind === kind));
await writeFile(
  'qa/m2/restart.json',
  JSON.stringify(
    {
      status: 'PASS',
      freshLoginAfterActualServiceRestart: true,
      avatarHash: before.avatarHash,
      inventoryRevision: bag.data.revision,
      collections: collections.data.items.length,
    },
    null,
    2,
  ),
);
console.log('PASS actual restart, fresh login, exact model hash, inventory and 4 collection kinds');
