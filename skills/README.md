# 支付宝 AI 付 Skills

[返回仓库首页](../README.md) · [安装说明](../README.md#安装使用) · [支付宝 AI 付官网](https://aipay.alipay.com/)

本目录汇集支付宝 AI 付及相关支付能力的 Agent Skills，覆盖商家收款接入、智能体付款、钱包授权、委托支付开发和企业码场景接入。

根据需要完成的任务选择对应 Skill。每个 Skill 提供任务指引、参考资料，以及执行相关流程所需的工具或脚本。

## 选择适合的 Skill

| 你的需求 | 对应 Skill |
|---|---|
| 为网站、App、API 或订阅产品接入收款，或咨询产品、开通与接口问题 | [`alipay-aipay`](alipay-aipay/SKILL.md) |
| 处理已有支付宝订单、收银台或 HTTP 402 付款 | [`alipay-payment-skill`](alipay-payment-skill/SKILL.md) |
| 独立申请、查询或管理 AI 钱包授权 | [`alipay-authenticate-wallet`](alipay-authenticate-wallet/SKILL.md) |
| 开发用户授权后的委托支付流程 | [`alipay-delegation-pay`](alipay-delegation-pay/SKILL.md) |
| 接入企业码的某个费用场景 | [`alipay-enterprise-scenario-integration`](alipay-enterprise-scenario-integration/README.md) |

## 支付宝 AI 付接入

**Skill：`alipay-aipay`**

面向商家与开发者，协助完成支付宝 AI 付产品选型、开通准备、工程集成、接口答疑和排障。

### 适用需求

- 网站、电脑网页或手机 H5 的订单收款。
- 原生 App 收款的商家服务端接入。
- API、内容或算力服务的卖方 HTTP 402 收款。
- Token Pay 周期订阅及相关业务能力接入。

Token Pay 资料还覆盖条件自动续购、商业订单单笔支付、企业支付 B2B、数电发票和企业认证，详见[产品能力说明](alipay-aipay/references/product-decision.md)。

### 典型提问

> 帮我给这个 Next.js 网站接入支付宝网页收款。请先检查现有项目，说明需要哪些开通条件和配置，再完成接入并说明验证结果。

### 预期交付

根据任务提供产品建议、准备清单、接入方案、项目代码修改或排障结论，并说明已完成和仍待验证的内容。

### 使用条件与范围

通过官方 npm 安装器安装，具体运行依赖按任务准备。商家开通需满足对应产品条件；Token Pay 商家开通目前提供办理指引。

AI 移动应用收款默认覆盖商家服务端，客户端 SDK 由接入方对接。买方订单付款由支付处理 Skill 承接。

[查看 Skill](alipay-aipay/SKILL.md) · [查看支持范围](alipay-aipay/references/product-decision.md)

## 智能体付款

**Skill：`alipay-payment-skill`**

处理支付宝收银台、已有订单和 HTTP 402 付款，并支持沿原支付流程查询结果及反馈问题。

### 适用需求

- 根据支付宝收银台或订单材料发起付款流程。
- 为调用付费资源处理 HTTP 402 付款。
- 查询当前支付结果。
- 按流程反馈支付问题。

### 典型提问

> 帮我处理这个支付宝收银台订单的付款，并在我完成操作后查询支付结果。

### 预期交付

返回付款入口、待完成操作或实际查询到的支付状态。支付结果以对应工具和服务端的真实返回为准。

### 使用条件与范围

需要有效的支付材料及相应工具能力。支持的操作优先使用宿主可用的支付宝 MCP；CLI 路径使用 `alipay-bot`，并需要宿主提供当前会话标识。

商家收款工程开发由 `alipay-aipay` 承接。已有支付继续沿原入口查询，避免在不同入口之间重复发起付款。

[查看 Skill](alipay-payment-skill/SKILL.md) · [独立仓库与安装说明](https://github.com/alipay/payment-skills)

## 钱包开通与授权

**Skill：`alipay-authenticate-wallet`**

处理支付宝 AI 钱包的独立开通、授权、状态查询及授权管理。

### 适用需求

- 申请开通 AI 钱包。
- 按当前流程提交开通口令或授权材料。
- 查询开通和授权状态。
- 获取关闭或管理现有授权的入口。

### 典型提问

> 查询我当前的支付宝 AI 钱包开通和授权状态。

### 预期交付

返回实际查询到的钱包状态；办理类任务提供对应操作入口，并在用户完成支付宝侧操作后核对结果。

### 使用条件与范围

与支付处理 Skill 共用官方安装器，钱包操作通过 `alipay-bot` 执行。

查询授权状态是只读操作，不会自动发起开通。正在进行中的订单或 HTTP 402 付款继续由支付处理 Skill 承接；支付流程明确转交钱包处理时，再进入本 Skill。

[查看 Skill](alipay-authenticate-wallet/SKILL.md) · [独立仓库与安装说明](https://github.com/alipay/payment-skills)

## 委托支付接入

**Skill：`alipay-delegation-pay`**

帮助开发者为智能体应用接入委托支付，使应用能够在用户授权范围内执行后续支付。

### 适用需求

- 委托签约及授权结果处理。
- 委托任务查询与取消。
- 商户预下单与委托支付接口集成。
- 支付通知、状态处理与幂等设计。

### 典型提问

> 帮我在现有服务中接入支付宝委托支付，覆盖签约、查询、取消、预下单和授权范围内扣款，并列出接入前需要完成的准备。

### 预期交付

提供接口衔接方案、实现参考和验证指引，明确关键标识、授权条件及支付状态处理方式。

### 使用条件与范围

实际接口开发需要支付宝应用、签名配置、相关产品权限和对应开发环境。当前接入资料注明委托支付存在邀测开通条件，请先核对[接入准备](alipay-delegation-pay/references/00-接入准备.md)。

本 Skill 面向支付能力开发。代买、抢票或监控购买等业务逻辑由接入方应用实现。

[查看 Skill](alipay-delegation-pay/SKILL.md) · [接入准备](alipay-delegation-pay/references/00-接入准备.md)

## 企业码场景接入

**Skill：`alipay-enterprise-scenario-integration`**

围绕一个企业费用场景，组织员企、费控和账单三个基础领域，并按场景选择发票等扩展能力。

### 适用需求

- 设计企业码单个费用场景的接入方案。
- 在新项目中生成相关接入代码。
- 为已有项目规划并实施增量接入。
- 检查基础领域和已选扩展能力之间的集成一致性。

### 典型提问

> 帮我在现有项目中接入企业码地铁费用场景，先梳理员企、费控和账单需求，并明确是否需要接入发票。

### 预期交付

提供单场景接入方案或代码，说明基础领域与已选扩展能力的接入情况；生成代码后执行相应校验，并说明结果。

### 使用条件与范围

每次处理一个费用场景。需要 Node.js、`unzip` 命令，以及向用户级 Skills 目录安装子 Skills 的权限。

运行时会准备员企、费控和账单三个基础子 Skills；发票等扩展按已确认的需求准备。地铁场景需要明确是否接入发票。

生产凭据、业务持久化、上线配置和真实联调验收由接入方完成。

[查看使用说明](alipay-enterprise-scenario-integration/README.md) · [查看 Skill](alipay-enterprise-scenario-integration/SKILL.md)

## 相近需求如何区分

- **API 按调用收款与 HTTP 402 付款**：为自己的服务收费，选择 `alipay-aipay`；为调用他人的付费资源付款，选择 `alipay-payment-skill`。
- **钱包授权与订单续查**：独立管理钱包时选择 `alipay-authenticate-wallet`；已有订单继续沿原支付流程处理。
- **委托支付开发与订单付款**：接入委托支付接口时选择 `alipay-delegation-pay`；处理已有订单付款时选择 `alipay-payment-skill`。
- **企业支付 B2B 与企业码场景**：企业收银、对公转账等 Token Pay 能力由 `alipay-aipay` 承接；围绕员企、费控和账单组织费用场景时，选择企业码 Skill。

## 安装、更新与反馈

- 安装方式见[仓库安装说明](../README.md#安装使用)。
- 更新机制见[更新与来源](../README.md#更新与来源)。
- 使用问题可通过 [GitHub Issues](https://github.com/alipay/ai/issues) 反馈，请附 Skill 名称、版本、运行环境、复现步骤和脱敏后的报错信息。

本页用于选型与导航。具体执行流程、依赖加载和结果判断以各 Skill 的 `SKILL.md` 及其引用文档为准。
