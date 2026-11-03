// Physical-size seats and fountain geometry share the buildings' depth projection.
import {FOUNTAIN} from '../public/campus-layout.js';
import {FOUNTAIN_GARDEN} from '../public/campus-landscape.js';
import {surfaceProject,DEPTH_GROUND,HEIGHT_SCALE} from '../public/surface-depth.js';
const face=(a,b,c)=>({points:[a,b,c],uv:[a,b,c].map(p=>[p[0],p[2]]),kind:'landscape'});
const rgb=(r,g,b)=>((Math.max(0,Math.min(255,Math.round(r))))|(Math.max(0,Math.min(255,Math.round(g)))<<8)|(Math.max(0,Math.min(255,Math.round(b)))<<16)|255<<24)>>>0;
const fill=c=>()=>rgb(...c);
export function drawLandscapeSolids(raster,landscape,addObject,material){
  const box=(cx,cz,y,w,d,h,angle,owner,color)=>{
    const c=Math.cos(angle),s=Math.sin(angle),corners=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([x,z])=>[cx+c*x-s*z,cz+s*x+c*z]);
    for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4],A=[a[0],y,a[1]],B=[b[0],y,b[1]],C=[b[0],y+h,b[1]],D=[a[0],y+h,a[1]],shade=i%2?.8:.93;for(const f of [face(A,B,C),face(A,C,D)])raster.triangle(f,owner,fill(color.map(v=>v*shade)));}
    const top=corners.map(p=>[p[0],y+h,p[1]]);raster.triangle(face(top[0],top[1],top[2]),owner,fill(color));raster.triangle(face(top[0],top[2],top[3]),owner,fill(color));
  };
  for(const bench of landscape.benches){
    const [x,z]=bench.point,a=bench.angle,stone=/Stone|Concrete/i.test(bench.material),col=stone?[235,231,212]:[161,122,77],oid=addObject({...bench,kind:'bench',placeId:null,name:'校园长椅',bounds:[...surfaceProject([x-1.6,1.1,z-1.6]).slice(0,2),...surfaceProject([x+1.6,0,z+1.6]).slice(0,2)]});
    // A dark contact plinth keeps pale stone seats legible against pale paving.
    if(stone)box(x,z,.04,bench.length,.6,.36,a,oid,[109,122,110]);
    box(x,z,.44,bench.length,.66,.13,a,oid,col);
    for(const u of [-.72,.72])box(x+Math.cos(a)*u,z+Math.sin(a)*u,0,.14,.49,.46,a,oid,stone?[169,170,155]:[63,74,66]);
    if(stone)continue;
    const bx=x-Math.sin(a)*.25,bz=z+Math.cos(a)*.25;
    for(const y of [.68,.87])box(bx,bz,y,bench.length,.11,.11,a,oid,col.map(v=>v*1.08));
    for(const u of [-.78,.78])box(bx+Math.cos(a)*u,bz+Math.sin(a)*u,.44,.08,.12,.49,a,oid,[67,77,67]);
  }
  // Four crescent beds are aligned to the Vista, with four open passage gates.
  // Their planting pattern is an interpretation of official photographs, not surveyed geometry.
  const G=FOUNTAIN_GARDEN;
  for(let q=0;q<4;q++){
    const oid=addObject({id:'fountain-rose-bed-'+q,kind:'garden',placeId:'fountain',point:[FOUNTAIN.x,FOUNTAIN.z],positionStatus:'photo-informed-artistic',bounds:[]});
    for(let step=0;step<72;step++){
      const a=G.axisAngle+q*Math.PI/2+G.gateHalfAngle+step/72*(Math.PI/2-2*G.gateHalfAngle),b=a+(Math.PI/2-2*G.gateHalfAngle)/72;
      const at=(r,y,t)=>[FOUNTAIN.x+Math.cos(t)*r,y,FOUNTAIN.z+Math.sin(t)*r];
      for(const r of [G.bedInnerRadius,G.bedOuterRadius-.5]){
        const A=at(r,0,a),B=at(r,0,b),C=at(r,.65,b),D=at(r,.65,a);
        for(const f of [face(A,B,C),face(A,C,D)])raster.triangle(f,oid,fill([81,104,61]));
        const E=at(r+.5,.65,a),F=at(r+.5,.65,b);raster.triangle(face(D,C,F),oid,fill([116,136,79]));raster.triangle(face(D,F,E),oid,fill([116,136,79]));
      }
    }
  }
  const fountain=addObject({id:'fountain',placeId:'fountain',kind:'fountain',point:[FOUNTAIN.x,FOUNTAIN.z],bounds:[surfaceProject([FOUNTAIN.x,0,FOUNTAIN.z])[0]-FOUNTAIN.rimRadius*1.11,surfaceProject([FOUNTAIN.x,FOUNTAIN.jetHeight,FOUNTAIN.z])[1],surfaceProject([FOUNTAIN.x,0,FOUNTAIN.z])[0]+FOUNTAIN.rimRadius*1.11,surfaceProject([FOUNTAIN.x,0,FOUNTAIN.z])[1]+FOUNTAIN.rimRadius*.56]});
  const circle=(r,y,a)=>[FOUNTAIN.x+Math.cos(a)*r,y,FOUNTAIN.z+Math.sin(a)*r];
  for(let i=0;i<192;i++){
    const a=i/192*Math.PI*2,b=(i+1)/192*Math.PI*2,A=circle(FOUNTAIN.waterRadius,.10,a),B=circle(FOUNTAIN.waterRadius,.10,b),C=circle(FOUNTAIN.rimRadius,.43,b),D=circle(FOUNTAIN.rimRadius,.43,a);
    raster.triangle(face([FOUNTAIN.x,.10,FOUNTAIN.z],A,B),fountain,material?.water||((u,v)=>{const dx=u-FOUNTAIN.x,dz=v-FOUNTAIN.z,r=Math.hypot(dx,dz),wave=Math.sin(dx*3+Math.sin(dz*.8))*Math.sin(dz*2.2)*4+Math.sin(r*3.6)*1.8;return rgb(58+wave,103+wave,119+wave);}));
    const lipA=circle(FOUNTAIN.waterRadius+.2,.43,a),lipB=circle(FOUNTAIN.waterRadius+.2,.43,b);
    for(const f of [face(A,B,lipB),face(A,lipB,lipA)])raster.triangle(f,fountain,fill([93,112,113]));
    for(const f of [face(lipA,lipB,C),face(lipA,C,D)])raster.triangle(f,fountain,material?((u,v)=>material.stone(u,v,i%8?1.15:.84)):fill(i%8?[224,222,207]:[190,191,173]));
    const E=circle(FOUNTAIN.rimRadius,.05,a),F=circle(FOUNTAIN.rimRadius,.05,b);raster.triangle(face(D,C,F),fountain,fill([139,151,147]));raster.triangle(face(D,F,E),fountain,fill([139,151,147]));
  }
  const ribbon=(previous,P,w,owner,col)=>{
    const off=[.707*w,0,.707*w],A=previous.map((v,k)=>v-off[k]),B=previous.map((v,k)=>v+off[k]),C=P.map((v,k)=>v+off[k]),D=P.map((v,k)=>v-off[k]);
    raster.triangle(face(A,B,C),owner,fill(col));raster.triangle(face(A,C,D),owner,fill(col));
  };
  // Central foamy plume, plus eight low outward arcs rooted around the centre.
  if(!material?.plume)for(let stream=0;stream<19;stream++){
    let prev=null;
    for(let j=0;j<=72;j++){
      const t=j/72,offset=stream/18*Math.PI*2,r=(.55+Math.sin(t*Math.PI)*.78+t*.3)*(stream?1:0),h=t*FOUNTAIN.jetHeight*(stream?.86+stream%5*.028:1),P=[FOUNTAIN.x+Math.cos(offset)*r,h,FOUNTAIN.z+Math.sin(offset)*r];
      if(prev)ribbon(prev,P,(stream?.23:.54)*(1-.52*t)+Math.sin(t*22+stream)*.045,fountain,stream%3?[207,228,232]:[244,248,241]);prev=P;
    }
  }
  for(let stream=0;stream<8;stream++){
    let prev=null;const angle=stream/8*Math.PI*2;
    for(let j=0;j<=48;j++){
      const t=j/48,reach=7.4+t*5.6,h=.14+Math.sin(Math.PI*t)*6.1,P=[FOUNTAIN.x+Math.cos(angle)*reach,h,FOUNTAIN.z+Math.sin(angle)*reach];
      if(prev)ribbon(prev,P,.12+(1-t)*.08,fountain,[211,234,229]);prev=P;
    }
  }
  const patch=(x,y,z,w,h,col)=>{
    const v=[.707*w,0,.707*w],P=[x,y,z],A=P.map((p,k)=>p-v[k]),B=P.map((p,k)=>p+v[k]),C=[B[0],y+h,B[2]],D=[A[0],y+h,A[2]];
    raster.triangle(face(A,B,C),fountain,fill(col));raster.triangle(face(A,C,D),fountain,fill(col));
  };
  // Broken edges and isolated spray describe water rather than a white pole.
  for(let i=0;i<420;i++){
    const t=i/419,h=t*FOUNTAIN.jetHeight,phase=i*2.39996,r=.85+(1-t)*.65+Math.sin(t*31)*.25;
    patch(FOUNTAIN.x+Math.cos(phase)*r,h,FOUNTAIN.z+Math.sin(phase)*r,.1+(i%4)*.045,.18+(i%5)*.13,i%3?[201,224,228]:[245,249,241]);
    if(i%3===0){const rr=r+.45+(i%7)*.15;patch(FOUNTAIN.x+Math.cos(phase)*rr,h*.97,FOUNTAIN.z+Math.sin(phase)*rr,.07,.15,[178,213,218]);}
  }
  for(let i=0;i<64;i++){
    const a=i/64*Math.PI*2,r=1.5+(i%5)*.32;patch(FOUNTAIN.x+Math.cos(a)*r,.12,FOUNTAIN.z+Math.sin(a)*r,.19,.12+(i%4)*.09,[218,235,224]);
  }
  if(material?.plume){const img=material.plume,[u,v]=surfaceProject([FOUNTAIN.x,0,FOUNTAIN.z]);raster.billboard(img,[0,0,img.width,img.height],{u:u-4,v:v-FOUNTAIN.jetHeight*HEIGHT_SCALE,width:8,height:FOUNTAIN.jetHeight*HEIGHT_SCALE,footU:u,footV:v,groundDepth:(FOUNTAIN.z-FOUNTAIN.x)*DEPTH_GROUND},fountain);}
  return fountain;
}
