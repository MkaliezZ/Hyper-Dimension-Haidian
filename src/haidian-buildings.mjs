// Build real school-specific surfaces from the same resolved parts used for collision.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {baseRoot} from './base.mjs';
import {surfaceProject} from '../public/surface-depth.js';
const {default:earcut,deviation}=await import(pathToFileURL(join(baseRoot,'node_modules/three/src/extras/lib/earcut.js')).href);

export function buildHaidianArchitecturalMesh(building){
  const architecture=building.architecture,faces=[];let maxDeviation=0;
  const profile={...building.schoolProfile,height:building.height,wallHeight:building.height,architectureKind:architecture.kind};
  function triangle(points,kind,uv,material,extra={}){
    if(points.some(p=>!p.every(Number.isFinite)))throw Error('Nonfinite architecture vertex: '+building.id);
    const a=points[1].map((v,i)=>v-points[0][i]),b=points[2].map((v,i)=>v-points[0][i]),n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=Math.hypot(...n);
    if(length<1e-9)return;
    faces.push({points,kind,uv,material,normal:n.map(v=>v/length),profile,...extra});
  }
  function quad(a,b,c,d,kind,material,P,uv=[[0,0],[1,0],[1,1],[0,1]],extra={}){
    triangle([a,b,c],kind,[uv[0],uv[1],uv[2]],material,{profile:P,...extra});
    triangle([a,c,d],kind,[uv[0],uv[2],uv[3]],material,{profile:P,...extra});
  }
  function flat(rings,y,material,P,kind='roof'){
    const coords=[],holes=[];let count=0;
    for(let n=0;n<rings.length;n++){if(n)holes.push(count);for(const p of rings[n]){coords.push(...p);count++;}}
    const indices=earcut(coords,holes,2),points=rings.flat();maxDeviation=Math.max(maxDeviation,deviation(coords,holes,2,indices));
    for(let n=0;n<indices.length;n+=3){const a=points[indices[n]],b=points[indices[n+1]],c=points[indices[n+2]];triangle([a,b,c].map(p=>[p[0],typeof y==='function'?y(p):y,p[1]]),kind,[a,b,c],material,{profile:P});}
  }
  for(const part of architecture.parts){
    const rings=part.rings.map(r=>r.slice(0,-1));
    const P={...profile,family:part.material,window:part.window,wallHeight:part.eave,base:part.bottom,floors:part.floors||1,floorHeight:(part.eave-part.bottom)/(part.floors||1),bay:part.bay,partRole:part.role};
    const angle=architecture.frame.angle,ca=Math.cos(angle),sa=Math.sin(angle),base=rings.flat(),us=base.map(([x,z])=>x*ca+z*sa),vs=base.map(([x,z])=>-x*sa+z*ca),u0=Math.min(...us),u1=Math.max(...us),v0=Math.min(...vs),v1=Math.max(...vs),W=u1-u0,D=v1-v0;
    const point=(u,y,v)=>[u*ca-v*sa,y,u*sa+v*ca];
    if(part.shape==='chinese-roof'){
      const h=part.eave,rise=part.rise,swap=D>W,roofW=swap?D:W,roofD=swap?W:D,ridgeHalf=Math.max(0,(roofW-roofD*.78)/2),cx=(u0+u1)/2,cz=(v0+v1)/2;
      const roofPoint=(u,v)=>{
        const x=(u-.5)*roofW,z=(v-.5)*roofD,t=Math.min(1,Math.max(Math.abs(z)/(roofD/2),Math.max(0,(Math.abs(x)-ridgeHalf)/(roofW/2-ridgeHalf))));
        const corner=Math.pow(Math.abs(x)/(roofW/2),6)*Math.pow(Math.abs(z)/(roofD/2),4),curl=.52*corner*Math.pow(Math.max(0,(t-.64)/.36),2);
        return point(u0+(swap?v:u)*W,h+rise*Math.pow(1-t,1.5)+curl,v0+(swap?u:v)*D);
      };
      for(let x=0;x<20;x++)for(let z=0;z<12;z++){
        const uv=[[x/20,z/12],[(x+1)/20,z/12],[(x+1)/20,(z+1)/12],[x/20,(z+1)/12]];
        quad(...uv.map(([u,v])=>roofPoint(u,v)),'roof','chinese-tile',P,uv.map(([u,v])=>[u*roofW,v*roofD]));
      }
      // Thin red/gold eave edges and an actual raised ridge, never a solid room.
      for(const [a,b]of [[[0,0],[1,0]],[[1,0],[1,1]],[[1,1],[0,1]],[[0,1],[0,0]]])for(let n=0;n<16;n++){
        const A=roofPoint(a[0]+(b[0]-a[0])*n/16,a[1]+(b[1]-a[1])*n/16),B=roofPoint(a[0]+(b[0]-a[0])*(n+1)/16,a[1]+(b[1]-a[1])*(n+1)/16);
        quad(A,B,[B[0],B[1]-.19,B[2]],[A[0],A[1]-.19,A[2]],'trim','painted-beam',P);
      }
      const y=h+rise+.12;
      const ridge=(u,v)=>point(cx+(swap?v:u),y,cz+(swap?u:v));
      quad(ridge(-ridgeHalf-.35,-.14),ridge(ridgeHalf+.35,-.14),ridge(ridgeHalf+.35,.14),ridge(-ridgeHalf-.35,.14),'roof','chinese-tile',P);
      continue;
    }
    if(part.shape==='air-dome'){
      const center=(u0+u1)/2,radius=Math.min(D*.42,W*.24),bodyHalf=Math.max(0,W/2-radius);
      const dome=(u,theta)=>{
        const x=u0+W*u,edge=Math.max(0,Math.abs(x-center)-bodyHalf)/radius,cap=Math.sqrt(Math.max(0,1-edge*edge));
        return point(x,part.eave+part.rise*cap*Math.sin(theta),(v0+v1)/2+D/2*cap*Math.cos(theta));
      };
      for(let x=0;x<36;x++)for(let n=0;n<22;n++){
        const a=dome(x/36,n/22*Math.PI),b=dome((x+1)/36,n/22*Math.PI),c=dome((x+1)/36,(n+1)/22*Math.PI),d=dome(x/36,(n+1)/22*Math.PI);
        quad(a,b,c,d,'roof','membrane',P,[[x/36*W,n/22*D],[(x+1)/36*W,n/22*D],[(x+1)/36*W,(n+1)/22*D],[x/36*W,(n+1)/22*D]]);
      }
      for(const ring of rings)for(let n=0;n<ring.length;n++){const a=ring[n],b=ring[(n+1)%ring.length];quad([a[0],0,a[1]],[b[0],0,b[1]],[b[0],part.eave,b[1]],[a[0],part.eave,a[1]],'wall','stone',{...P,window:'none'});}
      continue;
    }
    const topAt=([x,z])=>part.eave+(part.slope?.[0]||0)*((x*ca+z*sa-u0)/W-.5)+(part.slope?.[1]||0)*((-x*sa+z*ca-v0)/D-.5);
    for(const ring of rings){
      let offset=0;
      for(let n=0;n<ring.length;n++){
        const a=ring[n],b=ring[(n+1)%ring.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
        quad([a[0],part.bottom,a[1]],[b[0],part.bottom,b[1]],[b[0],topAt(b),b[1]],[a[0],topAt(a),a[1]],'wall',part.material,P,[[offset,part.bottom],[offset+len,part.bottom],[offset+len,topAt(b)],[offset,topAt(a)]],{edgeLength:len,edgeSeed:n,normal:[(b[1]-a[1])/len,0,-(b[0]-a[0])/len]});offset+=len;
      }
    }
    if(part.roof==='mansard'){
      const material=part.roofMaterial||'slate',inset=Math.min(W*.12,D*.12,4.5),inner=Math.min(W*.24,D*.24,6.5),h=part.eave;
      const ringAt=(inset,y)=>[[u0+inset,y,v0+inset],[u1-inset,y,v0+inset],[u1-inset,y,v1-inset],[u0+inset,y,v1-inset]].map(p=>point(...p));
      const levels=[ringAt(0,h),ringAt(inset,h+part.rise*.78),ringAt(inner,h+part.rise)];
      for(let level=0;level<2;level++)for(let n=0;n<4;n++){const i=(n+1)%4;quad(levels[level][n],levels[level][i],levels[level+1][i],levels[level+1][n],'roof',material,P,[[0,0],[W,0],[W,D],[0,D]]);}
      quad(...levels[2],'roof',material,P,[[0,0],[W,0],[W,D],[0,D]]);
      if(part.roofWindows){
        const count=Math.max(2,Math.floor((W-6)/7)),v=v1-inset*.45,y=h+part.rise*.40;
        for(let n=0;n<count;n++){
          const u=u0+3+(W-6)*(n+.5)/count,w=.65,glassP={...P,window:'curtain',partRole:'roof-window',bay:1.3};
          quad(point(u-w,y,v),point(u+w,y,v),point(u+w,y+.75,v),point(u-w,y+.75,v),'wall','glass',glassP,[[0,0],[1.3,0],[1.3,.75],[0,.75]]);
          quad(point(u-w,y+.75,v),point(u+w,y+.75,v),point(u+w,y+.83,v-.8),point(u-w,y+.83,v-.8),'roof',material,P);
        }
      }
    }else if(part.roof==='gable'){
      if(part.roofAxis==='v'){
        const mid=(u0+u1)/2,top=part.eave+part.rise,material=part.roofMaterial||'slate';
        quad(point(u0,part.eave,v0),point(mid,top,v0),point(mid,top,v1),point(u0,part.eave,v1),'roof',material,P,[[0,0],[W/2,0],[W/2,D],[0,D]]);
        quad(point(mid,top,v0),point(u1,part.eave,v0),point(u1,part.eave,v1),point(mid,top,v1),'roof',material,P,[[W/2,0],[W,0],[W,D],[W/2,D]]);
        for(const v of [v0,v1])triangle([point(u0,part.eave,v),point(u1,part.eave,v),point(mid,top,v)],'wall',[[0,part.eave],[W,part.eave],[W/2,top]],part.material,{profile:{...P,window:'none'}});
        continue;
      }
      const mid=(v0+v1)/2,top=part.eave+part.rise,roofMaterial=part.roofMaterial||'slate';
      quad(point(u0-.3,part.eave,v0-.3),point(u1+.3,part.eave,v0-.3),point(u1+.3,top,mid),point(u0-.3,top,mid),'roof',roofMaterial,P,[[0,0],[W,0],[W,D/2],[0,D/2]]);
      quad(point(u0-.3,top,mid),point(u1+.3,top,mid),point(u1+.3,part.eave,v1+.3),point(u0-.3,part.eave,v1+.3),'roof',roofMaterial,P,[[0,D/2],[W,D/2],[W,D],[0,D]]);
      for(const u of [u0,u1])triangle([point(u,part.eave,v0),point(u,part.eave,v1),point(u,top,mid)],'wall',[[0,part.eave],[D,part.eave],[D/2,top]],part.material,{profile:{...P,window:'none'}});
    }else flat(rings,topAt,part.roofMaterial||((part.role==='platform'||part.role==='step')?'stone':part.material==='glass'?'glass':part.material==='brick'?'flat-roof':part.material),P);
  }
  const projected=faces.flatMap(f=>f.points.map(surfaceProject));
  return {faces,profile,bounds:[Math.min(...projected.map(p=>p[0])),Math.min(...projected.map(p=>p[1])),Math.max(...projected.map(p=>p[0])),Math.max(...projected.map(p=>p[1]))],area:building.rings[0].reduce((n,p,i,a)=>{const q=a[(i+1)%a.length];return n+p[0]*q[1]-q[0]*p[1];},0)/2,groundRings:building.rings.map(r=>r.slice(0,-1)),triangulationDeviation:maxDeviation,meshVertices:projected.length};
}
