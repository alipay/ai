# 登录授权流程规范

> 只在 onboarding Step 3 读取本模块。授权只能执行本文列出的 `auth.sh init|confirm|mismatch`；禁止 Agent 直接调用 `alipay-cli login`、解析其原始输出或展示 `verification_url`。
>
> 本文档定义支付宝登录授权的完整流程。
> 被引用：`flow.md` Step 3 登录授权
> 本文档位于 `references/onboarding/modules/`，文中的 `scripts/...` 路径相对本目录；从技能包根目录执行时对应 `references/onboarding/modules/scripts/...`。

---

## 一、Scope 定义

| 产品 | salesCode | Scope（固定值，禁止修改） |
|------|-----------|--------------------------|
| 按量付费 | I1080300001000160457 | `app:all,machine_pay:write,agmnt:write` |
| 网站支付 | I1080300001000041203 | `app:all,fast_instant_trade_pay:write` |
| APP 支付 | I1080300001000041313 | `app:all,auth_alipay_apppay:write` |

> ⚠️ **禁止自行修改 scope 值**

---

## 二、登录状态检查

### 2.1 检查命令

> 📎 已收口到脚本 `scripts/auth.sh init`。Agent 执行流程时调用 `bash scripts/auth.sh init`（见 flow.md Step 3）；脚本只有在登录有效且目标产品 scope、MCC 均校验通过后才返回 `AUTH_FLOW:SKIP`，需要新授权时返回 `AUTH_FLOW:READY`。校验不匹配时脚本返回对应信号并停止当前操作，不自行 logout；当前 Agent 执行环境没有取得可确认 CLI 结果时返回 `AUTH_FLOW:RETRY_WITH_NETWORK`，Agent 必须申请联网权限后重试同一条完整命令；检查或校验返回可识别业务失败时返回 `AUTH_FLOW:FAILED`，禁止进入状态查询。

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

当前约定的 `whoami` 返回只用于校验登录是否有效、是否过期和授权 scope，不包含可依赖的账号主体标识。外部写操作摘要不得从该返回中编造主体名称；按 `../flow.md` Step 5 展示当前有效登录会话，有其他已验证查询返回非敏感主体标识时再脱敏展示，否则要求用户确认当前登录账号就是操作目标。

| 返回值 | 状态 | 处理 |
|--------|------|------|
| `logged_in: true` + `is_expired: false` | 登录有效 | 继续校验目标产品 scope 和 MCC；均通过后才可进入后续步骤 |
| `logged_in: false` 或 `is_expired: true` | 未登录/已过期 | 进入登录授权流程 |

---

## 三、授权前用户确认（强制）

**在执行 `login` 命令前，必须先让用户确认产品类型和经营类目！**

该确认由 `../flow.md` Step 2 的一次性方案确认满足，但必须是用户对同一产品、经营类目和授权范围作出的明确确认。`full_process` 的项目状态回答、integration 产品确认或服务声明确认均不能替代本确认。复用确认只减少 onboarding 内部的重复询问，不降低本节要求；找不到有效确认记录、确认范围不同或信息发生变化时，必须按本节模板重新等待用户确认。

### 3.1 对客输出

本确认只使用 `../flow.md` Step 2 的 `onboarding.plan.confirm`，只有输入 `1` 表示确认；其他输入按问题、修改或补充处理。本模块不维护第二份 Markdown 模板或“是/否”近似问法。

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

`auth.sh init` 先校验产品名称、salesCode、scope、MCC 名称和编码属于当前固定规则，再执行 login、解析 device_code/verification_code/expires_in，并构造和校验最终授权链接，无需手动执行。上下文校验失败时必须在 `whoami/login` 和 opener 之前停止。

### 4.2 解析返回结果

由 `auth.sh init` 自动处理。

### 4.3 参数校验

由 `auth.sh init` 自动校验固定产品映射、MCC 参考表和 device_code，并在打开或输出前确认最终授权链接的 `deviceCode`、`productCode`、`mccCode` 与本次上下文逐项一致。

---

## 五、生成授权链接

### 5.1 链接格式

```
✅ 正确链接：https://aipay.alipay.com/cli-auth?deviceCode=xxx&productCode=xxx&mccCode=xxx
✅ 可选追加：platform=xxx

❌ 禁止使用：https://opengw.alipay.com/oauth/device （此链接无法授权）
```

### 5.2 构建命令

