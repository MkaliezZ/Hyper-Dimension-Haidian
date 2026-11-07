import {createPixelScene,portraitTile,PORTRAITS} from './pixel-scene.js';
import {project,screenDirection} from './oblique-layout.js';
import {installCampusServices} from './campus-services.js';
import {installVisitorEditor} from './pixel-editor.js';
import {createCampusWalking} from './campus-walking.js';
import {installVisitorWalking} from './visitor-walk.js';
import {createWalkPresentation,motionPoint} from './walk-motion.js';
import {installBuildingInspection} from './building-inspection.js';
import {RED_TOWERS,RED_OBELISK} from './red-square-layout.js';
import {facingFromScreen} from './avatar-facing.js';
import {campusPlaces} from './campus-places.js';
import {placePhoto} from './place-photo.js';
import {installCampusNpcs} from './campus-npcs.js';
const findPlace=id=>state.places?.find(p=>p.id===id);
const $=(id)=>document.getElementById(id),canvas=$('campus-canvas'),map=canvas.parentElement;
const state={campus:null,selected:'main-gate',filter:'all',search:'',route:null,move:null,tour:false,tourIndex:0,context:null,busy:false,plan:false};
const campusServices=installCampusServices({selectedPlace:()=>state.selected,placeName:id=>{const p=findPlace(id);return p?[p.name,p.nameZh].filter(Boolean).join(' · '):null;},onReception:()=>openChat(),onNpcIndex:()=>campusNpcs.open()});
const buildingInspection=installBuildingInspection({map,walkTo,openServices:(placeId,base)=>campusServices.open({placeId,base}),showDetails(id){selectPlace(id,false);$('place-card').dataset.collapsed='false';$('place-detail-toggle').textContent='收起';$('place-detail-toggle').setAttribute('aria-expanded','true');document.body.classList.remove('art-focus');document.body.classList.add('places-open');$('places-toggle').setAttribute('aria-expanded','true');$('place-card').scrollIntoView({block:'nearest'});}});
const tourStops=['primary-teaching','art-building','laboratory','ecological-garden','main-gate','library','river-bridge','international-teaching'];
const icons={history:'♜',landscape:'❋',learning:'▥',student:'◇',sport:'◉'};
const redFeatures={};
const responseTimings=new WeakMap();
const api=async(path,body)=>{
  const sentAt=performance.now();
  const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const value=await response.json();responseTimings.set(value,performance.now()-sentAt);if(!response.ok||value.error)throw Object.assign(Error(value.error?.message||'请求未完成'),{code:value.error?.code,status:response.status});return value;
};
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4500);}
function element(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function officialLink(source){const a=element('a',null,'查看原始资料 ↗');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';return a;}


let scene,walking,presentation,walkController,clockOffset=0,motionRevision=0,movingRequest=false,follow=true,free=false,position=[-120,32,25],direction='south',previousTime=performance.now(),uiAt=0,debugAt=0;
const campusNpcs=installCampusNpcs({map,onState:s=>scene?.setNpcState(s),onFocus:point=>{follow=false;scene?.focus(point,1.5);},onWalk:walkTo,onService:options=>campusServices.open(options),onReception:openChat});
const visitorEditor=installVisitorEditor({api,toast,onApply(profile,catalog,metadata={}){
  scene.setProfile(profile,catalog.skins);scene.draw(performance.now(),position,{follow:true,delta:.05});$('visitor-marker').textContent=profile.displayName;
  canvas.dataset.avatarHash=metadata.storedProfile?.modelHash||profile.modelHash||'unsaved';canvas.dataset.displayAvatarHash=profile.modelHash||'unsaved';canvas.dataset.displayAvatarGenerator=profile.recipe.generatorVersion;
  $('visitor-edit').textContent=profile.revision?'我的形象':'建立形象';
}});
function locateVisitor(immediate=false){if(!scene)return;follow=true;scene.follow(position,immediate);document.body.classList.remove('art-focus');$('art-focus').setAttribute('aria-pressed','false');$('art-focus').textContent='专注校园';}
function resetView(){follow=false;scene.overview();}
function clearRoute(){state.route=null;scene.setRoute(null);}
async function stopWalking(){
  try{state.tour=false;await walkController?.pause();if(state.move&&!state.move.stopped){const saved=await api('/api/move/stop',{requestId:crypto.randomUUID(),expectedRevision:motionRevision});motionRevision=saved.revision;position=[...saved.path[0].point];presentation.reset(position,performance.now());}state.move=null;free=false;clearRoute();$('route-card').hidden=true;$('walk-status').textContent='已停下 · WASD / 方向键移动';}
  catch(e){toast(e.message);}
}
async function walkTo(id){
  if(movingRequest)return;movingRequest=true;
  buildingInspection.hide();
  try{await walkController.pause();free=false;const move=await api('/api/move',{toId:id,requestId:crypto.randomUUID()});motionRevision=move.revision||0;state.move=state.route=move;scene.setRoute(move);selectPlace(id,false);
    const p=findPlace(id),card=$('route-card');card.hidden=false;card.replaceChildren();card.append(element('h3',null,'前往 '+p.name),element('p',null,'沿校园步道前往这里。抵达后，可以继续自由行走。'));
    const stats=element('div','route-stats');stats.append(element('span',null,Math.round(move.distance)+' m'),element('span',null,'步行约 '+move.estimatedWalkingMinutes+' 分钟'));card.append(stats,element('p',null,'巡游以演示速度播放。可随时停止，接着自由行走。'));
    const track=element('div','route-progress'),bar=element('span');bar.id='route-progress';track.append(bar);card.append(track);const actions=element('div','route-actions'),go=element('button',null,'跟随人物'),stop=element('button',null,'停在这里'),close=element('button',null,'收起');go.onclick=()=>locateVisitor();stop.onclick=stopWalking;close.onclick=()=>card.hidden=true;actions.append(go,stop,close);card.append(actions);locateVisitor();
  }catch(e){toast(e.message);state.tour=false;}finally{movingRequest=false;}
}
async function nextTourStop(){if(!state.tour)return;if(state.tourIndex>=tourStops.length){state.tour=false;toast('校园故事线已结束，可以继续自由探索。');return;}await walkTo(tourStops[state.tourIndex++]);}
function animate(now){
  requestAnimationFrame(animate);const delta=Math.max(0,Math.min(.05,(now-previousTime)/1000));previousTime=now;
  if(!scene||!presentation||document.hidden||$('visitor-editor')?.open)return;
  const before=[...position],input=walkController?.input();
  if(free)position=presentation.advance(input,delta*1000,now);
  else if(state.move){position=motionPoint(state.move,Date.now()+clockOffset);const progress=Math.max(0,Date.now()+clockOffset-state.move.startedAt)/1000*state.move.previewSpeed/(state.move.distance||1),bar=$('route-progress');if(bar)bar.style.width=Math.min(100,progress*100)+'%';if(progress>=1||state.move.stopped){const to=state.move.toId;state.move=null;if(to){toast('已到达 '+findPlace(to).name+' 附近导览点');if(state.tour)setTimeout(nextTourStop,1400);}}}
  const dx=position[0]-before[0],dz=position[2]-before[2],moving=Math.hypot(dx,dz)>.0001&&(free?Boolean(input):Boolean(state.move));
  const worldFacing=free?input:moving?[dx,dz]:null,facing=worldFacing?project(...worldFacing):null;direction=facingFromScreen(facing,direction);
  const marker=scene.draw(now,position,{direction,moving,follow,delta,hideUI:document.body.classList.contains('art-focus'),npcTime:campusNpcs.serverTime});campusNpcs.draw(marker.npcs,now);
  if(now-uiAt>=16){uiAt=now;const node=$('visitor-marker');if(node.hidden===marker.visible)node.hidden=!marker.visible;if(marker.visible){node.style.left=marker.x+'px';node.style.top=(marker.labelY??marker.y-50)+'px';}node.classList.toggle('behind-surface',marker.hiddenRatio>.6);}
  if(now-debugAt>=100){debugAt=now;canvas.dataset.visitorPosition=JSON.stringify(position);canvas.dataset.viewMode=follow?'visitor':'campus';canvas.dataset.movementMode=free&&input?'free':state.move?.toId&&!state.move.stopped?'guided':'idle';canvas.dataset.avatarDirection=direction;}
  const controls=$('walk-controls'),followButton=$('walk-follow'),followText=follow?'跟随中':'回到人物';if(controls.classList.contains('overview')===follow)controls.classList.toggle('overview',!follow);if(followButton.textContent!==followText)followButton.textContent=followText;
}
function sources(){
  const c=state.campus;$('source-summary').replaceChildren(...[c.buildings.length+' 栋校园建筑',c.landmarks.length+' 处校园地标','斜视立面 · 分块像素','总览复原 · 北向小地图'].map(x=>element('span',null,x)));
  $('source-list').replaceChildren();c.sources.forEach(s=>{const row=element('section','source-row');row.append(element('h3',null,s.title),element('p',null,s.usedFor+' · '+s.credit),officialLink(s));$('source-list').append(row);});
  $('assumptions').replaceChildren(element('strong',null,'资料与美术表达'));const ul=element('ul');['地图布局参考海淀教育2018年公开校园总览，当前设施特色参考学校官网。','全部楼体按同一轮廓比例、材质和光照生成，立面/屋顶分区和高度仍为美术推定，不是建筑测绘或实时施工记录。','雨后水波、树冠、远山和天空属于装饰，校园边界外不可行走。','人物采用八向部件像素动画，图标比例便于识别；服务器按共享布局和碰撞约束。',...c.assumptions].forEach(s=>ul.append(element('li',null,s)));$('assumptions').append(ul);$('sources-dialog').showModal();
}
function gallery(){const grid=$('pixel-gallery-list');if(!grid.childElementCount)for(const id of PORTRAITS){const p=state.campus.landmarks.find(p=>p.id===id),b=element('button','gallery-card');b.append(portraitTile(id),element('strong',null,p.name),element('small',null,p.nameZh));b.onclick=()=>{$('pixel-gallery').close();selectPlace(id);};grid.append(b);}$('pixel-gallery').showModal();}
async function main(){
  try{[state.campus,state.photos]=await Promise.all([api('/api/campus'),api('/assets/place-photos/manifest.json')]);state.places=campusPlaces(state.campus);state.knowledge=state.places.map(p=>({id:'haidian-'+p.id}));walking=createCampusWalking(state.campus);
    scene=createPixelScene({canvas,campus:state.campus,onSelect:selectPlace,onPan:()=>follow=false,onInspect:inspectSurface,onNpcSelect:id=>campusNpcs.open(id)});await scene.ready;
    for(const p of state.campus.landmarks){const button=element('button','map-label',p.name);button.dataset.place=p.id;button.setAttribute('aria-label','查看 '+p.name);button.onclick=()=>selectPlace(p.id);$('labels').append(button);scene.label(p.id,button);}
    for(const [id,p]of Object.entries(redFeatures)){const button=element('button','map-label',p.nameZh);button.dataset.feature=id;button.setAttribute('aria-label','查看 '+p.name);button.onclick=()=>selectRedFeature(id);$('labels').append(button);scene.label(id,button);}
    const me=await api('/api/me');state.generalConversation=me.generalConversation;clockOffset=me.serverTime+(responseTimings.get(me)||0)*.5-Date.now();motionRevision=me.move?.revision||0;position=[...me.position];presentation=createWalkPresentation(walking,position);
    $('provider-label').textContent=me.generalConversation?'Hermes · DeepSeek Flash · 已发布资料与通用交流':'已发布资料 · 非通用模型';
    if(me.loginExpired)toast('学校登录已过期，已恢复访客身份。可从校园服务重新登录。');
    const nearest=[...state.campus.landmarks].sort((a,b)=>Math.hypot(a.point[0]-position[0],a.point[2]-position[2])-Math.hypot(b.point[0]-position[0],b.point[2]-position[2]))[0];selectPlace(nearest.id,false);
    if(me.move&&!me.move.stopped&&me.move.path?.length>1){state.move=state.route=me.move;scene.setRoute(me.move);}
    await restoreChat();$('map-subtitle').textContent=state.campus.buildings.length+' 栋校园建筑 · 南北校园与河岸';$('terrain-caption').textContent='海淀校区 · 北向总览';
    await visitorEditor.init();
    await campusNpcs.start();
    walkController=installVisitorWalking({canvas,api,revision:()=>motionRevision,direction:([x,y])=>screenDirection(x,-y),enterView:()=>locateVisitor(),canInput:()=>!movingRequest&&!document.hidden&&!document.querySelector('dialog[open]')&&!document.activeElement?.closest('input,textarea,select,[contenteditable=true]'),status:text=>{if($('walk-status').textContent!==text)$('walk-status').textContent=text;},onInput:vector=>{if(vector&&!free){presentation.reset(position,performance.now());free=true;state.move=null;state.tour=false;$('route-card').hidden=true;clearRoute();}},onMove:move=>{motionRevision=move.revision||0;state.move=move;presentation.acknowledge(motionPoint(move,Date.now()+clockOffset),performance.now());},onSync:me=>{motionRevision=me.move?.revision||0;clockOffset=me.serverTime+(responseTimings.get(me)||0)*.5-Date.now();position=[...me.position];presentation.reset(position,performance.now());free=false;state.move=me.move&&!me.move.stopped?me.move:null;}});
    $('walk-controls').hidden=false;locateVisitor(true);$('visitor-editor').addEventListener('close',()=>locateVisitor());$('loading').hidden=true;document.documentElement.dataset.ready='true';requestAnimationFrame(animate);
    const entry=new URLSearchParams(location.search),entryScene=entry.get('sceneId')||entry.get('scene'),entryPlace=entry.get('entityId')||entry.get('entity'),entrySpace=entry.get('space');
    if(entryPlace){if((!entrySpace||['haidian','haidian-beijing'].includes(entrySpace))&&(!entryScene||entryScene==='haidian-outdoors')&&state.places.some(p=>p.id===entryPlace))selectPlace(entryPlace,true);else toast('这个链接的学校或地点不属于当前校园，请从地图重新选择。');}
    if(entry.get('edit')==='avatar')await visitorEditor.open();
  }catch(e){$('loading').replaceChildren(element('strong',null,'校园暂时没有展开'),element('span',null,e.message));console.error(e);}
}
function renderList(){
  const rows=state.places.filter(p=>(state.filter==='all'||p.category===state.filter)&&(p.name+' '+p.nameZh+' '+p.subtitle).toLowerCase().includes(state.search.toLowerCase()));
  $('landmark-count').textContent=rows.length+' PLACES';$('landmark-list').replaceChildren();
  if(!rows.length)$('landmark-list').append(element('p','empty','没有找到，试试艺术楼、田径场或校园桥。'));
  rows.forEach(p=>{const button=element('button','place-row'+(p.id===state.selected?' selected':''));button.dataset.place=p.id;button.setAttribute('aria-label','选择 '+p.name);button.append(element('span','place-icon',icons[p.category]||'▥'));const copy=element('div');copy.append(element('strong',null,p.name),element('small',null,p.nameZh+' · '+p.subtitle.split(' · ')[0]));button.append(copy,element('span','row-arrow','↗'));button.addEventListener('click',()=>selectPlace(p.id));$('landmark-list').append(button);});
  $('landmark-list').querySelector('.selected')?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function selectPlace(id,focus=true,surface=null){
  if(surface?.id==='broken-obelisk'||surface?.id?.startsWith('red-square-pylon-'))return selectRedFeature(surface.id);
  const p=findPlace(id);if(!p)return;state.selected=id;
  canvas.dataset.selectedFeature='';
  canvas.dataset.selectedPlace=id;canvas.dataset.selectedBuilding=p.buildingId||'';document.body.classList.remove('places-open');$('places-toggle').setAttribute('aria-expanded','false');
  scene.select(id);
  renderList();const card=$('place-card');card.hidden=false;card.replaceChildren();if(focus)card.dataset.collapsed='false';
  const detailToggle=element('button','card-toggle',card.dataset.collapsed==='true'?'展开':'收起');detailToggle.id='place-detail-toggle';detailToggle.setAttribute('aria-expanded',String(card.dataset.collapsed!=='true'));detailToggle.setAttribute('aria-label','展开或收起地标详情');detailToggle.onclick=()=>{const collapsed=card.dataset.collapsed!=='true';card.dataset.collapsed=String(collapsed);detailToggle.textContent=collapsed?'展开':'收起';detailToggle.setAttribute('aria-expanded',String(!collapsed));};card.append(detailToggle);
  $('map-headline').textContent=p.name;$('map-region-tag').textContent=p.nameZh;
  const kicker=element('div','card-kicker');kicker.append(element('span','card-index',String(state.places.indexOf(p)+1).padStart(2,'0')),element('span',null,p.subtitle));const photo=placePhoto(id,state.photos);if(photo)card.append(photo);card.append(kicker,element('h3',null,p.name),element('div','card-zh',p.nameZh),element('p','card-description',p.description));
  const appearance=state.campus.buildings.find(b=>b.id===p.buildingId)?.architecture?.confidence;
  const metadata=element('div','card-metadata');metadata.append(element('span',null,'公开资料'),element('span',null,p.buildingId?['unverified-exterior','interior-only'].includes(appearance)?'外形待核 · 示意体量':'实景参考 · 像素建筑':'公开布局 · 像素景观'));card.append(metadata);
  const actions=element('div','card-actions'),go=element('button','primary-button');go.id='go-to-place';go.setAttribute('aria-label','步行前往');go.append(element('span',null,'步行前往'),element('span',null,'↗'));go.addEventListener('click',()=>walkTo(id));const ask=element('button','secondary-button','问问接待');ask.addEventListener('click',()=>{openChat();sendQuestion('介绍一下 '+p.name+' '+p.nameZh);});actions.append(go,ask);card.append(actions);
  const source=state.campus.sources.find(s=>s.id===p.sourceIds[0])||state.campus.sources.find(s=>s.id==='school-official'),credit=element('div','card-source');credit.append(element('span',null,'资料：'+('海淀外国语公开校园资料')),officialLink(source));card.append(credit);
  const memory=element('button','secondary-button','地点留言与记忆');memory.id='place-memory';memory.onclick=()=>campusServices.open({placeId:id,base:'base3'});card.append(memory);
  const services=element('button','quiet-button','此处的校园功能 ↗');services.id='place-services';services.onclick=()=>campusServices.open({placeId:id});card.append(services);
  if(focus){follow=false;scene.focus(p.point,['river-bridge','ecological-garden','main-gate'].includes(id)?1.2:1.45);buildingInspection.show({place:p,source,building:state.campus.buildings.find(b=>b.id===p.buildingId)});}
}
function selectRedFeature(id){
  const key=id.startsWith('red-square-pylon-')?'red-square-pylon-2':id,feature=redFeatures[key];if(!feature)return;
  selectPlace('main-gate',false);follow=false;scene.select(id);scene.focus(feature.point,1.25);canvas.dataset.selectedFeature=id;
  $('map-headline').textContent=feature.name;$('map-region-tag').textContent=feature.nameZh;
  const card=$('place-card');card.querySelector('.place-photo')?.remove();const photo=placePhoto(key,state.photos);if(photo)card.prepend(photo);
  buildingInspection.show({place:{...state.campus.landmarks.find(p=>p.id==='main-gate'),name:feature.name,nameZh:feature.nameZh},source:{url:feature.source}});
}
function inspectSurface(surface){
  if(surface.kind!=='building')return toast(surface.kind==='bench'?'校园长椅 · 官方点位':(surface.species||'校园树木')+' · 官方点位');
  const building=state.campus.buildings.find(b=>b.id===surface.id);if(!building)return;
  follow=false;selectPlace(building.id,false);$('place-card').dataset.collapsed='false';$('place-detail-toggle').textContent='收起';$('place-detail-toggle').setAttribute('aria-expanded','true');
  buildingInspection.show({building,place:findPlace(building.id),source:state.campus.sources.find(s=>s.id===(building.labelSource||'campus-plan-2018'))});
}
function bubble(role,message,sources=[]){
  const node=element('div','bubble '+role,message);
  if(sources.length){const citations=element('div','citations');sources.forEach(s=>{
    const fact=state.knowledge?.find(k=>k.id===s.id||'kb:'+k.id===s.id),p=fact&&state.places.find(p=>'haidian-'+p.id===fact.id),source=p&&state.campus.sources.find(s=>s.id===p.sourceIds[0]);
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
  else bubble('agent','你好，欢迎来到海淀外国语海淀校区。我可以介绍校园建筑、艺术与运动空间，也能帮你规划校园参观路线。想从哪里开始？');
}

$('search').addEventListener('input',e=>{state.search=e.target.value;renderList();});
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderList();}));
$('chat-button').addEventListener('click',openChat);$('chat-nav').addEventListener('click',openChat);$('close-chat').addEventListener('click',()=>{$('chat-panel').hidden=true;document.body.classList.remove('reception-open');});
$('sources-button').addEventListener('click',sources);$('close-sources').addEventListener('click',()=>$('sources-dialog').close());
$('chat-form').addEventListener('submit',e=>{e.preventDefault();sendQuestion($('chat-input').value.trim());});
$('chat-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendQuestion(e.target.value.trim());}});
document.querySelectorAll('[data-question]').forEach(b=>b.addEventListener('click',()=>sendQuestion(b.dataset.question)));
$('export-chat').addEventListener('click',async()=>{try{if(!state.context)return toast('当前还没有可导出的会话。');const data=await api('/api/sessions/'+state.context+'/export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download='haidian-reception-session.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){toast(e.message);}});
$('delete-chat').addEventListener('click',async()=>{try{if(state.busy)return toast('请等待当前回答结束。');if(!state.context)return toast('当前没有可删除的会话。');const snapshot=await api('/api/sessions/'+state.context+'/export');await api('/api/sessions/'+state.context+'/delete',{requestId:crypto.randomUUID(),expectedRevision:snapshot.session.revision});state.context=null;$('chat-messages').replaceChildren();bubble('agent','本次会话已删除。再次提问会建立新的独立会话。');toast('会话已删除');}catch(e){toast(e.message);}});

$('reset-view').onclick=resetView;$('top-view').onclick=resetView;
for(const [id,factor] of [['zoom-in',1.25],['zoom-out',.8]])$(id).onclick=()=>scene.zoom(factor);
$('explore-button').onclick=()=>{state.tour=false;$('route-card').hidden=true;resetView();};
$('tour-button').onclick=()=>{state.tour=!state.tour;if(state.tour){state.tourIndex=0;toast('开始中央校园故事线，可随时停止或自由行走。');nextTourStop();}else toast('已暂停连续导览');};
$('visitor-edit').onclick=async()=>{await walkController?.pause();await visitorEditor.open().catch(e=>toast(e.message));};
$('visitor-locate').onclick=()=>locateVisitor(true);$('walk-follow').onclick=()=>{locateVisitor();canvas.focus({preventScroll:true});};$('walk-stop').onclick=stopWalking;
$('new-chat').onclick=async()=>{if(state.busy)return toast('请等待当前回答结束。');try{const row=await api('/api/sessions',{requestId:crypto.randomUUID()});state.context=row.contextId;$('chat-messages').replaceChildren();bubble('agent','已开启新的独立会话，已有会话仍按保留政策保存。想先了解哪一处海淀校区地标？');}catch(e){toast(e.message);}};
document.querySelectorAll('[data-art-view]').forEach(b=>b.onclick=()=>b.dataset.artView==='vista'?(follow=false,scene.focus([-2,0,95],.65)):selectPlace(b.dataset.artView));
$('art-focus').onclick=()=>{const enabled=document.body.classList.toggle('art-focus');$('art-focus').setAttribute('aria-pressed',String(enabled));$('art-focus').textContent=enabled?'恢复界面':'专注校园';};
$('pixel-gallery-button').onclick=gallery;$('close-gallery').onclick=()=>$('pixel-gallery').close();
window.addEventListener('pagehide',event=>{if(!event.persisted){campusNpcs.dispose();scene?.dispose();visitorEditor.dispose();}});
$('places-toggle').onclick=()=>{const open=document.body.classList.toggle('places-open');$('places-toggle').setAttribute('aria-expanded',String(open));};
main();
