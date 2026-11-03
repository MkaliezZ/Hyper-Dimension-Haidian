import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { config, login, api } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.m2Enabled)
  throw Error('Isolated M2 fixture required');
const a = await login('alice'),
  root = '/m2/schools/north',
  ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  },
  checks = [];
let bag = ok(await api(a, root + '/inventory'));
bag = ok(
  await api(a, root + '/inventory/equip', {
    requestId: randomUUID(),
    expectedRevision: bag.revision,
    itemId: 'cheer-flag',
    equipped: true,
  }),
);
const scene = ok(await api(a, '/api/spaces/north/scene')),
  requestId = randomUUID(),
  wave = {
    requestId,
    expectedRevision: bag.revision,
    itemId: 'cheer-flag',
    action: 'wave',
    sceneId: scene.scene.sceneId,
  },
  equip = { requestId, expectedRevision: bag.revision, itemId: 'campus-map', equipped: true };
const rows = await Promise.all([
  api(a, root + '/inventory/use', wave),
  api(a, root + '/inventory/equip', equip),
]);
assert.deepEqual(rows.map((r) => r.status).sort(), [200, 409]);
assert.ok(rows.find((r) => r.status === 409).data.error.message.includes('request_conflict'));
assert.equal(ok(await api(a, root + '/inventory')).revision, bag.revision + 1);
checks.push(
  'different operation types racing the same receipt ID: one commit, one conflict, no 500 or duplicate effect',
);
bag = ok(await api(a, root + '/inventory'));
assert.equal(
  (
    await api(a, root + '/inventory/use', {
      ...wave,
      requestId: randomUUID(),
      expectedRevision: bag.revision,
      point: [999, 0, 999],
    })
  ).status,
  400,
);
checks.push('client position injection rejected');
const foreign = {
  ...wave,
  requestId: randomUUID(),
  expectedRevision: bag.revision,
  sceneId: 'south-hall',
};
await api(a, root + '/inventory/equip', {
  requestId: randomUUID(),
  expectedRevision: bag.revision,
  itemId: 'cheer-flag',
  equipped: true,
});
bag = ok(await api(a, root + '/inventory'));
foreign.expectedRevision = bag.revision;
assert.equal((await api(a, root + '/inventory/use', foreign)).status, 403);
checks.push('foreign scene denied without inventory mutation');
assert.equal(ok(await api(a, root + '/inventory')).revision, bag.revision);
await writeFile('qa/m2/negative.json', JSON.stringify({ status: 'PASS', checks }, null, 2));
console.log('PASS M2 cross-operation receipt race, forged position and foreign-scene rejection');
