# Base-4 合作服务与权益

这是校园 Base 的可启停模块，配置 `partnersEnabled: true` 后提供 `/m5/schools/{schoolId}`。所有请求使用已有学校账号会话；学校和操作者从服务端身份确定。未配置业务适配器时可以审核展示和管理本地权益，预约明确显示 `adapter_unavailable`，不会声称合作方已经接单。

## 资料、人员与公开目录

| 方法与相对路径                | 输入或结果                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET `status`                  | 启用状态、适配器类型、是否仅为测试 fixture                                                                 |
| GET `partners`                | 自己申请或有管理权限的合作方，学校负责人可查全部                                                           |
| POST `partners`               | `requestId,name,category,description,validUntil,orgId?`，产生待审申请                                      |
| POST `partners/{id}/edit`     | `requestId,expectedRevision,name,category,description,validUntil`，修改后重新待审；已退出需新申请          |
| GET `partners/{id}`           | 自己申请或负责的资料；有权限时附人员列表                                                                   |
| POST `partners/{id}/review`   | 学校负责人：`requestId,expectedRevision,decision:approve/reject,reason`                                    |
| POST `partners/{id}/staff`    | 学校负责人：`requestId,expectedRevision,userId,role:maintainer/redeemer,active,reason`；首次 revision 为 0 |
| POST `partners/{id}/withdraw` | 负责人或本商户维护者：`requestId,expectedRevision,reason`                                                  |
| GET `services?partnerId={id}` | 本商户维护者查看全部资料状态                                                                               |
| POST `services`               | `requestId,partnerId,title,description,conditions,hours,officialUrl?,sceneId?,entityId?,validUntil`        |
| POST `services/{id}/edit`     | 同上加 `expectedRevision`；修改后重新待审，旧版本立刻停止公开引用                                          |
| POST `services/{id}/review`   | 学校负责人：`requestId,expectedRevision,decision:publish/reject,reason`                                    |
| POST `services/{id}/withdraw` | 本商户维护者：`requestId,expectedRevision,reason`                                                          |
| GET `directory`               | `{sources:[{id,title,text,sourceType,serviceId,partnerId,revision,validUntil,sceneId,entityId}]}`          |
| GET `services/{id}`           | 仅当前有效的发布版本                                                                                       |
| POST `services/{id}/exposure` | `requestId`，真实打开卡片后记录曝光；同人同服务每天一次                                                    |

业务行使用 `school_id` 与对象 ID 组成作用域；API 返回 camelCase。合作方资料审核和资料维护是两个权限：维护者不能审核自己的申请、服务或权益，核销员不获得资料维护或查看预约的权限。人员授予及撤销只能由学校负责人操作；绑定合作组织时，每次请求还校验该组织当前有效成员资格。新任人员需明确授予，离任人员现有会话和旧回执重放都会重查权限。

公开目录每次从发布权威表查询；未审、过期、退出、修改重审和撤回的资料不再返回。接待集成调用 `publishedSources(schoolId)` 取得当前来源，不把预约问题、联系方式、私信、持券者名单放入知识库。`officialUrl` 仅允许 HTTPS，用作用户主动打开的官方入口，服务端不抓取这个 URL。位置为稳定 `sceneId/entityId`；服务端验证该点确实是该学校当前场景的公开房间，缺失或变为受限后也不能继续引用。

发布服务或权益时，在同一事务中生成 `partners` 主题订阅事件。投影仅有来源 ID、修订、标题与有效期，正文仍归服务发布表；修改待审、撤回或合作退出会使已有通知失去公开可见性。通知有效期取合作方与服务/权益的较早者，退订后停止新通知。权限变更、发布投影和业务写入按 `school:permissions → school:information → partner-business` 顺序锁定，撤权后重放旧请求也必须通过当前权限。

## 预约与咨询工单

| 方法与路径                  | 输入或结果                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| POST `tasks`                | `requestId,serviceId,kind:consultation/appointment,request:{question,requestedTime?,contactName?,contactHandle?}` |
| GET `tasks`                 | 仅本人任务，最近 100 条                                                                                           |
| GET `tasks/{id}`            | 本人；授权确认后本合作方维护者可读                                                                                |
| POST `tasks/{id}/confirm`   | `requestId,expectedRevision,confirmed:true,consentFields:[...]`；字段列表必须正好等于将转交的 request 字段        |
| POST `tasks/{id}/cancel`    | `requestId,expectedRevision,reason`                                                                               |
| POST `tasks/{id}/reconcile` | 空对象 `{}`，检查已经持久化的操作；不创建新工单                                                                   |
| GET `partners/{id}/tasks`   | 本合作方已获用户授权的工单                                                                                        |

任务初始 `proposed`，界面先显示接收方、资料版本、办理条件和待分享字段。用户确认时重新校验来源仍有效且版本一致。服务端从当前账号生成 consent；聊天建议、Agent 输出和客户端 `userId` 都不是授权。默认不给合作方传邮箱、身份主体、其他私有资料；仅传用户在此工单显式填写并确认的字段。

状态为 `proposed → queued → confirmed`，外部失联或丢失回执为 `pending_confirmation`。取消区分尚未发出时本地取消回执，以及已发出后的 `cancel_requested/cancel_pending → cancelled`。取消确认前不把工单假定为已撤销。

