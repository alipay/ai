# 错误处理规范

> ⚠️ **全流程错误参考文档**：本文档涵盖签约全流程（Step 1~Step 6）各步骤可能出现的错误及处理方式。**当任何 Step 执行过程中遇到错误时，均可查阅本文档进行问题排查**。
> 本文档位于 `references/onboarding/modules/`，文中的 `scripts/...` 路径相对本目录；从技能包根目录执行时对应 `references/onboarding/modules/scripts/...`。
>
> 📎 **可执行版本**：shell 公共函数位于 `../../../normal/scripts/common.sh`，错误检测和处理函数位于 `scripts/error_handler.sh`。各签约 `.sh` 脚本通过 `source scripts/error_handler.sh` 间接完成 `DEV_TOOL_NAME` 初始化，并在每次 MCP 调用后执行错误处理。**本文档为说明参考，实际执行以脚本为准。**

---

## 错误检测函数索引

> ⚠️ `require_command` / `init_dev_tool_name` 定义于 `normal/scripts/common.sh`；`error_handler.sh` 会在加载公共函数后显式调用 `init_dev_tool_name`。以下错误处理函数定义于 `error_handler.sh`，本文档仅说明其用途和触发条件。

| 函数 | 说明 | 返回 |
|------|------|------|
| `unwrap_mcp` | MCP 信封解包，提取 `content[0].text` 中的业务 JSON；非信封结构原样透传 | 解包后的 JSON 字符串 |
| `detect_error` | 统一错误检测入口，自动解包 MCP 信封后按优先级匹配所有错误类型 | `MCP_AUTH_ERROR` / `MCP_SERVICE_ERROR` / `AUTH_MISMATCH` / `SERVICE_UNSTABLE` / `ERROR:xxx` / `CLI_ERROR:xxx` / `SUCCESS` |
| `handle_error` | 统一错误处理入口，调用 `detect_error` 后路由到对应 handler（内含 `unwrap_mcp` 自动解包信封） | `0`=成功, `1`=需用户干预 |
| `handle_mcp_auth_error` | 处理 MCP 认证错误（HTTP 401），执行 logout + 引导重新授权 | - |
| `handle_mcp_service_error` | 处理 MCP 服务不可用（网络/连接错误）；沙箱化 Agent 环境提示申请可联网权限重试同一命令，其他环境提示检查网络 | - |
| `handle_auth_mismatch` | 处理授权不匹配（MCC/产品/scope），执行 logout + 引导重新授权 | - |
| `handle_service_unstable` | 处理 MCP 服务不稳定，提示稍后重试 | - |
| `handle_backend_error` | 处理后端业务错误（errorCode），展示错误信息、bizTips、checkedError | - |

---

## 一、MCP 认证错误

### 识别关键词
`HTTP 401`、`Authorization is empty`、`非法的认证信息`、`MCP 调用失败`

### 错误码表格
| 错误码 | 错误信息 | 说明 |
|--------|----------|------|
| `api_error` | `HTTP 401` + `Authorization is empty` | 未登录或授权已过期 |
| `api_error` | `非法的认证信息` | 认证信息无效 |
| `-32602` | `Authorization is empty` | MCP 请求缺少认证头 |

### 处理原则
```
✅ 检测到 HTTP 401 → 退出当前登录 → 引导用户重新授权
✅ 清理对话上下文中的授权相关数据
✅ 提供清晰的错误说明和下一步操作指引
❌ 禁止自动重试 MCP 调用（会导致相同的认证错误）
❌ 禁止静默忽略错误
❌ 禁止跳过登录流程直接继续
```

### 错误示例
```json
{
  "success": false,
  "error": {
    "code": "api_error",
    "message": "MCP 调用失败: MCP 请求失败: HTTP 401 - {\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32602,\"message\":\"非法的认证信息, Authorization is empty\"}}",
    "action": "重新执行登录授权"
  }
}
```

> 📎 处理脚本：见 `error_handler.sh` → `handle_mcp_auth_error()`

---

## 二、MCP 服务不可用（网络/服务错误）

### 识别关键词
`MCP 调用失败`、`connection refused`、`timeout`、`network error`

