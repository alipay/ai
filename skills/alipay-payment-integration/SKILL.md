---
name: alipay-payment-integration
description: >-
  支付宝开放平台支付产品接入最佳实践。涵盖当面付、订单码支付、App 支付、JSAPI 支付、手机网站支付、电脑网站支付、预授权支付、商家扣款等全场景产品选型与集成指导。
  当用户提到"接入支付宝"、"集成支付宝支付"、"对接支付"、"支付宝收款"、"加个支付功能"、"支付宝下单"、"H5 支付"、"小程序支付"、"预授权"、"付款码"、"扫码支付"、"网页支付"、"PC 支付"、"周期扣款"、"自动续费"、"会员订阅"、"连续包月"、"代扣"时，或咨询支付产品相关报错、排查问题时使用此 Skill。
---

# 支付宝支付集成 Skill

## 前置说明
1. 本 Skill 主要提供支付宝支付产品集成指引和集成问题排查指引。
2. 请开发人员审查 AI 生成的接入代码，自行确认代码逻辑，上线前充分测试确保其适用性与准确性。

### 文档访问规范

所有支付宝支付产品的文档地址均为**在线动态链接**，务必使用 curl 获取在线文档内容：

```bash
# 示例：获取当面付文档
curl -sL "https://ideservice.alipay.com/cms/site/0izcu3"
```

#### 递归访问

文档页面内包含的链接需要递归访问以获取完整内容。访问流程：

1. 首先访问主文档 URL。
2. 解析文档中的链接（产品介绍、接入准备、接口文档等）。
3. 递归访问这些链接获取详细内容。

```bash
# 访问当面付子链接示例
curl -sL "https://ideservice.alipay.com/cms/site/0izal0"   # 产品介绍
curl -sL "https://ideservice.alipay.com/cms/site/0izal1"   # 接入准备
```

---

## 功能一：支付产品集成指引

**触发条件**：用户需要集成支付宝支付产品。

### 步骤 1.1 产品决策

阅读 [产品决策](references/product-decision.md)，根据用户输入匹配关键词，决策支付产品。当用户描述模糊时，使用 [澄清话术模板](references/product-decision.md) 进行产品确认。

### 步骤 1.2 获取集成文档

