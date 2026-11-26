# 周期订阅公开接入契约

本页的周期价格与订阅状态不适用于[商业订单](single-payment.md)、[余额阈值续购](auto-renewal.md)、[企业支付](b2b/api-contract.md)、[发票](invoice/api-contract.md)和[认证](verification/api-contract.md)。周期订阅用循环价格；商业订单的单次购买通常按单次价格创建。

用于普通商户周期订阅的参数、代码、状态、金额、退款及通知问题。按用户当前任务选择对应章节。


## 章节索引

- 请求参数、应用身份、客户关系：请求与身份
- Java / Spring Boot 实现：Java 代码生成
- 商品名与 metadata：商品与价格默认值
- 扣款模式、试用、金额准入、宽限期、未来生效：周期扣款方、创建订阅
- 升降级、席位、撤销取消、关单与退款：修改、取消与退款
- 创建失败、授权与错误提示：创建错误与可修复提示
- 验签、幂等、取消和宽限期权益：通知

### 请求与身份

- 公共参数放 URL 查询串；业务参数放 POST body 的 `biz_content`。
- 生产接入与验收使用 `https://openapi.alipay.com/gateway.do` 和配套生产应用凭据；周期订阅沙箱联调使用 `https://openapi-sandbox.dl.alipaydev.com/gateway.do` 和配套沙箱应用凭据，具体见 [sandbox-integration.md](sandbox/sandbox-integration.md)。应用、密钥及资源 ID 按环境隔离，不自动回退到生产；凭据仅在调用方服务端安全注入。
- 商家自研使用商家应用的 `app_id` 和密钥。
- `customer_id` 是调用 `alipay.trade.customer.create` 后生成的客户ID，用于标识商户创建的客户；不是支付宝用户ID，也不能作为实际签约支付宝账户的身份证明。回答客户关系或重复订阅问题时，必须按 [api-complete.md](api-complete.md) 区分客户ID、商户用户和实际签约账户。
- 创建或修改周期订阅前，商家应用至少需具备 APP 支付或电脑网站支付中的一种产品权限；两者均未开通时不能生成支付/签约链接。
- 商品、价格、客户和订阅的后续查询、修改、取消和退款必须保持同一应用和商户上下文，禁止跨商户混用资源 ID。

### Java 代码生成

- 生成 Java 或 Spring Boot 代码时，默认使用支付宝官方 Java SDK，并以单例或依赖注入方式复用 `DefaultAlipayClient`。优先使用 SDK 已提供的接口请求/响应类型；当前 SDK 尚未生成类型的新接口，使用实现 `AlipayRequest` 的薄适配器，仍由 SDK 完成签名、HTTP 调用和响应解析。
- 普通公钥模式调用 `alipayClient.execute(request)`；需要证书模式的接口初始化证书客户端并调用 `alipayClient.certificateExecute(request)`。

对明确要求不用 SDK 或缺少官方 SDK 的技术栈，读取[非 SDK 接入](non-sdk-integration.md)。

### 商品与价格默认值

- 用户未提供商品名称时，生成商品创建代码默认使用商品名 `AI会员专业版`。
- 用户未提供商品或价格元数据时，生成的商品创建和价格创建代码都必须显式传入 `metadata` JSON 字符串 `{"default":"default"}`。
- 默认值只用于补全缺省输入；用户已提供商品名称或 `metadata` 时保留用户值。`metadata` 必须传 JSON 字符串，不得传对象或 `null`。

### 周期扣款方

| 模式 | `deduct_type` | 周期扣款动作 |
|---|---|---|
| 支付宝托管（默认） | `SUBSCRIBE_DEDUCT` | 支付宝按周期自动发起 |


### 创建订阅

- 商品价格、扣款周期、试用和累计签约人数先按[商户默认管控规则](merchant-default-controls.md)核对：默认商品价格最高 500 元，周期最短 7 天、最长 3 个月／93 天；不能因接口参数可表达就判定商户可用。

