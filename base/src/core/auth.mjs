import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { fail } from '../protocol/index.mjs';
const secureEqual = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function loadAccess(directory, spaceIds) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'access.json');
  let access;
  try {
    access = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    access = {
      schema: 1,
      cookieSecret: randomBytes(32).toString('base64url'),
      tokens: [
        {
          token: randomBytes(32).toString('base64url'),
          principal: {
            id: 'maintainer',
            spaces: spaceIds,
            scopes: ['public:read', 'a2a:call', 'messages:read'],
          },
        },
      ],
    };
    await writeFile(path, JSON.stringify(access, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  if (
    access.schema !== 1 ||
    typeof access.cookieSecret !== 'string' ||
    access.cookieSecret.length < 32 ||
    !Array.isArray(access.tokens)
  )
    fail('access_invalid', 'Invalid private access configuration', 503);
  const sign = (id) => createHmac('sha256', access.cookieSecret).update(id).digest('base64url');
  return {
    path,
    access,
    principal(req, res, { browser = false } = {}) {
      const authorization = req.headers.authorization;
      if (authorization !== undefined) {
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        const row = access.tokens.find((t) => secureEqual(t.token, token));
        if (!row) fail('unauthorized', 'Invalid access token', 401);
        return structuredClone(row.principal);
      }
      if (!browser) fail('unauthorized', 'Bearer access token required', 401);
      const cookie = (req.headers.cookie || '')
        .split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith('hd_base='))
        ?.slice(8);
      let id;
      if (cookie) {
        const split = cookie.lastIndexOf('.'),
          value = cookie.slice(0, split),
          signature = cookie.slice(split + 1);
        if (/^visitor-[a-f0-9]{32}$/.test(value) && secureEqual(signature, sign(value))) id = value;
      }
      if (!id) {
        id = 'visitor-' + randomBytes(16).toString('hex');
        res.setHeader(
          'Set-Cookie',
          'hd_base=' + id + '.' + sign(id) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000',
        );
      }
      return { id, spaces: spaceIds, scopes: ['public:read', 'a2a:call'] };
    },
  };
}
