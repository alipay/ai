---
name: alipay-aipay
description: >-
  支付宝 AI 付站点官方 Skill。当用户选择完成按量付费、网站支付、APP 支付三类支付宝收单产品的代码开发、产品开通或全流程同时完成两者时，使用此 Skill。
  触发关键词："AI支付"、"接支付宝"、"接个支付"、"开发支付"、"402收款"、"按量付费"、"快捷收款"、"快捷收单"、"网站支付"、"APP 支付"、"产品开通"、"商家开通"、"签约入驻"等。
---

# 支付宝 AI 付 SKILL

---

## ⚠️ 支持产品范围

本 SKILL 仅支持：按量付费、网站支付、APP 支付三种产品。不支持当面付、订单码支付、JSAPI支付、预授权支付、商家扣款等产品，如需集成请前往[支付宝开放平台](https://open.alipay.com/)查阅相关文档，如需签约请前往[支付宝商家平台](https://b.alipay.com/page/portal/home)完成签约。

**产品术语口径：**
- **网站支付**是本 Skill 唯一的网页支付产品概念，覆盖电脑网页和手机浏览器网页/H5 场景；用户说“电脑网站支付”“PC网站支付”“PC网页支付”“手机网站支付”“H5支付”时，均按本 Skill 的**网站支付**处理。
- 集成侧网站支付底层接口固定使用 `alipay.trade.page.pay`；即使是手机浏览器/H5 场景，也不得改用或推荐其他网页支付接口。
- 签约侧网站支付使用 `productType=webpay`、`salesCode=I1080300001000041203`，签约 payload 中的应用类型字段为 `PC_WEB`；这里的 `PC_WEB` 是接口字段名，不代表只能用于 PC 端网页。

**❌ 严禁行为**：禁止将明确不支持的产品（如用户明确说"当面付"、"付款码"等）强行往按量付费、网站支付、APP 支付上引导，必须明确告知不支持并引导至外部平台。

## 🚨 执行铁律

### 禁止行为

1. **禁止跳步和绕过确认**：必须严格按已加载 flow/reference 步骤顺序执行；在 flow 标明的阻塞确认处必须等待用户明确回复，禁止用“用户催促”、宿主问答工具超时、默认 fallback、Task 状态或工具返回“proceed using best judgment”等理由跳过或合理化跳过确认。
2. **禁止假数据**：沙箱配置必须用真实数据，禁止占位符。唯一例外是按量付费沙箱联调的 `service_id`，固定使用 `api_mock_service_id`；该值仅用于沙箱调试，生产环境禁止使用。
3. **沙箱化 Agent 联网命令权限**：在存在网络沙箱或命令审批机制的 Agent 环境中，`alipay-cli` 登录、MCP 调用、文件上传、沙箱创建、安装脚本下载等命令应按联网命令处理；若当前工具支持显式网络授权，应首次执行即申请可联网权限，详见 `references/normal/alipay-cli-env.md`。
4. **禁止无依据回答**：遇到没有确定依据的问题，必须明确说明无法确认，不得编造。具体额度解限、可收款时间解限、支付产品开通不确定问题，引导用户前往[支付宝商家平台](https://b.alipay.com/page/portal/home)咨询客服；代码开发、应用创建相关不确定问题，引导用户前往[支付宝开放平台](https://open.alipay.com/)或[支付宝技术支持](https://opensupport.alipay.com/support/intelligent-services?form=payskill)咨询客服。
5. **禁止编造 CLI/MCP 方法**：本规则适用于签约、集成、调试、排障、重试、恢复和降级，不存在“为了调试”例外。当前操作已有 Skill 脚本封装时必须执行脚本，禁止绕过脚本自行拼接 `alipay-cli mcp call`；没有脚本且确需直调时，Server、Tool、参数名和 JSON 结构必须来自当前已读取文档中的完整固定命令，或先通过 `alipay-cli mcp list <server> --json` 实时确认。禁止根据业务名称、相似接口、历史记忆或错误信息推断命令。遇到 `Server not found`、`Method not found` 或 `Invalid params` 时必须停止并回到脚本、文档或实时 schema，禁止更换近似名称连续试错。
6. **执行控制信息禁止对客输出**：flow 步骤名、消息 ID、variant、机器标记和“已执行/已打印/已渲染/runner stdout/下一步进入某步骤”等执行说明都不是对客正文。指定 renderer 或托管脚本时，其 stdout 是该动作唯一对客内容；工具输出记录、折叠面板或日志不等于已对客发送，Agent 必须把 stdout 原文作为当前回复正文发给用户；禁止添加前言、后记、摘要、转述或近似话术，阻塞消息发出后立即停止本轮并等待用户。
7. **用户既有文件保护**：支付接入不得清空或删除既有项目，“新建”“重新做”“换一个”等回复都不构成删除授权；默认保留全部既有文件，只做必要的局部修改，或在用户确认的尚不存在或为空的目录中创建独立项目。用户主动要求删除具体文件时，仍须按 `references/integration/flow.md` 的文件保护规则完成精确清单和独立二次确认；项目根目录、`.git`、通配符删除和清单外路径始终禁止，且必须遵守当前 Agent 环境自身的破坏性操作审批机制。
8. **沙箱配置与测试结论必须分离**：代码开发步骤 1/3 的字段完整性校验只确认候选沙箱配置可落盘或可复核，不代表任何支付链路已经测试。既定创建或字段复核重试耗尽后必须记录 `CREATE_PENDING|VERIFY_PENDING`，由脚本输出统一待配置消息并继续代码实现；待配置只阻止沙箱字段使用、摘要、配置后置校验、联调和付款体验，不得伪造字段或宣称代码开发全部通过。只有配置就绪、代码开发完成并通过配置后置校验后，才输出一张沙箱环境摘要表。只有按量付费在代码开发步骤 6 自动完成 402 Payment-Needed、沙箱收银、Payment-Proof 重试和资源交付全链路后，才可对客输出“沙箱测试通过”或等价结论；网站支付和 APP 支付不得输出该结论。
9. **异步通知验收必须分层说明**：涉及网站支付或 APP 支付的支付结果确认时，必须同时说明两层口径，不得把公网异步通知提前抬成所有本地验收的前置条件。
   - **本地正式验收 / 本地生产参数验收模式**：当用户项目尚未上线、暂时没有可公网访问的 HTTPS `notify_url`，可临时关闭异步通知发起配置或不传 `notify_url`，保留本地结果确认链路并通过交易查询主动确认订单结果；此模式下仍必须实现异步通知处理代码，只是把公网通知联调标记为“人工待验证”，不得宣称生产就绪。
   - **真实生产上线**：异步通知不能长期缺失，必须配置公网 HTTPS `notify_url`，完成验签、幂等、关键字段校验、成功回写 `success` 和补偿查询；没有完成这一层，只能说“已完成本地正式验收”或“已完成本地生产参数验收”，不得说“正式上线完成”或“生产就绪”。
10. **授权页面固定地址**：禁止 Agent 自行拼写、替换或打开授权网站。授权页面只能由 `auth.sh` 在固定产品/MCC 上下文校验通过后生成；只允许 `https://aipay.alipay.com/cli-auth`、唯一的 `deviceCode/productCode/mccCode` 和可选 `platform`。其他域名、路径、参数、重复参数、fragment 和 CLI `verification_url` 一律禁止打开或展示。
11. **固定脚本终态后立即转移**：flow 已登记脚本或 renderer 时，只执行动作发生位置的固定命令。退出码和登记的终态标记满足后立即进入 flow 指定下一步，禁止追加 `jq`、`cat`、`grep`、`curl` 或临时脚本重复解析、复核或解释同一结果；失败只走该动作登记的恢复分支。项目代码实现、自检和运行验证不受此限制，但不得借调试绕过已有 Skill 脚本，也不得把沙箱配置或其他敏感文件打印到工具输出。

### 标准对客消息输出规则

凡 flow 或模块要求使用 `customer-messages.json` 的消息 ID 时，禁止手写近似话术；必须优先执行当前位置给出的托管脚本或 runner。只有当前位置未提供托管入口时，才按同一相对路径模板执行 renderer：

以下消息已有托管入口，运行时禁止套用通用 renderer 示例自行拼 JSON：`integration.start.confirm` 和 `integration.checklist.result` 必须用 `integration_message_runner.mjs`；产品开通的 `onboarding.mcc.clarify`、`onboarding.discovery.summary`、`materials.category.collect` 和 `process.partial_result` 必须用 `onboarding_message_runner.mjs`；`auth.page`、`auth.pending`、`auth.expired`、`auth.mismatch` 必须用 `auth.sh`；`application.key.page` 必须用 `app.sh key`；`key_tool.download.result` 和 `key_tool.download.fallback` 必须用 `download_key_tool.sh`。其中 `materials.category.collect` 不得手写 `categoryName/currentStatus/missingFields`，必须把材料类别、状态和缺失字段交给 `onboarding_message_runner.mjs material-collect` 规范化；最终收口必须把分支状态和紧邻收口的应用操作结果交给 `onboarding_message_runner.mjs closeout` 处理，应用已上线且配置完整时不展开应用分支结果，待审核、待设置公钥、需人工配置、失败或结果未知时才展开，禁止 Agent 手写或连续重复输出下一步。

```bash
# 构造 MESSAGE_INPUT_JSON 前先查看本消息的机器 schema，确认变量白名单、枚举和值级变体规则
node references/normal/scripts/render_customer_message.mjs --schema <messageId> --variant <VARIANT>

# MESSAGE_INPUT_JSON 必须按当前位置的完整命令由 jq --arg/--argjson 生成
printf '%s' "$MESSAGE_INPUT_JSON" | node references/normal/scripts/render_customer_message.mjs <messageId> --variant <VARIANT>
```

动态值必须先保存在 shell 变量中，再由当前位置示例中的 `jq -cn --arg` / `--argjson` 生成 `MESSAGE_INPUT_JSON`；禁止把用户输入、项目路径、接口字段或脚本输出替换进单引号 JSON、命令文本或 `eval`。schema 只用于生成前预检，不能替代 renderer；renderer 返回 `MESSAGE_RENDER_ERROR` 时必须先复查同一 `messageId` + `variant` schema，再修正字段或枚举值，禁止连续猜测近似值。**Skill 内置命令工作目录铁律**：发布文档中的相对脚本路径一律以“包含该命令的 Markdown 文件所在目录”为工作目录解析，不以 Agent 启动目录、用户项目目录或其他历史 Skill 安装目录解析。执行工具支持 `workdir` 时直接将其设置为该文档目录；不支持时先根据当前已加载文件的实际路径定位该目录。用户可以用当前目录下相对路径、绝对路径、“在当前目录新建 pay-demo”或“新建项目”说明目标项目；用户明确要新建但未指定地址时，runner 会在用户目录下选择安全的新目录并返回规范化地址。“当前项目/当前目录”只有在 runner 确认当前目录本身是可识别项目根时才接受为现有项目。用户不知道已有项目位置或只给出大概子目录时，先用当前 flow 登记的 `locate-projects --search-input "$SEARCH_INPUT" --format message` 轻量定位候选目录并等待用户选择，不得把大目录直接交给代码扫描。用户项目的检测、依赖、代码、配置、启动和校验命令仍以已确认项目根目录为工作目录；调用 Skill 内置脚本不改变目标项目，脚本需要项目时必须显式传入该规范化绝对路径。不得靠猜测 `cwd`、反复试错或切换到另一份 Skill 副本修复路径错误。

无变量时也必须传 `{}`。renderer 返回非 0 时停止当前步骤，不得自行补写兜底文案。renderer 成功时必须把 stdout 原文作为当前 assistant 回复发送给用户；命令工具面板里出现 stdout 不算完成对客输出。不得在前后补充“已输出”“已打印”“已渲染”“runner stdout”“请确认以上方案”、步骤名称、消息 ID、控制标记或手写摘要。若消息由脚本托管，例如 `integration_message_runner.mjs start-confirm` 输出 `integration.start.confirm`、`integration_message_runner.mjs checklist-result` 输出 `integration.checklist.result`、`auth.sh init` 输出 `auth.page`、`app.sh key` 输出 `application.key.page`、`sandbox_config.sh summary` 输出沙箱摘要，则执行对应脚本，并把脚本 stdout 原文作为当前回复正文；不得绕过脚本直接改写消息，也不得只说明脚本已展示、已渲染或已输出。

### 执行流程（通用）

```
用户输入 → 自更新检查 → 识别意图与已有上下文 → 加载对应 flow/router → 按 flow 静默准备当前事实 → 只在当前确认点执行指定 renderer 并等待 → 逐步执行
```

不同事实和权限上下文的确认不能提前合并；同一确认点也不得在 renderer 前后另写方案、待办、服务声明或执行说明。`integration_only` 与 `full_process` 的代码开发都使用唯一 `integration.start.confirm`：它绑定同一固定检查器产生的项目来源、代码状态和其他支付产品，以及产品、项目路径、语言/框架和服务声明；每轮代码开发只渲染一次。onboarding 的 MCC/scope 方案确认及服务修改确认仍必须按其实际上下文单独执行；服务创建资料完整且校验通过后展示非阻塞摘要并直接创建，签约材料完整且校验通过后直接提交，新建应用的公钥校验成功后直接提审，三者均不增加回复 `1`。

**启动自更新检查**：每次触发本 Skill 时，先读取并执行 `references/normal/self-update.md` 的自更新检查。若本轮对话中刚成功执行过 `npx -y @alipay/alipay-aipay@latest install`，则视为检查已完成，直接继续后续流程。该检查不作为业务阻塞确认点；发现旧版或无法识别本地版本时自动尝试更新，失败时继续使用当前已加载版本。若当前 Agent 环境要求联网或写入用户 Skill 目录授权，则按环境权限机制处理，不得在 Skill 内另设业务确认点。

**产品推荐入口：**
- 集成场景：读取 `references/integration/modules/product-decision.md` 做支付产品推荐与澄清。
- 产品开通场景：读取 `references/onboarding/flow.md` 的 Step 2“方案规划”做产品匹配与推荐。
- 完整接入场景：先读取 `references/normal/full-process-routing.md` 完成完整接入分流与确认，再衔接两个子流程；业务规则和完成条件仍以两个子流程为准。

三种入口均只在无法从用户已提供的产品名称或业务描述中可靠确定唯一产品时，执行当前入口 flow 登记的 `product.clarify` renderer；不得自由补写产品澄清话术。用户回复的明确业务描述可以按固定产品规则完成映射，不要求再次逐字输入产品名称；仍无法唯一确定时继续使用同一标准消息，不得推定产品。产品已经明确时禁止重复渲染该消息。产品明确但 MCC/经营类目仍无法可靠确定时，产品开通入口必须执行 `onboarding_message_runner.mjs mcc-clarify`，不得手写经营类目补问。

支付产品-代码开发或完整接入启动前缺少项目位置或技术栈时，必须按对应 flow 执行 `integration.context.required` 或 `integration.project_path.required` 标准消息；用户可选择新建项目或复用已有项目。新建项目可以给出尚不存在或为空的目标目录；如果用户明确要新建但不想指定位置，可用 `resolve-project --intent new` 的默认项目规则在用户目录下选择安全新目录并告知项目地址。复用已有项目必须给出明确项目根，或先通过 `integration_message_runner.mjs locate-projects --search-input "$SEARCH_INPUT" --format message` 在当前目录或用户给出的子目录下输出候选并等待用户选择。“当前项目/当前目录”只有在当前目录本身可识别为项目根时才算明确路径，否则保持未解析。禁止使用宿主问答组件、超时默认值、Agent 自创选项或自由话术替代。用户未明确补齐这些字段前，不得创建目录、初始化项目、安装依赖或修改文件。

#### 支付产品-代码开发流程
- 步骤1：环境检查与匿名沙箱准备 → 在产品确定前尝试准备本地沙箱；既定重试耗尽后记录待配置、统一告知并继续代码开发，不展示配置摘要
- 步骤2：产品决策 → **[阻塞确认；`full_process` 复用完整接入唯一启动确认，不重复询问]**
- 步骤3：沙箱配置复核 → 配置已就绪时执行 `sandbox_config.sh reverify`；待配置时保持状态并直接进入步骤4
- 步骤4：代码开发前置 → SDK+本地契约/示例
- 步骤5：代码生成；完成配置后置校验后，才展示沙箱环境摘要
- 步骤6：沙箱测试与体验（按量付费自动完成端到端联调；网站支付必须提供浏览器付款入口，并明确给出“沙箱买家账号登录”或“安卓沙箱支付宝扫码”两种体验方式供用户二选一，`curl` 取得支付表单不算完成；APP 支付跳过）
- 步骤7：代码开发后说明
- 步骤8：代码开发校验 → **[默认自动执行]**

#### 支付产品-产品开通流程
- 步骤1：环境检查
- 步骤2：方案规划
- 步骤3：登录授权 + 签约/应用/适用服务的只读查询
- 步骤4：三分支摘要与分类材料
- 步骤5：独立分支推进
- 步骤6：分支级收口

每次进入签约流程都先校验登录授权，并查询签约、应用和适用服务的真实状态；只按当前动作读取对应模块，禁止一次加载全部分支，也禁止绕过 `auth.sh` 直接调用 `alipay-cli login`。

#### 完整接入流程

识别到“完整接入”“一站式”等 `full_process` 意图时，必须先读取并执行 `references/normal/full-process-routing.md`。完整接入启动确认前只允许按该文件复用 Integration 步骤 1 的项目、语言、CLI 和匿名沙箱准备；不得进入产品代码开发或 onboarding。唯一启动确认必须同时展示并绑定项目扫描状态、产品、项目路径和来源、语言/框架及服务声明；用户输入 `1` 后直接进入 integration 步骤 3，不再重复代码开发确认。该消息不展示步骤清单，但不得据此省略当前产品 Integration flow 的任何适用接口、完成条件或 checklist。代码开发通过后自动进入支付产品-产品开通；只有沙箱待配置且其余代码与安全检查通过，或配置就绪且仅剩非阻塞人工待验证项时，保持代码开发“部分通过”并继续产品开通；代码开发阶段的非阻塞人工待验证项必须在产品开通最终收口中再次展示，不增加用户确认点；其他未通过项仍停在 integration。


## 按需加载

- 通用启动：`references/normal/self-update.md`；环境和拒绝说明仅在对应动作读取 `references/normal/` 下文件。
- 完整接入入口：`references/normal/full-process-routing.md`；仅 `full_process` 读取，用于项目分流、唯一启动确认和两个子流程衔接。
- 集成入口：`references/integration/flow.md`；只按当前产品、语言和步骤读取本地契约/示例/脚本；在线 fallback。
- 产品开通入口：`references/onboarding/flow.md`；只按当前授权、查询或写分支读取对应模块，不提前加载其他分支。
- 机器规则、消息目录、fixture 和测试不作为 Agent 默认必读内容；由生成器、renderer 和校验脚本按 ID 使用。

## 意图识别

| 意图类型 | 关键词 | 流程 |
|----------|--------|------|
| 仅代码开发 | "接入支付"、"集成" | references/integration/flow.md |
| 仅产品开通 | "入驻"、"签约"、"开通"、"产品开通" | references/onboarding/flow.md |
| 全流程 | "完整接入"、"一站式" | references/normal/full-process-routing.md + 两个子流程 |

**流程衔接提醒：**
- 用户明确要求"完整接入"、"一站式"等全流程时，必须先按 `references/normal/full-process-routing.md` 完成项目准备、匿名沙箱准备尝试与代码开发状态分流，然后固定完成支付产品-代码开发流程；沙箱待配置不阻止继续产品开通，但必须保留未完成提醒和部分通过结论。
- 用户只要求支付产品-代码开发时，代码开发流程结束后必须提醒：正式上线前还需要完成支付产品-产品开通。
- 用户只要求支付产品-产品开通时，产品开通流程结束后必须提醒：还需要完成代码开发才能实际发起支付。
