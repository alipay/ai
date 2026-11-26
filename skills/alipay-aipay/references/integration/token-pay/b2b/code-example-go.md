# Go 经典网关实现参考

Go 当前没有覆盖本企业支付接入的支付宝官方 SDK。仅在画像为 `language=go`、`client_mode=DIRECT_GATEWAY`、`protocol=CLASSIC_GATEWAY_V2` 时读取本文，并先完整读取 [non-sdk-openapi-integration.md](non-sdk-openapi-integration.md)。

## 可复用资产

参考组件包括[经典网关客户端](assets/b2b-direct-gateway-go/classicgateway/client.go)、[签名和验签](assets/b2b-direct-gateway-go/classicgateway/crypto.go)及[Go 单元测试](assets/b2b-direct-gateway-go/classicgateway/client_test.go)。覆盖以下协议行为：

- RSA2 请求签名和响应验签
- PKCS#8、PKCS#1、PKIX 公钥和 X.509 证书解析
- 公钥与证书两种响应验证器
- 请求参数规范化和传输编码
- 原始响应 JSON value 提取、重复顶层 key 拒绝
- HTTP 超时、取消、状态码和响应大小处理
- 特殊字符、原始响应篡改和证书序列号测试

资产是协议参考，不是完整商户应用。先读取商户工程再移植：服从其 package、配置、依赖注入、日志、错误模型和测试约定，不创建平行的 Gin 服务、数据库层或订单模型。

## 组件编排

```text
受控配置加载应用私钥
  -> NewRSA2Signer
支付宝公钥模式
  -> NewPublicKeyVerifier
证书模式
  -> NewCertificateVerifier(可信 alipay_cert_sn -> 证书)
  -> Config.AppCertSN + Config.AlipayRootCertSN
NewClient
  -> 企业支付类型化 Facade
  -> 商户订单服务
```

每个环境创建并复用一个 Client。HTTP Client 必须设置超时；调用方法必须传入可取消的 `context.Context`。

## 业务类型化封装

不要让业务代码直接传任意 `method` 和 `map[string]any`。根据 [api-contract.md](api-contract.md) 及接入画像生成选中的请求、响应 DTO 和方法，例如：

```go
type TradeQueryRequest struct {
    OutTradeNo string `json:"out_trade_no,omitempty"`
    OrderNo    string `json:"order_no,omitempty"`
}

type TradeQueryResponse struct {
    Code        string `json:"code"`
    Msg         string `json:"msg"`
    SubCode     string `json:"sub_code,omitempty"`
    SubMsg      string `json:"sub_msg,omitempty"`
    OutTradeNo  string `json:"out_trade_no"`
    OrderNo     string `json:"order_no"`
    TradeStatus string `json:"trade_status"`
}

type TradeRefundResponse struct {
    TradeNo      string `json:"trade_no"`
    OutTradeNo   string `json:"out_trade_no"`
    OutRequestNo string `json:"out_request_no,omitempty"`
    RefundStatus string `json:"refund_status"`
    RefundFee    string `json:"refund_fee"`
    FundChange   string `json:"fund_change"`
}
```

Facade 内固定 API method，调用协议 Client，确认响应已验签后再解码。对请求 DTO 执行条件必填校验；金额使用元字符串或精确十进制，不使用 `float64`。

退款 Facade 返回后必须按 `RefundStatus` 分支：`REFUND_PROCESSING` 只保存渠道已受理和本地处理中事实，并调度 `alipay.trade.saas.refundorder.query`；`REFUND_SUCCESS` 才进入退款成功终态。不要把网关 `code=10000` 或 `FundChange=N` 当作退款成功，也不要把明确受理中当作 `REFUND_PROCESS_UNKNOWN`。

## 移植要求

1. 复制所需协议组件到商户已有支付适配包，调整 module/package 和错误接入方式。
2. 不修改规范化、签名算法、原始响应提取和失败关闭语义。
3. 把私钥、公钥、证书和序列号改为商户受控配置引用；不提交真实值。
4. 按接入画像生成类型化企业支付方法，不暴露通用 method 给业务入口。
5. OpenMQ 继续按 [openmq-notification.md](openmq-notification.md) 接入；不要生成 HTTP Form Webhook。
6. 运行资产测试、商户项目测试、`go test ./...`，按项目约定再运行 `go vet ./...` 或静态检查。

若商户 Go 版本、密码库政策、FIPS/KMS/HSM 要求与资产不同，保留组件接口并替换 Signer/Verifier 实现，不把私钥导出到普通进程内存来迁就示例。
