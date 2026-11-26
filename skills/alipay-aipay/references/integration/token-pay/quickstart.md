# 周期订阅黄金路径快速开始

本指南用于普通商户、支付宝托管扣款、立即生效、单订阅项且无试用优惠的默认黄金路径，帮助商家完成支付宝订阅的基本对接。它不负责判断全部接入准备度；前置条件未知时先按 [订阅上线条件](../../onboarding/token-pay/guidance.md) 判断当前门禁，并按 [商家办理指引](../../onboarding/token-pay/guidance.md) 完成对应操作。

用户只询问某个 API、字段或局部代码时，可直接读取相关章节回答，不要求先执行完整快速开始流程。

下文展示生产应用的请求格式与接入代码，供开发和上线准备核对。要实际验证创建订阅、通知和权益，用[订阅沙箱](sandbox/sandbox-integration.md)或本地模拟；无需等待正式申请。即使已有生产应用和密钥，本 Skill 也不向生产网关运行示例。不索取密钥正文。

沙箱按“接口调用授权 → 创建订阅拿长链 → 网页工作台模拟支付并查询权益”完成首笔测试，使用沙箱应用、网关与资源，不要求安装 App，也不以以下生产开通条件为前提。工程实施按[沙箱自动接入交付](sandbox/sandbox-delivery.md)接续登录后的自动执行、续费和期末取消验收，正式上线再独立核对生产配置与规则。

## 前置条件

- ✅ 已注册支付宝企业账号
- ✅ 已创建应用并获得 APPID
- ✅ 已配置加签方式和应用网关
- ✅ 已提交订阅产品开通申请且审核通过
- ✅ 新商户已完成代调用授权

> 上述条件用于生产上线准备。条件未完成时，按 [商家办理指引](../../onboarding/token-pay/guidance.md) 补齐具体缺口，不以是否跑过沙箱代替生产资格判断。

---

## 沙箱配置来源

沙箱工程先按[公共沙箱指南](../sandbox/sandbox-setup-guide.md)执行 ensure，后续只读取项目根 `.alipay-sandbox.json`。缺少标准配置时通过 CLI 获取完整资料，不再通过浏览器单独获取私钥。以下生产配置示例不作为沙箱密钥存储方式。调用登记、通知和业务联调仍按订阅流程执行。

## 第一步：准备配置

### 1.1 获取密钥

从支付宝开放平台获取：
- AppID
- 商户私钥（本地生成）
- 支付宝公钥（平台获取）

### 1.2 配置文件

```yaml
# config.yaml
alipay:
  app_id: "YOUR_APP_ID"
  private_key: "YOUR_APP_PRIVATE_KEY"
  alipay_public_key: "YOUR_ALIPAY_PUBLIC_KEY"
  gateway_url: "https://openapi.alipay.com/gateway.do"
  notify_url: "https://your-domain.com/api/alipay/notify"
  return_url: "https://your-domain.com/subscription/success"
```

---

## 第二步：初始化商品

> 以下命令调用生产网关，会创建真实生产资源，并可能在后续流程产生真实交易、扣款和通知。仅用来对照代码；不要为验证本次接入而执行这些生产命令。有正式上线需求时，由商家另行审批账号、金额、退款和数据处置安排。

### 2.1 创建商品

```bash
# 公共参数放 URL Query；GENERATED_SIGNATURE 需按本次全部参数实时生成
curl -X POST 'https://openapi.alipay.com/gateway.do?app_id=YOUR_APP_ID&method=alipay.trade.product.create&format=JSON&charset=UTF-8&sign_type=RSA2&timestamp=YYYY-MM-DD%20HH%3Amm%3Ass&version=1.0&sign=GENERATED_SIGNATURE' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'biz_content={"name":"AI会员专业版","description":"包含高级功能","metadata":"{\"default\":\"default\"}"}'
```

**保存返回的 `product_id`**

### 2.2 创建价格

```bash
# 月付价格：99元/月
curl -X POST 'https://openapi.alipay.com/gateway.do?app_id=YOUR_APP_ID&method=alipay.trade.price.create&format=JSON&charset=UTF-8&sign_type=RSA2&timestamp=YYYY-MM-DD%20HH%3Amm%3Ass&version=1.0&sign=GENERATED_SIGNATURE' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'biz_content={
    "product_id":"YOUR_PRODUCT_ID",
    "unit_amount":9900,
    "recurring":{"interval":"MONTH","interval_count":1},
    "metadata":"{\"default\":\"default\"}"
  }'
```

**保存返回的 `price_id`**

---

## 第三步：用户订阅流程

### 3.1 创建客户（用户注册时）

```go
// 用户在你的平台注册时，同步创建支付宝客户
customerResp, _ := alipayClient.CreateCustomer(&service.CustomerCreateRequest{
    Name:  "YOUR_CUSTOMER_NAME",
    Phone: "YOUR_CUSTOMER_PHONE",
    Email: "YOUR_CUSTOMER_EMAIL",
})
// 保存“商户用户ID ↔ customer_id”映射；customer_id 是客户ID，不是支付宝用户ID
```

