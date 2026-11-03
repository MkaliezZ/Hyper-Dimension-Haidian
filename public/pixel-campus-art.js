import {PixelRaster,rgba,tint,pixelHash} from './pixel-raster.js';
import {RED_BOUNDARY,FOUNTAIN} from './campus-layout.js';
import {explorationBounds} from './campus-bounds.js';
import {terrainHeight} from './terrain-surface.js';
import {campusLandscape,FOUNTAIN_GARDEN} from './campus-landscape.js';
export const PIXEL_CAMPUS_VERSION='uw-pixel-campus-1.0.0';
export const PIXEL_PALETTE={ink:'#3d4051',grass:'#a7bc86',grassDark:'#8fa673',path:'#e4d5b5',pathEdge:'#b8ad91',road:'#8999a0',water:'#73b8c8',waterDeep:'#4f91ad',brick:'#b56f58',brickDark:'#8d534a',cream:'#e8d6af',slate:'#647c89',pink:'#e8b8bc',purple:'#77608e'};
const ringContains=(x,z,ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
export const inFootprint=(x,z,rings)=>ringContains(x,z,rings[0])&&!rings.slice(1).some(r=>ringContains(x,z,r));
export function pixelTree(kind='green',seed=1){
  const p=new PixelRaster(21,21),pink=kind==='cherry',dark=pink?'#ac7d91':'#567659',base=pink?'#dca3b4':'#7c9c6d',light=pink?'#f1c7cb':'#a3b77d';
  for(const [x,y,r] of [[7,8,6],[13,8,6],[10,13,6]])p.circle(x,y,r,dark);
  for(const [x,y,r] of [[7,7,5],[13,7,5],[10,12,5]])p.circle(x,y,r,base);
  p.circle(8,7,4,light);p.circle(13,6,3,light);p.circle(8,12,3,light);
  for(let n=0;n<16;n++){const x=3+pixelHash(n,seed)%15,y=3+pixelHash(seed,n)%14;if(p.pixels[y*21+x]&&pixelHash(x,y,seed)%3===0)p.rect(x,y,2,1,pink?'#fff0da':'#c0c794');}
  return p;
}
export function createPixelCampusArt(campus,{pixelsPerMetre=2,drawBuildings=true,drawTrees=true,drawProps=true}={}){
  const [x0,z0,x1,z1]=campus.bounds,s=pixelsPerMetre,width=Math.ceil((x1-x0)*s),height=Math.ceil((z1-z0)*s),p=new PixelRaster(width,height),C=PIXEL_PALETTE;
  const xy=(x,z)=>[Math.round((x-x0)*s),Math.round((z-z0)*s)],from=(x,y)=>[x/s+x0,y/s+z0],line=(a,b,col,w=1)=>p.line(...xy(...a),...xy(...b),col,w),poly=(points,col)=>p.polygon(points.map(a=>xy(...a)),col);
  const grass=['#a5b985','#a9bd88','#afc18f','#a3b782','#b5c694'];
  for(let y=0;y<height;y+=8)for(let x=0;x<width;x+=8){const [wx,wz]=from(x,y),elevation=terrainHeight(campus.terrain,wx,wz),shade=Math.max(0,Math.min(4,Math.floor((elevation-15)/12)));p.rect(x,y,8,8,grass[shade]);const hash=pixelHash(x,y);if(hash%5===0){p.put(x+2,y+4,'#849e6b');p.put(x+3,y+3,'#c2cd9c');}if(hash%13===0)p.rect(x+5,y+2,2,1,'#d2d7a7');}
  // Real public path polylines; styling stays flat and north-up.
  for(const road of [true,false])for(const path of campus.paths.filter(v=>(v.kind==='road')===road))for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],w=road?Math.round(7*s):Math.round(3.1*s);line([a[0],a[2]],[b[0],b[2]],road?'#71868d':C.pathEdge,w+2);line([a[0],a[2]],[b[0],b[2]],road?C.road:C.path,w);}
  const pathValue=rgba(C.path),roadValue=rgba(C.road);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x,v=p.pixels[i],h=pixelHash(x,y);if(v===pathValue&&h%19===0)p.pixels[i]=rgba('#ccbfa0');if(v===roadValue&&y%10===0&&x%9<3)p.pixels[i]=rgba('#a7b4b5');}
  // Red Square's actual irregular plaza and radiating pale pavement seams.
  poly(RED_BOUNDARY,C.brick);const red=rgba(C.brick);for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(p.pixels[y*width+x]===red){if(y%4===0||(x+(Math.floor(y/4)%2)*4)%8===0)p.put(x,y,'#9f6152');else if(pixelHash(x,y)%23===0)p.put(x,y,'#c58265');}
  const fan=[-115,68];for(const endpoint of [[-164,10],[-151,-7],[-133,-20],[-110,-10],[-90,0],[-72,4],[-61,11],[-66,43],[-69,64],[-83,75],[-155,65]])line(fan,endpoint,'#e6d4ae',Math.max(1,Math.round(s*.65)));
  if(drawProps)for(const [x,z] of [[-151,10],[-146,7],[-141,4]]){const [px,py]=xy(x,z);p.rect(px-3,py-4,7,9,'#6f4845');p.rect(px-2,py-3,5,7,'#a36351');p.rect(px-1,py-2,3,5,'#c68869');}
  if(drawProps){const [ox,oy]=xy(-79,-4);p.polygon([[ox,oy-5],[ox+4,oy],[ox,oy+5],[ox-4,oy]],'#69544b');p.rect(ox-1,oy-3,3,7,'#a57758');}
  // Distinct roof patterns follow all rings, including every source courtyard hole.
  const roofs=new Map(),primary=new Set(campus.landmarks.map(l=>l.buildingId));
  for(const b of campus.buildings){
    const rings=b.rings.map(r=>r.map(a=>xy(...a))),roof=['DEN','SUZ','RAI','SAV','MGH','GRB','GUG','JHN'].includes(b.code)?C.slate:['HUB','KNE'].includes(b.code)?'#a8a49a':'#a58c79',border=primary.has(b.id)?'#5b5960':'#7b766b';
    if(drawBuildings){p.polygon(rings,border);for(const ring of rings)p.stroke(ring,border,3);
    }
    const xs=b.rings[0].map(v=>v[0]),zs=b.rings[0].map(v=>v[1]),bounds=[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)],a=xy(bounds[0],bounds[1]),d=xy(bounds[2],bounds[3]);
    if(drawBuildings){for(let yy=Math.max(0,a[1]);yy<=Math.min(height-1,d[1]);yy++)for(let xx=Math.max(0,a[0]);xx<=Math.min(width-1,d[0]);xx++){const [wx,wz]=from(xx+.5,yy+.5);if(!inFootprint(wx,wz,b.rings))continue;let color=roof;if(yy%5===0)color=tint(roof,-.12);else if((xx+Math.floor(yy/5)*2)%9===0)color=tint(roof,.12);p.put(xx,yy,color);}
    for(const ring of rings)p.stroke(ring,primary.has(b.id)?'#d9c89f':'#b4aa91',2);
    const horizontal=d[0]-a[0]>d[1]-a[1],ridge=horizontal?Math.round((a[1]+d[1])/2):Math.round((a[0]+d[0])/2);
    for(let n=horizontal?a[0]+4:a[1]+4;n<(horizontal?d[0]:d[1])-3;n++){const [xx,yy]=horizontal?[n,ridge]:[ridge,n],[wx,wz]=from(xx,yy);if(inFootprint(wx,wz,b.rings)){p.put(xx,yy,'#485f70');p.put(xx+(horizontal?0:1),yy+(horizontal?1:0),'#acb8b6');}}
    if(['SUZ','RAI','SAV'].includes(b.code)){for(let n=0;n<11;n++){const xx=Math.round(a[0]+5+n*(d[0]-a[0]-10)/10),yy=d[1]-4,[wx,wz]=from(xx,yy);if(inFootprint(wx,wz,b.rings)){p.rect(xx-1,yy-3,3,4,C.cream);p.put(xx,yy-2,'#576780');}}}
    if(b.code==='DEN'){const [cx,cy]=xy(-72,-242);p.rect(cx-5,cy-5,11,11,'#454953');p.circle(cx,cy,5,'#d9c7a4');p.circle(cx,cy,3,'#668687');p.put(cx-1,cy-2,'#b1c3aa');p.rect(cx-1,cy-7,2,3,'#e7d1a2');}
    if(b.code==='HUB'||b.code==='KNE'){for(let xx=a[0]+5;xx<d[0]-4;xx+=8){const yy=d[1]-5,[wx,wz]=from(xx,yy);if(inFootprint(wx,wz,b.rings)){p.rect(xx,yy-3,4,3,'#d4c6a8');p.rect(xx+1,yy-2,2,2,'#637c84');}}}
    }
    roofs.set(b.id,{rings,bounds,code:b.code});
  }
  const landscape=campusLandscape(campus),treePositions=landscape.trees;
  if(drawTrees)for(const t of treePositions){const [px,py]=xy(t.x,t.z);p.blit(pixelTree(t.kind,Number(t.id.split('-').at(-1))),px-10,py-10);}
  // Drumheller: top-down concentric pool and four rose quadrants on the real vista axis.
  const [fx,fy]=xy(FOUNTAIN.x,FOUNTAIN.z),r=Math.round(FOUNTAIN.waterRadius*s),garden=FOUNTAIN_GARDEN;
  const reach=Math.ceil(garden.bedOuterRadius*s);
  for(let yy=-reach;yy<=reach;yy++)for(let xx=-reach;xx<=reach;xx++){
    const d=Math.hypot(xx,yy)/s,a=Math.atan2(yy,xx)-garden.axisAngle,gap=Math.abs(Math.sin(a*2))<Math.sin(garden.gateHalfAngle*2);
    if(d<garden.walkOuterRadius){const seam=Math.abs((d-FOUNTAIN.rimRadius)%2.4)<.06||Math.abs(Math.sin((a+garden.axisAngle)*48)*d)<.09;p.put(fx+xx,fy+yy,seam?'#c4bda5':'#dcd7c4');}
    else if(d<garden.bedOuterRadius&&!gap){p.put(fx+xx,fy+yy,d<garden.bedInnerRadius+.5||d>garden.bedOuterRadius-.7?'#697b4e':'#756549');if(d>garden.bedInnerRadius+1&&d<garden.bedOuterRadius-1&&pixelHash(xx,yy)%13===0)p.put(fx+xx,fy+yy,['#c397ab','#e3bfac','#d8c785'][pixelHash(xx+1,yy)%3]);}
  }
  p.circle(fx,fy,r+4,'#6a7271');p.circle(fx,fy,r+2,'#ddd8c3');p.circle(fx,fy,r,'#4c7b87');
  for(let yy=-r+2;yy<r-2;yy++)for(let xx=-r+2;xx<r-2;xx++)if(xx*xx+yy*yy<(r-2)**2&&pixelHash(xx,yy)%53===0)p.rect(fx+xx,fy+yy,2,1,'#709da2');
  if(drawProps)for(const b of landscape.benches){const [px,py]=xy(...b.point);p.rect(px-2,py-1,5,2,b.material==='Stone'?'#ddd8c7':'#9d7d55');}
  const bounds=explorationBounds(campus),corners=[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]];for(let i=0;i<4;i++){line(corners[i],corners[(i+1)%4],'#426c53',4);line(corners[i],corners[(i+1)%4],'#719467',2);const a=corners[i],b=corners[(i+1)%4],length=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let n=0;n<length;n+=9){const t=n/length,[px,py]=xy(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);p.rect(px-1,py-1,3,3,'#c4b18c');}}
  return {raster:p,width,height,pixelsPerMetre:s,toPixel:xy,toWorld:from,roofs,treePositions,fountain:{x:fx,y:fy,r},metrics:{style:'true-2d-top-down-pixel',version:PIXEL_CAMPUS_VERSION,buildings:campus.buildings.length,courtyards:campus.buildings.reduce((n,b)=>n+b.rings.length-1,0),landmarks:campus.landmarks.length,trees:treePositions.length,cherryTrees:treePositions.filter(v=>v.kind==='cherry').length,sourceGeometryHash:campus.geometryHash,threeDimensionalProjection:false}};
}
