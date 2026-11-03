import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Owned browser and isolated fixture required');
const f = JSON.parse(
    await readFile(
      process.env.HD_ANNUAL_BROWSER_FIXTURE || '.local/annual-browser-fixture.json',
      'utf8',
    ),
  ),
  out = process.env.HD_ANNUAL_EVIDENCE || 'evidence/annual',
  checks = [],
  errors = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true });
async function pageFor(name) {
  const c = await browser.newContext({ viewport: { width: 1380, height: 1000 } }),
    p = await c.newPage();
  p.setDefaultTimeout(15000);
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(config.origin + '/auth/login');
  await p.locator('#username').fill(name);
  await p.locator('#password').fill(fixtures.find((x) => x.username === name).credentials[0].value);
  await p.locator('#kc-login').click();
  await p.waitForURL(config.origin + '/m1.html');
  return { c, p };
}
async function annual(p) {
  await p.goto(config.origin + '/annual.html');
  await p.locator('#package option[value="' + f.packageId + '"]').waitFor({ state: 'attached' });
  await p.locator('#package').selectOption(f.packageId);
  await p.locator('#entries article[data-entry="welcome-tour"]').waitFor();
  await p.locator('#year').fill('2026');
  await p.locator('#year').dispatchEvent('change');
  await p.locator('#year:enabled').waitFor();
  if (await p.locator('#management').isVisible())
    await p.locator('#tasks article').filter({ hasText: '迎新空间导览' }).waitFor();
}
try {
  const owner = await pageFor('moda');
  await annual(owner.p);
  await owner.p.locator('#month').selectOption('8');
  await owner.p.locator('#cohort').selectOption('new-student');
  await owner.p.locator('#filters button').click();
  assert((await owner.p.locator('#counts').textContent()).includes('不代表必做任务'));
  const planned = owner.p
    .locator('#tasks article')
    .filter({ hasText: '核对迎新合作服务与资料转交范围' });
  const resumedExistingWork = (await planned.count()) > 0;
  if (!resumedExistingWork) {
    const partner = owner.p.locator('#entries article[data-entry="partner-onboarding"]');
    await partner.locator('[data-plan-entry]').check();
    await owner.p.locator('#preview-plan').click();
    await owner.p.locator('#plan-preview').filter({ hasText: 'createsPlanningTasks' }).waitFor();
    await owner.p.locator('#confirm-plan').check();
    await owner.p.locator('#commit-plan').click();
    await owner.p.locator('#status').filter({ hasText: '运营事项已建立' }).waitFor();
  }
  const task = owner.p
    .locator('#tasks article')
    .filter({ hasText: '核对迎新合作服务与资料转交范围' });
  await task.waitFor();
  assert.match(
    await task.getByRole('link', { name: '查看合作服务' }).getAttribute('href'),
    /partners.html/,
  );
  assert.equal(await task.locator('input[type="datetime-local"]').inputValue(), '');
  await task.screenshot({ path: out + '/assigned-task.png' });
  await owner.p.screenshot({ path: out + '/manager.png', fullPage: true });
  checks.push(
    resumedExistingWork
      ? 'cohort/month filters and resumed saved assignment with no invented date; Base-4 service link'
      : 'cohort/month filters, explicit work preview and assignment with no invented date; Base-4 service link',
  );
  await owner.c.close();
  const user = await pageFor('alice');
  await annual(user.p);
  assert(await user.p.locator('#management').isHidden());
  const objective = user.p.locator('#entries article[data-entry="calendar-review"]');
  assert(await objective.locator('select').isDisabled());
  const guide = user.p.locator('#entries article[data-entry="guide-review"]');
  await guide.locator('select').selectOption('B');
  await guide.getByRole('checkbox').check();
  await guide.getByRole('button', { name: /加入我的计划|更新我的计划/ }).click();
  await user.p.locator('#status').filter({ hasText: '已保存你的个人计划' }).waitFor();
  await annual(user.p);
  const own = user.p.locator('#mine article').filter({ hasText: '审核图书馆与生活服务指南' });
  await own.waitFor();
  assert((await own.textContent()).includes('B'));
  await own.getByRole('button', { name: '已完成，解除评级' }).click();
  await user.p
    .locator('#mine article')
    .filter({ hasText: '审核图书馆与生活服务指南' })
    .filter({ hasText: '不评级' })
    .waitFor();
  await user.p.setViewportSize({ width: 390, height: 844 });
  assert(await user.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await user.p.locator('#mine').screenshot({ path: out + '/personal-mobile.png' });
  checks.push(
    'ordinary member sees enabled references and own opt-in only; reload restores choice; completion clears rating',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    out + '/browser.json',
    JSON.stringify(
      {
        status: 'PASS',
        fixtureOnly: true,
        resumedExistingWork,
        checks,
        errors,
        scope:
          'Owned headless browser contexts on one host; not actual students or physical devices.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS annual manager and private personal browser flows');
} finally {
  await browser.close();
}
