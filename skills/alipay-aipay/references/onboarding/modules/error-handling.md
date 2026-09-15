# 错误处理业务语义

只在 Onboarding 脚本报错、需要解释登记分类或用户要求排障细节时读取本模块。运行时 Agent 只执行 flow 中的脚本入口；`../../normal/scripts/common.sh` 初始化 CLI 上下文，`scripts/network_retry.sh` 保持原 argv 执行有限重试，`scripts/error_handler.sh` 负责解包、分类、脱敏和登记输出。不得在脚本外追加 MCP 调用、`handle_error`、`unwrap_mcp` 或临时解析命令。

## 分类与恢复

| 内部分类 | 已验证触发 | 恢复边界 |
| --- | --- | --- |
| `MCP_AUTH_ERROR` | 非 JSON 传输错误中的 HTTP 401/认证强证据；JSON 顶层或登记 error/response 层中的数字/字符串 `401`、`unauthorized`、`Authorization is empty`、非法认证信息、`用户未登录`、`not_logged_in` 等明确登录失效证据；已认证资源动作顶层或 `data.logged_in=false` | 停止查询组；logout 后置条件成立后重授权。仍登录则阻断；不可确认或无网络时只重试同一动作，不解释为用户本机或支付宝业务失败。成功候选、说明或请求示例中的相同文本不构成认证错误 |
| `AUTH_MISMATCH` | `mccCode is not auth`、`salesProductCodes is not auth`、`scope is not auth` | 停止当前动作，只进 `auth.sh mismatch`；logout 后置条件未成立前禁重授权 |
| `MCP_SERVICE_ERROR` / `SERVICE_UNSTABLE` | 已识别连接、网络或服务异常 | 按下方有限重试规则处理；耗尽后记录受影响分支，依赖允许时继续其他独立分支，最终统一收口 |
| `DISCOVERY_FLOW:RETRY_WITH_NETWORK` | discovery 子查询重试耗尽，且原始输出包含 DNS、连接、timeout、socket/TLS、`fetch failed`、`network_error`、`网络连接失败` 或连接前沙箱禁网强证据 | 只在无授权阻断时输出一次；暂存首次 stdout，申请联网权限后原样重试同一 discovery 命令一次。拒绝、不支持或再次命中时停止申请，只送达最新一次既有 stdout |
| `DISCOVERY_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION` | discovery 任一子查询在 CLI 调用前探测失败，或只读调用后命中 CLI 私有状态权限证据 | 授权阻断优先；本次不渲染 discovery 摘要，取得两个 CLI 私有状态目录权限后原样重试同一 discovery 命令一次，不改产品、salesCode 或签约复用回执 |
| `CLI_LOCAL_FS_PERMISSION` | 受控 CLI 动作 preflight 失败；或原始 stdout+stderr 命中私有状态写失败强证据，或私有状态路径与权限错误组合 | auth 使用唯一 `AUTH_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION`；其他未发送或只读动作使用唯一 `CLI_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION`。取得目录权限后原样重试一次；写动作已执行则保持 `MAYBE_SENT` 并只核验/标记 `UNKNOWN`，不得重放 |
| `APP_LOCAL_CONFIG_PERMISSION` | 已取 RSA2 支付宝公钥但 config 探针失败 | stdout 空；输出两个本地权限 marker，取权后原样重试当前 app 命令一次，不重开公钥页 |
| `OPEN_ERROR_KIND` | URL 已交付但 opener 失败 | 保留 URL 兜底；诊断不对客，不改写为业务、网络或授权失败 |
| `ERROR:<code>` | 当前响应中存在可识别业务错误 | 展示登记且脱敏的业务错误，修正业务条件前不重试 |
| `CLI_ERROR:<message>` | CLI 失败、异常结构或结果不可唯一解析 | 隐藏原始输出，停止并按登记 CLI 错误恢复，不猜成功或空结果 |
| `SUCCESS` | 唯一合法成功结构 | 才允许进入当前脚本的业务字段解析 |

