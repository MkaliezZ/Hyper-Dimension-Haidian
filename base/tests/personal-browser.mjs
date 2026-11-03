import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Owned QA browser and isolated fixture required');
await mkdir('qa/personal', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true }),
  errors = [],
  checks = [];
async function account(name) {
  const context = await browser.newContext({ viewport: { width: 1340, height: 1000 } }),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill(name);
  await page
    .locator('#password')
    .fill(fixtures.find((f) => f.username === name).credentials[0].value);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  await page.goto(config.origin + '/profile.html?school=north');
  await page.waitForFunction(() => window.personalQA?.own);
  return { page, context };
}
try {
  const a = await account('alice');
  await a.page.locator('#bio').fill('只给自己看的校园草稿');
  await a.page.locator('#v-bio').selectOption('private');
  await a.page.locator('#department').fill('设计与创作学院');
  await a.page.locator('#v-department').selectOption('school');
  await a.page.locator('#profile-form button').click();
  await a.page.locator('#status').filter({ hasText: '名片与隐私已保存' }).waitFor();
  await a.page.locator('#new-work').click();
  const title = '浏览器作品 ' + Date.now();
  await a.page.locator('#work-title').fill(title);
  await a.page.locator('#work-description').fill('这是自动化验证用的原创校园展览说明。');
  await a.page.locator('#work-link').fill('https://example.com/campus');
  await a.page.locator('#work-status').selectOption('published');
  await a.page.locator('#work-visibility').selectOption('school');
  await a.page.locator('#work-form button').first().click();
  await a.page.locator('#status').filter({ hasText: '作品已保存' }).waitFor();
  const userId = await a.page.evaluate(() => personalQA.userId),
    workId = await a.page.evaluate(
      (t) => personalQA.works.find((w) => w.title === t).work_id,
      title,
    );
  await a.page.reload();
  await a.page.waitForFunction(() => window.personalQA?.own);
  await a.page.locator('[data-work="' + workId + '"]').waitFor();
  assert.equal(await a.page.locator('#bio').inputValue(), '只给自己看的校园草稿');
  await a.page.screenshot({ path: 'qa/personal/profile-own.png', fullPage: true });
  checks.push({ name: 'own profile privacy and published work survive reload', status: 'PASS' });
  const b = await account('shared');
  await b.page.locator('#target').fill(userId);
  await b.page.locator('#view-form button').first().click();
  await b.page.waitForFunction((id) => window.personalQA?.userId === id, userId);
  assert.equal(await b.page.locator('#profile-form').isVisible(), false);
  assert.equal(
    (await b.page.locator('#profile-view').innerText()).includes('只给自己看的校园草稿'),
    false,
  );
  assert.match(await b.page.locator('#profile-view').innerText(), /设计与创作学院/);
  await b.page.locator('[data-work="' + workId + '"] a').waitFor();
  assert.equal(
    await b.page.locator('[data-work="' + workId + '"] a').getAttribute('rel'),
    'noopener noreferrer',
  );
  await b.page.screenshot({ path: 'qa/personal/profile-member.png', fullPage: true });
  checks.push({
    name: 'independent school member sees only shared fields and work with safe external link',
    status: 'PASS',
  });
  await a.page.locator('[data-work="' + workId + '"] button').click();
  await a.page.locator('#work-status').selectOption('withdrawn');
  await a.page.locator('#work-form button').first().click();
  await a.page.locator('#status').filter({ hasText: '作品已保存' }).waitFor();
  await b.page.locator('#view-form button').first().click();
  await b.page.waitForFunction(
    (id) => window.personalQA && !personalQA.works.some((w) => w.work_id === id),
    workId,
  );
  checks.push({ name: 'withdrawn work disappears from other member page', status: 'PASS' });
  const o = await account('moda'),
    badgeLabel = '浏览器共创徽章 ' + Date.now();
  await o.page.locator('#badge-admin').waitFor({ state: 'visible' });
  await o.page.locator('#badge-user').fill(userId);
  await o.page.locator('#badge-label').fill(badgeLabel);
  await o.page.locator('#badge-reason').fill('验证虚构学校社区徽章的完整操作流程');
  await o.page.locator('#issue-form button').click();
  await o.page.locator('#status').filter({ hasText: '社区徽章已发放' }).waitFor();
  await a.page.reload();
  await a.page.waitForFunction(() => window.personalQA?.own);
  const badgeId = await a.page.evaluate(
    (label) => personalQA.badges.find((x) => x.label === label).badge_id,
    badgeLabel,
  );
  await b.page.locator('#view-form button').first().click();
  await b.page.waitForFunction((id) => window.personalQA?.userId === id, userId);
  assert.equal(await b.page.locator('[data-badge="' + badgeId + '"]').count(), 0);
  await a.page.locator('[data-badge="' + badgeId + '"] select').selectOption('school');
  await a.page.locator('#status').filter({ hasText: '徽章可见范围已保存' }).waitFor();
  await b.page.locator('#view-form button').first().click();
  await b.page.locator('[data-badge="' + badgeId + '"]').waitFor();
  await o.page.locator('#revoke-reason').fill('验证管理员撤回后立即停止展示');
  await o.page
    .locator('#managed-badges .entry')
    .filter({ hasText: badgeLabel })
    .locator('button')
    .click();
  await o.page.locator('#status').filter({ hasText: '内容已在别处更新' }).waitFor();
  await o.page.locator('#refresh-admin').click();
  await o.page.locator('#status').filter({ hasText: '已刷新徽章发放记录' }).waitFor();
  await o.page
    .locator('#managed-badges .entry')
    .filter({ hasText: badgeLabel })
    .locator('button')
    .click();
  await o.page.locator('#status').filter({ hasText: '徽章已撤回' }).waitFor();
  await b.page.locator('#view-form button').first().click();
  await b.page.waitForFunction(
    (id) => window.personalQA && !personalQA.badges.some((x) => x.badge_id === id),
    badgeId,
  );
  checks.push({
    name: 'owner issues badge, recipient explicitly shares, owner revocation hides it from peers',
    status: 'PASS',
  });
  await a.page.setViewportSize({ width: 390, height: 844 });
  await a.page.screenshot({ path: 'qa/personal/profile-mobile.png', fullPage: true });
  assert.equal(
    await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  assert.deepEqual(errors, []);
  checks.push({ name: 'mobile layout and browser errors', status: 'PASS' });
  await writeFile(
    'qa/personal/browser.json',
    JSON.stringify({ status: 'PASS', checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
