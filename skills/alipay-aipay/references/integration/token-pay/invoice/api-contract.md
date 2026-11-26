# 发票 OpenAPI 契约

本页用于字段、枚举和请求生成；开通见 [integration.md](integration.md)，红冲和恢复见 [lifecycle.md](lifecycle.md)。[官方文档入口](https://opendocs.alipay.com/pre-open/0k3k6p?pathHash=6b81e5a4)。

## 接口与共同规则

| 方法 | 用途 | 主要业务响应 |
| --- | --- | --- |
| `alipay.trade.saas.invoice.apply` | 蓝票申请或红冲申请 | `saas_invoice_order_no`、`invoice_status` |
| `alipay.trade.saas.invoice.query` | 查询一笔发票详情 | `invoice_detail_info` |
| `alipay.trade.saas.invoice.batchquery` | 分页查询发票 | `invoice_detail_info_list`、`page_no`、`page_size`、`total_count`、`has_next` |
| `alipay.trade.saas.invoice.download` | 获取文件下载地址 | 申请单号、文件信息、下载地址和到期时间 |
| `alipay.trade.saas.invoice.changed` | OpenMQ 状态通知，非主动请求方法 | `invoice_detail_info` |

- 以下字段为 `biz_content` 内的 snake_case 字段；不要直接使用内部 Java 字段名。网关公共参数、响应外层和验签沿用当前官方 SDK/网关契约。
- 所有公开金额字段使用**元字符串**，如 `"106.00"`，精确到分；不要直接传订阅的整数分，也不要用浮点运算累加金额。
- 开票申请单号 `saas_invoice_order_no`、正式票号 `invoice_no`、商户请求号 `out_request_no`、业务单号和支付单号用途不同，不可互换。

## 申请

| 字段组 | 字段和取值 |
| --- | --- |
| 顶层 | `out_request_no`：商户维度唯一，原请求重试保持不变；`invoice_mode`：`SINGLE_INVOICE` 或 `MERGE_INVOICE` |
| `invoice_main_info` | `invoice_kind`：`81` 数电专票、`82` 数电普票；`business_type`：`0` 个人、`1` 企业；`invoice_type`：`1` 蓝票、`2` 红票；`invoice_amount` 含税总额、`excluding_tax_amount` 不含税总额、`tax_amount` 总税额 |
| `invoice_seller_info` | `seller_tax_no`、`seller_name`、`seller_address`、`seller_bank`、`seller_phone`、`seller_bank_account`；税号与商家签约信息一致 |
| `invoice_buyer_info` | `buyer_name`、`buyer_tax_no`、`buyer_address`、`buyer_bank`、`buyer_phone`、`buyer_bank_account`；企业购方必须提供税号。自然人扩展：`buyer_personal_id_type`、`buyer_personal_id_number`、`buyer_personal_nationality_code`、`buyer_personal_name_flag`，按实际场景和正式要求提供 |
| `invoice_deliver_info` | `file_type`：`1` PDF、`2` OFD、`3` XML、`4` PDF+OFD、`5` PDF+XML、`6` OFD+XML、`7` 三种；`deliver_type`：`0` 不交付、`1` 手机或邮箱交付；交付时 `client_phone` / `client_email` 至少一个非空；另有 `tinyapp_phone`、`electronic_invoice_account` |
| `invoice_issuer_info` | `invoice_issuer`、`invoice_clerk_certificate_type`、`invoice_clerk_certificate_no`、`cashier_name`、`checker_name`，按实际开票要求填写 |
| `invoice_remark_info` | `remark`；四个展示开关 `show_buyer_bank_account`、`show_seller_bank_account`、`show_buyer_address_phone`、`show_seller_address_phone` 使用 `Y/N` |
| `red_related_invoice_info` | 红票关联字段：`origin_invoice_no` 为原蓝票的 **SaaS 平台申请单号**，不是票面号码；`origin_invoice_kind`、`red_reason` 见生命周期规则 |
| `invoice_items` | 非空商品明细数组，字段如下 |
| `order_list` | 非空业务订单及支付记录数组，字段如下 |

### 商品明细与订单

商品行使用 `serial_no`（从 1 开始且不重复）、`item_name`、`item_no`（商品/税收分类编码）、`unit`、`row_type`（`0` 正常、`1` 折扣、`2` 被折扣）、`tax_rate`、`amount`、`excluding_tax_amount`、`tax_amount`、`price`（不含税单价）、`quantity`。可选 `specification`、`zero_rate_flag`（`1/2/3`）、`preferential_policy_flag`（`Y/N`）、`vat_special_management`；优惠标志为 `Y` 时补齐特殊管理说明。红冲关联行使用 `original_blue_item_serial_no`。

接口当前接受税率字符串 `0/0.01/0.03/0.04/0.05/0.06/0.09/0.11/0.13/0.17`；这是接口枚举，不是针对商家的税务建议。使用商家确认的适用税率及编码。

每条 `order_list` 包含：

- `biz_order_no`：业务订单号；`biz_order_type`：`ALIPAY_SAAS_BIZ_ORDER` 或 `NON_ALIPAY_SAAS_BIZ_ORDER`，表示业务订单归属。
- `biz_order_amount`：该业务订单总金额；同一业务订单多笔支付时，每行填写相同总额，汇总时按业务订单去重。
- `payment_order_type`：`ALIPAY`、`BANK_TRANSFER`、`OTHER_PAY`，表示实际支付方式；不能与业务订单归属混淆。
- `payment_order_no`：实际支付单号/渠道交易号；`payment_amount`：该笔支付金额。

单笔模式恰好一笔业务订单，可有多条支付记录；合并模式至少两笔不同业务订单。同一业务订单内支付类型加支付号不能重复。业务订单金额和支付金额必须大于零；本次开票金额不超过去重后的业务订单总额，并满足剩余可开票金额约束。

含税总额等于不含税总额加税额；各商品行对应金额之和与票面总额相等。红票也按本接口的正数金额口径提交，不把服务商协议的负数金额直接搬入公开请求；开票有误全额红冲时保留原商品数量，销售折让规则另见生命周期。

### 单笔蓝票业务参数示例

示例为企业购方、106 元含税金额、6% 税率的数电普票，仅演示字段及金额关系。替换全部 `MERCHANT_*` 占位符，并按实际开票账户补充销方/开票人信息；示例税率不代表商家应使用该税率。

```json
{
  "out_request_no": "MERCHANT_INVOICE_REQUEST_NO",
  "invoice_mode": "SINGLE_INVOICE",
  "invoice_main_info": {
    "invoice_kind": "82",
    "business_type": "1",
    "invoice_type": "1",
    "invoice_amount": "106.00",
    "excluding_tax_amount": "100.00",
    "tax_amount": "6.00"
  },
  "invoice_seller_info": {
    "seller_tax_no": "MERCHANT_SELLER_TAX_NO",
    "seller_name": "MERCHANT_SELLER_NAME"
  },
  "invoice_buyer_info": {
    "buyer_name": "MERCHANT_BUYER_NAME",
    "buyer_tax_no": "MERCHANT_BUYER_TAX_NO"
  },
  "invoice_deliver_info": {"file_type": "1", "deliver_type": "0"},
  "invoice_items": [{
    "serial_no": 1,
    "item_name": "MERCHANT_ITEM_NAME",
    "item_no": "MERCHANT_TAX_CATEGORY_CODE",
    "unit": "次",
    "row_type": "0",
    "tax_rate": "0.06",
    "amount": "106.00",
    "excluding_tax_amount": "100.00",
    "tax_amount": "6.00",
    "price": "100.00",
    "quantity": "1"
  }],
  "order_list": [{
    "biz_order_no": "MERCHANT_BIZ_ORDER_NO",
    "biz_order_type": "ALIPAY_SAAS_BIZ_ORDER",
    "biz_order_amount": "106.00",
    "payment_order_type": "ALIPAY",
    "payment_order_no": "MERCHANT_PAYMENT_ORDER_NO",
    "payment_amount": "106.00"
  }]
}
```

申请返回的 `invoice_status` 为 `SUBMIT/SUCCESS/FAILED`。结果不明或明确未受理后的恢复规则见 [lifecycle.md](lifecycle.md)，不能只检查网关成功码。

## 单笔与批量查询

单笔查询按 `query_mode` 只传相应定位字段，其他模式的字段不混传：

| `query_mode` | 对应字段 |
| --- | --- |
| `BY_OUT_REQUEST_NO` | `out_request_no` |
| `BY_SAAS_INVOICE_ORDER_NO` | `saas_invoice_order_no` |
| `BY_BIZ_ORDER` | `biz_order_type` 和 `biz_order`，注意这里不是申请中的 `biz_order_no` |

```json
{"query_mode":"BY_OUT_REQUEST_NO","out_request_no":"MERCHANT_INVOICE_REQUEST_NO"}
```

响应 `invoice_detail_info` 含申请号、请求号、开票模式、`invoice_status`、失败原因 `invoice_fail_reason`、`invoice_no`、`invoice_code`、`invoice_issuance_time`、创建/修改时间以及票面、商品、订单信息。不要假定处理中已有正式票号。需精确定位某张蓝票或红票时优先使用申请单号，不把业务单查询当作全部历史发票列表。

批量查询支持 `BY_OUT_REQUEST_NO` + `out_request_no_list`，或 `BY_SAAS_INVOICE_ORDER_NO` + `saas_invoice_order_no_list`，或 `BY_TIME` + `gmt_create_start/gmt_create_end`。列表最多 100 条，时间起点不晚于终点，不混传不同模式条件。`page_no` 为 1–100000，`page_size` 为 1–100。

可选过滤字段：`invoice_type=BLUE/RED`，`invoice_status=SUMMIT/SUCCESS/FAIL`。**批量筛选当前使用 `SUMMIT`（此拼写）和 `FAIL`，与详情返回的 `SUBMIT/FAILED` 不同；不要“修正”或混用。** 申请中的 `invoice_type` 则为 `1/2`。

```json
{
  "query_mode":"BY_OUT_REQUEST_NO",
  "out_request_no_list":["MERCHANT_INVOICE_REQUEST_NO"],
  "invoice_type":"BLUE",
  "invoice_status":"SUCCESS",
  "page_no":1,
  "page_size":20
}
```

## 下载

```json
{"saas_invoice_order_no":"MERCHANT_SAAS_INVOICE_ORDER_NO","file_type":"PDF"}
```

下载请求 `file_type` 使用 `PDF/OFD/XML`，不是申请的数字组合枚举。响应包含 `saas_invoice_order_no`、`file_type`、`file_name`、`file_size`、`file_sha_256`、`expire_time`、`download_url`。以返回的到期时间为准，不承诺固定有效期。开票成功但文件未就绪时按可恢复状态处理；取得下载地址不代表客户端已成功获取文件。
