# 包结构与用途

当前主流程是根目录 `DEVELOPMENT-MANUAL.md`，完整校园页面入口是 `CAMPUS-START.md`。v0.8.3 的文档验收与 v0.8.2 的运行实测分开记录。Base核心和历史M0/M1/M2版本保持；现有交付ZIP、学校私有项目和用户库不覆盖。实际文件以 `PACKAGE-MANIFEST.json` 为准。当前Ubuntu/Hermes验证见 `evidence/ubuntu-hermes/ACCEPTANCE.md`，历史Hermes验证见 `evidence/hermes-sessions/ACCEPTANCE.md`，接待与校园连接见 `evidence/network/ACCEPTANCE.md`，其余历史范围保留在各自evidence目录。

```text
Hyper-Dimension-Base-Campus-v0.8.3/
├─ START-HERE.md / AGENT-START.md      用户一句话引导和Agent自动发现入口
├─ DEVELOPMENT-MANUAL.md             人类与Agent统一开发/验证/打包手册
├─ docs/DOCUMENTATION-MAP.json        当前/历史文档分类与版本
├─ tools/verify-docs.mjs              入口、链接、锚点与文档分类校验
├─ CAMPUS-START.md                    完整校园模式、功能入口与边界
├─ AGENTS.md                          续建、权限、数据与证据契约
├─ PACKAGE-MANIFEST.json              全部公共文件的大小、SHA-256和候选范围
├─ README.md / PACKAGE-STRUCTURE.md   功能概览和本说明
├─ M0/M1/M1-SOCIAL/M2-START.md        保留的历史里程碑入口
├─ package.json / package-lock.json  Base生产与开发依赖固定版本
├─ src/
│  ├─ protocol / a2a / reception     协议、Agent任务与公开接待
│  ├─ knowledge / spatial / core     资料向量库、同源模型导航、状态持久化
│  ├─ avatar                        保留版本的原创部件与确定性人物生成器
│  └─ platform                      账号、权限、社交、论坛、活动、账本、奖励、合作
├─ assets/avatars/                   v1/v2/v3目录、部件、模型摘要、授权与来源
├─ public/                           浏览器空间及全部业务界面、本地运行库
│  └─ admin/                        React-admin预构建JS、构建摘要及链接许可证
├─ admin/                            React-admin源码、独立package与lock、构建脚本
│  └─ THIRD-PARTY-LICENSES.json      打包时收集的前端依赖许可正文与固定版本
├─ examples/                         原创双校、公开资料、A2A及虚构运营模板
├─ models/bge-small-zh-v1.5/         中文ONNX/分词器/模型来源许可与摘要
├─ database/                        业务追加迁移、向量SQL、独立数据库示例
├─ integrations/                    固定版本清单、Keycloak主题、Nakama和NodeBB插件
│  └─ hermes/                      固定官方源码归档、uv安装器轮子及许可证来源
├─ deploy/Dockerfile.hermes         固定Python 3.13及Hermes核心依赖的服务器镜像
├─ deploy/compose.hermes.yaml       仅向Base服务挂载接待模型密钥的编排叠加配置
├─ config/                          数据库、Embedding与接待配置模板（无真实密钥）
├─ tools/                           初始化/启动/备份/恢复/建模/打包/完整性校验
├─ prompts / templates/             Agent建校、美化、资料导入和交接流程
├─ schemas / tests/                 规范、单元、接口、并发、浏览器和故障验证
├─ docs/                            启动/Ubuntu部署/模块使用/接口/限制与运维
├─ node_modules/                    按Base锁文件收集的生产依赖和原许可证
└─ evidence/                        经筛选的历史与当前校园检查范围和结果
```

管理台源码独立锁定依赖，预构建前端无需服务端再次编译。`admin/node_modules`与Base开发依赖不在包内；需修改前端时按锁文件安装开发环境。pg-boss是校园生产依赖，数据库任务表随业务库备份。NodeBB及桥接插件仍是独立GPL组件，不变成Base的MIT资产。

## 运行中生成的内容

| 目录或对象                  | 用途                                       | 对外分发边界                     |
| --------------------------- | ------------------------------------------ | -------------------------------- |
| `projects/<school>/`        | 学校场景、美术、公开资料与解读交接         | 单独按学校授权分发               |
| `.private-inputs/`          | 原始图纸及资料                             | 默认不分发                       |
| `.local*/`、服务 `private/` | 凭据、模型配置、运行状态                   | 不进入通用ZIP                    |
| PostgreSQL/Nakama/NodeBB库  | 账户、消息、活动、账本、权益、受控附件权威 | 只进入受控完整备份               |
| `dist/`、`qa/`              | 可复建导出和未筛选开发证据                 | 不整体分发；审核后复制到evidence |
| 原封存ZIP和私有Plan14包     | 历史交付与用户学校项目                     | 保持原件，不由校园包装器覆盖     |

## 打包与外部依赖

先运行 `node tools/campus-pack.mjs --plan NEW_MANIFEST.json`，查看文件、摘要、总大小和缺失的验收记录，不生成ZIP。经交付审查后 `--out NEW_ZIP.zip` 才写新包，禁止覆盖原文件。完整性检查使用 `node tools/verify-package.mjs`。

公共应用包不是整机镜像：Node/Java/PostgreSQL及pgvector、Keycloak、Nakama、NodeBB、Python、Hermes按需要安装。外部服务固定来源与安装入口随包附带；个人密钥、学校账号和数据始终不捆绑。普通轻量示例使用 `npm start`；完整校园模式按 `CAMPUS-START.md` 与 `docs/DEPLOYMENT.md`。
