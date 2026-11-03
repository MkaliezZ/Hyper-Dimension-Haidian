import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Owned fixture browser required');
await mkdir('qa/campus', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true }),
  errors = [],
  checks = [];
async function pageFor(user) {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
    p = await c.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(config.origin + '/auth/login');
  await p.locator('#username').fill(user);
  await p.locator('#password').fill(fixtures.find((x) => x.username === user).credentials[0].value);
  await p.locator('#kc-login').click();
  await p.waitForURL(config.origin + '/m1.html');
  return p;
}
try {
  const p = await pageFor('moda'),
    student = await pageFor('alice');
  const me = await student.evaluate(async () => await (await fetch('/m0/me')).json()),
    org = 'admin-qa-' + Date.now();
  const post = async (page, path, input) =>
    page.evaluate(
      async ({ path, input }) => {
        const r = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: crypto.randomUUID(), ...input }),
        });
        return { status: r.status, data: await r.json() };
      },
      { path, input },
    );
  assert.equal(
    (
      await post(p, '/m1/schools/north/organizations', {
        orgId: org,
        name: '管理台独立虚拟组织',
        kind: 'student',
      })
    ).status,
    200,
  );
  const invited = await post(p, '/m1/schools/north/organizations/' + org + '/invitations', {
    email: fixtures.find((x) => x.username === 'alice').email,
    role: 'member',
  });
  assert.equal(invited.status, 200);
  const accepted = await student.evaluate(async (token) => {
    const r = await fetch('/m1/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return r.status;
  }, invited.data.token);
  assert.equal(accepted, 200);
  const memberRoot = '/m1/schools/north/organizations/' + org + '/members',
    url = config.origin + '/admin.html?school=north&org=' + org;
  await p.goto(url + '#/members');
  await p.getByText(me.userId, { exact: true }).waitFor();
  await p.screenshot({ path: 'qa/campus/admin-members.png', fullPage: true });
  const before = await p.evaluate(
    async ({ path, id }) =>
      (await (await fetch(path)).json()).members.find((x) => x.user_id === id),
    { path: memberRoot, id: me.userId },
  );
  await p.goto(url + '#/members/' + encodeURIComponent(me.userId));
  await p.getByRole('button', { name: 'Save', exact: true }).waitFor();
  await p.getByRole('combobox', { name: '角色' }).click();
  await p.getByRole('option', { name: 'moderator', exact: true }).click();
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await p.waitForFunction(
    async ({ path, id, revision }) =>
      (await (await fetch(path)).json()).members.find((x) => x.user_id === id)?.revision ===
      revision + 1,
    { path: memberRoot, id: me.userId, revision: before.revision },
  );
  const stale = await post(p, memberRoot, {
    userId: me.userId,
    role: before.role,
    active: before.active,
    expectedRevision: before.revision,
  });
  assert.equal(stale.status, 409);
  assert.equal(
    (
      await post(p, memberRoot, {
        userId: me.userId,
        role: 'member',
        active: true,
        expectedRevision: before.revision + 1,
      })
    ).status,
    200,
  );
  checks.push({
    name: 'actual React-admin adapter reads and saves server CAS membership in isolated fixture org',
    status: 'PASS',
  });
  await p.goto(config.origin + '/admin.html?school=north#/audit');
  await p.getByText('membership.update', { exact: true }).first().waitFor();
  await p.screenshot({ path: 'qa/campus/admin-audit.png', fullPage: true });
  checks.push({ name: 'read-only audit contains actual membership operation', status: 'PASS' });
  assert.equal(
    await student.evaluate(async () => (await fetch('/m1/schools/north/members')).status),
    403,
  );
  await student.goto(config.origin + '/admin.html');
  await student.getByRole('heading', { name: '选择管理范围' }).waitFor();
  assert.equal(await student.locator('a[href="/admin.html?school=north"]').count(), 0);
  checks.push({
    name: 'ordinary member cannot enter school management or bypass through API',
    status: 'PASS',
  });
  assert.deepEqual(errors, []);
  await writeFile(
    'qa/campus/admin-browser.json',
    JSON.stringify(
      {
        status: 'PASS',
        framework: 'react-admin 5.15.5 open source',
        checks,
        automated: true,
        physicalDevices: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS admin browser ' + checks.length + ' groups');
} finally {
  await browser.close();
}
