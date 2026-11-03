# 固定的 Hermes 服务器接待源码

`source.tar.gz` 是 `SOURCE.json` 指定的官方提交的纯Git跟踪文件快照，采用 `git archive --format=tar.gz --prefix=hermes/ COMMIT` 导出。它不含开发者安装目录的个人配置、聊天、虚拟环境或未跟踪文件。固定提交的官方来源：https://github.com/NousResearch/hermes-agent/tree/0a62610f10cc34d696b2239b2c69fa1ba0f1ca63 。归档内保留上游LICENSE、第三方说明及uv.lock。

Hermes为独立开源组件，版权和许可证沿用上游。Base的会话、授权与保留规则不交由Hermes个人记忆实现。Ubuntu镜像先校验本归档SHA-256，再使用固定Python 3.13和上游冻结依赖锁安装核心运行时。Python镜像、Hermes核心依赖、模型API与其余外部服务需要联网配置；本包不是离线服务器镜像。

本目录另附Linux amd64的uv 0.12.1官方轮子，避免安装器版本无法读取该锁文件。Docker构建离线核对 `deploy/hermes-bootstrap.txt` 的SHA-256后安装；轮子保留自身 `dist-info/licenses` 中的Apache-2.0/MIT许可证。来源与哈希来自 https://pypi.org/pypi/uv/0.12.1/json ，不是自行编译的替代安装器。
