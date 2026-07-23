# 应用发布模块

> 本文档定义应用发布的完整流程、MCP调用规范和关键处理逻辑。
> 被引用文档：`onboarding/flow.md` → Step 3.1 应用查询 + Step 5.3 应用发布
> 本文档位于 `references/onboarding/modules/`，文中的 `scripts/...` 路径相对本目录；从技能包根目录执行时对应 `references/onboarding/modules/scripts/...`。

---

## 功能概述

负责应用发布全流程，包括查询已有应用、复用/创建应用、公钥设置、审核提交。应用类型支持 `WEBAPP` 和 `MOBILEAPP`。

**触发条件：**
- 用户说"发布应用"、"创建应用"
- onboarding 登录、scope 和 MCC 校验完成后触发应用列表查询；应用复用/创建按应用分支自身条件推进，不依赖签约提交结果

> APP 支付对应移动应用发布：应用列表查询和应用创建使用 `MOBILEAPP`；网站支付和按量付费继续使用 `WEBAPP`。

---

## 流程骨架

```
前置阶段 1: 检查 CLI 登录态
    ↓
阶段 2: 登录后查询已有应用 (queryApplicationList)
    ↓
阶段 3: 三分支短摘要后进入应用类别，用户一次选择并提供应用条件资料
    ↓
应用查询、资料和当前候选选择均满足: 执行应用分支
    ├─ 【复用】选择已有上线应用 → 查询安全密钥
    │      ├─ RSA2 应用公钥已生效 → 导出 alipayPublicKey → 完成
    │      └─ RSA2 应用公钥未生效 → 停止复用成功结论，由用户选择设钥或返回应用决策
    └─ 【新建】创建新应用 → 进入阶段 3.2
    ↓
阶段 3.2: 创建应用 (createApplication) — 仅新建路径
    ↓
阶段 4: 设置应用公钥 (createKeyConfirmPage) — 新建路径或复用缺公钥恢复路径
    ↓
阶段 4.1: 确认应用公钥已生效 (queryApplicationSecurityKey) — 新建路径或复用缺公钥恢复路径
    ├─ 复用缺公钥恢复路径 → 重新执行复用分支，重新校验应用状态并导出支付宝公钥
    └─ 新建路径 → 阶段 5: 提交应用审核 (submitApplicationAudit)
```

---

## 当前主流程 MCP 调用

| MCP 方法 | 用途 |
|------|------|
| `apprelease.queryApplicationList` | 查询同类型已有应用 |
| `apprelease.createApplication` | 创建应用 |
| `apprelease.queryApplicationInfo` | 复用路径校验应用信息 |
| `apprelease.createKeyConfirmPage` | 创建密钥确认页 |
| `apprelease.queryApplicationSecurityKey` | 查询应用安全密钥 |
| `apprelease.submitApplicationAudit` | 提交应用审核 |

## 应用类型规则

应用类型必须在查询和创建阶段保持一致：

| 产品 | productType | salesCode | 应用类型 | 查询应用入参 | 创建应用入参 |
|------|-------------|-----------|----------|--------------|--------------|
| 按量付费 | `aipay` | `I1080300001000160457` | `WEBAPP` | `{"request":{"appTypes":["WEBAPP"]}}` | `{"request":{"applicationType":"WEBAPP","createScene":"cli"}}` |
| 网站支付 | `webpay` | `I1080300001000041203` | `WEBAPP` | `{"request":{"appTypes":["WEBAPP"]}}` | `{"request":{"applicationType":"WEBAPP","createScene":"cli"}}` |
| APP 支付 | `apppay` | `I1080300001000041313` | `MOBILEAPP` | `{"request":{"appTypes":["MOBILEAPP"]}}` | Skill 仅支持 `IOS`、`ANDROID`、`ALL`；HarmonyOS 移动应用须前往支付宝开放平台控制台创建 |

`scripts/app.sh` 的应用类型解析规则：

1. 如果显式传入 `--application-type WEBAPP|MOBILEAPP`，必须与产品上下文匹配。
2. 否则如果传入 `--product-type apppay` 或 `--sales-code I1080300001000041313`，使用 `MOBILEAPP`。
3. 其他情况默认使用 `WEBAPP`。

`MOBILEAPP` 平台字段规则：

