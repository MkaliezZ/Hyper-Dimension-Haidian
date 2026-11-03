# 本地 Agent（Hermes）配置

Ubuntu服务器完整部署优先使用 [全栈容器与Hermes密钥挂载](DEPLOYMENT-CONTAINERS.md#容器内-hermes-接待)。下文是直接使用本机既有Hermes安装的配置方式。通用包内的固定上游源码位于 `integrations/hermes`，不含开发者个人配置或聊天。

## 角色区别

Codex 是维护者使用的开发 Agent，可在授权后修改项目。Hermes 是当前接待的本机运行时；公开访客只能对话，不能因此获得开发者的文件和终端权限。学校向量库由 Base 管理，Hermes 只收到本次获准检索的片段和有限会话历史。

## 1. 安装或定位 Hermes

已有 Hermes 可直接复用安装，不需要复制个人配置。官方安装入口：[Hermes 源码与安装指南](https://github.com/NousResearch/hermes-agent)。安装行为按官方步骤操作；本包不会自动安装、更新或执行远端安装脚本。

原生 Windows 常见安装位置是 `%LOCALAPPDATA%/hermes/hermes-agent`，Python 在其 `venv/Scripts/python.exe`。实际位置以本机安装为准。macOS/Linux 找到含 `run_agent.py` 的 Hermes 目录及其 Python 环境，不假定所有机器路径相同。

## 2. 创建私有配置

PowerShell 示例（替换实际路径）：

```powershell
node tools/configure-hermes.mjs --python "$env:LOCALAPPDATA/hermes/hermes-agent/venv/Scripts/python.exe" --hermes-root "$env:LOCALAPPDATA/hermes/hermes-agent" --data .local-campus-a
```

macOS/Linux 示例：

```sh
node tools/configure-hermes.mjs --python /actual/hermes/venv/bin/python --hermes-root /actual/hermes --data .local-campus-a
```

工具验证安装路径，并创建 `.local-campus-a/reception.json`，有文件时拒绝覆盖。配置结构见 `examples/reception.hermes.json`；其中不放 API Key。

## 3. 注入模型密钥并启动

当前 Hermes 桥接器固定使用 **DeepSeek Flash**，需要 `DEEPSEEK_API_KEY`。它不会自动读取个人 Hermes 的默认供应商、配置或聊天记忆。已有其他 Hermes 供应商配置并不代表 Base 的密钥已配置。

由本机密钥管理向启动终端注入该环境变量。PowerShell 可临时安全输入，避免把真实值写进命令文本：

```powershell
$taskSecret = Read-Host 'DeepSeek API Key' -AsSecureString
$env:DEEPSEEK_API_KEY = [Net.NetworkCredential]::new('', $taskSecret).Password
npm start -- --space projects/campus-a/space.json --data .local-campus-a
# 服务停止后可清除这个终端的临时环境变量
Remove-Item Env:DEEPSEEK_API_KEY
```

macOS/Linux 可在 Bash/Zsh 用 `read -r -s DEEPSEEK_API_KEY; export DEEPSEEK_API_KEY` 临时输入，再运行相同启动命令。不要把密钥写入提示词、Git、README 或交付 ZIP。

## 4. 确认与验证

访问 `/health` 应看到 `receptionProvider: "hermes"` 和 `generalConversation: true`；页面显示“本地 Hermes 接待”。先问一般问题，再连续追问，再问一条有来源的学校信息和一条未提供的事实。启动标志只证明配置存在；成功回复才证明这次调用实际完成。

在开发依赖已安装、配置与密钥齐备后：

```sh
npm run test:hermes
```

默认测试读取 `.local/reception.json`。使用别的数据目录时，以 `HDBASE_RECEPTION_CONFIG` 指向该目录的 reception.json；学校包可用 `HDBASE_TEST_SPACE` 指定。缺失配置会明确失败。

这是本机 Hermes＋联网模型；不是离线大模型。没有 Hermes 但有 DEEPSEEK_API_KEY 时，可直接接入回答模型；都没有则是确定性资料接待。其他 Agent/模型需实现 `docs/EXTENSIONS.md` 的 provider 或标准 A2A 接口，不声称支持任意 Agent 一键互换。

## 5. 页面会话、恢复、导出与删除

同一访客可在空间接待栏新建、切换或继续会话。刷新页面和重启 Base 后，保留原身份凭据、原数据目录即可恢复未到期会话。独立示例依赖签名 HttpOnly Cookie；清除 Cookie 或更换浏览器不会自动恢复该访客身份。完整校园模式沿用 Keycloak 账号和当前学校权限。

默认从创建时保留30天，学校负责人可配置新会话期限。本人可导出 JSON、删除正文；管理员只看获准的最小诊断。删除会取消正在执行的该会话，禁止晚到结果、旧请求重放与刷新重新恢复内容。本人已经下载的导出文件、离线备份和数据库历史副本需按学校保留政策另行管理。

Hermes 每次以独立零工具调用处理 Base 提供的有界历史；不为访客提供个人 Agent 长期记忆，也不创建常驻的每人模型进程。桥接器显式关闭 Hermes 的个人记忆、延迟会话持久化和 JSON 快照。学校公开知识库与私人接待记录分别管理，聊天不会自动进入公共向量库。

## 6. 可重复的真实运行验证

`npm run test:hermes:sessions` 是需要真实密钥、本机 Hermes 和 Playwright 开发依赖的可选验收，不是模拟回答。配置一个**全新的专用测试目录**：

```sh
node tools/configure-hermes.mjs --python /actual/hermes/venv/bin/python --hermes-root /actual/hermes --data .local/hermes-qa/runtime
# 启动终端另行设置 HD_HERMES_EVIDENCE=.local/hermes-qa
# 以及 HD_BROWSER_PATH=专门用于测试的Chrome或Chromium可执行文件
npm run test:hermes:sessions
```

PowerShell 使用 `$env:HD_HERMES_EVIDENCE='.local/hermes-qa'`、`$env:HD_BROWSER_PATH='C:/actual/chrome.exe'` 设置变量。工具只使用新建浏览器上下文，不读取用户浏览器。已有 `started.json` 会拒绝覆盖；失败记录应保留为诊断，再在新目录验证实际修复。

覆盖真实通用对话、跨访客/学校/Agent边界、页面刷新、服务重启、引用与未知学校事实、浏览器导出、删除后的服务器文件残留及再次提问。报告和截图仅含虚构测试信息，输出到该测试目录；无论成功或失败均关闭自身 Base、测试浏览器和调用子进程。`evidence/hermes-sessions/ACCEPTANCE.md` 标注本版实测范围；不能据此声称真实学校、离线模型、Ubuntu Hermes 或生产负载已验收。
