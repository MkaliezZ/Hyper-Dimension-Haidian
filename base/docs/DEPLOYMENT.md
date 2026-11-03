# 部署与运行：空间示例 / Ubuntu 校园模式

`npm start` 只运行 Base-1 空间示例。正式账号、人物、私信、论坛、活动、排名、运营和合作功能需要 Ubuntu 校园服务。当前为候选交付；本机隔离测试不等于实际目标服务器部署、真实邮件送达或学校试运营。

## 1. 公共包与私有运行环境

公共包包含源码、生产 Node 依赖、Three/VRM 浏览器库、预构建 React-admin、管理台源码/独立锁、原创模型、中文 ONNX 模型、SQL、许可证、安装脚本及筛选证据。开发依赖与 `admin/node_modules` 不捆绑；访问预构建管理台不需要重新编译。

完整校园服务额外需要 Node 24 LTS、Java 21、PostgreSQL、独立知识库所需 pgvector、Keycloak、Nakama、NodeBB。固定版本、来源和哈希在 `integrations/versions.json` 及安装脚本中。SMTP/TLS、账号、合作服务密钥、模型凭据及数据库属于私有配置，不在通用包中。

源码安装：`npm ci --ignore-scripts`、`npm run setup`。完整包先运行 `node tools/verify-package.mjs`，已有生产依赖无需为了参观重新下载。开发测试需按锁文件安装开发依赖。管理台重新构建：`npm --prefix admin ci --ignore-scripts`、`npm --prefix admin run build`；构建后 `public/admin/app.js` 与 `build.json` 摘要须一致。

## 2. Base-1 轻量示例（Windows / macOS / Linux）

在普通可写目录：

```sh
node tools/base.mjs doctor
npm start
```

打开 `http://127.0.0.1:4180`。浏览器资源本地加载，无 CDN 依赖。新学校脚手架：

```sh
node tools/base.mjs scaffold --id my-campus --out projects/my-campus
node tools/base.mjs build --space projects/my-campus/space.json
node tools/base.mjs verify --space projects/my-campus/space.json
npm start -- --space projects/my-campus/space.json --data .local-my-campus
```

此模式状态位于指定目录 `state.json`，凭据在 `access.json`。同一数据目录仅允许一个进程。保留已有目录；锁恢复仅在所记进程已退出且令牌未变化时执行，不终止无关进程。

## 3. 全新 Ubuntu 校园实例

维护者先确认服务目录、数据库前缀和端口尚未使用。系统准备 curl/git/tar/xz-utils、Java 21、PostgreSQL 服务及客户端。安装器拒绝覆盖已有服务目录，核对下载摘要与 NodeBB 固定提交。

```bash
# 从应用源码目录执行；路径和前缀是示例，不能重用现有实例。
bash tools/m0-install-ubuntu.sh /srv/hd-campus-services
export PATH=/srv/hd-campus-services/node/bin:$PATH
export HD_M1_SMTP_FILE=/secure/school-smtp.json
# HD_M0_PG_ADMIN 由本机秘密管理注入，不贴进聊天或源码。
export HD_M1_ORIGIN=http://127.0.0.1:4980
export HD_M1_ISSUER=http://127.0.0.1:8880/realms/hd-m1
export HD_M1_FORUM_PORT=5267
export HD_M1_NAKAMA_PORT=8550
node tools/campus-init.mjs --runtime /srv/hd-campus-services --namespace school_campus
unset HD_M0_PG_ADMIN
export HD_M0_CONFIG=/srv/hd-campus-services/private/config.json
node tools/m0-services.mjs setup
node tools/m0-services.mjs start
```

`campus-init` 只为新实例复用正式账号初始化，再开启 m2Enabled/campusEnabled/partnersEnabled 与模块开关。它不配置外部合作适配器、不批准真实运营规则，也不创建真实学校资料。当前初始化器建立 north/south 两个原创参考学校服务；实际学校需要维护者按稳定 ID、空间包、realm、原生服务配置和数据库对应关系配置并验证，不能把示例换名等同于真实入驻。

正式初始化要求 SMTP 配置；`--fixtures` 仅用于全新隔离测试，会生成虚构账号、测试密码授权与故障注入，不能用于真实学校。SMTP 字段、首位负责人的受控核验与 `tools/m1-bootstrap-owner.mjs` 用法见 `docs/M1.md`。后续成员和负责人交接通过学校/组织邀请与管理页。

打印 READY 后访问 origin；完整入口见 `CAMPUS-START.md`。停止使用 `node tools/m0-services.mjs stop`，只停止核实归属的子进程。工具保留 M0/M1 名称用于兼容，实际模式由私有配置决定。

