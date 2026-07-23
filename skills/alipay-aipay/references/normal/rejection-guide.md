# 拒绝引导话术

> 本文件定义当用户咨询本 Skill 不支持的支付产品时的标准引导话术。
> 本文件位于 `references/normal/`，文中的 `scripts/...` 路径相对本目录。

---

## 标准拒绝引导

当用户提及以下不支持的产品时，使用 `customer-messages.json` 的 `product.unsupported`，传入用户实际产品名。必须执行：

```bash
MESSAGE_INPUT_JSON=$(jq -cn --arg productName "$PRODUCT_NAME" '{productName:$productName}')
printf '%s' "$MESSAGE_INPUT_JSON" | node scripts/render_customer_message.mjs product.unsupported --variant DEFAULT
```

支持范围、开放平台文档、传统支付集成 Skill 和商家平台链接只在消息目录维护；本文件不复制标准正文。

---

## 适用场景

| 用户提及的产品 | 引导方式 |
|---------------|----------|
| 预授权支付 | 使用标准引导 |
| 商家扣款 | 使用标准引导 |
| 订单码支付 | 使用标准引导 |
| 当面付 | 使用标准引导 |
| JSAPI支付 | 使用标准引导 |

> “手机网站支付”“H5支付”只是用户对手机浏览器网页场景的叫法，在本 Skill 中统一归为**网站支付**，不作为独立产品处理，也不使用拒绝话术。

---

## 调用位置

本话术在以下位置被引用：
- `SKILL.md` → 意图识别 → 拒绝处理
- `../integration/modules/product-decision.md` → 不支持的产品

**重要**：如需修改对客文字或链接，只修改 `customer-messages.json` 与对应 `policy-rules.json` 官方 URL；本文件只维护适用语义。
