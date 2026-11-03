import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { config, login, api } from './m1-helpers.mjs';
if (
  process.env.HD_M1_TEST_FIXTURE !== '1' ||
  !new URL(config.databaseUrl).pathname.includes('hdnetwork')
)
  throw Error('Isolated network fixture only');
const alice = await login('alice'),
  marker = 'RESTORE_RECEPTION_FIXTURE_' + randomUUID();
const r = await api(alice, '/api/spaces/north/reception', {
  message: marker + '，介绍建筑',
  messageId: randomUUID(),
});
assert.equal(r.status, 200, JSON.stringify(r.data));
assert(r.data.result?.task, 'A2A reception failed');
const dir = process.env.HD_NETWORK_EVIDENCE,
  old = JSON.parse(await readFile(dir + '/network-live.json', 'utf8'));
old.restoreSession = { owner: alice.userId, contextId: r.data.result.task.contextId, marker };
await writeFile(dir + '/network-live.json', JSON.stringify(old, null, 2) + '\n');
console.log('Retained one fictional reception session for the independent restore check');
