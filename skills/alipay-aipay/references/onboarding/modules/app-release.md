# 应用发布业务语义

本模块解释应用类型、候选复用、创建、公钥与提审边界。运行时命令以 `../flow.md` 为准；参数、MCP payload、轮询、解析和终态由 `scripts/app.sh` 实现。正常路径不从本模块复制命令或构造 MCP。

## 当前主流程 MCP 调用

| MCP 方法 | 用途 |
| --- | --- |
| `apprelease.queryApplicationList` | 查询应用列表 |
| `apprelease.createApplication` | 创建应用 |
| `apprelease.queryApplicationInfo` | 查询应用详情 |
| `apprelease.createKeyConfirmPage` | 创建应用公钥确认页 |
| `apprelease.queryApplicationSecurityKey` | 查询 RSA2 应用公钥和支付宝公钥 |
| `apprelease.submitApplicationAudit` | 提交应用审核 |

应用与服务方法统一使用 `{"request":{...}}`，不得混入签约的 `ctx`。完整请求只在脚本维护。

### 参数结构对照表

| MCP 方法 | 脚本约束 |
| --- | --- |
| `apprelease.queryApplicationList` | 只传 `request.appTypes` |
| `apprelease.createApplication` | 由产品上下文绑定应用类型和移动平台字段 |
| `apprelease.queryApplicationInfo` | 传当前完整 `appId` |
| `apprelease.createKeyConfirmPage` | 传当前 `appId`、`RSA2` 和用户公钥 |
| `apprelease.queryApplicationSecurityKey` | 传当前 `appId`，可带同一用户公钥 |
| `apprelease.submitApplicationAudit` | 传当前完整 `appId` |

## 类型与候选

- AI 按量付费、AI 网页应用收款：`WEBAPP`。
- AI 移动应用收款：`MOBILEAPP`；通过 Skill 创建只支持 `IOS|ANDROID|ALL`，`ALL` 仅表示 iOS + Android。
- 应用列表请求只按 `appTypes` 查询；返回项只能称为同类型候选，不得声称已绑定当前支付产品。
- `bundle_id` 映射为脚本 `--bundle-id` 和 MCP `bundleId`。`appSign` 只表示用户已有的 Android 应用签名摘要，不是应用公钥、私钥或支付签名串；不得用应用公钥密钥工具获取，也不得用包名、Bundle ID 或占位值推断。
- HarmonyOS 代码开发受支持，但 HarmonyOS 移动应用不通过 Skill 创建，也不得向脚本或 MCP 传 `HARMONY`。固定输出：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-harmony-manual-create --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

HarmonyOS 用户完成平台操作后只重查下方列表，不跑全量 discovery；仅实际 `ON_LINE` 可复用，用户表达不证明创建、配置或上线。

`ON_LINE` 才可复用。空候选收材料；非空接受当前 appId 或 `新建+材料`；仅未上线时可 `暂不新建`；无效选择不写。材料齐后由固定组合入口轻量查询并比较快照：`UNCHANGED` 创建并生成公钥页；`CHANGED_EMPTY` 零写入送达空事实后，以新快照和原材料同回合重跑，不等待回复；`CHANGED_NONEMPTY` 零写入送达新候选后重选：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app create-from-snapshot --product-type "$PRODUCT_TYPE" --sales-code "$SALES_CODE" --previous-candidates-json "$APP_CANDIDATES_JSON" [移动平台参数] --defer-open "<用户明确提供的完整publicKey>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

组合入口只编排既有 `list -> comparator -> create -> key`。写入前 `CONTRACT_ERROR|PREWRITE_FAILED` 自动恢复一次，`SNAPSHOT_REFRESH_REQUIRED` 刷新候选；耗尽按 flow 收口并继续其他分支。子步骤只转发登记终态，技术正文和 marker 禁止对客。权限/授权按 flow 恢复；写入前恢复后可继续，写入后禁止重放。创建 `UNKNOWN` 只重查列表，公钥页 `FAILED|UNKNOWN` 只查公钥状态；核验后仍不明则输出业务待办并收口，禁止重建应用/页面。独立 `app key` 只用于复用缺钥应用，或新建成功后公钥页调用前权限阻断；`app create` 仅由组合入口调用。HarmonyOS 仍独立 `app list`。

材料齐或非空明确新建即确认创建；`新建/我要新建` 只是示例，不要求逐字回复，等价明确意图均接受；之后只补缺项。`WEBAPP` 需公钥；`MOBILEAPP` 需平台资料和公钥。Agent 按明确语义归一化：仅 iOS→`IOS`，仅 Android→`ANDROID`，两类→`ALL`；原枚举兼容，含糊/矛盾时不猜。脚本只传这三个枚举。`APP_WEB_INITIAL` 仅限 `aipay|webpay`，`APP_MOBILE_INITIAL` 仅限 `apppay`：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message material-collect --category application --state APP_WEB_INITIAL --product-type "$PRODUCT_TYPE" --input-id "$USER_INPUT_ID" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message material-collect --category application --state APP_MOBILE_INITIAL --product-type "$PRODUCT_TYPE" --input-id "$USER_INPUT_ID" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

Skill 新建 `WEBAPP` 或 `MOBILEAPP IOS|ANDROID|ALL` 时，首次等待或创建写操作前必须展示 `https://opendocs.alipay.com/isv/02kipk`。空候选由事实消息展示，缺公钥再执行 `runtime.mjs key-tool`；应用资料首次收集消息也保留同一入口以覆盖恢复场景。非空由选择消息展示，用户要求才下载。只下载，不安装/启动/生成密钥。材料齐且重查允许才创建、设钥和提审。HarmonyOS 保持人工引导，不适用本门禁。

