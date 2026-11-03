import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectComplete, zipFiles } from '../tools/pack.mjs';

const root = resolve(import.meta.dirname, '..');
test('Campus manifest includes executable modules, admin sources/notices and production dependencies, excluding private state', async () => {
  const { files, manifest } = await collectComplete(root, { campus: true });
  const entries = new Map(files);
  for (const name of [
    'CAMPUS-START.md',
    'AGENT-START.md',
    'DEVELOPMENT-MANUAL.md',
    'docs/DOCUMENTATION-MAP.json',
    'tools/verify-docs.mjs',
    'evidence/documentation/ACCEPTANCE.md',
    'docs/DEPLOYMENT.md',
    'tools/campus-init.mjs',
    'src/platform/community.mjs',
    'src/platform/network.mjs',
    'src/reception/sessions.mjs',
    'database/campus-network-001.sql',
    'public/network.html',
    'public/reception-admin.html',
    'docs/RECEPTION-AND-NETWORK.md',
    'tests/hermes-sessions-live.mjs',
    'deploy/Dockerfile.hermes',
    'deploy/compose.hermes.yaml',
    'deploy/reception-env.mjs',
    'integrations/hermes/SOURCE.json',
    'integrations/hermes/source.tar.gz',
    'evidence/hermes-sessions/ACCEPTANCE.md',
    'src/platform/operations.mjs',
    'src/platform/rewards.mjs',
    'admin/index.jsx',
    'admin/build.mjs',
    'admin/package-lock.json',
    'admin/THIRD-PARTY-LICENSES.json',
    'public/admin/app.js',
    'public/admin/app.js.LEGAL.txt',
    'node_modules/pg-boss/package.json',
    'node_modules/@a2a-js/sdk/package.json',
    'tools/partner-agent-client.mjs',
    'src/platform/business-a2a.mjs',
    'src/platform/indexing.mjs',
    'src/platform/annual.mjs',
    'src/platform/annual-contract.mjs',
    'public/annual.html',
    'docs/ANNUAL-OPERATIONS.md',
    'tools/prepare-annual-materials.py',
    'tools/verify-annual-materials.py',
    'docs/ANNUAL-MATERIALS-AUDIT.md',
    'evidence/annual-materials/ACCEPTANCE.md',
    'tools/annual-validate.mjs',
    'database/campus-annual-001.sql',
    'examples/operations/annual-starter-v1.json',
    'deploy/compose.yaml',
    'deploy/Dockerfile',
    'database/m3-operations-001.sql',
    'assets/avatars/catalog.json',
    'assets/avatars/v2/catalog.json',
    'assets/avatars/v3/catalog.json',
    'models/bge-small-zh-v1.5/MODEL-MANIFEST.json',
  ])
    assert(entries.has(name), 'Missing required campus file: ' + name);
  for (const name of entries.keys()) {
    assert(
      !/^(?:\.private-inputs|projects|\.local|qa|dist|\.git|admin\/node_modules)\//.test(name),
      name,
    );
    assert(!/^node_modules\/(?:playwright-core|prettier)\//.test(name), name);
    assert(!name.endsWith('.pdf'), 'Public universal package must not include input PDFs: ' + name);
  }
  assert.equal(manifest.campus.productionReady, false);
  assert.equal(manifest.extension.entrypoint, 'CAMPUS-START.md');
  assert.equal(
    manifest.extension.status,
    manifest.campus.requiredMissing.length ? 'candidate' : 'technical-accepted',
  );
  assert.equal(manifest.extension.version, '0.8.3');
  assert.equal(manifest.campus.developmentManual, 'DEVELOPMENT-MANUAL.md');
  assert.equal(manifest.campus.runtimeBaselineVersion, '0.8.2');
  assert(
    ![...entries.keys()].some(
      (p) => /^integrations\/(download-cache|hermes-cache)\//.test(p) && !p.endsWith('/README.md'),
    ),
  );
  const licenses = JSON.parse(entries.get('admin/THIRD-PARTY-LICENSES.json'));
  assert(
    licenses.dependencies.find(
      (x) => x.name === 'react-admin' && x.version === '5.15.5' && x.license === 'MIT',
    ),
  );
  assert(licenses.dependencies.every((x) => x.license && x.integrity && x.texts.length));
  assert.equal(JSON.parse(entries.get('node_modules/pg-boss/package.json')).version, '12.38.0');
});

test('New-campus initializer and archive writer preserve existing configuration and sealed files', async () => {
  const parent = resolve(root, '.local');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'campus-package-guard-'));
  assert(resolve(directory).startsWith(parent + sep));
  try {
    await mkdir(join(directory, 'private'));
    const config = join(directory, 'private/config.json');
    const original = '{"preserve":"test-only-original"}\n';
    await writeFile(config, original);
    const child = spawnSync(
      process.execPath,
      ['tools/campus-init.mjs', '--runtime', directory, '--namespace', 'test_guard'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Existing runtime config must be preserved/);
    assert.equal(await readFile(config, 'utf8'), original);
    const sealed = join(directory, 'retained.zip');
    await writeFile(sealed, 'retained-test-marker');
    await assert.rejects(zipFiles([['test.txt', Buffer.from('fixture')]], sealed), {
      code: 'EEXIST',
    });
    assert.equal(await readFile(sealed, 'utf8'), 'retained-test-marker');
  } finally {
    // Only this freshly allocated test directory is removed; never a caller-provided path.
    assert(resolve(directory).startsWith(parent + sep));
    await rm(directory, { recursive: true });
  }
});
