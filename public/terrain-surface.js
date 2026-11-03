// Sample the actual rendered DEM triangles (the cell diagonal is a+b=1).
// The authoritative DEM and routing coordinates remain unchanged.
export function terrainHeight(t,x,z){
  const [x0,z0,x1,z1]=t.bounds;
  const fx=Math.max(0,Math.min(t.width-1,(x-x0)/(x1-x0)*(t.width-1)));
  const fz=Math.max(0,Math.min(t.height-1,(z-z0)/(z1-z0)*(t.height-1)));
  const i=Math.min(t.width-2,Math.floor(fx)),j=Math.min(t.height-2,Math.floor(fz)),a=fx-i,b=fz-j;
  const v=(xx,zz)=>t.heights[zz*t.width+xx];
  return a+b<=1?v(i,j)+(v(i+1,j)-v(i,j))*a+(v(i,j+1)-v(i,j))*b:
    v(i+1,j+1)+(v(i,j+1)-v(i+1,j+1))*(1-a)+(v(i+1,j)-v(i+1,j+1))*(1-b);
}

// Every boundary/triangle crossing is included: sparse footprint corners alone miss valleys.
export function terrainEdgeSamples(t,a,b){
  const [x0,z0,x1,z1]=t.bounds,sx=(t.width-1)/(x1-x0),sz=(t.height-1)/(z1-z0);
  const ax=(a[0]-x0)*sx,az=(a[1]-z0)*sz,bx=(b[0]-x0)*sx,bz=(b[1]-z0)*sz,ts=[0,1];
  for(const [u,v] of [[ax,bx],[az,bz],[ax+az,bx+bz]]){
    if(Math.abs(v-u)<1e-10)continue;
    for(let k=Math.ceil(Math.min(u,v));k<=Math.floor(Math.max(u,v));k++){
      const f=(k-u)/(v-u);if(f>1e-9&&f<1-1e-9)ts.push(f);
    }
  }
  return [...new Set(ts.map(f=>Math.round(f*1e10)/1e10))].sort((u,v)=>u-v).map(f=>{
    const x=a[0]+(b[0]-a[0])*f,z=a[1]+(b[1]-a[1])*f;return [x,terrainHeight(t,x,z),z];
  });
}
export function buildingGrounding(building,t){
  const samples=[];
  for(const ring of building.rings)for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length];
    if(Math.hypot(a[0]-b[0],a[1]-b[1])>1e-7)samples.push(...terrainEdgeSamples(t,a,b));
  }
  const minimum=Math.min(...samples.map(p=>p[1])),maximum=Math.max(...samples.map(p=>p[1]));
  return {minimum,maximum,bottom:Math.min(minimum,building.baseY)-.32,
    previousMaximumGap:Math.max(0,building.baseY-minimum),sampleCount:samples.length};
}

function clip(poly,value){
  const out=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],va=value(a),vb=value(b);
    if(va>=-1e-8)out.push(a);
    if(va*vb<0){const f=va/(va-vb);out.push(a.map((v,k)=>v+(b[k]-v)*f));}
  }
  return out;
}
// Exact planar intersection with DEM cells, avoiding the old recursive 1.5 m subdivision.
// Each output triangle lies on a single DEM triangle, so paving cannot bridge valleys.
export function terrainPatchGeometry(T,t,points,offset=.1){
  const source=new T.ShapeGeometry(new T.Shape(points.map(([x,z])=>new T.Vector2(x,-z)))).toNonIndexed();
  const p=source.attributes.position,verts=[],[x0,z0,x1,z1]=t.bounds,dx=(x1-x0)/(t.width-1),dz=(z1-z0)/(t.height-1);
  for(let n=0;n<p.count;n+=3){
    const triangle=[0,1,2].map(k=>[p.getX(n+k),-p.getY(n+k)]);
    const i0=Math.max(0,Math.floor((Math.min(...triangle.map(v=>v[0]))-x0)/dx)),i1=Math.min(t.width-2,Math.floor((Math.max(...triangle.map(v=>v[0]))-x0)/dx));
    const j0=Math.max(0,Math.floor((Math.min(...triangle.map(v=>v[1]))-z0)/dz)),j1=Math.min(t.height-2,Math.floor((Math.max(...triangle.map(v=>v[1]))-z0)/dz));
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const left=x0+i*dx,top=z0+j*dz;
      let cell=triangle;for(const fn of [v=>v[0]-left,v=>left+dx-v[0],v=>v[1]-top,v=>top+dz-v[1]])cell=clip(cell,fn);
      for(const sign of [-1,1]){
        const part=clip(cell,v=>sign*((v[0]-left)/dx+(v[1]-top)/dz-1));
        for(let k=1;k<part.length-1;k++){
          let tri=[part[0],part[k],part[k+1]];
          const area=(tri[1][0]-tri[0][0])*(tri[2][1]-tri[0][1])-(tri[1][1]-tri[0][1])*(tri[2][0]-tri[0][0]);
          if(Math.abs(area)<1e-8)continue;if(area>0)tri=[tri[0],tri[2],tri[1]];
          for(const [x,z] of tri)verts.push(x,terrainHeight(t,x,z)+offset,z);
        }
      }
    }
  }
  source.dispose();const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.computeVertexNormals();return g;
}
