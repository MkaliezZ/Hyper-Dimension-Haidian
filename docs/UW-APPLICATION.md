# UW 校园空间 · v0.11.3

新增“我的 A2A 任务”：从校园服务、Agent目录或NPC面板查看本人任务，按Agent和状态筛选、翻页、查看当前结果、导出回执，并确认停止未完成的执行。入口为 `/agent-tasks.html?school=uw`，使用现有学校账号登录。操作说明见 [任务工作台](../docs/A2A-TASK-WORKBENCH.md)，四个Base的当前功能与后续接入见 [功能对照](../docs/BASE-FEATURE-AUDIT-20261102.md)，开发从 [当前交接](../docs/CURRENT-DEVELOPMENT-0113.md) 开始。

## 已有校园能力 · v0.11.1

校园 NPC 的地标介绍使用已发布的校园资料，与自由角色扮演分开处理；Red Square、The Quad 及周边建筑保持明确区分。六个固定点位、NPC 索引、真实对话和原有功能入口继续保留。开发交接见 [当前说明](../docs/CURRENT-DEVELOPMENT-0111.md)。

后台演示为主动对话预留额度；对话额度用完时会显示提示，地图定位和校园功能仍可使用。

# UW 校园空间 · v0.11.0

新增[校园 AI 同学](../docs/CURRENT-DEVELOPMENT-0110.md)：功能栏和校园服务提供“NPC 索引”，列出 6 位角色的位置、职责与功能。角色固定在校园点位，可从索引、人物或名字选择交互，使用快捷话题、自由对话和对应校园功能入口，也可导出或清除自己的对话。正式校园模式沿用私有配置中的 DeepSeek 官方 API；启动与部署方式继续见现有手册。

# UW 校园空间 · v0.10.6

上一版已接入[全楼体地点功能与实景照片](../docs/CURRENT-DEVELOPMENT-0106.md)。全部 74 栋可选建筑均可进入详情与地点记忆等校园功能；9 处原地标编号保留。照片按独立来源清单匹配，未收录实景图的地点直接留空。启动、部署及 Base 开发方式沿用下面现有手册。

# UW Pixel Campus · Hyper Campus v0.10.5

本版复核四个 Base 的现有功能，修复奖励徽章到期后误显示为撤销的问题。开发入口见 [v0.10.3 验收与修复](../docs/CURRENT-DEVELOPMENT-0103.md)，最终逐项结论见交付包外 HANDOFF.md。

登录后的一小时会话支持服务端自动续期，刷新学校页面保留账号与学校身份。更新旧版本后请重新登录一次；会话凭据留在服务端，浏览器使用 HttpOnly Cookie。退出、账号停用和学校撤权继续生效。详见 [登录与续期说明](../docs/CURRENT-DEVELOPMENT-0102.md)。

本版修复地标留言：地图地点自动关联、登录后返回原地标、一键保存并提交、草稿/附件恢复、待审投稿查看及发帖间隔提示；业务界面使用独立样式，修复奖励工作台快速点击无响应和弹窗焦点。当前界面记录见 [v0.10.1 UI 修复](../docs/CURRENT-DEVELOPMENT-0101.md)。

已有校园能力与技术验收见 [v0.10 接入记录](../docs/CURRENT-DEVELOPMENT-0100.md)及[四个 Base 验收](../evidence/full-base-v0100-20261030/ACCEPTANCE.md)。旧交付包和用户数据保留；新 ZIP 的最终核验见包外交付 HANDOFF。

以 UW Seattle 中央校园为原型的**斜视像素校园**。74 栋建筑使用同一套按真实轮廓建立的度量几何、立面材质和光照；重点建筑与其他楼体共用画风。楼体和平面图按同一比例投影，不单独拉伸建筑插画。固定视角的立体场景离线烘焙为颜色/深度分块，由 Canvas 2D 显示；浏览器不加载实时 Three.js / WebGL。北向地图保留在小地图中。

本版使用既有 Hyper Dimension Base 功能，是独立的学校项目，**不是 UW 官方产品**。真实建筑轮廓、庭院、位置和公开步道保留；像素细节属于视觉概括，不是建筑测绘或实时校园状态。

## 开始使用

完整解压 ZIP，安装 Node.js 22.13+，进入目录：

    node scripts/verify-package.mjs
    node scripts/verify.mjs
    node server.mjs

