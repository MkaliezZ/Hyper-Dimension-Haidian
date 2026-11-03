import { problem } from './db.mjs';
import { scope, audit } from './permissions.mjs';
import { fields } from '../protocol/index.mjs';
import { publicPlaces, publicPlace } from './world-places.mjs';

export function publicAnchor(world, school, anchor) {
  if (anchor === null || anchor === undefined) return null;
  if (
    !anchor ||
    typeof anchor !== 'object' ||
    Array.isArray(anchor) ||
    Object.keys(anchor).sort().join(',') !== 'entityId,sceneId'
  )
    throw problem('community_anchor_invalid');
  if (!publicPlace(world, school.spaceId, anchor.sceneId, anchor.entityId))
    throw problem('community_public_place_required', 403);
  return { sceneId: anchor.sceneId, entityId: anchor.entityId };
}

export function createCommunity(db, identity, services, config, { getWorld, validateAttachment }) {
  const lock = (c, s) =>
    c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [s + ':permissions']);
  const handle = async function handle(req, res, { url, json, body }) {
    const p = url.pathname.split('/').filter(Boolean);
    if (p[0] !== 'community') return false;
    if (p[1] !== 'schools' || !p[2] || !['GET', 'POST'].includes(req.method))
      throw problem('community_route_missing', 404);
    const s = services.school(p[2]),
      actor = (await identity.user(req)).user_id,
      org = p[3] === 'organizations' && p[4] ? p[4] : null,
      pos = org ? 5 : 3,
      action = p[pos];
    await db.member(s.schoolId, actor);
    if (action === 'contexts' && req.method === 'GET' && !org) {
      const m = await db.member(s.schoolId, actor),
        { rows } = await db.pool.query(
          `SELECT o.org_id,o.name,o.kind FROM hd_organizations o WHERE o.school_id=$1 AND o.active AND
        ($3='owner' OR EXISTS(SELECT 1 FROM hd_org_members m WHERE m.school_id=o.school_id AND m.org_id=o.org_id AND m.user_id=$2 AND m.active)) ORDER BY o.org_id`,
          [s.schoolId, actor, m.role],
        );
      json(res, 200, {
        schoolAccessible: !['partner', 'affiliate'].includes(m.role),
        organizations: rows,
      });
      return true;
    }
    await scope(db, s.schoolId, actor, org);
    if (action === 'post' && p[pos + 2] === 'attachments' && req.method === 'POST') {
      const b = fields(await body(req), ['requestId', 'attachmentId'], 'community_attachment');
      if (!validateAttachment) throw problem('community_attachments_unavailable', 503);
      const result = await db.tx(async (c) => {
        await lock(c, s.schoolId);
        await scope(db, s.schoolId, actor, org, 'read', c);
        await validateAttachment(c, {
          schoolId: s.schoolId,
          userId: actor,
          attachmentId: b.attachmentId,
          purpose: 'community',
          scopeId: org || '',
          targetId: p[pos + 1],
        });
        return services.forum(s, 'community-attachment-add', {
          ...b,
          userId: actor,
          orgId: org,
          id: p[pos + 1],
        });
      });
      json(res, 200, result);
      return true;
    }
    if (action === 'home') {
      if (req.method === 'GET') {
        const result = await db.tx(async (c) => {
          await lock(c, s.schoolId);
          const member = await scope(db, s.schoolId, actor, org, 'read', c);
          const page = (
            await c.query(
              'SELECT version,summary,anchor FROM hd_community_pages WHERE school_id=$1 AND scope_id=$2',
              [s.schoolId, org || ''],
            )
          ).rows[0];
          const name = org
            ? (
                await c.query(
                  'SELECT name FROM hd_organizations WHERE school_id=$1 AND org_id=$2',
                  [s.schoolId, org],
                )
              ).rows[0].name
            : s.schoolId;
          const owners = (
            await c.query(
              org
                ? `SELECT u.user_id,u.display_name FROM hd_users u JOIN hd_org_members m USING(user_id) WHERE m.school_id=$1 AND m.org_id=$2 AND m.active AND m.role='owner' AND u.enabled`
                : `SELECT u.user_id,u.display_name FROM hd_users u JOIN hd_memberships m USING(user_id) WHERE m.school_id=$1 AND m.active AND m.role='owner' AND u.enabled`,
              org ? [s.schoolId, org] : [s.schoolId],
            )
          ).rows;
          const places = publicPlaces(getWorld(), s.spaceId);
          return {
            schoolId: s.schoolId,
            orgId: org,
            spaceId: s.spaceId,
            name,
            owners,
            page: page || { version: 0, summary: '', anchor: null },
            places,
            canManage: member.role === 'owner',
            canModerate: ['owner', 'moderator'].includes(member.role),
            activityPath:
              '/activities.html?school=' +
              encodeURIComponent(s.schoolId) +
              (org ? '&organization=' + encodeURIComponent(org) : ''),
          };
        });
        json(res, 200, result);
        return true;
      }
      const b = fields(
        await body(req),
        ['requestId', 'expectedVersion', 'summary', 'anchor'],
        'community_home',
      );
      if (
        !Number.isSafeInteger(b.expectedVersion) ||
        b.expectedVersion < 0 ||
        typeof b.summary !== 'string' ||
        b.summary.length > 2000
      )
        throw problem('community_home_invalid');
      const anchor = publicAnchor(getWorld(), s, b.anchor);
      const result = await db.receipt(
        s.schoolId,
        actor,
        b.requestId,
        { module: 'community.home', org, b },
        async (c) => {
          await lock(c, s.schoolId);
          await scope(db, s.schoolId, actor, org, 'manage', c);
          const old = (
            await c.query(
              'SELECT version FROM hd_community_pages WHERE school_id=$1 AND scope_id=$2 FOR UPDATE',
              [s.schoolId, org || ''],
            )
          ).rows[0];
          if ((old?.version || 0) !== b.expectedVersion)
            throw problem('community_home_conflict', 409);
          await c.query(
            `INSERT INTO hd_community_pages(school_id,scope_id,version,summary,anchor,updated_by) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(school_id,scope_id) DO UPDATE SET version=EXCLUDED.version,summary=EXCLUDED.summary,anchor=EXCLUDED.anchor,updated_by=EXCLUDED.updated_by,updated_at=now()`,
            [s.schoolId, org || '', b.expectedVersion + 1, b.summary, anchor, actor],
          );
          await audit(c, s.schoolId, actor, 'community.home', org || s.schoolId, {
            version: b.expectedVersion + 1,
          });
          return { version: b.expectedVersion + 1 };
        },
      );
      json(res, 200, result);
      return true;
    }
    const getRoutes = {
      categories: 'community-categories',
      posts: 'community-list',
      map: 'community-list',
      drafts: 'community-drafts',
      post: 'community-detail',
    };
    const postRoutes = {
      categories: 'community-category-create',
      drafts: 'community-draft',
      submit: 'community-submit',
      action: 'community-action',
      edit: 'edit',
    };
    const route = req.method === 'GET' ? getRoutes[action] : postRoutes[action];
    if (!route) throw problem('community_route_missing', 404);
    let input;
    if (req.method === 'GET') {
      input = action === 'post' ? { id: p[pos + 1] } : {};
      if (['posts', 'map'].includes(action)) {
        input = {
          page: Number(url.searchParams.get('page') || 0),
          limit: Number(url.searchParams.get('limit') || 20),
          query: url.searchParams.get('query') || '',
          categoryId: url.searchParams.get('category') || null,
          parentId: url.searchParams.get('parent') || null,
        };
        if (action === 'map') {
          input.publishedOnly = true;
          input.anchor = publicAnchor(getWorld(), s, {
            sceneId: url.searchParams.get('sceneId'),
            entityId: url.searchParams.get('entityId'),
          });
        }
      }
    } else {
      const permitted = {
        categories: ['requestId', 'name', 'description'],
        drafts: [
          'requestId',
          'draftId',
          'expectedVersion',
          'title',
          'content',
          'categoryId',
          'anchor',
          'parentId',
        ],
        submit: ['requestId', 'draftId', 'expectedVersion'],
        action: [
          'requestId',
          'id',
          'action',
          'expectedRevision',
          'expectedWorkflowVersion',
          'reason',
          'decision',
          'reportId',
          'draftId',
        ],
        edit: ['requestId', 'id', 'expectedRevision', 'title', 'content'],
      };
      input = fields(await body(req), permitted[action], 'community_' + action);
      if (action === 'drafts') input.anchor = publicAnchor(getWorld(), s, input.anchor);
    }
    const result = await db.tx(async (c) => {
      await lock(c, s.schoolId);
      await scope(
        db,
        s.schoolId,
        actor,
        org,
        action === 'categories' && req.method === 'POST' ? 'moderate' : 'read',
        c,
      );
      const result = await services.forum(s, route, { ...input, userId: actor, orgId: org });
      if (req.method === 'POST')
        await audit(
          c,
          s.schoolId,
          actor,
          'community.' + action,
          result.id || result.draftId || result.categoryId || 'request',
          {
            requestId: input.requestId,
            action: input.action || action,
            revision: result.revision,
            reason: input.reason || null,
            orgId: org,
          },
        );
      return result;
    });
    json(res, 200, result);
    return true;
  };
  handle.canReadAttachment = async (c, { schoolId, userId, attachmentId, sourceId }) => {
    try {
      return (
        (
          await services.forum(services.school(schoolId), 'community-attachment-read', {
            userId,
            attachmentId,
            sourceId,
          })
        ).allowed === true
      );
    } catch (e) {
      if ([403, 404].includes(e.status)) return false;
      throw e;
    }
  };
  return handle;
}
