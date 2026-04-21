# alipay-payment-integration

Language|语言: English|[简体中文](#中文文档)

Alipay Open Platform Payment Integration Skill - Best practices for integrating Alipay payment products, providing AI agents with full-scenario payment integration capabilities and troubleshooting guidance.

---

## Features

- **Full-Scenario Payment Product Support** - Covers Face-to-Face Payment, Order Code Payment, APP Payment, JSAPI Payment, Mobile Website Payment, PC Website Payment, Pre-Auth Payment, Merchant Debit, and all Alipay full-scenario payment products
- **Smart Product Decision** - Automatically recommends the most suitable payment product based on business scenario
- **Security Compliance Verification** - Built-in security red lines and verification checklist to ensure compliant integration
- **Troubleshooting Guidance** - Provides error code lookup and common issue solutions

---

## Supported Payment Products

| Payment Product | Core API | Scenario |
|----------------|----------|----------|
| Face-to-Face Payment | `alipay.trade.pay` | Offline stores, user shows payment code for merchant to scan |
| Order Code Payment | `alipay.trade.precreate` | Merchant shows QR code, user scans to pay |
| Mobile Website Payment | `alipay.trade.wap.pay` | Mobile browser H5 page payment |
| PC Website Payment | `alipay.trade.page.pay` | PC browser web page payment |
| JSAPI Payment | `alipay.trade.create` + `my.tradePay` | Payment within Alipay mini-program |
| APP Payment | `alipay.trade.app.pay` | Native iOS, Android, and Harmony APP payment |
| Pre-Auth Payment | `alipay.fund.auth.order.app.freeze` | Deposit, fund freezing, pay-after-use |
| Merchant Debit | `alipay.trade.app.pay` + `alipay.trade.pay` | Membership subscription, auto-renewal, continuous billing |

---

## Prerequisites

- Anthropic Claude or other AI frameworks supporting AgentSkills
- Ability to execute `curl` commands to access the Alipay Open Platform documentation

---

## Installation

### Step 1: Copy Skill Directory

Copy the entire Skill folder to your AI agent's skills directory:

```bash
# For OpenClaw
cp -r alipay-payment-integration ~/.openclaw/workspace/skills/

# For Claude Code
cp -r alipay-payment-integration ~/.claude/skills/

# For custom setups
cp -r alipay-payment-integration /path/to/your/skills/
```

### Step 2: Verify Installation

Ensure the required files are in place:

```bash
ls -la ~/.claude/skills/alipay-payment-integration/
# Expected output: SKILL.md, references/
```

### Step 3: Start Using

The Skill will be **automatically triggered** when discussing Alipay payment integration topics. You can also **manually activate** this Skill using:
- `/alipay-payment-integration`
- "load alipay-payment-integration Skill"

#### Trigger Keywords

| Category | Keywords |
|----------|----------|
| General Integration | "Integrate Alipay", "Payment integration", "Alipay SDK", "Access Alipay" |
| Payment Products | "Face-to-Face", "Order Code", "APP Payment", "JSAPI", "H5 Payment", "PC Payment", "Pre-Auth", "Merchant Debit", "Subscription", "Auto-renewal" |
| Troubleshooting | "Error code", "Async notification", "Signature verification", "Callback failed", "Payment failed", "Trade status" |

#### Example Usage

```
User: "How do I integrate Alipay payment for my e-commerce app?"
→ Skill auto-triggers and provides step-by-step integration guidance

User: "I got error ACQ.TRADE_HAS_SUCCESS when calling alipay.trade.pay"
→ Skill auto-triggers and provides troubleshooting steps

User: "What's the difference between Face-to-Face and Order Code payment?"
→ Skill auto-triggers and explains product differences with scenario recommendations
```

---

## Quick Start

### Payment Product Integration

When integrating Alipay payment, the AI will automatically trigger this Skill and provide integration guidance following the process below:

1. **Product Decision**: Recommend the most suitable payment product based on business scenario
2. **Documentation Review**: Automatically fetch and read corresponding product documentation (SDK selection, signature method, integration specifications, API list, etc.)
3. **Integration Verification**: Conduct security and compliance checks according to the [Integration Checklist](references/checklist.md)

### Troubleshooting

When encountering payment integration issues:

1. **Issue Identification**: Determine issue type based on error code or problem description
2. **Error Code Lookup**: Query public error codes or business error codes documentation
3. **Common Issue Matching**: Match solutions from corresponding product's common issues documentation

---

## Project Structure

```
alipay-payment-integration/
├── SKILL.md                      # Skill main file with trigger conditions and execution steps
├── references/
│   ├── product-decision.md       # Product decision tree and scenario matching rules
│   └── checklist.md              # Payment integration verification checklist
└── README.md                     # This file
```

---

## Documentation Access

All Alipay payment documentation in this Skill is available as **online dynamic links**. Accessed recursively via `curl` during use:

```bash
# Fetch main documentation
curl -sL "https://ideservice.alipay.com/cms/site/0izcu3"

# Recursively access sub-links (product intro, integration prep, API docs, etc.)
curl -sL "https://ideservice.alipay.com/cms/site/0izal0"
curl -sL "https://ideservice.alipay.com/cms/site/0izal1"
```

Documentation contains the latest API parameters, code examples, and notes. Always use online documentation to ensure accuracy.

---

## Security Red Lines

> ⛔ The following rules are **Security Red Lines** for Alipay payment integration and must be strictly followed:

- **Private Key Must Not Be Stored in Client**: Signing must be completed on the merchant server; private keys are strictly prohibited from being stored in APP clients
- **Private Key Must Not Be Logged**: Private keys must not appear in any logs
- **Private Key Must Not Be Uploaded to Public Repositories**: Private keys must not be uploaded to GitHub, GitLab, or other public code repositories
- **Frontend Payment Results Are Not Trustworthy**: Must rely on async notifications or query API results
- **Do Not Request Re-payment Before Confirmation**: Do not require users to pay again before confirming payment results
- **Verify Async Notification Signatures First**: Must verify signatures after receiving async notifications

---

## Verification Checklist

After integration is complete, please check each item according to the [Integration Checklist](references/checklist.md)

---

## Integration Environments

| Environment | Gateway URL | Description |
|-------------|-------------|-------------|
| Sandbox | `https://openapi-sandbox.dl.alipaydev.com/gateway.do` | Use during testing; no product activation required |
| Production | `https://openapi.alipay.com/gateway.do` | Production environment; product activation required |

---

## Disclaimer

- This Skill provides guidance on Alipay payment product integration and troubleshooting
- Developers should review AI-generated integration code and independently verify the logic
- Conduct thorough testing before launch to ensure applicability and accuracy
- Content is compiled from Alipay Open Platform official documentation; refer to official documentation for updates

---

## Support

For issues not covered in this documentation, please:

1. Check [Alipay Open Platform Online Documentation](https://open.alipay.com?form=payskill)
2. Consult [Alipay Technical Support](https://opensupport.alipay.com/support/intelligent-services?form=payskill)

---

# 中文文档

支付宝开放平台支付产品接入最佳实践 Skill，为 AI 智能体提供全场景支付集成能力与问题排查指引。

---

## 功能特性

- **全场景支付产品支持** - 覆盖当面付、订单码支付、APP 支付、JSAPI 支付、手机网站支付、电脑网站支付、预授权支付、商家扣款等支付宝全场景支付产品
- **智能产品决策** - 根据业务场景自动推荐最适合的支付产品方案
- **安全合规校验** - 内置支付集成安全红线与校验清单，保障接入合规性
- **问题排查指引** - 提供错误码查询与常见问题解决方案

---

## 支持的支付产品

| 支付产品 | 核心 API | 适用场景 |
|----------|----------|----------|
| 当面付 | `alipay.trade.pay` | 线下门店，用户出示付款码商家扫码 |
| 订单码支付 | `alipay.trade.precreate` | 商家出示二维码，用户扫码支付 |
| 手机网站支付 | `alipay.trade.wap.pay` | 手机浏览器 H5 页面支付 |
| 电脑网站支付 | `alipay.trade.page.pay` | 电脑浏览器网页支付 |
| JSAPI 支付 | `alipay.trade.create` + `my.tradePay` | 支付宝小程序内支付 |
| APP 支付 | `alipay.trade.app.pay` | 原生 iOS、Android、鸿蒙 APP 支付 |
| 预授权支付 | `alipay.fund.auth.order.app.freeze` | 押金、资金冻结、先享后付 |
| 商家扣款 | `alipay.trade.app.pay` + `alipay.trade.pay` | 会员订阅、连续包月、自动续费 |

---

## 环境要求

- Anthropic Claude 或其他支持 AgentSkills 的 AI 框架
- 能够执行 `curl` 命令以访问支付宝开放平台文档

---

## 安装使用

### 步骤 1：复制 Skill 目录

将整个 Skill 文件夹复制到你的 AI 智能体 skills 目录：

```bash
# OpenClaw
cp -r alipay-payment-integration ~/.openclaw/workspace/skills/

# Claude Code
cp -r alipay-payment-integration ~/.claude/skills/

# 自定义配置
cp -r alipay-payment-integration /path/to/your/skills/
```

### 步骤 2：验证安装

确认所需文件已就位：

```bash
ls -la ~/.claude/skills/alipay-payment-integration/
# 期望输出：SKILL.md, references/
```

### 步骤 3：开始使用

当用户讨论支付宝支付集成相关话题时，Skill 将**自动触发**。用户也可以通过以下方式**手动激活**此 Skill：
- `/alipay-payment-integration`
- "请加载 alipay-payment-integration Skill"

#### 触发关键词

| 类别 | 关键词 |
|------|--------|
| 通用集成 | "接入支付宝"、"集成支付"、"支付宝 SDK"、"对接支付" |
| 支付产品 | "当面付"、"订单码"、"APP 支付"、"JSAPI"、"H5 支付"、"PC 支付"、"预授权"、"商家扣款"、"订阅"、"自动续费" |
| 问题排查 | "错误码"、"异步通知"、"验签"、"回调失败"、"支付失败"、"交易状态" |

#### 使用示例

```
用户："我想在电商 App 里接入支付宝支付，怎么做？"
→ Skill 自动触发，提供分步集成指引

用户："调用 alipay.trade.pay 时报错 ACQ.TRADE_HAS_SUCCESS 怎么办？"
→ Skill 自动触发，提供排查步骤

用户："当面付和订单码支付有什么区别？"
→ Skill 自动触发，解释产品差异并推荐适用场景
```

---

## 快速开始

### 支付产品集成

当需要集成支付宝支付时，AI 会自动触发此 Skill，按照以下流程提供集成指引：

1. **产品决策**：根据业务场景推荐最适合的支付产品
2. **文档阅读**：自动获取并阅读对应的产品文档（SDK 选择、加签方式、接入规范、接口列表等）
3. **集成校验**：按照[集成校验清单](references/checklist.md)进行安全与合规性检查

### 问题排查

当遇到支付集成问题时：

1. **问题识别**：根据错误码或问题描述判断问题类型
2. **错误码排查**：查询公共错误码或业务错误码文档
3. **常见问题匹配**：匹配对应产品的常见问题解决方案

---

## 项目结构

```
alipay-payment-integration/
├── SKILL.md                      # Skill 主文件，包含触发条件和执行步骤
├── references/
│   ├── product-decision.md       # 产品决策树和场景匹配规则
│   └── checklist.md              # 支付集成校验清单
└── README.md                     # 本文件
```

---

## 文档访问规范

本 Skill 中引用的支付宝文档均为**在线动态链接**，使用时通过 `curl` 递归访问：

```bash
# 获取主文档
curl -sL "https://ideservice.alipay.com/cms/site/0izcu3"

# 递归访问子链接（产品介绍、接入准备、接口文档等）
curl -sL "https://ideservice.alipay.com/cms/site/0izal0"
curl -sL "https://ideservice.alipay.com/cms/site/0izal1"
```

文档内包含最新的接口参数、代码示例和注意事项，务必使用在线文档确保信息准确性。

---

## 安全红线

> ⛔ 以下规则为支付宝支付接入的**安全红线**，必须严格遵守：

- **私钥禁止存储在客户端**：签名必须在商家服务端完成，私钥严禁保存在 APP 客户端
- **私钥不得出现在任何日志中**：私钥禁止被记录在日志系统中
- **私钥不得上传到公共仓库**：私钥禁止上传到 GitHub、GitLab 等公共代码仓库
- **前台支付结果不可信**：必须以异步通知或查询接口结果为准
- **未确认不重付**：在未确认支付结果前，不得要求用户再次付款
- **异步通知必须先验签**：收到异步通知后必须先验签

---

## 校验清单

集成完成后，请按照[集成校验清单](references/checklist.md)逐项核对

---

## 集成环境

| 环境 | 网关地址 | 说明 |
|------|----------|------|
| 沙箱环境 | `https://openapi-sandbox.dl.alipaydev.com/gateway.do` | 测试阶段使用，无需开通产品 |
| 正式环境 | `https://openapi.alipay.com/gateway.do` | 生产环境，需申请开通产品 |

---

## 声明

- 本 Skill 提供支付宝支付产品集成指引和问题排查指导
- 请开发人员审查 AI 生成的接入代码，自行确认代码逻辑
- 上线前请充分测试确保其适用性与准确性
- 本文档内容整理自支付宝开放平台官方文档，如有更新请以官方文档为准

---

## 技术支持

如遇到本文档未涵盖的问题，请：

1. 查阅 [支付宝开放平台在线文档](https://open.alipay.com?form=payskill)
2. 咨询 [支付宝技术支持](https://opensupport.alipay.com/support/intelligent-services?form=payskill)