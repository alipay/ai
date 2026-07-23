# 完整接入编排

本文件是 `full_process`（“完整接入”“一站式”）的详细编排入口。完整接入启动确认前，只允许按本文件边界复用 `references/integration/flow.md` 步骤 1 的目标项目、服务端语言、CLI 和匿名沙箱准备；不得进入产品代码开发，不得进入 `references/onboarding/flow.md`，也不得读取或展示产品开通信息。

本文件代码块和行内命令中的 Skill 相对路径一律以本文件所在的 `references/normal/` 目录解析；用户可以选择新建项目，或复用已有项目。新建项目可以说明尚不存在或为空的新目录；用户明确要新建但不想指定位置时，runner 使用用户目录下的默认安全目录并返回规范化地址。复用已有项目必须说明具体项目文件夹，或先让 runner 在当前目录或用户给出的子目录下轻量定位候选项目。“当前项目/当前目录”只有在 runner 确认当前目录本身是可识别项目根时才接受为现有项目。进入用户项目扫描前，必须先由本文件登记的 runner 解析并确认规范化绝对路径；后续脚本仍只接收该绝对路径，不依赖当前工作目录。

## 边界

- 只编排两个 flow，不复制其状态、完成条件、红线或校验；完整接入复用 Integration 步骤 2 的唯一 `integration.start.confirm`，与 `integration_only` 使用同一项目事实和对客模板，且本轮只渲染一次。以下维度只用于选择项目和首个子流程。
- 识别到“完整接入”“一站式”等 `full_process` 意图后，先只确定目标项目、服务端语言和必要的项目创建方式；如果用户已明确说出支付产品，只作为后续分流线索记录。`NEW_PROJECT` 先用固定检查器确认路径尚不存在或为空，再按已确认方式初始化最小项目骨架；随后按 `references/integration/flow.md` 步骤 1 尝试准备匿名沙箱。该步骤不依赖目标产品，不传 `PRODUCT`，不对客展示沙箱摘要；既定重试耗尽时由脚本输出待配置消息并继续后续代码开发。此时禁止读取或对客展示 MCC、授权范围、产品开通材料、产品开通待办或代码开发与产品开通的合并清单。
- 项目检查必须基于实际文件和代码证据：先用 runner 解析用户选定的具体项目根；用户不知道位置或只给出大概子目录时，先用 `locate-projects --search-input "$SEARCH_INPUT" --format message` 只查项目标记文件并等待用户选择候选，不得直接扫描上层大目录。随后按 `references/integration/flow.md` 的 `INT.CODE.*` 与 `INT.CHECKLIST.PASSED` 要求检查目标产品的适用接口、SDK 调用、支付入口、结果处理和必要安全逻辑。空目录、无关项目、仅安装 SDK、只有配置、单个下单接口或零散示例代码都不能算完整集成。

## 新项目准备与路由分类

初始化前的项目来源取值互斥：

1. `CURRENT_PROJECT`：用户选定当前目录内一个可访问且可识别的项目根并记录规范化路径；多候选未选定、当前目录不是项目根或仅描述上层大目录时不可使用。
2. `OTHER_PROJECT`：用户选定目录外的可访问项目并记录规范化路径；不可访问时保持 `PROJECT_UNRESOLVED`，不得仅凭用户或 Agent 描述生成代码状态。
3. `NEW_PROJECT`：只表示初始化前的新项目来源。用户可说“在当前目录新建 pay-demo”、提供当前目录下新子目录名、绝对路径，或只说“新建/新建项目/帮我新建默认项目”；必须先执行 `node scripts/integration_message_runner.mjs resolve-project --project-input "$PROJECT_INPUT" --base-path "$USER_WORKSPACE_ROOT" --intent new`。该 runner 内部调用固定检查器 `prepare-new`；用户明确要新建但未指定地址时，runner 默认选择用户目录下的 `alipay-aipay-projects/pay-demo`，若已被非空目录占用则自动使用安全后缀。只有实际返回 `preparationStatus=READY` 才能按用户确认的语言、框架和创建方式初始化。路径非空、不安全或初始化失败时不得清空/覆盖，改按已有项目检查、默认项目或重新选空路径。
4. `PROJECT_UNRESOLVED`：未找到、未选定或无法定位项目/新路径；不得进入子流程。

新项目初始化并取得步骤 1 的 `READY|CREATE_PENDING|VERIFY_PENDING` 终态后，当前会话中的路由分类从 `NEW_PROJECT` 单向转为 `PREPARED_NEW_PROJECT`。这不是持久化业务状态；只保留“本轮新建项目”的展示来源，流程中断后重新开始仍按当前项目文件扫描，不读取历史分类。`NEW_PROJECT` 不得直接用于产品代码扫描，`PREPARED_NEW_PROJECT` 也不得反向恢复为空目录状态。

