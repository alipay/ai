# 订阅产品 API 完整参考

## API 总览

| 接口 | 方法名 | 用途 | 标准订阅 | 席位订阅 |
|------|--------|------|:--------:|:--------:|
| [商品创建](api-product.md) | alipay.trade.product.create | 创建订阅商品 | ✓ | ✓ |
| [商品查询](api-product.md) | alipay.trade.product.query | 查询商品信息 | ✓ | ✓ |
| [商品修改](api-product.md) | alipay.trade.product.modify | 修改商品信息 | ✓ | ✓ |
| 价格创建 | alipay.trade.price.create | 创建商品价格 | ✓ | ✓ |
| 价格查询 | alipay.trade.price.query | 查询价格信息 | ✓ | ✓ |
| 客户创建 | alipay.trade.customer.create | 创建商户侧客户 | ✓ | ✓ |
| 订阅创建 | alipay.trade.subscription.create | 创建订阅 | ✓ | ✓ |
| 订阅查询 | alipay.trade.subscription.query | 查询订阅信息 | ✓ | ✓ |
| 订阅修改 | alipay.trade.subscription.modify | 修改订阅 | ✓ | ✓ |
| 订阅交易独立退款 | alipay.trade.subscription.refund | 对订阅下指定已支付交易退款，不改变订阅生命周期 | ✓ | ✓ |
| 批量退款查询 | alipay.trade.commercial.batchrefund.query | 按退款单号查询取消退款、独立退款和平台自动退款 | ✓ | ✓ |
| 预计退款金额查询 | alipay.trade.subscription.estimatedrefund.query | 取消前预估可退款金额 | ✓ | ✓ |
| 退款 | alipay.trade.refund | 裸退款，按原支付单原路退款 | ✓ | ✓ |

> 💡 **席位订阅**：支持多席位订阅、动态扩容/缩容，详见 [席位订阅接入指南](seats.md)

---

## 价格创建接口 (alipay.trade.price.create)

创建商品的价格方案。

### 业务请求参数

| 参数 | 类型 | 必选 | 描述 | 示例值 |
|------|------|------|------|--------|
| unit_amount | number | **必选** | 单位金额，单位：分，必须大于 0；默认商品价格上限 500 元（50000 分），见[默认管控](merchant-default-controls.md) | 1000 |
| product_id | string | 条件必选 | 商品ID（与product_data二选一） | 202603230010000006783 |
| product_data | object | 条件必选 | 商品信息（与product_id二选一） | 见示例 |
| recurring | object | 可选 | 循环计价配置 | 见示例 |
| metadata | string | **建议传** | 价格元数据 | {"default":"default"} |

### recurring 参数说明

```json
{
  "interval": "MONTH",      // 周期单位：仅支持 DAY/MONTH（大小写不敏感）
  "interval_count": 1       // 周期间隔，interval=DAY 时不得小于 7
}
```

> ⚠️ `interval` 仅支持 `DAY` 和 `MONTH`，传其他值（如 WEEK/YEAR）会报参数错误；`interval=DAY` 时 `interval_count` 不得小于 7（计价周期不能小于 7 天）。默认按天最多 93 天、按月最多 3 个月；年付即使用 `MONTH` + `interval_count=12` 表达，也不符合默认最长周期，不能直接作为可用方案。

### 请求示例

```json
{
  "unit_amount": 1000,
  "product_id": "202603230010000006783",
  "recurring": {
    "interval": "MONTH",
    "interval_count": 1
  },
  "metadata": "{\"default\":\"default\"}"
}
```

### 响应参数

- `price_id`：价格ID
- `product_id`：商品ID

---

## 价格查询接口 (alipay.trade.price.query)

查询价格配置信息。

### 业务请求参数

| 参数 | 类型 | 必选 | 描述 |
|------|------|------|------|
| price_id | string | **必选** | 价格ID |
| query_options | array | 可选 | 查询选项，支持：product（商品信息） |

### 响应参数

- `id`：价格ID
- `active`：是否可用
- `product_id`：关联商品ID
- `unit_amount`：单位金额（分）
- `type`：价格类型（recurring/one_time）
- `recurring`：循环计价配置

---

## 客户创建接口 (alipay.trade.customer.create)

创建商户侧客户，用于后续订阅关联。`customer_id` 是商户调用
`alipay.trade.customer.create` 后获得的客户ID，不是支付宝用户ID，也不代表已经识别
或绑定实际签约的支付宝账户。

### 业务请求参数

| 参数 | 类型 | 必选 | 描述 | 示例值 |
|------|------|------|------|--------|
| name | string | **必选** | 客户名称 | 张三 |
| description | string | 可选 | 客户描述 | 业务客户 |
| phone | string | 可选* | 客户手机号 | YOUR_CUSTOMER_PHONE |
| email | string | 可选* | 客户邮箱 | email@example.com |

> *phone 和 email 至少传入一个

### 响应参数

- `customer_id`：客户ID（用于后续订阅创建）

### customer_id 与支付宝用户的关系

| 标识 | 含义 |
|---|---|
| 商户用户 ID | 商户会员或账号体系中的用户，用于归属权益 |
| `customer_id` | 支付宝订阅体系中的客户ID，用于创建和查询订阅 |
| `subscription_id` | 一份具体订阅关系，用于后续查询、升级、取消和退款 |
| 实际签约支付宝账户 | 在支付宝页面确认签约并承担后续扣款的账户 |

创建客户时填写的 `name`、`phone`、`email` 只是客户资料，不能据此认定已经验证或绑定某个
支付宝账户。实际签约账户以用户打开支付/签约链接后在支付宝页面确认的账户为准。

商户应持久化稳定的 `MERCHANT_USER_ID → customer_id` 映射，同一商户用户后续订阅时复用
该 `customer_id`，不要按购买次数重复创建客户。

普通订阅对相同价格的重复判断维度是 `customer_id + price_id`。准确口径是：

> 同一 `customer_id` 不能同时存在多个相同 `price_id` 的有效订阅。

