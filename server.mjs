import http from 'node:http';
import {readFile,stat,realpath} from 'node:fs/promises';
import {resolve,join,extname,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {baseRoot,projectRoot,protocol,openStore,loadAccess,createGateway,createReception,configuredHermes,openKnowledge} from './src/base.mjs';
import {createCampusNavigation,positionAlong} from './src/navigation.mjs';
import {WALK_SPEED,GUIDE_SPEED} from './public/campus-walking.js';
import {loadCampusServices,createCampusServices} from './src/campus-services.mjs';
import {visitorCatalog,createVisitorAvatars} from './src/visitor-avatar.mjs';
import {createCampusWorld,UW_SCENE} from './src/campus-world.mjs';
import {createVisitorAccess} from './src/visitor-access.mjs';
import {createCampusPrincipal} from './src/campus-identity.mjs';
import {campusCatalog} from './src/campus-catalog.mjs';
import {createCampusNpcs} from './src/campus-npcs.mjs';
import {createNpcModel} from './src/npc-model.mjs';

export async function startUw({port=Number(process.env.PORT||4290),dataDir=resolve(process.env.HAIDIAN_DATA_DIR||resolve(projectRoot,'.local/haidian-runtime')),host='127.0.0.1',publicOrigin=process.env.HAIDIAN_PUBLIC_ORIGIN,provider,npcModel,campusServicesFile=process.env.HAIDIAN_CAMPUS_SERVICES_CONFIG,platform,schoolId}={}) {
  const version=JSON.parse(await readFile(join(projectRoot,'package.json'),'utf8')).version;
  if(publicOrigin){const u=new URL(publicOrigin);if(!['https:','http:'].includes(u.protocol)||u.origin!==publicOrigin)throw Error('HAIDIAN_PUBLIC_ORIGIN must be an exact HTTP(S) origin');}
  const campusData=platform?dirname(platform.services.school(schoolId).package):join(projectRoot,'data');
  const campus=JSON.parse(await readFile(join(campusData,'campus.json'),'utf8'));
  const binding=JSON.parse(await readFile(join(campusData,'reception.json'),'utf8'));
  const {geometryHash,...geometry}=campus;
  if(protocol.digest(geometry)!==geometryHash)throw Error('Campus geometry fingerprint mismatch; run npm run build.');
  const nav=createCampusNavigation(campus);
  if(platform){
    if(!publicOrigin)throw Error('UW native campus requires an explicit public origin');
    const school=platform.services.school(schoolId);
    if(school.spaceId!==campus.id||!platform.extensions.includes('m1'))throw Error('UW native platform must bind the actual UW space and M1 identity.');
  }
  const services=createCampusServices(platform?{
    origin:publicOrigin,schoolId,spaceId:campus.id,
    anchors:Object.fromEntries(nav.places.map(p=>[p.id,{sceneId:UW_SCENE,entityId:p.id}]))
  }:await loadCampusServices(campusServicesFile,campus));
  // This binding carries knowledge/Agent identity only. The outdoor contract is explicitly
  // geo-campus/v1; it is not passed off as the Base indoor scene/v1 package.
  const catalogKnowledge=nav.places.filter(p=>p.category==='building').map(p=>({id:'haidian-'+p.id,title:p.name,
    body:p.name+' 是此校园地图收录的建筑地点。'+(p.nameZh?'公开建筑代码：'+p.nameZh+'。':'')+'可以在地图选择此处，查看地点留言、校园活动和背包互动。',
    keywords:[p.name,p.id,...(p.nameZh?[p.nameZh]:[])],published:true,revision:1,sourceLabel:'海淀教育2018校园总览 / 海淀外国语官网',entityId:p.id}));
  const introductions=binding.knowledge.map(k=>({...k,body:nav.places.find(p=>p.id===k.entityId)?.description||k.body}));
  const pack={spaceId:campus.id,name:campus.name,description:'海淀外国语海淀校区导览与社区空间',scenes:[],knowledge:[...introductions,...catalogKnowledge],agents:binding.agents};
  protocol.identifier(pack.spaceId);
  for(const row of pack.knowledge){protocol.identifier(row.id);protocol.text(row.body,10000);if(row.published!==true)throw Error('Unreviewed reception source');}
  const receptionMode=process.env.HAIDIAN_RECEPTION_MODE||'auto';
  if(!['auto','hermes','knowledge'].includes(receptionMode))throw Error('Invalid HAIDIAN_RECEPTION_MODE');
  if(provider===undefined && receptionMode!=='knowledge'){
    provider=await configuredHermes(dataDir);
    if(!provider&&receptionMode==='hermes')throw Error('Hermes mode requested, but this UW instance has no private reception.json configuration.');
    if(provider&&!process.env.DEEPSEEK_API_KEY)throw Error('Hermes is configured but its private model key is unavailable.');
  }
  const auth=await loadAccess(dataDir,[pack.spaceId]);
  const visitorAccess=createVisitorAccess(auth,{secure:Boolean(publicOrigin?.startsWith('https:'))});
  const store=await (platform?platform.openStore(dataDir):openStore(dataDir));
  const avatars=createVisitorAvatars(store,pack.spaceId);
  const configuredNpcModel=npcModel===undefined?(process.env.HAIDIAN_NPC_PROVIDER==='deepseek'?createNpcModel():null):npcModel;
  const npcs=createCampusNpcs({store,nav,spaceId:pack.spaceId,model:configuredNpcModel});
  pack.agents.push(...npcs.agents);
  let knowledge;
  try{knowledge=await openKnowledge({dataDir,root:baseRoot,forumHistory:Boolean(platform)});platform?.bindKnowledge(knowledge);}
  catch(error){await store.close();throw error;}
  const reception=createReception({provider:provider||null,knowledge,sourceResolver:platform?.publishedSources});
  const safeReception={...reception,async answer(input){
    if(input.pack.npcId)return npcs.answer({id:input.pack.npcId,message:input.message,history:input.history,signal:input.signal});
    if(/开放|营业|开门|关门|票价|门票|预约|电话|无障碍|轮椅|open(?:ing)? hours|accessible|wheelchair|ticket|phone/i.test(input.message))
      return {text:'当前发布资料只覆盖建筑历史、校园位置与概念导览，未核实实时开放、预约、票价或无障碍条件。请通过海淀外国语官网或校方确认。',sources:[],mode:'published-unknown'};
    const current=input.message.toLowerCase();
    const question=/它|这里|这栋|that|\bit\b/i.test(current)
      ? (input.history||[]).filter(t=>t.role==='user').slice(-1).map(t=>t.text).join(' ')+' '+current
      : current;
    const explicit=nav.places.filter(p=>[p.name,p.nameZh,p.id==='international-teaching'?'HUB':p.id].some(name=>name?.length>2&&question.toLowerCase().includes(name.toLowerCase())));
    const focused=explicit.length?{...input.pack,knowledge:input.pack.knowledge.filter(k=>explicit.some(p=>k.id==='haidian-'+p.id))}:input.pack;
    return reception.answer({...input,pack:focused});
  }};
  const capabilities={
    'haidian.campus.route':{scope:'a2a:call',async execute({arguments:args}){
      protocol.fields(args,['fromId','toId'],'UW route');
      const from=nav.landmark(args.fromId),to=nav.landmark(args.toId);
      return {text:`${from.name} → ${to.name} 的户外导览路线`,...nav.route(from.arrivalNode,to.id),sources:[],mode:'uw-outdoor-route'};
    }},
  };
  const primaryPack={...pack,agents:pack.agents.filter(a=>!a.agentId.startsWith('haidian-npc-'))};
  const npcPacks=npcs.agents.map(agent=>({...pack,npcId:agent.agentId.slice('haidian-npc-'.length),agents:[agent]}));
  const gateway=createGateway({store,packs:[...(platform?platform.augmentPacks([primaryPack]):[primaryPack]),...npcPacks],reception:safeReception,navigate:()=>{throw Error('Use the advertised haidian.campus.route outdoor capability.');},capabilities:{...capabilities,...platform?.capabilities},maxModelCallsPerDay:40});
  platform?.bindWorld(createCampusWorld(campus,nav,pack,gateway.receptionSessions));
  try{await gateway.receptionSessions.expire();}
  catch(error){await gateway.close();await knowledge?.close();await store.close();throw error;}
  let origin;const rates=new Map();
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  async function body(req){
    const limit=platform&&/^\/(?:knowledge-admin|annual)\//.test(req.url)?4194304:platform&&/^\/attachments\//.test(req.url)?720896:platform&&!req.url.startsWith('/api/')?65536:16384;
    let n=0,text='';for await(const chunk of req){n+=chunk.length;if(n>limit)throw Object.assign(Error('Request too large'),{status:413});text+=chunk;}try{return JSON.parse(text);}catch{throw Object.assign(Error('Invalid JSON'),{status:400});}
  }
  const campusPrincipal=createCampusPrincipal({platform,visitorAccess,spaceId:pack.spaceId});
  const resolvePrincipal=(req,res,browser=false)=>campusPrincipal(req,res,{browser});
  const position=(principal)=>positionAlong(store.read().positions?.[protocol.digest([principal.id,pack.spaceId])]) || [...nav.nodes[nav.landmark('main-gate').arrivalNode]];
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
    try{
      if(!['127.0.0.1','localhost','[::1]',...(publicOrigin?[new URL(publicOrigin).hostname]:[])].includes(new URL('http://'+req.headers.host).hostname))throw Object.assign(Error('Unexpected host'),{status:403});
      const url=new URL(req.url,origin),method=req.method;
      if(!['GET','HEAD'].includes(method)&&req.headers.origin&&req.headers.origin!==origin)throw Object.assign(Error('Cross-origin mutation denied'),{status:403});
      if(platform&&await platform.handle(req,res,{url,json,body}))return;
      if(platform&&method==='GET'&&url.pathname==='/m0.html'){res.writeHead(303,{Location:'/','Cache-Control':'no-store'});return res.end();}
      if(platform&&method==='GET'&&url.pathname==='/m2.html'){res.writeHead(303,{Location:'/inventory.html','Cache-Control':'no-store'});return res.end();}
      if(method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,project:'hyper-dimension-haidian',version,baseVersion:protocol.BASE_VERSION,geometryHash,provider:reception.provider,generalConversation:reception.general,receptionModel:reception.provider==='hermes'?'deepseek-flash':null,nativeCampus:Boolean(platform),schoolId:platform?schoolId:null,terrainSource:'flat-schematic; no surveyed DEM',buildingHeight:'inferred',official:false,npcCount:npcs.agents.length,npcProvider:configuredNpcModel?.name||'routine',npcModel:configuredNpcModel?.model||null});
      if(method==='GET'&&url.pathname==='/api/catalog'){
        const principal=platform?await platform.identity.principal(req):await resolvePrincipal(req,res,true);
        const visiblePack=platform?platform.augmentPacks([pack])[0]:pack;
        return json(res,200,campusCatalog({principal,pack:visiblePack,platform,reception,knowledge,geometryHash,schoolId}));
      }
      if(method==='GET'&&url.pathname==='/api/campus')return json(res,200,campus);
      if(method==='GET'&&url.pathname==='/api/sources')return json(res,200,{sources:campus.sources,assumptions:campus.assumptions});
      if(method==='GET'&&(url.pathname==='/api/campus-services'||url.pathname.startsWith('/api/campus-services/open/'))){
        const placeId=url.searchParams.get('place');if(placeId)nav.landmark(placeId);
        if(url.pathname==='/api/campus-services')return json(res,200,await services.status(req,origin,placeId));
        const target=await services.target(req,origin,url.pathname.slice('/api/campus-services/open/'.length),placeId);
        res.writeHead(303,{Location:target,'Cache-Control':'no-store'});return res.end();
      }
      const businessAgent=platform?pack.spaceId+'-partner-services':null;
      const npcAgent=npcs.agents.find(a=>url.pathname==='/agents/'+a.agentId+'/.well-known/agent-card.json'||url.pathname==='/agents/'+a.agentId+'/a2a');
      if(npcAgent){
        if(method==='GET'&&url.pathname.endsWith('/.well-known/agent-card.json'))return json(res,200,gateway.card(npcAgent.agentId,origin));
        if(method==='POST'&&url.pathname.endsWith('/a2a'))return json(res,200,await gateway.handle({agentId:npcAgent.agentId,principal:await resolvePrincipal(req,res,false),request:await body(req),version:req.headers['a2a-version']||'1.0',origin}));
      }
      if(businessAgent&&url.pathname.startsWith('/agents/'+businessAgent+'/')){
        const actor=await resolvePrincipal(req,res,false);
        if(method==='GET'&&url.pathname.endsWith('/.well-known/agent-card.json'))return json(res,200,gateway.card(businessAgent,origin));
        if(method==='POST'&&url.pathname.endsWith('/a2a'))return json(res,200,await gateway.handle({agentId:businessAgent,principal:actor,request:await body(req),version:req.headers['a2a-version']||'1.0',origin}));
      }
      const cardPath='/agents/haidian-reception/.well-known/agent-card.json';
      if(method==='GET'&&(url.pathname===cardPath||url.pathname==='/.well-known/agent-card.json'))return json(res,200,gateway.card('haidian-reception',origin));
      if(method==='POST'&&url.pathname==='/agents/haidian-reception/a2a'){
        const actor=await resolvePrincipal(req,res);return json(res,200,await gateway.handle({agentId:'haidian-reception',principal:actor,request:await body(req),version:req.headers['a2a-version']||'1.0',origin}));
      }
      if(url.pathname.startsWith('/api/')){
        const actor=await resolvePrincipal(req,res,true);protocol.authorize(actor,pack.spaceId);
        const principal=actor;
        if(method==='GET'&&url.pathname==='/api/npcs')return json(res,200,await npcs.observe());
        const npcMatch=url.pathname.match(/^\/api\/npcs\/([a-z-]+)\/(sessions|message|sessions\/([^/]+)\/(export|delete))$/);
        if(npcMatch){
          const person=npcs.person(npcMatch[1]),sessions=gateway.receptionSessions;
          if(npcMatch[2]==='sessions'){
            if(method==='GET')return json(res,200,await sessions.list(principal,pack.spaceId,person.agentId));
            if(method==='POST'){const b=protocol.fields(await body(req),['requestId'],'NPC session');return json(res,200,await sessions.create(principal,pack.spaceId,person.agentId,b.requestId));}
          }
          if(npcMatch[3]){
            const context=protocol.identifier(decodeURIComponent(npcMatch[3]));
            if(method==='GET'&&npcMatch[4]==='export')return json(res,200,await sessions.export(principal,pack.spaceId,person.agentId,context));
            if(method==='POST'&&npcMatch[4]==='delete'){const b=protocol.fields(await body(req),['requestId','expectedRevision'],'NPC session delete');return json(res,200,await sessions.remove(principal,pack.spaceId,person.agentId,context,b.expectedRevision,b.requestId));}
          }
          if(method==='POST'&&npcMatch[2]==='message'){
            const b=protocol.fields(await body(req),['message','messageId','contextId'],'NPC message');protocol.text(b.message,1200);protocol.identifier(b.messageId);
            const rate='npc:'+principal.id+':'+Math.floor(Date.now()/60000);rates.set(rate,(rates.get(rate)||0)+1);
            if(rates.get(rate)>12)throw Object.assign(Error('聊得有点快，稍等一会儿再继续。'),{status:429});if(rates.size>1000)rates.clear();
            const request={jsonrpc:'2.0',id:b.messageId,method:'SendMessage',params:{message:{messageId:b.messageId,role:'ROLE_USER',parts:[{text:b.message}],...(b.contextId?{contextId:b.contextId}:{})}}};
            return json(res,200,await gateway.handle({agentId:person.agentId,principal,request,version:'1.0',origin}));
          }
        }
        if(method==='GET'&&url.pathname==='/api/me')return json(res,200,{visitorId:principal.id,identityMode:principal.tenantBound?'member':'visitor',loginExpired:Boolean(principal.loginExpired),position:position(principal),move:store.read().positions?.[protocol.digest([principal.id,pack.spaceId])]||null,serverTime:Date.now(),walking:{speed:WALK_SPEED,maxIntentMs:500,collision:'campus-footprints-and-terrain'},provider:reception.provider,generalConversation:reception.general,receptionModel:reception.provider==='hermes'?'deepseek-flash':null,baseVersion:protocol.BASE_VERSION});
        if(method==='GET'&&url.pathname==='/api/avatar')return json(res,200,{catalog:visitorCatalog,profile:avatars.read(principal),presentation:avatars.presentation(principal),identityMode:principal.tenantBound?'member':'visitor'});
        if(method==='GET'&&url.pathname==='/api/avatar/history')return json(res,200,{profiles:avatars.history(principal)});
        if(method==='POST'&&url.pathname==='/api/avatar')return json(res,200,await avatars.save(principal,await body(req)));
        if(method==='POST'&&url.pathname==='/api/route'){
          const b=protocol.fields(await body(req),['toId','fromId'],'route');
          return json(res,200,nav.route(b.fromId?nav.landmark(b.fromId).arrivalNode:position(principal),b.toId));
        }
        if(method==='POST'&&url.pathname==='/api/walk'){
          const b=protocol.fields(await body(req),['direction','durationMs','expectedRevision','requestId'],'walk');protocol.identifier(b.requestId);
          if(!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0||!Number.isFinite(b.durationMs)||b.durationMs<50||b.durationMs>500||!Array.isArray(b.direction)||b.direction.length!==2||!b.direction.every(Number.isFinite)||Math.hypot(...b.direction)>1.001||Math.hypot(...b.direction)<.001)throw Object.assign(Error('无效的移动方向或时长。'),{status:400,code:'invalid_walk'});
          return json(res,200,await store.command(principal,pack.spaceId,b.requestId,{action:'free-walk',...b},d=>{
            const key=protocol.digest([principal.id,pack.spaceId]),previous=d.positions[key];
            if((previous?.revision||0)!==b.expectedRevision)throw Object.assign(Error('移动状态已更新，请重新同步。'),{status:409,code:'movement_conflict'});
            const from=positionAlong(previous)||position(principal),motion=nav.walking.step(from,b.direction,b.durationMs);
            const move={...motion,startedAt:Date.now(),mode:'free',stopped:motion.distance<.001,geometryHash,revision:(previous?.revision||0)+1};
            d.positions[key]=move;return move;
          }));
        }
        if(method==='POST'&&url.pathname==='/api/move'){
          const b=protocol.fields(await body(req),['toId','requestId'],'move');protocol.identifier(b.requestId);nav.landmark(b.toId);
          return json(res,200,await store.command(principal,pack.spaceId,b.requestId,b,(d)=>{
            const route=nav.route(position(principal),b.toId);
            const previous=d.positions[protocol.digest([principal.id,pack.spaceId])];
            const move={...route,startedAt:Date.now(),previewSpeed:GUIDE_SPEED,toId:b.toId,revision:(previous?.revision||0)+1};
            d.positions[protocol.digest([principal.id,pack.spaceId])]=move;return move;
          }));
        }
        if(method==='POST'&&url.pathname==='/api/move/stop'){
          const b=protocol.fields(await body(req),['requestId','expectedRevision'],'stop');protocol.identifier(b.requestId);
          return json(res,200,await store.command(principal,pack.spaceId,b.requestId,{action:'stop',...b},d=>{
            const previous=d.positions[protocol.digest([principal.id,pack.spaceId])];
            if(b.expectedRevision!==undefined&&b.expectedRevision!==(previous?.revision||0))throw Object.assign(Error('移动状态已更新，请重新同步。'),{status:409,code:'movement_conflict'});
            const point=positionAlong(previous)||position(principal);
            const move={path:[{levelId:'outdoors',point}],startedAt:Date.now(),previewSpeed:0,distance:0,stopped:true,geometryHash,revision:(previous?.revision||0)+1};
            d.positions[protocol.digest([principal.id,pack.spaceId])]=move;return move;
          }));
        }
        const sessions=gateway.receptionSessions;
        if(url.pathname==='/api/sessions'){
          if(method==='GET')return json(res,200,await sessions.list(principal,pack.spaceId,'haidian-reception'));
          if(method==='POST'){const b=protocol.fields(await body(req),['requestId'],'session');return json(res,200,await sessions.create(principal,pack.spaceId,'haidian-reception',b.requestId));}
        }
        const sessionMatch=url.pathname.match(/^\/api\/sessions\/([^/]+)\/(export|delete)$/);
        if(sessionMatch){
          const id=protocol.identifier(decodeURIComponent(sessionMatch[1]));
          if(method==='GET'&&sessionMatch[2]==='export')return json(res,200,await sessions.export(principal,pack.spaceId,'haidian-reception',id));
          if(method==='POST'&&sessionMatch[2]==='delete'){
            const b=protocol.fields(await body(req),['requestId','expectedRevision'],'delete');
            return json(res,200,await sessions.remove(principal,pack.spaceId,'haidian-reception',id,b.expectedRevision,b.requestId));
          }
        }
        if(method==='POST'&&url.pathname==='/api/reception'){
          const b=protocol.fields(await body(req),['message','messageId','contextId'],'reception');protocol.text(b.message,4000);protocol.identifier(b.messageId);
          const key=principal.id+':'+Math.floor(Date.now()/60000);rates.set(key,(rates.get(key)||0)+1);
          if(rates.get(key)>20)throw Object.assign(Error('请稍后再问。'),{status:429});
          if(rates.size>1000)rates.clear();
          const request={jsonrpc:'2.0',id:b.messageId,method:'SendMessage',params:{message:{messageId:b.messageId,role:'ROLE_USER',parts:[{text:b.message}],...(b.contextId?{contextId:b.contextId}:{})}}};
          return json(res,200,await gateway.handle({agentId:'haidian-reception',principal,request,version:'1.0',origin}));
        }
        throw Object.assign(Error('API not found'),{status:404});
      }
      if(!['GET','HEAD'].includes(method))throw Object.assign(Error('Method not allowed'),{status:405});
      const pathname=decodeURIComponent(url.pathname);
      // Historical renderers are packaged only for reproducible old avatar receipts/tests.
      // Neither the map nor the wardrobe serves any 3D artwork in the pixel release.
      const retired=['app-3d.js','art-scene.js','building-roofs.js','paper-fountain.js','paper-surfaces.js','campus-environment.js','visitor-camera.js','visitor-editor.js','visitor-model.js','visitor-model-v1.js','visitor-paper-model.js','visitor-chibi-model.js','visitor.css','ui-refresh.css'];
      if(retired.includes(pathname.slice(1))||pathname.startsWith('/vendor/three/'))throw Object.assign(Error('Retired renderer'),{status:404});
      let directory=join(projectRoot,'public'),relative=pathname==='/'?'index.html':pathname.slice(1);
      if(pathname.startsWith('/vendor/')){directory=join(baseRoot,'public/vendor');relative=pathname.slice('/vendor/'.length);}
      else if(platform&&relative!=='index.html'&&!await stat(join(directory,relative)).then(s=>s.isFile(),()=>false))directory=join(baseRoot,'public');
      if(relative.split('/').some(x=>!x||x.startsWith('.')||x.includes('\\'))||relative.includes('\0'))throw Object.assign(Error('Invalid asset path'),{status:403});
      const file=await realpath(resolve(directory,relative)).catch(()=>{throw Object.assign(Error('Not found'),{status:404});});
      if(!file.startsWith((await realpath(directory))+sep))throw Object.assign(Error('Path denied'),{status:403});
      const info=await stat(file);if(!info.isFile())throw Object.assign(Error('Not found'),{status:404});
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'};
      if(platform&&relative==='index.html'){
        const html=(await readFile(file,'utf8')).replace('</head>','<script type="module" src="/native-navigation.js"></script></head>');
        res.writeHead(200,{'Content-Type':mime['.html'],'Content-Length':Buffer.byteLength(html),'Cache-Control':'no-cache'});return res.end(method==='HEAD'?undefined:html);
      }
      if(platform&&relative==='admin.html'){
        const nonce=randomUUID().replaceAll('-',''),html=(await readFile(file,'utf8')).replace('HD_ADMIN_NONCE',nonce).replace('</head>','<link rel="stylesheet" href="/campus-native.css"><script type="module" src="/native-navigation.js"></script></head>').replace('<body>','<body class="pixel-native">');
        res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'`);
        res.writeHead(200,{'Content-Type':mime['.html'],'Cache-Control':'no-store'});return res.end(method==='HEAD'?undefined:html);
      }
      if(relative.endsWith('.html')&&relative!=='index.html'){
        const html=(await readFile(file,'utf8')).replace('</head>','<link rel="stylesheet" href="/campus-native.css"><script type="module" src="/native-navigation.js"></script></head>').replaceAll('href="/m2.html"','href="/?edit=avatar"').replace(/<body([^>]*)>/i,(_,attributes)=>'<body'+(attributes.includes('class=')?attributes.replace(/class=(["'])(.*?)\1/i,(_a,q,value)=>'class='+q+value+' pixel-native'+q):attributes+' class="pixel-native"')+'>');
        res.writeHead(200,{'Content-Type':mime['.html'],'Content-Length':Buffer.byteLength(html),'Cache-Control':'no-cache'});return res.end(method==='HEAD'?undefined:html);
      }
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache'});
      res.end(method==='HEAD'?undefined:await readFile(file));
    }catch(error){if(res.headersSent)return res.destroy();json(res,error.status||500,{error:{code:error.code||'request_failed',message:error.status?error.message:'请求未完成，请重试。'}});}
  });
  try{await npcs.initialize();await new Promise((ok,bad)=>{server.once('error',bad);server.listen(port,host,ok);});}
  catch(error){await npcs.close();await gateway.close();await knowledge?.close();await store.close();throw error;}
  origin=publicOrigin||`http://127.0.0.1:${server.address().port}`;
  const expiration=setInterval(()=>gateway.receptionSessions.expire().catch(()=>{}),60000);expiration.unref();
  npcs.start();
  const close=async()=>{clearInterval(expiration);await npcs.close();platform?.stopStreams();await gateway.close();await new Promise(ok=>server.close(ok));await knowledge?.close();await store.close();};
  return {server,origin,close,campus,nav,auth,gateway,store,npcs};
}

export {startUw as startHaidian};
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await startUw();
  console.log(`Haidian Campus ready: ${app.origin} · Base ${protocol.BASE_VERSION}`);
  let closing=false;const shutdown=async()=>{if(closing)return;closing=true;await app.close();process.exit(0);};
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
  process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{if(chunk.trim()==='shutdown')shutdown();});
}
