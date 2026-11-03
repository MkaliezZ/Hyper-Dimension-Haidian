# 通用奖励与权益

本模块实现 AC28 的通用奖励流程。入口为 `/rewards.html`，使用现有学校账号；管理者建立规则，经过提交、审核和明确发布确认后，符合条件的成员自行领取。系统默认没有已生效的真实奖励，不内置学校奖励预算、贡献权重或用户尚未提供的运营规则。

## 参与者如何使用

1. 进入“发现奖励”，查看学校/组织、所需贡献、有效期、总份额和实际用途。
2. 明确确认领取条件；演示奖励还需单独确认其演示性质。
3. 查看“我的奖励”中的实际发放结果与轨迹。失败记录保留原份额，可用同一领取记录重试；不要重新建立领取请求来掩盖失败。
4. 根据用途进入个人档案、形象编辑器、指定活动或校园周边领取凭证。奖励不会赋予学校、组织或论坛管理权限。

| 类型                  | 权威落点                                     | 使用与撤销行为                                                                             |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 社区徽章 `badge`      | 既有 `hd_personal_badges`，默认 private      | 本人选择展示范围；撤销只更新该次发放的徽章；到期立即从公开展示排除                         |
| 外观资格 `appearance` | M2 的 `hd_m2_items` 与库存事件               | 允许使用新增的社区绶带；服务端在预览、保存和读取模型时核验有效资格；撤销后不悄悄改写旧配方 |
| 活动资格 `activity`   | M2 的权威资格物品，关联实际活动              | 仅对明确绑定的新建活动启用准入；原有活动不受影响；报名时检查资格，历史参与记录保留         |
| 合作权益 `partner`    | 既有合作方 offer 库存及 `hd_m5_entitlements` | 使用原凭证/核销流程，奖励表只保存凭证引用；已核销凭证不能伪造撤销                          |

### 外观版本与旧存档

新增 `campus-rewards-3` 为可选的 v3 目录，只有一件原创配饰 `accessory-community-ribbon`。v1/v2 的既有 GLB 字节及目录未替换。已有角色须在编辑器中明确确认版本迁移；v1 先迁移 v2，再按需选择 v3。原有免费部件仍开放，不追溯增加奖励门槛。

撤销或过期的绶带配方仍保存在原角色记录中，以保留历史；服务端拒绝继续生成/读取带失效资格的模型。用户可改选免费配饰并保存。不是以丢弃存档来实现撤销。

`node tools/rewards-assets.mjs` 校验原 62 件 v1/v2 部件 SHA-256 后，只构建新增配饰与 v3 目录。新素材来源和许可位于 `assets/avatars/v3/PROVENANCE.md`、`LICENSE`。

## 管理者如何配置

“组织者工作台”只允许当前学校负责人或对应组织负责人使用，服务端每次操作重新核验权限。草稿包含用途、说明、组织范围、贡献阈值、贡献周期、总份额、起止时间及奖励性质。

- 状态：`draft → pending → published/rejected`，退回可编辑，发布后可以撤下。
- 发布演示奖励必须明确 `publish-demonstration`；真实奖励必须明确 `publish-real-reward`。界面要求勾选用途确认，不能从导入模板自动发奖。
- 贡献口径为现有 `hd_contributions` 中本学校、本人、对应组织范围的 `sum(delta)`，可限定周期。领取保存当时的资格依据。奖励不会扣除或改写历史贡献。
- 一个奖励每个账号终身只有一条领取记录；学校/组织跨范围访问、改写目标、重复领取均受服务端约束。
- 组织外观、活动和合作资格还要求本人当前已加入该组织。管理权限不会自动赋予参与资格；未加入者在分配份额前即被拒绝，界面提示走正式成员流程，不自动增加成员。
- 总份额采用“累计已分配”口径。失败会占住原份额供重试，撤销/过期不自动回收再发。需要新一轮奖励时建立并审核新的奖励批次。
- 绑定活动资格时，活动必须是同范围的新草稿且无人报名；只有审核奖励后才建立活动准入关系。已有同活动资格关系可供新的奖励批次复用。
- 合作权益必须引用同范围、已发布、当前有效的 offer 版本与有效合作方；奖励期限不能超过 offer 期限。原 offer 的库存、每人一次和贡献限制继续适用。
- 撤下奖励停止新领取；已经发放的权益按原期限兑现。逐条撤销需明确原因，会精确冲正原权威记录并保留来源。

## 回执、失败与有效期

领取流程为 `reserved → fulfilled/failed`。数据库事务把权威发放、审计、库存/徽章/凭证记录及处理回执一起提交。下游发放错误通过保存点撤回局部写入，原领取记录保留 `failed`、安全错误码、尝试次数和预留份额。

本人可对失败记录执行 `retry`。重试重新检查当前资格、权限、时限和目标状态，沿用同一 claim，不新占份额。API 的同一 `requestId` 与内容重放返回原回执，内容不同返回 409；失败后的“再次履约”是单独请求，不能把旧失败回执改写成成功。

自然到期后，外观/活动检查与徽章展示立即拒绝失效权益。后台 `reconcile(schoolId)` 持久化过期记录并执行对应权威冲正。即使队列暂时未执行，也不能继续使用过期资格。已经核销的合作凭证自然到期时保留核销事实；人工撤销该凭证返回冲突，不假装物理履约已被撤回。

报名之后资格到期或撤销，不自动抹除已成立的活动报名和历史参与。后续新报名必须重新通过资格检查。

## API

前缀 `/rewards/schools/:school`。Cookie/OIDC 认证沿用现有账号。所有对象变更需要 `requestId`；修改/审核/领取已有对象需要 `expectedRevision`。错误不会返回凭据、私钥或原始外部响应。