发现阶段的单分支失败不得伪装为空列表，也不得回滚其他已成功分支；认证失效或授权不匹配属于查询组全局阻断，重新授权后恢复尚未执行的查询，主体一致性无法确认时重新查询全部适用状态。`logged_in=false` 只在已认证的签约、服务、应用和上传等资源动作中属于认证失效；`auth.sh whoami` 的成功未登录结果仍是正常登录入口，失败响应即使携带该字段也不能证明已退出。discovery 的恢复优先级固定为真实认证/授权阻断、本地 CLI 状态权限、网络权限、普通分支失败；`AUTH_FLOW:RETRY_WITH_NETWORK|RETRY_WITH_LOCAL_FS_PERMISSION|LOGOUT_STILL_LOGGED_IN` 不是 discovery 子查询的认证失效证据，不得映射为 `AUTHORIZATION_INVALID`。

discovery runner 的并发子查询不得让每个子进程各自 logout。三张截图固定串行上传，禁止多个 `alipay-cli file upload` 进程并发读取认证态；截图和 discovery 子脚本在受抑制环境下只上报一次认证失效事实，不渲染“正在退出当前登录”，由 flow 登记的唯一授权恢复入口处理。

## 解包与业务错误

`unwrap_mcp` 兼容纯业务 JSON、唯一 MCP `content[0].text` 信封和混合日志。所有受控 CLI 捕获先合并 stdout/stderr 检查 `写入临时文件失败|删除凭据文件失败|can't rename log file` 强证据，或 `poll_state.enc.tmp|session.enc|.alipay-cli/credentials|alipay-cli/logs` 与 `permission denied|operation not permitted|EACCES|EPERM` 组合；命中时不得按成功 JSON 或 `network_error` 处理，裸后端 `permission denied` 不算本地权限。其他 CLI 捕获再执行唯一性解析：单个 JSON 加普通日志可接受，相同 JSON 重复可去重，多个不同 JSON 或成功/失败冲突不得选择任一路，也不得回显原始响应。每次 MCP 调用先把唯一原始结果交给 `handle_error`，返回成功后才调用 `unwrap_mcp` 和当前脚本的业务解析；不得统一假定成功字段位于 `.success`。认证分类只扫描真实响应错误层，禁止递归扫描成功候选、业务说明或请求示例中的错误样例。

每次 logout 失败后只执行一次 `whoami` 后置核验；logout 明确成功时无需额外核验，最多尝试 3 次 logout。`whoami` 后置核验必须先满足唯一 JSON、退出码为 0 且 `detect_error=SUCCESS`，再读取类型正确的 `logged_in/is_expired`；业务失败响应即使携带 `logged_in=false` 也不能证明已退出。logout 网络/服务异常、冲突输出或结果无法确认时，即使 `whoami` 仍显示已登录，也只能转 `AUTH_FLOW:RETRY_WITH_NETWORK` 并重试同一动作。logout 是可由 `whoami` 验证最终状态的幂等恢复动作：明确业务失败且仍登录时，脚本内部使用“初次 + 2 次”固定预算、间隔 3 秒重试完全相同的 logout；任一次确认已退出即继续，全部耗尽且仍登录才转 `AUTH_FLOW:LOGOUT_STILL_LOGGED_IN`。所有失败分支都不得执行 login。每个 auth 动作只允许产生一个最终 `AUTH_FLOW:*`，具体恢复 marker 已由错误处理器输出时，调用方不得追加 `AUTH_FLOW:FAILED`。

业务错误对象可能位于顶层、`data.response` 或 `errorContext.errorStack[]`。保留脚本当前字段优先级：读取 `errorCode` 的字符串或对象形式、`errorMessage|errorMsg`、`bizTips`、`checkedError`、`errorScene` 和 `errorSpecific`；只有已验证的服务写入协议 `data.success=false` 才优先使用 `data.subMsg|data.msg`，并忽略只表示外层调用成功的顶层 `msg="Success"`。`APP_MAX_ERROR` 只说明应用数量达到上限，引导复用已有上线应用或前往支付宝开放平台处理配额，不推断其他审核规则。

`needRetry=true` 仍是业务提示，不构成自动重试授权。不得丢弃实际业务错误后改称“未知错误”，也不得把现有服务写入协议扩展到其他响应结构。

## 网络重试与写后核验

