# APP 支付本地接口契约

本文是 APP 支付服务端下单接口的默认本地依据。在线文档只在本地契约或示例缺失、字段不确定、排查官方错误码、用户明确要求或官方能力变化时作为 fallback 读取。

sourceUrl:

- <https://aipay.alipay.com/docs/mobile-app-pay/app-pay-integration-guide-new.md>
- <https://aipay.alipay.com/docs/mobile-app-pay/ai-app-pay/alipay-trade-app-pay.md>
- <https://aipay.alipay.com/docs/mobile-app-pay/ai-app-pay/sync-result.md>

## 默认范围

APP 支付必须覆盖：`alipay.trade.app.pay`、交易查询、退款、退款查询、关闭交易、异步通知和服务端订单查询链路。

查询、退款、退款查询、关闭交易读取 `common-trade-contract.md`；异步通知读取 `notify-url-contract.md`。

本 Skill 默认只改商家服务端，不替用户实现 APP 客户端 SDK。HarmonyOS APP 支付代码开发仍可覆盖服务端能力；平台侧移动应用创建边界以 onboarding 应用发布模块为准。

官方目录中的 `alipay.data.dataservice.bill.downloadurl.query` 不是当前 Skill 默认交付项。用户明确要求对账时再按在线文档 fallback 处理，不能加入默认 checklist。

## 下单接口

`alipay.trade.app.pay` 用于商家服务端生成 `orderStr`，由商家 APP 客户端接入支付宝客户端 SDK 后调起支付。

公共参数：

| 字段 | 要求 |
| --- | --- |
| `method` | 固定 `alipay.trade.app.pay` |
| `notify_url` | 生产或公网联调时传入；本地生产参数验收模式可临时不传，但通知处理代码必须存在 |

业务参数：

| 字段 | 要求 |
| --- | --- |
| `out_trade_no` | 必填，商户订单号，商户侧唯一 |
| `total_amount` | 必填，单位元，精确到小数点后两位，不能为 0 |
| `subject` | 必填，订单标题 |
| `product_code` | 必填，当前默认固定 `QUICK_MSECURITY_PAY` |

## 响应与结果

- 服务端返回 `orderStr` 给 APP 客户端。
- APP 客户端同步返回的 `resultStatus=9000` 可作为支付结束通知；为简化默认集成，实际支付是否成功仍以服务端异步通知或 `alipay.trade.query` 为准。
- `resultStatus=8000` 或 `6004` 表示结果未知，必须查询商家订单或调用 `alipay.trade.query`，不能要求用户重复付款。
