# 常见错误排查

明确使用服务商代开发时，额外检查第三方应用签名身份和当前实际商户的独立授权是否一致；普通新商户代调用准备不代表服务商模式。

本文档整理了接入过程中常见的错误及解决方案。

周期订阅沙箱的网关、应用密钥、工作台授权、链接导入、测试时钟与消息问题，先查[沙箱接入与排障](sandbox/sandbox-integration.md)。以下通用业务规则仍适用；不要为解决沙箱错误自动改用生产凭据或生产网关。

## 通知已收到，但会员权益未生效

先看[通知与权益处理](notification-guide.md)，沿同一条事件核对三处结果：服务端是否完成验签并持久化通知、订阅查询是否已显示本次变更生效、本地处理器是否把权益写到了正确的会员或团队。只出现网关投递记录时，先检查回调处理结果。若业务处理失败但已返回成功，按现有幂等规则补处理；不要重新发起首购、重复发放权益或切换生产网关。

## 错误码分类

| 错误码 | 错误类型 | 处理方式 |
|-------|---------|---------|
| 40001/40002 | 系统错误 | 重试 |
| 40004 | 业务失败 | 检查参数 |
| 40006 | 权限不足 | 联系支付宝开通 |
| `SCHEMA_ASSEMBLE_FAILED` | 一般是商户尚未完成代调用授权，也可能是调用应用或产品权限不完整 | 先按[代调用授权操作指南](https://opendocs.alipay.com/pre-open/0jt7es)完成授权，再核对应用和产品权限 |

---

## 一、参数错误类

### INVALID_PARAMETER - 参数缺失或格式错误

**错误示例**：
```json
{
  "code": "40004",
  "msg": "Business Failed",
  "sub_code": "INVALID_PARAMETER",
  "sub_msg": "参数[items]缺失, 原因: 请传入参数[items]"
}
```

**常见原因**：

| 场景 | 原因 | 解决方案 |
|-----|------|---------|
| 订阅创建 | `items` 字段格式错误 | `items` 必须是数组：`[{"price_id": "xxx"}]` |
| 订阅创建 | 缺少 `customer_id` | 确保先调用 `customer.create` 获取 customer_id |
| 订阅创建 | customer、price、product 不存在或不属于当前商户 | 核对资源ID及创建资源时使用的应用和商户上下文；以 `sub_msg` 的字段与原因为准 |
| 订阅创建 | 重复订阅、席位数量或金额规则不满足 | 按 `sub_msg` 修正价格、数量、商品单位或金额，不要原样重试 |
| 订阅创建 | 产品、APP/电脑网站支付或代调用授权未完成 | 完成对应产品开通或授权后再试；若为超时或系统异常，不要误判为商家配置缺失 |
| 创建/修改宽限期 | 超出 0-5 或与其他修改字段混传 | 仅使用 `0`、`1`、`2`、`3`、`4`、`5`；修改时单独使用 `modify_type=UPDATE_GRACE_PERIOD` |
| 价格创建 | 缺少 `product_id` | 确保先调用 `product.create` 获取 product_id |
| 客户创建 | phone 和 email 都为空 | phone 和 email 至少传一个 |

**正确示例**：
```json
// 订阅创建请求
{
  "customer_id": "CUS_20260320001",
  "items": [
    {
      "price_id": "PRICE_001"
    }
  ],
  "subscribe_title": "AI会员专业版"
}
```

订阅创建的多类可修复业务问题当前统一返回 `INVALID_PARAMETER`，具体原因放在 `sub_msg`。不要再依赖 `CUSTOMER_NOT_EXIST`、`PRICE_NOT_EXIST`、`PRODUCT_NOT_SIGNED`、`PERMISSION_DENIED`、`DUPLICATE_SUBSCRIPTION` 或 `PAYMENT_AMOUNT_EXCEEDED` 等旧细分错误码驱动创建流程。可按 `sub_msg` 识别字段和处理方向，但避免硬编码完整文案及标点。

---

### PRODUCT_NOT_EXIST - 商品不存在（其他商品类接口可能返回）

**错误示例**：
```json
{
  "sub_code": "PRODUCT_NOT_EXIST",
  "sub_msg": "商品不存在"
}
```

**排查步骤**：
1. 检查 `product_id` 是否正确
2. 使用 `alipay.trade.product.query` 查询商品状态
3. 确认商品在当前应用下创建

订阅创建遇到同类问题时，当前通常返回 `INVALID_PARAMETER`，具体商品或价格原因见 `sub_msg`。

---

### PRICE_NOT_EXIST - 价格不存在（其他价格类接口可能返回）

**排查步骤**：
1. 检查 `price_id` 是否正确
2. 确认价格关联的商品状态为 `active`
3. 价格 ID 和商品 ID 是否匹配

订阅创建遇到同类问题时，当前通常返回 `INVALID_PARAMETER`，不要只等待 `PRICE_NOT_EXIST`。

---

## 二、签名错误类

### isv.invalid-signature - 签名验证失败（请求签名错误）

**错误示例**：
```json
{
  "code": "40002",
  "msg": "Invalid Arguments",
  "sub_code": "isv.invalid-signature",
  "sub_msg": "签名不正确，charset参数应该在URL查询字符串中"
}
```

**现象**：请求支付宝 API 返回签名验证失败，且响应内容乱码

**根本原因**：参数传递方式不符合支付宝 API 规范

**支付宝请求参数位置规范**：

| 参数类型 | 参数名称 | 必须位置 | 说明 |
|---------|---------|---------|------|
| 公共参数 | app_id | URL Query | 应用ID |
| 公共参数 | method | URL Query | 接口名称 |
| 公共参数 | format | URL Query | 响应格式 |
| 公共参数 | charset | URL Query | 字符集（必须！） |
| 公共参数 | sign_type | URL Query | 签名类型 |
| 公共参数 | timestamp | URL Query | 时间戳 |
| 公共参数 | version | URL Query | 版本号 |
| 公共参数 | sign | URL Query | 签名值 |
| 业务参数 | biz_content | POST Body | 业务参数JSON |

**正确请求格式**：
```bash
POST https://openapi.alipay.com/gateway.do?app_id=YOUR_APP_ID&method=xxx&charset=UTF-8&...&sign=xxx
Content-Type: application/x-www-form-urlencoded

biz_content={"name":"AI会员专业版","description":"xxx","metadata":"{\"default\":\"default\"}"}
```

**常见错误实现**（会导致签名失败 + 响应乱码）：
```go
// ❌ 错误：所有参数都放在 POST body 中
formData := url.Values{}
formData.Set("app_id", appID)
formData.Set("method", method)
formData.Set("charset", charset)  // charset 不应在 body 中！
formData.Set("biz_content", bizContent)
formData.Set("sign", sign)
http.PostForm(gatewayURL, formData)
```

**正确实现**：
```go
// ✅ 正确：公共参数放 URL Query，biz_content 放 POST Body

// 1. 构建公共参数（用于 URL Query）
publicParams := map[string]string{
    "app_id":    appID,
    "method":    method,
    "format":    "JSON",
    "charset":   "UTF-8",   // charset 必须在 URL 中！
    "sign_type": "RSA2",
    "timestamp": timestamp,
    "version":   "1.0",
}

// 2. 签名计算需包含所有参数（公共参数 + biz_content）
allParams := make(map[string]string)
for k, v := range publicParams {
    allParams[k] = v
}
allParams["biz_content"] = bizContent
sign := GenerateSign(allParams, privateKey)
publicParams["sign"] = sign

// 3. 公共参数放 URL Query String
queryValues := url.Values{}
for k, v := range publicParams {
    queryValues.Set(k, v)
}
requestURL := gatewayURL + "?" + queryValues.Encode()

// 4. biz_content 放 POST Body
postData := url.Values{}
postData.Set("biz_content", bizContent)

// 5. 发送请求
http.PostForm(requestURL, postData)
```

---

### 验签失败（异步通知验签）

**现象**：异步通知验签始终失败

**排查清单**：

| 检查项 | 正确做法 | 常见错误 |
|-------|---------|---------|
| 公钥选择 | 使用「支付宝公钥」验签 | ❌ 使用商户公钥验签 |
| 公钥格式 | 需要包含 PEM 头尾 | ❌ 只有 Base64 字符串 |
| 签名算法 | RSA2 (SHA256WithRSA) | ❌ 使用 RSA (SHA1WithRSA) |
| 参数排序 | ASCII 升序拼接 | ❌ 未排序或排序错误 |
| 空值处理 | 过滤空值参数 | ❌ 未过滤空值 |

**签名排查建议**：

不要在生产日志中记录私钥、完整待签名字符串或签名值。需要定位参数组装问题时，只记录请求号、参数名集合和内容摘要：
```go
signStr := buildSignString(params)
digest := sha256.Sum256([]byte(signStr))
log.Printf("签名参数检查: request_id=%s, param_count=%d, content_sha256=%x",
    requestID, len(params), digest)
```

---

## 三、网络错误类

### 请求超时

**现象**：HTTP 请求返回 timeout 错误

**解决方案**：
1. 检查服务器网络是否能访问支付宝网关
2. 增加请求超时时间（建议 30s）
3. 配置服务器 IP 白名单

### 异步通知收不到

> 💡 商户接入过程中收不到回调，**优先**提醒商户检查商家后台两项配置：① **应用网关地址**是否正常配置；② 相关消息是否已订阅（订阅产品用的是 `alipay.trade.subscription.changed`，未订阅则不会推送）。

> ⚠️ **别查错地址——异步通知推送到「应用网关地址」，不是「授权回调地址」**。开放平台有两个名字相近的配置，商户经常混淆，务必区分：
>
> | 配置 | 作用 | 是否用于订阅异步通知 |
> |------|------|:------------------:|
> | **应用网关地址** | 用于接收支付宝异步通知消息（From 平台消息等），需公网可访问的 http(s) 地址；不设置则收不到任何异步通知 | ✅ **是** |
> | **授权回调地址** | 仅用于 OAuth2.0 授权流程，用户授权后支付宝把用户重定向回你的页面并携带 `auth_code` | ❌ 否 |
>
> 排查"收不到通知"时请按**「应用网关地址」**确认，与「授权回调地址」无关。

**排查步骤**：

| 检查项 | 说明 |
|-------|------|
| **应用网关地址** | 登录开放平台 → 应用详情 → 开发设置 → 应用网关地址，填入商户接收通知的公网可访问 http(s) 地址，并与商户代码中期望的路径一致。**异步通知推送到此处，不设置则收不到** |
| **消息是否订阅** | 同一页面「消息订阅」处，确认已**订阅 `alipay.trade.subscription.changed`**（订阅产品的变更事件通知）。未勾选该消息类型时，支付宝不会向商户推送任何订阅变更回调——这是最常见的"完全收不到通知"原因 |
| 地址可达 | 使用 curl 测试「应用网关地址」指向的通知地址是否公网可达 |
| 响应格式 | 必须返回 `HTTP 200 + "success"`（无换行空格） |
| HTTPS | 生产环境必须使用 HTTPS |

**测试命令**：
```bash
curl -X POST https://your-domain.com/api/alipay/notify \
  -d "test=1"
# 预期返回: success
```

> ⚠️ 「应用网关地址配好」和「消息已订阅」是**两个独立开关**，二者缺一不可：网关地址配对了但没订阅 `alipay.trade.subscription.changed`，照样收不到；订阅了但「应用网关地址」不对或不通，则推送失败。排查时两项都要确认。

---

## 四、业务逻辑错误类

### SCHEMA_ASSEMBLE_FAILED - 未知错误

**现象**：调用订阅 OpenAPI 时返回 `SCHEMA_ASSEMBLE_FAILED`，但响应未提供可直接定位的具体业务原因。

**优先判断**：该错误一般是商户尚未完成代调用授权。先让商户按照[代调用授权操作指南](https://opendocs.alipay.com/pre-open/0jt7es)完成授权，再核对实际调用应用和所需产品权限。这是首要排查方向，不是该错误码的唯一原因，不要直接断言“必然未授权”。

**排查步骤**：

1. 让商户按照[代调用授权操作指南](https://opendocs.alipay.com/pre-open/0jt7es)完成代调用授权，并确认授权时选择的是**实际发起接口调用的应用**；多个调用应用需要分别授权。
2. 确认接口调用权限包含“商家扣款产品”，并按场景核对 APP 支付或电脑网站支付权限及对应应用类型。具体操作见[新商户代调用授权](../../onboarding/token-pay/guidance.md)。
3. 普通商户自研时，确认请求使用商户自己的应用 `app_id` 和对应签名，且商品、客户、价格与订阅资源均属于同一应用和商户上下文。
5. 商户补充或重新确认授权后，使用当前有效授权上下文重试原接口。
6. 若已确认授权无误后仍报错，保留接口方法、请求时间、请求号以及脱敏后的 `code/msg/sub_code/sub_msg`，通过正式支持渠道继续定位。

对外答复应优先表述为：“`SCHEMA_ASSEMBLE_FAILED` 一般是尚未完成代调用授权，请先按照[代调用授权操作指南](https://opendocs.alipay.com/pre-open/0jt7es)完成授权，再核对实际调用应用和产品权限。”不要把该经验判断描述成公开错误码的唯一官方含义。

### 创建被业务准入、金额或新签额度拦截

**现象**：`alipay.trade.subscription.create` 参数格式正确，但返回内容提示“不支持设置试用期”“不支持0元支付”“低于最低支付金额”“优惠力度超出范围”或“签约用户数量已达上限”。

| 提示方向 | 含义 | 处理建议 |
|----------|------|----------|
| 不支持试用期 | 默认不支持试用期，当前商户尚未具备对应准入 | 确认试用期订阅准入，不要仅调整试用天数重试 |
| 不支持0元支付 | 普通零元创建、免费试用或未来生效创建日的技术零元未通过零元订阅准入 | 确认零元订阅准入；未来生效禁止补传 `pay_amount`，其他场景没有准入时改为符合业务要求的正金额方案 |
| 低于最低支付金额 | 低价试用或正金额普通创建的系统计算后的首笔实际支付金额低于 1.00 元（100 分） | 将首笔实际支付金额提高到至少 1.00 元，并重新核对优惠、数量和价格 |
| 优惠力度超出范围 | 普通正金额首次订阅购买，系统计算后的首笔实际支付金额低于后续周期扣款金额的 1/3 | 将金额提高到满足“首笔实际支付金额 x 3 >= 后续周期扣款金额”；等于边界可通过，不要只检查请求中的原始 `pay_amount` |
| 签约用户数量已达上限 | 周期订阅使用商家扣款，累计新签用户数达到该商家当前额度 | 按[新签人数扩容指引](#累计新签人数上限)核对回执与办理入口 |

普通正金额首次订阅购买需同时满足 1.00 元下限和 1/3 规则，即最低首笔实际支付金额为 `max(1.00 元, 后续周期扣款金额 / 3 后向上取分)`。不要通过更换 `customer_id`、`price_id`、拆分请求或反复重试绕过新签上限；扩容结果和处理时长以实际审核为准。

试用期不受 3 倍管控；试用报错时先查准入和该次实际响应，不直接按首笔与续费金额比例判错。商品价格超过 500 元、周期小于 7 天或大于 3 个月／93 天，也不符合[商户默认管控规则](merchant-default-controls.md)；这些是排查方向，不是虚构的错误码映射。

本节只排查订阅创建。升级或扩容金额低于 1.00 元、低于后续周期扣款金额的 1/3，均不能据此认定失败；变更场景的金额下限是 0，零元仅签约，负数拒绝。零元升级/扩容不要求零元创建准入。如升级实际报错，应根据该次响应的 `sub_code` / `sub_msg` 定位，不要套用创建金额管控。

### 重复订阅

**现象**：同一 `customer_id` 已有相同 `price_id` 的有效订阅，创建请求返回 `INVALID_PARAMETER`，`sub_msg` 中说明价格已存在有效订阅项。

**解决方案**：
```go
// 创建前检查
existingSub, _ := db.GetActiveSubscription(customerID)
if existingSub != nil {
    return errors.New("已有有效订阅，请先取消后再订阅")
}
```

### 扣款失败

**现象**：周期扣款失败，订阅未按期续费

是否进入 `PAST_DUE` 取决于订阅是否显式配置了正数宽限期，以及当前周期是否满足实际宽限期运行条件。未配置宽限期或条件不满足时，仍可能按原流程在到期后取消。

**可能原因**：
1. 用户余额不足
2. 用户解约
3. 支付渠道限制

**系统行为**：
1. 扣款失败后若交易转入待买家付款（WAIT_BUYER_PAY），系统会向用户发送短信/邮件，附主动支付链接引导用户完成续费。
2. 已配置且满足宽限期条件时，周期结束后订阅进入 `PAST_DUE`，商户收到 change_type=`past_due`，其中包含 `grace_period_days` 和 `grace_period_end`。
3. 宽限期内恢复扣款成功后订阅回到 `ACTIVE`，商户收到 `period_extend`；宽限期到期仍未支付则取消，收到 `cancel`。
4. 未配置宽限期或实际条件不满足时，当前周期结束仍未支付会沿用到期取消流程。

**处理建议**：
1. 同时处理 `past_due`、`period_extend` 和 `cancel`，不要在收到 `past_due` 时直接按取消收回权益。
2. 记录 `grace_period_end`，按商家自己的权益策略决定宽限期内继续提供、限制或提示使用。
3. 提供手动续费入口，配合用户主动支付，并通过订阅查询补偿通知遗漏。
4. `PAST_DUE` 期间不能升级、降级、扩缩容或撤销取消；取消会立即生效并且不能传 `refund_amount`。

### 订阅交易独立退款排查

`alipay.trade.subscription.refund` 用于对订阅下指定已支付正向交易退款，不主动取消订阅。

| 现象 | 优先检查 |
|------|----------|
| 参数非法 | 四个必填字段是否齐全；`refund_amount` 是否为正整数分；`out_request_no` 是否超过 64 字符 |
| 无权操作或找不到交易 | `subscription_id`、`trade_no` 是否属于当前商户和同一订阅；原交易是否为正向已支付交易 |
| 幂等冲突 | 同一 `out_request_no` 是否改了 `trade_no` 或金额；重试必须完全复用原参数 |
| 退款金额超限 | 累计金额是否超过原交易剩余可退金额；是否对同一交易并发提交了多个不同幂等号 |
| 返回 `PENDING` / `PROCESSING` | 本地退款单保持处理中，用 `refund_order_id` 关联批量退款通知，或作为 `request_no` 查询批次 |
| 返回 `SUCCESS` / `PARTIAL_SUCCESS` / `FAILED` | 分别为全部成功、部分成功、全部失败。可用批量退款通知或查询复核状态和退款金额 |
| 发起结果未知，未拿到退款单号 | 使用原参数和原 `out_request_no` 幂等重试 |

### 客诉超标自动退款排查

平台会在商户客诉指标超过考核标准时对相关订阅订单发起全额退款。用退款通知或查询结果的 `refund_scene=AUTO_PENALTY` 识别退款来源，从 `refund_reason` 核对投诉工单号，从明细的 `pay_trade_no` 关联原交易。用平台通知中的 `request_no` 调用 `alipay.trade.commercial.batchrefund.query`，核对退款终态和实际退款金额。同一笔退款应避免重复发起。

---

## 五、Java 开发常见问题

### INVALID_PARAMETER - 参数类型不匹配（null值问题）

**错误示例**：
```json
{
  "code": "40004",
  "msg": "Business Failed",
  "sub_code": "INVALID_PARAMETER",
  "sub_msg": "参数[metadata]错误, 原因: 参数类型不匹配，期望类型为[string]，实际传入类型为[null]"
}
```

**现象**：请求JSON中包含了null值字段，导致支付宝API报参数类型错误

**请求日志示例**：
```json
{"name":"AI会员专业版","description":"xxx","metadata":null,"images":null,"url":null,"marketing_features":null}
```

**根本原因**：Java对象序列化时，默认会包含null值字段，而支付宝API不接受null值参数

**解决方案**：配置Jackson忽略null值

```java
// 使用Jackson ObjectMapper时配置忽略null值
ObjectMapper objectMapper = new ObjectMapper();
objectMapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);

// 或者在类上使用注解
@JsonInclude(JsonInclude.Include.NON_NULL)
public class Product {
    private String name;
    private String description;
    // ...
}
```

---

### Jackson 序列化属性冲突

**错误示例**：
```
com.fasterxml.jackson.databind.exc.InvalidDefinitionException: Conflicting getter definitions for property "marketing_features": com.example.Product#getMarketingFeatures() vs com.example.Product#getMarketingFeaturesJson()
```

**现象**：JSON序列化时报错，提示属性定义冲突

**根本原因**：
1. 字段名使用驼峰命名 `marketingFeatures`
2. 又用 `@JsonProperty("marketing_features")` 定义了另一个字段
3. Jackson序列化时，两个getter方法都映射到 `marketing_features`，导致冲突

**错误代码示例**：
```java
public class Product {
    private String marketingFeatures;  // getter: getMarketingFeatures() → marketingFeatures

    @JsonProperty("marketing_features")
    private String marketingFeaturesJson;  // getter: getMarketingFeaturesJson() → marketing_features

    // 冲突：两个字段都可以映射到 marketing_features
}
```

**解决方案**：

```java
// 方案1：只保留一个字段，使用@JsonProperty指定JSON字段名
public class Product {
    @JsonProperty("marketing_features")
    private String marketingFeatures;

    // getter/setter正常命名即可
    public String getMarketingFeatures() { return marketingFeatures; }
    public void setMarketingFeatures(String marketingFeatures) { this.marketingFeatures = marketingFeatures; }
}

// 方案2：如果确实需要两个不同字段，使用@JsonIgnore忽略其中一个的序列化
public class Product {
    private String marketingFeatures;

    @JsonProperty("marketing_features")
    @JsonIgnore  // 序列化时忽略此字段
    private String marketingFeaturesJson;
}
```

---

## 六、本地单元测试与生产配置核对

### 配置建议

```yaml
# 本地单元测试：不配置真实凭据，不发起在线调用
alipay:
  mock_mode: true   # 开启 Mock，不调用真实 API

# 商家生产配置示意，仅供核对；实际联调用独立沙箱或上方 Mock
alipay:
  mock_mode: false  # 关闭 Mock，调用真实 API
  app_id: YOUR_APP_ID
  private_key: YOUR_APP_PRIVATE_KEY
  alipay_public_key: YOUR_ALIPAY_PUBLIC_KEY
  gateway_url: https://openapi.alipay.com/gateway.do
```

实际需要复现在线问题时，见[沙箱接入与排障](sandbox/sandbox-integration.md)；只凭生产配置不能判定生产验收成功。

### Mock 模式返回值

| 接口 | Mock 返回 |
|-----|----------|
| product.create | `MOCK_PROD_时间戳` |
| price.create | `MOCK_PRICE_时间戳` |
| customer.create | `MOCK_CUST_时间戳` |
| subscription.create | `MOCK_SUB_时间戳` + 本地支付链接 |

---

## 六、日志排查建议

### 关键日志点

```go
// 请求日志
log.Printf("支付宝API请求: request_id=%s, method=%s", requestID, method)

// 响应日志
log.Printf("支付宝API响应: request_id=%s, http_status=%d, code=%s, sub_code=%s",
    requestID, statusCode, code, subCode)

// 异步通知日志
log.Printf("收到支付宝通知: notify_id=%s, type=%s", notifyID, notifyType)
log.Printf("验签结果: %v", verifyResult)
```

日志中不得记录私钥、授权令牌、完整签名、完整请求/响应报文或用户敏感信息。

### 日志排查顺序

```
1. 检查请求参数 → biz_content 是否正确
2. 检查签名 → 签名是否生成成功
3. 检查响应 → code/msg/sub_code/sub_msg
4. 检查异步通知 → 是否收到、验签是否通过
```

---

## 七、联系支持

如遇到无法解决的问题：

1. **支付宝开放平台工单**：https://open.alipay.com/
2. **订阅对接同学**：联系专门的业务对接人员
3. **提供信息**：
   - 脱敏后的应用标识
   - 错误码 (sub_code)
   - 请求时间
   - 请求号和脱敏后的请求/响应摘要

提交排障材料前，必须移除私钥、授权令牌、完整签名和用户敏感信息。

## 累计新签人数上限

商家通过周期订阅使用已签约的「商家扣款」产品时，每个商家默认累计可新签 5000 名用户。达到商家当前额度会拦截新增签约，已有订阅仍可查询、续费或变更。团队套餐的席位数单独计算。[官方订阅接入说明](https://aipay.alipay.com/docs/subscribe/introduce.md)

出现新签人数已达上限的回执时，停止重复创建。本 Skill 提供扩容办理指引，由商家按页面提交申请。是否获批及生效额度以商家当期权限和实际回执为准。[商家扩容申请](https://render.alipay.com/p/yuyan/180022670000138080/index.html)
