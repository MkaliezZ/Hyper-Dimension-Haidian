# UW 启动、部署与恢复

适用 UW v0.10.1；进度见 CURRENT-DEVELOPMENT-0100.md。先读根 README；接手开发再读 AGENTS 与 COHERENT-CAMPUS-090。当前学校适配采用 `hyper-dimension.geo-campus/v1`，不是 Base 室内模型。当前人物使用像素部件和同一地图形象；原 Base 目录和旧 v1–v5 配方完整保留。镜像必须包含 compat 目录；当前 Dockerfile 与 .dockerignore 已包含它。旧 3D 美术文档不是当前实现入口。

## 轻量参观

完整解压后安装 Node 22.13+，运行 `node scripts/verify-package.mjs`、`node scripts/verify.mjs`、`node server.mjs`，打开 http://127.0.0.1:4190/ 。Windows 可双击 START-UW.cmd。包含首次建角、地图、路线与公开接待；校园账号、背包、论坛和运营需要下面的完整模式。

运行数据默认在 `.local/uw-runtime`。更换实例时选新目录和新端口。不要复制他人的访问凭据，也不要清空旧目录来解决启动问题。

## Hermes 配置

访客不限定 Agent 品牌；服务器接待使用固定 Hermes 0.19.1 的零工具调用。模型推理可联网使用 DeepSeek，Embedding 是独立的 BGE ONNX，不是 Hermes 的个人长期记忆。

轻量模式按 `base/docs/LOCAL-AGENT.md` 创建当前数据目录中的私有 `reception.json`，填本机 Hermes 根目录和其 Python 解释器。密钥通过 `DEEPSEEK_API_KEY` 环境变量注入。Linux 示例：

```json
{"provider":"hermes","python":"/opt/hermes/.venv/bin/python","hermesRoot":"/opt/hermes","timeoutMs":60000}
```

配置模型后缺密钥会明确拒绝启动。ZIP 不含本机密钥、Hermes 个人配置或用户会话。会话按当前访客/学校账号隔离，默认 30 天；本人可导出、删除，负责人可调整政策。浏览器身份和正式账号分别存储，不自动覆盖旧访客形象。

## Ubuntu 完整校园

需要 Linux amd64、Docker Engine、Compose v2、Python 3、网络和足够磁盘/内存。本机验证使用 WSL Ubuntu，约 6 GB 内存；这不是服务器负载容量承诺。所有服务在回环地址，生产通过 HTTPS 反向代理提供校园和身份域名。

从完整 ZIP 构建固定服务依赖和 Hermes，再构建 UW 学校层：

```sh
docker build --network host -f base/deploy/Dockerfile -t hyper-campus:uw-core base
docker build --network host --build-arg HD_CORE_IMAGE=hyper-campus:uw-core -f base/deploy/Dockerfile.hermes -t hyper-campus:uw-hermes base
docker build --build-arg UW_BASE_IMAGE=hyper-campus:uw-hermes -f deploy/Dockerfile -t hyper-campus:uw-native .
```

嵌入的 `base/PACKAGE-MANIFEST.json` 是当前学校副本清单；原 Base 清单另存 `base/SEALED-BASE-MANIFEST.json`。当前清单明确记录 9 个学校适配源文件与新增模块（含 UW 回环 HTTP 论坛桥接），校验全部打包文件；原 Base 源目录、旧 ZIP 和许可证保留。

先准备不在源码中的私有模型密钥文件。下面只建立全新的虚构测试实例；`--out`、project、namespace 都不能与已有实例重名：

```sh
sudo python3 base/deploy/configure.py --out /opt/uw-new --project hyper-campus-uw-new --namespace uw_new --fixtures --base-port 6190 --idp-port 9190 --forum-port 5577 --nakama-port 9550 --pg-port 55449 --hermes --model-key-file /absolute/private/model-key
HD_STACK_IMAGE=hyper-campus:uw-native docker compose --env-file /opt/uw-new/compose.env -f deploy/compose.yaml up -d --no-build --wait
HD_STACK_IMAGE=hyper-campus:uw-native docker compose --env-file /opt/uw-new/compose.env -f deploy/compose.yaml run --rm --no-deps utility seed-uw-fixtures
```

打开 http://127.0.0.1:6190/ 。空间中的“校园功能”先进行 Keycloak 登录，再按真实学校/组织权限打开人物、背包、私信、论坛、活动、排名、运营、校友支持、机会与合作模块。地图点位与相同业务 API 绑定。`seed-uw-fixtures` 只为隔离测试建立虚构首位负责人；已存在负责人时拒绝重复引导。虚构账号凭据只在运行卷的 `services/private/test-users.json`，不写入公开交付。

