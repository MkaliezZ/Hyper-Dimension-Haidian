import { randomUUID } from 'node:crypto';
import { problem, hash } from './db.mjs';
import { fields, canonical } from '../protocol/index.mjs';
import { scope, audit, validId } from './permissions.mjs';
import { authorizeOwnedBusinessNotification } from './business-notifications.mjs';

export const topics = ['announcements', 'community', 'activities', 'partners'];
const rev = (v) => {
  if (!Number.isSafeInteger(v) || v < 0) throw problem('revision_required');
  return v;
};
const cursor = (v) => {
  if (!/^\d{1,18}$/.test(v)) throw problem('cursor_invalid');
  return v;
};
const key = (v) => {
  if (!validId(v)) throw problem('source_id_invalid');
  return v;
};
const permissionLock = (c, s) =>
  c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [s + ':permissions']);

// Called only by trusted server business code within its committing transaction.
// A title is public within its explicit school/org scope; private source text is never copied.
export async function publishInformation(c, e) {
  fields(
    e,
    [
      'schoolId',
      'eventId',
      'scopeId',
      'topic',
      'sourceId',
      'sourceRevision',
      'status',
      'title',
      'expiresAt',
      'actorId',
    ],
    'information',
  );
  key(e.schoolId);
  key(e.eventId);
  key(e.sourceId);
  if (
    !topics.includes(e.topic) ||
    !['published', 'withdrawn'].includes(e.status) ||
    rev(e.sourceRevision) < 1 ||
    (e.scopeId && !validId(e.scopeId)) ||
    typeof e.title !== 'string' ||
    e.title.length > 160 ||
    (e.status === 'published' && !e.title.trim())
  )
    throw problem('information_invalid');
  if (e.expiresAt && !Number.isFinite(Date.parse(e.expiresAt))) throw problem('expiration_invalid');
  const envelope = {
    ...e,
    scopeId: e.scopeId || '',
    expiresAt: e.expiresAt ? new Date(e.expiresAt).toISOString() : null,
  };
  const fingerprint = hash(canonical(envelope));
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    e.schoolId + ':information',
  ]);
  const old = (
    await c.query(
      'SELECT fingerprint FROM hd_information_events WHERE school_id=$1 AND event_id=$2',
      [e.schoolId, e.eventId],
    )
  ).rows[0];
  if (old) {
    if (old.fingerprint !== fingerprint) throw problem('event_conflict', 409);
    return { duplicate: true, eventId: e.eventId };
  }
  const head = (
    await c.query(
      'SELECT * FROM hd_information_heads WHERE school_id=$1 AND topic=$2 AND source_id=$3',
      [e.schoolId, e.topic, e.sourceId],
    )
  ).rows[0];
  if (
    e.sourceRevision !== (head?.revision || 0) + 1 ||
    (head && head.scope_id !== envelope.scopeId)
  )
    throw problem('source_revision_conflict', 409);
  await c.query(
    'INSERT INTO hd_information_events(school_id,event_id,scope_id,topic,source_id,source_revision,envelope,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      e.schoolId,
      e.eventId,
      envelope.scopeId,
      e.topic,
      e.sourceId,
      e.sourceRevision,
      envelope,
      fingerprint,
    ],
  );
  await c.query(
    `INSERT INTO hd_information_heads(school_id,topic,source_id,scope_id,revision,status,title,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(school_id,topic,source_id) DO UPDATE SET revision=EXCLUDED.revision,status=EXCLUDED.status,title=EXCLUDED.title,expires_at=EXCLUDED.expires_at,updated_at=now()`,
    [
      e.schoolId,
      e.topic,
      e.sourceId,
      envelope.scopeId,
      e.sourceRevision,
      e.status,
      e.status === 'published' ? e.title.trim() : '',
      envelope.expiresAt,
    ],
  );
  let delivered = 0;
  if (e.status === 'published') {
    const result = await c.query(
      `INSERT INTO hd_notifications(school_id,user_id,event_id,payload,information_event,scope_id)
      SELECT s.school_id,s.user_id,$2,$6,$3,s.scope_id FROM hd_subscriptions s
      JOIN hd_memberships m ON m.school_id=s.school_id AND m.user_id=s.user_id AND m.active
      JOIN hd_users u ON u.user_id=s.user_id AND u.enabled
      LEFT JOIN hd_notification_preferences p ON p.school_id=s.school_id AND p.user_id=s.user_id
      WHERE s.school_id=$1 AND s.topic=$4 AND s.scope_id=$5 AND s.active AND coalesce(p.enabled,true)
      AND ($7::timestamptz IS NULL OR $7::timestamptz>now())
      AND ((s.scope_id='' AND m.role NOT IN ('partner','affiliate')) OR
        (s.scope_id<>'' AND EXISTS(SELECT 1 FROM hd_organizations o WHERE o.school_id=s.school_id AND o.org_id=s.scope_id AND o.active)
          AND (m.role='owner' OR EXISTS(SELECT 1 FROM hd_org_members g WHERE g.school_id=s.school_id AND g.org_id=s.scope_id AND g.user_id=s.user_id AND g.active))))
      ON CONFLICT(school_id,user_id,event_id) DO NOTHING`,
      [
        e.schoolId,
        'information:' + e.eventId,
        e.eventId,
        e.topic,
        envelope.scopeId,
        { kind: 'information', topic: e.topic, sourceId: e.sourceId, revision: e.sourceRevision },
        envelope.expiresAt,
      ],
    );
    delivered = result.rowCount;
  }
  return { duplicate: false, eventId: e.eventId, delivered };
}

