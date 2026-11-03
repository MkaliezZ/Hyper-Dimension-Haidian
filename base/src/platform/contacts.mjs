import { randomUUID } from 'node:crypto';
import { hash, problem } from './db.mjs';
import { scope, audit, validId } from './permissions.mjs';
import { canonical, fields } from '../protocol/index.mjs';

const uuid = (v) =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const pair = (user, peer) => {
  if (!uuid(peer) || !uuid(user) || user === peer) throw problem('contact_peer_invalid');
  return [user, peer].sort();
};
const revision = (v) => {
  if (!Number.isSafeInteger(v) || v < 0) throw problem('contact_revision_required');
  return v;
};
export async function contactPreference(db, school, user, c = db.pool) {
  const r = (
    await c.query('SELECT * FROM hd_contact_preferences WHERE school_id=$1 AND user_id=$2', [
      school,
      user,
    ])
  ).rows[0];
  return {
    acceptingContacts: r?.accepting_contacts ?? true,
    allowDirectMessages: r?.allow_direct_messages ?? true,
    revision: r?.revision || 0,
  };
}
export async function contactPermission(db, school, user, peer, org = null, c = db.pool) {
  const [low, high] = pair(user, peer);
  await scope(db, school, user, org, 'read', c);
  await scope(db, school, peer, org, 'read', c);
  const r = (
    await c.query(
      'SELECT * FROM hd_contact_permissions WHERE school_id=$1 AND org_key=$2 AND user_low=$3 AND user_high=$4',
      [school, org || '', low, high],
    )
  ).rows[0];
  const blocked =
    (
      await c.query(
        'SELECT 1 FROM hd_chat_blocks WHERE school_id=$1 AND ((user_id=$2 AND blocked_id=$3) OR (user_id=$3 AND blocked_id=$2))',
        [school, low, high],
      )
    ).rowCount > 0;
  const a = await contactPreference(db, school, user, c),
    b = await contactPreference(db, school, peer, c);
  const reason = blocked
    ? 'contact_blocked'
    : !a.allowDirectMessages || !b.allowDirectMessages
      ? 'contact_messages_disabled'
      : r?.status !== 'accepted'
        ? 'contact_consent_required'
        : null;
  return {
    peerId: peer,
    orgId: org || null,
    contactId: r?.contact_id || null,
    status: r?.status || 'none',
    revision: r?.revision || 0,
    requestedBy: r?.requested_by || null,
    canSend: !reason,
    reason,
    canRequest:
      !blocked &&
      a.acceptingContacts &&
      b.acceptingContacts &&
      a.allowDirectMessages &&
      b.allowDirectMessages &&
      !['pending', 'accepted'].includes(r?.status),
    canAccept:
      !blocked &&
      a.acceptingContacts &&
      b.acceptingContacts &&
      a.allowDirectMessages &&
      b.allowDirectMessages &&
      r?.status === 'pending' &&
      r.requested_by !== user,
  };
}
export async function assertContactConsent(db, school, user, peer, org = null, c = db.pool) {
  const p = await contactPermission(db, school, user, peer, org, c);
  if (!p.canSend) throw problem(p.reason, 403);
  return p;
}
// Holding a school permission lock through bounded native writes prevents disclosure after
// a revoke commits. Every transaction uses this same connection, avoiding pool-lock deadlocks.
export async function withContactGuard(db, school, fn) {
  const c = await db.pool.connect();
  let locked = false;
  const tx = async (work) => {
    await c.query('BEGIN');
    try {
      const r = await work(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  };
  try {
    await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [school + ':permissions']);
    locked = true;
    return await fn(c, tx);
  } finally {
    try {
      if (locked)
        await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
          school + ':permissions',
        ]);
      c.release();
    } catch (e) {
      c.release(true);
      throw e;
    }
  }
}
export async function contactReceipt(c, school, user, path, input, work) {
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(input.requestId || '')) throw problem('request_id_required');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    school + ':' + user + ':' + input.requestId,
  ]);
  const fingerprint = hash(canonical({ path, input }));
  const old = (
    await c.query('SELECT * FROM hd_receipts WHERE school_id=$1 AND user_id=$2 AND request_id=$3', [
      school,
      user,
      input.requestId,
    ])
  ).rows[0];
  if (old) {
    if (old.input_hash !== fingerprint) throw problem('request_conflict', 409);
    return old.result;
  }
  const result = await work();
  await c.query('INSERT INTO hd_receipts VALUES($1,$2,$3,$4,$5)', [
    school,
    user,
    input.requestId,
    fingerprint,
    result,
  ]);
  return result;
}
export function createContacts(db, identity, services) {
  async function record(c, school, user, kind, r, other = null) {
    const id = r.contact_id || user,
      eventId = `contact:${school}:${id}:${r.revision}`;
    const envelope = {
      schema: 'hyper-dimension.event/v1',
      eventId,
      schoolId: school,
      source: { system: 'base-contacts', id, revision: r.revision },
      actor: { kind: 'human', userId: user },
      onBehalfOf: null,
      kind,
      visibility: 'participants',
      status: r.status || 'updated',
      occurredAt: new Date().toISOString(),
    };
    await c.query(
      'INSERT INTO hd_contact_events(event_id,school_id,contact_id,actor_id,kind,envelope) VALUES($1,$2,$3,$4,$5,$6)',
      [eventId, school, r.contact_id || null, user, kind, envelope],
    );
    await audit(c, school, user, 'contacts.' + kind, id, {
      revision: r.revision,
      status: r.status || 'updated',
      orgId: r.org_key || null,
    });
    // Only an object reference; never message bodies or any public knowledge publication.
    if (other)
      await c.query(
        'INSERT INTO hd_notifications(school_id,user_id,event_id,payload,scope_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [
          school,
          other,
          eventId,
          {
            type: 'contact-authorization',
            contactId: r.contact_id,
            status: r.status,
            orgId: r.org_key || null,
          },
          r.org_key || '',
        ],
      );
  }
  return async function handle(req, res, { url, json, body }) {
    const p = url.pathname.split('/').filter(Boolean);
    if (p[0] !== 'contacts' || p[1] !== 'schools') return false;
    if (!['GET', 'POST'].includes(req.method)) throw problem('method_denied', 405);
    const user = (await identity.user(req)).user_id,
      school = services.school(p[2]).schoolId;
    await db.member(school, user);
    const resource = p[3],
      id = p[4],
      action = p[5],
      route = url.pathname;
    const org = url.searchParams.get('org') || null;
    const send = (value) => {
      json(res, 200, value);
      return true;
    };
    if (req.method === 'GET' && resource === 'preferences' && p.length === 4)
      return send(await contactPreference(db, school, user));
    if (req.method === 'GET' && resource === 'state' && p.length === 4)
      return send(await contactPermission(db, school, user, url.searchParams.get('peerId'), org));
    if (req.method === 'GET' && resource === 'requests' && p.length === 4) {
      await scope(db, school, user, org);
      const { rows } = await db.pool.query(
        `SELECT r.*,u.display_name FROM hd_contact_permissions r
        JOIN hd_users u ON u.user_id=CASE WHEN r.user_low=$3 THEN r.user_high ELSE r.user_low END
        WHERE r.school_id=$1 AND r.org_key=$2 AND $3 IN (r.user_low,r.user_high) ORDER BY r.updated_at DESC LIMIT 200`,
        [school, org || '', user],
      );
      const contacts = [];
      for (const r of rows) {
        try {
          contacts.push({
            ...(await contactPermission(
              db,
              school,
              user,
              r.user_low === user ? r.user_high : r.user_low,
              org,
            )),
            name: r.display_name,
          });
        } catch (e) {
          if (e.status !== 403) throw e;
        }
      }
      await scope(db, school, user, org);
      return send({ contacts });
    }
    if (req.method !== 'POST') throw problem('contact_route_missing', 404);
    if (resource === 'preferences' && p.length === 4) {
      const b = fields(
        await body(req),
        ['requestId', 'expectedRevision', 'acceptingContacts', 'allowDirectMessages'],
        'contact_preference',
      );
      revision(b.expectedRevision);
      if (typeof b.acceptingContacts !== 'boolean' || typeof b.allowDirectMessages !== 'boolean')
        throw problem('contact_preference_invalid');
      return send(
        await db.tx(async (c) => {
          await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            school + ':permissions',
          ]);
          await db.member(school, user, null, c);
          return contactReceipt(c, school, user, route, b, async () => {
            const old = await contactPreference(db, school, user, c);
            if (old.revision !== b.expectedRevision) throw problem('revision_conflict', 409);
            const r = (
              await c.query(
                `INSERT INTO hd_contact_preferences(school_id,user_id,accepting_contacts,allow_direct_messages,revision)
            VALUES($1,$2,$3,$4,1) ON CONFLICT(school_id,user_id) DO UPDATE SET accepting_contacts=$3,allow_direct_messages=$4,revision=hd_contact_preferences.revision+1,updated_at=now() RETURNING *`,
                [school, user, b.acceptingContacts, b.allowDirectMessages],
              )
            ).rows[0];
            await record(c, school, user, 'preference_updated', r);
            return contactPreference(db, school, user, c);
          });
        }),
      );
    }
    if (
      resource !== 'requests' ||
      (id && (!uuid(id) || p.length !== 6 || !['accept', 'reject', 'revoke'].includes(action))) ||
      (!id && p.length !== 4)
    )
      throw problem('contact_route_missing', 404);
    const b = fields(
      await body(req),
      id ? ['requestId', 'expectedRevision'] : ['requestId', 'expectedRevision', 'peerId', 'orgId'],
      'contact_request',
    );
    revision(b.expectedRevision);
    if (!id && b.orgId && !validId(b.orgId)) throw problem('organization_invalid');
    return send(
      await db.tx(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          school + ':permissions',
        ]);
        let r;
        if (id) {
          r = (
            await c.query(
              'SELECT * FROM hd_contact_permissions WHERE school_id=$1 AND contact_id=$2',
              [school, id],
            )
          ).rows[0];
          if (!r || ![r.user_low, r.user_high].includes(user)) throw problem('contact_denied', 403);
        }
        const peer = id ? (r.user_low === user ? r.user_high : r.user_low) : b.peerId,
          scopeOrg = id ? r.org_key || null : b.orgId || null;
        let state;
        if (action === 'revoke') await scope(db, school, user, scopeOrg, 'read', c);
        else {
          state = await contactPermission(db, school, user, peer, scopeOrg, c);
          if (state.reason === 'contact_blocked') throw problem(state.reason, 403);
          if (action === 'accept' && state.status === 'accepted' && !state.canSend)
            throw problem(state.reason, 403);
          if (action === 'accept' && state.status !== 'accepted' && !state.canAccept)
            throw problem('contact_accept_denied', 403);
          if (!id && !state.canRequest && !['pending', 'accepted'].includes(state.status))
            throw problem('contact_requests_disabled', 403);
        }
        if (!id)
          r = (
            await c.query(
              'SELECT * FROM hd_contact_permissions WHERE school_id=$1 AND org_key=$2 AND user_low=$3 AND user_high=$4',
              [school, scopeOrg || '', ...pair(user, peer)],
            )
          ).rows[0];
        if (action === 'accept' && r.status === 'accepted' && r.requested_by === user)
          throw problem('contact_recipient_required', 403);
        return contactReceipt(c, school, user, route, b, async () => {
          if ((r?.revision || 0) !== b.expectedRevision) throw problem('revision_conflict', 409);
          let status;
          if (!id) {
            if (!state.canRequest) throw problem('contact_request_already_exists', 409);
            const count = (
              await c.query(
                "SELECT count(*)::int AS n FROM hd_contact_events WHERE school_id=$1 AND actor_id=$2 AND kind='requested' AND created_at>now()-interval '1 day'",
                [school, user],
              )
            ).rows[0].n;
            if (count >= 40) throw problem('contact_request_rate_limited', 429);
            status = 'pending';
          } else if (action === 'accept' || action === 'reject') {
            if (r.status !== 'pending' || r.requested_by === user)
              throw problem('contact_recipient_required', 403);
            status = action === 'accept' ? 'accepted' : 'rejected';
          } else {
            if (!['pending', 'accepted'].includes(r.status))
              throw problem('contact_not_active', 409);
            status = 'revoked';
          }
          const next = (
            await c.query(
              `INSERT INTO hd_contact_permissions(contact_id,school_id,org_key,user_low,user_high,requested_by,status,revision)
          VALUES($1,$2,$3,$4,$5,$6,$7,1) ON CONFLICT(school_id,org_key,user_low,user_high) DO UPDATE SET
          requested_by=$6,status=$7,revision=hd_contact_permissions.revision+1,updated_at=now() RETURNING *`,
              [
                r?.contact_id || randomUUID(),
                school,
                scopeOrg || '',
                ...pair(user, peer),
                !id ? user : r.requested_by,
                status,
              ],
            )
          ).rows[0];
          await record(c, school, user, !id ? 'requested' : status, next, peer);
          return {
            contactId: next.contact_id,
            orgId: scopeOrg,
            peerId: peer,
            status,
            revision: next.revision,
            requestedBy: next.requested_by,
          };
        });
      }),
    );
  };
}
