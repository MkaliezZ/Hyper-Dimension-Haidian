import {PIXEL_FRAME} from './pixel-avatar-v3.js';
// Display scale is separate from the signed avatar recipe and renderer hash.
export const AVATAR_MAP_SCALE=.595;
export function avatarScale(zoom,stage=2){return Math.max(.75,Math.min(2,zoom))*stage*AVATAR_MAP_SCALE/PIXEL_FRAME.sourcePixelRatio;}

export function labelAwayFromAvatar(x,y,w,h,actor,viewportHeight){
  if(!actor)return {x,y,moved:false};
  const overlaps=x+w/2>actor.left-5&&x-w/2<actor.right+5&&y-h*1.1<actor.bottom+5&&y-h*.1>actor.top-5;
  if(!overlaps)return {x,y,moved:false};
  const below=actor.bottom+8+h*1.1;
  if(below<viewportHeight-8)return {x,y:below,moved:true};
  return {x:actor.left-8-w/2,y,moved:true};
}
