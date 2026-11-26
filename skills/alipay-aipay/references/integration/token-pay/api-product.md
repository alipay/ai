# 商品管理接口（alipay.trade.product）

订阅商品的创建、修改、查询。三个接口共用网关 `https://openapi.alipay.com/gateway.do`，请求方式 POST。

定价和周期配置前先核对[商户默认管控规则](merchant-default-controls.md)：默认商品价格最高 500 元、周期最短 7 天和最长 3 个月／93 天。商品接口支持不代表所有价格方案默认可用。

## 公共请求参数

| 参数 | 类型 | 必选 | 最大长度 | 描述 | 示例值 |
|------|------|------|----------|------|--------|
| app_id | String | 必选 | 32 | 支付宝分配给开发者的应用ID | YOUR_APP_ID |
| method | String | 必选 | 128 | 接口名称 | alipay.trade.product.create |
| format | String | 可选 | 40 | 仅支持JSON | JSON |
| charset | String | 必选 | 10 | 编码格式 | utf-8 |
| sign_type | String | 必选 | 10 | 签名算法类型，推荐RSA2 | RSA2 |
| sign | String | 必选 | 344 | 请求参数签名串 | 详见签名文档 |
| timestamp | String | 必选 | 19 | 发送请求时间 | 2014-07-24 03:07:50 |
| version | String | 必选 | 3 | 接口版本，固定1.0 | 1.0 |
| app_auth_token | String | 可选 | 40 | 应用授权令牌（**服务商代开发模式**下代商家调用时必传，由第三方应用授权获取） | |
| biz_content | String | 必选 | - | 请求参数集合 | 见各接口业务参数 |

---

## 商品创建（alipay.trade.product.create）

创建订阅产品，获取商品 ID 用于后续签约和扣款。

### 业务请求参数

| 参数 | 类型 | 必选 | 长度限制 | 描述 | 示例值 |
|------|------|------|----------|------|--------|
| name | string | **必选** | [1,255] | 商品名称 | AI会员专业版 |
| description | string | 可选 | [1,255] | 商品描述 | 基础权益 |
| metadata | string | **建议传** | [1,2048] | 商品模型元数据（JSON格式） | {"default":"default"} |
| images | string | 可选 | [1,4000] | 图片地址，不超过5个 | ["https://example.com/img.png"] |
| marketing_features | string | 可选 | [1,4000] | 营销信息，不超过5个 | ["16000积分"] |
| **unit_label** | string | **条件必选** | [1,100] | **单位别名（席位订阅必传，如"席位"）** | 席位 |
| url | string | 可选 | [1,500] | 跳转地址 | https://example.com |

> ⚠️ **席位订阅**：如需创建席位商品，`unit_label` 为必传字段，会展示在用户签约协议页面，代表购买单位（如"席位"、"用户"）。该字段受支付宝管控，接入前需与支付宝业务确认传值。

### 响应参数

| 参数 | 类型 | 必选 | 描述 | 示例值 |
|------|------|------|------|--------|
| code | string | 必选 | 网关返回码 | 10000 |
| msg | string | 必选 | 网关返回码描述 | Success |
| product_id | string | 必选 | 商品ID | 202603230010000000000 |

### 请求示例

```bash
# 标准订阅商品
curl 'https://openapi.alipay.com/gateway.do?charset=UTF-8&method=alipay.trade.product.create&format=json&sign=${sign}&app_id=${appid}&version=1.0&sign_type=RSA2&timestamp=${now}' \
 -F 'biz_content={
   "name":"AI会员专业版",
   "description":"畅享GPT-4、DALL-E等高级功能",
   "metadata":"{\"default\":\"default\"}"
 }'
```

席位订阅商品在 `biz_content` 中增加 `"unit_label":"席位"` 即可。

```java
// SubscriptionApiRequest / SubscriptionApiResponse 见 code-example-java.md
String bizContent = "{\"name\":\"AI会员专业版\",\"description\":\"包含高级功能\",\"metadata\":\"{\\\"default\\\":\\\"default\\\"}\"}";
SubscriptionApiRequest request = new SubscriptionApiRequest(
        "alipay.trade.product.create",
        bizContent
);
SubscriptionApiResponse response = alipayClient.execute(request);
if (response.isSuccess()) {
    String productId = response.getProductId();  // 保存 product_id 用于后续签约和扣款
}
```

Java 默认使用官方 SDK，适配器实现和依赖配置见 [code-example-java.md](code-example-java.md)。

### 响应示例

```json
{
  "alipay_trade_product_create_response": {
    "code": "10000",
    "msg": "Success",
    "product_id": "202603230010000000000"
  },
  "sign": "ERITJKEIJKJHKKKKKKKHJEREEEEEEEEEEE"
}
```

---

## 商品修改（alipay.trade.product.modify）

修改已创建的订阅商品信息。只传需要修改的字段，未传字段保持不变。

