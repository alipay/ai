# APP支付接口 - NODEJS 示例

## 请求示例

```javascript
const { AlipaySdk } = require("alipay-sdk");

const alipaySdk = new AlipaySdk({
  appId: "<-- 请填写您的AppId，例如：2019091767145019 -->",
  privateKey: "<-- 请填写您的应用私钥，例如：MIIEvQIBADANB ... ... -->",
  alipayPublicKey: "<-- 请填写您的支付宝公钥，例如：MIIBIjANBg... -->",
  gateway: "https://openapi.alipay.com/gateway.do",
  appAuthToken: "<-- 请填写应用授权令牌 -->",
});
const result = await alipaySdk.sdkExec("alipay.trade.app.pay", {
  bizContent: {
    out_trade_no: "70501111111S001111119",
    total_amount: "9.00",
    subject: "大乐透",
    product_code: "QUICK_MSECURITY_PAY",
    goods_detail: [
      {
        goods_name: "ipad",
        alipay_goods_id: "20010001",
        quantity: 1,
        price: "2000",
        goods_id: "apple-01",
        goods_category: "34543238",
        categories_tree: "124868003|126232002|126252004",
        show_url: "http://www.alipay.com/xxx.jpg",
      },
    ],
    time_expire: "2016-12-31+10:05:00",
    extend_params: {
      sys_service_provider_id: "2088511833207846",
      hb_fq_seller_percent: "100",
      hb_fq_num: "3",
      industry_reflux_info:
        '{\\"scene_code\\":\\"metro_tradeorder\\",\\"channel\\":\\"xxxx\\",\\"scene_data\\":{\\"asset_name\\":\\"ALIPAY\\"}}',
      royalty_freeze: "true",
      card_type: "S0JP0000",
    },
    passback_params: "merchantBizType%3d3C%26merchantBizNo%3d2016010101111",
    merchant_order_no: "20161008001",
    ext_user_info: {
      cert_type: "IDENTITY_CARD",
      cert_no: "362334768769238881",
      mobile: "16587658765",
      name: "李明",
      min_age: "18",
      need_check_info: "F",
      identity_hash:
        "27bfcd1dee4f22c8fe8a2374af9b660419d1361b1c207e9b41a754a113f38fcc",
    },
    query_options: ["hyb_amount", "enterprise_pay_info"],
  },
});
```

## 响应示例
### 正常示例
```
app_id=2017060101317939&biz_content=%7B%22time_expire%22%3A%222016-12-31+10%3A05%3A00%22%2C%22extend_params%22%3A%22%22%2C%22query_options%22%3A%22%5B%5C%22hyb_amount%5C%22%2C%5C%22enterprise_pay_info%5C%22%5D%22%2C%22subject%22%3A%22%E5%A4%A7%E4%B9%90%E9%80%8F%22%2C%22product_code%22%3A%22QUICK_MSECURITY_PAY%22%2C%22body%22%3A%22Iphone6+16G%22%2C%22passback_params%22%3A%22merchantBizType%253d3C%2526merchantBizNo%253d2016010101111%22%2C%22specified_channel%22%3A%22pcredit%22%2C%22goods_detail%22%3A%22%22%2C%22merchant_order_no%22%3A%2220161008001%22%2C%22enable_pay_channels%22%3A%22pcredit%2CmoneyFund%2CdebitCardExpress%22%2C%22out_trade_no%22%3A%2270501111111S001111119%22%2C%22ext_user_info%22%3A%22%22%2C%22total_amount%22%3A%229.00%22%2C%22timeout_express%22%3A%2290m%22%2C%22disable_pay_channels%22%3A%22pcredit%2CmoneyFund%2CdebitCardExpress%22%2C%22agreement_sign_params%22%3A%22%22%7D&charset=UTF-8&format=json&method=alipay.trade.app.pay&sign=ERITJKEIJKJHKKKKKKKHJEREEEEEEEEEEE&sign_type=RSA2&timestamp=2014-07-24+03%3A07%3A50&version=1.0
```

