import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { config, login, api } from './m1-helpers.mjs';

if (
  process.platform !== 'linux' ||
  process.env.HD_M1_TEST_FIXTURE !== '1' ||
  !new URL(config.databaseUrl).pathname.includes('hdnetworkzip')
)
  throw Error('Dedicated Ubuntu ZIP fixture only');
const fixture = JSON.parse(await readFile(process.env.HD_CONTAINER_BACKUP_SESSION, 'utf8'));
const alice = await login('alice');
const path = '/api/spaces/north/reception-sessions/' + fixture.contextId;
const before = await api(alice, path + '/export');
assert.equal(before.status, 200);
assert(JSON.stringify(before.data).includes(fixture.marker));
const response = await api(alice, '/api/spaces/north/reception', {
  messageId: randomUUID(),
  contextId: fixture.contextId,
  message: '请复述当前会话里我给出的完整备份测试口令；没有提供则说明不知道。',
});
assert.equal(response.status, 200);
assert(!response.data.error, JSON.stringify(response.data.error));
const task = response.data.result.task;
assert.equal(task.status.state, 'TASK_STATE_COMPLETED');
const answer = JSON.parse(task.artifacts[0].parts[0].text);
assert.equal(answer.provider, 'hermes');
assert.equal(answer.mode, 'live-model');
assert(answer.text.includes(fixture.marker));
const after = await api(alice, path + '/export');
assert.equal(after.status, 200);
assert.equal(after.data.turns.length, before.data.turns.length + 1);
const deleted = await api(alice, path + '/delete', {
  requestId: randomUUID(),
  expectedRevision: after.data.session.revision,
});
assert.equal(deleted.status, 200);
assert.equal((await api(alice, path + '/export')).status, 410);
const out = process.env.HD_CONTAINER_EVIDENCE || '/runtime/evidence/ubuntu-hermes';
await mkdir(out, { recursive: true });
await writeFile(
  out + '/final-archive-model-smoke.json',
  JSON.stringify(
    {
      status: 'PASS',
      at: new Date().toISOString(),
      realModelCalls: 1,
      provider: 'Ubuntu container Hermes with online DeepSeek',
      priorRealSessionRecalledAfterImageReplacement: true,
      sameOwnerBearerExport: true,
      exportAndDelete: true,
      source: 'Current extracted delivery ZIP image; private fictitious fixture only',
    },
    null,
    2,
  ) + '\n',
);
console.log('PASS final ZIP image real Hermes recall, account export and deletion');
