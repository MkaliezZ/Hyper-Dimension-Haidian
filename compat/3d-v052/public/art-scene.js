import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {ROOF_PROFILES,buildFoldedRoof,GERBERDING_TOWER,towerSupport} from './building-roofs.js';
import {terrainPatchGeometry} from './terrain-surface.js';
import {paperFacets,paperCrownGeometry,buildGroundedBuilding} from './paper-surfaces.js';
import {installPaperFountain} from './paper-fountain.js';
import {RED_BOUNDARY,FOUNTAIN} from './campus-layout.js';
export {RED_BOUNDARY,FOUNTAIN} from './campus-layout.js';

// School-specific visual adaptation. Footprints, navigation and source DEM are never changed.
// All facade/landscape dimensions below are visual estimates, not a measured BIM survey.
export const ART_VERSION='0.4.0';
export const ART_REFERENCES=[
  {id:'uw-art-highlights',title:'UW Campus highlights guide',url:'https://www.washington.edu/visit/campus-highlights-guide/',credit:'University of Washington',usedFor:'红场/喷泉官方照片与景观关系；仅研究，不再分发照片'},
  {id:'uw-art-suzzallo',title:'Suzzallo Library history, architecture and design',url:'https://lib.uw.edu/locations-hours/suzzallo-and-allen-libraries-history/',credit:'UW Libraries',usedFor:'哥特式立面、材质、扶壁与拱窗；尺寸与简化雕饰为推定'},
  {id:'uw-art-red-square',title:'Red Square: existing landscape description',url:'https://larch.be.uw.edu/portfolio/re-imagining-red-square/',credit:'UW Landscape Architecture',usedFor:'只采用既有铺地/三座砖塔/台座描述，未采用学生改造提案'},
  {id:'uw-art-draining',title:'Draining Drumheller Fountain',url:'https://facilities.uw.edu/blog/posts/2019/04/03/draining-drumheller-fountain',credit:'UW Facilities, 2019',usedFor:'中央与环状喷水束形制；不用于实时开放/运行信息'},
  {id:'uw-art-photos',title:'UW campus photographs',url:'https://faculty.washington.edu/paymana/uw_photos.html',credit:'Lloyd C. Heath / UW faculty reference page',usedFor:'Suzzallo近景、红场俯瞰和喷泉视廊；有版权照片仅研究'},
  {id:'uw-art-rainier',title:'Mount Rainier geographic reference',url:'https://www.usgs.gov/volcanoes/mount-rainier',credit:'USGS',usedFor:'远景方位与距离；山体轮廓为示意，不是山体DEM或实时能见度'},
];
export const DETAIL_CODES=['SUZ','DEN','GRB','MGH','JHN','GUG','BAG','SAV','RAI','SMI','MLR','KNE','OUG','MNY','HUB'];
export const ART_CAMERAS={
  'red-square':{target:[-104,43,30],offset:[-150,128,170]},
  suzzallo:{target:[-50,49,39],offset:[-116,73,110]},
  fountain:{target:[9.89,30,266.67],offset:[-100,112,142]},
  denny:{target:[-71,60,-244],offset:[-112,98,132]},
  quad:{target:[68,43,-137],offset:[-130,145,158]},
  vista:{target:[10,29,267],offset:[-135,50,-282]},
};

// Matte paper palette: shape, silhouette and light carry the detail, not noisy brick pixels.
export const PAPER_PALETTE={stone:'#c9bba3',brick:'#ae7864','buff-brick':'#bc9273',slate:'#597078'};
export function architecturalMaterial(kind,color){
  const tint=new THREE.Color(PAPER_PALETTE[kind]||PAPER_PALETTE.stone);
  if(color)tint.multiply(new THREE.Color(color));
  return new THREE.MeshStandardMaterial({color:tint,roughness:1,metalness:0,flatShading:true,vertexColors:true});
}

