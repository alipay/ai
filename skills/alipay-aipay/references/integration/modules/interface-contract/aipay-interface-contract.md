# 按量付费本地接口契约

本文是按量付费代码开发的默认本地依据。在线文档只在本地契约或示例缺失、字段不确定、排查官方错误码、用户明确要求或官方能力变化时作为 fallback 读取。

sourceUrl:

- <https://aipay.alipay.com/docs/ai-receive/MACHINE_PAY.md>
- <https://aipay.alipay.com/docs/ai-receive/api-list/alipay-aipay-agent-payment-verify.md>
- <https://aipay.alipay.com/docs/ai-receive/api-list/alipay-aipay-agent-fulfillment-confirm.md>

## 默认范围

按量付费只实现 HTTP 402、`Payment-Needed`、`Payment-Proof`、`alipay.aipay.agent.payment.verify` 和 `alipay.aipay.agent.fulfillment.confirm`。不得混入网站支付或 APP 支付的统一收单接口、异步通知或 `notify_url`。

## 402 与账单

无有效 `Payment-Proof` 时，商家服务端返回 HTTP 402，并在 `Payment-Needed` Header 中返回 Base64URL 编码账单。响应体只用于调试，智能体支付依据是 Header。

`Payment-Needed.protocol` 必须包含：`out_trade_no`、`amount`、`currency=CNY`、`resource_id`、`pay_before`、`seller_signature`、`seller_sign_type=RSA2`、`seller_unique_id`。

`Payment-Needed.method` 必须包含：`seller_name`、`seller_id`、`seller_app_id`、`goods_name`、`seller_unique_id_key=seller_id`、`service_id`。

沙箱 `service_id` 固定为 `api_mock_service_id`；生产环境替换为服务市场真实 `serviceId`，不得向用户索要正式 `serviceId` 来完成沙箱联调。

商家账单签名字段按 key 字典序拼接：`amount`、`currency`、`goods_name`、`out_trade_no`、`pay_before`、`resource_id`、`seller_id`、`service_id`。签名只在商家本地完成，不请求支付宝服务端。

## Payment-Proof 验付

`Payment-Proof` 解码后至少读取：

| 字段 | 来源 |
| --- | --- |
| `payment_proof` | `protocol.payment_proof` |
| `trade_no` | `protocol.trade_no` |
| `client_session` | `method.client_session`，可选 |

调用 `alipay.aipay.agent.payment.verify` 的业务入参为 `trade_no`、`payment_proof` 和可选 `client_session`。

验付成功不能只看 SDK 调用成功，还必须同时校验：

- `active=true`。
- 返回 `amount` 等于本地订单金额。
- 返回 `out_trade_no` 等于本地订单号。
- 返回 `resource_id` 等于当前请求资源。
- `trade_no` 未被重复履约。
- 本地订单未过期、未取消、未完成。

任一校验失败时返回 402，让智能体重新支付；不得返回资源。

## 履约确认

资源生成后调用 `alipay.aipay.agent.fulfillment.confirm`，业务入参只有 `trade_no`。必须在履约确认成功后再把订单标记为最终完成。确认失败时允许同一 `Payment-Proof` 重试确认，避免资源已生成但平台未记录履约。

