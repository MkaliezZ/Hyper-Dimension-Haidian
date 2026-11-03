# 可选的第三方下载缓存

默认没有缓存时，安装器下载官方固定版本。网络较慢时，可在构建上下文的本目录临时提供 `node.tar.xz`、`keycloak.tar.gz`、`nakama.tar.gz` 与 `nodebb.git/`。

安装器始终核对 `integrations/versions.json` 对应的固定SHA-256和NodeBB提交；错误缓存直接失败，不能以缓存绕过校验。不要放用户数据库、服务私有配置或凭据。通用ZIP只保留本说明；大体积缓存由部署端自行准备、管理。
