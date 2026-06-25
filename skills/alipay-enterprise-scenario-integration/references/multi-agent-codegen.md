# 多 Agent 代码生成编排规则

本文件定义企业码单场景方案代码生成时的多 Agent 编排规则。主 Skill 只保留入口和硬门禁；多 Agent 启动、子 Skill 加载、分域写入、公共聚合、汇合验收和降级处理以本文为准。

## 适用范围

代码生成任务必须优先使用多 Agent 编排，这是硬性闸门，不是建议项。

除以下情况外，主 Agent 不得自行串行读取三域文档并生成三域代码：

- 用户只选择单一能力域。
- 用户明确要求单 Agent。
- 当前任务只做方案设计，不生成或修改工程代码。
- 当前会话未暴露 sub Agent/Task 工具，且用户确认允许单 Agent 降级。
- sub Agent/Task 工具存在但启动失败，且用户确认允许单 Agent 降级。

主 Agent 可以先完成范围确认、公共决策和 SDK 预检；员企、费控、账单业务代码必须由对应子 Agent 生成。主 Agent 只负责公共工程骨架、合并、冲突处理和聚合校验。

Java/Maven 项目中，SDK 预检是启动子 Agent 生成接口调用代码前的阻断闸门。主 Agent 必须先执行 Central Portal 查询并记录版本、命令和时间；如果命令被拦截，必须停止并请求授权或用户提供版本，不能让子 Agent 先按旧版本或猜测版本生成。

## 新工程与已有项目

代码生成前必须判断目标目录是新工程还是已有项目。

已有项目增量接入时：

- 主 Agent 必须先盘点技术栈、构建工具、现有 SDK 版本、Central Portal 当前 SDK 版本、配置体系、通知入口、目录结构和已实现接口。
- 主 Agent 必须盘点已有 Entity、Service、Repository、Controller，并标出企业、员工、订单、账单、费用记录、报销或对账等可衔接对象。
- 第一轮只能输出项目盘点、增量改造计划和拟定 `.alipay-skill/integration-contract.json`，列出拟新增文件、拟修改文件、不会触碰的公共文件、已有能力复用点和业务衔接点；Java/Maven 项目必须把 `alipay-sdk-java` 升级到 Central Portal 当前版本列入计划；不得修改代码、接口文档、构建文件或写入契约文件。
- 用户确认增量改造计划后，才能启动分域子 Agent 进入代码生成或修改。
- 用户确认后，主 Agent 先写入 `.alipay-skill/integration-contract.json`，再启动分域子 Agent。契约结构见 [已有项目衔接契约](integration-contract.md)；其中不得保留 `NEEDS_USER_CONFIRM`。
- 公共文件只允许最小补丁；不得重写既有 `pom.xml`、`build.gradle`、`package.json`、配置中心接入、启动入口、README 或 CI 配置。
- 已有 `AlipayClient`、HTTP 通知网关、WebSocket 消息入口和业务 service 优先复用；已有 Alipay SDK 依赖只复用坐标和配置方式，版本必须升级到 Central Portal 当前版本。
- 子 Agent 只补本域缺口：先识别已有接口/通知实现，再生成缺失接口或补齐字段、验签、幂等和测试。不得只新增孤立支付宝模块；如果上下文可推断，企业/员工通知必须衔接已有企业/员工对象，账单通知必须衔接已有订单、费用记录、报销或对账对象。
- 如果无法从已有代码推断业务衔接点，必须在计划中说明缺口并暂停确认；用户明确选择旁路验证前，不得把通知处理生成为仅日志、仅幂等记录或无业务落库的成功路径。
- 子 Agent 接收主 Agent 写入的契约后，只读取自己 domain 下的 `joinPoints`、`changes` 和 `gaps`；子 Skill 单独接入已有项目时也使用同一契约结构，但只填写自己的 domain。
- 如果既有项目的全量构建或测试原本失败，必须记录 baseline；交付时至少证明本次改动没有新增失败，并运行可执行的本域/聚合校验。

新工程生成时，主 Agent 可以创建公共工程骨架，但仍必须按阶段边界分域生成和聚合。

## 启动闸门

主 Agent 在任务入口已经执行 `node alipay-enterprise-scenario-integration/tools/install_subskills.js`。进入代码生成编排前必须再次确认三个平级子 Skill 均存在且完整；失败时停止，不得进入 Agent 启动或接口文档读取阶段。

子 Skill 安装通过后，再检查当前会话是否暴露 sub Agent/Task 工具。

多域代码生成时：

- 必须启动员企、费控、账单三个分域子 Agent。
- 如果某个域未被用户选择，可以不启动该域，但必须在启动状态中说明未选择原因。
- 不得仅凭模型判断声明“不支持多 Agent”。
- 如果没有可用 sub Agent/Task 工具，或工具存在但启动失败，必须记录具体原因，并停止在代码生成前等待用户确认是否单 Agent 继续。

