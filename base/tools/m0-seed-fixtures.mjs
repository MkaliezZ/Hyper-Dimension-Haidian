import { readFile } from 'node:fs/promises';
import { openPlatform } from '../src/platform/db.mjs';
import { createIdentity } from '../src/platform/identity.mjs';
if (!process.argv.includes('--allow-fixtures'))
  throw Error('Fixture seeding requires --allow-fixtures and a dedicated empty M0 database.');
const config = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8')),
  users = JSON.parse(await readFile(process.env.HD_M0_USERS, 'utf8'));
const db = await openPlatform(config.databaseUrl, { m1: config.milestone === 'M1' }),
  identity = createIdentity(db, config);
try {
  for (const s of config.schools)
    await db.pool.query('INSERT INTO hd_schools VALUES($1,$2) ON CONFLICT DO NOTHING', [
      s.schoolId,
      s.spaceId,
    ]);
  for (const fixture of users) {
    const response = await fetch(config.issuer + '/protocol/openid-connect/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: config.clientId,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
        username: fixture.username,
        password: fixture.credentials[0].value,
      }),
    });
    if (!response.ok)
      throw Error(
        'Fixture IdP login failed for ' + fixture.username + ' status ' + response.status,
      );
    const token = await response.json(),
      u = await db.identity(await identity.claims(token.access_token));
    const schools = {
      alice: ['north'],
      bob: ['south'],
      moda: ['north'],
      modb: ['south'],
      shared: ['north', 'south'],
    }[fixture.username];
    if (!schools) throw Error('Unknown fixture');
    for (const school of schools)
      await db.pool.query(
        'INSERT INTO hd_memberships(school_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [school, u.user_id, fixture.username.startsWith('mod') ? 'moderator' : 'student'],
      );
  }
  console.log(
    JSON.stringify({
      seeded: users.length,
      scope: 'fictional M0 test users; existing membership values preserved',
    }),
  );
} finally {
  await db.close();
}
