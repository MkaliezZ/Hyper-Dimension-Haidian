> 历史 v0.8.0 说明。当前实现先读 COHERENT-CAMPUS-090.md；本文件保留为旧交付依据。

# UW v0.8.0 · 全校园细节与流畅漫游

当前阅读顺序：README → AGENTS → 本文件 → DEPLOY-UW → base/DEVELOPMENT-MANUAL.md。更早美术文档描述各自封存版本；v0.7 的 4m/s、24×32 当前人物及逐帧世界绘制已更新。

## 当前行为

- 自由漫游由 4 提到 **6m/s**，前后端共用 WALK_SPEED；导览演示速度仍为 18m/s，步行时间标签仍按原路径估计。API 只接受短时方向，500ms 上限、归一化、请求幂等、版本冲突和服务器位置所有权不变。
- 六栋照片参考重点楼体原素材保留，另外 **68 栋**全部增加砖石材质、石带、窗框、入口、檐口、屋面与天窗细节。20 栋砂岩色、17 栋现代玻璃、16 栋暖砖、12 栋学院砖石、3 栋木质美术分组；分组和细节是概括性美术推定，不能作为建筑测绘或真实入口依据。所有轮廓、庭院和碰撞数据保持原样。
- 当前人物使用 **48×64** 原创像素部件，保留 7 槽 38 个部件、四套预设、肤色/配色/身高和四向动作。地图显示尺寸为原版约 **70%**；提高源纹理细节不会让人物变得更大。部件选择使用 64×64 局部预览，分别放大发型、上装、下装、鞋和镜框。
- 主画布按 CSS 像素绘制动态人物，静态校园在有边缘余量的独立 Canvas 图层中缓存。相机平移使用浏览器独立合成层的亚像素位移，不再每帧将楼体位置取整到 2 个 CSS 像素，也不每帧整屏复制静态世界。地面与精灵仍分块，素材先以最近邻定尺；相机只做 1:1 平移，不在移动中重复缩放原图。

## 渲染与资源

public/viewport-cache.js 负责可见范围和四边余量；缩放、选择、路径、专注模式、窗口改变或越过缓存边缘才重新栅格化静态层。缓存边界使用整数全局像素坐标，重建前后保持图像相位一致。天空低频更新，小地图约 10Hz、地标标签约 30Hz，人物动画仍逐显示帧推进。阴影、人物遮挡、透明区域点击和 UI 图层顺序保留。

缩放仍使用十二档，上限 2。素材放大仍受上限控制；像素图近看会显示像素块。缩放时释放旧尺寸纹理，静态缓存之外的定尺精灵也释放。dispose 会移除天空/世界图层、清空画布、解除监听，测试后关闭独立服务。

public/campus-walking.js 给路径和楼体建立空间索引，只检查所在区域的候选项。原始高度、墙边距离、庭院、水池、道具和边界算法保留，tests/fixtures/walking-bruteforce.mjs 提供原算法对照。测试逐点比较高度/可行走性，并比较实际扫掠路径，不能用放宽碰撞或客户端任意坐标换取流畅。

## 人物存档兼容

当前目录 **uw-visitors-5**，生成器 **uw-pixel-2.0.0**。新 rendererHash 由 pixel-avatar-v2.js 与不变的 pixel-raster.js 计算；地图缩放是独立展示配置，不进入配方。原 pixel-avatar.js 和 pixel-raster.js 保留原字节，v4 rendererHash 仍为 44c567283f59387325972e3210a309de1431e248edd4f21939dceb36339b0578。旧 v1–v3 历史代码继续保留。

GET /api/avatar 返回原 profile 和只读 v5 presentation；不替用户改写 modelHash、配方、历史或 revision。用户明确保存时才写新配方并保留上一份历史，支持冲突/幂等和重启恢复。学校原生账号入口与签名访客入口沿用相同规则。不能通过删掉旧人物文件“迁移”存档。

## 文件与生成流程

| 文件或目录 | 用途 |
| --- | --- |
| public/oblique-buildings.js | 按原轮廓生成连续屋面和精细立面，含庭院孔洞；无外部素材依赖 |
| scripts/export-building-assets.mjs | 预生成 68 栋建筑至两张图集，记录布局、SHA、样式、锚点和几何摘要 |
| public/assets/buildings/ | 两张 PNG 和 68 栋建筑映射清单，浏览器直接载入 |
| public/pixel-avatar-v2.js | 当前精细人物和局部部件预览生成器 |
| public/avatar-view.js | 独立的地图人物显示比例 |
| scripts/export-avatar-v2-assets.mjs | 四套 48 帧人物表和 38 个局部部件纹理，记录清单与摘要 |
| public/assets/avatars-v2/ | 当前人物帧表、部件局部图和布局 |
| public/pixel-avatar.js / assets/pixel/ | 原 v4 字节和素材兼容，不覆盖 |
| public/pixel-scene.js / viewport-cache.js | 独立静态世界、亚像素跟随、前后遮挡、局部重建和资源释放 |
| public/frame-telemetry.js | 仅本地滚动 CPU 提交耗时/帧间隔/重建次数，不传网络、不包含身份 |

编辑建筑生成器后运行 `node scripts/export-building-assets.mjs`；编辑当前人物后运行 `node scripts/export-avatar-v2-assets.mjs`。已封存人物生成器的更改必须增版本并保留旧摘要；当前开发尚未封存时才可更新该版素材。旧 export-pixel-assets.mjs 固定维护 v4 资源，不用于发布当前精细人物。

## 验证和交付

执行 `node --test tests/*.test.mjs`、`node scripts/verify.mjs`。在独立数据目录验证近远视角、平移跨缓存边界、自由行走/松键停止、地标选择、人物前后遮挡、部件选择/动作/保存/刷新恢复和窄屏。只用虚构身份；用户的 .local/uw-runtime、私有 Hermes 配置、Cookie、账号库、接待会话和旧 ZIP 不得覆盖。

本机性能数据见 evidence/smooth-080/performance.json：同尺寸测试页、持续按键采样。CPU 提交耗时不等同 GPU 时间或所有设备帧率；不得用该数值宣称固定 FPS、服务器容量、真人或物理多设备验收。

生成新完整包：`python scripts/pack.py --out /new/version/UW-Pixel-Campus-v0.8.0-complete.zip`。新 ZIP 逐项 CRC/SHA → Ubuntu 全新解压 → package/geometry 核验 → 53 项测试 → 人物与步行保存重启。最终结果在包外该版本 HANDOFF。原全栈/Hermes 9 项、恢复 8 项为继承证据，未在本轮重跑。新加图集和 v5 人物源必须进入 Docker COPY 的 public/src 路径；现有构建规则已覆盖这些目录。
