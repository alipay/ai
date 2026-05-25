# alipay-payment-integration

Language/语言: English | [简体中文](#中文文档)

Alipay Open Platform Payment Integration Skill — Best practices for integrating Alipay payment products, providing AI agents with full-scenario payment integration guidance, sandbox environment setup, SDK integration reminders, and troubleshooting support.

---

## Features

- **Full-Scenario Payment Products** — Covers Face-to-Face Payment, Order Code Payment, APP Payment, JSAPI Payment, Mobile Website Payment, PC Website Payment, Pre-Auth Payment, Merchant Deduct, and AI Payment Collection
- **Smart Product Decision** — Recommends the most suitable payment product based on business scenario and keywords
- **Sandbox Environment** — One-click sandbox creation via CLI, with validation and security reminders
- **SDK Integration Reminders** — Built-in SDK guidance covering import methods, private key format, page redirect APIs, and common pitfalls
- **Code Examples** — Complete code examples for 5 languages (Java, Python, Node.js, PHP, C#) across all payment products
- **Integration Checklist** — Security and compliance verification checklist for pre-launch review
- **Troubleshooting** — Error code lookup and common issue solutions, including dedicated `invalid-signature` diagnosis

---

## Supported Payment Products

| Payment Product | Core API | Scenario |
|----------------|----------|----------|
| Face-to-Face Payment | `alipay.trade.pay` | Offline stores, user shows payment code for merchant to scan |
| Order Code Payment | `alipay.trade.precreate` | Merchant shows QR code, user scans to pay |
| Mobile Website Payment | `alipay.trade.wap.pay` | Mobile browser H5 page payment |
| PC Website Payment | `alipay.trade.page.pay` | PC browser web page payment |
| JSAPI Payment | `alipay.trade.create` + `my.tradePay` | Payment within Alipay mini-program |
| APP Payment | `alipay.trade.app.pay` | Native iOS, Android, and HarmonyOS APP payment |
| Pre-Auth Payment | `alipay.fund.auth.order.app.freeze` | Deposit, fund freezing, pay-after-use |
| Merchant Deduct | `alipay.trade.app.pay` + `alipay.trade.pay` | Membership subscription, auto-renewal, periodic deduction |
| AI Payment Collection | `alipay.aipay.agent.payment.verify` + `alipay.aipay.agent.fulfillment.confirm` | Agent-based payment, 402 payment required scenario |

---

## Integration Flow

### Payment Product Integration (Feature 1)

| Step | Description | Key Actions |
|------|-------------|-------------|
| 1.1 Product Decision | Match user scenario to payment product | Read product decision tree, confirm with user |
| 1.2a Sandbox Setup | Create sandbox environment (traditional payment products) | CLI tool for Unix/macOS/Linux; manual setup for Windows |
| 1.2b AI Payment Config | Initialize with production config (AI Payment Collection only) | Guide user through merchant onboarding and config setup |
| 1.3 Pre-Integration | Read SDK docs and product docs | SDK reminders, integration specs, code examples |
| 1.4 Code Integration | Generate integration code | Self-check 8 items before outputting code |
| 1.5 Post-Integration | Security red lines and next steps | Print security rules and environment guidance |
| 1.6 Integration Verification | Checklist-based verification | Verify signature, async notification, error handling, etc. |

### Troubleshooting (Feature 2)

| Step | Description |
|------|-------------|
| 2.1 Issue Identification | Classify by error code or problem description |
| 2.2 Error Code Lookup | Search public error codes, then product-specific error codes |
| 2.3 Common Issues | Match solutions from product FAQ docs; dedicated `invalid-signature` diagnosis flow |

---

## Project Structure

```
alipay-payment-integration/
├── SKILL.md                                    # Skill main file with trigger conditions and execution steps
├── README.md                                   # This file
└── references/
    ├── main/
    │   ├── product-decision.md                 # Product decision tree and scenario matching rules
    │   ├── checklist.md                        # Integration verification checklist
    │   └── alipay-sdk-reminder.md              # SDK integration reminders and common pitfalls
    ├── alipay-sandbox/
    │   ├── sandbox-setup-guide.md              # Sandbox environment setup and validation guide
    │   ├── alipay-sandbox-tool.md              # Sandbox CLI tool usage
    │   └── EXAMPLES.md                         # Sandbox API response examples
    └── code-examples/
        ├── interface-guide.md                  # API and code example index
        ├── java/                               # Java code examples
        ├── python/                             # Python code examples
        ├── nodejs/                             # Node.js code examples
        ├── php/                                # PHP code examples
        └── csharp/                             # C# code examples
```

---

## Sandbox Environment

| Environment | Gateway URL | Description |
|-------------|-------------|-------------|
| Sandbox | `https://openapi-sandbox.dl.alipaydev.com/gateway.do` | Testing; no product activation required |
| Production | `https://openapi.alipay.com/gateway.do` | Production; product activation required |

Sandbox CLI supports Unix/macOS/Linux. Windows users need to manually obtain sandbox credentials from the Alipay Open Platform console.

> **Note**: AI Payment Collection does not support sandbox environment. Users must use production credentials obtained after merchant onboarding.

---

## Code Examples

Code examples cover 5 languages and 10 product categories:

| Language | Directory | Products Covered |
|----------|-----------|-----------------|
| Java | `references/code-examples/java/` | All 10 categories |
| Python | `references/code-examples/python/` | Common APIs, Face-to-Face, Order Code, Mobile Web, PC Web, APP, AI Payment |
| Node.js | `references/code-examples/nodejs/` | Common APIs, Face-to-Face, Order Code, Mobile Web, PC Web, APP, Pre-Auth, Merchant Deduct, AI Payment |
| PHP | `references/code-examples/php/` | All 10 categories |
| C# | `references/code-examples/csharp/` | All 10 categories |

Product categories: `1_通用接口` (Common APIs), `2_当面付`, `3_订单码支付`, `4_手机网站支付`, `5_电脑网站支付`, `6_JSAPI支付`, `7_APP支付`, `8_预授权支付`, `9_商家扣款`, `10_AI收`

---

## Security Red Lines

> The following rules are security red lines for Alipay payment integration and must be strictly followed:

- **Private key must not be stored in client** — Signing must be done on the merchant server; private keys are strictly prohibited in APP clients
- **Private key must not appear in logs** — Private keys must not be logged
- **Private key must not be uploaded to public repositories** — Private keys must not be uploaded to GitHub, GitLab, etc.
- **Frontend payment results are not trustworthy** — Must rely on async notifications or query API results
- **Do not request re-payment before confirmation** — Must confirm payment result before requesting another payment
- **Verify async notification signatures first** — Must verify signatures upon receiving async notifications

---

## Prerequisites

- AI agent framework supporting AgentSkills (e.g., Claude Code)
- Ability to execute `curl` commands to access Alipay online documentation
- Unix/macOS/Linux recommended for sandbox CLI support

---

## Installation

```bash
# Claude Code
cp -r alipay-payment-integration ~/.claude/skills/

# Custom setups
cp -r alipay-payment-integration /path/to/your/skills/
```

The Skill is **automatically triggered** when discussing Alipay payment integration topics. You can also manually activate it with `/alipay-payment-integration`.

---

## Disclaimer

- This Skill provides guidance on Alipay payment product integration and troubleshooting
- Developers should review AI-generated integration code and independently verify the logic
- Conduct thorough testing before launch to ensure applicability and accuracy
- Content is compiled from Alipay Open Platform official documentation; refer to official documentation for updates

---

## Support

For issues not covered in this documentation:

1. Check [Alipay Open Platform Online Documentation](https://open.alipay.com?form=payskill)
2. Consult [Alipay Technical Support](https://opensupport.alipay.com/support/intelligent-services?form=payskill)

---

# 中文文档

支付宝开放平台支付产品接入最佳实践 Skill — 为 AI 智能体提供全场景支付集成指引、沙箱环境搭建、SDK 集成提醒与问题排查支持。

---

## 功能特性

- **全场景支付产品** — 覆盖当面付、订单码支付、APP 支付、JSAPI 支付、手机网站支付、电脑网站支付、预授权支付、商家扣款、AI 收
- **智能产品决策** — 根据业务场景和关键词自动推荐最适合的支付产品
- **沙箱环境** — 通过 CLI 一键创建沙箱环境，含校验与安全提醒
- **SDK 集成提醒** — 内置 SDK 引入方式、私钥格式、页面跳转方法及常见陷阱指引
- **代码示例** — 覆盖 5 种语言（Java、Python、Node.js、PHP、C#）的全产品代码示例
- **集成校验清单** — 上线前的安全与合规校验清单
- **问题排查** — 错误码查询与常见问题解决方案，含 `invalid-signature` 专项排查流程

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
| 商家扣款 | `alipay.trade.app.pay` + `alipay.trade.pay` | 会员订阅、连续包月、周期扣款 |
| AI 收 | `alipay.aipay.agent.payment.verify` + `alipay.aipay.agent.fulfillment.confirm` | 面向 Agent 的支付解决方案，基于 402 协议收款 |

---

## 集成流程

### 支付产品集成（功能一）

| 步骤 | 说明 | 关键动作 |
|------|------|----------|
| 1.1 产品决策 | 根据用户场景匹配支付产品 | 阅读产品决策树，与用户确认 |
| 1.2a 沙箱环境 | 创建沙箱环境（传统收单产品） | Unix/macOS/Linux 使用 CLI 工具；Windows 需手动获取 |
| 1.2b AI 收配置 | 使用正式配置初始化（仅 AI 收产品） | 引导用户完成商户入驻并配置正式参数 |
| 1.3 集成前置 | 阅读 SDK 说明与产品文档 | SDK 提醒、接入规范、代码示例 |
| 1.4 集成代码 | 生成集成代码 | 输出代码前须通过 8 项自检 |
| 1.5 集成后说明 | 安全红线与后续指引 | 打印安全规则和环境说明 |
| 1.6 集成校验 | 按清单逐项校验 | 验签、异步通知、异常处理等 |

### 问题排查（功能二）

| 步骤 | 说明 |
|------|------|
| 2.1 问题识别 | 根据错误码或问题描述分类 |
| 2.2 错误码排查 | 先查公共错误码，再查产品业务错误码 |
| 2.3 常见问题 | 匹配产品常见问题文档；含 `invalid-signature` 专项排查流程 |

---

## 项目结构

```
alipay-payment-integration/
├── SKILL.md                                    # Skill 主文件，包含触发条件和执行步骤
├── README.md                                   # 本文件
└── references/
    ├── main/
    │   ├── product-decision.md                 # 产品决策树和场景匹配规则
    │   ├── checklist.md                        # 集成校验清单
    │   └── alipay-sdk-reminder.md              # SDK 集成提醒与常见陷阱
    ├── alipay-sandbox/
    │   ├── sandbox-setup-guide.md              # 沙箱环境搭建与校验指引
    │   ├── alipay-sandbox-tool.md              # 沙箱 CLI 工具使用说明
    │   └── EXAMPLES.md                         # 沙箱 API 返回示例
    └── code-examples/
        ├── interface-guide.md                  # 接口与代码示例索引
        ├── java/                               # Java 代码示例
        ├── python/                             # Python 代码示例
        ├── nodejs/                             # Node.js 代码示例
        ├── php/                                # PHP 代码示例
        └── csharp/                             # C# 代码示例
```

---

## 沙箱环境

| 环境 | 网关地址 | 说明 |
|------|----------|------|
| 沙箱环境 | `https://openapi-sandbox.dl.alipaydev.com/gateway.do` | 测试阶段使用，无需开通产品 |
| 正式环境 | `https://openapi.alipay.com/gateway.do` | 生产环境，需申请开通产品 |

沙箱 CLI 支持 Unix/macOS/Linux 系统。Windows 用户需前往支付宝开放平台控制台手动获取沙箱信息。

> **注意**：AI 收产品暂不支持沙箱环境，需使用入驻后取得的正式配置完成初始化。

---

## 代码示例

代码示例覆盖 5 种语言、10 个产品类别：

| 语言 | 目录 | 覆盖产品 |
|------|------|----------|
| Java | `references/code-examples/java/` | 全部 10 个类别 |
| Python | `references/code-examples/python/` | 通用接口、当面付、订单码、手机网站、电脑网站、APP、AI 收 |
| Node.js | `references/code-examples/nodejs/` | 通用接口、当面付、订单码、手机网站、电脑网站、APP、预授权、商家扣款、AI 收 |
| PHP | `references/code-examples/php/` | 全部 10 个类别 |
| C# | `references/code-examples/csharp/` | 全部 10 个类别 |

产品类别：`1_通用接口`、`2_当面付`、`3_订单码支付`、`4_手机网站支付`、`5_电脑网站支付`、`6_JSAPI支付`、`7_APP支付`、`8_预授权支付`、`9_商家扣款`、`10_AI收`

---

## 安全红线

> 以下规则为支付宝支付接入的安全红线，必须严格遵守：

- **私钥禁止存储在客户端** — 签名必须在商家服务端完成，私钥严禁保存在 APP 客户端
- **私钥不得出现在任何日志中** — 私钥禁止被记录在日志系统中
- **私钥不得上传到公共仓库** — 私钥禁止上传到 GitHub、GitLab 等公共代码仓库
- **前台支付结果不可信** — 必须以异步通知或查询接口结果为准
- **未确认不重付** — 在未确认支付结果前，不得要求用户再次付款
- **异步通知必须先验签** — 收到异步通知后必须先验签

---

## 环境要求

- 支持 AgentSkills 的 AI 智能体框架（如 Claude Code）
- 能够执行 `curl` 命令以访问支付宝在线文档
- 推荐使用 Unix/macOS/Linux 系统以支持沙箱 CLI

---

## 安装使用

```bash
# Claude Code
cp -r alipay-payment-integration ~/.claude/skills/

# 自定义配置
cp -r alipay-payment-integration /path/to/your/skills/
```

当用户讨论支付宝支付集成相关话题时，Skill 将**自动触发**。也可通过 `/alipay-payment-integration` 手动激活。

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
