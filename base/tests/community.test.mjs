import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAnchor } from '../src/platform/community.mjs';
import { readFile } from 'node:fs/promises';
import { makeGlb } from '../src/spatial/model.mjs';
import { createNavigation, roomPoint } from '../src/spatial/building.mjs';
import { digest } from '../src/protocol/index.mjs';
test('community anchor accepts only current-school public geometry with stable IDs', () => {
  const world = {
      packFor: (id) =>
        id === 'campus'
          ? {
              scenes: [
                {
                  sceneId: 'hall',
                  levels: [
                    {
                      rooms: [
                        { entityId: 'public-room', access: 'public' },
                        { entityId: 'private-room', access: 'private' },
                      ],
                    },
                  ],
                },
              ],
            }
          : null,
    },
    school = { spaceId: 'campus' };
  assert.deepEqual(publicAnchor(world, school, { sceneId: 'hall', entityId: 'public-room' }), {
    sceneId: 'hall',
    entityId: 'public-room',
  });
  assert.equal(publicAnchor(world, school, null), null);
  for (const anchor of [
    { sceneId: 'other', entityId: 'public-room' },
    { sceneId: 'hall', entityId: 'private-room' },
  ])
    assert.throws(() => publicAnchor(world, school, anchor), /community_public_place_required/);
  assert.throws(
    () => publicAnchor(world, school, { sceneId: 'hall', entityId: 'public-room', url: 'bad' }),
    /community_anchor_invalid/,
  );
  const rebuilt = structuredClone(world.packFor('campus'));
  rebuilt.scenes[0].levels[0].rooms[0].width = 99;
  assert.deepEqual(
    publicAnchor({ packFor: () => rebuilt }, school, { sceneId: 'hall', entityId: 'public-room' }),
    { sceneId: 'hall', entityId: 'public-room' },
  );
});

test('an actual GLB/navigation rebuild retains stored scene/entity anchors while deleted or restricted rooms fail closed', async () => {
  const pack = JSON.parse(
    await readFile(new URL('../examples/north/space.json', import.meta.url), 'utf8'),
  );
  const rebuilt = structuredClone(pack),
    scene = rebuilt.scenes[0],
    level = scene.levels[0],
    room = level.rooms[0];
  const stored = JSON.parse(JSON.stringify({ sceneId: scene.sceneId, entityId: room.entityId }));
  room.rect[2] -= 0.4;
  assert.notEqual(digest(scene), digest(pack.scenes[0]));
  assert.notDeepEqual(makeGlb(scene), makeGlb(pack.scenes[0]));
  const [x, z] = roomPoint(room),
    nav = createNavigation(scene);
  assert(
    nav.route(
      { levelId: pack.spawn.levelId, point: pack.spawn.point },
      { levelId: level.id, point: [x, level.elevation, z] },
    ).path.length,
  );
  assert.deepEqual(
    publicAnchor({ packFor: () => rebuilt }, { spaceId: pack.spaceId }, stored),
    stored,
  );
  room.access = 'restricted';
  assert.throws(
    () => publicAnchor({ packFor: () => rebuilt }, { spaceId: pack.spaceId }, stored),
    /community_public_place_required/,
  );
  level.rooms.shift();
  assert.throws(
    () => publicAnchor({ packFor: () => rebuilt }, { spaceId: pack.spaceId }, stored),
    /community_public_place_required/,
  );
});
