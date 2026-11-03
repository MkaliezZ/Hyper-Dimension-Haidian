import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { openPlatform } from '../src/platform/db.mjs';
import { applyForumEvent, drainOutbox } from '../src/platform/ledger.mjs';
import { createServices } from '../src/platform/services.mjs';
import { defaultRecipe } from '../src/avatar/model.mjs';
import { BaseClient } from '../src/sdk/client.mjs';
const config = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8')),
  fixtures = JSON.parse(await readFile(process.env.HD_M0_USERS, 'utf8'));
const db = await openPlatform(config.databaseUrl),
  services = createServices(db, config),
  results = [],
  started = Date.now();
const test = async (name, fn) => {
  const t = Date.now();
  await fn();
  results.push({ name, status: 'PASS', ms: Date.now() - t });
  console.log('PASS ' + name);
};
async function call(url, { token, body, ...opts } = {}) {
  const response = await fetch(url, {
    ...opts,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}
const users = {};
async function login(name) {
  const f = fixtures.find((u) => u.username === name),
    r = await fetch(config.issuer + '/protocol/openid-connect/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: config.clientId,
        username: name,
        password: f.credentials[0].value,
      }),
    });
  assert.equal(r.status, 200);
  const token = (await r.json()).access_token;
  const me = await call(config.origin + '/m0/me', { token });
  assert.equal(me.status, 200);
  return { token, ...me.data };
}
const api = (u, path, body, method = body ? 'POST' : 'GET') =>
  call(config.origin + path, { token: u.token, body, method });
const native = (s, u, path, body, method = body ? 'POST' : 'GET') =>
  call(s.nakamaUrl + path, { token: u, body, method });
