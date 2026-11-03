import {OBLIQUE,project} from './oblique-layout.js';
// The existing 2:1 ground projection is an orthographic 30 degree elevation.
// Match its vertical metric instead of independently stretching facade pictures.
export const SURFACE_DEPTH_VERSION='uw-surface-depth-1.0.0';
export const HEIGHT_SCALE=OBLIQUE.x*Math.sqrt(1.5);
export const DEPTH_GROUND=Math.sqrt(3/8),DEPTH_HEIGHT=.5;
export function surfaceProject([x,h,z]){const [u,v]=project(x,z);return [u,v-h*HEIGHT_SCALE,(z-x)*DEPTH_GROUND+h*DEPTH_HEIGHT];}
export function encodeSurfaceDepth(depth,owner){const n=Math.round(depth*64)+32768;if(n<0||n>65535||owner<1||owner>255)throw Error('Surface depth/owner outside codec range');return ((n&255)|((n>>>8)<<8)|(owner<<16)|(255<<24))>>>0;}
export function decodeSurfaceDepth(r,g,b,a){return a?{depth:((r|(g<<8))-32768)/64,owner:b}:null;}
export function actorFragmentDepth(position,v){const [,footV]=project(position[0],position[2]),h=(footV-v)/HEIGHT_SCALE;return (position[2]-position[0])*DEPTH_GROUND+h*DEPTH_HEIGHT;}
export function maskActor({data,width,height,u0,v0,pixelsPerUnit,position,sample,silhouette=true}){
  const out=new Uint8ClampedArray(data.length),owners=new Set();let opaque=0,hidden=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;if(!data[i+3])continue;opaque++;
    const u=u0+(x+.5)/pixelsPerUnit,v=v0+(y+.5)/pixelsPerUnit,front=sample(u,v);
    if(front&&front.depth>actorFragmentDepth(position,v)+.03){
      hidden++;owners.add(front.owner);
      const boundary=x===0||y===0||x===width-1||y===height-1||!data[i-4+3]||!data[i+4+3]||!data[i-width*4+3]||!data[i+width*4+3];
      if(silhouette&&boundary){out[i]=255;out[i+1]=229;out[i+2]=164;out[i+3]=190;}
    }else{out[i]=data[i];out[i+1]=data[i+1];out[i+2]=data[i+2];out[i+3]=data[i+3];}
  }
  return {data:out,owners:[...owners].sort((a,b)=>a-b),hiddenPixels:hidden,opaquePixels:opaque,hiddenRatio:opaque?hidden/opaque:0};
}
