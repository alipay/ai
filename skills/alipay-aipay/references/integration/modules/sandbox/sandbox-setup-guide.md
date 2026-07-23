# 沙箱环境初始化指南

本文档是沙箱环境配置的**单一可信来源**。运行时 Agent 在 Unix/macOS/Linux 只执行 integration flow 登记的 `sandbox_config.sh ensure|reverify|verify|summary`；本文档中的字段表和处理顺序是脚本维护契约，不授权 Agent 对 `.alipay-sandbox.json` 运行临时 `jq`、`cat`、`grep`、`ls`、`stat` 或另写解析脚本。

---

## 1. 环境说明

### 1.1 快速沙箱优势
- ✅ **零配置启动**：无需登录支付宝开放平台，自动获取测试账号与密钥
- ✅ **即开即用**：全自动配置网关及应用信息
- ✅ **安全隔离**：测试环境不涉及真实资金，可放心调试

### 1.2 Windows 用户注意事项
**快速沙箱 CLI 工具暂不支持 Windows 系统**。

Windows 分支固定使用 `customer-messages.json` 的 `sandbox.windows.manual_setup`：执行下列命令引导用户前往支付宝开放平台控制台获取沙箱应用，并一次提供当前沙箱的 APPID、公私钥和账号信息。资料完整且校验通过后，由 Agent 写入目标项目实际使用的本地敏感配置；不得要求用户自行配置、理解 `sandbox_config.sh`、执行 Bash 或手工拼接 Skill 的规范化 JSON。该资料输入例外只适用于沙箱，生产环境应用私钥和密码禁止提供给 Agent；Agent 不得在回复、摘要或普通日志中复述收到的值。

```bash
printf '%s' '{}' \
  | node ../../../normal/scripts/render_customer_message.mjs sandbox.windows.manual_setup --variant DEFAULT
```

### 1.3 其他说明
沙箱环境暂不支持用户主动通过看板查看测试账号的交易信息（如：卖家余额、交易状态等）。**严禁**引导用户访问所谓的“支付宝沙箱网页版”查看测试账户的余额变动等。

---

## 2. 密钥格式说明

| 语言 | 私钥格式 | 使用字段 |
|------|----------|----------|
| Java | PKCS#8 | `appPrivateKey` |
| 非 Java（Python、Node.js、PHP、.NET 等） | PKCS#1 | `appPrivatePkcsKey` |

**⚠️ 防误判提醒**：
- 沙箱配置直接使用沙箱返回的对应私钥字段；生产配置必须确认应用私钥格式与项目语言匹配
- 写入 SDK 配置的私钥值都使用不带 PEM 头尾或其他前后缀的原始密钥字符串，禁止手动添加 PEM 头尾、其他前后缀、包装行或说明文字
- 生产应用私钥格式与当前语言 SDK 要求不一致时，使用支付宝开放平台密钥工具做私钥格式转换后再配置
- 禁止因 `ERR_OSSL_UNSUPPORTED` 推断私钥格式或运行时不兼容；应先检查复制污染、字段映射和 SDK 配置参数
- 详见 [SDK 说明文档 - 私钥格式](../alipay-sdk-reminder.md)

---

## 3. 沙箱初始化流程

### 3.1 获取候选沙箱配置

- Unix/macOS/Linux：运行时只执行 integration flow 的 `sandbox_config.sh ensure`；[alipay-sandbox-tool](alipay-sandbox-tool.md) 只记录脚本内部冻结的 MCP 契约和维护依据，不作为 Agent 直调入口。
- Windows：快速沙箱 CLI 工具暂不支持，按第 1.2 节完成官方申领和本机项目配置；该分支不调用 `sandbox_config.sh create|verify`，也不伪造 `FLOW:SANDBOX_CONFIGURED`。
- 工具返回 `success === true` 只代表拿到候选 `data`；必须完成第 4 节字段完整性校验后，才允许写入正式配置文件。
- `success !== true`、`data` 缺失或字段不完整时，先执行第 6 节既定重试；耗尽后进入本轮待配置状态，只阻断沙箱字段使用、摘要、配置校验和沙箱测试，不阻断代码实现。