未完成子 Agent 启动或用户确认降级前，主 Agent 不得读取员企、费控、账单任一子 Skill 的流程文档、接口文档或字段规则，也不得生成接口调用代码；已有项目还必须先完成盘点、增量计划和拟定契约。

启动状态必须包含：

- 已启动：列出员企、费控、账单子 Agent 的任务边界、写入范围和子 Agent 标识。
- 已降级：说明具体原因和依据，例如当前会话未暴露子 Agent/Task 工具、工具调用失败及错误信息、用户仅要求单域小改、只做方案设计、或用户明确要求单 Agent。

## 启动任务

启动子 Agent 时必须显式传入对应子 Skill，而不是只让子 Agent 自行读取 references 文档。若 sub Agent/Task 工具支持结构化输入，必须把对应 `SKILL.md` 作为 skill item/mention 传入；若工具只支持文本输入，任务消息必须写明对应子 Skill 路径，并要求子 Agent 第一步加载该 `SKILL.md`。

- 员企 Agent：加载 `alipay-enterprise-ec/SKILL.md`；沿用企业入驻模式、员工签约模式、消息接入方式和员企模块清单；只写员企目录。
- 费控 Agent：加载 `alipay-enterprise-expense-control/SKILL.md`；读取主 Agent 已确认的 `.alipay-skill/scenario.json`，沿用费控模式、模块清单、费用类型、费用子类、因公场景、规则因子及其值；只写费控目录，不重新猜测场景。
- 账单 Agent：加载 `alipay-enterprise-bill/SKILL.md`；读取主 Agent已确认的 `.alipay-skill/scenario.json`，沿用账单模式、消息接入方式、账单模块清单和场景识别字段；只写账单目录。

## 子 Skill 加载握手

子 Agent 第一轮输出必须包含加载握手：

- `已加载 Skill: <skill-name> (<SKILL.md 路径>)`
- 沿用的上游决策
- 允许写入范围
- 禁止读取/修改范围

子 Agent 未确认加载对应 `SKILL.md` 前不得读取本域接口文档或生成代码；主 Agent 不得接受未完成加载握手的子 Agent 产物。

## 分工边界

主 Agent 负责：

- 单场景确认、`.alipay-skill/scenario.json`、范围确认、模式选择和消息接入方式决策
- SDK 预检
- 公共工程骨架
- 子 Agent 任务拆分和启动状态维护
- 公共文件、消息聚合配置和跨域冲突处理
- 子域 validator 和主聚合 validator

子 Agent 负责：

- 员企 Agent 只读取 `alipay-enterprise-ec`，只生成或修改员企代码，例如 `src/main/java/**/ec/**`。
- 费控 Agent 只读取 `alipay-enterprise-expense-control`，只生成或修改费控代码，例如 `src/main/java/**/expense/**`。
- 账单 Agent 只读取 `alipay-enterprise-bill`，只生成或修改账单代码，例如 `src/main/java/**/bill/**`。

公共文件由主 Agent 统一维护，包括构建文件（如 `pom.xml`、`build.gradle`、`package.json`、`composer.json`）、配置文件（如 `application.yml`、`.env`）、`README.md`、启动入口、SDK 配置和消息聚合配置。

子 Agent 不得修改其他域代码，不得修改公共工程文件，不得读取其他子 Skill 文档。

已有项目中，公共文件由主 Agent 以最小补丁维护；子 Agent 如发现需要新增依赖、配置项或启动入口改动，只能在最终回执中提出需求，不得直接修改公共文件。

## 接口证据表

子 Agent 进入本域接口调用代码生成前，必须先输出接口证据表。证据表至少覆盖本域已选择模块的全部接口和必要通知，包含接口方法名、已读取的接口 Markdown、示例代码位置或片段、SDK/HTTP(S) 确认结果、Java Request/Model/Response 或 HTTP 字段来源、关键字段路径、枚举/规则因子来源、拟写入文件、已有对象复用点和仍需主 Agent 处理的公共配置。主 Agent 不得接受没有证据表的子 Agent 产物；单 Agent 降级时，也必须按员企、费控、账单分段输出同样证据表。

证据表不是交付说明的装饰项，而是生成前闸门。某个接口无法确认文档、示例、SDK 类或字段路径时，只能继续查找或暂停反馈，不得先写代码再用编译错误、反射、Map 包装、本地 SDK stub 或删除接口能力补救。

## 公共聚合规则

### Java WebSocket 聚合

如消息接入方式为 Java WebSocket，主 Agent 必须收敛为一个共享的官方 `AlipayMsgClient + MsgHandler` 入口，并聚合已存在的子域 handler；不得新增另一套 WebSocket 协议层，也不得保留多个官方 SDK 连接入口。

