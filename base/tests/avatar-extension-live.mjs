import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, fixtures, login, api, call, admin } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.m2Enabled)
  throw Error('Isolated fictitious M2 fixture required');
const checks = [],
  root = '/m2/schools/north/avatar',
  run = randomUUID().slice(0, 8),
  started = Date.now();
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const owner = await login('moda');
async function createFixture(suffix) {
  const username = 'avatar-v2-' + run + '-' + suffix,
    email = username + '@m1.invalid',
    password = 'Avatar-fixture-' + randomUUID();
  await admin('users', 'POST', {
    username,
    email,
    emailVerified: true,
    enabled: true,
    firstName: 'Avatar',
    lastName: 'Fixture',
    credentials: [{ type: 'password', value: password, temporary: false }],
  });
  const fixture = { username, credentials: [{ value: password }] };
  fixtures.push(fixture);
  const user = await login(username);
  const invitation = ok(
    await api(owner, '/m1/schools/north/invitations', {
      requestId: randomUUID(),
      email,
      role: 'student',
    }),
  );
  ok(await api(user, '/m1/invitations/accept', { token: invitation.token }));
  const state = ok(await api(user, root));
  const saved = ok(
    await api(user, root, {
      requestId: randomUUID(),
      expectedVersion: state.version,
      recipe: state.recipe,
      catalogHash: state.catalogHash,
    }),
  );
  return { fixture, user, saved };
}
const first = await createFixture('live'),
  browserFixture = await createFixture('browser'),
  a = first.user;
await mkdir('.local', { recursive: true });
await writeFile(
  '.local/avatar-extension-qa-users.json',
  JSON.stringify([browserFixture.fixture], null, 2),
);
await writeFile(
  '.local/avatar-extension-qa-config.json',
  JSON.stringify({ origin: config.origin, m2Enabled: true }, null, 2),
);
let before = first.saved,
  after,
  request;
await test('v1 saved model remains byte-identical; v2 catalogs and all added paths are available', async () => {
  assert.equal(before.recipe.catalogVersion, 'campus-original-1');
  assert.equal(ok(await api(a, root + '/catalog')).parts.length, 24);
  const c = ok(await api(a, root + '/catalog?version=campus-original-2'));
  assert.equal(c.parts.length, 38);
  for (const part of c.parts) {
    const r = await fetch(config.origin + part.asset);
    assert.equal(r.status, 200);
    assert.equal(sha(Buffer.from(await r.arrayBuffer())), part.sha256);
  }
  const old = await fetch(config.origin + root + '/model.glb', {
    headers: { Authorization: 'Bearer ' + a.token },
  });
  assert.equal(old.status, 200);
  assert.equal(sha(Buffer.from(await old.arrayBuffer())), before.modelHash);
  const recipe = structuredClone(c.defaultRecipe);
  Object.assign(recipe.parts, {
    hair: 'hair-braids',
    top: 'top-vest',
    bottom: 'bottom-cargo',
    shoes: 'shoes-boots',
    glasses: 'glasses-oval',
    accessory: 'accessory-backpack',
  });
  request = {
    requestId: randomUUID(),
    expectedVersion: before.version,
    recipe,
    catalogHash: c.catalogHash,
    upgradeFrom: {
      catalogVersion: before.recipe.catalogVersion,
      catalogHash: before.catalogHash,
      modelHash: before.modelHash,
    },
  };
  const preview = await fetch(config.origin + root + '/preview', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + a.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(recipe),
  });
  assert.equal(preview.status, 200);
  assert.equal(ok(await api(a, root)).modelHash, before.modelHash);
  assert.equal((await api(a, root + '/catalog?version=unknown')).status, 409);
});
await test('missing, stale or incorrect explicit upgrade proofs fail without changing the old save', async () => {
  const { upgradeFrom, ...unconfirmed } = request;
  for (const input of [
    unconfirmed,
    { ...request, upgradeFrom: { ...upgradeFrom, modelHash: 'stale' } },
    { ...request, upgradeFrom: { ...upgradeFrom, catalogHash: 'stale' } },
    { ...request, catalogHash: before.catalogHash },
  ]) {
    assert.equal((await api(a, root, input)).status, 409);
    assert.equal(ok(await api(a, root)).modelHash, before.modelHash);
  }
});
await test('explicit upgrade commits once, CAS protects races and old recipe remains rebuildable', async () => {
  const alternative = { ...request, requestId: randomUUID() };
  const race = await Promise.all([api(a, root, request), api(a, root, alternative)]);
  assert.deepEqual(race.map((x) => x.status).sort(), [200, 409]);
  const winning = race[0].status === 200 ? request : alternative;
  after = ok(race.find((x) => x.status === 200));
  assert.equal(after.recipe.catalogVersion, 'campus-original-2');
  assert.equal(after.version, before.version + 1);
  assert.deepEqual(ok(await api(a, root, winning)), after);
  assert.equal((await api(a, root, { ...winning, expectedVersion: after.version })).status, 409);
  const history = ok(await api(a, root + '/history')).entries;
  assert.equal(history.length, 2);
  assert.equal(history[1].model_hash, before.modelHash);
  assert.equal(history[0].source, 'catalog-upgrade:campus-original-1');
  const old = await fetch(config.origin + root + '/preview', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + a.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(history[1].recipe),
  });
  assert.equal(old.status, 200);
  assert.equal(sha(Buffer.from(await old.arrayBuffer())), before.modelHash);
  const r = await fetch(config.origin + root + '/model.glb?hash=' + after.modelHash, {
    headers: { Authorization: 'Bearer ' + a.token },
  });
  assert.equal(r.status, 200);
  assert.equal(sha(Buffer.from(await r.arrayBuffer())), after.modelHash);
  assert.equal(
    (
      await api(a, root, {
        requestId: randomUUID(),
        expectedVersion: after.version,
        recipe: before.recipe,
        catalogHash: before.catalogHash,
        upgradeFrom: {
          catalogVersion: after.recipe.catalogVersion,
          catalogHash: after.catalogHash,
          modelHash: after.modelHash,
        },
      })
    ).status,
    409,
  );
  assert.equal(ok(await api(a, root)).modelHash, after.modelHash);
});
await test('fresh login restores the v2 recipe, while another account cannot read it', async () => {
  const fresh = await login(first.fixture.username);
  const state = ok(await api(fresh, root));
  assert.equal(state.modelHash, after.modelHash);
  assert.deepEqual(state.recipe, after.recipe);
  assert.equal((await api(browserFixture.user, root + '?userId=' + a.userId)).status, 403);
  assert.equal((await call(config.origin + root)).status, 401);
  assert.equal(ok(await api(browserFixture.user, root)).modelHash, browserFixture.saved.modelHash);
});
await mkdir('qa/avatar-extension', { recursive: true });
await writeFile(
  'qa/avatar-extension/live.json',
  JSON.stringify(
    {
      status: 'PASS',
      checks,
      durationMs: Date.now() - started,
      oldModelHash: before.modelHash,
      newModelHash: after.modelHash,
      newCatalogHash: after.catalogHash,
      dedicatedFixtureUserId: a.userId,
    },
    null,
    2,
  ),
);