### 3.2 脚本内部固定处理顺序

Unix/macOS/Linux 快速沙箱由 `sandbox_config.sh` 在内部完成以下动作，运行时 Agent 不逐项重做：

1. 提取候选 `data`。
2. 按第 4 节逐项校验必含字段。
3. 校验通过后，将候选 `data` 按原始 JSON 结构写入正式本地配置文件。
4. 确认配置未被 Git 跟踪、项目根目录 `.gitignore` 已包含 `/.alipay-sandbox.json` 且文件权限为 `0600`，创建阶段只输出受控机器标记和实际配置文件路径，不对客展示关键字段摘要。
5. 后续由商家服务端代码使用当前语言标准 JSON 解析器在运行时读取该文件并映射到 SDK；Agent 不通过 shell 输出字段原文，也不把沙箱密钥复制到源码或重复写入 `.env`。
6. 代码开发完成且配置后置校验通过后，再使用第 5.2 节的摘要输出入口对客展示沙箱环境配置。

Windows 手工沙箱：

1. 使用标准消息一次收集当前沙箱应用的 APPID、支付宝公钥、应用公钥、与已确认语言匹配的应用私钥和沙箱账号信息；缺失或校验失败时只补问对应字段。
2. 按第 4 节校验资料，随后由 Agent 写入目标项目实际使用的本地敏感配置；不要求采用快速沙箱 `data` 的嵌套结构，不把值复制到源码或普通日志。
3. 检查敏感配置未被 Git 跟踪，并已有适用于实际路径的版本控制忽略保护；能检查 Windows 文件访问控制时确认仅当前用户可访问，不能取得证据时标记为人工待验证。
4. 输出第 5 节规定的摘要和 Windows 提醒，再从实际本机配置映射到 SDK；Agent 不得在回复或摘要中复述用户提供的沙箱密钥和密码，生产环境应用私钥和密码禁止提供给 Agent。

Unix/macOS/Linux 快速沙箱的流程准备必须使用 integration flow 登记的 `sandbox_config.sh ensure` 入口：配置缺失时脚本内部创建，已存在时脚本内部复核；步骤 3 仅在首次准备为 `READY` 时执行 `reverify`，待配置时直接继续代码开发；代码开发完成且配置仍为 `READY` 后才使用 `summary` 展示摘要。`ensure|reverify` 会把既定重试耗尽转换为受控 `CREATE_PENDING|VERIFY_PENDING`，直接渲染统一消息并返回终态标记；Agent 不得直接选择创建分支、重复检查文件存在性或权限、读取字段结构、拼接沙箱 JSON、另写解析逻辑或自制摘要表。Windows 手工申领分支检查目标项目实际读取的本地配置，不把平台字段擅自改造成快速沙箱返回结构。

---

## 4. 字段完整性校验契约（脚本内部卡点）

Unix/macOS/Linux 由 `sandbox_config.sh` 内部逐项校验，Agent 只消费退出码和 flow 登记标记，不手工执行本节清单。Windows 没有该脚本能力时，才按目标项目实际配置逐项检查。任一必含字段缺失或为空时立即停止使用当前候选：Unix/macOS/Linux 不得写入正式 `.alipay-sandbox.json`，Windows 不得把当前本机配置标记为可用；Unix/macOS/Linux 按有限重试和待配置终态继续代码实现，Windows 仍使用登记的资料补充出口。

### 4.1 必含字段清单

以下是两条分支共同的语义要求，必须按项目语言和测试账号要求存在且非空。Unix/macOS/Linux 快速沙箱按表中的原始字段名检查；Windows 按目标项目实际配置的等价字段检查，不得为了通过校验擅自改造为快速沙箱嵌套结构：

| 字段 | 说明 |
|---|---|
| `appId` | 沙箱应用 ID |
| 应用私钥 | Java 必须存在 `appPrivateKey`；非 Java 必须存在 `appPrivatePkcsKey` |
| `alipayPublicKey` | 支付宝公钥 |
| `appPublicKey` | 应用公钥 |
| 商家账号 | 沙箱商家登录账号 |
| 买家账号 `userId` | 沙箱买家用户 ID |
| 买家账号 `email` | 沙箱买家登录账号 |
| 买家账号 `logonPassword` | 沙箱买家登录密码 |
| 买家账号 `payPassword` | 沙箱买家支付密码 |

