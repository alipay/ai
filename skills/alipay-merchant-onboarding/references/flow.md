# 执行流程

> 本文档与 SKILL.md 配合使用。SKILL.md 为主流程编排文件，本文档提供详细执行流程图和分支逻辑。步骤编号以 SKILL.md 为准。

## 流程概览

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌───────────────────────────────────────────────────────────┐
│  Step 1     │ →  │  Step 2      │ →  │  Step 3     │ →  │  Step 3.1: 授权后处理/签约状态查询                           │
│  环境检查   │    │  方案规划    │    │  登录授权   │    │  ┌──────────────────────────────────┐                      │
└─────────────┘    └──────────────┘    └─────────────┘    │  │ 查询签约状态（ar-query MCP）         │                      │
                                                            │  └────────────┬───────────────────┘                      │
                                                            │               │                                          │
                                                            │     ┌────────┴────────┐                                 │
                                                            │     ↓                 ↓                                 │
                                                            │  NOT_SIGNED        SIGNED                               │
                                                            │  (arInfoList=[])   (arStatus=02/01)                     │
                                                            │     │                 │                                 │
                                                            │     ↓                 ├─────────────────────┐           │
                                                            │     │           ┌─────┴─────┐               │           │
                                                            │     │           │           │               │           │
                                                            │     │      电脑网站支付    AI收               │           │
                                                            │     │      (需资料采集)   (跳过资料采集)       │           │
                                                            └─────┼───────────┴───────────┴───────────────┼───────────┘
                                                                  ↓                                          │
                                       ┌────────────────────────────────────────┐                          │
                                       │  Step 4: 资料采集（仅电脑网站支付          │                          │
                                       │         + NOT_SIGNED）                   │                          │
                                       │  ├─ 电脑网站支付: 3张截图 → fileKey       │                          │
                                       │  └─ AI收: 跳过此步骤                     │                          │
                                       └─────────────────────────────────────────┘                          │
                                                                                     ↓                          │
                                       ┌─────────────────────────────────────────────────────────────────┤──────────┐
                                       │  Step 5: 入驻推进                                       │          │
                                       │                                                                  │          │
                                       │  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐ │          │
                                       │  │ 5.1 产品签约   │  │ 5.2 服务注册   │  │ 5.3 应用发布       │ │←─────────┘
                                       │  │ (ar-sign.apply)│  │ (a2a-pay-service)│ │ (apprelease MCP) │ │
                                       │  │ 所有产品       │  │ (仅AI收)       │  │ 所有产品          │ │
                                       │  │                │  │ 交互式采集入参  │  │                  │ │
                                       │  └────────────────┘  └────────────────┘  └────────────────────┘ │
                                       └──────────────────────────────────────────────────────────────────┘
                                                                                     ↓
                                                              ┌────────────────────────────────────────┐
                                                              │  Step 6: 流程结束                       │
                                                              └────────────────────────────────────────┘
```

---

## Step 1: 环境检查

### 1.1 检查 CLI 安装

```bash
if ! alipay-cli version &>/dev/null; then
  echo "🔄 正在安装 alipay-cli..."
  curl -fsSL https://opengw.alipay.com/alipaycli/install | bash
fi
```

### 1.2 初始化任务与内存状态

> **注意：状态管理已改为对话上下文方式，不再使用状态文件。详见 `references/state-management.md`**

##### 任务创建

**使用 TaskCreate 创建流程任务，确保可追踪、可断点续。**

**⚠️ 重要：TaskCreate 必须按以下顺序依次调用，任务列表显示顺序取决于调用顺序！**

```
按顺序依次调用 TaskCreate：

第1步: TaskCreate({ subject: "环境检查" })
       ↓ 等待返回
第2步: TaskCreate({ subject: "方案规划" })
       ↓ 等待返回
第3步: TaskCreate({ subject: "登录授权" })
       ↓ 等待返回
第4步: TaskCreate({ subject: "资料采集" })
       ↓ 等待返回
第5步: TaskCreate({ subject: "入驻推进" })
       ↓ 等待返回
