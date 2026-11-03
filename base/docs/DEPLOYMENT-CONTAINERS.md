# Ubuntu 全栈容器

本模板将 PostgreSQL/pgvector、Keycloak、两个隔离学校的 NodeBB、两个 Nakama 和 Base/队列 worker 编排起来。浏览器访问 Base。镜像从校验过的固定 Node、Keycloak、Nakama、NodeBB 与 npm lock 构建，包含模型和前端；原生启动方式仍保留。本 ZIP 包含完整源码、配置生成器和构建脚本，第三方服务镜像需在首次构建时下载，属于可联网部署包。

从完整ZIP构建时，直接验证并使用包内生产Node依赖、前端与预构建管理台，不重复下载同一份应用依赖。Docker构建会逐文件校验PACKAGE-MANIFEST.json；若文件缺失或摘要变化会停止。Git源码检出没有该清单时，才按锁文件安装应用依赖和构建前端。容器路线当前针对Linux amd64，Python/服务二进制及其原生依赖在Linux内安装。

## 先看虚构双校示例

在 Ubuntu/Linux 中使用 Docker Engine、Compose v2 和 Python 3。模板使用 Linux host network，所有后端监听回环地址；它不按 Docker Desktop 的端口映射方式运行。使用全新的配置目录、项目名、数据库命名空间和卷，不复用已有学校实例。

```sh
python3 deploy/configure.py --out /absolute/new-hd-config --fixtures
docker build --network host -f deploy/Dockerfile -t hyper-dimension-base:integrations .
docker compose --env-file /absolute/new-hd-config/compose.env -f deploy/compose.yaml up -d --no-build --wait
docker compose --env-file /absolute/new-hd-config/compose.env -f deploy/compose.yaml run --rm --no-deps utility seed-fixtures
```

配置生成器不启动服务，目录已存在就拒绝覆盖。初次初始化单独创建七个数据库、每校服务凭据、原生表和 pgvector。初始化失败保留现场，不删除数据库重来。

默认地址：`http://127.0.0.1:6180/m1.html`。配置文件列明实际端口，可用参数修改；已有端口被占用时排查冲突，不停止别人的服务。`seed-fixtures` 仅用于明确启用隔离测试的配置，建立虚构用户与首位负责人，不覆盖已有成员或负责人。测试口令位于私有运行卷 `services/private/test-users.json`，不在公共 ZIP，不打印到日志。示例学校 north/south 也是隔离示例；接手 Agent 应按实际学校项目调整空间包和服务配置，单校部署删去未使用学校实例，避免常驻额外服务。

## 正式学校配置

正式模式不加 `--fixtures`，提供自己的 SMTP JSON 和规范 HTTPS 域名：

```sh
python3 deploy/configure.py --out /absolute/new-production-config --smtp /absolute/private/smtp.json --public-origin https://campus.example.org --idp-origin https://login.example.org
```

`smtp.json` 为 Keycloak 的 SMTP 参数，例如 host、port、from、auth、ssl/starttls，以及需要时的 user/password；真实值留在私有文件。未提供真实 host/from 时，初始化在创建应用账号与数据库前拒绝占位配置。`postgres-password`、`compose.env` 为私有文件，不能进 Git、学校知识库或公开附件。

在同一 Ubuntu 主机配置 HTTPS 反向代理：校园域名转发至配置的 Base 回环端口，登录域名转发至 Keycloak 回环端口；保留正确 Host、X-Forwarded-Proto、X-Forwarded-Host。Keycloak 仅信任回环代理。原生论坛与聊天的对外入口、域名和回调也由部署 Agent 结合实际服务配置核对；样例中的 localhost 地址只用于本机/受控隧道测试。目标服务器、DNS、邮件到达、TLS 与外部商家接口需要在真实环境复测。

首位负责人先注册并验证邮箱，再由服务器操作者执行既有 `tools/m1-bootstrap-owner.mjs`，例如通过 utility 容器的 Node 入口：

```sh
docker compose --env-file /absolute/new-production-config/compose.env -f deploy/compose.yaml run --rm --no-deps --entrypoint node utility tools/m1-bootstrap-owner.mjs --school north --username EXACT_VERIFIED_ACCOUNT
```

此工具只允许建立首位负责人；之后使用现有审计交接流程。更改已初始化实例的域名或端口需要有备份的明确迁移，init 不会用新环境变量悄悄替换旧配置。

## 持久化、停止与恢复

- `postgres` 卷保存七库，`runtime` 保存私有配置、上传数据、服务状态和集成版本，`backups` 保存完整备份。日常停止保留卷。
- 依赖按 PostgreSQL 健康 → init 完成 → 身份/论坛/聊天健康 → Base 启动。隔离插件未就绪时不应开放业务。
- Hermes 使用下节的专用镜像与Compose叠加配置；每次接待调用启动零工具子进程，不启动个人网关或每访客常驻模型。自动 embedding 进程有并发/队列上限，任务结束释放。
- 默认内存上限：PostgreSQL 1 GiB、Keycloak 1 GiB（堆上限 640 MiB）、Base 768 MiB、每个 NodeBB 512 MiB、每个 Nakama 256 MiB。init 1.5 GiB，完成后退出；utility 完成即删容器。上限不是性能承诺，需按实际人数、资料和机器验证。

