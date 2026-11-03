import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { join, resolve, extname, sep, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from './core/store.mjs';
import { loadAccess } from './core/auth.mjs';
import { createReception, deepseekProvider } from './reception/index.mjs';
import { configuredHermes } from './reception/hermes.mjs';
import { openKnowledge } from './knowledge/index.mjs';
import { createGateway } from './a2a/gateway.mjs';
import { createNavigation, positionAt, roomPoint } from './spatial/building.mjs';
import { makeGlb } from './spatial/model.mjs';
import {
  BASE_VERSION,
  PROTOCOL,
  EXTENSION,
  validatePackage,
  authorize,
  identifier,
  fields,
  digest,
  fail,
} from './protocol/index.mjs';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
};
export async function loadPackages(paths) {
  const packs = [];
  for (const path of paths) {
    const pack = validatePackage(JSON.parse(await readFile(path, 'utf8')));
    Object.defineProperty(pack, 'packageRoot', {
      value: dirname(resolve(path)),
      enumerable: false,
    });
    packs.push(pack);
  }
  if (new Set(packs.map((p) => p.spaceId)).size !== packs.length)
    fail('duplicate_id', 'Duplicate deployment spaceId');
  return packs;
}
export async function startServer({
  root = process.cwd(),
  packs,
  dataDir = join(root, '.local'),
  host = '127.0.0.1',
  port = 4180,
  allowLan = false,
  publicOrigin,
  provider,
  capabilities = {},
  maxModelCallsPerDay = 100,
  platform,
} = {}) {
  if (allowLan && !['127.0.0.1', 'localhost', '::1'].includes(host) && !publicOrigin)
    fail('origin_required', 'LAN hosting needs an explicit --origin http(s)://reachable-host:port');
  if (publicOrigin) {
    const parsed = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== publicOrigin)
      fail(
        'origin_invalid',
        'Public origin must be an exact HTTP(S) origin without path or credentials',
      );
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !allowLan)
    fail('lan_opt_in', 'Non-loopback hosting needs allowLan');
  packs.forEach(validatePackage);
  const maps = new Map(),
    models = new Map(),
    assets = new Map(),
    packMap = new Map(packs.map((p) => [p.spaceId, p]));
  for (const pack of packs) {
    for (const a of pack.assets || []) {
      if (!a.published) continue;
      if (!pack.packageRoot) fail('asset_root', 'Asset packages must be loaded from disk');
      const assetRoot = await realpath(join(pack.packageRoot, 'assets')),
        file = await realpath(join(pack.packageRoot, a.file));
      if (!file.startsWith(assetRoot + sep))
        fail('asset_path', 'Asset symlink escaped the package assets directory');
      const info = await stat(file);
      if (!info.isFile() || info.size > 25 * 1024 * 1024)
        fail('asset_size', 'Asset must be a file no larger than 25MB');
      const buffer = await readFile(file),
        ext = extname(file),
        valid =
          ext === '.glb'
            ? buffer.readUInt32LE(0) === 0x46546c67
            : ext === '.png'
              ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : ext === '.jpg'
                ? buffer[0] === 255 && buffer[1] === 216
                : ext === '.webp'
                  ? buffer.subarray(0, 4).toString() === 'RIFF' &&
                    buffer.subarray(8, 12).toString() === 'WEBP'
                  : false;
      if (!valid) fail('asset_format', 'Asset signature did not match its type');
      assets.set(pack.spaceId + ':' + a.id, {
        buffer,
        type: {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.webp': 'image/webp',
          '.glb': MIME['.glb'],
        }[ext],
      });
    }
    for (const s of pack.scenes)
      for (const a of s.artwork || [])
        if (!assets.has(pack.spaceId + ':' + a.assetId))
          fail('asset_missing', 'Scene artwork must use a published asset');
  }
  for (const pack of packs)
    for (const s of pack.scenes) {
      const id = pack.spaceId + ':' + s.sceneId;
      maps.set(id, createNavigation(s));
      models.set(id, makeGlb(s));
      if (
        pack.spawn.sceneId === s.sceneId &&
        !maps.get(id).isWalkable({ levelId: pack.spawn.levelId, point: pack.spawn.point })
      )
        fail('invalid_spawn', 'Spawn must be walkable');
    }
  const auth = await loadAccess(
      dataDir,
      packs.map((p) => p.spaceId),
    ),
    store = platform?.openStore ? await platform.openStore(dataDir) : await openStore(dataDir);
  let knowledge, reception;
  try {
    knowledge = await openKnowledge({
      dataDir,
      root,
      forumHistory: platform?.extensions?.includes('campus'),
    });
    platform?.bindKnowledge?.(knowledge);
    reception = createReception({
      knowledge,
      sourceResolver: platform?.publishedSources,
      provider:
        provider === undefined
          ? (await configuredHermes(dataDir)) ||
            (process.env.DEEPSEEK_API_KEY
              ? deepseekProvider({ apiKey: process.env.DEEPSEEK_API_KEY })
              : null)
          : provider,
    });
  } catch (error) {
    await knowledge?.close();
    await store.close();
    throw error;
  }
  const navigation = (pack, from, to) => {
    fields(from, ['sceneId', 'levelId', 'point'], 'from');
    fields(to, ['sceneId', 'levelId', 'point'], 'to');
    if (from.sceneId !== to.sceneId) fail('scene_mismatch', 'Explicit scene transition required');
    const nav = maps.get(pack.spaceId + ':' + from.sceneId);
    if (!nav) fail('scene_missing', 'Scene not found', 404);
    return nav.route(from, to);
  };
  const gateway = createGateway({
    store,
    packs,
    reception,
    navigate: navigation,
    capabilities,
    maxModelCallsPerDay,
  });
  await gateway.recoverInterrupted();
  const rates = new Map();
  let origin = '';
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const body = async (req) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      const upload = /^\/attachments\/schools\/[a-zA-Z0-9._:-]+(?:\?|$)/.test(req.url);
      const documents = /^\/knowledge-admin\/schools\/[a-zA-Z0-9._:-]+\/documents(?:\?|$)/.test(
        req.url,
      );
      const annualImport =
        /^\/annual\/schools\/[a-zA-Z0-9._:-]+(?:\/organizations\/[a-zA-Z0-9._:-]+)?\/(?:preview|import)(?:\?|$)/.test(
          req.url,
        );
      if (size > (upload ? 720896 : documents || annualImport ? 4194304 : 65536))
        fail('body_limit', 'Request body exceeds route limit', 413);
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      fail('invalid_json', 'Invalid JSON');
    }
  };
  const packFor = (id) => {
    const pack = packMap.get(id);
    if (!pack) fail('space_missing', 'Space not found', 404);
    return pack;
  };
  const position = (d, principal, pack) => {
    const move = (principal.ownershipIds || [principal.id])
      .map((id) => d.positions[digest([id, pack.spaceId])])
      .find(Boolean);
    return move
      ? { sceneId: move.sceneId, ...positionAt(move) }
      : {
          sceneId: pack.spawn.sceneId,
          levelId: pack.spawn.levelId,
          point: pack.spawn.point,
          moving: false,
        };
  };
  platform?.bindWorld?.({ packFor, position, maps, receptionSessions: gateway.receptionSessions });
  // Restores may contain old conversations: enforce retention before accepting any request.
  await gateway.receptionSessions.expire();
  let receptionCleanupError = null;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
    );
    try {
      const url = new URL(req.url, 'http://placeholder'),
        parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent),
        method = req.method;
      if (
        !allowLan &&
        !['127.0.0.1', 'localhost', '::1'].includes(
          new URL('http://' + req.headers.host).hostname.replace(/^\[|\]$/g, ''),
        )
      )
        fail('host_denied', 'Unexpected Host', 403);
      if (
        method !== 'GET' &&
        method !== 'HEAD' &&
        req.headers.origin &&
        req.headers.origin !== origin
      )
        fail('origin_denied', 'Cross-origin mutation denied', 403);
      if (platform && (await platform.handle(req, res, { url, json, body }))) return;
      if (method === 'GET' && url.pathname === '/health')
        return json(res, 200, {
          ok: true,
          version: BASE_VERSION,
          protocol: PROTOCOL,
          reception: reception.live ? 'live-model' : 'knowledge-only',
          receptionProvider: reception.provider,
          generalConversation: reception.general,
          receptionMaintenance: { ok: !receptionCleanupError, errorCode: receptionCleanupError },
          knowledge: knowledge ? knowledge.mode + '-pgvector' : 'published-keyword',
        });
      if (method === 'GET' && url.pathname === '/api/catalog') {
        const principal = await (platform
          ? platform.identity.principal(req)
          : auth.principal(req, res, { browser: true }));
        return json(res, 200, {
          version: BASE_VERSION,
          platform: platform ? 'm0' : null,
          extensions: platform?.extensions || [],
          spaces: packs
            .filter((p) => !platform || principal.spaces.includes(p.spaceId))
            .map((p) => ({
              spaceId: p.spaceId,
              name: p.name,
              description: p.description,
              agents: p.agents,
              scenes: p.scenes.map((s) => ({ sceneId: s.sceneId, name: s.name })),
            })),
          receptionMode: reception.live ? 'live-model' : 'knowledge-only',
          receptionProvider: reception.provider,
          generalConversation: reception.general,
          knowledge: knowledge ? knowledge.mode + '-pgvector' : 'published-keyword',
        });
      }
      if (
        method === 'GET' &&
        (url.pathname === '/.well-known/agent-card.json' ||
          (parts[0] === 'agents' && parts[2] === '.well-known' && parts[3] === 'agent-card.json'))
      ) {
        if (platform) {
          const principal = await platform.identity.principal(req);
          if (principal.allowedAgents && !principal.allowedAgents.includes(parts[1]))
            fail('agent_scope_denied', 'Agent is outside delegated scope', 403);
          const owner = packs.find((p) =>
            p.agents.some(
              (a) => a.agentId === (parts[0] === 'agents' ? parts[1] : packs[0].agents[0].agentId),
            ),
          );
          if (owner) authorize(principal, owner.spaceId);
        }
        return json(
          res,
          200,
          gateway.card(parts[0] === 'agents' ? parts[1] : packs[0].agents[0].agentId, origin),
        );
      }
      if (parts[0] === 'agents' && parts.length === 3 && parts[2] === 'a2a' && method === 'POST') {
        const principal = await (platform
          ? platform.identity.principal(req)
          : auth.principal(req, res));
        const window = Math.floor(Date.now() / 60000),
          rateKey = principal.id + ':' + window,
          count = (rates.get(rateKey) || 0) + 1;
        rates.set(rateKey, count);
        if (count > 120) fail('rate_limit', 'Too many requests', 429);
        if (rates.size > 5000) rates.clear();
        const request = await body(req);
        return json(
          res,
          200,
          await gateway.handle({
            agentId: parts[1],
            principal,
            request,
            version: req.headers['a2a-version'],
            origin,
          }),
        );
      }
      if (parts[0] === 'api' && parts[1] === 'spaces' && parts[2]) {
        const pack = packFor(parts[2]),
          principal = await (platform
            ? platform.identity.principal(req)
            : auth.principal(req, res, { browser: true }));
        authorize(principal, pack.spaceId);
        if (method === 'GET' && parts[3] === 'scene') {
          const scene = pack.scenes.find(
            (s) => s.sceneId === (url.searchParams.get('sceneId') || pack.spawn.sceneId),
          );
          if (!scene) fail('scene_missing', 'Scene not found', 404);
          return json(res, 200, {
            spaceId: pack.spaceId,
            name: pack.name,
            scene,
            modelUrl: '/api/spaces/' + pack.spaceId + '/models/' + scene.sceneId + '.glb',
            assets: (pack.assets || [])
              .filter((a) => a.published)
              .map((a) => ({ id: a.id, url: '/api/spaces/' + pack.spaceId + '/assets/' + a.id })),
            exhibits: (pack.exhibits || []).filter((e) => e.published),
            geometryHash: digest(scene),
            spawn: pack.spawn,
            position: position(store.read(), principal, pack),
            reception: pack.agents[0],
          });
        }
        if (method === 'GET' && parts[3] === 'assets' && parts[4]) {
          const asset = assets.get(pack.spaceId + ':' + parts[4]);
          if (!asset) fail('asset_missing', 'Published asset not found', 404);
          res.writeHead(200, {
            'Content-Type': asset.type,
            'Content-Length': asset.buffer.length,
            'Cache-Control': 'no-cache',
          });
          return res.end(asset.buffer);
        }
        if (method === 'GET' && parts[3] === 'models' && parts[4]?.endsWith('.glb')) {
          const data = models.get(pack.spaceId + ':' + parts[4].slice(0, -4));
          if (!data) fail('model_missing', 'Model not found', 404);
          res.writeHead(200, {
            'Content-Type': MIME['.glb'],
            'Content-Length': data.length,
            'Cache-Control': 'no-cache',
          });
          return res.end(data);
        }
        if (method === 'GET' && parts[3] === 'position')
          return json(res, 200, position(store.read(), principal, pack));
        if (method === 'GET' && parts[3] === 'messages') {
          authorize(principal, pack.spaceId, 'messages:read');
          return json(res, 200, {
            messages: store.read().messages.filter((m) => m.spaceId === pack.spaceId),
          });
        }
        if (method === 'POST' && parts[3] === 'move') {
          const input = fields(
            await body(req),
            ['requestId', 'sceneId', 'levelId', 'point', 'entityId'],
            'move',
          );
          identifier(input.requestId);
          authorize(principal, pack.spaceId, 'a2a:call');
          return json(
            res,
            200,
            await store.command(principal, pack.spaceId, input.requestId, input, (d) => {
              const from = position(d, principal, pack);
              if (from.moving && from.connectorId)
                fail('on_connector', 'Finish the current stair transition first', 409);
              const nav = maps.get(pack.spaceId + ':' + input.sceneId);
              if (!nav || from.sceneId !== input.sceneId)
                fail('scene_missing', 'Scene transition not configured');
              const level = nav.scene.levels.find((l) => l.id === input.levelId);
              if (!level) fail('level_missing', 'Level not found');
              let destination = input.point;
              if (input.entityId) {
                const room = level.rooms.find(
                  (r) => r.entityId === input.entityId && r.access === 'public',
                );
                if (!room) fail('entity_missing', 'Public room not found', 404);
                const p = roomPoint(room);
                destination = [p[0], level.elevation, p[1]];
              }
              const route = nav.route(from, { levelId: level.id, point: destination }),
                move = { ...route, startedAt: Date.now(), speed: 4 };
              d.positions[digest([principal.id, pack.spaceId])] = move;
              return move;
            }),
          );
        }
        if (parts[3] === 'reception-sessions') {
          const agentId = pack.agents[0].agentId,
            sessions = gateway.receptionSessions;
          if (method === 'GET' && parts.length === 4)
            return json(res, 200, await sessions.list(principal, pack.spaceId, agentId));
          if (method === 'POST' && parts.length === 4) {
            const b = fields(await body(req), ['requestId'], 'reception_session');
            return json(
              res,
              200,
              await sessions.create(principal, pack.spaceId, agentId, b.requestId),
            );
          }
          if (method === 'GET' && parts.length === 6 && parts[5] === 'export')
            return json(
              res,
              200,
              await sessions.export(principal, pack.spaceId, agentId, parts[4]),
            );
          if (method === 'POST' && parts.length === 6 && parts[5] === 'delete') {
            const b = fields(
              await body(req),
              ['requestId', 'expectedRevision'],
              'reception_delete',
            );
            return json(
              res,
              200,
              await sessions.remove(
                principal,
                pack.spaceId,
                agentId,
                parts[4],
                b.expectedRevision,
                b.requestId,
              ),
            );
          }
          fail('route_missing', 'Reception session route not found', 404);
        }
        if (method === 'POST' && parts[3] === 'reception') {
          const input = fields(
            await body(req),
            ['message', 'messageId', 'skillId', 'arguments', 'contextId'],
            'reception',
          );
          identifier(input.messageId);
          const window = Math.floor(Date.now() / 60000),
            rateKey = 'browser:' + principal.id + ':' + window;
          rates.set(rateKey, (rates.get(rateKey) || 0) + 1);
          if (rates.get(rateKey) > 20) fail('rate_limit', '接待请求太频繁，请稍后重试', 429);
          const request = {
            jsonrpc: '2.0',
            id: input.messageId,
            method: 'SendMessage',
            params: {
              message: {
                messageId: input.messageId,
                role: 'ROLE_USER',
                parts: [{ text: input.message }],
                ...(input.contextId ? { contextId: input.contextId } : {}),
              },
              metadata: {
                [EXTENSION]: {
                  skillId: input.skillId || 'space.information',
                  arguments: input.arguments || {},
                },
              },
            },
          };
          return json(
            res,
            200,
            await gateway.handle({
              agentId: pack.agents[0].agentId,
              principal,
              request,
              version: '1.0',
              origin,
            }),
          );
        }
        fail('route_missing', 'Route not found', 404);
      }
      if (method === 'GET' || method === 'HEAD') {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (
          name.split('/').some((p) => p.startsWith('.') || p.includes('\\')) ||
          name.includes('\0')
        )
          fail('path_denied', 'Invalid asset path', 403);
        const base = resolve(root, 'public'),
          file = resolve(base, name);
        if (!file.startsWith(base + sep)) fail('path_denied', 'Invalid asset path', 403);
        let info;
        try {
          info = await stat(file);
        } catch {
          fail('not_found', 'Asset not found', 404);
        }
        if (!info.isFile()) fail('not_found', 'Asset not found', 404);
        if (name === 'admin.html') {
          const nonce = randomUUID().replaceAll('-', '');
          const html = (await readFile(file, 'utf8')).replace('HD_ADMIN_NONCE', nonce);
          res.setHeader(
            'Content-Security-Policy',
            `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'`,
          );
          res.writeHead(200, {
            'Content-Type': MIME['.html'],
            'Cache-Control': 'no-store',
            'Content-Length': Buffer.byteLength(html),
          });
          return res.end(method === 'HEAD' ? undefined : html);
        }
        res.writeHead(200, {
          'Content-Type': MIME[extname(file)] || 'application/octet-stream',
          'Content-Length': info.size,
        });
        return res.end(method === 'HEAD' ? undefined : await readFile(file));
      }
      fail('route_missing', 'Route not found', 404);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      return json(res, error.status || 500, {
        error: {
          code: error.code || 'internal_error',
          message: error.status ? error.message : 'Service error; private details were not exposed',
        },
      });
    }
  });
  try {
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, host, done);
    });
  } catch (error) {
    await gateway.close();
    await knowledge?.close();
    await store.close();
    throw error;
  }
  origin =
    publicOrigin ||
    'http://' + (host.includes(':') ? '[' + host + ']' : host) + ':' + server.address().port;
  let closing;
  let cleaningReception = null;
  const cleanupReception = setInterval(() => {
    if (!cleaningReception)
      cleaningReception = gateway.receptionSessions
        .expire()
        .then(() => {
          receptionCleanupError = null;
        })
        .catch((e) => {
          receptionCleanupError = e.code || 'cleanup_failed';
        })
        .finally(() => {
          cleaningReception = null;
        });
  }, 60000);
  cleanupReception.unref();
  return {
    server,
    origin,
    store,
    gateway,
    auth,
    maps,
    close() {
      return (closing ??= (async () => {
        clearInterval(cleanupReception);
        await cleaningReception;
        platform?.stopStreams?.();
        const stopped = new Promise((done) => server.close(done));
        await gateway.close();
        await stopped;
        await knowledge?.close();
        await store.close();
      })());
    },
  };
}