### 业务请求参数

| 参数 | 类型 | 必选 | 长度限制 | 描述 | 示例值 |
|------|------|------|----------|------|--------|
| product_id | string | **必选** | [1,32] | 本次更新的商品ID | 20260324001001 |
| name | string | 可选 | [1,255] | 商品名称 | AI会员专业版 |
| description | string | 可选 | [1,255] | 商品描述 | 基础权益 |
| default_price_id | string | 可选 | [1,32] | 该商品默认价格ID（必须已存在且属于该商品） | 20260324001001 |
| metadata | string | 可选 | [1,2048] | 商品元数据（JSON格式） | {"default":"default"} |
| marketing_features | string | 可选 | [1,4000] | 营销信息（JSON格式） | ["16000积分"] |

### 响应参数

| 参数 | 类型 | 必选 | 描述 | 示例值 |
|------|------|------|------|--------|
| code / msg / product_id | string | 必选 | 同创建接口 | 10000 / Success / 20260324001001 |

### 请求示例

```bash
curl 'https://openapi.alipay.com/gateway.do?charset=UTF-8&method=alipay.trade.product.modify&format=json&sign=${sign}&app_id=${appid}&version=1.0&sign_type=RSA2&timestamp=${now}' \
 -F 'biz_content={
   "product_id":"20260324001001",
   "name":"AI会员专业版升级版",
   "description":"更多权益，无限GPT-4调用",
   "metadata":"{\"default\":\"default\"}"
 }'
```

### 响应示例

```json
{
  "alipay_trade_product_modify_response": {
    "code": "10000",
    "msg": "Success",
    "product_id": "20260324001001"
  },
  "sign": "ERITJKEIJKJHKKKKKKKHJEREEEEEEEEEEE"
}
```

> **注意**：`product_id` 必须属于当前应用，跨应用修改会报错；如要修改默认价格，需先创建价格再传入 `default_price_id`。

---

## 商品查询（alipay.trade.product.query）

查询已创建的商品信息，返回 `product_list` 数组。

### 业务请求参数

| 参数 | 类型 | 必选 | 长度限制 | 描述 | 示例值 |
|------|------|------|----------|------|--------|
| product_id | string | 可选 | [1,32] | 商品ID，为空时查询该商户下所有商品 | 202603230010000006783 |
| query_options | array | 可选 | [1,10] | 查询选项，支持：price（默认价格信息） | ["price"] |
| page_num | number | 可选 | - | 页码，从 1 开始，默认 1（列表查询时生效） | 1 |
| page_size | number | 可选 | - | 每页条数，默认 100（列表查询时生效） | 100 |

### 响应字段（product_list 元素）

| 字段 | 说明 |
|------|------|
| id | 商品ID |
| name | 商品名称 |
| description | 商品描述 |
| active | 是否可用 |
| default_price_id | 默认价格ID |
| metadata | 元数据 |
| images | 图片地址列表（JSON） |
| marketing_features | 营销信息列表（JSON） |
| unit_label | 单位别名 |
| url | 跳转地址 |
| gmt_create | 创建时间 |
| gmt_modified | 修改时间 |
| default_price | 默认价格对象（query_options 含 price 时返回） |

### 响应示例

```json
{
  "alipay_trade_product_query_response": {
    "code": "10000",
    "msg": "Success",
    "product_list": [
      {
        "id": "20260324001001",
        "name": "AI会员专业版",
        "description": "基础权益",
        "active": true,
        "default_price_id": "20260324001001",
        "metadata": "{\"default\":\"default\"}",
        "gmt_create": "2026-03-24 18:00:00"
      }
    ]
  },
  "sign": "xxx"
}
```

---

## 错误码

| 错误码 | 错误描述 | 解决方案 |
|--------|----------|----------|
| SYSTEM_ERROR | 系统繁忙 | 网络或系统异常，用同样请求重试 |
| INVALID_PARAMETER | 参数有误 | 根据返回的错误信息修改参数后重试 |
| APP_ID_NOT_MATCH | 应用ID与商品所属应用不匹配 | 检查商品ID是否属于当前应用（当前商品修改/查询接口在跨应用场景实际返回 PRODUCT_NOT_EXIST） |
| PRODUCT_NOT_EXIST | 商品不存在 | 检查传入的商品ID是否正确 |
| PRICE_NOT_EXIST | 价格不存在（修改默认价格时） | 检查传入的价格ID是否正确 |

## 注意事项

1. **product_id 用途**：创建成功后用于后续签约和扣款流程
2. **商品信息确认页面**：所有页面信息的自定义配置需联系支付宝 BD 提前配置
3. **图片/营销信息**：图片地址、营销标签各不超过 5 个
4. **跨应用限制**：`product_id` 必须属于当前应用，跨应用操作按商品不存在处理（返回 `PRODUCT_NOT_EXIST`）
