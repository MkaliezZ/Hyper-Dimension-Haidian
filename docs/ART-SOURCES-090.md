# UW v0.9.0 统一建筑与场景素材

当前地图不再使用六栋重点建筑的整栋插画作为楼体。全部 74 栋建筑共用真实地面轮廓、统一米制投影、材质、光照与深度烘焙流程；原有插画保留在历史素材和旧交付中。新立面、屋顶分区与装饰是参考建筑特征的美术推定，不是测绘结果或真实入口证明。

红场与喷泉的照片参考、地面细节、水雾素材和当前再生成说明见 [地标细化素材记录](ART-SOURCES-LANDMARKS-2.md)。当前颜色/深度清单引用 v2 分块；v1 资源保留供已有预览和历史回退使用。

## 新生成的原始材质

均通过内置 `image_gen` 工具生成，没有使用 CLI/API 回退。生成后复制到项目中，保留原始文件；运行时加载的是由这些材质与几何烘焙出的分块场景。

- `public/assets/coherent/materials-v1.png`：砂岩、红砖、板岩、石灰石四象限材质。
- `public/assets/coherent/facade-modules-v1.png`：哥特式石窗、砖墙石框窗、现代柱廊玻璃、罗马式圆拱窗四象限模块。
- `public/assets/coherent/manifest.json`：两张原图摘要、物体与真实轮廓绑定、分块颜色/深度摘要、地标卡片摘要及美术推定边界。

两次生成均没有把公开照片作为可再分发纹理。旧照片参考只用于识别建筑特征。所有地标卡片也从同一套新几何与材质渲染，避免卡片与场景画风不一致。

### 材质图集提示词

Use case: stylized-concept. Asset type: production architectural material texture atlas for a University of Washington inspired isometric pixel campus game. Create ONE square 1536x1536 opaque texture atlas divided into exactly 2 columns by 2 rows of four perfectly equal squares, with NO gutters, NO borders and NO text. Each quadrant fills its entire area and is a completely flat orthographic material swatch with NO perspective, NO objects, NO facade, NO windows, NO directional cast shadows. Top-left: warm finely mottled pale buff sandstone ashlar blocks, subtle small irregular pores and thin pale mortar. Top-right: warm muted russet collegiate red brick, small regularly staggered bricks and weathered cream mortar. Bottom-left: charcoal blue-gray slate roof tiles, overlapping staggered flat rectangular tiles with fine crisp ridges. Bottom-right: warm light limestone trim, very subtle rectangular coursing with light grain. Style/medium: richly detailed hand-painted pixel-art materials, controlled dense square pixels, crisp hard-edged details, restrained natural saturation, coherent warm afternoon lighting baked neutrally into the colors, warm sandstone and russet balanced against cool slate. Important: this is a game texture MATERIAL library sampled onto dimensionally accurate roofs and walls, never a scene or whole building illustration. No gradients, no photographic blur, no text, no logos, no watermarks. All four quadrants need dense fine material detail with the SAME pixel scale. Avoid large noisy color blotches, thick black outlines or crude placeholder-looking surfaces.

### 立面模块提示词

Use case: stylized-concept. Asset type: one production flat architectural FACADE MODULE texture atlas for a refined University of Washington isometric pixel campus game. Create one opaque square 1536x1536 atlas, exactly 2 columns x 2 rows, four equal square panels, zero gutters or borders. All panels are front-facing ORTHOGRAPHIC building elevations, no perspective at all. Each is ONE repeating architectural bay, no full buildings, no roofs, no sky, no ground, no text. Top-left: elegant pale honey sandstone Collegiate Gothic bay with one tall pointed-arch leaded blue-gray window, very fine stone tracery at the arch, four slender mullions, carved warm limestone jambs, narrow side buttress accents. The window spans 55 percent of the bay width and 75 percent of the bay height, centered horizontally, pale stone surrounds. Top-right: one repeating muted russet red-brick academic wall bay, one centered paired rectangular sash window with pale sandstone lintel and sill, recessed cool dark teal glass, warm aged brick bond, small elegant stone accents, window occupying 55 percent width and 60 percent height. Bottom-left: restrained midcentury academic concrete bay, pale warm gray limestone piers framing one wide vertically divided teal glass window, slim dark bronze mullions and faint interior reflected sky, no random color panes. Bottom-right: one warm buff sandstone Romanesque bay with one paired round-arched dark teal window, heavy carved stone surrounds and small cream voussoirs, subtle stone texture. Cohesive art direction across all four panels: beautiful premium hand-painted pixel-art game texture, clear readable fine masonry and restrained pixel clusters, warm golden stone and russet brick, cool desaturated blue-green glazing; same upper-left soft daylight baked neutrally, same detail density, no coarse black outlines, no photographic grain, no crude simplified grids. Fine material detail but calm flat walls; shape and architectural trim should be legible. No doors or signs. Crucial: all four panels must extend edge-to-edge and meet exact halfway boundaries. Each panel is a FLAT reusable TEXTURE applied to geometry; no isometric buildings drawn in the image. No labels, no logos, no watermarks.

## 开源机制与边界

- 寻路实际复用 MIT [javascript-astar](https://github.com/bgrins/javascript-astar) 0.4.1；固定提交、SHA 与许可证见 `src/vendor/javascript-astar/`。学校适配层增加共享碰撞扫掠、禁止切角、有限搜索、路线复核和当前位置连续性。
- 离线几何三角化复用已包含在 Base Three.js 中的 MIT Earcut 3.0.2。没有新增实时 Three.js/WebGL 引擎。
- [OpenRCT2 绘制实现](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/paint/Paint.cpp)只用作机制研究，没有复制其 GPL 代码或游戏素材。
- [NVIDIA 深度测试说明](https://developer.nvidia.com/gpugems/gpugems/part-v-performance-and-practicalities/chapter-29-efficient-occlusion-culling)用于核对可见表面深度原理；本项目的 Canvas 2D 深度 PNG 编解码和人物遮罩为自开发。

重新生成：`node scripts/export-coherent-scene.mjs`。几何和材质变化必须同步更新场景清单、地标卡片、颜色块和深度块；不能只替换颜色图片而沿用不匹配的遮挡数据。
