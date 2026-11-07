// Dimensionally registered school artwork. GIS footprint, hole topology and inferred
// height are separate from the shared material language and architectural details.
import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {baseRoot} from './base.mjs';
const {default:earcut,deviation}=await import(pathToFileURL(join(baseRoot,'node_modules/three/src/extras/lib/earcut.js')).href);
import {inFootprint} from '../public/pixel-campus-art.js';
import {buildingStyle} from '../public/oblique-buildings.js';
import {surfaceProject} from '../public/surface-depth.js';
import {buildHaidianArchitecturalMesh} from './haidian-buildings.mjs';
export const BUILDING_LANGUAGE='haidian-photo-reviewed-architecture-1.1.0';
const LANDMARKS={DEN:{family:'sandstone',window:'roman',roof:3.4,feature:'cupola'},SUZ:{family:'collegiate',window:'great-gothic',roof:4.8,feature:'pinnacles'},RAI:{family:'collegiate',window:'gothic',roof:4.5},SAV:{family:'collegiate',window:'gothic',roof:4.8},HUB:{family:'contemporary',window:'curtain',roof:.7},KNE:{family:'contemporary',window:'colonnade',roof:.5},OUG:{family:'contemporary',window:'curtain',roof:.6}};
const distance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz,t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/d)):0;return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);};
export function footprintArea(rings){return rings.reduce((sum,ring,index)=>sum+(index?-1:1)*Math.abs(ring.reduce((n,p,i)=>{const q=ring[(i+1)%ring.length];return n+p[0]*q[1]-q[0]*p[1];},0))/2,0);}
export function buildingRecipe(building){
  const family=building.schoolProfile?.family||buildingStyle(building),override=building.schoolProfile||LANDMARKS[building.code]||{},profile={family,window:['collegiate','sandstone'].includes(family)?'gothic':'regular',roof:['collegiate','sandstone','timber'].includes(family)?Math.min(4,building.height*.22):.65,...override};
  profile.height=building.height;profile.wallHeight=building.height-profile.roof-(profile.feature==='cupola'?4.4:0);profile.wallHeight=Math.max(profile.family==='membrane'?2:4,profile.wallHeight);return profile;
}
export function buildArchitecturalMesh(building){
  if(building.architecture)return buildHaidianArchitecturalMesh(building);
  const profile=buildingRecipe(building),rings=building.rings.map(r=>r.length>1&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1]?r.slice(0,-1):r),faces=[],flat=[],holes=[];let count=0;
  for(let i=0;i<rings.length;i++){if(i)holes.push(count);for(const p of rings[i]){flat.push(...p);count++;}}
  const indices=earcut(flat,holes,2),base=rings.flat(),edges=rings.flatMap(r=>r.map((a,i)=>[a,r[(i+1)%r.length]]));
  const edgeClearance=p=>Math.min(...edges.map(([a,b])=>distance(p,a,b)));
  let clearance=1;
  for(const p of base)for(const q of base.slice(0,12)){const m=[(p[0]+q[0])/2,(p[1]+q[1])/2];if(inFootprint(...m,building.rings))clearance=Math.max(clearance,edgeClearance(m));}
  const westWeight=p=>Math.max(0,Math.min(1,(-8-p[0])/18));
  const wallHeight=p=>building.code==='SUZ'?13.1+4.9*westWeight(p):profile.wallHeight;
  const roofHeight=p=>{
    if(profile.family==='membrane'){const xs=base.map(p=>p[0]),zs=base.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs),short=x1-x0<z1-z0,lo=short?x0:z0,hi=short?x1:z1,v=short?p[0]:p[1];return profile.wallHeight+profile.roof*Math.sqrt(Math.max(0,1-((v-(lo+hi)/2)/((hi-lo)/2))**2));}
    if(building.code==='SUZ'){
      const weight=westWeight(p),gable=Math.max(0,1-Math.abs(p[0]+43)/23),edgeEnd=Math.min(1,edgeClearance(p)/2.5);
      return wallHeight(p)+(weight*4.8*gable+(1-weight)*.45)*edgeEnd;
    }
    return wallHeight(p)+profile.roof*Math.min(1,edgeClearance(p)/clearance);
  };
  const add=(points,kind,uv,extra={})=>faces.push({points,kind,uv,profile,...extra});
  for(const ring of rings)for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.03)continue;
    const ha=wallHeight(a),hb=wallHeight(b),midx=(a[0]+b[0])/2,west=building.code==='SUZ'&&midx<-25,annex=building.code==='SUZ'&&midx>-15;
    const facadeProfile={...profile,wallHeight:(ha+hb)/2,...(west?{family:'sandstone',window:'great-gothic'}:annex?{family:'contemporary',window:'curtain'}:building.code==='SUZ'?{window:'gothic'}:{})};
    const A=[a[0],0,a[1]],B=[b[0],0,b[1]],C=[b[0],hb,b[1]],D=[a[0],ha,a[1]],extra={profile:facadeProfile,edgeLength:len,edgeSeed:i,normal:[(b[1]-a[1])/len,0,-(b[0]-a[0])/len]};
    add([A,B,C],'wall',[[0,0],[len,0],[len,hb]],extra);add([A,C,D],'wall',[[0,0],[len,hb],[0,ha]],extra);
  }
  const subdivide=(a,b,c,depth=0)=>{
    const lengths=[Math.hypot(a[0]-b[0],a[1]-b[1]),Math.hypot(b[0]-c[0],b[1]-c[1]),Math.hypot(c[0]-a[0],c[1]-a[1])],max=Math.max(...lengths);
    if(max>3&&depth<16){const i=lengths.indexOf(max),v=[a,b,c],A=v[i],B=v[(i+1)%3],C=v[(i+2)%3],m=[(A[0]+B[0])/2,(A[1]+B[1])/2];subdivide(A,m,C,depth+1);subdivide(m,B,C,depth+1);return;}
    const mid=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3];
    add([a,b,c].map(p=>[p[0],roofHeight(p),p[1]]),'roof',[a,b,c],{profile:building.code==='SUZ'&&mid[0]>-15?{...profile,roof:.45}:profile});
  };
  for(let i=0;i<indices.length;i+=3)subdivide(base[indices[i]],base[indices[i+1]],base[indices[i+2]]);
  // Cupolas and pinnacles grow from the same roof and remain inside the footprint.
  // These are source-informed artistic features, not additional surveyed geometry.
  const pyramid=(cx,cz,r,bottom,top,kind='trim',sides=4)=>{
    const ring=Array.from({length:sides},(_,i)=>[cx+Math.cos(i/sides*Math.PI*2)*r,cz+Math.sin(i/sides*Math.PI*2)*r]);if(ring.some(p=>!inFootprint(...p,building.rings)))return;
    const apex=[cx,top,cz];for(let i=0;i<sides;i++){const a=ring[i],b=ring[(i+1)%sides];add([[a[0],bottom,a[1]],[b[0],bottom,b[1]],apex],kind,[[0,0],[r,0],[r/2,top-bottom]]);}
  };
  if(profile.feature==='cupola'){
    let center=building.centroid,clearance=-1;for(let x=Math.min(...base.map(p=>p[0]));x<Math.max(...base.map(p=>p[0]));x+=2)for(let z=Math.min(...base.map(p=>p[1]));z<Math.max(...base.map(p=>p[1]));z+=2){if(!inFootprint(x,z,building.rings))continue;const d=Math.min(...edges.map(([a,b])=>distance([x,z],a,b)));if(d>clearance){clearance=d;center=[x,z];}}
    const r=Math.min(2.8,clearance*.7),top=profile.height-1.7,ring=Array.from({length:8},(_,i)=>[center[0]+Math.cos(i/8*Math.PI*2)*r,center[1]+Math.sin(i/8*Math.PI*2)*r]);
    for(let i=0;i<8;i++){const a=ring[i],b=ring[(i+1)%8],bottomA=roofHeight(a)-.08,bottomB=roofHeight(b)-.08,len=Math.hypot(a[0]-b[0],a[1]-b[1]),A=[a[0],bottomA,a[1]],B=[b[0],bottomB,b[1]],C=[b[0],top,b[1]],D=[a[0],top,a[1]],extra={edgeLength:len};add([A,B,C],'cupola',[[0,0],[len,0],[len,top-bottomB]],extra);add([A,C,D],'cupola',[[0,0],[len,top-bottomB],[0,top-bottomA]],extra);}
    pyramid(...center,r+.06,top,profile.height,'copper',8);
  }
  if(profile.feature==='pinnacles')for(const [a,b]of edges){const len=Math.hypot(a[0]-b[0],a[1]-b[1]);if(len<15||(a[0]+b[0])/2>-25)continue;for(let s=3;s<len-2;s+=6){const t=s/len,cx=a[0]+(b[0]-a[0])*t,cz=a[1]+(b[1]-a[1])*t,to=[building.centroid[0]-cx,building.centroid[1]-cz],n=Math.hypot(...to),x=cx+to[0]/n*.8,z=cz+to[1]/n*.8;pyramid(x,z,.55,roofHeight([x,z])-.3,Math.min(profile.height,wallHeight([x,z])+3.4),'trim');}}
  const projected=faces.flatMap(f=>f.points.map(surfaceProject)),bounds=[Math.min(...projected.map(p=>p[0])),Math.min(...projected.map(p=>p[1])),Math.max(...projected.map(p=>p[0])),Math.max(...projected.map(p=>p[1]))];
  return {faces,profile,bounds,area:footprintArea(rings),groundRings:rings,triangulationDeviation:deviation(flat,holes,2,indices),meshVertices:projected.length};
}