async function canReadNotification(db, school, user, n, c) {
  if (['partner-business', 'partner-withdrawal'].includes(n.payload?.type))
    return authorizeOwnedBusinessNotification(db, school, user, n, c);
  try {
    await scope(db, school, user, n.scope_id || n.payload?.organizationId || null, 'read', c);
  } catch (e) {
    if (e.status === 403) return false;
    throw e;
  }
  if (n.payload?.type === 'activity-reminder') {
    const a = (
      await c.query(
        `SELECT a.title,a.starts_at FROM hd_activity_reminders d
      JOIN hd_activities a ON a.school_id=d.school_id AND a.activity_id=d.activity_id
      JOIN hd_activity_registrations r ON r.school_id=d.school_id AND r.registration_id=d.registration_id
      WHERE d.school_id=$1 AND d.user_id=$2 AND d.event_id=$3 AND d.status='delivered'
      AND a.activity_id::text=$4 AND coalesce(a.org_id,'')=$5 AND a.status='published' AND a.ends_at>now()
      AND r.user_id=$2 AND r.status IN ('registered','verified')`,
        [school, user, n.event_id, n.payload.activityId, n.scope_id || ''],
      )
    ).rows[0];
    if (!a) return false;
    n.payload = { ...n.payload, title: a.title, startsAt: a.starts_at };
  }
  return (
    !n.information_event ||
    (n.current_status === 'published' && (!n.expires_at || n.expires_at > new Date()))
  );
}
const notificationQuery = `SELECT n.*,e.topic,e.source_id,h.status AS current_status,h.title,h.expires_at,h.revision AS current_revision
    FROM hd_notifications n
    LEFT JOIN hd_information_events e ON e.school_id=n.school_id AND e.event_id=n.information_event
    LEFT JOIN hd_information_heads h ON h.school_id=e.school_id AND h.topic=e.topic AND h.source_id=e.source_id`;

export async function markNotificationRead(db, school, user, id) {
  cursor(String(id));
  return db.tx(async (c) => {
    await permissionLock(c, school);
    await db.member(school, user, null, c);
    const n = (
      await c.query(notificationQuery + ' WHERE n.school_id=$1 AND n.user_id=$2 AND n.id=$3', [
        school,
        user,
        id,
      ])
    ).rows[0];
    if (!n) throw problem('notification_missing', 404);
    if (!(await canReadNotification(db, school, user, n, c)))
      throw problem('notification_denied', 403);
    await c.query(
      'UPDATE hd_notifications SET read_at=coalesce(read_at,now()) WHERE school_id=$1 AND user_id=$2 AND id=$3',
      [school, user, id],
    );
    return { read: true };
  });
}

export async function visibleNotifications(
  db,
  school,
  user,
  after = '0',
  c = db.pool,
  { latest = false } = {},
) {
  await db.member(school, user, null, c);
  cursor(String(after));
  // Scan owned IDs before filtering so a page of revoked records cannot stall a cursor.
  const { rows } = await c.query(
    notificationQuery +
      (latest
        ? ' WHERE n.school_id=$1 AND n.user_id=$2 AND ($3::bigint=0 OR n.id<$3) ORDER BY n.id DESC LIMIT 50'
        : ' WHERE n.school_id=$1 AND n.user_id=$2 AND n.id>$3 ORDER BY n.id LIMIT 100'),
    [school, user, after],
  );
  const items = [];
  for (const n of rows) {
    if (!(await canReadNotification(db, school, user, n, c))) continue;
    items.push({
      id: n.id,
      school_id: n.school_id,
      user_id: n.user_id,
      event_id: n.event_id,
      payload: n.information_event
        ? { ...n.payload, title: n.title, revision: n.current_revision }
        : n.payload,
      read_at: n.read_at,
      created_at: n.created_at,
    });
  }
  return {
    items,
    cursor: rows.at(-1)?.id || String(after),
    ...(latest ? { hasMore: rows.length === 50 } : {}),
  };
}

