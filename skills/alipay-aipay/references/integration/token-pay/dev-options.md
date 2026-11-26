# 周期订阅的开发方式与 SDK

| 商家的目标 | 对应交付 |
| --- | --- |
| 在现有项目接入订阅 | 沿用工程的语言、框架、通知入口与持久化方式。按[周期订阅开发流程](flow.md)从尚未验证的环节继续。 |
| 快速验证 API，或明确要求简易版 Demo | 生成纯后端示例，提供创建及查询订阅的入口、异步通知处理和运行说明。只问某个接口时给该接口示例。 |
| 需要演示完整购买流程 | 按选定的前后端生成商品或套餐展示、发起购买、查询与取消订阅的示例。服务端保存订阅状态，依据验签通知及查询更新权益，前端展示实际结果。 |
| 希望托管套餐选择与收银页面 | 看[低代码接入](low-code-integration.md)与[价格表下单](price-table-order.md)。 |

**语言和 SDK。** Java 或 Spring Boot 可直接使用[Java 示例](code-example-java.md)，Go 可使用[Go 示例](code-example-go.md)。Python、Node.js、PHP 和 C# 优先按[官方通用服务端 SDK](https://opendocs.alipay.com/common/02n6z6.md)核对该语言的安装方式、版本和调用模型。明确采用自行签名的网关调用时看[非 SDK 接入](non-sdk-integration.md)。

沙箱凭据统一由[公共模块](../sandbox/sandbox-setup-guide.md)保存到项目根 `.alipay-sandbox.json`；各语言仅调整读取来源，沿用已有 SDK/签名使用方式，不另存一套密钥。

新建 Demo 时，只补问影响交付的语言、框架或界面要求。可用本地模拟验证代码，或按[沙箱交付](sandbox/sandbox-delivery.md)做独立订阅沙箱联调；交付时注明实际构建、运行和验证的环节。
