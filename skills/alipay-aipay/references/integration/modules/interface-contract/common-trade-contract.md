# 统一收单通用本地契约

本文适用于网站支付和 APP 支付。按量付费不使用统一收单通用接口。

sourceUrl:

- <https://aipay.alipay.com/docs/ai-web-app-payment-qianyi/api-list/alipay-trade-query.md>
- <https://aipay.alipay.com/docs/ai-web-app-payment-qianyi/api-list/alipay-trade-refund.md>
- <https://aipay.alipay.com/docs/ai-web-app-payment-qianyi/api-list/alipay-trade-fastpay-refund-query.md>
- <https://aipay.alipay.com/docs/ai-web-app-payment-qianyi/api-list/alipay-trade-close.md>
- <https://aipay.alipay.com/docs/mobile-app-pay/ai-app-pay/alipay-trade-query.md>
- <https://aipay.alipay.com/docs/mobile-app-pay/ai-app-pay/alipay-trade-refund.md>
- <https://aipay.alipay.com/docs/mobile-app-pay/ai-app-pay/alipay-trade-fastpay-refund-query.md>
- <https://aipay.alipay.com/docs/mobile-app-pay/ai-app-pay/alipay-trade-close.md>

网页应用付款和移动应用收款的查询、退款、退款查询、关闭文档当前内容一致，本 Skill 本地维护一份通用契约。

## 交易查询

接口：`alipay.trade.query`

`out_trade_no` 和 `trade_no` 二选一；同时存在时优先 `trade_no`。常见触发时机：未收到异步通知、支付接口返回系统错误或未知状态、用户可能已支付但本地订单状态未知、关闭或重新下单前确认上一笔订单结果。

支付成功只认 `TRADE_SUCCESS` 或 `TRADE_FINISHED`。`WAIT_BUYER_PAY` 不得判定成功；重新下单前应先关闭未支付订单。

## 退款

接口：`alipay.trade.refund`

`refund_amount` 必填；`out_trade_no` 和 `trade_no` 二选一。部分退款或异常重试必须保持同一 `out_request_no`，防止重复退款。接口返回 `code=10000` 只代表退款请求受理成功；只有 `fund_change=Y` 才通常表示发生退款资金变化，`fund_change=N` 或缺失时必须通过退款查询确认。

## 退款查询

接口：`alipay.trade.fastpay.refund.query`

`out_request_no` 必填；`out_trade_no` 和 `trade_no` 二选一。退款查询发起时间不能离退款请求太短，建议至少间隔 10 秒。只有 `refund_status=REFUND_SUCCESS` 表示退款成功。

## 关闭交易

接口：`alipay.trade.close`

用于关闭未付款交易。`out_trade_no` 和 `trade_no` 二选一；两者同时存在时优先 `trade_no`。关闭成功后该交易不可继续支付。不得主动发起真实生产关单，除非用户明确要求并确认目标交易。
