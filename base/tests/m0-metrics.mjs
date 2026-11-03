import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cpus, totalmem, platform, release } from 'node:os';
import assert from 'node:assert/strict';
const c = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8')),
  users = JSON.parse(await readFile(process.env.HD_M0_USERS, 'utf8')),
  u = users.find((u) => u.username === 'alice');
const response = await fetch(c.issuer + '/protocol/openid-connect/token', {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'password',
    client_id: c.clientId,
    username: u.username,
    password: u.credentials[0].value,
  }),
});
assert.equal(response.status, 200);
const { access_token: token } = await response.json();
const times = [];
let count = 0;
async function worker() {
  while (count < 50) {
    count++;
    const t = performance.now(),
      r = await fetch(c.origin + '/m0/schools/north/avatar', {
        headers: { Authorization: 'Bearer ' + token },
      });
    assert.equal(r.status, 200);
    await r.json();
    times.push(performance.now() - t);
  }
}
await fetch(c.origin + '/m0/schools/north/avatar', {
  headers: { Authorization: 'Bearer ' + token },
});
await Promise.all(Array.from({ length: 5 }, worker));
times.sort((a, b) => a - b);
const p95 = times[Math.ceil(times.length * 0.95) - 1];
const result = {
  kind: 'local-warm-read-budget',
  environment: {
    platform: platform(),
    release: release(),
    node: process.version,
    cpu: cpus()[0].model,
    logicalCpus: cpus().length,
    ramBytes: totalmem(),
  },
  samples: times.length,
  concurrency: 5,
  p50Ms: times[24],
  p95Ms: p95,
  maxMs: times.at(-1),
  budgetP95Ms: 500,
  status: p95 <= 500 ? 'PASS' : 'FAIL',
  limits:
    'Two fictional schools, five fixture identities, local WSL. Not a production capacity or GPU benchmark.',
};
await mkdir('qa/m0', { recursive: true });
await writeFile('qa/m0/metrics.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
assert.ok(p95 <= 500, 'Local warm API P95 exceeded the fixed M0 budget');
