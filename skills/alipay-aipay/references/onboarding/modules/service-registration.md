# 服务市场注册模块

> 本文档定义按量付费产品的服务市场上架流程。**仅按量付费产品需要服务市场注册**。
> 被引用文档：`onboarding/flow.md` → Step 3.1 服务查询 + Step 5.2 服务注册
> 本文档位于 `references/onboarding/modules/`，文中的 `scripts/...` 路径相对本目录；从技能包根目录执行时对应 `references/onboarding/modules/scripts/...`。

---

## 功能概述

将 MCP 服务上架到支付宝服务市场。**仅对"按量付费"产品需要**，网站支付和 APP 支付不需要服务注册。

在 onboarding 中，登录、scope、MCC 校验和本分支查询成功后，服务分支按自身候选决策、五项资料校验、创建摘要或修改确认独立推进；不以签约提交成功或应用分支结果作为前置。服务失败只阻断服务分支，不回滚签约或应用成功结果。

**⚠️ 触发条件：**
```
✅ 按量付费（salesCode = I1080300001000160457）→ 需要服务注册
❌ 网站支付（salesCode = I1080300001000041203）→ 不需要
❌ APP 支付（salesCode = I1080300001000041313）→ 不需要
```

---

## 服务注册完整流程（最高优先级）

**⚠️ 必须严格按照以下流程执行，不可跳过任何步骤！**

```
┌─────────────────────────────────────────────────────────────────────┐
│                     按量付费 服务注册流程                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Step 1: 查询已有服务                                                │
│    └─ 调用 discoverBazaarServicesForMcp                             │
│                                                                     │
│  Step 2: 判断服务列表                                                │
│    ├─ data.items 为空 → 进入 Step 3 收集服务信息                       │
│    └─ data.items 不为空 → 展示完整分页结果后进入 Step 3 决策           │
│                                                                     │
│  Step 3: 用户决策                                                    │
│    ├─ 选择完整 serviceId 复用已有服务 → 跳过创建，完成                  │
│    ├─ 选择"新建" → ⚠️ 检查服务数量，若 ≥ 10 则禁止创建                │
│    │                 若 < 10，收集 5 项服务信息，进入 Step 4           │
│    └─ 选择"修改" → 输入服务ID，收集所有服务信息，进入 Step 4          │
│                                                                     │
│  Step 4: 提交服务上架/修改                                           │
│    ├─ 创建新服务：调用 saveBazaarServiceForMcp（不传 serviceId）       │
│    │               ⚠️ 调用前必须确认服务数量 < 10                     │
│    └─ 修改已有服务：调用 saveBazaarServiceForMcp（传入 serviceId）     │
│                                                                     │
│  Step 5: 处理结果                                                    │
│    ├─ 成功 → 对客输出实际服务信息并记录本分支结果                      │
│    └─ 失败 → 展示错误并记录本分支恢复动作，其他独立分支继续             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**⚠️ 修改服务重要说明：**
```
修改已有服务时，必须传入 serviceId + 所有服务信息（不可只传部分字段）：
✅ 正确：传入 serviceId + serviceName + serviceDesc + resourceUrl + pricing + schemaUrl
❌ 错误：只传入 serviceId + 部分字段（会导致其他字段被清空）
```

---

## Step 1: 查询已有服务

---

**执行 `scripts/service.sh list`。**

---

## Step 2: 根据查询结果执行不同分支

### 场景 A：服务列表为空（无已有服务）

**此时进入 Step 3 收集服务信息；固定列表的空结果允许新建分支。五项资料校验通过后展示非阻塞创建摘要并直接保存，不再要求回复 `1`。**

> 📎 `scripts/service.sh list` 已内置该判断，返回 `FLOW:CREATE_NEW` 时直接进入 Step 3。
>
> ⚠️ 注意：服务数量上限为 10 个，`service.sh save` 在创建前会校验。

### 场景 B：服务列表不为空（有已有服务）

**此时必须按接口返回结果展示服务及其实际状态，让用户选择复用、创建或修改。Skill 不额外按状态过滤复用候选。**

服务事实表由 `scripts/service.sh list` 自动输出并清洗展示字段，不含用户选择说明。事实表输出后必须执行 `printf '%s' '{}' | node ../../normal/scripts/render_customer_message.mjs service.candidate.select --variant DEFAULT` 输出固定选择提示。该固定提示统一引导用户可前往支付宝 AI 付站点，登录后进入控制台 → 服务管理查看服务状态和服务详情，并将 `https://aipay.alipay.com/?from=alipay-aipay-skill` 作为裸 URL 独占一行展示；本模块不得另写第二份站点引导。只接受本轮实际 `SERVICE_CANDIDATE_ID` 中的完整 `serviceId` 表示复用、`新建` 表示创建、`修改:<serviceId>` 表示修改该候选。候选外 ID、序号、历史候选和自由格式“修改”均不接受。

