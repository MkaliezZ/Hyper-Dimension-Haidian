# 资料选择、坐标和建模记录

## 采用的材料

- Seattle Building Outlines 2023：按校园包围框查询，转换为米制局部坐标；首版保留74栋建筑底面，不含高度。
- USGS King County 2021 1m GeoTIFF：先核对EPSG:26910和覆盖范围，用HTTP Range只读取所需窗口；裁剪GeoTIFF约1.72MB。运行展示按6m采样，不夸大垂直比例。
- 2025年6月UW官方校园地图：核对地名、建筑邻接、方庭、红场、喷泉与HUB关系；查看完整单页地图。
- Denny、Savery、Raitt、HUB历史资源PDF：仅采用有依据的历史与形制；具体核对页记录在 `SOURCE-LOCK.json`，不是所有PDF逐页审阅。
- 补充UW Engineering Services公开Buildings/Sidewalks/Roads图层：官方名称匹配与户外线网络。普通地址地理编码曾返回错误校园/位置，已弃用，未进入成品。

2019总体规划、景观框架、等高线、完整LiDAR和体育场资料暂不用于首版。规划方案不能当作现状，公开可访问PDF也不等于可再分发其照片。

## 坐标与不确定性

查询输出WGS84，经pyproj转换为 **NAD83 / UTM 10N（EPSG:26910，米）**。固定原点对应经纬度 `(-122.3079, 47.6562)`；运行轴为X东、Y上、Z南。真实数值和边界保存在 `campus.json`，不是压缩进Base室内300m契约。

地形保留原始高程差，以参考高程偏移显示；GeoTIFF垂直基准没有单独复核，不把数值当工程测量依据。地标坐标来自UW官方建筑几何或地图校准估计；到达点是附近的户外导览节点，不保证真实大门。

全部建筑高度为推定。Denny顶部、窗格、树、铺地、水池、路径显示宽度等是原创概念表达；没有使用点云测屋顶或复制第三方3D模型。当前美术只是功能可用的占位，UW专属外观与樱花树阵仍待深化。

步道以UW图层为基础，排除建筑内部，线交点生成图；绘图断点仅在3m内且无穿建筑时连接。最大连通网络有400节点、451边。此限制用于概念导览，不代表现场道路开放、无障碍或紧急通行。

## 重建

运行包的 `data/campus.json` 与裁剪DEM已可直接使用。只有更新GIS数据才需要：

```sh
python3 -m venv .tooling
# 激活该虚拟环境后安装：
python -m pip install -r requirements-geodata.txt
python scripts/prepare-geodata.py
node scripts/build.mjs
node scripts/verify.mjs
```

脚本读取/下载公开GeoJSON，缓存到 `sources/`；原始整县DEM不下载到运行包。Windows UW GIS下载使用系统证书校验，未禁用TLS校验。对照 `SOURCE-LOCK.json` 检查来源摘要；上游变化需要新资料版本与重新核对，不能把变动当作原快照精确重建。

`campus.json.geometryHash`由Base规范化摘要生成，渲染和路线响应共用。`DATA-MANIFEST.json`校验派生文件；修改资料后先重建并记录新版本，不覆盖封存交付包。`base/PACKAGE-MANIFEST.json`始终校验未修改的Base副本。
