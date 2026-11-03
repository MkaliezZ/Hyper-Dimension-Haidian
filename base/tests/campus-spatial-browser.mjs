import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
import { digest } from '../src/protocol/index.mjs';

if (process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled || !process.env.HD_QA_CHROME)
  throw Error('Isolated campus and owned QA Chrome required');
const username = process.env.HD_SPATIAL_USER || 'shared';
const output = 'qa/campus/spatial';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.HD_QA_CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const startedAt = new Date().toISOString(),
  started = performance.now(),
  spaces = [],
  errors = [],
  requests = [];
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  const u = new URL(r.url());
  if (u.origin === config.origin && r.status() >= 400) errors.push(`${r.status()} ${u.pathname}`);
});
const get = async (path) => {
  const r = await context.request.get(config.origin + path);
  assert.equal(r.status(), 200, path);
  return r.json();
};
const ready = () =>
  page.waitForFunction(
    () => document.documentElement.dataset.ready === 'true' && window.baseQA?.geometryHash,
  );
const current = () => page.evaluate(() => ({ ...window.baseQA.position }));
const near = (point, expected, tolerance = 0.001) =>
  point.every((x, i) => Math.abs(x - expected[i]) <= tolerance);
async function move(path, click, expected) {
  const t = performance.now();
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === path && r.request().method() === 'POST',
  );
  await click();
  const r = await response;
  assert.equal(r.status(), 200, `real navigation request ${path}`);
  const route = await r.json();
  assert.ok(Array.isArray(route.path) && route.path.length > 0);
  assert.ok(Number.isFinite(route.distance) && route.distance >= 0);
  assert.equal(route.speed, 4, 'Do not speed up movement to claim a shorter acceptance run');
  const endpoint = route.path.at(-1);
  assert.equal(endpoint.levelId, expected.levelId);
  assert.equal(route.geometryHash, expected.geometryHash);
  if (expected.point) {
    // Grid navigation ends at a cell centre. Bound its distance from the original
    // spawn to half a cell diagonal, then require arrival at that exact endpoint.
    assert.ok(
      Math.hypot(...endpoint.point.map((x, i) => x - expected.point[i])) <=
        expected.cellSize / Math.sqrt(2) + 0.001,
    );
  }
  await page.waitForFunction(
    ({ levelId, rect, point }) => {
      const p = window.baseQA.position;
      if (!p || p.moving || p.levelId !== levelId) return false;
      if (point) return p.point.every((x, i) => Math.abs(x - point[i]) < 0.001);
      return (
        p.point[0] > rect[0] &&
        p.point[0] < rect[0] + rect[2] &&
        p.point[2] > rect[1] &&
        p.point[2] < rect[1] + rect[3]
      );
    },
    expected.point ? { ...expected, point: endpoint.point } : expected,
    { timeout: 35000 },
  );
  const server = await get(path.replace(/\/move$/, '/position'));
  assert.equal(server.moving, false, 'server must also report arrival');
  assert.equal(server.levelId, expected.levelId);
  assert.ok(
    near((await current()).point, server.point),
    'browser and authoritative position match',
  );
  const record = {
    levelId: server.levelId,
    point: server.point,
    distance: route.distance,
    pathPoints: route.path.length,
    traversedLevels: [...new Set(route.path.map((p) => p.levelId))],
    connectors: [...new Set(route.path.map((p) => p.connectorId).filter(Boolean))],
    requestedPoint: expected.point || null,
    durationMs: Math.round(performance.now() - t),
  };
  requests.push(record);
  return record;
}
try {
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill(username);
  await page
    .locator('#password')
    .fill(fixtures.find((f) => f.username === username).credentials[0].value);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  const catalog = await get('/api/catalog');
  const ids = config.schools.map((s) => s.spaceId);
  assert.equal(ids.length, 2, 'This check is for the two original campus example spaces');
  assert.ok(
    ids.every((id) => catalog.spaces.some((s) => s.spaceId === id)),
    'Fixture must access both schools',
  );
  assert.ok(
    ids.every((id) => !id.toLowerCase().includes('plan14')),
    'Do not test or publish private drawing projects',
  );
  for (const spaceId of ids) {
    await page.goto(config.origin + '/?space=' + encodeURIComponent(spaceId));
    await ready();
    const initial = await get('/api/spaces/' + spaceId + '/scene');
    assert.equal(initial.geometryHash, digest(initial.scene));
    const glb = await context.request.get(config.origin + initial.modelUrl);
    assert.equal(glb.status(), 200);
    const bytes = await glb.body();
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    const model = JSON.parse(
      bytes
        .subarray(20, 20 + bytes.readUInt32LE(12))
        .toString('utf8')
        .trim(),
    );
    assert.equal(model.extras.geometryHash, initial.geometryHash);
    const meshHash = createHash('sha256').update(bytes).digest('hex');
    const qa = await page.evaluate(() => ({
      geometryHash: baseQA.geometryHash,
      modelHash: baseQA.modelHash,
      drawCalls: baseQA.drawCalls,
    }));
    assert.equal(qa.geometryHash, initial.geometryHash);
    assert.equal(qa.modelHash, initial.geometryHash);
    assert.ok(qa.drawCalls > 0 && qa.drawCalls < 1000);
    const result = {
      spaceId,
      sceneId: initial.scene.sceneId,
      geometryHash: initial.geometryHash,
      modelSha256: meshHash,
      modelBytes: bytes.length,
      levels: initial.scene.levels.length,
      artworkCount: initial.scene.artwork?.length || 0,
      publicAssets: initial.assets.length,
      publishedExhibits: initial.exhibits.length,
      drawCalls: qa.drawCalls,
      rooms: [],
    };
    spaces.push(result);
    const routePath = '/api/spaces/' + spaceId + '/move';
    const spawn = {
      ...initial.spawn,
      cellSize: initial.scene.cellSize,
      geometryHash: initial.geometryHash,
    };
    await move(routePath, () => page.locator('#return-entry').click(), spawn);
    let crossed = false;
    for (const level of initial.scene.levels) {
      for (const room of level.rooms.filter((r) => r.access === 'public')) {
        await page.locator('[data-level="' + level.id + '"]').click();
        await page.locator('#rooms [data-entity="' + room.entityId + '"]').click();
        const trip = await move(routePath, () => page.locator('#enter-room').click(), {
          levelId: level.id,
          rect: room.rect,
          geometryHash: initial.geometryHash,
        });
        crossed ||= trip.traversedLevels.length > 1;
        result.rooms.push({ entityId: room.entityId, name: room.name, ...trip });
        console.log('PASS ' + spaceId + ' / ' + room.entityId + ' actual arrival');
      }
    }
    assert.equal(
      result.rooms.length,
      initial.scene.levels.reduce(
        (n, l) => n + l.rooms.filter((r) => r.access === 'public').length,
        0,
      ),
    );
    assert.ok(result.rooms.length > 0);
    if (initial.scene.levels.length > 1)
      assert.ok(crossed, 'At least one actual connector traversal required');
    const beforeReload = await current();
    await page.reload();
    await ready();
    const afterReload = await current();
    assert.equal(afterReload.levelId, beforeReload.levelId);
    assert.ok(near(afterReload.point, beforeReload.point));
    result.reloadRetainedPosition = true;
    // Show a current art-bearing floor without replacing actual navigation evidence with a screenshot.
    const artLevel = initial.scene.artwork?.[0]?.levelId || initial.spawn.levelId;
    await page.locator('[data-level="' + artLevel + '"]').click();
    await page.locator('#reset-view').click();
    await page.screenshot({ path: output + '/' + spaceId + '-art.png', fullPage: true });
    result.returnToSpawn = await move(
      routePath,
      () => page.locator('#return-entry').click(),
      spawn,
    );
    const final = await get('/api/spaces/' + spaceId + '/scene');
    assert.equal(
      digest(final.scene),
      initial.geometryHash,
      'movement must not mutate scene geometry',
    );
    const finalGlb = await context.request.get(config.origin + initial.modelUrl);
    assert.equal(
      createHash('sha256')
        .update(await finalGlb.body())
        .digest('hex'),
      meshHash,
    );
    result.geometryUnchanged = true;
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await ready();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: output + '/mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(
    output + '/browser.json',
    JSON.stringify(
      {
        status: 'PASS',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - started),
        origin: config.origin,
        spaces,
        movementRequests: requests.length,
        errors,
        checks: [
          'all public rooms reached',
          'actual cross-floor route',
          'refresh retains authoritative position',
          'return to original spawn',
          'GLB and scene geometry hashes agree and remain unchanged',
          'current art and 390px layout captured',
        ],
        scope:
          'Fresh owned Chrome, two original synthetic spaces and restored isolated Ubuntu clone. Actual automatic duration only; not a human 20-minute session, private Plan14 test, physical multi-device or production-school acceptance.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS two-space navigation, geometry preservation and responsive art views');
} catch (e) {
  await writeFile(
    output + '/browser.json',
    JSON.stringify(
      {
        status: 'FAIL',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - started),
        spaces,
        errors,
        error: e.message,
      },
      null,
      2,
    ) + '\n',
  );
  await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {});
  throw e;
} finally {
  await browser.close();
}
