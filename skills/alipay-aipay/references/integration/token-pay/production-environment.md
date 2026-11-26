# 生产环境与凭据配置

商户自研使用自己的应用与凭据。仅当用户已明确采用支持的服务商代开发时，第三方应用的生产凭据与每位商户的授权令牌分别保管，不跨商家、跨应用或跨环境复用。该页仅供配置参考及核对已有证据。

本文档供商家配置生产工程、复核已有上线证据。本 Skill 不向生产网关运行验证；要执行联调用[独立订阅沙箱](sandbox/sandbox-integration.md)或本地模拟。

生产网关：

```text
https://openapi.alipay.com/gateway.do
```

Skill 不保存或分发任何真实密钥、证书、授权令牌和账号。下文中的 `YOUR_*` 均表示商户从自己的生产应用配置中取得并在本地安全注入的值。

## 配置原则

- 商家自研使用商家自己的生产应用凭据。
- 应用私钥由密钥持有方自行生成并保管；支付宝公钥或证书从对应生产应用的开放平台配置中取得。
- 私钥、证书和授权令牌只保存在服务端密钥管理系统中，不写入代码、前端、日志、工单或公开文档。
- 应用 ID、应用私钥、支付宝公钥或证书必须属于同一生产应用配置，不能跨应用混用。

## 生产配置项

| 配置 | 值或来源 |
|---|---|
| 网关 | `https://openapi.alipay.com/gateway.do` |
| `YOUR_APP_ID` | 商家应用的生产 APPID |
| `YOUR_APP_PRIVATE_KEY` | 与该生产应用匹配、由密钥持有方自行保管的应用私钥 |
| `YOUR_ALIPAY_PUBLIC_KEY` | 对应生产应用配置中用于验签的支付宝公钥 |

## Properties 示例

```properties
alipay.appId=YOUR_APP_ID
alipay.privateKey=YOUR_APP_PRIVATE_KEY
alipay.alipayPublicKey=YOUR_ALIPAY_PUBLIC_KEY
alipay.serverUrl=https://openapi.alipay.com/gateway.do
alipay.signType=RSA2
alipay.format=json
alipay.charset=UTF-8
```

## Java SDK 示例

```java
AlipayConfig config = new AlipayConfig();
config.setServerUrl("https://openapi.alipay.com/gateway.do");
config.setAppId("YOUR_APP_ID");
config.setPrivateKey("YOUR_APP_PRIVATE_KEY");
config.setAlipayPublicKey("YOUR_ALIPAY_PUBLIC_KEY");
config.setSignType("RSA2");
config.setCharset("UTF-8");
config.setFormat("json");

AlipayClient alipayClient = new DefaultAlipayClient(config);
```

## Spring Boot 示例

```yaml
alipay:
  appId: YOUR_APP_ID
  privateKey: YOUR_APP_PRIVATE_KEY
  alipayPublicKey: YOUR_ALIPAY_PUBLIC_KEY
  serverUrl: https://openapi.alipay.com/gateway.do
  signType: RSA2
  format: json
  charset: UTF-8
```

建议通过环境变量或密钥管理服务注入 `YOUR_*` 值，不要将真实值提交到版本库。订阅裸退款 `alipay.trade.refund` 使用[办理指引的证书配置](../../onboarding/token-pay/guidance.md#21-接口加签方式必填)。其他资金接口按各自契约和生产应用配置选择加签方式。

## 商家生产验收：配置与证据

1. 确认生产应用已上线，并已开通订阅所需产品与接口权限。
2. 从商家的配置和脱敏记录核对 APPID、证书或密钥引用及网关是否属于同一生产应用。
3. 商家持有正式应用和匹配的密钥、完成权限及通知配置后，可直接做生产验收。验证周期续费、取消等场景时优先使用明确打标的测试客户，依[测试客户工作台](test-advance.md)核对绑定账号与测试订阅。商家按其流程执行，留下可关联的配置、请求和结果回执；缺少的证据标为待验。
4. 支付场景按正式业务规则控制金额、账号和退款安排。生产调用可能产生真实交易、扣款和通知，必须先完成内部审批与风险确认。
5. 按商家实际上线范围核对涉及场景的已有证据：首次订阅、续费、变更、取消、退款、通知验签、幂等和主动查询补偿。

## 异步通知配置

商家应在开放平台为生产应用配置公网可访问的 HTTPS 通知地址，并订阅所需消息。

```text
https://your-domain.example/api/alipay/notify
```

通知处理应完成验签、幂等和可靠落库，成功受理后按对应消息规范返回响应。不要在通知日志中记录私钥、授权令牌或完整敏感报文。

## 验收检查

- 商家提供的生产验收记录应对应 `https://openapi.alipay.com/gateway.do`，不以沙箱结果代替生产证据。
- 应用 ID、私钥、公钥或证书属于同一生产应用并相互匹配。
- 所有 `YOUR_*` 占位符均通过服务端密钥管理系统注入，版本库中没有真实凭据。
- 通知地址可达，验签、幂等、重试和主动查询补偿已验证。
