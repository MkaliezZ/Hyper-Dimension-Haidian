> 历史视觉快照：本文描述 v0.2.0。当前屋顶修复与折纸风 3D 见 [LOW-POLY-3D](LOW-POLY-3D.md)，不能将旧截图和指标当作新版本结果。

# UW v0.2.0：Red Square 与 Drumheller 美术细化

本轮以参考照片、UW 官方建筑/景观描述与既有 GIS 为依据，直接制作可旋转、可缩放、可交互的 Three.js 几何和材质，不用一张效果图替代运行场景。保留 v0.1.0 完整包、Base 原件与用户状态；没有改建筑轮廓、地形源、导航图或 Base 代码。

## 已实现与精度

| 范围 | 本轮表现 | 仍需区分 |
| --- | --- | --- |
| Red Square | 不规则广场、红砖材质、放射状浅色分隔线、四组低台座、三座不同高的砖塔、Broken Obelisk 几何轮廓 | 边界/台座/砖塔位置与尺寸是地图/照片比例推定，雕塑为简化几何解释，不是扫描件 |
| Suzzallo | 11组高尖拱窗、下层拱廊/入口、扶壁、窗棂、简化龛饰/尖饰、石材与板岩坡屋顶 | 主立面重点细化；侧后翼、雕塑细节、门窗尺寸仍简化。建筑常态形象不代表2026施工即时状态 |
| Drumheller | 平水池、同心池沿、中央高水柱与两圈外喷束、动态水雾/水纹、四象限花坛、步道、座椅和灯柱 | 水池/喷头/花坛尺寸与植物配置为推定；不是实时开关、喷射高度测量或可进入水池的承诺 |
| Rainier Vista | 喷泉与南向步道、成列常绿树；远处 Rainier 按真实大致地理方位/距离表达 | 远山使用USGS位置转换到本地坐标，约98km；轮廓为原创示意，不是下载的山体DEM，非实时能见度 |
| 周边重点建筑 | Denny 穹顶/陡屋顶/圆角塔；Gerberding、Johnson、Mary Gates、Guggenheim、Bagley 的局部塔体与立面；Savery/Raitt 坡屋顶；Kane 的竖向构件 | 部分为建筑类型细节，不能当逐栋测绘完成。所有建筑高度与装饰尺寸仍是推定 |
| 整体 | 砖/石/板岩世界坐标材质、分组植被、实际坡地、软阴影、低视角/近景/全景 | 校园范围之外仍是裁剪模型表达；未复原全部现状绿化、树种/树位、导视、街景和每栋建筑立面 |

`public/art-scene.js` 是学校专属美术入口；`ART_VERSION`、`DETAIL_CODES`、`ART_CAMERAS`、`ART_REFERENCES` 和 `installCampusArt` 管理版本、重点建筑、镜头、参考与几何。未更改米制坐标、实体ID或共享的 `geometryHash`。长步道绘制段按1.5m采样贴合原DEM，避免铺装上的假穿插；这是渲染细分，不是新增通行路线。

## 怎么查看

启动后先展示 Red Square。顶部镜头按钮切换红场、Suzzallo、Drumheller、Vista；“专注景观”展开画幅，再点“恢复界面”回到功能界面。继续支持拖动/缩放、地标搜索、导览、接待和会话管理。没有把背景远山变成可导航校园地点。

## 参考与资产许可

来源面板列出本轮美术参考，亦见 `public/art-scene.js` 的 `ART_REFERENCES`：

- [UW Campus highlights](https://www.washington.edu/visit/campus-highlights-guide/)：照片/校园关系。
- [UW Libraries 建筑说明](https://lib.uw.edu/locations-hours/suzzallo-and-allen-libraries-history/)：立面、材料与细部。
- [UW Landscape Architecture](https://larch.be.uw.edu/portfolio/re-imagining-red-square/)：只用既有红场描述，未将改造提案当现状。
- [UW Facilities 喷泉说明](https://facilities.uw.edu/blog/posts/2019/04/03/draining-drumheller-fountain)：喷水形制，不沿用2019的运行时段。
- [Lloyd C. Heath 的 UW 参考照片](https://faculty.washington.edu/paymana/uw_photos.html)：立面、红场与喷泉轴线研究，保留摄影署名。
- [USGS Rainier](https://www.usgs.gov/volcanoes/mount-rainier)：地理位置；[NPS](https://www.nps.gov/mora/index.htm)：约4392m的公开海拔参考，未当作新实测。
- [Johnson Hall HRA](https://www.facilities.uw.edu/files/media/johnson-hall-hra.pdf)：摘要核对其与 Mary Gates 的对景和坡屋顶；未逐页审阅。

有版权的参考照片只在 `sources/art-reference/` 研究，不放入 `public/`、交付包或 Git。程序化砖石纹理、建筑构件、喷泉和植被是本轮原创代码生成；没有声称得到UW官方资产许可。下载不完整的红场历史PDF无法解析，未作为本轮已审读依据，也未将其中内容/图像用于成品。

## 验收边界

本轮记录实际浏览器近景/全景、材质编译、控制按钮和功能回归；自动检查不是真人、多设备、UW背书或精确BIM验收。运行模式仍为本地访客+资料检索接待，本次没有新接Hermes、校园七库或外部模型。

若后续要求更精细复原，应在原构件/实体上逐栋补充足够现状参考、尺寸与许可，优先完善 Suzzallo 侧翼、Gerberding 塔细节、Johnson/Mary Gates 两侧对景、花坛植物和真实铺装范围，不移走既有功能和稳定实体ID。
