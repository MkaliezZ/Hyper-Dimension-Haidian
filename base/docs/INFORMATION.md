# 校园订阅与信息通知

完整校园模式 `campusEnabled:true` 提供 `/inbox.html`。学校成员选择学校或已加入组织、订阅公告/社区/活动/合作主题，设置是否接收订阅通知；未读可离线补取、标记已读。业务必要回执与私信由原入口保留，不因订阅退订而删除。

`hd_notifications` 继续作为同一个个人通知收件箱。订阅内容只存来源引用，阅读时按当前学校/组织成员资格和源发布状态重新投影标题。撤回、到期或失去组织资格后，旧游标和原 M1 通知接口均不再返回该内容。退订只阻止后续分发，先前已收到且仍有权限的记录保留。

`publishInformation(transaction,event)` 是可信服务端接口，业务提交时同事务写入事件、当前来源版本和通知。没有接收任意客户端 eventId、分数或代发者的公共接口。学校/组织负责人可发布该范围内公告；不可发布到其他范围。相同事件十次重试只产生一条通知，输入变化冲突。每个来源版本顺序推进，发布和退订用同一事务锁建立明确先后关系。后台不把私信、人物收藏或未发布作品推送到接待知识库。

## 接口

前缀 `/information/schools/{schoolId}`，当前登录身份为权限来源：

| 路由                     | 用途                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| GET subscriptions        | 本人仍有范围权限的订阅、版本                                                                     |
| POST subscriptions       | requestId、expectedRevision、scopeId（空串表示学校）、topic、active                              |
| GET/POST preferences     | enabled和revision；写入附requestId/expectedRevision                                              |
| GET inbox?after=ID       | 本人范围内通知和下一页cursor，最多100条；不可见条目也推进游标                                    |
| POST read                | 本人的通知id；越权返回404或403                                                                   |
| GET announcements?org=ID | 当前有效公告；返回canPublish表示当前是否可管理                                                   |
| POST announcements       | requestId、sourceId、expectedRevision、scopeId、title、status published/withdrawn、可选expiresAt |
| POST expire              | 学校负责人执行过期清理，附requestId；清理标题，保留来源ID、指纹与审计                            |

目录、公告和其他公开投影均须按真实源状态访问。公告截止时间由负责人填写，系统不替学校写死统一保留天数。原始聊天仍使用已有独立留存治理。订阅的社区/活动/合作主题是公共能力接口，只有对应业务接入可信事件发布后才会有该类动态；不能把主题勾选当成各业务全部完成。

## 合作资料接待

启用 `partnersEnabled` 后，接待每次重新查询已审核、未到期且合作方仍有效的资料，来源标记 `reviewed-partner`。合作信息更新/退出后，旧来源历史不能再次注入模型；模型回答期间撤回也会拒绝返回旧回答。预约仍需用户在合作服务界面检查接收方和字段后明确确认，接待回答不触发确认、发券或核销。

## 验证

隔离 Ubuntu 实例设置 `HD_M0_CONFIG`、`HD_M1_TEST_FIXTURE=1` 后运行 `node tests/information-live.mjs`；接待来源变更运行 `node --test tests/information-reception.test.mjs`。用虚拟账号验证订阅、重复投递、偏好、离线补取、撤回、过期、当前成员撤权，测试结果不等于真实学校运营。
