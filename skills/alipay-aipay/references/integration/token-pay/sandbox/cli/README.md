# 订阅沙箱 CLI 0.1.0

供订阅 Skill / AI Agent 调用的沙箱工具。Node.js >= 18.17，无第三方依赖。不需要启动本地 Web 服务，不依赖 B 站页面和浏览器 Cookie。仅连接固定的订阅沙箱服务，不提供生产环境切换参数。

## 运行

从商家工程目录调用当前 Skill 附带的脚本。将 `<SKILL_DIR>` 换成已加载的根 `SKILL.md` 所在的绝对目录。

```sh
node "<SKILL_DIR>/references/integration/token-pay/sandbox/cli/bin/sandbox.mjs" help
node "<SKILL_DIR>/references/integration/token-pay/sandbox/cli/bin/sandbox.mjs" doctor --json
```

`help` 离线可用；`doctor` 会检查实际沙箱连接及身份。执行交易相关动作时依照当前用户的沙箱请求和已授权范围，复用日志中的 request ID 核实重试。

## 命令

下表中 `SID` 是 19 位字符串订阅 ID。示例里的占位符需替换；不要转换成长整型或 JavaScript Number。

| 目标 | 命令与必要选项 |
|---|---|
| 连通性和环境检查 | `doctor` |
| 沙箱应用调用登记 | `authorize --merchant-id PID --app-id APPID` |
| 从本次完整 JSON/长链解析并查询操作 | `operation resolve --input response.json` |
| 从 stdin 解析并查询操作 | `operation resolve --input -` |
| 确认本次模拟支付/签约 | `operation confirm --input response.json` |
| 用 ID 查询/确认付款 | `operation resolve/confirm --subscription-id SID --payment-order-id PAYMENT_ID` |
| 用 ID 查询/确认仅签约 | `operation resolve/confirm --subscription-id SID --operation-id OPERATION_ID` |
| 查看默认操作（只读） | `operation resolve --subscription-id SID` |
| 查看订阅详情、周期、支付单、历史 | `subscription inspect --subscription-id SID` |
| 查看消息发送记录 | `messages list --subscription-id SID --offset 0 --limit 20` |
| 查询协议 | `agreement inspect --subscription-id SID` |
| 模拟解约 | `agreement unsign --subscription-id SID --expected-version HASH` |
| 执行到期续费任务 | `renewal --subscription-id SID [--payment-order-id PAYMENT_ID] [--request-id UUID]` |
| 查询已申请退款 | `refund inspect --subscription-id SID --refund-order-id REFUND_ID` |
| 模拟确认已申请退款 | `refund confirm --subscription-id SID --refund-order-id REFUND_ID` |
| 重试退款通知 | `refund retry-notifications --subscription-id SID --refund-order-id REFUND_ID` |
| 查询时钟 | `clock inspect --subscription-id SID` |
| 绑定订阅维度时钟 | `clock bind --subscription-id SID` |
| 推进时钟 | `clock advance --subscription-id SID --to 2026-12-03T00:00:00+08:00 --wait` |
| 恢复指定推进 | `clock resume --subscription-id SID --operation-id UUID --expected-version VERSION --wait` |

`resolve/confirm` 表示两条独立命令，不是实际命令中的斜线。

通用参数：`--merchant-id` 可约束订阅归属；`--timeout-ms` 默认为 35000，范围 100–120000；`--journal` 指定本地操作日志路径。不可覆盖远端地址，不读取浏览器 Cookie，不读取环境中的生产网关或生产密钥。

时钟参数：`--to` 只接受带时区的 ISO 时间或 13 位毫秒时间戳；`--expected-version` 可约束 advance 的已读版本；`--request-id` 可固定 advance / renewal 请求编号，省略时生成 UUID，并在发送前写入日志。resume 必须指定查询得到的操作 ID 和版本。

`--wait` 默认等待 60 秒，`--wait-timeout-ms` 范围 100–600000，`--poll-ms` 默认 1000，范围 100–10000。等待预算不包含初始推进请求；已发出的单个 HTTP 请求仍受 `--timeout-ms` 限制，因此总耗时可能超过等待预算一个请求超时时间。

## 结果、恢复和并发

