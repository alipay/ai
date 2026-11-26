# API 请求示例大全

本文档提供请求格式和响应示例。含生产网关的 HTTP/cURL 报文只供代码对照；实际联调按[订阅沙箱](sandbox/sandbox-integration.md)使用同一沙箱的网关、应用和资源，或在本地模拟。

## 通用说明

### 公共请求参数

每个接口都需要以下公共参数：

| 参数 | 说明 | 示例值 | 位置 |
|-----|------|-------|------|
| app_id | 应用ID | YOUR_APP_ID | URL Query |
| method | 接口名称 | alipay.trade.product.create | URL Query |
| format | 返回格式 | JSON | URL Query |
| charset | 编码 | UTF-8 | **URL Query（必须！）** |
| sign_type | 签名算法 | RSA2 | URL Query |
| timestamp | 请求时间 | 2026-04-08 17:00:00 | URL Query |
| version | 版本 | 1.0 | URL Query |
| sign | 签名 | （根据参数生成） | URL Query |
| biz_content | 业务参数 | （JSON字符串） | **POST Body** |

> ⚠️ **重要**：`charset` 参数必须放在 URL Query 中，不能放在 POST Body 中。否则会导致签名验证失败和响应乱码。

### 完整请求格式

```
POST https://openapi.alipay.com/gateway.do?app_id=YOUR_APP_ID&method=alipay.trade.product.create&format=JSON&charset=UTF-8&sign_type=RSA2&timestamp=2026-04-08+17%3A00%3A00&version=1.0&sign=xxx HTTP/1.1
Content-Type: application/x-www-form-urlencoded

biz_content=%7B%22name%22%3A%22AI%E4%BC%9A%E5%91%98%E4%B8%93%E4%B8%9A%E7%89%88%22%2C%22metadata%22%3A%22%7B%5C%22default%5C%22%3A%5C%22default%5C%22%7D%22%7D
```

---

## 一、商品管理

### 1.1 创建商品 (alipay.trade.product.create)

**请求参数**：
```json
{
  "name": "AI会员专业版",
  "description": "包含GPT-4、DALL-E等高级功能",
  "metadata": "{\"default\":\"default\"}",
  "images": "[\"https://example.com/pro.png\"]",
  "marketing_features": "[\"无限对话\",\"优先响应\"]",
  "url": "https://example.com/pro"
}
```

**响应示例**：
```json
{
  "alipay_trade_product_create_response": {
    "code": "10000",
    "msg": "Success",
    "product_id": "202603230010000006783"
  },
  "sign": "ERITJKEIJKJHKKKKKKKHJEREEEEEEEEEEE"
}
```

**cURL 示例**：
```bash
# 正确格式：公共参数在 URL Query，biz_content 在 POST Body
curl -X POST 'https://openapi.alipay.com/gateway.do?app_id=YOUR_APP_ID&method=alipay.trade.product.create&format=JSON&charset=UTF-8&sign_type=RSA2&timestamp=2026-04-08+17%3A00%3A00&version=1.0&sign=xxx' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'biz_content={"name":"AI会员专业版","description":"包含GPT-4等高级功能","metadata":"{\"default\":\"default\"}"}'
```

---

### 1.2 查询商品 (alipay.trade.product.query)

**请求参数**：
```json
{
  "product_id": "202603230010000006783"
}
```

**响应示例**：
```json
{
  "alipay_trade_product_query_response": {
    "code": "10000",
    "msg": "Success",
    "product_list": [
      {
        "id": "202603230010000006783",
        "name": "AI会员专业版",
        "description": "包含GPT-4、DALL-E等高级功能",
        "active": true,
        "default_price_id": "202603230010000007888",
        "metadata": "{\"default\":\"default\"}",
        "gmt_create": "2026-03-23 10:00:00"
      }
    ],
    "page_num": 1,
    "page_size": 1,
    "total": 1,
    "pages": 1
  },
  "sign": "xxx"
}
```

> 商品查询响应为分页列表结构：商品信息在 `product_list` 数组中返回（按 product_id 查询单个商品时数组仅含 1 条），并附带 `page_num` / `page_size` / `total` / `pages` 分页信息。

---

## 二、价格管理

### 2.1 创建价格 (alipay.trade.price.create)

