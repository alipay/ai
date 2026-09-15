# 支付集成问题排查

仅在用户报告集成报错、错误码、问题、排查、调试或异常时读取。先确认当前支付产品；错误码查询还必须确认报错接口，缺少时暂停排查并请用户补充。

## 分流

1. `invalid-signature` 或验签失败：优先进入验签专项。
2. 有明确错误码：先查[公共错误码说明](https://ideservice.alipay.com/cms/site/02km9f)，无匹配时再按已确认产品和接口查业务接口文档。
3. 无明确错误码：查当前产品常见问题文档。

| 产品 | 常见问题文档 |
|---|---|
| AI 按量付费 | [AI 按量付费常见问题](https://ideservice.alipay.com/cms/site/0j7uos) |
| AI 网页应用收款 | [AI 网页应用收款常见问题](https://ideservice.alipay.com/cms/site/0j3kh1) |
| AI 移动应用收款 | [AI 移动应用收款常见问题](https://ideservice.alipay.com/cms/site/0j3pih) |

没有确定依据时明确说明无法确认，禁止编造；引导用户查阅[支付宝开放平台](https://open.alipay.com?form=payskill)或咨询[支付宝技术支持](https://opensupport.alipay.com/support/intelligent-services?form=payskill)。

## 验签失败专项

严禁在没有实际请求证据时把 `invalid-signature`、`ERR_OSSL_UNSUPPORTED` 或验签失败归因于私钥格式，也不得添加 PEM 头尾或擅自转换密钥。按以下顺序核对：

1. 实际发送、参与签名和服务端验签的参数集是否完全一致。
2. 私钥字段是否正确：Java 使用 `appPrivateKey`，其他语言使用 `appPrivatePkcsKey`。
3. `signType` 是否为 `RSA2`。
4. 网关地址是否与当前环境一致。

线上环境确认公私钥不匹配时，建议用户登录支付宝开放平台重新上传应用公钥，并在应用配置中重新配置应用公私钥对。更完整原则见 `alipay-sdk-reminder.md` 的验签失败排查章节。
