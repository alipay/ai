# 应用发布模块

> 本文档定义应用发布的完整流程、MCP调用规范和关键处理逻辑。
> 被引用文档：`SKILL.md` → Step 5 入驻推进 - 应用发布部分

---

## 功能概述

负责应用发布全流程，包括查询已有应用、复用/创建应用、公钥设置、审核提交。

**触发条件：**
- 用户说"发布应用"、"创建应用"
- 签约完成后自动触发

---

## 流程骨架

```
前置阶段 0: 初始化 .gitignore（防止密钥文件泄露）
    ↓
前置阶段 1: 检查 CLI 登录态
    ↓
阶段 2: 查询已有应用 (queryApplicationList)
    ↓
阶段 3: 用户选择
    ├─ 【复用】选择已有上线应用 → 查询安全密钥 → 导出 alipayPublicKey → 完成
    └─ 【新建】创建新应用 → 进入阶段 3
    ↓
阶段 3: 创建应用 (createApplication) — 仅新建路径
    ↓
阶段 4: 设置应用公钥 (createKeyConfirmPage) — 仅新建路径
    ↓
阶段 5: 提交应用审核 (submitApplicationAudit) — 仅新建路径
```

---

## MCP调用

| 方法 | 用途 |
|------|------|
| `queryApplicationList` | 查询同类型已有应用 |
| `createApplication` | 创建应用 |
| `queryApplicationInfo` | 查询应用信息 |
| `queryApplicationDetail` | 查询应用详情 |
| `createKeyConfirmPage` | 创建密钥确认页 |
| `queryApplicationSecurityKey` | 查询应用安全密钥 |
| `submitApplicationAudit` | 提交应用审核 |

---

## ⛔ 应用相关 MCP 调用铁律（最高优先级）

**应用相关 MCP 调用具有独特的参数结构，与签约模块完全不同，禁止混用！**

### 参数结构对照表

| 方法 | 必需参数 | 参数结构 | 是否需要 ctx |
|------|----------|----------|--------------|
| `queryApplicationList` | `appTypes` | `{"request":{"appTypes":["WEBAPP"]}}` | ❌ 不需要 |
| `createApplication` | `applicationType`, `createScene` | `{"request":{"applicationType":"WEBAPP","createScene":"cli"}}` | ❌ 不需要 |
| `queryApplicationInfo` | `appId` | `{"request":{"appId":"..."}}` | ❌ 不需要 |
| `queryApplicationDetail` | `appId` | `{"request":{"appId":"..."}}` | ❌ 不需要 |
| `createKeyConfirmPage` | `appId`, `signType`, `publicKey` | `{"request":{"appId":"...","signType":"RSA2","publicKey":"..."}}` | ❌ 不需要 |
| `queryApplicationSecurityKey` | `appId` | `{"request":{"appId":"..."}}` | ❌ 不需要 |
| `submitApplicationAudit` | `appId` | `{"request":{"appId":"..."}}` | ❌ 不需要 |

### 正确调用示例

```bash
# ✅ 查询应用列表
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.queryApplicationList \
  -d '{"request":{"appTypes":["WEBAPP"]}}' \
  --json 2>/dev/null

# ✅ 创建应用
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.createApplication \
  -d '{"request":{"applicationType":"WEBAPP","createScene":"cli"}}' \
  --json 2>/dev/null

# ✅ 查询应用信息
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.queryApplicationInfo \
  -d '{"request":{"appId":"2021001234567890"}}' \
  --json 2>/dev/null

# ✅ 创建密钥确认页
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.createKeyConfirmPage \
  -d '{"request":{"appId":"2021001234567890","signType":"RSA2","publicKey":"MIIBIjAN..."}}' \
  --json 2>/dev/null

# ✅ 查询应用安全密钥
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.queryApplicationSecurityKey \
  -d '{"request":{"appId":"2021001234567890"}}' \
  --json 2>/dev/null

# ✅ 提交应用审核
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.submitApplicationAudit \
  -d '{"request":{"appId":"2021001234567890"}}' \
  --json 2>/dev/null
```

### 禁止调用示例

```bash
# ❌ 最常见错误：使用分页参数（queryApplicationList 不支持 pageSize/pageNum，也不需要 ctx）
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.queryApplicationList \
  -d '{"request":{"pageSize":10,"pageNum":1},"ctx":{}}' \
  --json 2>/dev/null

# ❌ 错误：添加 ctx 参数（应用相关 MCP 调用不需要 ctx）
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.queryApplicationList \
  -d '{"request":{"appTypes":["WEBAPP"]},"ctx":{}}' \
  --json 2>/dev/null

# ❌ 错误：受 ar-sign 上下文影响使用错误的参数结构
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.queryApplicationList \
  -d '{"request":{"salesProductCodes":["I1080300001000041203"]},"ctx":{}}' \
  --json 2>/dev/null

# ❌ 错误：省略 request 包裹层
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.queryApplicationList \
  -d '{"appTypes":["WEBAPP"]}' \
  --json 2>/dev/null
```

