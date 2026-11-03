import { readFile, writeFile, cp, mkdir, stat, readdir, chown, chmod } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import { receptionEnvironment } from './reception-env.mjs';
const root = process.env.HD_SERVICE_ROOT || '/runtime/services',
  cfg = root + '/private',
  json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const write = async (p, x) => writeFile(p, JSON.stringify(x, null, 2) + '\n', { mode: 0o600 });
const mode = process.argv[2],
  side = process.argv[3],
  school = process.argv[4];
const schoolDefinitionsHash = process.env.HD_SCHOOLS_FILE
  ? createHash('sha256').update(await readFile(process.env.HD_SCHOOLS_FILE)).digest('hex') : null;
async function pluginHash(dir) {
  const hash = createHash('sha256');
  for (const name of (await readdir(dir)).sort()) {
    const data = await readFile(dir + '/' + name);
    hash.update(name);
    hash.update(data);
  }
  return hash.digest('hex');
}
async function run(command, args, options = {}) {
  const p = spawn(command, args, { stdio: 'inherit', ...options });
  const code = await new Promise((resolve, reject) => {
    p.once('error', reject);
    p.once('exit', resolve);
  });
  if (code !== 0) throw Error('Owned container command failed: ' + command + ' (' + code + ')');
}
async function exec(command, args, options = {}) {
  const p = spawn(command, args, { stdio: 'inherit', ...options });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => p.kill(signal));
  const code = await new Promise((r, j) => {
    p.once('error', j);
    p.once('exit', r);
  });
  process.exitCode = code ?? 1;
}
if (mode === 'init') {
  await mkdir('/backups', { recursive: true, mode: 0o700 });
  await chown('/backups', 10001, 10001);
  await chmod('/backups', 0o700);
  const stamp = '/runtime/initialized.json';
  try {
    const old = await json(stamp);
    if (old.namespace !== process.env.HD_NAMESPACE)
      throw Error('Existing runtime namespace differs; preserved');
    if ((old.schoolDefinitionsHash || null) !== schoolDefinitionsHash)
      throw Error('Existing school identities differ; runtime preserved');
    const existing = await json(cfg + '/config.json');
    if (
      existing.origin !== process.env.HD_PUBLIC_ORIGIN ||
      existing.issuer !== process.env.HD_IDP_ORIGIN + '/realms/hd-base' ||
      existing.port !== Number(process.env.HD_BASE_PORT) ||
      existing.keycloakPort !== Number(process.env.HD_IDP_PORT)
    )
      throw Error(
        'Existing canonical origins or ports differ; runtime preserved. Review a deliberate relocation instead of silently replacing configuration.',
      );
    const desired = await pluginHash('/app/integrations/nodebb');
    const installed = await pluginHash(root + '/nodebb/hd-plugin');
    if (installed !== desired) {
      if (old.pluginHash ? old.pluginHash !== installed : !old.fixtureOnly)
        throw Error('Existing integration differs from recorded source; preserved for review');
      await run(process.execPath, ['tools/m0-patch-nodebb.cjs', root + '/nodebb']);
      await write(stamp, {
        ...old,
        pluginHash: desired,
        integrationUpdatedAt: new Date().toISOString(),
      });
    }
    console.log('Existing initialized runtime retained; no data or secrets replaced');
    process.exit(0);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (process.env.HD_M1_TEST_FIXTURE !== '1') {
    const smtp = await json('/run/secrets/smtp_config').catch(() => {
      throw Error(
        'Provide HD_SMTP_FILE before formal initialization; no accounts or DBs were created',
      );
    });
    if (!smtp.host || !smtp.from)
      throw Error(
        'Formal registration needs real SMTP host/from; placeholder was refused before creating accounts or databases',
      );
  }
  await stat(root).then(
    () => {
      throw Error(
        'Partial/existing service root preserved. Inspect initialization failure; do not delete or reuse existing DB namespace',
      );
    },
    (e) => {
      if (e.code !== 'ENOENT') throw e;
    },
  );
  const password = (await readFile('/run/secrets/postgres_password', 'utf8')).trim();
  const pgPort = process.env.HD_PG_PORT || '55439';
  const u = new URL('postgresql://127.0.0.1:' + pgPort + '/postgres');
  u.username = 'hd_bootstrap';
  u.password = password;
  const admin = new pg.Client({ connectionString: u.href });
  await admin.connect();
  const ns = process.env.HD_NAMESPACE;
  if (!/^[a-z][a-z0-9_]{2,30}$/.test(ns)) throw Error('New namespace required');
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname LIKE $1', [ns + '_%']);
  if (exists.rowCount) throw Error('Existing namespace preserved');
  await cp('/opt/hd-services', root, {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
  });
  const fixtures = process.env.HD_M1_TEST_FIXTURE === '1',
    env = {
      ...process.env,
      HD_M0_PG_ADMIN: u.href,
      HD_M1_ORIGIN: process.env.HD_PUBLIC_ORIGIN,
      HD_M1_ISSUER: process.env.HD_IDP_ORIGIN + '/realms/hd-base',
      HD_M1_FORUM_PORT: process.env.HD_FORUM_PORT,
      HD_M1_NAKAMA_PORT: process.env.HD_NAKAMA_PORT,
      ...(!fixtures ? { HD_M1_SMTP_FILE: '/run/secrets/smtp_config' } : {}),
    };
  await run(
    process.execPath,
    [
      'tools/campus-init.mjs',
      '--runtime',
      root,
      '--namespace',
      ns,
      ...(process.env.HD_SCHOOLS_FILE ? ['--schools',process.env.HD_SCHOOLS_FILE] : []),
      ...(fixtures ? ['--fixtures'] : []),
    ],
    { env },
  );
  const c = await json(cfg + '/config.json');
  c.port = Number(process.env.HD_BASE_PORT);
  c.keycloakPort = Number(process.env.HD_IDP_PORT);
  await write(cfg + '/config.json', c);
  const name = ns + '_knowledge',
    pw = randomBytes(32).toString('base64url');
  await admin.query(`CREATE ROLE "${name}" LOGIN PASSWORD '${pw}'`);
  await admin.query(`CREATE DATABASE "${name}" OWNER "${name}"`);
  const ku = new URL(u);
  ku.pathname = '/' + name;
  const kd = new pg.Client({ connectionString: ku.href });
  await kd.connect();
  await kd.query('CREATE EXTENSION IF NOT EXISTS vector');
  await kd.end();
  ku.username = name;
  ku.password = pw;
  await mkdir(c.dataDir, { recursive: true });
  await write(c.dataDir + '/knowledge.json', {
    database: { provider: 'postgres', connectionEnv: 'HDBASE_DATABASE_URL' },
    embedding: {
      provider: 'onnx',
      python: '/opt/embedding/bin/python',
      modelDir: 'models/bge-small-zh-v1.5',
    },
    topK: 4,
    minScore: 0.45,
  });
  await write(cfg + '/runtime-env.json', { HDBASE_DATABASE_URL: ku.href });
  const knowledgeEnv = { ...env, HDBASE_DATABASE_URL: ku.href };
  await run(process.execPath, ['tools/knowledge.mjs', 'init', '--data', c.dataDir], {
    env: knowledgeEnv,
  });
  await run(process.execPath, ['tools/m0-services.mjs', 'setup'], { env });
  await write(stamp, {
    schema: 'hyper-dimension.container/v1',
    namespace: ns,
    fixtureOnly: fixtures,
    schoolDefinitionsHash,
    pluginHash: await pluginHash('/app/integrations/nodebb'),
    createdAt: new Date().toISOString(),
  });
  const own = spawnSync('chown', ['-R', '10001:10001', '/runtime']);
  if (own.status !== 0) throw Error('Runtime ownership setup failed');
  await admin.end();
  console.log(
    'Configured school service databases and pgvector; secrets remain in the private runtime volume.',
  );
} else {
  const c = await json(cfg + '/config.json');
  let env = { ...process.env, ...(await json(cfg + '/runtime-env.json')) };
  if (mode === 'health') {
    let response;
    if (side === 'keycloak')
      response = await fetch(c.issuer + '/.well-known/openid-configuration', {
        signal: AbortSignal.timeout(3000),
      });
    else if (side === 'base')
      response = await fetch('http://127.0.0.1:' + c.port + '/health', {
        signal: AbortSignal.timeout(3000),
      });
    else {
      const s = c.schools.find((s) => s.schoolId === school);
      if (!s) throw Error('Unknown health school');
      response = await fetch(
        side === 'forum' ? s.forumUrl + '/api/hd/health' : s.nakamaUrl + '/healthcheck',
        {
          ...(side === 'forum'
            ? {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-HD-Service-Key': s.forumKey },
                body: '{}',
              }
            : {}),
          signal: AbortSignal.timeout(3000),
        },
      );
      if (side === 'forum') {
        const v = await response.json();
        if (v.schoolId !== school || v.gate !== 'active')
          throw Error('Forum isolation gate unavailable');
      }
    }
    if (!response.ok) throw Error('Service is not healthy');
  } else if (mode === 'keycloak') {
    env = { ...env, ...(await json(cfg + '/keycloak-env.json')) };
    env.JAVA_OPTS_APPEND = (env.JAVA_OPTS_APPEND || '') + ' -Xms128m -Xmx640m';
    await exec(
      root + '/keycloak/bin/kc.sh',
      [
        'start',
        '--optimized',
        '--http-enabled=true',
        '--http-host=127.0.0.1',
        '--http-port=' + c.keycloakPort,
        '--hostname=' + new URL(c.issuer).origin,
        '--cache=local',
        '--http-management-port=' + (c.keycloakPort + 1),
        '--proxy-headers=xforwarded',
        '--proxy-trusted-addresses=127.0.0.1/32,::1/128',
        '--import-realm',
      ],
      { env },
    );
  } else if (mode === 'forum') {
    if (!c.schools.some((s) => s.schoolId === side)) throw Error('Unknown forum school');
    await exec(
      process.execPath,
      [root + '/nodebb/app.js', '--config', cfg + '/forum-' + side + '.json', '--no-daemon'],
      { cwd: root + '/nodebb', env },
    );
  } else if (mode === 'nakama') {
    if (!c.schools.some((s) => s.schoolId === side)) throw Error('Unknown Nakama school');
    await exec(root + '/nakama/nakama', ['--config', cfg + '/nakama-' + side + '.json'], { env });
  } else if (mode === 'base') {
    env = await receptionEnvironment({ env, configRoot: cfg });
    await exec(process.execPath, ['tools/m0-serve.mjs'], { env });
  }
  else if (mode === 'seed-fixtures') {
    if (process.env.HD_M1_TEST_FIXTURE !== '1')
      throw Error('Explicit isolated fixture mode required');
    const stamp = await json('/runtime/initialized.json');
    if (stamp.fixtureOnly !== true) throw Error('Not an isolated fixture runtime');
    await run(process.execPath, ['tools/m0-seed-fixtures.mjs', '--allow-fixtures'], {
      env: { ...env, HD_M0_USERS: cfg + '/test-users.json' },
    });
    const client = new pg.Client({ connectionString: c.databaseUrl });
    await client.connect();
    try {
      for (const [schoolId, username] of [
        ['north', 'moda'],
        ['south', 'modb'],
      ]) {
        const hasOwner = (
          await client.query(
            "SELECT 1 FROM hd_memberships WHERE school_id=$1 AND role='owner' AND active",
            [schoolId],
          )
        ).rowCount;
        if (!hasOwner)
          await run(
            process.execPath,
            ['tools/m1-bootstrap-owner.mjs', '--school', schoolId, '--username', username],
            { env },
          );
      }
    } finally {
      await client.end();
    }
  } else if (mode === 'backup') {
    const selected = await json(process.env.HD_M0_CONFIG || cfg + '/config.json');
    let selectedEnvironment = {};
    try {
      selectedEnvironment = await json(selected.configRoot + '/runtime-env.json');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await run(process.execPath, ['tools/m1-backup.mjs', ...process.argv.slice(3)], {
      env: { ...process.env, ...selectedEnvironment },
    });
  } else if (mode === 'status') await run(process.execPath, ['tools/m1-status.mjs'], { env });
  else throw Error('Unknown container role');
}
