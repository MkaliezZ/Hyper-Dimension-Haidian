// Uses the installed gateway contract; this module creates no second task store.
export const SPACE_EXTENSION='https://hyper-dimension.dev/protocol/space/v1';
export const TASK_STATES={TASK_STATE_SUBMITTED:'已接收',TASK_STATE_WORKING:'处理中',TASK_STATE_INPUT_REQUIRED:'等待补充',TASK_STATE_AUTH_REQUIRED:'等待授权',TASK_STATE_COMPLETED:'已完成',TASK_STATE_FAILED:'失败',TASK_STATE_CANCELED:'已停止',TASK_STATE_REJECTED:'已拒绝'};
const terminal=new Set(['TASK_STATE_COMPLETED','TASK_STATE_FAILED','TASK_STATE_CANCELED','TASK_STATE_REJECTED']);
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
export const canCancel=task=>Boolean(task?.id&&Object.hasOwn(TASK_STATES,task.status?.state)&&!terminal.has(task.status.state));
export const stateName=state=>TASK_STATES[state]||'其他状态';
export const taskMetadata=task=>task?.metadata?.[SPACE_EXTENSION]||{};
export function taskResult(task){
  return (task.artifacts||[]).flatMap(a=>(a.parts||[]).filter(p=>typeof p.text==='string').map(p=>{
    try{const value=JSON.parse(p.text);if(value&&typeof value.text==='string')return value.text;}catch{}
    return p.text;
  })).join('\n\n');
}
export function createTaskClient(agentId,{fetchImpl=fetch}={}){
  if(!identifier(agentId))throw Error('无效的 Agent 编号');
  const endpoint='/agents/'+encodeURIComponent(agentId)+'/a2a';
  async function rpc(method,params,signal){
    const requestId=crypto.randomUUID(),response=await fetchImpl(endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','A2A-Version':'1.0'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:AbortSignal.any([AbortSignal.timeout(12000),...(signal?[signal]:[])])});
    let value;try{const text=await response.text();if(text.length>262144)throw Error('too large');value=JSON.parse(text);}catch{throw Error('任务回复无法读取，请刷新重试。');}
    if(!response.ok||value.error)throw Object.assign(Error(value.error?.message||'任务请求未完成'),{status:response.status,code:value.error?.code});
    if(value.jsonrpc!=='2.0'||value.id!==requestId||!Object.hasOwn(value,'result'))throw Error('任务回执与请求不一致，请重新读取。');
    return value.result;
  }
  return {
    list:({status,pageToken,contextId}={},signal)=>rpc('ListTasks',{pageSize:20,historyLength:0,includeArtifacts:false,...(status?{status}:{}),...(pageToken?{pageToken}:{}),...(contextId?{contextId}:{})},signal),
    get:(id,signal)=>{if(!identifier(id))throw Error('无效的任务编号');return rpc('GetTask',{id,historyLength:0},signal);},
    cancel:(id,signal)=>{if(!identifier(id))throw Error('无效的任务编号');return rpc('CancelTask',{id},signal);},
  };
}
