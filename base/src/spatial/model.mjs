import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validateScene, wallsFor, furnitureRect } from './building.mjs';
import { digest } from '../protocol/index.mjs';
// Original glTF 2.0 box-mesh builder. No DCC, native binary or game asset dependency.
export function makeGlb(scene) {
  validateScene(scene);
  const vertices = [],
    normals = [],
    indices = [];
  const faces = [
    [
      [1, 0, 0],
      [
        [0.5, -0.5, -0.5],
        [0.5, 0.5, -0.5],
        [0.5, 0.5, 0.5],
        [0.5, -0.5, 0.5],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [-0.5, -0.5, 0.5],
        [-0.5, 0.5, 0.5],
        [-0.5, 0.5, -0.5],
        [-0.5, -0.5, -0.5],
      ],
    ],
    [
      [0, 1, 0],
      [
        [-0.5, 0.5, -0.5],
        [-0.5, 0.5, 0.5],
        [0.5, 0.5, 0.5],
        [0.5, 0.5, -0.5],
      ],
    ],
    [
      [0, -1, 0],
      [
        [-0.5, -0.5, 0.5],
        [-0.5, -0.5, -0.5],
        [0.5, -0.5, -0.5],
        [0.5, -0.5, 0.5],
      ],
    ],
    [
      [0, 0, 1],
      [
        [0.5, -0.5, 0.5],
        [0.5, 0.5, 0.5],
        [-0.5, 0.5, 0.5],
        [-0.5, -0.5, 0.5],
      ],
    ],
    [
      [0, 0, -1],
      [
        [-0.5, -0.5, -0.5],
        [-0.5, 0.5, -0.5],
        [0.5, 0.5, -0.5],
        [0.5, -0.5, -0.5],
      ],
    ],
  ];
  for (const [normal, points] of faces) {
    const start = vertices.length / 3;
    for (const p of points) {
      vertices.push(...p);
      normals.push(...normal);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const pos = Buffer.from(new Float32Array(vertices).buffer),
    nor = Buffer.from(new Float32Array(normals).buffer),
    idx = Buffer.from(new Uint16Array(indices).buffer),
    binary = Buffer.concat([pos, nor, idx]);
  const colors = [
    [0.87, 0.83, 0.74, 1],
    [0.94, 0.93, 0.86, 1],
    [0.23, 0.48, 0.44, 1],
    [0.73, 0.52, 0.3, 1],
    [0.48, 0.65, 0.71, 1],
    [0.65, 0.68, 0.64, 1],
    [0.9, 0.68, 0.32, 1],
    [0.34, 0.38, 0.4, 1],
  ];
  const materials = colors.map((c, i) => ({
    name: ['floor', 'wall', 'accent', 'wood', 'glass', 'terrace', 'sign', 'metal'][i],
    pbrMetallicRoughness: { baseColorFactor: c, metallicFactor: 0, roughnessFactor: 0.8 },
    doubleSided: true,
  }));
  const meshes = materials.map((_, i) => ({
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: i }],
    })),
    nodes = [],
    roots = [];
  const add = (parent, name, position, scale, material, extras = {}, rotation) => {
    const n = {
      name,
      mesh: material,
      translation: position,
      scale,
      extras,
      ...(rotation ? { rotation } : {}),
    };
    const id = nodes.push(n) - 1;
    if (parent === null) roots.push(id);
    else (nodes[parent].children ??= []).push(id);
    return id;
  };
  for (const l of scene.levels) {
    const parent =
      nodes.push({ name: l.name || l.id, extras: { levelId: l.id, kind: 'level' }, children: [] }) -
      1;
    roots.push(parent);
    const y = l.elevation;
    // Partition only at void boundaries: exact holes with a few slabs, no tile draw-call explosion.
    const xs = [
        ...new Set([0, scene.size[0], ...(l.voids || []).flatMap((v) => [v[0], v[0] + v[2]])]),
      ].sort((a, b) => a - b),
      zs = [
        ...new Set([0, scene.size[1], ...(l.voids || []).flatMap((v) => [v[1], v[1] + v[3]])]),
      ].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++)
      for (let j = 1; j < zs.length; j++) {
        const x = xs[i - 1],
          z = zs[j - 1],
          w = xs[i] - x,
          d = zs[j] - z;
        if (
          (l.voids || []).some(
            (v) =>
              x + w / 2 > v[0] &&
              x + w / 2 < v[0] + v[2] &&
              z + d / 2 > v[1] &&
              z + d / 2 < v[1] + v[3],
          )
        )
          continue;
        add(parent, 'floor', [x + w / 2, y - 0.1, z + d / 2], [w, 0.2, d], 0, {
          kind: 'floor',
          levelId: l.id,
        });
      }
    for (const w of wallsFor(scene, l)) {
      const dx = w.b[0] - w.a[0],
        dz = w.b[1] - w.a[1],
        length = Math.hypot(dx, dz),
        angle = -Math.atan2(dz, dx);
      add(
        parent,
        'wall',
        [(w.a[0] + w.b[0]) / 2, y + l.height * 0.29, (w.a[1] + w.b[1]) / 2],
        [length, w.outer ? l.height * 0.58 : l.height * 0.43, 0.15],
        1,
        { kind: 'wall', levelId: l.id, entityId: w.entityId },
        [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)],
      );
    }
    for (const v of l.voids || []) {
      const [x, z, w, d] = v;
      for (const [px, pz, sx, sz] of [
        [x + w / 2, z, w, 0.08],
        [x + w / 2, z + d, w, 0.08],
        [x, z + d / 2, 0.08, d],
        [x + w, z + d / 2, 0.08, d],
      ]) {
        add(parent, 'atrium rail', [px, y + 0.52, pz], [sx, 0.08, sz], 7, {
          kind: 'rail',
          levelId: l.id,
        });
      }
    }
    for (const r of l.rooms || []) {
      if (r.access === 'restricted') continue;
      const rect = furnitureRect(r),
        x = rect[0] + rect[2] / 2,
        z = rect[1] + rect[3] / 2,
        w = rect[2],
        d = rect[3];
      add(
        parent,
        r.name + ' display',
        [x, y + 0.38, z],
        [w, 0.76, d],
        r.kind === 'gallery' ? 4 : 3,
        { kind: 'furniture', entityId: r.entityId, levelId: l.id },
      );
      add(parent, 'display inset', [x, y + 0.79, z], [w * 0.92, 0.06, d * 0.9], 2, {
        kind: 'furniture',
        entityId: r.entityId,
        levelId: l.id,
      });
    }
    if (l.id === scene.entry.levelId) {
      add(parent, 'arrival terrace', [-2.4, y - 0.12, scene.entry.z], [5.2, 0.24, 8], 5, {
        kind: 'floor',
        levelId: l.id,
      });
      add(parent, 'reception desk', [3.5, y + 0.55, scene.entry.z + 1.4], [2.8, 1.1, 0.9], 2, {
        kind: 'reception',
        levelId: l.id,
      });
    }
  }
  for (const c of scene.connectors || []) {
    const lower = scene.levels.find((l) => l.id === c.from.levelId),
      upper = scene.levels.find((l) => l.id === c.to.levelId),
      parent = nodes.findIndex((n) => n.extras?.kind === 'level' && n.extras.levelId === lower.id),
      a = c.from.point,
      b = c.to.point,
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz),
      steps = 20,
      angle = -Math.atan2(dz, dx);
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps,
        y = lower.elevation + (upper.elevation - lower.elevation) * t;
      add(
        parent,
        'stair ' + c.entityId,
        [a[0] + dx * t, y - 0.08, a[1] + dz * t],
        [length / steps, 0.16, c.width || 1.6],
        3,
        { kind: 'stair', connectorId: c.entityId, levelId: lower.id },
        [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)],
      );
    }
  }
  const gltf = {
    asset: {
      version: '2.0',
      generator: 'Hyper Dimension Base 0.1',
      copyright: 'Private source interpretation stays in its space project',
    },
    scene: 0,
    scenes: [{ nodes: roots }],
    nodes,
    meshes,
    materials,
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 },
      { buffer: 0, byteOffset: pos.length, byteLength: nor.length, target: 34962 },
      { buffer: 0, byteOffset: pos.length + nor.length, byteLength: idx.length, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 24,
        type: 'VEC3',
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    extras: { format: scene.format, sceneId: scene.sceneId, geometryHash: digest(scene) },
  };
  const raw = Buffer.from(JSON.stringify(gltf)),
    json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32);
  raw.copy(json);
  const bin = Buffer.alloc(Math.ceil(binary.length / 4) * 4);
  binary.copy(bin);
  const header = Buffer.alloc(12),
    jh = Buffer.alloc(8),
    bh = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  jh.writeUInt32LE(json.length);
  jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bin.length);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, json, bh, bin]);
}
export async function buildModel(scene, out) {
  await mkdir(out, { recursive: true });
  const data = makeGlb(scene);
  await writeFile(join(out, 'building.glb'), data);
  await writeFile(join(out, 'scene.json'), JSON.stringify(scene, null, 2) + '\n');
  return { sceneId: scene.sceneId, geometryHash: digest(scene), bytes: data.length };
}
