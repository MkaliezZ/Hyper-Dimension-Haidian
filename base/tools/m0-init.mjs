import { readFile, writeFile, mkdir, stat, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { validateSchoolDefinitions } from '../src/platform/school-definitions.mjs';
const args = process.argv.slice(2),
  option = (k) => args[args.indexOf(k) + 1];
if (!args.includes('--runtime') || !args.includes('--namespace'))
  throw Error(
    'Usage: node tools/m0-init.mjs --runtime /absolute/services --namespace hdm0_trial [--fixtures]',
  );
const runtime = resolve(option('--runtime')),
  namespace = option('--namespace'),
  base = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (!/^[a-z][a-z0-9_]{2,30}$/.test(namespace))
  throw Error('Namespace must be a new PostgreSQL identifier, 3-31 characters');
const customSchools = args.includes('--schools');
const definitions = validateSchoolDefinitions(customSchools
  ? JSON.parse(await readFile(resolve(option('--schools')), 'utf8'))
  : ['north', 'south'].map(id => ({schoolId:id,spaceId:id})));
// Validate before opening a database or creating a directory.
const nativePorts = definitions.flatMap((_,i) => [Number(process.env.HD_M0_FORUM_PORT || 4567)+i,Number(process.env.HD_M0_NAKAMA_PORT || 7350)+i*100,Number(process.env.HD_M0_NAKAMA_PORT || 7350)+i*100+1]);
if (new Set(nativePorts).size !== nativePorts.length || nativePorts.some(p=>!Number.isInteger(p)||p<1024||p>65535))
  throw Error('School service ports must be distinct and in range');
const cfg = join(runtime, 'private');
try {
  await stat(cfg);
  throw Error('Private config already exists; refusing to replace data or secrets');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
if (!process.env.HD_M0_PG_ADMIN)
  throw Error('Set HD_M0_PG_ADMIN privately to a PostgreSQL administrative connection URL');
const admin = new pg.Client({ connectionString: process.env.HD_M0_PG_ADMIN });
await admin.connect();
const conn = new URL(process.env.HD_M0_PG_ADMIN);
const names = ['base', 'kc', ...definitions.map(s=>s.schoolId+'_nk'), ...definitions.map(s=>s.schoolId+'_forum')].map(
  (x) => namespace + '_' + x,
);
const passwords = Object.fromEntries(names.map((n) => [n, randomBytes(32).toString('base64url')]));
try {
  const { rowCount } = await admin.query(
    'SELECT 1 FROM pg_roles WHERE rolname=ANY($1) UNION ALL SELECT 1 FROM pg_database WHERE datname=ANY($1)',
    [names],
  );
  if (rowCount) throw Error('Namespace already exists; no database was changed');
  await mkdir(cfg, { recursive: true, mode: 0o700 });
  for (const name of names) {
    await admin.query(`CREATE ROLE "${name}" LOGIN PASSWORD '${passwords[name]}'`);
    await admin.query(`CREATE DATABASE "${name}" OWNER "${name}"`);
  }
  const origin = process.env.HD_M0_ORIGIN || 'http://127.0.0.1:4280',
    issuer = process.env.HD_M0_ISSUER || 'http://127.0.0.1:8180/realms/hd-m0';
  const host = process.env.HD_M0_PG_HOST || conn.hostname || '127.0.0.1',
    port = conn.port || '5432',
    url = (name) => `postgresql://${name}:${passwords[name]}@${host}:${port}/${name}`;
  const config = {
    origin,
    issuer,
    clientId: 'hd-base',
    port: Number(new URL(origin).port) || 4280,
    keycloakPort: Number(new URL(issuer).port) || 8180,
    dataDir: join(runtime, 'base-data'),
    serviceRoot: runtime,
    configRoot: cfg,
    databaseUrl: url(names[0]),
    schools: [],
  };
  const secret = () => randomBytes(32).toString('base64url'),
    write = (p, d) =>
      writeFile(join(cfg, p), JSON.stringify(d, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  for (const [i, definition] of definitions.entries()) {
    const id = definition.schoolId;
    const s = {
      ...definition,
      ...(!customSchools ? {package: join(base, 'examples', id, 'space.json')} : {}),
      forumUrl: `http://127.0.0.1:${Number(process.env.HD_M0_FORUM_PORT || 4567) + i}`,
      forumKey: secret(),
      nakamaUrl: `http://127.0.0.1:${Number(process.env.HD_M0_NAKAMA_PORT || 7350) + i * 100}`,
      nakamaKey: secret(),
      nakamaServerKey: secret(),
      nakamaHttpKey: secret(),
    };
    config.schools.push(s);
    const n = names[2 + i],
      forumName = names[2 + definitions.length + i],
      dataDir = join(runtime, 'nakama-' + id);
    await mkdir(join(dataDir, 'modules'), { recursive: true });
    await copyFile(join(base, 'integrations/nakama/hd.js'), join(dataDir, 'modules/hd.js'));
    await write('nakama-' + id + '.json', {
      name:
        'hd-' +
        createHash('sha256')
          .update(namespace + ':' + id)
          .digest('hex')
          .slice(0, 12),
      data_dir: dataDir,
      database: { address: [`${n}:${passwords[n]}@${host}:${port}/${n}`] },
      logger: { level: 'WARN' },
      console: {
        address: '127.0.0.1',
        port: Number(new URL(s.nakamaUrl).port) + 1,
        username: 'm0admin',
        password: secret(),
        signing_key: secret(),
      },
      socket: {
        address: '127.0.0.1',
        port: Number(new URL(s.nakamaUrl).port),
        server_key: s.nakamaServerKey,
      },
      session: {
        encryption_key: secret(),
        refresh_encryption_key: secret(),
        token_expiry_sec: 600,
      },
      runtime: {
        http_key: s.nakamaHttpKey,
        js_entrypoint: 'hd.js',
        js_min_count: 1,
        js_max_count: 2,
        env: [`HD_BASE_URL=${origin}`, `HD_SCHOOL=${id}`, `HD_BRIDGE_KEY=${s.nakamaKey}`],
      },
    });
    const forum = {
      url: s.forumUrl,
      port: Number(new URL(s.forumUrl).port),
      bind_address: '127.0.0.1',
      trust_proxy: false,
      sessionKey: namespace + '_forum_' + id,
      secret: secret(),
      runJobs: false,
      database: 'postgres',
      postgres: {
        host,
        port: Number(port),
        username: forumName,
        password: passwords[forumName],
        database: forumName,
        ssl: false,
      },
      hd: { school: id, baseUrl: origin, key: s.forumKey },
    };
    await write('forum-' + id + '.json', forum);
    const adminPassword = secret();
    await write('forum-setup-' + id + '.json', {
      ...forum,
      submitPluginUsage: 'no',
      'admin:username': 'm0admin',
      'admin:password': adminPassword,
      'admin:password:confirm': adminPassword,
      'admin:email': 'm0admin@m0.invalid',
    });
  }
  const fixtures = args.includes('--fixtures')
    ? ['alice', 'bob', 'moda', 'modb', 'shared'].map((username) => ({
        id: randomUUID(),
        username,
        firstName: username,
        lastName: 'M0',
        email: username + '@m0.invalid',
        emailVerified: true,
        enabled: true,
        credentials: [{ type: 'password', value: secret(), temporary: false }],
      }))
    : [];
  await mkdir(join(runtime, 'keycloak/data/import'), { recursive: true });
  await writeFile(
    join(
      runtime,
      'keycloak/data/import/' + new URL(issuer).pathname.split('/').pop() + '-realm.json',
    ),
    JSON.stringify({
      realm: new URL(issuer).pathname.split('/').pop(),
      enabled: true,
      sslRequired: 'none',
      registrationAllowed: false,
      clients: [
        {
          clientId: 'hd-base',
          publicClient: true,
          standardFlowEnabled: true,
          directAccessGrantsEnabled: args.includes('--fixtures'),
          redirectUris: [origin + '/auth/callback'],
          webOrigins: [origin],
          attributes: { 'pkce.code.challenge.method': 'S256' },
          protocolMappers: [
            {
              name: 'audience',
              protocol: 'openid-connect',
              protocolMapper: 'oidc-audience-mapper',
              config: {
                'included.client.audience': 'hd-base',
                'access.token.claim': 'true',
                'id.token.claim': 'true',
              },
            },
          ],
        },
      ],
      users: fixtures,
    }),
    { mode: 0o600, flag: 'wx' },
  );
  await write('test-users.json', fixtures);
  await write('config.json', config);
  await write('keycloak-env.json', {
    KC_DB: 'postgres',
    KC_DB_URL: `jdbc:postgresql://${host}:${port}/${names[1]}`,
    KC_DB_USERNAME: names[1],
    KC_DB_PASSWORD: passwords[names[1]],
    JAVA_OPTS_APPEND: '-Djava.net.preferIPv4Stack=true',
  });
  console.log(
    JSON.stringify({
      config: join(cfg, 'config.json'),
      namespace,
      fixtureUsers: fixtures.length,
      secrets: 'written privately; never printed',
      existingBaseData: 'not read or migrated',
    }),
  );
} finally {
  await admin.end();
}
