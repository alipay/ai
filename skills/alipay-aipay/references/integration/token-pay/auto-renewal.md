# 自动续购产品接入指南

交付时按实际工程改动和验证结果说明接入进展，并注明验证是在本地模拟环境还是产品允许的非生产环境。

> **产品定位**：自动续购属于 Token Pay，与周期订阅是两种不同的收费方式；使用代扣协议（user.agreement），不使用周期订阅接口（trade.subscription）。商家办理及邀约条件见[开通指引](../../onboarding/token-pay/auto-renewal.md)。

## 🌟 产品介绍

**自动续购能力**是支付宝为 **AI 行业**打造的专属解决方案，帮助用户管理平台钱包余额、帮助商家持续售卖 AI 服务。

用户签约时可**自定义自动续购条件及续购金额**，通过授权将商户账号与用户支付宝账号绑定。支付宝依据用户签署的协议、按商户指令自动为用户续购 AI 服务，保证商家业务收入稳定、建立长期客户关系、提供持续价值交付与便捷体验。

### 主动充值 vs 自动续购

| 角色 | 主动充值（痛点） | 自动续购（亮点） |
|:---:|------|------|
| **用户** | 需经常关注钱包余额，使用成本高；余额不足时模型服务中断，体验差 | 帮助用户管理钱包，保证服务连续性；降低使用成本，提升体验 |
| **商家** | 用户余额耗尽未及时续费，影响收入；服务突然中断易引发客诉 | 服务不中断保证收入稳定、提高用户粘性；减少客诉、降低流失 |

### 典型场景

- ✅ **余额不足自动续购**：当用户在平台内钱包余额达到续购条件时，支付宝自动转入相应续购金额至商户平台的用户钱包。
- ⏸️ **固定周期自动续购**：本期暂不支持。

### 用户签约动线

自动续购主要存在于三类场景：**用户首次开通服务、修改服务计划、自动续购持续扣款**。

1. **首次开通服务**：用户在商户端选择自动续购服务、设置触发条件及续购金额后，支付宝返回独立签约链接，商户以二维码形式展示；用户支付宝扫码进入协议签约页确认并签约（以积分为例，支持续购人民币或其他虚拟货币等充值单位）。
2. **修改服务计划**：用户修改触发条件及续购金额后，支付宝扫码确认变更信息，完成签约并更新自动续购产品信息。
3. **持续扣款**：用户开通成功后，商户调用支付宝扣款接口完成金额续购；扣款成功后支付宝通知商户继续履约。

### 使用规范

- ⚠️ 请**严格按照用户设定的条件和金额**执行扣款。
- ⚠️ 扣款前需**提前发送扣款预通知**，提醒用户近期即将有一笔扣款，合理设置预通知条件保障用户体验。

### 准入条件

