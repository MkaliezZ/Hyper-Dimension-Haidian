import { randomUUID } from 'node:crypto';
import { problem } from './db.mjs';
import { scope, audit, validId } from './permissions.mjs';
import { fields } from '../protocol/index.mjs';
import { publicAnchor } from './community.mjs';
import { publicPlaces } from './world-places.mjs';
import { safeWorkLink } from './personal.mjs';

const kinds = ['internship', 'job', 'scholarship', 'project', 'experience', 'consultation'];
const uuid = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
function text(v, min, max) {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max || /[\u0000-\u0008]/.test(v))
    throw problem('network_text_invalid');
  return v.trim();
}
function version(v) {
  if (!Number.isSafeInteger(v) || v < 0) throw problem('revision_required');
  return v;
}
function id(v) {
  if (!uuid(v)) throw problem('network_id_invalid');
  return v;
}
function pageFor(url) {
  const p = Number(url.searchParams.get('page') || 0);
  if (!Number.isSafeInteger(p) || p < 0 || p > 1000) throw problem('network_page_invalid');
  return p;
}
function time(v) {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    throw problem('network_time_invalid');
  return new Date(v);
}
export function directoryDocument(v) {
  fields(
    v,
    ['name', 'department', 'year', 'kind', 'bio', 'city', 'tags', 'mentor'],
    'directory_document',
  );
  if (
    !['student', 'alumni', 'staff'].includes(v.kind) ||
    typeof v.mentor !== 'boolean' ||
    !Array.isArray(v.tags) ||
    v.tags.length > 12
  )
    throw problem('directory_document_invalid');
  return {
    name: text(v.name, 1, 80),
    department: text(v.department || '', 0, 100),
    year: text(v.year || '', 0, 20),
    kind: v.kind,
    bio: text(v.bio, 8, 1000),
    city: text(v.city || '', 0, 80),
    tags: [...new Set(v.tags.map((t) => text(t, 1, 30)))],
    mentor: v.mentor,
  };
}
const profilePublic = (r) => ({
  userId: r.user_id,
  revision: r.revision,
  document: r.document,
  anchor: r.anchor,
  identityLabel: '本人自述；审核不等于学校核验履历',
  updatedAt: r.updated_at,
});
const bookingPublic = (r) => ({
  bookingId: r.booking_id,
  slotId: r.slot_id,
  status: r.status,
  revision: r.revision,
  updatedAt: r.updated_at,
  reason: r.reason,
});
const activeMembership = `EXISTS(SELECT 1 FROM hd_memberships m JOIN hd_users u USING(user_id) WHERE m.school_id=p.school_id AND m.user_id=p.user_id AND m.active AND m.role NOT IN ('partner','affiliate') AND u.enabled)`;