打开 **http://127.0.0.1:4190/**。Windows 可双击 START-UW.cmd，Ubuntu 可运行 sh start-uw.sh。首次选择形象后进入校园；WASD / 方向键或屏幕方向按钮移动，拖动平移，滚轮缩放。“找到我”恢复人物跟随，“⌂”查看全图。WASD 按屏幕方向移动；小地图点击只移动视角。缩放采用 12 档、最近邻采样，上限 2 倍，不会无限放大整张校园图片。

无需安装 GIS、数据库或模型密钥即可使用公开参观模式。账号、论坛、私信、背包等学校业务使用 Ubuntu 完整模式，见 [启动与部署](../docs/DEPLOY-UW.md)。轻量模式数据在 .local/uw-runtime；完整模式以独立 Docker runtime/PostgreSQL/backups 卷及 Linux 私有配置为准。换包和更新镜像时保留这些数据，不要用旧 JSON 覆盖原生数据库。

## 可以做什么

| 功能 | 当前内容 |
| --- | --- |
| UW 像素校园 | 74 栋真实轮廓、5 个庭院孔洞、9 处地标；保持 Red Square—Suzzallo 的邻接、Drumheller—Rainier Vista 轴线与 The Quad 围合 |
| 统一校园美术 | 74 栋按同一比例、材质和光照建模；哥特式长窗、砖墙石框窗、现代玻璃柱廊与圆拱窗；Suzzallo 主附楼、Denny 钟鼓/铜顶、红场三塔、喷泉/花坛和 Quad 樱花；地标卡片从同一套场景几何渲染 |
| 校园景观 | 按 UW 官方 GIS 点位展示 2,597 棵树和 439 张在用长椅；不随机撒树；喷泉环道、弧形花坛、通行开口、池沿与喷雾；显示尺寸/花坛造型为美术推定，见 docs/LANDSCAPE-090.md |
| 人物 | 48×64 精细人物、7 类 38 部件、4 套预设、八向站立/行走/挥手、正确横向步态和柔和人物细节；地图人物缩为初始版本约 59.5%（比上一版再小15%），部件卡使用局部放大预览 |
| 保存与恢复 | 服务端存档、冲突和重复请求保护、换装历史。旧 v1–v5 形象保留，只读展示为像素版；点击保存才写入新版本 |
| 探索与导览 | 81 对地标路线、公共步道连接与 A* 绕障；从实际位置连续续走，每段扫掠检查墙、庭院、水池、道具和边界。7.8m/s 自由漫游、23.4m/s 导览、中途停止与刷新/重启恢复 |
| 遮挡与点击 | 楼体、树木、设施按每个像素的可见表面处理；人物被挡住时显示细轮廓。点击楼体后高亮可见楼面，并持续显示名称与来源卡片；重点地标可打开详情、步行前往，手机端也可查看。未命名楼体标明待补名称 |
| 背景与边界 | 像素天空、白云和装饰远山；绿篱标出体验范围，无法走出边缘。装饰不是新增地理范围 |
| 接待 Agent | 已发布校园资料和引用；配置 Hermes 后支持通用对话。独立访客/账号会话，默认 30 天，可导出、删除 |
| 外部 Agent | Base Protocol / A2A 接口和官方 SDK 调用样例；访客使用自己的 Agent，不限制为 Hermes |
| 完整校园业务 | 正式账号、学校和组织权限、背包/非破坏互动、同意后私信/聊天、论坛审核/历史、活动、贡献/排名、学生会运营、校友/学长/机会、合作方服务、空间反馈 |
| 信息管理 | 已发布知识自动向量索引与撤回，论坛历史按学校/组织权限检索，完整备份与新目标恢复；私人消息不会自动进入公开接待知识 |

“校园服务”显示实际连接状态；未连接或未登录的业务不会伪装成可用。完整模式继续由后端检查学校、组织、角色与地点权限。运营材料、校方批准、真实邮件/域名和商家履约需由部署方配置。

校园服务按 Base 1–4 分组，可筛选空间与接待、人物生活、社区运营和周边合作。点击地图地标后，可直接打开“社区与活动”或“背包与互动”；论坛、背包、校友支持和空间反馈会带入已核对的地点。界面正文、按钮、接待对话与人物编辑采用更大的字号，窄屏操作栏自动换行。当前功能接入记录见 [当前 Base 接入进度](../docs/CURRENT-DEVELOPMENT-0100.md)。

