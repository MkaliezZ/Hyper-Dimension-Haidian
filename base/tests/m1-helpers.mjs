import { readFile } from 'node:fs/promises';
export const config = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8'));
export const fixtures = JSON.parse(
  await readFile(process.env.HD_M0_USERS || config.configRoot + '/test-users.json', 'utf8'),
);
export async function call(
  url,
  { token, body, method = body ? 'POST' : 'GET', headers = {} } = {},
) {
  const r = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: r.status, data };
}
export async function login(name) {
  const f = fixtures.find((x) => x.username === name);
  const r = await fetch(config.issuer + '/protocol/openid-connect/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      username: name,
      password: f.credentials[0].value,
      scope: 'openid profile email',
    }),
  });
  if (!r.ok) throw Error('Fixture login failed ' + name + ': ' + r.status);
  const token = (await r.json()).access_token;
  const me = await call(config.origin + '/m0/me', { token });
  if (me.status !== 200)
    throw Error('Base fixture login failed ' + me.status + ': ' + JSON.stringify(me.data));
  return { token, ...me.data };
}
export const api = (u, path, body, method) =>
  call(config.origin + path, { token: u.token, body, method });
export async function admin(path, method = 'GET', body) {
  const e = JSON.parse(await readFile(config.configRoot + '/keycloak-env.json', 'utf8')),
    idp = new URL(config.issuer).origin;
  const r = await fetch(idp + '/realms/master/protocol/openid-connect/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: 'admin-cli',
      grant_type: 'password',
      username: e.KC_BOOTSTRAP_ADMIN_USERNAME,
      password: e.KC_BOOTSTRAP_ADMIN_PASSWORD,
    }),
  });
  if (!r.ok) throw Error('Fixture admin login failed');
  const token = (await r.json()).access_token;
  const x = await fetch(
    idp + '/admin/realms/' + new URL(config.issuer).pathname.split('/').pop() + '/' + path,
    {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  if (!x.ok) throw Error('Fixture admin operation failed ' + x.status);
  const text = await x.text();
  return text ? JSON.parse(text) : null;
}
export async function until(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error('Required state did not converge within ' + timeout + 'ms');
}