- 支持的账号类型：[支付宝企业账号](https://opendocs.alipay.com/common/02kkum)、[支付宝个人账号](https://opendocs.alipay.com/common/02kg61)、[个体工商户](https://opendocs.alipay.com/common/02kkul?pathHash=134df856)。
- 自动续购目前仅对**邀约名单内的商户定向开放**。如需接入，请联系与您对接的支付宝业务人员咨询。
- 计费费率、页面自定义配置等请联系对应的支付宝业务人员。

---

## 📌 接入前置说明

- **接入方式**：仅支持**自研商家/服务商**通过 [自研应用](https://opendocs.alipay.com/common/02bijh#%E8%87%AA%E7%A0%94%E6%9C%8D%E5%8A%A1%E5%9E%8B%E5%BA%94%E7%94%A8) 或 [第三方应用](https://opendocs.alipay.com/common/02bijh#%E4%B8%89%E6%96%B9%E6%9C%8D%E5%8A%A1%E5%9E%8B%E5%BA%94%E7%94%A8) 代调用（传 `app_auth_token`）方式调用 API 接入。
- **联调**：自动续购暂无产品沙箱。商家按接入要求在获准的生产环境联调，留存协议建立、续购通知、订单状态与履约的关联证据。本 Skill 以本地模拟验证协议、预通知、幂等和履约，不使用周期订阅沙箱，也不向生产网关签协议、扣款或解约。下方请求示例仅作开发参考。

## 🔄 完整接入时序

```
签约 → 预通知（扣款许可） → 发起扣款 → 查询结果 → （按需）解约 / 变更
```

涉及四条核心链路：① 签约 ② 扣款 ③ 解约 ④ 变更（新签+旧解约）。

---

## 一、签约自动续购

调用 [alipay.user.agreement.page.sign](https://opendocs.alipay.com/pre-apis/00a8xl)（支付宝个人协议页面签约接口）发起签约并接收签约消息通知。

### 1.1 发起签约

签约时需传入自动续购相关产品码、场景码、用户自定义的自动续购条件及金额。

#### 重要参数说明

| 参数 | 说明 |
|------|------|
| `product_code` | 销售产品码，必选，固定 `GENERAL_WITHHOLDING` |
| `personal_product_code` | 个人签约产品码，必选，固定 `GENERAL_WITHHOLDING_P` |
| `sign_scene` | 签约场景码，必选，自动续购场景固定 `INDUSTRY\|AUTO_RENEWAL_SCENE` |
| `external_agreement_no` | 商户签约号，必选，代扣协议中标识用户的唯一签约号（确保在商户系统中唯一） |
| `specified_deduct_rule_params` | 扣款规则，扣款条件数值与单位组合，代表用户设置的自动续购条件 |

`specified_deduct_rule_params` 子参数：

| 子参数 | 说明 |
|--------|------|
| `specified_pay_trigger_amount` | 扣款条件数值，必选，记录用户设置的自动续购条件 |
| `specified_pay_trigger_unit` | 扣款条件单位，必选，记录商家侧充值单位（元、积分、游戏币等） |
| `specified_pay_amount` | 扣款金额，必选，单位：元。**后续每一笔扣款必须与用户设置的金额完全一致，否则不允许扣款** |

`access_params`：按当前接入方式填充，且取值必须在文档参数范围内。扫码/短信页面签约需拼装 http 请求地址访问中间页，钱包 h5 页面签约可直接拼接 schema 请求地址。其子参数 `channel` 为接入渠道，一般即支付宝钱包 `ALIPAYAPP`。

> 其它参数若有传参需要，请与支付宝技术支持沟通确认。

#### 请求示例

发起签约后支持**跳转支付宝端**或**生成二维码**两种形式完成签约，商户按实际场景选择。

**方式一：跳转支付宝端**（SDK 独立签约 bizContent 示例）：

```json
bizContent={
    "personal_product_code":"GENERAL_WITHHOLDING_P",
    "sign_scene":"INDUSTRY|AUTO_RENEWAL_SCENE",
    "external_agreement_no":"YOUR_EXTERNAL_AGREEMENT_NO",
    "access_params":{
        "channel":"ALIPAYAPP"
    }
}
```

生成签约字符串：

```java
AlipayClient alipayClient = new DefaultAlipayClient(
    "https://openapi.alipay.com/gateway.do",
    "app_id","your private_key","json","GBK","alipay_public_key","RSA2");
AlipayUserAgreementPageSignRequest request = new AlipayUserAgreementPageSignRequest();
request.setBizContent(参考上面bizContent值示例);
request.setNotifyUrl("接收异步通知URL地址");
request.setReturnUrl("用户签约成功跳转地址");
AlipayUserAgreementPageSignResponse response = alipayClient.sdkExecute(request);
```

**方式二：生成签约二维码**（PC 转二维码）：

```java
AlipayClient alipayClient = new DefaultAlipayClient(
    "https://openapi.alipay.com/gateway.do",
    "app_id","your private_key","json","GBK","alipay_public_key","RSA2");
AlipayUserAgreementPageSignRequest request = new AlipayUserAgreementPageSignRequest();
request.setBizContent(参考上面的bizContent);
// pageExecute get方式，生成url
AlipayUserAgreementPageSignResponse response = alipayClient.pageExecute(request,"get");
//生成的url地址去除 https://openapi.alipay.com/gateway.do?
signParams = response.getBody().replace("https://openapi.alipay.com/gateway.do?"," ");
// 生成唤起客户端。把signParams使用 UTF-8 字符集整体做一次 encode
return "alipays://platformapi/startapp?appId=60000157&appClearTop=false&startMultApp=YES&sign_params=" + encode(signParams);
```

> ⚠️ `alipays://platformapi/startapp?appId=60000157&appClearTop=false&startMultApp=YES&sign_params=` 中的 **APPID 为固定值，不可修改**。

### 1.2 获取签约消息通知

支付宝根据原始 API 中传入的异步通知地址 `notify_url`，通过 **POST** 将签约结果通知到商户系统（优先推送到 `notify_url`，未传则取**应用网关**地址——商家必须在开放平台应用信息中配置应用网关）。

> 商户获取通知后，必须使用**支付宝公钥验签**。异步通知参数**编码方式为 GBK**。

#### 异步通知参数说明

| 名称 | 是否必填 | 示例值 | 描述 |
|------|:------:|------|------|
| agreement_no | 必须 | YOUR_AGREEMENT_NO | 支付宝系统中唯一标识用户签约记录的编号 |
| status | 必须 | NORMAL | 协议状态：TEMP（暂存未生效过）/ NORMAL（正常）/ STOP（暂停） |
| sign_scene | 必须 | INDUSTRY\|AUTO_RENEWAL_SCENE | 当前签约协议场景，固定 `INDUSTRY\|AUTO_RENEWAL_SCENE` |
| sign_time | 必须 | 2017-05-20 11:49:19 | 实际签约时间（yyyy-MM-dd HH:mm:ss） |
| alipay_user_id | 必须 | ALIPAY_USER_ID | 用户签约的支付宝账号对应唯一用户号（2088 开头 16 位纯数字） |
| external_logon_id | 必须 | MASKED_LOGIN_ID | 用户在商户网站的登录账号（商户接口未传则不返回） |
| app_id | 必须 | YOUR_APP_ID | 支付宝分配给开发者的应用 ID |
| auth_app_id | 必须 | MERCHANT_APP_ID | 支付宝分配给商户的应用 ID |
| external_agreement_no | 必须 | YOUR_EXTERNAL_AGREEMENT_NO | 代扣协议中标识用户的唯一签约号 |
| personal_product_code | 必须 | GENERAL_WITHHOLDING_P | 协议产品码 |
| valid_time | 必须 | 2017-05-20 11:49:19 | 协议实际生效时间 |
| alipay_logon_id | 必须 | MASKED_ALIPAY_LOGIN_ID | 脱敏的支付宝账号 |
| notify_type | 必须 | dut_user_sign | 用户签约成功通知类型 |
| invalid_time | 必须 | 2017-05-20 11:49:19 | 协议失效时间 |

#### 异步通知验签流程

以商户通知地址 `https://api.xx.com/receive_notify.htm` 为例：

1. **第一步**：在通知返回参数列表中，除去 `sign`、`sign_type` 两个参数外，凡是返回的参数皆是待验签参数。
2. **第二步**：将剩下参数进行 `url_decode`，然后**字典排序**，组成字符串，得到待签名字符串：

```
charset=UTF-8&notify_time=YYYY-MM-DD HH:mm:ss&external_logon_id=MASKED_LOGIN_ID&alipay_user_id=ALIPAY_USER_ID&external_agreement_no=YOUR_EXTERNAL_AGREEMENT_NO&version=1.0&sign_time=YYYY-MM-DD HH:mm:ss&notify_id=NOTIFY_ID&notify_type=dut_user_sign&agreement_no=YOUR_AGREEMENT_NO&invalid_time=YYYY-MM-DD HH:mm:ss&auth_app_id=MERCHANT_APP_ID&personal_product_code=GENERAL_WITHHOLDING_P&valid_time=YYYY-MM-DD HH:mm:ss&app_id=YOUR_APP_ID&sign_type=RSA2&sign_scene=YOUR_SIGN_SCENE&status=NORMAL&alipay_logon_id=MASKED_ALIPAY_LOGIN_ID
```

3. **第三步**：将签名参数 `sign` 使用 **base64 解码**为字节码串。
4. **第四步**：使用 `sign_type` 指定的验签方法，通过签名字符串、签名参数（经 base64 解码）及支付宝公钥验证签名。
5. **第五步**：第四步验证签名正确后，必须严格校验通知数据：
   1. 验证 `external_agreement_no` 是否为商户系统中创建的外部签约号
   2. 验证 `sign_scene` 是否为商户系统中传入的签约场景
   3. 验证 `personal_product_code` 是否为商户系统中传入的签约产品码
   4. 验证 `app_id` 是否为预期调用应用；服务商代调用时，同时结合 `auth_app_id` 和本地授权关系确认被授权商户

   > 上述 1~4 **任一校验不通过即为异常通知**，务必忽略。
6. **第六步**：签名验证通过并成功受理后，返回字符串 `success`（必须精确打印输出 7 个字符，不能执行页面跳转）。未正确响应时支付宝可能重试，具体重试策略以当前正式通知文档为准；业务侧不能依赖固定次数或固定到达时间。

#### 公共错误码

参见文末「API 公共错误码」一节。

### 1.3 协议查询

通过 [alipay.user.agreement.query](https://opendocs.alipay.com/pre-apis/00a8xf)（支付宝个人代扣协议查询接口）查询用户单笔代扣协议详情及状态。

#### 请求关键业务参数

| 参数 | 是否必填 | 说明 |
|------|:------:|------|
| alipay_user_id | 否 | 用户的支付宝账号对应唯一用户号（2088 开头 16 位纯数字） |
| personal_product_code | 否 | 协议产品码，商户代扣场景固定 `GENERAL_WITHHOLDING_P` |
| sign_scene | 否 | 签约协议场景 |
| external_agreement_no | 否 | 代扣协议中标识用户的唯一签约号，传签约时的签约号 |
| third_party_type | 否 | 签约第三方主体类型 |
| agreement_no | 否 | 支付宝系统中唯一标识用户签约记录的编号；**传了该参数，其他参数会被忽略** |

**支持的两种查询模式**：

1. **agreement_no 模式**：使用支付宝返回的协议号查询，业务参数仅需传入 `agreement_no`。
2. **personal_product_code + sign_scene + external_agreement_no 模式**：使用商户侧的签约号查询（如能获取到 `alipay_user_id` 建议一并传入，查询效率更高）。

#### 同步返回关键业务参数（code=10000 时返回）

| 参数 | 说明 |
|------|------|
| valid_time | 协议生效时间 |
| alipay_logon_id | 脱敏的支付宝账号 |
| invalid_time | 协议失效时间 |
| pricipal_type | 签约主体类型，固定 `CARD` |
| principal_id | 签约主体标识（支付宝用户 ID） |
| sign_scene | 签约协议场景 |
| agreement_no | 用户签约成功后的协议号 |
| third_party_type | 第三方主体类型，固定 `PARTNER` |
| status | 协议当前状态，**当前仅返回 `NORMAL`（正常）状态** |
| sign_time | 协议签约时间 |
| personal_product_code | 协议产品码 |
| external_agreement_no | 代扣协议中标识用户的唯一签约号 |
| external_logon_id | 外部登录 ID（商户签约时传入则返回） |

#### code 结果码

- `code=10000`：协议存在，查询成功。
- `code=40004`：参考 `sub_code` 错误码处理。

**sub_code 常见错误码**：USER_NOT_EXIST_ERROR / PRODUCT_CODE_NOT_SUPPORTED_ERROR / USER_AGREEMENT_NOT_EXIST / INVALID_PARAMETER / SYSTEM_ERROR / AUTHOREE_IS_NOT_MATCH。

---

## 二、自动续购扣款

商家在发起扣款前，需**先发送扣款预通知**（获取 `deduct_permission` 扣款许可），预通知发送后方可发起扣款。

### 2.1 发送扣款预通知

通过 [alipay.user.agreement.permission.create](https://opendocs.alipay.com/pre-apis/02smnv)（支付宝协议支付许可创建接口）获取 `deduct_permission`（商户代扣扣款许可）。

**预通知规则**：当用户的账户余额即将达到续购条件时，商家需提前发送扣款预通知，提醒用户近期即将有一笔扣款。**扣款预通知时间与实际扣款时间最多间隔 30 天**，**每一笔扣款前均需发送扣款预通知**。

> 例：用户设置的自动续购条件为「账户余额不足 100 积分时发起扣款」，商家可在该用户账户余额不足 200 积分时发送扣款预通知。

#### 请求关键业务参数

| 参数 | 是否必填 | 说明 |
|------|:------:|------|
| out_request_no | 必选 | 商户请求号，自定义 64 字符内，仅支持字母/数字/下划线且须商户端不重复 |
| agreement_no | 必选 | 支付宝系统中唯一标识用户签约记录的编号（用户签约成功后的协议号） |
| total_amount | 必选 | 订单总金额，单位：元，精确到小数点后两位，取值范围 [0.01, 100000000] |

#### 同步返回响应参数

| 参数 | 说明 |
|------|------|
| deduct_permission | 商户代扣扣款许可 |
| effective_time_start | 扣款许可生效开始时间 |
| effective_time_end | 扣款许可生效结束时间 |

#### 业务错误码

| 错误码 | 解决方案 |
|--------|---------|
| SYSTEM_ERROR | 系统异常，请稍后再试 |
| ILLEGAL_PARAMS | 确认必传参数是否为空，长度是否合法 |
| USER_AGREEMENT_NOT_EXIST | 检查协议号是否正确，或确认对应协议状态是否正确 |
| NOT_SUPPORT_MERCHANT | 产品码和商户 ID 不支持代扣许可，请联系产品添加配置 |

### 2.2 发起扣款

在用户与商户完成自动续购协议签约后，商家系统可获得代扣协议号。当用户消费后，商户可实时或非实时将代扣协议号和订单信息一起通过 [alipay.trade.pay](https://opendocs.alipay.com/pre-apis/00a98e)（统一收单交易支付接口）发送代扣支付请求，从同步返回或异步通知中获取支付结果。

**扣款规则**：

- 当扣款预通知时间与实际扣款时间间隔**超过 30 天**时，商家需**再次发送扣款预通知**才可发起扣款。
- **每一笔扣款必须与用户设置的金额完全一致**，否则不允许扣款。

> ⚠️
> - 本接口是**同步代扣接口**，商户在同步调用中直接发生扣款操作，可同步获取交易结果。
> - 针对同一个协议号，支持 **10 TPS 以下**的请求。
> - 发起扣款需传入 `out_trade_no`（商户订单号）、`subject`（订单标题）、`product_code`（销售产品码）、`agreement_no`（用户签约协议号）、`specified_pay_amount`（扣款金额）等参数。

#### 请求关键业务参数

| 参数 | 是否必填 | 说明 |
|------|:------:|------|
| out_trade_no | 是 | 商户订单号，需保证不重复 |
| subject | 是 | 订单标题 |
| product_code | 是 | 销售产品码，商户代扣场景固定 `GENERAL_WITHHOLDING` |
| total_amount | 是 | 订单总金额，单位：元，精确到两位小数，取值范围 [0.01, 100000000] |
| agreement_params | 是 | 代扣业务需传入协议相关信息 |
| timeout_express | 否 | 该笔订单允许的最晚付款时间，逾期关闭交易，取值 1m~15d |

`agreement_params`（AgreementParams）：

| 名称 | 是否必填 | 说明 |
|------|:------:|------|
| agreement_no | 必选 | 代扣协议号，对应签约时支付宝返回的协议号 |
| deduct_permission | 必选 | 商户代扣扣款许可（预通知时获取） |

#### 同步返回结果码

| 结果码 | 说明 | 处理方式 |
|--------|------|---------|
| 10000 | 支付成功 | 记录交易结果，进入后续业务处理 |
| 40004 | 支付失败 | 记录并展示错误信息（display_message） |
| 10003 | 等待用户付款 | 一般等待 5 分钟后调用 `alipay.trade.query`；查询 4 次后仍 `WAIT_BUYER_PAY`，可幂等重试代扣或调用 `alipay.trade.cancel` 撤销 |
| 20000 | 未知异常 | 一般等待 5 分钟后调用 `alipay.trade.query`；查询 4 次后仍 `WAIT_BUYER_PAY`，可幂等重试代扣或调用 `alipay.trade.cancel` 撤销 |

**sub_code 常见错误码**：USER_NOT_EXIST_ERROR / AGREEMENT_NOT_EXIST / PRODUCT_CODE_NOT_SUPPORTED_ERROR / USER_AGREEMENT_STATUS_NOT_NORMAL / INVALID_PARAMETER / SYSTEM_ERROR / AUTHOREE_IS_NOT_MATCH / MERCHANT_AGREEMENT_IS_NOT_EXIST。

#### 异步通知（以异步通知为准）

异步通知参数与统一收单交易支付（`alipay.trade.pay`）一致，关键字段：`notify_time` / `notify_type` / `notify_id` / `sign` / `trade_no` / `app_id` / `out_trade_no` / `buyer_id` / `trade_status` / `total_amount` / `gmt_payment` 等。

**交易状态**：

| trade_status | 说明 |
|--------------|------|
| WAIT_BUYER_PAY | 交易创建，等待买家付款 |
| TRADE_CLOSED | 未付款交易超时关闭，或支付完成后全额退款 |
| TRADE_SUCCESS | 交易支付成功 |
| TRADE_FINISHED | 交易结束，不可退款 |

**触发条件**：仅 `TRADE_SUCCESS` 默认触发通知（`true`）；`TRADE_FINISHED` / `WAIT_BUYER_PAY` / `TRADE_CLOSED` 默认不触发（`false`）。

**异步返回验签**（与签约通知一致）：

1. 除去 `sign`、`sign_type`，其余返回参数皆待验签。
2. 将参数 `url_decode` 后**字典排序**组成待签名字符串。
3. 将 `sign` 用 **base64 解码**为字节码串。
4. 使用 RSA/RSA2 验签方法，通过签名字符串、签名参数（base64 解码后）及支付宝公钥验证签名。
5. 严格校验：
   - `out_trade_no` 是否为商户系统中创建的订单号
   - `total_amount` 是否为该订单实际金额
   - `seller_id`（或 `seller_email`）是否为 `out_trade_no` 对应的操作方

   > 任一校验不通过即异常通知，务必忽略。只有 `trade_status` 为 `TRADE_SUCCESS` 或 `TRADE_FINISHED` 时才认定买家付款成功。
6. 验签通过后返回字符串 `success`。否则 25 小时内重发 8 次（4m、10m、10m、1h、2h、6h、15h）。该页面不能执行页面跳转。

> ℹ️
> - `TRADE_SUCCESS`：商户签约产品**支持退款**前提下，买家付款成功时触发。
> - `TRADE_FINISHED`：商户签约产品**不支持退款**前提下买家付款成功；**或**支持退款前提下交易成功且已超过可退款期限。

### 2.3 查询交易结果

通过 [alipay.trade.query](https://opendocs.alipay.com/open/07005f5c_alipay.trade.query?pathHash=aa8ed91c&scene=common)（统一收单交易查询）查询交易结果。

---

## 三、解约自动续购协议

通过 [alipay.user.agreement.unsign](https://opendocs.alipay.com/pre-apis/00a918)（支付宝个人代扣协议解约接口）解除用户的自动续购协议。**解约后商户无法使用对应协议号发起扣款**。

> ⚠️ 用户还可主动在支付宝客户端解约（无商家侧接口调用）。解约成功后支付宝将发送解约信息给商户应用在开放平台配置的**应用网关**地址。**商户需监听解约异步消息**处理用户在支付宝客户端解约的场景。用户在支付宝 APP 解约成功的异步通知参数**编码方式为 GBK**。

### 3.1 请求关键业务参数

| 参数 | 是否必填 | 说明 |
|------|:------:|------|
| alipay_user_id | 否 | 用户支付宝账号对应唯一用户号 |
| personal_product_code | 否 | 协议产品码，商户代扣场景固定 `GENERAL_WITHHOLDING_P` |
| sign_scene | 否 | 签约协议场景，传签约时指定的场景信息 |
| external_agreement_no | 否 | 代扣协议中标识用户的唯一签约号，传签约时传入的签约号 |
| third_party_type | 否 | 签约第三方主体类型 |
| agreement_no | 否 | 支付宝系统中唯一标识用户签约记录的编号；**传了该参数，其他参数会被忽略** |

**支持的两种解约模式**：

1. **agreement_no 模式**：使用支付宝返回的协议号解约，业务参数仅需传 `agreement_no`。
2. **personal_product_code + sign_scene + external_agreement_no + alipay_user_id 模式**：使用商户侧的协议号解约。

### 3.2 同步返回结果码

- `code=10000`：解约成功。
- `code=40004` 且 `sub_code=AGREEMENT_NOT_EXIST`：当前协议已是解约状态（幂等）。
- 其他场景：参考错误码列表处理。

**sub_code 常见错误码**：USER_NOT_EXIST_ERROR / AGREEMENT_NOT_EXIST / PRODUCT_CODE_NOT_SUPPORTED_ERROR / USER_AGREEMENT_STATUS_NOT_NORMAL / INVALID_PARAMETER / SYSTEM_ERROR / AUTHOREE_IS_NOT_MATCH / MERCHANT_AGREEMENT_IS_NOT_EXIST。

### 3.3 异步通知（解约通知）

商户可在接口公共参数传 `notify_url`，或在开放平台设置解约回调地址（优先使用传入的 `notify_url`；未传则发往应用网关地址）。

#### 关键业务参数

| 名称 | 说明 |
|------|------|
| app_id | 支付宝分配给开发者的应用 ID |
| auth_app_id | 支付宝分配给商户的应用 ID |
| alipay_logon_id | 脱敏的支付宝账号 |
| agreement_no | 支付宝系统中唯一标识用户签约记录的编号 |
| alipay_user_id | 用户签约的支付宝账号对应唯一用户号 |
| notify_type | 用户解约成功通知类型，固定 `dut_user_unsign` |
| external_agreement_no | 代扣协议中标识用户的唯一签约号 |
| external_logon_id | 用户在商户网站的登录账号（商户接口未传则不返回） |
| personal_product_code | 协议产品码，如 `GENERAL_WITHHOLDING_P` |
| sign_scene | 当前签约的协议场景 |
| status | 协议解约状态：`UNSIGN` |
| unsign_time | 协议实际解约时间（yyyy-MM-dd HH:mm:ss） |
| credit_auth_mode | 授信模式，`DEDUCT_HUAZHI` 代表花芝代扣（仅花芝代扣时透出） |

---

## 四、变更自动续购协议

当用户修改自动续购条件或金额时，商家通过**新协议签约 + 旧协议解约**完成变更操作。具体签约/解约方式参照第一节、第三节。

---

## 📚 API 公共错误码

支付宝网关对接口非业务调用错误统一处理，返回码如下。服务商权限不足问题参考 [ISV 权限不足常见问题及解决办法](https://opendocs.alipay.com/open/common/isverror)。

| code | msg | sub_code | sub_msg | 解决方案 |
|------|-----|----------|---------|---------|
| 10000 | 接口调用成功 | — | — | 调用结果参考具体 API 业务返回参数 |
| 20000 | 服务不可用 | isp.unknow-error | 服务暂不可用（业务系统不可用） | 稍后重试 |
| | | aop.unknow-error | 服务暂不可用（网关自身未知错误） | 稍后重试 |
| 20001 | 授权权限不足 | aop.invalid-auth-token | 无效的访问令牌 | 刷新授权令牌或重新授权 |
| | | aop.auth-token-time-out | 访问令牌已过期 | 刷新授权令牌或重新授权 |
| | | aop.invalid-app-auth-token | 无效的应用授权令牌 | 刷新应用授权令牌或重新授权 |
| | | aop.invalid-app-auth-token-no-api | 商户未授权当前接口 | 重新授权获取新的应用授权令牌 |
| | | aop.app-auth-token-time-out | 应用授权令牌已过期 | 刷新应用授权令牌或重新授权 |
| | | aop.no-product-reg-by-partner | 商家未签约任何产品 | 服务商代理调用场景，请上线商家的服务窗 |
| 40001 | 缺少必选参数 | isv.missing-method | 缺少方法名参数 | 请求参数必须含 method |
| | | isv.missing-signature | 缺少签名参数 | 缺少 sign |
| | | isv.missing-signature-type | 缺少签名类型参数 | 缺少 sign_type |
| | | isv.missing-signature-key | 缺少签名配置 | 未上传公钥配置 |
| | | isv.missing-app-id | 缺少 appId 参数 | 缺少 app_id |
| | | isv.missing-timestamp | 缺少时间戳参数 | 缺少 timestamp |
| | | isv.missing-version | 缺少版本参数 | 缺少 version |
| | | isv.decryption-error-missing-encrypt-type | 解密出错，未指定加密算法 | 缺少 encrypt_type |
| 40002 | 非法的参数 | isv.invalid-parameter | 参数无效 | 格式不对、非法值、越界等 |
| | | isv.upload-fail | 文件上传失败 | 文件写入失败，重试 |
| | | isv.invalid-file-extension | 文件扩展名无效 | 支持 csv/txt/zip/rar/gz/doc/docx/xls/xlsx/pdf/bmp/gif/jpg/jpeg/png |
| | | isv.invalid-file-size | 文件大小无效 | 最大 50MB |
| | | isv.invalid-method | 不存在的方法名 | 检查 method |
| | | isv.invalid-format | 无效的数据格式 | 只支持 JSON/XML |
| | | isv.invalid-signature-type | 无效的签名类型 | 只支持 RSA/RSA2/HMAC_SHA1 |
| | | isv.invalid-signature | 无效签名 | 公私钥是否一对 / 公钥匹配 / 中文需 urlencode / 签名算法 |
| | | isv.invalid-token | 无效令牌 | auth_token 无效 |
| | | isv.invalid-encrypt-type | 无效的加密类型 | 只支持 AES |
| | | isv.invalid-encrypt | 解密异常 | 重试 |
| | | isv.invalid-app-id | 无效的 appId 参数 | app_id 不存在或未上线 |
| | | isv.invalid-timestamp | 非法的时间戳参数 | 格式需为 yyyy-MM-dd HH:mm:ss |
| | | isv.invalid-charset | 字符集错误 | 支持 GBK/UTF-8 |
| | | isv.invalid-digest | 摘要错误 | 文件摘要参数必填 |
| | | isv.decryption-error-not-valid-encrypt-type | 解密出错，不支持的加密算法 | 只支持 AES |
| | | isv.decryption-error-not-valid-encrypt-key | 解密出错，未配置加密密钥或格式错误 | 未配置加密密钥 |
| | | isv.decryption-error-unknown | 解密出错，未知异常 | 重试 |
| | | isv.missing-signature-config | 验签出错，未配置对应签名算法的公钥或证书 | 未配置应用公钥 |
| | | isv.not-support-app-auth | 本接口不支持第三方代理调用 | 不支持第三方代理调用 |
| | | isv.suspected-attack | 可疑的攻击请求 | 更换相应参数名称，避免 value 中出现支付宝关键 key |
| | | isv.forbidden-api | 接口被禁用 | 查看接口说明 |
| | | app-cert-expired | 应用公钥证书已不在有效期内 | [证书到期更新指南](https://opendocs.alipay.com/common/02kdnh) |
| | | not-online-app | 应用未上线 | 在控制台上线应用后调用 |
| | | app-openid-not-match | appid 和 openid 不匹配 | 确认 openid 归属该应用 |
| | | openid-uid-not-match | openid 和 uid 不匹配 | 确认关联是否正确 |
| | | invalid-openid | openid 参数值非法 | 确认 openid 来源于支付宝 |
| | | isv.illegal-json | 不正确的 JSON 格式 | 检查参数内容 |
| 40003 | 条件异常 | invalid-auth-relations | 无效的授权关系 | 用户是否已授权相关接口和 scope |
| | | isv.missing-signature-config | 验签出错，未配置对应签名算法的公钥或证书 | [验签出错处理](https://opendocs.alipay.com/support/01ravq) |
| 40004 | 业务处理失败 | 对应业务错误码 | — | 明细错误码和解决方案参见具体 API 说明 |
| | 非法的参数 | unsupported-sdk-version | 不支持的 SDK 版本 | 升级到最新版 SDK，参考 [SDK 说明](https://opendocs.alipay.com/common/02mvn0?pathHash=473d19a0) |
| 40005 | 调用频次超限 | isv.app-call-limited | 应用调用次数超限 | 降低请求并发量 |
| | | isv.method-call-limited | API 调用次数超限 | 降低请求并发量 |
| 40006 | 权限不足 | isv.insufficient-isv-permissions | ISV 权限不足 | 检查账户是否有当前接口权限，[产品绑定](https://opendocs.alipay.com/open/200/105310/) |
| | | isv.insufficient-user-permissions | 用户权限不足 | [协助商家](https://opendocs.alipay.com/mini/isv/zdfy7u)开通产品 |
| | | isv.self-invoke-forbidden | 此用户不允许自调用 | [解决方案](https://opendocs.alipay.com/support/01rax7) |

### SPI 错误码

调用 SPI 时，外部商户响应报文统一错误码只有两种：

| code | msg | sub_code | 说明 |
|------|-----|----------|------|
| 10000 | Success | — | 接口调用成功，参考具体 SPI 文档 |
| 40004 | Business Failed | 对应业务错误码 | 明细参见具体 SPI 文档 |

---

## 🔗 接口速查

| 能力 | 接口 |
|------|------|
| 发起签约 | [alipay.user.agreement.page.sign](https://opendocs.alipay.com/pre-apis/00a8xl) |
| 协议查询 | [alipay.user.agreement.query](https://opendocs.alipay.com/pre-apis/00a8xf) |
| 扣款预通知（创建扣款许可） | [alipay.user.agreement.permission.create](https://opendocs.alipay.com/pre-apis/02smnv) |
| 发起扣款 | [alipay.trade.pay](https://opendocs.alipay.com/pre-apis/00a98e) |
| 查询交易结果 | alipay.trade.query |
| 撤销交易 | alipay.trade.cancel |
| 解约协议 | [alipay.user.agreement.unsign](https://opendocs.alipay.com/pre-apis/00a918) |

> 💡 **与订阅产品的区别**：自动续购基于**代扣协议（user.agreement）**，扣款时商家需**先调 `permission.create` 获取 `deduct_permission`**，再凭 `agreement_no` + `deduct_permission` 调 `alipay.trade.pay`；而本文档主体描述的订阅产品（trade.subscription）则通过 `alipay.trade.subscription.create/pay` 体系扣款。两者**不可混用**，请按签约的产品码选择对应链路。
