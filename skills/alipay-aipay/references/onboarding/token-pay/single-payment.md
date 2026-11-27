# 商业订单（单笔支付）· 商家办理

适用于接入 Token Pay 商业订单、为一次性商品或服务收款的商家，不因“网站收一笔钱”就代替网页基础收款方案。先问清是否要走商业订单接口，已经确定时直接办理或开发。
1. 商家在[官方方案资料](https://aipay.alipay.com/docs/subscribe/introduce.md)核实当前账号、经营类目、产品及办理入口，提交后以[商家签约管理](https://b.alipay.com/page/products-sign/dynlink/productSign/signManage.htm)或实际审核回执核对状态。实际费率、结算与到账以签约及当前商家状态为准。
2. 核对已上线的调用应用、产品权限、接口加签和当前商户授权。网页端商业订单按旧指引另需开通[电脑网站支付](https://b.alipay.com/page/product-workspace/product-detail/I1080300001000041203/newProductList?)；是否具备资质以该账号当前页面为准。适用的新商户需按[代调用授权步骤](guidance.md#新商户代调用授权必需)完成授权；授权不是支付结果。
3. 本 Skill 提供办理指引和证据核对，不代提交此能力的公海线索或签约；不可拿网页收单脚本的结果当成商业订单权限。
4. 开发及单次价格、托管页、订单状态见[商业订单](../../integration/token-pay/single-payment.md)。本地模拟或产品可用、获准的非生产环境可以联调，不使用周期订阅沙箱证明本产品通过。
