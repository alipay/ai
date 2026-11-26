# AI 按量付费 · 工程接入

面向提供收费资源的服务端。先按 [接口契约](contract.md) 返回 402，验证支付证明再履约，结果持久化并防止重复交付。仅在适用沙箱环境进入 [402 验证](sandbox/a2m-sandbox-test.md)。

执行当前任务时将已确认的 `aipay` 传入[收单运行入口](../../runtime-entry.md)，沿用开发阶段及恢复协议。加载器在对应阶段使用以下片段；片段内的相对路径从 integration/ 起算。

<!-- ALIPAY_AIPAY_SECTION:INTEGRATION_VERIFICATION:START -->
**按量付费沙箱 serviceId**：生成或写入按量付费沙箱运行配置时，`serviceId` 固定使用 `api_mock_service_id`，禁止向用户索要正式 `serviceId` 才继续沙箱联调。该值必须与正式环境配置隔离；正式上线前替换为服务市场注册或复用结果中的真实 `serviceId`。

**按量付费生产边界**：五语言 A2M 文件只是核心协议与 SDK 调用示例。生产实现必须通过步骤 8 bundle 附带的全部按量付费专项校验；任一关键控制仍为 TODO、注释、内存演示或伪代码时，不得满足 `INT.CODE.*` / `INT.A2M.PRODUCTION_CONTROLS` 或标记生产就绪。

> ⚠️ **按量付费**：代码生成后启动本地服务，后续步骤 6 将默认进行端到端沙箱服务端联调。服务需实现 402 协议（无 `Payment-Proof` 时返回 HTTP 402 + `Payment-Needed` 头）。
<!-- ALIPAY_AIPAY_SECTION:INTEGRATION_VERIFICATION:END -->

<!-- ALIPAY_AIPAY_SECTION:INTEGRATION_ACCEPTANCE:START -->
#### AI 按量付费：自动沙箱联调

**任务**：验证按量付费 402 协议端到端服务端联调流程

> ⚠️ **必须完整阅读** `machine-pay/sandbox/a2m-sandbox-test.md` 后方可执行本步骤
>
> 沙箱联调经验集中维护在 `machine-pay/sandbox/a2m-sandbox-test.md`。遇到收银接口临时失败、`ORDER_NOT_FOUND`、资源防串失败或履约确认失败时，先按该文档排查，不要反复请求用户服务生成新订单。

**完成条件**：
- [INT.A2M.SERVICE_READY] 已确认用户本地按量付费服务已启动可访问
- [INT.A2M.PRECHECK_PASSED] 已执行 Payment-Needed 预检，确认 HTTP 402 和关键字段存在
- [INT.A2M.AUTO_COMPLETE_RUN] 已执行沙箱支付测试脚本 `run --auto-complete --require-payment-validation`，成功获取 Payment-Needed、生成付款链接并连续执行服务端联调
- [INT.A2M.DELIVERY_EVIDENCE] 已携带 `Payment-Proof` 重试原服务，并取得 HTTP 200、非空可归属资源、无明确业务失败和有效 `Payment-Validation` 的组合成功证据
- [INT.A2M.TEST_PASSED] 已确认 402 沙箱服务端联调流程通过

**测试前预检**：执行沙箱测试脚本前，只使用 `machine-pay/sandbox/a2m-sandbox-test.md` 登记的固定 `runtime.mjs a2m precheck`，确认服务返回 HTTP 402，`Payment-Needed` 包含 `seller_signature` 等关键字段，且 `method.service_id` 等于 `api_mock_service_id`；禁止临时编写 Python、curl 管道或近似解析器。

**按量付费联调失败分类**：自动联调仍默认执行，只有完整端到端成功证据才能记为测试通过。先复用本轮代码审查、配置后置校验和 Payment-Needed 预检结果，再区分失败来源：已确认商家请求结构、必填字段、沙箱 serviceId、密钥及签名生成、验付与履约控制均无实际缺陷，且有登记脚本实际输出及已核对的调用链证据证明异常来自固定沙箱收银端或 SDK 沙箱网关（例如远端 HTTP 5xx、已识别的系统繁忙，或远端返回非 JSON／缺少返回字段）时，记为非阻塞的联调待验证。仅超时、异常文本或“系统繁忙”字样不足以排除代码问题；参数／签名错误、商家服务自身实现错误、验付／履约／金额／归属／幂等缺陷，以及无法排除的代码或安全疑点，仍按阻断缺口处理，不得归因沙箱绕过。

