import {campusPlaces} from './campus-places.js';
import {createNpcRenderer} from './npc-renderer.js';
import {createFrameTelemetry} from './frame-telemetry.js';
import {createPixelCampusArt,inFootprint} from './pixel-campus-art.js';
import {pixelAvatar,PIXEL_FRAME} from './pixel-avatar-v3.js';
import {rasterCanvas} from './pixel-raster.js';
import {avatarScale,labelAwayFromAvatar} from './avatar-view.js';
import {createViewportCache} from './viewport-cache.js';
import {loadDepthScene} from './depth-scene-atlas.js';
import {maskActor,actorFragmentDepth,surfaceProject} from './surface-depth.js';
import {OBLIQUE,project,unproject,projectedBounds,groundChunks,nextZoom,nearestZoom,ZOOM_LEVELS,minimapWorld} from './oblique-layout.js';

export const PORTRAITS=['denny','suzzallo','raitt','savery','hub','kane','red-square','fountain','quad'];
const BUILDING_PORTRAITS=['denny','suzzallo','raitt','savery','hub','kane','fountain'];
export function portraitTile(id){
  const i=PORTRAITS.indexOf(id),tile=document.createElement('div');tile.className='pixel-portrait';tile.setAttribute('role','img');tile.setAttribute('aria-label',id+' 同场景材质建筑示意');
  if(BUILDING_PORTRAITS.includes(id)){tile.classList.add('oblique-portrait');tile.style.backgroundImage='url("/assets/coherent/portrait-'+id+'-'+(id==='fountain'?'v2':'v1')+'.png")';}
  else tile.style.backgroundPosition=(i%3*50)+'% '+(Math.floor(i/3)*50)+'%';
  return tile;
}
const makeCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').imageSmoothingEnabled=false;return c;};

