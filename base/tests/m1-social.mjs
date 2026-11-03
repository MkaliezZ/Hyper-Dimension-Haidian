import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { config, login, api, until, call } from './m1-helpers.mjs';
const started = Date.now(),
  checks = [],
  pool = new pg.Pool({ connectionString: config.databaseUrl });
if (process.env.HD_M1_TEST_FIXTURE !== '1')
  throw Error('Explicit isolated fixture acceptance required');
const [a, b, mod, other] = await Promise.all(['alice', 'shared', 'moda', 'bob'].map(login));
const route = '/m1/schools/north';
const ok = async (u, p, body) => {
  const r = await api(u, route + p, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
async function check(name, fn) {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
}
try {
  let conversation, msg;
  await check(
    'Nakama-backed private message, immutable retry, non-participant and school isolation',
    async () => {
      conversation = (
        await ok(a, '/chat', { kind: 'dm', peerId: b.userId, requestId: randomUUID() })
      ).conversationId;
      const body = {
        action: 'send',
        requestId: randomUUID(),
        text: '仅限两位虚拟参与者的测试消息',
      };
      msg = await ok(a, `/chat/${conversation}/messages`, body);
      assert.deepEqual(await ok(a, `/chat/${conversation}/messages`, body), msg);
      assert.equal(
        (await api(a, route + `/chat/${conversation}/messages`, { ...body, text: 'changed' }))
          .status,
        409,
      );
      const page = await ok(b, `/chat/${conversation}/messages`);
      assert.equal(page.items.at(-1).text, body.text);
      assert.equal((await api(mod, route + `/chat/${conversation}/messages`)).status, 403);
      assert.equal((await api(other, route + `/chat/${conversation}/messages`)).status, 403);
      assert.equal(
        (await api(a, '/m1/schools/south/chat/' + conversation + '/messages')).status,
        403,
      );
      const r = await pool.query('SELECT * FROM hd_chat_messages WHERE message_id=$1', [
        msg.messageId,
      ]);
      assert.ok(r.rows[0].native_version);
      assert.equal('text' in r.rows[0], false);
    },
  );
  await check('edit CAS, read cursor, report privilege audit, block and unblock', async () => {
    const edited = await ok(a, `/chat/${conversation}/messages`, {
      action: 'edit',
      requestId: randomUUID(),
      messageId: msg.messageId,
      expectedRevision: 1,
      text: '已修订的私信正文',
    });
    assert.equal(edited.revision, 2);
    assert.equal(
      (
        await api(b, route + `/chat/${conversation}/messages`, {
          action: 'remove',
          requestId: randomUUID(),
          messageId: msg.messageId,
          expectedRevision: 2,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await api(a, route + `/chat/${conversation}/messages`, {
          action: 'edit',
          requestId: randomUUID(),
          messageId: msg.messageId,
          expectedRevision: 1,
          text: 'stale write',
        })
      ).status,
      409,
    );
    await ok(b, `/chat/${conversation}/read`, { sequence: edited.sequence });
    const report = await ok(b, `/chat/${conversation}/report`, {
      messageId: msg.messageId,
      reason: '隔离自动验收的虚拟举报',
    });
    assert.equal(
      (await api(a, route + '/reports', { reportId: report.report_id, reason: '越权审核' })).status,
      403,
    );
    const review = await ok(mod, '/reports', {
      reportId: report.report_id,
      reason: '处理明确举报的单条消息',
      resolve: true,
    });
    assert.equal(review.text, '已修订的私信正文');
    await ok(b, '/blocks', { userId: a.userId, blocked: true });
    assert.equal(
      (
        await api(a, route + `/chat/${conversation}/messages`, {
          action: 'send',
          requestId: randomUUID(),
          text: '屏蔽后不应送达',
        })
      ).status,
      403,
    );
    assert.equal((await api(b, route + `/chat/${conversation}/messages`)).status, 403);
    await ok(b, '/blocks', { userId: a.userId, blocked: false });
    assert.equal(
      (await ok(a, `/chat/${conversation}/messages`)).items.at(-1).text,
      '已修订的私信正文',
    );
  });
  await check(
    'live SSE delivery, cursor reconnect, same open stream loses access on revocation',
    async () => {
      const ac = new AbortController(),
        events = [];
      const r = await fetch(
        config.origin + route + `/chat/${conversation}/stream?after=${msg.sequence}`,
        { headers: { Authorization: 'Bearer ' + b.token }, signal: ac.signal },
      );
      assert.equal(r.status, 200);
      const reader = r.body.getReader(),
        decoder = new TextDecoder();
      let wire = '';
      const consuming = (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            wire += decoder.decode(value, { stream: true });
            events.push(wire);
          }
        } catch (e) {
          if (e.name !== 'AbortError') throw e;
        }
      })();
      const send = await ok(a, `/chat/${conversation}/messages`, {
        action: 'send',
        requestId: randomUUID(),
        text: '通过实时流发送的消息',
      });
      await until(() => wire.includes(send.messageId));
      const recovered = await ok(b, `/chat/${conversation}/messages?after=${send.sequence}`);
      assert.equal(recovered.items.length, 0);
      const members = await ok(mod, '/members'),
        m = members.members.find((x) => x.user_id === b.userId);
      await ok(mod, '/members', {
        requestId: randomUUID(),
        userId: b.userId,
        role: m.role,
        active: false,
        expectedRevision: m.revision,
      });
      try {
        await until(() => wire.includes('event: denied'));
        assert.equal((await api(b, route + `/chat/${conversation}/messages`)).status, 403);
      } finally {
        const current = (await ok(mod, '/members')).members.find((x) => x.user_id === b.userId);
        await ok(mod, '/members', {
          requestId: randomUUID(),
          userId: b.userId,
          role: current.role,
          active: true,
          expectedRevision: current.revision,
        });
        ac.abort();
        await consuming;
      }
    },
  );
  await check(
    'school room and organization room are independent; no arbitrary native storage access',
    async () => {
      const room = await ok(a, '/chat', { kind: 'room', requestId: randomUUID() });
      await ok(mod, `/chat/${room.conversationId}/messages`, {
        action: 'send',
        requestId: randomUUID(),
        text: '虚拟学校公共讨论消息',
      });
      assert.ok((await ok(a, `/chat/${room.conversationId}/messages`)).items.length);
      const org = 'social-' + randomUUID().slice(0, 8);
      await ok(mod, '/organizations', {
        requestId: randomUUID(),
        orgId: org,
        name: '隔离消息验收组织',
        kind: 'student',
      });
      const orgRoom = await ok(mod, '/chat', { kind: 'room', orgId: org, requestId: randomUUID() });
      assert.equal((await api(a, route + `/chat/${orgRoom.conversationId}/messages`)).status, 403);
      const s = config.schools.find((s) => s.schoolId === 'north'),
        social = await call(config.origin + '/m0/schools/north/social', {
          token: a.token,
          body: {},
        });
      assert.equal(social.status, 200);
      const nk = await call(s.nakamaUrl + '/v2/rpc/hd_message', {
        token: social.data.session.token,
        body: JSON.stringify({ action: 'get', id: msg.messageId }),
      });
      assert.equal(nk.status, 403);
      const native = await call(s.nakamaUrl + '/v2/storage', {
        token: social.data.session.token,
        body: {
          object_ids: [
            {
              collection: 'hd_messages',
              key: msg.messageId,
              user_id: '00000000-0000-0000-0000-000000000000',
            },
          ],
        },
      });
      // Nakama explicitly rejects the nil system owner in public read requests (grpc INVALID_ARGUMENT).
      assert.equal(native.status, 400);
      assert.equal(native.data.code, 3);
      assert.match(native.data.message, /Invalid user ID/);
    },
  );
  await check(
    'NodeBB native edit review preserves pid, protects draft and gives zero extra contribution',
    async () => {
      const input = {
        action: 'submit',
        requestId: randomUUID(),
        title: '原生编辑审核验收主题',
        content: '这是一个用于原生编辑到贡献对账的虚拟正文。',
      };
      const submitted = await ok(a, '/forum', input);
      await ok(mod, '/forum', { action: 'approve', id: submitted.id });
      const initial = await ok(a, '/forum', { action: 'detail', id: submitted.id });
      const draft = await ok(a, '/forum', {
        action: 'edit',
        id: submitted.id,
        requestId: randomUUID(),
        expectedRevision: initial.revision,
        title: '已审核的原生编辑标题',
        content: '这是修改后的新正文，审核前不应替换原生已发布内容。',
      });
      const hidden = await ok(b, '/forum', { action: 'detail', id: submitted.id });
      assert.equal(hidden.draft, null);
      assert.equal(hidden.content, input.content);
      assert.equal(
        (
          await api(b, route + '/forum', {
            action: 'edit',
            id: submitted.id,
            requestId: randomUUID(),
            expectedRevision: initial.revision,
            title: '越权修改测试',
            content: '这个正文不能由其他普通用户编辑。',
          })
        ).status,
        403,
      );
      const approve = {
        action: 'approve-edit',
        id: submitted.id,
        requestId: randomUUID(),
        expectedRevision: initial.revision,
        draftId: draft.draftId,
      };
      await ok(mod, '/forum', approve);
      await ok(mod, '/forum', approve);
      const changed = await ok(a, '/forum', { action: 'detail', id: submitted.id });
      assert.equal(changed.pid, initial.pid);
      assert.equal(changed.revision, 2);
      assert.equal(changed.title, '已审核的原生编辑标题');
      assert.match(changed.content, /修改后的新正文/);
      const ledger = await pool.query(
        'SELECT sum(delta)::int AS n,count(*)::int AS c FROM hd_contributions WHERE event_id IN (SELECT event_id FROM hd_events WHERE school_id=$1 AND source_id=$2)',
        ['north', submitted.id],
      );
      assert.deepEqual(ledger.rows[0], { n: 10, c: 1 });
    },
  );
} finally {
  await pool.end();
  await mkdir('qa/m1-social', { recursive: true });
  await writeFile(
    'qa/m1-social/integration.json',
    JSON.stringify(
      {
        status: checks.length === 5 ? 'PASS' : 'INCOMPLETE',
        checks,
        durationMs: Date.now() - started,
        environment: 'isolated WSL Ubuntu services; synthetic accounts; not human acceptance',
      },
      null,
      2,
    ),
  );
}
