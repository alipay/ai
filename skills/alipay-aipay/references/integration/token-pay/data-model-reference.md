# 数据结构参考

本文档基于后台代码整理，提供完整的数据结构定义。

## 订阅状态枚举 (SubscriptionStatus)

| 状态 | 说明 | 触发场景 |
|------|------|---------|
| `INCOMPLETE` | 未完成 | 创建订阅后，用户尚未完成支付 |
| `INCOMPLETE_EXPIRED` | 未完成已过期 | 订阅创建后超过支付时效仍未支付 |
| `ACTIVE` | 活跃 | 用户完成支付，订阅正常运行中 |
| `TRIALING` | 试用中 | 用户处于试用期（如有配置） |
| `PAST_DUE` | 逾期宽限期中 | 已显式配置正数宽限期的订阅在周期结束后仍未续费，并满足实际运行条件时进入；恢复扣款成功回到 ACTIVE，宽限到期仍未支付则转 CANCELED |
| `CANCELED` | 已取消 | 用户主动取消或系统取消 |
| `UNPAID` | 未支付 | 预留状态，当前版本不会流转到该状态 |
| `PAUSED` | 已暂停 | 预留状态，当前版本不会流转到该状态 |

### 状态流转图

```
创建订阅 → INCOMPLETE ──支付成功──→ ACTIVE ──续费成功──→ ACTIVE
                │                      │  │
                │ 超时未支付            │  ├─ 未配置/不满足宽限条件且到期未续费 ─→ CANCELED
                │                      │  └─ 已配置并满足宽限条件 ─→ PAST_DUE
                ↓                      │                          │
         INCOMPLETE_EXPIRED            │             恢复扣款成功 ├─→ ACTIVE
                                       │             宽限期到期   └─→ CANCELED
                                       └─ 用户取消/到期 ───────────→ CANCELED

试用期订阅：INCOMPLETE ──试用签约成功──→ TRIALING ──试用期结束扣款成功──→ ACTIVE
```


## 订阅数据结构 (Subscription)

