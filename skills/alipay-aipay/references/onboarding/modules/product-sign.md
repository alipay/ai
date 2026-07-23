# 产品签约模块

> 本文档定义产品签约的完整流程、参数规范和状态判断逻辑。
> 被引用文档：`onboarding/flow.md` → Step 3.1 签约查询 + Step 5.1 签约提交
> 本文档位于 `references/onboarding/modules/`，文中的 `scripts/...` 路径相对本目录；从技能包根目录执行时对应 `references/onboarding/modules/scripts/...`。

---

## 功能概述

签约模块负责产品签约流程，包括签约状态查询和签约申请提交。

本模块采用 `ar-sign.apply` **脚本封装 / 静态参数模式**：由 `scripts/ar_sign_apply.sh` 基于当前已确认的产品类型、MCC 和资料字段直接构造 `businessProperty` 后提交申请，只覆盖本文档和脚本已经验证的字段与产品。

**使用条件：** Step 3.1 始终使用本模块的签约状态查询规则；只有查询结果为 `NOT_SIGNED` 时，才使用本模块的签约申请提交规则。`SIGNED_EFFECTIVE`、`SIGN_SUBMITTED`、查询失败或其他状态均禁止提交签约申请。

---

## 当前主流程 MCP 能力

| MCP 方法 | 用途 | 固定入口 |
|------------|------|----------|
| `ar-sign.apply` | 提交签约申请 | `scripts/ar_sign_apply.sh` |
| `ar-query.queryArInfosBySalesProd` | 按当前产品码查询合约状态 | `scripts/query_sign_status.sh`、`scripts/auth.sh` |

> 本表只记录当前主流程脚本实际使用的方法。只能执行固定脚本入口，不得根据方法名自行构造 MCP 调用。

---

## 签约状态查询

### 查询命令

执行 `scripts/query_sign_status.sh --sales-code <当前产品码> --product-type <aipay|webpay|apppay>`。

### 状态判断规则

**根据 `ar-query.queryArInfosBySalesProd` 返回结果判断签约状态：**

| 返回结果 | 状态判定 | 说明 |
|----------|----------|------|
| `resultObj.arInfoList` 为空数组 `[]` | `NOT_SIGNED` | 未签约 |
| `resultObj.arInfoList` 不为空，且存在 `arStatus` 为 `"02"` 的记录 | `SIGNED_EFFECTIVE` | 签约已生效，跳过签约材料采集，仍在 Step 4 处理应用/服务决策 |
| `resultObj.arInfoList` 不为空，且存在 `arStatus` 为 `"01"` 的记录 | `SIGN_SUBMITTED` | 已提交签约（待生效），跳过签约材料和重复签约提交，仍在 Step 4 处理应用/服务决策 |

### 判断逻辑

`scripts/query_sign_status.sh` 自动完成以下状态判断并输出状态信号（`SIGN_STATUS=...`）与分支信号（`FLOW:PC_WEB_NOT_SIGNED` 等）。`SIGNED_EFFECTIVE` 与 `SIGN_SUBMITTED` 的后续 FLOW 保持一致，均不重复提交签约，继续应用发布/服务注册。

### 产品×状态分支处理表

| 签约状态 | 产品类型 | FLOW 信号 | 后续流程 |
|----------|----------|-----------|----------|
| `NOT_SIGNED` | 网站支付 | `FLOW:PC_WEB_NOT_SIGNED` | 签约类别收集3张网站截图；应用类别按自身候选独立决策，两个分支分别推进 |
| `NOT_SIGNED` | APP 支付 | `FLOW:APP_NOT_SIGNED` | 签约类别收集 APP 名称和 3 张 APP 界面截图；应用类别按自身候选独立决策，两个分支分别推进 |
| `NOT_SIGNED` | 按量付费 | `FLOW:AI_PAY_NOT_SIGNED` | 签约无需页面图片；签约、服务和应用分别满足自身条件后独立推进 |
| `SIGNED_EFFECTIVE` | 网站支付 | `FLOW:PC_WEB_SIGNED` | Step 4 完成应用决策后，跳过签约提交并执行应用发布 |
| `SIGNED_EFFECTIVE` | APP 支付 | `FLOW:APP_SIGNED` | Step 4 完成应用决策后，跳过签约提交并执行应用发布 |
| `SIGNED_EFFECTIVE` | 按量付费 | `FLOW:AI_PAY_SIGNED` | Step 4 完成服务/应用决策后，跳过签约提交并执行服务注册 + 应用发布 |
| `SIGN_SUBMITTED` | 网站支付 | `FLOW:PC_WEB_SIGNED` | Step 4 完成应用决策后，跳过重复签约提交并执行应用发布 |
| `SIGN_SUBMITTED` | APP 支付 | `FLOW:APP_SIGNED` | Step 4 完成应用决策后，跳过重复签约提交并执行应用发布 |
| `SIGN_SUBMITTED` | 按量付费 | `FLOW:AI_PAY_SIGNED` | Step 4 完成服务/应用决策后，跳过重复签约提交并执行服务注册 + 应用发布 |

