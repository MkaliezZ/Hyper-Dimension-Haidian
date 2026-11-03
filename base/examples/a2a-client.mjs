// Node 22+/24. Set BASE_URL / BASE_TOKEN; never put tokens in space.json or Git.
import { BaseClient } from '../src/sdk/client.mjs';
const url = process.env.BASE_URL || 'http://127.0.0.1:4180',
  agentId = process.env.BASE_AGENT || 'north-reception';
if (!process.env.BASE_TOKEN)
  throw Error('Set BASE_TOKEN from the operator-issued scoped credential');
const client = new BaseClient({ url, token: process.env.BASE_TOKEN });
const card = await client.card(agentId);
console.log({ name: card.name, skills: card.skills.map((s) => s.id) });
const result = await client.send(agentId, '项目展览在哪里？');
console.log(JSON.stringify(result, null, 2));
// Persist your chosen messageId before sending a mutation. Reuse it after a lost response.
// await client.send(agentId,'希望预约交流',{messageId:'stable-visit-request-1',skillId:'message.leave'});
