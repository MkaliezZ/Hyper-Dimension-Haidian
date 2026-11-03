import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { problem } from './db.mjs';
import { scope, audit, validId } from './permissions.mjs';
import { fields } from '../protocol/index.mjs';

const uuid = (v) =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const visibility = (v) => ['private', 'school'].includes(v);
const version = (v) => Number.isSafeInteger(v) && v >= 0;
const text = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max;

// Links are clicked by the user, never fetched, embedded, or sent to the reception model.
export function safeWorkLink(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\x7f\\]/.test(value))
    throw problem('work_link_invalid');
  let u;
  try {
    u = new URL(value);
  } catch {
    throw problem('work_link_invalid');
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    (u.port && u.port !== '443') ||
    !host.includes('.') ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isIP(host) ||
    host.startsWith('[')
  )
    throw problem('work_link_invalid');
  return u.href;
}

export function createPersonal(db, identity, services, config) {
  const allowed = (s, u, c = db.pool, manage = false) =>
    scope(db, s, u, null, manage ? 'manage' : 'read', c);
  const lock = (c, s) =>
    c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [s + ':permissions']);
  const receipt = (s, u, b, operation, fn, manage = false) =>
    db.receipt(s, u, b.requestId, { module: 'personal', operation, input: b }, async (c) => {
      await lock(c, s);
      await allowed(s, u, c, manage);
      return fn(c);
    });
  async function projection(s, actor, target) {
    // Read permission and contents under the same lock used by membership mutations.
    return db.tx(async (c) => {
      await lock(c, s);
      const own = actor === target;
      await allowed(s, actor, c);
      await allowed(s, target, c);
      const [profiles, prefs, names, orgs, works, badges] = await Promise.all([
        c.query('SELECT * FROM hd_m2_profiles WHERE school_id=$1 AND user_id=$2', [s, target]),
        c.query('SELECT * FROM hd_personal_preferences WHERE school_id=$1 AND user_id=$2', [
          s,
          target,
        ]),
        c.query('SELECT display_name FROM hd_users WHERE user_id=$1', [target]),
        c.query(
          `SELECT o.org_id,o.name,o.kind,m.role FROM hd_organizations o JOIN hd_org_members m USING(school_id,org_id)
          WHERE o.school_id=$1 AND m.user_id=$2 AND o.active AND m.active ORDER BY o.org_id`,
          [s, target],
        ),
        c.query(
          `SELECT work_id,version,title,description,link,status,visibility,updated_at FROM hd_personal_works
          WHERE school_id=$1 AND user_id=$2 ${own ? '' : "AND status='published' AND visibility='school'"} ORDER BY updated_at DESC,work_id`,
          [s, target],
        ),
        c.query(
          // Expiry reconciliation revokes the underlying right. Keep its
          // displayed expiry stable before and after that worker runs, while
          // a manual revocation before the deadline remains revoked.
          `SELECT badge_id,version,label,CASE WHEN expires_at<=now() AND (status='active' OR (reward_claim_id IS NOT NULL AND revoked_at>=expires_at)) THEN 'expired' ELSE status END AS status,visibility,issued_at,revoked_at,expires_at,reward_claim_id FROM hd_personal_badges
          WHERE school_id=$1 AND user_id=$2 ${own ? '' : "AND status='active' AND visibility='school' AND (expires_at IS NULL OR expires_at>now())"} ORDER BY issued_at DESC,badge_id`,
          [s, target],
        ),
      ]);
      const profile = profiles.rows[0],
        pref = prefs.rows[0];
      const organizations = orgs.rows
        .filter((o) => own || pref?.organization_visibility[o.org_id] === 'school')
        .map((o) => ({
          ...o,
          ...(own ? { visibility: pref?.organization_visibility[o.org_id] || 'private' } : {}),
        }));
      return {
        userId: target,
        name: names.rows[0].display_name,
        own,
        profile: {
          version: profile?.version || 0,
          fields: Object.fromEntries(
            Object.entries(profile?.fields || {}).filter(
              ([k]) => own || profile.visibility[k] === 'school',
            ),
          ),
          ...(own ? { visibility: profile?.visibility || {} } : {}),
        },
        ...(own
          ? {
              preferences: {
                version: pref?.version || 0,
                organizationVisibility: pref?.organization_visibility || {},
              },
            }
          : {}),
        organizations,
        works: works.rows,
        badges: badges.rows.map((b) => ({ ...b, kind: 'community-recognition' })),
        badgeMeaning: '由学校空间负责人发放的社区认可，不代表学籍或法定身份认证。',
      };
    });
  }
  return async function handle(req, res, { url, json, body }) {
    const p = url.pathname.split('/').filter(Boolean);
    if (p[0] !== 'personal') return false;
    if (p[1] !== 'schools' || !p[2] || !['GET', 'POST'].includes(req.method))
      throw problem('personal_route_missing', 404);
    const s = services.school(p[2]).schoolId,
      actor = (await identity.user(req)).user_id;
    await allowed(s, actor);
    const action = p[3];
    if (
      req.method === 'GET' &&
      ((action === 'me' && p.length === 4) || (action === 'profiles' && p.length === 5))
    ) {
      const target = action === 'me' ? actor : p[4];
      if (!uuid(target)) throw problem('profile_missing', 404);
      json(res, 200, await projection(s, actor, target));
      return true;
    }
    if (req.method === 'GET' && action === 'badges' && p[4] === 'manage' && p.length === 5) {
      await allowed(s, actor, db.pool, true);
      const { rows } = await db.pool.query(
        `SELECT badge_id,user_id,version,label,status,issued_at FROM hd_personal_badges
        WHERE school_id=$1 ORDER BY issued_at DESC,badge_id LIMIT 100`,
        [s],
      );
      json(res, 200, { badges: rows, limit: 100 });
      return true;
    }
    if (req.method !== 'POST') throw problem('personal_route_missing', 404);
    if (action === 'preferences' && p.length === 4) {
      const b = fields(
        await body(req),
        ['requestId', 'expectedVersion', 'organizationVisibility'],
        'preferences',
      );
      if (
        !version(b.expectedVersion) ||
        !b.organizationVisibility ||
        typeof b.organizationVisibility !== 'object' ||
        Array.isArray(b.organizationVisibility) ||
        Object.keys(b.organizationVisibility).length > 100 ||
        Object.entries(b.organizationVisibility).some(([k, v]) => !validId(k) || !visibility(v))
      )
        throw problem('preferences_invalid');
      const result = await receipt(s, actor, b, 'preferences.save', async (c) => {
        const prior = (
          await c.query(
            'SELECT version FROM hd_personal_preferences WHERE school_id=$1 AND user_id=$2',
            [s, actor],
          )
        ).rows[0];
        if ((prior?.version || 0) !== b.expectedVersion)
          throw problem('personal_write_conflict', 409);
        const { rows } = await c.query(
          `SELECT m.org_id FROM hd_org_members m JOIN hd_organizations o USING(school_id,org_id)
          WHERE m.school_id=$1 AND m.user_id=$2 AND m.active AND o.active`,
          [s, actor],
        );
        if (Object.keys(b.organizationVisibility).some((k) => !rows.some((o) => o.org_id === k)))
          throw problem('organization_denied', 403);
        await c.query(
          `INSERT INTO hd_personal_preferences VALUES($1,$2,$3,$4) ON CONFLICT(school_id,user_id)
          DO UPDATE SET version=EXCLUDED.version,organization_visibility=EXCLUDED.organization_visibility`,
          [s, actor, b.expectedVersion + 1, b.organizationVisibility],
        );
        return { version: b.expectedVersion + 1 };
      });
      json(res, 200, result);
      return true;
    }
    if (action === 'works' && p.length === 4) {
      const b = fields(
        await body(req),
        [
          'requestId',
          'workId',
          'expectedVersion',
          'title',
          'description',
          'link',
          'status',
          'visibility',
        ],
        'work',
      );
      if (
        (b.workId !== undefined && !uuid(b.workId)) ||
        !version(b.expectedVersion) ||
        !text(b.title, 1, 100) ||
        !text(b.description, 0, 2000) ||
        !['draft', 'published', 'withdrawn'].includes(b.status) ||
        !visibility(b.visibility)
      )
        throw problem('work_invalid');
      const link = safeWorkLink(b.link);
      const result = await receipt(s, actor, b, 'work.save', async (c) => {
        const old = b.workId
          ? (
              await c.query(
                'SELECT * FROM hd_personal_works WHERE school_id=$1 AND user_id=$2 AND work_id=$3 FOR UPDATE',
                [s, actor, b.workId],
              )
            ).rows[0]
          : null;
        if (b.workId && !old) throw problem('work_missing', 404);
        if ((old?.version || 0) !== b.expectedVersion)
          throw problem('personal_write_conflict', 409);
        if (!old && b.status === 'withdrawn') throw problem('work_transition_invalid', 409);
        if (
          !old &&
          (
            await c.query(
              'SELECT count(*)::int AS n FROM hd_personal_works WHERE school_id=$1 AND user_id=$2',
              [s, actor],
            )
          ).rows[0].n >= 50
        )
          throw problem('work_limit_reached', 409);
        const workId = old?.work_id || randomUUID(),
          next = b.expectedVersion + 1;
        await c.query(
          `INSERT INTO hd_personal_works(work_id,school_id,user_id,version,title,description,link,status,visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT(work_id) DO UPDATE SET version=EXCLUDED.version,title=EXCLUDED.title,description=EXCLUDED.description,link=EXCLUDED.link,status=EXCLUDED.status,visibility=EXCLUDED.visibility,updated_at=now()`,
          [workId, s, actor, next, b.title.trim(), b.description, link, b.status, b.visibility],
        );
        const snapshot = {
          title: b.title.trim(),
          description: b.description,
          link,
          status: b.status,
          visibility: b.visibility,
        };
        await c.query(
          'INSERT INTO hd_personal_work_history(work_id,version,snapshot) VALUES($1,$2,$3)',
          [workId, next, snapshot],
        );
        await audit(c, s, actor, 'personal.work.save', workId, {
          version: next,
          status: b.status,
          visibility: b.visibility,
        });
        return { workId, version: next, ...snapshot };
      });
      json(res, 200, result);
      return true;
    }
    if (action === 'badges' && p.length === 5 && ['issue', 'revoke', 'visibility'].includes(p[4])) {
      const op = p[4],
        manage = op !== 'visibility';
      await allowed(s, actor, db.pool, manage);
      const b = fields(
        await body(req),
        op === 'issue'
          ? ['requestId', 'userId', 'label', 'reason']
          : op === 'revoke'
            ? ['requestId', 'badgeId', 'expectedVersion', 'reason']
            : ['requestId', 'badgeId', 'expectedVersion', 'visibility'],
        'badge',
      );
      if (
        op === 'issue'
          ? !uuid(b.userId) || !text(b.label, 1, 60) || !text(b.reason, 3, 500)
          : !uuid(b.badgeId) ||
            !version(b.expectedVersion) ||
            (op === 'revoke' ? !text(b.reason, 3, 500) : !visibility(b.visibility))
      )
        throw problem('badge_invalid');
      const result = await receipt(
        s,
        actor,
        b,
        'badge.' + op,
        async (c) => {
          if (op === 'issue') {
            await allowed(s, b.userId, c);
            if (
              (
                await c.query(
                  "SELECT count(*)::int AS n FROM hd_personal_badges WHERE school_id=$1 AND user_id=$2 AND status='active'",
                  [s, b.userId],
                )
              ).rows[0].n >= 100
            )
              throw problem('badge_limit_reached', 409);
            const badgeId = randomUUID();
            await c.query(
              "INSERT INTO hd_personal_badges(badge_id,school_id,user_id,label,issuer_id,reason,status) VALUES($1,$2,$3,$4,$5,$6,'active')",
              [badgeId, s, b.userId, b.label.trim(), actor, b.reason],
            );
            await audit(c, s, actor, 'personal.badge.issue', badgeId, {
              targetUserId: b.userId,
              reason: b.reason,
              label: b.label,
              kind: 'community-recognition',
            });
            return {
              badgeId,
              version: 1,
              status: 'active',
              visibility: 'private',
              kind: 'community-recognition',
            };
          }
          const old = (
            await c.query(
              'SELECT * FROM hd_personal_badges WHERE school_id=$1 AND badge_id=$2 FOR UPDATE',
              [s, b.badgeId],
            )
          ).rows[0];
          if (!old || (op === 'visibility' && old.user_id !== actor))
            throw problem('badge_missing', 404);
          if (old.version !== b.expectedVersion) throw problem('personal_write_conflict', 409);
          if (old.status !== 'active') throw problem('badge_revoked', 409);
          if (op === 'revoke') {
            await c.query(
              "UPDATE hd_personal_badges SET status='revoked',revoked_at=now(),version=version+1 WHERE badge_id=$1",
              [b.badgeId],
            );
            await audit(c, s, actor, 'personal.badge.revoke', b.badgeId, {
              targetUserId: old.user_id,
              reason: b.reason,
            });
          } else
            await c.query(
              'UPDATE hd_personal_badges SET visibility=$2,version=version+1 WHERE badge_id=$1',
              [b.badgeId, b.visibility],
            );
          return {
            badgeId: b.badgeId,
            version: old.version + 1,
            status: op === 'revoke' ? 'revoked' : old.status,
            visibility: op === 'visibility' ? b.visibility : old.visibility,
          };
        },
        manage,
      );
      json(res, 200, result);
      return true;
    }
    throw problem('personal_route_missing', 404);
  };
}
