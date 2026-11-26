# 定向关闭待支付单

仅在用户明确要求处理创建/升级/扩容对应的待支付单，且商户已取得定向邀约后查阅。以下是开发对照和本地模拟资料，不发起真实关单。商户取消会员续费走普通订阅取消，不使用本接口。

## 订阅支付单关闭接口（定向邀约）(alipay.trade.subscription.apply.close)

> ⚠️ 本接口属于定向邀约式放开，默认不支持使用。只有商户已经获得支付宝定向邀约，并从正式接入资料或对接人员确认可用时，才能按约定范围接入。不得仅因存在待支付订阅或升级/扩容支付单就尝试调用，也不要把本接口加入普通商户的默认接入方案。

受邀商户可按 `order_no` 关闭订阅链路中指定的待支付单。接口根据支付单来源分两条路径：

- **创建支付单**：要求订阅为 `INCOMPLETE`；关闭支付单后，订阅变为 `INCOMPLETE_EXPIRED`，待生效周期和订阅项一并失效。
- **升级/扩容支付单**：订阅可以处于 `ACTIVE`、`TRIALING` 等已生效状态；关闭的只是该笔待支付变更，订阅及当前周期保持原状态。

所以，“只有 `INCOMPLETE` 才能调用”只适用于创建支付单路径，不是该接口的全局状态限制。

### 业务请求参数

| 参数 | 类型 | 必选 | 描述 |
|------|------|------|------|
| subscription_id | string | **必选** | 订阅ID，唯一标识一个订阅 |
| order_no | string | **必选** | 需要关闭的支付单号 |

### 请求示例

```json
{
  "subscription_id": "SUB202605200001",
  "order_no": "PAY202605200001"
}
```

### 响应参数

| 参数 | 类型 | 描述 |
|------|------|------|
| success | boolean | 是否成功 |
| result_code | string | 结果码，SUCCESS 表示成功 |
| result_message | string | 结果消息 |
| subscription_id | string | 订阅ID（预留字段，当前成功响应不回填） |

### 响应示例

**成功响应**：
```json
{
  "success": true,
  "result_code": "SUCCESS",
  "result_message": "订阅关闭成功"
}
```

**失败响应**：
```json
{
  "success": false,
  "result_code": "SUBSCRIPTION_NOT_EXIST",
  "result_message": "订阅不存在: SUB202605200001"
}
```

### 业务规则

| 规则 | 说明 |
|------|------|
| 场景识别 | 以 `order_no` 对应的是创建支付单还是升级/扩容支付单为准，不能只按订阅当前状态判断 |
| 创建支付单 | 订阅必须为 `INCOMPLETE`；成功后订阅变为 `INCOMPLETE_EXPIRED` |
| 升级/扩容支付单 | 不要求订阅为 `INCOMPLETE`；关闭支付单后订阅和当前周期保持原状态 |
| 支付单归属 | 支付单必须属于传入的 `subscription_id` |
| 支付单类型 | 只支持创建、升级或扩容时生成并等待用户支付/签约的支付单；续费扣款单、主动扣款单和退款单不适用 |
| 支付单状态 | `DRAFT` 可关闭，`PAID` 明确拒绝；其他已结束状态按幂等处理，不重复关单 |
| 幂等性 | 订阅已为 `INCOMPLETE_EXPIRED` 时直接返回成功；升级/扩容支付单已结束时不重复处理 |
| 后续操作 | 创建关单不可恢复；升级/扩容支付单关闭后不能继续使用原支付入口，如仍需变更应重新发起 |

### 状态转换

```text
创建支付单：INCOMPLETE → INCOMPLETE_EXPIRED
升级/扩容支付单：ACTIVE / TRIALING / 其他原状态 → 原状态不变
```

### 错误码

| 错误码 | 错误消息 | 说明 |
|--------|----------|------|
| INVALID_PARAMETER | subscription_id 不能为空 | 订阅ID为空 |
| INVALID_PARAMETER | order_no 不能为空 | 支付单号为空 |
| SUBSCRIPTION_NOT_EXIST | 订阅不存在: {subscription_id} | 订阅不存在 |
| PERMISSION_DENIED | 无权限查询该订阅 | 订阅不属于当前商户 |
| SUBSCRIPTION_STATUS_NOT_UPDATABLE | 订阅状态非 INCOMPLETE,不允许关闭: {status} | 当前是创建支付单，但订阅已不处于 INCOMPLETE；该限制不适用于升级/扩容支付单 |
| PAYMENT_ORDER_NOT_EXIST | 支付单不存在: {order_no} | 支付单号不存在 |
| REQUEST_PARAM_ILLEGAL | 支付单不属于该订阅 | 支付单与订阅不匹配 |
| PAYMENT_ORDER_STATUS_NOT_CLOSABLE | 支付单不允许关闭 | 支付单已支付，或不是创建/升级/扩容产生的待支付单 |
| TRADE_CLOSE_CANCEL_SUBSCRIPTION_FAILED | 订阅关闭后状态更新失败 | 订阅状态更新失败 |

