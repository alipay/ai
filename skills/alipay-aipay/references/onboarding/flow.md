# 签约流程说明

> ⚠️ **前置声明**：本 flow 仅支持**网站支付、APP支付、按量付费**三种产品的签约。**其他产品（当面付、订单码支付、JSAPI支付、预授权支付、商家扣款等）暂不支持**，如需签约请前往[支付宝商家平台](https://b.alipay.com/page/portal/home)完成签约。

---

## 📂 文件路由表

> 本文件位于 `references/onboarding/`。下表中的 `modules/...`、`../normal/...` 路径均相对本文件所在目录；若从技能包根目录定位，请加前缀 `references/onboarding/`。

| 文件 | 说明 | 引用位置 |
|------|------|----------|
| **flow.md** | ⭐ 主入口 - 签约流程全览（本文档） | - |
| **../normal/** | 通用模块 | - |
| ↳ ../normal/alipay-cli-env.md | alipay-cli 检测与安装 | Step 1 环境检查 |
| ↳ ../normal/rejection-guide.md | 拒绝引导话术 | 通用 |
| ↳ ../normal/scripts/detect_dev_tool.sh | AI编程工具检测 | Step 1 |
| ↳ ../normal/scripts/common.sh | shell 公共函数与初始化入口 | 签约脚本公共依赖 |
| **modules/** | 子模块目录 | - |
| ↳ modules/mcc-reference.md | MCC类目参考表 | Step 2 方案规划 |
| ↳ modules/authorization.md | 登录授权模块 | Step 3 登录授权 |
| ↳ modules/product-sign.md | 签约模块 | Step 5.1 入驻推进 |
| ↳ modules/service-registration.md | 服务市场注册模块 | Step 5.2 入驻推进 |
| ↳ modules/app-release.md | 应用发布模块 | Step 5.3 入驻推进 |
| ↳ modules/error-handling.md | 错误处理说明 | 全流程 |
| **modules/scripts/** | 签约流程脚本 | - |
| ↳ modules/scripts/auth.sh | 登录授权全流程 | Step 3 |
| ↳ modules/scripts/query_sign_status.sh | 签约状态查询 | Step 3.1 |
| ↳ modules/scripts/upload_screenshots.sh | 截图上传 | Step 4 |
| ↳ modules/scripts/ar_sign_apply.sh | 签约提交 | Step 5.1 |
| ↳ modules/scripts/service.sh | 服务市场注册全流程 | Step 5.2 |
| ↳ modules/scripts/app.sh | 应用发布全流程 | Step 5.3 |
| ↳ modules/scripts/error_handler.sh | 统一错误检测（共享库） | 全流程 |

> 📌 **使用建议**：从 flow.md 主入口开始，按流程顺序执行各 Step。各 Step 中已标注对应的脚本调用命令。

---

## ⛔ 核心铁律（签约流程强制遵守）

> ⚠️ 以下铁律为签约流程的最高优先级规则，所有 Step 执行必须遵守。详细说明见各模块文档。

### 1. 应用公钥管理铁律
**核心原则：公钥由用户自行生成，skill 只负责接收和配置**
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
> 详见 `app-release.md`

### 2. 用户项目文件修改铁律
```
❌ 禁止：直接修改用户项目中的 .ts / .tsx / .js 文件
❌ 禁止：修改 alipay-sdk-config.ts 或类似的支付配置文件
✅ 正确：输出配置内容让用户自行复制
✅ 正确：告知用户需要修改的文件路径和具体内容
```

### 3. Agent 话术约束铁律（全局）
**本铁律适用于签约全流程所有需要输出引导话术的场景**
```
🚨 【强制】Agent 话术约束（最高优先级）：
❌ 禁止：篡改各模块标准引导话术中的链接、格式或内容
❌ 禁止：添加标准话术中没有的内容（如"PEM格式"、"-----BEGIN PUBLIC KEY-----"等）
❌ 禁止：替换标准话术中的官方链接（如将 opendocs.alipay.com 替换为其他链接）
❌ 禁止：自行创造、补充、解释任何未见于标准话术的格式说明
✅ 必须：100% 复制使用各模块文档中的「标准引导话术」原文
✅ 必须：当需要补充说明时，只能引用官方文档链接

📌 典型反例：
❌ 错误：将 https://opendocs.alipay.com/common/02kipk 替换为 https://open.alipay.com/keytool
❌ 错误：在引导话术中添加"公钥以 -----BEGIN PUBLIC KEY----- 开头"
❌ 错误：自行解释"PEM格式"、"PKCS#1/PKCS#8"等格式概念
```
> 详见各模块文档中的「标准引导话术」

### 4. CLI环境变量铁律
```
✅ 必须：在每个 alipay-cli 调用前设置 PLATFORM 环境变量
✅ 必须：DEV_TOOL_NAME 由脚本公共初始化获得，缺失时填 "unknown"
❌ 禁止：省略 PLATFORM 环境变量直接调用 alipay-cli
❌ 禁止：硬编码 PLATFORM 值（如 PLATFORM=claudeCode）
❌ 禁止：使用分号 ; 连接（可能导致环境变量泄露）
```

### 5. 授权链接铁律
**CLI 的 `login` 命令返回 `verification_url` 字段，此链接无法用于授权，禁止透出给用户！**
```
❌ 禁止透出：https://opengw.alipay.com/oauth/device（此链接无法授权）
✅ 正确链接：https://aipay.alipay.com/cli-auth?deviceCode=xxx&productCode=xxx&mccCode=xxx&platform=xxx
✅ 必须：在授权链接后提示“无法跳链时，请复制链接到网页浏览器打开”
```
> 详见 `modules/authorization.md`

### 6. createKeyConfirmPage 返回处理铁律
**返回结果中禁止展示二维码链接和 `alipays://` 协议链接，只展示 `confirmPageUrl` 的 Markdown 链接。**
```
❌ 禁止展示：二维码提示、alipays:// 协议链接
✅ 必须：将 confirmPageUrl 以 Markdown 链接格式输出
✅ 必须：在确认链接后提示“无法跳链时，请复制链接到网页浏览器打开”
✅ 必须：等待用户确认后再继续后续步骤
```
> 详见 `modules/app-release.md`

### 7. 授权范围不满足处理铁律
**当检测到授权范围不满足时，必须执行 logout 退出登录，然后重新授权。**
```
❌ 禁止：检测到授权范围不满足后继续执行后续操作
❌ 禁止：不执行 logout 直接重新登录
✅ 必须：检测到后先 logout 再重新授权
✅ 必须：重新授权时使用正确的 scope（根据当前 salesCode 确定）
```
> 详见 `modules/authorization.md` §8.1，由 `modules/scripts/auth.sh mismatch` 处理

### 8. 模块强读铁律
**执行任何模块前，必须先读取对应的 references 文档获取完整参数和流程，禁止凭记忆执行！**
```
✅ 执行签约相关操作前 → 先读取 modules/product-sign.md
✅ 执行应用发布相关操作前 → 先读取 modules/app-release.md
✅ 执行服务市场注册相关操作前 → 先读取 modules/service-registration.md
✅ 执行登录授权相关操作前 → 先读取 modules/authorization.md
❌ 禁止：不读文档直接调用任何 MCP 方法
❌ 禁止：凭记忆猜测或推断 MCP 方法名、参数名、参数结构
❌ 禁止：自行编造文档中不存在的 MCP 方法
```

### 9. MCP调用铁律
**签约/查询模块与应用/服务模块的参数结构完全不同，禁止混用！**
```
✅ 签约/查询用 ctx：{"request":{...},"ctx":{}}
✅ 应用/服务不用 ctx：{"request":{...}}
❌ 禁止：将签约模块的 ctx 习惯带入应用发布模块
❌ 禁止：将应用发布模块的无 ctx 习惯带入签约模块
❌ 禁止：省略 ctx:{}（签约模块）
❌ 禁止：添加 ctx（应用/服务模块）
```

### 10. 依据不足时不编造
```
✅ 必须：没有确定依据时明确说明无法确认
✅ 签约、费率、额度解限、可收款时间解限等不确定问题 → 引导用户前往支付宝商家平台咨询客服
✅ 代码集成、应用创建、应用发布等不确定问题 → 引导用户前往支付宝开放平台或支付宝技术支持咨询客服
❌ 禁止：猜测签约审核规则、额度解限条件、可收款时间、费率优惠、应用创建限制或接口能力
```

商家平台咨询入口：[支付宝商家平台](https://b.alipay.com/page/portal/home)

开放平台咨询入口：[支付宝开放平台](https://open.alipay.com/) / [支付宝技术支持](https://opensupport.alipay.com/support/intelligent-services?form=payskill)

---

## 一、产品映射

> 术语说明：本 Skill 中“网站支付”是唯一的网页支付产品概念，覆盖电脑网页和手机浏览器网页/H5 场景；“电脑网站支付”“PC网站支付”“手机网站支付”“H5支付”均按网站支付处理。签约 payload 中的 `appType=PC_WEB` 是接口字段名，不代表只能用于 PC 端网页。

| 产品 | salesCode | scope | 资料采集要求 |
|------|-----------|-------|-------------|
| 按量付费 | I1080300001000160457 | app:all,machine_pay:write,agmnt:write | 无需截图 |
| 网站支付 | I1080300001000041203 | app:all,fast_instant_trade_pay:write | 需要3张网站截图 |
| APP支付 | I1080300001000041313 | app:all,auth_alipay_apppay:write | 签约前需要 APP 名称和3张APP界面截图，签约状态固定按 `OFFLINE` 提交；移动应用平台信息在 5.3 应用创建阶段再采集 |

---

## 二、主流程（6步）

```
Step 1: 环境检查 → Step 2: 方案规划 → Step 3: 登录授权
    → Step 3.1: 签约状态查询 → Step 4: 资料采集
    → Step 5: 入驻推进 → Step 6: 流程结束
```

---

## 三、Step 详解

### Step 1: 环境检查

**必读文档**：
- `../normal/alipay-cli-env.md` - alipay-cli 检测、安装、验证规范

**脚本**：
- `../normal/scripts/detect_dev_tool.sh` - 检测 AI 编程工具，输出 DEV_TOOL_NAME 取值
- `../normal/scripts/common.sh` - shell 公共函数与初始化入口；签约脚本通过 `error_handler.sh` 间接调用 `init_dev_tool_name`

**任务**：
1. 检查 alipay-cli 是否安装，未安装则自动安装
2. 确认 AI 编程工具检测脚本可用；签约脚本执行时会通过公共初始化设置 DEV_TOOL_NAME
3. 创建7个任务：环境检查、方案规划、登录授权、签约状态查询、资料采集、入驻推进、流程结束
4. 初始化内存状态

**任务创建**：
```bash
TaskCreate({ subject: "环境检查" })
TaskCreate({ subject: "方案规划" })
TaskCreate({ subject: "登录授权" })
TaskCreate({ subject: "签约状态查询" })
TaskCreate({ subject: "资料采集" })
TaskCreate({ subject: "入驻推进" })
TaskCreate({ subject: "流程结束" })
```

### Step 2: 方案规划

**必读文档**：
- `modules/mcc-reference.md` - MCC类目参考表

**产品匹配规则**：

| 场景关键词 | 推荐产品 | salesCode | scope |
|-----------|----------|-----------|-------|
| AI、智能体、大模型、Agent、MCP | 按量付费 | I1080300001000160457 | app:all,machine_pay:write,agmnt:write |
| 网站、网页、PC、电脑、电商、商城、H5 | 网站支付 | I1080300001000041203 | app:all,fast_instant_trade_pay:write |
| APP、应用内支付、手机APP | APP支付 | I1080300001000041313 | app:all,auth_alipay_apppay:write |

**MCC类目**：
- 读取 `modules/mcc-reference.md` 进行语义匹配
- 示例：互联网综合电商平台 (A0002_B0114)
- mccCode 格式：`Axxxx_Bxxxx`

**⚠️ 方案规划阶段的登录状态预检（可选）**：

在方案规划阶段可选择性执行 whoami 检查。如果 whoami 返回过期（`logged_in: false` 或 `is_expired: true`），不要中断流程，当用户没登录继续往下走，登录授权统一在 Step 3 处理。

### Step 3: 登录授权

**必读文档**：
- `modules/authorization.md` - 登录授权模块

**脚本**：
- `modules/scripts/auth.sh` - 登录授权全流程（init / confirm / mismatch）

**完整流程**：
```
1. bash modules/scripts/auth.sh init --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME"
   ├─ AUTH_FLOW:SKIP → 已登录，直接进入 Step 3.1（后续 MCP 调用会自动检测 scope/mcc）
   └─ AUTH_FLOW:READY → 未登录，自动 login + 输出授权信息表格
2. 等待用户回复"好了"确认授权完成
3. bash modules/scripts/auth.sh confirm --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME"
   ├─ AUTH_FLOW:AUTH_SUCCESS → 进入 Step 3.1
   ├─ AUTH_FLOW:PENDING / EXPIRED / FAILED → 等待或重新授权
   └─ AUTH_FLOW:SCOPE_MISMATCH / MCC_MISMATCH → 已自动 logout，执行 modules/scripts/auth.sh mismatch --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME"
```

> `confirm` / `mismatch` 优先使用显式传入的非敏感授权上下文。这样即使 Agent 在沙箱化执行环境和可联网执行环境之间切换，也不依赖临时状态文件是否可见。

**Scope 对应表**：
| 产品 | scope |
|------|-------|
| 按量付费 | app:all,machine_pay:write,agmnt:write |
| 网站支付 | app:all,fast_instant_trade_pay:write |
| APP支付 | app:all,auth_alipay_apppay:write |

**⚠️ 授权信息展示规范**：
- 必须展示：产品类型、经营类目(mccName+mccCode)、确认码、授权链接有效期
- 禁止使用 CLI 返回的 verification_url
- 正确链接：`https://aipay.alipay.com/cli-auth?deviceCode=xxx&productCode=xxx&mccCode=xxx&platform=xxx`

#### Step 3.1: 签约状态查询（登录授权后置检查）

**查询命令**：执行 `bash modules/scripts/query_sign_status.sh --sales-code "$SALES_CODE" --product-type "$PRODUCT_TYPE"`

> ⚠️ 脚本通过 `error_handler.sh` 间接初始化 `DEV_TOOL_NAME`；必须传入当前产品的 `--sales-code`，建议同时传入 `--product-type`（aipay|webpay|apppay）做一致性校验。网站支付和APP支付使用不同 salesCode，禁止用网站支付 salesCode 查询 APP支付签约状态。

**脚本**：
- `modules/scripts/query_sign_status.sh` - 查询签约状态并判断后续流程

**状态判断**：
| 返回结果 | 状态 |
|----------|------|
| arInfoList 为空 | NOT_SIGNED |
| arStatus = "02" | SIGNED_EFFECTIVE（已签约生效） |
| arStatus = "01" | SIGN_SUBMITTED（已提交签约，待生效） |

`SIGNED_EFFECTIVE` 与 `SIGN_SUBMITTED` 都禁止重复提交签约，后续 FLOW 均沿用 `FLOW:*_SIGNED` 继续应用发布/服务注册。

**分支处理**：

| FLOW 信号 | 状态 | 产品 | 后续流程 |
|-----------|------|------|----------|
| `FLOW:AI_PAY_NOT_SIGNED` | NOT_SIGNED | 按量付费 | 跳过 Step 4，进入 Step 5.1 签约，再继续 5.2 服务注册 + 5.3 应用发布 |
| `FLOW:PC_WEB_NOT_SIGNED` | NOT_SIGNED | 网站支付 | Step 4采集3张网站截图 → Step 5 |
| `FLOW:APP_NOT_SIGNED` | NOT_SIGNED | APP支付 | Step 4采集APP名称和3张APP截图 → Step 5 |
| `FLOW:AI_PAY_SIGNED` | SIGNED_EFFECTIVE / SIGN_SUBMITTED | 按量付费 | 跳过 Step 5.1，直接 Step 5.2 服务注册 + Step 5.3 应用发布 |
| `FLOW:PC_WEB_SIGNED` | SIGNED_EFFECTIVE / SIGN_SUBMITTED | 网站支付 | 跳过 Step 5.1，直接 Step 5.3 应用发布 |
| `FLOW:APP_SIGNED` | SIGNED_EFFECTIVE / SIGN_SUBMITTED | APP支付 | 跳过 Step 5.1，直接 Step 5.3 应用发布 |
| `FLOW:OTHER_STATUS` | 其他 | 任意 | 进入资料采集流程 |

### Step 4: 资料采集

> 根据产品类型决定是否需要资料采集：

**按量付费**：⚠️ **跳过**，进入 Step 5.1 签约；若已签约则跳过 5.1，继续 5.2 服务注册 + 5.3 应用发布

**网站支付**：需要3张网站截图（首页、商品页、支付页）

**APP支付**：签约前只需要 APP 名称和3张APP界面截图（首页、商品页、支付页），签约状态固定按 `OFFLINE` 提交。`mobilePlatform`、`bundleId`、`appPackage`、`appSign` 属于 5.3 应用创建阶段，不在签约申请提交前采集。

APP支付资料采集字段：
| 字段 | 必填条件 | 说明 |
|------|----------|------|
| APP名称 | 必填 | 传入 `ar_sign_apply.sh --app-name` |
| APP界面截图 | 必填 | 3张截图，支持拖拽上传或提供本地文件路径，顺序为首页、商品页、支付页 |

**必读文档**：
- 无需额外模块文档

**脚本**：
- `bash modules/scripts/upload_screenshots.sh <img1> <img2> <img3>` - 上传3张截图；用户可拖拽上传图片，Agent 将拖拽后的本地文件路径传给脚本

**⚠️ 上传完成后更新内存状态**：
```json
{
  "collect_information": {
    "screenshot": ["imageRefHome", "imageRefProduct", "imageRefPay"],
    "appName": "仅APP支付需要"
  }
}
```

### Step 5: 入驻推进

**必读文档**：
- `modules/product-sign.md` - 签约模块
- `modules/service-registration.md` - 服务市场注册模块
- `modules/app-release.md` - 应用发布模块

**按量付费入驻产物关系**：
- 产品签约负责开通按量付费能力，使用 `salesCode=I1080300001000160457` 和 `scope=app:all,machine_pay:write,agmnt:write`。
- 服务市场注册负责生成或复用按量付费服务，服务信息中的服务单价、服务地址和请求示例会影响后续 402 收银联调。
- 应用发布负责生成或复用 `WEBAPP` 应用，并取得正式集成所需的 `appId`、应用私钥对应的应用公钥配置状态、支付宝公钥。
- 后续集成按量付费时，`sellerId` 来自商户 PID/2088，`serviceId` 来自服务市场注册结果，`appId/alipayPublicKey` 来自应用发布或复用结果；不要用沙箱示例值替代这些正式产物。


#### 5.1 产品签约

> ⚠️ **执行前必须先完整阅读 `modules/product-sign.md`**
>
> 仅当 Step 3.1 查询结果为 `NOT_SIGNED` 时执行本节。若已输出 `FLOW:AI_PAY_SIGNED`、`FLOW:PC_WEB_SIGNED` 或 `FLOW:APP_SIGNED`，必须跳过 5.1，禁止重复提交签约申请。

**签约提交**：执行 `bash modules/scripts/ar_sign_apply.sh`。完整参数规范、JSON 模板及变量说明见 `modules/product-sign.md`。

**按量付费**：
```bash
bash modules/scripts/ar_sign_apply.sh --product aipay --sales-code "I1080300001000160457" --mcc-code "<从Step2获取>"
```

**网站支付/APP支付**：
```bash
# 网站支付：
bash modules/scripts/ar_sign_apply.sh --product webpay --sales-code "I1080300001000041203" --mcc-code "<从Step2获取>" --picurl1 <imageRef1> --picurl2 <imageRef2> --picurl3 <imageRef3>
# APP支付：
bash modules/scripts/ar_sign_apply.sh --product apppay --sales-code "I1080300001000041313" --mcc-code "<从Step2获取>" --app-name "<APP名称>" --picurl1 <imageRef1> --picurl2 <imageRef2> --picurl3 <imageRef3>
```

**按量付费**：
- 无 webAppDTO
- 无 screenshot
- 签约成功后不等待审核生效，继续执行 5.2 服务市场注册和 5.3 应用发布
- 若签约状态查询已显示 `SIGNED`，跳过 5.1，仅继续服务市场注册和应用发布，确保拿到服务与应用产物

**网站支付/APP支付**：
- 网站支付需要 webAppDTO + screenshot（3个上传后的图片引用值）
- APP支付需要 nativeAppDTO + name + screenshot（3个上传后的图片引用值），placeType 固定为 `ONLINE_NATIVEYAPP`，appStatus 固定为 `OFFLINE`

**⚠️ 签约提交成功后非阻塞推进**：

签约提交成功后无需等待审核通过，`ar_sign_apply.sh` 会输出 FLOW 信号指示后续步骤：

| FLOW 信号 | 产品 | 后续步骤 |
|-----------|------|----------|
| `FLOW:AI_PAY_SIGN_CONTINUE` | 按量付费 | 立即继续 5.2 服务注册 + 5.3 应用发布 |
| `FLOW:PC_WEB_SIGN_CONTINUE` | 网站支付 | 立即继续 5.3 应用发布 |
| `FLOW:APP_SIGN_CONTINUE` | APP支付 | 立即继续 5.3 应用发布 |

```
✅ 签约提交成功 → 立即推进 5.2/5.3，无需等待签约审核
❌ 禁止：签约提交后停住等待审核通过再继续
❌ 禁止：轮询签约状态直到生效再继续
```

#### 5.2 服务市场注册（仅按量付费）

**查询服务**：执行 `bash modules/scripts/service.sh list`。完整流程、参数规范及交互逻辑见 `modules/service-registration.md`。

**创建/修改服务**：执行 `bash modules/scripts/service.sh save`。创建不传 `--service-id`，修改已有服务需加 `--service-id <id>`，详见 `modules/service-registration.md`。

**入参校验**：执行 `bash modules/scripts/service.sh validate --name <n> --desc <d> --url <u> --pricing <p> --schema <json>`。

**服务产物记录**：服务注册或复用成功后，记录服务 ID、服务名称、服务地址、服务单价和状态。按量付费集成代码中的 `serviceId` 必须使用该服务 ID，禁止沿用示例值 `service_ai_content_001`。

#### 5.3 应用发布

**应用类型**：
- 按量付费/网站支付：发布 `WEBAPP`
- APP支付：发布 `MOBILEAPP`

执行 `app.sh list/create` 前必须保留 Step 2 的产品上下文，至少传入 `--product-type` 或 `--sales-code`；如显式传入 `--application-type`，必须与产品上下文匹配。

**流程**：
1. 查询已有应用 → queryApplicationList
2. 复用 ON_LINE 状态应用，或创建新应用 → createApplication
3. 设置公钥 → createKeyConfirmPage（需要用户提供的公钥）
4. 用户确认后校验公钥 → queryApplicationSecurityKey
5. 提交审核 → submitApplicationAudit

**查询应用**：执行 `bash modules/scripts/app.sh list --product-type "$PRODUCT_TYPE" --sales-code "$SALES_CODE"`。APP支付会按 `--product-type apppay` 或 `--sales-code I1080300001000041313` 自动查询 `MOBILEAPP`。

APP支付新建 `MOBILEAPP` 时，`appSign` 仅表示 Android 应用签名摘要字段。采集 `appSign` 时只向用户索要其 Android 应用对应的签名摘要值，禁止引导用户通过支付宝开放平台官方密钥生成工具、签名工具或格式转换工具获取；阶段 4 的应用公钥生成引导只适用于 `createKeyConfirmPage` 的 `publicKey`，不得套用到 `appSign`。

```bash
# 按量付费/网站支付
bash modules/scripts/app.sh list --product-type "<aipay|webpay>" --sales-code "<当前产品码>"
bash modules/scripts/app.sh create --product-type "<aipay|webpay>" --sales-code "<当前产品码>"

# APP支付
bash modules/scripts/app.sh list --product-type "apppay" --sales-code "I1080300001000041313"

# APP支付 - iOS
bash modules/scripts/app.sh create --product-type "apppay" --sales-code "I1080300001000041313" --mobile-platform "IOS" --bundle-id "<bundleId>"

# APP支付 - Android
bash modules/scripts/app.sh create --product-type "apppay" --sales-code "I1080300001000041313" --mobile-platform "ANDROID" --app-package "<appPackage>" --app-sign "<appSign>"

# APP支付 - iOS + Android
bash modules/scripts/app.sh create --product-type "apppay" --sales-code "I1080300001000041313" --mobile-platform "ALL" --bundle-id "<bundleId>" --app-package "<appPackage>" --app-sign "<appSign>"
```

**创建应用**：执行 `bash modules/scripts/app.sh create --product-type "$PRODUCT_TYPE" --sales-code "$SALES_CODE"`。APP支付会自动创建 `MOBILEAPP`，但只在进入 5.3 创建应用阶段后采集移动应用平台信息：`IOS` 需要传 `--bundle-id`，`ANDROID` 需要传 `--app-package` 和 `--app-sign`，`ALL` 需要三项都传。字段缺失时先向用户补问，禁止用最小入参创建 `MOBILEAPP`。补问 `appSign` 时只索要 Android 应用签名摘要值，不引导用户使用支付宝开放平台官方密钥/签名工具。

**设置公钥**：执行 `bash modules/scripts/app.sh key <appId> <用户提供的公钥>`。

**确认公钥**：用户完成确认后，执行 `bash modules/scripts/app.sh verify-key <appId> <用户提供的公钥>`。确认失败时禁止进入提审。

**提交审核**：执行 `bash modules/scripts/app.sh audit <appId>`。

**复用应用**：执行 `bash modules/scripts/app.sh reuse <appId>`。复用已有 `MOBILEAPP` 时不需要采集 `mobilePlatform`、`bundleId`、`appPackage` 或 `appSign`；这些字段仅在新建 `MOBILEAPP` 时需要。

> 📎 完整参数规范、MCP 调用铁律及流程骨架见 `modules/app-release.md`

**应用产物记录**：应用创建/复用成功后，记录 `appId`、应用状态和支付宝公钥文件路径。按量付费集成代码中的 `seller_app_id` 使用该 `appId`，验签配置使用导出的支付宝公钥。

### Step 6: 流程结束

**⚠️ intention 分支判断**：

| intention 值 | 处理方式 |
|-------------|----------|
| `onboarding_only` | 输出入驻结果，并提醒还需要完成代码集成才能实际发起支付 |
| `full_process` | 输出入驻结果，引导进入集成流程（references/integration/flow.md） |
| `integration_only` | 不应走到此步骤（仅集成无签约） |

**输出格式**：
```markdown
🎉 支付宝商家入驻流程结束！

| 模块 | 项目 | 信息 |
|------|------|------|
| 📦 产品信息 | 产品类型 | {productName} |
| 📦 产品信息 | 经营类目 | {mccName} |
| 📋 签约信息 | 签约状态 | {状态} |
| 📋 签约信息 | 费率 | {费率值} |
| 📱 应用信息 | 应用ID | {appId} |
| 📱 应用信息 | 应用状态 | {状态} |

> 由于支付宝可能会有阶段性的优惠活动，实际费率可能低于该页面费率，具体以相应费用账单为准。

**后续衔接**
- 如果本次只完成签约/入驻：还需要完成代码集成，才能在业务系统中实际发起支付。
- 如果本次是完整接入/一站式流程：接下来继续进入支付代码集成流程。
```

使用 TaskUpdate 标记所有任务为 completed。

---

## 四、错误处理（全局规则）

> ⚠️ **CLI 命令执行后必须进行错误检测**：在签约流程的**任何 CLI 命令执行后**（包括 MCP 调用、login、whoami、logout、file upload 等），都必须立即调用错误检测逻辑（参考 error-handling.md 第六节）。这是**全流程强制规则**，不区分 Step。

```bash
# 通用错误检测调用方式（在任意 MCP/CLI 调用后）
RESULT=$(export PLATFORM=${DEV_TOOL_NAME} && alipay-cli mcp call <METHOD> -d '<JSON>' --json 2>/dev/null)

# 调用统一错误检测入口（内含 MCP 信封自动解包）
if ! handle_error "$RESULT"; then
  # 错误已被 handle_error 处理并输出提示，返回这里等待用户回复
  return 1
fi

# 如果返回 0，解包 MCP 信封后处理业务字段
BUSINESS=$(unwrap_mcp "$RESULT")
SUCCESS=$(echo "$BUSINESS" | jq -r '.success // false')
```

> 📎 详细错误检测脚本和处理函数见 `modules/scripts/error_handler.sh` 和 `modules/error-handling.md`

| 错误类型 | 关键词 | 处理方式 |
|----------|--------|----------|
| MCP认证错误 | HTTP 401, Authorization is empty | logout → 重新授权 |
| MCP服务错误 | MCP 调用失败, connection refused, timeout | 沙箱化 Agent 环境申请可联网权限重试同一命令；其他环境提示检查网络 |
| 授权不匹配 | mccCode is not auth, scope is not auth | logout → 重新授权 |
| 业务错误 | errorCode 存在 | 展示错误信息 |
| 依据不足 | 无官方依据、无脚本返回、无已验证结论 | 明确说明无法确认；签约/费率/额度/可收款时间问题引导至支付宝商家平台，代码集成/应用创建问题引导至支付宝开放平台或支付宝技术支持 |

---

## 五、内存状态

> 💡 内存状态用于在多轮对话中保存上下文信息，**在 Step 1 初始化**，在后续 Step 中**读写内存**以保持状态连贯。

**内存结构**：
```json
{
  "intention": "integration_only|onboarding_only|full_process",
  "productName": "按量付费|网站支付|APP支付",
  "productType": "aipay|webpay|apppay",
  "salesCode": "I1080300001000160457|I1080300001000041203|I1080300001000041313",
  "scope": "app:all,machine_pay:write,agmnt:write|app:all,fast_instant_trade_pay:write|app:all,auth_alipay_apppay:write",
  "mccCode": "Axxxx_Bxxxx",
  "mccName": "一级类目 > 二级类目",
  "signStatus": "NOT_SIGNED|SIGNED_EFFECTIVE|SIGN_SUBMITTED|OTHER_STATUS",
  "collect_information": {
    "screenshot": ["imageRefHome", "imageRefProduct", "imageRefPay"],
    "appName": "仅APP支付签约前需要"
  },
  "service": {
    "serviceId": "仅按量付费需要",
    "serviceName": "服务名称",
    "resourceUrl": "服务地址",
    "pricing": "服务单价",
    "status": "服务状态"
  },
  "application": {
    "appId": "应用ID",
    "applicationType": "WEBAPP|MOBILEAPP",
    "mobilePlatform": "IOS|ANDROID|ALL，仅 APP支付创建 MOBILEAPP 时需要",
    "bundleId": "mobilePlatform=IOS 或 ALL 时需要",
    "appPackage": "mobilePlatform=ANDROID 或 ALL 时需要",
    "appSign": "mobilePlatform=ANDROID 或 ALL 时需要",
    "appStatus": "应用状态",
    "alipayPublicKeyFile": "~/.config/<appId>-alipayPublicKey.keytext"
  }
}
```

> 内存状态只保存流程上下文和非敏感产物引用。禁止写入私钥、公钥原文、签名串、授权 token、完整支付表单或其他业务凭据。
> `appSign` 指 Android 应用签名摘要字段，只在应用创建阶段使用，不是应用公钥、支付签名串或私钥；不得把支付签名串、私钥或其他业务凭据写入内存，也不得引导用户通过支付宝开放平台官方密钥/签名工具获取。

**productType 与 productName 对应关系**：
| productName | productType | 说明 |
|-------------|-------------|------|
| 按量付费 | aipay | 作为 `--product-type` 传给脚本 |
| 网站支付 | webpay | 作为 `--product-type` 传给脚本 |
| APP支付 | apppay | 作为 `--product-type` 传给脚本 |

**使用场景**：
| 步骤 | 操作 | 说明 |
|------|------|------|
| Step 1 | 初始化内存状态 | 设置 `intention` 字段 |
| Step 2 | 写入内存 | 设置 `productName`、`productType`、`salesCode`、`scope`、`mccCode`、`mccName` |
| Step 3.1 | 读写内存 | 读取 `productType` / `salesCode` 传给 `query_sign_status.sh`；写入 `signStatus` |
| Step 4 | 写入内存 | 设置 `collect_information.screenshot`，APP支付同时设置 `collect_information.appName`；不得在签约申请提交前采集或写入 `mobilePlatform`、`bundleId`、`appPackage`、`appSign` |
| Step 5.2 | 写入内存 | 按量付费服务注册或复用成功后设置 `service.*` |
| Step 5.3 | 读写内存 | APP支付创建新 `MOBILEAPP` 前采集 `mobilePlatform` 及对应平台字段；应用创建、复用或提审后设置 `application.*` |
| Step 6 | 读取 intention | 判断是否衔接集成流程 |
| 任意 | 读取内存 | 获取已保存的产品信息、类目信息等 |
