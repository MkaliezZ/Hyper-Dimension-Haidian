# 受控附件

校园模式将附件原始字节保存在 Base PostgreSQL 的 `hd_attachments.body`，与元数据、摘要和审核记录一起备份。附件不作为公开静态文件，不进入公开接待知识库。论坛和活动通过稳定的附件 ID 引用，实际业务源和当前权限共同决定能否下载。

## 当前边界

- 支持 PNG、JPEG、PDF、UTF-8 文本；检查文件名、编码、内容头与 MIME。单个附件最多 512 KiB，每位用户每学校保留字节最多 20 MiB。此限制用于轻量证明材料；批量大文件需要另行接入对象存储。
- `POST /attachments/schools/:school` 接收 requestId、name、mimeType、dataBase64、purpose、targetId、scopeId、可选 expiresAt。purpose 为 community、activity-evidence 或 organization-internal。
- community 绑定预分配的帖子 sourceId 和组织范围；活动证据绑定实际 activityId、对应组织范围与提交人。创建上传不等于发布，未被批准业务源引用的附件只有本人能读取。
- 下载 `GET .../:attachmentId/download` 再查当前学校/组织权限、真实业务引用以及附件状态，强制 attachment、octet-stream、nosniff。PDF/图片的文件头检查不代表病毒扫描；本实现不在页面中嵌入执行附件。
- 论坛附件随同源审核、隐藏、撤回和组织撤权失去读取资格。活动证明仅提交人和当前指定核验者读取，普通管理权限不自动授予证明原文访问。

## 生命周期

`POST .../:id/state` 使用 requestId、expectedRevision、status、reason。本人可 withdrawn 或 deleted：撤回即停止下载及后续核验，删除清除字节并保留摘要与审计。到期同样立即拒绝下载，后台清除未处于保留状态的字节。已完成业务记录保留其附件摘要，不能把删除附件等同于删除核验历史。

`POST .../:id/hold` 需当前业务允许读取且具相应范围管理权，填写 legalHold 与理由。保留只阻止删除字节，不恢复已撤回/到期文件的公开性。解除保留后仍按生命周期清理。不存在管理员批量查看所有私人文件的入口。

上传和状态变更使用学校权限锁与幂等回执；相同请求改变输入返回冲突。所有接口只使用当前身份，客户端不能传入另一个上传者。已应用迁移不可重写。

验证：`tests/attachments-live.mjs`、`tests/community-live.mjs`、`tests/activities-live.mjs`。实际结果位于校园验收记录；部署恢复必须同时恢复 Base 库以及 NodeBB 原生引用。
