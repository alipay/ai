# 公共沙箱配置指南

VibePay（网页、App 收款）、MachinePay 和 TokenPay 周期订阅共用本模块的基础配置获取、校验、保存和复用能力；调用登记、通知、下单及业务验收仍由各产品处理。TokenPay 周期订阅仅用它替换浏览器获取基础凭据的步骤，不接入收单产品的对客摘要、提醒或待配置消息。TokenPay 其他业务能力不因本模块而自动获得沙箱支持。

## 1. 入口和环境

确认目标项目与本次执行任务后，通过 `references/normal/scripts/runtime.mjs sandbox` 调用。创建配置不依赖工程语言或构建标识。旧语言位置参数仅为调用兼容，不参与配置裁剪或创建请求。

```sh
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" sandbox ensure "<项目绝对路径>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" sandbox reverify "<项目绝对路径>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

沿用任务的 run/session 参数；有明确 run ID 时附加 `--telemetry-run-id`，不能用命令参数伪造活动任务。TokenPay 仍从其自身执行入口按[阶段规则](../../normal/telemetry.md)建立 `token-subscription` 任务，不走收单 bootstrap。`summary` 仅供收单产品使用，见第 6 节。

Unix/macOS/Linux 或 Windows READY 在缺少配置时调用 alipay-cli。先按现有任务级 CLI 准备流程执行 `runtime.mjs env integration-check`；缺 jq 时走既有 `env prepare-jq`，CLI 准备失败按 `normal/alipay-cli-env.md` 恢复。Windows 调用附加当前 `--windows-route`；周期订阅也可使用 `windows-entry --root-intent integration_only --product-type token-subscription` 完成环境分流。

Windows LEGACY/CODE_ONLY 不自动创建。对已有标准文件，`ensure|reverify|verify` 可通过原生 Node 复核，无文件时 `ensure` 返回待配置；这不代表创建能力已恢复。VibePay / MachinePay 的手工配置仍按[集成流程](../flow.md)写入项目实际配置、原位复核并使用原有 Windows 摘要入口，不强制改为标准 JSON 或补齐两种私钥；用户未主动提供资料且未明确要求当前配置时继续代码开发。TokenPay 不接入这些收单资料收集和摘要消息。

## 2. 获取与使用的边界

CLI 创建请求固定为 `alipay-anonymous-sandbox.createAnonymousSandbox`、`{"request":{"appType":"PUBLICAPP"}}`，不传语言或产品；保留 `PLATFORM`、`PLATFORM_ID` 和 `ALIPAYCLI_BIZ_INFO`，清除 `PRODUCT`。[底层协议](alipay-sandbox-tool.md)仅供维护，Agent 不直接重做创建。

公共模块保存返回的完整 `data`，包括两种私钥、买家和卖家资料及额外元数据。以下仅为现有接入方式的字段映射，服务端按原有 SDK/签名逻辑消费，不因为共用配置而更换密钥或增设 Go 包装流程：

| 现有接入方式 | 私钥格式 | 字段 |
|---|---|---|
| Java SDK | PKCS#8 | `appIds[0].appPrivateKey` |
| 现有收单 Python、Node.js、PHP、C#/.NET SDK 约定 | PKCS#1 | `appIds[0].appPrivatePkcsKey` |
| TokenPay 当前 Go 周期订阅示例 | PKCS#1 | `appIds[0].appPrivatePkcsKey` |

已有项目明确使用另一种 SDK 支持的格式时沿用该约定。例如已配置 PKCS#8 的 Node.js 项目继续读取 `appPrivateKey`。头尾处理属于原有接入代码，公共模块原样保存字段。

## 3. 初始化、复用与状态

公共模块只处理项目根 `.alipay-sandbox.json`，不探测、导入或修改旧 `.env`、密钥文件和历史交付记录。

`ensure` 按以下顺序执行：

1. 标准文件存在：复核必需字段和文件保护；不会删除或重建。
2. 标准文件不存在：Unix/macOS/Linux 或 Windows READY 通过 CLI 获取完整候选，全部校验通过后独占落盘。并发准备使用项目锁，不覆盖另一进程的配置；残留锁需确认原进程已结束后再处理，禁止盲目移除。

| 内部标记 | 含义和下一步 |
|---|---|
| `SANDBOX_ENSURE_ACTION=CREATED|VERIFIED` 与 `FLOW:SANDBOX_CONFIG_READY` | 基础配置可用；只从对应实际 `SANDBOX_CONFIG_PATH` 加载 |
| `FLOW:SANDBOX_CONFIG_PENDING_CREATE` | 创建未完成，可继续独立代码实现 |
| `FLOW:SANDBOX_CONFIG_PENDING_VERIFY` | 标准文件无效，修复后复核 |
| `FLOW:SANDBOX_CONFIGURED` | 仅收单产品：复核通过且已生成摘要，不代表业务联调成功 |

标记均位于带 `ALIPAY_AIPAY_INTERNAL:` 前缀的 stderr；`SANDBOX_PENDING_REASON` 仅提供受控错误类别，不改变 pending 终态；`SANDBOX_PENDING_PATH` 只是预期路径。`ensure|reverify` 退出 0 也可能是 pending，必须检查终态。严格 `create|verify|summary` 失败返回非 0，不手写消息兜底。

周期订阅的配置调用无论 READY 还是 pending，均不输出对客正文或 `CUSTOMER_MESSAGE_DELIVERY_REQUIRED`。内部状态供订阅流程继续执行或记录阻塞，不对客转发内部标记、配置路径和凭据；任务进度及阻塞仍按原有订阅流程反馈。

保留既有网络/服务临时错误的有限重试及证书密钥临时错误的单次重试；创建候选缺字段最多尝试三次。既有文件校验失败、Git 跟踪或 CLI 已执行后出现本地状态权限错误、响应无法唯一解析时均不得通过重复创建修复。受控原因仅含错误类别、缺失字段名及服务端可公开的错误码/traceId，不含凭据值或完整响应。

## 4. 必需字段检查

沿用原脚本的非空字符串检查，由 `sandbox_config_core.mjs` 统一执行；CLI 公共配置对所有产品要求相同：

| 必含内容 | 检查 |
|---|---|
| `appIds[0].appId` | 非空字符串 |
| `appPrivateKey`、`appPrivatePkcsKey` | 两个字段均为非空字符串，原样保存 |
| `appPublicKey` | 非空字符串 |
| `alipayPublicKey` | 非空字符串 |
| `sandboxAccounts.partner.userId` | 非空字符串 |
| `sandboxAccounts.user.userId/email/logonPassword/payPassword` | 四项均为非空字符串，TokenPay 暂不消费也全部保存 |

其他 CLI 字段原样保留。沙箱网关是公共常量 `https://openapi-sandbox.dl.alipaydev.com/gateway.do`，不是 CLI 返回字段，不为它改变原始 data 结构。`notify_url`、`return_url`、端口和业务资源 ID 仍归产品项目管理。

