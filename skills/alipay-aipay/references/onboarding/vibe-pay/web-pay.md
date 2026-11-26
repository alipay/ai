# AI 网页应用收款 · 商家开通

先核对商家登录、当前产品权限与经营类目，再查已有签约和应用。已签约沿用结果；未签约且缺页面材料时，只暂停该分支。网站资料为首页、商品页和展示支付宝付款方式的支付页。应用按自身查询结果继续。

执行当前任务时将已确认的 `webpay` 传入[收单运行入口](../../runtime-entry.md)，沿用开通阶段及恢复协议。加载器在对应阶段使用以下片段；片段内的相对路径从 onboarding/ 起算。

<!-- ALIPAY_AIPAY_SECTION:MAPPING:START -->
| AI 网页应用收款 | webpay | WEBPAY | I1080300001000041203 | app:all,fast_instant_trade_pay:write | 需要3张网站截图 |
<!-- ALIPAY_AIPAY_SECTION:MAPPING:END -->

<!-- ALIPAY_AIPAY_SECTION:ONBOARDING_SIGNING:START -->
```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" sign --product webpay --sales-code "I1080300001000041203" --mcc-code "<mccCode>" --mcc-context-receipt "$MCC_CONTEXT_RECEIPT" --picurl1 "<imageRef1>" --picurl2 "<imageRef2>" --picurl3 "<imageRef3>" [--special-qualification-group-index "$SPECIAL_QUALIFICATION_GROUP_INDEX" --special-license-json "$SPECIAL_LICENSE_JSON"] --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```
<!-- ALIPAY_AIPAY_SECTION:ONBOARDING_SIGNING:END -->
