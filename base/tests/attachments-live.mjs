import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, api } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createAttachments, validateUpload } from '../src/platform/attachments.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Isolated campus fixture required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  checks = [],
  root = '/attachments/schools/north';
const [a, b, peer] = await Promise.all(['alice', 'bob', 'shared'].map(login));
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const dataBase64 = Buffer.from('虚构校园志愿证明，仅自动化验证。').toString('base64'),
  input = {
    requestId: randomUUID(),
    name: '志愿证明.txt',
    mimeType: 'text/plain',
    dataBase64,
    purpose: 'community',
    targetId: randomUUID(),
  };
const attachments = createAttachments(db, null, null);
let saved;
try {
  await test('content sniff, explicit type and file size validation', async () => {
    assert.throws(() => validateUpload({ ...input, mimeType: 'text/html' }), {
      code: 'attachment_name_or_type_invalid',
    });
    assert.throws(() => validateUpload({ ...input, mimeType: 'image/png' }), {
      code: 'attachment_content_type_mismatch',
    });
    assert.throws(() => validateUpload({ ...input, name: '../private.txt' }), {
      code: 'attachment_name_or_type_invalid',
    });
    assert.throws(() =>
      validateUpload({ ...input, dataBase64: Buffer.alloc(524289, 65).toString('base64') }),
    );
  });
  await test('controlled upload is exact-once, private and downloadable only with current authorization', async () => {
    saved = ok(await api(a, root, input));
    assert.deepEqual(ok(await api(a, root, input)), saved);
    assert.equal((await api(a, root, { ...input, name: 'altered.txt' })).status, 409);
    assert.equal((await api(b, root + '/' + saved.attachmentId)).status, 403);
    assert.equal((await api(peer, root + '/' + saved.attachmentId + '/download')).status, 403);
    const r = await fetch(config.origin + root + '/' + saved.attachmentId + '/download', {
      headers: { Authorization: 'Bearer ' + a.token },
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /^attachment;/);
    assert.equal(r.headers.get('content-type'), 'application/octet-stream');
    assert.equal(await r.text(), Buffer.from(dataBase64, 'base64').toString());
    assert.equal(
      (
        await db.tx((c) =>
          attachments.validateAttachment(c, {
            schoolId: 'north',
            userId: a.userId,
            attachmentId: saved.attachmentId,
            purpose: 'community',
            targetId: input.targetId,
            scopeId: '',
          }),
        )
      ).sha256,
      saved.sha256,
    );
    await assert.rejects(
      db.tx((c) =>
        attachments.validateAttachment(c, {
          schoolId: 'north',
          userId: a.userId,
          attachmentId: saved.attachmentId,
          purpose: 'community',
          targetId: randomUUID(),
          scopeId: '',
        }),
      ),
      { code: 'attachment_reference_denied' },
    );
  });
  await test('withdrawal stops download and subsequent verification while preserving audit', async () => {
    ok(
      await api(a, root + '/' + saved.attachmentId + '/state', {
        requestId: randomUUID(),
        expectedRevision: 1,
        status: 'withdrawn',
        reason: '测试撤回证明',
      }),
    );
    assert.equal((await api(a, root + '/' + saved.attachmentId + '/download')).status, 410);
    await assert.rejects(
      db.tx((c) =>
        attachments.validateAttachment(c, {
          schoolId: 'north',
          userId: a.userId,
          attachmentId: saved.attachmentId,
          purpose: 'community',
          targetId: input.targetId,
          scopeId: '',
        }),
      ),
      { code: 'attachment_unavailable' },
    );
    const row = (
      await db.pool.query('SELECT body,sha256 FROM hd_attachments WHERE attachment_id=$1', [
        saved.attachmentId,
      ])
    ).rows[0];
    assert.ok(row.body);
    assert.equal(row.sha256, saved.sha256);
    ok(
      await api(a, root + '/' + saved.attachmentId + '/state', {
        requestId: randomUUID(),
        expectedRevision: 2,
        status: 'deleted',
        reason: '测试删除原始附件',
      }),
    );
    assert.equal(
      (
        await db.pool.query('SELECT body FROM hd_attachments WHERE attachment_id=$1', [
          saved.attachmentId,
        ])
      ).rows[0].body,
      null,
    );
  });
  await test('expiry stops reads and removes only expired unheld bytes', async () => {
    const x = ok(await api(a, root, { ...input, requestId: randomUUID() }));
    await db.pool.query(
      "UPDATE hd_attachments SET expires_at=now()-interval '1 second' WHERE attachment_id=$1",
      [x.attachmentId],
    );
    assert.equal((await api(a, root + '/' + x.attachmentId + '/download')).status, 410);
    const r = await attachments.expire('north');
    assert.ok(r.expired >= 1);
    const n = (
      await db.pool.query('SELECT body,status,sha256 FROM hd_attachments WHERE attachment_id=$1', [
        x.attachmentId,
      ])
    ).rows[0];
    assert.equal(n.body, null);
    assert.equal(n.status, 'expired');
    assert.equal(n.sha256, x.sha256);
  });
  await mkdir('qa/campus', { recursive: true });
  await writeFile(
    'qa/campus/attachments-live.json',
    JSON.stringify(
      { status: 'PASS', checks, scope: 'isolated fixture; all uploaded content is synthetic' },
      null,
      2,
    ) + '\n',
  );
} finally {
  await db.close();
}
