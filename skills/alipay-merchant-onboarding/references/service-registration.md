# 服务市场注册模块

> 本文档定义 AI收产品的服务市场上架流程。
> 被引用文档：`SKILL.md` → Step 5 入驻推进 - 服务注册部分

---

## 功能概述

将 MCP 服务上架到支付宝服务市场。**仅对"AI收"产品需要。**

**⚠️ 触发条件：**
```
✅ AI收（salesCode = I1080300001000160457）→ 需要服务注册
❌ 电脑网站支付（salesCode = I1080300001000041203）→ 不需要
```

---

## 服务注册完整流程（最高优先级）

**⚠️ 必须严格按照以下流程执行，不可跳过任何步骤！**

```
┌─────────────────────────────────────────────────────────────────────┐
│                     AI收 服务注册流程                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Step 1: 查询已有服务                                                │
│    └─ 调用 discoverBazaarServicesForMcp                             │
│                                                                     │
│  Step 2: 判断服务列表                                                │
│    ├─ serviceList 为空 → 进入 Step 3 交互式收集服务信息               │
│    └─ serviceList 不为空 → 进入 Step 3 让用户选择操作                 │
│                                                                     │
│  Step 3: 用户决策                                                    │
│    ├─ 选择序号（复用已有服务）→ 跳过创建，完成                        │
│    ├─ 选择"新建" → ⚠️ 检查服务数量，若 ≥ 20 则禁止创建                │
│    │                 若 < 20，收集 5 项服务信息，进入 Step 4           │
│    └─ 选择"修改" → 输入服务ID，收集所有服务信息，进入 Step 4          │
│                                                                     │
│  Step 4: 提交服务上架/修改                                           │
│    ├─ 创建新服务：调用 saveBazaarServiceForMcp（不传 serviceId）       │
│    │               ⚠️ 调用前必须确认服务数量 < 20                     │
│    └─ 修改已有服务：调用 saveBazaarServiceForMcp（传入 serviceId）     │
│                                                                     │
│  Step 5: 处理结果                                                    │
│    ├─ 成功 → 对客输出服务信息，继续应用发布流程                        │
│    └─ 失败 → 展示错误，引导用户修正                                   │
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

**⚠️ 进入服务注册模块时，必须首先调用此接口查询已上线的服务！**

```bash
# 查询已上线服务（serviceStatus: "ACTIVE" 表示已上架服务）
RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.discoverBazaarServicesForMcp \
  -d '{"request":{"serviceStatus":"ACTIVE"}}' \
  --json 2>/dev/null)

# 解析服务列表
SERVICE_LIST=$(echo "$RESULT" | jq -r '.resultObj.serviceList // []')
SERVICE_COUNT=$(echo "$SERVICE_LIST" | jq 'length')
```

---

## Step 2: 根据查询结果执行不同分支

### 场景 A：serviceList 为空（无已有服务）

**此时必须进入 Step 3 收集服务信息并创建新服务。**

```bash
if [ "$SERVICE_COUNT" -eq 0 ] || [ "$SERVICE_LIST" = "[]" ] || [ -z "$SERVICE_LIST" ]; then
  echo "📋 暂无服务上架，需要创建新服务"
  # 直接进入 Step 3 收集服务信息
  # ⚠️ 注意：服务数量上限为 20 个，创建前需确认未超限
fi
```

### 场景 B：serviceList 不为空（有已有服务）

**此时必须让用户选择是复用已有服务还是创建新服务。**

**输出格式：**

```markdown
📋 发现您已有以下服务：

| 序号 | 服务ID | 服务名称 | 描述 | 价格 | 状态 | 服务地址 |
|------|--------|----------|------|------|------|----------|
| 1 | SVC001 | 天气查询 | 提供全球天气查询 | 0.01元/次 | 已上架 | https://api.example.com/weather |
| 2 | SVC002 | AI助手 | 智能对话服务 | 0.05元/次 | 审核中 | https://api.example.com/ai |

请选择：
  • 输入序号（1/2）复用对应服务
  • 输入"新建"创建新服务
  • 输入"修改"修改已有服务
