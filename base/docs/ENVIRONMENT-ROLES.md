# 地点角色、公告与反馈

这是校园 Base 的非破坏性地点服务模块。场景几何、房间及稳定实体 ID 继续由空间包维护；本模块绑定真实公开地点，提供负责人分配、审核公告和问题反馈。它不授予空间编辑权或读取他人私信的能力。

## 人员职责

| 身份           | 能做什么                                    | 权限来源                                     |
| -------------- | ------------------------------------------- | -------------------------------------------- |
| 匿名访客       | 参观、阅读已审核公告和明确公开的职务称谓    | 真实公开场景                                 |
| 已登录本校访客 | 提交问题/改善建议，查看自己的反馈及处理说明 | 当前有效学校成员；无需加入处理组织           |
| 地点受托负责人 | 本地点公告草稿、提交审核、认领及处理反馈    | 地点指派 + 当前有效学校/所属组织成员         |
| 本范围管理员   | 本地点公告审核/撤回，认领及处理反馈         | 当前学校或组织 moderator/owner               |
| 组织负责人     | 在已有本组织地点重新指派受托人和职务称谓    | 当前组织 owner；不能占用未分配或其他组织地点 |
| 学校负责人     | 首次绑定真实地点与处理团队，指派负责人      | 当前学校 owner                               |

角色不会根据贡献排名自动获得。人员授权仍使用 M1 学校/组织权限管理；地点负责人不是新增全校管理员。首次分配后的组织范围固定，避免将历史私有反馈静默转交另一个组织。

## 使用流程

1. 从空间当前房间进入“地点服务与反馈”。直接入口 `/environment.html?school=<schoolId>&sceneId=<sceneId>&entityId=<entityId>`。匿名空间入口也可用 `spaceId` 替代 `school`，由公开映射接口解析。
2. 学校负责人选择处理团队及现有成员。公开职务称谓须明确勾选；不要填写姓名、账号或联系方式。候选列表只向有分配权限的人展示。
3. 负责人写公告草稿并提交。当前范围管理员填写理由审核发布；驳回可修改再提交，已发布公告可带理由撤回。
4. 访客提交反馈后可回看进度。处理人员认领，标记处理中，再解决或驳回，均填写说明。有人已有效认领时不能抢占；其权限撤销后其他当前处理者可以接管。
5. 人员撤权后，管理入口、旧操作重放和管理队列都会重新拒绝。已提交者的反馈不会被自动删除；明确公开的职务称谓在受托人失去有效范围成员资格后隐藏。

## 数据与权限边界

- 所有写操作先锁当前学校权限，再锁地点业务；在返回旧回执之前复核当前资源权限。`requestId` 同路径/同输入重复返回原结果；改输入为 409。更新需要 `expectedRevision`，并发只有一个版本成功。
- 地点来自服务器 `world.packFor(school.spaceId)` 中的真实公开 room。客户端不能伪造另一学校、私有房间或几何锚点。
- 公开响应只有地点 ID、名称、公开职务称谓、已审核公告。不会包含用户 ID、私人反馈、草稿、作者或审核者身份。
- 反馈正文只有提交者和地点当前处理人员可以读取。最小通知仅含地点/反馈 ID 与状态，不包含反馈正文。正文不进入公开资料或接待模型。
- 仅取消某人的地点负责人职责、但其学校/组织成员资格仍有效时，本人可以保留此前收到的最小历史通知。`environment_assignment` 只有 `type/placeId`；`environment_feedback` 只有 `type/placeId/feedbackId/status`，没有标题、正文、提交者或联系方式，也不会通过通用通知查询补入标题。通知中的状态是发送时的历史快照，不表示仍有处理权限。进入管理队列或发起处理时会重读当前地点指派与权限；组织成员撤销后，组织范围的旧通知也动态隐藏。
- 操作写入 `hd_environment_events` 与既有 `hd_audit`，附原始版本、操作者和审核/处理理由。新建的四张表不修改现有学校数据、几何、背包、积分或原游戏。
- 已应用的 `campus-environment-001.sql` 不得改写；后续 schema 变更新增迁移。

## HTTP 契约

公共读取：

- `GET /environment/public/schools/:school/places?sceneId=&entityId=`
- `GET /environment/public/spaces/:spaceId/places?sceneId=&entityId=` 返回唯一映射的 `schoolId` 与公开地点；无映射 404，多校共享同一 space 时 409，不猜测学校。

以下前缀为 `/environment/schools/:school`，身份来自实际登录会话/Bearer：

| 方法/路径                                 | 输入或用途                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET `/places`                             | 公开地点和当前 `canAssign/canHandle/canReview/canFeedback`；只有当前处理/分配人员可见管理字段        |
| GET `/candidates?placeId=` 或 `?org=`     | 当前有效候选姓名与用户 ID，仅授权分配人员                                                            |
| POST `/places`                            | `requestId, sceneId, entityId, orgId?, managerUserId(null或UUID), publicRoleLabel, publishRoleLabel` |
| POST `/places/:id/manage`                 | `requestId, expectedRevision, managerUserId, publicRoleLabel, publishRoleLabel`                      |
| GET `/announcements?placeId=`             | 当前处理者的公告管理列表                                                                             |
| POST `/announcements`                     | `requestId, placeId, title, body`，建草稿                                                            |
| POST `/announcements/:id/edit`            | `requestId, expectedRevision, title, body`，仅草稿/驳回                                              |
| POST `/announcements/:id/submit`          | `requestId, expectedRevision`                                                                        |
| POST `/announcements/:id/review`          | `requestId, expectedRevision, decision(publish/reject), reason`                                      |
| POST `/announcements/:id/withdraw`        | `requestId, expectedRevision, reason`                                                                |
| GET `/feedback?placeId=&mode=mine/manage` | mine 仅本人；manage 必须指定地点且当前获权                                                           |
| POST `/feedback`                          | `requestId, placeId, kind(problem/suggestion), body`                                                 |
| POST `/feedback/:id/transition`           | `requestId, expectedRevision, status(claimed/in_progress/resolved/rejected), reason`                 |

公告 2–150 字标题、5–5000 字正文；反馈 5–3000 字；审核/处理理由 3–1000 字。终态反馈保留历史，不重新开启或覆盖。

## 验证

`tests/environment-live.mjs` 在全新虚构账号与组织上调用实际 PostgreSQL、Keycloak 和 HTTP 服务，覆盖锚点/跨校、候选范围、公告审核、十次精确重试、改输入冲突、反馈可见性、并发 CAS、撤权重放和接管。只运行于 `HD_M1_TEST_FIXTURE=1` 的独立校园数据库。新增地点绑定不会删除；重复执行应提供新隔离命名空间或尚未绑定的虚构公开地点。

`tests/environment-browser.mjs` 使用上述专用账号，以真实 Chrome 登录学校负责人、受托负责人、管理员和访客，验证公告/反馈全流程、撤权后的 UI 与 390px 窄屏。凭据只在忽略的 `.local` 目录，不进入交付包。证据写入 `qa/campus/environment-*.json/png`。

这些是一个主机上的自动验收；学校真实人员验收、目标 Ubuntu 服务器部署和物理多设备体验仍需另行确认。

本轮记录：`qa/campus/environment-live.json` **5/5 PASS**；`qa/campus/environment-browser.json` **5/5 PASS**，浏览器 pageerror 为 0。`qa/campus/environment-entry.json` **2/2 PASS**，重载后验证了匿名空间到学校的公开映射，以及旧榜入口拒绝/新授权榜仍可读。覆盖角色、撤权与真实私有反馈闭环。
