import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {installCampusArt,architecturalMaterial,ART_CAMERAS,DETAIL_CODES,ART_VERSION,ART_REFERENCES} from './art-scene.js';
import {installCampusServices} from './campus-services.js';
import {installVisitorEditor} from './visitor-editor.js';
import {buildVisitorModel} from './visitor-model.js';
import {terrainHeight} from './terrain-surface.js';
import {buildGroundedBuilding,paperFacets} from './paper-surfaces.js';
import {createCampusWalking} from './campus-walking.js';
import {installVisitorWalking} from './visitor-walk.js';
import {unobstructedVisitorCamera,createCameraCollisionIndex} from './visitor-camera.js';
import {createWalkPresentation,motionPoint} from './walk-motion.js';
import {installCampusEnvironment} from './campus-environment.js';

const $=(id)=>document.getElementById(id),canvas=$('campus-canvas'),map=canvas.parentElement;
const state={campus:null,selected:'red-square',filter:'all',search:'',route:null,move:null,tour:false,tourIndex:0,context:null,busy:false,plan:false};
const campusServices=installCampusServices({selectedPlace:()=>state.selected});
const tourStops=['denny','raitt','savery','quad','red-square','suzzallo','fountain','hub'];
const icons={history:'♜',landscape:'❋',learning:'▥',student:'◇'};
const responseTimings=new WeakMap();
const api=async(path,body)=>{
  const sentAt=performance.now();
  const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const value=await response.json();responseTimings.set(value,performance.now()-sentAt);if(!response.ok||value.error)throw Object.assign(Error(value.error?.message||'请求未完成'),{code:value.error?.code,status:response.status});return value;
};
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4500);}
function element(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function officialLink(source){const a=element('a',null,'查看原始资料 ↗');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';return a;}

let renderer,scene,camera,controls,terrain,selectionRing,avatar,art,environment,presentation;
let followVisitor=false,visitorModel=null,clockOffset=0,movingRequest=false,walkController,walking,motionRevision=0,freePresentation=false,mapWidth=1,mapHeight=1,lastViewMode=null;
const visitorEditor=installVisitorEditor({api,toast,onApply(profile,catalog,metadata={}){
  if(visitorModel){avatar.remove(visitorModel);visitorModel.userData.dispose();}
  visitorModel=buildVisitorModel(THREE,profile.recipe,catalog.skins);avatar.add(visitorModel);
  visitorModel.traverse(o=>{if(o.isMesh)o.castShadow=false;});
  $('visitor-marker').textContent=profile.displayName;
  canvas.dataset.avatarHash=metadata.storedProfile?.modelHash||profile.modelHash||'unsaved';
  canvas.dataset.displayAvatarHash=profile.modelHash||'unsaved';canvas.dataset.displayAvatarGenerator=profile.recipe.generatorVersion;
  $('visitor-edit').textContent=profile.revision?'我的形象':'建立形象';$('visitor-edit').title=profile.displayName||'校园访客';
}});
const buildingMeshes=new Map(),labelElements=new Map(),routeGroup=new THREE.Group(),landmarkPoints=new Map();
let tween=null,last=performance.now(),dragStart=null,webglErrors=[],cameraObstacles=[],nextCameraCheck=0;

function heightAt(x,z){
  return terrainHeight(state.campus.terrain,x,z);
}
function inside(x,z,rings){
  const ringContains=(ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;
  }return c;};
  return ringContains(rings[0])&&!rings.slice(1).some(ringContains);
}
function shapeFor(rings){
  const make=(ring)=>ring.map(([x,z])=>new THREE.Vector2(x,-z));
  const shape=new THREE.Shape(make(rings[0]));
  for(const ring of rings.slice(1))shape.holes.push(new THREE.Path(make(ring)));
  return shape;
}
function patch(points,color,height=.2){
  const geometry=new THREE.ShapeGeometry(new THREE.Shape(points.map(([x,z])=>new THREE.Vector2(x,-z))));
  geometry.rotateX(-Math.PI/2);
  const positions=geometry.attributes.position;
  for(let i=0;i<positions.count;i++)positions.setY(i,heightAt(positions.getX(i),positions.getZ(i))+height);
  geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide}));mesh.receiveShadow=true;scene.add(mesh);return mesh;
}
function pathRibbon(points,width,color,offset=.25){
  if(points.length<2)return;
  // Sample long GIS line segments against the same DEM as the plazas; coarse chords otherwise
  // poke through detailed paving as unrelated white wedges when the terrain changes slope.
  const dense=[];
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])/1.5));for(let j=0;j<count;j++){const t=j/count;dense.push(a.map((v,k)=>v+(b[k]-v)*t));}}
  dense.push(points.at(-1));points=dense;
  const verts=[],indices=[];
  for(let i=0;i<points.length;i++){
    const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz)||1;
    const x=points[i][0],z=points[i][2],nx=-dz/length*width/2,nz=dx/length*width/2;
    verts.push(x+nx,heightAt(x+nx,z+nz)+offset,z+nz,x-nx,heightAt(x-nx,z-nz)+offset,z-nz);
    if(i){const n=i*2;indices.push(n-2,n-1,n,n-1,n+1,n);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,side:THREE.DoubleSide,roughness:1}));mesh.receiveShadow=true;return mesh;
}
function setupScene(campus){
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,logarithmicDepthBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.96;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate=false;
  scene=new THREE.Scene();scene.background=new THREE.Color('#dfe7e6');scene.fog=new THREE.Fog('#dfe7e6',1250,3000);
  camera=new THREE.PerspectiveCamera(36,1,.2,160000);controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.075;controls.minDistance=5;controls.maxDistance=2100;controls.maxPolarAngle=Math.PI*.48;controls.minPolarAngle=.09;controls.enablePan=true;
  scene.add(new THREE.HemisphereLight(0xe6eff8,0x737662,2.1));
  const sun=new THREE.DirectionalLight(0xffedda,2.6);sun.position.set(-410,650,350);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-600;sun.shadow.camera.right=600;sun.shadow.camera.top=650;sun.shadow.camera.bottom=-650;sun.shadow.camera.far=1800;sun.shadow.normalBias=.12;sun.shadow.bias=-.00008;scene.add(sun);
  // Neutral presentation ground continues to the far-field horizon; it is not additional GIS.
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(300000,300000),new THREE.MeshBasicMaterial({color:'#bdcfb1',fog:true}));ground.rotation.x=-Math.PI/2;ground.position.y=-15;scene.add(ground);
  const t=campus.terrain,[x0,z0,x1,z1]=t.bounds,verts=[],indices=[],colors=[];
  const low=new THREE.Color('#91aa8b'),high=new THREE.Color('#b6c6a0');const range=Math.max(...t.heights)-Math.min(...t.heights),minimum=Math.min(...t.heights);
  for(let j=0;j<t.height;j++)for(let i=0;i<t.width;i++){
    const y=t.heights[j*t.width+i];verts.push(x0+i/(t.width-1)*(x1-x0),y,z0+j/(t.height-1)*(z1-z0));
    const c=low.clone().lerp(high,(y-minimum)/(range||1)*.7);colors.push(c.r,c.g,c.b);
    if(i&&j){const n=j*t.width+i;indices.push(n-t.width-1,n-1,n-t.width,n-t.width,n-1,n);}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
  const paperTerrain=paperFacets(THREE,geo,.045);geo.dispose();
  terrain=new THREE.Mesh(paperTerrain,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,flatShading:true,side:THREE.DoubleSide}));terrain.receiveShadow=true;scene.add(terrain);
  // A shallow terrain skirt makes the clipped real DEM read as a physical campus model.
  const border=[];for(let i=0;i<t.width;i++)border.push([x0+i/(t.width-1)*(x1-x0),z0]);for(let j=1;j<t.height;j++)border.push([x1,z0+j/(t.height-1)*(z1-z0)]);for(let i=t.width-2;i>=0;i--)border.push([x0+i/(t.width-1)*(x1-x0),z1]);for(let j=t.height-2;j>0;j--)border.push([x0,z0+j/(t.height-1)*(z1-z0)]);
  const sideVerts=[],sideIndices=[];for(let i=0;i<border.length;i++){const [x,z]=border[i];sideVerts.push(x,heightAt(x,z),z,x,-14,z);const n=i*2,next=((i+1)%border.length)*2;sideIndices.push(n,next,n+1,next,next+1,n+1);}
  const sides=new THREE.BufferGeometry();sides.setAttribute('position',new THREE.Float32BufferAttribute(sideVerts,3));sides.setIndex(sideIndices);sides.computeVertexNormals();scene.add(new THREE.Mesh(sides,new THREE.MeshStandardMaterial({color:'#b4bca1',roughness:1,side:THREE.DoubleSide})));
  const pathBatches=new Map();
  for(const row of campus.paths){const road=row.kind==='road',mesh=pathRibbon(row.points,road?7:3.1,road?'#bfc3b5':'#e7e0ca',road?.12:.25);if(!mesh)continue;if(!pathBatches.has(road))pathBatches.set(road,[]);pathBatches.get(road).push(mesh.geometry);mesh.material.dispose();}
  for(const [road,geometries] of pathBatches){const mesh=new THREE.Mesh(mergeGeometries(geometries),new THREE.MeshStandardMaterial({color:road?'#bfc3b5':'#e7e0ca',side:THREE.DoubleSide,roughness:1}));mesh.receiveShadow=true;scene.add(mesh);geometries.forEach(g=>g.dispose());}
  const windowMatrices=[],matrix=new THREE.Matrix4(),groundings=[];
  for(const building of campus.buildings){
    const {geometry,grounding}=buildGroundedBuilding(THREE,building,t);groundings.push({id:building.id,code:building.code,...grounding});
    const primary=campus.landmarks.some(p=>p.buildingId===building.id);
    const roof=new THREE.MeshStandardMaterial({color:['SUZ','DEN','SAV','RAI','GRB','MGH','GUG','BAG'].includes(building.code)?'#698080':'#c3c4b1',roughness:1,metalness:0,flatShading:true,vertexColors:true});
    const wall=architecturalMaterial(['DEN','GRB','KNE','HUB'].includes(building.code)?'stone':['MGH','JHN','GUG','BAG'].includes(building.code)?'buff-brick':'brick',primary||DETAIL_CODES.includes(building.code)?'#faf5e9':'#c9c7ae');
    const foundation=architecturalMaterial('stone','#c8c3ad');
    const mesh=new THREE.Mesh(geometry,[roof,wall,foundation]);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData={buildingId:building.id,roof,wall,grounding,originalRoof:roof.color.clone(),originalWall:wall.color.clone()};scene.add(mesh);buildingMeshes.set(building.id,mesh);
    if(primary||DETAIL_CODES.includes(building.code)){const outline=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,28),new THREE.LineBasicMaterial({color:'#a0947e',transparent:true,opacity:.25}));scene.add(outline);}
    if(!DETAIL_CODES.includes(building.code)){
      const ring=building.rings[0];for(let i=1;i<ring.length;i++){
        const a=ring[i-1],b=ring[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<5)continue;
        const count=Math.floor(len/5.8),angle=Math.atan2(-(b[1]-a[1]),b[0]-a[0]);
        for(let n=0;n<count;n++){
          const f=(n+.5)/count,x=a[0]+(b[0]-a[0])*f,z=a[1]+(b[1]-a[1])*f;
          const levels=[building.baseY+building.height*.32,building.baseY+building.height*.65];
          for(let y=building.baseY-2.1;y>heightAt(x,z)+2.1;y-=4.7)levels.push(y);
          for(const y of levels){matrix.compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle),new THREE.Vector3(2.2,2.7,.32));windowMatrices.push(matrix.clone());}
        }
      }
    }
  }
  if(windowMatrices.length){const windows=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:'#526166',roughness:1,metalness:0,flatShading:true}),windowMatrices.length);windowMatrices.forEach((m,i)=>windows.setMatrixAt(i,m));scene.add(windows);}
  art=installCampusArt({scene,campus,heightAt,inside,buildingMeshes});
  environment=installCampusEnvironment(THREE,scene,campus);cameraObstacles=createCameraCollisionIndex(THREE,[...buildingMeshes.values(),...art.root.children.filter(o=>o.isMesh),...environment.boundary.children]);
  canvas.dataset.environment=JSON.stringify(environment.stats);canvas.dataset.cameraIndex=JSON.stringify(cameraObstacles.stats);
  walking=createCampusWalking(campus);
  art.stats.grounding={buildings:groundings.length,terrainSampling:'rendered-triangle-exact',burialMetres:.32,oldMaximumGap:Math.max(...groundings.map(g=>g.previousMaximumGap)),unsupportedPerimeters:groundings.filter(g=>g.bottom>g.minimum).length};
  canvas.dataset.groundingMetrics=JSON.stringify(art.stats.grounding);
  scene.add(routeGroup);
  avatar=new THREE.Group();scene.add(avatar);
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;const shadowCtx=shadowCanvas.getContext('2d'),gradient=shadowCtx.createRadialGradient(32,32,0,32,32,32);gradient.addColorStop(0,'rgba(38,43,34,.23)');gradient.addColorStop(1,'rgba(38,43,34,0)');shadowCtx.fillStyle=gradient;shadowCtx.fillRect(0,0,64,64);const contactShadow=new THREE.Mesh(new THREE.PlaneGeometry(1,.72),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));contactShadow.rotation.x=-Math.PI/2;contactShadow.position.y=.015;avatar.add(contactShadow);
  selectionRing=new THREE.Mesh(new THREE.RingGeometry(6.5,8,16),new THREE.MeshBasicMaterial({color:'#87649f',side:THREE.DoubleSide,transparent:true,opacity:.6}));selectionRing.rotation.x=-Math.PI/2;scene.add(selectionRing);
  campus.landmarks.forEach(p=>{const button=element('button','map-label',p.id==='fountain'?'Drumheller Fountain':p.name);button.dataset.place=p.id;button.setAttribute('aria-label','查看 '+p.name);button.addEventListener('click',()=>selectPlace(p.id));$('labels').append(button);labelElements.set(p.id,button);landmarkPoints.set(p.id,new THREE.Vector3(p.point[0],p.point[1]+(campus.buildings.find(b=>b.id===p.buildingId)?.height||4)+7,p.point[2]));});
  const resize=()=>{mapWidth=map.clientWidth;mapHeight=map.clientHeight;renderer.setSize(mapWidth,mapHeight,false);camera.aspect=mapWidth/mapHeight;camera.updateProjectionMatrix();};new ResizeObserver(resize).observe(map);resize();
  controls.addEventListener('end',()=>walkController?.reorient());renderer.shadowMap.needsUpdate=true;
  resetView(false);
  canvas.addEventListener('pointerdown',e=>{dragStart=[e.clientX,e.clientY];tween=null;canvas.focus({preventScroll:true});});
  canvas.addEventListener('pointerup',e=>{
    if(!dragStart||Math.hypot(e.clientX-dragStart[0],e.clientY-dragStart[1])>5)return;
    const rect=canvas.getBoundingClientRect(),pointer=new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),ray=new THREE.Raycaster();ray.setFromCamera(pointer,camera);
    const hit=ray.intersectObjects([...buildingMeshes.values()])[0];if(hit){const p=campus.landmarks.find(p=>p.buildingId===hit.object.userData.buildingId);if(p)selectPlace(p.id);else toast(hit.object.userData.buildingId.replace('sea-','建筑轮廓 #')+' · 该建筑尚未配置详细资料');}
  });
  renderer.setAnimationLoop(animate);
  window.__UW_MVP__={geometryHash:campus.geometryHash,buildings:buildingMeshes.size,landmarks:campus.landmarks.length,terrainVertices:t.width*t.height,webglErrors,ready:true,art:art.stats};
  canvas.dataset.artMetrics=JSON.stringify(art.stats);
}
function cameraTo(target,distance=520){
  followVisitor=false;controls.maxDistance=2100;controls.enablePan=true;
  camera.fov=36;camera.updateProjectionMatrix();
  tween={start:performance.now(),from:camera.position.clone(),to:new THREE.Vector3(target.x+distance*.57,target.y+distance*.9,target.z+distance*.8),oldTarget:controls.target.clone(),target:target.clone(),duration:950};
}
function artView(id){
  followVisitor=false;controls.maxDistance=2100;controls.enablePan=true;
  camera.fov=36;camera.updateProjectionMatrix();
  const v=ART_CAMERAS[id];if(!v)return;state.plan=false;const target=new THREE.Vector3(...v.target);tween={start:performance.now(),from:camera.position.clone(),to:target.clone().add(new THREE.Vector3(...v.offset)),oldTarget:controls.target.clone(),target,duration:1000};document.querySelectorAll('[data-art-view]').forEach(b=>b.classList.toggle('active',b.dataset.artView===id));$('map-subtitle').textContent=id==='vista'?'Rainier 地理方位 · 山形示意 · 非实时能见度':'折纸风 3D · 真实校园轮廓与地形 · UW 地标';
}
function resetView(animate=true){
  followVisitor=false;controls.maxDistance=2100;controls.enablePan=true;
  camera.fov=36;camera.updateProjectionMatrix();
  state.plan=false;$('top-view').classList.remove('active');
  const target=new THREE.Vector3(0,20,3),position=new THREE.Vector3(-530,650,730);
  if(animate)tween={start:performance.now(),from:camera.position.clone(),to:position,oldTarget:controls.target.clone(),target,duration:1100};
  else{camera.position.copy(position);controls.target.copy(target);controls.update();}
}
function animate(){
  if(document.hidden||$('visitor-editor')?.open)return;
  const now=performance.now(),delta=Math.min(.05,(now-last)/1000);last=now;
  if(tween){const f=Math.min(1,(now-tween.start)/tween.duration),t=1-(1-f)**3;camera.position.lerpVectors(tween.from,tween.to,t);controls.target.lerpVectors(tween.oldTarget,tween.target,t);if(f===1)tween=null;}
  controls.update();
  art?.update(now*.001);
  const before=avatar.position.clone(),input=walkController?.input();
  if(freePresentation){avatar.position.fromArray(presentation.advance(input,delta*1000,now));if(input)avatar.rotation.y+=Math.atan2(Math.sin(Math.atan2(input[0],input[1])-avatar.rotation.y),Math.cos(Math.atan2(input[0],input[1])-avatar.rotation.y))*(1-Math.exp(-delta/.09));}
  else if(state.move){
    const path=state.move.path,elapsed=Math.max(0,(Date.now()+clockOffset-state.move.startedAt)/1000),budget=elapsed*state.move.previewSpeed;
    let travelled=0,position=path.at(-1).point,done=true;
    for(let i=1;i<path.length;i++){const a=path[i-1].point,b=path[i].point,len=Math.hypot(...a.map((v,j)=>b[j]-v));if(travelled+len>budget){const t=(budget-travelled)/len;position=a.map((v,j)=>v+(b[j]-v)*t);avatar.rotation.y=Math.atan2(b[0]-a[0],b[2]-a[2]);done=false;break;}travelled+=len;}
    avatar.position.fromArray(position);
    const bar=$('route-progress');if(bar)bar.style.width=Math.min(100,budget/(state.move.distance||1)*100)+'%';
    if(done){const to=state.move.toId;state.move=null;if(to){toast('已到达 '+state.campus.landmarks.find(p=>p.id===to).name+' 附近导览点');if(state.tour)setTimeout(nextTourStop,1400);}}
  }
  const groundY=walking.height(avatar.position.x,avatar.position.z);avatar.position.y=before.y+(groundY-before.y)*(1-Math.exp(-delta/.06));
  const moving=Math.hypot(avatar.position.x-before.x,avatar.position.z-before.z)>.0003;
  visitorModel?.userData.animate(now*.001,moving?'walk':'idle');
  if(followVisitor&&!tween){const target=avatar.position.clone().add(new THREE.Vector3(0,1,0));const shift=target.clone().sub(controls.target).multiplyScalar(1-Math.exp(-delta/.055));controls.target.add(shift);camera.position.add(shift);}
  if(followVisitor&&!tween&&now>=nextCameraCheck){camera.position.copy(unobstructedVisitorCamera(THREE,controls.target,camera.position,cameraObstacles));nextCameraCheck=now+32;}
  environment.update(camera);
  const marker=avatar.position.clone().add(new THREE.Vector3(0,2.1,0)).project(camera);
  $('visitor-marker').hidden=!avatar.visible||marker.z>1||marker.z< -1;
  $('visitor-marker').style.left=(marker.x*.5+.5)*mapWidth+'px';$('visitor-marker').style.top=(-marker.y*.5+.5)*mapHeight+'px';
  canvas.dataset.visitorPosition=JSON.stringify(avatar.position.toArray());
  canvas.dataset.visitorOnScreen=String(avatar.visible&&Math.abs(marker.x)<1&&Math.abs(marker.y)<1&&marker.z>-1&&marker.z<1);canvas.dataset.viewMode=followVisitor?'visitor':'campus';canvas.dataset.movementMode=state.move?.mode==='free'?'free':state.move?.toId?'guided':'idle';
  if(lastViewMode!==followVisitor){lastViewMode=followVisitor;$('walk-controls').classList.toggle('overview',!followVisitor);$('walk-follow').textContent=followVisitor?'人物视角':'回到人物';document.body.classList.toggle('visitor-view',followVisitor);}
  const p=state.campus.landmarks.find(p=>p.id===state.selected);selectionRing.position.set(p.point[0],p.point[1]+.8,p.point[2]);selectionRing.material.opacity=.45+Math.sin(now*.0018)*.1;
  for(const [id,label] of labelElements){const point=landmarkPoints.get(id).clone().project(camera);label.hidden=point.z>1||point.z< -1;label.style.left=(point.x*.5+.5)*mapWidth+'px';label.style.top=(-point.y*.5+.5)*mapHeight+'px';label.classList.toggle('selected',id===state.selected);}
  renderer.render(scene,camera);
  if(!canvas.dataset.renderMetrics)canvas.dataset.renderMetrics=JSON.stringify({drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures});
}
function renderList(){
  const rows=state.campus.landmarks.filter(p=>(state.filter==='all'||p.category===state.filter)&&(p.name+' '+p.nameZh+' '+p.subtitle).toLowerCase().includes(state.search.toLowerCase()));
  $('landmark-count').textContent=rows.length+' PLACES';$('landmark-list').replaceChildren();
  if(!rows.length)$('landmark-list').append(element('p','empty','没有找到，试试 Denny、HUB 或红场。'));
  rows.forEach(p=>{const button=element('button','place-row'+(p.id===state.selected?' selected':''));button.dataset.place=p.id;button.setAttribute('aria-label','选择 '+p.name);button.append(element('span','place-icon',icons[p.category]));const copy=element('div');copy.append(element('strong',null,p.name),element('small',null,p.nameZh+' · '+p.subtitle.split(' · ')[0]));button.append(copy,element('span','row-arrow','↗'));button.addEventListener('click',()=>selectPlace(p.id));$('landmark-list').append(button);});
  $('landmark-list').querySelector('.selected')?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function selectPlace(id,focus=true){
  const p=state.campus.landmarks.find(x=>x.id===id);if(!p)return;state.selected=id;
  canvas.dataset.selectedPlace=id;
  buildingMeshes.forEach(mesh=>{mesh.userData.roof.color.copy(mesh.userData.originalRoof);mesh.userData.wall.color.copy(mesh.userData.originalWall);});
  const selected=buildingMeshes.get(p.buildingId);if(selected){selected.userData.roof.color.lerp(new THREE.Color('#aa9aaf'),.25);}
  renderList();const card=$('place-card');card.replaceChildren();if(focus)card.dataset.collapsed='false';
  const detailToggle=element('button','card-toggle',card.dataset.collapsed==='true'?'展开':'收起');detailToggle.id='place-detail-toggle';detailToggle.setAttribute('aria-expanded',String(card.dataset.collapsed!=='true'));detailToggle.setAttribute('aria-label','展开或收起地标详情');detailToggle.onclick=()=>{const collapsed=card.dataset.collapsed!=='true';card.dataset.collapsed=String(collapsed);detailToggle.textContent=collapsed?'展开':'收起';detailToggle.setAttribute('aria-expanded',String(!collapsed));};card.append(detailToggle);
  $('map-headline').textContent=p.name;$('map-region-tag').textContent=p.nameZh;
  const kicker=element('div','card-kicker');kicker.append(element('span','card-index',String(state.campus.landmarks.indexOf(p)+1).padStart(2,'0')),element('span',null,p.subtitle));card.append(kicker,element('h3',null,p.name),element('div','card-zh',p.nameZh),element('p','card-description',p.description));
  const metadata=element('div','card-metadata');metadata.append(element('span',null,'公开资料'),element('span',null,p.buildingId?'建筑外观参考建模':'景观参考建模'));card.append(metadata);
  const actions=element('div','card-actions'),go=element('button','primary-button');go.id='go-to-place';go.setAttribute('aria-label','步行前往');go.append(element('span',null,'步行前往'),element('span',null,'↗'));go.addEventListener('click',()=>walkTo(id));const ask=element('button','secondary-button','问问接待');ask.addEventListener('click',()=>{openChat();sendQuestion('介绍一下 '+p.name+' '+p.nameZh);});actions.append(go,ask);card.append(actions);
  const source=state.campus.sources.find(s=>s.id===p.sourceIds[0]),credit=element('div','card-source');credit.append(element('span',null,'资料：'+(p.sourceIds[0].endsWith('hra')?'UW 历史资源附录':'UW 官方地图与 GIS')),officialLink(source));card.append(credit);
  const services=element('button','quiet-button','此处的校园功能 ↗');services.id='place-services';services.onclick=campusServices.open;card.append(services);
  if(focus&&camera){state.plan=false;const view=ART_CAMERAS[id];if(view)artView(id);else cameraTo(new THREE.Vector3(p.point[0],p.point[1]+10,p.point[2]),270);}
  window.__UW_MVP__&&(window.__UW_MVP__.selected=id);
}
function drawRoute(route){
  while(routeGroup.children.length){const child=routeGroup.children.pop();child.geometry?.dispose();child.material?.dispose();}
  const points=route.path.map(p=>p.point),ribbon=pathRibbon(points,3.8,'#8261a4',.7);if(ribbon)routeGroup.add(ribbon);
  for(const point of [points[0],points.at(-1)]){const dot=new THREE.Mesh(new THREE.CylinderGeometry(4.5,4.5,.8,32),new THREE.MeshBasicMaterial({color:'#fdf8ed'}));dot.position.set(point[0],point[1]+1,point[2]);routeGroup.add(dot);}
}
async function walkTo(id){
  if(movingRequest)return;movingRequest=true;
  try{
    await walkController.pause();
    freePresentation=false;
    const move=await api('/api/move',{toId:id,requestId:crypto.randomUUID()});motionRevision=move.revision||0;state.move=move;state.route=move;drawRoute(move);selectPlace(id,false);
    const p=state.campus.landmarks.find(p=>p.id===id),card=$('route-card');card.hidden=false;card.replaceChildren();card.append(element('h3',null,'前往 '+p.name),element('p',null,'沿公开步道前往建筑附近导览点，非室内入口测绘。'));
    const stats=element('div','route-stats');stats.innerHTML=`<span><strong>${Math.round(move.distance)}</strong> m</span><span>步行约 <strong>${move.estimatedWalkingMinutes}</strong> 分钟</span>`;card.append(stats,element('p',null,'巡游以演示速度播放，不代表实际行走速度。'));
    const track=element('div','route-progress'),progress=element('span');progress.id='route-progress';track.append(progress);card.append(track);
    const close=element('button',null,'收起路线面板');close.addEventListener('click',()=>card.hidden=true);card.append(close);
    const actions=element('div','route-actions'),follow=element('button',null,'跟随人物'),stop=element('button',null,'停在这里');follow.onclick=()=>locateVisitor();stop.onclick=async()=>{try{if(movingRequest)return;movingRequest=true;state.tour=false;const saved=await api('/api/move/stop',{requestId:crypto.randomUUID()});motionRevision=saved.revision||0;state.move=null;avatar.position.fromArray(saved.path[0].point);card.hidden=true;clearRoute();toast('已停下，可从这里继续手动漫游。');}catch(e){toast(e.message);}finally{movingRequest=false;}};actions.append(follow,stop);card.append(actions);
    locateVisitor();
    window.__UW_MVP__&&(window.__UW_MVP__.route={distance:move.distance,toId:id,geometryHash:move.geometryHash});
  }catch(e){toast(e.message);state.tour=false;}finally{movingRequest=false;}
}
function clearRoute(){for(const child of [...routeGroup.children]){routeGroup.remove(child);child.geometry?.dispose();child.material?.dispose();}}
function locateVisitor(immediate=false){
  if(!avatar||!visitorModel)return;avatar.visible=true;document.body.classList.remove('art-focus');$('art-focus').setAttribute('aria-pressed','false');$('art-focus').textContent='专注景观';routeGroup.visible=selectionRing.visible=true;
  state.plan=false;$('top-view').classList.remove('active');
  avatar.position.y=walking.height(avatar.position.x,avatar.position.z);const target=avatar.position.clone().add(new THREE.Vector3(0,.92,0));
  if(!followVisitor||immediate){tween={start:performance.now(),from:camera.position.clone(),to:target.clone().add(new THREE.Vector3(5.8,2.25,7.8)),oldTarget:controls.target.clone(),target:target.clone(),duration:700};if(immediate){camera.position.copy(tween.to);controls.target.copy(target);tween=null;controls.update();}}
  followVisitor=true;controls.maxDistance=45;controls.enablePan=false;
  camera.fov=45;camera.updateProjectionMatrix();
}
async function nextTourStop(){
  if(!state.tour)return;if(state.tourIndex>=tourStops.length){state.tour=false;toast('一圈校园故事，暂时告一段落。你也可以继续自由探索。');return;}
  await walkTo(tourStops[state.tourIndex++]);
}
function sources(){
  const c=state.campus;$('source-summary').replaceChildren(...[c.buildings.length+' 栋轮廓','9 处地标','1m 原始DEM / 6m显示','建筑高度推定'].map(x=>element('span',null,x)));
  $('source-list').replaceChildren();[...c.sources,...ART_REFERENCES].forEach(s=>{const row=element('section','source-row');row.append(element('h3',null,s.title),element('p',null,s.usedFor+' · '+s.credit),officialLink(s));$('source-list').append(row);});
  $('assumptions').replaceChildren(element('strong',null,'请明确区分资料与表达'));const ul=element('ul');c.assumptions.forEach(s=>ul.append(element('li',null,s)));$('assumptions').append(ul);
  $('sources-dialog').showModal();
}
function bubble(role,message,sources=[]){
  const node=element('div','bubble '+role,message);
  if(sources.length){const citations=element('div','citations');sources.forEach(s=>{
    const fact=state.knowledge?.find(k=>k.id===s.id||'kb:'+k.id===s.id),p=fact&&state.campus.landmarks.find(p=>'uw-'+p.id===fact.id),source=p&&state.campus.sources.find(s=>s.id===p.sourceIds[0]);
    if(source){const a=officialLink(source);a.textContent=source.title;citations.append(a);}else citations.append(element('span',null,s.title||s.id));
  });node.append(citations);}
  $('chat-messages').append(node);$('chat-messages').scrollTop=$('chat-messages').scrollHeight;return node;
}
function openChat(){$('chat-panel').hidden=false;document.body.classList.add('reception-open');$('chat-input').focus();}
async function ensureSession(){if(!state.context){const row=await api('/api/sessions',{requestId:crypto.randomUUID()});state.context=row.contextId;}return state.context;}
async function sendQuestion(message){
  if(state.busy||!message.trim())return;state.busy=true;$('send-chat').disabled=true;$('chat-input').value='';bubble('user',message);const waiting=bubble('agent',state.generalConversation?'Hermes 正在思考…':'正在查阅已发布资料…');
  try{await ensureSession();const response=await api('/api/reception',{message,messageId:crypto.randomUUID(),contextId:state.context});if(response.error)throw Error(response.error.message);const task=response.result?.task||response.result||response.task;if(!task?.artifacts?.[0])throw Error(task?.status?.message?.parts?.[0]?.text||'未取得回答，请重试。');const answer=JSON.parse(task.artifacts[0].parts[0].text);waiting.remove();bubble('agent',answer.text,answer.sources||[]);}
  catch(e){waiting.remove();bubble('error',e.message);}finally{state.busy=false;$('send-chat').disabled=false;}
}
async function restoreChat(){
  const list=await api('/api/sessions');const latest=list.sessions[0];
  if(latest){state.context=latest.contextId;const snapshot=await api('/api/sessions/'+state.context+'/export');for(const turn of snapshot.turns){if(turn.question)bubble('user',turn.question);if(turn.answer)bubble('agent',turn.answer,turn.sources||[]);}}
  else bubble('agent','你好，欢迎来到UW校园空间。我可以介绍这些地标、查阅历史资料，或帮你了解中央校园。想从哪里开始？');
}

async function main(){
  try{
    state.campus=await api('/api/campus');state.knowledge=state.campus.landmarks.map(p=>({id:'uw-'+p.id}));
    setupScene(state.campus);renderList();selectPlace(state.selected,false);
    const me=await api('/api/me');state.generalConversation=me.generalConversation;clockOffset=me.serverTime+(responseTimings.get(me)||0)*.5-Date.now();motionRevision=me.move?.revision||0;avatar.position.fromArray(me.position);$('provider-label').textContent=me.generalConversation?'Hermes · 已发布资料与通用交流':'已发布资料 · 非通用模型';
    const nearestPlace=[...state.campus.landmarks].sort((a,b)=>Math.hypot(a.point[0]-me.position[0],a.point[2]-me.position[2])-Math.hypot(b.point[0]-me.position[0],b.point[2]-me.position[2]))[0];selectPlace(nearestPlace.id,false);
    if(me.move&&!me.move.stopped&&me.move.path?.length>1){const length=me.move.path.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.point.map((v,j)=>v-me.move.path[i].point[j])),0);if((Date.now()+clockOffset-me.move.startedAt)/1000*me.move.previewSpeed<length){state.move=me.move;drawRoute(me.move);}}
    await restoreChat();$('map-subtitle').textContent=state.campus.buildings.length+' 栋真实轮廓 · 9 处精选地标 · 真实地形';
    $('terrain-caption').textContent='USGS · 1m源 / 6m显示';
    await visitorEditor.init();
    presentation=createWalkPresentation(walking,avatar.position.toArray());
    walkController=installVisitorWalking({canvas,api,revision:()=>motionRevision,direction:([x,y])=>{const f=controls.target.clone().sub(camera.position);f.y=0;f.normalize();const v=new THREE.Vector2(f.x*y-f.z*x,f.z*y+f.x*x).normalize();return [v.x,v.y];},enterView:()=>locateVisitor(),canInput:()=>!movingRequest&&!document.hidden&&!document.querySelector('dialog[open]')&&!document.activeElement?.closest('input,textarea,select,[contenteditable=true]'),status:text=>{if($('walk-status').textContent!==text)$('walk-status').textContent=text;},onInput:vector=>{if(vector&&!freePresentation){presentation.reset(avatar.position.toArray(),performance.now());freePresentation=true;state.move=null;state.tour=false;$('route-card').hidden=true;clearRoute();}},onMove:move=>{motionRevision=move.revision||0;state.move=move;presentation.acknowledge(motionPoint(move,Date.now()+clockOffset),performance.now());},onSync:me=>{motionRevision=me.move?.revision||0;clockOffset=me.serverTime+(responseTimings.get(me)||0)*.5-Date.now();avatar.position.fromArray(me.position);presentation.reset(me.position,performance.now());freePresentation=false;state.move=me.move&&!me.move.stopped?me.move:null;}});
    $('walk-controls').hidden=false;locateVisitor(true);document.querySelector('#visitor-editor').addEventListener('close',()=>locateVisitor());
    $('loading').hidden=true;document.documentElement.dataset.ready='true';
    if(new URLSearchParams(location.search).get('edit')==='avatar')await visitorEditor.open();
  }catch(e){$('loading').replaceChildren(element('strong',null,'校园暂时没有展开'),element('span',null,e.message));console.error(e);}
}
$('search').addEventListener('input',e=>{state.search=e.target.value;renderList();});
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderList();}));
$('reset-view').addEventListener('click',()=>resetView());
$('top-view').addEventListener('click',()=>{followVisitor=false;controls.maxDistance=2100;controls.enablePan=true;state.plan=!state.plan;$('top-view').classList.toggle('active',state.plan);if(state.plan){const target=controls.target.clone();tween={start:performance.now(),from:camera.position.clone(),to:new THREE.Vector3(target.x,target.y+950,target.z+.5),oldTarget:target,target,duration:850};}else resetView();});
for(const [id,factor] of [['zoom-in',.8],['zoom-out',1.25]])$(id).addEventListener('click',()=>{const offset=camera.position.clone().sub(controls.target).multiplyScalar(factor);camera.position.copy(controls.target).add(offset);});
$('explore-button').addEventListener('click',()=>{state.tour=false;$('route-card').hidden=true;resetView();});
$('tour-button').addEventListener('click',()=>{state.tour=!state.tour;if(state.tour){state.tourIndex=0;toast('开始一条中央校园故事线；可随时自由探索。');nextTourStop();}else toast('已暂停连续导览');});
$('chat-button').addEventListener('click',openChat);$('chat-nav').addEventListener('click',openChat);$('close-chat').addEventListener('click',()=>{$('chat-panel').hidden=true;document.body.classList.remove('reception-open');});
$('sources-button').addEventListener('click',sources);$('close-sources').addEventListener('click',()=>$('sources-dialog').close());
$('chat-form').addEventListener('submit',e=>{e.preventDefault();sendQuestion($('chat-input').value.trim());});
$('chat-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendQuestion(e.target.value.trim());}});
document.querySelectorAll('[data-question]').forEach(b=>b.addEventListener('click',()=>sendQuestion(b.dataset.question)));
$('export-chat').addEventListener('click',async()=>{try{if(!state.context)return toast('当前还没有可导出的会话。');const data=await api('/api/sessions/'+state.context+'/export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download='uw-reception-session.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){toast(e.message);}});
$('delete-chat').addEventListener('click',async()=>{try{if(state.busy)return toast('请等待当前回答结束。');if(!state.context)return toast('当前没有可删除的会话。');const snapshot=await api('/api/sessions/'+state.context+'/export');await api('/api/sessions/'+state.context+'/delete',{requestId:crypto.randomUUID(),expectedRevision:snapshot.session.revision});state.context=null;$('chat-messages').replaceChildren();bubble('agent','本次会话已删除。再次提问会建立新的独立会话。');toast('会话已删除');}catch(e){toast(e.message);}});
main();
$('visitor-edit').onclick=async()=>{await walkController?.pause();await visitorEditor.open().catch(e=>toast(e.message));};
$('visitor-locate').onclick=()=>locateVisitor();$('walk-follow').onclick=()=>{locateVisitor();canvas.focus({preventScroll:true});};$('walk-stop').onclick=async()=>{try{await walkController?.pause();if(state.move&&!state.move.stopped){const saved=await api('/api/move/stop',{requestId:crypto.randomUUID(),expectedRevision:motionRevision});motionRevision=saved.revision;state.move=null;avatar.position.fromArray(saved.path[0].point);state.tour=false;clearRoute();$('route-card').hidden=true;$('walk-status').textContent='已停下 · WASD / 方向键移动';}}catch(error){toast(error.message);}};

$('new-chat').addEventListener('click',async()=>{if(state.busy)return toast('请等待当前回答结束。');try{const row=await api('/api/sessions',{requestId:crypto.randomUUID()});state.context=row.contextId;$('chat-messages').replaceChildren();bubble('agent','已开启新的独立会话，已有会话仍按保留政策保存。想先了解哪一处UW地标？');}catch(e){toast(e.message);}});

document.querySelectorAll('[data-art-view]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.artView;if(id==='vista')artView(id);else selectPlace(id);}));
$('art-focus').addEventListener('click',()=>{const enabled=document.body.classList.toggle('art-focus');$('art-focus').setAttribute('aria-pressed',String(enabled));$('art-focus').textContent=enabled?'恢复界面':'专注景观';routeGroup.visible=selectionRing.visible=!enabled;avatar.visible=true;});
