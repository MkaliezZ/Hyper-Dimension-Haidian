import { problem } from './db.mjs';
export const validId = (v) =>
  typeof v === 'string' &&
  /^[a-zA-Z0-9._:-]{1,128}$/.test(v) &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
export async function scope(db, school, user, org, action = 'read', c = db.pool) {
  const m = await db.member(school, user, null, c);
  if (!org) {
    if (['partner', 'affiliate'].includes(m.role)) throw problem('school_scope_denied', 403);
    if (action === 'manage' && m.role !== 'owner') throw problem('school_owner_required', 403);
    if (action === 'moderate' && !['owner', 'moderator'].includes(m.role))
      throw problem('moderation_denied', 403);
    return m;
  }
  const {
    rows: [o],
  } = await c.query('SELECT * FROM hd_organizations WHERE school_id=$1 AND org_id=$2 AND active', [
    school,
    org,
  ]);
  if (!o) throw problem('organization_denied', 403);
  if (m.role === 'owner') return { ...m, orgId: org };
  const {
    rows: [r],
  } = await c.query(
    'SELECT * FROM hd_org_members WHERE school_id=$1 AND org_id=$2 AND user_id=$3 AND active',
    [school, org, user],
  );
  if (!r) throw problem('organization_denied', 403);
  if (action === 'manage' && r.role !== 'owner') throw problem('organization_owner_required', 403);
  if (action === 'moderate' && !['owner', 'moderator'].includes(r.role))
    throw problem('moderation_denied', 403);
  return { ...r, orgId: org };
}
export async function audit(c, school, actor, action, object, detail) {
  await c.query(
    'INSERT INTO hd_audit(school_id,actor_id,action,object_id,detail,actor_kind) VALUES($1,$2,$3,$4,$5,$6)',
    [school, actor, action, object, detail, actor ? 'human' : detail.actorKind],
  );
}