同一商户用户建议稳定复用同一个 `customer_id`，不要在每次购买时重复创建客户。手机号和
邮箱是客户资料，不等同于支付宝账户身份；详细关系见
[完整 API 文档的客户创建章节](api-complete.md)。

### 3.2 创建订阅（用户点击订阅）

```go
// 用户选择套餐后，创建订阅
subResp, _ := alipayClient.CreateSubscription(&service.SubscriptionCreateRequest{
    CustomerId: customerID,  // 从数据库获取
    Items: []service.SubscriptionItem{
        {PriceId: priceID},  // 对应套餐的 price_id
    },
    SubscribeTitle: "AI会员专业版-月度订阅",
})

// 返回支付链接给前端
return gin.H{
    "pay_url": subResp.AlipaySchema,  // 前端跳转到此链接
}
```

### 3.3 前端跳转支付

```javascript
// 前端收到 pay_url 后
window.location.href = response.pay_url;
// 或生成二维码让用户扫码
```

---

## 第四步：处理异步通知

### 4.1 实现通知接口

```go
// POST /api/alipay/notify
// import "encoding/json"
func (h *WebhookHandler) AlipayNotify(c *gin.Context) {
    // 1. 解析参数
    c.Request.ParseForm()
    params := parseNotifyParams(c.Request.Form)

    // 2. 验证签名
    if !h.alipayClient.VerifyCallback(params) {
        c.String(400, "fail")
        return
    }

    // 3. subscription_id 位于 subscription JSON 内，不是通知顶层字段
    var subscription struct {
        SubscriptionID string `json:"subscription_id"`
    }
    if err := json.Unmarshal([]byte(params["subscription"]), &subscription); err != nil || subscription.SubscriptionID == "" {
        c.String(400, "fail")
        return
    }

    // 4. 幂等处理（重要！）
    notifyID := params["notify_id"]
    if isProcessed(notifyID) {
        c.String(200, "success")
        return
    }

    // 5. 处理业务
    subscriptionID := subscription.SubscriptionID
    changeType := params["change_type"]
    switch changeType {
    case "active":
        // 首次支付成功，开通权益
        activateSubscription(subscriptionID)
    case "period_extend":
        // 续费成功，延长权益
        extendSubscription(subscriptionID)
    case "cancel":
        // 用户取消，标记订阅
        cancelSubscription(subscriptionID)
    }

    // 6. 标记已处理
    markProcessed(notifyID)

    // 7. 返回成功
    c.String(200, "success")
}
```

### 4.2 配置应用网关

在支付宝开放平台配置：
```
应用详情 → 开发设置 → 应用网关
→ 填写: https://your-domain.com/api/alipay/notify
```

---

## 第五步：查询订阅状态

```go
// 查询用户订阅状态
subResp, _ := alipayClient.QuerySubscription(&service.SubscriptionQueryRequest{
    CustomerId: customerID,
    SubscriptionStatus: "ACTIVE",  // 只查询活跃订阅
})

if len(subResp.Subscriptions) > 0 {
    // 用户有有效订阅
    sub := subResp.Subscriptions[0]
    fmt.Printf("订阅状态: %s, 到期时间: %s",
        sub.SubscriptionStatus,
        sub.CurrentPeriodEnd)
}
```

---

## 完整流程图

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   商户后台   │     │   支付宝    │     │    用户     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │ 1. 创建商品/价格   │                   │
       │──────────────────>│                   │
       │<──────────────────│                   │
       │   product_id      │                   │
       │   price_id        │                   │
       │                   │                   │
       │                   │  2. 用户注册      │
       │<──────────────────────────────────────│
       │                   │                   │
       │ 3. 创建客户       │                   │
       │──────────────────>│                   │
       │<──────────────────│                   │
       │   customer_id     │                   │
       │                   │                   │
       │                   │  4. 用户点击订阅  │
       │<──────────────────────────────────────│
       │                   │                   │
       │ 5. 创建订阅       │                   │
       │──────────────────>│                   │
       │<──────────────────│                   │
       │   pay_url         │                   │
       │                   │                   │
       │                   │  6. 跳转支付      │
       │                   │<──────────────────│
       │                   │                   │
       │ 7. 异步通知       │                   │
       │<──────────────────│                   │
       │                   │                   │
       │ 8. 开通权益       │                   │
       │                   │                   │
       │                   │  9. 支付成功页面  │
       │                   │──────────────────>│
       │                   │                   │
```

---

## 常见问题速查

| 问题 | 解决方案 |
|-----|---------|
| 验签失败 | 检查是否使用「支付宝公钥」验签 |
| items 参数缺失 | `items` 必须是数组：`[{"price_id":"xxx"}]` |
| 收不到通知 | 检查应用网关配置、返回格式是否正确 |
| 重复通知 | 根据 `notify_id` 实现幂等处理 |

详细排查请参考 [troubleshooting.md](troubleshooting.md)

---

## 下一步

- 查看完整 API 示例：[api-examples.md](api-examples.md)
- 了解数据模型：[data-model-reference.md](data-model-reference.md)
- 参考代码实现：[code-example-go.md](code-example-go.md)