第6步: TaskCreate({ subject: "流程结束" })
```

**生成的任务列表将按此顺序显示：**
```
1. 环境检查
2. 方案规划
3. 登录授权
4. 资料采集
5. 入驻推进
6. 流程结束
```

**⚠️ 注意：**
- "签约状态查询"是"登录授权"后的子操作（Step 3.1），不作为独立任务
- AI收 产品跳过"资料采集"任务，直接标记 completed
- 已签约状态跳过"资料采集"任务，直接标记 completed
- 禁止并行调用多个 TaskCreate（会导致顺序错乱）
- 必须：前一个 TaskCreate 返回后，再调用下一个 TaskCreate

---

## Step 2: 方案规划

### 2.0 智能推荐流程（核心）

**⚠️ 重要：方案规划阶段一次性推荐产品和经营类目，用户不满意时引导补充描述重新推荐。**

```
Step 2.0: 智能推荐
    ├─ 1. 分析上下文（用户描述 + 项目信息 + 代码特征）
    ├─ 2. 综合判断 → 自动推荐产品 + 经营类目（推荐最匹配的一个类目）
    ├─ 3. 展示推荐结果给用户确认（4个选项）
    │   ├─ 认可 → 保存方案，进入 Step 3
    │   ├─ 修改产品和类目 → 引导补充描述，重新推荐
    │   ├─ 仅修改产品 → 引导补充描述，仅重新推荐产品
    │   └─ 仅修改类目 → 引导补充描述，仅重新推荐类目
    └─ 4. 用户补充描述后，重新执行推荐逻辑
```

### 2.0.1 方案规划阶段的登录状态预检

**在方案规划阶段可选择性执行 whoami 检查，用于提前了解登录状态。**

**⚠️ 重要：如果 whoami 返回过期（`logged_in: false` 或 `is_expired: true`），不要中断流程，当用户没登录继续往下走。**

```bash
# 方案规划阶段的登录状态预检（可选）
CHECK_RESULT=$(alipay-cli whoami --json 2>&1)
LOGGED_IN=$(echo "$CHECK_RESULT" | jq -r '.data.logged_in // false')
IS_EXPIRED=$(echo "$CHECK_RESULT" | jq -r '.data.is_expired // false')

# ⚠️ 关键：is_expired: true 时等同于未登录，需要重新授权
if [ "$LOGGED_IN" = "true" ] && [ "$IS_EXPIRED" = "false" ]; then
  echo "✅ 当前已登录，将在后续步骤校验 scope 权限"
else
  # ⚠️ 过期或未登录，当用户没登录处理，继续往下走
  # 包括：logged_in: false 或 logged_in: true 但 is_expired: true
  echo "📋 当前未登录或登录已过期，将在 Step 3 进行登录授权"
fi

