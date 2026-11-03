import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { config, until } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createJobs } from '../src/platform/jobs.mjs';
import { createIndexing } from '../src/platform/indexing.mjs';
import { createServices } from '../src/platform/services.mjs';
import { openKnowledge } from '../src/knowledge/index.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Dedicated isolated fixture required');
Object.assign(
  process.env,
  JSON.parse(await readFile(config.configRoot + '/runtime-env.json', 'utf8')),
);
const db = await openPlatform(config.databaseUrl, { m1: true }),
  schema = 'hd_vector_test_' + randomUUID().replaceAll('-', '').slice(0, 12);
let jobs,
  k,
  indexing,
  attempts = 0,
  id;
try {
  k = await openKnowledge({ dataDir: config.dataDir, root: process.cwd() });
  jobs = await createJobs(config, {
    schema,
    handlers: {
      'knowledge-index': async (data) => {
        attempts++;
        if (attempts === 1) throw Error('Deliberate transient fixture failure');
        return indexing.workPublic(data);
      },
    },
  });
  indexing = createIndexing(db, null, createServices(db, config), config, jobs);
  indexing.bind(k);
  const source = (
    await db.pool.query(
      "SELECT * FROM hd_index_sources WHERE school_id='north' AND kind='knowledge-index' AND source_id='public'",
    )
  ).rows[0];
  assert(source?.complete, 'Run the live indexing fixture first');
  id = (
    await db.tx((c) =>
      jobs.scheduleIndex(c, 'knowledge-index', {
        schoolId: 'north',
        sourceId: 'retry-' + schema,
        generation: source.desired_hash,
      }),
    )
  ).jobId;
  const completed = await until(async () => {
    const [job] = await jobs.boss.findJobs('campus-knowledge-index', { id, limit: 1 });
    return job?.state === 'completed' ? job : null;
  }, 15000);
  assert.equal(attempts, 2);
  assert.equal(completed.retryCount, 1);
  assert(!JSON.stringify(completed.data).includes('body'));
  const after = (
    await db.pool.query(
      "SELECT * FROM hd_index_sources WHERE school_id='north' AND kind='knowledge-index' AND source_id='public'",
    )
  ).rows[0];
  assert.equal(after.indexed_hash, source.indexed_hash);
  assert.equal(after.indexed_revision, source.indexed_revision);
  const output = process.env.HD_INTEGRATION_EVIDENCE || 'evidence/integrations';
  await mkdir(output, { recursive: true });
  await writeFile(
    output + '/indexing-retry.json',
    JSON.stringify(
      {
        status: 'PASS',
        fixtureOnly: true,
        attempts,
        retries: completed.retryCount,
        checks: [
          'real pg-boss retry after handler failure',
          'same queued identity',
          'current approved pgvector import is idempotent',
          'no source body in queue payload',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS real queue retry recovered one transient failure with the same job and approved vector snapshot',
  );
} finally {
  await jobs?.close();
  await k?.close();
  if (id)
    await db.pool.query('DELETE FROM hd_scheduled_jobs WHERE job_id=$1 AND source_id LIKE $2', [
      id,
      'retry-' + schema + ':%',
    ]);
  if (!/^hd_vector_test_[a-f0-9]{12}$/.test(schema))
    throw Error('Unexpected owned test schema; retained');
  await db.pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
  await db.close();
}
