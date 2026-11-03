import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Owned QA browser only');
const fixture = JSON.parse(await readFile('.local/job-admin-browser-fixture.json', 'utf8')),
  checks = [],
  errors = [];
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true });
async function login(u) {
  const c = await browser.newContext({ viewport: { width: 1320, height: 900 } }),
    p = await c.newPage();
  p.setDefaultTimeout(15000);
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(config.origin + '/auth/login');
  await p.locator('#username').fill(u.username);
  await p.locator('#password').fill(u.password);
  await p.locator('#kc-login').click();
  await p.waitForURL(config.origin + '/m1.html');
  await p.goto(config.origin + '/jobs.html');
  return p;
}
const check = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
try {
  const [owner, moderator, visitor] = await Promise.all([
    login(fixture.owner),
    login(fixture.moderator),
    login(fixture.visitor),
  ]);
  await check(
    'school owner sees safe real failure status, moderator and visitor see a clear role boundary',
    async () => {
      await owner.waitForFunction(() => document.body.dataset.ready === 'north');
      const card = owner.locator('[data-job-id="' + fixture.uiJob.jobId + '"]');
      await card.filter({ hasText: '执行失败' }).waitFor();
      assert.equal((await owner.locator('body').innerText()).includes('CONFIDENTIAL-'), false);
      for (const p of [moderator, visitor]) {
        await p.locator('#status').filter({ hasText: '只有学校负责人' }).waitFor();
        assert.equal(await p.locator('#access').isVisible(), false);
      }
    },
  );
  await check(
    'owner supplies a reason and retries the original job without an arbitrary-payload editor',
    async () => {
      const card = owner.locator('[data-job-id="' + fixture.uiJob.jobId + '"]');
      owner.once('dialog', (d) => d.accept('虚构界面维护已核对失败原因'));
      await card.getByRole('button', { name: '填写理由并重试', exact: true }).click();
      await owner.locator('#status').filter({ hasText: '已受理原任务重试' }).waitFor();
      await card.filter({ hasText: '等待自动重试' }).waitFor();
      assert.equal(
        await card.getByRole('button', { name: '填写理由并重试', exact: true }).count(),
        0,
      );
      const r = await owner.request.get(config.origin + '/jobs/schools/north/items');
      assert.equal(r.status(), 200);
      const item = (await r.json()).items.find((x) => x.jobId === fixture.uiJob.jobId);
      assert.equal(item.state, 'retry');
      assert.equal(item.retryLimit, 1);
      await owner.screenshot({ path: 'qa/campus/job-admin-owner.png', fullPage: true });
    },
  );
  await check('390px owner controls remain readable without horizontal overflow', async () => {
    await owner.setViewportSize({ width: 390, height: 844 });
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await owner.screenshot({ path: 'qa/campus/job-admin-mobile.png', fullPage: true });
  });
  assert.deepEqual(errors, []);
  await writeFile(
    'qa/campus/job-admin-browser.json',
    JSON.stringify(
      {
        scope:
          'Automated Chrome, isolated native PostgreSQL/pg-boss; not real operators or physical multi-device acceptance',
        run: fixture.run,
        checks,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
