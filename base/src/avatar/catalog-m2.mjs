import { problem } from '../platform/db.mjs';
import { validateRecipe as validateLegacy } from './model.mjs';
export const CATALOG = 'campus-original-1',
  SKELETON = 'campus-humanoid-1',
  GENERATOR = 'campus-rig-1.0.0';
const group = (slot, items) =>
  items.map(([id, label]) => ({
    id,
    slot,
    label,
    skeleton: SKELETON,
    license: 'MIT',
    author: 'Hyper Dimension Base',
    source: 'original procedural geometry',
    version: 1,
    asset: '/avatar-library/parts/' + id + '.glb',
  }));
export const parts = [
  ...group('body', [
    ['body-regular', '标准体型'],
    ['body-slim', '纤细体型'],
    ['body-athletic', '运动体型'],
  ]),
  ...group('hair', [
    ['hair-short', '清爽短发'],
    ['hair-sidepart', '侧分短发'],
    ['hair-bob', '齐耳短发'],
    ['hair-ponytail', '马尾'],
    ['hair-curly', '蓬松卷发'],
  ]),
  ...group('top', [
    ['top-tee', '校园短袖'],
    ['top-varsity', '学院夹克'],
    ['top-hoodie', '连帽卫衣'],
  ]),
  ...group('bottom', [
    ['bottom-trousers', '直筒长裤'],
    ['bottom-skirt', '百褶裙'],
    ['bottom-shorts', '休闲短裤'],
  ]),
  ...group('shoes', [
    ['shoes-sneakers', '低帮运动鞋'],
    ['shoes-high', '高帮运动鞋'],
    ['shoes-loafers', '乐福鞋'],
  ]),
  ...group('glasses', [
    ['glasses-none', '不戴眼镜'],
    ['glasses-round', '圆框眼镜'],
    ['glasses-square', '方框眼镜'],
  ]),
  ...group('accessory', [
    ['accessory-none', '不加配饰'],
    ['accessory-satchel', '校园挎包'],
    ['accessory-scarf', '围巾'],
    ['accessory-cap', '棒球帽'],
  ]),
];
export const incompatible = [
  ['hair-curly', 'accessory-cap', '卷发与帽子的轮廓重叠，请选择其他发型或配饰。'],
  ['top-hoodie', 'accessory-scarf', '围巾与卫衣帽领重叠，请更换其中一项。'],
];
export const skins = {
  porcelain: '#f2d0b4',
  light: '#deb38d',
  warm: '#bd8965',
  tan: '#9c674c',
  deep: '#754831',
  ebony: '#4d3026',
};
export const defaultRecipe = {
  schema: 'hyper-dimension.avatar/v2',
  catalogVersion: CATALOG,
  skeletonVersion: SKELETON,
  generatorVersion: GENERATOR,
  height: 'standard',
  presentation: 'neutral',
  skin: 'warm',
  parts: {
    body: 'body-regular',
    hair: 'hair-sidepart',
    top: 'top-varsity',
    bottom: 'bottom-trousers',
    shoes: 'shoes-sneakers',
    glasses: 'glasses-none',
    accessory: 'accessory-satchel',
  },
  colors: { hair: '#332b29', top: '#347b70', bottom: '#354653', shoes: '#f4eee0' },
};
export const presets = [
  ['campus', '校园日常', {}],
  [
    'library',
    '图书馆的一天',
    {
      hair: 'hair-bob',
      top: 'top-hoodie',
      bottom: 'bottom-skirt',
      glasses: 'glasses-round',
      accessory: 'accessory-none',
    },
  ],
  [
    'sports',
    '校园轻运动',
    {
      hair: 'hair-short',
      top: 'top-tee',
      bottom: 'bottom-shorts',
      shoes: 'shoes-high',
      accessory: 'accessory-cap',
    },
  ],
  [
    'creative',
    '创作与社团',
    {
      hair: 'hair-curly',
      top: 'top-varsity',
      bottom: 'bottom-trousers',
      glasses: 'glasses-square',
      accessory: 'accessory-none',
    },
  ],
].map(([id, label, changes]) => {
  const recipe = structuredClone(defaultRecipe);
  Object.assign(recipe.parts, changes);
  if (id === 'library') {
    recipe.presentation = 'soft';
    recipe.colors.top = '#b7775e';
  }
  if (id === 'creative') {
    recipe.skin = 'deep';
    recipe.colors.top = '#6c6792';
  }
  return { id, label, recipe, asset: '/avatar-library/presets/' + id + '.glb' };
});
const keys = (o, w) =>
  o &&
  typeof o === 'object' &&
  !Array.isArray(o) &&
  Object.keys(o).length === w.length &&
  w.every((k) => Object.hasOwn(o, k));
export function validateM2(r) {
  if (!keys(r, Object.keys(defaultRecipe))) throw problem('avatar_recipe_fields_invalid');
  if (
    r.schema !== defaultRecipe.schema ||
    r.catalogVersion !== CATALOG ||
    r.skeletonVersion !== SKELETON ||
    r.generatorVersion !== GENERATOR
  )
    throw problem('avatar_catalog_migration_required', 409);
  if (
    !['short', 'standard', 'tall'].includes(r.height) ||
    !['neutral', 'soft', 'angular'].includes(r.presentation) ||
    !Object.hasOwn(skins, r.skin)
  )
    throw problem('avatar_shape_invalid');
  if (
    !keys(r.parts, Object.keys(defaultRecipe.parts)) ||
    !keys(r.colors, Object.keys(defaultRecipe.colors))
  )
    throw problem('avatar_parts_invalid');
  for (const [slot, id] of Object.entries(r.parts))
    if (!parts.some((p) => p.slot === slot && p.id === id))
      throw problem('avatar_part_unavailable_' + slot, 409);
  for (const value of Object.values(r.colors))
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))
      throw problem('avatar_color_invalid');
  for (const [a, b] of incompatible)
    if (Object.values(r.parts).includes(a) && Object.values(r.parts).includes(b))
      throw problem('avatar_incompatible_parts', 409);
  return {
    ...defaultRecipe,
    height: r.height,
    presentation: r.presentation,
    skin: r.skin,
    parts: Object.fromEntries(Object.keys(defaultRecipe.parts).map((k) => [k, r.parts[k]])),
    colors: Object.fromEntries(
      Object.keys(defaultRecipe.colors).map((k) => [k, r.colors[k].toLowerCase()]),
    ),
  };
}
export function migrateLegacy(input) {
  const r = validateLegacy(input),
    p = structuredClone(defaultRecipe);
  p.height = r.body === 'compact' ? 'short' : 'standard';
  p.parts.hair = r.hair === 'bob' ? 'hair-bob' : 'hair-short';
  p.parts.top = r.top === 'jacket' ? 'top-varsity' : 'top-tee';
  p.parts.bottom = r.bottom === 'skirt' ? 'bottom-skirt' : 'bottom-trousers';
  p.parts.shoes = r.shoes === 'boots' ? 'shoes-high' : 'shoes-sneakers';
  p.parts.glasses = r.glasses === 'round' ? 'glasses-round' : 'glasses-none';
  p.parts.accessory = r.accessory === 'satchel' ? 'accessory-satchel' : 'accessory-none';
  p.skin = { warm: 'warm', deep: 'deep', light: 'light' }[r.skin];
  p.colors.top = { teal: '#347b70', indigo: '#515c97', ochre: '#c48135' }[r.palette];
  return validateM2(p);
}
