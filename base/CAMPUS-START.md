# 完整校园模式 · v0.8.3 交付入口

**统一主流程：[DEVELOPMENT-MANUAL.md](DEVELOPMENT-MANUAL.md)**。v0.8.3 整理开发手册、历史范围标记、文档校验与打包入口；运行时沿用 v0.8.2，分别记录[文档验收](evidence/documentation/ACCEPTANCE.md)与既有运行实测，不声称本版重跑全栈。

本目录是校园扩展 **v0.8.3**，沿用 Base 核心 v0.2.1。接待默认30天/学校配置、本人导出删除、自愿校友发现、学长支持预约与职业机会沿用 v0.8.0，见 `docs/RECEPTION-AND-NETWORK.md` 与 `evidence/network/ACCEPTANCE.md`。v0.8.2补齐从完整ZIP构建Ubuntu全栈及Hermes镜像、冻结的Hermes源码、独立Python、私有模型密钥挂载和相应验证工具，当前容器验证记录见 `evidence/ubuntu-hermes/ACCEPTANCE.md`；历史本机Hermes验证见 `evidence/hermes-sessions/ACCEPTANCE.md`。配置见 `docs/LOCAL-AGENT.md` 与 `docs/DEPLOYMENT-CONTAINERS.md`。个人 Agent 长期记忆不在本 Base 范围。原有限定委托的合作业务 A2A、自动向量/受控论坛历史、学年运营与个人自愿行动均保留；旧交付包与历史证据不覆盖，不将历史独立 Agent 验证当成本版重新接包。真实学校、目标服务器、正式邮件与合作履约仍须实际配置和验收。

优先读 [容器启动](docs/DEPLOYMENT-CONTAINERS.md)、[业务 A2A](docs/PARTNER-A2A.md)、[自动索引](docs/AUTOMATIC-INDEXING.md)、[年度运营](docs/ANNUAL-OPERATIONS.md)。学校自有材料通过私有转换、负责人预览、导入和启用承接；原附件不进入通用包。运营权重、预算、真实日期和商户条件由学校确认。

人物分工：Base保留部件搭配、行动、互动校验与持久化；学生会提供学校人物美术。既有原创人物作可运行占位及旧存档兼容样例，不再默认扩充款式。替换规范与生成提示见 [学校人物美术](docs/AVATAR-SCHOOL-ART.md) 和 `prompts/05-AVATAR-LIBRARY.md`。

四个 Base 的当前功能、技术选型与未做范围集中见 [CURRENT-FEATURES.md](docs/CURRENT-FEATURES.md)。

新增页面：`/network.html`（发现目录、支持预约、职业机会及有权管理员后台）、`/reception-admin.html`（学校负责人配置会话期限、管理员最小诊断）。房间详情也可进入同一地点的校园连接。完整校园功能需要Ubuntu校园模式；单独 `npm start` 仍是Base-1示例。

## 用户一句话开始

将 ZIP 交给能解压、读文件的 Agent，问“这是做什么用的？怎么用？”。Agent 先读 `AGENT-START.md` 与本文，解释用途并引导搭建校园空间。你提供学校目标、图纸、允许公开的资料与美术方向；环境检查、配置、构建与验证由 Agent 逐步执行。

| 模式                | 入口                                                                                       | 范围                                               |
| ------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Base-1 轻量空间示例 | `npm start`，默认 `http://127.0.0.1:4180`                                                  | 本地空间、A2A、接待与资料库；不会启动完整校园服务  |
| Ubuntu 校园模式     | `tools/campus-init.mjs` 初始化新实例，再用 `HD_M0_CONFIG` 和 `tools/m0-services.mjs start` | Keycloak 账号、学校隔离、PostgreSQL 事务与校园模块 |
| 已有学校升级        | 停写备份，恢复到新目录、数据库命名空间和端口后验证                                         | 不覆盖已交付包、原服务、用户库和学校私有项目       |

详细安装见 [部署说明](docs/DEPLOYMENT.md)。M0/M1 是兼容保留的工具名，不表示完整校园模式只支持早期里程碑。

## 四个 Base 入口