> 📎 已收口到脚本：`scripts/auth.sh init`（Step 5: 构建授权链接）

`auth.sh init` 使用结构化 URL 编码自动构建正确的授权链接（`https://aipay.alipay.com/cli-auth?...`），禁止字符串拼接其他域名、路径或 CLI 返回的 `verification_url`。

授权链接在调用 opener 和 renderer 前必须完成完整校验：协议、域名和路径固定；只允许各一个 `deviceCode`、`productCode`、`mccCode` 及至多一个可选 `platform`；禁止额外参数、重复参数和 fragment；产品码必须属于三个支持产品；三项必填值必须与本次 login 返回值和已确认产品/MCC 逐项一致。任一条件不满足时必须阻断，不得打开或展示。`platform` 缺失时不阻断。

### 5.3 ⚠️ 禁止透出 verification_url

CLI 返回的 JSON 中包含 `verification_url` 字段，**此链接无法用于授权，禁止透出给用户！**

### 5.4 ⚠️ 授权链接与确认码红线

```
❌ 禁止：展示 https://opengw.alipay.com/oauth/device 或任何 CLI verification_url
❌ 禁止：打开或展示其他域名、其他路径、额外/重复参数或带 fragment 的授权 URL
❌ 禁止：展示缺少 productCode 或 mccCode 的 https://aipay.alipay.com/cli-auth 半成品链接
❌ 禁止：让用户“输入验证码”
❌ 禁止：把确认码说成验证码、校验码或需要用户手动输入的内容
✅ 必须：把 login 返回的 verification_code 展示为“确认码”
✅ 必须：提示用户在授权页面核对确认码是否一致；确认码仅用于核对，不用于输入
```

---

## 六、授权信息展示

### 6.1 必须展示的 4 项信息

```
1. 产品类型（productName）— 如：网站支付、按量付费
2. 经营类目（mccName + mccCode）— 如：零售批发 > 互联网综合电商平台 (A0002_B0114)
3. 确认码（verificationCode）— login 返回的 verification_code
4. 授权链接有效期（从 expires_in 计算）
```

### 6.2 标准消息

授权对客消息统一使用 `../../normal/customer-messages.json`：`auth.sh init` 渲染 `auth.page`，`auth.sh confirm` 渲染 `auth.pending` / `auth.expired`，scope 或 MCC 不匹配时渲染 `auth.mismatch`。renderer 在渲染授权页前再次校验 URL 中的 `deviceCode/productCode/mccCode` 与本次 CLI 返回值、固定产品映射和 MCC 展示上下文逐项一致。URL 校验通过后默认调用受控 opener；无论 opener 返回 `OPENED`、`OPEN_FAILED`、`GUI_UNAVAILABLE` 还是 `LINK_ONLY`，`auth.sh init` 都只渲染 `auth.page` 的 `DEFAULT` 中性文案，不向用户区分底层打开结果。唯一模板必须包含产品、经营类目、确认码、有效期、安全核对、完整裸 URL、复制访问兜底和统一输入提示。只有输入 `1` 表示完成，其他输入按问题、修改或补充处理。完整模板只在消息目录维护，脚本负责确定性渲染，禁止在本模块维护第二份文本；Agent 不得在脚本后再次调用 renderer 或重复转述。

**输出红线：**
- `auth.sh init` 调用 renderer 的结果是唯一授权提示模板；Agent 不得自行简写、重排或改写为“授权确认/步骤/输入验证码”等其他格式。
- `auth.sh confirm` 和授权校验分支已托管 `auth.pending`、`auth.expired`、`auth.mismatch`；脚本输出对应终态后，Agent 只按终态转移，不得补写第二份提示。
- 确认码只用于用户核对授权页面展示内容，绝不是让用户输入的验证码。
- 授权链接必须使用消息目录渲染出的完整裸 URL，不得使用 Agent 自行拼写、缩写或重排的链接。
- 授权链接必须独占一行并放在“无法跳链”提示之后；禁止将提示文案拼接到 URL 后。

---

## 七、授权确认

### 7.1 命令

> 📎 已收口到脚本 `scripts/auth.sh confirm`。Agent 在当前授权 prompt 收到精确输入 `1` 后调用 `bash scripts/auth.sh confirm --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME"`（见 flow.md Step 3）；其他输入不得调用 `confirm`。

脚本内部执行 `login --complete` + scope 校验 + MCC 校验。授权上下文处理规则：

