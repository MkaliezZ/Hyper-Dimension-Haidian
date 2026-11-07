import {readFile} from 'node:fs/promises';
import {serviceRequest} from './service-request.mjs';
import {campusPlaces} from '../public/campus-places.js';

// Links reuse the native campus applications. This is not another identity,
// forum, chat store or authority for campus roles.
const modules = [
  ['account','账号与学校','正式登录、学校和组织权限','m1','m1.html',null],
  ['avatar','我的形象','编辑与地图一致的校园形象','m2','?edit=avatar','base2'],
  ['inventory','背包与纪念','随身轻道具、地点纪念与私人草稿','m2','inventory.html','base2'],
  ['contacts','联系人与私信','联系同意与消息','contacts','contacts.html','base2'],
  ['community','论坛与校园记忆','发帖、地点记忆和审核','community','community.html','base3'],
  ['activities','校园活动','报名、志愿与活动管理','activities','activities.html','base3'],
  ['ranking','贡献与排名','贡献账本与奖励规则','ledger','ranking.html','base3'],
  ['network','校友、学长与机会','自愿目录、支持预约和职业机会','network','network.html','base3'],
  ['operations','学生会运营','排期、模板和运营管理','operations','operations.html','base3'],
  ['partners','周边合作','服务、明确授权工单与权益','partners','partners.html','base4'],
  ['environment','空间反馈','访客反馈与维护处理','environment','environment.html',null],
  ['knowledge','接待资料与索引','负责人审核资料、发布与撤回、查看自动索引','campus','knowledge.html',null,true],
  ['session-policy','接待会话政策','学校保留期限和受限运行诊断','reception-sessions','reception-admin.html',null,'staff'],
  ['agents','Agent 与委托','接待和合作 Agent、受控技能与授权','agents','agents.html',null],
  ['agent-tasks','我的 A2A 任务','查看进度、结果与回执，停止尚未结束的任务','agents','agent-tasks.html',null],
  ['admin','学校管理台','负责人管理学校、组织、角色和业务记录','m1','admin.html',null,true],
  ['profile','校园名片与作品','自愿展示个人资料、作品和社区徽章','campus','profile.html','base2'],
  ['social','实时校园交流','学校、组织讨论与授权后的私信','m1','social.html','base2'],
  ['history','论坛长期历史','按当前学校和组织权限查询审核历史','community','history.html','base3'],
  ['rewards','贡献奖励','规则约束的奖励、领取和管理','rewards','rewards.html','base3'],
  ['annual','学年与个人计划','年度材料、学生需求、运营排期与个人选择','annual','annual.html','base3'],
  ['inbox','消息与订阅','业务通知、订阅偏好和阅读状态','campus','inbox.html','base3'],
  ['jobs','持久任务管理','负责人查看任务处理、失败与重试状态','jobs','jobs.html','base3',true],
];
const bad=()=>Object.assign(Error('校园连接配置无效；请维护者检查私有配置。'),{status:503});
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(v);
export async function loadCampusServices(file,campus){
  if(!file)return null;
  const c=JSON.parse(await readFile(file,'utf8'));
  const u=new URL(c.origin);
  if(u.origin!==c.origin||u.username||u.password||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))||!id(c.schoolId)||c.spaceId!==campus.id)throw bad();
  const anchors=c.anchors||{};
  if(!anchors||Array.isArray(anchors)||typeof anchors!=='object'||Object.entries(anchors).some(([key,a])=>!campusPlaces(campus).some(p=>p.id===key)||!a||Object.keys(a).some(k=>!['sceneId','entityId'].includes(k))||!id(a.sceneId)||!id(a.entityId)))throw bad();
  return {origin:u.origin,schoolId:c.schoolId,spaceId:c.spaceId,anchors};
}
export function createCampusServices(config){
  async function request(path,req,origin){
    // Port-separated localhost services share cookies. A production connection
    // must likewise use the same browser hostname. Never relay the 海淀外国语 guest
    // cookie, personal A2A credentials, arbitrary headers or supplied URLs.
    if(new URL(origin).hostname!==new URL(config.origin).hostname)throw bad();
    const cookies=(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith('hd_m1='));
    if(cookies.length!==1||!/^hd_m1=[A-Za-z0-9_-]{20,200}$/.test(cookies[0]))return {status:401};
    const response=await serviceRequest(config.origin+path,{headers:{Cookie:cookies[0],Accept:'application/json'}});
    if(response.status===401||response.status===403)return {status:response.status};
    if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw bad();
    const bytes=await response.text();if(bytes.length>128000)throw bad();
    return {status:200,body:JSON.parse(bytes)};
  }
  async function status(req,origin,placeId){
    const rows=modules.map(([key,name,description])=>({id:key,name,description,enabled:false}));
    if(!config)return {state:'not-configured',message:'校园账号与社区后端尚未连接；当前可使用公开导览与接待。',modules:rows};
    try{
      const current=await request('/m0/me',req,origin);
      if(current.status===401)return {state:'login-required',message:'请先在校园服务中登录，再返回这里刷新。公开导览访客身份不会自动升级为学校成员。',loginUrl:config.origin+'/auth/login',modules:rows};
      if(current.status===403)return {state:'access-denied',message:'校园账号当前不可用，请联系负责人。',modules:rows};
      const me=current.body,school=me.schools?.find(s=>s.school_id===config.schoolId&&s.space_id===config.spaceId);
      if(!school||!me.extensions?.includes('m1'))return {state:'school-denied',message:'当前账号未加入此 海淀外国语 空间绑定的学校，无法打开校园功能。',modules:rows};
      let anchor=null;
      if(placeId&&config.anchors[placeId]&&me.extensions.includes('network')){
        const result=await request('/network/schools/'+encodeURIComponent(config.schoolId)+'/bootstrap',req,origin);
        const a=config.anchors[placeId];
        if(result.status!==200||result.body.schoolId!==config.schoolId||!result.body.places?.some(p=>p.sceneId===a.sceneId&&p.entityId===a.entityId))throw bad();
        anchor=a;
      }
      return {state:'connected',message:'已核对当前学校成员身份；所有业务继续由校园后端检查权限。',schoolId:config.schoolId,placeLinked:Boolean(anchor),modules:rows.map((row,i)=>{
        const [, , ,extension,,flag,ownerOnly]=modules[i];
        const roleAllowed=!ownerOnly||school.role==='owner'||(ownerOnly==='staff'&&school.role==='moderator');
        const enabled=me.extensions.includes(extension)&&(!flag||school.modules?.[flag]===true)&&roleAllowed;
        return {...row,enabled,...(enabled?{url:'/api/campus-services/open/'+row.id+(anchor?('?place='+encodeURIComponent(placeId)):'')}:!roleAllowed?{disabledReason:ownerOnly==='staff'?'需要学校负责人或管理员权限':'需要学校负责人权限'}:{} )};
      })};
    }catch{return {state:'unavailable',message:'校园服务暂不可用或绑定核对失败；不会切换到其他学校。',modules:rows};}
  }
  return {status,async target(req,origin,key,placeId){
    const checked=await status(req,origin,placeId),row=checked.modules.find(x=>x.id===key);
    if(checked.state!=='connected'||!row?.enabled)throw Object.assign(Error('请登录已加入的学校，或联系负责人启用对应模块。'),{status:403});
    const module=modules.find(x=>x[0]===key),url=new URL('/'+module[4],config.origin);
    url.searchParams.set('school',config.schoolId);
    if(checked.placeLinked&&['community','network','inventory','environment'].includes(key))for(const [k,v] of Object.entries(config.anchors[placeId]))url.searchParams.set(k,v);
    return url.href;
  }};
}