已确认仅沙箱远端异常且其余适用代码与安全检查通过时，保留 `sandboxResult=AI 按量付费沙箱服务端联调未通过`，将实际脱敏远端异常证据及确定下一步放入 `manualItems`，`failedItems=无`、`blockingDefectState=NONE`、`overallResult=部分通过`，沙箱仍保持实际 `READY`。仅代码开发按部分通过收口；完整接入使用已有“READY 且仅剩非阻塞人工待验证项”分支继续 Onboarding，并将实际待验证项传入最终总收口。不得标记联调通过、代码开发全部通过或生产就绪，也不得为了取得成功结论重跑联调、改变输入、重置 receipt 或扩大原重试预算。

**沙箱支付宝体验提醒**：服务端联调结论输出后，按 `machine-pay/sandbox/a2m-sandbox-test.md` 在已取得本轮真实付款链接且沙箱买家资料已校验时，向用户提供付款链接、沙箱买家账号和安卓客户端下载说明作为可选付款体验；远端异常导致没有付款链接时跳过该体验，不新增阻塞确认点。

**默认执行规则**：
1. 从已确认的目标项目和步骤 3 已校验的沙箱配置中确定服务请求地址、HTTP 方法和沙箱买家 `userId`；仅缺少无法从当前上下文取得的真实参数时才询问对应信息，禁止编造或猜测。
2. 确认本地服务可访问；项目已有明确启动方式且当前环境可执行时直接启动，否则只要求用户完成必要的服务启动。服务恢复可访问后自动继续，不询问是否执行沙箱测试。
3. 预检通过后先从本 flow 所在目录执行当前会话联调 guard。GET 禁止传 body；POST 只传项目实际 body 文件的绝对路径，由 runner 内部计算摘要，不打印内容。首次执行不传 `--prior-receipt`；本轮已有 `A2M_EXECUTION_RECEIPT` 时必须原样传入：

```bash
# GET
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message a2m-execution-guard --project-path "$PROJECT_PATH" --service-url "$SERVICE_URL" --http-method GET [--prior-receipt "$A2M_EXECUTION_RECEIPT"] --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
# POST
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message a2m-execution-guard --project-path "$PROJECT_PATH" --service-url "$SERVICE_URL" --http-method POST --request-body-file "$POST_BODY_FILE" [--prior-receipt "$A2M_EXECUTION_RECEIPT"] --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

只接受唯一 `ALIPAY_AIPAY_INTERNAL:A2M_EXECUTION=<json>`。`decision=RUN` 时保存新 receipt 并继续；`REUSE_PASSED` 复用同一项目和输入的本轮通过证据，不重复联调；`BLOCK_UNCHANGED` 表示失败后代码、配置和输入均未变化，禁止重跑，将本轮 A2M 联调记录为失败并继续步骤 7/8；`UNKNOWN_PREVIOUS_EXECUTION` 表示上次命令可能已发出但未登记终态，当前没有登记的结果查询入口，禁止自动重跑或临时探测，固定记录联调结果未知并继续步骤 7/8。项目代码或配置的实际内容、服务 URL、方法或 POST body 变化时 runner 才会产生新的 `RUN` receipt；仅文件时间戳变化或同内容重写不属于输入变化。receipt 只保留在当前会话，不写跨会话业务进度。

4. 仅 `decision=RUN` 时执行下列固定 runner 命令，输出固定联调说明后立即继续，不等待用户确认；禁止另写开始话术。服务地址和 HTTP 方法只用于后续实际命令，不在本消息中展示：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message a2m-test-start --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

5. Unix/macOS/Linux 按实际 HTTP 方法从本 flow 所在目录继续执行且只执行以下既有命令。POST body 必须来自已确认目标项目中的实际文件，不把动态 JSON 拼进命令文本：

```bash
# GET
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m run --url "$SERVICE_URL" --method GET --buyer-id "$BUYER_2088" --auto-complete --require-payment-validation --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"

# POST
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m run --url "$SERVICE_URL" --method POST --body "@$POST_BODY_FILE" --buyer-id "$BUYER_2088" --auto-complete --require-payment-validation --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

