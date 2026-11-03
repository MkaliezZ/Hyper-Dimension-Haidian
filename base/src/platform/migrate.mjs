import { readFile } from 'node:fs/promises';
import { hash } from './db.mjs';
export async function migrateM1(pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('hd-schema-migrations',0))");
    await c.query(
      'CREATE TABLE IF NOT EXISTS hd_schema_migrations(version text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const [version, file] of [
      ['m1-001', 'm1.sql'],
      ['m1-002', 'm1-002.sql'],
      ['m1-003', 'm1-003.sql'],
      ['m1-004', 'm1-004.sql'],
      ['m2-001', 'm2-001.sql'],
      ['campus-001', 'campus-001.sql'],
      ['m2-002', 'm2-002.sql'],
      ['m5-001', 'm5-001.sql'],
      ['campus-jobs-001', 'campus-jobs-001.sql'],
      ['m3-activities-001', 'm3-activities-001.sql'],
      ['campus-attachments-001', 'campus-attachments-001.sql'],
      ['campus-contacts-001', 'campus-contacts-001.sql'],
      ['m3-community-001', 'm3-community-001.sql'],
      ['m4-ledger-001', 'm4-ledger-001.sql'],
      ['m4-ledger-002', 'm4-ledger-002.sql'],
      ['m4-rewards-001', 'm4-rewards-001.sql'],
      ['m3-operations-001', 'm3-operations-001.sql'],
      ['campus-environment-001', 'campus-environment-001.sql'],
      ['campus-outbox-001', 'campus-outbox-001.sql'],
      ['campus-a2a-001', 'campus-a2a-001.sql'],
      ['campus-index-001', 'campus-index-001.sql'],
      ['campus-annual-001', 'campus-annual-001.sql'],
      ['campus-network-001', 'campus-network-001.sql'],
    ]) {
      const sql = await readFile(new URL('../../database/' + file, import.meta.url), 'utf8'),
        digest = hash(sql);
      const {
        rows: [old],
      } = await c.query('SELECT * FROM hd_schema_migrations WHERE version=$1', [version]);
      if (old && old.digest !== digest)
        throw Error('Applied M1 migration changed; original database preserved');
      if (!old) {
        await c.query(sql);
        await c.query('INSERT INTO hd_schema_migrations(version,digest) VALUES($1,$2)', [
          version,
          digest,
        ]);
      }
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
