# AI 移动应用收款 · 商家开通

先查询签约状态及应用候选。未签约时收 APP 名称和三张 App 界面截图；需要新建应用时按移动平台收集对应信息。签约与应用提审分别核验。

执行当前任务时将已确认的 `apppay` 传入[收单运行入口](../../runtime-entry.md)，沿用开通阶段及恢复协议。加载器在对应阶段使用以下片段；片段内的相对路径从 onboarding/ 起算。

<!-- ALIPAY_AIPAY_SECTION:MAPPING:START -->
| AI 移动应用收款 | apppay | APPPAY | I1080300001000041313 | app:all,auth_alipay_apppay:write | 未签约时需要 APP 名称和 3 张 APP 界面截图，签约状态固定按 `OFFLINE` 提交；选择新建应用时在 Step 4 前置采集移动平台信息，Step 5.3 才用于创建 |
<!-- ALIPAY_AIPAY_SECTION:MAPPING:END -->

<!-- ALIPAY_AIPAY_SECTION:ONBOARDING_SIGNING:START -->
```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" sign --product apppay --sales-code "I1080300001000041313" --mcc-code "<mccCode>" --mcc-context-receipt "$MCC_CONTEXT_RECEIPT" --app-name "<APP名称>" --picurl1 "<imageRef1>" --picurl2 "<imageRef2>" --picurl3 "<imageRef3>" [--special-qualification-group-index "$SPECIAL_QUALIFICATION_GROUP_INDEX" --special-license-json "$SPECIAL_LICENSE_JSON"] --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```
<!-- ALIPAY_AIPAY_SECTION:ONBOARDING_SIGNING:END -->

<!-- ALIPAY_AIPAY_SECTION:ONBOARDING_APPLICATION:START -->
APP 支付通过 Skill 创建只支持 `IOS`、`ANDROID` 和 `ALL`，其中 `ALL` 只表示 iOS + Android。HarmonyOS 移动应用不得调用 `app.sh create|create-from-snapshot`；执行固定 runner 命令输出 `application.harmony.manual_create`，用户在开放平台完成创建及平台要求的后续配置后明确表示操作完成，只执行本节登记的轻量 `app list`，不得重跑 Step 3.1。只有实际查询到 `ON_LINE` 候选后才能复用，否则保持人工待办。
<!-- ALIPAY_AIPAY_SECTION:ONBOARDING_APPLICATION:END -->

<!-- ALIPAY_AIPAY_SECTION:ONBOARDING_APPLICATION_2:START -->
```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app create-from-snapshot --product-type apppay --sales-code "I1080300001000041313" --previous-candidates-json "$APP_CANDIDATES_JSON" --mobile-platform IOS --bundle-id "<bundleId>" --defer-open "<用户明确提供的完整publicKey>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app create-from-snapshot --product-type apppay --sales-code "I1080300001000041313" --previous-candidates-json "$APP_CANDIDATES_JSON" --mobile-platform ANDROID --app-package "<appPackage>" --app-sign "<appSign>" --defer-open "<用户明确提供的完整publicKey>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app create-from-snapshot --product-type apppay --sales-code "I1080300001000041313" --previous-candidates-json "$APP_CANDIDATES_JSON" --mobile-platform ALL --bundle-id "<bundleId>" --app-package "<appPackage>" --app-sign "<appSign>" --defer-open "<用户明确提供的完整publicKey>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-harmony-manual-create --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
# 仅 HarmonyOS 用户明确完成开放平台操作后轻量重查
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app list --product-type apppay --sales-code "I1080300001000041313" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```
<!-- ALIPAY_AIPAY_SECTION:ONBOARDING_APPLICATION_2:END -->
