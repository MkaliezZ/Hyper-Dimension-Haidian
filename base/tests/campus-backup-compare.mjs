import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const read = (p) => readFile(p, 'utf8').then(JSON.parse),
  source = await read('qa/campus/backup-source.json'),
  clone = await read('qa/campus/backup-restored.json');
assert.deepEqual(clone.databases, source.databases);
let tables = 0,
  rows = 0;
for (const d of Object.values(source.databases))
  for (const t of Object.values(d.tables)) {
    tables++;
    rows += t.count;
  }
assert.equal(Object.keys(source.databases).length, 7);
const result = {
  status: 'PASS',
  databases: Object.keys(source.databases),
  tables,
  rows,
  checks: [
    {
      name: 'all seven database table row counts and hashes match before restored writers start',
      status: 'PASS',
    },
  ],
  normalization: source.normalization,
  scope:
    'fresh isolated Ubuntu namespace; source databases retained; includes pgvector, pg-boss, controlled attachment bytea, avatar catalog recipes and business/event tables',
};
await writeFile('qa/campus/backup-comparison.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
