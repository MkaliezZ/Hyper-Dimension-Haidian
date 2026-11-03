import { createHash } from 'node:crypto';
export const BASE_VERSION = '0.2.1';
export const PROTOCOL = 'hyper-dimension.base/v1';
export const EXTENSION = 'https://hyper-dimension.dev/protocol/space/v1';
export const A2A_VERSION = '1.0';
export class BaseError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export const fail = (code, message, status = 400) => {
  throw new BaseError(code, message, status);
};
export const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export function fields(value, allowed, label = 'object') {
  if (!object(value) || Object.keys(value).some((k) => !allowed.includes(k)))
    fail('invalid_input', 'Invalid ' + label);
  return value;
}
export function identifier(value, label = 'id') {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value) ||
    ['__proto__', 'constructor', 'prototype'].includes(value)
  )
    fail('invalid_id', 'Invalid ' + label);
  return value;
}
export function text(value, max = 4000) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    fail('invalid_text', 'Invalid text');
  return value.trim();
}
export function canonical(value) {
  return JSON.stringify(value, (_, v) =>
    object(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}
export const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');
export function point(value) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((n) => !Number.isFinite(n)))
    fail('invalid_point', 'Expected finite XYZ coordinates');
  return [...value];
}
export const clone = (value) => structuredClone(value);
export function authorize(principal, spaceId, scope = 'public:read') {
  if (!principal) fail('unauthorized', 'Authentication required', 401);
  if (scope === 'public:read' && !principal.tenantBound && principal.scopes.includes('public:read'))
    return;
  if (principal.spaces.includes(spaceId) && principal.scopes.includes(scope)) return;
  fail('forbidden', 'This identity has no permission for the requested space and capability', 403);
}
export function validatePackage(pack) {
  fields(
    pack,
    [
      'protocol',
      'baseVersion',
      'spaceId',
      'name',
      'description',
      'theme',
      'scenes',
      'spawn',
      'knowledge',
      'agents',
      'source',
      'contacts',
      'assets',
      'exhibits',
    ],
    'space package',
  );
  if (
    pack.protocol !== PROTOCOL ||
    !['0.1.0', '0.1.1', '0.2.0', BASE_VERSION].includes(pack.baseVersion)
  )
    fail('incompatible_version', 'Unsupported Base/protocol version');
  identifier(pack.spaceId, 'spaceId');
  text(pack.name, 100);
  if (!Array.isArray(pack.scenes) || !pack.scenes.length)
    fail('invalid_scene', 'At least one scene is required');
  if (!Array.isArray(pack.agents) || !pack.agents.length)
    fail('invalid_agent', 'At least one reception Agent is required');
  const ids = new Set();
  for (const s of pack.scenes) {
    identifier(s.sceneId, 'sceneId');
    if (ids.has(s.sceneId)) fail('duplicate_id', 'Duplicate sceneId');
    ids.add(s.sceneId);
  }
  if (!ids.has(pack.spawn?.sceneId)) fail('invalid_spawn', 'Spawn scene must exist');
  identifier(pack.spawn.levelId);
  point(pack.spawn.point);
  const knowledgeIds = new Set();
  for (const k of pack.knowledge || []) {
    identifier(k.id);
    if (knowledgeIds.has(k.id)) fail('duplicate_id', 'Duplicate knowledge ID');
    knowledgeIds.add(k.id);
    text(k.title, 200);
    text(k.body, 10000);
    if (typeof k.published !== 'boolean')
      fail('invalid_knowledge', 'Knowledge requires published boolean');
  }
  const agentIds = new Set();
  for (const a of pack.agents || []) {
    identifier(a.agentId);
    if (agentIds.has(a.agentId)) fail('duplicate_id', 'Duplicate agent ID');
    agentIds.add(a.agentId);
    text(a.name, 100);
    if (!Array.isArray(a.skills) || !a.skills.length)
      fail('invalid_capability', 'Agent must declare capabilities');
    for (const id of a.skills) identifier(id, 'skillId');
  }
  const assetIds = new Set();
  for (const a of pack.assets || []) {
    identifier(a.id);
    if (assetIds.has(a.id)) fail('duplicate_id', 'Duplicate asset');
    assetIds.add(a.id);
    if (
      typeof a.file !== 'string' ||
      !/^assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(png|jpg|webp|glb)$/.test(a.file) ||
      typeof a.published !== 'boolean'
    )
      fail('asset_path', 'Assets must be explicit files under assets/ with a publish flag');
  }
  const entities = new Set(
      pack.scenes.flatMap(
        (s) => s.levels?.flatMap((l) => l.rooms?.map((r) => r.entityId) || []) || [],
      ),
    ),
    exhibitIds = new Set();
  for (const e of pack.exhibits || []) {
    identifier(e.id);
    if (exhibitIds.has(e.id)) fail('duplicate_id', 'Duplicate exhibit');
    exhibitIds.add(e.id);
    if (!entities.has(e.entityId) || typeof e.published !== 'boolean')
      fail('invalid_exhibit', 'Exhibit must reference a room and declare publication');
    text(e.title, 200);
    text(e.body, 10000);
    if (
      !Array.isArray(e.assetIds) ||
      e.assetIds.some(
        (id) => !pack.assets?.some((a) => a.id === id && (!e.published || a.published)),
      )
    )
      fail('invalid_exhibit', 'Published exhibits require published assets');
  }
  return pack;
}