- `alipay-aipay` 当前要求 APP 支付创建 `MOBILEAPP` 前必须明确 `mobilePlatform`，禁止用最小入参创建 `MOBILEAPP`。
- `mobilePlatform` 只允许 `IOS`、`ANDROID` 或 `ALL`；`ALL` 只表示同时支持 iOS 和 Android。
- `mobilePlatform=IOS`：必须同时传 `bundleId`。
- `mobilePlatform=ANDROID`：必须同时传 `appPackage` 和 `appSign`。
- `mobilePlatform=ALL`：必须同时传 `bundleId`、`appPackage` 和 `appSign`。
- HarmonyOS 移动应用禁止调用 `scripts/app.sh create`，也不得向 `createApplication` 传入推测的 HarmonyOS 平台或审核字段。必须执行 `printf '%s' '{}' | node ../../normal/scripts/render_customer_message.mjs application.harmony.manual_create --variant DEFAULT`，引导用户前往支付宝开放平台控制台创建。
- 用户说“bundle_id”时，映射到脚本参数 `--bundle-id`，MCP 请求字段为 `bundleId`。
- `appSign` 是 Android 应用签名摘要字段，只在创建 `MOBILEAPP` 时作为 `createApplication` 入参采集；它不是应用公钥、支付签名串或私钥。
- 采集 `appSign` 时只要求用户提供其 Android 应用对应的签名摘要值；不得引导用户通过支付宝开放平台官方密钥生成工具、签名工具或格式转换工具获取，也不得把阶段 4 的应用公钥生成引导套用到 `appSign`。
- 不确定字段值时不要编造，也不要用包名、签名摘要或 bundleId 的占位符调用 `createApplication`。

---

## ⛔ 应用相关 MCP 调用铁律（最高优先级）

**应用相关 MCP 调用具有独特的参数结构，与签约模块完全不同，禁止混用！**

### 参数结构对照表

| 方法 | 必需参数 | 参数结构 | 是否需要 ctx |
|------|----------|----------|--------------|
| `apprelease.queryApplicationList` | `appTypes` | `{"request":{"appTypes":["WEBAPP"]}}` 或 `{"request":{"appTypes":["MOBILEAPP"]}}` | ❌ 不需要 |
| `apprelease.createApplication` | `applicationType`, `createScene`；APP 支付通过 Skill 创建 `MOBILEAPP` 时还必须按受支持平台传字段 | `WEBAPP`: `{"request":{"applicationType":"WEBAPP","createScene":"cli"}}`；`MOBILEAPP IOS`: `{"request":{"applicationType":"MOBILEAPP","createScene":"cli","mobilePlatform":"IOS","bundleId":"..."}}`；`MOBILEAPP ANDROID`: `{"request":{"applicationType":"MOBILEAPP","createScene":"cli","mobilePlatform":"ANDROID","appPackage":"...","appSign":"..."}}`；`MOBILEAPP ALL`: `{"request":{"applicationType":"MOBILEAPP","createScene":"cli","mobilePlatform":"ALL","bundleId":"...","appPackage":"...","appSign":"..."}}` | ❌ 不需要 |
| `apprelease.queryApplicationInfo` | `appId` | `{"request":{"appId":"..."}}` | ❌ 不需要 |
| `apprelease.createKeyConfirmPage` | `appId`, `signType`, `publicKey` | `{"request":{"appId":"...","signType":"RSA2","publicKey":"..."}}` | ❌ 不需要 |
| `apprelease.queryApplicationSecurityKey` | `appId` | `{"request":{"appId":"..."}}` | ❌ 不需要 |
| `apprelease.submitApplicationAudit` | `appId` | `{"request":{"appId":"..."}}` | ❌ 不需要 |

### 正确调用示例

> 📎 所有 MCP 调用均有对应脚本，直接执行脚本即可。以下列出各命令与脚本的对应关系：

```bash
# ✅ 查询应用列表 → scripts/app.sh list --product-type <type> --sales-code <code>（按产品上下文自动选择 WEBAPP/MOBILEAPP）
# ✅ 创建应用 → scripts/app.sh create --product-type <type> --sales-code <code>（按产品上下文自动选择 WEBAPP/MOBILEAPP）
# ✅ 创建指定平台移动应用 → scripts/app.sh create --product-type apppay --sales-code I1080300001000041313 --mobile-platform IOS --bundle-id <bundleId>
# ✅ 创建 Android 移动应用 → scripts/app.sh create --product-type apppay --sales-code I1080300001000041313 --mobile-platform ANDROID --app-package <appPackage> --app-sign <appSign>
# ✅ 创建 iOS + Android 移动应用 → scripts/app.sh create --product-type apppay --sales-code I1080300001000041313 --mobile-platform ALL --bundle-id <bundleId> --app-package <appPackage> --app-sign <appSign>
# ❌ HarmonyOS 移动应用不通过 Skill 创建 → 执行 renderer 命令输出 application.harmony.manual_create，并前往支付宝开放平台控制台
# ✅ 设置公钥 → scripts/app.sh key <appId> <publicKey>
# ✅ 确认公钥 → scripts/app.sh verify-key <appId> [publicKey]
# ✅ 提交审核 → scripts/app.sh audit <appId>
```

