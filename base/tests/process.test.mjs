import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { BaseClient } from '../src/sdk/client.mjs';
async function launch(env) {
  const child = fork(new URL('./serve-child.mjs', import.meta.url), [], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let log = '';
  child.stderr.on('data', (d) => (log += d));
  const ready = await Promise.race([
    once(child, 'message').then(([value]) => value),
    once(child, 'exit').then(() => {
      throw Error('Child exited: ' + log);
    }),
  ]);
  return { child, ...ready };
}
async function close(peer) {
  if (!peer || peer.child.exitCode !== null || peer.child.signalCode) return;
  peer.child.send('close');
  await once(peer.child, 'exit');
}
test('Two independent Base processes exchange A2A; acknowledged effect survives process death and lost response replay', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hd-base-process-'));
  let a, b;
  try {
    b = await launch({ TEST_SPACE: 'south', TEST_DATA: join(dir, 'south') });
    a = await launch({
      TEST_SPACE: 'north',
      TEST_DATA: join(dir, 'north'),
      TEST_PEER: b.origin,
      TEST_PEER_TOKEN: b.token,
    });
    assert.notEqual(a.pid, b.pid);
    const client = new BaseClient({ url: a.origin, token: a.token }),
      result = await client.send('north-reception', '项目展览在哪里', {
        skillId: 'campus.ask-peer',
      });
    assert.equal(result.task.status.state, 'TASK_STATE_COMPLETED');
    const body = JSON.parse(result.task.artifacts[0].parts[0].text);
    assert.equal(body.mode, 'peer-a2a');
    assert.equal(body.peer.origin, b.origin);
    assert.equal(body.peer.agentId, 'south-reception');
    assert(body.sources.some((s) => s.id === 'gallery'));
    const foreign = new BaseClient({
        url: b.origin,
        token: b.token,
        fetchImpl: async (...args) => {
          const response = await fetch(...args);
          await response.body.cancel();
          throw Error('Injected loss after durable response headers');
        },
      }),
      messageId = 'durable-after-crash';
    await assert.rejects(
      foreign.send('south-reception', '进程重启不得重复的留言', {
        messageId,
        skillId: 'message.leave',
      }),
      /Injected loss/,
    );
    const oldToken = b.token;
    b.child.kill('SIGKILL');
    await once(b.child, 'exit');
    const recover = spawnSync(
      process.execPath,
      ['tools/base.mjs', 'recover-lock', '--data', join(dir, 'south')],
      { encoding: 'utf8' },
    );
    assert.equal(recover.status, 0, recover.stderr);
    b = await launch({ TEST_SPACE: 'south', TEST_DATA: join(dir, 'south') });
    const replay = new BaseClient({ url: b.origin, token: oldToken });
    await replay.send('south-reception', '进程重启不得重复的留言', {
      messageId,
      skillId: 'message.leave',
    });
    const state = JSON.parse(await readFile(join(dir, 'south', 'state.json'), 'utf8'));
    assert.equal(state.messages.length, 1);
  } finally {
    await close(a);
    await close(b);
    await rm(dir, { recursive: true, force: true });
  }
});
