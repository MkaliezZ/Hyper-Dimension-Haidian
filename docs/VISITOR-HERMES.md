# 访客人物、连续导航与 Hermes

2026-10-28 开发工作树增量，尚非新的封存交付包。遵循最新 Goal：完善人物、美术、寻路和实际功能接入后再交付；不是恢复旧游戏或重型捏脸。

## 页面体验

- 首次访问显示人物编辑器。可以先浏览；顶部“我的形象”随时进入。7 个槽位、38 项可组合部件、4 个预设、6 种肤色、4 组颜色、3 种身高；保留简单部件搭配产品边界。
- 人物是学校项目原创 Three.js 3D 几何，支持站立、行走、挥手；不是替换封存 Base 的旧模型。素材登记及有效版本由 `src/visitor-avatar.mjs`、`public/visitor-model.js` 共同决定；兼容约束复用 Base 已校验目录。
- 服务端验证配方、素材摘要、版本冲突和请求幂等。签名访客身份决定自己的存档，不能指定他人 ID。保存后地图使用同一配方；刷新及服务器重启恢复。
- 这是浏览器访客形象，保留其 Cookie 才能找回；不假称跨设备正式账号同步。未来正式校园账号接入应通过明确绑定/迁移流程，不能自动抢占或覆盖成员形象。
- “找到我”和路线面板“跟随人物”可近距离观察。“停在这里”由服务端记录停止位置。中途改目的地从所在步道上的精确位置继续，不跳回最近节点。刷新后未完成的移动继续播放。
- 原校园几何/DEM/路径 hash 不变。本轮尚未重新做逐段实地通行、无障碍或新增建筑/水池碰撞审核。

## Hermes 启动

默认 `UW_RECEPTION_MODE=auto`：存在当前数据目录的私有 `reception.json` 时采用 Hermes；没有时明确显示资料模式。可设 `hermes` 要求必须配置成功，或 `knowledge` 明确只检索。配置了 Hermes 却缺少密钥会拒绝启动，避免页面冒充模型在线。

Windows 本地预览复用已安装 Hermes 的 Python 与源码，不读取个人记忆/配置：

```powershell
node base/tools/configure-hermes.mjs --python "$env:LOCALAPPDATA/hermes/hermes-agent/venv/Scripts/python.exe" --hermes-root "$env:LOCALAPPDATA/hermes/hermes-agent" --data .local/uw-runtime
# 从私有环境注入 DEEPSEEK_API_KEY；不要把值写在文档、命令参数或仓库中。
node scripts/local-preview.mjs
```

生成器拒绝覆盖已有配置。默认预览启动器会继承环境。停止使用 `node scripts/local-preview.mjs stop`，不清空 `.local/uw-runtime`。

Ubuntu 使用 `scripts/serve-hermes-linux.mjs`，配置：

| 变量 | 用途 |
| --- | --- |
| `UW_DATA_DIR` | 当前实例的独立私有数据目录 |
| `UW_HERMES_KEY_FILE` | 只读挂载的模型密钥文件，只允许应用用户读取 |
| `UW_HERMES_ROOT` | 含 `.venv/bin/python` 和 `run_agent.py` 的固定 Hermes 安装，默认 `/opt/hermes` |
| `HD_BASE_ROOT` | 完整封存 Base 所在目录，镜像实测 `/app` |
| `PORT` | HTTP 端口，默认 4190；本地仅监听回环地址 |

```sh
node scripts/serve-hermes-linux.mjs
```

服务端读私有文件注入模型 key，不写入公开配置/argv/镜像。Ubuntu 部署仍使用 Base 中固定 Hermes 源码、Python 3.13 镜像及冻结锁文件。首次构建需要联网。Hermes 编排在本机/服务器，推理调用线上 DeepSeek，**不是离线大模型**。

Hermes 每次零工具调用、不读取个人长期记忆，不为每名访客常驻一个进程。Base 管理 owner/space/Agent 会话隔离、默认 30 天保留、导出和删除。校园具体事实必须有当前已发布资料引用；通用交流不再因缺乏校园资料直接拒绝。学校当前营业、预约、无障碍等仍以核实的官方信息为准。

## 本次验证与待办

真实结果见 `evidence/visitor-hermes-20261028/ACCEPTANCE.md`。其中 Ubuntu Hermes 实测和 Windows 页面实测分开记录。

尚需完成正式 UW 学校/组织及原生账号绑定、地图地点与原生社区/背包/运营业务衔接、公开向量库发布撤回链路，以及重点建筑/整体美术的最终复核。不要用本轮访客闭环宣称这些链路已交付。
