import { randomUUID } from 'node:crypto';
import { hash, problem } from './db.mjs';
import { audit, scope, validId } from './permissions.mjs';
import { canonical, fields } from '../protocol/index.mjs';
import { publishInformation } from './information.mjs';
import { requireActivityReward } from './rewards.mjs';
import { publicPlace } from './world-places.mjs';

const uuid = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const text = (v, min, max) => {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max)
    throw problem('text_invalid');
  return v.trim();
};
const date = (v) => {
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw problem('date_invalid');
  return new Date(v).toISOString();
};
const view = (r) =>
  r
    ? Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]),
      )
    : null;
const compare = (r, v) => {
  if (!Number.isSafeInteger(v) || v < 1) throw problem('expected_revision_required');
  if (r.revision !== v) throw problem('revision_conflict', 409);
};
const activityFields = [
  'kind',
  'orgId',
  'title',
  'description',
  'conditions',
  'tasks',
  'sceneId',
  'entityId',
  'startsAt',
  'endsAt',
  'registrationClosesAt',
  'capacity',
  'remindBeforeMinutes',
  'verifierIds',
];

export function createActivities(
  db,
  identity,
  services,
  config,
  { getWorld = () => null, recordContribution, scheduleReminder, validateAttachment } = {},
) {
  const row = async (c, school, id, registration = false, lock = false) => {
    if (!uuid(id)) throw problem('object_id_invalid');
    const r = (
      await c.query(
        `SELECT * FROM ${registration ? 'hd_activity_registrations' : 'hd_activities'} WHERE school_id=$1 AND ${registration ? 'registration_id' : 'activity_id'}=$2${lock ? ' FOR UPDATE' : ''}`,
        [school, id],
      )
    ).rows[0];
    if (!r) throw problem('activity_object_missing', 404);
    return r;
  };
  const activityScope = (c, school, user, a, action = 'read') =>
    scope(db, school, user, a.org_id, action, c);
  async function manager(c, school, user, id) {
    const a = await row(c, school, id);
    await activityScope(c, school, user, a, 'manage');
    return a;
  }
  async function verifier(c, school, user, a) {
    await activityScope(c, school, user, a);
    if (!a.verifier_ids.includes(user)) throw problem('designated_verifier_required', 403);
  }
  async function ownRegistration(c, school, user, id) {
    const r = await row(c, school, id, true),
      a = await row(c, school, r.activity_id);
    await activityScope(c, school, user, a);
    if (r.user_id !== user) throw problem('own_registration_required', 403);
    return { r, a };
  }
  async function lock(c, school, id) {
    for (const key of [
      school + ':permissions',
      school + ':information',
      school + ':activities:' + id,
    ])
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  }
  async function mutate(school, user, route, input, id, acl, fn) {
    if (!validId(input.requestId)) throw problem('request_id_required');
    const fingerprint = hash(canonical({ route, input }));
    await acl(db.pool);
    return db.tx(async (c) => {
      await lock(c, school, id || 'create');
      await acl(c);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        school + ':' + user + ':' + input.requestId,
      ]);
      const old = (
        await c.query(
          'SELECT * FROM hd_receipts WHERE school_id=$1 AND user_id=$2 AND request_id=$3',
          [school, user, input.requestId],
        )
      ).rows[0];
      if (old) {
        if (old.input_hash !== fingerprint) throw problem('request_conflict', 409);
        return old.result;
      }
      const result = await fn(c);
      await c.query('INSERT INTO hd_receipts VALUES($1,$2,$3,$4,$5)', [
        school,
        user,
        input.requestId,
        fingerprint,
        result,
      ]);
      return result;
    });
  }
  const notify = async (c, school, user, eventId, payload, orgId = null) => {
    await c.query(
      'INSERT INTO hd_notifications(school_id,user_id,event_id,payload,scope_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [school, user, eventId, payload, orgId || ''],
    );
  };
  async function event(c, school, actor, a, object, revision, kind, detail = {}, recipient = null) {
    const eventId = `${school}:base-activities:${object}:${revision}`;
    const envelope = {
      schema: 'hyper-dimension.event/v1',
      eventId,
      schoolId: school,
      orgId: a.org_id || null,
      activityId: a.activity_id,
      registrationId: detail.registrationId || null,
      userId: recipient,
      actorId: actor,
      kind,
      source: { kind: 'base-activities', id: object, revision },
      sourceRevision: revision,
      occurredAt: new Date().toISOString(),
      reversesEventId: detail.reversesEventId || null,
      visibility: 'business-scoped',
      detail,
    };
    const contributes = [
      'activity_verified',
      'volunteer_verified',
      'participation_revoked',
    ].includes(kind);
    await c.query(
      `INSERT INTO hd_activity_events(event_id,school_id,activity_id,registration_id,object_id,source_revision,kind,actor_id,user_id,envelope,contribution_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        eventId,
        school,
        a.activity_id,
        envelope.registrationId,
        object,
        revision,
        kind,
        actor,
        recipient,
        envelope,
        contributes ? (recordContribution ? 'applied' : 'unconfigured') : 'not-applicable',
      ],
    );
    if (contributes && recordContribution) await recordContribution(c, envelope);
    await audit(c, school, actor, 'activities.' + kind, object, {
      revision,
      activityId: a.activity_id,
      ...detail,
      ...(!actor ? { actorKind: 'system' } : {}),
    });
    if (recipient)
      await notify(
        c,
        school,
        recipient,
        eventId,
        {
          type: 'activity',
          activityId: a.activity_id,
          registrationId: envelope.registrationId,
          status: detail.status || kind,
        },
        a.org_id,
      );
    return eventId;
  }
  async function publication(c, school, a, actor) {
    const sourceId = 'activity:' + a.activity_id;
    const old = (
      await c.query(
        "SELECT revision FROM hd_information_heads WHERE school_id=$1 AND topic='activities' AND source_id=$2",
        [school, sourceId],
      )
    ).rows[0];
    if (!old && a.status !== 'published') return;
    await publishInformation(c, {
      schoolId: school,
      eventId: 'activity-info:' + hash([school, sourceId, a.revision]),
      scopeId: a.org_id || '',
      topic: 'activities',
      sourceId,
      sourceRevision: (old?.revision || 0) + 1,
      status: a.status === 'published' ? 'published' : 'withdrawn',
      title: a.status === 'published' ? a.title : '',
      expiresAt: a.ends_at.toISOString?.() || a.ends_at,
      actorId: actor,
    });
  }
  async function prepareReminder(c, school, a, r) {
    const reminderId = randomUUID(),
      eventId = `activity-reminder:${r.registration_id}:${r.revision}`;
    const dueAt = new Date(
      new Date(a.starts_at).getTime() - a.remind_before_minutes * 60000,
    ).toISOString();
    await c.query(
      "UPDATE hd_activity_reminders SET status='cancelled' WHERE school_id=$1 AND registration_id=$2 AND status='scheduled'",
      [school, r.registration_id],
    );
    await c.query(
      `INSERT INTO hd_activity_reminders(school_id,reminder_id,registration_id,activity_id,user_id,due_at,status,event_id) VALUES($1,$2,$3,$4,$5,$6,'scheduled',$7)`,
      [school, reminderId, r.registration_id, a.activity_id, r.user_id, dueAt, eventId],
    );
    if (scheduleReminder) await scheduleReminder(c, { schoolId: school, reminderId, dueAt });
  }
  async function validateInput(c, school, user, b, old = null) {
    if (
      !['event', 'volunteer'].includes(b.kind) ||
      !Number.isSafeInteger(b.capacity) ||
      b.capacity < 1 ||
      b.capacity > 100000 ||
      !Number.isSafeInteger(b.remindBeforeMinutes) ||
      b.remindBeforeMinutes < 0 ||
      b.remindBeforeMinutes > 10080
    )
      throw problem('activity_invalid');
    const org = b.orgId || null;
    if (org && !validId(org)) throw problem('organization_invalid');
    if (old && old.org_id !== org) throw problem('activity_scope_immutable', 409);
    await scope(db, school, user, org, 'manage', c);
    const startsAt = date(b.startsAt),
      endsAt = date(b.endsAt),
      closes = date(b.registrationClosesAt);
    if (endsAt <= startsAt || closes > endsAt || new Date(endsAt) <= new Date())
      throw problem('activity_time_invalid');
    if (
      !Array.isArray(b.verifierIds) ||
      !b.verifierIds.length ||
      b.verifierIds.length > 20 ||
      new Set(b.verifierIds).size !== b.verifierIds.length ||
      !b.verifierIds.every(uuid)
    )
      throw problem('verifiers_invalid');
    for (const id of b.verifierIds) await scope(db, school, id, org, 'read', c);
    const tasks = b.tasks || [];
    if (!Array.isArray(tasks) || tasks.length > 30 || (b.kind === 'volunteer' && !tasks.length))
      throw problem('volunteer_tasks_required');
    const ids = new Set();
    for (const t of tasks) {
      fields(t, ['id', 'title', 'description'], 'task');
      if (!validId(t.id) || ids.has(t.id)) throw problem('task_id_invalid');
      ids.add(t.id);
      text(t.title, 2, 100);
      text(t.description, 2, 1000);
    }
    const scene = b.sceneId || null,
      entity = b.entityId || null;
    if (scene || entity) {
      let valid = false;
      try {
        valid = Boolean(publicPlace(getWorld(), services.school(school).spaceId, scene, entity));
      } catch {}
      if (!valid) throw problem('activity_location_invalid');
    }
    return {
      kind: b.kind,
      org,
      title: text(b.title, 2, 160),
      description: text(b.description, 5, 5000),
      conditions: text(b.conditions, 2, 2000),
      tasks,
      scene,
      entity,
      startsAt,
      endsAt,
      closes,
      capacity: b.capacity,
      remind: b.remindBeforeMinutes,
      verifiers: b.verifierIds,
    };
  }
  async function promote(c, school, a) {
    if (
      a.status !== 'published' ||
      a.registration_closes_at <= new Date() ||
      a.ends_at <= new Date()
    )
      return;
    const count = Number(
      (
        await c.query(
          "SELECT count(*) FROM hd_activity_registrations WHERE school_id=$1 AND activity_id=$2 AND status IN ('registered','verified')",
          [school, a.activity_id],
        )
      ).rows[0].count,
    );
    const waiting = (
      await c.query(
        "SELECT * FROM hd_activity_registrations WHERE school_id=$1 AND activity_id=$2 AND status='waitlisted' ORDER BY queue_position FOR UPDATE",
        [school, a.activity_id],
      )
    ).rows;
    let seats = a.capacity - count;
    for (const r of waiting) {
      if (seats <= 0) break;
      try {
        await activityScope(c, school, r.user_id, a);
      } catch (e) {
        if (e.status !== 403) throw e;
        await c.query(
          "UPDATE hd_activity_registrations SET status='cancelled',revision=revision+1,updated_at=now() WHERE school_id=$1 AND registration_id=$2",
          [school, r.registration_id],
        );
        await event(
          c,
          school,
          null,
          a,
          r.registration_id,
          r.revision + 1,
          'registration_ineligible',
          { registrationId: r.registration_id, status: 'cancelled' },
          r.user_id,
        );
        continue;
      }
      const next = (
        await c.query(
          "UPDATE hd_activity_registrations SET status='registered',revision=revision+1,updated_at=now() WHERE school_id=$1 AND registration_id=$2 RETURNING *",
          [school, r.registration_id],
        )
      ).rows[0];
      await event(
        c,
        school,
        null,
        a,
        r.registration_id,
        next.revision,
        'registration_promoted',
        { registrationId: r.registration_id, status: 'registered' },
        r.user_id,
      );
      await prepareReminder(c, school, a, next);
      seats--;
    }
  }
  async function revoke(c, school, actor, a, r, reason) {
    if (r.status !== 'verified' || !r.verification_event_id)
      throw problem('verified_record_required', 409);
    const next = (
      await c.query(
        "UPDATE hd_activity_registrations SET status='revoked',revision=revision+1,revoke_reason=$3,updated_at=now() WHERE school_id=$1 AND registration_id=$2 RETURNING *",
        [school, r.registration_id, reason],
      )
    ).rows[0];
    await event(
      c,
      school,
      actor,
      a,
      r.registration_id,
      next.revision,
      'participation_revoked',
      {
        registrationId: r.registration_id,
        status: 'revoked',
        reversesEventId: r.verification_event_id,
        reason,
      },
      r.user_id,
    );
    return next;
  }
  async function registrationView(c, school, r, includeEvidence = false) {
    const result = view(r);
    if (includeEvidence)
      result.submissions = (
        await c.query(
          'SELECT * FROM hd_activity_submissions WHERE school_id=$1 AND registration_id=$2 ORDER BY created_at',
          [school, r.registration_id],
        )
      ).rows.map(view);
    return result;
  }
  async function canReadAttachment(c, { schoolId, userId, attachmentId, activityId }) {
    if (!uuid(attachmentId) || !uuid(activityId)) return false;
    try {
      const a = await row(c, schoolId, activityId);
      await activityScope(c, schoolId, userId, a);
      const refs = (
        await c.query(
          `SELECT r.user_id FROM hd_activity_submissions s JOIN hd_activity_registrations r USING(school_id,registration_id)
        WHERE s.school_id=$1 AND r.activity_id=$2 AND s.attachments @> $3::jsonb`,
          [schoolId, activityId, JSON.stringify([{ attachmentId }])],
        )
      ).rows;
      return refs.some((r) => r.user_id === userId || a.verifier_ids.includes(userId));
    } catch (e) {
      if ([403, 404].includes(e.status)) return false;
      throw e;
    }
  }
  async function reconcile(school) {
    services.school(school);
    const due = (
      await db.pool.query(
        "SELECT reminder_id,activity_id FROM hd_activity_reminders WHERE school_id=$1 AND status='scheduled' AND due_at<=now() ORDER BY due_at LIMIT 100",
        [school],
      )
    ).rows;
    let delivered = 0,
      cancelled = 0;
    for (const item of due)
      await db.tx(async (c) => {
        await lock(c, school, item.activity_id);
        const reminder = (
          await c.query(
            'SELECT * FROM hd_activity_reminders WHERE school_id=$1 AND reminder_id=$2 FOR UPDATE',
            [school, item.reminder_id],
          )
        ).rows[0];
        if (reminder.status !== 'scheduled' || reminder.due_at > new Date()) return;
        const a = await row(c, school, reminder.activity_id),
          r = await row(c, school, reminder.registration_id, true);
        let allowed =
          a.status === 'published' && a.ends_at > new Date() && r.status === 'registered';
        try {
          await activityScope(c, school, r.user_id, a);
        } catch (e) {
          if (e.status !== 403) throw e;
          allowed = false;
        }
        const preferences = (
          await c.query(
            'SELECT enabled FROM hd_notification_preferences WHERE school_id=$1 AND user_id=$2',
            [school, r.user_id],
          )
        ).rows[0];
        if (preferences?.enabled === false) allowed = false;
        if (allowed) {
          await notify(
            c,
            school,
            r.user_id,
            reminder.event_id,
            {
              type: 'activity-reminder',
              activityId: a.activity_id,
              title: a.title,
              startsAt: a.starts_at,
            },
            a.org_id,
          );
          delivered++;
        } else cancelled++;
        await c.query(
          "UPDATE hd_activity_reminders SET status=$3,delivered_at=CASE WHEN $3='delivered' THEN now() ELSE NULL END WHERE school_id=$1 AND reminder_id=$2",
          [school, reminder.reminder_id, allowed ? 'delivered' : 'cancelled'],
        );
      });
    return { delivered, cancelled, checked: due.length };
  }
  async function createDraft(c, { schoolId, userId, input }) {
    services.school(schoolId);
    fields(input, activityFields, 'activity');
    await lock(c, schoolId, 'create');
    const v = await validateInput(c, schoolId, userId, input),
      activityId = randomUUID();
    await c.query(
      `INSERT INTO hd_activities(school_id,activity_id,org_id,creator_id,kind,title,description,conditions,tasks,scene_id,entity_id,starts_at,ends_at,registration_closes_at,capacity,remind_before_minutes,verifier_ids,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'draft')`,
      [
        schoolId,
        activityId,
        v.org,
        userId,
        v.kind,
        v.title,
        v.description,
        v.conditions,
        JSON.stringify(v.tasks),
        v.scene,
        v.entity,
        v.startsAt,
        v.endsAt,
        v.closes,
        v.capacity,
        v.remind,
        v.verifiers,
      ],
    );
    const a = await row(c, schoolId, activityId);
    await event(c, schoolId, userId, a, activityId, a.revision, 'activity_created', {
      status: 'draft',
    });
    return view(a);
  }
  return {
    reconcile,
    canReadAttachment,
    createDraft,
    async handle(req, res, { url, json, body }) {
      const p = url.pathname.split('/').filter(Boolean);
      if (p[0] !== 'activities') return false;
      if (p[1] !== 'schools' || !p[2]) throw problem('route_missing', 404);
      const school = services.school(p[2]).schoolId,
        user = (await identity.user(req)).user_id;
      await db.member(school, user);
      if (url.searchParams.has('userId') && url.searchParams.get('userId') !== user)
        throw problem('other_user_denied', 403);
      const resource = p[3],
        id = p[4],
        action = p[5],
        send = (x) => {
          json(res, 200, x);
          return true;
        },
        route = url.pathname;
      if (p.length > 6) throw problem('route_missing', 404);
      if (req.method === 'GET' && resource === 'status')
        return send({
          enabled: true,
          contributionConnected: Boolean(recordContribution),
          scheduledQueueConnected: Boolean(scheduleReminder),
          attachmentValidationConnected: Boolean(validateAttachment),
        });
      if (req.method === 'GET' && resource === 'setup') {
        const org = url.searchParams.get('orgId') || null;
        await scope(db, school, user, org, 'manage');
        const candidates = (
          await db.pool.query(
            `SELECT m.user_id,u.display_name FROM hd_memberships m JOIN hd_users u USING(user_id) WHERE m.school_id=$1 AND m.active AND u.enabled AND m.role NOT IN ('partner','affiliate') AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM hd_org_members g WHERE g.school_id=m.school_id AND g.user_id=m.user_id AND g.org_id=$2 AND g.active)) ORDER BY u.display_name`,
            [school, org],
          )
        ).rows;
        return send({ candidates: candidates.map(view) });
      }
      if (resource === 'items') {
        if (req.method === 'GET' && !id) {
          const { rows } = await db.pool.query(
            'SELECT * FROM hd_activities WHERE school_id=$1 ORDER BY starts_at DESC LIMIT 200',
            [school],
          );
          const items = [];
          for (const a of rows) {
            try {
              await activityScope(db.pool, school, user, a);
              let manage = false;
              let review = false;
              try {
                await activityScope(db.pool, school, user, a, 'manage');
                manage = true;
              } catch (e) {
                if (e.status !== 403) throw e;
              }
              try {
                await activityScope(db.pool, school, user, a, 'moderate');
                review = true;
              } catch (e) {
                if (e.status !== 403) throw e;
              }
              if (a.status === 'published' || manage || review || a.verifier_ids.includes(user))
                items.push({
                  ...view(a),
                  canManage: manage,
                  canReview: review,
                  canVerify: a.verifier_ids.includes(user),
                });
            } catch (e) {
              if (e.status !== 403) throw e;
            }
          }
          return send({ items });
        }
        if (req.method === 'GET' && id && !action) {
          const a = await row(db.pool, school, id);
          await activityScope(db.pool, school, user, a);
          let manage = false;
          let review = false;
          try {
            await activityScope(db.pool, school, user, a, 'manage');
            manage = true;
          } catch (e) {
            if (e.status !== 403) throw e;
          }
          try {
            await activityScope(db.pool, school, user, a, 'moderate');
            review = true;
          } catch (e) {
            if (e.status !== 403) throw e;
          }
          const own = (
            await db.pool.query(
              'SELECT * FROM hd_activity_registrations WHERE school_id=$1 AND activity_id=$2 AND user_id=$3',
              [school, id, user],
            )
          ).rows[0];
          if (
            a.status !== 'published' &&
            !manage &&
            !review &&
            !a.verifier_ids.includes(user) &&
            !(a.status === 'cancelled' && own)
          )
            throw problem('draft_private', 403);
          const counts = (
            await db.pool.query(
              'SELECT status,count(*)::integer AS count FROM hd_activity_registrations WHERE school_id=$1 AND activity_id=$2 GROUP BY status',
              [school, id],
            )
          ).rows;
          return send({
            ...view(a),
            canManage: manage,
            canReview: review,
            canVerify: a.verifier_ids.includes(user),
            registration: own ? await registrationView(db.pool, school, own, true) : null,
            counts,
          });
        }
        if (req.method === 'POST' && (!id || action === 'edit')) {
          const b = fields(
            await body(req),
            ['requestId', 'expectedRevision', ...activityFields],
            'activity',
          );
          return send(
            await mutate(
              school,
              user,
              route,
              b,
              id,
              (c) =>
                id
                  ? manager(c, school, user, id)
                  : scope(db, school, user, b.orgId || null, 'manage', c),
              async (c) => {
                const old = id ? await row(c, school, id, false, true) : null;
                if (old) {
                  compare(old, b.expectedRevision);
                  if (!['draft', 'rejected'].includes(old.status))
                    throw problem('draft_or_rejected_edit_only', 409);
                }
                const v = await validateInput(c, school, user, b, old),
                  activityId = id || randomUUID();
                const values = [
                  school,
                  activityId,
                  v.org,
                  user,
                  v.kind,
                  v.title,
                  v.description,
                  v.conditions,
                  JSON.stringify(v.tasks),
                  v.scene,
                  v.entity,
                  v.startsAt,
                  v.endsAt,
                  v.closes,
                  v.capacity,
                  v.remind,
                  v.verifiers,
                ];
                await c.query(
                  `INSERT INTO hd_activities(school_id,activity_id,org_id,creator_id,kind,title,description,conditions,tasks,scene_id,entity_id,starts_at,ends_at,registration_closes_at,capacity,remind_before_minutes,verifier_ids,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'draft')
            ON CONFLICT(school_id,activity_id) DO UPDATE SET kind=EXCLUDED.kind,title=EXCLUDED.title,description=EXCLUDED.description,conditions=EXCLUDED.conditions,tasks=EXCLUDED.tasks,scene_id=EXCLUDED.scene_id,entity_id=EXCLUDED.entity_id,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,registration_closes_at=EXCLUDED.registration_closes_at,capacity=EXCLUDED.capacity,remind_before_minutes=EXCLUDED.remind_before_minutes,verifier_ids=EXCLUDED.verifier_ids,status='draft',revision=hd_activities.revision+1,reviewed_by=NULL,review_reason=NULL,updated_at=now()`,
                  values,
                );
                const a = await row(c, school, activityId);
                await event(
                  c,
                  school,
                  user,
                  a,
                  activityId,
                  a.revision,
                  old ? 'activity_edited' : 'activity_created',
                  { status: 'draft' },
                );
                return view(a);
              },
            ),
          );
        }
        if (
          req.method === 'POST' &&
          id &&
          ['submit', 'review', 'cancel', 'recap'].includes(action)
        ) {
          const b = fields(
            await body(req),
            [
              'requestId',
              'expectedRevision',
              ...(action === 'review'
                ? ['decision', 'reason']
                : action === 'cancel'
                  ? ['reason']
                  : action === 'recap'
                    ? ['recap']
                    : []),
            ],
            'activity_action',
          );
          const acl = async (c) => {
            const a = await row(c, school, id);
            await activityScope(c, school, user, a, action === 'review' ? 'moderate' : 'manage');
          };
          return send(
            await mutate(school, user, route, b, id, acl, async (c) => {
              let a = await row(c, school, id, false, true);
              compare(a, b.expectedRevision);
              if (action === 'submit') {
                if (!['draft', 'rejected'].includes(a.status))
                  throw problem('activity_state_conflict', 409);
                await c.query(
                  "UPDATE hd_activities SET status='pending',revision=revision+1,updated_at=now() WHERE school_id=$1 AND activity_id=$2",
                  [school, id],
                );
              }
              if (action === 'review') {
                if (a.status !== 'pending' || !['publish', 'reject'].includes(b.decision))
                  throw problem('activity_state_conflict', 409);
                text(b.reason, 3, 1000);
                if (a.ends_at <= new Date()) throw problem('activity_ended', 409);
                for (const v of a.verifier_ids) await activityScope(c, school, v, a);
                await c.query(
                  'UPDATE hd_activities SET status=$3,reviewed_by=$4,review_reason=$5,revision=revision+1,updated_at=now() WHERE school_id=$1 AND activity_id=$2',
                  [school, id, b.decision === 'publish' ? 'published' : 'rejected', user, b.reason],
                );
              }
              if (action === 'cancel') {
                if (a.status === 'cancelled') throw problem('activity_state_conflict', 409);
                text(b.reason, 3, 1000);
                const regs = (
                  await c.query(
                    "SELECT * FROM hd_activity_registrations WHERE school_id=$1 AND activity_id=$2 AND status IN ('registered','waitlisted','verified') FOR UPDATE",
                    [school, id],
                  )
                ).rows;
                for (const r of regs) {
                  if (r.status === 'verified') await revoke(c, school, user, a, r, b.reason);
                  else {
                    await c.query(
                      "UPDATE hd_activity_registrations SET status='cancelled',revision=revision+1,updated_at=now() WHERE school_id=$1 AND registration_id=$2",
                      [school, r.registration_id],
                    );
                    await event(
                      c,
                      school,
                      user,
                      a,
                      r.registration_id,
                      r.revision + 1,
                      'registration_cancelled',
                      { registrationId: r.registration_id, status: 'cancelled', reason: b.reason },
                      r.user_id,
                    );
                  }
                }
                await c.query(
                  "UPDATE hd_activity_reminders SET status='cancelled' WHERE school_id=$1 AND activity_id=$2 AND status='scheduled'",
                  [school, id],
                );
                await c.query(
                  "UPDATE hd_activities SET status='cancelled',review_reason=$3,revision=revision+1,updated_at=now() WHERE school_id=$1 AND activity_id=$2",
                  [school, id, b.reason],
                );
              }
              if (action === 'recap') {
                if (a.starts_at > new Date() || a.status !== 'published')
                  throw problem('activity_not_started', 409);
                text(b.recap, 5, 5000);
                await c.query(
                  'UPDATE hd_activities SET recap=$3,recap_by=$4,recap_revision=recap_revision+1,revision=revision+1,updated_at=now() WHERE school_id=$1 AND activity_id=$2',
                  [school, id, b.recap, user],
                );
              }
              a = await row(c, school, id);
              await event(c, school, user, a, id, a.revision, 'activity_' + action, {
                status: a.status,
              });
              await publication(c, school, a, user);
              return view(a);
            }),
          );
        }
        if (req.method === 'POST' && id && action === 'join') {
          const b = fields(await body(req), ['requestId', 'taskId'], 'join');
          const acl = async (c) => activityScope(c, school, user, await row(c, school, id));
          return send(
            await mutate(school, user, route, b, id, acl, async (c) => {
              const a = await row(c, school, id, false, true);
              await requireActivityReward(c, school, user, id);
              if (
                a.status !== 'published' ||
                a.registration_closes_at <= new Date() ||
                a.ends_at <= new Date()
              )
                throw problem('registration_closed', 409);
              if ((a.kind === 'volunteer' || b.taskId) && !a.tasks.some((t) => t.id === b.taskId))
                throw problem('task_choice_required');
              const old = (
                await c.query(
                  'SELECT * FROM hd_activity_registrations WHERE school_id=$1 AND activity_id=$2 AND user_id=$3 FOR UPDATE',
                  [school, id, user],
                )
              ).rows[0];
              if (old && !['withdrawn'].includes(old.status))
                throw problem('already_registered', 409);
              const count = Number(
                  (
                    await c.query(
                      "SELECT count(*) FROM hd_activity_registrations WHERE school_id=$1 AND activity_id=$2 AND status IN ('registered','verified')",
                      [school, id],
                    )
                  ).rows[0].count,
                ),
                status = count < a.capacity ? 'registered' : 'waitlisted';
              const r = (
                await c.query(
                  `INSERT INTO hd_activity_registrations(school_id,registration_id,activity_id,user_id,task_id,status) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(school_id,activity_id,user_id) DO UPDATE SET task_id=EXCLUDED.task_id,status=EXCLUDED.status,revision=hd_activity_registrations.revision+1,queue_position=nextval('hd_activity_queue_seq'),latest_submission_id=NULL,updated_at=now() RETURNING *`,
                  [
                    school,
                    old?.registration_id || randomUUID(),
                    id,
                    user,
                    b.taskId || null,
                    status,
                  ],
                )
              ).rows[0];
              await event(
                c,
                school,
                user,
                a,
                r.registration_id,
                r.revision,
                'registration_joined',
                { registrationId: r.registration_id, status },
                user,
              );
              if (status === 'registered') await prepareReminder(c, school, a, r);
              return view(r);
            }),
          );
        }
        if (req.method === 'GET' && id && action === 'participants') {
          const a = await row(db.pool, school, id);
          await activityScope(db.pool, school, user, a);
          let manage = false;
          try {
            await activityScope(db.pool, school, user, a, 'manage');
            manage = true;
          } catch (e) {
            if (e.status !== 403) throw e;
          }
          if (!manage) await verifier(db.pool, school, user, a);
          const rows = (
            await db.pool.query(
              'SELECT r.*,u.display_name FROM hd_activity_registrations r JOIN hd_users u USING(user_id) WHERE r.school_id=$1 AND r.activity_id=$2 ORDER BY queue_position',
              [school, id],
            )
          ).rows;
          return send({
            participants: await Promise.all(
              rows.map((r) =>
                registrationView(
                  db.pool,
                  school,
                  r,
                  a.verifier_ids.includes(user) || r.user_id === user,
                ),
              ),
            ),
          });
        }
      }
      if (resource === 'registrations') {
        if (req.method === 'GET' && !id) {
          const { rows } = await db.pool.query(
            'SELECT r.*,a.title,a.kind,a.org_id,a.starts_at,a.ends_at FROM hd_activity_registrations r JOIN hd_activities a USING(school_id,activity_id) WHERE r.school_id=$1 AND r.user_id=$2 ORDER BY r.created_at DESC',
            [school, user],
          );
          const records = [];
          for (const r of rows) {
            try {
              await scope(db, school, user, r.org_id);
              records.push(await registrationView(db.pool, school, r, true));
            } catch (e) {
              if (e.status !== 403) throw e;
            }
          }
          return send({ records });
        }
        if (
          req.method === 'POST' &&
          id &&
          ['withdraw', 'evidence', 'verify', 'revoke'].includes(action)
        ) {
          const b = fields(
            await body(req),
            [
              'requestId',
              'expectedRevision',
              ...(action === 'evidence'
                ? ['note', 'attachmentIds']
                : action === 'verify'
                  ? ['decision', 'reason', 'minutes']
                  : ['reason']),
            ],
            'participation',
          );
          const initial = await row(db.pool, school, id, true),
            activityId = initial.activity_id;
          const acl = async (c) => {
            if (['withdraw', 'evidence'].includes(action))
              return ownRegistration(c, school, user, id);
            const r = await row(c, school, id, true),
              a = await row(c, school, r.activity_id);
            if (r.user_id === user) throw problem('self_verification_denied', 403);
            await verifier(c, school, user, a);
          };
          return send(
            await mutate(school, user, route, b, activityId, acl, async (c) => {
              const r = await row(c, school, id, true, true),
                a = await row(c, school, r.activity_id, false, true);
              compare(r, b.expectedRevision);
              if (action === 'withdraw') {
                if (!['registered', 'waitlisted'].includes(r.status))
                  throw problem('participation_state_conflict', 409);
                text(b.reason, 3, 500);
                await c.query(
                  "UPDATE hd_activity_registrations SET status='withdrawn',revision=revision+1,updated_at=now() WHERE school_id=$1 AND registration_id=$2",
                  [school, id],
                );
                await c.query(
                  "UPDATE hd_activity_reminders SET status='cancelled' WHERE school_id=$1 AND registration_id=$2 AND status='scheduled'",
                  [school, id],
                );
                await event(
                  c,
                  school,
                  user,
                  a,
                  id,
                  r.revision + 1,
                  'registration_withdrawn',
                  { registrationId: id, status: 'withdrawn', reason: b.reason },
                  user,
                );
                await promote(c, school, a);
              }
              if (action === 'evidence') {
                if (
                  a.status !== 'published' ||
                  r.status !== 'registered' ||
                  a.starts_at > new Date()
                )
                  throw problem('evidence_not_open', 409);
                text(b.note, 5, 3000);
                const ids = b.attachmentIds || [];
                if (
                  !Array.isArray(ids) ||
                  ids.length > 10 ||
                  new Set(ids).size !== ids.length ||
                  !ids.every(uuid)
                )
                  throw problem('attachments_invalid');
                if (ids.length && !validateAttachment)
                  throw problem('attachment_validation_not_connected', 409);
                const attachments = [];
                for (const attachmentId of ids)
                  attachments.push(
                    await validateAttachment(c, {
                      schoolId: school,
                      userId: user,
                      attachmentId,
                      activityId: a.activity_id,
                    }),
                  );
                await c.query(
                  "UPDATE hd_activity_submissions SET status='superseded' WHERE school_id=$1 AND registration_id=$2 AND status='pending'",
                  [school, id],
                );
                const submissionId = randomUUID();
                await c.query(
                  "INSERT INTO hd_activity_submissions(school_id,submission_id,registration_id,user_id,note,attachments,status) VALUES($1,$2,$3,$4,$5,$6,'pending')",
                  [school, submissionId, id, user, b.note, JSON.stringify(attachments)],
                );
                await c.query(
                  'UPDATE hd_activity_registrations SET latest_submission_id=$3,revision=revision+1,updated_at=now() WHERE school_id=$1 AND registration_id=$2',
                  [school, id, submissionId],
                );
                await event(
                  c,
                  school,
                  user,
                  a,
                  id,
                  r.revision + 1,
                  'evidence_submitted',
                  { registrationId: id, status: 'registered', submissionId },
                  user,
                );
              }
              if (action === 'verify') {
                if (
                  a.status !== 'published' ||
                  r.status !== 'registered' ||
                  a.starts_at > new Date() ||
                  !r.latest_submission_id ||
                  !['approve', 'reject'].includes(b.decision)
                )
                  throw problem('verification_not_open', 409);
                await activityScope(c, school, r.user_id, a);
                text(b.reason, 3, 1000);
                const s = (
                  await c.query(
                    'SELECT * FROM hd_activity_submissions WHERE school_id=$1 AND submission_id=$2 FOR UPDATE',
                    [school, r.latest_submission_id],
                  )
                ).rows[0];
                if (s.status !== 'pending') throw problem('evidence_already_reviewed', 409);
                if (s.attachments.length && !validateAttachment)
                  throw problem('attachment_validation_not_connected', 409);
                if (validateAttachment)
                  for (const ref of s.attachments)
                    await validateAttachment(c, {
                      schoolId: school,
                      userId: r.user_id,
                      attachmentId: ref.attachmentId || ref.id,
                      activityId: a.activity_id,
                    });
                if (
                  b.decision === 'approve' &&
                  (!Number.isSafeInteger(b.minutes) ||
                    b.minutes < (a.kind === 'volunteer' ? 1 : 0) ||
                    b.minutes > Math.floor((a.ends_at - a.starts_at) / 60000))
                )
                  throw problem('verified_minutes_invalid');
                await c.query(
                  'UPDATE hd_activity_submissions SET status=$3,reason=$4,reviewed_by=$5,reviewed_at=now() WHERE school_id=$1 AND submission_id=$2',
                  [
                    school,
                    s.submission_id,
                    b.decision === 'approve' ? 'accepted' : 'rejected',
                    b.reason,
                    user,
                  ],
                );
                const eventId = await event(
                  c,
                  school,
                  user,
                  a,
                  id,
                  r.revision + 1,
                  b.decision === 'approve'
                    ? a.kind === 'volunteer'
                      ? 'volunteer_verified'
                      : 'activity_verified'
                    : 'evidence_rejected',
                  {
                    registrationId: id,
                    status: b.decision === 'approve' ? 'verified' : 'registered',
                    submissionId: s.submission_id,
                    reason: b.reason,
                    minutes: b.decision === 'approve' ? b.minutes : 0,
                  },
                  r.user_id,
                );
                await c.query(
                  'UPDATE hd_activity_registrations SET status=$3,revision=revision+1,verification_event_id=$4,verified_minutes=$5,verified_by=$6,verified_at=$7,updated_at=now() WHERE school_id=$1 AND registration_id=$2',
                  [
                    school,
                    id,
                    b.decision === 'approve' ? 'verified' : 'registered',
                    b.decision === 'approve' ? eventId : null,
                    b.decision === 'approve' ? b.minutes : null,
                    b.decision === 'approve' ? user : null,
                    b.decision === 'approve' ? new Date() : null,
                  ],
                );
              }
              if (action === 'revoke') {
                text(b.reason, 3, 1000);
                await revoke(c, school, user, a, r, b.reason);
                await promote(c, school, a);
              }
              return {
                ...(await registrationView(c, school, await row(c, school, id, true), true)),
                contributionConnected: Boolean(recordContribution),
              };
            }),
          );
        }
      }
      if (req.method === 'POST' && resource === 'reconcile' && !id) {
        fields(await body(req), [], 'reconcile');
        await scope(db, school, user, null, 'manage');
        return send(await reconcile(school));
      }
      throw problem('route_missing', 404);
    },
  };
}
