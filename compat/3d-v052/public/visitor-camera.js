// Prefer an open orbit when a wall blocks the camera; avoid zooming into the avatar's head.
export function unobstructedVisitorCamera(T,target,position,buildings){
  const offset=position.clone().sub(target),length=offset.length(),direction=offset.clone().normalize();
  const clearance=v=>buildings.cast?buildings.cast(target,v.clone().normalize(),v.length()):new T.Raycaster(target,v.clone().normalize(),.1,v.length()).intersectObjects(buildings)[0]?.distance??v.length();
  const available=clearance(offset);if(available>=length)return position;
  if(available<4.5){
    const orbit=offset.clone().setLength(Math.max(length,9.5)),axis=new T.Vector3(0,1,0);
    for(const angle of [Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2,Math.PI,-Math.PI*.75,Math.PI*.75]){
      const candidate=orbit.clone().applyAxisAngle(axis,angle);if(clearance(candidate)>=candidate.length()-.05)return target.clone().add(candidate);
    }
  }
  return target.clone().addScaledVector(direction,Math.max(1.3,available-.45));
}

// Camera rays only visit nearby triangle cells. Shared positions/materials are never modified.
export function createCameraCollisionIndex(T,objects,cellSize=8){
  const cells=new Map(),geometries=[],stats={sourceObjects:objects.length,sourceTriangles:0,indexReferences:0,chunks:0,cells:0,casts:0,lastCandidateTriangles:0};
  const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),instance=new T.Matrix4(),world=new T.Matrix4();let sourceId=0;
  for(const source of objects){
    if(!source.isMesh)continue;source.updateWorldMatrix(true,false);
    const geometry=source.geometry,position=geometry.attributes.position,index=geometry.index,count=index?index.count:position.count;
    for(let n=0;n<(source.isInstancedMesh?source.count:1);n++){
      if(source.isInstancedMesh){source.getMatrixAt(n,instance);world.multiplyMatrices(source.matrixWorld,instance);}else world.copy(source.matrixWorld);
      const id=sourceId++,matrix=world.clone(),groups=new Map();
      const start=geometry.drawRange.start,end=Math.min(count,start+geometry.drawRange.count);
      for(let i=start;i<end;i+=3){
        const ia=index?index.getX(i):i,ib=index?index.getX(i+1):i+1,ic=index?index.getX(i+2):i+2;
        a.fromBufferAttribute(position,ia).applyMatrix4(matrix);b.fromBufferAttribute(position,ib).applyMatrix4(matrix);c.fromBufferAttribute(position,ic).applyMatrix4(matrix);
        const x0=Math.floor(Math.min(a.x,b.x,c.x)/cellSize),x1=Math.floor(Math.max(a.x,b.x,c.x)/cellSize),z0=Math.floor(Math.min(a.z,b.z,c.z)/cellSize),z1=Math.floor(Math.max(a.z,b.z,c.z)/cellSize);
        const materialIndex=Array.isArray(source.material)?geometry.groups.find(g=>i>=g.start&&i<g.start+g.count)?.materialIndex||0:0,material=Array.isArray(source.material)?source.material[materialIndex]:source.material;
        stats.sourceTriangles++;
        for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
          const cell=x+':'+z,key=cell+':'+materialIndex;let group=groups.get(key);
          if(!group){group={cell,indices:[],material};groups.set(key,group);}group.indices.push(ia,ib,ic);
        }
      }
      for(const group of groups.values()){
        const g=new T.BufferGeometry();g.setAttribute('position',position);g.setIndex(group.indices);
        const box=new T.Box3();for(const i of group.indices)box.expandByPoint(a.fromBufferAttribute(position,i));g.boundingBox=box;g.boundingSphere=box.getBoundingSphere(new T.Sphere());
        const mesh=new T.Mesh(g,group.material);mesh.matrixAutoUpdate=false;mesh.matrixWorldAutoUpdate=false;mesh.matrixWorld.copy(matrix);mesh.userData.sourceId=id;
        if(!cells.has(group.cell))cells.set(group.cell,[]);cells.get(group.cell).push(mesh);geometries.push(g);stats.indexReferences+=group.indices.length;stats.chunks++;
      }
    }
  }
  stats.cells=cells.size;const raycaster=new T.Raycaster(),hits=[],end=new T.Vector3();let cachedKey='',cached=[];
  return {stats,cast(origin,direction,far){
    end.copy(origin).addScaledVector(direction,far);const x0=Math.floor(Math.min(origin.x,end.x)/cellSize),x1=Math.floor(Math.max(origin.x,end.x)/cellSize),z0=Math.floor(Math.min(origin.z,end.z)/cellSize),z1=Math.floor(Math.max(origin.z,end.z)/cellSize),key=[x0,x1,z0,z1].join(':');
    if(key!==cachedKey){cachedKey=key;cached=[];for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)cached.push(...(cells.get(x+':'+z)||[]));}
    raycaster.set(origin,direction);raycaster.near=.1;raycaster.far=far;hits.length=0;raycaster.intersectObjects(cached,false,hits);stats.casts++;stats.lastCandidateTriangles=cached.reduce((n,m)=>n+m.geometry.index.count/3,0);return hits[0]?.distance??far;
  },dispose(){for(const g of geometries)g.dispose();geometries.length=0;cells.clear();cached=[];}};
}
