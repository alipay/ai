# 未来生效订阅接入指南

未来生效订阅用于“现在完成签约、未来指定日期开始首笔真实扣款”的周期订阅场景。本文只约定公开创建、链接处理、查询和通知行为。

## 请求契约

接口：`alipay.trade.subscription.create`

| 参数 | 必选 | 说明 |
|------|------|------|
| `effective_type` | 否 | 不传或传 `IMMEDIATE_EFFECTIVE` 表示立即生效；传 `SCHEDULED_EFFECTIVE` 表示未来生效 |
| `scheduled_effective_time` | 条件必选 | `SCHEDULED_EFFECTIVE` 时必传，严格使用 `yyyy-MM-dd` |
| `deduct_type` | 否 | 未来生效仅支持支付宝托管扣款 `SUBSCRIBE_DEDUCT` |
| `pay_amount` | 否 | 未来生效禁止传入，包括 `0` |

`scheduled_effective_time` 按北京时间业务日校验，取值范围为创建日后第 3 天至一个价格周期结束日，首尾均可取。例如 1 月 15 日创建月度订阅，可选 1 月 18 日至 2 月 15 日。

未来生效还需满足：

- 使用带 `recurring` 的周期价格。
- 不传 `trial_period_days`、`trial_desc` 或 `coupon_id`。
- 不传支卡通参数。
- `effective_type=IMMEDIATE_EFFECTIVE` 时不传 `scheduled_effective_time`。
- 未知 `effective_type` 会被拒绝。

## 请求示例

```json
{
  "items": [
    {
      "price_id": "YOUR_PRICE_ID"
    }
  ],
  "customer_id": "MERCHANT_CUSTOMER_ID",
  "subscribe_title": "AI会员专业版",
  "effective_type": "SCHEDULED_EFFECTIVE",
  "scheduled_effective_time": "2026-08-31",
  "deduct_type": "SUBSCRIBE_DEDUCT"
}
```

不要在该请求中补 `pay_amount: 0`。具备零元订阅准入的普通创建可通过显式 `pay_amount=0` 选择仅签约；未来生效则由系统在创建日生成技术零元签约流程，商家不能覆盖金额，但实际调用商户仍需具备零元订阅准入。若因此被准入拦截，应确认能力，不得通过补传 `pay_amount` 绕过。

## 用户与扣款流程

1. 商家创建未来生效订阅并把响应中的链接交给用户。
2. 用户须在 `schema_effective_end` 前完成签约；创建日只完成签约，不发生真实付款。
3. 到 `scheduled_effective_time`，系统按订阅价格发起首笔真实扣款。
4. 创建日的签约结果不等于未来权益已生效。商家需保存未来生效日，到该日期并确认首笔真实扣款终态后再开通权益。

未来生效的签约与首扣分离。不要把创建响应中的 `pay_amount=0` 记为用户已支付，也不要自行在生效日重复发起首扣。

## 响应链接

- 未来生效创建日是仅签约流程，应直接使用接口实际返回的 `alipay_schema`，不要把它当成已完成支付。
- 正金额走电脑网站支付并签约时，`alipay_schema` 才是浏览器可打开的 HTTPS 链接且 `alipay_jump_schema` 不返回；该规则不应套用到零元仅签约。
- 商家应用至少需具备 APP 支付或电脑网站支付中的一种产品权限。

链接形态由商家已开通的产品能力决定。不要在商家代码中写死内部产品码或签约参数。

## 查询与通知

查询结果和 `alipay.trade.subscription.changed` 的 `subscription` 对象会返回：

```json
{
  "effective_type": "SCHEDULED_EFFECTIVE"
}
```

当前查询和通知不返回 `scheduled_effective_time`。商家需保存创建请求中的未来生效日期，并用通知或查询确认实际状态。

首笔真实扣款前，查询和通知里的 `current_period_start`、`current_period_end` 属于签约到生效日之间的过渡周期字段；其中 `current_period_end` 可能等于商家保存的未来生效日，不能当作已付费周期结束时间或权益截止时间。首扣成功后再使用最新通知或查询中的周期字段。

当 `effective_type=SCHEDULED_EFFECTIVE` 且尚未到商家保存的未来生效日时，不要仅凭创建日的签约通知或某个状态字段提前开通权益；未来生效日之后仍需确认首笔真实扣款结果。

## 生效前变更边界

本指南只承诺未来生效的创建与首扣。生效日前的升级、降级、席位扩缩容、取消或撤销取消不作为通用公开能力；遇到此类需求时，以开放平台正式接入资料和实际联调结果为准，不要自行推导过渡期状态规则。
