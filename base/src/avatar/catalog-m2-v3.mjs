import * as prior from './catalog-m2-v2.mjs';
import { problem } from '../platform/db.mjs';
export const CATALOG = 'campus-rewards-3',
  SKELETON = prior.SKELETON,
  GENERATOR = 'campus-rig-3.0.0';
export const REWARD_PART = 'accessory-community-ribbon',
  REWARD_ITEM = 'appearance:community-ribbon';
export const skins = prior.skins,
  incompatible = prior.incompatible;
export const parts = [
  ...prior.parts,
  {
    id: REWARD_PART,
    label: '校园贡献绶带',
    slot: 'accessory',
    skeleton: SKELETON,
    license: 'MIT',
    author: 'Hyper Dimension Base',
    source: 'original procedural geometry',
    version: 3,
    asset: '/avatar-library/v3/parts/' + REWARD_PART + '.glb',
    requiredItem: REWARD_ITEM,
  },
];
export const defaultRecipe = {
  ...structuredClone(prior.defaultRecipe),
  catalogVersion: CATALOG,
  generatorVersion: GENERATOR,
};
export const presets = prior.presets.map((p) => ({
  ...p,
  asset: '/avatar-library/v3/presets/' + p.id + '.glb',
  recipe: { ...structuredClone(p.recipe), catalogVersion: CATALOG, generatorVersion: GENERATOR },
}));
export function validateM2(input) {
  const adapted = structuredClone(input);
  const ribbon = adapted?.parts?.accessory === REWARD_PART;
  if (adapted?.catalogVersion !== CATALOG || adapted?.generatorVersion !== GENERATOR)
    throw problem('avatar_catalog_migration_required', 409);
  adapted.catalogVersion = prior.CATALOG;
  adapted.generatorVersion = prior.GENERATOR;
  if (ribbon) adapted.parts.accessory = 'accessory-none';
  const normalized = prior.validateM2(adapted);
  normalized.catalogVersion = CATALOG;
  normalized.generatorVersion = GENERATOR;
  if (ribbon) normalized.parts.accessory = REWARD_PART;
  return normalized;
}
