# 单笔支付接入指南

交付时按实际工程改动和验证结果说明接入进展，并注明验证是在本地模拟环境还是产品允许的非生产环境。

商业订单按本页契约创建、查单和处理通知；与网页基础收款是不同的接入路径。本 Skill 优先在商家工程使用模拟回执验证；仅在该能力已有明确、授权的非生产环境时联调。周期订阅测试时钟不能验证商业订单；不在生产创建订单、退款或付款。

> **产品定位**：单笔支付（订单类型 `ONE_TIME`）面向一次性商品/服务的收款场景（单次购买、按量付费结算等），与周期订阅（`SUBSCRIPTION`）并列。本文基于支付宝**商业订单（收银）开放能力**，提供订单创建 / 查询 / 关闭 / 批量退款查询。
---

## 📌 接入概述

本能力对外提供 4 个 OpenAPI 接口，覆盖商业订单创建 / 查询 / 关闭 / 批量退款查询。直连网关采用 **HTTP POST**：公共参数按网关规范传递，业务 JSON 放入 `biz_content`，响应为网关标准 JSON 包裹。

| 接口名称 | 接口方法（method） | 说明 |
|---------|----------------|------|
| 创建商业订单 | `alipay.trade.commercial.order.create` | 创建一笔商业订单并返回收银台链接 / 二维码 / 支付页 URL |
| 查询商业订单 | `alipay.trade.commercial.order.query` | 根据订单号查询订单详情 |
| 关闭商业订单 | `alipay.trade.commercial.order.close` | 关闭未支付订单 |
| 查询批量退款 | `alipay.trade.commercial.batchrefund.query` | 根据业务批次号查询批量退款结果 |

---

## 📐 公共约定

### 通用响应结构

直连网关响应为支付宝网关标准包裹：业务字段在内层 `alipay_trade_*_response` 对象中，并带 `code` / `msg` / `sub_code` / `sub_msg` 与外层 `sign`。

```json
{
  "alipay_trade_commercial_order_create_response": {
    "code": "10000",
    "msg": "Success",
    "order_no": "...",
    "checkout_url": "..."
  },
  "sign": "..."
}
```

- **成功**：内层 `code == "10000"`
- **失败**：内层 `code != "10000"`；同时读取 `sub_code` / `sub_msg`，不要假定所有失败都固定为某一个 `code`

> 包裹键由 `method` 推导：`alipay.trade.commercial.order.create` → `alipay_trade_commercial_order_create_response`（点转下划线 + `_response` 后缀）。

### 身份与归属校验

调用身份由 OpenAPI 公共参数和请求签名确定，`biz_content` 中无需重复传入商户身份信息。接口会校验资源与当前调用商户的归属关系；出于数据隔离，跨商户请求可能按“不存在”或参数错误处理，不要依赖单一错误码判断资源是否真实存在。

### 金额与时间约定

- 金额字段：创建请求 `order_amount` 单位为**分**（Long），当前按每件单价再乘 `quantity`；返回 `total_amount`、`refund_amount` 等单位为**元**，保留 2 位小数。完整规则见 [商业订单创建接口](api-commercial-order-create.md)。
- 时间字段：订单/批次相关时间为标准日期；`pay_time` 默认为 **Unix 毫秒时间戳（字符串）**，部分商户返回 `yyyy-MM-dd HH:mm:ss` 格式。

### 订单状态 `status`

| 取值 | 说明 | 是否终态 |
|------|------|---------|
| `PRE_CREATED` | 预创建（金额为 0，待确认后创建真实订单） | 否 |
| `PENDING_PAY` | 待支付 | 否 |
| `PAID` | 已支付 | 否 |
| `REFUNDED` | 已退款 | 是 |
| `CLOSED` | 已关闭 | 是 |
| `COMPLETED` | 已完成 | 是 |

> 状态流转：`PRE_CREATED → PENDING_PAY → PAID → COMPLETED`；`PENDING_PAY → CLOSED`；`PAID → REFUNDED`。

### UI 展示模式 `ui_mode`

| 取值 | 说明 | 创建订单返回内容 |
|------|------|-----------------|
| `HOSTED`（默认） | 收银台模式 | `checkout_url` + `expire_time` |
| `QR_CODE` | 二维码模式 | `qr_code` |
| `PAGE` | 页面支付模式 | `checkout_url`（支付 URL） |
| `APP_SCHEMA` | 支付宝 App 支付入口 | `alipay_schema` + `alipay_jump_schema` |

