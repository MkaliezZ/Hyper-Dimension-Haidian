import {terrainHeight} from './terrain-surface.js';
import {RED_BOUNDARY,FOUNTAIN} from './campus-layout.js';
import {explorationBounds} from './campus-bounds.js';
import {RED_SEATING,RED_TOWERS,RED_OBELISK} from './red-square-layout.js';
export const WALK_SPEED=7.8;
export const GUIDE_SPEED=23.4;
export const WALK_RADIUS=.38;
const finitePoint=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
export function ringContains(x,z,ring){let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
const inBuilding=(x,z,rings)=>ringContains(x,z,rings[0])&&!rings.slice(1).some(r=>ringContains(x,z,r));
function edgeDistance(x,z,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz,t=d?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/d)):0;return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);}
function pointIndex(rows,bounds,cell=24){const bins=new Map();for(const row of rows){const b=bounds(row);for(let x=Math.floor(b[0]/cell);x<=Math.floor(b[2]/cell);x++)for(let z=Math.floor(b[1]/cell);z<=Math.floor(b[3]/cell);z++){const key=x+':'+z;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(row);}}const empty=[],lookup=(x,z)=>bins.get(Math.floor(x/cell)+':'+Math.floor(z/cell))||empty;lookup.box=(x0,z0,x1,z1)=>{const out=new Set();for(let x=Math.floor(x0/cell);x<=Math.floor(x1/cell);x++)for(let z=Math.floor(z0/cell);z<=Math.floor(z1/cell);z++)for(const row of bins.get(x+':'+z)||empty)out.add(row);return out;};return lookup;}
function segmentDistance(a,b,c,d){
 const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
 if(Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))&&Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]))&&cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)return 0;
 return Math.min(edgeDistance(...a,c,d),edgeDistance(...b,c,d),edgeDistance(...c,a,b),edgeDistance(...d,a,b));
}
export function createCampusWalking(campus){
  const bounds=explorationBounds(campus);
  const buildings=campus.buildings.flatMap(b=>(b.architecture?.collisionParts||[b.rings]).map(rings=>({...b,rings,bounds:[Math.min(...rings[0].map(p=>p[0]))-WALK_RADIUS,Math.min(...rings[0].map(p=>p[1]))-WALK_RADIUS,Math.max(...rings[0].map(p=>p[0]))+WALK_RADIUS,Math.max(...rings[0].map(p=>p[1]))+WALK_RADIUS]})));
  const architectureSurfaces=campus.buildings.flatMap(b=>b.architecture?.walkSurfaces||[]);
  const regionEdges=[...(campus.walkableAreas||[]),...(campus.waterAreas||[]),...(campus.bridges||[])].flatMap(r=>r.slice(1).map((b,i)=>[r[i],b]));
  const paths=campus.paths.flatMap(p=>p.points.slice(1).map((b,i)=>({a:[p.points[i][0],p.points[i][2]],b:[b[0],b[2]],width:p.kind==='road'?3.5:1.55,offset:p.kind==='road'?.15:.28})));
  const nearbyBuildings=pointIndex(buildings,b=>b.bounds),nearbyPaths=pointIndex(paths,p=>[Math.min(p.a[0],p.b[0])-p.width,Math.min(p.a[1],p.b[1])-p.width,Math.max(p.a[0],p.b[0])+p.width,Math.max(p.a[1],p.b[1])+p.width]);
  const solidProps=[...RED_TOWERS.map(p=>[p.x,p.z,p.collisionRadius]),[RED_OBELISK.x,RED_OBELISK.z,RED_OBELISK.collisionRadius],...RED_SEATING.map(p=>[p.x,p.z,p.collisionRadius])];
  const withinBounds=(x,z)=>Number.isFinite(x)&&Number.isFinite(z)&&x>=bounds[0]+WALK_RADIUS&&z>=bounds[1]+WALK_RADIUS&&x<=bounds[2]-WALK_RADIUS&&z<=bounds[3]-WALK_RADIUS;
  function allowed(x,z){
    if(!withinBounds(x,z))return false;
    if(campus.walkableAreas?.length&&!campus.walkableAreas.some(r=>ringContains(x,z,r)))return false;
    if(campus.waterAreas?.some(r=>ringContains(x,z,r))&&!campus.bridges?.some(r=>ringContains(x,z,r)))return false;
    if(Math.hypot(x-FOUNTAIN.x,z-FOUNTAIN.z)<FOUNTAIN.rimRadius+WALK_RADIUS)return false;
    if(solidProps.some(([px,pz,r])=>Math.hypot(x-px,z-pz)<r+WALK_RADIUS))return false;
    for(const b of nearbyBuildings(x,z)){if(x<b.bounds[0]||z<b.bounds[1]||x>b.bounds[2]||z>b.bounds[3])continue;if(inBuilding(x,z,b.rings))return false;for(const ring of b.rings)for(let i=0;i<ring.length;i++)if(edgeDistance(x,z,ring[i],ring[(i+1)%ring.length])<WALK_RADIUS)return false;}
    return true;
  }
  function height(x,z){let offset=.055;if(ringContains(x,z,RED_BOUNDARY))offset=.57;else if(Math.hypot(x-FOUNTAIN.x,z-FOUNTAIN.z)<FOUNTAIN.promenadeRadius)offset=.47;else for(const p of nearbyPaths(x,z))if(edgeDistance(x,z,p.a,p.b)<=p.width)offset=Math.max(offset,p.offset);for(const surface of architectureSurfaces)if(inBuilding(x,z,surface.rings))offset=Math.max(offset,surface.height+.055);return terrainHeight(campus.terrain,x,z)+offset;}
  function segmentClear(a,b){
    if(!finitePoint(a)||!finitePoint(b))return false;
    // Exact swept clearance prevents re-sampling a long path from clipping a
    // curved facade or a thin pavilion post between the 25 cm ground samples.
    const x0=Math.min(a[0],b[0])-WALK_RADIUS,x1=Math.max(a[0],b[0])+WALK_RADIUS,z0=Math.min(a[2],b[2])-WALK_RADIUS,z1=Math.max(a[2],b[2])+WALK_RADIUS;
    for(const building of nearbyBuildings.box(x0,z0,x1,z1))for(const ring of building.rings)for(let n=0;n<ring.length-1;n++){
      const c=ring[n],d=ring[n+1];if(Math.max(c[0],d[0])<x0||Math.min(c[0],d[0])>x1||Math.max(c[1],d[1])<z0||Math.min(c[1],d[1])>z1)continue;
      if(segmentDistance([a[0],a[2]],[b[0],b[2]],c,d)<WALK_RADIUS)return false;
    }
    // Split at every region boundary, including concave campus corners and
    // overlapping bridge/water polygons. A short off-campus interval must not
    // disappear when a long valid-looking segment is later resampled.
    const dx=b[0]-a[0],dz=b[2]-a[2],cuts=[0,1];
    for(const [c,d]of regionEdges){
      if(Math.max(c[0],d[0])<x0||Math.min(c[0],d[0])>x1||Math.max(c[1],d[1])<z0||Math.min(c[1],d[1])>z1)continue;
      const ex=d[0]-c[0],ez=d[1]-c[1],den=dx*ez-dz*ex;if(Math.abs(den)<1e-10)continue;
      const qx=c[0]-a[0],qz=c[1]-a[2],t=(qx*ez-qz*ex)/den,u=(qx*dz-qz*dx)/den;
      if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t);
    }
    cuts.sort((a,b)=>a-b);for(let n=1;n<cuts.length;n++){const t=(cuts[n-1]+cuts[n])/2;if(!allowed(a[0]+dx*t,a[2]+dz*t))return false;}
    const length=Math.hypot(b[0]-a[0],b[2]-a[2]),count=Math.max(1,Math.ceil(length/.25));let previous=height(a[0],a[2]);
    for(let i=0;i<=count;i++){const t=i/count,x=a[0]+(b[0]-a[0])*t,z=a[2]+(b[2]-a[2])*t;if(!allowed(x,z))return false;const y=height(x,z);if(i&&Math.abs(y-previous)>Math.max(.65,length/count))return false;previous=y;}return true;
  }
  function step(from,direction,durationMs){
    if(!finitePoint(from)||!Array.isArray(direction)||direction.length!==2||!direction.every(Number.isFinite)||!Number.isFinite(durationMs)||durationMs<=0||durationMs>500)throw Error('Invalid walking input');
    const magnitude=Math.hypot(...direction);if(magnitude<.001||magnitude>1.001)throw Error('Walking direction must be normalized');
    const travel=WALK_SPEED*durationMs/1000,count=Math.ceil(travel/.18),dx=direction[0]/magnitude*travel/count,dz=direction[1]/magnitude*travel/count;
    let point=[from[0],height(from[0],from[2]),from[2]],blocked=false,boundaryBlocked=false;const path=[{levelId:'outdoors',point:[...point]}];
    for(let i=0;i<count;i++){
      const choices=[[point[0]+dx,0,point[2]+dz],[point[0]+dx,0,point[2]],[point[0],0,point[2]+dz]].filter(p=>Math.hypot(p[0]-point[0],p[2]-point[2])>.00001);
      if(!withinBounds(point[0]+dx,point[2]+dz))boundaryBlocked=true;
      const next=choices.find(p=>segmentClear(point,p));if(!next){blocked=true;break;}if(next!==choices[0])blocked=true;point=[next[0],height(next[0],next[2]),next[2]];path.push({levelId:'outdoors',point:[...point]});
    }
    const distance=path.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.point.map((v,j)=>v-path[i].point[j])),0);
    return {path,distance,blocked,boundaryBlocked,previewSpeed:distance/(durationMs/1000),durationMs};
  }
  return {allowed,height,segmentClear,step,bounds};
}
