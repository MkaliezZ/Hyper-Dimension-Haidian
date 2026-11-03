import { open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
// Allow brief Windows file-sharing holds to clear; persistent denial still stops after 2.5s.
const RETRY_DELAYS = [20, 40, 80, 120, 180, 240, 320, 400, 500, 600];
const TRANSIENT_WINDOWS_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);
// Only completed locks whose cleanup failed are remembered. Active owners never
// enter this map, and every retry rereads both the process and random lock token.
const deferredReleases = new Map();
const clearDeferred = (path, token) => {
  if (deferredReleases.get(String(path)) === token) deferredReleases.delete(String(path));
};
export async function releaseOwnedLock(
  path,
  token,
  { platform = process.platform, remove = unlink, wait = delay } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      const owner = JSON.parse(await readFile(path, 'utf8'));
      if (owner?.pid !== process.pid || owner.token !== token) {
        clearDeferred(path, token);
        return false;
      }
      await remove(path);
      clearDeferred(path, token);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        clearDeferred(path, token);
        return false;
      }
      if (
        platform !== 'win32' ||
        !TRANSIENT_WINDOWS_ERRORS.has(error.code) ||
        attempt >= RETRY_DELAYS.length
      ) {
        deferredReleases.set(String(path), token);
        throw error;
      }
      await wait(RETRY_DELAYS[attempt]);
    }
  }
}
// Keep the original destination and the already-synced temporary file intact between attempts.
// Never delete the destination to work around an occupied file or persistent permission failure.
export async function replaceAtomicFile(
  temporary,
  destination,
  { platform = process.platform, replace = rename, wait = delay } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await replace(temporary, destination);
    } catch (error) {
      if (
        platform !== 'win32' ||
        !TRANSIENT_WINDOWS_ERRORS.has(error.code) ||
        attempt >= RETRY_DELAYS.length
      )
        throw error;
      await wait(RETRY_DELAYS[attempt]);
    }
  }
}
// Retry a known completed release before acquiring. Active owners and EEXIST
// still follow the caller's lock protocol; creation never bypasses ownership.
export async function openExclusiveFile(
  path,
  { platform = process.platform, create = open, wait = delay } = {},
) {
  const pending = deferredReleases.get(String(path));
  if (pending) await releaseOwnedLock(path, pending, { platform, wait });
  for (let attempt = 0; ; attempt++) {
    try {
      return await create(path, 'wx', 0o600);
    } catch (error) {
      if (
        platform !== 'win32' ||
        !TRANSIENT_WINDOWS_ERRORS.has(error.code) ||
        attempt >= RETRY_DELAYS.length
      )
        throw error;
      await wait(RETRY_DELAYS[attempt]);
    }
  }
}
export async function atomicJSON(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(JSON.stringify(value));
    await file.sync();
    await file.close();
    file = null;
    await replaceAtomicFile(temporary, path);
  } finally {
    await file?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}