> `confirm` / `mismatch` 优先使用显式传入的 `salesCode`、`mccCode`、`scope`、`productName`、`mccName` 等授权上下文。`auth.sh init` 仍会短期保存本地状态文件，用于独立执行子命令时兜底恢复参数；默认状态使用当前用户独立的 `0700` 临时目录和 `0600` 原子写入文件，目录或文件为符号链接、非普通文件或权限无法收紧时立即停止。状态文件可见时，显式参数必须与同一次 `init` 保存的产品、scope 和 MCC 逐项一致，不一致时在 `login --complete/logout` 前停止。状态文件因执行环境切换不可见时，继续使用通过固定规则校验的完整显式上下文。授权成功、授权过期和可识别的授权确认失败会清理该状态文件；`PENDING`、命令执行失败、`whoami` 失败、scope/MCC 校验失败和 logout 失败等路径可能保留状态，以便恢复同一授权链路。状态文件存在不代表授权成功，也不得扩展为业务进度。CLI JSON 解析失败时禁止打印原始 stdout/stderr，避免透出 `verification_url`、deviceCode 或未脱敏响应。
>
> `AUTH_FLOW:RETRY_WITH_NETWORK` 只表示当前 Agent 执行环境未取得可确认结果，不能解释为用户本机网络故障、支付宝业务失败、logout 失败或 login 失败。Agent 必须申请联网权限后重试同一条完整 `auth.sh` 命令，不得要求用户手动 logout/login 代替本轮脚本事实。

### 7.2 返回格式与判断

| 脚本输出 | 含义 | 处理 |
|----------|------|------|
| `AUTH_FLOW:AUTH_SUCCESS` | 授权成功，scope 与 MCC 授权有效性检查通过 | 继续 Step 3.1 状态与资源查询 |
| `AUTH_FLOW:PENDING` | 用户尚未完成授权 | 继续等待 |
| `AUTH_FLOW:EXPIRED` | 授权链接已过期 | 重新执行 auth.sh init |
| `AUTH_FLOW:SCOPE_MISMATCH` | scope 权限不满足 | 调用 `auth.sh mismatch`，由其 logout 后重新授权 |
| `AUTH_FLOW:MCC_MISMATCH` | 经营类目未授权 | 调用 `auth.sh mismatch`，由其 logout 后重新授权 |
| `AUTH_FLOW:RETRY_WITH_NETWORK` | 当前 Agent 执行环境未取得可确认结果 | 申请联网权限后重试同一条完整命令 |
| `AUTH_FLOW:FAILED` | 授权确认返回未知错误 | 检查返回信息，联系技术支持 |

### 7.3 ⚠️ 禁止轮询

```
❌ 禁止：自动轮询检查授权状态
❌ 禁止：循环调用 login --complete
```

### 7.4 登录成功后的 scope 权限与 MCC 授权有效性校验

> 📎 已收口到脚本：`scripts/auth.sh confirm`（Step 3-6: scope + MCC 授权有效性校验）

`auth.sh init` 对已有有效登录、`auth.sh confirm` 对本次完成的授权都自动执行同一套 scope 和 MCC 授权有效性校验；不匹配时返回信号并停止当前操作。Agent 只需根据脚本返回值判断结果：

| 脚本输出 | 后续操作 |
|----------|----------|
| `AUTH_FLOW:SKIP` / `AUTH_FLOW:AUTH_SUCCESS` | 进入 Step 3.1 状态与资源查询 |
| `AUTH_FLOW:SCOPE_MISMATCH` / `AUTH_FLOW:MCC_MISMATCH` | 调用 `auth.sh mismatch`，由其 logout 后重新授权 |
| `AUTH_FLOW:RETRY_WITH_NETWORK` | 申请联网权限后重试同一条完整 `auth.sh` 命令 |

只有本次实际执行 `auth.sh` 的 stdout 唯一出现 `AUTH_FLOW:SKIP` 或 `AUTH_FLOW:AUTH_SUCCESS`，才能认为登录、scope 和现有 MCC 授权有效性检查通过。`READY`、`PENDING`、`EXPIRED`、不匹配、`RETRY_WITH_NETWORK`、`FAILED`、多标记或无标记均不得解释为授权成功；禁止用 Agent 自报状态或历史输出替代。

#### 7.4.1 校验实现

由 `auth.sh init`（已有有效登录）和 `auth.sh confirm`（本次授权完成）自动完成，无需手动执行。

