import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer, loadPackages } from '../src/server.mjs';
import { exampleScene, packageFor } from '../tools/fixtures.mjs';
import { validatePackage } from '../src/protocol/index.mjs';
test('Published media and artwork load from a package; private exhibits and traversal stay blocked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hd-base-assets-'));
  let server;
  try {
    const root = process.cwd(),
      packs = await loadPackages([join(root, 'examples/north/space.json')]);
    packs[0].exhibits.push({
      id: 'internal',
      entityId: 'north-hall-gallery',
      title: '内部',
      body: 'DO_NOT_PUBLISH_THIS_EXHIBIT',
      assetIds: [],
      published: false,
    });
    server = await startServer({ root, packs, dataDir: dir, port: 0, provider: null });
    const scene = await fetch(server.origin + '/api/spaces/north/scene').then((r) => r.json());
    assert.equal(scene.exhibits.length, 1);
    assert(!JSON.stringify(scene).includes('DO_NOT_PUBLISH'));
    assert.equal(
      (await fetch(server.origin + scene.assets[0].url)).headers.get('content-type'),
      'image/png',
    );
    assert.equal(
      (await fetch(server.origin + '/api/spaces/north/assets/not-in-manifest')).status,
      404,
    );
    const invalid = structuredClone(packs[0]);
    invalid.assets[0].file = '../private.png';
    assert.throws(() => validatePackage(invalid));
    const csrf = await fetch(server.origin + '/api/spaces/north/reception', {
      method: 'POST',
      headers: { Origin: 'https://untrusted.invalid' },
      body: '{}',
    });
    assert.equal(csrf.status, 403);
    const inbox = await fetch(server.origin + '/api/spaces/north/messages');
    assert.equal(inbox.status, 403);
    const badPoint = await fetch(server.origin + '/api/spaces/north/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'bad-point',
        sceneId: 'north-hall',
        levelId: 'L2',
        point: [10, 3.6, 11],
      }),
    });
    assert.equal(badPoint.status, 400);
  } finally {
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