表中全部方法都由 `scripts/app.sh` 的公开子命令或其内部复用、校验路径调用。参数表用于维护时核对冻结契约，不授权 Agent 绕过脚本直调 MCP；当前脚本没有对应入口时必须停止，不得根据参数表自行构造调用。

### 禁止调用形态

运行时只执行 `scripts/app.sh`，不得把下列错误形态展开成可执行命令：

- 应用请求增加 `ctx`；
- 应用列表省略必需的 `request.appTypes`，或省略 `request` 包裹层；
- 把签约查询的 `salesProductCodes` 混入应用列表请求；
- APP 支付按 `WEBAPP` 查询或创建应用。

这些条目只用于说明参数边界，不是排障候选。脚本返回参数错误时停止当前应用分支并核对冻结契约，禁止逐项尝试错误形态。

### 应用模块与签约模块参数结构对比

| 模块 | 参数结构特征 | ctx 参数 | 示例 |
|------|-------------|----------|------|
| ar-sign / ar-query | `{"request":{...},"ctx":{}}` | ✅ 必须包含 | `{"request":{"salesProductCodes":["..."]},"ctx":{}}` |
| apprelease | `{"request":{...}}` | ❌ 不需要 | `{"request":{"appTypes":["WEBAPP"]}}` / `{"request":{"appTypes":["MOBILEAPP"]}}` |

**重要：应用发布模块的 MCP 调用参数结构与签约模块完全不同，必须严格按照上表执行，禁止混用！**

---

## 前置阶段 1: CLI 登录态检查

> 📎 登录态检查、登录授权流程详见 `authorization.md`，本文档不重复。

---

## 阶段 2: 查询已有应用

**⚠️ 重要：在创建应用前必须先查询当前主体下是否已有可复用的应用。** 执行 `scripts/app.sh list --product-type "$PRODUCT_TYPE" --sales-code "$SALES_CODE"`。

在 onboarding 中，本查询必须在登录、scope 和 MCC 校验成功后与其他适用只读查询连续执行，不等待签约提交。查询结束后先进入三分支短摘要，轮到应用类别时一次收集当前应用决策所需条件资料。创建应用必须完成应用分支自己的候选重查；用户针对当前候选明确选择 `新建` 即为创建意图确认，重查未变化且条件字段齐备时直接创建，不以签约提交成功作为前置，也不增加第二次回复 `1`。

`productType` / `salesCode` 在此只用于校验上下文并选择 `WEBAPP` 或 `MOBILEAPP`。`queryApplicationList` 请求只按应用类型查询，因此返回项只能表述为“与当前产品所需应用类型匹配的候选应用”，不得表述为已绑定当前支付产品。

### 返回结果处理

`scripts/app.sh list --product-type "$PRODUCT_TYPE" --sales-code "$SALES_CODE"` 自动完成以下处理并输出已清洗的应用事实表。`FLOW:CREATE_NEW` 只表示当前类型应用列表确实为空；`FLOW:SELECT` 表示存在可复用上线应用，此时必须执行 `printf '%s' '{}' | node ../../normal/scripts/render_customer_message.mjs application.candidate.select --variant ONLINE_OR_NEW`；`FLOW:PENDING_APPLICATIONS` 表示只存在不可复用的非上线应用，此时必须执行 `printf '%s' '{}' | node ../../normal/scripts/render_customer_message.mjs application.candidate.select --variant PENDING_OR_NEW`，等待用户明确暂不新建或新建。用户选择只接受本轮实际输出的完整 `APP_CANDIDATE_ID`，不接受序号、历史候选或 Agent 自报值：

| 结果 | 处理方式 |
|------|----------|
| 查询失败 | 直接返回错误并停止应用分支；仅当前会话仍有效的独立业务/服务/结构错误可继续其他只读查询、候选展示和独立资料采集。认证失败或授权不匹配按 `../flow.md` Step 3.1 立即停止查询组并重新授权；应用查询恢复前禁止应用复用或创建 |
| 命中 ON_LINE 应用 | 返回已有上线应用列表，让用户选择"复用上线应用"或"新建应用" |
| 无同类型应用 | 记录新建分支，轮到应用类别时一次性收集条件资料；满足应用分支写前条件后创建 |
| 存在同类型应用但均非 ON_LINE | 展示应用 ID、名称和实际状态，说明当前不可复用；等待用户选择暂不新建或明确新建，禁止自动进入创建 |

