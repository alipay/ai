# CLI 0.1.0 验证记录

以下是原订阅沙箱 CLI 0.1.0 的历史记录，不代表本次整包迁移已完成联网或资金相关验证。

日期：2026-11-02（北京时间）。运行环境：本机 Node.js v22.22.0；代码要求 Node.js >=18.17，但本次未在 Node 18 上另跑兼容矩阵。

## 自动化与安装

- 29 项自动化测试通过。使用可控 HTTP 响应验证请求路径、参数、资源归属、签约/支付单区分、恢复订阅别名、写前日志、超时不重试、退款独立路径、协议版本、时钟目标/请求编号、版本冲突、继续推进、等待支付、失败及等待超时。
- 所有交付 JavaScript 模块语法检查通过。
- `npm pack` 生成独立 tarball，不包含第三方依赖、业务配置、凭据或本地操作日志。
- 在临时空目录用 `npm install --offline --ignore-scripts --no-audit --no-fund --prefix ... <tarball>` 安装成功；安装出的 bin 执行 `--version` 和真实 `doctor` 成功。

## 真实沙箱只读验证

在现有商家 Demo 已保存证据所指的测试订阅上执行：

| 命令 | 实际结果 |
|---|---|
| `doctor` | 返回 `sandboxstable`、协议版本 `1` |
| `subscription inspect` | 成功读取订阅详情，状态 `CANCELED` |
| `operation resolve` | 成功定位既有操作，类型 `PAY_AND_SIGN` |
| `clock inspect` | 返回订阅维度时钟，`READY`，推进进度 `FINISH` |
| `messages list` | 返回 4 条消息记录 |
| `agreement inspect` | 成功读取协议快照 |

上述验证未更改该 Demo 的沙箱数据，不包含私钥或签名链接。

## 未验证范围

本次未通过 CLI 执行真实沙箱登记、付款/签约、时钟写入、解约、续费或退款；写操作目前的证据是契约测试，不是线上业务验收。也未验证商家真实通知接收、验签、落库和权益变化。Skill 集成后需在独立测试订阅上补齐端到端验证。

未发布 npm registry，未修改 Skill 项目、服务端、网页工作台或已有 Demo。交付是可本地安装的 0.1.0 CLI 包；Skill 的安装分发与执行指引由接收项目集成。