任一必需字段缺失或为空均不得返回 READY。本层不增加密钥解析、配对、ID 格式或 PID 一致性检查；SDK 初始化、签名与实际业务结果仍由既有接入流程验证。

## 5. 保存和加载

### 5.1 CLI 公共配置

固定保存为项目根 `.alipay-sandbox.json`，直接保存 `data`，不增加外层包装。Unix 权限为 `0600`；Windows 检查普通文件可访问，不要求精确 NTFS ACL 白名单。拒绝符号链接、非普通文件和 Git 已跟踪路径；追加 `/.alipay-sandbox.json` 与 `/.alipay-sandbox.*` 忽略规则，不覆盖原 `.gitignore`。临时文件写完并同步后独占发布，失败不留下有效配置半成品。

服务端从明确的项目根或固定绝对路径加载，不能偶然依赖启动 cwd。沙箱 APPID/PID/密钥只从该文件读；配置缺失即失败，不回退到旧 `.env`、示例值、生产凭据或另一套应用。现有语言标准 JSON 加载器映射对应字段即可，不能将凭据复制到源码或前端。

### 5.5 网站支付沙箱付款提示（代码生成后、集成收尾前）

网站支付代码生成和配置后置校验完成后，先从已确认的目标项目脚本、路由和运行配置中确定真实的服务启动命令和支付页面访问地址，再按回跳分支处理：

- **默认分支**：用户未明确关闭同步回跳时，确认 SDK 实际使用的 `return_url`。启动服务并 GET 访问不带支付结果参数的该地址，只验证路由和页面壳；无订单上下文时应展示安全的中性状态，不得放宽真实回跳请求的验签和订单归属校验。确认无 404、认证或重定向循环，且单页应用直接刷新可用；当前 Agent 具备浏览器/UI 能力时验证页面正常渲染，否则只记录 UI 人工待验证，不追加用户确认。
- **渲染验证**：Agent 具备浏览器/UI 能力时，打开回跳页确认非空白、无可见报错且关键内容正常渲染；不具备时，请用户打开精确地址确认。未取得证据时不得宣称回跳页已验证或网站支付代码开发完成。
- **关闭分支**：用户已明确表示不使用同步回跳时，不要求或猜测 `return_url`；确认 SDK 请求未传该字段，并验证异步通知、交易查询和商户订单查询页。用户未明确关闭时，缺少 `return_url` 必须修复为默认同步回跳分支。