- `items` 当前只支持一个订阅项。
- 周期订阅必须使用带 `recurring` 的循环价格。
- 普通立即生效订阅可用 `pay_amount` 自定义首笔实付金额，不要求设置 `trial_period_days`，后续仍按所选价格和数量续费；不要把普通首期优惠强制改成试用期或优惠券。金额单位为分，具体规则与示例见 [创建订阅](api-complete.md#订阅创建接口-alipaytradesubscriptioncreate) 和 [普通首期优惠示例](api-examples.md#普通首期优惠无试用期)。
- 个体订阅不传 `quantity`；团体席位订阅必须传正整数 `quantity`，商品需配置 `unit_label`。
- `trial_period_days` 为 3-365 的正整数，`trial_desc` 最多 12 个字符。
- `grace_period_days` 用于托管周期扣款续费失败后的宽限期；不传或传 `0` 表示不开启，允许的正数为 `1`、`2`、`3`、`4`、`5`。创建成功不应被解释为任何扣款失败都必然进入宽限期，仍需满足实际周期和续费任务的运行条件。
- 团体席位订阅支持免费和低价试用。试用创建请求同时传 `items.quantity` 与 `trial_period_days`；低价试用的 `pay_amount` 表示全部席位的试用总价，试用结束后的周期扣款金额为价格单价乘席位数量。试用期内不支持独立扩容或缩容，但个体和席位试用均支持套餐升级、降级。
- 零元创建（含免费试用）属于受限能力；只有实际调用商户已获得零元订阅准入时，`pay_amount=0` 进入仅签约链路，不发生首笔真实付款。
- 低价试用需具备试用期订阅准入，默认不支持试用期；试用期不受 3 倍管控，正金额试用仍核对 1.00 元下限。普通正金额首次订阅购买中，系统计算后的首笔实际支付金额必须同时满足：不低于 1.00 元（100 分），且“首笔实际支付金额 x 3 >= 后续周期扣款金额”。两个边界取较高者，恰好等于边界可通过。参数非负只决定支付/签约链路，不代表一定通过业务准入。这里的 1.00 元和 1/3 都是订阅创建管控，不得外推到 `UPGRADE`、`INCREASE_QUANTITY` 或其他修改场景。
- 周期订阅使用商家扣款时，每个商家累计新签用户数的默认上限为 5000；达到上限后会拒绝创建新的订阅，不影响已创建订阅的查询、续费或变更。需要扩容时引导商家按[累计新签人数上限的办理指引](troubleshooting.md#累计新签人数上限)核对并申请，不得通过更换客户或拆分请求绕过。
- 创建被准入或额度拦截时，按接口实际返回确认能力和金额，不要通过更换 `customer_id`、`price_id`、拆分请求或反复重试绕过。
- 创建订阅时，`coupon_id` 分别与 `pay_amount`、`quantity`、`trial_period_days` 互斥；`quantity` 与 `trial_period_days` 可以同时传入席位试用请求。
- `effective_type` 不传时为 `IMMEDIATE_EFFECTIVE`；未来生效传 `SCHEDULED_EFFECTIVE` 并按 [scheduled-effective.md](scheduled-effective.md) 校验。未来生效时不得显式传 `pay_amount`，包括 0。
- 未来生效在创建日由系统生成技术零元签约流程，因此也需实际调用商户具备零元订阅准入；商户仍不得传 `pay_amount`。创建响应中的 0 元不代表真实付款或权益生效；到未来生效日并确认首笔真实扣款后再开通权益。
- 未来生效首笔真实扣款前，查询和通知中的周期字段属于过渡状态；`current_period_end` 可能指向未来生效日，不能当作已付费权益截止日。

### 修改、取消与退款

- 单独修改宽限期使用 `modify_type=UPDATE_GRACE_PERIOD`，且请求只携带 `subscription_id`、可选 `customer_id` 和 `grace_period_days`；不得与升级、降级、席位或取消字段混传。订阅处于 `ACTIVE`、`TRIALING` 或 `PAST_DUE` 时可修改；已经进入 `PAST_DUE` 的本轮宽限期按进入时的配置执行，新值从后续周期起生效。
- 升级和扩容的最终金额只要求不得小于 0：金额为 0 时仅签约，正数时支付并签约；不携券且未传 `pay_amount` 时仍由系统计算差价。升级/扩容不适用创建场景的 1.00 元最低首笔金额和 1/3 比例规则，不得因为本次变更金额低于后续周期扣款金额的 1/3 而断言请求会被拒绝。零元升级/扩容也不得被解释为需要“零元创建准入”；如实际调用另有拦截，以接口返回和正式接入资料为准。
- 修改订阅用券按操作区分：`UPGRADE` / `INCREASE_QUANTITY` 携带 `items[].coupon_id` 时必须同时传非负 `pay_amount`（分），当次实付按该金额执行，不再减券优惠；`DOWNGRADE` / `DECREASE_QUANTITY` 携券时禁止传 `pay_amount`，且只支持 `repeating` / `forever`，不支持一次性 `once`。创建订阅的用券互斥规则不能套用到修改操作。
- 席位订阅使用 `UPGRADE` / `DOWNGRADE` 更换价格方案时，`source_quantity` / `target_quantity` 要么同时传、要么同时不传；同时不传表示保持查询到的当前生效数量，同时传时 `source_quantity` 必须等于当前生效数量。操作类型决定生效时机：`UPGRADE` 立即生效并计算整单差价，`DOWNGRADE` 下周期生效，不按数量增减方向推断操作类型。
- 个体和席位的免费、低价试用均支持套餐 `DOWNGRADE`。确认后剩余试用期继续使用当前套餐和数量，目标套餐和目标数量在 `trial_end` 生效；试用期套餐升降级不得传 `preserve_billing_cycle=true`。试用期独立 `INCREASE_QUANTITY` / `DECREASE_QUANTITY` 仍不支持。生效订阅单独扩容的周期参数与差额计算见[团体席位扩容](seats.md)。
- 仅调整席位数量时继续使用 `INCREASE_QUANTITY` / `DECREASE_QUANTITY`；前者立即生效，后者下周期生效。
- 降级和缩容下周期生效；查询中的 `items` 表示当前生效项，`pending_items` 表示待生效项。任何席位修改完成或生效后都要通过通知或查询保存最新 `item_id`、价格和数量。
- 已存在待生效降级或缩容时，如果商家先设置周期末取消、随后通过 `REVERT_CANCEL` 撤销取消，恢复的是当前 `items`；原 `pending_items` 同时失效，不会在周期末生效。收到 `item_cancel_revert` 后必须重新查询，并清除商家本地保存的原待生效变更。
- 取消统一调用 `alipay.trade.subscription.modify` 且 `modify_type=CANCEL`；`cancel_at_period_end` 必传。
- `cancel_at_period_end=true` 表示周期末取消；`false` 表示立即取消，并可异步发起退款。
- 周期末取消有两阶段通知：预约成功时发送 `change_type=cancel_at_period_end`，订阅仍可用；到 `current_period_end` 真正取消生效后，再发送 `change_type=cancel`，此时订阅状态为 `CANCELED`。
- `change_type=cancel` 表示“取消已生效”，既包括立即取消成功，也包括周期末取消到期生效；不得解释为仅在立即取消时触发。
- `REVERT_CANCEL` 只用于撤销尚未生效的周期末取消预约，不用于把已经进入 `CANCELED` 的订阅直接恢复为 `ACTIVE` 或 `TRIALING`。请求必须传 `cancel_at_period_end=false`，原 `subscription_id` 不变，也不会创建一笔新订阅。
- `REVERT_CANCEL` 同步接口成功只表示已生成新的签约入口，不表示订阅已经恢复。必须把响应中的 `alipay_schema` / `alipay_jump_schema` 交给用户重新确认签约：PC 场景通常展示二维码供用户扫码，移动端可直接拉起支付宝。收到 `change_type=item_cancel_revert` 或主动查询确认后，才能按恢复成功处理。
- 立即取消并退款时，订阅取消通过 `alipay.trade.subscription.changed` 确认，退款通过批量退款通知或查询确认。
- `PAST_DUE` 期间不支持升级、降级、扩缩容或撤销取消。此时发起取消会立即生效，即使请求了周期末取消也不会继续等待；同时不支持携带 `refund_amount`。
- 对订阅下某笔已支付正向交易做独立退款，使用 `alipay.trade.subscription.refund`，请求包含 `subscription_id`、`trade_no`、以分计且大于 0 的 `refund_amount` 和最长 64 字符的幂等号 `out_request_no`。订阅权益、生命周期和周期保持原状态。同步响应的 `refund_status` 表示当前退款状态，`PENDING` 和 `PROCESSING` 表示退款仍在处理。
- 同一独立退款重试必须复用相同 `out_request_no`、`trade_no` 和金额；同一幂等号改交易或改金额会被拒绝。累计退款不得超过原交易剩余可退金额，商家还应避免对同一交易并发提交多个不同幂等号的退款。
- 当前公开契约下，取消退款、独立退款及客诉超标自动退款都可通过 `alipay.trade.commercial.batchrefund.changed` 或 `alipay.trade.commercial.batchrefund.query` 的 `status` 确认终态。商户主动退款通过发起响应的 `refund_order_id` 关联 `request_no`。查询返回 `INIT` 或 `PROCESSING` 时保持处理中。
- 客诉指标超出平台考核标准时，平台对相关订阅订单发起全额退款。商户通过通知或查询中的 `refund_scene=AUTO_PENALTY` 识别，`refund_reason` 包含投诉工单号，可按通知中的 `request_no` 查询退款结果。
- `alipay.trade.refund` 是裸退款，只退某笔支付，不自动取消订阅，也不触发订阅状态变更。

### 创建错误与可修复提示

- 创建订阅时，客户、价格、商品、重复订阅、席位数量、金额、额度、产品签约、支付产品权限、代调用授权、内容安全和资格校验等可由商家修复的问题，统一按 `INVALID_PARAMETER` 返回，并通过 `sub_msg` 给出具体原因和处理方向。
- 不要指导商家继续依赖 `CUSTOMER_NOT_EXIST`、`PRICE_NOT_EXIST`、`PRODUCT_NOT_SIGNED`、`PERMISSION_DENIED`、`DUPLICATE_SUBSCRIPTION`、`PAYMENT_AMOUNT_EXCEEDED` 等旧细分错误码来驱动创建流程。应先按 `sub_code` 区分参数/业务问题和系统问题，再根据 `sub_msg` 定位字段或前置条件；展示或记录提示可以，避免硬编码完整文案和标点。
- 遇到 `SCHEMA_ASSEMBLE_FAILED` 时，一般优先判断商户尚未完成代调用授权，先引导商户按照[代调用授权操作指南](https://opendocs.alipay.com/pre-open/0jt7es)完成授权，再核对实际调用应用和产品权限。该经验用于确定首要排查路径，不得表述为此错误的唯一原因。
- 明确的商家配置缺失可提示完成对应产品签约、支付产品开通或代调用授权；下游查询超时、RPC 故障等系统异常不能伪装成商家配置错误，应保留请求号并按系统错误重试或升级排查。

### 通知

- 对通知使用支付宝公钥或证书验签，按业务主键做幂等，成功受理后精确返回 `HTTP 200` 和文本 `success`。
- 不能只依赖单次通知；关键状态需要用查询接口补偿。
- 收到 `cancel_at_period_end` 时只标记待取消并保留当前周期权益；收到最终 `cancel` 或查询确认状态为 `CANCELED` 后再收回权益。
- 收到 `past_due` 时将订阅标记为 `PAST_DUE`，读取 `grace_period_days` / `grace_period_end` 并按宽限期策略保留或限制权益；宽限期恢复扣款成功后会收到 `period_extend`，到期未恢复则收到最终 `cancel`。不要在 `past_due` 到达时直接按取消处理。
- 立即取消涉及退款时，订阅取消与退款结果是两个独立事件，都必须验签、幂等并分别更新状态。
