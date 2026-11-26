# 指定渠道创单兼容参考

仅当用户明确询问指定银行转账/企业网银渠道、`pay_channels=BANK_TRANSFER`、`pay_channels=E_BANK`、`business_params.saas_ebank_inst_id`、同步账户响应或旧 `BANK_TRANSFER_DIRECT` 清单时读取。默认接入仍使用聚合收银台。

指定 `BANK_TRANSFER` 时，`buyer_info` 使用已有 `customer_id`，或 `out_merchant_no + out_merchant_name` 组合；同步 `WAIT_BUYER_PAY` 和账户信息不表示到账。

指定 `E_BANK` 时，机构 ID 必须来自本次 `alipay.trade.saas.ebank.consult` 结果，不接受前端任意输入或本地猜测；仍需满足当前契约要求的买方和安全参数。

无论采用哪种兼容路径，页面受理、银行回单和同步回跳都不能触发履约。最终仍以 `order.changed` 或 `order.query` 的 `TRADE_SUCCESS` 为准。
