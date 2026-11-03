# 学校资料库：PostgreSQL＋pgvector＋Embedding

## 组成与选择

资料导入 → 审核公开状态 → 350 字分段/50 字重叠 → Embedding → PostgreSQL 的 pgvector 列 → 余弦检索 → 引用片段 → Hermes 回答。

**数据库和 Embedding 不是替代关系**：数据库存储和检索向量，模型生成向量。本包使用成熟的 pgvector，不自造向量数据库；同一套 SQL 有两种部署：

| 方式                      | 适用                   | 需要                                        | 数据位置                     |
| ------------------------- | ---------------------- | ------------------------------------------- | ---------------------------- |
| PGlite＋pgvector          | 本机演示、首个学校空间 | 已随完整包提供的 Node 运行库                | `<data>/knowledge-postgres/` |
| 独立 PostgreSQL＋pgvector | 学校/公司服务器        | 已安装或托管的 PostgreSQL，启用 vector 扩展 | 管理员指定的数据库           |

PGlite 是现成的嵌入式 WASM PostgreSQL，不是 JSON 向量模拟。它是单写进程参考部署，不等同于独立 PostgreSQL 的多人并发/运维能力。MySQL 不是本轮实现的后端；不要把 MySQL 连接串填入 PostgreSQL 配置。

## A. 本机直接用：推荐首轮流程

### 1. 准备 Embedding Python

本包已附 `models/bge-small-zh-v1.5/`：固定版本的中文 BGE 小模型、ONNX 权重、分词器、模型卡、许可证和 SHA 清单，约 24MB；推理本身无需联网。模型文件不包含用户数据。

可先复用已有 Hermes Python，确认装有以下依赖；也可独立建立 Python 3.11+ 环境：

```sh
python -m venv .venv-embedding
# Windows
.venv-embedding/Scripts/python.exe -m pip install -r requirements-embedding.txt
# macOS/Linux 使用 .venv-embedding/bin/python 替换上面的路径
```

若使用已有 Hermes 环境，避免任意升级它的依赖；用其现有兼容库或建立独立环境。本次用 ONNX Runtime 1.28.0、tokenizers 0.23.1、NumPy 2.4.3 验证。Python/平台 wheel 需按运行环境安装，不捆绑到跨平台 ZIP。

### 2. 建立数据库配置与表

以下命令中的 Python 路径换成本机实际路径。全流程都用相同 `--data`：

```sh
node tools/knowledge.mjs configure --python .venv-embedding/Scripts/python.exe --data .local-campus-a
node tools/knowledge.mjs init --data .local-campus-a
```

生成的 `knowledge.json` 默认选择 pglite、512 维本地中文模型。init 应显示 `PostgreSQL + pgvector schema ready`。已有配置不会被覆盖。若刚解压只运行示例，可先用 examples/north/space.json 代替学校包。

### 3. 准备并导入学校自己的信息

将经校方确认可公开的内容整理成 UTF-8 JSON 数组，格式参照 `examples/knowledge/campus-documents.json`，保存到 `projects/campus-a/documents.json`：

```json
[
  {
    "id": "library-rules",
    "title": "本校图书借阅规则",
    "body": "请填校方确认的真实规则，不要沿用虚拟示例的借阅数量和时长。",
    "published": true,
    "revision": 1,
    "sourceLabel": "校方公开学生手册 / 图书馆章节"
  }
]
```

`published` 必须显式为 true 才会向量化和入库；false、缺失、字符串 true 都不入库。相同学校内文档 ID 唯一，改内容时保留 ID 并增加 revision。可附 sceneId/entityId 关联房间，但不要把本地文件绝对路径当公开来源名称。

Word、PDF、网页导出等先由维护 Agent 提取并校对为上述格式：保留原件索引、标题、页码/章节和公开授权。扫描图需 OCR/图像识别；本轮导入器不冒充已实现任意二进制文件的自动提取。

```sh
node tools/knowledge.mjs import --space projects/campus-a/space.json --input projects/campus-a/documents.json --data .local-campus-a
node tools/knowledge.mjs status --space projects/campus-a/space.json --data .local-campus-a
node tools/knowledge.mjs search --space projects/campus-a/space.json --query "借书要带什么证件？" --data .local-campus-a
npm start -- --space projects/campus-a/space.json --data .local-campus-a
```

接待现在会把向量命中与空间公开条目一起交给模型，回复保留文档 ID、修订版和来源标签。没有回答模型时直接展示检索资料；通用聊天需另外配置 Hermes。`/health` 的 knowledge 应显示 `pglite-pgvector`。

### 4. 更新、撤回与备份