export function createInformation(db, identity, services) {
  return async (req, res, { url, json, body }) => {
    const p = url.pathname.split('/').filter(Boolean);
    if (p[0] !== 'information') return false;
    if (!['GET', 'POST'].includes(req.method)) throw problem('method_denied', 405);
    const u = await identity.user(req);
    if (p[1] !== 'schools' || !p[2]) throw problem('route_missing', 404);
    const school = services.school(p[2]).schoolId;
    await db.member(school, u.user_id);
    if (url.searchParams.has('userId') && url.searchParams.get('userId') !== u.user_id)
      throw problem('other_user_denied', 403);
    const action = p[3];
    if (p.length !== 4) throw problem('route_missing', 404);
    if (action === 'inbox' && req.method === 'GET') {
      const latest = url.searchParams.get('latest') === 'true';
      json(
        res,
        200,
        await visibleNotifications(
          db,
          school,
          u.user_id,
          url.searchParams.get(latest ? 'before' : 'after') || '0',
          db.pool,
          { latest },
        ),
      );
      return true;
    }
    if (action === 'subscriptions' && req.method === 'GET') {
      const rows = (
        await db.pool.query(
          'SELECT * FROM hd_subscriptions WHERE school_id=$1 AND user_id=$2 ORDER BY scope_id,topic',
          [school, u.user_id],
        )
      ).rows;
      const items = [];
      for (const s of rows) {
        try {
          await scope(db, school, u.user_id, s.scope_id || null);
          items.push(s);
        } catch (e) {
          if (e.status !== 403) throw e;
        }
      }
      json(res, 200, { items, topics });
      return true;
    }
    if (action === 'preferences' && req.method === 'GET') {
      json(
        res,
        200,
        (
          await db.pool.query(
            'SELECT enabled,revision FROM hd_notification_preferences WHERE school_id=$1 AND user_id=$2',
            [school, u.user_id],
          )
        ).rows[0] || { enabled: true, revision: 0 },
      );
      return true;
    }
    if (action === 'announcements' && req.method === 'GET') {
      const org = url.searchParams.get('org') || '';
      await scope(db, school, u.user_id, org || null);
      const items = (
        await db.pool.query(
          "SELECT source_id,title,revision,expires_at FROM hd_information_heads WHERE school_id=$1 AND scope_id=$2 AND topic='announcements' AND status='published' AND (expires_at IS NULL OR expires_at>now()) ORDER BY updated_at DESC LIMIT 100",
          [school, org],
        )
      ).rows;
      let canPublish = false;
      try {
        await scope(db, school, u.user_id, org || null, 'manage');
        canPublish = true;
      } catch (e) {
        if (e.status !== 403) throw e;
      }
      json(res, 200, { items, canPublish });
      return true;
    }
    if (req.method !== 'POST') throw problem('route_missing', 404);
    const b = await body(req);
    if (action === 'subscriptions') {
      fields(b, ['requestId', 'expectedRevision', 'scopeId', 'topic', 'active'], 'subscription');
      if (
        !topics.includes(b.topic) ||
        typeof b.active !== 'boolean' ||
        (b.scopeId && !validId(b.scopeId))
      )
        throw problem('subscription_invalid');
      rev(b.expectedRevision);
      const org = b.scopeId || '';
      await scope(db, school, u.user_id, org || null);
      const result = await db.receipt(
        school,
        u.user_id,
        b.requestId,
        canonical({ operation: 'subscription', ...b }),
        async (c) => {
          await permissionLock(c, school);
          await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            school + ':information',
          ]);
          await scope(db, school, u.user_id, org || null, 'read', c);
          const old = (
            await c.query(
              'SELECT revision FROM hd_subscriptions WHERE school_id=$1 AND user_id=$2 AND scope_id=$3 AND topic=$4',
              [school, u.user_id, org, b.topic],
            )
          ).rows[0];
          if ((old?.revision || 0) !== b.expectedRevision) throw problem('revision_conflict', 409);
          return (
            await c.query(
              `INSERT INTO hd_subscriptions(school_id,user_id,scope_id,topic,active) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(school_id,user_id,scope_id,topic) DO UPDATE SET active=EXCLUDED.active,revision=hd_subscriptions.revision+1,updated_at=now() RETURNING *`,
              [school, u.user_id, org, b.topic, b.active],
            )
          ).rows[0];
        },
      );
      json(res, 200, result);
      return true;
    }
    if (action === 'preferences') {
      fields(b, ['requestId', 'expectedRevision', 'enabled'], 'preference');
      rev(b.expectedRevision);
      if (typeof b.enabled !== 'boolean') throw problem('preference_invalid');
      const result = await db.receipt(
        school,
        u.user_id,
        b.requestId,
        canonical({ operation: 'notification.preference', ...b }),
        async (c) => {
          await permissionLock(c, school);
          await db.member(school, u.user_id, null, c);
          await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            school + ':information',
          ]);
          const old = (
            await c.query(
              'SELECT revision FROM hd_notification_preferences WHERE school_id=$1 AND user_id=$2',
              [school, u.user_id],
            )
          ).rows[0];
          if ((old?.revision || 0) !== b.expectedRevision) throw problem('revision_conflict', 409);
          return (
            await c.query(
              `INSERT INTO hd_notification_preferences(school_id,user_id,enabled) VALUES($1,$2,$3)
          ON CONFLICT(school_id,user_id) DO UPDATE SET enabled=EXCLUDED.enabled,revision=hd_notification_preferences.revision+1 RETURNING enabled,revision`,
              [school, u.user_id, b.enabled],
            )
          ).rows[0];
        },
      );
      json(res, 200, result);
      return true;
    }
    if (action === 'read') {
      fields(b, ['id'], 'read');
      cursor(String(b.id));
      json(res, 200, await markNotificationRead(db, school, u.user_id, b.id));
      return true;
    }
    if (action === 'announcements') {
      fields(
        b,
        ['requestId', 'sourceId', 'expectedRevision', 'scopeId', 'title', 'status', 'expiresAt'],
        'announcement',
      );
      rev(b.expectedRevision);
      const org = b.scopeId || '';
      key(b.sourceId);
      await scope(db, school, u.user_id, org || null, 'manage');
      const result = await db.receipt(
        school,
        u.user_id,
        b.requestId,
        canonical({ operation: 'announcement', ...b }),
        async (c) => {
          await permissionLock(c, school);
          await scope(db, school, u.user_id, org || null, 'manage', c);
          const eventId = randomUUID();
          const result = await publishInformation(c, {
            schoolId: school,
            eventId,
            scopeId: org,
            topic: 'announcements',
            sourceId: b.sourceId,
            sourceRevision: b.expectedRevision + 1,
            status: b.status,
            title: b.title,
            expiresAt: b.expiresAt || null,
            actorId: u.user_id,
          });
          await audit(c, school, u.user_id, 'announcement.' + b.status, b.sourceId, {
            eventId,
            revision: b.expectedRevision + 1,
            scopeId: org,
          });
          return { ...result, sourceId: b.sourceId, revision: b.expectedRevision + 1 };
        },
      );
      json(res, 200, result);
      return true;
    }
    if (action === 'expire') {
      fields(b, ['requestId'], 'expiration');
      await scope(db, school, u.user_id, null, 'manage');
      const result = await db.receipt(
        school,
        u.user_id,
        b.requestId,
        canonical({ operation: 'information.expire', ...b }),
        async (c) => {
          await permissionLock(c, school);
          await scope(db, school, u.user_id, null, 'manage', c);
          await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            school + ':information',
          ]);
          const expired = await c.query(
            "UPDATE hd_information_heads SET status='expired',title='',updated_at=now() WHERE school_id=$1 AND expires_at<=now() AND status='published' RETURNING source_id,topic",
            [school],
          );
          // Keep source IDs and minimal audit, remove expired title from historic delivery envelopes as well.
          await c.query(
            `UPDATE hd_information_events e SET envelope=e.envelope-'title' WHERE e.school_id=$1 AND EXISTS
          (SELECT 1 FROM hd_information_heads h WHERE h.school_id=e.school_id AND h.topic=e.topic AND h.source_id=e.source_id AND h.status='expired')`,
            [school],
          );
          await audit(c, school, u.user_id, 'information.expire', school, {
            count: expired.rowCount,
          });
          return { expired: expired.rowCount };
        },
      );
      json(res, 200, result);
      return true;
    }
    throw problem('route_missing', 404);
  };
}
