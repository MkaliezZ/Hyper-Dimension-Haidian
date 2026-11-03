import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {baseRoot,projectRoot,protocol} from './base.mjs';

const original=await import(pathToFileURL(join(baseRoot,'src/avatar/catalog-m2-v2.mjs')).href);
const version='uw-visitors-6',generator='uw-pixel-3.0.0';
const historical=async file=>protocol.digest(await readFile(join(projectRoot,'compat/3d-v052/public',file),'utf8'));
const legacy={version:'uw-visitors-1',generator:'uw-studio-1.0.0',rendererHash:await historical('visitor-model-v1.js')};
const paper={version:'uw-visitors-2',generator:'uw-paper-2.0.0',rendererHash:await historical('visitor-paper-model.js')};
const rounded={version:'uw-visitors-3',generator:'uw-campus-3.0.0',rendererHash:await historical('visitor-chibi-model.js')};
const adapt=(r,v=version,g=generator)=>({...structuredClone(r),catalogVersion:v,generatorVersion:g});
const rasterSource=await readFile(join(projectRoot,'public/pixel-raster.js'),'utf8');
const pixel={version:'uw-visitors-4',generator:'uw-pixel-1.0.0',rendererHash:protocol.digest({avatar:await readFile(join(projectRoot,'public/pixel-avatar.js'),'utf8'),raster:rasterSource})};
const detailed={version:'uw-visitors-5',generator:'uw-pixel-2.0.0',rendererHash:protocol.digest({avatar:await readFile(join(projectRoot,'public/pixel-avatar-v2.js'),'utf8'),raster:rasterSource})};
const rendererHash=protocol.digest({avatar:await readFile(join(projectRoot,'public/pixel-avatar-v3.js'),'utf8'),raster:rasterSource});
const versions=[{version,generator,rendererHash},detailed,pixel,rounded,paper,legacy];
export const visitorCatalog={
  version,generator,rendererHash,skeletonVersion:original.SKELETON,
  defaultRecipe:adapt(original.defaultRecipe),skins:original.skins,
  parts:original.parts.map(({id,slot,label})=>({id,slot,label})),
  incompatible:original.incompatible,
  presets:original.presets.map(({id,label,recipe})=>({id,label,recipe:adapt(recipe)})),
  author:'Hyper Campus · original UW school procedural artwork',license:'MIT',
  scope:'signed-browser-visitor',style:'soft-eight-view-pixel',styleLabel:'柔和八向像素',frame:{width:48,height:64,sourcePixelRatio:2,directions:8},legacy,previous:paper,rounded,pixel,detailed,versions,
};
Object.assign(visitorCatalog.defaultRecipe.colors,{top:'#8b79b3',bottom:'#556780',hair:'#51414b',shoes:'#eee7dc'});
const presetColors={everyday:{top:'#8270a5',bottom:'#556480',hair:'#55454a',shoes:'#eee7dc'},library:{top:'#c2957b',bottom:'#708580',hair:'#624c50',shoes:'#e5dac8'},sports:{top:'#7b9d8b',bottom:'#65778b',hair:'#5c4547',shoes:'#eee7dc'},creative:{top:'#8c7e9b',bottom:'#5e6c81',hair:'#4f3f49',shoes:'#d6bda7'}};
for(const p of visitorCatalog.presets)Object.assign(p.recipe.colors,presetColors[p.id]||presetColors.everyday);
visitorCatalog.hash=protocol.digest(visitorCatalog);
export function validateVisitorRecipe(input){
  const selected=versions.find(v=>v.version===input?.catalogVersion&&v.generator===input?.generatorVersion);
  if(!selected)
    protocol.fail('avatar_version','人物素材版本不匹配，请刷新后重试。',409);
  try{return adapt(original.validateM2({...input,catalogVersion:original.CATALOG,generatorVersion:original.GENERATOR}),selected.version,selected.generator);}
  catch(e){protocol.fail('avatar_recipe',e.code==='avatar_incompatible_parts'?'这些部件有穿插，请更换发型或配饰。':'人物搭配无效，请从当前素材目录选择。',400);}
}
export function createVisitorAvatars(store,spaceId){
  const key=p=>protocol.digest([p.id,spaceId]);
  const read=p=>{protocol.authorize(p,spaceId);return store.read().uwVisitorAvatars?.[key(p)]||null;};
  const history=p=>{protocol.authorize(p,spaceId);return store.read().uwVisitorAvatarHistory?.[key(p)]||[];};
  // Presentation is a read-only new-style projection; it never rewrites saved recipes/receipts.
  const presentation=p=>{const saved=read(p);if(!saved)return null;const recipe=adapt(saved.recipe);return {...saved,recipe,rendererHash,modelHash:protocol.digest({recipe,rendererHash}),savedModelHash:saved.modelHash,previewOnly:saved.recipe.generatorVersion!==generator};};
  return {read,history,presentation,async save(principal,input){
    protocol.authorize(principal,spaceId);
    protocol.fields(input,['requestId','expectedRevision','displayName','recipe'],'visitor avatar');
    protocol.identifier(input.requestId);
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)protocol.fail('avatar_revision','存档版本无效。',400);
    if(typeof input.displayName!=='string'||!input.displayName.trim()||input.displayName.trim().length>32||/[\x00-\x1f\x7f]/.test(input.displayName))protocol.fail('avatar_name','请输入 1–32 字的访客称呼。',400);
    const recipe=validateVisitorRecipe(input.recipe);
    return store.command(principal,spaceId,input.requestId,input,d=>{
      const previous=d.uwVisitorAvatars?.[key(principal)];
      if((previous?.revision||0)!==input.expectedRevision)protocol.fail('avatar_conflict','形象已在另一页面修改，请重新载入后再保存。',409);
      const activeRendererHash=versions.find(v=>v.generator===recipe.generatorVersion).rendererHash;
      const saved={displayName:input.displayName.trim(),recipe,revision:(previous?.revision||0)+1,
        modelHash:protocol.digest({recipe,rendererHash:activeRendererHash}),rendererHash:activeRendererHash,catalogHash:visitorCatalog.hash,updatedAt:new Date().toISOString()};
      if(previous){d.uwVisitorAvatarHistory||={};d.uwVisitorAvatarHistory[key(principal)]||=[];d.uwVisitorAvatarHistory[key(principal)].push(structuredClone(previous));}
      d.uwVisitorAvatars||={};d.uwVisitorAvatars[key(principal)]=saved;return saved;
    });
  }};
}
