# 复制给 Codex：把自有资料建成接待知识库

> 执行前先读 [统一开发手册](../DEVELOPMENT-MANUAL.md) 与 [AGENTS](../AGENTS.md)。本文是分项清单；当前版本、运行模式、验证和打包以统一手册为准，保留旧包与用户数据。

请读取 docs/KNOWLEDGE.md 和当前学校 projects/【campus-a】/space.json，将我授权的【资料文件列表】整理为学校 documents.json。原件保留在私有输入目录，逐条标明可公开状态和页码/章节来源；未公开条目在 Embedding 前排除。不要把扫描 PDF 的未校对 OCR 当已核实事实。

优先使用【本地 PGlite＋pgvector / 已有 PostgreSQL＋pgvector】，Embedding 使用【包内中文 ONNX / 已有服务】。读配置模板，检测现有环境；连接串和密钥只通过私有环境配置，不能进入日志、Git 或交付包。维护既有 ID，资料更新增加修订号；更换模型后重建索引，不能混用维度。导入为学校完整快照，已有不同索引时先核对再 --replace，不影响其他学校。

验证：至少三条用不同措辞提问的自有资料问答应引用正确来源；一条未知问题不编造；未公开条目从未送去 Embedding；跨校查不到；修改和撤回生效；重复导入不重复 Embedding；重启后库保留。只有数据库/Embedding/Hermes 的实际调用成功才能记录相应 PASS。返回操作命令、来源索引、实际结果与未完成项。
