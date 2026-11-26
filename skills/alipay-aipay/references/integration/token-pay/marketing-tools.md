# 营销工具包详细指南

> 文档来源：https://opendocs.alipay.com/ai-solution/0jg566.md
> 产品资料基线：2026-08-31；默认管控口径更新至 2026-09-03（2026-09-17 同步）

---

## 一、产品特色

**营销工具包** 为AI商户打造一站式营销解决方案，帮助商户快速获客、提升留存、增加转化。

### 核心功能

| **营销策略** | **场景案例** |
| :---: | :---: |
| 用户拉新 | 5元试用7天，后续订阅38元/月 |
| 老客留存 | 连续按月订阅享受8折优惠 |
| 人群优惠 | 通过学生认证后，享受5折优惠 |

### 当前使用限制

- 默认不支持试用期能力；已有试用能力的商户才可使用下方示例。产品已开通不代表自动获得试用准入，必须以商户控制台和实际接口准入结果为准。
- [商户默认管控规则](merchant-default-controls.md)下，普通正金额首次订阅购买需满足“首笔实际支付金额 x 3 >= 后续周期扣款金额”和 1.00 元下限；试用期和订阅升级不受 3 倍管控。不要将首次购买校验描述为所有营销场景的续费失败条件。

---

## 二、试用期订阅