> 模式专有字段按分支返回。`page_code` 路径仅支持 `HOSTED`；其他三种模式仅支持 `price_id` 路径。完整矩阵见 [商业订单创建接口](api-commercial-order-create.md)。

---

## 一、创建商业订单

**接口方法**：`alipay.trade.commercial.order.create`

创建前必须先区分两条路径：

`price_id` 直建是本指南的单笔支付主路径：商家在调用接口前已经确定一个不带 `recurring` 的单次价格，传入该 `price_id` 后直接创建一笔固定价格的支付订单，用户不经过价格表选价。`page_code` 则是低代码订阅价格表入口，不是另一种单笔支付写法。

| 路径 | 最小参数 | 服务端确定的订单类型与初始状态 | UI 模式 |
|---|---|---|---|
| 单笔支付直建 | `customer_id` + `price_id` | `ONE_TIME` + `PENDING_PAY` | `HOSTED` / `QR_CODE` / `PAGE` / `APP_SCHEMA` |
| 订阅价格表入口 | `customer_id` + `page_code` | `SUBSCRIPTION` + `PRE_CREATED` | 仅 `HOSTED` |

`order_type` 不负责选路且会被服务端覆盖，生成请求时省略。调用方应只传 `price_id` 或 `page_code` 其中一个。直建 Hosted 页面与价格表 Hosted 页面各自从创建、打开 `checkout_url` 到回跳的完整流程，以及字段条件、灵活定价、企业支付、返回矩阵和幂等要求，必须完整读取 [商业订单创建接口](api-commercial-order-create.md)，不得仅凭本节摘要生成代码。

### 1.1 最小请求示例（`price_id` + `HOSTED`）

```json
{
  "customer_id": "YOUR_CUSTOMER_ID",
  "price_id": "YOUR_ONE_TIME_PRICE_ID",
  "ui_mode": "HOSTED",
  "redirect_url": "https://merchant.example/return"
}
```

`redirect_url` 仅在需要支付后回到商家页面时传入，不需要回跳时可省略。

### 1.2 响应示例（网关标准包裹）

```json
{
  "alipay_trade_commercial_order_create_response": {
    "code": "10000",
    "msg": "Success",
    "order_no": "YOUR_ORDER_NO",
    "order_type": "ONE_TIME",
    "status": "PENDING_PAY",
    "checkout_url": "RETURNED_CHECKOUT_URL",
    "expire_time": "RETURNED_EXPIRE_TIME"
  },
  "sign": "RETURNED_SIGN"
}
```

### 1.3 常见错误码

`INVALID_PARAMETER`、`PRICE_NOT_FOUND`、`CUSTOMER_NOT_FOUND`、`QR_CODE_GENERATE_FAILED`、`APP_SCHEMA_GENERATE_FAILED`、`SYSTEM_ERROR`

> `price_id` 路径当前只创建 `ONE_TIME` 订单；循环价格会返回 `INVALID_PARAMETER` 和 `recurring price not support`。`page_code` 路径则先创建 `SUBSCRIPTION/PRE_CREATED` 价格表预订单，不能把两条路径混为一谈。

---

## 二、查询商业订单

**接口方法**：`alipay.trade.commercial.order.query`

### 2.1 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `order_no` | String | 是 | 订单编号 |

### 2.2 响应业务字段（内层 `alipay_trade_commercial_order_query_response`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `order_no` | String | 订单编号 |
| `order_type` | String | 订单类型 |
| `status` | String | 订单状态：`PRE_CREATED` / `PENDING_PAY` / `PAID` / `REFUNDED` / `CLOSED` / `COMPLETED` |
| `price_id` | String | 价格 ID |
| `product_id` | String | 产品 ID |
| `customer_id` | String | 客户 ID |
| `quantity` | Integer | 数量 |
| `total_amount` | BigDecimal | 总金额（元，2 位小数） |
| `pay_time` | String | 支付时间（默认 Unix 毫秒时间戳字符串；部分商户为 `yyyy-MM-dd HH:mm:ss`） |
| `pay_trade_no` | String | 支付流水号 |
| `create_time` | Date | 创建时间 |
| `modified_time` | Date | 修改时间 |

### 2.3 请求示例

```json
{ "order_no": "2026071300000001" }
```

### 2.4 响应示例

```json
{
  "alipay_trade_commercial_order_query_response": {
    "code": "10000",
    "msg": "Success",
    "order_no": "2026071300000001",
    "order_type": "ONE_TIME",
    "status": "PAID",
    "price_id": "PRICE_001",
    "product_id": "PROD_001",
    "customer_id": "C20260713001",
    "quantity": 1,
    "total_amount": 9.90,
    "pay_time": "1752400000000",
    "pay_trade_no": "2026071322001xxx",
    "create_time": "2026-07-13 10:00:00",
    "modified_time": "2026-07-13 10:05:00"
  },
  "sign": "..."
}
```

