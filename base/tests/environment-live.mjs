import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, api, call } from './m1-helpers.mjs';
import { contactAccount } from './contacts-fixtures.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createServices } from '../src/platform/services.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Isolated campus only');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  run = randomUUID().slice(0, 8),
  checks = [],
  start = Date.now();
const root = '/environment/schools/north',
  pub = '/environment/public/schools/north/places',
  org = 'environment-' + run;
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const get = (u, p) => api(u, p).then(ok),
  post = (u, p, b) => api(u, p, { requestId: randomUUID(), ...b }).then(ok);
const check = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const owner = await login('moda'),
  south = await login('bob');
const users = await Promise.all(
  ['manager', 'moderator', 'visitor', 'outsider', 'orgowner', 'uiowner'].map((x) =>
    contactAccount(db, 'env-' + x),
  ),
);
const [manager, moderator, visitor, outsider, orgowner, uiowner] = users;
const publicView = () => call(config.origin + pub).then(ok);
let place, announcement, draftBody, feedback, claimBody, anchor;
async function memberActive(u, active) {
  const m = (await get(owner, '/m1/schools/north/organizations/' + org + '/members')).members.find(
    (x) => x.user_id === u.userId,
  );
  return post(owner, '/m1/schools/north/organizations/' + org + '/members', {
    userId: u.userId,
    expectedRevision: m.revision,
    role: m.role,
    active,
  });
}
try {
  await post(owner, '/m1/schools/north/organizations', {
    orgId: org,
    name: '虚构地点处理组 ' + run,
    kind: 'student',
  });
  for (const [u, role] of [
    [manager, 'member'],
    [moderator, 'moderator'],
    [orgowner, 'owner'],
  ])
    await db.pool.query(
      "INSERT INTO hd_org_members(school_id,org_id,user_id,role) VALUES('north',$1,$2,$3)",
      [org, u.userId, role],
    );
  await db.pool.query(
    "UPDATE hd_memberships SET role='owner' WHERE school_id='north' AND user_id=$1",
    [uiowner.userId],
  );
  await check(
    'real public anchor binding, scoped candidates, no cross-school or unassigned-org takeover',
    async () => {
      anchor = (await publicView()).places.find((p) => !p.placeId);
      assert.ok(anchor, 'A new unbound public fixture anchor is required');
      const body = {
        sceneId: anchor.sceneId,
        entityId: anchor.entityId,
        orgId: org,
        managerUserId: manager.userId,
        publicRoleLabel: '虚构地点服务负责人',
        publishRoleLabel: true,
      };
      assert.equal(
        (await api(orgowner, root + '/places', { requestId: randomUUID(), ...body })).status,
        403,
      );
      assert.equal(
        (
          await api(owner, root + '/places', {
            requestId: randomUUID(),
            ...body,
            entityId: 'south-hall-private',
          })
        ).status,
        403,
      );
      place = await post(owner, root + '/places', body);
      assert.equal((await api(south, root + '/places')).status, 403);
      const candidates = (await get(orgowner, root + '/candidates?placeId=' + place.placeId))
        .candidates;
      assert.ok(candidates.some((c) => c.userId === manager.userId));
      assert.equal(
        candidates.some((c) => c.userId === visitor.userId),
        false,
      );
      assert.equal((await api(visitor, root + '/candidates?placeId=' + place.placeId)).status, 403);
      const v = (await get(visitor, root + '/places')).places.find(
        (p) => p.placeId === place.placeId,
      );
      assert.equal(v.canFeedback, true);
      assert.equal(v.canHandle, false);
      assert.equal('managerUserId' in v, false);
      const p = (await publicView()).places.find((p) => p.placeId === place.placeId);
      assert.equal(p.publicRoleLabel, body.publicRoleLabel);
      for (const u of users) assert.equal(JSON.stringify(p).includes(u.userId), false);
    },
  );
  await check(
    'delegated drafts require current moderator approval; exact ten retries and changed-input conflicts',
    async () => {
      draftBody = {
        requestId: randomUUID(),
        placeId: place.placeId,
        title: '虚构地点服务说明 ' + run,
        body: '此公告是隔离自动验收资料，经过审核才允许公开。',
      };
      announcement = ok(await api(manager, root + '/announcements', draftBody));
      const retry = await Promise.all(
        Array.from({ length: 10 }, () => api(manager, root + '/announcements', draftBody)),
      );
      retry.forEach((r) => assert.deepEqual(ok(r), announcement));
      assert.equal(
        (
          await api(manager, root + '/announcements', {
            ...draftBody,
            body: '变更正文不得重用同一请求标识',
          })
        ).status,
        409,
      );
      assert.equal(
        (await publicView()).places.find((p) => p.placeId === place.placeId).announcements.length,
        0,
      );
      assert.equal(
        (await api(visitor, root + '/announcements?placeId=' + place.placeId)).status,
        403,
      );
      announcement = await post(
        manager,
        root + '/announcements/' + announcement.announcementId + '/submit',
        { expectedRevision: announcement.revision },
      );
      const review = {
        expectedRevision: announcement.revision,
        decision: 'publish',
        reason: '虚构内容已审核，可公开',
      };
      assert.equal(
        (
          await api(manager, root + '/announcements/' + announcement.announcementId + '/review', {
            requestId: randomUUID(),
            ...review,
          })
        ).status,
        403,
      );
      announcement = await post(
        moderator,
        root + '/announcements/' + announcement.announcementId + '/review',
        review,
      );
      assert.equal(
        (await publicView()).places.find((p) => p.placeId === place.placeId).announcements[0].body,
        draftBody.body,
      );
      assert.equal(
        (
          await db.pool.query(
            'SELECT count(*)::int n FROM hd_environment_events WHERE object_id=$1',
            [announcement.announcementId],
          )
        ).rows[0].n,
        3,
      );
    },
  );
  await check(
    'visitor private feedback, scoped handling, CAS race and exact claim retry',
    async () => {
      const b = {
        requestId: randomUUID(),
        placeId: place.placeId,
        kind: 'suggestion',
        body: '虚构私有反馈 ' + run + '：希望补充这里的导览标识。',
      };
      feedback = ok(await api(visitor, root + '/feedback', b));
      for (let i = 0; i < 10; i++)
        assert.deepEqual(ok(await api(visitor, root + '/feedback', b)), feedback);
      assert.equal(
        (await get(outsider, root + '/feedback?placeId=' + place.placeId)).items.length,
        0,
      );
      assert.equal(
        (await api(outsider, root + '/feedback?placeId=' + place.placeId + '&mode=manage')).status,
        403,
      );
      assert.equal(JSON.stringify(await publicView()).includes(b.body), false);
      claimBody = {
        requestId: randomUUID(),
        expectedRevision: feedback.revision,
        status: 'claimed',
        reason: '地点负责人接收反馈',
      };
      const claims = await Promise.all([
        api(manager, root + '/feedback/' + feedback.feedbackId + '/transition', claimBody),
        api(moderator, root + '/feedback/' + feedback.feedbackId + '/transition', {
          ...claimBody,
          requestId: randomUUID(),
        }),
      ]);
      assert.deepEqual(claims.map((r) => r.status).sort(), [200, 409]);
      const winner = claims[0].status === 200 ? manager : moderator;
      feedback = ok(claims.find((r) => r.status === 200));
      // If moderator wins the real CAS race, progress using that actor; exact replay is tested for its own request.
      if (winner === manager)
        for (let i = 0; i < 10; i++)
          assert.deepEqual(
            ok(
              await api(
                manager,
                root + '/feedback/' + feedback.feedbackId + '/transition',
                claimBody,
              ),
            ),
            feedback,
          );
      feedback = await post(winner, root + '/feedback/' + feedback.feedbackId + '/transition', {
        expectedRevision: feedback.revision,
        status: 'in_progress',
        reason: '正在核对虚构地点问题',
      });
      feedback = await post(winner, root + '/feedback/' + feedback.feedbackId + '/transition', {
        expectedRevision: feedback.revision,
        status: 'resolved',
        reason: '已补齐虚构说明并确认结果',
      });
      assert.equal(
        (await get(visitor, root + '/feedback?placeId=' + place.placeId)).items[0].status,
        'resolved',
      );
      const notes = (
        await db.pool.query(
          "SELECT payload FROM hd_notifications WHERE school_id='north' AND user_id=$1 AND payload->>'feedbackId'=$2",
          [visitor.userId, feedback.feedbackId],
        )
      ).rows;
      assert.ok(notes.length >= 3);
      assert.ok(notes.every((n) => !JSON.stringify(n).includes(b.body)));
    },
  );
  await check(
    'current organization revoke rejects old receipts, hides job label and allows responsible takeover',
    async () => {
      const open = await post(visitor, root + '/feedback', {
        placeId: place.placeId,
        kind: 'problem',
        body: '虚构待接管问题：请补充入口指示',
      });
      const b = {
        requestId: randomUUID(),
        expectedRevision: open.revision,
        status: 'claimed',
        reason: '先由地点负责人认领',
      };
      const claimed = ok(
        await api(manager, root + '/feedback/' + open.feedbackId + '/transition', b),
      );
      await memberActive(manager, false);
      assert.equal(
        (await api(manager, root + '/feedback/' + open.feedbackId + '/transition', b)).status,
        403,
      );
      assert.equal((await api(manager, root + '/announcements', draftBody)).status, 403);
      assert.equal(
        (await api(manager, root + '/feedback?placeId=' + place.placeId + '&mode=manage')).status,
        403,
      );
      assert.equal(
        (await publicView()).places.find((p) => p.placeId === place.placeId).publicRoleLabel,
        null,
      );
      const takeover = await post(
        moderator,
        root + '/feedback/' + open.feedbackId + '/transition',
        {
          expectedRevision: claimed.revision,
          status: 'claimed',
          reason: '原处理者撤权，由管理员接管',
        },
      );
      assert.equal(takeover.claimedByMe, true);
      await memberActive(manager, true);
      assert.equal(
        (await publicView()).places.find((p) => p.placeId === place.placeId).publicRoleLabel,
        '虚构地点服务负责人',
      );
      const candidates = (await get(orgowner, root + '/candidates?placeId=' + place.placeId))
        .candidates;
      assert.ok(candidates.some((c) => c.userId === manager.userId));
    },
  );
  await check(
    'scoped assignment review and withdrawal preserve private history and campus native boards refuse direct reads',
    async () => {
      const change = {
        requestId: randomUUID(),
        expectedRevision: place.revision,
        managerUserId: manager.userId,
        publicRoleLabel: '虚构学生服务职务',
        publishRoleLabel: true,
      };
      assert.equal(
        (await api(moderator, root + '/places/' + place.placeId + '/manage', change)).status,
        403,
      );
      place = ok(await api(orgowner, root + '/places/' + place.placeId + '/manage', change));
      assert.equal(
        (
          await api(orgowner, root + '/places/' + place.placeId + '/manage', {
            ...change,
            requestId: randomUUID(),
          })
        ).status,
        409,
      );
      announcement = await post(
        moderator,
        root + '/announcements/' + announcement.announcementId + '/withdraw',
        { expectedRevision: announcement.revision, reason: '虚构验收公告结束，保留历史' },
      );
      assert.equal(
        (await publicView()).places.find((p) => p.placeId === place.placeId).announcements.length,
        0,
      );
      assert.equal(
        (await get(visitor, root + '/feedback?placeId=' + place.placeId)).items.length,
        2,
      );
      const services = createServices(db, config),
        s = services.school('north'),
        social = await services.social(s, visitor.userId);
      assert.equal(
        (
          await call(s.nakamaUrl + '/v2/leaderboard/north:m0-trial', {
            token: social.session.token,
          })
        ).status,
        403,
      );
    },
  );
  await mkdir('.local', { recursive: true });
  await mkdir('qa/campus', { recursive: true });
  await writeFile(
    '.local/environment-browser-fixture.json',
    JSON.stringify({
      run,
      org,
      place,
      anchor,
      manager,
      moderator,
      visitor,
      orgowner,
      owner: uiowner,
    }),
    { mode: 0o600 },
  );
  await writeFile(
    '.local/environment-browser-config.json',
    JSON.stringify({ origin: config.origin, campusEnabled: true }),
  );
  await writeFile('.local/environment-browser-users.json', '[]');
  await writeFile(
    'qa/campus/environment-live.json',
    JSON.stringify(
      {
        scope:
          'Isolated PostgreSQL, Keycloak, real browser-facing HTTP; fictional data, not actual school or multi-device acceptance',
        run,
        org,
        placeId: place.placeId,
        checks,
        elapsedMs: Date.now() - start,
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
