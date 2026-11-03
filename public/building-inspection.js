export function installBuildingInspection({map,walkTo,showDetails,openServices}){
  const card=document.createElement('section');card.id='building-inspection';card.className='building-inspection';card.hidden=true;card.setAttribute('role','region');card.setAttribute('aria-label','当前选中建筑');card.setAttribute('aria-live','polite');(map.querySelector('.map-right-dock')||map).prepend(card);
  const element=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
  function show({building,place,source}){
    card.replaceChildren();card.dataset.buildingId=building?.id||'';card.dataset.placeId=place?.id||'';
    const close=element('button','×');close.className='inspection-close';close.setAttribute('aria-label','关闭建筑信息');close.onclick=()=>card.hidden=true;
    const title=element('h3',place?.name||building?.name||'校园建筑');title.id='building-inspection-title';
    card.append(close,element('small',place?.category==='building'?'已选择建筑':place?'已选择地标':'已选择建筑'),title);
    if(place?.nameZh)card.append(element('p',place.nameZh));
    else card.append(element('p','看看这里的校园故事，也留下你的记忆。'));
    const actions=document.createElement('div');actions.className='inspection-actions';
    if(place){
      const details=element('button','查看详情');details.onclick=()=>showDetails(place.id);actions.append(details);
      const walk=element('button','步行前往');walk.onclick=()=>{card.hidden=true;walkTo(place.id);};actions.append(walk);
      if(openServices){const community=element('button','社区与活动');community.onclick=()=>openServices(place.id,'base3');actions.append(community);const life=element('button','背包与互动');life.onclick=()=>openServices(place.id,'base2');actions.append(life);}
    }
    if(source){const link=element('a','查看来源 ↗');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}
    card.append(actions);card.hidden=false;
  }
  return {show,hide(){card.hidden=true;}};
}