```json
{"schemaVersion":1,"ok":true,"environment":"sandboxstable","command":"clock inspect","data":{}}
```

`ok: true` 表示命令成功取得通过基础契约校验的结果，业务状态以 `data` 为准：不带 `--wait` 的推进可能仍是 `ADVANCING`；renewal 可能是 `WAITING_PAYMENT`；退款可能仍在处理中。CLI 回执不代表商家收到通知或开通权益。

| 退出码 | 语义 |
|---|---|
| 0 | 命令完成，检查返回业务状态 |
| 2 | 参数/输入错误，未执行业务写请求 |
| 3 | 查询、连接、环境或前置契约检查失败 |
| 4 | 写请求已发送但结果未确认，或写后回执/日志异常，先查询 |
| 5 | 当前动作受阻、时钟失败、等待支付、并发操作变化或等待超时 |

错误在 `error.code / message / nextAction`；涉及写请求时附 `lastWrite` 和 `journal`，时钟受阻时附最新 `clock`。并非所有错误都有 `nextAction`，Agent 同时使用退出码和错误码判断。

每次写请求先落盘 intent，再发请求，最后记录 response 或 unconfirmed，默认日志为当前工作目录下 `.alipay-aipay-new/token-pay/sandbox-cli/journal.jsonl`，文件权限 0600。日志包含请求编号、操作 ID、时间和版本，不存私钥、签名长链或 token。它是恢复线索，不是业务完成证明；进程中断后先查远端，不能仅凭 intent 重放。

- confirm 必须指定本次操作；仅签约不会伪造支付单。已完成的同一操作再次确认直接返回查询结果。恢复订阅链接的外部协议号会先解析为当前操作 ID。
- 写请求不做通用自动重试。超时后先用 resolve / inspect 查询；不要因为未知结果创建新订阅或生成新请求编号重试。
- 时钟 `--wait` 仅继续相同 operationId、相同 targetTime 的 `REQUEST + CONTINUE` 操作，每次使用新查询的版本。检测到新操作立即退出。
- 服务端 `status=FAILED` 且 `pauseReason=WAITING_PAYMENT` 时返回专用 `WAITING_PAYMENT`，先核对并确认对应支付单，再显式 resume。CLI 不会自动代付所有待支付单。
- 真正的 FAILED 不自动恢复；先诊断，再使用当前 operationId/version 显式 resume。等待超时不会取消远端推进。
- authorization 仅是登记，不表示已取得密钥或具备 OpenAPI 权限；doctor 仅验证环境身份和连通性，不证明商户鉴权成功。

## 首版边界

已封装现有沙箱测试控制能力，未新增服务端接口或改变平台鉴权。安装本工具不赋予账号访问权限。开放平台登录、取得应用凭据、配置应用网关、订阅消息与公网回调连通性仍由 Skill 的准备流程处理。

创建商品/价格/客户/订阅、申请变更/取消/退款仍使用商家工程和正式 OpenAPI 契约。此包不包含任意 OpenAPI 调用器、凭据抓取或回调隧道。

长链解析复用当前网页解析规则，只解析标准 `alipay_jump_schema` 支付/签约长链或一层响应包装；不跟随短链，不打开 URL，不接受仅支付单号且没有订阅 ID 的输入文件。可从业务响应拿到 subscriptionId 后显式指定操作 ID。

首版不包含旧版周期整体平移（time-shift）、账号管理或商家权益断言。生命周期测试使用订阅测试时钟；时钟不会推进商家自己的系统时间。消息查询仅显示沙箱发送记录，最终验收需由 Skill 核对商家通知验签、幂等、落库和权益。

## 实现依据

根据现有网页的 `subscriptionSandbox.ts`、`paymentLink.js` 和沙箱 HTTP Controller 核对契约。链接解析器保留网页算法；其余实现为独立 Node.js 模块。未引入前端框架、内部 RPC、数据库连接或第三方 SDK。

## 验证

运行 `npm test` 执行受控 HTTP 响应的契约与 CLI 测试。网络依赖仅通过测试注入替换，命令行没有测试服务器或生产服务器覆盖开关。

实际完成的验证及边界见本源码目录下 `VERIFICATION.md`。安装集成方仍需在专用测试订阅上验证真实写入、通知和商家权益闭环。
