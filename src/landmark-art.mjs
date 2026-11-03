// Photo-informed landmark art sampled onto the registered world, not stretched cards.
import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {baseRoot} from './base.mjs';
import {RED_BOUNDARY,FOUNTAIN} from '../public/campus-layout.js';
import {FOUNTAIN_GARDEN} from '../public/campus-landscape.js';
import {surfaceProject} from '../public/surface-depth.js';
import {RED_SEATING,RED_TOWERS,RED_OBELISK} from '../public/red-square-layout.js';
export {RED_SEATING} from '../public/red-square-layout.js';
const {default:earcut}=await import(pathToFileURL(join(baseRoot,'node_modules/three/src/extras/lib/earcut.js')).href);
const fract=v=>v-Math.floor(v),pack=rgb=>((Math.round(rgb[0])|Math.round(rgb[1])<<8|Math.round(rgb[2])<<16|255<<24)>>>0);
const seams=RED_SEATING.flatMap((p,i)=>[0,1,2].map(n=>[[p.x,p.z],RED_BOUNDARY[(i*3+n)%RED_BOUNDARY.length]]));
const distance=(x,z,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);};
export function createLandmarkMaterials(image){
  const size=64,panels=Array.from({length:4},(_,q)=>{
    const out=new Uint8ClampedArray(size*size*3),half=image.width/2;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const x0=Math.floor((q%2+x/size)*half),x1=Math.floor((q%2+(x+1)/size)*half),y0=Math.floor((Math.floor(q/2)+y/size)*half),y1=Math.floor((Math.floor(q/2)+(y+1)/size)*half),sum=[0,0,0];let count=0;
      for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){const i=(yy*image.width+xx)*4;sum[0]+=image.data[i];sum[1]+=image.data[i+1];sum[2]+=image.data[i+2];count++;}
      for(let k=0;k<3;k++)out[(y*size+x)*3+k]=sum[k]/count;
    }return out;
  });
  const sample=(q,u,v,metres)=>{const x=Math.floor(fract(u/metres)*size),y=Math.floor(fract(v/metres)*size),i=(y*size+x)*3,p=panels[q];return [p[i],p[i+1],p[i+2]];};
  const stone=(u,v,light=1)=>pack(sample(2,u,v,4).map((c,k)=>Math.min(255,(c*.28+[196,194,181][k]*.72)*light)));
  return {sample,stone,
    brick(u,v,light=1){return pack(sample(0,u,v,12).map(c=>Math.min(255,c*light)));},
    paving(u,v){
      const d=Math.min(...seams.map(([a,b])=>distance(u,v,a,b)));
      if(d<.18)return stone(u,v,1.09);if(d<.29)return stone(u,v,.77);
      // Coherent fine pavers with large-scale weathering, rather than a coarse grid.
      const tone=.96+.025*Math.sin(u*.09+v*.05);return pack(sample(0,u*.94+v*.34,-u*.34+v*.94,12).map(c=>Math.min(255,c*tone)));
    },
    water(u,v){
      const dx=u-FOUNTAIN.x,dz=v-FOUNTAIN.z,r=Math.hypot(dx,dz),rgb=sample(1,u,v*.8,16),wave=Math.sin(r*3.9+Math.sin(dx*.6))*.04;
      let foam=Math.max(0,1-Math.abs(r-2.5)/1.4)*.5;
      for(let n=0;n<8;n++){const a=n/8*Math.PI*2,d=Math.hypot(dx-Math.cos(a)*13,dz-Math.sin(a)*13);foam=Math.max(foam,Math.max(0,1-d/1.7)*.7);}
      const spray=sample(3,u,v,7);return pack(rgb.map((c,k)=>Math.min(255,c*(.82+wave)*(1-foam)+spray[k]*foam)));
    }
  };
}
const triangle=(a,b,c)=>({points:[a,b,c],uv:[a,b,c].map(p=>[p[0],p[2]]),kind:'landmark'});
function bounds(points){const P=points.map(surfaceProject);return [Math.min(...P.map(p=>p[0])),Math.min(...P.map(p=>p[1])),Math.max(...P.map(p=>p[0])),Math.max(...P.map(p=>p[1]))];}
export function drawLandmarkGround(raster,addObject,material){
  const points=RED_BOUNDARY.map(([x,z])=>[x,-.025,z]),owner=addObject({id:'red-square-paving',placeId:'red-square',kind:'plaza',point:[-122.17,26.65],bounds:bounds(points),artVersion:'photo-landmark-2',source:'UW Red Square photographs; registered plaza boundary'});
  const indices=earcut(RED_BOUNDARY.flat());for(let i=0;i<indices.length;i+=3)raster.triangle(triangle(...indices.slice(i,i+3).map(n=>points[n])),owner,material.paving);
  // Ground-level jointed concrete around the pool; the navigable size stays fixed.
  const r=FOUNTAIN_GARDEN.walkOuterRadius,ring=addObject({id:'fountain-promenade',placeId:'fountain',kind:'plaza',point:[FOUNTAIN.x,FOUNTAIN.z],bounds:bounds(Array.from({length:64},(_,i)=>[FOUNTAIN.x+Math.cos(i/64*Math.PI*2)*r,-.025,FOUNTAIN.z+Math.sin(i/64*Math.PI*2)*r])),artVersion:'photo-landmark-2'});
  for(let i=0;i<192;i++){
    const a=i/192*Math.PI*2,b=(i+1)/192*Math.PI*2;
    raster.triangle(triangle([FOUNTAIN.x,-.025,FOUNTAIN.z],[FOUNTAIN.x+Math.cos(a)*r,-.025,FOUNTAIN.z+Math.sin(a)*r],[FOUNTAIN.x+Math.cos(b)*r,-.025,FOUNTAIN.z+Math.sin(b)*r]),ring,(u,v)=>{
      const d=Math.hypot(u-FOUNTAIN.x,v-FOUNTAIN.z),angle=Math.atan2(v-FOUNTAIN.z,u-FOUNTAIN.x),joint=Math.abs(Math.sin(angle*40))*d<.09||Math.abs((d-FOUNTAIN.rimRadius)%2.6)<.065;
      const approach=Math.abs(Math.sin((angle-FOUNTAIN_GARDEN.axisAngle)*2))<Math.sin(FOUNTAIN_GARDEN.gateHalfAngle*2)*1.35;
      if(d>FOUNTAIN.promenadeRadius&&!approach&&d<FOUNTAIN_GARDEN.walkOuterRadius-2){const m=Math.sin(u*.4)*Math.cos(v*.3)*3;return pack([143+m,161+m,111+m]);}
      return material.stone(u,v,joint?.83:1.08);
    });
  }
  return owner;
}
// Area-filter the generated spray at its actual baked pixel density, preserving alpha.
export function prepareFountainPlume(image,width=32,height=100){
  let left=image.width,top=image.height,right=0,bottom=0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.data[(y*image.width+x)*4+3]>32){left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
  if(left>=right||top>=bottom)throw Error('Fountain plume has no visible alpha pixels');
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const x0=Math.floor(left+x/width*(right-left)),x1=Math.max(x0+1,Math.floor(left+(x+1)/width*(right-left))),y0=Math.floor(top+y/height*(bottom-top)),y1=Math.max(y0+1,Math.floor(top+(y+1)/height*(bottom-top))),sum=[0,0,0];let alpha=0,n=0;
    for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){const i=(yy*image.width+xx)*4,a=image.data[i+3];for(let k=0;k<3;k++)sum[k]+=image.data[i+k]*a;alpha+=a;n++;}
    const i=(y*width+x)*4;for(let k=0;k<3;k++)data[i+k]=alpha?sum[k]/alpha:0;data[i+3]=alpha/n;
  }
  return {width,height,data};
}
export function drawRedSquareFeatures(raster,addObject,material){
  const solid=rgb=>()=>pack(rgb),quad=(a,b,c,d,owner,shader)=>{raster.triangle(triangle(a,b,c),owner,shader);raster.triangle(triangle(a,c,d),owner,shader);};
  const plinth=(cx,cz,w,d,y,h,owner,angle=0)=>{
    const c=Math.cos(angle),s=Math.sin(angle),corners=[[-w/2,-d/2],[w/2,-d/2],[w*.4,d/2],[-w*.4,d/2]].map(([x,z])=>[cx+c*x-s*z,cz+s*x+c*z]);
    for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4];quad([a[0],y,a[1]],[b[0],y,b[1]],[b[0],y+h,b[1]],[a[0],y+h,a[1]],owner,(u,v)=>material.stone(u,v,i%2?.76:.9));}
    const top=corners.map(p=>[p[0],y+h,p[1]]);quad(...top,owner,(u,v)=>material.stone(u,v,1.12));
  };
  for(const [i,p]of RED_SEATING.entries()){
    const owner=addObject({id:'red-square-seating-'+i,placeId:'red-square',kind:'prop',point:[p.x,p.z],bounds:bounds([[p.x-5,.6,p.z-2.2],[p.x+5,0,p.z+2.2]]),collisionEnvelope:p.collisionRadius,artVersion:'photo-landmark-2'});
    plinth(p.x,p.z,9.2,4.1,0,.18,owner,p.angle);plinth(p.x,p.z,8.35,3.1,.18,.19,owner,p.angle);plinth(p.x,p.z,7.5,2.05,.37,.23,owner,p.angle);
  }
  for(const [i,p]of RED_TOWERS.entries()){
    const {x,z,height:H,width:W,depth:D}=p,owner=addObject({id:'red-square-pylon-'+i,placeId:'red-square',kind:'prop',name:'Red Square brick pylons',point:[x,z],height:H,heightStatus:'photo-informed-artistic',bounds:bounds([[x-W/2,H,z-D/2],[x+W/2,0,z+D/2]]),artVersion:'photo-landmark-2'}),c=[[-W/2,-D/2],[W/2,-D/2],[W/2,D/2],[-W/2,D/2]];
    for(let k=0;k<4;k++){const a=c[k],b=c[(k+1)%4],A=[x+a[0],0,z+a[1]],B=[x+b[0],0,z+b[1]],C=[x+b[0],H,z+b[1]],E=[x+a[0],H,z+a[1]],L=Math.hypot(a[0]-b[0],a[1]-b[1]),shader=(u,v)=>{const base=k%2?[109,61,45]:[190,126,91],tex=material.sample(0,u*3,v*3,12);return pack(tex.map((n,j)=>n*.32+base[j]*.68));};raster.triangle({points:[A,B,C],uv:[[0,0],[L,0],[L,H]]},owner,shader);raster.triangle({points:[A,C,E],uv:[[0,0],[L,H],[0,H]]},owner,shader);}
    quad(...c.map(p=>[x+p[0],H,z+p[1]]),owner,solid([174,142,112]));
  }
  // Broken Obelisk: a pyramid balances the inverted taper and fractured shaft.
  const {x,z}=RED_OBELISK,owner=addObject({id:'broken-obelisk',placeId:'red-square',kind:'prop',name:'Broken Obelisk',point:[x,z],bounds:bounds([[x-2,7.92,z-2],[x+2,0,z+2]]),artVersion:'photo-landmark-2'}),corners=[[-.95,-.95],[.95,-.95],[.95,.95],[-.95,.95]],baseCorners=[[-2,-2],[2,-2],[2,2],[-2,2]],heights=[7.92,7.5,7.8,7.1];
  for(let i=0;i<4;i++){
    const a=corners[i],b=corners[(i+1)%4],A=baseCorners[i],B=baseCorners[(i+1)%4],col=i%2?[104,77,61]:[147,107,79];
    raster.triangle(triangle([x+A[0],0,z+A[1]],[x+B[0],0,z+B[1]],[x,2.65,z]),owner,solid(col));
    raster.triangle(triangle([x,2.65,z],[x+b[0],4.2,z+b[1]],[x+a[0],4.2,z+a[1]]),owner,solid(col));
    quad([x+a[0],4.2,z+a[1]],[x+b[0],4.2,z+b[1]],[x+b[0],heights[(i+1)%4],z+b[1]],[x+a[0],heights[i],z+a[1]],owner,solid(col));
  }
}
