import {decodeSurfaceDepth} from './surface-depth.js';
import {surfaceSelection} from './surface-selection.js';
const image=url=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('场景素材载入失败：'+url));i.src=url;});
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').imageSmoothingEnabled=false;return c;};
export async function loadDepthScene(campus){
  const root='/assets/coherent/',response=await fetch(root+'manifest.json');if(!response.ok)throw Error('缺少统一场景清单。');const manifest=await response.json();
  if(manifest.geometryHash!==campus.geometryHash||manifest.buildingCount!==campus.buildings.length||manifest.objects.filter(o=>o.kind==='building').some(o=>o.sourceScale!==1||o.triangulationDeviation>1e-8))throw Error('场景比例或校园轮廓核验失败。');
  const tiles=new Map(),objects=new Map(manifest.objects.map(o=>[o.owner,o]));let disposed=false;
  await Promise.all(manifest.tiles.map(async row=>{const [color,depth]=await Promise.all([image(root+row.color),image(root+row.depth)]);if(color.naturalWidth!==row.width||color.naturalHeight!==row.height||depth.naturalWidth!==row.width||depth.naturalHeight!==row.height)throw Error('颜色与深度块尺寸不匹配。');const c=canvas(row.width,row.height),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(depth,0,0);const rgba=ctx.getImageData(0,0,row.width,row.height).data;c.width=c.height=0;if(!disposed)tiles.set(row.x+':'+row.y,{...row,image:color,rgba,lod:null,zoom:null});}));
  function sample(u,v){const x=Math.floor((u-manifest.left)*manifest.pixelsPerMetre),y=Math.floor((v-manifest.top)*manifest.pixelsPerMetre);if(x<0||y<0||x>=manifest.width||y>=manifest.height)return null;const tx=Math.floor(x/manifest.tileSize)*manifest.tileSize,ty=Math.floor(y/manifest.tileSize)*manifest.tileSize,t=tiles.get(tx+':'+ty);if(!t)return null;const i=((y-ty)*t.width+x-tx)*4,hit=decodeSurfaceDepth(t.rgba[i],t.rgba[i+1],t.rgba[i+2],t.rgba[i+3]);return hit?{...hit,owner:t.owners[hit.owner]}:null;}
  function draw(ctx,plan,zoom){let count=0;ctx.imageSmoothingEnabled=false;for(const t of tiles.values()){
    const x=Math.round((manifest.left*manifest.pixelsPerMetre+t.x)*zoom)-plan.left,y=Math.round((manifest.top*manifest.pixelsPerMetre+t.y)*zoom)-plan.top,w=Math.round(t.width*zoom),h=Math.round(t.height*zoom);
    if(x+w<0||y+h<0||x>plan.width||y>plan.height){if(t.lod)t.lod.width=t.lod.height=0;t.lod=null;t.zoom=null;continue;}
    if(!t.lod||t.zoom!==zoom){if(t.lod)t.lod.width=t.lod.height=0;t.lod=canvas(Math.max(1,w),Math.max(1,h));t.lod.getContext('2d').drawImage(t.image,0,0,t.lod.width,t.lod.height);t.zoom=zoom;}ctx.drawImage(t.lod,x,y);count++;
  }return count;}
  let selectedOwner=null;
  function drawSelection(ctx,plan,zoom,owner){
    if(selectedOwner!==owner){for(const t of tiles.values()){if(t.selection)t.selection.width=t.selection.height=0;t.selection=null;}selectedOwner=owner;}
    if(!owner)return;
    for(const t of tiles.values()){
      if(!t.owners.includes(owner))continue;
      const x=Math.round((manifest.left*manifest.pixelsPerMetre+t.x)*zoom)-plan.left,y=Math.round((manifest.top*manifest.pixelsPerMetre+t.y)*zoom)-plan.top,w=Math.round(t.width*zoom),h=Math.round(t.height*zoom);
      if(x+w<0||y+h<0||x>plan.width||y>plan.height)continue;
      if(!t.selection){
        const acrossTile=(lx,ly)=>{const gx=t.x+lx,gy=t.y+ly;if(gx<0||gy<0||gx>=manifest.width||gy>=manifest.height)return false;const tx=Math.floor(gx/manifest.tileSize)*manifest.tileSize,ty=Math.floor(gy/manifest.tileSize)*manifest.tileSize,neighbor=tiles.get(tx+':'+ty);if(!neighbor)return false;const i=((gy-ty)*neighbor.width+gx-tx)*4;return neighbor.rgba[i+3]>0&&neighbor.owners[neighbor.rgba[i+2]]===owner;};
        const mask=surfaceSelection(t.rgba,t.width,t.height,t.owners,owner,acrossTile);t.selection=canvas(t.width,t.height);t.selection.getContext('2d').putImageData(new ImageData(mask.data,t.width,t.height),0,0);
      }
      ctx.drawImage(t.selection,x,y,w,h);
    }
  }
  return {manifest,objects,sample,draw,drawSelection,dispose(){disposed=true;for(const t of tiles.values()){if(t.lod)t.lod.width=t.lod.height=0;if(t.selection)t.selection.width=t.selection.height=0;t.rgba=new Uint8ClampedArray(0);t.image.src='';}tiles.clear();objects.clear();}};
}
