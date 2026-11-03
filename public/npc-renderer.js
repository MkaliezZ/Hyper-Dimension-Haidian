import {pixelAvatar,PIXEL_FRAME} from './pixel-avatar-v3.js';
import {rasterCanvas} from './pixel-raster.js';
import {avatarScale} from './avatar-view.js';
import {maskActor} from './surface-depth.js';
import {project} from './oblique-layout.js';

// The same recipes, metric projection and per-pixel building masks as the visitor.
export function createNpcRenderer({worldScreen,zoom,sample}){
  let people=[],skins=null;const sprites=new Map(),masks=new Map();
  function setState(state){people=state?.npcs||[];skins=state?.skins||null;}
  function sprite(p,direction,action,frame){
    const key=[p.id,direction,action,frame,zoom()].join(':');if(sprites.has(key))return sprites.get(key);
    const original=rasterCanvas(pixelAvatar(p.profile.recipe,skins,{direction,action,frame})),size=avatarScale(zoom(),2),canvas=document.createElement('canvas');
    canvas.width=Math.round(PIXEL_FRAME.width*size);canvas.height=Math.round(PIXEL_FRAME.height*size);const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;context.drawImage(original,0,0,canvas.width,canvas.height);original.width=original.height=0;
    const row={canvas,size,width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data};sprites.set(key,row);
    if(sprites.size>170){const oldest=sprites.keys().next().value;sprites.get(oldest).canvas.width=0;sprites.delete(oldest);}return row;
  }
  function prepare(time){return people.map(p=>({person:p,point:p.position,direction:'south',moving:false,action:p.phase==='talking'?'wave':'idle',depth:p.position[2]-p.position[0],time})).sort((a,b)=>a.depth-b.depth);}
  function draw(context,rows){
    const markers=[];
    for(const row of rows){
      const {person:p,point:position,direction,moving,time,action}=row,[u,v]=project(position[0],position[2]),[x,y]=worldScreen(u,v),frame=action==='wave'?Math.floor(time/170)%4:0;
      const img=sprite(p,direction,action,frame),left=x-img.width/2,top=y-img.height+img.size;
      const key=[position[0].toFixed(3),position[2].toFixed(3),direction,action,frame,zoom()].join(':');let mask=masks.get(p.id);
      if(!mask||mask.key!==key){
        const result=maskActor({data:img.data,width:img.width,height:img.height,u0:u-img.width/2/(zoom()*4),v0:v-(img.height-img.size)/(zoom()*4),pixelsPerUnit:zoom()*4,position,sample});
        const canvas=mask?.canvas||document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;canvas.getContext('2d').putImageData(new ImageData(result.data,img.width,img.height),0,0);
        mask={key,canvas,hiddenRatio:result.hiddenRatio};masks.set(p.id,mask);
      }
      context.imageSmoothingEnabled=false;context.drawImage(mask.canvas,left,top);
      markers.push({id:p.id,x,y,labelY:top-5,left,top,width:img.width,height:img.height,hiddenRatio:mask.hiddenRatio});
    }return markers;
  }
  return {setState,prepare,draw,dispose(){for(const s of sprites.values())s.canvas.width=s.canvas.height=0;for(const m of masks.values())m.canvas.width=m.canvas.height=0;sprites.clear();masks.clear();people=[];}};
}
