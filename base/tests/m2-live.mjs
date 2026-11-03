import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config, login, api, call, until } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.m2Enabled)
  throw Error('M2 isolated fictitious fixture required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  checks = [],
  start = Date.now(),
  run = randomUUID().slice(0, 8),
  root = '/m2/schools/north';
const ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  },
  test = async (name, fn) => {
    await fn();
    checks.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  };
const [a, b, owner, shared] = await Promise.all(['alice', 'bob', 'moda', 'shared'].map(login));
let avatar, bag, target, scene, postcard, note;
async function state() {
  bag = ok(await api(a, root + '/inventory'));
  return bag;
}
async function equip(itemId) {
  await state();
  bag = ok(
    await api(a, root + '/inventory/equip', {
      requestId: randomUUID(),
      expectedRevision: bag.revision,
      itemId,
      equipped: true,
    }),
  );
}
async function tool(itemId, action, extra = {}) {
  await state();
  return api(a, root + '/inventory/use', {
    requestId: randomUUID(),
    expectedRevision: bag.revision,
    itemId,
    action,
    sceneId: scene.scene.sceneId,
    entityId: target.entityId,
    ...extra,
  });
}
try {
  await test('M2 school/account isolation and 24 original asset endpoints', async () => {
    assert.equal((await call(config.origin + root + '/avatar')).status, 401);
    assert.equal((await api(b, root + '/inventory')).status, 403);
    assert.equal((await api(a, '/m2/schools/south/avatar')).status, 403);
    assert.equal((await api(a, root + '/avatar?userId=' + b.userId)).status, 403);
    const c = ok(await api(a, root + '/avatar/catalog'));
    assert.equal(c.parts.length, 24);
    const r = await fetch(config.origin + c.parts[0].asset);
    assert.equal(r.status, 200);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await r.arrayBuffer()))
        .digest('hex'),
      c.parts[0].sha256,
    );
  });
  await test('avatar save, explicit legacy migration, idempotency, CAS race and old data preservation', async () => {
    const old = (
      await db.pool.query('SELECT * FROM hd_avatars WHERE school_id=$1 AND user_id=$2', [
        'north',
        a.userId,
      ])
    ).rows[0];
    avatar = ok(await api(a, root + '/avatar'));
    const input = {
      requestId: randomUUID(),
      expectedVersion: avatar.version,
      catalogHash: avatar.catalogHash,
      recipe: avatar.recipe,
      ...(avatar.migrationRequired ? { legacyVersion: avatar.legacyVersion } : {}),
    };
    if (avatar.migrationRequired) {
      assert.equal(
        (await api(a, root + '/avatar', { ...input, legacyVersion: undefined })).status,
        409,
      );
      assert.equal((await api(a, root + '/avatar/model.glb')).status, 409);
    }
    avatar = ok(await api(a, root + '/avatar', input));
    assert.deepEqual(ok(await api(a, root + '/avatar', input)), avatar);
    assert.equal(
      (await api(a, root + '/avatar', { ...input, recipe: { ...input.recipe, skin: 'ebony' } }))
        .status,
      409,
    );
    const race = await Promise.all(
      [1, 2].map(() =>
        api(a, root + '/avatar', {
          ...input,
          requestId: randomUUID(),
          expectedVersion: avatar.version,
        }),
      ),
    );
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    avatar = ok(await api(a, root + '/avatar'));
    assert.deepEqual(
      (
        await db.pool.query('SELECT * FROM hd_avatars WHERE school_id=$1 AND user_id=$2', [
          'north',
          a.userId,
        ])
      ).rows[0],
      old,
    );
    assert.equal(
      createHash('sha256')
        .update(
          Buffer.from(
            await (
              await fetch(config.origin + root + '/avatar/model.vrm?hash=' + avatar.modelHash, {
                headers: { Authorization: 'Bearer ' + a.token },
              })
            ).arrayBuffer(),
          ),
        )
        .digest('hex'),
      avatar.modelHash,
    );
    assert.ok(ok(await api(a, root + '/avatar/history')).entries.length >= 2);
  });
  await test('welcome kit one-time issuance, concurrent CAS, audited owner grant and forged item rejection', async () => {
    await state();
    if (!bag.starterClaimed) {
      const requests = await Promise.all(
        [1, 2].map(() =>
          api(a, root + '/inventory/starter', {
            requestId: randomUUID(),
            expectedRevision: bag.revision,
          }),
        ),
      );
      assert.deepEqual(requests.map((r) => r.status).sort(), [200, 409]);
    }
    await state();
    const quantities = bag.items;
    ok(
      await api(a, root + '/inventory/starter', {
        requestId: randomUUID(),
        expectedRevision: bag.revision,
      }),
    );
    assert.deepEqual((await state()).items, quantities);
    const grant = {
      requestId: randomUUID(),
      expectedRevision: bag.revision,
      userId: a.userId,
      itemId: 'postcard-paper',
      quantity: 2,
      reason: 'M2 isolated acceptance ' + run,
    };
    assert.equal((await api(a, root + '/inventory/grant', grant)).status, 403);
    ok(await api(owner, root + '/inventory/grant', grant));
    assert.equal(
      (
        await api(owner, root + '/inventory/grant', {
          ...grant,
          requestId: randomUUID(),
          itemId: 'admin-power',
        })
      ).status,
      409,
    );
    await state();
    assert.equal(
      (
        await api(owner, root + '/inventory/grant', {
          ...grant,
          requestId: randomUUID(),
          expectedRevision: bag.revision,
          itemId: 'admin-power',
        })
      ).status,
      400,
    );
    const rows = ok(await api(a, root + '/inventory/events')).events;
    assert.ok(rows.some((e) => e.action === 'grant' && e.actor_id === owner.userId));
  });
  await test('server-arrival gate rejects remote use, then accepts real nav arrival without geometry mutation', async () => {
    scene = ok(await api(a, '/api/spaces/north/scene'));
    target = scene.scene.levels
      .flatMap((l) => l.rooms.map((r) => ({ ...r, levelId: l.id })))
      .find((r) => r.access === 'public' && r.rect[0] > 4);
    assert.ok(target);
    await equip('stamp-book');
    const prior = await tool('stamp-book', 'stamp');
    if (prior.status === 200) {
      target = scene.scene.levels
        .flatMap((l) => l.rooms.map((r) => ({ ...r, levelId: l.id })))
        .find((r) => r.access === 'public' && r.entityId !== target.entityId);
      assert.equal((await tool('stamp-book', 'stamp')).status, 409);
    } else assert.equal(prior.status, 409);
    const move = ok(
      await api(a, '/api/spaces/north/move', {
        requestId: randomUUID(),
        sceneId: scene.scene.sceneId,
        levelId: target.levelId,
        entityId: target.entityId,
      }),
    );
    const duration = (move.distance / move.speed) * 1000;
    assert.ok(duration < 18000, 'bounded fixture route');
    await until(
      async () => {
        const s = ok(await api(a, '/api/spaces/north/scene'));
        return !s.position.moving && s.position.levelId === target.levelId;
      },
      Math.ceil(duration) + 2000,
    );
    assert.equal(ok(await api(a, '/api/spaces/north/scene')).geometryHash, scene.geometryHash);
  });
  await test('stamp uniqueness, paper consumption exactly once, escaped private postcard, private note no forum publication', async () => {
    await equip('stamp-book');
    ok(await tool('stamp-book', 'stamp'));
    assert.equal(ok(await tool('stamp-book', 'stamp')).alreadyCollected, true);
    await equip('postcard-camera');
    await state();
    const before = bag.items.find((i) => i.item_id === 'postcard-paper').quantity,
      input = {
        requestId: randomUUID(),
        expectedRevision: bag.revision,
        itemId: 'postcard-camera',
        action: 'postcard',
        sceneId: scene.scene.sceneId,
        entityId: target.entityId,
        caption: '<script>unsafe</script> ' + run,
      };
    postcard = ok(await api(a, root + '/inventory/use', input));
    assert.deepEqual(ok(await api(a, root + '/inventory/use', input)), postcard);
    assert.equal(
      (await state()).items.find((i) => i.item_id === 'postcard-paper').quantity,
      before - 1,
    );
    const svg = await (
      await fetch(config.origin + root + '/collections/' + postcard.collectionId + '.svg', {
        headers: { Authorization: 'Bearer ' + a.token },
      })
    ).text();
    assert.ok(svg.includes('&lt;script&gt;'));
    assert.ok(!svg.includes('<script>'));
    assert.equal((await api(shared, root + '/collections/' + postcard.collectionId)).status, 404);
    const forumBefore = (
      await db.pool.query('SELECT count(*)::int n FROM hd_forum_heads WHERE user_id=$1', [a.userId])
    ).rows[0].n;
    note = ok(await tool('note-card', 'note', { text: '只属于自己的校园记忆 ' + run }));
    assert.equal(
      ok(await api(a, root + '/collections/' + note.collectionId)).payload.status,
      'draft',
    );
    assert.equal(
      (
        await db.pool.query('SELECT count(*)::int n FROM hd_forum_heads WHERE user_id=$1', [
          a.userId,
        ])
      ).rows[0].n,
      forumBefore,
    );
    assert.equal(ok(await api(a, '/api/spaces/north/scene')).geometryHash, scene.geometryHash);
  });
  await test('map bookmark, local wave rate limit and profile field visibility', async () => {
    await equip('campus-map');
    ok(await tool('campus-map', 'bookmark'));
    await equip('cheer-flag');
    const w = ok(await tool('cheer-flag', 'wave'));
    assert.equal(w.localOnly, true);
    assert.equal((await tool('cheer-flag', 'wave')).status, 429);
    const p = ok(await api(a, root + '/profile'));
    ok(
      await api(a, root + '/profile', {
        requestId: randomUUID(),
        expectedVersion: p.version,
        fields: {
          bio: 'private profile ' + run,
          department: '艺术学院',
          year: '2026',
          interests: ['建筑', '摄影'],
        },
        visibility: { bio: 'private', department: 'school', year: 'school', interests: 'school' },
      }),
    );
    const other = ok(await api(shared, root + '/profiles/' + a.userId));
    assert.equal(other.fields.bio, undefined);
    assert.equal(other.fields.department, '艺术学院');
    assert.equal(
      (await api(shared, root + '/profiles/' + a.userId, { requestId: randomUUID() })).status,
      403,
    );
  });
  await mkdir('qa/m2', { recursive: true });
  await writeFile(
    'qa/m2/live.json',
    JSON.stringify(
      {
        status: 'PASS',
        checks,
        durationMs: Date.now() - start,
        avatarHash: avatar.modelHash,
        school: 'north',
        geometryHash: scene.geometryHash,
        postcardId: postcard.collectionId,
        noteId: note.collectionId,
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
