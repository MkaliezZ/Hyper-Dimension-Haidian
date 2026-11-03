# 我的 A2A 任务

## 用户入口

登录学校账号后，从“校园服务 → Base-1 → 我的 A2A 任务”进入；Agent目录和NPC面板也有入口。直接地址：`/agent-tasks.html?school=uw`。

1. 选择学校和Agent，按状态筛选或翻页；列表每页20条。
2. 点击记录查看当前状态、能力、时间、结果、模式和来源。
3. “刷新详情”重新读取当前状态；“导出回执”下载本人的JSON回执。
4. 对未完成任务点击“停止任务”，确认后向原Agent发送停止请求。已经完成的任务保留最终回执。

从NPC面板进入时会预选对应Agent。学校尚未授权、账号退出或权限撤回时，请先完成正常登录/成员流程。公开参观模式继续提供地图和接待，账号任务使用Ubuntu完整模式。

## Agent / 开发接入

可使用`?school=<catalog的schoolId或spaceId>&agent=<agentId>&task=<taskId>`打开已授权任务。不要将凭据或任务正文放入URL。列表默认不读取历史和产物；详情由用户主动选择。

客户端实现：`public/a2a-task-client.js`；界面：`public/agent-tasks.*`；目录：`src/campus-catalog.mjs`；校园入口：`src/campus-services.mjs`。

沿用`POST /agents/:agentId/a2a`，请求头`A2A-Version: 1.0`、同站登录Cookie与JSON-RPC关联编号：

- `ListTasks`: `pageSize:20, historyLength:0, includeArtifacts:false`，可选`status/pageToken/contextId`。
- `GetTask`: `id, historyLength:0`。
- `CancelTask`: `id`；重复停止由现有网关幂等处理，执行结束的竞态会重新显示最终状态。

读取、停止、导出都由原网关核对本人、学校和Agent；负责人身份不会获得读取他人私人任务的例外。切换Agent或请求被拒绝时清除旧回执。文本用textContent呈现，JSON导出前再次读取以检查当前权限。

“停止Agent任务”与“撤销合作业务工单”使用各自原有入口；接待/NPC的会话保留、导出和删除仍在对话页面完成。本工作台不会自动重放SendMessage，也不会为查看记录触发模型推理。

## 验证与继续开发

针对性测试：`node --test tests/a2a-workbench.test.mjs tests/campus-services.test.mjs`；完整回归：`node --test tests/*.test.mjs`。测试用独立虚构目录和可停止能力，不使用付费模型。

浏览器检查清单：访客登录门槛、20条分页、状态筛选、跨Agent切换、当前回执、导出、停止确认、结束竞态、长ID换行、手机深链接定位。新功能须继续复用原网关，保持原有ACL和模型预算。

打包流程沿用`python scripts/pack.py --out <新的绝对ZIP路径>`。保留旧包；完成清单和解包启动核对后更新包外CURRENT-UW与HANDOFF。学校副本的功能不能直接写入封存Base。
