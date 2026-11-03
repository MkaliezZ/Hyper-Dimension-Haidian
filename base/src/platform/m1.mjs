import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hash, problem } from './db.mjs';
import { scope, audit, validId } from './permissions.mjs';
import { fields, digest } from '../protocol/index.mjs';
import { visibleNotifications, markNotificationRead } from './information.mjs';
export function createM1(db, identity, services, config, { reconcile, getStore }) {
  const cookie = (req, key) =>
    (req.headers.cookie || '')
      .split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith(key + '='))
      ?.slice(key.length + 1);
  return async (req, res, { url, json, body }) => {
    const p = url.pathname.split('/').filter(Boolean);
    if (p[0] !== 'm1') return false;
    if (!['GET', 'POST'].includes(req.method)) throw problem('method_denied', 405);
    if (p[1] === 'guest' && p[2] === 'prepare' && req.method === 'POST') {
      const raw = cookie(req, 'hd_base') || '',
        i = raw.lastIndexOf('.'),
        id = raw.slice(0, i),
        sig = raw.slice(i + 1);
      const access = JSON.parse(await readFile(config.dataDir + '/access.json', 'utf8'));
      const expected = createHmac('sha256', access.cookieSecret).update(id).digest('base64url');
      if (
        !/^visitor-[a-f0-9]{32}$/.test(id) ||
        sig.length !== expected.length ||
        !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      )
        throw problem('guest_proof_required', 403);
      const token = randomBytes(32).toString('base64url');
      await db.pool.query(
        "INSERT INTO hd_guest_claims(token_hash,guest_id,expires_at) VALUES($1,$2,now()+interval '5 minutes')",
        [hash(token), id],
      );
      json(res, 200, { claim: token, expiresIn: 300 });
      return true;
    }
    const u = await identity.user(req);
    if (p[1] === 'guest' && p[2] === 'bind' && req.method === 'POST') {
      const input = fields(await body(req), ['claim'], 'guest');
      const result = await getStore().combined(async (d, c) => {
        const {
          rows: [claim],
        } = await c.query(
          'SELECT * FROM hd_guest_claims WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',
          [hash(input.claim || '')],
        );
        if (!claim || claim.used_by) throw problem('guest_claim_invalid', 409);
        const spaces = new Set(
          Object.values(d.tasks)
            .filter((t) => t.owner === claim.guest_id)
            .map((t) => t.spaceId),
        );
        for (const task of Object.values(d.tasks).filter((t) => t.owner === claim.guest_id))
          for (const message of task.history || []) {
            const prior = d.a2aRequests?.[digest([u.user_id, task.agentId, message.messageId])];
            if (prior && prior.taskId !== task.id) throw problem('guest_receipt_collision', 409);
          }
        for (const sp of spaces) {
          const s = config.schools.find((x) => x.spaceId === sp);
          if (!s) throw problem('guest_scope_denied', 403);
          await db.member(s.schoolId, u.user_id, null, c);
        }
        const {
          rows: [old],
        } = await c.query('SELECT * FROM hd_guest_bindings WHERE guest_id=$1', [claim.guest_id]);
        if (old && old.user_id !== u.user_id) throw problem('guest_already_bound', 409);
        await c.query(
          'INSERT INTO hd_guest_bindings(guest_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [claim.guest_id, u.user_id],
        );
        await c.query('UPDATE hd_guest_claims SET used_by=$2 WHERE token_hash=$1', [
          claim.token_hash,
          u.user_id,
        ]);
        return { bound: true, guestId: claim.guest_id };
      });
      json(res, 200, result);
      return true;
    }
    if (p[1] === 'invitations' && p[2] === 'accept' && req.method === 'POST') {
      const b = fields(await body(req), ['token'], 'invitation');
      const result = await db.tx(async (c) => {
        const {
          rows: [i],
        } = await c.query('SELECT * FROM hd_invitations WHERE token_hash=$1 FOR UPDATE', [
          hash(b.token || ''),
        ]);
        if (!i || i.expires_at < Date.now() || i.accepted_by)
          throw problem('invitation_unavailable', 409);
        if (!u.email_verified || u.email !== i.email)
          throw problem('invitation_email_mismatch', 403);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          i.school_id + ':permissions',
        ]);
        await scope(db, i.school_id, i.created_by, i.org_id, 'manage', c);
        const existing = await c.query(
          i.org_id
            ? 'SELECT 1 FROM hd_org_members WHERE school_id=$1 AND org_id=$2 AND user_id=$3 FOR UPDATE'
            : 'SELECT 1 FROM hd_memberships WHERE school_id=$1 AND user_id=$2 FOR UPDATE',
          i.org_id ? [i.school_id, i.org_id, u.user_id] : [i.school_id, u.user_id],
        );
        if (existing.rowCount) throw problem('membership_exists_use_role_management', 409);
        await c.query(
          'INSERT INTO hd_memberships(school_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [
            i.school_id,
            u.user_id,
            i.org_id ? (i.role === 'partner' ? 'partner' : 'affiliate') : i.role,
          ],
        );
        if (i.org_id)
          await c.query(
            'INSERT INTO hd_org_members(school_id,org_id,user_id,role) VALUES($1,$2,$3,$4)',
            [i.school_id, i.org_id, u.user_id, i.role],
          );
        await c.query(
          'UPDATE hd_invitations SET accepted_by=$2,accepted_at=now() WHERE token_hash=$1',
          [i.token_hash, u.user_id],
        );
        await audit(c, i.school_id, u.user_id, 'invitation.accept', i.org_id || i.school_id, {
          role: i.role,
        });
        return { schoolId: i.school_id, organizationId: i.org_id, role: i.role };
      });
      json(res, 200, result);
      return true;
    }
    if (p[1] !== 'schools' || !p[2]) throw problem('route_missing', 404);
    const s = services.school(p[2]);
    await db.member(s.schoolId, u.user_id);
    const org = p[3] === 'organizations' && p[4] ? p[4] : null,
      action = org ? p[5] : p[3];
    if (p[3] === 'organizations' && !org) {
      if (req.method === 'GET') {
        const { rows } = await db.pool.query(
          `SELECT o.* FROM hd_organizations o WHERE o.school_id=$1 AND o.active AND (EXISTS(SELECT 1 FROM hd_memberships WHERE school_id=$1 AND user_id=$2 AND role='owner' AND active) OR EXISTS(SELECT 1 FROM hd_org_members m WHERE m.school_id=o.school_id AND m.org_id=o.org_id AND m.user_id=$2 AND m.active)) ORDER BY org_id`,
          [s.schoolId, u.user_id],
        );
        json(res, 200, { organizations: rows });
        return true;
      }
      const b = fields(await body(req), ['requestId', 'orgId', 'name', 'kind'], 'organization');
      if (
        !validId(b.orgId) ||
        typeof b.name !== 'string' ||
        b.name.length < 1 ||
        b.name.length > 120 ||
        !['student', 'partner'].includes(b.kind)
      )
        throw problem('invalid_organization');
      const r = await db.receipt(s.schoolId, u.user_id, b.requestId, b, async (c) => {
        await scope(db, s.schoolId, u.user_id, null, 'manage', c);
        await c.query(
          'INSERT INTO hd_organizations(school_id,org_id,name,kind) VALUES($1,$2,$3,$4)',
          [s.schoolId, b.orgId, b.name, b.kind],
        );
        await audit(c, s.schoolId, u.user_id, 'organization.create', b.orgId, { kind: b.kind });
        return { created: true, orgId: b.orgId };
      });
      json(res, 200, r);
      return true;
    }
    if (action !== 'notifications') await scope(db, s.schoolId, u.user_id, org);
    if (action === 'invitations' && req.method === 'POST') {
      const b = fields(await body(req), ['requestId', 'email', 'role'], 'invitation');
      if (
        typeof b.email !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) ||
        b.email.length > 254 ||
        !(org ? ['member', 'moderator', 'partner'] : ['student', 'moderator']).includes(b.role)
      )
        throw problem('invitation_invalid');
      const r = await db.receipt(s.schoolId, u.user_id, b.requestId, b, async (c) => {
        await scope(db, s.schoolId, u.user_id, org, 'manage', c);
        const token = randomBytes(32).toString('base64url');
        await c.query(
          "INSERT INTO hd_invitations VALUES($1,$2,$3,$4,$5,$6,now()+interval '48 hours',NULL,NULL)",
          [hash(token), s.schoolId, org, b.email.toLowerCase(), b.role, u.user_id],
        );
        await audit(c, s.schoolId, u.user_id, 'invitation.create', org || s.schoolId, {
          role: b.role,
        });
        return { token, expiresIn: 172800 };
      });
      json(res, 200, r);
      return true;
    }
    if (action === 'members') {
      await scope(db, s.schoolId, u.user_id, org, 'manage');
      if (req.method === 'GET') {
        const { rows } = await db.pool.query(
          org
            ? 'SELECT user_id,role,active,revision FROM hd_org_members WHERE school_id=$1 AND org_id=$2'
            : 'SELECT user_id,role,active,revision FROM hd_memberships WHERE school_id=$1',
          org ? [s.schoolId, org] : [s.schoolId],
        );
        json(res, 200, { members: rows });
        return true;
      }
      const b = fields(
        await body(req),
        ['requestId', 'userId', 'role', 'active', 'expectedRevision'],
        'member',
      );
      if (
        !/^[a-f0-9-]{36}$/.test(b.userId || '') ||
        typeof b.active !== 'boolean' ||
        !Number.isSafeInteger(b.expectedRevision) ||
        !(
          org
            ? ['member', 'moderator', 'owner', 'partner']
            : ['student', 'moderator', 'owner', 'partner', 'affiliate']
        ).includes(b.role)
      )
        throw problem('member_invalid');
      const r = await db.receipt(s.schoolId, u.user_id, b.requestId, b, async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          s.schoolId + ':permissions',
        ]);
        await scope(db, s.schoolId, u.user_id, org, 'manage', c);
        const table = org ? 'hd_org_members' : 'hd_memberships',
          where = org ? 'school_id=$1 AND user_id=$2 AND org_id=$3' : 'school_id=$1 AND user_id=$2',
          args = org ? [s.schoolId, b.userId, org] : [s.schoolId, b.userId];
        const {
          rows: [old],
        } = await c.query(`SELECT * FROM ${table} WHERE ${where} FOR UPDATE`, args);
        if (!old || old.revision !== b.expectedRevision)
          throw problem('membership_write_conflict', 409);
        if (old.role === 'owner' && old.active && (!b.active || b.role !== 'owner')) {
          const {
            rows: [count],
          } = await c.query(
            `SELECT count(*)::int AS n FROM ${table} WHERE school_id=$1 AND active AND role='owner'${org ? ' AND org_id=$2' : ''}`,
            org ? [s.schoolId, org] : [s.schoolId],
          );
          if (count.n <= 1) throw problem('last_owner_required', 409);
        }
        await c.query(
          `UPDATE ${table} SET role=$${args.length + 1},active=$${args.length + 2},revision=revision+1 WHERE ${where}`,
          [...args, b.role, b.active],
        );
        await audit(c, s.schoolId, u.user_id, 'membership.update', b.userId, {
          orgId: org,
          from: old.role,
          to: b.role,
          active: b.active,
        });
        return { revision: old.revision + 1 };
      });
      json(res, 200, r);
      return true;
    }
    if (action === 'forum') {
      const b =
        req.method === 'GET'
          ? {}
          : fields(
              await body(req),
              [
                'action',
                'requestId',
                'id',
                'title',
                'content',
                'parentId',
                'expectedRevision',
                'draftId',
              ],
              'forum',
            );
      if (
        req.method !== 'GET' &&
        ![
          'submit',
          'approve',
          'withdraw',
          'detail',
          'edit',
          'approve-edit',
          'reject-edit',
        ].includes(b.action)
      )
        throw problem('forum_action_invalid');
      await scope(
        db,
        s.schoolId,
        u.user_id,
        org,
        req.method === 'GET' || ['submit', 'detail', 'edit'].includes(b.action)
          ? 'read'
          : 'moderate',
      );
      const result = await services.forum(s, req.method === 'GET' ? 'list' : b.action, {
        ...b,
        userId: u.user_id,
        orgId: org,
      });
      if (req.method !== 'GET') await reconcile(s.schoolId);
      json(res, 200, result);
      return true;
    }
    if (action === 'reconcile' && req.method === 'POST') {
      await scope(db, s.schoolId, u.user_id, null, 'manage');
      json(res, 200, await reconcile(s.schoolId));
      return true;
    }
    if (action === 'audit' && req.method === 'GET') {
      await scope(db, s.schoolId, u.user_id, null, 'manage');
      const { rows } = await db.pool.query(
        'SELECT * FROM hd_audit WHERE school_id=$1 ORDER BY sequence DESC LIMIT 100',
        [s.schoolId],
      );
      json(res, 200, { entries: rows });
      return true;
    }
    if (action === 'notifications') {
      if (org) throw problem('route_missing', 404);
      if (req.method === 'GET') {
        const after = Number(url.searchParams.get('after') || 0);
        if (!Number.isSafeInteger(after) || after < 0) throw problem('cursor_invalid');
        json(res, 200, await visibleNotifications(db, s.schoolId, u.user_id, String(after)));
        return true;
      }
      const b = fields(await body(req), ['id'], 'notification');
      json(res, 200, await markNotificationRead(db, s.schoolId, u.user_id, b.id));
      return true;
    }
    throw problem('route_missing', 404);
  };
}