### 2.5 常见错误码

`INVALID_PARAMETER`、`ORDER_NOT_FOUND`、`ORDER_NOT_BELONG_TO_USER`、`QUERY_ERROR`、`SYSTEM_ERROR`

---

## 三、关闭商业订单

**接口方法**：`alipay.trade.commercial.order.close`

仅可关闭 **待支付（`PENDING_PAY`）状态** 的订单。

### 3.1 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `order_no` | String | 是 | 订单编号 |
| `close_reason` | String | 否 | 关闭原因 |

### 3.2 响应业务字段（内层 `alipay_trade_commercial_order_close_response`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `order_no` | String | 订单编号 |
| `trade_no` | String | 支付宝交易号 |
| `status` | String | 订单状态，关闭后为 `CLOSED` |
| `gmt_close` | Date | 关闭时间 |

### 3.3 请求示例

```json
{ "order_no": "2026071300000001", "close_reason": "用户取消" }
```

### 3.4 响应示例

```json
{
  "alipay_trade_commercial_order_close_response": {
    "code": "10000",
    "msg": "Success",
    "order_no": "2026071300000001",
    "trade_no": "2026071322001xxx",
    "status": "CLOSED",
    "gmt_close": "2026-07-13 10:10:00"
  },
  "sign": "..."
}
```

### 3.5 常见错误码

`INVALID_PARAMETER`、`ORDER_NOT_FOUND`、`ORDER_NOT_BELONG_TO_USER`、`ORDER_STATUS_INVALID`、`ORDER_EXPIRED`、`TRADE_CLOSE_FAILED`、`SYSTEM_ERROR`

---

## 四、查询批量退款

**接口方法**：`alipay.trade.commercial.batchrefund.query`

根据业务批次号查询批量退款结果（系统按当前调用商户与批次做归属校验）。

### 4.1 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `request_no` | String | 是 | 业务批次号 |

### 4.2 响应业务字段（内层 `alipay_trade_commercial_batchrefund_query_response`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `batch_id` | String | 批次 ID |
| `request_no` | String | 业务批次号 |
| `status` | String | 批次状态：`INIT` / `PROCESSING` / `SUCCESS` / `PARTIAL_SUCCESS` / `FAILED` |
| `total_refund_amount` | BigDecimal | 退款总金额（元，2 位小数） |
| `actual_refund_amount` | BigDecimal | 实际退款金额（已成功明细退款金额之和） |
| `success_count` | Integer | 成功明细数 |
| `fail_count` | Integer | 失败明细数 |
| `total_count` | Integer | 明细总数 |
| `refund_reason` | String | 退款原因 |
| `pay_trade_no_list` | List<String> | 涉及的支付流水号列表 |
| `details` | List<DetailItem> | 退款明细列表 |
| `create_time` | Date | 创建时间 |
| `modified_time` | Date | 修改时间 |

**`details[].` 明细项字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| `pay_trade_no` | String | 原支付流水号 |
| `refund_amount` | BigDecimal | 分配的退款金额（元，2 位小数） |
| `refund_request_no` | String | 退款请求号（幂等，创建时生成） |
| `status` | String | 明细状态：`PENDING` / `PROCESSING` / `SUCCESS` / `FAILED` |
| `error_code` | String | 失败错误码 |
| `error_msg` | String | 失败错误信息 |

**批次状态字典**

| 取值 | 说明 | 是否终态 |
|------|------|---------|
| `INIT` | 初始化 | 否 |
| `PROCESSING` | 处理中 | 否 |
| `SUCCESS` | 全部成功 | 是 |
| `PARTIAL_SUCCESS` | 部分成功 | 是 |
| `FAILED` | 全部失败 | 是 |

### 4.3 请求示例

```json
{ "request_no": "RF20260713001" }
```

### 4.4 响应示例

