# 登录授权流程规范

> 本文档定义支付宝登录授权的完整流程。
> 被引用：`flow.md` Step 3 登录授权
> 本文档位于 `references/onboarding/modules/`，文中的 `scripts/...` 路径相对本目录；从技能包根目录执行时对应 `references/onboarding/modules/scripts/...`。

---

## 一、Scope 定义

| 产品 | salesCode | Scope（固定值，禁止修改） |
|------|-----------|--------------------------|
| 按量付费 | I1080300001000160457 | `app:all,machine_pay:write,agmnt:write` |
| 网站支付 | I1080300001000041203 | `app:all,fast_instant_trade_pay:write` |
| APP支付 | I1080300001000041313 | `app:all,auth_alipay_apppay:write` |

> ⚠️ **禁止自行修改 scope 值**

---

## 二、登录状态检查

### 2.1 检查命令

> 📎 已收口到脚本 `scripts/auth.sh init`。Agent 执行流程时调用 `bash scripts/auth.sh init`（见 flow.md Step 3），脚本返回 `AUTH_FLOW:SKIP`（已登录）或 `AUTH_FLOW:READY`（需新授权）。

whoami 原始返回格式：

### 2.2 返回格式

```json
// 已登录且未过期
{ "success": true, "data": { "logged_in": true, "is_expired": false, "expires_at": "2026-04-20T15:37:42+08:00" } }

// 未登录或已过期
{ "success": true, "data": { "logged_in": false, "is_expired": true } }
```

### 2.3 判断方式

**检查 `.data.logged_in` 字段（不是外层的 `.success`）**

| 返回值 | 状态 | 处理 |
|--------|------|------|
| `logged_in: true` + `is_expired: false` | 正常登录 | 继续后续步骤 |
| `logged_in: false` 或 `is_expired: true` | 未登录/已过期 | 进入登录授权流程 |

---

## 三、授权前用户确认（强制）

**在执行 `login` 命令前，必须先让用户确认产品类型和经营类目！**

### 3.1 输出格式（Markdown）

```markdown
---

### 📋 请确认您的授权信息

---

- **产品类型**: {PRODUCT_NAME}
- **类目编码**: {MCC_CODE}

---

确认信息无误后，将为您生成授权链接。
是否确认？(是/否)
```

### 3.2 禁止行为

```
❌ 禁止：未经用户确认直接执行登录命令
❌ 禁止：跳过产品类型和经营类目的展示
❌ 禁止：条件性隐藏产品或类目信息
```

---

## 四、执行登录

### 4.1 登录命令

> 📎 已收口到脚本：`scripts/auth.sh init`（Step 2-4: login + 解析 + 校验）

`auth.sh init` 自动执行 login、解析 device_code/verification_code/expires_in、三参数校验，无需手动执行。

### 4.2 解析返回结果

由 `auth.sh init` 自动处理。

### 4.3 参数校验

由 `auth.sh init` 自动校验 device_code、sales_code、mcc_code。

---

## 五、生成授权链接

### 5.1 链接格式

```
✅ 正确链接：https://aipay.alipay.com/cli-auth?deviceCode=xxx&productCode=xxx&mccCode=xxx&platform=xxx

❌ 禁止使用：https://opengw.alipay.com/oauth/device （此链接无法授权）
```

### 5.2 构建命令

> 📎 已收口到脚本：`scripts/auth.sh init`（Step 5: 构建授权链接）

`auth.sh init` 自动构建正确的授权链接（`https://aipay.alipay.com/cli-auth?...`），禁止使用 CLI 返回的 `verification_url`。

### 5.3 ⚠️ 禁止透出 verification_url

CLI 返回的 JSON 中包含 `verification_url` 字段，**此链接无法用于授权，禁止透出给用户！**

---

## 六、授权信息展示

### 6.1 必须展示的 4 项信息

```
1. 产品类型（productName）— 如：网站支付、按量付费
2. 经营类目（mccName + mccCode）— 如：零售批发 > 互联网综合电商平台 (A0002_B0114)
3. 确认码（verificationCode）— login 返回的 verification_code
4. 授权链接有效期（从 expires_in 计算）
```

### 6.2 输出格式（Markdown）

```markdown
🔐 支付宝授权登录

📋 授权信息

| 项目 | 信息 |
|------|------|
| 产品类型 | {PRODUCT_NAME} |
| 经营类目 | {MCC_NAME} ({MCC_CODE}) |
| 确认码 | {VERIFICATION_CODE} |
| 授权链接有效期 | {EXPIRES_DISPLAY} |

⚠️ 安全提示：请核对授权页面显示的确认码是否与上方一致，如不一致，请勿授权，立即停止操作！

🌐 授权链接：[点击跳转进行授权]({BROWSER_URL})（无法跳链时，请复制链接到网页浏览器打开）

请在完成授权后告诉我"好了"继续后续流程。
```

---

## 七、授权确认

### 7.1 命令

> 📎 已收口到脚本 `scripts/auth.sh confirm`。Agent 在用户回复"好了"后调用 `bash scripts/auth.sh confirm --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME"`（见 flow.md Step 3）。

脚本内部执行 `login --complete` + scope 校验 + MCC 校验。原始返回格式：

