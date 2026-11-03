# v0.11.0 · 定点校园 AI 同学

功能栏新增“NPC 索引”，校园服务的 Base 1 同时提供入口。索引展示六位角色的位置、职责和对应功能；可选择、地图定位、一键话题、自由对话与进入原 Base 模块。手机布局保留同一入口。

按用户最新收口，六位NPC固定在校园点位展示功能：Maya / Kane Hall（课堂与小组项目）、Leo / Suzzallo（学习答疑与学长支持）、Jordan / HUB（社团与活动）、Sam / Communications Building（校园故事与地点记忆）、Aiko / The Quad（新生交流）、Alex / Red Square（校园导览）。点击地图人物、名字或“校园同学”列表即可选择和交互。

当前模式为 stationary。src/npc-cast.mjs 定义角色、固定点、快捷话题与功能入口；src/campus-npcs.mjs 只改变点位内的演示话题、公开意图和状态，所有NPC始终返回 move:null，不创建漫游路线。既有移动原型状态会转为固定点，保留访客存档和私聊。人物继续使用原部件、原显示比例与逐像素建筑遮挡；选中名字高亮，交谈时可挥手。

每个角色提供两项一键话题、自由对话、当前功能/日程和对应校园服务入口。Jordan打开活动、Sam打开该建筑地点留言、Leo打开学长支持与机会、Aiko打开联系人、Maya打开背包，Alex打开现有空间接待。服务入口由原Base验证登录、学校和角色；NPC本身不替访客发帖、报名、计分、私信或提交商户业务。功能演示围绕美国大学的office hours、小组项目、quarter工作量、社团和新生交友展开。

六个独立uw-npc-* Agent复用Base A2A与receptionSessions；按访客/学校账号及角色隔离、刷新/服务重启恢复、本人导出与删除，默认30天并沿用学校配置。公开NPC状态不包含访客正文、用户名或私聊记忆。

用户已明确选择沿用现有DeepSeek官方普通API。src/npc-model.mjs固定调用https://api.deepseek.com/chat/completions，deepseek-flash，非思考模式；公开状态选择采用JSON候选校验。原私有Docker secret仍在Linux内注入DEEPSEEK_API_KEY。Compose设置UW_NPC_PROVIDER=deepseek；轻量启动未设置时只展示角色与日程，不偷偷使用环境Key。

所有NPC共用80次/UTC日的持久模型预算；自动演示决策串行、每角色至少3分钟一次。仅有近期观看/交互时推进；隐藏页面停止轮询，45秒无观察后停止自动推理。每次输出256/440tokens，超时25秒，无任意工具或URL。私聊发送有频率限制，失败不伪造回答。

入口：public/campus-npcs.js/css、npc-renderer.js；public/campus-services.js仅新增指定模块的聚焦显示，原22模块和权限检查保持。原Base、用户人物/位置、旧ZIP、74栋地点功能、41张照片和地图烘焙全部保留。

验证：tests/npcs.test.mjs、全套tests/*.test.mjs，以及evidence/npcs-20261031下的定点浏览器与真实DeepSeek记录。该目录较早的移动原型记录属于开发历史，当前交付以定点验收和外部HANDOFF为准。测试后关闭独立浏览器、隔离容器并删除临时构建文件。
