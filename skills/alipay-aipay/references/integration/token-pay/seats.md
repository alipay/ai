# 席位订阅场景接入指南

先核对[商户默认管控规则](merchant-default-controls.md)：试用默认不可用，免费或低价试用示例仅适用于实际已获准的商户；试用期不受 3 倍管控。涉及席位时同时核对单价和整单金额。

席位订阅是标准订阅产品的扩展能力，支持按席位数量订阅的场景，如企业版 SaaS 多席位订阅、团队协作工具席位订阅等。

## 与标准订阅的差异对比

| 功能 | 标准订阅 | 席位订阅 |
|-----|---------|---------|
| 商品创建 | 无特殊字段 | **必须传入 `unit_label`**（单位别名，如"席位"） |
| 订阅创建 | items 中无需 quantity | **items 中必须传入正整数 `quantity`**（支持 1 席），支持免费和低价试用 |
| 订阅修改 | 支持套餐升级/降级、取消 | 套餐升降级可同步变更数量；仅改数量时使用扩容/缩容 |
| 订阅查询 | quantity 固定为 1 | `items.quantity` 表示当前数量，`pending_items.quantity` 表示待生效数量 |
| 异步通知 | 使用订阅变更通知 | 核对变更后的生效价格及席位数量，区分当前项与待生效项 |

---

## 接入流程

### 整体时序图

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   商户后台   │     │   支付宝    │     │    用户     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │ 1. 创建席位商品   │                   │
       │    (unit_label)  │                   │
       │──────────────────>│                   │
       │<──────────────────│                   │
       │   product_id      │                   │
       │                   │                   │
       │ 2. 创建价格       │                   │
       │──────────────────>│                   │
       │<──────────────────│                   │
       │   price_id        │                   │
       │                   │                   │
       │                   │  3. 用户注册      │
       │<──────────────────────────────────────│
       │                   │                   │
       │ 4. 创建客户       │                   │
       │──────────────────>│                   │
       │<──────────────────│                   │
       │   customer_id     │                   │
       │                   │                   │
       │                   │  5. 用户订阅(N席位)│
       │<──────────────────────────────────────│
       │                   │                   │
       │ 6. 创建订阅       │                   │
       │    (quantity=N)   │                   │
       │──────────────────>│                   │
       │<──────────────────│                   │
       │   pay_url         │                   │
       │                   │                   │
       │                   │  7. 用户支付      │
       │                   │<──────────────────│
       │                   │                   │
       │ 8. 异步通知       │                   │
       │<──────────────────│                   │
       │                   │                   │
       │ 9. 扩容/缩容请求  │                   │
       │    (modify_type)  │                   │
       │──────────────────>│                   │
       │<──────────────────│                   │
       │   支付链接(扩容时) │                   │