接入前必须阅读下列文档：
- **SDK 选择**：为了帮助开发者调用开放接口，支付宝提供了开放平台服务端 SDK，包含 Java、PHP、Node.js、Python 和 .NET 五种语言，封装了签名与验签、HTTP 接口请求等基础功能。请先下载对应语言版本的最新版服务端 SDK 并引入开发工程。[下载地址](https://ideservice.alipay.com/cms/site/0j0cjj)
- **加签方式**：签名请使用 RSA2。[加签说明](https://ideservice.alipay.com/cms/site/0j3u72)
- **接入规范与常见陷阱**：[接入规范](https://ideservice.alipay.com/cms/site/0j0kl2)
- **产品文档**：根据用户的产品集成诉求，访问 **产品文档路由** 中对应的产品文档。阅读产品文档中的快速接入、接口列表、异步通知说明、注意事项等部分，根据用户集成诉求尽可能多地收集信息。

> ⛔ **阻塞检查点**：步骤 1.2 完成标准（下列事项必须全部满足才能继续执行后续步骤）
- [ ] 已读取 SDK 选择
- [ ] 已读取 加签方式
- [ ] 已读取 接入规范与常见陷阱
- [ ] 已读取 产品文档（必须递归阅读项：快速接入、接口列表、异步通知说明）

#### 集成环境说明

- 建议开发者在测试阶段优先使用**沙箱环境**。
- **沙箱环境**：地址：`https://openapi-sandbox.dl.alipaydev.com/gateway.do` 详见：[沙箱环境说明](https://ideservice.alipay.com/cms/site/0j3egl)
- **正式环境**：地址：`https://openapi.alipay.com/gateway.do`

### 步骤 1.3 集成校验

- 在集成过程中及发布上线前按照 [集成校验清单](references/checklist.md) 进行校验，确保签名验签、异步通知、异常处理等符合规范。校验结果供参考，开发者务必按照支付宝最新开放平台文档进行检查。

#### 安全红线

> ⛔ 以下规则为支付宝支付接入的**安全红线**，违反可能导致资金损失或安全事故，必须严格遵守，产品集成过程中务必提醒开发者注意以下安全事项。

- **私钥禁止存客户端**：构造交易数据并签名必须在商家服务端完成，私钥严禁保存在商家 APP 客户端中。
- **私钥禁止记日志**：私钥不得出现在任何日志中。
- **私钥禁止传公共仓库**：私钥不得上传到 GitHub、GitLab 等公共代码仓库。
- **前台支付结果不可信**：前台同步跳转结果不可信，必须以支付宝异步通知或调用交易查询接口获取结果为准。
- **未确认不重付**：在未确认支付结果前，不得要求用户再次付款，必须先通过异步通知或查询接口确认支付结果。
- **异步通知必须先验签**：收到异步通知后必须先验签，确保通知来自支付宝。

---

## 功能二：集成问题排查指引

**触发条件**：用户在集成支付宝支付产品过程中遇到报错或其他问题。

> ⚠️ **支付产品信息确认（必须遵守）**：执行下述问题排查步骤之前，必须明确用户当前集成的**支付产品**，否则暂停输出并要求用户澄清，**严禁**在支付产品信息缺失时尝试查阅文档或猜测支付产品。

### 步骤 2.1 问题识别与分流

根据用户输入判断问题类型，分流到对应排查路径：

```
用户问题
    |
    +-- 有明确错误码（如 "ACQ.TRADE_HAS_SUCCESS"、"INVALID_PARAMETER"）
    |       |
    |       └───> 步骤 2.2 错误码排查
    |
    +-- 无明确错误码（如流程疑问、功能异常等）
            |
            └───> 步骤 2.3 常见问题排查
```

### 步骤 2.2 错误码排查

**适用**：用户提供了明确的错误码。

> ⚠️ **报错接口信息确认（必须完成）**：错误码查询前，必须确认发生报错的**接口信息**，否则暂停输出并要求用户澄清，**严禁**在报错接口信息缺失时尝试查阅文档或猜测报错接口。

#### 排查流程

1. **查公共错误码**：查阅 [公共错误码说明](https://ideservice.alipay.com/cms/site/02km9f)，根据用户提供的错误码检索相关内容。如有匹配结果，**输出排查结论**；否则，**查业务错误码**。

2. **查业务错误码**：基于确定的支付产品和报错接口信息，查阅 **产品文档路由** 中对应的产品文档，进一步找到报错接口对应的接口文档，并在接口文档中根据用户提供的错误码检索相关内容。

3. **输出排查结论**：根据查询到的错误码关联内容，输出排查结论。

### 步骤 2.3 常见问题排查

**适用**：无明确错误码的其他类型问题。

#### 排查流程

1. 根据用户输入和确定的支付产品，查阅对应的产品**常见问题文档**，匹配问题解决方案，回答用户问题时，**务必**以支付宝文档为准。

2. 若根据支付产品**常见问题文档**未找到解决方案，引导用户查阅 [开放平台在线文档](https://open.alipay.com?form=payskill) 或咨询 [支付宝技术支持](https://opensupport.alipay.com/support/intelligent-services?form=payskill)，**严禁**编造常见问题文档以外的解决方案。

#### 常见问题文档索引

| 产品类别 | 常见问题文档 |
| --- | --- |
| 当面付 | [当面付常见问题](https://ideservice.alipay.com/cms/site/0j3j50) |
| 订单码支付 | [订单码支付常见问题](https://ideservice.alipay.com/cms/site/0j3mpk) |
| APP 支付 | [APP 支付常见问题](https://ideservice.alipay.com/cms/site/0j3pih) |
| 电脑网站支付 | [电脑网站支付常见问题](https://ideservice.alipay.com/cms/site/0j3kh1) |
| 手机网站支付 | [手机网站支付常见问题](https://ideservice.alipay.com/cms/site/0j3pig) |
| 商家扣款 | [商家扣款常见问题](https://ideservice.alipay.com/cms/site/0j3j51) |
| 预授权支付 | [预授权支付常见问题](https://ideservice.alipay.com/cms/site/0j3qcq) |
| JSAPI 支付 | [JSAPI 支付常见问题](https://ideservice.alipay.com/cms/site/0j3pii) |

## 产品文档路由

根据用户的业务场景，路由到对应的产品文档：

| 支付产品 | 核心 API | 在线文档 |
| --- | --- | --- |
| 当面付 | `alipay.trade.pay` | [当面付文档](https://ideservice.alipay.com/cms/site/0izcu3) |
| 订单码支付 | `alipay.trade.precreate` | [订单码支付文档](https://ideservice.alipay.com/cms/site/0izg0z) |
| 手机网站支付 | `alipay.trade.wap.pay` | [手机网站支付文档](https://ideservice.alipay.com/cms/site/0izne3) |
| 电脑网站支付 | `alipay.trade.page.pay` | [电脑网站支付文档](https://ideservice.alipay.com/cms/site/0iztfv) |
| JSAPI 支付 | `alipay.trade.create` + `my.tradePay` | [JSAPI 支付文档](https://ideservice.alipay.com/cms/site/0izg0f) |
| App 支付 | `alipay.trade.app.pay` | [App 支付文档](https://ideservice.alipay.com/cms/site/0izsn4) |
| 预授权支付 | `alipay.fund.auth.order.app.freeze` | [预授权支付文档](https://ideservice.alipay.com/cms/site/0j0lyx) |
| 商家扣款 | `alipay.trade.app.pay`（支付并签约）+ `alipay.trade.pay`（后续扣款） | [商家扣款文档](https://ideservice.alipay.com/cms/site/0j0g6k) |

**注意**：回答任何接入问题或编写代码前，先通过 curl 阅读上表中对应的在线文档链接。文档内包含最新的接口参数、代码示例和注意事项。