# 非 SDK 经典网关接入

## 目录

- [适用边界](#适用边界)
- [组件契约](#组件契约)
- [请求签名](#请求签名)
- [HTTP 传输](#http-传输)
- [响应验签](#响应验签)
- [密钥与证书](#密钥与证书)
- [错误与日志](#错误与日志)
- [测试契约](#测试契约)
- [上游来源](#上游来源)

## 适用边界

仅当 [protocol-selection.md](protocol-selection.md) 已确定 `client_mode=DIRECT_GATEWAY` 且 `protocol=CLASSIC_GATEWAY_V2` 时读取本文。本文只替代 OpenAPI SDK 的请求签名、HTTP 调用和同步响应验签，不替代 [openmq-notification.md](openmq-notification.md) 的 OpenMQ 消费协议。

不要在商户工程中散落签名函数。建立一个协议适配包，由业务层通过类型化企业支付方法调用。

## 组件契约

按商户现有分层实现以下职责，名称可以服从项目约定：

| 组件 | 单一职责 |
| --- | --- |
| `Canonicalizer` | 过滤和排序参数，生成未编码待签串 |
| `Signer` | 使用应用私钥生成 RSA2 签名 |
| `ResponseVerifier` | 使用支付宝公钥或响应证书验签 |
| `ClassicGatewayClient` | 组装 V2 请求、执行 HTTP、限制响应并先验签 |
| `ResponseExtractor` | 从原始 JSON 提取待验签业务片段 |
| 企业支付 Facade | 按 `api-contract.md` 暴露类型化方法和 DTO |

协议层不决定订单幂等、重试、状态机、履约或资金对账。业务层不得绕过客户端直接发送未验签请求。

## 请求签名

固定公共参数：

| 参数 | 值或来源 |
| --- | --- |
| `app_id` | 当前商户自有应用 |
| `method` | `api-contract.md` 中的完整 API 名称 |
| `format` | `JSON` |
| `charset` | `UTF-8` |
| `sign_type` | `RSA2` |
| `timestamp` | 北京时间 `yyyy-MM-dd HH:mm:ss` |
| `version` | `1.0` |
| `biz_content` | 业务 DTO 一次序列化得到的原始 JSON 字符串 |

证书模式同时加入 `app_cert_sn` 和 `alipay_root_cert_sn`。签名严格执行：

1. 合并公共参数和 `biz_content`。
2. 排除 `sign`、空 key 和空 value；主动请求必须保留 `sign_type`。
3. 按 key 的字节序升序排列。
4. 使用未经 URL Encode 的原值拼接 `key=value&key=value`。
5. 对 UTF-8 待签串执行 SHA-256 与 RSA PKCS#1 v1.5 签名。
6. 对签名结果做标准 Base64；只在组装 HTTP 时 URL Encode。

`biz_content` 必须只序列化一次。签名使用的字符串和实际发送的字符串必须是同一份字节内容；禁止签名后重新格式化 JSON、改变字段转义或用另一个对象再次序列化。

## HTTP 传输

匹配官方经典 SDK 的发送方式：

```text
POST https://openapi.alipay.com/gateway.do?<公共参数与 sign>
Content-Type: application/x-www-form-urlencoded; charset=UTF-8

biz_content=<URL encoded JSON>
```

实施要求：

- 使用商户共享、可配置超时的 HTTP Client，并让请求接受调用方 context 或取消信号。
- 网关 URL 不接受调用方附加的未签名 query 或 fragment。
- 限制最大响应体，始终关闭响应流，显式处理非 2xx 状态。
- 网络错误、HTTP 错误、网关错误、业务 `sub_code` 和验签错误使用可区分的错误类型。
- 结果未知时回到业务层执行“先查后重试”，协议层不自动更换业务幂等号。

## 响应验签

同步 JSON 响应通常为：

```json
{
  "alipay_trade_saas_order_query_response": {"code":"10000"},
  "sign": "BASE64_SIGNATURE"
}
```

验签对象是原始 `<method>_response` JSON value；失败响应使用原始 `error_response` value。必须从原始响应字节提取，不能先反序列化成对象再序列化。字段顺序、空白和 `\/` 转义都可能影响验签。

安全顺序固定为：

```text
限制并读取原始响应
  -> 解析顶层信封并拒绝重复 root/sign key
  -> 提取原始 method_response 或 error_response value
  -> 读取 sign 和可选 alipay_cert_sn
  -> RSA2 验签
  -> 验签通过后反序列化业务 DTO
  -> 更新订单
```

缺少签名、同时存在成功与错误 root、重复业务 root、未知证书序列号或验签失败时全部失败关闭。不得为了兼容而回退到“跳过响应验签”。

## 密钥与证书

- 应用私钥只用于请求签名，支付宝公钥或支付宝公钥证书只用于响应验签。
- 支持开放平台常见的 PKCS#8 私钥；语言标准库允许时兼容 PKCS#1，并明确测试两种格式。
- 支付宝普通公钥按 PKIX/SPKI 解析；证书模式从可信 X.509 证书取得 RSA 公钥。
- 密钥内容来自密钥服务或受控配置引用，不进入代码、测试夹具、manifest 和日志。
- 证书模式按 `alipay_cert_sn` 从可信集合选证书。证书更新必须验证来源、证书链或平台正式校验要求，再原子替换可信集合。
- 未知证书序列号触发告警和受控刷新，当前响应保持失败；不得在线下载后未经验证直接信任。

## 错误与日志

日志只保留 API method、商户业务号、HTTP 状态、平台 trace、错误类别、字段名和必要摘要。禁止记录：

- 私钥、公钥或完整证书内容
- 完整待签串和签名值
- 完整 `biz_content` 或原始响应
- `cashier_url`、`download_url` 和令牌

错误信息不得回显密钥解析输入或完整响应体。连接超时和读取超时应保持可识别，供业务层决定查询补偿。

## 测试契约

`DIRECT_GATEWAY` 至少提供以下原生语言自动化测试：

| 类别 | 必测内容 |
| --- | --- |
| 规范化 | 排除 `sign` 和空值、保留 `sign_type`、稳定排序 |
| 字符编码 | 中文、空格、`+`、`%`、`&` 和嵌套 JSON |
| 编码时机 | 原值签名，Base64 签名和表单只在传输阶段 URL Encode |
| 密钥 | PKCS#8、PKCS#1、错误格式、错误公钥 |
| 原始响应 | 字段顺序、空白、转义保持不变并通过验签 |
| 失败关闭 | 篡改响应、缺失签名、重复 root、超大响应均拒绝 |
| HTTP | 超时、取消、非 2xx 和响应流关闭 |
| 证书模式 | 缺失或未知 `alipay_cert_sn` 拒绝，可信序列号通过 |

测试必须运行目标语言真实编译器和测试命令。只比较手写期望字符串、只 Mock `Signer` 或只验证请求包含 `sign` 都不足以证明接入正确。

## 上游来源

语言路由和非 SDK 参考的组织方式参考 `alipay-subscription-skill@1.6.12`（MIT，Copyright 2026 Ant Group）。本 Skill 不复制其 Go 示例；协议正确性以支付宝经典 Java SDK V2 的参数规范化、响应原文提取和证书处理行为，以及当前开放平台正式资料为准。
