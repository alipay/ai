# 异步通知本地契约

本文是网站支付和 APP 支付共用的异步通知实现依据。按量付费不使用本契约。在线文档只在本地契约或示例缺失、字段不确定、排查官方错误码、用户明确要求或官方能力变化时作为 fallback 读取。

sourceUrl:

- <https://aipay.alipay.com/docs/ai-web-app-payment-qianyi/api-list/async-notify-verify.md>
- <https://aipay.alipay.com/docs/mobile-app-pay/ai-app-pay/async-notify-verify.md>

当前两份官方文档内容一致。运行时默认读取本文和当前语言 `1-通用接口/异步通知处理代码示例.md`；在线文档只在 fallback 条件下读取。

## 适用范围

| 产品 | 是否适用 | 说明 |
| --- | --- | --- |
| 网站支付 | 是 | `alipay.trade.page.pay` 下单时通过公共参数 `notify_url` 指定 |
| APP 支付 | 是 | `alipay.trade.app.pay` 下单时通过公共参数 `notify_url` 指定 |
| 按量付费 | 否 | 使用 `Payment-Proof` 验付和履约确认，不使用统一收单异步通知 |

`notify_url` 是商家服务端接收支付宝 POST 表单通知的地址，不是前端页面地址，也不是支付宝生成的 URL。

本地正式验收或本地生产参数验收时，若暂时没有公网 HTTPS 通知地址，可以不传 `notify_url`，但仍必须实现通知处理代码并用交易查询兜底。不要向 SDK 传 `undefined`、`null`、空字符串或占位 URL；没有可用地址时应直接省略该字段或不调用对应 setter。真实生产或公网联调时必须传入可公网访问的 HTTPS `notify_url`，地址不能包含多余字符或发生重定向。

## 必须实现的处理链路

1. 接收支付宝 POST 表单参数，不能按 JSON 请求体解析。
2. 收集完整参数 map，验签前不得丢字段、改字段名或改字段值。
3. 用通知中的 `app_id` 在本地选择运行时支付配置和验签上下文；这是为了选择本地支付宝公钥或 SDK 实例，不表示信任通知内容。
4. 使用当前项目已安装的支付宝 SDK 验签能力验证 `sign`；Java 官方示例为 `AlipaySignature.rsaCheckV1`。
5. 验签失败时记录脱敏异常并返回纯文本 `fail`。
6. 验签通过后，用 `out_trade_no` 查询商家本地订单，并校验 `app_id`、`out_trade_no`、`total_amount`、`seller_id` 或 `seller_email`。
7. `app_id`、`seller_id` / `seller_email` 以运行时支付配置为准，不默认从订单对象或通知参数本身取可信预期值。
8. 只有 `TRADE_SUCCESS` 或 `TRADE_FINISHED`，且不是退款、关单、分账等事件时，才认定买家付款成功；至少排除 `out_biz_no`、`gmt_refund`、`refund_fee` 等事件特征。
9. 使用持久化订单状态、`notify_id`、`out_trade_no`、`trade_no` 和事件类型做幂等处理，避免重复发货、重复记账或重复变更。内存订单、内存 Map 或进程内锁只能用于非生产 demo。
10. 业务处理成功后返回纯文本 `success`；不是 `success` 时支付宝会按策略重试。
11. 未收到通知或支付状态未知时，必须调用 `alipay.trade.query` 补偿查询。

默认至少处理参数：`notify_type`、`notify_id`、`sign_type`、`sign`、`trade_no`、`app_id`、`out_trade_no`、`trade_status`、`total_amount`、`seller_id` 或 `seller_email`。退款或其他事件可能出现 `out_biz_no`、`gmt_refund`、`refund_fee`，不能误判为付款成功。

## 状态处理

| `trade_status` | 默认处理 |
| --- | --- |
| `TRADE_SUCCESS` | 买家付款成功；同时确认不是退款、关单、分账等事件后，幂等标记本地订单已支付 |
| `TRADE_FINISHED` | 交易结束且付款成功；同时确认不是退款、关单、分账等事件后，幂等标记本地订单已支付 |
| `WAIT_BUYER_PAY` | 不认定付款成功；记录或忽略，必要时等待查询 |
| `TRADE_CLOSED` | 不认定付款成功；可记录关闭或退款完成事件 |

退款通知、关闭通知、分账通知等不是付款成功通知。通知本身验签和业务归属校验通过后，可以返回 `success` 避免重复推送，但不得把本地订单改成已支付。支付成功通知至少满足付款成功状态且不包含 `out_biz_no`；退款通知通常包含 `gmt_refund`、`refund_fee`、`out_biz_no`。

## 验收分层

- 本地正式验收 / 本地生产参数验收模式：允许暂时没有公网 HTTPS `notify_url`，但通知处理代码、验签、业务字段校验、持久化幂等和主动查询兜底必须存在；公网通知联调标记为人工待验证。没有可用通知地址时省略 `notify_url`，不要向 SDK 传 `undefined`、`null`、空字符串或占位 URL。
- 真实生产上线：必须配置公网 HTTPS `notify_url`，完成支付宝服务器可访问联调、验签、关键字段校验、幂等处理、返回 `success` 和补偿查询。

没有完成真实生产上线层时，不得表述为生产就绪或正式上线完成。

## 本地示例索引

| 语言 | 示例 |
| --- | --- |
| Java | `code-examples/java/1-通用接口/异步通知处理代码示例.md` |
| Python | `code-examples/python/1-通用接口/异步通知处理代码示例.md` |
| Node.js | `code-examples/nodejs/1-通用接口/异步通知处理代码示例.md` |
| PHP | `code-examples/php/1-通用接口/异步通知处理代码示例.md` |
| C# | `code-examples/csharp/1-通用接口/异步通知处理代码示例.md` |

Java 官方示例明确使用 `AlipaySignature.rsaCheckV1`。Node.js 示例给出 `checkNotifySignV2(params)` 的落地形态，但 Agent 落地前必须先读取目标项目 `alipay-sdk` 的 package.json 和类型定义，确认当前版本确实暴露该 API。Python、PHP、C# 示例使用项目内支付宝 SDK 验签适配器表示验签边界；适配器必须封装当前项目实际 SDK API，禁止临时手写不确定的 RSA 验签实现。
