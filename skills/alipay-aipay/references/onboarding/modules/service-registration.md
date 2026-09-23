# 服务市场业务语义

服务市场仅适用于 AI 按量付费；命令见 `../flow.md`，实现见 `scripts/service.sh`。

`service.sh` 固定 `PRODUCT=AIPAY`，不加入服务 MCP 请求。

## 查询与候选

`a2a-pay-service.discoverBazaarServicesForMcp` 必须按 `offset/total` 完整分页。当前成功协议为 `code="10000"`、`data.items`、`data.pagination`，兼容旧 `success=true/resultObj.serviceList`；失败、异常或分页不完整不得作为空列表。

`SERVICE_CANDIDATES_JSON` 是唯一候选源。轮到服务类别时，`onboarding-message service-candidates` 输出事实表和提示；禁止提前展示、手工拼表或仅输出 ID。空列表收集资料；非空只接受复用、新建或 `修改:<serviceId>`。`新建` 可附五项资料，完整则创建，否则沿用意图补缺。无效选择以同一命令加 `--selection-state invalid` 重显候选和受控提示，等待重选且禁止写入。禁用默认或猜值。

## 五项资料

创建和修改都需要：服务名称、服务描述、服务地址、服务单价、请求示例 JSON。`schemaUrl` 当前承载 JSON 示例，不是网页 URL。材料 runner 仅为兼容既有口径把“资源 URL、单次价格、序列化 JSON 请求示例”归一化到对应规范字段；后续统一使用上述五项名称。

资料由下列入口校验；缺失由材料 runner 收集，`INITIAL` 展示五项示例且不要求重发 `新建`：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message material-collect --category service --state "$MATERIALS_STATE" --product-type "$PRODUCT_TYPE" --missing-fields "$MISSING_FIELDS" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" service validate --name "<name>" --desc "<desc>" --url "<url>" --pricing "<pricing>" --schema "<json>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

用户可输入纯数字、`0.08元`、`0.08 元`、`0.08元/次` 或 `0.08 元/次`。后续 renderer 和 save 只复用脚本内部事实 `SERVICE_PRICING=0.08` 的纯数字值，模板负责展示单位；不得再次追加“元/次”。

## 保存边界

- 创建：数量上限检查通过且五项资料有效后，展示非阻塞 `service.create.summary` 并直接保存；不传 `serviceId`，不再等待确认。
- 修改：必须传当前候选完整 `serviceId` 和全部五项资料；保存前使用 `onboarding.write.confirm/SERVICE_UPDATE_ONLY` 绑定当前登录会话、脱敏主体、产品、动作、目标与参数，并等待当前摘要后的明确肯定回复；`1` 只是兼容快捷输入。
- 任何目标、参数、主体或会话变化都使旧修改确认失效。创建不得进入修改确认。

保存调用 `a2a-pay-service.saveBazaarServiceForMcp`。明确 `NOT_SENT` 才自动重试；`MAYBE_SENT` 用列表按 `serviceId` 和五项资料核验，不靠同名猜测。未解析到实际 `serviceId` 时禁止宣称完成。脚本必须输出 `SERVICE_SAVE_RESULT=SUCCESS|FAILED|UNKNOWN`，10 个服务上限也输出 `FAILED`；`UNKNOWN` 禁止自动重复保存并进入服务分支待办，不清除其他分支事实。

成功结果只用登记 renderer：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message service-result --service-id "$SERVICE_ID" --actual-result "$ACTUAL_RESULT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

脚本成功返回的服务状态如果未取得，只能写“状态未取得”；不得推定审核通过、可用或生产就绪。真实生产 `serviceId` 只能来自实际创建或复用结果，AI 按量付费沙箱固定 `api_mock_service_id` 不得用于生产。