### 错误码表格
| 错误码 | 错误信息 | 说明 |
|--------|----------|------|
| `api_error` | `MCP 调用失败` 非 401 | 网络或服务异常 |
| `api_error` | `connection refused` | 无法连接服务器 |
| `api_error` | `timeout` | 请求超时 |

### 处理原则
```
✅ 检测到网络错误 → 沙箱化 Agent 环境提示申请可联网权限重试同一命令，其他环境提示用户检查网络
✅ 提供网络排查指引
❌ 禁止自动重试多次（会加剧服务器压力）
❌ 禁止静默忽略错误
```

> 📎 处理脚本：见 `error_handler.sh` → `handle_mcp_service_error()`、`handle_service_unstable()`

---

## 三、授权信息不匹配

### 识别关键词
`mccCode is not auth`、`salesProductCodes is not auth`、`scope is not auth`

### 错误类型
| 错误码 | 错误信息 | 说明 | 处理方式 |
|--------|----------|------|----------|
| `AE05010000001200` | `mccCode is not auth` | 经营类目未授权 | logout → 重新授权 |
| `AE05010000001200` | `salesProductCodes is not auth` | 产品未授权 | logout → 重新授权 |
| - | `scope is not auth` | 授权 scope 不满足 | logout → 重新授权 |

### 处理原则
```
✅ 检测到授权不匹配 → 执行 logout 退出登录 → 调用 auth.sh mismatch 重新授权
✅ 重新授权时使用正确的 scope（根据当前 salesCode 确定）
❌ 禁止：检测到授权范围不满足后继续执行后续操作
❌ 禁止：不执行 logout 直接重新登录
```

> 📎 处理脚本：见 `error_handler.sh` → `handle_auth_mismatch()`，以及 `scripts/auth.sh mismatch`

---

## 四、登录授权错误

### 识别关键词
`authorization_pending`、`auth_expired`

### 错误码表格
| 错误码 | 说明 | 处理方式 |
|--------|------|----------|
| `authorization_pending` | 用户尚未扫码或未确认授权 | 继续等待或提示用户 |
| `auth_expired` | 授权已过期（10分钟） | 重新执行登录流程 |

### 处理原则
```
✅ 检测到 authorization_pending → 提示用户继续扫码
✅ 检测到 auth_expired → 重新执行登录流程
❌ 禁止：自动轮询检查授权状态
❌ 禁止：循环调用 login --complete
```

> 📎 处理脚本：授权确认逻辑见 `scripts/auth.sh confirm`

---

## 五、后端业务错误

### 响应格式
```json
{
  "errorCode": "xxx",
  "errorMessage": "错误描述",
  "bizTips": "业务提示（可展示给用户）",
  "needRetry": true,
  "resultObj": {
    "checkedError": [
      { "errorDesc": "字段级校验错误描述" }
    ]
  }
}
```

> ⚠️ 有些 MCP 返回会把真实业务响应包在 `data.response` 或 `errorContext.errorStack[]` 下。错误检测必须优先定位业务错误对象：既要兼容 `errorCode: "xxx"`，也要兼容 `errorCode: { "code": "xxx", "desc": "...", "message": "...", "errorScene": "...", "errorSpecific": "..." }`。错误信息应从同一错误对象提取 `errorMessage` / `errorMsg` / `errorCode.desc` / `errorCode.message` / `bizTips` / `errorScene` / `errorSpecific`，不得只读取顶层字段后兜底为“未知错误”。

### 处理原则
```
✅ errorCode 存在 → 展示 errorMessage
✅ 如有 bizTips → 一并展示给用户
✅ 如有 checkedError → 逐条展示字段级校验错误描述
✅ 如有 errorScene / errorSpecific → 一并展示，便于技术支持定位
✅ createApplication 返回 APP_MAX_ERROR → 告知用户应用数量达到上限，引导复用已有上线应用或前往支付宝开放平台处理配额
✅ needRetry=true → 告知用户可以重试
❌ 禁止：忽略 errorCode 继续执行
❌ 禁止：向用户暴露技术性内部错误
❌ 禁止：只输出"未知错误"而丢弃 errorCode / bizTips / checkedError
```

