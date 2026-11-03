import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';
import { loadPackages, startServer } from '../src/server.mjs';
import { createNavigation, roomPoint } from '../src/spatial/building.mjs';
import { digest } from '../src/protocol/index.mjs';
const root = resolve('.'),
  out = join(root, 'qa/campus/visual');
await mkdir(out, { recursive: true });
const temp = await mkdtemp(join(root, '.local/visual-compare-'));
const packs = await loadPackages(['examples/north/space.json', 'examples/south/space.json']);
const browser = await chromium.launch({
  executablePath: process.env.HD_QA_CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const checks = [],
  coverage = [];
try {
  for (const pack of packs) {
    const baseline = structuredClone(pack);
    baseline.assets = [];
    baseline.exhibits = [];
    for (const scene of baseline.scenes) scene.artwork = [];
    for (const scene of pack.scenes) {
      const prior = baseline.scenes.find((s) => s.sceneId === scene.sceneId);
      const before = createNavigation(prior),
        after = createNavigation(scene);
      const from = { levelId: pack.spawn.levelId, point: pack.spawn.point };
      for (const level of scene.levels)
        for (const room of level.rooms.filter((r) => r.access === 'public')) {
          const [x, z] = roomPoint(room),
            to = { levelId: level.id, point: [x, level.elevation, z] };
          assert.deepEqual(
            before.route(from, to).path,
            after.route(from, to).path,
            'artwork must not obstruct original doors or routes',
          );
          coverage.push({
            spaceId: pack.spaceId,
            entityId: room.entityId,
            region: room.name,
            model: 'original reusable display furniture, shared materials and room label',
            publishedArtwork: (scene.artwork || [])
              .filter((a) => a.entityId === room.entityId)
              .map((a) => a.assetId),
          });
        }
      coverage.push({
        spaceId: pack.spaceId,
        region: 'entrance and reception',
        model: 'arrival terrace, reception desk, navigation and explicit reception identity',
      });
    }
    for (const [label, p] of [
      ['before', baseline],
      ['after', pack],
    ]) {
      const server = await startServer({
        root,
        packs: [p],
        dataDir: join(temp, pack.spaceId + '-' + label),
        port: 0,
        provider: null,
      });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      try {
        await page.goto(server.origin + '/?space=' + pack.spaceId);
        await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
        assert.equal(await page.evaluate(() => baseQA.geometryHash), digest(p.scenes[0]));
        await page.screenshot({ path: join(out, pack.spaceId + '-' + label + '.png') });
        if (label === 'after') {
          await page
            .locator('#rooms [data-entity="' + p.scenes[0].artwork[0].entityId + '"]')
            .click();
          await page.screenshot({ path: join(out, pack.spaceId + '-exhibit.png') });
        }
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
        await server.close();
      }
    }
    checks.push({
      name:
        pack.spaceId +
        ' controlled before/after original artwork comparison and unchanged complete public routes',
      status: 'PASS',
    });
  }
  await writeFile(
    join(out, 'comparison.json'),
    JSON.stringify(
      {
        status: 'PASS',
        checks,
        coverage,
        scope:
          'fresh local Base-1 runtimes and original synthetic examples; before is a newly generated no-artwork baseline, not a claimed historical screenshot or final school art approval',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS two example visual comparisons and six room routes');
} finally {
  await browser.close();
}
