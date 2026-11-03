import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { migrateM1 } from '../src/platform/migrate.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Restored fixture required');
const config = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8'));
assert(config.relocatedFrom && config.campusEnabled);
const pool = new Pool({ connectionString: config.databaseUrl });
try {
  const query = () =>
    pool
      .query(
        "SELECT to_jsonb(t)-'last_error_code'-'last_attempt_at' row FROM hd_outbox t ORDER BY id",
      )
      .then((r) => r.rows);
  const before = await query();
  await migrateM1(pool);
  assert.deepEqual(await query(), before);
  const columns = (
    await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='hd_outbox'",
    )
  ).rows.map((x) => x.column_name);
  assert(columns.includes('last_error_code') && columns.includes('last_attempt_at'));
  await writeFile(
    'qa/campus/outbox-migration.json',
    JSON.stringify(
      {
        status: 'PASS',
        rowsPreserved: before.length,
        checks: [
          {
            name: 'additive diagnostics migration on restored database preserves every old outbox row and score/version',
            status: 'PASS',
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS restored outbox additive migration');
} finally {
  await pool.end();
}