### 端口与持久数据

上例 Base 4980、Keycloak 8880、NodeBB 5267/5268、Nakama 8550/8650；Nakama 控制台为各自端口＋1，PG 默认 5432。最终以新实例配置为准，先检查冲突，不复制开发机密钥。

- `serviceRoot/private`：连接、账号服务与密钥配置，仅维护者可读。
- `config.dataDir`（通常 base-data）：空间运行文件、接待/知识配置与本地知识库。
- 业务 PostgreSQL：账号映射、A2A 状态、人物、权限、运营、受控附件数据、贡献/权益与事务回执；pg-boss 使用业务库队列 schema。
- 各校 Nakama / NodeBB 数据库：消息与论坛正文权威。
- 独立知识 PostgreSQL：向量和来源，连接须加入备份清单；不能遗漏后声称完整备份。

全局或学校配置 `modules.base2/base3/base4` 可关闭新写入并保留当前权限允许的历史读取，Base-1 保持启用。角色来自服务器当前授权，不来自排名或前端选择。

## 4. 接待、Hermes 与向量库

校园服务使用 config.dataDir 的 reception.json 或受控模型环境变量；Base-1 同理。Hermes 接待使用独立零工具会话，不复制个人工作目录或记忆。模型可以联网，不能称为离线智能。无回答模型时明确降级为资料接待。

Embedding 与回答模型分别配置：前者可用包内 BGE ONNX＋Python 3.11/requirements-embedding.txt，也可用兼容 HTTP Embedding；后者可接本地 Hermes 运行时或直接模型服务。先检查资料发布范围，再导入向量库；私信、个人草稿、原图纸和密钥不进入公开模型上下文。

存储可选 PGlite 或独立 PostgreSQL TCP＋pgvector。TCP 当前验证版本为 PostgreSQL 18.6 / pgvector 0.8.1；合成向量、真实 ONNX、真实回答模型的证据分别列示。配置步骤见 `docs/KNOWLEDGE.md`、`docs/LOCAL-AGENT.md`。密钥通过私有配置注入，不要求用户贴进聊天。

## 5. 已有实例升级、完整备份与回退

1. 保留封存包、原服务与学校项目。停写整套服务，使用 `tools/m1-backup.mjs create` 和 `verify`。失败且无 complete 清单的目录不能恢复。
2. 恢复到新目录、库前缀和端口。备份必须覆盖配置中的全部数据库、队列、附件、模型及空间资料；仅导出业务库或人物 GLB 不构成完整备份。
3. 目标 PostgreSQL 的 vector 扩展由管理员预装。知识库恢复遵守工具的受控参数，不由应用角色删除或覆盖现存生产扩展。
4. 按 `tools/m1-bind-restored-services.mjs` 与 `tools/m1-relocate-client.mjs` 绑定固定服务、新源码和新 origin；已应用迁移只校验，新增迁移追加执行。
5. 在克隆验证重新登录、旧模型/库存/资料、论坛源版本、贡献/权益/回执、队列、附件与向量库，确认克隆写入不影响原库。结果记录在本轮校园验收中。
6. 完成后由部署方切换入口。回退使用保留的旧实例；新数据先备份，不能将新数据库逆向覆盖旧库。

命令完整参数见 `docs/M1.md` 和备份工具 Usage。备份含密钥和私人数据，不进入公共 ZIP。已停写的原始数据与失败恢复现场都应保留。

## 6. 目标服务器正式运行

采用非 root 服务账户、HTTPS 反向代理、实际域名、受限数据库角色、持久磁盘、日志与备份轮换。Base/原生服务默认绑定回环，公网只暴露获准代理入口；Base origin、OIDC issuer/redirect 与代理配置须一致。本机 HTTP 和测试 SMTP 不代替真实部署验证。

合作适配器经服务器配置与用户明确确认才可转交最小字段；未接通时保持不可用，未知外部结果查询对账而不重复下单。自动化中的虚构银行/运营商/餐厅不代表真实合作系统。模型不自动获得发奖、核销、账号管理权限。

当前开发与交付流程统一见 [开发手册](../DEVELOPMENT-MANUAL.md)。v0.8.3 文档验收在 `evidence/documentation/ACCEPTANCE.md`，继承的 v0.8.2 Ubuntu/Hermes 实测在 `evidence/ubuntu-hermes/ACCEPTANCE.md`；`evidence/campus` 保留早期范围和20分钟操作卡。目标服务器容量、实际学校运营效果与物理多设备不能由本机检查外推。