### ⛔ 应用复用强制原则

<important>
只有状态为 `ON_LINE` 的应用才允许作为可复用候选。非 `ON_LINE` 应用可以作为不可复用的状态提示展示，用于防止重复创建，但禁止作为复用目标。

- 可复用候选和允许回复的完整 appId 只允许包含 `ON_LINE` 状态的应用
- 用户指定某个 `appId` 要复用时，必须先查询该应用状态
- 状态不是 `ON_LINE` 时，禁止复用
- 用户坚持要求复用非 `ON_LINE` 应用时，直接拒绝该复用请求；是否新建必须由用户在看到现有非上线应用后明确选择，不得自动进入新建
- 复用已有 `MOBILEAPP` 时不采集、不传入 `mobilePlatform`、`bundleId`、`appPackage`、`appSign`；平台字段只属于新建 `MOBILEAPP` 的 `createApplication` 入参
</important>

### 用户选择绑定

存在 `ON_LINE` 候选时允许回复当前完整 appId 或 `新建`；只有非上线应用时允许 `新建`、`暂不新建`；列表为空时只进入新建。选择复用后，后续 `reuse/key/verify-key/audit` 必须逐字使用同一 appId。选择新建后，在创建前重新执行相同 `app.sh list`；候选变化时旧选择失效。

选择“新建”后需要应用公钥；如果是 APP 支付，首次材料提示必须执行下方固定 runner，一次展示所有可创建平台组合并在一条回复中收集所选组合全部资料，禁止先单独询问 `mobilePlatform`。用户可以在选择“新建”的同一条回复中提前提供这些字段和应用公钥，Agent 不得在每个字段之间逐轮询问。创建前只能由固定列表 runner 再查询一次；候选快照未变化且字段齐备时直接调用创建脚本，变化时旧决策失效并重新渲染选择提示，不展示第二份创建确认摘要。

```bash
printf '%s' '{}' \
  | node ../../normal/scripts/onboarding_message_runner.mjs material-collect --category application --state APP_MOBILE_INITIAL
```

renderer 固定解释 `IOS`、`ANDROID`、`ALL` 及所需资料。用户回复后按所选组合一次校验；缺少字段使用 `PARTIAL`，校验失败使用 `INVALID`，并只使用 `iOS Bundle ID（bundleId）`、`Android 应用包名（appPackage）`、`Android 应用签名摘要（appSign）` 三个对客字段名。内部 `mobilePlatform/bundleId/appPackage/appSign` 仍按既有脚本参数映射，不改变 MCP 请求。

### 复用成功后流程

```
用户选择复用 ON_LINE 应用
    ↓
调用 queryApplicationSecurityKey 获取安全密钥
    ↓
取 signType="RSA2" 项的 alipayPublicKey
    ↓
写入 ~/.config/<appId>-alipayPublicKey.keytext
    ↓
对客输出复用成功信息
    ↓
   结束
```

对按量付费产品，复用应用成功后仍需确认服务市场注册产物已经存在。应用只提供 `appId` 和支付宝公钥，不提供 `serviceId`。

### queryApplicationSecurityKey 返回结果处理

同一次查询只针对传入的一个 `appId`，但返回中的两类列表职责不同，禁止要求应用公钥和支付宝公钥出现在同一条记录中：

- 应用公钥配置状态：检查 `securityConfigList` 中 `signType="RSA2"` 的项，`partnerPublicKey` 非空即表示已配置；兼容旧返回中 RSA2 项的 `certInfoDTO.publicKey`。
- 支付宝公钥导出：检查 `alipayKeyList` 中 `signType="RSA2"` 的项并读取非空 `alipayPublicKey`。
- `securityKeys` 仅作为旧返回结构兼容来源。不得因为 `alipayKeyList[].certInfoDTO` 为空，就忽略 `securityConfigList[].partnerPublicKey` 并误判应用未配置公钥。

> 复用应用的完整处理（查询密钥 + 确认 RSA2 应用公钥 + 导出支付宝公钥）已封装在 `scripts/app.sh reuse <appId>` 中。应用公钥未确认时输出 `FLOW:REUSE_NO_KEY`；RSA2 项未返回 `alipayPublicKey` 时输出 `FLOW:ERROR`；已取得支付宝公钥但未能写入本地时，仍输出 `FLOW:REUSE_SUCCESS` 和 `ALIPAY_PUBLIC_KEY_EXPORT_STATUS=MANUAL_CONFIGURATION_REQUIRED`。