### 固定检查器与 runner 终态协议

- `resolve-project --intent new`：只接受退出码 0 和唯一 JSON：`projectPath=<规范化项目绝对路径>`、`projectSelection=NEW_PROJECT`、`projectOrigin=NEW_PROJECT`、`projectOriginLabel=本轮新建项目`、`preparationStatus=READY`；随后立即初始化并进入 Integration 步骤 1。否则保持 `PROJECT_UNRESOLVED`，只按实际 `INTEGRATION_MESSAGE_ERROR` / `ROUTE_INSPECT_ERROR` 处理。
- `resolve-project --intent existing`：只接受退出码 0 和唯一 JSON：`projectPath=<规范化项目绝对路径>`、`projectSelection=CURRENT_PROJECT|OTHER_PROJECT`、`projectOrigin=EXISTING_PROJECT`、`projectOriginLabel=现有项目`。相对路径只允许位于 `--base-path` 内；目录外项目必须由用户提供绝对路径；路径必须是可识别项目根。“当前项目/当前目录”解析失败时保持 `PROJECT_UNRESOLVED`，不得把用户描述或 Agent 当前 cwd 当作项目事实。
- `locate-projects --search-input "$SEARCH_INPUT" --format message`：用户不知道已有项目位置、当前目录不是项目根、只给出大概子目录或存在多候选时使用；`SEARCH_INPUT` 未给出时固定为 `当前目录`。该命令只查项目标记文件并跳过常见重目录，stdout 是唯一对客候选选择消息。用户回复候选序号或路径后，仍必须再执行 `resolve-project --intent existing`，候选列表不能直接替代项目确认。
- `integration_message_runner.mjs start-confirm`：内部执行一次 `scan`，校验项目来源、状态枚举和字段类型，并把同一对象交给 `integration.start.confirm`。失败进入 `STATUS_UNKNOWN`，禁止生成确认或手写兜底。
- 两种模式都禁止改写检查命令、另跑扫描、抽取代码片段，或追加 `find`、`ls`、`stat`、额外 `jq` 和临时脚本复核同一结果；不得用 Agent 自报值覆盖检查器输出。

## 维度二：目标产品集成状态

项目准备并取得沙箱 `READY|CREATE_PENDING|VERIFY_PENDING` 终态后，确定目标产品，再使用固定检查器扫描 `CURRENT_PROJECT`、`OTHER_PROJECT` 或 `PREPARED_NEW_PROJECT`，按顺序命中即止：

目标产品能够从用户已提供的产品名称或业务描述中可靠映射为按量付费、网站支付或 APP 支付时直接使用，不重复询问。仍无法唯一确定时，只执行下列固定消息命令；renderer stdout 是本轮唯一对客正文，必须把 stdout 原文作为当前回复正文发给用户，发出后立即停止并等待用户回复产品名称或明确业务描述。回复后仍无法唯一确定时继续执行同一消息，禁止自由补问或推定产品。目标产品明确前不得执行 `scan`。

```bash
printf '%s' '{}' | node scripts/render_customer_message.mjs product.clarify --variant DEFAULT
```

1. `TARGET_PARTIAL`：发现目标产品代码/配置，不论核心接口标记是否看似齐全；初始化静态扫描不能证明配置、安全、测试和 checklist 完成，必须进入 Integration 验证分支。同时有其他产品仍优先本项。
2. `OTHER_PRODUCT_ONLY`：只发现其他支付产品；记录实际产品且不得改动。
3. `NO_PAYMENT`：可访问项目经有效检查未发现支付能力。
4. `STATUS_UNKNOWN`：不可访问、证据不足/冲突或产品不明；不得进入子流程。

完整接入中，先完成项目和服务端语言准备并取得匿名沙箱准备的确定终态，再确定目标产品并执行扫描；`CREATE_PENDING|VERIFY_PENDING` 不阻止扫描或代码开发。现有项目使用 `CURRENT_PROJECT|OTHER_PROJECT`；本轮初始化的新项目只能使用 `PREPARED_NEW_PROJECT`，检查器输出必须保留 `projectOriginLabel=本轮新建项目`。`PROJECT_UNRESOLVED` 补齐项目选择/路径，`STATUS_UNKNOWN` 继续取得可访问项目和可靠代码证据；澄清后重算，不得推定。已有项目上“新建”只能保留原项目并新增能力、使用明确空子目录或其他路径，禁止提供清空选项。monorepo、多项目、多支付产品和部分集成都沿用上述分类，不新增持久化状态。

## 穷举路由矩阵