**为什么需要这两个校验**：
- `login --complete` 只确认用户完成了扫码，不代表授权范围满足业务需求
- **Scope 权限校验**：确保授权包含产品所需的操作权限（如 `machine_pay:write`、`fast_instant_trade_pay:write` 或 `auth_alipay_apppay:write`）
- **MCC 绑定与授权有效性校验**：新授权先由固定 URL 将用户确认的 MCC 精确绑定到本次 deviceCode；登录完成后再使用现有签约查询识别后端明确返回的 `mccCode is not auth` / 产品未授权
- 如果不匹配，应该立即退出并重新授权，而不是等到后续 MCP 调用时才发现问题

当前冻结的 `ar-query.queryArInfosBySalesProd` 请求只包含 `salesProductCodes`，已验证响应中也没有可依赖的 MCC 字段。因此脚本不得声称从该响应“读取并等值比较了 MCC”；它证明的是本次 URL 已绑定目标 MCC，且当前授权上下文执行既有查询时没有被后端判定为 MCC/产品未授权。若后续取得真实响应中的权威 MCC 字段或其他已验证只读 schema，才能在不改现有请求契约的前提下增加服务端 MCC 等值比较。

---

## 八、权限检查与重新授权

### 8.1 授权范围不满足处理

**当检测到授权范围不满足时，必须执行 logout 然后重新授权。**

触发条件：
1. `auth.sh init` 或 `auth.sh confirm` 返回 `AUTH_FLOW:SCOPE_MISMATCH` / `AUTH_FLOW:MCC_MISMATCH`
2. MCP 调用返回 `mccCode is not auth` 错误
3. MCP 调用返回 `scope is not auth` 错误

处理流程：

> 📎 `scripts/auth.sh init` / `confirm` 和 `error_handler.sh` 只返回或提示授权不匹配并停止当前操作，不执行 logout。Agent 随后调用 `bash scripts/auth.sh mismatch --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME"`（见 flow.md Step 3）；该子命令是此恢复路径唯一的 logout 入口，退出成功后再调用 auth init 重新授权。若 mismatch 返回 `AUTH_FLOW:RETRY_WITH_NETWORK`，表示当前 Agent 执行环境无法确认 logout/login 结果，必须申请联网权限后重试同一条 mismatch 命令，不得改为让用户手动退出登录。

### 8.2 禁止行为

```
❌ 禁止：检测到授权范围不满足后继续执行后续操作
❌ 禁止：不执行 logout 直接重新登录
❌ 禁止：忽略权限错误继续调用 MCP
```

---

## 九、授权链接参数铁律

**最终打开和展示的授权链接只允许固定 `https://aipay.alipay.com/cli-auth`，并且必须各包含一个与本次上下文完全一致的 `deviceCode`、`productCode`、`mccCode`。`platform` 为唯一可选参数；脚本可由 `DEV_TOOL_NAME` 追加，缺失时不得阻断授权。其他参数、重复参数和 fragment 一律拒绝。**

| 场景 | deviceCode 来源 | productCode 来源 | mccCode 来源 | platform 来源 |
|------|-----------------|------------------|--------------|-------------|
| 首次授权 | login 返回 | Step 2 确认的 salesCode | Step 2 推荐的类目编码 | 可选，来自 `DEV_TOOL_NAME` |
| 重新授权 | 新 login 返回 | 显式参数或状态文件 salesCode | 显式参数或状态文件 mccCode | 可选，来自 `DEV_TOOL_NAME` |

> ⚠️ **显式参数和状态文件只包含授权链路恢复所需的受限上下文，不包含密钥、私钥或业务凭据；其中 deviceCode 仍按临时敏感值保护，禁止通过错误日志或普通对话额外输出。**

参数校验：

```bash
if [ -z "$DEVICE_CODE" ] || [ -z "$SALES_CODE" ] || [ -z "$MCC_CODE" ]; then
  echo "❌ 授权链接参数不完整，无法生成授权链接"
  exit 1
fi
```

授权链接由 `auth.sh init` 统一构建并做最终完整性校验；Agent 不得手写、简写或改写授权链接。

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

签约脚本通过 `scripts/error_handler.sh` 加载 `../../normal/scripts/common.sh`，再由 `init_dev_tool_name` 调用 `detect_dev_tool.sh` 初始化 `DEV_TOOL_NAME`；Step 1 的环境检查只负责确认工具可用，不要求 Agent 手动添加 `DEV_TOOL_NAME=...` 前缀。
