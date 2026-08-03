# 场景决策规则

## 事实来源

开始场景决策前必须已通过 `tools/install_subskills.js` 安装并验证三个平级子 Skill。场景决策随后实时读取以下子 Skill 文档，不维护另一份字段白名单：

- 费控 `references/common/expense-type-enum.md`
- 费控 `references/common/expense-type-constraints.md`
- 费控 `references/common/rule-factors.md`
- 制度创建/修改文档中的因公场景枚举（接口字段为 `scene_type`）
- 账单 `references/common/expense-type-enum.md`
- 账单查询和订单文档中的 `expense_type`、`scene_code`、`order_type`、`order_content`

火车票三方免密代扣是可选扩展，不属于开始场景决策的默认事实来源。只有用户明确提出免密代扣、三方代扣、代扣协议、自动扣款、先签约后扣款、火车票/12306 出票扣款或票代代扣等需求时，才通过以下命令额外安装并读取 `alipay-third-party-withholding`：

```bash
node alipay-enterprise-scenario-integration/tools/install_subskills.js --with alipay-third-party-withholding
```

不得手工 unzip 该扩展 zip；安装后应存在 `<skillsRoot>/alipay-third-party-withholding/SKILL.md`，而不是在 `<skillsRoot>/SKILL.md`、`<skillsRoot>/references/` 或 `<skillsRoot>/scripts/` 出现扩展文件。

发票集成是地铁场景的选接域。确认地铁场景后必须让服务商选择是否接入；只有选择接入后才执行：

```bash
node alipay-enterprise-scenario-integration/tools/install_subskills.js --with alipay-enterprise-invoice
```

未启用时不安装、不读取发票 Skill，但仍要在地铁的 `scenario.json` 中记录 `invoiceIntegration.enabled=false`，证明已形成明确决策。

## 单场景决策

每次只生成一个场景，决策结果至少包含：

- `expenseType`
- `expenseTypeSubCategory`
- 因公场景（写入 `scenario.json` 的 `sceneType` 字段）
- `constraintVariant`（约束文档存在多个商户范围分支时）
- `requiredRuleFactors`
- 每个必用规则因子的值来源、取值方式和文档约束校验
- 费控模式；内部费控时还必须包含制度额度/发放来源
- 因公优先状态；默认关闭，只有用户明确提出需要时才进入启用判断
- 账单识别字段
- 三个基础域及已启用发票/扩展域的模块范围
- 火车票免密代扣启用状态；默认不写入，用户明确提出且场景合法时才写入 `thirdPartyWithholding.enabled=true`
- 地铁场景的发票集成决策；必须写入 `invoiceIntegration.enabled=true/false`

上下文可唯一推断时展示结果后继续；存在场景、模式或模块歧义时必须询问。问询必须只覆盖未决项，不得要求服务商选择企业运行期规则值，也不得把已经由用户或上下文确认的模式、模块或默认策略重新混入选项。

因公场景不是默认询问项。用户未明确指定、上下文也不能识别出加班、补贴福利、差旅、招待等因公场景时，费用类型为 `METRO` 的地铁场景和票务类场景（`expenseType=TICKET`）默认使用“差旅”（接口值 `TRAVEL`），其他场景默认使用“通用”（接口值 `DEFAULT`）。用户明确提出其它因公场景，或上下文能唯一识别出其它场景时，才改用对应枚举，并校验该枚举来自制度接口文档。

线下到店类同时提供“指定门店”和“广泛商户”约束时，必须确认其中一个分支，并在 `scenario.json` 中分别写为 `SPECIFIED_MERCHANT` 或 `BROAD_MERCHANT`；不同分支的必用规则因子不能混为一组。

例如地铁场景可以从文档确定 `METRO/METRO` 和必用 `CARD_TYPE`，但具体卡编码随企业而异，应由企业配置。票务 `TICKET/TICKET` 的 `MERCHANT` 则由文档唯一限定为 12306 商户 PID `2088011519249952`，服务商直接预置，不让企业选择。