### 4.2 脚本维护校验清单

**规则：** 任一字段缺失 → 停止使用当前候选或已有配置 → 执行有限重试 → 仍失败则记录待配置并继续代码实现；禁止继续任何沙箱依赖动作

```
□ 检查 appId
  IF 缺失：当前校验失败 → RETRY_OR_PENDING

□ 检查应用私钥（根据语言选择）
  - Java：检查 `appPrivateKey`（PKCS#8）
  - 非 Java：检查 `appPrivatePkcsKey`（PKCS#1）
  IF 缺失：当前校验失败 → RETRY_OR_PENDING

□ 检查 alipayPublicKey / appPublicKey / 商家账号 / 买家账号 userId / 买家登录账号 email / 买家账号 logonPassword / 买家账号 payPassword
  IF 任一缺失：当前校验失败 → RETRY_OR_PENDING

□ 全部通过 → 不对客输出字段核对表、字段列表、独立的“字段完整性校验通过”提示或任何“沙箱测试通过”表述；创建阶段直接进入安全落盘，只输出机器标记和实际本机配置路径。代码开发完成且配置后置校验通过后，才按第 5.2 节只输出一张沙箱环境摘要表。
```

---

## 5. 落盘与摘要输出

### 5.1 本地配置文件

Unix/macOS/Linux 快速沙箱：

- 固定写入已确认的目标项目根目录 `.alipay-sandbox.json`。目标目录不可写、`.gitignore` 不是安全普通文件或无法建立 Git 忽略保护时不得落盘或使用当前配置；`ensure|reverify` 将其记录为待配置并继续代码实现，不降级写入系统临时目录、Agent 原始工作目录或其他项目。
- JSON 文件必须保留沙箱返回的原始字段名和嵌套结构，不要转换成 `.env` 扁平键值。
- 文件权限必须限制为当前用户可读写，即 `chmod 600`；权限收紧或复核失败时不得使用配置或执行沙箱依赖动作。
- 配置不得已被 Git 跟踪；项目根目录 `.gitignore` 必须包含精确规则 `/.alipay-sandbox.json`。脚本只在缺失时追加一次，不覆盖既有内容；`.gitignore` 为符号链接或非普通文件时停止。

Windows 手工沙箱：

- 由 Agent 根据目标项目实际结构选择并写入本机敏感配置路径，不要求用户创建 `.alipay-sandbox.json` 或自行配置项目。
- 配置必须未被 Git 跟踪，并建立适用于该实际路径的忽略保护；不得因为 Windows 不使用 POSIX `0600` 而声称完成了该权限检查。
- 只有实际检查到的字段才能进入后续 SDK 映射；无法自动核验的 Windows 文件访问控制或平台页面信息必须标记为人工待验证。

Unix/macOS/Linux 创建阶段只输出实际本机配置路径和 `FLOW:SANDBOX_CONFIG_READY` 机器标记；不展示账号、密码、公钥或摘要。Windows 手工分支完成后输出实际本机配置路径。两条分支在代码开发完成且配置后置校验通过后，才进入摘要展示。

### 5.2 对话摘要

代码开发完成且配置后置校验通过后，Unix/macOS/Linux 从本文件所在的 `references/integration/modules/sandbox/` 目录使用 `bash ../scripts/sandbox_config.sh summary "<productType>" "<规范化项目路径>" "<已确认服务端语言>"` 复核并展示摘要；该脚本内部负责渲染 `sandbox.environment.summary` 与 `sandbox.environment.reminder`，Agent 不得绕过脚本自写摘要。Windows 使用同一消息目录从项目实际读取的本机配置生成摘要，执行：

