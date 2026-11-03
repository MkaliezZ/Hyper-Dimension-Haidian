import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { config, fixtures, login, api, admin } from './m1-helpers.mjs';
const owner = await login('moda'),
  alice = await login('alice'),
  path = '/m1/schools/north',
  results = [];
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const token = ok(
  await api(owner, path + '/invitations', {
    requestId: randomUUID(),
    email: 'moda@m0.invalid',
    role: 'student',
  }),
).token;
assert.equal((await api(owner, '/m1/invitations/accept', { token })).status, 409);
ok(await api(owner, path + '/members'));
results.push({
  name: 'invitation cannot downgrade existing owner or reactivate an existing membership',
  status: 'PASS',
});
const i = ok(
  await api(owner, path + '/invitations', {
    requestId: randomUUID(),
    email: 'alice@m0.invalid',
    role: 'student',
  }),
);
const f = fixtures.find((x) => x.username === 'alice'),
  before = await admin('users/' + f.id);
try {
  await admin('users/' + f.id, 'PUT', {
    ...before,
    email: 'changed-' + randomUUID().slice(0, 8) + '@m1.invalid',
    emailVerified: true,
  });
  assert.equal((await api(alice, '/m1/invitations/accept', { token: i.token })).status, 403);
} finally {
  await admin('users/' + f.id, 'PUT', before);
  await login('alice');
}
results.push({
  name: 'old signed token email cannot accept invitation after current IdP email changed',
  status: 'PASS',
});
await writeFile(
  'qa/m1/permission-regression.json',
  JSON.stringify({ kind: 'real IdP and PostgreSQL authorization regressions', results }, null, 2) +
    '\n',
);
console.log('PASS invitation lifecycle and current email regression');
