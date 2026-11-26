---
name: alipay-aipay
description: 支付宝 AI 付商家与开发者接入：产品选型、开通、工程集成、接口答疑和排障。涵盖 Vibe Pay 基础收款中的 AI 网页应用收款（网站/H5）、AI 移动应用收款（原生 App）、Machine Pay · AI 按量付费（卖方 HTTP 402），以及 AI连续订阅（Token Pay）的周期订阅、条件自动续购、商业订单单笔支付、企业支付 B2B、数电发票和企业认证；也可查证支付宝 AI 付官方产品资料。不代买方付款。
---

# 支付宝 AI 付接入

## 每次触发

1. 从宿主给出的本文件路径取得所在目录的**绝对路径**，下文以 `<SKILL_DIR>` 表示。Windows 首次使用先按 [Windows 的 Node 启动说明](references/normal/windows-environment.md#已安装-skill-的-node-启动)绑定可用的 Node，后续用其绝对路径代替下文的 `node`。按[全局自更新](references/normal/self-update.md)，当前对话首次使用时先在 Agent 上下文记下自更新已检查事实，再执行一次 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" self-update check`。同一对话的补充回复、恢复和重复触发不再检查。唯一 `UPDATED` 时停止使用旧内容并重读新版入口；`SESSION_READY` 时明确全局未更新，改用已验证会话副本并重读入口。失败继续当前可用入口；只有 `RETRY_WITH_NETWORK` 在恢复网络后原样重试一次。
2. 在加载任何产品资料或回答业务问题**之前**，按[全局采集选择与撤回](references/normal/conversation-telemetry.md)用同一 runtime 的 `telemetry resolve-session` 和 `conversation status --session-id SESSION_ID` 读取本机当前系统用户保存的采集偏好。已有 `GRANTED` 或 `DENIED` 时直接沿用，不因新聊天、切换 Agent 或普通 Skill 更新再次询问。没有有效选择（LOCAL + UNSET）时执行 `conversation notice --session-id SESSION_ID`，原样回复完整声明。等待“同意采集”或“仅使用服务”，**本轮到这里结束**。查询状态或显示失败时也不得推定同意；采集不可用时继续服务，不记录正文或摘要。旧版仅限本次会话的同意不自动扩展为长期偏好，首次使用新声明须重新选择。首次回复同时包含明确拒绝和业务需求时，登记“仅使用服务”后继续处理同一条业务需求。
3. 两种选择都能使用服务。“仅使用服务”只记录实际业务阶段，不记录问题、答复或摘要。用户本轮确认同意，或 preference 中已有有效的同意记录，均立即开始采集。已有记录时无需再次询问，从当前聊天触发 Skill 的那条用户消息开始记录。按[会话采集规则](references/normal/conversation-telemetry.md)实际调用 `telemetry start-conversation` 或 `telemetry conversation-message`，检查 `CONVERSATION_MESSAGE_RECORDED` 成功回执；只读取状态不算采集。写入失败时重试当前消息，沿用同一消息 ID，以成功回执为准。同一聊天的后续消息沿用同一个采集会话，不同聊天各自建立会话；首次同意后按规则补采本次触发起的相关对话。

   对已获授权且符合采集范围的用户消息和助手回复，能拿到完整正文时，逐字上报，保留标点、换行和格式，只把敏感片段替换为 `[REDACTED]`。拿不到完整正文时，可上报脱敏摘要，开头标注 `【摘要】`。无法确认主要内容时跳过该条。

   逐条记录用户输入。助手每轮采集结束本轮时的完整正式答复，包括等待用户补充、选择、确认的回复，以及本轮结果交付，保留其中所有段落、列表和表格。执行中的进度播报、工具输出和内部思考不采集，宿主是否折叠这些内容不影响判断。记录先在本地入队，再异步上传。每轮先处理停止采集要求。Token Pay 可以附一份脱敏问题摘要；停止会将本机偏好更新为“仅使用服务”，后续触发也沿用，任务正常结束则保留原选择。采集故障时重试，服务正常继续，不补记未经授权的正文。
4. 需要外部支付宝 CLI 的执行任务，由公共准备入口按[任务级 CLI 准备](references/normal/alipay-cli-env.md#10-任务级-cli-准备)自动刷新一次并复用本任务结果；只读问答、资料阅读和本地校验不触发。

## 对客答复

- 采集说明、业务答案、方案、选择提示、操作指引和办理结果必须实际发送为用户可见的答复。展示与采集分开判断：必须展示不等于需要采集，非阻塞登记消息只展示，不调用会话采集命令。内部思考中拟好正文、工具返回正文或采集成功都不算交付；不得因此省略回复或推进依赖该回复的业务。收口或等待前核对本轮应交付正文，发现漏发先补发原文，不重放业务操作。非阻塞登记消息独立送达后继续原流程，不为展示而提前结束任务。
- 宿主区分通道时，analysis/reasoning 不承载对客交付。执行中只能使用 commentary 时，将正式业务正文独立发送，不与“正在检查、准备执行”等进度旁白混写；需要用户选择或操作的内容及最终结果须在本轮正式答复中完整交付，不能只留在折叠的执行区域。
- 业务答复说明已完成的工作、当前阻塞和下一步所需条件；选择提示直接展示选项和所需信息。内部协作或校验失败时使用业务语言，不将 Worker、门禁、协议字段、runner/stdout、本地 Skill 路径或规则引文作为业务结果，也不笼统称“整个接入失败”。用户明确要求诊断时可解释相关技术依据。若宿主更高优先级规则明确要求解释或引用，只提供必要的独立说明并与业务正文分开；不主动扩展、不重复引用，也不据此增加确认步骤。Skill 不修改宿主规则或承诺覆盖该要求。

## 用户这次想做什么

- 包内资料足以回答时，直接使用对应资料。介绍产品用途和使用场景时，可以引用已核实的官方产品页。需要补充依据或核实最新口径时，先读[官网查询说明](references/official-website.md)，从 `llms.txt` 查找相关详情页。涉及接口、权限或办理条件时，以能直接说明该项细节的资料为依据；仍无法核实，就说明哪部分未知。
- 需要比较产品、区分同一品牌下的能力，或确认表外产品能否办理或集成时，查[产品决策与能力表](references/product-decision.md)。只有当不同理解会改变答案或下一步时才追问。只问原因、规则或排查方法时直接回答。要求检查现有工程时按指定范围定位，明确要求修复时再改代码。产品和执行目标明确后再初始化对应流程。
- 从下表直达已明确的任务。一项需求包含多个目标时分别承接，说明彼此依赖和各自待确认的条件。中途查资料沿用当前项目、环境和进度。

| 用户目标 | 所属产品 | 商家办理 | 工程开发／专业资料 |
| --- | --- | --- | --- |
| 我已有订单，要在电脑网页或手机 H5 收款 | Vibe Pay · 基础收款 | [网页收款开通](references/onboarding/vibe-pay/web-pay.md) | [AI 网页应用收款](references/integration/vibe-pay/web-pay.md) |
| 我已有订单，要在原生 App 内收款 | Vibe Pay · 基础收款 | [移动应用收款开通](references/onboarding/vibe-pay/app-pay.md) | [AI 移动应用收款](references/integration/vibe-pay/app-pay.md) |
| 我提供 API、内容或算力，想按调用向使用方收费 | Machine Pay · AI 按量付费 | [按量付费开通](references/onboarding/machine-pay/flow.md) | [HTTP 402 收款接入](references/integration/machine-pay/flow.md) |
| 我卖月会员或团队席位，需要按周期自动续费 | AI连续订阅（Token Pay） | [周期订阅办理指引](references/onboarding/token-pay/guidance.md) | [周期订阅接入](references/integration/token-pay/flow.md)、[已知故障](references/integration/token-pay/troubleshooting.md) |
| 我希望用户余额低于约定值时自动续购 | AI连续订阅（Token Pay） | [自动续购办理指引](references/onboarding/token-pay/auto-renewal.md) | [协议与自动续购](references/integration/token-pay/auto-renewal.md) |
| 我使用商业订单完成一次性收款 | AI连续订阅（Token Pay） | [单笔支付办理指引](references/onboarding/token-pay/single-payment.md) | [商业订单单笔支付](references/integration/token-pay/single-payment.md) |
| 我要支持企业聚合收银、对公转账或资金对账 | AI连续订阅（Token Pay） | [B2B 办理指引](references/onboarding/token-pay/b2b.md) | [企业支付接入](references/integration/token-pay/b2b/integration-workflow.md) |
| 我要开数电发票、合并开票或红冲 | AI连续订阅（Token Pay） | [开票准备指引](references/onboarding/token-pay/invoice.md) | [发票接入](references/integration/token-pay/invoice/integration.md)、[红冲与通知](references/integration/token-pay/invoice/lifecycle.md) |
| 我要做企业四要素核验或对公账户打款核验 | AI连续订阅（Token Pay） | [认证准备指引](references/onboarding/token-pay/verification.md) | [企业认证接入](references/integration/token-pay/verification/integration.md)、[认证接口](references/integration/token-pay/verification/api-contract.md) |

Token Pay 的商家办理仅提供指引，本包不投递线索或代签约。业务授权也不等于采集同意。仅在用户明确提出特定订阅接入身份、模式、受邀接口或生产测试客户问题时查[适用条件](references/integration/token-pay/access-modes.md)，一般问答不加载。

接口问答按专属接口选择上表资料：`invoice.*`、`enterprisecertify.*`、`bankverify.*` 优先于泛 `saas.*` 的企业支付路由；不能仅凭“企业”“银行转账”或“OpenMQ”切换产品域。

周期订阅的取消退款、独立退款、客诉超标自动退款（`AUTO_PENALTY`）和批量退款查询见[订阅退款接口](references/integration/token-pay/api-complete.md#批量退款查询接口-alipaytradecommercialbatchrefundquery)与[退款通知](references/integration/token-pay/notification-guide.md#52-alipaytradecommercialbatchrefundchanged-消息体批量退款状态通知)。

实际开始开发或办理时，按[业务阶段与完成证据](references/normal/telemetry.md)记录本次任务；专业问答不创建业务 run。

网页收款、移动应用收款和按量付费在明确办理或开发后，按[运行指引](references/runtime-entry.md)进入相应流程。只开发不自动签约，只开通不改工程。明确要求两者时按[完整接入衔接](references/normal/full-process-routing.md)核对当前产品和开发结果，再决定是否自动进入办理。开发遇阻后商家明确要求先开通，走独立办理并保留实际开发结果。

VibePay、MachinePay 与 TokenPay 周期订阅共用[沙箱配置模块](references/integration/sandbox/sandbox-setup-guide.md)，完整配置保存到项目根 `.alipay-sandbox.json`；周期订阅仅复用基础凭据获取，不接入对客沙箱展示，各产品保留自身登记、通知和联调流程。

Token Pay 六项分别使用本项身份、权限、金额单位、通知与状态；工程验证走本地模拟或已授权的适用沙箱。周期订阅的测试时钟不能验证其他五项。生产准备可核对资料，不在评审版执行真实支付、生产扣款、开票、认证或资金操作。