```bash
MESSAGE_INPUT_JSON=$(jq -cn \
  --arg productName "$PRODUCT_NAME" \
  --arg configPath "$CONFIG_PATH" \
  --arg environmentRows "$ENVIRONMENT_ROWS" \
  '{productName:$productName,configPath:$configPath,environmentRows:$environmentRows}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../../../normal/scripts/render_customer_message.mjs sandbox.environment.summary --variant DEFAULT
printf '%s' '{}' | node ../../../normal/scripts/render_customer_message.mjs sandbox.environment.reminder --variant WINDOWS
```

摘要行按当前分支的实际来源依次包含应用 `appId/pid`、商家账号、买家账号及沙箱标识；账号未返回的可选字段直接省略，禁止编造。只有 Unix/macOS/Linux 快速沙箱工具实际返回且已校验的沙箱登录密码和支付密码可以进入摘要行；Windows 手工沙箱虽然允许用户在资料收集时提供当前沙箱密码，Agent 仍不得在摘要或后续回复中复述，只展示非敏感标识和本机保存提示。两类例外都不得扩展到生产环境账号、私钥或密码。

renderer 固定输出唯一摘要表、密钥字段已落盘提示和“配置不等于测试通过”的边界。禁止另写字段核对表、独立校验结论，或把表名、前后提示改成“沙箱环境校验通过”“沙箱测试通过”“沙箱环境测试通过”。

### 5.3 配置准备完成后提示（卡点）

输出 `sandbox.environment.summary` 后立即渲染 `sandbox.environment.reminder`：Unix/macOS/Linux 快速沙箱由 `sandbox_config.sh summary` 内部使用 `DEFAULT`；Windows 手工沙箱执行上方 `WINDOWS` 命令。该消息统一维护测试资金边界、本地文件与仓库安全、同一套生产密钥、私钥格式、沙箱/生产网关和按量付费 `api_mock_service_id` 替换提醒；不得在本文件或 Agent 回复中维护第二份近似话术。创建阶段不得提前渲染本提醒。

### 5.4 沙箱对客展示白名单

沙箱字段只能按下表进入对客消息；表外字段只能用于本机配置、SDK 初始化或内部校验，不得由 Agent 手写输出。

| 场景 | 可对客展示 | 禁止对客展示 |
|---|---|---|
| Unix/macOS/Linux 快速沙箱摘要 | `sandbox_config.sh summary` 实际渲染的应用 `appId/pid`、商家 `userId`、买家 `userId/email/logonPassword/payPassword`、`sandboxId`、配置文件目录 | `appPrivateKey`、`appPrivatePkcsKey`、`alipayPublicKey`、`appPublicKey`、原始 `.alipay-sandbox.json`、完整 MCP 响应 |
| Unix/macOS/Linux 网站支付付款体验 | 已校验的沙箱买家登录账号、登录密码、支付密码，以及实际支付页面地址和启动命令 | 商家密码、任何公钥/私钥原文、完整支付表单、签名串 |
| Windows 手工沙箱 | 配置文件目录、非敏感应用/账号标识、官方控制台获取与本机配置完成提示 | 用户提供的应用私钥、支付宝公钥、应用公钥、沙箱账号密码原文 |
| 按量付费自动联调 | 受控结论、付款链接和沙箱买家可选体验入口 | `Payment-Proof`、`Payment-Validation` 原文、完整收银请求、临时产物路径中的敏感内容 |

只有 `sandboxCredential` 类型变量可以承载快速沙箱买家登录密码和支付密码；该例外不适用于生产账号、生产密码、应用私钥、公钥、token、签名串或 Payment-Proof。

### 5.5 网站支付沙箱付款提示（代码生成后、集成收尾前）

网站支付代码生成和配置后置校验完成后，先从已确认的目标项目脚本、路由和运行配置中确定真实的服务启动命令和支付页面访问地址，再按回跳分支处理：

