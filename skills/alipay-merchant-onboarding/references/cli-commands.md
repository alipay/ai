# CLI 命令规范

> 本文档定义 alipay-cli 所有命令的调用规范，是主技能的命令参考。
> 被引用文档：`SKILL.md`

---

## ⛔ CLI 命令调用铁律

**所有 alipay-cli 命令必须严格按照本文档定义的格式执行，包括环境变量设置、命令名称、参数、选项，一字不改。**

```
✅ 必须：在每个 alipay-cli 调用前设置 PLATFORM 环境变量
✅ 必须：使用 export PLATFORM=${DEV_TOOL_NAME} && 格式
✅ 必须：--json 和 2>/dev/null 同时使用（获取纯 JSON 输出）
✅ 必须：按文档规定的命令名调用（如 version 不是 --version）

❌ 禁止：省略环境变量直接调用 alipay-cli
❌ 禁止：自行创造 CLI 命令或参数
❌ 禁止：使用 alipay-cli --version（不存在此命令）
❌ 禁止：省略 --json 参数（输出将包含调试信息）
❌ 禁止：使用 2>&1 替代 2>/dev/null（会把 stderr 混入 stdout）
❌ 禁止：猜测或推断命令格式
❌ 禁止：硬编码 PLATFORM 值（如 PLATFORM=claudeCode）
❌ 禁止：使用分号 ; 连接（可能导致环境变量泄露）
```

**命令格式模板：**

```bash
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli <command> [options]
```

**变量来源：DEV_TOOL_NAME 来自 Step 1.3 智能识别，缺失时填 "unknown"。**

---

## 命令总览

> **⚠️ 重要：所有命令调用前必须添加 `export PLATFORM=${DEV_TOOL_NAME} &&` 前缀**
>
> 完整格式：`export PLATFORM=${DEV_TOOL_NAME} && alipay-cli <command> [options]`

| 类别 | 命令 | 用途 | 使用场景 |
|------|------|------|----------|
| 版本检查 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli version` | 检测 CLI 是否安装 | Step 0 环境检查 |
| 登录状态 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli whoami --json 2>&1` | 检查当前登录状态和 scope | Step 3 登录前、scope 校验 |
| 登录授权 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli login --non-interactive --scope "$SCOPE" --json 2>&1` | 获取 device_code | Step 3 登录 |
| 确认授权 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli login --complete --json 2>&1` | 确认用户完成授权 | Step 3 授权确认 |
| 退出登录 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli logout --json 2>/dev/null` | 退出当前登录 | 重新授权前 |
| 文件上传 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli file upload <FILE_PATH> -s payMerchantcodeSkill --json 2>/dev/null` | 上传截图获取 fileKey | Step 4 资料采集 |
| MCP 调用 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call <server>.<tool> -d '<json>' --json 2>/dev/null` | 调用 MCP 服务 | MCP 服务调用 |
| 签约提交 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call ar-sign.apply -d '<json>' --json 2>/dev/null` | 直接提交签约申请 | Step 5 签约 |

---

## 1. 版本检查

### ⚠️ 正确命令是 `alipay-cli version`（不是 `--version`）

```bash
# ✅ 正确：检查 CLI 是否安装（带环境变量）
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli version &>/dev/null

# ❌ 错误：缺少环境变量
alipay-cli version

# ❌ 错误：alipay-cli --version 不存在
alipay-cli --version

# ❌ 错误：使用 command -v 只检查命令存在，不验证功能正常
command -v alipay-cli &>/dev/null

# ❌ 错误：使用 which 检查
which alipay-cli &>/dev/null
```

### 安装检测逻辑

```bash
# Step 0: 检测 CLI 是否可用
if ! export PLATFORM=${DEV_TOOL_NAME} && alipay-cli version &>/dev/null; then
  echo "⚠️ alipay-cli 未安装，正在自动安装..."
  curl -fsSL https://opengw.alipay.com/alipaycli/install | bash

  # 验证安装结果
  if ! export PLATFORM=${DEV_TOOL_NAME} && alipay-cli version &>/dev/null; then
    echo "❌ alipay-cli 安装失败，请手动安装后重试"
    exit 1
  fi

  echo "✅ alipay-cli 安装成功"
fi
```

### 检测时机