# 无论登录状态如何，继续执行方案规划流程
# 登录授权在 Step 3 统一处理
```

**处理规则：**

| whoami 返回 | 处理方式 |
|------------|----------|
| `logged_in: true` 且 `is_expired: false` | 记录状态，继续方案规划，Step 3 校验 scope |
| `logged_in: true` 但 `is_expired: true` | **等同于未登录，继续往下走，不中断流程** |
| `logged_in: false` | **等同于未登录，继续往下走，不中断流程** |
| 其他错误（网络/CLI 问题） | 忽略错误，继续往下走 |

**禁止行为：**

```
❌ 禁止：whoami 返回过期时报错或中断流程
❌ 禁止：whoami 返回过期时要求用户立即登录
❌ 禁止：因过期状态阻塞方案规划流程
✅ 正确：is_expired: true 时等同于未登录，继续往下走
✅ 正确：登录授权统一在 Step 3 处理
```

### 2.1 上下文分析与智能推荐

#### 2.1.1 用户上下文分析

**从以下来源分析用户业务场景（优先级从高到低）：**

| 优先级 | 来源 | 说明 | 示例 |
|-------|------|------|------|
| 1 | 用户对话描述 | 用户主动说明业务场景 | "我是做AI智能体的" → AI收 |
| 2 | 项目名称/目录名 | 从工作目录推断业务类型 | `my-ai-assistant` → AI收 |
| 3 | 代码内容分析 | 分析项目依赖和代码特征 | 见 products.md 详细规则 |

**代码内容分析规则（通过 Glob/Grep 工具分析项目）：**

| 检测特征 | 推荐产品 | 匹配规则 |
|---------|---------|---------|
| AI/LLM 依赖 (`openai`, `anthropic`, `langchain`) | AI收 | `package.json` 包含相关依赖 |
| Agent 框架代码 (`Agent`, `ChatOpenAI`) | AI收 | 代码包含 Agent 相关类/函数 |
| API 服务代码 (`FastAPI`, `express.Router`) | AI收 | 存在 API 路由定义 |
| 计费/配额逻辑 (`credits`, `usage`, `billing`) | AI收 | 代码包含按调用付费特征 |
| 传统 Web 框架 (`React`, `Vue`) + 电商逻辑 | 电脑网站支付 | 存在购物车/订单/支付相关代码 |

**关键词匹配规则（按优先级）：**

| 业务关键词 | 推荐产品 | 推荐MCC | 推荐理由 |
|-----------|---------|--------|---------|
| AI、智能体、Agent、API、算力、数字内容、按调用付费 | AI收 | 根据具体业务匹配（如：互联网垂直电商平台 A0002_B0115） | AI收定义：面向AI智能体的机器支付 |
| 网站、电商、PC官网、在线教育、政务缴费、商城 | 电脑网站支付 | 互联网综合电商平台 (A0002_B0114) 或匹配具体业务 | 电脑网站支付定义：PC网页发起支付 |
| 直播、视频、内容创作 | AI收 | 商业生活服务 > 在线工具 (A0003_B0112) | 数字内容场景适合AI收 |
| SaaS、工具、软件服务 | AI收 | 商业生活服务 > 在线工具 (A0003_B0112) | API调用场景适合AI收 |

#### 2.1.2 智能推荐输出格式

**⚠️ 重要：先展示推荐结果，询问用户是否认可，不认可时才进入手动选择。**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 根据您的业务场景，智能推荐方案：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   🎯 推荐产品：AI收
      定义：面向 AI 智能体的机器支付收款产品
      适用场景：API、数字内容、算力资源、智能体按调用付费

   📂 推荐类目：零售批发 > 互联网垂直电商平台
      类目编码：A0002_B0115
      匹配理由：您的业务涉及 API 服务，适合垂直电商类目

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**用户确认选项：**

```
请确认推荐方案：
  1. ✅ 认可，使用推荐方案
  2. ❌ 不认可，修改产品和类目
  3. ❌ 不认可，仅修改产品
  4. ❌ 不认可，仅修改类目

请输入选项（1/2/3/4）：
```

### 2.2 用户选择处理

| 用户选择 | 处理方式 |
|---------|---------|
| 1 - 认可 | 保存方案，进入 Step 3 登录授权 |
| 2 - 修改产品和类目 | 引导用户补充描述，重新推荐产品和类目 |
| 3 - 仅修改产品 | 引导用户补充产品相关描述，重新推荐产品 |
| 4 - 仅修改类目 | 引导用户补充类目相关描述，重新推荐类目 |

**引导补充描述示例：**

```
📋 请补充您的业务场景描述，帮助更准确地推荐：

  示例：
  - "我有一个AI写作助手，按调用次数收费"
  - "我是做企业官网展示的，需要在线收款功能"
  - "我提供API接口服务，用户购买后调用我的接口"

请描述您的业务场景：
```

**用户补充描述后，重新执行智能推荐逻辑，再次展示推荐结果供用户确认。**

### 2.3 MCC 推荐（手动选择类目时使用）

**⚠️ 注意：mcc-recommender 不通过 Skill 工具调用，而是直接读取文件。**

```markdown
使用 Read 工具读取 MCC 参考文件：

Read tool call:
  file_path: "mcc-recommender/SKILL.md"

