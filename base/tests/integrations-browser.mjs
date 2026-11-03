import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Owned browser and isolated fixture required');
const fixture = JSON.parse(
  await readFile(process.env.HD_RESTORE_FIXTURE || '.local/restore-fixture.json', 'utf8'),
);
const output = process.env.HD_INTEGRATION_EVIDENCE || 'evidence/integrations';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true }),
  errors = [],
  checks = [];
async function loginPage(username) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
    page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill(username);
  await page
    .locator('#password')
    .fill(fixtures.find((x) => x.username === username).credentials[0].value);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  return { context, page };
}
try {
  const { page, context } = await loginPage('alice');
  await page.goto(config.origin + '/delegations.html?school=north&service=' + fixture.serviceId);
  await page.locator('#services input[value="' + fixture.serviceId + '"]').waitFor();
  await page.locator('#services input[value="' + fixture.serviceId + '"]').check();
  await page.locator('#label').fill('独立浏览器验收');
  await page.locator('#confirmed').check();
  await page.getByRole('button', { name: '创建授权', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('token').value.startsWith('hd_ag_'));
  await page.locator('#clear').click();
  assert.equal(await page.locator('#token').inputValue(), '');
  const grant = page.locator('#grants article').filter({ hasText: '独立浏览器验收' });
  await grant.getByRole('button', { name: '撤销', exact: true }).click();
  await grant.filter({ hasText: '已撤销' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: output + '/delegations-mobile.png', fullPage: true });
  checks.push('scoped grant creation, one-time token, clearing and revocation in real browser');
  await context.close();
  const owner = await loginPage('moda');
  await owner.page.goto(config.origin + '/knowledge.html');
  await owner.page.locator('#publish').waitFor({ state: 'visible' });
  await owner.page.waitForFunction(() =>
    document.getElementById('documents').value.includes('restore-public'),
  );
  assert.match(await owner.page.locator('#documents').inputValue(), /修订版/);
  await owner.page.screenshot({ path: output + '/knowledge.png', fullPage: true });
  checks.push('owner sees reviewed publication snapshot and automatic index state');
  await owner.page.goto(config.origin + '/history.html');
  await owner.page.locator('#search').waitFor({ state: 'visible' });
  await owner.page.locator('#org').selectOption(fixture.orgId);
  await owner.page.locator('#query').fill('榕树恢复验收历史');
  await owner.page.locator('#history').check();
  await owner.page.getByRole('button', { name: '检索', exact: true }).click();
  await owner.page
    .locator('#results article')
    .filter({ hasText: '历史审核版本 ' + fixture.rev1 })
    .waitFor();
  await owner.page
    .locator('#results article')
    .filter({ hasText: '当前审核版本 ' + fixture.rev2 })
    .waitFor();
  await owner.page.screenshot({ path: output + '/history.png', fullPage: true });
  await owner.page.locator('#history').uncheck();
  await owner.page.getByRole('button', { name: '检索', exact: true }).click();
  await owner.page.waitForFunction(
    () => document.getElementById('status').textContent === '已按当前权限与来源状态核对。',
  );
  assert.equal(
    await owner.page.locator('#results article').filter({ hasText: '历史审核版本' }).count(),
    0,
  );
  checks.push('current-only search and explicit reviewed history with version labels');
  assert.deepEqual(errors, []);
  await writeFile(
    output + '/browser.json',
    JSON.stringify(
      {
        status: 'PASS',
        fixtureOnly: true,
        checks,
        errors,
        browserClosed: true,
        scope: 'Owned headless browser on one host; no user browser or physical-device acceptance.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS browser grant, publication and historical search flows');
} finally {
  await browser.close();
}