### 应用模块与签约模块参数结构对比

| 模块 | 参数结构特征 | ctx 参数 | 示例 |
|------|-------------|----------|------|
| ar-sign / ar-query | `{"request":{...},"ctx":{}}` | ✅ 必须包含 | `{"request":{"salesProductCodes":["..."]},"ctx":{}}` |
| apprelease | `{"request":{...}}` | ❌ 不需要 | `{"request":{"appTypes":["WEBAPP"]}}` |

**重要：应用发布模块的 MCP 调用参数结构与签约模块完全不同，必须严格按照上表执行，禁止混用！**

---

## 前置阶段 1: CLI 登录态检查

```bash
# 检查 CLI 登录态
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli diagnose auth --json

# 若未登录，执行非交互式登录（两个命令成对出现）
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli login --non-interactive --json --scope app:all
# 用户扫码确认后
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli login --complete --json
```

---

## 阶段 2: 查询已有应用

**⚠️ 重要：在创建应用前必须先查询当前主体下是否已有可复用的应用。**

```bash
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.queryApplicationList \
  -d '{"request":{"appTypes":["WEBAPP"]}}' \
  --json 2>/dev/null
```

### 返回结果处理

```bash
RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.queryApplicationList \
  -d '{"request":{"appTypes":["WEBAPP"]}}' \
  --json 2>/dev/null)

# 检查 success 并安全提取数组
if [ "$(echo "$RESULT" | jq -r '.success // false')" = "true" ]; then
  # ⚠️ 关键：使用 // [] 避免数组为 null 时报错
  APP_COUNT=$(echo "$RESULT" | jq '.resultObj.applicationList // [] | length')
  if [ "$APP_COUNT" -eq 0 ]; then
    echo "📋 暂无应用，进入创建应用流程"
  else
    echo "$RESULT" | jq -r '.resultObj.applicationList // [] | .[] | "\(.appId) \(.appName) \(.status)"'
  fi
fi
```

### 查询结果处理

| 结果 | 处理方式 |
|------|----------|
| 查询失败 | 直接返回错误，停止后续流程 |
| 命中 ON_LINE 应用 | 返回已有上线应用列表，让用户选择"复用上线应用"或"新建应用" |
| 无同类型应用 | 直接进入"创建应用"阶段 |

### ⛔ 应用复用强制原则

<important>
只有状态为 `ON_LINE` 的应用才允许复用，也只有 `ON_LINE` 应用允许被列出给用户选择。

- 查询结果只允许列出 `ON_LINE` 状态的应用
- 用户指定某个 `appId` 要复用时，必须先查询该应用状态
- 状态不是 `ON_LINE` 时，禁止复用
- 用户坚持要求复用非 `ON_LINE` 应用时，直接拒绝该复用请求，并继续按"新建应用"路径处理
</important>

### 用户选择输出格式

```
📋 发现您已有以下上线应用：

| 序号 | 应用ID | 应用名称 | 状态 |
|------|--------|----------|------|
| 1 | 2021001234567890 | 我的网站应用 | 已上线 |
| 2 | 2021001234567891 | 我的测试应用 | 已上线 |

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  请选择操作：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  【复用】输入序号 1 或 2 → 复用对应应用
  【新建】输入 "新建" → 创建新应用

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

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

### queryApplicationSecurityKey 返回结果处理

```bash
RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.queryApplicationSecurityKey \
  -d '{"request":{"appId":"<appId>"}}' \
  --json 2>/dev/null)

if [ "$(echo "$RESULT" | jq -r '.success // false')" = "true" ]; then
  # ⚠️ 关键：使用 // [] 避免 securityKeys 为 null 时报错
  ALIPAY_PUBLIC_KEY=$(echo "$RESULT" | jq -r '.resultObj.securityKeys // [] | .[] | select(.signType == "RSA2") | .alipayPublicKey // empty' | head -1)

  if [ -n "$ALIPAY_PUBLIC_KEY" ]; then
    echo "$ALIPAY_PUBLIC_KEY" > ~/.config/${APP_ID}-alipayPublicKey.keytext
    echo "✅ 已获取支付宝公钥"
  else
    echo "⚠️ 未找到 RSA2 公钥，请先设置应用公钥"
  fi
fi
```

### 复用成功输出格式

```
✅ 应用复用成功

| 项目 | 信息 |
|------|------|
| AppId | <appId> |
| 应用状态 | ON_LINE（已上线） |
| 支付宝公钥 | ~/.config/<appId>-alipayPublicKey.keytext |
```

---

## 阶段 3: 创建应用

**⚠️ 仅在用户选择"新建应用"或无可复用应用时执行此阶段。**

```bash
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.createApplication \
  -d '{"request":{"applicationType":"WEBAPP","createScene":"cli"}}' \
  --json 2>/dev/null
```

| 结果 | 处理方式 |
|------|----------|
| 创建成功 | 获取 appId，进入阶段 4 设置应用公钥 |
| 创建失败 | 返回错误，停止后续流程 |

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
✅ 必须：使用标准引导话术（见下方）
✅ 必须：只接受用户明确输入的完整 publicKey
✅ 必须：提醒用户妥善保管私钥，切勿泄露给任何人
```