| 目标项目选择 | `TARGET_PARTIAL` | `OTHER_PRODUCT_ONLY` | `NO_PAYMENT` | `STATUS_UNKNOWN` |
|---|---|---|---|---|
| `CURRENT_PROJECT` | 确认后进入 Integration 验证 | 确认后 integration | 确认后 integration | 继续澄清 |
| `OTHER_PROJECT` | 确认后进入 Integration 验证 | 确认后 integration | 确认后 integration | 继续澄清 |
| `PREPARED_NEW_PROJECT` | 确认后进入 Integration 验证 | 确认后 integration | 确认后 integration | 继续澄清 |
| `PROJECT_UNRESOLVED` | 继续澄清 | 继续澄清 | 继续澄清 | 继续澄清 |

## 完整接入启动确认

只有路由分类已解析为 `CURRENT_PROJECT` / `OTHER_PROJECT` / `PREPARED_NEW_PROJECT`，产品代码状态已解析为 `TARGET_PARTIAL` / `OTHER_PRODUCT_ONLY` / `NO_PAYMENT` 的合法组合，并且产品、服务端语言和框架均已确定时，才能使用 `references/normal/customer-messages.json` 的 `integration.start.confirm` 发起本确认。缺少项目位置或技术栈时，必须执行下列标准消息一次补问；只缺少新项目精确位置时使用 `integration.project_path.required`。禁止使用 AskUserQuestion、request_user_input、宿主超时默认值、Agent 自创选项或自由话术替代。字段已确定时禁止先输出单独的扫描摘要或代码开发方案。

```bash
MESSAGE_INPUT_JSON=$(jq -cn --arg missingItems "$MISSING_ITEMS" '{missingItems:$missingItems}')
printf '%s' "$MESSAGE_INPUT_JSON" \
  | node scripts/render_customer_message.mjs integration.context.required --variant DEFAULT
```

`MISSING_ITEMS` 只允许由 `项目路径`、`技术栈` 按缺失项用顿号连接生成；产品不明确时仍使用上方 `product.clarify`，不得混入本消息。该消息必须把 stdout 原文作为当前回复正文发给用户，发出后立即停止并等待用户自由回复；未补齐前不得创建目录、初始化项目、安装依赖或修改文件。用户回复“当前项目”、相对路径或新建子目录时，必须先执行 `resolve-project` 取得规范化绝对路径和项目选择分类；解析失败时继续澄清，不得手写绝对路径或静默改选项目。用户回复“不知道项目在哪”“帮我找项目”、提供子目录但该目录不是项目根，或需要候选时，执行下列唯一候选定位消息，stdout 发出后停止等待选择：

```bash
node scripts/integration_message_runner.mjs locate-projects \
  --base-path "$USER_WORKSPACE_ROOT" \
  --search-input "$SEARCH_INPUT" \
  --format message
```

从本文件所在的 `references/normal/` 目录执行下列唯一 runner。runner 内部完成一次 `scan`、字段转换、产品/项目一致性校验和 `integration.start.confirm` 渲染；禁止拆开执行 `project_route_inspector.sh`、`jq` 或 `render_customer_message.mjs`，也禁止在 runner 前后增加其他 `jq`、`grep` 或临时解析。字段齐备后不得先输出扫描结论、项目摘要或下一流程说明；runner stdout 是本动作唯一对客消息，必须把 stdout 原文作为当前回复正文发给用户，命令面板、折叠输出或“已渲染/已展示”说明不能替代对客消息。禁止任何前后缀，发出 stdout 原文后立即停止本轮并等待用户针对当前摘要明确回复 `1`。摘要变化后旧回复失效。静态扫描即使发现全部核心接口也只能进入 Integration 验证；验证通过时不重复修改代码，不改动无关支付能力。

```bash
node scripts/integration_message_runner.mjs start-confirm \
  --product-type "$PRODUCT_TYPE" \
  --product-name "$PRODUCT_NAME" \
  --project-path "$PROJECT_PATH" \
  --project-selection "$PROJECT_SELECTION" \
  --language "$SERVER_LANGUAGE" \
  --framework "$FRAMEWORK"
```

上面命令失败时不得展示手写确认或进入子流程。`PRODUCT_TYPE`、`PRODUCT_NAME`、`PROJECT_PATH`、`PROJECT_SELECTION`、`SERVER_LANGUAGE` 和 `FRAMEWORK` 必须是当前已经确定的固定值；禁止把用户输入直接拼进命令文本。runner 会校验 variant 与目标产品匹配，并固定展示服务声明。完整接入的实际执行范围不从对客消息读取，始终由当前产品对应的 Integration flow、接口范围、完成条件和 checklist 决定。

- `PROJECT_UNRESOLVED` / `STATUS_UNKNOWN`：只能继续澄清，不能发起完整接入启动确认或进入子流程。

