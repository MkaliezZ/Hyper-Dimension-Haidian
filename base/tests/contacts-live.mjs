import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, call, until } from './m1-helpers.mjs';
import { contactAccount } from './contacts-fixtures.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createIdentity } from '../src/platform/identity.mjs';
import { createContacts } from '../src/platform/contacts.mjs';
import { createChat } from '../src/platform/chat.mjs';
import { createServices } from '../src/platform/services.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Isolated campus required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  checks = [],
  started = Date.now(),
  run = randomUUID(),
  school = 'north';
const [a, b, c, foreign] = await Promise.all([
  contactAccount(db, 'a'),
  contactAccount(db, 'b'),
  contactAccount(db, 'outsider'),
  contactAccount(db, 'foreign', 'south'),
]);
const org = 'contacts-' + run.slice(0, 8),
  otherOrg = org + '-other';
for (const id of [org, otherOrg]) {
  await db.pool.query(
    "INSERT INTO hd_organizations(school_id,org_id,name,kind) VALUES('north',$1,'隔离联系授权测试','student')",
    [id],
  );
  for (const u of [a, b, c])
    await db.pool.query(
      "INSERT INTO hd_org_members(school_id,org_id,user_id,role) VALUES('north',$1,$2,'member')",
      [id, u.userId],
    );
}
let nativeStarted,
  nativeRelease,
  putCount = 0;