`FLOW:REUSE_NO_KEY` 是阻断结果，脚本返回非零退出码，禁止输出复用成功或把该 `appId` 记为可用于集成的完成产物。对客必须执行下列 renderer 命令，本模块不维护第二份缺钥话术：

```bash
MESSAGE_INPUT_JSON=$(jq -cn --arg appId "$APP_ID" '{appId:$appId}')
printf '%s' "$MESSAGE_INPUT_JSON" | node ../../normal/scripts/render_customer_message.mjs application.reuse.no_key --variant DEFAULT
```

执行该消息后不再等待用户回复 `1/2`。目标 `appId` 已由用户从当前候选中选定，随后直接进入“阶段 4: 设置应用公钥”的标准工具引导和官方页面确认规则；如果用户在消息后明确要求换应用或新建应用，再返回应用决策。

为当前 `appId` 设置应用公钥时，用户提供完整应用公钥后执行 `scripts/app.sh key <appId> <publicKey>`，用户完成页面确认后自动执行 `scripts/app.sh verify-key`；确认成功后重新执行 `scripts/app.sh reuse <appId>`，由脚本再次校验应用状态并导出支付宝公钥。

不得自动生成、补全或持久化用户公钥，不得在用户未提供完整 `publicKey` 时调用 `createKeyConfirmPage`。重新执行 `reuse` 前不得推定应用仍为 `ON_LINE`；由脚本重新查询实际状态。

### 复用结果输出

固定使用 `application.operation.result`，只传实际 `appId`、状态和下一步；本模块不维护第二份成功表格。必须执行：

```bash
MESSAGE_INPUT_JSON=$(jq -cn \
  --arg appId "$APP_ID" \
  --arg actualStatus "$ACTUAL_STATUS" \
  --arg nextAction "$NEXT_ACTION" \
  '{appId:$appId,actualStatus:$actualStatus,nextAction:$nextAction}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../../normal/scripts/render_customer_message.mjs application.operation.result --variant DEFAULT
```

`full_process` 中若该应用操作结果后马上进入 onboarding Step 6 最终收口，不单独输出本消息再追加总收口；必须把同样的 `APP_ID`、`ACTUAL_STATUS`、`NEXT_ACTION` 交给 `onboarding_message_runner.mjs closeout` 处理，且 `ACTUAL_STATUS` 必须与最终收口的 `APPLICATION_RESULT` 枚举原文一致。应用已上线且配置完整时不再展开“应用分支结果”；待审核、待设置公钥、需人工配置、失败或结果未知时合并展示为“应用分支结果”。`onboarding_only`、应用分支仍需等待用户补材料/确认，或该结果不是紧邻最终收口时，仍按上方命令输出。

### 按量付费集成产物

应用创建、审核提交或复用后，固定使用 `application.operation.result` 输出实际状态和下一步；若紧邻 `full_process` 最终收口，则由 closeout runner 按完成态压缩、非完成态展开的规则处理。必须记录：

| 字段 | 用途 |
|------|------|
| `appId` | SDK 配置中的应用 ID，也是 `Payment-Needed.method.seller_app_id` |
| 支付宝公钥本地配置状态 | SDK 验签配置使用；导出成功时记录文件路径，已取得公钥但本地写入失败时记录“待手动配置” |
| 应用状态 | 只有 `ON_LINE` 应用允许复用；新建应用需按审核结果判断正式可用性 |

按量付费还需要服务市场注册产物 `serviceId`。如果只有 `appId` 而没有 `serviceId`，不能进入正式按量付费集成收口。

---

## 阶段 3: 创建应用

**⚠️ 仅在用户选择"新建应用"或无可复用应用时执行此阶段。**

### 创建前列表重查

在实际创建应用前，自动重新执行 `scripts/app.sh list --product-type "$PRODUCT_TYPE" --sales-code "$SALES_CODE"`：

- 候选 appId 和状态与 Step 3.1 一致：不重复询问用户；条件字段齐备后直接执行创建。
- 出现新的 `ON_LINE` 或非 `ON_LINE` 应用，或原候选状态变化：展示最新候选，清除旧的应用决策，等待用户基于新状态选择复用、新建或暂不新建。
- 重查失败：禁止调用 `createApplication`，仅将应用分支标记为待恢复。

该重查只在 `CREATE` 分支执行，不增加正常复用分支的工具成本。用户针对重查前的当前候选列表明确选择 `新建` 即完成创建意图确认；重查结果未变化且条件字段齐备时直接执行创建，不再追加回复 `1`。结果变化时旧选择失效，必须展示新候选并重新选择。

