# 企业认证接口契约

本页用于请求生成、参数与结果解释；开通见 [integration.md](integration.md)，通知及重试见 [lifecycle.md](lifecycle.md)。

## 接口选择

| 操作 | 企业四要素与法人扫脸 | 对公账户打款认证 |
| --- | --- | --- |
| 创建链接 | `alipay.trade.saas.enterprisecertify.create` | `alipay.trade.saas.bankverify.create` |
| 查询结果 | `alipay.trade.saas.enterprisecertify.query` | `alipay.trade.saas.bankverify.query` |
| OpenMQ 终态消息 | `alipay.trade.saas.enterprisecertify.changed` | `alipay.trade.saas.bankverify.changed` |
| 平台订单号 | `certify_order_no` | `bank_verify_order_no` |
| 消息主体 | `enterprise_certify_detail_info` | `bank_verify_detail_info` |

OpenAPI 版本为 `1.0`，生产网关为 `https://openapi.alipay.com/gateway.do`。创建、查询使用服务端 SDK；`changed` 是消息标识，不能当作主动调用方法。请求的 `app_id`、签名、`app_auth_token` 等是网关公共参数，以下示例仅为 `biz_content`。

## 创建链接

两项能力的创建业务字段一致，但调用不同方法：

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `out_request_no` | 是 | 长度 1–64，只允许字母、数字、下划线和短横线；同调用身份下的订单幂等号 |
| `out_return_url` | 否 | 绝对 HTTPS 地址，最长 512 字符，不允许 URL 中包含用户名或密码；用于认证完成后导航 |

企业认证创建示例：

```json
{
  "out_request_no": "MERCHANT_ENTERPRISE_REQUEST_NO",
  "out_return_url": "https://merchant.example.com/enterprise/certify/result"
}
```

打款认证创建示例：

```json
{
  "out_request_no": "MERCHANT_BANK_VERIFY_REQUEST_NO",
  "out_return_url": "https://merchant.example.com/enterprise/bank/result"
}
```

替换示例域名为商家实际控制的地址；不需要回跳时省略 `out_return_url`。创建业务参数不包含企业名称、信用代码、法人证件、银行卡号或到账金额，不自造 `merchant_pid`、`notify_url`。

创建成功返回对应平台订单号、完整 `page_url` 和 `expire_time`。公共响应 `code=10000` 表示链接创建成功，**不表示认证成功**。`expire_time` 为北京时间，格式 `yyyy-MM-dd HH:mm:ss.SSS`；当前页面链接有效期为一天，实际使用以本次返回值为准，不自行计算或延长。

`out_return_url` 不参与订单幂等。同号重复创建返回同一订单的新签发链接；本次要回跳就显式携带本次回跳地址，不依赖上次请求。当前规则为上述 HTTPS 地址校验，不默认增加客户级回跳白名单配置步骤；若平台另有实际生效的应用配置要求，再按其要求处理。

## 查询结果

两项查询均仅传创建时的 `out_request_no`，不使用平台订单号替代此业务字段：

```json
{"out_request_no":"MERCHANT_ENTERPRISE_REQUEST_NO"}
```

```json
{"out_request_no":"MERCHANT_BANK_VERIFY_REQUEST_NO"}
```

查询使用与创建相同的应用和商户调用身份。返回公共响应中的业务字段，不套用发票的 `invoice_detail_info` 外层。订单不存在和不属于当前身份都按 `ORDER_NOT_FOUND` 处理。

| 字段 | 企业认证查询 | 打款认证查询 |
| --- | --- | --- |
| 请求与平台订单 | `out_request_no`、`certify_order_no` | `out_request_no`、`bank_verify_order_no` |
| 状态 | `status`、`status_desc` | `status`、`status_desc` |
| 企业/账户 | `enterprise_name`、`credit_code` | `account_name`、完整 `bank_card_no`、`root_bank_name`、`branch_bank_code`、`branch_bank_name` |
| 法人 | `legal_representative_name`、`legal_representative_id_no_postfix`（证件尾号） | 无法人信息字段 |
| 终态时间 | `certify_end_time` | `verify_end_time` |
| 金额验证期限 | 无 | `match_expire_time`，仅非终态且已有期限时返回 |

资料尚未提交或结果尚未取得时，相应字段可以为空。时间按北京时间输出，格式为 `yyyy-MM-dd HH:mm:ss.SSS`。打款查询不返回实际打款金额、可验证次数或内部渠道错误；企业查询不返回页面凭证、完整证件号码或扫脸图片。创建链接的 `expire_time` 与金额验证的 `match_expire_time` 是两种不同期限，续签链接不会自动延长金额验证期限。

当前查询读取平台已记录的认证结果，不能把反复调用对客查询描述为强制重启认证、重新打款或直接触发渠道补偿。返回处理中时按生命周期规则处理。

## 错误处理

| 业务错误 | 处理方式 |
| --- | --- |
| `INVALID_PARAMETER` | 检查请求号字符/长度、HTTPS 回跳地址等；确定性错误修正前不高频重试 |
| `CONFIG_UNAVAILABLE` | 核对所选认证产品签约、应用绑定和环境；支付权限不等于认证权限 |
| `ORDER_NOT_FOUND` | 核对创建时的应用、商户授权身份及请求号；不要立刻换号重复创建 |
| `SYSTEM_ERROR` | 原请求号先查单，确需重试创建时仍用原号 |

网关签名、权限、令牌失效和 IP 白名单错误按当前平台公共契约处理，不透传内部异常为对客结论。
