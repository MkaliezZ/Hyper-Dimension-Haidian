import { readFile, writeFile } from 'node:fs/promises';
import { openPlatform, hash } from '../src/platform/db.mjs';
const config = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8')),
  db = await openPlatform(config.databaseUrl);
try {
  const tables = {};
  for (const table of [
    'hd_users',
    'hd_memberships',
    'hd_identities',
    'hd_avatars',
    'hd_receipts',
    'hd_forum_heads',
    'hd_events',
    'hd_contributions',
    'hd_scores',
  ]) {
    const { rows } = await db.pool.query(
      `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
    );
    tables[table] = { count: rows.length, sha256: hash(rows) };
  }
  const result = { kind: 'M0 isolated business database snapshot', tables };
  await writeFile(process.argv[2] || 'qa/m0/snapshot.json', JSON.stringify(result, null, 2) + '\n');
  console.log('M0 snapshot saved; no session tokens or secrets included');
} finally {
  await db.close();
}
