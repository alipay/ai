<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_CORE:START -->
# 支付产品-产品开通流程说明

> ⚠️ **前置声明**：本 flow 仅支持 **AI 网页应用收款、AI 移动应用收款、AI 按量付费**三种产品的产品开通。原有“网站支付”“APP 支付”“按量付费”仍作为输入别名和资源目录名。**其他产品（当面付、订单码支付、JSAPI支付、预授权支付、商家扣款等）暂不支持**，如需开通请前往[支付宝商家平台](https://b.alipay.com/page/portal/home)完成。

---

## 执行入口与重启原则

只通过当前 Skill 绝对路径下的统一 runtime 按 marker 加载阶段，本 flow 是唯一执行依据：`entry`；非阻塞方案后 `execute --product-type "$PRODUCT_TYPE"`；发现后 `branch-summary`；轮到分支时 `signing|service|application --product-type "$PRODUCT_TYPE"`；最后 `closeout`。`onboarding-bootstrap`、`onboarding-execute-ready` 只合并无对客 stdout 的胶水动作，串行调用真实 action，不跨用户输入、页面交付或业务写入，不重复原子命令。禁止整份预读；统一单命令规则继承 `runtime-entry.md`。仅脚本异常、用户要求解释或 phase 明示缺少依据时读当前一个模块，禁预读分支、凭记忆拼 MCP 或绕过 `auth.sh`。

每次开始先校验登录、scope 和 MCC，再查签约状态、应用候选和适用服务候选，只依据当前真实结果继续。不得按历史对话推定外部操作结果。

步骤顺序固定为方案展示后自动授权，再执行适用只读查询，最后处理独立分支。查询失败只阻断对应分支，不当作空列表；其他成功分支可继续。

方案展示前只按本轮 `mcc.sh resolve-plan` 结果陈述 MCC 名称、描述和特殊资质。Agent 可从用户原始经营描述提炼有依据的行业概念和同义表达；本地词面结果不明确时，runner 会把同一次 `queryMcc` 返回的当前产品 MCC 名称和描述以一次性目录复核 marker 交给 Agent，Agent 只能返回目录引用，runner 再映射并校验为当前动态目录中的候选。`ar-support.queryMcc`、按需 `mccsearchservice.batchQueryMcc` 及候选快照的完整执行和失效规则见步骤 2；无查询依据的结论禁止推断。

---

## ⛔ 核心铁律

每个阶段 bundle 附带最小全局护栏，后续只补当前授权、材料或写分支规则；`SKILL.md` 红线适用于全部步骤。Onboarding 禁止修改用户项目代码或支付配置，只输出用户自行应用的配置。CLI 上下文由脚本设置 `PLATFORM`、`PLATFORM_ID`、`ALIPAYCLI_BIZ_INFO`、`PRODUCT`；`aipay|webpay|apppay` 严格映射为 `AIPAY|WEBPAY|APPPAY`，`PRODUCT` 和业务信息不进 MCP JSON，禁硬编码或分号拼环境。scope/MCC 不匹配只走 `auth.sh mismatch`；logout 后置条件未成立不得重授权；`RETRY_WITH_NETWORK|RETRY_WITH_LOCAL_FS_PERMISSION` 分别申请联网或 CLI 私有状态目录权限后原样重试，不解释为用户本机 login/logout 失败或支付宝业务失败。签约 `request+ctx` 与应用/服务 `request` 由脚本冻结，禁止绕开脚本混用或重组。

### 标准消息执行规则

继承已加载的 `runtime-entry.md` 对客 stdout、内部行、schema/renderer fallback 和统一单命令规则。动作有 runner/script 时只执行动作处完整命令，禁止拆回 `jq/printf/renderer` 或追加管道；失败停步且不手写兜底。统一 runtime 不依赖 cwd；Onboarding 不改用户项目，本机路径须显式传规范化绝对路径。

### 耗时事件规则

`start-run` 已确定 `RUN_ID`；stage 由登记动作在前台固定 event/c4 并执行最长 3 秒的同步上传，Agent 不重复手工上报。每个会生成 stage 的命令前回顾当前可见用户消息得到 `HISTORY_COUNT`，并传入下文登记的 gateway 内部参数；无法可靠回顾时用 `null`。遥测失败不改变业务、卡点或对客交付；诊断只按需读 `../normal/telemetry.md`。

---

## 主流程概览

```
Step 1: 方案规划 → Step 2: 环境检查 → Step 3: 登录授权
    → Step 3.1: 三分支只读发现 → Step 4: 分支摘要与分类材料
    → Step 5: 独立分支推进 → Step 6: 分支级收口
```

### 启动前材料预告与分流

先确定唯一产品；未确定时只澄清业务场景，不一次展示三产品材料。Step 1 简短预告当前产品条件材料，不要求确认齐备；登录查询后展示三分支短摘要，再一次只收集一个可推进类别。`full_process` 在 integration 完成后进入，进入前不展示或收集签约材料。

**执行规则**：
- 网站支付或 APP 支付确定为 `NOT_SIGNED` 且签约页面材料尚不存在时，只把签约分支置为 `WAITING_USER`；服务/应用分支仍按自身条件推进。`onboarding_only` 不得因此修改项目或切换意图，只在收口时提醒仍需代码开发。若页面和支付能力已存在、仅缺首页、商品页、支付页图片，则在签约材料类别收集并上传；已签约时不再要求这组图片。
- 截图要求以“支付页”为准；支付页指展示支付宝付款方式，等待用户去支付的页面，不得自行改口为“支付成功页”或要求用户提供文档未定义的页面。
- `full_process` 按 `../normal/full-process-routing.md` 的完整接入编排先完成 Integration 的实际修改与校验，再进入本流程；不得提前登录、查询或收集产品开通材料。

---

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_CORE:END -->

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_ENTRY:START -->
<!-- GENERATED:ONBOARDING-GUARDS-SHARED:START -->
共享护栏：`P-MCP-CONTRACT-FROZEN` 仅用已验证脚本；禁推断或尝试近似方法；`P-AUTH-BEFORE-ONBOARDING` 登录/scope/MCC 未通过前禁查询和写入；`P-SENSITIVE-STATE` 公钥限当前 app 调用且禁复述/保存；敏感值禁入回复/摘要/日志/状态/宽权限文件；临时 URL 仅由登记动作展示；`P-CUSTOMER-OUTPUT-EXCLUSIVE` 登记 stdout 原文是唯一正文；阻塞送达后立即等待；`P-ONBOARDING-CONTROL-CHANNEL` 内部行禁对客；正文为空按唯一终态转移；`P-DETERMINISTIC-HANDOFF` 仅执行登记命令并按唯一终态转移；禁追加解析；失败只走登记恢复。
<!-- GENERATED:ONBOARDING-GUARDS-SHARED:END -->
环境检查、产品/MCC 澄清或方案展示前先执行平台入口。`onboarding_only` 正常由 `onboarding-bootstrap --root-intent onboarding_only [--product-type "$PRODUCT_TYPE"]` 包含本动作和 entry 加载；仅原子 fallback 或 `full_process` 衔接时执行：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message platform-entry --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

- Windows：runner 优先从正式 run 取 `run_id` 生成 `platform_id`，没有正式 run 时退回当前会话可用的平台标识；禁止 Agent 传入或拼接；消息渲染会在有正式 run 时终结 run，送达唯一 stdout 后停止 Onboarding；`full_process` 保留 Integration 结果。
- 非 Windows：成功且 stdout 为空即继续；失败或输出不唯一时停止核对，禁止手写引导。

用户明确要用企业账号通过 Skill 开通时执行下列消息并停止 Onboarding；不得主动询问账号类型，也不得从 MCC、营业执照或“公司”等描述推断。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message enterprise-unsupported --variant <ONBOARDING_ONLY|FULL_PROCESS> --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

`onboarding_only` 固定 `ONBOARDING_ONLY`，`full_process` 固定 `FULL_PROCESS`。原文送达最终 stdout 后停止，不执行 Step 6 或追加收口。

## 产品映射

“AI 网页应用收款”覆盖电脑网页和手机浏览器/H5；网站支付等旧称是输入别名。签约 `appType=PC_WEB` 不代表仅限 PC。

| 产品 | productType | CLI `PRODUCT` | salesCode | scope | 资料采集要求 |
|------|-------------|---------------|-----------|-------|-------------|
| AI 按量付费 | aipay | AIPAY | I1080300001000160457 | app:all,machine_pay:write,agmnt:write | 无需截图 |
| AI 网页应用收款 | webpay | WEBPAY | I1080300001000041203 | app:all,fast_instant_trade_pay:write | 需要3张网站截图 |
| AI 移动应用收款 | apppay | APPPAY | I1080300001000041313 | app:all,auth_alipay_apppay:write | 未签约时需要 APP 名称和 3 张 APP 界面截图，签约状态固定按 `OFFLINE` 提交；选择新建应用时在 Step 4 前置采集移动平台信息，Step 5.3 才用于创建 |

## Step 详解

### Step 1: 方案规划

**产品匹配规则**：

| 场景关键词 | 推荐产品 |
|-----------|----------|
| AI、智能体、大模型、Agent、MCP | AI 按量付费 |
| 网站、网页、PC、电脑、电商、商城、H5 | AI 网页应用收款 |
| APP、应用内支付、手机 APP | AI 移动应用收款 |

已有描述能唯一映射时直接使用；否则只执行下列命令，原文送达 stdout 后等待明确产品。仍不唯一时重复同一消息，禁止自由补问或推定。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message product-clarify --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

产品明确但无经营描述/MCC：执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message mcc-clarify --product-type "$PRODUCT_TYPE" --root-intent "$ROOT_INTENT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`。该命令必须先创建或复用正式 telemetry run 并记录 `clarify_intent`；缺少或非法 `ROOT_INTENT` 时停止，不得继续 MCC 或授权。

已有经营描述、二级类目名称或编码时，以原话作为 `MCC_SEARCH_QUERY` 进入唯一 MCC 解析/方案入口。非精确编码时，Agent 应先理解原话；遇到行业俗称、场景表达或目录不一定直接出现的用词时，在首次调用中一并传入 0 到 12 个有原话依据的行业概念、经营对象或同义表达，形成 `MCC_SEMANTIC_TERMS_JSON`；只传概念，不补原话无依据的行业。没有可靠扩展时省略，不追加用户确认。runner 在完整动态类目内做 NFKC、泛词剥离、标点边界内二/三元词组召回和动态稀有度排序；原始精确编码/完整名称决定性优先，其余原话与 Agent 辅助概念联合评分，语义项按 `0.7` 权重参与，名称证据高于描述，其他候选最多 8 项。若本地结果为 `NONE`、候选冲突或仅由低置信语义词产生，runner 只发出一次 `MCC_AGENT_REVIEW_REQUIRED`，其中包含当前动态目录的稳定引用、名称和描述；Agent 必须基于该目录返回最多 8 个引用，并在同一原始 query 下用 `--agent-candidate-refs-json` 重跑，runner 只接受本轮目录中的引用。目录复核不新增 MCP 或网络调用，也不替代本地校验；禁止业务词到 MCC 的硬编码点映射、自由提交 MCC code、远程语义或额外网络调用。

同一 `run + 用户输入 + 原始 MCC_SEARCH_QUERY + 产品` 的语义扩充最多重试 2 次。首次未提供语义词且结果为 `NONE`，或已提供语义词但结果仍为 `NONE` 且仍有预算时，`mcc.sh` 只输出唯一内部 `MCC_SEMANTIC_RETRY_REQUIRED`，stdout 为空；Agent 必须保留原始 query、复用同一 `USER_INPUT_ID`，根据原话补充此前未使用且有依据的概念后原样重跑本命令，不向用户展示中间无匹配。后续重试提交的语义词必须保留此前语义词并至少新增一个此前未使用的词；未新增或替换原语义词时不消耗额度，直接进入既有无匹配分支。`MCC_SEMANTIC_RETRY_REQUIRED` 的 `attempt` 从 1 到 2，达到 2 后不再产生该 marker；仍为 `NONE` 时输出下方既有无匹配文案并停止。精确 MCC 编码不存在不进入语义重试；网络/CLI 失败仍只走各自既有恢复分支。语义重试计数只保存在当前 run 的私有缓存中，不随 MCC 树缓存 TTL 过期，读写异常按已耗尽处理，禁止通过更换 query、重置参数或重复调用绕过上限。

`queryMcc` 树和多候选快照使用默认 1800 秒、本轮 run 私有缓存；无有效 run 不缓存。快照绑定产品、salesCode、原查询、规范化语义词、选择回执、候选树事实及按需取得的资格详情；有效命中原样复用，失效才重查。runner 只接受最多 12 项、单项 2 到 40 字符、总计不超过 240 字符的 JSON 字符串数组并拒绝 MCC 编码；Agent 参数错误时基于原话更正或省略，不要求用户重述。两种 MCP 请求体不变；`batchQueryMcc` 最多一次，只传树内命中且 `needSpecialQual=true` 的候选编码。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" mcc resolve-plan --query "$MCC_SEARCH_QUERY" --product-type "$PRODUCT_TYPE" --root-intent "$ROOT_INTENT" [--semantic-terms-json "$MCC_SEMANTIC_TERMS_JSON"] [--agent-candidate-refs-json "$MCC_AGENT_CANDIDATE_REFS_JSON"] --input-id "$USER_INPUT_ID" [--telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT"] --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

