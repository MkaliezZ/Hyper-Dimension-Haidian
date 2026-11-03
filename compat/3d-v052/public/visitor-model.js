import {buildVisitorModel as buildLegacyVisitor} from './visitor-model-v1.js';
import {buildPaperVisitor} from './visitor-paper-model.js';
import {buildChibiVisitor} from './visitor-chibi-model.js';

// Preserve the original renderer for already-saved recipes; upgrades require an explicit save.
export function buildVisitorModel(T,recipe,skins){
  if(recipe.generatorVersion==='uw-studio-1.0.0')return buildLegacyVisitor(T,recipe,skins);
  if(recipe.generatorVersion==='uw-paper-2.0.0')return buildPaperVisitor(T,recipe,skins);
  if(recipe.generatorVersion==='uw-campus-3.0.0')return buildChibiVisitor(T,recipe,skins);
  throw Error('Unsupported UW visitor renderer version');
}
