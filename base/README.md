# Hyper Dimension Base

**把平面图和公开资料交给 Agent，逐步搭建可进入、可导航、可接待和可运营的校园空间。**

这是独立于原 Hyper Dimension 游戏的学校通用底座。学校建筑、资料、美术与展示内容保存在空间包；共同协议、账号、权限、A2A 和运营逻辑由 Base 提供。

当前交付为**校园扩展 v0.8.3**，运行时沿用 v0.8.2。本版统一入口是 [开发手册](DEVELOPMENT-MANUAL.md)，覆盖人工与 Agent 的开发、验证及打包流程；历史文档不作为当前状态依据。第一入口 [START-HERE.md](START-HERE.md)，完整账号模式从 [CAMPUS-START.md](CAMPUS-START.md) 开始。原 Base 核心 v0.2.1 和历史 M0/M1/M2 交付入口保留；当前状态、完整恢复与未验证项以本轮验收记录为准，不能从单项测试推断全 P0 完成。

集成扩展见 [INTEGRATIONS-START.md](INTEGRATIONS-START.md)：合作业务 Agent 的限定委托 A2A、Ubuntu 全栈容器、资料自动向量更新，以及按当前权限检索审核后的论坛历史。私有论坛不进入公开接待知识库。

年度运营见 [ANNUAL-OPERATIONS.md](docs/ANNUAL-OPERATIONS.md)：按学年、年级、事件类别与公私域渠道整理参考情境；负责人安排分工、核对日期并另行创建活动草稿，成员自愿保存私有行动清单。ABC 参考等级不参与贡献计分。支持只读材料转换与逐项来源核对、适用分支和学生需求展示、分页筛选及跨页安排分工。

## 一句话交给 Agent

上传 ZIP，直接问：“这是做什么用的？怎么用？”

能读取文件的 Agent 会按 [AGENT-START.md](AGENT-START.md) 解释用途，帮助选择看示例或搭建学校，再自行读取流程、配置环境、建模与验证。图纸、获准公开资料和美术可逐步补齐；原型之后继续按 [美化清单](prompts/04-VISUAL-POLISH.md) 完善风格、导览、家具、灯光和展示内容。

## 四个 Base

| 模块              | 当前功能入口                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Base-1 空间与接待 | 稳定空间/场景/房间 ID、同源几何与导航、A2A任务及回执、公开资料接待、Hermes/模型适配、PostgreSQL/pgvector           |
| Base-2 人物与关系 | 版本化原创部件库、捏人与服务端存档、背包轻道具、作品/组织/徽章可见范围、联系同意、私信与讨论                       |
| Base-3 共创与运营 | NodeBB原生正文、分类与正文搜索、地点记忆、审核举报申诉、活动与志愿、规则/时期/排名、奖励、版本化运营模板、订阅通知 |
| Base-4 合作服务   | 入驻/服务/权益审核、明确授权预约工单、外部回执与对账、受控核销、范围内统计                                         |

Base 提供简单部件编辑、行动及存档，学校提供美术；已有模型作为占位与旧存档兼容样例，见 [素材适配](docs/AVATAR-SCHOOL-ART.md)。人物原 v1 的 24 部件及配方保留；v2 增补为 3 体型、8 发型、6 上装、6 下装、4 鞋、3 有形眼镜、6 有形配饰（另有“无”选项），v3 追加受奖励资格限制的外观。旧版本不静默迁移。详见 [目录兼容](docs/AVATAR-EXTENSION.md)、[奖励](docs/REWARDS.md)。

## 选择运行模式

### 先参观空间示例

需要 Node 22.13+，推荐固定 Node 24 LTS。完整 ZIP 已附生产依赖与浏览器运行库：

```sh
node tools/base.mjs doctor
npm start
```

打开 `http://127.0.0.1:4180`。源码首次安装先执行 `npm ci --ignore-scripts` 和 `npm run setup`。`npm start` 是 Base-1 参考模式，不启动学校账号、论坛或完整运营服务。

