# 接口说明与代码示例索引

本文件只做本地接口契约和代码示例路由。正常代码开发默认读取本地契约与当前语言示例；在线文档只作为 `sourceUrl` 和 fallback，不作为默认运行时必读材料。

本文中的 `./code-examples/...` 路径一律相对本文件所在目录 `references/integration/modules/` 解析。从 `references/integration/flow.md` 所在目录读取示例时，实际路径必须写成 `modules/code-examples/...`；例如 Node.js 按量付费示例是 `modules/code-examples/nodejs/4-按量付费/A2MPaymentDemo.js`。禁止查找不存在的 `references/integration/code-examples/...`。

## 默认读取路由

| 产品 | 必读本地契约 | 必读示例 |
| --- | --- | --- |
| 按量付费 | `interface-contract/aipay-interface-contract.md` | 当前语言 `4-按量付费/` 示例 |
| 网站支付 | `interface-contract/webpay-interface-contract.md`、`interface-contract/common-trade-contract.md`、`interface-contract/notify-url-contract.md` | 当前语言 `2-网站支付/` 和 `1-通用接口/` 示例 |
| APP 支付 | `interface-contract/apppay-interface-contract.md`、`interface-contract/common-trade-contract.md`、`interface-contract/notify-url-contract.md` | 当前语言 `3-APP支付/` 和 `1-通用接口/` 示例 |

fallback 仅在本地契约或示例缺失、字段不确定、排查官方错误码、用户明确要求或官方能力变化时触发。触发后只读取当前产品和当前接口直接相关页面，不递归抓取无关文档。

## 代码示例路径

语言目录固定为：`java`、`python`、`nodejs`、`php`、`csharp`。选择当前项目服务端语言对应目录，禁止混用不同语言。

### 按量付费

| 语言 | 示例 |
| --- | --- |
| Java | `./code-examples/java/4-按量付费/A2MPaymentDemoController.java` |
| Python | `./code-examples/python/4-按量付费/A2MPaymentDemo.py` |
| Node.js | `./code-examples/nodejs/4-按量付费/A2MPaymentDemo.js` |
| PHP | `./code-examples/php/4-按量付费/A2MPaymentDemo.php` |
| C# | `./code-examples/csharp/4-按量付费/A2MPaymentDemo.cs` |

按量付费使用 402、`Payment-Needed`、`Payment-Proof`、验付和履约确认；不读取通用收单接口或异步通知示例。示例包含 TODO、内存模拟或占位函数时，必须替换为项目真实订单持久化、本地订单匹配、金额一致性、资源防串、幂等履约和履约确认失败重试逻辑，不得原样宣称生产完成。

### 网站支付

- 专用下单示例：`./code-examples/<语言>/2-网站支付/统一收单下单并支付页面接口代码示例.md`
- 通用接口示例：读取下方“通用收单示例”

网站支付覆盖 PC 网页和手机浏览器网页/H5，底层接口固定 `alipay.trade.page.pay`。用户未明确关闭同步回跳时，还必须按 `alipay-sdk-reminder.md` 实现并验证同步回跳结果页；支付成功仍以验签通过的异步通知或交易查询为准。

### APP 支付

- 专用下单示例：`./code-examples/<语言>/3-APP支付/APP支付接口代码示例.md`
- 通用接口示例：读取下方“通用收单示例”

APP 支付默认完成商家服务端能力，返回 `orderStr` 给 APP 客户端；客户端 SDK 接入不属于本 Skill 默认服务端改造范围。客户端同步结果只作支付结束通知，不能作为付款成功依据。

### 通用收单示例

网站支付和 APP 支付必须读取当前语言目录下的通用示例：

| 接口 | 文件 |
| --- | --- |
| 交易查询 | `./code-examples/<语言>/1-通用接口/统一收单交易查询接口代码示例.md` |
| 退款 | `./code-examples/<语言>/1-通用接口/统一收单交易退款接口代码示例.md` |
| 退款查询 | `./code-examples/<语言>/1-通用接口/统一收单交易退款查询接口代码示例.md` |
| 关闭交易 | `./code-examples/<语言>/1-通用接口/统一收单交易关闭接口代码示例.md` |
| 异步通知 | `./code-examples/<语言>/1-通用接口/异步通知处理代码示例.md` |

本地未上线时，可按 `../flow.md` 的“本地生产参数验收模式”先完成本地结果确认链路验证；正式上线前仍必须补齐公网 HTTPS `notify_url`、验签、幂等、关键字段校验、`success` 回写和补偿查询。用户明确要求对账时再读取官方对账单下载文档作为 fallback；当前默认 checklist 不包含对账单下载。
