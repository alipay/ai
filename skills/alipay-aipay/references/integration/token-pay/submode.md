# Submode 订阅子模式接入指南

> **受限开放**：Submode 只对获得定向准入的商户开放。仅当商户明确提出要使用
> `submode`、订阅子模式、`alipay.trade.subscription.submode.create` 或
> `alipay.trade.subscription.submode.modify` 时，才可引用本文回答。
>
> 未明确点名时，不主动介绍、比较、推荐、暗示或追问 Submode，不把它列入普通订阅方案，
> 也不因用户希望动态传商品价格而推断其应使用 Submode。

## 目录

1. [模式定位与准入](#模式定位与准入)
2. [与普通订阅的区别](#与普通订阅的区别)
3. [接口与生命周期](#接口与生命周期)
4. [创建订阅](#创建订阅)
5. [修改订阅](#修改订阅)
6. [商品价格快照](#商品价格快照)
7. [响应、通知与终态](#响应通知与终态)
8. [Java SDK 接入](#java-sdk-接入)
9. [接入检查清单](#接入检查清单)

## 模式定位与准入

Submode 是周期订阅的受限子模式。商户无需先调用商品和价格创建接口生成 `product_id`、
`price_id`，而是在创建订阅、升级或降级时，通过 `items.price_data` 提交本次订阅使用的完整
商品和周期价格快照。

回答明确使用 Submode 的商户时，先说明：

- 该能力只对定向商户开放，不能仅凭接口参数自行开通。
- 开始开发前需通过支付宝对接人员确认商户和调用应用已获得 Submode 准入及相应产品权限。
- 未获得准入时，继续使用普通订阅的商品创建、价格创建和 `price_id` 链路，不建议用字段变形绕过。
- 第三方应用代调用时，按正式授权关系传公共参数 `app_auth_token`；Submode 本身不等于服务商模式。

## 与普通订阅的区别

| 对比项 | 普通订阅 | Submode |
|---|---|---|
| 创建/修改接口 | `alipay.trade.subscription.create` / `modify` | `alipay.trade.subscription.submode.create` / `modify` |
| 商品价格准备 | 先创建商品和循环价格 | 请求中直接提交完整商品价格快照 |
| 订阅项价格字段 | `items.price_id` | `items.price_data` |
| `price_id` | 创建、升级、降级使用 | 不支持传入 |
| 商品数量 | 个体或已开放的席位模式 | 不传或传 `1`，按 `1` 处理 |
| 扩缩容类型 | 可使用 `INCREASE_QUANTITY` / `DECREASE_QUANTITY` | 不支持；容量变化用 `UPGRADE` / `DOWNGRADE` 提交新的完整快照 |
| 未来生效 | 普通模式按专项规则支持 | 不支持 |
| 身份专享价 | 以对应能力准入为准 | 当前不支持 |

Submode 改变的是商品价格的提交方式，不改变订阅的签约、支付、周期扣款、状态确认、通知验签和
幂等原则。默认仍使用支付宝托管扣款 `SUBSCRIBE_DEDUCT`，除非商户另有明确且已开放的模式。

## 接口与生命周期

| 操作 | 接口 | 说明 |
|---|---|---|
| 创建 | `alipay.trade.subscription.submode.create` | 上传一个完整 `price_data` |
| 升级、降级、取消、撤销取消 | `alipay.trade.subscription.submode.modify` | 升降级上传新快照；取消类操作不上传目标快照 |
| 查询 | `alipay.trade.subscription.query` | 使用通用订阅查询接口确认状态和当前 `item_id` |
| 通知 | `alipay.trade.subscription.changed` | 使用通用订阅变更通知确认终态 |

创建和修改请求仍使用支付宝开放平台公共参数：公共参数位于网关请求，业务字段放在
`biz_content`。第三方应用代调用时，`app_auth_token` 是公共参数，不放进 `biz_content`。

## 创建订阅

调用 `alipay.trade.subscription.submode.create`。

### 最小请求

```json
{
  "customer_id": "CUSTOMER_ID",
  "items": [
    {
      "price_data": {
        "unit_amount": 9900,
        "product_data": {
          "name": "AI会员专业版"
        },
        "recurring": {
          "interval": "MONTH",
          "interval_count": 1
        },
        "metadata": "{\"price_version\":\"v1\"}"
      }
    }
  ],
  "metadata": "{\"edition\":\"pro\"}"
}
```

### 创建约束

- `customer_id` 必传。
- `items` 必传且只能有一个订阅项。
- 创建时不传 `item_id`，不得传 `price_id`、`source_quantity` 或 `target_quantity`。
- `items.quantity` 可不传或传 `1`；其他值不支持。
- `items.price_data` 必传，且必须包含正数 `unit_amount`、完整 `product_data` 和 `recurring`。
- `pay_amount` 不传时按 `price_data.unit_amount` 计算；具备零元订阅准入时可传 `0` 进入仅签约链路；不得传负数。
- `coupon_id` 按需传入，与 `pay_amount` 互斥；与 `trial_period_days` 互斥。
- `trial_period_days` 取值 3-365；若同时传
  `price_data.recurring.trial_period_days`，两处值必须一致；`trial_desc` 最多 12 个字符。
- 免费试用按零元订阅准入校验；低价试用需具备试用期订阅准入。普通正金额首次订阅购买中，系统计算后的首笔实际支付金额必须至少为 1.00 元（100 分），且满足“首笔实际支付金额 x 3 >= 后续周期扣款金额”。默认不支持试用期；已获准的试用期不受 3 倍管控，正金额试用仍核对 1.00 元下限，完整默认限制见[商户默认管控规则](merchant-default-controls.md)。
- `deduct_type` 不传时为 `SUBSCRIBE_DEDUCT`；试用期订阅不支持 `MERCHANT_DEDUCT`。
- 不支持 `SCHEDULED_EFFECTIVE` 未来生效；不要传未来生效相关字段。

`price_data.unit_amount` 表示周期商品单价，必须大于 0；在已获得零元订阅准入的前提下，
`pay_amount=0` 表示本次不发生真实首笔付款。两者语义不同，不要为了零元仅签约把
`unit_amount` 也设为 0。

## 修改订阅

调用 `alipay.trade.subscription.submode.modify`。`subscription_id` 和 `customer_id` 必传；
`modify_type` 不传时按 `UPGRADE` 处理。

| `modify_type` | `items` | 关键规则 |
|---|---|---|
| `UPGRADE` | 必传且只能一个 | 传当前 `item_id` 和完整目标 `price_data`；可传非负 `pay_amount` |
| `DOWNGRADE` | 必传且只能一个 | 传当前 `item_id` 和完整目标 `price_data`；下周期生效，不传优惠券 |
| `CANCEL` | 无需传 | `cancel_at_period_end` 必传；`false` 为立即取消，可按规则传 `refund_amount` |
| `REVERT_CANCEL` | 无需传 | `cancel_at_period_end` 必须为 `false` |

Submode 不支持 `INCREASE_QUANTITY`、`DECREASE_QUANTITY`、`source_quantity` 或
`target_quantity`。商户业务中的容量变化若已获准使用 Submode，需要用 `UPGRADE` 或
`DOWNGRADE` 提交一份新的完整商品价格快照，不要套用普通席位扩缩容字段。

### 升级请求示例

```json
{
  "subscription_id": "SUBSCRIPTION_ID",
  "customer_id": "CUSTOMER_ID",
  "modify_type": "UPGRADE",
  "preserve_billing_cycle": true,
  "items": [
    {
      "item_id": "CURRENT_ITEM_ID",
      "price_data": {
        "unit_amount": 19900,
        "product_data": {
          "name": "AI会员旗舰版"
        },
        "recurring": {
          "interval": "MONTH",
          "interval_count": 1
        },
        "metadata": "{\"price_version\":\"v2\"}"
      }
    }
  ]
}
```

升级时：

- `pay_amount` 不传时，根据新 `price_data.unit_amount` 与当前订阅计算差价。
- 需要自定义实付金额时传非负 `pay_amount`；传 `0` 时仅签约，不发生真实付款。
- `coupon_id` 仅升级场景可按需传入，且与 `pay_amount` 互斥。
- `preserve_billing_cycle=true` 表示保持原计费周期；`false` 表示重置周期。
- `cancel_at_period_end` 不得与升级或降级同时传入。

取消时：

- `CANCEL + cancel_at_period_end=true` 表示周期末取消，不传 `refund_amount`。
- `CANCEL + cancel_at_period_end=false` 表示立即取消；`refund_amount` 不传时按规则计算，
  传 `0` 表示取消但不退款，传正数表示指定退款金额。
- `REVERT_CANCEL` 用于撤销周期末取消，`cancel_at_period_end` 必须为 `false`。

## 商品价格快照

### `price_data`

| 字段 | 必选 | 规则 |
|---|---|---|
| `unit_amount` | 是 | 单位分，必须大于 0 |
| `product_data` | 是 | 完整商品信息 |
| `recurring` | 是 | 周期价格配置 |
| `metadata` | 否 | JSON object 字符串，所有 value 必须是字符串 |

### `product_data`

| 字段 | 必选 | 规则 |
|---|---|---|
| `name` | 是 | 非空，最长 255 字符 |
| `description` | 否 | 商品描述，最长 255 字符 |
| `images` | 否 | 合法的 JSON string array 字符串，建议不超过 5 项 |
| `marketing_features` | 否 | 合法的 JSON string array 字符串，建议不超过 5 项 |
| `metadata` | 否 | JSON object 字符串，所有 value 必须是字符串 |
| `unit_label` | 否 | 商品计量单位描述 |
| `url` | 否 | 商品详情页 URL |

### `recurring`

| 字段 | 必选 | 规则 |
|---|---|---|
| `interval` | 是 | 仅 `DAY` 或 `MONTH`，大小写不敏感 |
| `interval_count` | 是 | 正整数；`DAY` 时不得小于 7 |
| `trial_period_days` | 否 | 与请求顶层同时传时必须一致 |
| `usage_type` | 否 | 仅支持 `licensed` |

`interval=MONTH`、`interval_count=12` 可表达年付，但超出默认最长周期；定向接口准入不等于价格或周期限制已调整，见[商户默认管控规则](merchant-default-controls.md)。Submode 不支持身份专享价相关字段或认证参数。

`metadata`、`images`、`marketing_features` 在 JSON 请求里仍是字符串字段。例如：

```json
{
  "metadata": "{\"edition\":\"pro\"}",
  "images": "[\"https://merchant.example/product.png\"]",
  "marketing_features": "[\"feature_a\",\"feature_b\"]"
}
```

不要把这些字段误传为嵌套 JSON 对象或数组。

## 响应、通知与终态

创建响应可能包含 `subscription_id`、`order_no`、`pay_amount`、`alipay_schema`、
`alipay_jump_schema`、`schema_effective_end`；试用期还可能包含 `trial_start`、`trial_end`。

修改响应按场景可能包含支付/签约链接、`refund_order_id` 和 `refund_amount`。

- 接口返回成功和浏览器跳转完成都不等于订阅或退款终态。
- 支付/签约场景以验签后的 `alipay.trade.subscription.changed` 通知或查询结果为准。
- 立即取消并退款时，订阅取消和退款结果仍需分别确认。
- 保存创建返回的 `subscription_id`；升级或降级完成后，通过查询或通知保存最新 `item_id`，
  供后续修改使用。
- 对通知验签、按业务主键幂等，并用查询接口进行状态补偿。

## Java SDK 接入

优先使用支付宝官方 Java SDK：

| 接口 | 请求类型 | Model 类型 | 响应类型 |
|---|---|---|---|
| create | `AlipayTradeSubscriptionSubmodeCreateRequest` | `AlipayTradeSubscriptionSubmodeCreateModel` | `AlipayTradeSubscriptionSubmodeCreateResponse` |
| modify | `AlipayTradeSubscriptionSubmodeModifyRequest` | `AlipayTradeSubscriptionSubmodeModifyModel` | `AlipayTradeSubscriptionSubmodeModifyResponse` |

订阅项使用 `SubscriptionSubmodeItem`，价格快照使用 `SubscriptionPriceData`，商品信息使用
`SubscriptionProductData`，周期配置使用 `SubscriptionRecurring`。复用单例
`DefaultAlipayClient` 并调用 `execute`；证书模式按 SDK 要求初始化证书客户端并调用
`certificateExecute`。第三方应用代调用时再设置当前商户对应的 `app_auth_token`。

若当前 SDK 尚未包含上述类型，先升级到已支持这些接口的官方 SDK；不要自行猜测类字段或复制
内部模型。无法升级且商户明确要求自行组装 HTTP 时，再按非 SDK 接入指南完成公共参数、RSA2
签名、请求和响应验签。

## 接入检查清单

- [ ] 商户和实际调用应用已确认获得 Submode 定向准入。
- [ ] 使用 `submode.create` / `submode.modify`，没有误用普通 create/modify。
- [ ] 没有预传或复用 `price_id`，目标商品价格通过完整 `price_data` 提交。
- [ ] `items` 只有一个，`quantity` 未传或为 `1`。
- [ ] `unit_amount` 大于 0，零元仅签约只通过 `pay_amount=0` 表达。
- [ ] `product_data.name`、`recurring.interval` 和 `interval_count` 已填写并通过校验。
- [ ] JSON 字符串字段完成双层序列化，且 metadata 的 value 都是字符串。
- [ ] 未使用未来生效、身份专享价或普通席位扩缩容字段。
- [ ] 升降级使用查询或通知返回的当前 `item_id`，并提交新的完整快照。
- [ ] 通知已验签和幂等，关键状态有查询补偿。

公开接口资料：

- [alipay.trade.subscription.submode.create](https://opendocs.alipay.com/preview/api_md_alipay.trade.subscription.submode.create_API_MD_cc41732f52e24b3d9cb952975cd562e7.md)
- [alipay.trade.subscription.submode.modify](https://opendocs.alipay.com/preview/api_md_alipay.trade.subscription.submode.modify_API_MD_84f5d6dbca994f518d36b0aa6defb907.md)
