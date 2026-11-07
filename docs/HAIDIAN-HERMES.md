# 海淀实例 Hermes 接入 · v1.1.1 · 2026-11-07

本机完整校园实例为[6290](http://127.0.0.1:6290/)，已启用真实模型。公开参观4290或新机器的源码包在未提供私有配置时仍运行资料模式。

本文件记录v1.1.1接入时的真实验证。v1.1.2 Git源码不分发历史`evidence`截图/日志；它们保留在本机和此前封存包中。当前可随源码读取的运行摘要与功能对照见[功能审计](HAIDIAN-FUNCTION-PARITY.md)，常规测试现为67项；接待、NPC模型实现和私有配置未改变。

## 模型和原有实现

用户明确要求最新Flash，不使用Pro。2026-11-07核对[DeepSeek官方模型说明](https://api-docs.deepseek.com/quick_start/pricing/)，当前Flash为DeepSeek-V4.1-Flash-1017；调用名`deepseek-flash`会随官方Flash系列更新。接待桥、NPC规划和NPC聊天都固定此别名，无Pro备用模型。

- 接待：原有`base/src/reception/hermes.mjs` → `hermes_bridge.py` → `/opt/hermes`中固定版本Hermes → DeepSeek官方API。工具数量为0，保留原有已发布资料引用与访客/Agent/会话隔离。
- NPC：原有`src/npc-model.mjs`直接请求DeepSeek官方API。6位角色共享该适配器，保留日预算、固定站点、规划和聊天行为。NPC没有被改写成Hermes；这与UW的前后端分工一致。
- 页面：接待显示“Hermes · DeepSeek Flash”，NPC显示“AI NPC · DeepSeek Flash”。原有A2A任务、会话导出和删除机制继续使用。

## 私有配置

凭据从用户指定的本地文档读取并验证，仅将可用的DeepSeek凭据写入海淀自己的`/var/tmp/hyper-haidian-20261103/reception-model-key`，文件权限0400、运行用户10001可读。Docker以`/run/secrets/reception_model_key`只读挂载。Base原有配置器在私有运行目录生成Hermes接待配置；模型密钥不写入该JSON。

私有`compose.env`保存密钥文件路径及`HD_HAIDIAN_HERMES_ENABLED=1`，均不进入源码包。启动器读取启用标记后叠加`deploy/compose.hermes.yaml`；若指定密钥缺失则报错。没有改动Codex的全局配置、UW部署、账号或数据库。

## 实际验收

`evidence/haidian/hermes/live-result.json`记录5次显式真实模型问答与断言结果，不包含密钥、Cookie、完整会话正文或测试暗号：

1. Hermes实际通用问答，回执`live-model / hermes / deepseek-flash`。
2. 新的另一位访客没有上一位访客的暗号，跨访客导出返回404。
3. 原访客在同一段会话内追问能正确回忆。
4. 海淀地址问答引用实际发布资料`kb:haidian-school:…`，正文含杏石口路20号。
5. NPC陈一诺真实聊天完成，回执`npc-deepseek`；服务状态报告6位角色共享`deepseek-flash`。

上述3段新建QA会话均通过原删除接口清理并返回410。此检查没有重启服务，不能据此另称重新验证跨重启的模型会话记忆。NPC自动规划仍可能发生，受原有日预算约束；报告5次仅计显式问答次数。

页面另发出接待与NPC各1次真实问答，截图为`reception-flash.jpg`和`npc-flash.jpg`。检查使用非敏感合成问题。43项常规测试包含NPC规划与聊天固定Flash且不接受Pro覆盖的断言；`npm run build`和空间检查通过，几何指纹保持v1.1.0不变。

需要重新进行付费验收时，在已配置的6290实例旁显式运行：

```powershell
$env:HD_HAIDIAN_LIVE_TEST='1'
node scripts/verify-haidian-hermes-live.mjs
```

脚本仅允许本机HTTP目标及海淀完整实例，只新建自己的访客会话，结束时删除这些会话。常规`npm test`不进行付费网络调用。既有五服务/23个功能入口的验收记录仍属原来的日期；本次没有将这些业务重新描述为新增实现。
