# 校园 Base：集成能力参考

> 当前开发与交付流程统一见 [开发手册](DEVELOPMENT-MANUAL.md)。下文保留集成阶段来源及配置链接；阶段版本和候选措辞不代表当前交付状态。

本轮在 v0.5.0 之上补合作方业务 A2A、Ubuntu 全栈容器和自动向量更新，并加入论坛长期历史索引。旧包、学校项目和原数据库保留。最终通过项以 `evidence/integrations/ACCEPTANCE.md` 为准；缺少该文件时仍为候选包。

1. 完整账号与校园服务：[容器启动](docs/DEPLOYMENT-CONTAINERS.md)。原生 Ubuntu 启动方法仍在 `CAMPUS-START.md`。
2. 把自己的本地 Agent 接入合作服务：[业务 A2A](docs/PARTNER-A2A.md)。用户先在 `/delegations.html` 创建限定服务、操作和期限的授权；密钥只显示一次。
3. 接待资料由学校负责人在 `/knowledge.html` 审核发布，自动进入队列更新向量。论坛历史在 `/history.html` 按当前学校与组织权限查询：[索引与历史](docs/AUTOMATIC-INDEXING.md)。
4. 人物保留简单部件搭配、存档恢复、背包与非破坏性道具。本轮不增加重型捏脸。P2 不在本轮。

用户补交的两份运营材料已完成私有结构转换，并用于年度运营能力的功能补全，见 `docs/ANNUAL-OPERATIONS.md`。原文件与实际转换内容不进入通用源码 ZIP、公共知识库或容器镜像。通用包只含原创示例和转换工具；新模块验证见 `evidence/annual/ACCEPTANCE.md`。

首次只问“这是做什么用的？怎么用？”仍按 `AGENT-START.md` 引导，不要求用户先复制提示词或研究部署命令。