### 完整校园账号模式

后端为 Ubuntu，前端为浏览器；需要 PostgreSQL、Keycloak、Nakama、NodeBB 与 Java 21。用新目录和数据库命名空间初始化，按 [部署说明](docs/DEPLOYMENT.md) 执行 `tools/campus-init.mjs` 与 `tools/m0-services.mjs`。管理台包含 React-admin 开源版与同一后端权限检查，生产定时任务采用 pg-boss。

校园包附应用源码、生产依赖和预构建前端，不包含外部服务整机镜像、个人模型密钥、真实账号或数据库。旧实例升级先完整备份，恢复到新命名空间验证，保留原包与数据。

### 继续搭建学校

```sh
node tools/base.mjs scaffold --id my-campus --out projects/my-campus
node tools/base.mjs build --space projects/my-campus/space.json
node tools/base.mjs verify --space projects/my-campus/space.json
```

接手 Agent 读取 [建校流程](prompts/00-BUILD-SCHOOL.md) 与 [项目契约](AGENTS.md)。图纸解读必须记录尺寸、推定和未知项；简化体块不是精确 CAD/BIM 成果。

## 接待与资料

Embedding 将获准资料转换为向量，回答模型负责交流与组织答案，两者独立配置。可使用包内中文 ONNX 模型或既有 Embedding 服务，存储支持 PGlite 或独立 PostgreSQL＋pgvector。Hermes 是可接入的本地 Agent 运行时，可使用联网模型；未配置回答模型时明确显示资料接待。学校事实依据已发布资料，私人文件、私信和草稿不自动进入公共知识库。

## 导航

| 目标                   | 文档                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| 当前校园入口           | [CAMPUS-START](CAMPUS-START.md) · [包结构](PACKAGE-STRUCTURE.md)                                    |
| Ubuntu部署与保留旧实例 | [部署](docs/DEPLOYMENT.md) · [账号与恢复](docs/M1.md)                                               |
| 学校建模与美术         | [Agent工作流程](docs/AGENT-WORKFLOW.md) · [美化](prompts/04-VISUAL-POLISH.md)                       |
| A2A与资料接待          | [协议](docs/PROTOCOL.md) · [知识库](docs/KNOWLEDGE.md) · [本地Agent](docs/LOCAL-AGENT.md)           |
| 社区活动运营           | [社区](docs/COMMUNITY.md) · [活动](docs/ACTIVITIES.md) · [运营模板](docs/OPERATIONS.md)             |
| 空间协作与后台任务     | [环境角色](docs/ENVIRONMENT-ROLES.md) · [Agent角色](docs/AGENT-ROLES.md) · [持久任务](docs/JOBS.md) |
| 贡献、奖励、合作       | [账本](docs/CAMPUS-LEDGER.md) · [奖励](docs/REWARDS.md) · [合作](docs/PARTNERS.md)                  |
| 历史里程碑             | [M0](M0-START.md) · [M1](M1-START.md) · [通信](M1-SOCIAL-START.md) · [M2](M2-START.md)              |

实际运营材料通过版本化配置导入；材料没有给出的权重、预算和学校硬日期仍由学校确认。个人 Agent 长期记忆不属于本 Base。页面接待按用户、学校、接待 Agent 隔离会话，默认保留30天，学校可配置，用户可导出与删除；后台管理政策和最小诊断，不任意读取他人对话。校友发现、学长支持预约和职业机会见 [接待与校园连接](docs/RECEPTION-AND-NETWORK.md)：本人自愿提交、后台审核、页面与建筑点位共享权限。复杂交易与跨校地区社群仍暂缓。真人运营、物理多设备、真实合作系统与目标服务器上线未执行时保持未验证。

Base原创代码与资产为 MIT；NodeBB及桥接插件保留独立GPL许可，第三方依赖各自许可随包保留。原图纸、学校私有项目、账号密钥与用户数据默认不进入通用包。
