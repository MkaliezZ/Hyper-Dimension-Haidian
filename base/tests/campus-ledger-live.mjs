import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, api, until, call } from './m1-helpers.mjs';
import { contactAccount } from './contacts-fixtures.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createServices } from '../src/platform/services.mjs';
import { createCampusLedger, exampleRules } from '../src/platform/campus-ledger.mjs';
import { applyForumEvent, drainOutbox } from '../src/platform/ledger.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Isolated fictitious campus only');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  services = createServices(db, config),
  run = randomUUID().slice(0, 8),
  checks = [],
  started = Date.now(),
  org = 'ledger-' + run;
db.campusEnabled = true;
db.recordCampusContribution = createCampusLedger(db, null, services, config).recordContribution;
const owner = await login('moda'),
  other = await login('bob'),
  users = await Promise.all([
    contactAccount(db, 'ledger-a'),
    contactAccount(db, 'ledger-b'),
    contactAccount(db, 'ledger-c'),
  ]),
  [a, b, c] = users;
const root = '/ledger/schools/north',
  forum = '/m1/schools/north/organizations/' + org + '/forum',
  acts = '/activities/schools/north',
  rid = () => randomUUID(),
  ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
const get = (u, p) => api(u, p).then(ok),
  post = (u, p, b) => api(u, p, { requestId: rid(), ...b }).then(ok),
  check = async (name, fn) => {
    await fn();
    checks.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  };
const entries = async (user) => (await get(user, root + '/entries?org=' + org)).entries;
const score = async (user, period) =>
  (
    await db.pool.query(
      'SELECT coalesce(sum(delta),0)::int score FROM hd_contributions WHERE school_id=$1 AND user_id=$2 AND scope_id=$3 AND period=$4',
      ['north', user.userId, org, period],
    )
  ).rows[0].score;
