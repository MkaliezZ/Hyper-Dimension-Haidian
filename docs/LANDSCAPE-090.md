# UW v0.9.0 景观登记与续建

本页从属于 COHERENT-CAMPUS-090.md。既有校园几何、建筑轮廓、高程、接待知识、Base 与用户存档均未替换。

## 树木与长椅的依据

- [UW Facilities 公共地图入口](https://facilities.uw.edu/services/space/gis-maps) 指向 [公开校园树木地图](https://gis.maps.uw.edu/portal/apps/experiencebuilder/experience/?id=3542e5a5e81d474d9ab06482d792a7ad)。该公开地图的配置指向 PublicData/MapServer/37（PublicTrees）。
- [树木查询服务](https://gis.maps.uw.edu/federated/rest/services/PublicData/PublicData/MapServer/37) 与 [长椅查询服务](https://gis.maps.uw.edu/federated/rest/services/PublicData/PublicData/FeatureServer/6) 提供实际点位。只查询物体编号、树种、树型、原高度字段/测量日期，以及长椅材质/在用状态；不查询捐赠人、题词、备注、编辑人员等字段。
- 统一到 EPSG:26910 后按原校园原点计算 X 东、Z 南。树干和长椅坐标不随机抖动，不按网格补树，不为了美术移动官方点位。树冠、显示高度、座椅尺寸与朝向为美术推定；源高度字段的单位未确认，未把该字段冒充实测显示高度。
- 本次快照为 2,717 棵树、541 张长椅。长椅仅采用 Active 记录。与现有建筑轮廓、水池或显示裁剪范围冲突的记录明确剔除。最终显示 **2,597 棵树、439 张长椅**。合计 103 条楼体快照冲突、74 条越出显示裁剪、45 条长椅非在用记录；完整逐条原因在 assets/coherent/manifest.json 的 landscape.rejected。
- 全部展示长椅均生成可见表面和深度；自动检查要求至少 250 张在实际颜色/深度块中有可见像素，避免只写入清单而不显示。石座使用浅色座面和深色支撑，木座保留靠背、座板与支脚。点击可读简短说明。

公开 GIS 是时间快照，不代表现场每棵树或长椅仍然存在。现有步行协议、碰撞规则、保存位置没有为了这次装饰更新而变化；装饰树冠、长椅和花坛不构成真实通行或无障碍承诺。

## 喷泉与场地

[UW 校园导览](https://www.washington.edu/visit/campus-highlights-guide/) 将喷泉、玫瑰花园、树列与 Rainier Vista 作为同一景观轴线；[UW 樱花地图说明](https://www.washington.edu/cherryblossoms/campus-map-of-cherry-trees/) 指明 Quad 及 Mary Gates/Johnson 之间的樱花分布。

喷泉中心继续为 `[9.89, 266.67]`，水池/池沿半径保持 23.8m/25.2m。按官方照片推定环形铺装、对齐 Red Square—喷泉轴线的四组弧形玫瑰花坛、四个通行开口；它们不是实测景观施工图。长椅使用官方位置，不用推定花坛改变官方点位。池沿有内坡与外壁，水面改为深蓝灰与细碎反光，中央水柱带破碎喷雾边缘，外围为低抛物线水流。颜色、深度、人物遮挡和鼠标命中共同烘焙。

照片研究来源（原图仅在 sources，不进入 ZIP；未将照片直接做地图贴图）：

- https://cdn.uw.edu/wp-content/uploads/sites/57/2020/08/10204546/visit-campus-highlightsDJI_0005-e1597119390956.jpg
- https://cdn.uw.edu/wp-content/uploads/sites/57/2020/08/10204509/visit-campus-highlights20190613_campus-graduation-77.jpg

## 继续开发

1. `scripts/prepare-landscape.py` 是显式离线取数命令，不在运行时访问 GIS。网络原始物理字段快照与查询 URL/SHA 记录在 sources/public-trees-090.json、public-benches-090.json、landscape-source-lock-090.json；这些 sources 原始文件不随公开 ZIP。
2. public/campus-landscape-data.js 为随包的精简派生点位；public/campus-landscape.js 负责登记、冲突记录、树种类别和长椅朝向；像素底图与实体烘焙共用它。
3. src/coherent-landscape.mjs 负责座椅/花坛/喷泉实体，scripts/export-coherent-scene.mjs 输出一套颜色/深度块。不要只换颜色图片而沿用旧深度。
4. 取数或改景观后重新烘焙、跑完整测试、独立目录浏览器检查，再生成新的完整包并在 WSL Ubuntu 全新解压验证。禁止覆盖旧交付包和 .local/uw-runtime。
