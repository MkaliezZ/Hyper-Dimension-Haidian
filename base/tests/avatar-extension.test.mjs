import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as original from '../src/avatar/model-m2.mjs';
import * as expanded from '../src/avatar/model-m2-v2.mjs';
import { defaultRecipe, parts, incompatible, validateM2 } from '../src/avatar/catalog-m2-v2.mjs';
import {
  avatarM2,
  avatarM2Hash,
  catalogM2,
  requireCatalogTransition,
} from '../src/avatar/library-m2.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex'),
  gltf = (b) => JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
const originalHashes = {
  campus: '07603131dd2ebbd5f708e8228ba97f9177982caa9502d21a7870dae7cf8f0cf1',
  library: '6703a5d4da927bd106beceb2e476378f7aa778f514a511c3b4151ad6edb0cdaf',
  sports: 'feaaaa4b11434a12e063acce178d86821229c63e5b32f4489e9d4adc5bad4b54',
  creative: 'cdd894a9e966d8feba01c68df0fc5dec734904ec3d4c9a956bdccd38a8be888f',
};
test('avatar extension preserves the published v1 catalog, every part and four exact model bytes', async () => {
  const c = original.catalogM2();
  assert.equal(c.catalogHash, '945bd70c4e68f3e63f61b6ad82e3b5994539cd4096dde97181b9b7926a3a9ba0');
  for (const p of c.parts) {
    const b = await readFile(new URL('../assets/avatars/parts/' + p.id + '.glb', import.meta.url));
    assert.equal(sha(b), p.sha256);
    assert.deepEqual(b, original.partM2(p.id));
  }
  for (const p of c.presets) {
    const b = avatarM2(p.recipe);
    assert.equal(sha(b), originalHashes[p.id]);
    assert.deepEqual(
      b,
      await readFile(new URL('../assets/avatars/presets/' + p.id + '.glb', import.meta.url)),
    );
  }
});
test('v2 has all planned original parts, licenses, immutable hashes and a shared humanoid skeleton', async () => {
  const c = expanded.catalogM2();
  assert.equal(c.parts.length, 38);
  assert.deepEqual(
    Object.fromEntries(
      ['body', 'hair', 'top', 'bottom', 'shoes', 'glasses', 'accessory'].map((slot) => [
        slot,
        c.parts.filter((p) => p.slot === slot && !p.id.endsWith('-none')).length,
      ]),
    ),
    { body: 3, hair: 8, top: 6, bottom: 6, shoes: 4, glasses: 3, accessory: 6 },
  );
  for (const p of c.parts) {
    const b = await readFile(
      new URL('../assets/avatars/v2/parts/' + p.id + '.glb', import.meta.url),
    );
    assert.equal(sha(b), p.sha256);
    assert.equal(b.length, p.bytes);
    assert.equal(p.license, 'MIT');
    assert.equal(gltf(b).extras.skeletonVersion, 'campus-humanoid-1');
    assert.equal(gltf(b).extensions.VRMC_vrm.meta.version, '2.0.0');
  }
  assert.deepEqual(
    JSON.parse(
      await readFile(new URL('../assets/avatars/v2/catalog.json', import.meta.url), 'utf8'),
    ),
    c,
  );
});
test('each v2 part and varied full models rebuild deterministically within the published budgets', () => {
  const c = expanded.catalogM2(),
    maximum = {};
  for (const p of parts) {
    const r = structuredClone(defaultRecipe);
    r.parts[p.slot] = p.id;
    const b = avatarM2(r),
      j = gltf(b),
      part = gltf(expanded.partM2(p.id));
    assert.equal(avatarM2Hash(r), sha(b));
    assert.ok(j.extras.triangles <= c.budget.maxTriangles);
    assert.ok(j.extras.drawCalls <= c.budget.maxDrawCalls);
    assert.ok(b.length <= c.budget.maxGlbBytes);
    maximum[p.slot] = Math.max(maximum[p.slot] || 0, part.extras.triangles);
  }
  // Geometry is additive per slot; even a conservative independent maximum must fit.
  assert.ok(
    Object.values(maximum).reduce((a, b) => a + b, 0) <= c.budget.maxTriangles,
    JSON.stringify(maximum),
  );
  for (const p of c.presets) {
    const b = avatarM2(p.recipe),
      j = gltf(b);
    assert.deepEqual(
      j.animations.map((a) => a.name),
      ['Idle', 'Walk', 'Wave'],
    );
    assert.equal(j.extensions.VRMC_vrm.specVersion, '1.0');
    assert.ok(j.extras.drawCalls <= 90);
    assert.ok(b.length <= 1600000);
  }
});
test('new geometry is distinct, and every declared incompatibility fails explicitly', () => {
  for (const [one, two] of [
    ['hair-short', 'hair-braids'],
    ['hair-short', 'hair-bun'],
    ['hair-short', 'hair-long'],
    ['top-tee', 'top-polo'],
    ['top-varsity', 'top-cardigan'],
    ['top-varsity', 'top-vest'],
    ['bottom-trousers', 'bottom-jeans'],
    ['bottom-trousers', 'bottom-cargo'],
    ['bottom-shorts', 'bottom-culottes'],
    ['shoes-high', 'shoes-boots'],
    ['glasses-round', 'glasses-oval'],
    ['accessory-satchel', 'accessory-backpack'],
  ]) {
    const geometry = (id) => {
      const b = expanded.partM2(id);
      return sha(b.subarray(28 + b.readUInt32LE(12)));
    };
    assert.notEqual(geometry(one), geometry(two), one + ' and ' + two);
  }
  for (const [a, b] of incompatible) {
    const r = structuredClone(defaultRecipe);
    for (const id of [a, b]) r.parts[parts.find((p) => p.id === id).slot] = id;
    assert.throws(() => validateM2(r), /avatar_incompatible_parts/);
  }
  const r = structuredClone(defaultRecipe);
  r.parts.hair = 'https://untrusted/model.vrm';
  assert.throws(() => validateM2(r), /avatar_part_unavailable/);
});
test('catalog upgrades require current explicit proof; v1 remains default, downgrade and unknown versions fail', () => {
  const old = catalogM2(),
    before = {
      recipe: old.defaultRecipe,
      catalogHash: old.catalogHash,
      modelHash: avatarM2Hash(old.defaultRecipe),
    };
  assert.equal(catalogM2().version, 'campus-original-1');
  assert.throws(() => requireCatalogTransition(before, defaultRecipe), /confirmation_required/);
  const proof = {
    catalogVersion: old.version,
    catalogHash: old.catalogHash,
    modelHash: before.modelHash,
  };
  assert.equal(requireCatalogTransition(before, defaultRecipe, proof), true);
  assert.throws(
    () => requireCatalogTransition(before, defaultRecipe, { ...proof, modelHash: 'stale' }),
    /confirmation_required/,
  );
  assert.throws(
    () => requireCatalogTransition({ recipe: defaultRecipe }, old.defaultRecipe, proof),
    /transition_unsupported/,
  );
  assert.throws(() => catalogM2('future'), /migration_required/);
});