只收唯一 `ALIPAY_AIPAY_INTERNAL:MCC_QUERY_RESULT=SUCCESS` 与 `ALIPAY_AIPAY_INTERNAL:MCC_RESOLUTION=<json>`。若同时收到唯一 `ALIPAY_AIPAY_INTERNAL:MCC_AGENT_REVIEW_REQUIRED=<json>` 且 stdout 为空，Agent 读取其中稳定引用、名称和描述，最多返回 8 个当前目录引用后用同一 query、语义词和 `USER_INPUT_ID` 原样重跑一次；不得把该 marker 或中间状态展示给用户。目录复核最多一次，不消耗语义扩充预算；未返回有效引用时沿用本地结果并继续既有 `NONE`/候选分支。若同时收到唯一 `ALIPAY_AIPAY_INTERNAL:MCC_SEMANTIC_RETRY_REQUIRED=<json>` 且 stdout 为空，按上面的规则在同一工作回合自动重跑；不得把该 marker 或中间状态展示给用户。`UNIQUE` 恰一项，并有唯一 `CUSTOMER_MESSAGE_DELIVERY_REQUIRED=onboarding.plan.confirm`、`MCC_CONTEXT_RECEIPT`；先把 stdout 作为可见进行中消息原文送达，随后同一回合进入 `execute`，不等待回复。`MULTIPLE` 送候选后等待；预算耗尽的 `NONE` 送既有无匹配文案后等待用户重新描述。禁止旧 `mcc-search`/`mcc-candidates`、手写候选或近似追问。

`MCC_FLOW:RETRY_WITH_NETWORK`：联网后原样重试同一 `mcc resolve-plan`。`CLI_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION` 且 stdout 空：给同命令 CLI 私有状态目录权限后原样重试。失败停 MCC；禁无匹配兜底或进方案/授权/签约。

`ALIPAY_AIPAY_INTERNAL:MCC_QUERY_RESULT=FAILED` 且无 `MCC_FLOW:RETRY_WITH_NETWORK`：送stdout，停MCC；非无匹配，禁候选/方案/授权/签约。

`MULTIPLE` 还须取得唯一 `MCC_SELECTION_RECEIPT`。用户回复序号、当前候选完整名称或编码时，以原始 `MCC_SEARCH_QUERY` 和首次检索使用的同一 `MCC_SEMANTIC_TERMS_JSON` 重跑同一入口：`node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" mcc resolve-plan --query "$MCC_SEARCH_QUERY" --product-type "$PRODUCT_TYPE" --root-intent "$ROOT_INTENT" [--semantic-terms-json "$MCC_SEMANTIC_TERMS_JSON"] --select "$SELECTED_MCC_CODE" --selection-receipt "$MCC_SELECTION_RECEIPT" --input-id "$USER_INPUT_ID" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`。有效详情快照直接生成方案，不再调用 `queryMcc` 或 `batchQueryMcc`；runner 仍校验当前 run、产品、原话、规范化语义词、候选和事实哈希。receipt 或快照失效时不得沿用或自动套用旧选择，必须基于完整当前产品目录重新召回并至少重新展示一次当前候选。

用户指定的 MCC 不在候选中时，按该 MCC 重新查询，不沿用旧候选回执，也不要要求用户换类目。

`salesCode`、`scope` 和基础材料只取“产品映射”。方案只由 `mcc resolve-plan` 或已有唯一 MCC 事实时的 `onboarding-message plan-confirm --root-intent "$ROOT_INTENT" --mcc-context-receipt ... [--telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT"]` 生成，展示产品/scope、MCC、特殊资质、企业账号边界及商家平台链接。已有 active run 时必须传 telemetry 参数；如果该命令首次创建 run，则尚无 marker，省略参数并由同一进程把本次 plan stage 的 history 固定为 0，命令返回后取得后续使用的 `RUN_ID`。`ROOT_INTENT` 取当前路线根意图，只能是 `onboarding_only` 或 `full_process`。特殊资质只来自 `qualificationGroups`：多个 group 是 OR 关系；同一 group 内多个 qualifications 是 AND 关系；`attaType` 为空或 null 的 qualification 只展示 `qualName`，不生成上传项。禁止补充模板外资格或审核规则。

不得保留“先运行旧字符串搜索，无匹配后再临时让 Agent 猜”的无边界两阶段流程，或重复询问已知信息；目录复核是完整 `queryMcc` 事实上的一次受限 Agent 判断，必须在 `MCC_AGENT_REVIEW_REQUIRED` marker 后立即完成，最多一次且不增加用户确认。语义重试只允许按上一段登记的两次预算执行。语义概念、目录引用与原话必须在同一次 `resolve-plan` 中提交并统一校验。唯一事实校验通过、方案 marker 唯一且 stdout 已送达后，执行 `onboarding-execute-ready --product-type "$PRODUCT_TYPE"`；缺值/冲突/非唯一继续澄清，产品/MCC 变更重渲染。`execute` loader 只继承 `clarify_intent` 已记录的正式 run 事实，不再单独记录 stage，不代表新增用户回复，禁手工上报；Agent 在收到每条聊天框用户消息时，必须先按 `runtime-entry.md` 的统一前置命令计数，不按是否与 Skill 相关筛选，`summary` 收口后不再计入当前 run，`full_process` 不重置。

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_ENTRY:END -->

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_EXECUTE:START -->
<!-- clarify_intent 已由 start-run 记录，这里不再单独上报 flow start stage -->
<!-- GENERATED:ONBOARDING-GUARDS-EXECUTE:START -->
<!-- 此区块由 scripts/generate-skill-guards.mjs 生成，禁止手改 -->
### 生成式执行护栏

- `P-AUTH-URL`：授权链接只由 auth.sh 构造并校验固定域名、路径和参数；禁用 verification_url。
- `P-AUTH-URL-AUTO-OPEN`：授权 URL 交付后调用受控 opener；失败时保留同一裸 URL 和复制兜底。
- `P-AUTH-PAGE-DELIVERY-BARRIER`：`auth.page` stdout 必须先独立送达，再 opener 和有限轮询；不得合并 pending 或收口，也不等待确认。
<!-- GENERATED:ONBOARDING-GUARDS-EXECUTE:END -->
### Step 2: 环境检查

方案已基于完整事实输出后，正常路径执行组合动作；其内部先加载 `execute` 并继承 `clarify_intent` 已记录的 flow start 事实，随后执行只读环境检查：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-execute-ready --product-type "$PRODUCT_TYPE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

- 唯一 `CLI_ENV:READY`：直接进入 Step 3，不读取完整安装文档。
- `CLI_ENV:NEEDS_SETUP`：此时才读取 `../normal/alipay-cli-env.md`。若唯一 `CLI_ENV_MISSING` 含 `jq`，先以所需网络和 `~/.local/bin` 写权限执行一次 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" env prepare-jq --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`；唯一 `ALIPAY_AIPAY_INTERNAL:JQ_PREPARE=READY` 后原样重跑 `env check`。`FAILED|UNSUPPORTED`，或 `READY` 后复检仍缺 jq 时，由 Agent 按环境文档执行当前系统首选包管理器兜底并再次复检；macOS 必须从清华镜像开始，明确失败后才依次选阿里云、中科大和直连，不并发、不回到 `prepare-jq`。其他缺失项按既有安装、PATH、联网权限和验证规则补齐后重跑同一检查；不得重复执行 `prepare-jq` 或新增确认，未取得 `CLI_ENV:READY` 不得进 Step 3。
- 其他输出、非 0 或 marker 冲突：停在本步骤核对脚本，不得猜测环境已就绪。

若组合动作本身不可用，原子 fallback 固定为先执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" flow onboarding execute --product-type "$PRODUCT_TYPE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`，再执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" env check --product-type "$PRODUCT_TYPE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`；fallback 不得重复 stage 或重复环境检查。