```json
{
  "subscriptionId": "20260320123156789",
  "customerId": "CUS_20260320001",
  "subscribeTitle": "AI会员专业版",
  "subscriptionStatus": "ACTIVE",
  "effectiveType": "IMMEDIATE_EFFECTIVE",
  "currentPeriodStart": "2026-03-20 10:30:00",
  "currentPeriodEnd": "2026-04-20 10:30:00",
  "cancelAtPeriodEnd": false,
  "gracePeriodDays": 3,
  "gracePeriodEnd": null,
  "startDate": "2026-03-20 10:30:00",
  "canceledDate": null,
  "created": "2026-03-20 10:00:00",
  "items": [
    {
      "itemId": "ITEM_001",
      "quantity": 1,
      "created": "2026-03-20 10:00:00",
      "price": {
        "id": "PRICE_001",
        "active": true,
        "type": "recurring",
        "unitAmount": "9900",
        "productId": "PROD_001",
        "productName": "AI会员专业版",
        "recurring": {
          "interval": "MONTH",
          "intervalCount": 1
        }
      }
    }
  ],
  "pendingItems": null,
  "metadata": null,
  "trialStart": null,
  "trialEnd": null,
  "deductType": "SUBSCRIBE_DEDUCT"
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| subscriptionId | String | 订阅ID，支付宝生成 |
| customerId | String | 客户ID；对外字段为 `customer_id`，由客户创建接口返回，不是支付宝用户ID |
| subscribeTitle | String | 订阅标题 |
| subscriptionStatus | String | 订阅状态（见状态枚举） |
| effectiveType | String | 生效类型；对外 JSON 字段为 `effective_type`，取值见 SubscriptionEffectiveType 枚举 |
| currentPeriodStart | String | 当前周期开始时间，格式：yyyy-MM-dd HH:mm:ss |
| currentPeriodEnd | String | 当前周期结束时间，格式：yyyy-MM-dd HH:mm:ss |
| cancelAtPeriodEnd | Boolean | **周期结束是否失效**。true=到期后失效，false=继续续费 |
| gracePeriodDays | Integer | 宽限期天数；对外字段为 `grace_period_days`。不传或 `0` 表示关闭，支持 `1`、`2`、`3`、`4`、`5` |
| gracePeriodEnd | String | 本轮宽限期结束时间；对外字段为 `grace_period_end`，格式 `yyyy-MM-dd HH:mm:ss`。处于 `PAST_DUE` 时以进入时冻结的配置为准 |
| startDate | String | 订阅开始日期 |
| canceledDate | String | 订阅取消时间（已取消时有值） |
| created | String | 创建时间 |
| items | Array | 当前生效的订阅项目列表 |
| pendingItems | Array | 当前仍有效的待生效订阅项（席位套餐降级或缩容场景，PENDING 状态，下周期生效）；撤销周期末取消后原待生效项不再返回 |
| metadata | String | 订阅元数据（JSON） |
| trialStart | String | 试用期开始时间（试用期订阅有值） |
| trialEnd | String | 试用期结束时间（试用期订阅有值） |
| deductType | String | 扣款模式（见 DeductType 枚举） |

## 扣款类型枚举 (DeductType)

| 名称 | 说明 |
|------|------|
| `SUBSCRIBE_DEDUCT` | 订阅代扣（托管模式，默认）。周期到期由支付宝自动发起扣款 |


## 订阅生效类型枚举 (SubscriptionEffectiveType)

| 名称 | 说明 |
|------|------|
| `IMMEDIATE_EFFECTIVE` | 立即生效；创建请求不传 `effective_type` 时的默认值 |
| `SCHEDULED_EFFECTIVE` | 未来生效；创建时同时传 `scheduled_effective_time` |

查询和变更通知中的对外字段名为 `effective_type`。未来生效的日期约束和首扣流程见 [未来生效订阅接入指南](scheduled-effective.md)。

## 订阅项数据结构 (SubscriptionItem)

```json
{
  "itemId": "ITEM_001",
  "quantity": 100,
  "created": "2026-03-20 10:00:00",
  "price": {
    // SubscriptionPrice 结构
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| itemId | String | 项目ID |
| quantity | Integer | **数量。标准订阅固定为1；席位订阅表示席位数量** |
| created | String | 创建时间 |
| price | Object | 价格详情（SubscriptionPrice） |
| couponId | String | 优惠券ID（使用优惠券时返回） |
| discountAmount | String | 优惠券优惠金额 |

> 💡 **席位订阅**：quantity 表示席位数量。`items` 是当前生效项，`pendingItems` 是当前仍有效的下周期目标项。套餐升降级、扩容或缩容后会产生新的 itemId，需通过查询或通知保存最新 itemId、价格和数量。若在待生效变更后设置周期末取消并再次撤销取消，恢复当前 `items`，原 `pendingItems` 失效；收到恢复通知后重新查询并覆盖本地记录。

## 价格数据结构 (SubscriptionPrice)

```json
{
  "id": "PRICE_001",
  "active": true,
  "type": "recurring",
  "unitAmount": "9900",
  "productId": "PROD_001",
  "productName": "AI会员专业版",
  "product": {
    // Product 结构
  },
  "recurring": {
    "interval": "MONTH",
    "intervalCount": 1,
    "usageType": "licensed",
    "trialPeriodDays": 7
  },
  "metadata": "{\"default\":\"default\"}",
  "gmtCreate": "2026-03-20 09:00:00"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 价格ID |
| active | Boolean | 是否可用 |
| type | String | 价格类型：`recurring`(订阅) / `one_time`(单次) |
| unitAmount | String | 单价金额，**单位：分** |
| productId | String | 关联商品ID |
| productName | String | 商品名称 |
| product | Object | 商品详情 |
| recurring | Object | 周期信息 |
| metadata | String | 元数据（JSON格式） |
| gmtCreate | String | 创建时间 |

## 周期信息数据结构 (Recurring)

```json
{
  "interval": "MONTH",
  "intervalCount": 1,
  "usageType": "licensed",
  "trialPeriodDays": 7,
  "metadata": "{}",
  "gmtCreate": "2026-03-20 09:00:00"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| interval | String | 周期单位：仅支持 `DAY`/`MONTH`（不支持 `WEEK`/`YEAR`，`MONTH`+`intervalCount=12` 可表达年付但超出默认最长周期，默认限制见[默认管控](merchant-default-controls.md)；`DAY` 时 `intervalCount` 不小于 7） |
| intervalCount | Integer | 周期间隔，如 interval=MONTH, intervalCount=3 表示季度 |
| usageType | String | 计费模式：`licensed`(固定计费) / `metered`(按量计费) |
| trialPeriodDays | Long | 试用期天数（可选） |
| metadata | String | 元数据 |

## 商品数据结构 (Product)

```json
{
  "id": "PROD_001",
  "name": "AI会员专业版",
  "description": "包含GPT-4、DALL-E等高级功能",
  "active": true,
  "defaultPriceId": "PRICE_001",
  "metadata": "{\"default\":\"default\"}",
  "gmtCreate": "2026-03-20 08:00:00"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 商品ID |
| name | String | 商品名称 |
| description | String | 商品描述 |
| active | Boolean | 是否可用 |
| defaultPriceId | String | 默认价格ID |
| metadata | String | 元数据（JSON格式） |
| gmtCreate | String | 创建时间 |
| unitLabel | String | 商品计量单位描述（如：个 / 席位 / seat） |

## 业务场景类型 (SubscriptionSaasScene)

场景类型用于标识支付的业务场景，在支付请求中传递。

| 场景码 | 说明 | 触发时机 |
|-------|------|---------|
| `firstPay` | 订阅首次支付 | 用户第一次购买订阅 |
| `periodPay` | 订阅周期扣款 | 系统自动续费扣款 |
| `updatePay` | 订阅升级扣款 | 用户升级订阅套餐时补差价 |

### 使用场景

```json
// 首次支付
{
  "extendParams": {
    "subscriptionSaasScene": "firstPay"
  }
}

// 周期扣款
{
  "extendParams": {
    "subscriptionSaasScene": "periodPay"
  }
}

// 升级扣款
{
  "extendParams": {
    "subscriptionSaasScene": "updatePay"
  }
}
```

## 订阅修改类型 (ModifyType)

用于 `alipay.trade.subscription.modify` 接口的 `modify_type` 参数。不传时默认视为 `UPGRADE`。

| 类型 | 说明 | 适用场景 |
|-----|------|---------|
| `UPGRADE` | 升级 | 立即生效，补差价（不传 modify_type 时默认）；席位套餐换价时可同步修改数量 |
| `DOWNGRADE` | 降级 | 下周期生效，无需付费；席位套餐换价时可同步修改数量 |
| `CANCEL` | 订阅取消 | 取消订阅，停止后续扣款 |
| `REVERT_CANCEL` | 撤销周期末取消 | 撤销尚未生效的周期末取消预约（cancel_at_period_end 需传 false）；返回新的签约入口，用户重新确认后原订阅继续，已经进入 `CANCELED` 后不能通过该操作恢复 |
| `INCREASE_QUANTITY` | 席位扩容 | 席位订阅增加席位数量，计算当前周期差价 |
| `DECREASE_QUANTITY` | 席位缩容 | 席位订阅减少席位数量，下周期生效 |
| `UPDATE_GRACE_PERIOD` | 修改宽限期 | 只修改后续周期使用的宽限期配置；请求不得与其他订阅变更字段混传 |

> 升级（UPGRADE）/扩容（INCREASE_QUANTITY）的最终金额必须 **大于等于 0**。最终金额为 0 时仅签约，正数时支付并签约；负数仍会被拒绝。
>
> 席位套餐换价时，`source_quantity` 与 `target_quantity` 同传同缺；两者都不传表示保持当前数量，同时传时源数量必须等于当前生效数量。`modify_type` 决定立即或下周期生效，不按数量增加或减少方向推断；只改数量时继续使用 `INCREASE_QUANTITY` / `DECREASE_QUANTITY`。免费和低价试用也支持套餐降级，目标项在 `trial_end` 生效。
>
> `UPDATE_GRACE_PERIOD` 只允许 `subscription_id`、可选 `customer_id` 和 `grace_period_days`。订阅处于 `ACTIVE`、`TRIALING` 或 `PAST_DUE` 时可修改；若已进入 `PAST_DUE`，本轮截止时间不随修改变化，新配置从后续周期起生效。

### 使用示例

```json
// 席位套餐升级并同步修改数量
{
  "subscription_id": "20260320123156789",
  "modify_type": "UPGRADE",
  "preserve_billing_cycle": true,
  "items": [
    {
      "item_id": "2026032012314",
      "price_id": "PRICE_ENTERPRISE_PRO",
      "source_quantity": 100,
      "target_quantity": 80
    }
  ]
}

// 席位扩容
{
  "subscription_id": "20260320123156789",
  "modify_type": "INCREASE_QUANTITY",
  "preserve_billing_cycle": true,
  "items": [
    {
      "item_id": "2026032012314",
      "source_quantity": 80,
      "target_quantity": 100
    }
  ]
}

// 席位缩容
{
  "subscription_id": "20260320123156789",
  "modify_type": "DECREASE_QUANTITY",
  "items": [
    {
      "item_id": "2026032012314",
      "source_quantity": 100,
      "target_quantity": 80
    }
  ]
}

// 取消订阅
{
  "subscription_id": "20260320123156789",
  "modify_type": "CANCEL",
  "cancel_at_period_end": true
}

// 修改宽限期
{
  "subscription_id": "20260320123156789",
  "modify_type": "UPDATE_GRACE_PERIOD",
  "grace_period_days": 1
}
```

## 时间格式规范

所有时间字段统一使用格式：`yyyy-MM-dd HH:mm:ss`

示例：`2026-03-20 10:30:00`

## 金额单位

所有金额字段单位为**分**，需要注意：

| 显示金额 | 实际值 |
|---------|-------|
| ¥99.00 | `9900` |
| ¥0.01 | `1` |
| ¥1,000.00 | `100000` |
