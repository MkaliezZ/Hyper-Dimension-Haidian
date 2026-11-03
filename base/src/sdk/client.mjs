import { randomUUID } from 'node:crypto';
import { EXTENSION, A2A_VERSION } from '../protocol/index.mjs';
export class BaseClient {
  constructor({ url, token, fetchImpl = fetch }) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
    this.fetch = fetchImpl;
  }
  async card(agentId, { signal } = {}) {
    const r = await this.fetch(
      this.url + '/agents/' + encodeURIComponent(agentId) + '/.well-known/agent-card.json',
      {
        headers: this.token ? { Authorization: 'Bearer ' + this.token } : {},
        signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
      },
    );
    if (!r.ok) throw Error('Agent discovery failed');
    return r.json();
  }
  async rpc(agentId, method, params, { signal } = {}) {
    const r = await this.fetch(this.url + '/agents/' + encodeURIComponent(agentId) + '/a2a', {
      method: 'POST',
      signal: AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]),
      headers: {
        'Content-Type': 'application/json',
        'A2A-Version': A2A_VERSION,
        Authorization: 'Bearer ' + this.token,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
    });
    const data = await r.json();
    if (!r.ok || data.error)
      throw Object.assign(Error(data.error?.message || 'A2A request failed'), {
        code: data.error?.code,
        status: r.status,
      });
    return data.result;
  }
  send(
    agentId,
    message,
    {
      messageId = randomUUID(),
      contextId,
      taskId,
      skillId = 'space.information',
      args = {},
      returnImmediately = false,
      signal,
    } = {},
  ) {
    return this.rpc(
      agentId,
      'SendMessage',
      {
        message: {
          messageId,
          role: 'ROLE_USER',
          parts: [{ text: message }],
          ...(contextId ? { contextId } : {}),
          ...(taskId ? { taskId } : {}),
        },
        configuration: { returnImmediately },
        metadata: { [EXTENSION]: { skillId, arguments: args } },
      },
      { signal },
    );
  }
  task(agentId, id) {
    return this.rpc(agentId, 'GetTask', { id });
  }
}
