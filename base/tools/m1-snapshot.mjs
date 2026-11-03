import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { databaseConnections } from '../src/platform/backup-connections.mjs';
const c = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8')),
  databases = {};
for (const d of await databaseConnections(c)) {
  const client = new pg.Client({ connectionString: d.url });
  await client.connect();
  try {
    const tables = {};
    const list = (
      await client.query(
        "SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema NOT IN('information_schema','pg_catalog') AND table_type='BASE TABLE' ORDER BY table_schema,table_name",
      )
    ).rows;
    for (const t of list) {
      const ident = (x) => '"' + x.replaceAll('"', '""') + '"';
      let rows = (
        await client.query(
          'SELECT to_jsonb(t) AS row FROM ' +
            ident(t.table_schema) +
            '.' +
            ident(t.table_name) +
            ' t ORDER BY to_jsonb(t)::text',
        )
      ).rows.map((x) => x.row);
      if (d.id === 'base' && t.table_name === 'hd_users')
        rows = rows.map((r) => ({
          ...r,
          issuer: '<preserved identity provider relocated by explicit restore>',
        }));
      tables[t.table_schema + '.' + t.table_name] = {
        count: rows.length,
        sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
      };
    }
    databases[d.id] = { tables };
  } finally {
    await client.end();
  }
}
const out = process.argv[2];
if (!out) throw Error('Pass output JSON path');
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  JSON.stringify(
    {
      kind: 'full six-service database row hashes; values and credentials excluded',
      normalization: ['hd_users.issuer only for explicit clone relocation'],
      databases,
    },
    null,
    2,
  ) + '\n',
);
console.log('Database row hashes saved; no raw account/session data printed');
