# 产品签约模块

> 本文档定义产品签约的完整流程、参数规范和状态判断逻辑。
> 被引用文档：`SKILL.md` → Step 5 入驻推进 - 签约部分

---

## 功能概述

签约模块负责产品签约流程，包括签约状态查询和签约申请提交。

**触发条件：** Step 3.1 授权后处理中，签约状态为 NOT_SIGNED 时触发。

---

## MCP能力

| MCP Server | 方法 | 用途 |
|------------|------|------|
| `ar-sign` | `apply` | 提交签约申请（主流程使用） |
| `ar-query` | `queryArInfosBySalesProd` | 按前台产品码查询合约状态 |
| `ar-query` | `queryArInfosByBackProd` | 按后台产品码查询合约状态 |
| `ar-order-query` | `queryBizOrder` | 按订单号查询签约订单 |

> **注意：** 主技能直接调用 `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call ar-sign.apply` 提交签约申请。

---

## 签约状态查询

### 查询命令

```bash
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call ar-query.queryArInfosBySalesProd \
  -d '{"request":{"salesProductCodes":["<salesCode>"]},"ctx":{}}' \
  --json 2>/dev/null
```

### 状态判断规则

**根据 `ar-query.queryArInfosBySalesProd` 返回结果判断签约状态：**

| 返回结果 | 状态判定 | 说明 |
|----------|----------|------|
| `resultObj.arInfoList` 为空数组 `[]` | `NOT_SIGNED` | 未签约 |
| `resultObj.arInfoList` 不为空，且存在 `arStatus` 为 `"02"` 的记录 | `SIGNED` | 签约已生效，跳过资料采集 |
| `resultObj.arInfoList` 不为空，且 `arStatus` 为 `"01"` | `SIGNED` | 已提交签约（待生效），跳过资料采集 |

### 判断逻辑脚本

```bash
RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call ar-query.queryArInfosBySalesProd \
  -d '{"request":{"salesProductCodes":["<salesCode>"]},"ctx":{}}' \
  --json 2>/dev/null)

# ✅ 使用 // [] 安全提取数组，判断签约状态
AR_COUNT=$(echo "$RESULT" | jq '.resultObj.arInfoList // [] | length')

if [ "$AR_COUNT" -eq 0 ]; then
  echo "📋 未签约 (NOT_SIGNED)，进入资料采集流程"
else
  # ✅ 使用 // [] 避免迭代 null 报错
  HAS_EFFECTIVE=$(echo "$RESULT" | jq -r '[.resultObj.arInfoList // [] | .[] | select(.arStatus == "02")] | length')
  HAS_SUBMITTED=$(echo "$RESULT" | jq -r '[.resultObj.arInfoList // [] | .[] | select(.arStatus == "01")] | length')

  if [ "$HAS_EFFECTIVE" -gt 0 ] || [ "$HAS_SUBMITTED" -gt 0 ]; then
    echo "✅ 已签约/已提交签约，跳过资料采集"
  else
    echo "📋 其他状态，进入资料采集流程"
  fi
fi
```

### 产品×状态分支处理表

| 签约状态 | 产品类型 | 后续流程 |
|----------|----------|----------|
| `NOT_SIGNED` | 电脑网站支付 | 进入 Step 4 资料采集（3张截图）→ Step 5 签约 + 应用发布 |
| `NOT_SIGNED` | AI收 | **直接进入 Step 5**（签约 + 服务注册 + 应用发布） |
| `SIGNED` | 电脑网站支付 | **直接进入 Step 5**（仅应用发布） |
| `SIGNED` | AI收 | **直接进入 Step 5**（服务注册 + 应用发布） |

**⚠️ AI收 无需前置资料采集：**
```
✅ 电脑网站支付未签约：需先采集 3 张网站截图，再进入 Step 5 签约
✅ AI收 未签约：直接进入 Step 5，无需前置资料采集
❌ 禁止：AI收 在 Step 4 收集服务注册信息（服务信息在 Step 5 服务注册时交互式收集）
```

---

## 签约提交

**主技能直接调用 `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call ar-sign.apply -d '<json>' --json 2>/dev/null` 提交签约申请。**

### 电脑网站支付签约 JSON

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
        "screenshot": ["<fileKey1>", "<fileKey2>", "<fileKey3>"]
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

### AI收签约 JSON

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
| `mccCode` | Step 2 方案规划 | 运行时变量，格式 `Axxxx_Bxxxx`，不持久化到状态文件 |
| `channelCode` | 固定值 | `"B_SK_SH_RPC"` |
| `orderType` | 固定值 | `"NEW_SIGN"` |
| `screenshot` | Step 4 资料采集 | **仅电脑网站支付需要**（3个fileKey），AI收 无需此项 |

### ⛔ 截图字段规则

```
✅ 电脑网站支付未签约 → 需要 3 张网站截图（首页、商品页、支付页）
✅ AI收 未签约 → 无需截图，直接签约
❌ 禁止：AI收 签约时传入 screenshot 字段
❌ 禁止：电脑网站支付签约时省略 screenshot 字段
```

---

## 签约输出规范

### 签约信息（含费率免责声明）

当签约信息包含费率时，**必须附加免责声明**：

```markdown
📋 签约信息：
  • 签约状态：[状态]
  • 费率：[费率值]

> 由于支付宝可能会有阶段性的优惠活动，实际费率可能低于该页面费率，具体以相应费用账单为准。
```

**费率免责声明规则：**
- ✅ 必须：在展示费率信息的同一区域，紧随费率信息之后添加免责声明
- ✅ 必须：免责声明使用引用块格式（`>` 开头）突出显示
- ❌ 禁止：单独展示费率信息而不附加免责声明
- ℹ️ 如果签约信息中不包含费率字段，则无需添加免责声明

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
| needRetry=true | 告知用户可以重试 |
| checkedError | 提取校验错误信息，引导用户修正字段 |

### 授权信息不匹配错误

```bash
if echo "$ERROR_MSG" | grep -qi "mccCode is not auth"; then
  echo "❌ 当前授权的经营类目与所选类目不匹配"
  # → 退出登录 → 重新授权（详见 SKILL.md 错误处理章节）
fi
```

---

## 数据存储

| 文件 | 说明 |
|------|------|
| 无独立持久化 | 签约数据由 MCP 返回，主技能直接消费 |
| `ar-sign-data.json` | 可选，主流程不依赖 |