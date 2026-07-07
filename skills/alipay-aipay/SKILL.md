---
name: alipay-aipay
description: >-
  支付宝AI支付站点官方 Skill。当用户选择按量付费、网站支付、APP支付进行集成、签约入驻或全流程同时完成两者时，使用此 Skill。
  触发关键词："AI支付"、"接支付宝"、"接个支付"、"402收款"、"按量付费"、"快捷收款"、"快捷收单"、"网站支付"、"APP支付"、"商家入驻"、"签约入驻"等。
---

# 支付宝 AI 支付 SKILL

---

## ⚠️ 支持产品范围

本 SKILL 仅支持：按量付费、网站支付、APP支付三种产品。不支持当面付、订单码支付、JSAPI支付、预授权支付、商家扣款等产品，如需集成请前往[支付宝开放平台](https://open.alipay.com/)查阅相关文档，如需签约请前往[支付宝商家平台](https://b.alipay.com/page/portal/home)完成签约。

**产品术语口径：**
- **网站支付**是本 Skill 唯一的网页支付产品概念，覆盖电脑网页和手机浏览器网页/H5 场景；用户说“电脑网站支付”“PC网站支付”“PC网页支付”“手机网站支付”“H5支付”时，均按本 Skill 的**网站支付**处理。
- 集成侧网站支付底层接口固定使用 `alipay.trade.page.pay`；即使是手机浏览器/H5 场景，也不得改用或推荐其他网页支付接口。
- 签约侧网站支付使用 `productType=webpay`、`salesCode=I1080300001000041203`，签约 payload 中的应用类型字段为 `PC_WEB`；这里的 `PC_WEB` 是接口字段名，不代表只能用于 PC 端网页。

**❌ 严禁行为**：禁止将明确不支持的产品（如用户明确说"当面付"、"付款码"等）强行往按量付费、网站支付、APP支付上引导，必须明确告知不支持并引导至外部平台。

## 🚨 执行铁律

### 禁止行为

1. **禁止跳过流程**：必须严格按 flow.md 步骤顺序执行，禁止跳步或直接写代码
2. **禁止跳过阻塞确认**：在 `<BLOCKING_CONFIRMATION>` 处必须等待用户明确回复
3. **禁止合理化跳过确认**：不允许用"用户催促"等理由跳过阻塞确认
4. **禁止假数据**：沙箱配置必须用真实数据，禁止占位符
5. **沙箱化 Agent 联网命令权限**：在存在网络沙箱或命令审批机制的 Agent 环境中，`alipay-cli` 登录、MCP 调用、文件上传、沙箱创建、安装脚本下载等命令应按联网命令处理；若当前工具支持显式网络授权，应首次执行即申请可联网权限，详见 `references/normal/alipay-cli-env.md`
6. **禁止无依据回答**：遇到没有确定依据的问题，必须明确说明无法确认，不得编造。具体额度解限、可收款时间解限、支付产品签约不确定问题，引导用户前往[支付宝商家平台](https://b.alipay.com/page/portal/home)咨询客服；代码集成、应用创建相关不确定问题，引导用户前往[支付宝开放平台](https://open.alipay.com/)或[支付宝技术支持](https://opensupport.alipay.com/support/intelligent-services?form=payskill)咨询客服

### 执行流程（通用）

```
用户输入 → 加载 references/integration/flow.md 或 references/onboarding/flow.md → 输出待办步骤清单 → 等待确认 → 逐步执行
```

**产品推荐入口：**
- 集成场景：读取 `references/integration/modules/product-decision.md` 做支付产品推荐与澄清。
- 签约/入驻场景：读取 `references/onboarding/flow.md` 的 Step 2“方案规划”做产品匹配与推荐。

#### 集成流程（7步 / 网站支付和APP支付跳过步骤5，共6步）
- 步骤1：产品决策 → **[阻塞确认]**
- 步骤2：沙箱初始化 → 阅读 sandbox-setup-guide.md → 创建环境
- 步骤3：集成前置 → 阅读 SDK 文档 + 产品文档
- 步骤4：代码生成
- 步骤5：按量付费沙箱测试（仅按量付费产品）
- 步骤6：集成后说明
- 步骤7：集成校验 → **[阻塞确认]**

#### 签约流程（6步）
- 步骤1：环境检查
- 步骤2：方案规划
- 步骤3：登录授权
- 步骤4：资料采集
- 步骤5：入驻推进
- 步骤6：流程结束

---

## 目录结构

```
alipay-aipay/
├── SKILL.md                    # 主控中枢，Agent 入口
└── references/
    ├── normal/                 # 通用文档（集成 + 签约共用）
    │   ├── alipay-cli-env.md   # alipay-cli 检测与安装
    │   ├── rejection-guide.md  # 不支持产品的拒绝引导话术
    │   └── scripts/            # 通用脚本
    │       ├── common.sh           # shell 公共函数与初始化入口
    │       └── detect_dev_tool.sh  # AI 编程工具检测
    ├── integration/            # 支付集成子流程
    │   ├── flow.md             # 集成流程主入口（含问题排查）
    │   └── modules/
    │       ├── product-decision.md     # 产品决策树（含澄清话术）
    │       ├── alipay-sdk-reminder.md  # SDK 防坑指南，必读
    │       ├── interface-guide.md      # 接口索引 + 代码示例路径
    │       ├── checklist.md            # 集成校验清单
    │       ├── sandbox/                     # 沙箱环境
    │       │   ├── sandbox-setup-guide.md   # 沙箱配置指南
    │       │   ├── alipay-sandbox-tool.md   # 沙箱工具使用
    │       │   └── a2m-sandbox-test.md      # 按量付费沙箱测试
    │       ├── scripts/                     # 集成流程脚本
    │       │   └── local_402_sandbox_pay.py # 402沙箱收银测试脚本
    │       └── code-examples/          # 代码示例（csharp / java / nodejs / php / python）
    └── onboarding/             # 商家签约子流程
        ├── flow.md             # 签约流程主入口，含内存状态管理
        └── modules/
            ├── error-handling.md       # 统一错误检测入口
            ├── mcc-reference.md        # MCC 类目表，禁止 LLM 自编 mccCode
            ├── authorization.md        # 登录授权
            ├── product-sign.md         # 产品签约
            ├── service-registration.md # 服务市场注册（仅按量付费）
            ├── app-release.md          # 应用发布
            └── scripts/                # 签约流程脚本（含 error_handler）
```

## 意图识别

| 意图类型 | 关键词 | 流程 |
|----------|--------|------|
| 仅集成 | "接入支付"、"集成" | references/integration/flow.md |
| 仅签约 | "入驻"、"签约"、"开通" | references/onboarding/flow.md |
| 全流程 | "完整接入"、"一站式" | 两者都要 |

**流程衔接提醒：**
- 用户明确要求"完整接入"、"一站式"等全流程时，必须完成签约和集成两条流程；先完成其中一条后，继续引导进入另一条。
- 用户只要求集成时，集成流程结束后必须提醒：正式上线前还需要完成商家签约/入驻。
- 用户只要求签约/入驻时，签约流程结束后必须提醒：还需要完成代码集成才能实际发起支付。

---

## 关键词

按量付费、网站支付、APP支付、AI支付、402收款、快捷收款、商家入驻、签约入驻