LLM 读取文件后，自行完成语义匹配，输出推荐结果。
```

**⚠️ 重要：MCC 推荐最多返回 3 个类目，供用户选择。**

#### 输出格式编排

**⚠️ 重要：不要直接向用户展示 JSON 数据，必须整理为易读的表格形式供用户选择。**

当有多个推荐结果时，使用编号表格让用户选择：

```
📋 根据您的描述，为您推荐以下经营类目：

| 序号 | 一级类目 | 二级类目 | 匹配说明 |
|------|----------|----------|----------|
| 1 | 餐饮 | 饮品/甜品 | 奶茶店属于饮品店铺 |
| 2 | 餐饮 | 快餐小吃 | 奶茶店可能兼营小吃 |
| 3 | 零售批发 | 食品饮料 | 瓶装饮料零售 |

请选择：
  • 输入序号（1/2/3）选择对应类目
  • 输入更详细的描述，重新推荐类目
```

当只有一个推荐结果时：

```
📋 根据您的描述，为您推荐：

| 一级类目 | 二级类目 | 匹配说明 |
|----------|----------|----------|
| 餐饮 | 饮品/甜品 | 奶茶店属于饮品店铺 |

请选择：
  • 输入"确认"使用此类目
  • 输入更详细的描述，重新推荐类目
```

#### 用户选择处理

| 用户输入 | 处理方式 |
|----------|----------|
| 输入数字序号（1/2/3） | 选择对应的类目，将 `mcc_code`（格式：`A0001_B0009`）作为运行时变量保存 |
| 输入更详细描述 | 根据新描述重新匹配，返回新的推荐列表（最多 3 个） |
| 输入"确认"（单推荐时） | 确认使用推荐的类目，将 `mcc_code` 作为运行时变量保存 |

用户选择后，将对应的 `mcc_code`（格式：`A0001_B0009`）作为运行时变量，签约时直接传入 apply JSON（不写状态文件）。

### 2.4 保存方案

```bash
# 在对话上下文中保存状态变量
- productName: 用户选择的产品名称
- salesCode: 产品对应的产品码
- scope: 产品对应的授权范围
- mccCode: 用户选择的经营类目（运行时变量）
- collect_information: 截图 fileKey（仅电脑网站支付，Step 4 采集后更新）

# mccCode 作为运行时变量，不持久化到状态文件
# 在签约提交时直接传入 apply JSON 的 businessProperty.mccCode
```

---

## Step 3: 登录授权

详见 `references/cli-commands.md`

### ⚠️ 授权前用户确认（强制执行）

**在执行登录命令前，必须先输出产品类型和经营类目给用户确认！**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 请确认您的方案信息：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   产品类型：xxx
   经营类目：xxx (xxx)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

确认信息无误后，将为您生成授权链接。
是否确认？(是/否)
```

**禁止行为：**
- ❌ 禁止未经用户确认直接执行登录命令
- ❌ 禁止跳过产品类型和经营类目的展示

### 流程

```
1. whoami 检查登录状态
   ├─ 已登录 → 检查 scope/mcc 权限
   │   ├─ 匹配 → 进入 Step 3.1
   │   └─ 不匹配 → logout → 重新登录
   └─ 未登录 → 执行登录流程
       ├─ login --non-interactive → 获取 device_code
       ├─ 校验参数 (deviceCode + productCode + mccCode)
       ├─ 构建 BROWSER_URL → 输出给用户
       └─ 等待用户确认授权完成 → login --complete 确认
```

### ⚠️ 授权确认规范

**不再使用轮询机制。授权流程如下：**

1. **输出授权链接** - 确保浏览器链接完整输出给用户
2. **等待用户确认** - 由用户主动确认"我已完成授权"
3. **执行确认命令** - 用户确认后，执行 `login --complete` 一次性确认

**禁止行为：**
- ❌ 禁止自动轮询检查授权状态
- ❌ 禁止循环调用 `login --complete`
- ❌ 禁止在用户未确认前调用确认命令

---

## Step 3.1: 授权后处理/签约状态查询

### 3.1.1 查询签约状态

