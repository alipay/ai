# 主方案聚合质量门禁

本文件只定义主方案聚合层的质量门禁：场景决策文件、SDK 来源、跨域工程一致性和共享消息入口。多 Agent 启动和分工见 [多 Agent 代码生成编排规则](../multi-agent-codegen.md)；字段、接口、枚举、SDK Model 和本域工程质量由对应子 Skill 负责。

## 子域边界

1. 员企、费控、账单子域规则以对应子 Skill 为准。
2. 主方案只检查子域结果是否能在同一工程内聚合、编译并满足已确认的单场景约束。
3. 子域 validator 失败时，必须回到对应子 Agent 或子 Skill 阶段修正，不得在主方案层删除接口、删除业务分支或改为 stub 来绕过。
4. 已有项目叠加接入必须交付业务衔接点说明；只新增孤立支付宝模块、通知只打日志或账单只写幂等记录，不能作为默认完成状态。
5. 已有项目叠加接入必须在用户确认计划后写入 `.alipay-skill/integration-contract.json`；契约结构见 [已有项目衔接契约](../integration-contract.md)。新工程不强制生成契约。

## SDK 来源门禁

1. Java 代码生成前必须完成 SDK 预检：确认 SDK 版本来源、Maven 依赖可解析，并在生成后验证实际使用的 SDK 类存在。预检未通过不得生成 Java 接口调用代码。
2. 非 Java 技术栈必须选择对应语言 SDK 或 HTTP(S) 接入方式，不运行 Java SDK/Maven 硬门禁，但仍必须做对应语言的 SDK 导入或 HTTP(S) 签名、模块加载、构建和测试校验。
3. Java/Maven 新项目和已有项目叠加接入都必须先运行以下单条命令读取 Central Portal 页面，再从页面中的 `pkg:maven/com.alipay.sdk/alipay-sdk-java@<version>` 或 Maven dependency snippet 提取 `com.alipay.sdk:alipay-sdk-java` 当前版本：

```bash
curl -sL "https://central.sonatype.com/artifact/com.alipay.sdk/alipay-sdk-java"
```

4. Java/Maven 接入目标版本一律使用 Central Portal 当前版本。已有项目如果已有 `alipay-sdk-java` 依赖，增量改造计划中必须列出升级该依赖和同步 README/说明文档；用户确认计划后执行升级。不得沿用旧 POM 版本，也不得凭记忆使用旧默认版本继续生成。
5. 如果 auto mode、沙箱、网络策略或命令审批禁止执行上述 `curl`，不得改用记忆中的版本，也不得使用 `search.maven.org/solrsearch`、`repo1.maven.org/**/maven-metadata.xml`、`repo.maven.apache.org/**/maven-metadata.xml`、`latestVersion` 或其他 Maven 索引结果兜底；必须停止 Java/Maven 代码生成，请求用户授权执行该 `curl`，或要求用户明确提供 Central Portal 当前版本。
6. 提取出的 `alipay-sdk-java` 版本必须匹配 `^[0-9]+\.[0-9]+\.[0-9]+\.ALL$`。不符合该格式时，视为抓到了页面资源版本或其他无关版本，必须重新从 `pkg:maven/...@<version>` 或 dependency snippet 提取。
7. Java/Maven 场景必须解析 SDK jar，并用 `jar tf` 验证生成代码实际导入的 `com.alipay.api.request/response/domain/msg` 类真实存在。
8. 找不到 SDK getter/setter 或源码包缺失时，使用 `jar tf`、`javap -classpath <sdk.jar> <class>` 或 IDE 反编译确认真实类和方法；不得用反射、`getMethod/invoke`、`BeanUtils`、Map 包装等方式绕过官方 SDK Request/Model/Response 的编译期类型。
9. SDK 类或对应语言能力不存在时，只能调整官方 SDK 版本、继续查文档、改用文档支持的接入方式或报告不支持；不得猜类名、不得生成本地 SDK stub。
10. 不得把 `search.maven.org`、`maven-metadata.xml`、`latestVersion` 或任何非 Central Portal 来源得到的版本描述为“Central Portal 当前版本”。只要 SDK 预检记录、报告或最终回复出现这些来源作为版本依据，Java/Maven 代码生成必须判定为未完成并重新执行 Central Portal 查询。
11. Java/Maven SDK 预检必须在最终回复中给出执行结果：Central Portal 查询命令、从 `pkg:maven/...@<version>` 或 Maven dependency snippet 截取的版本证据，以及依赖/关键类验证结果。未完成 SDK 预检时不得进入接口调用代码生成。

