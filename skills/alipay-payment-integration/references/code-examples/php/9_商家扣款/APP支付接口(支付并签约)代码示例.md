# APP支付接口(支付并签约) - PHP 示例

## 请求示例

```php
<?php
require_once '../aop/AopClient.php';
require_once '../aop/AopCertClient.php';
require_once '../aop/AopCertification.php';
require_once '../aop/AlipayConfig.php';
require_once '../aop/request/AlipayTradeAppPayRequest.php';

// 初始化SDK
$alipayClient = new AopClient(getAlipayConfig());
// 构造请求参数以调用接口
$request = new AlipayTradeAppPayRequest();
$model = array();

// 设置商户订单号
$model['out_trade_no'] = "70501111111S001111119";

// 设置订单总金额
$model['total_amount'] = "9.00";

// 设置订单标题
$model['subject'] = "大乐透";

// 设置产品码
$model['product_code'] = "QUICK_MSECURITY_PAY";

// 设置订单绝对超时时间
$model['time_expire'] = "2016-12-31 10:05:00";

// 设置签约参数
$agreementSignParams = array();
$accessParams = array();
$accessParams['channel'] = "ALIPAYAPP";
$agreementSignParams['access_params'] = $accessParams;
$periodRuleParams = array();
$periodRuleParams['period'] = 3;
$periodRuleParams['single_amount'] = "10.99";
$periodRuleParams['period_type'] = "DAY";
$agreementSignParams['period_rule_params'] = $periodRuleParams;
$agreementSignParams['sign_notify_url'] = "http://www.merchant.com/receiveSignNotify";
$agreementSignParams['external_logon_id'] = "13888888888";
$agreementSignParams['personal_product_code'] = "CYCLE_PAY_AUTH_P";
$agreementSignParams['external_agreement_no'] = "test20190701";
$agreementSignParams['product_code'] = "GENERAL_WITHHOLDING";
$agreementSignParams['sign_scene'] = "INDUSTRY|DIGITAL_MEDIA";
$agreementSignParams['effect_time'] = "600";
$model['agreement_sign_params'] = $agreementSignParams;

$request->setBizContent(json_encode($model,JSON_UNESCAPED_UNICODE));
// 如果是第三方代调用模式，请设置app_auth_token（应用授权令牌）
$orderStr = $alipayClient->sdkExecute($request, "<-- 请填写应用授权令牌 -->");
echo $orderStr;

function getAlipayConfig()
{
    $privateKey  = '<-- 请填写您的应用私钥，例如：MIIEvQIBADANB ... ... -->';
    $alipayPublicKey = '<-- 请填写您的支付宝公钥，例如：MIIBIjANBg... -->';
    $alipayConfig = new AlipayConfig();
    $alipayConfig->setServerUrl('https://openapi.alipay.com/gateway.do');
    $alipayConfig->setAppId('<-- 请填写您的AppId，例如：2019091767145019 -->');
    $alipayConfig->setPrivateKey($privateKey);
    $alipayConfig->setFormat('json');
    $alipayConfig->setAlipayPublicKey($alipayPublicKey);
    $alipayConfig->setCharset('UTF-8');
    $alipayConfig->setSignType('RSA2');
    return $alipayConfig;
}
```

## 响应示例
### 正常示例
```
app_id=2017060101317939&biz_content=%7B%22time_expire%22%3A%222016-12-31+10%3A05%3A00%22%2C%22extend_params%22%3A%22%22%2C%22query_options%22%3A%22%5B%5C%22hyb_amount%5C%22%2C%5C%22enterprise_pay_info%5C%22%5D%22%2C%22subject%22%3A%22%E5%A4%A7%E4%B9%90%E9%80%8F%22%2C%22product_code%22%3A%22QUICK_MSECURITY_PAY%22%2C%22body%22%3A%22Iphone6+16G%22%2C%22passback_params%22%3A%22merchantBizType%253d3C%2526merchantBizNo%253d2016010101111%22%2C%22specified_channel%22%3A%22pcredit%22%2C%22goods_detail%22%3A%22%22%2C%22merchant_order_no%22%3A%2220161008001%22%2C%22enable_pay_channels%22%3A%22pcredit%2CmoneyFund%2CdebitCardExpress%22%2C%22out_trade_no%22%3A%2270501111111S001111119%22%2C%22ext_user_info%22%3A%22%22%2C%22total_amount%22%3A%229.00%22%2C%22timeout_express%22%3A%2290m%22%2C%22disable_pay_channels%22%3A%22pcredit%2CmoneyFund%2CdebitCardExpress%22%2C%22agreement_sign_params%22%3A%22%22%7D&charset=UTF-8&format=json&method=alipay.trade.app.pay&sign=ERITJKEIJKJHKKKKKKKHJEREEEEEEEEEEE&sign_type=RSA2&timestamp=2014-07-24+03%3A07%3A50&version=1.0
```