**请求参数**：
```json
{
  "unit_amount": 9900,
  "product_id": "202603230010000006783",
  "recurring": {
    "interval": "MONTH",
    "interval_count": 1
  },
  "metadata": "{\"default\":\"default\"}"
}
```

**年付价格示例（不符合默认管控）**：下例的 999 元和 12 个月分别超出默认价格、周期上限，仅用于理解字段；未确认实际已调整相应能力时，不得直接用于接入。完整边界见[商户默认管控规则](merchant-default-controls.md)。

字段表达：`recurring.interval` 仅支持 DAY/MONTH，年付用 MONTH × 12 表达。
```json
{
  "unit_amount": 99900,
  "product_id": "202603230010000006783",
  "recurring": {
    "interval": "MONTH",
    "interval_count": 12
  },
  "metadata": "{\"default\":\"default\"}"
}
```

> ⚠️ `interval` 仅支持 `DAY` 和 `MONTH`，传 WEEK/YEAR 等其他值会报参数错误；`interval=DAY` 时 `interval_count` 不得小于 7。

**响应示例**：
```json
{
  "alipay_trade_price_create_response": {
    "code": "10000",
    "msg": "Success",
    "price_id": "202603230010000007888",
    "product_id": "202603230010000006783"
  },
  "sign": "xxx"
}
```

---

### 2.2 查询价格 (alipay.trade.price.query)

**请求参数**：
```json
{
  "price_id": "202603230010000007888",
  "query_options": ["product"]
}
```

**响应示例**：
```json
{
  "alipay_trade_price_query_response": {
    "code": "10000",
    "msg": "Success",
    "id": "202603230010000007888",
    "active": true,
    "product_id": "202603230010000006783",
    "unit_amount": 9900,
    "type": "recurring",
    "recurring": {
      "interval": "MONTH",
      "interval_count": 1
    },
    "product": {
      "id": "202603230010000006783",
      "name": "AI会员专业版"
    }
  },
  "sign": "xxx"
}
```

---

## 三、客户管理

### 3.1 创建客户 (alipay.trade.customer.create)

**请求参数**：
```json
{
  "name": "张三",
  "phone": "YOUR_CUSTOMER_PHONE",
  "email": "zhangsan@example.com",
  "description": "通过官网注册"
}
```

> ⚠️ `phone` 和 `email` 至少传一个

**响应示例**：
```json
{
  "alipay_trade_customer_create_response": {
    "code": "10000",
    "msg": "Success",
    "customer_id": "MERCHANT_CUSTOMER_ID"
  },
  "sign": "xxx"
}
```

---

## 四、订阅管理

### 4.1 创建订阅 (alipay.trade.subscription.create)

**请求参数**：
```json
{
  "customer_id": "MERCHANT_CUSTOMER_ID",
  "items": [
    {
      "price_id": "202603230010000007888"
    }
  ],
  "subscribe_title": "AI会员专业版-月度订阅"
}
```

> ⚠️ `items` 必须是数组格式，每个元素包含 `price_id`

**响应示例**：
```json
{
  "alipay_trade_subscription_create_response": {
    "code": "10000",
    "msg": "Success",
    "subscription_id": "202603230010000001234",
    "pay_amount": 9900,
    "alipay_schema": "alipays://..."
  },
  "sign": "xxx"
}
```

#### 普通首期优惠（无试用期）

目标：首期 18 元，后续每月 30 元。先准备 `unit_amount=3000`、`recurring.interval=MONTH`、`recurring.interval_count=1` 的循环价格（均指个体订阅，不传 `quantity`），然后调用 `alipay.trade.subscription.create`，`biz_content` 如下：

```json
{
  "customer_id": "YOUR_CUSTOMER_ID",
  "items": [
    { "price_id": "YOUR_MONTHLY_30_YUAN_PRICE_ID" }
  ],
  "pay_amount": 1800,
  "subscribe_title": "AI会员专业版-月度订阅"
}
```

这里不传 `trial_period_days` 或 `coupon_id`，按普通立即生效订阅处理。`pay_amount` 只指定首笔 18 元，价格方案仍为每月 30 元，后续在未变更订阅时按该价格续费。金额单位为分，不能把 `pay_amount=18` 当作 18 元。

按普通创建默认规则，18 元不低于 1 元，且 `18 × 3 = 54 ≥ 30`，满足这两项金额限制；这不代表其他商户准入和参数检查自动通过。一次性优惠券也可表达首期优惠，但与 `pay_amount` 互斥，并非此场景必需步骤。