- **默认分支**：用户未明确关闭同步回跳时，确认 SDK 实际使用的 `return_url`。启动服务并 GET 访问不带支付结果参数的该地址，只验证路由和页面壳；无订单上下文时应展示安全的中性状态，不得放宽真实回跳请求的验签和订单归属校验。确认无 404、认证或重定向循环，且单页应用直接刷新可用；当前 Agent 具备浏览器/UI 能力时验证页面正常渲染，否则只记录 UI 人工待验证，不追加用户确认。
- **渲染验证**：Agent 具备浏览器/UI 能力时，打开回跳页确认非空白、无可见报错且关键内容正常渲染；不具备时，请用户打开精确地址确认。未取得证据时不得宣称回跳页已验证或网站支付代码开发完成。
- **关闭分支**：用户已明确表示不使用同步回跳时，不要求或猜测 `return_url`；确认 SDK 请求未传该字段，并验证异步通知、交易查询和商户订单查询页。用户未明确关闭时，缺少 `return_url` 必须修复为默认同步回跳分支。

完成对应分支校验后按系统渲染：Unix/macOS/Linux 快速沙箱使用 `webpay.sandbox.experience`，传入工具实际返回并已校验的买家账号、登录密码、支付密码、项目启动命令、浏览器支付页面地址和当前回跳分支说明；Windows 手工沙箱使用 `webpay.sandbox.experience.windows`，只传启动命令、浏览器支付页面地址和回跳分支说明，密码由用户从已保存的本机配置或支付宝开放平台控制台取得，Agent 不在付款指引中复述。不得使用示例端口、占位 URL 或猜测地址；任一必需值无法确定时不渲染半模板，指出缺失项并标记为人工待补充。

`curl` 调用下单接口并取得 HTML 支付表单只属于接口冒烟检查，不能替代用户付款指引，也不能据此标记步骤 6 完成。必须提供用户可在浏览器中打开的支付页面地址；页面打开沙箱收银台后，以下两种体验方式同时告知用户，由用户自行二选一。

紧接当前系统对应的网站支付付款指引渲染 `sandbox.android.client`，统一输出 Android-only、官方直链、直链/页面二维码失败后的开放平台沙箱工具页，以及禁止 iOS、应用市场、第三方站点和自编 URL 的口径。

`resultPageInstruction` 必须按实际回跳分支二选一，禁止同时输出两项：

- **默认分支**：“付款后确认浏览器自动返回商户结果页，页面可正常展示并通过服务端查询呈现订单状态。”
- **关闭分支**：“付款后不会自动返回商户网站；请手动返回商户订单查询页并刷新或查询订单状态。”

两个分支都必须继续提醒：前台页面或同步回跳参数不是支付成功依据，最终结果以验签通过的异步通知或交易查询结果为准。异步通知只有在 `notify_url` 可被支付宝服务器公网访问时才能联调；当前仅有本地或局域网地址时，将该项标记为人工待验证，并明确当前结论属于“本地正式验收 / 本地生产参数验收模式”，不是生产上线完成。

**下载渠道红线：**
- 严禁声称 iOS 支持安装沙箱版支付宝。
- 严禁引导用户前往应用市场、搜索引擎或第三方站点搜索下载。
- 如果上述直链或页面二维码无法使用，只能引导用户前往支付宝开放平台沙箱工具页 `https://open.alipay.com/develop/sandbox/tool`，按页面指引安装。

---

## 6. 红线与失败处理

### 6.1 绝对禁止

1. 禁止编造、拼接、模拟、猜测缺失字段。
2. 禁止用占位符或示例假数据冒充真实返回值。
3. 禁止假设“工具返回的应该都有”而跳过逐项校验。
4. 禁止字段不完整时使用当前配置、写入正式 `.alipay-sandbox.json`、执行配置后置校验或沙箱测试；允许继续不读取沙箱字段的代码实现，最终必须标记沙箱配置未完成。
5. Windows 只允许用户在标准资料收集消息后提供当前沙箱密钥和账号信息，Agent 不得在回复、摘要或日志中复述；Unix/macOS/Linux 只允许按登记消息展示已校验的快速沙箱买家密码。禁止展示生产环境应用私钥、账号密码或把任何密钥长字段整段刷屏输出。
6. 禁止继续使用已被 Git 跟踪的沙箱敏感配置。Unix/macOS/Linux 快速沙箱还必须具备 `/.alipay-sandbox.json` 精确忽略规则；Windows 必须具备适用于实际本机敏感配置路径的忽略保护。

### 6.2 快速沙箱重复创建边界

