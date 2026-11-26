# AI连续订阅（Token Pay）能力概览
用于比较商家需求。用户已点明要做的事时直接进入相应的办理、开发或排障资料，不要求从此页重新选型。周期订阅是本产品的六项能力之一；它们不共享一套开通权限、金额单位、状态机或沙箱。

| 收费或经营动作 | 适用场景和区分点 | 商家办理 | 工程入口 |
| --- | --- | --- | --- |
| 周期订阅 | 会员、套餐每月自动续费，团队席位按周期结算；买方是企业并不意味着 B2B 收款 | [申请与准备](../../onboarding/token-pay/guidance.md) | [工程流程](flow.md)、[席位](seats.md) |
| 自动续购 | 余额低于用户设定阈值时按约定金额充值；使用单独的用户代扣协议 | [定向办理](../../onboarding/token-pay/auto-renewal.md) | [自动续购](auto-renewal.md) |
| 商业订单／单笔支付 | 一次购买或出一笔汇总结算单；网页订单基础收款或对每次 API 请求收 402 费用不自动归此 | [办理与应用权限](../../onboarding/token-pay/single-payment.md) | [商业订单](single-payment.md) |
| 企业支付 B2B | 企业聚合收银、银行转账、企业账户与资金对账；仅限商户自有应用 | [平台准备](../../onboarding/token-pay/b2b.md) | [工程实施](b2b/integration-workflow.md) |
| 数电发票 | 开蓝票、红冲、发票查询下载与通知；资金退款不等于红冲 | [商家授权](../../onboarding/token-pay/invoice.md) | [发票接入](invoice/integration.md) |
| 企业认证 | 企业四要素及法人扫脸、对公账户小额打款认证，两个能力分别开通；不能据此判断支付已签约 | [申请和身份](../../onboarding/token-pay/verification.md) | [认证接入](verification/integration.md) |

[托管价格表](low-code-integration.md)用于可选套餐的低代码展示；[营销工具](marketing-tools.md)覆盖按准入开放的试用及优惠。用户门户可供用户查看账单、调整套餐或取消续费，具体取决于实际开放情况。商户开发能力不等于本包拥有签约工具；以上商家办理均为指引和已有证据核对。只要问资费、结算、准入或入口是否还开放，按[官网核对规则](../../official-website.md)查该项当前资料；不承诺固定费率、审核或到账时间。

周期订阅的产品申请、费率和结算查[办理指引](../../onboarding/token-pay/guidance.md#办理顺序计费和结算)，默认周期及准入限制见[商户规则](merchant-default-controls.md)。各项能力的办理条件按表中对应的申请说明核实。

**经营与服务规范。** [官方产品介绍](https://aipay.alipay.com/docs/subscribe/introduce.md)的运营要求列出三份规则，分别涉及订阅经营、扣款产品的使用、服务质量及客诉处理。商家可从该页打开《AI订阅解决方案产品运营规则》《商家扣款产品使用规范》《商家扣款产品服务质量管理规则》。具体结算账期看该商家的开通通知及后续站内信或邮件。

连续订阅的选型、权益发放与验收常见问题，可阅读[官网连续订阅接入问答](https://aipay.alipay.com/article/348)。具体字段以相应接口和场景指南为准。
