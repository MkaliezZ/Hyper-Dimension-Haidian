export function installCampusServices({selectedPlace}){
  const dialog=document.getElementById('campus-services-dialog'),list=document.getElementById('campus-services-list'),message=document.getElementById('campus-services-message'),login=document.getElementById('campus-services-login');
  let epoch=0;
  async function refresh(){
    const revision=++epoch,place=selectedPlace();
    message.textContent='正在核对校园服务与当前学校…';list.replaceChildren();login.hidden=true;
    try{
      const response=await fetch('/api/campus-services'+(place?'?place='+encodeURIComponent(place):''));
      if(!response.ok)throw Error('校园服务状态读取失败。');
      const data=await response.json();if(revision!==epoch)return;
      message.textContent=data.message+(data.state==='connected'&&!data.placeLinked?' 当前地点尚未绑定社区功能，可使用全校入口。':'');
      if(data.loginUrl){login.href=data.loginUrl;login.hidden=false;}
      for(const item of data.modules){
        const article=document.createElement('article'),name=document.createElement('strong'),description=document.createElement('p');
        name.textContent=item.name;description.textContent=item.description;article.append(name,description);
        const control=document.createElement(item.enabled?'a':'span');control.textContent=item.enabled?'打开校园功能 ↗':'待连接、登录或启用';
        if(item.enabled){control.href=item.url;control.target='_blank';control.rel='noopener noreferrer';}else control.className='service-unavailable';
        article.append(control);list.append(article);
      }
    }catch(error){if(revision===epoch)message.textContent=error.message;}
  }
  function open(){document.body.classList.remove('art-focus');document.getElementById('art-focus').setAttribute('aria-pressed','false');if(!dialog.open)dialog.showModal();refresh();}
  document.getElementById('campus-services-button').onclick=open;
  document.getElementById('campus-services-refresh').onclick=refresh;
  document.getElementById('close-campus-services').onclick=()=>{epoch++;dialog.close();};
  return {open};
}