export function installCampusArt({scene,campus,heightAt,inside,buildingMeshes}){
  const root=new THREE.Group();root.name='UW-folded-paper-3d-v0.4.0';scene.add(root);
  const batches=new Map(),picking=[],animated=[],stats={version:ART_VERSION,school:'uw-seattle',detailedBuildings:[],features:[],style:'folded-paper-low-poly-3d',roofAssemblies:[],dimensions:'visual estimates',sourceGeometryHash:campus.geometryHash};
  // Geographic far-field reference, outside the clipped campus DEM. The profile is illustrative;
  // the mountain's USGS summit direction/distance uses the same EPSG:26910 origin as the campus.
  const mountainVertices=[],mountainColors=[],mx=42559.98,mz=88746.32,rings=7,segments=24;
  const mountainPoint=(r,a)=>{const rad=r/rings,theta=a/segments*Math.PI*2,flank=1+.1*Math.cos(theta*3)+.05*Math.sin(theta*7);return [mx+Math.cos(theta)*rad*18500,200+4192*Math.pow(1-rad,1.65)*(1+.035*Math.sin(theta*5)*rad),mz+Math.sin(theta)*rad*17000*flank];};
  for(let r=0;r<rings;r++)for(let a=0;a<segments;a++){
    for(const tri of [[mountainPoint(r,a),mountainPoint(r+1,a),mountainPoint(r+1,a+1)],[mountainPoint(r,a),mountainPoint(r+1,a+1),mountainPoint(r,a+1)]])for(const p of tri){mountainVertices.push(...p);const snow=p[1]>2200+Math.sin(a*.2)*230,c=new THREE.Color(snow?'#eff3ed':'#a6bbbf');mountainColors.push(c.r,c.g,c.b);}
  }
  const mountainGeo=new THREE.BufferGeometry();mountainGeo.setAttribute('position',new THREE.Float32BufferAttribute(mountainVertices,3));mountainGeo.setAttribute('color',new THREE.Float32BufferAttribute(mountainColors,3));mountainGeo.computeVertexNormals();
  const mountain=new THREE.Mesh(mountainGeo,new THREE.MeshBasicMaterial({vertexColors:true,fog:false,side:THREE.DoubleSide}));mountain.name='Rainier-geographic-far-field-illustration';scene.add(mountain);
  stats.features.push('rainier-geographic-direction-schematic-profile');stats.mountain={position:[mx,mz],distanceMetres:Math.round(Math.hypot(mx,mz)),profile:'illustrative, not mountain DEM or live visibility'};
  const stone=architecturalMaterial('stone'),brick=architecturalMaterial('brick'),roof=architecturalMaterial('slate');
  const paper=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:1,metalness:0,flatShading:true,vertexColors:true,...extra});
  const cream=paper('#dbceb7'),darkStone=paper('#b7ad99');
  const glass=paper('#405d63',{side:THREE.DoubleSide}),dark=paper('#4a5149'),metal=paper('#4b554e');
  const grass=paper('#819a68',{side:THREE.DoubleSide}),path=paper('#d6ceba',{side:THREE.DoubleSide});
  const paver=architecturalMaterial('brick','#f3d6c2');paver.side=THREE.DoubleSide;
  function batch(geometry,material,matrix){
    const g=paperFacets(THREE,geometry,.055);if(matrix)g.applyMatrix4(matrix);
    if(g.attributes.uv)g.deleteAttribute('uv');if(g.attributes.normal===undefined)g.computeVertexNormals();
    if(!batches.has(material))batches.set(material,[]);batches.get(material).push(g);geometry.dispose();return g;
  }
  const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion();
  function block(x,y,z,w,h,d,material=cream,angle=0){
    matrix.compose(new THREE.Vector3(x,y,z),quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),angle),new THREE.Vector3(w,h,d));batch(new THREE.BoxGeometry(),material,matrix);
  }
  function groundBlock(x,z,topY,w,d,material=cream,angle=0){
    const c=Math.cos(angle),s=Math.sin(angle),ring=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([u,v])=>[x+c*u+s*v,z-s*u+c*v]);
    const b={rings:[ring],baseY:topY-.1,height:.1};
    const {geometry}=buildGroundedBuilding(THREE,b,campus.terrain);batch(geometry,material);
  }
  function rod(a,b,r,material=cream,sides=6){
    const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),direction=bv.clone().sub(av),len=direction.length();
    if(len<.001)return;matrix.compose(av.add(bv).multiplyScalar(.5),quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()),new THREE.Vector3(1,1,1));batch(new THREE.CylinderGeometry(r,r,len,sides),material,matrix);
  }
  function polygon(points,material=path,offset=.4){
    batch(terrainPatchGeometry(THREE,campus.terrain,points,offset),material);
  }
  function stripe(a,b,width=.5,material=path,offset=.49){
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/len*width/2,nz=(b[0]-a[0])/len*width/2;
    polygon([[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz]],material,offset);
  }
  function ring(x,z,inner,outer,mat,offset=.5,start=0,length=Math.PI*2,flatY){
    const count=Math.max(3,Math.ceil(48*length/(Math.PI*2)));
    for(let i=0;i<count;i++){
      const a=start+length*i/count,b=start+length*(i+1)/count,at=(r,t)=>[x+Math.cos(t)*r,z-Math.sin(t)*r];
      const points=inner>0?[at(inner,a),at(outer,a),at(outer,b),at(inner,b)]:[[x,z],at(outer,a),at(outer,b)];
      if(flatY===undefined)polygon(points,mat,offset);else{const g=new THREE.ShapeGeometry(new THREE.Shape(points.map(([px,pz])=>new THREE.Vector2(px,-pz))));g.rotateX(-Math.PI/2);g.translate(0,flatY,0);batch(g,mat);}
    }
  }
  function facadeFrame(a,b,normal,y){
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]),u=[(b[0]-a[0])/len,(b[1]-a[1])/len],n=normal;
    return {len,point:(s,h,depth=0)=>[a[0]+u[0]*s+n[0]*depth,y+h,a[1]+u[1]*s+n[1]*depth],angle:Math.atan2(-u[1],u[0]),u,n};
  }
  function arch(f,s,base,w,h,depth=.25){
    const shape=new THREE.Shape([[-w/2,0],[w/2,0],[w/2,h*.61],[w*.36,h*.83],[0,h],[-w*.36,h*.83],[-w/2,h*.61]].map(p=>new THREE.Vector2(...p)));
    const g=new THREE.ShapeGeometry(shape,8),m=new THREE.Matrix4().makeRotationY(f.angle);m.setPosition(...f.point(s,base,depth));batch(g,glass,m);
    const pts=[[-w/2,0],[-w/2,h*.61],[-w*.36,h*.83],[0,h],[w*.36,h*.83],[w/2,h*.61],[w/2,0]];
    for(let i=1;i<pts.length;i++)rod(f.point(s+pts[i-1][0],base+pts[i-1][1],depth+.06),f.point(s+pts[i][0],base+pts[i][1],depth+.06),.14,cream);
    for(const off of [-w/6,w/6])rod(f.point(s+off,base,depth+.1),f.point(s+off,base+h*.84,depth+.1),.065,cream,4);
    for(const fraction of [.27,.55,.71])rod(f.point(s-w*.46,base+h*fraction,depth+.1),f.point(s+w*.46,base+h*fraction,depth+.1),.065,cream,4);
    const p=f.point(s,base-.12,depth);block(...p,w+.55,.3,.8,cream,f.angle);
  }
  function cornice(building){
    const ring=building.rings[0];for(let i=1;i<ring.length;i++){
      const a=ring[i-1],b=ring[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<3)continue;
      block((a[0]+b[0])/2,building.baseY+building.height-.45,(a[1]+b[1])/2,len,.6,.6,cream,Math.atan2(-(b[1]-a[1]),b[0]-a[0]));
    }
  }

  // Red Square: its irregular extent, concrete rays and three brick ventilation pylons.
  polygon(RED_BOUNDARY,paver,.43);stats.features.push('red-square-brick-paving','concrete-radial-seams','three-brick-pylons','four-seat-platforms');
  const fan=[-115,68];for(const endpoint of [[-164,10],[-151,-7],[-133,-20],[-110,-10],[-90,0],[-72,4],[-61,11],[-66,43],[-69,64],[-83,75],[-155,65]])stripe(fan,endpoint,.48,path,.52);
  for(let i=0;i<4;i++){const x=-142+i*16,z=64-i*.5;polygon([[x-5,z],[x+5,z],[x+3,z+6],[x-3,z+6]],darkStone,.65);block(x,heightAt(x,z)+.85,z+2,8.8,.55,4.2,cream,-.04);}
  const pylons=[[-151,10,25],[-146,7,29],[-141,4,33]];
  pylons.forEach(([x,z,h])=>{const y=heightAt(x,z);groundBlock(x,z,y+h,2.5,3.4,brick,.17);block(x,y+h-.35,z,2.85,.7,3.75,darkStone,.17);for(let yy=h-3;yy<h-1;yy+=.5)block(x-1.3,y+yy,z,.1,.14,2.7,metal,.17);});
  // Broken Obelisk silhouette: geometric interpretation, not a licensed scan/copy of the sculpture.
  const obx=-79,obz=-4,oby=heightAt(obx,obz)+.4,rust=paper('#7d4d39');
  groundBlock(obx,obz,oby,4.8,4.8,darkStone);
  matrix.makeTranslation(obx,oby+1.8,obz);batch(new THREE.ConeGeometry(2.2,3.6,4),rust,matrix);
  const shard=new THREE.CylinderGeometry(1.18,.04,4.9,4,1,false);matrix.makeTranslation(obx,oby+6,obz);batch(shard,rust,matrix);
  stats.features.push('obelisk-silhouette');

  // Suzzallo's west 1926 wing: 11 monumental lancet bays, buttresses, portals and slate gable.
  const suz=campus.buildings.find(b=>b.code==='SUZ'),sf=facadeFrame([-53.5,7.5],[-64,70.6],[-.986,-.164],suz.baseY);
  for(let i=0;i<11;i++){
    const s=3.4+i*(sf.len-6.8)/10;arch(sf,s,6.6,3.25,12.6,.46);
    const p=sf.point(s,4,.45);block(...p,3.4,3.8,.7,stone,sf.angle);
    arch(sf,s,.2,2.8,5,.95);
    const portal=sf.point(s,5.7,.75);block(...portal,3.1,.55,1.1,cream,sf.angle);
  }
  for(let i=0;i<12;i++){
    const s=.65+i*(sf.len-1.3)/11,p=sf.point(s,21.6,1.1);groundBlock(p[0],p[2],p[1],.72,1.9,stone,sf.angle);
    const cap=sf.point(s,22.1,1.1);block(...cap,1.15,1.4,2,cream,sf.angle);
    const statue=sf.point(s,21.25,1.85);batch(new THREE.CapsuleGeometry(.24,.9,2,5),cream,new THREE.Matrix4().makeTranslation(...statue));
    const tip=sf.point(s,23.95,1.1);batch(new THREE.ConeGeometry(.6,2.3,4),cream,new THREE.Matrix4().makeTranslation(...tip));
  }
  for(let i=0;i<8;i++){const p=sf.point(sf.len/2,.15-i*.19,2+i*.8);groundBlock(p[0],p[2],Math.max(p[1],heightAt(p[0],p[2])+.14),22+i*.7,.9,cream,sf.angle);}
  stats.features.push('suzzallo-11-lancet-bays','suzzallo-buttresses-portals','slate-gabled-roof');

  // Other campus landmarks retain their GIS footprint and receive architectural type-specific detail.
  for(const b of campus.buildings.filter(b=>DETAIL_CODES.includes(b.code))){
    stats.detailedBuildings.push(b.code);cornice(b);
    const ring=b.rings[0],historic=!['KNE','OUG','MNY','HUB'].includes(b.code);
    for(let i=1;i<ring.length;i++){
      const a=ring[i-1],c=ring[i],len=Math.hypot(c[0]-a[0],c[1]-a[1]);if(len<9)continue;
      const dx=(c[0]-a[0])/len,dz=(c[1]-a[1])/len,mid=[(a[0]+c[0])/2,(a[1]+c[1])/2];
      let n=[-dz,dx];if(inside(mid[0]+n[0]*.8,mid[1]+n[1]*.8,b.rings))n=n.map(v=>-v);
      const f=facadeFrame(a,c,n,b.baseY),count=Math.floor(len/(historic?4.2:5.6));
      if(b.code==='SUZ'&&n[0]<-.8&&mid[0]<-45&&mid[1]>5&&mid[1]<72)continue;
      for(let j=0;j<count;j++){
        const s=len*(j+.5)/count;
        const location=f.point(s,0,.3),levels=historic?[3.4,8.4,13.2]:[4.2,9.1];
        for(let h=-2.1;b.baseY+h>heightAt(location[0],location[2])+2.1;h-=4.7)levels.push(h);
        for(const h of levels){
          if(h+2.4>b.height-.7)continue;
          const p=f.point(s,h,.3);block(...p,historic?1.7:3.2,2.65,.14,glass,f.angle);
          const frame=f.point(s,h-1.4,.4);block(...frame,historic?2.2:3.7,.22,.55,cream,f.angle);
          for(const side of [-1,1]){const q=f.point(s+side*(historic?1:1.8),h,.38);block(...q,.16,3,.35,cream,f.angle);}
          const q=f.point(s,h,.52);block(...q,.09,2.65,.1,cream,f.angle);
        }
      }
      if(!historic){
        const spacing=b.code==='KNE'?3.8:6.5;
        for(let j=0;j<=Math.floor(len/spacing);j++){const p=f.point(len*(j+.5)/(Math.floor(len/spacing)+1),b.height,.65);groundBlock(p[0],p[2],p[1],b.code==='KNE'?.55:.85,1.4,darkStone,f.angle);}
      }
    }
  }
  for(const profile of ROOF_PROFILES){
    const building=campus.buildings.find(b=>b.code===profile.code),model=buildFoldedRoof(THREE,building,profile);
    batch(model.geometry,roof);
    stats.roofAssemblies.push({buildingId:building.id,code:building.code,profile:profile.id,baseY:model.baseY,triangles:model.topVertexCount/3,footprintClipped:true});
  }
  // A single reference-supported tower, with a full shaft and a connected stone crown.
  // Rotation is shared by shaft, parapets, corner posts, windows and finials.
  const grb=campus.buildings.find(b=>b.code==='GRB'),td=GERBERDING_TOWER,{at,bottom,top}=towerSupport(grb);
  const tw=td.width,th=top-bottom,angle=td.angle;
  block(...at(0,0,bottom+th/2),tw,th,td.depth,stone,angle);
  for(const y of [top-5.4,top-.45])block(...at(0,0,y),tw+.45,.65,td.depth+.45,cream,angle);
  for(const side of [-1,1]){
    block(...at(0,side*(td.depth-.5)/2,top+.5),tw,1.1,.5,stone,angle);
    block(...at(side*(tw-.5)/2,0,top+.5),.5,1.1,td.depth,stone,angle);
  }
  for(const u of [-1,1])for(const v of [-1,1]){
    const cu=u*(tw-.65)/2,cv=v*(td.depth-.65)/2;
    block(...at(cu,cv,top-1),.7,7,.7,cream,angle);
    matrix.compose(new THREE.Vector3(...at(cu,cv,top+3.5)),quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),angle),new THREE.Vector3(1,1,1));
    batch(new THREE.ConeGeometry(.62,2,4),cream,matrix);
  }
  for(const [u,v] of [[0,1],[1,0],[0,-1],[-1,0]]){
    const center=at(u*tw*.5,v*td.depth*.5,0),normal=[Math.cos(angle)*u+Math.sin(angle)*v,-Math.sin(angle)*u+Math.cos(angle)*v];
    const tangent=[-normal[1],normal[0]],left=[center[0]-tangent[0]*tw*.35,center[2]-tangent[1]*tw*.35],right=[center[0]+tangent[0]*tw*.35,center[2]+tangent[1]*tw*.35];
    const frame=facadeFrame(left,right,normal,top-11);arch(frame,frame.len/2,0,2.3,7,.04);
  }
  stats.roofAssemblies.push({code:'GRB',profile:'continuous-tower',bottom,top,rotation:angle,footprintClipped:true});
  stats.features.push('folded-paper-3d-roofs','connected-gerberding-tower','removed-generic-roof-boxes');
  // Denny: a steep central roof, rounded turrets and its cupola, aligned to its actual footprint.
  const den=campus.buildings.find(b=>b.code==='DEN'),dy=den.baseY+den.height;
  for(const [x,z] of [[-95,-220],[-50,-264]]){
    matrix.makeTranslation(x,dy-1,z);batch(new THREE.CylinderGeometry(4.3,4.3,4,12),stone,matrix);
    matrix.makeTranslation(x,dy+5.15,z);batch(new THREE.ConeGeometry(4.7,8.3,12),roof,matrix);
  }
  const dx=-72,dz=-242,cupolaBottom=dy-.2,cupolaTop=dy+10;
  matrix.makeTranslation(dx,(cupolaBottom+cupolaTop)/2,dz);batch(new THREE.CylinderGeometry(3,3.5,cupolaTop-cupolaBottom,8),stone,matrix);
  for(let i=0;i<8;i++){const a=i*Math.PI/4;block(dx+Math.cos(a)*3,dy+8,dz+Math.sin(a)*3,1.25,3,.18,glass,Math.PI/2-a);}
  matrix.makeTranslation(dx,cupolaTop,dz);batch(new THREE.SphereGeometry(3.7,8,4,0,Math.PI*2,0,Math.PI/2),roof,matrix);
  rod([dx,cupolaTop+3.6,dz],[dx,cupolaTop+5,dz],.13,metal);stats.features.push('denny-connected-octagonal-cupola');

  // Drumheller: level circular pool, concentric coping, four rose-garden quadrants and formal vista.
  const f=FOUNTAIN,fy=heightAt(f.x,f.z)+1.35;
  ring(f.x,f.z,0,f.promenadeRadius,path,.42);
  const fountain=installPaperFountain(THREE,root,campus.terrain,f,fy);animated.push(fountain.update);stats.fountain=fountain.stats;
  const roseColors=['#b55766','#d8aaab','#ead0b9'],flowerPositions=[];
  for(let quadrant=0;quadrant<4;quadrant++){
    const a=quadrant*Math.PI/2+.13,b=(quadrant+1)*Math.PI/2-.13;
    ring(f.x,f.z,34,45,grass,.4,a,b-a);ring(f.x,f.z,35,35.9,paper('#496644',{side:THREE.DoubleSide}),.9,a,b-a);
    ring(f.x,f.z,43.5,44.6,paper('#496644',{side:THREE.DoubleSide}),1,a,b-a);
    for(let i=0;i<32;i++){const angle=a+(b-a)*(i+.5)/32,r=37.2+(i%3)*2.2,x=f.x+Math.cos(angle)*r,z=f.z-Math.sin(angle)*r;if(!campus.buildings.some(b=>inside(x,z,b.rings)))flowerPositions.push([x,heightAt(x,z)+.9,z]);}
  }
  const flowerRaw=new THREE.OctahedronGeometry(.65,0),flowerGeo=paperFacets(THREE,flowerRaw,.12);flowerRaw.dispose();
  const flower=new THREE.InstancedMesh(flowerGeo,paper('#ffffff'),flowerPositions.length);
  flowerPositions.forEach((p,i)=>{matrix.makeRotationY(i*.618);matrix.setPosition(...p);flower.setMatrixAt(i,matrix);flower.setColorAt(i,new THREE.Color(roseColors[i%3]));rod([p[0],heightAt(p[0],p[2])-.06,p[2]],[p[0],p[1],p[2]],.06,grass,4);});flower.castShadow=true;root.add(flower);
  // Rainier Vista continues south-east from the pool; the direction follows the published site axis.
  const axis=[.43,.903],normal=[-.903,.43],end=[f.x+axis[0]*165,f.z+axis[1]*165];
  for(const side of [-1,1])stripe([f.x+axis[0]*31+normal[0]*side*9,f.z+axis[1]*31+normal[1]*side*9],[end[0]+normal[0]*side*9,end[1]+normal[1]*side*9],4.4,path,.42);
  stats.features.push('drumheller-concentric-pool','central-and-two-rings-of-jets','folded-paper-water-jets-and-droplets','four-rose-garden-quadrants','rainier-vista-axis');

  // Benches and lamps are custom geometry, not downloaded photographic assets.
  for(const angle of [.15,.7,1.4,2.1,2.9,3.6,4.5,5.5]){
    const x=f.x+Math.cos(angle)*28,z=f.z+Math.sin(angle)*28,y=heightAt(x,z)+.7,a=-angle;
    block(x,y,z,3.1,.26,.8,cream,a);for(const side of [-1,1])groundBlock(x+Math.cos(a)*side,z-Math.sin(a)*side,y-.1,.28,.55,darkStone,a);
    const lx=f.x+Math.cos(angle)*32,lz=f.z+Math.sin(angle)*32,ly=heightAt(lx,lz);rod([lx,ly-.15,lz],[lx,ly+5,lz],.09,metal);block(lx,ly+5.15,lz,.5,.55,.5,cream);
  }

  // Structured vegetation. The Quad has 30 symbolic Yoshino trees; positions are visual estimates.
  const trees=[];function tree(x,z,size=6,type='broadleaf',seed=0){
    if(campus.buildings.some(b=>inside(x,z,b.rings)))return;trees.push({x,z,y:heightAt(x,z),size,type,seed});
  }
  const quad=campus.landmarks.find(p=>p.id==='quad').point,qu=[.704,-.71],qn=[.71,.704];
  for(let side of [-1,1])for(let row=0;row<3;row++)for(let i=0;i<5;i++){
    const along=(i-2)*13,across=side*(10+row*7);tree(quad[0]+qu[0]*along+qn[0]*across,quad[2]+qu[1]*along+qn[1]*across,4.6,'cherry',i+row);
  }
  for(let side of [-1,1])for(let i=0;i<8;i++){const dist=55+i*15;tree(f.x+axis[0]*dist+normal[0]*side*17,f.z+axis[1]*dist+normal[1]*side*17,5.8,'evergreen',i);}
  let seed=541;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<185;i++){
    const p=campus.graph.nodes[Math.floor(rand()*campus.graph.nodes.length)],x=p[0]+(rand()-.5)*36,z=p[2]+(rand()-.5)*36;
    if(x<campus.terrain.bounds[0]+5||x>campus.terrain.bounds[2]-5||z<campus.terrain.bounds[1]+5||z>campus.terrain.bounds[3]-5)continue;
    if(inside(x,z,[RED_BOUNDARY])||Math.hypot(x-f.x,z-f.z)<47||Math.hypot(x-quad[0],z-quad[2])<55)continue;
    tree(x,z,4+rand()*4,rand()>.75?'evergreen':'broadleaf',rand());
  }
  const leaves=paper('#ffffff'),crowns=[],bark=paper('#756653'),evergreenA=paper('#44654d'),evergreenB=paper('#3e5e49');
  for(const t of trees){
    rod([t.x,t.y-.4,t.z],[t.x,t.y+t.size*1.35,t.z],.35,bark);
    if(t.type==='evergreen'){
      for(let j=0;j<3;j++){const g=new THREE.ConeGeometry(t.size*(.65-j*.12),t.size*.9,6);matrix.makeTranslation(t.x,t.y+t.size*(.7+j*.35),t.z);batch(g,j%2?evergreenA:evergreenB,matrix);}
    }else for(let j=0;j<5;j++){
      const a=j*2.4+t.seed,rad=t.size*.36,cx=t.x+Math.cos(a)*rad,cz=t.z+Math.sin(a)*rad;
      crowns.push({x:cx,y:t.y+t.size*(1.15+(j%2)*.25),z:cz,s:t.size*.59,type:t.type,seed:t.seed+j*.07});
    }
  }
  const canopy=new THREE.InstancedMesh(paperCrownGeometry(THREE),leaves,crowns.length);
  crowns.forEach((c,i)=>{matrix.compose(new THREE.Vector3(c.x,c.y,c.z),quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),c.seed),new THREE.Vector3(c.s,c.s*.82,c.s));canopy.setMatrixAt(i,matrix);canopy.setColorAt(i,new THREE.Color(c.type==='cherry'?'#e4d0cb':i%3?'#72977c':'#92ae83'));});canopy.castShadow=true;canopy.receiveShadow=true;root.add(canopy);
  stats.features.push('structured-quad-tree-groups','vista-evergreen-avenue','origami-tree-crowns','paper-flower-buds','matte-paper-facades','creased-plaza-paving','paper-street-furniture');stats.paperAssetFamilies=['building-shells','roofs','facades','terrain','paving','water','trees','flowers','furniture','mountain','visitor-parts'];stats.trees=trees.length;stats.symbolicQuadTreesPlaced=trees.filter(t=>t.type==='cherry').length;
  for(const [mat,geometries] of batches){
    const mesh=new THREE.Mesh(mergeGeometries(geometries),mat);mesh.castShadow=![grass,path,paver].includes(mat);mesh.receiveShadow=true;root.add(mesh);geometries.forEach(g=>g.dispose());
  }
  // Separate transparent interaction skins: detailed facades still select the original building identity.
  for(const b of campus.buildings.filter(b=>DETAIL_CODES.includes(b.code))){const original=buildingMeshes.get(b.id);if(original)picking.push(original);}
  stats.drawGroups=root.children.length;
  return {root,stats,picking,update(time){for(const run of animated)run(time);}};
}
