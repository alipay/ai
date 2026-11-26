<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_CORE:START -->
# 支付产品-代码开发流程

本 flow 的 Windows READY/LEGACY/CODE_ONLY 指根入口的唯一兼容环境分流事实，或 Windows 环境文档明确修复后唯一、根意图匹配的新 READY 事实；BLOCKED 停在环境恢复点，不进入本 flow。后续命令附加当前有效的 `--windows-route`。Windows READY 通过 Git Bash 执行登记的快速沙箱脚本；Windows LEGACY/CODE_ONLY 保留原 Node 独立开发和手工沙箱分支。三者都由当前 Agent 串行执行，不启用 Integration Worker。Windows 沙箱项目配置不要求精确 NTFS ACL 白名单；仍校验字段、项目实际加载路径及防误提交。登录凭据与生产配置沿各自动作的保护规则处理。CODE_ONLY 允许 `integration_only/full_process` 在可选工具故障时继续代码开发，沙箱默认 `VERIFY_PENDING`，用户主动提供完整有效手工资料并完成项目配置校验后可记 `READY`；配置就绪不改变环境分流，各测试仍须满足自身实际依赖。完整接入完成代码部分且通过原交接校验后，CODE_ONLY 只允许平台入口交付官网开通指引，不执行本地 Onboarding。根意图变化必须重跑 Windows 入口。

