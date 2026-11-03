# M1 通信、原帖修订与信息治理

> **历史范围 / 兼容工具参考。** 本文记录当时里程碑，不是当前完成度或开发优先级。旧的“尚未实现”、功能上限、数据库数量及候选状态不覆盖后续版本；涉及具体命令仍须核对当前脚本和实例。当前流程以[统一开发手册](../DEVELOPMENT-MANUAL.md)及本版验收为准。

## 1. 权威数据与边界

- **Nakama**：私信和实时讨论的原始正文。系统所有的 `hd_messages` storage 对象采用 read=0/write=0，只有受信 Base 服务 RPC 可读写。客户端不能直读、伪造 RPC 或用原生频道绕开学校权限。
- **Base PostgreSQL**：会话参与者、学校/组织范围、消息 ID/版本、操作意图、去重回执、事件游标、已读位置、屏蔽、举报与审计。这里不另存一份聊天正文。
- **浏览器**：通过 Base 的 POST + SSE 通道收发。事件流每轮重新验证 IdP、当前学校和组织权限，读取正文后再检查一次。断网使用 Last-Event-ID 续取；重复事件按 messageId 和最新版本合并。当前开发配置每秒查询一次，未做大规模容量承诺。
- **NodeBB**：主题、回复和正文版本的原生权威。Base 提供受控编辑器，审核通过后调用 NodeBB `posts.edit` 修改原帖；不另造“已发布正文”库。原生整站页面及 Socket 入口仍闭合，避免第二套权限及私信旁路。这不等于开放了 NodeBB 整站管理界面。
- A2A、接待和知识库维持原契约。私信、讨论、举报、论坛草稿与 A2A 私有历史不会自动发布或写入公开向量资料库。

## 2. 权限矩阵

| 操作                    | 允许者                          | 服务器校验                                                   |
| ----------------------- | ------------------------------- | ------------------------------------------------------------ |
| 学校讨论与联系人        | 当前学校成员、审核员、负责人    | affiliate/partner 不能由学校总入口访问                       |
| 组织讨论与联系人        | 本组织有效成员及学校负责人      | 学校审核员没有自动组织权限                                   |
| 私信                    | 两位有同一范围资格的参与者      | 第三人、普通版主和学校负责人不能直接读其他人的私信           |
| 修改/撤回聊天消息       | 原作者                          | expectedRevision、当前范围、保留锁和去重键                   |
| 屏蔽                    | 本人                            | 双向阻断该私信会话的新发送、读取和既有事件流；可由屏蔽方解除 |
| 举报                    | 当前有会话访问权的人            | 只能举报该会话已提交的消息；同人同消息去重                   |
| 查看举报列表            | 对应学校/组织审核员和负责人     | 列表不附正文，不能借举报跨组织查阅                           |
| 审查被举报的单条消息    | 对应范围审核员/负责人，填写理由 | 每次读正文前写入审计；不给出整段私信历史                     |
| 原帖/回复修订           | 原作者或对应范围审核员          | 旧版本、私有待审修订、范围与 requestId 校验                  |
| 发布/驳回修订、撤回内容 | 对应范围审核员/负责人           | draftId + expectedRevision；权限实时读取                     |

账号禁用、撤销学校/组织资格会影响已持有的令牌和已打开的流。每次发送及每个流批次都重新鉴权；客户端已收到的正文无法从他人设备远程抹掉。学校/组织角色、最后负责人保护、换届交接与权限审计继续沿用 M1 文档。

## 3. 消息与事件契约

私信或讨论使用 `hyper-dimension.message/v1`。稳定键为 schoolId、conversationId、messageId，来源 Nakama；服务端填入 actor(kind=human/userId)、onBehalfOf=null、revision、operationId、inputHash、status 和正文。组织、可见范围及参与者由会话元数据确定，客户端不能指定操作者、版本结果或服务密钥。

同一 requestId 重试返回同一结果；修改输入冲突。编辑用 expectedRevision。源正文先按 Nakama CAS 写入，Base 再提交事件和回执。如果源写入后回执丢失，对账通过 operationId/inputHash 找回一次结果；未确定的写入保持 pending，要求原请求重试，不自动生成第二条消息。

| HTTP     | 接口（前缀 `/m1/schools/{school}`）                                                           |
| -------- | --------------------------------------------------------------------------------------------- |
| GET      | `/contacts?org={optional}`：当前范围联系人，只返回稳定 ID 与展示名                            |
| GET/POST | `/chat`：可见会话/未读；创建 `{requestId,kind:dm\|room,orgId?,peerId?}`                       |
| GET      | `/chat/{id}/messages?after={sequence}`：最多100条变更，正文为最新授权版本                     |
| POST     | `/chat/{id}/messages`：`send/edit/remove`，requestId；编辑/撤回附 messageId、expectedRevision |
| GET      | `/chat/{id}/stream?after={sequence}`：SSE；Cookie 登录，不把令牌放 URL                        |
| POST     | `/chat/{id}/read`：`{sequence}`；只能确认本会话的游标                                         |
| GET/POST | `/blocks`：本人屏蔽名单，`{userId,blocked}`                                                   |
| POST     | `/chat/{id}/report`：`{messageId,reason}`                                                     |
| GET/POST | `/reports?org={optional}`：列表/单条审查 `{reportId,reason,resolve?}`                         |

