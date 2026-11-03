import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { config, login, api } from './m1-helpers.mjs';
import { openKnowledge } from '../src/knowledge/index.mjs';
import { loadPackages } from '../src/server.mjs';
if (
  process.env.HD_M1_TEST_FIXTURE !== '1' ||
  !config.relocatedFrom ||
  !config.campusEnabled ||
  !process.env.HD_M1_SOURCE_CONFIG
)
  throw Error('Explicit restored campus fixture required');
const source = JSON.parse(await readFile(process.env.HD_M1_SOURCE_CONFIG, 'utf8'));
assert.notEqual(source.databaseUrl, config.databaseUrl);
assert.notEqual(source.dataDir, config.dataDir);
const s = new Pool({ connectionString: source.databaseUrl }),
  c = new Pool({ connectionString: config.databaseUrl }),
  checks = [];
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const [alice, other, owner, bob] = await Promise.all(['alice', 'shared', 'moda', 'bob'].map(login));
const sha = (b) => createHash('sha256').update(b).digest('hex');
let kb;
try {
  const member = (await s.query('SELECT * FROM hd_users WHERE user_id=$1', [alice.userId])).rows[0];
  assert(member);
  assert.notEqual(member.issuer, config.issuer);
  const saved = ok(await api(alice, '/m2/schools/north/avatar'));
  const glb = await fetch(
    config.origin + '/m2/schools/north/avatar/model.glb?hash=' + saved.modelHash,
    { headers: { Authorization: 'Bearer ' + alice.token } },
  );
  assert.equal(glb.status, 200);
  assert.equal(sha(Buffer.from(await glb.arrayBuffer())), saved.modelHash);
  const bag = ok(await api(alice, '/m2/schools/north/inventory'));
  const receipt = (
    await c.query(
      "SELECT * FROM hd_receipts WHERE school_id='north' AND user_id=$1 AND result->>'kind'='postcard' LIMIT 1",
      [alice.userId],
    )
  ).rows[0];
  assert(receipt);
  const p = receipt.result.payload;
  assert.deepEqual(
    ok(
      await api(alice, '/m2/schools/north/inventory/use', {
        requestId: receipt.request_id,
        expectedRevision: receipt.result.revision - 1,
        itemId: 'postcard-camera',
        action: 'postcard',
        sceneId: p.sceneId,
        entityId: p.entityId,
        caption: p.caption,
      }),
    ),
    receipt.result,
  );
  assert.deepEqual(ok(await api(alice, '/m2/schools/north/inventory')).items, bag.items);
  checks.push({
    name: 'restored identity, saved model bytes and old spatial-tool receipt retain authority without second consumption',
    status: 'PASS',
  });
  const conversations = ok(await api(alice, '/m1/schools/north/chat')).conversations;
  const dm = conversations.find((x) => x.kind === 'dm' && x.participants.includes(other.userId));
  assert(dm);
  assert(
    ok(await api(alice, `/m1/schools/north/chat/${dm.conversation_id}/messages`)).items.some(
      (x) => x.status === 'active' && x.text,
    ),
  );
  assert.equal(
    (await api(owner, `/m1/schools/north/chat/${dm.conversation_id}/messages`)).status,
    403,
  );
  const posts = ok(await api(owner, '/community/schools/north/posts'));
  assert(posts.items.length > 0);
  const post = ok(await api(owner, '/community/schools/north/post/' + posts.items[0].id));
  assert(post);
  assert.equal((await api(bob, '/community/schools/north/posts')).status, 403);
  checks.push({
    name: 'restored Nakama message bodies and NodeBB source content remain readable through current ACL only',
    status: 'PASS',
  });
  const attachment = (
    await c.query(
      "SELECT * FROM hd_attachments WHERE school_id='north' AND owner_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>now()) AND body IS NOT NULL LIMIT 1",
      [alice.userId],
    )
  ).rows[0];
  assert(attachment);
  const download = await fetch(
    config.origin + '/attachments/schools/north/' + attachment.attachment_id + '/download',
    { headers: { Authorization: 'Bearer ' + alice.token } },
  );
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /^attachment/);
  assert.equal(sha(Buffer.from(await download.arrayBuffer())), attachment.sha256);
  assert.equal(
    (await api(bob, '/attachments/schools/north/' + attachment.attachment_id)).status,
    403,
  );
  checks.push({
    name: 'controlled attachment bytes, hash and school permission survive restore',
    status: 'PASS',
  });
  for (const table of [
    'hd_environment_places',
    'hd_environment_feedback',
    'hd_reward_claims',
    'hd_operation_runs',
    'hd_contributions',
    'hd_scheduled_jobs',
  ]) {
    const count = (await c.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
    assert(count > 0, table);
  }
  for (const path of [
    '/environment/schools/north/places',
    '/rewards/schools/north/items',
    '/jobs/schools/north/items',
    '/agent-directory/schools/north',
  ])
    ok(await api(owner, path));
  checks.push({
    name: 'environment duties, rewards, operations, ledger and scheduled job authorities survive with current authenticated interfaces',
    status: 'PASS',
  });
  const kconfig = JSON.parse(await readFile(config.dataDir + '/knowledge.json', 'utf8')),
    env = JSON.parse(await readFile(config.configRoot + '/runtime-env.json', 'utf8'));
  process.env[kconfig.database.connectionEnv] = env[kconfig.database.connectionEnv];
  assert(kconfig.embedding.python.startsWith(config.serviceRoot + '/'));
  kb = await openKnowledge({ dataDir: config.dataDir, config: kconfig });
  const packs = await loadPackages(config.schools.map((x) => x.package)),
    pack = packs.find((x) => x.spaceId === 'north');
  const hits = await kb.retrieve(
    pack,
    { id: 'restore-proof', spaces: ['north'], scopes: ['a2a:call'] },
    '借书应该带什么证件？',
  );
  assert.equal(hits[0].documentId, 'library');
  checks.push({
    name: 'restored seventh database and independent Ubuntu ONNX runtime return the original cited knowledge',
    status: 'PASS',
  });
  const original = (
    await s.query('SELECT * FROM hd_m2_avatars WHERE school_id=$1 AND user_id=$2', [
      'north',
      alice.userId,
    ])
  ).rows[0];
  const changed = structuredClone(saved.recipe);
  changed.colors.top = changed.colors.top === '#48745b' ? '#b46c50' : '#48745b';
  ok(
    await api(alice, '/m2/schools/north/avatar', {
      requestId: randomUUID(),
      expectedVersion: saved.version,
      catalogHash: saved.catalogHash,
      recipe: changed,
    }),
  );
  assert.deepEqual(
    (
      await s.query('SELECT * FROM hd_m2_avatars WHERE school_id=$1 AND user_id=$2', [
        'north',
        alice.userId,
      ])
    ).rows[0],
    original,
  );
  checks.push({
    name: 'new restored-avatar writes affect the clone only and preserve source user data',
    status: 'PASS',
  });
  await mkdir('qa/campus', { recursive: true });
  await writeFile(
    'qa/campus/restore-live.json',
    JSON.stringify(
      {
        status: 'PASS',
        checks,
        scope:
          'new seven-database Ubuntu fixture; source never restarted or rewritten; original M2 smoke had artifact-directory error after its assertions, this run independently verifies restored workflows',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS campus restore ' + checks.length + ' groups');
} finally {
  await kb?.close();
  await s.end();
  await c.end();
}