## Hermes 与完整部署

服务端接待使用固定 Hermes，推理可以使用线上 DeepSeek；这不是本地离线大模型。新 ZIP 不包含本机密钥、个人 Hermes 记忆或用户会话。

按 [部署说明](../docs/DEPLOY-UW.md) 和 [本地 Agent 配置](../base/docs/LOCAL-AGENT.md) 设置当前数据目录内的私有 reception.json，密钥用环境变量 DEEPSEEK_API_KEY 注入。无配置时明确显示资料模式；已配置但缺密钥会拒绝启动。

Ubuntu 全栈使用随包 Docker 编排与固定 Keycloak、PostgreSQL/pgvector、NodeBB、Nakama、pg-boss、BGE ONNX 和 Hermes。通用能力见 [底座开发手册](../base/DEVELOPMENT-MANUAL.md)。

## 包结构

    UW-Pixel-Campus/
    ├─ README.md / AGENTS.md          人类与 Agent 阅读入口
    ├─ START-UW.cmd / start-uw.sh      启动
    ├─ server.mjs / src/              身份、Protocol/A2A、接待、空间状态
    ├─ public/
    │  ├─ app.js / pixel-scene.js      分块斜视校园、遮挡、小地图和行走
    │  ├─ oblique-layout.js            地图投影、缩放和小地图坐标
    │  ├─ depth-scene-atlas.js / surface-depth.js  分块场景、深度采样与人物遮罩
    │  ├─ pixel-campus-art.js          真实轮廓和道路的像素绘制
    │  ├─ pixel-avatar-v3.js / pixel-editor.js  八向人物、动作、部件预览和存档
    │  ├─ pixel-avatar.js              原始 v4 存档摘要兼容，不改字节
    │  ├─ viewport-cache.js / avatar-view.js  亚像素视角缓存与地图人物比例
    │  ├─ pixel-items.js / inventory.* 背包和像素轻道具
    │  ├─ pixel-ui.css                校园及原生业务界面
    │  ├─ assets/coherent/            当前统一颜色/深度分块、立面材质和同源地标卡片
    │  ├─ assets/oblique/ / buildings/ 旧版素材与来源保留，不用于当前楼体
    │  ├─ assets/avatars-v3/           八向人物帧表和 38 个部件局部图
    │  └─ assets/pixel/               图鉴、地图、人物帧表、部件、道具与来源
    ├─ data/                         公开派生几何、高程、接待知识
    ├─ deploy/                       Ubuntu 全栈与恢复编排
    ├─ scripts/                      素材导出、核验、打包、A2A 样例
    ├─ docs/COHERENT-CAMPUS-090.md      当前开发、材质、深度、寻路与打包手册
    ├─ tests/ / evidence/             自动检查和注明范围的证据
    ├─ compat/3d-v052/                离线旧存档兼容代码
    └─ base/                         完整底座学校副本及原许可证

base/ 通用模板和历史渲染代码保留以保护旧配方及封存凭据；当前 UW 页面不加载这些 3D 入口。公开来源 PDF、照片、整县地形、密钥、账号库和会话不分发。

## 交给 Agent 继续开发

把完整目录或 ZIP 交给 Agent，可以直接问“这是做什么用的？怎么用？”。续建提示词：

> 先读 README.md、AGENTS.md、docs/COHERENT-CAMPUS-090.md，再读 base/DEVELOPMENT-MANUAL.md。当前 UW 使用统一度量几何烘焙的像素校园、逐像素深度和部件人物，北向地图作小地图。保留 Base 功能、学校/点位标识、权限、用户存档和旧交付；核对真实来源后实现我接下来描述的需求。美术、轮廓、颜色与深度必须同步生成；不得把重点建筑独立拉伸，也不恢复旧实时 3D 入口。给出实际验证、新版本完整包和保留数据的方法。

技术验证与范围在 [当前手册](../docs/COHERENT-CAMPUS-090.md)、[验收清单](../docs/PIXEL-GOAL-CHECKLIST.md)。浏览器和自动检查不等于真实学生、物理多设备或正式 UW 服务器验收。
