import {LANDSCAPE_SOURCE} from './campus-landscape-data.js';
import {FOUNTAIN} from './campus-layout.js';

export const FOUNTAIN_GARDEN={walkOuterRadius:38.8,bedInnerRadius:39.8,bedOuterRadius:47.3,
  axisAngle:Math.atan2(FOUNTAIN.z-26.65,FOUNTAIN.x+122.17),gateHalfAngle:.14};
const contains=(x,z,ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
const inBuilding=(x,z,b)=>contains(x,z,b.rings[0])&&!b.rings.slice(1).some(r=>contains(x,z,r));
export const pathDistance=(x,z,paths)=>{
  let best={distance:Infinity,angle:0};
  for(const path of paths)for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[2]-a[2],len=dx*dx+dz*dz;
    const t=len?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/len)):0,d=Math.hypot(x-a[0]-dx*t,z-a[2]-dz*t);
    if(d<best.distance)best={distance:d,angle:Math.atan2(dz,dx)};
  }return best;
};
const memo=new WeakMap();
export function campusLandscape(campus){
  if(memo.has(campus))return memo.get(campus);
  if(campus.geometryHash!==LANDSCAPE_SOURCE.geometryHash)throw Error('Landscape snapshot belongs to a different campus geometry');
  const rejected=[],usable=row=>{
    const [x,z]=row.point,[x0,z0,x1,z1]=campus.bounds;let reason;
    if(x<x0||x>x1||z<z0||z>z1)reason='outside-display-crop';
    else if(Math.hypot(x-FOUNTAIN.x,z-FOUNTAIN.z)<FOUNTAIN.rimRadius+.5)reason='conflict-with-pool-snapshot';
    else if(campus.buildings.some(b=>inBuilding(x,z,b)))reason='conflict-with-building-snapshot';
    if(reason){rejected.push({id:row.id,reason});return false;}return true;
  };
  const trees=LANDSCAPE_SOURCE.trees.filter(usable).map(t=>{
    const kind=/prunus.*(?:yedoensis|serrulata|sargentii|subhirtella)|cherry/i.test(t.species+' '+t.commonName)?'cherry':/conifer/i.test(t.treeType)&&!/deciduous/i.test(t.treeType)?'conifer':'broadleaf';
    // Coordinates never jitter. Canopy/height are illustrative, not source-height unit assumptions.
    const seed=Number(t.id.split('-').at(-1)),size=(seed%5)*.22;
    return {...t,x:t.point[0],z:t.point[1],kind,crownWidth:(kind==='cherry'?8.4:kind==='conifer'?6.1:7.2)+size,height:(kind==='conifer'?13.2:kind==='cherry'?8.6:10.6)+size};
  });
  const benches=LANDSCAPE_SOURCE.benches.filter(b=>{
    if(b.status!=='Active'){rejected.push({id:b.id,reason:'not-active-in-public-snapshot'});return false;}return usable(b);
  }).map(b=>{
    const r=Math.hypot(b.point[0]-FOUNTAIN.x,b.point[1]-FOUNTAIN.z),angle=r<50?Math.atan2(b.point[1]-FOUNTAIN.z,b.point[0]-FOUNTAIN.x)+Math.PI/2:pathDistance(...b.point,campus.paths).angle;
    return {...b,angle,length:b.material==='Stone'?2.2:1.9,width:.66,height:b.material==='Stone'?.63:.94};
  });
  const result={trees,benches,rejected,sources:LANDSCAPE_SOURCE.sources,
    metrics:{sourceTrees:LANDSCAPE_SOURCE.trees.length,sourceBenches:LANDSCAPE_SOURCE.benches.length,
      displayedTrees:trees.length,displayedBenches:benches.length,rejected:rejected.length,randomlyPlacedTrees:0,
      positions:'official-public-GIS-snapshot',canopiesAndBenchOrientations:'inferred'}};
  memo.set(campus,result);return result;
}