### 与取消订阅的区别

| 对比项 | 创建支付单关单 (apply.close) | 升级/扩容支付单关单 (apply.close) | 取消订阅 (modify CANCEL) |
|--------|-------------------------------|---------------------------------|--------------------------|
| 订阅状态 | 必须为 INCOMPLETE | 可为 ACTIVE、TRIALING 等，不要求 INCOMPLETE | 通常为 ACTIVE / TRIALING |
| 操作后状态 | INCOMPLETE_EXPIRED | 保持原订阅状态 | 立即取消后为 CANCELED；周期末取消预约成功后保持当前有效状态，到期才变为 CANCELED |
| 处理对象 | 创建产生的待支付单及未生效订阅 | 某次升级/扩容产生的待支付单 | 订阅生命周期及后续扣款 |
| 是否可恢复 | 不可恢复 | 原支付入口不可恢复，需要时重新发起变更 | 尚未生效的周期末取消预约可通过 REVERT_CANCEL 撤销；已经进入 CANCELED 后不可用该操作恢复 |
| 生效时机 | 立即 | 立即 | 可选立即或周期结束生效 |

本表只用于已经确认获得定向邀约的商户理解语义差异。未获邀约或权限未确认时，默认不支持使用 `apply.close`，不得用它替代标准取消能力。

## 旧包的场景与请求示例

### 关闭创建订阅的待支付单

> ⚠️ `alipay.trade.subscription.apply.close` 属于定向邀约式放开，默认不支持使用。以下流程只供已经确认获得支付宝定向邀约的商户使用；普通商户不得照此示例尝试调用。

适用场景：受邀商户在正式约定范围内，需要主动关闭用户创建后未支付、处于 INCOMPLETE 状态的订阅。

```
前提: 用户创建了订阅但未支付，订阅处于 INCOMPLETE 状态

步骤1: 获取待关闭的支付单号 order_no
（order_no 为创建订阅响应中返回的 order_no，查询接口不返回 order_no；
  可用查询接口确认订阅当前为 INCOMPLETE 状态）
POST alipay.trade.subscription.query
{
  "subscription_id": "SUB202605200001"
}
→ subscription_status: INCOMPLETE

步骤2: 关闭订阅
POST alipay.trade.subscription.apply.close
{
  "subscription_id": "SUB202605200001",
  "order_no": "PAY202605200001"
}
→ success: true
→ result_code: SUCCESS
→ subscription_status 变为 INCOMPLETE_EXPIRED
→ PENDING 周期变为 CLOSED
→ PENDING 订阅项变为 INVALID
```

### 关闭升级/扩容的待支付单

适用场景：受邀商户已经发起升级或扩容，订阅仍为 `ACTIVE`、`TRIALING` 等有效状态，但用户尚未完成本次变更支付。

```text
前提: order_no 对应升级/扩容产生的待支付单，且支付单尚未支付

POST alipay.trade.subscription.apply.close
{
  "subscription_id": "SUB202605200002",
  "order_no": "PAY_UPDATE_202605200002"
}
→ success: true
→ 只关闭本次升级/扩容支付单
→ subscription_status 和当前周期保持不变
```

> `ACTIVE`、`TRIALING` 并不是本接口的全局禁用状态。只有关闭“创建支付单”时才要求订阅为 `INCOMPLETE`；关闭升级/扩容支付单时不套用这一状态限制。

### 关闭订阅请求示例 (alipay.trade.subscription.apply.close)

本示例仅适用于已确认获得定向邀约的商户；默认不支持使用，也不应由 Skill 在普通接入代码中生成。

**请求参数**：
```json
{
  "subscription_id": "SUB202605200001",
  "order_no": "PAY202605200001"
}
```

**成功响应**：
```json
{
  "success": true,
  "result_code": "SUCCESS",
  "result_message": "订阅关闭成功"
}
```

**失败响应 - 订阅不存在**：
```json
{
  "success": false,
  "result_code": "SUBSCRIPTION_NOT_EXIST",
  "result_message": "订阅不存在: SUB202605200001"
}
```

**失败响应——创建支付单对应的订阅状态不允许关闭**：
```json
{
  "success": false,
  "result_code": "SUBSCRIPTION_STATUS_NOT_UPDATABLE",
  "result_message": "订阅状态非 INCOMPLETE,不允许关闭: ACTIVE"
}
```

> 上述错误只表示 `order_no` 对应创建支付单、但订阅已经不再是 `INCOMPLETE`；不能据此推断 `ACTIVE`、`TRIALING` 的升级/扩容支付单也不能关闭。

**失败响应 - 支付单不匹配**：
```json
{
  "success": false,
  "result_code": "REQUEST_PARAM_ILLEGAL",
  "result_message": "支付单不属于该订阅"
}
```

**幂等响应 - 订阅已关闭**：
```json
{
  "success": true,
  "result_code": "SUCCESS",
  "result_message": "订阅关闭成功"
}
```

> 幂等说明：如果订阅已处于 INCOMPLETE_EXPIRED 状态，再次调用关闭接口直接返回成功，不会报错。
