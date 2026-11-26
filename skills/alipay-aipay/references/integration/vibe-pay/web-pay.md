# AI 网页应用收款 · 工程接入

在现有服务端实现网页下单、查单、退款、退款查询、关闭、异步通知及适用的同步回跳。PC 和手机浏览器使用同一底层接口。沙箱就绪时提供网页付款体验指引，验签后的通知或主动查单才是支付结果依据。

执行当前任务时将已确认的 `webpay` 传入[收单运行入口](../../runtime-entry.md)，沿用开发阶段及恢复协议。加载器在对应阶段使用以下片段；片段内的相对路径从 integration/ 起算。

# AI 网页应用收款本地接口契约

本文是 AI 网页应用收款专用下单接口的默认本地依据。在线文档只在本地契约或示例缺失、字段不确定、排查官方错误码、用户明确要求或官方能力变化时作为 fallback 读取。

sourceUrl:

- <https://aipay.alipay.com/docs/vibe-pay/ai-web-app-payment-qianyi/ai-web-app-payment-integration-guide.md>
- <https://aipay.alipay.com/docs/vibe-pay/ai-web-app-payment-qianyi/api-list/alipay-trade-page-pay.md>

## 默认范围

AI 网页应用收款必须覆盖：`alipay.trade.page.pay`、交易查询、退款、退款查询、关闭交易、异步通知和默认同步回跳结果页。

查询、退款、退款查询、关闭交易读取 `common-trade.md`；异步通知读取 `notifications.md`。

官方目录中的 `alipay.data.dataservice.bill.downloadurl.query` 不是当前 Skill 默认交付项。用户明确要求对账时再按在线文档 fallback 处理，不能加入默认 checklist。

## 下单接口

`alipay.trade.page.pay` 是AI 网页应用收款唯一默认下单接口，电脑网页、手机浏览器网页和 H5 场景均使用该接口，不改用其他网页支付产品接口。

公共参数：

| 字段 | 要求 |
| --- | --- |
| `method` | 固定 `alipay.trade.page.pay` |
| `notify_url` | 可选，生产也可省略；使用通知时传入商家公网 HTTP/HTTPS 地址，不使用时由服务端可靠主动查单；通知处理代码仍须实现 |
| `return_url` | 用户未明确关闭同步回跳时默认传入，且对应当前项目实际 GET 路由 |

业务参数：

| 字段 | 要求 |
| --- | --- |
| `out_trade_no` | 必填，商户订单号，商户侧唯一 |
| `total_amount` | 必填，单位元，精确到小数点后两位，范围 `[0.01,100000000]` |
| `subject` | 必填，订单标题 |
| `product_code` | 必填且固定 `FAST_INSTANT_TRADE_PAY` |

## 响应与结果

- 必须使用页面跳转方法：Java `pageExecute`、Python `page_execute`、PHP `pageExecute`、Node.js `pageExec`、C# `PageExecute`。
- 推荐 POST 方式，响应为 HTML form 或同等页面跳转内容，必须在浏览器渲染并提交。
- `curl` 获取到 HTML form 只能证明接口有响应，不能替代浏览器付款入口和沙箱付款体验。
- `return_url` 或前台页面只作支付结束通知，不能作为付款成功依据；付款成功以验签通过的异步通知或交易查询为准。

<!-- ALIPAY_AIPAY_SECTION:INTEGRATION_VERIFICATION:START -->
**网站支付回跳默认规则**：用户未特别说明时，默认实现支付后同步回跳。`return_url` 必须来自已确认目标项目的实际协议、主机、端口和路由，禁止保留 `your-domain.com`、示例端口或猜测路径。项目没有结果页时，在当前技术栈内新增与既有 UI 一致的 GET 回跳路由和页面。用户已明确不需要同步回跳时，直接按关闭分支验收，不增加第二次确认；仍必须保留异步通知、交易查询和商户订单查询页。用户未明确关闭但代码缺少 `return_url` 时，必须修复为默认同步回跳分支，不得要求用户接受遗漏。验收结论必须从实际代码重新检查，不接受调用方自报 `returnMode`。
<!-- ALIPAY_AIPAY_SECTION:INTEGRATION_VERIFICATION:END -->

<!-- ALIPAY_AIPAY_SECTION:INTEGRATION_ACCEPTANCE:START -->
#### AI 网页应用收款：提供人工沙箱付款指引

网站支付步骤 6 是用户可操作的付款体验交付，不是支付接口冒烟测试。启动服务、访问首页、用 `curl` 调用下单接口或取得 HTML 支付表单，只能证明对应本地接口有响应；没有向用户提供可在浏览器打开的真实支付页面和以下两种付款方式时，禁止标记步骤 6 完成：

- 方式一：在沙箱收银台输入沙箱买家账号和登录密码，再输入支付密码付款。
- 方式二：仅限 Android，安装沙箱支付宝并登录沙箱买家账号，在沙箱收银台使用客户端扫码，再输入支付密码付款。