**用户选择处理：**

用户决策必须针对本轮实际候选，Agent 不能代替用户选择：

| 用户输入 | 后续操作 |
|----------|----------|
| 完整 `serviceId` | 复用对应服务 → 跳过创建 |
| "新建" | 进入 Step 3 收集服务信息 → `bash scripts/service.sh save`（创建前自动校验数量 < 10） |
| `修改:<serviceId>` | 目标必须来自当前候选 → 进入 Step 3 收集**所有**字段 → `bash scripts/service.sh save --service-id <id>` |

> ⚠️ 服务数量上限 10 个，由 `service.sh save` 在创建前自动校验。

用户选择修改时可使用列表中展示的 `serviceId`。展示和记录接口返回的实际状态，不自行增加状态过滤、可用性结论或审核规则。

脚本在完整分页并校验所有候选均有非空 `serviceId` 后，同时输出 `SERVICE_CANDIDATE_ID=<serviceId>`；保存成功并按既有协议解析到实际 ID 后输出 `SERVICE_ID=<serviceId>`。复用、新建或修改必须使用本轮输出，修改结果必须与用户选定 ID 相同。标记不改变 `discoverBazaarServicesForMcp` / `saveBazaarServiceForMcp` 的方法、payload、解包或成功响应解析。

---

## Step 3: 收集服务信息（创建或修改服务时执行）

**⚠️ 在以下情况需执行此步骤：**
```
✅ 服务列表为空（无已有服务）→ 创建新服务
✅ 用户选择"新建" → 创建新服务
✅ 用户选择"修改" → 修改已有服务（提供表格中的 serviceId）
```

**⚠️ 修改服务特别注意：**
```
修改已有服务时，必须收集所有服务信息，不可只收集部分字段：
✅ 正确：收集 serviceName + serviceDesc + resourceUrl + pricing + schemaUrl 全部字段
❌ 错误：只收集需要修改的字段（会导致其他字段被清空）
```

**收集服务信息交互：** 固定使用 `../../normal/scripts/onboarding_message_runner.mjs material-collect --category service`。必须执行下列命令，`missingFields` 只使用当前缺失或校验失败的字段名；常见别名由 runner 规范化后再交给 renderer。首次收集新建/修改服务资料时，一次列出服务名称、服务描述、服务地址、服务单价和请求示例JSON；修改目标的完整 `serviceId` 在候选选择消息中确认，不混入材料字段。本模块不维护第二份对客模板。

```bash
case "$CURRENT_STATUS" in
  "待补充") MATERIALS_STATE="INITIAL" ;;
  "部分已提供，待补充") MATERIALS_STATE="PARTIAL" ;;
  "校验失败，需更正") MATERIALS_STATE="INVALID" ;;
  *) echo "❌ 未知材料状态，停止渲染" >&2; exit 1 ;;
esac
MESSAGE_INPUT_JSON=$(jq -cn \
  --arg missingFields "$MISSING_FIELDS" \
  '{missingFields:$missingFields}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../../normal/scripts/onboarding_message_runner.mjs material-collect --category service --state "$MATERIALS_STATE"
```

只补问缺失或校验失败的字段。已经通过校验的字段必须保留，不要求用户重新提交；修改服务仍必须最终获得全部五项字段，禁止只提交局部字段。

