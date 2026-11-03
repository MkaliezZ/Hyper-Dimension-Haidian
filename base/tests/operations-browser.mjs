import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Isolated browser fixtures required');
const fixture = JSON.parse(await readFile('qa/operations/live.json', 'utf8'));
assert.equal(fixture.status, 'PASS');
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true }),
  errors = [],
  checks = [],
  code = randomUUID().slice(0, 8),
  name = '可复做校园运营 ' + code;
async function account(username) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }),
    p = await context.newPage(),
    f = fixtures.find((x) => x.username === username);
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(config.origin + '/auth/login');
  await p.locator('#username').fill(username);
  await p.locator('#password').fill(f.credentials[0].value);
  await p.locator('#kc-login').click();
  await p.waitForURL(config.origin + '/m1.html');
  await p.goto(config.origin + '/operations.html');
  return { context, p };
}
try {
  const { p } = await account('moda');
  await p.waitForFunction(() => window.operationsQA?.packages);
  await p.locator('#organization').selectOption(fixture.orgId);
  await p.waitForFunction(
    (org) =>
      document.querySelector('#organization').value === org &&
      window.operationsQA.packages.packages.some((x) => x.package_id.startsWith('operations-')),
    fixture.orgId,
  );
  await p.locator('#load-example').click();
  await p.waitForFunction(() =>
    document.querySelector('#document').value.includes('campus-starter'),
  );
  await p.locator('summary').click();
  const doc = JSON.parse(await p.locator('#document').inputValue());
  doc.packageId = 'browser-' + code;
  doc.name = name;
  doc.version = 1;
  await p.locator('#document').fill(JSON.stringify(doc, null, 2));
  await p.locator('#preview-package').click();
  await p.locator('#import-form').waitFor({ state: 'visible' });
  await p.locator('#package-preview').filter({ hasText: '不修改历史' }).waitFor();
  await p.locator('#import-reason').fill('负责人已核对本轮虚构模板与公开条件');
  await p.locator('#import-confirm').check();
  await p.locator('#import-form button').click();
  await p.waitForFunction(
    (id) => operationsQA.packages.packages.some((x) => x.package_id === id),
    doc.packageId,
  );
  await p.locator('#activation-confirm').check();
  await p.locator('#activation-reason').fill('用于本轮独立虚构校园排期');
  await p
    .locator('#packages .card')
    .filter({ hasText: name })
    .getByRole('button', { name: '激活此版本' })
    .click();
  await p.waitForFunction(
    (id) => operationsQA.packages.heads.some((x) => x.package_id === id),
    doc.packageId,
  );
  await p.locator('#active-package').selectOption(doc.packageId);
  await p.locator('#templates label').filter({ hasText: '校园志愿服务' }).waitFor();
  await p.locator('#plan-title').fill(name + ' 排期');
  await p.locator('#rule').selectOption(fixture.ruleVersion);
  await p.locator('#reward').selectOption(fixture.rewardId);
  await p.locator('#place').selectOption({ index: 1 });
  await p.locator('#plan-form button').click();
  await p.locator('#schedule-form').waitFor({ state: 'visible' });
  await p.locator('#plan-preview').filter({ hasText: '创建 4 个真实草稿' }).waitFor();
  assert.equal(await p.locator('#review').isVisible(), false);
  await p.locator('#schedule-confirm').check();
  await p.locator('#schedule-form button').click();
  await p.waitForFunction(() => operationsQA.report?.timeline.length === 4);
  const report = await p.evaluate(() => operationsQA.report);
  assert.ok(report.timeline.every((x) => x.activity.status === 'draft'));
  assert.equal(report.plan.reward.rewardId, fixture.rewardId);
  checks.push({
    name: 'owner imports reviewed JSON, explicitly activates and schedules four real drafts with rule/reward references',
    status: 'PASS',
  });
  await p.locator('summary').click();
  await p.screenshot({ path: 'qa/operations/operations-desktop.png', fullPage: true });
  const download = p.waitForEvent('download');
  await p.locator('#export').click();
  const file = await download;
  await file.saveAs('qa/operations/browser-review.json');
  const data = JSON.parse(await readFile('qa/operations/browser-review.json', 'utf8'));
  assert.equal(data.runId, report.runId);
  assert.equal(data.timeline.length, 4);
  assert.equal(data.plan.effects.issuesRewards, 0);
  const link = await p.locator('#timeline a').first().getAttribute('href');
  assert.ok(link.includes(report.timeline[0].activityId));
  checks.push({
    name: 'review export contains actual source activity IDs and explicit draft-only effects',
    status: 'PASS',
  });
  await p.setViewportSize({ width: 390, height: 844 });
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await p.screenshot({ path: 'qa/operations/operations-mobile.png', fullPage: true });
  const other = await account('bob');
  await other.p.locator('#status').filter({ hasText: '没有本校运营管理范围' }).waitFor();
  assert.equal(await other.p.locator('#workspace').isVisible(), false);
  assert.deepEqual(errors, []);
  checks.push({
    name: 'responsive owner workflow and unauthorized account boundary without JavaScript errors',
    status: 'PASS',
  });
  await writeFile(
    'qa/operations/browser.json',
    JSON.stringify({ status: 'PASS', checks, runId: report.runId, errors }, null, 2),
  );
} finally {
  await browser.close();
}
