import {pixelItem} from './pixel-items.js';
import {rasterCanvas} from './pixel-raster.js';
import {campusPlaces} from './campus-places.js';
const $=id=>document.getElementById(id),node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const root='/m2/schools/haidian',labels={bookmark:'收藏地点',postcard:'制作明信片',stamp:'收集印章',wave:'挥旗应援',note:'保存私人记忆'};
let inventory,campus,pending,busy=false;
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error?.message||'请求失败'),{status:r.status,code:data.error?.code});return data;}
const status=text=>$('status').textContent=text;
function locked(value){busy=value;document.querySelectorAll('button').forEach(b=>b.disabled=value);}
async function refresh(){
 const [i,c]=await Promise.all([api(root+'/inventory'),api(root+'/collections')]);inventory=i;
 $('starter').hidden=i.starterClaimed;$('items').replaceChildren();
 for(const item of i.catalog){const owned=i.items.find(x=>x.item_id===item.id),card=node('article');card.className='card';const icon=rasterCanvas(pixelItem(item.actions[0]));icon.className='pixel-item-icon';icon.setAttribute('aria-hidden','true');card.append(icon,node('h3',item.name),node('strong','数量 '+(owned?.quantity||0)+(owned?.equipped?' · 已装备':'')),node('p',item.description));
  if(item.slot==='tool'&&owned?.quantity){const b=node('button',owned.equipped?'放回背包':'装备');b.onclick=()=>command(root+'/inventory/equip',{expectedRevision:inventory.revision,itemId:item.id,equipped:!owned.equipped});card.append(b);}
  $('items').append(card);
 }
 $('actions').replaceChildren();for(const item of i.catalog){const owned=i.items.find(x=>x.item_id===item.id);if(!owned?.quantity||(item.slot==='tool'&&!owned.equipped))continue;
  for(const action of item.actions){const b=node('button',labels[action]||action);b.onclick=()=>{const text=$('text').value.trim();if(action==='note'&&text.length<8)return status('请为私人记忆写至少 8 字。');if(action==='postcard'&&text.length>70)return status('明信片题记最多 70 字。');return command(root+'/inventory/use',{expectedRevision:inventory.revision,itemId:item.id,action,sceneId:'haidian-outdoors',entityId:$('place').value,...(action==='note'?{text}:{}),...(action==='postcard'?{caption:text}:{})});};$('actions').append(b);}
 }
 $('collections').replaceChildren();for(const item of c.items){const card=node('article');card.className='card';card.append(node('h3',(labels[item.kind]||item.kind)+' · '+(item.payload?.roomName||'校园')),node('p',item.payload?.text||item.payload?.caption||'在校园中留下的一次纪念。'));if(item.kind==='postcard'){const a=node('a','下载明信片 ↗');a.href=root+'/collections/'+item.collection_id+'.svg';card.append(a);}if(item.kind==='note'){const a=node('a','去社区自主投稿 ↗');a.href='/community.html?school=haidian&sceneId=haidian-outdoors&entityId='+encodeURIComponent(item.payload.entityId);card.append(a);} $('collections').append(card);}
 if(!c.items.length)$('collections').append(node('p','还没有纪念。先在地图里走到一个地点试试。'));
}
async function command(path,body,retry=false){if(busy)return;if(pending&&!retry)return status('上一次操作结果仍待确认，请先重试当前操作。');pending||={path,body:{requestId:crypto.randomUUID(),...body}};locked(true);$('retry').hidden=true;
 try{await api(pending.path,pending.body);pending=null;await refresh();status('已保存到当前账号。');}
 catch(e){if(!pending){status('操作已保存，读取最新背包暂未完成；请刷新背包。');return;}if(e.status&&e.status<500){pending=null;await refresh().catch(()=>{});status(e.code==='tool_arrival_required'?'请先在地图中走到这个地点，抵达后再使用道具。':e.code==='inventory_write_conflict'?'背包已在另一处更新，请核对后再操作。':e.message);}else{status('操作结果尚未确认，重试会沿用原请求编号。');$('retry').hidden=false;}}
 finally{locked(false);}
}
$('starter').onclick=()=>command(root+'/inventory/starter',{expectedRevision:inventory.revision});
$('retry').onclick=()=>command(null,null,true);
$('refresh').onclick=async()=>{if(pending)return status('请先核对上次操作。');try{await refresh();status('已读取服务器背包。');}catch(e){status(e.message);}};
try{const me=await api('/m0/me');if(!me.schools.some(s=>s.school_id==='haidian'&&s.space_id==='haidian-beijing'))throw Error('当前账号尚未加入这个 海淀外国语 学校空间。');campus=await api('/api/campus');const places=campusPlaces(campus);for(const place of places){const option=node('option',place.name);option.value=place.id;$('place').append(option);}const selected=new URLSearchParams(location.search).get('entityId');if(places.some(p=>p.id===selected))$('place').value=selected;$('identity').textContent=me.name+' · 海淀外国语 校园账号';await refresh();$('workspace').hidden=false;status('已读取当前账号的物品和私人纪念。');}
catch(e){status(e.status===401?'请登录校园账号后使用背包。':e.message);$('login').hidden=false;}