必须在以下操作前执行 CLI 检测：
- 执行 `whoami` 检查登录状态前
- 执行 `login` 登录授权前
- 执行任何 MCP 调用前
- 执行文件上传前

---

## 2. 登录状态检查

```bash
# ✅ 正确：检查当前登录状态（带环境变量）
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli whoami --json 2>&1

# ❌ 错误：缺少环境变量
alipay-cli whoami --json 2>&1
```

**返回格式：**

```json
// 已登录（有效）
{ "success": true, "data": { "logged_in": true, "is_expired": false, "expires_at": "2026-04-20T15:37:42+08:00", "scope": "app:all,machine_pay:write" } }

// 已登录但已过期（等同于未登录，需重新授权）
{ "success": true, "data": { "logged_in": true, "is_expired": true, "expires_at": "2026-05-20T23:00:59+08:00", "scope": "app:all,machine_pay:write" } }

// 未登录
{ "success": true, "data": { "logged_in": false, "is_expired": true, "expires_at": "0001-01-01T00:00:00Z" } }
```

**解析登录状态：**

```bash
# ✅ 正确：同时检查 logged_in 和 is_expired（带环境变量）
LOGGED_IN=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli whoami --json 2>&1 | jq -r '.data.logged_in // false')
IS_EXPIRED=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli whoami --json 2>&1 | jq -r '.data.is_expired // false')

# ⚠️ 关键：is_expired: true 时等同于未登录
if [ "$LOGGED_IN" = "true" ] && [ "$IS_EXPIRED" = "false" ]; then
  echo "✅ 已登录且有效"
else
  echo "📋 未登录或已过期，需要重新授权"
fi

# ✅ 正确：获取 scope 用于权限校验
CURRENT_SCOPE=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli whoami --json 2>&1 | jq -r '.data.scope // empty')
```

**⚠️ 注意：`whoami` 不使用 `2>/dev/null`，因为需要捕获完整输出。**
**⚠️ 关键：`logged_in: true` 但 `is_expired: true` 时，等同于未登录，需要生成授权链接让用户重新登录。**

---

## 3. 登录授权

### 执行登录

```bash
# ✅ 正确：必须携带 --scope 参数并设置环境变量
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli login --non-interactive --scope "$SCOPE" --json 2>&1

# ❌ 错误：缺少环境变量
alipay-cli login --non-interactive --scope "$SCOPE" --json 2>&1

# ❌ 错误：不带 scope 的 login
alipay-cli login --non-interactive --json

# ❌ 错误：自行修改 scope 值
alipay-cli login --non-interactive --scope "my_custom_scope" --json
```

**Scope 对照表（固定值，禁止修改）：**

| 产品 | salesCode | Scope |
|------|-----------|-------|
| 电脑网站支付 | I1080300001000041203 | `app:all,fast_instant_trade_pay:write` |
| AI收 | I1080300001000160457 | `app:all,machine_pay:write,agmnt:write` |

**返回格式：**

```json
{
  "success": true,
  "data": {
    "data": {
      "device_code": "xxx",
      "verification_url": "https://opengw.alipay.com/oauth/device",  // ← 禁止使用！
      "verification_code": "ABCD1234"
    }
  }
}
```

**解析字段：**

```bash
# ✅ 必须提取：device_code（用于构造授权链接）
DEVICE_CODE=$(echo "$LOGIN_RESULT" | jq -r '.data.data.device_code // empty')

# ✅ 必须提取：verification_code（展示给用户的安全确认码）
VERIFICATION_CODE=$(echo "$LOGIN_RESULT" | jq -r '.data.data.verification_code // empty')

# ❌ 禁止使用：verification_url（此链接无法完成授权）
# ❌ 禁止透出给用户！
```

### 确认授权

```bash
# ✅ 正确：用户确认后调用一次（带环境变量）
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli login --complete --json 2>&1

# ❌ 错误：缺少环境变量
alipay-cli login --complete --json 2>&1
```

**⚠️ 不再使用轮询机制，等待用户确认后一次性调用。**

```bash
# ✅ 正确：用户确认后调用一次
RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli login --complete --json 2>&1)
DATA_SUCCESS=$(echo "$RESULT" | jq -r '.data.success // false')

# ❌ 错误：自动轮询检查
# ❌ 错误：循环调用 login --complete
# ❌ 错误：在用户未确认前调用
```

