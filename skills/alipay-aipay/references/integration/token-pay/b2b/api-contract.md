# 企业支付 OpenAPI 契约快照

## 目录

- [契约基线](#契约基线)
- [公共约定](#公共约定)
- [账户接口](#账户接口)
- [创建收款单](#创建收款单)
- [查询收款单](#查询收款单)
- [关闭收款单](#关闭收款单)
- [发起退款](#发起退款)
- [查询退款](#查询退款)
- [企业网银付款机构咨询](#企业网银付款机构咨询)
- [确认或拒绝银行资金](#确认或拒绝银行资金)
- [下载对账单](#下载对账单)
- [错误处理](#错误处理)

## 契约基线

本文件是截至 2026-09-25 的稳定契约摘要，覆盖聚合收银、企业网银和银行待认款资金。实施时如商户应用当前可见的开放平台定义不同，以平台定义为准并报告差异，不从内部实现补充对外字段。

| 方法 | 用途 |
| --- | --- |
| `alipay.trade.saas.account.create` | 创建或复用银行转账账户 |
| `alipay.trade.saas.account.modify` | 修改银行转账账户的企业主体快照 |
| `alipay.trade.saas.account.query` | 查询银行转账账户 |
| `alipay.trade.saas.order.create` | 创建收款单并取得收银台地址 |
| `alipay.trade.saas.order.query` | 查询收款单状态 |
| `alipay.trade.saas.order.close` | 关闭待支付收款单 |
| `alipay.trade.saas.order.refund` | 发起整单或部分退款 |
| `alipay.trade.saas.refundorder.query` | 查询退款结果 |
| `alipay.trade.saas.ebank.consult` | 查询企业网银可用付款机构及展示信息 |
| `alipay.trade.saas.fund.confirm` | 确认待认款资金，或拒绝并全额退款 |
| `alipay.trade.saas.billdownloadurl.query` | 查询指定账单日的对账文件下载地址 |

## 公共约定

- 使用官方支付宝 SDK、UTF-8、RSA2，并验证响应签名。
- 业务参数放入 `biz_content`，接口字段名为 snake_case；`security_params` 字符串内的 JSON Key 保留安全参数契约中的原始大小写。
- 金额使用元字符串，最多两位小数；时间格式为 `yyyy-MM-dd HH:mm:ss`。
- 成功响应位于对应 `<method>_response`，`code=10000`；业务错误读取 `sub_code` 和 `sub_msg`。
- `pay_channels` 不传时表示不限定渠道；传入多个值时使用英文逗号连接。
- 交易状态为 `WAIT_BUYER_PAY`、`TRADE_SUCCESS`、`TRADE_CLOSED`。
- 退款状态为 `REFUND_PROCESSING`、`REFUND_SUCCESS`。

公共错误：

| `sub_code` | 重试 | 处理 |
| --- | --- | --- |
| `SYSTEM_ERROR` | 条件 | 先查询结果，再用原业务号和原参数重试 |
| `INVALID_PARAMETER` | 否 | 根据 `sub_msg` 修正请求 |
| `MERCHANT_PRODUCT_NOT_SIGNED` | 否 | 完成对应产品签约后重试 |

## 账户接口

### `alipay.trade.saas.account.create`

请求：

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `out_merchant_no` | 是 | 1-128 字符；商户二级商户唯一号，也是幂等键 |
| `out_merchant_name` | 是 | 1-512 字符 |

响应：`customer_id`、`inst_account_no`、`inst_account_name` 必返，`inst_name` 按平台结果返回。相同 `out_merchant_no` 重试时名称必须与首次一致。

业务错误：`IDEMPOTENT_CONFLICT`、`ACCOUNT_CHANNEL_UNAVAILABLE`、`ACCOUNT_MASTER_NOT_FOUND`、`ACCOUNT_OPEN_FAILED`、`ACCOUNT_RESPONSE_INVALID`、`CUSTOMER_CREATE_FAILED`。

通过江苏银行开户时，银行商户号、银行母户账号、账户名和银行联行号需要通过受控渠道提供给支付宝对接同学。它们是开户前置资料，不是当前 `alipay.trade.saas.account.create` 的请求字段，不得自行加入请求模型或 `biz_content`。

### `alipay.trade.saas.account.modify`

请求：

| 字段 | 必填 | 约束与语义 |
| --- | --- | --- |
| `customer_id` | 是 | 1-64 字符；定位当前商户名下的 SaaS 客户 |
| `out_merchant_name` | 是 | 1-512 字符；目标企业名称 |
| `enterprise_registration_no` | 否 | 省略，或 1-128 字符；显式空字符串非法 |

当前 PID 和 `customer_id` 下必须恰好存在一个可用银行转账账户。接口只更新 SaaS 账户主体快照，不修改 `customer_id`、机构账户号、机构账户名称或银行开户关系。

普通商户真实变更主体时必须提供企业登记号，平台校验目标名称和登记号一致后才更新。目标名称未变化且登记号省略时幂等成功，并保留当前登记号；目标名称变化时，豁免商户省略登记号会删除原登记号，因此省略不能作为通用的“保持不变”指令。仅修改登记号时传当前名称和新登记号。

响应包含 `customer_id`、`out_merchant_name`，并在当前主体有登记号时返回 `enterprise_registration_no`。相同目标重复提交幂等成功；并发同目标可收敛成功，不同目标应由商户按 `customer_id` 串行化。

业务错误：`ACCOUNT_NOT_FOUND`、`ACCOUNT_NOT_UNIQUE`、`ENTERPRISE_INFO_MISMATCH`、`ENTERPRISE_INFO_UNAVAILABLE`。

网络异常或 `SYSTEM_ERROR` 时，使用完全相同的 `customer_id`、目标名称和登记号传值状态有限重调本接口；成功响应用于确认最终主体。当前账户查询响应不含 `out_merchant_name`，不能只依赖查询接口确认名称变更。

### `alipay.trade.saas.account.query`

请求字段 `out_merchant_no`、`customer_id` 至少一个；同时传入时必须指向同一客户。响应包含 `customer_id` 和 `account_list`，账户元素包含 `customer_id`、`inst_name`、`inst_account_no`、`inst_account_name`，并按当前主体事实返回 `enterprise_registration_no`。查询响应不返回 `out_merchant_name`。

业务错误：`ACCOUNT_NOT_FOUND`、`ACCOUNT_DATA_INVALID`。

## 创建收款单

方法：`alipay.trade.saas.order.create`

### 请求

| 字段 | 必填 | 约束与语义 |
| --- | --- | --- |
| `out_trade_no` | 是 | 1-64；仅字母、数字、下划线；创单幂等键 |
| `total_amount` | 是 | `0.01` 至 `100000000.00` |
| `subject` | 是 | 1-256 字符 |
| `goods_detail` | 否 | 1-100 个商品项 |
| `time_expire` | 否 | 绝对过期时间；与 `timeout_express` 同传时优先 |
| `timeout_express` | 否 | 如 `15m`、`2h`、`1d`；两种过期字段都不传时默认 2 天 |
| `redirect_url` | 否 | HTTP/HTTPS，1-256 字符；仅同步跳转 |
| `extend_params` | 否 | 支付扩展对象 |
| `business_params` | 否 | 商户业务扩展对象 |
| `promo_params` | 否 | 最长 512 的 JSON 对象字符串，值为字符串 |
| `query_options` | 否 | 最长 512 的 JSON 字符串数组；支付提交时透传 |
| `passback_params` | 否 | 最长 512；查询和通知中原样返回 |
| `security_params` | 否 | JSON 对象字符串；创建阶段纳入请求快照和幂等比较，支付时按正式契约映射为 `business_params.outTradeRiskInfo`。商户不得将其拆成 SDK 顶层字段或自行增加其他请求字段 |
| `buyer_info` | 条件 | 单一 `BANK_TRANSFER` 时必填 |
| `pay_channels` | 否 | 最长 64；多个值以英文逗号分隔；不传表示不限定 |

`goods_detail` 元素：`goods_id`、`goods_name`、`quantity`、`price` 必填；可选 `alipay_goods_id`、`goods_category`、`categories_tree`、`body`、`show_url`、`goods_ean_id`、`out_item_id`、`out_sku_id`。

`buyer_info` 在单一银行转账时二选一：

```json
{"buyer_id_type":"customer_id","buyer_id":"CUSTOMER_001"}
```

```json
{"out_merchant_no":"BUYER_001","out_merchant_name":"示例企业"}
```

`extend_params` 可选字段：`sys_service_provider_id`、`hb_fq_num`、`hb_fq_seller_percent`、`industry_reflux_info`、`specified_seller_name`、`card_type`、`royalty_freeze`、`trade_component_order_id`、`tc_installment_order_id`、`credit_ext_info`。

`business_params` 当前可选字段：`campus_card`。

聚合收银创单示例 `biz_content`：

```json
{
  "out_trade_no": "ORDER_202608050001",
  "total_amount": "100.00",
  "subject": "企业服务费",
  "redirect_url": "https://merchant.example.com/payment/result",
  "passback_params": "ORDER_202608050001"
}
```

### 响应

`cashier_url` 必返。把它作为不透明完整 URL 交给用户跳转。

单一银行转账同步创建成功时还可返回 `out_trade_no`、`order_no`、`trade_no`、`trade_status=WAIT_BUYER_PAY` 和 `saas_account_info`。账户信息包含 `customer_id`、`inst_name`、`inst_account_no`、`inst_account_name`。

业务错误：

- 幂等和账户：`IDEMPOTENT_CONFLICT`、`ACCOUNT_NOT_FOUND`、`ACCOUNT_NAME_MISMATCH`、`ACCOUNT_CHANNEL_UNAVAILABLE`、`ACCOUNT_MASTER_NOT_FOUND`、`ACCOUNT_OPEN_FAILED`、`ACCOUNT_RESPONSE_INVALID`、`CUSTOMER_CREATE_FAILED`。
- 银行渠道：`BANK_TRANSFER_ORDER_CREATE_FAILED`、`CHANNEL_ORDER_PROCESSING`、`CHANNEL_ORDER_RESPONSE_EMPTY`、`CHANNEL_ORDER_RESPONSE_INVALID`。

## 查询收款单

方法：`alipay.trade.saas.order.query`

请求字段 `order_no`、`out_trade_no`、`trade_no` 至少一个；同时传入时必须属于同一订单。`customer_id` 可用于校验 SaaS 客户归属。`query_options` 当前只支持不传或 JSON 字符串 `[]`。

响应字段：`order_no`、`trade_no`、`out_trade_no`、`trade_status`、`total_amount`、`receipt_amount`、`buyer_pay_amount`、`send_pay_date`、`subject`、`pay_channel`、`passback_params`。部分字段按订单状态和渠道条件返回。

业务错误：`ORDER_NOT_FOUND`。

## 关闭收款单

方法：`alipay.trade.saas.order.close`

请求字段 `order_no`、`out_trade_no`、`trade_no` 至少一个；多个定位字段必须属于同一订单。响应包含 `out_trade_no`、`trade_status=TRADE_CLOSED`、`close_time`，并按事实返回 `order_no`、`trade_no`。

业务错误：`ORDER_NOT_FOUND`、`ORDER_STATUS_ILLEGAL`、`TRADE_ALREADY_PAID`、`CHANNEL_CLOSE_FAILED`、`CHANNEL_CLOSE_PROCESS_UNKNOWN`。

## 发起退款

方法：`alipay.trade.saas.order.refund`

### 请求

| 字段 | 必填 | 约束与语义 |
| --- | --- | --- |
| `order_no` / `out_trade_no` / `trade_no` | 条件 | 至少一个；多个字段必须属于同一订单 |
| `refund_amount` | 是 | `0.01` 至 `100000000.00` |
| `refund_reason` | 否 | 1-256 字符 |
| `out_request_no` | 条件 | 1-64；部分退款必填，整单退款可省略 |
| `customer_id` | 否 | 校验 SaaS 客户归属 |
| `query_options` | 否 | JSON 字符串数组；支持 `gmt_refund_pay`、`refund_detail_item_list` |

部分退款示例：

```json
{
  "out_trade_no": "ORDER_202608050001",
  "refund_amount": "20.00",
  "refund_reason": "部分服务取消",
  "out_request_no": "REFUND_202608050001",
  "query_options": "[\"gmt_refund_pay\",\"refund_detail_item_list\"]"
}
```

### 响应

`trade_no`、`out_trade_no`、`refund_status`、`refund_fee`、`fund_change` 必返；按请求和 `query_options` 返回 `out_request_no`、`gmt_refund_pay`、`refund_detail_item_list`。商户未传整单退款请求号时，不返回系统内部幂等号。

| `refund_status` | `fund_change` | 语义与商户动作 |
| --- | --- | --- |
| `REFUND_PROCESSING` | `N` | 渠道已明确受理但尚未完成；保存处理中事实，调用 `alipay.trade.saas.refundorder.query` 查询最终结果，不重复发起新退款 |
| `REFUND_SUCCESS` | `Y` | 退款已成功并发生资金变化；按退款成功终态处理 |

网关 `code=10000` 只表示退款接口调用成功，不保证退款已经到达终态。`REFUND_PROCESSING` 是正常成功响应，不是 `REFUND_PROCESS_UNKNOWN`；后者表示服务端无法确认渠道是否已经受理，商户必须先查退款结果，再决定是否以原请求号和原参数重试。

退款明细项字段：`fund_channel`、`amount` 必返；`bank_code`、`fund_type`、`real_amount` 可选。

业务错误：`ORDER_NOT_FOUND`、`ORDER_STATUS_ILLEGAL`、`REFUND_AMOUNT_EXCEED`、`IDEMPOTENT_CONFLICT`、`REFUND_INVOKE_FAILED`、`REFUND_PROCESS_UNKNOWN`、`FUND_OPERATION_CONFLICT`。

## 查询退款

方法：`alipay.trade.saas.refundorder.query`

请求字段 `order_no`、`out_trade_no`、`trade_no` 至少一个；`out_request_no` 可选，不传时查询整单退款记录；`customer_id` 可校验归属；`query_options` 支持 `gmt_refund_pay` 和 `refund_detail_item_list`。

响应字段：`trade_no`、`out_trade_no`、`out_request_no`、`refund_status`、`refund_amount`、`refund_reason`、`total_amount`、`send_back_fee`、`gmt_refund_pay`、`refund_detail_item_list`。商户未传整单退款请求号时，不返回系统内部幂等号。

业务错误：`ORDER_NOT_FOUND`、`REFUND_NOT_FOUND`、`REFUND_PROCESS_UNKNOWN`、`FUND_OPERATION_CONFLICT`。

## 企业网银付款机构咨询

方法：`alipay.trade.saas.ebank.consult`。聚合收银默认由收银台完成咨询和选行；仅在商户需要提前提示机构可用性时直接调用。

请求使用当前契约要求的金额、买方主体和真实 `security_params`。响应的 `inst_id_list` 与 `inst_info_list` 用于本次展示，空列表表示当前条件下没有可用机构。咨询结果不能证明支付受理或成功，也不能长期固化为机构白名单。

普通聚合创单不传机构参数。用户明确使用指定企业网银兼容路径时，机构 ID 必须来自当前咨询结果；完整渠道规则见 [payment-channels.md](payment-channels.md)。

## 确认或拒绝银行资金

方法：`alipay.trade.saas.fund.confirm`。只有接入画像选择 `BANK_FUND_CONFIRMATION` 时使用，完整决策、名称核验和恢复规则见 [bank-fund-confirmation.md](bank-fund-confirmation.md)。

| 字段 | CONFIRM | REJECT | 约束 |
| --- | --- | --- | --- |
| `fund_no` | 必填 | 必填 | 来自 `fund.changed` 的待认款入金 |
| `claim_request_no` | 必填 | 可选 | CONFIRM 幂等键，最长 64 字符 |
| `action` | 可省略或 `CONFIRM` | `REJECT` | 同一资金动作必须串行 |
| `order_no` / `trade_no` | 订单模式至少一个 | 禁止 | 同传时须属于同一订单 |
| `claim_amount` | 金额模式必填 | 禁止 | 元字符串，不得大于真实入金 |

订单模式不能传 `claim_amount`；金额模式不能传订单标识。CONFIRM 的 `WAIT_BUYER_PAY` 只表示认款已受理，继续等待订单通知并查单；同步返回的 `TRADE_SUCCESS` 在核对 `fund_no`、订单号、金额和商户归属后可进入统一订单状态服务并幂等履约。REJECT 的 `REFUND_PROCESSING` 不是退款终态，保存 `refund_fund_no` 并等待资金通知的 `REFUNDED`。

代表错误包括 `FUND_FLOW_NOT_FOUND`、`FUND_FLOW_STATUS_ILLEGAL`、`FUND_ALREADY_CLAIMED`、`CLAIM_RELATION_CONFLICT`、`CLAIM_AMOUNT_INVALID`、`CLAIM_PROCESS_UNKNOWN`、`CLAIM_INVOKE_FAILED`、`IDEMPOTENT_CONFLICT` 和 `FUND_OPERATION_CONFLICT`。结果未知时查询已知订单事实并以原 `fund_no + claim_request_no` 和原参数有限重试，不能换号。

## 下载对账单

方法：`alipay.trade.saas.billdownloadurl.query`

商户通过与其他企业支付接口相同的开放平台调用方式接入；商户 PID 从应用身份上下文取得，`biz_content` 不传 PID。

### 请求

| 字段 | 必填 | 约束与语义 |
| --- | --- | --- |
| `bill_type` | 是 | `SAAS_TRADE`：企业支付交易流水；`BANK_FUND`：银行资金流水；`ALIPAY_TRADE`：平台交易账单；`ALIPAY_FUND`：平台资金账单 |
| `bill_date` | 是 | 北京时间自然日，格式 `yyyy-MM-dd`，必须早于当前日期 |

示例 `biz_content`：

```json
{
  "bill_type": "SAAS_TRADE",
  "bill_date": "2026-08-04"
}
```

### 响应

成功响应包含 `bill_type`、`bill_date` 和 `download_url`。下载地址是短期敏感凭证：立即由受控后端下载，不写入普通业务日志，不向无权限用户暴露，也不能缓存为永久文件地址。`BANK_FUND` 当前返回带票据的代理地址，底层默认有效期为 300 秒；其他类型同样按短期地址处理，不依赖固定有效期。

接口查询的是 T+1 对账文件。`bill_date` 早于今天只代表请求日期合法，不代表文件已经生成；未就绪时使用相同 `bill_type + bill_date` 延后重试。

业务错误：

| 错误码 | 商户处理 |
| --- | --- |
| `INVALID_PARAMETER` | 修正账单类型或日期，不原样重试非法请求 |
| `PERMISSION_DENIED` | 核对商户自有应用身份、PID、产品绑定与权限 |
| `BILL_FILE_NOT_READY` | 文件尚未生成，使用相同参数延后重试 |
| `BILL_FILE_NOT_FOUND` | 上游确认文件不存在，停止自动重试并发起运营排查 |
| `REMOTE_SERVICE_TIMEOUT` | 结果未取得，使用相同参数有限重试 |
| `REMOTE_ACCESS_EXCEPTION` | 上游访问异常，退避后使用相同参数有限重试 |
| `FILE_STORAGE_ACCESS_EXCEPTION` | 下载地址生成失败，保留 trace 并稍后重试 |
| `SYSTEM_ERROR` | 保留 trace，退避后使用相同参数有限重试 |

## 错误处理

不要只按 HTTP 或网关 `code` 判断重试。按以下类别统一映射：

| 类别 | 代表错误 | 动作 |
| --- | --- | --- |
| 请求不可接受 | `INVALID_PARAMETER`、`IDEMPOTENT_CONFLICT` | 不自动重试；修正业务输入或恢复首次参数 |
| 前置条件缺失 | `MERCHANT_PRODUCT_NOT_SIGNED`、账户能力错误 | 完成平台配置或核对账户后重试 |
| 业务状态冲突 | `ORDER_STATUS_ILLEGAL`、`TRADE_ALREADY_PAID`、`REFUND_AMOUNT_EXCEED` | 查询当前事实，转入对应业务处理 |
| 渠道明确拒绝 | `CHANNEL_CLOSE_FAILED`、`REFUND_INVOKE_FAILED` | 根据 `sub_msg` 处理；参数改变时换新业务请求号 |
| 结果不确定 | `SYSTEM_ERROR`、`CHANNEL_ORDER_PROCESSING`、`CHANNEL_CLOSE_PROCESS_UNKNOWN`、`REFUND_PROCESS_UNKNOWN`、`FUND_OPERATION_CONFLICT` | 先查询，再以原幂等号、原参数有限重试 |

保存网关 trace 和业务定位号用于排障，但日志必须脱敏。
