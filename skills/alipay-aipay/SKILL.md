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
4. **禁止假数据**：沙箱配置必须用真实数据，禁止占位符。唯一例外是按量付费沙箱联调的 `service_id`，固定使用 `api_mock_service_id`；该值仅用于沙箱调试，生产环境禁止使用
5. **沙箱化 Agent 联网命令权限**：在存在网络沙箱或命令审批机制的 Agent 环境中，`alipay-cli` 登录、MCP 调用、文件上传、沙箱创建、安装脚本下载等命令应按联网命令处理；若当前工具支持显式网络授权，应首次执行即申请可联网权限，详见 `references/normal/alipay-cli-env.md`
6. **禁止无依据回答**：遇到没有确定依据的问题，必须明确说明无法确认，不得编造。具体额度解限、可收款时间解限、支付产品签约不确定问题，引导用户前往[支付宝商家平台](https://b.alipay.com/page/portal/home)咨询客服；代码集成、应用创建相关不确定问题，引导用户前往[支付宝开放平台](https://open.alipay.com/)或[支付宝技术支持](https://opensupport.alipay.com/support/intelligent-services?form=payskill)咨询客服
7. **禁止编造 CLI/MCP 方法**：本规则适用于签约、集成、调试、排障、重试、恢复和降级，不存在“为了调试”例外。当前操作已有 Skill 脚本封装时必须执行脚本，禁止绕过脚本自行拼接 `alipay-cli mcp call`；没有脚本且确需直调时，Server、Tool、参数名和 JSON 结构必须来自当前已读取文档中的完整固定命令，或先通过 `alipay-cli mcp list <server> --json` 实时确认。禁止根据业务名称、相似接口、历史记忆或错误信息推断命令。遇到 `Server not found`、`Method not found` 或 `Invalid params` 时必须停止并回到脚本、文档或实时 schema，禁止更换近似名称连续试错。

### 执行流程（通用）

```
用户输入 → 自更新检查 → 识别意图与已有上下文 → 加载对应 flow.md → 输出一次性启动确认与待办步骤清单 → 等待确认 → 逐步执行
```

**启动自更新检查**：每次触发本 Skill 时，先读取并执行 `references/normal/self-update.md` 的自更新检查。若本轮对话中刚成功执行过 `npx -y @alipay/alipay-aipay@latest install`，则视为检查已完成，直接继续后续流程。该检查不作为业务阻塞确认点；发现旧版或无法识别本地版本时自动尝试更新，失败时继续使用当前已加载版本。若当前 Agent 环境要求联网或写入用户 Skill 目录授权，则按环境权限机制处理，不得在 Skill 内另设业务确认点。

**产品推荐入口：**
- 集成场景：读取 `references/integration/modules/product-decision.md` 做支付产品推荐与澄清。
- 签约/入驻场景：读取 `references/onboarding/flow.md` 的 Step 2“方案规划”做产品匹配与推荐。
- 完整接入场景：按下方“完整接入编排”衔接两个子流程；业务规则和完成条件仍以两个子流程为准。

#### 集成流程（7步 / 网站支付和APP支付跳过步骤5，共6步）
- 步骤1：产品决策 → **[阻塞确认]**
- 步骤2：沙箱初始化 → 阅读 sandbox-setup-guide.md → 创建环境
- 步骤3：集成前置 → 阅读 SDK 文档 + 产品文档
- 步骤4：代码生成
- 步骤5：按量付费沙箱测试（仅按量付费产品）→ **[默认自动执行]**
- 步骤6：集成后说明
- 步骤7：集成校验 → **[默认自动执行]**

#### 签约流程（6步）
- 步骤1：环境检查
- 步骤2：方案规划
- 步骤3：登录授权 + 签约/应用/适用服务的只读查询
- 步骤4：一次性资料与资源决策
- 步骤5：入驻推进
- 步骤6：本轮流程收口

#### 完整接入编排

- 只编排 `references/integration/flow.md` 和 `references/onboarding/flow.md`，不建立第三套状态、完成条件或恢复模型；两个子流程的红线、校验和阻塞确认全部保留。
- 首次只读取当前产品判断、MCC 候选、材料预告、集成步骤1确认规则和完整服务声明。一次展示产品、服务端语言、MCC、授权范围、完整接入范围、合并待办和可能需要的材料；查询签约状态前不要求用户确认材料齐备状态。

<BLOCKING_CONFIRMATION>

必须收到用户对同一产品、语言、MCC、授权范围、服务声明和完整接入范围的明确确认。该确认同时满足 integration 步骤1和 onboarding Step 2 中的相同确认；子流程不得重复询问。信息或范围变化时只重新确认受影响内容，不得用服务声明展示前的“同意”推定确认。

</BLOCKING_CONFIRMATION>

- 网站支付/APP支付缺少支付页或支付能力时先执行 integration，否则先执行 onboarding；仅缺签约申请的首页、商品页、支付页图片时留在 onboarding Step 4 收集上传。按量付费先执行 onboarding，再执行 integration。
- 跨子流程复用已确认的产品、语言、MCC、授权范围、已校验材料和已通过的 CLI 环境检查；只补问缺失、变化或校验失败字段，阶段切换时不再询问“是否继续”。
- onboarding 登录后连续查询签约、应用和适用的服务，再一次收集当前分支材料；不得把查询失败当作空列表。已取得的图片引用、APP 名称和校验结果直接写入 onboarding 现有状态，不建立 full_process 副本。
- 产品签约和服务/应用写操作继续使用子流程的最终摘要确认，首次共同确认不能替代目标尚未确定的外部写操作确认。按量付费沙箱测试属于集成调试步骤，测试参数和服务就绪后默认执行，不新增确认点。
- 两个子流程都到达当前可推进终点后，直接汇总实际集成、沙箱、签约、服务、应用和待办状态。存在待生效、待审核、未通过校验或正式配置未完成时，只能表述为“本轮完整接入已执行至当前可推进终点”，不得宣称生产就绪。

---

## 目录结构

```
alipay-aipay/
├── SKILL.md                    # 主控中枢，Agent 入口
└── references/
    ├── normal/                 # 通用文档（集成 + 签约共用）
    │   ├── alipay-cli-env.md   # alipay-cli 检测与安装
    │   ├── self-update.md      # 启动自更新检查
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
| 全流程 | "完整接入"、"一站式" | 本文“完整接入编排” + 两个子流程 |

**流程衔接提醒：**
- 用户明确要求"完整接入"、"一站式"等全流程时，必须按本文“完整接入编排”完成签约和集成两条流程，合并首次确认并自动衔接。
- 用户只要求集成时，集成流程结束后必须提醒：正式上线前还需要完成商家签约/入驻。
- 用户只要求签约/入驻时，签约流程结束后必须提醒：还需要完成代码集成才能实际发起支付。

---

## 关键词

按量付费、网站支付、APP支付、AI支付、402收款、快捷收款、商家入驻、签约入驻
