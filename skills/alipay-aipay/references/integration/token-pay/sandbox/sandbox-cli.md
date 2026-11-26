# 沙箱 CLI 执行入口

用于 AI 执行周期订阅沙箱测试控制。随 Skill 附带 CLI 0.1.0，Node.js >=18.17，零第三方依赖，无需全局安装或修改商家项目依赖。完整命令见[随包使用契约](cli/README.md)，实测边界见[CLI 验证记录](cli/VERIFICATION.md)。只想使用网页时仍按[网页指南](sandbox-integration.md)。

两套 CLI 分工：外部 `alipay-cli` 由公共 `runtime.mjs sandbox` 调用，负责基础配置；本页随包 `sandbox.mjs` 负责调用登记、模拟支付和测试时钟。它们共用同一 JSON 中的 APPID/PID，本页 CLI 不创建第二套沙箱。

## 定位与预检

从本次读取的 `SKILL.md` 所在目录确定 `<SKILL_DIR>`；不要写死维护者机器路径，也不要假设全局 PATH 有命令。当前 Skill 根目录名为 `alipay-aipay`。切到商家工程目录后执行：

```sh
node <SKILL_DIR>/references/integration/token-pay/sandbox/cli/bin/sandbox.mjs help
node <SKILL_DIR>/references/integration/token-pay/sandbox/cli/bin/sandbox.mjs doctor --json
```

入口缺失说明安装内容不完整或版本较旧：先检查实际包/安装路径，使用包含 CLI 的本地包或已核实版本修复；当前 CLI 未独立发布 npm，不猜 registry 包。Node 版本不足或不能运行命令时保留具体阻塞，仍可用网页执行其支持的动作。

CLI 固定连接沙箱，默认 JSON；doctor 成功只说明环境身份/连通性正确，不证明商家密钥、OpenAPI 权限或通知正常。将 `.alipay-aipay-new/token-pay/sandbox-cli/` 加入商家工程 `.gitignore`（已忽略整个 `.alipay-aipay-new/` 时无需重复），写前日志默认位于其中的 `journal.jsonl`，不能当作业务成功证据。该工程内状态路径不随 Skill 名称统一搬迁，已有日志继续按原恢复流程使用。

## 在交付流程中使用

命令都通过上述绝对入口调用，以下仅列后续参数；ID 保持字符串，SID 为本任务 19 位订阅 ID。平台写操作仅在用户授权的沙箱任务范围内执行，先核对归属和具体操作。

| 阶段 | CLI 动作及完成条件 |
|---|---|
| 准备 | 先由公共模块获取或复用 `.alipay-sandbox.json`；应用网关、消息订阅、公网回调仍按 sandbox-integration.md 单独完成 |
| 登记 | 从统一 JSON 取得 PID/APPID 后执行 `authorize --merchant-id PID --app-id APPID`；仅登记调用配置，随后仍须从商家工程验证真实 OpenAPI |
| 首付/变更 | 商家工程创建或修改订阅，保存本次完整响应到权限 600 的临时文件（不进日志/仓库）；`operation resolve --input response.json` 核对归属、金额、action 和本次单号，再 `operation confirm --input response.json`。完成后清理输入文件 |
| 无长链时 | 支付用 `--subscription-id SID --payment-order-id PAYMENT_ID`，仅签约用 `--subscription-id SID --operation-id OPERATION_ID`。单独 SID 只允许 resolve，不自动挑一笔待支付单确认；不为仅签约新建支付单 |
| 查询验收 | `subscription inspect --subscription-id SID --merchant-id PID` 和 `messages list --subscription-id SID` 辅助核对；商家工程仍须查询/处理通知，验证实际落库及权益 |
| 续费与期末 | 先 `clock inspect`，未绑定时 `clock bind`；读取当前周期、时间和版本后，用 `clock advance --subscription-id SID --to <带时区目标时间> --expected-version VERSION --wait` 推进当前订阅。避免固定天数假定所有月份相同 |
| 等待付款 | 遇到 WAITING_PAYMENT，定位该推进对应的支付单，resolve 核对后 confirm，再 clock inspect，用查询出的 operationId/version 显式 `clock resume --subscription-id SID --operation-id UUID --expected-version VERSION --wait` |
| 取消 | 商家工程调用 subscription.modify 预约取消；确认预约期间权益保留，再推进到实际结束、查询 CANCELED 并核验商家权益。`agreement unsign` 是模拟解约，不能替代商家期末取消请求 |
| 按需能力 | renewal、agreement inspect/unsign、refund inspect/confirm/retry-notifications 的参数见随包 README；退款申请仍由商家工程 OpenAPI 发起，不因工具可用而扩大验收范围 |

输入也可通过 `--input -` 同次传 stdin，不把完整签名长链放 argv、shell 字符串或对话。CLI 不跟随短链、不打开支付 URL。使用实际 merchantId 约束本任务归属；它不是凭据或鉴权替代品。

## 退出码与恢复

- `0`：命令取得结果。继续检查 `data` 中的状态；`ok:true` 不等于支付终态、通知送达或商家权益已成功。
- `2`：参数/输入错误，修正后再执行。
- `3`：查询、连接或前置检查失败；先核对错误原因，不能绕过环境或归属校验。
- `4`：写结果未确认或写后记录异常。保留 journal/lastWrite，先查同一资源和操作；不生成新订阅或新请求编号盲重放。
- `5`：受阻、并发变化、失败或等待超时。按 error.code 和最新 clock 处理；等待超时不会撤销远端推进。

`--wait` 只继续同一 operationId/targetTime，不能当作自动恢复任意失败或自动付款；WAITING_PAYMENT 先完成对应单，再显式 resume。真正 FAILED 先诊断；发现其他操作已推进时停止并重新核对。按宿主单次等待限制设置 `--wait-timeout-ms`/`--timeout-ms`，长流程要持续向商家反馈进度。

## 验收边界

本次随包首版已有契约测试和真实只读验证，真实写操作尚待专用订阅验证，不继承此前网页模拟成功的证明。CLI 操作成功之后仍按 [sandbox-delivery.md](sandbox-delivery.md) 验收商家通知验签、幂等、落库、查询补偿和权益。发送记录不能替代接收证据；平台测试时钟也不会推进商家系统时钟。缺少真实投递时维持部分通过结论。
