import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localHermesProvider } from '../src/reception/hermes.mjs';

test('Hermes transport isolates environment, handles UTF-8 and fails closed on tools, crash, timeout and cancel', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hd-base-hermes-'));
  const saved = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'fixture-not-a-real-key';
  await writeFile(join(dir, 'run_agent.py'), '# adapter test fixture; not executed');
  let scenario = 'success',
    killed = 0,
    lastOptions,
    sent;
  const fixtureSpawn = (python, args, options) => {
    assert.equal(python, process.execPath);
    assert(args[0].endsWith('hermes_bridge.py'));
    lastOptions = options;
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      killed++;
      queueMicrotask(() => child.emit('close', 1));
    };
    let input = '';
    child.stdin.on('data', (data) => (input += data));
    child.stdin.on('finish', () => {
      sent = JSON.parse(input);
      queueMicrotask(() => {
        if (scenario === 'hang') return;
        child.stderr.write('PRIVATE_DIAGNOSTIC_MUST_NOT_ESCAPE');
        if (scenario === 'crash') {
          child.emit('close', 1);
          return;
        }
        const data = Buffer.from(
          JSON.stringify({
            answer: '你好',
            kind: 'general',
            sourceIds: [],
            transport: 'local-hermes',
            toolCount: scenario === 'tools' ? 1 : 0,
          }),
        );
        // Deliberately split a Chinese UTF-8 codepoint across pipe chunks.
        const cut = data.indexOf(Buffer.from('你')) + 1;
        child.stdout.write(data.subarray(0, cut));
        child.stdout.write(data.subarray(cut));
        child.emit('close', 0);
      });
    });
    return child;
  };
  try {
    const provider = await localHermesProvider({
      python: process.execPath,
      hermesRoot: dir,
      dataDir: dir,
      timeoutMs: 1000,
      spawnImpl: fixtureSpawn,
    });
    const input = { message: '你好', facts: [], space: { id: 'north', name: '示例' }, history: [] };
    assert.equal((await provider(input)).answer, '你好');
    assert.equal(lastOptions.shell, false);
    assert.equal(lastOptions.windowsHide, true);
    assert.equal(lastOptions.env.HERMES_HOME, join(dir, 'hermes-reception'));
    assert.equal(lastOptions.env.HOME, undefined);
    assert.equal(lastOptions.env.USERPROFILE, undefined);
    assert.deepEqual(sent.publishedFacts, []);
    scenario = 'tools';
    await assert.rejects(provider(input), /zero tools/);
    scenario = 'crash';
    await assert.rejects(
      provider(input),
      (e) =>
        e.message === 'Local Hermes request failed' && !e.message.includes('PRIVATE_DIAGNOSTIC'),
    );
    scenario = 'hang';
    await assert.rejects(provider(input), /timed out/);
    const controller = new AbortController();
    const pending = provider({ ...input, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, /canceled/);
    const before = killed;
    await assert.rejects(provider({ ...input, signal: controller.signal }));
    assert.equal(killed, before);
    assert(killed >= 3);
  } finally {
    if (saved === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = saved;
    await rm(dir, { recursive: true, force: true });
  }
});
