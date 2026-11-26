# 银行待认款资金确认与拒绝

## 适用范围

仅在接入画像选择 `BANK_FUND_CONFIRMATION` 时使用。商户必须订阅 `alipay.trade.saas.fund.changed`，并将资金状态机与订单状态机分开持久化。`WAIT_CLAIM` 不表示支付成功，CONFIRM 返回 `WAIT_BUYER_PAY` 也不表示认款终态。

## 本地事实与自动认款

至少保存 `fund_no`、资金状态与版本、金额、付款/收款快照、`claim_request_no`、不可变请求快照、关联订单和 `refund_fund_no`。同一 `fund_no` 的 CONFIRM 与 REJECT 必须串行决策。

自动认款前必须核对资金归属、金额和收款账户；订单模式还要用稳定规则确定目标订单并核对付款企业。付款方和收款方名称只允许：去除首尾空白、将全角圆括号转换为半角圆括号，然后精确比较。不得删除内部空格、使用简称/模糊匹配，或用金额、时间、备注和账号片段绕过名称冲突。缺少可信预期值或不一致时进入人工核验。

## `alipay.trade.saas.fund.confirm`

### CONFIRM 订单模式

请求包含 `fund_no`、`claim_request_no`，以及 `order_no` / `trade_no` 至少一个；不能传 `claim_amount`。订单必须属于同一商户、同一买方并处于可认款状态。

### CONFIRM 金额模式

请求包含 `fund_no`、`claim_request_no`、精确元字符串 `claim_amount`，不传订单标识。金额不得大于真实入金。响应中的 `auto_refund_amount` 只表示超额部分退款已受理，不是退款成功终态。

### REJECT

请求设置 `action=REJECT` 并传 `fund_no`，不传订单标识或认款金额。`fund_status=REFUND_PROCESSING` 只表示拒绝退款已受理；保存 `refund_fund_no` 并等待 `fund.changed=REFUNDED`。

## 终态、幂等与恢复

| 结果 | 商户动作 |
| --- | --- |
| `trade_status=WAIT_BUYER_PAY` | 保存认款已受理，等待订单通知并主动查单 |
| `trade_status=TRADE_SUCCESS` | 核对资金、订单和金额后进入统一订单状态服务，幂等履约 |
| `CLAIM_PROCESS_UNKNOWN`、网络异常、`SYSTEM_ERROR` | 先查已知订单事实，再以原 `claim_request_no` 和原参数有限重试 |
| `FUND_OPERATION_CONFLICT` | 等待当前资金操作收敛，不并发发起另一动作 |
| `fund_status=REFUND_PROCESSING` | 等待资金通知，不提前记退款成功 |
| `fund_status=REFUNDED` | 幂等记录拒绝退款终态，不更新无关订单 |

同一 `claim_request_no` 只能重放同一 `fund_no`、动作、订单标识和金额。重复或乱序的 `WAIT_CLAIM` 不生成新确认号，也不能回退已确认或已退款状态。

## 最低测试

- `fund.changed` 与 `order.changed` 精确分流，互不进入对方状态机。
- 订单模式、金额模式、名称不匹配和人工核验分支均有覆盖。
- CONFIRM 未知结果使用原号原参恢复；CONFIRM 与 REJECT 并发时只有一个动作取得处理权。
- `WAIT_BUYER_PAY` 不履约，`REFUND_PROCESSING` 不记退款成功；重复终态只处理一次。