签约脚本仍通过 `error_handler.sh -> common.sh` 初始化 `DEV_TOOL_NAME`、`PLATFORM`、当前 `run_id` 的 `PLATFORM_ID`、当前 Skill 版本和匿名 `skill_user_id` 的 `ALIPAYCLI_BIZ_INFO`，以及当前产品 `PRODUCT`。有任务工具时只内部记录实际阶段，不维护任务数量；只保留当前对话最小上下文，不创建业务进度文件。

本步骤成功时不输出“环境检查完成”“任务已创建”等对客消息，直接进 Step 3；只有安装失败、权限不足或缺工具时才输出实际问题和恢复动作。工具能力差异不得省略任务、步骤或完成状态。

### Step 3: 登录授权

产品和唯一 MCC 事实已校验、方案送达且 Step 2 环境就绪后，只调用本节 `auth.sh init|open|wait|confirm|mismatch` 动作；脚本异常需要核对授权业务语义时才读取 `modules/authorization.md`。禁止直调 `alipay-cli login`、解析原始输出或展示 `verification_url`。

方案送达后，`execute` loader 已继承 `clarify_intent` 的 flow start 事实；`auth.sh init` 在固定授权上下文机器校验通过后继续授权流程。两者都不替代登录、scope 或 MCC 完成条件，也不表示额外用户回复；不得另行执行 telemetry 造成重复事件。

这些脚本是联网命令，首次执行即按 `../normal/alipay-cli-env.md` 申请权限。`AUTH_FLOW:RETRY_WITH_NETWORK` 只申请联网后重试同一完整命令。`AUTH_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION` 仅表示授权状态命令 preflight 失败或命中 `poll_state/session/log` 本地写失败；可恢复阶段 stdout 为空，取 CLI 私有状态目录权限后原样重试当前 `auth.sh` 一次，`wait|confirm` 不重建授权页或轮询。拒绝、不支持或重试仍命中同一 marker 时才输出最小失败说明。两者都不得解释为本机 login/logout 失败、网络故障或支付宝业务失败。

Step 1 的产品/MCC 唯一事实校验和方案送达、Step 2 的环境 READY 都是授权前置；产品或 MCC 仍缺失、冲突、非唯一或环境未就绪时禁止 login，`full_process` 也不得绕过。

`auth.sh init --defer-open` 和本节登记的 `app.sh key` 命令先校验 URL 并输出页面说明；Agent 把 stdout 原文作为独立对客消息送达后，立即执行对应 open 子命令使用受控 opener，不新增确认。具体中性文案和兜底见对应模块，不改变 MCP 契约。

**完整流程**：
```
1. node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" auth init --defer-open --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME" --mcc-context-receipt "$MCC_CONTEXT_RECEIPT" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
   ├─ AUTH_FLOW:SKIP → 进入 Step 3.1并复用合法签约查询事实
   ├─ AUTH_FLOW:READY_TO_OPEN → 输出非阻塞授权页，执行第 2 项
   │  └─ 若同时存在 AUTH_STATE:SAVE_FAILED：授权页 stdout 已送达，后续 open 仅可降级为 AUTH_OPEN:LINK_ONLY；wait/confirm 仍使用本条命令显式上下文继续，禁止重新生成授权页
   ├─ 底层 init 命中 SCOPE_MISMATCH / MCC_MISMATCH → runtime 在同一命令内自动调用既有第 4 项，只透传 mismatch 的最终结果；唯一 AUTH_AUTO_MISMATCH 仅供内部诊断，不是终态
   ├─ AUTH_FLOW:AUTH_REQUIRED → 当前失效会话已按脚本后置条件处理；原样重新执行第 1 项一次，生成当前上下文的新授权页；再次命中则停止循环
   ├─ AUTH_FLOW:RETRY_WITH_NETWORK → 取得联网权限后重试同一完整命令
   ├─ AUTH_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION → 取得 CLI 私有状态目录权限后原样重试本命令一次
   ├─ AUTH_FLOW:LOGOUT_STILL_LOGGED_IN → 自动 mismatch 的 logout 后置条件未成立，按第 4 项同名分支停止
   └─ AUTH_FLOW:FAILED / 初始 mismatch 输出不满足唯一空 stdout 契约 → 停止并按错误输出恢复，禁止进入 Step 3.1
2. 仅 AUTH_FLOW:READY_TO_OPEN：独立送达 init stdout，再执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" auth open --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME" --mcc-context-receipt "$MCC_CONTEXT_RECEIPT" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`。`OPENED` stdout 为空；`OPEN_FAILED|GUI_UNAVAILABLE|LINK_ONLY` 时，宿主有内置浏览器打开/导航能力则用它打开本次已校验、已交付的同一 `officialUrl` 一次，禁止搜索、改写、自动填写或代替扫码。无该能力或仍失败时，执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" auth manual-open --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"` 并独立送达 stdout。随后无需回复，执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" auth wait --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME" --mcc-context-receipt "$MCC_CONTEXT_RECEIPT" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`
   ├─ open 返回 AUTH_FLOW:CONTEXT_MISMATCH → 不执行 wait；使用当前已确认的完整参数重新执行第 1 项
   ├─ open 返回 AUTH_FLOW:FAILED → 停止并按错误输出恢复，禁止执行 wait 或进入 Step 3.1
   ├─ AUTH_OPEN:OPENED|OPEN_FAILED|GUI_UNAVAILABLE|LINK_ONLY → 按上项完成宿主浏览器/手动提示降级后执行 wait；不影响已交付 URL
   ├─ 最多 12 次、间隔 5 秒；成功或过期立即停止
   ├─ AUTH_FLOW:AUTH_SUCCESS → 进入 Step 3.1并复用合法签约查询事实
   ├─ AUTH_FLOW:PENDING → 输出 auth.pending，等待用户明确表示扫码已完成
   ├─ AUTH_FLOW:EXPIRED → 重新执行第 1 项生成授权链接
   ├─ AUTH_FLOW:CONTEXT_MISMATCH → 当前动作未执行 login --complete/logout；使用当前已确认的完整参数重新执行第 1 项
   ├─ AUTH_FLOW:AUTH_REQUIRED → 当前授权会话已失效，旧页面不再作为恢复依据；原样重新执行第 1 项一次，再次命中则停止循环
   ├─ AUTH_FLOW:RETRY_WITH_NETWORK → 取得联网权限后重试同一完整命令
   ├─ AUTH_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION → 保留当前授权页短时状态，取得 CLI 私有状态目录权限后原样重试当前 wait 命令一次
   ├─ AUTH_FLOW:FAILED → 停止并按错误输出恢复，禁止进入 Step 3.1
   └─ AUTH_FLOW:SCOPE_MISMATCH / MCC_MISMATCH → 执行第 4 项
3. 仅 PENDING 后把用户原始回复传给 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-recovery auth-confirm --reply "$USER_REPLY" --input-id "$USER_INPUT_ID" --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME" --mcc-context-receipt "$MCC_CONTEXT_RECEIPT" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`；runner 复用统一肯定语义判定（包括 `1`、“继续”“好了”“已完成”“OK”等），接受后只执行一次原 `auth.sh confirm`。该消息已由统一前置 `count-user-input` 计数，recovery 不得再次计数。否定、疑问、取消、修改意见或含糊输入返回内部拒绝且不得查询；成功后的转移同第 2 项，PENDING 继续等待且不重启轮询
4. node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" auth mismatch --defer-open --scope "$SCOPE" --sales-code "$SALES_CODE" --mcc-code "$MCC_CODE" --product-name "$PRODUCT_NAME" --mcc-name "$MCC_NAME" --mcc-context-receipt "$MCC_CONTEXT_RECEIPT" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
   ├─ AUTH_FLOW:READY_TO_OPEN → 输出非阻塞授权页并按第 2 项执行 open + wait
   ├─ AUTH_FLOW:CONTEXT_MISMATCH → 未执行 logout；使用当前已确认的完整参数重新执行第 1 项
   ├─ AUTH_FLOW:RETRY_WITH_NETWORK → 取得联网权限后重试同一完整命令
   ├─ AUTH_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION → 未重启授权链路，取得 CLI 私有状态目录权限后原样重试本命令一次
   ├─ AUTH_FLOW:LOGOUT_STILL_LOGGED_IN → logout 后置条件未成立；禁止 login、签约查询和其他 onboarding 动作，排除本机登录态后重试第 4 项
   └─ mismatch 统一 logout；后置条件成立后用正确 scope 重建授权页
```

`mismatch` 中 logout 明确业务失败但 `whoami` 仍登录时，脚本内部以“初次 + 2 次”固定预算、间隔 3 秒重试完全相同的 logout。每次 logout 失败后只执行一次 `whoami` 后置核验；logout 明确成功时无需额外核验。任一次证明已退出即继续重新授权；预算耗尽且仍登录才输出 `AUTH_FLOW:LOGOUT_STILL_LOGGED_IN`。网络/服务异常、冲突输出或结果无法确认不消耗该业务重试预算，只转 `AUTH_FLOW:RETRY_WITH_NETWORK`。整个过程不增加用户确认或 Agent 命令，logout 未证明成功前禁止 login。

`AUTH_FLOW:CONTEXT_MISMATCH` 适用于 `open|wait|confirm|mismatch` 的显式上下文与同一次 init 短时状态不一致；脚本必须在任何 `login --complete/logout` 前停止且不输出对客正文。Agent 不得忽略差异、改用旧状态继续或手工清理状态；必须立即用当前 Step 1 已确认的完整参数重新执行第 1 项。新的 init 先完成固定产品/MCC 机器校验，再安全替换旧短时状态；若 CLI 仍处于登录态，因为签约查询没有权威 MCC 字段，底层 init 必须返回对应 `SCOPE_MISMATCH/MCC_MISMATCH`，统一 runtime 随即在同一命令内调用既有 `auth.sh mismatch`，不得返回 `SKIP` 或要求 Agent 再发一条机械命令。CLI 未登录时直接生成当前上下文的新授权页。两种分支都不得复用旧 deviceCode 或新增用户确认。

`auth.page` 非阻塞并追加“扫码完成后请回到 Agent 对话页面”；`auth.pending` 仅由 wait 耗尽或单次 confirm 的 PENDING 渲染，其他对客终态由脚本渲染对应消息。自动轮询期间即使 `login --complete` 已返回可复核状态，只要 `whoami` 尚未取得有效本机登录态，也继续按 PENDING 处理并消耗本次 wait 预算，不输出断头失败文案。剔除 `ALIPAY_AIPAY_INTERNAL:` 内部行后的 stdout 是当前动作唯一对客正文；禁止再次调用 renderer、另写近似话术、输出 stderr 或内部行、重复转述。授权脚本明确返回链接过期时必须重建，旧回复失效。

授权 `scope` 统一使用“产品映射”中当前产品的固定值，禁止自行修改。

必须原样展示 init stdout，并在 login 前完成固定产品/MCC 上下文和 URL 逐项校验。禁止 CLI `verification_url`、非登记 URL 或要求用户输入确认码；这些正常路径约束均由本节命令和 `auth.sh` 托管，不为重复确认而读取模块。

#### Step 3.1: 状态与资源查询（登录授权后置检查）

**只读查询组**：登录成功后自动连续执行，不增加“是否查询”确认：

开始执行任一签约、应用或服务只读查询时，只使用本步骤登记的 discovery runner；runner 会在子查询启动前记录一次 discovery 相关内部事实，不得另行执行 telemetry 命令。

授权成功后执行全部适用只读查询，不增加确认。直接从本 flow 目录执行唯一 discovery runner；runner 在内部并发调用现有只读脚本、解析查询语义并隔离普通分支失败，正常成功路径不再预读 `product-sign.md`、`service-registration.md` 或 `app-release.md` 查询章节。不得拆回 Agent 手工并发、改写底层命令或自行合并 MCP：

```bash
# auth.sh 已提供合法 AUTH_SIGN_REUSE_RECEIPT 时，优先原样追加 --reuse-sign-receipt；否则不传。
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-discovery run --product-type "$PRODUCT_TYPE" --sales-code "$SALES_CODE" [--reuse-sign-receipt "$AUTH_SIGN_REUSE_RECEIPT"] --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