| 方法与路径                 | 主要输入或结果                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET `/status`              | 模块与合作权益 hook 是否连接，`defaultAwardsEnabled:false`，可选外观物品，以及本人 `managedOrgIds`/`participationOrgIds` |
| GET `/items`               | 当前获准已发布奖励、管理者可见草稿及 `canManage`、`available`                                                            |
| POST `/items`              | 创建草稿，字段见下文                                                                                                     |
| POST `/items/:id/edit`     | 只可编辑草稿/退回稿，不能变更原组织范围                                                                                  |
| POST `/items/:id/submit`   | 提交审核                                                                                                                 |
| POST `/items/:id/review`   | `decision:publish                                                                                                        | reject`、`reason`、发布时 `confirmation` |
| POST `/items/:id/withdraw` | `reason`，停止新领取                                                                                                     |
| POST `/items/:id/claim`    | `acceptedTerms:true`；演示奖励还需 `acknowledgeDemonstration:true`                                                       |
| GET `/claims`              | 本人的有效范围内领取记录、权威回执和有效状态                                                                             |
| GET `/claims/:id/history`  | 本人或对应管理者查看该记录及版本化事件                                                                                   |
| POST `/claims/:id/retry`   | 本人的失败领取重新履约                                                                                                   |
| POST `/claims/:id/revoke`  | 对应负责人，`reason`；冲正精确原发放                                                                                     |
| GET `/manage`              | 当前管理范围内最近 200 条领取记录                                                                                        |
| POST `/reconcile`          | 空正文，学校负责人手动触发到期对账                                                                                       |

草稿字段：`orgId|null`、`kind`、`title`、`description`、`target`、`minimumContribution`、`contributionPeriod|null`、`stock`、`startsAt`、`expiresAt`、`demonstration`。时间为 ISO。目标分别为：

```json
{"kind":"badge","target":{"label":"校园共同建设者"}}
{"kind":"appearance","target":{"itemId":"appearance:community-ribbon"}}
{"kind":"activity","target":{"activityId":"实际新草稿的 UUID"}}
{"kind":"partner","target":{"offerId":"实际已审核 offer 的 UUID","offerRevision":3}}
```

上述仅为输入形状，不是生效规则，也不会自动创建任何真实奖励。

## 集成合同

```js
createRewards(db, identity, services, config, {
  issuePartnerEntitlement: partners.issueReward,
  revokePartnerEntitlement: partners.revokeReward,
}); // -> { handle, reconcile, validateOperationsReward }
```

- `reconcile(schoolId)`：后台或负责人触发，对过期 fulfilled/failed 记录执行精确处理。系统审计标记 `actorKind:system`，不冒用人类核验者。
- `validateOperationsReward(c,{schoolId,orgId,rewardId,userId})`：在调用方同事务内核对当前管理权限、奖励范围、已发布状态和期限，返回引用信息。供运营排期绑定，**不发奖**。
- `partners.issueReward(c,{schoolId,userId,offerId,expectedRevision,rewardClaimId,actorId,expiresAt})`：沿用合作权益权威表、库存和一次领取约束，在同事务发放凭证。凭证采用该次奖励的期限，不得晚于原 offer 期限，因此到期拒绝核销不依赖后台对账时机。
- `partners.revokeReward(c,{schoolId,entitlementId,rewardClaimId,actorId,reason,expired})`：校验精确 claim 引用后撤销；保留已核销事实。
- `hasRewardItem(c,school,user,item)`、`requireRewardAppearance(c,school,user,recipe)`、`requireActivityReward(c,school,user,activityId)`：使用当前权威库存和未过期发放来源，校验组织范围，不能由客户端宣称拥有资格。

权限锁、信息锁、奖励锁、请求回执锁均位于事务内；取得锁后再次校验 ACL，再读旧回执。源表与库存表均在现有 PostgreSQL 备份范围内。完整跨服务备份/恢复及目标 Ubuntu 部署仍以根级交付验收记录为准，不由单项模块测试替代。

## 自动验证与边界

在隔离测试配置中设置 `HD_M1_TEST_FIXTURE=1` 后运行：

```sh
node tests/rewards-live.mjs
node tests/rewards-browser.mjs
```

浏览器脚本另需 `HD_QA_CHROME` 指向专属测试浏览器。`HD_M0_CONFIG`、`HD_M0_USERS` 指向私有配置。live 脚本创建专属虚构账号，浏览器凭据临时保存在被忽略的 `.local/rewards-browser-fixture.json`，不可收入交付包；已有用户头像和数据不被重写。

服务端在隔离 campus 的实际 PostgreSQL 上已完成 6/6 检查（见 `qa/rewards/live.json`）：权限及明确演示确认、贡献资格、10 路并发只分配一次、实际徽章与历史分不变、v1/v2 字节保持与 v3 存档/撤销、仅新绑定活动准入、到期、合作凭证与失败后同 claim 重试。浏览器 5/5 通过（`qa/rewards/browser.json`）：实际徽章领取与撤销历史、外观资格与新上下文恢复、窄屏布局、组织负责人入口及管理权不等于参与资格的提示。原有头像扩展验证 `tests/avatar-extension.test.mjs` 5/5 通过。只有对应最新记录为 PASS 才代表该轮已通过。

这些是单主机独立浏览器上下文和虚构账号的自动检查，不代表真实学校发奖、用户参与、物理多设备验收或外部商家实际履约。用户后补运营材料、官方奖品条件和预算应经版本化审核后接入；当前没有擅自设定真实奖品。