已有项目中，Java/Maven 只把现有 POM/Gradle 作为盘点输入，不作为最终 SDK 版本来源；最终必须升级到 Central Portal 当前版本并验证真实类/方法可用。Node.js 以现有 `package.json` / lockfile 为 SDK 事实来源，除非用户要求升级，不得主动替换版本。

## 场景文件门禁

1. 代码生成必须存在 `.alipay-skill/scenario.json`，且 `status` 为 `CONFIRMED`。
2. 每个字段只描述一个场景，不允许数组化的多场景输入。
3. `expenseType` 与 `expenseTypeSubCategory` 必须是费控枚举文档中的合法组合，`sceneType` 必须来自制度接口文档；用户或上下文未明确因公场景时应为 `DEFAULT`，票务类场景应默认为 `TRAVEL`。
4. `requiredRuleFactors` 必须覆盖费控约束文档要求，`ruleFactorValues` 必须为每个必用因子提供已确认的非空值。
5. 具体费用场景的必用因子、特殊业务值及绑定关系由费控子 Skill 的约束文档和本域 validator 校验；主聚合层不重复硬编码单一场景规则。
6. 内部费控时，`scenario.json` 必须确认制度额度/发放来源：默认 `ISSUE_RULE`，或用户/上下文明确选择的 `QUOTA_LIMIT`、`MANUAL_ISSUE`。选择 `QUOTA_LIMIT` 时，限额因子只能是 `QUOTA_DAY/WEEK/MONTH/SEASON/YEAR/TOTAL`，且必须有已确认业务值。
7. 用户未明确提出因公优先需求时，`businessPriority.enabled` 必须为 `false`，不得额外生成 `ALARM_CLOCK_TIME` 与商户限制规则组合。
8. 用户明确启用因公优先时，必须配置 `ALARM_CLOCK_TIME` 和至少一个当前费用场景约束中允许的有效商户限制因子；费用场景约束中没有任何有效商户限制因子时不支持因公优先，`businessPriority.enabled` 必须为 `false`；`COMPOSITE_MERCHANT` 只有配置规定的非空商户列表时才有效。
9. 使用 `ALI_PLATFORM_TYPE=TAOTIAN/1688` 等淘系平台值时不支持因公优先，`businessPriority.enabled` 必须为 `false`。
10. 账单识别字段必须来自账单文档；不适用的字段可省略，不得用猜测值补齐。

已有项目如果接入前全量构建或测试已失败，必须先记录失败 baseline。接入后优先运行本域 validator、主聚合 validator 和可执行的 scoped build/test；不能把既有无关失败当成本次生成完成的阻塞，也不能忽略本次改动引入的新失败。

## 主聚合校验

