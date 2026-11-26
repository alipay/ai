# 订阅消息通知完整指南

本文档详细说明支付宝订阅产品的消息通知机制，包括面向商户的事件通知和面向用户（买家）的直接通知两大通道。

---

## 一、消息通道概览

支付宝订阅产品的通知分为 **商家异步通知** 和 **用户提醒** 两类：

| 通知类型 | 说明 | 接收方式 | 目标对象 |
|------|------|---------|---------|
| **商家异步通知** | 订阅状态及退款结果变化 | 开放平台应用网关 | 创建订阅的商户应用，或代开发的第三方应用（见[服务商接收说明](#22-服务商模式下的通知接收)） |
| **用户提醒** | 扣款前提醒、续费失败提醒 | 支付宝站内消息、短信或邮件 | 用户（买家） |

---

## 二、商家异步通知

### 2.1 消息 API 概览

| 消息 API | 说明 | 触发场景 |
|----------|------|---------|
| `alipay.trade.subscription.changed` | 订阅变更事件通知 | 订阅状态变更（生效、续费、升级、降级、取消等） |
| `alipay.trade.commercial.batchrefund.changed` | 批量退款状态通知 | 取消退款、独立退款或客诉超标自动退款到达终态，消息体见 5.2 节 |

> ⚠️ **收不到通知的根因排查（接入中最常见）**：商户在商家后台须同时满足两项配置，缺一不可——
> 1. **应用网关地址** 已正确配置为商户接收通知的公网可访问 http(s) 地址（异步通知推送到此处）；
> 2. **相关消息已订阅**：在开放平台应用详情 → 开发设置 → 消息订阅中勾选 `alipay.trade.subscription.changed`，否则支付宝不会推送任何订阅变更回调。
>
> ⚠️ **别查错地址——异步通知推送到「应用网关地址」，不是「授权回调地址」**。两者是两个独立配置、商户经常混淆：「应用网关地址」用于接收支付宝异步通知消息（From 平台消息等）；「授权回调地址」仅用于 OAuth2.0 授权流程（用户授权后带回 `auth_code`），与订阅通知无关。排查时请按**「应用网关地址」**确认。
>
> 两项都要确认。详见 [troubleshooting.md](troubleshooting.md)「异步通知收不到」。

### 2.2 服务商模式下的通知接收

服务商通过第三方应用代商家创建订阅时，相关异步通知发送到**创建该订阅时使用的第三方应用**。服务商需在该第三方应用下订阅对应消息，并配置可用的应用网关地址；不要只在被代开发商家的应用下配置通知。

立即取消伴随退款时，服务商与商户都要分别核对：订阅变更通知的 `change_type=cancel` 证明取消；批量退款结果通知或查询证明退款结果。两项不能互相替代。

### 2.3 change_type 枚举定义

| change_type | 含义 | 典型触发时机 |
|-------------|------|------------|
| `active` | 订阅已生效 | 首次支付成功 / 试用期续费转正式 |
| `trialing` | 试用期生效 | 免费试用签约成功 / 付费试用首次支付成功 |
| `period_extend` | 订阅续费成功 | 普通续费支付成功 |
| `item_update` | 订阅项更新（升级）成功 | 升级支付成功 |
| `cancel` | 订阅取消已生效 | 立即取消成功 / 周期末取消到期生效 |
| `cancel_at_period_end` | 订阅将在周期末取消 | 延迟取消 / 支付宝侧用户取消代扣 |
| `item_downgrade` | 订阅降级成功 | 降级签约成功（下周期生效） |
| `item_cancel_revert` | 撤销取消成功 | 用户重新签约恢复订阅 |
| `past_due` | 订阅进入续费宽限期 | 已配置宽限期的托管续费在周期结束后仍未支付 |

---

## 三、全部通知场景明细

### 场景 1：首次支付成功 — 订阅生效

| 项目 | 说明 |
|------|------|
| **消息 API** | `alipay.trade.subscription.changed` |
| **change_type** | `active` |
| **触发时机** | 用户首次支付成功后 |
| **bizNo** | paymentOrderId |
| **携带数据** | subscription 全量信息 + paymentOrder（trade_no, order_no, out_trade_no, pay_amount） |

### 场景 2：免费试用签约成功 — 试用期生效

| 项目 | 说明 |
|------|------|
| **消息 API** | `alipay.trade.subscription.changed` |
| **change_type** | `trialing` |
| **触发时机** | 免费试用期签约成功（INCOMPLETE → TRIALING），无需支付 |
| **bizNo** | subscriptionId |
| **携带数据** | subscription 全量信息 + validItems |

> 注意：免费试用签约成功时没有支付单。

### 场景 3：付费试用首次支付成功 — 试用期生效

| 项目 | 说明 |
|------|------|
| **消息 API** | `alipay.trade.subscription.changed` |
| **change_type** | `trialing` |
| **触发时机** | 付费试用（isTrial=true 和 pay_amount>0）首次支付成功 |
| **bizNo** | paymentOrderId |
| **携带数据** | subscription 全量信息 + paymentOrder |

> 与场景 2 的区别：场景 2 是免费试用（无支付），场景 3 是付费试用（有支付单），但 change_type 都是 `trialing`。

### 场景 4：普通续费支付成功

| 项目 | 说明 |
|------|------|
| **消息 API** | `alipay.trade.subscription.changed` |
| **change_type** | `period_extend` |
| **触发时机** | 周期扣款支付成功后 |
| **bizNo** | paymentOrderId |
| **携带数据** | subscription 全量信息 + paymentOrder |

### 场景 5：试用期续费转正式

| 项目 | 说明 |
|------|------|
| **消息 API** | `alipay.trade.subscription.changed` |
| **change_type** | `active` |
| **触发时机** | 试用期续费支付成功（TRIALING → ACTIVE） |
| **bizNo** | paymentOrderId |
| **携带数据** | subscription 全量信息 + paymentOrder |

> 注意：虽然也是 `active` 类型，但与场景 1 不同，此场景表示从试用期转为正式订阅。

### 场景 6：升级支付成功

| 项目 | 说明 |
|------|------|
| **消息 API** | `alipay.trade.subscription.changed` |
| **change_type** | `item_update` |
| **触发时机** | 升级支付成功后 |
| **bizNo** | paymentOrderId |
| **携带数据** | subscription 全量信息 + paymentOrder + 升级后的订阅项 |

### 场景 7：降级签约成功

| 项目 | 说明 |
|------|------|
| **消息 API** | `alipay.trade.subscription.changed` |
| **change_type** | `item_downgrade` |
| **触发时机** | 降级协议签约处理成功后（下周期生效） |
| **bizNo** | subscriptionId |
| **携带数据** | subscription 全量信息 + paymentOrder + 降级后的订阅项（PENDING） |
| **特殊处理** | 通知前会将 currentPeriodStart/End 更新为下周期时间，与 item 语义保持一致 |

> 注意：降级是下周期生效，通知中的时间已调整为下周期，商户端据此更新展示。

### 场景 8：撤销取消 — 恢复订阅

商家调用 `REVERT_CANCEL` 的同步接口成功只表示新的签约入口生成成功，不表示订阅已经恢复。应将入口交给用户重新确认签约；原 `subscription_id` 不变，不创建新订阅。PC 场景通常展示二维码供用户扫码，移动端可直接拉起支付宝。只有收到以下 `item_cancel_revert` 通知或主动查询确认后，才能按恢复成功处理。该操作仅适用于尚未生效的周期末取消预约，订阅已经进入 `CANCELED` 后不能通过它恢复。

| 项目 | 说明 |
|------|------|
| **消息 API** | `alipay.trade.subscription.changed` |
| **change_type** | `item_cancel_revert` |
| **触发时机** | 用户在取消后重新签约，撤销取消成功 |
| **bizNo** | subscriptionId |
| **携带数据** | subscription 全量信息 + paymentOrder + validItems |
| **特殊处理** | 通知前会将 currentPeriodStart/End 更新为下周期时间，与 item 语义保持一致 |

> 如果恢复前存在尚未生效的套餐降级或席位缩容，撤销取消后恢复当前生效项，原待生效项失效。商家收到 `item_cancel_revert` 后应主动查询订阅，以最新 `items` / `pending_items` 覆盖本地状态，不要继续执行恢复前保存的待生效变更。

### 场景 9：周期末取消预约 — 订阅待取消

| 项目 | 说明 |
|------|------|
| **消息 API** | `alipay.trade.subscription.changed` |
| **change_type** | `cancel_at_period_end` |
| **触发时机** | ① 商户侧调用周期末取消（cancel_at_period_end=true）；② 用户在支付宝侧取消代扣 |
| **bizNo** | subscriptionId |
| **携带数据** | subscription 全量信息 + validItems |

> 这是周期末取消的第一阶段通知，表示取消预约已设置成功。订阅尚未取消，当前周期内仍应保留用户权益。
>
> 周期末取消的完整通知流程：
>
> | 阶段 | 触发时机 | change_type | 订阅状态与商家处理 |
> |------|----------|-------------|--------------------|
> | 设置取消预约 | 调用周期末取消成功 / 支付宝侧用户取消代扣 | `cancel_at_period_end` | 标记待取消，保留当前周期权益 |
> | 取消实际生效 | 到达 `current_period_end` 并完成取消 | `cancel` | 状态为 `CANCELED`，收回权益 |

### 场景 10：取消生效 — 订阅已取消

| 项目 | 说明 |
|------|------|
| **消息 API** | `alipay.trade.subscription.changed` |
| **change_type** | `cancel` |
| **触发时机** | 立即取消成功，或周期末取消到期生效 |
| **bizNo** | subscriptionId |
| **携带数据** | subscription 全量信息 + validItems；立即取消如有退款，还会携带 refundPaymentOrder |

> `cancel` 表示取消已经生效，不应根据该值判断是立即取消还是周期末取消。仅立即取消可能涉及退款；如有退款单，消息体会返回 `refund` 字段（JSON 字符串），包含退款金额 `refund_amount`（单位：分，字符串），退款单号 `refund_payment_order_id` 仅在 refund_amount > 0 时返回。
>
> 🔗 **退款单号链路（三者相等）**：`refund_payment_order_id` == `modify` CANCEL 接口响应的 `refund_order_id` == 批量退款结果通知 `alipay.trade.commercial.batchrefund.changed` 的 `request_no`。用任一字段即可把「发起取消退款 → 订阅取消感知 → 退款最终结果」三阶段串起来。

### 场景 11：进入续费宽限期

| 项目 | 说明 |
|------|------|
| **消息 API** | `alipay.trade.subscription.changed` |
| **change_type** | `past_due` |
| **触发时机** | 已配置正数宽限期的订阅在周期结束后仍未完成续费，并实际进入宽限期 |
| **bizNo** | subscriptionId |
| **携带数据** | subscription 全量信息；`subscription_status=PAST_DUE`，包含 `grace_period_days` 和 `grace_period_end` |

商家收到 `past_due` 后不要立即按取消处理。应记录宽限期截止时间，并根据自身权益策略决定继续提供、限制或提示用户使用；恢复扣款成功后会收到 `period_extend`，宽限期到期仍未恢复则收到最终 `cancel`。

## 四、用户提醒（面向用户）

### 4.0 两类面向用户的消息（务必区分）

订阅产品面向用户（买家）的消息分两类，**触发时机与渠道均不同，切勿混淆**：

| 类型 | 触发时机 | 渠道 | 是否短信/邮件 |
|------|---------|------|:----------:|
| **扣款预通知** | 周期结束前 48h（非试用）/ 试用结束前一天 7–8 点（试用） | **支付宝站内消息** | ❌ 否 |
| **续费失败通知** | 扣款失败之后（见 4.2） | SMS 短信 + Email 邮件 | ✅ 是 |

> ⚠️ **扣款预通知是支付宝站内给用户发的「准备扣款」提醒消息，不会给用户发短信或邮件**；SMS/邮件仅用于「续费失败」（扣款失败之后）的主动支付链接引导。

### 4.1 消息说明

| 项目 | 说明 |
|------|------|
| **扣款前提醒** | 支付宝站内消息 |
| **续费失败提醒** | 短信和邮件 |
| **接收对象** | 用户（买家） |
| **商家处理** | 结合订阅查询结果更新权益，不依赖用户提醒作为商家侧状态通知 |

### 4.2 续费扣款失败 — 发送主动支付链接

| 项目 | 说明 |
|------|------|
| **触发时机** | 周期扣款失败，且交易状态为 `WAIT_BUYER_PAY`（待买家付款）时 |
| **消息类型** | SMS 短信 + Email 邮件 |
| **SMS 模板变量** | `merchantName`（商户名）, `serviceName`（服务名）, `expireDate`（到期日期）, `payUrl`（支付链接） |
| **邮件模板变量** | 在 SMS 变量基础上增加 `amount`（金额）, `sendDate`（发送日期） |
| **目标对象** | **用户（买家）**，非商户 |

> 此通知的目的是引导用户通过主动支付链接完成续费，避免因扣款失败导致订阅中断。

已配置宽限期并实际进入 `PAST_DUE` 时，支付宝还可能向用户发送宽限期提醒。商家侧状态仍以 `subscription.changed` 的 `past_due` / `period_extend` / `cancel` 和主动查询为准，不以用户提醒作为商家系统的状态依据。

---

## 五、变更事件通知参数结构

### 5.1 alipay.trade.subscription.changed 消息体

```json
{
  "change_type": "active | trialing | period_extend | item_update | cancel | cancel_at_period_end | item_downgrade | item_cancel_revert | past_due",
  "change_date": "2026-05-22 10:00:00",
  "trade_no": "支付宝交易号（有支付单时）",
  "order_no": "支付单ID（有支付单时）",
  "out_trade_no": "商户外部订单号（有支付单时）",
  "pay_amount": "支付金额（分）（有支付单时）",
  "refund": "{\"refund_amount\":\"200\",\"refund_payment_order_id\":\"REF202605220001\"}（有退款时，金额单位为分的字符串）",
  "subscription": "{订阅JSON对象，包含 effective_type}"
}
```

**字段说明**：

| 字段 | 必返 | 说明 |
|------|------|------|
| change_type | 是 | 变更类型，见 2.2 节枚举 |
| change_date | 是 | 变更时间，格式 yyyy-MM-dd HH:mm:ss |
| trade_no | 否 | 支付宝交易号，仅支付成功的场景返回（支付时回填） |
| order_no | 否 | 支付单ID，携带支付单的场景均返回（含降级/撤销取消携带的下周期未支付单） |
| out_trade_no | 否 | 商户外部订单号，仅支付成功的场景返回（支付时回填） |
| pay_amount | 否 | 支付金额（单位：分，字符串），携带支付单的场景均返回 |
| refund | 否 | 退款信息 JSON 字符串，仅立即取消且有退款单时返回（含 `refund_amount`，单位分；`refund_payment_order_id` 仅 refund_amount > 0 时返回，其值 == 取消退款接口响应的 `refund_order_id` == 批量退款通知的 `request_no`） |
| subscription | 是 | 订阅全量信息 JSON 对象；`effective_type` 为 `IMMEDIATE_EFFECTIVE` 或 `SCHEDULED_EFFECTIVE` |

**各场景返回字段对比**：

| 场景 | change_type | trade_no | order_no | out_trade_no | pay_amount | refund |
|------|-------------|----------|----------|--------------|------------|--------|
| 正金额首次支付生效 | active | Y | Y | Y | Y | - |
| 免费试用生效 | trialing | - | - | - | - | - |
| 付费试用生效 | trialing | Y | Y | Y | Y | - |
| 普通续费 | period_extend | Y | Y | Y | Y | - |
| 试用转正式 | active | Y | Y | Y | Y | - |
| 升级成功 | item_update | Y | Y | Y | Y | - |
| 降级成功 | item_downgrade | - | Y | - | Y | - |
| 撤销取消 | item_cancel_revert | - | Y | - | Y | - |
| 周期末取消预约 | cancel_at_period_end | - | - | - | - | - |
| 取消生效（立即或周期末到期） | cancel | - | - | - | - | 条件返回* |
| 进入宽限期 | past_due | - | - | - | - | - |

> 降级成功 / 撤销取消场景携带的是**下周期未支付的支付单**：返回 order_no（支付单ID）与 pay_amount（下周期金额），trade_no / out_trade_no 需支付成功后才回填，此时不返回。
>
> 零元创建、零元试用、零元升级/扩容只有签约，没有真实付款。相关通知的 `pay_amount` 可为 `0`，不得以 `trade_no` 是否存在作为签约或订阅终态；应结合 `change_type`、`subscription` 和查询结果处理。
>
> 对 `effective_type=SCHEDULED_EFFECTIVE` 的订阅，创建日签约成功不等于未来权益已经生效。商家需保存请求中的未来生效日，并在到期后确认首笔真实扣款结果再开通权益。
>
> \* `refund` 仅在立即取消且产生退款单时条件返回，周期末取消到期生效时不适用。

### 5.2 alipay.trade.commercial.batchrefund.changed 消息体（批量退款状态通知）

订阅取消并退款、订阅交易独立退款和客诉超标自动退款均使用此通知。接收前需配置应用网关并订阅 `alipay.trade.commercial.batchrefund.changed`。

```json
{
  "batch_id": "退款批次ID",
  "request_no": "平台生成的退款请求号",
  "status": "SUCCESS | PARTIAL_SUCCESS | FAILED",
  "refund_scene": "MERCHANT_INITIATED | AUTO_PENALTY",
  "total_refund_amount": "申请退款总金额（单位：元，两位小数字符串）",
  "actual_refund_amount": "实际退款金额（成功明细汇总，单位：元）",
  "success_count": 1,
  "fail_count": 0,
  "total_count": 1,
  "refund_reason": "退款原因",
  "details": "[{\"pay_trade_no\":\"支付宝交易号\",\"refund_amount\":\"退款金额（元）\",\"refund_request_no\":\"明细退款请求号\",\"status\":\"SUCCESS | FAILED\"}]"
}
```

**字段说明**：

| 字段 | 说明 |
|------|------|
| batch_id | 退款批次ID（消息 bizNo） |
| request_no | 退款请求号。取消退款对应 `refund_order_id` 和 `refund_payment_order_id`，独立退款对应发起接口的 `refund_order_id`，自动退款的单号由平台生成并包含 `KSZDTK` |
| status | 批次状态：`SUCCESS`（全部成功）/ `PARTIAL_SUCCESS`（部分成功）/ `FAILED`（全部失败） |
| refund_scene | 可选。 `MERCHANT_INITIATED` 表示商户主动退款，`AUTO_PENALTY` 表示客诉超标自动退款 |
| total_refund_amount | 申请退款总金额，单位：元 |
| actual_refund_amount | 实际退款金额（仅汇总 SUCCESS 明细），单位：元 |
| success_count / fail_count / total_count | 成功/失败/总明细数 |
| refund_reason | 退款原因。自动退款时包含投诉工单号 |
| details | 退款明细列表（JSON 字符串），包含 `pay_trade_no`（原支付宝交易号）、`refund_amount`（元）、`refund_request_no` 和 `status`（`SUCCESS` / `FAILED`） |

客诉超标时，平台对相关订阅订单发起全额退款。收到 `refund_scene=AUTO_PENALTY` 的消息后，可按 `request_no` 幂等记录退款批次，通过明细中的 `pay_trade_no` 关联原交易。按批次 `status` 确认退款结果，按 `actual_refund_amount` 记录实际退款金额。[官方订阅退款结果消息](https://opendocs.alipay.com/solution/486a6d78_alipay.trade.commercial.batchrefund.changed?pathHash=921d620d&ref=api&scene=common)

> ⚠️ 注意金额单位差异：本通知金额单位为**元**（两位小数字符串），而 `subscription.changed` 中的 `pay_amount`/`refund_amount` 单位为**分**。

---

## 六、通知处理最佳实践

### 6.1 结果确认

异步通知用于告知状态变化。商户应先验签、再按业务主键做幂等处理；对资金或权益有影响的场景，可通过查询接口再次确认最新状态。

| 场景 | 通知 | 商家确认方式 |
|------|------|-------------|
| 订阅生效、续费、升级或降级 | `alipay.trade.subscription.changed` | 按 `change_type` 更新状态，必要时调用订阅查询接口复核 |
| 立即取消并退款 | `subscription.changed` + `batchrefund.changed` | 分别确认订阅取消和退款终态，不以任一单独通知代替另一个结果 |
| 订阅交易独立退款 | `batchrefund.changed` | 同步响应的 `refund_status` 表示当前状态，用 `refund_order_id` 关联通知确认终态 |
| 客诉超标自动退款 | `batchrefund.changed` | 按 `refund_scene=AUTO_PENALTY` 识别来源，按 `status` 确认退款结果 |
| 进入或离开宽限期 | `subscription.changed` | `past_due` 时记录截止时间；`period_extend` 时延长权益；最终 `cancel` 时收回权益 |

退款通知延迟或需要主动核对时，可用 `request_no` 调用 `alipay.trade.commercial.batchrefund.query`。查询返回 `INIT` 或 `PROCESSING` 时保持处理中，建议查询间隔不少于 5 秒。接口参数见 [批量退款查询](api-complete.md#批量退款查询接口-alipaytradecommercialbatchrefundquery)。

### 6.2 幂等处理建议

> 注：`subscription_id` 不是 `subscription.changed` 消息的顶层字段，位于 `subscription` JSON 对象内部，需先解析 `subscription` 再取用。

```go
type SubscriptionPayload struct {
    SubscriptionID string `json:"subscription_id"`
    TrialStart     string `json:"trial_start"`
}

func parseSubscription(raw string) (SubscriptionPayload, error) {
    var subscription SubscriptionPayload
    err := json.Unmarshal([]byte(raw), &subscription)
    return subscription, err
}

// 幂等处理关键点；生产代码应对解析失败和空 subscription_id 返回失败响应
func handleNotification(params map[string]string) {
    subscription, err := parseSubscription(params["subscription"])
    if err != nil || subscription.SubscriptionID == "" {
        return
    }

    // 1. 基于 subscription_id + change_type + 场景字段做幂等
    idempotentKey := fmt.Sprintf("%s_%s_%s_%s",
        subscription.SubscriptionID,
        params["change_type"],
        params["order_no"],      // 可能为空
        params["change_date"],   // 精确到秒
    )

    if isProcessed(idempotentKey) {
        return // 已处理，直接返回
    }

    // 2. 区分相同 change_type 的不同场景
    //    如 active 可能是首次支付生效，也可能是试用转正式
    //    可通过 subscription.TrialStart 是否为空判断
}
```

### 6.3 change_type 处理逻辑参考

```go
func handleChangeNotification(params map[string]string) {
    subscription, err := parseSubscription(params["subscription"])
    if err != nil || subscription.SubscriptionID == "" {
        return
    }
    subscriptionID := subscription.SubscriptionID
    changeType := params["change_type"]

    switch changeType {
    case "active":
        // 订阅生效：开通用户权益
        // 注意：可能是首次支付生效（场景1）或试用转正式（场景5）
        //   场景1：order_no 非空，为首次支付
        //   场景5：可通过 subscription.trial_start 是否有值判断
        activateSubscription(subscriptionID)

    case "trialing":
        // 试用期生效：开通试用权益
        // 注意：可能是免费试用（场景2，无支付单）或付费试用（场景3，有支付单）
        //   场景2：order_no 为空，免费试用
        //   场景3：order_no 非空，付费试用
        activateTrial(subscriptionID)

    case "period_extend":
        // 续费成功：延长用户权益有效期
        extendSubscription(subscriptionID)

    case "item_update":
        // 升级成功：调整用户权益等级
        upgradeSubscription(subscriptionID)

    case "item_downgrade":
        // 降级成功：标记下周期降级（当前周期保持原有权益）
        // 注意：降级下周期生效，通知中 currentPeriodStart/End 已更新为下周期
        markDowngrade(subscriptionID)

    case "cancel_at_period_end":
        // 周期末取消预约：标记待取消，当前周期内仍保持权益
        markCancelAtPeriodEnd(subscriptionID)

    case "cancel":
        // 取消已生效：收回用户权益；可能是立即取消，也可能是周期末到期取消
        // 仅在存在 refund 字段时处理退款逻辑
        cancelSubscription(subscriptionID)

    case "item_cancel_revert":
        // 撤销取消：恢复用户权益
        // 注意：通知中 currentPeriodStart/End 已更新为下周期
        revertCancel(subscriptionID)

    case "past_due":
        // 已进入续费宽限期：记录 grace_period_end，不要立即收回权益
        markPastDue(subscriptionID)

    default:
        log.Warnf("unknown change_type: %s", changeType)
    }
}
```

### 6.4 续费扣款失败通知处理

当收到续费扣款失败的通知时（用户端 SMS/Email），建议商户：

1. **短信内容**：包含商户名、服务名、到期日期和支付链接
2. **邮件内容**：额外包含金额和发送日期
3. **支付链接有效期**：注意链接可能有时效限制
4. **主动查询**：收到链接失效后，可通过 `alipay.trade.subscription.query` 主动查询订阅状态

---

## 七、场景汇总表

下表中“接收应用”按[第三方应用接收规则](#22-服务商模式下的通知接收)确定。

| # | 场景 | 消息通道 | 消息 API | change_type | 触发时机 | 目标对象 | 有支付单 |
|---|------|---------|---------|-------------|---------|---------|---------|
| 1 | 订阅生效 | 商家异步通知 | subscription.changed | active | 首次支付成功 | 接收应用 | Y |
| 2 | 试用期生效（签约） | 商家异步通知 | subscription.changed | trialing | 免费试用签约成功 | 接收应用 | N |
| 3 | 试用期生效（支付） | 商家异步通知 | subscription.changed | trialing | 付费试用首次支付成功 | 接收应用 | Y |
| 4 | 续费成功 | 商家异步通知 | subscription.changed | period_extend | 普通续费支付成功 | 接收应用 | Y |
| 5 | 试用期续费转正式 | 商家异步通知 | subscription.changed | active | 试用期续费支付成功 | 接收应用 | Y |
| 6 | 升级成功 | 商家异步通知 | subscription.changed | item_update | 升级支付成功 | 接收应用 | Y |
| 7 | 降级成功 | 商家异步通知 | subscription.changed | item_downgrade | 降级签约成功 | 接收应用 | Y* |
| 8 | 撤销取消 | 商家异步通知 | subscription.changed | item_cancel_revert | 用户重新签约恢复 | 接收应用 | Y* |
| 9 | 周期末取消预约 | 商家异步通知 | subscription.changed | cancel_at_period_end | 设置周期末取消/支付宝侧取消 | 接收应用 | N |
| 10 | 取消生效 | 商家异步通知 | subscription.changed | cancel | 立即取消成功/周期末到期生效 | 接收应用 | N |
| 11 | 进入续费宽限期 | 商家异步通知 | subscription.changed | past_due | 周期结束后仍未续费且实际进入宽限期 | 接收应用 | N |
| 12 | 批量退款结果 | 商家异步通知 | commercial.batchrefund.changed | — | 取消退款、独立退款或客诉超标自动退款到达终态 | 接收应用 | — |
| 13 | 扣款预通知（站内） | 支付宝站内消息 | — | — | 周期结束前48h / 试用结束前一天7–8点 | 用户 | — |
| 14 | 续费失败-短信 | 用户提醒 | SMS | — | 续费扣款失败 | 用户 | — |
| 15 | 续费失败-邮件 | 用户提醒 | Email | — | 续费扣款失败 | 用户 | — |

> \* 场景 7/8 携带的是下周期未支付的支付单：消息返回 order_no 与 pay_amount，不返回 trade_no / out_trade_no（支付成功后才回填）。
