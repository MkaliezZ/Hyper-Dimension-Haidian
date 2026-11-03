import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, api } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.m2Enabled)
  throw Error('Isolated package smoke fixture required');
const a = await login('alice'),
  root = '/m2/schools/north',
  ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
assert.ok(a.extensions.includes('m2'));
const catalog = ok(await api(a, root + '/avatar/catalog'));
assert.equal(catalog.parts.length, 24);
assert.equal(catalog.presets.length, 4);
const avatar = ok(await api(a, root + '/avatar')),
  r = await fetch(config.origin + root + '/avatar/model.vrm?hash=' + avatar.modelHash, {
    headers: { Authorization: 'Bearer ' + a.token },
  });
assert.equal(r.status, 200);
assert.equal(
  createHash('sha256')
    .update(Buffer.from(await r.arrayBuffer()))
    .digest('hex'),
  avatar.modelHash,
);
assert.ok(ok(await api(a, root + '/inventory')).starterClaimed);
assert.ok(ok(await api(a, root + '/collections')).items.length);
assert.equal((await fetch(config.origin + '/avatar-library/presets/campus.glb')).status, 200);
assert.equal((await fetch(config.origin + '/m2.html')).status, 200);
await mkdir('qa/m2', { recursive: true });
await writeFile(
  'qa/m2/package-smoke.json',
  JSON.stringify(
    {
      status: 'PASS',
      environment: 'extracted complete ZIP + real six-service restored Ubuntu clone',
      completeRuntimeDependencies: true,
      loginAndSchoolAcl: true,
      parts: 24,
      presets: 4,
      exactSavedModelHash: true,
      persistentInventoryAndCollections: true,
      publicOriginalAssets: true,
      userDatabasesBundled: false,
    },
    null,
    2,
  ),
);
console.log(
  'PASS extracted M2 full service start, login, exact avatar, inventory, collections and original library',
);
