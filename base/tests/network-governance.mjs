import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { config, login, api } from './m1-helpers.mjs';
if (
  process.env.HD_M1_TEST_FIXTURE !== '1' ||
  !new URL(config.databaseUrl).pathname.startsWith('/hdnetwork26_')
)
  throw Error('Dedicated network fixture only');
const [owner, alice, shared] = await Promise.all(['moda', 'alice', 'shared'].map(login)),
  db = new pg.Client({ connectionString: config.databaseUrl });
await db.connect();
const ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  },
  post = async (u, p, b) => ok(await api(u, p, { requestId: randomUUID(), ...b }));
const root = '/network/schools/north',
  org = 'network-' + randomUUID().slice(0, 8),
  checks = [];
try {
  // Explicit fictitious role setup. All feature operations below go through current server ACL.
  await post(owner, '/m1/schools/north/organizations', {
    orgId: org,
    name: '隔离学长组织',
    kind: 'student',
  });
  await db.query(
    "INSERT INTO hd_org_members(school_id,org_id,user_id,role) VALUES('north',$1,$2,'owner')",
    [org, alice.userId],
  );
  await post(owner, '/m1/schools/north/reconcile', {});
  const boot = ok(await api(alice, root + '/bootstrap'));
  assert.equal(boot.canModerate, false);
  assert.equal(boot.canOpportunityModerate, true);
  assert.equal((await api(alice, root + '/review')).status, 403);
  assert.equal(
    ok(await api(alice, root + '/opportunity-admin')).items.length,
    0,
    'Org ownership must not grant school-wide opportunity moderation',
  );
  const cr = '/community/schools/north/organizations/' + org;
  const draft = await post(alice, cr + '/drafts', {
    expectedVersion: 0,
    title: '组织范围机会测试',
    content: '这条机会仅向被授权的组织成员开放，不属于全校公开或接待知识。',
  });
  const ready = ok(await api(alice, '/m0/schools/north/forum/posting-state'));
  if (ready.retryAfterMs) {
    assert(ready.retryAfterMs <= 60000);
    await new Promise((r) => setTimeout(r, ready.retryAfterMs + 20));
  }
  let source = await post(alice, cr + '/submit', {
    draftId: draft.draftId,
    expectedVersion: draft.version,
  });
  source = await post(alice, cr + '/action', {
    id: source.id,
    action: 'approve',
    expectedRevision: source.revision,
    expectedWorkflowVersion: source.workflowVersion,
    reason: '组织负责人审核正文',
  });
  let op = await post(alice, root + '/opportunity', {
    sourceId: source.id,
    orgId: org,
    expectedRevision: 0,
    kind: 'experience',
    organization: '测试组织',
    audience: '组织成员',
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  const approval = {
    requestId: randomUUID(),
    opportunityId: op.opportunity_id,
    expectedRevision: op.revision,
    reason: '组织负责人核对元数据',
  };
  op = ok(await api(alice, root + '/opportunity-approve', approval));
  assert(
    ok(await api(alice, root + '/opportunities')).items.some(
      (r) => r.opportunity_id === op.opportunity_id,
    ),
  );
  assert(
    !ok(await api(shared, root + '/opportunities')).items.some(
      (r) => r.opportunity_id === op.opportunity_id,
    ),
  );
  await db.query("UPDATE hd_organizations SET active=false WHERE school_id='north' AND org_id=$1", [
    org,
  ]);
  assert(
    !ok(await api(alice, root + '/opportunities')).items.some(
      (r) => r.opportunity_id === op.opportunity_id,
    ),
  );
  assert.equal(
    (await api(alice, root + '/opportunity-approve', approval)).status,
    403,
    'Cached write must recheck current organization ACL',
  );
  checks.push({
    name: 'Organization manager UI capability, native forum/metadata review, school separation and revocation of cached approval',
    status: 'PASS',
  });
  const list = ok(await api(owner, '/m1/schools/north/members')),
    m = list.members.find((m) => m.user_id === alice.userId);
  await post(owner, '/m1/schools/north/members', {
    userId: alice.userId,
    expectedRevision: m.revision,
    role: m.role,
    active: false,
  });
  assert(!ok(await api(shared, root + '/directory')).items.some((r) => r.userId === alice.userId));
  assert.equal((await api(alice, root + '/my-profile')).status, 403);
  const after = ok(await api(owner, '/m1/schools/north/members')).members.find(
    (m) => m.user_id === alice.userId,
  );
  await post(owner, '/m1/schools/north/members', {
    userId: alice.userId,
    expectedRevision: after.revision,
    role: m.role,
    active: true,
  });
  assert.equal((await api(owner, root + '/review?page=-1')).status, 400);
  assert.equal(ok(await api(owner, root + '/slot-admin?page=1')).items.length, 0);
  checks.push({
    name: 'Current school revocation removes discovery and denies old identity; bounded management pagination rejects invalid cursors',
    status: 'PASS',
  });
  console.log(
    'PASS organization-scoped opportunity management, revocation and paged school administration',
  );
} finally {
  await db.end();
  const out = process.env.HD_NETWORK_EVIDENCE;
  await mkdir(out, { recursive: true });
  await writeFile(
    out + '/network-governance.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope:
          'Fictitious namespace only. Fixture role/organization setup uses PostgreSQL; business operations and permission negatives use real API/NodeBB.',
        checks,
        complete: checks.length === 2,
      },
      null,
      2,
    ) + '\n',
  );
}