Windows 在本步骤第一次 `a2m precheck` 前先通过统一 runtime 检查本机 Python，其他产品不执行：

```text
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" env check-python --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

只有退出 0 且唯一 `ALIPAY_AIPAY_INTERNAL:PYTHON_ENV=READY` 才继续。检查会实际加载当前联调脚本而不执行 main，不以 `--version` 成功代替 Python 3 能力证据。仅 `WINDOWS_ENV_RESULT` 为 `reason=DEPENDENCY_MISSING,dependency=Python 3` 且当前已有依赖准备授权时执行：

```text
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" env prepare-python --authorized true --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

用户明确修复并要求重试后，最多追加一次 `--repair-confirmed true`。仍要求唯一 READY 和退出 0；否则不发起联调，保留 Python 环境缺口并按本步骤失败路径进入步骤 7/8，不记联调通过。Python 准备只补依赖，不重放任何已经发出的支付请求，不重置 A2M receipt。winget 不可用或安装失败时提供 [Python 官方 Windows 下载页](https://www.python.org/downloads/windows/)的手动准备指引，不自动提权或改用其他包管理器。

Windows 使用 Node 启动器选择 `py -3|python|python3`，不依赖 Bash 命令解析。先按实际 HTTP 方法执行只读预检的对应单行命令：

```powershell
# GET
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m precheck --url "$SERVICE_URL" --method GET --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"

# POST
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m precheck --url "$SERVICE_URL" --method POST --body "@$POST_BODY_FILE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

预检通过后再执行对应联调单行命令：

```powershell
# GET
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m run --url "$SERVICE_URL" --method GET --buyer-id "$BUYER_2088" --auto-complete --require-payment-validation --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"

# POST
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" a2m run --url "$SERVICE_URL" --method POST --body "@$POST_BODY_FILE" --buyer-id "$BUYER_2088" --auto-complete --require-payment-validation --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

只传已确认的本机服务 URL、GET/POST、实际沙箱买家 userId 和项目内 POST body 文件；禁止传入自定义收银端点、`Payment-Proof` 或 attestation。只有同一次命令退出码为 0，且输出包含实际资源交付校验通过和敏感产物已清理，才能记录联调通过；204、空响应、空资源、明确验付/履约失败或异常 `Payment-Validation` 均不得通过。命令结束后立即执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message a2m-execution-result --receipt "$A2M_EXECUTION_RECEIPT" --outcome <PASSED|FAILED> --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"` 并保存返回的新 receipt；进程被中断且无法登记时保留原 receipt，由下次 guard 返回 `UNKNOWN_PREVIOUS_EXECUTION`。失败、阻断重复或结果未知都必须进入步骤 7 和最终 checklist，并按上面的失败分类记录：已确认仅沙箱远端异常保留为非阻塞人工待验证；代码、安全或原因无法排除的缺口仍阻断。复用 receipt 保留失败来源证据，进程中断的未知结果不得自动归为远端异常；只有项目代码、配置或执行输入实际变化并取得新 `RUN` receipt 才能重新联调。

服务未就绪时固定使用 `integration.service.not_ready` 输出实际缺口和恢复动作；必须执行下列命令。不得运行测试、登记 `INT.A2M.SERVICE_READY=PASS` 或临场改写近似话术。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message service-not-ready --recovery-action "$RECOVERY_ACTION" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

> 详细测试流程见 `machine-pay/sandbox/a2m-sandbox-test.md`
<!-- ALIPAY_AIPAY_SECTION:INTEGRATION_ACCEPTANCE:END -->

<!-- ALIPAY_AIPAY_SECTION:INTEGRATION_CHECKLIST:START -->
```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message checklist-result --variant AIPAY --project-path "$PROJECT_PATH" --scope-receipt "$CHECKLIST_SCOPE_RECEIPT" --overall-result "$OVERALL_RESULT" --failed-items "$FAILED_ITEMS" --manual-items "$MANUAL_ITEMS" --sandbox-result "$SANDBOX_RESULT" --sandbox-config-state "$SANDBOX_CONFIG_STATE" --blocking-defect-state "$BLOCKING_DEFECT_STATE" --execution-mode "$EXECUTION_MODE" --next-flow-reminder "$NEXT_FLOW_REMINDER" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```
<!-- ALIPAY_AIPAY_SECTION:INTEGRATION_CHECKLIST:END -->