| 模块                  | 浏览器入口                                                                                                 | 用途                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Base-1 空间与接待     | `/`                                                                                                        | 公开房间、路线、A2A、公开资料接待                                        |
| Base-2 人物与个人关系 | `/m2.html`、`/profile.html`、`/contacts.html`、`/social.html`                                              | 版本化人物库、存档、轻道具、作品与社区徽章、联系同意、私信与讨论         |
| Base-3 共创与运营     | `/community.html`、`/activities.html`、`/ranking.html`、`/rewards.html`、`/operations.html`、`/inbox.html` | 同源论坛与地点记忆、审核申诉、活动志愿、规则排名、奖励、排期、订阅       |
| Base-4 周边合作       | `/partners.html`                                                                                           | 入驻与服务审核、明确授权工单、权益核销、范围内统计                       |
| 负责人和管理台        | `/m1.html`、`/admin.html`                                                                                  | 学校/组织授权与审计；React-admin 开源界面调用同一受控后端                |
| 空间协作与角色        | `/environment.html`、`/agents.html`                                                                        | 访客问题反馈、维护处理与角色入口；接待/导览等 Agent 能力边界与服务端权限 |
| 持久任务              | `/jobs.html`                                                                                               | 当前获准范围的定时任务和处理状态，沿用幂等回执与审计                     |

是否可写由服务器当前身份、学校/组织权限和模块开关决定。排名、前端按钮和 Agent 回复不会授予权限。未配置外部适配器时不会提交真实预约；演示适配器与真实服务必须明确区分。

## 配置与后续材料

校园私有配置使用 `milestone: "M1"`、`m2Enabled: true`、`campusEnabled: true`、`partnersEnabled: true`。`modules` 可按全局或单校关闭 `base2/base3/base4`；Base-1 保持启用。关闭模块拒绝新写入，原存档、贡献、权益等继续按当前权限保留读取，不删除历史。

- 人物：保留原 v1 资产；v2 补齐基础部件数量；v3 追加受真实奖励资格限制的外观。升级需明确确认，旧配方和模型摘要可重建。
- 运营：附原创虚构的迎新、读书会、志愿、毕业记忆模板。已提供的活动表和需求年历通过私有转换、逐项来源核对、预览及版本导入承接；本校硬日期、批准权重和预算仍须负责人补齐。见 [运营模板](docs/OPERATIONS.md) 与 [材料完成审计](docs/ANNUAL-MATERIALS-AUDIT.md)。导入不自动发奖。
- 资料库：支持 PGlite 或独立 PostgreSQL＋pgvector。TCP 验证使用 PostgreSQL 18.6、pgvector 0.8.1；Embedding 与回答模型证据独立标注，见 [知识库](docs/KNOWLEDGE.md)。
- 本地 Agent：Hermes 使用独立零工具接待会话。未配置回答模型时降级为资料接待，见 [本地 Agent](docs/LOCAL-AGENT.md)。
- 建模和美化：`prompts/00-BUILD-SCHOOL.md`、`prompts/04-VISUAL-POLISH.md`。私人图纸与学校项目不混入通用包。

## 交付内容与边界

校园包装器核对源码、SQL、生产 Node 依赖、浏览器库、原创人物、中文 ONNX 模型、React-admin 源码及独立锁、预构建管理台、许可证、文档、模板和已筛选证据。Node/Java/PostgreSQL/Keycloak/Nakama/NodeBB/Python/Hermes 仍需按固定版本安装，ZIP 不是整台离线服务器镜像。

`node tools/verify-package.mjs` 校验包内 SHA-256，不代表真实学校验收。先用 `node tools/campus-pack.mjs --plan NEW_MANIFEST.json` 生成待审清单；交付检查完成后才用 `--out NEW_ZIP.zip`，已有文件拒绝覆盖。

历史 M0/M1/M1-SOCIAL/M2 启动文档作为原里程碑说明保留，其“后续阶段”描述只针对当时版本。当前能力优先以本文、新功能文档和本次验收矩阵为准。校友/导师/职业目录已在 v0.8.0 补齐；个人 Agent 长期记忆已按用户要求移出范围。P2 地区/跨校社群与复杂交易仍暂缓。
