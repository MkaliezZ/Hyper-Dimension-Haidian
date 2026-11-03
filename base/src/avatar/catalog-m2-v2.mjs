import { problem } from '../platform/db.mjs';
import {
  parts as originalParts,
  skins,
  incompatible as originalIncompatible,
  defaultRecipe as originalRecipe,
  presets as originalPresets,
} from './catalog-m2.mjs';
export { skins };
export const CATALOG = 'campus-original-2',
  SKELETON = 'campus-humanoid-1',
  GENERATOR = 'campus-rig-2.0.0';
const additions = {
  hair: [
    ['hair-braids', '双辫'],
    ['hair-bun', '高丸子头'],
    ['hair-long', '披肩长发'],
  ],
  top: [
    ['top-polo', '翻领短袖'],
    ['top-cardigan', '开衫'],
    ['top-vest', '衬衫针织背心'],
  ],
  bottom: [
    ['bottom-jeans', '牛仔长裤'],
    ['bottom-cargo', '工装长裤'],
    ['bottom-culottes', '宽腿裙裤'],
  ],
  shoes: [['shoes-boots', '圆头短靴']],
  glasses: [['glasses-oval', '椭圆金属眼镜']],
  accessory: [
    ['accessory-headphones', '头戴耳机'],
    ['accessory-backpack', '校园双肩包'],
    ['accessory-bow', '发侧蝴蝶结'],
  ],
};
export const parts = [
  ...originalParts.map((p) => ({ ...p })),
  ...Object.entries(additions).flatMap(([slot, items]) =>
    items.map(([id, label]) => ({ id, label, slot })),
  ),
].map((p) => ({
  ...p,
  skeleton: SKELETON,
  license: 'MIT',
  author: 'Hyper Dimension Base',
  source: 'original procedural geometry',
  version: 2,
  asset: '/avatar-library/v2/parts/' + p.id + '.glb',
}));
export const incompatible = [
  ...originalIncompatible,
  ['hair-bun', 'accessory-cap', '丸子头与帽顶重叠，请更换发型或配饰。'],
  ['hair-bun', 'accessory-headphones', '丸子头与耳机头梁重叠，请更换发型或配饰。'],
  ['hair-curly', 'accessory-headphones', '蓬松卷发与耳机头梁重叠，请更换发型或配饰。'],
  ['hair-long', 'accessory-backpack', '披肩长发与背包轮廓重叠，请更换发型或配饰。'],
  ['top-hoodie', 'accessory-backpack', '卫衣帽领与背包上沿重叠，请更换上装或配饰。'],
];
export const defaultRecipe = {
  ...structuredClone(originalRecipe),
  catalogVersion: CATALOG,
  generatorVersion: GENERATOR,
};
export const presets = originalPresets.map((p) => {
  const recipe = {
    ...structuredClone(p.recipe),
    catalogVersion: CATALOG,
    generatorVersion: GENERATOR,
  };
  if (p.id === 'library')
    Object.assign(recipe.parts, {
      hair: 'hair-long',
      top: 'top-cardigan',
      bottom: 'bottom-culottes',
      glasses: 'glasses-oval',
      accessory: 'accessory-bow',
    });
  if (p.id === 'sports')
    Object.assign(recipe.parts, {
      hair: 'hair-braids',
      top: 'top-polo',
      bottom: 'bottom-shorts',
      accessory: 'accessory-headphones',
    });
  if (p.id === 'creative')
    Object.assign(recipe.parts, {
      hair: 'hair-bun',
      top: 'top-vest',
      bottom: 'bottom-cargo',
      shoes: 'shoes-boots',
      accessory: 'accessory-backpack',
    });
  return { ...p, recipe, asset: '/avatar-library/v2/presets/' + p.id + '.glb' };
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