```

**解析示例：**
```bash
echo "📋 发现您已有以下服务："
echo ""
echo "| 序号 | 服务ID | 服务名称 | 描述 | 价格 | 状态 | 服务地址 |"
echo "|------|--------|----------|------|------|------|----------|"
for i in $(seq 0 $((SERVICE_COUNT-1))); do
  SERVICE=$(echo "$SERVICE_LIST" | jq ".[$i]")
  SERVICE_ID=$(echo "$SERVICE" | jq -r '.serviceId // "未知"')
  SERVICE_NAME=$(echo "$SERVICE" | jq -r '.serviceName // "未知"')
  SERVICE_DESC=$(echo "$SERVICE" | jq -r '.serviceDesc // "无描述"')
  PRICING=$(echo "$SERVICE" | jq -r '.pricing // "未知"')
  SERVICE_STATUS=$(echo "$SERVICE" | jq -r '.status // "未知"')
  RESOURCE_URL=$(echo "$SERVICE" | jq -r '.resourceUrl // "未知"')

  # 状态转换
  case "$SERVICE_STATUS" in
    "ONLINE") STATUS_CN="已上架" ;;
    "PENDING") STATUS_CN="审核中" ;;
    "REJECTED") STATUS_CN="审核拒绝" ;;
    *) STATUS_CN="$SERVICE_STATUS" ;;
  esac

  echo "| $((i+1)) | $SERVICE_ID | $SERVICE_NAME | $SERVICE_DESC | ${PRICING}元/次 | $STATUS_CN | $RESOURCE_URL |"
done
```

**用户选择处理：**

```bash
# 解析用户选择
if [[ "$USER_CHOICE" =~ ^[0-9]+$ ]] && [ "$USER_CHOICE" -ge 1 ] && [ "$USER_CHOICE" -le "$SERVICE_COUNT" ]; then
  # 用户选择了复用已有服务
  SELECTED_SERVICE=$(echo "$SERVICE_LIST" | jq ".[$((USER_CHOICE-1))]")
  SERVICE_NAME=$(echo "$SELECTED_SERVICE" | jq -r '.serviceName')
  echo "✅ 已选择复用服务：$SERVICE_NAME"
  # 跳过服务创建，直接进入应用发布流程

elif [ "$USER_CHOICE" = "新建" ] || [ "$USER_CHOICE" = "new" ]; then
  # ⚠️ 检查服务数量限制（最多 20 个服务）
  if [ "$SERVICE_COUNT" -ge 20 ]; then
    echo "❌ 已达到服务数量上限（20个），无法创建新服务"
    echo "📋 您当前已有 $SERVICE_COUNT 个服务，请选择复用已有服务或修改已有服务"
    # 重新提示用户选择（只能选择序号或修改）
    exit 1
  fi
  echo "📋 开始创建新服务"
  # 进入 Step 3 收集服务信息

elif [ "$USER_CHOICE" = "修改" ] || [ "$USER_CHOICE" = "modify" ]; then
  # 用户选择修改已有服务
  echo "📋 开始修改已有服务"
  # 引导用户输入要修改的服务ID
  # 进入 Step 3 收集所有服务信息（修改需要传入 serviceId + 所有字段）
fi
```

---

## Step 3: 收集服务信息（创建或修改服务时执行）

**⚠️ 在以下情况需执行此步骤：**
```
✅ serviceList 为空（无已有服务）→ 创建新服务
✅ 用户选择"新建" → 创建新服务
✅ 用户选择"修改" → 修改已有服务（需先输入服务ID）
```

**⚠️ 修改服务特别注意：**
```
修改已有服务时，必须收集所有服务信息，不可只收集部分字段：
✅ 正确：收集 serviceName + serviceDesc + resourceUrl + pricing + schemaUrl 全部字段
❌ 错误：只收集需要修改的字段（会导致其他字段被清空）
```

**收集服务信息交互：**

```
📋 请提供服务注册信息：

1. 服务名称（1-50 字符）：您的服务名称
2. 服务描述（1-500 字符）：简要描述服务功能
3. 服务地址（URL）：服务的 API 地址
4. 服务单价（元，最低 0.01）：用户每次调用的费用
5. 请求示例（JSON）：API 请求参数示例