该查询只能在当前产品匹配且未收口的 `onboarding_only|full_process` active run 内执行；telemetry 开启时缺少或不匹配 run 会直接停止，禁止完成查询后静默丢失 `onboarding.confirm_signing`。

只接受唯一 `ALIPAY_AIPAY_INTERNAL:DISCOVERY_RESULT=<json>`。runner stdout 保留底层受控错误，并在无全局授权阻断或本地权限恢复时追加原 `onboarding.discovery.summary`；必须原文送达，不得手写、压缩或重放摘要。envelope 中每个分支只允许 `SUCCESS|QUERY_FAILED|NOT_APPLICABLE`；服务/应用成功时 `candidates` 必须是数组，应用还须有合法 `application_type`，否则不得当空列表。`global_blocker=AUTHORIZATION_INVALID` 必须唯一携带 `auth_recovery_action=INIT|MISMATCH`：任一子查询为 `SCOPE_MISMATCH|MCC_MISMATCH` 时固定 `MISMATCH` 并执行 Step 3 第 4 项，否则 `AUTH_REQUIRED` 固定 `INIT` 并执行第 1 项；随后停止查询且不进入 Step 4。字段非法、缺失或与该优先级矛盾时停止核对，禁止猜测。无授权阻断且任一子查询命中 CLI 私有状态权限证据时，runner 只输出一个 `ALIPAY_AIPAY_INTERNAL:DISCOVERY_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION`，不输出摘要或网络 marker；否则仅在 DNS、连接、timeout、socket/TLS、`fetch failed`、`network_error`、`网络连接失败` 或连接前沙箱禁网强证据下至多输出一个 `ALIPAY_AIPAY_INTERNAL:DISCOVERY_FLOW:RETRY_WITH_NETWORK`。支付宝侧服务异常、业务错误、裸 `permission denied` 或结构异常不得触发二者。

命中 `DISCOVERY_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION` 时 stdout 必须为空；宿主支持时只允许当前同一 discovery 命令访问两个 CLI 私有状态目录并原样重试一次。拒绝、不支持或再次命中时停止申请，按最新 envelope 保留失败分支，不渲染额外恢复文案。命中 `DISCOVERY_FLOW:RETRY_WITH_NETWORK` 时先暂存本次 stdout，不对客发送；宿主支持时申请联网权限，并以完全相同的产品、salesCode 和签约复用回执原样重试同一条 discovery 命令一次。重试成功只送达重试后的 stdout 并继续；权限被拒绝、宿主不支持时送达首次 stdout 一次；重试仍返回同一 marker 时只送达重试后的 stdout 一次并停止再次申请。两类恢复都不新增对客文案、确认点或 closeout 枚举。优先级固定为 `AUTHORIZATION_INVALID`、本地权限、网络权限，禁止同时进入两个恢复分支。

不存在全局授权阻断时，执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" flow onboarding branch-summary --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"` 加载 Step 4 和三个分支共用的 Step 5 约束；共用区块只加载一次，不得整份读取后续 flow。

Step 5 直接使用对应 phase 的完整命令；仅出现脚本异常、需要解释登记业务语义或用户明确要求详情时读取当前分支模块，错误恢复时才读取 `error-handling.md`。不得提前加载其他分支，也不重复读取已经读过且未变化的章节。

1. 签约：若本次成功的 `auth.sh init|wait|confirm` 内部事实同时且唯一包含 `AUTH_SIGN_QUERY_REUSABLE=true`、合法 `AUTH_SIGN_REUSE_RECEIPT`，把回执原样传给 runner 复用；回执缺失、冲突、重复或解析失败时不传复用参数，由 runner 执行原 `query_sign_status.sh` 完整命令。兼容窗口内，旧事实 `SIGN_STATUS + FLOW:*` 仍可通过 `--reuse-sign-status "$SIGN_STATUS" --reuse-sign-flow "$SIGN_FLOW"` 传入，`FLOW:` 前缀可带可不带；runner 必须校验 status/flow、productType 和 salesCode 一致，合法 `OTHER_STATUS + FLOW:OTHER_STATUS` 只表示待核验，禁止重复签约。复用只省略同一请求的重复调用，不省略签约分支错误检测和状态处理。
2. 服务：仅按量付费由 runner 执行原 `service.sh list`；其他产品 envelope 固定为 `NOT_APPLICABLE`。成功候选只取 envelope 的 `service.candidates`。
3. 应用：runner 执行原 `app.sh list --product-type "$PRODUCT_TYPE" --sales-code "$SALES_CODE"`。成功候选和 `WEBAPP|MOBILEAPP` 只取 envelope 的 application 分支；不得宣称返回应用已与当前支付产品绑定。

> ⚠️ 脚本通过 `error_handler.sh` 间接初始化 `DEV_TOOL_NAME`、当前 `run_id` 对应的 `PLATFORM_ID`、当前 Skill 版本和匿名 `skill_user_id` 对应的 `ALIPAYCLI_BIZ_INFO`，以及 CLI `PRODUCT`；签约查询必须传入当前产品的 `--sales-code` 和 `--product-type`（aipay|webpay|apppay）做一致性校验。AI 网页应用收款和 AI 移动应用收款使用不同 salesCode，禁止混用。

各适用查询仍是独立 CLI/MCP 调用，runner 只编排现有脚本，必须分别完成原有错误检测，禁止伪造合并 MCP。失败后按错误类型处理：

所有内部事实行都必须以 `ALIPAY_AIPAY_INTERNAL:` 开头；宿主合并 stdout/stderr 时也逐行剔除。无前缀的相似文本不得作为流程事实；唯一字段缺失、重复或冲突时按结构异常处理。

- MCP 认证失败或产品/scope/MCC 不匹配：子查询只报事实、不 logout，并停止查询组；只按 `auth_recovery_action` 执行 Step 3 第 1 或第 4 项，禁止凭 stdout 猜测。重新授权后保留主体未变化的成功结果并恢复其余查询；主体无法确认时重查全部。
- 强网络证据且无授权阻断：只按上文 `DISCOVERY_FLOW:RETRY_WITH_NETWORK` 契约申请权限并原样重试 discovery 一次；连接前沙箱明确禁网不在子脚本内浪费两次固定间隔重试。远端服务异常仍使用既有分支失败和收口，不误报为本地联网权限。
- CLI 私有状态权限且无授权阻断：只按上文 `DISCOVERY_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION` 契约恢复同一只读查询组一次；不得改走 auth mismatch、不得解释为网络或支付宝侧查询失败。
- 单个业务失败、响应结构错误或 MCP 服务失败，但当前会话仍有效：把该分支标记为查询失败，继续其他不依赖该结果的只读查询，最后一次性输出“已取得结果 + 失败分支”摘要。不得把失败视为空列表；应用查询失败时禁止应用复用/创建，服务查询失败时禁止服务复用/新建/修改。
- 签约查询失败：只阻断签约分支；可继续应用/服务查询、候选展示、资源决策及其独立资料采集和写操作。不得推断签约状态，不得采集签约截图或签约所需 APP 名称，`signStatus` 和签约 `materialStatus` 保持未设置。签约查询恢复成功后，只有状态为 `NOT_SIGNED` 才进入签约材料类别。应用或服务查询失败也只阻断对应分支；认证失败、授权不匹配或无法确认登录主体一致时仍是全局阻断。

任何恢复都不得要求用户重交未变化且已验证的资料，也不得重做不受会话主体变化影响的成功步骤。

签约状态和 `FLOW:*` 映射只按 discovery runner 的签约 envelope 与共用 parser 结果执行：`SIGNED_EFFECTIVE` 与 `SIGN_SUBMITTED` 均禁止重复提交签约；`OTHER_STATUS` 不提交签约，只展示已确认结果和待核验项。Step 4 再根据脚本输出的实际状态收集签约材料并处理应用/服务候选。

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_EXECUTE:END -->

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_BRANCH_SUMMARY:START -->
<!-- GENERATED:ONBOARDING-GUARDS-BRANCH-SUMMARY:START -->
<!-- 此区块由 scripts/generate-skill-guards.mjs 生成，禁止手改 -->
### 生成式执行护栏

- `P-PARTIAL-RESULT`：签约、服务、应用分支独立记录，失败不回滚或覆盖其他成功结果。
- `P-MATERIAL-CATEGORY`：每轮只展示一个材料类别；同类一次收齐，已提供材料不得重复索取。
<!-- GENERATED:ONBOARDING-GUARDS-BRANCH-SUMMARY:END -->
### Step 4: 分支摘要与分类材料

Step 3.1 通常已在同一次 stdout 展示三分支摘要；网站支付和 APP 支付的服务市场固定为“无需处理”，查询失败显示“查询失败”。本地权限未恢复时没有摘要，只消费最新失败 envelope，禁止补写或重放。进入本阶段后只消费同一 `DISCOVERY_RESULT`，不得再次调用 `discovery-summary`、手写或重复输出摘要。

轮到服务或应用时，只有 `query_status=SUCCESS` 且 `candidates` 为数组，才用以下 runner 基于同一快照生成候选事实和选择提示；stdout 是唯一正文，禁止提前展示、手工拼表、压缩、拆分或改写。应用候选存在上线或未上线记录时，runner 必须产生且仅产生一个 `CUSTOMER_MESSAGE_DELIVERY_REQUIRED=application.candidate.select`；命令后的下一动作先将 stdout 原文送达，不得添加标题、提示、风险说明、前后缀或改写，然后立即等待用户选择：

```bash
# 仅按量付费，轮到服务类别时
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message service-candidates --candidates-json "$SERVICE_CANDIDATES_JSON" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
# 无效选择
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message service-candidates --candidates-json "$SERVICE_CANDIDATES_JSON" --selection-state invalid --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"