### 退出登录

```bash
# ✅ 正确：退出当前登录（带环境变量）
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli logout --json 2>/dev/null

# ❌ 错误：缺少环境变量
alipay-cli logout --json 2>/dev/null
```

---

## 4. 文件上传

### 上传命令

```bash
# ✅ 正确格式（带环境变量）
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli file upload <FILE_PATH> -s payMerchantcodeSkill --json 2>/dev/null

# ❌ 错误：缺少环境变量
alipay-cli file upload <FILE_PATH> -s payMerchantcodeSkill --json 2>/dev/null

# ❌ 错误：使用 MCP 调用格式
alipay-cli mcp call file.upload -d '...'

# ❌ 错误：添加额外参数
alipay-cli file upload <FILE_PATH> -s payMerchantcodeSkill --extra-param value --json 2>/dev/null

# ❌ 错误：省略 -s 参数
alipay-cli file upload <FILE_PATH> --json 2>/dev/null
```

**参数说明：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `<FILE_PATH>` | string | 是 | 文件的绝对路径（用户提供，可拖入终端） |
| `-s` | string | 是 | 上传场景，固定值 `payMerchantcodeSkill` |
| `--json` | flag | 是 | 输出 JSON 格式 |
| `2>/dev/null` | redirect | 是 | 丢弃 stderr 调试信息 |

**返回格式：**

```json
// 成功
{
  "success": true,
  "data": {
    "fileKey": "2eec4bbb-2727-4f24-95fe-154e7e941e9a.jpg"
  }
}

// 失败
{
  "success": false,
  "error": {
    "code": "UPLOAD_FAILED",
    "message": "上传失败原因"
  }
}
```

### 解析 fileKey

```bash
# 上传文件并捕获结果（带环境变量）
UPLOAD_RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli file upload "$FILE_PATH" -s payMerchantcodeSkill --json 2>/dev/null)

# 检查是否成功
if [ "$(echo "$UPLOAD_RESULT" | jq -r '.success // false')" != "true" ]; then
  echo "❌ 文件上传失败"
  echo "$UPLOAD_RESULT" | jq -r '.error.message // "未知错误"'
  exit 1
fi

# 解析 fileKey（兼容多种返回结构）
FILE_KEY=$(echo "$UPLOAD_RESULT" | jq -r '.data.fileKey // .data.data.fileKey // .fileKey // .result.fileKey // empty')

if [ -z "$FILE_KEY" ]; then
  echo "❌ 无法从返回结果中提取 fileKey"
  echo "📋 返回结果: $UPLOAD_RESULT"
  exit 1
fi

echo "✅ 文件上传成功，fileKey: $FILE_KEY"
```

### 并行上传示例（资料采集）

```bash
# 并行上传 3 张截图（每个命令都需要环境变量）
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli file upload "$HOME_IMAGE" -s payMerchantcodeSkill --json 2>/dev/null > /tmp/upload_home.json &
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli file upload "$SHOP_IMAGE" -s payMerchantcodeSkill --json 2>/dev/null > /tmp/upload_shop.json &
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli file upload "$PAY_IMAGE" -s payMerchantcodeSkill --json 2>/dev/null > /tmp/upload_pay.json &
wait

# 解析 fileKey
parse_file_key() {
  local RESULT=$(cat "$1")
  echo "$RESULT" | jq -r '.data.fileKey // .data.data.fileKey // .fileKey // .result.fileKey // empty'
}

HOME_KEY=$(parse_file_key /tmp/upload_home.json)
SHOP_KEY=$(parse_file_key /tmp/upload_shop.json)
PAY_KEY=$(parse_file_key /tmp/upload_pay.json)

# 校验所有 fileKey
if [ -z "$HOME_KEY" ] || [ -z "$SHOP_KEY" ] || [ -z "$PAY_KEY" ]; then
  echo "❌ 部分文件上传失败"
  [ -z "$HOME_KEY" ] && echo "  - 首页截图上传失败"
  [ -z "$SHOP_KEY" ] && echo "  - 商品页截图上传失败"
  [ -z "$PAY_KEY" ] && echo "  - 支付页截图上传失败"
  exit 1
fi

echo "✅ 所有文件上传成功"
echo "  - 首页截图: $HOME_KEY"
echo "  - 商品页截图: $SHOP_KEY"
echo "  - 支付页截图: $PAY_KEY"
```

