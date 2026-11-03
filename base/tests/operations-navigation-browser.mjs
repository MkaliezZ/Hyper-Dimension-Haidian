import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Isolated browser fixtures required');
const prior = JSON.parse(await readFile('qa/operations/browser-review.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true });
const errors = [],
  checks = [];
async function account(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill(name);
  await page
    .locator('#password')
    .fill(fixtures.find((x) => x.username === name).credentials[0].value);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  return page;
}
try {
  const p = await account('moda');
  await p.goto(config.origin + '/operations.html');
  await p.waitForFunction(() => window.operationsQA?.packages);
  await p.locator('#organization').selectOption(prior.orgId);
  await p.locator('#runs button').filter({ hasText: prior.title }).click();
  await p.waitForFunction((id) => window.operationsQA?.report?.runId === id, prior.runId);
  const current = await p.evaluate(() => window.operationsQA.report);
  assert.ok(current.nextActions[0].url.includes(current.timeline[0].activityId));
  await p.locator('#timeline a').first().click();
  await p.waitForURL('**/activities.html?**');
  await p.locator('#detail-title').filter({ hasText: prior.timeline[0].activity.title }).waitFor();
  assert.equal(await p.locator('#org-filter').inputValue(), prior.orgId);
  assert.equal(await p.locator('#detail-status').textContent(), '尚未提交');
  assert.equal(await p.locator('#detail').isVisible(), true);
  checks.push({
    name: 'actual operations activity link opens the exact authorized organization draft',
    status: 'PASS',
  });
  await p.screenshot({ path: 'qa/operations/activity-deep-link.png', fullPage: true });
  const other = await account('bob');
  await other.goto(p.url());
  await other
    .locator('#status')
    .filter({ hasText: '当前账号没有链接所指学校的访问权限' })
    .waitFor();
  assert.equal(await other.locator('#detail').isVisible(), false);
  checks.push({ name: 'cross-school deep link cannot grant access', status: 'PASS' });
  assert.deepEqual(errors, []);
  await writeFile(
    'qa/operations/navigation-browser.json',
    JSON.stringify({ status: 'PASS', checks, errors, runId: prior.runId }, null, 2),
  );
} finally {
  await browser.close();
}
