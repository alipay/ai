# 拒绝引导话术

> 本文件定义用户明确要求用收单流程开通或开发本流程不支持的产品时的引导话术。
> 本文件位于 `references/normal/`，文中的 `scripts/...` 路径相对本目录。

---

## 标准拒绝引导

当用户明确要求开通或开发下表中的产品，且已确认是本收单流程不支持的动作时，使用 `json/customer-messages.json` 的 `product.unsupported`，传入用户实际产品名。必须执行：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message product-unsupported --product-name "$PRODUCT_NAME" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

支持范围、开放平台文档、传统支付集成 Skill 和商家平台链接只在消息目录维护；本文件不复制标准正文。

---

## 适用场景

| 用户提及的产品 | 引导方式 |
|---------------|----------|
| 预授权支付 | 使用标准引导 |
| 独立商家扣款 | 仅当要求开通或开发传统扣款产品时使用。余额低于阈值等已约定条件触发的自动续购，见 [Token Pay 自动续购](../integration/token-pay/auto-renewal.md)。 |
| 订单码支付 | 使用标准引导 |
| 当面付 | 使用标准引导 |
| 付款码 | 使用标准引导 |
| JSAPI支付 | 使用标准引导 |

> 按已有订单在网页/H5 收一笔款，可走网页基础收款；同在 H5 上售卖按月自动续费的会员，应走周期订阅。仅出现“商家扣款”或“H5”不触发拒绝，例如订阅办理材料中提到商家扣款权限。

---

## 调用位置

[收单运行入口](../runtime-entry.md)在已明确收单执行边界时使用本话术。产品或买卖方角色尚未分清，先按[产品选择](../product-decision.md)判断；仅咨询其他业务时按[官网查询](../official-website.md)找资料。

**重要**：如需修改对客文字或链接，只修改 `json/customer-messages.json` 与对应 `json/policy-rules.json` 官方 URL；本文件只维护适用语义。
