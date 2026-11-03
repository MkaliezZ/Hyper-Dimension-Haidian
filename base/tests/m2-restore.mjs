import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { config, login, api } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_M1_SOURCE_CONFIG)
  throw Error('Isolated restored M2 and read-only source configuration required');
const source = JSON.parse(await readFile(process.env.HD_M1_SOURCE_CONFIG)),
  s = new pg.Pool({ connectionString: source.databaseUrl }),
  c = new pg.Pool({ connectionString: config.databaseUrl }),
  a = await login('alice'),
  other = await login('shared'),
  owner = await login('moda'),
  root = '/m2/schools/north',
  ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
try {
  const {
    rows: [original],
  } = await s.query('SELECT * FROM hd_m2_avatars WHERE school_id=$1 AND user_id=$2', [
    'north',
    a.userId,
  ]);
  const avatar = ok(await api(a, root + '/avatar'));
  assert.equal(avatar.modelHash, original.model_hash);
  assert.deepEqual(avatar.recipe, original.recipe);
  const bag = ok(await api(a, root + '/inventory')),
    oldItems = (
      await s.query(
        'SELECT item_id,quantity FROM hd_m2_items WHERE school_id=$1 AND user_id=$2 ORDER BY item_id',
        ['north', a.userId],
      )
    ).rows;
  assert.deepEqual(
    bag.items.map(({ item_id, quantity }) => ({ item_id, quantity })),
    oldItems,
  );
  const collection = ok(await api(a, root + '/collections'));
  assert.ok(collection.items.some((i) => i.kind === 'note'));
  assert.ok(collection.items.some((i) => i.kind === 'stamp'));
  assert.equal(
    (await api(other, root + '/collections/' + collection.items[0].collection_id)).status,
    404,
  );
  const {
    rows: [receipt],
  } = await c.query(
    "SELECT * FROM hd_receipts WHERE school_id=$1 AND user_id=$2 AND result->>'kind'='postcard' LIMIT 1",
    ['north', a.userId],
  );
  assert.ok(receipt);
  const p = receipt.result.payload;
  assert.deepEqual(
    ok(
      await api(a, root + '/inventory/use', {
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
  assert.deepEqual(ok(await api(a, root + '/inventory')).items, bag.items);
  const dms = ok(await api(a, '/m1/schools/north/chat')).conversations;
  const dm = dms.find((d) => d.kind === 'dm' && d.participants.includes(other.userId));
  assert.ok(dm);
  const messages = ok(await api(a, '/m1/schools/north/chat/' + dm.conversation_id + '/messages'));
  assert.ok(messages.items.some((m) => m.status === 'active' && m.text));
  assert.equal(
    (await api(owner, '/m1/schools/north/chat/' + dm.conversation_id + '/messages')).status,
    403,
  );
  const changed = structuredClone(avatar.recipe);
  changed.colors.top = changed.colors.top === '#48745b' ? '#b46c50' : '#48745b';
  const saved = ok(
    await api(a, root + '/avatar', {
      requestId: randomUUID(),
      expectedVersion: avatar.version,
      catalogHash: avatar.catalogHash,
      recipe: changed,
    }),
  );
  assert.notEqual(saved.modelHash, avatar.modelHash);
  ok(
    await api(owner, root + '/inventory/grant', {
      requestId: randomUUID(),
      expectedRevision: bag.revision,
      userId: a.userId,
      itemId: 'postcard-paper',
      quantity: 1,
      reason: 'independent restored M2 write proof',
    }),
  );
  assert.deepEqual(
    (
      await s.query('SELECT * FROM hd_m2_avatars WHERE school_id=$1 AND user_id=$2', [
        'north',
        a.userId,
      ])
    ).rows[0],
    original,
  );
  assert.deepEqual(
    (
      await s.query(
        'SELECT item_id,quantity FROM hd_m2_items WHERE school_id=$1 AND user_id=$2 ORDER BY item_id',
        ['north', a.userId],
      )
    ).rows,
    oldItems,
  );
  await mkdir('qa/m2', { recursive: true });
  await writeFile(
    'qa/m2/restore-live.json',
    JSON.stringify(
      {
        status: 'PASS',
        stableUserIds: true,
        exactRecipeAndModel: true,
        inventoryAndCollections: true,
        privateCollectionAcl: true,
        oldToolReceiptNoSecondConsumption: true,
        retainedM1NativeMessageAndAcl: true,
        newWritesOnlyInClone: true,
        sourceUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS restored M2 model, inventory, collections, receipts, old M1 messages/ACL and clone-only writes',
  );
} finally {
  await s.end();
  await c.end();
}
