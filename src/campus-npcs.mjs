import {NPC_CAST,scheduleFor} from './npc-cast.mjs';
import {visitorCatalog} from './visitor-avatar.mjs';
import {PLACE_COPY} from '../public/place-copy.js';
const DEMO_RATE=20,DAY_START=510,DAY_END=1080;
const clamp=x=>Math.max(0,Math.min(100,x));
const problem=(code,message,status=400)=>Object.assign(Error(message),{code,status});
const formatTime=m=>String(Math.floor(m/60)%24).padStart(2,'0')+':'+String(Math.floor(m)%60).padStart(2,'0');

export function createCampusNpcs({store,nav,spaceId,model=null,now=Date.now,maxModelCalls=80}){
  const maxPlanCalls=Math.min(24,Math.max(1,Math.floor(maxModelCalls*.3)));
  const definitions=new Map(NPC_CAST.map(p=>[p.id,p]));
  const person=id=>{const p=definitions.get(id);if(!p)throw problem('npc_missing','这位同学暂时不在校园里。',404);return p;};
  let timer,watchUntil=0,pending=null,thinking=false,closed=false,activeThought=null,lastTick=-Infinity;const controllers=new Set();
  const log=(n,at,label,kind='routine')=>{n.log.unshift({at,label,kind});n.log=n.log.slice(0,24);};
  function station(p){
    const base=nav.nodes[nav.landmark(p.home).arrivalNode],index=NPC_CAST.findIndex(n=>n.id===p.id);
    for(let i=0;i<8;i++){const angle=index*2.4+i*Math.PI/4,x=base[0]+Math.cos(angle)*2.5,z=base[2]+Math.sin(angle)*2.5,target=[x,nav.walking.height(x,z),z];if(nav.walking.allowed(x,z)&&nav.walking.segmentClear(base,target))return target;}
    return [...base];
  }
  const clock=(w,time)=>Math.min(DAY_END,w.minute+Math.max(0,time-w.updatedAt)/1000*DEMO_RATE/60);
  function options(p,n,w){
    const slots=scheduleFor(p,w.minute),fixed=slots.find(s=>w.minute>=s.start-7&&w.minute<s.end);
    if(fixed)return [{...fixed,id:'scheduled-'+slots.indexOf(fixed),priority:100}];
    if(n.needs.energy<22)return [{id:'need-rest',action:'coffee',label:'歇一会儿，聊点轻松的',priority:90}];
    return p.options.map(([action,_place,label],i)=>({id:'choice-'+i,action,label,priority:(p.likes.includes(action)?10:0)+(action==='meet'?(100-n.needs.social)*.2:action==='study'?n.needs.energy*.1:0)-(action===n.action?12:0)})).sort((a,b)=>b.priority-a.priority);
  }
  function apply(n,choice,w,time,intention=choice.label){
    n.action=choice.action;n.intention=intention;n.activityLabel=choice.label;n.untilMinute=choice.end||Math.min(DAY_END,w.minute+18);n.nextActionAt=time+20000;n.decisionIndex++;log(n,time,n.intention);
  }
  async function initialize(){
    await store.transact(d=>{
      const at=now();let w=d.uwCampusNpcs;
      if(w&&(w.schema!==1||w.spaceId!==spaceId))throw Error('Unknown NPC state; existing state preserved');
      if(!w)w=d.uwCampusNpcs={schema:1,spaceId,minute:640,day:1,updatedAt:at,people:{},modelUsage:{date:'',count:0,plans:0,chats:0,lastAt:0}};
      const changed=w.mobility!=='stationary';w.mobility='stationary';w.updatedAt=at;
      for(const [i,p]of NPC_CAST.entries()){
        let n=w.people[p.id];if(!n)n=w.people[p.id]={id:p.id,needs:{hunger:28+i*4,energy:88-i*3,social:58+i*3},log:[],decisionsByModel:0,planStatus:'waiting',nextPlanAt:at+i*7000,decisionIndex:0,pauseUntil:0,untilMinute:w.minute,nextActionAt:at};
        Object.assign(n,{position:station(p),placeId:p.home,move:null,phase:'activity'});
        if(changed){n.stationSince=at;n.untilMinute=w.minute;n.pauseUntil=0;apply(n,options(p,n,w)[0],w,at);n.intention=p.goal;log(n,at,'在 '+nav.landmark(p.home).name+' 等你聊聊。','station');}
      }
    });
  }
  async function budget(kind){return store.transact(d=>{const u=d.uwCampusNpcs.modelUsage,day=new Date(now()).toISOString().slice(0,10);if(u.date!==day)Object.assign(u,{date:day,count:0,plans:0,chats:0});if(kind==='plans'&&u.plans>=maxPlanCalls)throw problem('npc_plan_limit','自动演示额度已用完，保留额度供访客对话。',429);if(u.count>=maxModelCalls)throw problem('npc_daily_limit','今日对话额度已用完，仍可使用定位和校园功能。',429);u.count++;u[kind]++;u.lastAt=now();});}
  async function think(id){
    if(!model||closed||thinking)return;thinking=true;const c=new AbortController();controllers.add(c);
    try{
      const w=store.read().uwCampusNpcs,n=w.people[id],p=person(id),choices=options(p,n,w);await budget('plans');
      const r=await model.plan({name:p.name,personality:p.personality,goal:p.goal,mobility:'stationary',station:nav.landmark(p.home).name,clock:formatTime(w.minute),needs:n.needs,options:choices.map(o=>({optionId:o.id,action:o.action,place:nav.landmark(p.home).name,intention:o.label})),recentPublicEvents:n.log.filter(e=>e.at>=n.stationSince).slice(0,3)},c.signal);
      const choice=choices.find(o=>o.id===r?.optionId);if(!choice||typeof r.intention!=='string'||r.intention.length>120||typeof r.say!=='string'||r.say.length>160)throw problem('npc_plan_invalid','Invalid NPC plan');if(closed)return;
      await store.transact(d=>{const w=d.uwCampusNpcs,n=w.people[id];if(!options(p,n,w).some(o=>o.id===choice.id))return;apply(n,choice,w,now(),r.intention.trim()||choice.label);n.say=r.say.trim();n.sayAt=now();n.planStatus='deepseek';n.decisionsByModel++;log(n,now(),n.intention,'decision');});
    }catch(error){if(!closed)await store.transact(d=>{const n=d.uwCampusNpcs.people[id];n.planStatus=error.code==='npc_daily_limit'?'daily-limit':'routine';n.nextPlanAt=now()+180000;}).catch(()=>{});}
    finally{controllers.delete(c);thinking=false;}
  }
  async function tick(){
    if(closed||now()>watchUntil)return;if(pending)return pending;if(now()-lastTick<1000)return;lastTick=now();
    pending=(async()=>{const at=now();let candidate=null;
      await store.transact(d=>{const w=d.uwCampusNpcs,minutes=Math.min(5,Math.max(0,at-w.updatedAt)/60000*DEMO_RATE);w.minute=clock(w,Math.min(at,w.updatedAt+15000));w.updatedAt=at;
        if(w.minute>=DAY_END){w.minute=DAY_START;w.day++;for(const n of Object.values(w.people)){n.untilMinute=0;n.needs={hunger:25,energy:90,social:65};}}
        for(const p of NPC_CAST){const n=w.people[p.id];n.needs.hunger=clamp(n.needs.hunger+minutes*(n.action==='meal'?-4:.35));n.needs.energy=clamp(n.needs.energy+minutes*(n.action==='coffee'?1.4:-.15));n.needs.social=clamp(n.needs.social+minutes*(n.action==='meet'?.6:-.12));
          const choice=options(p,n,w)[0];if(at>=n.pauseUntil&&((choice.priority===100&&n.action!==choice.action)||(at>=n.nextActionAt&&w.minute>=n.untilMinute)))apply(n,choice,w,at);
          if(!candidate&&model&&at>=n.nextPlanAt&&at-w.modelUsage.lastAt>6000&&at>=n.pauseUntil){candidate=p.id;n.nextPlanAt=at+180000;}
        }
      });if(candidate)activeThought=think(candidate);
    })().finally(()=>{pending=null;});return pending;
  }
  function snapshot(){
    watchUntil=now()+45000;const w=store.read().uwCampusNpcs,time=now(),available=Boolean(model&&(w.modelUsage.date!==new Date(time).toISOString().slice(0,10)||w.modelUsage.count<maxModelCalls));return {format:'hyper-campus.npcs/v1',spaceId,mobility:'stationary',serverTime:time,chat:{available,reason:available?null:model?'今日对话额度已用完，仍可使用定位和校园功能。':'同学们的对话服务暂未连接。'},clock:{day:w.day,minute:clock(w,time),rate:DEMO_RATE,label:'校园一天 · 功能演示'},provider:model?'deepseek':'routine',model:model?.model||null,skins:visitorCatalog.skins,npcs:NPC_CAST.map(p=>{const n=w.people[p.id];return {id:p.id,agentId:p.agentId,name:p.name,role:p.role,profile:p.profile,color:p.color,goal:p.goal,topics:p.topics,feature:p.feature,stationId:p.home,placeId:p.home,placeName:nav.landmark(p.home).name,position:n.position,move:null,action:n.action,phase:time<n.pauseUntil?'talking':'activity',activity:time<n.pauseUntil?'和访客聊聊':n.activityLabel,intention:n.intention,needs:n.needs,say:n.say&&time-n.sayAt<25000?n.say:'',decisionsByModel:n.decisionsByModel,planStatus:n.planStatus,schedule:p.schedule.map(([start,end,action,placeId,label])=>({start,end,action:label,place:nav.landmark(p.home).name})),recentEvents:n.log.filter(e=>e.at>=n.stationSince).slice(0,6)};})};
  }
  async function answer({id,message,history=[],signal}){
    const p=person(id);if(!model)throw problem('npc_model_unavailable','这会儿先逛逛校园，稍后再来找我聊天吧。',503);
    watchUntil=now()+45000;await tick();await budget('chats');const w=store.read().uwCampusNpcs,n=w.people[id];
    const state={time:formatTime(w.minute),mobility:'stationary',activity:n.activityLabel,intention:n.intention,place:nav.landmark(p.home).name,goal:p.goal,schedule:p.schedule,topics:p.topics,places:nav.places.filter(a=>['quad','red-square','fountain','hub','kane','suzzallo','raitt'].includes(a.id)).map(a=>a.name)};
    const campusFacts=Object.entries(PLACE_COPY).map(([id,text])=>({id,name:nav.landmark(id).name,text}));
    const text=await model.talk({person:p,state,feature:p.feature,campusFacts,message,history},signal);await store.transact(d=>{d.uwCampusNpcs.people[id].pauseUntil=now()+15000;});return {text,sources:[],mode:'npc-deepseek',npcId:id};
  }
  const agents=NPC_CAST.map(p=>({agentId:p.agentId,name:p.name+' · '+p.role,description:'校园生活 AI 角色',skills:['space.information','uw.campus.route']}));
  return {agents,person,initialize,snapshot,answer,async observe(){watchUntil=now()+45000;await tick();return snapshot();},start(){timer=setInterval(()=>tick().catch(()=>{}),5000);timer.unref();},async close(){closed=true;clearInterval(timer);for(const c of controllers)c.abort();await pending;await activeThought;},tick};
}