Agent 在当前任务中记录操作选择、serviceId 和五项服务资料。用户更正字段时只覆盖并重新校验该字段，其他未变化且已校验通过的字段继续复用；操作类型变化时清除不再适用的 serviceId 或创建资料。只补问缺失或校验失败字段，本模块的 `scripts/service.sh validate` 继续作为业务格式校验唯一来源。

### 入参校验规则

| 字段 | 说明 | 验证规则 | 错误提示 |
|------|------|----------|----------|
| `serviceName` | 服务名称 | 长度 1-50 字符 | 服务名称长度需在 1-50 字符之间 |
| `serviceDesc` | 服务描述 | 长度 1-500 字符 | 服务描述长度需在 1-500 字符之间 |
| `resourceUrl` | 服务地址 | 有效的 URL 格式（以 http:// 或 https:// 开头） | 请提供有效的 URL 地址 |
| `pricing` | 服务单价 | 机器值必须是 >= 0.01 的纯数字；用户带 `元/次` 时由脚本规范化 | 服务单价最低为 0.01 元 |
| `schemaUrl` | 请求示例 | 有效的 JSON 格式；提交时序列化为字符串 | 请提供有效的 JSON 格式请求示例 |

> `pricing` 的规范化机器值只使用纯数字，例如 `0.08`。用户回复 `0.08元/次` 或 `0.08 元/次` 时，`scripts/service.sh validate` 会输出 `SERVICE_PRICING=0.08`；后续 `service.create.summary`、`onboarding.write.confirm` 和 `scripts/service.sh save` 必须复用该值，不得再次拼接单位或说明文字。模板负责展示“元/次”。
>
> `schemaUrl` 是 MCP 入参字段名，本流程中承载的是序列化后的 JSON 请求示例，不是 URL。用户提供原始 JSON，例如 `{}`；`scripts/service.sh` 校验 JSON 后将其作为字符串写入 `request.schemaUrl`。禁止因为字段名含 `Url` 而要求用户提供网页地址。

### 校验脚本

> 📎 已收口到脚本：`scripts/service.sh validate`

```bash
# 收集服务信息后，调用校验脚本
bash scripts/service.sh validate   --name "$SERVICE_NAME"   --desc "$SERVICE_DESC"   --url "$RESOURCE_URL"   --pricing "$PRICING"   --schema "$SCHEMA_URL"
```

---

## Step 4: 提交服务上架/修改

### 场景 A：创建新服务（不传 serviceId）

**⚠️ 调用前必须确认服务数量 < 10，否则禁止调用 saveBazaarServiceForMcp 接口！** 五项资料通过 `scripts/service.sh validate` 后，先按 `../flow.md` Step 5 渲染非阻塞 `service.create.summary/DEFAULT`，成功后直接执行 `bash scripts/service.sh save --name <name> --desc <desc> --url <url> --pricing <pricing> --schema <json>`，不等待用户回复 `1`。创建摘要参数和随后 `save` 参数必须完全一致。


### 场景 B：修改已有服务（必须传入 serviceId + 所有字段）

按 `../flow.md` Step 5 渲染 `onboarding.write.confirm/SERVICE_UPDATE_ONLY`；取得绑定当前会话、主体、目标 `serviceId` 和完整五项资料的有效确认后，执行 `bash scripts/service.sh save --service-id <id> --name <name> --desc <desc> --url <url> --pricing <pricing> --schema <json>`。


---

## Step 5: 处理结果

### 成功输出

固定使用 `service.operation.result`，只传脚本实际取得的 `serviceId` 和结果；该消息统一引导用户到支付宝 AI 付站点，登录后进入控制台 → 服务管理查看服务状态和服务详情，并将站点 URL 裸露独占一行展示，本模块不维护第二份成功表格或站点引导。必须执行：

```bash
MESSAGE_INPUT_JSON=$(jq -cn \
  --arg serviceId "$SERVICE_ID" \
  --arg actualResult "$ACTUAL_RESULT" \
  '{serviceId:$serviceId,actualResult:$actualResult}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../../normal/scripts/render_customer_message.mjs service.operation.result --variant DEFAULT
```

