import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { config } from './m1-helpers.mjs';
import { contactAccount } from './contacts-fixtures.mjs';
import { openPlatform } from '../src/platform/db.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Isolated campus required');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  run = randomUUID().slice(0, 8),
  org = 'contacts-ui-' + run;
try {
  const users = await Promise.all([contactAccount(db, 'ui-a'), contactAccount(db, 'ui-b')]);
  await db.pool.query(
    "INSERT INTO hd_organizations(school_id,org_id,name,kind) VALUES('north',$1,'联系授权界面验收','student')",
    [org],
  );
  for (const u of users)
    await db.pool.query(
      "INSERT INTO hd_org_members(school_id,org_id,user_id,role) VALUES('north',$1,$2,'member')",
      [org, u.userId],
    );
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/contacts-browser-fixture.json',
    JSON.stringify(
      {
        run,
        org,
        users: users.map(({ username, password, userId }) => ({ username, password, userId })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await writeFile(
    '.local/contacts-browser-config.json',
    JSON.stringify({ origin: config.origin, campusEnabled: true }),
  );
  await writeFile('.local/contacts-browser-users.json', '[]');
  console.log('Dedicated browser fixtures prepared in ignored .local; credentials not printed.');
} finally {
  await db.close();
}
