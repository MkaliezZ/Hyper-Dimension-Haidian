import { randomUUID, randomBytes } from 'node:crypto';
import { config, admin, call } from './m1-helpers.mjs';
export async function contactAccount(db, suffix, school = 'north') {
  if (process.env.HD_M1_TEST_FIXTURE !== '1') throw Error('Isolated fixture only');
  const username = 'contact-' + suffix + '-' + randomUUID().slice(0, 8),
    password = randomBytes(24).toString('base64url');
  await admin('users', 'POST', {
    username,
    enabled: true,
    email: username + '@example.invalid',
    emailVerified: true,
    firstName: 'Contact',
    lastName: 'Fixture',
    credentials: [{ type: 'password', value: password, temporary: false }],
  });
  const r = await fetch(config.issuer + '/protocol/openid-connect/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      username,
      password,
      scope: 'openid profile email',
    }),
  });
  if (!r.ok) throw Error('Fixture token failed ' + r.status);
  const token = (await r.json()).access_token,
    me = await call(config.origin + '/m0/me', { token });
  if (me.status !== 200) throw Error('Fixture identity failed ' + me.status);
  await db.pool.query(
    "INSERT INTO hd_memberships(school_id,user_id,role) VALUES($1,$2,'student')",
    [school, me.data.userId],
  );
  return { username, password, token, ...me.data };
}
