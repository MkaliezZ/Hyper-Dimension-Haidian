import { problem } from '../platform/db.mjs';
import * as first from './model-m2.mjs';
import * as expanded from './model-m2-v2.mjs';
import * as rewarded from './model-m2-v3.mjs';
import { CATALOG as FIRST, validateM2 as validateFirst } from './catalog-m2.mjs';
import { CATALOG as EXPANDED, validateM2 as validateExpanded } from './catalog-m2-v2.mjs';
import { CATALOG as REWARDED, validateM2 as validateRewarded } from './catalog-m2-v3.mjs';
export const versions = [FIRST, EXPANDED, REWARDED];
function implementation(version = FIRST) {
  if (version === FIRST) return first;
  if (version === EXPANDED) return expanded;
  if (version === REWARDED) return rewarded;
  throw problem('avatar_catalog_migration_required', 409);
}
export const catalogM2 = (version = FIRST) => implementation(version).catalogM2();
export const avatarM2 = (recipe) => implementation(recipe?.catalogVersion).avatarM2(recipe);
export const avatarM2Hash = (recipe) => implementation(recipe?.catalogVersion).avatarM2Hash(recipe);
export const validateM2 = (recipe) => {
  implementation(recipe?.catalogVersion);
  return recipe?.catalogVersion === REWARDED
    ? validateRewarded(recipe)
    : recipe?.catalogVersion === EXPANDED
      ? validateExpanded(recipe)
      : validateFirst(recipe);
};
export const availableCatalogs = () =>
  versions.map((version) => {
    const catalog = catalogM2(version);
    return {
      version,
      label:
        version === FIRST
          ? '原版素材 · 24 部件'
          : version === EXPANDED
            ? '扩充素材 · 38 部件'
            : '奖励外观 · 39 部件（绶带需资格）',
      partCount: catalog.parts.length,
      catalogHash: catalog.catalogHash,
      skeletonVersion: catalog.skeletonVersion,
      generatorVersion: catalog.generatorVersion,
    };
  });
export function requireCatalogTransition(before, after, confirmation) {
  if (before.recipe.catalogVersion === after.catalogVersion) {
    if (confirmation !== undefined) throw problem('avatar_upgrade_not_required');
    return false;
  }
  if (!(
    (before.recipe.catalogVersion === FIRST && after.catalogVersion === EXPANDED) ||
    (before.recipe.catalogVersion === EXPANDED && after.catalogVersion === REWARDED)
  ))
    throw problem('avatar_catalog_transition_unsupported', 409);
  if (
    !confirmation ||
    typeof confirmation !== 'object' ||
    Array.isArray(confirmation) ||
    Object.keys(confirmation).length !== 3 ||
    confirmation.catalogVersion !== before.recipe.catalogVersion ||
    confirmation.catalogHash !== before.catalogHash ||
    confirmation.modelHash !== before.modelHash
  )
    throw problem('avatar_catalog_upgrade_confirmation_required', 409);
  return true;
}
