import { randomUUID } from 'node:crypto';
import { authorize, clone, digest, fail, fields, identifier } from '../protocol/index.mjs';

const day = 86400000;
export const DEFAULT_RECEPTION_POLICY = Object.freeze({
  retentionDays: 30,
  maxSessions: 30,
  maxTurns: 200,
  contextTurns: 4,
});
export function receptionPolicy(input = {}) {
  fields(input, ['retentionDays', 'maxSessions', 'maxTurns', 'contextTurns'], 'reception_policy');
  const p = { ...DEFAULT_RECEPTION_POLICY, ...input };
  for (const [key, min, max] of [
    ['retentionDays', 1, 365],
    ['maxSessions', 1, 100],
    ['maxTurns', 1, 500],
    ['contextTurns', 1, 12],
  ])
    if (!Number.isSafeInteger(p[key]) || p[key] < min || p[key] > max)
      fail('reception_policy_invalid', 'Invalid reception policy');
  return p;
}
const owns = (p, owner) => (p.ownershipIds || [p.id]).includes(owner);
const metadata = (s) => ({
  contextId: s.id,
  agentId: s.agentId,
  spaceId: s.spaceId,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  expiresAt: s.expiresAt,
  status: s.status,
  revision: s.revision,
  turnCount: s.turnCount,
  retentionDays: s.retentionDays,
});

