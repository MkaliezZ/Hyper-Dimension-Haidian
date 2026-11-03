# 合作方业务 Agent A2A

## 实际能力与授权

每所学校有一个真实注册的业务 Agent：`<spaceId>-partner-services`。与空间接待分别注册；接口为 A2A 1.0 JSONRPC。`/agents.html` 的合作卡可查看实际 Agent Card、来源修订与服务负责人，并进入授权或人工办理页面。

`/delegations.html` 由已登录的本校成员创建授权：选定服务、skills、1 小时到 7 天以内的有效期并明确确认。服务必须经学校审核且当前有效。令牌仅返回一次，数据库只存哈希；重试相同 requestId 不会重复创建，也不会重复显示令牌。丢失时撤销再新建。学校成员、账号状态、模块开关、有效期、撤销状态、服务范围和操作范围在每次调用时重查，旧任务结果也受约束。

| Skill | arguments | 行为 |
|---|---|---|
| `partner.services.list` | `{}` | 仅列出授权范围内当前有效的服务 |
| `partner.service.get` | `serviceId` | 读取一项已审核服务 |
| `partner.task.propose` | `requestId, serviceId, kind, request` | 创建私有、待本人确认的申请，不向商家发送资料 |
| `partner.task.get` | `taskId` | 查询本人在授权服务中的业务记录 |
| `partner.task.cancel` | `requestId, taskId, expectedRevision, reason` | 取消本人的申请；外部结果不明时保留待确认状态 |

`kind` 为 `consultation` 或 `appointment`。`request` 支持 `question`，以及可选 `requestedTime`、`contactName`、`contactHandle`；预约必须填写未来时间。技术 A2A Task ID 与业务 taskId 分开，业务 taskId 在结果 `data.taskId`。

Agent 不能确认个人资料转交、领取或发放奖励、修改权限。本人须在 `/partners.html` 核对申请、接收方和逐项字段，再确认。业务 Agent 返回的是服务器查询与办理结果；不是未经验证的自然语言承诺。未接商家接口时明确显示不可用；隔离 fixture 的回执不是实际商家履约。

## 本地 Agent / Hermes 接入样例

1. 让用户完成上述网页授权，将令牌保存为本机私有文本文件（Linux 权限 600），不贴进公开资料、论坛或模型提示词。
2. 给本地 Agent 一个调用命令的工具，环境设置 `HD_AGENT_ORIGIN`、`HD_AGENT_ID`、`HD_AGENT_TOKEN_FILE`。令牌内容不作为命令行参数传递。
3. 先查询目录，再由用户明确选择要做的业务。可以把以下说明交给 Hermes、Codex 或其他能执行本地命令的 Agent：

> 阅读本包 docs/PARTNER-A2A.md。使用已配置的私有令牌文件调用 tools/partner-agent-client.mjs；先查询授权服务，不打印令牌。需要申请时保存稳定 requestId 和完整参数 JSON，解释将创建待本人确认的草稿。不要代替用户确认资料转交。取消使用当前业务修订号，重试沿用原 requestId；结果待确认时查询原业务记录，不另建申请。

```sh
export HD_AGENT_ORIGIN=http://127.0.0.1:6180
export HD_AGENT_ID=north-partner-services
export HD_AGENT_TOKEN_FILE=/absolute/private/partner-agent.token
node tools/partner-agent-client.mjs partner.services.list
node tools/partner-agent-client.mjs partner.service.get private/service-query.json
node tools/partner-agent-client.mjs partner.task.propose private/proposal.json
```

工具使用随包交付的官方 `@a2a-js/sdk`。它会检查 Agent Card 与请求目标为同一 origin，不把令牌跟随重定向发到其他地址。生产部署使用配置好的 HTTPS 域名。Hermes 的工具注册方法取决于其实际安装方式；本包提供的是可执行客户端与参数契约，不会修改用户全局 Hermes 配置。

`proposal.json`：

```json
{"requestId":"my-agent-request-001","serviceId":"从目录取得的UUID","kind":"consultation","request":{"question":"请说明办理所需材料。"}}
```

技术 A2A 请求扩展为 `metadata["https://hyper-dimension.dev/protocol/space/v1"]`，具体 URI 以 `src/protocol/index.mjs` 的 EXTENSION 和实际 Card 为准。接手 Agent 应读取常量，不猜 URI。参数形如 `{ "skillId":"partner.task.get", "arguments":{"taskId":"业务UUID"} }`。

## 幂等、恢复与信息边界

- 同一个 messageId 不能改变 A2A 输入；同一个业务 requestId 不能改变业务内容。A2A 请求恢复不会绕开业务回执。
- A2A `CancelTask` 只取消技术执行；取消预约需显式调用 `partner.task.cancel`。
- 业务沿用同一事务、权限锁、版本校验、回执及外部 operationId。丢失外部确认时先查询原 operation，不盲目创建新请求。
- 业务事件记录 Agent 委托身份和实际 onBehalfOf。客户端提供 userId、onBehalfOf 或授权声明不能改变服务器身份。
- 已下架服务的缓存公开资料拒绝再读；本人获准的既有业务回执可查询。撤销委托后，该令牌不能再读任务或执行新动作。
- 此令牌只能用于指定业务 Agent 的 A2A 路由，不能当 OIDC 登录令牌使用，也不能调用人物移动、学校管理或人工确认接口。

验证脚本：`tests/business-a2a-live.mjs` 与实际重启后的 `tests/business-a2a-restart.mjs`。均须 `HD_M1_TEST_FIXTURE=1` 及专用虚构配置。分别标明官方 SDK 客户端、独立 OS 进程、服务器持久化和真实商家接入的证据边界。