1. 生成环境必须运行主校验脚本：`node alipay-enterprise-scenario-integration/scripts/validate_codegen.js <生成项目目录>`。已有项目必须加 `ALIPAY_PROJECT_MODE=existing`，用于强制检查 `.alipay-skill/integration-contract.json`。这是唯一能作为主方案完成依据的校验命令。
2. Java/Maven 项目中，主校验会依次调用员企、费控、账单三个子 Skill 的本域 validator。
3. 主校验必须读取 `.alipay-skill/scenario.json`，检查其状态、费用类型/子类合法性、`scene_type`、必用规则因子和值，并确认这些值真实用于制度创建或修改实现。不得只因通用枚举、常量声明或文档出现相同字符串就视为通过。
4. Node.js 项目中，主校验会依次调用员企、费控、账单三个子 Skill 的本域 validator，并执行 Node.js 聚合结果一致性检查。
5. Python、Go、.NET 项目中，主脚本会运行可用的跨语言子域 validator，并执行所选场景、费控制度字段结构、外部 SPI 占位实现和可用构建检查。
6. 自定义脚本、临时小脚本、手写 checklist、`CODEGEN_REPORT.md`、`GENERATION_REPORT.md` 或模型口头总结均不能替代主校验脚本。可以额外辅助检查，但不得作为完成依据。
7. 不得在生成工程里创建同名或相似的 `scripts/*validate*.js` 来冒充 Skill validator；如果确需项目自测脚本，命名和说明必须明确为业务辅助测试，并且最终完成仍以 Skill 主校验脚本为准。
8. Node 校验脚本属于 Skill 生成质量门禁，不作为接入方工程依赖。
9. 主校验会区分三态：`0` 表示通过，`1` 表示生成代码不符合门禁，`2` 表示门禁自身或子 validator 执行不可信。出现 `1` 或 `2` 时不得宣布生成完成，需先修复代码、门禁或做人工复核。

## Java/Maven 聚合结果一致性

本节只检查多域代码汇合后的工程结果；各子域接口字段、SDK Model 和本域行为仍由对应子 Skill 门禁负责。

1. Central Portal 当前版本是 `alipay-sdk-java` 目标版本事实来源；POM/Gradle 必须升级到该版本。
2. README 或说明文档如写出 `alipay-sdk-java` 版本，必须与 POM/Gradle 保持一致；不得为了匹配 README 反向降级依赖。
3. 生成后必须通过 Maven 编译。编译失败时，必须保留官方 SDK 代码并基于依赖、类型或文档修正。
4. 主校验会用本地 `alipay-sdk-java` jar 反查所有 `com.alipay.api.request/response/domain/msg` 导入类真实存在；不存在时必须调整官方 SDK 版本、读取文档或报告不支持。
5. 主校验会检查 WebSocket 业务载荷没有进入 HTTP 通知信封/二次验签链路，并检查正式 Repository/Store 不使用进程内状态。
6. Spring 注入接口必须在默认配置下存在可用实现；仅有未激活 profile 实现属于运行时装配失败。
7. Java 工程必须存在可执行测试并实际运行；通知链路需要行为测试，Spring Boot 新工程需要上下文装配测试，零测试不得判为通过。

## Node.js 聚合结果一致性

1. 子域字段、接口、通知、SDK 调用和本域 Node.js 门禁由对应子 Skill 负责；主方案不重复展开。
2. 主校验会读取实际安装的 `alipay-sdk`，确认生成工程使用的官方 SDK 导出形态可加载；SDK 不存在或导出不匹配时必须修复依赖或生成代码。
3. 主校验会对生成工程的 `.js` / `.cjs` / `.mjs` 执行 `node --check`，并加载不会启动服务监听的 `src` / `lib` / `app` 模块。
4. 费控模式、制度完整性和额度来源由费控子 Skill 的 Node.js 门禁校验；主聚合层不重复写死内部/外部模式值。
5. 如果 `package.json` 存在 `test` 脚本，主校验只在聚合层运行一次 `npm test`；失败时不得宣布生成完成。

## Python/Go/.NET 聚合结果一致性

1. Python、Go、.NET 等手拼 HTTP(S) 请求体或使用非 Java SDK 的代码，字段名和嵌套路径必须完全来自接口文档；不得按业务语义生成近义字段。
2. 主校验会调用员企、费控、账单跨语言门禁，拦截员企猜字段、账单费用子类错写、费控制度结构错位、固定 SPI 成功返回、空幂等查询和未实现占位。
3. 运行时存在时，主校验会执行 Python 语法检查、`go test ./...` 或 `dotnet build`；运行时缺失时必须在交付说明中明确该构建检查不可用。

