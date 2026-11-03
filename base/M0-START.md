# Hyper Dimension Base · M0 集成验证包

> **历史范围 / 兼容工具参考。** 本文记录当时里程碑，不是当前完成度或开发优先级。旧的“尚未实现”、功能上限、数据库数量及候选状态不覆盖后续版本；涉及具体命令仍须核对当前脚本和实例。当前流程以[统一开发手册](DEVELOPMENT-MANUAL.md)及本版验收为准。

**先读此页，再读 `docs/M0.md`。** 本包为四个 Base 规划的 M0 开发交付，核心空间协议保持 Base v0.2.1，M0 扩展版本 0.1.0。旧 Base 完整交付包继续保留，本包没有覆盖它。

当前新增三条链路：

1. Keycloak 登录 → Base 学校成员资格 → Nakama / NodeBB 身份映射；原生服务也拒绝跨校和失权账号。
2. 浏览器人物编辑 → 原创 GLB 与动画 → PostgreSQL 配方存档 → 原空间运行 → 重登/重启恢复。
3. NodeBB 待审 → 采纳/撤回 → 版本化事件 → 贡献账本与 outbox → Nakama 排名，重复事件只记一次，可冲正和重建。

## 给接手 Agent

- 读取 `AGENTS.md`、`README.md`、`docs/M0.md`、`integrations/versions.json` 和 `evidence/m0/`，先解释已有能力、实测范围与后续阶段。用户提供学校目标时继续按已有引导收集平面图、公开资料与美术，不强迫用户粘贴长提示词。
- 后端目标为 Ubuntu，前端是浏览器。`npm start` 仍是原参考空间模式；M0 使用 `tools/m0-services.mjs` 启动独立数据库/服务。不要把 `npm start` 说成已启动完整校园账号和论坛。
- 完整源码、生产 Node 依赖、原 Base 中文向量模型、原创示例和固定依赖清单在包内。Keycloak、Nakama、NodeBB、Java、PostgreSQL 为外部服务，按文档安装并核验固定版本；**本 ZIP 不是所有服务的离线镜像**。
- 首次问“这是做什么用的？怎么用？”时先解释并引导选择。选择试运行后再安装隔离服务与虚拟账号。真实学校使用正式入驻/账号/备份配置，不能把测试密码和开发模式开放到公网。
- 人物是原创技术小样。完成结构与功能后，继续按 `prompts/04-VISUAL-POLISH.md` 引导学校确定画风、素材授权和场景美化。完整部件库、背包、私信、活动、奖励及合作业务仍按后续阶段开发。
- 私有配置、密码、用户数据库、原始图纸和学校项目均不在公共包内。已有目录和封存包不得覆盖；升级先做备份、对账与回退。

## 看哪里

| 内容                            | 位置                                           |
| ------------------------------- | ---------------------------------------------- |
| Ubuntu 安装、初始化、启停、测试 | `docs/M0.md`                                   |
| M0 实测与已知边界               | `evidence/m0/ACCEPTANCE.md`                    |
| 固定版本与许可证                | `integrations/versions.json`                   |
| 账号/学校/账本/适配             | `src/platform/`、`database/m0.sql`             |
| 人物与编辑器                    | `src/avatar/model.mjs`、`public/m0.*`          |
| 论坛及社交插件                  | `integrations/nodebb/`、`integrations/nakama/` |
| 原空间、A2A、接待、知识库       | `START-HERE.md`、`docs/`、`src/`               |
| 包内文件校验                    | `PACKAGE-MANIFEST.json`                        |

M0 的通过不替代完整四个 Base 的交付，也不代表校园真人试运营或生产上线验收。
