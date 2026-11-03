import { mkdir, readFile, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJSON } from './atomic-json.mjs';
import { clone, fail, digest } from '../protocol/index.mjs';
// Single writer per data directory; never steal a live or ambiguous lock.
export async function openStore(directory) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, 'state.json'),
    lock = join(root, 'base.lock'),
    token = randomUUID();
  let handle;
  try {
    handle = await open(lock, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
    await handle.close();
  } catch (error) {
    if (error.code === 'EEXIST')
      fail(
        'data_in_use',
        'Data directory is already locked. Preserve it; close its owner or inspect the stale lock.',
        409,
      );
    throw error;
  }
  let state,
    queue = Promise.resolve(),
    closed = false;
  try {
    state = JSON.parse(await readFile(path, 'utf8'));
    if (state.schema !== 1 || !state.tasks || !state.receipts || !state.positions)
      fail('data_invalid', 'Unsupported or corrupt data; original preserved', 503);
  } catch (e) {
    if (e.code === 'ENOENT')
      state = { schema: 1, revision: 0, tasks: {}, receipts: {}, positions: {}, messages: [] };
    else {
      await unlink(lock);
      throw e;
    }
  }
  const transact = (fn) => {
    const job = queue.then(async () => {
      if (closed) fail('store_closed', 'Store closed', 503);
      const next = clone(state),
        result = await fn(next);
      next.revision++;
      await atomicJSON(path, next);
      state = next;
      return clone(result);
    });
    queue = job.catch(() => {});
    return job;
  };
  return {
    directory: root,
    read: () => clone(state),
    transact,
    async command(principal, spaceId, requestId, input, fn) {
      const key = digest([principal.id, spaceId, requestId]),
        hash = digest(input);
      return transact(async (d) => {
        const prior = d.receipts[key];
        if (prior) {
          if (prior.hash !== hash)
            fail('request_conflict', 'The same requestId cannot change content', 409);
          return { ...prior.result, replayed: true };
        }
        const result = await fn(d);
        d.receipts[key] = { hash, result: clone(result) };
        return result;
      });
    },
    async close() {
      await queue;
      if (closed) return;
      closed = true;
      const owner = JSON.parse(await readFile(lock, 'utf8'));
      if (owner.token === token && owner.pid === process.pid) await unlink(lock);
    },
  };
}