**主技能直接调用 ar-query MCP 查询合约状态：**

```bash
alipay-cli mcp call ar-query.queryArInfosBySalesProd \
  -d '{"request":{"salesProductCodes":["<salesCode>"]},"ctx":{}}' \
  --json 2>/dev/null
```

```bash
# 从对话上下文获取产品码
# SALES_CODE 在 Step 2 已保存到对话上下文

# 主技能直接调用 ar-query MCP 查询签约状态
```

### 3.1.2 签约状态判断规则

**根据 `ar-query.queryArInfosBySalesProd` 返回结果判断签约状态：**

| 返回结果 | 状态判定 | 说明 |
|----------|----------|------|
| `resultObj.arInfoList` 为空数组 `[]` | `NOT_SIGNED` | 未签约 |
| `resultObj.arInfoList` 不为空，且存在 `arStatus` 为 `"02"` 的记录 | `SIGNED` | 签约已生效，跳过资料采集 |
| `resultObj.arInfoList` 不为空，且 `arStatus` 为 `"01"` | `SIGNED` | 已提交签约（待生效），跳过资料采集 |

### 3.1.3 状态分支处理

| 状态 | 产品类型 | 说明 | 处理 |
|------|----------|------|------|
| `NOT_SIGNED` | 电脑网站支付 | 未签约（arInfoList 为空） | 进入 Step 4 资料采集 → Step 5 入驻推进 |
| `NOT_SIGNED` | AI收 | 未签约（arInfoList 为空） | **跳过 Step 4**，直接进入 Step 5 入驻推进（签约+服务注册+应用发布） |
| `SIGNED` | 电脑网站支付 | 已签约（arStatus="02" 或 "01"） | **跳过 Step 4**，直接进入 Step 5 入驻推进（仅应用发布） |
| `SIGNED` | AI收 | 已签约（arStatus="02" 或 "01"） | **跳过 Step 4**，直接进入 Step 5 入驻推进（服务注册+应用发布） |

**AI收 签约后的服务注册判断逻辑：**

```bash
# AI收 已签约时，仍需进入服务注册流程
# 在服务注册模块中会先查询已有服务，决定是否需要注册

if [ "$SALES_CODE" = "I1080300001000160457" ]; then
  # AI收：即使签约也需要服务注册
  echo "📋 AI收已签约，进入服务注册流程"
  # 直接进入 Step 5 入驻推进，在 5.2 服务注册中交互采集参数
else
  # 电脑网站支付：签约后直接进入应用发布
  echo "✅ 电脑网站支付已签约，直接进入应用发布流程"
  # 进入 Step 5 入驻推进，跳过 5.1 签约和 5.2 服务注册，直接 5.3 应用发布
fi
```

### 3.1.4 查询结果处理

**根据 MCP 查询结果判断签约状态：**

```bash
# 提取 arInfoList
AR_INFO_LIST=$(echo "$QUERY_RESULT" | jq -r '.resultObj.arInfoList // []')

# 判断签约状态
if [ "$AR_INFO_LIST" = "[]" ] || [ -z "$AR_INFO_LIST" ]; then
  echo "📋 未签约 (NOT_SIGNED)"
  if [ "$SALES_CODE" = "I1080300001000160457" ]; then
    echo "📋 AI收未签约，跳过 Step 4，直接进入 Step 5 入驻推进"
  else
    echo "📋 电脑网站支付未签约，进入 Step 4 资料采集"
  fi
else
  # 检查是否存在已生效状态 (arStatus = "02")
  HAS_EFFECTIVE=$(echo "$QUERY_RESULT" | jq -r '.resultObj.arInfoList[] | select(.arStatus == "02") | .arStatus' | head -1)
  # 检查是否存在已提交状态 (arStatus = "01")
  HAS_SUBMITTED=$(echo "$QUERY_RESULT" | jq -r '.resultObj.arInfoList[] | select(.arStatus == "01") | .arStatus' | head -1)

  if [ -n "$HAS_EFFECTIVE" ] || [ -n "$HAS_SUBMITTED" ]; then
    echo "✅ 已签约/已提交签约，跳过资料采集，直接进入 Step 5 入驻推进"
  else
    echo "📋 其他状态"
    if [ "$SALES_CODE" = "I1080300001000160457" ]; then
      echo "📋 AI收，跳过 Step 4，直接进入 Step 5 入驻推进"
    else
      echo "📋 电脑网站支付，进入 Step 4 资料采集"
    fi
  fi
fi
```

