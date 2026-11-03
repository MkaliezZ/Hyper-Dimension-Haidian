# 校园个人主页与作品

从 `/profile.html` 登录自己的学校账号，可以编辑简介、院系、年级或届别与兴趣，选择每个字段的“仅自己 / 同校成员”，展示实际加入的组织、作品与社区徽章。对方分享成员 ID 或名片地址后，可在同校权限内查看；不提供全校人员名录，不展示邮箱、电话或其他私人联系方式。

基础资料继续使用 `hd_m2_profiles`，人物页与个人主页保存的是同一份记录。组织与角色来自 M1 当前有效的组织成员关系，用户只能选择其可见范围，不能改写身份。退出组织或学校后，读取时立即重新检查。个人数据、草稿、作品和徽章不会自动进入接待 Agent 的知识库或模型上下文。

## 作品与徽章

- 作品包括标题、介绍和可选 HTTPS 链接，支持草稿、发布、撤回。只有“发布 + 同校成员”才向其他本校成员展示。每个人每校最多保留50件作品（含撤回），保存修订历史；无物理删除接口。相同请求重试不会重复创建，旧版本更新会明确冲突。
- 外部作品以普通链接打开，标明会离开空间；不抓取、不嵌入、不执行链接内容。拒绝脚本/data/http、URL账号密码、IP、本机域名和非443端口。只接受外部 HTTPS 网址，并不代表已审核外站的内容。
- 徽章由本校现任负责人发放，必须填写理由；默认仅接收者可见，由接收者决定是否对同校展示。负责人可以有理由地撤回。发放/撤回保留审计和幂等回执，成员不能自授或修改他人徽章。每人每校最多100个有效徽章。
- 徽章固定标记 `community-recognition`，属于学校空间社区认可，**不是学籍或法定身份认证**。审核真实身份需要学校另行接入正式身份流程。

## 接口

前缀 `/personal/schools/{schoolId}`，全部要求已验证账号与本校学校级成员，组织限定的 affiliate/partner 不获得全校资料访问。没有匿名个人资料接口。

| 方法与路径                | 用途                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ |
| GET `/me`                 | 自己的基础资料、组织、全部作品、徽章与可见范围                                       |
| GET `/profiles/{userId}`  | 当前同校成员允许展示的基础字段、组织、已发布作品和有效徽章                           |
| POST `/preferences`       | `requestId,expectedVersion,organizationVisibility`，以组织ID映射到private/school     |
| POST `/works`             | `requestId,expectedVersion,title,description,link,status,visibility`；修改附`workId` |
| GET `/badges/manage`      | 本校负责人最近100个发放记录，仅身份ID、名称、版本与状态，不含私人资料                |
| POST `/badges/issue`      | 负责人：`requestId,userId,label,reason`                                              |
| POST `/badges/revoke`     | 负责人：`requestId,badgeId,expectedVersion,reason`                                   |
| POST `/badges/visibility` | 接收者：`requestId,badgeId,expectedVersion,visibility`                               |

基础资料保存沿用 `/m2/schools/{schoolId}/profile`，不会另建竞争来源。个人读取、组织权限变更、写入均在权限锁下重新校验；CAS版本、业务修改、历史、回执及审计同事务提交。缓存响应前也先检查现任角色。UI网络错误保留请求ID，以便同内容重试。

## 数据升级与验收

新增不可回写的 `database/m2-002.sql`；包含个人组织可见设置、作品、作品历史与徽章四张表。既有 `m2-001` 与人物、背包、基本名片数据均不修改。沿用 Base 完整业务数据库备份，不另建个人资料数据库。先在独立恢复实例追加迁移并验收；不得覆盖旧包、用户项目或原运行库。

```sh
node tests/personal-unit.mjs
HD_M1_TEST_FIXTURE=1 HD_M0_CONFIG=/path/to/isolated/private/config.json node tests/personal-live.mjs
# 浏览器测试另需 HD_QA_CHROME 指向隔离测试浏览器；Windows 可使用私有 QA 账号配置。
HD_M1_TEST_FIXTURE=1 HD_M0_CONFIG=/path/to/isolated/private/config.json HD_QA_CHROME=/path/to/chrome node tests/personal-browser.mjs
```

验收覆盖学校隔离、单一资料来源、字段和组织隐私、实际组织退出、作品草稿/发布/撤回、重试与并发、链接负向输入、徽章越权/幂等/撤回，及两个独立浏览器上下文的读写、撤回和移动布局。实际测试输出位于 `qa/personal`；自动化浏览器不是物理多设备或真实学校用户验收。生产服务器、真实学校身份与人工内容审核仍需按部署流程验收。