```

---

## 核心接口详解

### 1. 商品创建（alipay.trade.product.create）

席位场景下，商品创建必须传入 `unit_label` 字段。

#### 请求参数

| 参数名 | 必选 | 类型 | 长度 | 描述 | 示例值 |
|-------|------|------|------|------|--------|
| name | 必选 | string | [1,255] | 商品名称 | 企业协作版会员 |
| description | 可选 | string | [1,255] | 商品描述 | 支持多席位协作 |
| **unit_label** | **条件必选** | string | [1,100] | **单位别名（席位场景必传）** | **席位** |
| metadata | 可选 | string | [1,2000] | 商品元数据（JSON） | {"key":"value"} |
| images | 可选 | string | [1,4000] | 图片地址数组 | ["https://..."] |
| marketing_features | 可选 | string | [1,4000] | 营销信息数组 | ["无限协作"] |
| url | 可选 | string | [1,500] | 商品详情链接 | https://... |

> ⚠️ **重要**：`unit_label` 字段会展示在用户的签约协议页面，代表用户购买商品的单位。该字段受支付宝管控，接入前需要与支付宝业务确认传值。

#### 示例请求

```json
{
  "name": "企业协作版会员",
  "description": "支持多席位协作，畅享全部高级功能",
  "unit_label": "席位",
  "metadata": "{\"type\":\"enterprise\"}"
}
```

#### 响应示例

```json
{
  "alipay_trade_product_create_response": {
    "code": "10000",
    "msg": "Success",
    "product_id": "202603230010000000000"
  }
}
```

---

### 2. 订阅创建（alipay.trade.subscription.create）

席位场景下，订阅创建必须传入 `quantity` 字段表示席位数量。

#### 请求参数

| 参数名 | 必选 | 类型 | 描述 | 示例值 |
|-------|------|------|------|--------|
| items | 必选 | array | 订阅项目信息 | - |
| &nbsp;&nbsp;└─ price_id | 必选 | string | 价格ID | 202603201234567889 |
| &nbsp;&nbsp;└─ **quantity** | **必选** | integer | **席位数量（必须为正整数，支持 1 席）** | **100** |
| customer_id | 必选 | string | 客户ID | MERCHANT_CUSTOMER_ID |
| metadata | 可选 | string | 订阅元数据 | {"key":"value"} |
| subscribe_title | 可选 | string | 订单标题 | 企业版100席位订阅 |

> ⚠️ **重要**：席位属性由商品非空 `unit_label` 决定；`quantity=1` 仍是席位订阅，不会转为个人订阅。

#### 示例请求

```json
{
  "customer_id": "MERCHANT_CUSTOMER_ID",
  "items": [
    {
      "price_id": "202603201234567889",
      "quantity": 100
    }
  ],
  "subscribe_title": "企业协作版-100席位月度订阅"
}
```

#### 响应示例

```json
{
  "alipay_trade_subscription_create_response": {
    "code": "10000",
    "msg": "Success",
    "subscription_id": "20260320123156789",
    "pay_amount": 990000,
    "alipay_schema": "https://..."
  }
}
```

#### 席位试用

席位订阅可以同时传 `quantity` 与 `trial_period_days`。免费试用不传 `pay_amount` 或传 0；低价试用传正数 `pay_amount`。

```json
{
  "customer_id": "MERCHANT_CUSTOMER_ID",
  "items": [
    {
      "price_id": "202603201234567889",
      "quantity": 10
    }
  ],
  "trial_period_days": 7,
  "trial_desc": "团队7天试用",
  "pay_amount": 500,
  "subscribe_title": "企业协作版-10席位试用"
}
```

- 低价试用的 `pay_amount` 表示全部席位的试用总价。例如 `pay_amount=500` 表示全部 10 个席位的试用总价 5.00 元，不再乘以 `quantity`。
- 试用结束后的周期扣款总额为价格单价乘席位数量。
- 免费试用和低价试用分别遵循零元订阅、试用期订阅及首笔金额准入规则。
- 试用期内不支持独立 `INCREASE_QUANTITY` 或 `DECREASE_QUANTITY`。免费和低价试用均可使用 `UPGRADE` / `DOWNGRADE` 更换套餐，并在套餐变更中同步调整数量。
- 试用与优惠券仍互斥，试用期订阅仍只支持支付宝托管扣款。

---

### 3. 席位套餐升降级（alipay.trade.subscription.modify）

更换席位订阅的价格方案时使用 `UPGRADE` 或 `DOWNGRADE`，并可在同一次请求中同步修改席位数量。

```json
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
  ],
  "description": "切换专业版并调整为80席"
}
```

| 规则 | `UPGRADE` | `DOWNGRADE` |
|------|-----------|-------------|
| 生效时间 | 用户完成支付/签约后立即生效 | 用户确认后在下周期生效 |
| 本次金额 | 按目标价格、目标数量、剩余周期和优惠计算整单差价；最终金额不得小于 0 | 本次不收费 |
| 查询结果 | 生效后 `items` 返回目标价格和数量 | 生效前 `items` 保持当前值，`pending_items` 返回目标价格和数量 |

席位套餐升降级必须遵守以下约束：

- `items` 仍只能有一个元素，`item_id` 和目标 `price_id` 必传。
- `source_quantity` 与 `target_quantity` 要么同时传、要么同时不传；只传一个会被拒绝。
- 两者同时不传表示保持查询结果中当前 `items.quantity`；同时传时均须为正整数，且 `source_quantity` 必须等于当前 `items.quantity`。
- `modify_type` 决定立即生效或下周期生效；不要根据目标数量比源数量大还是小来选择 `UPGRADE` / `DOWNGRADE`。
- `pay_amount` 如传入，表示本次整单实际支付金额，不按 `target_quantity` 再次相乘；目标周期扣款仍按目标单价乘目标数量。
- 只变更数量、不更换 `price_id` 时，使用下方 `INCREASE_QUANTITY` / `DECREASE_QUANTITY`。
- 免费和低价试用均支持套餐降级；用户确认后当前套餐和数量继续使用到 `trial_end`，目标套餐和数量从 `trial_end` 起生效。试用期套餐升降级不支持 `preserve_billing_cycle=true`。

---

### 4. 席位扩容/缩容（alipay.trade.subscription.modify）

席位订阅支持动态调整席位数量。

#### 扩容场景

新接入单独增加席位（`INCREASE_QUANTITY`）时，按场景指南显式传 `preserve_billing_cycle=true`。原计费周期保持不变，系统按本周期剩余天数占比计算新增席位差价，接口返回支付/签约链接。见[团体席位场景指南](https://aipay.alipay.com/docs/subscribe/integration-guide/group-seat.md)。最终金额可为 0：0 元仅签约，正数支付并签约。

**存量请求和数量字段。** [通用修改 API](https://aipay.alipay.com/docs/subscribe/api-list/individual-group-seat/subscription-modify.md)将该开关列为可选，说明仅提到套餐升级，无法据此确定存量扩容传 false 或省略的实际行为。团体席位页的网关示例把数量写成 `sourceQuantity` / `targetQuantity` 字符串，通用 API 表使用 `source_quantity` / `target_quantity` 字符串。下例沿用旧订阅包，用整数表示业务数量。直接拼接网关请求、迁移 SDK 或排查旧请求时，核对实际 SDK 序列化的字段、适用接口契约及脱敏回执；这三种写法的网关兼容范围待确认。

```json
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
  ],
  "description": "席位扩容：80->100"
}
```

**扩容响应**：
```json
{
  "alipay_trade_subscription_modify_response": {
    "code": "10000",
    "msg": "Success",
    "subscription_id": "20260320123156789",
    "pay_amount": 20000,
    "alipay_schema": "https://..."
  }
}
```

> 💡 **说明**：扩容后始终处理返回的 `alipay_schema`。`pay_amount>0` 时用户支付差价并签约；`pay_amount=0` 时用户仅签约，不发生真实付款。完成后以 `item_update` 通知或查询结果确认新席位。

#### 缩容场景

缩容时返还会在后续周期生效，当前周期保持原席位数量。

```json
{
  "subscription_id": "20260320123156789",
  "modify_type": "DECREASE_QUANTITY",
  "items": [
    {
      "item_id": "2026032012314",
      "source_quantity": 100,
      "target_quantity": 80
    }
  ],
  "description": "席位缩容：100->80"
}
```

**缩容响应**：
```json
{
  "alipay_trade_subscription_modify_response": {
    "code": "10000",
    "msg": "Success",
    "subscription_id": "20260320123156789",
    "alipay_schema": "https://..."
  }
}
```

> 💡 **说明**：缩容返回签约链接（无需支付），用户确认后，当前已扣款周期保持原席位数量，下个周期起按新数量扣款。

携券规则：套餐升级 `UPGRADE` 和扩容 `INCREASE_QUANTITY` 必须同时传非负 `pay_amount`（单位：分），当次实付按指定金额执行，不再扣减券优惠；套餐降级 `DOWNGRADE` 和缩容 `DECREASE_QUANTITY` 携券时禁止传 `pay_amount`，且不支持一次性 `once` 券，仅支持 `repeating` / `forever`。券放在 `items[].coupon_id`，完整示例见 [修改订阅用券](marketing-tools.md#2-修改订阅时使用优惠券)。

#### 请求参数说明

| 参数名 | 必选 | 类型 | 描述 |
|-------|------|------|------|
| subscription_id | 必选 | string | 订阅ID |
| **modify_type** | **必选** | string | **INCREASE_QUANTITY（扩容）或 DECREASE_QUANTITY（缩容）** |
| preserve_billing_cycle | 扩容必填 | boolean | 新接入的单独扩容按[扩容场景](#扩容场景)传 true。套餐升级按[修改接口](https://aipay.alipay.com/docs/subscribe/api-list/individual-group-seat/subscription-modify.md)的升级规则选择是否重置周期 |
| items | 必选 | array | 订阅项目信息 |
| &nbsp;&nbsp;└─ coupon_id | 可选 | string | 优惠券ID；扩容携券必须同时传非负 pay_amount，缩容携券禁止 pay_amount 和一次性券 |
| &nbsp;&nbsp;└─ item_id | 必选 | string | 订阅项ID（从查询/通知接口获取） |
| &nbsp;&nbsp;└─ **source_quantity** | **必选** | 正整数数量，传输格式见[扩容场景](#扩容场景) | **原始席位数量（必须 >0）** |
| &nbsp;&nbsp;└─ **target_quantity** | **必选** | 正整数数量，传输格式见[扩容场景](#扩容场景) | **目标席位数量（必须 >0；扩容须大于原始数量，缩容须小于原始数量）** |
| description | 可选 | string | 更新描述 |

---

### 5. 席位订阅取消（alipay.trade.subscription.modify）

席位订阅取消使用 `modify_type=CANCEL`。

```json
{
  "subscription_id": "20260320123156789",
  "modify_type": "CANCEL",
  "cancel_at_period_end": true,
  "description": "用户主动取消订阅"
}
```

预约周期末取消后，收到 `cancel_at_period_end` 只标记待取消并保留当前权益。收到生效通知 `cancel` 或查询确认为 `CANCELED` 后收回席位。立即取消、宽限期及退款的规则见[订阅契约](subscription-contracts.md)。

---

### 6. 席位订阅查询（alipay.trade.subscription.query）

查询接口返回的 `items.quantity` 表示当前生效的席位数量。

#### 响应示例

```json
{
  "alipay_trade_subscription_query_response": {
    "code": "10000",
    "msg": "Success",
    "subscriptions": [
      {
        "subscription_id": "20260320123156789",
        "subscription_status": "ACTIVE",
        "items": [
          {
            "item_id": "2026032012314",
            "quantity": 100,
            "price": {
              "id": "20260324001001",
              "unit_amount": "9900",
              "product": {
                "name": "企业协作版",
                "description": "多席位协作"
              }
            }
          }
        ],
        "pending_items": [
          {
            "item_id": "2026032012315",
            "quantity": 80,
            "price": {
              "id": "PRICE_ENTERPRISE_PRO",
              "unit_amount": "12900"
            }
          }
        ]
      }
    ]
  }
}
```

> `items` 始终表示当前生效的价格和数量；`pending_items` 表示已确认、等待下周期生效的套餐降级或缩容目标。待生效变更完成后，目标项转为当前生效项，并应保存其最新 `item_id`。
>
> 如果先设置周期末取消、随后通过 `REVERT_CANCEL` 撤销取消，恢复的是当前 `items`，原 `pending_items` 失效且不会在周期末生效。收到 `item_cancel_revert` 后应重新查询并清除本地保存的原待生效变更。

---

## 异步通知处理

### 通知类型扩展

席位变更使用订阅通知。验签、幂等、查询补偿和取消生效以[通知处理](notification-guide.md)为准。

| change_type | 说明 | 处理逻辑 |
|-------------|------|---------|
| active | 订阅生效 | 开通席位权益 |
| period_extend | 续费成功 | 延长席位权益 |
| item_update | 席位扩容成功 | 增加席位数量 |
| **item_downgrade** | **席位缩容成功** | **减少席位数量（下周期生效）** |
| cancel_at_period_end | 周期末取消已预约 | 保留本周期权益 |
| cancel | 取消已生效 | 查证后收回席位权益 |

### 通知示例

```json
{
  "change_type": "item_update",
  "change_date": "2026-03-22 21:00:00",
  "trade_no": "2026022276001434360514767918",
  "pay_amount": "20000",
  "subscription": {
    "subscription_id": "20260320123156789",
    "subscription_status": "ACTIVE",
    "items": [
      {
        "item_id": "2026032012314_new",
        "quantity": 100,
        "price": {
          "id": "20260324001001",
          "unit_amount": "9900"
        }
      }
    ]
  }
}
```

> ⚠️ **重要**：每次扩容/缩容后会生成新的 `item_id`，需要通过查询接口或通知获取最新的 `item_id` 用于后续操作。

---

## 代码示例

### Go 示例：创建席位订阅

```go
// 创建席位商品
productResp, _ := alipayClient.CreateProduct(&service.ProductCreateRequest{
    Name:        "企业协作版会员",
    Description: "支持多席位协作，畅享全部高级功能",
    UnitLabel:   "席位",  // 席位场景必传
})