**⚠️ 按量付费无需签约材料：**
```
✅ 网站支付未签约：签约类别一次收集 3 张网站截图
✅ APP 支付未签约：签约类别一次收集 APP 名称和 3 张 APP 界面截图
✅ 按量付费未签约：签约分支无需页面图片，不阻塞服务/应用分支的独立准备和执行
✅ 按量付费在服务类别基于已查询候选，一次收集新建/修改分支的完整五项服务资料；Step 5.2 才执行写操作
```

**按量付费完整产品开通的独立分支：**
```
✅ 未签约且提交成功：继续服务市场注册 + 应用发布
✅ 已签约：跳过签约提交，继续服务市场注册 + 应用发布
❌ 禁止：只完成产品签约就宣称按量付费产品开通完成
❌ 禁止：已签约状态下重复提交签约申请
```

按量付费最终接入至少需要三类正式产物：产品签约状态、服务市场的 `serviceId`、应用发布或复用得到的 `appId` 与支付宝公钥。签约模块只解决第一类产物。

---

## 签约提交

**执行 `scripts/ar_sign_apply.sh` 提交签约申请。脚本通过 `error_handler.sh` 间接初始化 `DEV_TOOL_NAME`；产品码和类目编码优先通过 `--sales-code`、`--mcc-code` 显式传入。签约状态为 `NOT_SIGNED` 且当前产品全部签约材料完整并校验通过后直接执行，不再增加回复 `1`；材料缺失或校验失败时继续使用 flow 登记的材料提示并禁止提交。**

```bash
# 按量付费
bash scripts/ar_sign_apply.sh --product aipay --sales-code "I1080300001000160457" --mcc-code "<mccCode>"

# 网站支付
bash scripts/ar_sign_apply.sh --product webpay --sales-code "I1080300001000041203" --mcc-code "<mccCode>" --picurl1 <imageRef1> --picurl2 <imageRef2> --picurl3 <imageRef3>

# APP 支付
bash scripts/ar_sign_apply.sh --product apppay --sales-code "I1080300001000041313" --mcc-code "<mccCode>" --app-name "<APP名称>" --picurl1 <imageRef1> --picurl2 <imageRef2> --picurl3 <imageRef3>
```

### 静态签约契约边界

当前 onboarding 只使用下方三个产品的固定字段和 `scripts/ar_sign_apply.sh` 已验证的提交结构。后端字段变化、字段校验失败或当前脚本无法处理时，必须停止受影响的签约分支并如实说明，不得凭经验增加字段、改写 payload 或尝试当前脚本未使用的方法。维护者取得实际返回或官方资料后，必须同步更新脚本、本文档、flow 和契约测试，才能恢复该分支。

### 网站支付签约 JSON（有截图）

```json
{
  "request": {
    "bizFeatures": {},
    "bizRequestNo": "<UUID>",
    "businessProperty": {
      "mccCode": "${MCC_CODE}",
      "webAppDTO": {
        "placeType": "ONLINE_WEBAPP",
        "appType": "PC_WEB",
        "appStatus": "OFFLINE",
        "screenshot": ["<imageRef1>", "<imageRef2>", "<imageRef3>"]
      }
    },
    "channelCode": "B_SK_SH_RPC",
    "extension": {},
    "orderType": "NEW_SIGN",
    "salesProductCodes": ["I1080300001000041203"]
  },
  "ctx": {}
}
```

### APP 支付签约 JSON（有 APP 名称和截图）

