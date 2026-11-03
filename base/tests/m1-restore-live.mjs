import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { openPlatform } from '../src/platform/db.mjs';
import { config, login, call, api } from './m1-helpers.mjs';
import { BaseClient } from '../src/sdk/client.mjs';
const db = await openPlatform(config.databaseUrl, { m1: true }),
  results = [];
const test = async (name, fn) => {
  await fn();
  results.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
let alice;
try {
  await test('restored Keycloak credentials log in; exact Base UUID and institutional membership preserved', async () => {
    alice = await login('alice');
    const registered = JSON.parse(
      await readFile(config.configRoot + '/registration-fixture.json', 'utf8'),
    );
    const r = await fetch(config.issuer + '/protocol/openid-connect/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        username: registered.username,
        password: registered.password,
        scope: 'openid profile email',
      }),
    });
    assert.equal(r.status, 200);
    const me = ok(await call(config.origin + '/m0/me', { token: (await r.json()).access_token }));
    assert.equal(me.userId, registered.userId);
    assert.equal(me.schools[0].school_id, 'north');
    assert.equal((await api(alice, '/m0/schools/south/avatar')).status, 403);
  });
  await test('restored avatar, A2A task and immutable message receipt survive restart without another effect', async () => {
    const avatar = ok(await api(alice, '/m0/schools/north/avatar'));
    assert.equal(avatar.recipe.hair, 'bob');
    const state = (await db.pool.query('SELECT state FROM hd_runtime_state')).rows[0].state;
    const task = Object.values(state.tasks).find(
      (t) => t.owner === alice.userId && t.skillId === 'message.leave',
    );
    assert.ok(task);
    const client = new BaseClient({ url: config.origin, token: alice.token });
    assert.equal((await client.task(task.agentId, task.id)).id, task.id);
    const before = state.messages.length;
    assert.equal(
      (
        await client.send(task.agentId, task.input, {
          messageId: task.history[0].messageId,
          skillId: 'message.leave',
        })
      ).task.id,
      task.id,
    );
    const after = (await db.pool.query('SELECT state FROM hd_runtime_state')).rows[0].state;
    assert.equal(after.messages.length, before);
  });
  await test('restored Nakama and NodeBB identities match existing mapping; event and ledger reconcile', async () => {
    const expected = (
      await db.pool.query(
        "SELECT system,external_id FROM hd_identities WHERE school_id='north' AND user_id=$1",
        [alice.userId],
      )
    ).rows;
    const actual = ok(await api(alice, '/m0/schools/north/identities', {}));
    assert.equal(actual.nakamaId, expected.find((x) => x.system === 'nakama').external_id);
    assert.equal(String(actual.forumUid), expected.find((x) => x.system === 'nodebb').external_id);
    const owner = await login('moda');
    let r = ok(await api(owner, '/m1/schools/north/reconcile', {}));
    if (r.busy) {
      await new Promise((r) => setTimeout(r, 500));
      r = ok(await api(owner, '/m1/schools/north/reconcile', {}));
    }
    assert.deepEqual(r.blocked, []);
    const rows = (
      await db.pool.query(
        "SELECT user_id,period,sum(delta)::int AS score FROM hd_contributions WHERE school_id='north' GROUP BY user_id,period",
      )
    ).rows;
    for (const row of rows) {
      const score = (
        await db.pool.query(
          "SELECT score FROM hd_scores WHERE school_id='north' AND user_id=$1 AND period=$2",
          [row.user_id, row.period],
        )
      ).rows[0];
      assert.equal(score.score, row.score);
    }
  });
  await writeFile(
    'qa/m1/restore-live.json',
    JSON.stringify(
      {
        kind: 'six-database restore into independent namespace and ports, Ubuntu WSL',
        sourceOverwritten: false,
        requiresRealServerAcceptance: true,
        results,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await db.close();
}
