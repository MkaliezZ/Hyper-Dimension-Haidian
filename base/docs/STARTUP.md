# Base-1 轻量示例启动说明

> 本页仅为轻量空间模式及兼容项目附件，不会启动完整校园账号/社区/运营栈。统一入口见[开发手册](../DEVELOPMENT-MANUAL.md)，完整 Ubuntu 模式按[容器部署](DEPLOYMENT-CONTAINERS.md)。旧 Plan14 附件须由所有者另行授权提供，不包含在公共 Base。

## 1. 运行环境与目录

从 [Node 官方页面](https://nodejs.org/en/download) 安装 24 LTS，确认 `node --version`。当前包在 Windows / Node 24.19.0 验证。macOS 命令已提供，未做 macOS 实机验收。

将 ZIP **完整解压**到普通可写文件夹；不要在压缩软件内部点文件运行。进入包含 package.json 的目录。打包版已附生产依赖与本地前端库，第一次启动无需 `npm ci`。源代码检出而非完整 ZIP 才需要先安装依赖。

```sh
node tools/verify-package.mjs
node tools/base.mjs doctor
npm start
```

打开 `http://127.0.0.1:4180`。首次运行显示两个原创虚拟空间。Windows 可双击 `start-base.cmd`；macOS/Linux 可用 `sh start-base.sh`。终端保持打开，停止用 Ctrl+C。

若端口已被其他服务占用，不要终止它；使用 `npm start -- --port 4181`，然后访问 4181。与别的实例同时运行应另选 `--data .local-second`，避免争用存档。

## 2. 建立学校项目

```sh
node tools/base.mjs scaffold --id campus-a --out projects/campus-a
# 让 Agent 按图纸和学校资料编辑 projects/campus-a/space.json
node tools/base.mjs build --space projects/campus-a/space.json
node tools/base.mjs verify --space projects/campus-a/space.json
npm start -- --space projects/campus-a/space.json --data .local-campus-a
```

scaffold 只创建原创脚手架，不会自动理解图纸。图纸解读、尺度核对、建模与未知项记录交给续建 Agent，见提示词。不要把 `campus-a` 留作多所学校的共同真实 ID。

## 3. 指定平面图项目附件

将私有项目 ZIP 中的 `projects/plan14` 合并到 Base 根目录，然后：

```sh
node tools/base.mjs verify --space projects/plan14/space.json
npm start -- --space projects/plan14/space.json --port 4181 --data .local-plan14
```

打开 `http://127.0.0.1:4181/?space=plan14`。不要覆盖已有同名项目；先保留备份或交给 Agent 审查差异。

## 4. 开启智能与资料库

普通场景：Node 即可。通用接待：另按 [LOCAL-AGENT.md](LOCAL-AGENT.md) 配 Hermes。学校知识库：另按 [KNOWLEDGE.md](KNOWLEDGE.md) 配 PostgreSQL/pgvector 和 Embedding。三种功能都能单独验证，未配模型时页面会明确显示资料接待。

## 5. 维护与验证

- `.local*/access.json` 是私有 Agent 凭据；state.json 是访客状态、任务和留言。`knowledge-postgres/` 是本机资料向量库。迁移前停止服务并备份整个数据目录和学校项目。
- 不要打包用户数据目录作为通用模板。校方确认可公开的内容才进入接待索引。
- 意外退出留下锁：先确认原进程已结束，再用 `node tools/base.mjs recover-lock --data <原数据目录>`。知识库锁按 KNOWLEDGE.md 的恢复命令处理，不能直接删数据库。
- 完整包保留测试源码。开发测试前可执行 `npm ci --ignore-scripts` 安装**开发依赖**，然后 `npm test`、`npm run verify`；浏览器检查另设 CHROME_PATH。npm ci 会重建依赖目录，不要在服务运行中执行。
- 公开部署需要 HTTPS、正式身份和最小权限 DB 用户；本机 Cookie 不代表校园统一认证。
