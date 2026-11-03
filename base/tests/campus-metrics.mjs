import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem, platform, release } from 'node:os';
import pg from 'pg';
import { config, login } from './m1-helpers.mjs';

if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Restored isolated campus fixture required');
const samples = 50,
  concurrency = 5,
  budgetP95Ms = 500;
const username = process.env.HD_METRICS_USER || 'shared',
  user = await login(username);
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
const output = 'qa/campus/metrics.json',
  measurements = [],
  scales = [];
const started = performance.now(),
  startedAt = new Date().toISOString();
await mkdir('qa/campus', { recursive: true });
async function read(path) {
  const t = performance.now();
  const r = await fetch(config.origin + path, {
    headers: { Authorization: 'Bearer ' + user.token },
    signal: AbortSignal.timeout(10000),
  });
  const body = await r.text();
  assert.equal(r.status, 200, path + ' must return actual permitted data');
  const data = JSON.parse(body);
  return { durationMs: performance.now() - t, bytes: Buffer.byteLength(body), data };
}
async function measure(school, path, validate) {
  const warm = await read(path);
  validate(warm.data);
  let cursor = 0;
  const results = [];
  async function worker() {
    while (cursor < samples) {
      const index = cursor++;
      const r = await read(path);
      validate(r.data);
      results[index] = { durationMs: r.durationMs, bytes: r.bytes };
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  assert.equal(results.length, samples);
  const sorted = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(samples * 0.95) - 1];
  const report = {
    schoolId: school,
    path,
    samples,
    concurrency,
    warmups: 1,
    p50Ms: sorted[Math.ceil(samples * 0.5) - 1],
    p95Ms: p95,
    maxMs: sorted.at(-1),
    minResponseBytes: Math.min(...results.map((r) => r.bytes)),
    maxResponseBytes: Math.max(...results.map((r) => r.bytes)),
    budgetP95Ms,
    status: p95 <= budgetP95Ms ? 'PASS' : 'FAIL',
  };
  measurements.push(report);
  console.log(`${report.status} ${path} p95=${p95.toFixed(2)}ms / ${budgetP95Ms}ms`);
}
try {
  // Real row counts, not estimates or invented load. No migration or fixture insertion occurs here.
  await pool.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables = (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'hd_%' ORDER BY tablename",
    )
  ).rows;
  for (const { tablename } of tables) {
    assert.match(tablename, /^hd_[a-z0-9_]+$/);
    const {
      rows: [r],
    } = await pool.query('SELECT count(*)::int AS rows FROM public."' + tablename + '"');
    scales.push({ table: tablename, rows: r.rows });
  }
  const schoolScale = (
    await pool.query(
      'SELECT school_id,count(*)::int AS memberships,count(*) FILTER(WHERE active)::int AS active_memberships FROM hd_memberships GROUP BY school_id ORDER BY school_id',
    )
  ).rows;
  await pool.query('COMMIT');
  for (const school of config.schools) {
    const s = encodeURIComponent(school.schoolId);
    await measure(school.schoolId, `/m2/schools/${s}/avatar`, (d) =>
      assert.ok(d.recipe && typeof d.modelHash === 'string'),
    );
    await measure(school.schoolId, `/community/schools/${s}/categories`, (d) =>
      assert.ok(Array.isArray(d.items)),
    );
    await measure(school.schoolId, `/activities/schools/${s}/items`, (d) =>
      assert.ok(Array.isArray(d.items)),
    );
    await measure(school.schoolId, `/environment/schools/${s}/places`, (d) =>
      assert.ok(Array.isArray(d.places)),
    );
    await measure(school.schoolId, `/agent-directory/schools/${s}`, (d) =>
      assert.ok(Array.isArray(d.cards)),
    );
  }
  const result = {
    status: measurements.every((m) => m.status === 'PASS') ? 'PASS' : 'FAIL',
    kind: 'local-warm-read-budget',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    origin: config.origin,
    samplesPerEndpoint: samples,
    concurrency,
    budgetP95Ms,
    environment: {
      platform: platform(),
      release: release(),
      node: process.version,
      cpu: cpus()[0].model,
      logicalCpus: cpus().length,
      ramBytes: totalmem(),
    },
    dataScale: {
      source: 'actual restored PostgreSQL read-only repeatable-read counts before load',
      tableCount: scales.length,
      totalRows: scales.reduce((n, r) => n + r.rows, 0),
      tables: scales,
      schools: schoolScale,
    },
    measurements,
    limits:
      'Two synthetic schools in a restored local Ubuntu namespace, warm permitted JSON reads. Not cold start, model generation, GPU, internet latency, thousands of users or target-server capacity.',
  };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  assert.equal(
    result.status,
    'PASS',
    'One or more endpoints exceeded the unchanged 500ms p95 threshold',
  );
} catch (e) {
  if (!measurements.length || measurements.some((m) => m.status !== 'PASS'))
    console.error(e.message);
  // Preserve all completed samples and the cause even for status/shape/connection failures.
  await writeFile(
    output,
    JSON.stringify(
      {
        status: 'FAIL',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - started),
        origin: config.origin,
        samplesPerEndpoint: samples,
        concurrency,
        budgetP95Ms,
        dataScale: { tables: scales },
        measurements,
        error: e.message,
      },
      null,
      2,
    ) + '\n',
  );
  throw e;
} finally {
  await pool.end();
}
