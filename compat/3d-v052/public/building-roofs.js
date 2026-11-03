// School art only. Every roof is clipped to its source building, including courtyards.
// Heights and roof profiles are visual interpretations, not surveyed construction data.
export const ROOF_PROFILES = [
  {code:'SUZ',id:'reading-room',a:[-45,10],b:[-55,69],width:18,rise:6.3},
  {code:'DEN',id:'main-wing',a:[-94,-220],b:[-49,-265],width:19,rise:7.2},
  {code:'DEN',id:'rear-wing',a:[-100,-270],b:[-77,-247],width:16,rise:6.3},
  {code:'RAI',id:'quad-wing',a:[28,-172],b:[65,-209],width:20,rise:4.6},
  {code:'SAV',id:'quad-wing',a:[-46,-101],b:[0,-146],width:18,rise:4.6},
  {code:'JHN',id:'vista-wing',a:[-84,158],b:[-55,218],width:19,rise:5},
];

// Same convention as Three.js RotationY. All a component's descendants use this frame.
export function roofFrame({x,z,angle=0}) {
  const c=Math.cos(angle),s=Math.sin(angle);
  return (u,v,y)=>[x+c*u+s*v,y,z-s*u+c*v];
}

export function pointInBuilding(x,z,rings) {
  const inRing=ring=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }return hit;};
  return inRing(rings[0])&&!rings.slice(1).some(inRing);
}

function clip(points,value) {
  const out=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],va=value(a),vb=value(b);
    if(va>=-1e-9)out.push(a);
    if((va<0&&vb>0)||(va>0&&vb<0)){
      const t=va/(va-vb);out.push(a.map((v,k)=>v+(b[k]-v)*t));
    }
  }
  return out;
}

export function buildFoldedRoof(THREE,building,profile) {
  if(building.code!==profile.code)throw Error('Roof/building identity mismatch');
  const {a,b,width,rise}=profile,len=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(!(len>0&&width>0&&rise>0)||![...a,...b,width,rise,building.baseY,building.height].every(Number.isFinite))throw Error('Invalid roof dimensions');
  const ux=(b[0]-a[0])/len,uz=(b[1]-a[1])/len,baseY=building.baseY+building.height;
  const local=([x,z])=>[(x-a[0])*ux+(z-a[1])*uz,-(x-a[0])*uz+(z-a[1])*ux];
  const world=([s,t],height)=>[a[0]+ux*s-uz*t,height,a[1]+uz*s+ux*t];
  const roofY=([,t])=>baseY+rise*Math.max(0,1-Math.abs(t)/(width/2));
  const contour=building.rings.map(r=>r.slice(0,-1).map(p=>new THREE.Vector2(...p)));
  const faces=THREE.ShapeUtils.triangulateShape(contour[0],contour.slice(1)),source=contour.flat();
  const vertices=[],panels=[],boundary=new Map();
  const key=p=>p.map(v=>v.toFixed(6)).join(',');
  function triangle(p,q,r){
    // Exterior top normals must face up; source rings may have either winding.
    if((q[2]-p[2])*(r[0]-p[0])-(q[0]-p[0])*(r[2]-p[2])<0)[q,r]=[r,q];
    vertices.push(...p,...q,...r);
  }
  for(const face of faces){
    const initial=face.map(i=>local(source[i].toArray()));
    for(const side of [-1,1]){
      let poly=initial;
      for(const plane of [p=>p[0],p=>len-p[0],p=>width/2-p[1],p=>width/2+p[1],p=>side*p[1]])poly=clip(poly,plane);
      if(poly.length<3)continue;
      const area=Math.abs(poly.reduce((sum,p,i)=>{const q=poly[(i+1)%poly.length];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;
      if(area<1e-8)continue;
      const points=poly.map(p=>world(p,roofY(p)));panels.push(points);
      for(let i=1;i<points.length-1;i++)triangle(points[0],points[i],points[i+1]);
      for(let i=0;i<poly.length;i++){
        const p=poly[i],q=poly[(i+1)%poly.length];if(Math.hypot(p[0]-q[0],p[1]-q[1])<1e-7)continue;
        const k=[key(p),key(q)].sort().join('|');const e=boundary.get(k);if(e)e.count++;else boundary.set(k,{p,q,count:1});
      }
    }
  }
  if(!panels.length)throw Error('Roof does not overlap its building');
  const topVertexCount=vertices.length/3;
  // Seal the clipped end faces down to the building roof. No floating end triangles.
  for(const {p,q,count} of boundary.values())if(count===1){
    const pa=world(p,roofY(p)),pb=world(q,roofY(q)),ba=world(p,baseY),bb=world(q,baseY);
    vertices.push(...pa,...pb,...ba,...pb,...bb,...ba);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();
  return {geometry,panels,baseY,topVertexCount,buildingId:building.id,profileId:profile.id};
}

// The supported Gerberding landmark has its own continuous shaft and crown.
// The former generic roof boxes on GUG/MGH/JHN/BAG have no such reference binding.
export const GERBERDING_TOWER={code:'GRB',x:-99,z:101,width:8,depth:8,angle:.455,heightAboveRoof:19};
export function towerSupport(building,definition=GERBERDING_TOWER) {
  if(building.code!==definition.code)throw Error('Tower/building identity mismatch');
  const at=roofFrame(definition),points=[];
  for(const u of [-.5,0,.5])for(const v of [-.5,0,.5]){
    const p=at(u*definition.width,v*definition.depth,building.baseY);
    if(!pointInBuilding(p[0],p[2],building.rings))throw Error('Tower extends outside its building');points.push(p);
  }
  return {at,points,bottom:building.baseY,top:building.baseY+building.height+definition.heightAboveRoof};
}
