## 返回示例

```json
{
  "appIds": [
    {
      "alipayPublicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...",
      "appId": "9021000162691374",
      "appPrivateKey": "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC...",
      "appPrivatePkcsKey": "MIIEpAIBAAKCAQEA...",
      "appPublicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...",
      "pid": "2088721100529696",
      "type": null,
      "uid": null
    }
  ],
  "isClaimed": false,
  "sandboxAccounts": {
    "partner": {
      "accountDesc": "商家账号",
      "acctrans": "1000000.00",
      "email": "xxxxx@sandbox.com",
      "merchantId": "221187076",
      "userId": "2088721100529696"
    },
    "user": {
      "accountDesc": "买家账号",
      "acctrans": "1000000.00",
      "email": "xxxxx@sandbox.com",
      "userName": "xxxxx",
      "userId": "2088722100508485",
      "logonPassword": "111111",
      "payPassword": "111111",
      "certNo": "195109197300184083",
      "certType": "IDENTITY_CARD"
    }
  },
  "sandboxId": "al1458801837b7495b",
  "sandboxName": "匿名沙箱-al1458801837b7495b"
}
```

## 错误返回示例

```json
{
  "data": null,
  "errorCode": null,
  "msg": "查询沙箱证书密钥信息失败",
  "resultCode": null,
  "resultMsg": null,
  "success": false,
  "traceId": "218f563417783158778985995e4b5d"
}
```