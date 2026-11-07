# 私有源码仓库与脱敏范围

此仓库保存北京海淀校区v1.1.2的学校应用、Base源码、公开运行素材和可续建文档。上游为UW v0.11.3，原UW项目的暂停状态和私有运行资料不被本仓库修改。海淀功能对照见[逐项审计](HAIDIAN-FUNCTION-PARITY.md)。

## 排除的数据

- `.local`、`.private-inputs`、`.tooling`、原始`sources`、运行配置、密钥、Cookie/Token、数据库、用户会话、聊天、存档和备份。
- 根目录及Base的历史`evidence`正文、日志、截图、测试运行产物和开发机器路径记录。
- 用户上传的图纸、原始运营文件、私有转换稿和个人资料；保留通用导入代码与原创虚构示例。
- 完整交付ZIP、`node_modules`、模型权重、Hermes源码缓存及uv安装轮子。公开依赖保留固定来源、版本、许可证和哈希，可由工具恢复。

虚构测试账号标识、明确的`.invalid`/`example`邮件、占位密码、回环地址和公开校园资料/照片署名属于测试/公开来源。正式校方、组织和合作方资料须在部署后由负责人录入。海淀6290实例已启用的私有模型密钥不随源码分发；在新机器上恢复代码后仍需配置本实例凭据。

## 源码一致性

海淀保留上游全部985个源码文件，其中538个Base文件字节一致；学校内容、几何、公开素材和独立部署标识有明确适配。功能对照覆盖45项原规划的42项在用范围、23个服务模块和地图/人物/NPC/A2A接口。两项P2和个人长期记忆继续遵守上游暂缓/移除决定。原UW、海淀旧交付、私有用户数据与配置保留。

`base/SEALED-BASE-MANIFEST.json`保留原Base来源清单；它描述原交付，不是当前Git树。`docs/UPSTREAM-SOURCE-MANIFEST.json`保留UW基线。Git树的当前清单为`SOURCE-MANIFEST.json`，使用`node scripts/verify-source.mjs`核对。

`python scripts/pack-haidian.py --source-manifest`默认生成Git源码范围，不包含被Git忽略的历史`evidence`、日志或截图，避免出现清单列出文件、克隆后却缺文件的情况。公开的本次功能对照摘要放在`docs/HAIDIAN-FUNCTION-PARITY.json`。旧版完整证据仍保存在本机及此前封存包，不伪造缺失的历史文件；需要包含已审核本地证据的额外ZIP时显式使用`--include-evidence`，不得提交到Git。

## 依赖和许可证

`SOURCE-DEPENDENCIES.json`只列3个固定公开依赖；恢复工具逐文件验证体积与SHA-256，遇到已存在的不同文件直接停止，不覆盖。

仓库私有不改变Base的MIT、NodeBB等组件的原有许可。原许可证、源码锁、图片署名与来源清单保留。项目自有代码的私有许可声明仅作用于自有部分。
