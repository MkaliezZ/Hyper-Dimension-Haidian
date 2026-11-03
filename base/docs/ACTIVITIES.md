# 活动与志愿任务

此模块落实 AC-24 / AC-25 的通用流程。真实学校活动、官方志愿时长、用户未来提供的运营权重与活动材料均需独立确认，不能用自动化虚构数据代替。

## 用户流程

浏览器进入 `/activities.html`，使用现有学校账号：

1. 组织负责人选择全校或自己负责的组织，建立活动或志愿任务草稿，填写时间、容量、报名截止、任务分工、提醒和指定核验者。
2. 提交审核，由本范围有审核权限的人员发布。未审稿件不进入普通成员目录。
3. 成员报名；正式名额满后进入候补。退出后按服务端队列顺序递补，事务保证并发不超容量。
4. 正式参与者在活动开始后提交文字说明及受控附件。提交和报名均不自动加分。
5. 当前指定核验者检查依据，退回补充或确认参与。本人不能核验自己；同一次参与只能生成一条确认事件。
6. 核验者发现问题可撤销记录，保留原证明、理由和关联冲正事件。活动取消会取消报名、候补与未发送提醒，并冲正已确认记录。
7. 组织者可发布不含私人证明的活动回顾。本人可以查看参与记录和原始处理结果。

管理者可查看自己范围的名单；证明正文和下载权限只给本人及当前指定核验者。学校、组织、账号与核验者权限在每次操作和旧回执重放时重新检查。

## 数据与接入

新增迁移 `database/m3-activities-001.sql`，应用后不可修改。包含：

- `hd_activities`：审核状态、范围、时间、分工、容量与核验者。
- `hd_activity_registrations`：每校/活动/成员一条参与记录，独立版本和 FIFO 队列序号。
- `hd_activity_submissions`：证明版本与审核结果；补充提交不会覆盖旧记录。
- `hd_activity_events`：连续来源版本、操作者、被核验人、原事件关联；作为贡献依据。
- `hd_activity_reminders`：持久提醒计划、发送/取消状态与幂等通知编号。

```js
const activities = createActivities(db, identity, services, config, {
  getWorld,
  recordContribution, // await recordContribution(transactionClient, event)
  scheduleReminder, // await scheduleReminder(transactionClient, {schoolId, reminderId, dueAt})
  validateAttachment, // await validateAttachment(transactionClient, {schoolId, userId, attachmentId, activityId})
});
// Register activities.handle in the HTTP router.
// The durable worker calls await activities.reconcile(schoolId).
// Attachment reader uses activities.canReadAttachment(c, requestScope).
```

贡献 hook 必须在收到的同一事务连接里写账，失败使整个核验事务回滚。`activity_verified`、`volunteer_verified` 和 `participation_revoked` 包含 `eventId / schoolId / orgId / userId / actorId / registrationId / activityId / sourceRevision / occurredAt`；固定 `schema=hyper-dimension.event/v1`、`source.kind=base-activities`。冲正的 `reversesEventId` 指向原核验事件。没有 hook 时仅保存事件，状态明确为 `unconfigured`，不声称已给贡献。

提醒 hook 仅排入持久队列，事务参数内不放证明或其他私人正文。Worker 调用 `reconcile(schoolId)`，逐条确认当前活动、参与状态与学校/组织权限，再发送一次本人通知；再次调用不会重复。没有队列接入时 API 会明确说明，需要部署方安排该函数的持久调度。用户收到的是站内通知，不声称已发送短信或邮件。

附件上传契约为 `POST /attachments/schools/:school`，正文 `{requestId,name,mimeType,dataBase64,purpose:'activity-evidence',targetId:activityId,scopeId:orgIdOrEmpty}`。大小不超过 512 KiB，PNG/JPEG/PDF/UTF-8 文本；返回 `{attachmentId,sha256,name,bytes,mimeType}`。元数据和 `/download` 都需要当前授权，附件作为下载，不自动进入公开知识库。提交与核验前均重新验证附件仍有效。未配置验证器时拒绝附件引用；文字说明仍需指定核验者核查。

## API

活动入口支持 `/activities.html?school=<schoolId>&organization=<orgId>&activity=<activityId>` 深链接，供组织主页和运营排期继续处理实际活动。学校和组织必须在当前账号获准范围内，详情仍经服务端权限检查；链接参数不会赋权。目录可按组织筛选。

