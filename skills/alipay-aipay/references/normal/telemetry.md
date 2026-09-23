# Telemetry 运行契约

## Run 与计数窗口

- `root_intent + product_type` 唯一后执行 `telemetry start-run`。新 run 使用 runtime 生成的唯一 `run_id`，原子初始化 `counter_count=0` 并生成 `clarify_intent`；统计窗口从该 event 开始生成时开启，不等待 outbox 或网络成功。
- `start-run` 创建或复用成功后，从唯一 `ALIPAY_AIPAY_INTERNAL:RUN_ID=<run_id>` 取得 `RUN_ID`。组合不变且 run 为 `ACTIVE` 时复用；组合变化时，触发变化的消息保留在旧 run，旧 run 逻辑停止且不补 summary，不要求本地保留旧 run state，新 run 从 0 开始；已关闭 run 不复用。旧 event 若仍在 outbox，继续按既有上传和清理策略处理。
- 第三方项目 ID 不生成 `run_id`。run state 优先按显式 session override、与最终识别宿主匹配的会话/对话/线程 ID、通用 session ID 隔离；无论宿主来自本次 `--agent-platform` 还是自动识别，都忽略其他宿主残留的专属 session/thread ID。缺失时只回退与当前宿主匹配的第三方项目 ID，再缺失时使用受控默认 key。业务 `PLATFORM_ID` 继续优先第三方项目 ID，缺失时回退当前 `run_id`。
- 最终 summary 为：`integration_only -> integration_summary`、`onboarding_only -> onboarding_summary`、`full_process -> all_summary`。合法最终 summary 到达即关闭 run，不以 outbox 或上传成功为条件；`full_process` 的 `integration_summary` 不关闭 run。

## 用户输入计数

根入口先通过 `telemetry resolve-session` 取得当前对话的稳定 `SESSION_ID`，后续所有 runtime 动作显式携带 `--session-id "<SESSION_ID>"`。可靠来源沿用既有状态文件；无可靠来源时使用独立随机会话 ID。已绑定后，`--agent-platform` 仅改变平台归因，不切换 run 状态文件。未传新参数的旧脚本保留原兼容行为，但新的 Agent 执行不得依赖共享 default key。具体协议以 `runtime-entry.md` 为准。

当前 `ACTIVE` run 内，Agent 每收到一条聊天框用户消息，都必须在解释、分类、路由、回复或调用任何 runner/tool 前执行一次：

```text
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" telemetry count-user-input --run-id "$RUN_ID" --input-id "$USER_INPUT_ID" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

- 正常回答、主动追问、中断后输入、与 Skill 无关的消息、文字、图片、文件、空白、短确认和混合消息都按每条消息计 1；一条混合消息仍只计 1。
- 不计 Agent、system、tool call/result、runner stdout、中间结果、网页授权、扫码和自动轮询。
- 首次触发新 run 的整条消息不计入新 run。已有 active run 时先计数；若该消息随后改变组合，它只属于旧 run，不在新 run 重计。
- `USER_INPUT_ID` 优先使用宿主稳定且非内容型的消息 ID；否则由 Agent 为该消息分配当前会话内稳定的非内容型身份。同一消息重试必须复用同一值。不得包含或派生自用户原文、文件名、路径、OCR、截图、业务材料、stage 或工具序号。
- runtime 只保存 `run_id + USER_INPUT_ID` 的 hash 并幂等去重，不保存或上传原始身份。无 active run、缺少/不匹配的 `run_id` 或 run 已关闭时成功 no-op。
- `count-user-input` 是唯一计数入口。业务 runner、recovery、renderer、交互回复、tool result 和 stage 都不得隐式修改 counter。

## Stage 快照

每个 stage 生成前，Agent 回顾当前可见会话中从本 run `clarify_intent` 之后到快照前的用户角色消息，得到诊断值 `HISTORY_COUNT`；无法可靠回顾时使用字面值 `null`，不得以 0 表示未知。该值可以下降，只用于诊断，不修正 runtime counter。

直接上报入口为：

```text
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" telemetry stage <STAGE> --run-id "$RUN_ID" --history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

正常业务流程不另行手工调用该入口。能产生 stage 的登记 runner/script 是唯一责任方；调用这些动作时，把相同上下文追加到统一 gateway 命令：

```text
--telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT"
```

gateway 在分发前剥离这两个内部参数，不把它们交给业务 parser。首次在产品/MCC 确认命令内建立 run 时尚无可用 marker，由该进程使用刚创建的 active run，并固定本次 `history_count=0`；不增加额外命令或用户操作。

