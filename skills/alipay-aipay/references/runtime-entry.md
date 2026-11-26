# 收单运行入口（网页、App、卖方 402）
## 支持范围

本执行入口承接 AI 网页应用收款（网页/H5）、AI 移动应用收款（原生 App）、AI 按量付费（卖方 HTTP 402）。名称与场景的对应见[产品选择](product-decision.md)。仅当用户明确要开通或开发当面付、付款码、订单码支付、JSAPI 支付、预授权支付、独立商家扣款等本收单流程不支持的能力时，按[收单拒绝引导](normal/rejection-guide.md)处理。只问适用范围或产品区别时可[核对官网](official-website.md)；周期会员续费走订阅入口。

AI 网页应用收款覆盖 PC 网页和手机浏览器/H5，接口固定 `alipay.trade.page.pay`，签约固定 `productType=webpay`、`salesCode=I1080300001000041203`、`appType=PC_WEB`；`PC_WEB` 不表示仅 PC。

## 执行红线

1. **流程与确认**：按 flow 顺序执行；阻塞确认只认用户对当前摘要的明确回复，不以工具超时、默认值或 Task 状态代替，不增未登记操作、材料或确认。
2. **事实与依据**。Agent 核对工程配置看当前实现，核对接口和产品规则看包内契约或按[官网查证说明](official-website.md)读取官方详情，判断商户开通状态看实际查询结果或办理回执。依据不足时说明哪项无法确认。静态检查通过只说明检查项通过，提交成功只说明已提交。
   商家需要申请额度解限、查询可收款时间或办理产品开通时，引导前往[支付宝商家平台](https://b.alipay.com/page/portal/home)。商家创建或发布应用可前往[支付宝开放平台](https://open.alipay.com/)，需要开发协助可联系[支付宝技术支持](https://opensupport.alipay.com/support/intelligent-services?form=payskill)。
3. **CLI/MCP 契约**：优先用动作处脚本；直调的完整方法和 JSON 仅来自已读文档或 `alipay-cli mcp list <server> --json` 实时 schema。遇到 `Server not found`、`Method not found`、`Invalid params` 立即停下核对，禁止试近似名称。
4. **联网权限**：`alipay-cli` 登录/MCP、上传、沙箱创建和下载按联网命令处理；支持显式授权时首次即申请，详见 `normal/alipay-cli-env.md`。
5. **用户文件**：只改已确认项目和范围，不清空或删除既有项目；“新建/重做/换一个”不是删除授权。具体删除仍遵守 Integration flow 的清单、二次确认和禁删边界。
6. **敏感信息**：应用公钥仅由用户生成并明确提供；禁止请求/处理生产私钥、生成密钥对、补全/改写公钥或添加 PEM 头尾。敏感值、临时 URL 和沙箱资料遵守对应 flow/script 的白名单、权限和输出边界。
7. **沙箱配置与结论**：VibePay、MachinePay、TokenPay 周期订阅共用 `runtime.mjs sandbox`，完整获取/校验/保存/复用项目根 `.alipay-sandbox.json`；见[公共契约](integration/sandbox/sandbox-setup-guide.md)。订阅仅放行基础配置获取、复核及必要环境动作，不放行 sandbox summary 或收单开通。真实快速沙箱配置不得用占位值，唯一例外是 AI 按量付费沙箱 `service_id=api_mock_service_id`，且生产禁用。`CREATE_PENDING|VERIFY_PENDING` 只允许继续代码实现，阻止字段使用、摘要、后置校验、联调和付款体验。字段校验不等于支付测试；仅完整 402 链路满足 flow 才可称沙箱测试通过。
8. **异步通知**：AI 网页应用收款/AI 移动应用收款必须实现通知处理和交易查询。`notify_url` 是可选参数；生产也允许省略。未配置时不触发该地址的异步通知，必须由商家服务端通过 `alipay.trade.query` 主动确认支付结果，校验订单、金额、支付状态及归属，幂等更新订单；即使用户关闭页面，仍须继续处理查询重试和未决订单。如使用异步通知，配置商家已部署、支付宝服务端可公网访问的 HTTP/HTTPS 地址并完成验签、关键字段校验、幂等、`success` 回写和补偿查询。不能只因没有公网通知地址阻止流程或判定不能上线；通知处理代码仍须实现，实际代码或支付结果确认链路缺陷仍是阻断项。
9. **受控页面**：授权链接仅由 `auth.sh` 按固定产品/MCC 生成，只允许 `https://aipay.alipay.com/cli-auth` 及登记参数，禁用 CLI `verification_url`；公钥页和系统 opener 只走登记脚本。失败后宿主内置浏览器只可打开已交付的同一 URL 一次；仍失败才提示手动打开，再有限轮询。禁止搜索、改写或自动操作；opener/config 写失败不算业务失败。
10. **对客输出**：指定 runner/renderer/脚本时，stdout 是唯一对客正文，须原文回复且不加旁白；工具输出记录、折叠面板或日志不等于已对客发送。展示命令只执行登记单条命令，禁 `2>&1`、管道、`grep/sed/awk/tee`、临时包装或拆回 `jq/printf/renderer`。除 `self_update.mjs` 的 `SELF_UPDATE:*` stderr 终态外，内部事实行均以 `ALIPAY_AIPAY_INTERNAL:` 开头；宿主合并输出时仍整行剔除，严禁对客。`integration.start.confirm`、`onboarding.plan.confirm`、`sandbox.configuration.pending`、`sandbox.environment.summary`、`integration.safety.closeout` 和 `integration.checklist.result` 成功渲染时必须各自产生唯一 `ALIPAY_AIPAY_INTERNAL:CUSTOMER_MESSAGE_DELIVERY_REQUIRED=<messageId>`；下一动作先将剔除内部行后的 stdout 原文作为独立可见消息送达，不得以工具面板、折叠输出、进度话术或最终答复代替，也不得在送达前继续调用工具。送达后同回合按 flow 继续，不等待回复。成功沙箱准备 `READY` 时 stdout 仍按 flow 静默，不构成交付消息；收单产品的待配置正文和后置摘要需要交付；周期订阅的公共沙箱调用仅返回内部状态，不生成对客消息。所有 `postRenderHintType=scanReturn` 的页面消息都是交付屏障（当前为 `auth.page`、`application.key.page`）：先独立送达页面 stdout，再执行受控 opener 和有限轮询，不合并 pending/收口；不要求确认。阻塞正文后等待；剔除内部行后正文为空则直接转移。
11. **确定性转移**：固定脚本终态后立即转移；只执行动作处登记命令，禁止追加 `jq/cat/grep/curl` 或临时脚本重复解析。失败只走登记恢复；项目自检不绕过 Skill 脚本或打印敏感配置。

## 标准消息

执行[主入口的对客答复规则](../SKILL.md#对客答复)：业务正文必须实际发送给用户，不能停在 analysis/reasoning、工具输出或采集记录里。展示与采集分别判断：非阻塞登记消息或页面要求下一动作先交付时，先按 flow 交付，再继续后续业务，不调用会话采集命令；“必须送达”不等于“必须采集”。只有本轮阻塞回复和最终收口按[会话采集顺序](normal/conversation-telemetry.md#授权与逐条记录)在发送前尝试记录，同一条回复不重复采集，采集失败不阻止交付。阻塞回复的发送前采集是交付屏障的例外，不增加业务操作。业务正文说明实际结果、阻塞和下一步，不主动附加本地文件路径、内部协作名称或协议解释；宿主强制说明的例外见主入口。

`normal/json/customer-messages.json` 是稳定对客正文唯一目录。Integration 启动使用 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message start-confirm --root-intent "$ROOT_INTENT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`，收口使用 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message checklist-result --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`；Onboarding 的 MCC、发现、材料、候选、收口及授权、公钥页、密钥工具、错误均用登记 runtime 动作。`process.partial_result` 必须发送 closeout 动作的完整 stdout，缺少 AI 网页应用收款上线关键点或收款限制引导即未送达。仅无托管入口时直调 renderer：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" render --schema <messageId> --variant <VARIANT> --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" render <messageId> --variant <VARIANT> --input-json "$MESSAGE_INPUT_JSON" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

动态 JSON 只取本轮事实；无变量传 `{}`，禁止字符串替换或 `eval`。正常路径禁止预跑 `render --schema` 或用 `jq`/消息目录探测字段。renderer 返回 `MESSAGE_RENDER_ERROR` 时必须先复查同一 `messageId` + `variant` schema，禁止猜枚举；非 0 即停止，不手写兜底。

阻塞点展示登记摘要后，把用户原始回复交给 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" reply confirm --reply "$USER_REPLY" --input-id "$USER_INPUT_ID" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`；仅唯一 `ALIPAY_AIPAY_INTERNAL:REPLY_DECISION=CONFIRMED` 可推进。`1`、`继续/继续推进`、`好了/已完成`、`确认/确定/同意`、`OK` 等明确肯定表达等价；否定、疑问、取消、修改或含糊回复不确认。确认只绑定当前产品、项目、主体、候选和摘要，任一变化即失效；此校验不新增操作点。

`<SKILL_DIR>` 是启动器确定的当前 Skill 规范化绝对路径占位符，不是 shell 变量。Skill 自有受控 Node、Shell 和 Python 入口必须使用文档登记的 `<SKILL_DIR>/references/...` 绝对路径单命令执行，禁止前置 `cd`、拼 `&&`、管道或退回相对路径；这些入口不新增权限确认或业务操作点。未登记命令和用户项目命令仍使用所在 Markdown 目录或已确认项目根，不得借用 Skill 权限。

## 入口路由

### 当前对话的稳定会话身份

沿用主入口已取得的 `SESSION_ID`，在当前对话的业务命令中传入同一值。仅在当前上下文无法恢复该值时，才按下文确定 `AGENT_PLATFORM` 并执行以下命令。

```text
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" telemetry resolve-session --agent-platform "<AGENT_PLATFORM>"
```

从唯一 `ALIPAY_AIPAY_INTERNAL:SESSION_ID=<值>` marker 取得 `SESSION_ID`，只保留在当前 Agent 对话上下文，不对客、不新增业务状态。第三方项目 ID 不是会话 ID，新会话协议不拿项目 ID 定位 run；业务 PLATFORM_ID 的项目优先规则保持不变。该只读动作沿用显式 `ALIPAY_AIPAY_SESSION_ID` 或当前可靠的宿主/通用 session 来源；没有匹配的 session 来源时生成独立 UUID，不借用其他宿主残留 ID，也不使用共享默认文件。后续本文件、flow 和模块中的每条 runtime 命令均追加 `--session-id "<SESSION_ID>"`，包括用户输入计数、stage、错误恢复和 Onboarding 衔接；占位符替换为同一个已取得的值。gateway 在读取 active run 和业务参数解析前剥离该参数，并通过 `ALIPAY_AIPAY_SESSION_ID` 传给全部子进程。

同一对话不得每条命令重新 resolve 或生成会话 ID；宿主名称变化不改变已取得的 `SESSION_ID`。中断或压缩后能可靠恢复原值时继续使用，无法恢复时重新 resolve，并重新取得正式 `RUN_ID`，不得把旧 `RUN_ID` 强行绑定到新会话。Full Process Worker 必须接收并使用主 Agent 的同一 `SESSION_ID`，不得自行 resolve。会话 ID 只负责状态定位，不生成 `run_id`，不改变 UUID 创建、组合复用、用户输入计数、stage 唯一性或最终 summary 关闭规则。

首次路由前，Agent 在当前上下文自行回答“当前承载我的 Agent 工具叫什么”，从宿主明确身份、系统说明或当前工具上下文取得工具名称，记为 `AGENT_PLATFORM`（例如 `WorkBuddy`），不向用户提问、不把这段判断对客输出。不得把底层模型名称、项目名称、安装目录或用户举例当作当前宿主身份；无法确认时才使用 `unknown`。该事实仅保留当前对话，不写缓存；上下文丢失时重新判断。

从首条 bootstrap/start-run 起，本文件及所有 flow 登记的每条 runtime 命令均追加 `--agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`，将两个占位符分别替换为当前工具名称和根入口已取得的同一会话 ID；不使用环境变量前缀，不依赖前一次工具调用的进程环境。gateway 在业务参数解析前剥离此公共参数，规范化后传给当前进程及子进程。业务 CLI 的 `PLATFORM` 和遥测 Yuyan `d2` 优先使用本次命令的 Agent 宿名，只有该值为 `unknown` 或非法时才检查当前进程的宿主自动识别信号；继承的通用平台变量只能作为末级兼容值。这样即使进程同时残留其他宿主的 session/thread 环境变量，也不得遮蔽本次 runtime 明确提供的当前宿主。所有来源中的 `unknown` 或非法值都继续回退，不得提前终止识别。该兜底不使用宿主名称枚举或映射表：纯 ASCII 名称统一小写并去除空格、下划线和连字符，合法 Unicode 名称保留可读原文；无法安全规范化仍为 `unknown`。该参数不改变业务确认、run_id、PLATFORM_ID 或模型字段。

根入口已选定收单产品和任务，保留同一产品标识及版本。首次服务选择由根入口处理，业务执行不再询问。产品或任务不明确时回根入口澄清；解释现象、错误码或排障思路时直接读取资料并回答。用户要求检查实际工程时才进入开发流程，只要定位就先给诊断，明确要求修复再修改。外部 CLI 的首次刷新由实际任务的公共准备入口托管：`env check|integration-check` 自动准备，早于该步骤的 MCC 远端查询也复用同一函数；只读资料、本地匹配和项目校验不刷新。成功事实由脚本按 run、Skill 路径和版本保存并复用，Agent 不单独维护刷新步骤；失败只按 `normal/alipay-cli-env.md` 有限恢复。之后按实际环境结果继续下表对应的任务。

| 意图 | 判定 | 入口 | 后续按需加载 |
|---|---|---|---|
| `integration_only` | 明确要求开发、检查或修复实际工程，当前任务不包含产品开通 | 执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-bootstrap --root-intent integration_only --product-type <aipay\|webpay\|apppay> --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"` | 当前阶段、产品和语言的契约、示例与脚本 |
| `onboarding_only` | 只要求签约、入驻或产品开通，未同时要求代码开发 | 执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-bootstrap --root-intent onboarding_only --product-type <aipay\|webpay\|apppay> --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"` | 当前阶段的授权、查询或写分支模块 |
| `full_process` | 明确要求完整接入、一站式，或同一请求同时要求代码开发和产品开通 | `normal/full-process-routing.md` | 先 Integration，满足衔接条件后 Onboarding |

`ROOT_INTENT` 由入口路由确定，只能取 `integration_only`、`onboarding_only` 或 `full_process`。

原生 Windows 在本次服务选择、任务和产品已确定后、创建业务 run 前，执行[Windows 环境分流](normal/windows-environment.md)。使用根入口取得的 Node 绝对路径：

```text
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" windows-entry --root-intent "<ROOT_INTENT>" --product-type "<PRODUCT_TYPE>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

从唯一且任务匹配的 WINDOWS_ROUTE 取得分流，后续 Windows 调用均附加 `--windows-route "<ROUTE>"`。READY 可在本机执行快速沙箱、办理开通；CODE_ONLY 跳过自动沙箱创建并继续可独立执行的开发，三款收单产品在开通阶段改为官网指引；LEGACY 使用手工沙箱、站点开通；BLOCKED 停止依赖该环境的动作。Windows 环境是 Skill 公共能力，产品入口声明准备策略和失败兜底；当前三款收单执行任务默认自动准备用户级依赖，无需另问或切换版本。`--prepare-authorized false` 仅用于用户明确拒绝安装；其他产品沿用各自策略，不自动套用收单官网引导。任务改变或修复后，用当前产品和任务重新分流。详情与错误恢复见环境文档。

开发和开通 bootstrap 均要求明确的任务和唯一产品；缺少其一时在项目、环境、沙箱动作前退出。收单阶段命令均须传已确认的 `--product-type`。两个 bootstrap 各只创建/复用一次当前业务 run；用户在开发失败后明确改为先开通时，沿用已选产品，启动独立 onboarding_only；开发结论和待修项保留在先前开发结果中，办理结果另报。完整接入按[跨阶段交接](normal/full-process-routing.md)进入开通，不再启动第二个 run。

环境、沙箱、项目检查和开通命令校验本会话当前产品和任务。执行入口读取已建立的活动任务。当前任务无法读取时，按会话恢复或复用对应 bootstrap；命令参数不能代替活动任务。仅使用服务或关闭采集时仍可通过 bootstrap 建立必要的业务状态。会话授权和只读产品选择均不需要业务 run。

`full_process` 识别根意图后，仅在产品已唯一确定时执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" telemetry start-run --root-intent full_process --product-type <aipay|webpay|apppay> --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`；产品未确定时只回根入口澄清，明确后再执行。`integration_only` 和 `onboarding_only` 已由上表各自 bootstrap 包含同一次 `start-run` 时不得重复执行。命令创建或复用后必须从唯一 `ALIPAY_AIPAY_INTERNAL:RUN_ID=<run_id>` marker 取得 `RUN_ID`，不得自行编造；同一 active 组合复用，组合变化或旧 run 已关闭时生成新的 UUID run。触发首个新 run 的消息不计入新 run；已有 active run 时，组合切换消息按下方统一前置协议先计入旧 run，随后旧 run 关闭且不补 summary，该消息不在新 run 重计。第三方项目 ID 只保留为业务 `PLATFORM_ID` 的优先项目维度，绝不反向生成逻辑 `run_id`；缺少第三方项目 ID 时，`common.sh` 仍以当前 `run_id` 作为 `PLATFORM_ID`。

按当前任务决定 run 终态。`integration_only` 由 `integration_summary` 终结；`onboarding_only` 由 `onboarding_summary` 终结；`full_process` 由 `all_summary` 终结，`full_process` 的 `integration_summary` 只是中间 event。阶段生成、保存和投递遵循[全局阶段记录](normal/telemetry.md)；选择“仅使用服务”仍记录阶段，同一 run 的同一 stage 只记录一次。

会话正文与阶段记录是两回事。仅当本机保存的[采集偏好](normal/conversation-telemetry.md)为有效同意时，才用当前宿主会话标识和独立的 conversation_id 记录脱敏消息及结束状态；新聊天沿用选择，不沿用其他聊天的 conversation_id。关闭、拒绝或保存失败不影响原业务。

运行时命令使用 `$CONVERSATION_ID` 和 `$RUN_ID` 作为 Shell 变量；协议字段统一写为 `conversation_id` 和 `run_id`。对话采集不关联业务 run，按每轮头尾记录：用户输入逐条采集，助手只采本轮阻塞回复或最终收口，同一条只采一次；轮内方案、摘要、指引、checklist 等非阻塞登记消息，以及 analysis/reasoning、主动进度播报、过程旁白、工具输出、system 消息和附件内容均不采集。仅对已同意且正在采集的会话按会话说明执行；实际完成或用户结束任务时，记录最后答复、执行 `telemetry end-conversation` 后正常发送该答复，不因一轮回复结束就关闭采集。用户撤回时先按 opt-out 停止。采集失败静默，不阻断 Skill。

用户输入计数是入口前置职责，只从 `clarify_intent` 之后开始，到当前 `run_id` 的 `summary` 收口为止。当前 active run 期间，聊天框里**每收到一条用户消息都必须先计一次**，再做任何 Skill 相关或非 Skill 相关处理；计数不按是否与 Skill 流程强相关筛选。只要是用户在 Agent 对话框发送的消息，就按一条计，不计宿主/系统/网页授权、扫码、Skill stage、runner、工具调用或自动轮询。文字、图片/文件、空白/短确认、材料补充、确认回复和中途插话都按一条用户消息计；同一条消息含文字和图片/文件仍只计一条。`USER_INPUT_ID` 是当前 active run 内用户消息的本地幂等键：Agent 给每条新用户消息分配对话内单调序号，同一消息重试复用同一值。`USER_INPUT_ID` 不得包含或派生自用户输入内容、文件名、路径、截图/OCR、业务材料、stage 名或工具调用序号；运行时只保存其本地 hash，不上报。

`start-run` 的 `clarify_intent` 开始生成后计数器为 0，直到当前 run 最终 summary 到达。Agent 每收到一条聊天框用户消息，都必须先分配不含消息内容的 `USER_INPUT_ID`，执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" telemetry count-user-input --run-id "$RUN_ID" --input-id "$USER_INPUT_ID" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`，再解释、分类、路由、调用 runner/tool 或回复；不论消息是否与 Skill 相关，文字、图片/文件、空白、确认、中途插话和打断后输入都执行。同一消息重试复用同一 ID，runtime 只保存 `run_id + USER_INPUT_ID` hash。无 active run、缺少/错误 run ID 或 run 已关闭时成功 no-op。runner、recovery、renderer、交互回复、tool call/result 和 stage 禁止隐式计数；它们保留的业务 `--input-id` 也不是计数兜底。宿主总入口不在仓库内，因此这是 Agent 收到消息后必须遵循的唯一显式计数动作，不增加用户操作。

每个登记 stage 动作前，Agent 回顾当前可见历史并得到 `HISTORY_COUNT`；只统计本 run `clarify_intent` 后的用户角色消息，无法可靠回顾时使用 `null`。调用能生成 stage 的业务命令时追加 `--telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT"`，由统一 gateway 在业务 parser 前剥离并传给唯一 stage 责任方，Agent 不再额外调用 `telemetry stage`。首个业务 run 在任务与产品均明确后创建，后续动作复用它。`c4` 只承载 `user_input_after_clarify_intent`、`history_count`、`root_intent` 和按唯一非 summary event 数计算的 `progress_pct`；正式计数始终取 runtime counter，history 只诊断、不纠偏。

三种入口都已确定产品；需求变化时回到根入口只读核实；产品明确但缺 MCC 用 `mcc-clarify`，且必须携带当前 `ROOT_INTENT`，由 runner 先创建或复用正式 telemetry run。已有经营描述、名称或编码时只执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" mcc resolve-plan --query "$MCC_SEARCH_QUERY" --product-type "$PRODUCT_TYPE" --root-intent "$ROOT_INTENT" [--semantic-terms-json "$MCC_SEMANTIC_TERMS_JSON"] [--agent-candidate-refs-json "$MCC_AGENT_CANDIDATE_REFS_JSON"] --input-id "$USER_INPUT_ID" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`。`ROOT_INTENT` 缺失或非法时 runner 必须停止，禁止依赖跨进程环境变量静默推断或在没有正式 run 的情况下继续 MCC 查询。合法编码或规范化后的完整类目名称直接核验；其他自然语言必须基于同一次 `queryMcc` 返回的当前产品完整目录，由 Agent 做一次受限判断。本地字词检索和最多 12 个有原话依据的辅助语义词只提供线索，不限定目录范围。收到 `MCC_AGENT_REVIEW_REQUIRED` 后，Agent 以同一 query、语义词和 `USER_INPUT_ID` 返回最多 8 个本轮目录引用；脚本校验后以该集合为准，不补回字词命中。明确 `[]` 表示无匹配，不再语义扩充重试；未取得合法判断、复核预算耗尽或缓存故障时停止匹配并恢复目录判断，不以本地检索兜底。目录复核不新增 MCP/网络调用或用户确认，禁止硬编码映射、自由提交 MCC code、远程语义或手拼候选。runner 只为命中且 `needSpecialQual=true` 的候选调用一次 `batchQueryMcc`，并复用有效的同 run/产品候选快照；完整规则见 Onboarding entry。

代码开发或完整接入缺项目位置/服务端语言时，使用 `integration.context.required` 或 `integration.project_path.required` 标准消息；框架缺失不触发补问。先区分新建/复用，`PROJECT_INPUT` 保留原话。Agent 确定两类项目的真实 `PROJECT_PATH`，以 `resolve-project --project-path "$PROJECT_PATH" --intent <existing|new>` 交 runner 校验；`PROJECT_INPUT` 不得代替路径。默认新建也先选安全路径并显式传入。现有项目位置未知时先定位候选；路径经 `resolve-project` 后再用 `framework-resolve`。补齐前不初始化、装依赖或改文件。

每轮代码开发只渲染一次非阻塞 `integration.start.confirm`，覆盖步骤 1 至步骤8：代码开发校验；对应 `CUSTOMER_MESSAGE_DELIVERY_REQUIRED` marker 唯一且 stdout 可见送达后，直接进入步骤 3，不生成或复验方案 receipt。`clarify_intent` 作为 run 起点，后续用户输入只计入 `user_input_after_clarify_intent`，前置澄清/方案不计。Onboarding 只保留一次非阻塞方案展示；同样只有 marker 唯一且 stdout 已可见送达，才允许在 MCC 唯一事实有效后执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-execute-ready --product-type "$PRODUCT_TYPE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`。该组合动作只串行加载 `flow onboarding execute` 并执行既有 `env check`，不跨用户输入、授权页或任何写操作；执行后不得再重复单独加载 execute phase 或重复环境检查。两类方案送达后都自动继续，不等待回复。服务修改仍保留绑定当前摘要的阻塞确认。签约材料完整后直接提交，服务创建摘要后直接创建，新建应用公钥校验成功后直接提审。

扫码页非阻塞：授权最多 12 次/间隔 5 秒，公钥最多 20 次/间隔 2 秒，成功即推进；耗尽后经统一回复判定只查一次，不重启轮询。

`full_process` 代码开发方案送达前只准备项目、语言、系统分支环境和沙箱；Windows LEGACY/CODE_ONLY 未明确要求当前配置时记 `VERIFY_PENDING`，不收资料。方案送达后直接进入 Integration 步骤 3，满足条件自动进 Onboarding；仅沙箱待配置，或 READY 且只剩非阻塞人工验证时可部分通过，其他缺口停在 Integration；收口保留全部待办。用户中断后重新确认当前项目和服务端语言，从实际项目扫描恢复，不恢复旧方案状态。

checklist 的有限修复、禁止循环检测及局部修复后的定向复检只按 Integration flow 步骤 8 执行，不能因阶段重入重新运行全部测试。

仅代码开发结束时提醒仍需产品开通；仅产品开通结束时提醒仍需代码开发。机器规则、消息目录、fixture 和测试不作为默认必读内容。

遥测与业务必要证据的故障分开处理：事件、正文偏好、队列或上传故障不阻断服务；run 存储故障先由 runtime 恢复最小业务上下文。若必要工程检查、任务上下文或 handoff 证据仍无法保存或核验，仅停止依赖该证据的动作并说明恢复方法。不得臆造通过结论、跳过校验或重放外部写操作。