前缀 `/activities/schools/:school`，Cookie/OIDC 使用现有账号体系。所有变更使用 `requestId`；修改现有对象同时传 `expectedRevision`。重复同一请求返回原回执，内容改变返回冲突。

| 方法与路径                         | 用途及主要字段                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| GET `/status`                      | 模块、贡献、队列与附件接入真实状态                                                |
| GET `/setup?orgId=`                | 仅范围负责人获取可指定核验者的账号显示名和 ID                                     |
| GET `/items`                       | 当前可见活动与管理/审核/核验权限标志                                              |
| GET `/items/:id`                   | 详情、计数、本人参与记录；取消后原参与者仍可查看                                  |
| POST `/items`                      | 创建草稿，见下方结构                                                              |
| POST `/items/:id/edit`             | 只改草稿/退回稿；不可改原组织范围                                                 |
| POST `/items/:id/submit`           | 提交审核                                                                          |
| POST `/items/:id/review`           | `{decision,reason}`，decision 为 publish 或 reject，本范围审核者                  |
| POST `/items/:id/join`             | `{taskId?}`，志愿活动必须选存在的分工                                             |
| POST `/items/:id/cancel`           | `{reason}`，负责人取消与冲正                                                      |
| POST `/items/:id/recap`            | `{recap}`，负责人发布活动回顾                                                     |
| GET `/items/:id/participants`      | 管理名单；证明仅指定核验者或本人可见                                              |
| GET `/registrations`               | 本人的参与、证明版本和服务记录                                                    |
| POST `/registrations/:id/withdraw` | `{reason}`，本人退出未核验的报名/候补                                             |
| POST `/registrations/:id/evidence` | `{note,attachmentIds:[]}`，本人提交证明                                           |
| POST `/registrations/:id/verify`   | `{decision,reason,minutes?}`，decision 为 approve 或 reject，指定核验者且不能自批 |
| POST `/registrations/:id/revoke`   | `{reason}`，指定核验者冲正，不能自撤                                              |
| POST `/reconcile`                  | 空正文，仅学校负责人手动触发到期提醒对账；后台直接调用函数                        |

草稿字段：`kind=event|volunteer`、`orgId?`、`title`、`description`、`conditions`、`startsAt`、`endsAt`、`registrationClosesAt`、`capacity`、`remindBeforeMinutes`、`verifierIds[]`、`tasks:[{id,title,description}]`、`sceneId?` 与 `entityId?`。时间为 ISO，结束晚于开始且仍未结束，报名截止不晚于结束。地点必须来自当前学校已配置的公开空间。志愿任务至少一项，任务编号唯一。

已提交或已发布活动的核心安排不可悄悄改写；需要结构性变更时取消并建立新安排，保留原参与者已收到的条件。服务记录分钟数不得大于计划活动时长，但该校是否认可记录仍由有权人员决定。

## 验证

仅在隔离的虚构环境设置 `HD_M1_TEST_FIXTURE=1`。后端验收 `node tests/activities-live.mjs`；浏览器验收还需 `HD_QA_CHROME` 指定专属 QA Chrome，执行 `node tests/activities-browser.mjs`。`HD_M0_CONFIG` 和可选 `HD_M0_USERS` 指向私有测试配置，不进入源码包。

当前测试结果以 `qa/activities/live.json`、`browser.json` 为准。测试包含容量并发、候补与退出、提醒幂等、证明不自动计分、防自批、核验重复、撤销来源、贡献 hook 故障整事务回滚、受控附件与浏览器完整流程。脚本输出只证明运行过的自动检查；未运行或失败时不据此声称验收通过。

2026-10-24 在隔离 campus 配置的自动验证结果：后端 6/6、浏览器 4/4 通过，浏览器无脚本错误；已检查桌面核验工作台及 390 px 手机宽度截图。该轮真实队列和受控附件已连接，贡献 hook 尚未接入，因此该结果不包含正式贡献规则记账、实际校园参与或目标服务器验收。后续贡献联测应另留证据，不覆盖这一范围说明。

## 后补运营材料的边界

用户提供的活动手册、具体贡献权重、奖励预算、执行节奏和官方认定规则，应经版本化导入与审核后引用本模块的任务和事件。当前通用流程不内置一所学校的运营方式，也不把例子当正式规则。
