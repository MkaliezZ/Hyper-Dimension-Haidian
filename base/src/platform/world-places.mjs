// UW school integration: an explicit trusted outdoor adapter; indoor contracts stay intact.
import { problem } from './db.mjs';
import { digest } from '../protocol/index.mjs';

function outdoor(world, spaceId) {
  const adapter = world?.placeAdapter;
  if (!adapter) return null;
  if (adapter.contract !== 'hyper-dimension.geo-campus/v1')
    throw problem('unsupported_place_adapter', 503);
  return adapter.supports(spaceId) ? adapter : null;
}
export function publicPlaces(world, spaceId) {
  const adapter = outdoor(world, spaceId);
  if (adapter) return adapter.publicPlaces(spaceId);
  return (world?.packFor(spaceId)?.scenes || []).flatMap(scene =>
    scene.levels.flatMap(level => (level.rooms || []).filter(r => r.access === 'public').map(r => ({
      sceneId: scene.sceneId, entityId: r.entityId, label: r.name || r.entityId,
      name: r.name || r.label || r.entityId, sceneName: scene.name || scene.sceneId,
    }))));
}
export function publicPlace(world, spaceId, sceneId, entityId) {
  return publicPlaces(world, spaceId).find(p => p.sceneId === sceneId && p.entityId === entityId) || null;
}
export function toolPlace(world, pack, position, sceneId, entityId, action) {
  const adapter = outdoor(world, pack.spaceId);
  if (adapter) return adapter.toolPlace(pack.spaceId, position, sceneId, entityId, action);
  const scene = pack.scenes.find(s => s.sceneId === sceneId);
  if (!scene || position.sceneId !== scene.sceneId) throw problem('tool_scene_denied', 403);
  const level = scene.levels.find(l => (l.rooms || []).some(r => r.entityId === entityId && r.access === 'public'));
  const room = level?.rooms.find(r => r.entityId === entityId && r.access === 'public');
  if (action !== 'wave' && !room) throw problem('tool_public_place_required', 403);
  if (['postcard', 'stamp', 'note'].includes(action)) {
    if (position.levelId !== level.id || position.moving) throw problem('tool_arrival_required', 409);
    const [x,z,w,d] = room.rect, [px,,pz] = position.point;
    if (px < x || px > x+w || pz < z || pz > z+d) throw problem('tool_arrival_required',409);
  }
  return {sceneId:scene.sceneId, entityId:room?.entityId || null, name:room?.name || null,
    levelName:level?.name || position.levelId, geometryHash:digest(scene)};
}