执行规则：

- 按量付费/网站支付：执行 `scripts/app.sh create --product-type "$PRODUCT_TYPE" --sales-code "$SALES_CODE"`。
- APP 支付 iOS：执行 `scripts/app.sh create --product-type apppay --sales-code I1080300001000041313 --mobile-platform IOS --bundle-id "<bundleId>"`。
- APP 支付 Android：执行 `scripts/app.sh create --product-type apppay --sales-code I1080300001000041313 --mobile-platform ANDROID --app-package "<appPackage>" --app-sign "<appSign>"`。
- APP 支付 iOS + Android：执行 `scripts/app.sh create --product-type apppay --sales-code I1080300001000041313 --mobile-platform ALL --bundle-id "<bundleId>" --app-package "<appPackage>" --app-sign "<appSign>"`。
- APP 支付 HarmonyOS：禁止执行 `scripts/app.sh create`。执行 `printf '%s' '{}' | node ../../normal/scripts/render_customer_message.mjs application.harmony.manual_create --variant DEFAULT`，引导用户前往 `https://open.alipay.com/` 的“控制台” → “创建移动应用”；该人工分支不收集或编造平台字段、审核材料或 MCP 参数。

APP 支付 iOS、Android 或二者同时创建时，首次一次展示并收集平台与对应完整资料；缺少或校验失败时只补问受影响字段，禁止调用 `createApplication`。用户选择 HarmonyOS 时不再补问创建字段，直接进入人工创建分支。

**一次性新建资料包**：在 onboarding 中优先使用 Step 4 已收集并校验的字段，不重复询问：

- iOS：`mobilePlatform=IOS`、`bundleId`、应用公钥（如已准备）。
- Android：`mobilePlatform=ANDROID`、`appPackage`、`appSign`、应用公钥（如已准备）。
- iOS + Android：`mobilePlatform=ALL`、`bundleId`、`appPackage`、`appSign`、应用公钥（如已准备）。
- 按量付费/网站支付：应用公钥（如已准备）。

应用公钥仍必须由用户明确提供，且所有公钥私钥红线继续生效。用户尚未准备公钥时不得阻止应用创建，但创建成功后必须停在阶段 4；禁止在没有完整 `publicKey` 时调用 `createKeyConfirmPage`。

Agent 在当前任务中记录应用操作和对应平台字段；用户改变应用类型或移动平台时，清除不再适用的旧平台字段并只补问新条件下的缺失项。应用公钥原文不得写入资料清单，只记录是否已经准备。`scripts/app.sh create` 会先在本地校验应用类型和平台条件字段，校验通过后才调用 MCP。

### HarmonyOS 人工创建边界

HarmonyOS APP 支付代码开发仍属于 Integration 支持范围，但 onboarding 不通过 Skill 创建 HarmonyOS 移动应用。对客必须执行 `printf '%s' '{}' | node ../../normal/scripts/render_customer_message.mjs application.harmony.manual_create --variant DEFAULT`；用户完成平台操作后重新查询 `MOBILEAPP` 列表。只有实际返回 `ON_LINE` 候选时才能进入既有复用校验；否则应用分支保持人工待办，不调用 `app.sh key/verify-key/audit`，也不影响签约及其他独立分支按实际结果推进。

| 结果 | 处理方式 |
|------|----------|
| 创建成功且解析到非空 appId | 获取 appId，进入阶段 4 设置应用公钥 |
| 返回成功但未解析到 appId | 按返回结构异常阻断，禁止进入公钥设置流程 |
| 创建失败 | 返回错误并停止应用分支后续动作；签约及其他独立分支仍按实际结果推进 |

如果 `createApplication` 返回 `APP_MAX_ERROR` / `应用数量达到上限`，不要继续调整 `appSign`、`bundleId`、`mobilePlatform` 等创建参数，也不要重复新建。原样使用 `error_handler.sh` 的固定脱敏错误输出；随后返回阶段 2，只允许复用本轮实际查询到的 `ON_LINE` 应用；没有该候选时应用分支保留人工待办。Agent 不得自行改写配额错误、恢复建议或支持渠道。

---

## 阶段 4: 设置应用公钥

### ⛔ 公钥私钥敏感性规范（强制执行）

```
❌ 禁止：自动为用户生成公钥或密钥对
❌ 禁止：向用户表示可以"帮助生成公钥"、"帮助生成密钥对"
❌ 禁止：提供任何密钥生成代码、命令或脚本
❌ 禁止：请求、接收或处理用户的私钥信息
❌ 禁止：在用户未明确提供 publicKey 时调用 createKeyConfirmPage
❌ 禁止：自动生成、推断、补全、改写或添加前后缀到 publicKey
```

