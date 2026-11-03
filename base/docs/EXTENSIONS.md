# 扩展，而不是复制整款游戏

## 学校展示内容

修改学校自己的 `space.json`：名称、公开知识、房间详情、展项、图片都不需要改 Base。`exhibits` 关联稳定 entityId，包含 title/body/assetIds/published/revision。已发布展项也进入接待的引用资料；未发布项不会公开。

`assets` 是显式发布清单，只接受项目 `assets/` 内的 PNG/JPEG/WebP/GLB 文件。禁止任意文件路径、脚本、外部图片链接和目录越界；未发布资源没有下载端点。当前单文件上限 25MB。图纸不是展示素材，不要把原图塞进公共 assets。

```json
{
  "assets": [{ "id": "project-photo", "file": "assets/project.png", "published": true }],
  "exhibits": [
    {
      "id": "project-a",
      "entityId": "campus-gallery",
      "title": "项目 A",
      "body": "经过审核的公开介绍",
      "assetIds": ["project-photo"],
      "published": true,
      "revision": 1
    }
  ]
}
```

参考 `examples/north` 的原创图片与展板。没有必须接入的 CMS；让 Agent 编辑文件、校验、构建、启动即可。生产环境的在线上传与审核 UI 属于独立适配器。

## 2.5D / 3D 美术

同一份 scene 保留语义与通行几何。通过 `scene.artwork` 为房间放置图片 billboard 或 GLB：

```json
{
  "assetId": "project-photo",
  "entityId": "campus-gallery",
  "levelId": "L1",
  "kind": "billboard",
  "point": [10, 1.6, 1.2],
  "scale": [2.4, 1.3, 1],
  "footprint": [8.8, 0.9, 2.4, 0.6]
}
```

- `kind=model` 使用 GLB，`billboard` 使用图片。point 是米制世界坐标，rotationY 是弧度，scale 为 XYZ 缩放。
- GLB 原点、包围盒与语义房间中心对齐。美术尺寸改变后同步 footprint，避免看起来有障碍却能穿过。
- footprint 直接参与服务端寻路；替换画风不能重置空间数据或换一个用户存档。
- 房屋平面、碰撞、门、楼梯仍以共享 scene 为准。将美术模型完全代替结构模型，需要新的 renderer adapter 与几何一致性测试，不能单靠图片覆盖。
- 不要把 JS 代码放在素材包里执行；可信扩展代码与内容素材分开。

## 接待模型

`createReception({provider})` 接收可替换 provider：输入只有空间名称、问题、已发布候选 facts、限定范围的 history、AbortSignal；输出 answer/sourceIds/model。兼容旧版 provider 的来源必填规则。支持通用对话的适配器须显式设置 `provider.general=true` 并返回 `kind=space/general/unknown`：只有 space 可带来源且必须有效，其他两类不得冒充资料引用。可设置 `provider.providerName` 标明实际运行时。不得给公开接待接入个人文件、Shell 或个人管家的私有工具。

内置 DeepSeek 适配器从环境变量读取密钥，固定 `deepseek-flash`，无静默模型回退。其他供应商实现同接口，并用真实 API 检查引用与预算。不接供应商仍可完整运行资料接待。

本地 Hermes 适配器通过 `src/reception/hermes.mjs` 与独立 Python 桥接器调用受信任安装；配置与零工具边界见 [RECEPTION.md](RECEPTION.md)。

## 新能力 / A2A 联合处理

受信任的启动脚本通过 `startServer({capabilities})` 注入处理器；空间包只声明 skillId，不能自行指定可执行文件。

```js
const capabilities = {
  'campus.appointment': {
    scope: 'appointments:write',
    async execute({ pack, principal, input, arguments: args, taskId, signal }) {
      // 校验参数与权限；外部写入以 taskId 为幂等键；尊重取消信号。
      return { text: '预约状态说明', mode: 'appointment-service', sources: [] };
    },
  },
};
```

空间 Agent 的 skills 加入该 ID，并给具体调用者发放所需 scope。未安装处理器的声明在启动时失败，未授权调用在执行前失败。不要把自然语言“请帮我做”当作权限。

`examples/peer-capability.mjs` 演示一个 Base Agent 通过标准 A2A 请求另一个 Base Agent 的公开信息。目标 URL、凭据和允许列表由维护者固定，不接受模型输出或访客给出的 URL，避免成为任意网络访问代理。联合活动可以继续扩展，但预约、支付、跨系统资源提交需要自己的原子性与撤销设计，首版不虚构完整业务闭环。
