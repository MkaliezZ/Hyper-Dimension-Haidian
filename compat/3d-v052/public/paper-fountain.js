import {paperFacets,buildGroundedBuilding} from './paper-surfaces.js';
import {terrainHeight} from './terrain-surface.js';

// School-original folded-paper water: faceted basin, creased ribbons and tiny folded droplets.
// This is a visual interpretation of the central jet and two circular jet arrays, not live water.
export function installPaperFountain(T,root,terrain,f,level){
  const matte=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:1,metalness:0,flatShading:true,vertexColors:true,...extra});
  const stone=matte('#b8b29e'),coping=matte('#ded3b9'),blue=matte('#5eabb2',{side:T.DoubleSide});
  const ice=matte('#d5e9e2',{side:T.DoubleSide}),pale=matte('#9dccc9',{side:T.DoubleSide});
  const mesh=(g,mat,parent=root)=>{const finished=paperFacets(T,g,.09);g.dispose();const m=new T.Mesh(finished,mat);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  const circle=(r,reverse=false)=>Array.from({length:49},(_,i)=>{const a=(reverse?-1:1)*i/48*Math.PI*2;return [f.x+r*Math.cos(a),f.z+r*Math.sin(a)];});
  const rimBuilding={baseY:level-.52,height:.52,rings:[circle(f.rimRadius),circle(f.waterRadius,true)]};
  const basin=buildGroundedBuilding(T,rimBuilding,terrain),rim=new T.Mesh(basin.geometry,[coping,stone,stone]);rim.castShadow=true;rim.receiveShadow=true;rim.name='paper-pool-grounded-rim';root.add(rim);
  const waterVertices=[],segments=48,bands=5;
  const point=(r,i)=>{const a=i/segments*Math.PI*2;return [f.x+Math.cos(a)*r,level-.16+(r>0&&r<f.waterRadius?Math.cos(i*Math.PI)*.028:0),f.z+Math.sin(a)*r];};
  for(let ring=0;ring<bands;ring++)for(let i=0;i<segments;i++){
    const a=point(f.waterRadius*ring/bands,i),b=point(f.waterRadius*ring/bands,i+1),c=point(f.waterRadius*(ring+1)/bands,i),d=point(f.waterRadius*(ring+1)/bands,i+1);
    if(ring)waterVertices.push(...a,...b,...c);waterVertices.push(...b,...d,...c);
  }
  const waterGeo=new T.BufferGeometry();waterGeo.setAttribute('position',new T.Float32BufferAttribute(waterVertices,3));
  const water=mesh(waterGeo,blue);water.name='Drumheller-folded-paper-water';water.castShadow=false;
  const jets=new T.Group();jets.position.set(f.x,level,f.z);jets.name='folded-paper-fountain-jets';root.add(jets);
  const jetData=[],white=[],cyan=[];
  function jet(angle,radius,apex,spread,width){
    jetData.push({angle,radius,apex,spread});const count=14;
    const p=t=>new T.Vector3(Math.cos(angle)*(radius+spread*t),4*apex*t*(1-t)+.08,Math.sin(angle)*(radius+spread*t));
    for(let i=0;i<count;i++){
      const t=i/count,u=(i+1)/count,a=p(t),b=p(u),side=new T.Vector3(-Math.sin(angle),0,Math.cos(angle)),w=width*(1-.55*t);
      const left=a.clone().addScaledVector(side,w),right=a.clone().addScaledVector(side,-w),ridge=a.clone().add(new T.Vector3(0,width*.65,0));
      const leftB=b.clone().addScaledVector(side,w*.96),rightB=b.clone().addScaledVector(side,-w*.96),ridgeB=b.clone().add(new T.Vector3(0,width*.65,0));
      for(const [target,triangles] of [[white,[[left,leftB,ridge],[leftB,ridgeB,ridge]]],[cyan,[[ridge,ridgeB,right],[ridgeB,rightB,right]]]])for(const tri of triangles)for(const v of tri)target.push(...v.toArray());
    }
  }
  for(let i=0;i<7;i++)jet(i/7*Math.PI*2,.18,f.jetHeight*(.82+(i%3)*.09),2.8+(i%3),.38);
  for(const [count,radius,apex,spread,width] of [[12,2.3,7.6,6,.17],[16,4,3.7,5,.14]])for(let i=0;i<count;i++)jet(i/count*Math.PI*2,radius,apex,spread,width);
  for(const [vertices,material] of [[white,ice],[cyan,pale]]){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));const m=mesh(g,material,jets);m.castShadow=false;}
  const dropGeo=paperFacets(T,new T.OctahedronGeometry(.14,0),.1),drops=new T.InstancedMesh(dropGeo,ice,64),matrix=new T.Matrix4();jets.add(drops);drops.frustumCulled=false;
  const update=time=>{
    jets.scale.y=1+Math.sin(time*1.1)*.018;
    for(let i=0;i<64;i++){
      const j=jetData[i%jetData.length],t=(i*.618034+time*.23)%1,r=j.radius+j.spread*t;
      matrix.makeTranslation(Math.cos(j.angle)*r,4*j.apex*t*(1-t)+.1,Math.sin(j.angle)*r);drops.setMatrixAt(i,matrix);
    }
    drops.instanceMatrix.needsUpdate=true;
  };update(0);
  return {update,stats:{style:'folded-paper-ribbons',centralRibbons:7,ringJets:28,droplets:64,groundedRim:true,level,minimumGrade:basin.grounding.minimum,maximumGrade:basin.grounding.maximum,centerGrade:terrainHeight(terrain,f.x,f.z)}};
}