不要把这条规则改写成“同一支付宝用户不能订阅相同 `price_id`”。`customer_id` 不是支付宝
用户身份，不能在两个概念之间直接等价转换。一般回答到校验维度为止，不主动展开实际支付宝
账户跨多个 `customer_id` 的组合；用户明确追问时，只说明校验维度和重复创建客户的风险。

---

## 订阅创建接口 (alipay.trade.subscription.create)

创建订阅，返回支付跳转链接。

### 业务请求参数

| 参数 | 类型 | 必选 | 描述 |
|------|------|------|------|
| items | array | **必选** | 订阅项目信息，**当前只支持单个订阅项** |
| customer_id | string | **必选** | 客户ID；由客户创建接口返回，不是支付宝用户ID |
| subscribe_title | string | 可选 | 订单标题 |
| pay_amount | number | 可选 | 商户自定义首笔实付金额（单位：分），普通订阅和试用期均可使用，不要求同时传 trial_period_days；不改变后续周期价格。不得小于 0。具备零元订阅准入时，显式传 0 时仅签约，不发生首笔真实付款；传正数时支付并签约。仍需通过适用的业务准入和金额校验。未来生效时禁止传入。与 coupon_id 互斥 |
| trial_period_days | integer | 可选 | 试用期天数，正整数 **3-365** |
| trial_desc | string | 可选 | 试用期描述，**最大 12 字符**，签约页展示 |
| grace_period_days | integer | 可选 | 托管续费失败后的宽限期天数；不传或 `0` 表示关闭，支持 `1`、`2`、`3`、`4`、`5` |
| effective_type | string | 可选 | 生效类型：`IMMEDIATE_EFFECTIVE`（默认）/ `SCHEDULED_EFFECTIVE`（未来生效） |
| scheduled_effective_time | string | 条件必选 | `SCHEDULED_EFFECTIVE` 时必传，格式 `yyyy-MM-dd` |
| metadata | string | 可选 | 订阅元数据 |
| deduct_type | string | 可选 | 本接入流程使用支付宝托管扣款 `SUBSCRIBE_DEDUCT`（默认） |

### 普通首期优惠与试用期

普通立即生效订阅中，传入 `pay_amount` 后首笔实付按该金额计算；不传时由系统按价格、数量及适用优惠计算。此参数不修改 `price_id` 对应的价格，后续周期仍按所选价格和数量续费（未发生后续变更时）。不传 `trial_period_days` 就不是试用期，不需要仅因首期优惠而申请试用期准入。