请依次提供以上信息。
```

### 入参校验规则

| 字段 | 说明 | 验证规则 | 错误提示 |
|------|------|----------|----------|
| `serviceName` | 服务名称 | 长度 1-50 字符 | 服务名称长度需在 1-50 字符之间 |
| `serviceDesc` | 服务描述 | 长度 1-500 字符 | 服务描述长度需在 1-500 字符之间 |
| `resourceUrl` | 服务地址 | 有效的 URL 格式（以 http:// 或 https:// 开头） | 请提供有效的 URL 地址 |
| `pricing` | 服务单价 | 必须 >= 0.01 元 | 服务单价最低为 0.01 元 |
| `schemaUrl` | 请求示例 | 有效的 JSON 格式 | 请提供有效的 JSON 格式请求示例 |

### 校验脚本

```bash
# 校验服务名称
if [ ${#SERVICE_NAME} -lt 1 ] || [ ${#SERVICE_NAME} -gt 50 ]; then
  echo "❌ 服务名称长度需在 1-50 字符之间"
  exit 1
fi

# 校验服务描述
if [ ${#SERVICE_DESC} -lt 1 ] || [ ${#SERVICE_DESC} -gt 500 ]; then
  echo "❌ 服务描述长度需在 1-500 字符之间"
  exit 1
fi

# 校验服务地址
if ! [[ "$RESOURCE_URL" =~ ^https?:// ]]; then
  echo "❌ 请提供有效的 URL 地址（以 http:// 或 https:// 开头）"
  exit 1
fi

# 校验服务单价
if ! [[ "$PRICING" =~ ^[0-9]+(\.[0-9]+)?$ ]] || [ "$(echo "$PRICING < 0.01" | bc)" = "1" ]; then
  echo "❌ 服务单价最低为 0.01 元"
  exit 1
fi

# 校验请求示例
if ! echo "$SCHEMA_URL" | jq -e . >/dev/null 2>&1; then
  echo "❌ 请提供有效的 JSON 格式请求示例"
  exit 1
fi
```

---

## Step 4: 提交服务上架/修改

### 场景 A：创建新服务（不传 serviceId）

**⚠️ 调用前必须确认服务数量 < 20，否则禁止调用 saveBazaarServiceForMcp 接口！**

```bash
# ⚠️ 创建前再次校验服务数量
if [ "$SERVICE_COUNT" -ge 20 ]; then
  echo "❌ 已达到服务数量上限（20个），无法创建新服务"
  echo "📋 您当前已有 $SERVICE_COUNT 个服务，请选择复用已有服务或修改已有服务"
  exit 1
fi

# 创建新服务
RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.saveBazaarServiceForMcp \
  -d "{\"request\":{\"serviceName\":\"${SERVICE_NAME}\",\"serviceDesc\":\"${SERVICE_DESC}\",\"resourceUrl\":\"${RESOURCE_URL}\",\"pricing\":\"${PRICING}\",\"schemaUrl\":\"${SCHEMA_URL}\"}}" \
  --json 2>/dev/null)

# 解析返回结果
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')

if [ "$SUCCESS" = "true" ]; then
  SERVICE_ID=$(echo "$RESULT" | jq -r '.resultObj.serviceId // "未知"')
  echo "✅ 服务上架成功"
  echo "📋 服务ID: $SERVICE_ID"
else
  ERROR_MSG=$(echo "$RESULT" | jq -r '.error.message // "未知错误"')
  echo "❌ 服务上架失败: $ERROR_MSG"
fi
```

### 场景 B：修改已有服务（必须传入 serviceId + 所有字段）

```bash
# 修改已有服务（⚠️ 必须传入 serviceId + 所有服务信息）
RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.saveBazaarServiceForMcp \
  -d "{\"request\":{\"serviceId\":\"${SERVICE_ID_TO_MODIFY}\",\"serviceName\":\"${SERVICE_NAME}\",\"serviceDesc\":\"${SERVICE_DESC}\",\"resourceUrl\":\"${RESOURCE_URL}\",\"pricing\":\"${PRICING}\",\"schemaUrl\":\"${SCHEMA_URL}\"}}" \
  --json 2>/dev/null)

# 解析返回结果
SUCCESS=$(echo "$RESULT" | jq -r '.success // false')

if [ "$SUCCESS" = "true" ]; then
  echo "✅ 服务修改成功"
  echo "📋 服务ID: ${SERVICE_ID_TO_MODIFY}"
else
  ERROR_MSG=$(echo "$RESULT" | jq -r '.error.message // "未知错误"')
  echo "❌ 服务修改失败: $ERROR_MSG"
fi
```

---

## Step 5: 处理结果

### 成功输出格式

```markdown
✅ 服务上架成功

| 项目 | 信息 |
|------|------|
| 服务名称 | 天气查询 |
| 服务描述 | 提供全球天气查询服务 |
| 服务地址 | https://api.example.com/weather |
| 服务单价 | 0.01 元/次 |
| 状态 | 审核中 |
```

### 失败处理

```bash
# 解析错误类型并引导
if echo "$RESULT" | grep -qi "已存在"; then
  echo "⚠️ 服务名称已存在，请更换名称后重试"
elif echo "$RESULT" | grep -qi "URL.*无效"; then
  echo "⚠️ 服务地址无效，请检查 URL 是否可访问"
else
  echo "❌ 服务上架失败: $ERROR_MSG"
fi
```

---

## MCP调用规范

**MCP 服务名：`a2a-pay-service`**

| 方法 | 用途 | 调用时机 |
|------|------|----------|
| `a2a-pay-service.discoverBazaarServicesForMcp` | 查询服务列表 | **进入服务注册模块时首先调用** |
| `a2a-pay-service.discoverBazaarServicesForMcp` | 根据 serviceId 查询服务详情 | 需要查询特定服务详情时调用 |
| `a2a-pay-service.saveBazaarServiceForMcp` | 创建新服务 | 用户选择新建或无已有服务时调用 |
| `a2a-pay-service.saveBazaarServiceForMcp` | 修改已有服务 | 用户需要修改服务信息时调用（必须传入 serviceId + 所有资料） |

**⚠️ discoverBazaarServicesForMcp 支持两种查询方式：**

| 查询方式 | 参数 | 说明 |
|----------|------|------|
| 查询已上线服务列表 | `{"request":{"serviceStatus":"ACTIVE"}}` | 返回所有已上架的服务列表 |
| 根据 serviceId 查询详情 | `{"request":{"keyword":"API_xxx"}}` | 返回指定服务的详细信息 |

**⚠️ saveBazaarServiceForMcp 创建/修改服务参数说明：**

| 场景 | 必传参数 | 说明 |
|------|----------|------|
| 创建新服务 | serviceName, serviceDesc, resourceUrl, pricing, schemaUrl | 无需传入 serviceId |
| 修改已有服务 | **serviceId**, serviceName, serviceDesc, resourceUrl, pricing, schemaUrl | **必须传入 serviceId + 所有资料信息** |

### 正确调用示例

```bash
# ✅ 查询已上线服务列表（进入模块时首先调用）
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.discoverBazaarServicesForMcp \
  -d '{"request":{"serviceStatus":"ACTIVE"}}' \
  --json 2>/dev/null

# ✅ 根据 serviceId 查询服务详情
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.discoverBazaarServicesForMcp \
  -d '{"request":{"keyword":"API_5B0287F98698XXXX"}}' \
  --json 2>/dev/null

# ✅ 创建新服务（不传 serviceId）
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.saveBazaarServiceForMcp \
  -d '{"request":{"serviceName":"天气查询","serviceDesc":"提供全球天气查询服务","resourceUrl":"https://api.example.com/weather","pricing":"0.01","schemaUrl":"{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}}}"}}' \
  --json 2>/dev/null

# ✅ 修改已有服务（必须传入 serviceId + 所有资料信息）
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.saveBazaarServiceForMcp \
  -d '{"request":{"serviceId":"API_EC9E4D5C71B8XXXX","serviceName":"XXX服务","serviceDesc":"xxxxxx","resourceUrl":"http://localhost:8080/cats/mock","pricing":"0.xx","schemaUrl":"{\"method\":\"GET\",\"path\":\"/cats/mock\",\"params\":{}}"}}' \
  --json 2>/dev/null
```

### 禁止调用示例

```bash
# ❌ 错误：虚拟未定义的方法
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.deleteService -d '...'

# ❌ 错误：自行推断的方法名
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.updateService -d '...'

# ❌ 错误：省略 server 名称
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call discoverBazaarServicesForMcp -d '...'

# ❌ 错误：未先查询已有服务直接创建
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call a2a-pay-service.saveBazaarServiceForMcp -d '...'
```

---

## 服务状态说明

| 状态 | 说明 | 处理方式 |
|------|------|----------|
| `DRAFT` | 草稿 | 可继续编辑或提交审核 |
| `PENDING` | 审核中 | 等待审核结果，服务暂不可用 |
| `ONLINE` | 已上架 | 服务可被调用，可直接复用 |
| `REJECTED` | 审核拒绝 | 引导用户联系客服或重新提交 |

---

## ⛔ 禁止行为（最高优先级）

```
❌ 禁止：未查询已有服务直接创建新服务
❌ 禁止：在 Step 4 资料采集阶段收集 AI收 的服务信息（服务信息在服务市场模块交互式收集）
❌ 禁止：serviceList 不为空时直接创建新服务（必须让用户选择）
❌ 禁止：用户选择复用已有服务后仍创建新服务
❌ 禁止：跳过服务信息校验直接提交
❌ 禁止：使用虚拟或自行推断的 MCP 方法
❌ 禁止：修改服务时只传入部分字段（必须传入 serviceId + 所有服务信息）
❌ 禁止：用户选择"修改"后不收集完整服务信息直接提交
❌ 禁止：服务数量 ≥ 20 时仍调用 saveBazaarServiceForMcp 创建新服务
```