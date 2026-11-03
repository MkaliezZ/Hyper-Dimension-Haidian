# 复制给 Codex：续建、美术与展示信息

> 执行前先读 [统一开发手册](../DEVELOPMENT-MANUAL.md) 与 [AGENTS](../AGENTS.md)。本文是分项清单；当前版本、运行模式、验证和打包以统一手册为准，保留旧包与用户数据。

请继续当前 Base 中的学校项目【projects/campus-a】。先读 AGENTS.md 和该项目的交接/MODELING-NOTES，查看 Git 差异与运行状态，保留已有修改和 .local 数据。按本次附件增加【房间/展项/校园信息/2.5D 素材】；已有 ID 不变，不把学校写死到 Base 核心。

如果当前只有简陋体块，或用户要求“美化/做漂亮一点”，自行读取 prompts/04-VISUAL-POLISH.md，主动引导统一风格、补素材并给出前后对比，不要求用户另外写一份美术需求清单。

依据 docs/EXTENSIONS.md 使用 assets/exhibits/scene.artwork 接入图片或 GLB，核对比例、锚点、包围盒、footprint 与房间权限。新增学校事实必须有来源与可公开状态。资料变更同步 documents.json 和向量库快照；新增素材记录授权。用实际浏览器检查互动和路线，提交可复建的修改、差异说明、截图和未核实项，不把只换画面当成完成。