固定 stage 只有：`clarify_intent`、`integration.create_sandbox`、`integration.complete_coding`、`onboarding.confirm_onboarding_plan`、`onboarding.login`、`onboarding.confirm_signing`、`onboarding.confirm_service`（仅 AIPAY）、`onboarding.confirm_alipayapp`、`integration_summary`、`onboarding_summary`、`all_summary`。

事件外层的 `flow` 只是归类维度，用于区分 `integration`、`onboarding` 和公共事件 `common`，不表示流程状态、阶段开始/完成或转移。当前实现按 stage 前缀映射 Integration/Onboarding，`clarify_intent` 和三个 summary 映射为 `common`。

runtime 校验 active run、显式 `run_id`、clarify 已记录、stage 路线、summary 类型、首次生成唯一性、合法 history 和非负 counter。每个 `run_id + stage` 首次在 run state 内原子保存唯一 `event_id` 后即永久固定；重复调用成功 no-op。state 写入失败不生成 event；state 成功但 outbox 写入失败时该 event 允许丢失且不得重建或补写，业务均继续。

`c4/ext_info` 只允许 `user_input_after_clarify_intent`、`history_count`、`root_intent` 和 `progress_pct`。正式计数固定读取 event 生成锁内的 `counter_count`；不重复上传 `counter_count`。event 固定后，后续消息只影响后续 stage，不修改旧 event/c4。禁上传用户原文、input ID、文件名、路径、URL、密钥、账号、订单、截图、材料、授权信息、工具输出或堆栈原文。

Yuyan 外层字段中的 `d1/d2/d3` 分别表示操作系统、宿主平台和模型。`d2` 优先使用 Agent 根据当前宿主身份随本次 runtime 命令传入的 `--agent-platform`；该值为 `unknown` 或非法时才检查当前进程的宿主自动识别信号，继承的通用平台变量只作为末级兼容值。其他宿主残留的 session/thread 环境变量不得遮蔽本次明确参数。所有来源都跳过 `unknown`/非法值。该兜底不使用宿主名称枚举或映射表：ASCII 名称按既有规则归一，合法 Unicode 名称保留可读原文，最后才为 `unknown`。stage 进入 outbox 时固定当时的 `d2`，后续延迟上传或从其他宿主 flush 不得改变原事件归因；旧版 outbox 记录没有该快照时才按当前环境兼容生成。gateway 将该上下文传给 Node 和 Shell 子进程，业务 CLI 的工具检测器也按同一优先级消费，不写跨会话状态。模型只从显式模型上下文读取：优先 `ALIPAY_AIPAY_MODEL`，兼容 `AIPAY_MODEL`；runtime 将具体变体归一为 `gpt-5`、`gpt-4`、`claude`、`gemini`、`qwen`、`deepseek` 或 `llama` 等粗粒度家族。没有宿主模型字段或无法识别时使用 `unknown`，不得根据宿主平台名称臆测模型。Skill 脚本无法读取对话系统内部的模型上下文，宿主或 Agent 需要在调用 runtime 前提供该字段。

## 进度与上传

- `progress_pct=ceil(X/N*100)`。`N` 是当前路线的非 summary 业务 stage 数，`X` 是 run state 已首次生成的对应唯一 event 数；不按 stage 序号补齐缺失前序。
- `clarify_intent=0`。三个 summary 正常生成，但不进入分子或分母；部分结果 summary 可以小于 100。
- 每个 stage 固定顺序为：state 唯一性记录 -> 私有 outbox -> 前台同步上传，网络硬超时 3 秒 -> 2xx 删除当前记录；超时、连接失败、非 2xx 或未知结果保留原 event。
- 同步请求结束后如仍有积压，尝试启动 detached worker。worker 只上传固定 event，单次最多 50 条，首个失败停止；spawn 失败保留 outbox，不追加前台等待。前台 `flush-outbox` 最多 5 条并优先 summary；所有消费者使用 claim/lock，过期 claim 可恢复。
- outbox 机会式清理超过 7 天的记录，并在超过 1000 条时从最旧开始删除；Skill 不创建定时任务，也不承诺宿主不再运行、机器关机或网络长期不可用时最终送达。
- `ALIPAY_AIPAY_TELEMETRY=0|false|off|no` 时不计数、不生成 event/c4/进度、不读写 outbox/status、不上传、不启动 worker、不 flush；仅可保留供 `PLATFORM_ID <- run_id` 使用的最小 run context。遥测失败永不改变业务结果、消息、卡点或用户操作。
