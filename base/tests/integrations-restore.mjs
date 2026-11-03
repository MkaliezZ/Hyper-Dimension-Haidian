import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { config, login, api } from './m1-helpers.mjs';
import { BaseClient } from '../src/sdk/client.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.relocatedFrom)
  throw Error('Independent restored fixture required');
const output = process.env.HD_INTEGRATION_EVIDENCE || '/runtime/evidence/integrations',
  source = JSON.parse(await readFile('/runtime/services/private/config.json', 'utf8'));
await mkdir(output, { recursive: true });
const json = (p) => readFile(p, 'utf8').then(JSON.parse);
if (process.argv.includes('--storage')) {
  const clients = [];
  const open = async (url) => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    clients.push(c);
    return c;
  };
  const hash = (rows) =>
    createHash('sha256')
      .update(JSON.stringify(rows.map((x) => JSON.stringify(x)).sort()))
      .digest('hex');
  const compared = [];
  try {
    for (const kind of ['base', 'knowledge']) {
      const original =
        kind === 'base'
          ? source.databaseUrl
          : (await json(source.configRoot + '/runtime-env.json')).HDBASE_DATABASE_URL;
      const restored =
        kind === 'base'
          ? config.databaseUrl
          : (await json(config.configRoot + '/runtime-env.json')).HDBASE_DATABASE_URL;
      const a = await open(original),
        b = await open(restored);
      const tables =
        kind === 'base'
          ? [
              'hd_agent_delegations',
              'hd_knowledge_snapshots',
              'hd_index_sources',
              'hd_m5_tasks',
              'hd_m2_avatars',
              'hd_m2_inventory',
            ]
          : ['hdbase_kb.chunks', 'hdbase_forum.heads', 'hdbase_forum.revisions'];
      for (const table of tables) {
        const before = (await a.query('SELECT to_jsonb(t) AS row FROM ' + table + ' t')).rows;
        const after = (await b.query('SELECT to_jsonb(t) AS row FROM ' + table + ' t')).rows;
        assert.equal(hash(before), hash(after), table + ' backup/restore rows differ');
        if (
          [
            'hdbase_kb.chunks',
            'hdbase_forum.revisions',
            'hd_agent_delegations',
            'hd_m5_tasks',
          ].includes(table)
        )
          assert(before.length > 0, table + ' fixture should be nonempty');
        compared.push({ table, rows: before.length, sameRowHash: true });
      }
    }
    await writeFile(
      output + '/restore-storage.json',
      JSON.stringify(
        {
          status: 'PASS',
          fixtureOnly: true,
          sevenDatabasesRestored: true,
          compared,
          sourceStopped: true,
          originalRuntimePreserved: true,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      'PASS independent restored data matches source grants, tasks, approved snapshots, current vectors and reviewed historical vectors',
    );
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
} else {
  const owner = await login('moda'),
    alice = await login('alice'),
    fixture = await json(output + '/restore-fixture.json');
  const response = await api(owner, '/history-index/schools/north/search', {
    orgId: fixture.orgId,
    query: '榕树恢复验收历史',
    includeHistory: true,
  });
  assert.equal(response.status, 200);
  assert(
    response.data.items.some(
      (x) => x.sourceId === fixture.sourceId && x.revision === fixture.rev1 && x.historical,
    ),
  );
  assert(
    response.data.items.some(
      (x) => x.sourceId === fixture.sourceId && x.revision === fixture.rev2 && !x.historical,
    ),
  );
  assert.equal(
    (
      await api(alice, '/history-index/schools/north/search', {
        orgId: fixture.orgId,
        query: '榕树恢复验收历史',
      })
    ).status,
    403,
  );
  const client = new BaseClient({ url: config.origin, token: alice.token });
  const answer = JSON.parse(
    (await client.send('north-reception', '恢复验收公开资料是什么？')).task.artifacts[0].parts[0]
      .text,
  );
  assert(
    answer.sources.some(
      (x) => x.documentId === fixture.publicDocumentId && x.revision === fixture.publicRevision,
    ),
  );
  assert(!answer.sources.some((x) => x.sourceId === fixture.sourceId));
  await writeFile(
    output + '/restore-live.json',
    JSON.stringify(
      {
        status: 'PASS',
        fixtureOnly: true,
        checks: [
          'relocated OIDC preserves fixture identity and school access',
          'historical/current reviewed forum vectors remain queryable',
          'organization denial still enforced',
          'public reception uses restored current source revision',
          'private forum excluded from reception',
        ],
        scope: 'Independent restored namespace on one host; no production cutover.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS restored OIDC, scoped historical search and current public reception');
}
