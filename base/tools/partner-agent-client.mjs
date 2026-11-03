import { readFile } from 'node:fs/promises';
import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
  DefaultAgentCardResolver,
} from '@a2a-js/sdk/client';
import { SendMessageRequest } from '@a2a-js/sdk';
import { randomUUID } from 'node:crypto';
import { EXTENSION } from '../src/protocol/index.mjs';
const token = process.env.HD_AGENT_TOKEN_FILE
  ? (await readFile(process.env.HD_AGENT_TOKEN_FILE, 'utf8')).trim()
  : process.env.HD_AGENT_TOKEN;
const origin = process.env.HD_AGENT_ORIGIN,
  agent = process.env.HD_AGENT_ID;
if (!token || !origin || !agent)
  throw Error(
    'Set private HD_AGENT_TOKEN_FILE (or HD_AGENT_TOKEN), HD_AGENT_ORIGIN and HD_AGENT_ID. No secret belongs in command-line arguments.',
  );
const skill = process.argv[2] || 'partner.services.list',
  path = process.argv[3],
  args = path ? JSON.parse(await readFile(path, 'utf8')) : {};
const auth = (url, init = {}) => {
  if (new URL(url).origin !== new URL(origin).origin)
    throw Error('Agent card attempted a different origin; token preserved');
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer ' + token);
  return fetch(url, { ...init, headers, redirect: 'error' });
};
const factory = new ClientFactory(
  ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    cardResolver: new DefaultAgentCardResolver({ fetchImpl: auth }),
    transports: [new JsonRpcTransportFactory({ fetchImpl: auth })],
  }),
);
const client = await factory.createFromUrl(
  origin,
  '/agents/' + encodeURIComponent(agent) + '/.well-known/agent-card.json',
);
const result = await client.sendMessage(
  SendMessageRequest.fromJSON({
    message: {
      messageId: process.env.HD_AGENT_MESSAGE_ID || randomUUID(),
      role: 'ROLE_USER',
      parts: [{ text: '调用明确授权的合作服务操作' }],
    },
    metadata: { [EXTENSION]: { skillId: skill, arguments: args } },
  }),
);
console.log(
  JSON.stringify(
    {
      id: result.id,
      status: result.status,
      results: result.artifacts?.flatMap((a) =>
        a.parts.filter((p) => p.content?.$case === 'text').map((p) => JSON.parse(p.content.value)),
      ),
    },
    null,
    2,
  ),
);
