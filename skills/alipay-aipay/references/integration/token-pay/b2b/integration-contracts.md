# 企业支付接入关键契约

企业支付技术问答、代码生成、排障或实施时，先核对当前操作对应的约束，再按入口路由读取字段、协议或验收文档。

- 当前 `alipay.trade.saas.*` 锁定经典 `https://openapi.alipay.com/gateway.do` V2 协议；未取得正式 V3 path 和 schema 前不得生成 REST V3 调用或混用两套签名规则。
- 业务字段使用 snake_case，金额使用元字符串且最多两位小数；不得使用订阅接口的分整数模型。B2B `customer_id` 属于 SaaS 账户上下文，不得复用或解释为订阅客户 ID。
- `client_mode=OFFICIAL_SDK` 时由官方 SDK 完成签名、HTTP 和响应验签；`client_mode=DIRECT_GATEWAY` 时完整遵循 [non-sdk-openapi-integration.md](../b2b/non-sdk-openapi-integration.md)，Go 优先移植 `references/integration/token-pay/b2b/assets/b2b-direct-gateway-go/classicgateway`。
- `DIRECT_GATEWAY` 必须对原始 `<method>_response` 或 `error_response` JSON 片段验签，禁止反序列化后重组 JSON；缺失签名、重复 root、未知证书序列号或验签失败时不得处理业务字段。
- `out_trade_no` 在首次调用前生成并持久化；重试复用相同号码和完全相同的业务参数。`cashier_url` 作为不透明完整 URL 原样跳转，不解析、不重组、不调用收银台内部 HTTP。
- `redirect_url` 和页面展示不能确认支付成功。支付终态来自 `alipay.trade.saas.order.changed`、`alipay.trade.saas.order.query`；选择资金认款时，`alipay.trade.saas.fund.confirm` 同步返回并核验通过的 `TRADE_SUCCESS` 也可进入同一订单状态服务触发幂等履约。消息缺失、乱序或冲突时主动查询。
- 默认使用聚合收银台，不在创单时指定银行或企业网银机构。企业网银提前提示机构时才调用 `ebank.consult`；指定渠道属于兼容路径，读取 [bank-transfer-direct.md](bank-transfer-direct.md)。
- OpenMQ 接收入口先精确匹配信封 `method` 再解析业务内容。订单消息按 `order_no + trade_status` 幂等；选择资金确认时，资金消息按 `fund_no + fund_status` 幂等，二者进入不同状态机。
- `WAIT_CLAIM` 只建立待认款资金事实；CONFIRM 返回 `WAIT_BUYER_PAY` 仍需等待订单 `TRADE_SUCCESS`。REJECT 返回 `REFUND_PROCESSING` 后等待 `fund.changed=REFUNDED`，不得提前履约或记退款成功。
- 退款同步成功中的 `REFUND_PROCESSING` / `fund_change=N` 表示渠道已明确受理但尚未终态，应保存处理中事实并查询退款结果；`SYSTEM_ERROR`、网络异常或 `REFUND_PROCESS_UNKNOWN` 表示是否受理未知，先查询再决定是否按原号原参重试。两者不得混为一类。
- 账单下载地址和 `cashier_url` 都是敏感短期凭证，不写普通日志、不作为永久地址持久化、不向无权限终端透传。
- 修改商户工程时运行真实语言构建和测试、按当前结构生成 `enterprise-payment-integration.json`，并使用 `python3 "<SKILL_DIR>/references/integration/token-pay/b2b/scripts/validate_b2b_integration_manifest.py"` 验证证据。禁止由 Agent 发起生产真实交易。

## 实施结果

- 企业支付实施类回答还要列出目标服务、语言依据、`client_mode`、`protocol`、`security_mode`、实际构建测试结果、检查器摘要和仍需商户完成的平台配置；没有证据时不得声称接入完成。
