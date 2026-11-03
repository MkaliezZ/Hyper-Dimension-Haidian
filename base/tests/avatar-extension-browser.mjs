import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Owned test browser and fixture required');
const fixture = fixtures.find(
  (f) => f.username.startsWith('avatar-v2-') && f.username.endsWith('-browser'),
);
if (!fixture) throw Error('Run avatar-extension-live first to create a dedicated browser account');
await mkdir('qa/avatar-extension', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true }),
  errors = [],
  checks = [];
async function account() {
  const context = await browser.newContext({ viewport: { width: 1380, height: 1060 } }),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill(fixture.username);
  await page.locator('#password').fill(fixture.credentials[0].value);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  await page.goto(config.origin + '/m2.html');
  await page.waitForFunction(() => window.m2QA?.modelReady);
  return { context, page };
}
try {
  const a = await account(),
    oldHash = await a.page.evaluate(() => m2QA.saved.modelHash);
  assert.equal(await a.page.locator('#catalog-version').inputValue(), 'campus-original-1');
  await a.page.locator('#catalog-version').selectOption('campus-original-2');
  await a.page.waitForFunction(
    () =>
      m2QA.recipe.catalogVersion === 'campus-original-2' &&
      document.querySelectorAll('#part-hair option').length === 8,
  );
  assert.equal(await a.page.locator('#confirm-catalog-upgrade').isChecked(), false);
  assert.equal(await a.page.locator('#save').isDisabled(), true);
  assert.equal(await a.page.evaluate(() => m2QA.saved.modelHash), oldHash);
  for (const [slot, count] of Object.entries({
    body: 3,
    hair: 8,
    top: 6,
    bottom: 6,
    shoes: 4,
    glasses: 4,
    accessory: 7,
  }))
    assert.equal(await a.page.locator('#part-' + slot + ' option').count(), count);
  await a.page.locator('#part-hair').selectOption('hair-bun');
  await a.page.locator('#part-accessory').selectOption('accessory-cap');
  await a.page.locator('#compatibility').filter({ hasText: '这两个部件会重叠' }).waitFor();
  assert.equal(await a.page.locator('#save').isDisabled(), true);
  for (const [slot, id] of Object.entries({
    hair: 'hair-braids',
    top: 'top-vest',
    bottom: 'bottom-cargo',
    shoes: 'shoes-boots',
    glasses: 'glasses-oval',
    accessory: 'accessory-backpack',
  }))
    await a.page.locator('#part-' + slot).selectOption(id);
  await a.page.waitForFunction(() => document.getElementById('compatibility').textContent === '');
  await a.page.locator('#confirm-catalog-upgrade').check();
  await a.page.locator('#save').click();
  await a.page.locator('#status').filter({ hasText: '人物已保存' }).waitFor();
  const newHash = await a.page.evaluate(() => m2QA.saved.modelHash);
  assert.notEqual(newHash, oldHash);
  assert.equal(await a.page.evaluate(() => m2QA.saved.recipe.catalogVersion), 'campus-original-2');
  for (const pose of ['Idle', 'Walk', 'Wave'])
    await a.page.locator('[data-pose=' + pose + ']').click();
  await a.page.locator('[data-pose=Idle]').click();
  await a.page.screenshot({ path: 'qa/avatar-extension/studio-v2.png', fullPage: true });
  checks.push({
    name: '38-part editor requires explicit confirmation, validates incompatible parts and saves new model',
    status: 'PASS',
  });
  const b = await account();
  assert.equal(await b.page.evaluate(() => m2QA.saved.modelHash), newHash);
  assert.equal(await b.page.locator('#part-hair').inputValue(), 'hair-braids');
  assert.equal(await b.page.locator('#catalog-version').inputValue(), 'campus-original-2');
  checks.push({
    name: 'independent browser context restores exact v2 recipe and model',
    status: 'PASS',
  });
  await a.page.goto(config.origin + '/?space=north');
  await a.page.waitForFunction(() => window.baseQA?.avatarHash);
  assert.equal(await a.page.evaluate(() => baseQA.avatarHash), newHash);
  await a.page.screenshot({ path: 'qa/avatar-extension/scene-v2.png', fullPage: true });
  checks.push({
    name: 'running scene loads the saved upgraded avatar through the unchanged model interface',
    status: 'PASS',
  });
  await b.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await b.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    'qa/avatar-extension/browser.json',
    JSON.stringify(
      { status: 'PASS', checks, oldModelHash: oldHash, newModelHash: newHash, errors },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
