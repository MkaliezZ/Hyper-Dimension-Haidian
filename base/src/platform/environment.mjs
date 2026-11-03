import { randomUUID } from 'node:crypto';
import { problem } from './db.mjs';
import { scope, audit, validId } from './permissions.mjs';
import { fields } from '../protocol/index.mjs';
import { contactReceipt } from './contacts.mjs';
import { publicPlaces as worldPublicPlaces } from './world-places.mjs';
const uuid = (x) =>
  typeof x === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const text = (x, min, max) => {
  if (typeof x !== 'string' || x.trim().length < min || x.length > max)
    throw problem('environment_text_invalid');
  return x.trim();
};
const compare = (r, v) => {
  if (!Number.isSafeInteger(v) || v < 1) throw problem('expected_revision_required');
  if (r.revision !== v) throw problem('revision_conflict', 409);
};
const view = (r) =>
  Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_, x) => x.toUpperCase()), v]),
  );
export function createEnvironment(db, identity, services, config, { getWorld = () => null } = {}) {
  function places(school) {
    try {
      return worldPublicPlaces(getWorld(), services.school(school).spaceId);
    } catch {
      return [];
    }
  }
  function anchor(school, scene, entity) {
    const p = places(school).find((p) => p.sceneId === scene && p.entityId === entity);
    if (!p) throw problem('public_environment_anchor_required', 403);
    return p;
  }
  async function row(c, table, school, id) {
    const mapping = { places: 'place', announcements: 'announcement', feedback: 'feedback' };
    if (!mapping[table] || !uuid(id)) throw problem('environment_id_invalid');
    const r = (
      await c.query(
        `SELECT * FROM hd_environment_${table} WHERE school_id=$1 AND ${mapping[table]}_id=$2`,
        [school, id],
      )
    ).rows[0];
    if (!r) throw problem('environment_not_found', 404);
    return r;
  }
  async function active(c, school, p) {
    anchor(school, p.scene_id, p.entity_id);
    if (!p.active) throw problem('environment_place_inactive', 403);
    if (
      p.org_id &&
      !(
        await c.query(
          'SELECT 1 FROM hd_organizations WHERE school_id=$1 AND org_id=$2 AND active',
          [school, p.org_id],
        )
      ).rowCount
    )
      throw problem('organization_denied', 403);
    return p;
  }
  async function ordinary(c, school, user) {
    await scope(db, school, user, null, 'read', c);
  }
  async function assignment(c, school, user, p) {
    await active(c, school, p);
    await scope(db, school, user, p.org_id, 'manage', c);
  }
  async function handler(c, school, user, p) {
    await active(c, school, p);
    await scope(db, school, user, p.org_id, 'read', c);
    if (p.manager_user_id === user) return;
    await scope(db, school, user, p.org_id, 'moderate', c);
  }
  async function moderator(c, school, user, p) {
    await active(c, school, p);
    await scope(db, school, user, p.org_id, 'moderate', c);
  }
  async function permitted(fn) {
    try {
      await fn();
      return true;
    } catch (e) {
      if (e.status === 403) return false;
      throw e;
    }
  }
  async function currentManager(c, school, p) {
    return (
      p.manager_user_id &&
      (await permitted(() => scope(db, school, p.manager_user_id, p.org_id, 'read', c)))
    );
  }
  async function lock(c, school) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      school + ':permissions',
    ]);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      school + ':environment',
    ]);
  }
  async function mutate(school, user, path, input, acl, work) {
    return db.tx(async (c) => {
      await lock(c, school);
      await db.member(school, user, null, c);
      await acl(c);
      return contactReceipt(c, school, user, path, input, () => work(c));
    });
  }
  async function notify(c, school, user, eventId, payload, org = null) {
    if (!user) return;
    await c.query(
      'INSERT INTO hd_notifications(school_id,user_id,event_id,payload,scope_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [school, user, eventId, payload, org || ''],
    );
  }
  async function event(c, school, user, p, id, revision, kind, detail = {}) {
    const eventId = `${school}:base-environment:${id}:${revision}`,
      envelope = {
        schema: 'hyper-dimension.event/v1',
        eventId,
        schoolId: school,
        orgId: p.org_id || null,
        placeId: p.place_id,
        source: { kind: 'base-environment', id, revision },
        actorId: user,
        kind,
        occurredAt: new Date().toISOString(),
        detail,
      };
    await c.query(
      'INSERT INTO hd_environment_events(event_id,school_id,object_id,source_revision,actor_id,kind,envelope) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [eventId, school, id, revision, user, kind, envelope],
    );
    await audit(c, school, user, 'environment.' + kind, id, {
      ...detail,
      placeId: p.place_id,
      scopeId: p.org_id || null,
    });
    return eventId;
  }
  async function publicPlaces(c, school, query) {
    const bindings = (
        await c.query('SELECT * FROM hd_environment_places WHERE school_id=$1 AND active', [school])
      ).rows,
      announcements = (
        await c.query(
          "SELECT announcement_id,place_id,title,body,revision,updated_at FROM hd_environment_announcements WHERE school_id=$1 AND status='published'",
          [school],
        )
      ).rows;
    const result = [];
    for (const a of places(school)) {
      if (
        (query.get('sceneId') && a.sceneId !== query.get('sceneId')) ||
        (query.get('entityId') && a.entityId !== query.get('entityId'))
      )
        continue;
      const p = bindings.find((p) => p.scene_id === a.sceneId && p.entity_id === a.entityId);
      let visible = p && (await permitted(() => active(c, school, p)));
      result.push({
        ...a,
        placeId: visible ? p.place_id : null,
        publicRoleLabel:
          visible && p.role_label_published && (await currentManager(c, school, p))
            ? p.public_role_label
            : null,
        announcements: visible
          ? announcements
              .filter((n) => n.place_id === p.place_id)
              .map((n) => ({
                announcementId: n.announcement_id,
                title: n.title,
                body: n.body,
                revision: n.revision,
                updatedAt: n.updated_at,
              }))
          : [],
      });
    }
    return result;
  }
  async function presentFeedback(c, school, user, f, p) {
    const own = f.user_id === user,
      canHandle = await permitted(() => handler(c, school, user, p));
    if (!own && !canHandle) throw problem('environment_feedback_denied', 403);
    if (own) await ordinary(c, school, user);
    const base = {
      feedbackId: f.feedback_id,
      placeId: p.place_id,
      kind: f.kind,
      body: f.body,
      status: f.status,
      resolution: f.resolution,
      revision: f.revision,
      createdAt: f.created_at,
      updatedAt: f.updated_at,
      own,
      canHandle,
      claimedByMe: f.assigned_to === user,
    };
    if (canHandle) {
      base.authorName = (
        await c.query('SELECT display_name FROM hd_users WHERE user_id=$1', [f.user_id])
      ).rows[0]?.display_name;
      let canTakeOver =
        !f.assigned_to ||
        f.assigned_to === user ||
        !(await permitted(() => handler(c, school, f.assigned_to, p)));
      base.canClaim = ['submitted', 'claimed', 'in_progress'].includes(f.status) && canTakeOver;
      base.canAdvance = f.assigned_to === user && ['claimed', 'in_progress'].includes(f.status);
    }
    return base;
  }
  async function handle(req, res, { url, json, body }) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'environment') return false;
    if (!['GET', 'POST'].includes(req.method)) throw problem('method_denied', 405);
    if (parts[1] === 'public' && parts[2] === 'spaces') {
      if (req.method !== 'GET' || parts[4] !== 'places' || parts.length !== 5)
        throw problem('environment_route_missing', 404);
      const spaceId = decodeURIComponent(parts[3]),
        matches = config.schools.filter((s) => s.spaceId === spaceId);
      if (!matches.length) throw problem('school_missing', 404);
      if (matches.length !== 1) throw problem('space_school_ambiguous', 409);
      const school = matches[0].schoolId;
      if (!places(school).length) throw problem('public_environment_anchor_required', 403);
      json(res, 200, {
        schoolId: school,
        spaceId,
        places: await publicPlaces(db.pool, school, url.searchParams),
      });
      return true;
    }
    if (parts[1] === 'public' && parts[2] === 'schools') {
      const school = services.school(parts[3]).schoolId;
      if (req.method !== 'GET' || parts[4] !== 'places' || parts.length !== 5)
        throw problem('environment_route_missing', 404);
      json(res, 200, {
        schoolId: school,
        places: await publicPlaces(db.pool, school, url.searchParams),
      });
      return true;
    }
    if (parts[1] !== 'schools') throw problem('environment_route_missing', 404);
    const school = services.school(parts[2]).schoolId,
      user = (await identity.user(req)).user_id,
      resource = parts[3],
      id = parts[4],
      action = parts[5],
      path = url.pathname,
      send = (x) => {
        json(res, 200, x);
        return true;
      };
    await db.member(school, user);
    if (resource === 'places' && req.method === 'GET' && !id)
      return send(
        await db.tx(async (c) => {
          await lock(c, school);
          const m = await db.member(school, user, null, c),
            all = await publicPlaces(c, school, url.searchParams),
            result = [];
          for (const a of all) {
            const p = a.placeId ? await row(c, 'places', school, a.placeId) : null;
            const canAssign = p
                ? await permitted(() => assignment(c, school, user, p))
                : m.role === 'owner',
              canHandle = Boolean(p) && (await permitted(() => handler(c, school, user, p))),
              canReview = Boolean(p) && (await permitted(() => moderator(c, school, user, p)));
            result.push({
              ...a,
              canAssign,
              canHandle,
              canReview,
              canFeedback: Boolean(p) && (await permitted(() => ordinary(c, school, user))),
              ...(p && (canAssign || canHandle)
                ? {
                    managerUserId: p.manager_user_id,
                    orgId: p.org_id,
                    revision: p.revision,
                    roleLabelPublished: p.role_label_published,
                    configuredRoleLabel: p.public_role_label,
                  }
                : {}),
            });
          }
          return { schoolId: school, role: m.role, places: result };
        }),
      );
    if (resource === 'candidates' && req.method === 'GET')
      return send(
        await db.tx(async (c) => {
          await lock(c, school);
          const placeId = url.searchParams.get('placeId'),
            p = placeId ? await row(c, 'places', school, placeId) : null,
            org = p?.org_id || url.searchParams.get('org') || null;
          if (p) await assignment(c, school, user, p);
          else await scope(db, school, user, null, 'manage', c);
          if (org && !validId(org)) throw problem('organization_invalid');
          const candidates = (
            await c.query(
              `SELECT u.user_id,u.display_name FROM hd_users u JOIN hd_memberships m USING(user_id) WHERE m.school_id=$1 AND m.active AND u.enabled AND m.role NOT IN('partner','affiliate') AND ($2::text IS NULL OR m.role='owner' OR EXISTS(SELECT 1 FROM hd_org_members g JOIN hd_organizations o USING(school_id,org_id) WHERE g.school_id=m.school_id AND g.user_id=m.user_id AND g.org_id=$2 AND g.active AND o.active)) ORDER BY u.display_name,u.user_id LIMIT 300`,
              [school, org],
            )
          ).rows;
          return {
            candidates: candidates.map((r) => ({ userId: r.user_id, name: r.display_name })),
          };
        }),
      );
    if (resource === 'places' && req.method === 'POST') {
      const b = fields(
        await body(req),
        id
          ? [
              'requestId',
              'expectedRevision',
              'managerUserId',
              'publicRoleLabel',
              'publishRoleLabel',
            ]
          : [
              'requestId',
              'sceneId',
              'entityId',
              'orgId',
              'managerUserId',
              'publicRoleLabel',
              'publishRoleLabel',
            ],
        'environment_place',
      );
      if (id && action !== 'manage') throw problem('environment_route_missing', 404);
      const p = id ? await row(db.pool, 'places', school, id) : null;
      return send(
        await mutate(
          school,
          user,
          path,
          b,
          (c) => (p ? assignment(c, school, user, p) : scope(db, school, user, null, 'manage', c)),
          async (c) => {
            const existing = p ? await row(c, 'places', school, id) : null;
            if (existing) compare(existing, b.expectedRevision);
            else anchor(school, b.sceneId, b.entityId);
            const org = existing?.org_id || b.orgId || null;
            if (org && !validId(org)) throw problem('organization_invalid');
            if (b.managerUserId !== null && !uuid(b.managerUserId))
              throw problem('environment_manager_invalid');
            if (b.managerUserId) await scope(db, school, b.managerUserId, org, 'read', c);
            const label = text(b.publicRoleLabel, 0, 80);
            if (
              typeof b.publishRoleLabel !== 'boolean' ||
              (b.publishRoleLabel && (!label || !b.managerUserId))
            )
              throw problem('public_role_label_required');
            if (label.includes('@') || /https?:|\d{7,}|[0-9a-f]{8}-[0-9a-f]{4}/i.test(label))
              throw problem('public_role_label_not_contact');
            const placeId = existing?.place_id || randomUUID();
            if (!existing) {
              if (
                (
                  await c.query(
                    'SELECT 1 FROM hd_environment_places WHERE school_id=$1 AND scene_id=$2 AND entity_id=$3',
                    [school, b.sceneId, b.entityId],
                  )
                ).rowCount
              )
                throw problem('environment_anchor_assigned', 409);
              if (org) await scope(db, school, user, org, 'manage', c);
              await c.query(
                'INSERT INTO hd_environment_places(school_id,place_id,scene_id,entity_id,org_id,manager_user_id,public_role_label,role_label_published,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
                [
                  school,
                  placeId,
                  b.sceneId,
                  b.entityId,
                  org,
                  b.managerUserId,
                  label,
                  b.publishRoleLabel,
                  user,
                ],
              );
            } else
              await c.query(
                'UPDATE hd_environment_places SET manager_user_id=$3,public_role_label=$4,role_label_published=$5,revision=revision+1,updated_at=now() WHERE school_id=$1 AND place_id=$2',
                [school, placeId, b.managerUserId, label, b.publishRoleLabel],
              );
            const updated = await row(c, 'places', school, placeId);
            const ev = await event(
              c,
              school,
              user,
              updated,
              placeId,
              updated.revision,
              'place_assignment',
              {
                roleLabelPublished: b.publishRoleLabel,
                scopeId: org,
                managerUserId: b.managerUserId,
                publicRoleLabel: label,
              },
            );
            await notify(
              c,
              school,
              b.managerUserId,
              ev,
              { type: 'environment_assignment', placeId },
              org,
            );
            return view(updated);
          },
        ),
      );
    }
    if (resource === 'announcements' && req.method === 'GET')
      return send(
        await db.tx(async (c) => {
          await lock(c, school);
          const p = await row(c, 'places', school, url.searchParams.get('placeId'));
          await handler(c, school, user, p);
          return {
            announcements: (
              await c.query(
                'SELECT * FROM hd_environment_announcements WHERE school_id=$1 AND place_id=$2 ORDER BY created_at DESC LIMIT 200',
                [school, p.place_id],
              )
            ).rows.map(view),
          };
        }),
      );
    if (resource === 'announcements' && req.method === 'POST') {
      const b = fields(
        await body(req),
        !id
          ? ['requestId', 'placeId', 'title', 'body']
          : action === 'edit'
            ? ['requestId', 'expectedRevision', 'title', 'body']
            : ['requestId', 'expectedRevision', 'decision', 'reason'],
        'environment_announcement',
      );
      const n = id ? await row(db.pool, 'announcements', school, id) : null,
        p = await row(db.pool, 'places', school, n?.place_id || b.placeId);
      const acl = async (c) => {
        const current = await row(c, 'places', school, p.place_id);
        if (['review', 'withdraw'].includes(action)) await moderator(c, school, user, current);
        else await handler(c, school, user, current);
      };
      return send(
        await mutate(school, user, path, b, acl, async (c) => {
          let n = id ? await row(c, 'announcements', school, id) : null;
          if (n) compare(n, b.expectedRevision);
          const announcementId = id || randomUUID();
          let kind;
          if (!id) {
            await c.query(
              "INSERT INTO hd_environment_announcements(school_id,announcement_id,place_id,author_id,title,body,status) VALUES($1,$2,$3,$4,$5,$6,'draft')",
              [
                school,
                announcementId,
                p.place_id,
                user,
                text(b.title, 2, 150),
                text(b.body, 5, 5000),
              ],
            );
            kind = 'announcement_draft';
          } else if (action === 'edit') {
            if (!['draft', 'rejected'].includes(n.status))
              throw problem('announcement_edit_state', 409);
            await c.query(
              "UPDATE hd_environment_announcements SET title=$3,body=$4,status='draft',revision=revision+1,updated_at=now() WHERE school_id=$1 AND announcement_id=$2",
              [school, id, text(b.title, 2, 150), text(b.body, 5, 5000)],
            );
            kind = 'announcement_edit';
          } else {
            let target;
            if (action === 'submit') {
              if (!['draft', 'rejected'].includes(n.status))
                throw problem('announcement_submit_state', 409);
              target = 'pending';
            } else if (action === 'review') {
              if (n.status !== 'pending' || !['publish', 'reject'].includes(b.decision))
                throw problem('announcement_review_state', 409);
              text(b.reason, 3, 1000);
              target = b.decision === 'publish' ? 'published' : 'rejected';
            } else if (action === 'withdraw') {
              if (n.status !== 'published') throw problem('announcement_withdraw_state', 409);
              text(b.reason, 3, 1000);
              target = 'withdrawn';
            } else throw problem('environment_route_missing', 404);
            await c.query(
              'UPDATE hd_environment_announcements SET status=$3,revision=revision+1,reviewed_by=$4,review_reason=$5,updated_at=now() WHERE school_id=$1 AND announcement_id=$2',
              [school, id, target, action === 'submit' ? null : user, b.reason || null],
            );
            kind = 'announcement_' + target;
          }
          n = await row(c, 'announcements', school, announcementId);
          await event(c, school, user, p, announcementId, n.revision, kind, {
            status: n.status,
            title: n.title,
            body: n.body,
            reason: b.reason || null,
          });
          return view(n);
        }),
      );
    }
    if (resource === 'feedback' && req.method === 'GET')
      return send(
        await db.tx(async (c) => {
          await lock(c, school);
          await ordinary(c, school, user);
          const placeId = url.searchParams.get('placeId'),
            mode = url.searchParams.get('mode') || 'mine';
          if (!['mine', 'manage'].includes(mode)) throw problem('feedback_mode_invalid');
          const p = placeId ? await row(c, 'places', school, placeId) : null;
          if (mode === 'manage') {
            if (!p) throw problem('place_required');
            await handler(c, school, user, p);
          }
          const rows = (
              await c.query(
                `SELECT * FROM hd_environment_feedback WHERE school_id=$1 ${mode === 'mine' ? 'AND user_id=$2' : 'AND $2::uuid IS NOT NULL'} ${p ? 'AND place_id=$3' : ''} ORDER BY created_at DESC LIMIT 200`,
                p ? [school, user, p.place_id] : [school, user],
              )
            ).rows,
            items = [];
          for (const f of rows) {
            const place = p || (await row(c, 'places', school, f.place_id));
            items.push(await presentFeedback(c, school, user, f, place));
          }
          return { items };
        }),
      );
    if (resource === 'feedback' && req.method === 'POST') {
      const b = fields(
        await body(req),
        id
          ? ['requestId', 'expectedRevision', 'status', 'reason']
          : ['requestId', 'placeId', 'kind', 'body'],
        'environment_feedback',
      );
      if (id && action !== 'transition') throw problem('environment_route_missing', 404);
      const initial = id ? await row(db.pool, 'feedback', school, id) : null,
        p = await row(db.pool, 'places', school, initial?.place_id || b.placeId);
      const acl = async (c) => {
        const current = await row(c, 'places', school, p.place_id);
        await active(c, school, current);
        if (id) await handler(c, school, user, current);
        else await ordinary(c, school, user);
      };
      return send(
        await mutate(school, user, path, b, acl, async (c) => {
          const currentPlace = await row(c, 'places', school, p.place_id);
          let f = id ? await row(c, 'feedback', school, id) : null,
            feedbackId = id || randomUUID();
          if (!id) {
            if (!['problem', 'suggestion'].includes(b.kind)) throw problem('feedback_kind_invalid');
            await c.query(
              "INSERT INTO hd_environment_feedback(school_id,feedback_id,place_id,user_id,kind,body,status) VALUES($1,$2,$3,$4,$5,$6,'submitted')",
              [school, feedbackId, p.place_id, user, b.kind, text(b.body, 5, 3000)],
            );
          } else {
            compare(f, b.expectedRevision);
            text(b.reason, 3, 1000);
            if (!['claimed', 'in_progress', 'resolved', 'rejected'].includes(b.status))
              throw problem('feedback_status_invalid');
            if (['resolved', 'rejected'].includes(f.status))
              throw problem('feedback_already_closed', 409);
            if (b.status === 'claimed') {
              if (
                f.assigned_to &&
                f.assigned_to !== user &&
                (await permitted(() => handler(c, school, f.assigned_to, currentPlace)))
              )
                throw problem('feedback_already_claimed', 409);
            } else {
              if (f.assigned_to !== user || !['claimed', 'in_progress'].includes(f.status))
                throw problem('feedback_assignee_required', 403);
              if (b.status === 'resolved' && f.status !== 'in_progress')
                throw problem('feedback_processing_required', 409);
            }
            await c.query(
              'UPDATE hd_environment_feedback SET status=$3,assigned_to=$4,resolution=$5,revision=revision+1,updated_at=now() WHERE school_id=$1 AND feedback_id=$2',
              [school, id, b.status, user, b.reason],
            );
          }
          f = await row(c, 'feedback', school, feedbackId);
          const ev = await event(
            c,
            school,
            user,
            currentPlace,
            feedbackId,
            f.revision,
            'feedback_' + f.status,
            { status: f.status, reason: b.reason || null },
          );
          if (!id && (await currentManager(c, school, currentPlace)))
            await notify(
              c,
              school,
              currentPlace.manager_user_id,
              ev,
              { type: 'environment_feedback', placeId: p.place_id, feedbackId, status: f.status },
              p.org_id,
            );
          if (id)
            await notify(c, school, f.user_id, ev, {
              type: 'environment_feedback',
              placeId: p.place_id,
              feedbackId,
              status: f.status,
            });
          return presentFeedback(c, school, user, f, currentPlace);
        }),
      );
    }
    throw problem('environment_route_missing', 404);
  }
  return { handle };
}
