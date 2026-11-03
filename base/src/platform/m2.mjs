import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { problem, hash } from './db.mjs';
import { scope, audit } from './permissions.mjs';
import { fields, canonical, digest } from '../protocol/index.mjs';
import {
  catalogM2,
  avatarM2,
  avatarM2Hash,
  validateM2,
  availableCatalogs,
  requireCatalogTransition,
} from '../avatar/library-m2.mjs';
import { defaultRecipe, migrateLegacy } from '../avatar/catalog-m2.mjs';
import { requireRewardAppearance, hasRewardItem } from './rewards.mjs';
import { toolPlace } from './world-places.mjs';
export const ITEMS = [
  {
    id: 'campus-map',
    name: '校园地图',
    slot: 'tool',
    consumable: false,
    actions: ['bookmark'],
    description: '收藏公开地点，随时查看路线。',
  },
  {
    id: 'postcard-camera',
    name: '明信片相机',
    slot: 'tool',
    consumable: false,
    actions: ['postcard'],
    description: '抵达公开地点后制作一张可保存的地点明信片。',
  },
  {
    id: 'stamp-book',
    name: '校园集章册',
    slot: 'tool',
    consumable: false,
    actions: ['stamp'],
    description: '实际抵达地点后收集一次纪念印章，不产生贡献分。',
  },
  {
    id: 'cheer-flag',
    name: '应援小旗',
    slot: 'tool',
    consumable: false,
    actions: ['wave'],
    description: '在自己的画面中挥手应援，不改变他人或地图。',
  },
  {
    id: 'note-card',
    name: '记忆卡',
    slot: 'supply',
    consumable: true,
    actions: ['note'],
    description: '保存地点关联的私人记忆草稿，再由你决定是否提交论坛审核。',
  },
  {
    id: 'postcard-paper',
    name: '明信片纸',
    slot: 'supply',
    consumable: true,
    actions: [],
    description: '每制作一张地点明信片使用一张。',
  },
];
const STARTER = {
  'campus-map': 1,
  'postcard-camera': 1,
  'stamp-book': 1,
  'cheer-flag': 1,
  'note-card': 3,
  'postcard-paper': 5,
};
const uuid = (s) => typeof s === 'string' && /^[a-f0-9-]{36}$/.test(s);
const id = (s) => typeof s === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(s);
const xml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  );
function postcardSvg(p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="640" viewBox="0 0 1000 640"><rect width="1000" height="640" rx="28" fill="#f8f1df"/><rect x="35" y="35" width="930" height="570" rx="20" fill="none" stroke="#306d61" stroke-width="3"/><text x="70" y="94" fill="#306d61" font-family="sans-serif" font-size="18">HYPER DIMENSION · CAMPUS POSTCARD</text><path d="M95 400V250h300v150M125 250v-50h60v50M300 250v-50h60v50M195 400v-85h85v85" fill="#b6cbb6" stroke="#477166" stroke-width="6"/><path d="M75 415h350" stroke="#477166" stroke-width="6"/><text x="475" y="222" fill="#203f36" font-family="sans-serif" font-size="30">${xml(p.roomName)}</text><text x="475" y="267" fill="#547468" font-family="sans-serif" font-size="20">${xml(p.spaceName)} · ${xml(p.levelName)}</text><text x="475" y="325" fill="#547468" font-family="sans-serif" font-size="18">已在空间中抵达这个地点</text><text x="70" y="515" fill="#203f36" font-family="sans-serif" font-size="18">${xml(p.caption || '把这一刻，留在校园里。')}</text><text x="70" y="557" fill="#547468" font-family="sans-serif" font-size="15">${xml(p.createdAt.slice(0, 10))} · 地点纪念插画，非场景截图</text></svg>`;
}
export function createM2(db, identity, services, config, { getStore, getWorld }) {
  const catalog = catalogM2();
  const allowed = async (s, u, c = db.pool) => scope(db, s, u, null, 'read', c);
  async function avatarState(s, u) {
    const {
      rows: [a],
    } = await db.pool.query('SELECT * FROM hd_m2_avatars WHERE school_id=$1 AND user_id=$2', [
      s,
      u,
    ]);
    if (a) {
      if (
        a.catalog_hash !== catalogM2(a.recipe.catalogVersion).catalogHash ||
        avatarM2Hash(a.recipe) !== a.model_hash
      )
        throw problem('avatar_catalog_migration_required', 409);
      return {
        recipe: a.recipe,
        version: a.version,
        modelHash: a.model_hash,
        catalogHash: a.catalog_hash,
        migrationRequired: false,
        availableCatalogs: availableCatalogs(),
      };
    }
    const {
      rows: [old],
    } = await db.pool.query('SELECT * FROM hd_avatars WHERE school_id=$1 AND user_id=$2', [s, u]);
    const recipe = old ? migrateLegacy(old.recipe) : defaultRecipe;
    return {
      recipe,
      version: 0,
      modelHash: avatarM2Hash(recipe),
      catalogHash: catalog.catalogHash,
      migrationRequired: Boolean(old),
      legacyVersion: old?.version,
      legacyModelHash: old?.model_hash,
      availableCatalogs: availableCatalogs(),
    };
  }
  async function inventory(s, u, c = db.pool) {
    const {
      rows: [head],
    } = await c.query('SELECT * FROM hd_m2_inventory WHERE school_id=$1 AND user_id=$2', [s, u]);
    const { rows: items } = await c.query(
      'SELECT item_id,quantity FROM hd_m2_items WHERE school_id=$1 AND user_id=$2 ORDER BY item_id',
      [s, u],
    );
    return {
      revision: head?.revision || 0,
      starterClaimed: head?.starter_claimed || false,
      equippedItem: head?.equipped_item || null,
      items: items.map((i) => ({ ...i, equipped: head?.equipped_item === i.item_id })),
      catalog: [
        ...ITEMS,
        ...(await Promise.all(
          items
            .filter(
              (i) => i.item_id.startsWith('appearance:') || i.item_id.startsWith('activity-entry:'),
            )
            .map(async (i) => ({
              id: i.item_id,
              name: i.item_id.startsWith('appearance:') ? '校园贡献绶带资格' : '指定活动准入资格',
              slot: 'eligibility',
              consumable: false,
              actions: [],
              active: await hasRewardItem(c, s, u, i.item_id),
              description: i.item_id.startsWith('appearance:')
                ? '获准后可在奖励素材库选择绶带；到期或撤销后不可继续保存或导出该配饰。'
                : '用于指定活动的报名校验；查看奖励记录了解活动、有效期和来源。',
            })),
        )),
      ],
    };
  }
  async function lockInventory(s, u, c, expected) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      s + ':m2-inventory:' + u,
    ]);
    await c.query(
      'INSERT INTO hd_m2_inventory(school_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [s, u],
    );
    const {
      rows: [h],
    } = await c.query(
      'SELECT * FROM hd_m2_inventory WHERE school_id=$1 AND user_id=$2 FOR UPDATE',
      [s, u],
    );
    if (!Number.isSafeInteger(expected) || expected !== h.revision)
      throw problem('inventory_write_conflict', 409);
    return h;
  }
  async function ledger(c, s, u, actor, action, item, delta, detail) {
    await c.query(
      'INSERT INTO hd_m2_inventory_events(event_id,school_id,user_id,actor_id,action,item_id,delta,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [randomUUID(), s, u, actor, action, item, delta, detail],
    );
  }
  async function increment(c, s, u, item, amount) {
    if (
      !ITEMS.some((i) => i.id === item) ||
      !Number.isSafeInteger(amount) ||
      amount === 0 ||
      Math.abs(amount) > 100
    )
      throw problem('inventory_item_invalid');
    const {
      rows: [old],
    } = await c.query(
      'SELECT quantity FROM hd_m2_items WHERE school_id=$1 AND user_id=$2 AND item_id=$3 FOR UPDATE',
      [s, u, item],
    );
    const q = (old?.quantity || 0) + amount;
    if (q < 0 || q > 999) throw problem('inventory_quantity_conflict', 409);
    await c.query(
      'INSERT INTO hd_m2_items VALUES($1,$2,$3,$4) ON CONFLICT(school_id,user_id,item_id) DO UPDATE SET quantity=EXCLUDED.quantity',
      [s, u, item, q],
    );
    return q;
  }
  const receipt = (s, u, b, fn) =>
    db.receipt(s, u, b.requestId, { module: 'm2', ...b }, async (c) => {
      await allowed(s, u, c);
      return fn(c);
    });
  async function use(req, s, u, b) {
    if (!id(b.requestId) || !ITEMS.some((i) => i.id === b.itemId && i.actions.includes(b.action)))
      throw problem('tool_action_invalid');
    if (
      b.action === 'note' &&
      (typeof b.text !== 'string' || b.text.trim().length < 8 || b.text.length > 500)
    )
      throw problem('note_text_invalid');
    if (b.caption !== undefined && (typeof b.caption !== 'string' || b.caption.length > 70))
      throw problem('postcard_caption_invalid');
    const principal = await identity.principal(req),
      world = getWorld();
    if (!world) throw problem('world_not_ready', 503);
    return getStore().combined(async (d, c) => {
      await allowed(s.schoolId, u, c);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        s.schoolId + ':' + u + ':' + b.requestId,
      ]);
      const {
          rows: [prior],
        } = await c.query(
          'SELECT * FROM hd_receipts WHERE school_id=$1 AND user_id=$2 AND request_id=$3',
          [s.schoolId, u, b.requestId],
        ),
        fingerprint = hash(canonical({ module: 'm2-use', ...b }));
      if (prior) {
        if (prior.input_hash !== fingerprint) throw problem('request_conflict', 409);
        return prior.result;
      }
      const h = await lockInventory(s.schoolId, u, c, b.expectedRevision),
        {
          rows: [owned],
        } = await c.query(
          'SELECT quantity FROM hd_m2_items WHERE school_id=$1 AND user_id=$2 AND item_id=$3',
          [s.schoolId, u, b.itemId],
        );
      if (!owned?.quantity) throw problem('inventory_item_not_owned', 403);
      if (ITEMS.find((i) => i.id === b.itemId).slot === 'tool' && h.equipped_item !== b.itemId)
        throw problem('tool_not_equipped', 409);
      const pack = world.packFor(s.spaceId),
        position = world.position(d, principal, pack),
        place = toolPlace(world, pack, position, b.sceneId, b.entityId, b.action);
      if (b.action === 'wave') {
        const {
          rows: [recent],
        } = await c.query(
          "SELECT 1 FROM hd_m2_inventory_events WHERE school_id=$1 AND user_id=$2 AND action='wave' AND created_at>now()-interval '3 seconds'",
          [s.schoolId, u],
        );
        if (recent) throw problem('tool_rate_limited', 429);
      }
      let result;
      const geometryHash = place.geometryHash,
        sourceKey = place.sceneId + ':' + (place.entityId || 'position');
      if (['stamp', 'bookmark'].includes(b.action)) {
        const {
          rows: [old],
        } = await c.query(
          'SELECT * FROM hd_m2_collections WHERE school_id=$1 AND user_id=$2 AND kind=$3 AND source_key=$4',
          [s.schoolId, u, b.action, sourceKey],
        );
        if (old)
          result = {
            collectionId: old.collection_id,
            kind: b.action,
            alreadyCollected: true,
            revision: h.revision,
          };
      }
      if (!result) {
        const collectionId = randomUUID(),
          payload = {
            spaceId: s.spaceId,
            sceneId: place.sceneId,
            entityId: place.entityId,
            roomName: place.name,
            spaceName: pack.name,
            levelName: place.levelName,
            geometryHash,
            position: structuredClone(position),
            createdAt: new Date().toISOString(),
          };
        let consumed = null;
        if (b.action === 'postcard') {
          await increment(c, s.schoolId, u, 'postcard-paper', -1);
          consumed = 'postcard-paper';
          payload.caption = b.caption || '';
          const {
            rows: [a],
          } = await c.query(
            'SELECT model_hash FROM hd_m2_avatars WHERE school_id=$1 AND user_id=$2',
            [s.schoolId, u],
          );
          payload.avatarModelHash = a?.model_hash || null;
        }
        if (b.action === 'note') {
          await increment(c, s.schoolId, u, 'note-card', -1);
          consumed = 'note-card';
          payload.text = b.text;
          payload.visibility = 'private';
          payload.status = 'draft';
        }
        if (b.action !== 'wave')
          await c.query(
            'INSERT INTO hd_m2_collections(collection_id,school_id,user_id,kind,source_key,payload) VALUES($1,$2,$3,$4,$5,$6)',
            [
              collectionId,
              s.schoolId,
              u,
              b.action,
              ['stamp', 'bookmark'].includes(b.action) ? sourceKey : collectionId,
              payload,
            ],
          );
        await c.query(
          'UPDATE hd_m2_inventory SET revision=revision+1 WHERE school_id=$1 AND user_id=$2',
          [s.schoolId, u],
        );
        await ledger(c, s.schoolId, u, u, b.action, consumed || b.itemId, consumed ? -1 : 0, {
          sceneId: place.sceneId,
          entityId: payload.entityId,
          collectionId: b.action === 'wave' ? null : collectionId,
        });
        result = {
          kind: b.action,
          revision: h.revision + 1,
          ...(b.action === 'wave'
            ? { clip: 'Wave', durationMs: 3000, localOnly: true }
            : { collectionId, payload }),
        };
      }
      await c.query('INSERT INTO hd_receipts VALUES($1,$2,$3,$4,$5)', [
        s.schoolId,
        u,
        b.requestId,
        fingerprint,
        result,
      ]);
      return result;
    });
  }
  return async (req, res, { url, json, body }) => {
    const p = url.pathname.split('/').filter(Boolean);
    if (p[0] === 'avatar-library' && req.method === 'GET') {
      let bytes;
      const versioned = ['v2', 'v3'].includes(p[1]),
        assetCatalog =
          p[1] === 'v3'
            ? catalogM2('campus-rewards-3')
            : versioned
              ? catalogM2('campus-original-2')
              : catalog,
        route = versioned ? [p[0], ...p.slice(2)] : p;
      if (route.length === 2 && route[1] === 'catalog.json')
        bytes = Buffer.from(JSON.stringify(assetCatalog));
      else if (route.length === 3 && route[1] === 'parts') {
        const part = assetCatalog.parts.find((a) => a.asset === '/' + p.join('/'));
        if (!part) throw problem('avatar_asset_missing', 404);
        bytes = await readFile(
          new URL(
            '../../assets/avatars/' + (versioned ? p[1] + '/' : '') + 'parts/' + part.id + '.glb',
            import.meta.url,
          ),
        );
        if (createHash('sha256').update(bytes).digest('hex') !== part.sha256)
          throw problem('avatar_asset_integrity', 503);
      } else if (route.length === 3 && route[1] === 'presets') {
        const preset = assetCatalog.presets.find((a) => a.asset === '/' + p.join('/'));
        if (!preset) throw problem('avatar_asset_missing', 404);
        bytes = avatarM2(preset.recipe);
      } else throw problem('avatar_asset_missing', 404);
      res.writeHead(200, {
        'Content-Type': route[1] === 'catalog.json' ? 'application/json' : 'model/gltf-binary',
        'Content-Length': bytes.length,
        'Cache-Control': 'no-cache',
      });
      res.end(bytes);
      return true;
    }
    if (p[0] !== 'm2') return false;
    if (!['GET', 'POST'].includes(req.method) || p[1] !== 'schools' || !p[2])
      throw problem('m2_route_missing', 404);
    const user = await identity.user(req),
      u = user.user_id,
      s = services.school(p[2]);
    await allowed(s.schoolId, u);
    if (url.searchParams.has('userId') && url.searchParams.get('userId') !== u)
      throw problem('other_user_denied', 403);
    const action = p[3];
    if (action === 'avatar') {
      if (req.method === 'GET') {
        if (p[4] === 'catalog') {
          json(res, 200, catalogM2(url.searchParams.get('version') || undefined));
          return true;
        }
        if (p[4] === 'history') {
          json(res, 200, {
            entries: (
              await db.pool.query(
                'SELECT version,recipe,model_hash,source,legacy_version,created_at FROM hd_m2_avatar_history WHERE school_id=$1 AND user_id=$2 ORDER BY version DESC LIMIT 30',
                [s.schoolId, u],
              )
            ).rows,
          });
          return true;
        }
        const saved = await avatarState(s.schoolId, u);
        if (['model.glb', 'model.vrm'].includes(p[4])) {
          if (saved.migrationRequired) throw problem('avatar_explicit_migration_required', 409);
          await requireRewardAppearance(db.pool, s.schoolId, u, saved.recipe);
          if (url.searchParams.has('hash') && url.searchParams.get('hash') !== saved.modelHash)
            throw problem('avatar_version_changed', 409);
          const bytes = avatarM2(saved.recipe);
          res.writeHead(200, {
            'Content-Type': 'model/gltf-binary',
            'Content-Length': bytes.length,
            'Cache-Control': 'no-store',
          });
          res.end(bytes);
        } else if (p.length === 4) json(res, 200, saved);
        else throw problem('m2_route_missing', 404);
        return true;
      }
      if (p[4] === 'preview') {
        const previewRecipe = validateM2(await body(req));
        await requireRewardAppearance(db.pool, s.schoolId, u, previewRecipe);
        const bytes = avatarM2(previewRecipe);
        res.writeHead(200, {
          'Content-Type': 'model/gltf-binary',
          'Content-Length': bytes.length,
          'Cache-Control': 'no-store',
        });
        res.end(bytes);
        return true;
      }
      if (p.length !== 4) throw problem('m2_route_missing', 404);
      const b = fields(
          await body(req),
          ['requestId', 'expectedVersion', 'recipe', 'catalogHash', 'legacyVersion', 'upgradeFrom'],
          'avatar',
        ),
        recipe = validateM2(b.recipe),
        targetCatalog = catalogM2(recipe.catalogVersion);
      if (
        b.catalogHash !== targetCatalog.catalogHash ||
        !Number.isSafeInteger(b.expectedVersion) ||
        b.expectedVersion < 0
      )
        throw problem('avatar_catalog_or_version_conflict', 409);
      const r = await receipt(s.schoolId, u, b, async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          s.schoolId + ':permissions',
        ]);
        await allowed(s.schoolId, u, c);
        await requireRewardAppearance(c, s.schoolId, u, recipe);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          s.schoolId + ':m2-avatar:' + u,
        ]);
        const {
          rows: [a],
        } = await c.query('SELECT * FROM hd_m2_avatars WHERE school_id=$1 AND user_id=$2', [
          s.schoolId,
          u,
        ]);
        if ((a?.version || 0) !== b.expectedVersion) throw problem('avatar_write_conflict', 409);
        const {
          rows: [legacy],
        } = await c.query('SELECT * FROM hd_avatars WHERE school_id=$1 AND user_id=$2', [
          s.schoolId,
          u,
        ]);
        if (!a && legacy && b.legacyVersion !== legacy.version)
          throw problem('avatar_explicit_migration_required', 409);
        const previousRecipe = a?.recipe || (legacy ? migrateLegacy(legacy.recipe) : defaultRecipe),
          previousCatalog = catalogM2(previousRecipe.catalogVersion),
          previousHash = avatarM2Hash(previousRecipe);
        if (a && (a.catalog_hash !== previousCatalog.catalogHash || a.model_hash !== previousHash))
          throw problem('avatar_catalog_migration_required', 409);
        const upgrade = requireCatalogTransition(
          {
            recipe: previousRecipe,
            catalogHash: previousCatalog.catalogHash,
            modelHash: previousHash,
          },
          recipe,
          b.upgradeFrom,
        );
        const version = b.expectedVersion + 1,
          modelHash = avatarM2Hash(recipe),
          source = upgrade
            ? 'catalog-upgrade:' + previousRecipe.catalogVersion
            : !a && legacy
              ? 'legacy-m0'
              : 'user';
        await c.query(
          'INSERT INTO hd_m2_avatars(school_id,user_id,version,recipe,model_hash,catalog_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(school_id,user_id) DO UPDATE SET version=EXCLUDED.version,recipe=EXCLUDED.recipe,model_hash=EXCLUDED.model_hash,catalog_hash=EXCLUDED.catalog_hash,updated_at=now()',
          [s.schoolId, u, version, recipe, modelHash, targetCatalog.catalogHash],
        );
        await c.query(
          'INSERT INTO hd_m2_avatar_history(school_id,user_id,version,recipe,model_hash,source,legacy_version) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [s.schoolId, u, version, recipe, modelHash, source, !a ? legacy?.version || null : null],
        );
        await audit(c, s.schoolId, u, 'avatar.save', u, { version, modelHash, source });
        return {
          version,
          recipe,
          modelHash,
          catalogHash: targetCatalog.catalogHash,
          migrationRequired: false,
          availableCatalogs: availableCatalogs(),
        };
      });
      json(res, 200, r);
      return true;
    }
    if (action === 'inventory') {
      if (req.method === 'GET') {
        if (p[4] === 'events')
          json(res, 200, {
            events: (
              await db.pool.query(
                'SELECT * FROM hd_m2_inventory_events WHERE school_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100',
                [s.schoolId, u],
              )
            ).rows,
          });
        else if (p.length === 4) json(res, 200, await inventory(s.schoolId, u));
        else throw problem('m2_route_missing', 404);
        return true;
      }
      if (p[4] === 'use') {
        json(
          res,
          200,
          await use(
            req,
            s,
            u,
            fields(
              await body(req),
              [
                'requestId',
                'expectedRevision',
                'itemId',
                'action',
                'sceneId',
                'entityId',
                'text',
                'caption',
              ],
              'tool',
            ),
          ),
        );
        return true;
      }
      const b = fields(
          await body(req),
          ['requestId', 'expectedRevision', 'itemId', 'equipped', 'userId', 'quantity', 'reason'],
          'inventory',
        ),
        op = p[4];
      if (!['starter', 'equip', 'grant'].includes(op)) throw problem('m2_route_missing', 404);
      if (op === 'grant') {
        await scope(db, s.schoolId, u, null, 'manage');
        if (
          !uuid(b.userId) ||
          typeof b.reason !== 'string' ||
          b.reason.trim().length < 3 ||
          b.reason.length > 200 ||
          !Number.isSafeInteger(b.quantity) ||
          b.quantity < 1 ||
          b.quantity > 100
        )
          throw problem('grant_invalid');
        await allowed(s.schoolId, b.userId);
      }
      const result = await receipt(s.schoolId, u, { operation: op, ...b }, async (c) => {
        const target = op === 'grant' ? b.userId : u;
        if (op === 'grant') {
          await scope(db, s.schoolId, u, null, 'manage', c);
          await allowed(s.schoolId, target, c);
        }
        const h = await lockInventory(s.schoolId, target, c, b.expectedRevision);
        if (op === 'starter') {
          if (!h.starter_claimed) {
            for (const [item, q] of Object.entries(STARTER)) {
              await increment(c, s.schoolId, u, item, q);
              await ledger(c, s.schoolId, u, u, 'starter', item, q, { rule: 'm2-welcome-kit-v1' });
            }
            await c.query(
              'UPDATE hd_m2_inventory SET starter_claimed=true,revision=revision+1 WHERE school_id=$1 AND user_id=$2',
              [s.schoolId, u],
            );
          }
        } else if (op === 'equip') {
          if (
            typeof b.equipped !== 'boolean' ||
            !ITEMS.some((i) => i.id === b.itemId && i.slot === 'tool')
          )
            throw problem('equipment_invalid');
          const {
            rows: [owned],
          } = await c.query(
            'SELECT quantity FROM hd_m2_items WHERE school_id=$1 AND user_id=$2 AND item_id=$3',
            [s.schoolId, u, b.itemId],
          );
          if (!owned?.quantity) throw problem('inventory_item_not_owned', 403);
          await c.query(
            'UPDATE hd_m2_inventory SET equipped_item=$3,revision=revision+1 WHERE school_id=$1 AND user_id=$2',
            [s.schoolId, u, b.equipped ? b.itemId : null],
          );
          await ledger(c, s.schoolId, u, u, 'equip', b.itemId, 0, { equipped: b.equipped });
        } else {
          await increment(c, s.schoolId, target, b.itemId, b.quantity);
          await c.query(
            'UPDATE hd_m2_inventory SET revision=revision+1 WHERE school_id=$1 AND user_id=$2',
            [s.schoolId, target],
          );
          await ledger(c, s.schoolId, target, u, 'grant', b.itemId, b.quantity, {
            reason: b.reason,
          });
          await audit(c, s.schoolId, u, 'inventory.grant', target, {
            item: b.itemId,
            quantity: b.quantity,
            reason: b.reason,
          });
        }
        return inventory(s.schoolId, target, c);
      });
      json(res, 200, result);
      return true;
    }
    if (action === 'collections' && req.method === 'GET') {
      if (p[4]) {
        const collectionId = p[4].replace(/\.svg$/, '');
        if (!uuid(collectionId)) throw problem('collection_missing', 404);
        const {
          rows: [record],
        } = await db.pool.query(
          'SELECT * FROM hd_m2_collections WHERE school_id=$1 AND user_id=$2 AND collection_id=$3',
          [s.schoolId, u, collectionId],
        );
        if (!record) throw problem('collection_missing', 404);
        if (p[4].endsWith('.svg') && record.kind === 'postcard') {
          const bytes = Buffer.from(postcardSvg(record.payload));
          res.writeHead(200, {
            'Content-Type': 'image/svg+xml',
            'Content-Length': bytes.length,
            'Content-Disposition': 'attachment; filename="campus-postcard.svg"',
            'Cache-Control': 'no-store',
          });
          res.end(bytes);
        } else json(res, 200, record);
      } else
        json(res, 200, {
          items: (
            await db.pool.query(
              'SELECT * FROM hd_m2_collections WHERE school_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100',
              [s.schoolId, u],
            )
          ).rows,
        });
      return true;
    }
    if (action === 'profile' || action === 'profiles') {
      const target = action === 'profile' ? u : p[4];
      if (!uuid(target)) throw problem('profile_missing', 404);
      await allowed(s.schoolId, target);
      const {
        rows: [old],
      } = await db.pool.query('SELECT * FROM hd_m2_profiles WHERE school_id=$1 AND user_id=$2', [
        s.schoolId,
        target,
      ]);
      if (req.method === 'GET') {
        const visible = Object.fromEntries(
          Object.entries(old?.fields || {}).filter(
            ([k]) => target === u || old.visibility[k] === 'school',
          ),
        );
        const {
          rows: [name],
        } = await db.pool.query('SELECT display_name FROM hd_users WHERE user_id=$1', [target]);
        json(res, 200, {
          userId: target,
          name: name.display_name,
          version: old?.version || 0,
          fields: visible,
          ...(target === u ? { visibility: old?.visibility || {} } : {}),
        });
        return true;
      }
      if (target !== u) throw problem('profile_owner_required', 403);
      const b = fields(
        await body(req),
        ['requestId', 'expectedVersion', 'fields', 'visibility'],
        'profile',
      );
      fields(b.fields, ['bio', 'department', 'year', 'interests'], 'profile');
      fields(b.visibility, ['bio', 'department', 'year', 'interests'], 'profile');
      if (
        !Number.isSafeInteger(b.expectedVersion) ||
        Object.keys(b.fields).some((k) => !['private', 'school'].includes(b.visibility[k])) ||
        typeof b.fields.bio !== 'string' ||
        b.fields.bio.length > 500 ||
        typeof b.fields.department !== 'string' ||
        b.fields.department.length > 80 ||
        typeof b.fields.year !== 'string' ||
        b.fields.year.length > 32 ||
        !Array.isArray(b.fields.interests) ||
        b.fields.interests.length > 8 ||
        b.fields.interests.some((x) => typeof x !== 'string' || x.length > 32)
      )
        throw problem('profile_invalid');
      const saved = await receipt(s.schoolId, u, b, async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          s.schoolId + ':m2-profile:' + u,
        ]);
        const {
          rows: [prior],
        } = await c.query('SELECT version FROM hd_m2_profiles WHERE school_id=$1 AND user_id=$2', [
          s.schoolId,
          u,
        ]);
        if ((prior?.version || 0) !== b.expectedVersion)
          throw problem('profile_write_conflict', 409);
        await c.query(
          'INSERT INTO hd_m2_profiles VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,user_id) DO UPDATE SET version=EXCLUDED.version,fields=EXCLUDED.fields,visibility=EXCLUDED.visibility',
          [s.schoolId, u, b.expectedVersion + 1, b.fields, b.visibility],
        );
        return { version: b.expectedVersion + 1 };
      });
      json(res, 200, saved);
      return true;
    }
    throw problem('m2_route_missing', 404);
  };
}