## 共享消息入口

Java WebSocket 消息接入的分工和禁止项见 [多 Agent 代码生成编排规则](../multi-agent-codegen.md)。主聚合门禁只检查最终工程是否满足以下结果：

1. 同一个 Java 工程、同一个 `appId` 下只能有一个官方 `AlipayMsgClient` 持有者，且只能有一个 `setMessageHandler` 和一个 `connect` 入口。
2. 共享入口必须调用 `setSecurityConfig(signType, privateKey, alipayPublicKey)`；第一个参数是签名类型（通常 `RSA2`），不得传 `appId`。
3. 主方案聚合多个子域时，必须生成一个共享 `MsgHandler.onMessage` 路由器，按 `msgApi` / `msg_method` 分发到员企、账单、费控处理方法。
4. 子域代码只能提供业务处理器或路由方法；不得各自 `AlipayMsgClient.getInstance(appId)`、`setMessageHandler` 或 `connect`。
5. 主路由器的 `onMessage` 分发逻辑中，每个已声明的 `msgApi` / `msg_method` case 都必须实际调用对应的子域处理器方法；多个 case fallthrough 到同一个处理块可以共用一次调用。
6. 主路由器必须传播子域 handler 的失败结果；不能只调用 `handler.handle(...)` 后忽略返回值。返回 `false`、`fail` 或抛异常时，应进入异常或失败路径，让平台重试语义保留。
7. 未知 `msgApi` / `msg_method` 默认不得正常返回成功；必须抛异常、返回失败，或委托显式 unknown handler 并由该 handler 明确决定是否可确认消费。
8. 首次 `connect()` 建连失败不得只记录日志后让应用继续处于可服务状态；必须选择 fail-fast 阻止启动，或同时具备后台重试和可观测的连接健康/就绪状态。SDK 已成功进入连接生命周期后的自动重连不能替代首次建连失败处理。

## Spring 配置一致性

1. 多域代码聚合到同一 Spring Boot 工程时，所有域的 `@Value` 占位符 key 必须与配置文件（`application.yml` / `application.properties`）中的 key 完全一致。`@Value` 的 `${}` 占位符不支持 relaxed binding，`app-id` 和 `appId` 不可互换。
2. 新工程推荐配置 key 使用 kebab-case（如 `alipay.app-id`、`alipay.private-key`、`alipay.alipay-public-key`、`alipay.gateway-url`）；已有项目优先沿用既有配置命名风格，但同一语义的 key 不得混用多种写法。
3. 主校验会扫描 `alipay.*` 前缀下的 `@Value` 引用，检测同一语义 key 的多写法混用以及 `@Value` 与配置文件不匹配。

## 完成交付门禁

1. 最终完成状态只以实际命令结果为准：SDK 预检、子域 validator、主聚合 validator 和可执行构建/测试。
2. 不引入、读取或依赖 `.alipay-skill/codegen-status.json` 这类状态文件；模型不得用手写状态替代命令执行。
3. 最终回复必须列出实际执行过的关键命令、退出码和最后几行输出，至少包含 SDK 预检、主聚合 validator，以及可执行的构建/测试命令；没有命令、退出码和输出摘录时不得说“完成”“通过”或“可交付”。
4. 主聚合 validator 退出码为 `0` 且必要构建/测试通过时，才能宣布生成完成。
5. 主聚合 validator 退出码为 `1` 时必须修复生成代码；退出码为 `2` 时必须修复门禁或做人工复核，不得宣布完成。
6. 主聚合 validator、构建或测试任一失败时，最终状态必须写 `FAILED` 或“未完成”，不得写 `COMPLETED`、`生成完成`、`全部通过`、`可交付` 或同义结论。
7. 子 Agent 的 `COMPLETED` 只表示本域回执完成，不等于全局交付完成。
