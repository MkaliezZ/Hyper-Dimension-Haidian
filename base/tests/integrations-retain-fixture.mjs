import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, api, until } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Isolated fixture only');
const owner = await login('moda'),
  alice = await login('alice'),
  run = randomUUID().slice(0, 8);
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const post = async (u, p, b) => ok(await api(u, p, { requestId: randomUUID(), ...b }));
const status = async () => ok(await api(owner, '/knowledge-admin/schools/north/status'));
let s = await status(),
  v = s.publicVersion;
for (const body of ['恢复验收的公开资料初版。', '恢复验收的公开资料修订版，校内开放。']) {
  const saved = await post(owner, '/knowledge-admin/schools/north/documents', {
    confirmed: true,
    expectedVersion: v,
    documents: [{ id: 'restore-public', title: '恢复验收公开资料', body, published: true }],
  });
  v = saved.version;
}
await until(
  async () =>
    (await status()).sources.some(
      (x) => x.kind === 'knowledge-index' && x.current && x.indexed_revision === v,
    ),
  30000,
);
const published = ok(await api(owner, '/knowledge-admin/schools/north/documents'));
assert.equal(published.documents.find((d) => d.id === 'restore-public').revision, 2);
const orgId = 'restore-' + run,
  root = '/m1/schools/north/organizations/' + orgId;
await post(owner, '/m1/schools/north/organizations', {
  orgId,
  name: '恢复验收组织 ' + run,
  kind: 'student',
});
const readiness = ok(await api(owner, '/m0/schools/north/forum/posting-state'));
if (readiness.retryAfterMs)
  await new Promise((r) => setTimeout(r, Math.min(readiness.retryAfterMs + 20, 60000)));
let item = await post(owner, root + '/forum', {
  action: 'submit',
  title: '榕树恢复验收历史',
  content: '榕树恢复验收历史初版，规章甲。',
});
item = await post(owner, root + '/forum', { action: 'approve', id: item.id });
const rev1 = item.revision;
const draft = await post(owner, root + '/forum', {
  action: 'edit',
  id: item.id,
  expectedRevision: rev1,
  title: '榕树恢复验收历史',
  content: '榕树恢复验收历史新版，规章乙。',
});
await post(owner, root + '/forum', {
  action: 'approve-edit',
  id: item.id,
  draftId: draft.draftId,
  expectedRevision: rev1,
});
const current = await post(owner, root + '/forum', { action: 'detail', id: item.id });
await until(
  async () =>
    (await status()).sources.some(
      (x) =>
        x.kind === 'forum-index' &&
        x.source_id === item.id &&
        x.current &&
        x.indexed_revision === current.revision,
    ),
  30000,
);
const history = ok(
  await api(owner, '/history-index/schools/north/search', {
    orgId,
    query: '榕树恢复验收历史',
    includeHistory: true,
  }),
);
assert(history.items.some((x) => x.sourceId === item.id && x.revision === rev1 && x.historical));
assert(
  history.items.some(
    (x) => x.sourceId === item.id && x.revision === current.revision && !x.historical,
  ),
);
const untilAt = new Date(Date.now() + 86400000).toISOString(),
  base = '/m5/schools/north';
let partner = await post(alice, base + '/partners', {
  name: '浏览器虚构合作方 ' + run,
  category: '虚构验收',
  description: '仅为自动验收',
  validUntil: untilAt,
});
partner = await post(owner, base + '/partners/' + partner.partnerId + '/review', {
  expectedRevision: partner.revision,
  decision: 'approve',
  reason: '隔离验证',
});
let service = await post(alice, base + '/services', {
  partnerId: partner.partnerId,
  title: '浏览器授权验收服务 ' + run,
  description: '隔离授权与恢复验证',
  conditions: '自愿授权',
  hours: '09:00–17:00',
  validUntil: untilAt,
});
service = await post(owner, base + '/services/' + service.serviceId + '/review', {
  expectedRevision: service.revision,
  decision: 'publish',
  reason: '隔离验证',
});
const output = process.env.HD_INTEGRATION_EVIDENCE || 'evidence/integrations';
await mkdir(output, { recursive: true });
await writeFile(
  output + '/restore-fixture.json',
  JSON.stringify(
    {
      fixtureOnly: true,
      orgId,
      sourceId: item.id,
      rev1,
      rev2: current.revision,
      publicDocumentId: 'restore-public',
      publicRevision: 2,
      serviceId: service.serviceId,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'PASS automatic public revisions and two reviewed forum revisions retained for browser and independent restore checks',
);
