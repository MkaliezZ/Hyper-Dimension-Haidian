import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import pg from 'pg';
import { config, login, api } from './m1-helpers.mjs';
const started = Date.now(),
  a = await login('alice'),
  b = await login('shared'),
  root = '/m1/schools/north';
const list = await api(a, root + '/chat');
assert.equal(list.status, 200);
const dm = list.data.conversations.find(
  (v) => v.kind === 'dm' && v.participants.includes(b.userId),
);
assert.ok(dm);
const page = await api(b, root + `/chat/${dm.conversation_id}/messages`);
assert.equal(page.status, 200);
assert.ok(page.data.items.some((m) => m.status === 'active' && m.text));
const old = page.data.items.find((m) => m.status === 'active');
const unauth = await login('moda');
assert.equal((await api(unauth, root + `/chat/${dm.conversation_id}/messages`)).status, 403);
const sent = await api(a, root + `/chat/${dm.conversation_id}/messages`, {
  action: 'send',
  requestId: randomUUID(),
  text: '独立恢复实例的新消息，原库不变',
});
assert.equal(sent.status, 200);
const received = await api(b, root + `/chat/${dm.conversation_id}/messages?after=${old.sequence}`);
assert.ok(received.data.items.some((m) => m.messageId === sent.data.messageId));
if (!process.env.HD_M1_SOURCE_CONFIG)
  throw Error('Original source config required for read-only isolation comparison');
const source = JSON.parse(await readFile(process.env.HD_M1_SOURCE_CONFIG, 'utf8')),
  p = new pg.Pool({ connectionString: source.databaseUrl });
try {
  assert.equal(
    (await p.query('SELECT 1 FROM hd_chat_messages WHERE message_id=$1', [sent.data.messageId]))
      .rowCount,
    0,
  );
  const r = await p.query('SELECT user_id FROM hd_users WHERE user_id=$1', [a.userId]);
  assert.equal(r.rowCount, 1);
  assert.equal(
    (await p.query('SELECT 1 FROM hd_chat_messages WHERE message_id=$1', [old.messageId])).rowCount,
    1,
  );
} finally {
  await p.end();
}
const report = {
  status: 'PASS',
  environment: 'independent restored six-service clone',
  restoredBodyAndPermissions: true,
  stableSourceMessageId: old.messageId,
  newMessageOnlyInClone: sent.data.messageId,
  durationMs: Date.now() - started,
};
await writeFile('qa/m1-social/restore-live.json', JSON.stringify(report, null, 2));
console.log(
  'PASS restored login, old Nakama message and private ACL, new send in independent clone',
);
