// Input sends short-lived directions, never client-selected world positions.
export function installVisitorWalking({canvas,api,revision,direction,onMove,onSync,enterView,canInput,status,onInput=()=>{}}){
  const pressed=new Map();let tap=null,timer=null,busy=false,queued=false,manual=false,waiters=[];
  const codes=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight']);
  const typing=e=>e?.closest?.('input,textarea,select,[contenteditable=true]');
  function axes(){const active=new Set(pressed.keys());if(tap&&performance.now()<tap.until)active.add(tap.code);else tap=null;const x=Number(active.has('KeyD')||active.has('ArrowRight'))-Number(active.has('KeyA')||active.has('ArrowLeft')),y=Number(active.has('KeyW')||active.has('ArrowUp'))-Number(active.has('KeyS')||active.has('ArrowDown'));return x||y?[x,y]:null;}
  let axisKey='',worldDirection=null;
  function input(){const vector=axes(),key=vector?.join(':')||'';if(key!==axisKey){axisKey=key;worldDirection=vector?direction(vector):null;onInput(worldDirection);}return worldDirection;}
  function settle(){if(!busy&&!manual&&!axes()){for(const resolve of waiters)resolve();waiters=[];}}
  async function pump(){
    clearTimeout(timer);timer=null;if(busy){queued=true;return;}busy=true;const sentAt=performance.now();
    try{
      const vector=input();
      if(vector){
        const move=await api('/api/walk',{requestId:crypto.randomUUID(),expectedRevision:revision(),direction:vector,durationMs:450});manual=!move.stopped;onMove(move);
        status(move.boundaryBlocked?'已到校园体验边界，可沿边缘行走。':move.blocked?'前方有障碍，换个方向继续。':'正在漫游 · 松开方向键停下');
      }else if(manual){const move=await api('/api/move/stop',{requestId:crypto.randomUUID(),expectedRevision:revision()});manual=false;onMove(move);status('已停下 · WASD / 方向键移动');}
    }catch(error){
      pressed.clear();tap=null;manual=false;input();
      try{onSync(await api('/api/me'));}catch{}
      status(error.code==='movement_conflict'?'已同步其他页面的移动状态，请重新按方向键。':error.message);
    }finally{
      busy=false;
      if(queued){queued=false;void pump();}
      else if(input())timer=setTimeout(()=>void pump(),Math.max(10,Math.min(tap?tap.until-performance.now():220,220-(performance.now()-sentAt))));
      else if(manual)void pump(); // A tap can expire while its HTTP request is in flight.
      settle();
    }
  }
  function down(code){if(!canInput()||pressed.has(code))return;pressed.set(code,performance.now());tap=null;enterView();input();void pump();}
  function up(code){const start=pressed.get(code);if(start===undefined)return;pressed.delete(code);if(performance.now()-start<100)tap={code,until:performance.now()+180};input();void pump();}
  function pause(){pressed.clear();tap=null;input();void pump();return new Promise(resolve=>{waiters.push(resolve);settle();});}
  const keydown=e=>{if(!codes.has(e.code)||typing(e.target)||e.ctrlKey||e.metaKey||e.altKey||!canInput())return;e.preventDefault();down(e.code);};
  const keyup=e=>{if(!codes.has(e.code)||!pressed.has(e.code))return;e.preventDefault();up(e.code);};
  window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);
  window.addEventListener('blur',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)void pause();});
  for(const button of document.querySelectorAll('[data-walk-key]')){
    button.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();button.setPointerCapture(e.pointerId);down(button.dataset.walkKey);});
    button.addEventListener('pointerup',e=>{e.preventDefault();up(button.dataset.walkKey);if(button.hasPointerCapture(e.pointerId))button.releasePointerCapture(e.pointerId);});
    button.addEventListener('pointercancel',()=>void pause());
    button.addEventListener('click',e=>{if(e.detail===0&&canInput()){tap={code:button.dataset.walkKey,until:performance.now()+180};enterView();input();void pump();}});
    button.addEventListener('blur',()=>{if(pressed.has(button.dataset.walkKey))void pause();});
  }
  canvas.addEventListener('focusout',e=>{if(typing(e.relatedTarget))void pause();});
  return {pause,input,reorient(){axisKey='';input();if(worldDirection)void pump();},active:()=>Boolean(axes()||manual||busy)};
}
