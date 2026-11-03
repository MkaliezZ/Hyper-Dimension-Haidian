import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Owned isolated QA browser required');
const fixture = JSON.parse(await readFile('.local/campus-ledger-browser-fixture.json', 'utf8')),
  checks = [],
  errors = [];
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true });
const check = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
async function login(u) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 920 } }),
    page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill(u.username);
  await page.locator('#password').fill(u.password);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  await page.goto(config.origin + '/ranking.html');
  await page.locator('#org option[value="' + fixture.org + '"]').waitFor({ state: 'attached' });
  await page.locator('#org').selectOption(fixture.org);
  await page.waitForFunction(
    (org) => document.getElementById('ranking').dataset.scope === org,
    fixture.org,
  );
  return { page, context };
}
try {
  const member = await login(fixture.users[0]),
    owner = await login(fixture.owner);
  await check(
    'member ranking and immutable explanations survive reload; management hidden',
    async () => {
      const p = member.page;
      assert.equal(await p.locator('#manager').isVisible(), false);
      await p.locator('#entries article').filter({ hasText: '按原分数冲正' }).first().waitFor();
      await p.locator('#entries article').filter({ hasText: '每次 5' }).first().waitFor();
      await p.locator('#period').selectOption(fixture.period);
      await p.locator('#ranking-note').filter({ hasText: '第 2 代' }).waitFor();
      await p.screenshot({ path: 'qa/campus/campus-ledger-member.png', fullPage: true });
      await p.reload();
      await p.locator('#org option[value="' + fixture.org + '"]').waitFor({ state: 'attached' });
      await p.locator('#org').selectOption(fixture.org);
      await p.waitForFunction(
        (org) => document.getElementById('ranking').dataset.scope === org,
        fixture.org,
      );
      assert.ok((await p.locator('#entries article').count()) > 0);
    },
  );
  await check(
    'owner browser previews imports and explicitly approves a fictional rule version',
    async () => {
      const p = owner.page;
      await p.getByText('导入并审核规则（学校负责人）', { exact: true }).click();
      await p.locator('#example').click();
      const doc = JSON.parse(await p.locator('#rule-json').inputValue());
      doc.version = 'browser-rule-' + fixture.run;
      doc.label = '浏览器虚构规则 ' + fixture.run;
      await p.locator('#rule-json').fill(JSON.stringify(doc, null, 2));
      await p.locator('#preview').click();
      await p.locator('#preview-result').filter({ hasText: '虚构示例' }).waitFor();
      await p.locator('#import-rule').click();
      const card = p.locator('#rules article').filter({ hasText: doc.version });
      await card.getByRole('button', { name: '批准此规则' }).waitFor();
      p.once('dialog', (d) => d.accept('虚构界面审核验证，无真实分值政策'));
      await card.getByRole('button', { name: '批准此规则' }).click();
      await card.filter({ hasText: '已批准' }).waitFor();
      await p.screenshot({ path: 'qa/campus/campus-ledger-rule.png', fullPage: true });
    },
  );
  await check(
    'owner browser creates future period with explicit example activation and stable frozen rebuild',
    async () => {
      const p = owner.page;
      await p.getByText('建立新的计分时期', { exact: true }).click();
      await p.locator('#new-period').fill('browser-period-' + fixture.run);
      await p.locator('#period-label').fill('浏览器虚构未来时期 ' + fixture.run);
      await p.locator('#new-semester').fill('browser-semester-' + fixture.run);
      await p.locator('#rule-version').selectOption('browser-rule-' + fixture.run);
      const stamp = (d) => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      await p.locator('#starts').fill(stamp(new Date(Date.now() + 2 * 86400000)));
      await p.locator('#ends').fill(stamp(new Date(Date.now() + 3 * 86400000)));
      await p.locator('#period-form button').click();
      let card = p.locator('#periods article').filter({ hasText: 'browser-period-' + fixture.run });
      await card.getByRole('button', { name: '激活时期' }).waitFor();
      const answer = (d) => d.accept(d.type() === 'prompt' ? '明确虚构示例自动验收' : undefined);
      p.on('dialog', answer);
      await card.getByRole('button', { name: '激活时期' }).click();
      await card.filter({ hasText: '计分中' }).waitFor();
      await card.getByRole('button', { name: '冻结榜单' }).click();
      await card.filter({ hasText: '已冻结' }).waitFor();
      await Promise.all([
        p.waitForResponse((r) => r.url().endsWith('/rebuild') && r.request().method() === 'POST'),
        card.getByRole('button', { name: '从账本重建' }).click(),
      ]);
      await p.locator('#status').filter({ hasText: '已读取当前范围' }).waitFor();
      p.off('dialog', answer);
      await p.locator('#period').selectOption('browser-period-' + fixture.run);
      await p.locator('#ranking-note').filter({ hasText: '第 2 代' }).waitFor();
    },
  );
  await check('mobile no horizontal overflow and no page errors', async () => {
    await member.page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await member.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await member.page.screenshot({ path: 'qa/campus/campus-ledger-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
  });
  await mkdir('qa/campus', { recursive: true });
  await writeFile(
    'qa/campus/campus-ledger-browser.json',
    JSON.stringify(
      {
        scope:
          'automated browser contexts on one host, fictitious data; not physical multi-device or school acceptance',
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
