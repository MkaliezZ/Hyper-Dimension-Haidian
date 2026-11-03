import {visitorCatalog,validateVisitorRecipe} from './visitor-avatar.mjs';

const cast=[
  {id:'maya',name:'Maya Brooks',role:'大二 · Computer Science',home:'red-square',color:'#9c748d',preset:0,
    personality:'Warm, organized, dry humor; loves study groups, debugging and pickup volleyball. A Seattle-area sophomore, not a university employee.',
    goal:'赶上下一堂课，写完小组项目，再找朋友吃点东西。',likes:['study','class','meet'],buddy:'leo',
    schedule:[['10:45','11:25','class','kane','去听一堂课'],['12:10','12:45','meal','hub','和朋友吃午饭'],['14:00','14:50','study','suzzallo','推进小组项目']],
    options:[['study','suzzallo','给小组项目留一段专注时间'],['coffee','hub','喝点东西，顺便找同学聊聊'],['meet','quad','去方庭看看朋友']]},
  {id:'leo',name:'Leo Martinez',role:'研究生 · Teaching Assistant',home:'suzzallo',color:'#6d8e9b',preset:1,
    personality:'Patient graduate teaching assistant. Likes explaining ideas on paper, running, and inexpensive packed lunches. Office hours in this story are fictional outdoor meetups.',
    goal:'准备讨论课，和同学聊作业思路，给自己的研究留点时间。',likes:['office-hours','study','walk'],buddy:'maya',
    schedule:[['11:00','11:40','office-hours','suzzallo','和同学聊聊课程思路'],['12:15','12:45','meal','hub','午饭时间'],['14:10','14:55','class','kane','准备一场讨论课']],
    options:[['study','suzzallo','整理研究笔记'],['walk','fountain','沿喷泉散步，换换脑子'],['office-hours','quad','找个地方和同学讨论']]},
  {id:'jordan',name:'Jordan Ellis',role:'学生社团 · Club Organizer',home:'hub',color:'#b79361',preset:2,
    personality:'Outgoing club organizer interested in board games, campus volunteering and making first-year students feel welcome. No sales pitch, no real registrations or official events.',
    goal:'约齐社团伙伴，把这次桌游聚会准备好。',likes:['club','meet','walk'],buddy:'aiko',
    schedule:[['10:55','11:30','club','hub','整理社团聚会的小清单'],['12:00','12:35','meal','hub','找伙伴一起午饭'],['14:30','15:15','club','red-square','和伙伴讨论下一次社团活动']],
    options:[['club','hub','准备社团活动清单'],['meet','quad','和新朋友聊聊兴趣'],['walk','red-square','绕校园走一走，找找灵感']]},
  {id:'sam',name:'Sam Chen',role:'大三 · Campus Reporter',home:'red-square',color:'#798d6b',preset:3,
    personality:'Curious student reporter and photographer; asks one thoughtful question at a time. Interested in everyday student stories, architecture and campus food. Asks before quoting anyone.',
    goal:'观察校园日常，整理一个关于学生生活的小选题。',likes:['report','walk','study'],buddy:'alex',
    schedule:[['11:10','11:50','report','red-square','观察课间的广场'],['12:40','13:10','meal','hub','吃点东西，整理采访笔记'],['14:15','15:00','study','sea-47588-0','回教学楼附近写稿']],
    options:[['report','red-square','看看广场上有什么新故事'],['walk','fountain','找找取景角度'],['study','sea-47588-0','整理今天的观察笔记']]},
  {id:'aiko',name:'Aiko Tanaka',role:'国际学生 · First-year',home:'quad',color:'#a87966',preset:1,
    personality:'First-year international student; thoughtful and increasingly confident. Likes illustration, exploring campus and meeting classmates. Knows some English and Japanese; follows the visitor language.',
    goal:'认熟校园，交几个能一起学习和逛社团的朋友。',likes:['class','meet','study'],buddy:'jordan',
    schedule:[['10:50','11:35','class','raitt','去上今天的一堂课'],['12:00','12:40','meal','hub','和社团伙伴碰面吃饭'],['14:00','14:45','study','quad','整理课后笔记和速写']],
    options:[['study','suzzallo','找个安静的地方读书'],['meet','hub','去学生中心认识新朋友'],['walk','quad','边走边画一点校园速写']]},
  {id:'alex',name:'Alex Rivera',role:'大四 · Campus Guide',home:'fountain',color:'#8c7caa',preset:0,
    personality:'Friendly senior who enjoys showing friends around, intramural sports and campus history. A fictional student guide, not an official admissions representative.',
    goal:'带朋友熟悉校园，再给自己的毕业项目留一段时间。',likes:['walk','meet','study'],buddy:'sam',
    schedule:[['10:55','11:30','walk','red-square','和朋友在广场碰面'],['12:10','12:45','meal','hub','午饭和闲聊'],['14:20','15:00','study','suzzallo','推进毕业项目']],
    options:[['walk','fountain','沿景观轴线带朋友转转'],['meet','red-square','看看有没有想认识校园的新朋友'],['study','suzzallo','写一点毕业项目']]},
];
const stations={
  maya:{home:'kane',goal:'一起聊聊课程、小组项目和校园生活。',topics:['模拟一次小组项目分工','介绍一下美国大学的课堂与学习小组'],feature:{label:'打开我的形象与背包',module:'inventory',base:'base2'},options:[['class','一起拆解课堂项目'],['study','讨论小组项目怎么分工'],['meet','聊聊学习小组和同学合作']]},
  leo:{home:'suzzallo',goal:'来聊聊作业思路、office hours 和学长支持。',topics:['模拟一次 office hours 答疑','我想找学长聊学习方向，怎么开始？'],feature:{label:'打开学长支持与机会',module:'network',base:'base3'},options:[['office-hours','一起讨论学习思路'],['study','演示如何准备一次答疑'],['meet','聊聊学长支持和专业方向']]},
  jordan:{home:'hub',goal:'一起把社团活动的点子变成一份小计划。',topics:['带我模拟组织一次桌游聚会','如何让刚入学的同学愿意参加社团活动？'],feature:{label:'打开校园活动',module:'activities',base:'base3'},options:[['club','一起准备社团活动清单'],['meet','聊聊校园志愿与伙伴协作'],['study','演示怎么做活动分工和复盘']]},
  sam:{home:'sea-47588-0',goal:'每个人都有值得记录的校园故事，聊聊你的吧。',topics:['帮我把一段校园回忆整理成留言','模拟一次友好的校园采访'],feature:{label:'打开地点留言与记忆',module:'community',base:'base3'},options:[['report','聊聊校园里值得记录的小故事'],['study','一起整理一段地点记忆'],['meet','演示友好的校园采访']]},
  aiko:{home:'quad',goal:'一起认认校园，聊聊新生生活和交朋友。',topics:['模拟新生第一次和同学搭话','我刚来到美国大学，怎么找到一起学习的朋友？'],feature:{label:'打开校园联系人与私信',module:'contacts',base:'base2'},options:[['meet','聊聊新生生活与交朋友'],['class','演示课后怎么约同学一起学习'],['study','分享整理课表和校园资源的小办法']]},
  alex:{home:'red-square',goal:'从红场开始认识 UW，想先了解哪一处？',topics:['用一分钟介绍 Red Square 和周围建筑','帮我安排一条认识校园的参观路线'],feature:{label:'打开空间接待与导览',type:'reception',base:'base1'},options:[['guide','从红场介绍校园地标'],['meet','聊聊校园资源和学生日常'],['study','一起安排一条校园参观路线']]},
};
export const NPC_CAST=cast.map((p,i)=>{
  const recipe=structuredClone(visitorCatalog.presets[p.preset].recipe);recipe.colors.top=p.color;
  recipe.colors.hair=['#4a3837','#332c31','#614b3c','#352e35','#443732','#654d3d'][i];const station=stations[p.id];
  return {...p,...station,stationId:station.home,options:station.options.map(([action,label])=>[action,station.home,label]),schedule:p.schedule.map(([start,end,action,_place,_label],j)=>[start,end,station.options[j%station.options.length][0],station.home,station.options[j%station.options.length][1]]),profile:{displayName:p.name.split(' ')[0],recipe:validateVisitorRecipe(recipe)},agentId:'uw-npc-'+p.id};
});
export const NPC_ACTIONS={class:'上课',study:'自习',meal:'吃午饭',coffee:'休息片刻',meet:'和朋友碰面','office-hours':'课后讨论',club:'社团活动',report:'采集校园故事',walk:'散步'};
export const minuteOf=value=>{const [h,m]=value.split(':').map(Number);return h*60+m;};
export const scheduleFor=(person,minute)=>person.schedule.map(([start,end,action,placeId,label])=>({start:minuteOf(start),end:minuteOf(end),action,placeId,label}));
