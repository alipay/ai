# AI 按量付费 · 商家开通

按量付费开通需要本产品的授权和类目，不要求网页或 App 截图。授权后分别核对签约、应用及服务候选；只在需要时进行服务登记。具体动作和状态处理见 [服务市场](service-registration/guide.md)。

执行当前任务时将已确认的 `aipay` 传入[收单运行入口](../../runtime-entry.md)，沿用开通阶段及恢复协议。加载器在对应阶段使用以下片段；片段内的相对路径从 onboarding/ 起算。

<!-- ALIPAY_AIPAY_SECTION:MAPPING:START -->
| AI 按量付费 | aipay | AIPAY | I1080300001000160457 | app:all,machine_pay:write,agmnt:write | 无需截图 |
<!-- ALIPAY_AIPAY_SECTION:MAPPING:END -->

<!-- ALIPAY_AIPAY_SECTION:ONBOARDING_SIGNING:START -->
```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" sign --product aipay --sales-code "I1080300001000160457" --mcc-code "<mccCode>" --mcc-context-receipt "$MCC_CONTEXT_RECEIPT" [--special-qualification-group-index "$SPECIAL_QUALIFICATION_GROUP_INDEX" --special-license-json "$SPECIAL_LICENSE_JSON"] --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```
<!-- ALIPAY_AIPAY_SECTION:ONBOARDING_SIGNING:END -->

<!-- ALIPAY_AIPAY_SECTION:ONBOARDING_SERVICE:START -->
#### 5.2 服务市场注册（仅按量付费）

仅 Step 3.1 查询成功且候选数组为空时直接新建；失败、缺失或非法时阻断。非空只接受当前完整 `serviceId`、`新建`（可附五项资料）或 `修改:<当前serviceId>`；序号、候选外/历史 ID、非法 `修改:` 或其他输入走 `invalid` 恢复，禁止复用或写入。创建/修改五项资料须通过 `validate`；单价可输入纯数字或带 `元`/`元/次` 后缀（可空格），后续只用 `SERVICE_PRICING=<纯数字>`。复用不写。创建时 `save` 重查全量，当前服务数量小于固定上限 `10` 才保存；达到 `10` 个时禁止调用保存方法，调用为 0 并输出 `SERVICE_SAVE_RESULT=FAILED`。校验通过先输出非阻塞摘要后创建；修改还须取得绑定当前会话、主体、产品、目标和参数的 `SERVICE_UPDATE_ONLY` 确认，变化即失效。成功实际 `serviceId` 记为 `productionServiceId`；未返回状态只写“状态未取得”，不得推断或重复 `save`。

```bash
# 创建摘要后不等待回复
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message service-create-summary --service-name "$SERVICE_NAME" --service-description "$SERVICE_DESCRIPTION" --service-url "$SERVICE_URL" --service-pricing "$SERVICE_PRICING" --service-schema "$SERVICE_SCHEMA" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
# 仅修改：stdout 原文送达并等待当前摘要的肯定回复
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message service-update-confirm --session-summary "$SESSION_SUMMARY" --subject-summary "$SUBJECT_SUMMARY" --service-id "$SERVICE_ID" --service-name "$SERVICE_NAME" --service-description "$SERVICE_DESCRIPTION" --service-url "$SERVICE_URL" --service-pricing "$SERVICE_PRICING" --service-schema "$SERVICE_SCHEMA" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

进入本 flow 的 `service` 阶段时，不记录开始态 stage；创建/修改在 `service save` 成功后记录 `onboarding.confirm_service`，复用已有服务不执行写入并由最终 closeout 根据受控“已复用”结果补记同一唯一 stage。重复责任方由 runtime 的 `run_id + stage` 唯一性 no-op，不得由 Agent 另行执行 telemetry 命令。

**固定命令契约**：复用已有服务不调用 `save`；创建不传 `--service-id`，修改必须传入用户从 Step 3.1 候选中选定的实际 `serviceId` 和全部字段：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" service validate --name "<name>" --desc "<desc>" --url "<url>" --pricing "<pricing>" --schema "<json>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
# 创建：先成功渲染 service.create.summary/DEFAULT，再直接执行
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" service save --name "<name>" --desc "<desc>" --url "<url>" --pricing "<pricing>" --schema "<json>" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
# 修改：先取得 onboarding.write.confirm/SERVICE_UPDATE_ONLY 的有效确认，再执行
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" service save --service-id "<serviceId>" --name "<name>" --desc "<desc>" --url "<url>" --pricing "<pricing>" --schema "<json>" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

`service save` 成功必须产生 `SERVICE_SAVE_RESULT=SUCCESS` 和实际 `SERVICE_ID`；创建/修改响应不明且只读查询无法唯一核验时产生 `SERVICE_SAVE_RESULT=UNKNOWN`，服务分支进入“结果未知/禁止重复保存”待办；明确未发送重试耗尽、业务失败或结构明确失败产生 `SERVICE_SAVE_RESULT=FAILED`，只终止服务分支，不清除签约或应用分支已取得事实。
<!-- ALIPAY_AIPAY_SECTION:ONBOARDING_SERVICE:END -->