> **签约状态查询：** 主技能直接调用 `ar-query.queryArInfosBySalesProd` MCP

> 详细判断逻辑和脚本见 `references/product-sign.md` 和 `scripts/query_sign_status.sh`

---

## Step 4: 资料采集

**⚠️ 仅针对"电脑网站支付"产品且签约状态为 NOT_SIGNED 时执行。AI收 跳过此步骤，服务注册入参在 Step 5.2 交互采集。**

### 4.0 检查已有资料数据

```bash
# 根据产品类型检查对话上下文中是否已有采集的资料数据
# 从对话上下文获取 salesCode（Step 2 已保存）

if [ "$SALES_CODE" = "I1080300001000160457" ]; then
  # AI收：跳过资料采集，服务注册入参在 Step 5.2 交互采集
  echo "📋 AI收无需资料采集，服务注册信息将在入驻推进阶段交互采集"
else
  # 电脑网站支付：检查截图 fileKey（从对话上下文 collect_information 变量）
  if [ -n "$COLLECT_INFORMATION" ] && [ "$COLLECT_INFORMATION" != "null" ] && [ "$COLLECT_INFORMATION" != "{}" ]; then
    echo "✅ 已有截图数据，跳过采集步骤"
    # 进入 Step 5 入驻推进
  else
    echo "📋 开始截图上传采集流程"
  fi
fi
```

### 4.1 收集截图（电脑网站支付）

**⚠️ 方案规划确定产品为"电脑网站支付"后，无需询问网址是否上线，直接要求用户提供 3 张网站截图。**

**⚠️ 采集流程：用户提供文件路径（可拖入终端） → skill 自动调用 `alipay-cli file upload` 上传 → 获取 fileKey → 写入共享内存。禁止向用户索取 fileKey。**

```
📋 电脑网站支付需要 3 张网站截图，请提供截图文件路径（可直接拖入终端）：

  1. 首页截图 — 网站首页完整截图（JPG/PNG，≤10MB）
  2. 商品页截图 — 商品或服务页面截图（JPG/PNG，≤10MB）
  3. 支付页截图 — 支付页面截图（JPG/PNG，≤10MB）



示例：/Users/xxx/screenshots/home.png
```

### 4.2 通过 alipay-cli file upload 上传文件并解析 fileKey

**⚠️ 重要：用户提供文件路径后，skill 自动调用 `alipay-cli file upload` 上传并获取 fileKey，无需用户提供 fileKey。**

#### 4.2.1 文件上传调用

```bash
# alipay-cli 文件上传（CLI 子命令，非 MCP 调用）
alipay-cli file upload /path/to/image.png -s payMerchantcodeSkill --json 2>/dev/null
```

**参数说明：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `<FILE_PATH>` | string | 是 | 文件的绝对路径（用户提供，可拖入终端） |
| `-s` | string | 是 | 上传场景，固定值 `payMerchantcodeSkill` |

#### 4.2.2 上传返回格式

```json
// 成功
{
  "success": true,
  "data": {
    "fileKey": "2eec4bbb-2727-4f24-95fe-154e7e941e9a.jpg"
  }
}
```

#### 4.2.3 解析 fileKey 的正确方式

**返回的 JSON 可能有不同的嵌套结构，需要兼容多种路径：**

```bash
# 统一解析函数（兼容多种返回结构）
parse_file_key() {
  local RESULT="$1"
  echo "$RESULT" | jq -r '.data.fileKey // .data.data.fileKey // .fileKey // .result.fileKey // empty'
}
```

#### 4.2.4 完整上传流程（推荐并行上传）

