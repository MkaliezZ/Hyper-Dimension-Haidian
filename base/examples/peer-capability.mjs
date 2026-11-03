import { BaseClient } from '../src/sdk/client.mjs';
// Trusted operator configuration only. URLs/tokens never come from an LLM or a public message.
export function peerCapability({ url, token, agentId, allowedOrigins }) {
  const target = new URL(url);
  if (!allowedOrigins.includes(target.origin) || target.username || target.password)
    throw Error('Peer origin is not in the operator allowlist');
  const client = new BaseClient({ url: target.origin, token });
  return {
    scope: 'peer:call',
    async execute({ input, taskId, signal }) {
      if (signal.aborted) throw Error('Canceled');
      const card = await client.card(agentId, { signal });
      if (!card.skills.some((s) => s.id === 'space.information'))
        throw Error('Peer does not advertise information capability');
      const answer = await client.send(agentId, input, { messageId: 'peer-' + taskId, signal });
      const task = answer.task;
      if (task.status.state !== 'TASK_STATE_COMPLETED') throw Error('Peer task did not complete');
      const result = JSON.parse(task.artifacts[0].parts[0].text);
      return {
        text: result.text,
        mode: 'peer-a2a',
        sources: result.sources,
        peer: { agentId, taskId: task.id, origin: target.origin },
      };
    },
  };
}