```json
{
  "request": {
    "bizFeatures": {},
    "bizRequestNo": "<UUID>",
    "businessProperty": {
      "mccCode": "${MCC_CODE}",
      "nativeAppDTO": {
        "placeType": "ONLINE_NATIVEYAPP",
        "name": "<APP名称>",
        "appStatus": "OFFLINE",
        "screenshot": ["<imageRef1>", "<imageRef2>", "<imageRef3>"]
      }
    },
    "channelCode": "B_SK_SH_RPC",
    "extension": {},
    "orderType": "NEW_SIGN",
    "salesProductCodes": ["I1080300001000041313"]
  },
  "ctx": {}
}
```

> APP 支付本次固定按 `appStatus=OFFLINE` 提交，不传 `appDownloadUrl`。

### 按量付费签约 JSON（无截图）

```json
{
  "request": {
    "bizFeatures": {},
    "bizRequestNo": "<UUID>",
    "businessProperty": {
      "mccCode": "${MCC_CODE}"
    },
    "channelCode": "B_SK_SH_RPC",
    "extension": {},
    "orderType": "NEW_SIGN",
    "salesProductCodes": ["I1080300001000160457"]
  },
  "ctx": {}
}
```

### 关键变量

| 变量 | 来源 | 说明 |
|------|------|------|
| `bizRequestNo` | 主技能生成 | UUID，每次签约提交前通过 `python3 -c "import uuid; print(uuid.uuid4())"` 生成，**禁止省略** |
| `mccCode` | Step 2 方案规划 | 运行时变量，格式 `Axxxx_Bxxxx` |
| `channelCode` | 固定值 | `"B_SK_SH_RPC"` |
| `orderType` | 固定值 | `"NEW_SIGN"` |
| `screenshot` | Step 4 签约材料类别 | **仅未签约的网站支付/APP 支付需要**（3个上传后的图片引用值），按量付费无需此项 |
| `appName` | Step 4 签约材料类别 | **仅未签约的 APP 支付需要**；脚本参数仍为 `--app-name`，提交到 MCP 时映射为 `nativeAppDTO.name` |
| `appStatus` | 固定值 | **仅 APP 支付需要**，本次固定为 `OFFLINE` |

### 按量付费接入产物映射

| 集成字段 | 来源 | 说明 |
|----------|------|------|
| `sellerId` | 商户 PID / 2088 账号 | 通常来自沙箱或正式商户账号信息；不要用示例商户号 |
| `serviceId` | Step 5.2 服务市场注册/复用结果 | 写入 `Payment-Needed.method.service_id` |
| `seller_app_id` / `appId` | Step 5.3 应用发布/复用结果 | 写入 SDK 配置和 `Payment-Needed.method.seller_app_id` |
| `alipayPublicKey` | Step 5.3 应用发布/复用导出结果 | 用于 SDK 验签配置 |

签约成功不直接产出 `serviceId` 或 `appId`。后续集成代码需要这些值时，必须从服务注册和应用发布步骤读取，禁止沿用示例值。

### ⛔ 截图字段规则

```
✅ 网站支付未签约 → 需要 3 张网站截图（首页、商品页、支付页；支付页是展示支付宝付款方式，等待用户去支付的页面）
✅ APP 支付未签约 → 需要 APP 名称和 3 张 APP 界面截图（首页、商品页、支付页；支付页是展示支付宝付款方式，等待用户去支付的页面），签约状态固定按 OFFLINE 提交
✅ 按量付费 未签约 → 无需截图，直接签约
✅ 网站支付/APP 支付缺少支付页或支付能力 → 不提交签约；签约分支保持待用户准备页面和截图，不自动切换流程
✅ `onboarding_only` 中途发现缺少截图或支付页 → 只收口为签约材料待补充，并提醒仍需代码开发；不得修改项目、进入代码开发或声称签约失败
✅ `full_process` 中途仍发现缺少支付页或支付能力 → 停止签约提交，回到本轮代码开发实际缺口；不得用产品开通流程补齐代码能力
✅ 网站支付/APP 支付页面和支付能力已存在、仅缺三张页面图片 → 保留在 onboarding Step 4 收集和上传，不进入集成流程
❌ 禁止：按量付费 签约时传入 screenshot 字段
❌ 禁止：网站支付/APP 支付签约时省略 screenshot 字段
❌ 禁止：将“支付页”自行改口为“支付成功页”或要求用户提供文档未定义的页面
❌ 禁止：APP 支付签约 MCP payload 中使用 webAppDTO、appDTO、appName、appType、placeType=APP、placeType=ONLINE_WEBAPP、placeType=ONLINE_NATIVEAPP 或 appType=PC_WEB
```

### 截图字段规则

