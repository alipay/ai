# 商户非托管扣款的存量接口参考

仅在商户明确点名 `MERCHANT_DEDUCT` 或 `alipay.trade.subscription.pay`、需要识别已有接入时查阅。普通订阅使用支付宝托管扣款。以下是旧订阅包的静态契约和占位示例，供核对已有实现。点名本身不证明商户拥有权限，不据此推荐开通、对外展开整套调用实现或执行生产扣款。商户实际范围以对应权限和正式接入资料为准。

## 创建时确定扣款模式

`deduct_type` 在创建订阅时确定，生命周期内保持不变。试用期不支持非托管模式。旧包的创建示例如下：

```json
{
  "customer_id": "MERCHANT_CUSTOMER_ID",
  "items": [{"price_id": "MERCHANT_PRICE_ID"}],
  "deduct_type": "MERCHANT_DEDUCT",
  "extend_params": "{\"zkt_account_id\":\"MERCHANT_ACCOUNT_ID\",\"zkt_amount\":200}",
  "subscribe_title": "示例订阅"
}
```

创建中的 `extend_params` 是可选 JSON 字符串。使用支卡通时，同时提供账户 `zkt_account_id` 和金额 `zkt_amount`（单位分，正数，最多两位小数）。两项也可以同时省略。创建时这组参数与 `coupon_id` 互斥；订阅修改、升级或席位扩容不接收支卡通参数。

## 预通知与扣款窗口

验签 `alipay.trade.subscription.pay.notify` 后，核对 `notify_type=subscription_deduct_prenotify`、订阅归属及通知中给出的起止时间。解出业务字段的示例：

```json
{
  "notify_type": "subscription_deduct_prenotify",
  "subscription_id": "MERCHANT_SUBSCRIPTION_ID",
  "effective_time_start": "2026-05-22 10:00:00",
  "effective_time_end": "2026-05-22 12:00:00"
}
```

旧契约中的 `effective_time_start` 和 `effective_time_end` 已按夜间禁扣时段（22:00 至次日 07:00）校准，并截断至当前订阅周期结束。排查时使用这次通知返回的区间，无需自行按时钟推算。预通知信封里的 `bizNo` 对应该订阅 ID，可与业务体的 `subscription_id` 对照。`merchantPeriodPay` 是旧数据模型表示商户周期扣款的业务动作枚举。这两项均不填入下表的扣款请求。

通过订阅 ID 关联该期通知和支付单。商户已有接入须同时满足订阅属于调用商户、模式为非托管、状态为 `ACTIVE`、未设置周期末取消，并且存在预通知后可扣款的支付单。按通知返回的窗口判断有效时间；窗口外不重试。重复投递对应同一期、同一笔业务时复用原外部单号，完成幂等处理后应答 `success`。预通知只给出可扣款时间，后续状态以实际支付结果、订阅变更通知和查询为依据。

## 扣款接口字段

接口 `alipay.trade.subscription.pay` 使用以下业务参数：

| 参数 | 要求 | 含义 |
|---|---|---|
| `subscription_id` | 必填，字符串 | 调用商户名下的订阅 ID |
| `out_trade_no` | 必填，字符串 | 商户外部单号，作为幂等键。同一笔重试沿用原号。支卡通金额变化需创建新单号 |
| `pay_amount` | 必填，字符串 | 扣款总金额，单位分，上限为本期支付单应付金额 |
| `extend_params` | 可选，JSON 字符串 | 支卡通账户与金额；支卡通金额不能超过本期支付单金额 |
| `customer_id` | 可选，字符串 | 客户 ID |
| `expire_time` | 可选，字符串 | 支付单有效期，以分钟 `m` 或小时 `h` 表示，范围 5 分钟到 2 小时。省略时取商户配置，未配置时旧契约默认 10 分钟 |

以下是业务请求和同步响应的占位示例：

```json
{
  "subscription_id": "MERCHANT_SUBSCRIPTION_ID",
  "out_trade_no": "MERCHANT_ORDER_ID",
  "pay_amount": "9900",
  "extend_params": "{\"zkt_account_id\":\"MERCHANT_ACCOUNT_ID\",\"zkt_amount\":200}",
  "expire_time": "10m"
}
```

```json
{
  "alipay_trade_subscription_pay_response": {
    "code": "10000",
    "msg": "Success",
    "subscription_id": "MERCHANT_SUBSCRIPTION_ID",
    "out_trade_no": "MERCHANT_ORDER_ID",
    "order_no": "SUBSCRIPTION_PAYMENT_ORDER_ID",
    "trade_no": "ALIPAY_TRADE_ID",
    "status": "PAID"
  }
}
```

返回的 `out_trade_no` 对应原商户单号，`order_no` 是订阅支付单号，`trade_no` 仅在支付成功时返回。支付单状态有 `PENDING_PAY`、`PAID`、`COMPLETED` 和 `CLOSED`。用同步结果记录该支付单，再结合 `alipay.trade.subscription.changed` 处理周期和权益变化。

旧契约列出的错误包括：`INVALID_PARAMETER` 对应必填字段、金额或有效期错误；`SUBSCRIPTION_NOT_EXIST` 对应订阅不存在；`REQUEST_PARAM_ILLEGAL` 可涉及模式、订阅状态、预约取消或当期支付单；`PERMISSION_DENIED` 可涉及订阅归属。排查时按实际回执的 `sub_code`、`sub_msg` 和订单状态定位。
