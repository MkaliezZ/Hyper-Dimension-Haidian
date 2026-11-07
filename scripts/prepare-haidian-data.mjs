// Hand-traced public 2018 campus plan. Coordinates and heights are illustrative.
// Rebuilds school content only; the embedded UW Base is kept byte-for-byte.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {projectRoot,protocol} from '../src/base.mjs';
import {resolveHaidianArchitecture} from '../public/haidian-architecture.js';
const save=async(p,v)=>{await mkdir(join(projectRoot,p,'..'),{recursive:true});await writeFile(join(projectRoot,p),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');};
export const school={id:'haidian',spaceId:'haidian-beijing',sceneId:'haidian-outdoors',name:'海淀外国语 · 海淀校区',fullName:'北京市海淀外国语实验学校',address:'北京市海淀区杏石口路20号',origin:'https://www.bjfles.com/environment/'};
const xy=([x,z])=>[+( (x-480)*.8).toFixed(2),+((z-405)*.8).toFixed(2)];
const ring=points=>{const r=points.map(xy);return [...r,r[0]];};
const rect=(x,z,w,h)=>[[x,z],[x+w,z],[x+w,z+h],[x,z+h]];
const points={};
const buildings=[];
function building(id,name,code,outline,height,style='brick',description='',category='learning'){
  const rings=[ring(outline)],a=outline.reduce((a,p)=>[a[0]+p[0]/outline.length,a[1]+p[1]/outline.length],[0,0]);
  points[id]=a;
  buildings.push({id,name,code,rings,height,heightStatus:'inferred',baseY:0,centroid:xy(a),sourceObjectId:code,labelSource:'campus-plan-2018',schoolProfile:{family:style,window:'regular',roof:style==='membrane'?height-2:style==='pavilion'?3:.8,feature:null},description,category,geometryStatus:'hand-traced-schematic-2018',currentUseStatus:'historical-plan-label-not-current-room-verification'});
}
building('primary-dormitory','小学宿舍楼','N1',rect(497,78,173,46),17,'brick','总览图中位于校园北侧、杏石口路以南的小学宿舍建筑。','student');
building('boys-dormitory','男生宿舍楼','N2',rect(555,136,113,31),17,'brick','总览图标记的男生宿舍楼，位于北侧生活区。','student');
building('girls-dormitory','女生宿舍楼','N3',rect(555,180,113,30),17,'brick','总览图标记的女生宿舍楼。住宿管理与具体安排请向学校确认。','student');
building('dining-hall','主校区食堂','N9',[[518,141],[542,141],[542,184],[535,184],[535,204],[524,204],[524,184],[518,184]],10,'cream','总览图中的主校区食堂，位于北侧宿舍区西边。','student');
building('primary-teaching','小学教学楼与钢琴楼','N4',[[550,223],[641,223],[641,229],[670,229],[670,264],[641,264],[641,248],[550,248]],17,'brick','海淀校区拥有小学教学空间与独立钢琴房；本图按公开总览概括其建筑组合。');
building('library','图书馆','N5-L',rect(519,286,28,34),13,'cream','校园总览在小学综合楼西侧标记图书馆。这里可作为阅读与校园记忆的数字地点。');
building('primary-complex','小学综合楼','N5-A',rect(549,277,57,44),17,'brick','公开总览标记的小学综合楼，东邻实验楼。');
building('laboratory','实验楼','N5-B',rect(609,277,59,44),17,'cream','官网介绍海淀校区设有机器人室、天文台等科技学习设施；不推定它们在本楼的具体楼层。');
building('art-building','艺术楼','N6-A',[[548,349],[571,349],[571,343],[616,343],[616,378],[571,378],[571,372],[548,372]],13,'brick','官网介绍的艺术教育空间涵盖音乐、舞蹈、陶艺、书法等。本地点沿用总览图的艺术楼标记。');
building('middle-complex','中学综合楼','N6-B',rect(629,342,34,49),17,'cream','总览图中位于艺术楼东侧的中学综合楼。');
building('senior-teaching','高中综合楼','N7',rect(589,407,79,29),17,'cream','总览图标记的高中综合楼，为学习讨论与校园生活设置数字地点。');
building('gymnasium','综合体育馆','N8-A',rect(582,449,85,40),12,'cream','学校官网介绍有大型综合体育馆，包含篮球、跆拳道、体操训练等设施。','sport');
building('swimming-hall','游泳馆','N8-B',rect(585,492,82,45),10,'brick','官网介绍海淀校区设有室内游泳馆。具体开放与课程安排请向学校确认。','sport');
building('table-tennis-dome','乒羽中心','N10-A',rect(707,435,62,31),13,'membrane','官网介绍的充气式乒羽中心。浅色膜结构根据公开操场照片作美术概括。','sport');
building('fencing-center','击剑中心','N10-B',rect(774,435,35,31),10,'membrane','海淀校区官网介绍设有击剑中心。','sport');
building('sports-service','体育活动用房','N12',rect(585,585,84,16),6,'brick','按公开总览图概括的南侧体育区附属用房；具体房间功能未核实。','sport');
building('chinese-pavilion','中华文化园亭廊','G1',rect(574,642,32,23),7,'pavilion','据官方全景中的红柱、灰瓦翘檐、彩绘梁架与开放连廊复原。点位为文化园岸上的示意位置，非实地测绘。','landscape');
building('international-teaching','国际教学楼','S4',rect(173,651,139,31),17,'brick','总览图中位于南旱河南岸的国际教学楼。数字空间保留河岸与教学区的相对关系。');
building('liberal-arts','文理楼','S5',[[177,593],[243,612],[235,641],[168,624]],14,'brick','总览图标记的文理楼，位于南岸教学区西侧。');
building('middle-teaching','中学教学楼','S6',[[206,511],[275,538],[266,559],[194,539]],17,'cream','总览图标记的中学教学楼，位于南岸校园北部。');
building('south-boys-dormitory','南岸男生宿舍楼','S7',[[293,555],[359,583],[347,608],[281,578]],17,'brick','总览图标记的南岸男生宿舍楼。','student');
building('south-primary-dormitory','南岸小学宿舍楼','S1',[[332,528],[415,565],[405,588],[321,551]],17,'cream','公开总览图中沿南岸斜向布置的宿舍建筑；编号与用途据历史图。','student');
building('south-dining','南岸食堂','S2',rect(381,684,79,42),10,'cream','总览图标记的南岸食堂，位于南岸校园东南部。','student');
building('south-girls-dormitory','南岸女生宿舍楼','S3',rect(328,689,49,23),14,'brick','总览图标记的南岸女生宿舍楼。','student');
building('language-training','网球训练馆','S3-A',rect(330,717,48,20),10,'cream','历史总览标记为网球训练馆（Tennis Training Hall），位于南岸女生宿舍楼南侧；具体当前用途待校方核对。','sport');
building('south-gatehouse','南岸生活用房','S10',rect(435,606,22,55),10,'brick','公开总览中的南岸生活区附属建筑，具体用途待校方核实。','student');
// Each school-specific model is backed by reviewed exterior/partial/unknown evidence.
const architecturalSource=JSON.parse(await readFile(join(projectRoot,'data/haidian-architecture.json'),'utf8'));
if(architecturalSource.campusId!==school.spaceId)throw Error('Foreign school architecture source');
for(const b of buildings){
 const recipe=architecturalSource.recipes[b.id];if(!recipe)throw Error('Missing architecture review: '+b.id);
 b.sourcePlanRings=b.rings;b.architecture=resolveHaidianArchitecture(b,recipe);
 b.rings=b.architecture.parts[0].rings;b.height=Math.max(...b.architecture.parts.map(p=>p.eave+(p.rise||0)+Math.abs(p.slope?.[0]||0)/2));
 b.schoolProfile={family:recipe.material,window:recipe.kind==='curved-stone'?'ribbon':'regular',roof:recipe.roofRise||0,architectureKind:recipe.kind,floors:recipe.floors};
 b.heightStatus='photo-informed visual estimate; not surveyed';b.geometryStatus='historical-plan location; photo-informed architectural parts';
}
const bounds=[-272,-278,270,278];
const source={id:'campus-plan-2018',title:'海淀教育 · 海淀外国语校园平面示意（2018）',url:'https://www.sohu.com/a/232407928_391284',image:'https://5b0988e595225.cdn.sohucs.com/images/20180521/7ffd9f63d99543d696f8897cebd66cba.jpeg',date:'2018-05-21',usedFor:'校园分区、建筑编号及相对布局；手工概括外轮廓',credit:'海淀教育发布于搜狐',certainty:'historical-schematic; not a current survey'};
const official={id:'school-official',title:'海淀外国语教育集团 · 云赏校园',url:school.origin,date:'查阅 2026-11-03',usedFor:'海淀校区身份、设施与校园特色；官方全景入口',credit:'海淀外国语教育集团',certainty:'published school introduction; no live access conditions'};
const river=ring([[145,324],[145,283],[474,512],[812,718],[812,750],[461,553]]);
// The map's northeast compass/legend margin is outside the school, not a lawn.
const main=ring([[476,60],[696,60],[696,431],[811,431],[811,744],[476,744]]);
const south=ring([[149,358],[473,585],[473,747],[149,747]]);
const bridges=[ring([[439,579],[552,526],[562,541],[449,595]])];
const pathsPx=[[[688,70],[688,699]],[[484,70],[484,501]],[[486,330],[688,330]],[[486,395],[688,395]],[[486,440],[689,440]],[[486,545],[688,545]],[[486,266],[688,266]],[[548,128],[548,328]],[[160,443],[160,737]],[[160,685],[465,685]],[[465,594],[465,736]],[[169,578],[277,610],[421,650]],[[275,562],[289,606],[373,655]],[[465,580],[510,557],[552,562]],[[690,470],[805,470],[805,695],[690,695],[690,470]],[[176,498],[311,529],[426,581]],[[486,212],[688,212]],[[486,127],[688,127]],[[486,172],[688,172]]];
const nodes=[],edges=[],paths=[];
for(const [i,path] of pathsPx.entries()){const ids=path.map(p=>{const q=xy(p);let n=nodes.findIndex(a=>a[0]===q[0]&&a[2]===q[1]);if(n<0){n=nodes.length;nodes.push([q[0],.1,q[1]]);}return n;});for(let n=1;n<ids.length;n++)edges.push([ids[n-1],ids[n],Math.hypot(nodes[ids[n]][0]-nodes[ids[n-1]][0],nodes[ids[n]][2]-nodes[ids[n-1]][2])]);paths.push({id:'haidian-path-'+i,kind:i===0?'road':'sidewalk',points:ids.map(n=>nodes[n])});}
const outdoor=[
 ['main-gate','主校区东门','从杏石口路20号认识海淀校区。总览图中的主门位于校园东侧，中部横向步道连接教学区。',[688,333],'student'],
 ['cultural-garden','中华文化园','河岸与中式亭廊组成中华文化园，呼应学校对中华文化与国际视野的共同重视。',[620,642],'landscape'],
 ['ecological-garden','校内花园','校园官网介绍百鸟园、动物园等自然体验场所；花园点位据历史总览概括。',[519,400],'landscape'],
 ['athletics-field','田径场与足球场','官网介绍的400米田径场与人造草坪足球场。跑道、看台和周围体育空间形成校园的运动场景。',[749,575],'sport'],
 ['tennis-courts','网球场','海淀校区官网介绍设有专业网球场。本图按历史总览中的运动分区表现球场。',[523,488],'sport'],
 ['river-bridge','南旱河与校园桥','公开总览以南旱河分隔并连接南北校园。数字步行只通过图示校园桥跨越河道。',[477,575],'landscape'],
 ['south-basketball','南岸篮球场','官网介绍丰富的篮球运动场地。本图据历史总览设置南岸篮球区域。',[248,710],'sport'],
];
const landmarks=[];
for(const [id,name,description,p,category]of outdoor){points[id]=p;landmarks.push({id,name,nameZh:'',category,subtitle:category==='sport'?'体教融合':category==='landscape'?'校园风景':'校园生活',description,point:[xy(p)[0],0,xy(p)[1]],sourceIds:['school-official','campus-plan-2018'],positionSource:'2018 schematic; hand traced'});}
for(const id of ['primary-teaching','library','laboratory','art-building','gymnasium','swimming-hall','table-tennis-dome','international-teaching']){const b=buildings.find(b=>b.id===id);landmarks.push({id,name:b.name,nameZh:b.code,buildingId:b.id,category:b.category,subtitle:b.category==='sport'?'体教融合':'融中西教育之所长',description:b.description,point:[b.centroid[0],0,b.centroid[1]],sourceIds:['campus-plan-2018','school-official'],heightStatus:'inferred'});}
// Each landmark gets a safe exterior arrival; generated after common walking module is loaded.
const campus={format:'hyper-dimension.geo-campus/v1',id:school.spaceId,version:architecturalSource.version,name:school.name,crs:'LOCAL-SCHEMATIC-HAIDIAN-2018',axes:{x:'east',z:'south',y:'up',unit:'illustrative metre'},originEastingNorthing:[0,0],bounds,terrain:{width:2,height:2,bounds,referenceElevation:0,heights:[0,0,0,0],sourceResolutionMetres:null,displayGridMetres:null,verticalExaggeration:1,status:'flat-artistic; no measured Beijing DEM'},buildings,paths,graph:{nodes,edges},landmarks,sources:[official,source,{id:'official-vr',title:'学校官网链接的海淀校区全景',url:'https://720yun.com/t/b2vkue1es1q?scene_id=38540123',usedFor:'多角度可见建筑体量、屋面、材料与立面特征',credit:'海淀外国语官方网页链接',certainty:'photo-reviewed visible appearance; dimensions and hidden facades estimated'}],assumptions:['以2018年公开总览图复原相对布局；不声称当前建筑外轮廓、房间功能或通行状态已经校方核验。','总览像素采用统一约0.8米的美术比例；高度、屋顶、门窗、树木和铺装为原创概括。','未取得测量高程，使用明确标记的平坦地面；不沿用UW地形。','园区边界、河道和校园桥由同一数据驱动显示、碰撞与路线检查。','学校正式账号、活动、人员、预算和合作服务需在独立部署中配置。'],walkableAreas:[main,south,...bridges],waterAreas:[river],bridges,zones:[{kind:'river',ring:river},{kind:'main-campus',ring:main},{kind:'south-campus',ring:south}],planTransform:{originPixel:[480,405],metresPerPixel:.8,scaleStatus:'artistic estimate from historical schematic'},school};
const {createCampusWalking,ringContains}=await import('../public/campus-walking.js');
const walking=createCampusWalking(campus);
for(const p of landmarks){
 let options=[];
 if(!p.buildingId){const a=[p.point[0],p.point[2]];for(let r=0;r<=30;r+=2)for(let t=0;t<16;t++){const x=a[0]+Math.cos(t*Math.PI/8)*r,z=a[1]+Math.sin(t*Math.PI/8)*r;if(walking.allowed(x,z))options.push([x,walking.height(x,z),z]);} }
 else{const b=buildings.find(b=>b.id===p.buildingId);for(const r of b.rings)for(let i=1;i<r.length;i++){const a=r[i-1],c=r[i],dx=c[0]-a[0],dz=c[1]-a[1],l=Math.hypot(dx,dz);for(const side of [-1,1])for(const off of [3,5,8]){const x=(a[0]+c[0])/2+side*dz/l*off,z=(a[1]+c[1])/2-side*dx/l*off;if(walking.allowed(x,z))options.push([x,walking.height(x,z),z]);}}}
 if(!options.length)throw Error('No exterior arrival: '+p.id);
 options.sort((a,b)=>Math.min(...nodes.map(n=>Math.hypot(n[0]-a[0],n[2]-a[2])))-Math.min(...nodes.map(n=>Math.hypot(n[0]-b[0],n[2]-b[2]))));
 p.arrivalNode=nodes.length;nodes.push(options[0]);
}
campus.geometryHash=protocol.digest(campus);
await save('data/campus.json',campus);
const copy=Object.fromEntries(landmarks.map(p=>[p.id,p.description]));
await save('public/place-copy.js','// Published Haidian reference; historical layout is explicitly bounded.\nexport const PLACE_COPY='+JSON.stringify(copy,null,2)+';\n');
const knowledge=landmarks.map(p=>({id:'haidian-'+p.id,title:p.name,body:p.description,keywords:[p.name,p.id,p.nameZh,p.category,'海淀外国语'].filter(Boolean),published:true,revision:1,sourceLabel:p.sourceIds[0]==='school-official'?official.title:source.title,entityId:p.id}));
knowledge.push({id:'haidian-school',title:'海淀校区介绍与地址',body:'北京市海淀外国语实验学校海淀校区地址为北京市海淀区杏石口路20号。学校办学思想是融中西教育之所长，校园提供语言、科技、艺术、运动和自然体验空间。这里复用Hyper Dimension-UW的完整前后端功能。',keywords:['学校','地址','海淀','北京','介绍','哪里'],published:true,revision:1,sourceLabel:official.title});
await save('data/reception.json',{format:'haidian.reception-binding/v1',knowledge,agents:[{agentId:'haidian-reception',name:'海淀外国语空间接待',description:'海淀校区资料与校园导览',skills:['space.information','haidian.campus.route']}]});
await save('data/space.json',{schema:'hyper-dimension.geo-campus/v1',spaceId:school.spaceId,name:school.name,geometry:'campus.json',reception:'reception.json',geometryHash:campus.geometryHash,host:'Haidian school copy of UW outdoor adapter'});
await save('deploy/schools.json',[{schoolId:school.id,spaceId:school.spaceId,name:school.name}]);
// Photographs are independently reviewed content, not generated campus geometry.
// Preserve their manifest across builds; a fresh uncurated fork starts empty.
try{await access(join(projectRoot,'public/assets/place-photos/manifest.json'));}
catch(error){if(error.code!=='ENOENT')throw error;await save('public/assets/place-photos/manifest.json',{});}
// Garden positions are deliberate schematic planting, never a purported tree survey.
const trees=[];
const addTree=(px,pz,kind='broadleaf')=>{const [x,z]=xy([px,pz]);if(!walking.allowed(x,z)||buildings.some(b=>Math.hypot(b.centroid[0]-x,b.centroid[1]-z)<9||b.architecture?.walkSurfaces.some(s=>ringContains(x,z,s.rings[0]))))return;trees.push({id:'haidian-tree-'+trees.length,point:[x,z],x,z,kind,crownWidth:kind==='conifer'?5:6.5,height:kind==='conifer'?11:8,species:'artistic planting',positionStatus:'schematic',dimensionsStatus:'inferred'});};
for(let z=70;z<432;z+=14){addTree(486,z);addTree(679,z,z%28===0?'conifer':'broadleaf');}
for(let x=500;x<676;x+=15)addTree(x,68,'conifer');
for(let x=178;x<463;x+=15)addTree(x,737);
for(let z=455;z<733;z+=14)addTree(156,z,'conifer');
for(const [x,z]of [[499,353],[505,370],[498,403],[511,423],[535,426],[547,402],[547,382],[522,342],[524,362],[530,385],[563,611],[592,626],[613,646],[643,654],[663,670],[689,690],[444,649],[409,637],[365,643],[319,626],[256,578],[220,563],[180,564],[375,616],[393,598]])addTree(x,z);
await save('public/campus-landscape-data.js','export const LANDSCAPE_SOURCE='+JSON.stringify({geometryHash:campus.geometryHash,trees,benches:[],sources:[source,official]})+';\n');
const dataFiles=[];
for(const path of ['data/campus.json','data/reception.json','data/space.json','data/haidian-architecture.json','data/haidian-place-photos.json','public/assets/place-photos/manifest.json']){
 const bytes=await readFile(join(projectRoot,path));dataFiles.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await save('DATA-MANIFEST.json',{format:'haidian.data-manifest/v1',version:architecturalSource.version,geometryHash:campus.geometryHash,files:dataFiles});
console.log(JSON.stringify({school:school.spaceId,buildings:buildings.length,landmarks:landmarks.length,trees:trees.length,geometryHash:campus.geometryHash}));
