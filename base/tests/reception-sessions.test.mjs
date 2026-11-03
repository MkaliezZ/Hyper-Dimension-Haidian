import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/core/store.mjs';
import { createReceptionSessions, receptionPolicy } from '../src/reception/sessions.mjs';
import { exampleScene, packageFor } from '../tools/fixtures.mjs';
import { startServer } from '../src/server.mjs';
import { BaseClient } from '../src/sdk/client.mjs';

const principal = { id: 'alice', spaces: ['north'], scopes: ['public:read', 'a2a:call'] };
test('Reception retention, export, deletion, CAS and replay are durable and tenant bound', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hd-session-unit-'));
  let store,
    clock = Date.now();
  try {
    store = await openStore(dir);
    let sessions = createReceptionSessions({ store, now: () => clock });
    assert.equal(receptionPolicy().retentionDays, 30);
    for (const p of [
      { retentionDays: 0 },
      { retentionDays: 366 },
      { contextTurns: 100 },
      { unexpected: true },
    ])
      assert.throws(() => receptionPolicy(p));
    const s = await sessions.create(principal, 'north', 'north-reception', 'create-1');
    assert.equal(s.expiresAt - s.createdAt, 30 * 86400000);
    assert.deepEqual(await sessions.create(principal, 'north', 'north-reception', 'create-1'), s);
    await store.transact((d) => {
      const t = {
        id: 'task-one',
        owner: 'alice',
        spaceId: 'north',
        agentId: 'north-reception',
        contextId: s.contextId,
        skillId: 'space.information',
        createdAt: clock,
        history: [],
        input: 'PRIVATE_SESSION_MARKER',
        status: { state: 'TASK_STATE_COMPLETED' },
        result: { text: 'answer', basis: 'general', sources: [] },
      };
      sessions.begin(d, principal, t);
      d.tasks[t.id] = t;
      return true;
    });
    assert.equal(
      (await sessions.export(principal, 'north', 'north-reception', s.contextId)).turns[0].question,
      'PRIVATE_SESSION_MARKER',
    );
    for (const args of [
      [{ ...principal, id: 'bob' }, 'north', 'north-reception'],
      [principal, 'south', 'north-reception'],
      [principal, 'north', 'other-agent'],
    ])
      await assert.rejects(sessions.export(...args, s.contextId));
    await assert.rejects(
      sessions.remove(principal, 'north', 'north-reception', s.contextId, 1, 'delete-stale'),
      /变化/,
    );
    const current = (await sessions.list(principal, 'north', 'north-reception')).sessions[0];
    const removed = await sessions.remove(
      principal,
      'north',
      'north-reception',
      s.contextId,
      current.revision,
      'delete-one',
    );
    assert.equal(removed.status, 'deleted');
    assert.deepEqual(
      await sessions.remove(
        principal,
        'north',
        'north-reception',
        s.contextId,
        current.revision,
        'delete-one',
      ),
      removed,
    );
    assert(!JSON.stringify(store.read()).includes('PRIVATE_SESSION_MARKER'));
    await assert.rejects(
      sessions.export(principal, 'north', 'north-reception', s.contextId),
      /清除/,
    );
    await store.close();
    store = await openStore(dir);
    sessions = createReceptionSessions({ store, now: () => clock });
    await assert.rejects(
      sessions.create(principal, 'north', 'north-reception', 'create-1'),
      /到期/,
    );
    const next = await sessions.create(principal, 'north', 'north-reception', 'create-2');
    clock = next.expiresAt + 1;
    assert.deepEqual(await sessions.expire(), { expired: 1 });
    assert.equal((await sessions.list(principal, 'north', 'north-reception')).sessions.length, 0);
    await assert.rejects(
      sessions.export(principal, 'north', 'north-reception', next.contextId),
      /清除/,
    );
  } finally {
    await store?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Deleting an in-flight reception blocks late results, cached replay and concurrent turns', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hd-session-api-'));
  let server, release, started;
  const reached = new Promise((r) => (started = r)),
    pause = new Promise((r) => (release = r));
  const provider = Object.assign(
    async () => {
      started();
      await pause;
      return { answer: 'LATE_PRIVATE_ANSWER', kind: 'general', sourceIds: [] };
    },
    { general: true },
  );
  try {
    server = await startServer({
      root: process.cwd(),
      packs: [packageFor(exampleScene(), 'north', 'North')],
      dataDir: dir,
      port: 0,
      provider,
    });
    const token = server.auth.access.tokens[0].token,
      client = new BaseClient({ url: server.origin, token });
    async function api(path, method = 'GET', data) {
      const r = await fetch(server.origin + '/api/spaces/north/reception-sessions' + path, {
        method,
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      return { status: r.status, body: await r.json() };
    }
    const created = (await api('', 'POST', { requestId: 'create-first' })).body;
    const send = client
      .send('north-reception', 'INFLIGHT_PRIVATE_QUESTION', {
        contextId: created.contextId,
        messageId: 'first-inflight',
      })
      .catch((e) => e);
    await reached;
    await assert.rejects(
      client.send('north-reception', 'concurrent', { contextId: created.contextId }),
      /回答/,
    );
    const current = (await api('')).body.sessions[0];
    assert.equal(
      (
        await api('/' + encodeURIComponent(created.contextId) + '/delete', 'POST', {
          requestId: 'remove-first',
          expectedRevision: current.revision,
        })
      ).status,
      200,
    );
    release();
    assert((await send) instanceof Error);
    await assert.rejects(
      client.send('north-reception', 'INFLIGHT_PRIVATE_QUESTION', {
        contextId: created.contextId,
        messageId: 'first-inflight',
      }),
      /到期/,
    );
    assert.equal((await api('/' + encodeURIComponent(created.contextId) + '/export')).status, 410);
    const raw = await readFile(join(dir, 'state.json'), 'utf8');
    assert(!raw.includes('INFLIGHT_PRIVATE_QUESTION'));
    assert(!raw.includes('LATE_PRIVATE_ANSWER'));
  } finally {
    release?.();
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
