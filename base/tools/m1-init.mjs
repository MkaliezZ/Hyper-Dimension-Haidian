import { readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2),
  opt = (k) => args[args.indexOf(k) + 1];
if (!args.includes('--runtime') || !args.includes('--namespace'))
  throw Error('m1-init --runtime NEW_DIRECTORY --namespace NEW_DB_PREFIX [--fixtures]');
const origin = process.env.HD_M1_ORIGIN || 'http://127.0.0.1:4380',
  issuer = process.env.HD_M1_ISSUER || 'http://127.0.0.1:8280/realms/hd-m1';
if (!args.includes('--fixtures') && !process.env.HD_M1_SMTP_FILE)
  throw Error('Provide HD_M1_SMTP_FILE before initializing formal verified-email registration');
if (process.env.HD_M1_SMTP_FILE) JSON.parse(await readFile(process.env.HD_M1_SMTP_FILE, 'utf8'));
const child = spawn(process.execPath, ['tools/m0-init.mjs', ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    HD_M0_ORIGIN: origin,
    HD_M0_ISSUER: issuer,
    HD_M0_FORUM_PORT: process.env.HD_M1_FORUM_PORT || '4667',
    HD_M0_NAKAMA_PORT: process.env.HD_M1_NAKAMA_PORT || '7550',
  },
});
if ((await new Promise((r) => child.on('exit', r))) !== 0) process.exit(1);
const runtime = resolve(opt('--runtime')),
  priv = join(runtime, 'private'),
  read = async (n) => JSON.parse(await readFile(join(priv, n), 'utf8'));
const secret = () => randomBytes(32).toString('base64url'),
  write = (n, v) => writeFile(join(priv, n), JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
const c = await read('config.json');
c.milestone = 'M1';
c.clientSecret = secret();
c.identityAdmin = { clientId: 'hd-ops', secret: secret() };
const realmPath = join(
    runtime,
    'keycloak/data/import/' + new URL(issuer).pathname.split('/').pop() + '-realm.json',
  ),
  r = JSON.parse(await readFile(realmPath, 'utf8'));
Object.assign(r, {
  loginTheme: 'hd-base',
  registrationAllowed: true,
  verifyEmail: true,
  resetPasswordAllowed: true,
  loginWithEmailAllowed: true,
  duplicateEmailsAllowed: false,
  bruteForceProtected: true,
  passwordPolicy: 'length(12)',
});
if (args.includes('--fixtures'))
  r.smtpServer = {
    host: '127.0.0.1',
    port: '2525',
    from: 'base@m1.invalid',
    auth: 'false',
    ssl: 'false',
    starttls: 'false',
  };
else if (process.env.HD_M1_SMTP_FILE)
  r.smtpServer = JSON.parse(await readFile(process.env.HD_M1_SMTP_FILE, 'utf8'));
else
  throw Error('Formal signup requires HD_M1_SMTP_FILE; initialized files preserved, no data reset');
r.clients[0].publicClient = false;
r.clients[0].secret = c.clientSecret;
r.clients.push({
  clientId: 'hd-ops',
  enabled: true,
  publicClient: false,
  secret: c.identityAdmin.secret,
  serviceAccountsEnabled: true,
  standardFlowEnabled: false,
  directAccessGrantsEnabled: false,
});
r.users.push({
  username: 'service-account-hd-ops',
  enabled: true,
  serviceAccountClientId: 'hd-ops',
  clientRoles: { 'realm-management': ['view-users'] },
});
await writeFile(realmPath, JSON.stringify(r, null, 2) + '\n', { mode: 0o600 });
await cp('integrations/keycloak/themes/hd-base', join(runtime, 'keycloak/themes/hd-base'), {
  recursive: true,
  errorOnExist: true,
  force: false,
});
const kc = await read('keycloak-env.json');
kc.KC_BOOTSTRAP_ADMIN_USERNAME = 'm1-bootstrap';
kc.KC_BOOTSTRAP_ADMIN_PASSWORD = secret();
await write('keycloak-env.json', kc);
for (const s of c.schools) {
  const n = await read('nakama-' + s.schoolId + '.json');
  n.socket.port = Number(new URL(s.nakamaUrl).port);
  n.console.port = n.socket.port + 1;
  await write('nakama-' + s.schoolId + '.json', n);
  for (const prefix of ['forum-', 'forum-setup-']) {
    const f = await read(prefix + s.schoolId + '.json');
    f.hd.m1 = true;
    f.hd.allowFaults = args.includes('--fixtures');
    await write(prefix + s.schoolId + '.json', f);
  }
}
await write('config.json', c);
console.log(
  JSON.stringify({
    milestone: 'M1',
    origin,
    issuer,
    signup: 'verified email + explicit invitation; no email-domain auto-membership',
    fixtureMail: args.includes('--fixtures'),
  }),
);
