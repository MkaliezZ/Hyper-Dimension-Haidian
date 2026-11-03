import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { openKnowledge } from '../src/knowledge/index.mjs';
import { exampleScene, packageFor } from '../tools/fixtures.mjs';
if (
  process.platform !== 'linux' ||
  process.env.HD_M1_TEST_FIXTURE !== '1' ||
  process.env.HD_KNOWLEDGE_TEST_PROVISION !== '1'
)
  throw Error('Explicit isolated PostgreSQL test provisioning required');
const suffix = Date.now().toString(36),
  role = 'hdkbqa_' + suffix,
  source = role + '_source',
  clone = role + '_restore',
  password = randomBytes(24).toString('hex');
function run(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (r.status !== 0)
    throw Error(
      command +
        ' failed; no pre-existing databases were modified: ' +
        String(r.stderr || r.error?.code || '').replaceAll(password, '[redacted]'),
    );
  return r.stdout;
}
const sql = (s) =>
  run(
    '/usr/sbin/runuser',
    ['-u', 'postgres', '--', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'],
    { input: s },
  );
sql(
  `CREATE ROLE ${role} LOGIN PASSWORD '${password}'; CREATE DATABASE ${source} OWNER ${role}; CREATE DATABASE ${clone} OWNER ${role};`,
);
for (const name of [source, clone])
  run('/usr/sbin/runuser', [
    '-u',
    'postgres',
    '--',
    'psql',
    '-d',
    name,
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
    '-c',
    'CREATE EXTENSION vector',
  ]);
const uri = (name) => `postgresql://${role}:${password}@127.0.0.1:5432/${name}`;
const dir = resolve('.local/knowledge-postgres-' + suffix);
await mkdir(dir, { recursive: true, mode: 0o700 });
await writeFile(
  resolve('.local/knowledge-postgres.json'),
  JSON.stringify({ source: uri(source), clone: uri(clone), directory: dir }, null, 2),
  { mode: 0o600 },
);
process.env.HD_KNOWLEDGE_TEST_URL = uri(source);
const config = {
  database: { provider: 'postgres', connectionEnv: 'HD_KNOWLEDGE_TEST_URL' },
  embedding: {},
  minScore: 0.5,
};
let broken = false,
  kb,
  restored;
const seen = [],
  checks = [];
const embedding = {
  identity: 'explicit-fixture-vector-v1',
  model: 'fixture-no-external-model',
  dimensions: 3,
  async embed(texts) {
    seen.push(...texts);
    return texts.map((t) => (broken ? [1, 0] : t.includes('借') ? [1, 0, 0] : [0, 1, 0]));
  },
};
const principal = { id: 'fixture', spaces: ['north'], scopes: ['a2a:call', 'public:read'] },
  pack = packageFor(exampleScene(), 'north', '北岸');
try {
  kb = await openKnowledge({ dataDir: dir, config, embedding, migrate: true });
  const docs = [
    { id: 'borrow', title: '图书借阅', body: '借书须出示校园卡。', published: true, revision: 2 },
    { id: 'private', body: 'DO_NOT_EMBED_PRIVATE', published: false },
  ];
  assert.equal((await kb.import('north', docs)).excluded, 1);
  assert(!seen.join('').includes('DO_NOT_EMBED_PRIVATE'));
  await kb.import('south', [
    { id: 'south', title: '南校借阅', body: '南校借书使用南校凭证。', published: true },
  ]);
  const rows = await kb.retrieve(pack, principal, '借书');
  assert.equal(rows[0].body, docs[0].body);
  assert.equal(rows[0].revision, 2);
  await assert.rejects(kb.retrieve({ spaceId: 'south' }, principal, '借书'), /permission/);
  checks.push({
    name: 'native PostgreSQL vector retrieval enforces school scope and pre-embedding publication',
    status: 'PASS',
  });
  broken = true;
  await assert.rejects(
    kb.import('north', [{ ...docs[0], body: '借书使用新卡' }], { replace: true }),
    /dimensions mismatch/,
  );
  broken = false;
  assert.equal((await kb.retrieve(pack, principal, '借书'))[0].body, docs[0].body);
  checks.push({
    name: 'failed replacement rolls back the previous reviewed snapshot',
    status: 'PASS',
  });
  await kb.close();
  kb = await openKnowledge({ dataDir: dir, config, embedding });
  assert.equal((await kb.retrieve(pack, principal, '借书'))[0].id, rows[0].id);
  checks.push({
    name: 'new client session reads the same persisted source identity',
    status: 'PASS',
  });
  const dump = resolve(dir, 'knowledge.dump'),
    env = { ...process.env, PGPASSWORD: password };
  run('pg_dump', ['-h', '127.0.0.1', '-U', role, '-d', source, '--format=custom', '--file', dump], {
    env,
  });
  run(
    'pg_restore',
    [
      '-h',
      '127.0.0.1',
      '-U',
      role,
      '-d',
      clone,
      '--no-owner',
      '--no-privileges',
      '--no-comments',
      '--exit-on-error',
      dump,
    ],
    { env },
  );
  process.env.HD_KNOWLEDGE_TEST_URL = uri(clone);
  restored = await openKnowledge({ dataDir: dir, config, embedding });
  assert.deepEqual(
    await restored.retrieve(pack, principal, '借书'),
    await kb.retrieve(pack, principal, '借书'),
  );
  await kb.import('north', [{ id: 'borrow', published: false }], { replace: true });
  assert.equal((await kb.status('north')).chunks, 0);
  assert.equal(await kb.hasSources('north', [rows[0].id]), false);
  assert.equal((await kb.status('south')).chunks, 1);
  assert.equal((await restored.status('north')).chunks, 1);
  checks.push({
    name: 'native pg_dump/pg_restore preserves vectors; withdrawal affects only source school and never restored clone',
    status: 'PASS',
  });
  const pool = new Pool({ connectionString: uri(source) });
  let versions;
  try {
    versions = (
      await pool.query(
        "SELECT current_setting('server_version') AS postgres,(SELECT extversion FROM pg_extension WHERE extname='vector') AS pgvector",
      )
    ).rows[0];
  } finally {
    await pool.end();
  }
  await mkdir('qa/campus', { recursive: true });
  await writeFile(
    'qa/campus/knowledge-postgres.json',
    JSON.stringify(
      {
        status: 'PASS',
        versions,
        checks,
        scope:
          'Dedicated new PostgreSQL databases on WSL Ubuntu; explicit deterministic embedding fixture; no live model or target production server claim',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS native PostgreSQL knowledge ' + checks.length + ' groups');
} finally {
  await kb?.close();
  await restored?.close();
}