```bash
# 用户提供文件路径后，skill 自动执行以下流程：

# Step 1: 并行上传 3 张截图
alipay-cli file upload "$HOME_IMG" -s payMerchantcodeSkill --json 2>/dev/null > /tmp/upload_home.json &
alipay-cli file upload "$SHOP_IMG" -s payMerchantcodeSkill --json 2>/dev/null > /tmp/upload_shop.json &
alipay-cli file upload "$PAY_IMG" -s payMerchantcodeSkill --json 2>/dev/null > /tmp/upload_pay.json &
wait

# Step 2: 解析 fileKey
HOME_KEY=$(cat /tmp/upload_home.json | jq -r '.data.fileKey // .data.data.fileKey // .fileKey // .result.fileKey // empty')
SHOP_KEY=$(cat /tmp/upload_shop.json | jq -r '.data.fileKey // .data.data.fileKey // .fileKey // .result.fileKey // empty')
PAY_KEY=$(cat /tmp/upload_pay.json | jq -r '.data.fileKey // .data.data.fileKey // .fileKey // .result.fileKey // empty')

# Step 3: 校验上传结果
if [ -z "$HOME_KEY" ] || [ -z "$SHOP_KEY" ] || [ -z "$PAY_KEY" ]; then
  echo "❌ 截图上传失败，请检查文件路径后重试"
  [ -z "$HOME_KEY" ] && echo "  - 首页截图上传失败"
  [ -z "$SHOP_KEY" ] && echo "  - 商品页截图上传失败"
  [ -z "$PAY_KEY" ] && echo "  - 支付页截图上传失败"
  exit 1
fi

echo "✅ 截图上传成功"
echo "  - 首页: $HOME_KEY"
echo "  - 商品页: $SHOP_KEY"
echo "  - 支付页: $PAY_KEY"
```

#### 4.2.5 更新对话上下文状态

```bash
# 将 fileKey 更新到对话上下文（collect_information 变量）
# collect_information = {"pc_home_page_image": "$HOME_KEY", "pc_shop_page_image": "$SHOP_KEY", "pc_payment_image": "$PAY_KEY"}
```

### 4.3 资料就绪确认

**⚠️ 资料采集完成后，确认数据完整即可进入 Step 5 入驻推进。**

```bash
# 确认截图完整性（从对话上下文变量读取）
# SALES_CODE 在 Step 2 已保存到对话上下文

# 仅电脑网站支付需要确认截图
if [ "$SALES_CODE" != "I1080300001000160457" ]; then
  # 电脑网站支付：确认截图 fileKey 已保存到对话上下文
  if [ -z "$HOME_KEY" ] || [ -z "$SHOP_KEY" ] || [ -z "$PAY_KEY" ]; then
    echo "❌ 截图数据不完整，请重新上传"
  fi
fi
```

---

## Step 5: 入驻推进

**⚠️ 签约、服务注册、应用发布串行执行。**

| 步骤 | 模块 | 适用产品 | 详见 |
|------|------|----------|------|
| 5.1 | 产品签约 | 所有产品 | `references/product-sign.md` |
| 5.2 | 服务市场注册 | 仅AI收（交互采集入参） | `references/service-registration.md` |
| 5.3 | 应用发布 | 所有产品 | `references/app-release.md` |

### 5.1 产品签约

**签约提交由主技能直接调用 `alipay-cli mcp call ar-sign.apply`。**

> **⛔ 详细的 apply JSON 结构、变量来源、完整示例和禁止行为见 SKILL.md「⛔ 签约规范（统一入口，规则集中）」章节和 `references/product-sign.md`。**

