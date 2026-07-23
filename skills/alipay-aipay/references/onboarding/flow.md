# 支付产品-产品开通流程说明

> ⚠️ **前置声明**：本 flow 仅支持**网站支付、APP 支付、按量付费**三种产品的产品开通。**其他产品（当面付、订单码支付、JSAPI支付、预授权支付、商家扣款等）暂不支持**，如需开通请前往[支付宝商家平台](https://b.alipay.com/page/portal/home)完成。

---

## 执行入口与重启原则

严格按本文 Step 1 至 Step 6 执行。每到一个动作，只读取该动作明确列出的模块并使用已有脚本；禁止一次加载全部签约、服务和应用模块，禁止凭记忆拼接 MCP 命令，也禁止绕过 `auth.sh` 直接调用 `alipay-cli login`。

企业账号边界：如果用户明确表示当前要用企业账号通过 Skill 完成产品开通，必须执行下列标准消息命令并停止本 flow 的产品开通动作，引导前往支付宝商家平台。不得主动增加账号类型确认，也不得根据 MCC、营业执照字段或“公司”等泛化描述推断为企业账号；没有明确依据时继续按本 flow 执行。

```bash
printf '%s' '{}' | node ../normal/scripts/render_customer_message.mjs onboarding.enterprise.unsupported --variant <ONBOARDING_ONLY|FULL_PROCESS>
```

`onboarding_only` 固定使用 `ONBOARDING_ONLY`；`full_process` 只会在代码开发已通过后进入本 flow，固定使用 `FULL_PROCESS`。renderer stdout 是该意图的最终产品开通消息，必须把 stdout 原文作为当前回复正文发给用户；命令面板、折叠输出或“已渲染/已展示”说明不能替代对客消息。发出 stdout 原文后直接停止本 flow，不再执行 Step 6 或追加第二份收口。

每次开始都先校验登录、scope 和 MCC，再查询签约状态、应用候选和适用服务候选，并只依据当前真实结果继续。不得根据历史对话推定外部操作结果。

步骤顺序固定为方案确认后授权，再执行全部适用只读查询，最后处理独立分支。查询失败只阻断对应分支，不得当作空列表；其他查询成功的分支可以继续。

方案确认前只允许根据 `modules/mcc-reference.md` 当前匹配行陈述 MCC 名称、适用商家和特殊资质原文；特殊资质为 `-` 只表示当前表未列出，不代表对企业/个人签约资格作出结论。表内没有明确依据的主体资格、前提或材料结论统一说明无法确认，禁止补充常识推断。

---

## ⛔ 核心铁律（签约流程强制遵守）

<!-- GENERATED:ONBOARDING-GUARDS:START -->
<!-- 此区块由 scripts/generate-skill-guards.mjs 生成，禁止手改 -->
### 生成式执行护栏

- `P-MCP-CONTRACT-FROZEN`：只执行当前 Skill 已验证脚本中的 MCP 方法、参数和解析；禁止推断、改名、替换或尝试近似方法。
- `P-AUTH-BEFORE-ONBOARDING`：登录、scope 和 MCC 全部校验通过前，禁止执行任何 onboarding 查询或写操作。
- `P-WRITE-CONFIRM`：签约材料完整且校验通过后直接执行签约提交，不再增加回复1；材料缺失或校验失败时继续使用受控材料提示，禁止提交。服务创建资料完整且校验通过后展示受控创建摘要并直接执行，不增加回复1；服务修改执行前必须展示当前会话、脱敏主体、产品、动作和目标摘要，并取得绑定当前摘要的明确确认。应用创建由用户针对当前应用候选列表明确选择新建来确认，候选重查未变化且条件字段齐备时不再追加回复1；用户提供应用公钥后生成确认页不重复确认，由用户在官方页面完成公钥确认；新建应用的公钥校验成功后直接提交应用审核，不再增加回复1。
- `P-WRITE-UNKNOWN`：非幂等写操作结果不明时先用现有只读能力核验；无法确认时进入 UNKNOWN，禁止盲目重试。
- `P-PARTIAL-RESULT`：签约、服务和应用分支独立记录结果，不回滚已成功动作，不用整体失败或整体成功覆盖部分结果。
- `P-MATERIAL-CATEGORY`：每轮只展示一个材料类别，同类一次收齐；提前提供的后续材料直接接收并校验，之后不重复索取。
- `P-KEY-NO-PRIVATE`：不得请求、读取、处理、保存或输出生产应用私钥；本轮不提供本地命令生成密钥能力。
- `P-KEY-PUBLIC-USER`：应用公钥只能由用户自行生成并明确提供；缺少公钥时禁止调用 createKeyConfirmPage，不补全、不改写、不加 PEM 头尾。
- `P-AUTH-URL`：授权链接只能由 auth.sh 在固定产品/MCC 上下文校验通过后构造；只允许 https://aipay.alipay.com/cli-auth、deviceCode/productCode/mccCode 和可选 platform，禁止其他域名、路径、参数、重复参数、fragment 或 verification_url。
- `P-KEY-URL`：公钥确认只展示 createKeyConfirmPage 返回的 confirmPageUrl 裸 URL；禁止展示二维码链接和 alipays:// 深链。
- `P-URL-AUTO-OPEN`：授权页和公钥确认页在 URL 完整校验通过后默认调用受控 opener；失败、无 GUI 或宿主要求权限时保留同一裸 URL 和复制访问兜底。
- `P-KEY-TOOL-DOWNLOAD`：缺少应用公钥时按当前操作系统自动下载官方密钥工具并输出实际安装包路径、安装引导和官方文档兜底；只下载，不安装、不启动、不生成密钥，失败或系统不支持时只输出官方文档手动下载引导。
- `P-SENSITIVE-STATE`：用户可以为当前应用设钥明确提供应用公钥，但该输入只用于本次 app.sh key/verify-key 调用；Agent 回复、对话摘要、普通日志、跨会话状态和宽权限临时文件禁止复述或保存公钥原文。除 P-SANDBOX-CREDENTIAL-EXCEPTION 明确允许的 Windows 手工沙箱当前资料输入外，私钥、token、Payment-Proof、签名串、完整支付表单和未脱敏 MCP 响应同样禁止进入这些位置。临时 URL 只有在 flow 明确登记、已由脚本或 renderer 完成白名单及当前上下文校验且当前动作必须对客展示时，才允许进入该动作的唯一对客正文；即使获准展示，也禁止进入对话摘要、普通日志、跨会话状态或宽权限临时文件。
- `P-CUSTOMER-OUTPUT-EXCLUSIVE`：flow 指定 renderer 或托管脚本时，其 stdout 是该动作唯一对客正文；工具输出记录、折叠面板或日志不等于已对客发送，Agent 必须把 stdout 原文作为当前回复正文发给用户。禁止在前后添加执行说明、消息 ID、控制标记、摘要、转述或近似话术。阻塞消息发出后立即停止本轮并等待用户。
- `P-DETERMINISTIC-HANDOFF`：flow 已登记脚本或 renderer 时只执行动作发生位置的固定命令；退出码和登记终态标记满足后立即按 flow 转移，禁止追加 jq、cat、grep、curl 或临时脚本重复解析、复核或解释同一结果。失败只走登记恢复分支；项目代码实现和运行验证除外，但不得把沙箱配置或其他敏感文件打印到工具输出。
<!-- GENERATED:ONBOARDING-GUARDS:END -->

生成区块与 `SKILL.md` 红线适用于全部步骤。onboarding 另有三条边界：禁止修改用户项目代码或支付配置文件，只输出需由用户自行应用的配置；每个 CLI 业务调用必须按脚本现状设置环境，禁止硬编码 `PLATFORM` 或用分号拼接环境变量；scope/MCC 不匹配只能执行 `auth.sh mismatch`，logout 未确认成功前不得重新授权；`AUTH_FLOW:RETRY_WITH_NETWORK` 或输出不可唯一解析时只表示当前 Agent 执行环境无法确认结果，必须申请联网权限后重试同一条脚本命令，不得解释为用户本机 logout/login 失败。签约命令的 `request + ctx` 与应用/服务命令的 `request` 结构由脚本冻结，禁止绕开脚本混用或重组。

### 标准消息执行规则

本 flow 的标准对客消息必须通过 renderer 或托管脚本输出，禁止 Agent 只看到消息 ID 后自行改写。`onboarding.mcc.clarify`、`onboarding.discovery.summary`、`materials.category.collect` 已由 `onboarding_message_runner.mjs` 托管，运行时禁止套用下方通用 renderer 示例自行拼 JSON；尤其 `materials.category.collect` 不得手写 `categoryName/currentStatus/missingFields`，必须用 `material-collect` runner 归一化 `签约资料`、`网站支付签约截图`、`mobilePlatform` 等常见别名。动态值必须先保存在 shell 变量中，再由当前位置的完整命令使用 `jq -cn --arg` / `--argjson` 生成 `MESSAGE_INPUT_JSON`；禁止把动态值替换进单引号 JSON 或命令文本。变量只来自本轮实际查询、用户材料或脚本输出；无变量时传 `{}`：

```bash
node ../normal/scripts/render_customer_message.mjs --schema <messageId> --variant <VARIANT>
printf '%s' "$MESSAGE_INPUT_JSON" | node ../normal/scripts/render_customer_message.mjs <messageId> --variant <VARIANT>
```

直接调用 renderer 前必须先用同一 `messageId` + `variant` 查询 schema，按 `inputVariables` 构造 JSON；托管 runner 或脚本已经封装 schema 映射时必须执行 runner/脚本，禁止退回临时 `jq` + renderer 链。renderer 报错时停止当前步骤，先复查 schema 再修正字段、枚举或改用 schema 标出的托管入口，不得输出手写兜底文案，也不得连续猜测近似枚举。renderer stdout 是当前动作唯一对客正文；工具输出记录、折叠面板或日志不等于已对客发送，Agent 必须把 stdout 原文作为当前回复正文发给用户。禁止在前后添加步骤名、消息 ID、控制标记、执行说明、摘要或转述；阻塞消息发出后立即停止本轮并等待用户。`auth.page`、`auth.pending`、`auth.expired`、`auth.mismatch` 由 `auth.sh` 内部渲染；`application.key.page` 由 `app.sh key` 内部渲染；`key_tool.download.result` 和 `key_tool.download.fallback` 由 `download_key_tool.sh` 输出。遇到这些脚本托管消息时执行脚本，并把脚本 stdout 原文作为当前回复正文；不直接调用 renderer 代替脚本，也不得只说明脚本已展示、已渲染或已输出。

**工作目录规则**：本文件代码块和行内命令中的 Skill 相对路径一律以本文件所在的 `references/onboarding/` 目录解析；执行工具支持 `workdir` 时将其设为该目录。onboarding 不修改用户项目代码；确需检查用户本机路径时显式传入规范化绝对路径，不得把 Agent 启动目录、用户项目目录或其他 Skill 副本当作本 flow 的脚本目录。

---

## 一、产品映射

> 术语说明：本 Skill 中“网站支付”是唯一的网页支付产品概念，覆盖电脑网页和手机浏览器网页/H5 场景；“电脑网站支付”“PC网站支付”“手机网站支付”“H5支付”均按网站支付处理。签约 payload 中的 `appType=PC_WEB` 是接口字段名，不代表只能用于 PC 端网页。

| 产品 | productType | salesCode | scope | 资料采集要求 |
|------|-------------|-----------|-------|-------------|
| 按量付费 | aipay | I1080300001000160457 | app:all,machine_pay:write,agmnt:write | 无需截图 |
| 网站支付 | webpay | I1080300001000041203 | app:all,fast_instant_trade_pay:write | 需要3张网站截图 |
| APP 支付 | apppay | I1080300001000041313 | app:all,auth_alipay_apppay:write | 未签约时需要 APP 名称和 3 张 APP 界面截图，签约状态固定按 `OFFLINE` 提交；选择新建应用时在 Step 4 前置采集移动平台信息，Step 5.3 才用于创建 |

---

## 二、主流程

```
Step 1: 环境检查 → Step 2: 方案规划 → Step 3: 登录授权
    → Step 3.1: 三分支只读发现 → Step 4: 分支摘要与分类材料
    → Step 5: 独立分支推进 → Step 6: 分支级收口
```

### 启动前材料预告与分流

先确定唯一产品；未确定时只澄清业务场景，不一次展示三产品材料。进入 Step 2 后简短预告当前产品的条件材料，不要求用户确认齐备；登录查询后先展示三分支短摘要，再一次只收集一个可推进类别。`full_process` 固定在 integration 完成后进入本流程，进入前不展示或收集签约材料。

**执行规则**：
- 网站支付或 APP 支付确定为 `NOT_SIGNED` 且签约页面材料尚不存在时，只把签约分支置为 `WAITING_USER`；服务/应用分支仍按自身条件推进。`onboarding_only` 不得因此修改项目或切换意图，只在收口时提醒仍需代码开发。若页面和支付能力已存在、仅缺首页、商品页、支付页图片，则在签约材料类别收集并上传；已签约时不再要求这组图片。
- 截图要求以“支付页”为准；支付页指展示支付宝付款方式，等待用户去支付的页面，不得自行改口为“支付成功页”或要求用户提供文档未定义的页面。
- `full_process` 按 `../normal/full-process-routing.md` 的完整接入编排先完成 Integration 的实际修改与校验，再进入本流程；不得提前登录、查询或收集产品开通材料。

---

## 三、Step 详解

### Step 1: 环境检查

**必读文档**：
- `../normal/alipay-cli-env.md` - alipay-cli 检测、安装、验证规范

**脚本**：
- `../normal/scripts/detect_dev_tool.sh` - 检测 AI 编程工具，输出 DEV_TOOL_NAME 取值
- `../normal/scripts/common.sh` - shell 公共函数与初始化入口；签约脚本通过 `error_handler.sh` 间接调用 `init_dev_tool_name`

**任务**：
1. 检查 alipay-cli 是否安装，未安装则自动安装
2. 确认 AI 编程工具检测脚本可用；签约脚本执行时会通过公共初始化设置 DEV_TOOL_NAME
3. 有任务工具时只在内部按本流程阶段记录实际状态，不手工维护任务数量，也不把任务创建/更新作为对客进度消息；没有任务工具时不补写替代状态
4. 只在当前对话保留后续步骤需要的最小上下文，不创建业务进度文件

本步骤成功时不输出“环境检查完成”“任务已创建”等对客消息，直接进入 Step 2；只有安装失败、权限不足或缺少必需工具时才输出实际问题和恢复动作。

工具能力差异不得导致任务、步骤或完成状态被省略。

### Step 2: 方案规划

**必读文档**：
- `modules/mcc-reference.md` - MCC类目参考表

**产品匹配规则**：

| 场景关键词 | 推荐产品 |
|-----------|----------|
| AI、智能体、大模型、Agent、MCP | 按量付费 |
| 网站、网页、PC、电脑、电商、商城、H5 | 网站支付 |
| APP、应用内支付、手机 APP | APP 支付 |

产品能够从用户已提供的产品名称或业务描述中可靠映射时直接使用，不重复询问。仍无法唯一确定时，只执行下列固定消息命令；renderer stdout 是本轮唯一对客正文，必须把 stdout 原文作为当前回复正文发给用户，发出后立即停止并等待用户回复产品名称或明确业务描述。回复后仍无法唯一确定时继续执行同一消息，禁止自由补问或推定产品。

```bash
printf '%s' '{}' | node ../normal/scripts/render_customer_message.mjs product.clarify --variant DEFAULT
```

产品明确后复用用户已提供的业务描述匹配 MCC；仍无法确定经营类目或 MCC 时，只执行下列固定消息命令，必须把 stdout 原文作为当前回复正文发给用户，发出后立即停止并等待用户补充业务类型或 MCC。禁止自由补写 MCC 解释、示例或“是否继续”等近似问法。

```bash
node ../normal/scripts/onboarding_message_runner.mjs mcc-clarify --product-type "$PRODUCT_TYPE"
```

产品确定后，`salesCode`、`scope` 和材料要求统一取自“一、产品映射”，禁止在本步骤另建映射或改写固定值。

**MCC类目**：
- 读取 `modules/mcc-reference.md` 进行语义匹配
- 示例：互联网综合电商平台 (A0002_B0114)
- mccCode 格式：`Axxxx_Bxxxx`

**一次性方案确认**：

完成产品与 MCC 匹配后，在执行 `auth.sh init` 前一次性展示：

1. 产品名称、`salesCode` 和授权 `scope`。
2. MCC 名称与编码。
3. 当前产品在“未签约”或“需要新建应用”时可能需要的条件材料；不在状态查询前要求用户确认材料齐备状态。
4. 固定展示企业账号暂不支持通过 Skill 完成产品开通，并引导前往支付宝商家平台；这只是边界预告，不新增账号类型问题。用户已经明确表示使用企业账号时不得继续展示可确认方案，改走入口处的停止分支。

方案确认必须使用 `customer-messages.json` 的 `onboarding.plan.confirm` 当前产品变体，并执行下列命令渲染；`<VARIANT>` 只能是 `AIPAY`、`WEBPAY` 或 `APPPAY`。三个变体都固定展示企业账号边界和支付宝商家平台链接，不得删减或改写。MCC 名称、编码和特殊资质必须逐字来自 `mcc-reference.md` 同一行并通过 renderer 交叉校验；特殊资质为 `-` 时固定显示“当前类目参考表未列出”，不得解释为企业/个人资格结论。禁止自由补充主体资格、营业执照、审核规则或其他模板未列出的前提。用户明确表示企业账号要通过 Skill 完成产品开通时，改用 `onboarding.enterprise.unsupported` 并停止产品开通，不得继续生成授权或收集材料。用户要求修改产品或 MCC 时重新渲染完整摘要；旧回复失效。字段齐备后不得先输出产品判断、材料预告、企业账号提示或待办；renderer stdout 是 Step 2 唯一对客消息，必须把 stdout 原文作为当前回复正文发给用户，发出后立即停止本轮。

```bash
MESSAGE_INPUT_JSON=$(jq -cn \
  --arg mccCode "$MCC_CODE" \
  --arg mccName "$MCC_NAME" \
  --arg mccQualification "$MCC_QUALIFICATION" \
  '{mccCode:$mccCode,mccName:$mccName,mccQualification:$mccQualification}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../normal/scripts/render_customer_message.mjs onboarding.plan.confirm --variant <VARIANT>
```

产品无法可靠识别时只使用上方 `product.clarify`；产品明确但 MCC 无法可靠识别时只使用上方 `onboarding_message_runner.mjs mcc-clarify`；产品与 MCC 都明确后才进入方案确认。用户已经明确提供的信息不得重复询问，但未经用户明确确认不得执行 `login`。登录后必须先执行 Step 3.1 的只读查询，再根据实际结果收集签约、服务和应用分支的必要资料。

**阻塞规则（执行约束，不是对客正文）**：必须等待用户明确确认产品、MCC 和授权范围。确认信息有误时先更新并重新渲染标准消息；`full_process` 的项目状态回答、代码开发确认和服务声明确认均不能替代本确认。已经取得材料时继承实际图片引用、APP 名称、缺失项和校验结果，不重复采集，但仍需完成本步骤确认。缺少实际入参或校验证据时必须补齐；产品或 MCC 变化后旧回复失效。

`full_process` 的完整接入启动确认不能替代本确认；MCC 或产品变化后必须重新确认。只有输入 `1` 表示确认，其他输入按问题、修改或补充处理。

### Step 3: 登录授权

**必读文档**：
- `modules/authorization.md` - 登录授权模块

**脚本**：
- `modules/scripts/auth.sh` - 登录授权全流程（init / confirm / mismatch）

用户确认方案后读取 `modules/authorization.md`，并且只允许调用本节列出的 `auth.sh` 命令。禁止直接调用 `alipay-cli login`、解析其原始输出或展示 `verification_url`。

`auth.sh init|confirm|mismatch` 内部都会调用 `alipay-cli whoami/login/logout` 或 MCP 查询，必须按 `../normal/alipay-cli-env.md` 的联网命令规则执行。若当前 Agent 环境支持显式联网授权，首次执行这些脚本就申请联网权限；若脚本返回 `AUTH_FLOW:RETRY_WITH_NETWORK`，说明当前 Agent 执行环境没有取得可确认结果，必须申请联网权限后重试同一条完整 `auth.sh` 命令。禁止把该状态解释为用户本机网络故障、支付宝业务失败、logout/login 失败，也禁止要求用户手动 logout/login 代替本轮脚本事实。

**授权前确认继承**：Step 2 的一次性方案确认满足 `modules/authorization.md` 第三节的授权前确认要求。必须确认同一产品和 MCC 已得到用户明确确认；没有有效确认时仍禁止执行 `login`，不得因 `full_process` 阶段衔接绕过该红线。

`auth.sh init` 和后续 `app.sh key` 在 URL 完整校验通过后默认调用受控 opener，不新增业务确认。`auth.sh init` 无论 opener 结果如何都输出同一套中性授权文案；`app.sh key` 的未打开结果统一使用公钥确认兜底文案。两者都不改变下列脚本参数、MCP payload 或写操作规则。

**完整流程**：
```
1. bash modules/scripts/auth.sh init --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME"
   ├─ AUTH_FLOW:SKIP → 当前登录有效且目标产品 scope、MCC 授权有效性检查均通过，进入 Step 3.1
   ├─ AUTH_FLOW:READY → 未登录，自动 login + 输出授权信息表格，再执行第 2-3 项
   ├─ AUTH_FLOW:SCOPE_MISMATCH / MCC_MISMATCH → 停止当前操作，执行第 4 项
   ├─ AUTH_FLOW:RETRY_WITH_NETWORK → 当前 Agent 执行环境未取得可确认结果，申请联网权限后重试同一条完整命令
   └─ AUTH_FLOW:FAILED → 停止并按错误输出恢复，禁止进入 Step 3.1
2. 仅 AUTH_FLOW:READY：等待用户输入 `1` 表示已完成授权；其他输入按问题或补充处理，不得调用 confirm
3. 仅 AUTH_FLOW:READY：bash modules/scripts/auth.sh confirm --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME"
   ├─ AUTH_FLOW:AUTH_SUCCESS → 进入 Step 3.1
   ├─ AUTH_FLOW:PENDING → 等待用户完成授权，禁止自动轮询
   ├─ AUTH_FLOW:EXPIRED → 重新执行第 1 项生成授权链接
   ├─ AUTH_FLOW:RETRY_WITH_NETWORK → 当前 Agent 执行环境未取得可确认结果，申请联网权限后重试同一条完整命令
   ├─ AUTH_FLOW:FAILED → 停止并按错误输出恢复，禁止进入 Step 3.1
   └─ AUTH_FLOW:SCOPE_MISMATCH / MCC_MISMATCH → 停止当前操作，执行第 4 项
4. bash modules/scripts/auth.sh mismatch --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME"
   ├─ AUTH_FLOW:RETRY_WITH_NETWORK → 当前 Agent 执行环境未取得可确认 logout/login 结果，申请联网权限后重试同一条完整命令
   └─ 由 mismatch 统一执行一次 logout；成功后使用正确 scope 重新生成授权链接
```

对客分支固定使用消息目录：`PENDING` 用 `auth.pending`，`EXPIRED` 用 `auth.expired`，scope/MCC 不匹配用 `auth.mismatch`。这三类消息均由 `auth.sh` 在输出对应唯一 `AUTH_FLOW:*` 终态前直接调用 renderer；Agent 只消费脚本 stdout 和终态标记，禁止再次调用 renderer、另写近似话术或重复转述。公钥确认链接过期使用 `application.key.page.expired`，必须重新查询并生成页面，旧回复不得复用。

> `confirm` / `mismatch` 优先使用显式传入的非敏感授权上下文。这样即使 Agent 在沙箱化执行环境和可联网执行环境之间切换，也不依赖临时状态文件是否可见。

授权 `scope` 统一使用“一、产品映射”中当前产品的固定值，禁止自行修改。

**⚠️ 授权信息展示规范**：执行前必须读取 `modules/authorization.md` 第 5.2～6.2 节，并原样展示 `auth.sh init` 输出，禁止简写、重排或改写。该章节是完整约束来源：产品类型、经营类目、确认码和有效期四项必须展示；登录前必须校验产品名称、`salesCode`、`scope`、MCC 名称和编码属于同一固定上下文；授权 URL 只允许固定协议/域名/路径、唯一的 `deviceCode` / `productCode` / `mccCode` 和可选 `platform`，且三项必填值必须与本次上下文逐项一致。禁止展示或打开 CLI `verification_url`、其他网站、半成品、额外/重复参数 URL 或 Agent 自行拼写的 URL；确认码只用于核对，禁止引导用户输入验证码。

#### Step 3.1: 状态与资源查询（登录授权后置检查）

**只读查询组**：登录成功后自动连续执行，不增加“是否查询”确认：

授权成功后执行全部适用只读查询，不增加确认。当前 Agent 支持安全并发工具调用时可并行发起签约、应用和适用服务查询；不支持并发时按下列固定顺序连续执行。每项查询前只读取对应模块的查询章节；全部查询结束后，只有取得成功结果的分支可以继续，失败分支按错误规则恢复。

Step 5 只读取当前实际推进的签约、服务或应用模块；错误恢复时才读取 `error-handling.md`。不得提前加载其他分支，也不重复读取已经读过且未变化的章节。

1. 读取 `product-sign.md` 的查询章节，执行 `bash modules/scripts/query_sign_status.sh --sales-code "$SALES_CODE" --product-type "$PRODUCT_TYPE"`。
2. 仅按量付费读取 `service-registration.md` 的查询章节，执行 `bash modules/scripts/service.sh list`。
3. 读取 `app-release.md` 的查询章节，执行 `bash modules/scripts/app.sh list --product-type "$PRODUCT_TYPE" --sales-code "$SALES_CODE"`。该接口按 `WEBAPP` / `MOBILEAPP` 查询，不得宣称返回应用已与当前支付产品绑定。

> ⚠️ 脚本通过 `error_handler.sh` 间接初始化 `DEV_TOOL_NAME`；签约查询必须传入当前产品的 `--sales-code`，建议同时传入 `--product-type`（aipay|webpay|apppay）做一致性校验。网站支付和 APP 支付使用不同 salesCode，禁止混用。

各适用查询仍是独立 CLI/MCP 调用，必须分别完成原有错误检测，禁止伪造合并 MCP。失败后按错误类型处理：

- MCP 认证失败或产品/scope/MCC 授权不匹配：立即停止查询组，不再调用剩余查询；授权不匹配时调用 Step 3 的 `auth.sh mismatch`，由该命令统一 logout 并重新授权。重新授权后仅恢复尚未执行的查询，保留重新授权前已经成功取得且主体未变化的结果。若无法确认仍为同一账号主体，则重新执行全部适用查询。
- 单个业务失败、响应结构错误或 MCP 服务失败，但当前会话仍有效：把该分支标记为查询失败，继续其他不依赖该结果的只读查询，最后一次性输出“已取得结果 + 失败分支”摘要。不得把失败视为空列表；应用查询失败时禁止应用复用/创建，服务查询失败时禁止服务复用/新建/修改。
- 签约查询失败：只阻断签约分支；可继续应用/服务查询、候选展示、资源决策及其独立资料采集和写操作。不得推断签约状态，不得采集签约截图或签约所需 APP 名称，`signStatus` 和签约 `materialStatus` 保持未设置。签约查询恢复成功后，只有状态为 `NOT_SIGNED` 才进入签约材料类别。应用或服务查询失败也只阻断对应分支；认证失败、授权不匹配或无法确认登录主体一致时仍是全局阻断。

任何恢复都不得要求用户重交未变化且已验证的资料，也不得重做不受会话主体变化影响的成功步骤。

签约状态和 `FLOW:*` 映射只按 `modules/product-sign.md` 的“签约状态查询”执行：`SIGNED_EFFECTIVE` 与 `SIGN_SUBMITTED` 均禁止重复提交签约；`OTHER_STATUS` 不提交签约，只展示已确认结果和待核验项。Step 4 再根据脚本输出的实际状态收集签约材料并处理应用/服务候选。

### Step 4: 分支摘要与分类材料

先使用 `onboarding_message_runner.mjs discovery-summary` 展示查询摘要：签约、服务市场、应用发布各一行；网站支付和 APP 支付的服务市场由 runner/renderer 固定为“无需处理”。状态只能来自本轮脚本结果，查询失败必须显示“查询失败”，不得当作空列表。

runner 入参必须传脚本原始状态标记，禁止手写 `signingStatus`、`serviceStatus`、`applicationStatus` 等 renderer 枚举字段，禁止把候选数量、应用类型、`appId`、服务 ID 或解释性长句写入标准消息字段：

- `signStatus` 只允许 `NOT_SIGNED|SIGN_SUBMITTED|SIGNED_EFFECTIVE|OTHER_STATUS|QUERY_FAILED`。
- `serviceFlow` 仅按量付费传入，只允许 `FLOW:CREATE_NEW|FLOW:SELECT|QUERY_FAILED`；网站支付和 APP 支付不得构造或传入服务状态字段。
- `appFlow` 只允许 `FLOW:CREATE_NEW|FLOW:SELECT|FLOW:PENDING_APPLICATIONS|QUERY_FAILED`。

必须执行：

```bash
if [ "$PRODUCT_TYPE" = "aipay" ]; then
  MESSAGE_INPUT_JSON=$(jq -cn \
    --arg signStatus "$SIGN_STATUS" \
    --arg serviceFlow "$SERVICE_FLOW" \
    --arg appFlow "$APP_FLOW" \
    '{signStatus:$signStatus,serviceFlow:$serviceFlow,appFlow:$appFlow}')
else
  MESSAGE_INPUT_JSON=$(jq -cn \
    --arg signStatus "$SIGN_STATUS" \
    --arg appFlow "$APP_FLOW" \
    '{signStatus:$signStatus,appFlow:$appFlow}')
fi
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../normal/scripts/onboarding_message_runner.mjs discovery-summary --product-type "$PRODUCT_TYPE"
```

随后按“签约 -> 服务 -> 应用”的默认顺序一次只处理一个实际适用且当前可推进的类别。

每次只展示一个类别的现状、选择和缺失字段；同一类别一次收齐，只补问缺失或校验失败字段。材料收集提示只允许通过 `onboarding_message_runner.mjs material-collect` 输出：签约分支传 `--category signing`，服务分支传 `--category service`，应用分支传 `--category application`。禁止直接调用 renderer 手写 `categoryName`、`currentStatus` 或 `missingFields`，也禁止使用 `签约资料` 等同义词、`mobilePlatform`、`网站支付签约截图` 等自由文本作为 renderer 入参；常见字段别名只能交给 runner 规范化。材料收集提示必须使用：

```bash
# 当前分支先设置 MATERIAL_CATEGORY，只允许 signing|service|application
case "$CURRENT_STATUS" in
  "待补充") MATERIALS_STATE="INITIAL" ;;
  "部分已提供，待补充") MATERIALS_STATE="PARTIAL" ;;
  "校验失败，需更正") MATERIALS_STATE="INVALID" ;;
  *) echo "❌ 未知材料状态，停止渲染" >&2; exit 1 ;;
esac
MESSAGE_INPUT_JSON=$(jq -cn \
  --arg missingFields "$MISSING_FIELDS" \
  '{missingFields:$missingFields}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../normal/scripts/onboarding_message_runner.mjs material-collect --category "$MATERIAL_CATEGORY" --state "$MATERIALS_STATE"
```

`INITIAL` 不展示内部状态；`PARTIAL` 固定使用“还需补充”；`INVALID` 固定使用“以下内容需要更正”。renderer 会校验变体与 `currentStatus` 一致，禁止 Agent 自由选用不匹配话术。

用户主动提前提供后续类别材料时立即接收并校验，写入对应类别的已验证材料集合；轮到该类别时不得要求重复提供，只回显校验结果并补问剩余字段。某类别被业务错误阻断时记录该分支恢复动作并继续下一个逻辑独立类别。签约状态尚未取得时，签约资料需求仍未知，不得提前采集签约资料，也不得阻止服务或应用类别推进。

**签约分支**：

- `NOT_SIGNED` 网站支付：一次收集首页、商品页、支付页 3 张截图。
- `NOT_SIGNED` APP 支付：一次收集 APP 名称和首页、商品页、支付页 3 张截图，签约状态仍固定按 `OFFLINE` 提交。
- `NOT_SIGNED` 按量付费：签约申请无需上传页面图片。
- `SIGNED_EFFECTIVE` / `SIGN_SUBMITTED`：不再为签约采集 APP 名称或截图，禁止重复提交签约。

**应用分支**：

- 有 `ON_LINE` 候选时，展示 `app.sh list` 已清洗的事实表和完整 `APP_CANDIDATE_ID`，随后必须执行 `printf '%s' '{}' | node ../normal/scripts/render_customer_message.mjs application.candidate.select --variant ONLINE_OR_NEW`；用户只能回复当前列表中的完整 `appId` 或 `新建`，复用时不采集新建应用字段。
- 只有非 `ON_LINE` 应用时，展示脚本输出的实际状态，随后必须执行 `printf '%s' '{}' | node ../normal/scripts/render_customer_message.mjs application.candidate.select --variant PENDING_OR_NEW`；用户选择暂不新建或明确新建，禁止自动新建。
- 列表确实为空或用户选择新建时，按量付费/网站支付一次说明应用公钥要求；APP 支付必须执行下方 `APP_MOBILE_INITIAL` 固定命令，一次展示三个可创建平台组合并要求用户在一条回复中提供所选组合全部资料，禁止先单独询问 `mobilePlatform`。iOS 对应内部值 `mobilePlatform=IOS` 和 `bundleId`，Android 对应 `mobilePlatform=ANDROID`、`appPackage`、`appSign`，iOS + Android 对应 `mobilePlatform=ALL` 及三项字段；这些内部名只用于参数映射，不得作为未解释的对客字段名。字段缺失时使用 `PARTIAL` 和中文字段名，校验失败时使用 `INVALID` 和中文字段名；已通过字段不得重复收集。这些字段可在签约提交前采集和校验，但只能在 Step 5.3 创建应用时使用。HarmonyOS 不收集或编造 `mobilePlatform`、审核材料或 MCP 字段，必须执行 `printf '%s' '{}' | node ../normal/scripts/render_customer_message.mjs application.harmony.manual_create --variant DEFAULT` 并等待当前消息后的 `1`；用户完成开放平台操作后重新查询 `MOBILEAPP` 列表。只有实际返回 `ON_LINE` 候选时进入复用路径，否则应用分支转为人工待办；该等待和待办都不阻断签约及其他事实明确的独立分支。

```bash
printf '%s' '{}' \
  | node ../normal/scripts/onboarding_message_runner.mjs material-collect --category application --state APP_MOBILE_INITIAL
```

APP 支付后续补充提示只允许以下对客字段名，并按用户所选平台计算缺失项：`iOS Bundle ID（bundleId）`、`Android 应用包名（appPackage）`、`Android 应用签名摘要（appSign）`。用户在同一条回复中主动提供应用公钥时直接接收并按公钥红线处理；未提供公钥不阻止创建应用。
- 应用公钥原文只能由用户明确提供，不得生成、推断或改写；输入只用于当前 `app.sh key/verify-key` 调用，Agent 不得在回复中复述，也不得写入资料状态、普通日志或跨会话状态。资料状态只记录“已准备/未准备”。未准备公钥不阻止应用创建，但创建后必须停在设置公钥阶段。
- 目标 `appId` 已确定但用户尚未准备公钥时，自动执行 `bash modules/scripts/download_key_tool.sh`。macOS/Windows 下载到当前用户可写的默认 Downloads 目录并在脚本内部使用 `key_tool.download.result` 展示实际安装包路径、安装引导和 `https://opendocs.alipay.com/isv/02kipk` 手动下载兜底；Linux、目录不可用、网络不可达、依赖缺失、跳转不可信或包校验失败时在脚本内部使用 `key_tool.download.fallback`。该脚本 stdout 是当前动作唯一对客正文，不输出 `DOWNLOADED`、`PATH=`、`DOWNLOAD_FAILED`、`DOWNLOAD_REASON` 等机器标记；只下载，不安装、不启动、不生成密钥。本地 OpenSSL 命令生成方式仍为待定，禁止输出或执行。

**应用候选选择铁律**：`app.sh list` 只输出事实表、`APP_CANDIDATE_ID` 和 `FLOW:SELECT|PENDING_APPLICATIONS|CREATE_NEW`。只接受用户针对当前列表回复的完整 `appId`、`新建` 或 `暂不新建`，不接受序号、历史候选或 Agent 自报 `appId`。`REUSE` 后续只能使用同一完整 `appId`；用户针对当前列表明确回复 `新建` 即确认创建，不再追加回复 `1`。`CREATE` 在实际创建前必须再次执行同一 `app.sh list` 命令，候选未变化且条件字段齐备时直接创建；候选变化时旧选择失效并重新提示。

**按量付费服务分支**：轮到服务类别时使用 `service.sh list` 已清洗的事实表和完整 `SERVICE_CANDIDATE_ID`，不额外按状态过滤。列表非空时必须执行 `printf '%s' '{}' | node ../normal/scripts/render_customer_message.mjs service.candidate.select --variant DEFAULT`；只接受当前完整 `serviceId`、`新建` 或 `修改:<当前serviceId>`，候选外 ID、序号、自由格式修改、Agent 自报 ID 或历史候选均拒绝。列表为空时进入新建资料分支。选择新建/修改时在同一条回复中可提前提供完整五项服务资料；不得自行增加接口文档未定义的服务状态限制。

APP 支付未签约时的签约字段：
| 字段 | 必填条件 | 说明 |
|------|----------|------|
| APP名称 | 必填 | 传入 `ar_sign_apply.sh --app-name` |
| APP界面截图 | 必填 | 3张截图，支持拖拽上传或提供本地文件路径，顺序为首页、商品页、支付页 |

**脚本**：
- `bash modules/scripts/upload_screenshots.sh <img1> <img2> <img3>` - 上传3张截图；用户可拖拽上传图片，Agent 将拖拽后的本地文件路径传给脚本

上传成功后按首页、商品页、支付页顺序记录三个图片引用；APP 支付同时保留已校验的 APP 名称。

### Step 5: 产品开通推进

只读取当前实际推进的 `product-sign.md`、`service-registration.md` 或 `app-release.md` 动作章节；已读且未变化的查询章节不重复读取。

签约状态为 `NOT_SIGNED` 时，材料缺失或校验失败必须继续使用 `materials.category.collect` 的对应变体，只补问缺失或错误字段，禁止调用 `ar_sign_apply.sh`；当前产品全部签约材料完整且校验通过后，直接执行 5.1 固定签约脚本，不再展示写摘要或要求回复 `1`。服务创建资料完整且校验通过后，先渲染非阻塞 `service.create.summary`，随后直接执行创建命令，不要求回复 `1`；服务修改仍须展示当前会话、脱敏主体、产品、动作、目标 `serviceId` 和完整资料，并取得确认。应用创建由用户针对当前候选列表回复 `新建` 确认，候选重查未变化且应用类型/平台条件字段齐备时直接执行，不进入本写确认。用户明确提供完整应用公钥后也不增加写前确认，直接执行 `app.sh key` 生成官方确认页，由用户在该页面完成最终确认；新建应用的公钥校验成功后直接执行 `app.sh audit`，不再增加回复 `1`。

服务创建信息固定使用 `customer-messages.json` 的 `service.create.summary`。该消息非阻塞，只传入即将提交的五项服务资料；renderer 成功后同一流程直接执行 5.2 创建命令。必须执行：

```bash
MESSAGE_INPUT_JSON=$(jq -cn \
  --arg serviceName "$SERVICE_NAME" \
  --arg serviceDescription "$SERVICE_DESCRIPTION" \
  --arg serviceUrl "$SERVICE_URL" \
  --arg servicePricing "$SERVICE_PRICING" \
  --arg serviceSchema "$SERVICE_SCHEMA" \
  '{serviceName:$serviceName,serviceDescription:$serviceDescription,serviceUrl:$serviceUrl,servicePricing:$servicePricing,serviceSchema:$serviceSchema}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../normal/scripts/render_customer_message.mjs service.create.summary --variant DEFAULT
```

服务修改的外部写确认固定使用 `onboarding.write.confirm/SERVICE_UPDATE_ONLY`。`MESSAGE_INPUT_JSON` 必须由当前摘要字段通过 `jq -cn --arg` 构造，禁止手写拼接包含用户值的 JSON：

```bash
MESSAGE_INPUT_JSON=$(jq -cn \
  --arg sessionSummary "$SESSION_SUMMARY" \
  --arg subjectSummary "$SUBJECT_SUMMARY" \
  --arg productName "按量付费" \
  --arg actionTypes "服务修改" \
  --arg serviceId "$SERVICE_ID" \
  --arg serviceName "$SERVICE_NAME" \
  --arg serviceDescription "$SERVICE_DESCRIPTION" \
  --arg serviceUrl "$SERVICE_URL" \
  --arg servicePricing "$SERVICE_PRICING" \
  --arg serviceSchema "$SERVICE_SCHEMA" \
  '{sessionSummary:$sessionSummary,subjectSummary:$subjectSummary,productName:$productName,actionTypes:$actionTypes,serviceId:$serviceId,serviceName:$serviceName,serviceDescription:$serviceDescription,serviceUrl:$serviceUrl,servicePricing:$servicePricing,serviceSchema:$serviceSchema}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../normal/scripts/render_customer_message.mjs onboarding.write.confirm --variant SERVICE_UPDATE_ONLY
```

创建摘要和修改确认中的参数必须逐字来自本轮用户材料及即将执行的脚本参数；服务单价以 `service.sh validate` 输出的 `SERVICE_PRICING=<纯数字>` 为准并原样复用到 renderer 和 `service.sh save`，不得重新追加 `元/次` 或说明文字，模板会展示单位。修改确认的会话、脱敏主体和 `serviceId` 还必须来自本轮实际查询。renderer 必须拒绝 variant/动作不匹配、缺字段、多传无关字段、非按量付费服务修改、非法单价或非法 JSON。禁止加入未列动作。创建摘要不得要求用户回复或停止流程；修改时用户输入 `1` 后先核对摘要仍未变化，再执行固定修改命令，其他输入不代表确认。目标、参数、登录会话或主体变化时旧修改确认立即失效并重新展示。签约提交、服务创建、应用创建和应用提审不得使用 `onboarding.write.confirm` 重复确认。

脚本使用 `network_retry.sh` 时，业务错误只调用一次；网络/服务错误最多自动重试两次、每次间隔 3 秒。非幂等写结果为 `MAYBE_SENT` 时停止重试，使用现有只读查询核验；无法确认时明确输出未知结果，禁止盲目重复写入。自动重试预算耗尽后不立即询问“重试/退出”：记录失败动作、受影响分支和恢复方式，依赖允许时继续其他独立分支，并在 Step 6 一次收口所有仍未恢复的分支。

**阻塞规则（执行约束，不是对客正文）**：服务创建不进入阻塞确认；五项资料完整、格式校验通过且服务数量上限检查通过后，展示 `service.create.summary` 并直接创建。只有服务修改必须在同一有效登录会话、产品、动作和目标摘要后等待用户输入 `1`；CLI 未返回主体标识时，标准摘要必须说明由用户确认当前登录账号就是操作目标。启动确认、其他目标或动作的确认、沉默和仅提供资料均不能替代修改确认。签约提交不进入本阻塞确认：只有签约状态为 `NOT_SIGNED` 且当前产品所需材料全部完整并校验通过时才直接执行，缺失或校验失败继续材料提示。应用创建只接受本轮当前候选列表后的明确 `新建` 选择，候选变化必须重新选择；`app.sh key` 仅生成公钥确认页，用户提供完整公钥后直接调用，最终设置仍由用户在官方页面确认；新建应用的公钥校验成功后直接提审。登录会话、主体、产品、服务修改目标或关键金额变化时必须重新确认。服务修改确认 renderer stdout 是该动作唯一对客消息，必须把 stdout 原文作为当前回复正文发给用户，发出后立即停止本轮。

写失败或响应不明先按现有只读能力核验，禁止直接重复；尚不存在的 `appId`、公钥确认或审核结果不能提前授权。

登录、scope、MCC 是共同前置；之后三分支按自身查询、材料、选择和确认独立推进，单分支失败不阻断或回滚其他分支。默认按 5.1/5.2/5.3 串行，但不得把顺序当作签约成功依赖。认证、授权或主体变化时全局停止新操作并重新校验。

**按量付费产物**：签约固定使用 `salesCode=I1080300001000160457`、`scope=app:all,machine_pay:write,agmnt:write`；服务分支产出真实 `productionServiceId`，应用分支产出 `WEBAPP` 的 `appId`、公钥配置/支付宝公钥状态，正式 `sellerId` 来自 PID/2088。`productionServiceId` 只是跨流程用途名，不改 MCP 字段；沙箱始终使用 `api_mock_service_id`。`full_process` 只记录生产替换待办，不返回 integration 或重跑沙箱；后续独立 integration 也先用 mock，正式上线再替换。


#### 5.1 产品签约

仅 `NOT_SIGNED` 执行本节；其他状态禁止重复提交。按 `modules/product-sign.md` 的“签约提交”使用当前产品、MCC 和已验证材料执行；完整参数、固定字段、FLOW 信号和错误处理只在该模块维护。按量付费没有页面材料，产品与 MCC 已确认且本轮签约状态为 `NOT_SIGNED` 后直接提交；网站支付必须在三个图片引用均上传并通过校验后直接提交；APP 支付必须在 APP 名称和三个图片引用全部通过校验后直接提交。任一字段缺失或校验失败时回到 Step 4 的 `materials.category.collect`，禁止执行下列命令，也不增加回复 `1`。

**固定命令契约**：按当前产品原样使用对应命令结构，只替换尖括号中的实际值，禁止增删、改名或猜测参数：

```bash
# 按量付费
bash modules/scripts/ar_sign_apply.sh --product aipay --sales-code "I1080300001000160457" --mcc-code "<mccCode>"
# 网站支付
bash modules/scripts/ar_sign_apply.sh --product webpay --sales-code "I1080300001000041203" --mcc-code "<mccCode>" --picurl1 "<imageRef1>" --picurl2 "<imageRef2>" --picurl3 "<imageRef3>"
# APP 支付
bash modules/scripts/ar_sign_apply.sh --product apppay --sales-code "I1080300001000041313" --mcc-code "<mccCode>" --app-name "<APP名称>" --picurl1 "<imageRef1>" --picurl2 "<imageRef2>" --picurl3 "<imageRef3>"
```

提交成功后不等待或轮询签约生效，只记录“已提交，等待生效”。服务和应用是否推进只取决于各自前置条件，不取决于本次签约提交是否成功；复用 Step 3.1 和 Step 4 的成功结果，只在会话、主体、候选资源变化或原查询失败时刷新受影响分支，刷新失败不清除其他成功结果。

#### 5.2 服务市场注册（仅按量付费）

按 `service-registration.md` 复用、创建或修改；创建/修改必须用完整五项资料通过 `validate`。若用户提供 `0.08元/次` 或 `0.08 元/次`，以脚本校验后的 `SERVICE_PRICING=0.08` 作为唯一机器值继续后续 renderer 和 save。创建校验通过后先输出非阻塞 `service.create.summary` 并直接执行创建；修改校验通过后必须完成 `SERVICE_UPDATE_ONLY` 确认再执行。成功取得的实际 `serviceId` 记为 `productionServiceId`。保存响应不含服务状态；仅后续列表按 `serviceId` 查到时记录实际状态，否则写“状态未取得”，不得推断或重复 `save`。

**固定命令契约**：复用已有服务不调用 `save`；创建不传 `--service-id`，修改必须传入用户从 Step 3.1 候选中选定的实际 `serviceId` 和全部字段：

```bash
bash modules/scripts/service.sh validate --name "<name>" --desc "<desc>" --url "<url>" --pricing "<pricing>" --schema "<json>"
# 创建：先成功渲染 service.create.summary/DEFAULT，再直接执行
bash modules/scripts/service.sh save --name "<name>" --desc "<desc>" --url "<url>" --pricing "<pricing>" --schema "<json>"
# 修改：先取得 onboarding.write.confirm/SERVICE_UPDATE_ONLY 的有效确认，再执行
bash modules/scripts/service.sh save --service-id "<serviceId>" --name "<name>" --desc "<desc>" --url "<url>" --pricing "<pricing>" --schema "<json>"
```

#### 5.3 应用发布

**应用分支**：按量付费/网站支付使用 `WEBAPP`，APP 支付使用 `MOBILEAPP`。复用 Step 3.1 候选和 Step 4 条件资料，按 `modules/app-release.md` 执行复用或新建、设置/校验应用公钥和提审；产品上下文、平台字段、`appSign` 边界、MCP 参数和返回处理只在该模块维护。APP 支付通过 Skill 创建只支持 `IOS`、`ANDROID` 和 `ALL`，其中 `ALL` 只表示 iOS + Android。HarmonyOS 移动应用不得调用 `app.sh create`；执行固定 renderer 命令输出 `application.harmony.manual_create`，用户在开放平台完成创建及平台要求的后续配置后回复 `1`，再重新执行 Step 3.1 的应用列表查询。只有实际查询到 `ON_LINE` 候选后才能按既有复用路径继续，否则应用分支保持人工待办。

**固定命令契约**：以下命令只允许替换实际值，禁止把位置参数改写为 `--app-id`、`--public-key` 等未定义选项。`reuse/key/verify-key/audit` 使用的 `appId` 必须逐字复用 Step 3.1 中用户选定的候选 ID，或本轮 `create` 输出的 `APP_ID`；禁止从其他候选、历史轮次或示例中替换。

```bash
# 按量付费/网站支付新建 WEBAPP
bash modules/scripts/app.sh create --product-type "<aipay|webpay>" --sales-code "<当前产品码>"
# APP 支付新建 MOBILEAPP：Skill 内只允许以下三种平台组合
bash modules/scripts/app.sh create --product-type apppay --sales-code "I1080300001000041313" --mobile-platform IOS --bundle-id "<bundleId>"
bash modules/scripts/app.sh create --product-type apppay --sales-code "I1080300001000041313" --mobile-platform ANDROID --app-package "<appPackage>" --app-sign "<appSign>"
bash modules/scripts/app.sh create --product-type apppay --sales-code "I1080300001000041313" --mobile-platform ALL --bundle-id "<bundleId>" --app-package "<appPackage>" --app-sign "<appSign>"

# HarmonyOS：禁止调用 app.sh create，只渲染固定人工创建指引。
printf '%s' '{}' | node ../normal/scripts/render_customer_message.mjs application.harmony.manual_create --variant DEFAULT
# 下列四个子命令的 appId/publicKey 均为位置参数
bash modules/scripts/app.sh reuse "<appId>"
bash modules/scripts/app.sh key "<appId>" "<用户明确提供的完整publicKey>"
bash modules/scripts/app.sh verify-key "<appId>" "<同一publicKey>"
bash modules/scripts/app.sh audit "<appId>"
```

**复用应用**：执行 `bash modules/scripts/app.sh reuse "<appId>"`，其中 `<appId>` 必须逐字来自本轮最近一次 `app.sh list` 的实际候选，并由用户按完整 ID 选定；不接受序号、历史候选或 Agent 转换值。复用已有 `MOBILEAPP` 时不需要采集 `mobilePlatform`、`bundleId`、`appPackage` 或 `appSign`；这些字段仅在新建 `MOBILEAPP` 时需要。

仅 `CREATE` 分支在实际创建前重查应用列表；结果未变且条件字段齐备时不增加用户确认并直接创建，结果变化时更新候选并要求用户重新选择，重查失败时禁止创建但不回滚其他分支。非 `ON_LINE` 应用不可复用；`FLOW:PENDING_APPLICATIONS` 必须由用户选择暂不新建或新建，禁止当作空列表。

用户完成公钥页面确认后自动校验，不再询问是否校验；应用公钥校验失败或 RSA2 项未返回支付宝公钥时禁止提审。新建应用校验成功后直接执行 `app.sh audit`，不再询问是否提审。已取得支付宝公钥但未能写入本地文件时，不阻塞自动提审，但必须记录 `MANUAL_CONFIGURATION_REQUIRED`；只有实际导出成功时才记录公钥文件路径。HarmonyOS 人工创建分支不得调用 `app.sh create/key/verify-key/audit`；只有后续应用列表实际返回 `ON_LINE` 候选时，才能按既有复用路径校验并导出支付宝公钥。最终只保留实际取得的 `appId`、应用状态和公钥导出状态供集成使用。

用户提供完整公钥后，在当前没有其他待用户回复的确认时直接调用 `app.sh key`，不增加无必要的停等。脚本在 URL 校验通过后默认调用受控 opener，并在脚本内部执行 renderer 输出 `application.key.page`；Agent 不得直接手写或手动渲染该消息来替代 `app.sh key`。页面成功打开使用 `OPENED`；任何未打开结果统一使用 `OPEN_FAILED`，不向用户区分失败、无 GUI 或仅链接等底层原因。两种对客结果都输出同一实际裸 URL、复制访问兜底和“支付宝扫码确认应用公钥完成后请输入 1”；页面生成响应不明时进入 `UNKNOWN`，不得自动生成第二个页面。

复用应用返回 `FLOW:REUSE_NO_KEY` 时，必须将应用分支标记为未完成，不得输出复用成功，并执行下列命令说明当前应用缺少已确认 RSA2 应用公钥。该消息不增加二次确认：目标 `appId` 已由用户从当前候选中选定，随后直接进入当前应用的设钥准备；如果用户在消息后明确要求重新选择或新建应用，再返回 Step 4 重新决策。取得用户明确提供的完整应用公钥后执行 `bash modules/scripts/app.sh key "<同一appId>" "<用户明确提供的完整publicKey>"`；用户完成公钥确认页后执行 `verify-key`，确认成功后重新执行 `bash modules/scripts/app.sh reuse "<同一appId>"`，不得跳过应用状态与支付宝公钥检查，也不得改变参数形式或替换 ID。

```bash
MESSAGE_INPUT_JSON=$(jq -cn --arg appId "$APP_ID" '{appId:$appId}')
printf '%s' "$MESSAGE_INPUT_JSON" | node ../normal/scripts/render_customer_message.mjs application.reuse.no_key --variant DEFAULT
```

### Step 6: 本轮流程收口

`integration_only` 不应进入本步骤。`onboarding_only` 和 `full_process` 按实际请求范围处理后续衔接；`full_process` 只保留两个子流程的实际状态，不转换成另一套状态。

**完成条件**：当前登录、scope 和 MCC 必须有效；签约必须由实际查询确认为已生效；仅按量付费适用的服务分支必须复用或保存成功并取得实际 `serviceId`；应用必须达到 `ON_LINE`、应用公钥已生效且支付宝公钥已实际导出。存在失败、未知、待生效、待审核或人工配置时不得宣称产品开通完成。不维护人工完成条件数量。

使用 `../normal/customer-messages.json` 的 `process.partial_result` 消息逐分支收口，必须通过 `onboarding_message_runner.mjs closeout` 托管输出。自动重试耗尽、业务错误或查询失败且到本步骤仍未恢复的动作，统一写入对应分支结果和 `remainingActions`，只说明一次，不在收口后再次询问是否重试。必须执行：

`SIGNING_RESULT`、`SERVICE_RESULT`、`APPLICATION_RESULT` 和 `INTEGRATION_RESULT` 必须使用消息目录允许的状态枚举原文，禁止拼接 `appId`、公钥文件路径、错误码、截图证据或其他自由文本；这些证据只保留在脚本输出、内部事实或人工待办字段中，不能污染分支结果枚举。

```bash
MESSAGE_INPUT_JSON=$(jq -cn \
  --arg productName "$PRODUCT_NAME" \
  --arg processResultTitle "$PROCESS_RESULT_TITLE" \
  --arg integrationResult "$INTEGRATION_RESULT" \
  --arg sandboxConfigState "$SANDBOX_CONFIG_STATE" \
  --arg signingResult "$SIGNING_RESULT" \
  --arg serviceResult "$SERVICE_RESULT" \
  --arg applicationResult "$APPLICATION_RESULT" \
  --arg remainingActions "$REMAINING_ACTIONS" \
  --arg manualVerificationItems "$MANUAL_VERIFICATION_ITEMS" \
  --arg applicationOperationAppId "${APPLICATION_OPERATION_APP_ID:-}" \
  --arg applicationOperationActualStatus "${APPLICATION_OPERATION_ACTUAL_STATUS:-}" \
  --arg applicationOperationNextAction "${APPLICATION_OPERATION_NEXT_ACTION:-}" \
  --arg nextFlowReminder "$NEXT_FLOW_REMINDER" \
  '({productName:$productName,processResultTitle:$processResultTitle,integrationResult:$integrationResult,signingResult:$signingResult,serviceResult:$serviceResult,applicationResult:$applicationResult,remainingActions:$remainingActions,nextFlowReminder:$nextFlowReminder}
    + if $sandboxConfigState == "" then {} else {sandboxConfigState:$sandboxConfigState} end
    + if $manualVerificationItems == "" then {} else {manualVerificationItems:$manualVerificationItems} end
    + if $applicationOperationAppId == "" and $applicationOperationActualStatus == "" and $applicationOperationNextAction == "" then {} else {applicationOperationAppId:$applicationOperationAppId,applicationOperationActualStatus:$applicationOperationActualStatus,applicationOperationNextAction:$applicationOperationNextAction} end)')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node ../normal/scripts/onboarding_message_runner.mjs closeout
```

`onboarding_only` 的代码开发栏写“不在本轮执行范围”，`SANDBOX_CONFIG_STATE` 传空字符串，`MANUAL_VERIFICATION_ITEMS` 传空字符串，并把 `nextFlowReminder` 固定为“还需完成支付产品-代码开发，才能在业务系统中实际发起支付。”。`full_process` 中，代码开发全部通过时填“已完成”并传 `READY`；只有沙箱待配置且其余代码与安全检查通过时填“部分完成，沙箱配置待完成”，并原样传 `CREATE_PENDING|VERIFY_PENDING`；沙箱为 `READY` 且代码开发只剩非阻塞人工待验证项时填“部分完成，人工待验证”，传 `READY`，把代码开发 checklist 的 `manualItems` 原样作为 `MANUAL_VERIFICATION_ITEMS` 传入，并在 `REMAINING_ACTIONS` 中写明“完成下方人工待验证项”或同等实际待办，禁止传“无”；把 `nextFlowReminder` 固定为“代码开发已在本轮执行；后续只按上表实际待办继续。”，该值仅用于 renderer 校验执行模式，`full_process` 最终对客不展示“后续衔接”行。renderer 会校验结果与沙箱状态、人工待验证项一致，并派生恢复口令或人工待验证展示行；该展示不增加确认点或用户回复要求。不得在其 stdout 前后单独追加衔接提醒，不伪造本轮代码修改、沙箱创建或测试结果，也不重复进入 integration。

若 `full_process` 最后一跳紧接着应用创建、审核提交或复用结果，不再单独输出一条 `application.operation.result` 后又立刻输出本收口消息；必须把同样的 `appId`、实际状态和下一步分别记录为 `APPLICATION_OPERATION_APP_ID`、`APPLICATION_OPERATION_ACTUAL_STATUS`、`APPLICATION_OPERATION_NEXT_ACTION`，交给 closeout runner 处理，且 `APPLICATION_OPERATION_ACTUAL_STATUS` 必须与 `APPLICATION_RESULT` 枚举原文一致。应用结果已为“已上线且配置完整”时不再展开“应用分支结果”，由结果表和上线前检查块承接；待审核、待设置公钥、需人工配置、失败或结果未知时合并展示为“应用分支结果”并保留完成态红线。`onboarding_only`、应用分支仍需等待用户补材料/确认，或应用操作结果不是紧邻 Step 6 最终收口时，仍按应用模块原规则输出 `application.operation.result`。合并展示不得改写应用完成条件，待审核、待设置公钥或待人工配置时仍不得表述为应用发布完成。

当且仅当签约结果为“已提交，等待生效”且应用结果为“已提交审核，等待上线”时，renderer 从消息目录自动在 `remainingActions` 后追加状态查询提示；该提示不是 flow 入参，Agent 禁止自行传入、拼接或在模板外重复输出。其他结果组合不展示该提示。

renderer 还会按 `productName` 和分支完成条件自动派生上线前检查块。Agent 不传入、不改写该字段，也不得在模板外补第二份生产上线清单。该检查使用“【当前状态】/【上线前有以下关键点】/【提示】/【其他】”结构，不单列“相关站点”，也不在模板尾部追加第二个查询入口；必要 URL 只放在具体操作步骤中。完成态只能表述为代码开发和产品开通流程已完成，不得替用户确认生产配置已替换、产品真实可收款或应用页面状态；上线条件固定引导用户前往支付宝 AI 付站点，进入一站式接入 → 选择产品 → 密钥配置查看产品开通和应用上线情况；正式参数以生产 `appId`、应用公钥、应用私钥、支付宝公钥和生产网关为核心；网站支付和 APP 支付必须完成公网 HTTPS `notify_url` 的验签、关键字段校验、幂等、`success` 回写和补偿查询；按量付费必须把沙箱 `api_mock_service_id` 替换为服务市场真实 `serviceId`，A2M 示例中的 `sellerId` 来自商户 PID/2088，由商家自行在支付宝平台确认，不由 Agent 猜测、生成或代填。生产环境应用私钥、账号密码、支付凭证和未脱敏通知内容仍禁止提供给 Agent。分支未完成时，该派生块必须明确上表待办完成前不能正式收款。该提示只在消息目录维护，不增加用户确认点，Agent 不得在模板外重复输出或改写。

签约、服务和应用分别按本轮脚本实际结果表达：签约提交成功但未生效时，`signingResult` 固定使用“已提交，等待生效”；服务创建或修改成功且取得 `serviceId`、但未取得服务状态时，`serviceResult` 分别固定使用“创建成功，状态未取得”或“修改成功，状态未取得”；应用按消息目录的实际阶段枚举填写。任一分支失败或结果未知不清除其他分支成功，也不能概括为“全部失败”。

只输出实际取得且有判断依据的费率、`serviceId`、`appId`、应用状态和公钥导出状态；没有取得的字段进入确定的下一步，不使用占位值、空值或推断值。只有签约为“已生效”、按量付费服务已复用或保存成功并取得实际 `serviceId`（消息值为“已复用”“创建成功，状态未取得”“修改成功，状态未取得”或“已完成”；网站支付和 APP 支付为“无需处理”）、应用为“已上线且配置完整”且剩余待办为“无”时，`processResultTitle` 才能使用“支付产品-产品开通已完成”；否则固定使用“流程进展”。“状态未取得”只表示保存响应未提供服务状态，不得改写为保存失败；renderer 会交叉校验这些条件，禁止在模板外另写相反结论。

使用 TaskUpdate 只把已经实际执行并取得结果的内部任务标记为 completed。签约待生效、应用待审核、人工配置或其他外部待办必须保持 pending 或在用户可见待办中明确列出，不得为了结束本轮对话把这些事项标记为 completed。对于 `full_process`，此处只表示 onboarding 子流程已执行至当前可推进终点；最终是否完成直接依据两个子流程的实际结果和待办，不得另建状态推断。

---

## 四、错误处理（全局规则）

签约流程的任何 CLI 命令（包括 MCP、login、whoami、logout 和 file upload）执行后都必须立即使用脚本内置错误检测；失败时禁止继续解析业务结果。认证、联网、授权不匹配和业务错误以 `modules/scripts/error_handler.sh` 与 `modules/error-handling.md` 为准；依据不足执行 `SKILL.md` 的禁止编造规则；Step 3.1 查询失败仍按分支隔离。

---

## 五、当前会话事实

- 只记录当前已确认的产品、MCC、已验证材料、当前候选和脚本结果。
- 每次开始都重新执行授权校验和全部适用只读查询；用户提前提供且仍可直接验证的材料可以复用，无法验证时重新收集。
- 外部写结果明确成功时保留实际结果；结果不明时立即用现有只读能力核验。无法确认就输出未知和下一步，禁止把断电、超时或本地状态丢失解释为外部失败，也禁止自动重复写入。
- 用户为当前应用设钥明确提供的应用公钥只用于本次 `app.sh key/verify-key` 调用；Agent 回复不得复述，普通对话状态和日志不得保存。私钥、token、临时 URL、签名串、完整支付表单和 MCP 原始响应同样不得进入普通对话状态或日志；`appSign` 仅指 Android 应用签名摘要。
