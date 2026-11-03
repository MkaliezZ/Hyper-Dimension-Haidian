# Hyper Dimension-UW

基于 Hyper Dimension Base 的 UW Seattle 像素校园应用，当前应用版本 **v0.11.3**。这是私有源码仓库；开发目前暂停，收到明确恢复指令后再继续。

保存 UW 应用源码、运行素材、内嵌 Base 源码、锁定依赖、测试和部署工具。Git 不保存账号密码、密钥、运行数据库、私人材料、历史日志、截图、聊天或用户存档，也不上传交付 ZIP、模型权重和依赖安装缓存。原完整交付包另外保留。

## 已有功能

- **Base-1 空间与接待**：74栋可选建筑、公开地标资料/照片、自由漫游与寻路、账号/学校隔离、Hermes接待、A2A、知识库及向量索引、数据治理和备份。
- **Base-2 人物与关系**：简单部件编辑及持久化、背包、非破坏性互动、联系人同意、私信和实时交流。
- **Base-3 社区运营**：地点留言、论坛审核/历史、组织、活动/志愿、贡献/排名/奖励、运营年历、校友发现、学长支持及职业机会。
- **Base-4 周边合作**：合作方入驻、服务目录、受控A2A委托、确认工单、回执对账及权益核销。
- **NPC与任务**：6位固定点位、可选择/对话/功能跳转的演示角色；本人A2A任务查询、筛选、回执导出和确认停止。

逐项范围见 [45项功能对照](docs/BASE-FEATURE-AUDIT-20261102.md)。个人Agent长期记忆已移除；地区/跨校社群和复杂交易P2保持暂停。正式学校资料、生产服务器/身份/邮件、真实商户接口和目标容量/实际参与者验收按上线项目完成。

## 从源码启动

Node.js 22.13+：

```sh
node scripts/verify-source.mjs
node scripts/verify.mjs
node server.mjs
```

打开 `http://127.0.0.1:4190/`。这是轻量参观模式，包含地图、人物、导航和公开资料接待，不连接已有生产数据，没有预置真实账号密码。

完整校园业务面向Ubuntu/Linux amd64，使用Keycloak、PostgreSQL/pgvector、NodeBB、Nakama、Hermes及Docker Compose，见 [启动与部署](docs/DEPLOY-UW.md) 和 [Base容器部署](base/docs/DEPLOYMENT-CONTAINERS.md)。不要复制其他实例的运行数据库或私有配置。

### 开发与部署依赖

运行全量测试或离线场景生成前，安装锁定Node依赖：

```sh
npm --prefix base ci --ignore-scripts --no-audit --no-fund
npm --prefix base/admin ci --no-audit --no-fund
node --test tests/*.test.mjs
```

完整Embedding/Hermes镜像另需3个公开依赖文件。来源、版本和SHA-256在 `SOURCE-DEPENDENCIES.json`、模型清单、Hermes SOURCE.json及bootstrap锁文件中保留：

```sh
# 从已有完整交付ZIP只恢复3个公开依赖，不导入用户数据
python scripts/restore-source-artifacts.py --delivery /absolute/path/to/UW-Pixel-Campus-v0.11.3-complete.zip
# 或从固定公开来源联网恢复，并校验原SHA-256
python scripts/restore-source-artifacts.py --fetch
```

随后按容器手册先构建Base/Hermes依赖镜像，再构建UW镜像。密钥由部署端私有文件或Docker secrets注入。后端接待为Hermes，NPC可接DeepSeek普通API；外部访客Agent品牌不限，沿用A2A及授权。

## 接手入口

| 内容 | 入口 |
| --- | --- |
| Agent约束 | [AGENTS.md](AGENTS.md) |
| 当前版本交接 | [CURRENT-DEVELOPMENT-0113](docs/CURRENT-DEVELOPMENT-0113.md) |
| UW完整操作与美术说明 | [UW-APPLICATION](docs/UW-APPLICATION.md) |
| 四Base统一开发手册 | [base/DEVELOPMENT-MANUAL.md](base/DEVELOPMENT-MANUAL.md) |
| A2A任务工作台 | [A2A-TASK-WORKBENCH](docs/A2A-TASK-WORKBENCH.md) |
| 脱敏、数据与许可范围 | [REPOSITORY-SCOPE](docs/REPOSITORY-SCOPE.md) |

`SOURCE-MANIFEST.json`校验Git源码快照；原ZIP的PACKAGE-MANIFEST不直接套用到Git树。旧文档指向的历史evidence正文在本地交付中保留，不随仓库上传。重新做完整分发包时，恢复依赖、完成对应验证并生成新清单，保留封存包。

## 私有代码与第三方许可

项目自有UW适配代码和原创素材按私有项目管理，见 [LICENSE](LICENSE)。内嵌Base及第三方组件保持原许可证，见 [LICENSES.md](LICENSES.md)、[base/LICENSE](base/LICENSE)和组件声明；照片逐文件署名、来源和许可保留在素材清单。第三方代码没有重新归为本项目专有代码。