# 轮到应用类别时
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-candidates --application-type "$APPLICATION_TYPE" --candidates-json "$APP_CANDIDATES_JSON" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
# 非空候选收到无效选择时
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-candidates --application-type "$APPLICATION_TYPE" --candidates-json "$APP_CANDIDATES_JSON" --selection-state invalid --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

只有成功分支的实际 `candidates.length === 0` 才直接进入新建资料；非空时必须校验唯一交付 marker、原文送达 runner stdout 并等待选择。缺少、重复或错误 marker 时不得手写替代消息。`QUERY_FAILED`、候选缺失或类型非法均阻断该分支，禁止候选 runner、创建资料和写动作，不影响其他成功分支。

服务候选非空时，`新建` 可同条附五项资料；应用候选非空时可同条提交 `新建` 和完整应用材料。缺失或错误时保留新建意图并只补对应项；无效选择执行同类别 `invalid` 命令，原文送达后等待，禁止写操作。空候选禁用默认或猜值。

每次只展示一个类别，同类一次收齐且只补问缺失或错误字段。`MATERIAL_CATEGORY` 固定为 `signing|service|application`；`INITIAL` 对应“待补充”，`PARTIAL` 对应“部分已提供，待补充”，`INVALID` 对应“校验失败，需更正”，其他状态停止核对。字段别名只交给 runner 归一化；禁止使用 `签约资料` 等同义词，正常路径禁止调用 `render --schema`、`jq` 或读取消息目录。只执行：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message material-collect --category "$MATERIAL_CATEGORY" --state "$MATERIALS_STATE" --product-type "$PRODUCT_TYPE" --missing-fields "$MISSING_FIELDS" [--special-qualification-json "$QUALIFICATION_GROUPS_JSON"] --input-id "$USER_INPUT_ID" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

`INITIAL|PARTIAL|INVALID` 文案由 runner 校验；材料提示不展示跨类别说明。签约类目需特殊资质时，`MISSING_FIELDS` 必含 `特殊资质材料`，并把本轮唯一 MCC 的 `qualificationGroups` 原样传入 `--special-qualification-json`，runner 展示 OR 组合、AND 材料和上传顺序。服务 `INITIAL` 展示五项示例且不要求重发 `新建`。提前材料仍校验复用；签约状态未取得时不得猜测材料需求。分支规则只在对应 phase 加载。

### Step 5: 产品开通推进

按“签约 -> 服务 -> 应用”默认顺序，一次只处理一个实际适用且可推进的类别；顺序不构成分支依赖。认证、授权或主体变化时全局停止并重新校验；单分支失败只登记该分支恢复动作，继续其他独立分支，不清除已验证材料或成功事实。全部适用分支已处理，或失败、未知及外部待办均已登记后，才执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" flow onboarding closeout --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`；仍有可推进分支时不得提前收口。

本阶段的签约、服务、应用、截图和特殊资质上传 runtime 命令在 CLI 调用前返回唯一 `CLI_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION` 时，当前业务调用次数为 0；允许同一命令访问 CLI 私有状态目录后原样重试一次，不重收材料、不重开页面、不新增确认。拒绝、不支持或再次命中时停止申请并按当前分支既有失败边界收口。CLI 已执行后出现同类证据时，读操作仍可进入该恢复；签约提交、服务保存、应用创建/公钥页/提审、截图上传和特殊资质上传等写操作只走既有核验或 `UNKNOWN`，禁止因权限 marker 重放。

轮到某类别且即将执行其业务动作时，先执行对应 loader：签约用 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" flow onboarding signing --product-type "$PRODUCT_TYPE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`，仅按量付费服务用 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" flow onboarding service --product-type "$PRODUCT_TYPE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`，应用用 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" flow onboarding application --product-type "$PRODUCT_TYPE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`。loader 只加载该分支规则，不记录开始态 stage；对应业务完成后由唯一登记脚本记录完成 stage。未轮到或不适用的分支不得加载、不得记录。

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_BRANCH_SUMMARY:END -->

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_SIGNING:START -->
<!-- ALIPAY_AIPAY_STAGE:onboarding.confirm_signing -->
<!-- GENERATED:ONBOARDING-GUARDS-SIGNING:START -->
<!-- 此区块由 scripts/generate-skill-guards.mjs 生成，禁止手改 -->
### 生成式执行护栏

- `P-SIGNING-WRITE`：签约材料校验通过后直接提交，不增加确认；缺失或非法时禁止提交。
- `P-WRITE-UNKNOWN`：非幂等写入结果不明时只读核验；仍无法确认则进入 UNKNOWN，禁止重试写入。
<!-- GENERATED:ONBOARDING-GUARDS-SIGNING:END -->
#### 5.1 产品签约

仅 `NOT_SIGNED` 执行本节；其他状态禁止重复提交。使用当前产品、MCC 和已验证材料执行固定命令；脚本冻结字段、FLOW 信号和解析。按量付费无页面材料；网站支付需三个图片引用；APP 支付需 APP 名称和三个图片引用。若 MCC 需特殊资质，用户必须选择一个 `qualificationGroups` 组合；`attaType` 非空项按提示顺序上传并生成 `specialLicense`，空值项只作文字条件。字段缺失/校验失败回 Step 4 `materials.category.collect`；材料完整后直接执行 5.1，不增加回复 `1`。

网站支付收首页、商品页、支付页；APP 支付再加 APP 名称且签约状态参数固定 `OFFLINE`。支付页必须展示支付宝付款方式并等待付款，不是支付成功页。三张截图按序执行 `node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" screenshots --product-type "$PRODUCT_TYPE" <img1> <img2> <img3> --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"`；串行上传三次，禁并发。只送达 stdout，引用只取 `SCREENSHOT_HOME_REF|SCREENSHOT_SHOP_REF|SCREENSHOT_PAY_REF`。特殊资质由 `special-license` 调 `alipay-cli file upload -s payMerchantcodeSkill --json`，返回 `licensePic`；不得要求 HTTPS URL 或复述 fileKey。认证失效仅一条事实；不 logout、不显示退出文案，保留 APP 名称。

特殊资质上传按提示顺序传所选组合中 `attaType` 非空项对应的文件；脚本从已校验回执派生内部 `licenseType` 并核对文件数量，Agent 和用户都不提供或看到类型码。纯文字组合不调用上传命令，签约时传所选组合序号和空数组：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" special-license --product-type "$PRODUCT_TYPE" --mcc-context-receipt "$MCC_CONTEXT_RECEIPT" --qualification-group-index "$SPECIAL_QUALIFICATION_GROUP_INDEX" --file "<localFile1>" [--file "<localFile2>" ...] --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

只接受唯一 `ALIPAY_AIPAY_INTERNAL:SPECIAL_LICENSE_JSON=<json>`；纯文字为 `[]`。`AUTH_FLOW:*`/`CLI_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION` 按 Step 3/本阶段权限恢复。缺唯一 `SPECIAL_LICENSE_JSON` 时送 stdout，禁 `sign`：有 `SPECIAL_LICENSE_UPLOAD_RESULT=UNKNOWN` 则未调 `ar-sign.apply`，`SIGNING_RESULT=未签约`，`remainingActions=特殊资质上传未知，核对后继续上传`，禁自动重放；其他失败回 Step 4 invalid，缺特殊资质材料。

进入本 flow 的 `signing` 阶段时，不再单独记录开始态 stage；签约提交完成后，或 discovery 已确认 `SIGNED_EFFECTIVE|SIGN_SUBMITTED` 并直接复用既有签约事实时，由脚本统一记录 `onboarding.confirm_signing`，不得另行执行 telemetry 命令。

**固定命令契约**：按当前产品原样使用对应命令结构，只替换尖括号中的实际值，禁止增删、改名或猜测参数：

<!-- ALIPAY_AIPAY_PRODUCT:aipay:START -->
```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" sign --product aipay --sales-code "I1080300001000160457" --mcc-code "<mccCode>" --mcc-context-receipt "$MCC_CONTEXT_RECEIPT" [--special-qualification-group-index "$SPECIAL_QUALIFICATION_GROUP_INDEX" --special-license-json "$SPECIAL_LICENSE_JSON"] --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```
<!-- ALIPAY_AIPAY_PRODUCT:END -->
<!-- ALIPAY_AIPAY_PRODUCT:webpay:START -->
```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" sign --product webpay --sales-code "I1080300001000041203" --mcc-code "<mccCode>" --mcc-context-receipt "$MCC_CONTEXT_RECEIPT" --picurl1 "<imageRef1>" --picurl2 "<imageRef2>" --picurl3 "<imageRef3>" [--special-qualification-group-index "$SPECIAL_QUALIFICATION_GROUP_INDEX" --special-license-json "$SPECIAL_LICENSE_JSON"] --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```
<!-- ALIPAY_AIPAY_PRODUCT:END -->
<!-- ALIPAY_AIPAY_PRODUCT:apppay:START -->
```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" sign --product apppay --sales-code "I1080300001000041313" --mcc-code "<mccCode>" --mcc-context-receipt "$MCC_CONTEXT_RECEIPT" --app-name "<APP名称>" --picurl1 "<imageRef1>" --picurl2 "<imageRef2>" --picurl3 "<imageRef3>" [--special-qualification-group-index "$SPECIAL_QUALIFICATION_GROUP_INDEX" --special-license-json "$SPECIAL_LICENSE_JSON"] --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```
<!-- ALIPAY_AIPAY_PRODUCT:END -->

提交成功后不等待或轮询签约生效，只记录“已提交，等待生效”。脚本成功必须同时产生 `SIGN_APPLY_RESULT=SUCCESS` 与对应产品 `FLOW:*_SIGN_CONTINUE`；响应不明且查询无法核验时产生 `SIGN_APPLY_RESULT=UNKNOWN`，本签约分支进入“结果未知/禁止重复提交”待办；明确未发送重试耗尽、业务失败或结构明确失败产生 `SIGN_APPLY_RESULT=FAILED`，本签约分支失败。服务和应用是否推进只取决于各自前置条件，不取决于本次签约提交是否成功；复用 Step 3.1 和 Step 4 的成功结果，只在会话、主体、候选资源变化或原查询失败时刷新受影响分支，刷新失败不清除其他成功结果。

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_SIGNING:END -->

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_SERVICE:START -->
<!-- ALIPAY_AIPAY_PRODUCTS:aipay -->
<!-- ALIPAY_AIPAY_STAGE:onboarding.confirm_service -->
<!-- GENERATED:ONBOARDING-GUARDS-SERVICE:START -->
<!-- 此区块由 scripts/generate-skill-guards.mjs 生成，禁止手改 -->
### 生成式执行护栏

