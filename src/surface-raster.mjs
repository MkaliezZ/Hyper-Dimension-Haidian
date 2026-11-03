import {surfaceProject} from '../public/surface-depth.js';
import {PixelRaster,rgba,pixelHash} from '../public/pixel-raster.js';
export class SurfaceRaster{
  constructor(width,height,{left=0,top=0,pixelsPerMetre=4}={}){this.width=width;this.height=height;this.left=left;this.top=top;this.scale=pixelsPerMetre;this.color=new PixelRaster(width,height);this.depth=new Float32Array(width*height).fill(-Infinity);this.owners=new Uint32Array(width*height);this.fragments=0;}
  triangle(face,owner,shader){
    const p=face.points.map(surfaceProject).map(([u,v,d])=>[(u-this.left)*this.scale,(v-this.top)*this.scale,d]),[A,B,C]=p,den=(B[1]-C[1])*(A[0]-C[0])+(C[0]-B[0])*(A[1]-C[1]);if(Math.abs(den)<1e-8)return;
    const minX=Math.max(0,Math.floor(Math.min(...p.map(p=>p[0])))),maxX=Math.min(this.width-1,Math.ceil(Math.max(...p.map(p=>p[0])))),minY=Math.max(0,Math.floor(Math.min(...p.map(p=>p[1])))),maxY=Math.min(this.height-1,Math.ceil(Math.max(...p.map(p=>p[1]))));
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const a=((B[1]-C[1])*(x+.5-C[0])+(C[0]-B[0])*(y+.5-C[1]))/den,b=((C[1]-A[1])*(x+.5-C[0])+(A[0]-C[0])*(y+.5-C[1]))/den,c=1-a-b;if(a<-.00001||b<-.00001||c<-.00001)continue;
      const d=a*A[2]+b*B[2]+c*C[2],i=y*this.width+x,prior=this.depth[i];if(d<prior-1e-5||Math.abs(d-prior)<=1e-5&&owner<this.owners[i])continue;
      const u=a*face.uv[0][0]+b*face.uv[1][0]+c*face.uv[2][0],v=a*face.uv[0][1]+b*face.uv[1][1]+c*face.uv[2][1];const color=shader(u,v,face);if(!(color>>>24))continue;this.color.pixels[i]=color;this.depth[i]=d;this.owners[i]=owner;this.fragments++;
    }
  }
  billboard(image,crop,{u,v,width,height,footU,footV,groundDepth},owner){
    const [sx,sy,sw,sh]=crop,x0=Math.floor((u-this.left)*this.scale),y0=Math.floor((v-this.top)*this.scale),w=width*this.scale,h=height*this.scale;
    for(let y=Math.max(0,y0);y<Math.min(this.height,y0+h);y++)for(let x=Math.max(0,x0);x<Math.min(this.width,x0+w);x++){
      const ix=Math.min(image.width-1,Math.floor(sx+(x+.5-x0)/w*sw)),iy=Math.min(image.height-1,Math.floor(sy+(y+.5-y0)/h*sh)),si=(iy*image.width+ix)*4,a=image.data[si+3];if(a<128)continue;
      const worldV=this.top+(y+.5)/this.scale,d=groundDepth+(footV-worldV)/(.78*Math.sqrt(1.5))*.5,i=y*this.width+x;if(d<this.depth[i]-.00001||Math.abs(d-this.depth[i])<=.00001&&owner<this.owners[i])continue;
      this.color.pixels[i]=(image.data[si]|image.data[si+1]<<8|image.data[si+2]<<16|255<<24)>>>0;this.depth[i]=d;this.owners[i]=owner;
    }
  }

}
const fract=n=>n-Math.floor(n);
const color=(r,g,b)=>((Math.max(0,Math.min(255,Math.round(r))))|(Math.max(0,Math.min(255,Math.round(g)))<<8)|(Math.max(0,Math.min(255,Math.round(b)))<<16)|(255<<24))>>>0;
export function createArchitecturalShader(atlas,facades){
  // Prefilter high-resolution source art before metric sampling. Single-texel
  // sampling of a photographic-size material caused visible roof noise/aliasing.
  const panels=(image,size)=>Array.from({length:4},(_,q)=>{const out=new Uint8ClampedArray(size*size*3),w=image.width/2,h=image.height/2;for(let y=0;y<size;y++)for(let x=0;x<size;x++){const x0=Math.floor(q%2*w+x*w/size),x1=Math.floor(q%2*w+(x+1)*w/size),y0=Math.floor(Math.floor(q/2)*h+y*h/size),y1=Math.floor(Math.floor(q/2)*h+(y+1)*h/size),sum=[0,0,0];let n=0;for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){const i=(yy*image.width+xx)*4;for(let k=0;k<3;k++)sum[k]+=image.data[i+k];n++;}for(let k=0;k<3;k++)out[(y*size+x)*3+k]=sum[k]/n;}return out;});
  const materialPanels=panels(atlas,48),facadePanels=facades&&panels(facades,96);
  const sample=(rows,size,type,u,v)=>{const x=Math.min(size-1,Math.floor(fract(u)*size)),y=Math.min(size-1,Math.floor(fract(v)*size)),i=(y*size+x)*3,p=rows[type];return [p[i],p[i+1],p[i+2]];};
  const texture=(type,u,v,metres=6)=>sample(materialPanels,48,type,u/metres,v/metres);
  const trim=(u,v)=>texture(3,u,v,4),shade=(rgb,n)=>color(...rgb.map(v=>v*n));
  return (u,v,face)=>{
    const P=face.profile||{},family=P.family||'sandstone';let light=.93;
    if(face.kind==='roof'){
      const [a,b,c]=face.points,ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);let n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];if(n[1]<0)n=n.map(v=>-v);const len=Math.hypot(...n)||1;light=.72+.28*Math.max(0,(n[0]*-.5+n[1]*.82+n[2]*-.28)/len);let rgb=texture(P.roof<1?3:2,u,v,7);if(P.roof<1)rgb=rgb.map((v,i)=>v*[.71,.75,.77][i]);return shade(rgb,light);
    }
    if(face.kind==='copper')return shade([74,117,107],.9+Math.sin(u*4)*.06);
    if(face.kind==='cupola'){const dx=u-face.edgeLength/2,dy=v-1.8;if(Math.hypot(dx,dy)<.55){if(Math.abs(dx)<.07&&dy>-.35&&dy<.06||Math.abs(dy-dx*.4)<.07&&dx>=0&&dx<.3)return color(68,72,66);return color(235,221,181);}if(v<.22||Math.abs(dx)>face.edgeLength*.36)return shade(trim(u,v),.89);return color(78,101,91);}
    if(face.kind==='trim')return shade(trim(u,v),.91);
    if(face.normal)light=.76+.21*Math.max(0,face.normal[0]*-.8+face.normal[2]*.6);
    const stone=family==='sandstone'||family==='contemporary',rgb=texture(stone?0:1,u+face.edgeSeed*1.7,v,stone?3.5:2.5),H=P.wallHeight;
    if(v<.8)return shade(trim(u,v),light*.73);
    if(v>H-.5)return shade(trim(u,v),light*1.03);
    const grand=P.window==='great-gothic',upper=grand&&v>6.7,floorH=grand?(upper?20:6.1):3.5,bay=P.window==='colonnade'?5.5:grand?5.4:3.7;
    const s=fract((u+.4)/bay)*bay,bottom=upper?7.2:1.12,local=v-bottom,floor=Math.floor(local/floorH),vv=local-floor*floorH,winW=grand?(upper?3.1:2.0):family==='contemporary'?bay*.69:1.72,winH=grand?(upper?8.8:3.7):2.18,left=(bay-winW)/2,right=left+winW;
    const arch=['gothic','great-gothic','roman'].includes(P.window);let top=winH;
    if(arch){const dx=Math.abs((s-bay/2)/(winW/2));top=P.window==='roman'?winH-winW/2+Math.sqrt(Math.max(0,1-dx*dx))*winW/2:winH-Math.pow(dx,1.3)*winW*.62;}
    const doorBay=Math.round(face.edgeLength/bay/2),door=Math.floor((u+.4)/bay)===doorBay&&v<3.45&&s>left-.15&&s<right+.15;
    if(door){if(v>3.15||s<left+.08||s>right-.08)return shade(trim(u,v),light);if(Math.abs(s-bay/2)<.1)return color(156,131,89);return color(50,68,68);}
    if(facadePanels){
      if(grand&&v>17.1)return shade(trim(u,v),light);
      const type=grand?(upper?0:3):P.window==='roman'?3:family==='contemporary'?2:1;
      const phase=grand?(upper?(v-6.7)/10.5:(v-.8)/5.9):(v-.8)/floorH;
      return shade(sample(facadePanels,96,type,(u+.4)/bay,1-phase),light);
    }
    if(local>0&&v<H-.65&&s>left-.17&&s<right+.17&&vv<top+.18){
      if(s<left+.10||s>right-.10||vv<.18||vv>top-.15)return shade(trim(u,v),light);
      const panes=grand&&upper?4:2,mullion=Math.abs(fract((s-left)/(winW/panes))-.5);if(mullion>.43||Math.abs(vv-winH*.5)<.065||grand&&upper&&vv>winH*.73&&Math.abs(s-bay/2)<.15)return shade(trim(u,v),light*.94);
      const gleam=pixelHash(Math.floor(u*5),Math.floor(v*5),17)%13;return color(58+gleam*.8+(vv/winH)*19,83+gleam+(vv/winH)*22,91+gleam+(vv/winH)*24);
    }
    if(P.window==='colonnade'&&v<5&&s<.8)return shade(trim(u,v),light*1.1);
    if(arch&&(s<.3||s>bay-.3))return shade(trim(u,v),light*.97);
    if(vv<.11&&v>bottom)return shade(trim(u,v),light*.88);
    return shade(rgb,light);
  };
}