```bash
# 生成 UUID（每次签约提交前生成新的）
BIZ_REQUEST_NO=$(python3 -c "import uuid; print(uuid.uuid4())")

# 电脑网站支付签约提交
# HOME_KEY, SHOP_KEY, PAY_KEY 从对话上下文 collect_information 变量获取

alipay-cli mcp call ar-sign.apply -d "$(cat <<EOF
{
  "request": {
    "bizFeatures": {},
    "bizRequestNo": "${BIZ_REQUEST_NO}",
    "businessProperty": {
      "mccCode": "${MCC_CODE}",
      "webAppDTO": {
        "placeType": "ONLINE_WEBAPP",
        "appType": "PC_WEB",
        "appStatus": "OFFLINE",
        "screenshot": ["${HOME_KEY}", "${SHOP_KEY}", "${PAY_KEY}"]
      }
    },
    "channelCode": "B_SK_SH_RPC",
    "extension": {},
    "orderType": "NEW_SIGN",
    "salesProductCodes": ["I1080300001000041203"]
  },
  "ctx": {}
}
EOF
)" --json 2>/dev/null

# AI收签约提交（重新生成 UUID）
BIZ_REQUEST_NO=$(python3 -c "import uuid; print(uuid.uuid4())")

alipay-cli mcp call ar-sign.apply -d "$(cat <<EOF
{
  "request": {
    "bizFeatures": {},
    "bizRequestNo": "${BIZ_REQUEST_NO}",
    "businessProperty": {
      "mccCode": "${MCC_CODE}"
    },
    "channelCode": "B_SK_SH_RPC",
    "extension": {},
    "orderType": "NEW_SIGN",
    "salesProductCodes": ["I1080300001000160457"]
  },
  "ctx": {}
}
EOF
)" --json 2>/dev/null
```

### apply JSON 关键变量

| 变量 | 来源 | 说明 |
|------|------|------|
| `bizRequestNo` | 主技能生成 | UUID，通过 `python3 -c "import uuid; print(uuid.uuid4())"` 生成，**禁止省略** |
| `mccCode` | Step 2 方案规划 | 运行时变量，格式 `Axxxx_Bxxxx`，不持久化到状态文件 |
| `channelCode` | 固定值 | `"B_SK_SH_RPC"` |
| `orderType` | 固定值 | `"NEW_SIGN"` |
| `screenshot` | Step 4 资料采集 | 仅电脑网站支付需要，fileKey 字符串数组 |

### 5.2 服务市场注册（仅AI收）

**⚠️ 仅当产品为AI收（salesCode = I1080300001000160457）时执行此步骤。**

**⚠️ AI收的服务注册入参在此时交互式采集，而非预先收集到状态变量中。详见 `references/service-registration.md`。**

AI收服务注册流程：

1. **查询已有服务** — 调用 `a2a-pay-service.discoverBazaarServicesForMcp` 查询用户已注册的服务
2. **判断服务数量** — 若已有服务 ≥ 20，提示用户无法注册新服务
3. **交互采集入参** — 向用户收集服务注册所需的 5 项信息：
   - 服务名称（1-50 字符）
   - 服务描述（1-500 字符）
   - 服务地址（URL）
   - 服务单价（元，最低 0.01）
   - 请求示例（JSON）
4. **用户决策** — 展示已有服务列表，由用户决定是否注册新服务
5. **提交注册** — 调用 `a2a-pay-service.saveBazaarServiceForMcp`

**⚠️ 服务注册入参是在 Step 5.2 中交互采集的，不作为预收集的状态变量存储。**

### 5.3 应用发布

**⚠️ 所有产品均需执行应用发布。详见 `references/app-release.md`。**

应用发布流程：
1. 查询已有应用
2. 判断复用或新建
3. 设置公钥
4. 提交审核

---

## Step 6: 流程结束

### 6.1 输出入驻结果

```markdown
🎉 支付宝商家入驻流程结束！

📦 产品信息：
  • 产品类型：电脑网站支付
  • 经营类目：零售批发 > 电商平台

📋 签约信息：
  • 签约状态：已签约
  • 签约时间：2026-04-20 10:00:00

📱 应用信息：
  • 应用ID：2021000000000000
  • 应用类型：WEBAPP
  • 审核状态：已通过
```

### 6.2 流程结束

**流程结束后，对话上下文自动清理，无需手动删除状态。**

步骤：
1. 输出入驻结果摘要
2. 使用 TaskUpdate 标记所有任务为 completed
3. 对话结束，状态自动清理