- `P-SERVICE-WRITE`：服务创建摘要送达后直接创建；服务修改须取得绑定当前脱敏摘要的明确确认。
- `P-WRITE-UNKNOWN`：非幂等写入结果不明时只读核验；仍无法确认则进入 UNKNOWN，禁止重试写入。
<!-- GENERATED:ONBOARDING-GUARDS-SERVICE:END -->
#### 5.2 服务市场注册（仅按量付费）

仅 Step 3.1 查询成功且候选数组为空时直接新建；失败、缺失或非法时阻断。非空只接受当前完整 `serviceId`、`新建`（可附五项资料）或 `修改:<当前serviceId>`；序号、候选外/历史 ID、非法 `修改:` 或其他输入走 `invalid` 恢复，禁止复用或写入。创建/修改五项资料须通过 `validate`；单价可输入纯数字或带 `元`/`元/次` 后缀（可空格），后续只用 `SERVICE_PRICING=<纯数字>`。复用不写。创建时 `save` 重查全量，当前服务数量小于固定上限 `10` 才保存；达到 `10` 个时禁止调用保存方法，调用为 0 并输出 `SERVICE_SAVE_RESULT=FAILED`。校验通过先输出非阻塞摘要后创建；修改还须取得绑定当前会话、主体、产品、目标和参数的 `SERVICE_UPDATE_ONLY` 确认，变化即失效。成功实际 `serviceId` 记为 `productionServiceId`；未返回状态只写“状态未取得”，不得推断或重复 `save`。

```bash
# 创建摘要后不等待回复
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message service-create-summary --service-name "$SERVICE_NAME" --service-description "$SERVICE_DESCRIPTION" --service-url "$SERVICE_URL" --service-pricing "$SERVICE_PRICING" --service-schema "$SERVICE_SCHEMA" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
# 仅修改：stdout 原文送达并等待当前摘要的肯定回复
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message service-update-confirm --session-summary "$SESSION_SUMMARY" --subject-summary "$SUBJECT_SUMMARY" --service-id "$SERVICE_ID" --service-name "$SERVICE_NAME" --service-description "$SERVICE_DESCRIPTION" --service-url "$SERVICE_URL" --service-pricing "$SERVICE_PRICING" --service-schema "$SERVICE_SCHEMA" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

进入本 flow 的 `service` 阶段时，不记录开始态 stage；创建/修改在 `service save` 成功后记录 `onboarding.confirm_service`，复用已有服务不执行写入并由最终 closeout 根据受控“已复用”结果补记同一唯一 stage。重复责任方由 runtime 的 `run_id + stage` 唯一性 no-op，不得由 Agent 另行执行 telemetry 命令。

**固定命令契约**：复用已有服务不调用 `save`；创建不传 `--service-id`，修改必须传入用户从 Step 3.1 候选中选定的实际 `serviceId` 和全部字段：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" service validate --name "<name>" --desc "<desc>" --url "<url>" --pricing "<pricing>" --schema "<json>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
# 创建：先成功渲染 service.create.summary/DEFAULT，再直接执行
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" service save --name "<name>" --desc "<desc>" --url "<url>" --pricing "<pricing>" --schema "<json>" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
# 修改：先取得 onboarding.write.confirm/SERVICE_UPDATE_ONLY 的有效确认，再执行
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" service save --service-id "<serviceId>" --name "<name>" --desc "<desc>" --url "<url>" --pricing "<pricing>" --schema "<json>" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

`service save` 成功必须产生 `SERVICE_SAVE_RESULT=SUCCESS` 和实际 `SERVICE_ID`；创建/修改响应不明且只读查询无法唯一核验时产生 `SERVICE_SAVE_RESULT=UNKNOWN`，服务分支进入“结果未知/禁止重复保存”待办；明确未发送重试耗尽、业务失败或结构明确失败产生 `SERVICE_SAVE_RESULT=FAILED`，只终止服务分支，不清除签约或应用分支已取得事实。

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_SERVICE:END -->

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_APPLICATION:START -->
<!-- ALIPAY_AIPAY_STAGE:onboarding.confirm_alipayapp -->
<!-- GENERATED:ONBOARDING-GUARDS-APPLICATION:START -->
<!-- 此区块由 scripts/generate-skill-guards.mjs 生成，禁止手改 -->
### 生成式执行护栏

- `P-APPLICATION-WRITE`：完整新建材料或非空候选后的明确“新建”已构成创建确认；快照未变时不追加确认，公钥确认后直接提审。
- `P-WRITE-UNKNOWN`：非幂等写入结果不明时只读核验；仍无法确认则进入 UNKNOWN，禁止重试写入。
- `P-KEY-NO-PRIVATE`：禁止请求、处理、保存或输出生产私钥，也不提供密钥生成命令。
- `P-KEY-PUBLIC-USER`：应用公钥只能由用户提供；缺少时禁止 createKeyConfirmPage，也不得补全、改写或添加 PEM 头尾。
- `P-KEY-URL`：公钥确认只展示 createKeyConfirmPage 返回并校验的裸 URL；禁止二维码链接和 alipays://。
- `P-KEY-URL-AUTO-OPEN`：公钥 URL 交付后调用受控 opener；失败时保留同一裸 URL 和复制兜底。
- `P-KEY-PAGE-DELIVERY-BARRIER`：`application.key.page` stdout 必须先独立送达，再 opener 和有限轮询；不得合并 pending 或收口，也不等待确认。
- `P-KEY-TOOL-DOWNLOAD`：新建 WEBAPP 或 MOBILEAPP IOS|ANDROID|ALL 在首次等待或写入前必须展示 https://opendocs.alipay.com/isv/02kipk；HarmonyOS 除外。仅空候选且缺公钥时自动下载，非空候选只在用户要求时下载；只下载，不安装、启动或生成密钥。
<!-- GENERATED:ONBOARDING-GUARDS-APPLICATION:END -->
#### 5.3 应用发布

**应用分支**：按量付费/网站支付用 `WEBAPP`，APP 支付用 `MOBILEAPP`。仅 Step 3.1 查询成功、类型合法且候选为数组时继续；其余阻断。上下文、移动字段、`appSign`、MCP 参数和返回由 `app.sh` 托管。

候选为空：首次等待或创建前先送达事实消息，其中固定含密钥工具用途、`https://opendocs.alipay.com/isv/02kipk` 和私钥边界；无需回复 `新建`。本会话缺公钥时依次送达 `key-tool`、材料消息；应用资料首次收集消息继续带同一官方入口，保证恢复或前序消息不可见时仍可下载。已有公钥则不下载，缺料直接补，材料齐直接重查。公钥只能由本会话用户输入证明，禁默认、占位或猜测。

候选非空：有 `ON_LINE` 时接受完整 `appId` 或明确新建+材料；非上线时接受暂不新建。示例非口令；新建/材料有误则补缺，其他走 Step 4 `invalid` 且不写。含工具地址但不自动下载；要求时送达 `key-tool` 后等待。

`WEBAPP` 需公钥。`MOBILEAPP` 按明确语义归一化：iOS→`IOS+bundleId`，Android→`ANDROID+appPackage+appSign`，两类→`ALL+三项`；示例非口令，枚举兼容，含糊/矛盾补问。脚本只收 `IOS|ANDROID|ALL`。接口无名称/描述。`APP_WEB_INITIAL` 仅限 `aipay|webpay`，`APP_MOBILE_INITIAL` 仅限 `apppay`；`PARTIAL|INVALID` 只补缺项：

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" key-tool --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message material-collect --category application --state APP_WEB_INITIAL --product-type "$PRODUCT_TYPE" --input-id "$USER_INPUT_ID" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message material-collect --category application --state APP_MOBILE_INITIAL --product-type "$PRODUCT_TYPE" --input-id "$USER_INPUT_ID" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

缺公钥禁创建或调用 `createKeyConfirmPage`。材料齐后用下方组合命令完成重查、比较、创建和公钥页生成；页面确认后 `verify-key-and-audit` 复用安全响应 guard 提审。工具只下载，不安装、启动或生成密钥；禁用 OpenSSL。

<!-- ALIPAY_AIPAY_PRODUCT:apppay:START -->
APP 支付通过 Skill 创建只支持 `IOS`、`ANDROID` 和 `ALL`，其中 `ALL` 只表示 iOS + Android。HarmonyOS 移动应用不得调用 `app.sh create|create-from-snapshot`；执行固定 runner 命令输出 `application.harmony.manual_create`，用户在开放平台完成创建及平台要求的后续配置后明确表示操作完成，只执行本节登记的轻量 `app list`，不得重跑 Step 3.1。只有实际查询到 `ON_LINE` 候选后才能复用，否则保持人工待办。
<!-- ALIPAY_AIPAY_PRODUCT:END -->

`application` loader 不再记录开始态 stage；应用创建、复用或公钥提审完成后由脚本统一记录 `onboarding.confirm_alipayapp`，禁另报 telemetry。

**固定命令契约**：只替换实际值。`APP_CANDIDATES_JSON` 是当前“新建”所基于的快照；公钥取用户本轮完整原文。新建用 `create-from-snapshot`；复用缺钥用 `verify-key` 后 `reuse`。