> 📎 处理脚本：见 `error_handler.sh` → `handle_backend_error()`

---

## 六、快速集成用法

> ⚠️ 各 `.sh` 脚本已内置错误检测（source `error_handler.sh` + 调用 `handle_error`）和 MCP 信封解包（`unwrap_mcp`），Agent 执行脚本时无需额外处理。

在**直接执行 MCP 调用**（非通过脚本）的场景，需注意 `alipay-cli mcp call` 返回 MCP 协议信封，业务 JSON 被包在 `content[0].text` 里，必须先解包：

```bash
# ① 执行 MCP 调用
RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call <METHOD> -d '<JSON>' --json 2>/dev/null)

# ② 调用 handle_error 自动处理（内含信封解包）
if ! handle_error "$RESULT"; then
  # handle_error 已输出用户提示，返回 1 表示需要用户干预
  return 1
fi

# ③ 如果返回 0，解包信封后处理业务字段
BUSINESS=$(unwrap_mcp "$RESULT")
SUCCESS=$(echo "$BUSINESS" | jq -r '.success // false')
```

---

## 七、错误类型速查表

```
┌─────────────────────────────────────────────────────────────────┐
│                        错误识别速查表                            │
├─────────────────────────────────────────────────────────────────┤
│ 📦 MCP 信封解包（unwrap_mcp）                                    │
│   所有 mcp call 返回 {content:[{text:"<业务JSON>"}]}            │
│   必须先 unwrap_mcp 解包，再解析 .success / .resultObj 等字段   │
├─────────────────────────────────────────────────────────────────┤
│ 🔐 MCP_AUTH_ERROR                                               │
│   关键词：HTTP 401 / Authorization is empty / 非法的认证信息     │
│   动作：引导用户重新登录授权                                     │
├─────────────────────────────────────────────────────────────────┤
│ 🌐 MCP_SERVICE_ERROR                                            │
│   关键词：MCP 调用失败 / connection refused / timeout            │
│   动作：沙箱化 Agent 环境申请可联网权限重试；其他环境提示检查网络连接 │
├─────────────────────────────────────────────────────────────────┤
│ 🔄 AUTH_MISMATCH                                                │
│   关键词：mccCode is not auth / salesProductCodes is not auth    │
│   动作：退出登录 → 重新授权                                      │
├─────────────────────────────────────────────────────────────────┤
│ 📋 BUSINESS_ERROR                                               │
│   关键词：errorCode 字段存在（含 data.response 或 errorStack）    │
│   动作：展示错误信息 + bizTips + checkedError + errorScene       │
├─────────────────────────────────────────────────────────────────┤
│ ⚠️ CLI_ERROR                                                    │
│   关键词：success=false 但无 errorCode                           │
│   动作：展示错误信息 + bizTips（如有）+ checkedError（如有）     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 八、调用位置索引

| Step | MCP 调用位置 | 建议使用的检测函数 |
|------|---------------|-------------------|
| Step 1 环境检查 | CLI whoami / login | 由 `auth.sh` 内置处理 |
| Step 3 登录授权 | login --complete / logout | 由 `auth.sh` 内置处理 |
| Step 3.1 签约状态查询 | ar-query.queryArInfosBySalesProd | 由 `query_sign_status.sh` 内置（source error_handler.sh；建议设置 PRODUCT_TYPE 做产品码一致性校验） |
| Step 4 资料采集 | file upload | 由 `upload_screenshots.sh` 内置（source error_handler.sh + unwrap_mcp 解包信封） |
| Step 5.1 产品签约 | ar-sign.apply | 由 `ar_sign_apply.sh` 内置（source error_handler.sh） |
| Step 5.2 服务注册 | a2a-pay-service.* | 由 `service.sh` 内置（source error_handler.sh） |
| Step 5.3 应用发布 | apprelease.* | 由 `app.sh` 内置（source error_handler.sh） |

---

## 九、注意事项

```
✅ 必须：任何 MCP 调用后都必须进行错误检测
✅ 必须：给用户友好的错误提示
✅ 必须：提供下一步操作指引
❌ 禁止：忽略错误继续执行
❌ 禁止：给用户显示技术性错误信息（如 traceId、内部错误码等）
```
