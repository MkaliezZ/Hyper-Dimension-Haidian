import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (!process.env.HD_QA_CHROME) throw Error('Explicit owned QA Chrome required');
if (process.env.HD_M1_TEST_FIXTURE !== '1')
  throw Error('Explicit isolated fixture acceptance required');
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true }),
  checks = [],
  errors = [],
  started = Date.now();
async function account(name) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } }),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill(name);
  await page
    .locator('#password')
    .fill(fixtures.find((u) => u.username === name).credentials[0].value);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  const me = await (await context.request.get(config.origin + '/m0/me')).json();
  return { context, page, me };
}
const test = async (name, fn) => {
  try {
    await fn();
    checks.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  } catch (e) {
    for (const c of browser.contexts())
      for (const p of c.pages()) {
        console.log(
          JSON.stringify({
            page: new URL(p.url()).pathname,
            status: await p
              .locator('#status')
              .textContent()
              .catch(() => null),
            connection: await p
              .locator('#connection')
              .textContent()
              .catch(() => null),
          }),
        );
      }
    throw e;
  }
};
try {
  const [a, b, mod] = await Promise.all(['alice', 'shared', 'moda'].map(account));
  await test('two clean browser contexts: OIDC login, contact selection, live private send and read receipts', async () => {
    await Promise.all([
      a.page.goto(config.origin + '/social.html'),
      b.page.goto(config.origin + '/social.html'),
    ]);
    await a.page.locator('#contacts').getByRole('button', { name: b.me.name, exact: true }).click();
    await b.page.locator('#contacts').getByRole('button', { name: a.me.name, exact: true }).click();
    await Promise.all([
      a.page.locator('#connection').filter({ hasText: '已连接' }).waitFor(),
      b.page.locator('#connection').filter({ hasText: '已连接' }).waitFor(),
    ]);
    const text = '浏览器端实时验收 ' + randomUUID();
    await a.page.locator('#text').fill(text);
    await a.page.locator('#send button').click();
    await b.page.locator('#messages p').filter({ hasText: text }).waitFor();
    await a.page.locator('#reads').filter({ hasText: '对方已读' }).waitFor();
    await b.page.screenshot({ path: 'qa/m1-social/chat.png', fullPage: true });
    await b.page.reload();
    await b.page.locator('#contacts').getByRole('button', { name: a.me.name, exact: true }).click();
    await b.page.locator('#messages p').filter({ hasText: text }).waitFor();
  });
  await test('browser editor: private draft review replaces native original with same ID', async () => {
    const list = await (
      await a.context.request.get(config.origin + '/m1/schools/north/forum')
    ).json();
    const item = list.items.find(
      (i) => i.status === 'published' && i.userId === a.me.userId && !i.parentId && !i.hasDraft,
    );
    assert.ok(item);
    const url =
      config.origin + '/forum-editor.html?' + new URLSearchParams({ school: 'north', id: item.id });
    await a.page.goto(url);
    await a.page.locator('#editPanel').waitFor({ state: 'visible' });
    const text = '通过浏览器提交并经审核写入原帖的正文 ' + randomUUID();
    await a.page.locator('#title').fill('浏览器审核修订验收');
    await a.page.locator('#content').fill(text);
    await a.page.locator('#edit button').click();
    await a.page.locator('#draftPanel').waitFor({ state: 'visible' });
    await mod.page.goto(url);
    await mod.page.getByRole('button', { name: '审核更新原帖' }).click();
    await mod.page.locator('#published').filter({ hasText: text }).waitFor();
    await a.page.reload();
    await a.page.locator('#published').filter({ hasText: text }).waitFor();
    await a.page.screenshot({ path: 'qa/m1-social/editor.png', fullPage: true });
    const detail = await (
      await a.context.request.post(config.origin + '/m1/schools/north/forum', {
        data: { action: 'detail', id: item.id },
      })
    ).json();
    assert.equal(detail.pid, item.pid);
  });
  await test('mobile layout remains within viewport; no uncaught browser errors', async () => {
    await b.page.setViewportSize({ width: 390, height: 844 });
    await b.page.goto(config.origin + '/social.html');
    await b.page.locator('#contacts button').first().waitFor();
    assert.equal(
      await b.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  await writeFile(
    'qa/m1-social/browser.json',
    JSON.stringify(
      {
        status: checks.length === 3 ? 'PASS' : 'INCOMPLETE',
        checks,
        pageErrors: errors,
        durationMs: Date.now() - started,
        environment: 'owned fresh Chrome contexts; automated single-host browser acceptance',
      },
      null,
      2,
    ),
  );
}
