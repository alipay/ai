# 技术栈发现与协议选择

## 技术栈发现

先定位实际发起企业支付 OpenAPI 调用的部署单元，再判断语言。不得按仓库名、顶层文件或前端语言猜测后端实现。

按以下优先级取证：

1. 用户明确指定的目标服务和语言。
2. 目标服务的构建清单、依赖锁和源码，例如 Go 的 `go.mod`、`go.work`、`*.go`，Java 的 `pom.xml`、`build.gradle`、`*.java`。
3. 现有支付客户端、HTTP 客户端、配置装载方式和测试命令。
4. 容器入口、CI 构建命令和部署描述。

多语言单仓中输出候选服务及依据，只选择持有商户订单事实并负责后端 OpenAPI 调用的服务。若仍有多个同等候选或只有接口文档，先询问用户，禁止自行选择语言。

记录以下非敏感发现结果：

```json
{
  "language": "go",
  "client_mode": "DIRECT_GATEWAY",
  "protocol": "CLASSIC_GATEWAY_V2",
  "security_mode": "PUBLIC_KEY"
}
```

`language` 使用小写技术栈名称。识别依据写入实施结果，不把真实密钥、证书内容或令牌写入 manifest。

## 客户端模式

| 条件 | `client_mode` | 实施方式 |
| --- | --- | --- |
| 目标语言存在覆盖当前接口和安全模式的支付宝官方 SDK | `OFFICIAL_SDK` | 使用 SDK 完成签名、HTTP 和响应验签 |
| 目标语言没有官方 SDK，或 SDK 明确不覆盖当前接口 | `DIRECT_GATEWAY` | 按非 SDK 协议组件生成原生代码和测试 |

“社区 SDK”“代码能发出 HTTP 请求”都不能证明官方 SDK 可用。记录 SDK 的官方来源、版本和目标接口覆盖依据。没有依据时按不可用处理，不伪装成 `OFFICIAL_SDK`。

Go 当前进入 `DIRECT_GATEWAY`。其他无 SDK 语言复用 [non-sdk-openapi-integration.md](non-sdk-openapi-integration.md) 的协议契约，并新增独立语言适配参考；不得把 Go 语法机械翻译后直接交付。

## 协议锁定

当前 [api-contract.md](api-contract.md) 定义的是经典开放平台网关协议：

- 网关：`https://openapi.alipay.com/gateway.do`
- API 标识：`method=alipay.trade.saas.*`
- 公共参数与 `biz_content` 参与排序签名
- 成功业务响应位于 `<method>_response`

因此当前企业支付只允许：

```text
protocol = CLASSIC_GATEWAY_V2
```

开放平台 V3 REST 文档使用 HTTP path、`authorization: ALIPAY-SHA256withRSA` 和请求头响应签名。V3 待签串不能用于 `gateway.do`，V2 参数排序签名也不能用于 V3 path。除非开放平台正式给出企业支付接口的 V3 path、请求 schema 和响应 schema，并同步更新 `api-contract.md` 与 manifest schema，否则拒绝生成 `REST_V3` 调用代码。

## 安全模式

| 平台配置 | `security_mode` | 要求 |
| --- | --- | --- |
| 应用公钥方式 | `PUBLIC_KEY` | 应用私钥签名，支付宝公钥验签 |
| 证书方式 | `CERTIFICATE` | 请求携带应用证书和支付宝根证书序列号；按响应 `alipay_cert_sn` 选择可信支付宝证书验签 |

不能因目标语言缺少官方 SDK 而把证书模式降级成公钥模式。证书序列号、可信证书集合和轮换流程必须来自开放平台配置；未知 `alipay_cert_sn` 必须失败关闭并触发受控证书刷新，不能临时跳过验签。

## 选择结果

进入编码前输出：目标服务路径、语言识别依据、`client_mode`、`protocol`、`security_mode`、构建命令和测试命令。任一项无法确认时列出缺口；协议或安全模式未确认时不生成可上线实现。
