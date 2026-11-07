// Original Haidian ground art using UW's existing raster/projection interface.
import {PixelRaster,rgba,pixelHash} from './pixel-raster.js';
import {campusLandscape} from './campus-landscape.js';
export const PIXEL_CAMPUS_VERSION='haidian-pixel-campus-1.1.0';
export const PIXEL_PALETTE={grass:'#9db885',path:'#e5dcc8',road:'#a9b3af',water:'#63aeb8',brick:'#ac7060',cream:'#e5d5b4',slate:'#687e8e'};
const ringContains=(x,z,r)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
export const inFootprint=(x,z,rings)=>ringContains(x,z,rings[0])&&!rings.slice(1).some(r=>ringContains(x,z,r));
export function pixelTree(kind='green',seed=1){
 const p=new PixelRaster(21,27);p.rect(9,16,3,10,'#736c53');
 if(kind==='conifer'){for(let n=0;n<3;n++)p.polygon([[10,1+n*5],[1,13+n*5],[19,13+n*5]],['#4e765d','#5e8967','#709870'][n]);}
 else{for(const [x,y,r]of [[7,8,6],[13,9,7],[9,14,6]])p.circle(x,y,r,'#5d8260');for(const [x,y,r]of [[6,7,5],[12,7,5],[9,12,5]])p.circle(x,y,r,seed%4===0?'#c5ac66':'#94ad70');p.circle(7,5,3,'#c4cf91');}
 return p;
}
export function createPixelCampusArt(campus,{pixelsPerMetre=2,drawBuildings=true,drawTrees=true,drawProps=true}={}){
 const [x0,z0,x1,z1]=campus.bounds,s=pixelsPerMetre,width=Math.ceil((x1-x0)*s),height=Math.ceil((z1-z0)*s),p=new PixelRaster(width,height),C=PIXEL_PALETTE;
 const xy=(x,z)=>[Math.round((x-x0)*s),Math.round((z-z0)*s)],from=(x,y)=>[x/s+x0,y/s+z0],px=([x,z])=>[(x-480)*.8,(z-405)*.8];
 const poly=(r,c)=>p.polygon(r.map(a=>xy(...a)),c),planPoly=(r,c)=>poly(r.map(px),c),line=(a,b,c,w=1)=>p.line(...xy(...a),...xy(...b),c,Math.max(1,Math.round(w*s)));
 const rect=(x,z,w,h,c)=>planPoly([[x,z],[x+w,z],[x+w,z+h],[x,z+h]],c);
 const ellipse=(cx,cz,rx,rz,c)=>planPoly(Array.from({length:80},(_,n)=>[cx+Math.cos(n*Math.PI/40)*rx,cz+Math.sin(n*Math.PI/40)*rz]),c);
 p.rect(0,0,width,height,'#d3d8c7');for(let y=0;y<height;y+=14)for(let x=0;x<width;x+=14)if(pixelHash(x,y)%3===0)p.rect(x,y,11,10,'#c9d1bf');
 for(const r of campus.walkableAreas||[]){poly(r,C.grass);p.stroke(r.map(a=>xy(...a)),'#9aa784',Math.max(1,s));}
 for(let y=0;y<height;y+=8)for(let x=0;x<width;x+=8)if(p.pixels[y*width+x]===rgba(C.grass)&&pixelHash(x,y)%3===0){p.rect(x+2,y+2,2,1,'#c0cc92');p.rect(x+5,y+5,1,2,'#87a274');}
 for(const path of campus.paths)for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],w=path.kind==='road'?9:4;line([a[0],a[2]],[b[0],b[2]],'#b1b29d',w+1.2);line([a[0],a[2]],[b[0],b[2]],path.kind==='road'?C.road:C.path,w);}
 rect(145,58,665,9,'#8d9a9b');
 for(const r of campus.waterAreas||[]){poly(r,'#4a8c99');p.stroke(r.map(a=>xy(...a)),'#8bbdb8',Math.round(s*2));}
 for(let n=0;n<100;n++){const x=154+n*6.2,z=310+(x-154)*.642,[wx,wz]=px([x,z]);if(campus.waterAreas?.some(r=>ringContains(wx,wz,r)))line([wx,wz],[wx+3,wz],'#88c7ca',.7);}
 for(const r of campus.bridges||[]){poly(r,'#dcd7bd');p.stroke(r.map(a=>xy(...a)),'#aa9376',Math.round(s*1.5));}
 // Athletics field in the eastern sports area.
 rect(702,472,107,220,'#d6b19c');ellipse(756,582,49,108,'#ae6756');
 for(let i=0;i<5;i++)p.stroke(Array.from({length:80},(_,n)=>xy(...px([756+Math.cos(n*Math.PI/40)*(47-i*2),582+Math.sin(n*Math.PI/40)*(106-i*2)]))),'#e1bfa8',Math.max(1,Math.round(s*.45)));
 ellipse(756,582,36,94,'#6c9c68');rect(720,528,72,108,'#6d9d68');
 for(let n=0;n<8;n++)rect(721,529+n*13,70,6.5,n%2?'#7eac73':'#719f67');
 const stroke=(r,c,w=.6)=>p.stroke(r.map(a=>xy(...px(a))),c,Math.max(1,s*w));
 stroke([[724,532],[788,532],[788,631],[724,631]],'#dbe2bc');line(px([724,581.5]),px([788,581.5]),'#dbe2bc',.65);
 stroke(Array.from({length:48},(_,n)=>[756+10*Math.cos(n*Math.PI/24),582+10*Math.sin(n*Math.PI/24)]),'#dbe2bc');for(const z of [532,613])stroke([[741,z],[771,z],[771,z+18],[741,z+18]],'#dbe2bc');
 function court(x,z,w,h,type){rect(x,z,w,h,type==='tennis'?'#86a4a0':'#b99168');rect(x+2,z+2,w-4,h-4,type==='tennis'?'#557f78':'#a27761');stroke([[x+3,z+3],[x+w-3,z+3],[x+w-3,z+h-3],[x+3,z+h-3]],'#e4e3ce');line(px([x+2,z+h/2]),px([x+w-2,z+h/2]),'#e4e3ce',.5);line(px([x+w/2,z+3]),px([x+w/2,z+h-3]),'#d5d8bd',.5);}
 for(let r=0;r<3;r++)for(let col=0;col<2;col++)court(483+col*42,453+r*28,38,25,'tennis');
 for(let r=0;r<2;r++)for(let col=0;col<4;col++)court(179+col*32,691+r*18,29,16,'basketball');for(let col=0;col<4;col++)court(583+col*20,551,18,22,'tennis');
 for(const [x,z,rx,rz]of [[517,393,22,33],[271,617,12,14],[366,649,35,9]]){ellipse(x,z,rx,rz,'#c3cc9b');ellipse(x,z,rx*.65,rz*.65,'#89ae83');}
 const roofs=new Map();for(const b of campus.buildings){const rings=b.rings.map(r=>r.map(a=>xy(...a)));if(drawBuildings){
  if(b.architecture){for(const part of [...b.architecture.parts].sort((a,b)=>a.eave+(a.rise||0)-b.eave-(b.rise||0))){const shapes=part.rings.map(r=>r.map(a=>xy(...a))),color=part.shape==='chinese-roof'?'#667b70':part.material==='membrane'?'#eee9d8':part.material==='stone'?'#d3d4c4':part.material==='glass'?'#769ba5':part.material==='red-column'?'#9b4942':part.roof==='gable'?'#64706b':'#8e988b';p.polygon(shapes,color);if(part.shape==='chinese-roof'||part.solid)for(const r of shapes)p.stroke(r,'#b6b8a2',Math.max(1,s*.5));}}
  else{p.polygon(rings,b.schoolProfile?.family==='membrane'?'#eee9d8':C.slate);for(const r of rings)p.stroke(r,'#e1cfb0',2);}
 }roofs.set(b.id,{rings,code:b.code,bounds:[Math.min(...b.rings[0].map(p=>p[0])),Math.min(...b.rings[0].map(p=>p[1])),Math.max(...b.rings[0].map(p=>p[0])),Math.max(...b.rings[0].map(p=>p[1]))]});}
 const landscape=campusLandscape(campus),treePositions=landscape.trees;if(drawTrees)for(const [i,t]of treePositions.entries()){const [x,y]=xy(t.x,t.z);p.blit(pixelTree(t.kind,i),x-10,y-20);}
 return {raster:p,width,height,pixelsPerMetre:s,toPixel:xy,toWorld:from,roofs,treePositions,fountain:{x:0,y:0,r:0},metrics:{style:'haidian-schematic-north-up-pixel',version:PIXEL_CAMPUS_VERSION,buildings:campus.buildings.length,courtyards:campus.buildings.reduce((n,b)=>n+b.rings.length-1,0),landmarks:campus.landmarks.length,trees:treePositions.length,cherryTrees:0,sourceGeometryHash:campus.geometryHash,threeDimensionalProjection:false}};
}