截图字段以动态表单签约流程的映射为准：`webSiteInfo.screenshot[].picUrl` / `commonAppDeviceInfo.screenshot[].picUrl` 扁平化为 `webAppDTO.screenshot[]` / `nativeAppDTO.screenshot[]` 的图片引用数组。

因此 `ar_sign_apply.sh` 使用 `--picurl1/2/3` 接收上传后的图片引用值。如果 `upload_screenshots.sh` 未能从上传结果中解析出可用于签约的图片引用值，应停止流程并让用户重新上传图片。

---

## 签约提交后非阻塞推进

> ⚠️ **签约提交成功后无需等待或轮询审核；服务和应用分支按各自条件独立推进。**

签约申请提交后，后端会异步审核，`arStatus` 为 `"01"`（已提交待生效）。应用创建和服务注册不依赖签约提交动作或签约审核结果；登录、scope、MCC 以及各分支自己的查询、材料、资源决策和适用确认满足后即可推进。调度器可以按 5.1、5.2、5.3 顺序调用，也可以并发，但不得把调用顺序描述成跨分支业务依赖。

### FLOW 信号

`ar_sign_apply.sh` 签约成功后输出 FLOW 信号，指示后续步骤：

| FLOW 信号 | 产品类型 | 后续步骤 |
|-----------|----------|----------|
| `FLOW:AI_PAY_SIGN_CONTINUE` | 按量付费 | 立即继续 5.2 服务注册 + 5.3 应用发布 |
| `FLOW:PC_WEB_SIGN_CONTINUE` | 网站支付 | 立即继续 5.3 应用发布 |
| `FLOW:APP_SIGN_CONTINUE` | APP 支付 | 立即继续 5.3 应用发布 |

### 处理原则

```
✅ 签约提交成功 → 记录待生效，不轮询签约审核
✅ 按量付费：签约、服务、应用按分支条件独立推进和记录结果
✅ 网站支付/APP 支付：签约与应用按分支条件独立推进和记录结果
✅ 任一分支失败不回滚或清除其他分支成功结果
❌ 禁止：签约提交后停住，等待签约审核通过再继续
❌ 禁止：轮询签约状态直到 arStatus变为"02"再继续
```

---

## 签约输出规范

签约查询或提交的对客结果固定使用 `../../normal/customer-messages.json` 的 `signing.operation.result`，只传实际状态、实际下一步以及接口确实返回的费率。接口返回费率时使用 `WITH_FEE` 变体，模板会在费率后紧跟固定账单免责声明；没有费率字段时使用 `WITHOUT_FEE`，禁止编造费率或自行补写另一份免责声明。必须执行：

```bash
MESSAGE_INPUT_JSON=$(jq -cn \
  --arg actualStatus "$ACTUAL_STATUS" \
  --arg feeDisplay "$FEE_DISPLAY" \
  --arg nextAction "$NEXT_ACTION" \
  '{actualStatus:$actualStatus,feeDisplay:$feeDisplay,nextAction:$nextAction}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../../normal/scripts/render_customer_message.mjs signing.operation.result --variant WITH_FEE
MESSAGE_INPUT_JSON=$(jq -cn \
  --arg actualStatus "$ACTUAL_STATUS" \
  --arg nextAction "$NEXT_ACTION" \
  '{actualStatus:$actualStatus,nextAction:$nextAction}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../../normal/scripts/render_customer_message.mjs signing.operation.result --variant WITHOUT_FEE
```

待生效、失败或未知状态不得改写成签约已生效，也不得覆盖服务或应用分支的结果。

---

## 签约错误处理

### 后端错误响应格式

```json
{
  "errorCode": "xxx",
  "errorMessage": "错误描述",
  "bizTips": "业务提示（可展示给用户）",
  "needRetry": true
}
```

| 场景 | 处理方式 |
|------|----------|
| errorCode 存在 | 展示 errorMessage，如有 bizTips 一并展示 |
| needRetry=true | 仍按业务错误处理；展示实际错误和 bizTips，不自动重试或立即询问“重试/退出”，业务条件修正后再重新执行受影响动作 |
| checkedError | 提取校验错误信息，引导用户修正字段 |

### 授权信息不匹配错误

> 📎 统一错误检测见 `error-handling.md` 第三节"授权信息不匹配"。

---

## 数据存储

| 文件 | 说明 |
|------|------|
| 无独立持久化 | 签约数据由 MCP 返回，主技能直接消费，不持久化到本地文件 |