## 规则因子配置责任

规则因子的关键是确定配置责任，而不是一律要求企业输入。对所有必用因子以及已启用增强能力引入的因子，先从费控约束文档判断以下来源：

1. `SCENARIO_FIXED`：当前费用场景文档给出唯一精确值。服务商使用具名场景常量预置并阻止企业覆盖，`validation=EXACT_MATCH`；`value` 必须能在当前场景约束行中精确找到。
2. `ENTERPRISE_INPUT`：值取决于企业策略。服务商提供企业维度的配置输入、约束校验和租户隔离持久化，配置变化后为该企业重建并提交制度。

两类配置都必须在调用支付宝前失败关闭，并在制度创建或修改时映射到对应 `rule_value`。只有 `SCENARIO_FIXED` 可以在 `ruleFactorCapabilities` 内记录 `value`；不得恢复无归属信息的顶层 `ruleFactorValues`，也不得把服务商自行选择的默认值标成场景固定值。

企业输入的 `validation` 使用 `DOCUMENTED_ENUM`、`DOCUMENTED_RANGE`、`DOCUMENTED_SCHEMA`、`BUSINESS_IDENTIFIER` 或 `DOCUMENTED_CONSTRAINTS`。具体枚举和结构仍以费控子 Skill 文档为事实源。

订单商户、门店、金额、时间等运行期数据用于匹配已配置的制度，或作为外部费控咨询、扣减、退还等 SPI 的请求字段。它们不是制度 `rule_value` 的配置来源，不得写入 `ruleFactorCapabilities`。

火车票固定商户示例：

```json
"ruleFactorCapabilities": {
  "MERCHANT": {
    "valueSource": "SCENARIO_FIXED",
    "value": {"2088011519249952": ["-1"]},
    "validation": "EXACT_MATCH"
  }
}
```

## 地铁发票集成

地铁 `METRO/METRO` 场景必须向服务商确认是否接入企业发票能力。该问题是地铁场景的必要范围决策，不适用“其他扩展默认静默”规则。

- 选择不接入：写入 `invoiceIntegration.enabled=false`，不安装发票 Skill，`modules.invoice` 必须省略或为空。
- 选择接入：写入 `invoiceIntegration.enabled=true`，安装并加载 `alipay-enterprise-invoice`，`modules.invoice` 至少包含 `enterprise-title`、`open-rule`、`invoice-message`、`single-invoice-query`。
- 启用即完整接入发票 Skill 的四个基础模块，不提供只选企业抬头、只选发票查询等不完整路径。
- 员工抬头、企业抬头批量查询和发票批量查询仍遵循发票 Skill 的选接规则，只在服务商明确要求时加入。
- 非地铁场景不主动展示该选项；用户明确提出时，说明当前方案 Skill 仅编排地铁发票，不自行泛化到其他场景。

## 内部费控制度额度/发放来源

如果费控模式为内部费控，代码生成前必须确认制度额度/发放来源，不能只生成商户、时间、位置等使用限制。对用户沟通时只使用中文业务名称；内部枚举值只允许出现在 `scenario.json`、代码或校验输出中，不得出现在用户确认话术里。该决策来自费控子 Skill 的字段和接口生成规则，最终必须落到以下三种之一：

1. 默认发放规则：按发放规则为员工提供可用额度。用户没有额外额度管控诉求时默认采用；生成代码时再映射到费控制度接口要求的发放规则字段。
2. 制度额度上限：按天、周、月、季度、年或总额设置员工在制度下可用的额度上限，并确认具体金额或周期值。生成代码时再映射到费控制度接口允许的额度限额因子。
3. 手工发放额度：通过发放额度接口为员工发放可用额度，适合额度由接入方业务系统或运营动作控制的场景。生成代码时再读取费控子 Skill 的手工发放接口文档。