- 候选 `data` 的校验、原子落盘和权限复核全部由同一次 `sandbox_config.sh ensure` 调用完成，Agent 不读取或自行恢复原始工具输出。
- 配置已经存在时，`ensure` 必须进入 `verify`，不得重复创建、覆盖或要求用户删除配置。
- 创建调用失败时由脚本执行既定网络/服务重试；候选字段或已有配置字段复核失败时最多自动重试 2 次、每次间隔 3 秒。耗尽后由脚本输出待配置消息并继续代码实现，不增加用户确认，也不得绕过脚本直调 MCP。

### 6.3 重试与失败处理

| 失败场景 | 处理策略 |
|---------|---------|
| 创建失败且既定重试耗尽 | `ensure` 使用 `sandbox.configuration.pending/CREATE`，记录 `CREATE_PENDING` 并继续代码实现；代码开发完成后固定提醒用户可对 Agent 说“重新创建并配置沙箱” |
| 候选字段或已有配置字段复核失败 | 最多自动重试 2 次、每次间隔 3 秒；仍失败时使用 `sandbox.configuration.pending/CREATE|VERIFY` 并继续代码实现，不展示原始字段或响应 |
| 待配置状态 | 跳过摘要、配置后置校验、按量付费联调和网站支付付款体验；最终 checklist 保持部分通过或未通过，不得宣称代码开发全部通过或生产就绪 |
| Windows 手工申领资料或本地项目配置校验未通过 | 使用 `sandbox.create.failure/WINDOWS`；按第 4 节逐项校验，只补问或更正实际缺失、错误字段后由 Agent 更新本机配置，不要求用户执行 Skill 内部脚本，不伪造快速沙箱结果，也不调用快速沙箱重建 |

本模块不维护失败话术副本；Unix/macOS/Linux 待配置正文由 `sandbox.configuration.pending` 固定维护，Windows 缺失字段和恢复动作仍通过 `sandbox.create.failure/WINDOWS` 的受控变量传入。

---

## 7. 接入项目后的后置校验

只有本轮沙箱配置为 `READY` 时，后续步骤才把可信配置接入用户项目并立即做配置准确性后置校验；校验失败时停止联调并修正服务端加载器或 SDK 配置。待配置时只实现会在缺少有效配置时明确失败的加载边界，不读取、复制或伪造沙箱字段。

- Unix/macOS/Linux 确认服务端加载器直接读取第 5.1 节的实际 `.alipay-sandbox.json`，从同一 `appIds[0]` 映射 `appId`、应用私钥和支付宝公钥；禁止从对话、历史代码或示例值复制，禁止用 shell 把字段原文输出后再粘贴。Windows 确认项目读取同一套本机沙箱应用配置。
- 检查加载器没有截断、替换、包装或重新编码字段；项目源码、普通日志和额外 `.env` 中不存在沙箱密钥副本。
- 检查 SDK 配置与私钥字段匹配：`appPrivatePkcsKey` 对应 PKCS#1，`appPrivateKey` 对应 PKCS#8。
- 检查 SDK 实际接收的私钥值不包含 PEM 头尾、其他前后缀、包装行或说明文字；业务协议直接使用原生密码库签名时，可按密码库要求临时适配调用入参，但不得修改或覆盖原始配置值。
- 仅按量付费沙箱联调：项目沙箱运行配置中的 `serviceId` 固定为 `api_mock_service_id`，不从快速沙箱返回中寻找，也不向用户索要正式 `serviceId`。该值不得进入生产配置。
- 校验输出不得包含私钥、公钥、签名串或完整支付表单。

**常见失败处理：**
- 私钥不完整、配置不一致或 SDK 初始化/签名失败：检查实际配置路径、JSON 字段映射和 SDK 入参，禁止打印私钥、补字符、猜测或格式转换。
- `ERR_OSSL_UNSUPPORTED`、`DECODER routines::unsupported` 等错误：优先检查项目读取值是否与沙箱原值一致、字段映射是否正确、SDK 配置是否被加工；不要切换私钥字段或在缺少对照证据时归因于运行时、OpenSSL 或 SDK 兼容性。
