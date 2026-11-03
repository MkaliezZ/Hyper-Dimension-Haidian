import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { receptionEnvironment } from '../deploy/reception-env.mjs';

test('Container Hermes secret stays out of configuration; existing settings are preserved and conflicts fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hd-container-reception-'));
  try {
    const install = join(root, 'hermes'),
      configRoot = join(root, 'private'),
      keyFile = join(root, 'key');
    await mkdir(join(install, '.venv/bin'), { recursive: true });
    await mkdir(configRoot);
    await writeFile(join(install, '.venv/bin/python'), 'fixture');
    await writeFile(join(install, 'run_agent.py'), 'fixture');
    await writeFile(keyFile, 'SYNTHETIC_MODEL_SECRET\n');
    const env = { HD_RECEPTION_PROVIDER: 'hermes', HD_RECEPTION_MODEL_KEY_FILE: keyFile };
    const configured = await receptionEnvironment({ env, configRoot, installation: install });
    assert.equal(configured.DEEPSEEK_API_KEY, 'SYNTHETIC_MODEL_SECRET');
    const saved = await readFile(configured.HDBASE_RECEPTION_CONFIG, 'utf8');
    assert(!saved.includes('SYNTHETIC_MODEL_SECRET'));
    await receptionEnvironment({ env, configRoot, installation: install });
    assert.equal(await readFile(configured.HDBASE_RECEPTION_CONFIG, 'utf8'), saved);
    await writeFile(configured.HDBASE_RECEPTION_CONFIG, '{"provider":"custom"}');
    await assert.rejects(
      receptionEnvironment({ env, configRoot, installation: install }),
      /preserved/,
    );
    assert.equal(
      await readFile(configured.HDBASE_RECEPTION_CONFIG, 'utf8'),
      '{"provider":"custom"}',
    );
    await assert.rejects(
      receptionEnvironment({ env: { HD_RECEPTION_PROVIDER: 'invalid' }, configRoot }),
      /Unsupported/,
    );
    await assert.rejects(
      receptionEnvironment({ env: { HD_RECEPTION_PROVIDER: 'hermes' }, configRoot }),
      /private/,
    );
    await writeFile(keyFile, 'one\ntwo');
    await assert.rejects(
      receptionEnvironment({ env, configRoot, installation: install }),
      /Invalid/,
    );
    const offline = {};
    assert.equal(await receptionEnvironment({ env: offline, configRoot }), offline);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
