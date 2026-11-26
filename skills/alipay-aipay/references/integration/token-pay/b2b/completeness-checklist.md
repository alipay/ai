# 企业支付集成完整性检查

## 目录

- [使用方式](#使用方式)
- [接入画像](#接入画像)
- [证据格式](#证据格式)
- [基础必检项](#基础必检项)
- [条件必检项](#条件必检项)
- [验收规则](#验收规则)

## 使用方式

从[随包 manifest 样例](assets/b2b-integration-manifest.example.json) 创建商户工程根目录下的 `enterprise-payment-integration.json`，按当前清单结构填写实际接入画像、删除不适用能力并替换证据。运行[本地验收器](scripts/validate_b2b_integration_manifest.py)：

```bash
python3 "<SKILL_DIR>/references/integration/token-pay/b2b/scripts/validate_b2b_integration_manifest.py" \
  --manifest enterprise-payment-integration.json \
  --project-root .
```

检查器不扫描具体语言语法，也不根据文件名猜测完成度。每个完成声明必须有可定位的代码、测试、非生产运行记录或平台配置回执。

## 接入画像

技术画像字段：

| 字段 | 允许值 | 说明 |
| --- | --- | --- |
| `language` | 匹配 `^[a-z][a-z0-9.+#_-]{0,31}$` | 实际调用服务的小写语言名，必须有仓库识别依据 |
| `client_mode` | `OFFICIAL_SDK`、`DIRECT_GATEWAY` | 按目标语言官方 SDK 的实际覆盖情况选择 |
| `protocol` | `CLASSIC_GATEWAY_V2` | 当前企业支付只支持经典 `gateway.do` 协议 |
| `security_mode` | `PUBLIC_KEY`、`CERTIFICATE` | 与开放平台当前应用配置一致 |

多语言仓库以实际发起企业支付调用的部署单元为准。无法唯一定位时必须先询问用户，不得把猜测语言写入画像。

`profile.flows` 支持：

- `AGGREGATE_CASHIER`
- `ALIPAY_PC`
- `ALIPAY_APP`
- `BANK_TRANSFER`
- `ENTERPRISE_EBANK`
- `BANK_TRANSFER_DIRECT`

`profile.capabilities` 支持：

- `ACCOUNT_MANAGEMENT`
- `JIANGSU_BANK_ACCOUNT_OPENING`
- `TRADE_CLOSE`
- `REFUND`
- `PARTIAL_REFUND`
- `REFUND_DETAIL_QUERY`
- `BILL_DOWNLOAD`
- `EBANK_CONSULT`
- `BANK_FUND_CONFIRMATION`

画像约束：四种支付渠道 flow 依赖 `AGGREGATE_CASHIER`；部分退款和退款明细依赖退款；账户管理依赖银行转账；`EBANK_CONSULT` 依赖 `ENTERPRISE_EBANK`；`BANK_FUND_CONFIRMATION` 依赖 `BANK_TRANSFER`；账单下载触发 T+1 文件接入和资金对账检查。`BANK_TRANSFER_DIRECT` 仅用于兼容已有指定渠道清单。

## 证据格式

每个 `evidence.<requirement_id>` 是证据数组。支持四种证据：

```json
{"kind":"file","path":"src/payment/alipay_client.java","description":"官方 SDK 适配和响应验签"}
```

```json
{"kind":"test","path":"tests/payment_test.java","case":"should_not_fulfill_on_redirect","description":"同步跳转不确认支付"}
```

```json
{"kind":"run","path":"evidence/dev-payment-e2e.md","environment":"dev","description":"脱敏的非生产端到端记录"}
```

```json
{"kind":"external","reference":"PAYMENT-PLATFORM-CONFIG-001","description":"产品签约和 OpenMQ 配置回执"}
```

`file`、`test` 和 `run` 路径必须相对 `project-root`，存在且不能逃逸工程目录。`run.environment` 只允许 `sandbox`、`dev`、`test`、`pre`。清单不得包含真实密钥、密码、令牌、银行商户号、银行母户账号、账户名或银行联行号。

## 基础必检项

| requirement_id | 完成标准 |
| --- | --- |
| `product_activation` | 聚合收银产品已签约；所选银行能力同时完成银行直连产品签约 |
| `merchant_application_readiness` | 已确认商户自研边界；产品与目标自有应用绑定，应用状态满足目标环境调用要求 |
| `open_platform_configuration` | PID、`app_id`、公钥或证书、网关和环境隔离均已核对，有脱敏平台配置或联调证据 |
| `official_sdk` | 仅 `OFFICIAL_SDK` 触发；使用目标语言官方支付宝 SDK，并有版本和接口覆盖证据 |
| `language_build_and_test` | 必检；运行目标服务真实语言编译和测试命令，不用文件存在代替构建成功 |
| `direct_gateway_request_signing` | 仅 `DIRECT_GATEWAY` 触发；原值排序、RSA2、Base64 和 URL Encode 时机均有原生语言测试 |
| `direct_gateway_response_verification` | 仅 `DIRECT_GATEWAY` 触发；从原始响应提取业务 JSON value 验签，篡改、缺失签名和重复 root 失败关闭 |
| `direct_gateway_transport` | 仅 `DIRECT_GATEWAY` 触发；超时、取消、非 2xx、响应大小和流关闭均处理 |
| `certificate_mode` | 仅 `CERTIFICATE` 触发；请求序列号、响应 `alipay_cert_sn` 选证书、未知序列号拒绝和轮换流程均验证 |
| `rsa2_security` | RSA2 请求签名和响应验签均实现，验签失败不更新订单 |
| `secret_management` | 私钥由受控配置读取，仓库和日志无明文密钥 |
| `contract_models` | [企业支付接口](api-contract.md)按选中能力建模，snake_case、元字符串金额和条件字段处理正确 |
| `trade_create` | 创单适配完成，响应验签并持久化商户订单关联事实 |
| `create_idempotency` | `out_trade_no` 先落库；同号重试保持全部业务参数不变 |
| `trade_query` | 查单可按稳定订单标识调用并映射三种交易状态 |
| `payment_finality` | 只有 OpenMQ 或主动查单的 `TRADE_SUCCESS` 能触发支付履约 |
| `openmq_subscription` | 同一应用订阅 `alipay.trade.saas.order.changed`，有平台配置证据 |
| `openmq_method_routing` | 先按信封 `method` 精确路由再解析业务内容；目标、非目标和缺失 `method` 均有自动化测试或非生产运行证据 |
| `openmq_idempotency` | `order_no + trade_status` 持久化去重，业务履约也幂等 |
| `openmq_ack_and_recovery` | 事务提交后 ACK；重复、乱序、失败重投和脏消息均有处理 |
| `error_and_unknown_result` | 参数错误、明确失败、明确受理中和结果未知分类处理；`REFUND_PROCESSING` 保存处理中并查退款终态，结果未知先查后决定是否原号原参重试 |
| `observability_and_redaction` | 业务号和平台 trace 可关联，私钥、令牌、签名原文和敏感 URL 已脱敏 |
| `status_reconciliation` | 长时间非终态订单和缺失消息有定时主动查询补偿 |
| `non_production_e2e` | 至少一份非生产创单、支付确认、查单和所选能力的脱敏运行记录 |

## 条件必检项

| requirement_id | 触发条件 | 完成标准 |
| --- | --- | --- |
| `aggregate_cashier_redirect` | `AGGREGATE_CASHIER` | `cashier_url` 原样跳转，未调用收银台内部 HTTP，redirect 不确认支付 |
| `bank_transfer_direct_create` | `BANK_TRANSFER_DIRECT` | 单一 `BANK_TRANSFER` 的买家信息二选一组合、同步响应和到账确认均实现 |
| `alipay_terminal_payment` | `ALIPAY_PC` / `ALIPAY_APP` | 终端产品准备、页面拉起和 `TRADE_SUCCESS + ALIPAY` 终态均验证 |
| `bank_transfer_aggregate` | `BANK_TRANSFER` | 专属账户、聚合收银、查询恢复和受控展示均实现 |
| `enterprise_ebank_payment` | `ENTERPRISE_EBANK` | 真实安全参数、收银台选行和 `TRADE_SUCCESS + E_BANK` 终态均验证 |
| `ebank_consult` | `EBANK_CONSULT` | 咨询结果、空列表、瞬时失败和展示信息映射均处理，咨询不作为支付结果 |
| `fund_openmq_subscription` | `BANK_FUND_CONFIRMATION` | 同一应用订阅 `alipay.trade.saas.fund.changed`，有平台回执 |
| `fund_message_routing` | `BANK_FUND_CONFIRMATION` | 订单和资金消息按 `method` 精确分流，互不进入对方状态机 |
| `fund_confirmation` | `BANK_FUND_CONFIRMATION` | 两种 CONFIRM、REJECT、状态收敛和未知结果恢复均实现 |
| `fund_idempotency_and_concurrency` | `BANK_FUND_CONFIRMATION` | 原号原参重试，CONFIRM/REJECT 串行，重复乱序消息不回退终态 |
| `account_create` | `ACCOUNT_MANAGEMENT` | 账户创建幂等、`customer_id` 和机构账户信息持久化 |
| `account_query` | `ACCOUNT_MANAGEMENT` | 两种定位方式和同客户一致性处理完成 |
| `jiangsu_bank_account_opening_info` | `JIANGSU_BANK_ACCOUNT_OPENING` | 已通过受控渠道向支付宝对接同学提供银行商户号、银行母户账号、账户名和银行联行号；只登记脱敏交接证据，不把四项资料作为 OpenAPI 字段或写入 manifest |
| `trade_close` | `TRADE_CLOSE` | 待支付关单、并发支付和结果未知后的查单补偿完成 |
| `refund` | `REFUND` | 可退校验、整单退款、金额精确计算完成；成功响应能区分 `REFUND_PROCESSING/N` 与 `REFUND_SUCCESS/Y`，不把已受理误判成失败或终态成功 |
| `refund_query` | `REFUND` | 已受理处理中和受理结果未知均能进入退款查询补偿，且不会换号创建重复退款 |
| `partial_refund_idempotency` | `PARTIAL_REFUND` | `out_request_no` 先落库，同号只能重放相同金额和原因 |
| `refund_detail_options` | `REFUND_DETAIL_QUERY` | 两个 `query_options` 选项和退款资金明细条件字段完成 |
| `bill_download` | `BILL_DOWNLOAD` | `alipay.trade.saas.billdownloadurl.query` 的类型化调用、验签、日期/类型处理、未就绪重试和短期地址安全处理完成 |
| `financial_reconciliation` | `BILL_DOWNLOAD` | 文件按类型幂等解析，单边、金额和状态差异可识别；状态差异经主动查询复核后处理 |
| `bill_download_e2e` | `BILL_DOWNLOAD` | 非生产环境完成至少一个账单日的查询、后端下载、解析和差异产出，保留脱敏运行记录 |

## 验收规则

- 所有基础必检项和由画像触发的条件项都有有效证据才为 `PASS`。
- 清单必须按当前结构填写 `language`、`client_mode`、`protocol`、`security_mode`、渠道 flow 和能力依赖，不能通过补写一个与实际场景不符的 flow 绕过校验。
- `OFFICIAL_SDK` 与 `DIRECT_GATEWAY` 是互斥路径；不能用社区 SDK 文件冒充官方 SDK，也不能用一条包含 `sign` 的请求截图证明直连协议正确。
- `DIRECT_GATEWAY` 的测试必须覆盖中文、空格、`+`、`%`、`&`、嵌套 JSON、PKCS#8/PKCS#1、错误公钥、响应篡改、缺失签名、重复 root 和编码时机。
- 退款测试必须分别覆盖成功终态、明确受理中和受理结果未知：明确受理中断言 `refund_status=REFUND_PROCESSING`、`fund_change=N` 并进入查询补偿；结果未知不得伪装成已受理。
- `CERTIFICATE` 不能降级为 `PUBLIC_KEY` 跳过序列号或证书轮换验证。
- 不适用的条件项显示 `SKIP`，不是失败，也不能用来掩盖基础能力缺失。
- `--structural-only` 只校验 JSON 结构和证据声明，不检查文件存在，不能作为验收报告。
- 平台配置只能以真实 `external` 回执或脱敏运行记录证明；代码常量不能证明签约或订阅生效。
- 非生产端到端证据必须是 `run`，且不能标记为生产环境。
- 检查器通过仍需代码评审。重点抽查验签调用时机、事务提交与 ACK 顺序、幂等唯一约束和状态机是否与证据描述一致。
