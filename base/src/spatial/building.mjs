import { identifier, text, point, fail, digest } from '../protocol/index.mjs';
export const SCENE_FORMAT = 'hyper-dimension.scene/v1';
const inRect = (x, z, r, pad = 0) =>
  x >= r[0] - pad && z >= r[1] - pad && x <= r[0] + r[2] + pad && z <= r[1] + r[3] + pad;
const rect = (r) =>
  Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) && r[2] > 0 && r[3] > 0;
export function validateScene(s) {
  if (s.format !== SCENE_FORMAT || s.units !== 'm' || s.axes !== 'Y_UP_X_EAST_Z_SOUTH')
    fail('scene_version', 'Unsupported spatial contract');
  identifier(s.sceneId);
  text(s.name, 100);
  if (
    !Array.isArray(s.size) ||
    s.size.length !== 2 ||
    s.size.some((v) => !Number.isFinite(v) || v < 4 || v > 300)
  )
    fail('scene_size', 'Size must be 4–300 metres');
  if (!Number.isFinite(s.cellSize) || s.cellSize < 0.25 || s.cellSize > 1)
    fail('scene_grid', 'cellSize must be 0.25–1m');
  if (!Array.isArray(s.levels) || !s.levels.length || s.levels.length > 16)
    fail('scene_levels', 'Expected 1–16 levels');
  const ids = new Set(),
    entities = new Set();
  for (const l of s.levels) {
    identifier(l.id);
    if (ids.has(l.id)) fail('duplicate_id', 'Duplicate level');
    ids.add(l.id);
    if (
      !Number.isFinite(l.elevation) ||
      !Number.isFinite(l.height) ||
      l.height < 2 ||
      l.height > 10
    )
      fail('scene_height', 'Invalid level height');
    for (const r of l.rooms || []) {
      identifier(r.entityId);
      if (entities.has(r.entityId)) fail('duplicate_id', 'Duplicate entity');
      entities.add(r.entityId);
      text(r.name, 100);
      if (
        !rect(r.rect) ||
        r.rect[0] < 0 ||
        r.rect[1] < 0 ||
        r.rect[0] + r.rect[2] > s.size[0] + 0.001 ||
        r.rect[1] + r.rect[3] > s.size[1] + 0.001
      )
        fail('scene_room', 'Room outside floor');
      if (!['public', 'restricted'].includes(r.access))
        fail('scene_access', 'Room requires access');
      if (
        r.access === 'public' &&
        (!r.door ||
          !['north', 'south', 'east', 'west'].includes(r.door.edge) ||
          !Number.isFinite(r.door.offset) ||
          !Number.isFinite(r.door.width) ||
          r.door.width < 1.2 ||
          r.door.offset - r.door.width / 2 < 0.1 ||
          r.door.offset + r.door.width / 2 >
            (['north', 'south'].includes(r.door.edge) ? r.rect[2] : r.rect[3]) - 0.1)
      )
        fail('scene_door', 'Public room needs a safe door opening');
    }
    for (const v of l.voids || [])
      if (!rect(v) || v[0] < 0 || v[1] < 0 || v[0] + v[2] > s.size[0] || v[1] + v[3] > s.size[1])
        fail('scene_void', 'Void outside floor');
  }
  for (const c of s.connectors || []) {
    identifier(c.entityId);
    if (entities.has(c.entityId)) fail('duplicate_id', 'Duplicate connector');
    entities.add(c.entityId);
    if (
      !['stairs', 'elevator'].includes(c.type) ||
      !ids.has(c.from.levelId) ||
      !ids.has(c.to.levelId) ||
      c.from.levelId === c.to.levelId
    )
      fail('scene_connector', 'Invalid connector');
    for (const p of [c.from, c.to])
      if (
        !Array.isArray(p.point) ||
        p.point.length !== 2 ||
        p.point.some((v) => !Number.isFinite(v)) ||
        !inRect(...p.point, [0, 0, ...s.size])
      )
        fail('scene_connector', 'Connector endpoint outside floor');
  }
  for (const a of s.artwork || []) {
    identifier(a.assetId);
    if (
      !ids.has(a.levelId) ||
      !entities.has(a.entityId) ||
      !['model', 'billboard'].includes(a.kind)
    )
      fail('scene_art', 'Artwork needs a valid room, level and kind');
    point(a.point);
    point(a.scale);
    if (
      a.scale.some((v) => v <= 0 || v > 50) ||
      (a.rotationY !== undefined && !Number.isFinite(a.rotationY)) ||
      (a.footprint && !rect(a.footprint))
    )
      fail('scene_art', 'Invalid artwork transform/footprint');
  }
  if (
    !ids.has(s.entry?.levelId) ||
    !Number.isFinite(s.entry?.z) ||
    s.entry.z < 2 ||
    s.entry.z > s.size[1] - 2
  )
    fail('scene_entry', 'Invalid west entrance');
  return s;
}
export function roomPoint(room) {
  const [x, z, w, d] = room.rect;
  return [x + w / 2, z + d / 2];
}
export function furnitureRect(room) {
  const [x, z, w, d] = room.rect,
    width = Math.min(2.3, w - 0.8);
  return [
    room.door.edge === 'west' ? x + w - width - 0.3 : x + 0.3,
    room.door.edge === 'north' ? z + d - 0.9 : z + 0.3,
    width,
    0.6,
  ];
}
export function doorPoint(room, side = 0) {
  const [x, z, w, d] = room.rect,
    o = room.door.offset;
  return room.door.edge === 'north'
    ? [x + o, z + side]
    : room.door.edge === 'south'
      ? [x + o, z + d - side]
      : room.door.edge === 'west'
        ? [x + side, z + o]
        : [x + w - side, z + o];
}
function edges(r) {
  const [x, z, w, d] = r;
  return [
    { a: [x, z], b: [x + w, z], edge: 'north' },
    { a: [x + w, z], b: [x + w, z + d], edge: 'east' },
    { a: [x, z + d], b: [x + w, z + d], edge: 'south' },
    { a: [x, z], b: [x, z + d], edge: 'west' },
  ];
}
function cut(edge, door) {
  if (!door) return [edge];
  const len = Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]),
    u = [(edge.b[0] - edge.a[0]) / len, (edge.b[1] - edge.a[1]) / len],
    at = (n) => edge.a.map((v, i) => v + n * u[i]);
  return [
    { a: edge.a, b: at(door.offset - door.width / 2) },
    { a: at(door.offset + door.width / 2), b: edge.b },
  ];
}
export function wallsFor(s, l) {
  const outer = edges([0, 0, ...s.size])
    .flatMap((e) =>
      cut(
        e,
        l.id === s.entry.levelId && e.edge === 'west' ? { offset: s.entry.z, width: 3 } : null,
      ),
    )
    .map((w) => ({ ...w, outer: true }));
  const rooms = (l.rooms || []).flatMap((r) =>
    edges(r.rect)
      .flatMap((e) => cut(e, r.access === 'public' && r.door.edge === e.edge ? r.door : null))
      .map((w) => ({ ...w, entityId: r.entityId })),
  );
  // Identical shared segments need one rendered wall and one collision definition.
  return [
    ...new Map(
      [...outer, ...rooms]
        .filter((w) => Math.hypot(w.a[0] - w.b[0], w.a[1] - w.b[1]) > 0.01)
        .map((w) => [digest([w.a, w.b]), w]),
    ).values(),
  ];
}
const distanceSegment = (p, a, b) => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};
export function createNavigation(scene) {
  validateScene(scene);
  const h = scene.cellSize,
    margin = 6,
    nx = Math.ceil((scene.size[0] + margin * 2) / h),
    nz = Math.ceil((scene.size[1] + margin * 2) / h),
    floors = new Map(),
    nodes = new Map(),
    links = new Map();
  const key = (level, x, z) => level + ':' + x + ':' + z,
    coord = (x, z) => [-margin + (x + 0.5) * h, -margin + (z + 0.5) * h];
  for (const l of scene.levels) {
    const walls = wallsFor(scene, l),
      blockedRooms = (l.rooms || []).filter((r) => r.access === 'restricted');
    const floor = { l, walls };
    floors.set(l.id, floor);
    const furniture = (l.rooms || []).filter((r) => r.access === 'public').map(furnitureRect);
    if (l.id === scene.entry.levelId) furniture.push([2.1, scene.entry.z + 0.95, 2.8, 0.9]);
    for (let ix = 0; ix < nx; ix++)
      for (let iz = 0; iz < nz; iz++) {
        const [x, z] = coord(ix, iz);
        let okay = inRect(x, z, [0.28, 0.28, scene.size[0] - 0.56, scene.size[1] - 0.56]);
        if (l.id === scene.entry.levelId && inRect(x, z, [-5, scene.entry.z - 4, 5.4, 8]))
          okay = true;
        if (
          !okay ||
          (l.voids || []).some((v) => inRect(x, z, v, 0.22)) ||
          blockedRooms.some((r) => inRect(x, z, r.rect, 0.22)) ||
          furniture.some((v) => inRect(x, z, v, 0.22)) ||
          (scene.artwork || []).some(
            (a) => a.levelId === l.id && a.footprint && inRect(x, z, a.footprint, 0.22),
          ) ||
          walls.some((w) => distanceSegment([x, z], w.a, w.b) < 0.28)
        )
          continue;
        const id = key(l.id, ix, iz);
        nodes.set(id, { id, levelId: l.id, ix, iz, point: [x, l.elevation, z] });
      }
  }
  function nearest(location, maxDistance = 0.9) {
    point(location.point);
    const floor = floors.get(location.levelId);
    if (!floor || Math.abs(location.point[1] - floor.l.elevation) > 0.15)
      fail('invalid_floor', 'Point elevation does not match its level');
    let best = null,
      dist = maxDistance;
    const ix = Math.floor((location.point[0] + margin) / h),
      iz = Math.floor((location.point[2] + margin) / h);
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++) {
        const n = nodes.get(key(location.levelId, ix + dx, iz + dz));
        if (!n) continue;
        const d = Math.hypot(n.point[0] - location.point[0], n.point[2] - location.point[2]);
        if (d < dist) {
          best = n;
          dist = d;
        }
      }
    if (!best) fail('not_walkable', 'Position is not on a walkable surface');
    return best;
  }
  for (const c of scene.connectors || []) {
    const a = nearest({
        levelId: c.from.levelId,
        point: [c.from.point[0], floors.get(c.from.levelId).l.elevation, c.from.point[1]],
      }),
      b = nearest({
        levelId: c.to.levelId,
        point: [c.to.point[0], floors.get(c.to.levelId).l.elevation, c.to.point[1]],
      });
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const list = links.get(from.id) || [];
      list.push({ node: to, connectorId: c.entityId, type: c.type });
      links.set(from.id, list);
    }
  }
  function route(from, to) {
    const start = nearest(from),
      end = nearest(to),
      previous = new Map([[start.id, null]]),
      queue = [start];
    let head = 0;
    while (head < queue.length && !previous.has(end.id)) {
      const n = queue[head++],
        neighbors = [];
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = nodes.get(key(n.levelId, n.ix + dx, n.iz + dz));
        if (next) neighbors.push({ node: next });
      }
      neighbors.push(...(links.get(n.id) || []));
      for (const edge of neighbors)
        if (!previous.has(edge.node.id)) {
          previous.set(edge.node.id, { node: n, connectorId: edge.connectorId, type: edge.type });
          queue.push(edge.node);
        }
    }
    if (!previous.has(end.id)) fail('no_route', 'No walkable route between these positions', 409);
    let n = end;
    const path = [];
    while (n) {
      const p = previous.get(n.id);
      path.push({
        ...n,
        ...(p?.connectorId ? { connectorId: p.connectorId, connectorType: p.type } : {}),
      });
      n = p?.node;
    }
    path.reverse();
    let distance = 0;
    for (let i = 1; i < path.length; i++)
      distance += Math.hypot(...path[i].point.map((v, j) => v - path[i - 1].point[j]));
    return {
      sceneId: scene.sceneId,
      geometryHash: digest(scene),
      distance: Number(distance.toFixed(3)),
      path: path.map((n) => ({
        levelId: n.levelId,
        point: n.point,
        ...(n.connectorId ? { connectorId: n.connectorId, connectorType: n.connectorType } : {}),
      })),
    };
  }
  return {
    scene,
    nearest,
    route,
    nodeCount: nodes.size,
    isWalkable: (location) => {
      try {
        return !!nearest(location, 0.35);
      } catch {
        return false;
      }
    },
  };
}
export function positionAt(movement, now = Date.now()) {
  if (!movement?.path?.length) return null;
  const path = movement.path,
    total = movement.distance,
    travel = Math.max(0, Math.min(total, ((now - movement.startedAt) / 1000) * movement.speed));
  let left = travel;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      length = Math.hypot(...b.point.map((v, j) => v - a.point[j]));
    if (left <= length) {
      const t = length ? left / length : 1;
      return {
        levelId: t < 0.5 ? a.levelId : b.levelId,
        point: a.point.map((v, j) => v + (b.point[j] - v) * t),
        moving: travel < total,
        connectorId: b.connectorId,
      };
    }
    left -= length;
  }
  return { ...path.at(-1), moving: false };
}
