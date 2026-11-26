# 企业支付 OpenMQ 通知

## 目录

- [订阅信息](#订阅信息)
- [消息信封与路由](#消息信封与路由)
- [通知场景](#通知场景)
- [业务字段](#业务字段)
- [消费算法](#消费算法)
- [消息示例](#消息示例)
- [测试要求](#测试要求)

## 订阅信息

- 订单消息 API：`alipay.trade.saas.order.changed`。
- 选择 `BANK_FUND_CONFIRMATION` 时增加资金消息 API：`alipay.trade.saas.fund.changed`。
- 使用调用企业支付 OpenAPI 的同一应用在 OpenMQ 平台订阅。
- 消息可能重复、延迟或乱序，不能依赖到达次数和先后顺序。
- OpenMQ 是状态变化通知，不代替主动交易查询和退款查询。

## 消息信封与路由

OpenMQ 投递包含协议消息信封和业务内容。信封字段 `method` 标识消息 API，不属于订单或资金业务字段。

共享接收入口必须先路由、后解析：

```text
接收消息信封
  -> 验证来源、签名和基础协议字段
  -> 读取并校验 method 非空
  -> method == alipay.trade.saas.order.changed
       -> 解析订单内容并进入订单消费者
  -> method == alipay.trade.saas.fund.changed 且已选择 BANK_FUND_CONFIRMATION
       -> 解析资金内容并进入资金消费者
  -> 其他已支持 method
       -> 路由到对应消费者
  -> method 缺失或不支持
       -> 不解析为本消息，不更新订单，记录脱敏告警并隔离
```

实施约束：

1. 对 `method` 做精确字符串匹配，不做模糊匹配、前缀匹配或大小写归一化。
2. 使用 SDK 时从 SDK 暴露的消息信封属性读取 `method`；使用 HTTP/JSON 接收时读取顶层协议字段。不得从业务内容中读取或推导 `method`。
3. 不得用 `trade_status`、`fund_status`、`order_no`、`fund_no` 或字段形状判断消息类型。订单与资金消息不能进入彼此的状态机。
4. 未知或永久不支持的 `method` 按统一未知消息策略隔离，不能通过无限失败重投解决；是否确认消费服从商户通用路由器和 OpenMQ 接入组件的协议。
5. 日志至少可关联脱敏后的 `method`、消息标识和平台 trace，不记录签名原文或完整敏感业务内容。

## 通知场景

| 事件 | 通知 | `trade_status` | 说明 |
| --- | --- | --- | --- |
| 支付成功 | 是 | `TRADE_SUCCESS` | 首笔生效支付成功后通知 |
| 普通交易关闭 | 是 | `TRADE_CLOSED` | 聚合订单全部候选支付关闭后通知 |
| 部分退款 | 否 | - | 使用退款查询确认 |
| 累计全额退款 | 是 | `TRADE_CLOSED` | 累计退款覆盖支付本金并关闭主单后通知 |

## 业务字段

### 订单消息

| 字段 | 支付成功 | 普通关单 | 全额退款关单 | 说明 |
| --- | --- | --- | --- | --- |
| `order_no` | 必有 | 必有 | 必有 | SaaS 交易主单号 |
| `out_trade_no` | 必有 | 必有 | 必有 | 商户订单号 |
| `trade_no` | 必有 | 无 | 必有 | 首笔生效支付渠道交易号 |
| `trade_status` | `TRADE_SUCCESS` | `TRADE_CLOSED` | `TRADE_CLOSED` | 当前对客状态 |
| `pay_channel` | 必有 | 无 | 必有 | 实际支付渠道，以平台返回枚举为准 |
| `total_amount` | 必有 | 必有 | 必有 | 商户订单总金额，元字符串 |
| `receipt_amount` | 必有 | 无 | 必有 | 商户实收金额，元字符串 |
| `buyer_pay_amount` | 必有 | 无 | 必有 | 渠道买家实付金额，元字符串 |
| `refund_amount` | 无 | 无 | 必有 | 首笔生效支付累计退款金额 |
| `out_request_no` | 无 | 无 | 条件 | 触发全额退款关单的退款请求号 |
| `change_time` | 必有 | 必有 | 必有 | 状态实际发生时间 |
| `pay_time` | 必有 | 无 | 必有 | 首笔生效支付时间 |
| `passback_params` | 条件 | 条件 | 条件 | 创单传入时原样返回 |

普通关单不携带候选支付子单的 `trade_no` 和 `pay_channel`。不要因为条件字段为空拒绝合法消息。

### 资金消息

仅选择 `BANK_FUND_CONFIRMATION` 时消费 `alipay.trade.saas.fund.changed`：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `fund_status` | 是 | `WAIT_CLAIM` 或 `REFUNDED` |
| `fund_no` | 是 | 原入金资金流水号，退款通知仍用它关联原入金 |
| `amount` | 是 | 入金本金，元字符串 |
| `buyer_name` | 条件 | 付款方户名，按认款规则核验 |
| `inst_account_name` | 条件 | 实际收款账户户名，按可信账户快照核验 |
| `refund_fund_no` | `REFUNDED` 条件 | REJECT 后的退款资金号 |

`WAIT_CLAIM` 只建立待处理资金事实，不能更新订单为成功或触发履约。`REFUNDED` 只收敛已有的拒绝退款事实；无法关联时进入人工处理。认款成功可由核验通过的 `fund.confirm` 同步 `TRADE_SUCCESS`、订单通知或主动查询确认，三者进入同一订单状态服务。

## 消费算法

消息入口只做协议适配，所有状态入口应汇入同一个商户订单状态服务：

```text
接收消息
  -> 验证消息来源、签名和基础格式
  -> 校验信封 method == alipay.trade.saas.order.changed
  -> 解析 business content
  -> 校验场景对应的必有字段
  -> 开启本地事务
  -> 以 order_no + trade_status 查询消费幂等记录
  -> 已消费: 提交/结束并 ACK
  -> 未消费: 锁定商户订单并核对 out_trade_no、金额和当前状态
  -> 状态冲突或疑似乱序: 退出事务，调用 trade.query，再进入状态服务
  -> 状态合法: 更新订单、写消费记录和本地履约事件
  -> 提交事务后 ACK
  -> 瞬时失败: 不 ACK，由消息系统重投
```

实施细节：

1. `order_no + trade_status` 是通知消费幂等键，履约仍需自己的业务幂等键。
2. 不能在事务提交前确认消息，否则持久化失败时消息不会重投。
3. 不能因业务已经处理过而返回失败；幂等命中应直接成功确认。
4. 不能让旧消息把终态回退。收到与本地状态冲突的消息时主动查询，不凭消息到达顺序猜测。
5. `TRADE_CLOSED` 可能是普通未支付关单，也可能是累计全额退款关单。用退款字段和主动查询区分业务动作，不能把所有关闭都当成未支付取消。
6. 消息中的金额先按精确十进制元字符串解析，再与本地订单金额核对；不要使用二进制浮点。
7. 处理失败要区分瞬时故障和不可恢复脏数据。脏数据进入告警/人工队列，避免无限重投压垮消费端。
8. 资金消息按 `fund_no + fund_status` 持久化幂等，与订单消息记录分开；重复 `WAIT_CLAIM` 不生成新 `claim_request_no`，旧消息不能回退已确认或已退款资金。

## 消息示例

支付成功：

```json
{
  "order_no": "202608041000100000001",
  "out_trade_no": "ORDER_202608040001",
  "trade_no": "202608042200000000000001",
  "trade_status": "TRADE_SUCCESS",
  "pay_channel": "BANK_TRANSFER",
  "total_amount": "100.00",
  "receipt_amount": "100.00",
  "buyer_pay_amount": "95.00",
  "change_time": "2026-08-04 15:30:00",
  "pay_time": "2026-08-04 15:30:00",
  "passback_params": "ORDER_202608040001"
}
```

普通关单：

```json
{
  "order_no": "202608041000100000002",
  "out_trade_no": "ORDER_202608040002",
  "trade_status": "TRADE_CLOSED",
  "total_amount": "100.00",
  "change_time": "2026-08-04 16:00:00"
}
```

累计全额退款关单：

```json
{
  "order_no": "202608041000100000003",
  "out_trade_no": "ORDER_202608040003",
  "trade_no": "202608042200000000000003",
  "trade_status": "TRADE_CLOSED",
  "pay_channel": "BANK_TRANSFER",
  "total_amount": "100.00",
  "receipt_amount": "100.00",
  "buyer_pay_amount": "95.00",
  "refund_amount": "100.00",
  "out_request_no": "REFUND_202608040001",
  "change_time": "2026-08-04 17:00:00",
  "pay_time": "2026-08-04 15:30:00"
}
```

## 测试要求

- 目标 `method=alipay.trade.saas.order.changed` 才能进入企业支付消费者。
- 其他 `method` 即使携带相同的 `order_no` 和 `trade_status` 字段，也不更新订单、不写消费幂等记录且不触发履约。
- `method` 缺失或空白时不进入业务内容反序列化和订单状态机，并按未知消息策略隔离。
- 同一支付成功消息投递两次，只履约一次，两次都成功确认。
- 普通关单缺少 `trade_no` 和 `pay_channel` 时仍能消费。
- `TRADE_CLOSED` 先于旧的 `TRADE_SUCCESS` 到达时不回退状态，并触发查单校准。
- 消费事务回滚时不确认消息，下一次投递可以成功恢复。
- 消息金额或 `out_trade_no` 与本地不一致时不直接履约，记录告警并主动查询。
- 部分退款不能等待 OpenMQ，应由退款查询任务恢复。
- 全额退款关单重复通知不重复冲正、关闭或发券。
- 选择资金确认时，`method=alipay.trade.saas.fund.changed` 只进入资金消费者；订单和资金消费者互不接受对方消息。
- 重复、延迟或乱序的 `WAIT_CLAIM` / `REFUNDED` 不重复认款、不重复记退款，也不回退资金终态。
- `WAIT_CLAIM` 和 `REFUND_PROCESSING` 不触发订单履约或退款成功；CONFIRM 同步响应、订单通知或查询中的 `TRADE_SUCCESS` 统一收敛且只履约一次。