导入是**该学校完整资料快照的事务替换**，不是盲目追加。输入改变时默认拒绝覆盖；核对后执行相同 import 命令并加 `--replace`。从快照删除文档或改成 published:false，重新导入后旧片段原子撤回；其他学校行不变。相同资料、相同模型再次导入复用索引，不重复调用 Embedding。

本机 PGlite 开库期间不可从另一进程同时导入。先 Ctrl+C 停 Base，再导入并重启；数据库文件有拥有者锁，不得抢占/直接删除。进程已死且锁遗留时：

```sh
node tools/knowledge.mjs recover-lock --data .local-campus-a
```

此命令只移除经核实已死亡进程的锁。备份前停止服务，保留整个 data 目录、documents.json、space.json、素材和模型清单。更换 Embedding 模型/维度后必须重新索引；服务拒绝用不同模型直接搜索旧向量。

## B. 使用已有 PostgreSQL 服务器

1. 准备**专用数据库**，由 DBA 安装 pgvector。`database/knowledge.sql` 只创建 vector 扩展与 hdbase_kb 命名空间，不改其他业务表。首次初始化需建扩展/表权限；正式运行账号只授予所需查询权限，导入账号另授写权限。
2. 复制 `config/knowledge.postgres.example.json` 到所选 data 目录并命名 knowledge.json，修改 Embedding Python 路径；或 configure 命令增加 `--database postgres`。
3. 用本机密钥管理注入 `HDBASE_DATABASE_URL`，形如 `postgresql://USER:PASSWORD@HOST:5432/DATABASE`。不要将真实连接串写入包。外部连接按 DBA 要求使用经过验证的 TLS。
4. 运行上述 init/import/status/search/start 命令，使用同一 data 目录。表结构、学校隔离和引用链路相同。独立服务器允许导入事务与接待查询并存；替换提交前旧快照可见，提交后新快照可见。

已装 Docker 的机器可参考 `database/compose.yaml` 起一个单独演示 PostgreSQL：先安全设置 HDBASE_POSTGRES_PASSWORD，再执行 `docker compose -f database/compose.yaml up -d`，连接 127.0.0.1:54329。此动作由使用者明确执行，Base 不自动安装/启动 Docker，不复用或覆盖已有数据库。命名卷需纳入管理员备份；`down -v` 会删除库数据，不用于日常停止。

早期 Base 验证使用 PGlite 内的 PostgreSQL＋pgvector。校园 v0.5.0 另已在独立 WSL Ubuntu 数据库验证原生 PostgreSQL 18.6 / pgvector 0.8.1 的 TCP 连接、学校隔离、原子替换、持久化与备份恢复，并跑通真实 ONNX→原生 PostgreSQL→本地 Hermes→A2A 链路。证据见 `evidence/campus/knowledge-postgres.json` 与 `evidence/campus/knowledge-native-model-live.json`（路径相对包根）。未连接用户真实数据库，目标服务器部署仍需复测。默认使用精确余弦排序；小样本检查不代表生产吞吐，规模增大后再按访问模式评估 HNSW。

## C. 复用已有 Embedding 服务

不想在本地装 Python 时，可把 knowledge.json 的 embedding 对象换成 `config/embedding.ollama.example.json` 或 `embedding.http.example.json` 的配置，填写**真实模型、端点和维度**。Ollama 必须已有适合资料语言的 Embedding 模型；HTTP 支持兼容 `/embeddings` 的服务。密钥只从指定环境变量读取。

提供方与模型一经改变就重建索引；同一向量库不能混用两个模型的向量。DeepSeek 回答模型不能直接当作 Embedding 接口。本轮真实验证本地 ONNX 模型；Ollama、云 Embedding 配置属于可选适配，需用实际服务验证。

## 公开边界与验收

只导入公开白名单，按 spaceId 查询。未公开的原件不进模型、不进向量库；不要把“先全导入再让模型保密”当权限控制。学校索引更新后，引用已撤回文档的旧助手历史不会再发给回答模型。数据库连接配置属于维护者，不由访客指定。

最少验收：自有资料的改写问法命中正确片段；回答引用该条资料；另一所学校检索不到；撤回后不命中；相同导入不重复 Embedding；重启后索引保留。工具成功不代替校方核实内容。

来源：[pgvector 官方](https://github.com/pgvector/pgvector)、[PGlite API](https://pglite.dev/docs/api)、[BGE 原模型](https://huggingface.co/BAAI/bge-small-zh-v1.5)、[ONNX 转换](https://huggingface.co/Xenova/bge-small-zh-v1.5)、[Ollama Embedding](https://docs.ollama.com/api/embed)、[阿里云 Embedding](https://help.aliyun.com/zh/model-studio/embedding)。文档中的服务配置示例不代表已配置学校账号或已获云服务额度。