普通首期优惠与试用期是不同方案：只想首期少收、后续恢复原价时，可以直接在普通立即生效订阅中传 `pay_amount`，无需设置试用期或创建优惠券。该字段不改变后续周期价格，单位为分，例如首期 18 元传 `1800`。规则及完整请求见 [创建订阅](api-complete.md#普通首期优惠与试用期) 和 [普通首期优惠示例](api-examples.md#普通首期优惠无试用期)。下文仅说明设置了试用期时的用法。

试用期创建按首笔实际支付金额区分准入：免费试用属于零元创建，需具备零元订阅准入；低价试用需具备试用期订阅准入。低价试用中，系统计算后的首笔实际支付金额不得低于 1.00 元（100 分）；试用期不受 3 倍管控。产品已开通或金额参数格式合法，都不等于已获得这些能力。

### 2.1 产品优势

**试用期** 为用户提供「先体验后付费」的订阅模式，支持免费试用。试用结束后，系统自动按原价续费，用户感知平滑，无需重新订阅。

**适用场景**：
- 新用户体验：降低首购决策门槛
- 新产品体验：引导用户体验新产品
- 季节性推广：限时免费试用活动

### 2.2 创建试用期订阅

**接口**：`alipay.trade.subscription.create`

**请求示例**（带试用期）：
```json
{
  "items": [
    {
      "price_id": "202603201234567889"
    }
  ],
  "customer_id": "MERCHANT_CUSTOMER_ID",
  "trial_period_days": 7,  // 试用期天数
  "trial_desc": "新用户 7 天免费试用",  // 试用期描述
  "metadata": "{\"channel\":\"app_store\"}"
}
```

**重要参数说明**：

| 参数 | 必填 | 说明 |
|-----|------|------|
| trial_period_days | 否 | 试用期天数（推荐3-7天，取值范围 3-365 天） |
| trial_desc | 否 | 试用期描述（签约页展示，最长 12 字符） |
| pay_amount | 否 | 自定义首笔实付金额，单位：分；在本节试用场景中表示试用期总价，并非试用期专用参数。具备零元订阅准入时，免费试用可不传或显式传 0；0 表示仅签约，正数表示支付并签约，负数非法 |

> ⚠️ **创建订阅的互斥约束**：`trial_period_days` 与 `coupon_id` 不能同时传入；`pay_amount` 与 `coupon_id` 不可同时传入；`quantity` 与 `coupon_id` 不可同时传入。
>
> 低价试用需具备试用期订阅准入。首笔实际支付金额为 0 时走仅签约链路，并按零元订阅准入校验；正金额必须至少为 1.00 元（100 分）；试用期不受 3 倍管控，不套用普通首次购买的最低金额公式。

**席位试用示例**：

```json
{
  "items": [{
    "price_id": "202603201234567889",
    "quantity": 10
  }],
  "customer_id": "MERCHANT_CUSTOMER_ID",
  "trial_period_days": 7,
  "trial_desc": "团队7天试用",
  "pay_amount": 500
}
```

席位试用支持免费和低价两种方式。低价试用的 `pay_amount=500` 表示全部 10 个席位的试用总价 5.00 元，不再乘以 `quantity`；试用结束后的周期扣款总额为价格单价乘席位数量。试用期内不支持独立扩容或缩容，但个体和席位的免费、低价试用均支持套餐降级；确认后当前套餐和数量继续使用到 `trial_end`，目标值从 `trial_end` 起生效。席位字段、套餐变更和查询规则见 [席位订阅 API 接入指南](seats.md)。

**响应示例**：
```json
{
  "code": "10000",
  "msg": "Success",
  "subscription_id": "SUB20260522002",
  "order_no": "2026052219600065896",
  "trial_start": "2026-05-22 10:00:00",
  "trial_end": "2026-05-29 10:00:00",
  "pay_amount": 0,  // 免费试用时响应返回0；低价试用时返回实际金额
  "alipay_jump_schema": "https://render.alipay.com/p/...",
  "alipay_schema": "https://qr.alipay.com/..."
}
```

### 2.3 试用期扣款策略

**默认扣款逻辑**：

| 时间点 | 动作 |
|-------|------|
| 试用期结束前一天 7–8 点 | 支付宝向用户发送扣款预通知 |
| 试用期到期当天 | 支付宝自动扣款 |
| 扣款失败 | 持续重试，直到扣款成功或试用期结束 |
| 试用期结束仍未扣款成功 | 解约订阅，不再扣款 |

> 扣款预通知是支付宝向**支付宝用户**发送的扣款提醒。非试用期订阅的周期扣款时机见下方「2.4 周期扣款时机（非试用期）」。

**用户取消试用期**：
- 用户可在试用期内随时取消订阅
- 取消后不产生任何费用

### 2.4 周期扣款时机（非试用期）

非试用期订阅的周期续费扣款同样由支付宝自动发起，节奏如下：

| 时间点 | 动作 |
|-------|------|
| 周期结束时间（`current_period_end`）提前 48 小时，且在 7–8 点之间 | 支付宝向用户发送「准备扣款」预通知 |
| 周期结束时间提前 24 小时 | 开始尝试扣款 |
| 扣款失败 | 自动重试，直至周期结束 |
| 周期结束仍未扣款成功 | 订阅取消 |

### 2.5 查询试用期状态

**接口**：`alipay.trade.subscription.query`

**请求示例**：
```json
{
  "subscription_id": "2026050800300499484",
  "customer_id": "MERCHANT_CUSTOMER_ID"
}
```

**响应示例**：
```json
{
  "code": "10000",
  "msg": "Success",
  "subscriptions": [{
    "subscription_id": "2026050800300499484",
    "subscription_status": "TRIALING",  // 试用期中
    "trial_start": "2026-05-08 10:43:31",
    "trial_end": "2026-06-07 23:59:59",
    "current_period_start": "2026-05-08 10:43:31",
    "current_period_end": "2026-06-07 23:59:59",
    "items": [{
      "item_id": "2026050800300546321",
      "price": {
        "unit_amount": "1",
        "recurring": {
          "interval": "MONTH",
          "interval_count": 1
        }
      }
    }]
  }]
}
```

**关键字段说明**：

| 字段 | 说明 |
|-----|------|
| subscription_status | `TRIALING` 表示试用期中 |
| trial_start | 试用期开始时间 |
| trial_end | 试用期结束时间 |

### 2.6 最佳实践

**试用期时长建议**：
- ✅ 推荐：3-7天，既能体验产品，又不会过长导致转化率下降
- ⚠️ 不推荐：超过30天，用户可能忘记使用，影响转化

**试用期描述建议**：
- ✅ "新用户 7 天免费试用"
- ✅ "限时体验，7天后自动续费"
- ⚠️ 不建议：过长或过于复杂的描述

**转化率优化**：
- 试用期第3天：发送产品引导邮件
- 试用期结束前一天 7–8 点：发送扣款预通知提醒
- 试用期结束当天：发送正式扣款通知

---

## 三、优惠券功能

### 3.1 优惠券类型

**折扣类型**：

| 类型 | 参数 | 说明 | 示例 |
|-----|------|------|------|
| 百分比折扣 | `percent_off` | 折扣百分比，取值 1-100 | 8折传20，7折传30 |
| 固定金额减免 | `amount_off` | 减免金额（单位：分），必须 > 0 | 立减10元传1000 |

> `percent_off` 与 `amount_off` 至少传一个；若同时传入，以 `amount_off` 优先生效。

**持续时间**：

| 持续时间 | 参数值 | 说明 | 适用场景 |
|---------|--------|------|---------|
| 一次性 | `once` | 仅首次扣款使用 | 新用户首购优惠 |
| 前N个周期 | `repeating` | 前N个周期使用 | 连续X月优惠 |
| 永久有效 | `forever` | 永久使用 | VIP用户专属折扣 |

### 3.2 创建优惠券

**接口**：`alipay.trade.promotion.coupon.create`

**请求示例**（百分比折扣-一次性）：
```json
{
  "request_info": {
    "name": "新用户首月8折",
    "percent_off": 20,  // 8折（减免20%）
    "duration": "once",  // 仅首次扣款使用
    "redeem_by": "2026-12-31 23:59:59"  // 兑换截止时间，必填
  }
}
```

**请求示例**（固定金额-前3个月）：
```json
{
  "request_info": {
    "name": "连续3月立减10元",
    "amount_off": 1000,  // 立减10元
    "duration": "repeating",  // 前N个周期使用
    "duration_in_iterations": 3,  // 前3个月
    "redeem_by": "2026-12-31 23:59:59"
  }
}
```

**请求示例**（永久折扣）：
```json
{
  "request_info": {
    "name": "VIP用户永久7折",
    "percent_off": 30,  // 7折
    "duration": "forever",  // 永久有效
    "redeem_by": "2099-12-31 23:59:59"
  }
}
```

> ⚠️ **参数约束**：
> - 优惠券字段统一包在 `request_info` 对象内传入；
> - `name` 必填，不超过 12 个字符；`redeem_by` 必填；
> - `duration_in_iterations`（持续周期数）仅 `duration="repeating"` 时必填且必须 > 0；`once`/`forever` 类型**不允许传入**，否则报参数错误；
> - `coupon_id` 可选传入自定义券编码（不超过 40 个字符），不传则系统自动生成；
> - `max_redemptions`（最大兑换次数）**当前版本暂不支持**：创建时固定为 0（不限制兑换次数），传入值会被忽略。

**响应示例**：
```json
{
  "code": "10000",
  "msg": "Success",
  "coupon_info": {
    "coupon_id": "9WJ36SEC",  // 优惠券ID，订阅时使用
    "name": "新用户首月8折",
    "percent_off": 20,
    "duration": "once",
    "redeem_by": "2026-12-31 23:59:59"
  }
}
```

### 3.3 使用优惠券

#### (1) 创建订阅时使用优惠券

**接口**：`alipay.trade.subscription.create`

**请求示例**：
```json
{
  "items": [
    {
      "price_id": "价格ID",
      "coupon_id": "优惠券ID"  // 使用优惠券
    }
  ],
  "customer_id": "客户ID",
  "subscribe_title": "AI会员专业版-首月8折"
}
```

#### (2) 修改订阅时使用优惠券

**接口**：`alipay.trade.subscription.modify`

修改订阅的用券规则与创建不同，按操作类型传参：

| 操作 | 携券时的 pay_amount | 券类型与生效规则 |
|------|-------------------|----------------|
| `UPGRADE` 升级 | 必须传，非负整数，单位为分 | 当次实付按指定金额执行，不再扣减券优惠 |
| `INCREASE_QUANTITY` 扩容 | 必须传，非负整数，单位为分 | 当次实付按指定金额执行，不再扣减券优惠 |
| `DOWNGRADE` 降级 | 禁止传入 | 下周期生效；只支持 `repeating` / `forever`，不支持一次性 `once` |
| `DECREASE_QUANTITY` 缩容 | 禁止传入 | 下周期生效；只支持 `repeating` / `forever`，不支持一次性 `once` |

**升级携券示例（当次支付 5 元）**：
```json
{
  "subscription_id": "订阅ID",
  "modify_type": "UPGRADE",
  "pay_amount": 500,
  "items": [
    {
      "item_id": "订阅项ID",
      "price_id": "新价格ID",
      "coupon_id": "优惠券ID"
    }
  ]
}
```

上例实付为 500 分，不再减去券面金额。升级/扩容携券且希望当次零元时，显式传 `pay_amount: 0`；最终金额为 0 时走仅签约链路，不发生真实付款；零元变更不要求零元创建准入。未携券时才可省略 `pay_amount` 让系统计算差价。接口成功不等于用户已完成支付或签约，仍以通知或查询确认变更结果。

**扩容携券示例（10 席扩到 15 席，当次支付 5 元）**：
```json
{
  "subscription_id": "订阅ID",
  "modify_type": "INCREASE_QUANTITY",
  "pay_amount": 500,
  "items": [{
    "item_id": "订阅项ID",
    "source_quantity": 10,
    "target_quantity": 15,
    "coupon_id": "优惠券ID"
  }]
}
```

**降级携券示例**：
```json
{
  "subscription_id": "订阅ID",
  "modify_type": "DOWNGRADE",
  "items": [{
    "item_id": "订阅项ID",
    "price_id": "目标价格ID",
    "coupon_id": "连续优惠或永久优惠券ID"
  }]
}
```

**缩容携券示例（15 席缩到 10 席）**：
```json
{
  "subscription_id": "订阅ID",
  "modify_type": "DECREASE_QUANTITY",
  "items": [{
    "item_id": "订阅项ID",
    "source_quantity": 15,
    "target_quantity": 10,
    "coupon_id": "连续优惠或永久优惠券ID"
  }]
}
```

降级/缩容示例中的券须为 `repeating` 或 `forever`；本次不付款，不传 `pay_amount`（包括 0），用户确认后下周期生效。不能把上述规则套用于创建订阅：创建时 `coupon_id` 仍分别与 `pay_amount`、`quantity`、`trial_period_days` 互斥。

### 3.4 查询优惠券

**接口**：`alipay.trade.promotion.coupon.query`

**请求示例**：
```json
{
  "coupon_id": "优惠券ID"
}
```

> `coupon_id` 不传时为批量查询，返回当前商户下全部**有效**优惠券；已删除（失效）的优惠券不会返回。

**响应示例**：
```json
{
  "code": "10000",
  "msg": "Success",
  "coupon_list": [
    {
      "coupon_id": "9WJ36SEC",
      "name": "新用户首月8折",
      "percent_off": 20,
      "duration": "once",
      "max_redemptions": "0",  // 最大兑换次数，当前版本固定为 0（不限制）
      "times_redeemed": "350",  // 已兑换次数
      "redeem_by": "2026-12-31 23:59:59"
    }
  ]
}
```

---

## 四、人群优惠

### 4.1 产品优势

**人群优惠** 支持基于身份识别的定价，如学生认证后享受专属折扣。

**核心能力**：
- 身份限定：只有满足条件的用户才能购买
- 时效控制：身份有效期后恢复原价
- 自动验证：支付宝自动验证用户身份

### 4.2 创建人群优惠价格

**接口**：`alipay.trade.price.create`

**请求示例**（学生优惠）：
```json
{
  "product_id": "商品ID",
  "unit_amount": 4900,  // 学生价：49元
  "recurring": {
    "interval": "MONTH",
    "interval_count": 1
  },
  "eligibility_type": "STUDENT",  // 限定身份：学生
  "eligibility_expire_time": "3m"  // 身份有效期：3个月
}
```

**重要参数说明**：

| 参数 | 说明 |
|-----|------|
| eligibility_type | 限定身份类型（当前仅支持 STUDENT） |
| eligibility_expire_time | 身份有效期，格式为正整数 + 单位 d/m（如 3m=3个月，3d=3天） |

> ⚠️ `eligibility_type` 和 `eligibility_expire_time` 必须同时传入或同时不传。另外价格创建的通用约束：`unit_amount` 单位为分且必须大于 0；`recurring.interval` 仅支持 `MONTH`/`DAY`，为 `DAY` 时 `interval_count` 不得小于 7。

**验签逻辑**：
- 用户购买时，支付宝自动验证身份
- 身份有效期内享受优惠价格
- 身份过期后恢复原价

### 4.3 使用人群优惠

用户购买时，支付宝自动验证身份：
- ✅ 身份验证通过：可购买优惠价格
- ❌ 身份验证失败：无法购买该价格，需选择其他价格

---

## 五、营销场景最佳实践

### 5.1 新用户拉新

**策略**：按业务需要选择试用期、首月优惠券，或普通订阅自定义首笔金额。

**步骤**：
1. 方式一：创建7天试用期订阅（不传优惠券）
2. 方式二：创建首月5折优惠券，用户订阅时使用
3. 方式三：普通立即生效订阅传 `pay_amount`，实现首期少收、后续按原价续费，见 [普通首期优惠示例](api-examples.md#普通首期优惠无试用期)。
4. 注意：`coupon_id` 分别与 `trial_period_days`、`pay_amount` 互斥；`trial_period_days` 和 `pay_amount` 可以组合表达低价试用。普通首期优惠适用普通创建金额管控，试用需相应准入。

**代码示例**（方式一：试用期）：
```json
{
  "items": [
    {
      "price_id": "价格ID"
    }
  ],
  "customer_id": "客户ID",
  "trial_period_days": 7,
  "trial_desc": "7天免费试用"
}
```

**代码示例**（方式二：首月优惠券）：
```json
{
  "items": [
    {
      "price_id": "价格ID",
      "coupon_id": "首月5折优惠券ID"
    }
  ],
  "customer_id": "客户ID"
}
```

**效果**：
- 方式一：用户先免费试用7天，试用期结束后按原价自动扣款
- 方式二：用户首月5折，第2个月起恢复原价
- 方式三：例如价格 30 元/月、`pay_amount=1800`，首期支付 18 元，后续每月 30 元；不设置试用期，也不使用优惠券。

### 5.2 老客留存

**策略**：连续订阅优惠

**步骤**：
1. 创建连续3个月8折优惠券
2. 老用户续费时发送优惠券
3. 用户使用优惠券续费

**代码示例**：
```json
{
  "request_info": {
    "name": "老用户连续3月8折",
    "percent_off": 20,
    "duration": "repeating",
    "duration_in_iterations": 3,
    "redeem_by": "2026-12-31 23:59:59"
  }
}
```

**效果**：
- 用户连续3个月享受8折优惠
- 提高续费率，延长用户生命周期

### 5.3 学生专属优惠

**策略**：人群优惠 + 试用期

**步骤**：
1. 创建学生专属价格（5折）
2. 创建学生专属7天试用期
3. 学生购买时自动验证身份

**代码示例**：
```json
{
  "product_id": "商品ID",
  "unit_amount": 4900,  // 学生价
  "recurring": {"interval": "MONTH", "interval_count": 1},
  "eligibility_type": "STUDENT",
  "eligibility_expire_time": "12m"  // 学生身份有效期1年
}
```

**效果**：
- 学生身份验证后享受5折优惠
- 身份有效期1年，到期后需重新验证

### 5.4 阶梯折扣策略

**策略**：不同周期不同折扣

**步骤**：
1. 创建多个优惠券（不同周期不同折扣）
2. 根据用户订阅时长发放对应优惠券
3. 订阅升级时使用优惠券

**用户分层**：
- 新用户：首月5折
- 1-3个月用户：连续3个月8折
- 3-6个月用户：连续6个月7折
- 6个月以上用户：永久6折

---

## 六、常见问题

**Q1: 试用期可以设置多长？**
A: 推荐3-7天，取值范围 3-365 天

**Q2: 试用期结束后如何扣款？**
A: 试用期结束前一天 7–8 点发送扣款预通知，到期当天自动扣款；非试用期订阅则是周期结束前 48 小时（7–8 点间）发预通知、前 24 小时开始扣款

**Q3: 优惠券可以叠加使用吗？**
A: 不可以，每次只能使用一个优惠券

**Q4: 人群优惠如何验证身份？**
A: 支付宝自动验证用户身份，无需商户开发验证逻辑

**Q5: 优惠券过期后还能使用吗？**
A: 不能，过期后优惠券自动失效

**Q6: 如何查看优惠券使用情况？**
A: 调用 `alipay.trade.promotion.coupon.query` 查询已兑换次数

**Q7: 试用期用户取消订阅会影响扣款吗？**
A: 不会，试用期内取消订阅不产生任何费用

**Q8: 参数合法但试用订阅仍创建失败怎么办？**
A: 免费试用先确认零元订阅准入，低价试用确认试用期订阅准入；默认不支持试用，已获准的正金额试用确认系统计算后的首笔实际支付金额至少为 1.00 元；试用期不受 3 倍管控。不要通过更换客户ID或拆分请求绕过。

---

## 七、错误处理

| 错误码 | 说明 | 解决方案 |
|-------|------|---------|
| COUPON_NOT_FOUND | 优惠券不存在 | 检查 coupon_id 是否正确 |
| COUPON_EXPIRED | 优惠券已过期 | 创建新的优惠券 |
| COUPON_ALREADY_USED | 优惠券已达使用上限 | 创建新优惠券 |
| COUPON_NOT_VALID | 优惠券状态无效（已删除/失效） | 检查优惠券状态或创建新优惠券 |
| ELIGIBILE_TYPE_MISMATCH | 身份验证失败 | 用户身份不满足优惠条件 |
| INVALID_TRIAL_PERIOD | 试用期天数无效 | 确保 trial_period_days 在 3-365 之间 |

---

## 八、相关接口

- [优惠券创建接口](https://opendocs.alipay.com/solution/alipay.trade.promotion.coupon.create.md)
- [优惠券查询接口](https://opendocs.alipay.com/solution/alipay.trade.promotion.coupon.query.md)
- [订阅创建接口](https://opendocs.alipay.com/solution/7a8012f1_alipay.trade.subscription.create.md)
- [订阅修改接口](https://opendocs.alipay.com/solution/6cd02c10_alipay.trade.subscription.modify.md)
- [价格创建接口](https://opendocs.alipay.com/solution/5a02644d_alipay.trade.price.create.md)
