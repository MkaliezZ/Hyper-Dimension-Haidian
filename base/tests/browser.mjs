import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { loadPackages, startServer } from '../src/server.mjs';
const root = resolve(process.env.BASE_ROOT || '.'),
  paths = process.argv.slice(2);
if (!paths.length) paths.push(join(root, 'examples/north/space.json'));
const packs = await loadPackages(paths.map((p) => resolve(p))),
  dir = await mkdtemp(join(tmpdir(), 'hd-base-browser-')),
  qaDir = join(root, 'qa', 'browser-' + packs[0].spaceId);
let browser, server;
try {
  if (!process.env.BASE_URL)
    server = await startServer({ root, packs, dataDir: dir, port: 0, provider: null });
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      'C:/HyperDimension-Native-QA/Browsers/Chrome-155.0.8059.84/Extracted/chrome-win64/chrome.exe',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(r.status() + ' ' + new URL(r.url()).pathname);
  });
  await page.goto((process.env.BASE_URL || server.origin) + '/?space=' + packs[0].spaceId);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  const geometry = await page.evaluate(() => ({
    scene: window.baseQA.geometryHash,
    model: window.baseQA.modelHash,
    drawCalls: window.baseQA.drawCalls,
  }));
  assert.equal(geometry.scene, geometry.model);
  assert(geometry.drawCalls > 0 && geometry.drawCalls < 1000);
  await mkdir(qaDir, { recursive: true });
  await page.screenshot({ path: join(qaDir, 'scene-arrival.png') });
  await page.getByRole('button', { name: '开始参观' }).click();
  await page.waitForFunction(
    () => window.baseQA.position?.moving === false && window.baseQA.position.point[0] > 0,
    {},
    { timeout: 15000 },
  );
  const ground = packs[0].scenes[0].levels.find((l) => l.id === packs[0].spawn.levelId);
  await page
    .locator('[data-entity="' + ground.rooms.find((r) => r.access === 'public').entityId + '"]')
    .click();
  await page.getByRole('button', { name: '前往这个房间' }).click();
  await page.waitForFunction(
    (rect) => {
      const p = window.baseQA.position;
      return (
        p &&
        !p.moving &&
        p.point[0] > rect[0] &&
        p.point[0] < rect[0] + rect[2] &&
        p.point[2] > rect[1] &&
        p.point[2] < rect[1] + rect[3]
      );
    },
    ground.rooms.find((r) => r.access === 'public').rect,
    { timeout: 20000 },
  );
  const top = packs[0].scenes[0].levels.at(-1);
  await page.locator('[data-level="' + top.id + '"]').click();
  await page.screenshot({ path: join(qaDir, 'scene-upper-floor.png') });
  const room = top.rooms.find((r) => r.access === 'public');
  await page.locator('[data-entity="' + room.entityId + '"]').click();
  await page.getByRole('button', { name: '前往这个房间' }).click();
  await page.waitForFunction(
    (id) => window.baseQA.position?.levelId === id && !window.baseQA.position.moving,
    top.id,
    { timeout: 35000 },
  );
  const topPosition = await page.evaluate(() => window.baseQA.position);
  assert.equal(topPosition.levelId, top.id);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.equal((await page.evaluate(() => window.baseQA.position)).levelId, top.id);
  await page
    .locator('#message')
    .fill(packs[0].knowledge.find((k) => k.published).title + '，请介绍一下。');
  await page.locator('#send').click();
  await page.waitForSelector('.bubble.sources');
  assert(!(await page.locator('#conversation').innerText()).includes('PRIVATE_FIXTURE'));
  await page.screenshot({ path: join(qaDir, 'scene-reception.png') });
  await page.getByRole('button', { name: '返回入口' }).click();
  await page.waitForFunction(
    (id) =>
      window.baseQA.position?.levelId === id &&
      !window.baseQA.position.moving &&
      window.baseQA.position.point[0] < 0,
    packs[0].spawn.levelId,
    { timeout: 35000 },
  );
  assert.deepEqual(errors, []);
  const report = {
    at: new Date().toISOString(),
    kind: 'isolated-browser-automation',
    spaceId: packs[0].spaceId,
    geometry,
    checks: [
      'WebGL GLB rendered',
      'model/navigation hash equal',
      'walk from forecourt into building',
      'enter ground-floor room',
      'stairs to upper room',
      'published reception citations',
      'refresh retains server position',
      'return outside entrance',
      'no HTTP or page errors',
    ],
    notValidated: [
      'human acceptance',
      'physical Windows and macOS devices',
      'architectural construction accuracy',
    ],
  };
  await writeFile(join(qaDir, 'browser-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  await rm(dir, { recursive: true, force: true });
}
