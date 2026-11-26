# 企业支付渠道接入

## 契约边界

本文按 2026-09-25 可见的聚合收银 SAAS 渠道和 API 契约整理。接口字段、权限和产品状态以商户应用当前可见的开放平台资料为准。

新接入默认创建聚合收银订单，不设置单一渠道或付款机构参数。`ENTERPRISE_EBANK` 仅用于本 Skill 的接入画像，不得直接写入平台请求；企业网银实际渠道按平台返回的 `E_BANK` 处理。

## 渠道矩阵

| 渠道 | 终端 | 产品准备 | 条件能力 | 支付终态 |
| --- | --- | --- | --- | --- |
| 支付宝 | PC | 聚合收银、电脑网站支付 | 可显式限制 `pay_channels=ALIPAY` | `order.changed` / `order.query` 的 `TRADE_SUCCESS`，`pay_channel=ALIPAY` |
| 支付宝 | App | 聚合收银、App 支付 | 可显式限制 `pay_channels=ALIPAY` | 同上 |
| 银行转账 | PC、App | 聚合收银、银行转账能力 | 账户创建/查询、专属账户；按需资金确认 | 订单 `TRADE_SUCCESS`；待认款资金另按资金状态收敛 |
| 企业网银 | PC、App | 企业网银能力及对应接口权限 | `security_params`；按需 `ebank.consult` | 订单 `TRADE_SUCCESS`，实际 `pay_channel=E_BANK` |

页面展示、银行受理、付款回单和同步回跳均不是支付终态。订单通知、主动查询和资金认款响应必须汇入同一个订单状态服务；只有核对归属、订单号和金额后的 `TRADE_SUCCESS` 才能履约。

## 银行转账与先款后单

1. 使用稳定 `out_merchant_no` 调用 `account.create` 创建或幂等复用账户，保存平台返回的 `customer_id` 和可信账户快照；用 `account.query` 恢复未知结果并在展示前核对归属。
2. 默认在受控商户页面展示专属收款账户，或创建聚合收银订单让付款方在收银台选择银行转账。
3. 选择 `BANK_FUND_CONFIRMATION` 时，使用同一应用订阅 `alipay.trade.saas.fund.changed`。收到 `WAIT_CLAIM` 后只建立待认款资金事实，不更新订单为成功。
4. 按[资金认款与拒绝](bank-fund-confirmation.md)串行执行 CONFIRM 或 REJECT。`fund.confirm` 同步返回并核验通过的订单 `TRADE_SUCCESS` 可幂等履约；返回 `WAIT_BUYER_PAY` 时继续等待订单通知或主动查询。REJECT 后等待资金 `REFUNDED`。

## 企业网银

1. 基础验收至少覆盖 PC 端；App 端按实际银行和接入范围补充，不假设所有机构支持所有终端。
2. 默认由付款方在聚合收银台完成机构咨询和选择，不向创单请求传付款机构。
3. 只有商户需要在进入收银台前提示机构可用性时，才调用 `alipay.trade.saas.ebank.consult`；咨询结果只用于展示，最终选择仍以收银台为准。
4. `security_params` 使用真实、已授权的数据，并与 `buyer_info` 和实际付款企业一致。该字段及内层 `goodsInfo` 都由 JSON 序列化器生成；字段名大小写遵循当前契约，不补虚假空值。

## 兼容入口

用户明确询问 `pay_channels=BANK_TRANSFER`、`pay_channels=E_BANK`、`business_params.saas_ebank_inst_id`、同步账户响应或旧 schema 的 `BANK_TRANSFER_DIRECT` 时，读取[指定渠道兼容说明](bank-transfer-direct.md)。该路径不作为默认方案，也不改变“通知或查询终态才履约”的规则。
