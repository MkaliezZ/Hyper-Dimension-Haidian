import { readFile } from 'node:fs/promises';
const c = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8'));
if (!c.relocatedFrom)
  throw Error('Only an explicitly relocated restored clone can use this command');
const e = JSON.parse(await readFile(c.configRoot + '/keycloak-env.json', 'utf8')),
  idp = new URL(c.issuer).origin;
const r = await fetch(idp + '/realms/master/protocol/openid-connect/token', {
  method: 'POST',
  body: new URLSearchParams({
    client_id: 'admin-cli',
    grant_type: 'password',
    username: e.KC_BOOTSTRAP_ADMIN_USERNAME,
    password: e.KC_BOOTSTRAP_ADMIN_PASSWORD,
  }),
});
if (!r.ok) throw Error('Clone identity admin authentication failed; source unchanged');
const { access_token } = await r.json(),
  realm = new URL(c.issuer).pathname.split('/').pop(),
  headers = { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' };
const list = await fetch(idp + '/admin/realms/' + realm + '/clients?clientId=' + c.clientId, {
  headers,
});
const [client] = await list.json();
client.redirectUris = [c.origin + '/auth/callback'];
client.webOrigins = [c.origin];
const u = await fetch(idp + '/admin/realms/' + realm + '/clients/' + client.id, {
  method: 'PUT',
  headers,
  body: JSON.stringify(client),
});
if (!u.ok) throw Error('Clone redirect update failed');
console.log(
  'Restored clone OIDC redirects relocated; source client unchanged; stable subject and Base IDs retained',
);
