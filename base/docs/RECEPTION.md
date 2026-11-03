# 接待 Agent 与本地 Hermes

## 能做什么

- 一般问候、学习建议、创意、写作与简单推理：调用模型，返回 `basis=general`，不冒充学校资料。
- 本空间的具体事实：检索 `knowledge.published=true`、已发布展项和场景中 `access=public` 的房间名称、楼层与说明，返回 `basis=published` 和来源。
- 学校自有资料：可按 [KNOWLEDGE.md](KNOWLEDGE.md) 导入 PostgreSQL/pgvector，先向量检索当前学校的公开片段，再交给接待回答，保留文档与修订来源。
- 未提供的学校归属、电话、校长或活动等：不编造，返回 `basis=unavailable`。图纸中的概念房间不证明真实学校身份或运营信息。
- 连续追问：浏览器传递 A2A `contextId`，服务端仅取同一身份、空间、Agent、上下文下最近四个已完成问答，最多八条、每条 2000 字。刷新/重新打开空间开始新对话；A2A 客户端可保留 contextId 跨服务重启续聊。历史帮助理解，不是事实来源。

没有模型时仍能检索资料、导航和留言，但不提供通用智能。HTTP `/health`、`/api/catalog` 的 `receptionProvider`、`generalConversation` 显示实际配置；页面不把规则检索显示为模型回答。

## 本地 Hermes 配置

先在此机器安装可运行的 Hermes Agent 和它的 Python 环境。Base 不捆绑另一份 Hermes、Python 或模型密钥。

在所用数据目录创建 `reception.json`，参考 `examples/reception.hermes.json`：

```json
{
  "provider": "hermes",
  "python": "/absolute/path/to/hermes-venv/bin/python",
  "hermesRoot": "/absolute/path/to/hermes-agent",
  "timeoutMs": 60000
}
```

Windows 的 python 可指向 `.../venv/Scripts/python.exe`；JSON 路径可用正斜杠。`hermesRoot` 必须含 `run_agent.py`。由本机密钥管理向启动进程注入 `DEEPSEEK_API_KEY`；不将真实密钥写进源码、命令历史、reception.json 或交付 ZIP。然后启动/重启 Base。默认读取 `.local/reception.json`，也可用 `HDBASE_RECEPTION_CONFIG` 指定私有配置路径。

Hermes 接待固定调用 DeepSeek Flash，经 HTTPS 访问 DeepSeek。这是**本地运行 Hermes、联网推理**，并非离线大模型，也不使用个人 Hermes 对话/记忆。无 Hermes 配置时，兼容原来的 `DEEPSEEK_API_KEY` 直接接入；二者都没有则是资料接待。Hermes 配置错误会启动失败，不静默切换成另一个提供方。

## 运行边界

每个问答启动受控 Python 子进程，提示与资料通过标准输入传入；子进程只接收最小环境。`HERMES_HOME` 位于 Base 数据目录的 `hermes-reception`；禁用上下文文件、SOUL、个人记忆、所有工具、MCP 刷新与轨迹保存。零工具检查失败、超时、取消、无有效 JSON 或错误来源引用均拒绝结果。公开访客不能调用文件、终端、浏览器和发布工具。

传给模型的内容仅限当前公开资料、用户输入与上述有限历史。不要在公开空间问答里输入个人秘密。模型内容不授予权限；路线、留言仍由服务器能力执行。来源检查证明引用来自允许集合，不等于所有模型措辞都经过人工审查。

独立进程和零工具限制不是操作系统容器。只安装受信任的 Hermes 运行时；对外正式托管建议另用受限服务账户/容器，并接入正式身份、TLS、审计与配额。

## 验证

```sh
npm test
npm run test:hermes
```

后者读取实际私有配置和进程密钥，执行真实 Hermes 问候/推理、连续追问、资料引用、缺失信息和重复请求检查；配置缺失明确失败，不用测试替身冒充联通。可用 `HDBASE_TEST_SPACE` 指定私有空间包，结果写入忽略的 `qa/hermes-live.json`。自动检查不能替代真实学生试用或学校信息校对。
