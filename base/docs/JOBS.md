# 后台任务与失败恢复

校园 Base 使用 PostgreSQL 内的 **pg-boss 12.38.0** 作为调度权威。当前开放的类型为活动提醒 `activity-reminder`。学校负责人可通过 `/jobs.html` 检查本校状态，并在核对失败原因后带理由重试原作业。

## 负责人怎样使用

1. 以当前学校 owner 登录，进入“后台任务”。组织 owner/moderator、学校 moderator、普通访客均不能查看此维护列表。
2. 区分“等待执行”“等待自动重试”“正在执行”“已完成”“执行失败”。自动恢复中的记录不显示人工重试按钮。
3. 只有原生 pg-boss 状态为 `failed` 且业务来源完整时可人工重试。先解决导致失败的条件，再填写原因。受理成功表示排回原任务，执行是否成功应刷新状态确认。
4. “业务已处理”表示业务事件已提交，即使队列丢失完成确认，重试仍沿用该业务事件 ID；不会因此重复发一条提醒。
5. 本页不开放改 payload、改 handler、伪造完成、重跑成功作业或删除历史。Base-3 关闭时只保留历史查看，新人工重试被拒绝。

## 权威与原子性

- `hd_scheduled_jobs` 只保留学校、类型、来源和确定性作业 ID/输入指纹，防止队列保留期结束后把同一业务重复调度。它不是另一套队列状态主库。
- `scheduleReminder()` 使用原业务 PostgreSQL 事务传入 pg-boss `send(...,{db})`；事务失败时业务和调度一起回滚。
- 使用已安装包的 `findJobs(name,{id,db})` 读取实际状态，`retry(name,id,{db})` 将失败状态恢复至 `retry`。实际 API 仅更新 `failed`，增加一次重试额度并保留原 ID、输入与未来执行时间。
- 维护接口在同一事务内锁学校权限/维护操作，复核当前 school owner 和 Base-3 开关，核对作业与业务来源，再调用原生 retry，写入既有 `hd_receipts` 和 `hd_audit`。并发同请求只执行一次。
- 操作需 `expectedRetryCount`；当前非 failed 或尝试计数变化为 409。旧回执返回前仍检查当前学校权限及模块开关；撤权后不能重放。
- 活动提醒的 `hd_activity_reminders.event_id`、通知唯一键和行锁共同保证业务副作用一次；pg-boss 重试本身不宣称 exactly-once 外部通信。
- 外部报错被 worker 转成固定错误标识。维护列表不返回原生 payload/output、参与者 ID、收件人、上游错误、令牌或密钥。学校作用域由服务端 metadata 约束。

## HTTP 契约

前缀 `/jobs/schools/:school`：

| 方法与路径                 | 说明                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------- |
| GET `/items?after=<jobId>` | 仅本校 owner。按登记时间由新到旧每页50条；`next` 为下一页游标，只接受本校已登记游标 |
| POST `/items/:jobId/retry` | `requestId`, `expectedRetryCount`（非负整数）, `reason`（3–1000字）                 |

GET 返回 `schoolId`, `retryEnabled`, `items`, `next`。每项为 `jobId`, `kind`, `state`, `retryCount`, `retryLimit`, `createdAt`, `startAfter`, `startedAt`, `completedAt`, `sourceState`, `canRetry`, `diagnostic`（固定安全枚举）。原生队列未找到记录时标明 `not_retained`；可能涉及保留期或命名空间变化，但单凭不存在不能确定原因。界面明确显示未找到，不假装已完成或重新创建。

POST 返回 `{jobId,accepted:true,previousRetryCount}`。相同 requestId/路径/输入返回原受理凭据，改变理由或输入为 409。客户端无法选择队列名称或传入任意业务数据。

## 部署、保留与验证

队列默认 schema 为 `hd_campus_jobs`，同 Base 的 PostgreSQL 数据库；完整备份需连同此 schema、业务表、回执与原服务数据库一起按停写协议保存。普通队列自动重试上限3次、退避、30秒单次过期；记录默认保留7天。死信队列仅为诊断副本，维护页面依据原作业状态恢复，不创建新业务事件，也不自动删除死信历史。

验证入口：

- `tests/jobs-live.mjs`：原事务回滚、十次同输入入队、队列实例恢复、已提交副作用丢确认后重试不重复、未来任务。
- `tests/job-admin-live.mjs`：真实 HTTP/Keycloak/PostgreSQL/pg-boss；本校owner、隐私字段、跨校、输入白名单、十并发重试、旧权限撤销、实际提醒只通知一次、成功拒绝重跑、关闭Base-3拒绝新请求及旧回执。
- `tests/job-admin-browser.mjs`：真实 Chrome 学校owner/管理员/访客界面、理由重试与窄屏。凭据只保存在忽略的 `.local` 下。

仅在 `HD_M1_TEST_FIXTURE=1` 的隔离运行时执行。故障注入只使用 pg-boss 公共API替换当次新建的未来虚构提醒作业，不修改内部队列表、不修改旧任务。测试报告位于 `qa/campus/job-admin-*.json`。这些自动验收不等同于真实学校运营或目标Ubuntu服务器验收。

本轮 `qa/campus/job-admin-live.json` **4/4 PASS**，`qa/campus/job-admin-browser.json` **3/3 PASS**、pageerror为0。首次试跑遇到测试自身 `boss.update` 参数位置错误；按包内API签名修正测试后完成上述验证，未修改队列行为或降低断言。