> ⚠️ **前置声明**：本 flow 仅支持 **AI 网页应用收款、AI 移动应用收款、AI 按量付费**三种产品的集成。原有“网站支付”“APP 支付”“按量付费”仍作为输入别名和资源目录名。**其他产品（当面付、订单码支付、JSAPI支付、预授权支付、商家扣款等）暂不支持**，如需集成请前往[支付宝开放平台](https://open.alipay.com/)查阅相关文档。

---

## 按步读取

禁止整份预读，通过当前 Skill 的统一 runtime 按 marker 加载阶段时，每次都传已确定的 `--product-type "$PRODUCT_TYPE"`，本 flow 仍是唯一执行依据：`entry`；项目与技术栈唯一后 `prepare`；非阻塞方案送达后按步骤 2 完成执行者分流，再由确定的执行者加载 `development --product-type "$PRODUCT_TYPE"`；其后依次加载 `implementation`、`verification`、`acceptance --product-type "$PRODUCT_TYPE"` 和 `checklist --product-type "$PRODUCT_TYPE" --project-path "$PROJECT_PATH"`。统一单命令规则继承 `runtime-entry.md`；用户项目命令仍以已确认项目根为 workdir。未到阶段、无关产品/语言、维护说明和模块不得提前读取，原 flow 保留完整规则供校验。

步骤 1 只有 `CLI_ENV:NEEDS_SETUP` 才读 `../normal/alipay-cli-env.md`；步骤 2 沿用根入口已确定的产品；沙箱正常路径只执行已封装脚本，协议异常或用户要求解释时才读沙箱指南；步骤 4 只按 `integration_context_runner.mjs` 的当前产品/语言事实读取 SDK、本地契约和示例，不读取接口索引本身；步骤 6 仅按量付费读 A2M 沙箱模块；步骤 8 由 loader 直接附带当前产品适用 checklist，禁止再读取整份 `modules/acquiring/checklist.md`。

---

## ⛔ 强制执行要点

先确认唯一项目和服务端语言，再按入口已确认的产品执行步骤 1；匿名沙箱不传 `PRODUCT`，缺失时创建、存在时复核，待配置只阻止沙箱依赖动作。步骤 2 的完整方案可见送达前不得改代码；送达后按步骤 2 完成执行者分流，再由确定的执行者按同一产品、项目和技术栈开工，不再执行方案 receipt 或项目快照二次校验。`integration_only/full_process` 共用检查器事实和非阻塞 `integration.start.confirm`，一次只开发一个产品。网站支付/APP 支付必须实现下单、查询、退款、退款查询、关闭和异步通知；按量付费只实现 402、验付和履约确认。本流程不主动发起真实生产交易。

生产 `appId`、应用公钥、应用私钥和支付宝公钥必须属于同一生产应用，私钥格式必须匹配当前语言，格式转换只用支付宝官方密钥工具。网站支付/APP 支付必须同时实现通知处理和交易查询；缺少 notify_url 时下单省略该字段并由服务端主动查单兜底，不会仅因缺少该地址而报错，也不因此将本轮校验判为失败；`notify_url` 可选，生产也可省略。使用通知时验证公网 HTTP/HTTPS 地址、验签、关键字段、幂等、`success` 回写及补偿查询；不使用时验证商家服务端可靠主动查单、响应验签、订单/金额/状态/归属校验、持久化幂等、后台重试及未决订单恢复。未验证所选链路前不得宣称生产就绪。

### 标准消息执行规则

继承已加载的 `runtime-entry.md` 对客 stdout、内部行、schema/renderer fallback 和统一单命令规则。动作有 runner/script 时只执行动作处完整命令，禁止拆回 `jq/printf/renderer` 或追加管道；失败停步且不手写兜底，终态满足即转移。统一 runtime 不依赖 cwd；项目命令只以 runner 确认的规范化项目根为 workdir。

### 耗时事件规则

`start-run` 已确定 `RUN_ID`；stage 由登记动作按全局遥测设置记录和交付，Agent 不重复手工上报。每个会生成 stage 的命令前回顾当前可见用户消息得到 `HISTORY_COUNT`，并传入下文登记的两个 gateway 内部参数；无法可靠回顾时用 `null`。遥测失败不改变业务、卡点或对客交付；诊断只按需读 `../normal/telemetry.md`。

### 服务声明执行护栏

服务声明只在 `integration.start.confirm` 三个变体维护；两种执行模式复用同一消息和项目事实，步骤 2 不得另行缩写、总结或拼接。快速沙箱凭据仍受 `P-SANDBOX-CREDENTIAL-EXCEPTION` 约束。

---

## 用户阻塞点索引

<!-- GENERATED:INTEGRATION-GUARDS:START -->
共享护栏：`P-MCP-CONTRACT-FROZEN` 仅用已验证脚本；禁推断或尝试近似方法；`P-SANDBOX-CREDENTIAL-EXCEPTION` Unix/macOS/Linux 与 Windows READY 已校验快速沙箱买家密码按既有登记摘要/付款体验展示；Windows LEGACY/CODE_ONLY 手工资料用于受保护项目，仅网页收款登记摘要可明文展示买家密码；最终收口仅网页收款三项买家信息；其他原文禁复述、另存或扩展到生产值；`P-SENSITIVE-STATE` 公钥限当前 app 调用且禁复述/保存；敏感值禁入回复/摘要/日志/状态/宽权限文件；临时 URL 仅由登记动作展示；`P-PROJECT-PROTECT` 禁清空/覆盖/删除既有项目；仅改已确认路径和范围；`P-CUSTOMER-OUTPUT-EXCLUSIVE` 登记 stdout 原文是唯一正文；阻塞送达后立即等待；`P-DETERMINISTIC-HANDOFF` 仅执行登记命令并按唯一终态转移；禁追加解析；失败只走登记恢复。
<!-- GENERATED:INTEGRATION-GUARDS:END -->
<!-- GENERATED:INTEGRATION-GUARDS-AIPAY:START -->
共享护栏：`P-A2M-SANDBOX` A2M 沙箱固定 api_mock_service_id 与沙箱网关；生产值仅用于正式配置；`P-A2M-SUCCESS` 联调仅在 HTTP 200、资源可归属、无业务失败且适用回执有效时通过。
<!-- GENERATED:INTEGRATION-GUARDS-AIPAY:END -->

代码开发方案不再构成阻塞确认点。产品或任务不明时回根入口；只有项目路径或技术栈不明才在步骤 1/2 使用登记消息补齐；事实完整且唯一时展示方案并自动推进。用户另行要求删除具体文件时，仍执行下方破坏性操作二次确认。

> 步骤 6 中，按量付费沙箱测试是沙箱配置就绪后默认自动执行的完成质量门；网站支付在沙箱配置就绪时必须在收尾前向用户提供人工沙箱付款入口和操作说明，但不强制用户当场付款；APP 支付跳过步骤 6。沙箱为 `CREATE_PENDING|VERIFY_PENDING` 时跳过全部沙箱依赖动作，不增加用户确认。步骤 8 的代码开发校验默认自动执行，不作为可选阻塞确认；无法自动验证的项目必须逐项标记为人工待验证。步骤 1 的沙箱字段完整性校验只证明配置可用，不是沙箱支付测试，三类产品都不得据此输出“沙箱测试通过”或等价结论。

---

## 完成条件规则

每条完成条件使用正文中的唯一稳定 ID，并在步骤 8 按当前产品和本轮实际证据逐项检查。新增、删除或调整条件时同步正文与 `modules/acquiring/checklist.md`，不维护“共有 N 项”或步骤数量索引。缺失证据固定为待验证，禁止为了结束流程推断通过。

---

## 📖 接口契约路由

当前产品的本地契约、示例路径和官方 `sourceUrl` fallback 入口见 `modules/acquiring/interface-guide.md`。在线文档只在本地依据缺失、字段不确定、排查官方错误码、用户明确要求或官方能力变化时读取。

---

## 功能路由

根据用户意图判断：

| 用户意图 | 处理方式 |
|----------|----------|
| 需要开发支付产品代码 | 进入支付产品-代码开发流程 |
| 代码开发中遇到报错 | 进入问题排查流程 |

---

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_CORE:END -->

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_ENTRY:START -->
## 支付产品-代码开发流程

### 目标项目执行上下文

步骤 1 前先确定唯一项目根和服务端语言，所有项目检测、安装、写入、启动和校验都以该目录为 workdir。保留原始 `PROJECT_INPUT`；新项目含名称或位置时由 Agent 解析 `PROJECT_PATH` 并显式传入，runner 只校验，不解析原话或把整句当目录；纯默认新建也先选安全路径。复用项目未知时先定位候选，“当前项目/当前目录”仅在 runner 识别为项目根时接受。所有路径经统一 runtime 的 `resolve-project`/`locate-projects` 取得规范化事实；Skill 自有文件仍从当前 Skill 目录读取。禁止改用方便的其他项目或把临时产物算作目标项目产物。

- `full_process`：步骤 1 前置准备先继承 `../normal/full-process-routing.md` 已选定的项目来源、规范化项目路径和服务端语言，此时沿用已知产品，代码开发启动方案尚未展示，不要求用户提供代码状态；产品确定、项目扫描并完成唯一方案展示后，进入步骤 2 时继承同一摘要中的目标产品、项目选择分类、目标产品集成状态、其他支付产品、语言和框架。两个阶段都不得重新猜测或静默改选项目。
- `integration_only`：优先从当前可访问业务项目确定根目录；当前目录不是可识别项目根、存在多个候选或用户要求其他/新项目时，先让用户选定并确认规范化路径，不得自行选择或扫描上层大目录。当前目录内已选定的现有项目分类为 `CURRENT_PROJECT`，用户指定的其他现有路径分类为 `OTHER_PROJECT`；本轮按下条规则初始化成功的新项目在完成步骤 1 后分类为 `PREPARED_NEW_PROJECT`。该分类只用于本轮检查器输入，不持久化。
- 已有项目：进入任何写操作前确认目标路径可读、在当前 Agent 权限范围内可写、包含可识别项目根标记，且仍对应用户选定的业务项目；需要环境文件权限时按当前权限机制申请，无法取得权限、路径失效或实际项目不符时停止，要求用户提供可访问路径或重新选择项目。完整保留项目结构、已有文件和其他支付能力，只对当前目标产品需要的位置做可审查的局部修改，禁止先删除文件再重建。
- 新项目：Agent 确定 `PROJECT_PATH`，`PROJECT_INPUT` 保留原话；runner 只调用 `prepare-new`，缺 `--project-path` 则未解析，禁止从原话猜测路径。默认新建由 Agent 选用户目录下 `alipay-aipay-projects/pay-demo`，非空占用则加安全后缀，并显式传入。仅退出码 0 且唯一 JSON 满足 `projectSelection/projectOrigin=NEW_PROJECT`、`projectOriginLabel=本轮新建项目`、`preparationStatus=READY` 才继续，并确认目标或最近父目录可写。路径非空、预检/权限失败时保留内容并改选空或不存在目录，禁止清空/覆盖。服务端语言缺失才补问；框架使用下方 runner。创建命令只来自用户指定、已有模板/项目或本轮已读官方文档，禁用覆盖选项和臆造脚手架。初始化并完成步骤 1 后转为 `PREPARED_NEW_PROJECT`，重入按现有项目重扫。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message resolve-project --project-input "$PROJECT_INPUT" --project-path "$PROJECT_PATH" --base-path "$USER_WORKSPACE_ROOT" --intent new --input-id "$USER_INPUT_ID" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message resolve-project --project-input "$PROJECT_INPUT" --project-path "$PROJECT_PATH" --base-path "$USER_WORKSPACE_ROOT" --intent existing --input-id "$USER_INPUT_ID" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```
- 项目准备失败时停留在步骤 1 前置准备，输出实际错误和待补条件；不得进入沙箱准备。目标项目准备成功后记录实际根目录，步骤 1、步骤 3 的沙箱配置和后续代码必须落入该项目；沙箱配置不得降级写入系统临时目录、Agent 原始工作目录或其他项目。

**项目选择保护规则**：当前目录已有项目时只允许保留并新增能力、在新子目录创建或使用其他路径，不展示清空/删除。明确新建产物必须保留原话并使用 `--intent new`，不得因当前目录有项目而改为复用。`full_process` 在取得 `NEW_PROJECT` 路径、技术栈和初始化结果前留在主编排；`integration_only` 在路径可安全创建前不准备沙箱或开发。确认精确空/不存在路径前不得写文件。

**启动前上下文补问**：缺少项目位置或服务端语言时，必须从本 flow 所在目录执行下列标准消息，一次补齐；只缺少新项目精确位置时仍使用上方 `integration.project_path.required`。框架缺失本身不触发补问。禁止使用 AskUserQuestion、request_user_input、宿主超时默认值、Agent 自创选项或自由话术替代；用户未明确补齐前不得创建目录、初始化项目、安装依赖或修改文件。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message context-required --missing-items "$MISSING_ITEMS" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

`MISSING_ITEMS` 只允许由 `项目路径`、`技术栈` 按缺失项用顿号连接生成，其中 `技术栈` 只在服务端语言无法确定时缺失，不因框架未知而出现。产品不明确时回根入口只读澄清，不得混入本消息。该消息必须把 stdout 原文作为当前回复正文发给用户，发出后立即停止并等待用户自由回复；用户回复后重新计算缺失项，不得靠超时或默认值推进。用户回复“当前项目”、相对路径或新建子目录时，先执行 `resolve-project` 得到规范化绝对路径和 `projectSelection`，再进入后续检查器、沙箱准备和启动方案展示；相对路径必须位于 `--base-path` 内，目录外项目必须由用户提供绝对路径。

项目路径与服务端语言确定后，初始化新项目或展示方案前必须执行一次框架解析。用户未明确框架时使用第一条；用户明确指定 Django、NestJS 等框架时使用第二条并以用户值优先：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message framework-resolve --project-selection "$PROJECT_SELECTION" --project-path "$PROJECT_PATH" --language "$SERVER_LANGUAGE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message framework-resolve --project-selection "$PROJECT_SELECTION" --project-path "$PROJECT_PATH" --language "$SERVER_LANGUAGE" --framework "$USER_FRAMEWORK" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

只接受退出码 0 和唯一 JSON 中规范化后的 `language`、非空 `framework`、合法 `frameworkSource=EXPLICIT|DEFAULT_NEW_PROJECT|PROJECT_INFERRED|PROJECT_STRUCTURE_FALLBACK`；该 JSON 是内部机器事实，不对客展示。`NEW_PROJECT|PREPARED_NEW_PROJECT` 默认固定为 Java / Spring Boot、PHP / Laravel、Python / FastAPI、C# / ASP.NET Core、Node.js / Express。`CURRENT_PROJECT|OTHER_PROJECT` 先从当前项目依赖标记推导；无法推导时固定为 `沿用现有项目结构`，表示不迁移现有框架，不阻止继续。得到的 `FRAMEWORK` 和 `FRAMEWORK_SOURCE` 必须贯穿项目初始化和同一次 `start-confirm`，不得由 Agent 二次猜测或改写；`start-confirm` 会复核非 `EXPLICIT` 来源仍与当前项目事实一致。

用户回复“不知道项目在哪”“帮我找项目”、提供子目录但该目录不是项目根，或当前目录解析失败且需要候选时，从本 flow 所在目录执行下列轻量定位命令。`SEARCH_INPUT` 取用户给出的搜索范围；未给出时固定为 `当前目录`。该命令只查找项目标记文件并跳过常见重目录，不扫描源码内容；stdout 是本动作唯一对客消息，发出后立即停止并等待用户选择候选序号、具体目录或新建目录。用户选择候选后，仍必须再执行 `resolve-project --intent existing` 取得规范化绝对路径；候选列表不能直接替代项目确认。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message locate-projects --base-path "$USER_WORKSPACE_ROOT" --search-input "$SEARCH_INPUT" --format message --input-id "$USER_INPUT_ID" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

**破坏性操作二次确认**：本支付产品-代码开发流程本身不得删除用户既有文件。用户另行主动要求删除具体文件时，先停止代码开发，列出每个精确规范化路径和不可逆影响，再在独立轮次等待用户逐项确认该清单；此前的项目/技术栈补充、代码开发方案展示、服务声明送达及任何含糊回复均无效。未取得二次明确确认时严禁调用删除、清空、强制覆盖或等价命令；即使确认，也禁止删除项目根目录、`.git`、使用通配符或触及清单外文件。

**执行边界**：本流程只操作用户当前确认的项目路径、语言、框架、产品和范围。步骤 1 和后续步骤仅在产品、任务均明确后启动；底层匿名沙箱脚本不收产品参数。沙箱配置与测试结论来自本轮实际脚本结果，不得被 onboarding 的正式 `appId`、支付宝公钥或 `productionServiceId` 覆盖。

项目路径和技术栈已由 runner 唯一解析后，执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" flow integration prepare --product-type "$PRODUCT_TYPE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`；不得提前读取步骤 1/2。

---

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_ENTRY:END -->

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_PREPARE:START -->
### 步骤 1：环境检查与匿名沙箱准备

**任务**：在根入口已确定具体收单产品和开发任务后，完成当前操作系统分支所需的环境检测并尝试准备沙箱配置；配置未就绪时记录待配置状态并继续代码开发

**完成条件**：
- [INT.ENV.CLI_READY] Unix/macOS/Linux 的 `alipay_cli_env.sh integration-check`，或 Windows Integration 的 `alipay_cli_env.mjs integration-check`，返回唯一 `CLI_ENV:READY`；只有缺失项分支才按 `../normal/alipay-cli-env.md` 完成当前分支要求的安装与验证
- [INT.ENV.PROJECT_LANGUAGE_READY] 已确认唯一目标项目路径和服务端语言，且目标项目包含已确认语言的构建标识
- [INT.SANDBOX.OS_DETECTED] 已检测用户操作系统类型
- [INT.SANDBOX.PREPARATION_RECORDED] Unix/macOS/Linux 或 Windows READY 已从固定脚本取得唯一 `READY|CREATE_PENDING|VERIFY_PENDING` 终态。`READY` 时配置已安全落盘或复核；待配置不是成功，不满足任何沙箱配置、测试或生产就绪条件，但本步骤允许按已确定的产品继续代码开发
- [INT.SANDBOX.WINDOWS_STATE_RECORDED] Windows LEGACY/CODE_ONLY：本轮既有标准消息后提供的完整有效沙箱资料已写入并校验为 `READY`；未进入该资料收集分支时已记录 `VERIFY_PENDING` 并继续代码实现；只有用户明确要求立即配置时才使用既有标准消息收集资料

**执行规则**：

通过 CLI 获取的沙箱基础配置与 TokenPay 周期订阅共用[公共模块](sandbox/sandbox-setup-guide.md)，完整保存两种私钥和买家资料。创建与复核不按语言裁剪字段，只处理项目根的标准配置文件。Windows LEGACY/CODE_ONLY 的既有手工配置分支保持不变。

1. 先沿用已确定的产品与开发任务，再确认目标项目与操作系统；工程语言留在代码开发上下文中；产品或任务不明时回根入口，不启动沙箱。缺少多个字段时使用“启动前上下文补问”的固定标准消息一次补齐；字段已能从用户输入和项目事实确定时，不发送环境、项目识别或准备进度消息。
2. Unix/macOS/Linux 或 Windows READY 从本 flow 目录执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" env integration-check --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`；Windows LEGACY/CODE_ONLY 执行同一命令，仅检查原生 Node。该入口先按本任务的公共 CLI 准备记录刷新或复用外部 CLI，再检查实际环境；首次失败不自动循环。检查开始时记录环境检查事实，不单独上报 telemetry stage。Windows LEGACY/CODE_ONLY 只检查本 Integration Node runner 所需运行时，不要求 Bash、jq 或当前流程不会调用的 alipay-cli。唯一 `CLI_ENV:READY` 时继续且不读取完整安装文档。Windows READY 检查非零时停止依赖动作，按 `../normal/windows-environment.md` 有限恢复；不得执行下述 Unix 包管理器链。`CLI_ENV:NEEDS_SETUP` 时才读取 `../normal/alipay-cli-env.md`：若唯一 `CLI_ENV_MISSING` 包含 `jq`，先以所需网络和 `~/.local/bin` 写权限执行一次 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" env prepare-jq --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`；唯一 `ALIPAY_AIPAY_INTERNAL:JQ_PREPARE=READY` 后原样重跑 `env integration-check`。`FAILED|UNSUPPORTED`，或 `READY` 后复检仍缺 jq 时，由 Agent 按环境文档执行当前系统首选包管理器兜底并再次复检；macOS 必须从清华镜像开始，明确失败后才依次选择阿里云、中科大和直连，不并发、不回到 `prepare-jq` 循环。其他缺失项仍按当前系统分支补齐，完成后重跑检查；不得重复执行 `prepare-jq` 或新增业务确认点。其他输出、非 0 或 marker 冲突停在本步骤。
3. Unix/macOS/Linux 或 Windows READY 从本 flow 所在的 `references/integration/` 目录执行唯一准备入口：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" sandbox ensure "<规范化项目路径>" [--telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT"] --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

4. Windows LEGACY/CODE_ONLY 不调用快速沙箱脚本。普通代码开发或完整接入请求没有明确要求当前配置沙箱且未主动提供资料时，不展示申领消息、不补问，直接记录 `sandboxConfigState=VERIFY_PENDING` 并继续步骤 2。用户主动提供本轮目标项目的完整有效手工沙箱资料时，直接校验并写入目标项目实际使用的本机配置，记录 `READY`，无需再次展示申领消息；该状态只证明配置就绪，不将 `CODE_ONLY` 改为环境 `READY`。只有用户明确要求现在配置/恢复沙箱时才执行下列既有标准消息 `sandbox.windows.manual_setup`；该消息使用自由资料回复，不要求用户输入 `1` 或自行执行脚本。主动资料不完整或无效时不使用字段、不记 `READY`，沿用既有受控失败分支只补问实际缺失/错误字段；资料校验通过后继续：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message windows-sandbox-setup --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

资料校验通过后必须建立适用的版本控制忽略和访问保护。该例外只适用于当前沙箱资料；生产环境应用私钥和密码禁止提供给 Agent。Agent 不得在回复、摘要或普通日志中复述收到的值；仅 AI 网页应用收款在本步骤 5 已校验后，允许登记沙箱摘要展示买家账号及两个密码，最终 summary 只展示这三项。

5. Unix/macOS/Linux 或 Windows READY 的 `ensure` 只依据同一目标项目的 `.alipay-sandbox.json` 当前事实分流：文件不存在时执行既有 `create`；文件存在或为符号链接时执行既有 `verify` 安全路径。已存在配置不得再次调用 `createAnonymousSandbox`、不得覆盖，也不得因为中断重来要求用户删除配置；无效、不安全或被 Git 跟踪时不得使用，脚本按待配置终态统一输出后继续代码开发。
6. Unix/macOS/Linux 或 Windows READY 的创建分支会调用冻结的 `alipay-anonymous-sandbox.createAnonymousSandbox`、`{"request":{"appType":"PUBLICAPP"}}`、`PLATFORM`、`PLATFORM_ID`、`ALIPAYCLI_BIZ_INFO` 环境变量和 `result.content[0].text -> success -> data` 解包逻辑；`ALIPAYCLI_BIZ_INFO` 固定标识当前调用方 Skill 与当前生效版本，禁止传入 `PRODUCT`。Windows LEGACY/CODE_ONLY 不调用该方法或 `sandbox_config.sh`。
7. Unix/macOS/Linux 或 Windows READY 只接受以下互斥最终结果和一个临时恢复结果；待配置不算成功：
   - `READY`：退出码为 0；唯一带 `ALIPAY_AIPAY_INTERNAL:` 前缀的 `SANDBOX_ENSURE_ACTION=CREATED|VERIFIED`、`SANDBOX_CONFIG_PATH=<同一目标项目绝对路径>/.alipay-sandbox.json` 和 `FLOW:SANDBOX_CONFIG_READY` 内部事实。
   - `CREATE_PENDING`：退出码为 0；脚本 stdout 已渲染唯一 `sandbox.configuration.pending/CREATE` 正文，并产生唯一 `ALIPAY_AIPAY_INTERNAL:CUSTOMER_MESSAGE_DELIVERY_REQUIRED=sandbox.configuration.pending`；另有唯一带 `ALIPAY_AIPAY_INTERNAL:` 前缀的 `SANDBOX_PENDING_PATH=<同一目标项目绝对路径>/.alipay-sandbox.json` 和 `FLOW:SANDBOX_CONFIG_PENDING_CREATE` 内部事实；不得出现 READY 标记。
   - `VERIFY_PENDING`：退出码为 0；脚本 stdout 已渲染唯一 `sandbox.configuration.pending/VERIFY` 正文，并产生唯一 `ALIPAY_AIPAY_INTERNAL:CUSTOMER_MESSAGE_DELIVERY_REQUIRED=sandbox.configuration.pending`；另有唯一带 `ALIPAY_AIPAY_INTERNAL:` 前缀的 `SANDBOX_PENDING_PATH=<同一目标项目绝对路径>/.alipay-sandbox.json` 和 `FLOW:SANDBOX_CONFIG_PENDING_VERIFY` 内部事实；不得出现 READY 标记。
   - `LOCAL_FS_RECOVERY`：仅创建分支、退出码 `77`，唯一包含上述 CREATE pending 两个事实及 `SANDBOX_LOCAL_FS_PERMISSION_MODE=CREATE`、`CLI_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION`；stdout 是现有 pending 正文，先暂存且不得发送，CLI 调用次数为 0。允许权限升级后原样重试一次：`READY` 时丢弃暂存正文；普通 `CREATE_PENDING` 或再次命中本结果时只发送重试 stdout 并接受其 pending 事实；拒绝或宿主不支持时发送首次 stdout 并接受首次 pending 事实。不得再次申请、新增消息或确认。
8. `SANDBOX_PENDING_REASON` 只解释待配置原因，不改变 pending 终态。所有 `ALIPAY_AIPAY_INTERNAL:` 行只用于转移；宿主合并输出时也先整行剔除。`READY` 的 stdout 为空，静默记录 `READY` 并直接进入步骤 2；普通 pending 或按上项降级时，必须校验唯一 `CUSTOMER_MESSAGE_DELIVERY_REQUIRED=sandbox.configuration.pending`，下一动作将剔除内部行后的 stdout 原文独立送达，再记录 `CREATE_PENDING|VERIFY_PENDING` 并直接进入步骤 2。禁止追加 `jq|cat|grep|ls|stat` 或临时脚本；待配置时禁止读取、引用或复制无效/不存在配置的字段。
Windows READY 若在调用沙箱脚本前收到非零及 `WINDOWS_BUSINESS_BLOCKED=ENVIRONMENT_UNAVAILABLE`，本次 CLI 调用为零，停在环境阻断点；按 Windows 环境文档只读复检或有限准备，取得 READY 后再继续。不得擅自转 LEGACY/CODE_ONLY 或重放已发出的业务请求；CODE_ONLY 例外仅处理根入口的可选工具失败。脚本已启动后的失败仍按第 9 项处理，不把超时或未知结果伪装为待配置。

9. 除上项精确的 `LOCAL_FS_RECOVERY` 外，命令非 0、终态标记缺失/重复/冲突、路径不一致或输出含 `SANDBOX_ERROR` 时属于脚本执行协议失败，仍停留在步骤 1；不得把这种执行异常降级为待配置，也不得临场改写 jq、重放原始 MCP 命令或自行检查敏感配置。CLI 已执行后才出现本地状态权限证据时，创建请求属于 `MAYBE_SENT`，脚本不得返回恢复 marker 或重放，`ensure` 直接使用既有 `CREATE_PENDING` 正文和终态继续代码开发。Windows LEGACY/CODE_ONLY 配置检查未通过仍按 Windows LEGACY/CODE_ONLY 登记分支处理。项目内自建 JSON、Agent 自报或补充诊断结果都不能替代上述终态。
10. 准备阶段不得渲染 `sandbox.environment.summary` 或 `sandbox.environment.reminder`，不得展示沙箱买家密码，也不得输出“沙箱测试通过”。只有 `sandboxConfigState=READY` 且代码开发完成并通过配置后置校验后，才按步骤 5 的摘要展示规则对客展示沙箱环境配置。

### 步骤 2：确认本轮开发方案

**任务**：沿用已确认的产品，结合目标项目确定开发范围，展示完整方案后直接启动当前支付产品的代码开发

**完成条件**：
- [INT.CONTEXT.LANGUAGE] 已在步骤 1 前确认用户服务端开发语言（Java / Python / Node.js / C# / PHP 五选一）
- [INT.CONTEXT.PROJECT] 已在步骤 1 前确认唯一的规范化目标项目路径；已有项目已验证可访问且保持原有内容，新项目路径已验证为尚不存在或为空并确认框架和项目创建方式
- [INT.PRODUCT.CONFIRMED] 已继承根入口确定的唯一收单产品
- [INT.START.PLAN_DELIVERED] 已基于确定的产品、项目和技术栈输出完整代码开发方案
- [INT.SERVICE_STATEMENT.DELIVERED] 已随方案输出完整服务声明

产品已在入口确定，本阶段继承现有选择，仅核实开发上下文。若商家改为订阅或咨询，请按根入口对应任务接续。

**阻塞规则（执行约束，不是对客正文）**：步骤 2 只补问缺少的项目路径或服务端语言；若场景变化导致产品不明，暂停并回根入口澄清，项目路径或服务端语言不明确用 `integration.context.required`。框架由已登记 runner 解析，不因框架未知追问；不得重复询问步骤 1 已确认的项目路径和服务端语言。

- `integration_only`：字段齐备后不得先输出产品判断、选择理由、待办、服务声明、执行进度或“即将确认”等内容。必须用步骤 1 确定的 `PROJECT_SELECTION` 对同一项目执行固定 runner，由 runner 内部完成检查器扫描、字段转换和 `integration.start.confirm` 渲染；项目来源、代码状态和其他支付产品不得由 Agent、用户描述或历史状态提供。下列 Node 单行命令在 Unix/macOS/Linux 与 Windows PowerShell 使用相同参数，必须执行：

`ROOT_INTENT` 取当前路线的根意图，只能是 `integration_only` 或 `full_process`。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message start-confirm --root-intent "$ROOT_INTENT" --product-type "$PRODUCT_TYPE" --product-name "$PRODUCT_NAME" --project-path "$PROJECT_PATH" --project-selection "$PROJECT_SELECTION" --language "$SERVER_LANGUAGE" --framework "$FRAMEWORK" --framework-source "$FRAMEWORK_SOURCE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

本命令复用同一产品和任务的 run 及 `RUN_ID`；不得跳过根入口的产品和任务确认。步骤 3 之后所有能生成 stage 的登记命令都必须携带当前 telemetry context；runner 已生成 stage 后 Agent 禁止重复调用 `telemetry stage`。

runner 失败时不得展示手写方案或进入步骤 3。成功时必须取得唯一 `ALIPAY_AIPAY_INTERNAL:CUSTOMER_MESSAGE_DELIVERY_REQUIRED=integration.start.confirm`；缺失或重复都视为失败。stdout 是步骤 2 唯一对客消息；命令后的下一个动作必须把 stdout 作为可见进行中消息原文送达，不得作为最终答复结束当前回合，送达前禁止调用工具。命令面板、折叠输出、内部思考或“已渲染/已展示”说明都不能替代交付；禁止添加 `<...>` 标签、“已输出完整方案”“服务声明已打印”、重复摘要或任何前后缀。送达后同一回合按根意图分流：`full_process` 先按 `../normal/full-process-routing.md` 读取 Worker 协议；满足启用条件时必须创建唯一 Worker，由 Worker 执行 development，主 Agent 不执行；不满足启用条件或根意图为 `integration_only` 时，由当前 Agent 执行 development，不得总结、询问、等待回复、解码内部值或再次渲染方案。

- `full_process`：`../normal/full-process-routing.md` 已用同一方案绑定检查器事实、产品、项目、语言/框架和服务声明；送达后按该路由选择唯一 Integration Worker 或当前 Agent 执行，禁止重显或确认。两者都须完成本 flow 全部适用接口、条件和 checklist。用户中断后事实变化则返回 router 重新澄清、扫描和展示。方案仍禁止提前展示 MCC、授权范围、开通材料或 onboarding 待办。

执行者分流完成后，只由确定的执行者通过 development loader 进入步骤 3；loader 只继承 `clarify_intent` 已记录的正式 run 事实，不再单独记录开始态 stage。它不表示收到额外确认回复；不得伪造用户回复。Agent 在收到每条聊天框用户消息时，必须先按 `runtime-entry.md` 的统一前置命令计数，再处理消息；不按 Skill 相关性筛选，`summary` 收口后不再计入当前 run，方案本身不是用户输入。

**方案后的上下文锁定**：已有项目保持步骤 1 前已经唯一解析的实际根目录和原有工程结构；新项目必须已经在步骤 1 前按用户明确选择的方式完成初始化并通过构建标识检查。此处不重复准备、初始化或探测项目。路径内容与步骤 1 成功时不一致则停止并重新澄清；只有目标项目或服务端语言变化时返回步骤 1，其他情况直接进入步骤 3。

完整接入固定在本流程步骤 3 至步骤 8 完成后再进入 onboarding；onboarding 自身仍输出非阻塞产品开通方案，外部写入边界继续按 Onboarding flow 执行。

---

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_PREPARE:END -->

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_DEVELOPMENT:START -->
<!-- clarify_intent 已由 start-run 记录，这里不再单独上报开始态 stage -->
<!-- 前置阅读阶段不再单独上报 telemetry stage -->
### 步骤 3：沙箱配置复核

**任务**：步骤 1 已就绪时复核同一沙箱配置；步骤 1 已待配置时保持该状态并继续代码开发

> 步骤 1 已完成 CLI、操作系统和首次配置校验。本步骤只复核方案展示期间配置是否仍然安全可用，不重新创建沙箱，也不重新执行环境探测。

**完成条件**：
- [INT.SANDBOX.UNIX_TERMINAL] Unix/macOS/Linux 或 Windows READY：`READY` 时已用 `reverify` 复核同一配置；步骤 1 或本步骤得到 `CREATE_PENDING|VERIFY_PENDING` 时，未读取或使用无效配置，已保留待配置状态并继续步骤 4
- [INT.SANDBOX.WINDOWS_REVERIFIED] Windows LEGACY/CODE_ONLY：`READY` 时已静默复核步骤 1 通过的项目实际配置、密钥格式和版本控制保护；`VERIFY_PENDING` 时未读取配置或重复展示申领提示，已直接继续代码开发

> `READY` 时实际本机配置路径是后续唯一可信来源；待配置时 `SANDBOX_PENDING_PATH` 只是预期路径，不得作为配置存在或字段有效的证据。禁止从对话或历史代码复制密钥；对客沙箱摘要只能在代码开发完成且配置后置校验通过后展示。正常路径由 `sandbox_config.sh` 托管字段、落盘、重复创建和失败分支；仅脚本协议异常或用户要求解释时读取沙箱指南。

**操作流程**：
1. 继承步骤 1 的操作系统、规范化项目路径和服务端语言；任一值变化就返回步骤 1，不在本步骤重新探测。
2. Unix/macOS/Linux 或 Windows READY 的 `sandboxConfigState=CREATE_PENDING|VERIFY_PENDING` 时不再次调用脚本、不读取配置，直接进入步骤 4；本轮后续保持同一状态，直到用户另行要求重新配置。
3. Windows LEGACY/CODE_ONLY 的 `sandboxConfigState=VERIFY_PENDING` 时不读取或探测配置、不渲染 `sandbox.windows.manual_setup`，直接进入步骤 4；`READY` 时才静默复核步骤 1 由 Agent 写入的同一本机敏感配置路径、项目实际读取字段、密钥格式和版本控制保护。路径、字段或保护发生变化时返回步骤 1 的 Windows LEGACY/CODE_ONLY 分支，只补问实际缺失或错误字段。
4. Unix/macOS/Linux 或 Windows READY 仅在 `sandboxConfigState=READY` 时执行以下唯一复核命令，不先检查文件、不读取字段、不运行其他诊断：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" sandbox reverify "<规范化项目路径>" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

5. `reverify` 只接受与步骤 1 相同的三个互斥终态。`READY` 更新 `sandboxConfigState=READY` 并立即进入步骤 4；`VERIFY_PENDING` 已由脚本输出唯一待配置正文，更新状态后立即进入步骤 4。`reverify` 不允许创建分支，若异常出现 `CREATED|CREATE_PENDING` 标记必须按协议失败停止。所有终态之后禁止追加任何 `jq`、`cat`、`grep`、`ls`、`stat` 或临时脚本。
6. Windows LEGACY/CODE_ONLY 手工申领分支不伪装成快速沙箱脚本结果，只按本步骤和指南检查目标项目实际使用的本地配置。沙箱就绪时不输出复核进度、沙箱环境摘要、独立校验结果或字段核对表，直接进入步骤 4。

---

### 步骤 4：代码开发前置

**任务**：阅读 SDK 要点、本地契约和当前语言示例

读取本地依据前执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-context resolve --product-type "$PRODUCT_TYPE" --server-language "$SERVER_LANGUAGE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`。只接受唯一 `ALIPAY_AIPAY_INTERNAL:INTEGRATION_CONTEXT=<json>`，并在本步骤只读取其中 `sdk_reference`、`contracts` 和 `examples` 列出的当前产品/语言开发依据；`sandbox_acceptance` 只保存路径事实并延迟到步骤 6，`checklist.delivery_phase=checklist` 及章节名只保存交付事实，具体内容由步骤 8 loader 直接附带，禁止在本步骤提前读取。缺失、重复、路径不存在或产品/语言不一致时停止，不回退到跨产品预读；后续阶段复用同一 envelope，不重复执行 `integration-context resolve`。

本步骤只加载和核对代码开发依据；成功时不发送“文档已读取”“准备完成”等对客进度，直接进入步骤 5。本地依据缺失时输出实际缺口，禁止猜测。在线文档只在 fallback 条件下读取，不作为默认必读材料。

**完成条件**：
- [INT.PRE.SDK_GUIDE_READ] 已阅读 `modules/acquiring/alipay-sdk-reminder.md` 完整内容（私钥格式、页面跳转方法、验签排查等）
- [INT.PRE.SDK_RULES_APPLIED] 已理解 SDK 选择和 SDK 防幻觉强制规则
- [INT.PRE.LOCAL_CONTRACTS_READ] 已按 `integration_context_runner.mjs` 当前产品事实读取本地接口契约；网站支付和 APP 支付同时读取通用收单与异步通知契约
- [INT.PRE.OFFICIAL_DOCS_FALLBACK_BOUNDARY] 在线文档仅在本地依据缺失、字段不确定、排查官方错误码、用户明确要求或官方能力变化时读取；未无条件 curl 或递归抓取无关文档
- [INT.PRE.EXAMPLES_READ] 已阅读产品相关接口代码示例

**官方文档 fallback 访问**：

触发 fallback 时，只读取当前本地契约 `sourceUrl` 中与本产品、本接口直接相关的官方页面：
```bash
curl -sL "<当前契约 sourceUrl 中的官方页面>"
```
不得为了默认代码开发无条件执行 `curl`，也不得继续递归抓取无关页面。在线文档不可达且本地依据不足时，停止并标记待核验，不得猜测。

**必须阅读的文件**：
- `modules/acquiring/alipay-sdk-reminder.md` - SDK防坑指南（含私钥格式、页面跳转方法、验签排查等）
- 当前产品契约和当前语言示例 - 只按 runner 返回的路径加载；接口索引由 runner 内部解析，不进入 Agent 默认上下文

**🚫 SDK 防幻觉强制规则**：

> ⚠️ 以下规则来自真实集成踩坑，违反将导致集成失败。详细说明和各语言操作对照见 [SDK 说明文档](modules/acquiring/alipay-sdk-reminder.md)，**严禁**在未读取该文档的情况下生成代码或给出建议。

| # | 规则 | 禁令 |
|---|------|------|
| 1 | 私钥字段按语言选择沙箱返回值 | Java 使用 `appPrivateKey`（PKCS#8），非 Java 使用 `appPrivatePkcsKey`（PKCS#1），禁止自行生成或格式转换 |
| 2 | 页面跳转类 API 必须使用页面跳转方法 | `alipay.trade.page.pay` 等必须使用 `pageExecute()`/`pageExec()`，使用 `exec()` 将无法获取支付表单 |
| 3 | 前端禁止用 URL 直接跳转支付表单 | 支付接口返回的是 HTML 表单，必须渲染并自动提交 form，直接用 URL 跳转会导致页面只显示参数而无法跳转支付宝 |
| 4 | 时间戳格式 | 必须使用 `yyyy-MM-dd HH:mm:ss`，禁止使用 ISO 格式 |
| 5 | SDK 引入方式 | 必须通过查阅 SDK 文档或类型定义确定正确的引入方式，禁止凭猜测选择 |
| 6 | 遇到 `invalid-signature` 报错 | 严禁凭猜测归因到私钥格式；先核对实际发送、参与签名和服务端验签的参数是否完全一致 |
| 7 | 配置接入后必须后置校验 | Unix/macOS/Linux 或 Windows READY 必须确认服务端加载器直接读取已验证文件、字段映射正确且 SDK 配置匹配；Windows LEGACY/CODE_ONLY 必须确认项目读取同一套本机沙箱应用配置；失败时禁止继续联调 |

步骤 4 的本地依据全部取得后，执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" flow integration implementation --product-type "$PRODUCT_TYPE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"` 加载步骤 5；不得直接读取后续整段 flow。

---

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_DEVELOPMENT:END -->

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_IMPLEMENTATION:START -->
<!-- ALIPAY_AIPAY_STAGE:integration.complete_coding -->
### 步骤 5：代码生成

**任务**：根据用户选择的开发语言和产品，在已确认的目标项目根目录中生成集成代码

进入本 flow 的 `implementation` 阶段时，不再单独记录开始态 stage；最终检查确认实现已完成且没有阻断缺陷时，`checklist-result` 先记录 `integration.complete_coding`，再写开发摘要。沙箱或允许的人工验证可以单独待办；未通过和 `REPAIR_REQUIRED` 预览不能产生编码完成事件。

**完成条件**：
- [INT.CODE.BASE_IMPLEMENTED] 已完成支付宝支付产品集成代码实现
- [INT.CODE.INTERFACES_COMPLETE] 已按目标产品文档完成全部适用接口；网站支付/APP 支付覆盖下单、交易查询、退款、退款查询、关闭交易和异步通知处理代码，按量付费覆盖 402、`payment.verify` 和 `fulfillment.confirm`
- [INT.CODE.SELF_CHECKED] 已完成代码自检并确认无误
- [INT.CODE.CONFIG_VERIFIED] 已完成支付配置准确性后置校验：Unix/macOS/Linux 或 Windows READY 服务端加载器直接读取已验证文件且字段映射、SDK 配置匹配；Windows LEGACY/CODE_ONLY 项目读取同一套本机沙箱应用配置
- [INT.WEBPAY.RETURN_IMPLEMENTED] 网站支付在用户未明确要求不使用同步回跳时，已配置与当前项目一致的 `return_url`，并实现可通过 GET 访问的回跳路由和结果页；页面不直接信任同步回跳参数判定支付成功
- [INT.LOCAL_ACCEPTANCE.NOTIFY_DEFERRED] 用户处于“本地生产参数验收模式”时，已明确记录当前暂不联调公网 `notify_url`，支付结果确认依赖异步通知处理代码加主动查询兜底；未把同步回跳参数当作支付成功依据
- [INT.A2M.PRODUCTION_CONTROLS] 按量付费生产接入中已补齐订单持久化、本地订单匹配、金额一致性、资源防串、幂等履约和履约确认失败可重试逻辑，不存在未实现的关键 TODO

**实现与自检入口**：按 runner 返回值读取当前语言和产品的本地接口契约及专用/通用示例，并完整应用 `modules/acquiring/alipay-sdk-reminder.md` 的生成前自检与配置后置校验。示例路径相对本 flow 目录，以 integration-context 返回的具体文件为准。Markdown 示例中的目标语言代码只取唯一且语言标签匹配的 fenced code block，标题和说明不得写入用户项目源码。本地缺少示例不等于接口不适用；用户限定本轮范围时，未实现的适用接口必须列为待办，不得宣称完整集成。

**Node.js 项目前置核对**：目标语言为 Node.js 时，生成或修改代码前必须先读取目标项目 `package.json`，确认 `type`、启动脚本、已安装依赖和框架版本；安装或发现 `alipay-sdk` 后，必须按 `modules/acquiring/alipay-sdk-reminder.md` 读取实际 `node_modules/alipay-sdk/package.json` 与类型定义来确定导入方式、`pageExec`/`sdkExecute`/`checkNotifySign` 等方法名。不得凭本地示例中的 `require`/`import` 行、历史记忆或其他项目版本推断当前项目写法。

代码修改完成后，执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" flow integration verification --product-type "$PRODUCT_TYPE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"` 加载配置后置校验；不得把代码写入直接当作验证通过。

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_IMPLEMENTATION:END -->

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_VERIFICATION:START -->
<!-- 配置后置校验不再单独上报开始态 stage -->

开始执行代码自检、语法/静态检查或支付配置后置校验前，进入本 flow 的 `verification` 阶段；该阶段不再单独记录 telemetry 开始态，只由最终收口阶段记录结果。

**支付配置接入与后置校验**：`sandboxConfigState=READY` 时，Unix/macOS/Linux 或 Windows READY 快速沙箱由商家服务端代码使用当前语言的标准 JSON 解析器，在运行时读取步骤 1/3 已验证的 `.alipay-sandbox.json`，并从 `appIds[0]` 映射 `appId`、`alipayPublicKey` 和当前语言私钥字段；不得先用 `jq`、`cat` 或临时脚本把字段原文打印到工具输出、复制到源码或重复写入 `.env`。项目已有配置抽象时在其服务端加载边界接入该 JSON，不改变字段原值。Windows LEGACY/CODE_ONLY 从步骤 1 由 Agent 写入并校验的本机沙箱配置读取。后置校验必须检查实际加载路径、字段选择、SDK 初始化和版本控制保护；Java 使用 `appPrivateKey`，其他四种语言使用 `appPrivatePkcsKey`。A2M 的 `seller_signature` 使用原生密码库时，只在调用边界按库要求解析密钥。失败时修正加载器或 SDK 配置，禁止猜测、转换格式或改写原始值。

`sandboxConfigState=CREATE_PENDING|VERIFY_PENDING` 时仍完整实现当前产品全部适用接口、安全校验和配置加载边界，但不得读取当前无效配置、写入占位 appId/密钥、把示例值当作运行配置或声称 `INT.CODE.CONFIG_VERIFIED` 通过。加载器在配置缺失或无效时必须明确失败并阻止真实 SDK 调用；本轮所有依赖沙箱值的运行验证保持未完成。

**沙箱摘要展示入口**：只有 `sandboxConfigState=READY`、本步骤的代码实现和支付配置后置校验都已完成，才允许对客展示沙箱环境配置。待配置状态跳过本入口，不另写摘要或失败话术。Unix/macOS/Linux 或 Windows READY 从本 flow 所在目录执行：

`environmentRows` 的具体值严禁编造、猜测、补全，禁止使用示例值、占位值或历史对话值替代本轮已校验配置。Unix/macOS/Linux 或 Windows READY 必须由登记脚本直接读取同一配置并生成四行，Agent 不得手填或改写；Windows LEGACY/CODE_ONLY 的字段必须来自步骤 1/3 已校验的同一本机配置；网页收款使用已校验沙箱买家密码明文，其他产品两个密码行仅在确认密码已写入文件后使用固定保存提示。任一必需字段缺失、为空、配置无法读取或来源无法确认时，停止摘要展示并按既有配置失败分支处理，禁止为凑齐四行补值。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" sandbox summary "<productType>" "<规范化项目路径>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

仅 AI 网页应用收款在该命令成功交付后，在当前对话上下文保留剔除内部行的完整 stdout 为 `SANDBOX_SUMMARY`；只允许本轮原始登记摘要，不写业务状态、不摘出或复述凭据。配置后置校验失败、最终状态不再 READY 或实际配置变化时立即丢弃，禁止拿旧摘要补齐。该命令 stdout 只渲染 `sandbox.environment.summary` 与 `sandbox.environment.reminder`；Unix/macOS/Linux 和 Windows READY 从已校验的快速沙箱配置生成摘要；仅网页收款展示买家密码，其他产品显示保存提示。命令必须产生唯一 `ALIPAY_AIPAY_INTERNAL:CUSTOMER_MESSAGE_DELIVERY_REQUIRED=sandbox.environment.summary`，带 `ALIPAY_AIPAY_INTERNAL:` 前缀的配置路径和 `FLOW:SANDBOX_CONFIGURED` 只用于流程转移，严禁对客。命令返回后下一动作必须将剔除内部行后的 stdout 原文独立送达，再进入后续沙箱测试或付款体验；不得把工具面板输出或自写摘要当作已送达。命令不重新创建沙箱，不调用 `createAnonymousSandbox`。`productType` 只能来自步骤 2 已确认的 `aipay|webpay|apppay`；配置路径必须与步骤 1/3 一致。摘要展示失败时不得进入沙箱测试或付款体验，也不得改用 Agent 自写表格。

Windows LEGACY/CODE_ONLY 从项目实际读取的同一本机配置构造 `ENVIRONMENT_ROWS`：网页收款允许已校验沙箱买家密码明文，其他产品继续使用本地保存提示，所有产品均不得包含密钥原文，再从本 flow 所在目录执行以下固定命令；除上述网页收款买家密码外，不得重新索取或复述步骤 1 已提供的敏感值，也不得改用 Unix 快速沙箱脚本：

```powershell
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message windows-sandbox-summary --product-name "$PRODUCT_NAME" --config-path "$CONFIG_PATH" --environment-rows "$ENVIRONMENT_ROWS" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

Windows LEGACY/CODE_ONLY 的 `CONFIG_PATH` 必须是步骤 1/3 已校验的实际本机配置绝对路径；`ENVIRONMENT_ROWS` 固定依次为“沙箱支付宝应用ID（appID）”“沙箱买家测试账号”“沙箱买家登录密码”“沙箱买家支付密码”四行。前两行使用实际沙箱应用 ID 和买家登录账号；网页收款两个密码行使用已校验沙箱买家密码明文；其他产品两个密码行只展示“已写入本地配置文件，默认不在对话中展开”，不得传入密码原文。不追加 pid、商家或买家 userId、sandboxId。两个 renderer 任一失败都按摘要展示失败处理，禁止手写补齐。仅网页收款成功交付后保留完整原始 stdout 为 `SANDBOX_SUMMARY`，供最终收口提取三项买家信息；其他产品不保留该变量。

<!-- ALIPAY_AIPAY_PRODUCT:webpay:START -->
<!-- ALIPAY_AIPAY_BRANCH:INTEGRATION_VERIFICATION -->
<!-- ALIPAY_AIPAY_PRODUCT:END -->

<!-- ALIPAY_AIPAY_PRODUCT:webpay,apppay:START -->
**本地生产参数验收模式**：用户项目尚未上线、无法提供真实公网地址，或当前自定义域名/TLS 检查失败时，网站支付/APP 支付可以进入本模式。要求如下：

1. 代码层必须已经实现异步通知处理入口、验签、关键字段校验、幂等和成功响应 `success`，只是当前环境不对外联调。
2. 运行层可以临时关闭异步通知发起配置或不传 `notify_url`；如项目已有显式开关，也可使用项目内已有的 `notify_enabled=false` 等等价配置，并执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message local-acceptance-notice --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`，不得另写近似话术。
3. 本地模式下，网站支付保留 `localhost` 或当前可访问开发地址的 `return_url`/结果页，APP 支付保留本地订单查询链路，并统一提供服务端交易查询或订单查询页作为结果确认兜底。
4. 任何本地模式结果都只能表述为“本地正式验收完成”或“本地生产参数验收完成，公网异步通知待补齐”，不得表述为“生产就绪”。
<!-- ALIPAY_AIPAY_PRODUCT:END -->

<!-- ALIPAY_AIPAY_PRODUCT:aipay:START -->
<!-- ALIPAY_AIPAY_BRANCH:INTEGRATION_VERIFICATION -->
<!-- ALIPAY_AIPAY_PRODUCT:END -->

配置后置校验结束后，执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" flow integration acceptance --product-type "$PRODUCT_TYPE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"` 加载当前产品适用验收和步骤 7；APP 支付 loader 不记录沙箱验收 stage，但仍加载步骤 7。

---

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_VERIFICATION:END -->

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_ACCEPTANCE:START -->
<!-- 沙箱体验阶段不再单独上报开始态 stage -->
### 步骤 6：沙箱测试与体验（AI 按量付费、AI 网页应用收款）

> APP 支付跳过本步骤，直接进入步骤 7。按量付费和网站支付只有在 `sandboxConfigState=READY` 且配置后置校验通过时才执行本步骤；`CREATE_PENDING|VERIFY_PENDING` 时跳过全部沙箱依赖动作并进入步骤 7，不渲染 `a2m.test.*`、`a2m.payment.experience`、`webpay.sandbox.experience*` 或 `sandbox.android.client`。只有按量付费满足本步骤全部端到端完成条件时，才能对客输出“沙箱测试通过”或等价结论；网站支付和 APP 支付不得输出该结论。

进入本 flow 的 `acceptance` 阶段时，不再单独记录开始态 stage；适用沙箱联调或付款体验只在完成时由收口阶段记录结果。AI 移动应用收款不会记录该 stage。

<!-- ALIPAY_AIPAY_PRODUCT:webpay:START -->
<!-- ALIPAY_AIPAY_BRANCH:INTEGRATION_ACCEPTANCE -->
<!-- ALIPAY_AIPAY_PRODUCT:END -->

<!-- ALIPAY_AIPAY_PRODUCT:aipay:START -->
<!-- ALIPAY_AIPAY_BRANCH:INTEGRATION_ACCEPTANCE -->
<!-- ALIPAY_AIPAY_PRODUCT:END -->

---

### 步骤 7：集成后说明

**任务**：按产品交付集成后说明，并进入步骤 8 代码开发校验。

**完成条件**：
- [INT.CLOSEOUT.SAFETY_AND_NEXT_STEPS_HANDLED] 已完成下述产品分支的集成后说明。

网页收款与按量付费直接进入步骤 8。

<!-- ALIPAY_AIPAY_PRODUCT:apppay:START -->
APP 支付使用 `integration.safety.closeout/APPPAY` 交付商家服务端与客户端的接入范围说明。命令必须产生唯一 `ALIPAY_AIPAY_INTERNAL:CUSTOMER_MESSAGE_DELIVERY_REQUIRED=integration.safety.closeout`；返回后的下一动作先将 stdout 原文独立送达，再进入步骤 8：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message safety-closeout --variant APPPAY --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```
<!-- ALIPAY_AIPAY_PRODUCT:END -->

步骤 7 完成后执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" flow integration checklist --product-type "$PRODUCT_TYPE" --project-path "$PROJECT_PATH" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`；只接受该命令生成的本轮 `CHECKLIST_SCOPE_RECEIPT`，不得使用修复前或其他项目的 receipt。

---

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_ACCEPTANCE:END -->

<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_CHECKLIST:START -->
<!-- ALIPAY_AIPAY_STAGE:integration_summary -->
### 步骤 8：代码开发校验

**完成条件**：已执行本阶段 bundle 附带的全部适用检查，并保留每项实际命令、文件检查或人工待验证依据；不得使用 Agent 自拟 attestation、空哈希或口头结论代替。

**最终校验前的收尾**：网站交付所需且已授权的服务启动／重启、数据库初始化、截图和说明文件生成在进入本阶段前完成。最终 checklist 通过后直接交付验收结果并进入后续流程，交接只核对本轮已登记的验收终态，不重复扫描工程。此后如因继续开发或已知外部修改导致代码、配置或其他验收输入变化，重新进入本阶段、撤销旧交接记录，沿用有限复检规则检查受影响部分并取得新结论；不直接复用旧回执。

**工程快照范围**：代码、配置、依赖清单和测试输入继续参与指纹计算，不根据 `.gitignore` 忽略它们，也不整目录忽略 `data/`。为避免正常运行写入使验收失效，runner 仅排除根目录 `data/`、`instance/`、`storage/`、`var/` 内具有 SQLite 文件头的 `.db`、`.sqlite`、`.sqlite3` 数据库及对应 `-wal`、`-shm`、`-journal` 文件，并兼容根目录 `db.sqlite3`；测试、夹具、种子、迁移和 schema 路径仍参与校验。其他未明确识别的运行产物保持校验；持续写入的其他业务数据宜与工程验收输入分开存放。

**自动执行规则**：步骤 7 完成后进入 `checklist` 阶段；最终收口阶段统一记录 `integration_summary`，输出唯一 `ALIPAY_AIPAY_INTERNAL:CHECKLIST_SCOPE_RECEIPT=<receipt>`，并在本 bundle 末尾直接附带当前产品适用清单。该 scope receipt 绑定当前业务任务、产品、路径与快照，防止错配或变更后沿用旧结论，不证明检查已执行。不得再单独读取整份 `modules/acquiring/checklist.md`。默认只执行代码阅读、最终 runner 内固定 implementation audit、配置后置校验、语法/静态检查，以及无需安装依赖、联网或监听端口的已有定向测试，并复用步骤 5、步骤 6 已取得的校验证据，不增加“是否需要校验”的用户确认。

本阶段原本需要执行的定向工程检查（语法、构建或项目测试）经同一 runtime 运行并取得实际退出状态。按现有项目选择能验证本次改动、已在本地可用的检查，用参数数组传可执行程序和参数。每个会影响开发结论的工程检查均经此入口执行，例如 JavaScript 项目的定向测试可传 `["node","--test","test/payment.test.mjs"]`。优先使用工程已有测试，包括 npm、Composer 或 Makefile 中登记的项目测试目标及直接运行目标测试文件。存在适用测试时需取得真实测试结果；轻量工程没有测试套件时可对实际支付实现做本地静态检查。纯文件存在、版本查询或回显成功不能代替验证。当前 runner 无法识别的自定义入口可以保留其人工证据，标明尚待核验，或用该工程中可识别的等价测试目标。Windows 可使用原生工具、npm 或具有明确路径的工程批处理脚本。同一任务、产品和工程内，修改文件或刷新 scope 后仍保留已知失败。最终结论必须使用工程检查记录中的实际退出状态；失败或未结束的检查按实际缺口收口，不额外输出工程检查摘要。不同快照的旧成功不计入本次范围。只按已有证据登记沙箱结果和仍需人工验证的项目。缺少可用检查时保留未验证，并说明下一项本地验收动作。检查只接收工程命令，不传商家凭证或会话正文。不要在此重复运行沙箱支付或真实业务操作。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message project-check --variant "$PRODUCT_VARIANT" --project-path "$PROJECT_PATH" --scope-receipt "$CHECKLIST_SCOPE_RECEIPT" --argv-json "$LOCAL_CHECK_ARGV_JSON" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

`PRODUCT_VARIANT` 对应当前产品的 `AIPAY|WEBPAY|APPPAY`。脚本保存检查状态和工程版本；失败或未完成的检查不能生成允许自动衔接的开发结论。用户明确改为先办理时直接走独立开通流程，告知未修复的工程问题。

**禁止循环与定向复检**：首次覆盖全部适用项，并复用本轮已有且仍有效的证据。局部修复后，复检原失败目标，或运行能明确覆盖它的定向检查。若原记录只有整组失败、无法定位到具体文件，可复验原组或保留为未解决项；单个无关用例的成功不能清除该记录。其余检查只复核与修复有关的依赖、接口、配置或安全项。每个问题自动修复后最多一次定向复检；仍失败、结果无变化、缺少新证据或受环境阻断时立即停止该问题的重复检测，保留失败／待验证结果并进入最终收口，不以换命令、重载阶段、刷新 scope、重新进入 flow 或主 Agent 要求继续来重置次数。局部复检新发现的问题直接列入本轮结果，不开启无限修复链；后续只有用户明确要求继续处理时再按实际缺口推进。重新取得 scope 只绑定修改后的快照，不代表必须重测所有项目；最终 runner 的固定只读 implementation audit 仍按原契约执行，不等于授权全量测试。

**执行边界**：默认禁止安装依赖或浏览器、切换运行时版本、启动长期服务、申请网络/端口权限、执行截图或 UI 自动化，也不得重复步骤 6 已完成的端到端测试。遇到 `EPERM`、网络受限、缺少浏览器等环境限制时，将对应项标记为“人工待验证”并停止扩展排查；不得据此推断代码或运行时兼容问题。只有用户明确要求继续扩展验证时，才展示拟执行动作并按原确认规则处理。

步骤 3 至步骤 7 的必要依据、配置摘要、代码修复、网站回跳或按量付费联调在本轮无法继续时，跳过所有依赖该失败事实的后续动作，但仍进入本步骤：把未满足条件和被跳过动作按实际证据标记为失败或人工待验证，并使用同一 `integration.checklist.result` 收口。不得为了生成结果重新执行已阻断的外部动作。该 runner 只能在当前产品匹配且未收口的 `integration_only|full_process` active run 内执行；缺少或不匹配业务 run 时直接停止，禁止完成 checklist 后静默丢失 `integration.complete_coding`。`full_process` 中，只有沙箱为 `CREATE_PENDING|VERIFY_PENDING` 且代码实现与不依赖沙箱的安全检查均通过、或沙箱为 `READY` 且仅剩非阻塞人工待验证项时，才在输出标准“部分通过”结果后继续 onboarding；存在其他代码、安全或必要依据失败时仍停在代码开发。

校验项包括：
- 签名验签
- 异步通知
- 异常处理

> 详细校验清单已附在当前阶段 bundle 的“当前产品适用校验清单”。

**验收阶段边界**：本轮代码开发按沙箱集成验收；checklist 第七节中尚未开通产品或尚未取得、切换生产实值的检查，记为当前阶段不适用并保留上线前待办，不计入失败项或人工待验证项，不单独阻止 Onboarding。仍须检查生产配置加载边界、环境隔离和所有适用代码/安全控制；已发现的实现缺陷、泄露或环境混用仍是阻断缺口。不得为完成本轮检查索取生产私钥、提前改用生产配置或宣称生产就绪。

**校验完整性要求**：内部必须覆盖当前 bundle 中适用于目标产品的密钥与安全、异步通知、接口覆盖、支付结果处理、按量付费专项、退款、上线前和结果输出章节，不得只检查上方三个摘要项。checklist 校验结果段落：通过时只输出通过结论和下一步；完整接入部分通过或未通过时只输出实际未完成项、人工待验证项和下一步；仅代码开发不展示“未完成项”“人工待验证”独立标签，将实际失败问题及下一步放在【当前状态】，需核实事项只在上线关键点内列一次；仅代码开发另由同一 renderer 追加下述最终摘要。联调或付款体验结论不重复展开；仅网页收款在仅代码开发的最终 checklist 上线关键点前展示步骤 5 已交付摘要中的三项买家信息，完整接入则留到 Onboarding 最终总收口；按量付费与 APP 支付最终 summary 不展示沙箱配置。通过项与不适用项无需逐行展开，用户要求明细时再输出完整逐项结果。精简输出不得导致任何适用校验被跳过。

先汇总 checklist 证据；本轮可修复时按上述有限修复预算处理，只定向复检受影响项，不渲染中间结果。项目快照变化会使旧 `CHECKLIST_SCOPE_RECEIPT` 失效，必须重新加载本阶段并重跑受影响检查。

项目不再变化且准备生成最终结论时，按 `aipay=AIPAY`、`webpay=WEBPAY`、`apppay=APPPAY` 得到 `PRODUCT_VARIANT`。下方唯一 runner 会重算项目快照、校验 scope，并执行固定 implementation audit；审计只读非测试生产源码，检查核心接口标记和登记的高置信度危险模式，不替代完整 checklist，也不接受 Agent 审计 receipt。

静态审计 findings 含绑定当前产品与项目快照的 id。Agent 应核对实际生产代码；误报可向同一 checklist-result 追加 `--audit-review '<JSON数组>'`，每项格式为 `{"findingId":"<id>","decision":"FALSE_POSITIVE|CONFIRMED|UNRESOLVED","evidence":[{"path":"项目内相对生产源码路径","line":1,"reason":"具体单行核对依据"}]}`。runner 校验当前快照、唯一 id 与非空源码位置；只有 FALSE_POSITIVE 排除对应静态疑点，未复核、确认缺陷及未排除疑点仍阻断。实际工程检查失败/缺失不能用此参数排除。项目变化后必须使用新 scope 和新 findingId。

若审计发现问题且命令未传 `--finalize-audit-findings true`，stdout 为空，stderr 只接受唯一 `ALIPAY_AIPAY_INTERNAL:CHECKLIST_AUDIT={state:"REPAIR_REQUIRED",findings:[...]}`。本轮仍有修复预算时先修复，只定向复检受影响项，重新加载 checklist 阶段取得新 scope，再用更新后的实际证据执行同一结论命令，禁止渲染中间结果。预算耗尽、无进展或无法修复时向同一命令追加 `--finalize-audit-findings true`，runner 将 findings 合入“未通过”并收口；该内部重跑不新增用户操作点。`full_process` 必须停在 Integration。

对客结论统一使用 `integration.checklist.result`；整体结论、失败/部分通过项和人工待验证项必须来自最终一轮 checklist 实际证据。最终渲染成功时必须产生唯一 `ALIPAY_AIPAY_INTERNAL:CUSTOMER_MESSAGE_DELIVERY_REQUIRED=integration.checklist.result`；命令返回后的下一动作先将 stdout 原文独立送达，不得以工具面板或自写总结替代。首次调用前先按以下完整契约确定参数，禁止改枚举：

- `variant` 映射 `aipay=AIPAY`、`webpay=WEBPAY`、`apppay=APPPAY`；`overallResult` 只允许“通过、部分通过、未通过”。
- `failedItems`/`manualItems` 必须是含下一步的受控单行值，无项目传“无”。先按证据分类：单纯尚无公网 `notify_url` 属于通用上线提醒，用户尚未自愿完成沙箱付款属于可选体验，两者不得进入 `failedItems`、`manualItems` 或影响完成判定的待办；付款入口及完整指引按步骤 6 的产品与实际链接条件交付；按量付费远端异常未生成真实付款链接时，不把可选体验的缺席计入失败项。实际 UI／已选通知链路证据缺口，以及按步骤 6 已核实且仅来自按量付费沙箱远端的联调异常，进入 `manualItems` 并保留部分通过，代码／安全缺陷进入 `failedItems` 并按原门禁处理。不得为每个项目固定添加 UI 或通知幂等待验证项；不得仅因沙箱摘要未展示而改变分类。renderer 拒绝把上述通用提醒、可选体验作为缺口的旧输入；遇到分类错误只修正结果参数，不重新执行已完成检查。`sandboxConfigState` 只允许 `READY|CREATE_PENDING|VERIFY_PENDING`；除沙箱配置及其直接依赖外存在代码、安全或必要依据缺口时 `blockingDefectState=PRESENT`，否则 `NONE`。待配置时 `failedItems` 必须列出沙箱配置及依赖动作未完成；恢复口令只由步骤 1/3 已发送的 `sandbox.configuration.pending` 正文提供。
- `executionMode`：`integration_only` 固定“仅代码开发”，`nextFlowReminder` 固定“正式上线前还需完成支付产品-产品开通。”。`full_process` 固定“完整接入”：`READY` 且“通过”时提醒“代码开发校验通过后将自动进入支付产品-产品开通；未通过时停留在代码开发。”；沙箱待配置且 `blockingDefectState=NONE` 时提醒“沙箱配置尚未完成，但不阻塞本轮继续支付产品-产品开通；完成配置后再进行沙箱测试。”；`READY`、`failedItems=无` 且仅有人工待验证项时提醒“代码开发自动校验已完成，仍有人工待验证项；本轮继续产品开通。”，并把 `manualItems` 原样带入 Onboarding Step 6。存在开发阻断时，最终消息列明失败项和可选下一步。自动交接停在开发阶段；商家明确要求先开通时按独立办理进入，保留此前的实际开发结果。
- 仅 `AIPAY` 传 `sandboxResult`：步骤 6 端到端联调通过为“AI 按量付费沙箱服务端联调通过”，否则为“AI 按量付费沙箱服务端联调未通过”。仅 `WEBPAY` 传 `webpayExperienceResult`，按步骤 6 证据从三个登记值中选择：已提供入口指引且待用户实际付款、未提供完整入口指引、或用户已完成一笔沙箱付款且结果有核验证据。`APPPAY` 不传这两个参数。

必须从本 flow 所在目录执行当前产品对应单行 runner；runner stdout 是唯一对客正文，必须把 stdout 原文作为当前回复正文发给用户：

<!-- ALIPAY_AIPAY_PRODUCT:aipay:START -->
<!-- ALIPAY_AIPAY_BRANCH:INTEGRATION_CHECKLIST -->
<!-- ALIPAY_AIPAY_PRODUCT:END -->
<!-- ALIPAY_AIPAY_PRODUCT:webpay:START -->
<!-- ALIPAY_AIPAY_BRANCH:INTEGRATION_CHECKLIST -->
<!-- ALIPAY_AIPAY_PRODUCT:END -->
<!-- ALIPAY_AIPAY_PRODUCT:apppay:START -->
<!-- ALIPAY_AIPAY_BRANCH:INTEGRATION_CHECKLIST -->
<!-- ALIPAY_AIPAY_PRODUCT:END -->

用户输入计数严格继承 `runtime-entry.md`：active run 内每条聊天框用户消息先执行唯一 `count-user-input --run-id "$RUN_ID" --input-id "$USER_INPUT_ID"`，不按 Skill 相关性筛选；runner、renderer 和 checklist 不做隐式计数。checklist 生成 `integration.complete_coding` 和 `integration_summary` 前使用同一个 `HISTORY_COUNT` 快照，正式值始终由 runtime counter 写入，禁止传入或覆盖 `user_input_after_clarify_intent`。

同一次代码开发流程只渲染一次最终 checklist 结果；renderer stdout 是本次默认收口的唯一对客正文。禁止在前后追加风险说明、通过项摘要、执行说明、衔接提醒或第二份待办。

最终摘要：仅代码开发时，runner 在 checklist 结论后统一输出【当前状态】、符合条件时的【沙箱测试配置】、【上线前有以下关键点】和【提示】。仅网页收款在 `sandboxConfigState=READY` 且步骤 5 的配置后置校验与摘要交付成功、当前实际配置未变化时，传 `--sandbox-summary "$SANDBOX_SUMMARY"`；没有有效原摘要时省略该参数，不读文件、不重建沙箱、不编造字段。最终回放遇到原摘要缺失、过期、格式异常或校验失败时，只省略【沙箱测试配置】，严禁阻塞其余 summary 对客正文；首次配置校验和实际业务门禁保持不变。该区块仅保留沙箱买家测试账号、沙箱买家登录密码、沙箱买家支付密码三项，密码明文展示（含 Windows），不展示产品、配置路径、appId 或密钥行，不表示付款测试通过。按量付费与 APP 支付不得传此参数，不展示该区块。完整接入的中间 checklist 禁止传该参数、禁止提前重复上线清单，原摘要保留给 Onboarding Step 6。传参使用宿主进程参数数组或安全引用，不把多行正文嵌入手写 Shell/JSON。

这些产品专属字段只用于 renderer 校验最终结论，不在 checklist 对客结果中重复展示。APP 支付未来沙箱测试对客引导的维护 TODO 只保留在消息目录对应变体，不得渲染给用户；补充时必须同步本 flow、`modules/acquiring/checklist.md` 和测试。

**完成语义**：只有步骤 1-8 的适用完成条件均满足且 `sandboxConfigState=READY` 后，才可声明支付产品-代码开发完成。沙箱待配置但代码实现与其余检查通过时只能输出“部分通过”，不得改写为完成；存在其他未通过项时输出“未通过”；若配置已就绪且仅剩无法自动验证项，输出“部分通过”并登记人工待验证项，不得改写为完成或生产就绪。

完成结论必须逐项来自本轮实际检查。配置内容、当前语言字段选择、实际加载路径/加载器或适用保护变化导致旧证据失效时，只复检受影响的配置项；证据仍有效时复用步骤 3/5 的实际结果，不因进入步骤 8 再做一遍。Windows LEGACY/CODE_ONLY 手工配置沿用原位检查方式，不改用快速沙箱脚本；Windows READY 使用与 Unix/macOS/Linux 相同的登记复核入口。沙箱待配置时复用实际终态、跳过依赖动作，不读取、创建或循环复核配置。按量付费联调只接受步骤 6 本轮 `run --auto-complete --require-payment-validation` 的实际成功，不重复联调；不得由 Agent 自填 `PASS`。

仅 Unix/macOS/Linux 或 Windows READY 的快速沙箱原为 `READY`、且配置内容/文件保护证据失效需要重新校验时，按本轮有限预算执行一次固定命令；仅加载器变化时定向审查加载器及 SDK 映射，不因此重验原始配置：

```text
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" sandbox reverify "$PROJECT_PATH" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

只接受唯一 `ALIPAY_AIPAY_INTERNAL:FLOW:SANDBOX_CONFIG_READY` 或 `ALIPAY_AIPAY_INTERNAL:FLOW:SANDBOX_CONFIG_PENDING_VERIFY` 及成功退出。前者复用更新后就绪证据，后者更新为 `VERIFY_PENDING`、交付脚本已有待配置正文并停止沙箱依赖动作；异常或不可唯一解析时保留阻断事实并收口，不猜测就绪、不换命令追加尝试。该动作不创建配置，不修改原脚本内部重试预算；项目内容因此变化时仅刷新 scope、复检受影响项，不全量重测。

**沙箱结论边界**：步骤 8 的代码与配置校验不得把步骤 3 的字段完整性、网站支付的付款指引或 APP 支付跳过步骤 6 改写为“沙箱测试通过”。只有按量付费步骤 6 已取得完整端到端成功证据时，最终摘要才可复用该测试结论。

---

## 问题排查（按需加载）

仅在用户报告报错、错误码、问题、排查、调试或异常时读取 `modules/acquiring/troubleshooting-flow.md`；正常路径不得预加载。先确认产品，有错误码时再确认接口；禁止猜测密钥格式、MCP 方法或业务规则。

---

## 代码开发完成确认

- `integration_only`：仅由 `integration.checklist.result` 输出未通过项、人工待验证项和产品开通提醒，不追加第二份话术。
- `full_process`：全部适用步骤通过后，经[完整接入交接](../normal/full-process-routing.md)进入当前产品开通阶段；仅沙箱待配置，或沙箱 `READY` 且仅剩非阻塞人工待验证项时，以“部分通过”继续并保留未完成事实。其他代码、安全或依据缺口停在 Integration，不提前执行 Onboarding。
- 未通过时不得宣称完成；沙箱状态不得被产品开通结果覆盖。
<!-- ALIPAY_AIPAY_FLOW:INTEGRATION_CHECKLIST:END -->
