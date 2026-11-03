# v0.7.0 分块像素素材来源

生成模式：**内置 image_gen.imagegen**，透明背景、附带真实参考的生成。原始输出保持不变后复制进 public/assets/oblique；没有用 Python 重绘或抠图。Canvas 在运行时依清单裁剪透明外沿、组合并以最近邻缩放。环境图集按实际分隔位置裁剪，不假设生成器严格输出等分网格。

| 场景文件（相对于项目根） | 参考研究输入（不分发） | 提示词 |
| --- | --- | --- |
| public/assets/oblique/suzzallo-v1.png | UW Suzzallo 西立面与 Red Square 外景照片 | art-oblique-070/suzzallo.prompt.txt |
| public/assets/oblique/denny-v1.png | denny-hall-hra.pdf 第 37 页立面照片 | art-oblique-070/denny.prompt.txt |
| public/assets/oblique/raitt-v1.png | raitt-hall-hra.pdf 第 19 页历史东南外观 | art-oblique-070/raitt.prompt.txt |
| public/assets/oblique/savery-v1.png | raitt-hall-hra.pdf 第 24 页历史 Savery 西南外观 | art-oblique-070/savery.prompt.txt |
| public/assets/oblique/hub-v1.png | HUB 官方站当前砖石/玻璃外观照片 | art-oblique-070/hub.prompt.txt |
| public/assets/oblique/kane-v1.png | UW 官方 Kane 外观照片 | art-oblique-070/kane.prompt.txt |
| public/assets/oblique/fountain-v1.png | Drumheller 圆池、水柱、环道和景观轴线照片 | art-oblique-070/fountain.prompt.txt |
| public/assets/oblique/environment-v1.png | 原创树、长椅、路灯、绿篱、塔标，无外部图像参考 | art-oblique-070/environment.prompt.txt |

尺寸、透明裁剪、字节与 SHA-256 的权威清单为 public/assets/oblique/manifest.json。六张建筑原图和喷泉原图均为 1254×1254；环境图集 1774×887。完整提示词在 docs/art-oblique-070。当前场景实际使用这些文件；不是只提供图鉴。

可核对的公开来源：

- [UW 官方校园地图](https://map.uw.edu/?id=2099)：位置和建筑标识；不提供本项目模型。
- [Denny HRA](https://facilities.uw.edu/files/media/denny-hall-hra.pdf)、[Raitt HRA](https://facilities.uw.edu/files/media/raitt-hall-hra.pdf)：历史形制，不承诺当前状态一致。
- [HUB 官方介绍](https://hub.washington.edu/about/) 与[官方外观照片](https://hub.washington.edu/wordpress/wp-content/uploads/2020/08/HUB-Front-e1598051140522-1140x729.jpg)。
- [UW Kane 官方照片](https://www.washington.edu/admin/ada/227-l.jpg) 与[UW 建筑档案](https://pcad.lib.washington.edu/building/5184/)；旧无障碍页面不作为当前通行条件依据。

研究原件在 sources/art-reference，仅供本次参考，不由 HTTP 提供，也不进入交付。图像属于原创艺术概括，不是精确比例模型、官方 UW 资产、可通行/应急承诺或逐株树木测绘。后端继续依真实公开派生轮廓和路径限制移动。
