# Integration Worker

本文件仅在 `full_process` 的 `integration.start.confirm` 可见送达后、Agent 加载 development 前的唯一 Worker 转移点读取。Integration Worker 是 Agent 创建的子 Agent，负责 Unix/macOS/Linux 下步骤 3 至步骤 8 的完整 Integration 上下文隔离执行，不是第二套业务流程或状态机；原 `integration/flow.md`、产品契约、脚本和 checklist 仍是唯一执行依据。`integration_only` 保持原 Agent 串行路径，不读本文件。

## 启用条件与唯一调用

只有同时满足以下条件时才启用 Worker：

1. 当前宿主支持创建子 Agent 并可靠等待其终态；
2. 当前系统为 Unix、macOS 或 Linux；
3. 本轮根意图为 `full_process`。

任一条件不满足时不得试探、模拟或后台放任 Worker，Agent 在方案送达后串行执行步骤 3 至步骤 8。

启用后只创建一个 Integration Worker。Agent 不得创建其他子 Agent，Integration Worker 也不得创建子 Agent。Agent 必须等待同一 Worker 到终态；等待期间不得读取项目、执行 Integration、进入 Onboarding 或结束当前任务。

## 固定请求与输入

Agent 发给 Integration Worker 的任务正文只允许由下列一句固定说明和一个输入 JSON 组成：

> 完整读取 `<skill_dir>/references/normal/integration-worker.md` 并严格执行；不创建其他子 Agent，最终只返回该文件定义的单个 JSON 对象。

输入 JSON 只包含下列已由启动方案前置准备和 runner 确定的字段：

```json
{
  "skill_dir": "<SKILL_DIR>",
  "product_type": "<aipay|webpay|apppay>",
  "project_path": "<规范化绝对路径>",
  "server_language": "<Java|Python|Node.js|C#|PHP>",
  "framework": "<已确定框架>",
  "sandbox_config_state": "<READY|CREATE_PENDING|VERIFY_PENDING>",
  "telemetry_run_id": "<RUN_ID marker 中的当前 run_id>",
  "telemetry_history_count": "<非负整数|null>"
}
```

Agent 不得复制、摘录或改写本文件的执行协议，不得在请求中手写任何 `runtime.mjs`、sandbox、verification、acceptance、audit 或 checklist 命令。禁止把完整对话、`integration.start.confirm` stdout、runner evidence、Agent 分析、源码或补丁、完整命令日志、沙箱文件内容、私钥、密码、临时 URL 或此前工具输出复制到 Worker 请求。`skill_dir` 必须是启动器确定的当前 Skill 规范化绝对路径；`sandbox_config_state` 必须是步骤 1 实际取得并在步骤 2 保持有效的终态枚举，不得包含配置内容。`telemetry_run_id` 只取主 Agent 已解析的当前 `RUN_ID` marker；`telemetry_history_count` 是 Worker 创建前主 Agent 对当前可见历史的诊断快照，无法可靠回顾时为 JSON `null`。两者只供原 flow 登记 stage 使用，不改变 Worker 的业务范围。

调用提交成功后，Integration 执行权立即且不可逆地转移给该 Worker。Agent 不得因等待、返回格式或 Worker 失败重新取回本轮 Integration 执行权。

## 执行边界