`saveBazaarServiceForMcp` 的当前成功响应不包含服务状态。不得根据创建或修改成功推断为“审核中”“已上线”或其他状态。只有后续 `scripts/service.sh list` 只读查询成功并按 `serviceId` 匹配到该服务时，才能记录和展示实际状态；查询失败或尚未返回该服务时，将状态保留为“未取得”，不得因此重复执行 `save`。

### 按量付费集成产物

服务创建、修改或复用成功后，必须记录以下已取得字段，并按上方 renderer 命令固定使用 `service.operation.result` 对客输出：

服务复用、新建和修改决策都不接受 Agent 代选：存在候选时必须由用户从本轮 `SERVICE_CANDIDATE_ID` 集合选择复用、创建或修改，修改目标必须来自同一集合；列表为空时只允许新建。后续创建摘要或修改确认及脚本参数必须匹配该选择。

| 字段 | 用途 |
|------|------|
| `serviceId` | 按量付费 `Payment-Needed.method.service_id`，也是后续 402 收银联调识别服务的关键字段 |
| 服务名称 | 用于核对收银台展示和用户识别 |
| 服务地址 `resourceUrl` | 应与实际提供 402 服务的资源地址一致 |
| 服务单价 `pricing` | 应与 `Payment-Needed.protocol.amount` 的业务定价保持一致 |
| 服务状态 | 仅在只读查询实际取得时记录，用于正式上线判断和后续排查 |

如果服务注册成功但未解析到 `serviceId`，必须执行下列命令；随后重新查询完整服务列表，使用本次实际提交的服务名称、描述、地址和单价与列表实际返回字段做唯一匹配。只有恰好一个候选全部相等时才能取得其实际 `serviceId`；没有匹配、存在多个匹配或任一必要字段未返回时保持 `UNKNOWN`，不得按名称单独归属，也不得重复 `save`。取得实际 `serviceId` 前不得宣称按量付费产品开通完成。

```bash
MESSAGE_INPUT_JSON=$(jq -cn --arg serviceName "$SERVICE_NAME" '{serviceName:$serviceName}')
printf '%s' "$MESSAGE_INPUT_JSON" | node ../../normal/scripts/render_customer_message.mjs service.id.missing --variant DEFAULT
```

### 失败处理

> 📎 统一错误检测与处理见 `error-handling.md`。`scripts/service.sh save` 已内置错误检测。

---

## MCP调用规范

**MCP 服务名：`a2a-pay-service`**

| 方法 | 用途 | 调用时机 |
|------|------|----------|
| `a2a-pay-service.discoverBazaarServicesForMcp` | 查询服务列表 / 根据 serviceId 查详情 | **进入服务注册模块时首先调用**（支持两种查询方式，见下表） |
| `a2a-pay-service.saveBazaarServiceForMcp` | 创建新服务 / 修改已有服务 | 用户选择新建/修改时调用（修改须传 serviceId + 所有资料） |

**⚠️ discoverBazaarServicesForMcp 支持两种查询方式：**

| 查询方式 | 参数 | 说明 |
|----------|------|------|
| 查询服务列表 | `{"request":{"limit":10,"offset":0}}` | 返回接口可见的服务列表；脚本按 `pagination.total` 自动翻页并完整展示实际状态，不按状态过滤候选 |
| 根据 serviceId 查询详情 | `{"request":{"keyword":"API_xxx"}}` | 返回指定服务的详细信息 |

**查询返回处理：**

- MCP 信封先通过共享 `unwrap_mcp` 解包 `content[0].text`。
- 当前成功协议以 `code="10000"` 判断，服务数组读取 `data.items`，分页读取 `data.pagination.limit/offset/total`。
- 当前服务状态字段读取 `serviceStatus`，兼容旧响应中的 `status`；`ACTIVE` 表示已上线，其他未定义映射的状态值原样展示，不推断业务含义。
- 脚本兼容旧成功协议中的 `success=true` 与 `resultObj.serviceList`，但不得用旧结构覆盖或猜测当前字段。
- 只有明确取得成功响应中的空数组，才能判定没有已有服务；业务失败、字段缺失、分页不完整或候选缺少 `serviceId` 均必须阻断，禁止输出 `FLOW:CREATE_NEW` 或 `FLOW:SELECT`。

