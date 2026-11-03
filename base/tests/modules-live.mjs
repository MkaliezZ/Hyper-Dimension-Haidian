import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, call } from './m1-helpers.mjs';
import { createPlatform } from '../src/platform/index.mjs';
import { createServer } from 'node:http';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Isolated fixture required');
const u = await login('alice'),
  readonly = {
    ...config,
    origin: 'http://127.0.0.1:4982',
    modules: { base2: false, base3: false, base4: false },
  },
  checks = [];
let platform, server;
try {
  platform = await createPlatform(readonly);
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  server = createServer(async (req, res) => {
    try {
      const handled = await platform.handle(req, res, {
        url: new URL(req.url, readonly.origin),
        json,
        body: async (r) => {
          const chunks = [];
          for await (const chunk of r) chunks.push(chunk);
          return JSON.parse(Buffer.concat(chunks).toString() || '{}');
        },
      });
      if (!handled) json(res, 404, { error: { code: 'route_missing' } });
    } catch (e) {
      json(res, e.status || 500, { error: { code: e.code || 'test_router_error' } });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4982, '127.0.0.1', resolve);
  });
  for (const path of [
    '/m2/schools/north/avatar',
    '/community/schools/north/posts',
    '/activities/schools/north',
    '/ledger/schools/north/adjustments',
    '/rewards/schools/north',
    '/operations/schools/north',
    '/m5/schools/north/partners',
  ]) {
    const r = await call(readonly.origin + path, {
      token: u.token,
      body: { requestId: 'disabled-proof' },
    });
    assert.equal(r.status, 409, JSON.stringify(r));
    assert.equal(r.data.error.code, 'module_disabled');
  }
  checks.push({
    name: 'actual HTTP blocks disabled new writes across four Base extensions',
    status: 'PASS',
  });
  for (const path of [
    '/m2/schools/north/avatar',
    '/m2/schools/north/inventory',
    '/m0/schools/north/contributions',
    '/m0/me',
  ])
    assert.equal((await call(readonly.origin + path, { token: u.token })).status, 200, path);
  const me = (await call(readonly.origin + '/m0/me', { token: u.token })).data;
  assert.equal(me.schools.find((s) => s.school_id === 'north').modules.base3, false);
  checks.push({
    name: 'identity, saved avatar, inventory and contribution history remain readable with current ACL',
    status: 'PASS',
  });
  await mkdir('qa/campus', { recursive: true });
  await writeFile(
    'qa/campus/modules-live.json',
    JSON.stringify(
      {
        status: 'PASS',
        checks,
        scope:
          'platform HTTP router against synthetic campus clone; no second world runtime is acquired; scene behavior is outside this test',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS module switches ' + checks.length + ' groups');
} finally {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await platform?.close();
}
