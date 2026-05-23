---
name: alipay-merchant-onboarding
description: 支付宝商家入驻流程编排。触发条件：用户说 "我要成为支付宝商家","我要入驻"、"我要签约"、"申请成为商家"、"支付宝商家入驻"、"支付宝商家签约"、"支付商家开通"、"开始上线"、"商家申请"、"商户入驻"、"我要创建应用"、"创建应用"、"发布应用"、"应用创建"、"应用发布"。支持个人开发者入驻，覆盖产品推荐、类目选择、资料采集、产品签约、应用创建全流程。使用 alipay-cli 真实 CLI 工具。
---
# 支付宝商家入驻 Skill
个人开发者支付宝商家入驻一站式解决方案。
---

## 目录
1. [全局规范与铁律](#全局规范与铁律)
2. [能力概览](#能力概览)
3. [任务管理规范](#任务管理规范)
4. [内存状态管理](#内存状态管理)
5. [主流程](#主流程)
6. [模块入口指引](#模块入口指引)
7. [对客输出规范](#对客输出规范)
8. [错误处理](#错误处理)
9. [FAQ](#faq)
10. [引用文档](#引用文档)
---

## 全局规范与铁律

### 使用声明
**使用本 skill 即表示同意：**
1. 使用本服务需遵守法律法规、自行审核测试并承担使用责任
2. 基于支付安全风控需要，我方需收集日志文件、环境信息等
3. 禁止在代码、大模型对话等公网透露敏感信息（密码、API Keys、私钥等）

### ⛔ 用户项目文件修改铁律（最高优先级）
```
❌ 禁止：直接修改用户项目中的 .ts / .tsx / .js 文件
❌ 禁止：修改 alipay-sdk-config.ts 或类似的支付配置文件
✅ 正确：输出配置内容让用户自行复制
✅ 正确：告知用户需要修改的文件路径和具体内容
```

### ⛔ 应用公钥管理铁律（最高优先级）
**核心原则：公钥由用户自行生成，skill 只负责接收和配置，不生成、不推断、不改写、不透出生成逻辑。**
```
❌ 禁止：自动为用户生成公钥或密钥对
❌ 禁止：向用户表示可以"帮助生成公钥"、"帮助生成密钥对"
❌ 禁止：提供任何密钥生成代码、命令或脚本
❌ 禁止：请求、接收或处理用户的私钥信息
❌ 禁止：在用户未明确提供 publicKey 时调用 createKeyConfirmPage
❌ 禁止：自动生成、推断、补全、改写或添加前后缀到 publicKey

✅ 必须：引导用户前往支付宝开放平台官方密钥生成工具
✅ 必须：只接受用户明确输入的完整 publicKey
✅ 必须：提醒用户妥善保管私钥，切勿泄露给任何人
```
**标准引导话术：**
请前往支付宝开放平台密钥生成工具（ https://opendocs.alipay.com/common/02kipk ） 
下载并使用官方工具生成应用公私钥对，生成后将应用公钥提供给我继续后续流程。
官方工具生成的私钥格式默认为PKCS#8，部分开发语言仅支持PKCS#1，如果需要转换成PKCS#1，可使用官方工具-格式转换。
**私钥请妥善保管，切勿泄露给任何人。**

### ⛔ MCP调用铁律（最高优先级）
**所有 `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call` 命令必须严格按照技能文档中定义的参数名、参数结构、参数数量执行，一字不改。**
```
✅ 必须：严格按照技能文档中的调用示例和参数结构执行
✅ 必须：使用文档中定义的完整参数，不得省略任何参数
✅ 必须：--json 和 2>/dev/null 同时使用
❌ 禁止：自行推断或猜测参数名
❌ 禁止：省略文档中定义的参数（包括 "ctx":{}）
❌ 禁止：添加文档中未定义的额外参数
❌ 禁止：修改参数的 JSON 嵌套结构
```

### ⛔ CLI 环境变量铁律（最高优先级）
**所有 `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli` 命令调用前必须设置 PLATFORM 环境变量。**
```
✅ 必须：在每个 alipay-cli 调用前设置 PLATFORM 环境变量
✅ 必须：DEV_TOOL_NAME 来自 Step 1 智能识别，缺失时填 "unknown"
❌ 禁止：省略 PLATFORM 环境变量直接调用 alipay-cli
❌ 禁止：硬编码 PLATFORM 值（如 PLATFORM=claudeCode）
❌ 禁止：使用分号 ; 连接（可能导致环境变量泄露）
```

### ⛔ 授权链接铁律（最高优先级）
**CLI 的 `login` 命令返回 `verification_url` 字段，此链接无法用于授权，禁止透出给用户！**
```
❌ 禁止透出：https://opengw.alipay.com/oauth/device（此链接无法授权）
✅ 正确链接：https://aipay.alipay.com/cli-auth?deviceCode=xxx&productCode=xxx&mccCode=xxx&platform=xxx
```

### ⛔ createKeyConfirmPage 返回处理铁律（最高优先级）
**返回结果中禁止展示二维码链接和 `alipays://` 协议链接，只展示 `confirmPageUrl` 的 Markdown 链接。**
```
❌ 禁止展示：二维码提示、alipays:// 协议链接
✅ 必须：将 confirmPageUrl 以 Markdown 链接格式输出
✅ 必须：等待用户确认后再继续后续步骤
```

### ⛔ 授权范围不满足处理铁律（最高优先级）
**当检测到授权范围不满足时，必须执行 logout 退出登录，然后重新授权。**
```
❌ 禁止：检测到授权范围不满足后继续执行后续操作
❌ 禁止：不执行 logout 直接重新登录
✅ 必须：检测到后先 logout 再重新授权
✅ 必须：重新授权时使用正确的 scope（根据当前 salesCode 确定）
```
> 详细处理流程见 `scripts/handle_scope_mismatch.sh`

---

## 能力概览

| 能力 | 说明 |
|------|------|
| 产品推荐 | 根据用户业务场景推荐合适的签约产品（电脑网站支付/AI收）|
| MCC类目选择 | 引导用户选择经营类目，提供智能推荐 |
| 登录授权 | alipay-cli OAuth 授权，获取用户身份和权限 |
| 资质信息收集 | 根据产品类型收集网站截图或服务注册信息 |
| 产品签约 | 提交签约申请，开通支付能力 |
| 应用发布 | 查询已有应用、复用/创建应用、设置公钥、提交审核 |
| 服务市场注册 | AI收产品的服务市场上架 |

---

## 任务管理规范

**入驻流程必须使用 TaskCreate/TaskUpdate/TaskList 进行任务管理，确保流程可追踪、可断点续。**

### 任务-Step对照表（强制遵守）

| 任务序号 | 任务名称 | 对应Step | 执行内容 |
|---------|----------|----------|----------|
| 任务1 | 环境检查 | Step 1 | 检查 alipay-cli 安装状态和运行环境 |
| 任务2 | 方案规划 | Step 2 | 根据用户业务推荐产品和经营类目 |
| 任务3 | 登录授权 | Step 3 | 支付宝 OAuth 授权登录 |
| 任务4 | 资料采集 | Step 4 | 收集网站截图（仅电脑网站支付未签约时） |
| 任务5 | 入驻推进 | Step 5 | 签约、服务注册、应用发布 |
| 任务6 | 流程结束 | Step 6 | 输出入驻结果 |

### 任务创建铁律（最高优先级）
**必须严格按以下顺序一次性创建全部6个任务，不可乱序、不可遗漏：**
```
TaskCreate({ subject: "环境检查", description: "检查 alipay-cli 安装状态和运行环境" })
TaskCreate({ subject: "方案规划", description: "根据用户业务推荐产品和经营类目" })
TaskCreate({ subject: "登录授权", description: "支付宝 OAuth 授权登录" })
TaskCreate({ subject: "资料采集", description: "收集网站截图（仅电脑网站支付未签约时）" })
TaskCreate({ subject: "入驻推进", description: "签约、服务注册、应用发布" })
TaskCreate({ subject: "流程结束", description: "输出入驻结果" })
```

### 任务跳过规则

| 条件 | 跳过的任务 | 处理方式 |
|------|-----------|----------|
| AI收 产品 | 任务4: 资料采集 | 直接标记 completed，输出"AI收 无需资料采集" |
| 已签约状态 | 任务4: 资料采集 | 直接标记 completed，输出"已签约，跳过资料采集" |
| 已有上线应用 | 任务5 部分内容 | 仅执行服务注册或应用发布，跳过重复步骤 |

---

## 内存状态管理

**状态数据保存在对话上下文中，不使用文件持久化。流程结束后自动清理。**

```json
{
  "productName": "电脑网站支付|AI收",
  "salesCode": "I1080300001000041203|I1080300001000160457",
  "scope": "app:all,fast_instant_trade_pay:write|app:all,machine_pay:write,agmnt:write",
  "mccCode": "Axxxx_Bxxxx",
  "mccName": "一级类目 > 二级类目",
  "collect_information": {
    "pc_home_page_image": "fileKey（仅电脑网站支付）",
    "pc_shop_page_image": "fileKey（仅电脑网站支付）",
    "pc_payment_image": "fileKey（仅电脑网站支付）"
  }
}
```

> 禁止存储：deviceCode / browserUrl / verificationCode / ar_sign_data / service_market_data / appId / authToken 等

---

## 主流程

### 流程概览

```
Step 1: 环境检查 → Step 2: 方案规划 → Step 3: 登录授权
    → Step 3.1: 签约状态查询（子操作）→ 判断后续流程
    → Step 4: 资料采集（条件执行）
    → Step 5: 入驻推进（签约 + 服务注册 + 应用发布）
    → Step 6: 流程结束
```

### Step 1: 环境检查

#### 1.1 CLI安装检查
```bash
if ! export PLATFORM=${DEV_TOOL_NAME} && alipay-cli version &>/dev/null; then
  echo "🔄 正在安装 alipay-cli..."
  curl -fsSL https://opengw.alipay.com/alipaycli/install | bash
fi
```

#### 1.2 任务创建（必须在执行任何Step之前完成）
> 按顺序创建全部6个任务（见任务管理规范），中间不执行任何操作。

#### 1.3 智能识别 AI 编程工具
> 执行 `scripts/detect_dev_tool.sh`，返回值写入 `DEV_TOOL_NAME`。缺失时填 "unknown"。
> 只输出"环境已具备，可以继续流程。"，禁止透出检测细节。

#### 1.4 内存状态初始化
初始化对话上下文变量：productName, salesCode, scope, mccCode, mccName, collect_information

### Step 2: 方案规划

#### 核心原则：直接推荐 + 不认可再调整
- 根据用户描述**直接**推荐产品和经营类目，不询问不纠结
- 用户确认 → 进入 Step 3；用户不认可 → 提供同类目备选（最多3个）

#### 产品匹配规则

| 场景关键词 | 推荐产品 | salesCode | scope |
|-----------|----------|-----------|-------|
| 网站、网页、PC、电脑、电商、商城 | 电脑网站支付 | I1080300001000041203 | app:all,fast_instant_trade_pay:write |
| AI、智能体、大模型、Agent、MCP | AI收 | I1080300001000160457 | app:all,machine_pay:write,agmnt:write |
| 无明确场景特征 | 电脑网站支付（默认） | I1080300001000041203 | app:all,fast_instant_trade_pay:write |

#### MCC匹配
> 读取 `references/mcc-reference.md` 进行语义匹配。**禁止 LLM 自行生成 mccCode。**

#### 用户确认后的流程
用户确认方案后 → **直接进入登录授权并输出授权信息**，不需要再次确认。

### Step 3: 登录授权
> 详见 `references/authorization.md`

#### 关键流程
1. whoami 检查登录状态（过期时不中断流程，Step 3 统一处理）
2. 执行 `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli login --non-interactive --scope "$SCOPE" --json 2>&1`
3. 解析 device_code → 构建授权链接 `https://aipay.alipay.com/cli-auth?deviceCode=xxx&productCode=xxx&mccCode=xxx&platform=xxx`
4. 输出授权信息（产品类型、经营类目、确认码、链接）→ 等待用户确认
5. 用户确认后执行 `export PLATFORM=${DEV_TOOL_NAME} && alipay-cli login --complete --json 2>&1`

#### Scope 映射
| 产品 | scope |
|------|-------|
| 电脑网站支付 | `app:all,fast_instant_trade_pay:write` |
| AI收 | `app:all,machine_pay:write,agmnt:write` |

#### 授权信息展示规范（最高优先级）
**必须固定展示4项信息 + 授权链接（Markdown格式），禁止条件性隐藏：**
1. 产品类型 2. 经营类目(mccName + mccCode) 3. 确认码 4. 授权链接有效期 + 链接

### Step 3.1: 授权后处理（登录授权子流程）

#### 签约状态查询
```bash
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call ar-query.queryArInfosBySalesProd \
  -d '{"request":{"salesProductCodes":["<salesCode>"]},"ctx":{}}' --json 2>/dev/null
```

#### 签约状态判断与分支
| 状态 | 产品类型 | 后续流程 |
|------|----------|----------|
| NOT_SIGNED | 电脑网站支付 | Step 4 资料采集（3张截图）→ Step 5 |
| NOT_SIGNED | AI收 | **直接 Step 5**（签约+服务注册+应用发布） |
| SIGNED | 电脑网站支付 | **直接 Step 5**（仅应用发布） |
| SIGNED | AI收 | **直接 Step 5**（服务注册+应用发布） |

> 详细判断逻辑和脚本见 `references/product-sign.md` 和 `scripts/query_sign_status.sh`

### Step 4: 资料采集

**⚠️ 仅针对"电脑网站支付"产品且未签约时执行，AI收 跳过此步骤。**

```
📋 电脑网站支付需要 3 张网站截图：
  1. 首页截图  2. 商品页截图  3. 支付页截图
请上传截图后继续。
```

> 上传与解析脚本见 `scripts/upload_screenshots.sh`

```bash
# 上传截图获取 fileKey
export PLATFORM=${DEV_TOOL_NAME} && alipay-cli file upload "$FILE_PATH" -s payMerchantcodeSkill --json 2>/dev/null
```

### Step 5: 入驻推进

**⚠️ 签约、服务注册、应用发布串行执行。**

| 步骤 | 模块 | 适用产品 | 详见 |
|------|------|----------|------|
| 5.1 | 产品签约 | 所有产品 | `references/product-sign.md` |
| 5.2 | 服务市场注册 | 仅AI收 | `references/service-registration.md` |
| 5.3 | 应用发布 | 所有产品 | `references/app-release.md` |

### Step 6: 流程结束

> 输出格式详见[对客输出规范 - 流程结束输出规范](#4-流程结束输出规范)

使用 TaskUpdate 标记所有任务为 completed。

---

## ⛔ 模块强读铁律（最高优先级）

**执行任何模块前，必须先读取对应的 references 文档获取完整参数和流程，禁止凭记忆执行！**

```
✅ 必须：执行签约相关操作前 → 先读取 references/product-sign.md
✅ 必须：执行应用发布相关操作前 → 先读取 references/app-release.md
✅ 必须：执行服务市场注册相关操作前 → 先读取 references/service-registration.md
✅ 必须：执行登录授权相关操作前 → 先读取 references/authorization.md
❌ 禁止：不读文档直接调用任何 MCP 方法
❌ 禁止：凭记忆猜测或推断 MCP 方法名、参数名、参数结构
❌ 禁止：自行编造文档中不存在的 MCP 方法（如 deleteService、updateApplication 等）
❌ 禁止：将签约模块的 ctx 参数习惯带入应用发布模块
❌ 禁止：将应用发布模块的无 ctx 习惯带入签约模块
```

## 模块入口指引

### 签约模块 → `references/product-sign.md`
> ⚠️ 执行签约前必须先读此文档
- 功能：签约状态查询 + 签约申请提交
- MCP：ar-sign.apply / ar-query.queryArInfosBySalesProd（⚠️ 需要 ctx）
- 签约JSON结构（电脑网站支付含webAppDTO+screenshot / AI收无webAppDTO）
- 关键变量：bizRequestNo（每次生成新UUID）、mccCode、channelCode、orderType
- 签约输出规范（费率免责声明）

### 应用发布模块 → `references/app-release.md`
> ⚠️ 执行应用发布前必须先读此文档
- 功能：查询已有应用 → 复用/创建 → 设置公钥 → 提交审核
- MCP：apprelease.*（7个方法）（⚠️ 不需要 ctx，参数结构与签约模块完全不同）
- ⛔ 应用MCP调用铁律（request包裹、无ctx、appTypes用数组）
- 应用复用强制原则（只可复用ON_LINE状态）
- createKeyConfirmPage 返回处理规范（仅展示confirmPageUrl）

### 服务市场注册模块 → `references/service-registration.md`
> ⚠️ 执行服务注册前必须先读此文档
- 功能：AI收产品服务上架（先查后建）
- MCP：仅2个方法 → a2a-pay-service.discoverBazaarServicesForMcp / saveBazaarServiceForMcp
- 5步流程：查询 → 判断 → 用户决策 → 提交 → 处理结果
- ⛔ 禁止：使用文档未定义的方法（如 deleteService、updateService）
- 入参校验规则 + 服务数量≤20限制 + 修改需传全部字段

### MCC推荐模块 → `references/mcc-reference.md`
- MCC类目参考表，用于语义匹配推荐经营类目
- ⛔ 禁止LLM自行生成mccCode，必须从文档精确匹配

### CLI命令规范 → `references/cli-commands.md`
- 所有 alipay-cli 命令的调用格式和参数规范
- 登录/授权/文件上传/MCP调用的详细说明

### MCP方法声明 → `references/mcp-methods.md`
- 所有 MCP 方法的参数结构和调用示例
- ⛔ 严禁虚拟MCP方法调用

### 登录授权 → `references/authorization.md`
- 登录状态检查、授权链接生成、重新授权、权限检查的完整流程
- ⛔ 重新授权三参数铁律（deviceCode, productCode, mccCode 缺一不可）

### 错误处理 → `references/error-handling.md`
- 错误类型识别优先级 + 统一错误处理模板
- MCP认证错误、服务错误、授权不匹配、后端业务错误的处理

---

## 对客输出规范

### 1. 方案规划输出规范
```markdown
让我先帮您规划方案，然后逐步完成入驻流程。
---
📋 根据您的[用户业务描述]，我为您推荐以下方案：

| 项目 | 信息 |
|------|------|
| 产品类型 | [产品名称] |
| 经营类目 | [一级类目] > [二级类目] ([mccCode]) |

请确认方案是否合适？确认后将继续下一步。
```

**不认可调整输出：**
```markdown
📋 了解，为您推荐[一级类目]类目下的其他选项：

| 序号 | 经营类目 | 适用场景 |
|------|----------|----------|
| 1 | [一级类目] > [二级类目1] | [适用场景1] |
| 2 | [一级类目] > [二级类目2] | [适用场景2] |

请选择序号，或继续描述您的经营场景。
```

### 2. 服务列表输出规范
| 序号 | 服务ID | 服务名称 | 描述 | 价格 | 状态 | 服务地址 |

### 3. 签约信息输出规范（含费率免责声明）
签约信息包含费率时，**必须附加免责声明**：
```markdown
📋 签约信息：
  • 签约状态：[状态]
  • 费率：[费率值]

> 由于支付宝可能会有阶段性的优惠活动，实际费率可能低于该页面费率，具体以相应费用账单为准。
```

### 4. 流程结束输出规范

**电脑网站支付：**
```markdown
🎉 支付宝商家入驻流程结束！

| 模块 | 项目 | 信息 |
|------|------|------|
| 📦 产品信息 | 产品类型 | [产品名称] |
| 📦 产品信息 | 经营类目 | [类目名称] |
| 📋 签约信息 | 签约状态 | [状态] |
| 📋 签约信息 | 费率 | [费率值]（如有） |
| 📱 应用信息 | 应用ID | [appId] |
| 📱 应用信息 | 应用状态 | [状态] |

> 由于支付宝可能会有阶段性的优惠活动，实际费率可能低于该页面费率，具体以相应费用账单为准。
```

**AI收产品（含服务市场信息）：** 在上述表格基础上增加🔧服务信息行（服务ID、服务名称、服务描述、服务状态、服务地址）。

---

## 错误处理

| 错误类型 | 识别关键词 | 处理方式 |
|----------|------------|----------|
| 认证错误 | HTTP 401, Authorization is empty | logout → 重新授权 |
| 服务错误 | MCP 调用失败（非401） | 提示检查网络后重试 |
| 授权信息不匹配 | mccCode/salesProductCodes is not auth, scope is not auth | **logout → 重新授权** |
| 签约错误 | errorCode, errorMessage | 展示错误，引导用户修正 |

**统一错误检测模板：**
```bash
if echo "$RESULT" | grep -qiE "HTTP 401|Authorization is empty|mccCode.*is not auth|salesProductCodes.*is not auth|scope.*is not auth|授权信息不匹配"; then
  # → 执行 scripts/handle_scope_mismatch.sh
fi
```

> 详细错误处理见 `references/error-handling.md`

---

## FAQ

### 产品相关
**Q: 网址未上线可以开通电脑网站支付吗？** A: 可以，上传网站截图即可。
**Q: 个人账号是否可以开通电脑网站支付？** A: 可以，需提供营业执照且名称一致。
**Q: AI收产品是什么？** A: AI收是通过支付宝实现智能体对机器支付的收单产品。
**Q: 个人开通AI收如何提升收款额度？** A: 需提供个体工商户营业执照，法人一致。

### 签约相关
**Q: 签约时提示"操作行为存在风险"怎么办？** A: 系统检测到账户异常，请过段时间再重新尝试。
**Q: 如何关闭产品？** A: 登录 b.alipay.com → 产品中心 → 找到产品 → 关闭产品。

> 完整 FAQ 见 `references/faq.md`

---

## 引用文档

| 文档 | 内容 |
|------|------|
| `references/product-sign.md` | 签约模块完整流程、JSON结构、状态判断 |
| `references/app-release.md` | 应用发布全流程、MCP调用铁律、复用规范 |
| `references/service-registration.md` | 服务市场注册流程、入参校验、先查后建 |
| `references/authorization.md` | 登录授权完整流程、scope校验、重新授权 |
| `references/flow.md` | 详细执行流程图和分支逻辑 |
| `references/cli-commands.md` | CLI 命令详细说明 |
| `references/mcp-methods.md` | MCP 方法声明、参数结构、方法路由 |
| `references/products.md` | 产品配置、MCC格式、资料采集需求 |
| `references/error-handling.md` | 错误处理详细说明 |
| `references/faq.md` | 常见问题解答 |
| `references/mcc-reference.md` | MCC 类目参考表 |
| `references/state-management.md` | 状态管理说明 |
| `scripts/detect_dev_tool.sh` | AI编程工具检测脚本 |
| `scripts/query_sign_status.sh` | 签约状态查询与判断脚本 |
| `scripts/handle_scope_mismatch.sh` | 授权范围不匹配处理脚本 |
| `scripts/app_query_and_reuse.sh` | 应用查询与复用判断脚本 |
| `scripts/service_query_and_list.sh` | 服务查询与列表输出脚本 |
| `scripts/upload_screenshots.sh` | 截图并行上传与解析脚本 |