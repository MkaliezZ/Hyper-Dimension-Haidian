import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, fixtures, call, login, api, admin, until } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createServices } from '../src/platform/services.mjs';
import { applyForumEvent } from '../src/platform/ledger.mjs';
import { defaultRecipe } from '../src/avatar/model.mjs';
import { BaseClient } from '../src/sdk/client.mjs';
const db = await openPlatform(config.databaseUrl, { m1: true }),
  services = createServices(db, config),
  results = [],
  run = randomUUID().slice(0, 8),
  started = Date.now();
const test = async (name, fn) => {
  const t = Date.now();
  await fn();
  results.push({ name, status: 'PASS', ms: Date.now() - t });
  console.log('PASS ' + name);
};
const ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  },
  north = '/m1/schools/north',
  orgA = 'arts-' + run,
  orgB = 'media-' + run,
  orgP = 'partner-' + run;
let alice, bob, owner, shared, social, item, task, partner, partnerFixture;
const invite = async (who, path, email, role) =>
  ok(await api(who, path + '/invitations', { requestId: randomUUID(), email, role }));
const accept = async (who, token) => api(who, '/m1/invitations/accept', { token });
try {
  await test('verified issuer/subject identity; school isolation and stable three-system mappings', async () => {
    [alice, bob, owner, shared] = await Promise.all(['alice', 'bob', 'moda', 'shared'].map(login));
    assert.equal(owner.schools.find((s) => s.school_id === 'north').role, 'owner');
    assert.equal((await api(alice, '/m0/schools/south/avatar')).status, 403);
    assert.equal((await api(alice, '/api/spaces/south/scene')).status, 403);
    const one = ok(await api(alice, '/m0/schools/north/identities', {})),
      two = ok(await api(alice, '/m0/schools/north/identities', {}));
    assert.deepEqual(one, two);
    social = ok(await api(alice, '/m0/schools/north/social', {}));
  });
  await test('organization creation, email-bound one-use invitation, partner boundary and delegated moderation', async () => {
    for (const [id, kind] of [
      [orgA, 'student'],
      [orgB, 'student'],
      [orgP, 'partner'],
    ])
      ok(
        await api(owner, north + '/organizations', {
          requestId: randomUUID(),
          orgId: id,
          name: 'Fictional ' + id,
          kind,
        }),
      );
    assert.equal(
      (
        await api(alice, north + '/organizations', {
          requestId: randomUUID(),
          orgId: 'forged-' + run,
          name: 'forged',
          kind: 'student',
        })
      ).status,
      403,
    );
    const i = await invite(
      owner,
      north + '/organizations/' + orgA,
      'alice@m0.invalid',
      'moderator',
    );
    assert.equal((await accept(shared, i.token)).status, 403);
    ok(await accept(alice, i.token));
    assert.equal((await accept(alice, i.token)).status, 409);
    ok(
      await accept(
        shared,
        (await invite(owner, north + '/organizations/' + orgB, 'shared@m0.invalid', 'member'))
          .token,
      ),
    );
    assert.equal((await api(alice, north + '/organizations/' + orgB + '/forum')).status, 403);
    assert.equal((await api(bob, north + '/organizations')).status, 403);
    const email = 'partner-' + run + '@m1.invalid',
      name = 'partner-' + run,
      password = 'M1-fixture-' + randomUUID();
    await admin('users', 'POST', {
      username: name,
      email,
      emailVerified: true,
      enabled: true,
      firstName: 'Fixture',
      lastName: 'Partner',
      credentials: [{ type: 'password', value: password, temporary: false }],
    });
    partnerFixture = { username: name, credentials: [{ value: password }] };
    fixtures.push(partnerFixture);
    partner = await login(name);
    ok(
      await accept(
        partner,
        (await invite(owner, north + '/organizations/' + orgP, email, 'partner')).token,
      ),
    );
    assert.equal((await api(partner, north + '/forum')).status, 403);
    assert.equal((await api(partner, '/m0/schools/north/forum')).status, 403);
    assert.equal((await api(partner, north + '/organizations/' + orgA + '/forum')).status, 403);
    ok(await api(partner, north + '/organizations/' + orgP + '/forum'));
    const orgName = 'orgonly-' + run,
      orgPassword = 'M1-fixture-' + randomUUID();
    await admin('users', 'POST', {
      username: orgName,
      email: orgName + '@m1.invalid',
      emailVerified: true,
      enabled: true,
      firstName: 'Fixture',
      lastName: 'Organization',
      credentials: [{ type: 'password', value: orgPassword, temporary: false }],
    });
    fixtures.push({ username: orgName, credentials: [{ value: orgPassword }] });
    const orgOnly = await login(orgName);
    ok(
      await accept(
        orgOnly,
        (await invite(owner, north + '/organizations/' + orgA, orgName + '@m1.invalid', 'member'))
          .token,
      ),
    );
    const orgMe = ok(await api(orgOnly, '/m0/me'));
    assert.equal(orgMe.schools.find((x) => x.school_id === 'north').role, 'affiliate');
    assert.equal((await api(orgOnly, north + '/forum')).status, 403);
    assert.equal((await api(orgOnly, '/m0/schools/north/forum')).status, 403);
    ok(await api(orgOnly, north + '/organizations/' + orgA + '/forum'));
  });
  await test('ownership handover, optimistic revisions, last-owner protection and existing token privilege loss', async () => {
    const members = () =>
      api(owner, north + '/members')
        .then(ok)
        .then((d) => d.members);
    const row = (await members()).find((m) => m.user_id === shared.userId);
    ok(
      await api(owner, north + '/members', {
        requestId: randomUUID(),
        userId: shared.userId,
        role: 'owner',
        active: true,
        expectedRevision: row.revision,
      }),
    );
    assert.equal(
      (
        await api(owner, north + '/members', {
          requestId: randomUUID(),
          userId: shared.userId,
          role: 'student',
          active: true,
          expectedRevision: row.revision,
        })
      ).status,
      409,
    );
    const old = (await members()).find((m) => m.user_id === owner.userId);
    ok(
      await api(shared, north + '/members', {
        requestId: randomUUID(),
        userId: owner.userId,
        role: 'student',
        active: true,
        expectedRevision: old.revision,
      }),
    );
    assert.equal((await api(owner, north + '/members')).status, 403);
    const current = ok(await api(shared, north + '/members')).members.find(
      (m) => m.user_id === shared.userId,
    );
    assert.equal(
      (
        await api(shared, north + '/members', {
          requestId: randomUUID(),
          userId: shared.userId,
          role: 'student',
          active: true,
          expectedRevision: current.revision,
        })
      ).status,
      409,
    );
    const former = ok(await api(shared, north + '/members')).members.find(
      (m) => m.user_id === owner.userId,
    );
    ok(
      await api(shared, north + '/members', {
        requestId: randomUUID(),
        userId: owner.userId,
        role: 'owner',
        active: true,
        expectedRevision: former.revision,
      }),
    );
    ok(
      await api(owner, north + '/members', {
        requestId: randomUUID(),
        userId: shared.userId,
        role: 'student',
        active: true,
        expectedRevision: current.revision,
      }),
    );
    assert.ok(
      ok(await api(owner, north + '/audit')).entries.some((e) => e.action === 'membership.update'),
    );
  });
  await test('avatar receipt and A2A ownership persist in PostgreSQL runtime, same receipt on retry', async () => {
    const path = '/m0/schools/north/avatar',
      old = ok(await api(alice, path)),
      input = {
        requestId: randomUUID(),
        expectedVersion: old.version,
        recipe: { ...defaultRecipe, hair: 'bob', glasses: 'round' },
      };
    const saved = ok(await api(alice, path, input, 'PUT'));
    assert.deepEqual(ok(await api(alice, path, input, 'PUT')), saved);
    const client = new BaseClient({ url: config.origin, token: alice.token }),
      agent = 'north-reception';
    const messageId = randomUUID();
    const one = await client.send(agent, 'M1 durable school inbox ' + run, {
      messageId,
      skillId: 'message.leave',
    });
    task = one.task;
    assert.equal(
      (
        await client.send(agent, 'M1 durable school inbox ' + run, {
          messageId,
          skillId: 'message.leave',
        })
      ).task.id,
      task.id,
    );
    const {
      rows: [row],
    } = await db.pool.query('SELECT state FROM hd_runtime_state');
    assert.equal(row.state.tasks[task.id].owner, alice.userId);
  });
  await test('native queue interruption reconciles without a second post or changed request', async () => {
    const s = config.schools[0],
      path = north + '/organizations/' + orgA + '/forum';
    const posting = await services.forum(s, 'posting-state', { userId: alice.userId });
    if (posting.retryAfterMs > 0) {
      console.log(
        'Fixture preparation respects existing posting cooldown: ' +
          Math.ceil(posting.retryAfterMs / 1000) +
          's',
      );
      await new Promise((r) => setTimeout(r, posting.retryAfterMs + 30));
    }
    await services.forum(s, 'fault', { point: 'after-queue' });
    const input = {
      action: 'submit',
      requestId: randomUUID(),
      title: 'M1 source ' + run,
      content: 'Fictional memory for source reconciliation verification only.',
    };
    const submitted = await api(alice, path, input);
    assert.equal(submitted.status, 503);
    item = await until(async () =>
      ok(await api(alice, path)).items.find(
        (i) => i.title === input.title && i.status === 'pending',
      ),
    );
    assert.equal(ok(await api(alice, path, input)).id, item.id);
    assert.equal(
      (
        await api(alice, path, {
          ...input,
          content: 'Altered content is rejected on the same immutable request.',
        })
      ).status,
      409,
    );
  });
  await test('native publish crash window recovers a single event, contribution and deduplicated notification', async () => {
    await services.forum(config.schools[0], 'fault', { point: 'after-publish' });
    const path = north + '/organizations/' + orgA + '/forum';
    assert.equal((await api(alice, path, { action: 'approve', id: item.id })).status, 503);
    const event = await until(async () => {
      const { rows } = await db.pool.query('SELECT envelope FROM hd_events WHERE source_id=$1', [
        item.id,
      ]);
      return rows[0]?.envelope;
    });
    for (let n = 0; n < 10; n++) await applyForumEvent(db, 'north', event);
    assert.equal(event.organizationId, orgA);
    assert.equal(event.onBehalfOf, null);
    assert.equal(
      (await db.pool.query('SELECT * FROM hd_contributions WHERE event_id=$1', [event.eventId]))
        .rowCount,
      1,
    );
    assert.equal(
      (await db.pool.query('SELECT * FROM hd_notifications WHERE event_id=$1', [event.eventId]))
        .rowCount,
      1,
    );
    await assert.rejects(applyForumEvent(db, 'north', { ...event, status: 'withdrawn' }), {
      code: 'event_conflict',
    });
    assert.equal(
      ok(await api(shared, north + '/organizations/' + orgB + '/forum')).items.some(
        (i) => i.id === item.id,
      ),
      false,
    );
    const notifications = ok(await api(alice, north + '/notifications'));
    const notice = notifications.items.find((n) => n.event_id === event.eventId);
    assert.ok(notice && !notice.read_at);
    ok(await api(alice, north + '/notifications', { id: notice.id }));
    assert.ok(
      ok(await api(alice, north + '/notifications')).items.find((n) => n.id === notice.id).read_at,
    );
    assert.equal(
      ok(await api(shared, north + '/notifications')).items.some(
        (n) => n.event_id === event.eventId,
      ),
      false,
    );
  });
  await test('withdraw crash recovers one reversal; ledger repairs corrupt score and remote outbox', async () => {
    await services.forum(config.schools[0], 'fault', { point: 'after-withdraw' });
    assert.equal(
      (
        await api(alice, north + '/organizations/' + orgA + '/forum', {
          action: 'withdraw',
          id: item.id,
        })
      ).status,
      503,
    );
    await until(async () => {
      const { rows } = await db.pool.query(
        'SELECT * FROM hd_events WHERE source_id=$1 AND source_revision=2',
        [item.id],
      );
      return rows[0];
    });
    const {
      rows: [sum],
    } = await db.pool.query(
      'SELECT count(*)::int AS n,sum(delta)::int AS total FROM hd_contributions WHERE event_id IN(SELECT event_id FROM hd_events WHERE source_id=$1)',
      [item.id],
    );
    assert.deepEqual(sum, { n: 2, total: 0 });
    await db.pool.query("UPDATE hd_scores SET score=999 WHERE school_id='north' AND user_id=$1", [
      alice.userId,
    ]);
    const reconciled = ok(await api(owner, north + '/reconcile', {}));
    assert.deepEqual(reconciled.blocked, []);
    const {
      rows: [score],
    } = await db.pool.query("SELECT score FROM hd_scores WHERE school_id='north' AND user_id=$1", [
      alice.userId,
    ]);
    const expected = (
      await db.pool.query(
        "SELECT sum(delta)::int AS score FROM hd_contributions WHERE school_id='north' AND user_id=$1",
        [alice.userId],
      )
    ).rows[0].score;
    assert.equal(score.score, expected);
    await until(
      async () => !(await db.pool.query('SELECT 1 FROM hd_outbox WHERE NOT delivered')).rowCount,
    );
  });
  await test('school and IdP revocation deny existing Base bearer and native Nakama sessions', async () => {
    const target = ok(await api(owner, north + '/members')).members.find(
      (m) => m.user_id === alice.userId,
    );
    ok(
      await api(owner, north + '/members', {
        requestId: randomUUID(),
        userId: alice.userId,
        role: target.role,
        active: false,
        expectedRevision: target.revision,
      }),
    );
    assert.equal((await api(alice, '/m0/schools/north/avatar')).status, 403);
    assert.equal(
      (await call(config.schools[0].nakamaUrl + '/v2/account', { token: social.session.token }))
        .status,
      403,
    );
    ok(
      await api(owner, north + '/members', {
        requestId: randomUUID(),
        userId: alice.userId,
        role: target.role,
        active: true,
        expectedRevision: target.revision + 1,
      }),
    );
    const fixture = fixtures.find((x) => x.username === 'alice');
    const account = await admin('users/' + fixture.id);
    await admin('users/' + fixture.id, 'PUT', { ...account, enabled: false });
    try {
      assert.ok([401, 403].includes((await api(alice, '/m0/schools/north/avatar')).status));
      assert.equal(
        (await call(config.schools[0].nakamaUrl + '/v2/account', { token: social.session.token }))
          .status,
        403,
      );
    } finally {
      await admin('users/' + fixture.id, 'PUT', { ...account, enabled: true });
    }
  });
  await mkdir('qa/m1', { recursive: true });
  await writeFile(
    'qa/m1/integration.json',
    JSON.stringify(
      {
        scope: 'automated real Keycloak/PostgreSQL/NodeBB/Nakama on Ubuntu WSL, one host',
        startedAt: new Date(started).toISOString(),
        elapsedMs: Date.now() - started,
        results,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ passed: results.length, seconds: (Date.now() - started) / 1000 }));
} finally {
  await db.close();
}
