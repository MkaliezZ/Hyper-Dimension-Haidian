import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, api, call, until } from './m1-helpers.mjs';
import { openPlatform, hash } from '../src/platform/db.mjs';
import { createServices } from '../src/platform/services.mjs';
import { createChat } from '../src/platform/chat.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1')
  throw Error('Explicit isolated fixture acceptance required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  services = createServices(db, config),
  chat = createChat(db, null, services, config);
const [a, b, mod] = await Promise.all(['alice', 'shared', 'moda'].map(login)),
  root = '/m1/schools/north',
  checks = [],
  started = Date.now();
const ok = async (u, p, body) => {
  const r = await api(u, root + p, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
async function test(name, fn) {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
}
try {
  const conv = (await ok(a, '/chat', { kind: 'dm', peerId: b.userId, requestId: randomUUID() }))
    .conversationId;
  await test('retention preview/apply, body removal in source, held body hidden and operator audit', async () => {
    const m = await ok(a, `/chat/${conv}/messages`, {
      action: 'send',
      requestId: randomUUID(),
      text: '应按到期策略移除的虚拟消息',
    });
    await db.pool.query(
      "UPDATE hd_chat_messages SET expires_at=now()-interval '1 second',legal_hold=true WHERE message_id=$1",
      [m.messageId],
    );
    assert.equal(
      (await ok(b, `/chat/${conv}/messages`)).items.find((i) => i.messageId === m.messageId).text,
      null,
    );
    assert.ok((await chat.expire('north')).candidates.some((i) => i.message_id === m.messageId));
    assert.ok((await chat.expire('north', { apply: true })).held.includes(m.messageId));
    await db.pool.query('UPDATE hd_chat_messages SET legal_hold=false WHERE message_id=$1', [
      m.messageId,
    ]);
    assert.ok((await chat.expire('north', { apply: true })).expired.includes(m.messageId));
    const s = config.schools[0],
      r = await call(
        s.nakamaUrl + '/v2/rpc/hd_message?http_key=' + encodeURIComponent(s.nakamaHttpKey),
        { body: JSON.stringify({ key: s.nakamaKey, action: 'get', id: m.messageId }) },
      );
    assert.equal(JSON.parse(r.data.payload).value.text, null);
    assert.equal(
      (
        await db.pool.query(
          "SELECT 1 FROM hd_audit WHERE action='chat.expire' AND object_id=$1 AND actor_id IS NULL",
          [m.messageId],
        )
      ).rowCount,
      1,
    );
  });
  await test('source committed without Base receipt: reconciliation recovers one event with no resend', async () => {
    const mid = randomUUID(),
      opid = randomUUID(),
      fingerprint = hash(randomUUID());
    await db.tx(async (c) => {
      await c.query(
        'INSERT INTO hd_chat_messages(message_id,conversation_id,school_id,sender_id) VALUES($1,$2,$3,$4)',
        [mid, conv, 'north', a.userId],
      );
      await c.query(
        "INSERT INTO hd_chat_operations(operation_id,school_id,user_id,request_id,message_id,action,input_hash,expected_revision) VALUES($1,'north',$2,$3,$4,'send',$5,0)",
        [opid, a.userId, randomUUID(), mid, fingerprint],
      );
    });
    const s = config.schools[0],
      source = await call(
        s.nakamaUrl + '/v2/rpc/hd_message?http_key=' + encodeURIComponent(s.nakamaHttpKey),
        {
          body: JSON.stringify({
            key: s.nakamaKey,
            action: 'put',
            id: mid,
            value: {
              schema: 'hyper-dimension.message/v1',
              schoolId: 'north',
              conversationId: conv,
              messageId: mid,
              actor: { kind: 'human', userId: a.userId },
              onBehalfOf: null,
              operationId: opid,
              inputHash: fingerprint,
              revision: 1,
              status: 'active',
              text: '源已写入，模拟回执丢失',
            },
          }),
        },
      );
    assert.equal(source.status, 200);
    await chat.reconcile('north');
    await chat.reconcile('north');
    const rows = (await ok(b, `/chat/${conv}/messages`)).items.filter((i) => i.messageId === mid);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, '源已写入，模拟回执丢失');
  });
  const list = await ok(a, '/forum'),
    topic = list.items.find(
      (i) => i.status === 'published' && i.userId === a.userId && !i.parentId,
    );
  assert.ok(topic, 'Run m1-social first to create its isolated published fixture');
  await test('native edit committed then response fault: stable pid, revision and zero additional score', async () => {
    const initial = await ok(a, '/forum', { action: 'detail', id: topic.id }),
      draft = await ok(a, '/forum', {
        action: 'edit',
        id: topic.id,
        expectedRevision: initial.revision,
        requestId: randomUUID(),
        title: '故障恢复后的原生标题',
        content: '这是原生修改已提交后丢失成功响应的隔离自动验收正文。',
      });
    const s = config.schools[0];
    assert.equal(
      (
        await call(s.forumUrl + '/api/hd/fault', {
          headers: { 'X-HD-Service-Key': s.forumKey },
          body: { point: 'after-edit' },
        })
      ).status,
      200,
    );
    const request = {
      action: 'approve-edit',
      id: topic.id,
      expectedRevision: initial.revision,
      draftId: draft.draftId,
      requestId: randomUUID(),
    };
    assert.equal((await api(mod, root + '/forum', request)).status, 503);
    await until(async () => {
      const d = await ok(a, '/forum', { action: 'detail', id: topic.id });
      return d.revision === initial.revision + 1;
    });
    const d = await ok(a, '/forum', { action: 'detail', id: topic.id });
    assert.equal(d.pid, initial.pid);
    assert.equal(d.content, '这是原生修改已提交后丢失成功响应的隔离自动验收正文。');
    await ok(mod, '/forum', request);
    const ledger = await db.pool.query(
      'SELECT sum(delta)::int AS n FROM hd_contributions WHERE event_id IN (SELECT event_id FROM hd_events WHERE school_id=$1 AND source_id=$2)',
      ['north', topic.id],
    );
    assert.equal(ledger.rows[0].n, 10);
  });
  await test('real queued reply, native reply edit, withdrawal leaves parent topic intact', async () => {
    const state = await services.forum(config.schools[0], 'posting-state', { userId: b.userId });
    if (state.retryAfterMs)
      await new Promise((r) => setTimeout(r, Math.min(state.retryAfterMs + 100, 120100)));
    const reply = await ok(b, '/forum', {
      action: 'submit',
      title: '原生回复验收',
      parentId: topic.id,
      content: '这是从学校论坛创建并进入原生审核队列的回复。',
      requestId: randomUUID(),
    });
    await ok(mod, '/forum', { action: 'approve', id: reply.id });
    const d = await ok(b, '/forum', { action: 'detail', id: reply.id }),
      parent = await ok(a, '/forum', { action: 'detail', id: topic.id });
    assert.equal(d.tid, parent.tid);
    assert.notEqual(d.pid, parent.pid);
    const draft = await ok(b, '/forum', {
      action: 'edit',
      id: reply.id,
      expectedRevision: d.revision,
      requestId: randomUUID(),
      title: d.title,
      content: '审核后的回复修改，不能重命名父主题。',
    });
    await ok(mod, '/forum', {
      action: 'approve-edit',
      id: reply.id,
      expectedRevision: d.revision,
      requestId: randomUUID(),
      draftId: draft.draftId,
    });
    assert.equal((await ok(a, '/forum', { action: 'detail', id: topic.id })).title, parent.title);
    await ok(mod, '/forum', { action: 'withdraw', id: reply.id });
    assert.equal((await ok(a, '/forum', { action: 'detail', id: topic.id })).status, 'published');
    const child = await ok(mod, '/forum', {
      action: 'submit',
      title: '父主题撤回的回复',
      parentId: topic.id,
      content: '这条隔离回复用于验证父主题撤回后的可见性和贡献冲正。',
      requestId: randomUUID(),
    });
    await ok(mod, '/forum', { action: 'approve', id: child.id });
    await ok(mod, '/forum', { action: 'withdraw', id: topic.id });
    assert.equal((await api(a, root + '/forum', { action: 'detail', id: child.id })).status, 404);
    await until(async () => {
      const r = await db.pool.query(
        'SELECT status FROM hd_forum_heads WHERE school_id=$1 AND source_id=$2',
        ['north', child.id],
      );
      return r.rows[0]?.status === 'withdrawn';
    });
  });
} finally {
  chat.close();
  await db.close();
  await mkdir('qa/m1-social', { recursive: true });
  await writeFile(
    'qa/m1-social/governance.json',
    JSON.stringify(
      {
        status: checks.length === 4 ? 'PASS' : 'INCOMPLETE',
        checks,
        durationMs: Date.now() - started,
        sourceFault: 'durable native write before Base receipt; after-edit response failure',
        testData: 'synthetic isolated fixtures',
      },
      null,
      2,
    ),
  );
}
