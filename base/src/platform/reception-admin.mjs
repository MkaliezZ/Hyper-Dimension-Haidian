import { problem } from './db.mjs';
import { scope, audit } from './permissions.mjs';
import { fields } from '../protocol/index.mjs';

export function createReceptionAdmin(db, identity, services, { getSessions }) {
  return async function handle(req, res, { url, json, body }) {
    const p = url.pathname.split('/').filter(Boolean);
    if (p[0] !== 'reception-admin') return false;
    if (p[1] !== 'schools' || !p[2] || p.length !== 4 || !['GET', 'POST'].includes(req.method))
      throw problem('route_missing', 404);
    const s = services.school(p[2]),
      user = (await identity.user(req)).user_id,
      manager = getSessions();
    if (!manager) throw problem('reception_not_ready', 503);
    const authorize =
      (action, detail = {}) =>
      async (c) => {
        await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
          s.schoolId + ':permissions',
        ]);
        await scope(db, s.schoolId, user, null, action, c);
        if (req.method === 'POST')
          await audit(c, s.schoolId, user, 'reception.' + p[3], s.spaceId, detail);
      };
    if (req.method === 'GET' && p[3] === 'status') {
      json(res, 200, await manager.admin(s.spaceId, authorize('moderate')));
      return true;
    }
    if (req.method !== 'POST' || !['policy', 'expire'].includes(p[3]))
      throw problem('route_missing', 404);
    const b = fields(
      await body(req),
      p[3] === 'policy'
        ? ['requestId', 'expectedRevision', 'policy', 'reason']
        : ['requestId', 'reason'],
      'reception_admin',
    );
    if (typeof b.reason !== 'string' || b.reason.trim().length < 3 || b.reason.length > 1000)
      throw problem('reason_required');
    if (typeof b.requestId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(b.requestId))
      throw problem('request_id_required');
    if (p[3] === 'policy') {
      json(
        res,
        200,
        await manager.setPolicy(
          s.spaceId,
          b.policy,
          b.expectedRevision,
          authorize('manage', { reason: b.reason, requestId: b.requestId }),
          { requestId: b.requestId, actorId: user },
        ),
      );
      return true;
    }
    if (p[3] === 'expire') {
      json(
        res,
        200,
        await manager.expire(
          s.spaceId,
          authorize('moderate', { reason: b.reason, requestId: b.requestId }),
        ),
      );
      return true;
    }
    throw problem('route_missing', 404);
  };
}