```json
{
  "alipay_trade_commercial_batchrefund_query_response": {
    "code": "10000",
    "msg": "Success",
    "batch_id": "B001",
    "request_no": "RF20260713001",
    "status": "PARTIAL_SUCCESS",
    "total_refund_amount": 20.00,
    "actual_refund_amount": 9.90,
    "success_count": 1,
    "fail_count": 1,
    "total_count": 2,
    "refund_reason": "商品退货",
    "pay_trade_no_list": ["2026071322001a", "2026071322001b"],
    "details": [
      {
        "pay_trade_no": "2026071322001a",
        "refund_amount": 9.90,
        "refund_request_no": "RR001",
        "status": "SUCCESS",
        "error_code": null,
        "error_msg": null
      },
      {
        "pay_trade_no": "2026071322001b",
        "refund_amount": 10.10,
        "refund_request_no": "RR002",
        "status": "FAILED",
        "error_code": "BATCH_REFUND_TRADE_NO_REFUNDABLE",
        "error_msg": "交易无可退款金额"
      }
    ],
    "create_time": "2026-07-13 11:00:00",
    "modified_time": "2026-07-13 11:01:00"
  },
  "sign": "..."
}
```

### 4.5 常见错误码

`INVALID_PARAMETER`（`request_no` 为空）、`BATCH_REFUND_NOT_FOUND`、`SYSTEM_ERROR`

---

## 五、价格类型匹配（关键，最易踩坑）

`commercial.order.create` 的 `price_id` 直建路径当前固定创建 `ONE_TIME` 订单。传入 recurring（循环）价格时，网关会报：

```
参数有误recurring price not support
（sub_code: INVALID_PARAMETER）
```

不要尝试通过请求字段 `order_type` 改变这一行为；该字段会被服务端覆盖。

| 创建路径 | 价格要求 | 结果 |
|---|---|---|
| `price_id` 直建单笔支付 | **单次价格**，创建价格时不传 `recurring` | 直接得到 `ONE_TIME` / `PENDING_PAY`，不展示价格表 |
| `page_code` 订阅价格表入口 | 创建接口本身不传 `price_id` | `SUBSCRIPTION` / `PRE_CREATED`，用户稍后在 Hosted 页面选择价格 |

### 创建价格要求

- 周期订阅的正式创建链路使用循环价格，`recurring` 包含周期配置。
- **单笔直建场景：`recurring` 不能传**，否则该价格不能用于此接口的 `price_id` 路径。

- 不传 → 创建单次价格（`one_time` 价格类型）
- 传 → 创建循环价格（`recurring`）

仅当传入 `recurring` 时，才需要同时填写并校验 `interval` / `interval_count`。查询价格返回的 `type` 字段（`one_time` / `recurring`）可用于核对类型匹配。

### 推荐的前端校验

创建订单前调用 `price.query` 核对 `type`：`price_id` 直建只接受 `one_time` 价格；低代码订阅则先使用 `page_code` 创建预订单，不要把循环价格直接塞入该直建路径。

---

## 六、响应解析与验签

支付宝开放平台网关返回标准响应包裹，业务字段位于与接口方法对应的 `alipay_trade_*_response` 对象中：

```json
{
  "alipay_trade_commercial_order_create_response": {
    "code": "10000", "msg": "Success",
    "order_no": "...", "checkout_url": "..."
  },
  "sign": "..."
}
```

- 成功判定：内层 `code == "10000"`。
- 失败时读取内层 `code`、`sub_code` 和 `sub_msg`，按错误类型决定修正参数或稍后重试。
- 使用支付宝公钥校验外层 `sign`，验签通过后再处理业务字段。
- 按接口定义解析 snake_case 字段，不要自行改写字段名或枚举大小写。

---

## 七、单笔支付最小闭环

商家验收保留创单返回的订单号、用户实际支付后的查单结果与履约记录。本 Skill 可核对这些脱敏证据，或在商家工程用模拟回执检验代码。