历史和事件 ID 为字符串游标，客户端去重而非按次数追加。SSE 在临时上游故障时重试、不越权降级；身份或权限失效发出 denied 并结束。当前每人最多3条流、整实例200条流，每人每分钟最多30次发送；未读与会话列表最多200项，联系人最多200项。这是有边界的首轮实现，不是无限规模聊天系统。暂无聊天附件、语音/视频或社交好友审批流程。

## 4. NodeBB 编辑与审核

`/m1/schools/{school}/[organizations/{org}/]forum` 增加 POST actions：

- `detail {id}`：已授权原帖；草稿只对作者和范围审核员返回。
- `edit {id,requestId,expectedRevision,title,content}`：建立待审修订，已发布正文不变。
- `approve-edit {id,requestId,expectedRevision,draftId}`：审核后调用原生编辑，保留 pid/tid，保存 NodeBB 版本差异。
- `reject-edit {id,expectedRevision,draftId}`：驳回待审修订，已发布正文不变。
- `submit` 可附 `parentId` 回复主题；同样进入原生审核队列。回复必须继承主题范围，不能借 topicId 跨范围投稿。

公开修订生成新的源事件版本，published→published 的贡献增量为0；仍采用明确标记的虚拟试验计分规则。回复撤回只删除该原生回复，保持父主题。直接原生内容漂移被对账阻断，不能视作已审核内容。

编辑先记录目标摘要与意图，原生提交后丢响应可通过实际正文/标题摘要恢复。部分结果与预期不符时 blocked，保留现场。用户输入和原生限流错误记录为失败回执，不重复投稿，也不留下永久的假“正在发布”状态。

## 5. 保留、到期、屏蔽及备份

保留期限由学校与平台选定。私有 config 可设 `chatRetentionDays`（1至3650整数）；不设置则不擅自决定学校期限。启用后，新消息写入 expires_at，运行器定期处理到期正文，源存储改为 text=null 的到期墓碑，同时保留最少路由、回执和审计。已有消息不会因改配置自动回填期限。

```bash
export HD_M0_CONFIG=/srv/hd-m1/private/config.json
# 默认预览，不清理；--apply 才执行已到期记录
node tools/m1-chat-maintenance.mjs --school north
node tools/m1-chat-maintenance.mjs --school north --apply
node tools/m1-chat-maintenance.mjs --school north --reconcile
# 维护者通过受控终端加/解除保留锁，必须记录理由
node tools/m1-chat-maintenance.mjs --school north --hold --message UUID --reason '学校已批准保留的调查记录'
node tools/m1-chat-maintenance.mjs --school north --release-hold --message UUID --reason '保留事项已结束'
```

保留锁只保留源证据，不让过期内容继续出现在普通会话；锁定期间拒绝作者改写或撤回源证据。举报审查通过单独权限与理由留痕；普通运营日志不打印正文或密钥。到期不等于历史备份已清理，维护者须把已过期数据纳入备份轮换策略，避免把旧快照重新作为公开在线数据使用。

完整备份仍用 `m1-backup` 停写六库方案。新增 Base 元数据、Nakama 私信、NodeBB 原生修订和权限审计随六库一并备份；只恢复到新目录/新库。执行备份的系统账号须有服务私有目录的读取权（例如 Keycloak truststores）；权限不足会留下无 complete 清单的失败目录，不能拿它恢复。不要改成跳过不可读文件来冒充完整备份。

## 6. 升级与复做

1. 保留旧包；停旧写服务，执行并校验整套备份。
2. 恢复到独立目录和数据库命名空间，绑定固定服务版本。本包 `m0-patch-nodebb.cjs` 安装新的本地插件；将 `integrations/nakama/hd.js` 更新到每校 Nakama 的 modules。
3. 新源码启动时只追加 `m1-003`、`m1-004`，校验既有迁移摘要。不得改写 m1-001/002；失败保留原件。
4. 按 evidence/m1-social/ACCEPTANCE.md 做不超过20分钟的功能验收；用真实服务和虚拟账号，不读取用户浏览器。
5. 验证通过后，由部署方选择切换到新实例；本包不会替换旧地址或删除旧库。

维护者可运行 `node tools/m1-status.mjs` 接入 Ubuntu timer 或既有监控：只读检查消息意图、outbox 重试、到期正文、举报数量及后台对账心跳，健康退出0、需处理退出1。输出不含正文/凭据。对账历史只在有变更时新增记录，心跳来自受服务密钥保护的状态接口，不用“最近一次内容变更时间”误报健康实例。此工具提供监控接点，未替学校绑定外部告警渠道。

正式 SMTP/域名、TLS/反向代理、非 root 服务运行、告警接入及目标承载须在 Ubuntu 目标环境落实。当前全套验证在单机 WSL Ubuntu 和独立 QA Chrome 完成。M2 素材/背包、正式运营规则及合作方业务未在这次扩展中展开。

接口依据与许可见 [Nakama server runtime declarations](https://github.com/heroiclabs/nakama-common/blob/v1.44.0/index.d.ts) 及本包 integrations/versions.json；实际兼容性以包内真实服务测试结果为准。NodeBB 插件保持独立 GPL 服务边界。