const nativeConfig = config.schools.find((s) => s.schoolId === school);
const read = async (req) => {
  let raw = '';
  for await (const part of req) raw += part;
  return raw ? JSON.parse(raw) : {};
};
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};
// Fault-control proxy, forwarding unchanged requests to real isolated Nakama storage.
const proxy = http.createServer(async (req, res) => {
  try {
    const wire = await read(req),
      payload = JSON.parse(wire);
    if (payload.action === 'put') putCount++;
    if (payload.action === 'put' && payload.value?.text === 'hold-native-' + run) {
      nativeStarted();
      await new Promise((r) => {
        nativeRelease = r;
      });
    }
    const upstream = await fetch(nativeConfig.nakamaUrl + req.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wire),
    });
    const content = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    res.end(content);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const localConfig = {
  ...config,
  schools: config.schools.map((s) =>
    s.schoolId === school ? { ...s, nakamaUrl: 'http://127.0.0.1:' + proxy.address().port } : s,
  ),
};
const identity = createIdentity(db, localConfig),
  services = createServices(db, localConfig),
  contacts = createContacts(db, identity, services),
  chat = createChat(db, identity, services, localConfig),
  legacy = createChat(db, identity, services, { ...localConfig, campusEnabled: false });
let active = chat;
const app = http.createServer(async (req, res) => {
  try {
    const args = { url: new URL(req.url, 'http://test'), json, body: read };
    if (!(await contacts(req, res, args)) && !(await active.handle(req, res, args)))
      json(res, 404, {});
  } catch (e) {
    json(res, e.status || 500, { error: e.code || e.message });
  }
});
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + app.address().port,
  base = '/contacts/schools/north',
  social = '/m1/schools/north';
const api = (u, p, body) => call(origin + p, { token: u.token, body }),
  post = (u, p, b) => api(u, p, { requestId: randomUUID(), ...b });
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const check = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const state = (u, peer, scope = org) =>
  api(u, base + '/state?peerId=' + peer.userId + '&org=' + scope).then(ok);
const propose = async (scope = org) => {
  const s = await state(a, b, scope);
  return ok(
    await post(a, base + '/requests', {
      expectedRevision: s.revision,
      peerId: b.userId,
      orgId: scope,
    }),
  );
};
const accept = async (p) =>
  ok(await post(b, base + `/requests/${p.contactId}/accept`, { expectedRevision: p.revision }));
const createInput = { kind: 'dm', orgId: org, peerId: b.userId, requestId: randomUUID() };
let permission, conversation, message, body;
try {
  await check(
    'explicit two-party consent, recipient-only acceptance, scoped CAS and immutable receipts',
    async () => {
      assert.equal((await api(a, social + '/chat', createInput)).status, 403);
      assert.equal(
        (await post(a, base + '/requests', { expectedRevision: 0, peerId: foreign.userId })).status,
        403,
      );
      const input = { requestId: randomUUID(), expectedRevision: 0, peerId: b.userId, orgId: org };
      permission = ok(await api(a, base + '/requests', input));
      assert.deepEqual(ok(await api(a, base + '/requests', input)), permission);
      assert.equal((await api(a, base + '/requests', { ...input, peerId: c.userId })).status, 409);
      assert.equal(
        (await post(a, base + `/requests/${permission.contactId}/accept`, { expectedRevision: 1 }))
          .status,
        403,
      );
      assert.equal(
        (await post(c, base + `/requests/${permission.contactId}/accept`, { expectedRevision: 1 }))
          .status,
        403,
      );
      assert.equal((await api(a, social + '/chat', createInput)).status, 403);
      const acceptInput = { requestId: randomUUID(), expectedRevision: 1 };
      permission = ok(await api(b, base + `/requests/${permission.contactId}/accept`, acceptInput));
      assert.deepEqual(
        ok(await api(b, base + `/requests/${permission.contactId}/accept`, acceptInput)),
        permission,
      );
      assert.equal((await state(a, b)).canSend, true);
      assert.equal(
        (
          await post(a, social + '/chat', {
            ...createInput,
            requestId: randomUUID(),
            orgId: otherOrg,
          })
        ).status,
        403,
      );
      conversation = ok(await api(a, social + '/chat', createInput)).conversationId;
      body = { action: 'send', text: '真实Nakama隔离私信正文 ' + run, requestId: randomUUID() };
      message = ok(await api(a, social + `/chat/${conversation}/messages`, body));
      assert.deepEqual(ok(await api(a, social + `/chat/${conversation}/messages`, body)), message);
      assert.equal(
        ok(await api(b, social + `/chat/${conversation}/messages`)).items.at(-1).text,
        body.text,
      );
      assert.equal((await api(c, social + `/chat/${conversation}/messages`)).status, 403);
      const n = (
        await db.pool.query(
          "SELECT scope_id,payload FROM hd_notifications WHERE school_id=$1 AND user_id=$2 AND payload->>'contactId'=$3",
          [school, b.userId, permission.contactId],
        )
      ).rows;
      assert.ok(n.length);
      assert.ok(
        n.every((x) => x.scope_id === org && !JSON.stringify(x.payload).includes(body.text)),
      );
    },
  );
  await check(
    'existing SSE switches to read-only on revoke; old create/send receipts and edits denied, history and own remove retained',
    async () => {
      const ac = new AbortController(),
        r = await fetch(origin + social + `/chat/${conversation}/stream`, {
          headers: { Authorization: 'Bearer ' + b.token },
          signal: ac.signal,
        });
      let wire = '';
      const consume = (async () => {
        try {
          for await (const part of r.body) wire += Buffer.from(part).toString();
        } catch (e) {
          if (e.name !== 'AbortError') throw e;
        }
      })();
      try {
        await until(() => wire.includes('"canSend":true'));
        permission = ok(
          await post(b, base + `/requests/${permission.contactId}/revoke`, {
            expectedRevision: permission.revision,
          }),
        );
        await until(() => wire.includes('"canSend":false'));
        assert.equal((await api(a, social + '/chat', createInput)).status, 403);
        assert.equal((await api(a, social + `/chat/${conversation}/messages`, body)).status, 403);
        assert.equal(
          (
            await post(a, social + `/chat/${conversation}/messages`, {
              action: 'edit',
              messageId: message.messageId,
              expectedRevision: 1,
              text: '无授权编辑',
            })
          ).status,
          403,
        );
        const history = ok(await api(b, social + `/chat/${conversation}/messages`));
        assert.equal(history.items.at(-1).text, body.text);
        assert.equal(history.canSend, false);
        assert.equal(
          ok(
            await post(a, social + `/chat/${conversation}/messages`, {
              action: 'remove',
              messageId: message.messageId,
              expectedRevision: 1,
            }),
          ).status,
          'deleted',
        );
      } finally {
        ac.abort();
        await consume;
      }
    },
  );
  await check(
    'rejection, contact/request preferences, bilateral blocks and contact reapplication',
    async () => {
      permission = await propose();
      permission = ok(
        await post(b, base + `/requests/${permission.contactId}/reject`, {
          expectedRevision: permission.revision,
        }),
      );
      assert.equal((await state(a, b)).canSend, false);
      let pref = ok(await api(b, base + '/preferences'));
      pref = ok(
        await post(b, base + '/preferences', {
          expectedRevision: pref.revision,
          acceptingContacts: false,
          allowDirectMessages: true,
        }),
      );
      assert.equal(
        (
          await post(a, base + '/requests', {
            expectedRevision: permission.revision,
            peerId: b.userId,
            orgId: org,
          })
        ).status,
        403,
      );
      pref = ok(
        await post(b, base + '/preferences', {
          expectedRevision: pref.revision,
          acceptingContacts: true,
          allowDirectMessages: true,
        }),
      );
      permission = await accept(await propose());
      const prefInput = {
        requestId: randomUUID(),
        expectedRevision: pref.revision,
        acceptingContacts: true,
        allowDirectMessages: false,
      };
      pref = ok(await api(b, base + '/preferences', prefInput));
      assert.deepEqual(ok(await api(b, base + '/preferences', prefInput)), pref);
      assert.equal(
        (
          await post(a, social + `/chat/${conversation}/messages`, {
            action: 'send',
            text: '拒收应拦截',
          })
        ).status,
        403,
      );
      assert.equal(ok(await api(b, social + `/chat/${conversation}/messages`)).canSend, false);
      pref = ok(
        await post(b, base + '/preferences', {
          expectedRevision: pref.revision,
          acceptingContacts: true,
          allowDirectMessages: true,
        }),
      );
      ok(await api(b, social + '/blocks', { userId: a.userId, blocked: true }));
      assert.equal(
        (
          await post(a, social + `/chat/${conversation}/messages`, {
            action: 'send',
            text: '屏蔽应拦截',
          })
        ).status,
        403,
      );
      assert.equal(ok(await api(b, social + `/chat/${conversation}/messages`)).canSend, false);
      ok(await api(b, social + '/blocks', { userId: a.userId, blocked: false }));
      assert.equal((await state(a, b)).canSend, true);
    },
  );
  await check(
    'same connection survives pool saturation; revocation serializes after already-authorized native write and blocks later disclosure',
    async () => {
      const started = new Promise((r) => {
        nativeStarted = r;
      });
      const work = post(a, social + `/chat/${conversation}/messages`, {
        action: 'send',
        text: 'hold-native-' + run,
      });
      await started;
      const blockers = Array.from({ length: 7 }, () =>
        db.tx((c) =>
          c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            school + ':permissions',
          ]),
        ),
      );
      await until(() => db.pool.totalCount === 8 && db.pool.idleCount === 0, 2000);
      const revoke = post(b, base + `/requests/${permission.contactId}/revoke`, {
        expectedRevision: permission.revision,
      });
      nativeRelease();
      const results = await Promise.all([work, ...blockers, revoke]);
      ok(results[0]);
      permission = ok(results.at(-1));
      const previous = putCount;
      assert.equal(
        (
          await post(a, social + `/chat/${conversation}/messages`, {
            action: 'send',
            text: '撤权后不得转交',
          })
        ).status,
        403,
      );
      assert.equal(putCount, previous);
    },
  );
  await check(
    'current organization revocation denies permission and old receipt; fresh grants are not inferred from old M1 messages',
    async () => {
      permission = await accept(await propose());
      await db.tx(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          school + ':permissions',
        ]);
        await c.query(
          'UPDATE hd_org_members SET active=false,revision=revision+1 WHERE school_id=$1 AND org_id=$2 AND user_id=$3',
          [school, org, b.userId],
        );
      });
      assert.equal((await api(a, social + '/chat', createInput)).status, 403);
      assert.equal((await api(a, base + '/state?peerId=' + b.userId + '&org=' + org)).status, 403);
      await db.pool.query(
        'UPDATE hd_org_members SET active=true,revision=revision+1 WHERE school_id=$1 AND org_id=$2 AND user_id=$3',
        [school, org, b.userId],
      );
      active = legacy;
      const legacyId = ok(
        await post(a, social + '/chat', { kind: 'dm', orgId: otherOrg, peerId: b.userId }),
      ).conversationId;
      const old = ok(
        await post(a, social + `/chat/${legacyId}/messages`, {
          action: 'send',
          text: '旧M1消息不等于新授权',
        }),
      );
      active = chat;
      const history = ok(await api(a, social + `/chat/${legacyId}/messages`));
      assert.equal(history.canSend, false);
      assert.equal(history.items.at(-1).text, '旧M1消息不等于新授权');
      assert.equal(
        (
          await post(a, social + `/chat/${legacyId}/messages`, {
            action: 'send',
            text: '旧消息不能自动授权',
          })
        ).status,
        403,
      );
      ok(
        await post(a, social + `/chat/${legacyId}/messages`, {
          action: 'remove',
          messageId: old.messageId,
          expectedRevision: old.revision,
        }),
      );
    },
  );
  await mkdir('qa/campus', { recursive: true });
  await writeFile(
    'qa/campus/contacts-live.json',
    JSON.stringify(
      {
        status: 'PASS',
        run,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        checks,
        scope:
          'Real Keycloak accounts, PostgreSQL, isolated Nakama through unchanged HTTP proxy. No actual campus or physical-device acceptance.',
        org,
        conversationId: conversation,
        users: [a.userId, b.userId, c.userId, foreign.userId],
      },
      null,
      2,
    ),
  );
} finally {
  active = chat;
  chat.close();
  legacy.close();
  app.closeAllConnections();
  await new Promise((r) => app.close(r));
  await new Promise((r) => proxy.close(r));
  await db.close();
}