所有展示密钥工具地址、下载结果或下载失败兜底的标准消息必须同时说明：工具“生成密钥”默认生成适用于 Java 的 PKCS#8 格式应用私钥；非 Java 语言需使用“密钥工具-格式转换”转换为 PKCS#1 格式。该说明只解释用户在本机使用工具时的私钥格式，不放宽下方公钥边界；应用私钥仍只保存在用户本机，不得提供给 Agent。

## 公钥边界

应用公钥必须由用户自行生成并明确提供。Agent 禁止生成密钥对、请求或处理私钥、补全/改写公钥、添加 PEM 头尾，或在缺少公钥时调用 `createKeyConfirmPage`。公钥输入只用于当前 `app.sh key|verify-key|verify-key-and-audit`，不得在回复、摘要、普通日志、跨会话状态或宽权限临时文件中复述或保存。

CLI 子命令均传 `--product-type` 并由脚本上报 `PRODUCT`；`appId/publicKey` 保持位置参数。正常新建由 `create-from-snapshot` 输出公钥页；仅上述独立设钥场景执行 `runtime.mjs app key --product-type "$PRODUCT_TYPE" --defer-open`。两者都先独立送达 stdout，再执行 `app open-key-page`；不得手写消息。opener 失败时可用宿主浏览器打开已交付 URL 一次，仍失败保留复制兜底再查询；禁止搜索、改写、填写或代扫码。自动打开/轮询不能替代 URL 交付，pending 不得与 `application.key.page` 合并。

只展示校验后的实际 `confirmPageUrl` 裸 URL，禁二维码链接和 `alipays://`。不推定有效期；仅用户反馈页面/扫码问题时重建。

`app.sh key` 成功须输出 `KEY_PAGE_RESULT=READY_TO_OPEN` 和 `KEY_PAGE:READY_TO_OPEN`；响应不明、URL 非法或消息失败为 `UNKNOWN`，禁生成第二页。页面已交付但状态保存失败输出 `KEY_PAGE_STATE:SAVE_FAILED`，`open-key-page` 降级 `KEY_OPEN:LINK_ONLY`，显式参数仍可查询。

RSA2 状态只看应用公钥字段，支付宝公钥不能反证。`verify-key|verify-key-and-audit` 最多 20 次、间隔 2 秒；耗尽后明确完成表达交给 `onboarding_recovery_runner.mjs application-key`，每次只查一次。

## 提审与结果

新建确认后用 `verify-key-and-audit` 复用最终密钥响应完成双公钥 guard 并提审；复用缺钥时 `verify-key` 后再 `reuse`。公钥未确认或 guard 失败禁提审。

`APPLICATION_CREATE_RESULT=SUCCESS|FAILED|UNKNOWN` 区分创建；未知只刷新列表事实，不归因候选差异。`KEY_PAGE_RESULT=FAILED|UNKNOWN` 在调用后都只用同一公钥执行一次 `reconcile-key`，不生成第二页；`CONFIRMED` 才提审。权限/授权恢复后只做阶段允许的最新只读动作。`APPLICATION_AUDIT_RESULT=SUBMITTED|FAILED|UNKNOWN` 区分提审，未知不重提；`FLOW:AUDIT_SUBMITTED` 仅来自成功或只读核验。config 探针失败输出 `APP_FLOW:RETRY_WITH_LOCAL_CONFIG_PERMISSION` 和 `ALIPAY_PUBLIC_KEY_EXPORT_STATUS=RETRY_WITH_LOCAL_CONFIG_PERMISSION`，取权重试一次且不重开页面；仍失败输出 `ALIPAY_PUBLIC_KEY_EXPORT_STATUS=MANUAL_CONFIGURATION_REQUIRED`，由 `customer-messages.json` 的应用人工配置目录文案引导。

三个产品在 `onboarding_only` 和 `full_process` 中，应用分支取得本轮可收口结果后均先独立交付应用结果，再进入总收口；紧邻总收口也不合并，同一结果已交付则不重复。总收口仅保留应用发布状态和待办，不重复应用详情。仍在等待材料、公钥或恢复时沿用原分支；未取得实际 appId 的失败/未知不得编造 appId，保留错误和待办收口。应用分支对客结果只使用：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-result --app-id "$APP_ID" --actual-status "$ACTUAL_STATUS" [--next-action "$NEXT_ACTION"] [--app-key-save-path "$APP_KEY_SAVE_PATH"] --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

执行该命令时，只要 stdout 非空，必须同时取得唯一 `ALIPAY_AIPAY_INTERNAL:CUSTOMER_MESSAGE_DELIVERY_REQUIRED=application.operation.result`，并在下一步先将 stdout 原文作为独立用户可见消息送达；送达前禁止执行 closeout 或把应用结果并入总收口。送达后同一工作回合继续，不等待用户确认，不以最终答复结束当前回合。`需人工配置` 分支同样必须交付，但禁止传公钥保存路径。

输出实际 appId、状态和下一步；若本轮 `ALIPAY_PUBLIC_KEY_EXPORT_STATUS=EXPORTED`，必须把该路径原样作为 `APP_KEY_SAVE_PATH` 传入，runner 会对客展示“当前 appId: xxx 对应的支付宝公钥保存在:xxx”。只展示路径，禁止复述支付宝公钥内容。待审核、待设钥、需人工配置、失败或未知不得称发布完成。`APP_FLOW:RETRY_WITH_LOCAL_CONFIG_PERMISSION` 不渲染结果；`MANUAL_CONFIGURATION_REQUIRED` 固定传“需人工配置”且省略 `--next-action` 和 `--app-key-save-path`，由目录派生。写操作仅 `NOT_SENT` 自动重试；`MAYBE_SENT` 查询核验，无法确认进入 `UNKNOWN`，禁止同名猜测或重复创建/提审。