> `confirm` / `mismatch` 优先使用显式传入的 `salesCode`、`mccCode`、`scope`、`productName`、`mccName` 等非敏感授权上下文。`auth.sh init` 仍会短期保存本地状态文件，仅用于独立执行子命令时兜底恢复参数。授权成功、过期或失败后脚本会清理该状态文件。

### 7.2 返回格式与判断

| 脚本输出 | 含义 | 处理 |
|----------|------|------|
| `AUTH_FLOW:AUTH_SUCCESS` | 授权成功，scope + MCC 校验通过 | 继续 Step 3.1 |
| `AUTH_FLOW:PENDING` | 用户尚未完成授权 | 继续等待 |
| `AUTH_FLOW:EXPIRED` | 授权链接已过期 | 重新执行 auth.sh init |
| `AUTH_FLOW:SCOPE_MISMATCH` | scope 权限不满足 | 已自动 logout，需重新授权 |
| `AUTH_FLOW:MCC_MISMATCH` | 经营类目未授权 | 已自动 logout，需重新授权 |
| `AUTH_FLOW:FAILED` | 授权确认返回未知错误 | 检查返回信息，联系技术支持 |

### 7.3 ⚠️ 禁止轮询

```
❌ 禁止：自动轮询检查授权状态
❌ 禁止：循环调用 login --complete
```

### 7.4 登录成功后的 scope 权限校验和 MCC 一致性校验

> 📎 已收口到脚本：`scripts/auth.sh confirm`（Step 3-6: scope + MCC 校验）

`auth.sh confirm` 在 `login --complete` 成功后自动执行 scope 校验和 MCC 校验，失败时自动 logout。Agent 只需根据脚本返回值判断结果：

| 脚本输出 | 后续操作 |
|----------|----------|
| `AUTH_FLOW:AUTH_SUCCESS` | 进入 Step 3.1 签约状态查询 |
| `AUTH_FLOW:SCOPE_MISMATCH` / `AUTH_FLOW:MCC_MISMATCH` | 调用 `auth.sh mismatch` 重新授权 |

#### 7.4.1 校验实现

由 `auth.sh confirm` 自动完成，无需手动执行。

**为什么需要这两个校验**：
- `login --complete` 只确认用户完成了扫码，不代表授权范围满足业务需求
- **Scope 权限校验**：确保授权包含产品所需的操作权限（如 `machine_pay:write`、`fast_instant_trade_pay:write` 或 `auth_alipay_apppay:write`）
- **MCC 一致性校验**：确保当前登录的经营类目与用户选择的 MCC 一致
- 如果不匹配，应该立即退出并重新授权，而不是等到后续 MCP 调用时才发现问题

---

## 八、权限检查与重新授权

### 8.1 授权范围不满足处理

**当检测到授权范围不满足时，必须执行 logout 然后重新授权。**

触发条件：
1. `auth.sh confirm` 返回 `AUTH_FLOW:SCOPE_MISMATCH` / `AUTH_FLOW:MCC_MISMATCH`
2. MCP 调用返回 `mccCode is not auth` 错误
3. MCP 调用返回 `scope is not auth` 错误

处理流程：

> 📎 已收口到脚本 `scripts/auth.sh mismatch`。Agent 调用 `bash scripts/auth.sh mismatch --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME"`（见 flow.md Step 3），脚本自动执行 logout + 调用 auth init 重新授权。

### 8.2 禁止行为

```
❌ 禁止：检测到授权范围不满足后继续执行后续操作
❌ 禁止：不执行 logout 直接重新登录
❌ 禁止：忽略权限错误继续调用 MCP
```

---

## 九、重新授权三参数铁律

**三个强参数（deviceCode、productCode、mccCode）必须齐全，platform 为可选参数。**

| 场景 | deviceCode 来源 | productCode 来源 | mccCode 来源 |
|------|-----------------|------------------|--------------|
| 首次授权 | login 返回 | Step 2 确认的 salesCode | Step 2 推荐的类目编码 |
| 重新授权 | 新 login 返回 | 显式参数或状态文件 salesCode | 显式参数或状态文件 mccCode |

> ⚠️ **显式参数和状态文件只包含授权链路恢复所需的非敏感上下文，不包含密钥、私钥或业务凭据。**

参数校验：

```bash
if [ -z "$DEVICE_CODE" ] || [ -z "$SALES_CODE" ] || [ -z "$MCC_CODE" ]; then
  echo "❌ 授权链接参数不完整，无法生成授权链接"
  exit 1
fi
```

---

## 十、CLI 命令规范

### 10.1 禁止行为

```
❌ 禁止：不带 --scope 参数执行 login
❌ 禁止：自行修改 scope 格式或值
❌ 禁止：自行创造 CLI 参数
❌ 禁止：修改授权链接格式
```

### 10.2 检测工具设置

> 📎 所有签约 `.sh` 脚本都会通过 `error_handler.sh` 间接初始化 `DEV_TOOL_NAME` 并设置 `PLATFORM`，无需手动设置。

签约脚本通过 `scripts/error_handler.sh` 加载 `../../../normal/scripts/common.sh`，再由 `init_dev_tool_name` 调用 `detect_dev_tool.sh` 初始化 `DEV_TOOL_NAME`；Step 1 的环境检查只负责确认工具可用，不要求 Agent 手动添加 `DEV_TOOL_NAME=...` 前缀。
