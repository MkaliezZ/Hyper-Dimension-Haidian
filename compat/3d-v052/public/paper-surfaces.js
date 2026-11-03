import {buildingGrounding,terrainEdgeSamples} from './terrain-surface.js';
import {pointInBuilding} from './building-roofs.js';

// Original procedural paper finish. No photographs, textures or external asset dependencies.
export function paperFacets(T,geometry,variation=.055){
  const g=geometry.index?geometry.toNonIndexed():geometry.clone(),p=g.attributes.position,colors=[];
  for(let i=0;i<p.count;i+=3){
    const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
    const tone=1-variation*(.5+.5*Math.sin(x*.31+y*.17+z*.29));
    const old=g.attributes.color;
    const rgb=old?[0,1,2].map(axis=>[0,1,2].reduce((sum,k)=>sum+old.array[(i+k)*3+axis],0)/3):[1,1,1];
    for(let k=0;k<3;k++)colors.push(...rgb.map(c=>c*tone));
  }
  g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}

export function buildGroundedBuilding(T,building,terrain){
  const ground=buildingGrounding(building,terrain),make=ring=>ring.map(([x,z])=>new T.Vector2(x,-z));
  const shape=new T.Shape(make(building.rings[0]));
  for(const ring of building.rings.slice(1))shape.holes.push(new T.Path(make(ring)));
  const positions=[],normals=[],materialRuns=[];
  // A continuous solid foundation is buried below the minimum of every perimeter DEM crossing.
  // It is terrain occlusion, not moving/flattening the GIS, that creates the sloped contact line.
  const append=(bottom,height)=>{
    const indexed=new T.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,curveSegments:1});
    indexed.rotateX(-Math.PI/2);indexed.translate(0,bottom,0);
    const raw=indexed.index?indexed.toNonIndexed():indexed.clone(),p=raw.attributes.position,n=raw.attributes.normal;
    for(let i=0;i<p.count;i+=3){
      const ny=n.getY(i);
      const material=ny<-.99?2:ny>.99?0:1,start=positions.length/3;
      for(let j=0;j<3;j++){positions.push(p.getX(i+j),p.getY(i+j),p.getZ(i+j));normals.push(n.getX(i+j),n.getY(i+j),n.getZ(i+j));}
      const previous=materialRuns.at(-1);if(previous?.material===material)previous.count+=3;else materialRuns.push({start,count:3,material});
    }
    indexed.dispose();raw.dispose();
  };
  append(ground.bottom,building.baseY+building.height-ground.bottom);
  // A narrow stone foot follows the slope. Avoid a many-storey pedestal on downhill facades.
  const bandStart=positions.length/3;
  for(const ring of building.rings)for(let k=0;k<ring.length;k++){
    const a=ring[k],b=ring[(k+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<1e-7)continue;
    let nx=dz/length,nz=-dx/length;
    if(pointInBuilding((a[0]+b[0])/2+nx*.1,(a[1]+b[1])/2+nz*.1,building.rings)){nx=-nx;nz=-nz;}
    const points=terrainEdgeSamples(terrain,a,b);
    for(let i=1;i<points.length;i++){
      const u=points[i-1],v=points[i],at=(p,h)=>[p[0]+nx*.035,Math.min(p[1]+h,building.baseY+building.height-.015),p[2]+nz*.035];
      let triangles=[[at(u,-.16),at(v,-.16),at(u,.58)],[at(v,-.16),at(v,.58),at(u,.58)]];
      const normal=new T.Vector3().crossVectors(new T.Vector3(...triangles[0][1]).sub(new T.Vector3(...triangles[0][0])),new T.Vector3(...triangles[0][2]).sub(new T.Vector3(...triangles[0][0])));
      if(normal.x*nx+normal.z*nz<0)triangles=triangles.map(tri=>[tri[0],tri[2],tri[1]]);
      for(const tri of triangles)for(const p of tri){positions.push(...p);normals.push(nx,0,nz);}
    }
  }
  materialRuns.push({start:bandStart,count:positions.length/3-bandStart,material:2});
  const raw=new T.BufferGeometry();raw.setAttribute('position',new T.Float32BufferAttribute(positions,3));raw.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
  for(const g of materialRuns)raw.addGroup(g.start,g.count,g.material);
  const geometry=paperFacets(T,raw,.07);raw.dispose();geometry.userData={grounding:ground};
  return {geometry,grounding:ground};
}

export function paperCrownGeometry(T){
  const points=[],segments=6,at=(r,y,i)=>[Math.cos(i/segments*Math.PI*2)*r,y,Math.sin(i/segments*Math.PI*2)*r];
  const rings=[[.52,.75],[1,.15],[.82,-.45],[.3,-.85]];
  const add=(tri)=>{
    const a=new T.Vector3(...tri[0]),b=new T.Vector3(...tri[1]),c=new T.Vector3(...tri[2]),n=new T.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a));
    const center=a.clone().add(b).add(c).multiplyScalar(1/3);if(n.x*center.x+n.z*center.z<0)tri=[tri[0],tri[2],tri[1]];points.push(...tri.flat());
  };
  for(let i=0;i<segments;i++){
    add([[0,1.05,0],at(...rings[0],i),at(...rings[0],i+1)]);
    for(let j=1;j<rings.length;j++){
      const a=at(...rings[j-1],i),b=at(...rings[j-1],i+1),c=at(...rings[j],i),d=at(...rings[j],i+1);
      add([a,b,c]);add([b,d,c]);
    }
    add([at(...rings.at(-1),i),at(...rings.at(-1),i+1),[0,-.95,0]]);
  }
  const raw=new T.BufferGeometry();raw.setAttribute('position',new T.Float32BufferAttribute(points,3));raw.computeVertexNormals();const g=paperFacets(T,raw,.13);raw.dispose();return g;
}