`hd_m5_adapter_operations` 在网络请求之前持久化操作 ID、指纹和不确定状态。恢复和对账先按原操作 ID 查询；返回 unknown 时保留待确认，绝不换 ID 重建预约。单任务数据库锁防止两个 worker 并发派发。首次转交还在权限锁内重新核对账号、学校成员与来源；确认后撤权的账号不会继续首次转交资料。已经执行或结果不明的业务仍须查回执，不能因撤权就声称外部业务不存在。外部系统仍需实现永久幂等键和取消防重；这是跨系统对账，不是跨数据库原子事务。外部明确拒绝取消时保留取消失败回执及 `cancel_pending/adapter_rejected`，由真实服务方处理，不能声称撤销成功。

配置示例：

```json
{
  "partnersEnabled": true,
  "partnersAdapter": {
    "type": "http",
    "url": "https://partner-gateway.example/api",
    "token": "USE_PRIVATE_CONFIG"
  }
}
```

`http` 配置来自服务端私有文件，浏览器不可指定 URL 或凭据。仅 HTTPS 或 loopback HTTP；禁止重定向；单请求有 8 秒边界。适配器实现：

- `POST /operations`：Bearer 认证、`Idempotency-Key`；正文有 `schema,schoolId,partnerId,taskId,operationId,fingerprint,action:create/cancel,request,consent,source`。
- `GET /operations/{operationId}?schoolId=...`：按学校与原操作查询。404 或 `{status:"unknown"}` 表示仍不确定。
- 创建返回 `{operationId,status:"confirmed"或"failed",receiptId}`。取消返回 `cancelled/not_created/failed` 并附相同操作 ID 和实际 receiptId。
- 按操作 ID 与指纹防重；指纹不同必须拒绝。取消须对同 taskId 建立撤销状态或 tombstone，以覆盖先取消后晚到的创建。不得把超时当作创建失败或未创建。

隔离测试支持 `partnersAdapter:{type:"local-fixture"}`，且服务进程必须设置 `HD_M1_TEST_FIXTURE=1`。这是有持久记录和回执的本地虚构预约服务，不是真实商户或第三方平台接入。公开包不带真实合作方凭据。

## 权益、库存与核销

| 方法与路径                              | 输入或结果                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET `offers?partnerId={id}`             | 当前发布、合作方有效且未到期的权益                                                                                          |
| GET `offers?partnerId={id}&manage=true` | 本商户维护者查看待审等全部权益                                                                                              |
| POST `offers`                           | `requestId,partnerId,title,terms,stock,minContribution,contributionPeriod?,orgId?,withdrawalPolicy:honor/revoke,validUntil` |
| POST `offers/{id}/edit`                 | 同上加 `expectedRevision`；库存不能小于已发数，重新审核                                                                     |
| POST `offers/{id}/review`               | 学校负责人：`requestId,expectedRevision,decision:publish/reject,reason`                                                     |
| POST `offers/{id}/withdraw`             | 维护者：`requestId,expectedRevision,reason`，停止新领取                                                                     |
| POST `offers/{id}/claim`                | 当前学校成员：`requestId,expectedRevision,acceptedTerms:true`                                                               |
| GET `entitlements`                      | 本人权益、受控核销 token、到期后的 effectiveStatus                                                                          |
| POST `entitlements/{id}/redeem`         | 获准核销员：`requestId,expectedRevision,partnerId,token`                                                                    |
| POST `entitlements/{id}/revoke`         | 学校负责人：`requestId,expectedRevision,reason`                                                                             |
| GET `partners/{id}/metrics`             | 本商户维护者：汇总数，无个人名单或其他商户数据                                                                              |

领取一次一份，绑定学校、合作方、账号、权益和有效期。以原始贡献流水求和校验资格（可限定周期），不扣历史贡献；可再限定组织成员。并发领取锁定权益库存，发行与事件/回执同事务提交。每人每权益最多一份；撤销后不会通过新请求重新领取。后续修改权益条款不覆盖已发券的条款快照。

核销使用 256 位随机凭证，当前核销员、学校、商户、版本、状态及有效期必须同时正确。10 个不同请求并发核销只能一个产生副作用，其余冲突；相同请求和内容返回原回执，修改内容复用 ID 返回冲突。核销回执不泄露持有人联系方式。核销员只看到成功/拒绝，不能枚举他人的 token。

合作退出按券中已经同意的 `withdrawalPolicy` 处理：`revoke` 自动撤销未用券并通知；`honor` 保留至券本身到期，允许原获准核销员履约。合作有效期结束同样停止新领取，已发券依约保留到自身有效期。单个权益下架只停止新增领取；管理员单券撤销需理由，已核销不静默回滚。

曝光按人/服务/UTC 日期去重；咨询按确认任务记录；领取/核销来自真实事务事件，不能靠客户端直接写计数。统计返回汇总与当前已用/撤销/过期状态，Base-4 无读取私信、修改贡献或校园公告的能力。展示次数不等于真人到店，fixture 核销不等于实际履约。

## 验收与保留

运行 `HD_M1_TEST_FIXTURE=1 node tests/partners-live.mjs`（使用新的校园 fixture 私有配置）；HTTP 丢回执和恢复用例使用 `tests/partners-adapter.mjs`。覆盖 AC-33、AC-34、AC-35、AC-36 与权益资格部分 AC-28，结果按实际执行保存。还需整包备份/恢复、界面截图、接待 A2A 集成以及目标服务器验证才能完成整个 M5。

迁移为 `database/m5-001.sql`，已应用后不可改写。所有新数据进入独立的 hd_m5_* 表和既有审计/通知/回执，不改 NodeBB、Nakama 内部数据，也不覆盖任何历史交付包。预约可能有用户同意转交的私人字段，不能加入公共发行包或公开证据。
