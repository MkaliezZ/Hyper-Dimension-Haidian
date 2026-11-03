import * as T from 'three';
import { createHash } from 'node:crypto';
import {
  CATALOG,
  SKELETON,
  GENERATOR,
  parts,
  skins,
  incompatible,
  defaultRecipe,
  validateM2,
  presets,
} from './catalog-m2.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
export function buildAvatar(input, { onlyPart = null } = {}) {
  const r = validateM2(input),
    nodes = [
      {
        name: 'AvatarRoot',
        children: [],
        scale: [
          r.parts.body === 'body-slim' ? 0.91 : r.parts.body === 'body-athletic' ? 1.1 : 1,
          { short: 0.88, standard: 1, tall: 1.08 }[r.height],
          1,
        ],
        extras: { recipe: r, skeletonVersion: SKELETON, catalogVersion: CATALOG, license: 'MIT' },
      },
    ],
    bones = {},
    batches = new Map(),
    materials = [],
    matIndices = new Map();
  const bone = (name, parent, t) => {
    const i = nodes.push({ name, translation: t, children: [] }) - 1;
    nodes[parent].children.push(i);
    bones[name] = i;
    return i;
  };
  const hips = bone('hips', 0, [0, 0.88, 0]),
    spine = bone('spine', hips, [0, 0.19, 0]),
    chest = bone('chest', spine, [0, 0.2, 0]),
    neck = bone('neck', chest, [0, 0.18, 0]),
    head = bone('head', neck, [0, 0.18, 0]);
  for (const [side, sign] of [
    ['left', 1],
    ['right', -1],
  ]) {
    const shoulder = bone(side + 'Shoulder', chest, [sign * 0.2, 0.08, 0]),
      upper = bone(side + 'UpperArm', shoulder, [sign * 0.07, 0, 0]),
      lower = bone(side + 'LowerArm', upper, [sign * 0.28, 0, 0]);
    bone(side + 'Hand', lower, [sign * 0.25, 0, 0]);
    const leg = bone(side + 'UpperLeg', hips, [sign * 0.12, -0.03, 0]),
      knee = bone(side + 'LowerLeg', leg, [0, -0.38, 0]),
      foot = bone(side + 'Foot', knee, [0, -0.37, 0]);
    bone(side + 'Toes', foot, [0, -0.02, 0.13]);
  }
  const material = (color) => {
    if (matIndices.has(color)) return matIndices.get(color);
    const c = new T.Color(color),
      i =
        materials.push({
          name: color,
          pbrMetallicRoughness: {
            baseColorFactor: [c.r, c.g, c.b, 1],
            metallicFactor: 0,
            roughnessFactor: 0.78,
          },
        }) - 1;
    matIndices.set(color, i);
    return i;
  };
  function mesh(parent, geo, pos, scale, color, rotation = [0, 0, 0]) {
    const mi = material(color),
      key = parent + ':' + mi,
      b = batches.get(key) || { parent, material: mi, p: [], n: [], i: [] };
    batches.set(key, b);
    const matrix = new T.Matrix4().compose(
        new T.Vector3(...pos),
        new T.Quaternion().setFromEuler(new T.Euler(...rotation)),
        new T.Vector3(...scale),
      ),
      normal = new T.Matrix3().getNormalMatrix(matrix),
      start = b.p.length / 3;
    const p = geo.getAttribute('position'),
      n = geo.getAttribute('normal'),
      v = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      b.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(normal).normalize();
      b.n.push(v.x, v.y, v.z);
    }
    if (geo.index) for (const i of geo.index.array) b.i.push(start + i);
    else for (let i = 0; i < p.count; i++) b.i.push(start + i);
    geo.dispose();
  }
  const ell = (b, p, s, c) => mesh(b, new T.SphereGeometry(1, 14, 10), p, s, c);
  const box = (b, p, s, c) => mesh(b, new T.BoxGeometry(1, 1, 1), p, s, c);
  const tube = (b, p, s, c, rot = [0, 0, 0]) =>
    mesh(b, new T.CapsuleGeometry(0.5, 1, 4, 10), p, s, c, rot);
  const selected = (id) => !onlyPart || onlyPart === id;
  if (!onlyPart || onlyPart.startsWith('body-')) {
    const skin = skins[r.skin];
    ell(hips, [0, 0.03, 0], [0.205, 0.14, 0.135], skin);
    ell(chest, [0, -0.07, 0], [0.2, 0.25, 0.12], skin);
    ell(neck, [0, 0.01, 0], [0.075, 0.1, 0.075], skin);
    ell(
      head,
      [0, 0, 0],
      [
        r.presentation === 'angular' ? 0.173 : 0.18,
        r.presentation === 'soft' ? 0.215 : 0.225,
        r.presentation === 'angular' ? 0.165 : 0.18,
      ],
      skin,
    );
    for (const sign of [-1, 1]) {
      ell(head, [sign * 0.178, -0.015, -0.008], [0.037, 0.059, 0.035], skin);
      ell(head, [sign * 0.079, 0.025, 0.158], [0.04, 0.052, 0.027], '#fffdf5');
      ell(head, [sign * 0.079, 0.023, 0.18], [0.02, 0.03, 0.009], '#292a31');
      ell(head, [sign * 0.072, 0.036, 0.189], [0.007, 0.009, 0.004], '#ffffff');
      tube(head, [sign * 0.077, 0.099, 0.166], [0.014, 0.051, 0.013], r.colors.hair, [
        0,
        0,
        Math.PI / 2 + sign * 0.12,
      ]);
    }
    ell(head, [0, -0.028, 0.177], [0.021, 0.032, 0.022], skin);
    mesh(
      head,
      new T.TorusGeometry(0.043, 0.006, 5, 14, Math.PI),
      [0, -0.073, 0.177],
      [1, 0.65, 1],
      '#9f5549',
      [0, 0, Math.PI],
    );
    for (const [side, sign] of [
      ['left', 1],
      ['right', -1],
    ]) {
      tube(bones[side + 'UpperArm'], [sign * 0.14, 0, 0], [0.1, 0.16, 0.1], skin, [
        0,
        0,
        Math.PI / 2,
      ]);
      tube(bones[side + 'LowerArm'], [sign * 0.12, 0, 0], [0.085, 0.15, 0.085], skin, [
        0,
        0,
        Math.PI / 2,
      ]);
      ell(bones[side + 'Hand'], [sign * 0.045, 0, 0.005], [0.067, 0.04, 0.047], skin);
      tube(bones[side + 'UpperLeg'], [0, -0.19, 0], [0.14, 0.24, 0.14], skin);
      tube(bones[side + 'LowerLeg'], [0, -0.18, 0], [0.105, 0.24, 0.105], skin);
    }
  }
  if (selected(r.parts.hair)) {
    const c = r.colors.hair;
    mesh(
      head,
      new T.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.53),
      [0, 0.035, -0.012],
      [0.195, 0.232, 0.192],
      c,
    );
    ell(head, [-0.095, 0.14, 0.12], [0.09, 0.09, 0.075], c);
    if (r.parts.hair === 'hair-sidepart') ell(head, [0.075, 0.145, 0.14], [0.135, 0.08, 0.07], c);
    if (r.parts.hair === 'hair-bob') {
      ell(head, [0, -0.05, -0.15], [0.2, 0.24, 0.08], c);
      for (const sign of [-1, 1]) ell(head, [sign * 0.18, -0.06, -0.015], [0.055, 0.21, 0.13], c);
    }
    if (r.parts.hair === 'hair-ponytail') {
      ell(head, [0, 0.08, -0.22], [0.09, 0.11, 0.09], c);
      tube(head, [0, -0.15, -0.24], [0.11, 0.25, 0.12], c);
      ell(head, [0, 0.09, -0.2], [0.1, 0.027, 0.1], '#dc9f51');
    }
    if (r.parts.hair === 'hair-curly')
      for (let i = 0; i < 11; i++) {
        const t = (i * Math.PI * 2) / 11;
        ell(
          head,
          [Math.cos(t) * 0.15, 0.18 + Math.sin(t * 2) * 0.015, Math.sin(t) * 0.13],
          [0.085, 0.09, 0.085],
          c,
        );
      }
  }
  if (selected(r.parts.top)) {
    const c = r.colors.top,
      tee = r.parts.top === 'top-tee';
    ell(chest, [0, -0.075, 0], [0.225, 0.25, 0.15], c);
    mesh(chest, new T.TorusGeometry(0.077, 0.018, 6, 14), [0, 0.175, 0.0], [1, 1, 1], '#f4eee0', [
      Math.PI / 2,
      0,
      0,
    ]);
    for (const [side, sign] of [
      ['left', 1],
      ['right', -1],
    ]) {
      tube(
        bones[side + 'UpperArm'],
        [sign * (tee ? 0.085 : 0.13), 0, 0],
        [tee ? 0.135 : 0.13, tee ? 0.09 : 0.18, 0.14],
        c,
        [0, 0, Math.PI / 2],
      );
      if (!tee) {
        tube(bones[side + 'LowerArm'], [sign * 0.105, 0, 0], [0.11, 0.18, 0.12], c, [
          0,
          0,
          Math.PI / 2,
        ]);
        tube(bones[side + 'Hand'], [-sign * 0.02, 0, 0], [0.105, 0.025, 0.115], '#f4eee0', [
          0,
          0,
          Math.PI / 2,
        ]);
      }
    }
    if (r.parts.top === 'top-varsity') {
      box(chest, [0, -0.075, 0.149], [0.019, 0.41, 0.015], '#f6e6bd');
      for (const x of [-0.125, 0.125])
        box(chest, [x, -0.17, 0.133], [0.07, 0.025, 0.015], '#e8cd97');
      ell(chest, [-0.1, 0.05, 0.144], [0.035, 0.044, 0.011], '#e8cd97');
    }
    if (r.parts.top === 'top-hoodie') {
      ell(chest, [0, 0.14, -0.14], [0.17, 0.16, 0.09], c);
      for (const x of [-0.045, 0.045])
        tube(chest, [x, 0.07, 0.15], [0.012, 0.07, 0.012], '#f4eee0');
      ell(chest, [0, -0.18, 0.126], [0.12, 0.055, 0.033], c);
    }
  }
  if (selected(r.parts.bottom)) {
    const c = r.colors.bottom;
    ell(hips, [0, -0.025, 0], [0.22, 0.12, 0.15], c);
    if (r.parts.bottom === 'bottom-skirt')
      mesh(
        hips,
        new T.CylinderGeometry(0.205, 0.295, 0.29, 16, 1, false),
        [0, -0.135, 0],
        [1, 1, 1],
        c,
      );
    else
      for (const side of ['left', 'right']) {
        tube(
          bones[side + 'UpperLeg'],
          [0, -0.17, 0],
          [0.18, r.parts.bottom === 'bottom-shorts' ? 0.16 : 0.25, 0.18],
          c,
        );
        if (r.parts.bottom === 'bottom-trousers')
          tube(bones[side + 'LowerLeg'], [0, -0.17, 0], [0.145, 0.26, 0.15], c);
      }
  }
  if (selected(r.parts.shoes))
    for (const side of ['left', 'right']) {
      const foot = bones[side + 'Foot'],
        c = r.colors.shoes;
      ell(foot, [0, -0.016, 0.055], [0.105, 0.075, 0.17], c);
      box(foot, [0, -0.062, 0.06], [0.19, 0.035, 0.29], '#ded6c7');
      if (r.parts.shoes === 'shoes-high') tube(foot, [0, 0.055, -0.015], [0.15, 0.07, 0.15], c);
      if (r.parts.shoes !== 'shoes-loafers')
        for (const z of [0.015, 0.055, 0.095])
          box(foot, [0, 0.047, z], [0.09, 0.009, 0.012], '#7a8285');
      else box(foot, [0, 0.045, 0.06], [0.13, 0.013, 0.035], '#c09a58');
    }
  if (selected(r.parts.glasses) && r.parts.glasses !== 'glasses-none') {
    for (const sign of [-1, 1]) {
      if (r.parts.glasses === 'glasses-round')
        mesh(
          head,
          new T.TorusGeometry(0.061, 0.007, 5, 16),
          [sign * 0.078, 0.029, 0.19],
          [1, 0.83, 1],
          '#394049',
        );
      else {
        for (const y of [-0.021, 0.077])
          box(head, [sign * 0.078, y, 0.189], [0.12, 0.011, 0.012], '#394049');
        for (const x of [sign * 0.078 - 0.06, sign * 0.078 + 0.06])
          box(head, [x, 0.028, 0.189], [0.01, 0.1, 0.012], '#394049');
      }
    }
    box(head, [0, 0.03, 0.19], [0.04, 0.009, 0.01], '#394049');
  }
  if (selected(r.parts.accessory)) {
    const c = '#a57448';
    if (r.parts.accessory === 'accessory-satchel') {
      ell(chest, [0.25, -0.27, 0.0], [0.115, 0.14, 0.1], c);
      tube(chest, [0.05, -0.03, 0.147], [0.025, 0.3, 0.018], c, [0, 0, 0.67]);
      box(chest, [0.25, -0.26, 0.101], [0.06, 0.025, 0.015], '#e5bb73');
    }
    if (r.parts.accessory === 'accessory-scarf') {
      mesh(neck, new T.TorusGeometry(0.09, 0.027, 6, 16), [0, 0.015, 0], [1, 1, 1], '#cf9d4f', [
        Math.PI / 2,
        0,
        0,
      ]);
      tube(chest, [0.08, 0.06, 0.16], [0.065, 0.14, 0.025], '#cf9d4f');
    }
    if (r.parts.accessory === 'accessory-cap') {
      mesh(
        head,
        new T.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        [0, 0.14, -0.01],
        [0.208, 0.15, 0.2],
        r.colors.top,
      );
      ell(head, [0, 0.14, 0.18], [0.2, 0.022, 0.14], r.colors.top);
    }
  }
  const chunks = [],
    views = [],
    accessors = [];
  let offset = 0;
  const data = (array, type, componentType, min, max) => {
    const b = Buffer.from(array.buffer, array.byteOffset, array.byteLength),
      pad = (4 - (b.length % 4)) % 4,
      v = views.push({ buffer: 0, byteOffset: offset, byteLength: b.length }) - 1;
    chunks.push(b, Buffer.alloc(pad));
    offset += b.length + pad;
    return (
      accessors.push({
        bufferView: v,
        componentType,
        type,
        count: array.length / { SCALAR: 1, VEC3: 3, VEC4: 4 }[type],
        ...(min ? { min, max } : {}),
      }) - 1
    );
  };
  const meshes = [];
  let triangles = 0,
    vertices = 0;
  for (const b of batches.values()) {
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < b.p.length; i++) {
      const j = i % 3;
      min[j] = Math.min(min[j], b.p[i]);
      max[j] = Math.max(max[j], b.p[i]);
    }
    const p = data(new Float32Array(b.p), 'VEC3', 5126, min, max),
      n = data(new Float32Array(b.n), 'VEC3', 5126),
      ix = data(new Uint16Array(b.i), 'SCALAR', 5123);
    triangles += b.i.length / 3;
    vertices += b.p.length / 3;
    const mi =
        meshes.push({
          primitives: [
            { attributes: { POSITION: p, NORMAL: n }, indices: ix, material: b.material },
          ],
        }) - 1,
      ni = nodes.push({ name: 'PartMesh_' + mi, mesh: mi }) - 1;
    nodes[b.parent].children.push(ni);
  }
  const animations = [],
    times = data(new Float32Array([0, 0.25, 0.5, 0.75, 1]), 'SCALAR', 5126, [0], [1]);
  function clip(name, walk = false, wave = false) {
    const channels = [],
      samplers = [];
    for (const [side, sign] of [
      ['left', 1],
      ['right', -1],
    ])
      for (const limb of ['UpperArm', 'LowerArm', 'UpperLeg', 'LowerLeg']) {
        const qs = [];
        for (let i = 0; i < 5; i++) {
          const phase = (i * Math.PI) / 2,
            rest = limb === 'UpperArm' ? -sign * 1.32 : 0,
            x = walk
              ? limb === 'UpperLeg'
                ? Math.sin(phase) * 0.38 * sign
                : limb === 'LowerLeg'
                  ? Math.max(0, -Math.sin(phase) * sign) * 0.35
                  : limb === 'UpperArm'
                    ? -Math.sin(phase) * 0.32 * sign
                    : 0
              : 0,
            z =
              wave && side === 'right'
                ? limb === 'UpperArm'
                  ? -0.75
                  : limb === 'LowerArm'
                    ? -0.65 + Math.sin(phase) * 0.22
                    : rest
                : rest,
            q = new T.Quaternion().setFromEuler(new T.Euler(x, 0, z));
          qs.push(q.x, q.y, q.z, q.w);
        }
        const output = data(new Float32Array(qs), 'VEC4', 5126),
          si = samplers.push({ input: times, output, interpolation: 'LINEAR' }) - 1;
        channels.push({ sampler: si, target: { node: bones[side + limb], path: 'rotation' } });
      }
    animations.push({ name, channels, samplers });
  }
  clip('Idle');
  clip('Walk', true);
  clip('Wave', false, true);
  const gltf = {
    asset: { version: '2.0', generator: 'Hyper Dimension ' + GENERATOR },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    materials,
    animations,
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors,
    extensionsUsed: ['VRMC_vrm'],
    extensions: {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: {
          name: 'Campus Original',
          version: '1.0.0',
          authors: ['Hyper Dimension Base'],
          licenseUrl: 'https://vrm.dev/licenses/1.0/',
          avatarPermission: 'everyone',
          commercialUsage: 'corporation',
          creditNotation: 'unnecessary',
          allowRedistribution: true,
          modification: 'allowModificationRedistribution',
          otherLicenseUrl: 'https://opensource.org/licenses/MIT',
        },
        humanoid: {
          humanBones: Object.fromEntries(
            Object.entries(bones).map(([name, node]) => [name, { node }]),
          ),
        },
      },
    },
    extras: {
      catalogVersion: CATALOG,
      skeletonVersion: SKELETON,
      triangles,
      vertices,
      drawCalls: meshes.length,
      source: 'original procedural geometry; MIT',
      part: onlyPart,
    },
  };
  const json = Buffer.from(JSON.stringify(gltf)),
    jp = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]),
    bin = Buffer.concat(chunks),
    h = Buffer.alloc(12);
  h.writeUInt32LE(0x46546c67);
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(28 + jp.length + bin.length, 8);
  const chunk = (b, type) => {
    const x = Buffer.alloc(8);
    x.writeUInt32LE(b.length);
    x.writeUInt32LE(type, 4);
    return Buffer.concat([x, b]);
  };
  return Buffer.concat([h, chunk(jp, 0x4e4f534a), chunk(bin, 0x004e4942)]);
}
const cache = new Map();
export function avatarM2(r) {
  const valid = validateM2(r),
    key = JSON.stringify(valid);
  if (cache.has(key)) return cache.get(key);
  const b = buildAvatar(valid);
  if (cache.size >= 24) cache.delete(cache.keys().next().value);
  cache.set(key, b);
  return b;
}
export const avatarM2Hash = (r) => sha(avatarM2(r));
export function partM2(id) {
  const p = parts.find((p) => p.id === id);
  if (!p) throw Error('Unknown original part');
  const r = structuredClone(defaultRecipe);
  r.parts[p.slot] = id;
  if (id === 'accessory-cap') r.parts.hair = 'hair-short';
  if (id === 'accessory-scarf') r.parts.top = 'top-tee';
  return buildAvatar(r, { onlyPart: id });
}
let catalog;
export function catalogM2() {
  if (catalog) return catalog;
  const assets = parts.map((p) => {
    const bytes = partM2(p.id);
    return { ...p, bytes: bytes.length, sha256: sha(bytes), compatibleSkeletons: [SKELETON] };
  });
  const result = {
    schema: 'hyper-dimension.avatar-catalog/v1',
    version: CATALOG,
    skeletonVersion: SKELETON,
    generatorVersion: GENERATOR,
    license: 'MIT',
    parts: assets,
    skins,
    heights: ['short', 'standard', 'tall'],
    presentations: ['neutral', 'soft', 'angular'],
    incompatible,
    presets,
    budget: { maxTriangles: 22000, maxDrawCalls: 90, maxGlbBytes: 1600000 },
    defaultRecipe,
  };
  catalog = { ...result, catalogHash: sha(JSON.stringify(result)) };
  return catalog;
}