// 创建席位订阅
subResp, _ := alipayClient.CreateSubscription(&service.SubscriptionCreateRequest{
    CustomerId: customerID,
    Items: []service.SubscriptionItem{
        {
            PriceId:  priceID,
            Quantity: "100",  // 席位数量
        },
    },
    SubscribeTitle: "企业协作版-100席位月度订阅",
})
```

### Go 示例：席位扩容

```go
// 先查询获取当前的 item_id
queryResp, _ := alipayClient.QuerySubscription(&service.SubscriptionQueryRequest{
    CustomerId: customerID,
    SubscriptionStatus: "ACTIVE",
})
 currentItemID := queryResp.Subscriptions[0].Items[0].ItemId
 currentQuantity := queryResp.Subscriptions[0].Items[0].Quantity

// 扩容席位
modifyResp, _ := alipayClient.ModifySubscription(&service.SubscriptionModifyRequest{
    SubscriptionId:      subscriptionID,
    ModifyType:         "INCREASE_QUANTITY",
    PreserveBillingCycle: true,
    Items: []service.SubscriptionModifyItem{
        {
            ItemId:          currentItemID,
            SourceQuantity:  fmt.Sprintf("%d", currentQuantity),
            TargetQuantity:  "150",
        },
    },
    Description: "席位扩容：100->150",
})

