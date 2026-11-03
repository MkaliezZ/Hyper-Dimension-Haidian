import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { config, login, call, api } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { digest, EXTENSION } from '../src/protocol/index.mjs';
import { BaseClient } from '../src/sdk/client.mjs';
const file = config.configRoot + '/guest-fixture.json';
if (process.argv.includes('--prepare-stopped-fixture')) {
  const db = await openPlatform(config.databaseUrl, { m1: true });
  try {
    await db.tx(async (c) => {
      assert.equal(
        (
          await c.query(
            "SELECT pg_try_advisory_xact_lock(hashtextextended('hd-runtime-owner',0)) AS ok",
          )
        ).rows[0].ok,
        true,
        'Stop only this dedicated fixture stack first',
      );
      const state = (await c.query('SELECT state FROM hd_runtime_state FOR UPDATE')).rows[0].state;
      const template = Object.values(state.tasks).find(
        (t) => t.skillId === 'message.leave' && t.status.state === 'TASK_STATE_COMPLETED',
      );
      assert.ok(template);
      const owner = 'visitor-' + randomBytes(16).toString('hex'),
        t = structuredClone(template);
      t.owner = owner;
      t.id = randomUUID();
      t.contextId = 'north:' + randomUUID();
      t.history[0].taskId = t.id;
      t.history[0].contextId = t.contextId;
      t.history[0].messageId = randomUUID();
      state.tasks[t.id] = t;
      state.contexts[t.contextId] = { owner, spaceId: 'north' };
      const message = {
        messageId: t.history[0].messageId,
        role: 'ROLE_USER',
        parts: [{ text: t.input }],
      };
      state.a2aRequests[digest([owner, t.agentId, message.messageId])] = {
        hash: digest({
          message,
          metadata: { [EXTENSION]: { skillId: 'message.leave', arguments: {} } },
        }),
        taskId: t.id,
      };
      await c.query('UPDATE hd_runtime_state SET state=$1', [state]);
      await writeFile(
        file,
        JSON.stringify({
          owner,
          taskId: t.id,
          messageId: t.history[0].messageId,
          text: t.input,
          agentId: t.agentId,
        }) + '\n',
        { mode: 0o600 },
      );
    });
    console.log('Prepared one fictional legacy visitor in stopped isolated M1 runtime');
  } finally {
    await db.close();
  }
} else {
  const f = JSON.parse(await readFile(file, 'utf8')),
    access = JSON.parse(await readFile(config.dataDir + '/access.json', 'utf8'));
  const cookie =
    'hd_base=' +
    f.owner +
    '.' +
    createHmac('sha256', access.cookieSecret).update(f.owner).digest('base64url');
  const alice = await login('alice'),
    shared = await login('shared'),
    client = new BaseClient({ url: config.origin, token: alice.token });
  assert.equal(
    (
      await call(config.origin + '/m1/guest/prepare', {
        body: {},
        headers: { Cookie: 'hd_base=' + f.owner + '.forged' },
      })
    ).status,
    403,
  );
  await assert.rejects(client.task(f.agentId, f.taskId));
  const claim = await call(config.origin + '/m1/guest/prepare', {
    body: {},
    headers: { Cookie: cookie },
  });
  assert.equal(claim.status, 200);
  assert.equal((await api(alice, '/m1/guest/bind', { claim: claim.data.claim })).status, 200);
  assert.equal((await api(shared, '/m1/guest/bind', { claim: claim.data.claim })).status, 409);
  assert.equal((await client.task(f.agentId, f.taskId)).id, f.taskId);
  assert.equal(
    (await client.send(f.agentId, f.text, { messageId: f.messageId, skillId: 'message.leave' }))
      .task.id,
    f.taskId,
  );
  await assert.rejects(
    new BaseClient({ url: config.origin, token: shared.token }).task(f.agentId, f.taskId),
  );
  await writeFile(
    'qa/m1/guest-binding.json',
    JSON.stringify(
      {
        kind: 'signed legacy cookie proof plus verified OIDC account',
        forgedCookieDenied: true,
        oneUseClaim: true,
        otherOwnerDenied: true,
        originalTaskIdPreserved: true,
        duplicateReceiptPreserved: true,
        status: 'PASS',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS verified guest binding preserves original A2A task ownership and duplicate receipt',
  );
}
