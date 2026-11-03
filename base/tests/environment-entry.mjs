import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { config, login, api, call } from './m1-helpers.mjs';
import { openPlatform } from '../src/platform/db.mjs';
import { createServices } from '../src/platform/services.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Isolated fixture only');
const db = await openPlatform(config.databaseUrl, { m1: true }),
  checks = [];
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
try {
  const s = config.schools.find((x) => x.schoolId === 'north');
  const mapped = ok(
    await call(
      config.origin + '/environment/public/spaces/' + encodeURIComponent(s.spaceId) + '/places',
    ),
  );
  assert.equal(mapped.schoolId, 'north');
  assert.equal(mapped.spaceId, s.spaceId);
  assert.ok(mapped.places.length);
  for (const p of mapped.places) {
    assert.equal('managerUserId' in p, false);
    assert.equal('orgId' in p, false);
    assert.equal('feedback' in p, false);
  }
  assert.equal(
    (await call(config.origin + '/environment/public/spaces/not-a-school-space/places')).status,
    404,
  );
  checks.push({
    name: 'anonymous real space resolves school and public places without member fields',
    status: 'PASS',
  });
  const owner = await login('moda');
  const old = await api(owner, '/m0/schools/north/ranking');
  assert.equal(old.status, 409);
  assert.equal(old.data.error.code, 'campus_ranking_route_required');
  const f = JSON.parse(await readFile('.local/campus-ledger-browser-fixture.json', 'utf8'));
  const ranking = ok(
    await api(
      owner,
      '/ledger/schools/north/rankings?' + new URLSearchParams({ org: f.org, period: f.period }),
    ),
  );
  assert.ok(Array.isArray(ranking.rows));
  assert.ok(ranking.rows.length);
  const services = createServices(db, config),
    social = await services.social(services.school('north'), owner.userId);
  for (const period of ['m0-trial', f.period])
    assert.equal(
      (await call(s.nakamaUrl + '/v2/leaderboard/north:' + period, { token: social.session.token }))
        .status,
      403,
    );
  checks.push({
    name: 'legacy HTTP and native campus leaderboards refuse bypass while current authorized org-period ranking works',
    status: 'PASS',
  });
  await writeFile(
    'qa/campus/environment-entry.json',
    JSON.stringify(
      {
        scope:
          'Read-only real isolated HTTP/PostgreSQL/Nakama verification after integration restart',
        checks,
      },
      null,
      2,
    ),
  );
  checks.forEach((x) => console.log('PASS ' + x.name));
} finally {
  await db.close();
}