**⚠️ saveBazaarServiceForMcp 创建/修改服务参数说明：**

| 场景 | 必传参数 | 说明 |
|------|----------|------|
| 创建新服务 | serviceName, serviceDesc, resourceUrl, pricing, schemaUrl | 无需传入 serviceId |
| 修改已有服务 | **serviceId**, serviceName, serviceDesc, resourceUrl, pricing, schemaUrl | **必须传入 serviceId + 所有资料信息** |

**写入返回处理：**

- MCP 信封先通过共享 `unwrap_mcp` 解包 `content[0].text`。
- 当前成功协议必须同时满足 `code="10000"` 和 `data.success=true`，服务 ID 读取 `data.serviceId`。
- 脚本兼容旧成功协议中的 `success=true` 和 `resultObj.serviceId`；不得混用两套协议中的成功条件与服务 ID 路径。
- 创建成功但未解析到 `serviceId` 时必须阻断后续流程；修改成功未返回新 ID 时，继续使用本次请求中已经确认的原 `serviceId`。
- 业务失败优先展示 `data.subMsg` / `data.msg`，再读取顶层错误字段；响应结构不符合当前或兼容协议时不得宣称成功。
- 当前保存成功响应不包含服务状态；不得从 `success=true` 推断审核或上线状态。

其中 `schemaUrl` 按本模块约定传入序列化后的 JSON 请求示例。例如空请求示例的实际入参为：

```json
{
  "request": {
    "serviceName": "服务名称",
    "serviceDesc": "服务描述",
    "resourceUrl": "https://your-domain.com/callback",
    "pricing": "0.6",
    "schemaUrl": "{}"
  }
}
```

### 正确调用示例

> 📎 所有 MCP 调用均有对应脚本：

```bash
# ✅ 查询服务列表 → scripts/service.sh list
# ✅ 创建新服务 → scripts/service.sh save --name <name> --desc <desc> --url <url> --pricing <pricing> --schema <json>
# ✅ 修改已有服务 → scripts/service.sh save --service-id <id> --name <name> --desc <desc> --url <url> --pricing <pricing> --schema <json>
```

### 禁止调用模式

- 禁止调用当前 Skill 未登记、未验证或未封装的服务市场方法；不得根据“删除服务”“更新服务”等业务语义自行猜测方法名。
- 禁止省略 server 名称或把脚本中的方法拆成相似的裸方法名。
- 禁止绕过 `scripts/service.sh list` 直接保存服务；创建或修改前必须先查询候选并完成资料校验。
- 禁止用调试、排障或重试作为理由尝试近似 MCP 方法。

---

## 服务状态说明

当前列表响应优先读取 `serviceStatus`，旧响应兼容读取 `status`。下表以外的实际状态值必须原样展示；没有已验证依据时不得自行翻译、归类或推断是否可用。

| 状态 | 说明 | 处理方式 |
|------|------|----------|
| `DRAFT` | 草稿 | 展示接口返回的实际状态，由用户决定后续操作 |
| `PENDING` | 审核中 | 展示接口返回的实际状态，由用户决定后续操作 |
| `ACTIVE` | 已上线 | 展示接口返回的实际状态，由用户决定后续操作 |
| `REJECTED` | 审核拒绝 | 展示接口返回的实际状态，由用户决定后续操作 |

---

## ⛔ 禁止行为（最高优先级）

```
❌ 禁止：未查询已有服务直接创建新服务
❌ 禁止：未在 Step 3.1 成功查询已有服务就要求用户决定新建/修改或提供服务资料
❌ 禁止：服务列表不为空时直接创建新服务（必须让用户选择）
❌ 禁止：用户选择复用已有服务后仍创建新服务
❌ 禁止：跳过服务信息校验直接提交
❌ 禁止：使用虚拟或自行推断的 MCP 方法
❌ 禁止：修改服务时只传入部分字段（必须传入 serviceId + 所有服务信息）
❌ 禁止：用户选择"修改"后不收集完整服务信息直接提交
❌ 禁止：服务数量 ≥ 10 时仍调用 saveBazaarServiceForMcp 创建新服务
```