---

## 5. MCP 调用

### 调用格式

```bash
# ✅ 正确格式：环境变量 + --json + 2>/dev/null 同时使用
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call <server>.<tool> -d '<json>' --json 2>/dev/null

# ✅ 正确格式：保存结果到文件
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call <server>.<tool> -d '<json>' --json 2>/dev/null > /tmp/response.json

# ❌ 错误：缺少环境变量
alipay-cli mcp call <server>.<tool> -d '<json>' --json 2>/dev/null

# ❌ 错误：缺少 --json 参数
alipay-cli mcp call <server>.<tool> -d '<json>'

# ❌ 错误：不使用 2>/dev/null
alipay-cli mcp call <server>.<tool> -d '<json>' --json

# ❌ 错误：使用 2>&1 混入 stderr
alipay-cli mcp call <server>.<tool> -d '<json>' --json 2>&1
```

### ⚠️ 禁止行为

```
❌ alipay-cli mcp list（探测工具）
❌ 调用技能文档未列出的 MCP 方法
❌ 自行推断方法参数名或结构
❌ 省略文档中定义的任何参数（包括 "ctx":{}）
❌ 修改参数的 JSON 嵌套结构（如去掉 request/ctx 包裹）
❌ 自行添加文档中定义的额外参数
```

> **详细 MCP 方法列表见：** `references/mcp-methods.md`

---

## 6. 签约提交（ar-sign.apply MCP）

### ⚠️ 直接调用 MCP，需要手动注入 bizRequestNo

```bash
# 生成 UUID
BIZ_REQUEST_NO=$(python3 -c "import uuid; print(uuid.uuid4())")

# ✅ 正确：直接调用 MCP 提交签约（带环境变量）
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call ar-sign.apply -d '<json>' --json 2>/dev/null

# ❌ 错误：缺少环境变量
alipay-cli mcp call ar-sign.apply -d '<json>' --json 2>/dev/null
```

**签约提交行为：**
- 需手动生成 `bizRequestNo`（UUID）并注入到 request 中
- JSON 结构需包含 request/ctx 包裹层级
- salesProductCodes 非空，mccCode 格式为 Axxxx_Bxxxx

> **详细签约规范见：** `SKILL.md`「⛔ 签约规范」章节

---

## 命令速查表

### 主技能可直接调用的命令

| 命令 | 格式 | 使用场景 |
|------|------|----------|
| 版本检查 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli version` | Step 0 环境检查 |
| 登录状态 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli whoami --json 2>&1` | 检查登录状态和 scope |
| 执行登录 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli login --non-interactive --scope "$SCOPE" --json 2>&1` | Step 3 登录授权 |
| 确认授权 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli login --complete --json 2>&1` | Step 3 授权确认 |
| 退出登录 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli logout --json 2>/dev/null` | 重新授权前 |
| 文件上传 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli file upload <FILE_PATH> -s payMerchantcodeSkill --json 2>/dev/null` | Step 4 资料采集 |
| 签约提交 | `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call ar-sign.apply -d '<json>' --json 2>/dev/null` | Step 5 签约 |

### 禁止使用的命令

| 禁止命令 | 原因 | 正确替代 |
|----------|------|----------|
| `alipay-cli --version` | 不存在此命令 | `alipay-cli version` |
| `alipay-cli mcp list` | 探测工具，禁止使用 | 查阅技能文档 |
| `alipay-cli mcp call ar-sign.apply` | 主技能直接调用（需手动注入 bizRequestNo） | 直接使用 |
| `alipay-cli mcp call file.upload` | 不存在此格式 | `alipay-cli file upload` |
| `command -v alipay-cli` | 只检查存在，不验证功能 | `alipay-cli version` |
| `which alipay-cli` | 只检查存在，不验证功能 | `alipay-cli version` |

---

## 相关文档

| 文档 | 内容 |
|------|------|
| `authorization.md` | 登录授权完整流程、scope 校验、重新授权 |
| `mcp-methods.md` | MCP 方法声明、参数规范、方法路由 |
| `error-handling.md` | CLI 命令错误处理 |