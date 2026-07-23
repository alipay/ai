# 网站支付本地接口契约

本文是网站支付专用下单接口的默认本地依据。在线文档只在本地契约或示例缺失、字段不确定、排查官方错误码、用户明确要求或官方能力变化时作为 fallback 读取。

sourceUrl:

- <https://aipay.alipay.com/docs/ai-web-app-payment-qianyi/ai-web-app-payment-integration-guide.md>
- <https://aipay.alipay.com/docs/ai-web-app-payment-qianyi/api-list/alipay-trade-page-pay.md>

## 默认范围

网站支付必须覆盖：`alipay.trade.page.pay`、交易查询、退款、退款查询、关闭交易、异步通知和默认同步回跳结果页。

查询、退款、退款查询、关闭交易读取 `common-trade-contract.md`；异步通知读取 `notify-url-contract.md`。

官方目录中的 `alipay.data.dataservice.bill.downloadurl.query` 不是当前 Skill 默认交付项。用户明确要求对账时再按在线文档 fallback 处理，不能加入默认 checklist。

## 下单接口

`alipay.trade.page.pay` 是网站支付唯一默认下单接口，电脑网页、手机浏览器网页和 H5 场景均使用该接口，不改用其他网页支付产品接口。

公共参数：

| 字段 | 要求 |
| --- | --- |
| `method` | 固定 `alipay.trade.page.pay` |
| `notify_url` | 生产或公网联调时传入；本地生产参数验收模式可临时不传，但通知处理代码必须存在 |
| `return_url` | 用户未明确关闭同步回跳时默认传入，且对应当前项目实际 GET 路由 |

业务参数：

| 字段 | 要求 |
| --- | --- |
| `out_trade_no` | 必填，商户订单号，商户侧唯一 |
| `total_amount` | 必填，单位元，精确到小数点后两位，范围 `[0.01,100000000]` |
| `subject` | 必填，订单标题 |
| `product_code` | 必填且固定 `FAST_INSTANT_TRADE_PAY` |

## 响应与结果

- 必须使用页面跳转方法：Java `pageExecute`、Python `page_execute`、PHP `pageExecute`、Node.js `pageExec`、C# `PageExecute`。
- 推荐 POST 方式，响应为 HTML form 或同等页面跳转内容，必须在浏览器渲染并提交。
- `curl` 获取到 HTML form 只能证明接口有响应，不能替代浏览器付款入口和沙箱付款体验。
- `return_url` 或前台页面只作支付结束通知，不能作为付款成功依据；付款成功以验签通过的异步通知或交易查询为准。
