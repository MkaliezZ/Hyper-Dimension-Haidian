import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from '@a2a-js/sdk/client';
import { config, api, login } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Isolated fixture only');
const path = (process.env.HD_INTEGRATION_PRIVATE || '.local') + '/business-restart.json',
  saved = JSON.parse(await readFile(path, 'utf8'));
if (!saved.fixtureOnly || saved.origin !== config.origin) throw Error('Wrong fixture receipt');
const auth = (url, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer ' + saved.token);
  return fetch(url, { ...init, headers });
};
const factory = new ClientFactory(
  ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    cardResolver: new DefaultAgentCardResolver({ fetchImpl: auth }),
    transports: [new JsonRpcTransportFactory({ fetchImpl: auth })],
  }),
);
const client = await factory.createFromUrl(
  config.origin,
  '/agents/' + saved.agentId + '/.well-known/agent-card.json',
);
const task = await client.getTask({ id: saved.a2aTaskId });
const result = JSON.parse(task.artifacts[0].parts[0].content.value);
assert.equal(result.data.taskId, saved.businessTaskId);
assert.equal(result.data.status, 'cancelled');
const user = await login('alice');
assert.equal(
  (
    await api(user, '/agent-business/schools/north/delegations/' + saved.delegationId + '/revoke', {
      requestId: randomUUID(),
    })
  ).status,
  200,
);
await assert.rejects(client.getTask({ id: saved.a2aTaskId }));
await unlink(path);
const output = process.env.HD_INTEGRATION_EVIDENCE || 'evidence/integrations';
await mkdir(output, { recursive: true });
await writeFile(
  output + '/business-a2a-restart.json',
  JSON.stringify(
    {
      status: 'PASS',
      fixtureOnly: true,
      checks: [
        'delegation authentication after actual Base restart',
        'same durable A2A task and business cancellation receipt',
        'post-restart revocation enforced',
      ],
      temporarySecretRemoved: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'PASS actual restart retained delegation, A2A task and business receipt; temporary grant revoked and secret file removed',
);
