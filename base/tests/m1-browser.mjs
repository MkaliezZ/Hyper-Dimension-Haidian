import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
const c = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8')),
  priv = dirname(process.env.HD_M0_CONFIG),
  fixtures = JSON.parse(await readFile(join(priv, 'test-users.json'), 'utf8'));
const mailDir = process.env.HD_M1_MAIL;
if (!mailDir || !process.env.HD_QA_CHROME)
  throw Error('Owned QA Chrome and private test SMTP mail directory required');
const browser = await chromium.launch({
    executablePath: process.env.HD_QA_CHROME,
    headless: true,
    args: ['--no-sandbox'],
  }),
  results = [],
  started = Date.now();
const test = async (name, fn) => {
  await fn();
  results.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }),
  page = await context.newPage(),
  errors = [];
page.on('pageerror', (e) => errors.push(e.stack));
const username = 'new-' + randomUUID().slice(0, 8),
  email = username + '@m1.invalid',
  password = 'New-M1-' + randomUUID(),
  newPassword = 'Reset-M1-' + randomUUID();
let me, invite;
const before = new Set(await readdir(mailDir));
async function emailLink(excluded = before) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    for (const name of (await readdir(mailDir)).reverse()) {
      if (excluded.has(name)) continue;
      const text = await readFile(join(mailDir, name), 'utf8');
      if (!text.includes(email)) continue;
      const decoded = text
        .replace(/=\r?\n/g, '')
        .replace(/=([A-Fa-f0-9]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replaceAll('&amp;', '&');
      const match = decoded.match(
        /https?:\/\/127\.0\.0\.1:\d+\/realms\/[^\s"<>]+\/login-actions\/action-token\?[^\s"<>]+/,
      );
      if (match) return match[0];
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error('No expected email action token from test-only SMTP');
}
async function json(path, body, token) {
  const r = await fetch(c.origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, 200, JSON.stringify(data));
  return data;
}
async function fixtureToken() {
  const f = fixtures.find((u) => u.username === 'moda');
  const r = await fetch(c.issuer + '/protocol/openid-connect/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: c.clientId,
      client_secret: c.clientSecret,
      username: f.username,
      password: f.credentials[0].value,
      scope: 'openid profile email',
    }),
  });
  assert.equal(r.status, 200);
  return (await r.json()).access_token;
}
try {
  await test('real browser registration requires email verification before Base access', async () => {
    await page.goto(c.origin + '/auth/register');
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="firstName"]').fill('Fictional');
    await page.locator('input[name="lastName"]').fill('Student');
    await page.locator('input[type="submit"],button[type="submit"]').click();
    await page.waitForURL(/login-actions\/required-action/);
    const blocked = await context.request.get(c.origin + '/m0/me');
    assert.equal(blocked.status(), 401);
    const link = await emailLink();
    await page.goto(link);
    await page.locator('input[name="password-new"]').fill(password);
    await page.locator('input[name="password-confirm"]').fill(password);
    await page.locator('input[type="submit"],button[type="submit"]').click();
    await page.waitForURL(c.origin + '/m1.html', { timeout: 20000 });
    me = await (await context.request.get(c.origin + '/m0/me')).json();
    assert.equal(me.schools.length, 0);
  });
  await test('verified account joins exact school by invitation through browser and cannot enter another school', async () => {
    const token = await fixtureToken();
    invite = await json(
      '/m1/schools/north/invitations',
      { requestId: randomUUID(), email, role: 'student' },
      token,
    );
    await page.locator('#inviteToken').fill(invite.token);
    await page.locator('#accept button').click();
    await page.locator('#workspace').waitFor({ state: 'visible' });
    assert.match(await page.locator('#school').textContent(), /north/);
    assert.equal((await context.request.get(c.origin + '/m0/schools/south/avatar')).status(), 403);
    await page.screenshot({ path: 'qa/m1/account-organizations.png', fullPage: true });
  });
  await test('real password recovery via SMTP action token changes credentials and retains stable Base ID', async () => {
    const seen = new Set(await readdir(mailDir)),
      reset = await browser.newContext(),
      p = await reset.newPage();
    await p.goto(c.origin + '/auth/login');
    await p.getByRole('link', { name: /Forgot Password|忘记密码/i }).click();
    await p.locator('input[name="username"]').fill(email);
    await p.locator('input[type="submit"],button[type="submit"]').click();
    const link = await emailLink(seen);
    await p.goto(link);
    await p.locator('input[name="password-new"]').fill(newPassword);
    await p.locator('input[name="password-confirm"]').fill(newPassword);
    await p.locator('input[type="submit"],button[type="submit"]').click();
    await p.waitForURL(c.origin + '/m1.html', { timeout: 20000 });
    const after = await (await reset.request.get(c.origin + '/m0/me')).json();
    assert.equal(after.userId, me.userId);
    assert.equal(after.schools[0].school_id, 'north');
    const old = await fetch(c.issuer + '/protocol/openid-connect/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: c.clientId,
        client_secret: c.clientSecret,
        username,
        password,
      }),
    });
    assert.equal(old.status, 400);
    assert.equal((await old.json()).error, 'invalid_grant');
    const fresh = await fetch(c.issuer + '/protocol/openid-connect/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: c.clientId,
        client_secret: c.clientSecret,
        username,
        password: newPassword,
      }),
    });
    assert.equal(fresh.status, 200);
    await p.screenshot({ path: 'qa/m1/password-recovered.png', fullPage: true });
    await reset.close();
  });
  assert.deepEqual(errors, []);
  await writeFile(
    'qa/m1/browser.json',
    JSON.stringify(
      {
        kind: 'automated browser + real Keycloak + loopback test SMTP',
        externalMailDelivery: false,
        humanAcceptance: false,
        elapsedMs: Date.now() - started,
        results,
        errors,
      },
      null,
      2,
    ) + '\n',
  );
  // Keep fictional credentials only in the private runtime for restore/retest, never evidence.
  await writeFile(
    join(priv, 'registration-fixture.json'),
    JSON.stringify({ username, email, password: newPassword, userId: me.userId }) + '\n',
    { mode: 0o600 },
  );
} catch (e) {
  await page.screenshot({ path: 'qa/m1/browser-failure.png', fullPage: true });
  console.error('Browser failure URL:', page.url().split('?')[0]);
  console.error((await page.locator('body').innerText()).slice(0, 2500));
  throw e;
} finally {
  await context.close();
  await browser.close();
}