- `MCP_SERVICE_ERROR`、`SERVICE_UNSTABLE` 和已识别本地网络错误：初次调用后最多重试 2 次，每次间隔 3 秒，始终复用完全相同的 argv、请求 JSON、业务请求号、资源名和动态字段。连接前沙箱明确拒绝联网时立即结束子脚本预算，由 discovery 的单次权限恢复处理，不额外等待两次 3 秒。
- discovery 只有强网络证据才输出 `DISCOVERY_FLOW:RETRY_WITH_NETWORK`；远端服务异常、业务错误、裸 `permission denied` 和响应结构异常仍保留既有失败分类。授权阻断优先且不得同时输出网络恢复 marker。
- 认证、授权不匹配、参数、业务错误和结构歧义不进入通用网络重试。唯一例外是上述可验证最终状态的幂等 logout 恢复，它使用同一三次总预算且不经通用 `network_retry.sh`。stderr 不拼入待解析 JSON。
- 只读调用可使用完整重试预算。非幂等写操作只有明确 `NOT_SENT` 才自动重试；DNS 失败、connection refused 或宿主在连接前明确拒绝网络访问可归为 `NOT_SENT`。
- timeout、连接中断、发送阶段不明和 `SERVICE_UNSTABLE` 一律归为 `MAYBE_SENT`，停止写重试并使用现有只读能力核验；无法确认输出 `UNKNOWN`。
- 签约提交用签约查询核验；服务修改只有列表按完整 `serviceId` 和五项资料精确匹配才算成功；服务新建和应用创建不得按同名候选猜测；应用提审只看现有应用信息状态。没有登记核验能力的公钥确认页不得凭页面或同名结果推断成功。

`MESSAGE_RENDER_ERROR` 不是写操作是否发出的证据，不得据此自动重写。

写动作除既有成功 marker 外，还必须输出动作级结果事实：签约 `SIGN_APPLY_RESULT=SUCCESS|FAILED|UNKNOWN`，服务保存 `SERVICE_SAVE_RESULT=SUCCESS|FAILED|UNKNOWN`，应用创建 `APPLICATION_CREATE_RESULT=SUCCESS|FAILED|UNKNOWN`，公钥确认页 `KEY_PAGE_RESULT=READY_TO_OPEN|FAILED|UNKNOWN`，应用提审 `APPLICATION_AUDIT_RESULT=SUBMITTED|FAILED|UNKNOWN`。`UNKNOWN` 表示禁止自动重复同一写动作，只能按 flow 进入当前分支待办或最终收口。

## 授权轮询恢复

`authorization_pending` 或自动轮询中 `whoami` 尚未形成有效本机登录态时，只由 `auth.sh wait` 在固定最多 12 次、未成功相邻查询间隔 5 秒内继续。耗尽后输出一次 `auth.pending`，等待用户明确表示页面操作已完成；登记表达只执行一次 `auth.sh confirm`，不得重启 `wait` 或自行循环 `login --complete`。`auth_expired` 才重新执行登录流程。

公钥轮询次数、单次恢复和页面失效判断以 application phase 与 `app.sh` 为准，本模块不维护第二份状态机。

## 对客错误边界

后端和 CLI 错误必须经 `sanitize_customer_error_text` 与登记 renderer 输出。`{{`、`}}`、`<INTERNAL_`、临时 URL、deviceCode、Authorization、`Payment-Proof`、token、password、secret、key、证书头以及未脱敏响应只能变为受控隐藏文案；普通业务错误应保留可操作内容。禁止向用户输出 trace、原始 MCP/CLI 文本、内部 marker 或技术栈。

错误正文必须说明受影响分支和确定下一步；网络预算耗尽不立即增加“重试/退出”确认，而是在其他可推进分支完成后统一收口。脚本 stdout 是登记的唯一对客正文，内部事实行按 flow 剔除。

## 维护边界

修改错误处理时至少覆盖：合法 JSON、唯一 MCP 信封、混合输出、多个候选、认证错误、授权不匹配、业务错误、网络错误、空列表和异常结构。新增未封装 MCP 调用必须先取得确定 schema，并同步脚本、业务模块、flow、MCP 契约 fixture 和测试；禁止用占位方法或通用 JSON 模板临场试调。
