# 支付产品-代码开发流程

> ⚠️ **前置声明**：本 flow 仅支持**网站支付、APP 支付、按量付费**三种产品的集成。**其他产品（当面付、订单码支付、JSAPI支付、预授权支付、商家扣款等）暂不支持**，如需集成请前往[支付宝开放平台](https://open.alipay.com/)查阅相关文档。

---

## 按步读取

从本 flow 顺序执行；步骤 1 读 `../normal/alipay-cli-env.md`，按本步骤固定协议执行匿名沙箱准备，不提前读取原始 MCP 响应示例或自行解析沙箱配置；步骤 2 读 `modules/product-decision.md`；步骤 3/5 按需读 `modules/sandbox/sandbox-setup-guide.md`；步骤 4/5 读 `modules/alipay-sdk-reminder.md`、`modules/interface-guide.md`、当前产品本地契约和当前语言示例；步骤 6 仅按量付费读 `modules/sandbox/a2m-sandbox-test.md`；步骤 8 读 `modules/checklist.md`。无关产品、语言、维护说明和尚未到达的模块不提前加载。

---

## ⛔ 强制执行要点

先确认唯一目标项目和服务端语言，再执行步骤 1 的匿名沙箱准备；该步骤不依赖目标支付产品，不传 `PRODUCT`，配置缺失时创建、已存在时只复核，也不对客展示沙箱摘要。既定重试耗尽后记录本轮 `CREATE_PENDING` 或 `VERIFY_PENDING`，立即使用脚本托管消息告知沙箱配置尚未完成并继续代码开发；该状态只阻止沙箱字段使用、配置后置校验、摘要、联调和付款体验，不阻止产品确认、代码实现或无沙箱依赖的产品开通。随后完成步骤 2 启动确认再修改项目代码：`integration_only` 与 `full_process` 都由同一个固定项目检查器生成项目来源、代码状态和其他支付产品事实，并使用同一个 `integration.start.confirm` 展示产品、项目事实、语言/框架和服务声明；实际工作范围始终固定取自本 flow。一次只开发一个支付产品。按“按步读取”加载当前事实并逐步核验证据，禁止假数据、占位值冒充、催促推定同意或无依据结论。网站支付/APP 支付必须实现下单、交易查询、退款、退款查询、关闭交易和异步通知；按量付费只实现 402、验付与履约确认，不混入通用收单接口。本流程不主动发起真实生产交易。

生产参数必须保证 `appId`、应用公钥、应用私钥属于同一套密钥，私钥格式匹配当前语言；格式不匹配只使用支付宝官方密钥工具转换。网站支付/APP 支付即使本地暂无公网 HTTPS `notify_url` 也必须实现通知处理代码；本地验收可暂不传通知地址并用查询确认结果，但上线前必须恢复公网通知并完成验签、幂等、关键字段校验、成功回写和补偿查询，不能提前宣称生产就绪。

### 标准消息执行规则

本 flow 的标准对客消息必须通过 renderer 或托管脚本输出，禁止 Agent 只看到消息 ID 后自行改写。动态值必须先保存在 shell 变量中，再由当前位置的完整命令使用 `jq -cn --arg` / `--argjson` 生成 `MESSAGE_INPUT_JSON`；禁止把动态值替换进单引号 JSON 或命令文本。变量只来自本轮实际项目、脚本输出、校验结果或用户确认；无变量时传 `{}`：

```bash
node ../normal/scripts/render_customer_message.mjs --schema <messageId> --variant <VARIANT>
printf '%s' "$MESSAGE_INPUT_JSON" | node ../normal/scripts/render_customer_message.mjs <messageId> --variant <VARIANT>
```

直接调用 renderer 前必须先用同一 `messageId` + `variant` 查询 schema，按 `inputVariables` 构造 JSON；托管 runner 或脚本已经封装 schema 映射时必须执行 runner/脚本，禁止退回临时 `jq` + renderer 链。renderer 报错时停止当前步骤，先复查 schema 再修正入参或改用 schema 标出的托管入口，不得输出手写兜底文案，也不得连续猜测近似枚举。renderer stdout 是当前动作唯一对客正文；工具输出记录、折叠面板或日志不等于已对客发送，Agent 必须把 stdout 原文作为当前回复正文发给用户。禁止在前后添加“已输出/已打印/已渲染”、`runner stdout`、步骤名、消息 ID、控制标记、摘要或转述；阻塞消息发出后立即停止本轮并等待用户。`integration.start.confirm` 和 `integration.checklist.result` 必须使用 `integration_message_runner.mjs`；`sandbox_config.sh summary` 等脚本托管消息必须执行对应脚本，由脚本内部渲染；不得绕过脚本自写沙箱摘要或校验结论，也不得只说明脚本已展示、已渲染或已输出。固定脚本退出码和本步骤登记的终态标记满足后必须立即转移，禁止为“再确认一下”追加命令重复检查同一事实。

**工作目录规则**：本文件代码块和行内命令中的 Skill 相对路径一律以本文件所在的 `references/integration/` 目录解析；执行工具支持 `workdir` 时将 Skill 命令的 `workdir` 设为该目录。用户可以用“当前项目”、当前目录下相对路径或绝对路径说明项目位置；进入检查器、沙箱脚本、代码写入或项目命令前，必须先解析并确认规范化绝对路径。用户项目检测、依赖、代码、配置、服务启动和项目校验命令仍以已确认项目根目录为 `workdir`。两类命令不得共用一个隐含 cwd；Skill 脚本需要项目时传入规范化绝对路径。

### 服务声明执行护栏

服务声明和代码开发启动确认的完整对客正文只在 `../normal/customer-messages.json` 的 `integration.start.confirm` 三个产品变体中维护；`integration_only` 与 `full_process` 使用同一消息和同一结构化项目事实。本 flow 只约束执行位置：步骤 2 必须复用当前执行模式唯一有效的 renderer stdout 和确认，不得在其前后另行输出、缩写、改写、总结或拼接服务声明。快速沙箱凭据例外继续受 `P-SANDBOX-CREDENTIAL-EXCEPTION` 和沙箱模块约束。

---

## 阻塞确认点索引

<!-- GENERATED:INTEGRATION-GUARDS:START -->
<!-- 此区块由 scripts/generate-skill-guards.mjs 生成，禁止手改 -->
### 生成式执行护栏

- `P-MCP-CONTRACT-FROZEN`：只执行当前 Skill 已验证脚本中的 MCP 方法、参数和解析；禁止推断、改名、替换或尝试近似方法。
- `P-A2M-SANDBOX`：按量付费沙箱 serviceId 固定为 api_mock_service_id，SDK 使用沙箱网关；生产网关和真实 serviceId 只用于正式配置。
- `P-A2M-SUCCESS`：自动联调只有在 HTTP 200、非空可归属资源、无明确业务失败且适用 Payment-Validation 有效时通过。
- `P-SANDBOX-CREDENTIAL-EXCEPTION`：Unix/macOS/Linux 只允许快速沙箱实际返回且已校验的买家登录/支付密码在沙箱摘要和付款体验中经 stdin 临时渲染。Windows 手工沙箱允许用户在 sandbox.windows.manual_setup 后提供当前沙箱应用的 APPID、支付宝公钥、应用公钥、与当前开发语言匹配的应用私钥和沙箱账号信息；Agent 只能将其用于已确认目标项目的受保护配置，不得在回复、摘要、普通日志或业务状态中复述或另存原文。两类例外均不得扩展到生产环境账号、应用私钥或密码。
- `P-SENSITIVE-STATE`：用户可以为当前应用设钥明确提供应用公钥，但该输入只用于本次 app.sh key/verify-key 调用；Agent 回复、对话摘要、普通日志、跨会话状态和宽权限临时文件禁止复述或保存公钥原文。除 P-SANDBOX-CREDENTIAL-EXCEPTION 明确允许的 Windows 手工沙箱当前资料输入外，私钥、token、Payment-Proof、签名串、完整支付表单和未脱敏 MCP 响应同样禁止进入这些位置。临时 URL 只有在 flow 明确登记、已由脚本或 renderer 完成白名单及当前上下文校验且当前动作必须对客展示时，才允许进入该动作的唯一对客正文；即使获准展示，也禁止进入对话摘要、普通日志、跨会话状态或宽权限临时文件。
- `P-PROJECT-PROTECT`：不得清空、覆盖或删除用户既有项目；只在已确认目标路径和范围内做必要修改。
- `P-CUSTOMER-OUTPUT-EXCLUSIVE`：flow 指定 renderer 或托管脚本时，其 stdout 是该动作唯一对客正文；工具输出记录、折叠面板或日志不等于已对客发送，Agent 必须把 stdout 原文作为当前回复正文发给用户。禁止在前后添加执行说明、消息 ID、控制标记、摘要、转述或近似话术。阻塞消息发出后立即停止本轮并等待用户。
- `P-DETERMINISTIC-HANDOFF`：flow 已登记脚本或 renderer 时只执行动作发生位置的固定命令；退出码和登记终态标记满足后立即按 flow 转移，禁止追加 jq、cat、grep、curl 或临时脚本重复解析、复核或解释同一结果。失败只走登记恢复分支；项目代码实现和运行验证除外，但不得把沙箱配置或其他敏感文件打印到工具输出。
<!-- GENERATED:INTEGRATION-GUARDS:END -->

| 位置 | 触发时机 | 等待内容 |
|------|----------|----------|
| 步骤 2 | 产品决策后 | 用户同意服务声明并确认开发特定支付产品 |

> 步骤 6 中，按量付费沙箱测试是沙箱配置就绪后默认自动执行的完成质量门；网站支付在沙箱配置就绪时必须在收尾前向用户提供人工沙箱付款入口和操作说明，但不强制用户当场付款；APP 支付跳过步骤 6。沙箱为 `CREATE_PENDING|VERIFY_PENDING` 时跳过全部沙箱依赖动作，不增加用户确认。步骤 8 的代码开发校验默认自动执行，不作为可选阻塞确认；无法自动验证的项目必须逐项标记为人工待验证。步骤 1 的沙箱字段完整性校验只证明配置可用，不是沙箱支付测试，三类产品都不得据此输出“沙箱测试通过”或等价结论。

---

## 完成条件规则

每条完成条件使用正文中的唯一稳定 ID，并在步骤 8 按当前产品和本轮实际证据逐项检查。新增、删除或调整条件时同步正文与 `modules/checklist.md`，不维护“共有 N 项”或步骤数量索引。缺失证据固定为待验证，禁止为了结束流程推断通过。

---

## 📖 接口契约路由

当前产品的本地契约、示例路径和官方 `sourceUrl` fallback 入口见 `modules/interface-guide.md`。在线文档只在本地依据缺失、字段不确定、排查官方错误码、用户明确要求或官方能力变化时读取。

---

## 功能路由

根据用户意图判断：

| 用户意图 | 处理方式 |
|----------|----------|
| 需要开发支付产品代码 | 进入支付产品-代码开发流程 |
| 代码开发中遇到报错 | 进入问题排查流程 |

---

## 支付产品-代码开发流程

### 目标项目执行上下文

进入步骤 1 前先确定唯一的规范化目标项目根目录和服务端语言，后续所有用户项目检测、依赖安装、代码与配置写入、服务启动和项目校验命令都必须以该目录为工作目录。用户不需要手写绝对路径；可以选择新建项目，或复用已有项目。新建项目可以说明尚不存在或为空的新目录；若用户明确要新建但不想指定位置，runner 使用用户目录下的默认安全目录并返回规范化地址。复用已有项目必须说明具体项目文件夹，或先让 Agent 在当前目录或用户给出的子目录下定位候选项目。“当前项目/当前目录”只有在 runner 确认当前目录本身是可识别项目根时才接受；否则不得把大目录交给代码扫描。Agent 必须先从本 flow 所在目录调用 `../normal/scripts/integration_message_runner.mjs resolve-project` 或 `locate-projects` 取得规范化事实，再继续检查器和确认链路。Skill 内置 renderer、脚本和参考文件按上方“工作目录规则”从当前文档目录定位，不受目标项目 cwd 影响。禁止因为 Agent 的原始工作目录更方便而改用其他项目，也禁止把临时目录中的产物误报为目标项目产物。

- `full_process`：步骤 1 前置准备先继承 `../normal/full-process-routing.md` 已选定的项目来源、规范化项目路径和服务端语言，此时代码开发启动确认尚未发生，不得要求目标产品或代码状态；产品确定、项目扫描并完成唯一启动确认后，进入步骤 2 时继承同一摘要中的目标产品、项目选择分类、目标产品集成状态、其他支付产品、语言和框架。两个阶段都不得重新猜测或静默改选项目。
- `integration_only`：优先从当前可访问业务项目确定根目录；当前目录不是可识别项目根、存在多个候选或用户要求其他/新项目时，先让用户选定并确认规范化路径，不得自行选择或扫描上层大目录。当前目录内已选定的现有项目分类为 `CURRENT_PROJECT`，用户指定的其他现有路径分类为 `OTHER_PROJECT`；本轮按下条规则初始化成功的新项目在完成步骤 1 后分类为 `PREPARED_NEW_PROJECT`。该分类只用于本轮检查器输入，不持久化。
- 已有项目：进入任何写操作前确认目标路径可读、在当前 Agent 权限范围内可写、包含可识别项目根标记，且仍对应用户选定的业务项目；需要环境文件权限时按当前权限机制申请，无法取得权限、路径失效或实际项目不符时停止，要求用户提供可访问路径或重新选择项目。完整保留项目结构、已有文件和其他支付能力，只对当前目标产品需要的位置做可审查的局部修改，禁止先删除文件再重建。
- 新项目：用户可以说明“在当前目录新建 pay-demo”、当前目录下的新子目录名、绝对路径，或只说“新建/新建项目/帮我新建默认项目”。目标路径必须先从本 flow 所在目录执行 `node ../normal/scripts/integration_message_runner.mjs resolve-project --project-input "$PROJECT_INPUT" --base-path "$USER_WORKSPACE_ROOT" --intent new`；该 runner 内部调用固定检查器 `prepare-new`。用户明确要新建但未指定地址时，runner 默认选择用户目录下的 `alipay-aipay-projects/pay-demo`；若已被非空目录占用，则自动选择安全后缀，不清空或覆盖。只有退出码 0 且唯一 JSON 同时满足 `projectSelection=NEW_PROJECT`、`projectOrigin=NEW_PROJECT`、`projectOriginLabel=本轮新建项目`、`preparationStatus=READY`，才能继续确认目标路径或其最近已有父目录在当前 Agent 权限范围内可写。路径非空、预检失败或无法取得写权限时停止，保留其中全部内容，让用户改选明确的空子目录、空同级目录、默认项目或其他尚不存在或为空的目录，禁止清空、覆盖或把该目录强行当作新项目。步骤 1 前只确认创建项目必需的技术栈，不要求用户先确定支付产品；收到针对当前路径和技术栈的明确回复后，才能按确认方式创建目录和初始化项目。创建命令只能来自用户指定方式、可访问模板/项目中的既有命令或本轮已读取的官方文档，且不得使用 `--force` 等覆盖既有文件的选项；禁止凭记忆编造脚手架、依赖或默认工程结构。初始化并完成步骤 1 后，当前会话分类单向转为 `PREPARED_NEW_PROJECT`；重新进入时只按现有项目重新分类，不读取历史状态。
- 项目准备失败时停留在步骤 1 前置准备，输出实际错误和待补条件；不得进入沙箱准备。目标项目准备成功后记录实际根目录，步骤 1、步骤 3 的沙箱配置和后续代码必须落入该项目；沙箱配置不得降级写入系统临时目录、Agent 原始工作目录或其他项目。

**项目选择保护规则**：当前目录已包含项目时，只能让用户选择“保留并在该项目新增目标支付能力”“保留并在指定的新子目录创建独立项目”或“保留并使用指定的其他路径”，不得展示清空或删除选项。用户只回复“新建”或“新建项目”时，属于明确新建但未指定地址，必须执行 `resolve-project --intent new` 走用户目录默认项目规则并返回规范化地址；不得反复要求用户补绝对路径。对 `full_process`，此时必须留在或返回 `../normal/full-process-routing.md` 主编排，取得 `NEW_PROJECT` 的规范化路径、技术栈和初始化结果前不得进入子流程；对 `integration_only`，取得可安全创建的新项目路径前不得进入沙箱准备或代码开发。取得并确认尚不存在或为空的精确路径前不得执行文件操作。

**启动前上下文补问**：缺少项目位置或技术栈时，必须从本 flow 所在目录执行下列标准消息，一次补齐；只缺少新项目精确位置时仍使用上方 `integration.project_path.required`。禁止使用 AskUserQuestion、request_user_input、宿主超时默认值、Agent 自创选项或自由话术替代；用户未明确补齐前不得创建目录、初始化项目、安装依赖或修改文件。

```bash
MESSAGE_INPUT_JSON=$(jq -cn --arg missingItems "$MISSING_ITEMS" '{missingItems:$missingItems}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../normal/scripts/render_customer_message.mjs integration.context.required --variant DEFAULT
```

`MISSING_ITEMS` 只允许由 `项目路径`、`技术栈` 按缺失项用顿号连接生成。产品不明确时使用 `product.clarify`，不得混入本消息。该消息必须把 stdout 原文作为当前回复正文发给用户，发出后立即停止并等待用户自由回复；用户回复后重新计算缺失项，不得靠超时或默认值推进。用户回复“当前项目”、相对路径或新建子目录时，先执行 `resolve-project` 得到规范化绝对路径和 `projectSelection`，再进入后续检查器、沙箱准备和启动确认；相对路径必须位于 `--base-path` 内，目录外项目必须由用户提供绝对路径。

用户回复“不知道项目在哪”“帮我找项目”、提供子目录但该目录不是项目根，或当前目录解析失败且需要候选时，从本 flow 所在目录执行下列轻量定位命令。`SEARCH_INPUT` 取用户给出的搜索范围；未给出时固定为 `当前目录`。该命令只查找项目标记文件并跳过常见重目录，不扫描源码内容；stdout 是本动作唯一对客消息，发出后立即停止并等待用户选择候选序号、具体目录或新建目录。用户选择候选后，仍必须再执行 `resolve-project --intent existing` 取得规范化绝对路径；候选列表不能直接替代项目确认。

```bash
node ../normal/scripts/integration_message_runner.mjs locate-projects \
  --base-path "$USER_WORKSPACE_ROOT" \
  --search-input "$SEARCH_INPUT" \
  --format message
```

**破坏性操作二次确认**：本支付产品-代码开发流程本身不得删除用户既有文件。用户另行主动要求删除具体文件时，先停止代码开发，列出每个精确规范化路径和不可逆影响，再在独立轮次等待用户逐项确认该清单；此前的完整接入启动确认、步骤 2 确认、服务声明确认及任何含糊回复均无效。未取得二次明确确认时严禁调用删除、清空、强制覆盖或等价命令；即使确认，也禁止删除项目根目录、`.git`、使用通配符或触及清单外文件。

**执行边界**：本流程只操作用户当前确认的项目路径、语言、框架、产品和范围。步骤 1 只使用项目路径和语言，不依赖产品；步骤 2 后的代码修改才依赖已确认产品。沙箱配置与测试结论来自本轮实际脚本结果，不得被 onboarding 的正式 `appId`、支付宝公钥或 `productionServiceId` 覆盖。

### 步骤 1：环境检查与匿名沙箱准备

**任务**：在确定具体支付产品前，完成 alipay-cli 检测并尝试准备匿名沙箱配置；配置缺失时创建，已存在时安全复核，既定重试耗尽后记录待配置状态并继续代码开发

**完成条件**：
- [INT.ENV.CLI_READY] 已按 `../normal/alipay-cli-env.md` 完成 alipay-cli 检测与安装
- [INT.ENV.PROJECT_LANGUAGE_READY] 已确认唯一目标项目路径和服务端语言，且目标项目包含已确认语言的构建标识
- [INT.SANDBOX.OS_DETECTED] 已检测用户操作系统类型
- [INT.SANDBOX.PREPARATION_RECORDED] Unix/macOS/Linux 已从固定脚本取得唯一 `READY|CREATE_PENDING|VERIFY_PENDING` 终态。`READY` 时配置已安全落盘或复核；待配置不是成功，不满足任何沙箱配置、测试或生产就绪条件，但本步骤允许继续产品确认和代码开发
- [INT.SANDBOX.WINDOWS_PROVIDED] Windows：已使用标准消息一次收集用户从支付宝开放平台取得的当前沙箱资料，Agent 已将校验通过的资料写入已确认项目的受保护本机配置；未要求用户自行配置或理解、执行 Skill 内部脚本

**执行规则**：

1. 只确认创建和保存沙箱所需的目标项目路径、服务端语言与操作系统；不得为了创建匿名沙箱先要求用户确定支付产品。缺少多个字段时使用“启动前上下文补问”的固定标准消息一次补齐；字段已能从用户输入和项目事实确定时，不发送环境、项目识别或准备进度消息。
2. Unix/macOS/Linux 从本 flow 所在的 `references/integration/` 目录执行唯一准备入口：

```bash
bash modules/scripts/sandbox_config.sh ensure "<规范化项目路径>" "<已确认服务端语言>"
```

3. Windows 执行下列标准消息，一次收集当前沙箱应用的 APPID、支付宝公钥、应用公钥、与已确认服务端语言匹配的应用私钥和沙箱账号信息。该消息使用自由资料回复，不要求用户输入 `1` 或自行配置项目。资料缺失或校验失败时只补问缺失、错误字段；全部字段校验通过后，Agent 直接写入目标项目实际使用的本地敏感配置，并建立适用的版本控制忽略和访问保护。该例外只适用于当前沙箱资料；生产环境应用私钥和密码禁止提供给 Agent。Agent 不得在回复、摘要或普通日志中复述收到的值：

```bash
printf '%s' '{}' \
  | node ../normal/scripts/render_customer_message.mjs sandbox.windows.manual_setup --variant DEFAULT
```

4. Unix/macOS/Linux 的 `ensure` 只依据同一目标项目的 `.alipay-sandbox.json` 当前事实分流：文件不存在时执行既有 `create`；文件存在或为符号链接时执行既有 `verify` 安全路径。已存在配置不得再次调用 `createAnonymousSandbox`、不得覆盖，也不得因为中断重来要求用户删除配置；无效、不安全或被 Git 跟踪时不得使用，脚本按待配置终态统一输出后继续代码开发。
5. 只有 Unix/macOS/Linux 创建分支会调用冻结的 `alipay-anonymous-sandbox.createAnonymousSandbox`、`{"request":{"appType":"PUBLICAPP"}}`、`PLATFORM` 环境变量和 `result.content[0].text -> success -> data` 解包逻辑；禁止传入 `PRODUCT`。Windows 不调用该方法或 `sandbox_config.sh`。
6. Unix/macOS/Linux 只接受以下互斥终态，不能把待配置标记当作成功：
   - `READY`：退出码为 0；唯一 `SANDBOX_ENSURE_ACTION=CREATED|VERIFIED`；唯一 `SANDBOX_CONFIG_PATH=<同一目标项目绝对路径>/.alipay-sandbox.json`；唯一 `FLOW:SANDBOX_CONFIG_READY`。
   - `CREATE_PENDING`：退出码为 0；脚本已渲染唯一 `sandbox.configuration.pending/CREATE` 正文；唯一 `SANDBOX_PENDING_PATH=<同一目标项目绝对路径>/.alipay-sandbox.json`；唯一 `FLOW:SANDBOX_CONFIG_PENDING_CREATE`；不得出现 READY 标记。
   - `VERIFY_PENDING`：退出码为 0；脚本已渲染唯一 `sandbox.configuration.pending/VERIFY` 正文；唯一 `SANDBOX_PENDING_PATH=<同一目标项目绝对路径>/.alipay-sandbox.json`；唯一 `FLOW:SANDBOX_CONFIG_PENDING_VERIFY`；不得出现 READY 标记。
7. 命中 `READY` 后不发送“环境检查完成”“沙箱已创建/已复核”等对客消息，记录 `sandboxConfigState=READY` 并直接进入步骤 2；命中待配置终态时，脚本 stdout 已包含唯一对客正文，Agent 不得转述，分别记录 `sandboxConfigState=CREATE_PENDING|VERIFY_PENDING` 后直接进入步骤 2。两类终态都禁止追加 `jq`、`cat`、`grep`、`ls`、`stat` 或临时脚本；待配置状态还禁止读取、引用或复制当前无效/不存在配置中的任何字段。
8. 命令非 0、终态标记缺失/重复/冲突、路径不一致或输出含 `SANDBOX_ERROR` 时属于脚本执行协议失败，仍停留在步骤 1；不得把这种执行异常降级为待配置，也不得临场改写 jq、重放原始 MCP 命令或自行检查敏感配置。Windows 配置检查未通过仍按 Windows 登记分支处理。项目内自建 JSON、Agent 自报或补充诊断结果都不能替代上述终态。
9. 准备阶段不得渲染 `sandbox.environment.summary` 或 `sandbox.environment.reminder`，不得展示沙箱买家密码，也不得输出“沙箱测试通过”。只有 `sandboxConfigState=READY` 且代码开发完成并通过配置后置校验后，才按步骤 5 的摘要展示规则对客展示沙箱环境配置。

### 步骤 2：产品决策

**任务**：根据用户场景和目标项目确定接入产品与执行范围，并通过一次确认启动当前支付产品的代码开发

**完成条件**：
- [INT.CONTEXT.LANGUAGE] 已在步骤 1 前确认用户服务端开发语言（Java / Python / Node.js / C# / PHP 五选一）
- [INT.CONTEXT.PROJECT] 已在步骤 1 前确认唯一的规范化目标项目路径；已有项目已验证可访问且保持原有内容，新项目路径已验证为尚不存在或为空并确认框架和项目创建方式
- [INT.PRODUCT.CONFIRMED] 已根据用户场景决策出支付产品
- [INT.START.CONFIRMED] 已征得用户明确同意
- [INT.SERVICE_STATEMENT.CONFIRMED] 已输出服务声明并获得用户同意

| 场景关键词 | 产品 |
|------------|------|
| AI、智能体内收款、大模型、Agent、API、算力、402协议 | 按量付费 |
| 网站、网页、PC、电商、商城、H5、手机网页 | 网站支付 |
| APP、移动应用支付、手机 APP、iOS、Android、鸿蒙 | APP 支付 |
| 模糊场景 | 引用 modules/product-decision.md 进行澄清 |

**阻塞规则（执行约束，不是对客正文）**：步骤 2 只在必要时用当前标准消息补问仍无法可靠确定的产品或技术栈；产品不明确用 `product.clarify`，技术栈不明确用 `integration.context.required`；不得重复询问步骤 1 已确认的项目路径和服务端语言。

- `integration_only`：字段齐备后不得先输出产品判断、选择理由、待办、服务声明、执行进度或“即将确认”等内容。必须用步骤 1 确定的 `PROJECT_SELECTION` 对同一项目执行固定 runner，由 runner 内部完成检查器扫描、字段转换和 `integration.start.confirm` 渲染；项目来源、代码状态和其他支付产品不得由 Agent、用户描述或历史状态提供。必须执行：

```bash
node ../normal/scripts/integration_message_runner.mjs start-confirm \
  --product-type "$PRODUCT_TYPE" \
  --product-name "$PRODUCT_NAME" \
  --project-path "$PROJECT_PATH" \
  --project-selection "$PROJECT_SELECTION" \
  --language "$SERVER_LANGUAGE" \
  --framework "$FRAMEWORK"
```

runner 失败时不得展示手写确认或进入步骤 3。runner 成功后，其 stdout 是步骤 2 唯一对客消息；Agent 必须把 stdout 原文作为当前回复正文发给用户，不能用命令面板里的 stdout、折叠输出或“已渲染/已展示”说明替代。禁止添加 `<...>` 标签、“已输出完整确认”“完整接入启动确认已渲染”“服务声明已打印”“runner stdout 是本轮唯一对客正文”“收到 1 后进入步骤 3”、重复的项目符号摘要或任何前后缀；发出 stdout 原文后立即停止本轮。必须收到针对当前完整摘要的 `1` 后，方可锁定已准备的目标项目上下文并进入步骤 3。摘要变化后旧回复失效；只有目标项目或服务端语言变化时才返回步骤 1，其他修改重新扫描并渲染步骤 2。用户此前只说明产品、语言或催促继续，不能替代本确认。

- `full_process`：`../normal/full-process-routing.md` 已使用同一个 `integration.start.confirm`，在同一摘要中绑定检查器产生的项目来源、代码状态和其他产品，以及产品、项目路径、语言/框架和服务声明；取得当前 prompt 的 `1` 时直接满足本步骤的启动确认与服务声明确认，禁止再次渲染该消息或要求第二次输入 `1`，直接进入步骤 3。该消息不展示步骤清单，也不缩减执行范围；后续仍必须按当前产品完成本 flow 的全部适用接口、完成条件和 checklist。任一摘要字段变化、确认过期或无法证明回复针对同一摘要时，必须返回完整接入 router 重新扫描并渲染新的单条确认。该确认仍禁止提前展示 MCC、授权范围、产品开通材料或 onboarding 待办。

**确认后的上下文锁定**：已有项目保持步骤 1 前确认的实际根目录和原有工程结构；新项目必须已经在步骤 1 前按用户确认的方式完成初始化并通过构建标识检查。此处不重复准备、初始化或探测项目。路径内容与步骤 1 成功时不一致则停止并重新确认；只有目标项目或服务端语言变化时返回步骤 1，其他情况直接进入步骤 3。

完整接入固定在本流程步骤 3 至步骤 8 完成后再进入 onboarding；onboarding 自身的方案确认和外部写确认不由完整接入启动确认替代。

---

### 步骤 3：沙箱配置复核

**任务**：步骤 1 已就绪时复核同一沙箱配置；步骤 1 已待配置时保持该状态并继续代码开发

> 步骤 1 已完成 CLI、操作系统和首次配置校验。本步骤只复核等待确认期间配置是否仍然安全可用，不重新创建沙箱，也不重新执行环境探测。

**完成条件**：
- [INT.SANDBOX.UNIX_TERMINAL] Unix/macOS/Linux：`READY` 时已用 `reverify` 复核同一配置；步骤 1 或本步骤得到 `CREATE_PENDING|VERIFY_PENDING` 时，未读取或使用无效配置，已保留待配置状态并继续步骤 4
- [INT.SANDBOX.WINDOWS_REVERIFIED] Windows：已静默复核步骤 1 通过的项目实际配置、密钥格式和版本控制保护，未重复展示申领提示或要求再次确认

> 沙箱必含字段、落盘格式、路径输出、重复创建红线和失败处理均以 `modules/sandbox/sandbox-setup-guide.md` 为准。`READY` 时实际本机配置路径是后续唯一可信来源；待配置时 `SANDBOX_PENDING_PATH` 只是预期路径，不得作为配置存在或字段有效的证据。禁止从对话或历史代码复制密钥；对客沙箱摘要只能在代码开发完成且配置后置校验通过后展示。

**操作流程**：
1. 继承步骤 1 的操作系统、规范化项目路径和服务端语言；任一值变化就返回步骤 1，不在本步骤重新探测。
2. Unix/macOS/Linux 的 `sandboxConfigState=CREATE_PENDING|VERIFY_PENDING` 时不再次调用脚本、不读取配置，直接进入步骤 4；本轮后续保持同一状态，直到用户另行要求重新配置。
3. Windows 只静默复核步骤 1 由 Agent 写入的同一本机敏感配置路径、项目实际读取字段、密钥格式和版本控制保护；不得再次渲染 `sandbox.windows.manual_setup` 或重新索取整套资料。路径、字段或保护发生变化时返回步骤 1 的 Windows 分支，只补问实际缺失或错误字段。
4. Unix/macOS/Linux 仅在 `sandboxConfigState=READY` 时执行以下唯一复核命令，不先检查文件、不读取字段、不运行其他诊断：

```bash
bash modules/scripts/sandbox_config.sh reverify "<规范化项目路径>" "<已确认服务端语言>"
```

5. `reverify` 只接受与步骤 1 相同的三个互斥终态。`READY` 更新 `sandboxConfigState=READY` 并立即进入步骤 4；`VERIFY_PENDING` 已由脚本输出唯一待配置正文，更新状态后立即进入步骤 4。`reverify` 不允许创建分支，若异常出现 `CREATED|CREATE_PENDING` 标记必须按协议失败停止。所有终态之后禁止追加任何 `jq`、`cat`、`grep`、`ls`、`stat` 或临时脚本。
6. Windows 手工申领分支不伪装成快速沙箱脚本结果，只按本步骤和指南检查目标项目实际使用的本地配置。沙箱就绪时不输出复核进度、沙箱环境摘要、独立校验结果或字段核对表，直接进入步骤 4。

---

### 步骤 4：代码开发前置

**任务**：阅读 SDK 要点、本地契约和当前语言示例

本步骤只加载和核对代码开发依据；成功时不发送“文档已读取”“准备完成”等对客进度，直接进入步骤 5。本地依据缺失时输出实际缺口，禁止猜测。在线文档只在 fallback 条件下读取，不作为默认必读材料。

**完成条件**：
- [INT.PRE.SDK_GUIDE_READ] 已阅读 `modules/alipay-sdk-reminder.md` 完整内容（私钥格式、页面跳转方法、验签排查等）
- [INT.PRE.SDK_RULES_APPLIED] 已理解 SDK 选择和 SDK 防幻觉强制规则
- [INT.PRE.LOCAL_CONTRACTS_READ] 已按当前产品读取 `modules/interface-guide.md` 路由的本地接口契约；网站支付和 APP 支付同时读取通用收单与异步通知契约
- [INT.PRE.OFFICIAL_DOCS_FALLBACK_BOUNDARY] 在线文档仅在本地依据缺失、字段不确定、排查官方错误码、用户明确要求或官方能力变化时读取；未无条件 curl 或递归抓取无关文档
- [INT.PRE.EXAMPLES_READ] 已阅读产品相关接口代码示例

**官方文档 fallback 访问**：

触发 fallback 时，只读取当前本地契约 `sourceUrl` 中与本产品、本接口直接相关的官方页面：
```bash
curl -sL "<当前契约 sourceUrl 中的官方页面>"
```
不得为了默认代码开发无条件执行 `curl`，也不得继续递归抓取无关页面。在线文档不可达且本地依据不足时，停止并标记待核验，不得猜测。

**必须阅读的文件**：
- `modules/alipay-sdk-reminder.md` - SDK防坑指南（含私钥格式、页面跳转方法、验签排查等）
- `modules/interface-guide.md` - 本地契约与示例索引
- 当前产品契约和当前语言示例 - 按 `interface-guide.md` 的默认读取路由加载

**🚫 SDK 防幻觉强制规则**：

> ⚠️ 以下规则来自真实集成踩坑，违反将导致集成失败。详细说明和各语言操作对照见 [SDK 说明文档](modules/alipay-sdk-reminder.md)，**严禁**在未读取该文档的情况下生成代码或给出建议。

| # | 规则 | 禁令 |
|---|------|------|
| 1 | 私钥字段按语言选择沙箱返回值 | Java 使用 `appPrivateKey`（PKCS#8），非 Java 使用 `appPrivatePkcsKey`（PKCS#1），禁止自行生成或格式转换 |
| 2 | 页面跳转类 API 必须使用页面跳转方法 | `alipay.trade.page.pay` 等必须使用 `pageExecute()`/`pageExec()`，使用 `exec()` 将无法获取支付表单 |
| 3 | 前端禁止用 URL 直接跳转支付表单 | 支付接口返回的是 HTML 表单，必须渲染并自动提交 form，直接用 URL 跳转会导致页面只显示参数而无法跳转支付宝 |
| 4 | 时间戳格式 | 必须使用 `yyyy-MM-dd HH:mm:ss`，禁止使用 ISO 格式 |
| 5 | SDK 引入方式 | 必须通过查阅 SDK 文档或类型定义确定正确的引入方式，禁止凭猜测选择 |
| 6 | 遇到 `invalid-signature` 报错 | 严禁凭猜测归因到私钥格式；先核对实际发送、参与签名和服务端验签的参数是否完全一致 |
| 7 | 配置接入后必须后置校验 | Unix/macOS/Linux 必须确认服务端加载器直接读取已验证文件、字段映射正确且 SDK 配置匹配；Windows 必须确认项目读取同一套本机沙箱应用配置；失败时禁止继续联调 |

---

### 步骤 5：代码生成

**任务**：根据用户选择的开发语言和产品，在已确认的目标项目根目录中生成集成代码

**完成条件**：
- [INT.CODE.BASE_IMPLEMENTED] 已完成支付宝支付产品集成代码实现
- [INT.CODE.INTERFACES_COMPLETE] 已按目标产品文档完成全部适用接口；网站支付/APP 支付覆盖下单、交易查询、退款、退款查询、关闭交易和异步通知处理代码，按量付费覆盖 402、`payment.verify` 和 `fulfillment.confirm`
- [INT.CODE.SELF_CHECKED] 已完成代码自检并确认无误
- [INT.CODE.CONFIG_VERIFIED] 已完成支付配置准确性后置校验：Unix/macOS/Linux 服务端加载器直接读取已验证文件且字段映射、SDK 配置匹配；Windows 项目读取同一套本机沙箱应用配置
- [INT.WEBPAY.RETURN_IMPLEMENTED] 网站支付在用户未明确要求不使用同步回跳时，已配置与当前项目一致的 `return_url`，并实现可通过 GET 访问的回跳路由和结果页；页面不直接信任同步回跳参数判定支付成功
- [INT.LOCAL_ACCEPTANCE.NOTIFY_DEFERRED] 用户处于“本地生产参数验收模式”时，已明确记录当前暂不联调公网 `notify_url`，支付结果确认依赖异步通知处理代码加主动查询兜底；未把同步回跳参数当作支付成功依据
- [INT.A2M.PRODUCTION_CONTROLS] 按量付费生产接入中已补齐订单持久化、本地订单匹配、金额一致性、资源防串、幂等履约和履约确认失败可重试逻辑，不存在未实现的关键 TODO

**实现与自检入口**：按当前语言和产品读取 `modules/interface-guide.md` 路由的本地接口契约和专用/通用接口示例，并完整应用 `modules/alipay-sdk-reminder.md` 的生成前自检与配置后置校验。`interface-guide.md` 中的 `./code-examples/...` 链接相对 `modules/interface-guide.md` 所在目录解析；从本 flow 所在目录读取实际示例时必须使用 `modules/code-examples/...`，例如 Node.js 按量付费示例为 `modules/code-examples/nodejs/4-按量付费/A2MPaymentDemo.js`，不得查找 `code-examples/...` 或 `references/integration/code-examples/...`。本地缺少示例不等于接口不适用；用户限定本轮范围时，未实现的适用接口必须列为待办，不得宣称完整集成。

**Node.js 项目前置核对**：目标语言为 Node.js 时，生成或修改代码前必须先读取目标项目 `package.json`，确认 `type`、启动脚本、已安装依赖和框架版本；安装或发现 `alipay-sdk` 后，必须按 `modules/alipay-sdk-reminder.md` 读取实际 `node_modules/alipay-sdk/package.json` 与类型定义来确定导入方式、`pageExec`/`sdkExecute`/`checkNotifySign` 等方法名。不得凭本地示例中的 `require`/`import` 行、历史记忆或其他项目版本推断当前项目写法。

**支付配置接入与后置校验**：`sandboxConfigState=READY` 时，Unix/macOS/Linux 快速沙箱由商家服务端代码使用当前语言的标准 JSON 解析器，在运行时读取步骤 1/3 已验证的 `.alipay-sandbox.json`，并从 `appIds[0]` 映射 `appId`、`alipayPublicKey` 和当前语言私钥字段；不得先用 `jq`、`cat` 或临时脚本把字段原文打印到工具输出、复制到源码或重复写入 `.env`。项目已有配置抽象时在其服务端加载边界接入该 JSON，不改变字段原值。Windows 从步骤 1 由 Agent 写入并校验的本机敏感配置读取。后置校验按 `modules/sandbox/sandbox-setup-guide.md` 第 7 节检查实际加载路径、字段选择、SDK 初始化和版本控制保护；Java 使用 `appPrivateKey`，其他四种语言使用 `appPrivatePkcsKey`。A2M 的 `seller_signature` 使用原生密码库时，只在调用边界按库要求解析密钥。失败时修正加载器或 SDK 配置，禁止猜测、转换格式或改写原始值。

`sandboxConfigState=CREATE_PENDING|VERIFY_PENDING` 时仍完整实现当前产品全部适用接口、安全校验和配置加载边界，但不得读取当前无效配置、写入占位 appId/密钥、把示例值当作运行配置或声称 `INT.CODE.CONFIG_VERIFIED` 通过。加载器在配置缺失或无效时必须明确失败并阻止真实 SDK 调用；本轮所有依赖沙箱值的运行验证保持未完成。

**沙箱摘要展示入口**：只有 `sandboxConfigState=READY`、本步骤的代码实现和支付配置后置校验都已完成，才允许对客展示沙箱环境配置。待配置状态跳过本入口，不另写摘要或失败话术。Unix/macOS/Linux 从本 flow 所在目录执行：

```bash
bash modules/scripts/sandbox_config.sh summary "<productType>" "<规范化项目路径>" "<已确认服务端语言>"
```

该命令只复核并渲染 `sandbox.environment.summary` 与 `sandbox.environment.reminder`，不重新创建沙箱，不调用 `createAnonymousSandbox`。`productType` 只能来自步骤 2 已确认的 `aipay|webpay|apppay`；配置路径和语言必须与步骤 1/3 一致。摘要展示失败时不得进入沙箱测试或付款体验，也不得改用 Agent 自写表格。

Windows 从项目实际读取的同一本机配置构造不含密码和密钥原文的 `ENVIRONMENT_ROWS`，再从本 flow 所在目录执行以下固定命令；不得重新索取或复述步骤 1 已提供的敏感值，也不得改用 Unix 快速沙箱脚本：

```bash
MESSAGE_INPUT_JSON=$(jq -cn \
  --arg productName "$PRODUCT_NAME" \
  --arg configPath "$CONFIG_PATH" \
  --arg environmentRows "$ENVIRONMENT_ROWS" \
  '{productName:$productName,configPath:$configPath,environmentRows:$environmentRows}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../normal/scripts/render_customer_message.mjs sandbox.environment.summary --variant DEFAULT
printf '%s' '{}' \
  | node ../normal/scripts/render_customer_message.mjs sandbox.environment.reminder --variant WINDOWS
```

Windows 的 `CONFIG_PATH` 必须是步骤 1/3 已校验的实际本机配置绝对路径；`ENVIRONMENT_ROWS` 只包含实际取得的非敏感应用、商家、买家和沙箱标识，缺失可选项直接省略。两个 renderer 任一失败都按摘要展示失败处理，禁止手写补齐。

**网站支付回跳默认规则**：用户未特别说明时，默认实现支付后同步回跳。`return_url` 必须来自已确认目标项目的实际协议、主机、端口和路由，禁止保留 `your-domain.com`、示例端口或猜测路径。项目没有结果页时，在当前技术栈内新增与既有 UI 一致的 GET 回跳路由和页面。用户已明确不需要同步回跳时，直接按关闭分支验收，不增加第二次确认；仍必须保留异步通知、交易查询和商户订单查询页。用户未明确关闭但代码缺少 `return_url` 时，必须修复为默认同步回跳分支，不得要求用户接受遗漏。验收结论必须从实际代码重新检查，不接受调用方自报 `returnMode`。

**本地生产参数验收模式**：用户项目尚未上线、无法提供真实公网地址，或当前自定义域名/TLS 检查失败时，网站支付/APP 支付可以进入本模式。要求如下：

1. 代码层必须已经实现异步通知处理入口、验签、关键字段校验、幂等和成功响应 `success`，只是当前环境不对外联调。
2. 运行层可以临时关闭异步通知发起配置或不传 `notify_url`；如项目已有显式开关，也可使用项目内已有的 `notify_enabled=false` 等等价配置，并执行 `printf '%s' '{}' | node ../normal/scripts/render_customer_message.mjs integration.local_acceptance.notice --variant DEFAULT`，不得另写近似话术。
3. 本地模式下，网站支付保留 `localhost` 或当前可访问开发地址的 `return_url`/结果页，APP 支付保留本地订单查询链路，并统一提供服务端交易查询或订单查询页作为结果确认兜底。
4. 任何本地模式结果都只能表述为“本地正式验收完成”或“本地生产参数验收完成，公网异步通知待补齐”，不得表述为“生产就绪”。

**按量付费沙箱 serviceId**：生成或写入按量付费沙箱运行配置时，`serviceId` 固定使用 `api_mock_service_id`，禁止向用户索要正式 `serviceId` 才继续沙箱联调。该值必须与正式环境配置隔离；正式上线前替换为服务市场注册或复用结果中的真实 `serviceId`。

**按量付费生产边界**：五语言 A2M 文件只是核心协议与 SDK 调用示例。生产实现必须通过 `modules/checklist.md` 的全部按量付费专项校验；任一关键控制仍为 TODO、注释、内存演示或伪代码时，不得满足 `INT.CODE.*` / `INT.A2M.PRODUCTION_CONTROLS` 或标记生产就绪。

> ⚠️ **按量付费**：代码生成后启动本地服务，后续步骤 6 将默认进行端到端沙箱服务端联调。服务需实现 402 协议（无 `Payment-Proof` 时返回 HTTP 402 + `Payment-Needed` 头）。

---

### 步骤 6：沙箱测试与体验（按量付费、网站支付）

> APP 支付跳过本步骤，直接进入步骤 7。按量付费和网站支付只有在 `sandboxConfigState=READY` 且配置后置校验通过时才执行本步骤；`CREATE_PENDING|VERIFY_PENDING` 时跳过全部沙箱依赖动作并进入步骤 7，不渲染 `a2m.test.*`、`a2m.payment.experience`、`webpay.sandbox.experience*` 或 `sandbox.android.client`。只有按量付费满足本步骤全部端到端完成条件时，才能对客输出“沙箱测试通过”或等价结论；网站支付和 APP 支付不得输出该结论。

#### 网站支付：提供人工沙箱付款指引

网站支付步骤 6 是用户可操作的付款体验交付，不是支付接口冒烟测试。启动服务、访问首页、用 `curl` 调用下单接口或取得 HTML 支付表单，只能证明对应本地接口有响应；没有向用户提供可在浏览器打开的真实支付页面和以下两种付款方式时，禁止标记步骤 6 完成：

- 方式一：在沙箱收银台输入沙箱买家账号和登录密码，再输入支付密码付款。
- 方式二：仅限 Android，安装沙箱支付宝并登录沙箱买家账号，在沙箱收银台使用客户端扫码，再输入支付密码付款。

两种方式必须同时说明并由用户自行二选一，不要求用户两种都做；用户暂不体验不阻塞后续代码校验，但必须明确记录“沙箱付款待用户体验”，不得输出“支付订单创建成功”来替代该状态。

网站支付代码生成和配置后置校验完成后，按以下顺序执行：

1. 从已确认的目标项目确定真实的服务启动命令和支付页面访问地址，禁止使用占位符、示例端口或猜测地址。
2. 用户未明确关闭同步回跳时，确认 SDK 实际传入的 `return_url`，且其与项目实现的 GET 回跳路由完全一致。
3. 默认分支继续启动服务，并对不带支付结果参数的 `return_url` 发起 GET 访问。这一步只验证路由和页面壳：无订单上下文时应展示安全的中性状态，不得因没有签名参数而绕过真实回跳请求的验签和订单归属校验。确认响应成功、无认证或重定向循环；单页应用直接刷新不得返回 404。
4. 默认分支中，Agent 具备浏览器/UI 验证能力时，实际打开回跳页，确认页面非空白、无可见报错且关键状态内容正常渲染。不具备时，不向用户追加人工确认；将“回跳页 UI 人工待验证”记录到最终 checklist 的 `manualItems`，并继续提供沙箱付款入口。

5. 用户已明确关闭同步回跳时，不要求或猜测 `return_url`；确认 SDK 请求未传该字段，并改为验证异步通知处理代码、交易查询和商户订单查询页。本地生产参数验收模式下，如暂无公网 HTTPS `notify_url`，将公网异步通知联调标记为人工待验证，不以此阻塞本地正式验收。
6. 按 `modules/sandbox/sandbox-setup-guide.md` 第 5.5 节输出沙箱付款说明。操作顺序为：启动服务 → 用浏览器访问支付页面 → 发起支付 → 唤起沙箱收银台 → 用户从“收银台账号登录”与“安卓沙箱支付宝扫码”中二选一完成付款 → 返回商户结果页并查询展示订单状态。

回跳地址无法确定、访问失败或页面出现确定错误时，必须先修正；本轮无法继续修正时进入最终 checklist 的未完成项，不得宣称网站支付代码开发完成。仅缺少浏览器/UI 证据时记录“回跳页 UI 人工待验证”，不得宣称回跳页已验证，但不阻塞沙箱付款入口交付。该体验不新增业务写操作确认点，用户暂未付款不阻止后续代码校验。

网站支付本步骤的完成语义是“沙箱付款入口与操作说明已提供，并已按实际证据验证回跳页面或关闭回跳分支”，不是“沙箱支付测试通过”。即使用户随后反馈已完成付款，也只记录“用户已完成一笔沙箱付款”以及能够实际核验的订单、回跳或查询结果，不输出笼统的“沙箱环境测试通过”。

**完成条件（网站支付）**：
- [INT.WEBPAY.EXPERIENCE_DELIVERED] 已向用户明确提供真实服务启动命令、浏览器支付页面访问地址、完整沙箱付款顺序、“沙箱买家账号登录”与“安卓沙箱支付宝扫码”两种二选一体验方式，以及结果判断提醒；未用 `curl` 返回的 HTML 表单替代浏览器付款入口

以下两项按实际分支二选一，不得同时要求：

- [INT.WEBPAY.RETURN_VERIFIED] 默认分支已确认实际 `return_url` 与项目路由一致，启动服务后 GET 访问通过，且已通过 Agent 浏览器/UI 验证取得页面正常渲染的证据；当前环境无法取得 UI 证据时只能记为人工待验证，不能满足本完成条件
- [INT.WEBPAY.NO_RETURN_VERIFIED] 关闭分支已记录用户先前明确提出的不使用同步回跳，确认 SDK 请求未传 `return_url`，并完成异步通知处理代码、交易查询和商户订单查询页校验；缺少公网 HTTPS `notify_url` 时，已明确标记公网通知联调为人工待验证

#### 按量付费：自动沙箱联调

**任务**：验证按量付费 402 协议端到端服务端联调流程

> ⚠️ **必须完整阅读** `modules/sandbox/a2m-sandbox-test.md` 后方可执行本步骤
>
> 沙箱联调经验集中维护在 `modules/sandbox/a2m-sandbox-test.md`。遇到收银接口临时失败、`ORDER_NOT_FOUND`、资源防串失败或履约确认失败时，先按该文档排查，不要反复请求用户服务生成新订单。

**完成条件**：
- [INT.A2M.SERVICE_READY] 已确认用户本地按量付费服务已启动可访问
- [INT.A2M.PRECHECK_PASSED] 已执行 Payment-Needed 预检，确认 HTTP 402 和关键字段存在
- [INT.A2M.AUTO_COMPLETE_RUN] 已执行沙箱支付测试脚本 `run --auto-complete --require-payment-validation`，成功获取 Payment-Needed、生成付款链接并连续执行服务端联调
- [INT.A2M.DELIVERY_EVIDENCE] 已携带 `Payment-Proof` 重试原服务，并取得 HTTP 200、非空可归属资源、无明确业务失败和有效 `Payment-Validation` 的组合成功证据
- [INT.A2M.TEST_PASSED] 已确认 402 沙箱服务端联调流程通过

**测试前预检**：执行沙箱测试脚本前，先按 `modules/sandbox/a2m-sandbox-test.md` 的“测试前预检”确认服务返回 HTTP 402，`Payment-Needed` 包含 `seller_signature` 等关键字段，且 `method.service_id` 等于 `api_mock_service_id`。

**沙箱支付宝体验提醒**：服务端联调结论输出后，按 `modules/sandbox/a2m-sandbox-test.md` 向用户提供付款链接、沙箱买家账号和安卓客户端下载说明作为可选付款体验；该体验不新增阻塞确认点。

**默认执行规则**：
1. 从已确认的目标项目和步骤 3 已校验的沙箱配置中确定服务请求地址、HTTP 方法和沙箱买家 `userId`；仅缺少无法从当前上下文取得的真实参数时才询问对应信息，禁止编造或猜测。
2. 确认本地服务可访问；项目已有明确启动方式且当前环境可执行时直接启动，否则只要求用户完成必要的服务启动。服务恢复可访问后自动继续，不询问是否执行沙箱测试。
3. 从本 flow 所在目录执行下列固定 renderer 命令，输出固定联调说明后立即继续，不等待用户确认；禁止另写开始话术。服务地址和 HTTP 方法只用于后续实际命令，不在本消息中展示：

```bash
MESSAGE_INPUT_JSON='{}'
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../normal/scripts/render_customer_message.mjs a2m.test.start --variant DEFAULT
```

4. 按实际 HTTP 方法从本 flow 所在目录执行且只执行以下对应命令。POST body 必须来自已确认目标项目中的实际文件，不把动态 JSON 拼进命令文本：

```bash
# GET
python3 modules/scripts/local_402_sandbox_pay.py run \
  --url "$SERVICE_URL" \
  --method GET \
  --buyer-id "$BUYER_2088" \
  --auto-complete \
  --require-payment-validation

# POST
python3 modules/scripts/local_402_sandbox_pay.py run \
  --url "$SERVICE_URL" \
  --method POST \
  --body "@$POST_BODY_FILE" \
  --buyer-id "$BUYER_2088" \
  --auto-complete \
  --require-payment-validation
```

只传已确认的本机服务 URL、GET/POST、实际沙箱买家 userId 和项目内 POST body 文件；禁止传入自定义收银端点、`Payment-Proof` 或 attestation。只有同一次命令退出码为 0，且输出包含实际资源交付校验通过和敏感产物已清理，才能记录联调通过；204、空响应、空资源、明确验付/履约失败或异常 `Payment-Validation` 均不得通过。失败后清理本轮敏感产物并重新执行完整联调。

服务未就绪时固定使用 `integration.service.not_ready` 输出实际缺口和恢复动作；必须执行下列命令。不得运行测试、登记 `INT.A2M.SERVICE_READY=PASS` 或临场改写近似话术。

```bash
MESSAGE_INPUT_JSON=$(jq -cn --arg recoveryAction "$RECOVERY_ACTION" '{recoveryAction:$recoveryAction}')
printf '%s' "$MESSAGE_INPUT_JSON" | node ../normal/scripts/render_customer_message.mjs integration.service.not_ready --variant DEFAULT
```

> 详细测试流程见 `modules/sandbox/a2m-sandbox-test.md`

---

### 步骤 7：集成后说明

**任务**：在最终校验前一次输出安全红线和上线指引，不得提前宣称集成已经完成

**完成条件**：
- [INT.CLOSEOUT.SAFETY_AND_NEXT_STEPS_PRINTED] 已向用户明文输出安全红线和完整上线指引

**安全与上线提醒（必须明文打印给用户）**：使用 `../normal/customer-messages.json` 的 `integration.safety.closeout`，按当前产品选择 `AIPAY`、`WEBPAY` 或 `APPPAY` 变体，并传入实际验收口径。模板一次覆盖服务端私钥、日志/公共仓库、支付结果依据、重复付款、异步通知或 `Payment-Proof`/履约确认、沙箱到生产配置替换、同套生产密钥、按量付费真实 `serviceId` 和语言私钥格式；不得临场删减、拆成第二条消息或维护近似话术。必须执行：

```bash
MESSAGE_INPUT_JSON=$(jq -cn --arg acceptanceSummary "$ACCEPTANCE_SUMMARY" '{acceptanceSummary:$acceptanceSummary}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../normal/scripts/render_customer_message.mjs integration.safety.closeout --variant <AIPAY|WEBPAY|APPPAY>
```

生产密钥的一致性、语言格式、官方工具转换、沙箱/生产配置替换、`notify_url` 公网联调边界、按量付费 `api_mock_service_id` 替换和生产就绪表述限制均由上述一条标准消息统一输出。实际写入配置时仍使用不带 PEM 头尾、包装行或说明文字的原始私钥字符串；该执行细节不得省略或改写密钥内容。

**签约衔接提醒（必须输出）**：
- 如果当前意图是 `integration_only`：提醒用户正式上线前还需要完成对应支付产品的产品开通。
- 如果当前意图是 `full_process`：本步骤只说明仍需完成步骤 8 集成校验；此时不展示签约待办、MCC、授权范围或材料。全部适用步骤通过时进入 onboarding；只有沙箱待配置且其余检查通过时也继续 onboarding，但保持沙箱和代码开发为部分通过；其他阻塞缺口仍停在代码开发。

---

### 步骤 8：代码开发校验

**完成条件**：已执行 `modules/checklist.md` 的全部适用检查，并保留每项实际命令、文件检查或人工待验证依据；不得使用 Agent 自拟 attestation、空哈希或口头结论代替。

**自动执行规则**：步骤 7 完成后直接读取 `modules/checklist.md`，默认只执行代码阅读、配置后置校验、语法/静态检查，以及无需安装依赖、联网或监听端口的已有定向测试，并复用步骤 5、步骤 6 已取得的校验证据，不增加“是否需要校验”的用户确认。

**执行边界**：默认禁止安装依赖或浏览器、切换运行时版本、启动长期服务、申请网络/端口权限、执行截图或 UI 自动化，也不得重复步骤 6 已完成的端到端测试。遇到 `EPERM`、网络受限、缺少浏览器等环境限制时，将对应项标记为“人工待验证”并停止扩展排查；不得据此推断代码或运行时兼容问题。只有用户明确要求继续扩展验证时，才展示拟执行动作并按原确认规则处理。

步骤 3 至步骤 7 的必要依据、配置摘要、代码修复、网站回跳或按量付费联调在本轮无法继续时，跳过所有依赖该失败事实的后续动作，但仍进入本步骤：把未满足条件和被跳过动作按实际证据标记为失败或人工待验证，并使用同一 `integration.checklist.result` 收口。不得为了生成结果重新执行已阻断的外部动作。`full_process` 中，只有沙箱为 `CREATE_PENDING|VERIFY_PENDING` 且代码实现与不依赖沙箱的安全检查均通过、或沙箱为 `READY` 且仅剩非阻塞人工待验证项时，才在输出标准“部分通过”结果后继续 onboarding；存在其他代码、安全或必要依据失败时仍停在代码开发。

校验项包括：
- 签名验签
- 异步通知
- 异常处理

> 详细校验清单见 `modules/checklist.md`

**校验完整性要求**：内部必须覆盖 `modules/checklist.md` 的密钥与安全、异步通知、适用接口覆盖、支付结果处理、按量付费专项、退款和上线前七类校验，不得只检查上方三个摘要项。通过时默认对客只输出通过结论和下一步；部分通过或未通过时只输出实际未完成项、人工待验证项和下一步。步骤 5/6 已展示的沙箱配置、联调或付款体验结论不在 checklist 结果中重复。通过项与不适用项无需逐行展开，用户要求明细时再输出完整逐项结果。精简输出不得导致任何适用校验被跳过。

先在内部汇总 checklist 证据。发现本轮范围内可直接修复的代码或配置缺口时，先修复并重新执行受影响检查；在仍可继续自动修复期间不得渲染中间 checklist 结果。只有已通过、只剩人工待验证，或本轮无法继续修复时，才生成最终 `CHECKLIST_RESULT_JSON` 并渲染一次对客结论。

对客结论统一使用 `integration.checklist.result`，并严格按当前产品选择 `AIPAY`、`WEBPAY` 或 `APPPAY` 变体；整体结论、失败/部分通过项和人工待验证项必须来自最终一轮 checklist 实际证据。必须从本 flow 所在目录执行下列 runner；runner stdout 是唯一对客正文，必须把 stdout 原文作为当前回复正文发给用户：

```bash
printf '%s' "$CHECKLIST_RESULT_JSON" \
  | node ../normal/scripts/integration_message_runner.mjs checklist-result --variant <AIPAY|WEBPAY|APPPAY>
```

`failedItems` 与 `manualItems` 必须在各自受控单行值中包含对应的确定下一步；没有对应项目时明确传入“无”。`sandboxConfigState` 必须直接复用本轮脚本终态，只允许 `READY|CREATE_PENDING|VERIFY_PENDING`。`blockingDefectState` 来自同一最终 checklist：除沙箱配置及其直接依赖动作外，存在任一代码、安全或必要依据缺口时必须为 `PRESENT`，否则为 `NONE`。待配置时 `failedItems` 必须包含沙箱配置及其依赖动作未完成；恢复口令已经由步骤 1/3 的 `sandbox.configuration.pending` 输出，本结果不再重复。

同一次代码开发流程只渲染一次最终 checklist 结果；renderer stdout 是本次默认收口的唯一对客正文，禁止在前后追加风险说明、通过项摘要、执行说明、衔接提醒或第二份待办。

`integration_only` 的 `executionMode` 固定为“仅代码开发”，`nextFlowReminder` 固定为“正式上线前还需完成支付产品-产品开通。”。`full_process` 使用“完整接入”：`READY` 且整体结果为“通过”时使用“代码开发校验通过后将自动进入支付产品-产品开通；未通过时停留在代码开发。”；沙箱待配置、整体结果为“部分通过”且 `blockingDefectState=NONE` 时，使用“沙箱配置尚未完成，但不阻塞本轮继续支付产品-产品开通；完成配置后再进行沙箱测试。”；沙箱为 `READY`、整体结果为“部分通过”、`failedItems=无` 且仅剩人工待验证项时，使用“代码开发自动校验已完成，仍有人工待验证项；本轮继续产品开通。”，并把本次 `manualItems` 原样作为后续 onboarding Step 6 的 `MANUAL_VERIFICATION_ITEMS`；`blockingDefectState=PRESENT` 或整体结果为“未通过”时仍停在代码开发。renderer 会校验执行模式、沙箱状态、阻塞缺口、整体结果和衔接文案一致。

只有 `AIPAY` 传入 `sandboxResult`，且只能复用步骤 6 的实际服务端联调证据；`WEBPAY` 必须按步骤 6 的实际证据传入消息目录登记的 `webpayExperienceResult` 枚举，区分已提供、未提供和用户已完成一笔体验，不得自由改写。这些字段只用于 renderer 校验最终结论，不在 checklist 对客结果中重复展示。APP 支付未来沙箱测试对客引导的维护 TODO 只保留在消息目录对应变体，不得渲染给用户；补充时必须同步本 flow、`modules/checklist.md` 和测试。

**完成语义**：只有步骤 1-8 的适用完成条件均满足且 `sandboxConfigState=READY` 后，才可声明支付产品-代码开发完成。沙箱待配置但代码实现与其余检查通过时只能输出“部分通过”，不得改写为完成；存在其他未通过项时输出“未通过”；若配置已就绪且仅剩无法自动验证项，输出“部分通过”并登记人工待验证项，不得改写为完成或生产就绪。

完成结论必须逐项来自本轮实际检查：项目和代码项重新扫描目标目录；Unix/macOS/Linux 只有 `sandboxConfigState=READY` 时才重新执行严格的 `sandbox_config.sh verify`，待配置时直接复用本轮脚本终态并标记相关项未完成，不得在 checklist 中再次创建或复核；Windows 手工沙箱重新检查项目实际读取的本地配置、密钥格式和版本控制保护；按量付费联调只接受本轮 `run --auto-complete --require-payment-validation` 的实际成功；用户确认项只接受当前摘要后的回复。任何一项缺失、失败或无法执行都标记为失败或人工待验证，不得由 Agent 自填 `PASS`。

**沙箱结论边界**：步骤 8 的代码与配置校验不得把步骤 3 的字段完整性、网站支付的付款指引或 APP 支付跳过步骤 6 改写为“沙箱测试通过”。只有按量付费步骤 6 已取得完整端到端成功证据时，最终摘要才可复用该测试结论。

---

## 问题排查流程（功能二）

**触发条件**：用户在集成支付宝支付产品过程中遇到报错或其他问题。触发关键词："报错"、"错误码"、"问题"、"排查"、"调试"、"异常"等。

执行下述问题排查步骤之前，**必须明确用户当前集成的支付产品**（按量付费/网站支付/APP 支付），否则暂停输出并要求用户澄清。

### 问题识别与分流

根据用户输入判断问题类型，分流到对应排查路径：

```
用户问题
    |
    +-- 验签失败（invalid-signature / 验签出错）  ← 优先匹配
    |       |
    |       └───> 常见问题排查（验签失败专项）
    |
    +-- 有明确错误码（如 "ACQ.TRADE_HAS_SUCCESS"、"INVALID_PARAMETER"）
    |       |
    |       └───> 错误码排查
    |
    +-- 无明确错误码（如流程疑问、功能异常等）
            |
            └───> 常见问题排查
```

### 错误码排查

**适用**：用户提供了明确的错误码。

错误码查询前，**必须确认发生报错的接口信息**，否则暂停输出并要求用户澄清。

#### 排查流程

1. **查公共错误码**：查阅 [公共错误码说明](https://ideservice.alipay.com/cms/site/02km9f)，根据用户提供的错误码检索相关内容。如有匹配结果，**输出排查结论**；否则，**查业务错误码**。

2. **查业务错误码**：基于确定的支付产品和报错接口信息，查阅对应产品文档，在接口文档中根据错误码检索相关内容。

3. **输出排查结论**：根据查询到的错误码关联内容，输出排查结论。

### 常见问题排查

**适用**：无明确错误码的其他类型问题，或错误码为 `invalid-signature`（验签出错）。

#### 排查流程

1. 根据用户输入和确定的支付产品，查阅对应的产品**常见问题文档**，匹配问题解决方案。

2. 若未找到解决方案，引导用户查阅 [开放平台在线文档](https://open.alipay.com?form=payskill) 或咨询 [支付宝技术支持](https://opensupport.alipay.com/support/intelligent-services?form=payskill)，**严禁**编造解决方案。
3. 对代码开发、SDK 使用、应用创建、应用发布等没有确定依据的问题，必须明确说明无法确认，并引导用户前往支付宝开放平台或支付宝技术支持咨询客服。

#### 常见问题文档索引

| 产品类别 | 常见问题文档 |
|----------|-------------|
| 按量付费 | [按量付费常见问题](https://ideservice.alipay.com/cms/site/0j7uos) |
| 网站支付 | [网站支付常见问题](https://ideservice.alipay.com/cms/site/0j3kh1) |
| APP 支付 | [APP 支付常见问题](https://ideservice.alipay.com/cms/site/0j3pih) |

#### ⛔ 验签失败（invalid-signature）专项排查

遇到 `invalid-signature`（验签出错）时，**严禁凭猜测归因到私钥格式或环境兼容性**，必须按以下原则排查：

1. **先验证实际请求内容，再怀疑密钥配置** — 先核对实际发送、参与签名和服务端验签的参数集是否完全一致，不得在没有请求证据时归因于私钥格式。

2. **严禁陷入连环误判**：看到 `ERR_OSSL_UNSUPPORTED` 就推断私钥格式有问题 → 给私钥添加 PEM 头尾或其他前后缀 → 转换格式，这是错误排查路径。详见 `modules/alipay-sdk-reminder.md` 中的「验签失败排查原则」。

3. **正确排查顺序**：
   - 检查实际发送、签名和验签参数的一致性
   - 检查私钥字段是否正确（Java 用 `appPrivateKey`，其他语言用 `appPrivatePkcsKey`）
   - 检查 signType 是否为 RSA2
   - 检查网关地址是否正确

4. **线上环境公私钥不匹配**：若线上环境报错"公私钥不匹配"，建议用户：
   - 登录支付宝开放平台**重新上传应用公钥**
   - 在应用配置中重新配置应用公私钥对

---

## 核心产物

| 产物 | 说明 |
|------|------|
| 沙箱配置 | appId + 支付宝公钥 + 商家私钥 |
| 集成代码 | 各语言支付代码示例 |
| 校验结果 | checklist核对结果 |

---

## 代码开发完成确认

集成校验完成后输出实际状态：

- `integration_only`：通过 `integration.checklist.result` 同一标准消息说明未通过项、人工待验证项，并固定提醒正式上线前还需要完成支付产品-产品开通；不得在消息外追加第二份提醒。
- `full_process`：全部适用集成步骤和校验通过后自动进入 `references/onboarding/flow.md`。沙箱待配置是唯一缺口时，代码开发结果保持“部分通过”，输出固定恢复提醒后仍进入 onboarding；沙箱状态不得被产品开通结果覆盖。存在其他代码、安全或必要依据未通过项时停在 integration，不提前登录、查询、采集 onboarding 材料或执行 onboarding 写操作。
- 存在未通过校验时不得宣称代码开发完成，必须列出整改项和对应风险。
