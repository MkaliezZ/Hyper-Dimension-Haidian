# 校园贡献规则与排行榜

## 权威账本与适用范围

校园模式沿用 `hd_events → hd_contributions → hd_scores → hd_outbox → Nakama`，不另建积分主库。旧 M0 事件和规则保持原样。积分来源仅限经过原系统审核的论坛发布、指定核验者确认的活动/志愿服务，以及有理由的管理调整。客户端和 Agent 不能上报“我要加分”。

`hd_campus_rules` 是版本化政策；`hd_campus_periods` 绑定学校、组织、学期、起止时间和规则版本；`hd_campus_rank_snapshots` 是可重建的冻结展示投影。学校榜仅统计学校范围贡献，组织榜只统计对应组织贡献，避免从学校总榜泄漏私有组织参与情况。累计榜累计当前可见范围的所有时期，学期榜按时期的 semester 聚合。同分按稳定的 userId 升序排序。

## 启用规则

1. 学校负责人预览并导入 `hyper-dimension.contribution-rules/v1` JSON。
2. 导入后为 draft；负责人填写审核理由并批准。版本内容不可修改，调整必须建立新版本。
3. 学校/组织负责人选择已批准规则，建立相应范围的时期，再明确激活。相同范围的有效时期不能重叠。
4. 示例明确标记 `exampleOnly: true`，激活还需 `acknowledgeExample: true`。安装包没有默认激活任何正式分值，用户后续提供运营材料后再导入、审核。
5. 激活之前、无有效规则或已冻结时到达的首次事件保留零分及原因，后续导入政策不追溯补算。

规则结构：

```json
{
  "schema": "hyper-dimension.contribution-rules/v1",
  "version": "fictional-example-v1",
  "exampleOnly": true,
  "label": "虚构示例，需学校自行确认",
  "dailyCap": 30,
  "rules": {
    "forum_published": { "points": 5, "dayCap": 10 },
    "activity_verified": { "points": 10, "dayCap": 20 },
    "volunteer_verified": { "points": 15, "dayCap": 30 }
  }
}
```

每日封顶按来源事件的 UTC 日期、用户、学校和组织计算。先取该类别日限，再取总日限。撤回不会重新释放当日额度，防止反复发布刷分。每笔账保存原规则版本、指纹、分值/封顶快照、来源版本和计分原因。人工调整不占日额度，但始终留有独立流水和审计理由。

## 重试、撤回与对账

投影失败按学校、用户和时期隔离。一次同步按开始时的最大 outbox ID 分页；失败主体的更高版本暂停，其他主体继续处理，避免前 100 条坏记录长期阻塞其他学校。失败行保留原分数、版本、尝试次数和净化错误分类，恢复后仍发送原版本。同步整体仍报告失败，不会把部分成功显示为全部健康。各校的聊天、附件、合作、奖励和论坛对账分别获得执行机会；一项异常不会跳过后续学校。不会为投影而恢复已撤权用户的登录权限。

- 同 eventId 和完全相同输入重试返回原结果；内容变化返回 409。旧事件不重新套用新规则。
- 论坛已发布内容的正文编辑不重复计分；撤回精确指向此前授分决策，不错误选择正文编辑产生的零分记录。
- 活动完整源链含报名、证明及审核事件，核验版本可以为 3、4 或更高。必须在 `hd_activity_events` 中找到完全相同原事件，核验者仍有该范围权限且不能自批。
- 撤回/核验撤销按原流水原分数冲正一次，即使当前规则已变化。允许对已离校用户保留纠错账；新增正分仍检查当前有效身份和组织资格。
- 管理员只能新增有理由的调整或冲正，不能编辑/删除历史分数。
- 冻结保留当时排名快照；之后的冲正仍更新权威账本及实时累计榜，但不会静默改写已冻结展示。负责人明确重建会生成新快照代次并保留旧代次。
- 重建以原始贡献账求和，修复 hd_scores 并发出更高版本 outbox；不重跑历史规则。Nakama 仅接受服务端桥接密钥及严格时期 ID，浏览器不能写榜。
- 新校园时期的 Nakama 原生读接口也拒绝浏览器直接访问，防止猜到组织时期 ID 后绕过 Base 的组织权限。读取统一使用 Base；服务端 `hd_projection_read` 只用于对账。旧 M0 时期的读取路径保留。
- 当前成员撤权后立即从榜单读取中隐藏，其历史流水仍保留。不存在“隐藏等于删除历史”。

## API

共同前缀 `/ledger/schools/:schoolId`，浏览器会话/OIDC 与现有账号一致。所有 POST 除 preview 都需要稳定 `requestId`；版本变动需要 `expectedRevision`；重试前先检查当前权限。

| 路由                        | 方法                                                                        | 用途                                                   |
| --------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| `/rules/preview`            | POST `{document}`                                                           | 负责人校验、指纹及虚构警告                             |
| `/rules`                    | GET / POST `{requestId,document}`                                           | 负责人查看全部规则 / 导入新版本                        |
| `/rules/:version`           | GET `?org=`                                                                 | 当前成员读取已批准规则                                 |
| `/rules/:version/approve`   | POST `{requestId,expectedRevision,reason}`                                  | 批准版本                                               |
| `/periods`                  | GET `?org=`                                                                 | 当前范围时期                                           |
| `/periods`                  | POST `{requestId,period,orgId?,semester,label,ruleVersion,startsAt,endsAt}` | 建立草稿时期                                           |
| `/periods/:period/activate` | POST `{requestId,expectedRevision,reason,acknowledgeExample?}`              | 激活，拒绝重叠                                         |
| `/periods/:period/freeze`   | POST `{requestId,expectedRevision,reason}`                                  | 冻结快照                                               |
| `/periods/:period/rebuild`  | POST 同上                                                                   | 从权威账恢复投影和新快照代次                           |
| `/entries`                  | GET `?org=&after=&userId=`                                                  | 本人分录，管理员可指定成员；按 ID 分页每页 200         |
| `/rankings`                 | GET `?org=&period=all&semester=`                                            | 累计/时期/学期榜，`rows` 含 userId/name/score/position |
| `/adjustments`              | POST `{requestId,userId,orgId?,period,delta,reason}`                        | 独立手工调整                                           |
| `/adjustments`              | POST `{requestId,userId,orgId?,period,reversesEntryId,reason}`              | 精确冲正原正分                                         |

`createCampusLedger(db,identity,services,config)` 返回 `{handle,recordContribution}`。活动模块在同一 PostgreSQL 事务里先写源事件再调用 `recordContribution(c,event)`；失败时源事件、状态与分数一起回滚。NodeBB 由原对账桥 `applyForumEvent` 在校园模式调用同一函数。

## 页面与验证

`/ranking.html` 提供当前范围榜单、本人计分说明、规则导入/预览/审核及时期管理。自动验证使用新的虚构组织、账户、真实隔离 PostgreSQL/Keycloak/NodeBB/Nakama 服务；不代表真实学生运营或正式学校规则验收。测试结果见 `qa/campus/campus-ledger-live.json` 和 `qa/campus/campus-ledger-browser.json`，只有文件内实际 PASS 才算相应验证完成。
