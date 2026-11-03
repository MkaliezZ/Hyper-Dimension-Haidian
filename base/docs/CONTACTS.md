# 联系人授权与私信边界

校园模式 `campusEnabled: true` 的联系人授权属于 Base-2 / AC-18。同校、同组织、已有旧私信、论坛权限和 Agent 回复都不构成同意。`/contacts.html` 管理授权及私信偏好；`/social.html` 展示当前可发送状态与只读历史。

## 使用流程

1. 选择学校、学校或组织范围，向当前可见成员申请联系。
2. 对方明确接受后，双方可在该范围创建私信、发送或修改自己的消息。申请人不能自己批准；第三人、学校负责人也不能代替参与者批准。
3. 接收方可以拒绝；任意一方可以撤销申请或已接受的授权。需要重新联系时，按当前版本再次申请，由另一方重新同意。
4. “允许新的联系申请”控制新申请和接受。“允许已授权联系人发来私信”关闭后，该用户参与的所有私信均暂停发送与编辑。恢复偏好不会复活已撤销的授权。
5. 撤销、拒收或屏蔽不删除过去正文；有当前学校/组织访问权限的本人仍可读参与过的历史、撤回自己的消息、提交具体举报。参与者失去学校/组织权限后，相应访问与实时连接失效。管理员没有默认私信阅读权。

学校和组织分别授权：学校范围同意不覆盖组织私信，某组织同意也不覆盖另一个组织。任意方向的屏蔽都禁止新申请、接受和正文发送；解除屏蔽只撤掉屏蔽限制，不恢复已经撤销的联系人授权。

## 接口

统一前缀 `/contacts/schools/:schoolId`。仅当前 OIDC 人类账号可调用；没有 Agent 代发或替用户接受接口。JSON 未声明字段拒绝。每个 POST 均需 `requestId`；同请求不同路径/内容返回 409，原请求重试不制造第二次状态变更。受保护操作在返回原收据前重新检查当前学校/组织权限、屏蔽和相应同意状态。

| 方法与路径                      | 请求                                                                  | 结果                                                                                     |
| ------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET `/preferences`              | 无                                                                    | `acceptingContacts, allowDirectMessages, revision`；未设置版本为 0                       |
| POST `/preferences`             | `requestId, expectedRevision, acceptingContacts, allowDirectMessages` | 新偏好与版本                                                                             |
| GET `/state?peerId=UUID&org=ID` | `org` 可省略代表学校                                                  | `contactId,status,revision,requestedBy,canSend,canRequest,canAccept,reason,peerId,orgId` |
| GET `/requests?org=ID`          | 当前范围                                                              | 自己参与且当前有权查看的 `contacts[]`，含对方显示名；最多 200 条                         |
| POST `/requests`                | `requestId,expectedRevision,peerId,orgId?`；首次版本 0                | `contactId,status:pending,revision,requestedBy,peerId,orgId`                             |
| POST `/requests/:id/accept`     | `requestId,expectedRevision`                                          | 接收方批准，状态 `accepted`                                                              |
| POST `/requests/:id/reject`     | 同上                                                                  | 接收方拒绝，状态 `rejected`                                                              |
| POST `/requests/:id/revoke`     | 同上                                                                  | 任一参与者撤销 pending/accepted，状态 `revoked`                                          |

旧请求的成功收据只证明对应历史操作；界面使用 GET state / requests 和聊天 `canSend` 判断现在是否可发送。撤销后不能重放旧的接受、私信创建、发送或编辑操作绕过授权。每用户每日最多 40 个新联系申请，重试不重复计数。

既有 `/m1/schools/:school/contacts` 是成员目录，校园模式额外返回 `requiresContactConsent:true`。聊天列表、消息历史与 SSE sync 返回 `canSend` 和 `contactPermission`；旧实时连接在下一次批次看到只读状态。后端始终验证同意，不能靠修改前端字段发送。

## 存储与事务

- 不改已应用的 M1 消息结构。新迁移 `campus-contacts-001.sql` 增加 `hd_contact_preferences`、`hd_contact_permissions`、`hd_contact_events`。
- 联系人键包含学校、组织和排序后的两个用户 UUID。单一状态版本执行 CAS；重新申请保留同一联系人 ID 并增加版本。
- 权限、屏蔽、偏好及联系人变更统一使用 `school:permissions` 锁。校园消息发送/编辑从读取授权到完成有界 Nakama 写入及 Base 收据，全程持有该锁；已经授权的在途写入先完成，再提交撤销。撤销提交后的新写入不能发送正文。
- 同一数据库连接执行锁、准备事务和收据事务，避免 8 连接池被撤权请求占满导致工作线程等待第二条连接。Nakama 请求超时仍保留操作 ID，由既有 reconcile 查询已写结果；不声称超时即未写入。
- Nakama 仍是聊天正文权威；Base 只保存消息元数据、授权、最小事件和收据。联系人事件具有 `source/actor/visibility`，参与者通知仅含对象引用、状态、组织 scope，不能成为公共接待知识。
- `campusEnabled:false` 沿用旧 M1 权限行为；启用校园模式不会删除旧消息或自动为旧会话生成双方同意。

## 验证与限制

隔离运行环境中设置 `HD_M0_CONFIG` 指向配置，并显式设置 `HD_M1_TEST_FIXTURE=1`：

```sh
node tests/contacts-live.mjs
node tests/contacts-browser-prepare.mjs
HD_M0_CONFIG=.local/contacts-browser-config.json HD_M0_USERS=.local/contacts-browser-users.json \
HD_QA_CHROME=/path/to/chromium node tests/contacts-browser.mjs
```

服务验证创建专用虚构 Keycloak 账号和新测试组织，使用真实 PostgreSQL、真实 Nakama，并通过原样转发的本机代理控制在途响应以验证锁顺序。输出 `qa/campus/contacts-live.json`。浏览器准备脚本只将新虚构账号的凭据写入忽略的 `.local/contacts-browser-fixture.json`，不得加入交付包或公共证据。浏览器验证使用独立自动化上下文；结果不代表真实学校或物理多设备验收。保留原用户、旧交付包和旧数据库；新测试记录仅在隔离校园命名空间。

全文搜索、联系人推荐、手机通讯录导入以及自动向外部人发送消息不在本项范围。角色/组织被撤销后，既有联系人记录保留审计，但不提供失效范围的信息访问。
