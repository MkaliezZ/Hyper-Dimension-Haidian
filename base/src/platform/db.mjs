import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { migrateM1 } from './migrate.mjs';
export const hash = (v) =>
  createHash('sha256')
    .update(typeof v === 'string' ? v : JSON.stringify(v))
    .digest('hex');
export function problem(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}
export async function openPlatform(connectionString, { m1 = false } = {}) {
  const pool = new pg.Pool({ connectionString, max: 8 });
  await pool.query(await readFile(new URL('../../database/m0.sql', import.meta.url), 'utf8'));
  if (m1) {
    try {
      await migrateM1(pool);
    } catch (e) {
      await pool.end();
      throw e;
    }
  }
  const tx = async (fn) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  };
  let api;
  const member = async (school, user, role, c = pool) => {
    if (api?.accountGate) await api.accountGate(user, c);
    const {
      rows: [m],
    } = await c.query('SELECT * FROM hd_memberships WHERE school_id=$1 AND user_id=$2 AND active', [
      school,
      user,
    ]);
    if (m1) {
      const {
        rows: [u],
      } = await c.query('SELECT enabled FROM hd_users WHERE user_id=$1', [user]);
      if (!u?.enabled) throw problem('account_disabled', 403);
    }
    if (!m || (role && !role.includes(m.role))) throw problem('membership_denied', 403);
    return m;
  };
  const identity = async (claims) => {
    const {
      rows: [u],
    } = await pool.query(
      `INSERT INTO hd_users(user_id,issuer,subject,display_name) VALUES($1,$2,$3,$4)
      ON CONFLICT(issuer,subject) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING *`,
      [randomUUID(), claims.iss, claims.sub, claims.preferred_username || 'Member'],
    );
    if (m1) {
      if (!u.enabled) throw problem('account_disabled', 403);
      await pool.query('UPDATE hd_users SET email=$2,email_verified=$3 WHERE user_id=$1', [
        u.user_id,
        claims.email?.toLowerCase() || null,
        claims.email_verified === true,
      ]);
      u.email = claims.email?.toLowerCase() || null;
      u.email_verified = claims.email_verified === true;
    }
    return u;
  };
  const receipt = (school, user, requestId, input, fn, authorize) =>
    tx(async (c) => {
      if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(requestId || '')) throw problem('request_id_required');
      if (api?.campusEnabled) {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          school + ':permissions',
        ]);
        await member(school, user, null, c);
      }
      if (authorize) await authorize(c);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        school + ':' + user + ':' + requestId,
      ]);
      const {
        rows: [old],
      } = await c.query(
        'SELECT * FROM hd_receipts WHERE school_id=$1 AND user_id=$2 AND request_id=$3',
        [school, user, requestId],
      );
      const fingerprint = hash(input);
      if (old) {
        if (old.input_hash !== fingerprint) throw problem('request_conflict', 409);
        return old.result;
      }
      await member(school, user, null, c);
      const result = await fn(c);
      await c.query('INSERT INTO hd_receipts VALUES($1,$2,$3,$4,$5)', [
        school,
        user,
        requestId,
        fingerprint,
        result,
      ]);
      return result;
    });
  api = { pool, tx, member, identity, receipt, m1, close: () => pool.end() };
  return api;
}
