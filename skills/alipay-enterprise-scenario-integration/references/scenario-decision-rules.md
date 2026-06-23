# 场景决策规则

## 事实来源

开始场景决策前必须已通过 `tools/install_subskills.js` 安装并验证三个平级子 Skill。场景决策随后实时读取以下子 Skill 文档，不维护另一份字段白名单：

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
- 费控模式；内部费控时还必须包含制度额度/发放来源
- 因公优先状态；默认关闭，只有用户明确提出需要时才进入启用判断
- 账单识别字段
- 三域模块范围

上下文可唯一推断时展示结果后继续；存在歧义或缺少规则值时必须询问。问询必须只覆盖未决项，不得把已经由用户或上下文确认的模式、模块或默认策略重新混入选项。

`sceneType` 不是默认询问项。用户未明确指定、上下文也不能识别出加班、补贴福利、差旅、招待等因公场景时，默认使用 `DEFAULT`；票务类场景（`expenseType=TICKET`）默认使用 `TRAVEL`。用户明确提出其它因公场景，或上下文能唯一识别出其它场景时，才改用对应枚举，并校验该枚举来自制度接口文档。

线下到店类同时提供“指定门店”和“广泛商户”约束时，必须确认其中一个分支，并在 `scenario.json` 中分别写为 `SPECIFIED_MERCHANT` 或 `BROAD_MERCHANT`；不同分支的必用规则因子不能混为一组。

例如地铁场景可以从文档确定 `METRO/METRO` 和必用 `CARD_TYPE`，但不能凭空选择城市卡编码。必须根据用户城市或明确卡编码生成。

## 内部费控制度额度/发放来源

如果费控模式为内部费控，代码生成前必须确认制度额度/发放来源，不能只生成商户、时间、位置等使用限制。该决策来自费控子 Skill 的字段和接口生成规则，最终必须落到以下三种之一：

1. `ISSUE_RULE`：配置 `issue_rule_info_list` 发放规则。默认选择该模式。
2. `QUOTA_LIMIT`：配置制度可用额度的限额条件。可用因子仅包括 `QUOTA_DAY`、`QUOTA_WEEK`、`QUOTA_MONTH`、`QUOTA_SEASON`、`QUOTA_YEAR`、`QUOTA_TOTAL`，并且必须确认业务值。
3. `MANUAL_ISSUE`：选择并实现手工发放接口 `alipay.ebpp.invoice.expensecontrol.quota.create`。

用户未明确额度管控模式、上下文也没有指向其它模式时，默认使用 `ISSUE_RULE`，不主动询问三选一。用户明确提到“制度总额/日额度/周期额度/限额条件/额度上限”等额度管控诉求时，才进入 `QUOTA_LIMIT` 并确认限额因子和值；用户明确提到“手工发放/人工发放/通过接口发放额度”等诉求时，才进入 `MANUAL_ISSUE`。不得把“内部费控制度必须有额度来源”简化成“必须选择限额因子”，因为默认发放规则和手工发放也是合法来源。

费控模式已经由用户或上下文确认时，不得把另一种费控模式作为同级选项再次询问。内部费控已确认且上下文未提出额度限额或手工发放诉求时，直接采用 `ISSUE_RULE` 并继续；如仍需展示确认，只能展示“已采用内部费控 + 默认发放规则”，不能把“外部费控”混入同一个待确认列表。

## 因公优先

因公优先是可选增强能力，不属于场景接入的默认必选项。除非用户明确提出“需要因公优先”“企业码优先”“因公支付优先”等需求，否则不要主动询问，也不要把“是否启用因公优先”放进选择题或确认项；`scenario.json` 直接写入 `businessPriority.enabled=false` 和空的 `merchantRestrictionFactors`，继续后续决策。

用户明确提出需要因公优先时，才判断当前场景是否支持。判断时读取费控子 Skill 的 `expense-type-constraints.md`，看当前费用类型/子类及已选约束分支是否能配置有效商户限制因子。

以下场景不支持因公优先：

- 费用场景约束中没有任何有效商户限制因子。
- 场景使用 `ALI_PLATFORM_TYPE` 并选择 `TAOTIAN`、`1688` 等淘系平台值。
- 当前费用场景只包含 `TAKE_AWAY_CATEGORY`、`MCC`、`BRAND`、`MERCHANT_LABEL` 等品类、商户类型、品牌或标签类因子，没有下方列出的有效商户限制因子。

不支持时：

- 不询问用户是否继续启用因公优先，只说明当前场景不支持。
- `scenario.json` 直接写入 `businessPriority.enabled=false` 和空的 `merchantRestrictionFactors`。
- 不为因公优先额外生成 `ALARM_CLOCK_TIME` 与商户限制规则组合。

有效商户限制因子仅包括：

- `MEAL_MERCHANT`
- `MERCHANT`
- `COMPOSITE_MERCHANT`
- `SHOP_GROUP`
- `SHOP`
- `RECEIPT_IDENTITY_WHITE_LIST`

`TAKE_AWAY_CATEGORY` 虽然用于外卖商户/品类约束，`MCC`、`BRAND`、`MERCHANT_LABEL` 虽然也和商户范围相关，但都不计入因公优先所需的有效商户限制因子。

用户已明确选择启用，且场景支持因公优先时：

1. 必须配置 `ALARM_CLOCK_TIME`。
2. 必须至少配置一个当前费用场景约束中允许的有效商户限制因子。
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
  "expenseControlMode": "internal",
  "internalFundingSource": {
    "type": "ISSUE_RULE"
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