#### 试用期与零元创建

**带试用期订阅示例**：
```json
{
  "customer_id": "MERCHANT_CUSTOMER_ID",
  "items": [
    {"price_id": "202603230010000007888"}
  ],
  "trial_period_days": 7,
  "trial_desc": "新用户7天免费试用",
  "subscribe_title": "AI会员专业版-试用"
}
```

> ⚠️ `items` 目前**只支持单个订阅项**，传多个会报错。`trial_period_days` 为 3-365 正整数，`trial_desc` 最大 12 字符。该示例未传 `pay_amount`，属于免费试用，需具备零元订阅准入；低价试用需传正数金额并具备试用期订阅准入。

**席位低价试用示例**：
```json
{
  "customer_id": "MERCHANT_CUSTOMER_ID",
  "items": [{
    "price_id": "202603230010000007888",
    "quantity": 10
  }],
  "trial_period_days": 7,
  "trial_desc": "团队7天试用",
  "pay_amount": 500,
  "subscribe_title": "企业协作版-10席位试用"
}
```

`quantity` 与 `trial_period_days` 可以同时传。这里的 `pay_amount=500` 是全部 10 个席位的试用总价 5.00 元，不再乘以数量；正式续费按价格单价乘席位数量。试用期内不支持独立扩容或缩容，但免费和低价试用均可升级或降级套餐。

**零元仅签约示例**：
```json
{
  "customer_id": "MERCHANT_CUSTOMER_ID",
  "items": [
    {"price_id": "202603230010000007888"}
  ],
  "pay_amount": 0,
  "subscribe_title": "AI会员专业版-零元首期"
}
```

具备零元订阅准入时，`pay_amount=0` 只完成签约，不发生首笔真实付款；正数进入支付并签约，负数会被拒绝。金额非负不代表业务准入必然通过；普通正金额首次订阅购买的系统计算后的首笔实际支付金额必须至少为 1.00 元（100 分），且满足“首笔实际支付金额 x 3 >= 后续周期扣款金额”。默认不支持试用期；已获准的试用期不受 3 倍管控，正金额试用仍核对 1.00 元下限，完整默认限制见[商户默认管控规则](merchant-default-controls.md)。周期订阅使用商家扣款时，每个商家累计新签用户数的默认上限为 5000，达到上限后需申请扩容。

**未来生效订阅示例**：
```json
{
  "customer_id": "MERCHANT_CUSTOMER_ID",
  "items": [
    {"price_id": "202603230010000007888"}
  ],
  "effective_type": "SCHEDULED_EFFECTIVE",
  "scheduled_effective_time": "2026-08-31",
  "deduct_type": "SUBSCRIBE_DEDUCT",
  "subscribe_title": "AI会员专业版-未来生效"
}
```

未来生效禁止显式传 `pay_amount`，包括 0；创建日由系统生成技术零元签约流程，因此实际调用商户仍需具备零元订阅准入。完整约束见 [未来生效订阅接入指南](scheduled-effective.md)。


### 4.2 查询订阅 (alipay.trade.subscription.query)

**按订阅ID查询**：
```json
{
  "subscription_id": "202603230010000001234"
}
```

**按客户查询所有订阅**：
```json
{
  "customer_id": "MERCHANT_CUSTOMER_ID"
}
```

**按状态筛选**：
```json
{
  "customer_id": "MERCHANT_CUSTOMER_ID",
  "subscription_status": "ACTIVE"
}
```

**响应示例**：
```json
{
  "alipay_trade_subscription_query_response": {
    "code": "10000",
    "msg": "Success",
    "subscriptions": [
      {
        "subscription_id": "202603230010000001234",
        "customer_id": "MERCHANT_CUSTOMER_ID",
        "subscription_status": "ACTIVE",
        "current_period_start": "2026-03-23 10:30:00",
        "current_period_end": "2026-04-23 10:30:00",
        "cancel_at_period_end": false,
        "items": [
          {
            "item_id": "ITEM_001",
            "quantity": 100,
            "price": {
              "id": "PRICE_ENTERPRISE_STANDARD",
              "unit_amount": "9900",
              "recurring": {
                "interval": "MONTH",
                "interval_count": 1
              }
            }
          }
        ],
        "pending_items": [
          {
            "item_id": "ITEM_002",
            "quantity": 80,
            "price": {
              "id": "PRICE_ENTERPRISE_PRO",
              "unit_amount": "12900"
            }
          }
        ]
      }
    ]
  },
  "sign": "xxx"
}
```

