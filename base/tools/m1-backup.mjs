import { readFile, writeFile, mkdir, readdir, lstat, copyFile } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';
import pg from 'pg';
import { databaseConnections } from '../src/platform/backup-connections.mjs';
const args = process.argv.slice(2),
  opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined),
  mode = args[0];
if (
  process.platform !== 'linux' ||
  !['create', 'verify', 'restore'].includes(mode) ||
  !args.includes('--backup')
)
  throw Error(
    'Ubuntu: m1-backup create|verify|restore --backup ABS_PATH [restore: --runtime NEW_ROOT --namespace NEW_PREFIX --base-port 4480 --idp-port 8380 --forum-port 4767 --nakama-port 7750]',
  );
const backup = resolve(opt('--backup')),
  sha = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8')),
  write = async (p, v) => {
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
  };
const files = [];
async function tree(from, to) {
  const st = await lstat(from);
  if (st.isSymbolicLink()) throw Error('Backup refuses a symlink in data: ' + from);
  if (st.isDirectory()) {
    await mkdir(to, { recursive: true, mode: 0o700 });
    for (const n of (await readdir(from)).sort()) await tree(join(from, n), join(to, n));
  } else if (st.isFile()) {
    await copyFile(from, to);
    files.push({
      path: relative(backup, to).split('\\').join('/'),
      bytes: st.size,
      sha256: sha(await readFile(to)),
    });
  } else throw Error('Unsupported data file');
}
async function run(command, argv, connection) {
  const u = new URL(connection),
    env = { ...process.env, PGPASSWORD: decodeURIComponent(u.password) };
  const child = spawn(
    command,
    [
      '--host',
      u.hostname,
      '--port',
      u.port || '5432',
      '--username',
      decodeURIComponent(u.username),
      '--dbname',
      u.pathname.slice(1),
      ...argv,
    ],
    { env, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let err = '';
  child.stderr.on('data', (b) => {
    err += b;
  });
  const code = await new Promise((r, j) => {
    child.on('error', j);
    child.on('exit', r);
  });
  if (code !== 0) throw Error(command + ' failed; original data preserved (exit ' + code + ')');
}
async function assertStopped(c,nativePorts) {
  const native = nativePorts||[];
  if(!nativePorts)for (const s of c.schools) {
    const forum = await json(join(c.configRoot, 'forum-' + s.schoolId + '.json'));
    const nakama = await json(join(c.configRoot, 'nakama-' + s.schoolId + '.json'));
    native.push(forum.port, nakama.socket.port);
  }
  const ports = [
    Number(c.port || new URL(c.origin).port),
    c.keycloakPort || Number(new URL(c.issuer).port),
    ...native,
  ];
  for (const port of ports)
    if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)
      throw Error('Configured internal service port missing; backup refused');
    else
      await new Promise((ok, bad) => {
        const server = net.createServer();
        server.once('error', () =>
          bad(Error('Stop the owned stack before backup/restore; occupied port ' + port)),
        );
        server.listen(port, '127.0.0.1', () => server.close(ok));
      });
}
async function verify() {
  const m = await json(join(backup, 'manifest.json'));
  if (m.format !== 'hyper-dimension.full-backup/v1' || m.complete !== true)
    throw Error('Incomplete backup');
  for (const f of m.files) {
    if (f.path.includes('..') || f.path.startsWith('/')) throw Error('Invalid backup path');
    const p = join(backup, f.path),
      s = await lstat(p);
    if (!s.isFile() || s.size !== f.bytes || sha(await readFile(p)) !== f.sha256)
      throw Error('Backup integrity failed: ' + f.path);
  }
  return m;
}
if (mode === 'verify') {
  const m = await verify();
  console.log(
    JSON.stringify({ verified: true, databases: m.databases.length, files: m.files.length }),
  );
} else if (mode === 'create') {
  const c = await json(process.env.HD_M0_CONFIG);
  await assertStopped(c);
  const dbs = await databaseConnections(c);
  for (const d of dbs) {
    const p = new pg.Client({ connectionString: d.url });
    await p.connect();
    try {
      if (
        (
          await p.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'",
          )
        ).rowCount
      )
        throw Error('Database still has clients: ' + d.id);
    } finally {
      await p.end();
    }
  }
  await mkdir(backup, { recursive: false, mode: 0o700 });
  await tree(c.configRoot, join(backup, 'private'));
  await tree(c.dataDir, join(backup, 'base-data'));
  for (const [from, name] of [
    [join(c.serviceRoot, 'keycloak/conf'), 'keycloak-conf'],
    [join(c.serviceRoot, 'keycloak/data/import'), 'keycloak-import'],
    [join(c.serviceRoot, 'keycloak/themes/hd-base'), 'keycloak-theme'],
    [join(c.serviceRoot, 'nodebb/public/uploads'), 'forum-uploads'],
  ])
    await tree(from, join(backup, name));
  for (const s of c.schools) {
    await tree(join(c.serviceRoot, 'nakama-' + s.schoolId), join(backup, 'nakama-' + s.schoolId));
    await tree(dirname(s.package), join(backup, 'spaces', s.schoolId));
  }
  for (const d of dbs) {
    const path = 'databases/' + d.id + '.dump';
    await mkdir(dirname(join(backup, path)), { recursive: true, mode: 0o700 });
    await run(
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-acl', '--file', join(backup, path)],
      d.url,
    );
    const bytes = await readFile(join(backup, path));
    files.push({ path, bytes: bytes.length, sha256: sha(bytes) });
  }
  const manifest = {
    format: 'hyper-dimension.full-backup/v1',
    complete: true,
    createdAt: new Date().toISOString(),
    consistency:
      'all owned writers stopped; no remaining DB clients; dumps and file checksums verified',
    databases: dbs.map((d) => ({ id: d.id })),
    files,
    original: { origin: c.origin, issuer: c.issuer },
    codeRequirements: await json('integrations/versions.json'),
  };
  await write(join(backup, 'manifest.json'), manifest);
  await verify();
  console.log(
    JSON.stringify({ backup, databases: dbs.length, files: files.length, private: true }),
  );
} else {
  const manifest = await verify();
  if (!['--runtime', '--namespace'].every((k) => args.includes(k)))
    throw Error('Restore needs new runtime and database namespace');
  const root = resolve(opt('--runtime')),
    ns = opt('--namespace');
  if (!/^[a-z][a-z0-9_]{2,30}$/.test(ns)) throw Error('Invalid namespace');
  try {
    await lstat(root);
    throw Error('Restore root already exists; refusing overwrite');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (!process.env.HD_M0_PG_ADMIN) throw Error('Restore needs private HD_M0_PG_ADMIN');
  const admin = new pg.Client({ connectionString: process.env.HD_M0_PG_ADMIN });
  await admin.connect();
  try {
    const names = manifest.databases.map((d) => ns + '_' + d.id);
    if (
      (
        await admin.query(
          'SELECT 1 FROM pg_database WHERE datname=ANY($1) UNION ALL SELECT 1 FROM pg_roles WHERE rolname=ANY($1)',
          [names],
        )
      ).rowCount
    )
      throw Error('Restore namespace exists; nothing changed');
    const c = await json(join(backup, 'private/config.json'));
    c.serviceRoot = root;
    c.configRoot = join(root, 'private');
    c.dataDir = join(root, 'base-data');
    c.origin = 'http://127.0.0.1:' + Number(opt('--base-port') || 4480);
    c.port = Number(new URL(c.origin).port);
    const previousIssuer = c.issuer;
    const issuer = new URL(
      new URL(c.issuer).pathname,
      'http://127.0.0.1:' + Number(opt('--idp-port') || 8380),
    );
    c.issuer = issuer.href;
    c.keycloakPort = Number(issuer.port);
    c.relocatedFrom = { origin: manifest.original.origin, issuer: previousIssuer };
    for (const [i, s] of c.schools.entries()) {
      s.forumUrl = 'http://127.0.0.1:' + (Number(opt('--forum-port') || 4767) + i);
      s.nakamaUrl = 'http://127.0.0.1:' + (Number(opt('--nakama-port') || 7750) + i * 100);
    }
    await assertStopped(c,c.schools.flatMap(s=>[Number(new URL(s.forumUrl).port),Number(new URL(s.nakamaUrl).port)]));
    // Hash verification finishes before any target role, database or data directory is created.
    await mkdir(root, { recursive: false, mode: 0o700 });
    for (const name of [
      'private',
      'base-data',
      'keycloak-conf',
      'keycloak-import',
      'keycloak-theme',
      'forum-uploads',
      ...c.schools.map((s) => 'nakama-' + s.schoolId),
      'spaces',
    ])
      await tree(join(backup, name), join(root, name));
    const adminUrl = new URL(process.env.HD_M0_PG_ADMIN),
      host = process.env.HD_M0_PG_HOST || adminUrl.hostname || '127.0.0.1',
      port = adminUrl.port || '5432',
      urls = {};
    for (const [i, d] of manifest.databases.entries()) {
      const name = names[i],
        password = randomBytes(32).toString('base64url');
      await admin.query(`CREATE ROLE "${name}" LOGIN PASSWORD '${password}'`);
      await admin.query(`CREATE DATABASE "${name}" OWNER "${name}"`);
      const url = `postgresql://${name}:${password}@${host}:${port}/${name}`;
      urls[d.id] = url;
      if (d.id === 'knowledge') {
        // pgvector is installed by the database administrator. Do not give the
        // application role superuser just to restore an extension or its comment.
        const targetAdminUrl = new URL(process.env.HD_M0_PG_ADMIN);
        targetAdminUrl.pathname = '/' + name;
        const targetAdmin = new pg.Client({ connectionString: targetAdminUrl.href });
        await targetAdmin.connect();
        try {
          await targetAdmin.query('CREATE EXTENSION IF NOT EXISTS vector');
        } finally {
          await targetAdmin.end();
        }
      }
      await run(
        'pg_restore',
        [
          '--no-owner',
          '--no-acl',
          '--exit-on-error',
          ...(d.id === 'knowledge' ? ['--no-comments'] : []),
          join(backup, 'databases', d.id + '.dump'),
        ],
        url,
      );
    }
    c.databaseUrl = urls.base;
    const kc = await json(join(root, 'private/keycloak-env.json')),
      ku = new URL(urls.keycloak);
    kc.KC_DB_URL = `jdbc:postgresql://${host}:${port}${ku.pathname}`;
    kc.KC_DB_USERNAME = ku.username;
    kc.KC_DB_PASSWORD = ku.password;
    kc.KC_HTTP_MANAGEMENT_PORT = String(c.keycloakPort + 1);
    await write(join(root, 'private/keycloak-env.json'), kc);
    for (const [i, s] of c.schools.entries()) {
      s.package = join(root, 'spaces', s.schoolId, 'space.json');
      s.forumUrl = 'http://127.0.0.1:' + (Number(opt('--forum-port') || 4767) + i);
      s.nakamaUrl = 'http://127.0.0.1:' + (Number(opt('--nakama-port') || 7750) + i * 100);
      for (const prefix of ['forum-', 'forum-setup-']) {
        const f = await json(join(root, 'private', prefix + s.schoolId + '.json')),
          u = new URL(urls[s.schoolId + '_forum']);
        f.url = s.forumUrl;
        f.port = Number(new URL(s.forumUrl).port);
        Object.assign(f.postgres, {
          host,
          port: Number(port),
          username: u.username,
          password: u.password,
          database: u.pathname.slice(1),
        });
        f.hd.baseUrl = c.origin;
        await write(join(root, 'private', prefix + s.schoolId + '.json'), f);
      }
      const n = await json(join(root, 'private', 'nakama-' + s.schoolId + '.json'));
      n.data_dir = join(root, 'nakama-' + s.schoolId);
      n.database.address = [urls[s.schoolId + '_nakama'].replace('postgresql://', '')];
      n.socket.port = Number(new URL(s.nakamaUrl).port);
      n.console.port = n.socket.port + 1;
      n.runtime.env = n.runtime.env.map((x) =>
        x.startsWith('HD_BASE_URL=') ? 'HD_BASE_URL=' + c.origin : x,
      );
      await write(join(root, 'private', 'nakama-' + s.schoolId + '.json'), n);
    }
    if (urls.knowledge) {
      const k = await json(join(root, 'base-data/knowledge.json'));
      let env = {};
      try {
        env = await json(join(root, 'private/runtime-env.json'));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      env[k.database.connectionEnv || 'HDBASE_DATABASE_URL'] = urls.knowledge;
      await write(join(root, 'private/runtime-env.json'), env);
    }
    const p = new pg.Client({ connectionString: c.databaseUrl });
    await p.connect();
    try {
      await p.query('UPDATE hd_users SET issuer=$2 WHERE issuer=$1', [previousIssuer, c.issuer]);
    } finally {
      await p.end();
    }
    await write(join(root, 'private/config.json'), c);
    await write(join(root, 'restore-report.json'), {
      status: 'RESTORED_NEEDS_BINARY_BINDING_AND_CLIENT_RELOCATION',
      databases: names.length,
      sourceUnchanged: true,
      issuerRelocationPreservesUserIds: true,
      restoredAt: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        root,
        databases: names.length,
        status:
          'data restored; attach exact pinned service binaries and run m1-relocate-client after startup',
        sourceUnchanged: true,
      }),
    );
  } finally {
    await admin.end();
  }
}
