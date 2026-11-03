import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { config, login, api, until } from './m1-helpers.mjs';
import { BaseClient } from '../src/sdk/client.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Isolated restored fixture required');
const [alice, owner, bob] = await Promise.all(['alice', 'moda', 'bob'].map(login));
const pool = new pg.Pool({ connectionString: config.databaseUrl }),
  run = randomUUID().slice(0, 8),
  checks = [];
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const post = async (u, path, input) =>
  ok(await api(u, path, { requestId: randomUUID(), ...input }));
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const state = async () => ok(await api(owner, '/knowledge-admin/schools/north/status'));
const search = async (u, orgId, includeHistory = true) =>
  api(u, '/history-index/schools/north/search', {
    orgId,
    query: '历史审定榕树校园',
    includeHistory,
  });
const client = new BaseClient({ url: config.origin, token: alice.token });
const result = (task) => JSON.parse(task.task.artifacts[0].parts[0].text);
let version, org, forum, item, rev1, rev2;
try {
  await test('reviewed school documents enqueue pg-boss jobs; unpublished inputs never persist', async () => {
    version = (await state()).publicVersion;
    const payload = {
      expectedVersion: version,
      confirmed: true,
      documents: [
        {
          id: 'integration-doc',
          revision: 1,
          title: '琥珀松树借阅资料',
          body: '琥珀松树借阅资料：借书请带校园卡，工作日开放。',
          published: true,
        },
        {
          id: 'private-input',
          title: '不可发布资料',
          body: 'PRIVATE_MARKER_' + run,
          published: false,
        },
      ],
    };
    assert.equal(
      (
        await api(alice, '/knowledge-admin/schools/north/documents', {
          requestId: randomUUID(),
          ...payload,
        })
      ).status,
      403,
    );
    assert.equal((await api(bob, '/knowledge-admin/schools/north/status')).status, 403);
    const saved = await post(owner, '/knowledge-admin/schools/north/documents', payload);
    version = saved.version;
    assert.equal(saved.indexing, 'queued');
    const snapshot = (
      await pool.query(
        'SELECT documents FROM hd_knowledge_snapshots WHERE school_id=$1 AND version=$2',
        ['north', version],
      )
    ).rows[0];
    assert.equal(snapshot.documents.length, 1);
    assert(!JSON.stringify(snapshot).includes('PRIVATE_MARKER_'));
    await until(async () => {
      const s = await state();
      return s.sources.some(
        (x) => x.kind === 'knowledge-index' && x.current && x.indexed_revision === version,
      );
    }, 30000);
    const response = result(await client.send('north-reception', '琥珀松树借阅资料需要什么证件？'));
    assert(response.sources.some((s) => s.documentId === 'integration-doc'));
    const jobs = await api(owner, '/jobs/schools/north/items');
    ok(jobs);
    const queued = (
      await pool.query(
        "SELECT job_id FROM hd_scheduled_jobs WHERE school_id='north' AND kind='knowledge-index' ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0];
    assert(queued);
    const row = ok(await api(owner, '/jobs/schools/north/items/' + queued.job_id));
    assert.notEqual(row.diagnostic, 'queue_source_mismatch');
  });
  await test('withdrawal gates public RAG and cached A2A before asynchronous physical deletion', async () => {
    const old = await client.send('north-reception', '琥珀松树借阅资料需要什么证件？');
    const saved = await post(owner, '/knowledge-admin/schools/north/documents', {
      expectedVersion: version,
      confirmed: true,
      documents: [],
    });
    version = saved.version;
    await assert.rejects(client.task('north-reception', old.task.id));
    const answer = result(await client.send('north-reception', '琥珀松树借阅资料需要什么证件？'));
    assert(!answer.sources.some((s) => s.documentId === 'integration-doc'));
    await until(async () => {
      const s = await state();
      return s.sources.some(
        (x) => x.kind === 'knowledge-index' && x.current && x.indexed_revision === version,
      );
    }, 30000);
  });
  await test('native reviewed forum publication automatically gains a private scope index', async () => {
    org = 'index-' + run;
    const orgRoot = '/m1/schools/north/organizations/' + org;
    await post(owner, '/m1/schools/north/organizations', {
      orgId: org,
      name: '历史索引验收 ' + run,
      kind: 'student',
    });
    const invite = await post(owner, orgRoot + '/invitations', {
      email: 'alice@m0.invalid',
      role: 'member',
    });
    ok(await api(alice, '/m1/invitations/accept', { token: invite.token }));
    const readiness = ok(await api(owner, '/m0/schools/north/forum/posting-state'));
    if (readiness.retryAfterMs)
      await new Promise((r) => setTimeout(r, Math.min(readiness.retryAfterMs + 20, 60000)));
    forum = orgRoot + '/forum';
    item = await post(owner, forum, {
      action: 'submit',
      title: '历史审定榕树校园 ' + run,
      content: '历史审定榕树校园的旧版内容为甲号规则，供长期索引自动验证。',
    });
    item = await post(owner, forum, { action: 'approve', id: item.id });
    rev1 = item.revision;
    await until(async () => {
      const s = await state();
      return s.sources.some(
        (x) =>
          x.kind === 'forum-index' &&
          x.source_id === item.id &&
          x.current &&
          x.indexed_revision === rev1,
      );
    }, 30000);
    const found = ok(await search(alice, org));
    assert(found.items.some((x) => x.sourceId === item.id && x.revision === rev1));
    assert.equal((await search(bob, org)).status, 403);
    assert(!ok(await search(alice, null)).items.some((x) => x.sourceId === item.id));
    const publicAnswer = result(
      await client.send('north-reception', '历史审定榕树校园的甲号规则是什么？'),
    );
    assert(!JSON.stringify(publicAnswer.sources).includes(item.id));
  });
  await test('unreviewed edit excluded; reviewed historical/current versions retained separately', async () => {
    const d = await post(owner, forum, {
      action: 'edit',
      id: item.id,
      expectedRevision: rev1,
      title: '历史审定榕树校园 ' + run,
      content: '历史审定榕树校园的新版内容为乙号规则，已替代旧的甲号规则。',
    });
    assert(!ok(await search(alice, org)).items.some((x) => x.body.includes('新版内容为乙号')));
    await post(owner, forum, {
      action: 'approve-edit',
      id: item.id,
      draftId: d.draftId,
      expectedRevision: rev1,
    });
    const current = await post(owner, forum, { action: 'detail', id: item.id });
    rev2 = current.revision;
    await until(async () => {
      const s = await state();
      return s.sources.some(
        (x) =>
          x.kind === 'forum-index' &&
          x.source_id === item.id &&
          x.current &&
          x.indexed_revision === rev2,
      );
    }, 30000);
    const all = ok(await search(alice, org));
    assert(all.items.some((x) => x.sourceId === item.id && x.revision === rev1 && x.historical));
    assert(all.items.some((x) => x.sourceId === item.id && x.revision === rev2 && !x.historical));
    const currentOnly = ok(await search(alice, org, false));
    assert(
      currentOnly.items.filter((x) => x.sourceId === item.id).every((x) => x.revision === rev2),
    );
  });
  await test('current org revocation and withdrawal invalidate old history without waiting for queue', async () => {
    const members = '/m1/schools/north/organizations/' + org + '/members';
    const row = ok(await api(owner, members)).members.find((m) => m.user_id === alice.userId);
    await post(owner, members, {
      userId: alice.userId,
      role: row.role,
      active: false,
      expectedRevision: row.revision,
    });
    assert.equal((await search(alice, org)).status, 403);
    await post(owner, forum, { action: 'withdraw', id: item.id });
    assert(!ok(await search(owner, org)).items.some((x) => x.sourceId === item.id));
    await until(async () => {
      const s = await state();
      return s.sources.some(
        (x) =>
          x.kind === 'forum-index' &&
          x.source_id === item.id &&
          x.current &&
          x.indexed_revision === 0,
      );
    }, 30000);
    const states = (
      await pool.query(
        "SELECT data FROM hd_campus_jobs.job WHERE name IN ('campus-forum-index','campus-knowledge-index')",
      )
    ).rows;
    assert(states.length);
    for (const { data } of states) {
      assert.deepEqual(Object.keys(data).sort(), [
        'cursor',
        'generation',
        'kind',
        'schoolId',
        'sourceId',
      ]);
      assert(!JSON.stringify(data).includes('甲号规则'));
    }
  });
  const output = process.env.HD_INTEGRATION_EVIDENCE || 'evidence/integrations';
  await mkdir(output, { recursive: true });
  await writeFile(
    output + '/indexing-live.json',
    JSON.stringify(
      {
        status: 'PASS',
        fixtureOnly: true,
        checks,
        scope:
          'Real isolated PostgreSQL/pgvector, native NodeBB and pg-boss; not target-server or real-school acceptance.',
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await pool.end();
}
