import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Owned browser with fictitious fixture required');
const fixture = JSON.parse(await readFile('qa/agents/browser-fixture.json', 'utf8')),
  browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true }),
  context = await browser.newContext({ viewport: { width: 1360, height: 1000 } }),
  page = await context.newPage(),
  checks = [],
  errors = [],
  started = Date.now();
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => errors.push(e.message));
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
async function directory() {
  await page.goto(config.origin + '/agents.html?school=north');
  await page.waitForFunction(() => window.agentsQA?.ready);
}
try {
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill('alice');
  await page
    .locator('#password')
    .fill(fixtures.find((u) => u.username === 'alice').credentials[0].value);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  await test('directory distinguishes real reception agent, human workflow assistants and responsible roles', async () => {
    await directory();
    await page.locator('#search').fill(fixture.activityTitle);
    const card = page.locator('[data-agent-id="activity:' + fixture.activityId + '"]');
    await card.filter({ hasText: '活动流程助手' }).waitFor();
    await card.filter({ hasText: '学校负责人' }).waitFor();
    await page.screenshot({ path: 'qa/agents/directory.png', fullPage: true });
    await card.getByRole('button', { name: '查看安排并自行报名' }).click();
    await page.waitForURL(/activities.html/);
    await page.locator('#detail-title').filter({ hasText: fixture.activityTitle }).waitFor();
    assert.equal(await page.locator('#school').inputValue(), 'north');
  });
  await test('partner assistant opens actual reviewed service with explicit consent workflow and no automatic submission', async () => {
    await directory();
    const before = await page.evaluate(async () =>
      (await (await fetch('/m5/schools/north/tasks')).json()).tasks.map((t) => t.taskId),
    );
    await page.locator('#search').fill(fixture.serviceTitle);
    await page
      .locator('[data-agent-id="partner:' + fixture.serviceId + '"]')
      .getByRole('button', { name: '核对服务并确认申请' })
      .click();
    await page.waitForURL(/partners.html/);
    await page.locator('#service-title').filter({ hasText: fixture.serviceTitle }).waitFor();
    await page.locator('#new-request').waitFor({ state: 'visible' });
    const after = await page.evaluate(async () =>
      (await (await fetch('/m5/schools/north/tasks')).json()).tasks.map((t) => t.taskId),
    );
    assert.deepEqual(
      after,
      before,
      'following a service assistant must not submit any application',
    );
  });
  await test('space reception shows actual identity and responsible role, responsive directory is readable', async () => {
    await page.goto(config.origin + '/?space=' + encodeURIComponent(fixture.spaceId));
    await page
      .locator('#reception-responsibility')
      .filter({ hasText: fixture.receptionId })
      .waitFor();
    await page.locator('#reception-responsibility').filter({ hasText: '学校负责人' }).waitFor();
    await page.locator('#reception-directory').waitFor({ state: 'visible' });
    await page.screenshot({ path: 'qa/agents/reception.png', fullPage: true });
    await page.locator('#reception-directory').click();
    await page.waitForFunction(() => window.agentsQA?.ready);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#search').fill(fixture.activityTitle);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: 'qa/agents/mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
  });
  await writeFile(
    'qa/agents/browser.json',
    JSON.stringify(
      {
        status: 'PASS',
        generatedAt: new Date().toISOString(),
        checks,
        errors,
        durationMs: Date.now() - started,
        scope:
          'Owned Chrome automated contexts and fictitious sources, not human or production-school acceptance.',
      },
      null,
      2,
    ),
  );
} catch (e) {
  await mkdir('qa/agents', { recursive: true });
  await writeFile(
    'qa/agents/browser.json',
    JSON.stringify({ status: 'FAIL', checks, error: e.message, errors }, null, 2),
  );
  await page.screenshot({ path: 'qa/agents/failure.png', fullPage: true });
  throw e;
} finally {
  await browser.close();
}
