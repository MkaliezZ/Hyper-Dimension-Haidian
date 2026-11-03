# 来源与许可保留

- v0.9.0 新增两张统一建筑/立面材质，由内置 image_gen 生成；完整提示词及使用方式见 docs/ART-SOURCES-090.md，摘要在 public/assets/coherent/manifest.json。74 栋度量几何、共享材质映射、软件深度烘焙、人物遮罩与比例核验为项目实现；不分发原始建筑照片。当前卡片和地图从同一套几何渲染，旧素材字节保留。
- v0.9.0 寻路复用 MIT javascript-astar 0.4.1，原代码、许可证、固定提交与 SHA 在 src/vendor/javascript-astar/；几何扫掠、搜索限制和导览接入为学校适配。离线三角化复用已包含的 Three.js / Mapbox Earcut MIT 实现，原许可证留在 base/。OpenRCT2 只用于机制研究，没有复制 GPL 代码或游戏美术。

- v0.8.0 的 68 栋街区建筑图集、48×64 人物及 38 个部件局部图为本项目原创代码生成，未引入外部人物/游戏素材。生成器、素材和 SHA 分别见 public/assets/buildings/manifest.json 与 public/assets/avatars-v2/manifest.json；建筑材质、屋面、入口细节属于美术推定。既有六栋照片参考地标素材原字节保留。

- v0.7.0 新增 6 栋重点建筑、喷泉和环境分块 PNG，由内置 image_gen.imagegen 基于研究参考生成；完整提示词、来源与 SHA 见 docs/ART-SOURCES-070.md 和 public/assets/oblique/manifest.json。原始照片/PDF 不分发；高度、素材地面比例和细节是艺术概括。

- v0.6.0 保留的北向小地图、人物、道具、天空与 UI 为本项目二维像素实现。地标图鉴由 image_gen.imagegen 生成，原透明 PNG、生成提示词、图集布局和各文件 SHA 记录在 public/assets/pixel/asset-manifest.json 与 docs/PIXEL-ATLAS-PROMPT.txt；为概括插画，不是 UW 官方图像或测绘。代码原生像素素材及生成器可在包内继续修改；后续引入第三方美术必须另记许可。compat/3d-v052 仅保存历史兼容字节，当前页面不执行旧 3D 渲染器。

- `base/` 来源于 Hyper Dimension Base 校园包 v0.8.3，当前学校副本带显式户外/初始化适配补丁。原包清单保存在 `base/SEALED-BASE-MANIFEST.json`；当前副本由新清单校验。其 MIT 原创代码、NodeBB/插件的 GPL 及第三方依赖的许可证、固定版本和声明完整保留；不将它们重新归为单一许可。
- UW适配代码与界面在用户授权任务中创建。公开GIS与UW资料的来源、版本、摘要和核对范围分别记录在 `SOURCE-LOCK.json` 与场景来源面板。
- 建筑底面注明City of Seattle / Enterprise Data；名称与步道注明UW Engineering Services；地形注明USGS / 3DEP。保留来源的不准确性和时间差异说明。
- UW历史资源PDF和校园地图作为研究参考，原PDF、照片与原图未收入公开运行包。生成的占位几何、色彩和植被不代表官方资产、现场精测或学校背书。
- 学校后续提供的专用美术、标识、照片及运营内容须另行登记其作者、使用/修改/分发权限与版本，不自动继承Base原创代码许可。
- v0.2.0的程序化砖/石/板岩纹理、建筑细部、喷泉、水雾、植被与镜头为原创代码生成；本轮UW/Lloyd C. Heath参考照片只研究不分发。资料面板与 `docs/ART-EDITION.md` 保留署名和使用范围；不把公开可访问理解为图片/扫描件再授权。

UW landscape v0.9.0: public physical tree/active-bench positions derived from UW PublicData/MapServer/37 and FeatureServer/6, in EPSG:26910, with attribution and query digests in docs/LANDSCAPE-090.md and the generated snapshot. Dimensions/orientation are inferred. No official photo pixels, donor/dedication/editor/personal fields are included.


## v0.10.6 实景照片

`public/assets/place-photos/*.jpg` 为 Wikimedia Commons 已明确选定的实景照片缩略图，按逐文件许可证使用，不属于代码或原创像素素材的许可范围。摄影者、原文件名、原图、来源页、许可链接、下载链接及逐文件 SHA-256 均在同目录 `manifest.json`。图像保持下载内容，页面使用 CSS 裁切展示；点击可打开完整来源。保留署名与来源，修改 CC BY-SA 图像时遵守其对应许可证。缺照片的地点不放替代图。