Integration Worker 使用输入事实执行下列原 flow 入口：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" flow integration development --product-type "$PRODUCT_TYPE" --telemetry-run-id "$TELEMETRY_RUN_ID" --telemetry-history-count "$TELEMETRY_HISTORY_COUNT"
```

随后严格按照该入口加载的原 `integration/flow.md`，从步骤 3 对步骤 1 的实际沙箱终态进行复核或保持待配置状态，再完整执行步骤 4 至步骤 8。阶段读取、命令、沙箱状态、代码实现、verification、acceptance、checklist 和失败转移都只以原 flow 为准；本文件不另行定义或覆盖业务流程。Worker 期间主 Agent 不处理新业务消息，因此各 stage 沿用该诊断 history 快照；正式 `user_input_after_clarify_intent` 仍由每个 event 生成时读取 runtime counter，不从 Worker 输入计算。原 flow 中能生成 stage 的 runtime 命令必须继续携带同一对 `--telemetry-run-id/--telemetry-history-count` 参数。

Integration Worker 不执行 Onboarding、self-update、`telemetry start-run`、产品/项目重新决策或原 flow 之外的沙箱调用和诊断。不得用 Worker 自报代替原 flow 要求的实际脚本终态和校验证据。

遇到阻塞时，先判断是否能在当前授权和工具范围内自行解决；能解决就继续处理并验证，不能解决才返回 STOP。不得将单次失败或尚未定位原因视为无法继续。恢复仍遵守原 flow 的权限、失败分支和重试边界；有新证据或可验证的修复方向时继续，无新进展时停止重复尝试并如实说明，不伪造通过。STOP 的 `remaining_actions` 须简短列明实际错误、已尝试的恢复及所需外部条件；尚未确认的原因明确标为未知，不返回源码、完整日志或敏感值。

原 flow 要求对客送达的登记 runner/script stdout 都要进入交接对象。`integration.start.confirm` 已由主 Agent 在 Worker 转移前按唯一 marker 独立交付；Worker 从步骤 3 开始，以 flow、消息目录和 runner 契约为准收集后续对客 stdout，其中 `sandbox.configuration.pending`、`sandbox.environment.summary`、`integration.safety.closeout` 和 `integration.checklist.result` 必须各自带唯一 `CUSTOMER_MESSAGE_DELIVERY_REQUIRED=<messageId>` marker，缺失、重复或对应正文为空时按交接失败处理；按发生顺序剔除 `ALIPAY_AIPAY_INTERNAL:` 行后保存到 `customer_messages`。过程 stdout、分析、命令和日志不得进入交接对象。登记正文不改写、不总结；空正文不加入。沙箱账号只允许存在于原始登记正文中，不得拆出、复述或进入其他字段。返回结果只依据最终 checklist 的实际证据；只有原 flow 允许衔接时 `next_phase=ONBOARDING`，其他情况为 `STOP`。

## 返回协议

最终回复仅包含一个 JSON 对象，不附加 Markdown 代码围栏、源码、补丁、日志或说明：

```json
{
  "protocol": "INTEGRATION_WORKER_V1",
  "integration_result": "已完成|部分完成，沙箱配置待完成|部分完成，人工待验证|未通过",
  "sandbox_config_state": "READY|CREATE_PENDING|VERIFY_PENDING",
  "manual_verification_items": ["不含敏感值的受控单行项"],
  "remaining_actions": ["不含敏感值的确定下一步"],
  "customer_messages": ["登记 runner/script 的完整原始正文"],
  "next_phase": "ONBOARDING|STOP"
}
```

对应关系固定：

- checklist 全部通过且沙箱 `READY`：`已完成`、`ONBOARDING`；
- 只有沙箱待配置且无其他阻断：`部分完成，沙箱配置待完成`、`ONBOARDING`；
- 沙箱 `READY` 且只剩原 flow 允许的非阻塞人工项：`部分完成，人工待验证`、`ONBOARDING`；
- 其他代码、安全、必要依据或协议缺口：`未通过`、`STOP`。

上述七个字段都由 Integration Worker 根据原 flow 的实际结果生成。`protocol` 必须精确为 `INTEGRATION_WORKER_V1`，返回对象只允许包含这七个字段；telemetry 输入不得回传。`sandbox_config_state` 必须复用输入后按步骤 3 实际复核得到的终态，不接受 `null` 或字符串 `"null"`。`manual_verification_items` 和 `remaining_actions` 只保留最终 checklist 已证实的短项；STOP 时 `remaining_actions` 另保留上文要求的脱敏阻塞事实，没有时传空数组。禁止返回项目路径、语言、框架、changed files、依赖列表、源码、收据、绝对路径、配置字段或 Worker 分析。Agent 对每次返回做结构校验，不自行解释、修复、补充或改写结果；仅允许下文规定的同 Worker 核实。结构合法的 STOP 若缺少阻塞依据，或仍存在授权范围内未尝试的恢复方向，在对客送达前最多要求同一 Worker 核实并继续一次；只指出返回中的证据缺口，不读取项目、不创建新 Worker、不接手 Integration。Worker 从当前实际状态继续，不重做已成功动作，仍按原 flow 修复、重检并返回同一七字段对象。宿主不支持继续同一 Worker，或再次返回 STOP 时，不循环追问，如实保留未解决项。最终结果校验通过后，按数组顺序把 `customer_messages` 每一项原文作为可见消息送达，不加旁白；然后丢弃该数组。`next_phase=ONBOARDING` 时只把产品、`integration_result`、`sandbox_config_state`、`manual_verification_items` 和 `remaining_actions` 带入独立 Onboarding；不读取项目、不复查 Worker、不重跑 Integration。`protocol`、`customer_messages` 和 `next_phase` 不带入 Onboarding。最终 `next_phase=STOP` 时在送达登记正文后停止，不进入 Onboarding。

`next_phase=ONBOARDING` 时，送达登记正文后立即执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" flow onboarding entry` 并继续流程，不得仅宣布下一步就结束当前轮。

Worker 明确失败、超时、返回非单一 JSON、字段非法或门禁矛盾时，本轮 Integration 立即停止。Agent 只报告“Integration Worker 交接失败，本轮已停止以避免重复执行”，不创建第二个 Agent，不追问 Worker，不读取项目，不执行任何 `flow integration`、`sandbox`、`a2m`、verification、acceptance、audit 或 checklist 命令，不进入 Onboarding。即使 Worker 文本中包含可猜测的沙箱状态，也不得由 Agent 补跑或重新展示 `integration.start.confirm`。
