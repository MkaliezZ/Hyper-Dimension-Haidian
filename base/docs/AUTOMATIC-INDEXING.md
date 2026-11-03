# 自动向量更新与论坛历史

## 两种资料分别管理

| 资料 | 权威来源 | 检索入口 | 可见范围 |
|---|---|---|---|
| 审核后的接待资料 | 学校负责人发布的版本快照 | `/knowledge.html` 发布；接待 A2A 查询 | 本校公开发布资料；不含未发布输入 |
| 论坛正文与审核历史 | NodeBB 原生正文、审核修订和当前状态 | `/history.html` | 当前学校/组织 ACL；不进入公共接待模型 |

人物私人档案、私信、联系人、私人收藏、附件原件、未审稿件和个人 Agent 长期记忆均不自动导入。空间包的公开导览与已审核合作服务仍由各自发布入口管理。

## 自动流程

负责人在 `/knowledge.html` 提交该校完整的审核资料快照，服务器维护文档修订号，以学校级 expectedVersion 做并发校验。保存与 pg-boss 入队在同一 PostgreSQL 事务中完成。向量 worker 使用现有 ONNX/BGE embedding 和 PostgreSQL/pgvector，原子替换该学校的公开索引；重复快照复用向量。

论坛已审核发布、审核后的编辑、撤回以及父帖状态变化，由原生源扫描自动发现并入队。队列只传学校、源 ID、generation 和修订游标，不传正文、令牌或个人联系方式。每批最多处理 20 个历史修订；批次检查点与后续任务一起提交，可跨进程恢复。过期任务只结束自身，不覆盖较新来源。

原生 NodeBB 保存审核版本，Base 中的向量是可重建投影。已有旧内容首次接入时只建立可信的“当前内容基线”，不会声称已还原安装前未记录的全部历史版本。之后的审核版本自动持续记录。默认只查当前版本，勾选“包含历史审核版本”后显示历史标记和当前修订号。

新公开快照提交后，检索和 A2A 缓存结果立即按最新发布集合过滤；撤回不依赖 embedding 任务先跑完。论坛每次返回结果前重查当前组织权限和原生源状态，源撤回、父帖下架、权限撤销或正文漂移后不返回旧内容。后台再删除失效的向量投影。历史资料不进入公共接待上下文。

## 队列、失败与资源

- `campus-knowledge-index` 与 `campus-forum-index` 使用 pg-boss。自动重试有上限，失败保留诊断与队列身份；学校负责人从既有任务管理页查看和重试，不能以无限重跑掩盖错误。
- `GET /knowledge-admin/schools/:school/status` 可看公开快照版本、各源是否追平、索引修订和 jobId。
- `GET/POST /knowledge-admin/schools/:school/documents` 仅学校负责人；POST 需 `requestId, expectedVersion, confirmed:true, documents`。
- `POST /history-index/schools/:school/search` 需正式成员身份，参数 `query, orgId, includeHistory`；每次校验当前 ACL。
- 默认 embedding 只并发 1 个短时进程，最多排队 16 个请求；超量返回忙，排队取消不启动模型。每次模型进程结束释放内存。可在私有 embedding 配置中设置 `maxConcurrency`（1–4）和 `maxQueued`（0–100），按实际机器验证后调整。

完整备份必须同时包含 Base、NodeBB 与独立知识 PostgreSQL。原有七库备份工具会包含新增的审核快照、队列、索引检查点和向量历史；恢复只进新命名空间。不能单独回滚向量库后宣称全栈恢复完成。

`tools/knowledge.mjs import` 保留给独立 Base-1/历史维护流程。校园账号模式已启用审核快照时，应走本节发布接口，避免绕开当前资料集合的治理。管理员原件留在私有项目，不放进通用 ZIP。

验证：`tests/indexing-live.mjs` 连接实际隔离 PostgreSQL/pgvector、NodeBB 和 pg-boss；`tests/embedding-limit.test.mjs` 检查并发与排队取消。测试不是校方内容核实或实际运营效果验收。
