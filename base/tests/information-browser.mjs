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
  await p.goto(config.origin + '/inbox.html');
  await p.waitForFunction(() => document.getElementById('status').textContent !== '正在读取账号…');
  assert.equal(await p.locator('#status').innerText(), '已连接学校账号', JSON.stringify(errors));
  return p;
}
try {
  const a = await pageFor('alice'),
    o = await pageFor('moda');
  await a.locator('#enabled').check();
  await a.waitForFunction(async () => {
    const r = await fetch(
      '/information/schools/' + document.getElementById('school').value + '/preferences',
    );
    return (await r.json()).enabled;
  });
  await a.getByLabel('学校与组织公告', { exact: true }).check();
  await a.waitForFunction(async () => {
    const r = await fetch(
      '/information/schools/' + document.getElementById('school').value + '/subscriptions',
    );
    return (await r.json()).items.some(
      (x) => x.topic === 'announcements' && x.scope_id === '' && x.active,
    );
  });
  const title = '校园订阅界面验证 ' + Date.now();
  await o.locator('#title').fill(title);
  await o.locator('#announce button').click();
  await o.locator('#announcements article').filter({ hasText: title }).waitFor();
  await a.locator('#refresh').click();
  const card = a.locator('#messages article').filter({ hasText: title });
  await card.waitFor();
  await card.getByRole('button', { name: '标记已读' }).click();
  await card.getByText('已读', { exact: true }).waitFor();
  await a.reload();
  await a.locator('#status').filter({ hasText: '已连接学校账号' }).waitFor();
  await a
    .locator('#messages article')
    .filter({ hasText: title })
    .getByText('已读', { exact: true })
    .waitFor();
  checks.push({
    name: 'subscribe publish fetch read and reload via two actual browser accounts',
    status: 'PASS',
  });
  await a.screenshot({ path: 'qa/campus/inbox-desktop.png', fullPage: true });
  await o
    .locator('#announcements article')
    .filter({ hasText: title })
    .getByRole('button', { name: '撤回' })
    .click();
  await o
    .locator('#announcements article')
    .filter({ hasText: title })
    .waitFor({ state: 'detached' });
  await a.locator('#refresh').click();
  await a.locator('#messages article').filter({ hasText: title }).waitFor({ state: 'detached' });
  checks.push({
    name: 'withdrawal removes previously read subscription notice on next read',
    status: 'PASS',
  });
  await a.setViewportSize({ width: 390, height: 844 });
  await a.screenshot({ path: 'qa/campus/inbox-mobile.png', fullPage: true });
  assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  checks.push({ name: 'mobile no overflow and no browser exceptions', status: 'PASS' });
  await writeFile(
    'qa/campus/information-browser.json',
    JSON.stringify({ status: 'PASS', checks, automated: true, physicalDevices: false }, null, 2) +
      '\n',
  );
  console.log('PASS information browser 3 groups');
} finally {
  await browser.close();
}
