# 场景决策规则

## 事实来源

场景决策必须实时读取以下子 Skill 文档，不维护另一份字段白名单：

- 费控 `references/common/expense-type-enum.md`
- 费控 `references/common/expense-type-constraints.md`
- 费控 `references/common/rule-factors.md`
- 制度创建/修改文档中的 `scene_type` 枚举
- 账单 `references/common/expense-type-enum.md`
- 账单查询和订单文档中的 `expense_type`、`scene_code`、`order_type`、`order_content`

## 单场景决策

每次只生成一个场景，决策结果至少包含：

- `expenseType`
- `expenseTypeSubCategory`
- `sceneType`
- `constraintVariant`（约束文档存在多个商户范围分支时）
- `requiredRuleFactors`
- 每个必用规则因子的已确认业务值
- 是否启用因公优先
- 账单识别字段
- 三域模块范围

上下文可唯一推断时展示结果后继续；存在歧义或缺少规则值时必须询问。

线下到店类同时提供“指定门店”和“广泛商户”约束时，必须确认其中一个分支，并在 `scenario.json` 中分别写为 `SPECIFIED_MERCHANT` 或 `BROAD_MERCHANT`；不同分支的必用规则因子不能混为一组。

例如地铁场景可以从文档确定 `METRO/METRO` 和必用 `CARD_TYPE`，但不能凭空选择城市卡编码。必须根据用户城市或明确卡编码生成。

## 因公优先

因公优先是多数费用场景的可选能力，但不是所有支付渠道都支持。

当场景使用 `ALI_PLATFORM_TYPE` 并选择 `TAOTIAN`、`1688` 等淘系平台时，不支持因公优先：

- 不询问用户是否启用因公优先。
- `scenario.json` 直接写入 `businessPriority.enabled=false` 和空的 `merchantRestrictionFactors`。
- 不为因公优先额外生成 `ALARM_CLOCK_TIME` 与商户限制规则组合。

其他支持因公优先的场景启用时：

1. 必须配置 `ALARM_CLOCK_TIME`。
2. 必须至少配置一个有效商户限制因子：
   - `MEAL_MERCHANT`
   - `MERCHANT`
   - `COMPOSITE_MERCHANT`
   - `SHOP_GROUP`
   - `SHOP`
   - `RECEIPT_IDENTITY_WHITE_LIST`
3. `COMPOSITE_MERCHANT` 只有同时配置 `receiptIdentityWhiteList`、`shopIdList` 或 `shopGroupIdList` 中至少一个非空列表时，才能计为有效商户限制。
4. 因公优先不能替代场景自身的必用规则因子。

`ALARM_CLOCK_TIME` 表示可使用时间段，值必须按规则因子文档生成 JSON 对象字符串。

## scenario.json

代码生成前写入：

```json
{
  "schemaVersion": 1,
  "status": "CONFIRMED",
  "businessScene": "差旅地铁",
  "expenseType": "METRO",
  "expenseTypeSubCategory": "METRO",
  "sceneType": "TRAVEL",
  "requiredRuleFactors": ["CARD_TYPE"],
  "ruleFactorValues": {
    "CARD_TYPE": ["S0110000"]
  },
  "businessPriority": {
    "enabled": false,
    "merchantRestrictionFactors": []
  },
  "billIdentifiers": {
    "expenseType": "METRO",
    "expenseTypeSubCategory": "METRO",
    "sceneCode": "METRO",
    "orderType": "METRO"
  },
  "modules": {
    "ec": ["enterprise-onboarding", "employee-signing", "enterprise-management", "employee-management"],
    "expenseControl": ["institution-management"],
    "bill": ["bill-management"]
  }
}
```

字段不适用于当前场景时可省略或使用 `null`，不得填入猜测值。`status` 必须为 `CONFIRMED`。
