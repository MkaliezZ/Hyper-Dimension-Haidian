import {pixelHash} from '../public/pixel-raster.js';
export function createHaidianShader(){
 const color=(r,g,b)=>((r|g<<8|b<<16|255<<24)>>>0),shade=(a,k)=>color(...a.map(n=>Math.min(255,Math.max(0,Math.round(n*k)))));
 return (u,v,face)=>{
  if(face.material)return reviewedMaterial(u,v,face);
  const P=face.profile||{},family=P.family,noise=(pixelHash(Math.floor(u*4),Math.floor(v*4),31)%5-2)*.6,light=face.normal?.[0]<0?.89:face.normal?.[2]>0?.76:.95;
  if(face.kind==='roof'){
   if(family==='membrane')return shade((u/3%1+1)%1<.035?[181,184,169]:[235+noise,231+noise,211+noise],.95);
   return shade(family==='pavilion'?[82,111,104]:[106+noise,131+noise,143+noise],((u*2)%5<.18||(v*2)%8<.18)?.80:1);
  }
  if(v<.45)return shade([161,154,137],light);if(v>P.wallHeight-.45)return shade([223,212,187],light);if(family==='membrane')return shade([207,209,189],light);
  const floor=3.3,bay=3.2,s=(u+.4)%bay,lv=(v-.9)%floor,windows=v>.9&&s>.58&&s<2.62&&lv>0&&lv<2.05;
  if(windows){if(s<.69||s>2.51||lv<.12||lv>1.9||Math.abs(s-1.6)<.06||Math.abs(lv-1)<.05)return shade([221,222,199],light);return shade([73+noise,120+noise+lv*4,146+noise+lv*5],light);}
  if(v%floor<.18)return shade([208,195,169],light);
  const brick=family==='brick',mortar=brick&&(v%.27<.022||(u+(Math.floor(v/.27)%2)*.25)%.50<.022);
  return shade(mortar?[166,130,105]:brick?[173+noise,111+noise,85+noise]:family==='pavilion'?[159,98,73]:[215+noise,204+noise,175+noise],light);
 };
}

const rgb=(a,k=1)=>((Math.min(255,Math.max(0,Math.round(a[0]*k)))|Math.min(255,Math.max(0,Math.round(a[1]*k)))<<8|Math.min(255,Math.max(0,Math.round(a[2]*k)))<<16|255<<24)>>>0);
const fract=n=>n-Math.floor(n);
function reviewedMaterial(u,v,face){
 const P=face.profile,material=face.material,n=face.normal||[0,1,0],up=face.kind==='roof'&&n[1]<0?-1:1;
 const light=face.kind==='roof'?.77+.23*Math.max(0,(-n[0]*.45+n[1]*.82-n[2]*.23)*up):.79+.20*Math.max(0,-n[0]*.65+n[2]*.65);
 const noise=(pixelHash(Math.floor(u*5),Math.floor(v*5),109)%5-2)*.38;
 if(P.window==='lattice'){
  const edge=v-P.base<.10||P.wallHeight-v<.10,bar=fract(u/.7)<.12||fract((u+v)/.7)<.07;
  return edge||bar?rgb([52,96,81],light):0;
 }
 if(material==='membrane')return rgb(fract(u/4.2)<.024?[199,203,194]:[239+noise,238+noise,223+noise],light);
 if(material==='chinese-tile')return rgb(fract(u/.30)<.16?[105,113,104]:[83+noise,91+noise,85+noise],light);
 if(material==='red-column')return rgb([153+noise,48+noise,42+noise],light);
 if(material==='painted-beam'){
  const border=fract(v/.32)<.13,ornament=fract(u/.65)<.15;
  return rgb(border||ornament?[195,167,88]:[39+noise,104+noise,83+noise],light);
 }
 if(material==='gold')return rgb([207,173,91],light);
 if(material==='plaque')return rgb(fract(u/.55)<.20?[203,177,93]:[35,66,101],light);
 if(material==='slate')return rgb(fract(u/.43)<.06?[91,98,92]:[67+noise,77+noise,76+noise],light);
 if(material==='flat-roof')return rgb([132+noise,139+noise,132+noise],light);
 if(face.kind==='roof'&&material==='stone')return rgb([212+noise,213+noise,199+noise],light);
 if(P.window==='louver'||material==='metal')return rgb(fract(v/.26)<.18?[112,122,122]:[163+noise,170+noise,166+noise],light);
 const floor=P.floorHeight||3.3,bay=P.bay||3.6,s=fract((u+.35)/bay)*bay,level=fract((v-P.base)/floor)*floor;
 const glass=(curtain=false)=>{
  const frame=curtain?(fract(u/(bay/2))<.04||fract(v/1.7)<.055):s<bay*.19||s>bay*.81||level<.94||level>floor-.53||Math.abs(s-bay/2)<.045||Math.abs(level-floor*.58)<.05;
  if(frame)return rgb([215,222,215],light);
  return rgb([69+noise+level*2,115+noise+level*3,135+noise+level*4],light);
 };
 if(material==='glass')return glass(true);
 if(P.window==='none')return rgb(material==='stone'?[203+noise,203+noise,188+noise]:[161+noise,80+noise,72+noise],light);
 if(v-P.base<.62)return rgb([162,164,152],light);
 const window=P.window==='tall-sport'?v>1.8&&v<P.wallHeight-1.1:P.window==='clerestory'?v>P.wallHeight-2.0&&v<P.wallHeight-.45:P.window==='ribbon'?level>1.16&&level<floor-.78:level>.92&&level<floor-.53&&s>bay*.17&&s<bay*.83;
 if(window)return glass(P.window==='tall-sport'||P.window==='clerestory'||P.window==='ribbon');
 if(material==='stone'){
  const seam=fract(u/1.5)<.016||fract(v/.9)<.022;
  return rgb(seam?[186,188,178]:[221+noise,220+noise,207+noise],light);
 }
 const mortar=fract(v/.24)<.048||fract((u+(Math.floor(v/.24)%2)*.25)/.50)<.025;
 return rgb(mortar?[151,99,89]:[170+noise,87+noise,77+noise],light);
}
