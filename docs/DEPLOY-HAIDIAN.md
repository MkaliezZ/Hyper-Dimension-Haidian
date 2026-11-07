# 海淀版完整后端

使用原UW的Linux amd64五服务架构。学校代码和公开资料独立，`base/`不改动；私有配置和持久数据放独立卷。不能使用UW现有配置文件替代海淀初始化。

## 本机已验证的实例

- Compose项目：`hyper-haidian-20261103`；命名空间：`haidian20261103`。
- 校园：`http://127.0.0.1:6290/`；Keycloak：9280；NodeBB：5667；Nakama：9450；PostgreSQL：55549。
- Linux私有部署配置：`/var/tmp/hyper-haidian-20261103/compose.env`，不在源码或交付包中。
- 五个运行服务、9组原生业务链、真实OIDC登录和23个原功能入口已验证。此实例使用明确的虚构测试账号及运营资料，不能作为真实学校账号库。
- 依赖镜像复用本机已有、不可变的`hyper-campus:uw-a2a-workbench-v0113-final`，通过`compose.source.yaml`只读挂载当前海淀源码。镜像只提供既有代码和公开依赖，未复制原UW运行卷或私有配置。

在本目录的WSL Ubuntu终端中启动当前实例：

```sh
sudo service docker start
HD_STACK_IMAGE=hyper-campus:uw-a2a-workbench-v0113-final docker compose \
  --env-file /var/tmp/hyper-haidian-20261103/compose.env \
  -f deploy/compose.yaml -f deploy/compose.source.yaml \
  -f deploy/compose.hermes.yaml up -d --no-build --wait
```

停止海淀服务并保留数据：

```sh
HD_STACK_IMAGE=hyper-campus:uw-a2a-workbench-v0113-final docker compose \
  --env-file /var/tmp/hyper-haidian-20261103/compose.env \
  -f deploy/compose.yaml -f deploy/compose.source.yaml stop
```

不使用全局清理、删除卷或任何旧的已停用PowerShell自动化。WSL终端应在本地预览期间保持开启。

## 新机器或新实例

先按`base/DEVELOPMENT-MANUAL.md`和`SOURCE-DEPENDENCIES.json`恢复固定的公开依赖。Git源码包不携带模型权重、Hermes安装缓存或服务二进制。可使用`python scripts/restore-source-artifacts.py --fetch`核验恢复3项固定公开依赖，再按Base容器手册构建相同Base/Hermes依赖镜像。学校镜像使用：

```sh
docker build --build-arg UW_BASE_IMAGE=<已验证的Base依赖镜像> \
  -f deploy/Dockerfile -t hyper-campus:haidian-v1 .
```

`UW_BASE_IMAGE`仅为沿用的Docker构建参数名；学校运行环境使用独立`HAIDIAN_DATA_DIR`、`HAIDIAN_PUBLIC_ORIGIN`、`HAIDIAN_RECEPTION_MODE`、`HAIDIAN_NPC_PROVIDER`等变量，避免误接原UW数据。

创建新的隔离验收配置，以下路径须不存在：

```sh
python3 base/deploy/configure.py --out /absolute/new-haidian-config \
  --project unique-haidian-project --namespace unique_haidian --fixtures \
  --base-port 6290 --idp-port 9280 --forum-port 5667 --nakama-port 9450 --pg-port 55549
HD_STACK_IMAGE=hyper-campus:haidian-v1 docker compose \
  --env-file /absolute/new-haidian-config/compose.env -f deploy/compose.yaml up -d --no-build --wait
```

虚构验收首位负责人按原有引导建立，不改权限规则：

```sh
HD_STACK_IMAGE=hyper-campus:haidian-v1 docker compose \
  --env-file /absolute/new-haidian-config/compose.env -f deploy/compose.yaml \
  run --rm --no-deps -e HD_M1_TEST_FIXTURE=1 utility seed-uw-fixtures
```

`seed-uw-fixtures`/`verify-uw`是保留的内部命令名，处理的是`deploy/schools.json`中明确的海淀学校；不连接UW。真实上线不加`--fixtures`，按Base手册配置正式SMTP/HTTPS和首位负责人。

## 原有模型功能

本机6290实例已在2026-11-07启用Hermes，接待和6位NPC使用`deepseek-flash`，无Pro回退；真实模型问答及页面已验证。接待调用原有Hermes运行时，NPC沿用UW直接调用DeepSeek的实现。密钥为用户本次授权配置，不来自UW；存于独立部署配置目录并由Docker secret只读挂载。

当前私有`compose.env`含`HD_HAIDIAN_HERMES_ENABLED=1`及`HD_RECEPTION_MODEL_KEY_FILE`文件路径。`START-HAIDIAN-FULL.cmd`会自动叠加`compose.hermes.yaml`，启用标记存在但密钥文件缺失时拒绝启动。上面的本机手动启动命令也包含该覆盖文件。跨机器源码包不携带私有配置；新实例通过Base配置器的`--hermes --model-key-file`或stdin配置独立密钥，不把密钥值放仓库或命令参数。未配置时资料模式不触发模型推理。

最新型号依据、详细验收与可重复的显式付费检查见[海淀Hermes接入](HAIDIAN-HERMES.md)。

## 数据保留

使用独立的`runtime`、`postgres`和`backups`命名卷。升级保留卷；需要恢复时沿用原Base五库备份恢复流程，在新命名空间恢复。原UW卷、用户资料与历史封存包均未迁移或覆盖。
