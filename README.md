# 支付宝 AI 付

简体中文 | [English](README.en.md)

**面向 AI 应用与智能体的支付能力。**

本仓库提供支付宝 AI 付的官方 Agent Skills、接入指南与开发示例，帮助开发者为网站、App、API 服务和订阅产品接入支付能力，并支持智能体付款与钱包授权等场景。

通过 Agent Skills，你可以使用自然语言描述业务需求，由 AI Agent 协助完成产品选型、接入准备、代码集成和问题排查。

[支付宝 AI 付官网](https://aipay.alipay.com/) · [产品与文档](https://aipay.alipay.com/llms.txt) · [Skills 总览](skills/README.md) · [PIBench](https://github.com/inclusionAI/PIBench)

## 产品与能力

支付宝 AI 付为不同应用形态和收费模式提供支付能力。本仓库中的 `alipay-aipay` 是商家与开发者接入的主要入口。

| 产品能力 | 适用场景 | 本仓库提供的支持 |
|---|---|---|
| **AI 网页应用收款** · Vibe Pay 基础收款 | 网站、电脑网页和手机 H5 的订单收款 | 产品选型、开通流程、工程接入与排障 |
| **AI 移动应用收款** · Vibe Pay 基础收款 | 原生 App 内的订单收款 | 开通流程、商家服务端接入及客户端对接资料 |
| **AI 按量付费** · Machine Pay | API、内容、算力等服务按调用或使用量收费 | 卖方 HTTP 402 收款方案、开通流程、工程接入与验证 |
| **AI 连续订阅** · Token Pay | 会员、套餐和团队席位的持续收费 | 周期订阅、续费与相关能力的接入资料、代码指引和排障 |

Token Pay 相关资料还覆盖条件自动续购、商业订单单笔支付、企业支付 B2B、数电发票和企业认证，具体支持范围见[产品能力说明](skills/alipay-aipay/references/product-decision.md)。

产品开通条件以对应官方流程为准。当前 Skill 对 Token Pay 商家开通提供办理指引；AI 移动应用收款默认交付商家服务端集成，App 客户端 SDK 由接入方完成对接。

## 相关支付能力

本仓库同时提供以下 Skills：

- **智能体付款**：处理支付宝收银台、订单及 HTTP 402 付款，并查询实际支付结果。
- **钱包授权**：申请开通、查询和管理支付宝 AI 钱包授权。
- **委托支付接入**：帮助开发者实现用户授权范围内的委托支付流程。
- **企业码场景接入**：围绕单个费用场景，组织员企、费控、账单及按需扩展能力。

各 Skill 的适用需求、使用条件和典型示例见 [Skills 总览](skills/README.md)。

## 安装使用

### 环境准备

- 使用支持本地 Agent Skills 的 AI Agent。
- 使用 npm 安装入口时，需要可用的 Node.js、npm 和 npx，版本要求以对应安装包为准。
- 执行自动化接入或支付流程时，需要 Agent 具备相应的文件、终端或 MCP 工具能力。
- 商家应用、产品权限和授权材料按所选任务准备。

### 安装支付宝 AI 付接入 Skill

用于产品选型、商家开通、收款集成与排障：

```bash
npx -y @alipay/alipay-aipay@latest install
```

该入口安装 `alipay-aipay`，具体安装与更新机制见[安装和更新说明](skills/alipay-aipay/references/normal/self-update.md)。

### 安装智能体付款与钱包授权 Skills

用于支付宝付款和独立钱包授权管理：

```bash
npx -y @alipay/agent-payment@latest install
```

该入口安装支付、钱包相关 Skills 及配套 CLI。详细说明见 [alipay/payment-skills](https://github.com/alipay/payment-skills)。

### 手动安装委托支付或企业码 Skill

获取仓库：

```bash
git clone https://github.com/alipay/ai.git
```

根据需要，将下列完整目录复制或导入所用 Agent 支持的用户级 Skills 目录：

- `skills/alipay-delegation-pay`
- `skills/alipay-enterprise-scenario-integration`

保留目录内的全部文件和子目录，包括 `SKILL.md`、参考资料、脚本及依赖包。具体安装位置和重新加载方式以所用 Agent 的说明为准。

企业码 Skill 需要 Node.js 和 `unzip` 命令，并会在运行时准备所需的子 Skills，详见[企业码使用说明](skills/alipay-enterprise-scenario-integration/README.md)。

### 使用说明

安装完成后，按所用 Agent 的方式加载 Skills，并描述需要完成的业务任务。适用条件和操作范围由对应 Skill 说明。

## Skills 导航

| Skill | 用途 |
|---|---|
| [`alipay-aipay`](skills/alipay-aipay/SKILL.md) | 支付宝 AI 付产品选型、开通、收款集成与排障 |
| [`alipay-payment-skill`](skills/alipay-payment-skill/SKILL.md) | 支付宝订单、收银台和 HTTP 402 付款处理 |
| [`alipay-authenticate-wallet`](skills/alipay-authenticate-wallet/SKILL.md) | AI 钱包开通、授权、状态查询与授权管理 |
| [`alipay-delegation-pay`](skills/alipay-delegation-pay/SKILL.md) | 委托支付能力开发与接入 |
| [`alipay-enterprise-scenario-integration`](skills/alipay-enterprise-scenario-integration/README.md) | 企业码单个费用场景的方案设计与接入 |

查看 [Skills 总览](skills/README.md)，了解如何选择及预期交付。

## 开发示例

| 示例 | 内容 |
|---|---|
| [HTTP 402 收款示例](code_example/aipay-402-example/) | 付费资源请求、付款信息返回、支付凭证校验与资源交付 |
| [网页支付与 Agent 接管示例](code_example/page-pay-demo-with-agentpay/README.md) | Node.js 网页支付、交易查询、异步通知及 Agent 付款衔接 |

运行条件和配置方式见各示例中的说明。

## 评测基准

[Alipay-PIBench](https://github.com/inclusionAI/PIBench) 是由支付宝提出的支付集成评测基准，用于评估 AI Coding Agent 在真实项目中完成支付接入任务的能力。

基准包含 9 个支付产品项目和 18 个任务实例，覆盖基础功能集成与支付安全强化，从功能正确性、可靠性、安全性和业务状态一致性等维度评估接入质量，并提供评测任务、运行工具和复现说明。

[查看项目](https://github.com/inclusionAI/PIBench) · [阅读论文](https://arxiv.org/abs/2607.14573)

## 更新与来源

各 Skill 按自身的安装和发布方式维护：

- **支付宝 AI 付接入**：通过官方 npm 安装器安装，包含版本检查与自更新机制。
- **智能体付款与钱包授权**：独立仓库为 [alipay/payment-skills](https://github.com/alipay/payment-skills)，安装与发布说明以该仓库及配套安装包为准。
- **委托支付接入**：从本仓库获取新版目录，按所用 Agent 的方式更新。
- **企业码场景接入**：可检查并提示 GitHub 新版本，更新由用户决定，详见其[版本说明](skills/alipay-enterprise-scenario-integration/README.md#版本检查)。

产品介绍与接入条件可通过[支付宝 AI 付官网](https://aipay.alipay.com/)核对。

## 问题反馈

使用中遇到问题，欢迎通过 [GitHub Issues](https://github.com/alipay/ai/issues) 反馈。

为便于定位，请提供：

- 使用的 Skill、安装方式及版本；
- Agent、操作系统和相关运行环境；
- 复现步骤、预期结果与实际结果；
- 脱敏后的报错信息或日志。
