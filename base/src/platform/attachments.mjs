import { randomUUID, createHash } from 'node:crypto';
import { hash, problem } from './db.mjs';
import { scope, audit, validId } from './permissions.mjs';
import { fields, canonical } from '../protocol/index.mjs';
const limit = 524288,
  quota = 20 * 1024 * 1024;
const types = ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'];
const meta = (a) => ({
  attachmentId: a.attachment_id,
  name: a.name,
  mimeType: a.mime_type,
  sha256: a.sha256,
  bytes: a.bytes,
  purpose: a.purpose,
  targetId: a.target_id,
  scopeId: a.scope_id,
  status: a.status,
  revision: a.revision,
  expiresAt: a.expires_at,
  legalHold: a.legal_hold,
});
const available = (a) =>
  a.status === 'active' && a.body && (!a.expires_at || a.expires_at > new Date());
const lock = (c, s) =>
  c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [s + ':permissions']);
export function validateUpload(b) {
  if (
    typeof b.name !== 'string' ||
    !b.name.trim() ||
    b.name.length > 120 ||
    /[\\/\x00-\x1f\x7f]/.test(b.name) ||
    !types.includes(b.mimeType)
  )
    throw problem('attachment_name_or_type_invalid');
  if (
    typeof b.dataBase64 !== 'string' ||
    b.dataBase64.length > Math.ceil(limit / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.dataBase64)
  )
    throw problem('attachment_encoding_invalid');
  const bytes = Buffer.from(b.dataBase64, 'base64');
  if (!bytes.length || bytes.length > limit) throw problem('attachment_size_invalid');
  const valid =
    b.mimeType === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : b.mimeType === 'image/jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : b.mimeType === 'application/pdf'
          ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
          : !bytes.includes(0) && Buffer.from(bytes.toString('utf8')).equals(bytes);
  if (!valid) throw problem('attachment_content_type_mismatch');
  return bytes;
}
export function createAttachments(
  db,
  identity,
  services,
  { canReadLinked = async () => false } = {},
) {
  // Same order as permission management and linked business transactions.
  const mutate = (school, user, b, input, acl, fn) =>
    db.tx(async (c) => {
      await lock(c, school);
      await acl(c);
      if (!validId(b.requestId)) throw problem('request_id_required');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        school + ':' + user + ':' + b.requestId,
      ]);
      const old = (
          await c.query(
            'SELECT * FROM hd_receipts WHERE school_id=$1 AND user_id=$2 AND request_id=$3',
            [school, user, b.requestId],
          )
        ).rows[0],
        fingerprint = hash(input);
      if (old) {
        if (old.input_hash !== fingerprint) throw problem('request_conflict', 409);
        return old.result;
      }
      const result = await fn(c);
      await c.query('INSERT INTO hd_receipts VALUES($1,$2,$3,$4,$5)', [
        school,
        user,
        b.requestId,
        fingerprint,
        result,
      ]);
      return result;
    });
  const read = async (c, school, id) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || ''))
      throw problem('attachment_missing', 404);
    const a = (
      await c.query('SELECT * FROM hd_attachments WHERE school_id=$1 AND attachment_id=$2', [
        school,
        id,
      ])
    ).rows[0];
    if (!a) throw problem('attachment_missing', 404);
    return a;
  };
  const access = async (c, school, user, a) => {
    await scope(db, school, user, a.scope_id || null, 'read', c);
    if (
      a.owner_id !== user &&
      !(await canReadLinked(c, {
        schoolId: school,
        userId: user,
        attachmentId: a.attachment_id,
        purpose: a.purpose,
        targetId: a.target_id,
      }))
    )
      throw problem('attachment_denied', 403);
  };
  const validator = async (
    c,
    {
      schoolId,
      userId,
      attachmentId,
      activityId,
      purpose = 'activity-evidence',
      targetId = activityId,
      scopeId,
    },
  ) => {
    const a = await read(c, schoolId, attachmentId);
    await scope(db, schoolId, userId, a.scope_id || null, 'read', c);
    if (a.owner_id !== userId || a.purpose !== purpose || a.target_id !== targetId)
      throw problem('attachment_reference_denied', 403);
    if (purpose === 'activity-evidence') {
      const target = (
        await c.query('SELECT org_id FROM hd_activities WHERE school_id=$1 AND activity_id=$2', [
          schoolId,
          targetId,
        ])
      ).rows[0];
      if (!target || (target.org_id || '') !== a.scope_id)
        throw problem('attachment_scope_mismatch', 403);
    } else if (scopeId !== undefined && (scopeId || '') !== a.scope_id)
      throw problem('attachment_scope_mismatch', 403);
    if (!available(a)) throw problem('attachment_unavailable', 410);
    return { attachmentId: a.attachment_id, sha256: a.sha256, name: a.name };
  };
  return {
    validateAttachment: validator,
    async expire(school) {
      return db.tx(async (c) => {
        await lock(c, school);
        const r = await c.query(
          "UPDATE hd_attachments SET body=NULL,status='expired',revision=revision+1 WHERE school_id=$1 AND expires_at<=now() AND body IS NOT NULL AND NOT legal_hold RETURNING attachment_id",
          [school],
        );
        if (r.rowCount)
          await audit(c, school, null, 'attachment.expire', school, {
            actorKind: 'system',
            count: r.rowCount,
          });
        return { expired: r.rowCount };
      });
    },
    async handle(req, res, { url, json, body }) {
      const p = url.pathname.split('/').filter(Boolean);
      if (p[0] !== 'attachments') return false;
      if (!['GET', 'POST'].includes(req.method) || p[1] !== 'schools' || !p[2] || p.length > 5)
        throw problem('attachment_route_invalid', 404);
      const user = (await identity.user(req)).user_id,
        school = services.school(p[2]).schoolId;
      await db.member(school, user);
      if (p.length === 3) {
        if (req.method === 'GET') {
          const a = (
            await db.pool.query(
              'SELECT * FROM hd_attachments WHERE school_id=$1 AND owner_id=$2 ORDER BY created_at DESC LIMIT 100',
              [school, user],
            )
          ).rows;
          const items = [];
          for (const row of a) {
            try {
              await access(db.pool, school, user, row);
              items.push(meta(row));
            } catch (e) {
              if (e.status !== 403) throw e;
            }
          }
          json(res, 200, { items });
          return true;
        }
        const b = fields(
          await body(req),
          [
            'requestId',
            'name',
            'mimeType',
            'dataBase64',
            'purpose',
            'targetId',
            'scopeId',
            'expiresAt',
          ],
          'attachment',
        );
        const bytes = validateUpload(b),
          org = b.scopeId || '';
        if (
          !['community', 'activity-evidence', 'organization-internal'].includes(b.purpose) ||
          !validId(b.targetId) ||
          (org && !validId(org))
        )
          throw problem('attachment_target_invalid');
        if (b.purpose === 'organization-internal' && (!org || b.targetId !== org))
          throw problem('attachment_target_invalid');
        await scope(db, school, user, org || null);
        const digest = createHash('sha256').update(bytes).digest('hex');
        const fingerprint = canonical({ ...b, dataBase64: undefined, sha256: digest });
        const result = await mutate(
          school,
          user,
          b,
          fingerprint,
          (c) => scope(db, school, user, org || null, 'read', c),
          async (c) => {
            const exp = b.expiresAt ? new Date(b.expiresAt) : null;
            if (exp && (!Number.isFinite(+exp) || exp <= new Date()))
              throw problem('attachment_expiry_invalid');
            const used = (
              await c.query(
                'SELECT coalesce(sum(bytes),0)::bigint AS n FROM hd_attachments WHERE school_id=$1 AND owner_id=$2 AND body IS NOT NULL',
                [school, user],
              )
            ).rows[0].n;
            if (Number(used) + bytes.length > quota)
              throw problem('attachment_quota_exceeded', 413);
            const a = (
              await c.query(
                `INSERT INTO hd_attachments(school_id,attachment_id,owner_id,scope_id,purpose,target_id,name,mime_type,sha256,bytes,body,status,expires_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12) RETURNING *`,
                [
                  school,
                  randomUUID(),
                  user,
                  org,
                  b.purpose,
                  b.targetId,
                  b.name,
                  b.mimeType,
                  digest,
                  bytes.length,
                  bytes,
                  exp,
                ],
              )
            ).rows[0];
            await audit(c, school, user, 'attachment.upload', a.attachment_id, {
              purpose: b.purpose,
              bytes: bytes.length,
              sha256: digest,
            });
            return meta(a);
          },
        );
        json(res, 200, result);
        return true;
      }
      const a = await read(db.pool, school, p[3]);
      await access(db.pool, school, user, a);
      if (req.method === 'GET') {
        if (!p[4]) {
          json(res, 200, meta(a));
          return true;
        }
        if (p[4] !== 'download') throw problem('route_missing', 404);
        if (!available(a)) throw problem('attachment_unavailable', 410);
        // A file is downloaded, never executed, embedded or added to public retrieval.
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': a.body.length,
          'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'",
          'Cache-Control': 'private, no-store',
        });
        res.end(a.body);
        return true;
      }
      if (p[4] !== 'state' && p[4] !== 'hold') throw problem('route_missing', 404);
      const b = fields(
        await body(req),
        ['requestId', 'expectedRevision', 'status', 'legalHold', 'reason'],
        'attachment-state',
      );
      const acl = async (c) => {
        await access(c, school, user, a);
        if (p[4] === 'hold') await scope(db, school, user, a.scope_id || null, 'manage', c);
        else if (a.owner_id !== user) throw problem('attachment_owner_required', 403);
      };
      await acl(db.pool);
      const r = await mutate(
        school,
        user,
        b,
        canonical({ operation: p[4], id: a.attachment_id, ...b }),
        acl,
        async (c) => {
          const now = await read(c, school, a.attachment_id);
          if (now.revision !== b.expectedRevision) throw problem('revision_conflict', 409);
          if (typeof b.reason !== 'string' || b.reason.trim().length < 3 || b.reason.length > 300)
            throw problem('reason_required');
          if (p[4] === 'hold') {
            if (typeof b.legalHold !== 'boolean' || !now.body) throw problem('hold_invalid');
            await c.query(
              'UPDATE hd_attachments SET legal_hold=$3,hold_reason=$4,revision=revision+1 WHERE school_id=$1 AND attachment_id=$2',
              [school, a.attachment_id, b.legalHold, b.reason],
            );
          } else {
            if (
              !['withdrawn', 'deleted'].includes(b.status) ||
              (now.legal_hold && b.status === 'deleted')
            )
              throw problem('attachment_state_denied', 409);
            await c.query(
              "UPDATE hd_attachments SET status=$3,body=CASE WHEN $3='deleted' THEN NULL ELSE body END,revision=revision+1 WHERE school_id=$1 AND attachment_id=$2",
              [school, a.attachment_id, b.status],
            );
          }
          await audit(c, school, user, 'attachment.' + p[4], a.attachment_id, {
            status: b.status,
            legalHold: b.legalHold,
            reason: b.reason,
          });
          return meta(await read(c, school, a.attachment_id));
        },
      );
      json(res, 200, r);
      return true;
    },
  };
}