同一个 Java 工程、同一个 `appId` 下只能有一个 `AlipayMsgClient.getInstance`、一个 `setMessageHandler` 和一个 `connect` 入口。子 Agent 被方案型 Skill 调用时，只生成可被路由器调用的业务 handler，不得各自启动 WebSocket 客户端；若子 Agent 已生成独立入口，主 Agent 必须在聚合阶段改为单入口路由。

主 Agent 不得新增：

- Spring `WebSocketConfigurer` / `TextWebSocketHandler`
- `javax.websocket` / `jakarta.websocket` / `@ServerEndpoint`
- `Java-WebSocket` 或 `org.java_websocket`
- 自定义 auth、ack、heartbeat、verifySign 等连接协议逻辑
- 未经子 Agent 产物确认的 `*NotifyService`、`*WebSocketHandler` 或消息路由类

共享入口必须按 SDK 语义配置安全参数：`setSecurityConfig(signType, privateKey, alipayPublicKey)` 的第一个参数是签名类型（通常 `RSA2`），不得传 `appId`。如需要配置连接域名，使用 SDK 提供的 connector/serverHost 配置方法，不得手写 WebSocket URL 和协议包。

首次 `connect()` 建连失败必须 fail-fast 阻止启动，或进入带退避的后台重试并同步更新健康/就绪状态；不得只记录日志后把应用留在“运行但收不到消息”的状态。

如需要统一消息路由，只能在官方 `MsgHandler.onMessage` 内按 `msg_method` 分发到已存在的子域 handler；不得为了“公共消息聚合”创建自建 Spring WebSocket 入口。

主 Agent 聚合消息路由时必须确保：

- 每个子域的消息通知都被路由器实际分发到已注入的 Spring Bean handler 方法。
- 如果某个子 Agent 生成的通知处理器不是 Spring Bean，主 Agent 必须将其改造为 Spring Bean 并注入路由器，或将通知处理逻辑内联到路由器中。
- 路由器 switch/case 中不得出现只有注释或空 break 的分支。
- 子域 handler 返回 `false`、`fail` 或抛异常时，主路由不能吞掉结果；需要转换为异常或明确失败路径，让平台重试语义不被破坏。

如子 Agent 已生成官方 `AlipayMsgClient + MsgHandler` 接入，主 Agent 在公共阶段只能补齐配置项、启动说明和 README，不得再生成新的 WebSocket server，也不得保留多个 SDK message handler。

### 配置一致性

子 Agent 生成的代码中 `@Value` 占位符 key 必须与主 Agent 生成的配置文件完全一致。`@Value` 的 `${}` 占位符不支持 Spring relaxed binding。

主 Agent 新建 `application.yml` 时优先使用 kebab-case；叠加到已有项目时优先沿用既有配置命名风格。无论采用哪种风格，子 Agent 的 `@Value` 必须与最终配置文件中的 key 完全一致，同一语义不得混用多种写法。

## 汇合验收

主 Agent 启动任何子 Agent 后，必须维护子 Agent 完成清单，并等待所有已启动子 Agent 返回最终回执。

每个已启动子 Agent 的最终回执必须包含：

- 已加载 Skill
- 接口证据表
- 已读文档
- 生成或修改文件
- 接口和通知覆盖
- 本域自检结果
- 未覆盖边界
- 已有项目场景下的复用点、未触碰文件和仍需主 Agent 处理的公共改动需求
- 已有项目场景下本域契约执行结果：确认的 `joinPoints`、实际 `changes` 和是否仍有缺口
- 明确状态：`COMPLETED` 或 `FAILED`
- 费控和账单 Agent 还必须确认其实现使用的场景值与 `scenario.json` 一致

子 Agent 的 `COMPLETED` 只代表本域任务结束，不等于全局交付完成。全局完成态只能由主 Agent 在 SDK 预检、子域 validator、主聚合 validator 和必要构建/测试都通过后，在最终回复中说明。

子 Agent 完成后必须输出已读文档、生成文件、接口覆盖、本域自检结果和未覆盖边界。主 Agent 合并三域代码后，运行三个子域 validator 和主聚合 validator；失败时按所属域退回对应 Agent 或阶段修正。

主 Agent 在收齐所有已启动子 Agent 的 `COMPLETED` / `FAILED` 回执前：

- 不得进入消息和聚合阶段
- 不得运行最终主聚合校验
- 不得输出“生成完成”“交付完成”或同义结论
- 不得替子 Agent 猜测完成状态

如任一子 Agent 返回 `FAILED`、无最终回执、仍在运行或后台任务未结束，主 Agent 必须停止最终交付，只能说明等待或失败的 Agent、当前状态和下一步处理。
