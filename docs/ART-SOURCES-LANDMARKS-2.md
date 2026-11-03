# Red Square 与 Drumheller Fountain · 地图像素细化

2026-10-30，当前开发预览。原校园数据、74 栋建筑轮廓、池中心与半径、81 对路线、学校业务、人物配方及旧交付包保留。

## 参考与做法

实际查看项目 sources/art-reference/red-square.jpg、redsquare.gif、drumheller.jpg 和 sources/fountain-vista-reference-090.jpg，并核对 UW 官方导览及其照片：

- [UW 校园导览](https://www.washington.edu/visit/campus-highlights-guide/)
- [红场实景照片](https://cdn.uw.edu/wp-content/uploads/sites/57/2020/08/10204555/visit-campus-highlightsUniv-of-Washington_Red-Square-e1597119170153.jpg)
- [喷泉与 Rainier Vista 照片](https://cdn.uw.edu/wp-content/uploads/sites/57/2020/08/10204509/visit-campus-highlights20190613_campus-graduation-77.jpg)

观察重点是红褐色小砖、细灰色铺装线、四组矮台、砖塔、Broken Obelisk 的上下平衡结构，以及喷泉的深蓝绿水面、浅色池沿、低抛水流、中央白色碎雾和周边绿地。照片用于形态与配色研究；运行资源使用原创生成材质及学校场景几何。

红场不再只依赖 2 像素/米的简化底图：src/landmark-art.mjs 按既有 RED_BOUNDARY 烘焙细砖铺装和台阶。public/red-square-layout.js 统一提供四个矮台、三塔和雕塑的美术与碰撞位置。地图人物、学校位置和路径协议不变。

## 多角度复核后的地标修正

补看了 UW Facilities 的北侧高处照片、Humanities Academic Services 的反向夕阳照片、UW Anthropology 的 Kane Hall 方向照片、UW University Photography 的方尖碑近景，以及 Wikimedia Commons 的三塔近景。原件和 URL/SHA 记录保留在 sources/art-reference/red-square-multiview-20261030.json；原照片不进入公共运行包。

- 三砖塔是错落的薄壁塔组，照片中明显高出 Odegaard 和 Kane，原先 16m 的同高细柱表达偏弱。本轮按照片和建筑史材料的量级重建为约 37–43m 的错层窄墙塔，建筑本体原高度预算不变。该高度为美术校准值。
- 四块低矮混凝土台集中在铺装中心附近，围合中央空隙，铺装线由此向边缘展开；已从旧版沿南侧排成一列的位置修正。
- Broken Obelisk 使用宽金字塔底座、尖点相接、倒置收尖段与断裂直柱。位置向红场东北、Suzzallo 前方的空地校准，保持约 8m 级别的体量，并增加可点击名称标记。三塔同样可独立点击近看。
- 华盛顿雕像的西侧入口位置也作了资料核对；本轮未新增该人像资产。

四台与方尖碑的碰撞位置随同美术迁移；半径和扫掠精度不放宽，楼体 GIS/庭院/水池/边界规则保留。原始步道图与当前实体相交的边由旧版本 32 条变为 31 条，全部 81 对路线仍须逐段复核。测试中的旧暴力算法仅更新共享物体数据，碰撞算法与断言保留。

喷泉的池边步道、外侧绿地、环路和花坛分层表现；新水雾按实际目标像素密度做带透明度的面积预滤，再作为同一喷泉 owner 的水体细节烘焙。它和八组低水流、水池共享深度数据。这里没有用一张整座喷泉图片覆盖地图。

## 原创生成资源

均调用内置 image_gen，原始输出保留；生成后复制到项目。生成源图及 SHA-256 在 public/assets/coherent/manifest.json 的 landmarkArt 中。

1. landmark-materials-v2.png：2×2 平面材质图集，分别为细砖、深蓝绿水面、浅灰混凝土和白色泡沫。采样前按地图密度预滤，减少缩放时的细碎噪点。
2. fountain-plume-v2.png：中央水雾透明素材。prepareFountainPlume 先按 alpha 裁取实际范围，再以预乘透明度缩到 32×100 的烘焙密度，避免黑边。

### 材质生成提示词

Create ONE original production MATERIAL TEXTURE ATLAS for a polished University of Washington inspired isometric pixel campus game. This is a NEW reusable texture library based on these observed real materials: Red Square is weathered russet/reddish brown small rectangular brick pavers, muted rose and orange tones, very fine dark mortar; Drumheller Fountain has deep blue-teal reflective water, white foam, and pale warm gray aggregate concrete coping. Output one opaque square 1536x1536 PNG divided into exactly 2x2 equal panels with NO gutters, labels, margins or borders. All panels completely flat ORTHOGRAPHIC top-down, no perspective or directional cast shadows. Top left: exquisite fine dense running-bond brick paving, muted worn reddish brown with varied individual warm clay bricks, narrow dark warm mortar and fine subtle chips, consistent small brick scale, little soft cream wear. Top right: deep dark blue teal pool water, finely drawn orderly horizontal pixel wavelets, small cool reflected-sky highlights and dark green-teal depth, elegant restrained blue not cartoon turquoise, no objects or fountain and NO foam rings. Bottom left: pale warm gray architectural concrete coping and promenade stone, subtle aggregate speckles, finely toned muted gray, uniform full swatch without pattern seams. Bottom right: white foamy aerated water on blue-green water, finely clustered ivory-white spray sparkles and dark teal gaps, rhythmic ripple detail, natural pixel foam, no large objects. Art style: sophisticated hand-painted pixel-art game surface with fine controlled pixel clusters, crisp square pixels and rich but restrained palette, comparable to beautiful high-quality isometric game environments. Consistent fine texel size in every panel. Not a photo. No gradients, no blur, no coarse speckle-noise or big random blotches. No people, no text, no logos, no whole landscape or architecture. Each full quadrant is a repeatable material sampled onto dimensionally accurate world surfaces, NOT a whole scene billboard.

### 水雾生成提示词

Create one ORIGINAL TRANSPARENT PNG game sprite: ONLY the central geyser plume of University of Washington Drumheller Fountain, viewed as a nearly front-facing orthographic water plume for an isometric pixel-art campus game. No pool, no surrounding scenery, no lower fountain arcs, no pedestal, no people. Tall narrow composition, plume about 4.5 times as high as its maximum width, centered, entire water plume visible with a small transparent margin. It rises from a broad low white foamy impact splash at the bottom, dense bright upward water in the lower center, narrowing irregularly towards the top, with many fine blue-white falling water streaks, airy broken mist edges, scattered small detached droplets and wisps at both sides. The top should have an irregular gently rounded spray crown, not a rigid tip, mushroom, tree, pole or solid column. In real Drumheller photos the water reads as soft white aerated water with translucent blue-gray spray and sparkling ivory droplets against dark teal water. Translate this into refined expressive PIXEL ART with crisp controlled square pixel clusters, deliberate 1-3 pixel highlight details, beautiful white and pale ice-blue palette with subtle cool blue-gray shading; rich textured water flow, airy gaps, no harsh dark outline, no blur, no photographic cutout. Premium sophisticated isometric indie game art, readable at approximately 32 pixels wide by 128 pixels tall after reduction. Use the canvas efficiently: central sprite at least 80 percent of canvas height and centered horizontally; transparent unused canvas. No text, no logos, no rectangle or solid-color background. True transparency around and between the spray particles.

## 续建入口

- src/landmark-art.mjs：地标材质、红场铺装、矮台/雕塑和水雾预滤。
- public/red-square-layout.js：照片校准的地标位置与形体尺寸，供烘焙和碰撞共同读取。
- src/coherent-landscape.mjs：池沿、水面、低水流、玫瑰园与原位置长椅。
- scripts/export-coherent-scene.mjs：同步导出颜色/深度 v2 分块、清单和喷泉 v2 卡片。
- public/pixel-scene.js：红场原卡片继续保留，喷泉卡片切到同源 v2 资源。
- tests/landmark-art.test.mjs：现有碰撞包络、资源摘要及透明边缘预滤。

再生成后核对颜色与深度一一配对，跑测试及独立目录浏览器检查，再发布新包。旧 ZIP 和 .local/uw-runtime 保留。素材中的细部和铺装线为照片参考的美术重建。