<!-- ALIPAY_AIPAY_PRODUCT:aipay,webpay:START -->
```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app create-from-snapshot --product-type "<aipay|webpay>" --sales-code "<当前产品码>" --previous-candidates-json "$APP_CANDIDATES_JSON" --defer-open "<用户明确提供的完整publicKey>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```
<!-- ALIPAY_AIPAY_PRODUCT:END -->
<!-- ALIPAY_AIPAY_PRODUCT:apppay:START -->
```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app create-from-snapshot --product-type apppay --sales-code "I1080300001000041313" --previous-candidates-json "$APP_CANDIDATES_JSON" --mobile-platform IOS --bundle-id "<bundleId>" --defer-open "<用户明确提供的完整publicKey>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app create-from-snapshot --product-type apppay --sales-code "I1080300001000041313" --previous-candidates-json "$APP_CANDIDATES_JSON" --mobile-platform ANDROID --app-package "<appPackage>" --app-sign "<appSign>" --defer-open "<用户明确提供的完整publicKey>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app create-from-snapshot --product-type apppay --sales-code "I1080300001000041313" --previous-candidates-json "$APP_CANDIDATES_JSON" --mobile-platform ALL --bundle-id "<bundleId>" --app-package "<appPackage>" --app-sign "<appSign>" --defer-open "<用户明确提供的完整publicKey>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-harmony-manual-create --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
# 仅 HarmonyOS 用户明确完成开放平台操作后轻量重查
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app list --product-type apppay --sales-code "I1080300001000041313" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```
<!-- ALIPAY_AIPAY_PRODUCT:END -->

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app reuse --product-type "$PRODUCT_TYPE" "<appId>" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
# 仅复用缺钥，或新建后公钥页调用前阻断
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app key --product-type "$PRODUCT_TYPE" --defer-open "<appId>" "<用户明确提供的完整publicKey>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app reconcile-key --product-type "$PRODUCT_TYPE" "<appId>" "<同一publicKey>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app open-key-page "<appId>" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app verify-key-and-audit --product-type "$PRODUCT_TYPE" "<本轮create输出的appId>" "<同一publicKey>" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app verify-key --product-type "$PRODUCT_TYPE" "<appId>" "<同一publicKey>" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
# 仅轮询耗尽且用户明确已完成；单查一次
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-recovery application-key --reply "$USER_REPLY" --input-id "$USER_INPUT_ID" --product-type "$PRODUCT_TYPE" --mode verify-key-and-audit --app-id "<本轮create输出的appId>" --public-key "<同一publicKey>" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-recovery application-key --reply "$USER_REPLY" --input-id "$USER_INPUT_ID" --product-type "$PRODUCT_TYPE" --mode verify-key --app-id "<appId>" --public-key "<同一publicKey>" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app audit --product-type "$PRODUCT_TYPE" "<appId>" --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

**复用应用**：`app reuse` 只接受用户选定的本轮最新完整 `appId`，不接受序号、历史值或转换值；复用 `MOBILEAPP` 不收移动创建字段。

组合命令只对客转发登记的候选、业务错误或公钥页正文；技术正文和全部内部 marker 禁止对客，缺失、重复、冲突或未登记输出均 fail closed。按唯一终态执行下表，不新增确认或用户操作：

| 内部终态 | 自动转移（每类恢复最多一次） |
|---|---|
| `APPLICATION_RECHECK_RESULT=UNCHANGED` | 继续组合写入 |
| `CHANGED_EMPTY|CHANGED_NONEMPTY` | 零写入送达新事实；空候选以新快照和原材料同回合重跑，非空凭 marker 等待重选 |
| `APPLICATION_COMBINATION_RESULT=CONTRACT_ERROR|SNAPSHOT_REFRESH_REQUIRED|PREWRITE_FAILED` | 依次为：用已确认事实重构（真实缺料才补料）、执行下方列表和候选消息（空则继续，非空重选）、原样重试组合命令 |
| `KEY_NOT_STARTED`，或创建 `SUCCESS` + `APP_ID` 且无 `KEY_PAGE_RESULT` | 创建已完成且公钥页未调用；按该 `APP_ID` 独立执行一次 `app key` |
| 创建 `FAILED` | 禁止重放，停止设钥 |
| 创建 `UNKNOWN` | 禁止重放；只执行下方 `app list`，不把候选变化归因本次创建；待办“通过应用列表确认本次创建结果，确认前不要重复创建应用” |
| 公钥页 `FAILED|UNKNOWN` | 禁止重建页面；只以同一公钥执行一次 `reconcile-key` |
| `KEY_PAGE_RECONCILIATION=CONFIRMED|NOT_CONFIRMED|QUERY_FAILED` | `CONFIRMED` 执行 `app audit` 完整 guard；其余记结果未知，待办“确认当前应用的公钥配置状态，确认前不要重复生成公钥确认页面” |

三个组合异常均为写前零写入；恢复一次仍失败时分别记 `失败|结果未知|失败`，待办“稍后重新查询应用列表并继续应用发布”，再继续其他分支和 Step 6。禁继续重试或重跑 discovery、签约、服务查询；写后未知/授权失败禁回写前恢复。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app list --product-type "$PRODUCT_TYPE" --sales-code "$SALES_CODE" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-candidates --application-type "$APPLICATION_TYPE" --candidates-json "$APP_CANDIDATES_JSON" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

CLI 权限 marker 在列表或写入调用前按 Step 5 取权并原样重跑一次，调用后禁重放。授权 marker 按 Step 3：`AUTH_REQUIRED` -> `init`；`SCOPE_MISMATCH|MCC_MISMATCH` -> `mismatch`；两个 `RETRY_WITH_*` -> 既有一次权限恢复；`FAILED|LOGOUT_STILL_LOGGED_IN` -> Step 3 阻塞。恢复后只做最新列表或 `reconcile-key`；该只读命令 stdout 为空、不写状态，`CONTRACT_ERROR` 以已确认事实重构一次，CLI 权限 marker 原样重跑一次，耗尽按 `QUERY_FAILED` 收口。核验后继续其他分支和 Step 6，不让用户处理技术异常。

公钥页成功须同时有 `KEY_PAGE_RESULT=READY_TO_OPEN` 与 `KEY_PAGE:READY_TO_OPEN`；stdout 先独立送达，再 opener 和校验，不与 pending/收口合并。自动打开/查询不能替代 URL 交付。最多 20 次、间隔 2 秒，双公钥 guard 通过才提审；耗尽才输出 pending。肯定回复只由 recovery 单查一次，不重启轮询/页面；其他回复不触发。保存失败仅降级 `LINK_ONLY`；仅用户反馈页面问题时重建。

支付宝公钥导出前 config 探针失败时 stdout 空，仅记录 `APP_FLOW:RETRY_WITH_LOCAL_CONFIG_PERMISSION` 和 `ALIPAY_PUBLIC_KEY_EXPORT_STATUS=RETRY_WITH_LOCAL_CONFIG_PERMISSION`；取得 `${XDG_CONFIG_HOME:-$HOME/.config}` 权限后原样重试当前 `reuse|verify-key|verify-key-and-audit|audit` 一次，不重开页面。拒绝/不支持/仍失败，或实际写文件失败，才降级 `MANUAL_CONFIGURATION_REQUIRED`，记“需人工配置”且不得称完整。下一步由消息目录固定生成，禁传 URL 或手写；`onboarding_only` 和 `full_process` 都先独立输出应用结果，再进入 Step 6。HarmonyOS 不变。

opener 失败时宿主浏览器只开已交付 URL 一次，再失败保留裸 URL 和复制兜底，禁搜索、改写、填写或代扫码。提审成功须同时有 `APPLICATION_AUDIT_RESULT=SUBMITTED` 与 `FLOW:AUDIT_SUBMITTED`；`UNKNOWN` 遵守上表。

`FLOW:REUSE_NO_KEY` 时应用未完成，禁报复用成功；执行下方消息说明缺少已确认 RSA2 应用公钥，不增加确认。目标 `appId` 已由用户选定；仅用户要求重选/新建时回 Step 4。取得完整公钥后依次执行上方同一 `appId` 的 `app key`（stdout 独立送达）、`open-key-page`、`verify-key` 有限轮询和 `reuse`；禁跳过状态/支付宝公钥检查或改变位置参数。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-reuse-no-key --app-id "$APP_ID" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

**应用分支结果交付（所有三个产品统一）**：AI 按量付费、AI 网页应用收款、AI 移动应用收款在 `onboarding_only` 和 `full_process` 中均遵循同一顺序：应用分支取得本轮可收口的实际结果后，先独立交付 `application.operation.result`，再推进其他分支或进入 Step 6。即使应用操作紧邻总收口，也不得省略或合并这条消息；已在本轮针对同一结果交付过则不重复发送。仍等待材料、公钥确认或权限恢复时按原分支处理，不提前生成结果。

只有本轮实际取得目标 `APP_ID` 时才执行以下命令；没有取得 appId 的创建失败、结果未知或未选择应用场景，不编造 appId，也不重放写操作，保留既有错误/候选正文和实际待办进入总收口。`ACTUAL_STATUS` 和供总收口使用的 `APPLICATION_RESULT` 必须按下表从同一本轮 marker 事实选取，字面值与消息目录一致。非“需人工配置”传入有事实依据的 `NEXT_ACTION`；“需人工配置”省略下一步和保存路径，由消息目录派生。`ALIPAY_PUBLIC_KEY_EXPORT_STATUS=EXPORTED` 时必须传入本轮实际 `APP_KEY_SAVE_PATH`，只展示路径，不复述公钥内容。

<!-- APPLICATION_RESULT_MAP:START -->
| `APPLICATION_RESULT` | 本轮事实判据 |
|---|---|
| `待选择` | discovery 已取得应用候选，但用户尚未完成当前候选选择，或明确暂不新建 |
| `已创建，待设置公钥` | `APPLICATION_CREATE_RESULT=SUCCESS` 后尚未生成有效公钥页，或复用应用返回 `FLOW:REUSE_NO_KEY` |
| `公钥待确认` | 已取得 `KEY_PAGE_RESULT=READY_TO_OPEN`，但有限轮询或单次恢复返回 `FLOW:KEY_NOT_CONFIRMED` |
| `HarmonyOS 应用待平台侧创建、配置或上线` | 进入 `application.harmony.manual_create` 分支，尚未重新查询到可复用的 `ON_LINE` 应用 |
| `已提交审核，等待上线` | `APPLICATION_AUDIT_RESULT=SUBMITTED` / `FLOW:AUDIT_SUBMITTED`，但当前应用尚未满足完整上线条件 |
| `已上线且配置完整` | 当前应用已确认 `ON_LINE`、RSA2 应用公钥已生效且支付宝公钥已实际导出 |
| `需人工配置` | 权限恢复后最终仍取得 `ALIPAY_PUBLIC_KEY_EXPORT_STATUS=MANUAL_CONFIGURATION_REQUIRED` |
| `失败` | 应用创建、公钥页生成或应用提审取得明确 `FAILED`，或组合入口 `CONTRACT_ERROR|PREWRITE_FAILED` 自动重试仍失败，且没有后续成功事实覆盖 |
| `结果未知` | 应用查询失败，或创建、公钥页、提审取得 `UNKNOWN` 且只读核验仍不能确认 |
<!-- APPLICATION_RESULT_MAP:END -->

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-result --app-id "$APP_ID" --actual-status "$ACTUAL_STATUS" [--next-action "$NEXT_ACTION"] [--app-key-save-path "$APP_KEY_SAVE_PATH"] --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

