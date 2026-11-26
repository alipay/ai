# 已选收单场景的开发资源

下表供 integration-context 使用，路径从 references/integration/ 起算。`{language}` 取 java、python、nodejs、php 或 csharp。每行的示例路径使用受支持的文件名模式，* 只匹配当前语言目录的一段文件名。

| productType | 产品 | 必读本地契约 | 必读示例 | 沙箱验收动作 | 沙箱参考 |
| --- | --- | --- | --- | --- | --- |
| `aipay` | AI 按量付费 | `machine-pay/contract.md` | `machine-pay/examples/{language}/A2MPaymentDemo*.md` | `A2M_AUTO_COMPLETE` | `machine-pay/sandbox/a2m-sandbox-test.md` |
| `webpay` | AI 网页应用收款 | `vibe-pay/web-pay.md`、`vibe-pay/common-trade.md`、`vibe-pay/notifications.md` | `vibe-pay/examples/{language}/统一收单下单*.md`、`vibe-pay/examples/{language}/统一收单交易*.md`、`vibe-pay/examples/{language}/异步通知处理代码示例.md` | `WEB_PAYMENT_EXPERIENCE` | `sandbox/sandbox-setup-guide.md` |
| `apppay` | AI 移动应用收款 | `vibe-pay/app-pay.md`、`vibe-pay/common-trade.md`、`vibe-pay/notifications.md` | `vibe-pay/examples/{language}/APP支付接口代码示例.md`、`vibe-pay/examples/{language}/统一收单交易*.md`、`vibe-pay/examples/{language}/异步通知处理代码示例.md` | `NOT_APPLICABLE` | - |

按产品和语言读取 runner 返回的资料。接口或字段有疑问时，只查询对应契约的官方 sourceUrl。402 卖方实现须对接项目的持久化：返回 402 前创建待支付订单，按 out_trade_no 查询、原子准备或复用履约结果，确认履约后记录最终完成。禁止用进程内状态替代真实订单持久化。
