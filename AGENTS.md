# 海淀外国语学校副本 · 当前开发入口

用户于2026-11-03明确授权：复用Hyper Dimension-UW完整前后端，替换北京海淀校区的信息、布局和美术。UW原项目暂停状态不阻止本独立学校副本；不修改原项目、原数据和旧交付。

Read README.md, HANDOFF.md, docs/HAIDIAN-SOURCES.md and base/DEVELOPMENT-MANUAL.md. Upstream is UW v0.11.3 commit 665297ab983fb702c034a25f33688f0be91a98c1. Base core, avatar generators, security, private sessions, 23 service modules, fixed NPC behavior and budgets are inherited. Never copy UW production configuration, keys, users or databases. School=haidian, space=haidian-beijing, scene=haidian-outdoors, default preview port=4290.

School geometry is hand-traced from a public 2018 schematic; no surveyed current accuracy is claimed. Shared geometry drives art, walking, water/bridge collision and routes. Rebuild color AND depth after geometry changes. Heights, materials and planting remain explicit artistic estimates. Keep public factual reference separate from private conversation. Do not modify base/ for school branding or content. Historical UW development instructions are preserved in docs/UPSTREAM-UW-AGENTS.md as provenance, not this school's current geometry authority.

Run npm run build, npm run verify and the documented current regression suite. Keep original UW-specific geometry tests as upstream receipts; do not describe them as current-school validation. Full native services require independent ports, namespaces, volumes and configuration. No private-browser access; no old flagged lifecycle helpers. Use standard visible Docker/Ubuntu lifecycle only. Technical checks do not establish school endorsement or real participant acceptance.
