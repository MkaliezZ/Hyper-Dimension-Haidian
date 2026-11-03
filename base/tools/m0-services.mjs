import { readFile, writeFile, mkdir, open, access, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createHash } from 'node:crypto';
const path = process.env.HD_M0_CONFIG;
if (!path) throw Error('Set HD_M0_CONFIG to the private M0 config');
const config = JSON.parse(await readFile(path, 'utf8')),
  root = config.serviceRoot,
  cfg = config.configRoot || dirname(resolve(path));
if (!root || process.platform !== 'linux')
  throw Error('This service launcher targets Ubuntu/Linux and needs serviceRoot in config');
const base = resolve(fileURLToPath(new URL('..', import.meta.url))),
  node = join(root, 'node/bin/node');
const env = {
  ...process.env,
  PATH: join(root, 'node/bin') + ':' + process.env.PATH,
  HD_M0_CONFIG: resolve(path),
};
try {
  Object.assign(env, JSON.parse(await readFile(join(cfg, 'runtime-env.json'), 'utf8')));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const logs = join(root, 'logs');
await mkdir(logs, { recursive: true, mode: 0o700 });
async function run(name, command, args, options = {}) {
  const log = await open(join(logs, name + '.log'), 'a', 0o600);
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ['ignore', log.fd, log.fd],
    ...options,
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  await log.close();
  if (code !== 0) throw Error(name + ' failed (' + code + '); inspect private service log');
}
if (process.argv[2] === 'stop') {
  const info = JSON.parse(await readFile(join(logs, 'owned-processes.json'), 'utf8'));
  let cmd;
  try {
    cmd = await readFile('/proc/' + info.supervisor + '/cmdline', 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('Recorded M0 supervisor has already stopped');
    process.exit(0);
  }
  if (
    !cmd.includes('m0-services.mjs') ||
    (await readFile('/proc/' + info.supervisor + '/environ', 'utf8').then(
      (s) => !s.split('\0').includes('HD_M0_CONFIG=' + resolve(path)),
    ))
  )
    throw Error('PID ownership mismatch; no process was stopped');
  process.kill(info.supervisor, 'SIGTERM');
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      process.kill(info.supervisor, 0);
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      console.log('Owned M0 stack stopped gracefully');
      process.exit(0);
    }
  }
  throw Error('Graceful shutdown is still pending; no forced termination was attempted');
} else if (process.argv[2] === 'setup') {
  for (const s of config.schools) {
    const id = s.schoolId,
      fp = join(cfg, 'forum-' + id + '.json'),
      original = JSON.parse(await readFile(fp));
    await run(
      'forum-' + id + '-setup',
      node,
      [
        'nodebb',
        '--config',
        fp,
        'setup',
        await readFile(join(cfg, 'forum-setup-' + id + '.json'), 'utf8'),
        '--skip-build',
      ],
      { cwd: join(root, 'nodebb') },
    );
    // Preserve bridge and independent cookie settings if upstream setup omits unknown fields.
    const saved = JSON.parse(await readFile(fp));
    await writeFile(
      fp,
      JSON.stringify(
        {
          ...saved,
          hd: original.hd,
          bind_address: '127.0.0.1',
          trust_proxy: false,
          runJobs: false,
          sessionKey: original.sessionKey,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
    await run(
      'forum-' + id + '-activate',
      node,
      ['nodebb', '--config', fp, 'activate', 'hd-base'],
      { cwd: join(root, 'nodebb') },
    );
    await run(
      'forum-' + id + '-disable-push',
      node,
      ['nodebb', '--config', fp, 'reset', '-p', 'nodebb-plugin-web-push'],
      { cwd: join(root, 'nodebb') },
    );
    await run('nakama-' + id + '-migrate', join(root, 'nakama/nakama'), [
      'migrate',
      'up',
      '--config',
      join(cfg, 'nakama-' + id + '.json'),
    ]);
  }
  await run(
    'forum-build',
    node,
    [
      'nodebb',
      '--config',
      join(cfg, 'forum-' + config.schools[0].schoolId + '.json'),
      'build',
      '--series',
    ],
    { cwd: join(root, 'nodebb') },
  );
  console.log(
    'M0 service setup completed. Start services, then seed only the generated fictional fixture accounts if requested.',
  );
} else if (process.argv[2] === 'start') {
  const installed = join(root, 'nodebb/node_modules/nodebb-plugin-hd-base');
  const fingerprint = (b) => createHash('sha256').update(b).digest('hex');
  for (const entry of await readdir(join(base, 'integrations/nodebb'), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (
      fingerprint(await readFile(join(installed, entry.name))) !==
      fingerprint(await readFile(join(base, 'integrations/nodebb', entry.name)))
    )
      throw Error(
        'Mandatory school isolation plugin missing or stale; no service was started. Reinstall/update the pinned local plugin first.',
      );
  }
  const ports = [
    config.port || 4280,
    config.keycloakPort || 8180,
    ...config.schools.flatMap((s) => [
      Number(new URL(s.forumUrl).port),
      Number(new URL(s.nakamaUrl).port),
    ]),
  ];
  for (const port of ports) {
    await new Promise((ok, bad) => {
      const s = net.createServer();
      s.once('error', () =>
        bad(Error('Port ' + port + ' is occupied; no existing service was stopped')),
      );
      s.listen(port, '127.0.0.1', () => s.close(ok));
    });
  }
  const children = [],
    handles = [];
  async function start(name, command, args, options = {}) {
    const log = await open(join(logs, name + '.log'), 'a', 0o600);
    handles.push(log);
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: ['ignore', log.fd, log.fd],
      ...options,
    });
    children.push(child);
    child.on('error', (e) => {
      console.error(name + ': ' + e.message);
      close(1);
    });
    child.on('exit', (code) => {
      if (!closing) {
        console.error(name + ' exited (' + code + '); stopping owned M0 children');
        close(1);
      }
    });
  }
  let closing = false;
  async function close(code = 0) {
    if (closing) return;
    closing = true;
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.all(
      children.map((child) =>
        child.exitCode !== null ? Promise.resolve() : new Promise((r) => child.once('exit', r)),
      ),
    );
    for (const h of handles) await h.close();
    process.exit(code);
  }
  const kcEnv = JSON.parse(await readFile(join(cfg, 'keycloak-env.json'), 'utf8'));
  await start(
    'keycloak',
    join(root, 'keycloak/bin/kc.sh'),
    [
      'start-dev',
      '--http-host=127.0.0.1',
      '--http-port=' + (config.keycloakPort || 8180),
      '--import-realm',
    ],
    { env: { ...env, ...kcEnv } },
  );
  for (const s of config.schools) {
    await start('nakama-' + s.schoolId, join(root, 'nakama/nakama'), [
      '--config',
      join(cfg, 'nakama-' + s.schoolId + '.json'),
    ]);
    await start(
      'forum-' + s.schoolId,
      node,
      ['app.js', '--config', join(cfg, 'forum-' + s.schoolId + '.json'), '--no-daemon'],
      { cwd: join(root, 'nodebb') },
    );
  }
  await start('base', node, ['tools/m0-serve.mjs'], { cwd: base });
  await writeFile(
    join(logs, 'owned-processes.json'),
    JSON.stringify(
      {
        supervisor: process.pid,
        children: children.map((c) => ({ pid: c.pid, command: c.spawnfile })),
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  process.on('SIGTERM', () => close());
  process.on('SIGINT', () => close());
  console.log(
    JSON.stringify({
      mode: (config.milestone || 'M0') + ' development services',
      origin: config.origin + (config.milestone === 'M1' ? '/m1.html' : '/m0.html'),
      logs,
      stop: 'Ctrl+C stops only these child processes',
      production: false,
    }),
  );
  const deadline = Date.now() + 60000;
  while (!closing) {
    try {
      const issuer = await fetch(config.issuer + '/.well-known/openid-configuration', {
        signal: AbortSignal.timeout(2000),
      });
      if (!issuer.ok) throw Error('identity not ready');
      const baseHealth = await fetch(config.origin + '/health', {
        signal: AbortSignal.timeout(2000),
      });
      if (!baseHealth.ok) throw Error('Base not ready');
      for (const s of config.schools) {
        const health = await fetch(s.forumUrl + '/api/hd/health', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-HD-Service-Key': s.forumKey },
          body: '{}',
          signal: AbortSignal.timeout(2000),
        });
        const payload = await health.json();
        if (!health.ok || payload.gate !== 'active' || payload.schoolId !== s.schoolId)
          throw Error('mandatory forum gate not ready');
        const denied = await fetch(s.forumUrl + '/api/categories', {
          signal: AbortSignal.timeout(2000),
        });
        if (denied.status !== 401) throw Error('mandatory forum gate failed');
      }
      console.log('READY: identity, Base and both native forum isolation gates verified');
      break;
    } catch (e) {
      if (Date.now() > deadline) {
        console.error('M0 readiness failed: ' + e.message);
        await close(1);
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
} else throw Error('Usage: node tools/m0-services.mjs setup|start|stop');
