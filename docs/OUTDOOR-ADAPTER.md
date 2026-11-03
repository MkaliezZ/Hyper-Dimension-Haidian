# UW 原生校园户外适配

v0.3.0 已在独立 UW Ubuntu 实例完成 9 项原生联调和 8 项新目标恢复检查，见 evidence/native-campus-20261028。4190 为保留的访客/Hermes 轻量预览；完整账号校园按 DEPLOY-UW.md 单独部署。

src/campus-world.mjs 提供九个真实公开地标、服务器行走位置和到达约束。base/src/platform/world-places.mjs 将可信 geo-campus/v1 适配与原室内房间契约分开；学校副本的 activities/community/environment/m2/network/partners 六个模块查询这个适配器。没有配置户外适配时沿用原室内路径，原学校/组织 ACL、审核、库存、账本和幂等逻辑继续执行，没有创建虚假室内房间。

另外两个源文件补丁是 tools/m0-init.mjs（初始化前验证显式学校定义，兼容 north/south 原默认值）和 deploy/entry.mjs（学校定义、运行根及身份防错）。新增 school-definitions.mjs 只接受学校/空间稳定 ID 与名称，不允许内容包注入可执行路径。UW 单学校配置使用 uw / uw-seattle，不重命名原演示学校。

学校 host 使用 data/space.json 显式声明的 geo-campus/v1 户外 bundle；这是备份传输入口，不交给 Base indoor scene/v1 loader。完整备份包含该目录，恢复后 host 从恢复目录读取校园几何和已发布静态资料。

原 Base 源码工作区、封存 ZIP 和用户数据保留。原清单完整保存为 base/SEALED-BASE-MANIFEST.json，当前学校副本由 base/PACKAGE-MANIFEST.json 和根学校总清单描述。新清单明确注明 8 个适配源文件和 2 个新增模块，不能声称仍是未修改的 Base。

开发工作区审计（使用新输出名）：

```sh
python scripts/verify-school-patch.py --out evidence/<new-run>/school-patch.json
```

此命令核对明确的源码差异、原封存清单、当前副本文件、原 Base 源文件、历史包与保护清单。它是本工作区的保留审计；接包者直接使用根 scripts/verify-package.mjs 和 base/tools/verify-package.mjs 校验自己收到的完整快照。
