import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, problem } from './db.mjs';
export const equal = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function request(url, { headers = {}, ...opts } = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...headers },
    signal: AbortSignal.timeout(10000),
  });
  const data = await r.json();
  if (!r.ok) throw problem('upstream_' + (data.error || data.code || r.status), r.status);
  return data;
}
export function createServices(db, config) {
  const school = (id) => {
    const s = config.schools.find((s) => s.schoolId === id);
    if (!s) throw problem('school_missing', 404);
    return s;
  };
  const ticket = async (schoolId, userId, purpose) => {
    await db.member(schoolId, userId);
    const t = randomBytes(32).toString('base64url');
    await db.pool.query("INSERT INTO hd_tickets VALUES($1,$2,$3,$4,now()+interval '30 seconds')", [
      hash(t),
      schoolId,
      userId,
      purpose,
    ]);
    return t;
  };
  const mapping = async (s, u, system, id) => {
    const {
      rows: [r],
    } = await db.pool.query(
      `INSERT INTO hd_identities VALUES($1,$2,$3,$4) ON CONFLICT(school_id,user_id,system)
      DO UPDATE SET external_id=hd_identities.external_id RETURNING *`,
      [s, u, system, String(id)],
    );
    if (r.external_id !== String(id)) throw problem('identity_mapping_conflict', 409);
  };
  const forum = (s, path, data) =>
    request(s.forumUrl + '/api/hd/' + path, {
      method: 'POST',
      headers: { 'X-HD-Service-Key': s.forumKey },
      body: JSON.stringify(data),
    });
  return {
    school,
    ticket,
    mapping,
    forum,
    service(req, purpose) {
      const s = config.schools.find((s) =>
        equal(req.headers['x-hd-service-key'], purpose === 'forum' ? s.forumKey : s.nakamaKey),
      );
      if (!s) throw problem('service_denied', 403);
      return s;
    },
    async consume(s, t, purpose) {
      const {
        rows: [row],
      } = await db.pool.query(
        'DELETE FROM hd_tickets WHERE token_hash=$1 AND school_id=$2 AND purpose=$3 AND expires_at>now() RETURNING *',
        [hash(t || ''), s.schoolId, purpose],
      );
      if (!row) throw problem('ticket_invalid', 401);
      const m = await db.member(s.schoolId, row.user_id);
      return { schoolId: s.schoolId, userId: row.user_id, role: m.role, revision: m.revision };
    },
    async social(s, u) {
      const t = await ticket(s.schoolId, u, 'nakama');
      const session = await request(s.nakamaUrl + '/v2/account/authenticate/custom?create=true', {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(s.nakamaServerKey + ':').toString('base64'),
        },
        body: JSON.stringify({ id: u, vars: { ticket: t } }),
      });
      const nkId = JSON.parse(Buffer.from(session.token.split('.')[1], 'base64url')).uid;
      await mapping(s.schoolId, u, 'nakama', nkId);
      return { session, nakamaId: nkId };
    },
    async project(row) {
      const s = school(row.school_id);
      const {
        rows: [m],
      } = await db.pool.query(
        `SELECT external_id FROM hd_identities WHERE school_id=$1 AND user_id=$2 AND system='nakama'`,
        [s.schoolId, row.user_id],
      );
      const nkId = m?.external_id || (await this.social(s, row.user_id)).nakamaId;
      return request(
        s.nakamaUrl + '/v2/rpc/hd_project?http_key=' + encodeURIComponent(s.nakamaHttpKey),
        {
          method: 'POST',
          body: JSON.stringify(
            JSON.stringify({
              key: s.nakamaKey,
              userId: nkId,
              period: row.period,
              score: row.score,
              version: row.version,
            }),
          ),
        },
      );
    },
  };
}
