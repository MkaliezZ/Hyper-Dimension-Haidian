import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import pg from 'pg';
import { config, login, api } from './m1-helpers.mjs';
if (
  process.platform !== 'linux' ||
  process.env.HD_M1_TEST_FIXTURE !== '1' ||
  !new URL(config.databaseUrl).pathname.includes('hdnetworkzip')
)
  throw Error('New fictitious Ubuntu ZIP stack only');
const out = process.env.HD_CONTAINER_EVIDENCE || '/runtime/evidence/ubuntu-hermes';
await mkdir(out, { recursive: true });
const manifest = JSON.parse(await readFile('PACKAGE-MANIFEST.json', 'utf8'));
assert.equal(manifest.extension.version, '0.8.3');
const checked = [];
for (const path of [
  'src/server.mjs',
  'src/platform/index.mjs',
  'src/a2a/gateway.mjs',
  'src/reception/hermes.mjs',
  'src/reception/hermes_bridge.py',
  'src/reception/sessions.mjs',
  'public/app.js',
  'public/reception-sessions.js',
  'public/network.js',
  'public/admin/app.js',
  'deploy/entry.mjs',
  'deploy/reception-env.mjs',
  'database/campus-network-001.sql',
]) {
  const file = manifest.files.find((f) => f.path === path);
  assert(file, path);
  assert.equal(
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
    file.sha256,
    path,
  );
  checked.push(path);
}
const health = await (await fetch(config.origin + '/health')).json();
assert.equal(health.receptionProvider, 'hermes');
assert.equal(health.generalConversation, true);
const owner = await login('moda'),
  alice = await login('alice'),
  bob = await login('bob');
assert.equal((await api(owner, '/m0/me')).status, 200);
assert.equal((await api(alice, '/api/spaces/south/scene')).status, 403);
for (const page of [
  '/m1.html',
  '/m2.html',
  '/community.html',
  '/ranking.html',
  '/partners.html',
  '/network.html',
  '/annual.html',
  '/reception-admin.html',
  '/delegations.html',
  '/public-does-not-exist',
]) {
  const r = await fetch(config.origin + page);
  assert.equal(r.status, page.endsWith('does-not-exist') ? 404 : 200, page);
}
for (const path of [
  '/m2/schools/north/avatar/catalog',
  '/community/schools/north/home',
  '/network/schools/north/bootstrap',
  '/m5/schools/north/directory',
  '/reception-admin/schools/north/status',
]) {
  const r = await api(owner, path);
  assert.equal(r.status, 200, path + ': ' + JSON.stringify(r.data));
}
assert.equal((await api(bob, '/network/schools/north/directory')).status, 403);
const python = spawnSync(
  '/opt/hermes/.venv/bin/python',
  [
    '-c',
    'import sys,json,importlib.metadata as m; print(json.dumps({"python":sys.version.split()[0],"hermes":m.version("hermes-agent"),"openai":m.version("openai")}))',
  ],
  { encoding: 'utf8' },
);
assert.equal(python.status, 0, python.stderr);
const runtime = JSON.parse(python.stdout);
assert(runtime.python.startsWith('3.13.'));
assert.equal(runtime.hermes, '0.19.1');
const report = {
  status: 'PASS',
  at: new Date().toISOString(),
  archiveVersion: manifest.extension.version,
  testedSourceHashes: checked,
  runtime,
  formalOidcAndSchoolAcl: 'PASS',
  fourBaseFrontendAssetsAndBackendRoutes: 'PASS',
  actualHermesHealth: 'PASS',
  serverIdentity: 'Keycloak, no injected provider or simulated auth',
};
if (process.env.HD_DELETED_SESSION_CASE) {
  const fixture = JSON.parse(await readFile(process.env.HD_DELETED_SESSION_CASE, 'utf8'));
  const db = new pg.Client({ connectionString: config.databaseUrl });
  try {
    await db.connect();
    const current = (await db.query('SELECT state FROM hd_runtime_state WHERE singleton')).rows[0]
      .state;
    assert(!JSON.stringify(current).includes(fixture.marker));
  } finally {
    await db.end();
  }
  async function scan(path) {
    for (const e of await readdir(path, { withFileTypes: true })) {
      const p = join(path, e.name);
      if (e.isDirectory()) await scan(p);
      else if (e.isFile())
        assert(
          !(await readFile(p)).includes(Buffer.from(fixture.marker)),
          'Deleted marker remains in ' + e.name,
        );
    }
  }
  await scan(join(config.dataDir, 'hermes-reception'));
  report.deletedCurrentPgSnapshotAndHermesFiles = 'PASS';
}
await writeFile(out + '/container-package-live.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  'PASS package-bound source, four Base frontend/backend, actual OIDC/school ACL and container Hermes runtime',
);
