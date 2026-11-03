import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { config, login, api, call, until } from './m1-helpers.mjs';
import { exampleRules } from '../src/platform/campus-ledger.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Isolated fictitious fixture required');
const pool = new pg.Pool({ connectionString: config.databaseUrl }),
  checks = [],
  run = randomUUID().slice(0, 8);
const [a, b, owner, other] = await Promise.all(['alice', 'shared', 'moda', 'bob'].map(login));
const schoolRoot = '/community/schools/north',
  primaryOrg = 'community-main-' + run,
  root = schoolRoot + '/organizations/' + primaryOrg,
  rid = () => randomUUID(),
  ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
const get = async (u, path) => ok(await api(u, path)),
  post = async (u, path, body) => ok(await api(u, path, body));
const check = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
async function nativePostingReady(user) {
  for (;;) {
    const state = await get(user, '/m0/schools/north/forum/posting-state');
    if (!state.retryAfterMs) return;
    if (state.retryAfterMs > 180000)
      throw Error('Native fixture posting cooldown exceeds expected policy');
    console.log('Waiting for the unchanged native posting cooldown: ' + state.retryAfterMs + 'ms');
    await new Promise((r) => setTimeout(r, Math.min(state.retryAfterMs + 50, 30000)));
  }
}
const detail = () => get(a, root + '/post/' + source.id);
let cat, draft, source, anchor, attachment, orgPath;
const action = async (u, action, extra = {}) => {
  const d = await detail();
  return post(u, root + '/action', {
    id: d.id,
    requestId: rid(),
    expectedRevision: d.revision,
    expectedWorkflowVersion: d.workflowVersion,
    action,
    reason: '隔离自动验收 ' + action,
    ...extra,
  });
};
const ledger = async () => {
  await until(async () => {
    const result = await post(owner, '/m1/schools/north/reconcile', {});
    return !result.busy && result;
  });
  return (
    await pool.query(
      'SELECT coalesce(sum(delta),0)::int AS score,count(*)::int AS entries FROM hd_contributions WHERE event_id IN (SELECT event_id FROM hd_events WHERE school_id=$1 AND source_id=$2)',
      ['north', source.id],
    )
  ).rows[0];
};
try {
  await post(owner, '/m1/schools/north/organizations', {
    requestId: rid(),
    orgId: primaryOrg,
    name: '独立社区验收 ' + run,
    kind: 'student',
  });
  for (const [user, email] of [
    [a, 'alice@m0.invalid'],
    [b, 'shared@m0.invalid'],
  ]) {
    const invite = await post(
      owner,
      '/m1/schools/north/organizations/' + primaryOrg + '/invitations',
      { requestId: rid(), email, role: 'member' },
    );
    await post(user, '/m1/invitations/accept', { token: invite.token });
  }
  const rule = structuredClone(exampleRules);
  rule.version = 'community-' + run;
  rule.dailyCap = 10000;
  rule.rules.forum_published = { points: 10, dayCap: 1000 };
  const imported = await post(owner, '/ledger/schools/north/rules', {
    requestId: rid(),
    document: rule,
  });
  await post(owner, '/ledger/schools/north/rules/' + rule.version + '/approve', {
    requestId: rid(),
    expectedRevision: imported.revision,
    reason: '独立虚构社区10分规则审核',
  });
  const period = await post(owner, '/ledger/schools/north/periods', {
    requestId: rid(),
    period: 'community-' + run,
    orgId: primaryOrg,
    semester: 'test-' + run,
    label: '虚构社区验收时期',
    ruleVersion: rule.version,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 86400000).toISOString(),
  });
  await post(owner, '/ledger/schools/north/periods/' + period.period + '/activate', {
    requestId: rid(),
    expectedRevision: period.revision,
    reason: '显式激活隔离虚构规则',
    acknowledgeExample: true,
  });
  await check(
    'current school and organization scopes, owner home CAS, native scoped categories',
    async () => {
      assert.equal((await call(config.origin + root + '/home')).status, 401);
      assert.equal((await api(other, root + '/home')).status, 403);
      const home = await get(a, root + '/home');
      anchor = { sceneId: home.places[0].sceneId, entityId: home.places[0].entityId };
      const body = {
        requestId: rid(),
        expectedVersion: home.page.version,
        summary: '虚构校园社区验收 ' + run,
        anchor,
      };
      assert.equal((await api(a, root + '/home', body)).status, 403);
      const race = await Promise.all([
        api(owner, root + '/home', body),
        api(owner, root + '/home', { ...body, requestId: rid() }),
      ]);
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
      assert.equal(
        (
          await api(a, root + '/categories', {
            requestId: rid(),
            name: '越权板块',
            description: '',
          })
        ).status,
        403,
      );
      cat = await post(owner, root + '/categories', {
        requestId: rid(),
        name: '校园记忆 ' + run,
        description: '本轮虚构验收板块',
      });
      const orgId = 'community-' + run;
      await post(owner, '/m1/schools/north/organizations', {
        requestId: rid(),
        orgId,
        name: '虚构文学社 ' + run,
        kind: 'student',
      });
      orgPath = schoolRoot + '/organizations/' + orgId;
      const invite = await post(
        owner,
        '/m1/schools/north/organizations/' + orgId + '/invitations',
        { requestId: rid(), email: 'alice@m0.invalid', role: 'moderator' },
      );
      await post(a, '/m1/invitations/accept', { token: invite.token });
      assert.equal((await api(b, orgPath + '/home')).status, 403);
      assert.equal((await get(a, orgPath + '/home')).canModerate, true);
      assert.ok(
        !(await get(b, schoolRoot + '/contexts')).organizations.some((o) => o.org_id === orgId),
      );
    },
  );
  await check(
    'native private draft, strict place validation and controlled attachment binding',
    async () => {
      const body = {
        requestId: rid(),
        expectedVersion: 0,
        title: '校园独有故事 ' + run,
        content: '这份记忆的全文独有检索词是榕树书页' + run,
        categoryId: cat.categoryId,
        anchor,
      };
      assert.equal(
        (
          await api(a, root + '/drafts', {
            ...body,
            anchor: { sceneId: 'foreign', entityId: 'private' },
          })
        ).status,
        403,
      );
      draft = await post(a, root + '/drafts', body);
      assert.deepEqual(await post(a, root + '/drafts', body), draft);
      assert.ok(!(await get(b, root + '/drafts')).items.some((x) => x.sourceId === draft.sourceId));
      assert.equal((await get(b, root + '/posts?query=' + run)).total, 0);
      attachment = await post(a, '/attachments/schools/north', {
        requestId: rid(),
        name: 'fictional-memory.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('虚构附件 ' + run).toString('base64'),
        purpose: 'community',
        scopeId: primaryOrg,
        targetId: draft.sourceId,
      });
      draft = await post(a, root + '/post/' + draft.sourceId + '/attachments', {
        requestId: rid(),
        attachmentId: attachment.attachmentId,
      });
      assert.equal(
        (await api(b, '/attachments/schools/north/' + attachment.attachmentId + '/download'))
          .status,
        403,
      );
      const wrong = await api(b, root + '/post/' + draft.sourceId + '/attachments', {
        requestId: rid(),
        attachmentId: attachment.attachmentId,
      });
      assert.equal(wrong.status, 403);
    },
  );
  await check(
    'native submission, fault recovery, review reason and one accepted contribution',
    async () => {
      const submit = { requestId: rid(), draftId: draft.draftId, expectedVersion: draft.version };
      await nativePostingReady(a);
      const s = config.schools.find((s) => s.schoolId === 'north');
      ok(
        await call(s.forumUrl + '/api/hd/fault', {
          body: { point: 'after-queue' },
          headers: { 'X-HD-Service-Key': s.forumKey },
        }),
      );
      assert.equal((await api(a, root + '/submit', submit)).status, 503);
      assert.equal(
        (
          await api(a, root + '/drafts', {
            requestId: rid(),
            draftId: draft.draftId,
            expectedVersion: draft.version,
            title: draft.title,
            content: draft.content,
            categoryId: draft.categoryId,
            anchor: draft.anchor,
          })
        ).status,
        409,
      );
      await post(owner, '/m1/schools/north/reconcile', {});
      source = await post(a, root + '/submit', submit);
      assert.equal(source.id, draft.sourceId);
      assert.deepEqual(await post(a, root + '/submit', submit), source);
      assert.equal((await api(b, root + '/post/' + source.id)).status, 403);
      assert.equal((await get(b, root + '/posts?query=' + run)).total, 0);
      const d = await detail(),
        command = {
          requestId: rid(),
          id: source.id,
          expectedRevision: d.revision,
          expectedWorkflowVersion: d.workflowVersion,
          action: 'approve',
          reason: '原生发布后断连恢复测试',
        };
      assert.equal((await api(b, root + '/action', command)).status, 403);
      ok(
        await call(s.forumUrl + '/api/hd/fault', {
          body: { point: 'after-publish' },
          headers: { 'X-HD-Service-Key': s.forumKey },
        }),
      );
      assert.equal((await api(owner, root + '/action', command)).status, 503);
      await until(async () => {
        const r = await api(owner, '/m1/schools/north/reconcile', {});
        return r.status === 200 && !r.data.blocked.length;
      });
      const approved = await post(owner, root + '/action', command);
      assert.equal(approved.status, 'published');
      assert.deepEqual(await post(owner, root + '/action', command), approved);
      assert.deepEqual(await ledger(), { score: 10, entries: 1 });
      const d2 = await detail();
      assert.ok(d2.pid && d2.tid);
      assert.equal(d2.trail.at(-1).reason, command.reason);
      assert.equal(
        (await api(b, '/attachments/schools/north/' + attachment.attachmentId + '/download'))
          .status,
        200,
      );
    },
  );
  await check(
    'category and full body search, pagination, same source map projection and native edit review',
    async () => {
      const found = await get(
        b,
        root +
          '/posts?query=' +
          encodeURIComponent('榕树书页' + run) +
          '&category=' +
          cat.categoryId +
          '&limit=1',
      );
      assert.equal(found.total, 1);
      assert.equal(found.items[0].id, source.id);
      assert.equal(found.items[0].revision, 1);
      const map = await get(b, root + '/map?' + new URLSearchParams(anchor));
      assert.ok(map.items.some((x) => x.id === source.id));
      const d = await detail(),
        edit = await post(a, root + '/edit', {
          requestId: rid(),
          id: source.id,
          expectedRevision: d.revision,
          title: '修订校园故事 ' + run,
          content: '审核后才能看到的修订正文 新樟树纸页' + run,
        });
      assert.match((await get(b, root + '/post/' + source.id)).content, /榕树书页/);
      assert.equal((await get(b, root + '/post/' + source.id)).draft, null);
      await action(owner, 'approve-edit', { draftId: edit.draftId });
      assert.match((await get(b, root + '/post/' + source.id)).content, /新樟树纸页/);
      assert.equal((await detail()).pid, d.pid);
      assert.deepEqual(await ledger(), { score: 10, entries: 2 });
      const editEntry = (
        await pool.query(
          "SELECT delta,metadata->>'reason' AS reason FROM hd_contributions WHERE event_id IN (SELECT event_id FROM hd_events WHERE school_id=$1 AND source_id=$2) ORDER BY id DESC LIMIT 1",
          ['north', source.id],
        )
      ).rows[0];
      assert.deepEqual(editEntry, { delta: 0, reason: 'published_revision_no_extra_credit' });
    },
  );
  await check(
    'report hide appeal restore use scoped reasons, revoke attachment access and reverse the same ledger',
    async () => {
      const d = await detail(),
        report = {
          requestId: rid(),
          id: source.id,
          expectedRevision: d.revision,
          expectedWorkflowVersion: d.workflowVersion,
          action: 'report',
          reason: '虚构内容需审核',
        };
      const race = await Promise.all([
        api(b, root + '/action', report),
        api(b, root + '/action', { ...report, requestId: rid() }),
      ]);
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
      const mod = await get(owner, root + '/post/' + source.id);
      await action(owner, 'review-report', { reportId: mod.reports[0].id, decision: 'hide' });
      assert.equal((await detail()).status, 'hidden');
      assert.equal((await api(b, root + '/post/' + source.id)).status, 403);
      assert.equal((await get(b, root + '/posts?query=' + run)).total, 0);
      assert.ok(
        !(await get(b, root + '/map?' + new URLSearchParams(anchor))).items.some(
          (x) => x.id === source.id,
        ),
      );
      assert.equal(
        (await api(b, '/attachments/schools/north/' + attachment.attachmentId + '/download'))
          .status,
        403,
      );
      assert.deepEqual(await ledger(), { score: 0, entries: 3 });
      await action(a, 'appeal');
      await action(owner, 'review-appeal', { decision: 'restore' });
      assert.equal((await get(b, root + '/post/' + source.id)).status, 'published');
      assert.equal(
        (await api(b, '/attachments/schools/north/' + attachment.attachmentId + '/download'))
          .status,
        200,
      );
      assert.deepEqual(await ledger(), { score: 10, entries: 4 });
      await action(a, 'withdraw');
      assert.equal((await detail()).status, 'withdrawn');
      assert.equal((await api(b, root + '/post/' + source.id)).status, 403);
      assert.deepEqual(await ledger(), { score: 0, entries: 5 });
    },
  );
  await check(
    'organization moderator native publication never leaks into school or another organization',
    async () => {
      const category = await post(a, orgPath + '/categories', {
        requestId: rid(),
        name: '社团作品 ' + run,
        description: '组织成员范围',
      });
      const body = {
        requestId: rid(),
        expectedVersion: 0,
        title: '组织专属故事 ' + run,
        content: '只有这个组织成员可以读到的完整正文 ' + run,
        categoryId: cat.categoryId,
        anchor: null,
      };
      assert.equal((await api(a, orgPath + '/drafts', body)).status, 403);
      const dr = await post(owner, orgPath + '/drafts', {
        ...body,
        requestId: rid(),
        categoryId: category.categoryId,
      });
      await nativePostingReady(owner);
      const sr = await post(owner, orgPath + '/submit', {
        requestId: rid(),
        draftId: dr.draftId,
        expectedVersion: dr.version,
      });
      const rejected = await post(a, orgPath + '/action', {
        requestId: rid(),
        id: sr.id,
        expectedRevision: sr.revision,
        expectedWorkflowVersion: sr.workflowVersion,
        action: 'reject',
        reason: '待审内容需作者补充说明',
      });
      assert.equal(rejected.status, 'rejected');
      const appealed = await post(owner, orgPath + '/action', {
        requestId: rid(),
        id: sr.id,
        expectedRevision: rejected.revision,
        expectedWorkflowVersion: rejected.workflowVersion,
        action: 'appeal',
        reason: '作者提交虚构补充说明并申请复核',
      });
      await post(a, orgPath + '/action', {
        requestId: rid(),
        id: sr.id,
        expectedRevision: appealed.revision,
        expectedWorkflowVersion: appealed.workflowVersion,
        action: 'review-appeal',
        decision: 'restore',
        reason: '组织版主范围审核',
      });
      assert.equal((await api(b, orgPath + '/post/' + sr.id)).status, 403);
      assert.equal((await api(a, root + '/post/' + sr.id)).status, 403);
      assert.ok(!(await get(a, root + '/posts?query=' + run)).items.some((i) => i.id === sr.id));
      assert.equal((await get(a, orgPath + '/posts?query=' + run)).items[0].id, sr.id);
      const native = await call(
        config.schools.find((s) => s.schoolId === 'north').forumUrl +
          '/api/category/' +
          category.categoryId,
      );
      assert.equal(native.status, 401);
    },
  );
} finally {
  await pool.end();
  await mkdir('qa/community', { recursive: true });
  await writeFile(
    'qa/community/live.json',
    JSON.stringify(
      {
        status: checks.length === 6 ? 'PASS' : 'INCOMPLETE',
        checks,
        run,
        sourceId: source?.id,
        orgPath,
        environment: 'isolated Ubuntu services and fictitious accounts',
      },
      null,
      2,
    ),
  );
}