前置条件：应用已上线，商户已开通对应产品权限，并已完成接口加签配置。若在网页端使用单笔支付，产品开通时还需勾选[电脑网站支付](https://b.alipay.com/page/product-workspace/product-detail/I1080300001000041203/newProductList?)；完整开通步骤见[商家产品开通与接入准备指南](../../onboarding/token-pay/single-payment.md)。

```
1. alipay.trade.product.create   {name, description}        → product_id
2. alipay.trade.price.create     {product_id, unit_amount}  → price_id（单次价格，不传 recurring）
3. alipay.trade.customer.create  {name, phone}              → customer_id
4. alipay.trade.commercial.order.create {
       "customer_id": "...",
       "price_id": "...",
       "ui_mode": "HOSTED"
   } → {order_no, status:PENDING_PAY, checkout_url}
5. 用户完成支付后，调用 alipay.trade.commercial.order.query 查询最终订单状态
```

---

## 📚 错误码总表

| 错误码 | 含义 | 类别 |
|--------|------|------|
| `SUCCESS` | 成功 | 成功 |
| `INVALID_PARAMETER` | 请求参数错误（含字段名/枚举/价格类型不匹配） | 客户端 |
| `PRICE_NOT_FOUND` | 价格不存在 | 客户端 |
| `CUSTOMER_NOT_FOUND` | 客户不存在 | 客户端 |
| `ORDER_EXPIRED` | 订单已失效 | 客户端 |
| `ORDER_NOT_FOUND` | 订单不存在 | 客户端 |
| `ORDER_NOT_BELONG_TO_USER` | 无权操作该订单 | 客户端 |
| `ORDER_STATUS_INVALID` | 订单状态不允许此操作 | 客户端 |
| `PRODUCT_NOT_SIGNED` | 商户未签约产品 | 客户端 |
| `BATCH_REFUND_REQUEST_NO_DUPLICATE` | 业务批次号已存在 | 批量退款 |
| `BATCH_REFUND_TRADE_NOT_FOUND` | 交易不存在 | 批量退款 |
| `BATCH_REFUND_TRADE_NOT_PAID` | 交易非已支付状态 | 批量退款 |
| `BATCH_REFUND_TRADE_NOT_BELONG_TO_PID` | 交易不属于当前商户 | 批量退款 |
| `BATCH_REFUND_TRADE_DUPLICATE` | 同一批次中存在重复交易 | 批量退款 |
| `BATCH_REFUND_AMOUNT_EXCEED` | 退款总金额超过交易可退款金额之和 | 批量退款 |
| `BATCH_REFUND_TRADE_NO_REFUNDABLE` | 交易无可退款金额 | 批量退款 |
| `BATCH_REFUND_TRADE_ORDER_MISSING` | 退款交易明细缺少排序顺序 | 批量退款 |
| `BATCH_REFUND_TRADE_ORDER_DUPLICATE` | 退款交易明细排序顺序重复 | 批量退款 |
| `BATCH_REFUND_NOT_FOUND` | 批量退款批次不存在 | 批量退款 |
| `BATCH_REFUND_REFUND_FAILED` | 退款发起失败 | 批量退款 |
| `TRADE_CLOSE_FAILED` | 交易关闭失败 | 订单关闭 |
| `QR_CODE_GENERATE_FAILED` | 支付二维码生成失败（可能为商户未开通二维码能力，非参数错误） | 服务端 |
| `APP_SCHEMA_GENERATE_FAILED` | App 支付入口生成失败 | 服务端 |
| `QUERY_ERROR` | 查询失败 | 服务端 |
| `SYSTEM_ERROR` | 系统繁忙 | 服务端 |

> 客户端错误先修正请求。服务端错误需记录错误信息并查询已有订单；创建流程可能先建立订单、后生成支付载体，不能无条件自动重试。

---

## 💡 单笔支付接入要点（直连网关）

1. **按公开网关契约使用 snake_case**：`customer_id` / `price_id` / `order_no` / `checkout_url` …；不要从服务端 Java 属性名推断线上字段名。
2. **先选路径**：已确定一个单次价格时，用 `price_id` 直接创建一笔 `ONE_TIME/PENDING_PAY` 单笔支付；需要用户在价格表中选价时，用 `page_code` 创建 `SUBSCRIPTION/PRE_CREATED` 预订单，且仅支持 `HOSTED`。
3. **不要用 `order_type` 选路**：当前字段会被服务端覆盖，生成创建请求时省略。
4. **规范 UI 枚举**：统一生成 `HOSTED`、`QR_CODE`、`PAGE`、`APP_SCHEMA`；当前解析不区分大小写，但不要依赖非规范写法。
5. **价格类型匹配**：`price_id` 直建必须配单次价格（创建价格时**不传 `recurring`**），否则报 `recurring price not support`。
6. **金额单位与乘法**：请求 `order_amount` 用分（Long），当前作为每件单价再乘 `quantity`；响应 `total_amount` 用元（2 位小数）。
7. **按标准网关响应解析并验签**：从 `alipay_trade_*_response` 读取业务结果，以 `code=="10000"` 判断接口成功，并使用支付宝公钥校验外层 `sign`。
8. **关闭仅限待支付**：`PENDING_PAY` 状态可关闭；已支付订单走退款而非关闭。
9. **退款以批次查询为准**：发起批量退款后，通过 `batchrefund.query` 按 `request_no` 查询最终结果；批次为异步处理，以终态 `SUCCESS` / `PARTIAL_SUCCESS` / `FAILED` 为准。
10. **归属校验**：所有查询/操作均校验订单、客户、价格或退款与当前商户归属；不要依赖错误码探测跨商户资源。