**标准引导话术：**
请前往支付宝开放平台密钥生成工具（ https://opendocs.alipay.com/common/02kipk ） 
下载并使用官方工具生成应用公私钥对，生成后将应用公钥提供给我继续后续流程。
官方工具生成的私钥格式默认为PKCS#8，部分开发语言仅支持PKCS#1，如果需要转换成PKCS#1，可使用官方工具-格式转换。
**私钥请妥善保管，切勿泄露给任何人。**

### 执行步骤

1. **引导用户生成密钥**：使用上述标准引导话术
2. **接收用户公钥**：只接受用户明确输入的完整 `publicKey`
3. **创建密钥确认页**：
   ```bash
   export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.createKeyConfirmPage \
     -d '{"request":{"appId":"<appId>","signType":"RSA2","publicKey":"<用户提供的公钥>"}}' \
     --json 2>/dev/null
   ```
4. **用户扫码确认**：输出扫码链接时，**必须同步告知用户"有效期10分钟"**
5. **查询确认结果**：用户确认后调用 `queryApplicationSecurityKey` 确认设置成功
6. **写入 alipayPublicKey 文件**：

### ⛔ createKeyConfirmPage 返回结果处理规范（最高优先级）

**`createKeyConfirmPage` 调用返回的结果中可能包含二维码链接和 `alipays://` 协议的深度链接，这些信息禁止展示给用户！**

```
❌ 禁止展示：调用返回中的 "或使用支付宝扫描以下二维码" 提示
❌ 禁止展示：调用返回中的 alipays:// 协议链接
❌ 禁止展示：调用返回中的任何二维码图片或二维码链接

✅ 必须：将 confirmPageUrl 以 markdown 链接格式输出给用户
✅ 必须：告知用户请点击链接或扫码确认公钥设置
✅ 必须：等待用户确认后再继续后续步骤
```

**正确输出格式：**

```markdown
📋 应用公钥设置中...

请点击以下链接确认公钥设置：

[点击确认公钥设置](https://aipay.alipay.com/public-key-confirm?keyConfirmToken=xxx)

确认完成后，请告诉我"好了"继续后续流程。
```

**禁止输出格式：**

```
❌ alipays://platformapi/startapp?appId=2018082061148052&page=/pages/public-key-upload/index?keyConfirmToken=xxx
```

**处理方式：**

```bash
RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.createKeyConfirmPage \
  -d '{"request":{"appId":"...","signType":"RSA2","publicKey":"..."}}' \
  --json 2>/dev/null)

SUCCESS=$(echo "$RESULT" | jq -r '.success // false')

if [ "$SUCCESS" = "true" ]; then
  # ✅ 提取 confirmPageUrl 并以 markdown 链接格式输出
  CONFIRM_PAGE_URL=$(echo "$RESULT" | jq -r '.resultObj.confirmPageUrl // empty')

  if [ -n "$CONFIRM_PAGE_URL" ]; then
    echo "📋 应用公钥设置中..."
    echo ""
    echo "请点击以下链接确认公钥设置："
    echo ""
    echo "[点击确认公钥设置]($CONFIRM_PAGE_URL)"
    echo ""
    echo "确认完成后，请告诉我\"好了\"继续后续流程。"
  else
    echo "❌ 未获取到确认页面链接，请重试"
  fi
else
  ERROR_MSG=$(echo "$RESULT" | jq -r '.error.message // "未知错误"')
  echo "❌ 公钥设置失败: $ERROR_MSG"
fi
```

### alipayPublicKey 文件写入

```bash
# 写入路径
echo "$ALIPAY_PUBLIC_KEY" > "~/.config/${APP_ID}-alipayPublicKey.keytext"

# 写入时机
# 1. 确认密钥状态时
# 2. 提交应用审核成功后
```

---

## 阶段 5: 提交应用审核

**⚠️ 只有确认应用公钥存在后，才继续提交审核。**

```bash
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call apprelease.submitApplicationAudit \
  -d '{"request":{"appId":"<appId>"}}' \
  --json 2>/dev/null
```

| 结果 | 处理方式 |
|------|----------|
| 提审成功 | 获取审核订单号，对客输出 |
| 提审失败 | 返回错误，停止后续流程 |

---

## 输出格式

### 复用应用成功

```
✅ 应用复用成功

| 项目 | 信息 |
|------|------|
| AppId | <appId> |
| 应用状态 | ON_LINE（已上线） |
| 支付宝公钥 | ~/.config/<appId>-alipayPublicKey.keytext |
```

### 新建应用成功

```
✅ 应用创建成功，已提交审核

| 项目 | 信息 |
|------|------|
| AppId | <appId> |
| 应用状态 | AUDITING（审核中） |
| 审核订单号 | <auditOrderNo> |
| 支付宝公钥 | ~/.config/<appId>-alipayPublicKey.keytext |
```