import { fail } from '../protocol/index.mjs';
// Bound short-lived model subprocesses; queued work holds no model or DB connection.
export function limitEmbedding(
  fn,
  { concurrency = 1, maxQueued = 16, errorPrefix = 'embedding' } = {},
) {
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 4 ||
    !Number.isSafeInteger(maxQueued) ||
    maxQueued < 0 ||
    maxQueued > 100
  )
    fail(errorPrefix + '_config', 'Invalid model concurrency/queue bounds');
  let active = 0;
  const queue = [];
  return async function (...args) {
    const signal = args[1]?.signal;
    if (signal?.aborted) throw signal.reason;
    if (active >= concurrency) {
      if (queue.length >= maxQueued)
        fail(errorPrefix + '_busy', 'Model capacity reached; retry later', 429);
      await new Promise((resolve, reject) => {
        const entry = {
          resolve: () => {
            signal?.removeEventListener('abort', abort);
            resolve();
          },
        };
        const abort = () => {
          const index = queue.indexOf(entry);
          if (index >= 0) queue.splice(index, 1);
          reject(signal.reason);
        };
        signal?.addEventListener('abort', abort, { once: true });
        queue.push(entry);
        if (signal?.aborted) abort();
      });
    } else active++;
    try {
      if (signal?.aborted) throw signal.reason;
      return await fn(...args);
    } finally {
      const next = queue.shift();
      if (next) next.resolve();
      else active--;
    }
  };
}