**必须行为：**
```
✅ 必须：引导用户前往支付宝开放平台官方密钥生成工具
✅ 必须：使用下方登记的标准消息 ID
✅ 必须：只接受用户明确输入的完整 publicKey
✅ 必须：提醒用户妥善保管私钥，切勿泄露给任何人
```

**标准引导消息：** 当目标 `appId` 已确定且用户尚未准备应用公钥时，直接执行 `scripts/download_key_tool.sh`。脚本按当前操作系统自动下载 macOS/Windows 官方安装包到用户 `Downloads` 目录，并在脚本内部使用 `../../normal/customer-messages.json` 的 `key_tool.download.result` 展示实际路径、安装引导和 `https://opendocs.alipay.com/isv/02kipk` 手动下载兜底；Linux、目录不可用、网络不可达、依赖缺失、跳转不可信或包校验失败时，在脚本内部使用 `key_tool.download.fallback` 提示用户前往同一地址手动下载。脚本 stdout 是该动作唯一对客正文，不输出 `DOWNLOADED`、`PATH=`、`DOWNLOAD_FAILED`、`DOWNLOAD_REASON` 等机器标记；Agent 不得手写替代下载结果文案，也不得绕过脚本改用非官方下载地址。此动作不另询问是否下载；宿主自身的网络或文件权限审批不属于 Skill 业务确认。

下载动作只保存经过校验的官方安装包并报告实际路径，不安装、不启动、不生成密钥。用户仍需自行使用官方工具，并且只能向 Agent 提供应用公钥；私钥必须由用户自行妥善保管。与官方工具并列的本地 OpenSSL 命令生成方式仍处于待定状态，本 Skill 禁止输出或执行这类命令。

### 执行步骤

1. **引导用户准备密钥**：用户尚未准备应用公钥时自动下载当前操作系统适用的官方工具并展示安装包路径；用户已经准备公钥时跳过下载
2. **接收用户公钥**：只接受用户明确输入的完整 `publicKey`
3. **创建密钥确认页**：执行 `bash scripts/app.sh key <appId> <用户提供的公钥>`。
4. **用户在官方页面确认**：URL 完整校验通过后由受控 helper 自动打开 `confirmPageUrl`，同时展示同一裸 URL；打开失败、无 GUI 或宿主要求权限时仍保留复制链接兜底
5. **查询确认结果**：用户确认后自动执行 `bash scripts/app.sh verify-key <appId> <用户提供的公钥>` 确认设置成功；该脚本会短轮询 `queryApplicationSecurityKey`，避免支付宝侧短暂延迟导致误判
6. **按来源分支恢复**：
   - 新建应用：公钥校验成功后直接执行 `bash scripts/app.sh audit <appId>`，不再询问是否提审。公钥校验失败时禁止调用 `audit`；`audit` 在提交前尝试导出支付宝公钥，本地文件写入失败不阻塞自动提审，但必须提示后续集成需要手动配置支付宝公钥。
   - 复用缺公钥恢复：公钥校验成功后重新执行 `bash scripts/app.sh reuse <appId>`，重新校验应用状态并导出支付宝公钥；不进入新建应用的提审分支。

### ⛔ createKeyConfirmPage 返回结果处理规范（最高优先级）

**`createKeyConfirmPage` 调用返回的结果中可能包含二维码链接和 `alipays://` 协议的深度链接，这些信息禁止展示给用户！**

```
❌ 禁止展示：调用返回中的 "或使用支付宝扫描以下二维码" 提示
❌ 禁止展示：调用返回中的 alipays:// 协议链接
❌ 禁止展示：调用返回中的任何二维码图片或二维码链接

✅ 必须：将 confirmPageUrl 以裸 URL 独占一行输出给用户
✅ 必须：告知用户在支付宝官方确认页面完成公钥设置
✅ 必须：“无法跳链”提示放在确认链接前，确认链接独占一行
✅ 必须：等待用户确认后再继续后续步骤
```