export function createReceptionSessions({ store, now = Date.now, abortContext = () => {} }) {
  const policy = (d, spaceId) => ({
    ...receptionPolicy(d.receptionPolicies?.[spaceId]?.document || {}),
    revision: d.receptionPolicies?.[spaceId]?.revision || 0,
  });
  const get = (d, id, { principal, spaceId, agentId } = {}) => {
    const s = d.receptionSessions?.[identifier(id, 'contextId')];
    if (
      !s ||
      (principal && !owns(principal, s.owner)) ||
      (spaceId && s.spaceId !== spaceId) ||
      (agentId && s.agentId !== agentId)
    )
      fail('reception_session_missing', 'Reception session not found', 404);
    return s;
  };
  function assertActive(d, task) {
    if (task.skillId !== 'space.information') return;
    const s = d.receptionSessions?.[task.contextId];
    if (!s) {
      if (task.createdAt + policy(d, task.spaceId).retentionDays * day <= now())
        fail('reception_session_unavailable', '历史接待会话已到期。', 409);
      return;
    }
    if (
      s.status !== 'active' ||
      s.expiresAt <= now() ||
      (task.memoryGeneration !== undefined && task.memoryGeneration !== s.generation)
    )
      fail('reception_session_unavailable', '接待会话已删除、关闭或到期，请新建会话。', 409);
  }
  function redact(d, s, status) {
    s.status = status;
    s.generation++;
    s.revision++;
    s.updatedAt = now();
    for (const t of Object.values(d.tasks))
      if (
        t.contextId === s.id &&
        t.agentId === s.agentId &&
        t.spaceId === s.spaceId &&
        t.skillId === 'space.information'
      ) {
        t.input = '';
        t.arguments = {};
        t.history = [];
        delete t.result;
        delete t.artifacts;
        t.status = {
          state: 'TASK_STATE_CANCELED',
          timestamp: new Date(now()).toISOString(),
          message: {
            messageId: randomUUID(),
            role: 'ROLE_AGENT',
            parts: [{ text: '接待会话正文已清除。' }],
          },
        };
      }
  }
  function expireIn(d, spaceId) {
    let count = 0;
    // Adopt compatible historical conversations without resetting their original creation time.
    d.receptionSessions ??= {};
    const legacy = new Map();
    for (const t of Object.values(d.tasks))
      if (
        t.skillId === 'space.information' &&
        (!spaceId || t.spaceId === spaceId) &&
        !d.receptionSessions[t.contextId]
      ) {
        if (!legacy.has(t.contextId)) legacy.set(t.contextId, []);
        legacy.get(t.contextId).push(t);
      }
    for (const [id, tasks] of legacy) {
      const first = tasks[0],
        p = policy(d, first.spaceId);
      if (
        tasks.every(
          (t) =>
            t.owner === first.owner && t.spaceId === first.spaceId && t.agentId === first.agentId,
        )
      ) {
        const createdAt = Math.min(...tasks.map((t) => t.createdAt));
        d.receptionSessions[id] = {
          id,
          owner: first.owner,
          spaceId: first.spaceId,
          agentId: first.agentId,
          createdAt,
          updatedAt: createdAt,
          expiresAt: createdAt + p.retentionDays * day,
          retentionDays: p.retentionDays,
          status: 'active',
          revision: 1,
          generation: 1,
          turnCount: tasks.length,
        };
      } else
        for (const t of tasks)
          if (t.createdAt + policy(d, t.spaceId).retentionDays * day <= now() && t.input) {
            t.input = '';
            t.arguments = {};
            t.history = [];
            delete t.result;
            delete t.artifacts;
            t.status = { state: 'TASK_STATE_CANCELED', timestamp: new Date(now()).toISOString() };
            count++;
          }
    }
    for (const s of Object.values(d.receptionSessions || {}))
      if (
        (!spaceId || s.spaceId === spaceId) &&
        !['deleted', 'expired'].includes(s.status) &&
        s.expiresAt <= now()
      ) {
        redact(d, s, 'expired');
        count++;
      }
    return count;
  }
  function createIn(d, principal, spaceId, agentId, id = spaceId + ':' + randomUUID()) {
    authorize(principal, spaceId, 'a2a:call');
    d.receptionSessions ??= {};
    d.contexts ??= {};
    const old = d.receptionSessions[id];
    if (old) {
      get(d, id, { principal, spaceId, agentId });
      assertActive(d, { contextId: id, skillId: 'space.information' });
      return old;
    }
    const c = d.contexts[id];
    if (
      c &&
      (!owns(principal, c.owner) || c.spaceId !== spaceId || (c.agentId && c.agentId !== agentId))
    )
      fail('context_forbidden', 'Context belongs to another identity, Agent or space', 403);
    const p = policy(d, spaceId);
    expireIn(d, spaceId);
    if (
      Object.values(d.receptionSessions).filter(
        (s) =>
          owns(principal, s.owner) &&
          s.spaceId === spaceId &&
          s.agentId === agentId &&
          s.status === 'active',
      ).length >= p.maxSessions
    )
      fail('reception_session_limit', '会话数量达到上限，请先删除旧会话。', 409);
    const legacy = Object.values(d.tasks).filter(
      (t) => t.contextId === id && t.skillId === 'space.information',
    );
    if (
      legacy.some(
        (t) => !owns(principal, t.owner) || t.agentId !== agentId || t.spaceId !== spaceId,
      )
    )
      fail('context_forbidden', 'Legacy context cannot change its owner or Agent', 403);
    const createdAt = legacy.length ? Math.min(...legacy.map((t) => t.createdAt)) : now();
    const s = {
      id,
      owner: principal.id,
      spaceId,
      agentId,
      createdAt,
      updatedAt: now(),
      expiresAt: createdAt + p.retentionDays * day,
      retentionDays: p.retentionDays,
      status: 'active',
      revision: 1,
      generation: 1,
      turnCount: legacy.length,
    };
    d.receptionSessions[id] = s;
    d.contexts[id] = { owner: principal.id, spaceId, agentId };
    assertActive(d, { contextId: id, skillId: 'space.information' });
    return s;
  }
  function begin(d, principal, task) {
    if (task.skillId !== 'space.information') return;
    const s = createIn(d, principal, task.spaceId, task.agentId, task.contextId),
      p = policy(d, task.spaceId);
    if (
      Object.values(d.tasks).some(
        (t) =>
          t.id !== task.id &&
          t.contextId === task.contextId &&
          t.agentId === task.agentId &&
          t.status.state === 'TASK_STATE_WORKING',
      )
    )
      fail('reception_session_busy', '当前会话仍在回答，请稍后重试。', 409);
    if (s.turnCount >= p.maxTurns)
      fail('reception_turn_limit', '当前会话已达到轮数上限，请新建会话。', 409);
    if (!d.tasks[task.id]) s.turnCount++;
    s.updatedAt = now();
    s.revision++;
    task.memoryGeneration = s.generation;
  }
  function history(d, task, principal) {
    assertActive(d, task);
    return Object.values(d.tasks)
      .filter(
        (t) =>
          t.id !== task.id &&
          owns(principal, t.owner) &&
          t.spaceId === task.spaceId &&
          t.agentId === task.agentId &&
          t.contextId === task.contextId &&
          t.skillId === 'space.information' &&
          t.status.state === 'TASK_STATE_COMPLETED',
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-policy(d, task.spaceId).contextTurns)
      .flatMap((t) => [
        { role: 'user', text: t.input.slice(0, 2000) },
        {
          role: 'assistant',
          text: t.result.text.slice(0, 2000),
          ...((t.result.sources || []).some((s) => /^(kb:|partner:)/.test(s.id))
            ? {
                sourceIds: (t.result.sources || [])
                  .filter((s) => /^(kb:|partner:)/.test(s.id))
                  .map((s) => s.id),
              }
            : {}),
        },
      ]);
  }
  async function write(fn, authorization) {
    if (authorization) {
      if (!store.combined)
        fail(
          'reception_admin_unavailable',
          'Reception policy management needs the campus transactional store',
          503,
        );
      return store.combined(async (d, c) => {
        await authorization(c);
        return fn(d, c);
      });
    }
    return store.transact(fn);
  }
  return {
    begin,
    history,
    assertActive,
    policy,
    async list(principal, spaceId, agentId) {
      authorize(principal, spaceId);
      await store.transact((d) => expireIn(d, spaceId));
      return {
        policy: policy(store.read(), spaceId),
        sessions: Object.values(store.read().receptionSessions || {})
          .filter(
            (s) =>
              owns(principal, s.owner) &&
              s.spaceId === spaceId &&
              s.agentId === agentId &&
              !['deleted', 'expired'].includes(s.status),
          )
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map(metadata),
      };
    },
    async create(principal, spaceId, agentId, requestId) {
      identifier(requestId, 'requestId');
      return store.transact((d) => {
        d.receptionOperations ??= {};
        const key = digest([principal.id, spaceId, agentId, 'create', requestId]);
        const prior = d.receptionOperations[key];
        if (prior) {
          const s = get(d, prior, { principal, spaceId, agentId });
          assertActive(d, { contextId: s.id, skillId: 'space.information' });
          return metadata(s);
        }
        const s = createIn(d, principal, spaceId, agentId);
        d.receptionOperations[key] = s.id;
        return metadata(s);
      });
    },
    async export(principal, spaceId, agentId, contextId) {
      authorize(principal, spaceId);
      await store.transact((d) => expireIn(d, spaceId));
      const d = store.read(),
        s = get(d, contextId, { principal, spaceId, agentId });
      if (['deleted', 'expired'].includes(s.status))
        fail('reception_session_unavailable', '会话正文已清除。', 410);
      return {
        schema: 'hyper-dimension.reception-export/v1',
        session: metadata(s),
        notice: '本人历史对话；历史回答不代表学校当前有效资料。',
        turns: Object.values(d.tasks)
          .filter(
            (t) =>
              t.contextId === s.id &&
              t.agentId === agentId &&
              t.spaceId === spaceId &&
              t.skillId === 'space.information' &&
              owns(principal, t.owner),
          )
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((t) => ({
            taskId: t.id,
            at: t.createdAt,
            status: t.status.state,
            question: t.input,
            answer: t.result?.text || null,
            basis: t.result?.basis || null,
            sources: (t.result?.sources || []).map(({ id, title, revision }) => ({
              id,
              title,
              revision,
            })),
          })),
      };
    },
    async remove(principal, spaceId, agentId, contextId, expectedRevision, requestId) {
      authorize(principal, spaceId);
      identifier(requestId, 'requestId');
      const result = await store.transact((d) => {
        d.receptionOperations ??= {};
        const key = digest([principal.id, spaceId, agentId, 'delete', requestId]),
          fingerprint = digest([contextId, expectedRevision]);
        if (d.receptionOperations[key]) {
          if (d.receptionOperations[key].fingerprint !== fingerprint)
            fail('request_conflict', '删除请求内容已变化。', 409);
          get(d, contextId, { principal, spaceId, agentId });
          return d.receptionOperations[key].result;
        }
        const s = get(d, contextId, { principal, spaceId, agentId });
        if (s.revision !== expectedRevision)
          fail('revision_conflict', '会话已变化，请刷新后操作。', 409);
        redact(d, s, 'deleted');
        const result = metadata(s);
        d.receptionOperations[key] = { fingerprint, result };
        return result;
      });
      abortContext(contextId);
      return result;
    },
    async admin(spaceId, authorization) {
      return write((d) => {
        expireIn(d, spaceId);
        const all = Object.values(d.receptionSessions || {}).filter((s) => s.spaceId === spaceId);
        return {
          policy: policy(d, spaceId),
          sessions: all.slice(-200).map(metadata),
          total: all.length,
          taskStates: Object.values(d.tasks)
            .filter((t) => t.spaceId === spaceId && t.skillId === 'space.information')
            .reduce((counts, t) => {
              counts[t.status.state] = (counts[t.status.state] || 0) + 1;
              return counts;
            }, {}),
          containsConversationBodies: false,
        };
      }, authorization);
    },
    async setPolicy(spaceId, input, expectedRevision, authorization, operation) {
      const document = receptionPolicy(input);
      return write((d) => {
        d.receptionOperations ??= {};
        const key = operation
            ? digest(['policy', spaceId, operation.actorId, identifier(operation.requestId)])
            : null,
          fp = digest([document, expectedRevision]);
        if (key && d.receptionOperations[key]) {
          const old = d.receptionOperations[key];
          if (old.fingerprint !== fp) fail('request_conflict', '会话政策请求内容变化。', 409);
          return old.result;
        }
        const p = policy(d, spaceId);
        if (p.revision !== expectedRevision) fail('revision_conflict', '会话政策已更新。', 409);
        d.receptionPolicies ??= {};
        d.receptionPolicies[spaceId] = { document, revision: p.revision + 1, updatedAt: now() };
        const result = policy(d, spaceId);
        if (key) d.receptionOperations[key] = { fingerprint: fp, result };
        return result;
      }, authorization);
    },
    async expire(spaceId, authorization) {
      const result = await write((d) => ({ expired: expireIn(d, spaceId) }), authorization);
      if (result.expired)
        for (const s of Object.values(store.read().receptionSessions || {}))
          if (s.status === 'expired' && (!spaceId || s.spaceId === spaceId)) abortContext(s.id);
      return result;
    },
  };
}
