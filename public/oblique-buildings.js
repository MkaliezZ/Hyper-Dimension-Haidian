import {PixelRaster,rgba,tint,pixelHash} from './pixel-raster.js';
import {project,projectedBounds,unproject} from './oblique-layout.js';
import {inFootprint} from './pixel-campus-art.js';
export const BUILDING_ART_VERSION='uw-streets-1.0.0';
const HERITAGE=new Set(['MGH','GRB','GUG','JHN','SMI','MLR','MUS','HUT','ART','BAG','CLK','CMU','PAR','LEW']);
const GLASS=new Set(['ELB','OUG','MNY','KIN','PDL','AER','LSB','HRC','CSE2','MOL','ECE','MEB','BNS','LOW','LAW','FNDR','PCAR']);
const TIMBER=new Set(['INT','ICH','FAC']);
const THEMES={
  collegiate:{wall:'#b68165',trim:'#e3cd9f',roof:'#687e82',glass:'#466574',pitch:true},
  sandstone:{wall:'#c3b18c',trim:'#efe0bc',roof:'#78857e',glass:'#526f7a',pitch:true},
  contemporary:{wall:'#aca995',trim:'#e0d4b4',roof:'#8e9890',glass:'#416d7c',pitch:false},
  brick:{wall:'#b3836a',trim:'#dfd0ae',roof:'#8d998b',glass:'#587c83',pitch:false},
  timber:{wall:'#a78459',trim:'#dec49c',roof:'#687a73',glass:'#486d6d',pitch:true}
};
export function buildingStyle(building){if(TIMBER.has(building.code))return 'timber';if(HERITAGE.has(building.code))return pixelHash(building.code.length,building.code.charCodeAt(0))%5===0?'sandstone':'collegiate';if(GLASS.has(building.code))return 'contemporary';const seed=Array.from(building.id).reduce((n,c)=>n+c.charCodeAt(0),0);return seed%3===0?'sandstone':'brick';}
// Material/roof families are artistic inferences, not additional claims about measured UW buildings.
// The four-pixel source grid exports at twice the scene's source resolution; every footprint ring is preserved.
export function buildingSprite(building){
  const bounds=projectedBounds(building.rings),style=buildingStyle(building),C=THEMES[style],S=4,pad=6,ratio=2;
  const xs=building.rings[0].map(p=>p[0]),zs=building.rings[0].map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs),axis=x1-x0<z1-z0?'x':'z',lo=axis==='x'?x0:z0,hi=axis==='x'?x1:z1,mid=(lo+hi)/2,half=(hi-lo)/2;
  const h=Math.round(Math.min(32,Math.max(7,building.height))*S*1.12),rise=C.pitch?Math.round(Math.min(4,(hi-lo)*.12)*S):0;
  const width=Math.ceil((bounds[2]-bounds[0])*S)+pad*2,height=Math.ceil((bounds[3]-bounds[1])*S)+h+rise+pad*2,p=new PixelRaster(width,height);
  const xy=([u,v],up=0)=>[(u-bounds[0])*S+pad,(v-bounds[1])*S+h+rise+pad-up],seed=Array.from(building.id).reduce((n,c)=>Math.imul(n+7,31)+c.charCodeAt(0),0)>>>0;
  const lift=world=>rise?rise*(1-Math.min(1,Math.abs((axis==='x'?world[0]:world[1])-mid)/(half||1))):0,walls=[];
  for(const ring of building.rings)for(let i=0;i<ring.length-1;i++){const A=ring[i],B=ring[i+1],a=project(...A),b=project(...B);walls.push({A,B,a,b,depth:(a[1]+b[1])/2,length:Math.hypot(B[0]-A[0],B[1]-A[1])});}
  walls.sort((a,b)=>a.depth-b.depth);const front=[...walls].filter(w=>w.length>8).sort((a,b)=>b.depth-a.depth)[0];
  const dark=rgba(tint(C.wall,-.13)),mortar=rgba(tint(C.wall,.14)),light=rgba(tint(C.wall,.08));
  for(const wall of walls){const {a,b,A,B}=wall,bottomA=xy(a),bottomB=xy(b),topA=xy(a,h),topB=xy(b,h),shade=b[1]>a[1]?-.12:.04,color=tint(C.wall,shade);
    p.polygon([bottomA,bottomB,topB,topA],color);
    const dx=topB[0]-topA[0];if(Math.abs(dx)>1){for(let x=Math.ceil(Math.min(topA[0],topB[0]));x<Math.max(topA[0],topB[0]);x++){const t=(x-topA[0])/dx,yTop=topA[1]+(topB[1]-topA[1])*t,along=Math.floor(t*wall.length*S);for(let y=Math.max(0,Math.ceil(yTop));y<Math.min(height,yTop+h);y++){const v=Math.floor(y-yTop),hash=pixelHash(along,v,seed);if(v%4===0||(along+(Math.floor(v/4)%2)*7)%14===0)p.pixels[y*width+x]=mortar;else if(hash%11===0)p.pixels[y*width+x]=hash%2?light:dark;}}}
    // Foundations, stone floor bands and a cornice follow the edge's oblique slope.
    p.line(...bottomA,...bottomB,tint(C.wall,-.22),4);p.line(...topA,...topB,C.trim,4);
    const floors=Math.max(2,Math.round(building.height/3.5)),floorH=(h-8)/floors,bays=Math.max(1,Math.floor(wall.length/(style==='contemporary'?4.2:3.7)));
    for(let floor=0;floor<floors;floor++){
      const row=5+floor*floorH,windowH=Math.max(6,floorH*.62);p.line(topA[0],topA[1]+row+windowH+2,topB[0],topB[1]+row+windowH+2,tint(C.trim,-.1));
      for(let n=0;n<bays;n++){const t0=(n+.22)/bays,t1=(n+.78)/bays,wa=[topA[0]+dx*t0,topA[1]+(topB[1]-topA[1])*t0+row],wb=[topA[0]+dx*t1,topA[1]+(topB[1]-topA[1])*t1+row],inner=[[wa[0],wa[1]],[wb[0],wb[1]],[wb[0],wb[1]+windowH],[wa[0],wa[1]+windowH]];p.polygon(inner,C.trim);const ga=[wa[0]+Math.sign(dx),wa[1]+1],gb=[wb[0]-Math.sign(dx),wb[1]+1];p.polygon([ga,gb,[gb[0],gb[1]+windowH-3],[ga[0],ga[1]+windowH-3]],pixelHash(n,floor,seed)%4===0?'#879c91':C.glass);p.line((wa[0]+wb[0])/2,(wa[1]+wb[1])/2,(wa[0]+wb[0])/2,(wa[1]+wb[1])/2+windowH-1,tint(C.trim,-.1));p.line(ga[0],ga[1]+windowH*.45,gb[0],gb[1]+windowH*.45,'#9bafaa');
        if(C.pitch&&Math.abs(dx)/bays>4){p.line(wa[0],wa[1],(wa[0]+wb[0])/2,(wa[1]+wb[1])/2-2,C.trim,2);p.line((wa[0]+wb[0])/2,(wa[1]+wb[1])/2-2,wb[0],wb[1],C.trim,2);}
      }
    }
    if(C.pitch){for(let n=0;n<=bays;n+=3){const t=n/bays,x=topA[0]+dx*t,y=topA[1]+(topB[1]-topA[1])*t;p.line(x,y+2,x,y+h,C.trim,2);}}
    // Fill gable ends up to the same roof profile, rather than floating a separate roof block.
    if(rise){const cap=[topA,topB,xy(b,h+lift(B))],av=axis==='x'?A[0]:A[1],bv=axis==='x'?B[0]:B[1];if((av-mid)*(bv-mid)<0){const t=(mid-av)/(bv-av),w=[A[0]+(B[0]-A[0])*t,A[1]+(B[1]-A[1])*t];cap.push(xy(project(...w),h+rise));}cap.push(xy(a,h+lift(A)));p.polygon(cap,color);}
    if(wall===front&&wall.length>10){const x=(bottomA[0]+bottomB[0])/2,y=(bottomA[1]+bottomB[1])/2,dh=Math.min(h*.43,17),dw=Math.max(5,Math.min(12,Math.abs(dx)*.12));p.rect(x-dw/2-2,y-dh-2,dw+4,dh+3,C.trim);p.rect(x-dw/2,y-dh,dw,dh,'#354e53');p.line(x,y-dh,x,y,'#c1b28e');p.put(x+2,y-dh*.45,'#d3b36d');p.line(x-dw,y+2,x+dw,y+2,'#d4c2a0',2);}
  }
  let roofPixels=0;const roofColors=Array.from({length:11},(_,n)=>rgba(tint(C.roof,(n-5)*.025)));
  // Invert the two roof planes to sample the original polygon (including courtyard holes).
  for(let y=0;y<height-h-pad;y++)for(let x=pad;x<width-pad;x++){
    const u=bounds[0]+(x+.5-pad)/S,v=bounds[1]+(y+.5-h-rise-pad)/S;let world=null;
    if(!rise)world=unproject(u,v+h/S);
    else for(const side of [-1,1]){const a=side<0?rise/S/(half||1):-rise/S/(half||1),b=rise/S-a*mid;let wx,wz;if(axis==='x'){wx=(.5*u-v-h/S-b)/(.78+a);wz=u/.78-wx;}else{wz=(v+.5*u+h/S+b)/(.78-a);wx=u/.78-wz;}const value=axis==='x'?wx:wz;if((side<0&&value<=mid+.001)||(side>0&&value>=mid-.001)){world=[wx,wz];break;}}
    if(!world||world[0]<x0||world[0]>x1||world[1]<z0||world[1]>z1||!inFootprint(...world,building.rings))continue;
    roofPixels++;const tx=Math.floor(world[0]*S),ty=Math.floor(world[1]*S),noise=pixelHash(tx,ty,seed),cross=axis==='x'?world[0]:world[1];let index=noise%5+3;
    if(rise){index=Math.max(0,Math.min(10,index+(cross<mid?2:-2)));if(ty%4===0||(tx+(Math.floor(ty/4)%2)*3)%8===0)index=Math.max(0,index-2);if(Math.abs(cross-mid)<.35)index=10;}
    else{if(tx%20===0||ty%20===0)index=1;const gx=((tx%56)+56)%56,gz=((ty%56)+56)%56;if(pixelHash(Math.floor(tx/56),Math.floor(ty/56),seed)%5===0&&gx>13&&gx<34&&gz>13&&gz<31){p.put(x,y,gx%7===0||gz%6===0?'#b7c5bc':gx<17||gz<17?'#d8d4bb':'#607f83');continue;}}
    p.pixels[y*width+x]=roofColors[index];
  }
  for(const ring of building.rings){const points=[];for(let i=0;i<ring.length-1;i++){const A=ring[i],B=ring[i+1];points.push(xy(project(...A),h+lift(A)));const av=axis==='x'?A[0]:A[1],bv=axis==='x'?B[0]:B[1];if(rise&&(av-mid)*(bv-mid)<0){const t=(mid-av)/(bv-av),w=[A[0]+(B[0]-A[0])*t,A[1]+(B[1]-A[1])*t];points.push(xy(project(...w),h+rise));}}p.stroke(points,C.trim,2);}
  return {raster:p,bounds,offset:[bounds[0]*2-pad/ratio,bounds[1]*2-(h+rise+pad)/ratio],width:width/ratio,height:height/ratio,depth:bounds[3],rings:building.rings,heightStatus:'inferred',style,artVersion:BUILDING_ART_VERSION,sourcePixelRatio:ratio,roofPixels,detail:'masonry, stone bands, framed windows, entrance, cornice and textured continuous roof'};
}