**标准输出：** 用户明确提供完整应用公钥后，直接执行 `app.sh key`，不再展示或等待一次写摘要确认。`app.sh key` 在脚本内部调用 renderer 输出 `application.key.page`：页面成功打开使用 `OPENED`；`OPEN_FAILED`、`GUI_UNAVAILABLE`、`LINK_ONLY` 等未打开结果统一映射到 `OPEN_FAILED`，不向用户说明底层原因。Agent 不得手写或手动渲染该消息来替代 `app.sh key`。两种对客变体都保留同一实际 `confirmPageUrl` 裸 URL、复制访问兜底和“支付宝扫码确认应用公钥完成后请输入 1”。只有输入 `1` 表示官方页面确认完成，其他输入按问题、修改或补充处理。完整模板只在消息目录维护，本模块不维护第二份文本。

确认链接必须独占一行并放在“无法跳链”提示之后，禁止将提示文案拼接到 URL 后。

**禁止输出格式：**

```
❌ alipays://platformapi/startapp?appId=2018082061148052&page=/pages/public-key-upload/index?keyConfirmToken=xxx
```

**处理方式：**

> 📎 公钥设置调用 `bash scripts/app.sh key <appId> <publicKey>`，脚本自动提取并校验 `confirmPageUrl`、调用受控 opener，并通过 renderer 输出标准消息。

### alipayPublicKey 本地写入失败非阻塞

以脚本输出为准记录导出结果：`ALIPAY_PUBLIC_KEY_EXPORT_STATUS=EXPORTED` 时同时记录 `ALIPAY_PUBLIC_KEY_FILE`；`ALIPAY_PUBLIC_KEY_EXPORT_STATUS=MANUAL_CONFIGURATION_REQUIRED` 只表示已取得支付宝公钥但本地写入失败，正式集成前需手动配置。RSA2 项未返回 `alipayPublicKey` 时直接报错，不得记录为导出失败。禁止根据固定路径推断文件已经存在。

脚本写入支付宝公钥前将 `~/.config` 收紧为 `0700`，并以 `umask 077` 创建后校验文件为 `0600`。只有本次脚本输出的 `APP_ID`、`FLOW`/导出标记与实际文件存在性、权限均一致，才能记录应用状态和支付宝公钥导出结果；禁止根据固定路径、历史输出或 Agent 自报推断成功。

```bash
# 导出路径，由 app.sh reuse/audit 自动写入
~/.config/${APP_ID}-alipayPublicKey.keytext

# 导出时机
# 1. 复用已有上线应用时
# 2. 提交应用审核前
```

---

## 阶段 5: 提交应用审核

**⚠️ 只有确认应用公钥存在后，才继续提交审核。`scripts/app.sh verify-key` 和 `scripts/app.sh audit` 会通过 `queryApplicationSecurityKey` 判断 RSA2 公钥配置：**

新建应用的公钥校验成功后直接执行 `bash scripts/app.sh audit <appId>`，不再展示提审摘要或要求用户回复 `1`。`appId` 必须逐字使用本轮 `create` 实际返回值；公钥校验未通过时禁止调用 `audit`。

- 应用公钥状态与支付宝公钥必须分别按本模块“queryApplicationSecurityKey 返回结果处理”解析：RSA2 `securityConfigList[].partnerPublicKey` 非空即表示应用公钥已配置，同时兼容旧返回中的 `certInfoDTO.publicKey`；支付宝公钥只从 RSA2 `alipayKeyList[].alipayPublicKey` 读取。
- `alipayPublicKey` 是支付宝公钥，只用于导出验签配置，不得用于证明应用公钥已生效。
- `verify-key` 默认最多重试 6 次、每次间隔 5 秒；可通过 `APP_KEY_VERIFY_RETRIES` 和 `APP_KEY_VERIFY_INTERVAL_SECONDS` 调整。
- 应用公钥已确认但 RSA2 项未返回 `alipayPublicKey` 时，直接返回错误，不继续提审。
- 校验通过后由 `audit` 在提交审核前尝试写入 `~/.config/<appId>-alipayPublicKey.keytext`。
- 已获取 `alipayPublicKey` 但本地文件写入失败时，按本地写入失败处理并重试；重试后仍失败则输出同一待配置状态，但不阻塞提审或复用成功路径。

执行 `bash scripts/app.sh audit <appId>`。

| 结果 | 处理方式 |
|------|----------|
| 提审成功 | 输出提审成功结论，不对客展示审核单号 |
| 提审失败 | 返回错误，停止后续流程 |

---

## 对客结果

复用、创建、设钥校验和提审都固定使用 `application.operation.result`，只传本轮脚本实际输出的 `appId`、实际结果和下一步；必须执行本模块“复用结果输出”登记的 renderer 命令。若紧邻 `full_process` 最终收口，则改由 closeout runner 按完成态压缩、非完成态展开的规则处理。本模块不维护第二份成功表格；待公钥、待审核、人工配置或失败状态不得改写为完成。