正式部署不加 `--fixtures`，使用 `--smtp /absolute/private/smtp.json`、`--public-origin https://campus.example` 和 `--idp-origin https://login.example`。配置真实 SMTP；首次负责人由服务器维护者用 `base/tools/m1-bootstrap-owner.mjs` 绑定到启用且已验证邮箱的账号，然后通过邀请加入成员。不能使用虚构账号作为正式学校负责人。没有真实邮件、域名、学校批准或商家适配时，不宣称相应生产验收已完成。

该学校模式是 `uw / uw-seattle` 单学校实例，产生 Base、Keycloak、UW Nakama、UW NodeBB、knowledge **5 个数据库**。旧 north/south 模板是 7 库；不能按固定库数判断完整性，备份脚本按实际配置枚举。

## 公开资料与历史索引

负责人登录 `knowledge.html` 审核并发布本校公开快照。pg-boss 自动执行 BGE ONNX → PostgreSQL/pgvector 索引；未发布内容被过滤。新快照和撤回在当前查询时校验，撤回不等待后台删完向量。

NodeBB 的已审核论坛历史保留独立学校/组织 ACL，可从 `history.html` 检索；不进入公开接待。私信正文只由 Nakama 持有。上线前用学校自己的资料替换测试内容，不能把 ZIP 中来源说明当作当前开放时间或校方政策。

## 备份与新目标恢复

停止 Base、Keycloak、论坛和 Nakama 写入者，保留 PostgreSQL：

```sh
HD_STACK_IMAGE=hyper-campus:uw-native docker compose --env-file /opt/uw-new/compose.env -f deploy/compose.yaml stop base keycloak forum-uw nakama-uw
HD_STACK_IMAGE=hyper-campus:uw-native docker compose --env-file /opt/uw-new/compose.env -f deploy/compose.yaml run --rm --no-deps utility backup create --backup /backups/NEW-NAME
HD_STACK_IMAGE=hyper-campus:uw-native docker compose --env-file /opt/uw-new/compose.env -f deploy/compose.yaml run --rm --no-deps utility backup verify --backup /backups/NEW-NAME
```

备份是私有资料，包含所有配置数据库、文件、户外空间数据与会话，不能放入公开 ZIP。恢复用同镜像 `/app/deploy/restore.mjs`，挂载本项目 runtime/backups 卷及私有 PostgreSQL 管理密码文件，目标选新的 `/runtime/NEW-ROOT` 与新 namespace。临时恢复容器以 root 运行时，需 CHOWN、DAC_OVERRIDE、FOWNER 三项文件权限；不需要 privileged。完整参数参考底座恢复工具与本次 `evidence/full-base-v0100-20261030/ACCEPTANCE.md`。

恢复完成且服务二进制绑定成功后，设置 `UW_RESTORED_ROOT=/runtime/NEW-ROOT`，叠加 `deploy/compose.restore.yaml`，用 `up -d --no-deps --wait keycloak forum-uw nakama-uw` 启动恢复服务。**不要运行 init**。在恢复配置下执行 `/app/tools/m1-relocate-client.mjs`，再启动 base。必须核对稳定账号、人物、背包、原生正文、向量历史、账本、会话和权限后才考虑域名切换。

恢复验证仅证明新目标中的数据与服务。旧实例、备份和旧包继续保留，不能将测试恢复视为生产切换。

## 维护与续建

日常代码验证：`node --test tests/*.test.mjs`、`node scripts/verify.mjs`。完整原生自动检查只用于独立虚构测试实例，入口 `scripts/verify-campus-live.mjs`；会创建帖子、邀请、计分规则和资料快照，禁止在用户实例随意运行。

改嵌入 Base 源码后，先按 `scripts/verify-school-patch.py` 的明确适配范围核对差异，再更新当前学校清单；不能把所有漂移列入允许范围。新打包用 `python3 scripts/pack.py --out /absolute/NEW.zip`，不会覆盖旧 ZIP；检查 CRC、所有 payload SHA、解压启动及相关业务路径。源文件改动后旧包清单不再代表当前工作树。

测试完成用 compose stop 停止本项目服务。不要全局 prune、终止其他 WSL 工作或删除用户数据。当前验收与未验证生产边界见根 README 和本次验收记录。

本轮完整恢复还以 `tools/m1-snapshot.mjs` 对比全部源/目标表的计数和摘要。旧 `verify-restored-campus.mjs` 面向最初九条用例；增加原帖审核后可能出现零分审计行，应捕获真实冻结源库基准，不能为了满足旧的单行假定修改账本。当前例子见本轮 `verify-restored-current.mjs` 及其来源记录。
