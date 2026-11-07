import {visitorCatalog,validateVisitorRecipe} from './visitor-avatar.mjs';

const cast=[
  {id:'maya',name:'林知夏',role:'学习伙伴 · 项目与合作',home:'main-gate',color:'#9c748d',preset:0,
    personality:'A fictional friendly school-life guide for Beijing Haidian Foreign Language School. Discuss study, language practice, arts, sports, clubs and nature. Follow the visitor language. Never claim to be an actual pupil or employee.',
    goal:'赶上下一堂课，写完小组项目，再找朋友吃点东西。',likes:['study','class','meet'],buddy:'leo',
    schedule:[['10:45','11:25','class','gymnasium','去听一堂课'],['12:10','12:45','meal','international-teaching','和朋友吃午饭'],['14:00','14:50','study','library','推进小组项目']],
    options:[['study','library','给小组项目留一段专注时间'],['coffee','international-teaching','喝点东西，顺便找同学聊聊'],['meet','ecological-garden','在花园认识朋友']]},
  {id:'leo',name:'陈一诺',role:'学习伙伴 · 课后交流',home:'library',color:'#6d8e9b',preset:1,
    personality:'A fictional friendly school-life guide for Beijing Haidian Foreign Language School. Discuss study, language practice, arts, sports, clubs and nature. Follow the visitor language. Never claim to be an actual pupil or employee.',
    goal:'准备讨论课，和同学聊作业思路，给自己的研究留点时间。',likes:['office-hours','study','walk'],buddy:'maya',
    schedule:[['11:00','11:40','office-hours','library','和同学聊聊课程思路'],['12:15','12:45','meal','international-teaching','午饭时间'],['14:10','14:55','class','gymnasium','准备一场讨论课']],
    options:[['study','library','整理研究笔记'],['walk','river-bridge','沿河岸散步，换换脑子'],['office-hours','ecological-garden','找个地方和同学讨论']]},
  {id:'jordan',name:'周予安',role:'活动伙伴 · 社团组织',home:'international-teaching',color:'#b79361',preset:2,
    personality:'A fictional friendly school-life guide for Beijing Haidian Foreign Language School. Discuss study, language practice, arts, sports, clubs and nature. Follow the visitor language. Never claim to be an actual pupil or employee.',
    goal:'约齐社团伙伴，把这次桌游聚会准备好。',likes:['club','meet','walk'],buddy:'aiko',
    schedule:[['10:55','11:30','club','international-teaching','整理社团聚会的小清单'],['12:00','12:35','meal','international-teaching','找伙伴一起午饭'],['14:30','15:15','club','main-gate','和伙伴讨论下一次社团活动']],
    options:[['club','international-teaching','准备社团活动清单'],['meet','ecological-garden','和新朋友聊聊兴趣'],['walk','main-gate','绕校园走一走，找找灵感']]},
  {id:'sam',name:'许星禾',role:'故事伙伴 · 校园记录',home:'main-gate',color:'#798d6b',preset:3,
    personality:'A fictional friendly school-life guide for Beijing Haidian Foreign Language School. Discuss study, language practice, arts, sports, clubs and nature. Follow the visitor language. Never claim to be an actual pupil or employee.',
    goal:'观察校园日常，整理一个关于学生生活的小选题。',likes:['report','walk','study'],buddy:'alex',
    schedule:[['11:10','11:50','report','main-gate','观察课间的广场'],['12:40','13:10','meal','international-teaching','吃点东西，整理采访笔记'],['14:15','15:00','study','art-building','回教学楼附近写稿']],
    options:[['report','main-gate','看看广场上有什么新故事'],['walk','river-bridge','找找取景角度'],['study','art-building','整理今天的观察笔记']]},
  {id:'aiko',name:'苏可晴',role:'语言交流伙伴 · 新同学',home:'ecological-garden',color:'#a87966',preset:1,
    personality:'A fictional friendly school-life guide for Beijing Haidian Foreign Language School. Discuss study, language practice, arts, sports, clubs and nature. Follow the visitor language. Never claim to be an actual pupil or employee.',
    goal:'认熟校园，交几个能一起学习和逛社团的朋友。',likes:['class','meet','study'],buddy:'jordan',
    schedule:[['10:50','11:35','class','art-building','去上今天的一堂课'],['12:00','12:40','meal','international-teaching','和社团伙伴碰面吃饭'],['14:00','14:45','study','ecological-garden','整理课后笔记和速写']],
    options:[['study','library','找个安静的地方读书'],['meet','international-teaching','去学生中心认识新朋友'],['walk','ecological-garden','边走边画一点校园速写']]},
  {id:'alex',name:'沈嘉树',role:'校园向导 · 漫游海外',home:'river-bridge',color:'#8c7caa',preset:0,
    personality:'A fictional friendly school-life guide for Beijing Haidian Foreign Language School. Discuss study, language practice, arts, sports, clubs and nature. Follow the visitor language. Never claim to be an actual pupil or employee.',
    goal:'带朋友熟悉校园，再给自己的创作项目留一段时间。',likes:['walk','meet','study'],buddy:'sam',
    schedule:[['10:55','11:30','walk','main-gate','和朋友在广场碰面'],['12:10','12:45','meal','international-teaching','午饭和闲聊'],['14:20','15:00','study','library','推进创作项目']],
    options:[['walk','river-bridge','沿景观轴线带朋友转转'],['meet','main-gate','看看有没有想认识校园的新朋友'],['study','library','写一点创作项目']]},
];
const stations={
  maya:{home:'gymnasium',goal:'一起聊聊课程、小组项目和校园生活。',topics:['模拟一次小组项目分工','介绍一下校园的课堂与学习小组'],feature:{label:'打开我的形象与背包',module:'inventory',base:'base2'},options:[['class','一起拆解课堂项目'],['study','讨论小组项目怎么分工'],['meet','聊聊学习小组和同学合作']]},
  leo:{home:'library',goal:'来聊聊作业思路、课后交流 和学长支持。',topics:['模拟一次 课后交流 答疑','我想找学长聊学习方向，怎么开始？'],feature:{label:'打开学长支持与机会',module:'network',base:'base3'},options:[['office-hours','一起讨论学习思路'],['study','演示如何准备一次答疑'],['meet','聊聊学长支持和专业方向']]},
  jordan:{home:'international-teaching',goal:'一起把社团活动的点子变成一份小计划。',topics:['带我模拟组织一次桌游聚会','如何让刚入学的同学愿意参加社团活动？'],feature:{label:'打开校园活动',module:'activities',base:'base3'},options:[['club','一起准备社团活动清单'],['meet','聊聊校园志愿与伙伴协作'],['study','演示怎么做活动分工和复盘']]},
  sam:{home:'art-building',goal:'每个人都有值得记录的校园故事，聊聊你的吧。',topics:['帮我把一段校园回忆整理成留言','模拟一次友好的校园采访'],feature:{label:'打开地点留言与记忆',module:'community',base:'base3'},options:[['report','聊聊校园里值得记录的小故事'],['study','一起整理一段地点记忆'],['meet','演示友好的校园采访']]},
  aiko:{home:'ecological-garden',goal:'一起认认校园，聊聊新生生活和交朋友。',topics:['模拟新生第一次和同学搭话','我刚来到校园，怎么找到一起学习的朋友？'],feature:{label:'打开校园联系人与私信',module:'contacts',base:'base2'},options:[['meet','聊聊新生生活与交朋友'],['class','演示课后怎么约同学一起学习'],['study','分享整理课表和校园资源的小办法']]},
  alex:{home:'main-gate',goal:'从校园东门开始认识 海淀外国语，想先了解哪一处？',topics:['用一分钟介绍 校园东门 和周围建筑','帮我安排一条认识校园的参观路线'],feature:{label:'打开空间接待与导览',type:'reception',base:'base1'},options:[['guide','从校园东门介绍校园地标'],['meet','聊聊校园资源和学生日常'],['study','一起安排一条校园参观路线']]},
};
export const NPC_CAST=cast.map((p,i)=>{
  const recipe=structuredClone(visitorCatalog.presets[p.preset].recipe);recipe.colors.top=p.color;
  recipe.colors.hair=['#4a3837','#332c31','#614b3c','#352e35','#443732','#654d3d'][i];const station=stations[p.id];
  return {...p,...station,stationId:station.home,options:station.options.map(([action,label])=>[action,station.home,label]),schedule:p.schedule.map(([start,end,action,_place,_label],j)=>[start,end,station.options[j%station.options.length][0],station.home,station.options[j%station.options.length][1]]),profile:{displayName:p.name.split(' ')[0],recipe:validateVisitorRecipe(recipe)},agentId:'haidian-npc-'+p.id};
});
export const NPC_ACTIONS={class:'上课',study:'自习',meal:'吃午饭',coffee:'休息片刻',meet:'和朋友碰面','office-hours':'课后讨论',club:'社团活动',report:'采集校园故事',walk:'散步'};
export const minuteOf=value=>{const [h,m]=value.split(':').map(Number);return h*60+m;};
export const scheduleFor=(person,minute)=>person.schedule.map(([start,end,action,placeId,label])=>({start:minuteOf(start),end:minuteOf(end),action,placeId,label}));