// 正金额为支付并签约，零金额为仅签约；两种情况都要让用户打开返回链接
if modifyResp.AlipaySchema != "" {
    return gin.H{"pay_url": modifyResp.AlipaySchema}
}
```

### Go 示例：席位缩容

```go
// 缩容席位
modifyResp, _ := alipayClient.ModifySubscription(&service.SubscriptionModifyRequest{
    SubscriptionId: subscriptionID,
    ModifyType:     "DECREASE_QUANTITY",
    Items: []service.SubscriptionModifyItem{
        {
            ItemId:          currentItemID,
            SourceQuantity:  "100",
            TargetQuantity:  "80",
        },
    },
    Description: "席位缩容：100->80",
})

// 缩容返回确认链接（无需支付）
return gin.H{"confirm_url": modifyResp.AlipaySchema}
```

---

## 席位变更失败时

记录本次 `alipay.trade.subscription.modify` 的 `sub_code`、`sub_msg` 和请求号。[修改接口的错误表](https://aipay.alipay.com/docs/subscribe/api-list/individual-group-seat/subscription-modify.md)将参数不合法归为 `INVALID_PARAMETER`。按返回原因检查数量是否为正整数、源数量是否与生效项一致、目标数量是否满足变更方向，以及 `item_id` 是否来自最近一次查询或变更通知。再核对当前订阅状态、试用限制和实际产品额度。系统错误按该接口的重试说明处理。

## 常见问题

### Q1: quantity 支持 1 吗？

不需要。`quantity` 必须为正整数，`quantity=1` 也支持；只要商品配置了非空 `unit_label`，仍按席位订阅处理。

### Q2: 扩容后如何计费？

单独扩容按保持原周期办理。例如从 100 席扩到 150 席，系统计算差价时按新增的 50 席和本周期剩余天数比例折算。最终金额为 0 时只完成签约，不发生真实付款。

### Q3: 缩容后何时生效？

缩容后，当前已扣款周期保持原席位数量，下个周期起按新数量扣款。

### Q4: 如何获取最新的 item_id？

每次扩容/缩容后会生成新的 `item_id`，可通过以下方式获取：
1. 监听异步通知 `alipay.trade.subscription.changed`
2. 主动调用查询接口 `alipay.trade.subscription.query`

### Q5: 单位别名(unit_label)可以自定义吗？

`unit_label` 字段会展示在用户签约协议页面，受支付宝管控。接入前需要与支付宝业务确认传值，一般使用"席位"、"用户"等标准单位。

### Q6: 席位订阅可以使用试用期吗？

可以。免费和低价试用都支持；低价试用的 `pay_amount` 是全部席位的试用总价，正式续费按单价乘席位数量。试用期内不能独立扩容或缩容，但可以升级或降级套餐；降级确认后目标套餐和数量在 `trial_end` 生效。

### Q7: 套餐升降级时可以同时修改席位数量吗？

可以。使用 `UPGRADE` / `DOWNGRADE` 更换 `price_id` 时，`source_quantity` 和 `target_quantity` 可以同时传或同时不传；同时不传表示保持当前数量。操作类型决定生效时间，不由数量增加或减少决定。

### Q8: 有待生效降级时，撤销周期末取消会恢复哪个套餐？

恢复查询结果中当前 `items` 的套餐和数量，原 `pending_items` 同时失效。商家应在收到 `item_cancel_revert` 后重新查询并覆盖本地记录。

---

## 相关文档

- [API完整文档](api-complete.md) - 查看标准订阅接口
- [商品创建](api-product.md) - 商品创建/修改/查询详细参数
- [数据模型](data-model-reference.md) - 订阅状态、数据结构详解
- [代码示例](code-example-go.md) - Go语言完整实现

## 商家侧席位数量落库

### 5.1 席位数量管理

**建议**：
- 在数据库中同时保存当前 `item_id`、价格和 `quantity`
- 每次套餐升降级、扩容或缩容后，通过通知或查询保存最新值
- 业务逻辑中同时返回 `items` 和 `pending_items`，让用户了解当前和未来的价格及席位数量

**示例**：
```go
type Subscription struct {
    SubscriptionID string
    CustomerID     string
    ItemID         string  // 当前生效的 item_id
    Quantity       int     // 当前生效的席位数量
    PendingItemID  string  // 待生效的 item_id
    PendingQuantity int    // 待生效的席位数量
    PeriodEnd      time.Time
}

func (s *Subscription) GetCurrentQuantity() int {
    return s.Quantity
}

func (s *Subscription) GetNextPeriodQuantity() int {
    if s.PendingQuantity > 0 {
        return s.PendingQuantity
    }
    return s.Quantity
}
```

---
