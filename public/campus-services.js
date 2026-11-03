const groups = [
  {id:'base1',name:'Base 1 · 空间与接待',description:'空间接待、正式账号、资料与会话管理、学校权限与维护反馈。',modules:['account','knowledge','session-policy','environment','agents','agent-tasks','admin']},
  {id:'base2',name:'Base 2 · 我的校园生活',description:'人物搭配、背包、校园名片、私信和实时交流。',modules:['avatar','profile','inventory','contacts','social']},
  {id:'base3',name:'Base 3 · 社区与运营',description:'地点记忆、论坛历史、活动、贡献奖励、年度运营和通知。',modules:['community','history','activities','ranking','rewards','network','operations','annual','inbox','jobs']},
  {id:'base4',name:'Base 4 · 周边合作',description:'经学校管理的合作服务、授权工单与权益。',modules:['partners']},
];
const availability = {'not-configured':'等待连接校园后端','login-required':'登录学校账号后进入','access-denied':'请联系学校负责人','school-denied':'先加入当前学校','unavailable':'校园后端暂不可用','connected':'由学校负责人启用'};
const make=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};

export function installCampusServices({selectedPlace,placeName,onReception,onNpcIndex}){
  const dialog=document.getElementById('campus-services-dialog'),list=document.getElementById('campus-services-list'),message=document.getElementById('campus-services-message'),login=document.getElementById('campus-services-login'),context=document.getElementById('campus-services-context'),filters=document.getElementById('campus-services-filters');
  let epoch=0,active='all',activeModule=null,place=null,data=null,pending=null;
  for(const [id,name] of [['all','全部'],...groups.map(g=>[g.id,g.name.split(' · ')[0]])]){
    const button=make('button','service-filter',name);button.type='button';button.dataset.baseFilter=id;button.onclick=()=>{active=id;activeModule=null;render();};filters.append(button);
  }
  function render(){
    list.replaceChildren();
    for(const button of filters.children)button.setAttribute('aria-pressed',String(active===button.dataset.baseFilter));
    if(!data)return;
    for(const group of groups.filter(g=>(active==='all'||g.id===active)&&(!activeModule||g.modules.includes(activeModule)))){
      const section=make('section','service-group');section.dataset.base=group.id;
      const heading=make('h3',null,group.name);heading.id='services-'+group.id;section.setAttribute('aria-labelledby',heading.id);
      section.append(heading,make('p','service-group-description',group.description));
      const cards=make('div','campus-services-list');
      if(group.id==='base1'&&onNpcIndex&&!activeModule){
        const article=make('article');article.dataset.module='npc-index';article.append(make('strong',null,'NPC 索引'),make('p',null,'找到校园里的 AI 同学，查看固定位置、互动话题与功能入口。'));
        const action=make('button','service-enter','查看 NPC');action.onclick=()=>{dialog.close();onNpcIndex();};article.append(action);cards.append(article);
      }
      if(group.id==='base1'&&onReception){
        const article=make('article');article.append(make('strong',null,'空间接待 Agent'),make('p',null,'咨询校园资料、继续独立会话，或导出与删除记录。'));
        const action=make('button','service-enter','开始对话');action.onclick=()=>{dialog.close();onReception();};article.append(action);cards.append(article);
      }
      for(const key of group.modules.filter(key=>!activeModule||key===activeModule)){
        const item=data.modules.find(m=>m.id===key);if(!item)continue;
        const article=make('article');article.dataset.module=item.id;article.append(make('strong',null,item.name),make('p',null,item.description));
        const action=make(item.enabled?'a':'span',item.enabled?'service-enter':'service-unavailable',item.enabled?'进入 '+item.name+' ↗':item.disabledReason||availability[data.state]||'当前未启用');
        if(item.enabled){action.href=item.url;action.target='_blank';action.rel='noopener noreferrer';}
        article.append(action);cards.append(article);
      }
      section.append(cards);list.append(section);
    }
  }
  async function refresh(){
    const revision=++epoch;pending?.abort();pending=new AbortController();
    message.textContent='正在核对校园服务与当前学校…';message.dataset.state='loading';data=null;login.hidden=true;render();
    const name=place&&placeName?.(place);context.textContent=name?'当前地点：'+name+' · 地点功能会带入此位置':'全校服务 · 选择地图地标后可查看对应地点功能';
    try{
      const response=await fetch('/api/campus-services'+(place?'?place='+encodeURIComponent(place):''),{signal:pending.signal});
      if(!response.ok)throw Error('校园服务状态读取失败，请刷新重试。');
      const result=await response.json();if(revision!==epoch)return;data=result;
      message.dataset.state=data.state;message.textContent=data.message+(data.state==='connected'&&!data.placeLinked&&place?' 当前地点尚未绑定业务功能，可使用全校入口。':'');
      if(data.loginUrl){login.href=data.loginUrl;login.hidden=false;}
      render();
    }catch(error){if(revision===epoch&&error.name!=='AbortError'){message.dataset.state='unavailable';message.textContent=error.message;}}
  }
  function open(options={}){
    active=groups.some(g=>g.id===options.base)?options.base:'all';activeModule=groups.some(g=>g.modules.includes(options.module))?options.module:null;place=Object.hasOwn(options,'placeId')?options.placeId:selectedPlace();
    document.body.classList.remove('art-focus');document.getElementById('art-focus').setAttribute('aria-pressed','false');
    if(!dialog.open)dialog.showModal();refresh();
  }
  document.getElementById('campus-services-button').onclick=()=>open();
  document.getElementById('campus-services-refresh').onclick=refresh;
  document.getElementById('close-campus-services').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{epoch++;pending?.abort();});
  window.addEventListener('focus',()=>{if(dialog.open)refresh();});
  return {open};
}
