import { randomUUID } from 'node:crypto';
import { createReceptionSessions } from '../reception/sessions.mjs';
import { limitEmbedding } from '../knowledge/limit.mjs';
import {
  A2A_VERSION,
  EXTENSION,
  BASE_VERSION,
  authorize,
  canonical,
  clone,
  digest,
  fields,
  identifier,
  text,
  fail,
} from '../protocol/index.mjs';
const terminal = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_FAILED',
  'TASK_STATE_REJECTED',
]);
const methodError = (code, message) => Object.assign(Error(message), { rpcCode: code });
export function createGateway({
  store,
  packs,
  reception,
  navigate,
  capabilities = {},
  now = Date.now,
  maxModelCallsPerDay = 100,
}) {
  const agents = new Map(),
    running = new Map();
  let closing = false;
  const runReception = limitEmbedding((input) => reception.answer(input), {
    concurrency: 2,
    maxQueued: 16,
    errorPrefix: 'reception',
  });
  const receptionSessions = createReceptionSessions({
    store,
    now,
    abortContext: (id) => {
      const tasks = store.read().tasks;
      for (const [taskId, work] of running)
        if (tasks[taskId]?.contextId === id) work.controller.abort();
    },
  });
  for (const pack of packs)
    for (const agent of pack.agents || []) {
      if (agents.has(agent.agentId))
        fail('duplicate_id', 'Agent IDs must be globally unique in a deployment');
      for (const skill of agent.skills)
        if (
          !['space.information', 'navigation.route', 'message.leave'].includes(skill) &&
          !capabilities[skill]
        )
          fail('unknown_skill', 'No installed capability handler for ' + skill);
      agents.set(agent.agentId, { pack, agent });
    }
  function target(agentId) {
    const a = agents.get(agentId);
    if (!a) fail('agent_missing', 'Agent not found', 404);
    return a;
  }
  function card(agentId, origin) {
    const { pack, agent } = target(agentId);
    return {
      name: agent.name,
      description: agent.description || pack.description,
      version: BASE_VERSION,
      provider: {
        organization: 'Hyper Dimension Base',
        url: 'https://github.com/MkaliezZ/hyper-dimension',
      },
      supportedInterfaces: [
        {
          url: origin + '/agents/' + agentId + '/a2a',
          protocolBinding: 'JSONRPC',
          protocolVersion: A2A_VERSION,
        },
      ],
      capabilities: {
        streaming: false,
        pushNotifications: false,
        extendedAgentCard: true,
        extensions: [
          {
            uri: EXTENSION,
            required: false,
            description: 'Versioned, authorized space capabilities',
            params: { spaceId: pack.spaceId, skills: agent.skills },
          },
        ],
      },
      securitySchemes: {
        accessToken: {
          httpAuthSecurityScheme: { scheme: 'Bearer', bearerFormat: 'Base scoped access token' },
        },
      },
      securityRequirements: [{ schemes: { accessToken: { list: [] } } }],
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: agent.skills.map((id) => ({
        id,
        name: id,
        description: 'Authorized ' + id + ' for ' + pack.name,
        tags: ['space', id.split('.')[0]],
      })),
    };
  }
  function project(t, historyLength) {
    const out = {
      id: t.id,
      contextId: t.contextId,
      status: clone(t.status),
      metadata: {
        [EXTENSION]: {
          spaceId: t.spaceId,
          agentId: t.agentId,
          skillId: t.skillId,
          sources: t.result?.sources || [],
          mode: t.result?.mode || null,
        },
      },
    };
    if (t.artifacts) out.artifacts = clone(t.artifacts);
    if (historyLength !== 0)
      out.history = clone(
        historyLength === undefined ? t.history : t.history.slice(-historyLength),
      );
    return out;
  }
  const owns = (principal, owner) => (principal.ownershipIds || [principal.id]).includes(owner);
  async function guard(task, principal, result) {
    receptionSessions.assertActive(store.read(), task);
    const capability = capabilities[task.skillId];
    if (capability?.scope) authorize(principal, task.spaceId, capability.scope);
    await capability?.authorize?.({
      pack: target(task.agentId).pack,
      principal,
      skillId: task.skillId,
      arguments: task.arguments || {},
      taskId: task.id,
      result,
    });
    if (task.skillId === 'space.information' && result)
      await reception.authorizeResult?.(target(task.agentId).pack, principal, result);
  }
  function own(agentId, principal, id) {
    const t = store.read().tasks[id];
    if (!t || !owns(principal, t.owner) || t.agentId !== agentId)
      throw methodError(-32001, 'Task not found');
    return t;
  }
  async function finish(id, principal) {
    const existing = running.get(id);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = (async () => {
      const task = store.read().tasks[id],
        { pack } = target(task.agentId);
      if (task.status.state !== 'TASK_STATE_WORKING') return;
      try {
        await guard(task, principal);
        let result;
        if (task.skillId === 'space.information')
          result = await runReception(
            {
              pack,
              principal,
              message: task.input,
              signal: controller.signal,
              history: receptionSessions.history(store.read(), task, principal),
            },
            { signal: controller.signal },
          );
        else if (task.skillId === 'navigation.route') {
          const a = task.arguments;
          result = {
            text: '已计算可通行路线',
            ...navigate(pack, a.from, a.to),
            sources: [],
            mode: 'spatial-service',
          };
        } else if (task.skillId === 'message.leave')
          result = {
            text: '留言已交给空间维护者',
            messageId: task.id,
            sources: [],
            mode: 'durable-message',
          };
        else
          result = await capabilities[task.skillId].execute({
            pack,
            principal,
            input: task.input,
            arguments: task.arguments,
            signal: controller.signal,
            taskId: task.id,
          });
        if (typeof result?.text !== 'string' || result.text.length > 32000)
          fail('invalid_result', 'Invalid capability result');
        await guard(task, principal, result);
        await store.transact((d) => {
          const t = d.tasks[id];
          if (t.status.state !== 'TASK_STATE_WORKING') return;
          receptionSessions.assertActive(d, t);
          if (task.skillId === 'message.leave')
            d.messages.push({
              id: t.id,
              spaceId: t.spaceId,
              author: principal.id,
              text: t.input,
              at: now(),
            });
          t.result = result;
          const message = {
            messageId: randomUUID(),
            taskId: t.id,
            contextId: t.contextId,
            role: 'ROLE_AGENT',
            parts: [{ text: result.text }],
          };
          t.history.push(message);
          t.status = {
            state: 'TASK_STATE_COMPLETED',
            timestamp: new Date(now()).toISOString(),
            message,
          };
          t.artifacts = [
            {
              artifactId: t.id + '-result',
              name: 'Capability result',
              parts: [{ text: JSON.stringify(result) }],
            },
          ];
          return true;
        });
      } catch (error) {
        await store.transact((d) => {
          const t = d.tasks[id];
          if (t.status.state === 'TASK_STATE_WORKING')
            t.status = {
              state: 'TASK_STATE_FAILED',
              timestamp: new Date(now()).toISOString(),
              message: {
                messageId: randomUUID(),
                role: 'ROLE_AGENT',
                parts: [
                  {
                    text:
                      error.code === 'provider_unavailable'
                        ? '接待模型暂不可用；原请求与记录已保留。'
                        : error.code === 'no_route'
                          ? '指定位置之间没有可通行路线。'
                          : '能力执行未完成；请检查输入或联系维护者。',
                  },
                ],
              },
            };
          return true;
        });
      } finally {
        running.delete(id);
      }
    })();
    running.set(id, { promise, controller });
    return promise;
  }
  async function send(agentId, principal, p) {
    fields(p, ['tenant', 'message', 'configuration', 'metadata'], 'SendMessage');
    const { pack, agent } = target(agentId);
    if (p.tenant && p.tenant !== pack.spaceId)
      fail('tenant_mismatch', 'Tenant does not match target agent');
    authorize(principal, pack.spaceId, 'a2a:call');
    const m = fields(
      p.message,
      [
        'messageId',
        'contextId',
        'taskId',
        'role',
        'parts',
        'metadata',
        'extensions',
        'referenceTaskIds',
      ],
      'message',
    );
    identifier(m.messageId, 'messageId');
    if (
      m.role !== 'ROLE_USER' ||
      !Array.isArray(m.parts) ||
      m.parts.length < 1 ||
      m.parts.length > 8
    )
      fail('invalid_message', 'Expected ROLE_USER text parts');
    for (const part of m.parts) {
      fields(part, ['text', 'mediaType', 'metadata'], 'text part');
      text(part.text);
      if (part.mediaType && part.mediaType !== 'text/plain')
        throw methodError(-32005, 'Only text parts supported');
    }
    if (m.referenceTaskIds?.length)
      throw methodError(-32004, 'Cross-task execution is not supported');
    const input = text(m.parts.map((x) => x.text).join('\n'));
    const c = p.configuration || {};
    fields(
      c,
      ['acceptedOutputModes', 'historyLength', 'returnImmediately', 'taskPushNotificationConfig'],
      'configuration',
    );
    if (c.taskPushNotificationConfig) throw methodError(-32003, 'Push notifications unsupported');
    if (
      c.historyLength !== undefined &&
      (!Number.isInteger(c.historyLength) || c.historyLength < 0)
    )
      fail('invalid_history', 'Invalid historyLength');
    if (c.returnImmediately !== undefined && typeof c.returnImmediately !== 'boolean')
      fail('invalid_configuration', 'Invalid returnImmediately');
    if (
      c.acceptedOutputModes?.length &&
      !c.acceptedOutputModes.some((x) => ['text/plain', 'text/*', '*/*'].includes(x))
    )
      throw methodError(-32005, 'Only text output supported');
    const left = p.metadata?.[EXTENSION],
      right = m.metadata?.[EXTENSION];
    if (left && right && canonical(left) !== canonical(right))
      fail('conflicting_metadata', 'Conflicting extension metadata');
    const extension = fields(left || right || {}, ['skillId', 'arguments'], 'space extension'),
      skillId = extension.skillId || 'space.information';
    if (!agent.skills.includes(skillId))
      fail('unknown_skill', 'Agent does not advertise this capability');
    if (capabilities[skillId]?.scope)
      authorize(principal, pack.spaceId, capabilities[skillId].scope);
    await capabilities[skillId]?.authorize?.({
      pack,
      principal,
      skillId,
      arguments: extension.arguments || {},
    });
    const key = digest([principal.id, agentId, m.messageId]),
      hash = digest({ message: m, metadata: p.metadata || {} });
    let newTask = false;
    const id = await store.transact((d) => {
      d.a2aRequests ??= {};
      const prior = (principal.ownershipIds || [principal.id])
        .map((owner) => d.a2aRequests[digest([owner, agentId, m.messageId])])
        .find(Boolean);
      if (prior) {
        if (prior.hash !== hash)
          fail('message_conflict', 'The same messageId cannot change content', 409);
        return prior.taskId;
      }
      if (closing) fail('closing', 'Service closing', 503);
      let t;
      if (m.taskId) {
        t = d.tasks[m.taskId];
        if (!t || !owns(principal, t.owner) || t.agentId !== agentId)
          throw methodError(-32001, 'Task not found');
        if (t.status.state !== 'TASK_STATE_INPUT_REQUIRED')
          throw methodError(-32002, 'Task cannot accept another turn');
        if (t.skillId !== skillId || (m.contextId && m.contextId !== t.contextId))
          fail('task_identity', 'Task context or capability cannot change');
      }
      d.contexts ??= {};
      const contextId = t?.contextId || m.contextId || pack.spaceId + ':' + randomUUID();
      identifier(contextId, 'contextId');
      const context = Object.hasOwn(d.contexts, contextId) ? d.contexts[contextId] : null;
      if (
        context &&
        (!owns(principal, context.owner) ||
          context.spaceId !== pack.spaceId ||
          (context.agentId && context.agentId !== agentId))
      )
        fail('context_forbidden', 'Context belongs to another identity or space', 403);
      d.contexts[contextId] = { owner: principal.id, spaceId: pack.spaceId, agentId };
      if (reception.live && skillId === 'space.information') {
        d.modelBudgets ??= {};
        const budget = pack.spaceId + ':' + new Date(now()).toISOString().slice(0, 10);
        if ((d.modelBudgets[budget] || 0) >= maxModelCallsPerDay)
          fail('model_budget', 'Space daily reception model budget reached', 429);
        d.modelBudgets[budget] = (d.modelBudgets[budget] || 0) + 1;
      }
      t ??= {
        id: randomUUID(),
        contextId,
        spaceId: pack.spaceId,
        agentId,
        owner: principal.id,
        skillId,
        history: [],
        createdAt: now(),
      };
      receptionSessions.begin(d, principal, t);
      t.input = input;
      t.arguments = clone(extension.arguments || {});
      t.history.push({ ...clone(m), contextId, taskId: t.id });
      t.status = { state: 'TASK_STATE_WORKING', timestamp: new Date(now()).toISOString() };
      delete t.result;
      delete t.artifacts;
      d.tasks[t.id] = t;
      d.a2aRequests[key] = { hash, taskId: t.id };
      newTask = true;
      return t.id;
    });
    if (newTask) void finish(id, principal);
    if (!c.returnImmediately && running.has(id)) await running.get(id).promise;
    const completed = own(agentId, principal, id);
    await guard(completed, principal, completed.result);
    return { task: project(own(agentId, principal, id), c.historyLength) };
  }
  async function dispatch(agentId, principal, method, p, origin) {
    if (principal.allowedAgents && !principal.allowedAgents.includes(agentId))
      fail('agent_scope_denied', 'Agent is outside delegated scope', 403);
    const { pack } = target(agentId);
    authorize(principal, pack.spaceId, 'a2a:call');
    if (p.status === 'TASK_STATE_UNSPECIFIED') {
      p = { ...p };
      delete p.status;
    }
    if (p.tenant && p.tenant !== pack.spaceId)
      fail('tenant_mismatch', 'Tenant does not match target agent');
    if (
      p.historyLength !== undefined &&
      (!Number.isInteger(p.historyLength) || p.historyLength < 0)
    )
      fail('invalid_history', 'Invalid historyLength');
    if (method === 'GetExtendedAgentCard') return card(agentId, origin);
    if (method === 'SendMessage') return send(agentId, principal, p);
    if (method === 'GetTask') {
      fields(p, ['tenant', 'id', 'historyLength']);
      identifier(p.id);
      const task = own(agentId, principal, p.id);
      await guard(task, principal, task.result);
      return project(task, p.historyLength);
    }
    if (method === 'CancelTask') {
      fields(p, ['tenant', 'id', 'metadata']);
      identifier(p.id);
      const t = own(agentId, principal, p.id);
      await guard(t, principal, t.result);
      if (terminal.has(t.status.state) && t.status.state !== 'TASK_STATE_CANCELED')
        throw methodError(-32002, 'Task is terminal');
      await store.transact((d) => {
        const row = d.tasks[p.id];
        if (row.status.state !== 'TASK_STATE_CANCELED' && terminal.has(row.status.state))
          throw methodError(-32002, 'Task is terminal');
        row.status = { state: 'TASK_STATE_CANCELED', timestamp: new Date(now()).toISOString() };
        return true;
      });
      running.get(p.id)?.controller.abort();
      return project(own(agentId, principal, p.id));
    }
    if (method === 'ListTasks') {
      fields(p, [
        'tenant',
        'contextId',
        'status',
        'pageSize',
        'pageToken',
        'historyLength',
        'statusTimestampAfter',
        'includeArtifacts',
      ]);
      const size = p.pageSize ?? 50;
      if (!Number.isInteger(size) || size < 1 || size > 100)
        fail('invalid_page', 'Invalid page size');
      if (
        p.statusTimestampAfter !== undefined &&
        !Number.isFinite(Date.parse(p.statusTimestampAfter))
      )
        fail('invalid_timestamp', 'Invalid timestamp filter');
      if (p.includeArtifacts !== undefined && typeof p.includeArtifacts !== 'boolean')
        fail('invalid_input', 'Invalid includeArtifacts');
      let offset = 0;
      const query = digest([principal.id, agentId, p.contextId, p.status, p.statusTimestampAfter]);
      if (p.pageToken) {
        try {
          const c = JSON.parse(Buffer.from(p.pageToken, 'base64url'));
          if (c.query !== query || !Number.isSafeInteger(c.offset) || c.offset < 0) throw Error();
          offset = c.offset;
        } catch {
          fail('invalid_cursor', 'Invalid page token');
        }
      }
      const candidates = Object.values(store.read().tasks)
        .filter(
          (t) =>
            owns(principal, t.owner) &&
            t.agentId === agentId &&
            (!p.contextId || t.contextId === p.contextId) &&
            (!p.status || t.status.state === p.status) &&
            (!p.statusTimestampAfter ||
              Date.parse(t.status.timestamp) > Date.parse(p.statusTimestampAfter)),
        )
        .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      const all = [];
      for (const task of candidates) {
        try {
          await guard(task, principal, task.result);
          all.push(task);
        } catch (e) {
          if (![403, 409].includes(e.status)) throw e;
        }
      }
      return {
        tasks: all.slice(offset, offset + size).map((t) => {
          const out = project(t, p.historyLength);
          if (p.includeArtifacts === false) delete out.artifacts;
          return out;
        }),
        totalSize: all.length,
        pageSize: size,
        nextPageToken:
          offset + size < all.length
            ? Buffer.from(JSON.stringify({ query, offset: offset + size })).toString('base64url')
            : '',
      };
    }
    if (['SendStreamingMessage', 'SubscribeToTask'].includes(method))
      throw methodError(-32004, 'Streaming unsupported');
    if (method.includes('PushNotification'))
      throw methodError(-32003, 'Push notifications unsupported');
    throw methodError(-32601, 'Method not found');
  }
  return {
    receptionSessions,
    agents,
    card,
    async recoverInterrupted() {
      await store.transact((d) => {
        for (const t of Object.values(d.tasks))
          if (t.status.state === 'TASK_STATE_WORKING')
            t.status = {
              state: 'TASK_STATE_INPUT_REQUIRED',
              timestamp: new Date(now()).toISOString(),
              message: {
                messageId: randomUUID(),
                role: 'ROLE_AGENT',
                parts: [
                  {
                    text: '服务重启时此请求尚未完成。原任务已保留；用新的messageId和原taskId明确续做，不自动重放。',
                  },
                ],
              },
            };
        return true;
      });
    },
    async handle({ agentId, principal, request, version, origin }) {
      let id = null;
      try {
        fields(request, ['jsonrpc', 'id', 'method', 'params']);
        if (
          request.jsonrpc !== '2.0' ||
          !Object.hasOwn(request, 'id') ||
          !['string', 'number'].includes(typeof request.id) ||
          typeof request.method !== 'string'
        )
          throw methodError(-32600, 'Invalid JSON-RPC request');
        id = request.id;
        if (version !== A2A_VERSION)
          throw Object.assign(methodError(-32009, 'Unsupported A2A version'), {
            data: { supportedVersions: [A2A_VERSION] },
          });
        return {
          jsonrpc: '2.0',
          id,
          result: await dispatch(agentId, principal, request.method, request.params || {}, origin),
        };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code:
              error.rpcCode ??
              (error.status === 403 ? -32001 : error.status === 503 ? -32603 : -32602),
            message: error.message,
            ...(error.data ? { data: error.data } : {}),
          },
        };
      }
    },
    async close() {
      closing = true;
      for (const r of running.values()) r.controller.abort();
      await Promise.allSettled([...running.values()].map((r) => r.promise));
    },
  };
}
