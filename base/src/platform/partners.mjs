import { randomUUID, randomBytes } from 'node:crypto';
import { hash, problem } from './db.mjs';
import { audit, validId } from './permissions.mjs';
import { canonical, fields } from '../protocol/index.mjs';
import { publishInformation } from './information.mjs';
import { publicPlace } from './world-places.mjs';

const uuid = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const text = (v, min, max, code = 'text_invalid') => {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw problem(code);
  return v.trim();
};
const future = (v) => {
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || Date.parse(v) <= Date.now())
    throw problem('future_expiry_required');
  return new Date(v).toISOString();
};
const revision = (v) => {
  if (!Number.isSafeInteger(v) || v < 1) throw problem('expected_revision_required');
  return v;
};
const compare = (row, v) => {
  if (row.revision !== revision(v)) throw problem('revision_conflict', 409);
};
const nowValid = (v) => new Date(v).getTime() > Date.now();
const view = (r) => {
  if (!r) return null;
  return Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]),
  );
};
const officialUrl = (v) => {
  if (!v) return null;
  let url;
  try {
    url = new URL(v);
  } catch {
    throw problem('official_url_invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 1000)
    throw problem('official_https_url_required');
  return url.href;
};

export function createPartners(db, identity, services, config, { getWorld = () => null } = {}) {
  const adapter = config.partnersAdapter || { type: 'unavailable' };
  if (adapter.type === 'local-fixture' && process.env.HD_M1_TEST_FIXTURE !== '1')
    throw problem('partner_fixture_requires_isolated_test_flag', 500);
  if (adapter.type === 'http') {
    const a = new URL(adapter.url);
    if (!['https:', 'http:'].includes(a.protocol) || a.username || a.password || a.search || a.hash)
      throw problem('partner_adapter_config_invalid', 500);
    if (a.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(a.hostname))
      throw problem('partner_adapter_https_required', 500);
    if (!adapter.token) throw problem('partner_adapter_token_required', 500);
  }
  const configured = ['http', 'local-fixture'].includes(adapter.type);
  const locationValid = (school, sceneId, entityId) => {
    if (!sceneId && !entityId) return true;
    const world = getWorld();
    if (!world) return false;
    try {
      return Boolean(publicPlace(world, services.school(school).spaceId, sceneId, entityId));
    } catch {
      return false;
    }
  };
  const row = async (c, table, school, id, lock = false) => {
    const key = {
      partners: 'partner',
      services: 'service',
      offers: 'offer',
      entitlements: 'entitlement',
      tasks: 'task',
    }[table];
    if (!key || !uuid(id)) throw problem('object_id_invalid');
    const r = (
      await c.query(
        `SELECT * FROM hd_m5_${table} WHERE school_id=$1 AND ${key}_id=$2${lock ? ' FOR UPDATE' : ''}`,
        [school, id],
      )
    ).rows[0];
    if (!r) throw problem('object_not_found', 404);
    return r;
  };
  async function member(school, user, c = db.pool) {
    return db.member(school, user, null, c);
  }
  async function ordinary(school, user, c = db.pool) {
    const m = await member(school, user, c);
    if (['partner', 'affiliate'].includes(m.role)) throw problem('school_member_required', 403);
    return m;
  }
  async function owner(school, user, c = db.pool) {
    return db.member(school, user, ['owner'], c);
  }
  async function staff(school, partner, user, role = 'maintainer', c = db.pool) {
    const m = await member(school, user, c),
      p = await row(c, 'partners', school, partner);
    if (m.role === 'owner') return p;
    const s = (
      await c.query(
        'SELECT * FROM hd_m5_staff WHERE school_id=$1 AND partner_id=$2 AND user_id=$3 AND active',
        [school, partner, user],
      )
    ).rows[0];
    if (!s || (role !== 'any' && s.role !== role)) throw problem('partner_scope_denied', 403);
    if (p.org_id) {
      const o = await c.query(
        `SELECT 1 FROM hd_org_members m JOIN hd_organizations o USING(school_id,org_id)
        WHERE m.school_id=$1 AND m.org_id=$2 AND m.user_id=$3 AND m.active AND o.active`,
        [school, p.org_id, user],
      );
      if (!o.rowCount) throw problem('partner_organization_denied', 403);
    }
    return p;
  }
  async function partnerActive(c, school, id, lock = false) {
    const p = await row(c, 'partners', school, id, lock);
    if (p.status !== 'approved' || !nowValid(p.valid_until))
      throw problem('partner_unavailable', 409);
    return p;
  }
  async function publicService(c, school, id, lock = false) {
    const s = await row(c, 'services', school, id, lock);
    await partnerActive(c, school, s.partner_id);
    if (
      s.status !== 'published' ||
      !nowValid(s.valid_until) ||
      !locationValid(school, s.scene_id, s.entity_id)
    )
      throw problem('service_unavailable', 409);
    return s;
  }
  async function notify(c, school, user, eventId, payload) {
    await c.query(
      'INSERT INTO hd_notifications(school_id,user_id,event_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [school, user, eventId, payload],
    );
  }
  async function publication(c, school, table, id, actor) {
    const x = await row(c, table, school, id),
      p = await row(c, 'partners', school, x.partner_id);
    const sourceId = (table === 'services' ? 'service:' : 'offer:') + id;
    const active =
      x.status === 'published' &&
      p.status === 'approved' &&
      nowValid(x.valid_until) &&
      nowValid(p.valid_until) &&
      (table !== 'services' || locationValid(school, x.scene_id, x.entity_id));
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      school + ':information',
    ]);
    const old = (
      await c.query(
        "SELECT * FROM hd_information_heads WHERE school_id=$1 AND topic='partners' AND source_id=$2",
        [school, sourceId],
      )
    ).rows[0];
    if (!old && !active) return;
    const status = active ? 'published' : 'withdrawn',
      expiresAt = new Date(
        Math.min(new Date(x.valid_until).getTime(), new Date(p.valid_until).getTime()),
      ).toISOString();
    if (
      old &&
      old.status === status &&
      old.title === (active ? x.title : '') &&
      old.expires_at?.toISOString() === expiresAt
    )
      return;
    const sourceRevision = (old?.revision || 0) + 1;
    await publishInformation(c, {
      schoolId: school,
      eventId: 'partners-info:' + hash([school, sourceId, sourceRevision]),
      topic: 'partners',
      sourceId,
      sourceRevision,
      status,
      title: active ? x.title : '',
      expiresAt,
      actorId: actor,
    });
  }
  async function event(c, school, actor, partner, object, rev, kind, detail = {}, recipient) {
    const eventId = `${school}:base-partners:${object}:${rev}`;
    const envelope = {
      schema: 'hyper-dimension.event/v1',
      eventId,
      schoolId: school,
      source: { system: 'base-partners', id: object, revision: rev },
      actor: detail.agentDelegationId
        ? { kind: 'agent', serviceId: 'delegation:' + detail.agentDelegationId }
        : actor
          ? { kind: 'human', userId: actor }
          : { kind: 'service', serviceId: 'partners-reconciler' },
      onBehalfOf: detail.agentDelegationId ? { kind: 'human', userId: actor } : null,
      partnerId: partner,
      kind,
      status: detail.status || kind,
      visibility: 'business-scoped',
      occurredAt: new Date().toISOString(),
      detail,
    };
    await c.query(
      'INSERT INTO hd_m5_events(event_id,school_id,partner_id,object_id,revision,kind,envelope) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [eventId, school, partner, object, rev, kind, envelope],
    );
    await audit(c, school, actor, `partners.${kind}`, object, {
      partnerId: partner,
      revision: rev,
      ...detail,
      ...(actor ? {} : { actorKind: 'system' }),
    });
    if (kind.startsWith('service_')) await publication(c, school, 'services', object, actor);
    if (kind.startsWith('offer_')) await publication(c, school, 'offers', object, actor);
    if (kind.startsWith('partner_')) {
      for (const table of ['services', 'offers']) {
        const key = table === 'services' ? 'service_id' : 'offer_id';
        const { rows } = await c.query(
          `SELECT ${key} AS id FROM hd_m5_${table} WHERE school_id=$1 AND partner_id=$2`,
          [school, partner],
        );
        for (const x of rows) await publication(c, school, table, x.id, actor);
      }
    }
    if (recipient)
      await notify(c, school, recipient, eventId, {
        type: 'partner-business',
        objectId: object,
        partnerId: partner,
        kind,
        status: envelope.status,
      });
    return eventId;
  }
  async function metric(c, school, partner, kind, user, object) {
    await c.query(
      "INSERT INTO hd_m5_metrics(school_id,partner_id,kind,actor_id,object_id,day) VALUES($1,$2,$3,$4,$5,(now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING",
      [school, partner, kind, user, object],
    );
  }
  async function mutate(school, user, route, input, acl, fn) {
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(input.requestId || ''))
      throw problem('request_id_required');
    const fingerprint = hash(canonical({ route, input }));
    // Receipt replay shares the same current-scope locks as new mutations.
    await acl(db.pool);
    return db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        school + ':permissions',
      ]);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        school + ':information',
      ]);
      const segments = route.split('/').filter(Boolean),
        resource = segments[3],
        id = segments[4];
      let partnerId = input.partnerId;
      if (resource === 'partners' && id) partnerId = id;
      else if (['services', 'offers', 'tasks', 'entitlements'].includes(resource) && id)
        partnerId = (await row(c, resource, school, id)).partner_id;
      else if (resource === 'tasks' && input.serviceId)
        partnerId = (await row(c, 'services', school, input.serviceId)).partner_id;
      if (partnerId)
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `partner-business:${school}:${partnerId}`,
        ]);
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
  const privateTask = async (c, school, user, id, lock = false) => {
    const t = await row(c, 'tasks', school, id, lock);
    await member(school, user, c);
    if (t.user_id !== user) {
      await staff(school, t.partner_id, user, 'maintainer', c);
      if (!t.consent || t.status === 'proposed') throw problem('unconsented_task_private', 403);
    }
    return t;
  };
  const taskOwner = async (c, school, user, id) => {
    const t = await row(c, 'tasks', school, id);
    await ordinary(school, user, c);
    if (t.user_id !== user) throw problem('task_owner_required', 403);
    return t;
  };

  async function adapterCall(action, task, op, queryOnly = false, transaction = db.tx) {
    if (adapter.type === 'local-fixture') {
      return transaction(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `fixture:${task.school_id}:${task.task_id}`,
        ]);
        let booking = (
          await c.query('SELECT * FROM hd_m5_fixture_bookings WHERE school_id=$1 AND task_id=$2', [
            task.school_id,
            task.task_id,
          ])
        ).rows[0];
        if (queryOnly) {
          if (!booking || (action === 'cancel' && booking.status !== 'cancelled'))
            return { status: 'unknown' };
        } else if (action === 'create') {
          if (booking && booking.fingerprint !== op.fingerprint)
            throw problem('fixture_request_conflict', 409);
          if (!booking)
            booking = (
              await c.query(
                `INSERT INTO hd_m5_fixture_bookings(school_id,task_id,partner_id,fingerprint,status,receipt_id)
            VALUES($1,$2,$3,$4,'confirmed',$5) RETURNING *`,
                [task.school_id, task.task_id, task.partner_id, op.fingerprint, randomUUID()],
              )
            ).rows[0];
        } else if (!booking) {
          return {
            status: 'not_created',
            operationId: op.operation_id,
            receiptId: 'fixture-absent-' + task.task_id,
            provider: 'local-fixture',
          };
        } else if (booking.status !== 'cancelled') {
          booking = (
            await c.query(
              `UPDATE hd_m5_fixture_bookings SET status='cancelled',cancel_receipt_id=$3 WHERE school_id=$1 AND task_id=$2 RETURNING *`,
              [task.school_id, task.task_id, randomUUID()],
            )
          ).rows[0];
        }
        return {
          status: action === 'cancel' ? 'cancelled' : 'confirmed',
          operationId: op.operation_id,
          receiptId: action === 'cancel' ? booking.cancel_receipt_id : booking.receipt_id,
          provider: 'local-fixture',
        };
      });
    }
    if (adapter.type !== 'http') return { status: 'unavailable' };
    const root = adapter.url.replace(/\/$/, ''),
      endpoint = queryOnly
        ? `/operations/${encodeURIComponent(op.operation_id)}?schoolId=${encodeURIComponent(task.school_id)}`
        : '/operations';
    const response = await fetch(root + endpoint, {
      method: queryOnly ? 'GET' : 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${adapter.token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': op.operation_id,
      },
      ...(!queryOnly
        ? {
            body: JSON.stringify({
              schema: 'hyper-dimension.partner-operation/v1',
              schoolId: task.school_id,
              partnerId: task.partner_id,
              taskId: task.task_id,
              operationId: op.operation_id,
              fingerprint: op.fingerprint,
              action,
              request: task.request,
              consent: task.consent,
              source: task.source_snapshot,
            }),
          }
        : {}),
    });
    if (response.status === 404 && queryOnly) return { status: 'unknown' };
    if (!response.ok) throw problem('adapter_transport_unconfirmed', 503);
    const raw = await response.text();
    if (raw.length > 16384) throw problem('adapter_receipt_invalid', 503);
    let r;
    try {
      r = JSON.parse(raw);
    } catch {
      throw problem('adapter_receipt_invalid', 503);
    }
    if (r.status === 'unknown' && queryOnly) return { status: 'unknown' };
    const valid =
      action === 'create' ? ['confirmed', 'failed'] : ['cancelled', 'not_created', 'failed'];
    if (
      r.operationId !== op.operation_id ||
      !valid.includes(r.status) ||
      typeof r.receiptId !== 'string' ||
      r.receiptId.length < 1 ||
      r.receiptId.length > 200
    )
      throw problem('adapter_receipt_invalid', 503);
    return {
      status: r.status,
      operationId: r.operationId,
      receiptId: r.receiptId,
      provider: 'configured-http',
    };
  }

  async function processTask(school, id) {
    // One reconciler owns each task. Database connection lock spans the bounded adapter call;
    // a second process cannot create a second operation while the first is uncertain.
    const c = await db.pool.connect(),
      key = `partners-worker:${school}:${id}`;
    // Reuse the lock-owning connection: asking the pool for another connection while
    // request transactions wait for this worker's lock can exhaust the pool and deadlock.
    const workerTx = async (fn) => {
      await c.query('BEGIN');
      try {
        const result = await fn(c);
        await c.query('COMMIT');
        return result;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    };
    let locked = false,
      permissionsLocked = false;
    try {
      await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [school + ':permissions']);
      permissionsLocked = true;
      locked = (
        await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [key])
      ).rows[0].locked;
      if (!locked) return { taskId: id, state: 'busy' };
      let t = await row(c, 'tasks', school, id);
      if (
        !['queued', 'pending_confirmation', 'cancel_requested', 'cancel_pending'].includes(t.status)
      )
        return { taskId: id, state: t.status };
      const action = t.status.startsWith('cancel') ? 'cancel' : 'create';
      // Withdrawal can stop a not-yet-attempted create, but cannot claim an uncertain remote call was cancelled.
      const opId = `${school}:${id}:${action}`,
        fingerprint = hash(
          canonical({
            action,
            taskId: id,
            school,
            request: t.request,
            consent: t.consent,
            source: t.source_snapshot,
          }),
        );
      let op = (
        await c.query(
          'SELECT * FROM hd_m5_adapter_operations WHERE school_id=$1 AND operation_id=$2',
          [school, opId],
        )
      ).rows[0];
      if (!op) {
        if (action === 'create') {
          try {
            const source = await publicService(c, school, t.service_id);
            if (source.revision !== t.source_revision)
              throw problem('source_revision_changed', 409);
            await ordinary(school, t.user_id, c);
          } catch {
            await workerTx(async (tx) => {
              const current = await row(tx, 'tasks', school, id, true);
              if (current.status !== 'queued') return;
              await tx.query(
                `UPDATE hd_m5_tasks SET status='failed',revision=revision+1,last_error='source_or_account_unavailable',updated_at=now() WHERE school_id=$1 AND task_id=$2`,
                [school, id],
              );
              await event(
                tx,
                school,
                null,
                t.partner_id,
                id,
                current.revision + 1,
                'task_failed',
                { status: 'failed' },
                t.user_id,
              );
            });
            return { taskId: id, state: 'failed' };
          }
        }
        op = (
          await c.query(
            `INSERT INTO hd_m5_adapter_operations(school_id,operation_id,task_id,action,fingerprint,state) VALUES($1,$2,$3,$4,$5,'prepared') RETURNING *`,
            [school, opId, id, action, fingerprint],
          )
        ).rows[0];
      }
      // Mark uncertain BEFORE dispatch. A process death after this point must query by operationId.
      const queryOnly = op.state !== 'prepared';
      if (op.state === 'completed') return { taskId: id, state: t.status };
      await c.query(
        `UPDATE hd_m5_adapter_operations SET state='uncertain',attempts=attempts+1,updated_at=now() WHERE school_id=$1 AND operation_id=$2`,
        [school, opId],
      );
      let receipt, error;
      try {
        receipt = await adapterCall(action, t, op, queryOnly, workerTx);
      } catch (e) {
        error = e.code || 'adapter_transport_unconfirmed';
      }
      await workerTx(async (tx) => {
        const current = await row(tx, 'tasks', school, id, true);
        const success = receipt && !['unknown', 'unavailable'].includes(receipt.status);
        if (!success) {
          const pending = action === 'create' ? 'pending_confirmation' : 'cancel_pending';
          await tx.query(
            `UPDATE hd_m5_adapter_operations SET last_error=$3 WHERE school_id=$1 AND operation_id=$2`,
            [school, opId, error || receipt?.status || 'unknown'],
          );
          // A user may have requested cancellation while create was in flight; keep that cancellation visible.
          if (
            !(action === 'create' && current.status.startsWith('cancel')) &&
            current.status !== pending
          ) {
            await tx.query(
              'UPDATE hd_m5_tasks SET status=$3,revision=revision+1,last_error=$4,updated_at=now() WHERE school_id=$1 AND task_id=$2',
              [school, id, pending, error || receipt?.status || 'unknown'],
            );
            await event(
              tx,
              school,
              null,
              t.partner_id,
              id,
              current.revision + 1,
              'task_pending',
              { status: pending },
              t.user_id,
            );
          }
          return;
        }
        await tx.query(
          `UPDATE hd_m5_adapter_operations SET state='completed',receipt=$3,last_error=NULL,updated_at=now() WHERE school_id=$1 AND operation_id=$2`,
          [school, opId, receipt],
        );
        const cancelledWhileCreating = action === 'create' && current.status.startsWith('cancel');
        const status = cancelledWhileCreating
          ? 'cancel_requested'
          : action === 'create'
            ? receipt.status === 'confirmed'
              ? 'confirmed'
              : 'failed'
            : ['cancelled', 'not_created'].includes(receipt.status)
              ? 'cancelled'
              : 'cancel_pending';
        await tx.query(
          `UPDATE hd_m5_tasks SET status=$3,revision=revision+1,${action === 'create' ? 'external_receipt' : 'cancel_receipt'}=$4,last_error=$5,updated_at=now() WHERE school_id=$1 AND task_id=$2`,
          [school, id, status, receipt, receipt.status === 'failed' ? 'adapter_rejected' : null],
        );
        await event(
          tx,
          school,
          null,
          t.partner_id,
          id,
          current.revision + 1,
          'task_receipt',
          { status, adapter: receipt.provider, receiptId: receipt.receiptId },
          t.user_id,
        );
      });
      return { taskId: id, state: (await row(c, 'tasks', school, id)).status };
    } finally {
      if (locked) await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
      if (permissionsLocked)
        await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
          school + ':permissions',
        ]);
      c.release();
    }
  }

  async function publishedSources(school, client = db.pool) {
    const { rows } = await client.query(
      `SELECT s.*,p.name AS partner_name FROM hd_m5_services s JOIN hd_m5_partners p USING(school_id,partner_id)
      WHERE s.school_id=$1 AND s.status='published' AND s.valid_until>now() AND p.status='approved' AND p.valid_until>now() ORDER BY s.service_id`,
      [school],
    );
    return rows
      .filter((s) => locationValid(school, s.scene_id, s.entity_id))
      .map((s) => ({
        id: `partner:${s.service_id}:${s.revision}`,
        title: s.title,
        text: `${s.partner_name}：${s.description}\n办理条件：${s.conditions}\n服务时间：${s.hours}${s.official_url ? `\n官方入口：${s.official_url}` : ''}`,
        sourceType: 'reviewed-partner',
        serviceId: s.service_id,
        partnerId: s.partner_id,
        revision: s.revision,
        validUntil: s.valid_until,
        sceneId: s.scene_id,
        entityId: s.entity_id,
      }));
  }

  async function issueReward(
    c,
    {
      schoolId: school,
      userId: user,
      offerId: id,
      expectedRevision,
      rewardClaimId,
      actorId,
      expiresAt,
    },
  ) {
    if (!uuid(rewardClaimId)) throw problem('reward_claim_invalid');
    await ordinary(school, user, c);
    const initial = await row(c, 'offers', school, id);
    for (const key of [
      school + ':permissions',
      school + ':information',
      `partner-business:${school}:${initial.partner_id}`,
    ])
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
    await ordinary(school, user, c);
    const o = await row(c, 'offers', school, id, true);
    compare(o, expectedRevision);
    await partnerActive(c, school, o.partner_id);
    if (o.status !== 'published' || !nowValid(o.valid_until))
      throw problem('offer_unavailable', 409);
    const rewardExpiresAt = new Date(expiresAt);
    if (
      !Number.isFinite(+rewardExpiresAt) ||
      rewardExpiresAt <= new Date() ||
      rewardExpiresAt > o.valid_until
    )
      throw problem('reward_entitlement_expiry_invalid', 409);
    const prior = (
      await c.query(
        'SELECT * FROM hd_m5_entitlements WHERE school_id=$1 AND offer_id=$2 AND user_id=$3',
        [school, id, user],
      )
    ).rows[0];
    if (prior) {
      if (prior.terms.rewardClaimId === rewardClaimId) return view(prior);
      throw problem('offer_already_claimed', 409);
    }
    if (o.issued >= o.stock) throw problem('offer_sold_out', 409);
    if (
      o.org_id &&
      !(
        await c.query(
          'SELECT 1 FROM hd_org_members m JOIN hd_organizations g USING(school_id,org_id) WHERE m.school_id=$1 AND m.org_id=$2 AND m.user_id=$3 AND m.active AND g.active',
          [school, o.org_id, user],
        )
      ).rowCount
    )
      throw problem('offer_eligibility_denied', 403);
    const score = Number(
      (
        await c.query(
          'SELECT COALESCE(sum(delta),0) score FROM hd_contributions WHERE school_id=$1 AND user_id=$2 AND scope_id=$3 AND ($4::text IS NULL OR period=$4)',
          [school, user, o.org_id || '', o.contribution_period],
        )
      ).rows[0].score,
    );
    if (score < o.min_contribution) throw problem('contribution_eligibility_denied', 403);
    const entitlementId = randomUUID(),
      token = randomBytes(32).toString('base64url'),
      terms = {
        title: o.title,
        terms: o.terms,
        offerRevision: o.revision,
        withdrawalPolicy: o.withdrawal_policy,
        minContribution: o.min_contribution,
        contributionPeriod: o.contribution_period,
        orgId: o.org_id,
        rewardClaimId,
      };
    await c.query(
      "INSERT INTO hd_m5_entitlements(school_id,entitlement_id,partner_id,offer_id,user_id,token,status,valid_until,terms) VALUES($1,$2,$3,$4,$5,$6,'issued',$7,$8)",
      [school, entitlementId, o.partner_id, id, user, token, rewardExpiresAt, terms],
    );
    await c.query('UPDATE hd_m5_offers SET issued=issued+1 WHERE school_id=$1 AND offer_id=$2', [
      school,
      id,
    ]);
    await metric(c, school, o.partner_id, 'claim', user, entitlementId);
    await event(
      c,
      school,
      actorId || user,
      o.partner_id,
      entitlementId,
      1,
      'entitlement_issued',
      { status: 'issued', offerId: id, rewardClaimId },
      user,
    );
    return view(await row(c, 'entitlements', school, entitlementId));
  }
  async function revokeReward(
    c,
    { schoolId: school, entitlementId: id, rewardClaimId, actorId, reason, expired = false },
  ) {
    const initial = await row(c, 'entitlements', school, id);
    for (const key of [
      school + ':permissions',
      school + ':information',
      `partner-business:${school}:${initial.partner_id}`,
    ])
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
    const e = await row(c, 'entitlements', school, id, true);
    if (e.terms.rewardClaimId !== rewardClaimId) throw problem('reward_authority_mismatch', 409);
    if (e.status === 'redeemed') {
      if (expired) return { entitlementId: id, status: 'redeemed', consumedBeforeExpiry: true };
      throw problem('reward_partner_already_redeemed', 409);
    }
    if (e.status === 'revoked')
      return { entitlementId: id, status: 'revoked', alreadyRevoked: true };
    await c.query(
      "UPDATE hd_m5_entitlements SET status='revoked',revision=revision+1,revoked_reason=$3 WHERE school_id=$1 AND entitlement_id=$2",
      [school, id, reason],
    );
    await event(
      c,
      school,
      actorId || null,
      e.partner_id,
      id,
      e.revision + 1,
      'entitlement_revoked',
      { status: 'revoked', reason, rewardClaimId },
      e.user_id,
    );
    return { entitlementId: id, status: 'revoked', revision: e.revision + 1 };
  }
  async function proposeTask(school, user, input, guard) {
    const route = '/m5/schools/' + school + '/tasks';
    input = fields(input, ['requestId', 'serviceId', 'kind', 'request'], 'task');
    if (!['consultation', 'appointment'].includes(input.kind)) throw problem('task_kind_invalid');
    const request = fields(
      input.request,
      ['question', 'requestedTime', 'contactName', 'contactHandle'],
      'task_request',
    );
    text(request.question, 2, 1500);
    if (request.requestedTime) {
      if (
        !Number.isFinite(Date.parse(request.requestedTime)) ||
        Date.parse(request.requestedTime) <= Date.now()
      )
        throw problem('appointment_time_invalid');
      request.requestedTime = new Date(request.requestedTime).toISOString();
    }
    if (input.kind === 'appointment' && !request.requestedTime)
      throw problem('appointment_time_required');
    if (request.contactName) text(request.contactName, 1, 100);
    if (request.contactHandle) text(request.contactHandle, 2, 200);
    return mutate(
      school,
      user,
      route,
      input,
      async (c) => {
        await guard?.(c);
        await ordinary(school, user, c);
      },
      async (c) => {
        const s = await publicService(c, school, input.serviceId),
          taskId = randomUUID();
        const snapshot = {
          serviceId: s.service_id,
          revision: s.revision,
          title: s.title,
          description: s.description,
          conditions: s.conditions,
          hours: s.hours,
          officialUrl: s.official_url,
          validUntil: s.valid_until,
        };
        await c.query(
          `INSERT INTO hd_m5_tasks(school_id,task_id,partner_id,service_id,user_id,kind,status,source_revision,source_snapshot,request) VALUES($1,$2,$3,$4,$5,$6,'proposed',$7,$8,$9)`,
          [
            school,
            taskId,
            s.partner_id,
            s.service_id,
            user,
            input.kind,
            s.revision,
            snapshot,
            request,
          ],
        );
        await event(
          c,
          school,
          user,
          s.partner_id,
          taskId,
          1,
          'task_proposed',
          {
            status: 'proposed',
            ...(guard?.delegationId ? { agentDelegationId: guard.delegationId } : {}),
          },
          user,
        );
        return {
          ...view(await row(c, 'tasks', school, taskId)),
          confirmationRequired: true,
          sharesWithPartner: Object.keys(request),
        };
      },
    );
  }
  async function cancelTask(school, user, id, input, guard) {
    const route = '/m5/schools/' + school + '/tasks/' + id + '/cancel';
    input = fields(input, ['requestId', 'expectedRevision', 'reason'], 'task_cancel');
    text(input.reason, 3, 500);
    return mutate(
      school,
      user,
      route,
      input,
      async (c) => {
        await guard?.(c);
        await taskOwner(c, school, user, id);
      },
      async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `partners-worker:${school}:${id}`,
        ]);
        const t = await row(c, 'tasks', school, id, true);
        compare(t, input.expectedRevision);
        if (['cancelled', 'failed', 'cancel_requested', 'cancel_pending'].includes(t.status))
          throw problem('task_not_cancellable', 409);
        const ops = await c.query(
          `SELECT 1 FROM hd_m5_adapter_operations WHERE school_id=$1 AND task_id=$2 AND action='create'`,
          [school, id],
        );
        const localOnly =
          !ops.rowCount && ['proposed', 'adapter_unavailable', 'queued'].includes(t.status);
        const status = localOnly ? 'cancelled' : 'cancel_requested',
          receipt = localOnly
            ? {
                provider: 'base-local',
                status: 'cancelled_before_dispatch',
                receiptId: randomUUID(),
              }
            : null;
        await c.query(
          'UPDATE hd_m5_tasks SET status=$3,cancel_receipt=$4,revision=revision+1,updated_at=now() WHERE school_id=$1 AND task_id=$2',
          [school, id, status, receipt],
        );
        await event(
          c,
          school,
          user,
          t.partner_id,
          id,
          t.revision + 1,
          'task_cancellation',
          {
            status,
            reason: input.reason,
            ...(guard?.delegationId ? { agentDelegationId: guard.delegationId } : {}),
          },
          user,
        );
        return view(await row(c, 'tasks', school, id));
      },
    );
  }
  return {
    business: { proposeTask, cancelTask, taskOwner, publicService, privateTask, view },
    issueReward,
    revokeReward,
    publishedSources,
    async reconcile(school) {
      const { rows } = await db.pool.query(
        `SELECT task_id FROM hd_m5_tasks WHERE school_id=$1 AND status IN ('queued','pending_confirmation','cancel_requested','cancel_pending') ORDER BY updated_at LIMIT 20`,
        [school],
      );
      const results = [];
      for (const t of rows) results.push(await processTask(school, t.task_id));
      return results;
    },
    async handle(req, res, { url, json, body }) {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'm5') return false;
      if (parts[1] !== 'schools' || !parts[2]) throw problem('route_missing', 404);
      const school = services.school(parts[2]).schoolId,
        user = (await identity.user(req)).user_id;
      await member(school, user);
      if (url.searchParams.has('userId') && url.searchParams.get('userId') !== user)
        throw problem('other_user_denied', 403);
      const resource = parts[3],
        id = parts[4],
        action = parts[5],
        route = url.pathname;
      const send = (result) => {
        json(res, 200, result);
        return true;
      };
      if (resource === 'status' && req.method === 'GET')
        return send({
          enabled: true,
          adapter: adapter.type,
          externalAdapterConfigured: adapter.type === 'http',
          fixtureOnly: adapter.type === 'local-fixture',
        });

      if (resource === 'partners') {
        if (req.method === 'POST' && id && action === 'edit') {
          const input = fields(
            await body(req),
            ['requestId', 'expectedRevision', 'name', 'category', 'description', 'validUntil'],
            'partner_edit',
          );
          text(input.name, 2, 100);
          text(input.category, 2, 80);
          text(input.description, 5, 3000);
          const acl = async (c) => {
            const p = await row(c, 'partners', school, id);
            await member(school, user, c);
            if (p.applicant_id !== user || !['pending', 'rejected'].includes(p.status))
              await staff(school, id, user, 'maintainer', c);
          };
          return send(
            await mutate(school, user, route, input, acl, async (c) => {
              const validUntil = future(input.validUntil);
              const p = await row(c, 'partners', school, id, true);
              compare(p, input.expectedRevision);
              if (p.status === 'withdrawn')
                throw problem('withdrawn_partner_requires_new_application', 409);
              await c.query(
                `UPDATE hd_m5_partners SET name=$3,category=$4,description=$5,valid_until=$6,status='pending',revision=revision+1,reviewed_by=NULL,review_reason=NULL WHERE school_id=$1 AND partner_id=$2`,
                [school, id, input.name, input.category, input.description, validUntil],
              );
              await event(
                c,
                school,
                user,
                id,
                id,
                p.revision + 1,
                'partner_edited',
                { status: 'pending' },
                p.applicant_id,
              );
              return view(await row(c, 'partners', school, id));
            }),
          );
        }
        if (req.method === 'GET' && !id) {
          const m = await member(school, user),
            { rows } = await db.pool.query(
              `SELECT DISTINCT p.* FROM hd_m5_partners p LEFT JOIN hd_m5_staff s USING(school_id,partner_id)
            WHERE p.school_id=$1 AND ($2 OR p.applicant_id=$3 OR (s.user_id=$3 AND s.active)) ORDER BY p.created_at`,
              [school, m.role === 'owner', user],
            );
          const permitted = [];
          for (const p of rows) {
            try {
              if (p.applicant_id !== user) await staff(school, p.partner_id, user, 'any');
              permitted.push(view(p));
            } catch {}
          }
          return send({ partners: permitted });
        }
        if (req.method === 'GET' && id && !action) {
          const p = await row(db.pool, 'partners', school, id);
          if (p.applicant_id !== user) await staff(school, id, user, 'any');
          const own = await staff(school, id, user, 'any')
            .then(() => true)
            .catch(() => false);
          return send({
            ...view(p),
            ...(own
              ? {
                  staff: (
                    await db.pool.query(
                      'SELECT user_id,role,active,revision FROM hd_m5_staff WHERE school_id=$1 AND partner_id=$2 ORDER BY user_id',
                      [school, id],
                    )
                  ).rows.map(view),
                }
              : {}),
          });
        }
        if (req.method === 'POST' && !id) {
          const input = fields(
            await body(req),
            ['requestId', 'name', 'category', 'description', 'validUntil', 'orgId'],
            'partner',
          );
          const name = text(input.name, 2, 100),
            category = text(input.category, 2, 80),
            description = text(input.description, 5, 3000);
          return send(
            await mutate(
              school,
              user,
              route,
              input,
              (c) => member(school, user, c),
              async (c) => {
                const validUntil = future(input.validUntil);
                if (input.orgId) {
                  if (!validId(input.orgId)) throw problem('organization_invalid');
                  await owner(school, user, c);
                  const o = await c.query(
                    `SELECT 1 FROM hd_organizations WHERE school_id=$1 AND org_id=$2 AND kind='partner' AND active`,
                    [school, input.orgId],
                  );
                  if (!o.rowCount) throw problem('partner_organization_required');
                }
                const partnerId = randomUUID();
                await c.query(
                  `INSERT INTO hd_m5_partners(school_id,partner_id,applicant_id,name,category,description,org_id,status,valid_until) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8)`,
                  [
                    school,
                    partnerId,
                    user,
                    name,
                    category,
                    description,
                    input.orgId || null,
                    validUntil,
                  ],
                );
                await event(
                  c,
                  school,
                  user,
                  partnerId,
                  partnerId,
                  1,
                  'partner_applied',
                  { status: 'pending' },
                  user,
                );
                return view(await row(c, 'partners', school, partnerId));
              },
            ),
          );
        }
        if (req.method === 'POST' && action === 'review') {
          const input = fields(
            await body(req),
            ['requestId', 'expectedRevision', 'decision', 'reason'],
            'partner_review',
          );
          if (!['approve', 'reject'].includes(input.decision))
            throw problem('review_decision_invalid');
          text(input.reason, 3, 500);
          return send(
            await mutate(
              school,
              user,
              route,
              input,
              (c) => owner(school, user, c),
              async (c) => {
                const p = await row(c, 'partners', school, id, true);
                compare(p, input.expectedRevision);
                if (p.status !== 'pending' || !nowValid(p.valid_until))
                  throw problem('partner_not_pending', 409);
                const status = input.decision === 'approve' ? 'approved' : 'rejected';
                await c.query(
                  'UPDATE hd_m5_partners SET status=$3,revision=revision+1,reviewed_by=$4,review_reason=$5 WHERE school_id=$1 AND partner_id=$2',
                  [school, id, status, user, input.reason],
                );
                if (status === 'approved')
                  await c.query(
                    `INSERT INTO hd_m5_staff(school_id,partner_id,user_id,role) VALUES($1,$2,$3,'maintainer') ON CONFLICT DO NOTHING`,
                    [school, id, p.applicant_id],
                  );
                await event(
                  c,
                  school,
                  user,
                  id,
                  id,
                  p.revision + 1,
                  'partner_reviewed',
                  { status, reason: input.reason },
                  p.applicant_id,
                );
                return view(await row(c, 'partners', school, id));
              },
            ),
          );
        }
        if (req.method === 'POST' && action === 'staff') {
          const input = fields(
            await body(req),
            ['requestId', 'expectedRevision', 'userId', 'role', 'active', 'reason'],
            'partner_staff',
          );
          if (
            !uuid(input.userId) ||
            !['maintainer', 'redeemer'].includes(input.role) ||
            typeof input.active !== 'boolean' ||
            !Number.isSafeInteger(input.expectedRevision) ||
            input.expectedRevision < 0
          )
            throw problem('staff_input_invalid');
          text(input.reason, 3, 500);
          return send(
            await mutate(
              school,
              user,
              route,
              input,
              (c) => owner(school, user, c),
              async (c) => {
                const p = await row(c, 'partners', school, id, true);
                await member(school, input.userId, c);
                if (p.status !== 'approved' || !nowValid(p.valid_until))
                  throw problem('partner_unavailable', 409);
                if (p.org_id && input.active) {
                  const o = await c.query(
                    `SELECT 1 FROM hd_org_members WHERE school_id=$1 AND org_id=$2 AND user_id=$3 AND active`,
                    [school, p.org_id, input.userId],
                  );
                  if (!o.rowCount) throw problem('partner_organization_denied', 403);
                }
                const old = (
                  await c.query(
                    'SELECT * FROM hd_m5_staff WHERE school_id=$1 AND partner_id=$2 AND user_id=$3 FOR UPDATE',
                    [school, id, input.userId],
                  )
                ).rows[0];
                if ((old?.revision || 0) !== input.expectedRevision)
                  throw problem('revision_conflict', 409);
                const r = (
                  await c.query(
                    `INSERT INTO hd_m5_staff(school_id,partner_id,user_id,role,active,revision) VALUES($1,$2,$3,$4,$5,1)
              ON CONFLICT(school_id,partner_id,user_id) DO UPDATE SET role=$4,active=$5,revision=hd_m5_staff.revision+1 RETURNING *`,
                    [school, id, input.userId, input.role, input.active],
                  )
                ).rows[0];
                await audit(c, school, user, 'partners.staff', id, {
                  userId: input.userId,
                  role: input.role,
                  active: input.active,
                  revision: r.revision,
                  reason: input.reason,
                });
                return view(r);
              },
            ),
          );
        }
        if (req.method === 'POST' && action === 'withdraw') {
          const input = fields(
            await body(req),
            ['requestId', 'expectedRevision', 'reason'],
            'partner_withdraw',
          );
          text(input.reason, 3, 500);
          return send(
            await mutate(
              school,
              user,
              route,
              input,
              (c) => staff(school, id, user, 'maintainer', c),
              async (c) => {
                const p = await row(c, 'partners', school, id, true);
                compare(p, input.expectedRevision);
                if (p.status === 'withdrawn') throw problem('partner_already_withdrawn', 409);
                await c.query(
                  `UPDATE hd_m5_partners SET status='withdrawn',revision=revision+1,review_reason=$3 WHERE school_id=$1 AND partner_id=$2`,
                  [school, id, input.reason],
                );
                const { rows } = await c.query(
                  `UPDATE hd_m5_entitlements SET status='revoked',revision=revision+1,revoked_reason=$3 WHERE school_id=$1 AND partner_id=$2 AND status='issued' AND terms->>'withdrawalPolicy'='revoke' RETURNING *`,
                  [school, id, input.reason],
                );
                for (const e of rows)
                  await event(
                    c,
                    school,
                    user,
                    id,
                    e.entitlement_id,
                    e.revision,
                    'entitlement_revoked',
                    { status: 'revoked', reason: input.reason },
                    e.user_id,
                  );
                const { rows: honored } = await c.query(
                  `SELECT entitlement_id,user_id,revision FROM hd_m5_entitlements WHERE school_id=$1 AND partner_id=$2 AND status='issued'`,
                  [school, id],
                );
                for (const e of honored)
                  await notify(
                    c,
                    school,
                    e.user_id,
                    `${school}:partner-withdrawal:${id}:${e.entitlement_id}`,
                    {
                      type: 'partner-withdrawal',
                      partnerId: id,
                      entitlementId: e.entitlement_id,
                      policy: 'honor',
                      reason: input.reason,
                    },
                  );
                await event(
                  c,
                  school,
                  user,
                  id,
                  id,
                  p.revision + 1,
                  'partner_withdrawn',
                  { status: 'withdrawn', reason: input.reason },
                  p.applicant_id,
                );
                return {
                  ...view(await row(c, 'partners', school, id)),
                  revokedEntitlements: rows.length,
                  honoredEntitlements: honored.length,
                };
              },
            ),
          );
        }
        if (req.method === 'GET' && action === 'metrics') {
          await staff(school, id, user, 'maintainer');
          const metrics = (
            await db.pool.query(
              'SELECT kind,count(*)::int AS count FROM hd_m5_metrics WHERE school_id=$1 AND partner_id=$2 GROUP BY kind ORDER BY kind',
              [school, id],
            )
          ).rows;
          const states = (
            await db.pool.query(
              `SELECT CASE WHEN status='issued' AND valid_until<=now() THEN 'expired' ELSE status END AS status,count(*)::int AS count FROM hd_m5_entitlements WHERE school_id=$1 AND partner_id=$2 GROUP BY 1 ORDER BY 1`,
              [school, id],
            )
          ).rows;
          return send({
            partnerId: id,
            definition:
              'Unique actor/object/kind/calendar-day for exposure and consultation; business receipt based claim/redemption; current entitlement status counts.',
            metrics,
            entitlements: states,
          });
        }
        if (req.method === 'GET' && action === 'tasks') {
          await staff(school, id, user, 'maintainer');
          return send({
            tasks: (
              await db.pool.query(
                `SELECT * FROM hd_m5_tasks WHERE school_id=$1 AND partner_id=$2 AND consent IS NOT NULL AND status<>'proposed' ORDER BY created_at DESC LIMIT 100`,
                [school, id],
              )
            ).rows.map(view),
          });
        }
      }

      if (resource === 'directory' && req.method === 'GET')
        return send({ sources: await publishedSources(school) });
      if (resource === 'services') {
        if (req.method === 'GET' && !id) {
          const p = url.searchParams.get('partnerId');
          await staff(school, p, user, 'maintainer');
          return send({
            services: (
              await db.pool.query(
                'SELECT * FROM hd_m5_services WHERE school_id=$1 AND partner_id=$2 ORDER BY service_id',
                [school, p],
              )
            ).rows.map(view),
          });
        }
        if (req.method === 'GET' && id) return send(view(await publicService(db.pool, school, id)));
        if (req.method === 'POST' && (!id || action === 'edit')) {
          const input = fields(
            await body(req),
            [
              'requestId',
              'expectedRevision',
              'partnerId',
              'title',
              'description',
              'conditions',
              'hours',
              'officialUrl',
              'sceneId',
              'entityId',
              'validUntil',
            ],
            'service',
          );
          if (!uuid(input.partnerId)) throw problem('partner_id_invalid');
          text(input.title, 2, 160);
          text(input.description, 5, 5000);
          text(input.conditions, 2, 2000);
          text(input.hours, 2, 300);
          const urlValue = officialUrl(input.officialUrl);
          if (
            (input.sceneId && !validId(input.sceneId)) ||
            (input.entityId && !validId(input.entityId)) ||
            Boolean(input.sceneId) !== Boolean(input.entityId)
          )
            throw problem('location_invalid');
          if (!locationValid(school, input.sceneId, input.entityId))
            throw problem('public_service_location_required');
          return send(
            await mutate(
              school,
              user,
              route,
              input,
              (c) => staff(school, input.partnerId, user, 'maintainer', c),
              async (c) => {
                const validUntil = future(input.validUntil);
                await partnerActive(c, school, input.partnerId, true);
                const serviceId = id || randomUUID();
                let old;
                if (id) {
                  old = await row(c, 'services', school, id, true);
                  if (old.partner_id !== input.partnerId)
                    throw problem('partner_scope_denied', 403);
                  compare(old, input.expectedRevision);
                }
                await c.query(
                  `INSERT INTO hd_m5_services(school_id,service_id,partner_id,title,description,conditions,hours,official_url,scene_id,entity_id,status,valid_until)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11) ON CONFLICT(school_id,service_id) DO UPDATE SET title=$4,description=$5,conditions=$6,hours=$7,official_url=$8,scene_id=$9,entity_id=$10,status='pending',valid_until=$11,revision=hd_m5_services.revision+1,reviewed_by=NULL,review_reason=NULL`,
                  [
                    school,
                    serviceId,
                    input.partnerId,
                    input.title,
                    input.description,
                    input.conditions,
                    input.hours,
                    urlValue,
                    input.sceneId || null,
                    input.entityId || null,
                    validUntil,
                  ],
                );
                await event(
                  c,
                  school,
                  user,
                  input.partnerId,
                  serviceId,
                  (old?.revision || 0) + 1,
                  'service_submitted',
                  { status: 'pending' },
                );
                return view(await row(c, 'services', school, serviceId));
              },
            ),
          );
        }
        if (req.method === 'POST' && action === 'exposure') {
          const input = fields(await body(req), ['requestId'], 'exposure');
          return send(
            await mutate(
              school,
              user,
              route,
              input,
              async (c) => {
                await ordinary(school, user, c);
                await publicService(c, school, id);
              },
              async (c) => {
                const s = await publicService(c, school, id);
                await metric(c, school, s.partner_id, 'exposure', user, id);
                return { recorded: true, serviceId: id };
              },
            ),
          );
        }
      }

      if (
        ['services', 'offers'].includes(resource) &&
        req.method === 'POST' &&
        ['review', 'withdraw'].includes(action)
      ) {
        const input = fields(
          await body(req),
          ['requestId', 'expectedRevision', 'decision', 'reason'],
          'publication',
        );
        text(input.reason, 3, 500);
        if (action === 'review' && !['publish', 'reject'].includes(input.decision))
          throw problem('review_decision_invalid');
        const acl = async (c) => {
          const x = await row(c, resource, school, id);
          if (action === 'review') await owner(school, user, c);
          else await staff(school, x.partner_id, user, 'maintainer', c);
        };
        return send(
          await mutate(school, user, route, input, acl, async (c) => {
            const x = await row(c, resource, school, id, true);
            compare(x, input.expectedRevision);
            if (action === 'review') {
              await partnerActive(c, school, x.partner_id);
              if (x.status !== 'pending' || !nowValid(x.valid_until))
                throw problem('publication_not_pending', 409);
            }
            if (action === 'withdraw' && x.status === 'withdrawn')
              throw problem('already_withdrawn', 409);
            const status =
              action === 'withdraw'
                ? 'withdrawn'
                : input.decision === 'publish'
                  ? 'published'
                  : 'rejected';
            await c.query(
              `UPDATE hd_m5_${resource} SET status=$3,revision=revision+1,reviewed_by=$4,review_reason=$5 WHERE school_id=$1 AND ${resource === 'services' ? 'service' : 'offer'}_id=$2`,
              [school, id, status, user, input.reason],
            );
            await event(
              c,
              school,
              user,
              x.partner_id,
              id,
              x.revision + 1,
              `${resource.slice(0, -1)}_${status}`,
              { status, reason: input.reason },
            );
            return view(await row(c, resource, school, id));
          }),
        );
      }

      if (resource === 'tasks') {
        if (req.method === 'GET' && !id)
          return send({
            tasks: (
              await db.pool.query(
                'SELECT * FROM hd_m5_tasks WHERE school_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100',
                [school, user],
              )
            ).rows.map(view),
          });
        if (req.method === 'GET' && id)
          return send(view(await privateTask(db.pool, school, user, id)));
        if (req.method === 'POST' && !id)
          return send(await proposeTask(school, user, await body(req)));
        if (req.method === 'POST' && action === 'confirm') {
          const input = fields(
            await body(req),
            ['requestId', 'expectedRevision', 'confirmed', 'consentFields'],
            'task_confirm',
          );
          if (input.confirmed !== true || !Array.isArray(input.consentFields))
            throw problem('explicit_consent_required');
          const result = await mutate(
            school,
            user,
            route,
            input,
            (c) => taskOwner(c, school, user, id),
            async (c) => {
              const t = await row(c, 'tasks', school, id, true);
              compare(t, input.expectedRevision);
              if (!['proposed', 'adapter_unavailable'].includes(t.status))
                throw problem('task_not_awaiting_confirmation', 409);
              const s = await publicService(c, school, t.service_id);
              if (s.revision !== t.source_revision) throw problem('service_revision_changed', 409);
              const keys = Object.keys(t.request).sort();
              if (canonical([...new Set(input.consentFields)].sort()) !== canonical(keys))
                throw problem('consent_fields_mismatch');
              const consent = {
                actorId: user,
                partnerId: t.partner_id,
                purpose: t.kind,
                fields: keys,
                sourceRevision: t.source_revision,
                confirmedAt: new Date().toISOString(),
              };
              const status = configured ? 'queued' : 'adapter_unavailable';
              await c.query(
                'UPDATE hd_m5_tasks SET status=$3,consent=$4,revision=revision+1,updated_at=now() WHERE school_id=$1 AND task_id=$2',
                [school, id, status, consent],
              );
              await metric(c, school, t.partner_id, 'consultation', user, id);
              await event(
                c,
                school,
                user,
                t.partner_id,
                id,
                t.revision + 1,
                'task_authorized',
                { status, sharedFields: keys },
                user,
              );
              return view(await row(c, 'tasks', school, id));
            },
          );
          return send(result);
        }
        if (req.method === 'POST' && action === 'cancel')
          return send(await cancelTask(school, user, id, await body(req)));
        if (req.method === 'POST' && action === 'reconcile') {
          fields(await body(req), [], 'reconcile');
          await privateTask(db.pool, school, user, id);
          await processTask(school, id);
          return send(view(await privateTask(db.pool, school, user, id)));
        }
      }

      if (resource === 'offers') {
        if (req.method === 'GET' && !id) {
          const partner = url.searchParams.get('partnerId'),
            manage = url.searchParams.get('manage') === 'true';
          if (manage) await staff(school, partner, user, 'maintainer');
          const { rows } = await db.pool.query(
            `SELECT o.* FROM hd_m5_offers o JOIN hd_m5_partners p USING(school_id,partner_id) WHERE o.school_id=$1
            AND ($2::uuid IS NULL OR o.partner_id=$2) AND ($3 OR (o.status='published' AND o.valid_until>now() AND p.status='approved' AND p.valid_until>now())) ORDER BY o.offer_id`,
            [school, partner || null, manage],
          );
          return send({ offers: rows.map(view) });
        }
        if (req.method === 'POST' && (!id || action === 'edit')) {
          const input = fields(
            await body(req),
            [
              'requestId',
              'expectedRevision',
              'partnerId',
              'title',
              'terms',
              'stock',
              'minContribution',
              'contributionPeriod',
              'orgId',
              'withdrawalPolicy',
              'validUntil',
            ],
            'offer',
          );
          if (
            !uuid(input.partnerId) ||
            !Number.isSafeInteger(input.stock) ||
            input.stock < 1 ||
            input.stock > 1000000 ||
            !Number.isSafeInteger(input.minContribution) ||
            input.minContribution < 0 ||
            input.minContribution > 1000000 ||
            !['honor', 'revoke'].includes(input.withdrawalPolicy)
          )
            throw problem('offer_invalid');
          text(input.title, 2, 160);
          text(input.terms, 5, 3000);
          if (input.contributionPeriod && !validId(input.contributionPeriod))
            throw problem('contribution_period_invalid');
          return send(
            await mutate(
              school,
              user,
              route,
              input,
              (c) => staff(school, input.partnerId, user, 'maintainer', c),
              async (c) => {
                const validUntil = future(input.validUntil);
                await partnerActive(c, school, input.partnerId, true);
                const offerId = id || randomUUID();
                let old;
                if (input.orgId) {
                  if (!validId(input.orgId)) throw problem('organization_invalid');
                  const o = await c.query(
                    'SELECT 1 FROM hd_organizations WHERE school_id=$1 AND org_id=$2 AND active',
                    [school, input.orgId],
                  );
                  if (!o.rowCount) throw problem('organization_invalid');
                }
                if (id) {
                  old = await row(c, 'offers', school, id, true);
                  if (old.partner_id !== input.partnerId)
                    throw problem('partner_scope_denied', 403);
                  compare(old, input.expectedRevision);
                  if (input.stock < old.issued) throw problem('stock_below_issued', 409);
                }
                await c.query(
                  `INSERT INTO hd_m5_offers(school_id,offer_id,partner_id,title,terms,stock,min_contribution,contribution_period,org_id,withdrawal_policy,valid_until,status)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending') ON CONFLICT(school_id,offer_id) DO UPDATE SET title=$4,terms=$5,stock=$6,min_contribution=$7,contribution_period=$8,org_id=$9,withdrawal_policy=$10,valid_until=$11,status='pending',revision=hd_m5_offers.revision+1,reviewed_by=NULL,review_reason=NULL`,
                  [
                    school,
                    offerId,
                    input.partnerId,
                    input.title,
                    input.terms,
                    input.stock,
                    input.minContribution,
                    input.contributionPeriod || null,
                    input.orgId || null,
                    input.withdrawalPolicy,
                    validUntil,
                  ],
                );
                await event(
                  c,
                  school,
                  user,
                  input.partnerId,
                  offerId,
                  (old?.revision || 0) + 1,
                  'offer_submitted',
                  { status: 'pending' },
                );
                return view(await row(c, 'offers', school, offerId));
              },
            ),
          );
        }
        if (req.method === 'POST' && action === 'claim') {
          const input = fields(
            await body(req),
            ['requestId', 'expectedRevision', 'acceptedTerms'],
            'claim',
          );
          if (input.acceptedTerms !== true) throw problem('offer_terms_consent_required');
          return send(
            await mutate(
              school,
              user,
              route,
              input,
              (c) => ordinary(school, user, c),
              async (c) => {
                const o = await row(c, 'offers', school, id, true);
                compare(o, input.expectedRevision);
                await partnerActive(c, school, o.partner_id);
                if (o.status !== 'published' || !nowValid(o.valid_until))
                  throw problem('offer_unavailable', 409);
                if (o.issued >= o.stock) throw problem('offer_sold_out', 409);
                if (
                  (
                    await c.query(
                      'SELECT 1 FROM hd_m5_entitlements WHERE school_id=$1 AND offer_id=$2 AND user_id=$3',
                      [school, id, user],
                    )
                  ).rowCount
                )
                  throw problem('offer_already_claimed', 409);
                if (
                  o.org_id &&
                  !(
                    await c.query(
                      `SELECT 1 FROM hd_org_members m JOIN hd_organizations g USING(school_id,org_id) WHERE m.school_id=$1 AND m.org_id=$2 AND m.user_id=$3 AND m.active AND g.active`,
                      [school, o.org_id, user],
                    )
                  ).rowCount
                )
                  throw problem('offer_eligibility_denied', 403);
                const score = Number(
                  (
                    await c.query(
                      'SELECT COALESCE(sum(delta),0) AS score FROM hd_contributions WHERE school_id=$1 AND user_id=$2 AND ($3::text IS NULL OR period=$3)',
                      [school, user, o.contribution_period],
                    )
                  ).rows[0].score,
                );
                if (score < o.min_contribution)
                  throw problem('contribution_eligibility_denied', 403);
                const entitlementId = randomUUID(),
                  token = randomBytes(32).toString('base64url'),
                  terms = {
                    title: o.title,
                    terms: o.terms,
                    offerRevision: o.revision,
                    withdrawalPolicy: o.withdrawal_policy,
                    minContribution: o.min_contribution,
                    contributionPeriod: o.contribution_period,
                    orgId: o.org_id,
                  };
                await c.query(
                  `INSERT INTO hd_m5_entitlements(school_id,entitlement_id,partner_id,offer_id,user_id,token,status,valid_until,terms) VALUES($1,$2,$3,$4,$5,$6,'issued',$7,$8)`,
                  [school, entitlementId, o.partner_id, id, user, token, o.valid_until, terms],
                );
                await c.query(
                  'UPDATE hd_m5_offers SET issued=issued+1 WHERE school_id=$1 AND offer_id=$2',
                  [school, id],
                );
                await metric(c, school, o.partner_id, 'claim', user, entitlementId);
                await event(
                  c,
                  school,
                  user,
                  o.partner_id,
                  entitlementId,
                  1,
                  'entitlement_issued',
                  { status: 'issued', offerId: id },
                  user,
                );
                return view(await row(c, 'entitlements', school, entitlementId));
              },
            ),
          );
        }
      }
      if (resource === 'entitlements') {
        if (req.method === 'GET' && !id) {
          const { rows } = await db.pool.query(
            'SELECT * FROM hd_m5_entitlements WHERE school_id=$1 AND user_id=$2 ORDER BY created_at DESC',
            [school, user],
          );
          return send({
            entitlements: rows.map((r) => ({
              ...view(r),
              effectiveStatus:
                r.status === 'issued' && !nowValid(r.valid_until) ? 'expired' : r.status,
            })),
          });
        }
        if (req.method === 'POST' && action === 'redeem') {
          const input = fields(
            await body(req),
            ['requestId', 'expectedRevision', 'partnerId', 'token'],
            'redeem',
          );
          if (typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.token))
            throw problem('voucher_invalid');
          return send(
            await mutate(
              school,
              user,
              route,
              input,
              (c) => staff(school, input.partnerId, user, 'redeemer', c),
              async (c) => {
                const e = await row(c, 'entitlements', school, id, true);
                compare(e, input.expectedRevision);
                if (e.partner_id !== input.partnerId || e.token !== input.token)
                  throw problem('voucher_scope_denied', 403);
                if (e.status !== 'issued' || !nowValid(e.valid_until))
                  throw problem('voucher_unavailable', 409);
                const p = await row(c, 'partners', school, input.partnerId);
                if (
                  p.status !== 'approved' &&
                  !(p.status === 'withdrawn' && e.terms.withdrawalPolicy === 'honor')
                )
                  throw problem('partner_unavailable', 409);
                await c.query(
                  `UPDATE hd_m5_entitlements SET status='redeemed',revision=revision+1,redeemed_by=$3,redeemed_at=now() WHERE school_id=$1 AND entitlement_id=$2`,
                  [school, id, user],
                );
                await metric(c, school, e.partner_id, 'redemption', e.user_id, id);
                await event(
                  c,
                  school,
                  user,
                  e.partner_id,
                  id,
                  e.revision + 1,
                  'entitlement_redeemed',
                  { status: 'redeemed' },
                  e.user_id,
                );
                return {
                  entitlementId: id,
                  partnerId: e.partner_id,
                  status: 'redeemed',
                  revision: e.revision + 1,
                  receiptId: `${school}:base-partners:${id}:${e.revision + 1}`,
                };
              },
            ),
          );
        }
        if (req.method === 'POST' && action === 'revoke') {
          const input = fields(
            await body(req),
            ['requestId', 'expectedRevision', 'reason'],
            'revoke',
          );
          text(input.reason, 3, 500);
          return send(
            await mutate(
              school,
              user,
              route,
              input,
              (c) => owner(school, user, c),
              async (c) => {
                const e = await row(c, 'entitlements', school, id, true);
                compare(e, input.expectedRevision);
                if (e.status !== 'issued') throw problem('voucher_unavailable', 409);
                await c.query(
                  `UPDATE hd_m5_entitlements SET status='revoked',revision=revision+1,revoked_reason=$3 WHERE school_id=$1 AND entitlement_id=$2`,
                  [school, id, input.reason],
                );
                await event(
                  c,
                  school,
                  user,
                  e.partner_id,
                  id,
                  e.revision + 1,
                  'entitlement_revoked',
                  { status: 'revoked', reason: input.reason },
                  e.user_id,
                );
                return { entitlementId: id, status: 'revoked', revision: e.revision + 1 };
              },
            ),
          );
        }
      }
      throw problem('route_missing', 404);
    },
  };
}
