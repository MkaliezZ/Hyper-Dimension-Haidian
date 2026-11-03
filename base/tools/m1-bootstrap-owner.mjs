import { readFile } from 'node:fs/promises';
import { openPlatform } from '../src/platform/db.mjs';
import { keycloak } from '../src/platform/keycloak.mjs';
import { audit } from '../src/platform/permissions.mjs';
const args = process.argv.slice(2),
  opt = (k) => args[args.indexOf(k) + 1];
if (!args.includes('--school') || !(args.includes('--subject') || args.includes('--username')))
  throw Error(
    'm1-bootstrap-owner --school ID --subject VERIFIED_KEYCLOAK_SUBJECT (or --username exact). Local server operator only; first owner only.',
  );
const c = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8')),
  s = c.schools.find((s) => s.schoolId === opt('--school'));
if (!s) throw Error('Configured school required');
const kc = keycloak(c);
const matches = args.includes('--username')
  ? await kc.admin('users?exact=true&username=' + encodeURIComponent(opt('--username')))
  : null;
if (matches && matches.length !== 1) throw Error('Username must resolve to exactly one account');
const account = matches
  ? matches[0]
  : await kc.admin('users/' + encodeURIComponent(opt('--subject')));
if (!account.enabled || !account.emailVerified)
  throw Error('Enabled verified institutional account required');
const db = await openPlatform(c.databaseUrl, { m1: true });
try {
  await db.pool.query('INSERT INTO hd_schools VALUES($1,$2) ON CONFLICT DO NOTHING', [
    s.schoolId,
    s.spaceId,
  ]);
  const u = await db.identity({
    iss: c.issuer,
    sub: account.id,
    email: account.email,
    email_verified: account.emailVerified,
    preferred_username: account.username,
  });
  await db.tx(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      s.schoolId + ':permissions',
    ]);
    if (
      (
        await tx.query(
          "SELECT 1 FROM hd_memberships WHERE school_id=$1 AND role='owner' AND active",
          [s.schoolId],
        )
      ).rowCount
    )
      throw Error('Owner already exists: use audited handover, no bootstrap escalation');
    await tx.query(
      "INSERT INTO hd_memberships(school_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT(school_id,user_id) DO UPDATE SET role='owner',active=true,revision=hd_memberships.revision+1",
      [s.schoolId, u.user_id],
    );
    await audit(tx, s.schoolId, u.user_id, 'owner.bootstrap', u.user_id, { localOperator: true });
  });
  console.log('First school owner established with audit; no existing owner replaced');
} finally {
  await db.close();
}
