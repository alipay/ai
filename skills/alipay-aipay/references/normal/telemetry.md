# 接入阶段记录

使用本 Skill 的 runtime（`references/normal/scripts/runtime.mjs`）；会话文本的独立授权见[会话采集](conversation-telemetry.md)。默认先本地入队，再通过 `https://collect.alipay.com/yuyan/` 的 syncLog 通道上传；失败保留队列，后续沿用原有补传机制。选择“仅使用服务”后，仍记录实际接入阶段；阶段记录中没有用户问题、助手正文或问题摘要。咨询、澄清、官网查询没有业务 run，不为了统计而生成一个。

阶段上报适用于网页收款、移动应用收款和按量付费（`webpay / apppay / aipay`）。产品和任务已经确定，且实际开始开发或办理时，执行 `telemetry start-run --session-id SESSION_ID --root-intent INTENT --product-type PRODUCT`。同一活动任务重试复用 RUN_ID。每次后续用户输入仅用不含原文的稳定消息 ID 计数一次：`telemetry count-user-input --session-id SESSION_ID --run-id RUN_ID --input-id MESSAGE_ID`。阶段失败、答案未知或仅加载文档时，不记成功。

收单 runner／Shell 已在确认的步骤记录 `integration.create_sandbox`、`integration.complete_coding` 及 `onboarding.confirm_onboarding_plan / login / confirm_signing / confirm_service / confirm_alipayapp`（confirm_service 仅按量付费）。不要在流程文档再记录一遍。

Token Pay 不上报业务阶段。周期订阅调用公共沙箱时按[沙箱入口](../integration/sandbox/sandbox-setup-guide.md#1-入口和环境)建立本地任务上下文。

入口确定任务时记录一次 `clarify_intent`；同一 run、同一阶段通过幂等去重。**业务收口**使用同一 stage 命令：只开发 `integration_summary`、只开通 `onboarding_summary`、两者都要 `all_summary`。全流程的开发小结 `integration_summary` 不终结 run。收到对应终态后即关闭本地业务 run，不依赖事件上传；当全局阶段采集关闭时也执行终态命令，关闭 run 不生成事件。

## 关联阶段与会话

`1005.c1` 保存业务任务的 `run_id`，`1009.c1` 保存会话的 `conversation_id`。首次会话采集通过 `telemetry start-conversation` 创建或复用当前宿主会话对应的采集会话。阶段事件生成时，运行时按同一个 `SESSION_ID` 读取已有的活动采集会话，授权有效时把其 `conversation_id` 写入 `1005.c4`。同一会话可以关联多个业务任务。分析时用 `1005.c4.conversation_id = 1009.c1` 关联，按 `1005.c1` 区分任务。

会话尚未建立或授权无效时，阶段事件仅使用 `run_id`。关联字段在事件生成时确定，随阶段事件一起入队，补传沿用入队时的值。

默认状态目录 `~/.alipay-aipay-new/telemetry-live/` 保持原路径，不随 Skill 名称统一搬迁；它与原本地评审目录 `~/.alipay-aipay-new/telemetry/` 隔离，不迁移旧队列或继承旧评审授权。隔离演练使用 `ALIPAY_AIPAY_TELEMETRY_DIR`，不要指向旧评审目录。设置 `ALIPAY_AIPAY_TELEMETRY=off` 关闭本地阶段与正文，只保留业务所需 run 状态；仅关正文使用 `ALIPAY_AIPAY_CONVERSATION_TELEMETRY=off`。上传默认开启，`ALIPAY_AIPAY_TELEMETRY_UPLOAD=0|false|off|no` 或 `ALIPAY_AIPAY_TELEMETRY_CAPTURE_ONLY=1` 只关闭上传，仍可本地采集；维护测试默认不上传，测试接收端由维护测试注入。阶段 code 为 `1005`，会话 code 为 `1009`、d1 为 OS、d2 为 Skill 版本，c1/c2 沿用现有格式。遥测失败不阻断交付；采集不是商机／公海投递，也不构成商家签约授权。

## 会话上报维度

会话和阶段上报共用 `~/.alipay-aipay/telemetry-profile.json` 中的 `user_id`。首次沿用现有机器标识与 SHA256 算法生成并保存，后续各 Agent、聊天及重试补传读取同一值，每个进程读取一次后在模块变量中缓存。采集选择更新时保留该值，配置迁移见[会话采集](conversation-telemetry.md)。

会话 syncLog（默认 code=1009）的维度映射如下；分析侧字段名对应原始上报的 d1～d3，不写入 c2 会话正文。

| 字段 | syncLog 位置 | 含义 |
| --- | --- | --- |
| `os` | `d1` | 操作系统：macOS / Linux / Windows / Other |
| `skill_ver` | `d2` | 消息记录时的 Skill 版本 |
| `harness` | `d3` | 消息记录时使用的 Agent 框架，如 codex / claudecode / cursor / openclaw |

`harness` 复用现有 Agent 宿主识别：优先采用 runtime 的 `--agent-platform`（规范化后写入 `ALIPAY_AIPAY_AGENT_PLATFORM`），其次使用宿主环境标识及已有平台兜底；无法识别为 `unknown`。值按现有规则规范化，例如 `Claude Code` → `claudecode`，不增加必填参数或固定框架枚举。队列已保存消息入队时的 `platform`，上传和重试从该快照取值；旧版队列缺少框架快照时，会话上报使用 `unknown`，避免误记为补传进程的框架。阶段上报仍沿用原有 d1～d5，框架保持在 d2。

## 正式身份兼容与故障隔离

阶段继续使用原 `alipay-aipay` 身份、`alipay-aipay-skill:sync-log`、code=1005、原 d1～d5 与 c4。`integration.complete_coding` 表示开发达到非阻断条件；最终未通过仅记录 integration_summary，不冒充完成。正文保留合并 Skill 的长期偏好、code=1009、维度及每轮采集范围。正文偏好不可读时不采正文，但不因此关闭阶段采集。

公开配置统一使用 `ALIPAY_AIPAY_*`，继续兼容对应的 `ALIPAY_AIPAY_NEW_*` 开关及原目录/outbox/status/run-state 覆盖。两组变量中任一明确关闭都优先；路径覆盖优先采用 `ALIPAY_AIPAY_*`，其次采用 `ALIPAY_AIPAY_NEW_*`。当前合并版本的私有目录保持，避免误继承旧评审正文；默认路径下旧正式版的有效 stage 队列可迁移补传，保留 event_id、时间、版本及计数，不迁入旧正文或把旧会话授权扩大为长期偏好。自定义目录按显式配置运行，不扫描其他目录。

遥测故障不阻断业务。主 run 存储不可写时，先有限重试，再恢复到当前用户私有临时目录的最小业务上下文；不记录该任务的输入计数或 stage，只保存 run/任务/产品/生命周期，以维持当前流程。会话正文采集独立处理，仍依据有效授权、采集开关和自身存储状态运行。恢复目录按原状态路径和会话隔离；可用后继续使用同一恢复位置，不因主目录恢复自动切换或重建历史事实。该目录不是跨会话业务进度恢复机制。业务必要上下文、工程检查或 handoff 证据仍无法可靠读写时，只暂停依赖它的步骤，说明实际缺口和恢复动作，不视为校验通过或重放支付写操作。
