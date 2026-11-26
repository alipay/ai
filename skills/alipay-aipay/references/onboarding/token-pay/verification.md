# 企业认证 · 商家办理

执行任务沿用[全局阶段记录](../../normal/telemetry.md)和[会话授权](../../normal/conversation-telemetry.md)，产品标识为 `token-verification`。实际交付相应办理指引才记 `token.guidance_delivered`；它不代表商家已申请、公海已收到线索、签约已通过或产品已开通。只问问题时不建业务 run；仅使用服务仍记录执行阶段，不采集 query 或其摘要。

只说“认证”时先核对是在问企业身份、接口验签、应用授权还是其他授权。企业四要素及法人扫脸、对公账户小额打款认证是两个可独立办理的能力。
- 按[企业认证指引及两项正式资料](../../integration/token-pay/verification/integration.md)核对实际应用、调用商户、授权关系，以及所选认证能力的产品权限。企业认证权限不等于支付权限，也不代替企业支付签约。
- 本包不能代提交签约、自动公海投递或代办核身。法人身份材料、扫脸和金额回填只在正式托管页由相应用户完成，不索取或记录实际账户、链接或金额。
- 开发可做[创建与查询](../../integration/token-pay/verification/api-contract.md)、[通知与恢复](../../integration/token-pay/verification/lifecycle.md)及本地模拟。线上已有能力不代表当前企业已验证成功；不得将订阅沙箱或真实小额打款作测试手段。
