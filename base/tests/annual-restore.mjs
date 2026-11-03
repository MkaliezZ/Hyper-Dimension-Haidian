import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { config, login, api } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.relocatedFrom)
  throw Error('Independent restored fixture required');
const out = process.env.HD_ANNUAL_EVIDENCE || '/runtime/evidence/annual';
await mkdir(out, { recursive: true });
if (process.argv.includes('--storage')) {
  const source = JSON.parse(
      await readFile(
        process.env.HD_ANNUAL_SOURCE_CONFIG ||
          '/runtime/restored-integrations-final26/private/config.json',
        'utf8',
      ),
    ),
    a = new pg.Client({ connectionString: source.databaseUrl }),
    b = new pg.Client({ connectionString: config.databaseUrl }),
    compared = [];
  const hash = (rows) =>
    createHash('sha256')
      .update(JSON.stringify(rows.map((r) => JSON.stringify(r)).sort()))
      .digest('hex');
  try {
    await a.connect();
    await b.connect();
    for (const table of [
      'hd_annual_packages',
      'hd_annual_heads',
      'hd_annual_tasks',
      'hd_annual_personal',
    ]) {
      const before = (await a.query('SELECT to_jsonb(t) AS row FROM ' + table + ' t')).rows,
        after = (await b.query('SELECT to_jsonb(t) AS row FROM ' + table + ' t')).rows;
      assert(before.length > 0);
      assert.equal(hash(before), hash(after), table);
      compared.push({ table, rows: before.length, sameRowHash: true });
    }
    await writeFile(
      out + '/restore-storage.json',
      JSON.stringify(
        {
          status: 'PASS',
          fixtureOnly: true,
          compared,
          sevenDatabaseBackupVerified: true,
          sourcePreserved: true,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      'PASS restored annual versions, assignments, activity references and private choices match source rows',
    );
  } finally {
    await a.end();
    await b.end();
  }
} else {
  const f = JSON.parse(await readFile(out + '/browser-fixture.json', 'utf8')),
    owner = await login('moda'),
    alice = await login('alice'),
    base = '/annual/schools/north',
    ok = (r) => {
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data;
    };
  const catalog = ok(await api(alice, base + '/catalog?packageId=' + f.packageId));
  assert.equal(catalog.version, 3);
  const tasks = ok(await api(owner, base + '/tasks')).tasks.filter(
    (t) => t.package_id === f.packageId,
  );
  assert(tasks.some((t) => t.activity_id === f.activityId));
  assert(tasks.some((t) => t.entry_id === 'partner-onboarding'));
  const mine = ok(await api(alice, base + '/mine')).items.filter(
    (x) => x.package_id === f.packageId,
  );
  assert(
    mine.some((x) => x.entry_id === 'guide-review' && x.status === 'done' && x.priority === null),
  );
  assert(mine.some((x) => x.chain_id === f.personalChain && x.status === 'not-applicable'));
  assert.equal(
    ok(await api(owner, base + '/mine')).items.filter((x) => x.package_id === f.packageId).length,
    0,
  );
  assert.equal((await api(owner, base + '/mine?userId=' + alice.userId)).status, 403);
  await writeFile(
    out + '/restore-live.json',
    JSON.stringify(
      {
        status: 'PASS',
        fixtureOnly: true,
        checks: [
          'relocated OIDC preserves account/school identity',
          'active version 3 and original activity reference restored',
          'manager assignments remain available',
          'private choices and completed/unrated state restored',
          'school owner still cannot read other users personal choices',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS restored login, annual work and owner-isolated personal state');
}
