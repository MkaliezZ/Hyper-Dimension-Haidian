import { createHash } from 'node:crypto';
import { problem } from '../platform/db.mjs';
export const catalog = {
  version: 'm0-original-1',
  license: 'MIT',
  author: 'Hyper Dimension Base',
  body: ['standard', 'compact'],
  hair: ['short', 'bob'],
  top: ['jacket', 'shirt'],
  bottom: ['trousers', 'skirt'],
  shoes: ['sneakers', 'boots'],
  glasses: ['none', 'round'],
  accessory: ['none', 'satchel'],
  skin: ['warm', 'deep', 'light'],
  palette: ['teal', 'indigo', 'ochre'],
};
export const defaultRecipe = {
  schema: 'hyper-dimension.avatar/v1',
  catalog: catalog.version,
  body: 'standard',
  hair: 'short',
  top: 'jacket',
  bottom: 'trousers',
  shoes: 'sneakers',
  glasses: 'none',
  accessory: 'none',
  skin: 'warm',
  palette: 'teal',
};
export function validateRecipe(r) {
  if (!r || r.schema !== defaultRecipe.schema || r.catalog !== catalog.version)
    throw problem('avatar_catalog_migration_required', 409);
  if (Object.keys(r).some((k) => !Object.hasOwn(defaultRecipe, k)))
    throw problem('avatar_unknown_field');
  for (const [k, values] of Object.entries(catalog))
    if (Array.isArray(values) && !values.includes(r[k])) throw problem('avatar_invalid_' + k);
  return Object.fromEntries(Object.keys(defaultRecipe).map((k) => [k, r[k]]));
}
// Original deterministic glTF 2.0 fixture with articulated nodes and walk/wave clips.
// These technical samples demonstrate the pipeline, not the M2 final art library.
export function avatarGlb(input) {
  const r = validateRecipe(input),
    chunks = [],
    views = [],
    accessors = [];
  let offset = 0;
  const data = (array, type, componentType, min, max) => {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength),
      pad = (4 - (bytes.length % 4)) % 4;
    const view = views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }) - 1;
    chunks.push(bytes, Buffer.alloc(pad));
    offset += bytes.length + pad;
    return (
      accessors.push({
        bufferView: view,
        componentType,
        count: array.length / { SCALAR: 1, VEC3: 3, VEC4: 4 }[type],
        type,
        ...(min ? { min, max } : {}),
      }) - 1
    );
  };
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
  for (const [n, ps] of faces) {
    const start = vertices.length / 3;
    for (const p of ps) {
      vertices.push(...p);
      normals.push(...n);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const pos = data(new Float32Array(vertices), 'VEC3', 5126, [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]),
    normal = data(new Float32Array(normals), 'VEC3', 5126),
    index = data(new Uint16Array(indices), 'SCALAR', 5123);
  const skin = {
      warm: [0.73, 0.48, 0.32, 1],
      deep: [0.32, 0.18, 0.12, 1],
      light: [0.92, 0.72, 0.57, 1],
    }[r.skin],
    coat = {
      teal: [0.08, 0.39, 0.35, 1],
      indigo: [0.22, 0.27, 0.55, 1],
      ochre: [0.78, 0.43, 0.12, 1],
    }[r.palette];
  const colors = [
    skin,
    coat,
    [0.12, 0.18, 0.22, 1],
    [0.06, 0.055, 0.05, 1],
    [0.95, 0.92, 0.83, 1],
    [0.65, 0.39, 0.16, 1],
  ];
  const materials = colors.map((c) => ({
    pbrMetallicRoughness: { baseColorFactor: c, metallicFactor: 0, roughnessFactor: 0.82 },
  }));
  const meshes = colors.map((_, i) => ({
    primitives: [{ attributes: { POSITION: pos, NORMAL: normal }, indices: index, material: i }],
  }));
  const nodes = [
    {
      name: 'AvatarRoot',
      children: [],
      extras: { recipe: r, assetLicense: 'MIT', catalogVersion: catalog.version },
    },
  ];
  function group(parent, name, t) {
    const i = nodes.push({ name, translation: t, children: [] }) - 1;
    nodes[parent].children.push(i);
    return i;
  }
  function box(parent, name, t, s, material) {
    const i = nodes.push({ name, translation: t, scale: s, mesh: material }) - 1;
    nodes[parent].children.push(i);
    return i;
  }
  const height = r.body === 'compact' ? 0.88 : 1,
    root = group(0, 'Body', [0, 0, 0]);
  nodes[root].scale = [1, height, 1];
  box(root, 'Torso', [0, 1.04, 0], [0.49, 0.53, 0.27], 1);
  if (r.top === 'jacket') {
    box(root, 'Zip', [0, 1.04, 0.142], [0.025, 0.46, 0.012], 4);
    box(root, 'Collar', [0, 1.28, 0.055], [0.27, 0.07, 0.25], 4);
  }
  const head = group(root, 'Head', [0, 1.48, 0]);
  box(head, 'Face', [0, 0, 0], [0.36, 0.37, 0.33], 0);
  box(head, 'HairTop', [0, 0.19, -0.015], [0.395, 0.14, 0.37], 3);
  if (r.hair === 'bob') {
    box(head, 'HairBack', [0, -0.005, -0.18], [0.41, 0.38, 0.11], 3);
    for (const x of [-0.2, 0.2]) box(head, 'HairSide', [x, -0.005, 0], [0.075, 0.35, 0.31], 3);
  }
  for (const x of [-0.09, 0.09]) box(head, 'Eye', [x, 0.02, 0.17], [0.035, 0.045, 0.018], 3);
  box(head, 'Smile', [0, -0.09, 0.173], [0.07, 0.016, 0.012], 5);
  if (r.glasses === 'round') {
    for (const x of [-0.09, 0.09]) box(head, 'Glasses', [x, 0.025, 0.19], [0.14, 0.1, 0.016], 2);
    box(head, 'Bridge', [0, 0.03, 0.19], [0.045, 0.025, 0.018], 2);
  }
  const arms = [];
  for (const x of [-0.32, 0.32]) {
    const a = group(root, x < 0 ? 'LeftArm' : 'RightArm', [x, 1.23, 0]);
    arms.push(a);
    box(a, 'Sleeve', [0, -0.18, 0], [0.16, 0.35, 0.21], 1);
    box(a, 'Hand', [0, -0.43, 0], [0.14, 0.16, 0.18], 0);
  }
  const legs = [];
  for (const x of [-0.14, 0.14]) {
    const l = group(root, x < 0 ? 'LeftLeg' : 'RightLeg', [x, 0.79, 0]);
    legs.push(l);
    box(l, 'Leg', [0, -0.29, 0], [0.21, 0.58, 0.24], 2);
    box(
      l,
      'Shoe',
      [0, -0.67, 0.055],
      [0.235, r.shoes === 'boots' ? 0.25 : 0.14, 0.37],
      r.shoes === 'boots' ? 5 : 4,
    );
  }
  if (r.bottom === 'skirt') box(root, 'Skirt', [0, 0.72, 0], [0.57, 0.23, 0.33], 1);
  if (r.accessory === 'satchel') {
    box(root, 'Bag', [0.34, 0.85, -0.045], [0.2, 0.29, 0.31], 5);
    box(root, 'Strap', [0.27, 1.12, 0], [0.035, 0.6, 0.32], 5);
  }
  const times = data(new Float32Array([0, 0.5, 1]), 'SCALAR', 5126, [0], [1]);
  const animations = [];
  function clip(name, limbs, angle) {
    const samplers = [],
      channels = [];
    for (const [n, sign] of limbs) {
      const q = [];
      for (const a of [0, angle * sign, 0]) q.push(Math.sin(a / 2), 0, 0, Math.cos(a / 2));
      const output = data(new Float32Array(q), 'VEC4', 5126);
      const sampler = samplers.push({ input: times, output, interpolation: 'LINEAR' }) - 1;
      channels.push({ sampler, target: { node: n, path: 'rotation' } });
    }
    animations.push({ name, samplers, channels });
  }
  clip(
    'Walk',
    [
      [legs[0], 1],
      [legs[1], -1],
      [arms[0], -1],
      [arms[1], 1],
    ],
    0.65,
  );
  clip('Wave', [[arms[1], 1]], -2.1);
  const gltf = {
    asset: { version: '2.0', generator: 'Hyper Dimension original M0 avatar' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    materials,
    meshes,
    animations,
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors,
  };
  const j = Buffer.from(JSON.stringify(gltf));
  const jp = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 32)]),
    bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jp.length + 8 + bin.length, 8);
  const chunkHeader = (length, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(length);
    b.writeUInt32LE(type, 4);
    return b;
  };
  return Buffer.concat([
    header,
    chunkHeader(jp.length, 0x4e4f534a),
    jp,
    chunkHeader(bin.length, 0x004e4942),
    bin,
  ]);
}
export const modelHash = (r) => createHash('sha256').update(avatarGlb(r)).digest('hex');
