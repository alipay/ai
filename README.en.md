# 支付宝 AI 付

[简体中文](README.md) | English

**Payment capabilities for AI applications and agents.**

This repository provides official Agent Skills, integration guides, and code examples for 支付宝 AI 付. It helps developers accept payments in websites, native apps, API services, and subscription products, and supports agent payment and wallet authorization workflows.

Describe your business requirements in natural language to let an AI agent assist with product selection, integration preparation, code changes, and troubleshooting.

[Official website](https://aipay.alipay.com/) · [Products and documentation](https://aipay.alipay.com/llms.txt) · [Skills overview](skills/README.md) · [PIBench](https://github.com/inclusionAI/PIBench)

The Skills overview and detailed skill documentation are currently primarily in Chinese.

## Products and capabilities

支付宝 AI 付 provides payment capabilities for different application types and charging models. The `alipay-aipay` skill is the main entry point for merchants and developers.

| Capability | Use cases | Support in this repository |
|---|---|---|
| **Payment acceptance for AI web apps** · Vibe Pay basic payments | Order payments on websites and mobile web applications | Product selection, onboarding workflows, integration, and troubleshooting |
| **Payment acceptance for native mobile apps** · Vibe Pay basic payments | Order payments within native apps | Onboarding workflows, merchant server integration, and client integration documentation |
| **Usage-based payments** · Machine Pay | Charging for API calls, content, computing resources, or other usage | Seller-side HTTP 402 payment flows, onboarding, integration, and verification |
| **Recurring subscriptions** · Token Pay | Recurring charges for memberships, plans, and team seats | Integration documentation, code guidance, and troubleshooting for subscriptions and related capabilities |

Token Pay documentation also covers condition-based automatic repurchases, one-time commercial orders, B2B payments, electronic invoices, and business verification. See the [capability guide](skills/alipay-aipay/references/product-decision.md) for the supported scope.

Product eligibility follows the applicable official onboarding process. The current skill provides onboarding guidance for Token Pay merchants. Native mobile app integration focuses on the merchant server; the application developer completes the client SDK integration.

## Related payment capabilities

This repository also includes skills for:

- **Agent payments**: processing Alipay checkout, order, and HTTP 402 payments, and querying actual payment results.
- **Wallet authorization**: setting up, checking, and managing Alipay AI wallet authorization.
- **Delegation integration**: helping developers implement payment workflows within limits authorized by the user.
- **Alipay 企业码 integration**: coordinating employee and enterprise management, expense controls, billing, and optional capabilities for one business expense scenario at a time.

See the [Skills overview](skills/README.md) for use cases, prerequisites, and examples.

## Installation and use

### Prerequisites

- An AI agent that supports local Agent Skills.
- Node.js, npm, and npx for npm-based installation. Check the selected package for its version requirements.
- The file, terminal, or MCP tool access required by the selected workflow.
- Merchant applications, product permissions, and authorization materials as required by the task.

### Install the 支付宝 AI 付 integration skill

For product selection, merchant onboarding, payment acceptance integration, and troubleshooting:

```bash
npx -y @alipay/alipay-aipay@latest install
```

This installs `alipay-aipay`. See the [installation and update documentation](skills/alipay-aipay/references/normal/self-update.md) for details.

### Install agent payment and wallet authorization skills

For Alipay payments and standalone wallet authorization management:

```bash
npx -y @alipay/agent-payment@latest install
```

This installs the payment and wallet skills with their supporting CLI. See [alipay/payment-skills](https://github.com/alipay/payment-skills) for details.

### Manually install Delegation or 企业码 skills

Clone the repository:

```bash
git clone https://github.com/alipay/ai.git
```

Copy or import the complete directory for the skill you need into the user-level Skills directory supported by your agent:

- `skills/alipay-delegation-pay`
- `skills/alipay-enterprise-scenario-integration`

Keep all files and subdirectories, including `SKILL.md`, reference documents, scripts, and bundled dependencies. Follow your agent's documentation for the installation location and reload procedure.

The 企业码 skill requires Node.js and the `unzip` command. It prepares its required child skills during execution. See the [企业码 documentation](skills/alipay-enterprise-scenario-integration/README.md).

### Usage notes

After installation, load the skills using your agent's supported mechanism and describe the business task you want to complete. Each skill documents its prerequisites and supported operations.

## Skills directory

| Skill | Purpose |
|---|---|
| [`alipay-aipay`](skills/alipay-aipay/SKILL.md) | Product selection, onboarding, payment acceptance integration, and troubleshooting for 支付宝 AI 付 |
| [`alipay-payment-skill`](skills/alipay-payment-skill/SKILL.md) | Alipay order, checkout, and HTTP 402 payment handling |
| [`alipay-authenticate-wallet`](skills/alipay-authenticate-wallet/SKILL.md) | AI wallet setup, authorization, status queries, and authorization management |
| [`alipay-delegation-pay`](skills/alipay-delegation-pay/SKILL.md) | Delegation payment development and integration |
| [`alipay-enterprise-scenario-integration`](skills/alipay-enterprise-scenario-integration/README.md) | Integration planning and implementation for a single Alipay 企业码 expense scenario |

See the [Skills overview](skills/README.md) for selection guidance and expected results.

## Code examples

| Example | Contents |
|---|---|
| [HTTP 402 payment acceptance](code_example/aipay-402-example/) | Paid resource requests, payment information, payment proof verification, and resource delivery |
| [Web payments with agent handoff](code_example/page-pay-demo-with-agentpay/README.md) | Node.js web payments, transaction queries, asynchronous notifications, and agent payment handoff |

Refer to each example for its configuration and runtime requirements.

## Benchmark

[Alipay-PIBench](https://github.com/inclusionAI/PIBench) is a payment integration benchmark introduced by Alipay to evaluate AI coding agents on realistic project-level integration tasks.

It includes nine payment product projects and 18 task instances covering functional integration and payment security hardening. The benchmark assesses functional correctness, reliability, security, and business-state consistency, with evaluation tasks, execution tools, and reproduction instructions.

[View the project](https://github.com/inclusionAI/PIBench) · [Read the paper](https://arxiv.org/abs/2607.14573)

## Updates and sources

Each skill follows its own installation and release process:

- **支付宝 AI 付 integration**: installed through the official npm installer, with version checks and automatic updates.
- **Agent payments and wallet authorization**: maintained in the standalone [alipay/payment-skills](https://github.com/alipay/payment-skills) repository. Refer to that repository and its installer for installation and release information.
- **Delegation integration**: obtain the updated directory from this repository and update it using your agent's supported mechanism.
- **企业码 integration**: can check GitHub for newer versions and notify the user. Updates remain a user decision. See its [version documentation](skills/alipay-enterprise-scenario-integration/README.md#版本检查).

Refer to the [official website](https://aipay.alipay.com/) for product information and eligibility requirements.

## Feedback

Report issues through [GitHub Issues](https://github.com/alipay/ai/issues).

To help us investigate, include:

- The skill, installation method, and version.
- Your agent, operating system, and relevant runtime environment.
- Reproduction steps, expected behavior, and actual behavior.
- Error messages or logs with sensitive information removed.
