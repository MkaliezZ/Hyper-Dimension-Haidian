import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const config = JSON.parse(await readFile(process.env.HD_M0_CONFIG, 'utf8')),
  fixtures = JSON.parse(await readFile(process.env.HD_M0_USERS, 'utf8'));
if (!process.env.HD_QA_CHROME)
  throw Error(
    'Set HD_QA_CHROME to an owned QA browser executable. No personal browser profile is used.',
  );
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.HD_QA_CHROME,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  }),
  errors = [];
const shotDir = 'qa/m0';
await mkdir(shotDir, { recursive: true });
async function session(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const f = fixtures.find((u) => u.username === name);
  await page.goto(config.origin + '/m0.html');
  await page.getByRole('link', { name: '登录校园账号' }).click();
  if (!(await page.locator('#username').count())) {
    await page.screenshot({ path: shotDir + '/login-diagnostic.png', fullPage: true });
    console.log((await page.locator('body').innerText()).slice(0, 600));
  }
  await page.locator('#username').fill(name);
  await page.locator('#password').fill(f.credentials[0].value);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m0.html');
  await page.waitForFunction(() => document.documentElement.dataset.m0ready === 'true');
  return { context, page };
}
try {
  const a = await session('alice'),
    page = a.page;
  await page.locator('select[name=palette]').selectOption('ochre');
  await page.locator('select[name=hair]').selectOption('bob');
  await page.locator('select[name=accessory]').selectOption('satchel');
  await page.waitForFunction(
    () =>
      window.m0QA.renderedRecipe().palette === 'ochre' &&
      window.m0QA.renderedRecipe().accessory === 'satchel',
  );
  await page.getByRole('button', { name: '保存形象' }).click();
  await page.waitForFunction(() => document.getElementById('save-status').dataset.hash);
  const hash = await page.locator('#save-status').getAttribute('data-hash'),
    recipe = await page.evaluate(() => window.m0QA.recipe());
  assert.ok((await page.evaluate(() => window.m0QA.drawCalls())) > 5);
  await page.screenshot({ path: shotDir + '/avatar-editor.png', fullPage: true });
  await page.getByRole('link', { name: '进入空间' }).click();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.equal(await page.evaluate(() => window.baseQA.avatarHash), hash);
  assert.deepEqual(await page.evaluate(() => window.baseQA.avatarRecipe), recipe);
  await page.screenshot({ path: shotDir + '/avatar-in-space.png', fullPage: true });
  const second = await session('alice');
  assert.deepEqual(await second.page.evaluate(() => window.m0QA.recipe()), recipe);
  await second.page.screenshot({ path: shotDir + '/second-browser-restored.png', fullPage: true });
  const other = await session('bob');
  assert.notDeepEqual(await other.page.evaluate(() => window.m0QA.recipe()), recipe);
  await page.goto(config.origin + '/m0.html');
  await page.waitForFunction(() => document.documentElement.dataset.m0ready === 'true');
  await page.locator('#title').fill('浏览器校园记忆 ' + Date.now());
  await page.locator('#content').fill('这是虚拟校园浏览器集成验证的记忆样例，不包含真实学校资料。');
  const state = await page.request.get(config.origin + '/m0/schools/north/forum/posting-state'),
    posting = await state.json();
  if (posting.retryAfterMs > 0) {
    console.log(
      'Preparing browser fixture: respecting NodeBB cooldown (' +
        Math.ceil(posting.retryAfterMs / 1000) +
        's).',
    );
    await new Promise((r) => setTimeout(r, posting.retryAfterMs + 30));
  }
  await page.getByRole('button', { name: '提交审核' }).click();
  await page.waitForFunction(() =>
    document.querySelector('#items')?.textContent.includes('等待审核'),
  );
  const mod = await session('moda');
  await mod.page.getByRole('button', { name: '采纳并发布' }).first().click();
  await mod.page.waitForFunction(() =>
    document.querySelector('#items')?.textContent.includes('已采纳'),
  );
  await mod.page.screenshot({ path: shotDir + '/moderation-ranking.png', fullPage: true });
  await second.page.getByRole('button', { name: '退出', exact: true }).click();
  await second.page.getByRole('link', { name: '登录校园账号' }).waitFor();
  assert.equal((await second.page.request.get(config.origin + '/m0/me')).status(), 401);
  assert.deepEqual(errors, []);
  await writeFile(
    shotDir + '/browser.json',
    JSON.stringify(
      {
        kind: 'automated-isolated-browser',
        humanTest: false,
        physicalMultiDevice: false,
        codePkceLogin: true,
        editorSave: true,
        modelHash: hash,
        recipe,
        existingSceneRenderer: true,
        independentContextsRestore: true,
        otherSchoolSeparate: true,
        forumModeration: true,
        logout: true,
        pageErrors: errors,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS browser OIDC PKCE, avatar edit/export/scene, independent context restore, forum moderation, logout',
  );
} finally {
  await browser.close();
}
