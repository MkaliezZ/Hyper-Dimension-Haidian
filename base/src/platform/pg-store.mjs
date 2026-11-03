import { readFile } from 'node:fs/promises';
import { digest, clone, fail } from '../protocol/index.mjs';
export async function openPgStore(db, directory) {
  const lock = await db.pool.connect();
  if (
    !(await lock.query("SELECT pg_try_advisory_lock(hashtextextended('hd-runtime-owner',0)) AS ok"))
      .rows[0].ok
  ) {
    lock.release();
    throw Error('Runtime already owned; no lock was stolen');
  }
  let state,
    queue = Promise.resolve(),
    closed = false;
  try {
    const {
      rows: [old],
    } = await db.pool.query('SELECT state FROM hd_runtime_state WHERE singleton');
    if (old) state = old.state;
    else {
      try {
        await readFile(directory + '/state.json');
        throw Error('Legacy JSON found: use the explicit backed-up import tool first');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      state = { schema: 1, revision: 0, tasks: {}, receipts: {}, positions: {}, messages: [] };
      await db.pool.query('INSERT INTO hd_runtime_state VALUES(true,$1)', [state]);
    }
  } catch (e) {
    await lock.query("SELECT pg_advisory_unlock(hashtextextended('hd-runtime-owner',0))");
    lock.release();
    throw e;
  }
  const combined = (fn) => {
    const job = queue.then(async () => {
      if (closed) fail('store_closed', 'Store closed', 503);
      const next = clone(state);
      const result = await db.tx(async (c) => {
        const result = await fn(next, c);
        next.revision++;
        await c.query('UPDATE hd_runtime_state SET state=$1 WHERE singleton', [next]);
        return result;
      });
      state = next;
      return clone(result);
    });
    queue = job.catch(() => {});
    return job;
  };
  return {
    directory,
    read: () => clone(state),
    transact: (fn) => combined((d) => fn(d)),
    combined,
    command(principal, spaceId, requestId, input, fn) {
      return combined(async (d) => {
        const key = digest([principal.id, spaceId, requestId]),
          hash = digest(input);
        const old = (principal.ownershipIds || [principal.id])
          .map((id) => d.receipts[digest([id, spaceId, requestId])])
          .find(Boolean);
        if (old) {
          if (old.hash !== hash) fail('request_conflict', 'requestId content changed', 409);
          return { ...old.result, replayed: true };
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
      await lock.query("SELECT pg_advisory_unlock(hashtextextended('hd-runtime-owner',0))");
      lock.release();
    },
  };
}
