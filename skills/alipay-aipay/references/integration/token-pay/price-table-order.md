# 周期订阅价格表选价

商家已在官方后台配置并获准使用周期订阅价格表时，读取该节。核验可用入口与正式资料；未确认资格的业务走[低代码接入](low-code-integration.md)的办理说明。此处仅说明周期订阅的选价页面；独立商业订单、单次价格、入参互斥和返回字段见[完整商业订单契约](api-commercial-order-create.md)。用实际调用应用的服务端 SDK 发起 `alipay.trade.commercial.order.create`，业务参数在 `biz_content` 中，签名并验签响应。使用相同的商户与环境；非 SDK 实现见[网关签名和验签](non-sdk-integration.md)。

### 多价格选择：`page_code` 价格表

1. 进入[商家平台价格表管理](https://b.alipay.com/page/checkout-management/price-management/list)，创建价格表、关联可选价格，并提前配置支付结果回跳地址。
2. 保存价格表后取得页面编码 `page_code`。这里需要的是页面编码，不是 `price_id`，也不是后台展示用的价格表名称。
3. 调用本接口，传 `customer_id`、`page_code`、`ui_mode=HOSTED`。不要同时传 `price_id`，也不要用 `order_type` 选择订阅。
4. 验签成功后保存 `order_no`，并立即为用户跳转或打开响应中原样返回的 `checkout_url`。
5. 用户在托管页面选择价格并完成支付与订阅签约；选价前的 `PRE_CREATED` 不代表已经形成有效订阅。
6. 页面操作完成后回到商家平台预先配置的商家页面。浏览器回跳只负责用户体验，不能作为支付或签约成功依据；最终状态仍以订阅通知和订单/订阅查询为准。

`redirect_url` 是可选兼容字段：如果创建请求显式传入，当前服务会保存该值并提供给 Hosted 页面。若使用此字段，请传入与商家平台成功回跳配置一致的地址；不要用它判断支付是否成功。

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


浏览器回跳只用于返回商家页面。按订阅[通知和查询](notification-guide.md)确认支付签约和权益。没有业务幂等键时按商家业务单号互斥；超时后先核对已有订单，避免创建重复订单。
