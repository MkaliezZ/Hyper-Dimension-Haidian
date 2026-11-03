import {createTaskClient,TASK_STATES,stateName,taskMetadata,taskResult,canCancel} from './a2a-task-client.js';
const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const query=new URLSearchParams(location.search);
let spaces=[],client,agent,current=null,active=null,busy=false,pageTokens=[''],nextToken='',page=0,selected=null;
const initialTask=query.get('task');
const status=(text,error=false)=>{$('task-status').textContent=text;$('task-status').dataset.error=String(error);};
const date=stamp=>{const time=new Date(stamp);return Number.isFinite(time.getTime())?time.toLocaleString():'时间待同步';};
const skillName=id=>id==='space.information'?'接待对话':id==='uw.campus.route'?'校园导航':id?.startsWith('partner.')?'合作服务':id||'Agent 任务';
function clearDetail(){selected=null;current=null;$('task-detail').replaceChildren(node('h2','任务详情'),node('p','选择一条记录，查看当前状态与执行结果。'));}
function denied(error){
  if(error.status===401||error.status===403){$('task-list').replaceChildren();clearDetail();$('task-workspace').hidden=true;$('task-login').hidden=error.status!==401;}
  status(error.name==='TimeoutError'?'任务读取超时，请刷新重试。':error.message,true);
}
async function run(fn){
  if(busy)return;busy=true;$('task-workspace').disabled=true;active=new AbortController();
  try{await fn(active.signal);}catch(error){if(error.name!=='AbortError')denied(error);}finally{busy=false;$('task-workspace').disabled=false;active=null;}
}
function resetPage(){page=0;pageTokens=[''];nextToken='';clearDetail();}
function renderList(result){
  $('task-list').replaceChildren();$('task-count').textContent='共 '+result.totalSize+' 条本人任务';
  for(const task of result.tasks){
    const button=node('button',undefined,'task-row'),meta=taskMetadata(task);button.type='button';button.dataset.taskId=task.id;button.setAttribute('aria-pressed',String(task.id===selected));
    const badge=node('span',stateName(task.status.state),'task-badge');badge.dataset.state=task.status.state;
    button.append(node('strong',skillName(meta.skillId)),badge,node('code',task.id),node('time',date(task.status.timestamp)));
    button.onclick=()=>run(async signal=>{await details(task.id,signal);$('task-detail-heading').focus({preventScroll:true});$('task-detail').scrollIntoView({block:'nearest',behavior:'auto'});});
    $('task-list').append(button);
  }
  if(!result.tasks.length)$('task-list').append(node('p','这里还没有匹配的任务。和接待或 NPC 对话，或让自己的 Agent 发起请求后，再回来看看。'));
  nextToken=result.nextPageToken||'';$('task-prev').disabled=page===0;$('task-next').disabled=!nextToken;$('task-page').textContent='第 '+(page+1)+' 页';
}
async function refresh(signal){
  clearDetail();status('正在读取当前权限下的任务…');
  const result=await client.list({status:$('task-state').value,pageToken:pageTokens[page]},signal);
  if(!Array.isArray(result?.tasks))throw Error('任务列表格式异常，请刷新重试。');renderList(result);status('已核对当前账号、学校和 Agent 的任务。');
}
function field(list,label,value){list.append(node('dt',label),node('dd',value||'—'));}
function download(task){
  const payload={format:'hyper-campus.a2a-receipt/v1',exportedAt:new Date().toISOString(),schoolSpace:$('task-school').value,agentId:agent.agentId,task};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),link=node('a');link.href=url;link.download='a2a-task-'+task.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function details(id,signal){
  // Remove the old receipt before asking again: stale results never survive a denial.
  clearDetail();const task=await client.get(id,signal);current=task;selected=task.id;
  const box=$('task-detail'),heading=node('h2','任务详情');heading.id='task-detail-heading';heading.tabIndex=-1;
  const fields=node('dl',undefined,'task-fields'),meta=taskMetadata(task);
  field(fields,'Agent',agent.name);field(fields,'任务编号',task.id);field(fields,'当前状态',stateName(task.status.state));field(fields,'更新时间',date(task.status.timestamp));field(fields,'能力',skillName(meta.skillId));field(fields,'上下文',task.contextId);field(fields,'结果模式',meta.mode);
  const actions=node('div',undefined,'detail-actions'),reload=node('button','刷新详情'),exportButton=node('button','导出回执');reload.type=exportButton.type='button';
  reload.onclick=()=>run(s=>details(task.id,s));exportButton.onclick=()=>run(async s=>{const fresh=await client.get(task.id,s);download(fresh);status('已导出这条任务的当前回执。');});actions.append(reload,exportButton);
  const back=node('button','返回任务列表');back.type='button';back.onclick=()=>{$('task-list-heading').tabIndex=-1;$('task-list-heading').focus();$('task-list-heading').scrollIntoView({block:'start'});};actions.append(back);
  if(canCancel(task)){const cancel=node('button','停止任务');cancel.id='task-cancel';cancel.type='button';cancel.onclick=()=>{$('task-cancel-dialog').showModal();};actions.append(cancel);}
  box.replaceChildren(heading,fields,actions);
  const output=taskResult(task);if(output)box.append(node('h3','执行结果'),node('div',output,'task-output'));
  const message=task.status?.message?.parts?.filter(p=>typeof p.text==='string').map(p=>p.text).join('\n');if(message&&!output)box.append(node('p',message));
  if(!output&&!message)box.append(node('p',canCancel(task)?'任务仍在处理中，可刷新查看最新进度。':'这条任务没有附加正文，可通过编号核对对应业务。'));
  const sources=Array.isArray(meta.sources)?meta.sources:[];
  if(sources.length){box.append(node('h3','结果来源'));const list=node('ul');for(const source of sources.slice(0,30))list.append(node('li',typeof source==='string'?source:source.title||source.label||source.id||source.sourceId||'业务来源'));box.append(list);}
  for(const row of $('task-list').querySelectorAll('[data-task-id]'))row.setAttribute('aria-pressed',String(row.dataset.taskId===selected));
  status('任务 '+task.id+' · '+stateName(task.status.state));
}
function chooseAgent(){
  const space=spaces.find(s=>s.spaceId===$('task-school').value);agent=space?.agents.find(a=>a.agentId===$('task-agent').value);
  if(!agent)throw Error('当前学校没有这个 Agent，或访问权限已变更。');client=createTaskClient(agent.agentId);resetPage();
}
function fillAgents(preferred){
  const space=spaces.find(s=>s.spaceId===$('task-school').value);$('task-agent').replaceChildren(...(space?.agents||[]).map(a=>new Option(a.name||a.agentId,a.agentId)));
  if(preferred){if(!space.agents.some(a=>a.agentId===preferred))throw Error('这个 Agent 不在当前学校可访问的目录中。');$('task-agent').value=preferred;}
  chooseAgent();
}
for(const [value,name] of Object.entries(TASK_STATES))$('task-state').add(new Option(name,value));
$('task-filters').onsubmit=event=>{event.preventDefault();run(async signal=>{resetPage();await refresh(signal);});};
$('task-agent').onchange=()=>run(async signal=>{chooseAgent();await refresh(signal);});
$('task-school').onchange=()=>run(async signal=>{fillAgents();await refresh(signal);});
$('task-state').onchange=()=>run(async signal=>{resetPage();await refresh(signal);});
$('task-prev').onclick=()=>run(async signal=>{if(page>0){page--;await refresh(signal);}});
$('task-next').onclick=()=>run(async signal=>{if(nextToken){pageTokens[++page]=nextToken;await refresh(signal);}});
$('task-cancel-back').onclick=()=>$('task-cancel-dialog').close();
$('task-cancel-confirm').onclick=()=>{
  const id=current?.id;if(!id)return;$('task-cancel-dialog').close();
  run(async signal=>{
    try{await client.cancel(id,signal);await refresh(signal);await details(id,signal);status('这条 Agent 任务已停止。');}
    catch(error){
      if(error.code===-32002){await refresh(signal);await details(id,signal);status('任务已经结束，已显示最终状态。');}
      else{clearDetail();throw error;}
    }
  });
};
window.addEventListener('pagehide',()=>active?.abort());
await run(async signal=>{
  const response=await fetch('/api/catalog',{cache:'no-store',credentials:'same-origin',signal});
  if(!response.ok)throw Object.assign(Error(response.status===401?'请登录学校账号后查看任务。':'当前账号无法访问这个校园。'),{status:response.status});
  const catalog=await response.json();
  if(catalog.platform!=='m0'){status('请启动 Ubuntu 完整校园服务后查看账号任务。当前公开参观模式可继续使用地图与接待。',true);return;}
  spaces=catalog.spaces||[];
  if(!spaces.length)throw Error('当前账号尚未加入这所学校，请联系学校负责人。');
  $('task-school').replaceChildren(...spaces.map(s=>new Option(s.name,s.spaceId)));
  const school=query.get('school');if(school){const schoolSpace=spaces.find(s=>s.spaceId===school||s.schoolId===school);if(!schoolSpace)throw Error('链接中的学校与当前授权不匹配。');$('task-school').value=schoolSpace.spaceId;}
  fillAgents(query.get('agent'));$('task-login').hidden=true;$('task-workspace').hidden=false;await refresh(signal);if(initialTask){await details(initialTask,signal);$('task-detail-heading').focus({preventScroll:true});$('task-detail').scrollIntoView({block:'start'});}
});
