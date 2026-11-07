import {pixelAvatar} from './pixel-avatar-v3.js';
import {rasterCanvas} from './pixel-raster.js';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const timeLabel=m=>String(Math.floor(m/60)%24).padStart(2,'0')+':'+String(Math.floor(m)%60).padStart(2,'0');

export function installCampusNpcs({map,onState,onFocus,onWalk,onService,onReception}){
  const header=el('div','npc-world-status'),rosterButton=el('button','npc-roster-button','NPC 索引'),clock=el('span','npc-clock','校园的一天');
  rosterButton.id='npc-roster-button';header.append(rosterButton,clock);(map.querySelector('.map-left-dock')||map).prepend(header);
  const dialog=el('dialog','npc-dialog');dialog.id='npc-dialog';dialog.setAttribute('aria-labelledby','npc-title');
  const heading=el('header','npc-heading'),title=el('h2',null,'NPC 索引 · 校园同学'),close=el('button',null,'返回校园');title.id='npc-title';close.setAttribute('aria-label','关闭校园同学');heading.append(title,close);
  const intro=el('p','npc-intro','挑一位校园同学，试试学习讨论、社团活动、校园记忆和新生问答。'),layout=el('div','npc-layout'),roster=el('nav','npc-roster'),main=el('section','npc-main');roster.setAttribute('aria-label','选择校园 AI 角色');
  const info=el('section','npc-info'),infoTop=el('div','npc-info-top'),portrait=el('div','npc-portrait'),copy=el('div'),name=el('h3'),role=el('p','npc-role'),badge=el('span','npc-ai-badge','AI NPC');
  copy.append(name,role,badge);infoTop.append(portrait,copy);const activity=el('p','npc-activity'),intention=el('p','npc-intention'),needs=el('div','npc-needs'),actions=el('div','npc-actions'),locate=el('button',null,'在地图上找 Ta'),walk=el('button',null,'去这个地点');
  const featureButton=el('button','npc-feature-button');actions.append(locate,walk,featureButton);const detail=el('details','npc-schedule'),summary=el('summary',null,'看看今天的安排'),schedule=el('div');detail.append(summary,schedule);const recent=el('details','npc-schedule'),recentSummary=el('summary',null,'刚刚发生的事'),recentList=el('div');recent.append(recentSummary,recentList);info.append(infoTop,activity,intention,needs,actions,detail,recent);
  const chat=el('section','npc-chat'),chatHeading=el('h3',null,'打个招呼'),messages=el('div','npc-messages'),status=el('p','npc-chat-status'),form=el('form','npc-chat-form'),input=el('textarea'),send=el('button',null,'发送');
  messages.id='npc-messages';messages.setAttribute('role','log');messages.setAttribute('aria-live','polite');input.id='npc-chat-input';input.rows=2;input.maxLength=1200;input.required=true;input.placeholder='聊聊课业、社团，或者试试 Ta 的互动话题。';input.setAttribute('aria-label','和校园同学聊天');send.type='submit';status.setAttribute('role','status');form.append(input,send);
  const chatActions=el('div','npc-chat-actions'),fresh=el('button',null,'新对话'),exportButton=el('button',null,'导出对话'),deleteButton=el('button',null,'清除此段对话');chatActions.append(fresh,exportButton,deleteButton);const topics=el('div','npc-topics');topics.setAttribute('aria-label','快捷互动话题');chat.append(chatHeading,topics,messages,status,form,chatActions);main.append(info,chat);layout.append(roster,main);dialog.append(heading,intro,layout);document.body.append(dialog);
  const taskLink=el('a','npc-task-link','我的任务记录');taskLink.target='_blank';taskLink.rel='noopener noreferrer';actions.append(taskLink);
  let state=null,selected=null,context=null,busy=false,epoch=0,pollTimer=null,closed=false,offset=0,markerAt=0,pollPending=null;const markers=new Map();
  async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const value=await r.json();if(!r.ok)throw Error(value.error?.message||'这会儿有点忙，稍后再聊。');return value;}
  const base=id=>'/api/npcs/'+id;
  function bubble(who,text){const row=el('p','npc-bubble '+who,text);messages.append(row);messages.scrollTop=messages.scrollHeight;return row;}
  function lock(value){busy=value;fresh.disabled=exportButton.disabled=deleteButton.disabled=value;send.disabled=input.disabled=value||state?.chat?.available===false;for(const b of topics.querySelectorAll('button'))b.disabled=send.disabled;}
  function details(){
    const p=state?.npcs.find(p=>p.id===selected);if(!p)return;
    taskLink.href='/agent-tasks.html?agent='+encodeURIComponent(p.agentId);
    name.textContent=p.name;role.textContent=p.role;badge.textContent='AI NPC · '+(state.provider==='deepseek'?(state.model==='deepseek-flash'?'DeepSeek Flash':'DeepSeek'):'校园日程');
    lock(busy);if(!busy&&state.chat?.available===false){status.dataset.availability='blocked';status.textContent=state.chat.reason;}else if(status.dataset.availability==='blocked'){delete status.dataset.availability;status.textContent='和 '+p.name.split(' ')[0]+' 聊聊吧。';}
    activity.textContent='在 '+p.placeName+' · '+p.activity;
    intention.textContent=p.intention;featureButton.textContent=p.feature.label;featureButton.onclick=()=>{dialog.close();if(p.feature.type==='reception')onReception?.();else onService?.({placeId:p.placeId,base:p.feature.base,module:p.feature.module});};if(topics.dataset.npc!==p.id){topics.dataset.npc=p.id;topics.replaceChildren(...p.topics.map(text=>{const b=el('button','npc-topic',text);b.type='button';b.disabled=busy||state.chat?.available===false;b.onclick=()=>{input.value=text;form.requestSubmit();};return b;}));}portrait.replaceChildren(rasterCanvas(pixelAvatar(p.profile.recipe,state.skins,{direction:'south',action:'idle',frame:0})));
    needs.replaceChildren(...[['精力',p.needs.energy],['饱腹',100-p.needs.hunger],['社交',p.needs.social]].map(([label,value])=>{const row=el('span');row.textContent=label+' '+Math.round(value);return row;}));
    schedule.replaceChildren(...p.schedule.map(s=>el('p',null,s.start+'–'+s.end+' · '+s.action+' / '+s.place)));recentList.replaceChildren(...p.recentEvents.map(e=>el('p',null,e.label)));
    locate.onclick=()=>{dialog.close();onFocus(p.position);};walk.onclick=()=>{dialog.close();onWalk(p.placeId);};
  }
  function renderRoster(){
    for(const p of state.npcs){
      let button=roster.querySelector('[data-npc="'+p.id+'"]');
      if(!button){button=el('button','npc-person');button.dataset.npc=p.id;button.append(el('strong'),el('span'),el('small'),el('small','npc-index-feature'));button.onclick=()=>select(p.id);roster.append(button);}
      button.setAttribute('aria-pressed',String(p.id===selected));button.querySelector('strong').textContent=p.name;button.querySelector('span').textContent=p.role;button.querySelector('small').textContent=p.placeName+' · '+p.activity;
      button.querySelector('.npc-index-feature').textContent=p.feature.label;
      if(!markers.has(p.id)){const marker=el('button','npc-marker',p.name.split(' ')[0]);marker.dataset.npcMarker=p.id;marker.setAttribute('aria-label','和 '+p.name+' 聊天');marker.hidden=true;marker.onclick=()=>open(p.id);markers.set(p.id,marker);map.append(marker);}
      const marker=markers.get(p.id);marker.setAttribute('aria-pressed',String(p.id===selected));marker.dataset.say=p.say||'';marker.title=p.say||p.activity;
    }details();
  }
  async function select(id){
    if(busy){status.textContent='先等 Ta 说完这句话。';return;}
    const p=state?.npcs.find(p=>p.id===id);if(!p)return;selected=id;context=null;const revision=++epoch;messages.replaceChildren();status.textContent='正在接上你们的对话…';renderRoster();
    try{const list=await api(base(id)+'/sessions');if(revision!==epoch)return;
      if(list.sessions[0]){context=list.sessions[0].contextId;const saved=await api(base(id)+'/sessions/'+encodeURIComponent(context)+'/export');if(revision!==epoch)return;for(const turn of saved.turns){if(turn.question)bubble('you',turn.question);if(turn.answer)bubble('them',turn.answer);}}
      if(!messages.childElementCount)bubble('them','嘿，我是 '+p.name.split(' ')[0]+'。'+p.intention+' 你今天准备在校园里做些什么？');
      status.textContent=state.chat?.available===false?state.chat.reason:'和 '+p.name.split(' ')[0]+' 聊聊吧。';
    }catch(error){if(revision===epoch)status.textContent=error.message;}
  }
  async function open(id){if(!state)await poll();if(!state)return;document.body.classList.remove('art-focus');if(!dialog.open)dialog.showModal();if(id!==selected||!messages.childElementCount)void select(id||state.npcs[0].id);}
  form.onsubmit=async event=>{event.preventDefault();if(busy||!selected||!input.value.trim())return;if(state.chat?.available===false){status.textContent=state.chat.reason;return;}const id=selected,text=input.value.trim();input.value='';lock(true);bubble('you',text);const waiting=bubble('waiting','正在听你说…');status.textContent='';
    try{if(!context)context=(await api(base(id)+'/sessions',{requestId:crypto.randomUUID()})).contextId;
      const response=await api(base(id)+'/message',{message:text,messageId:crypto.randomUUID(),contextId:context});if(response.error)throw Error(response.error.message||'这句话没接上，稍后再聊吧。');
      const task=response.result?.task,answer=task?.artifacts?.[0]?.parts?.[0]?.text;if(!answer)throw Error(task?.status?.message?.parts?.[0]?.text||'这会儿有点忙，稍后再聊。');
      waiting.remove();bubble('them',JSON.parse(answer).text);status.textContent='';
    }catch(error){waiting.remove();status.textContent=error.message;}finally{lock(false);input.focus();}
  };
  input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}};
  fresh.onclick=async()=>{if(busy||!selected)return;try{context=(await api(base(selected)+'/sessions',{requestId:crypto.randomUUID()})).contextId;messages.replaceChildren();bubble('them','又见面了，今天想聊点什么？');status.textContent='已开启新对话。';}catch(e){status.textContent=e.message;}};
  exportButton.onclick=async()=>{if(!context||busy)return;try{const data=await api(base(selected)+'/sessions/'+encodeURIComponent(context)+'/export'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download='haidian-npc-'+selected+'-conversation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='对话已导出。';}catch(e){status.textContent=e.message;}};
  deleteButton.onclick=async()=>{if(!context||busy)return;try{const saved=await api(base(selected)+'/sessions/'+encodeURIComponent(context)+'/export');await api(base(selected)+'/sessions/'+encodeURIComponent(context)+'/delete',{requestId:crypto.randomUUID(),expectedRevision:saved.session.revision});context=null;messages.replaceChildren();bubble('them','嗨，重新认识一下吧。你今天想去哪里？');status.textContent='这段对话已清除。';}catch(e){status.textContent=e.message;}};
  close.onclick=()=>dialog.close();rosterButton.onclick=()=>open(selected||state?.npcs[0]?.id);const indexButton=document.getElementById('npc-index-button');if(indexButton)indexButton.onclick=()=>open(selected||state?.npcs[0]?.id);
  async function poll(){
    if(closed||document.hidden)return;if(pollPending)return pollPending;
    pollPending=(async()=>{try{const sent=Date.now(),result=await api('/api/npcs');if(closed)return;offset=result.serverTime+(Date.now()-sent)/2-Date.now();state=result;onState(result);clock.textContent='Day '+result.clock.day+' · '+timeLabel(result.clock.minute)+' · 校园一天';renderRoster();}catch{clock.textContent='同学们稍后回来';}finally{pollPending=null;}})();return pollPending;
  }
  const visibility=()=>{clearInterval(pollTimer);pollTimer=null;if(!document.hidden&&!closed){void poll();pollTimer=setInterval(poll,4000);}};document.addEventListener('visibilitychange',visibility);
  return {open,async start(){await poll();pollTimer=setInterval(poll,4000);},get serverTime(){return Date.now()+offset;},draw(rows,time){if(time-markerAt<50)return;markerAt=time;const placed=[];for(const row of rows||[]){const node=markers.get(row.id);if(!node)continue;node.hidden=!row.visible;if(row.visible){let y=row.labelY;for(let i=0;i<6&&placed.some(p=>Math.abs(p.x-row.x)<72&&Math.abs(p.y-y)<23);i++)y-=24;placed.push({x:row.x,y});node.style.left=row.x+'px';node.style.top=y+'px';}}},dispose(){closed=true;clearInterval(pollTimer);document.removeEventListener('visibilitychange',visibility);for(const n of markers.values())n.remove();markers.clear();header.remove();dialog.remove();}};
}
