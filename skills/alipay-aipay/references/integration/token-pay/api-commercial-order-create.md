# 商业订单创建接口

本文只说明 `alipay.trade.commercial.order.create` 的当前公开可观察行为。公共参数、签名、网关响应包裹和验签规则沿用 [单笔支付接入指南](single-payment.md)。

## 目录

- [先选创建路径](#先选创建路径)
- [请求参数](#请求参数)
- [灵活定价与金额](#灵活定价与金额)
- [UI 模式与响应字段](#ui-模式与响应字段)
- [`HOSTED` 托管页面流程](#hosted-托管页面流程)
- [企业支付扩展参数](#企业支付扩展参数)
- [直接生成支付载体时的附加校验](#直接生成支付载体时的附加校验)
- [最小请求与响应](#最小请求与响应)
- [错误与排查](#错误与排查)
- [幂等、支付确认与回调](#幂等支付确认与回调)
- [回答与代码生成要求](#回答与代码生成要求)

## 先选创建路径

这个接口有两条行为完全不同的创建路径。`price_id` 和 `page_code` 不是同一个参数的两种写法，区别在于“价格是否在调用接口前已经确定”：

- **`price_id` 直建单笔支付**：商家在调用前已经确定唯一的单次价格，直接传该 `price_id` 创建一笔 `ONE_TIME/PENDING_PAY` 支付订单。用户进入收银台后支付这个固定价格，不再经过价格表选价。
- **`page_code` 价格表选价**：商家调用时不指定 `price_id`，而是传商家平台中价格表的页面编码。接口先创建 `SUBSCRIPTION/PRE_CREATED` 预订单；用户打开托管页面并选择价格后，订单才推进为真实待支付订单。

先根据目标选择路径，再选择 `ui_mode`。

| 路径 | 最小业务参数 | 创建结果 | 支持的 `ui_mode` |
|---|---|---|---|
| `price_id` 直建单笔支付 | `customer_id`、`price_id` | `ONE_TIME` + `PENDING_PAY` | `HOSTED`、`QR_CODE`、`PAGE`、`APP_SCHEMA` |
| `page_code` 价格表选价 | `customer_id`、`page_code` | `SUBSCRIPTION` + `PRE_CREATED` | 仅 `HOSTED` |

- 调用方应只传 `price_id` 或 `page_code` 其中一个。当前行为在两者都传时优先进入 `price_id` 路径，但混传还会影响收银台地址语义；不要依赖该优先级。
- 两者都不传时返回 `INVALID_PARAMETER`。
- `page_code` 是价格表页面编码，`ui_mode=PAGE` 是电脑网站支付页返回方式，两者不是同一个概念。
- `order_type` 不是路径选择开关。它即使传入也会被服务端覆盖：`price_id` 路径写为 `ONE_TIME`，`page_code` 路径写为 `SUBSCRIPTION`。生成请求时省略该字段。

## 请求参数

业务字段放在 `biz_content` JSON 中，本 Skill 的对外示例统一使用 OpenAPI 的 snake_case 字段名。服务端语言属性名本身不能证明线上 wire name；使用强类型 SDK 时，以当前正式 SDK 的字段映射和实际网关联调结果为准，不要把 Java camelCase 属性直接写进 `biz_content`。

| 字段 | 类型 | `price_id` 直建 | `page_code` 价格表 | 当前行为 |
|---|---|:---:|:---:|---|
| `customer_id` | String | 必填 | 必填 | 客户必须存在并属于当前商户 |
| `price_id` | String | 必填 | 不传 | 价格必须存在、启用并属于当前商户；循环价格会被拒绝 |
| `page_code` | String | 不传 | 必填 | 页面编码必须存在并属于当前商户 |
| `order_type` | String | 省略 | 省略 | 兼容字段；当前会被服务端覆盖，不用于选择订单类型 |
| `quantity` | Integer | 可选 | 不生效 | 缺省为 1；当前创建层未显式校验正整数，调用方应只传正整数 |
| `hook_url` | String | 可选但不要依赖 | 不生效 | 直建路径只保存该值；当前创建与支付成功流程不会据此注册或调用 HTTP 回调 |
| `metadata` | String | 可选 | 不生效 | 作为不透明字符串保存；当前不解析 JSON。一次性订单支付成功通知会原样带回非空值 |
| `redirect_url` | String | 可选 | 可选 | 显式传入时，`HOSTED` 会保存该地址并提供给托管页面；`PAGE` 将其作为支付完成回跳地址；`QR_CODE`、`APP_SCHEMA` 不使用。价格表主流程仍应先在商家平台配置回跳地址；若同时传此字段，应保持一致 |
| `ui_mode` | String | 可选 | 只能省略或传 `HOSTED` | 缺省为 `HOSTED`；解析不区分大小写，示例统一用规范大写值 |
| `initiator_type` | String | 可选 | 可选 | 缺省按 `HUMAN` 保存；使用 Agent 发起时传精确值 `AGENT` |
| `agent_type` | String | 条件必填 | 条件必填 | `initiator_type=AGENT` 时不能为空；已知值包括 `OpenClaw`、`ClaudeCode` |
| `promo_params` | String | 不生效 | 不生效 | 字段可被接收，但不参与当前创建和支付参数组装；不要依赖 |
| `order_amount` | Long | 灵活定价时必填 | 不生效 | 单位为分；固定价格禁止传，具体规则见下文 |
| `extend_params` | String | 可选 | 不生效 | JSON 字符串；当前只有 `PAGE` 模式消费企业支付参数，具体规则见下文 |

不要把“当前未显式校验”解释为对任意值的承诺。对 `quantity`、URL、`metadata` 和 Agent 类型仍应遵循开放平台正式接入资料；不要在回答中虚构代码没有实施的长度或格式限制。

不要在 `biz_content` 中传 `app_id` 或商户身份字段：应用与商户身份来自已签名的 OpenAPI 调用上下文，订单币种当前固定为 `CNY`。

## 灵活定价与金额

`order_amount` 是否需要传，由 `price_id` 对应价格的灵活定价配置决定：

- 灵活定价已启用：必须传 `order_amount`。
- 灵活定价未启用：禁止传 `order_amount`，单价取价格配置的 `unit_amount`。
- `order_amount` 必须大于 0，且不能超过 `10000000000` 分；配置了最低价或最高价时还必须落在该区间内。
- 当前执行逻辑把 `order_amount` 当作每件单价：订单总金额 = `order_amount × quantity`，而不是把它当作整单总额。
- 直接生成支付载体的支付链路另有 `99999999.99` 元上限。为避免订单创建后在 `QR_CODE`、`PAGE` 或 `APP_SCHEMA` 阶段失败，整单总金额不要超过该值。

示例：`order_amount=5000`、`quantity=2` 时，每件 50.00 元，整单 100.00 元。

## UI 模式与响应字段

`ui_mode` 的规范值使用大写；当前解析不区分大小写，但生成代码和示例统一使用以下值。非空值不会先去除首尾空白，不要传 `" HOSTED "` 之类的值。

| `ui_mode` | 可用路径 | 模式专有响应字段 | 说明 |
|---|---|---|---|
| `HOSTED`（默认） | `price_id`、`page_code` | `checkout_url`、`expire_time` | 返回托管收银台地址；收到后应立即使用 |
| `QR_CODE` | 仅 `price_id` | `qr_code` | 返回可直接渲染的支付二维码内容 |
| `PAGE` | 仅 `price_id` | `checkout_url` | 返回电脑网站支付 URL，不返回 `expire_time`；`redirect_url` 作为支付完成回跳地址 |
| `APP_SCHEMA` | 仅 `price_id` | `alipay_schema`、`alipay_jump_schema` | 返回支付宝 App 支付入口；两者可能相同，`alipay_jump_schema` 是原始长链 |

所有成功响应还会返回：

| 字段 | 类型 | 说明 |
|---|---|---|
| `order_no` | String | 服务端生成的订单号；作为不透明业务主键保存，不要解析其格式 |
| `order_type` | String | `price_id` 路径为 `ONE_TIME`；`page_code` 路径为 `SUBSCRIPTION` |
| `status` | String | `price_id` 路径为 `PENDING_PAY`；`page_code` 路径为 `PRE_CREATED` |

模式专有字段按分支返回。`theme_config` 当前不会由这个 OpenAPI 创建响应赋值；价格表主题由托管收银台后续加载，不要等待创建响应返回 `theme_config`。

当前 `HOSTED` 响应把 `expire_time` 计算为创建后 2 小时，但实际收银台会话按订单类型分别在约 1 小时（`ONE_TIME`）或 15 分钟（`SUBSCRIPTION`）失效。两处实现不一致，因此不要对外承诺 2 小时有效，也不要按响应时间安排延迟跳转；返回链接应立即使用，失效后按商户侧去重策略重新发起。

`page_code` 预订单只是价格表收银台入口：用户在收银台选定价格后，订单才从 `PRE_CREATED` 推进到 `PENDING_PAY`。创建接口成功不表示订阅已创建、支付已完成或权益已生效。

## `HOSTED` 托管页面流程

`HOSTED` 是页面交付方式，不是第三条订单创建路径。接口成功后返回支付宝托管页面的 `checkout_url`：`price_id` 路径是固定价格支付页，`page_code` 路径是价格表选价页。商家无需自行开发相应 Hosted 页面。拿到地址后建议立即为当前用户打开，不能手工拼接 URL，也不要只把地址展示成一段文本让用户复制。

### 固定价格：`price_id` 直建

1. 创建并启用一个不带 `recurring` 的单次价格，得到 `price_id`。
2. 调用本接口，传 `customer_id`、该 `price_id` 和 `ui_mode=HOSTED`；需要支付后返回商家页面时再传 `redirect_url`，否则可以省略。
3. 接口直接创建一笔 `ONE_TIME/PENDING_PAY` 单笔支付，并返回 `checkout_url`。
4. 商家立即跳转或打开原样返回的 `checkout_url`。页面展示已经确定的价格，不再让用户从价格表选择套餐。
5. 用户完成支付后，若请求传了 `redirect_url`，托管页面可回到商家页面；商家仍需通过商业订单查询和正式通知确认支付结果。

### 多价格选择：`page_code` 价格表

1. 进入[商家平台价格表管理](https://b.alipay.com/page/checkout-management/price-management/list)，创建价格表、关联可选价格，并提前配置支付结果回跳地址。
2. 保存价格表后取得页面编码 `page_code`。这里需要的是页面编码，不是 `price_id`，也不是后台展示用的价格表名称。
3. 调用本接口，传 `customer_id`、`page_code`、`ui_mode=HOSTED`。不要同时传 `price_id`，也不要用 `order_type` 选择订阅。
4. 验签成功后保存 `order_no`，并立即为用户跳转或打开响应中原样返回的 `checkout_url`。
5. 用户在托管页面选择价格并完成支付与订阅签约；选价前的 `PRE_CREATED` 不代表已经形成有效订阅。
6. 页面操作完成后回到商家平台预先配置的商家页面。浏览器回跳只负责用户体验，不能作为支付或签约成功依据；最终状态仍以订阅通知和订单/订阅查询为准。

`redirect_url` 是可选兼容字段：如果创建请求显式传入，当前服务会保存该值并提供给 Hosted 页面。若使用此字段，请传入与商家平台成功回跳配置一致的地址；不要用它判断支付是否成功。

## 企业支付扩展参数

当前支持的外层字段是 JSON 字符串 `extend_params`，嵌套键保持 camelCase：

```json
{
  "extend_params": "{\"paySolutions\":[\"ENTERPRISE_PAY\"]}"
}
```

当前行为边界：

- 只有 `price_id` + `ui_mode=PAGE` 会把 `paySolutions` 中的 `ENTERPRISE_PAY` 转换为企业支付参数。
- `HOSTED`、`QR_CODE`、`APP_SCHEMA` 和 `page_code` 路径不消费该企业支付标识。
- JSON 解析失败时当前不会返回参数错误，而是按未提供扩展参数继续；因此调用方必须在发送前自行校验 JSON，并在联调时验证实际支付方式，不能把接口成功当作企业支付已生效。
- `paySolutions` 匹配区分大小写，使用精确值 `ENTERPRISE_PAY`。

## 直接生成支付载体时的附加校验

`QR_CODE`、`PAGE` 和 `APP_SCHEMA` 会在订单落库后立即生成支付载体，因此还会受支付参数校验影响：

- 商品名称作为支付标题，必须非空、长度不超过 256，且不能包含 `/`、`=`、`&`；商品查询失败时以 `order_no` 兜底。
- `QR_CODE` 和 `APP_SCHEMA` 使用商品描述作为支付描述，非空时长度不能超过 600；`PAGE` 当前未执行这条描述长度校验。
- 整单金额必须大于 0 且不超过 `99999999.99` 元。

这些校验发生在订单建立之后。标题、描述或金额不合规时，接口可能返回 `QR_CODE_GENERATE_FAILED`、`APP_SCHEMA_GENERATE_FAILED` 或 `SYSTEM_ERROR`，但订单已经存在。

## 最小请求与响应

### `price_id` + `HOSTED`

请求 `biz_content`：

```json
{
  "customer_id": "YOUR_CUSTOMER_ID",
  "price_id": "YOUR_ONE_TIME_PRICE_ID",
  "ui_mode": "HOSTED",
  "redirect_url": "https://merchant.example/return"
}
```

`redirect_url` 是可选字段；上例因为需要支付后回到商家页面才传入。

网关响应：

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

### `page_code` + `HOSTED`

请求 `biz_content`：

```json
{
  "customer_id": "YOUR_CUSTOMER_ID",
  "page_code": "YOUR_PAGE_CODE",
  "ui_mode": "HOSTED"
}
```

价格表回跳地址应预先在商家平台配置。若接入方还需要显式传 `redirect_url`，其值应与平台成功回跳配置保持一致。

网关响应：

```json
{
  "alipay_trade_commercial_order_create_response": {
    "code": "10000",
    "msg": "Success",
    "order_no": "YOUR_ORDER_NO",
    "order_type": "SUBSCRIPTION",
    "status": "PRE_CREATED",
    "checkout_url": "RETURNED_CHECKOUT_URL",
    "expire_time": "RETURNED_EXPIRE_TIME"
  },
  "sign": "RETURNED_SIGN"
}
```

### 灵活定价 + `PAGE` + 企业支付

```json
{
  "customer_id": "YOUR_CUSTOMER_ID",
  "price_id": "YOUR_FLEXIBLE_PRICE_ID",
  "quantity": 2,
  "order_amount": 5000,
  "ui_mode": "PAGE",
  "redirect_url": "https://merchant.example/return",
  "extend_params": "{\"paySolutions\":[\"ENTERPRISE_PAY\"]}"
}
```

## 错误与排查

| 错误码 | 当前常见触发条件 | 处理 |
|---|---|---|
| `INVALID_PARAMETER` | 缺少两种路径标识、非法 `ui_mode`、`page_code` 搭配非 `HOSTED`、`AGENT` 未传 `agent_type`、资源不属于当前商户、循环价格、灵活定价金额不合规 | 按本页的路径、模式和金额规则修正请求；不要原样重试 |
| `PRICE_NOT_FOUND` | 价格不存在或已停用 | 查询价格并确认当前商户归属与启用状态 |
| `CUSTOMER_NOT_FOUND` | 客户不存在 | 使用当前商户创建并可查询到的客户ID |
| `QR_CODE_GENERATE_FAILED` | 二维码支付载体生成失败 | 检查金额、商品标题和相关支付能力；必要时改用 `HOSTED` 继续定位 |
| `APP_SCHEMA_GENERATE_FAILED` | App 支付入口生成失败或返回空结果 | 检查 App 支付能力与应用配置；不要把空链接交给客户端 |
| `SYSTEM_ERROR` | 其他未归类异常；`PAGE` 下游失败也可能被映射到此码 | 记录 `sub_code`、`sub_msg` 和商户侧请求关联信息，谨慎重试并查询是否已拿到订单号 |

`PRODUCT_NOT_SIGNED` 当前不是此创建流程直接抛出的错误，`SUBSCRIPTION_CREATE_FAILED` 也不会从当前 `page_code + HOSTED` 创建分支产生；不要把错误枚举全集当作本接口实际错误集合。

## 幂等、支付确认与回调

- 请求中没有商户请求号或幂等键。每次被接受的创建调用都会生成新的 `order_no`，调用方必须在自己的业务单号维度做互斥和去重，网络超时时不要盲目自动重放。
- 订单或预订单先建立，随后才生成二维码、支付页、App 入口或托管会话；后半段失败不会撤销已建立的订单。一次失败响应之后直接重试，可能再产生一个新订单。
- 收到 `order_no` 后立即持久化，并按标准网关响应验签。创建成功只代表订单或预订单已建立。
- 支付结果以 `alipay.trade.commercial.order.query` 查询为准；浏览器 `redirect_url` 回跳不能作为支付成功依据。
- `hook_url` 当前不会为该订单注册 HTTP 通知。不要因为传了它就省略查询补偿；当前商业订单变更通知只覆盖 `ONE_TIME` 支付成功，`page_code` 的订阅路径应使用订阅通知与订阅查询。所有通知仍需验签、幂等，并用查询接口补偿。

## 回答与代码生成要求

1. 先问清或推断用户使用 `price_id` 直建单笔支付还是 `page_code` 价格表选价，再给参数；不要要求用户用 `order_type` 选择路径。
2. 再选择 `HOSTED`、`QR_CODE`、`PAGE` 或 `APP_SCHEMA`，并只展示该模式会返回的专有字段。
3. 明确 `order_amount` 是分、当前按每件单价参与 `quantity` 乘法；不要写成整单金额。
4. 对 `promo_params`、`hook_url`、非 `PAGE` 的企业支付参数和创建响应 `theme_config`，明确当前不生效或不返回，不得承诺。
5. 将代码没有显式实施的校验写成调用方建议，不要伪装成服务端强制契约。
6. 回答 `page_code + HOSTED` 时必须给出完整链路：商家平台创建价格表并取得 `page_code` → 调用接口 → 原样、立即打开 `checkout_url` → 用户在页面选价并支付签约 → 回跳商家页面 → 通知与查询确认终态。