export function createNetwork(db, identity, services, { getWorld, modulePolicy }) {
  const lock = (c, s) =>
    c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [s + ':permissions']);
  async function notify(c, s, user, object, revision, status) {
    await c.query(
      `INSERT INTO hd_notifications(school_id,user_id,event_id,payload,scope_id)
      VALUES($1,$2,$3,$4,'') ON CONFLICT DO NOTHING`,
      [
        s,
        user,
        'network:' + object + ':' + revision,
        { type: 'mentor-booking', objectId: object, revision, status },
      ],
    );
  }
  async function approved(c, s, u) {
    const r = (
      await c.query(
        `SELECT p.* FROM hd_network_profiles p WHERE p.school_id=$1 AND p.user_id=$2 AND p.status='published' AND ${activeMembership}`,
        [s, u],
      )
    ).rows[0];
    if (!r) throw problem('directory_not_published', 409);
    if (r.anchor) publicAnchor(getWorld(), services.school(s), r.anchor);
    return r;
  }
  async function cancelSlots(c, s, u, reason) {
    const slots = (
      await c.query(
        "UPDATE hd_mentor_slots SET status='closed',revision=revision+1,updated_at=now() WHERE school_id=$1 AND mentor_id=$2 AND status='open' RETURNING slot_id",
        [s, u],
      )
    ).rows;
    for (const slot of slots) {
      const bookings = (
        await c.query(
          "UPDATE hd_mentor_bookings SET status='canceled',reason=$3,revision=revision+1,updated_at=now() WHERE school_id=$1 AND slot_id=$2 AND status IN ('requested','confirmed') RETURNING *",
          [s, slot.slot_id, reason],
        )
      ).rows;
      for (const b of bookings)
        await notify(c, s, b.student_id, b.booking_id, b.revision, b.status);
    }
  }
  async function source(c, s, actor, r, { manage = false, published = false } = {}) {
    await scope(db, s.schoolId, actor, r.org_id, manage ? 'moderate' : 'read', c);
    const post = await services.forum(s, 'community-detail', {
      userId: actor,
      orgId: r.org_id || null,
      id: r.source_id,
    });
    if (post.parentId) throw problem('opportunity_top_level_required');
    if (published && post.sourceStatus !== 'published')
      throw problem('opportunity_not_published', 404);
    return post;
  }
  return async function handle(req, res, { url, json, body }) {
    const p = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (p[0] !== 'network') return false;
    if (p[1] !== 'schools' || !p[2] || p.length !== 4 || !['GET', 'POST'].includes(req.method))
      throw problem('network_route_missing', 404);
    const s = services.school(p[2]),
      actor = (await identity.user(req)).user_id,
      action = p[3];
    if (modulePolicy && !modulePolicy.forSchool(s.schoolId).base3)
      throw problem('module_disabled', 409);
    const rootPermission = async (c) => {
      await lock(c, s.schoolId);
      return scope(db, s.schoolId, actor, null, 'read', c);
    };
    const read = (fn) =>
      db.tx(async (c) => {
        const member = await rootPermission(c);
        return fn(c, member);
      });
    const write = (b, fn, authorize) =>
      db.receipt(
        s.schoolId,
        actor,
        b.requestId,
        { module: 'network', action, input: b },
        fn,
        async (c) => {
          await rootPermission(c);
          if (authorize) await authorize(c);
        },
      );
    let result;
    if (req.method === 'GET') {
      result = await read(async (c, member) => {
        const moderate = ['owner', 'moderator'].includes(member.role);
        const orgModerator = async () =>
          Boolean(
            (
              await c.query(
                `SELECT 1 FROM hd_org_members m JOIN hd_organizations o USING(school_id,org_id) WHERE m.school_id=$1 AND m.user_id=$2 AND m.active AND o.active AND m.role IN ('owner','moderator') LIMIT 1`,
                [s.schoolId, actor],
              )
            ).rowCount,
          );
        if (action === 'bootstrap')
          return {
            schoolId: s.schoolId,
            userId: actor,
            canModerate: moderate,
            canOpportunityModerate: moderate || (await orgModerator()),
            canManage: member.role === 'owner',
            kinds,
            places: publicPlaces(getWorld(), s.spaceId),
          };
        if (action === 'my-profile')
          return (
            (
              await c.query('SELECT * FROM hd_network_profiles WHERE school_id=$1 AND user_id=$2', [
                s.schoolId,
                actor,
              ])
            ).rows[0] || { revision: 0, status: 'not_joined', document: null }
          );
        if (action === 'directory' || action === 'review') {
          if (action === 'review') await scope(db, s.schoolId, actor, null, 'moderate', c);
          const page = Number(url.searchParams.get('page') || 0),
            q = text(url.searchParams.get('query') || '', 0, 100),
            dept = text(url.searchParams.get('department') || '', 0, 100),
            year = text(url.searchParams.get('year') || '', 0, 20),
            kind = text(url.searchParams.get('kind') || '', 0, 20),
            tag = text(url.searchParams.get('tag') || '', 0, 30);
          if (!Number.isSafeInteger(page) || page < 0 || page > 1000)
            throw problem('network_page_invalid');
          const anchor = url.searchParams.has('sceneId')
            ? publicAnchor(getWorld(), s, {
                sceneId: url.searchParams.get('sceneId'),
                entityId: url.searchParams.get('entityId'),
              })
            : null;
          const { rows } = await c.query(
            `SELECT p.*,count(*) OVER()::integer AS total FROM hd_network_profiles p WHERE school_id=$1
            AND ($2 OR status='published') AND ${activeMembership}
            AND ($3='' OR strpos(lower(document::text),lower($3))>0) AND ($4='' OR document->>'department'=$4)
            AND ($5='' OR document->>'year'=$5) AND ($6='' OR document->>'kind'=$6) AND ($7='' OR document->'tags' ? $7)
            AND ($8::jsonb IS NULL OR anchor=$8::jsonb) ORDER BY updated_at DESC,user_id LIMIT 20 OFFSET $9`,
            [s.schoolId, action === 'review', q, dept, year, kind, tag, anchor, page * 20],
          );
          const items = [];
          for (const r of rows) {
            if (r.anchor) {
              try {
                publicAnchor(getWorld(), s, r.anchor);
              } catch {
                if (action !== 'review') continue;
              }
            }
            items.push(action === 'review' ? r : profilePublic(r));
          }
          return { items, page, total: rows[0]?.total || 0 };
        }
        if (action === 'slots' || action === 'slot-admin') {
          const admin = action === 'slot-admin';
          if (admin) await scope(db, s.schoolId, actor, null, 'moderate', c);
          const mentor = url.searchParams.get('mentor');
          if (mentor) id(mentor);
          const { rows } = await c.query(
            `SELECT sl.*,p.document->>'name' AS mentor_name,(SELECT count(*)::integer FROM hd_mentor_bookings b WHERE b.slot_id=sl.slot_id AND b.status IN ('requested','confirmed')) AS reserved
            FROM hd_mentor_slots sl JOIN hd_network_profiles p ON p.school_id=sl.school_id AND p.user_id=sl.mentor_id
            WHERE sl.school_id=$1 AND ($2::uuid IS NULL OR sl.mentor_id=$2) AND ($3 OR (sl.status='open' AND sl.starts_at>now() AND p.status='published' AND p.document->>'mentor'='true' AND ${activeMembership}))
            ORDER BY starts_at,slot_id LIMIT $4 OFFSET $5`,
            [
              s.schoolId,
              mentor || null,
              admin,
              admin ? 20 : 100,
              pageFor(url) * (admin ? 20 : 100),
            ],
          );
          return {
            items: rows.filter((r) => {
              if (admin) return true;
              try {
                publicAnchor(getWorld(), s, r.anchor);
                return true;
              } catch {
                return false;
              }
            }),
          };
        }
        if (action === 'bookings' || action === 'booking-admin') {
          if (action === 'booking-admin') await scope(db, s.schoolId, actor, null, 'moderate', c);
          const { rows } = await c.query(
            `SELECT b.*,sl.mentor_id,sl.topic,sl.starts_at,sl.ends_at,sl.anchor FROM hd_mentor_bookings b JOIN hd_mentor_slots sl USING(slot_id,school_id)
             WHERE b.school_id=$1 AND ($3 OR b.student_id=$2 OR sl.mentor_id=$2) ORDER BY b.updated_at DESC,booking_id LIMIT $4 OFFSET $5`,
            [
              s.schoolId,
              actor,
              action === 'booking-admin',
              action === 'booking-admin' ? 20 : 100,
              pageFor(url) * (action === 'booking-admin' ? 20 : 100),
            ],
          );
          return {
            items: rows.map((r) =>
              action === 'booking-admin' && r.student_id !== actor && r.mentor_id !== actor
                ? { ...r, question: undefined }
                : r,
            ),
          };
        }
        if (['opportunities', 'opportunity-admin', 'my-opportunities'].includes(action)) {
          if (action === 'opportunity-admin' && !moderate && !(await orgModerator()))
            throw problem('moderation_denied', 403);
          const admin = action === 'opportunity-admin',
            mine = action === 'my-opportunities',
            q = text(url.searchParams.get('query') || '', 0, 100),
            kind = url.searchParams.get('kind') || '';
          const anchor = url.searchParams.has('sceneId')
            ? publicAnchor(getWorld(), s, {
                sceneId: url.searchParams.get('sceneId'),
                entityId: url.searchParams.get('entityId'),
              })
            : null;
          const page = Number(url.searchParams.get('page') || 0);
          if (!Number.isSafeInteger(page) || page < 0 || page > 1000)
            throw problem('network_page_invalid');
          const rows = (
            await c.query(
              `SELECT o.*,EXISTS(SELECT 1 FROM hd_career_bookmarks b WHERE b.school_id=o.school_id AND b.opportunity_id=o.opportunity_id AND b.user_id=$2) AS bookmarked
             FROM hd_career_opportunities o WHERE school_id=$1 AND (($7 AND author_id=$2) OR $3 OR (NOT $7 AND status='active' AND deadline>now())) AND ($4='' OR kind=$4) AND ($5::jsonb IS NULL OR anchor=$5::jsonb)
             ORDER BY updated_at DESC,opportunity_id LIMIT 20 OFFSET $6`,
              [s.schoolId, actor, admin, kind, anchor, page * 20, mine],
            )
          ).rows;
          const items = [];
          for (const r of rows) {
            try {
              let invalidAnchor = false;
              if (r.anchor)
                try {
                  publicAnchor(getWorld(), s, r.anchor);
                } catch (e) {
                  if (!admin && !mine) throw e;
                  invalidAnchor = true;
                }
              const native = await source(c, s, actor, r, {
                published: !admin && !mine,
                manage: admin,
              });
              if (!admin && !mine && native.revision !== r.approved_source_revision) continue;
              if (
                q &&
                !(native.title + ' ' + r.organization + ' ' + r.audience)
                  .toLowerCase()
                  .includes(q.toLowerCase())
              )
                continue;
              items.push({
                ...r,
                invalidAnchor,
                title: native.title,
                sourceStatus: native.sourceStatus,
                sourceRevision: native.revision,
                workflowVersion: native.workflowVersion,
                source: 'nodebb',
                identityLabel: '发布信息，学校不自动担保雇主或机会真实性',
              });
            } catch (e) {
              if (![403, 404, 409].includes(e.status)) throw e;
            }
          }
          return { items, page, hasMore: rows.length === 20 };
        }
        throw problem('network_route_missing', 404);
      });
    } else if (action === 'profile') {
      const b = fields(
          await body(req),
          ['requestId', 'expectedRevision', 'consent', 'document', 'anchor'],
          'directory_profile',
        ),
        document = directoryDocument(b.document),
        anchor = publicAnchor(getWorld(), s, b.anchor);
      if (b.consent !== true) throw problem('directory_explicit_consent_required');
      version(b.expectedRevision);
      result = await write(b, async (c) => {
        const old = (
          await c.query(
            'SELECT * FROM hd_network_profiles WHERE school_id=$1 AND user_id=$2 FOR UPDATE',
            [s.schoolId, actor],
          )
        ).rows[0];
        if ((old?.revision || 0) !== b.expectedRevision) throw problem('revision_conflict', 409);
        await cancelSlots(c, s.schoolId, actor, '支持名片修改后需要重新审核');
        const r = (
          await c.query(
            `INSERT INTO hd_network_profiles(school_id,user_id,revision,status,document,anchor) VALUES($1,$2,$3,'pending',$4,$5)
          ON CONFLICT(school_id,user_id) DO UPDATE SET revision=EXCLUDED.revision,status='pending',document=EXCLUDED.document,anchor=EXCLUDED.anchor,moderation_reason='',updated_at=now() RETURNING *`,
            [s.schoolId, actor, b.expectedRevision + 1, document, anchor],
          )
        ).rows[0];
        await audit(c, s.schoolId, actor, 'directory.submit', actor, {
          revision: r.revision,
          consent: true,
        });
        return r;
      });
    } else if (action === 'profile-action') {
      const b = fields(
        await body(req),
        ['requestId', 'userId', 'expectedRevision', 'action', 'reason'],
        'directory_action',
      );
      id(b.userId);
      version(b.expectedRevision);
      text(b.reason, 3, 1000);
      if (!['approve', 'reject', 'suspend', 'withdraw'].includes(b.action))
        throw problem('directory_action_invalid');
      const auth = async (c) => {
        if (b.action === 'withdraw') {
          if (b.userId !== actor) throw problem('directory_owner_required', 403);
        } else await scope(db, s.schoolId, actor, null, 'moderate', c);
      };
      result = await write(
        b,
        async (c) => {
          const old = (
            await c.query(
              'SELECT * FROM hd_network_profiles WHERE school_id=$1 AND user_id=$2 FOR UPDATE',
              [s.schoolId, b.userId],
            )
          ).rows[0];
          if (!old) throw problem('directory_missing', 404);
          if (old.revision !== b.expectedRevision) throw problem('revision_conflict', 409);
          if (['approve', 'reject'].includes(b.action) && old.status !== 'pending')
            throw problem('directory_not_pending', 409);
          if (b.action === 'approve') {
            await scope(db, s.schoolId, b.userId, null, 'read', c);
            publicAnchor(getWorld(), s, old.anchor);
          }
          const status = {
            approve: 'published',
            reject: 'rejected',
            suspend: 'suspended',
            withdraw: 'withdrawn',
          }[b.action];
          const r = (
            await c.query(
              'UPDATE hd_network_profiles SET status=$3,moderation_reason=$4,revision=revision+1,updated_at=now() WHERE school_id=$1 AND user_id=$2 RETURNING *',
              [s.schoolId, b.userId, status, b.reason],
            )
          ).rows[0];
          if (status !== 'published') await cancelSlots(c, s.schoolId, b.userId, b.reason);
          await audit(c, s.schoolId, actor, 'directory.' + b.action, b.userId, {
            revision: r.revision,
            reason: b.reason,
          });
          return r;
        },
        auth,
      );
    } else if (action === 'slot') {
      const b = fields(
          await body(req),
          ['requestId', 'startsAt', 'endsAt', 'capacity', 'topic', 'anchor'],
          'mentor_slot',
        ),
        start = time(b.startsAt),
        end = time(b.endsAt),
        topic = text(b.topic, 3, 200),
        anchor = publicAnchor(getWorld(), s, b.anchor);
      if (
        start <= new Date() ||
        end <= start ||
        end - start > 8 * 3600000 ||
        start - new Date() > 366 * 86400000 ||
        !Number.isSafeInteger(b.capacity) ||
        b.capacity < 1 ||
        b.capacity > 20
      )
        throw problem('mentor_slot_invalid');
      result = await write(b, async (c) => {
        const profile = await approved(c, s.schoolId, actor);
        if (profile.document.mentor !== true) throw problem('mentor_opt_in_required', 409);
        if (
          (
            await c.query(
              "SELECT 1 FROM hd_mentor_slots WHERE school_id=$1 AND mentor_id=$2 AND status='open' AND starts_at<$4 AND ends_at>$3",
              [s.schoolId, actor, start, end],
            )
          ).rowCount
        )
          throw problem('mentor_overlap', 409);
        const r = (
          await c.query(
            "INSERT INTO hd_mentor_slots(slot_id,school_id,mentor_id,starts_at,ends_at,capacity,topic,anchor,status,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'open',1) RETURNING *",
            [randomUUID(), s.schoolId, actor, start, end, b.capacity, topic, anchor],
          )
        ).rows[0];
        await audit(c, s.schoolId, actor, 'mentor.slot', r.slot_id, { revision: 1 });
        return r;
      });
    } else if (action === 'slot-close') {
      const b = fields(
        await body(req),
        ['requestId', 'slotId', 'expectedRevision', 'reason'],
        'mentor_slot_close',
      );
      id(b.slotId);
      version(b.expectedRevision);
      text(b.reason, 3, 1000);
      const auth = async (c) => {
        const r = (
          await c.query('SELECT mentor_id FROM hd_mentor_slots WHERE school_id=$1 AND slot_id=$2', [
            s.schoolId,
            b.slotId,
          ])
        ).rows[0];
        if (!r) throw problem('mentor_slot_missing', 404);
        if (r.mentor_id !== actor) await scope(db, s.schoolId, actor, null, 'moderate', c);
      };
      result = await write(
        b,
        async (c) => {
          const r = (
            await c.query(
              'SELECT * FROM hd_mentor_slots WHERE school_id=$1 AND slot_id=$2 FOR UPDATE',
              [s.schoolId, b.slotId],
            )
          ).rows[0];
          if (r.revision !== b.expectedRevision) throw problem('revision_conflict', 409);
          await c.query(
            "UPDATE hd_mentor_slots SET status='closed',revision=revision+1,updated_at=now() WHERE slot_id=$1",
            [r.slot_id],
          );
          const bookings = (
            await c.query(
              "UPDATE hd_mentor_bookings SET status='canceled',reason=$2,revision=revision+1,updated_at=now() WHERE slot_id=$1 AND status IN ('requested','confirmed') RETURNING *",
              [r.slot_id, b.reason],
            )
          ).rows;
          for (const x of bookings)
            await notify(c, s.schoolId, x.student_id, x.booking_id, x.revision, x.status);
          await audit(c, s.schoolId, actor, 'mentor.slot-close', r.slot_id, { reason: b.reason });
          return { slotId: r.slot_id, status: 'closed', revision: r.revision + 1 };
        },
        auth,
      );
    } else if (action === 'book') {
      const b = fields(await body(req), ['requestId', 'slotId', 'question'], 'mentor_book');
      id(b.slotId);
      const question = text(b.question, 8, 1000);
      result = await write(b, async (c) => {
        const sl = (
          await c.query(
            'SELECT * FROM hd_mentor_slots WHERE school_id=$1 AND slot_id=$2 FOR UPDATE',
            [s.schoolId, b.slotId],
          )
        ).rows[0];
        if (!sl || sl.status !== 'open' || sl.starts_at <= new Date())
          throw problem('mentor_slot_unavailable', 409);
        if (sl.mentor_id === actor) throw problem('mentor_self_booking', 409);
        const mentor = await approved(c, s.schoolId, sl.mentor_id);
        if (mentor.document.mentor !== true) throw problem('mentor_opt_in_required', 409);
        publicAnchor(getWorld(), s, sl.anchor);
        const active = (
          await c.query(
            "SELECT student_id FROM hd_mentor_bookings WHERE slot_id=$1 AND status IN ('requested','confirmed')",
            [sl.slot_id],
          )
        ).rows;
        if (active.some((r) => r.student_id === actor))
          throw problem('mentor_duplicate_booking', 409);
        if (active.length >= sl.capacity) throw problem('mentor_slot_full', 409);
        if (
          (
            await c.query(
              "SELECT 1 FROM hd_mentor_bookings b JOIN hd_mentor_slots sl USING(slot_id,school_id) WHERE b.school_id=$1 AND b.student_id=$2 AND b.status IN ('requested','confirmed') AND sl.starts_at<$4 AND sl.ends_at>$3",
              [s.schoolId, actor, sl.starts_at, sl.ends_at],
            )
          ).rowCount
        )
          throw problem('mentor_student_overlap', 409);
        const r = (
          await c.query(
            "INSERT INTO hd_mentor_bookings(booking_id,school_id,slot_id,student_id,status,question,revision) VALUES($1,$2,$3,$4,'requested',$5,1) RETURNING *",
            [randomUUID(), s.schoolId, sl.slot_id, actor, question],
          )
        ).rows[0];
        await notify(c, s.schoolId, sl.mentor_id, r.booking_id, 1, r.status);
        await audit(c, s.schoolId, actor, 'mentor.request', r.booking_id, {
          slotId: sl.slot_id,
          revision: 1,
        });
        return bookingPublic(r);
      });
    } else if (action === 'booking-action') {
      const b = fields(
        await body(req),
        ['requestId', 'bookingId', 'expectedRevision', 'action', 'reason'],
        'mentor_booking_action',
      );
      id(b.bookingId);
      version(b.expectedRevision);
      text(b.reason, 3, 1000);
      if (!['confirm', 'decline', 'cancel', 'complete'].includes(b.action))
        throw problem('mentor_action_invalid');
      const get = async (c) => {
        const r = (
          await c.query(
            'SELECT b.*,sl.mentor_id,sl.ends_at,sl.status AS slot_status FROM hd_mentor_bookings b JOIN hd_mentor_slots sl USING(slot_id,school_id) WHERE b.school_id=$1 AND booking_id=$2 FOR UPDATE OF b,sl',
            [s.schoolId, b.bookingId],
          )
        ).rows[0];
        if (!r) throw problem('mentor_booking_missing', 404);
        return r;
      };
      const auth = async (c) => {
        const r = await get(c);
        if (b.action === 'cancel') {
          if (![r.student_id, r.mentor_id].includes(actor))
            await scope(db, s.schoolId, actor, null, 'moderate', c);
        } else if (actor !== r.mentor_id) throw problem('mentor_required', 403);
      };
      result = await write(
        b,
        async (c) => {
          const old = await get(c);
          if (old.revision !== b.expectedRevision) throw problem('revision_conflict', 409);
          if (
            !['requested', 'confirmed'].includes(old.status) ||
            (b.action === 'confirm' && old.status !== 'requested') ||
            (b.action === 'complete' && (old.status !== 'confirmed' || old.ends_at > new Date()))
          )
            throw problem('mentor_transition_invalid', 409);
          if (['confirm', 'complete'].includes(b.action)) {
            await approved(c, s.schoolId, old.mentor_id);
            await scope(db, s.schoolId, old.student_id, null, 'read', c);
            if (old.slot_status !== 'open') throw problem('mentor_slot_unavailable', 409);
          }
          const status = {
            confirm: 'confirmed',
            decline: 'declined',
            cancel: 'canceled',
            complete: 'completed',
          }[b.action];
          const r = (
            await c.query(
              'UPDATE hd_mentor_bookings SET status=$2,revision=revision+1,reason=$3,updated_at=now() WHERE booking_id=$1 RETURNING *',
              [old.booking_id, status, b.reason],
            )
          ).rows[0];
          for (const u of [old.student_id, old.mentor_id].filter((u) => u !== actor))
            await notify(c, s.schoolId, u, r.booking_id, r.revision, status);
          await audit(c, s.schoolId, actor, 'mentor.' + b.action, r.booking_id, {
            revision: r.revision,
            reason: b.reason,
          });
          return bookingPublic(r);
        },
        auth,
      );
    } else if (action === 'opportunity') {
      const b = fields(
        await body(req),
        [
          'requestId',
          'sourceId',
          'orgId',
          'expectedRevision',
          'kind',
          'organization',
          'audience',
          'deadline',
          'applicationUrl',
          'anchor',
        ],
        'opportunity',
      );
      if (!validId(b.sourceId) || (b.orgId && !validId(b.orgId)) || !kinds.includes(b.kind))
        throw problem('opportunity_invalid');
      version(b.expectedRevision);
      const deadline = time(b.deadline),
        organization = text(b.organization, 2, 160),
        audience = text(b.audience, 2, 300),
        applicationUrl = safeWorkLink(b.applicationUrl || ''),
        anchor = publicAnchor(getWorld(), s, b.anchor);
      if (deadline <= new Date()) throw problem('opportunity_deadline_invalid');
      const auth = async (c) => {
        const native = await source(c, s, actor, {
          org_id: b.orgId || null,
          source_id: b.sourceId,
        });
        if (!native.own) await scope(db, s.schoolId, actor, b.orgId || null, 'moderate', c);
      };
      result = await write(
        b,
        async (c) => {
          const old = (
            await c.query(
              'SELECT * FROM hd_career_opportunities WHERE school_id=$1 AND source_id=$2 FOR UPDATE',
              [s.schoolId, b.sourceId],
            )
          ).rows[0];
          if ((old?.revision || 0) !== b.expectedRevision) throw problem('revision_conflict', 409);
          if (old && (old.org_id || null) !== (b.orgId || null))
            throw problem('opportunity_scope_immutable', 409);
          const r = (
            await c.query(
              `INSERT INTO hd_career_opportunities(opportunity_id,school_id,source_id,org_id,author_id,revision,status,kind,organization,audience,deadline,application_url,anchor)
          VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11,$12) ON CONFLICT(school_id,source_id) DO UPDATE SET revision=EXCLUDED.revision,status='pending',approved_source_revision=NULL,kind=EXCLUDED.kind,organization=EXCLUDED.organization,audience=EXCLUDED.audience,deadline=EXCLUDED.deadline,application_url=EXCLUDED.application_url,anchor=EXCLUDED.anchor,updated_at=now() RETURNING *`,
              [
                old?.opportunity_id || randomUUID(),
                s.schoolId,
                b.sourceId,
                b.orgId || null,
                actor,
                b.expectedRevision + 1,
                b.kind,
                organization,
                audience,
                deadline,
                applicationUrl,
                anchor,
              ],
            )
          ).rows[0];
          await audit(c, s.schoolId, actor, 'opportunity.metadata', r.opportunity_id, {
            sourceId: r.source_id,
            revision: r.revision,
          });
          return r;
        },
        auth,
      );
    } else if (['opportunity-withdraw', 'opportunity-approve', 'bookmark'].includes(action)) {
      const b = fields(
        await body(req),
        action === 'bookmark'
          ? ['requestId', 'opportunityId', 'active']
          : ['requestId', 'opportunityId', 'expectedRevision', 'reason'],
        'opportunity_action',
      );
      id(b.opportunityId);
      const get = async (c) => {
        const r = (
          await c.query(
            'SELECT * FROM hd_career_opportunities WHERE school_id=$1 AND opportunity_id=$2 FOR UPDATE',
            [s.schoolId, b.opportunityId],
          )
        ).rows[0];
        if (!r) throw problem('opportunity_missing', 404);
        return r;
      };
      const auth = async (c) => {
        const r = await get(c);
        if (action === 'bookmark' && b.active) await source(c, s, actor, r, { published: true });
        else if (action === 'opportunity-approve')
          await source(c, s, actor, r, { manage: true, published: true });
        else if (action !== 'bookmark') {
          await source(c, s, actor, r);
          if (r.author_id !== actor) await scope(db, s.schoolId, actor, r.org_id, 'moderate', c);
        }
      };
      result = await write(
        b,
        async (c) => {
          const r = await get(c);
          if (action === 'bookmark') {
            if (typeof b.active !== 'boolean') throw problem('opportunity_invalid');
            if (b.active) {
              const native = await source(c, s, actor, r, { published: true });
              if (
                r.status !== 'active' ||
                r.deadline <= new Date() ||
                native.revision !== r.approved_source_revision
              )
                throw problem('opportunity_expired', 409);
              await c.query(
                'INSERT INTO hd_career_bookmarks(school_id,user_id,opportunity_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
                [s.schoolId, actor, r.opportunity_id],
              );
            } else
              await c.query(
                'DELETE FROM hd_career_bookmarks WHERE school_id=$1 AND user_id=$2 AND opportunity_id=$3',
                [s.schoolId, actor, r.opportunity_id],
              );
            return { opportunityId: r.opportunity_id, active: b.active };
          }
          version(b.expectedRevision);
          text(b.reason, 3, 1000);
          if (r.revision !== b.expectedRevision) throw problem('revision_conflict', 409);
          if (action === 'opportunity-approve') {
            const native = await source(c, s, actor, r, { manage: true, published: true });
            if (r.deadline <= new Date()) throw problem('opportunity_expired', 409);
            publicAnchor(getWorld(), s, r.anchor);
            const item = (
              await c.query(
                "UPDATE hd_career_opportunities SET status='active',approved_source_revision=$2,revision=revision+1,updated_at=now() WHERE opportunity_id=$1 RETURNING *",
                [r.opportunity_id, native.revision],
              )
            ).rows[0];
            await audit(c, s.schoolId, actor, 'opportunity.approve', r.opportunity_id, {
              revision: item.revision,
              sourceRevision: native.revision,
              reason: b.reason,
            });
            return item;
          }
          await c.query(
            "UPDATE hd_career_opportunities SET status='withdrawn',revision=revision+1,updated_at=now() WHERE opportunity_id=$1",
            [r.opportunity_id],
          );
          await audit(c, s.schoolId, actor, 'opportunity.withdraw', r.opportunity_id, {
            reason: b.reason,
            revision: r.revision + 1,
          });
          return { opportunityId: r.opportunity_id, status: 'withdrawn', revision: r.revision + 1 };
        },
        auth,
      );
    } else throw problem('network_route_missing', 404);
    json(res, 200, result);
    return true;
  };
}