let period, period2, rules, original, source, editEvent, activity, registration;
async function approveRules(version, points = 5) {
  const doc = structuredClone(exampleRules);
  doc.version = version;
  doc.rules.forum_published.points = points;
  const imported = await post(owner, root + '/rules', { document: doc });
  return post(owner, root + '/rules/' + version + '/approve', {
    expectedRevision: imported.revision,
    reason: '虚构隔离验收规则审核',
  });
}
async function makePeriod(version, name) {
  const draft = await post(owner, root + '/periods', {
    period: name,
    orgId: org,
    semester: 'sem-' + run,
    label: '隔离虚构时期 ' + name,
    ruleVersion: version,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 86400000).toISOString(),
  });
  return post(owner, root + '/periods/' + name + '/activate', {
    expectedRevision: draft.revision,
    reason: '仅为自动验收激活虚构规则',
    acknowledgeExample: true,
  });
}
async function publish(user, title) {
  for (;;) {
    const state = await get(user, '/m0/schools/north/forum/posting-state');
    if (!state.retryAfterMs) break;
    if (state.retryAfterMs > 180000)
      throw Error('Native policy wait exceeds expected fixture boundary');
    console.log('Native posting policy wait ' + state.retryAfterMs + 'ms');
    await new Promise((r) => setTimeout(r, Math.min(30000, state.retryAfterMs + 50)));
  }
  const item = await post(user, forum, {
    action: 'submit',
    title: title + ' ' + run,
    content: '虚构来源正文用于审核计分，不代表任何真实校园贡献。',
  });
  const result = await post(owner, forum, { action: 'approve', id: item.id });
  return result;
}
async function sourceEvents(id) {
  return (await services.forum(services.school('north'), 'events', {})).events
    .filter((x) => x.source.id === id)
    .sort((a, b) => a.source.revision - b.source.revision);
}
async function verified(kind, user) {
  let act = await post(owner, acts + '/items', {
    orgId: org,
    kind,
    title: '封顶核验 ' + run + ' ' + rid().slice(0, 4),
    description: '虚构证据核验及每日额度验收。',
    conditions: '指定负责人根据证明核验。',
    tasks:
      kind === 'volunteer'
        ? [{ id: 'welcome', title: '虚构迎新引导', description: '虚构自动验收分工。' }]
        : [],
    startsAt: new Date(Date.now() - 120000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    registrationClosesAt: new Date(Date.now() + 1800000).toISOString(),
    capacity: 4,
    remindBeforeMinutes: 0,
    verifierIds: [owner.userId],
  });
  act = await post(owner, acts + '/items/' + act.activityId + '/submit', {
    expectedRevision: act.revision,
  });
  act = await post(owner, acts + '/items/' + act.activityId + '/review', {
    expectedRevision: act.revision,
    decision: 'publish',
    reason: '确认虚构活动来源',
  });
  let r = await post(
    user,
    acts + '/items/' + act.activityId + '/join',
    kind === 'volunteer' ? { taskId: 'welcome' } : {},
  );
  r = await post(user, acts + '/registrations/' + r.registrationId + '/evidence', {
    expectedRevision: r.revision,
    note: '虚构参与证据，不是真实学校核验。',
    attachmentIds: [],
  });
  r = await post(owner, acts + '/registrations/' + r.registrationId + '/verify', {
    expectedRevision: r.revision,
    decision: 'approve',
    reason: '已核对虚构证据',
    minutes: kind === 'volunteer' ? 1 : 0,
  });
  return contribution(r.verificationEventId);
}
async function contribution(eventId) {
  return (await db.pool.query('SELECT * FROM hd_contributions WHERE event_id=$1', [eventId]))
    .rows[0];
}
try {
  await db.pool.query(
    "INSERT INTO hd_organizations(school_id,org_id,name,kind) VALUES('north',$1,'贡献规则隔离验收','student')",
    [org],
  );
  for (const u of users)
    await db.pool.query(
      "INSERT INTO hd_org_members(school_id,org_id,user_id,role) VALUES('north',$1,$2,'member')",
      [org, u.userId],
    );
  await Promise.all(users.map((u) => get(u, '/m0/schools/north/forum/posting-state')));
  await check(
    'strict schema, unapproved/default rule exclusion, explicit approval and activation',
    async () => {
      assert.equal((await api(a, root + '/rules/preview', { document: exampleRules })).status, 403);
      assert.equal((await api(other, root + '/rankings?org=' + org)).status, 403);
      const doc = { ...exampleRules, version: 'rule-' + run };
      assert.equal(
        (await api(owner, root + '/rules/preview', { document: { ...doc, arbitraryScore: 1 } }))
          .status,
        400,
      );
      const preview = ok(await api(owner, root + '/rules/preview', { document: doc }));
      assert.equal(preview.effective, false);
      const draft = await post(owner, root + '/rules', { document: doc });
      assert.equal(draft.status, 'draft');
      assert.equal(
        (
          await api(owner, root + '/periods', {
            requestId: rid(),
            period: 'p-' + run,
            orgId: org,
            semester: 's',
            label: '未审核',
            ruleVersion: doc.version,
            startsAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + 100000).toISOString(),
          })
        ).status,
        409,
      );
      // No default rule is assigned to a real native source event before explicit activation.
      const unconfigured = await publish(c, '无规则贡献');
      const ev = (await sourceEvents(unconfigured.id))[0];
      const zero = await contribution(ev.eventId);
      assert.equal(zero.delta, 0);
      assert.equal(zero.metadata.reason, 'no_effective_approved_rule');
      rules = await post(owner, root + '/rules/' + doc.version + '/approve', {
        expectedRevision: draft.revision,
        reason: '虚构规则明确审核',
      });
      const p = await post(owner, root + '/periods', {
        period: 'p-' + run,
        orgId: org,
        semester: 'sem-' + run,
        label: '隔离时期一',
        ruleVersion: doc.version,
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      });
      assert.equal(
        (
          await api(owner, root + '/periods/' + p.period + '/activate', {
            requestId: rid(),
            expectedRevision: p.revision,
            reason: '未确认虚构示例',
          })
        ).status,
        400,
      );
      period = await post(owner, root + '/periods/' + p.period + '/activate', {
        expectedRevision: p.revision,
        reason: '明确仅为隔离虚构验收',
        acknowledgeExample: true,
      });
      await applyForumEvent(db, 'north', ev);
      assert.equal((await contribution(ev.eventId)).delta, 0);
    },
  );
  await check(
    'native forum publication, ten exact retries, changed input conflict and edit without extra award',
    async () => {
      source = await publish(a, '可追溯论坛贡献');
      original = (await sourceEvents(source.id))[0];
      assert.equal((await contribution(original.eventId)).delta, 5);
      for (let i = 0; i < 10; i++)
        assert.equal((await applyForumEvent(db, 'north', original)).duplicate, true);
      await assert.rejects(applyForumEvent(db, 'north', { ...original, status: 'withdrawn' }), {
        code: 'event_conflict',
      });
      assert.equal(
        (
          await db.pool.query('SELECT count(*)::int n FROM hd_contributions WHERE event_id=$1', [
            original.eventId,
          ])
        ).rows[0].n,
        1,
      );
      const edit = await post(a, forum, {
        action: 'edit',
        id: source.id,
        expectedRevision: 1,
        title: '审核后的更新 ' + run,
        content: '已发布正文新版本仍然是同一份贡献，不应重复积分。',
      });
      await post(owner, forum, {
        action: 'approve-edit',
        id: source.id,
        draftId: edit.draftId,
        expectedRevision: edit.revision,
      });
      editEvent = (await sourceEvents(source.id)).at(-1);
      assert.equal(editEvent.source.revision, 2);
      assert.equal((await contribution(editEvent.eventId)).delta, 0);
      const entry = await contribution(original.eventId);
      assert.equal(entry.rule_version, rules.rule_version);
      assert.deepEqual(entry.metadata.ruleTerms, {
        points: 5,
        dayCap: 10,
        dailyCap: 30,
        exampleOnly: true,
      });
    },
  );
  await check(
    'activity complete source chain and same-transaction award, daily caps across source kinds',
    async () => {
      let item = await post(owner, acts + '/items', {
        orgId: org,
        kind: 'event',
        title: '贡献验收活动 ' + run,
        description: '独立虚构活动及参与证明链。',
        conditions: '指定核验者审核后计分。',
        tasks: [],
        startsAt: new Date(Date.now() - 120000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
        registrationClosesAt: new Date(Date.now() + 1800000).toISOString(),
        capacity: 4,
        remindBeforeMinutes: 0,
        verifierIds: [owner.userId],
      });
      item = await post(owner, acts + '/items/' + item.activityId + '/submit', {
        expectedRevision: item.revision,
      });
      activity = await post(owner, acts + '/items/' + item.activityId + '/review', {
        expectedRevision: item.revision,
        decision: 'publish',
        reason: '检查虚构验收安排',
      });
      let r = await post(a, acts + '/items/' + activity.activityId + '/join', {});
      r = await post(a, acts + '/registrations/' + r.registrationId + '/evidence', {
        expectedRevision: r.revision,
        note: '虚构参与证明，需要指定核验者审核。',
        attachmentIds: [],
      });
      const body = {
        requestId: rid(),
        expectedRevision: r.revision,
        decision: 'approve',
        reason: '核对虚构证据并确认',
        minutes: 0,
      };
      registration = ok(
        await api(owner, acts + '/registrations/' + r.registrationId + '/verify', body),
      );
      for (let i = 0; i < 10; i++)
        assert.deepEqual(
          ok(await api(owner, acts + '/registrations/' + r.registrationId + '/verify', body)),
          registration,
        );
      const ev = (
        await db.pool.query('SELECT envelope FROM hd_activity_events WHERE event_id=$1', [
          registration.verificationEventId,
        ])
      ).rows[0].envelope;
      assert.ok(ev.source.revision >= 3);
      assert.equal((await contribution(ev.eventId)).delta, 10);
      const again = await db.tx((c) => db.recordCampusContribution(c, ev));
      assert.equal(again.duplicate, true);
      await assert.rejects(
        db.tx((c) => db.recordCampusContribution(c, { ...ev, actorId: a.userId })),
        { code: 'event_conflict' },
      );
      assert.equal(await score(a, period.period), 15);
      assert.equal((await verified('event', c)).delta, 10);
      assert.equal((await verified('volunteer', c)).delta, 15);
      assert.equal((await verified('volunteer', c)).delta, 5);
      const capped = await verified('volunteer', c);
      assert.equal(capped.delta, 0);
      assert.equal(capped.metadata.reason, 'daily_cap_applied');
      assert.equal(await score(c, period.period), 30);
    },
  );
  await check(
    'stable tied rankings, immutable frozen snapshots, changed policy and exact original reversal',
    async () => {
      await post(owner, root + '/adjustments', {
        userId: b.userId,
        orgId: org,
        period: period.period,
        delta: 15,
        reason: '虚构同分排序验收补记',
      });
      const rank = await get(a, root + '/rankings?org=' + org + '&period=' + period.period);
      assert.deepEqual(
        rank.rows.filter((x) => [a.userId, b.userId].includes(x.userId)).map((x) => x.userId),
        [a.userId, b.userId].sort(),
      );
      assert.equal(rank.rows[0].score, 30);
      period = await post(owner, root + '/periods/' + period.period + '/freeze', {
        expectedRevision: period.revision,
        reason: '保留本轮虚构冻结快照',
      });
      assert.equal(period.snapshot_generation, 1);
      const newRules = await approveRules('new-rule-' + run, 9);
      period2 = await makePeriod(newRules.rule_version, 'new-p-' + run);
      await post(owner, forum, { action: 'withdraw', id: source.id });
      const withdrawal = (await sourceEvents(source.id)).at(-1),
        rev = await contribution(withdrawal.eventId);
      assert.equal(rev.delta, -5);
      assert.equal(rev.period, period.period);
      assert.equal(rev.rule_version, rules.rule_version);
      assert.equal(rev.reverses, (await contribution(original.eventId)).id);
      await post(owner, acts + '/registrations/' + registration.registrationId + '/revoke', {
        expectedRevision: registration.revision,
        reason: '虚构记录核验依据纠错',
      });
      assert.equal(await score(a, period.period), 0);
      const frozen = await get(a, root + '/rankings?org=' + org + '&period=' + period.period);
      assert.equal(frozen.rows.find((x) => x.userId === a.userId).score, 15);
      period = await post(owner, root + '/periods/' + period.period + '/rebuild', {
        expectedRevision: period.revision,
        reason: '从权威账本恢复纠错结果',
      });
      const rebuilt = await get(a, root + '/rankings?org=' + org + '&period=' + period.period);
      assert.equal(rebuilt.generation, 2);
      assert.equal(rebuilt.rows.find((x) => x.userId === a.userId).score, 0);
      assert.equal(
        (
          await db.pool.query(
            'SELECT count(DISTINCT generation)::int n FROM hd_campus_rank_snapshots WHERE school_id=$1 AND period=$2',
            ['north', period.period],
          )
        ).rows[0].n,
        2,
      );
    },
  );
  await check(
    'manual immutable adjustment, exact request replay, reverse once and current membership/organization scope',
    async () => {
      const body = {
        requestId: rid(),
        userId: b.userId,
        orgId: org,
        period: period2.period,
        delta: 4,
        reason: '虚构纠错独立追加流水',
      };
      const result = ok(await api(owner, root + '/adjustments', body));
      for (let i = 0; i < 10; i++)
        assert.deepEqual(ok(await api(owner, root + '/adjustments', body)), result);
      assert.equal((await api(owner, root + '/adjustments', { ...body, delta: 5 })).status, 409);
      await post(owner, root + '/adjustments', {
        userId: b.userId,
        orgId: org,
        period: period2.period,
        reversesEntryId: result.entryId,
        reason: '虚构重复授分精确冲正',
      });
      assert.equal(
        (
          await api(owner, root + '/adjustments', {
            requestId: rid(),
            userId: b.userId,
            orgId: org,
            period: period2.period,
            reversesEntryId: result.entryId,
            reason: '不得再次重复冲正',
          })
        ).status,
        409,
      );
      assert.equal(
        (await api(b, root + '/entries?org=' + org + '&userId=' + a.userId)).status,
        403,
      );
      await db.pool.query(
        "UPDATE hd_org_members SET active=false WHERE school_id='north' AND org_id=$1 AND user_id=$2",
        [org, b.userId],
      );
      assert.equal((await api(b, root + '/rankings?org=' + org)).status, 403);
      assert.equal(
        (await get(a, root + '/rankings?org=' + org)).rows.some((x) => x.userId === b.userId),
        false,
      );
      assert.equal(
        (
          await api(owner, root + '/adjustments', {
            requestId: rid(),
            userId: b.userId,
            orgId: org,
            period: period2.period,
            delta: 2,
            reason: '撤权后不得新增正分',
          })
        ).status,
        403,
      );
      await db.pool.query(
        "UPDATE hd_org_members SET active=true WHERE school_id='north' AND org_id=$1 AND user_id=$2",
        [org, b.userId],
      );
      const schoolRank = await get(a, root + '/rankings');
      assert.equal(
        schoolRank.rows.some((x) => x.userId === a.userId || x.userId === b.userId),
        false,
      );
    },
  );
  await check(
    'rebuild from immutable ledger restores native Nakama projection and excludes nonforum reconciliation false positives',
    async () => {
      await db.pool.query(
        "UPDATE hd_scores SET score=9999 WHERE school_id='north' AND period=$1 AND user_id=$2",
        [period2.period, b.userId],
      );
      period2 = await post(owner, root + '/periods/' + period2.period + '/rebuild', {
        expectedRevision: period2.revision,
        reason: '模拟投影损坏后恢复，不重算历史',
      });
      assert.equal(
        (
          await db.pool.query(
            "SELECT score FROM hd_scores WHERE school_id='north' AND period=$1 AND user_id=$2",
            [period2.period, b.userId],
          )
        ).rows[0].score,
        0,
      );
      await drainOutbox(db, (row) => services.project(row));
      const projected = await db.pool.query(
        "SELECT delivered FROM hd_outbox WHERE school_id='north' AND period=$1 ORDER BY id DESC LIMIT 1",
        [period2.period],
      );
      assert.equal(projected.rows[0].delivered, true);
      const nativeSchool = services.school('north'),
        social = await services.social(nativeSchool, b.userId);
      const rpc = async (name, payload, token) =>
        call(
          nativeSchool.nakamaUrl +
            '/v2/rpc/' +
            name +
            (token ? '' : '?http_key=' + encodeURIComponent(nativeSchool.nakamaHttpKey)),
          { token, body: JSON.stringify(payload) },
        );
      const read = ok(
        await rpc('hd_projection_read', {
          key: nativeSchool.nakamaKey,
          period: period2.period,
          userId: social.nakamaId,
        }),
      );
      const data = typeof read.payload === 'string' ? JSON.parse(read.payload) : read;
      assert.equal(Number(data.record.score), 0);
      assert.equal(
        (
          await rpc(
            'hd_projection_read',
            { key: nativeSchool.nakamaKey, period: period2.period, userId: social.nakamaId },
            social.session.token,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await call(nativeSchool.nakamaUrl + '/v2/leaderboard/north:' + period2.period, {
            token: social.session.token,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await rpc('hd_project', {
            key: nativeSchool.nakamaKey,
            period: '../invalid',
            userId: social.nakamaId,
            score: 10,
            version: 999,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await rpc('hd_project', {
            key: 'incorrect',
            period: period2.period,
            userId: social.nakamaId,
            score: 10,
            version: 999,
          })
        ).status,
        403,
      );

      const reconciliation = await post(owner, '/m1/schools/north/reconcile', {});
      assert.equal(
        reconciliation.blocked.some(
          (x) => x.reason === 'source_event_missing' && x.eventId?.includes('base-'),
        ),
        false,
      );
    },
  );
  const uiOwner = await contactAccount(db, 'ledger-ui-owner');
  await db.pool.query(
    "UPDATE hd_memberships SET role='owner' WHERE school_id='north' AND user_id=$1",
    [uiOwner.userId],
  );
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/campus-ledger-browser-fixture.json',
    JSON.stringify({
      run,
      org,
      period: period.period,
      period2: period2.period,
      owner: { username: uiOwner.username, password: uiOwner.password, userId: uiOwner.userId },
      users: users.map(({ username, password, userId }) => ({ username, password, userId })),
    }),
    { mode: 0o600 },
  );
  await writeFile(
    '.local/campus-ledger-browser-config.json',
    JSON.stringify({ origin: config.origin, campusEnabled: true }),
  );
  await writeFile('.local/campus-ledger-browser-users.json', '[]');
  await mkdir('qa/campus', { recursive: true });
  await writeFile(
    'qa/campus/campus-ledger-live.json',
    JSON.stringify(
      {
        scope:
          'isolated real PostgreSQL/Keycloak/NodeBB/Nakama, fictitious people and policies, not real campus acceptance',
        run,
        org,
        period: period.period,
        period2: period2.period,
        checks,
        elapsedMs: Date.now() - started,
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
