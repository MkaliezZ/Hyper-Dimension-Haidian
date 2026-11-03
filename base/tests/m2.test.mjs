import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { defaultRecipe, validateM2, migrateLegacy, presets } from '../src/avatar/catalog-m2.mjs';
import { avatarM2, avatarM2Hash, catalogM2 } from '../src/avatar/model-m2.mjs';
import { defaultRecipe as legacy } from '../src/avatar/model.mjs';
const gltf = (b) => JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()),
  sha = (b) => createHash('sha256').update(b).digest('hex');
test('M2: all 24 original part files match catalog integrity, license and shared skeleton', async () => {
  const c = catalogM2();
  assert.equal(c.parts.length, 24);
  assert.equal(new Set(c.parts.map((p) => p.id)).size, 24);
  for (const p of c.parts) {
    const b = await readFile(new URL('../assets/avatars/parts/' + p.id + '.glb', import.meta.url));
    assert.equal(sha(b), p.sha256);
    assert.equal(b.length, p.bytes);
    assert.equal(p.license, 'MIT');
    assert.equal(gltf(b).extras.skeletonVersion, c.skeletonVersion);
  }
});
test('M2: presets build deterministic VRM 1 avatars with 3 animations within the published budget', () => {
  const c = catalogM2();
  for (const p of presets) {
    const b = avatarM2(p.recipe),
      j = gltf(b);
    assert.equal(b.readUInt32LE(8), b.length);
    assert.equal(avatarM2Hash(p.recipe), sha(b));
    assert.deepEqual(
      j.animations.map((a) => a.name),
      ['Idle', 'Walk', 'Wave'],
    );
    assert.equal(j.extensions.VRMC_vrm.specVersion, '1.0');
    for (const key of ['hips', 'spine', 'head', 'leftHand', 'rightFoot'])
      assert.ok(j.extensions.VRMC_vrm.humanoid.humanBones[key]);
    assert.ok(j.extras.triangles <= c.budget.maxTriangles, j.extras.triangles);
    assert.ok(j.extras.drawCalls <= c.budget.maxDrawCalls, j.extras.drawCalls);
    assert.ok(b.length <= c.budget.maxGlbBytes, b.length);
  }
});
test('M2: part/shape/color changes affect saved hash; input key order and color case canonicalize', () => {
  const base = avatarM2Hash(defaultRecipe);
  for (const [key, value] of [
    ['height', 'tall'],
    ['skin', 'deep'],
    ['presentation', 'soft'],
  ]) {
    const r = { ...defaultRecipe, [key]: value };
    assert.notEqual(avatarM2Hash(r), base);
  }
  const r = structuredClone(defaultRecipe);
  r.parts.glasses = 'glasses-round';
  assert.notEqual(avatarM2Hash(r), base);
  const reversed = Object.fromEntries(Object.entries(defaultRecipe).reverse());
  assert.equal(avatarM2Hash(reversed), base);
});
test('M2: missing/foreign/versioned/incompatible parts and remote model injection fail closed', () => {
  for (const mutate of [
    (r) => (r.url = 'https://invalid/model.glb'),
    (r) => (r.catalogVersion = 'future'),
    (r) => (r.parts.hair = '../../secret'),
    (r) => delete r.parts.top,
    (r) => (r.colors.top = 'url(x)'),
    (r) => {
      r.parts.hair = 'hair-curly';
      r.parts.accessory = 'accessory-cap';
    },
    (r) => {
      r.parts.top = 'top-hoodie';
      r.parts.accessory = 'accessory-scarf';
    },
  ]) {
    const r = structuredClone(defaultRecipe);
    mutate(r);
    assert.throws(() => validateM2(r));
  }
});
test('M2: legacy migration creates independent valid recipe without modifying the legacy object', () => {
  const source = structuredClone(legacy),
    before = JSON.stringify(source);
  assert.equal(validateM2(migrateLegacy(source)).schema, 'hyper-dimension.avatar/v2');
  assert.equal(JSON.stringify(source), before);
});