用户未明确额度管控模式、上下文也没有指向其它模式时，默认采用“发放规则”，不主动询问三选一，也不要向用户展示内部枚举名。用户明确提到“制度总额/日额度/周期额度/限额条件/额度上限”等额度管控诉求时，才进入“制度额度上限”并确认金额或周期值；用户明确提到“手工发放/人工发放/通过接口发放额度”等诉求时，才进入“手工发放额度”。不得把“内部费控制度必须有额度来源”简化成“必须选择限额因子”，因为默认发放规则和手工发放也是合法来源。

费控模式已经由用户或上下文确认时，不得把另一种费控模式作为同级选项再次询问。内部费控已确认且上下文未提出额度限额或手工发放诉求时，直接采用默认发放规则并继续；如仍需展示确认，只能展示“已采用内部费控 + 默认发放规则”，不能把“外部费控”混入同一个待确认列表。

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

1. 必须支持企业配置 `ALARM_CLOCK_TIME`。
2. 必须支持企业配置至少一个当前费用场景约束中允许的有效商户限制因子。
3. `COMPOSITE_MERCHANT` 只有同时配置 `receiptIdentityWhiteList`、`shopIdList` 或 `shopGroupIdList` 中至少一个非空列表时，才能计为有效商户限制。
4. 因公优先不能替代场景自身的必用规则因子。

`ALARM_CLOCK_TIME` 表示可使用时间段，企业输入必须按规则因子文档校验并生成 JSON 对象字符串。若企业运行期选择的其它因子值与因公优先不兼容（例如淘系平台值），必须在提交制度前拒绝该组合。

## 火车票三方免密代扣

三方免密代扣是火车票/12306 代理购票场景的可选扩展能力，不属于企业码标准场景接入的默认链路。

默认规则：

- 用户没有明确提出免密代扣、三方代扣、代扣协议、自动扣款、先签约后扣款、火车票/12306 出票扣款、票代代扣或同义诉求时，不询问、不安装、不读取、不生成、不校验该扩展。
- 即使当前费用场景是火车票，也不得主动问“是否接入免密代扣”。
- 非火车票场景中用户提出免密代扣时，说明当前方案 Skill 仅支持火车票/12306 代理购票免密代扣，不得自行泛化到其它费用场景。
- 用户明确提出火车票免密代扣时，不提供“只签约/只代扣”拆分选择；启用即接入完整链路。

启用时，`scenario.json` 增加：

```json
"thirdPartyWithholding": {
  "enabled": true,
  "gateway": "MAPI",
  "scenario": "TRAIN_TICKET"
}
```

启用后必须覆盖完整 MAPI 链路：

- `alipay.dut.customer.agreement.page.sign`
- `alipay.dut.customer.agreement.query`
- `alipay.dut.customer.agreement.unsign`
- `dut.agent.third`
- `dut.agent.query.third`

该扩展走旧版 MAPI 网关：使用 `service`、`partner`、Query String 和 MAPI `sign`。不得套用企业码 OpenAPI SDK Request/Model/Response、不得使用 OpenAPI `method/app_id/biz_content` 模型。

## scenario.json

代码生成前写入：

```json
{
  "schemaVersion": 2,
  "status": "CONFIRMED",
  "businessScene": "差旅地铁",
  "expenseType": "METRO",
  "expenseTypeSubCategory": "METRO",
  "sceneType": "TRAVEL",
  "requiredRuleFactors": ["CARD_TYPE"],
  "ruleFactorCapabilities": {
    "CARD_TYPE": {
      "valueSource": "ENTERPRISE_INPUT",
      "validation": "DOCUMENTED_ENUM"
    }
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
  "invoiceIntegration": {
    "enabled": false
  },
  "modules": {
    "ec": ["enterprise-onboarding", "employee-signing", "enterprise-management", "employee-management"],
    "expenseControl": ["institution-management"],
    "bill": ["bill-management"]
  }
}
```

字段不适用于当前场景时可省略或使用 `null`，不得填入猜测值。`status` 必须为 `CONFIRMED`。
