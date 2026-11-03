import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (!process.env.HD_QA_CHROME || process.env.HD_M1_TEST_FIXTURE !== '1')
  throw Error('Owned QA browser and isolated fixture opt-in required');
await mkdir('qa/m2', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true }),
  errors = [],
  checks = [],
  started = Date.now();
async function account() {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1050 } }),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill('alice');
  await page
    .locator('#password')
    .fill(fixtures.find((u) => u.username === 'alice').credentials[0].value);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  await page.goto(config.origin + '/m2.html');
  await page.waitForFunction(() => window.m2QA?.modelReady);
  return { context, page };
}
const test = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
try {
  const a = await account();
  let hash, recipe;
  await test('VRM 1 browser loader, all customization controls, live Idle/Walk/Wave and saved avatar', async () => {
    assert.equal(await a.page.evaluate(() => m2QA.vrm), true);
    await a.page.locator('#part-hair').selectOption('hair-ponytail');
    await a.page.locator('#part-top').selectOption('top-varsity');
    await a.page.locator('#part-accessory').selectOption('accessory-satchel');
    await a.page.locator('#part-glasses').selectOption('glasses-round');
    await a.page.locator('#part-height').selectOption('tall');
    await a.page.locator('#part-presentation').selectOption('soft');
    await a.page.locator('#color-top').fill('#b66d50');
    await a.page.waitForTimeout(500);
    await a.page.waitForFunction(
      () =>
        document.getElementById('compatibility').textContent === '' &&
        !document.getElementById('save').disabled,
    );
    for (const pose of ['Walk', 'Wave', 'Idle']) {
      await a.page.locator('[data-pose=' + pose + ']').click();
      assert.equal(await a.page.evaluate(() => m2QA.pose), pose);
    }
    await a.page.locator('#save').click();
    await a.page.locator('#status').filter({ hasText: '人物已保存' }).waitFor();
    hash = await a.page.evaluate(() => m2QA.saved.modelHash);
    recipe = await a.page.evaluate(() => m2QA.recipe);
    assert.equal(recipe.parts.hair, 'hair-ponytail');
    await a.page.screenshot({ path: 'qa/m2/avatar-studio.png', fullPage: true });
  });
  const b = await account();
  await test('second independent browser context restores exact recipe/model hash and school bag', async () => {
    assert.equal(await b.page.evaluate(() => m2QA.saved.modelHash), hash);
    assert.deepEqual(await b.page.evaluate(() => m2QA.recipe), recipe);
    await b.page.locator('[data-item="campus-map"]').waitFor();
    if ((await b.page.locator('[data-item="campus-map"]').getAttribute('data-equipped')) !== 'true')
      await b.page.locator('[data-item="campus-map"] button').click();
    await b.page.locator('[data-item="campus-map"][data-equipped="true"]').waitFor();
    assert.equal(
      await b.page.locator('[data-item="campus-map"]').getAttribute('data-equipped'),
      'true',
    );
    await b.page.reload();
    await b.page.waitForFunction(() => window.m2QA?.modelReady);
    await b.page.locator('[data-item="campus-map"][data-equipped="true"]').waitFor();
    assert.equal(
      await b.page.locator('[data-item="campus-map"]').getAttribute('data-equipped'),
      'true',
    );
  });
  await test('scene uses saved avatar, real navigation then postcard and private note handoff to forum draft', async () => {
    await a.page.goto(config.origin + '/?space=north');
    await a.page.waitForFunction(
      () => document.documentElement.dataset.ready === 'true' && window.baseQA?.avatarHash,
    );
    assert.equal(await a.page.evaluate(() => baseQA.avatarHash), hash);
    await a.page.locator('#bag-tools').waitFor({ state: 'visible' });
    const r = await a.page.locator('#rooms button').first();
    await r.click();
    await a.page.locator('#enter-room').click();
    await a.page.locator('#status').filter({ hasText: '已到达' }).waitFor();
    await a.page.locator('#equipped-tool').selectOption('postcard-camera');
    await a.page.locator('#tool-text').fill('属于我的校园明信片');
    await a.page.locator('#use-tool').click();
    await a.page.locator('#tool-result').filter({ hasText: '明信片已保存' }).waitFor();
    await a.page.screenshot({ path: 'qa/m2/scene-backpack.png', fullPage: true });
    await a.page.locator('#equipped-tool').selectOption('note-card');
    await a.page.locator('#tool-text').fill('我在这里保存一段只属于自己的校园记忆。');
    await a.page.locator('#use-tool').click();
    await a.page.locator('#tool-result').filter({ hasText: '私人记忆已保存' }).waitFor();
    await a.page.goto(config.origin + '/m2.html');
    await a.page.locator('#collections a').filter({ hasText: '带到论坛编辑器' }).first().click();
    await a.page.locator('#status').filter({ hasText: '尚未公开' }).waitFor();
    assert.ok((await a.page.locator('#content').inputValue()).length > 8);
  });
  await test('mobile layout and no browser exceptions', async () => {
    await b.page.setViewportSize({ width: 390, height: 844 });
    await b.page.goto(config.origin + '/m2.html');
    await b.page.waitForFunction(() => window.m2QA?.modelReady);
    assert.ok(await b.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await b.page.screenshot({ path: 'qa/m2/mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
  });
  await writeFile(
    'qa/m2/browser.json',
    JSON.stringify(
      {
        status: 'PASS',
        checks,
        errors,
        durationMs: Date.now() - started,
        avatarHash: hash,
        browser: 'owned Chrome on one Windows host; two fresh contexts',
      },
      null,
      2,
    ),
  );
} catch (e) {
  for (const c of browser.contexts())
    for (const p of c.pages()) {
      console.log(
        JSON.stringify({
          path: new URL(p.url()).pathname,
          status: await p
            .locator('#status')
            .textContent()
            .catch(() => null),
          error: await p
            .locator('#compatibility')
            .textContent()
            .catch(() => null),
          errors,
        }),
      );
      await p.screenshot({ path: 'qa/m2/browser-failure.png', fullPage: true }).catch(() => {});
    }
  throw e;
} finally {
  await browser.close();
}