确认后把产品、项目路由分类、项目来源、规范化路径、代码开发状态、其他产品、语言和框架作为同一对客确认上下文原样交接；检查器依据只作为内部校验事实保留，不进入消息或被描述为用户已确认。不回退原工作目录或重猜项目。该回复同时满足 integration 步骤 2 的 `INT.START.CONFIRMED` 和 `INT.SERVICE_STATEMENT.CONFIRMED`；进入 integration 后禁止再次渲染 `integration.start.confirm`，直接执行步骤 3。进入 integration 时已有项目须可访问；`PREPARED_NEW_PROJECT` 必须已经按步骤 1 前置准备确认语言、框架和创建方式并初始化，条件不足就地补齐。

分流事实必须来自上述 runner 内部同一次 `scripts/project_route_inspector.sh scan` 的实际输出；不得用用户描述、Agent 自报状态或历史分类替代，也不得拆开 runner 自行处理检查器输出。确认摘要的 `projectOriginLabel`、代码状态和其他产品必须由 runner 直接复用同一对象；同一对象的 `evidence` 仍必须通过 runner 类型校验，但不传入 renderer。此时 onboarding Step 2 尚未确认 MCC，禁止传入或猜测 `mccCode`。

**阻塞规则（执行约束，不是对客正文）**：所有可路由组合都必须完成一次完整接入启动确认，检测结果和用户此前零散提供的信息都不能自动替代。用户必须在同一摘要中确认目标产品、项目路径、项目来源、目标产品代码状态、语言/框架、服务声明和先代码开发后产品开通的执行顺序；检测到其他支付产品时，还必须确认“保留已有其他支付能力，仅新增或补全目标产品”。只说“继续”或“新建”、未选择多项目中的具体项目、未完成新项目空路径预检与初始化，或未确认保留已有其他支付能力时，除本文件已明确允许的 Integration 步骤 1 前置准备外，均不得进入产品代码开发或 onboarding。用户无需在本消息中确认步骤清单；确认后仍必须完整执行当前产品对应的 Integration flow 和 checklist。`PROJECT_UNRESOLVED` / `STATUS_UNKNOWN` 先澄清并重新分类，再执行本确认。

## 子流程衔接规则

- `TARGET_PARTIAL` / `OTHER_PRODUCT_ONLY` / `NO_PAYMENT` 在上述代码开发启动确认后直接进入 integration 步骤 3；不得再次输出 `integration.start.confirm` 或要求第二次输入 `1`。项目路径、产品、语言或框架变化时旧确认失效，返回本文件重新扫描并渲染一条新的完整摘要。
- 完整接入固定先执行 integration 的适用步骤和自动校验，再自动进入 onboarding。沙箱待配置是唯一缺口时，代码开发保持“部分通过”，固定提醒恢复动作后仍进入 onboarding；存在其他代码、安全或必要依据未通过项时停在 integration，不提前登录、查询、收集产品开通材料或执行 onboarding 写操作。
- 跨子流程只复用已经实际取得且仍有效的产品判断、目标项目、代码开发产物和 CLI 环境检查；阶段切换不再询问“是否进入产品开通”。onboarding 的方案确认不得省略；签约材料完整且校验通过后直接提交，不增加回复 `1`；服务创建资料完整且校验通过后展示非阻塞摘要并直接创建，服务修改仍须完成外部写确认；新建应用的公钥校验成功后直接提审。
- onboarding 登录后分别查询签约、应用和适用服务；单个业务/结构/服务失败只阻断对应分支，认证、授权不匹配或主体变化仍全局阻断。查询完成后按类别一次只收集一个分支材料，用户提前提供的后续材料直接接收并校验，不重复索取。
- 签约、按量付费服务和应用分支在登录成功后逻辑独立，不以签约提交成功作为服务/应用前置。签约材料完整且校验通过后直接执行签约脚本；材料缺失或校验失败时继续材料提示，禁止提交。服务创建展示受控摘要后直接执行，服务修改单独确认；用户针对当前应用候选列表明确选择 `新建` 后，候选重查未变化且条件字段齐备时直接创建应用，不再追加回复 `1`。用户提供应用公钥后直接生成官方确认页，不再增加写摘要确认；新建应用的公钥校验成功后直接提审，不再追加确认。按量付费沙箱测试仍属于 integration 默认调试步骤，不新增确认点。
- 两个子流程都到达当前可推进终点后，直接汇总实际代码开发、沙箱、产品开通、服务、应用和待办状态。代码开发阶段遗留的非阻塞人工待验证项必须在 onboarding Step 6 的最终收口中展示，不增加确认点。存在待生效、待审核、未通过校验、人工待验证或正式配置未完成时，只能表述为“本轮完整接入已执行至当前可推进终点”，不得宣称生产就绪。