---

### 4.3 修改订阅 (alipay.trade.subscription.modify)

**升级订阅**（默认 UPGRADE，立即生效，补差价）：
```json
{
  "subscription_id": "202603230010000001234",
  "modify_type": "UPGRADE",
  "pay_amount": 500,
  "preserve_billing_cycle": true,
  "items": [
    {
      "item_id": "订阅项ID",
      "price_id": "PRICE_ENTERPRISE_001",
      "coupon_id": "优惠券ID"
    }
  ],
  "description": "升级到企业版"
}
```

> 升级/扩容的最终金额必须 **大于等于 0**。它们不适用创建订阅时的 1.00 元最低首笔金额或 1/3 比例规则，因此不能仅因本次变更金额低于后续续费金额的 1/3 就判断请求会失败。最终金额为 0 时仅签约，正数时支付并签约，负数会被拒绝；零元升级/扩容不要求零元创建准入。不携券时可不传 `pay_amount` 由系统计算差额，也可传非负金额覆盖；携券时必须同时传非负 `pay_amount`，当次实付按该金额执行，不再扣减券优惠。上例 `500` 表示本次支付 5 元。降级/缩容也可携券，但不能传 `pay_amount`，且不支持一次性券。如实际调用另有业务拦截，以接口返回和正式接入资料为准。

**席位套餐升级并同步修改数量**：
```json
{
  "subscription_id": "202603230010000001234",
  "modify_type": "UPGRADE",
  "preserve_billing_cycle": true,
  "items": [{
    "item_id": "ITEM_001",
    "price_id": "PRICE_ENTERPRISE_PRO",
    "source_quantity": 100,
    "target_quantity": 80
  }],
  "description": "切换专业版并调整为80席"
}
```

`source_quantity` 与 `target_quantity` 要么同时传、要么同时不传；同时不传表示保持当前数量，同时传时源数量必须等于当前 `items.quantity`。`UPGRADE` 立即生效并计算整单差价；同样字段配合 `DOWNGRADE` 时下周期生效且本次不收费，目标项位于 `pending_items`。免费和低价试用也支持 `DOWNGRADE`，目标套餐和数量在 `trial_end` 生效。操作类型决定生效时机，不根据数量方向推断；仅改数量时继续使用 `INCREASE_QUANTITY` / `DECREASE_QUANTITY`。修改完成或生效后保存最新 `item_id`、价格和数量。

**升级响应示例**：
```json
{
  "alipay_trade_subscription_modify_response": {
    "code": "10000",
    "msg": "Success",
    "subscription_id": "202603230010000001234",
    "pay_amount": 50000,
    "alipay_schema": "alipays://..."
  },
  "sign": "xxx"
}
```

> 升级时如果需要补差价，响应中会包含 `pay_amount` 和 `alipay_schema`

**取消订阅**：
```json
{
  "subscription_id": "202603230010000001234",
  "modify_type": "CANCEL",
  "cancel_at_period_end": true
}
```

> `modify_type` 必须传 `CANCEL`，否则不传会被视为 UPGRADE。`cancel_at_period_end: true` 表示周期结束后失效（CANCEL 场景），用户可继续使用到当前周期结束；`false` 表示立即取消并发起退款。

**撤销周期末取消（REVERT_CANCEL）**：

```json
{
  "subscription_id": "202603230010000001234",
  "modify_type": "REVERT_CANCEL",
  "cancel_at_period_end": false
}
```

```json
{
  "alipay_trade_subscription_modify_response": {
    "code": "10000",
    "msg": "Success",
    "subscription_id": "202603230010000001234",
    "alipay_schema": "alipays://...",
    "alipay_jump_schema": "https://..."
  },
  "sign": "xxx"
}
```

响应中的入口用于让用户重新确认签约，不是新订阅链接，`subscription_id` 不变。PC 端通常将入口展示成二维码供用户扫码，移动端可直接拉起支付宝。接口返回 `10000` 只表示签约入口生成成功；收到 `change_type=item_cancel_revert` 或主动查询确认后，才能认为撤销取消成功。已经进入 `CANCELED` 的订阅不能通过 `REVERT_CANCEL` 恢复。

