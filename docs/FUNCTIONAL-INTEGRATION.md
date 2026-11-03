# 功能接入与边界

2026-10-28：功能优先，美术暂停。新增校园功能中心连接器，当前接入状态、配置、真实运行阻塞与退出标准见 [FUNCTION-FIRST](FUNCTION-FIRST.md)。目前为开发工作树，不是新封存交付。

## 当前真正复用的Base能力

`src/base.mjs`绑定随包 `base/`，开发时可显式 `HD_BASE_ROOT` 指定同版本底座。复用 Base 的协议常量/稳定ID、签名访客、原子存储、事务回执、接待资料检索、会话保留/导出删除以及A2A网关。校园几何/导航和前端是UW学校适配，不修改Base室内几何约束。

`data/reception.json` 是接待绑定，不是完整校园配置，也不是伪装成室内场景的空空间包。真正的户外几何是 `data/campus.json`，渲染和路径响应都绑定其 `geometryHash`。

### 已接通

- 地标列表、搜索、地图标记和建筑点选 → 同一实体详情与来源。
- 点击步行前往 → 服务端从当前访客位置求路线 → 幂等移动回执 → 动画与服务端保存。
- 地点“问问接待” → Base接待任务 → 已审核UW事实与来源；命名地标问题聚焦该地标。
- 同一访客刷新/重启恢复会话，另一个访客不能导出；删除后旧context/重放不可恢复正文。
- 官方A2A SDK发现、提问与任务生命周期；自定义 `uw.campus.route` 只接受固定UW地标ID。

户外路线使用UW公开步道，限3m的端点间隙拼接都检查建筑内部穿越。到达点是建筑附近的导览点，不是测绘门口；不是实时路况、轮椅、施工或紧急路线保证。人物只是位置演示标记，尚未接正式Base-2人物账户。

## Hermes与向量库

默认明确显示“已发布资料 · 非通用模型”，无需密钥即可验证资料与功能，不把检索称为通用智能。

使用随包Base的 `base/docs/LOCAL-AGENT.md`、`base/docs/RECEPTION.md` 配置**独立于个人Hermes**的零工具接待运行时，在本UW实例数据目录中维护私有 `reception.json`。接待密钥通过私有文件/进程环境注入，不把个人网关、文件或工具授权给访客。

```sh
# Ubuntu示意：先配置好该数据目录的私有reception.json和可信Hermes安装
UW_RECEPTION_MODE=hermes UW_DATA_DIR=/absolute/private/uw-runtime node server.mjs
```

Windows PowerShell对应设置 `$env:UW_RECEPTION_MODE='hermes'`。缺配置时启动失败，不静默冒充接通。Base可用PGlite/独立PostgreSQL+pgvector；本UW实例仅在数据目录配置知识库后调用同一 `openKnowledge`，按底座知识库文档导入已审核快照。未配置向量库时就是公共资料关键词检索，本轮未新做真实Hermes或向量召回验收。

## Base-2 / 3 / 4 下一步

完整功能使用已有Base Ubuntu校园栈，另建UW学校/组织/正式负责人，映射稳定 `uw-seattle` 空间ID与OIDC身份；不把 north/south 测试学校换名字冒充入驻。

1. 先把本户外实体/资料适配到正式校园身份与持久化，再接人物配方、服务端背包和位置权限，保留原访客数据，显式迁移。
2. HUB、Quad等点位接同一学校的活动/论坛/记忆接口和后台审核，复用NodeBB正文、事件和贡献账本，不另造本地假论坛。
3. 合作功能需要真实商家配置、限定委托、确认和回执；未接通时不显示虚假可办理。

本 UW 实例尚未绑定正式七库/Keycloak/NodeBB/Nakama。2026-10-28 已在新建 WSL 双校测试实例完成这些原生服务的 23 项检查及七库存储恢复，见 [实际记录](../evidence/wsl-ubuntu-20261028/ACCEPTANCE.md)；通用能力复测不等于上述 UW 接入已完成。

## A2A

卡片：`/agents/uw-reception/.well-known/agent-card.json`；接口：`/agents/uw-reception/a2a`。访客Agent不限定供应商，Bearer凭据由本实例维护者受控发放，默认本机生成的维护者凭据保存在私有数据目录，不在前端或ZIP中。

`space.information` 查公开资料；`uw.campus.route` 参数 `fromId/toId` 为九个固定地标ID。示例见 `scripts/a2a-example.mjs`。浏览器使用签名Cookie调用同一网关、不会把维护者token发给访客。
# 当前开发状态入口

本文件保留功能接入设计；2026-10-28 之后的实际完成度以 [VISITOR-HERMES](VISITOR-HERMES.md) 和 [FUNCTION-FIRST](FUNCTION-FIRST.md) 为准。当前 4190 已接真实 Hermes 和访客人物闭环；正式学校业务、向量发布撤回仍待连接。勿把下文早期“未配置”表述当成已验证的当前运行状态。