let alice, mia, social, forumCookie, item, approval;
try {
  await test('real Keycloak login and Base school membership', async () => {
    for (const name of ['alice', 'bob', 'moda', 'modb', 'shared']) users[name] = await login(name);
    alice = users.alice;
    mia = users.moda;
    assert.deepEqual(
      alice.schools.map((s) => s.school_id),
      ['north'],
    );
    assert.equal((await login('alice')).userId, alice.userId);
    assert.equal((await api(alice, '/m0/schools/south/avatar')).status, 403);
    assert.equal((await api(alice, '/api/spaces/south/scene')).status, 403);
    assert.deepEqual(
      (await api(alice, '/api/catalog')).data.spaces.map((s) => s.spaceId),
      ['north'],
    );
    const south = JSON.parse(await readFile(config.schools[1].package, 'utf8'));
    assert.equal(
      (await api(alice, '/agents/' + south.agents[0].agentId + '/.well-known/agent-card.json'))
        .status,
      403,
    );
    const bad = alice.token.slice(0, -8) + 'abcdefgh';
    assert.equal((await call(config.origin + '/m0/me', { token: bad })).status, 401);
  });
  await test('stable Base/Nakama/NodeBB mappings; forged native custom login denied', async () => {
    const one = await api(alice, '/m0/schools/north/identities', {});
    assert.equal(one.status, 200, JSON.stringify(one.data));
    const two = await api(alice, '/m0/schools/north/identities', {});
    assert.deepEqual(one.data, two.data);
    const s = config.schools[0];
    social = (await api(alice, '/m0/schools/north/social', {})).data;
    assert.ok(social.session.token);
    const own = await native(s, social.session.token, '/v2/account');
    assert.equal(own.status, 200);
    const fake = await call(s.nakamaUrl + '/v2/account/authenticate/custom?create=true', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(s.nakamaServerKey + ':').toString('base64'),
      },
      body: { id: users.bob.userId, vars: { ticket: 'forged' } },
    });
    assert.equal(fake.status, 403);
    assert.equal(
      (await native(config.schools[1], social.session.token, '/v2/account')).status,
      401,
    );
  });
  await test('avatar edit -> deterministic GLB -> transaction -> retry/conflict/other owner', async () => {
    const path = '/m0/schools/north/avatar',
      a = (await api(alice, path)).data;
    const recipe = {
      ...defaultRecipe,
      hair: 'bob',
      top: 'shirt',
      bottom: 'skirt',
      glasses: 'round',
      accessory: 'satchel',
      palette: 'indigo',
    };
    const input = { requestId: randomUUID(), expectedVersion: a.version, recipe };
    const saved = await api(alice, path, input, 'PUT');
    assert.equal(saved.status, 200);
    for (let i = 0; i < 10; i++)
      assert.deepEqual((await api(alice, path, input, 'PUT')).data, saved.data);
    assert.equal(
      (await api(alice, path, { ...input, recipe: { ...recipe, hair: 'short' } }, 'PUT')).status,
      409,
    );
    assert.equal(
      (await api(alice, path, { ...input, requestId: randomUUID() }, 'PUT')).status,
      409,
    );
    assert.equal((await api(alice, path + '?userId=' + users.bob.userId)).status, 403);
    assert.equal(
      (
        await api(
          alice,
          path,
          { ...input, requestId: randomUUID(), recipe: { ...recipe, hair: 'missing-part' } },
          'PUT',
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await api(
          alice,
          path,
          { ...input, requestId: randomUUID(), recipe: { ...recipe, catalog: 'obsolete-version' } },
          'PUT',
        )
      ).status,
      409,
    );
    const response = await fetch(config.origin + path + '/model.glb', {
        headers: { Authorization: 'Bearer ' + alice.token },
      }),
      buffer = Buffer.from(await response.arrayBuffer());
    assert.equal(buffer.readUInt32LE(0), 0x46546c67);
    assert.equal(createHash('sha256').update(buffer).digest('hex'), saved.data.modelHash);
    const second = (await api(await login('alice'), path)).data;
    assert.deepEqual(second, saved.data);
  });
  await test('OIDC identity retains A2A task ownership and idempotent effects', async () => {
    const pack = JSON.parse(await readFile(config.schools[0].package, 'utf8')),
      agent = pack.agents[0].agentId;
    const client = new BaseClient({ url: config.origin, token: alice.token }),
      other = new BaseClient({ url: config.origin, token: users.shared.token });
    assert.ok((await client.card(agent)).name);
    const messageId = randomUUID(),
      one = await client.send(agent, 'M0 fictional A2A receipt', {
        messageId,
        skillId: 'message.leave',
      });
    const two = await client.send(agent, 'M0 fictional A2A receipt', {
      messageId,
      skillId: 'message.leave',
    });
    assert.equal(two.task.id, one.task.id);
    await assert.rejects(client.send(agent, 'altered', { messageId, skillId: 'message.leave' }));
    await assert.rejects(other.task(agent, one.task.id));
  });
  await test('forum SSO and source pending state; student cannot moderate; pending is private', async () => {
    // Capture the isolated NodeBB session without logging or persisting the one-use ticket.
    const first = await fetch(config.origin + '/m0/schools/north/forum-login', {
      headers: { Authorization: 'Bearer ' + alice.token },
      redirect: 'manual',
    });
    assert.equal(first.status, 302);
    const second = await fetch(first.headers.get('location'), { redirect: 'manual' });
    assert.equal(second.status, 302);
    forumCookie = second.headers
      .getSetCookie()
      .map((s) => s.split(';')[0])
      .join('; ');
    const nativeForum = await call(config.schools[0].forumUrl + '/api/categories', {
      headers: { Cookie: forumCookie },
    });
    assert.equal(nativeForum.status, 200, JSON.stringify(nativeForum.data));
    const posting = await services.forum(config.schools[0], 'posting-state', {
      userId: alice.userId,
    });
    if (posting.retryAfterMs > 0) {
      console.log(
        'Preparing fixture: respecting the existing NodeBB posting cooldown (' +
          Math.ceil(posting.retryAfterMs / 1000) +
          's), without changing its limit.',
      );
      await new Promise((r) => setTimeout(r, posting.retryAfterMs + 30));
    }
    const submitted = await api(alice, '/m0/schools/north/forum', {
      action: 'submit',
      requestId: randomUUID(),
      title: 'M0 campus memory ' + randomUUID().slice(0, 6),
      content: 'Fictional campus memory for the isolated integration test. No real school data.',
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
    item = submitted.data;
    assert.equal(item.status, 'pending');
    assert.equal(item.events.length, 0);
    const shared = await api(users.shared, '/m0/schools/north/forum');
    assert.equal(
      shared.data.items.some((x) => x.id === item.id),
      false,
    );
    assert.equal(
      (await api(alice, '/m0/schools/north/forum', { action: 'approve', id: item.id })).status,
      403,
    );
    assert.equal(
      (
        await call(config.schools[1].forumUrl + '/api/categories', {
          headers: { Cookie: forumCookie },
        })
      ).status,
      401,
    );
  });
  await test('real NodeBB approval -> PG ledger -> authoritative Nakama ranking; 10 deliveries once', async () => {
    const r = await api(mia, '/m0/schools/north/forum', { action: 'approve', id: item.id });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    approval = r.data;
    assert.ok(approval.pid);
    assert.equal(approval.status, 'published');
    const e = approval.events[0];
    for (let i = 0; i < 10; i++) await applyForumEvent(db, 'north', e);
    await assert.rejects(applyForumEvent(db, 'north', { ...e, status: 'withdrawn' }), {
      code: 'event_conflict',
    });
    await assert.rejects(applyForumEvent(db, 'south', e), { code: 'invalid_source_event' });
    const { rows } = await db.pool.query('SELECT * FROM hd_contributions WHERE event_id=$1', [
      e.eventId,
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].delta, 10);
    assert.equal(rows[0].rule_version, 'm0-content-accepted-v1');
    await drainOutbox(db, (row) => services.project(row));
    const nativeTopic = await call(config.schools[0].forumUrl + '/api/topic/' + approval.tid, {
      headers: { Cookie: forumCookie },
    });
    assert.equal(nativeTopic.status, 200);
    const nk = await native(
      config.schools[0],
      social.session.token,
      '/v2/leaderboard/north:m0-trial?owner_ids=' + social.nakamaId,
    );
    assert.equal(nk.status, 200, JSON.stringify(nk.data));
    assert.ok(nk.data.owner_records.length);
    const score = (await api(alice, '/m0/schools/north/ranking')).data.rows.find(
      (r) => r.user_id === alice.userId,
    ).score;
    assert.equal(Number(nk.data.owner_records[0].score), score);
    assert.equal(
      (
        await native(config.schools[0], social.session.token, '/v2/leaderboard/north:m0-trial', {
          record: { score: '99999' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await native(
          config.schools[0],
          social.session.token,
          '/v2/storage',
          {
            objects: [
              {
                collection: 'hd_private',
                key: 'profile',
                value: '{}',
                permission_read: 2,
                permission_write: 1,
              },
            ],
          },
          'PUT',
        )
      ).status,
      403,
    );
    const own = await native(config.schools[0], social.session.token, '/v2/storage', {
      object_ids: [{ collection: 'hd_private', key: 'profile', user_id: social.nakamaId }],
    });
    assert.equal(own.status, 200);
    assert.equal(own.data.objects.length, 1);
    const shared = (await api(users.shared, '/m0/schools/north/social', {})).data;
    const other = await native(config.schools[0], shared.session.token, '/v2/storage', {
      object_ids: [{ collection: 'hd_private', key: 'profile', user_id: social.nakamaId }],
    });
    assert.equal(other.status, 200);
    assert.deepEqual(other.data.objects || [], []); // Proto JSON omits an empty repeated field.
  });
  await test('withdrawal reverses accepted contribution; replay remains one reversal', async () => {
    const r = await api(mia, '/m0/schools/north/forum', { action: 'withdraw', id: item.id });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.status, 'withdrawn');
    const e = r.data.events[1];
    for (let i = 0; i < 10; i++) await applyForumEvent(db, 'north', e);
    const {
      rows: [row],
    } = await db.pool.query('SELECT * FROM hd_contributions WHERE event_id=$1', [e.eventId]);
    assert.equal(row.delta, -10);
    assert.ok(row.reverses);
    const {
      rows: [sum],
    } = await db.pool.query(
      'SELECT sum(delta)::integer AS total,count(*)::integer AS entries FROM hd_contributions WHERE event_id=ANY($1)',
      [r.data.events.map((x) => x.eventId)],
    );
    assert.deepEqual(sum, { total: 0, entries: 2 });
    await drainOutbox(db, (row) => services.project(row));
  });
  await test('failed delivery remains in outbox; native projection rebuilt from PG ledger', async () => {
    const s = config.schools[0],
      rows = (await db.pool.query('SELECT * FROM hd_scores WHERE school_id=$1', ['north'])).rows;
    for (const row of rows) {
      const {
        rows: [sum],
      } = await db.pool.query(
        'SELECT coalesce(sum(delta),0)::integer AS score FROM hd_contributions WHERE school_id=$1 AND user_id=$2 AND period=$3',
        [row.school_id, row.user_id, row.period],
      );
      assert.equal(sum.score, row.score);
    }
    await db.pool.query(
      'UPDATE hd_outbox SET delivered=false WHERE id=(SELECT max(id) FROM hd_outbox)',
    );
    await assert.rejects(
      drainOutbox(db, async () => {
        throw Error('injected-transport-disconnect');
      }),
    );
    assert.ok((await db.pool.query('SELECT 1 FROM hd_outbox WHERE NOT delivered')).rowCount > 0);
    const reset = await call(
      s.nakamaUrl + '/v2/rpc/hd_reset_projection?http_key=' + encodeURIComponent(s.nakamaHttpKey),
      { method: 'POST', body: JSON.stringify({ key: s.nakamaKey, period: 'm0-trial' }) },
    );
    assert.equal(reset.status, 200);
    for (const row of rows) await services.project(row);
    await drainOutbox(db, (row) => services.project(row));
    const nk = await native(
      s,
      social.session.token,
      '/v2/leaderboard/north:m0-trial?owner_ids=' + social.nakamaId,
    );
    assert.equal(nk.status, 200);
    assert.equal(
      Number(nk.data.owner_records[0].score),
      rows.find((r) => r.user_id === alice.userId).score,
    );
  });
  await test('membership revocation rejects old Base, native Nakama and native NodeBB sessions', async () => {
    await db.pool.query(
      'UPDATE hd_memberships SET active=false,revision=revision+1 WHERE school_id=$1 AND user_id=$2',
      ['north', alice.userId],
    );
    try {
      assert.equal((await api(alice, '/m0/schools/north/avatar')).status, 403);
      assert.equal(
        (await native(config.schools[0], social.session.token, '/v2/account')).status,
        403,
      );
      assert.equal(
        (
          await call(config.schools[0].forumUrl + '/api/categories', {
            headers: { Cookie: forumCookie },
          })
        ).status,
        403,
      );
    } finally {
      await db.pool.query(
        'UPDATE hd_memberships SET active=true,revision=revision+1 WHERE school_id=$1 AND user_id=$2',
        ['north', alice.userId],
      );
    }
  });
  await mkdir('qa/m0', { recursive: true });
  await writeFile(
    'qa/m0/integration.json',
    JSON.stringify(
      {
        kind: 'automated-real-services',
        environment: 'Ubuntu WSL on one host; not a human or physical multi-device test',
        startedAt: new Date(started).toISOString(),
        elapsedMs: Date.now() - started,
        results,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await db.close();
}