---

## 五、异步通知

### 5.1 订阅变更通知 (alipay.trade.subscription.changed)

支付宝主动推送到应用网关的通知格式：

```
POST /api/alipay/notify HTTP/1.1
Content-Type: application/x-www-form-urlencoded

notify_type=subscription_status_change&notify_time=2026-04-08+17%3A30%3A00&notify_id=xxx&...&sign=xxx
```

**通知参数**：
```json
{
  "notify_type": "subscription_status_change",
  "notify_time": "2026-04-08 17:30:00",
  "notify_id": "2026040800123456",
  "change_type": "active",
  "change_date": "2026-04-08 17:30:00",
  "trade_no": "2026040822001401234567890",
  "pay_amount": "9900",
  "subscription": "{\"subscription_id\":\"202603230010000001234\",\"subscription_status\":\"ACTIVE\"}"
}
```

**change_type 枚举**：

| 值 | 说明 |
|-----|------|
| active | 订阅已生效（含试用期转正式） |
| trialing | 试用期订阅生效 |
| period_extend | 订阅续费成功 |
| item_update | 订阅项目更新成功（升级/席位扩容） |
| item_downgrade | 订阅降级/席位缩容成功（下周期生效） |
| cancel | 订阅已取消 |
| cancel_at_period_end | 订阅已设置周期结束后取消 |
| item_cancel_revert | 撤销取消成功 |

**响应要求**：
```
HTTP/1.1 200 OK
Content-Type: text/plain

success
```

> ⚠️ 必须返回 `success`，不能有换行和空格

---

## 六、完整业务流程示例

### 首次订阅流程

```
步骤1: 创建商品
POST alipay.trade.product.create
→ product_id: PROD_001

步骤2: 创建价格
POST alipay.trade.price.create
{
  "product_id": "PROD_001",
  "unit_amount": 9900,
  "recurring": {"interval": "MONTH", "interval_count": 1}
}
→ price_id: PRICE_001

步骤3: 创建客户（用户注册时）
POST alipay.trade.customer.create
{
  "name": "张三",
  "phone": "YOUR_CUSTOMER_PHONE"
}
→ customer_id: CUST_001

步骤4: 创建订阅（用户点击订阅）
POST alipay.trade.subscription.create
{
  "customer_id": "CUST_001",
  "items": [{"price_id": "PRICE_001"}]
}
→ subscription_id: SUB_001
→ alipay_schema: alipays://...（跳转支付）

步骤5: 用户扫码支付

步骤6: 接收异步通知
POST /api/alipay/notify
change_type: active
→ 更新本地订阅状态为 ACTIVE

步骤7: 开通权益
```

### 升级订阅流程

```
步骤1: 创建新商品和价格
→ new_price_id: PRICE_ENTERPRISE

步骤2: 修改订阅
POST alipay.trade.subscription.modify
{
  "subscription_id": "SUB_001",
  "items": [{"price_id": "PRICE_ENTERPRISE"}]
}
→ pay_amount: 50000（差价）
→ alipay_schema: ...（补差价支付链接）

步骤3: 用户支付差价

步骤4: 接收异步通知
change_type: item_update
→ 更新本地订阅信息
```

### 4.6 预计退款金额查询 (alipay.trade.subscription.estimatedrefund.query)

取消订阅前预估可退金额。

**请求示例**：
```json
{
  "subscription_id": "SUB20260522002",
  "customer_id": "MERCHANT_CUSTOMER_ID"
}
```

**成功响应 - 可退款（ACTIVE）**：
```json
{
  "alipay_trade_subscription_estimatedrefund_query_response": {
    "code": "10000",
    "msg": "Success",
    "subscription_id": "SUB20260522002",
    "subscription_status": "ACTIVE",
    "refundable": true,
    "estimated_refund_amount": 6600
  }
}
```

**成功响应 - 不可退款（非 ACTIVE）**：
```json
{
  "alipay_trade_subscription_estimatedrefund_query_response": {
    "code": "10000",
    "msg": "Success",
    "subscription_id": "SUB20260522002",
    "subscription_status": "CANCELED",
    "refundable": false
  }
}
```

> 仅 ACTIVE 状态返回 `refundable=true` 及 `estimated_refund_amount`（单位：分），其他状态不返回金额。