例如价格为 30 元/月，首期希望收 18 元：价格创建用 `unit_amount=3000`，订阅创建用 `pay_amount=1800`，不传 `trial_period_days` 和 `coupon_id`。`pay_amount=18` 实际是 0.18 元，`pay_amount=500` 才是 5 元。可直接使用自定义首笔金额；一次性优惠券是另一种方案，不是必需步骤。完整请求见 [普通首期优惠示例](api-examples.md#普通首期优惠无试用期)。

只有设置了 `trial_period_days` 才按试用期处理，此时 `pay_amount` 表示试用期总价。普通首期优惠、试用期和未来生效的准入与金额限制分别按下表及对应章节判断，不能互相套用。

### 创建业务准入与金额管控

先按[商户默认管控规则](merchant-default-controls.md)核对默认试用限制、500 元价格上限、7 天至 3 个月／93 天的周期范围。订阅创建的参数校验通过不代表业务准入一定通过，实际校验以系统计算后的首笔实际支付金额和商户当前准入为准：

| 场景 | 规则 |
|------|------|
| 零元创建（含免费试用和未来生效创建日的技术零元） | 需具备零元订阅准入；最终金额为 0 时走仅签约链路，未来生效仍禁止商户传 `pay_amount` |
| 低价试用 | 默认不支持，需确认实际已获得试用期订阅准入；系统计算后的首笔实际支付金额不得低于 1.00 元（100 分）；试用期不受 3 倍管控 |
| 正金额普通创建 | 系统计算后的首笔实际支付金额不得低于 1.00 元（100 分），也不得低于后续周期扣款金额的 1/3 |
| 累计新签 | 商家通过周期订阅方案使用已签约的「商家扣款」产品时，每个商家默认累计可新签 5000 名用户。此处统计用户签约人数；团队席位数量按[席位变更](seats.md)处理 |

普通正金额首次订阅购买的最低首笔实际支付金额，可按 `max(1.00 元, 后续周期扣款金额 / 3 后向上取分)` 判断。相对金额规则等价于“首笔实际支付金额 x 3 >= 后续周期扣款金额”，恰好等于边界可通过；例如后续周期扣款 100.00 元时首笔至少为 33.34 元，后续周期扣款 2.00 元时首笔仍至少为 1.00 元。累计新签上限不改变已创建订阅的生命周期。若新增签约因商家当前额度已满而被拦截，按实际回执办理[扩容申请](https://render.alipay.com/p/yuyan/180022670000138080/index.html)，不要通过更换客户ID、价格ID或拆分请求绕过。

上述 1.00 元下限和 1/3 比例只属于订阅创建阶段，不适用于 `UPGRADE`、`INCREASE_QUANTITY` 或其他订阅修改操作。回答升级金额问题时不得引用本节推导升级会因低于续费金额的 1/3 而失败。

### items 参数说明

```json
[
  {
    "item_id": "2026032012314",
    "price_id": "202603201234567889",
    "quantity": 100  // 席位订阅时必传，表示席位数量
  }
]
```

| 字段 | 类型 | 必选 | 描述 |
|------|------|------|------|
| price_id | string | **必选** | 价格ID |
| item_id | string | 可选 | 项目ID |
| **quantity** | integer | 条件必选 | **席位数量（席位订阅必传，必须为正整数，支持 1 席）** |
| coupon_id | string | 可选 | 优惠券ID；分别与 pay_amount、quantity、trial_period_days 互斥 |

> 💡 **席位订阅**：商品配置非空 `unit_label` 时按席位订阅处理，创建时必须传正整数 `quantity`；`quantity=1` 仍保留席位语义。个体订阅商品不配置 `unit_label`，创建时不传 `quantity`。
>
> **席位试用**：`quantity` 与 `trial_period_days` 可以同时传入，表示席位试用。低价试用的 `pay_amount` 是全部席位的试用总价，不再乘以 `quantity`；正式续费按价格单价乘席位数量。试用期内不支持独立扩容或缩容，但支持通过套餐 `UPGRADE` / `DOWNGRADE` 同步调整数量。
>
>

### 响应参数

- `subscription_id`：订阅ID
- `order_no`：支付单号
- `pay_amount`：支付金额（分）
- `alipay_jump_schema`：支付宝端拉起链接；正金额走电脑网站支付并签约时不返回
- `alipay_schema`：仅签约/APP 支付并签约时为签约或支付短链；正金额走电脑网站支付并签约时为浏览器可打开的 HTTPS 链接
- `trial_start` / `trial_end`：试用期起止时间（试用期订阅返回）
- `schema_effective_end`：签约链接有效期截止时间，**超时后链接失效**
- `promotion_info`：优惠信息（使用优惠券时返回）

> 电脑网站支付并签约的浏览器返回页不是支付/签约终态。只有收到并验签 `alipay.trade.subscription.changed` 通知，或查询到对应订阅终态后，才能开通权益。

### 响应示例

```json
{
  "subscription_id": "20260320123156789",
  "pay_amount": 100,
  "alipay_schema": "alipays://platformapi/startApp?appId=60000157&orderStr=xxx"
}
```

---

## 订阅查询接口 (alipay.trade.subscription.query)

查询用户订阅信息。

### 业务请求参数

| 参数 | 类型 | 必选 | 描述 |
|------|------|------|------|
| customer_id | string | 可选 | 客户ID |
| subscription_id | string | 可选 | 订阅ID |
| subscription_status | string | 可选 | 订阅状态筛选 |

> customer_id / subscription_id / subscription_status 均为可选过滤条件，可任意组合；建议至少传入 customer_id 或 subscription_id 之一以缩小查询范围。

### subscription_status 枚举

| 值 | 说明 |
|-----|------|
| INCOMPLETE | 未完成（待支付） |
| INCOMPLETE_EXPIRED | 未完成已过期 |
| ACTIVE | 活跃 |
| TRIALING | 试用中 |
| PAST_DUE | 逾期宽限期中；仅显式配置正数宽限期并满足续费运行条件时进入 |
| CANCELED | 已取消 |
| UNPAID | 未支付（预留状态，当前版本不会流转到） |
| PAUSED | 已暂停（预留状态，当前版本不会流转到） |

> 完整状态说明见 [data-model-reference.md](data-model-reference.md)

### 响应参数

返回 `subscriptions` 数组，每个包含：
- `subscription_id`：订阅ID
- `customer_id`：客户ID
- `subscription_status`：订阅状态
- `effective_type`：`IMMEDIATE_EFFECTIVE` / `SCHEDULED_EFFECTIVE`
- `current_period_start`：当前周期开始时间
- `current_period_end`：当前周期结束时间
- `cancel_at_period_end`：周期结束是否失效
- `grace_period_days`：已配置的宽限期天数；未配置时可不返回
- `grace_period_end`：本次宽限期结束时间，格式 `yyyy-MM-dd HH:mm:ss`；处于 `PAST_DUE` 时以本轮冻结配置为准
- `items`：当前生效的订阅项目详情
- `pending_items`：已确认、等待下周期生效的订阅项目详情；席位套餐降级或缩容时可返回

> 对 `effective_type=SCHEDULED_EFFECTIVE` 的订阅，首笔真实扣款前的周期字段属于过渡状态；`current_period_end` 可能等于商家保存的未来生效日，不代表已付费权益截止时间。到未来生效日并确认首扣成功后，再以最新通知或查询结果中的周期字段为准。

---

## 订阅修改接口 (alipay.trade.subscription.modify)

修改订阅信息（升级/降级/取消/扩容/缩容）。

### 业务请求参数

| 参数 | 类型 | 是否必选 | 描述 |
|------|------|------|------|
| subscription_id | string | 必选 | 订阅ID |
| **modify_type** | string | 可选（不传视为 UPGRADE） | 更新类型（见下方枚举） |
| items | array | 条件必选 | 订阅项目信息（升级/降级/扩容/缩容用） |
| ┗ item_id | string | 可选 | 订阅生效后由 query/通知接口返回的 item_id |
| ┗ price_id | string | 可选 | `alipay.trade.price.create` 返回的价格ID，代表本次操作目标价格 |
| ┗ quantity | integer | 可选 | 商品数量，目前仅席位订阅 create 场景按需传入 |
| ┗ source_quantity | 正整数数量 | 可选 | 当前已生效订阅项的数量。网关字段名和传输类型见[席位指南](seats.md#扩容场景) |
| ┗ target_quantity | 正整数数量 | 可选 | 订阅项的目标席位数量，传输格式同上 |
| ┗ coupon_id | string | 可选 | 优惠券ID（创建券响应 `coupon_info.coupon_id`）；升级/扩容携券必须同时传非负 pay_amount，降级/缩容携券不能传 pay_amount 且不支持一次性券 |
| preserve_billing_cycle | boolean | 视操作 | 套餐升级按升级规则选择 true（保持周期）或 false（重置周期）；试用期升级不支持 true。新接入的单独席位扩容 INCREASE_QUANTITY 按[团体席位场景](seats.md#扩容场景)显式传 true |
| cancel_at_period_end | boolean | 可选 | 仅用于取消/取消后恢复：CANCEL 下 true=周期结束后取消、false=立即取消并发起退款；REVERT_CANCEL 下需传 false |
| refund_amount | number | 可选 | 取消并退款场景：不传=系统按时间规则算残值退款；传入=按商家指定金额退款，**0 表示直接取消不退款** |
| grace_period_days | integer | 条件必选 | 仅 `UPDATE_GRACE_PERIOD` 使用；`0` 表示关闭，支持 `1`、`2`、`3`、`4`、`5` |
| pay_amount | number | 可选 | 支付金额（单位：分），不得小于 0。用于普通订阅升级、席位扩容场景；传 0 时仅签约，传正数时支付并签约。席位缩容不允许传 |
| description | string | 可选 | 更新描述 |
| subscribe_title | string | 可选 | 订单标题，默认使用商品名称 |
| extend_params | string | 可选 | 扩展参数（订阅特殊能力传参，详见具体场景接入指南） |

### modify_type 枚举值

| 值 | 说明 |
|-----|------|
| **UPGRADE** | 升级（不传 modify_type 时默认视为 UPGRADE） |
| **DOWNGRADE** | 降级（下周期生效，无需付费） |
| **CANCEL** | 取消订阅，停止后续扣款（可立即取消并发起退款，或周期结束后取消） |
| **REVERT_CANCEL** | 撤销尚未生效的周期末取消预约（cancel_at_period_end 需传 false） |
| **INCREASE_QUANTITY** | 席位商品数量扩容，计算当前周期差价 |
| **DECREASE_QUANTITY** | 席位商品数量缩容，下周期生效 |
| **UPDATE_GRACE_PERIOD** | 单独修改后续周期使用的宽限期配置 |

> **升级/扩容金额边界**：最终金额只要求不小于 0，不适用创建阶段的 1.00 元下限或“本次金额不低于后续周期扣款金额 1/3”的规则。最终金额为 0 时返回仅签约链接，不发生真实付款；最终金额为正数时返回支付并签约链接。零元升级/扩容不等同于零元创建，不应要求商户具备“零元创建准入”；负数仍会被拒绝。如实际调用另有业务拦截，以接口返回和正式接入资料为准。
>
> 💡 **升级/扩容差价与用券**：不携券时可不传 `pay_amount`，由系统计算差额，也可传非负金额覆盖。携带 `items[].coupon_id` 时必须同时传非负的 `pay_amount`（单位：分）；当次实付以该金额为准，不再从中扣减券优惠。降级/缩容携券时不能传 `pay_amount`，且不支持 `duration=once` 的一次性券，仅支持 `repeating` / `forever`。创建订阅时 `coupon_id` 与 `pay_amount` 的互斥规则保持不变。

#### 场景校验约束

| 场景 | 关键约束 |
|------|---------|
| UPGRADE / DOWNGRADE | items 必传且只能 1 个，`item_id` + `price_id` 必填；席位数量 `source_quantity` + `target_quantity` 同传同缺，双缺省表示保持当前数量，同时传时源数量须等于当前生效数量；不能传 `cancel_at_period_end`；携券时 UPGRADE 必须传非负 `pay_amount`，DOWNGRADE 禁止传 `pay_amount` 且禁止一次性券 |
| INCREASE_QUANTITY | items 只能 1 个，`item_id` 必填，**无需传 `price_id`**；`target_quantity` 必须 **大于** `source_quantity`，且均 > 0；不能传 `cancel_at_period_end`；携券时必须同时传非负 `pay_amount` |
| DECREASE_QUANTITY | items 只能 1 个，`item_id` 必填，**无需传 `price_id`**；`target_quantity` 必须 **小于** `source_quantity`，且均 > 0；不能传 `cancel_at_period_end`；**不能传 `pay_amount`**；携券时禁止一次性券 |
| CANCEL | `cancel_at_period_end` **必传**；`refund_amount` 仅立即取消（false）时允许传，周期末取消（true）不可传 |
| REVERT_CANCEL | `cancel_at_period_end` 必须 false；仅用于已设置周期末取消、但取消尚未实际生效的订阅；已经进入 `CANCELED` 后不能通过本操作恢复 |
| UPDATE_GRACE_PERIOD | 只能传 `subscription_id`、可选 `customer_id` 和 `grace_period_days`；允许状态为 `ACTIVE` / `TRIALING` / `PAST_DUE`，不得与其他更新字段混传 |


席位套餐升降级时，`UPGRADE` 立即生效并按目标价格、目标数量和剩余周期计算整单差价；`DOWNGRADE` 下周期生效且本次不收费。`modify_type` 决定生效时机，不根据目标数量高于或低于源数量推断。`source_quantity` / `target_quantity` 同时不传时保持当前数量；只改数量、不更换价格时，使用 `INCREASE_QUANTITY` / `DECREASE_QUANTITY`。

个体和席位的免费、低价试用均支持套餐 `DOWNGRADE`。用户确认后，当前套餐和数量继续使用到 `trial_end`，目标套餐和数量从 `trial_end` 起生效。试用期套餐升降级必须使用周期重置语义，不支持 `preserve_billing_cycle=true`；独立扩容/缩容仍不支持。

### 使用场景

**升级（UPGRADE，立即生效，最终金额须 >= 0）**：
```json
{
  "subscription_id": "20260320123156789",
  "modify_type": "UPGRADE",
  "pay_amount": 500,
  "preserve_billing_cycle": true,
  "items": [
    {
      "item_id": "2026032012314",
      "price_id": "新的价格ID",
      "coupon_id": "9WJ36SEC"
    }
  ],
  "description": "升级到专业版"
}
```

**降级（DOWNGRADE，下周期生效，无需付费）**：
```json
{
  "subscription_id": "20260320123156789",
  "modify_type": "DOWNGRADE",
  "items": [
    {
      "item_id": "2026032012314",
      "price_id": "新的价格ID"
    }
  ],
  "description": "降级到标准版"
}
```

**席位套餐升级并同步修改数量（立即生效）**：
```json
{
  "subscription_id": "20260320123156789",
  "modify_type": "UPGRADE",
  "preserve_billing_cycle": true,
  "items": [{
    "item_id": "2026032012314",
    "price_id": "目标价格ID",
    "source_quantity": 100,
    "target_quantity": 80
  }],
  "description": "切换专业版并调整为80席"
}
```

席位套餐 `DOWNGRADE` 使用同一组可选字段，但下周期生效；两字段同时不传表示保持当前数量。生效前 `items` 保持当前值，`pending_items` 返回目标价格和数量。两种操作完成或生效后，都应通过通知或查询保存最新 `item_id`、价格和数量。

**席位扩容（INCREASE_QUANTITY，立即生效，最终金额须 >= 0）**。下例沿用旧包的数量表示，直接调用网关前核对[席位数量字段的传输格式](seats.md#扩容场景)。
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
  "description": "席位扩容"
}
```

**席位缩容（DECREASE_QUANTITY，下周期生效）**：
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
  "description": "席位缩容"
}
```

**立即取消并退款（CANCEL，cancel_at_period_end=false）**：
```json
{
  "subscription_id": "20260320123156789",
  "modify_type": "CANCEL",
  "cancel_at_period_end": false,
  "refund_amount": 100
}
```

**周期结束后取消（CANCEL，cancel_at_period_end=true）**：
```json
{
  "subscription_id": "20260320123156789",
  "modify_type": "CANCEL",
  "cancel_at_period_end": true
}
```
> `cancel_at_period_end` **必传**：true=周期结束后取消（用户可用到本周期结束，不可传 refund_amount）；false=立即取消并发起退款。
> `refund_amount` 仅立即取消（false）时可传：不传=系统按残值退款；传 0=直接取消不退款；传入正数=按指定金额退款。

**撤销周期末取消（REVERT_CANCEL）**：
```json
{
  "subscription_id": "20260320123156789",
  "modify_type": "REVERT_CANCEL",
  "cancel_at_period_end": false
}
```

同步响应会返回新的用户签约入口，例如：

```json
{
  "subscription_id": "20260320123156789",
  "alipay_schema": "alipays://...",
  "alipay_jump_schema": "https://..."
}
```

`REVERT_CANCEL` 不会创建新订阅，原 `subscription_id` 保持不变。商家必须把响应中实际返回的 `alipay_schema` / `alipay_jump_schema` 交给用户重新确认签约：PC 场景通常展示二维码供用户扫码，移动端可直接拉起支付宝。同步接口成功只表示签约入口生成成功，不表示撤销已经生效；收到 `alipay.trade.subscription.changed` 的 `change_type=item_cancel_revert`，或主动查询确认后，才能按恢复成功处理。若订阅已经立即取消或周期末取消已经生效并进入 `CANCELED`，不能使用 `REVERT_CANCEL` 将其直接恢复为 `ACTIVE` 或 `TRIALING`。

**修改宽限期（UPDATE_GRACE_PERIOD）**：

```json
{
  "subscription_id": "20260320123156789",
  "modify_type": "UPDATE_GRACE_PERIOD",
  "grace_period_days": 1
}
```

上例配置 1 天宽限期；支持整数 `0`–`5`，传 `0` 表示关闭后续周期的宽限期。订阅已处于 `PAST_DUE` 时，本轮截止时间按进入宽限期时冻结的配置执行，本次修改从后续周期起生效。

如果订阅在设置周期末取消前已有尚未生效的套餐降级或席位缩容，`REVERT_CANCEL` 成功后恢复的是查询结果中当前生效的 `items`，原 `pending_items` 同时失效，不会在原周期末继续生效。商家收到 `item_cancel_revert` 通知后应重新调用查询接口，用最新 `items` / `pending_items` 覆盖本地记录；不要继续执行恢复前保存的待生效变更。

> 取消并退款为**异步退款**。接口成功表示订阅已取消。使用响应中的退款单号 `refund_order_id` 关联批量退款通知或查询的 `request_no`，按返回的 `status` 确认退款结果。

> `PAST_DUE` 期间不支持升级、降级、扩缩容或撤销取消。取消请求会立即生效，即使传 `cancel_at_period_end=true` 也不会继续等待周期末；同时不得传 `refund_amount`。

### 响应参数

| 参数 | 描述 |
|------|------|
| subscription_id | 订阅ID |
| pay_amount | 支付金额（单位：分，升级/扩容返回；0 表示仅签约） |
| order_no | 升级订阅时生成的支付请求单号 |
| alipay_jump_schema | 支付宝端拉起链接；`REVERT_CANCEL` 时属于用户重新签约入口；正金额走电脑网站支付并签约时不返回 |
| alipay_schema | 仅签约/APP 支付并签约时为签约或支付短链，`REVERT_CANCEL` 时属于用户重新签约入口；正金额走电脑网站支付并签约时为浏览器可打开的 HTTPS 链接 |
| promotion_info | 修改时若使用优惠，返回的优惠信息明细 |
| refund_order_id | 退款业务单号（取消并退款场景返回，对应批量退款通知和查询的 request_no） |
| refund_amount | 退款金额（单位：分，取消并退款场景返回） |

> 💡 **席位订阅**：套餐升降级、扩容或缩容后会产生新的 `item_id`，通过查询接口或异步通知获取最新值。详见 [席位订阅接入指南](seats.md)

---

## 消息通知 (alipay.trade.subscription.changed)

订阅状态变更时，支付宝主动通知商户。

### 通知参数

| 参数 | 描述 |
|------|------|
| change_type | 变更类型 |
| change_date | 变更时间 |
| trade_no | 交易号 |
| pay_amount | 支付金额 |
| subscription | 订阅详情（JSON） |

### change_type 枚举

| 值 | 说明 |
|-----|------|
| active | 订阅已生效（含试用期转正式） |
| trialing | 试用期订阅生效 |
| period_extend | 订阅续费成功 |
| item_update | 订阅项目更新成功（标准订阅升级/席位扩容） |
| **item_downgrade** | 订阅降级/席位缩容成功（下周期生效） |
| cancel | 订阅取消已生效（立即取消或周期末取消到期生效） |
| cancel_at_period_end | 订阅已设置周期结束后取消 |
| item_cancel_revert | 撤销取消成功 |
| past_due | 订阅已进入续费宽限期；`subscription` 中包含 `subscription_status=PAST_DUE`、`grace_period_days` 和 `grace_period_end` |

> 周期末取消会发送两阶段通知：设置取消预约成功时发送 `cancel_at_period_end`，订阅仍可用；到 `current_period_end` 真正取消生效后发送 `cancel`，此时订阅状态为 `CANCELED`。`cancel` 不是立即取消专属枚举。

### 响应要求

- 处理成功：返回 `success`
- 处理失败：返回 `fail`（支付宝会重试）

### 重试策略

25小时内最多8次通知，间隔：2m、10m、10m、1h、2h、6h、15h

---

## 批量退款状态变化通知 (alipay.trade.commercial.batchrefund.changed)

订阅取消并退款、订阅交易独立退款和客诉超标自动退款均通过该通知推送退款终态。取消退款时，通知的 `request_no` 对应取消响应的 `refund_order_id` 和订阅 `cancel` 通知的 `refund.refund_payment_order_id`。独立退款时，`request_no` 对应独立退款响应的 `refund_order_id`。

### 消息属性

| 参数 | 描述 |
|------|------|
| batch_id | 退款批次号 |
| request_no | 批量退款请求号。商户主动退款对应响应的 `refund_order_id`。自动退款由平台生成，单号包含 `KSZDTK` |
| status | 批次执行状态：`SUCCESS` / `PARTIAL_SUCCESS` / `FAILED` |
| refund_scene | 可选。 `MERCHANT_INITIATED` 表示商户主动退款，`AUTO_PENALTY` 表示客诉超标自动退款 |
| total_refund_amount | 批次总退款金额（元） |
| actual_refund_amount | 实际退款金额，已成功明细退款金额之和（元） |
| success_count / fail_count / total_count | 成功 / 失败 / 总明细数 |
| refund_reason | 退款原因。商户主动退款时为商户传入的原因，自动退款时包含投诉工单号 |
| details | 退款明细（JSON 字符串数组），每项含 `pay_trade_no`、`refund_amount`、`refund_request_no`、`status` |

### 消息示例

```json
{
  "batch_id": "202605070120000002883",
  "request_no": "20260507003",
  "status": "PARTIAL_SUCCESS",
  "refund_scene": "MERCHANT_INITIATED",
  "total_refund_amount": "10.00",
  "actual_refund_amount": "8.00",
  "success_count": "1",
  "fail_count": "1",
  "total_count": "2",
  "refund_reason": "商品退款",
  "details": "[{\"pay_trade_no\":\"2026051300115678\",\"refund_amount\":\"8.00\",\"refund_request_no\":\"rr_001\",\"status\":\"SUCCESS\"},{\"pay_trade_no\":\"2026051300115679\",\"refund_amount\":\"2.00\",\"refund_request_no\":\"rr_002\",\"status\":\"FAILED\"}]"
}
```

### 处理要点

- 以 `status` 判定退款最终结果，以 `refund_scene` 识别退款来源
- `details` 是 JSON 字符串，需解析后按 `pay_trade_no` / `refund_request_no` 映射到对应支付单
- 验签后返回 `success`，并做幂等

## 批量退款查询接口 (alipay.trade.commercial.batchrefund.query)

取消退款、独立退款和客诉超标自动退款都可以按批次查询。请求必填 `request_no`（字符串，1–64 个字符）。商户主动退款传发起接口返回的 `refund_order_id`，自动退款传平台通知中的 `request_no`。

| 响应字段 | 描述 |
|----------|------|
| batch_id / request_no | 退款批次 ID / 退款请求号 |
| status | `INIT` 和 `PROCESSING` 表示处理中。`SUCCESS`、`PARTIAL_SUCCESS`、`FAILED` 分别表示全部成功、部分成功和全部失败 |
| refund_scene / refund_reason | 退款来源和原因，含义与批量退款通知一致。自动退款为 `AUTO_PENALTY`，原因包含投诉工单号 |
| total_refund_amount / actual_refund_amount | 申请退款总额 / 成功明细金额之和，单位为元 |
| success_count / fail_count / total_count | 成功 / 失败 / 总明细数 |
| pay_trade_no_list / details | 原支付流水号列表 / 退款明细列表，明细金额单位为元 |

退款异步处理，建议查询间隔不少于 5 秒。收到终态后结束轮询。[官方批量退款查询接口](https://opendocs.alipay.com/solution/9ada409b_alipay.trade.commercial.batchrefund.query?pathHash=7507bb58&ref=api&scene=common)

---

## 预计退款金额查询接口 (alipay.trade.subscription.estimatedrefund.query)

商户在取消订阅前，预估当前可退金额，用于向用户展示「取消后将退回多少」。

### 业务请求参数

| 参数 | 类型 | 必选 | 描述 |
|------|------|------|------|
| subscription_id | string | **必选** | 订阅ID |
| customer_id | string | 可选 | 客户ID，传入需与订阅客户一致 |

### 请求示例

```json
{
  "subscription_id": "SUB20260522002",
  "customer_id": "MERCHANT_CUSTOMER_ID"
}
```

### 响应参数

| 参数 | 类型 | 描述 |
|------|------|------|
| subscription_id | string | 订阅ID |
| subscription_status | string | 订阅状态 |
| refundable | boolean | 是否可退款 |
| estimated_refund_amount | number | 预计退款金额（单位：分），**仅 refundable=true 时返回** |

### 响应示例

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

### 业务规则

- 仅 `ACTIVE` 状态订阅返回 `refundable=true` 并给出 `estimated_refund_amount`（单位：分）
- 其他状态返回 `refundable=false`，**不返回退款金额**
- 订阅必须属于调用方商户，否则报 `PERMISSION_DENIED`

### 错误码

| 错误码 | 说明 |
|--------|------|
| REQUEST_PARAM_ILLEGAL | subscription_id 为空，或 customerId 与订阅不匹配 |
| SUBSCRIPTION_NOT_EXIST | 订阅不存在 |
| PERMISSION_DENIED | 无权限查询该订阅（订阅不属于当前商户） |

---

## 订阅交易独立退款接口 (alipay.trade.subscription.refund)

对当前商户订阅下指定的已支付正向交易发起独立退款。该操作不主动取消订阅，也不改变订阅权益、生命周期或周期信息。

> 生产接入以当前商户在开放平台控制台的实际接口权限为准。

### 业务请求参数

| 参数 | 类型 | 必选 | 描述 |
|------|------|:----:|------|
| subscription_id | string | 是 | 订阅ID，必须属于当前商户 |
| trade_no | string | 是 | 该订阅下已支付正向交易的支付宝交易号 |
| refund_amount | long | 是 | 退款金额，单位：**分**，必须大于 0 且不得超过本地已知剩余可退金额 |
| out_request_no | string(64) | 是 | 商户退款请求号，作为幂等键；同一次退款重试必须保持不变 |

### 请求示例

```json
{
  "subscription_id": "SUBSCRIPTION_ID",
  "trade_no": "ALIPAY_TRADE_NO",
  "refund_amount": 100,
  "out_request_no": "MERCHANT_REFUND_REQUEST_NO"
}
```

### 响应参数

| 参数 | 描述 |
|------|------|
| subscription_id / trade_no / refund_amount / out_request_no | 回显请求参数 |
| refund_order_id | 订阅退款单 ID，对应批量退款通知和查询的 `request_no` |
| refund_status | 同步返回当前退款状态，取值为 `PENDING` / `PROCESSING` / `SUCCESS` / `PARTIAL_SUCCESS` / `FAILED` |

同步响应中的 `PENDING`、`PROCESSING` 表示待提交或处理中，`SUCCESS`、`PARTIAL_SUCCESS`、`FAILED` 分别表示全部成功、部分成功和全部失败。用 `refund_order_id` 关联批量退款通知或查询，按其中的 `status` 确认最终结果。发起请求结果未知且需重试时，复用原请求参数和原 `out_request_no`。

相同 `subscription_id + out_request_no` 且交易号、金额一致时按幂等请求处理；同一幂等号改交易或改金额会被拒绝。

### 业务约束

- `trade_no` 必须对应当前订阅下的正向支付交易，原交易应处于已支付或已部分退款状态。
- 累计退款金额不能超过原交易剩余可退金额；商家还应避免使用不同 `out_request_no` 对同一交易并发发起多笔退款。
- 独立退款不会触发订阅状态变更；需要同时终止订阅时仍使用 `modify_type=CANCEL`。
- 批量退款查询 `alipay.trade.commercial.batchrefund.query` 提供退款批次状态和明细。支付明细查询用于核对原支付交易。

### 参数错误处理

当前请求参数类失败按订阅业务错误返回。由于部分错误响应可能只给出通用参数非法描述，商家应在调用前本地校验四个必填字段、金额正数和幂等号长度，并记录脱敏请求号用于排查。

---

## 客诉超标自动退款

商户客诉指标超过平台考核标准时，平台根据客诉考核数据对相关订阅订单发起全额退款。退款由平台自动触发，商户无法干预，也无需调用退款接口。通知和查询中通过 `refund_scene=AUTO_PENALTY` 识别，`refund_reason` 包含投诉工单号。用通知中的 `request_no` 查询批次，通过 `details.pay_trade_no` 关联原支付交易，并按 `status` 和实际退款金额处理结果。同一笔退款应避免重复发起。[官方订阅退款说明](https://opendocs.alipay.com/solution/0jdgel?pathHash=846cb48b&ref=api#%E8%AE%A2%E9%98%85%E9%80%80%E6%AC%BE)

## 裸退款接口 (alipay.trade.refund)

办理上述裸退款接口时按[订阅裸退款证书要求](../../onboarding/token-pay/guidance.md#21-接口加签方式必填)配置证书客户端。订阅取消并退款和订阅交易独立退款的默认退款有效期最长为 12 个月，实际以原交易可退款期限和接口校验为准。

| 退款路径 | 接口 | 适用场景 | 是否同步终止订阅 | 退款状态确认方式 |
|---------|------|---------|:-------------:|----------------|
| **订阅取消并退款** | `alipay.trade.subscription.modify`（`modify_type = CANCEL`） | 退款同时需要终止订阅 | ✅ 是 | 批量退款通知或查询的 `status` |
| **订阅交易独立退款** | `alipay.trade.subscription.refund` | 针对订阅内指定已支付交易退款，保持订阅继续运行 | ❌ 否 | 同步先看 `refund_status`，通过批量退款通知或查询的 `status` 确认终态 |
| **裸退款**（本接口） | `alipay.trade.refund` | 仅按原支付单退款，不主动变更订阅状态（如多扣返还、客诉补偿） | ❌ 否 | 同步返回 `fund_change` + 退款查询接口 |

同一笔资金退款应避免跨接口重复发起。

### 核心规则

1. 交易超过约定时间（签约时设置的可退款时间）的订单无法退款
2. 支持单笔交易分多次退款，每次需用不同的 `out_request_no`；同一笔退款重试时 `out_request_no` **不可变更**（保证幂等）
3. 累计退款金额不能超过原始交易总金额
4. 同一笔交易的退款请求至少间隔 **3 秒**
5. 退款原订单涉及分账时，分账接收方需在「支付宝商家平台 > 资金管理 > 资金服务 > 分账接收」中开启**分账回退授权**，且不支持接收方为个人的分账单退款

### 业务请求参数（biz_content）

| 参数 | 类型 | 必选 | 描述 |
|------|------|:----:|------|
| refund_amount | price(16) | 是 | 退款金额（元，两位小数），不能大于订单金额。若正向交易使用了营销，该金额含营销金额，支付宝按规则在买家自有资金与营销资金间分配，默认优先退买家自有资金 |
| out_trade_no | string(64) | 二选一 | 商户订单号，与 trade_no 不能同时为空 |
| trade_no | string(64) | 二选一 | 支付宝交易号，与 out_trade_no 不能同时为空，同时存在时优先取 trade_no |
| refund_reason | string(256) | 否 | 退款原因说明，展示在退款账单详情 |
| out_request_no | string(64) | 部分退款必选 | 退款请求号，交易号下唯一；部分退款必传；重试时不可变更 |
| refund_goods_detail | array | 否 | 退款商品明细（goods_id / refund_amount / out_item_id / out_sku_id / out_certificate_no_list） |
| refund_royalty_parameters | array | 否 | 退分账明细（royalty_type / trans_out / trans_in / amount / royalty_scene 等） |
| query_options | string[] | 否 | 查询选项：`refund_detail_item_list`（退款资金渠道）/ `deposit_back_info`（银行卡冲退信息）/ `refund_voucher_detail_list`（退券信息） |
| related_settle_confirm_no | string(64) | 否 | 账期交易确认结算后退款时，指定结算单号 |

> **退分账**：直付通 / 电脑网站支付 / APP 支付 / 手机网站支付须明确从哪个分账收入方退、退多少；不明确则默认从收款方退款，余额不足则失败，不支持按比率退款。当面付且非直付通模式无需传入，系统自动按比率退款。

### 请求示例

```json
{
  "out_trade_no": "20150320010101001",
  "trade_no": "2014112611001004680073956707",
  "refund_amount": 200.12,
  "refund_reason": "正常退款",
  "out_request_no": "HZ01RF001",
  "query_options": ["refund_detail_item_list"]
}
```

### 响应参数

| 参数 | 类型 | 必选 | 描述 |
|------|------|:----:|------|
| code | String | 是 | 网关返回码，`10000` 表示本次请求成功（不代表退款成功） |
| trade_no | String | 是 | 支付宝交易号 |
| out_trade_no | String | 是 | 商户订单号 |
| buyer_logon_id | String | 是 | 买家登录号（脱敏） |
| refund_fee | price | 是 | 该笔交易累计已退款成功的金额 |
| fund_change | String | 否 | 本次退款是否发生资金变化：`Y` 为退款成功 |
| send_back_fee | String | 否 | 本次商户实际退回金额（需在 query_options 传入 refund_detail_item_list） |
| refund_detail_item_list | array | 否 | 退款资金渠道 |
| refund_voucher_detail_list | array | 否 | 退券信息 |

### 响应示例

**成功响应**：

```json
{
  "alipay_trade_refund_response": {
    "code": "10000",
    "msg": "Success",
    "trade_no": "2013112011001004330000121536",
    "out_trade_no": "6823789339978248",
    "buyer_logon_id": "159****5620",
    "fund_change": "Y",
    "refund_fee": "88.88",
    "send_back_fee": "1.8"
  }
}
```

### 退款成功判断

> ⚠️ `code=10000` 仅代表本次退款**请求**成功，不代表退款成功。

| `fund_change` | 退款状态 | 后续处理 |
|---------------|---------|---------|
| `Y` | 退款成功 | 资金已变化，可视为退款完成 |
| `N` 或无此字段 | 不确定 | 调用退款查询接口确认（需间隔退款请求 **5 秒以上**） |

### 业务错误码

| 错误码 | 错误描述 | 解决方案 |
|--------|---------|---------|
| ACQ.INVALID_PARAMETER | 参数无效 | 检查请求参数后重新发起 |
| ACQ.TRADE_NOT_EXIST | 交易不存在 | 检查 trade_no / out_trade_no |
| ACQ.TRADE_STATUS_ERROR | 交易状态非法 | 查询交易确认是否已付款 |
| ACQ.TRADE_HAS_CLOSE | 交易已关闭 | 交易已关闭不能退款 |
| ACQ.TRADE_HAS_FINISHED | 交易已完结 | 已超退款期限，建议线下退款 |
| ACQ.REFUND_AMT_NOT_EQUAL_TOTAL | 退款金额超限 | 部分退款时 out_request_no 必填；退款金额不能大于交易总金额 |
| ACQ.REASON_TRADE_REFUND_FEE_ERR | 退款金额无效 | 累计退款金额不能大于交易总金额 |
| ACQ.SELLER_BALANCE_NOT_ENOUGH | 卖家余额不足 | 商户账户充值后重新发起 |
| ACQ.DISCORDANT_REPEAT_REQUEST | 请求信息不一致 | 该 out_request_no 已退款成功且金额不一致，检查金额或查询退款结果 |
| ACQ.SYSTEM_ERROR | 系统错误 | 用相同参数重试（out_request_no 与金额不变，接口幂等），或间隔 5 秒以上查询 |
| ACQ.REFUNDALLOC_UNAUTH_LIMIT | 分账接收方未开启分账回退 | 接收方开启分账回退授权后再发起 |
| ACQ.NOT_ALLOW_PARTIAL_REFUND | 不支持部分退款 | 全额退款或线下处理 |

### 与订阅产品的配合

1. 退款对象 `trade_no` / `out_trade_no` 应为订阅正向交易（创建/续费/升级等）产生的交易号，可从订阅变更通知的 `trade_no` 获取
2. 裸退款不会触发 `alipay.trade.subscription.changed`，订阅状态不自动变 `CANCELED`；需终止订阅请用 modify 的 `CANCEL`
3. **取消并退款走异步退款**。按取消响应的 `refund_order_id` 关联批量退款通知或查询的 `request_no`，通过 `status` 确认退款结果。

---

## 公共错误码

创建订阅的客户、价格、商品、重复订阅、席位数量、金额、额度、产品签约、支付产品权限、代调用授权、内容安全和资格校验等可修复问题，当前统一使用 `INVALID_PARAMETER`，并在 `sub_msg` 中给出具体原因。商家不要再依赖 `CUSTOMER_NOT_EXIST`、`PRICE_NOT_EXIST`、`PRODUCT_NOT_SIGNED`、`PERMISSION_DENIED`、`DUPLICATE_SUBSCRIPTION` 或 `PAYMENT_AMOUNT_EXCEEDED` 等旧细分码驱动创建流程；应结合 `sub_msg` 定位字段或前置条件，但不要硬编码整段文案。

| 错误码 | 描述 | 解决方案 |
|--------|------|----------|
| SYSTEM_ERROR | 系统繁忙 | 重试 |
| INVALID_PARAMETER | 参数有误 | 检查参数 |
| APP_ID_NOT_MATCH | 应用ID不匹配 | 检查ID是否属于当前应用 |
| PRODUCT_NOT_EXIST | 商品不存在 | 检查商品ID |
| PRICE_NOT_EXIST | 价格不存在 | 检查价格ID |