完成对应分支校验后按系统渲染：Unix/macOS/Linux 与 Windows READY 快速沙箱使用 `webpay.sandbox.experience`，传入已校验的沙箱买家账号、登录密码、支付密码、实际项目启动命令、浏览器支付页面地址和当前回跳分支说明；Windows LEGACY/CODE_ONLY 手工沙箱使用 `webpay.sandbox.experience.windows`，只传实际启动命令、浏览器支付页面地址和回跳分支说明，密码由用户从已保存的本机配置或支付宝开放平台控制台取得，Agent 不在付款指引中复述。不得使用示例端口、占位 URL 或猜测地址；任一必需值无法确定时不渲染半模板，指出缺失项并标记为人工待补充。

`curl` 调用下单接口并取得 HTML 支付表单只属于接口冒烟检查，不能替代用户付款指引，也不能据此标记步骤 6 完成。必须提供用户可在浏览器中打开的支付页面地址；页面打开沙箱收银台后，以下两种体验方式同时告知用户，由用户自行二选一。

紧接当前系统对应的网站支付付款指引执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message sandbox-android-client --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`，统一输出 Android-only、官方直链、直链/页面二维码失败后的开放平台沙箱工具页，以及禁止 iOS、应用市场、第三方站点和自编 URL 的口径。

`resultPageInstruction` 必须按实际回跳分支二选一，禁止同时输出两项：

- **默认分支**：“付款后确认浏览器自动返回商户结果页，页面可正常展示并通过服务端查询呈现订单状态。”
- **关闭分支**：“付款后不会自动返回商户网站；请手动返回商户订单查询页并刷新或查询订单状态。”

两个分支都必须继续提醒：前台页面或同步回跳参数不是支付成功依据，最终结果以验签通过的异步通知或交易查询结果为准。异步通知只有在 `notify_url` 可被支付宝服务器公网访问时才能联调；当前仅有本地或局域网地址时保留上线前提醒，不单独记为本轮人工待验证。生产可省略 `notify_url`，但必须验证服务端可靠主动查单、持久化幂等及后台重试；当前本地验收不等于生产上线完成。

**下载渠道红线：**
- 严禁声称 iOS 支持安装沙箱版支付宝。
- 严禁引导用户前往应用市场、搜索引擎或第三方站点搜索下载。
- 如果上述直链或页面二维码无法使用，只能引导用户前往支付宝开放平台沙箱工具页 `https://open.alipay.com/develop/sandbox/tool`，按页面指引安装。

---

## 6. 收单产品的对客摘要

本节仅适用于 VibePay / MachinePay 的 CLI 公共配置。Windows LEGACY/CODE_ONLY 手工资料继续使用集成流程中的 `integration-message windows-sandbox-summary`，不强制套用本节的标准文件入口。代码开发与配置后置校验完成后才执行 `summary`，`productType` 为 `aipay|webpay|apppay` 且必须与当前活动任务相同：

```sh
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" sandbox summary "<productType>" "<项目绝对路径>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

- `webpay`：展示已校验的测试买家账号、登录密码和支付密码，保持网页付款及最终回放契约。
- `aipay|apppay`：保留摘要结构，两个密码显示“已写入本地配置文件，默认不在对话中展开”。
- 不输出私钥、公钥正文、完整 JSON 或 CLI 响应。

收单产品由该入口渲染 `sandbox.environment.summary` 和 reminder，Agent 原文交付 stdout，不自制摘要或额外读取文件展示。创建成功的 stdout 保持静默。

TokenPay 周期订阅不执行 `summary`，不新增沙箱信息展示步骤；取得配置后继续自身的调用登记、通知和联调流程。

## 7. 接入项目后的后置校验

仅配置就绪后执行；配置缺失时继续独立代码开发，依赖配置的验证保持未完成。

- 确认项目实际加载同一套配置，字段选择与原有 SDK/签名实现匹配；失败时修正加载器或 SDK 入参，不改写原始值。
- 确认配置未进入版本控制、前端或普通日志；不复制密钥到源码或额外 `.env`。Windows 手工分支沿用实际配置路径。
- MachinePay 的沙箱 `serviceId` 仍固定为 `api_mock_service_id`，不从 CLI 返回中查找，不用于生产。
- VibePay 沿用网页回跳、异步通知、查询和付款体验检查；TokenPay 沿用调用登记、通知接入和内置沙箱 CLI 的模拟付款、续费、退款、协议及测试时钟流程。字段齐全不表示这些业务验证已通过。