备份前停止所有应用写入者，保留 PostgreSQL：

```sh
docker compose --env-file /absolute/new-hd-config/compose.env -f deploy/compose.yaml stop base keycloak forum-north forum-south nakama-north nakama-south
docker compose --env-file /absolute/new-hd-config/compose.env -f deploy/compose.yaml run --rm --no-deps utility backup create --backup /backups/NEW_BACKUP_NAME
docker compose --env-file /absolute/new-hd-config/compose.env -f deploy/compose.yaml run --rm --no-deps utility backup verify --backup /backups/NEW_BACKUP_NAME
```

完整恢复见 `docs/M1.md` 的恢复部分。容器操作者通过带有私有引导凭据的 init 工具执行 `node deploy/restore.mjs --backup /backups/NEW_BACKUP_NAME --target /runtime/NEW_RESTORE --namespace NEW_NAMESPACE`，只恢复到新的目录、数据库命名空间与服务端口。工具绑定相同固定版本，不启动写入者。迁移客户端回调并验证新实例后，再决定是否切换入口。不能只复制向量表或只迁移 Base 库。

用完测试实例执行同一项目的 `docker compose ... stop`；不为后续分析材料保留空转的身份、论坛、聊天或浏览器。不要用删除卷来做日常停机。旧交付包及用户数据库保持原样。

参考：[Compose 启动依赖与健康](https://docs.docker.com/compose/how-tos/startup-order/)、[Compose secrets](https://docs.docker.com/reference/compose-file/secrets/)、[Keycloak 容器与正式运行](https://www.keycloak.org/server/containers)、[Nakama Docker](https://heroiclabs.com/docs/nakama/getting-started/install/docker/)。

## 容器内 Hermes 接待

当前固定的Hermes需要Python 3.11–3.13；Ubuntu 26.04系统Python 3.14不直接用于Hermes。`deploy/Dockerfile.hermes` 从固定摘要的Python 3.13镜像复制独立解释器，验证包内 `integrations/hermes/source.tar.gz`，通过固定uv轮子和上游uv.lock冻结安装核心依赖。原embedding虚拟环境独立保留。

先构建本包的核心镜像，再构建Hermes层。使用本次部署专用的镜像名称：

```sh
docker build --network host -f deploy/Dockerfile -t hyper-dimension-base:campus-current .
docker build --network host --build-arg HD_CORE_IMAGE=hyper-dimension-base:campus-current -f deploy/Dockerfile.hermes -t hyper-dimension-base:campus-current-hermes .
```

为全新实例生成Hermes配置。正式模式另加前文真实SMTP和HTTPS参数，虚构测试才使用 `--fixtures`：

```sh
sudo python3 deploy/configure.py --out /absolute/new-hermes-config --fixtures --hermes --model-key-file /absolute/private/deepseek.key
export HD_STACK_IMAGE=hyper-dimension-base:campus-current
export HD_HERMES_IMAGE=hyper-dimension-base:campus-current-hermes
docker compose --env-file /absolute/new-hermes-config/compose.env -f deploy/compose.yaml -f deploy/compose.hermes.yaml up -d --no-build --wait
```

也可用 `--model-key-stdin` 从私有标准输入传入密钥，不把值写进命令行。生成器拒绝覆盖已有目录，将新的密钥副本设为0400、UID/GID 10001；此权限安排需要root。密钥仅挂载到Base服务的Docker secret路径，其他服务不接收它。Base启动时读取密钥到接待进程环境，并生成不含密钥的Hermes路径配置；已有不同配置拒绝覆盖。密钥不进入镜像、Git、通用ZIP、学校知识库或进程参数。更换密钥后重启Base，恢复备份时另行重新挂载密钥。

检查 `/health` 的 `receptionProvider=hermes` 只是启动检查；还须真实提问、刷新追问、跨人拒绝、导出删除及重启恢复。默认保留30天、学校可配置；Hermes零工具且关闭个人记忆与持久化，Base管理身份隔离后的有限历史。没有创建额外的Hermes常驻服务。

网络较慢时可使用 `integrations/download-cache/README.md` 的第三方缓存。每个安装包仍核对原固定SHA-256，NodeBB仍核对原固定提交；不能复制运行数据库或私有服务配置作为下载缓存。通用打包器排除这类大体积缓存，只保留说明。

Python包下载源默认使用PyPI。网络需要时，可在两个镜像构建命令中加 `--build-arg HD_PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple`，仅切换公开下载源，不传模型密钥、不修改版本。Hermes的uv启动轮子有固定SHA-256，核心依赖仍使用上游冻结锁及其hash，不能通过取消校验或降级包来完成安装。

Linux amd64的固定uv轮子已随包附带，保留其原许可证，安装器离线核对后使用。重复构建还可按 `integrations/hermes-cache/README.md` 复用本机可信的公开依赖缓存，避免已验证的组件重复下载。先在该缓存为空时构建核心镜像，再临时提供缓存构建Hermes层；旧构建器可能不支持按Dockerfile的忽略配置，应遵守此顺序。Hermes构建不读取用户运行卷，缓存不进入通用ZIP或最终Hermes运行层。
