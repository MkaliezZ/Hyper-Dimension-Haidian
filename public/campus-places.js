// Derived public-place catalog. GIS geometry and existing landmark IDs stay intact.
import {PLACE_COPY} from './place-copy.js';
export function campusPlaces(campus){
  const landmarks=campus.landmarks||[],known=new Set(landmarks.map(p=>p.buildingId).filter(Boolean));
  return [...landmarks.map(p=>({...p,...(PLACE_COPY[p.id]?{description:PLACE_COPY[p.id]}:{})})),...(campus.buildings||[]).filter(b=>!known.has(b.id)).map(b=>({
    id:b.id,buildingId:b.id,name:b.name||'校园建筑 · '+b.sourceObjectId,nameZh:b.code||'',
    category:'building',subtitle:'校园地点 · '+(b.code||b.sourceObjectId),
    description:'在这里留下你的校园记忆、查看社区活动，或通过接待了解已发布的校园资料。',
    point:[b.centroid[0],b.baseY,b.centroid[1]],sourceIds:[b.labelSource||'seattle-outlines','campus-map'],
  }))];
}
