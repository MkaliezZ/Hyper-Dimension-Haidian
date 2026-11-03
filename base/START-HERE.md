# 从这里开始

**统一开发手册：[DEVELOPMENT-MANUAL.md](DEVELOPMENT-MANUAL.md)。** Agent 和人类使用同一份流程，涵盖选择运行方式、建校、美化、接待配置、后续开发、验证、备份与打包。

当前交付为校园扩展 **v0.8.3**，Base 核心 v0.2.1。本版整理文档与打包流程，应用运行时沿用 v0.8.2；文档验收与先前真实 Ubuntu/Hermes 实测分别记录。功能看 [CURRENT-FEATURES](docs/CURRENT-FEATURES.md)，页面看 [CAMPUS-START](CAMPUS-START.md)。

## 用户可以只说一句

把完整 ZIP 上传给能读文件的 Agent，问：

> 这是做什么用的？怎么用？

Agent 读取 [AGENT-START](AGENT-START.md)、[AGENTS](AGENTS.md) 与统一手册，解释并引导。学校图纸、公开资料和美术可逐步提供；用户无需复制长提示词。

## 人工开发与部署

先完整解压，执行 `node tools/verify-package.mjs` 和 `node tools/verify-docs.mjs`。随后按手册选择：

- **轻量示例**：`node tools/base.mjs doctor`、`npm start`，默认 `http://127.0.0.1:4180`；仅 Base-1。
- **完整校园**：Ubuntu / Linux amd64、Docker/Compose；按手册第 4、7 节和 [容器部署](docs/DEPLOYMENT-CONTAINERS.md)配置。学校账号、社区、运营等需要该完整栈。
- **开发与重新交付**：手册第 8–12 节；在开发副本准备根/admin 依赖，使用完整校园包装器生成新版本，保留旧包和用户数据。

历史 M0/M1/M2 文档保留工具用法和旧证据，不用其旧状态判断当前完成度。包不是离线整机镜像，模型密钥、真实 SMTP/TLS、学校原件和用户数据库不随公共 ZIP 分发。结构见 [PACKAGE-STRUCTURE](PACKAGE-STRUCTURE.md)。