// One GIS coordinate system, one material language and one per-fragment depth field.
export function createPixelScene({canvas,campus,onSelect,onPan,onInspect,onNpcSelect}){
  const art=createPixelCampusArt(campus),ground=createPixelCampusArt(campus,{drawBuildings:false,drawTrees:false,drawProps:false}),flat=rasterCanvas(ground.raster),map=rasterCanvas(art.raster),ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)throw Error('当前浏览器无法创建二维画布。');
  const telemetry=createFrameTelemetry(stats=>canvas.dataset.frameStats=JSON.stringify({...stats,composition:'css-layer-subpixel-translation'}));
  const STAGE=2,planner=createViewportCache(),worldLayer=makeCanvas(1,1),worldContext=worldLayer.getContext('2d'),skyLayer=makeCanvas(1,1),skyContext=skyLayer.getContext('2d',{alpha:false}),actorLayer=makeCanvas(1,1),actorContext=actorLayer.getContext('2d');
  const places=new Map(campusPlaces(campus).map(p=>[p.id,p])),camera={x:-120,z:25,zoom:1},avatars=new Map(),labels=new Map(),labelObjects=new Map(),chunks=[];
  worldLayer.className='campus-world-layer';skyLayer.className='campus-sky-layer';worldLayer.setAttribute('aria-hidden','true');skyLayer.setAttribute('aria-hidden','true');canvas.before(skyLayer,worldLayer);
  let width=1,height=1,cssWidth=1,cssHeight=1,profile=null,skins=null,drag=null,selected='red-square',route=null,disposed=false,atlas=null,scaleKey='',miniAt=0,labelsAt=0,debugAt=0,skyAt=0,cacheBuilds=0,maskKey='',lastMask=null;
  const scale=()=>OBLIQUE.pixelsPerMetre*camera.zoom*STAGE;
  const worldScreen=(u,v)=>{const c=project(camera.x,camera.z),s=scale();return [(u-c[0])*s+width/2,(v-c[1])*s+height/2];};
  const screen=(x,z)=>worldScreen(...project(x,z));
  const screenToProjection=(x,y)=>{const c=project(camera.x,camera.z),s=scale();return [(x-width/2)/s+c[0],(y-height/2)/s+c[1]];};
  const world=(x,y)=>unproject(...screenToProjection(x,y));
  const npcRenderer=createNpcRenderer({worldScreen,zoom:()=>camera.zoom,sample:(u,v)=>atlas?.sample(u,v)});let npcHits=[];
  const fit=()=>{const b=projectedBounds([[[campus.bounds[0],campus.bounds[1]],[campus.bounds[2],campus.bounds[1]],[campus.bounds[2],campus.bounds[3]],[campus.bounds[0],campus.bounds[3]]]]),limit=Math.min(width/((b[2]-b[0])*4),height/((b[3]-b[1])*4))*.9;return [...ZOOM_LEVELS].reverse().find(z=>z<=limit)??ZOOM_LEVELS[0];};
  function resize(){const rect=canvas.getBoundingClientRect();cssWidth=rect.width;cssHeight=rect.height;width=Math.max(1,Math.round(cssWidth));height=Math.max(1,Math.round(cssHeight));canvas.width=width;canvas.height=height;skyLayer.width=width;skyLayer.height=height;ctx.imageSmoothingEnabled=false;planner.invalidate();}
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas);resize();
  for(const part of groundChunks(flat.width,flat.height)){const [sx,sy,w,h]=part.source,c=makeCanvas(w,h);c.getContext('2d').drawImage(flat,sx,sy,w,h,0,0,w,h);chunks.push({...part,image:c});}
  flat.width=flat.height=0;ground.raster.pixels=new Uint32Array(0);ground.raster.data=new Uint8ClampedArray(0);
  const mini=document.getElementById('campus-minimap'),miniContext=mini?.getContext('2d'),miniToggle=document.getElementById('minimap-toggle'),miniBase=makeCanvas(154,180);
  miniBase.getContext('2d').drawImage(map,0,0,154,180);map.width=map.height=0;art.raster.pixels=new Uint32Array(0);art.raster.data=new Uint8ClampedArray(0);
  const readyPromise=(async()=>{
    const loaded=await loadDepthScene(campus);if(disposed){loaded.dispose();return;}atlas=loaded;
    for(const o of atlas.objects.values()){if(o.placeId&&(o.kind==='building'||o.kind==='fountain'))labelObjects.set(o.placeId,o);if(o.id==='broken-obelisk'||o.id.startsWith('red-square-pylon-'))labelObjects.set(o.id,o);}
    canvas.dataset.assetsReady='true';canvas.dataset.renderMetrics=JSON.stringify({...art.metrics,style:'coherent-metric-pixel',version:'uw-metric-scene-1.0.0',projection:'metric-orthographic-30deg',backingScale:1,webgl:false,offlineMetricSolids:true,threeDimensionalProjection:true,liveThreeEngine:false,compositing:'CSS cached-world translation + per-pixel actor depth mask',staticWorldCache:true,avatarMapScale:.7,avatarFrame:[48,64],sceneTiles:atlas.manifest.tiles.length,materialLanguage:atlas.manifest.materialLanguage,unifiedBuildingCount:atlas.manifest.buildingCount,sourcePhotoBillboardsOnMap:0,landscape:{trees:atlas.manifest.landscape.displayedTrees,benches:atlas.manifest.landscape.displayedBenches,randomlyPlacedTrees:0,positions:atlas.manifest.landscape.positions},groundMapScale:1,buildingFootprintScale:1,depthStepsPerMetre:64,sourceGeometryHash:campus.geometryHash,groundChunks:chunks.length,chunkPixels:256,zoomLevels:ZOOM_LEVELS,maxZoom:2,sampling:'nearest-neighbor assets; one-to-one subpixel translation'});
  })();
  function sky(time){const bands=['#abcbd7','#c5dcd9','#dfe8cc','#a4b587'];for(let i=0;i<4;i++){skyContext.fillStyle=bands[i];skyContext.fillRect(0,Math.floor(height*i/4),width,Math.ceil(height/4));}skyContext.fillStyle='#c1d1ce';skyContext.beginPath();skyContext.moveTo(width*.4,height*.7);skyContext.lineTo(width*.73,38);skyContext.lineTo(width,height*.7);skyContext.fill();skyContext.fillStyle='#f4f1db';skyContext.beginPath();skyContext.moveTo(width*.73,38);skyContext.lineTo(width*.65,76);skyContext.lineTo(width*.70,65);skyContext.lineTo(width*.75,81);skyContext.lineTo(width*.80,74);skyContext.closePath();skyContext.fill();for(let i=0;i<6;i++){const x=Math.round((i*127+time*.0015)%(width+80))-40,y=18+(i*47)%80;skyContext.fillStyle='#eff0df';skyContext.fillRect(x,y+4,40,6);skyContext.fillRect(x+8,y,22,10);}}
  function clearAvatars(){for(const row of avatars.values())row.canvas.width=row.canvas.height=0;avatars.clear();maskKey='';lastMask=null;}
  function updateScale(){const key=String(camera.zoom);if(scaleKey===key)return;scaleKey=key;clearAvatars();planner.invalidate();}
  function viewOrigin(){const [u,v]=project(camera.x,camera.z),s=scale();return {left:u*s-width/2,top:v*s-height/2,centerX:u*s,centerY:v*s};}
  function buildWorld(plan,hideUI){
    worldLayer.width=plan.width;worldLayer.height=plan.height;worldLayer.style.width=plan.width+'px';worldLayer.style.height=plan.height+'px';worldContext.imageSmoothingEnabled=false;worldContext.clearRect(0,0,plan.width,plan.height);
    const s=camera.zoom*STAGE,[u,v]=project(campus.bounds[0],campus.bounds[1]),origin=[u*2*s-plan.left,v*2*s-plan.top];let visible=0;
    for(const chunk of chunks){const [x,y,w,h]=chunk.source,px=origin[0]+(x+y)*OBLIQUE.x*s,py=origin[1]+(y-x)*OBLIQUE.y*s,rx=(w+h)*OBLIQUE.x*s,ry=(w+h)*OBLIQUE.y*s;if(px+rx<0||px>plan.width||py+ry<0||py-ry>plan.height)continue;worldContext.setTransform(OBLIQUE.x*s,-OBLIQUE.y*s,OBLIQUE.x*s,OBLIQUE.y*s,origin[0],origin[1]);worldContext.drawImage(chunk.image,x,y);visible++;}
    worldContext.resetTransform();const point=(x,z)=>{const [u,v]=project(x,z);return [u*scale()-plan.left,v*scale()-plan.top];};
    if(route&&!hideUI){worldContext.strokeStyle='#75558c';worldContext.lineWidth=3;worldContext.setLineDash([8,6]);worldContext.beginPath();route.path.forEach((n,i)=>{const p=point(n.point[0],n.point[2]);i?worldContext.lineTo(...p):worldContext.moveTo(...p);});worldContext.stroke();worldContext.setLineDash([]);}
    const place=places.get(selected),building=place&&campus.buildings.find(b=>b.id===place.buildingId);
    if(place&&!hideUI){worldContext.strokeStyle='#f7e2a2';worldContext.lineWidth=3;if(building)for(const ring of building.rings){worldContext.beginPath();ring.forEach(([x,z],i)=>{const p=point(x,z);i?worldContext.lineTo(...p):worldContext.moveTo(...p);});worldContext.closePath();worldContext.stroke();}else{const [x,y]=point(place.point[0],place.point[2]);worldContext.beginPath();worldContext.ellipse(x,y,24,12,0,0,Math.PI*2);worldContext.stroke();}}
    const sceneTiles=atlas.draw(worldContext,plan,camera.zoom),owner=atlas.manifest.objects.find(o=>o.id===selected||o.kind==='building'&&o.placeId===selected)?.owner;
    atlas.drawSelection(worldContext,plan,camera.zoom,owner);canvas.dataset.highlightedOwner=owner?String(owner):'';
    cacheBuilds++;canvas.dataset.visibleGroundChunks=String(visible);canvas.dataset.visibleSceneTiles=String(sceneTiles);canvas.dataset.worldCacheBuilds=String(cacheBuilds);canvas.dataset.worldCachePixels=String(plan.width*plan.height);
  }
  function prepareWorld(hideUI){updateScale();const origin=viewOrigin(),plan=planner.plan({width,height,centerX:origin.centerX,centerY:origin.centerY,key:camera.zoom+':'+selected+':'+hideUI});if(plan.rebuild)buildWorld(plan,hideUI);worldLayer.style.transform='translate3d('+plan.dx+'px,'+plan.dy+'px,0)';return plan.rebuild?1:0;}
  function drawMini(position){if(!mini||mini.hidden)return;miniContext.imageSmoothingEnabled=false;miniContext.drawImage(miniBase,0,0,mini.width,mini.height);const mapPoint=(x,z)=>[(x-campus.bounds[0])/(campus.bounds[2]-campus.bounds[0])*mini.width,(z-campus.bounds[1])/(campus.bounds[3]-campus.bounds[1])*mini.height];miniContext.strokeStyle='#fff2cd';miniContext.lineWidth=1;miniContext.beginPath();[[0,0],[width,0],[width,height],[0,height]].map(p=>mapPoint(...world(...p))).forEach(([x,y],i)=>i?miniContext.lineTo(x,y):miniContext.moveTo(x,y));miniContext.closePath();miniContext.stroke();for(const p of campus.landmarks){const [x,y]=mapPoint(p.point[0],p.point[2]);miniContext.fillStyle=p.id===selected?'#f7db8e':'#665183';miniContext.fillRect(Math.round(x)-1,Math.round(y)-1,3,3);}const [mx,my]=mapPoint(position[0],position[2]);miniContext.fillStyle='#ffffff';miniContext.fillRect(Math.round(mx)-3,Math.round(my)-3,7,7);miniContext.fillStyle='#54406f';miniContext.fillRect(Math.round(mx)-1,Math.round(my)-1,3,3);}
  function avatar(direction,action,frame){const key=direction+action+frame;if(!avatars.has(key)){const original=rasterCanvas(pixelAvatar(profile.recipe,skins,{direction,action,frame})),size=avatarScale(camera.zoom,STAGE),c=makeCanvas(Math.round(PIXEL_FRAME.width*size),Math.round(PIXEL_FRAME.height*size)),ac=c.getContext('2d');ac.drawImage(original,0,0,c.width,c.height);original.width=original.height=0;avatars.set(key,{canvas:c,width:c.width,height:c.height,data:ac.getImageData(0,0,c.width,c.height).data});}return avatars.get(key);}
  function draw(time,position,{direction='south',moving=false,follow=false,delta=.016,hideUI=false,npcTime=Date.now()}={}){
    const started=performance.now();if(disposed)return {visible:false,x:0,y:0};
    if(follow){const f=1-Math.exp(-Math.min(.05,delta)/.055);camera.x+=(position[0]-camera.x)*f;camera.z+=(position[2]-camera.z)*f;}
    ctx.resetTransform();ctx.globalAlpha=1;ctx.clearRect(0,0,width,height);if(time-skyAt>=100){skyAt=time;sky(time);}const passes=atlas?prepareWorld(hideUI):0;
    const [x,y]=screen(position[0],position[2]),[u,v]=project(position[0],position[2]);let labelY=y-50,hiddenRatio=0,occluders=[],actorBox=null;
    const npcRows=atlas?npcRenderer.prepare(time,npcTime):[],visitorDepth=position[2]-position[0];
    const npcMarkers=npcRenderer.draw(ctx,npcRows.filter(n=>n.depth<=visitorDepth));
    if(atlas&&profile){
      const size=avatarScale(camera.zoom,STAGE),action=moving?'walk':'idle',frame=moving?Math.floor(time/125)%4:0,img=avatar(direction,action,frame),w=img.width,h=img.height,vx=x-w/2,vy=y-h+size;labelY=vy-12;
      actorBox={left:vx/width*cssWidth,right:(vx+w)/width*cssWidth,top:vy/height*cssHeight,bottom:(vy+h)/height*cssHeight};
      const key=position[0].toFixed(3)+':'+position[2].toFixed(3)+':'+direction+action+frame+':'+camera.zoom;
      if(key!==maskKey){maskKey=key;lastMask=maskActor({data:img.data,width:w,height:h,u0:u-w/2/scale(),v0:v-(h-size)/scale(),pixelsPerUnit:scale(),position,sample:atlas.sample});actorLayer.width=w;actorLayer.height=h;actorContext.putImageData(new ImageData(lastMask.data,w,h),0,0);}
      hiddenRatio=lastMask.hiddenRatio;occluders=lastMask.owners.map(owner=>{const o=atlas.objects.get(owner);return o?.placeId||o?.id||String(owner);});
      const atFoot=atlas.sample(u,v);if(!atFoot||atFoot.depth<=actorFragmentDepth(position,v)+.03){ctx.fillStyle='#5d7867';ctx.beginPath();ctx.ellipse(x,y+1,Math.max(3,8*size),Math.max(1,2*size),0,0,Math.PI*2);ctx.fill();}
      ctx.imageSmoothingEnabled=false;ctx.drawImage(actorLayer,vx,vy);
    }
    npcMarkers.push(...npcRenderer.draw(ctx,npcRows.filter(n=>n.depth>visitorDepth)));npcHits=npcMarkers;
    if(atlas){const f=atlas.manifest.objects.find(o=>o.id==='fountain');for(let n=0;n<7;n++){const t=time*.0003+n,a=n*2.4,r=9+Math.sin(t)*6,P=[f.point[0]+Math.cos(a)*r,.14,f.point[1]+Math.sin(a)*r],[fu,fv]=surfaceProject(P),front=atlas.sample(fu,fv);if(front?.owner!==f.owner)continue;const [sx,sy]=worldScreen(fu,fv);ctx.fillStyle='#e0eee1';ctx.fillRect(sx,sy,Math.max(1,camera.zoom*2),1);}}
    if(time-labelsAt>=32){labelsAt=time;for(const [id,label]of labels){const p=places.get(id),o=labelObjects.get(id);if(!p&&!o){label.hidden=true;continue;}const [sx,sy]=o?worldScreen((o.bounds[0]+o.bounds[2])/2,o.bounds[1]):screen(p.point[0],p.point[2]),hidden=hideUI||!p&&camera.zoom<.75||sx<0||sy<0||sx>width||sy>height;if(label.hidden!==hidden)label.hidden=hidden;if(!hidden){const labelWidth=14+[...label.textContent].reduce((n,c)=>n+(c.charCodeAt(0)>127?12:7.3),0),placement=labelAwayFromAvatar(sx/width*cssWidth,(sy-10)/height*cssHeight,labelWidth,28,actorBox,cssHeight);label.style.left=placement.x+'px';label.style.top=placement.y+'px';label.dataset.avoidsAvatar=String(placement.moved);}if(label.classList.contains('selected')!==(id===selected))label.classList.toggle('selected',id===selected);}}
    if(time-miniAt>=100){miniAt=time;drawMini(position);}
    const visible=x>0&&y>0&&x<width&&y<height;
    if(time-debugAt>=100){debugAt=time;canvas.dataset.visitorOnScreen=String(visible);canvas.dataset.camera=JSON.stringify(camera);canvas.dataset.occludedBy=[...new Set(occluders)].join(',');canvas.dataset.occlusionRatio=hiddenRatio.toFixed(3);canvas.dataset.occlusionMode='per-pixel-surface-depth';canvas.dataset.visitorVisibility=hiddenRatio>.6?'hidden-silhouette':'visible';canvas.dataset.pixelScale=String(camera.zoom);}
    telemetry.sample(time,performance.now()-started,moving,passes);return {x:x/width*cssWidth,y:y/height*cssHeight,labelY:labelY/height*cssHeight,visible,hiddenRatio,npcs:npcMarkers.map(n=>({...n,x:n.x/width*cssWidth,y:n.y/height*cssHeight,labelY:n.labelY/height*cssHeight,visible:!hideUI&&n.hiddenRatio<.7&&camera.zoom>=.5&&n.x>0&&n.y>0&&n.x<width&&n.y<height}))};
  }
  const pointerDown=e=>{if(e.button!==0)return;canvas.focus({preventScroll:true});drag={id:e.pointerId,x:e.clientX,y:e.clientY,cx:camera.x,cz:camera.z,moved:false};canvas.setPointerCapture(e.pointerId);};
  const pointerMove=e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5){drag.moved=true;onPan?.();const [wx,wz]=unproject(dx/scale(),dy/scale());camera.x=drag.cx-wx;camera.z=drag.cz-wz;}};
  const pointerUp=e=>{if(!drag||drag.id!==e.pointerId)return;const moved=drag.moved;drag=null;if(moved||!atlas)return;const rect=canvas.getBoundingClientRect(),sx=(e.clientX-rect.left)/cssWidth*width,sy=(e.clientY-rect.top)/cssHeight*height,[u,v]=screenToProjection(sx,sy),surface=atlas.sample(u,v),o=surface&&atlas.objects.get(surface.owner);
    const npc=[...npcHits].reverse().find(n=>n.hiddenRatio<.7&&sx>=n.left&&sx<=n.left+n.width&&sy>=n.top&&sy<=n.top+n.height);if(npc&&onNpcSelect){canvas.dataset.pickedNpc=npc.id;onNpcSelect(npc.id);return;}
    if(o){canvas.dataset.pickedSurface=o.id;canvas.dataset.pickedOwner=String(o.owner);if(o.placeId)onSelect(o.placeId,true,o);else if(['building','bench','tree'].includes(o.kind))onInspect?.(o);return;}
    const [wx,wz]=unproject(u,v);const p=campus.landmarks.find(p=>!p.buildingId&&Math.hypot(p.point[0]-wx,p.point[2]-wz)<12);if(p)onSelect(p.id);
  };
  const cancel=()=>drag=null,wheel=e=>{e.preventDefault();onPan?.();camera.zoom=nextZoom(camera.zoom,e.deltaY<0?1.25:.8);};
  const miniClick=e=>{const r=mini.getBoundingClientRect(),[x,z]=minimapWorld(e.clientX-r.left,e.clientY-r.top,r.width,r.height,campus.bounds);onPan?.();camera.x=x;camera.z=z;},miniCollapse=()=>{mini.hidden=!mini.hidden;miniToggle.setAttribute('aria-expanded',String(!mini.hidden));miniToggle.textContent=mini.hidden?'展开小地图':'北向小地图 · 收起';};
  canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('wheel',wheel,{passive:false});mini?.addEventListener('click',miniClick);miniToggle?.addEventListener('click',miniCollapse);
  canvas.dataset.renderMode='canvas-2d-metric-pixel';canvas.dataset.assetsReady='false';
  return {art,camera,ready:readyPromise,draw,setNpcState(value){npcRenderer.setState(value);},zoom(factor){camera.zoom=nextZoom(camera.zoom,factor);},setProfile(value,palette){profile=value;skins=palette;clearAvatars();},select(id){selected=id;},setRoute(value){route=value;planner.invalidate();},label(id,node){node.hidden=true;labels.set(id,node);},
    focus(point,zoom=1){const p=[...places.values()].find(p=>Math.hypot(p.point[0]-point[0],p.point[2]-point[2])<.01),o=atlas&&[...atlas.objects.values()].find(o=>(o.placeId===p?.id||o.id===p?.buildingId)&&(o.kind==='building'||o.kind==='fountain'));if(o){const b=o.bounds,center=unproject((b[0]+b[2])/2,(b[1]+b[3])/2);camera.x=center[0];camera.z=center[1];const limit=Math.min(zoom,width*.82/((b[2]-b[0])*4),height*.72/((b[3]-b[1])*4));camera.zoom=[...ZOOM_LEVELS].reverse().find(z=>z<=limit)??ZOOM_LEVELS[0];}else{camera.x=point[0];camera.z=point[2];camera.zoom=nearestZoom(zoom);}},
    overview(){camera.x=(campus.bounds[0]+campus.bounds[2])/2;camera.z=(campus.bounds[1]+campus.bounds[3])/2;camera.zoom=fit();},follow(position,immediate=false){if(immediate){camera.x=position[0];camera.z=position[2];}camera.zoom=Math.max(1,camera.zoom);},
    dispose(){disposed=true;npcRenderer.dispose();resizeObserver.disconnect();clearAvatars();canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('wheel',wheel);mini?.removeEventListener('click',miniClick);miniToggle?.removeEventListener('click',miniCollapse);for(const c of chunks)c.image.width=c.image.height=0;atlas?.dispose();worldLayer.width=worldLayer.height=skyLayer.width=skyLayer.height=actorLayer.width=actorLayer.height=0;worldLayer.remove();skyLayer.remove();planner.dispose();miniBase.width=miniBase.height=0;labels.clear();labelObjects.clear();}
  };
}