两种方式必须同时说明并由用户自行二选一，不要求用户两种都做；用户暂不体验不阻塞后续代码校验，但必须明确记录“沙箱付款待用户体验”，不得输出“支付订单创建成功”来替代该状态。

网站支付代码生成和配置后置校验完成后，按以下顺序执行：

1. 从已确认的目标项目确定真实的服务启动命令和支付页面访问地址，禁止使用占位符、示例端口或猜测地址。
2. 用户未明确关闭同步回跳时，确认 SDK 实际传入的 `return_url`，且其与项目实现的 GET 回跳路由完全一致。
3. 默认分支继续启动服务，并对不带支付结果参数的 `return_url` 发起 GET 访问。这一步只验证路由和页面壳：无订单上下文时应展示安全的中性状态，不得因没有签名参数而绕过真实回跳请求的验签和订单归属校验。确认响应成功、无认证或重定向循环；单页应用直接刷新不得返回 404。
4. 默认分支中，Agent 具备浏览器/UI 验证能力时，实际打开回跳页，确认页面非空白、无可见报错且关键状态内容正常渲染。不具备时，不向用户追加人工确认；将“回跳页 UI 人工待验证”记录到最终 checklist 的 `manualItems`，并继续提供沙箱付款入口。

5. 用户已明确关闭同步回跳时，不要求或猜测 `return_url`；确认 SDK 请求未传该字段，并改为验证异步通知处理代码、交易查询和商户订单查询页。如尚未部署公网 HTTP/HTTPS `notify_url`，保留上线前提醒，不单独计入本轮失败或人工待验证项；生产不使用通知时需验证服务端可靠主动查单。
6. 输出沙箱付款说明。操作顺序为：启动服务 → 用浏览器访问支付页面 → 发起支付 → 唤起沙箱收银台 → 用户从“收银台账号登录”与“安卓沙箱支付宝扫码”中二选一完成付款 → 返回商户结果页并查询展示订单状态。

回跳地址无法确定、访问失败或页面出现确定错误时，必须先修正；本轮无法继续修正时进入最终 checklist 的未完成项，不得宣称网站支付代码开发完成。仅缺少浏览器/UI 证据时记录“回跳页 UI 人工待验证”，不得宣称回跳页已验证，但不阻塞沙箱付款入口交付。该体验不新增业务写操作确认点，用户暂未付款不阻止后续代码校验。

网站支付本步骤的完成语义是“沙箱付款入口与操作说明已提供，并已按实际证据验证回跳页面或关闭回跳分支”，不是“沙箱支付测试通过”。即使用户随后反馈已完成付款，也只记录“用户已完成一笔沙箱付款”以及能够实际核验的订单、回跳或查询结果，不输出笼统的“沙箱环境测试通过”。

**完成条件（网站支付）**：
- [INT.WEBPAY.EXPERIENCE_DELIVERED] 已向用户明确提供真实服务启动命令、浏览器支付页面访问地址、完整沙箱付款顺序、“沙箱买家账号登录”与“安卓沙箱支付宝扫码”两种二选一体验方式，以及结果判断提醒；未用 `curl` 返回的 HTML 表单替代浏览器付款入口

以下两项按实际分支二选一，不得同时要求：

- [INT.WEBPAY.RETURN_VERIFIED] 默认分支已确认实际 `return_url` 与项目路由一致，启动服务后 GET 访问通过，且已通过 Agent 浏览器/UI 验证取得页面正常渲染的证据；当前环境无法取得 UI 证据时只能记为人工待验证，不能满足本完成条件
- [INT.WEBPAY.NO_RETURN_VERIFIED] 关闭分支已记录用户先前明确提出的不使用同步回跳，确认 SDK 请求未传 `return_url`，并完成异步通知处理代码、交易查询和商户订单查询页校验；缺少公网 HTTP/HTTPS `notify_url` 时已保留上线前提醒；不使用通知时验证服务端可靠主动查单
<!-- ALIPAY_AIPAY_SECTION:INTEGRATION_ACCEPTANCE:END -->

<!-- ALIPAY_AIPAY_SECTION:INTEGRATION_CHECKLIST:START -->
```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message checklist-result --variant WEBPAY --project-path "$PROJECT_PATH" --scope-receipt "$CHECKLIST_SCOPE_RECEIPT" --overall-result "$OVERALL_RESULT" --failed-items "$FAILED_ITEMS" --manual-items "$MANUAL_ITEMS" --webpay-experience-result "$WEBPAY_EXPERIENCE_RESULT" --sandbox-config-state "$SANDBOX_CONFIG_STATE" --blocking-defect-state "$BLOCKING_DEFECT_STATE" --execution-mode "$EXECUTION_MODE" --next-flow-reminder "$NEXT_FLOW_REMINDER" [--sandbox-summary "$SANDBOX_SUMMARY"] --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```
<!-- ALIPAY_AIPAY_SECTION:INTEGRATION_CHECKLIST:END -->