必须取得唯一 `ALIPAY_AIPAY_INTERNAL:CUSTOMER_MESSAGE_DELIVERY_REQUIRED=application.operation.result`，下一动作先把该次 stdout 原文作为独立可见进行中消息送达；送达前禁止加载或执行 closeout、继续工具调用或把结果并入总收口。消息送达后同一工作回合继续，不等待用户确认，不以最终答复结束当前回合。marker 缺失或不唯一时停止并重跑同一登记消息命令，不重跑应用写操作。

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_APPLICATION:END -->

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_CLOSEOUT:START -->
### Step 6: 本轮流程收口

`integration_only` 不应进入本步骤。`onboarding_only` 和 `full_process` 按实际请求范围处理后续衔接；`full_process` 只保留两个子流程的实际状态，不转换成另一套状态。

**完成条件**：当前登录、scope 和 MCC 必须有效；签约必须由实际查询确认为已生效；仅按量付费适用的服务分支必须复用或保存成功并取得实际 `serviceId`；应用必须达到 `ON_LINE`、应用公钥已生效且支付宝公钥已实际导出。存在失败、未知、待生效、待审核或人工配置时不得宣称产品开通完成。不维护人工完成条件数量。

使用 `../normal/json/customer-messages.json` 的 `process.partial_result` 逐分支收口，必须通过 `onboarding_message_runner.mjs closeout` 托管输出并原文发送 stdout。禁止 Agent 手写短摘要、删减 `productionReadinessBlock`、删减 AI 网页应用收款限制引导或改写后续衔接；AI 网页应用收款收口缺少“【上线前有以下关键点】”和“AI 网页应用收款限制”时视为标准收口未送达，必须重发同一次 stdout。自动重试耗尽、业务错误或查询失败且仍未恢复的动作，统一写入分支结果和 `remainingActions`，只说明一次，不在收口后追问是否重试。必须执行：

`SIGNING_RESULT`、`SERVICE_RESULT`、`APPLICATION_RESULT` 和 `INTEGRATION_RESULT` 必须使用消息目录允许的状态枚举原文，禁止拼接 `appId`、公钥文件路径、错误码、截图证据或其他自由文本；本轮 `ALIPAY_PUBLIC_KEY_EXPORT_STATUS=EXPORTED` 时，`APP_KEY_SAVE_PATH` 必须传入前一步独立应用结果 runner。这些证据不能污染分支结果枚举。

进入本步骤前，应用分支已按前一步的交付规则独立输出 `application.operation.result`（无实际 appId 的例外沿用前一步），runner 必须输出唯一 `ALIPAY_AIPAY_INTERNAL:CUSTOMER_MESSAGE_DELIVERY_REQUIRED=application.operation.result`。命令后的下一个 Agent 动作必须先将该次 stdout 原文作为独立用户可见消息送达，送达前禁止 closeout、合并或继续工具调用；总收口不能替代这条应用结果消息。该约束只强化消息交付编排，不新增用户确认点；marker 缺失或不唯一时停止并重跑同一登记命令。

```bash
node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message closeout --product-type "$PRODUCT_TYPE" --root-intent "$ROOT_INTENT" --signing-result "$SIGNING_RESULT" --application-result "$APPLICATION_RESULT" --remaining-actions "$REMAINING_ACTIONS" [--integration-result "$INTEGRATION_RESULT"] [--service-result "$SERVICE_RESULT"] [--sandbox-config-state "$SANDBOX_CONFIG_STATE"] [--manual-verification-items "$MANUAL_VERIFICATION_ITEMS"] --telemetry-run-id "$RUN_ID" --telemetry-history-count "$HISTORY_COUNT" --agent-platform "<AGENT_PLATFORM>" --session-id "<SESSION_ID>"
```

用户输入计数严格继承 `runtime-entry.md`：active run 内每条聊天框用户消息先执行唯一 `count-user-input --run-id "$RUN_ID" --input-id "$USER_INPUT_ID"`，不按 Skill 相关性筛选；runner、recovery、renderer 和 closeout 不做隐式计数。closeout 生成最终 summary 前使用当前 `HISTORY_COUNT` 快照，正式值始终由 runtime counter 写入，禁止传入或覆盖 `user_input_after_clarify_intent`。

runner 从 `PRODUCT_TYPE` 派生产品名，网站支付/APP 支付派生服务结果“无需处理”，从 `ROOT_INTENT` 派生代码开发栏和后续衔接；标题只按完成条件派生。`onboarding_only` 省略 `--integration-result`、`--sandbox-config-state` 和 `--manual-verification-items`。`full_process`：代码开发通过填“已完成”并传 `READY`；仅沙箱待配置且其余代码与安全检查通过填“部分完成，沙箱配置待完成”并传 `CREATE_PENDING|VERIFY_PENDING`；沙箱 `READY` 且只剩非阻塞人工待验证项时填“部分完成，人工待验证”，传 `READY`，把 checklist `manualItems` 原样作为 `MANUAL_VERIFICATION_ITEMS`，并在 `REMAINING_ACTIONS` 写明实际待办，禁止传“无”。runner 拒绝旧完整参数、stdin JSON、`--input-json`、可派生字段和空字符串伪值。renderer 校验结果与沙箱状态/人工待验证项一致，并派生恢复口令或人工待验证展示；不增加确认点。不得在 stdout 前后追加衔接提醒，不伪造本轮代码修改、沙箱创建或测试结果，也不重复进入 integration。

三个产品的总收口只保留分支状态表中的应用发布结果和实际待办，不再重复输出应用结果详情、appId、支付宝公钥保存路径或应用结果专属下一步。应用详情仅由前一步 `application.operation.result` 独立交付；`closeout` 拒绝旧 `--application-operation-*` 参数，禁止把详情改塞入 `remainingActions` 或其他字段。应用创建、提审、复用和人工配置的事实判据保持不变。

当且仅当签约结果为“已提交，等待生效”且应用结果为“已提交审核，等待上线”时，renderer 从消息目录自动在 `remainingActions` 后追加状态查询提示；该提示不是 flow 入参，Agent 禁止自行传入、拼接或在模板外重复输出。其他结果组合不展示该提示。

renderer 还会按 `productName` 和分支完成条件自动派生上线前检查块。Agent 不传入、不改写该字段，也不得在模板外补第二份生产上线清单。该检查使用“【当前状态】/【上线前有以下关键点】/【提示】”结构，不单列“相关站点”，也不在模板尾部追加第二个查询入口；必要 URL 只放在具体操作步骤中。完成态只能表述为代码开发和产品开通流程已完成，不得替用户确认生产配置已替换、产品真实可收款或应用页面状态；通用上线提醒固定分为三点：前往支付宝 AI 付站点查看产品开通情况；进入一站式接入 → 选择产品 → 密钥配置确认目标支付宝应用已上线；将项目中的支付宝应用配置替换为生产配置，确保 appId、应用私钥、支付宝公钥同属一套生产环境支付宝应用并使用生产网关。三个产品的专属提醒从第 4 点开始；AI 网页应用收款和 AI 移动应用收款必须完成公网 HTTPS `notify_url` 的验签、关键字段校验、幂等、`success` 回写和补偿查询；AI 按量付费必须把沙箱 `api_mock_service_id` 替换为服务市场真实 `serviceId`，A2M 示例中的 `sellerId` 来自商户 PID/2088，由商家自行在支付宝平台确认，不由 Agent 猜测、生成或代填。生产环境应用私钥、账号密码、支付凭证和未脱敏通知内容仍禁止提供给 Agent。分支未完成时，该派生块必须明确上表待办完成前不能正式收款。该提示只在消息目录维护，不增加用户确认点，Agent 不得在模板外重复输出或改写。

签约、服务和应用分别按本轮脚本实际结果表达：签约提交成功但未生效时，`signingResult` 固定使用“已提交，等待生效”；服务创建或修改成功且取得 `serviceId`、但未取得服务状态时，`serviceResult` 分别固定使用“创建成功，状态未取得”或“修改成功，状态未取得”。任一分支失败或结果未知不清除其他分支成功，也不能概括为“全部失败”。`APPLICATION_RESULT` 沿用应用阶段上述唯一状态映射和本轮实际 marker，字面值必须与消息目录逐字一致。

`APP_FLOW:RETRY_WITH_LOCAL_CONFIG_PERMISSION` / `ALIPAY_PUBLIC_KEY_EXPORT_STATUS=RETRY_WITH_LOCAL_CONFIG_PERMISSION` 是恢复中间态，不得提前 closeout 为“需人工配置”；取得权限后只重试当前 app 命令一次，最终仍失败才按应用阶段的状态映射收口。

只输出实际取得且有判断依据的费率、`serviceId`、`appId`、应用状态和公钥导出状态；没有取得的字段进入确定的下一步，不使用占位值、空值或推断值。只有签约为“已生效”、按量付费服务已复用或保存成功并取得实际 `serviceId`（消息值为“已复用”“创建成功，状态未取得”“修改成功，状态未取得”或“已完成”；网站支付和 APP 支付固定为“无需处理”）、应用为“已上线且配置完整”、剩余待办为“无”且没有人工待验证项时，runner 才派生“支付产品-产品开通已完成”；否则派生“流程进展”。“状态未取得”只表示保存响应未提供服务状态，不得改写为保存失败；renderer 会交叉校验这些条件，禁止在模板外另写相反结论。

使用 TaskUpdate 只把已经实际执行并取得结果的内部任务标记为 completed。签约待生效、应用待审核、人工配置或其他外部待办必须保持 pending 或在用户可见待办中明确列出，不得为了结束本轮对话把这些事项标记为 completed。对于 `full_process`，此处只表示 onboarding 子流程已执行至当前可推进终点；最终是否完成直接依据两个子流程的实际结果和待办，不得另建状态推断。

<!-- ALIPAY_AIPAY_FLOW:ONBOARDING_CLOSEOUT:END -->

---

## 错误处理（全局规则）

所有 CLI/MCP 操作立即使用脚本内置错误检测，失败后禁止解析业务结果；分类与恢复以 `modules/scripts/error_handler.sh` 和按需读取的 `modules/error-handling.md` 为准。Step 3.1 查询失败仍按分支隔离。

---

## 当前会话事实

只保留当前已确认产品/MCC、已验证材料、候选和脚本结果；重入时重新校验授权并查询全部适用分支。可验证的提前材料直接复用，否则重收。

写结果不明时用现有只读能力核验；仍无法确认则输出未知，禁止推定失败或重复写入。应用公钥只用于本次 `app.sh key/verify-key/verify-key-and-audit` 且不得复述/记录；其他敏感值遵守 `SKILL.md`。`appSign` 仅指 Android 应用签名摘要。
